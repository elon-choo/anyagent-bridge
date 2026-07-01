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
| 12 | The first-use terminal is visually empty; beginners get no safe next action. | 4 | 3 | 12 | Implemented | Round 18 adds a fresh-session starter panel inside the terminal with Start agent plus safe `pwd`, `ls`, and `git status` actions; mobile starter buttons are 44px+ and first command sends in one tap. |
| 13 | Mobile toolbar is usable but horizontally clipped; feature discovery still depends on swiping. | 3 | 4 | 12 | Implemented | Round 6 wraps the mobile toolbar into ordered rows so all primary controls are visible without horizontal scrolling. |
| 14 | Session list can grow noisy with many unnamed sessions. | 3 | 4 | 12 | Implemented | Round 8 added search/count, current/recent-first ordering, and activity hints; filter test narrowed 37 rows to 1. |
| 15 | Agent trust prompts can dominate a 320px screen after launch. | 3 | 4 | 12 | Implemented | Round 17 adds a compact mobile launch assist that keeps Enter/Esc/arrows visible and raises 320px terminal height from 293px to 354px after agent start. |
| 16 | Secrets modal expects `.env.local` 404 as normal, but the browser logs it as a failed resource. | 2 | 4 | 8 | Implemented | Round 9 probes the hidden file path with a 200 JSON endpoint before reading; missing/existing file tests produced console errors 0. |
| 17 | CDN dependencies for xterm, QR, marked, and DOMPurify have no visible offline/failure fallback. | 4 | 2 | 8 | Implemented | Round 10 added visible fallbacks for terminal runtime, QR generation, and markdown preview libraries; blocked-CDN probes had page errors 0. |
| 18 | PWA manifest references PNG icons, while the client directory currently has only `icon.svg`. | 3 | 3 | 9 | Verified OK | Round 2 confirmed `icon-192.png`, `icon-512.png`, and `icon-maskable-512.png` are tracked and served with 200. |
| 19 | Reconnect/offline state can remain visually `connected` briefly after network loss. | 3 | 3 | 9 | Implemented | Round 3 desktop/mobile forced-offline tests show immediate `offline`, still `offline` after delay, then `connected` after online restore. |
| 20 | File creation, rename, and delete still rely on `prompt` / `confirm`, which is rough on mobile. | 3 | 3 | 9 | Implemented | Round 7 replaces file create/folder/rename/delete dialogs with an in-app action sheet and makes row actions visible 44px+ targets on mobile. |
| 21 | Notification settings are one-button only; there is no quiet/noise control. | 3 | 3 | 9 | Implemented | Round 16 adds a notification settings modal with All, Important, Quiet, and Paused modes enforced by the service worker per device. |
| 22 | Security visibility for local vs tunnel exposure is buried in the Connect-device modal. | 4 | 3 | 12 | Implemented | Round 2 added a persistent top-bar exposure badge: Local, Network, or Tunnel. |
| 23 | Markdown preview depends on runtime CDN loading. | 3 | 3 | 9 | Implemented | Round 10 falls back to raw Markdown with an inline warning when marked/DOMPurify cannot load. |
| 24 | Reduced-motion and animation preferences are not explicitly handled. | 2 | 4 | 8 | Implemented | Round 13 adds a `prefers-reduced-motion: reduce` CSS override; focused after test measured button/toast transitions at `0s`. |
| 25 | There were no one-tap common command snippets for phone use. | 4 | 5 | 20 | Implemented | Round 4 quick command chips send via existing `sendToAgent`; all chips are 44px+ on mobile. |
| 26 | Compose had no local command history recall after sending. | 3 | 5 | 15 | Implemented | Round 4 adds in-memory per-session recall with ArrowUp/ArrowDown; nothing is persisted to storage. |
| 27 | Session rename/close used native `prompt`/`confirm` dialogs and tiny 18-20px row actions on mobile. | 4 | 5 | 20 | Implemented | Round 5 replaced them with inline rename and two-step close controls; row action buttons are 44px+ on mobile. |
| 28 | Markdown Preview mode was hidden on mobile by the small-screen file explorer CSS. | 3 | 5 | 15 | Implemented | Round 10 adds a mobile preview mode that hides the tree and shows the preview pane full-width. |
| 29 | File editor still used native dialogs for dirty-file close/switch, overwrite after a file changed on disk, and file errors. | 4 | 5 | 20 | Implemented | Round 11 routes dirty/discard, overwrite, and file-error states through the in-app file action sheet; native dialogs 0 in focused test. |
| 30 | Notification setup failures used native browser alerts and had no accessible in-app status. | 4 | 5 | 20 | Implemented | Round 12 routes permission/VAPID/subscribe/setup results through the shared toast; denied-permission focused test had native dialogs 0. |
| 31 | Major overlays looked modal but lacked dialog semantics and left focus on toolbar buttons behind them. | 3 | 5 | 15 | Implemented | Round 14 adds dialog/label/modal ARIA wiring and initial focus for Connect, Projects, Secrets, Files, file actions, and Sessions. |
| 32 | Modal focus could still escape with Tab, and closing overlays did not restore focus to the opener. | 3 | 5 | 15 | Implemented | Round 15 adds shared modal focus containment and opener restoration for Connect, Projects, Secrets, Files, file actions, and Sessions. |
| 33 | The public landing was not tracked in this repo and did not reflect the latest mobile starter, launch assist, and quiet notification work. | 4 | 3 | 12 | Implemented | Round 19 adds a tracked static landing under `public/` and deploys it to `https://anyagent-bridge.vercel.app`; production audit passed at 1440, 390, and 320 widths. |
| 34 | Final evidence was scattered across many round reports, and the real-phone smoke still needed an explicit checklist. | 4 | 5 | 20 | Implemented | Round 20 adds `docs/FINAL_UX_AUDIT.md`, a consolidated final acceptance report, and a 30-minute physical-phone smoke checklist. |
| 35 | The physical-phone smoke checklist still lacked a fillable evidence artifact for recording pass/fail, device, network, cleanup, and failures. | 3 | 5 | 15 | Implemented | Round 21 adds `docs/PHONE_SMOKE_REPORT_TEMPLATE.md` and links it from the final audit. |
| 36 | Final automated acceptance lived only under `/tmp`, making future revalidation hard. | 4 | 5 | 20 | Implemented | Round 22 adds `test/final-ux-acceptance.js` plus `npm run test:ux-final`, covering local desktop/mobile, optional funnel, optional landing, modal focus, PWA endpoints, and cleanup. |
| 37 | The remaining physical-phone smoke could start with stale tunnel/API/PWA state and waste the tester's first minutes. | 3 | 5 | 15 | Implemented | Round 23 adds `test/phone-smoke-preflight.js` plus `npm run test:phone-preflight`, producing a redacted readiness report before the real phone run. |
| 38 | The tracked final acceptance still did not deeply exercise the mobile Files editor/Markdown preview path required by the phone smoke. | 4 | 5 | 20 | Implemented | Round 24 adds a 390px mobile Files preview flow to `test/final-ux-acceptance.js` and raises mobile Files editbar/mode controls to touch-safe dimensions. |
| 39 | The tracked final acceptance still only implied Sessions coverage through modal accessibility, leaving new-session and switch-back behavior easy to regress. | 4 | 5 | 20 | Implemented | Round 25 adds a desktop Sessions flow to `test/final-ux-acceptance.js`: create a second session from the modal, run a command there, switch back to the first session, verify original output, and clean all temp sessions. |
| 40 | The tracked final acceptance still did not prove unsent compose/image drafts stay isolated while switching sessions. | 5 | 5 | 25 | Implemented | Round 26 extends the desktop Sessions flow to verify the first session's uploaded image draft restores, a new session starts clean, and the second session's unsent draft restores only in that second session. |
| 41 | The tracked final acceptance still accepted mobile toolbar controls below the stated 44px phone target. | 4 | 5 | 20 | Implemented | Round 27 tightens `test/final-ux-acceptance.js` so local 320px and funnel 390px toolbar controls must all measure 44x44 or larger. |
| 42 | Phone landscape width bypassed the mobile touch-target rules, making toolbar and dock controls as short as 15-35px at 844x390. | 4 | 5 | 20 | Implemented | Round 28 applies mobile touch rules to short landscape viewports and adds a tracked 844x390 landscape flow to final acceptance. |
| 43 | The tracked final acceptance did not prove the compose/send path remains reachable when a phone soft keyboard shrinks the viewport. | 5 | 5 | 25 | Implemented | Round 29 adds a 390px mobile keyboard-shrink flow that focuses compose, shrinks the viewport to 560px high, verifies input/send visibility and 44px controls, sends a command, and cleans the session. |
| 44 | The tracked final acceptance did not prove the physical-smoke notification step: switching Quiet and back to Important with persistence on mobile. | 4 | 5 | 20 | Implemented | Round 30 adds a 390px mobile Notifications flow that switches Quiet, verifies it after reopening, switches Important, verifies it after reopening, and checks 44px+ mode controls. |
| 45 | The tracked final acceptance did not prove simultaneous multi-viewer control: a second browser deep-linking to an existing session and both viewers receiving output. | 5 | 5 | 25 | Implemented | Round 31 adds a two-context multi-viewer flow: secondary opens `?session=<id>`, attaches to the same session, sends `echo FINAL_MULTIVIEW`, and both viewers see output. |
| 46 | Reconnecting while scrolled up in terminal history jumped the user back to the top of server replayed scrollback. | 5 | 5 | 25 | Implemented | Round 32 captures the xterm viewport before unintended reconnects, restores it after same-session replay, and adds final acceptance that preserves `scrollTop` and visible rows across offline/online. |

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

