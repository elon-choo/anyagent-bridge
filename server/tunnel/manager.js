/**
 * AnyAgent Bridge — TunnelManager (Stage 2)
 *
 * Owns the tunnel lifecycle state machine, provider selection (via the
 * registry), URL-acquisition watchdog, and restart/backoff policy. All
 * orchestration lives here; adapters stay dumb. The server process NEVER
 * crashes or restarts because of the tunnel — every non-`running` state means
 * "localhost-only, fully functional".
 *
 * States: idle | starting | running | stopped | error
 *
 * Terminal errors (need user action, no auto-retry):
 *   CLI_NOT_FOUND, LOGIN_REQUIRED, NOT_IN_TAILNET, NOT_CONFIGURED, SPAWN_FAILED
 * Retryable errors (backoff, mirrors the PTY respawn storm guard):
 *   URL_TIMEOUT, EXIT_BEFORE_URL, CRASHED
 */

const { EventEmitter } = require('events');
const { getAdapter, listProviders } = require('./registry');

const DEFAULTS = {
  urlTimeoutMs: 30000,
  killGraceMs: 4000,
  restart: { maxPerWindow: 5, windowMs: 10000, backoffMs: 5000, backoffMaxMs: 60000 }
};

const TERMINAL_CODES = new Set([
  'CLI_NOT_FOUND', 'LOGIN_REQUIRED', 'NOT_IN_TAILNET', 'NOT_CONFIGURED', 'SPAWN_FAILED'
]);

class TunnelManager extends EventEmitter {
  constructor(tunnelConfig, logger) {
    super();
    this.config = tunnelConfig || {};
    this.logger = logger || console;

    this.urlTimeoutMs = this.config.urlTimeoutMs || DEFAULTS.urlTimeoutMs;
    this.killGraceMs = this.config.killGraceMs || DEFAULTS.killGraceMs;
    this.restartCfg = { ...DEFAULTS.restart, ...(this.config.restart || {}) };
    this.providerId = this.config.provider || 'devtunnel';

    this.state = 'idle';
    this.url = null;
    this.since = null;
    this.pid = null;
    this.lastError = null;
    this.attempts = 0;

    this.adapter = null;
    this._stopping = false;
    this._watchdog = null;
    this._backoffTimer = null;
    this._stableTimer = null;      // resets the restart budget once running holds windowMs
    this._reachedRunning = false;  // distinguishes a post-running crash from never-started
    this._restartWindowStart = 0;
    this._restartCount = 0;
    this._port = null;
    this._host = '127.0.0.1'; // tunnels always target the loopback service
  }

  // Detach a doomed adapter so its buffered late events can never mutate manager
  // state (the root cause of the restart race). Safe: adapter.stop() reaps the
  // child via its own internal listener, not these.
  _disposeAdapter() {
    if (this.adapter) {
      try { this.adapter.removeAllListeners(); } catch (e) { /* noop */ }
    }
  }

  _clearStableTimer() {
    if (this._stableTimer) { clearTimeout(this._stableTimer); this._stableTimer = null; }
  }

  // Arm on reaching 'running': if the tunnel stays up for one window, hand it a
  // fresh restart budget (spec §7: window resets only after holding running).
  _armStableTimer() {
    this._clearStableTimer();
    this._stableTimer = setTimeout(() => {
      this._stableTimer = null;
      this._restartWindowStart = 0;
      this._restartCount = 0;
    }, this.restartCfg.windowMs);
    if (this._stableTimer.unref) this._stableTimer.unref();
  }

  _isEnabled() { return this.config && this.config.enabled === true; }

  _setState(state, extra) {
    this.state = state;
    if (extra && 'url' in extra) this.url = extra.url;
    if (extra && 'error' in extra) this.lastError = extra.error;
    this.since = Date.now();
    this.emit('state', this.getStatus());
  }

