/**
 * AnyAgent Bridge — GitHub OAuth provider (Stage 3)
 *
 * Standard GitHub OAuth App authorization-code flow. GitHub's classic flow does
 * not support PKCE, so CSRF protection rests on the `state` parameter (always
 * enforced by the manager). The allow-key is the GitHub login (username); the
 * email is fetched for display and may be null if the user keeps it private.
 */

module.exports = {
  id: 'github',
  label: 'GitHub',
  scope: 'read:user user:email',
  authUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  usePkce: false,
  extraAuthParams: {},

  async fetchIdentity(accessToken) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'anyagent-bridge'
    };
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new Error(`GitHub user ${userRes.status}`);
    const u = await userRes.json();

    let email = u.email || null;
    if (!email) {
      try {
        const emailRes = await fetch('https://api.github.com/user/emails', { headers });
        if (emailRes.ok) {
          const emails = await emailRes.json();
          if (Array.isArray(emails)) {
            const primary = emails.find(e => e.primary && e.verified) || emails.find(e => e.verified);
            email = primary ? primary.email : null;
          }
        }
      } catch (e) { /* email is best-effort; login is the identity */ }
    }

    return {
      sub: String(u.id),
      login: u.login || null,
      name: u.name || u.login || null,
      email
    };
  },

  allowKey(identity) {
    return identity.login ? String(identity.login).toLowerCase() : null;
  },

  validate(identity) {
    if (!identity.login) return 'GitHub account has no login';
    return null;
  }
};
