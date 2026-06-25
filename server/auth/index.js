/**
 * AnyAgent Bridge — auth subsystem entry (Stage 3)
 *
 * The only module server/index.js imports for authentication. Creates an
 * AuthManager and exposes the OAuth provider list for diagnostics. Sits on top
 * of the Stage 1 static token; disabled features leave Stage 2 behavior intact.
 */

const AuthManager = require('./manager');
const { PROVIDERS } = require('./oauth');

function createAuthManager(authConfig, deps) {
  return new AuthManager(authConfig, deps);
}

function listOAuthProviders() {
  return Object.keys(PROVIDERS);
}

module.exports = { createAuthManager, listOAuthProviders };
