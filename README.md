# anyagent-bridge

Control your local computer's terminal — and **any** CLI AI coding agent you've registered (Claude Code, Codex, aider, …) — from a browser on your phone or another PC, anywhere.

## Goals

- **Open** — fully open source, no lock-in, bring whatever agent you like.
- **Cross-platform** — runs on macOS, Windows, and Linux.
- **Free & secure** — no accounts, no cloud middleman; localhost-only by default with a single-token gate.

## Features

- Drive a real terminal (PTY) from the browser, with full scrollback (10,000 lines).
- Register **any** command as an "agent" and launch it with one click — not hardcoded to one tool.
- Multiple browser viewers can watch/control the same session at once (live broadcast).
- Persistent sessions that survive reconnects, with automatic PTY respawn and backoff.
- Heartbeat + dead-connection detection so stale viewers get cleaned up.
- File management API: browse, read, write, rename, move, delete, upload, download — all behind a path whitelist.
- Crash guards (uncaught exceptions, signals) so the server stays up.
- Constant-time token comparison and basic rate limiting.
- Optional **login**: Google/GitHub OAuth, TOTP 2FA, and signed expiring sessions on top of the token (Stage 3).

## Requirements

- **Node.js 18+**
- Your own AI CLI, already installed and logged in. anyagent-bridge **never injects or stores any credentials** — it just runs the command you registered (e.g. `claude`, `codex`), and that CLI uses its own existing authentication.

## Install

```bash
npm install
```

`node-pty` is a native module, so `npm install` compiles it on first run. If the build fails you likely need standard build tools:

