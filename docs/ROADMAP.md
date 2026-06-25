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

## Stage 2 — Free tunnel adapters

Zero-/low-config remote access without paying for anything, via pluggable adapters:

- **Microsoft Dev Tunnels** (default).
- **Cloudflare Quick Tunnel** (ephemeral, no account).
- **Tailscale** (private mesh).
- **cloudflared named tunnel** (stable custom hostname).

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