Round 6 evidence:

- Before focused toolbar probe: at 320px only `Local` was fully visible; Start, Connect, Projects, Secrets, Files, Notifications, Sessions, keyboard toggle, and status were off-screen in a 1106px horizontal toolbar.
- Changed the mobile toolbar from one horizontal scroller to wrapped ordered rows, keeping title/exposure/status first and all app actions visible without swiping.
- Shortened the Connect button label to `📱 Connect` while preserving the full title text.
- Focused after probe: 320px and 390px toolbar scroll width equals client width, overflow is visible, off-screen controls: 0, partial controls: 0, small targets: 0, page errors: 0.
- Full desktop/mobile flow: project-scoped agent start, quick/manual send frames, image attach, special key, session switch, forced reconnect, Projects/Secrets/Files/Connect/Sessions modals all passed.
- Full flow page errors: desktop 0, mobile 0; mobile native dialogs: 0.
- Full 320/390/mobile user-control touch-target audit: 0 audited controls under 44px.
- Full flow toolbar hidden controls: 0 at 320px, 390px, and mobile; with a selected project the toolbar measured 261px at 320px and 211px at 390px/mobile.
- Test cleanup returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round6/full/`.

Round 7 evidence:

- Before focused Files probe: New file, New folder, Rename, and Delete produced native `prompt`/`confirm` dialogs; file row actions measured 15-19px, had opacity 0 on touch, and had no `aria-label`.
- Replaced those file actions with an in-app dialog/action sheet and filename validation that rejects empty names, `.` / `..`, and slashes.
- File row Rename/Delete actions now carry `aria-label`s and are visible 44px+ targets on mobile.
- Focused after probe: native dialogs 0, page errors 0, slash validation message shown, file/folder creation succeeded on disk, rename moved the file, row delete removed the file, and cleanup returned to 37 sessions.
- Full desktop/mobile flow: project-scoped agent start, quick/manual send frames, image attach, special key, session switch, forced reconnect, Projects/Secrets/Files/Connect/Sessions modals all passed.
- Full flow page errors: desktop 0, mobile 0; mobile native dialogs: 0.
- Mobile file row action audit: 0 controls under 44px, 0 missing `aria-label`s, and action opacity was `1` on touch.
- Full 320/390/mobile user-control touch-target audit: 0 audited controls under 44px.
- Test cleanup returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round7/full/`.

