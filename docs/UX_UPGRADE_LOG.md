# UX Upgrade Log

Round 1 evidence:

- Before report: `/tmp/anyagent-bridge-ux-round1/before-report.json`
- After report: `/tmp/anyagent-bridge-ux-round1/after-report.json`
- Before screenshots: `/tmp/anyagent-bridge-ux-round1/before-*.png`
- After screenshots: `/tmp/anyagent-bridge-ux-round1/after/*.png`

Scoring: impact and safety are 1-5. Priority is impact x safety.

| # | Finding | Impact | Safety | Priority | Status | Evidence |
|---|---|---:|---:|---:|---|---|
| 1 | Selecting a project did not create a project-scoped terminal before launching an agent. | 5 | 5 | 25 | Implemented | After `init` frame includes `projectPath`; `ready.projectPath` true. |
| 2 | Push notification URLs used `?session=...`, but the client ignored it. | 5 | 5 | 25 | Implemented | After deep-link `init.sessionId` true and URL cleaned. |
| 3 | Reloading the app could create a fresh terminal and drop unsent compose text. | 5 | 4 | 20 | Implemented | After desktop/mobile drafts restore after reload. |
| 4 | Mobile top-bar controls were below the 44px touch target target. | 4 | 5 | 20 | Implemented | Before: 29-30 small targets; after: 0 audited small targets at 320/390. |
| 5 | Mobile keybar controls were too short for thumb input. | 4 | 5 | 20 | Implemented | After key targets are 44px+ high. |
| 6 | Keybar controls were clickable divs without keyboard activation. | 3 | 5 | 15 | Implemented | Added role, tabindex, Enter/Space activation. |
| 7 | File explorer treated a path-whitelist 403 as auth failure and opened the login gate. | 4 | 4 | 16 | Implemented | Denied path now shows `Access denied: Path not allowed`; gate remains hidden. |
| 8 | Selected project was not remembered across reloads. | 3 | 5 | 15 | Implemented | Stored selected project path with safe localStorage helpers. |
| 9 | Image attachment path inserted into compose was not draft-persisted. | 3 | 5 | 15 | Implemented | Image path insert still passes and calls draft save. |
| 10 | Switching sessions could carry unsent text into the wrong session. | 4 | 4 | 16 | Implemented | Draft is saved before switch/new session and restored per session id. |
| 11 | The UI reports `connected` before the server `ready` frame. | 3 | 4 | 12 | Implemented | Round 3 changed socket-open status to `attaching...`; `connected` is set only after server `ready`. |
| 12 | The first-use terminal is visually empty; beginners get no safe next action. | 4 | 3 | 12 | Partially implemented | Round 4 added safe one-tap command chips (`pwd`, `ls`, `git status`, `whoami`) above the mobile input dock. |
| 13 | Mobile toolbar is usable but horizontally clipped; feature discovery still depends on swiping. | 3 | 4 | 12 | Backlog | After mobile screenshot shows `Connect` partially off-screen. |
| 14 | Session list can grow noisy with many unnamed sessions. | 3 | 4 | 12 | Backlog | Before test observed 38 session rows. |
| 15 | Agent trust prompts can dominate a 320px screen after launch. | 3 | 4 | 12 | Backlog | After 320 screenshot shows Claude trust prompt filling terminal. |
| 16 | Secrets modal expects `.env.local` 404 as normal, but the browser logs it as a failed resource. | 2 | 4 | 8 | Backlog | After report has expected `.env.local` 404. |
| 17 | CDN dependencies for xterm, QR, marked, and DOMPurify have no visible offline/failure fallback. | 4 | 2 | 8 | Backlog | Code inspection of external script/style URLs. |
| 18 | PWA manifest references PNG icons, while the client directory currently has only `icon.svg`. | 3 | 3 | 9 | Verified OK | Round 2 confirmed `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` are tracked and served with 200. |
| 19 | Reconnect/offline state can remain visually `connected` briefly after network loss. | 3 | 3 | 9 | Implemented | Round 3 desktop/mobile forced-offline tests show immediate `offline`, still `offline` after delay, then `connected` after online restore. |
| 20 | File creation, rename, and delete still rely on `prompt` / `confirm`, which is rough on mobile. | 3 | 3 | 9 | Backlog | Code inspection in file explorer handlers. |
| 21 | Notification settings are one-button only; there is no quiet/noise control. | 3 | 3 | 9 | Backlog | Code inspection of push setup. |
| 22 | Security visibility for local vs tunnel exposure is buried in the Connect-device modal. | 4 | 3 | 12 | Implemented | Round 2 added a persistent top-bar exposure badge: Local, Network, or Tunnel. |
| 23 | Markdown preview depends on runtime CDN loading. | 3 | 3 | 9 | Backlog | Code inspection of `loadMd()`. |
| 24 | Reduced-motion and animation preferences are not explicitly handled. | 2 | 4 | 8 | Backlog | CSS inspection. |
| 25 | There were no one-tap common command snippets for phone use. | 4 | 5 | 20 | Implemented | Round 4 quick command chips send via existing `sendToAgent`; all chips are 44px+ on mobile. |
| 26 | Compose had no local command history recall after sending. | 3 | 5 | 15 | Implemented | Round 4 adds in-memory per-session recall with ArrowUp/ArrowDown; nothing is persisted to storage. |
| 27 | Session rename/close used native `prompt`/`confirm` dialogs and tiny 18-20px row actions on mobile. | 4 | 5 | 20 | Implemented | Round 5 replaced them with inline rename and two-step close controls; row action buttons are 44px+ on mobile. |

