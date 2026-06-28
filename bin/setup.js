#!/usr/bin/env node
/**
 * anyagent-bridge setup — a friendly, first-timer guided launcher.
 *
 * Invoked as `npx anyagent-bridge setup` (the launcher dispatches the `setup`
 * subcommand here). It asks a few plain questions, checks prerequisites, helps
 * you pick where you'll open the bridge (this computer / same Wi-Fi / phone over
 * the internet), then boots the normal server with the matching settings — it
 * only sets the same PORT / HOST / BRIDGE_* env vars the launcher already uses,
 * so nothing here changes how the server runs. The scannable phone QR lives in
 * the browser UI ("Connect a device" → Phone); this wizard points you to it.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const pkg = require('../package.json');

// ── tiny ANSI helpers (no dependency) ─────────────────────────────────────────
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s);
const dim = (s) => c('2', s);
const cyan = (s) => c('36', s);
const green = (s) => c('32', s);
const yellow = (s) => c('33', s);
const out = (s = '') => process.stdout.write(s + '\n');
const rule = () => out(dim('─'.repeat(63)));

// ── prerequisite helpers ──────────────────────────────────────────────────────
// Cross-platform "is this command on PATH?" without spawning the command itself.
function onPath(bin) {
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, bin + ext);
      try { fs.accessSync(p, fs.constants.X_OK); return true; } catch (_) { /* keep looking */ }
    }
  }
  return false;
}

function firstLanIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

// `--yes` / `-y`: run non-interactively, accept all defaults (this computer, no agent
// auto-install). For automation / AI-driven setup, or any non-TTY environment.
const AUTO = process.argv.includes('--yes') || process.argv.includes('-y');

