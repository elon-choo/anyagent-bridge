/**
 * AnyAgent Bridge — Server (Stage 1: core)
 *
 * Control your local terminal and any CLI AI coding agent (Claude Code, Codex,
 * aider, ...) from a web browser. Cross-platform (macOS / Windows / Linux).
 *
 * Stage 1 scope: terminal PTY bridge over WebSocket, persistent sessions,
 * file-management API with a path whitelist, token auth. No tunnel (Stage 2),
 * no OAuth (Stage 3), no sandbox (Stage 4), no packaging (Stage 5) — only clean
 * extension seams are left in place.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const WebSocket = require('ws');
const pty = require('node-pty');
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const crypto = require('crypto');
const { createTunnelManager } = require('./tunnel');
const { createAuthManager } = require('./auth');

const ROOT = path.join(__dirname, '..');
const HOME = os.homedir();

// ═══════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════
//
// Load config.json (runtime, gitignored). If absent, fall back to
// config.example.json, then to built-in defaults — so the very first boot works
// with no config file present.

const DEFAULT_CONFIG = {
  host: '127.0.0.1',
  port: 3001,
  shell: null,
  auth: {
    token: null,
    sessionTtlHours: 12,
    sessionSecret: null,
    requireLogin: false,
    totp: { enabled: true, issuer: 'AnyAgent Bridge', label: 'operator' },
    oauth: {
      enabled: false,
      callbackBaseUrl: null,
      claimFirstUser: true,
      google: { clientId: null, clientSecret: null, allowedEmails: [] },
      github: { clientId: null, clientSecret: null, allowedLogins: [] }
    }
  },
  agents: [
    { id: 'claude', name: 'Claude Code', command: 'claude' },
    { id: 'codex', name: 'Codex', command: 'codex' }
  ],
  projects: [],
  allowedPaths: [],
  sessionTimeoutDays: 7,
  tunnel: { enabled: false, provider: 'devtunnel' }
};

function loadConfig() {
  const candidates = [
    path.join(ROOT, 'config.json'),
    path.join(ROOT, 'config.example.json')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(`[Config] Loaded ${path.basename(file)}`);
        const pa = parsed.auth || {};
        const po = pa.oauth || {};
        return {
          ...DEFAULT_CONFIG, ...parsed,
          auth: {
            ...DEFAULT_CONFIG.auth, ...pa,
            totp:  { ...DEFAULT_CONFIG.auth.totp,  ...(pa.totp  || {}) },
            oauth: {
              ...DEFAULT_CONFIG.auth.oauth, ...po,
              google: { ...DEFAULT_CONFIG.auth.oauth.google, ...(po.google || {}) },
              github: { ...DEFAULT_CONFIG.auth.oauth.github, ...(po.github || {}) }
            }
          },
          tunnel: { ...DEFAULT_CONFIG.tunnel, ...(parsed.tunnel || {}) }
        };
      }
    } catch (e) {
      console.error(`[Config] Failed to parse ${path.basename(file)}: ${e.message}`);
    }
  }
  console.log('[Config] No config file found — using built-in defaults');
  return { ...DEFAULT_CONFIG };
}

const config = loadConfig();

// Cross-platform shell auto-detection.
// config.shell wins; otherwise: win32 → COMSPEC || powershell.exe, else SHELL || /bin/bash.
function resolveShell() {
  if (config.shell) return config.shell;
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

// Data directory (runtime state, gitignored).
const DATA_DIR = path.join(ROOT, '.data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* exists */ }

const CONFIG = {
  HOST: process.env.HOST || config.host || '127.0.0.1',
  PORT: parseInt(process.env.PORT, 10) || config.port || 3001,
  SHELL: resolveShell(),
  AGENTS: Array.isArray(config.agents) ? config.agents : [],
  PROJECTS: Array.isArray(config.projects) ? config.projects : [],
  SESSION_TIMEOUT: (config.sessionTimeoutDays || 7) * 24 * 60 * 60 * 1000,
  SCROLLBACK_LIMIT: 10000,
  SESSION_SAVE_PATH: path.join(ROOT, 'sessions.json'),
  AUTH_FILE: path.join(DATA_DIR, 'auth.json'),
  TUNNEL: (() => {
    const t = { ...config.tunnel };
    t.enabled = process.env.BRIDGE_TUNNEL_ENABLED === undefined
      ? !!config.tunnel.enabled
      : /^(1|true)$/i.test(process.env.BRIDGE_TUNNEL_ENABLED);
    t.provider = process.env.BRIDGE_TUNNEL_PROVIDER || config.tunnel.provider || 'devtunnel';
    if (process.env.BRIDGE_TUNNEL_HOSTNAME) {
      t['cloudflared-named'] = { ...(t['cloudflared-named'] || {}), hostname: process.env.BRIDGE_TUNNEL_HOSTNAME };
    }
    return t;
  })(),
  AUTH: (() => {
    const a = JSON.parse(JSON.stringify(config.auth || {})); // deep copy; never mutate loaded config
    const envBool = (v) => /^(1|true)$/i.test(String(v));
    if (process.env.BRIDGE_REQUIRE_LOGIN !== undefined) a.requireLogin = envBool(process.env.BRIDGE_REQUIRE_LOGIN);
    if (process.env.BRIDGE_SESSION_SECRET) a.sessionSecret = process.env.BRIDGE_SESSION_SECRET;
    if (process.env.BRIDGE_SESSION_TTL_HOURS) a.sessionTtlHours = parseInt(process.env.BRIDGE_SESSION_TTL_HOURS, 10) || a.sessionTtlHours;
    a.totp = a.totp || {};
    if (process.env.BRIDGE_TOTP_ENABLED !== undefined) a.totp.enabled = envBool(process.env.BRIDGE_TOTP_ENABLED);
    a.oauth = a.oauth || {};
    a.oauth.google = a.oauth.google || {};
    a.oauth.github = a.oauth.github || {};
    if (process.env.BRIDGE_OAUTH_ENABLED !== undefined) a.oauth.enabled = envBool(process.env.BRIDGE_OAUTH_ENABLED);
    if (process.env.BRIDGE_OAUTH_CALLBACK_URL) a.oauth.callbackBaseUrl = process.env.BRIDGE_OAUTH_CALLBACK_URL;
    if (process.env.BRIDGE_GOOGLE_CLIENT_ID) a.oauth.google.clientId = process.env.BRIDGE_GOOGLE_CLIENT_ID;
    if (process.env.BRIDGE_GOOGLE_CLIENT_SECRET) a.oauth.google.clientSecret = process.env.BRIDGE_GOOGLE_CLIENT_SECRET;
    if (process.env.BRIDGE_GITHUB_CLIENT_ID) a.oauth.github.clientId = process.env.BRIDGE_GITHUB_CLIENT_ID;
    if (process.env.BRIDGE_GITHUB_CLIENT_SECRET) a.oauth.github.clientSecret = process.env.BRIDGE_GITHUB_CLIENT_SECRET;
    return a;
  })()
};

