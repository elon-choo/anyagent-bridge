# syntax=docker/dockerfile:1
#
# anyagent-bridge — container image.
# Builds node-pty (a native addon) in a builder stage, then ships a slim runtime
# image that contains only the prebuilt modules and the app source.
#
# NOTE: this image contains the BRIDGE and a bash shell — it does NOT contain the
# AI agent CLIs (claude, codex, ...). To launch an agent from inside the container
# you must derive an image that installs it, or run the bridge on the host (npx /
# npm start) where your agents and their credentials already live. See docs/INSTALL.md.

# ── Build stage: compile native deps (node-pty needs python3 + a C/C++ toolchain) ──
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Production deps only; node-pty compiles here against this image's libc/libstdc++.
RUN npm ci --omit=dev

# ── Runtime stage: slim image with the already-built modules ──────────────────
FROM node:20-bookworm-slim AS runtime
# bash is the shell the bridge spawns for PTY sessions; ca-certificates lets
# agents reach their HTTPS APIs; tini reaps PTY child processes as PID 1.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY client ./client
COPY bin ./bin
COPY config.example.json ./
# Runtime state (token, sessions, audit log, uploads). Mount a volume on /app/.data
# so the generated access token survives restarts (docker-compose.yml does this).
RUN mkdir -p /app/.data /app/uploads \
  && chown -R node:node /app
USER node
EXPOSE 3001
# Node-only healthcheck — no curl/wget needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
