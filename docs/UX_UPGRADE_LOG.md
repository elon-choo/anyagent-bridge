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
| 11 | The UI reports `connected` before the server `ready` frame. | 3 | 4 | 12 | Backlog | Focused test needed `ready` wait for last-session save. |
| 12 | The first-use terminal is visually empty; beginners get no safe next action. | 4 | 3 | 12 | Backlog | Home screenshots show a blank terminal after login. |
| 13 | Mobile toolbar is usable but horizontally clipped; feature discovery still depends on swiping. | 3 | 4 | 12 | Backlog | After mobile screenshot shows `Connect` partially off-screen. |
| 14 | Session list can grow noisy with many unnamed sessions. | 3 | 4 | 12 | Backlog | Before test observed 38 session rows. |
| 15 | Agent trust prompts can dominate a 320px screen after launch. | 3 | 4 | 12 | Backlog | After 320 screenshot shows Claude trust prompt filling terminal. |
| 16 | Secrets modal expects `.env.local` 404 as normal, but the browser logs it as a failed resource. | 2 | 4 | 8 | Backlog | After report has expected `.env.local` 404. |
| 17 | CDN dependencies for xterm, QR, marked, and DOMPurify have no visible offline/failure fallback. | 4 | 2 | 8 | Backlog | Code inspection of external script/style URLs. |
| 18 | PWA manifest references PNG icons, while the client directory currently has only `icon.svg`. | 3 | 3 | 9 | Backlog | Code/file inspection. |
| 19 | Reconnect/offline state can remain visually `connected` briefly after network loss. | 3 | 3 | 9 | Backlog | Before offline probe still read `connected` after 900ms. |
| 20 | File creation, rename, and delete still rely on `prompt` / `confirm`, which is rough on mobile. | 3 | 3 | 9 | Backlog | Code inspection in file explorer handlers. |
| 21 | Notification settings are one-button only; there is no quiet/noise control. | 3 | 3 | 9 | Backlog | Code inspection of push setup. |
| 22 | Security visibility for local vs tunnel exposure is buried in the Connect-device modal. | 4 | 3 | 12 | Backlog | Top bar has no persistent exposure badge. |
| 23 | Markdown preview depends on runtime CDN loading. | 3 | 3 | 9 | Backlog | Code inspection of `loadMd()`. |
| 24 | Reduced-motion and animation preferences are not explicitly handled. | 2 | 4 | 8 | Backlog | CSS inspection. |

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
