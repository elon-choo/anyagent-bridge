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
| 13 | Mobile toolbar is usable but horizontally clipped; feature discovery still depends on swiping. | 3 | 4 | 12 | Implemented | Round 6 wraps the mobile toolbar into ordered rows so all primary controls are visible without horizontal scrolling. |
| 14 | Session list can grow noisy with many unnamed sessions. | 3 | 4 | 12 | Implemented | Round 8 added search/count, current/recent-first ordering, and activity hints; filter test narrowed 37 rows to 1. |
| 15 | Agent trust prompts can dominate a 320px screen after launch. | 3 | 4 | 12 | Backlog | After 320 screenshot shows Claude trust prompt filling terminal. |
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
