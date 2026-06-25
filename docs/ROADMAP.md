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

## Stage 4 — Sandboxing & safety

- **Docker isolation** for agent execution.
- **Kill-switch** to terminate runaway sessions instantly.
- **Audit logging** of commands and file operations.
- **Secret redaction** in output streams.

## Stage 5 — Packaging & distribution

- One-command run via **npx** and **docker-compose**.
- Cross-platform installation docs.
- Security disclaimers.
- Screenshots and walkthroughs.
