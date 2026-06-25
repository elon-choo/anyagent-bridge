/**
 * cloudflared NAMED tunnel adapter (stable custom hostname).
 *
 *   cloudflared tunnel --loglevel info run <tunnelName>
 *
 * Requires a Cloudflare account + zone with a pre-created tunnel and a DNS route
 * (`cloudflared tunnel login` -> `tunnel create <name>` -> `tunnel route dns
 * <name> <hostname>`). The public hostname is NOT printed by the CLI — it is the
 * configured `hostname`. Readiness is detected from the stderr line
 * "Registered tunnel connection"; the URL is then `https://<hostname>`.
 *
 * The local service the tunnel proxies to is defined by the `ingress:` rules in
 * ~/.cloudflared/config.yml (not on the command line), so no port is passed.
 */

const BaseAdapter = require('../base-adapter');

const READY_RE = /Registered tunnel connection/;
const ERR_RE = /Cannot determine default origin certificate|credentials file not found|tunnel not found|failed to parse tunnel|Cannot find credentials/i;

class CloudflaredNamedAdapter extends BaseAdapter {
  static get id() { return 'cloudflared-named'; }
  static get label() { return 'cloudflared named tunnel'; }
  static get binaryName() { return 'cloudflared'; }
  static get stableUrl() { return true; }
  static get requiresAccount() { return true; }
  static get installHint() {
    return 'Pre-create a named tunnel: `cloudflared tunnel login` -> `tunnel create <name>` -> '
      + '`tunnel route dns <name> <hostname>`. Set tunnel["cloudflared-named"].tunnelName and .hostname in config.';
  }

  buildArgs() {
    const pc = this.providerConfig || {};
    if (!pc.tunnelName) {
      throw new Error('cloudflared-named requires tunnel["cloudflared-named"].tunnelName');
    }
    return ['tunnel', '--loglevel', 'info', 'run', String(pc.tunnelName)];
  }

  parseLine(line) {
    if (ERR_RE.test(line)) {
      return { error: { code: 'NOT_CONFIGURED', message: 'cloudflared named tunnel not set up (login / create / route dns)' } };
    }
    if (READY_RE.test(line)) return { ready: true };
    return null;
  }
}

module.exports = CloudflaredNamedAdapter;
