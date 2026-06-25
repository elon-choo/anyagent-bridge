/**
 * AnyAgent Bridge — Google OAuth provider (Stage 3)
 *
 * OpenID Connect authorization-code flow with PKCE. Identity comes from the
 * UserInfo endpoint using the freshly-issued access token (no JWT verification
 * needed: the token was obtained directly from Google's token endpoint over TLS
 * with the client secret). The allow-key is the verified email.
 */

module.exports = {
  id: 'google',
  label: 'Google',
  scope: 'openid email profile',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  usePkce: true,
  extraAuthParams: { access_type: 'online', prompt: 'select_account' },

  async fetchIdentity(accessToken) {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`Google userinfo ${res.status}`);
    const u = await res.json();
    return {
      sub: u.sub,
      email: u.email || null,
      emailVerified: u.email_verified === true || u.email_verified === 'true',
      name: u.name || u.email || null
    };
  },

  // What the operator allowlist matches against, and what gets claimed.
  allowKey(identity) {
    return identity.email ? String(identity.email).toLowerCase() : null;
  },

  // Reject identities that cannot be safely authorized.
  validate(identity) {
    if (!identity.email) return 'Google account has no email';
    if (!identity.emailVerified) return 'Google email is not verified';
    return null;
  }
};
