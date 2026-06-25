/**
 * AnyAgent Bridge — tunnel provider registry (Stage 2)
 *
 * The extensibility seam: a map of providerId -> Adapter class. Adding a 5th
 * provider is exactly two lines — require its file and register() it here.
 * Nothing else in the codebase needs to change.
 */

const adapters = new Map();

function register(Adapter) {
  if (!Adapter || !Adapter.id) {
    throw new Error('register(): adapter is missing a static id');
  }
  adapters.set(Adapter.id, Adapter);
}

function getAdapter(id) {
  return adapters.get(id) || null;
}

function listProviders() {
  return Array.from(adapters.keys());
}

register(require('./adapters/devtunnel'));
register(require('./adapters/cloudflare-quick'));
register(require('./adapters/tailscale'));
register(require('./adapters/cloudflared-named'));

module.exports = { register, getAdapter, listProviders };
