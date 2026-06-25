/**
 * AnyAgent Bridge — AuthStore (Stage 3)
 *
 * Persists the long-lived auth state that is NOT a session:
 *   - TOTP enrollment (active secret + hashed one-time recovery codes)
 *   - a pending (not-yet-confirmed) TOTP secret during setup
 *   - OAuth "claimed" identities (first-user-claim / TOFU records)
 *
 * Written to .data/auth-users.json with 0600 perms and atomic replace. Secrets
 * live here, never in the git-tracked config. The session signing secret is kept
 * in a separate file so this one can be inspected without leaking it.
 */

const crypto = require('crypto');
const fs = require('fs');

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

class AuthStore {
  constructor({ filePath, logger } = {}) {
    this.filePath = filePath;
    this.logger = logger || console;
    this.data = {
      totp: { confirmed: false, secret: null, confirmedAt: null, recoveryCodes: [], lastCounter: 0 },
      totpPending: { secret: null, createdAt: null },
      oauthClaimed: { google: [], github: [] }
    };
    this._load();
  }

  _load() {
    if (!this.filePath) return;
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data = {
          totp: { confirmed: false, secret: null, confirmedAt: null, recoveryCodes: [], lastCounter: 0, ...(parsed.totp || {}) },
          totpPending: { secret: null, createdAt: null, ...(parsed.totpPending || {}) },
          oauthClaimed: { google: [], github: [], ...(parsed.oauthClaimed || {}) }
        };
      }
    } catch (e) {
      this.logger.error(`[Auth] Failed to load auth store: ${e.message}`);
    }
  }

  _persist() {
    if (!this.filePath) return;
    try {
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      this.logger.error(`[Auth] Failed to persist auth store: ${e.message}`);
    }
  }

  // ── TOTP ───────────────────────────────────────────────────────────────────
  get totpConfirmed() { return !!this.data.totp.confirmed; }
  get totpSecret() { return this.data.totp.secret; }

  setPendingTotp(secret) {
    this.data.totpPending = { secret, createdAt: Date.now() };
    this._persist();
  }

  getPendingTotp() { return this.data.totpPending.secret; }

  /** Promote the pending secret to active and store hashed recovery codes. */
  confirmTotp(secret, recoveryCodesPlain, initialCounter) {
    this.data.totp = {
      confirmed: true,
      secret,
      confirmedAt: Date.now(),
      recoveryCodes: (recoveryCodesPlain || []).map(c => ({ hash: hashCode(c), used: false })),
      // Baseline the replay counter to the code that confirmed enrollment, so that
      // same code cannot be immediately replayed to log in.
      lastCounter: Number.isFinite(initialCounter) ? initialCounter : 0
    };
    this.data.totpPending = { secret: null, createdAt: null };
    this._persist();
  }

  disableTotp() {
    this.data.totp = { confirmed: false, secret: null, confirmedAt: null, recoveryCodes: [], lastCounter: 0 };
    this.data.totpPending = { secret: null, createdAt: null };
    this._persist();
  }

  // Replay guard: the highest TOTP step counter accepted so far. A code at a
  // counter <= this must be rejected as a replay (RFC 6238 §5.2).
  getTotpLastCounter() { return this.data.totp.lastCounter || 0; }
  setTotpLastCounter(counter) {
    if (Number.isFinite(counter) && counter > (this.data.totp.lastCounter || 0)) {
      this.data.totp.lastCounter = counter;
      this._persist();
    }
  }

  /** Consume a one-time recovery code (constant-time hash compare). */
  useRecoveryCode(code) {
    const target = Buffer.from(hashCode(String(code).replace(/\s+/g, '')), 'hex');
    let match = null;
    for (const rc of this.data.totp.recoveryCodes) {
      if (rc.used) continue;
      const h = Buffer.from(rc.hash, 'hex');
      if (h.length === target.length && crypto.timingSafeEqual(h, target)) match = rc;
    }
    if (!match) return false;
    match.used = true;
    this._persist();
    return true;
  }

  recoveryCodesRemaining() {
    return this.data.totp.recoveryCodes.filter(rc => !rc.used).length;
  }

  // ── OAuth claim (TOFU) ───────────────────────────────────────────────────────
  getClaimed(provider) {
    return Array.isArray(this.data.oauthClaimed[provider]) ? this.data.oauthClaimed[provider] : [];
  }

  claim(provider, key) {
    if (!this.data.oauthClaimed[provider]) this.data.oauthClaimed[provider] = [];
    if (!this.data.oauthClaimed[provider].includes(key)) {
      this.data.oauthClaimed[provider].push(key);
      this._persist();
    }
  }
}

module.exports = { AuthStore, hashCode };
