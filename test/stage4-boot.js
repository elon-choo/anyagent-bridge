/**
 * Stage 4 boot test — boots the real server and proves the cardinal invariant at the
 * integrated level: with safety off the server is byte-identical to Stage 3 (no
 * `safety` key in /api/system/status, no safety banner lines, no /api/safety/* routes),
 * and with safety on the subsystem is wired (status key, routes, audit recording).
 *
 * Zero dependencies — child_process + global fetch (Node >=18). Run:
 *   node test/stage4-boot.js
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 3997;
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ok   ${m}`); pass++; };
const bad = (m) => { console.error(`  FAIL ${m}`); fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function bootServer(extraEnv) {
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', BRIDGE_TUNNEL_ENABLED: 'false', ...extraEnv };
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += d.toString(); });
  child.stderr.on('data', d => { out += d.toString(); });
  return { child, log: () => out };
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/health`); if (r.ok) return true; } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  return false;
}

function tokenFrom(log) {
  const m = /Access token \([a-z]+\): ([a-f0-9]+)/.exec(log);
  return m ? m[1] : null;
}

async function stop(child) {
  child.kill('SIGTERM');
  for (let i = 0; i < 25; i++) { if (child.exitCode !== null || child.signalCode) return; await sleep(200); }
  try { child.kill('SIGKILL'); } catch (e) {}
}

async function main() {
  // ── safety OFF (default) ──
  console.log('\n── boot: safety OFF (default) ──');
  let s = bootServer({});
  if (!await waitHealthy()) { bad('server did not boot (safety off)'); console.error(s.log()); await stop(s.child); }
  else {
    const T = tokenFrom(s.log());
    const st = await (await fetch(`http://127.0.0.1:${PORT}/api/system/status?token=${T}`)).json();
    if (!('safety' in st)) ok('system/status has NO safety key when off (byte-identical)'); else bad('system/status leaked a safety key when off');
    if ('tunnel' in st && 'auth' in st && 'server' in st) ok('system/status keeps Stage-3 keys'); else bad('Stage-3 keys missing');
    if (!/Sandbox:|Audit:|SAFETY:/.test(s.log())) ok('banner has no safety lines when off'); else bad('banner leaked safety lines when off');
    const code = (await fetch(`http://127.0.0.1:${PORT}/api/safety/status?token=${T}`)).status;
    if (code === 404) ok('/api/safety/status is 404 when off (no routes registered)'); else bad(`/api/safety/status returned ${code}, expected 404`);
    await stop(s.child);
  }

  // ── safety ON + audit ──
  console.log('\n── boot: safety ON + audit ──');
  try { fs.rmSync(path.join(ROOT, '.data/audit'), { recursive: true, force: true }); } catch (e) {}
  s = bootServer({ BRIDGE_SAFETY_ENABLED: 'true', BRIDGE_AUDIT_ENABLED: 'true' });
  if (!await waitHealthy()) { bad('server did not boot (safety on)'); console.error(s.log()); await stop(s.child); }
  else {
    const T = tokenFrom(s.log());
    const st = await (await fetch(`http://127.0.0.1:${PORT}/api/system/status?token=${T}`)).json();
    if (st.safety && st.safety.killSwitch) ok('system/status has safety status when on'); else bad('safety status missing when on');
    const code = (await fetch(`http://127.0.0.1:${PORT}/api/safety/status?token=${T}`)).status;
    if (code === 200) ok('/api/safety/status is 200 when on'); else bad(`/api/safety/status returned ${code}`);
    if (/Audit:/.test(s.log())) ok('banner shows the Audit summary when on'); else bad('banner missing the Audit line');
    // an audited mutation with NO filesystem side effect: DELETE a path that does not
    // exist (allowed-but-absent → 404, still logged as file.delete).
    const ghost = path.join(os.homedir(), '.aab-stage4-ghost-never-exists');
    await fetch(`http://127.0.0.1:${PORT}/api/file?path=${encodeURIComponent(ghost)}&token=${T}`, { method: 'DELETE' });
    await sleep(300);
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, '.data/audit')).filter(f => /^audit-.*\.jsonl$/.test(f)); } catch (e) {}
    if (files.length) {
      ok('audit JSONL file created');
      const body = fs.readFileSync(path.join(ROOT, '.data/audit', files[0]), 'utf8');
      if (/file\.delete/.test(body)) ok('file.delete event recorded'); else bad('file.delete not in audit log');
    } else bad('no audit file created');
    await stop(s.child);
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
