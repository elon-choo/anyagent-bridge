#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('Playwright is required for this opt-in client UX check. Install it in this checkout with: npm install --no-save playwright');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const OUT_DIR = process.env.AAB_OUTPUT_DIR || '/tmp/anyagent-bridge-client-compose';
const REPORT_PATH = path.join(OUT_DIR, 'compose-history-report.json');

fs.mkdirSync(OUT_DIR, { recursive: true });

const appHtml = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');

const XTERM_STUB = `
window.Terminal = class {
  constructor() {
    this.cols = 80;
    this.rows = 24;
    this._onData = null;
  }
  loadAddon() {}
  open(el) {
    const root = document.createElement('div');
    root.className = 'xterm';
    const viewport = document.createElement('div');
    viewport.className = 'xterm-viewport';
    viewport.style.height = '240px';
    viewport.style.overflow = 'auto';
    const rows = document.createElement('div');
    rows.className = 'xterm-rows';
    viewport.appendChild(rows);
    root.appendChild(viewport);
    el.appendChild(root);
    this._rows = rows;
  }
  onData(fn) { this._onData = fn; }
  write(data) {
    if (!this._rows) return;
    const row = document.createElement('div');
    row.textContent = String(data || '');
    this._rows.appendChild(row);
  }
  focus() {}
  reset() { if (this._rows) this._rows.textContent = ''; }
  clear() { if (this._rows) this._rows.textContent = ''; }
};
`;

const FIT_STUB = 'window.FitAddon = { FitAddon: class { fit() {} } };';

function mockJson(route, body) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function installRoutes(context) {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/' || pathname === '/index.html') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: appHtml });
    }
    if (request.url().includes('/@xterm/xterm') && pathname.endsWith('/xterm.min.js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: XTERM_STUB });
    }
    if (request.url().includes('/@xterm/addon-fit')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: FIT_STUB });
    }
    if (request.url().includes('/@xterm/xterm') && pathname.endsWith('.css')) {
      return route.fulfill({ status: 200, contentType: 'text/css', body: '.xterm{}' });
    }
    if (pathname === '/api/auth/config') return mockJson(route, { methods: {} });
    if (pathname === '/api/auth/login') return mockJson(route, { ok: true, token: 'mock-session' });
    if (pathname === '/api/agents') return mockJson(route, { agents: [{ id: 'mock', name: 'Mock Agent' }] });
    if (pathname === '/api/projects') return mockJson(route, { projects: [] });
    if (pathname === '/api/system/status') {
      return mockJson(route, {
        server: { host: '127.0.0.1', port: 3002 },
        auth: { requireLogin: false },
        tunnel: null
      });
    }
    if (pathname === '/manifest.webmanifest') {
      return route.fulfill({ status: 200, contentType: 'application/manifest+json', body: '{}' });
    }
    if (pathname === '/icon.svg') {
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    }
    if (pathname === '/sw.js') {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    }
    return route.fulfill({ status: 404, contentType: 'text/plain', body: `mock 404 ${pathname}` });
  });
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const pageErrors = [];

  await context.addInitScript(() => {
    window.__sentFrames = [];
    window.__mockSockets = [];

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        window.__mockSockets.push(this);
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          if (this.onopen) this.onopen({});
        }, 10);
      }

      send(payload) {
        let msg = null;
        try { msg = JSON.parse(payload); } catch (err) {}
        window.__sentFrames.push(msg || payload);
        if (!msg) return;
        if (msg.type === 'init') {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({ data: JSON.stringify({ type: 'ready', sessionId: 42, isReconnect: false }) });
            }
          }, 10);
        }
        if (msg.type === 'sendToAgent') {
          setTimeout(() => {
            if (this.onmessage) {
              this.onmessage({ data: JSON.stringify({ type: 'output', data: `\r\n${msg.text}\r\n` }) });
            }
          }, 10);
        }
      }

      close() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose({ code: 1000 });
      }
    }

    window.WebSocket = MockWebSocket;
  });

  await installRoutes(context);
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') pageErrors.push(`console: ${msg.text()}`);
  });

  try {
    await page.goto('http://127.0.0.1:3999/?token=mock-token', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#terminal .xterm', { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('#statusText')?.textContent.includes('connected'), { timeout: 10000 });

    const historyText = 'echo FINAL_HISTORY_MULTI_A\necho FINAL_HISTORY_MULTI_B';
    const typedText = 'FIRST LINE\nSECOND LINE';

    await page.fill('#composeInput', historyText);
    await page.click('#composeSend');
    await page.waitForFunction(
      (expected) => window.__sentFrames.some((f) => f && f.type === 'sendToAgent' && f.text === expected),
      historyText,
      { timeout: 5000 }
    );

    await page.fill('#composeInput', '');
    await page.focus('#composeInput');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    const recalled = await page.$eval('#composeInput', (el) => el.value);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const afterDown = await page.$eval('#composeInput', (el) => el.value);

    await page.fill('#composeInput', typedText);
    await page.$eval('#composeInput', (el) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    const typedAfterUp = await page.$eval('#composeInput', (el) => el.value);

    const report = {
      sentExact: await page.evaluate((expected) =>
        window.__sentFrames.some((f) => f && f.type === 'sendToAgent' && f.text === expected),
        historyText
      ),
      recalledMultiline: recalled === historyText,
      arrowDownClears: afterDown === '',
      typedMultilineProtected: typedAfterUp === typedText,
      pageErrors,
      status: await page.$eval('#statusText', (el) => el.textContent),
      sentFrameTypes: await page.evaluate(() => window.__sentFrames.map((f) => f && f.type))
    };
    report.ok = report.sentExact &&
      report.recalledMultiline &&
      report.arrowDownClears &&
      report.typedMultilineProtected &&
      report.pageErrors.length === 0;

    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    if (!report.ok) {
      console.error(`Client compose history check failed. Report: ${REPORT_PATH}`);
      process.exit(1);
    }
    console.log(`Client compose history check passed. Report: ${REPORT_PATH}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
