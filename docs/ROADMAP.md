# Roadmap

anyagent-bridge ships in stages. Stage 1 is a self-contained, useful tool on its own;
each later stage adds a layer for safer remote access without breaking the core. The
codebase deliberately leaves clean extension points (seams) for these stages.

## Stage 1 — Portable core ✅ (current)

The "it works" core, with nothing macOS- or person-specific:

- `TerminalSession` class with PTY spawn/respawn (automatic re-creation + backoff).
- Multi-viewer broadcast over a WebSocket protocol.
- Scrollback buffer (10,000 lines), heartbeat, and dead-connection detection.
- Session persistence (`sessions.json`).
- Universal agent profiles — register **any** command; launch via `startAgent`, drive via `sendAgent`/raw `input`.
- File-management API (browse/read/write/rename/move/delete/upload/download) behind a path whitelist.
- Crash guards (`uncaughtException`, `unhandledRejection`, `SIGINT`, `SIGTERM`).
- Token auth with constant-time comparison and a rate-limiting structure.
- Cross-platform shell selection and plain `fs.*` file access (no platform-specific brokers).

## Stage 2 — Free tunnel adapters ✅

Zero-/low-config remote access without paying for anything, via pluggable
adapters spawned as external CLIs (no new npm dependencies). Disabled by default;
when off, missing, or misconfigured the server runs exactly like Stage 1
(localhost-only) and never crashes.

- **Microsoft Dev Tunnels** (default) — one-time `devtunnel user login`; the URL rotates per run unless you pre-create a tunnel (`tunnelId`).
- **Cloudflare Quick Tunnel** (`cloudflare-quick`) — no account; ephemeral `*.trycloudflare.com` URL; testing-grade (≈200 req cap, no SSE).
- **Tailscale** (`tailscale`) — needs `tailscale up` + Funnel enabled in the tailnet ACL; stable `*.ts.net` URL; may need sudo.
- **cloudflared named tunnel** (`cloudflared-named`) — needs a Cloudflare account + zone, a pre-created tunnel and DNS route; stable custom hostname.

Config: the `tunnel` block in `config.json` (default `enabled:false`,
`provider:"devtunnel"`). Env overrides: `BRIDGE_TUNNEL_ENABLED`,
`BRIDGE_TUNNEL_PROVIDER`, `BRIDGE_TUNNEL_HOSTNAME`. Control at runtime:
`GET|POST /api/tunnel/{status,start,stop,restart}`. Add a 5th provider by
dropping an adapter under `server/tunnel/adapters/` and registering it in
`server/tunnel/registry.js`.

## Stage 3 — Authentication & sessions ✅

Login on top of Stage 1's static token, all opt-in. With OAuth off, no TOTP
enrolled, and `requireLogin` false, the bridge behaves exactly like Stage 2 (the
static token works everywhere). Zero new npm dependencies — built on Node's
`crypto` and the global `fetch`. Lives in `server/auth/`.

- **Signed sessions** — HMAC-SHA256 tokens, expiring and revocable, tracked by id
  and persisted (`.data/auth-sessions.json`). Primary browser transport is an
  httpOnly `aab_session` cookie (the WS upgrade and fetches carry it automatically);
  `X-Session-Token` / `Authorization: Bearer` / `?session=` work for API clients.
- **TOTP 2FA** (RFC 6238) — enroll from the UI (`/api/auth/totp/setup` → `confirm`),
  scan the `otpauth://` QR, get one-time recovery codes. A replay guard tracks the
  last accepted step counter. Operator-only.
- **OAuth** — Google (auth-code + PKCE S256) and GitHub (auth-code + state). CSRF
  `state` is single-use and TTL-bounded. Identity is checked against a per-provider
  allowlist (`allowedEmails` / `allowedLogins`); an empty allowlist fails closed
  unless `claimFirstUser` is on (first successful login claims the bridge, TOFU).
