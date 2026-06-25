/**
 * Tailscale Funnel adapter (private mesh, stable public URL).
 *
 *   tailscale funnel <PORT>
 *
 * Requires a logged-in node (`tailscale up`) with Funnel enabled in the tailnet
 * ACL. Prints "Available on the internet:" then the stable
 * https://<machine>.<tailnet>.ts.net URL to STDOUT (source-confirmed). May need
 * sudo depending on the platform.
 */

const BaseAdapter = require('../base-adapter');

const URL_RE = /(https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net[^\s]*)/i;
const ERR_RE = /Funnel not available|Funnel is not enabled|NeedsLogin|logged out|invalid auth/i;

class TailscaleAdapter extends BaseAdapter {
  static get id() { return 'tailscale'; }
  static get label() { return 'Tailscale Funnel'; }
  static get binaryName() { return 'tailscale'; }
  static get stableUrl() { return true; }
  static get requiresAccount() { return true; }
  static get installHint() {
    return 'Install tailscale, run `tailscale up`, and enable Funnel in your tailnet ACL. '
      + 'macOS `brew install tailscale`; Linux `curl -fsSL https://tailscale.com/install.sh | sh`.';
  }

  buildArgs() {
    return ['funnel', String(this.port)];
  }

  parseLine(line) {
    const m = line.match(URL_RE);
    if (m) return { url: m[1] };
    if (ERR_RE.test(line)) {
      return { error: { code: 'NOT_IN_TAILNET', message: 'Run `tailscale up` and enable Funnel in your tailnet ACL' } };
    }
    return null;
  }
}

module.exports = TailscaleAdapter;
