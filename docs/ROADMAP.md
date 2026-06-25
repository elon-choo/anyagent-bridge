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

## Stage 3 — Authentication & sessions

- OAuth login with **Google** and **GitHub**.
- **2FA**.
- Real multi-user session management on top of Stage 1's token gate.

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
