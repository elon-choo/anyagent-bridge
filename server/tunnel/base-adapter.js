/**
 * AnyAgent Bridge — tunnel BaseAdapter (Stage 2)
 *
 * Shared plumbing every tunnel adapter reuses: detect the CLI, spawn it
 * (no shell, child dies with the server), scan BOTH stdout and stderr
 * line-by-line, and stop it cleanly (SIGTERM -> SIGKILL on POSIX; taskkill
 * tree-kill on Windows). Concrete adapters override only the static metadata,
 * buildArgs(), and parseLine(). Adapters never touch global state, the HTTP
 * layer, or the banner — they talk to the manager purely through events.
 *
 * Events emitted:
 *   'url'  (url)              first public URL parsed
 *   'ready'()                 readiness reached but URL is known out-of-band (cloudflared-named)
 *   'error'({code, message})  spawn failure or provider error
 *   'exit' ({code, signal})   child process ended
 *   'log'  (line)             passthrough of a CLI output line (diagnostics)
 */

const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { detect: detectBinary } = require('./detect');

class BaseAdapter extends EventEmitter {
  // Subclasses MUST override these static getters:
  //   static get id()         provider id, e.g. 'devtunnel'
  //   static get label()      human name
  //   static get binaryName() CLI to probe/spawn
  //   static get stableUrl()  boolean
  //   static get requiresAccount() boolean
  //   static get installHint() string

  constructor({ host, port, providerConfig, killGraceMs, logger } = {}) {
    super();
    this.host = host || '127.0.0.1';
    this.port = port;
    this.providerConfig = providerConfig || {};
    this.killGraceMs = killGraceMs || 4000;
    this.logger = logger || console;

    this.child = null;
    this.binaryPath = null;
    this._stdoutBuf = '';
    this._stderrBuf = '';
    this._urlEmitted = false;
    this._killTimer = null;
  }

  get pid() { return this.child && this.child.pid ? this.child.pid : null; }
  get stableUrl() { return this.constructor.stableUrl; }
  get requiresAccount() { return this.constructor.requiresAccount; }

  /** Delegate to detect.js. Never throws. */
  async detect() {
    const bin = this.constructor.binaryName;
    const res = detectBinary(bin);
    this.binaryPath = res.path;
    return {
      available: res.available,
      path: res.path,
      reason: res.available ? undefined : `${bin} not found on PATH`
    };
  }

  /** Override: return string[] argv (after the binary). */
  buildArgs() { return []; }

  /** Override: return {url}|{ready:true}|{error:{code,message}}|null. */
  parseLine(line, stream) { return null; }

  /** Spawn the CLI. Idempotent (no-op if already running). */
  start() {
    if (this.child) return;
    const bin = this.binaryPath || this.constructor.binaryName;

    let args;
    try {
      args = this.buildArgs();
    } catch (e) {
      this.emit('error', { code: 'NOT_CONFIGURED', message: e.message });
      return;
    }
    // extraArgs come from config.json (a local-operator trust boundary, as
    // trusted as the code itself). spawn() uses array argv with shell:false, so
    // there is no shell-injection surface; each entry is one literal CLI arg.
    const extra = Array.isArray(this.providerConfig.extraArgs) ? this.providerConfig.extraArgs : [];
    args = args.concat(extra);

    try {
      this.child = spawn(bin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,        // child stays in the server's process group
        windowsHide: true
      });
    } catch (e) {
      this.child = null;
      this.emit('error', { code: 'SPAWN_FAILED', message: e.message });
      return;
    }

    this.child.on('error', (err) => {
      const code = (err && err.code === 'ENOENT') ? 'CLI_NOT_FOUND' : 'SPAWN_FAILED';
      this.emit('error', { code, message: err.message });
    });

    if (this.child.stdout) this.child.stdout.on('data', (d) => this._onChunk('stdout', d));
    if (this.child.stderr) this.child.stderr.on('data', (d) => this._onChunk('stderr', d));

    this.child.on('exit', (code, signal) => {
      this.child = null;
      this.emit('exit', { code, signal });
    });
  }

  _onChunk(stream, chunk) {
    const key = stream === 'stdout' ? '_stdoutBuf' : '_stderrBuf';
    this[key] += chunk.toString('utf8');
    let idx;
    while ((idx = this[key].indexOf('\n')) >= 0) {
      const line = this[key].slice(0, idx).replace(/\r$/, '');
      this[key] = this[key].slice(idx + 1);
      this._handleLine(line, stream);
    }
  }

  _handleLine(line, stream) {
    if (!line) return;
    this.emit('log', line);

    let res = null;
    try {
      res = this.parseLine(line, stream);
    } catch (e) {
      return;
    }
    if (!res) return;

    if (res.url && !this._urlEmitted) {
      this._urlEmitted = true;
      this.emit('url', res.url);
    } else if (res.ready && !this._urlEmitted) {
      this._urlEmitted = true;
      this.emit('ready');
    } else if (res.error && !this._urlEmitted) {
      // Errors only matter before we have a URL. Once running, a transient error
      // line is not fatal — actual death is reported via the child 'exit' event.
      this.emit('error', res.error);
    }
  }

  /** Stop the child. SIGTERM, then SIGKILL after killGraceMs. Idempotent. */
  async stop() {
    const child = this.child;
    if (!child) return;
    const grace = this.killGraceMs;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this._killTimer) { clearTimeout(this._killTimer); this._killTimer = null; }
        resolve();
      };
      child.once('exit', finish);
      try {
        if (process.platform === 'win32') {
          // SIGTERM is unreliable on Windows and CLIs spawn grandchildren;
          // taskkill /T kills the whole tree. Handle its 'error' so a missing
          // taskkill.exe never becomes an unhandled event (the SIGKILL timer
          // below is the backstop either way).
          const tk = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
          tk.on('error', (e) => { try { this.logger.warn(`[Tunnel] taskkill failed: ${e.message}`); } catch (_) {} });
        } else {
          child.kill('SIGTERM');
        }
      } catch (e) { /* fall through to the hard-kill timer */ }
      this._killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
        finish();
      }, grace);
      if (this._killTimer.unref) this._killTimer.unref();
    });
  }
}

module.exports = BaseAdapter;
