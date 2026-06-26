/**
 * AnyAgent Bridge — audit log (Stage 4)
 *
 * Append-only JSONL of security-relevant events: file mutations, auth, tunnel and
 * safety actions (REST), plus the semantic agent commands over WebSocket
 * (agent.start / agent.send). Raw terminal keystrokes are deliberately NOT logged —
 * they are character-at-a-time with line editing and TUI control codes and cannot
 * be reconstructed into discrete commands without a shell parser; logging them
 * would be misleading and high-volume. The audited surface is therefore:
 * REST mutations + agent.start + agent.send + kill/panic.
 *
 * Properties:
 *  - One line = one `JSON.stringify(entry)` (newlines inside fields are escaped by
 *    JSON, so attacker-controlled paths/text cannot forge a log line).
 *  - Every string field is run through the redactor's scrub() before write, so a
 *    secret typed as a path or sent to an agent never persists in the log (this is
 *    ALWAYS on when audit is on, independent of live-stream redaction).
 *  - Writes are SYNCHRONOUS (fs.appendFileSync) and ordered. Audit events fire after
 *    the HTTP response has finished (res.on('finish')) or after a WS command, so the
 *    sub-millisecond append never adds latency to the client path, and every event is
 *    durable the instant it is recorded (no async tail to lose on crash/exit). The
 *    audited surface is low-rate (mutations + agent commands, not keystrokes), so a
 *    sync append is cheap. A write failure is swallowed (one warn) — a full disk must
 *    not take down the bridge.
 *  - Rotation: per-UTC-day file, plus size rollover to `…​.N.jsonl`. Retention prune
 *    on boot by a strict filename regex (never deletes by prefix).
 *
 * Zero dependencies (Node core only).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILE_RE = /^audit-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/;

function utcDay(d) {
  const t = d || new Date();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

class AuditLog {
  constructor(opts) {
    const o = opts || {};
    this.dir = o.dir;
    this.maxFileBytes = o.maxFileBytes || 10 * 1024 * 1024;
    this.retentionDays = o.retentionDays || 30;
    this.scrub = typeof o.scrub === 'function' ? o.scrub : (s => s);
    this.logger = o.logger || console;
    this.seq = 0;
    this._rollIndex = 0;
    this._day = null;
    this._warned = false;
    this._ready = false;
  }

  init() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this._pruneOld();
      this._ready = true;
    } catch (e) {
      this.logger.warn(`[Audit] init failed (${e.message}) — audit disabled for this run`);
      this._ready = false;
    }
    return this;
  }

  _pruneOld() {
    let names;
    try { names = fs.readdirSync(this.dir); } catch (e) { return; }
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    for (const name of names) {
      if (!FILE_RE.test(name)) continue; // never touch non-audit files
      const full = path.join(this.dir, name);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
      } catch (e) { /* ignore */ }
    }
  }

  _resolveTargetFile() {
    const day = utcDay();
    if (day !== this._day) {
      this._day = day;
      this._rollIndex = 0;
    }
    let file = path.join(this.dir, `audit-${day}.jsonl`);
    // pick up an existing day file's size, and roll forward if over the cap
    for (;;) {
      let size = 0;
      try { size = fs.existsSync(file) ? fs.statSync(file).size : 0; } catch (e) { size = 0; }
      if (size < this.maxFileBytes) return file;
      this._rollIndex += 1;
      file = path.join(this.dir, `audit-${day}.${this._rollIndex}.jsonl`);
    }
  }

  /** Record an event synchronously. Never throws, never blocks the client path. */
  record(entry) {
    if (!this._ready) return;
    try {
      const line = JSON.stringify(this._sanitize(entry)) + '\n';
      const file = this._resolveTargetFile();
      fs.appendFileSync(file, line);
    } catch (e) {
      if (!this._warned) { this._warned = true; this.logger.warn(`[Audit] record failed: ${e.message}`); }
    }
  }

  _sanitize(entry) {
    const e = entry || {};
    const scrub = this.scrub;
    const s = (v) => (typeof v === 'string' ? scrub(v) : v);
    return {
      ts: new Date().toISOString(),
      seq: ++this.seq,
      action: s(e.action) || 'unknown',
      method: e.method || undefined,
      path: s(e.path),
      target: s(e.target),
      actor: e.actor || null,
      termSessionId: e.termSessionId != null ? e.termSessionId : undefined,
      clientIP: e.clientIP || undefined,
      status: e.status != null ? e.status : undefined,
      note: s(e.note)
    };
  }

  /** No-op: writes are already synchronous. Kept for the shutdown call site. */
  flushSync() { /* writes are synchronous; nothing buffered to drain */ }

  count() { return this.seq; }
}

function createAuditLog(opts) { return new AuditLog(opts).init(); }

module.exports = { createAuditLog, AuditLog, FILE_RE };
