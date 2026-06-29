# AGENTS.md — install & run playbook for AI agents

This file tells a **command-capable** AI coding agent (Claude Code, Codex, or
similar) how to install, launch, and verify **anyagent-bridge** on the user's
computer with as little help from the user as possible. If you are such an agent
and the user handed you this repository (or its URL) and asked you to "install /
set it up / run it," follow this playbook top to bottom.

> Just chatting, with no ability to run commands? You can't install this — tell the
> user they need a command-capable agent (e.g. Claude Code or Codex) and point them
> at the README **Quick start** (`npx anyagent-bridge setup`) instead.

## Principles (read first)

1. **Do everything you can yourself** — clone, install deps, run tests, boot the
   server, verify over HTTP/WebSocket, read and parse logs. Don't hand a step to the
   user that you are able to do.
2. **Ask before these (approval gate).** Report what you're about to do, why, and its
   effect in 1–2 lines, then wait for a yes:
   - installing anything **globally** (`npm i -g …`, a tunnel CLI),
   - opening an **internet tunnel** (it makes this machine reachable from outside),
   - changing firewall or system settings.
3. **Only the user can do these — ask for exactly that one step and nothing more:**
   - **log in** to the agent CLI in a browser (OAuth): run `claude` (or `codex`) once
     and sign in,
   - click **Allow** on a Windows Firewall popup (LAN use),
   - **scan a QR** with their phone.
4. **Report each step as PASS / FAIL / skipped with one line of evidence.** Never
   claim a success you didn't actually observe; don't fill gaps with guesses.
5. **Never expose the machine without an explicit yes.** Default to localhost. Don't
   run an unknown `npx`, and don't download a binary the user hasn't approved.

## Steps

### 0 — Environment

Confirm `node -v` (must be **18+**), `npm -v`, `git --version`. If Node is missing,
[approval] offer to install it (`winget install OpenJS.NodeJS.LTS` on Windows,
`brew install node` on macOS, or nvm), otherwise point the user to <https://nodejs.org>.

### 1 — Get the code + dependencies

```bash
git clone https://github.com/elon-choo/anyagent-bridge.git
cd anyagent-bridge
npm ci        # or: npm install
```

`node-pty` ships prebuilt binaries for common platforms, so this usually needs no
compiler. If the build fails, see **README → Install** for the per-OS toolchain.

### 2 — Test (proves the install is sound)

```bash
npm test
```

Expect both suites to pass (`stage4-smoke` + `stage4-boot`), exit 0. If a suite fails,
**stop and show the user the failing output** — don't continue past a failed test.

### 3 — Launch

Non-interactive — best for you to run unattended (zero prompts, **localhost only,
no tunnel, no global install**):

```bash
node bin/anyagent-bridge.js setup --yes
```

The banner prints the access **URL** and **token**. Run it in the background / a separate
process so you can keep working while it serves. If the banner scrolled away, the token is
also saved to `.data/auth.json`.

> **Port 3001 already in use, or want a fixed token?** On the `setup` path set these with
> **environment variables, not flags** (the `setup` subcommand reads `PORT` / `BRIDGE_AUTH_TOKEN`
> from the env and ignores bare `--port` / `--token`):
> `PORT=8080 BRIDGE_AUTH_TOKEN=<your-token> node bin/anyagent-bridge.js setup --yes`
> — PowerShell: `$env:PORT=8080; node bin/anyagent-bridge.js setup --yes`.
> (The bare `--port` / `--token` flags work on the plain `node bin/anyagent-bridge.js`
> launcher, which is also localhost-only by default.)

### 4 — Verify the terminal works (no browser required)

Open a WebSocket to `ws://127.0.0.1:<port>/ws?token=<TOKEN>`, send
`{"type":"init","cols":80,"rows":24}` then `{"type":"input","data":"echo HELLO_AAB\r"}`,
and confirm `HELLO_AAB` comes back in an `output` message. That proves the terminal is
live. **End every input line with `\r`** (carriage return) — `\n` types the text but
does not run it on Windows `cmd.exe`.

### 5 — Launch an AI agent inside the bridge

- Check the agent CLI is on PATH (`claude` and/or `codex`). If neither is installed:
  [approval] `npm i -g @anthropic-ai/claude-code` **or** `npm i -g @openai/codex`
  (ask the user which they want; install only what they approve). Use **exactly** these
  two package names — if an install fails, report it to the user rather than substituting
  a similarly-named package.
- [user step] Ask the user to run that CLI once and **log in** (browser OAuth) — you
  cannot do this for them.
- Then start it: WebSocket `{"type":"startAgent","agentId":"claude"}` (or `"codex"`),
  or the **Start** button in the browser UI. The agent's welcome / "trust this folder"
  screen appearing in the terminal = success.

### 6 — (Optional) Go remote — approval gate

Only if the user wants phone or internet access:

- First **stop the localhost server you started in Step 3** (Ctrl-C / kill it) — only one
  process can hold the port, so the tunnel runs on a fresh launch, not a second instance.
- [approval] open a free tunnel: `node bin/anyagent-bridge.js --tunnel cloudflare-quick`
  (needs `cloudflared`; [approval] install it first if missing — do **not** silently
  download it). A public `https://…` URL prints. (`--tunnel` goes on the plain launcher,
  not `setup --yes`, which is always localhost-only.)
- Have the user read **docs/SECURITY.md** and turn on login / 2FA before sharing it.
- Phone QR: in the UI, **📱 Connect a device** → the user scans it.

### 7 — Hand off

Tell the user the local URL + token, what's running, and the one or two things they
did themselves (login, any approval). Stop the server (Ctrl-C / kill the process) when
they're done.

## Good to know

- `setup --yes` is safe to run unattended: it never installs anything globally and
  never opens a tunnel — localhost only by design.
- Everything `setup` does is also reachable with plain flags + `npm start`; nothing here
  changes how the server runs.
- Full human walkthrough: **docs/GETTING-STARTED.md** · security model: **docs/SECURITY.md**.