  /** Snapshot for the status endpoint / SEAM 1. Synchronous, never spawns. */
  getStatus() {
    // Preserve Stage-1 `tunnel: null` byte-for-byte when disabled & untouched.
    if (this.state === 'idle' && !this._isEnabled()) return null;
    const Adapter = getAdapter(this.providerId);
    const stable = Adapter ? Adapter.stableUrl : undefined;
    return {
      provider: this.providerId,
      state: this.state,
      url: this.url,
      since: this.since,
      pid: this.pid,
      lastError: this.lastError,
      attempts: this.attempts,
      ephemeral: stable === undefined ? undefined : !stable,
      stableUrl: stable
    };
  }

  /**
   * Start the tunnel. Idempotent. Non-blocking (URL arrives async).
   * @param {number} [port] local port to expose; remembered for restarts.
   */
  start(port) {
    if (port != null) this._port = port;
    if (!this._isEnabled()) { this.state = 'idle'; return; }
    if (this.state === 'starting' || this.state === 'running') return;

    const Adapter = getAdapter(this.providerId);
    if (!Adapter) {
      this.logger.warn(`[Tunnel] Unknown provider '${this.providerId}' (known: ${listProviders().join(', ')}) — localhost-only`);
      this._setState('error', { error: `unknown provider '${this.providerId}'` });
      return;
    }
    this._spawnAdapter(Adapter);
  }

  _spawnAdapter(Adapter) {
    this._disposeAdapter();      // detach any prior adapter's listeners first
    this._clearStableTimer();
    this._stopping = false;
    this._reachedRunning = false;
    this.attempts += 1;
    const providerConfig = this.config[this.providerId] || {};
    this.adapter = new Adapter({
      host: this._host,
      port: this._port,
      providerConfig,
      killGraceMs: this.killGraceMs,
      logger: this.logger
    });
    this._setState('starting');

    Promise.resolve(this.adapter.detect()).then((det) => {
      if (this.state !== 'starting' || this._stopping) return; // stopped meanwhile
      if (!det.available) {
        this._terminalError('CLI_NOT_FOUND', `'${Adapter.binaryName}' not found on PATH. ${Adapter.installHint || ''}`.trim());
        return;
      }
      this._wireAdapter(this.adapter);
      this.adapter.start();
      this._armWatchdog();
    }).catch((e) => {
      this._terminalError('SPAWN_FAILED', e.message);
    });
  }

  _wireAdapter(a) {
    a.on('url', (url) => {
      this._clearWatchdog();
      this._reachedRunning = true;
      this._armStableTimer();
      this.pid = a.pid;
      this._setState('running', { url });
      this.emit('ready', this.getStatus());
      this.logger.log(`[Tunnel] ${this.providerId} ready: ${url}`);
    });
    a.on('ready', () => {
      // cloudflared-named: the CLI never prints the URL; it is the configured hostname.
      this._clearWatchdog();
      this._reachedRunning = true;
      this._armStableTimer();
      this.pid = a.pid;
      const host = this._namedHostname();
      const url = host ? `https://${host}` : null;
      this._setState('running', { url });
      this.emit('ready', this.getStatus());
      this.logger.log(`[Tunnel] ${this.providerId} ready${url ? ': ' + url : ' (set tunnel["cloudflared-named"].hostname to display the URL)'}`);
    });
    a.on('error', (err) => this._onAdapterError(err));
    a.on('exit', ({ code, signal }) => this._onAdapterExit(code, signal));
  }

  _namedHostname() {
    const pc = this.config['cloudflared-named'] || {};
    return pc.hostname || null;
  }

  _onAdapterError(err) {
    const code = (err && err.code) || 'ERROR';
    const message = (err && err.message) || '';
    if (TERMINAL_CODES.has(code)) {
      this._terminalError(code, message);
    } else {
      this.lastError = `${code}: ${message}`.trim();
      this._killAdapterQuietly();
      this._scheduleRetry(code);
    }
  }

  _onAdapterExit(code, signal) {
    this.pid = null;
    if (this._stopping) return;                 // expected (we killed it)
    if (this.state === 'stopped' || this.state === 'error') return;
    this._clearWatchdog();
    this._clearStableTimer();
    // Classify by whether we ever reached running — url may be null even when
    // running (cloudflared-named with no configured hostname).
    const reason = this._reachedRunning ? 'CRASHED' : 'EXIT_BEFORE_URL';
    this.logger.warn(`[Tunnel] ${this.providerId} ${reason} (code=${code} signal=${signal || ''})`);
    this._scheduleRetry(reason);
  }

