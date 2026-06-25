/**
 * AnyAgent Bridge — tunnel subsystem entry (Stage 2)
 *
 * The only module server/index.js imports. Creates a TunnelManager and exposes
 * the provider list for diagnostics.
 */

const TunnelManager = require('./manager');
const { listProviders } = require('./registry');

function createTunnelManager(tunnelConfig, logger) {
  return new TunnelManager(tunnelConfig, logger);
}

module.exports = { createTunnelManager, listProviders };
