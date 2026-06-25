/**
 * AnyAgent Bridge — TOTP (Stage 3)
 *
 * RFC 4226 (HOTP) + RFC 6238 (TOTP), implemented with only Node's `crypto`.
 * No new npm dependency. Compatible with Google Authenticator / 1Password /
 * Authy (SHA1, 6 digits, 30s period, base32 secret).
 *
 * Pure functions — no state, no I/O. The store/manager own persistence.
 */

const crypto = require('crypto');

// RFC 4648 base32 alphabet (no padding on encode; padding tolerated on decode).
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/\s+/g, '').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue; // ignore anything outside the alphabet
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh random base32 secret (default 20 bytes = 160 bits, RFC 4226 §4). */
function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

/** HOTP value for a given counter. Counter is treated as a 64-bit big-endian int. */
function hotp(secretBase32, counter, digits = 6) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  // Split into hi/lo 32-bit words so counters above 2^32 stay correct.
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter % 0x100000000;
  buf.writeUInt32BE(hi, 0);
  buf.writeUInt32BE(lo, 4);

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[offset] & 0x7f) << 24) |
              ((hmac[offset + 1] & 0xff) << 16) |
              ((hmac[offset + 2] & 0xff) << 8) |
              (hmac[offset + 3] & 0xff);
  const otp = bin % Math.pow(10, digits);
  return String(otp).padStart(digits, '0');
}

/** Current TOTP value. `opts.now` (ms) overridable for tests. */
function totp(secretBase32, opts = {}) {
  const step = opts.step || 30;
  const now = opts.now != null ? opts.now : Date.now();
  const counter = Math.floor((now / 1000) / step);
  return hotp(secretBase32, counter, opts.digits || 6);
}

/**
 * Return the matched step counter for a user-supplied code (allowing ±`window`
 * steps of drift), or -1 if it matches no step. Constant-time per candidate.
 * The counter is what the caller persists to prevent replay (RFC 6238 §5.2):
 * a code at counter <= the last accepted counter must be rejected.
 */
function matchCounter(secretBase32, code, opts = {}) {
  if (!secretBase32 || code == null) return -1;
  const cleaned = String(code).replace(/\s+/g, '');
  if (!/^\d{6,8}$/.test(cleaned)) return -1;

  const step = opts.step || 30;
  const digits = opts.digits || 6;
  const window = opts.window != null ? opts.window : 1;
  const now = opts.now != null ? opts.now : Date.now();
  const counter = Math.floor((now / 1000) / step);

  const candidate = Buffer.from(cleaned);
  for (let i = -window; i <= window; i++) {
    if (counter + i < 0) continue; // negative counters are not valid TOTP steps
    const expected = Buffer.from(hotp(secretBase32, counter + i, digits));
    if (expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate)) {
      return counter + i;
    }
  }
  return -1;
}

/**
 * Verify a user-supplied code against a secret, allowing ±`window` steps of
 * clock drift (default ±1 = ±30s). Boolean convenience over matchCounter().
 * NOTE: this does NOT prevent replay on its own — callers that need replay
 * protection must use matchCounter() and persist the accepted counter.
 */
function verifyTotp(secretBase32, code, opts = {}) {
  return matchCounter(secretBase32, code, opts) >= 0;
}

/** otpauth:// provisioning URI for authenticator-app QR codes / manual entry. */
function provisioningUri(secretBase32, label, issuer) {
  const fullLabel = issuer ? `${issuer}:${label}` : label;
  const params = new URLSearchParams({ secret: secretBase32, algorithm: 'SHA1', digits: '6', period: '30' });
  if (issuer) params.set('issuer', issuer);
  return `otpauth://totp/${encodeURIComponent(fullLabel)}?${params.toString()}`;
}

module.exports = {
  base32Encode,
  base32Decode,
  generateSecret,
  hotp,
  totp,
  matchCounter,
  verifyTotp,
  provisioningUri
};
