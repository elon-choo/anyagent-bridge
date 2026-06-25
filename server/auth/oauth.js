/**
 * AnyAgent Bridge — OAuthManager (Stage 3)
 *
 * Drives the OAuth 2.0 authorization-code flow for the registered providers
 * (Google, GitHub). Owns the CSRF `state` + PKCE `code_verifier` lifecycle:
 * both are generated at "start", stored server-side keyed by state, and consumed
 * exactly once at "callback" (single-use, TTL-bounded). Network calls go through
 * Node 18+ global fetch — no new npm dependency. Nothing here mutates global
 * server state; it returns plain identity objects to the AuthManager.
 *
 * Adding a provider = drop a file under providers/ and register it below.
 */

const crypto = require('crypto');

const PROVIDERS = {
  google: require('./providers/google'),
  github: require('./providers/github')
};

const STATE_TTL_MS = 10 * 60 * 1000; // an auth round-trip must complete within 10 min
const MAX_PENDING = 200;             // hard ceiling on in-flight states (anti-DoS)

function b64url(buf) {
  return buf.toString('base64url');
}

class OAuthManager {
  constructor({ config, logger } = {}) {
    this.config = config || {};
    this.logger = logger || console;
    this.pending = new Map(); // state -> { provider, verifier, redirectUri, createdAt }
  }

  getProvider(id) {
    return PROVIDERS[id] || null;
  }

  /** Providers that are both known and fully configured (id + secret present). */
  configuredProviders() {
    const out = {};
    for (const id of Object.keys(PROVIDERS)) {
      const pc = this.config[id] || {};
      out[id] = !!(pc.clientId && pc.clientSecret);
    }
    return out;
  }

  isConfigured(id) {
    const pc = this.config[id] || {};
    return !!(pc.clientId && pc.clientSecret);
  }

  _sweep() {
    const now = Date.now();
    for (const [state, p] of this.pending.entries()) {
      if (now - p.createdAt > STATE_TTL_MS) this.pending.delete(state);
    }
    // Hard ceiling: even within the TTL window, never let the map grow without
    // bound (the /start route is unauthenticated). Evict oldest-first; a Map
    // preserves insertion order, so the first keys are the oldest.
    while (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest === undefined) break;
      this.pending.delete(oldest);
    }
  }

  /**
   * Build the provider authorize URL and stash the matching state/verifier.
   * @returns {string|null} the redirect URL, or null if provider unconfigured.
   */
  begin(providerId, redirectUri) {
    const provider = this.getProvider(providerId);
    if (!provider || !this.isConfigured(providerId)) return null;
    this._sweep();

    const pc = this.config[providerId];
    const state = b64url(crypto.randomBytes(24));
    const params = new URLSearchParams({
      client_id: pc.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: provider.scope,
      state
    });
    for (const [k, v] of Object.entries(provider.extraAuthParams || {})) params.set(k, v);

    let verifier = null;
    if (provider.usePkce) {
      verifier = b64url(crypto.randomBytes(32));
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', 'S256');
    }

    this.pending.set(state, { provider: providerId, verifier, redirectUri, createdAt: Date.now() });
    return `${provider.authUrl}?${params.toString()}`;
  }

  /**
   * Complete the flow: validate state, exchange the code, fetch identity.
   * Returns { ok:true, identity } or { ok:false, reason }. Never throws.
   * The state is consumed (single-use) regardless of outcome.
   */
  async complete(providerId, code, state) {
    this._sweep();
    const provider = this.getProvider(providerId);
    if (!provider || !this.isConfigured(providerId)) return { ok: false, reason: 'provider not configured' };
    if (!code || !state) return { ok: false, reason: 'missing code or state' };

    const entry = this.pending.get(state);
    this.pending.delete(state); // single-use even on failure
    if (!entry) return { ok: false, reason: 'invalid or expired state' };
    if (entry.provider !== providerId) return { ok: false, reason: 'state/provider mismatch' };
    if (Date.now() - entry.createdAt > STATE_TTL_MS) return { ok: false, reason: 'state expired' };

    const pc = this.config[providerId];
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: entry.redirectUri,
        client_id: pc.clientId,
        client_secret: pc.clientSecret
      });
      if (provider.usePkce && entry.verifier) body.set('code_verifier', entry.verifier);

      const tokenRes = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString()
      });
      if (!tokenRes.ok) {
        const txt = await tokenRes.text().catch(() => '');
        return { ok: false, reason: `token exchange failed (${tokenRes.status})`, detail: txt.slice(0, 200) };
      }
      const tokenJson = await tokenRes.json().catch(() => null);
      const accessToken = tokenJson && tokenJson.access_token;
      if (!accessToken) return { ok: false, reason: 'no access_token in response' };

      const identity = await provider.fetchIdentity(accessToken);
      const invalid = provider.validate ? provider.validate(identity) : null;
      if (invalid) return { ok: false, reason: invalid };

      return { ok: true, identity, providerId };
    } catch (e) {
      this.logger.error(`[Auth] OAuth ${providerId} error: ${e.message}`);
      return { ok: false, reason: 'oauth network error' };
    }
  }
}

module.exports = { OAuthManager, PROVIDERS };
