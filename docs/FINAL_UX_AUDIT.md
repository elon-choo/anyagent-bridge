# Final UX Audit

Date: 2026-07-01

This audit summarizes the current AnyAgent Bridge UX upgrade state after 27 focused rounds. The detailed finding table and per-round evidence live in `docs/UX_UPGRADE_LOG.md`; this file is the completion-oriented checklist and evidence index.

## Current Status

Automated desktop, mobile, external-funnel, and landing checks pass. The remaining unverified item is a human-run 30-minute smoke on a physical phone. Do not treat that as completed until someone runs the checklist at the end of this file on a real iOS or Android device.

Latest automated evidence:

- Final consolidated acceptance: `/tmp/anyagent-bridge-final-audit/final-acceptance-summary.json`
- Reproducible acceptance command: `npm run test:ux-final`
- Latest reproducible acceptance: `/tmp/anyagent-bridge-final-audit/final-ux-acceptance-summary.json`
- Physical-phone preflight command: `npm run test:phone-preflight`
- Latest physical-phone preflight: `/tmp/anyagent-bridge-phone-smoke/phone-smoke-preflight-report.json`
- Broad app acceptance: `/tmp/anyagent-bridge-final-audit/final-acceptance-report.json`
- Modal focus confirmation: `/tmp/anyagent-bridge-final-audit/modal-focus-report.json`
- PWA/installability endpoints: `/tmp/anyagent-bridge-final-audit/pwa-endpoints-report.json`
- Production landing audit: `/tmp/anyagent-bridge-ux-round19/landing-production/report.json`
- Full finding/evidence table: `docs/UX_UPGRADE_LOG.md`
- Physical-phone report template: `docs/PHONE_SMOKE_REPORT_TEMPLATE.md`

## Requirement Audit

| Requirement | Current evidence | Status |
|---|---|---|
| Read project instructions before work | `AGENTS.md`, `CLAUDE.md`, `README.md`, and the goal file were read during the work loop. | Verified |
| Do not touch production bridge on port 3001 | Work and tests targeted `~/anyagent-bridge` and `http://127.0.0.1:3002`; final gates show server diff empty. | Verified |
| Prefer client-only, avoid server churn | UX rounds changed `client/`, `public/`, `.gitignore`, and docs; final `git diff --stat -- server/` is empty. | Verified |
| Secret safety | Patch-level secret scans are clean; `.data/`, `.env`, `.env.local`, `.vercel/`, `.npmrc`, and generated local state remain ignored. | Verified |
| No package release performed | No package release command was run. | Verified |
| Find broad UX upgrade items | `docs/UX_UPGRADE_LOG.md` contains 41 findings across onboarding, mobile, sessions, files, notifications, accessibility, resilience, security visibility, landing, final auditability, physical-phone evidence capture, audit reproducibility, phone-smoke readiness, mobile file-preview verification, session-switch acceptance, session draft isolation, and stricter toolbar touch-target evidence. | Verified |
| Implement prioritized improvements in small rounds | Rounds 1-27 are committed with evidence in commit bodies and `docs/UX_UPGRADE_LOG.md`. | Verified |
| Beginners can send the first mobile command within 3 taps | Final local 320px and funnel 390px checks show fresh starter visible, `pwd` sends with one tap, output appears, and starter closes. | Verified |
| 320-1440px layouts do not break | Final acceptance covers local app at 1440 and 320, funnel at 390, landing at 1440/390/320; horizontal overflow 0. | Verified |
| Touch targets are sufficient | Final acceptance now requires mobile starter, launch-assist, Files editbar, local 320px toolbar, and funnel 390px toolbar controls to measure 44px+. | Verified |
| Agent launch prompt remains usable on 320px | Final local 320px run observes `startAgent`, compact launch assist, Esc and Ctrl-C input frames, and 44px+ assist buttons. | Verified |
| Reconnect preserves usable state | Final desktop run switches sessions, restores per-session compose drafts, returns to the original output, then forces offline/online and returns from `offline` to `connected`. | Verified |
| WebSocket frames match intended actions | Final run observes `sendToAgent`, `input`, and `startAgent` frames for desktop/mobile/funnel flows. | Verified |
| Existing features still work | Final run covers compose send, image attach, special key, Sessions new-session/switch-back/draft isolation, Connect, Projects, Secrets, Files, mobile Markdown preview, Notifications, reconnect, public funnel, and landing. PWA endpoints are also checked. | Verified by automation; real install pending phone smoke |
| Native browser dialogs removed from UX-critical paths | Final scan for native `alert`, `confirm`, and `prompt` calls is empty in `client/index.html`, `client/sw.js`, and `public/index.html`. | Verified |
| Accessibility: modals named, focus contained/restored | Final modal report verifies Connect, Projects, Secrets, Files, Notifications, and Sessions have dialog semantics, focus moves inside, and focus restores to opener. | Verified |
| Notification noise controls exist | Round 16 and final landing evidence cover All, Important, Quiet, Paused; service worker filtering was verified in Round 16. | Verified |
| Landing reflects new features | `https://anyagent-bridge.vercel.app` is deployed from tracked `public/`, mentions starter, Quiet, launch assist, and Node 18+, and passes production Playwright audit. | Verified |
| Final report and smoke checklist exist | This file provides the final audit and physical-phone smoke checklist; `docs/PHONE_SMOKE_REPORT_TEMPLATE.md` provides the fillable evidence artifact. | Verified |
| 30-minute physical-phone smoke | Requires a real phone in the user's hands. Automated mobile emulation and Tailscale funnel checks passed, but a physical phone was not operated by Codex. | Pending human verification |

