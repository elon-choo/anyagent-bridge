/**
 * AnyAgent Bridge — tunnel CLI detection (Stage 2)
 *
 * Cross-platform "is this CLI on PATH, and where" probe. A pure fs scan of PATH
 * (no shell spawned), so it behaves identically on macOS / Linux / Windows.
 * On Windows it honors PATHEXT (.EXE/.CMD/.BAT/...). Never throws.
 *
 * Not cached: detect() runs only on tunnel start/restart (rare), and a fresh
 * scan means a CLI installed (or removed) after boot is seen on the next
 * /api/tunnel/restart rather than a stale result lingering for the process life.
 */

const fs = require('fs');
const path = require('path');

// Candidate filenames to look for in each PATH dir. On Windows a bare name is
// not directly executable — it must carry a PATHEXT extension.
function _candidates(bin) {
  if (process.platform !== 'win32') return [bin];
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';').map(e => e.trim()).filter(Boolean);
  const names = [bin]; // in case the caller already supplied an extension
  for (const ext of exts) {
    names.push(bin + ext.toLowerCase());
    names.push(bin + ext.toUpperCase());
  }
  return names;
}

function _isExecutableFile(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === 'win32') return true; // PATHEXT already gates it
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch (e) {
    return false;
  }
}

/** Resolve a binary name to an absolute path by scanning PATH. null if absent. */
function findOnPath(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = _candidates(bin);
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (_isExecutableFile(full)) return full;
    }
  }
  return null;
}

/** Detect a CLI binary. Returns { available, path }. Never throws. */
function detect(binaryName) {
  try {
    const resolved = findOnPath(binaryName);
    return { available: !!resolved, path: resolved };
  } catch (e) {
    return { available: false, path: null };
  }
}

module.exports = { detect, findOnPath };
