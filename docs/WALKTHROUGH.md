# Walkthrough

A guided tour of using anyagent-bridge end to end. Screenshots referenced below
live in [`docs/screenshots/`](screenshots/); placeholders are noted where a real
capture should be dropped in (see [capture instructions](#capturing-screenshots)).

## 1. Start the bridge

```bash
npx anyagent-bridge          # or: npm start  /  docker compose up -d --build
```

The startup banner prints the access URL and token:

```
===============================================================
  AnyAgent Bridge — server running
===============================================================
  URL:       http://127.0.0.1:3001?token=ab12…ef
  WebSocket: ws://127.0.0.1:3001/ws
  Host:      127.0.0.1
  Shell:     /bin/zsh
  Agents:    claude, codex
  ...
  Access token (generated): ab12…ef
===============================================================
```

> _Screenshot placeholder: `screenshots/01-startup-banner.png` — the terminal banner._

## 2. Open the browser UI

Open the printed URL (the `?token=…` logs you in automatically), or visit
<http://127.0.0.1:3001> and paste the token. You land on the terminal view: a full
xterm.js terminal wired to a live shell on your machine, plus a toolbar with the
agent launcher, a file browser, and (if configured) project and tunnel controls.

> _Screenshot placeholder: `screenshots/02-terminal-view.png` — the main terminal UI._

## 3. Launch an AI agent

Pick an agent (e.g. **Claude Code**) from the dropdown and start it. The bridge
spawns the agent's CLI inside the session's PTY, so you interact with it exactly
as you would in your own terminal — streamed live to the browser. Type prompts,
send keys, and watch output in real time. Detaching the browser keeps the session
alive; reconnecting reattaches with full scrollback.

> _Screenshot placeholder: `screenshots/03-agent-running.png` — an agent session in progress._

## 4. Browse and edit files

Use the file panel to browse, open, edit, upload, and download files within the
configured path whitelist. Image uploads are supported (handy for pasting a
screenshot to an agent).

## 5. Go remote (optional)

To reach the bridge from your phone or another machine, enable a tunnel — either
at startup (`--tunnel devtunnel`) or at runtime via the tunnel controls
(`POST /api/tunnel/start`). The banner and the UI show the public URL once it is
ready. Before exposing anything, read [SECURITY.md](SECURITY.md) and turn on
login / 2FA / OAuth.

> _Screenshot placeholder: `screenshots/04-mobile.png` — the UI on a phone over a tunnel._

---

## Capturing screenshots

The placeholders above are intentionally not committed as binaries yet. To
generate real screenshots locally:

1. Start the bridge and note the token: `npm start`.
2. Open the printed URL in a browser (desktop and a phone/responsive view for the
   mobile shot).
3. Capture each state listed above and save it under `docs/screenshots/` with the
   matching filename (`01-startup-banner.png`, `02-terminal-view.png`, …).
4. PNG, ~1400px wide, is plenty. Crop out anything sensitive — **the token in the
   URL bar and any real file contents** — before committing.

Because the token grants full access, never publish a screenshot that shows a
live token, private file paths, or agent credentials.
