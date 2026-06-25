/**
 * AnyAgent Bridge — SessionStore (Stage 3)
 *
 * Issues and validates signed, expiring login sessions. A session token is
 * stateless-signed (HMAC-SHA256 over the payload) AND tracked server-side by id,
 * so it can be listed and revoked — logout and "sign out everywhere" are real,
 * not cosmetic. Persisted to .data/auth-sessions.json so logins survive a
 * server restart (mirrors sessions.json for terminals).
 *
 * Token format:  base64url(JSON{id,sub,exp}) + "." + base64url(HMAC-SHA256)
 * Validation requires: good signature, not expired, and id still present in the
 * store (deleting the id == revoking the token).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class SessionStore {
  constructor({ secret, ttlMs, filePath, logger } = {}) {
    if (!secret) throw new Error('SessionStore requires a signing secret');
    this.secret = secret;
    this.ttlMs = ttlMs || 12 * 60 * 60 * 1000;
    this.filePath = filePath;
    this.logger = logger || console;
    this.sessions = new Map(); // id -> meta
    this._load();
  }

  _sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  /** Mint a new session for a principal. Returns { token, session }. */
  mint({ sub, provider, name, email, ip, ttlMs } = {}) {
    const id = crypto.randomBytes(16).toString('hex');
    const iat = Date.now();
    const exp = iat + (ttlMs || this.ttlMs);
    const session = {
      id,
      sub: sub || 'unknown',
      provider: provider || 'token',
      name: name || null,
      email: email || null,
      ip: ip || null,
      iat,
      exp,
      lastSeen: iat
    };
    this.sessions.set(id, session);
    this._persist();
    const token = this._sign({ id, sub: session.sub, exp });
    return { token, session };
  }

  /**
   * Verify a candidate token. Returns the live session meta on success, or null.
   * Signature is checked BEFORE the payload is parsed (never trust unverified
   * bytes). Touches lastSeen on success.
   */
  verify(token) {
    if (!token || typeof token !== 'string') return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return null;

    const body = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', this.secret).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    let payload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch (e) {
      return null;
    }
    if (!payload || !payload.id || !payload.exp) return null;
    if (Date.now() > payload.exp) { this._drop(payload.id); return null; }

    const meta = this.sessions.get(payload.id);
    if (!meta) return null;                          // revoked or unknown id
    if (Date.now() > meta.exp) { this._drop(payload.id); return null; }

    meta.lastSeen = Date.now();
    return meta;
  }

  revoke(id) {
    const existed = this.sessions.delete(id);
    if (existed) this._persist();
    return existed;
  }

  list() {
    this._pruneExpired();
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      sub: s.sub,
      provider: s.provider,
      name: s.name,
      email: s.email,
      ip: s.ip,
      iat: s.iat,
      exp: s.exp,
      lastSeen: s.lastSeen
    }));
  }

  count() {
    this._pruneExpired();
    return this.sessions.size;
  }

  _drop(id) {
    if (this.sessions.delete(id)) this._persist();
  }

  _pruneExpired() {
    const now = Date.now();
    let changed = false;
    for (const [id, meta] of this.sessions.entries()) {
      if (now > meta.exp) { this.sessions.delete(id); changed = true; }
    }
    if (changed) this._persist();
  }

  _load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        const now = Date.now();
        for (const s of list) {
          if (s && s.id && s.exp && now < s.exp) this.sessions.set(s.id, s);
        }
      }
    } catch (e) {
      this.logger.error(`[Auth] Failed to load sessions: ${e.message}`);
    }
  }

  _persist() {
    if (!this.filePath) return;
    try {
      const tmp = this.filePath + '.tmp';
      const data = JSON.stringify({ sessions: Array.from(this.sessions.values()) }, null, 2);
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      fs.renameSync(tmp, this.filePath); // atomic replace
    } catch (e) {
      this.logger.error(`[Auth] Failed to persist sessions: ${e.message}`);
    }
  }
}

module.exports = SessionStore;
