/**
 * AnyAgent Bridge — AuthManager (Stage 3)
 *
 * The one module server/index.js imports for auth. Sits ON TOP of Stage 1's
 * static access token; never removes it. Orchestrates three concerns:
 *
 *   1. Sessions   — signed, expiring, revocable logins (SessionStore).
 *   2. TOTP 2FA   — enroll/confirm/verify a second factor for token login.
 *   3. OAuth      — Google / GitHub sign-in (OAuthManager) → a session.
 *
 * THE ONE RULE that keeps the model coherent and backward-compatible:
 *   The static token is a *direct* credential UNLESS `requireLogin` is set OR a
 *   TOTP secret has been confirmed. In either of those cases the token becomes
 *   *login-only* — it can mint a session (with the 2FA code when enrolled) but is
 *   no longer accepted on its own for protected routes. So when OAuth is off,
 *   no TOTP is enrolled, and requireLogin is false, the bridge behaves EXACTLY
 *   like Stage 2 (the static token works everywhere).
 *
 * Browser sessions ride in an httpOnly cookie (the WS upgrade and fetches carry
 * it automatically, JS never holds the raw secret). Programmatic clients may use
 * `X-Session-Token` / `Authorization: Bearer` / `?session=` instead.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SessionStore = require('./sessions');
const { AuthStore } = require('./store');
const { OAuthManager } = require('./oauth');
const { generateSecret, verifyTotp, matchCounter, provisioningUri } = require('./totp');

const COOKIE_NAME = 'aab_session';

/** Resolve (or generate + persist) the HMAC secret used to sign sessions. */
function resolveSessionSecret(configured, dataDir, logger) {
  if (configured) return String(configured);
  const file = path.join(dataDir, 'auth-secret.json');
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && data.secret) return data.secret;
    }
  } catch (e) {
    logger.error(`[Auth] Failed to read session secret: ${e.message}`);
  }
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(file, JSON.stringify({ secret, createdAt: Date.now() }, null, 2), { mode: 0o600 });
  } catch (e) {
    logger.error(`[Auth] Failed to persist session secret: ${e.message}`);
  }
  return secret;
}

class AuthManager {
  constructor(authConfig, deps = {}) {
    this.config = authConfig || {};
    this.config.oauth = this.config.oauth || {};
    this.config.totp = this.config.totp || {};
    this.logger = deps.logger || console;
    this.staticToken = deps.staticToken;
    this.safeEqual = deps.safeEqual || ((a, b) => a === b);
    this.getClientIP = deps.getClientIP || (() => 'unknown');
    this.rateLimit = deps.rateLimit || { check: () => true, record: () => {} };

    const dataDir = deps.dataDir;
    this.ttlMs = (this.config.sessionTtlHours || 12) * 60 * 60 * 1000;

    const secret = resolveSessionSecret(this.config.sessionSecret, dataDir, this.logger);
    this.sessions = new SessionStore({
      secret,
      ttlMs: this.ttlMs,
      filePath: path.join(dataDir, 'auth-sessions.json'),
      logger: this.logger
    });
    this.store = new AuthStore({ filePath: path.join(dataDir, 'auth-users.json'), logger: this.logger });
    this.oauth = new OAuthManager({ config: this.config.oauth, logger: this.logger });
  }

  // ── Derived policy ───────────────────────────────────────────────────────────
  totpEnforced() { return this.store.totpConfirmed; }
  tokenDirectAllowed() { return !(this.config.requireLogin || this.store.totpConfirmed); }
  oauthEnabled() { return !!this.config.oauth.enabled; }
  isEnhanced() { return this.config.requireLogin || this.store.totpConfirmed || this.oauthEnabled(); }

