/**
 * AnyAgent Bridge — safety subsystem manager (Stage 4)
 *
 * One manager wiring four opt-in safety layers on top of Stage 3:
 *   • Docker sandbox   — run a session's shell (and therefore its agent) inside a
 *                        container instead of on the host.
 *   • Kill-switch      — per-session hard kill + a global panic (kill all, sweep
 *                        stray containers, optionally stop the tunnel and lock the
 *                        bridge against new agent launches).
 *   • Audit log        — JSONL of REST mutations + semantic agent commands.
 *   • Secret redaction — scrub the audit log always; opt-in live PTY-stream redaction.
 *
 * THE CARDINAL RULE: when `safety.enabled` is false (the default), this manager is
 * inert — getStatus() is null, no routes/middleware are mounted, spawnSpecFor()
 * returns null (the session keeps its original host-shell spawn), newLiveStream()
 * is null, handleWsMessage() returns false, canLaunchAgent() is true. The server is
 * byte-identical to Stage 3.
 *
 * Invariant #3 sharpened: NEVER throw. The server's uncaughtException handler does
 * NOT exit on most errors, so a throw from a safety hook would be silently swallowed
 * and leave the bridge half-broken — worse than a crash. Every method is defensive.
 *
 * Zero new npm dependencies — Node core (fs/crypto/path/child_process) + the
 * existing tunnel detect helper.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const sandbox = require('./sandbox');
const { createRedactor } = require('./redact');
const { createAuditLog } = require('./audit');

function asBool(v, dflt) { return v === undefined ? dflt : !!v; }

class SafetyManager {
  constructor(config, deps) {
    const d = deps || {};
    this.logger = d.logger || console;
    this.dataDir = d.dataDir || '.data';
    this.isOperator = typeof d.isOperator === 'function' ? d.isOperator : (() => false);
    this.getClientIP = typeof d.getClientIP === 'function' ? d.getClientIP : (() => 'unknown');
    this.baseShell = d.baseShell || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash');
    this.blockedDirs = Array.isArray(d.blockedDirs) ? d.blockedDirs : [];

    this.cfg = this._normalize(config);
    this.enabled = !!this.cfg.enabled;

    // Redactor knows the bridge's own secrets so they can never leak to the log /
    // stream. The session secret is read best-effort from the auth subsystem's file
    // (we do not modify the auth subsystem to expose it).
    const secrets = [];
    if (d.secrets && d.secrets.authToken) secrets.push(d.secrets.authToken);
    const sessionSecret = (d.secrets && d.secrets.sessionSecret) || this._readSessionSecret();
    if (sessionSecret) secrets.push(sessionSecret);
    this.redactor = createRedactor({ extraSecrets: secrets, maxHoldBytes: this.cfg.redaction.maxHoldBytes });

    this.installId = this._loadOrCreateInstallId();
    this._containerPrefix = `aab-${this.installId}-sess-`;
    this.docker = null;            // { available, path } once detected
    this._sandboxDegraded = false;
    this.locked = false;
    this.audit = null;
  }

  _normalize(c) {
    const cfg = c && typeof c === 'object' ? c : {};
    const sb = cfg.sandbox || {};
    const ks = cfg.killSwitch || {};
    const au = cfg.audit || {};
    const rd = cfg.redaction || {};
    return {
      enabled: !!cfg.enabled,
      sandbox: {
        enabled: !!sb.enabled,
        image: sb.image || null,
        network: sb.network || 'bridge',
        mountMode: sb.mountMode === 'ro' ? 'ro' : 'rw',
        workdir: sb.workdir || '/workspace',
        shell: sb.shell || null,
        memory: sb.memory === null ? null : (sb.memory || '2g'),
        cpus: sb.cpus === null ? null : (sb.cpus || '2'),
        pidsLimit: sb.pidsLimit === null ? null : (sb.pidsLimit || 512),
        noNewPrivileges: asBool(sb.noNewPrivileges, true),
        readOnlyRootfs: !!sb.readOnlyRootfs,
        dropAllCaps: !!sb.dropAllCaps,
        runAsHostUser: !!sb.runAsHostUser,
        envPassthrough: Array.isArray(sb.envPassthrough) ? sb.envPassthrough : ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
        onDockerMissing: sb.onDockerMissing === 'refuse' ? 'refuse' : 'host',
        onMissingProject: sb.onMissingProject === 'refuse' ? 'refuse' : 'host',
        extraArgs: Array.isArray(sb.extraArgs) ? sb.extraArgs : []
      },
      killSwitch: {
        enabled: asBool(ks.enabled, true),
        lockOnPanic: asBool(ks.lockOnPanic, true),
        stopTunnelOnPanic: asBool(ks.stopTunnelOnPanic, true),
        persistLock: asBool(ks.persistLock, true)
      },
      audit: {
        enabled: !!au.enabled,
        dir: au.dir || null,
        includeReads: !!au.includeReads,
        maxFileBytes: au.maxFileBytes || 10 * 1024 * 1024,
        retentionDays: au.retentionDays || 30
      },
      redaction: {
        liveStream: !!rd.liveStream,
        auditAlways: asBool(rd.auditAlways, true),
        maxHoldBytes: rd.maxHoldBytes || 8192
      }
    };
  }

  _readSessionSecret() {
    try {
      const f = path.join(this.dataDir, 'auth-secret.json');
      if (fs.existsSync(f)) {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j && typeof j.secret === 'string') return j.secret;
      }
    } catch (e) { /* best-effort */ }
    return null;
  }

  _loadOrCreateInstallId() {
    const f = path.join(this.dataDir, 'safety.json');
    try {
      if (fs.existsSync(f)) {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (j && typeof j.installId === 'string' && j.installId) return j.installId;
      }
    } catch (e) { /* fall through */ }
    const id = crypto.randomBytes(4).toString('hex');
    try { fs.mkdirSync(this.dataDir, { recursive: true }); fs.writeFileSync(f, JSON.stringify({ installId: id, createdAt: Date.now() }, null, 2), { mode: 0o600 }); } catch (e) { /* ignore */ }
    return id;
  }

  /** Boot-time setup: docker detect, lock-file load, audit init. Never throws. */
  init() {
    if (!this.enabled) return this;
    try {
      if (this.cfg.sandbox.enabled) {
        const p = sandbox.detectDocker();
        this.docker = { available: !!p, path: p };
        if (!p) {
          this.logger.warn(`[Safety] sandbox.enabled but 'docker' is not on PATH — new sessions will ${this.cfg.sandbox.onDockerMissing === 'refuse' ? 'be REFUSED' : 'fall back to a host shell'}.`);
        }
      }
      if (this.cfg.killSwitch.persistLock) this._loadLock();
      if (this.cfg.audit.enabled) {
        const dir = this.cfg.audit.dir ? path.resolve(this.cfg.audit.dir) : path.join(this.dataDir, 'audit');
        this._auditDir = dir;
        this.audit = createAuditLog({
          dir, maxFileBytes: this.cfg.audit.maxFileBytes, retentionDays: this.cfg.audit.retentionDays,
          scrub: (s) => this.redactor.scrub(s), logger: this.logger
        });
      }
    } catch (e) {
      this.logger.warn(`[Safety] init error (continuing): ${e.message}`);
    }
    return this;
  }

  // ── Status ───────────────────────────────────────────────────────────────────
  getStatus() {
    if (!this.enabled) return null; // byte-identical: /api/system/status gets no `safety` key
    return {
      sandbox: this.cfg.sandbox.enabled
        ? { enabled: true, dockerAvailable: !!(this.docker && this.docker.path), image: this.cfg.sandbox.image || null, network: this.cfg.sandbox.network, degraded: this._sandboxDegraded, onDockerMissing: this.cfg.sandbox.onDockerMissing }
        : { enabled: false },
      killSwitch: { enabled: this.cfg.killSwitch.enabled, locked: !!this.locked },
      audit: this.audit ? { enabled: true, entries: this.audit.count(), dir: this._auditDir } : { enabled: false },
      redaction: { liveStream: !!this.cfg.redaction.liveStream, auditAlways: !!this.cfg.redaction.auditAlways },
      auditScope: ['rest-mutations', 'agent.start', 'agent.send', 'kill', 'panic']
    };
  }

  // ── Sandbox spawn spec ─────────────────────────────────────────────────────────
  /**
   * Returns the spawn spec for a sandboxed session, or null to let the caller use
   * its original host-shell spawn (the byte-identical off-path). May also return a
   * { kind:'refuse', message } marker when sandbox is required but unavailable.
   *   session: the TerminalSession (we set session.containerName / _sandboxSpawnAt)
   *   cwd:     the resolved working dir to mount
   *   baseEnv: the env the host shell would have used (process.env minus agent guards)
   */
  spawnSpecFor(session, cwd, baseEnv) {
    if (!this.enabled || !this.cfg.sandbox.enabled) return null;
    if (this._sandboxDegraded) return null; // already fell back this run

    const sb = this.cfg.sandbox;

    if (!this.docker || !this.docker.path) {
      if (sb.onDockerMissing === 'refuse') {
        return { kind: 'refuse', message: '\r\n[sandbox required but docker was not found on PATH — session not started]\r\n' };
      }
      return null; // fall back to host shell
    }
    if (!sandbox.isSandboxableDir(cwd, this.blockedDirs)) {
      if (sb.onMissingProject === 'refuse') {
        return { kind: 'refuse', message: '\r\n[sandbox refuses to mount your home directory — open a project folder instead]\r\n' };
      }
      this.logger.warn(`[Safety] session ${session.sessionId} has no bounded project dir — running on host (not sandboxed).`);
      return null;
    }
    if (!sb.image) {
      this.logger.warn('[Safety] sandbox.enabled but no image is set — running on host. Set safety.sandbox.image to an image that contains your agent CLI.');
      return null;
    }

    try {
      const cname = `${this._containerPrefix}${session.sessionId}-${crypto.randomBytes(3).toString('hex')}`;
      const passthrough = sandbox.resolvePassthrough(sb.envPassthrough, process.env);
      const env = sandbox.buildClientEnv(passthrough, process.env);
      const args = sandbox.buildDockerArgs({ containerName: cname, hostProjectDir: cwd, image: sb.image, passthroughNames: passthrough, cfg: sb });
      session.containerName = cname;
      session._sandboxSpawnAt = Date.now();
      return { kind: 'sandbox', file: this.docker.path, args, env, cwd, containerName: cname, sandboxed: true };
    } catch (e) {
      this.logger.warn(`[Safety] failed to build sandbox spec (${e.message}) — running on host.`);
      return null;
    }
  }

  /** A sandboxed PTY exited; if it died fast, count it toward auto-degrade. */
  noteSandboxExit(session) {
    if (!this.enabled || !session || !session._sandboxSpawnAt) return;
    const fast = Date.now() - session._sandboxSpawnAt < 4000;
    session._sandboxSpawnAt = 0;
    if (!fast) return;
    const now = Date.now();
    if (!this._sbWindow || now - this._sbWindow > 30000) { this._sbWindow = now; this._sbFails = 0; }
    this._sbFails = (this._sbFails || 0) + 1;
    if (this._sbFails >= 2 && !this._sandboxDegraded) {
      this._sandboxDegraded = true;
      this.logger.warn('[Safety] sandbox repeatedly failed to start — falling back to a host shell for new spawns. Check the docker daemon and the configured image.');
    }
  }

  // ── Redaction ──────────────────────────────────────────────────────────────────
  /** A stateful live-stream redactor for one PTY, or null when live redaction is off. */
  newLiveStream() {
    if (!this.enabled || !this.cfg.redaction.liveStream) return null;
    try { return this.redactor.createStream(); } catch (e) { return null; }
  }

  scrub(s) { try { return this.redactor.scrub(s); } catch (e) { return s; } }

  // ── Kill-switch ────────────────────────────────────────────────────────────────
  canLaunchAgent() { return !this.locked; }

  reapContainer(name) {
    if (!name || !this.docker || !this.docker.path) return;
    this._runDocker(['rm', '-f', name], () => {}); // best-effort; ignores "no such container"
  }

  killSession(session, sessions, saveSessions) {
    if (!session) return;
    try { if (session.ptyProcess) session.ptyProcess.kill('SIGKILL'); } catch (e) { /* ignore */ }
    try { session.destroy(); } catch (e) { /* destroy reaps the container + closes clients */ }
    try { if (sessions) sessions.delete(session.sessionId); } catch (e) { /* ignore */ }
    try { if (saveSessions) saveSessions(); } catch (e) { /* ignore */ }
  }

  async panic(ctx) {
    const c = ctx || {};
    const opts = c.opts || {};
    const sessions = c.sessions;
    const killed = [];
    if (sessions && typeof sessions.forEach === 'function') {
      for (const s of Array.from(sessions.values())) {
        killed.push(s.sessionId);
        this.killSession(s, sessions, null);
      }
      try { if (c.saveSessions) c.saveSessions(); } catch (e) { /* ignore */ }
    }
    this._sweepContainers();

    let tunnelStopped = false;
    const wantStopTunnel = opts.stopTunnel !== undefined ? !!opts.stopTunnel : this.cfg.killSwitch.stopTunnelOnPanic;
    if (wantStopTunnel && c.tunnel && typeof c.tunnel.stop === 'function') {
      try { await c.tunnel.stop(); tunnelStopped = true; } catch (e) { /* ignore */ }
    }
    const wantLock = opts.lock !== undefined ? !!opts.lock : this.cfg.killSwitch.lockOnPanic;
    if (wantLock) this._setLock(true);

    this._auditEvent({ action: 'panic', actor: c.actor || null, note: `killed ${killed.length} session(s); tunnelStopped=${tunnelStopped}; locked=${this.locked}` });
    return { killedSessions: killed, tunnelStopped, locked: !!this.locked };
  }

  _setLock(v) {
    this.locked = !!v;
    if (!this.cfg.killSwitch.persistLock) return;
    const f = path.join(this.dataDir, 'safety-lock.json');
    try {
      if (this.locked) fs.writeFileSync(f, JSON.stringify({ locked: true, at: Date.now() }, null, 2), { mode: 0o600 });
      else if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (e) { /* ignore */ }
  }

  _loadLock() {
    const f = path.join(this.dataDir, 'safety-lock.json');
    try { if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); this.locked = !!(j && j.locked); } } catch (e) { /* ignore */ }
  }

  _runDocker(args, onDone) {
    if (!this.docker || !this.docker.path) { if (onDone) onDone(new Error('docker not found'), ''); return; }
    let out = '';
    try {
      const cp = spawn(this.docker.path, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      cp.stdout.on('data', (d) => { out += d.toString(); });
      cp.on('error', (e) => { if (onDone) onDone(e, out); });
      cp.on('close', () => { if (onDone) onDone(null, out); });
    } catch (e) { if (onDone) onDone(e, out); }
  }

  /** Best-effort sweep of THIS install's stray containers (e.g. crash orphans). */
  _sweepContainers() {
    if (!this.docker || !this.docker.path) return;
    this._runDocker(['ps', '-a', '-q', '--filter', `name=${this._containerPrefix}`], (err, out) => {
      if (err || !out) return;
      const ids = out.split('\n').map(s => s.trim()).filter(Boolean);
      for (const id of ids) this._runDocker(['rm', '-f', id], () => {});
    });
  }

  // ── Audit ──────────────────────────────────────────────────────────────────────
  installAuditMiddleware(app) {
    if (!this.enabled || !this.audit) return; // byte-identical: nothing added to the pipeline
    const self = this;
    // Mounted before the route definitions so its res.on('finish') fires for every
    // /api route (incl. auth, which registers earlier) AFTER per-route requireAuth has
    // populated req.principal. A cheap pre-filter avoids attaching a finish listener to
    // static-asset / non-API / read requests.
    app.use((req, res, next) => {
      const m = req.method;
      const mutating = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
      if ((mutating || self.cfg.audit.includeReads) && typeof req.path === 'string' && req.path.indexOf('/api/') === 0) {
        res.on('finish', () => { try { self.auditHttp(req, res); } catch (e) { /* never throw from a hook */ } });
      }
      next();
    });
  }

  auditHttp(req, res) {
    if (!this.audit) return;
    const m = req.method;
    const mutating = m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
    if (!mutating && !this.cfg.audit.includeReads) return;
    const p = req.path || '';
    if (p.indexOf('/api/') !== 0) return; // only the API surface
    const body = req.body || {};
    const query = req.query || {};
    const params = req.params || {};
    const target = body.path || body.oldPath || body.sourcePath || query.path || params.sessionId || params.name;
    this._auditEvent({
      action: this._classify(m, p),
      method: m,
      path: p,
      target: target != null ? String(target) : undefined,
      actor: this._actorFromPrincipal(req.principal),
      clientIP: this._safeClientIP(req),
      status: res.statusCode
    });
  }

  auditWs(action, info) {
    if (!this.audit) return;
    this._auditEvent({
      action,
      actor: this._actorFromPrincipal(info && info.principal),
      target: info && info.target != null ? String(info.target) : undefined,
      termSessionId: info && info.termSessionId,
      clientIP: info && info.clientIP
    });
  }

  _auditEvent(e) { try { if (this.audit) this.audit.record(e); } catch (err) { /* never throw */ } }

  _safeClientIP(req) { try { return this.getClientIP(req); } catch (e) { return 'unknown'; } }

  _classify(method, p) {
    if (p.indexOf('/api/auth/') === 0) {
      if (p.indexOf('/login') !== -1) return 'auth.login';
      if (p.indexOf('/logout') !== -1) return 'auth.logout';
      if (p.indexOf('/oauth/') !== -1) return 'auth.oauth';
      if (p.indexOf('/totp/') !== -1) return 'auth.totp';
      if (p.indexOf('/sessions') !== -1) return 'auth.session';
      return `auth ${method}`;
    }
    if (p.indexOf('/api/safety/') === 0) return `safety.${p.split('/')[3] || 'action'}`;
    if (p.indexOf('/api/tunnel/') === 0) return `tunnel.${p.split('/')[3] || 'action'}`;
    if (p.indexOf('/api/sessions') === 0) return method === 'DELETE' ? 'session.delete' : 'session.update';
    if (p.indexOf('/api/projects') === 0) return method === 'DELETE' ? 'project.delete' : 'project.update';
    if (p.indexOf('/api/folder') === 0 || p.indexOf('/create-folder') !== -1 || p.indexOf('/mkdir') !== -1) return 'folder.create';
    if (p.indexOf('/upload') !== -1) return 'file.upload';
    if (p.indexOf('/rename') !== -1) return 'file.rename';
    if (p.indexOf('/move') !== -1) return 'file.move';
    if (p.indexOf('/file') !== -1 || p.indexOf('/explorer/') !== -1) {
      if (method === 'DELETE') return 'file.delete';
      if (method === 'POST') return 'file.create';
      return 'file.write';
    }
    return `${method} ${p}`;
  }

  _actorFromPrincipal(p) {
    if (!p) return null;
    if (p.type === 'token') return { type: 'token', provider: 'token', sub: 'operator' };
    const s = p.session || {};
    return { type: 'session', provider: s.provider || 'unknown', sub: s.sub || s.login || s.email || s.id || 'session' };
  }

  // ── WebSocket control + audit ──────────────────────────────────────────────────
  /** Consume operator panic/kill WS messages. Returns false (off or not consumed). */
  handleWsMessage(msg, ctx) {
    if (!this.enabled || !msg) return false;
    if (msg.type !== 'panic' && msg.type !== 'kill') return false;
    const c = ctx || {};
    if (!this.isOperator(c.principal)) {
      try { c.ws.send(JSON.stringify({ type: 'error', message: 'Operator only' })); } catch (e) { /* ignore */ }
      return true;
    }
    if (msg.type === 'kill') {
      const id = parseInt(msg.sessionId, 10);
      const s = c.sessions ? c.sessions.get(id) : null;
      if (s) this.killSession(s, c.sessions, c.saveSessions);
      this._auditEvent({ action: 'kill', actor: this._actorFromPrincipal(c.principal), target: String(msg.sessionId), clientIP: c.clientIP });
      try { c.ws.send(JSON.stringify({ type: 'killed', sessionId: msg.sessionId })); } catch (e) { /* ignore */ }
    } else {
      Promise.resolve(this.panic({
        sessions: c.sessions, tunnel: c.tunnel, saveSessions: c.saveSessions,
        opts: { stopTunnel: msg.stopTunnel, lock: msg.lock }, actor: this._actorFromPrincipal(c.principal)
      })).then((r) => { try { c.ws.send(JSON.stringify({ type: 'panicked', result: r })); } catch (e) {} }).catch(() => {});
    }
    return true;
  }

  // ── Routes ───────────────────────────────────────────────────────────────────
  registerRoutes(app, deps) {
    if (!this.enabled) return; // byte-identical: no /api/safety/* routes exist
    const d = deps || {};
    const requireAuth = d.requireAuth || ((req, res, next) => next());
    const self = this;
    const operatorOnly = (req, res, next) => {
      if (self.isOperator(req.principal)) return next();
      return res.status(403).json({ error: 'Operator only' });
    };

    app.get('/api/safety/status', requireAuth, (req, res) => {
      res.json(self.getStatus() || { enabled: false });
    });

    app.post('/api/safety/kill/:sessionId', requireAuth, operatorOnly, (req, res) => {
      const id = parseInt(req.params.sessionId, 10);
      const s = d.sessions ? d.sessions.get(id) : null;
      if (!s) return res.status(404).json({ error: 'Session not found' });
      self.killSession(s, d.sessions, d.saveSessions);
      res.json({ success: true, killed: id });
    });

    app.post('/api/safety/panic', requireAuth, operatorOnly, async (req, res) => {
      const body = req.body || {};
      const result = await self.panic({
        sessions: d.sessions, tunnel: d.tunnel, saveSessions: d.saveSessions,
        opts: { stopTunnel: body.stopTunnel, lock: body.lock }, actor: self._actorFromPrincipal(req.principal)
      });
      res.json({ success: true, ...result });
    });

    app.post('/api/safety/unlock', requireAuth, operatorOnly, (req, res) => {
      self._setLock(false);
      self._auditEvent({ action: 'unlock', actor: self._actorFromPrincipal(req.principal) });
      res.json({ success: true, locked: self.locked });
    });
  }

  // ── Boot banner + shutdown ─────────────────────────────────────────────────────
  bootSummaryLines() {
    if (!this.enabled) return []; // byte-identical banner when off
    const lines = [];
    if (this.cfg.sandbox.enabled) {
      const dock = this.docker && this.docker.path ? 'docker found' : `docker MISSING (onMissing=${this.cfg.sandbox.onDockerMissing})`;
      lines.push(`  Sandbox:   on — image=${this.cfg.sandbox.image || '(unset!)'} network=${this.cfg.sandbox.network} [${dock}]`);
      if (this.cfg.sandbox.network === 'none') lines.push('             NOTE: network=none — agents that call an API (Claude/Codex) will fail; set network=bridge.');
      if (!this.cfg.sandbox.image) lines.push('             NOTE: no image set — sessions run on the host until safety.sandbox.image is configured.');
    }
    if (this.audit) lines.push(`  Audit:     on — ${this._auditDir}`);
    if (this.cfg.redaction.liveStream) lines.push('  Redaction: live PTY-stream ON (best-effort; audit log is always redacted)');
    if (this.locked) {
      lines.push('  SAFETY:    bridge is LOCKED (panic) — new agent launches are refused.');
      lines.push('             Unlock: POST /api/safety/unlock  (operator credential required)');
    }
    return lines;
  }

  flushSync() { try { if (this.audit) this.audit.flushSync(); } catch (e) { /* ignore */ } }

  /** Best-effort container sweep on shutdown (non-blocking). */
  sweepOnShutdown() { try { if (this.enabled && this.cfg.sandbox.enabled) this._sweepContainers(); } catch (e) { /* ignore */ } }
}

module.exports = SafetyManager;