// ═══════════════════════════════════════════════════════════════════════════
// Auth token
// ═══════════════════════════════════════════════════════════════════════════
//
// Token resolution order: env BRIDGE_AUTH_TOKEN → config.auth.token →
// persisted .data/auth.json → freshly generated (32 random bytes, hex) and
// persisted. There is never a default/blank token.

function loadOrCreateAuthToken() {
  const fromEnv = process.env.BRIDGE_AUTH_TOKEN;
  if (fromEnv) return { token: fromEnv, source: 'env' };

  if (config.auth && config.auth.token) {
    return { token: config.auth.token, source: 'config' };
  }

  try {
    if (fs.existsSync(CONFIG.AUTH_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.AUTH_FILE, 'utf8'));
      if (data && data.token) return { token: data.token, source: 'file' };
    }
  } catch (e) {
    console.error(`[Auth] Failed to read ${CONFIG.AUTH_FILE}: ${e.message}`);
  }

  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(CONFIG.AUTH_FILE, JSON.stringify({ token, createdAt: Date.now() }, null, 2), { mode: 0o600 });
  } catch (e) {
    console.error(`[Auth] Failed to persist token to ${CONFIG.AUTH_FILE}: ${e.message}`);
  }
  return { token, source: 'generated' };
}

const { token: AUTH_TOKEN, source: AUTH_TOKEN_SOURCE } = loadOrCreateAuthToken();

// Stage 2: tunnel manager (created idle; started after server.listen if enabled).
const tunnel = createTunnelManager(CONFIG.TUNNEL, console);

// ═══════════════════════════════════════════════════════════════════════════
// Security: path whitelist + rate limiting helpers
// ═══════════════════════════════════════════════════════════════════════════

// Allowed base paths for the file API. config.allowedPaths, or [HOME] by default.
const ALLOWED_BASE_PATHS = (Array.isArray(config.allowedPaths) && config.allowedPaths.length > 0)
  ? config.allowedPaths.map(p => path.resolve(p.replace(/^~(?=$|[/\\])/, HOME)))
  : [HOME];

// Sensitive directories denied even inside allowed bases (home-relative) plus the
// app's own .data dir (holds the auth token). Additive defense only.
const DENIED_PATHS = [
  '.ssh', '.aws', '.gnupg', '.kube', path.join('.config', 'gcloud'),
  // Common secret-bearing dotfiles: deny even though an authenticated user has a
  // shell anyway — keeps the file API from being a quieter path to credentials.
  '.env', '.npmrc', '.netrc', '.git-credentials',
  path.join('.docker', 'config.json'), path.join('.config', 'gh'), path.join('.config', 'configstore')
].map(seg => path.resolve(HOME, seg));
DENIED_PATHS.push(path.resolve(DATA_DIR));

function isPathDenied(normalizedPath) {
  return DENIED_PATHS.some(denied =>
    normalizedPath === denied || normalizedPath.startsWith(denied + path.sep));
}

function isPathAllowed(targetPath) {
  if (!targetPath) return false;
  const normalizedPath = path.resolve(targetPath);
  if (isPathDenied(normalizedPath)) return false;
  // path.sep suffix prevents sibling-prefix escapes (e.g. /home/userEVIL).
  return ALLOWED_BASE_PATHS.some(basePath => {
    const normalizedBase = path.resolve(basePath);
    return normalizedPath === normalizedBase || normalizedPath.startsWith(normalizedBase + path.sep);
  });
}

// Rate limiting (structure preserved for Stage 3 OAuth/login hardening).
const SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_TIME: 15 * 60 * 1000,
  GLOBAL_MAX_LOGIN_FAILS: 20
};

const rateLimiter = {
  loginAttempts: new Map(), // ip -> { count, lastAttempt }
  globalFails: { count: 0, windowStart: 0 }
};

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket?.remoteAddress ||
         'unknown';
}

function checkLoginRateLimit(ip) {
  const g = rateLimiter.globalFails;
  if (Date.now() - g.windowStart > SECURITY.LOGIN_LOCKOUT_TIME) {
    g.count = 0;
    g.windowStart = Date.now();
  }
  if (g.count >= SECURITY.GLOBAL_MAX_LOGIN_FAILS) return false;

  const record = rateLimiter.loginAttempts.get(ip);
  if (!record) return true;
  if (Date.now() - record.lastAttempt > SECURITY.LOGIN_LOCKOUT_TIME) {
    rateLimiter.loginAttempts.delete(ip);
    return true;
  }
  return record.count < SECURITY.MAX_LOGIN_ATTEMPTS;
}

function recordLoginAttempt(ip, success) {
  if (success) {
    rateLimiter.loginAttempts.delete(ip);
    return;
  }
  const g = rateLimiter.globalFails;
  if (Date.now() - g.windowStart > SECURITY.LOGIN_LOCKOUT_TIME) {
    g.count = 0;
    g.windowStart = Date.now();
  }
  g.count++;

  const record = rateLimiter.loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  record.count++;
  record.lastAttempt = Date.now();
  rateLimiter.loginAttempts.set(ip, record);
}