// ── interactive prompt (degrades gracefully without a TTY or with --yes) ──────────
let rl = null;
function ask(question, choices) {
  return new Promise((resolve) => {
    if (AUTO || !process.stdin.isTTY) { resolve(choices ? choices[0].key : ''); return; }
    if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function pick(title, choices) {
  out();
  out(bold(title));
  for (const ch of choices) out(`  ${cyan(ch.key)}) ${ch.label}${ch.hint ? dim('  — ' + ch.hint) : ''}`);
  if (AUTO || !process.stdin.isTTY) {
    out(dim('  (non-interactive — using option ' + choices[0].key + ')'));
    return choices[0];
  }
  for (;;) {
    const a = (await ask(`${dim('choose')} [${choices[0].key}]: `)) || choices[0].key;
    const found = choices.find((ch) => ch.key === a.toLowerCase());
    if (found) return found;
    out(yellow(`  "${a}" isn't one of the choices — try again.`));
  }
}

async function confirm(question, def = true) {
  if (AUTO || !process.stdin.isTTY) return def;
  const a = (await ask(`${question} ${dim(def ? '[Y/n]' : '[y/N]')} `)).toLowerCase();
  if (!a) return def;
  return a.startsWith('y');
}

// ── main flow ─────────────────────────────────────────────────────────────────
(async function main() {
  out();
  rule();
  out('  ' + bold('AnyAgent Bridge') + dim(`  ·  setup  ·  v${pkg.version}`));
  out('  ' + dim('Run your terminal + AI agents from a browser, phone, or another PC.'));
  rule();

  // 1) prerequisites -----------------------------------------------------------
  out();
  out(bold('1. Checking what you have'));
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  out(`  ${nodeMajor >= 18 ? green('✓') : yellow('!')} Node.js ${process.version}` +
      (nodeMajor >= 18 ? '' : yellow('  (needs 18+; please upgrade)')));
  const agents = [
    { id: 'claude', label: 'Claude Code (claude)' },
    { id: 'codex', label: 'Codex (codex)' },
  ].map((a) => ({ ...a, found: onPath(a.id) }));
  for (const a of agents) {
    out(`  ${a.found ? green('✓') : dim('·')} ${a.label}${a.found ? '' : dim('  — not found on PATH')}`);
  }
  if (!agents.some((a) => a.found)) {
    out();
    out(yellow('  No AI agent CLI was found. The bridge still runs (you get a plain shell),'));
    out(yellow('  but to launch an agent you need one installed.'));
    const wantClaude = await confirm('  Install Claude Code now (npm i -g @anthropic-ai/claude-code)?', false);
    if (wantClaude) {
      out(dim('  Installing via npm — this may take a minute…'));
      const r = spawnSync('npm', ['install', '-g', '@anthropic-ai/claude-code'],
        { stdio: 'inherit', shell: process.platform === 'win32' });
      if (r.status === 0) out(green('  ✓ Installed. Run `claude` once in a terminal to log in, then it shows up here.'));
      else out(yellow('  Install didn\'t finish — do it manually: ') + cyan('npm install -g @anthropic-ai/claude-code'));
    } else {
      out('  Install one yourself, e.g.: ' + cyan('npm install -g @anthropic-ai/claude-code') + dim('   then run `claude` once to log in.'));
    }
    out(dim('  (Any CLI works — register it under "agents" in config.json.)'));
  }

  // 2) where will you open it? --------------------------------------------------
  const where = await pick('2. Where do you want to open the bridge?', [
    { key: '1', label: 'This computer', hint: "open it in this machine's browser" },
    { key: '2', label: 'Another device on the same Wi-Fi', hint: 'a phone or PC on your network' },
    { key: '3', label: 'Your phone / anywhere over the internet', hint: 'via a free tunnel' },
  ]);

  // settings we will hand to the server (same env the launcher uses)
  const port = process.env.PORT || '3001';
  const token = process.env.BRIDGE_AUTH_TOKEN || crypto.randomBytes(32).toString('hex');
  let host = '127.0.0.1';
  let tunnelProvider = null;
  const nextSteps = [];

  if (where.key === '1') {
    host = '127.0.0.1';
    nextSteps.push(`Open ${cyan(`http://127.0.0.1:${port}/?token=…`)} in your browser (the full link with the token prints below).`);
    nextSteps.push(`Only this computer can reach it. Nothing is exposed to your network or the internet.`);
  } else if (where.key === '2') {
    host = '0.0.0.0';
    const ip = firstLanIPv4();
    nextSteps.push(ip
      ? `On the other device's browser, go to ${cyan(`http://${ip}:${port}/`)} and paste the access token.`
      : `Find this computer's local IP (e.g. ${dim('System Settings → Network')}), then visit ${cyan(`http://<that-ip>:${port}/`)} on the other device.`);
    nextSteps.push(`${yellow('Heads up:')} on your Wi-Fi the access token is the only lock. Keep it private; only people on your network can even reach the page.`);
    nextSteps.push(`Easiest on a phone: open the page on this computer, click ${bold('"Connect a device" → Phone')}, and scan the QR.`);
    if (process.platform === 'win32') nextSteps.push(`${yellow('Windows:')} the first time another device connects, Windows pops a Firewall prompt — click ${bold('Allow')} (at least Private networks) or the page won't load.`);
  } else {
    host = '127.0.0.1'; // the tunnel reaches in; we don't bind to the network directly
    out();
    out(yellow('  ⚠  Going over the internet means anyone with the link could reach the page.'));
    out(yellow('     The access token still gates it, but before you rely on this you should'));
    out(yellow('     turn on login / 2FA / OAuth — see docs/SECURITY.md.'));
    const ok = await confirm('  Understood — set up an internet tunnel now?', true);
    if (ok) {
      const prov = await pick('   Which free tunnel?', [
        { key: '1', label: 'Microsoft Dev Tunnels', hint: 'needs a one-time `devtunnel user login`' },
        { key: '2', label: 'Cloudflare Quick Tunnel', hint: 'no account; testing-grade URL' },
      ]);
      tunnelProvider = prov.key === '2' ? 'cloudflare-quick' : 'devtunnel';
      const cli = tunnelProvider === 'cloudflare-quick' ? 'cloudflared' : 'devtunnel';
      if (!onPath(cli)) {
        out(yellow(`   The "${cli}" command isn't installed yet — install it, then re-run setup:`));
        if (cli === 'cloudflared') {
          if (process.platform === 'darwin') out('     ' + cyan('brew install cloudflared'));
          else if (process.platform === 'win32') out('     ' + cyan('winget install --id Cloudflare.cloudflared') + dim('   (or grab it from github.com/cloudflare/cloudflared/releases)'));
          else out('     ' + cyan('https://pkg.cloudflare.com') + dim('   (apt/yum) or github.com/cloudflare/cloudflared/releases'));
        } else {
          out('     ' + cyan('https://aka.ms/devtunnels/download') + dim('   then run `devtunnel user login` once'));
        }
        out(dim('   Continuing anyway — the server falls back to localhost-only if the tunnel cannot start.'));
      }
      nextSteps.push(`When the tunnel connects, its public ${bold('https://…')} URL prints in the banner below and shows in the UI.`);
      nextSteps.push(`Open that URL on your phone, or use ${bold('"Connect a device" → Phone')} in the UI to scan a QR.`);
      nextSteps.push(`${yellow('Before sharing it:')} open the UI, enable login/2FA, and read docs/SECURITY.md.`);
    } else {
      host = '127.0.0.1';
      nextSteps.push(`No tunnel started — running on this computer only. Re-run ${cyan('anyagent-bridge setup')} when you're ready to go remote.`);
    }
  }

  // 3) summary + launch ---------------------------------------------------------
  out();
  out(bold('3. Starting the bridge'));
  out(`  ${dim('mode   ')} ${where.label}`);
  out(`  ${dim('listen ')} ${host}:${port}`);
  out(`  ${dim('tunnel ')} ${tunnelProvider || 'off'}`);
  out();
  out(bold('  Next:'));
  for (const s of nextSteps) out(`   ${green('→')} ${s}`);
  out();
  out(dim('  Full beginner guide: docs/GETTING-STARTED.md   ·   Security: docs/SECURITY.md'));
  rule();
  out();

  if (rl) rl.close();

  // Hand the chosen settings to the real server via the same env vars the
  // launcher uses, then boot it in-process. Its own banner (URL, token, and any
  // tunnel URL) prints next.
  process.env.PORT = port;
  process.env.HOST = host;
  process.env.BRIDGE_AUTH_TOKEN = token;
  if (tunnelProvider) {
    process.env.BRIDGE_TUNNEL_ENABLED = 'true';
    process.env.BRIDGE_TUNNEL_PROVIDER = tunnelProvider;
  }
  require(path.join(__dirname, '..', 'server', 'index.js'));
})().catch((e) => {
  process.stderr.write('setup failed: ' + (e && e.stack ? e.stack : e) + '\n');
  process.exit(1);
});