Round 8 evidence:

- Before focused Sessions probe: 37 rows, no `#sxFilter`, no count, and the current attached session was buried below older unnamed sessions.
- Added a search/count row to the Sessions modal, sorted the current session first and recent sessions next, and added compact activity hints from `lastActivity`.
- Focused after probe: desktop/mobile page errors 0, native dialogs 0, current session 39 rendered first, mobile search input measured 44px tall, search for `39` narrowed 37 rows to 1, no-match showed `No matching sessions.`, closing/reopening reset the filter to all 37 rows, and session count stayed 37.
- Full desktop/mobile flow: project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, and session filter reset all passed.
- Full flow page errors: desktop 0, mobile 0; mobile native dialogs: 0.
- Full 320/390 user-control touch-target audit: 0 audited controls under 44px; toolbar hidden controls: 0; horizontal document overflow: 0.
- Test cleanup removed temp sessions 111 and 112 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round8/full/`.

Round 9 evidence:

- Before focused Secrets probe: opening a project with no `.env.local` showed the correct empty editable UI, but the browser logged `Failed to load resource: the server responded with a status of 404 (Not Found)`.
- Changed Secrets loading to probe the exact hidden `.env.local` path through `/api/explorer/tree` first. Missing files now resolve through a 200 JSON response; existing files still use `/api/explorer/read` only after the probe proves a file is present.
- Focused after probe: missing `.env.local` produced page errors 0, console errors 0, `/api/explorer/tree` 200, no read 404, editable empty state, and Save wrote `AAB_R9_KEY=alpha`.
- Existing `.env.local` probe: page errors 0, console errors 0, `/api/explorer/tree` 200, `/api/explorer/read` 200, one masked `SAFE_KEY` row rendered, and file contents stayed `SAFE_KEY=alpha`.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, and missing-env Secrets state all passed.
- Full 320/390 user-control touch-target audit: 0 audited controls under 44px; toolbar hidden controls: 0; horizontal document overflow: 0.
- Test cleanup removed temp sessions 115 and 116 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round9/full/`.

