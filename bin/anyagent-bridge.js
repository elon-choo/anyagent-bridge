#!/usr/bin/env node
/**
 * anyagent-bridge — CLI launcher (Stage 5: packaging)
 *
 * A thin wrapper over `server/index.js`. It parses a few friendly flags, maps
 * them onto the environment variables the server already reads, and then boots
 * the server in-process. It sets NOTHING the server doesn't already understand,
 * so running `node server/index.js` directly is always equivalent. CLI flags are
 * applied to process.env before the server loads; dotenv does not override an
 * already-set variable, so the precedence is: CLI flag > .env > config.json.
 *
 *   npx anyagent-bridge --port 8080 --tunnel devtunnel
 *   anyagent-bridge --host 0.0.0.0 --token "$(openssl rand -hex 32)"
 */

'use strict';

const path = require('path');
const pkg = require('../package.json');

const argv = process.argv.slice(2);

function printHelp() {
  const lines = [
    `anyagent-bridge v${pkg.version}`,
    '',
    'Control your local terminal and any CLI AI coding agent from a browser.',
    '',
    'Usage:',
    '  anyagent-bridge [options]',
    '  anyagent-bridge setup            Guided, first-timer setup (recommended to start).',
    '  anyagent-bridge setup --yes      Same, non-interactive (accept defaults; for automation).',
    '',
    'Options:',
    '  -p, --port <n>           Port to listen on (default 3001).',
    '  -H, --host <addr>        Interface to bind (default 127.0.0.1; 0.0.0.0 to expose).',
    '  -t, --token <value>      Pin the access token (default: generated + saved in .data).',
    '      --tunnel [provider]  Enable a remote tunnel. provider = devtunnel (default) |',
    '                           cloudflare-quick | tailscale | cloudflared-named.',
    '      --no-tunnel          Force the tunnel off (overrides config).',
    '  -h, --help               Show this help and exit.',
    '  -v, --version            Print the version and exit.',
    '',
    "Long options also accept --flag=value (use it for a value starting with '-',",
    'e.g. --token=-secret). Every option just sets the matching PORT/HOST/BRIDGE_*',
    'environment variable, so anything here also works via env vars + `npm start`.',
    'Full configuration: config.json (see config.example.json) and docs/INSTALL.md.',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function fail(msg) {
  process.stderr.write(`anyagent-bridge: ${msg}\n`);
  process.stderr.write("Run 'anyagent-bridge --help' for usage.\n");
  process.exit(1);
}

// Subcommand: `anyagent-bridge setup` launches the guided first-timer wizard.
// Anything else is the normal flag-parse + boot below.
if (argv[0] === 'setup') {
  require(path.join(__dirname, 'setup.js'));
} else {
for (let i = 0; i < argv.length; i++) {
  let arg = argv[i];
  // Support the `--flag=value` form for long options. Splitting it out here also
  // lets values that legitimately start with '-' be passed (e.g. --token=-abc),
  // which the space form rejects to avoid swallowing the next flag.
  let inlineValue;
  if (arg.startsWith('--') && arg.includes('=')) {
    const eq = arg.indexOf('=');
    inlineValue = arg.slice(eq + 1);
    arg = arg.slice(0, eq);
  }
  // Resolve this option's value: an inline `=value` wins; otherwise consume the
  // next token, erroring if it is missing or looks like another flag.
  const value = () => {
    if (inlineValue !== undefined) return inlineValue;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) fail(`option ${arg} requires a value`);
    i++;
    return v;
  };
  switch (arg) {
    case '-h':
    case '--help':
      printHelp();
      process.exit(0);
      break;
    case '-v':
    case '--version':
      process.stdout.write(pkg.version + '\n');
      process.exit(0);
      break;
    case '-p':
    case '--port': {
      const v = value();
      if (!/^\d+$/.test(v)) fail(`--port expects a number, got "${v}"`);
      process.env.PORT = v;
      break;
    }
    case '-H':
    case '--host':
      process.env.HOST = value();
      break;
    case '-t':
    case '--token':
      process.env.BRIDGE_AUTH_TOKEN = value();
      break;
    case '--tunnel': {
      process.env.BRIDGE_TUNNEL_ENABLED = 'true';
      if (inlineValue !== undefined) {
        // --tunnel=<provider>
        if (inlineValue) process.env.BRIDGE_TUNNEL_PROVIDER = inlineValue;
      } else {
        // Optional provider as the next token, only if it is not another flag.
        const peek = argv[i + 1];
        if (peek !== undefined && !peek.startsWith('-')) {
          process.env.BRIDGE_TUNNEL_PROVIDER = peek;
          i++;
        }
      }
      break;
    }
    case '--no-tunnel':
      process.env.BRIDGE_TUNNEL_ENABLED = 'false';
      break;
    default:
      fail(`unknown option "${arg}"`);
  }
}

// Boot the server in-process. ROOT inside the server resolves relative to its own
// __dirname, so config.json and .data live alongside the installed package.
require(path.join(__dirname, '..', 'server', 'index.js'));
}
