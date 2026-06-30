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

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const k = KIND[d.kind] || KIND.progress;
  const who = d.agent ? `${d.agent} · ` : '';
  const title = `${k.emoji} ${who}${k.label}`;
  const body = d.body || d.summary || '세션 상태가 바뀌었습니다.';
  const url = d.url || '/';
  // one notification per session+kind; renotify so a new push of the same kind buzzes again
  const tag = d.tag || `aab-${d.sessionId || 'session'}-${d.kind || 'progress'}`;
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    requireInteraction: k.stick,           // questions stay until you act on them
    data: { url, kind: d.kind, sessionId: d.sessionId || null },
    icon: '/icon.svg',
    badge: '/icon.svg',
    actions: [
      { action: 'open', title: '세션 열기' },
      { action: 'dismiss', title: '닫기' },
    ],
  }));
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