- **macOS** — Xcode Command Line Tools: `xcode-select --install`
- **Linux** — `build-essential` (or your distro's gcc/g++/make) and Python 3
- **Windows** — the Visual Studio Build Tools (C++ workload)

## Configure

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

```json
{
  "host": "127.0.0.1",
  "port": 3001,
  "shell": null,
  "auth": { "token": null },
  "agents": [
    { "id": "claude", "name": "Claude Code", "command": "claude" },
    { "id": "codex", "name": "Codex", "command": "codex" }
  ],
  "projects": [],
  "allowedPaths": [],
  "sessionTimeoutDays": 7
}
```

- **`host`** — `127.0.0.1` (default) keeps the bridge on localhost only. Set `0.0.0.0` to expose it on your network (opt-in; you'll see a warning at boot).
- **`port`** — the port to listen on.
- **`shell`** — `null` auto-picks per OS (`$SHELL` or `/bin/bash`; on Windows `%COMSPEC%` or `powershell.exe`). Set a path to override.
- **`auth.token`** — `null` generates a random token on first boot and saves it to `.data/auth.json`. There is no default password or default token.
- **`agents`** — register **any** command. Each entry is `{ "id", "name", "command" }`; `command` can be literally any executable on your PATH. Add your own (aider, custom scripts, etc.) by adding more entries.
- **`projects`** — optional `[{ "name", "path" }]` shortcuts for quick directory switching.
- **`allowedPaths`** — file-API whitelist. `[]` defaults to your home directory.
- **`sessionTimeoutDays`** — how long idle sessions persist.

## Run

```bash
npm start
```

## Connect

On first boot the server prints your **access token** and the local URL, for example:

```
anyagent-bridge listening on http://127.0.0.1:3001
Access token: 9f3c...  (saved to .data/auth.json)
```

Open that URL in a browser and provide the token when prompted.

## Remote access (Stage 2)

To reach the bridge from your phone or another machine, enable a **tunnel**. Each
provider is just an external CLI you install yourself — anyagent-bridge spawns it,
no new npm dependencies and no credentials stored. Tunnels are **off by default**;
when disabled, missing, or misconfigured the server runs exactly as before
(localhost-only) and never crashes.

| Provider (`provider` id) | CLI | Account? | URL | One-time setup |
|---|---|---|---|---|
| Microsoft Dev Tunnels (`devtunnel`, default) | `devtunnel` | yes | rotates per run (stable with a pre-created `tunnelId`) | `devtunnel user login` |
| Cloudflare Quick (`cloudflare-quick`) | `cloudflared` | no | ephemeral `*.trycloudflare.com` | none — testing-grade (≈200 req cap, no SSE) |
| Tailscale Funnel (`tailscale`) | `tailscale` | yes | stable `*.ts.net` | `tailscale up` + enable Funnel in the tailnet ACL |
| cloudflared named (`cloudflared-named`) | `cloudflared` | yes | stable custom hostname | `cloudflared tunnel login` → `tunnel create` → `tunnel route dns` |

Enable it in `config.json`:

```json
{
  "tunnel": {
    "enabled": true,
    "provider": "devtunnel",
    "cloudflared-named": { "tunnelName": "my-tunnel", "hostname": "bridge.example.com" }
  }
}
```

Or via environment variables (override `config.json`):

- `BRIDGE_TUNNEL_ENABLED` — `true`/`1` to enable.
- `BRIDGE_TUNNEL_PROVIDER` — one of the ids above.
- `BRIDGE_TUNNEL_HOSTNAME` — public hostname for the `cloudflared-named` provider.

Inspect and control the tunnel at runtime (all require the access token):

- `GET /api/tunnel/status` — current state, provider, and public URL.
- `POST /api/tunnel/start` · `POST /api/tunnel/stop` · `POST /api/tunnel/restart`.

The boot banner prints the public URL once the tunnel is ready. **A public tunnel
makes your access token the only thing between the internet and your terminal** —
keep it secret, or add a login (next section).

## Login & accounts (Stage 3)

On top of the static token you can require a real login. Everything here is
**opt-in**: with OAuth off, no 2FA enrolled, and `requireLogin` false, the bridge
behaves exactly as before (the token works directly). No new npm dependencies.

**The one rule:** the static token is a *direct* credential **unless** you set
`requireLogin` or enroll 2FA — then it becomes *login-only* (you exchange it, with
your 2FA code, for a session). That is what makes 2FA actually protective. Logins
mint a signed, expiring session delivered as an httpOnly cookie.

**Two-factor (TOTP).** Once authenticated, enroll from the API: `POST /api/auth/totp/setup`
returns an `otpauth://` URI to scan with Google Authenticator / 1Password / Authy,
then `POST /api/auth/totp/confirm` with a code activates it and returns one-time
recovery codes (store them). Enrolling 2FA flips the token to login-only.

**OAuth (Google / GitHub).** Register an OAuth app with each provider, then set
the client id/secret (in env, not committed config) and enable it:

```json
{
  "auth": {
    "requireLogin": false,
    "oauth": {
      "enabled": true,
      "callbackBaseUrl": "https://your-tunnel.example",
      "claimFirstUser": true,
      "google": { "clientId": "…", "clientSecret": "…", "allowedEmails": ["you@gmail.com"] },
      "github": { "clientId": "…", "clientSecret": "…", "allowedLogins": ["yourlogin"] }
    }
  }
}
```

Set each provider's callback to `<callbackBaseUrl>/api/auth/oauth/<provider>/callback`.
The allowlist (`allowedEmails` / `allowedLogins`) is **fail-closed** — an empty
allowlist admits no one, unless `claimFirstUser` is on, in which case the **first**
successful login claims the bridge and everyone else is denied (so don't expose a
fresh, unclaimed bridge publicly). Always set `callbackBaseUrl` when OAuth is
reachable, so the redirect URI is not derived from request headers.

Login endpoints (all under `/api/auth`): `POST /login` · `POST /logout` ·
`GET /config` · `GET /me` · `GET /sessions` · `DELETE /sessions/:id` ·
`GET /oauth/:provider/{start,callback}` · `POST /totp/{setup,confirm,disable}`.
Configure it all via the `auth` block in `config.json` or `BRIDGE_*` env vars
(see `.env.example`).

## Security notes

- **Localhost by default.** Out of the box the server binds `127.0.0.1`, so only your own machine can reach it.
- **The token is the gate.** There is no default password and no default token — one is generated on first boot and persisted to `.data/auth.json`. Keep it secret. If you set `host` to `0.0.0.0`, the token is the *only* thing standing between the internet (or your LAN) and your terminal — the server warns you about this at boot.
- **No credential injection.** The bridge runs your registered command and nothing more; your AI CLI's own login is used as-is.
- **Add a login before exposing it.** Free tunnels (Stage 2) and OAuth + 2FA login (Stage 3, see [Login & accounts](#login--accounts-stage-3)) are shipped; Docker sandboxing (Stage 4) is next. If you expose the bridge, require a login and set `callbackBaseUrl`; prefer localhost or a trusted network otherwise. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Roadmap

- **Stage 1 (this release)** — portable, cross-platform core: terminal + any-agent control over WebSocket, file API, persistent sessions, token auth.
- **Stage 2 (this release)** — free tunnel adapters (Dev Tunnels, Cloudflare, Tailscale, cloudflared) for zero-config remote access. See [Remote access](#remote-access-stage-2).
- **Stage 3 (this release)** — OAuth (Google/GitHub) + 2FA + real session management. See [Login & accounts](#login--accounts-stage-3).
- **Stage 4** — Docker sandboxing, kill-switch, audit logging, secret redaction.
- **Stage 5** — packaging (npx / docker-compose), cross-platform docs, and screenshots.

Full detail in [docs/ROADMAP.md](docs/ROADMAP.md).

## License

MIT — see [LICENSE](LICENSE).
