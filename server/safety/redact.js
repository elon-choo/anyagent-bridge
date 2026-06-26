/**
 * AnyAgent Bridge — secret redaction (Stage 4)
 *
 * Two consumers, one engine:
 *  - scrub(str)        full-string, used by the audit log (ALWAYS, when audit is on).
 *  - createStream()    a stateful per-PTY redactor for the LIVE output stream
 *                      (opt-in, default off — mutating a live xterm byte stream
 *                      risks corruption, so the stream redactor is best-effort and
 *                      the audit-side scrub is the authoritative one).
 *
 * Zero dependencies (Node core only). Never throws — a redaction bug must not take
 * down the terminal or the audit path.
 *
 * The bridge's OWN secrets (the access token, the session secret) are the highest
 * value to redact and are matched as exact substrings (split/join), not regex —
 * faster and immune to regex-metachar surprises in a 64-hex token.
 */

'use strict';

// label → compiled GLOBAL regex. Order matters: the multi-line private-key block
// runs first so its body is not nibbled by the narrower token patterns.
function buildPatterns() {
  return [
    { label: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { label: 'aws-key',      re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    { label: 'openai-key',   re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
    { label: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
    { label: 'slack-token',  re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
    { label: 'google-key',   re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
    { label: 'jwt',          re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    // key=value / key: value for obviously-secret names — mask only the value. The
    // value class excludes [ and ] so an already-inserted [REDACTED:label] placeholder
    // (from an earlier pattern) is never re-wrapped / re-labelled.
    { label: 'secret-assignment', re: /\b(api[_-]?key|secret|token|password|passwd|pwd)\b(\s*[:=]\s*)(['"]?)([^\s'"[\]]{6,})\3/gi,
      replace: (m, k, sep) => `${k}${sep}[REDACTED:secret]` },
  ];
}

// Characters that can appear inside the tokens we redact. The stream redactor holds
// back a trailing run of these (a possible secret straddling the chunk boundary) so
// a token split across two chunks is re-examined whole on the next push.
const TOKEN_CHAR = /[A-Za-z0-9_+/=.\-]/;

function escapeLiteral(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createRedactor(opts) {
  const o = opts || {};
  const patterns = buildPatterns();
  // Exact-match secrets (the bridge's own token + session secret). De-duped,
  // sorted longest-first so a secret that is a prefix of another is masked whole.
  const literals = Array.from(new Set((o.extraSecrets || []).filter(s => typeof s === 'string' && s.length >= 8)))
    .sort((a, b) => b.length - a.length);
  const maxHold = Math.max(256, o.maxHoldBytes || 8192);

  /** Full-string scrub. Used by the audit log and any non-streaming caller. */
  function scrub(str) {
    if (typeof str !== 'string' || str.length === 0) return str;
    let out = str;
    for (const lit of literals) {
      if (lit && out.indexOf(lit) !== -1) out = out.split(lit).join('[REDACTED:bridge-secret]');
    }
    for (const p of patterns) {
      out = out.replace(p.re, p.replace || (() => `[REDACTED:${p.label}]`));
    }
    return out;
  }

  // Where (index into `buf`) it is unsafe to flush past — the start of the earliest
  // still-unresolved thing near the tail: a trailing token run (a possible partial
  // secret), a partial ANSI escape, or a partial private-key block. Output that ends
  // on a boundary (newline/space/escape-terminator) holds back nothing → no lag.
  function holdFrom(buf) {
    const len = buf.length;
    if (len === 0) return len;
    let hold = len; // default: nothing held back

    // (a) trailing in-progress token run (a partial secret straddling the boundary)
    let i = len;
    while (i > 0 && TOKEN_CHAR.test(buf[i - 1])) i--;
    if (i < len) hold = Math.min(hold, i);

    // (b) trailing in-progress ANSI escape (ESC not yet terminated)
    const lastEsc = buf.lastIndexOf('\x1b');
    if (lastEsc !== -1) {
      const tail = buf.slice(lastEsc);
      // CSI ends with a byte in @-~ ; OSC ends with BEL or ST (ESC \). If we do not
      // see a terminator yet, the escape is incomplete — hold from ESC.
      const terminated = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.test(tail) ||
                         /^\x1b\][\s\S]*?(?:\x07|\x1b\\)/.test(tail) ||
                         /^\x1b[@-Z\\-_]/.test(tail);
      if (!terminated) hold = Math.min(hold, lastEsc);
    }

    // (c) unresolved private-key opener (multi-line; not a single token run)
    const lastBegin = buf.lastIndexOf('-----BEGIN');
    if (lastBegin !== -1 && buf.indexOf('-----END', lastBegin) === -1) {
      hold = Math.min(hold, lastBegin);
    }

    // never hold more than maxHold (bounded memory; a rare never-terminating secret
    // is accepted as a miss rather than growing carry without bound)
    if (len - hold > maxHold) hold = len - maxHold;
    return Math.max(0, Math.min(hold, len));
  }

  /**
   * Stateful stream redactor. push(chunk) returns the scrubbed, safe-to-emit
   * portion and retains a small unscrubbed carry; flush() drains the carry.
   * Operates on strings (node-pty's onData delivers decoded strings).
   */
  function createStream() {
    let carry = '';
    let overflowedOnce = false;
    return {
      push(chunk) {
        if (typeof chunk !== 'string') chunk = String(chunk == null ? '' : chunk);
        const buf = carry + chunk;
        const hold = holdFrom(buf);
        const emit = buf.slice(0, hold);
        carry = buf.slice(hold);
        let out = scrub(emit);
        // Overflow guard: if the maxHold clamp forced the emit boundary INSIDE an
        // uninterrupted token run, `out` ends mid-token and scrub() cannot match a
        // split secret — mask the trailing partial token rather than leak a raw
        // fragment. A clean (non-clamped) cut always ends on a non-token char, so this
        // fires only in the bounded-memory overflow case (a single >maxHold token-char
        // run with no whitespace/newline/ANSI — atypical terminal output). We mask the
        // WHOLE trailing run, not a bounded tail: a straddling secret's emitted portion
        // can be long (a JWT is 1-2 KB), so a bounded tail could still leak it. The
        // cost is that a benign >maxHold run (e.g. a base64 wall) is over-masked — an
        // acceptable availability trade in this opt-in, best-effort live path, since the
        // audit log (authoritative, full-string scrub) is unaffected either way.
        if (out.length && TOKEN_CHAR.test(out[out.length - 1])) {
          overflowedOnce = true;
          out = out.replace(/[A-Za-z0-9_+/=.\-]+$/, '[REDACTED:overflow]');
        }
        return out;
      },
      flush() {
        const rest = carry;
        carry = '';
        return scrub(rest);
      }
    };
  }

  return { scrub, createStream };
}

module.exports = { createRedactor, escapeLiteral };
