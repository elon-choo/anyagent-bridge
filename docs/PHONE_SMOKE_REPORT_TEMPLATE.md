# Physical Phone Smoke Report

Use this template after running the 30-minute real-phone checklist in `docs/FINAL_UX_AUDIT.md`. Do not paste the bridge credential, private URLs with credentials, API keys, recovery codes, screenshots that expose secrets, or private terminal output.

## Run Metadata

| Field | Value |
|---|---|
| Date | YYYY-MM-DD |
| Tester |  |
| Phone model |  |
| OS and version |  |
| Browser |  |
| Network path | Wi-Fi / cellular / both |
| Bridge URL used | `https://anyagent-bridge.tail8e6e6f.ts.net` |
| Start time |  |
| End time |  |
| Total duration |  |
| Result | Pass / Pass with notes / Fail |

## Preflight

| Check | Result | Evidence / Notes |
|---|---|---|
| `npm run test:phone-preflight` passes before starting |  | Report: `/tmp/anyagent-bridge-phone-smoke/phone-smoke-preflight-report.json` |
| Local bridge health is 200 before starting |  |  |
| Tailscale Funnel URL opens on the phone |  |  |
| Session count noted before smoke |  |  |
| Screenshots/videos will avoid secrets |  |  |

## Step Results

| # | Step | Result | Evidence / Notes |
|---:|---|---|---|
| 1 | Open phone URL and authenticate with the bridge credential. |  |  |
| 2 | Confirm first viewport shows terminal, toolbar, exposure/status, and mobile dock without horizontal scrolling. |  |  |
| 3 | On a fresh session, tap `pwd` from the starter. |  | Expected: one tap sends, `/Users/elon` appears, starter closes. |
| 4 | Start Claude Code. |  | Expected: compact launch assist appears with Enter, Esc, arrows, Ctrl-C. |
| 5 | Tap Esc, then Ctrl-C. |  | Expected: terminal receives input and remains connected. |
| 6 | Type and send a short compose message. |  | Expected: text sends, compose clears, keyboard does not block send path. |
| 7 | Attach or paste a small screenshot/image. |  | Expected: upload succeeds and a local image path appears in compose. |
| 8 | Rotate portrait to landscape and back. |  | Expected: no horizontal overflow; terminal and dock reflow. |
| 9 | Open Sessions, search current session id, switch if safe, then return. |  | Expected: search/count works and no wrong draft leaks. |
| 10 | Open Connect, Projects, Secrets, Files, Notifications, and Sessions. |  | Expected: in-app dialogs, close works, no native browser prompts. |
| 11 | In Files, open a text/Markdown file under an allowed path. |  | Expected: tree, editor, and preview are usable on mobile. |
| 12 | In Notifications, switch Quiet and back to Important. |  | Expected: mode persists after closing/reopening. |
| 13 | If acceptable, enable/test phone notifications. |  | Expected: success or clear in-app toast. |
| 14 | Sleep phone for 60 seconds, wake, and return. |  | Expected: status reconnects and same session remains. |
| 15 | Briefly switch network/offline and return online. |  | Expected: honest offline/connected status and no duplicate visible session. |
| 16 | Add PWA to home screen if supported. |  | Expected: icon/name correct and standalone launch works. |
| 17 | Run `git status` from starter/quick command or compose. |  | Expected: output appears and scroll remains controllable. |
| 18 | Start Codex too if installed. |  | Expected: launch assist remains useful for trust/permission prompt. |
| 19 | Review text fit at narrow and normal phone widths. |  | Expected: no clipped labels or overlapping controls. |
| 20 | Close only temporary sessions created during smoke. |  | Expected: session count returns to preflight count. |

## Failures

| Step | Severity | Reproducible? | Details | Evidence path |
|---:|---|---|---|---|
|  | Low / Medium / High / Blocking | Yes / No / Unknown |  |  |

## Final Session Cleanup

| Item | Value |
|---|---|
| Session count before smoke |  |
| Temporary session ids created |  |
| Temporary session ids closed |  |
| Session count after cleanup |  |
| Cleanup result | Pass / Fail |

## Verdict

Choose one:

- `Pass`: all required steps passed, no blocking failures, cleanup complete.
- `Pass with notes`: non-blocking issues were observed and documented.
- `Fail`: at least one blocking or repeated high-severity issue remains.

Final verdict:

Notes:
