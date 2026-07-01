'use strict';
/*
 * anyagent-bridge service worker — web-push notifications for running Claude Code /
 * Codex sessions, INCLUDING background agents/subagents.
 *
 * Every push says the TYPE at a glance, so the notification alone is enough:
 *   kind:"done"     ✅ 작업 완료        — the agent finished everything
 *   kind:"progress" 📊 중간 보고        — a step / subagent finished, still going
 *   kind:"question" ⏸️ 멈추고 질문·승인  — paused, waiting for your answer (sticks)
 *
 * Tapping the notification (or "세션 열기") opens THAT session in the bridge and
 * focuses an existing tab if one is open; "닫기" just dismisses it.
 */

const KIND = {
  done:     { emoji: '✅', label: '완료',     stick: false },
  progress: { emoji: '📊', label: '중간 보고', stick: false },
  question: { emoji: '⏸️', label: '질문·승인', stick: true  },
};
const PUSH_PREFS_CACHE = 'aab-push-prefs-v1';
const PUSH_PREFS_URL = '/__aab_push_prefs__';
const DEFAULT_PUSH_PREFS = { mode: 'all' };
const PUSH_MODES = { all: true, important: true, quiet: true, paused: true };
let memoryPushPrefs = DEFAULT_PUSH_PREFS;

function cleanPushPrefs(prefs) {
  const mode = prefs && PUSH_MODES[prefs.mode] ? prefs.mode : DEFAULT_PUSH_PREFS.mode;
  return { mode };
}
async function readPushPrefs() {
  try {
    if (!self.caches) return memoryPushPrefs;
    const cache = await caches.open(PUSH_PREFS_CACHE);
    const res = await cache.match(PUSH_PREFS_URL);
    if (!res) return memoryPushPrefs;
    memoryPushPrefs = cleanPushPrefs(await res.json());
    return memoryPushPrefs;
  } catch (_) { return memoryPushPrefs; }
}
async function writePushPrefs(prefs) {
  memoryPushPrefs = cleanPushPrefs(prefs);
  try {
    if (!self.caches) return memoryPushPrefs;
    const cache = await caches.open(PUSH_PREFS_CACHE);
    await cache.put(PUSH_PREFS_URL, new Response(JSON.stringify(memoryPushPrefs), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (_) {}
  return memoryPushPrefs;
}
function shouldShowPush(kind, prefs) {
  const mode = cleanPushPrefs(prefs).mode;
  if (mode === 'paused') return false;
  if (mode === 'quiet') return kind === 'question';
  if (mode === 'important') return kind === 'question' || kind === 'done';
  return true;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'aabPushPrefs') event.waitUntil(writePushPrefs(d.prefs));
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (_) {}
    const prefs = await readPushPrefs();
    if (!shouldShowPush(d.kind || 'progress', prefs)) return;
    const k = KIND[d.kind] || KIND.progress;
    const who = d.agent ? `${d.agent} · ` : '';
    const title = `${k.emoji} ${who}${k.label}`;
    const body = d.body || d.summary || '세션 상태가 바뀌었습니다.';
    const url = d.url || '/';
    // one notification per session+kind; important/quiet modes avoid extra buzzing
    // for non-blocking updates while still keeping question prompts sticky.
    const tag = d.tag || `aab-${d.sessionId || 'session'}-${d.kind || 'progress'}`;
    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: prefs.mode === 'all' || d.kind === 'question',
      requireInteraction: k.stick,           // questions stay until you act on them
      data: { url, kind: d.kind, sessionId: d.sessionId || null },
      icon: '/icon.svg',
      badge: '/icon.svg',
      actions: [
        { action: 'open', title: '세션 열기' },
        { action: 'dismiss', title: '닫기' },
      ],
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;             // X / 닫기 → just dismiss
  // Resolve to an ABSOLUTE same-origin URL: a payload must never deep-link off-site
  // (defence for when triggers fill in url later), and an absolute href lets the
  // "already open?" comparison below work (relative '/' would never match w.url).
  let url;
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
    url = u.origin === self.location.origin ? u.href : self.location.origin + '/';
  } catch (_) { url = self.location.origin + '/'; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {                            // focus an open tab and navigate it to the session
      if ('focus' in w) {
        try { await w.focus(); if ('navigate' in w && w.url !== url) await w.navigate(url); return; }
        catch (_) { /* fall through to openWindow */ }
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
