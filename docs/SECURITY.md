# Security model & disclaimers

Read this before you expose anyagent-bridge to anything beyond your own machine.

## What you are running

anyagent-bridge gives a web browser **a real terminal and file access on the
machine it runs on**. Anyone who can reach the server *and* holds a valid token
or session can run commands, read and write files (within the configured path
whitelist), and drive your AI coding agents — with the same privileges as the
user running the bridge. Treat the access token like an SSH key.

## Safe by default

Out of the box the bridge is conservative:

- **Binds to `127.0.0.1`** (localhost only). Nothing on your network can reach it
  until you explicitly set `host`/`HOST` to `0.0.0.0` or publish it.
- **No tunnel.** Remote access (Stage 2) is opt-in and off by default.
- **Token required.** A 32-byte random token is generated on first boot and
  saved to `.data/auth.json` with `0600` permissions. There is never a blank or
  default token. Token comparison is constant-time.
- **Path whitelist.** The file API is restricted to configured `allowedPaths`
  (your home directory by default), and a denylist blocks secret-bearing dotfiles
  (`.env`, `.npmrc`, SSH keys, cloud-credential files, …).

## Before you expose it (tunnel or `0.0.0.0`)

The token alone is a single shared secret. When the bridge is reachable beyond
localhost, layer on the opt-in protections:

- **Turn on authentication (Stage 3).** Set `requireLogin` so the static token
  becomes login-only, enroll **TOTP 2FA**, and/or require **Google/GitHub OAuth**
  with an email/login allowlist. With 2FA or `requireLogin` on, a leaked token is
  no longer enough by itself.
- **Use a tunnel that has its own auth.** Microsoft Dev Tunnels can require a
  sign-in; a Cloudflare/Tailscale path can sit behind their access controls.
  Don't put a raw `0.0.0.0` bind directly on the public internet.
- **Pin `auth.oauth.callbackBaseUrl`** to your public URL when OAuth is on behind
  a tunnel, so the redirect URI is not derived from (spoofable) request headers.
- **Set `trustProxy`** (Stage 4) only when you actually sit behind a known proxy,
  so per-client rate limiting and the audit log record the real client IP instead
  of a spoofable `X-Forwarded-For`. Leave it off otherwise.
- **Sandbox the sessions (Stage 4).** Run each session inside a Docker container
  (`safety.sandbox`) so the agent touches only a mounted project directory, with
  memory/CPU/pid limits and `no-new-privileges`. Use `--network none` for an
  offline agent, `readOnlyRootfs`/`dropAllCaps` to harden further.
- **Enable the audit log (Stage 4).** Append-only JSONL of REST mutations and
  agent commands, with secrets redacted. Pair it with the kill-switch
  (`POST /api/safety/panic`) for an emergency stop that kills sessions and locks
  new agent launches.

## Handling secrets

- **Keep OAuth client secrets in environment variables**, not in `config.json`
  (which can be written back to disk at runtime). `config.json` is gitignored.
- The published npm package and the Docker image **exclude** `config.json`,
  `.data/`, `.env`, and `sessions.json` — your token and secrets are never baked
  into a distributable artifact.
- Audit logs are always secret-redacted; live PTY-stream redaction is available
  opt-in (`redaction.liveStream`).

## Known limitations

- Stage 1 ships **no TLS** of its own. Terminate TLS at your tunnel/reverse proxy
  (Dev Tunnels, Cloudflare, etc.) — never send a token over plain `http://` across
  an untrusted network.
- Docker sandboxing is **defense-in-depth, not a security boundary you should bet
  a hostile multi-tenant workload on**. Do not mount the Docker socket into a
  sandboxed session (that is host-equivalent access), and do not bind-mount `$HOME`.
- The bridge is meant for **a single operator controlling their own machine**, not
  as a multi-user SaaS. It is not a substitute for a VPN or a zero-trust gateway
  in a sensitive environment.

## Reporting a vulnerability

Please report security issues **privately** — open a GitHub Security Advisory on
the repository (Security → Report a vulnerability) rather than a public issue, so
a fix can ship before details are public.

## Disclaimer

anyagent-bridge is provided **as-is, under the MIT License, with no warranty**.
You are responsible for how and where you expose it. Running it on a machine with
access to sensitive data or networks is at your own risk.
