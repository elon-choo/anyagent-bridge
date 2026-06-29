'use strict';
/**
 * Optional update check + a friendly GitHub-star nudge for the boot banner.
 *
 * Design (mirrors a privacy-conscious update-notifier):
 *  - NON-BLOCKING: the banner only READS a cached file; the network refresh runs
 *    after the server is already listening and never delays startup.
 *  - FAIL-OPEN: any error anywhere prints nothing and is swallowed — this feature
 *    is never load-bearing.
 *  - RATE-LIMITED: at most one network call per 24h (cached in .data/update-check.json).
 *  - ANONYMOUS: the only request is an unauthenticated GET to the public npm
 *    registry — the same endpoint `npm install` hits. No credentials, nothing sent
 *    but the package name. NEVER auto-updates; it only prints a one-line notice.
 *  - OPT-OUT: set BRIDGE_UPDATE_CHECK=off (or NO_UPDATE_CHECK=1) to disable the
 *    network call and both banner lines entirely.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const pkg = require('../package.json');

const REPO_URL = 'https://github.com/elon-choo/anyagent-bridge';
const REGISTRY_URL = 'https://registry.npmjs.org/anyagent-bridge';
const DAY_MS = 24 * 60 * 60 * 1000;
const NET_TIMEOUT_MS = 4000;
const MAX_BODY = 3 * 1024 * 1024; // hard cap on the registry response we'll buffer

function disabled() {
  const v = String(process.env.BRIDGE_UPDATE_CHECK || '').toLowerCase();
  if (v === 'off' || v === 'false' || v === '0' || v === 'no') return true;
  if (String(process.env.NO_UPDATE_CHECK || '') === '1') return true;
  return false;
}

// Compare two plain "X.Y.Z" versions; returns true if `latest` is strictly newer
// than `current`. Prerelease/build tails are ignored conservatively (base only).
function isNewer(latest, current) {
  // Base "X.Y.Z" only. A missing trailing part counts as 0; any non-numeric part makes
  // the whole comparison bail (return false) so a malformed value never claims an update.
  const parse = (s) => {
    const parts = String(s).split('-')[0].split('.');
    return [0, 1, 2].map((i) => (i < parts.length ? parseInt(parts[i], 10) : 0));
  };
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) return false;
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function cacheFile(dataDir) { return path.join(dataDir, 'update-check.json'); }

function readCache(dataDir) {
  try { return JSON.parse(fs.readFileSync(cacheFile(dataDir), 'utf8')); } catch (_) { return null; }
}

// A one-line update notice IF the cache already knows a newer release exists; else ''.
function updateNoticeLine(dataDir) {
  if (disabled()) return '';
  const c = readCache(dataDir);
  if (c && typeof c.latest === 'string' && isNewer(c.latest, pkg.version)) {
    return `  ⬆️  Update available: v${pkg.version} → v${c.latest}   ` +
           '·   npm i -g anyagent-bridge@latest   (from source: git pull)';
  }
  return '';
}

function starLine() {
  return `  ⭐  Liking anyagent-bridge? A GitHub star really helps → ${REPO_URL}`;
}

// The extra banner lines: an update notice (only when one is cached) + the star nudge.
// Returns [] when opted out.
function bannerLines(dataDir) {
  if (disabled()) return [];
  const lines = [];
  const notice = updateNoticeLine(dataDir);
  if (notice) lines.push(notice);
  lines.push(starLine());
  return lines;
}

// Best-effort, detached-in-spirit refresh: skip if checked within 24h, otherwise GET
// the registry's abbreviated metadata and cache dist-tags.latest. Fully fail-open.
function refresh(dataDir) {
  if (disabled()) return;
  try {
    const c = readCache(dataDir);
    if (c && typeof c.checkedAt === 'number' && (Date.now() - c.checkedAt) < DAY_MS) return;
  } catch (_) { /* fall through and refresh */ }

  try {
    const req = https.get(
      REGISTRY_URL,
      // Static UA (no version) keeps the "nothing sent but the package name" promise honest.
      { headers: { Accept: 'application/vnd.npm.install-v1+json', 'User-Agent': 'anyagent-bridge-update-check' }, timeout: NET_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); return; }
        res.setEncoding('utf8'); // decode per-chunk so a multibyte boundary can't corrupt body
        let body = '';
        res.on('data', (d) => { body += d; if (body.length > MAX_BODY) req.destroy(); });
        res.on('error', () => {}); // defensive: never let a stream error escape
        res.on('end', () => {
          try {
            const latest = (JSON.parse(body)['dist-tags'] || {}).latest;
            if (!latest) return;
            fs.mkdirSync(dataDir, { recursive: true });
            // Atomic write: a concurrent/partial write can't corrupt the cache — a torn
            // read just fails closed (readCache returns null) and we skip the notice.
            const tmp = `${cacheFile(dataDir)}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({ latest, checkedAt: Date.now() }));
            fs.renameSync(tmp, cacheFile(dataDir));
          } catch (_) { /* ignore parse/write errors */ }
        });
      }
    );
    req.on('error', () => {});
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} });
  } catch (_) { /* network is best-effort only */ }
}

module.exports = { bannerLines, refresh, starLine, updateNoticeLine, isNewer };
