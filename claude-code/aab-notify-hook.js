#!/usr/bin/env node
'use strict';
/*
 * AnyAgent Bridge — Claude Code notification hook.
 *
 * Wire this into ~/.claude/settings.json so a running session pings your bridge,
 * which summarizes the event (Haiku) and pushes a TYPED alert to your phone/PC:
 *   Notification → "question" (paused, needs you)   Stop → let the bridge classify
 *   SubagentStop → "progress" (a background agent finished a step)
 *
 *   "hooks": {
 *     "Notification":  [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/aab-notify-hook.js question" }] }],
 *     "Stop":          [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/aab-notify-hook.js" }] }],
 *     "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node /ABS/PATH/aab-notify-hook.js progress" }] }]
 *   }
 *
 * Configure (env, e.g. in ~/.claude/settings.json "env" or your shell):
 *   AAB_NOTIFY_URL    your bridge endpoint, e.g. http://127.0.0.1:3001/api/notify/event
 *                     (point it ONLY at your own trusted bridge — the hook POSTs your
 *                      session transcript tail there)
 *   AAB_NOTIFY_TOKEN  your bridge access token
 *
 * Inert (exits 0, does nothing) unless AAB_NOTIFY_URL is set — safe to leave installed
 * everywhere. Always exits 0 and never blocks Claude Code.
 */
const url = process.env.AAB_NOTIFY_URL;
if (!url) process.exit(0);
const token = process.env.AAB_NOTIFY_TOKEN || '';
const kindHint = process.argv[2] || ''; // question | done | progress (optional)

let input = '';
process.stdin.on('data', (d) => { input += d; if (input.length > 500000) process.stdin.destroy(); });
process.stdin.on('end', () => {
  let p = {};
  try { p = JSON.parse(input); } catch (_) {}
  let text = '';
  try {
    const fs = require('fs');
    if (p.transcript_path && fs.existsSync(p.transcript_path)) {
      const tail = fs.readFileSync(p.transcript_path, 'utf8').trim().split(/\r?\n/).slice(-10);
      text = tail.map((l) => {
        try {
          const m = JSON.parse(l);
          const c = m.message && m.message.content;
          if (typeof c === 'string') return c;
          if (Array.isArray(c)) return c.map((x) => x && (x.text || x.content || '')).filter(Boolean).join(' ');
          return '';
        } catch (_) { return ''; }
      }).filter(Boolean).join('\n').slice(-4000);
    }
  } catch (_) {}
  if (!text) text = p.message || p.hook_event_name || 'session event';

  const body = JSON.stringify({
    agent: 'Claude Code',
    kind: kindHint || undefined,
    text,
    sessionId: p.session_id || null,
  });
  try {
    const lib = url.startsWith('https') ? require('https') : require('http');
    const req = lib.request(url, {
      method: 'POST',
      headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, token ? { Authorization: 'Bearer ' + token } : {}),
      timeout: 5000,
    }, (res) => { res.resume(); res.on('end', () => process.exit(0)); });
    req.on('error', () => process.exit(0));
    req.on('timeout', () => { try { req.destroy(); } catch (_) {} process.exit(0); });
    req.write(body); req.end();
  } catch (_) { process.exit(0); }
});
// safety: never hang Claude Code
setTimeout(() => process.exit(0), 6000).unref();