Round 10 evidence:

- Before focused CDN probe: blocking jsDelivr made the app hide the login gate, leave the terminal blank, show `disconnected`, and raise `Terminal is not defined`; there was no visible fallback.
- Added a dependency alert for missing terminal runtime/style assets and guarded session startup so a missing xterm bundle does not open a WebSocket or create a session.
- Added QR fallback text in the Connect-device modal when `qrcodejs` cannot load.
- Added markdown preview fallback text and raw Markdown rendering when `marked` or `DOMPurify` cannot load.
- Found and fixed an additional mobile issue: Preview mode was hidden below 760px; mobile Preview now hides the tree and shows the preview pane.
- Focused terminal CDN-blocked probe: page errors 0, visible dependency alert, status `terminal unavailable`, WebSocket opens 0, and session count stayed 37.
- Focused QR-blocked probe: page errors 0, visible `QR unavailable` fallback in the modal, and session count stayed 37.
- Focused Markdown-blocked probe: page errors 0, visible fallback note, raw Markdown rendered, preview pane visible on mobile, and session count stayed 37.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, dependency alert hidden on normal load, project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, and normal Markdown preview rendering all passed.
- Normal Markdown preview rendered `Round 10` and `preview fallback`; on mobile the file tree was hidden and the preview pane was visible.
- Full 320/390 user-control touch-target audit: 0 audited controls under 44px; toolbar hidden controls: 0; horizontal document overflow: 0.
- Test cleanup removed temp sessions 119 and 120 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round10/full/`.

Round 11 evidence:

- Before focused Files probe: dirty close, dirty switch, and overwrite after a file changed on disk each opened a native `confirm`; the file action sheet stayed closed.
- Replaced dirty-file discard prompts, overwrite after a file changed on disk, and file-operation errors with the existing in-app file action sheet.
- Focused after probe: native dialogs 0, page errors 0, close/switch/conflict sheets rendered with `Discard`/`Overwrite`, cancel preserved the dirty file, confirm switched files, overwrite saved `alpha user version`, and final discard closed Files.
- Focused cleanup returned the bridge to 37 sessions.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, and dirty-file sheets all passed.
- Full 320/390 user-control touch-target audit: 0 audited controls under 44px; toolbar hidden controls: 0; horizontal document overflow: 0.
- Test cleanup removed temp sessions 121 and 122 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round11/full/`.

Round 12 evidence:

- Before focused notification probe: denied permission opened a native `alert`, the toast stayed empty, page errors 0, attached to existing session 39.
- Moved the toast helper to shared script scope, made the toast an ARIA live status, and routed notification permission/VAPID/key/subscribe/setup success or failure through it while disabling the button only during setup.
- Focused after probe: denied permission produced native dialogs 0, page errors 0, assertive error toast, restored `🔔 알림` button, and no new session.
- Code scan after the change: `client/index.html` has no remaining native `alert`, `confirm`, or `prompt` calls.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, Files tree open, and notification denied toast all passed.
- Full 320/390 user-control touch-target audit with notification toast visible: 0 audited controls under 44px; toolbar hidden controls: 0; horizontal document overflow: 0; native dialogs 0.
- Test cleanup removed temp sessions 137, 138, 139, 140, 141, and 142 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round12/full/`.

Round 13 evidence:

- Before focused reduced-motion probe: browser matched `prefers-reduced-motion: reduce`, but Start button transitions were `0.15s, 0.15s`, toast transitions were `0.2s, 0.2s`, and the visible toast still had a vertical translate offset.
- Added a client-only `prefers-reduced-motion: reduce` CSS override that zeroes transition delay/duration, minimizes animation duration/iterations, keeps scroll behavior automatic, and removes the toast slide offset.
- Focused after probe: button transition duration `0s`, toast transition duration `0s`, toast transform vertical offset `0`, page errors 0, native dialogs 0, and session count stayed 37.
- Full desktop/mobile flow under reduced-motion emulation: page errors 0, console errors 0, native dialogs 0, project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, Files tree open, and notification denied toast all passed.
- Full 320/390 reduced-motion audit: button/toast transition durations `0s`, toast vertical offset 0, 0 audited controls under 44px, toolbar hidden controls 0, horizontal document overflow 0, native dialogs 0.
- Test cleanup removed temp sessions 143, 144, 145, 146, 147, and 148 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round13/full/`.

