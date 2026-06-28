# Getting started (for first-timers)

New to the terminal or to AI coding agents? This is the gentlest path to running
anyagent-bridge and opening it on your computer, another PC, or your phone. If you
just want the short version, the [README](../README.md) Quick start has it; for the
full reference see [INSTALL.md](INSTALL.md), and **before you let anything but your
own computer reach the bridge, read [SECURITY.md](SECURITY.md).**

## What this is, in one line

anyagent-bridge puts your computer's terminal — and any AI coding agent you've
installed (like Claude Code) — onto a web page, so you can drive it from a browser
on the same computer, another PC, or your phone.

## What you need first

1. **Node.js 18 or newer.** Check by opening a terminal and running `node -v`. No
   Node? Install it from <https://nodejs.org> (the "LTS" button).
2. **An AI agent CLI, optional but recommended.** e.g. Claude Code:
   `npm install -g @anthropic-ai/claude-code`, then run `claude` once to log in.
   Without one you still get a normal shell in the browser; you just can't launch
   an agent until one is installed.

## Step 1 — Run the guided setup

In a terminal, run:

```bash
npx anyagent-bridge setup
```

The first time, npm asks to download the package — say yes. Then a friendly wizard:

- checks your Node version and which agents (`claude`, `codex`) it can find,
- asks **where you want to open the bridge**, and
- starts the server with the right settings and prints your access link.

That's it — you do **not** need to edit any config files to get going.

## Step 2 — Pick where you'll open it

The wizard asks this; here's what each choice means.

### 💻 On this same computer (simplest)

Choose "This computer". When it starts, it prints a line like
`URL: http://127.0.0.1:3001/?token=…`. Open that whole link (including the
`?token=…` part) in your browser. You're in. Nothing is exposed to your network
or the internet.

### 🖥 Another PC or your phone on the same Wi-Fi

Choose "same Wi-Fi". The bridge starts listening on your network and the wizard
prints your computer's address, like `http://192.168.0.8:3001/`. On the other
device's browser, open that address and paste the access token (the long string
the wizard printed). Both devices must be on the same Wi-Fi.

> On your network, **the token is the only lock.** Keep it private.

### 📱 Your phone from anywhere (over the internet)

Choose "phone / anywhere". The wizard helps you turn on a free **tunnel** (a safe
public web address that points back to your computer). When it connects, a public
`https://…` address appears. Open it on your phone, or use the QR (next step).

> Going over the internet means the page is reachable by anyone with the link. The
> token still gates it, but **turn on login / 2FA before you rely on it** — see
> [SECURITY.md](SECURITY.md).

## Step 3 — Open it on your phone by scanning a QR

Once the bridge is open in a browser on your computer, click
**"📱 Connect a device"** in the top bar. A panel pops up with a **QR code** —
point your phone's camera at it and it opens the bridge on your phone, already
logged in. The same panel shows the steps for "this computer", "same Wi-Fi", and
starting an internet tunnel, so you never have to type the long token on a phone.

## Step 4 — Launch an AI agent

In the web terminal you have a real shell. To start an agent, pick it from the
dropdown in the top bar (e.g. **Claude Code**) and click **Start** — it runs inside
the session, streamed live to your browser. Detaching the browser keeps it alive;
reconnect and you're back with full scrollback.

To run the agent inside a specific **project folder**, click **📁 Projects** in the
top bar and *browse* to the folder — no typing the full path. It's saved and shows
up in the toolbar's project dropdown; pick one before launching.

If the agent needs API keys (e.g. `OPENAI_API_KEY`), click **🔑 Secrets**, pick the
project, and add `KEY` + value — it's written to that project's `.env.local` for you,
so you never paste keys into the chat or hand-edit dotfiles.

## If something goes wrong

- **`node -v` says command not found** — install Node.js (above), then reopen the
  terminal.
- **The agent dropdown is empty** — the agent CLI isn't installed or isn't on your
  PATH. Verify it runs in the same terminal (e.g. type `claude`).
- **"Port already in use"** — something else uses port 3001. Run
  `npx anyagent-bridge --port 8080` (any free number) or re-run `setup`.
- **The phone QR / tunnel didn't work** — the tunnel CLI may not be installed; see
  [INSTALL.md](INSTALL.md) → Remote access. On the same Wi-Fi you don't need a
  tunnel at all — use the "same Wi-Fi" address instead.
- **Lost the token** — it's printed in the terminal banner; scroll up, or stop and
  re-run. You can also pin your own with `--token`.
- **Windows: another device can't reach it on Wi-Fi** — the first inbound connection
  triggers a Windows Firewall prompt; click **Allow** (at least for Private networks).
  If you dismissed it, allow `node` in Windows Defender Firewall settings.
- **Windows: a red `'...cmd_autorun.bat' is not recognized…` line at the top of the
  terminal** — that's not an anyagent-bridge error. It's a stale `cmd.exe` AutoRun
  registry key on your machine (`HKCU\Software\Microsoft\Command Processor\AutoRun`);
  the shell still works. Clear that key if you want the line gone.

## Where to go next

- [INSTALL.md](INSTALL.md) — every install path (npx, source, Docker), per-OS notes.
- [SECURITY.md](SECURITY.md) — what to turn on before exposing the bridge. **Read
  this before going remote.**
- [WALKTHROUGH.md](WALKTHROUGH.md) — a screenshot tour of the whole thing.