Round 1 verification:

- `npm test`: 41 passed, 0 failed.
- Health: `GET /health` returned 200.
- Inline script parse: passed.
- Playwright desktop/mobile page errors: 0.
- Project session launch: `init.projectPath` and `ready.projectPath` observed.
- Notification deep link: `init.sessionId` observed from `?session=...`.
- Draft restore: desktop and mobile drafts restored after reload.
- Image attach: upload inserted an image path into compose.
- Regressions opened: Projects, Secrets, Files, Connect-device, Sessions.
- Mobile target audit: 0 audited controls under 44px at 320px and 390px.
- Server diff: empty.
- Secret scan: broad grep only found documented token references and deliberate redaction fixtures; diff scan only has normal token-handling code.

Round 2 evidence:

- Badge before state: no `#exposureBadge` in the top bar.
- Current localhost badge: `Local`, class `local`, 44px high on mobile and visible in the first mobile viewport.
- Mocked LAN badge: `Network`, class `lan`, 44px high on mobile.
- Mocked tunnel badge: `Tunnel`, class `tunnel`, 44px high on mobile.
- Badge rendering uses `textContent`, fixed class allowlist, and server-provided `/api/system/status` only.
- Browser page errors during targeted badge test: 0.
- Manifest/icon endpoints checked: `/manifest.webmanifest`, `/icon.svg`, `/icon-192.png`, `/icon-512.png`, and `/icon-maskable-512.png` returned 200.
- Explicit SVG favicon link added; browser page load produced 0 HTTP errors and 0 console errors in the targeted mobile check.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round2/full/`.

Round 3 evidence:

- Before focused offline probe: mobile status stayed `connected` immediately and after 900ms of browser offline.
- After focused offline probe: mobile status changed to `offline` immediately, stayed `offline` after 900ms, then returned to `connected` after online restore.
- Full desktop/mobile flow: desktop `offline` immediately and after 900ms; mobile `offline` immediately and after 500ms; both returned to `connected`.
- `connected` status is now assigned from the server `ready` frame, while WebSocket open shows `attaching...`.
- Flow coverage remained: project-scoped agent start, `sendToAgent`, image attach, special key frame, session switch, forced reconnect.
- Full flow page errors: desktop 0, mobile 0.
- Mobile/320/390 touch-target audit: 0 audited controls under 44px.
- Test cleanup returned the bridge to 37 sessions and 0 projects.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round3/full/`.

Round 4 evidence:

- Before focused input probe: no `#quickbar`, 0 quick command buttons, and ArrowUp recall left compose empty after sending.
- Added safe one-tap commands: `pwd`, `ls`, `git status`, `whoami`.
- Focused input probe: tapping `pwd` emitted `sendToAgent: "pwd"`; sending `echo HISTORY_ONE` then ArrowUp/ArrowDown recalled history in order and returned to blank.
- Sent command history is in-memory only and per session; it is not written to localStorage.
- Full desktop/mobile flow: quick commands and manual sends emitted expected `sendToAgent` frames on both desktop and mobile.
- Flow coverage remained: project-scoped agent start, image attach, special key frame, session switch, forced reconnect.
- Full flow page errors: desktop 0, mobile 0.
- Quick command touch targets: `pwd`, `ls`, `git status`, and `whoami` were all 44px+ on mobile.
- Mobile/320/390 touch-target audit: 0 audited controls under 44px.
- Test cleanup returned the bridge to 37 sessions and 0 projects.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round4/full/`.

Round 5 evidence:

- Before focused sessions probe: Sessions had 38 rows; rename opened a native `prompt`, close opened a native `confirm`, and row action buttons measured 18-20px with no `aria-label`.
- Replaced session rename with an inline input and Save/Cancel buttons inside the row.
- Replaced session close with an inline two-step Close/Keep confirmation inside the row, so tapping the `x` alone does not terminate a terminal.
- Session row action buttons now carry `aria-label`s and mobile touch targets are 44px+.
- Focused after probe: zero native dialogs, zero page errors, inline rename saved `AAB R5`, Keep preserved the row, second-step Close deleted only the temp session, and current badge measured 51x24.
- Full desktop/mobile flow: project-scoped agent start, quick/manual send frames, image attach, special key, session switch, forced reconnect, Projects/Secrets/Files/Connect/Sessions modals all passed.
- Full flow page errors: desktop 0, mobile 0; mobile native dialogs: 0.
- Mobile/320/390 user-control touch-target audit: 0 audited controls under 44px.
- Mobile session row action audit: 0 controls under 44px and 0 missing `aria-label`s.
- Test cleanup returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round5/full/`.