Round 14 evidence:

- Before focused modal accessibility probe: Connect, Projects, Secrets, Files, file action sheet, and Sessions had no `role`, no `aria-modal`, no label wiring, and focus stayed on the toolbar button behind each opened overlay.
- Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and descriptions where useful for Connect, Projects, Secrets, Files, file actions, and Sessions.
- Opening Connect, Projects, Secrets, and Files now moves focus to the modal close button; opening Sessions moves focus to search; file actions continue to focus the input/OK control.
- Focused after probe: all six overlays were named modal dialogs, focus was inside each dialog, page errors 0, native dialogs 0, and session count stayed 37.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, project-scoped agent start, manual `sendToAgent`, image attach, Tab special key, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, file action dialog, and notification denied toast all passed.
- Full 320/390 audit: Connect dialog role/label/focus verified, 0 audited controls under 44px, toolbar hidden controls 0, horizontal document overflow 0, native dialogs 0.
- Test cleanup removed temp sessions 149, 150, 151, 152, 153, and 154 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round14/full/`.

Round 15 evidence:

- Before focused modal focus probe: Shift+Tab from Connect close escaped to `composeSend`, closing Connect/Sessions/Files left focus on the document, and Shift+Tab from file-action input escaped to the Files delete button.
- Added a shared modal focus helper that records the opener, moves focus into the dialog on open, traps Tab/Shift+Tab in the topmost open dialog, keeps nested file-action prompts contained, and restores focus to the opener on close.
- Focused after probe: Connect Shift+Tab stayed inside and close restored `connectBtn`; Sessions Tab loop stayed inside and close restored `sessBtn`; file-action Shift+Tab stayed inside `fxDialog`, cancel restored `fxNewFile`, and closing Files restored `filesBtn`.
- Focused after report/screenshot: `/tmp/anyagent-bridge-ux-round15/after/focus-report.json`, `/tmp/anyagent-bridge-ux-round15/after/focus-after.png`.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, real `startAgent`, `sendToAgent`, and raw `input` WebSocket frames, image attach, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, nested file action dialog, and notification-control visibility all passed.
- Full 320/390/1440 audit: horizontal document overflow 0, 320px page errors 0, 390px page errors 0, desktop page errors 0.
- Test cleanup removed temp sessions 163 and 164 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round15/full/`.

Round 16 evidence:

- Before focused notification probe: the notification button opened no modal, rendered 0 mode controls, and clicking it went straight into permission setup before showing only a toast on denial.
- Added a Notifications dialog with four per-device modes: All updates, Important, Quiet, and Paused.
- The selected mode is saved in `localStorage`, synced to the service worker, and enforced at push-display time: Important suppresses progress, Quiet suppresses progress/done, and Paused suppresses all bridge notifications on that device.
- Focused after probe: page errors 0, console errors 0, native dialogs 0, four mode controls at 51px tall on mobile, focus inside on open and restored to `notifBtn` on close, Quiet persisted, and service-worker checks showed progress/done suppressed while questions still display.
- Focused reports/screenshots: `/tmp/anyagent-bridge-ux-round16/before/report.json`, `/tmp/anyagent-bridge-ux-round16/after/report.json`, `/tmp/anyagent-bridge-ux-round16/after/notification-settings.png`.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, real `startAgent`, `sendToAgent`, and raw `input` WebSocket frames, image attach, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, notification mode sync, and service-worker Important filtering all passed.
- Full 320px notification modal audit: horizontal document overflow 0, page errors 0, console errors 0, four mode controls, all 51px tall.
- Test cleanup removed temp sessions 165 and 166 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round16/full/`.

Round 17 evidence:

- Before focused 320px agent launch probe: after starting Claude, the toolbar was 211px tall, the dock was 216px tall, the terminal had only 293px, and the trust prompt showed `Enter to confirm · Esc to cancel` while Enter was hidden off-screen in the full keybar.
- Added a compact mobile launch assist that appears when `startAgent` is sent, hides the quickbar/full keybar, and exposes visible 44px controls for Enter, Esc, Up, Down, Ctrl-C, show all keys, and hide.
- Focused after probe: page errors 0, console errors 0, native dialogs 0, `startAgent` observed, Esc assist button emitted an `input` frame, quickbar/keybar hidden, agentbar visible, all assist controls 44px+, 320px terminal height increased to 354px, horizontal overflow 0, and cleanup returned the bridge to 37 sessions.
- Focused reports/screenshots: `/tmp/anyagent-bridge-ux-round17/before/report.json`, `/tmp/anyagent-bridge-ux-round17/before/agent-launch-320.png`, `/tmp/anyagent-bridge-ux-round17/after/report.json`, `/tmp/anyagent-bridge-ux-round17/after/agent-launch-assist-320.png`.
- Full desktop/mobile flow: page errors 0, console errors 0, native dialogs 0, real `startAgent`, `sendToAgent`, and raw `input` WebSocket frames, image attach, session switch, forced offline/online reconnect, Projects/Secrets/Files/Connect/Sessions modals, notification mode sync, and service-worker Important filtering all passed.
- Full 320px real Start audit: horizontal document overflow 0, page errors 0, console errors 0, `startAgent` observed, compact assist visible, quickbar/keybar hidden, terminal height 354px, and all assist controls 44px+.
- Test cleanup removed temp sessions 171, 172, and 173 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round17/full/`.

