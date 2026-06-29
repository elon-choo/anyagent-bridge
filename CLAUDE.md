# CLAUDE.md

**Installing or running this project for a user?** Follow the step-by-step playbook in
**[AGENTS.md](AGENTS.md)** — clone → `npm ci` → `npm test` →
`node bin/anyagent-bridge.js setup --yes` → verify over WebSocket. It marks the few
steps only the user can do (browser OAuth login, approvals for global installs or an
internet tunnel, scanning a phone QR). Do everything else yourself and report each step
with evidence.

**Developing this project?** It's a Node 18+ app: `npm ci`, then `npm test`
(`stage4-smoke` + `stage4-boot`). Layout: server is `server/index.js`; the CLI launcher
and setup wizard are in `bin/`; the browser UI is `client/index.html`; docs are in
`docs/`. Keep changes additive, don't modify server behavior without reason, and run the
tests before proposing a diff.