/** Constant-time string comparison (timing side-channel safe). */
function safeEqual(a, b) {
  const ba = Buffer.from(a == null ? '' : String(a), 'utf8');
  const bb = Buffer.from(b == null ? '' : String(b), 'utf8');
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(bb, bb); // flatten branch timing
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

// Stage 3: auth manager (signed sessions + TOTP 2FA + Google/GitHub OAuth),
// layered on top of the Stage 1 static token. When OAuth is off, no TOTP is
// enrolled, and requireLogin is false, this is a no-op and the static token
// works everywhere exactly as in Stage 2.
const auth = createAuthManager(CONFIG.AUTH, {
  logger: console,
  dataDir: DATA_DIR,
  staticToken: AUTH_TOKEN,
  safeEqual,
  getClientIP,
  rateLimit: { check: checkLoginRateLimit, record: recordLoginAttempt }
});

/**
 * Auth middleware. Accepts the static token (when direct access is allowed) OR a
 * valid signed session presented via cookie / Bearer / X-Session-Token / ?token /
 * ?session. On success sets req.principal = {type:'token'} | {type:'session',...}.
 */
function requireAuth(req, res, next) {
  const principal = auth.resolvePrincipal(req);
  if (principal) { req.principal = principal; return next(); }
  return res.status(401).json({ error: 'Authentication required' });
}

// ═══════════════════════════════════════════════════════════════════════════
// Express app
// ═══════════════════════════════════════════════════════════════════════════

const app = express();
const server = http.createServer(app);

// CORS: allow same-origin / no-origin (curl, mobile) and localhost variants by
// default. Public hosts must rely on the token; CORS is config-driven later.
const corsAllowed = new Set([
  `http://localhost:${CONFIG.PORT}`,
  `http://127.0.0.1:${CONFIG.PORT}`,
  process.env.ALLOWED_ORIGIN
].filter(Boolean));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (corsAllowed.has(origin)) return callback(null, true);
    // Silent reject (never throw — avoids crashing the request pipeline).
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json());

// Stage 3: parse the Cookie header into req.cookies (no dependency) so the auth
// middleware can read the session cookie.
app.use((req, res, next) => { req.cookies = auth.parseCookies(req.headers.cookie); next(); });

// Stage 3: CSRF defense-in-depth. The session cookie is SameSite=Lax, which
// already blocks it from riding cross-site writes; this additionally rejects any
// state-changing request that carries the session cookie with a cross-origin
// Origin header. Token/Bearer clients (curl, the default-mode UI) send no cookie
// and are unaffected — a bearer credential is not CSRF-able.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!(req.cookies && req.cookies['aab_session'])) return next();
  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser client, or same-origin without Origin
  try {
    const reqHost = req.headers['x-forwarded-host'] || req.headers.host;
    if (new URL(origin).host !== reqHost) {
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
  } catch (e) {
    return res.status(403).json({ error: 'Invalid Origin header' });
  }
  next();
});

// Mount /api/auth/* routes (login, OAuth, TOTP, sessions).
auth.registerRoutes(app, { requireAuth });

// Static client (no caching so updates are picked up immediately).
app.use(express.static(path.join(ROOT, 'client'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Uploads.
const uploadsDir = path.join(ROOT, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const ok = allowedTypes.test(file.mimetype) &&
               allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (ok) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

// File-explorer upload: any file type.
const uploadAny = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// ═══════════════════════════════════════════════════════════════════════════
// Session management
// ═══════════════════════════════════════════════════════════════════════════

const sessions = new Map();
let sessionIdCounter = 1;

class TerminalSession {
  constructor(sessionId, projectPath = null, options = {}) {
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    this.displayName = options.displayName || options.projectName || this.getDefaultName();
    this.color = options.color || 'default';
    this.ptyProcess = null;
    this.clients = new Set(); // multi-viewer: many browsers on one session
    this.lastActivity = Date.now();
    this.createdAt = options.createdAt || Date.now();
    this.output = [];
    this.activeAgentId = null;

    this.init();
  }

  getDefaultName() {
    if (this.projectPath) {
      const base = path.basename(this.projectPath);
      return base || `Session ${this.sessionId}`;
    }
    return `Session ${this.sessionId}`;
  }

  setDisplayName(name) {
    this.displayName = name || this.getDefaultName();
    this.lastActivity = Date.now();
  }

  setColor(color) {
    this.color = color || 'default';
    this.lastActivity = Date.now();
  }

  _spawnEnv() {
    // Remove nested-agent guard vars so a re-launched CLI agent inside the PTY
    // doesn't think it's running inside another agent session.
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    return env;
  }

  _resolveCwd() {
    let cwd = this.projectPath || HOME;
    try { if (!fs.existsSync(cwd)) cwd = HOME; } catch (e) { cwd = HOME; }
    return cwd;
  }

  _wirePty() {
    this.ptyProcess.onData((data) => {
      this.output.push(data);
      if (this.output.length > CONFIG.SCROLLBACK_LIMIT) {
        this.output.shift();
      }
      this._broadcast({ type: 'output', data });
      this.lastActivity = Date.now();
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      console.log(`[Session ${this.sessionId}] PTY exited (code: ${exitCode})`);
      this.ptyProcess = null; // mark dead
      this.activeAgentId = null;
      if (this.clients.size > 0) {
        this._broadcast({ type: 'exit' });
        this._respawnPty();
      }
    });
  }

  init() {
    const cwd = this._resolveCwd();
    this.ptyProcess = pty.spawn(CONFIG.SHELL, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: this._spawnEnv()
    });
    this._wirePty();
    console.log(`[Session ${this.sessionId}] Created (cwd: ${cwd})`);
  }

  /** Respawn a dead PTY so the session stays alive. Backoff against fork storms. */
  _respawnPty() {
    if (this.ptyProcess) return;

    const nowTs = Date.now();
    if (!this._respawnWindowStart || (nowTs - this._respawnWindowStart) > 10000) {
      this._respawnWindowStart = nowTs;
      this._respawnCount = 0;
    }
    this._respawnCount = (this._respawnCount || 0) + 1;
    if (this._respawnCount > 5) {
      console.error(`[Session ${this.sessionId}] PTY respawn storm (${this._respawnCount}/10s) — backing off 5s`);
      setTimeout(() => { try { this._respawnPty(); } catch (e) {} }, 5000);
      return;
    }

    const cwd = this._resolveCwd();
    try {
      this.ptyProcess = pty.spawn(CONFIG.SHELL, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: this._spawnEnv()
      });
      this._wirePty();
      console.log(`[Session ${this.sessionId}] PTY respawned (cwd: ${cwd})`);
      this._broadcast({ type: 'output', data: '\r\n[Terminal respawned]\r\n' });
    } catch (err) {
      console.error(`[Session ${this.sessionId}] Failed to respawn PTY:`, err.message);
    }
  }

  // Broadcast one message to every open viewer socket; self-heal dead sockets.
  _broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(msg); } catch (e) { this.clients.delete(ws); }
      } else {
        this.clients.delete(ws);
      }
    }
  }

  attach(ws) {
    this.clients.add(ws);
    this.lastActivity = Date.now();

    if (!this.ptyProcess) {
      this._respawnPty();
    }

    // Send scrollback only to the newly attached socket. Clean-reset the screen
    // first so a truncated escape / misaligned grid doesn't render broken.
    const scrollback = this.output.join('');
    if (scrollback) {
      ws.send(JSON.stringify({ type: 'output', data: '\x1b[H\x1b[2J\x1b[3J' + scrollback }));
    }

    console.log(`[Session ${this.sessionId}] Client attached (viewers: ${this.clients.size}, pty: ${this.ptyProcess ? 'alive' : 'dead'})`);
  }

  // With ws: detach just that socket. Without: detach all.
  detach(ws) {
    if (ws) {
      this.clients.delete(ws);
    } else {
      this.clients.clear();
    }
    console.log(`[Session ${this.sessionId}] Client detached (viewers remaining: ${this.clients.size})`);
  }

  write(data) {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
      this.lastActivity = Date.now();
    } else {
      console.warn(`[Session ${this.sessionId}] Write to dead PTY, respawning...`);
      this._respawnPty();
      if (this.ptyProcess) {
        setTimeout(() => {
          if (this.ptyProcess) this.ptyProcess.write(data);
        }, 500);
      }
    }
  }

  resize(cols, rows) {
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows);
    }
  }

  /** Launch a registered agent by writing its command into the PTY. */
  startAgent(agent) {
    if (!agent || !agent.command) {
      console.warn(`[Session ${this.sessionId}] startAgent: invalid agent`);
      return;
    }
    this.write(`${agent.command}\n`);
    this.activeAgentId = agent.id;
    console.log(`[Session ${this.sessionId}] Started agent '${agent.id}' (${agent.command})`);
  }

  /** Send a line of text to whatever is currently running in the PTY. */
  sendToAgent(text) {
    if (text == null) return;
    this.write(String(text) + '\n');
  }

  destroy() {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    for (const ws of this.clients) {
      try { ws.close(); } catch (e) { /* already closed */ }
    }
    this.clients.clear();
    console.log(`[Session ${this.sessionId}] Destroyed`);
  }

  isInactive() {
    return Date.now() - this.lastActivity > CONFIG.SESSION_TIMEOUT;
  }

  toJSON() {
    return {
      sessionId: this.sessionId,
      id: this.sessionId,
      projectPath: this.projectPath,
      cwd: this.projectPath || HOME,
      projectName: this.getDefaultName(),
      displayName: this.displayName,
      color: this.color,
      lastActivity: this.lastActivity,
      createdAt: this.createdAt,
      activeAgentId: this.activeAgentId,
      outputLength: this.output.length
    };
  }
}