## Finding Status Summary

All 41 tracked findings in `docs/UX_UPGRADE_LOG.md` are in `Implemented` or `Verified OK` state:

| Range | Area | Status |
|---|---|---|
| 1-3 | Project-scoped launch, push deep links, draft restore | Implemented |
| 4-6 | Mobile touch targets and keybar activation | Implemented |
| 7-10 | File access messaging, project memory, image drafts, session draft isolation | Implemented |
| 11-15 | Honest ready state, first-use starter, mobile toolbar, session manager, launch assist | Implemented |
| 16-19 | Missing env noise, CDN fallbacks, PWA icon availability, offline state | Implemented / Verified OK |
| 20-23 | File dialogs, notification modes, exposure badge, Markdown fallback | Implemented |
| 24-28 | Reduced motion, quick commands, command history, session row actions, mobile preview | Implemented |
| 29-41 | Dirty-file dialogs, notification setup toast, modal semantics/focus, public landing, final audit, phone-smoke report template, reproducible final acceptance, phone-smoke preflight, mobile file preview acceptance, session-switch acceptance, session draft isolation, stricter toolbar touch-target acceptance | Implemented |

## Final Automated Acceptance

Final acceptance was run against the current state, not historical artifacts.

The tracked rerun command is `npm run test:ux-final`. It accepts `AAB_BASE_URL`, `AAB_FUNNEL_URL`, `AAB_LANDING_URL`, `AAB_AUTH_FILE`, `AAB_AUTH_VALUE`, `AAB_SKIP_FUNNEL=1`, `AAB_SKIP_LANDING=1`, and `AAB_OUTPUT_DIR`.

Before the required physical-phone smoke, run `npm run test:phone-preflight`. It verifies local health, authenticated local/funnel APIs, PWA endpoints, session count consistency, and that the preflight itself does not create sessions. This preflight does not replace the real phone run.

Automated app scope:

- Local desktop 1440x900: fresh starter, manual `sendToAgent`, terminal output, image attach, Esc key frame, Sessions new-session/switch-back, per-session compose draft isolation, all major modals, offline/online reconnect.
- Local mobile 320x720: fresh starter, one-tap `pwd`, real `startAgent`, compact launch assist, Esc and Ctrl-C frames, 44px+ toolbar controls, no horizontal overflow.
- Local mobile Files 390x844: temporary project fixture, Markdown open through Files UI, Preview mode, sanitized output, 44px+ editbar controls, no horizontal overflow, fixture cleanup.
- Tailscale funnel mobile 390x844: public URL reachable, fresh starter, one-tap `pwd`, output visible, 44px+ toolbar controls, no horizontal overflow.
- Production landing: 1440x900, 390x844, and 320x720, all images loaded, no horizontal overflow, touch-safe CTAs, feature markers present.
- PWA surface: manifest, service worker, SVG icon, 192px icon, 512px icon, and maskable icon all return 200.

