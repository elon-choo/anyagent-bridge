/**
 * Stage 4 smoke tests — zero-dependency node assertions for the safety subsystem.
 * Run: node test/stage4-smoke.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

const { createRedactor } = require(path.join(ROOT, 'server/safety/redact'));
const { resolveClientIP, normalizeIP } = require(path.join(ROOT, 'server/safety/clientip'));
const sandbox = require(path.join(ROOT, 'server/safety/sandbox'));
const { createAuditLog, FILE_RE } = require(path.join(ROOT, 'server/safety/audit'));
const { createSafetyManager } = require(path.join(ROOT, 'server/safety'));

console.log('\n── redaction ──');
t('scrub masks an AWS key', () => {
  const r = createRedactor({});
  assert(r.scrub('id=AKIAIOSFODNN7EXAMPLE here').includes('[REDACTED:aws-key]'));
  assert(!r.scrub('id=AKIAIOSFODNN7EXAMPLE here').includes('AKIAIOSFODNN7EXAMPLE'));
});
t('scrub masks an openai-style key', () => {
  const r = createRedactor({});
  const out = r.scrub('export OPENAI=sk-abcdefghijklmnopqrstuvwxyz012345');
  assert(out.includes('[REDACTED:openai-key]'), out);
});
t('scrub masks a PEM private key block (multi-line)', () => {
  const r = createRedactor({});
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIBVgIBADAN\nBgkqhki=\n-----END PRIVATE KEY-----';
  const out = r.scrub('before ' + pem + ' after');
  assert(out.includes('[REDACTED:private-key]'), out);
  assert(!out.includes('MIIBVgIBADAN'), out);
});
t('scrub masks the bridge\'s own token by exact match', () => {
  const tok = 'a'.repeat(64);
  const r = createRedactor({ extraSecrets: [tok] });
  assert.strictEqual(r.scrub(`url?token=${tok}`).includes(tok), false);
  assert(r.scrub(`url?token=${tok}`).includes('[REDACTED:bridge-secret]'));
});
t('stream: non-secret text passes through unchanged (push+flush == input)', () => {
  const r = createRedactor({});
  const s = r.createStream();
  const input = 'hello world\nsecond line\n$ ';
  let out = '';
  // feed in awkward 3-char slices
  for (let i = 0; i < input.length; i += 3) out += s.push(input.slice(i, i + 3));
  out += s.flush();
  assert.strictEqual(out, input, JSON.stringify(out));
});
t('stream: secret split across two chunks is still redacted', () => {
  const r = createRedactor({});
  const s = r.createStream();
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
  let out = '';
  out += s.push('token=' + secret.slice(0, 8));  // 'token=sk-abcde'
  out += s.push(secret.slice(8) + '\n');          // rest + boundary
  out += s.flush();
  assert(!out.includes(secret), 'raw secret leaked: ' + out);
  assert(out.includes('[REDACTED:openai-key]'), out);
});
t('stream: bridge token split across chunks is redacted', () => {
  const tok = 'b'.repeat(64);
  const r = createRedactor({ extraSecrets: [tok] });
  const s = r.createStream();
  let out = '';
  out += s.push('X' + tok.slice(0, 20));
  out += s.push(tok.slice(20) + ' done\n');
  out += s.flush();
  assert(!out.includes(tok), 'token leaked');
  assert(out.includes('[REDACTED:bridge-secret]'), out);
});
t('stream: a chunk ending mid-token holds it back (not emitted raw), flush redacts', () => {
  const r = createRedactor({});
  const s = r.createStream();
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345'; // >= 20 chars after sk- → a real match
  const part = s.push('export KEY=' + secret); // stream ends mid-token, no boundary
  assert(!part.includes(secret), 'partial token leaked before boundary: ' + part);
  const drained = s.flush();
  const all = part + drained;
  assert(!all.includes(secret), 'raw secret leaked: ' + all);
  assert(all.includes('[REDACTED:openai-key]'), all);
});

t('stream: a secret straddling the maxHold cut does not leak a raw fragment (H-01)', () => {
  const tok = 'Z'.repeat(64); // a bridge secret
  const r = createRedactor({ extraSecrets: [tok], maxHoldBytes: 256 });
  const s = r.createStream();
  // a long uninterrupted token-char run with the secret at the forced-cut boundary
  let out = '';
  out += s.push('q'.repeat(230) + tok + 'q'.repeat(230));
  out += s.flush();
  assert(!out.includes(tok), 'raw bridge token leaked across the maxHold boundary');
});

console.log('\n── clientip ──');
t('normalizeIP strips ::ffff: mapping', () => {
  assert.strictEqual(normalizeIP('::ffff:127.0.0.1'), '127.0.0.1');
});
t('trustProxy false ignores XFF, uses socket', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '9.9.9.9' } };
  assert.strictEqual(resolveClientIP(req, false), '9.9.9.9');
});
t('trustProxy true takes the rightmost (nearest) XFF entry', () => {
  const req = { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }, socket: { remoteAddress: '9.9.9.9' } };
  assert.strictEqual(resolveClientIP(req, true), '3.3.3.3');
});
t('trustProxy N=2 takes the 2nd-from-right XFF entry', () => {
  const req = { headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }, socket: { remoteAddress: '9.9.9.9' } };
  assert.strictEqual(resolveClientIP(req, 2), '2.2.2.2');
});
t('no XFF falls back to socket even when trusting', () => {
  const req = { headers: {}, socket: { remoteAddress: '::ffff:8.8.8.8' } };
  assert.strictEqual(resolveClientIP(req, true), '8.8.8.8');
});

console.log('\n── sandbox argv ──');
const sbCfg = {
  enabled: true, image: 'demo:latest', network: 'bridge', mountMode: 'rw', workdir: '/workspace',
  shell: null, memory: '2g', cpus: '2', pidsLimit: 512, noNewPrivileges: true,
  readOnlyRootfs: false, dropAllCaps: false, runAsHostUser: false, extraArgs: []
};
t('buildDockerArgs has run --rm -it, name, mount, limits, image, shell', () => {
  const args = sandbox.buildDockerArgs({ containerName: 'aab-x-sess-1-ab', hostProjectDir: '/tmp/proj', image: 'demo:latest', passthroughNames: ['ANTHROPIC_API_KEY'], cfg: sbCfg });
  const j = args.join(' ');
  assert(args[0] === 'run' && args.includes('--rm') && args.includes('-it'), j);
  assert(j.includes('--name aab-x-sess-1-ab'), j);
  // OS-aware: buildDockerArgs maps the host path via dockerMountPath (e.g. on Windows
  // C:\tmp\proj → //c/tmp/proj), so derive the expected mount the same way.
  assert(j.includes('-v ' + sandbox.dockerMountPath('/tmp/proj') + ':/workspace') && j.includes('-w /workspace'), j);
  assert(j.includes('--network bridge') && j.includes('--memory 2g') && j.includes('--pids-limit 512'), j);
  assert(j.includes('--security-opt no-new-privileges'), j);
  assert(args[args.length - 2] === 'demo:latest' || args.includes('demo:latest'), j);
  assert(j.endsWith('/bin/sh -l'), j);
});
t('passthrough uses -e NAME form (value NOT in argv)', () => {
  process.env.__AAB_TEST_SECRET = 'supersecretvalue';
  const names = sandbox.resolvePassthrough(['__AAB_TEST_SECRET'], process.env);
  const args = sandbox.buildDockerArgs({ containerName: 'c', hostProjectDir: '/tmp/p', image: 'i', passthroughNames: names, cfg: sbCfg });
  assert(args.includes('__AAB_TEST_SECRET'), 'name missing');
  assert(!args.join(' ').includes('supersecretvalue'), 'secret VALUE leaked into argv');
  delete process.env.__AAB_TEST_SECRET;
});
t('resolvePassthrough drops BRIDGE_* / AUTH_TOKEN even if listed', () => {
  process.env.BRIDGE_AUTH_TOKEN = 'x'; process.env.AUTH_TOKEN = 'y';
  const names = sandbox.resolvePassthrough(['BRIDGE_AUTH_TOKEN', 'AUTH_TOKEN', 'PATH'], process.env);
  assert(!names.includes('BRIDGE_AUTH_TOKEN') && !names.includes('AUTH_TOKEN'), names.join(','));
  delete process.env.BRIDGE_AUTH_TOKEN; delete process.env.AUTH_TOKEN;
});
t('buildClientEnv is minimal (no BRIDGE_*), keeps PATH + passthrough', () => {
  process.env.BRIDGE_SOMETHING = 'z'; process.env.__AAB_PASS = 'ok';
  const env = sandbox.buildClientEnv(['__AAB_PASS'], process.env);
  assert(env.PATH !== undefined, 'PATH missing');
  assert(env.BRIDGE_SOMETHING === undefined, 'BRIDGE_ leaked into client env');
  assert(env.__AAB_PASS === 'ok', 'passthrough missing');
  delete process.env.BRIDGE_SOMETHING; delete process.env.__AAB_PASS;
});
t('isSandboxableDir refuses HOME and base roots', () => {
  const home = os.homedir();
  assert.strictEqual(sandbox.isSandboxableDir(home, [home]), false);
  assert.strictEqual(sandbox.isSandboxableDir(path.join(home, 'proj'), [home]), true);
  assert.strictEqual(sandbox.isSandboxableDir(null, [home]), false);
});
t('readOnlyRootfs / dropAllCaps only present when opted in', () => {
  const plain = sandbox.buildDockerArgs({ containerName: 'c', hostProjectDir: '/tmp/p', image: 'i', passthroughNames: [], cfg: sbCfg });
  assert(!plain.includes('--read-only') && !plain.includes('--cap-drop'), 'hardening leaked by default');
  const hard = sandbox.buildDockerArgs({ containerName: 'c', hostProjectDir: '/tmp/p', image: 'i', passthroughNames: [], cfg: { ...sbCfg, readOnlyRootfs: true, dropAllCaps: true } });
  assert(hard.includes('--read-only') && hard.includes('--cap-drop') && hard.includes('ALL'), hard.join(' '));
});

console.log('\n── audit log ──');
t('writes JSONL, redacts secrets, flushSync drains, retention regex strict', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-audit-'));
  const tok = 'c'.repeat(64);
  const r = createRedactor({ extraSecrets: [tok] });
  const log = createAuditLog({ dir, scrub: (s) => r.scrub(s), maxFileBytes: 1024 * 1024, retentionDays: 30 });
  log.record({ action: 'file.write', target: `/x?token=${tok}`, actor: { type: 'token' }, status: 200 });
  log.flushSync();
  const files = fs.readdirSync(dir).filter(f => FILE_RE.test(f));
  assert(files.length === 1, 'expected one audit file, got ' + files.length);
  const body = fs.readFileSync(path.join(dir, files[0]), 'utf8').trim();
  const entry = JSON.parse(body.split('\n')[0]);
  assert.strictEqual(entry.action, 'file.write');
  assert(!body.includes(tok), 'token leaked into audit log');
  assert(body.includes('[REDACTED:bridge-secret]'), 'redaction not applied');
  assert(FILE_RE.test('audit-2026-06-26.jsonl') && FILE_RE.test('audit-2026-06-26.3.jsonl'));
  assert(!FILE_RE.test('notes.jsonl') && !FILE_RE.test('audit.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log('\n── manager: byte-identical-when-off ──');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-data-'));
const offDeps = { logger: { warn() {}, error() {}, log() {} }, dataDir, baseShell: '/bin/bash', blockedDirs: [os.homedir()], secrets: {}, isOperator: () => true, getClientIP: () => 'ip' };
t('disabled manager: getStatus() === null', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  assert.strictEqual(m.getStatus(), null);
});
t('disabled manager: spawnSpecFor() === null (session keeps host spawn)', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  assert.strictEqual(m.spawnSpecFor({ sessionId: 1 }, '/tmp/p', { A: 1 }), null);
});
t('disabled manager: newLiveStream() === null', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  assert.strictEqual(m.newLiveStream(), null);
});
t('disabled manager: handleWsMessage() === false', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  assert.strictEqual(m.handleWsMessage({ type: 'panic' }, {}), false);
});
t('disabled manager: canLaunchAgent() === true', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  assert.strictEqual(m.canLaunchAgent(), true);
});
t('disabled manager: installAuditMiddleware adds nothing', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  let used = 0; const app = { use() { used++; } };
  m.installAuditMiddleware(app);
  assert.strictEqual(used, 0);
});
t('disabled manager: registerRoutes adds nothing', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  let routes = 0; const app = { get() { routes++; }, post() { routes++; } };
  m.registerRoutes(app, {});
  assert.strictEqual(routes, 0);
});
t('disabled manager: bootSummaryLines() === []', () => {
  const m = createSafetyManager({ enabled: false }, offDeps);
  assert.deepStrictEqual(m.bootSummaryLines(), []);
});

console.log('\n── manager: enabled behavior ──');
t('enabled manager (sandbox off): getStatus() shape', () => {
  const m = createSafetyManager({ enabled: true, audit: { enabled: false }, sandbox: { enabled: false } }, offDeps);
  const s = m.getStatus();
  assert(s && s.sandbox && s.sandbox.enabled === false);
  assert(s.killSwitch && s.killSwitch.locked === false);
});
t('lock gates canLaunchAgent + persists, unlock clears', () => {
  const dd = fs.mkdtempSync(path.join(os.tmpdir(), 'aab-lock-'));
  const m = createSafetyManager({ enabled: true, killSwitch: { enabled: true, persistLock: true } }, { ...offDeps, dataDir: dd });
  m._setLock(true);
  assert.strictEqual(m.canLaunchAgent(), false);
  assert(fs.existsSync(path.join(dd, 'safety-lock.json')), 'lock not persisted');
  // a fresh manager on the same dataDir loads the lock
  const m2 = createSafetyManager({ enabled: true, killSwitch: { enabled: true, persistLock: true } }, { ...offDeps, dataDir: dd });
  assert.strictEqual(m2.locked, true, 'lock not restored across restart');
  m2._setLock(false);
  assert(!fs.existsSync(path.join(dd, 'safety-lock.json')), 'lock file not cleared');
  fs.rmSync(dd, { recursive: true, force: true });
});
t('non-operator WS panic is refused (returns true, does not act)', () => {
  const m = createSafetyManager({ enabled: true, killSwitch: { enabled: true } }, { ...offDeps, isOperator: () => false });
  let sent = null;
  const consumed = m.handleWsMessage({ type: 'panic' }, { principal: { type: 'session' }, ws: { send: (s) => { sent = s; } } });
  assert.strictEqual(consumed, true);
  assert(sent && sent.includes('Operator only'), sent);
});

fs.rmSync(dataDir, { recursive: true, force: true });

console.log(`\n──────────────\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