  // ── Credential resolution (shared by HTTP middleware and WS) ──────────────────
  parseCookies(header) {
    const out = {};
    if (!header || typeof header !== 'string') return out;
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) { try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; } }
    }
    return out;
  }

  _collectCreds(req) {
    const creds = [];
    const h = req.headers || {};
    if (h['x-auth-token']) creds.push(h['x-auth-token']);
    if (h['x-session-token']) creds.push(h['x-session-token']);
    const authz = h['authorization'];
    if (authz && /^Bearer\s+/i.test(authz)) creds.push(authz.replace(/^Bearer\s+/i, ''));
    const q = req.query || {};
    if (q.token) creds.push(q.token);
    if (q.session) creds.push(q.session);
    const cookies = req.cookies || {};
    if (cookies[COOKIE_NAME]) creds.push(cookies[COOKIE_NAME]);
    return creds.filter(Boolean).map(String);
  }

  /** Return a principal ({type:'session',session} | {type:'token'}) or null. */
  resolvePrincipal(req) {
    const creds = this._collectCreds(req);
    for (const c of creds) {
      const s = this.sessions.verify(c);
      if (s) return { type: 'session', session: s };
    }
    if (this.tokenDirectAllowed() && this.staticToken) {
      for (const c of creds) {
        if (this.safeEqual(c, this.staticToken)) return { type: 'token' };
      }
    }
    return null;
  }

  /** WS upgrade auth — reads ?token / ?session and the Cookie header. */
  verifyWs(req) {
    let url;
    try { url = new URL(req.url, `http://${req.headers.host}`); }
    catch (e) { url = { searchParams: new URLSearchParams() }; }
    const faux = {
      headers: req.headers,
      query: { token: url.searchParams.get('token'), session: url.searchParams.get('session') },
      cookies: this.parseCookies(req.headers && req.headers.cookie)
    };
    return this.resolvePrincipal(faux);
  }

  _isOperator(principal) {
    if (!principal) return false;
    if (principal.type === 'token') return true;
    return principal.type === 'session' && principal.session.provider === 'token';
  }

  // ── Cookies ──────────────────────────────────────────────────────────────────
  _isSecure(req) {
    if (req.secure) return true;
    const xf = req.headers && req.headers['x-forwarded-proto'];
    return typeof xf === 'string' && xf.split(',')[0].trim() === 'https';
  }

  _setSessionCookie(req, res, token) {
    const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${Math.floor(this.ttlMs / 1000)}`];
    if (this._isSecure(req)) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  _clearSessionCookie(req, res) {
    const parts = [`${COOKIE_NAME}=`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
    if (this._isSecure(req)) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  _callbackUrl(req, providerId) {
    const base = this.config.oauth.callbackBaseUrl;
    if (base) return `${String(base).replace(/\/+$/, '')}/api/auth/oauth/${providerId}/callback`;
    const xfProto = req.headers['x-forwarded-proto'];
    const proto = (typeof xfProto === 'string' && xfProto.split(',')[0].trim()) || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/api/auth/oauth/${providerId}/callback`;
  }

  // ── Login flows ──────────────────────────────────────────────────────────────
  _verifyTotpOrRecovery(code) {
    const clean = String(code || '').replace(/\s+/g, '');
    if (!clean) return false;
    if (this.store.totpConfirmed) {
      const counter = matchCounter(this.store.totpSecret, clean);
      if (counter >= 0) {
        // Replay guard: a code at a counter we've already accepted is refused,
        // so a sniffed code cannot be reused within its ±1-step validity window.
        if (counter <= this.store.getTotpLastCounter()) return false;
        this.store.setTotpLastCounter(counter);
        return true;
      }
    }
    return this.store.useRecoveryCode(clean); // one-time codes (longer, non-6-digit)
  }

  loginWithToken(tokenStr, totpCode, ip) {
    if (!tokenStr || !this.staticToken || !this.safeEqual(tokenStr, this.staticToken)) {
      return { ok: false, reason: 'invalid token' };
    }
    if (this.totpEnforced()) {
      if (!totpCode) return { ok: false, needTotp: true, reason: '2FA code required' };
      if (!this._verifyTotpOrRecovery(totpCode)) return { ok: false, needTotp: true, reason: 'invalid 2FA code' };
    }
    const minted = this.sessions.mint({ sub: 'operator', provider: 'token', name: 'Operator', ip });
    return { ok: true, token: minted.token, session: minted.session };
  }

  _authorizeIdentity(providerId, key) {
    const pc = this.config.oauth[providerId] || {};
    const listRaw = providerId === 'google' ? pc.allowedEmails : pc.allowedLogins;
    const allow = Array.isArray(listRaw) ? listRaw.map(s => String(s).toLowerCase()) : [];
    if (allow.length > 0) {
      return allow.includes(key) ? { ok: true } : { ok: false, reason: 'not in allowlist' };
    }
    // Empty allowlist: optional first-user-claim (TOFU), else fail closed.
    if (this.config.oauth.claimFirstUser) {
      const claimed = this.store.getClaimed(providerId);
      if (claimed.length === 0) { this.store.claim(providerId, key); return { ok: true, claimed: true }; }
      return claimed.includes(key) ? { ok: true } : { ok: false, reason: 'not the claimed user' };
    }
    return { ok: false, reason: 'no allowlist configured' };
  }

  async completeOAuth(providerId, code, state, ip) {
    const result = await this.oauth.complete(providerId, code, state);
    if (!result.ok) return result;
    const provider = this.oauth.getProvider(providerId);
    const key = provider.allowKey(result.identity);
    if (!key) return { ok: false, reason: 'identity missing allow-key' };
    const authz = this._authorizeIdentity(providerId, key);
    if (!authz.ok) return authz;
    const minted = this.sessions.mint({
      sub: `${providerId}:${result.identity.sub}`,
      provider: providerId,
      name: result.identity.name,
      email: result.identity.email,
      ip
    });
    return { ok: true, token: minted.token, session: minted.session, identity: result.identity };
  }

  // ── TOTP enrollment ───────────────────────────────────────────────────────────
  totpStatus() {
    return { confirmed: this.store.totpConfirmed, recoveryRemaining: this.store.recoveryCodesRemaining() };
  }

  beginTotpEnroll() {
    const secret = generateSecret();
    this.store.setPendingTotp(secret);
    const label = this.config.totp.label || 'operator';
    const issuer = this.config.totp.issuer || 'AnyAgent Bridge';
    return { secret, otpauthUrl: provisioningUri(secret, label, issuer) };
  }

  confirmTotpEnroll(code) {
    const secret = this.store.getPendingTotp();
    if (!secret) return { ok: false, reason: 'no pending enrollment — call setup first' };
    const counter = matchCounter(secret, String(code || '').replace(/\s+/g, ''));
    if (counter < 0) {
      return { ok: false, reason: 'code does not match — check your device clock' };
    }
    const recovery = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
    this.store.confirmTotp(secret, recovery, counter); // baseline the replay counter
    return { ok: true, recoveryCodes: recovery };
  }

  disableTotp(code) {
    if (!this.store.totpConfirmed) return { ok: true };
    if (!this._verifyTotpOrRecovery(code)) return { ok: false, reason: 'invalid code' };
    this.store.disableTotp();
    return { ok: true };
  }

  // ── Public config / status (no secrets) ──────────────────────────────────────
  getPublicConfig() {
    // Minimal disclosure: only which login methods to render. Whether 2FA is
    // enrolled / requireLogin is NOT advertised pre-auth — the login response
    // signals needTotp when a code is required. OAuth providers must be listed
    // so the buttons can render (and are observable via /start regardless).
    return {
      methods: {
        token: true,
        oauth: this.oauthEnabled() ? this.oauth.configuredProviders() : { google: false, github: false }
      }
    };
  }

  getStatus() {
    return {
      requireLogin: !!this.config.requireLogin,
      tokenDirectAccess: this.tokenDirectAllowed(),
      totp: this.totpStatus(),
      oauth: {
        enabled: this.oauthEnabled(),
        providers: this.oauth.configuredProviders(),
        claimFirstUser: !!this.config.oauth.claimFirstUser
      },
      activeSessions: this.sessions.count()
    };
  }

  _publicSession(s) {
    return { id: s.id, sub: s.sub, provider: s.provider, name: s.name, email: s.email, exp: s.exp };
  }

  // ── Route registration ────────────────────────────────────────────────────────
  registerRoutes(app, deps = {}) {
    const requireAuth = deps.requireAuth;
    const ip = (req) => this.getClientIP(req);

    // Operator gate: only the token holder (or a session minted from token login)
    // may administer 2FA and the global session list. An OAuth-authenticated user
    // is NOT the operator and must not enumerate/revoke other principals' sessions.
    const operatorOnly = (req, res, next) => {
      if (!this._isOperator(req.principal)) {
        return res.status(403).json({ error: 'This action is limited to the token operator' });
      }
      next();
    };

    // Public: what login methods to render.
    app.get('/api/auth/config', (req, res) => res.json(this.getPublicConfig()));

    // Who am I (any authenticated principal).
    app.get('/api/auth/me', requireAuth, (req, res) => {
      const p = req.principal;
      if (p.type === 'session') {
        const s = p.session;
        return res.json({
          authenticated: true,
          type: 'session',
          user: { sub: s.sub, provider: s.provider, name: s.name, email: s.email, expiresAt: s.exp, sessionId: s.id }
        });
      }
      res.json({ authenticated: true, type: 'token', user: { provider: 'token', name: 'Operator (token)' } });
    });

    // Token login (+ 2FA when enrolled) → session cookie.
    app.post('/api/auth/login', (req, res) => {
      const clientIP = ip(req);
      if (!this.rateLimit.check(clientIP)) {
        return res.status(429).json({ ok: false, message: 'Too many login attempts. Try again later.' });
      }
      const body = req.body || {};
      const result = this.loginWithToken(body.token || body.password, body.totp, clientIP);
      if (!result.ok) {
        this.rateLimit.record(clientIP, false);
        return res.status(401).json(result);
      }
      this.rateLimit.record(clientIP, true);
      this._setSessionCookie(req, res, result.token);
      res.json({ ok: true, token: result.token, session: this._publicSession(result.session) });
    });

    // Backward-compatible endpoint (Stage 1/2 clients). Identical shape when no
    // 2FA is enrolled; requires the 2FA code (and returns a session) once it is.
    app.post('/api/auth/verify-local', (req, res) => {
      const clientIP = ip(req);
      if (!this.rateLimit.check(clientIP)) {
        return res.status(429).json({ success: false, message: 'Too many login attempts. Try again later.' });
      }
      const provided = req.body && (req.body.token || req.body.password);
      if (!provided || !this.staticToken || !this.safeEqual(provided, this.staticToken)) {
        this.rateLimit.record(clientIP, false);
        return res.json({ success: false, message: 'Invalid token' });
      }
      if (this.totpEnforced()) {
        const code = req.body && req.body.totp;
        if (!code || !this._verifyTotpOrRecovery(code)) {
          this.rateLimit.record(clientIP, false);
          return res.status(401).json({ success: false, needTotp: true, message: '2FA code required' });
        }
        const minted = this.sessions.mint({ sub: 'operator', provider: 'token', name: 'Operator', ip: clientIP });
        this.rateLimit.record(clientIP, true);
        this._setSessionCookie(req, res, minted.token);
        return res.json({ success: true, token: minted.token, session: this._publicSession(minted.session) });
      }
      this.rateLimit.record(clientIP, true);
      res.json({ success: true, token: this.staticToken });
    });

    app.post('/api/auth/logout', requireAuth, (req, res) => {
      if (req.principal.type === 'session') this.sessions.revoke(req.principal.session.id);
      this._clearSessionCookie(req, res);
      res.json({ ok: true });
    });

    app.get('/api/auth/sessions', requireAuth, operatorOnly, (req, res) => {
      res.json({ sessions: this.sessions.list() });
    });

    app.delete('/api/auth/sessions/:id', requireAuth, operatorOnly, (req, res) => {
      res.json({ ok: this.sessions.revoke(req.params.id) });
    });

    // ── OAuth ──
    app.get('/api/auth/oauth/:provider/start', (req, res) => {
      const providerId = req.params.provider;
      if (!this.oauthEnabled()) return res.status(404).json({ error: 'OAuth is disabled' });
      if (!this.oauth.getProvider(providerId)) return res.status(404).json({ error: `Unknown provider '${providerId}'` });
      if (!this.oauth.isConfigured(providerId)) return res.status(400).json({ error: `Provider '${providerId}' is not configured` });
      const url = this.oauth.begin(providerId, this._callbackUrl(req, providerId));
      if (!url) return res.status(400).json({ error: 'Could not start OAuth' });
      if (req.query.json === '1') return res.json({ url });
      res.redirect(url);
    });

    app.get('/api/auth/oauth/:provider/callback', (req, res) => {
      const providerId = req.params.provider;
      if (req.query.error) {
        return res.redirect('/?auth_error=' + encodeURIComponent(String(req.query.error).slice(0, 120)));
      }
      this.completeOAuth(providerId, req.query.code, req.query.state, ip(req)).then((result) => {
        if (!result.ok) {
          this.logger.warn(`[Auth] OAuth ${providerId} denied: ${result.reason}`);
          return res.redirect('/?auth_error=' + encodeURIComponent((result.reason || 'login failed').slice(0, 120)));
        }
        this.logger.log(`[Auth] OAuth ${providerId} login: ${(result.identity && result.identity.name) || result.session.sub}`);
        this._setSessionCookie(req, res, result.token);
        res.redirect('/');
      }).catch((e) => {
        this.logger.error(`[Auth] OAuth callback error: ${e.message}`);
        res.redirect('/?auth_error=' + encodeURIComponent('login error'));
      });
    });

    // ── TOTP (operator-only) ──
    app.get('/api/auth/totp/status', requireAuth, operatorOnly, (req, res) => res.json(this.totpStatus()));

    app.post('/api/auth/totp/setup', requireAuth, operatorOnly, (req, res) => {
      if (this.config.totp.enabled === false) return res.status(403).json({ error: 'TOTP is disabled in config' });
      res.json(this.beginTotpEnroll());
    });

    app.post('/api/auth/totp/confirm', requireAuth, operatorOnly, (req, res) => {
      const result = this.confirmTotpEnroll((req.body || {}).code);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    });

    app.post('/api/auth/totp/disable', requireAuth, operatorOnly, (req, res) => {
      const result = this.disableTotp((req.body || {}).code);
      if (!result.ok) return res.status(400).json(result);
      res.json(result);
    });
  }
}

module.exports = AuthManager;
