/**
 * Microsoft Dev Tunnels adapter (default provider).
 *
 *   devtunnel host -p <PORT> --allow-anonymous   (temporary tunnel; URL rotates)
 *   devtunnel host <tunnelId> -p <PORT> ...       (reuse a pre-created tunnel)
 *
 * Requires a one-time `devtunnel user login`. `--allow-anonymous` lets browser
 * visitors open the public URL without an MS login (only the bridge token gates
 * access). The CLI prints a multi-line block; the public URL is on the line
 * starting "Connect via browser:".
 */

const BaseAdapter = require('../base-adapter');

// Anchor on the human label so we never grab the "Inspect network activity:" URL.
// Captures the first https://<id>.<region>.devtunnels.ms[...] token, stopping at a comma.
const URL_RE = /(?:Connect via browser:|Hosting port[^\n]*?\bat)\s+(https:\/\/[^\s,]+\.devtunnels\.ms[^\s,]*)/;
const AUTH_ERR_RE = /not logged in|devtunnel user login|unauthorized|\b401\b/i;

class DevtunnelAdapter extends BaseAdapter {
  static get id() { return 'devtunnel'; }
  static get label() { return 'Microsoft Dev Tunnels'; }
  static get binaryName() { return 'devtunnel'; }
  static get stableUrl() { return false; }
  static get requiresAccount() { return true; }
  static get installHint() {
    return 'Install: macOS `brew install --cask devtunnel`; Windows `winget install Microsoft.devtunnel`; '
      + 'Linux `curl -sL https://aka.ms/DevTunnelCliInstall | bash`. First run once: `devtunnel user login`.';
  }

  buildArgs() {
    const pc = this.providerConfig || {};
    const args = ['host'];
    if (pc.tunnelId) args.push(String(pc.tunnelId));
    args.push('-p', String(this.port));
    // --allow-anonymous applies to ad-hoc (temporary) tunnels. A pre-created
    // tunnel (tunnelId) carries its own access policy from `devtunnel access
    // create`, so don't force the flag there unless the operator opts in.
    const wantAnon = pc.tunnelId ? pc.allowAnonymous === true : pc.allowAnonymous !== false;
    if (wantAnon) args.push('--allow-anonymous');
    return args;
  }

  parseLine(line) {
    const m = line.match(URL_RE);
    if (m) return { url: m[1] };
    if (AUTH_ERR_RE.test(line)) {
      return { error: { code: 'LOGIN_REQUIRED', message: 'Dev Tunnels needs login — run: devtunnel user login' } };
    }
    return null;
  }
}

module.exports = DevtunnelAdapter;