  _terminalError(code, message) {
    this._clearWatchdog();
    this._clearStableTimer();
    this._killAdapterQuietly();
    this.pid = null;
    this.url = null;
    this._setState('error', { error: `${code}: ${message}` });
    this.logger.warn(`[Tunnel] ${this.providerId} ${code} — ${message} (localhost-only; no auto-retry)`);
  }

  _armWatchdog() {
    this._clearWatchdog();
    this._watchdog = setTimeout(() => {
      this._watchdog = null;
      if (this.state !== 'starting') return;
      this.logger.warn(`[Tunnel] ${this.providerId} produced no URL within ${this.urlTimeoutMs}ms`);
      this._killAdapterQuietly();
      this._scheduleRetry('URL_TIMEOUT');
    }, this.urlTimeoutMs);
    if (this._watchdog.unref) this._watchdog.unref();
  }

  _clearWatchdog() {
    if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
  }

  // Kill the current child without counting its exit as an unexpected crash.
  // Detaches the adapter's listeners first so its late output can't flip state.
  _killAdapterQuietly() {
    this._stopping = true;
    if (this.adapter) {
      const a = this.adapter;
      this._disposeAdapter();
      Promise.resolve(a.stop()).catch(() => {});
    }
  }

  _scheduleRetry(reason) {
    // The window is reset only by a sustained 'running' period (see _armStableTimer),
    // never merely by elapsed time — so spaced failures can't refill the budget.
    if (!this._restartWindowStart) this._restartWindowStart = Date.now();
    this._restartCount += 1;

    if (this._restartCount > this.restartCfg.maxPerWindow) {
      this.url = null;
      this._setState('error', { error: `${reason} — restart storm (${this._restartCount} in ${this.restartCfg.windowMs}ms), giving up` });
      this.logger.error(`[Tunnel] ${this.providerId} restart storm — staying localhost-only. Use POST /api/tunnel/restart to retry.`);
      return;
    }

    let delay = this.restartCfg.backoffMs * Math.pow(2, this._restartCount - 1);
    if (delay > this.restartCfg.backoffMaxMs) delay = this.restartCfg.backoffMaxMs;

    this.url = null;
    this._setState('error', { error: `${reason} — retrying in ${delay}ms (attempt ${this._restartCount})` });
    this.logger.warn(`[Tunnel] ${this.providerId} ${reason} — retry in ${delay}ms`);

    this._backoffTimer = setTimeout(() => {
      this._backoffTimer = null;
      // A stop()/restart()/terminal-error that ran during the backoff supersedes
      // this retry — only fire if we're still in the backing-off 'error' state.
      if (this.state !== 'error') return;
      if (!this._isEnabled()) return;
      const Adapter = getAdapter(this.providerId);
      if (Adapter) this._spawnAdapter(Adapter);
    }, delay);
    if (this._backoffTimer.unref) this._backoffTimer.unref();
  }

  _clearBackoffTimer() {
    if (this._backoffTimer) { clearTimeout(this._backoffTimer); this._backoffTimer = null; }
  }

  /** Stop the tunnel. Idempotent; safe before start(). */
  async stop() {
    this._stopping = true;
    this._clearWatchdog();
    this._clearStableTimer();
    this._clearBackoffTimer();
    if (this.adapter) {
      const a = this.adapter;
      this._disposeAdapter();        // late events from the dying child can't flip state
      try { await a.stop(); } catch (e) { /* best effort */ }
    }
    this.pid = null;
    this.url = null;
    this._reachedRunning = false;
    this._setState('stopped');
  }

  /** Stop then start, with a fresh restart budget. */
  restart() {
    this._restartWindowStart = 0;
    this._restartCount = 0;
    this._clearBackoffTimer();
    Promise.resolve(this.stop()).then(() => {
      this._stopping = false;
      this.start();
    }).catch(() => {});
  }
}

module.exports = TunnelManager;