Round 18 evidence:

- Before focused fresh-mobile probe: a new session showed only the shell prompt in the terminal, `#starterPanel` did not exist, and safe commands were available only down in the dock quickbar.
- Added a fresh-session starter panel inside the terminal with `Start Claude Code`, `pwd`, `ls`, `git status`, and hide controls; it appears only on non-reconnect `ready` frames and hides after successful command send or agent start.
- Focused after probe at 390x844: page errors 0, console errors 0, native dialogs 0, starter visible, horizontal overflow 0, buttons measured `Start Claude Code` 130x44, `pwd` 44x44, `ls` 44x44, `git status` 73x44, hide 44x44, `pwd` emitted one `sendToAgent` frame, output included `/Users/elon`, and cleanup returned the bridge to 37 sessions.
- Focused reports/screenshots: `/tmp/anyagent-bridge-ux-round18/before/report.json`, `/tmp/anyagent-bridge-ux-round18/before/fresh-mobile.png`, `/tmp/anyagent-bridge-ux-round18/after2/report.json`, `/tmp/anyagent-bridge-ux-round18/after2/fresh-starter-open.png`, `/tmp/anyagent-bridge-ux-round18/after2/fresh-starter-after-command.png`.
- Full desktop/mobile flow: health 200, page errors 0, console errors 0, native dialogs 0, desktop starter/compose/image attach/Esc key/session filter/new session/switch back/offline-online reconnect passed; 320px mobile starter `pwd`, real `startAgent`, launch assist Esc and Ctrl-C input frames, and 44px+ starter/assist controls passed.
- Test cleanup removed temp sessions 183, 184, and 185 and returned the bridge to 37 sessions.
- Full flow report/screenshots: `/tmp/anyagent-bridge-ux-round18/full/`.

Round 19 evidence:

- Before landing probe: `https://anyagent-bridge.vercel.app` served a 3,690,014-byte single HTML page from deployment `dpl_Awv8UTqKmiNjvrX5FymXarTX8Zh9`, and the package repo had no tracked landing source.
- Added a tracked static landing under `public/` with actual app screenshots, updated copy for fresh starter, 320px mobile controls, launch assist, quiet notification modes, sessions, Projects/Secrets/Files, exposure badge, and local-first security.
- Local static audit: `/tmp/anyagent-bridge-ux-round19/landing-local/report.json` passed for 1440x900, 390x844, and 320x720 with page errors 0, console errors 0, failed requests 0, horizontal overflow 0, all images loaded, all CTA targets 40px+ high, and next-section hint visible in the first viewport.
- Deployed via Vercel prebuilt production deploy to `dpl_5qcfgheMgkPSMzWnatvVAC5SDgaB`; alias `https://anyagent-bridge.vercel.app` returned 200 with 20,189-byte HTML and screenshot endpoints returned 200.
- Production Playwright audit: `/tmp/anyagent-bridge-ux-round19/landing-production/report.json` passed at 1440, 390, and 320 widths with page errors 0, console errors 0, failed requests 0, all images loaded, no horizontal overflow, touch-safe CTAs, and content markers for starter, Quiet, launch assist, and Node 18+.

Round 20 evidence:

- Ran final current-state acceptance against the local app, Tailscale funnel, production landing, modal focus behavior, and PWA endpoints.
- Consolidated acceptance: `/tmp/anyagent-bridge-final-audit/final-acceptance-summary.json` passed with page errors 0, console errors 0, native dialogs 0, request failures 0, local desktop/mobile checks true, funnel mobile checks true, production landing checks true, and modal focus checks true.
- Broad acceptance report: `/tmp/anyagent-bridge-final-audit/final-acceptance-report.json`; modal focus timing confirmation: `/tmp/anyagent-bridge-final-audit/modal-focus-report.json`; PWA endpoint report: `/tmp/anyagent-bridge-final-audit/pwa-endpoints-report.json`.
- Local desktop final run verified fresh starter, `sendToAgent`, output, image attach, Esc input, six major modals, and offline/online reconnect.
- Local 320px final run verified one-tap starter `pwd`, no horizontal overflow, toolbar/starter touch safety, real `startAgent`, launch assist, Esc, and Ctrl-C.
- Tailscale funnel 390px final run verified external reachability, fresh starter, one-tap `pwd`, output, and no horizontal overflow.
- Temp sessions 186, 187, 188, and 189 were deleted; session count returned to 37.
- Added final audit and physical-phone smoke checklist: `docs/FINAL_UX_AUDIT.md`.

Round 21 evidence:

- Added a fillable physical-phone smoke report template: `docs/PHONE_SMOKE_REPORT_TEMPLATE.md`.
- The template captures phone model, OS/browser, network path, 20 step results, failure severity, evidence paths, temporary session ids, cleanup result, and final verdict.
- Linked the template from `docs/FINAL_UX_AUDIT.md` so the remaining real-phone verification produces a concrete audit artifact.

Round 22 evidence:

- Added a tracked final UX acceptance runner: `test/final-ux-acceptance.js`.
- Added `npm run test:ux-final` as an opt-in command, separate from the zero-dependency `npm test` suite.
- The runner covers local desktop 1440px, local mobile 320px, optional Tailscale funnel mobile 390px, optional production landing 1440/390/320px, modal semantics/focus restoration, PWA endpoints, and temporary session cleanup.
- Reports are written to `/tmp/anyagent-bridge-final-audit/final-ux-acceptance-report.json` and `/tmp/anyagent-bridge-final-audit/final-ux-acceptance-summary.json`.

Round 23 evidence:

- Added a tracked physical-phone smoke preflight runner: `test/phone-smoke-preflight.js`.
- Added `npm run test:phone-preflight` as a zero-dependency check before the human phone smoke.
- The preflight verifies local health, local authenticated sessions/system APIs, local PWA endpoints, Tailscale Funnel health, Funnel authenticated sessions/system APIs, local/funnel session count consistency, and that the check itself does not create sessions.
- Reports are written to `/tmp/anyagent-bridge-phone-smoke/phone-smoke-preflight-report.json`.

Round 24 evidence:

- Added a 390px mobile Files workflow to `test/final-ux-acceptance.js`.
- The runner now creates a temporary project and Markdown fixture under ignored `uploads/`, opens it through the real Files UI, switches to Preview, verifies no horizontal overflow, verifies Markdown preview text is visible, verifies injected script markup does not execute, and cleans up the project and fixture.
- Fixed the mobile Files editbar touch targets: mode buttons and icon-only Save/download/rename/delete controls now measure 44px+ in the acceptance report.
- Latest acceptance report: `/tmp/anyagent-bridge-final-audit/final-ux-acceptance-report.json`; screenshot: `/tmp/anyagent-bridge-final-audit/local-mobile-files-preview.png`.

Round 25 evidence:

- Added a desktop Sessions workflow to `test/final-ux-acceptance.js`.
- The runner now opens Sessions, verifies the current row, creates a new session from `New session`, observes a different `ready` session id, sends `echo FINAL_SWITCH_SECOND`, opens Sessions again, switches back to the original session row, and verifies `FINAL_DESKTOP` output returns.
- Latest `npm run test:ux-final` passed with `localDesktop.sessionSwitch: true`.
- Temporary sessions 231, 232, 233, 234, and 235 were deleted; session count returned from 37 to 37.

Round 26 evidence:

- Extended the desktop Sessions workflow in `test/final-ux-acceptance.js` to assert per-session compose draft isolation.
- The runner now verifies the first session's uploaded `pixel.png` compose draft survives switching away and back, the new second session starts with an empty compose box, and a typed-but-unsent second-session draft restores only when returning to that second session.
- Latest `npm run test:ux-final` passed with `localDesktop.sessionSwitch: true` and `localDesktop.draftIsolation: true`.
- Temporary sessions 236, 237, 238, 239, and 240 were deleted; session count returned from 37 to 37.

Round 27 evidence:

- Tightened `test/final-ux-acceptance.js` from `toolbarTouchSafe40` to `toolbarTouchSafe44`.
- The final acceptance runner now fails if any visible local 320px or funnel 390px toolbar control is below 44px wide or 44px high.
- Latest `npm run test:ux-final` passed with `localMobile320.toolbarTouch: true` and `funnelMobile390.toolbarTouch: true`; measured toolbar controls were all 44px+.
- Temporary sessions 241, 242, 243, 244, and 245 were deleted; session count returned from 37 to 37.