- **The one rule** — the static token is a *direct* credential UNLESS `requireLogin`
  is set OR a TOTP secret is confirmed; then it becomes *login-only* (must be
  exchanged, with the 2FA code, for a session). This is what makes 2FA real.

Config: the `auth` block in `config.json` (or `BRIDGE_*` env overrides — keep
OAuth client secrets in env). Routes: `POST /api/auth/login`, `/logout`,
`GET /api/auth/config|me|sessions`, `DELETE /api/auth/sessions/:id`,
`GET /api/auth/oauth/:provider/{start,callback}`, `/api/auth/totp/{status,setup,confirm,disable}`.

Defense-in-depth added here: a CSRF Origin check on cookie-authenticated writes
(bearer/token clients are exempt — they are not CSRF-able), an expanded file-API
denylist for secret-bearing dotfiles, and a bounded OAuth pending-state map.

Known residuals (deferred to Stage 4 hardening): `getClientIP` trusts
`X-Forwarded-For` unconditionally — behind an untrusted proxy the per-IP login
rate limit is evadable (the global cap still applies); set `callbackBaseUrl` when
OAuth is exposed so the redirect URI is not derived from request headers.

## Stage 4 — Sandboxing & safety ✅

Four opt-in safety layers in one subsystem, `server/safety/` (entry `index.js` exports
`createSafetyManager`; `manager.js` orchestrates; `sandbox.js` / `audit.js` / `redact.js`
/ `clientip.js` are pure leaves). All default **off** — with `safety.enabled` false the
server is byte-identical to Stage 3 (proven by `test/stage4-boot.js`). Zero new npm
dependencies: the Docker layer spawns the `docker` CLI (reusing `tunnel/detect`),
everything else is Node core. `server/index.js` is touched only at marked seams;
`auth._isOperator` is reused for the operator gate (auth internals untouched).

- **Docker isolation** — the whole session PTY runs `docker run` (the agent launches
  inside the container, so `startAgent`/`sendToAgent` are unchanged). Only sessions
  with a bounded **project dir** are sandboxed (never bind-mounts `$HOME`); the project
  mounts at `/workspace`. Operator-supplied `image` (must contain the agent CLI).
  `-it` for an in-container TTY; default limits (`--memory`/`--cpus`/`--pids-limit`/
  `--security-opt no-new-privileges`); opt-in hardening (`--read-only`/`--cap-drop ALL`/
  `--user`, the last Linux-only). Secrets reach the container as `-e NAME` (values off
  the process table); the docker client env is a minimal allowlist (never the full
  `process.env`); `BRIDGE_*`/token are denied even if listed. `network` defaults to
  `bridge`. `onDockerMissing` = `host` (fall back, default) | `refuse`. Repeated fast
  container exits auto-degrade to a host shell (no respawn storm). **Graceful, never
  crashes.**
- **Kill-switch** — `POST /api/safety/kill/:id` (SIGKILL pty + `docker rm -f`),
  `POST /api/safety/panic` (kill all + sweep `aab-<installId>-sess-*` strays + optional
  tunnel stop + optional **lock**), `POST /api/safety/unlock`. The lock gates only new
  agent launches (never the shell — no remote soft-brick) and persists across restart.
  Operator-only on REST and WebSocket (`{type:"panic"|"kill"}`). Graceful `destroy()`
  also reaps its container (no leak); a per-install container-name nonce so panic never
  kills another install's containers.
- **Audit logging** — append-only JSONL under `.data/audit/` via one `res.on('finish')`
  middleware (REST mutations) + WS seams (`agent.start`/`agent.send`); raw keystrokes
  are intentionally not logged. Date + size rotation, retention prune by strict regex,
  synchronous ordered append, `flushSync` on exit. Every field is redacted before write.
- **Secret redaction** — the audit log is **always** scrubbed (AWS/OpenAI/GitHub/Slack/
  Google keys, JWT, PEM blocks, plus the bridge's own token + session secret by exact
  match). Live PTY-stream redaction is opt-in (`redaction.liveStream`, default off so the
  stream stays byte-identical) with a boundary hold-back for split tokens/PEM/ANSI and a
  bounded `maxHoldBytes` (overflow masks the partial rather than leaking it).

