/**
 * AnyAgent Bridge — client IP resolution (Stage 4, closes a Stage 3 residual)
 *
 * Stage 3 trusted `X-Forwarded-For` unconditionally and took the LEFTMOST entry —
 * both attacker-controllable, so a remote client could spoof its IP to dodge the
 * per-IP login rate limit and to forge the audit clientIP. This resolver makes the
 * trust explicit and opt-in.
 *
 *   trustProxy = false (or unset)  → ignore XFF entirely; use the direct socket peer.
 *   trustProxy = true              → trust ONE proxy hop: take the RIGHTMOST XFF
 *                                    entry (the address the nearest proxy saw),
 *                                    NOT the spoofable leftmost.
 *   trustProxy = N (number)        → trust N proxy hops: take the Nth-from-right
 *                                    XFF entry.
 *
 * Pure and never throws. Used by BOTH the login rate limiter and the audit log so
 * the two always agree. IMPORTANT (byte-identical rule): the caller only routes
 * through here when trustProxy was EXPLICITLY configured; with no config the
 * original Stage-3 expression is kept verbatim.
 */

'use strict';

// `::ffff:1.2.3.4` (IPv4-mapped IPv6) and `::1` are common from Node sockets;
// normalize the mapped form so allowlists/compares see a plain IPv4 address.
function normalizeIP(ip) {
  if (typeof ip !== 'string' || !ip) return 'unknown';
  let s = ip.trim();
  const m = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(s);
  if (m) s = m[1];
  return s || 'unknown';
}

function xffParts(req) {
  const raw = req && req.headers && req.headers['x-forwarded-for'];
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map(p => p.trim()).filter(Boolean);
}

function socketIP(req) {
  const sock = req && req.socket;
  return normalizeIP((sock && sock.remoteAddress) || 'unknown');
}

/**
 * Resolve the effective client IP for `req` under the given trustProxy policy.
 * Handles both Express requests and the raw WS-upgrade request (both expose
 * `.headers` and `.socket`).
 */
function resolveClientIP(req, trustProxy) {
  try {
    if (trustProxy === undefined || trustProxy === null || trustProxy === false) {
      return socketIP(req);
    }
    const parts = xffParts(req);
    if (parts.length === 0) return socketIP(req);

    let hops;
    if (trustProxy === true) hops = 1;
    else {
      const n = parseInt(trustProxy, 10);
      hops = Number.isFinite(n) && n > 0 ? n : 1;
    }
    // Take the entry `hops` from the right (the client as seen past N trusted hops).
    const idx = parts.length - hops;
    const pick = idx >= 0 ? parts[idx] : parts[0];
    return normalizeIP(pick);
  } catch (e) {
    return socketIP(req);
  }
}

module.exports = { resolveClientIP, normalizeIP };