function loadSessions() {
  try {
    if (fs.existsSync(CONFIG.SESSION_SAVE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG.SESSION_SAVE_PATH, 'utf8'));
      const list = Array.isArray(data.sessions) ? data.sessions : [];
      console.log(`[Sessions] Loaded ${list.length} saved sessions`);

      list.forEach(saved => {
        const session = new TerminalSession(saved.sessionId, saved.projectPath, {
          displayName: saved.displayName,
          color: saved.color,
          createdAt: saved.createdAt || saved.lastActivity
        });
        session.lastActivity = saved.lastActivity || Date.now();
        sessions.set(saved.sessionId, session);
        if (saved.sessionId >= sessionIdCounter) {
          sessionIdCounter = saved.sessionId + 1;
        }
      });
    }
  } catch (err) {
    console.error('[Sessions] Failed to load:', err.message);
  }
}

function saveSessions() {
  try {
    const data = {
      sessions: Array.from(sessions.values()).map(s => s.toJSON()),
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(CONFIG.SESSION_SAVE_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[Sessions] Failed to save:', err.message);
  }
}

function cleanupSessions() {
  let cleaned = 0;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.isInactive()) {
      session.destroy();
      sessions.delete(sessionId);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Sessions] Cleaned up ${cleaned} inactive sessions`);
    saveSessions();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REST API
// ═══════════════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    sessions: sessions.size,
    platform: process.platform,
    shell: CONFIG.SHELL
  });
});

// Registered agents — used by the client to populate the agent dropdown.
// Public (no token) so the launcher UI can render before auth completes.
app.get('/api/agents', (req, res) => {
  res.json({
    agents: CONFIG.AGENTS.map(a => ({ id: a.id, name: a.name, command: a.command })),
    count: CONFIG.AGENTS.length
  });
});

// Persist projects back to config.json (runtime file).
function saveProjectsToConfig() {
  const configFile = path.join(ROOT, 'config.json');
  let current = {};
  try {
    if (fs.existsSync(configFile)) current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  } catch (e) { current = {}; }
  // Seed from in-memory config if no runtime file existed yet.
  const merged = { ...DEFAULT_CONFIG, ...config, ...current };
  merged.projects = CONFIG.PROJECTS;
  try {
    fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('[Config] Failed to save projects:', e.message);
  }
}

app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ projects: CONFIG.PROJECTS, count: CONFIG.PROJECTS.length });
});

app.post('/api/projects', requireAuth, (req, res) => {
  const { name, path: projectPath } = req.body;
  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Name and path are required' });
  }
  if (CONFIG.PROJECTS.find(p => p.name === name || p.path === projectPath)) {
    return res.status(400).json({ error: 'Project already exists' });
  }
  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }
  CONFIG.PROJECTS.push({ name, path: projectPath });
  saveProjectsToConfig();
  res.json({ success: true, project: { name, path: projectPath }, projects: CONFIG.PROJECTS });
});

app.delete('/api/projects/:name', requireAuth, (req, res) => {
  const { name } = req.params;
  const index = CONFIG.PROJECTS.findIndex(p => p.name === name);
  if (index === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }
  CONFIG.PROJECTS.splice(index, 1);
  saveProjectsToConfig();
  res.json({ success: true, projects: CONFIG.PROJECTS });
});

app.put('/api/projects/:index', requireAuth, (req, res) => {
  const index = parseInt(req.params.index, 10);
  const { name, path: projectPath } = req.body;
  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Name and path are required' });
  }
  if (index < 0 || index >= CONFIG.PROJECTS.length) {
    return res.status(404).json({ error: 'Project not found' });
  }
  if (!fs.existsSync(projectPath)) {
    return res.status(400).json({ error: 'Path does not exist' });
  }
  if (CONFIG.PROJECTS.find((p, i) => i !== index && (p.name === name || p.path === projectPath))) {
    return res.status(400).json({ error: 'Project with this name or path already exists' });
  }
  CONFIG.PROJECTS[index] = { name, path: projectPath };
  saveProjectsToConfig();
  res.json({ success: true, project: { name, path: projectPath }, projects: CONFIG.PROJECTS });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const sessionList = Array.from(sessions.values()).map(s => {
    const json = s.toJSON();
    if (json.projectPath) {
      const matched = CONFIG.PROJECTS.find(p => p.path === json.projectPath);
      if (matched && json.displayName === json.projectName) {
        json.displayName = matched.name;
      }
    }
    return json;
  });
  res.json({ sessions: sessionList, count: sessionList.length });
});

app.patch('/api/sessions/:sessionId/name', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.setDisplayName(req.body.name);
  saveSessions();
  res.json({ success: true, session: session.toJSON() });
});

app.patch('/api/sessions/:sessionId/color', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.setColor(req.body.color);
  saveSessions();
  res.json({ success: true, session: session.toJSON() });
});

app.delete('/api/sessions/:sessionId', requireAuth, (req, res) => {
  const sessionId = parseInt(req.params.sessionId, 10);
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  session.destroy();
  sessions.delete(sessionId);
  saveSessions();
  console.log(`[Session ${sessionId}] Deleted by user request`);
  res.json({ success: true, message: `Session ${sessionId} deleted` });
});

// System status. Stage 1 has no tunnel — reflected as tunnel: null.
app.get('/api/system/status', requireAuth, (req, res) => {
  res.json({
    server: {
      host: CONFIG.HOST,
      port: CONFIG.PORT,
      uptime: process.uptime(),
      sessions: sessions.size
    },
    tunnel: tunnel.getStatus(), // null when idle/disabled → Stage-1 shape preserved
    auth: auth.getStatus(),     // Stage 3: login policy + active session count (no secrets)
    system: {
      platform: process.platform,
      shell: CONFIG.SHELL,
      home: HOME
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Tunnel control (Stage 2). All behind requireAuth; never throw to the client.
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/tunnel/status', requireAuth, (req, res) => {
  res.json(tunnel.getStatus() || { state: 'idle', provider: null, url: null });
});

app.post('/api/tunnel/start', requireAuth, (req, res) => {
  tunnel.start(CONFIG.PORT); // idempotent; no-op if disabled or already running
  res.json(tunnel.getStatus() || { state: 'idle', provider: null, url: null });
});

app.post('/api/tunnel/stop', requireAuth, async (req, res) => {
  await tunnel.stop(); // idempotent; safe if never started
  res.json(tunnel.getStatus() || { state: 'stopped', provider: null, url: null });
});

app.post('/api/tunnel/restart', requireAuth, (req, res) => {
  tunnel.restart();
  res.json(tunnel.getStatus() || { state: 'idle', provider: null, url: null });
});

// Note: POST /api/auth/verify-local (token login) is now registered by the auth
// manager (server/auth) alongside the rest of /api/auth/*, with 2FA enforcement
// when a TOTP secret is enrolled. The response shape is unchanged when 2FA is off.

app.post('/api/upload-image', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  const absolutePath = path.join(uploadsDir, req.file.filename);
  res.json({
    success: true,
    url: fileUrl,
    path: absolutePath,
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    file: {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: fileUrl,
      absolutePath
    }
  });
});

// Quick-access drives/roots for the folder picker (cross-platform).
app.get('/api/drives', requireAuth, (req, res) => {
  const drives = [
    { name: 'Home', path: HOME },
    { name: 'Documents', path: path.join(HOME, 'Documents') },
    { name: 'Downloads', path: path.join(HOME, 'Downloads') },
    { name: 'Desktop', path: path.join(HOME, 'Desktop') }
  ];
  if (process.platform === 'win32') {
    drives.push({ name: 'C:\\', path: 'C:\\' });
  } else {
    drives.push({ name: 'Root', path: '/' });
  }
  res.json({ drives });
});

// Folder-only browse (for project path selection).
app.get('/api/browse', requireAuth, (req, res) => {
  const targetPath = req.query.path || HOME;
  try {
    if (!isPathAllowed(targetPath)) {
      console.warn(`[Browse] Blocked path: ${targetPath}`);
      return res.status(403).json({ error: 'Access denied: Path not allowed' });
    }
    if (!fs.existsSync(targetPath)) return res.json({ error: 'Path does not exist' });
    if (!fs.statSync(targetPath).isDirectory()) return res.json({ error: 'Not a directory' });

    const folders = fs.readdirSync(targetPath, { withFileTypes: true })
      .filter(item => item.isDirectory() && !item.name.startsWith('.'))
      .map(item => ({ name: item.name, path: path.join(targetPath, item.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;
    res.json({ current: targetPath, parent, folders });
  } catch (error) {
    console.error('[Browse] Error:', error.message);
    res.json({ error: error.message });
  }
});

// File explorer tree (folders + files).
app.get('/api/explorer/tree', requireAuth, (req, res) => {
  const targetPath = req.query.path || HOME;
  try {
    if (!isPathAllowed(targetPath)) {
      console.warn(`[Explorer] Blocked path: ${targetPath}`);
      return res.status(403).json({ error: 'Access denied: Path not allowed' });
    }
    if (!fs.existsSync(targetPath)) return res.json({ error: 'Path does not exist' });
    if (!fs.statSync(targetPath).isDirectory()) return res.json({ error: 'Not a directory' });

    const items = fs.readdirSync(targetPath, { withFileTypes: true })
      .filter(item => !item.name.startsWith('.'))
      .map(item => {
        const itemPath = path.join(targetPath, item.name);
        const isDir = item.isDirectory();
        const ext = isDir ? null : path.extname(item.name).slice(1).toLowerCase();
        return {
          name: item.name,
          isDirectory: isDir,
          path: itemPath,
          extension: ext,
          type: ext === 'md' || ext === 'markdown' ? 'markdown' : (isDir ? 'folder' : 'file')
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const parent = path.dirname(targetPath) !== targetPath ? path.dirname(targetPath) : null;
    res.json({ path: targetPath, parent, items });
  } catch (error) {
    console.error('[Explorer] Error:', error.message);
    res.json({ error: error.message });
  }
});

app.use('/uploads', express.static(uploadsDir));

// ═══════════════════════════════════════════════════════════════════════════
// File management API (read / write / rename / move / delete / create)
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/file', requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied: Path not allowed' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) return res.status(400).json({ error: 'Path is a directory, not a file' });
    if (stats.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5MB)' });

    const content = fs.readFileSync(filePath, 'utf8');
    res.json({
      success: true,
      file: {
        path: filePath,
        name: path.basename(filePath),
        ext: path.extname(filePath).toLowerCase(),
        size: stats.size,
        modified: stats.mtime,
        content
      }
    });
  } catch (error) {
    console.error('[File Read] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/file', requireAuth, (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied: Path not allowed' });
  if (content === undefined) return res.status(400).json({ error: 'Content is required' });
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, filePath + '.bak');
    }
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    const stats = fs.statSync(filePath);
    console.log(`[File Write] ${filePath}`);
    res.json({ success: true, file: { path: filePath, name: path.basename(filePath), size: stats.size, modified: stats.mtime } });
  } catch (error) {
    console.error('[File Write] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/file/rename', requireAuth, (req, res) => {
  const { oldPath, newName } = req.body;
  if (!oldPath || !newName) return res.status(400).json({ error: 'oldPath and newName are required' });
  if (!isPathAllowed(oldPath)) return res.status(403).json({ error: 'Access denied: Path not allowed' });
  if (newName.includes('/') || newName.includes('\\')) {
    return res.status(400).json({ error: 'Invalid name: cannot contain path separators' });
  }
  try {
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File or folder not found' });
    const newPath = path.join(path.dirname(oldPath), newName);
    if (!isPathAllowed(newPath)) return res.status(403).json({ error: 'Access denied: New path not allowed' });
    if (fs.existsSync(newPath)) return res.status(400).json({ error: 'A file or folder with this name already exists' });
    fs.renameSync(oldPath, newPath);
    console.log(`[File Rename] ${oldPath} -> ${newPath}`);
    res.json({ success: true, oldPath, newPath, newName });
  } catch (error) {
    console.error('[File Rename] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/file/move', requireAuth, (req, res) => {
  const { sourcePath, destinationDir } = req.body;
  if (!sourcePath || !destinationDir) return res.status(400).json({ error: 'sourcePath and destinationDir are required' });
  if (!isPathAllowed(sourcePath) || !isPathAllowed(destinationDir)) {
    return res.status(403).json({ error: 'Access denied: Path not allowed' });
  }
  try {
    if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Source file or folder not found' });
    if (!fs.existsSync(destinationDir)) return res.status(404).json({ error: 'Destination directory not found' });
    if (!fs.statSync(destinationDir).isDirectory()) return res.status(400).json({ error: 'Destination is not a directory' });
    const newPath = path.join(destinationDir, path.basename(sourcePath));
    if (fs.existsSync(newPath)) return res.status(400).json({ error: 'A file or folder with this name already exists in destination' });
    fs.renameSync(sourcePath, newPath);
    console.log(`[File Move] ${sourcePath} -> ${newPath}`);
    res.json({ success: true, sourcePath, newPath });
  } catch (error) {
    console.error('[File Move] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/file', requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied: Path not allowed' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File or folder not found' });
    if (fs.statSync(filePath).isDirectory()) {
      fs.rmSync(filePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(filePath);
    }
    console.log(`[File Delete] ${filePath}`);
    res.json({ success: true, deleted: filePath });
  } catch (error) {
    console.error('[File Delete] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/folder', requireAuth, (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(folderPath)) return res.status(403).json({ error: 'Access denied: Path not allowed' });
  try {
    if (fs.existsSync(folderPath)) return res.status(400).json({ error: 'Folder already exists' });
    fs.mkdirSync(folderPath, { recursive: true });
    console.log(`[Folder Create] ${folderPath}`);
    res.json({ success: true, path: folderPath });
  } catch (error) {
    console.error('[Folder Create] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/file', requireAuth, (req, res) => {
  const { path: filePath, content = '' } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied: Path not allowed' });
  try {
    if (fs.existsSync(filePath)) return res.status(400).json({ error: 'File already exists' });
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    const stats = fs.statSync(filePath);
    console.log(`[File Create] ${filePath}`);
    res.json({ success: true, file: { path: filePath, name: path.basename(filePath), size: stats.size, modified: stats.mtime } });
  } catch (error) {
    console.error('[File Create] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Explorer API aliases (client compatibility)
// ───────────────────────────────────────────────────────────────────────────

app.get('/api/explorer/read', requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) return res.status(400).json({ error: 'Path is a directory' });
    if (stats.size > 5 * 1024 * 1024) return res.status(400).json({ error: 'File too large (max 5MB)' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, content, path: filePath, name: path.basename(filePath) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function handleFileWrite(req, res) {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content || '', 'utf8');
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
app.post('/api/explorer/write', requireAuth, handleFileWrite);
app.put('/api/explorer/write', requireAuth, handleFileWrite);

app.post('/api/explorer/rename', requireAuth, (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) return res.status(400).json({ error: 'Paths required' });
  if (!isPathAllowed(oldPath) || !isPathAllowed(newPath)) return res.status(403).json({ error: 'Access denied' });
  try {
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Source not found' });
    fs.renameSync(oldPath, newPath);
    res.json({ success: true, oldPath, newPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function handleDelete(req, res) {
  const filePath = req.query.path || req.body?.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    let isDir = false;
    try { isDir = fs.statSync(filePath).isDirectory(); } catch (_) { isDir = false; }
    if (isDir) fs.rmSync(filePath, { recursive: true, force: true });
    else fs.unlinkSync(filePath);
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
app.delete('/api/explorer/delete', requireAuth, handleDelete);
app.post('/api/explorer/delete', requireAuth, handleDelete);

app.post('/api/explorer/create-file', requireAuth, (req, res) => {
  let filePath, content = '';
  if (req.body.path) {
    filePath = req.body.path;
    content = req.body.content || '';
  } else if (req.body.parentPath && (req.body.name || req.body.fileName)) {
    filePath = path.join(req.body.parentPath, req.body.name || req.body.fileName);
    content = req.body.content || '';
  } else {
    return res.status(400).json({ error: 'Path or (parentPath + name/fileName) required' });
  }
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/explorer/create-folder', requireAuth, (req, res) => {
  let folderPath;
  if (req.body.path) {
    folderPath = req.body.path;
  } else if (req.body.parentPath && (req.body.name || req.body.folderName)) {
    folderPath = path.join(req.body.parentPath, req.body.name || req.body.folderName);
  } else {
    return res.status(400).json({ error: 'Path or (parentPath + name/folderName) required' });
  }
  if (!isPathAllowed(folderPath)) return res.status(403).json({ error: 'Access denied' });
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    res.json({ success: true, path: folderPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/explorer/mkdir', requireAuth, (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(folderPath)) return res.status(403).json({ error: 'Access denied' });
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    res.json({ success: true, path: folderPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/explorer/move', requireAuth, (req, res) => {
  const { sourcePath, targetPath } = req.body;
  if (!sourcePath || !targetPath) return res.status(400).json({ error: 'Paths required' });
  if (!isPathAllowed(sourcePath) || !isPathAllowed(targetPath)) return res.status(403).json({ error: 'Access denied' });
  try {
    if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: 'Source not found' });
    const destPath = path.join(targetPath, path.basename(sourcePath));
    fs.renameSync(sourcePath, destPath);
    res.json({ success: true, from: sourcePath, to: destPath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/explorer/download', requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    res.download(filePath);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/explorer/upload', requireAuth, uploadAny.array('files', 20), (req, res) => {
  const targetPath = req.body.path || req.query.path;
  if (!targetPath) return res.status(400).json({ error: 'Target path required' });
  if (!isPathAllowed(targetPath)) return res.status(403).json({ error: 'Access denied' });
  try {
    const uploadedFiles = [];
    for (const file of req.files) {
      const destPath = path.join(targetPath, file.originalname);
      // Cross-device safe move: rename, fall back to copy+unlink on EXDEV.
      try {
        fs.renameSync(file.path, destPath);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        fs.copyFileSync(file.path, destPath);
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
      uploadedFiles.push({ name: file.originalname, path: destPath });
    }
    res.json({ success: true, files: uploadedFiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/markdown/read', requireAuth, (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Path is required' });
  if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ success: true, content, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload-document', requireAuth, upload.single('document'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
  res.json({
    success: true,
    url: `/uploads/${req.file.filename}`,
    filename: req.file.filename,
    originalname: req.file.originalname,
    size: req.file.size
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WebSocket server
// ═══════════════════════════════════════════════════════════════════════════

const wss = new WebSocket.Server({ server, path: '/ws' });

// Dead-connection detection — generous so quiet sessions behind pong-dropping
// proxies are not killed.
const WS_PING_INTERVAL = 30000;
const WS_GRACE_PERIOD = 60000;
const WS_MAX_MISSED_PINGS = 10;

const heartbeatChecker = setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    if (ws.connectedAt && (now - ws.connectedAt) < WS_GRACE_PERIOD) return;
    if (ws.missedPings === undefined) ws.missedPings = 0;

    if (ws.isAlive === false) {
      if (ws._lastMessageAt && (now - ws._lastMessageAt) < 60000) {
        // Recent real traffic — treat as alive.
      } else {
        ws.missedPings++;
        if (ws.missedPings >= WS_MAX_MISSED_PINGS) {
          console.log(`[WebSocket] Terminating dead connection (${ws.missedPings} missed pings)`);
          return ws.terminate();
        }
      }
    } else {
      ws.missedPings = 0;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, WS_PING_INTERVAL);

wss.on('close', () => clearInterval(heartbeatChecker));

wss.on('connection', (ws, req) => {
  console.log('[WebSocket] New connection');

  ws.isAlive = true;
  ws.connectedAt = Date.now();
  ws._lastMessageAt = Date.now();
  try { req.socket.setKeepAlive(true, 30000); req.socket.setNoDelay(true); } catch (e) {}

  const clientIP = getClientIP(req);

  // Stage 3: accept the static token (when direct access is allowed) OR a valid
  // session via ?session=, ?token=, or the session cookie sent on the upgrade.
  const principal = auth.verifyWs(req);
  if (!principal) {
    console.warn(`[WebSocket] Rejected unauthenticated connection from ${clientIP}`);
    try { ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' })); } catch (e) {}
    ws.close(4001, 'Authentication required');
    return;
  }

  console.log(`[WebSocket] Authenticated connection from ${clientIP} (${principal.type})`);

  let currentSession = null;
  let heartbeatInterval = null;

  ws.on('pong', () => { ws.isAlive = true; });

  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);

  ws.on('message', (message) => {
    try {
      ws._lastMessageAt = Date.now();
      const msg = JSON.parse(message);

      switch (msg.type) {
        case 'init': {
          const { sessionId, projectPath, projectName, cols, rows } = msg;
          const numericSessionId = sessionId ? parseInt(sessionId, 10) : null;
          let isReconnect = false;

          if (numericSessionId && sessions.has(numericSessionId)) {
            currentSession = sessions.get(numericSessionId);
            currentSession.attach(ws);
            currentSession.resize(cols || 80, rows || 24);
            isReconnect = true;
          } else {
            const newSessionId = sessionIdCounter++;
            currentSession = new TerminalSession(newSessionId, projectPath, { projectName: projectName || null });
            sessions.set(newSessionId, currentSession);
            currentSession.attach(ws);
            currentSession.resize(cols || 80, rows || 24);
            saveSessions();
          }

          ws.send(JSON.stringify({
            type: 'ready',
            sessionId: currentSession.sessionId,
            projectPath: currentSession.projectPath,
            isReconnect,
            persistent: true
          }));
          break;
        }

        case 'input':
          if (currentSession) currentSession.write(msg.data);
          break;

        case 'resize':
          if (currentSession) currentSession.resize(msg.cols, msg.rows);
          break;

        case 'startAgent': {
          if (!currentSession) break;
          const agent = CONFIG.AGENTS.find(a => a.id === msg.agentId);
          if (!agent) {
            ws.send(JSON.stringify({ type: 'error', message: `Unknown agentId: ${msg.agentId}` }));
            break;
          }
          currentSession.startAgent(agent);
          break;
        }

        case 'sendToAgent':
          if (currentSession) currentSession.sendToAgent(msg.text ?? msg.message ?? msg.command);
          break;

        case 'detach':
          if (currentSession) {
            currentSession.detach(ws);
            saveSessions();
            ws.send(JSON.stringify({ type: 'detached', sessionId: currentSession.sessionId }));
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        case 'pong':
          break;

        default:
          console.warn('[WebSocket] Unknown message type:', msg.type);
      }
    } catch (err) {
      console.error('[WebSocket] Message error:', err.message);
      try { ws.send(JSON.stringify({ type: 'error', message: err.message })); } catch (e) {}
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Connection closed');
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (currentSession) {
      currentSession.detach(ws);
      saveSessions();
    }
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] Error:', err.message);
    if (currentSession) currentSession.detach(ws);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Startup + lifecycle
// ═══════════════════════════════════════════════════════════════════════════

loadSessions();

setInterval(saveSessions, 5 * 60 * 1000);
setInterval(cleanupSessions, 60 * 60 * 1000);

// Crash prevention — keep the server alive through runtime exceptions, but exit
// cleanly on fatal bind errors so a supervisor can restart.
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err.message);
  console.error(err.stack);
  try { saveSessions(); } catch (e) {}
  if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
    console.error(`[CRITICAL] Fatal bind error (${err.code}) — exiting`);
    setTimeout(() => process.exit(1), 200);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRITICAL] Unhandled Rejection (server continues):', reason);
  try { saveSessions(); } catch (e) {}
});

function shutdown(signal) {
  console.log(`\n[Server] Shutting down (${signal})...`);
  saveSessions();
  sessions.forEach(session => session.destroy());
  // Stop the tunnel child too, but never let a hung CLI block exit.
  const hardExit = setTimeout(() => process.exit(0), 3000);
  if (hardExit.unref) hardExit.unref();
  Promise.resolve(tunnel.stop()).catch(() => {}).finally(() => {
    clearTimeout(hardExit);
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(CONFIG.PORT, CONFIG.HOST, () => {
  const displayHost = CONFIG.HOST === '0.0.0.0' ? '127.0.0.1' : CONFIG.HOST;
  const accessUrl = `http://${displayHost}:${CONFIG.PORT}`;

  console.log('===============================================================');
  console.log('  AnyAgent Bridge — server running');
  console.log('===============================================================');
  console.log(`  URL:       ${accessUrl}?token=${AUTH_TOKEN}`);
  console.log(`  WebSocket: ws://${displayHost}:${CONFIG.PORT}/ws`);
  console.log(`  Host:      ${CONFIG.HOST}`);
  console.log(`  Shell:     ${CONFIG.SHELL}`);
  console.log(`  Agents:    ${CONFIG.AGENTS.map(a => a.id).join(', ') || '(none)'}`);
  console.log(`  Projects:  ${CONFIG.PROJECTS.length}`);
  console.log(`  Sessions:  ${sessions.size}`);
  console.log('---------------------------------------------------------------');
  console.log(`  Access token (${AUTH_TOKEN_SOURCE}): ${AUTH_TOKEN}`);
  if (CONFIG.HOST === '0.0.0.0') {
    console.log('---------------------------------------------------------------');
    console.log('  WARNING: bound to 0.0.0.0 — the server is reachable on your');
    console.log('  network/internet. The access token is the ONLY gate. Anyone');
    console.log('  with the token gets full terminal + file access. Stage 1 has');
    console.log('  no tunnel/TLS; do not expose this publicly without a proxy.');
  }
  // Stage 3: summarize active login policy. Silent (byte-identical to Stage 2)
  // when OAuth is off, no TOTP is enrolled, and requireLogin is false.
  if (auth.isEnhanced()) {
    const st = auth.getStatus();
    const methods = [];
    if (st.oauth.enabled) {
      const provs = Object.entries(st.oauth.providers).filter(([, on]) => on).map(([id]) => id);
      methods.push(`oauth(${provs.join(',') || 'none configured'})`);
    }
    if (st.totp.confirmed) methods.push('token+2FA');
    else methods.push('token');
    console.log('---------------------------------------------------------------');
    console.log(`  Login:     ${methods.join(', ')}`);
    console.log(`  Token:     ${st.tokenDirectAccess ? 'direct access enabled' : 'login-only (must exchange for a session)'}`);
    if (st.requireLogin) console.log('  requireLogin: on (static token cannot be used directly)');
    // Behind a tunnel the OAuth redirect_uri is derived from request headers
    // (Host/X-Forwarded-Host) unless pinned. Warn so logins don't silently break
    // or trust a spoofable host.
    if (st.oauth.enabled && !CONFIG.AUTH.oauth.callbackBaseUrl) {
      console.log('  WARNING:   OAuth is on but auth.oauth.callbackBaseUrl is unset — the redirect URI');
      console.log('             will be derived from request headers. Set it to your public URL');
      console.log('             (e.g. your tunnel URL) for reliable, non-spoofable callbacks.');
    }
  }
  console.log('===============================================================');

  // Stage 2: start the configured tunnel AFTER the local server is up. The URL
  // arrives asynchronously and never delays listen(). When disabled, the banner
  // above is byte-identical to Stage 1.
  if (CONFIG.TUNNEL && CONFIG.TUNNEL.enabled) {
    console.log(`  Tunnel:    ${CONFIG.TUNNEL.provider} (starting...)`);
    tunnel.once('ready', (s) => {
      if (s && s.url) console.log(`  Tunnel:    ${s.url}  (${s.provider})`);
      else console.log(`  Tunnel:    ${s.provider} connected (no public URL to display)`);
    });
    tunnel.on('state', (s) => {
      if (s && s.state === 'error') console.warn(`  Tunnel:    error — ${s.lastError || 'unavailable'}`);
    });
    tunnel.start(CONFIG.PORT);
  }
});