Round 28 evidence:

- Focused landscape probe before the fix at 844x390 found no horizontal overflow and one-tap `pwd` worked, but toolbar controls measured only 15-35px high.
- Extended the mobile CSS media rules to also apply at `max-width: 900px` and `max-height: 520px`, covering phone landscape without changing server behavior.
- Added `localMobileLandscape844` to `test/final-ux-acceptance.js`.
- Latest `npm run test:ux-final` passed with `localMobileLandscape844.toolbarTouch: true`, `oneTapFirstCommand: true`, `noOverflow: true`, and `terminalUsable: true`; the landscape terminal measured 844x96 and every visible toolbar control measured 44px+.
- Temporary sessions 247, 248, 249, 250, 251, and 252 were deleted; session count returned from 37 to 37.

Round 29 evidence:

- Added `localMobileKeyboard390` to `test/final-ux-acceptance.js`.
- The runner now focuses the compose box at 390x844, shrinks the mobile viewport to 390x560 to model soft-keyboard pressure, verifies compose and Send remain inside the viewport, verifies visible dock controls remain 44px+, sends `echo KEYBOARD_PROBE`, and verifies output.
- Latest `npm run test:ux-final` passed with `localMobileKeyboard390.focusedBeforeShrink`, `viewportShrank`, `composeVisible`, `sendVisible`, `controlsTouch`, `noOverflow`, `terminalUsable`, `sendToAgent`, and `outputSeen` all true.
- In the shrink state, the terminal measured 390x216, compose input measured 250x44, Send measured 66x44, and all visible dock controls measured 44px+.
- Temporary sessions 254, 255, 256, 257, 258, 259, and 260 were deleted; session count returned from 37 to 37.

Round 30 evidence:

- Added `localMobileNotifications390` to `test/final-ux-acceptance.js`.
- The runner now opens the mobile Notifications dialog, switches to Quiet, closes and reopens to verify Quiet persists, switches to Important, closes and reopens to verify Important persists, and captures a mobile screenshot.
- Latest `npm run test:ux-final` passed with `localMobileNotifications390.quietSelected`, `quietPersists`, `importantSelected`, `importantPersists`, `singleActiveMode`, `touchSafe`, and `noOverflow` all true.
- The notification mode buttons measured 308x51 at 390px width, and only one `role="radio"` option was active after each mode change.
- Temporary sessions 269, 270, 271, 272, 273, 274, 275, and 276 were deleted; session count returned from 37 to 37.

Round 31 evidence:

- Added `localMultiViewer` to `test/final-ux-acceptance.js`.
- The runner now opens a primary desktop view, deep-links a secondary browser context with `?session=<id>`, verifies the secondary attaches to the same session and cleans the URL, sends `echo FINAL_MULTIVIEW` from the secondary compose box, and verifies both viewers render the output with no horizontal overflow.
- Latest `npm run test:ux-final` passed with `localMultiViewer.sameSession`, `secondaryReconnect`, `secondaryUrlCleaned`, `secondaryNoStarter`, `secondarySendToAgent`, `primarySawOutput`, `secondarySawOutput`, and `noOverflow` all true.
- The primary and secondary viewers both attached to session 280; screenshots were written to `/tmp/anyagent-bridge-final-audit/local-multiviewer-primary.png` and `/tmp/anyagent-bridge-final-audit/local-multiviewer-secondary.png`.
- Temporary sessions 277, 278, 279, 280, 281, 282, 283, 284, and 285 were deleted; session count returned from 37 to 37.

Round 32 evidence:

- Focused before probe: after generating 140 terminal lines and scrolling up, offline/online reconnect changed the visible replay position from `scrollTop: 536` to `scrollTop: 0`; screenshots were written under `/tmp/anyagent-bridge-ux-round32-before/`.
- Added client-side same-session terminal viewport capture/restore around unintended reconnects; intentional reset/new-session reconnects still clear the pending restore.
- Extended `test/final-ux-acceptance.js` so the local desktop flow generates long scrollback, scrolls to a mid-history viewport, forces offline/online, and fails unless `scrollTop` and the first visible row are preserved.
- Latest `npm run test:ux-final` passed with `localDesktop.scrollPositionPreserved: true`; the scroll snapshot stayed `scrollTop: 548` before and after reconnect, with top row `FINAL_SCROLL_33` before and after.
- Temporary sessions 298, 299, 300, 301, 302, 303, 304, 305, and 306 were deleted; session count returned from 37 to 37.
