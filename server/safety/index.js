/**
 * AnyAgent Bridge — safety subsystem entry (Stage 4)
 *
 * The only module server/index.js imports for Stage 4. Creates a SafetyManager that
 * wires the Docker sandbox, kill-switch, audit log, and secret redaction on top of
 * Stage 3. When `safety.enabled` is false (the default) the manager is inert and the
 * server is byte-identical to Stage 3.
 */

const SafetyManager = require('./manager');
const { resolveClientIP } = require('./clientip');

function createSafetyManager(safetyConfig, deps) {
  return new SafetyManager(safetyConfig, deps).init();
}

module.exports = { createSafetyManager, resolveClientIP };