**Stage 3 residual closed:** `trustProxy` (default off, opt-in) makes the client IP for
rate limiting + audit come from the direct socket peer instead of a spoofable
`X-Forwarded-For`; `true`/`N` trust the nearest / Nth proxy hop. (The OAuth
`redirect_uri`-from-Host residual remains a documented boot warning — hardening it would
require changing the shipped Stage-3 auth route, so it is deferred.)

Config: the `safety` block in `config.json` (`BRIDGE_SAFETY_ENABLED`, `BRIDGE_SANDBOX_*`,
`BRIDGE_AUDIT_ENABLED`, `BRIDGE_REDACT_LIVE`, `BRIDGE_TRUST_PROXY` env overrides).
Verified: `test/stage4-smoke.js` (32 unit) + `test/stage4-boot.js` (9 integrated,
byte-identical-off + safety-on + audit recording). Live container spawn is **not**
exercised here (no docker daemon on the build machine) — the argv/env builders and
graceful degradation are unit-tested; real `docker run` is left for an environment with
a daemon.

## Stage 5 — Packaging & distribution ✅

One-command installs plus the docs to run the bridge safely on any of the three
platforms. Zero new runtime dependencies and **no changes to the Stage 1–4 server** —
the launcher only sets environment variables the server already reads.

- **npx** — `bin/anyagent-bridge.js` (declared in `package.json`'s `bin`) boots the
  server in-process and maps friendly flags (`--port` / `--host` / `--token` /
  `--tunnel [provider]` / `--no-tunnel`) onto the existing `PORT` / `HOST` /
  `BRIDGE_*` env vars. Because dotenv does not override an already-set variable, the
  precedence is CLI flag > `.env` > `config.json`, and `npx anyagent-bridge` stays
  equivalent to `node server/index.js`. Unknown flags and bad values fail with exit 1.
- **Docker** — a multi-stage `Dockerfile` builds `node-pty` in a toolchain stage and
  ships a slim non-root runtime (`tini` as PID 1, a Node-only `/health` healthcheck,
  `HOST=0.0.0.0` so the published port reaches it). `docker-compose.yml` publishes on
  `127.0.0.1` only and persists the token / sessions / audit log in the `bridge-data`
  named volume (read the token from `docker compose logs`). `.dockerignore` keeps host
  state and secrets out of the build context. The image carries the bridge + a `bash`
  shell but **not** the agent CLIs — documented, with two ways to add an agent.
- **Publishing hygiene** — a `files` allowlist in `package.json` publishes only the app
  (`bin`/`server`/`client`/`docs`/`test` + `config.example.json` + `.env.example`); a
  `npm pack --dry-run` confirms `config.json`, `.data/`, `.env`, and `sessions.json` are
  never in the tarball (38 files, no secrets).
- **Docs** — `docs/INSTALL.md` (npx · from source · Docker, per-OS toolchain notes,
  updating / uninstalling / troubleshooting), `docs/SECURITY.md` (threat model, safe
  defaults, what to enable before exposing it, disclaimers), and `docs/WALKTHROUGH.md`
  (end-to-end tour + screenshot capture guide). README gains a Quick start.

Verified offline: `node bin/anyagent-bridge.js --version/--help`, error paths exit 1, a
real boot through the launcher with `/health` returning **HTTP 200** and the banner
reflecting the `--port`/`--token` flags, `npm pack --dry-run` (file set above), and the
Stage 4 suites still green (`npm test` → 32 + 9 pass). **Not exercised here:** the Docker
image build and `docker compose up` — there is no Docker daemon on the build machine, so
the `Dockerfile` / compose are review-only and **needs-live-docker**. Screenshot PNGs are
deferred to a live capture (`docs/WALKTHROUGH.md` ships the text walkthrough + capture steps).
