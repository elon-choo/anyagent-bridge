'use strict';
/*
 * Optional web-push notifications.
 *
 * Stores VAPID keys (.data/vapid.json, 0600) and device subscriptions
 * (.data/push-subs.json, 0600), and sends a notification payload to every
 * registered device. Everything is best-effort and never throws into a request
 * path. If the `web-push` library is unavailable, the whole feature degrades to
 * disabled (enabled() === false) and the server runs exactly as before.
 */
const fs = require('fs');
const path = require('path');

let webpush = null;
try { webpush = require('web-push'); } catch (_) { /* push is optional */ }

let DATA_DIR = null;
let VAPID = null;
let subs = [];

const subsFile = () => path.join(DATA_DIR, 'push-subs.json');
const vapidFile = () => path.join(DATA_DIR, 'vapid.json');

function loadOrCreateVapid() {
  try { return JSON.parse(fs.readFileSync(vapidFile(), 'utf8')); } catch (_) { /* generate below */ }
  const keys = webpush.generateVAPIDKeys();
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(vapidFile(), JSON.stringify(keys), { mode: 0o600 }); } catch (_) {}
  return keys;
}
function loadSubs() { try { subs = JSON.parse(fs.readFileSync(subsFile(), 'utf8')) || []; } catch (_) { subs = []; } }
function saveSubs() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(subsFile(), JSON.stringify(subs), { mode: 0o600 }); } catch (_) {}
}

function init(dataDir, opts) {
  if (!webpush) return false;
  try {
    DATA_DIR = dataDir;
    VAPID = loadOrCreateVapid();
    const subject = (opts && opts.subject) || 'mailto:anyagent-bridge@localhost';
    webpush.setVapidDetails(subject, VAPID.publicKey, VAPID.privateKey);
    loadSubs();
    return true;
  } catch (_) { VAPID = null; return false; }
}

function enabled() { return !!webpush && !!VAPID; }
function publicKey() { return VAPID ? VAPID.publicKey : null; }
function count() { return subs.length; }

function subscribe(sub) {
  if (!sub || typeof sub.endpoint !== 'string') return false;
  // require the encryption keys too — a sub without them can never be delivered to
  // (web-push fails locally, so it never gets a 404/410 to prune it) and would just
  // accumulate. Reject it up front.
  if (!sub.keys || typeof sub.keys.p256dh !== 'string' || typeof sub.keys.auth !== 'string') return false;
  if (!subs.find((s) => s.endpoint === sub.endpoint)) { subs.push(sub); saveSubs(); }
  return true;
}
function unsubscribe(endpoint) {
  const before = subs.length;
  subs = subs.filter((s) => s.endpoint !== endpoint);
  if (subs.length !== before) saveSubs();
}

// Send a payload to every registered device. Prunes subscriptions the push
// service reports as gone (404/410). Never throws.
async function send(payload) {
  if (!enabled() || !subs.length) return { sent: 0, failed: 0, devices: subs.length };
  const body = JSON.stringify(payload || {});
  let sent = 0, failed = 0;
  const dead = [];
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, body); sent++; }
    catch (e) { failed++; const code = e && e.statusCode; if (code === 404 || code === 410) dead.push(s.endpoint); }
  }));
  if (dead.length) { subs = subs.filter((s) => !dead.includes(s.endpoint)); saveSubs(); }
  return { sent, failed, devices: subs.length };
}

module.exports = { init, enabled, publicKey, count, subscribe, unsubscribe, send };
