# Installation

anyagent-bridge runs on **macOS, Windows, and Linux**. Pick one of the three
install paths below. For what the bridge is and how to use it once running, see
the top-level [README](../README.md); for the security model, read
[SECURITY.md](SECURITY.md) before exposing it to anything but localhost.

## Requirements

- **Node.js ≥ 18** (`node -v`). The bridge uses only Node's built-ins plus a few
  small npm packages; the one native dependency is `node-pty`.
- **A C/C++ toolchain** so `node-pty` can build (only for the npx / from-source
  paths — the Docker image builds it for you):
  - **macOS** — Xcode Command Line Tools: `xcode-select --install`.
  - **Linux** — `build-essential` + `python3` (Debian/Ubuntu:
    `sudo apt-get install -y build-essential python3`).
  - **Windows** — Visual Studio Build Tools (C++ workload) + Python 3. The
    simplest route is to install Node via the official installer with the
    "Tools for Native Modules" checkbox ticked.
- **The agent CLI(s) you want to drive** — e.g. `claude` (Claude Code) or
  `codex` — installed and working in your own terminal. The bridge launches
  whatever you register; it does not bundle any agent.
- **Optional:** Docker (only for the container path or for Stage 4 sandboxing),
  and a tunnel CLI (`devtunnel`, `cloudflared`, or `tailscale`) for remote access.

---

## Path A — `npx` (fastest way to try it)

```bash
npx anyagent-bridge
```

This downloads and runs the bridge in one step, then prints an access URL with a
token. Open it in your browser. New to this? Run `npx anyagent-bridge setup` for a
guided, first-timer flow (prerequisite checks + help opening it on a phone or
another PC); see [GETTING-STARTED.md](GETTING-STARTED.md). Useful flags:

```bash
npx anyagent-bridge --port 8080            # listen on a different port
npx anyagent-bridge --host 0.0.0.0         # expose on your LAN (token is the only gate)
npx anyagent-bridge --tunnel devtunnel     # also open a remote tunnel
npx anyagent-bridge --help                 # all flags
```

**State location caveat.** Run this way, the generated token and runtime state
live inside the package's install directory under npm's cache, not in your
current folder. That is fine for a quick try, but for daily or persistent use
prefer **Path B (from source)** or **Path C (Docker)**, where you control where
state lives.

---

## Path B — From source (recommended for regular use)

```bash
git clone https://github.com/elon-choo/anyagent-bridge.git
cd anyagent-bridge
npm ci                       # installs deps and builds node-pty
cp config.example.json config.json
npm start
```

Edit `config.json` to register your agents, projects, and (optionally) auth or
tunnel settings — every field is documented inline in `config.example.json` and
in the README. Environment overrides go in a `.env` file (copy `.env.example`).

On first boot the server generates an access token and saves it to
`.data/auth.json`; the startup banner prints the full URL with the token. Re-runs
reuse the saved token.

To keep it running in the background, use your platform's process manager
(`pm2 start npm --name anyagent-bridge -- start`, a `systemd` unit, a `launchd`
agent, or Windows Task Scheduler).

---

## Path C — Docker / docker-compose (isolated, reproducible)

```bash
git clone https://github.com/elon-choo/anyagent-bridge.git
cd anyagent-bridge
docker compose up -d --build
docker compose logs bridge          # the startup banner prints your access token
```

Then open <http://127.0.0.1:3001> and paste the token. The compose file:

- Publishes the port on **127.0.0.1 only** (localhost). The bridge binds
  `0.0.0.0` *inside* the container; the `ports:` mapping is what controls host
  exposure — keep it on `127.0.0.1` unless you front it with an authenticated
  tunnel/proxy.
- Persists the access token and audit log (both under `.data`) in a named volume
  (`bridge-data`), so they survive `docker compose down && up`. (The session list
  in `sessions.json` lives outside `.data` and is not in the volume.)

**Reading the token without the logs:** pin your own instead —
set `BRIDGE_AUTH_TOKEN` in the `environment:` block of `docker-compose.yml`.

**Agents inside the container.** The image ships the bridge plus a `bash` shell,
**not** the agent CLIs. To launch `claude`/`codex` from within the container you
must either:

1. derive your own image (`FROM anyagent-bridge:local`, then install the agent
   CLI and bake in or mount its credentials), or
2. run the bridge on the host (Path A/B) where your agents already live, and use
   Docker only for Stage 4's per-session sandbox (which runs each session in a
   *separate*, operator-supplied agent image).

Plain shell access and the file API work in the container as-is.

---

## Updating

- **npx** — always fetches the latest published version; nothing to update.
- **From source** — `git pull && npm ci`.
- **Docker** — `git pull && docker compose up -d --build`.

## Uninstalling

- **From source** — delete the cloned folder; it holds `.data/` (including your
  token) and there is no Docker volume to clean up.
- **Docker** — `docker compose down -v` (the `-v` also deletes the `bridge-data`
  volume and its token), then delete the cloned folder.
- **npx** — `npm cache clean --force` removes the cached package.

## Troubleshooting

- **`node-pty` build fails** — you are missing the toolchain above. Install it,
  then `npm ci` again. On Windows, reopen the terminal after installing the
  Build Tools so the new `PATH` is picked up.
- **Port already in use (`EADDRINUSE`)** — pick another port with `--port` /
  `PORT=` / `config.json`.
- **The agent dropdown is empty or "command not found"** — the agent CLI is not
  on the `PATH` of the process running the bridge. Verify it works in the same
  shell, or set an absolute `command` in `config.json`.
- **Remote access not connecting** — see the README's "Remote access" section;
  confirm the tunnel CLI is installed and logged in, and set
  `auth.oauth.callbackBaseUrl` to your public URL when using OAuth behind a tunnel.
