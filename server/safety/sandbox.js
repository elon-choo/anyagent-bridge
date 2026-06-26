/**
 * AnyAgent Bridge — Docker sandbox argv/env builder (Stage 4)
 *
 * Pure, stateless, unit-testable. Builds the `docker run …` argument vector and the
 * MINIMAL environment handed to the docker client process. No shell string is ever
 * constructed — pty.spawn receives an args ARRAY, so there is no interpolation /
 * injection surface (same discipline as the tunnel base-adapter).
 *
 * Secret handling (critical): the docker CLIENT env is a small allowlist (PATH /
 * HOME / DOCKER_* + the explicitly passed-through names) — NEVER the bridge's full
 * process.env, which would leak BRIDGE_AUTH_TOKEN / BRIDGE_SESSION_SECRET into the
 * container's reach. Passed-through secrets use the `-e NAME` (value-from-client-env)
 * form so their VALUES never land in argv / the process table.
 */

'use strict';

const path = require('path');
const { findOnPath } = require('../tunnel/detect');

// Never forward the bridge's own secrets into a container, even if an operator
// lists them in envPassthrough.
const ENV_DENYLIST = /^(BRIDGE_|AAB_)/i;
const ENV_DENY_EXACT = new Set(['AUTH_TOKEN', 'SESSION_SECRET', 'BRIDGE_AUTH_TOKEN', 'BRIDGE_SESSION_SECRET']);

function detectDocker() {
  try { return findOnPath('docker'); } catch (e) { return null; }
}

/** A `docker run -v` host path. On Windows, map `C:\foo` → `//c/foo` for Docker Desktop. */
function dockerMountPath(p) {
  const resolved = path.resolve(p);
  if (process.platform === 'win32') {
    const m = /^([A-Za-z]):[\\/](.*)$/.exec(resolved);
    if (m) return `//${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
    return resolved.replace(/\\/g, '/');
  }
  return resolved;
}

/** Filter an envPassthrough list down to names that are safe and present in env. */
function resolvePassthrough(names, env) {
  const e = env || process.env;
  const out = [];
  const seen = new Set();
  for (const name of Array.isArray(names) ? names : []) {
    if (typeof name !== 'string' || !name) continue;
    if (ENV_DENYLIST.test(name) || ENV_DENY_EXACT.has(name)) continue;
    if (e[name] === undefined) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Minimal environment for the docker CLIENT process (NOT the container). */
function buildClientEnv(passthroughNames, env) {
  const e = env || process.env;
  const out = {};
  const base = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'TEMP', 'TMP',
    'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'];
  for (const k of base) if (e[k] !== undefined) out[k] = e[k];
  for (const name of passthroughNames) if (e[name] !== undefined) out[name] = e[name];
  return out;
}

/**
 * Whether a resolved working dir may be bind-mounted. Refuses HOME and any
 * configured allowed-base root — never mount a whole home directory into a
 * container (too broad / surprising). `blocked` is a list of absolute paths.
 */
function isSandboxableDir(dir, blocked) {
  if (!dir) return false;
  const resolved = path.resolve(dir);
  return !(blocked || []).some(b => {
    try { return path.resolve(b) === resolved; } catch (e) { return false; }
  });
}

/**
 * Build the `docker run` argv. Caller supplies the already-resolved image and the
 * already-filtered passthrough names.
 *   opts = { containerName, hostProjectDir, image, passthroughNames, cfg }
 */
function buildDockerArgs(opts) {
  const { containerName, hostProjectDir, image, passthroughNames, cfg } = opts;
  const workdir = cfg.workdir || '/workspace';
  const args = ['run', '--rm', '-it', '--name', containerName, '--hostname', 'aab'];

  const mount = `${dockerMountPath(hostProjectDir)}:${workdir}${cfg.mountMode === 'ro' ? ':ro' : ''}`;
  args.push('-v', mount, '-w', workdir);

  args.push('--network', cfg.network || 'bridge');

  if (cfg.memory) { args.push('--memory', String(cfg.memory), '--memory-swap', String(cfg.memory)); }
  if (cfg.cpus) args.push('--cpus', String(cfg.cpus));
  if (cfg.pidsLimit) args.push('--pids-limit', String(cfg.pidsLimit));

  if (cfg.noNewPrivileges !== false) args.push('--security-opt', 'no-new-privileges');
  if (cfg.dropAllCaps) args.push('--cap-drop', 'ALL');
  if (cfg.readOnlyRootfs) {
    args.push('--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--tmpfs', '/run:rw,nosuid,size=64m');
  }
  // --user maps host uid:gid so files on the bind mount are operator-owned. This is
  // a Linux-native truth only; on Docker Desktop (mac/win) the VM remaps UIDs and a
  // host uid here can make the mount unwritable — so gate strictly to linux.
  if (cfg.runAsHostUser && process.platform === 'linux' && typeof process.getuid === 'function') {
    args.push('--user', `${process.getuid()}:${process.getgid()}`);
  }

  args.push('-e', 'TERM=xterm-256color');
  for (const name of passthroughNames || []) args.push('-e', name); // value-from-client-env

  if (Array.isArray(cfg.extraArgs)) for (const a of cfg.extraArgs) if (typeof a === 'string' && a) args.push(a);

  args.push(image);

  const shellArgv = cfg.shell
    ? (Array.isArray(cfg.shell) ? cfg.shell.slice() : [cfg.shell])
    : ['/bin/sh', '-l'];
  for (const s of shellArgv) args.push(String(s));

  return args;
}

module.exports = {
  detectDocker, dockerMountPath, resolvePassthrough, buildClientEnv,
  isSandboxableDir, buildDockerArgs, ENV_DENYLIST
};
