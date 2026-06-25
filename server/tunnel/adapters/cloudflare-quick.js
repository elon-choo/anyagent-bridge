/**
 * Cloudflare Quick Tunnel adapter (ephemeral, no account).
 *
 *   cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<PORT>
 *
 * No login required. A random *.trycloudflare.com URL is printed to STDERR
 * (verified: stdout is empty) and rotates on every run. Testing-grade only
 * (~200 concurrent request cap, no SSE).
 */

const BaseAdapter = require('../base-adapter');

const URL_RE = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i;
const FAIL_RE = /Failed to request quick Tunnel/i;

class CloudflareQuickAdapter extends BaseAdapter {
  static get id() { return 'cloudflare-quick'; }
  static get label() { return 'Cloudflare Quick Tunnel'; }
  static get binaryName() { return 'cloudflared'; }
  static get stableUrl() { return false; }
  static get requiresAccount() { return false; }
  static get installHint() {
    return 'Install cloudflared: macOS `brew install cloudflared`; Windows `winget install --id Cloudflare.cloudflared`; '
      + 'Linux: github.com/cloudflare/cloudflared/releases.';
  }

  buildArgs() {
    return ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${this.port}`];
  }

  parseLine(line) {
    const m = line.match(URL_RE);
    if (m) return { url: m[1] };
    // A hard failure to create the quick tunnel — let the manager retry/back off.
    if (FAIL_RE.test(line)) return { error: { code: 'EXIT_BEFORE_URL', message: line.trim() } };
    return null;
  }
}

module.exports = CloudflareQuickAdapter;