Cleanup evidence:

- Latest reproducible final acceptance created sessions 241, 242, 243, 244, and 245 and deleted them; session count returned from 37 to 37.
- The latest run passed `localMobile320.toolbarTouch: true` and `funnelMobile390.toolbarTouch: true`; every visible toolbar control in both flows measured at least 44x44.
- The desktop session-switch check verified distinct session ids, ran `echo FINAL_SWITCH_SECOND`, switched back, restored `FINAL_DESKTOP`, restored the first session's uploaded image draft, kept the second session initially clean, and restored the second session's unsent draft only in that second session.

## Residual Risk

| Risk | Why it remains | Mitigation |
|---|---|---|
| Physical phone behavior | Browser emulation cannot prove iOS/Android soft keyboard, viewport chrome, notification permission UI, install prompts, or camera QR scanning. | Run the 30-minute physical-phone checklist below. |
| Push notification delivery on a real phone | Service-worker filtering is automated, but OS-level notification permission and delivery timing vary. | Include notification setup/test in physical-phone smoke. |
| Real agent trust prompts vary by CLI version | The launch assist is verified with `startAgent` and input frames, but agent CLIs may change prompt wording. | Start both Claude Code and Codex during physical-phone smoke if installed. |
| Public tunnel latency and mobile network changes | Tailscale funnel is reachable from automation, but not tested over a cellular device. | Run part of the phone smoke off Wi-Fi if acceptable. |

## 30-Minute Physical-Phone Smoke Checklist

Use a real phone against `https://anyagent-bridge.tail8e6e6f.ts.net`. Do not paste or store the bridge credential in screenshots or shared notes.

1. Open the phone URL and authenticate with the bridge credential.
2. Confirm the first viewport shows terminal, toolbar, exposure/status, and mobile dock without horizontal scrolling.
3. On a fresh session, tap `pwd` from the starter. Expected: command sends in one tap, `/Users/elon` appears, starter closes.
4. Start Claude Code. Expected: compact launch assist appears; Enter, Esc, arrows, Ctrl-C are visible and easy to tap.
5. Tap Esc, then Ctrl-C. Expected: terminal receives input, UI remains connected, no accidental zoom or layout jump.
6. Type a short message in the compose box and send it. Expected: text sends, compose clears, keyboard does not cover the send path.
7. Attach or paste a small screenshot/image. Expected: upload succeeds and a local image path appears in compose.
8. Rotate phone portrait to landscape and back. Expected: no horizontal overflow, terminal and dock reflow, touch controls remain reachable.
9. Open Sessions, search the current session id, switch to another session if safe, then return. Expected: search/count works and no wrong draft leaks.
10. Open Connect, Projects, Secrets, Files, Notifications, and Sessions. Expected: each opens as an in-app dialog, close works, no native browser prompts appear.
11. In Files, open a text/Markdown file under an allowed path. Expected: tree, editor, and preview are usable on mobile.
12. In Notifications, switch to Quiet and back to Important. Expected: mode persists after closing/reopening the dialog.
13. If phone notification permission is acceptable, enable/test notifications. Expected: success or a clear in-app toast, never a confusing native alert-only path.
14. Put the phone to sleep for 60 seconds, wake it, and return to the page. Expected: status reconnects and the same session remains.
15. Toggle airplane mode or switch Wi-Fi/cellular briefly, then return online. Expected: status shows offline/connected honestly and no duplicate user-visible session is created.
16. Add the PWA to the home screen if supported. Expected: icon/name are correct and the app opens standalone.
17. Run `git status` from the starter/quick command or compose. Expected: command output appears and scroll remains controllable.
18. Start Codex too if installed. Expected: launch assist remains useful for any trust/permission prompt.
19. Review text fit at 320-ish phone width and normal phone width. Expected: no clipped button labels or overlapping controls.
20. End by closing only temporary sessions created during the smoke.

Record results in `docs/PHONE_SMOKE_REPORT_TEMPLATE.md`:

- Phone model and OS version.
- Browser used.
- Network used: Wi-Fi, cellular, or both.
- Start/end time; target duration is at least 30 minutes.
- Any failures with screenshot/video, exact step number, and whether the issue reproduces after reload.

The goal should not be treated as physically phone-verified until this checklist is completed.
