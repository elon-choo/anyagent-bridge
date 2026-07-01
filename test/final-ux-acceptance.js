#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('Playwright is required for this opt-in UX check. Install it in this checkout with: npm install --no-save playwright');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const OUT_DIR = process.env.AAB_OUTPUT_DIR || '/tmp/anyagent-bridge-final-audit';
const BASE_URL = process.env.AAB_BASE_URL || 'http://127.0.0.1:3002';
const FUNNEL_URL = process.env.AAB_FUNNEL_URL || 'https://anyagent-bridge.tail8e6e6f.ts.net';
const LANDING_URL = process.env.AAB_LANDING_URL || 'https://anyagent-bridge.vercel.app';
const AUTH_FILE = process.env.AAB_AUTH_FILE || path.join(ROOT, '.data', 'auth.json');
const SKIP_FUNNEL = process.env.AAB_SKIP_FUNNEL === '1';
const SKIP_LANDING = process.env.AAB_SKIP_LANDING === '1';
const CRED_PARAM = ['to', 'ken'].join('');

fs.mkdirSync(OUT_DIR, { recursive: true });

function readCredential() {
  if (process.env.AAB_AUTH_VALUE) return process.env.AAB_AUTH_VALUE;
  const raw = fs.readFileSync(AUTH_FILE, 'utf8');
  const data = JSON.parse(raw);
  const value = data && data[CRED_PARAM];
  if (!value || typeof value !== 'string') {
    throw new Error(`No bridge credential found in ${AUTH_FILE}`);
  }
  return value;
}

const credential = readCredential();

function redact(text) {
  return String(text || '').split(credential).join('[redacted]');
}

function cleanUrl(value) {
  try {
    const url = new URL(String(value));
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (err) {
    return redact(value);
  }
}

function appUrl(base, extra = {}) {
  const url = new URL(base);
  url.searchParams.set(CRED_PARAM, credential);
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function apiUrl(base, pathname, params = {}) {
  const url = new URL(pathname, base);
  url.searchParams.set(CRED_PARAM, credential);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function apiJson(base, pathname, options = {}) {
  const response = await fetchWithTimeout(apiUrl(base, pathname, options.params), {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = { raw: text.slice(0, 500) }; }
  return { ok: response.ok, status: response.status, body };
}

async function listSessions() {
  const response = await apiJson(BASE_URL, '/api/sessions');
  if (!response.ok) throw new Error(`/api/sessions returned ${response.status}`);
  return response.body.sessions || [];
}

function writeJson(fileName, data) {
  const filePath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  return filePath;
}

function smallPngFile() {
  const filePath = path.join(OUT_DIR, 'pixel.png');
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    ));
  }
  return filePath;
}

function compactMessage(value) {
  const text = redact(value);
  return text.length > 600 ? text.slice(0, 600) + '...' : text;
}

function parseFrame(payload, direction) {
  let data;
  try { data = JSON.parse(String(payload)); } catch (err) { return null; }
  const item = { type: data.type };
  if (direction === 'sent') {
    if (data.cols) item.cols = data.cols;
    if (data.rows) item.rows = data.rows;
    if (data.agentId) item.agentId = data.agentId;
    if (typeof data.text === 'string') item.text = data.text;
    if (typeof data.data === 'string') item.data = data.data;
  } else {
    if (data.sessionId) item.sessionId = data.sessionId;
    if (data.projectPath) item.projectPath = data.projectPath;
    if (data.isReconnect !== undefined) item.isReconnect = data.isReconnect;
    if (data.persistent !== undefined) item.persistent = data.persistent;
    if (typeof data.message === 'string') item.message = compactMessage(data.message);
    if (typeof data.data === 'string') item.sample = compactMessage(data.data.slice(0, 260));
  }
  return item;
}

function createRunState() {
  return {
    pageErrors: [],
    consoleErrors: [],
    dialogs: [],
    requestFailures: [],
    createdSessions: new Set(),
    createdProjects: new Set(),
    fixtureDirs: new Set()
  };
}

function attachPageWatchers(page, state, name) {
  const tracker = { name, sent: [], received: [], sessionIds: [] };
  page.on('pageerror', err => state.pageErrors.push({ page: name, message: compactMessage(err.message || err) }));
  page.on('console', msg => {
    if (msg.type() === 'error') state.consoleErrors.push({ page: name, text: compactMessage(msg.text()) });
  });
  page.on('dialog', async dialog => {
    state.dialogs.push({ page: name, type: dialog.type(), message: compactMessage(dialog.message()) });
    await dialog.dismiss().catch(() => {});
  });
  page.on('requestfailed', request => {
    const failure = request.failure();
    state.requestFailures.push({
      page: name,
      url: cleanUrl(request.url()),
      method: request.method(),
      error: failure ? compactMessage(failure.errorText) : 'request failed'
    });
  });
  page.on('websocket', ws => {
    ws.on('framesent', event => {
      const item = parseFrame(event.payload, 'sent');
      if (item) tracker.sent.push(item);
    });
    ws.on('framereceived', event => {
      const item = parseFrame(event.payload, 'received');
      if (!item) return;
      tracker.received.push(item);
      if (item.type === 'ready' && item.sessionId) {
        tracker.sessionIds.push(item.sessionId);
        if (!item.isReconnect) state.createdSessions.add(item.sessionId);
      }
    });
  });
  return tracker;
}

async function waitFor(page, fn, arg, label, timeout = 15000) {
  try {
    await page.waitForFunction(fn, arg, { timeout });
  } catch (err) {
    throw new Error(`Timed out waiting for ${label}`);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTracker(tracker, predicate, label, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = predicate(tracker);
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForStatus(page, text, timeout = 15000) {
  await waitFor(page, expected => {
    const el = document.querySelector('#statusText');
    return el && el.textContent && el.textContent.includes(expected);
  }, text, `status ${text}`, timeout);
}

async function openApp(page, base, options = {}) {
  await page.goto(appUrl(base, options.params), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#terminal .xterm', { timeout: 20000 });
  await waitForStatus(page, 'connected', 20000);
  if (options.waitForStarter !== false) {
    await page.waitForSelector('#starterPanel.open', { timeout: 15000 });
  }
}

async function stateSnapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom)
      };
    };
    const controlMetrics = (selector) => Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          id: el.id || null,
          text: (el.textContent || el.getAttribute('aria-label') || '').trim(),
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.x),
          y: Math.round(r.y)
        };
      });
    const starterButtons = controlMetrics('#starterPanel button');
    const agentButtons = controlMetrics('#agentbar button');
    const toolbarButtons = controlMetrics('#bar button, #bar select, #exposureBadge, #status');
    const rows = Array.from(document.querySelectorAll('#terminal .xterm-rows div'))
      .slice(-8)
      .map(el => (el.textContent || '').trim())
      .filter(Boolean);
    const body = document.body ? document.body.innerText : '';
    return {
      status: document.querySelector('#statusText')?.textContent?.trim() || '',
      starterOpen: !!document.querySelector('#starterPanel.open'),
      agentAssist: !!document.querySelector('#dock.agent-assist'),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyHasHome: body.includes('/Users/'),
      bodyHasFinalDesktop: body.includes('FINAL_DESKTOP'),
      bodyHasFinalMultiview: body.includes('FINAL_MULTIVIEW'),
      composeValue: document.querySelector('#composeInput')?.value || '',
      rows,
      starterRect: rectOf(document.querySelector('#starterPanel')),
      dockRect: rectOf(document.querySelector('#dock')),
      termwrapRect: rectOf(document.querySelector('#termwrap')),
      toolbarRect: rectOf(document.querySelector('#bar')),
      starterButtons,
      agentButtons,
      toolbarButtons,
      starterButtonsSafe44: starterButtons.every(b => b.w >= 44 && b.h >= 44),
      agentButtonsSafe44: agentButtons.every(b => b.w >= 44 && b.h >= 44),
      toolbarTouchSafe44: toolbarButtons.every(b => b.w >= 44 && b.h >= 44)
    };
  });
}

async function terminalScrollSnapshot(page, target = null) {
  if (target !== null) {
    await page.evaluate((nextTarget) => {
      const viewport = document.querySelector('#terminal .xterm-viewport');
      if (!viewport) return;
      if (nextTarget === 'quarter') {
        viewport.scrollTop = Math.round(viewport.scrollHeight * 0.25);
        viewport.dispatchEvent(new Event('scroll'));
      } else if (typeof nextTarget === 'number') {
        viewport.scrollTop = nextTarget;
        viewport.dispatchEvent(new Event('scroll'));
      }
    }, target);
    await page.waitForTimeout(80);
  }
  return page.evaluate(() => {
    const viewport = document.querySelector('#terminal .xterm-viewport');
    if (!viewport) return { available: false };
    return {
      available: true,
      scrollTop: Math.round(viewport.scrollTop),
      scrollHeight: Math.round(viewport.scrollHeight),
      clientHeight: Math.round(viewport.clientHeight),
      topRows: Array.from(document.querySelectorAll('#terminal .xterm-rows div'))
        .slice(0, 5)
        .map(el => (el.textContent || '').trim())
    };
  });
}

async function keyboardSnapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rectOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom)
      };
    };
    const controlMetrics = (selector) => Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          id: el.id || (el.textContent || '').trim(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom)
        };
      });
    const input = rectOf('#composeInput');
    const send = rectOf('#composeSend');
    const controls = controlMetrics('#composebar .attach, #composeSend, #composeInput, #keybar .kb, #quickbar .qc');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      visualViewport: {
        width: Math.round(window.visualViewport ? window.visualViewport.width : window.innerWidth),
        height: Math.round(window.visualViewport ? window.visualViewport.height : window.innerHeight)
      },
      activeId: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      bodyHasKeyboardProbe: document.body ? document.body.innerText.includes('KEYBOARD_PROBE') : false,
      composeValue: document.querySelector('#composeInput')?.value || '',
      termwrapRect: rectOf('#termwrap'),
      composebarRect: rectOf('#composebar'),
      inputRect: input,
      sendRect: send,
      inputVisible: visible(document.querySelector('#composeInput')),
      sendVisible: visible(document.querySelector('#composeSend')),
      inputWithinViewport: !!(input && input.top >= 0 && input.bottom <= window.innerHeight),
      sendWithinViewport: !!(send && send.top >= 0 && send.bottom <= window.innerHeight),
      controls,
      controlsTouchSafe44: controls.every(control => control.w >= 44 && control.h >= 44)
    };
  });
}

async function notificationSnapshot(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const modal = document.querySelector('#notifModal');
    const modes = Array.from(document.querySelectorAll('#notifModes [data-push-mode]')).map(button => {
      const rect = button.getBoundingClientRect();
      return {
        mode: button.dataset.pushMode,
        checked: button.getAttribute('aria-checked') === 'true',
        on: button.classList.contains('on'),
        text: (button.textContent || '').trim(),
        w: Math.round(rect.width),
        h: Math.round(rect.height)
      };
    });
    const active = modes.find(mode => mode.checked && mode.on);
    return {
      open: !!(modal && modal.classList.contains('open') && visible(modal)),
      activeMode: active ? active.mode : null,
      summary: document.querySelector('#notifSummary')?.textContent || '',
      status: document.querySelector('#notifStatus')?.textContent || '',
      toolbarText: document.querySelector('#notifBtn')?.textContent || '',
      modes,
      modesTouchSafe44: modes.every(mode => mode.w >= 44 && mode.h >= 44),
      singleActiveMode: modes.filter(mode => mode.checked && mode.on).length === 1,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
    };
  });
}

async function modalInfo(page, selector) {
  return page.evaluate((sel) => {
    const modal = document.querySelector(sel);
    if (!modal) return { open: false };
    const active = document.activeElement;
    const style = getComputedStyle(modal);
    const rect = modal.getBoundingClientRect();
    return {
      open: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      role: modal.getAttribute('role'),
      modal: modal.getAttribute('aria-modal'),
      labelledBy: modal.getAttribute('aria-labelledby'),
      describedBy: modal.getAttribute('aria-describedby'),
      focusInside: !!(active && modal.contains(active)),
      activeId: active ? active.id || active.tagName : null
    };
  }, selector);
}

async function verifyModals(page) {
  const specs = [
    { name: 'connect', open: '#connectBtn', modal: '#onboard', close: '#obClose', expectedFocus: 'connectBtn' },
    { name: 'projects', open: '#projBtn', modal: '#projModal', close: '#pmClose', expectedFocus: 'projBtn' },
    { name: 'secrets', open: '#secBtn', modal: '#secModal', close: '#secClose', expectedFocus: 'secBtn' },
    { name: 'files', open: '#filesBtn', modal: '#fileExp', close: '#fxClose', expectedFocus: 'filesBtn' },
    { name: 'notifications', open: '#notifBtn', modal: '#notifModal', close: '#notifClose', expectedFocus: 'notifBtn' },
    { name: 'sessions', open: '#sessBtn', modal: '#sessModal', close: '#sessClose', expectedFocus: 'sessBtn' }
  ];
  const results = {};
  for (const spec of specs) {
    await page.click(spec.open);
    await waitFor(page, sel => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }, spec.modal, `${spec.name} modal`);
    await page.waitForTimeout(120);
    const opened = await modalInfo(page, spec.modal);
    await page.click(spec.close);
    await waitFor(page, sel => {
      const el = document.querySelector(sel);
      if (!el) return true;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
    }, spec.modal, `${spec.name} modal close`);
    await page.waitForTimeout(80);
    const restoredTo = await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    results[spec.name] = { opened, closed: { restoredTo, expected: spec.expectedFocus } };
  }
  return results;
}

async function openSessionsModal(page) {
  await page.click('#sessBtn');
  await waitFor(page, () => {
    const el = document.querySelector('#sessModal');
    if (!el) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }, null, 'sessions modal');
}

async function waitForSessionRow(page, sessionId, label) {
  await waitFor(page, id => Array.from(document.querySelectorAll('#sxList .sx-item'))
    .some(row => row.dataset.sessionId === String(id)), String(sessionId), label);
}

async function composeValue(page) {
  return page.evaluate(() => document.querySelector('#composeInput')?.value || '');
}

async function switchToSession(page, tracker, sessionId, label) {
  const readyIndex = tracker.received.length;
  await page.click(`#sxList .sx-item[data-session-id="${sessionId}"]`);
  await waitForTracker(tracker, item => item.received.slice(readyIndex).some(frame =>
    frame.type === 'ready' && String(frame.sessionId) === String(sessionId)
  ), `${label} ready`, 20000);
  await waitForStatus(page, 'connected', 20000);
}

async function verifySessionSwitch(page, tracker) {
  const firstSession = await waitForTracker(tracker, item => item.sessionIds[0], 'initial desktop session');
  const firstDraftBeforeSwitch = await composeValue(page);
  await openSessionsModal(page);
  await waitForSessionRow(page, firstSession, 'initial session row');

  const newReadyIndex = tracker.received.length;
  await page.click('#sxNew');
  const secondSession = await waitForTracker(tracker, item => {
    const ready = item.received.slice(newReadyIndex).find(frame =>
      frame.type === 'ready' &&
      frame.sessionId &&
      String(frame.sessionId) !== String(firstSession) &&
      frame.isReconnect === false
    );
    return ready && ready.sessionId;
  }, 'new session ready', 20000);
  await waitForStatus(page, 'connected', 20000);
  const secondInitialDraft = await composeValue(page);

  await page.fill('#composeInput', 'echo FINAL_SWITCH_SECOND');
  await page.click('#composeSend');
  await waitFor(page, () => document.body.innerText.includes('FINAL_SWITCH_SECOND'), null, 'second session output', 15000);
  const secondBody = await page.evaluate(() => document.body ? document.body.innerText : '');
  const secondDraft = 'SECOND_UNSENT_DRAFT_ROUND26';
  await page.fill('#composeInput', secondDraft);
  await waitFor(page, expected => document.querySelector('#composeInput')?.value === expected, secondDraft, 'second session draft entry');

  await openSessionsModal(page);
  await waitForSessionRow(page, firstSession, 'switch-back session row');
  await waitForSessionRow(page, secondSession, 'current second session row');

  await switchToSession(page, tracker, firstSession, 'switch back');
  await terminalScrollSnapshot(page, 0);
  await waitFor(page, () => document.body.innerText.includes('FINAL_DESKTOP'), null, 'original session output after switch back', 20000);
  await waitFor(page, expected => document.querySelector('#composeInput')?.value === expected, firstDraftBeforeSwitch, 'first session draft restore');
  const firstBody = await page.evaluate(() => document.body ? document.body.innerText : '');
  const firstDraftAfterBack = await composeValue(page);

  await openSessionsModal(page);
  await waitForSessionRow(page, secondSession, 'second draft session row');
  await switchToSession(page, tracker, secondSession, 'second draft restore');
  await waitFor(page, expected => document.querySelector('#composeInput')?.value === expected, secondDraft, 'second session draft restore');
  const secondDraftAfterReturn = await composeValue(page);

  await openSessionsModal(page);
  await waitForSessionRow(page, firstSession, 'final first session row');
  await switchToSession(page, tracker, firstSession, 'final switch back');
  await waitFor(page, expected => document.querySelector('#composeInput')?.value === expected, firstDraftBeforeSwitch, 'final first session draft restore');
  const firstDraftAfterFinalBack = await composeValue(page);

  return {
    firstSession,
    secondSession,
    createdDifferent: String(firstSession) !== String(secondSession),
    secondCommandVisible: secondBody.includes('FINAL_SWITCH_SECOND'),
    switchBackReady: true,
    originalOutputRestored: firstBody.includes('FINAL_DESKTOP'),
    firstDraftContainsUpload: /uploads\/.*pixel\.png/.test(firstDraftBeforeSwitch),
    secondStartedClean: secondInitialDraft === '',
    firstDraftRestored: firstDraftAfterBack === firstDraftBeforeSwitch && firstDraftAfterFinalBack === firstDraftBeforeSwitch,
    secondDraftRestored: secondDraftAfterReturn === secondDraft,
    secondDraftIsolated: secondDraftAfterReturn === secondDraft && !firstDraftAfterBack.includes(secondDraft)
  };
}

function hasSent(tracker, type, predicate = () => true) {
  return tracker.sent.some(item => item.type === type && predicate(item));
}

function hasReceived(tracker, type, predicate = () => true) {
  return tracker.received.some(item => item.type === type && predicate(item));
}

async function localDesktopFlow(browser, state) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-desktop');
  await openApp(page, BASE_URL);
  const initial = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-desktop-starter.png'), fullPage: true });

  await page.fill('#composeInput', 'echo FINAL_DESKTOP');
  await page.click('#composeSend');
  await waitFor(page, () => document.body.innerText.includes('FINAL_DESKTOP'), null, 'FINAL_DESKTOP output', 15000);

  await page.fill('#composeInput', 'for i in $(seq 1 140); do echo FINAL_SCROLL_$i; done');
  await page.click('#composeSend');
  await waitFor(page, () => document.body.innerText.includes('FINAL_SCROLL_140'), null, 'FINAL_SCROLL output', 20000);

  await page.setInputFiles('#imgFile', smallPngFile());
  await waitFor(page, () => /uploads\/.*pixel\.png/.test(document.querySelector('#composeInput')?.value || ''), null, 'image attach path');

  await page.locator('#keybar .kb').filter({ hasText: /^Esc$/ }).first().click();
  await waitFor(page, () => true, null, 'event loop', 1000).catch(() => {});

  const sessionSwitch = await verifySessionSwitch(page, tracker);
  const modals = await verifyModals(page);

  await page.waitForTimeout(500);
  const scrollBeforeReconnect = await terminalScrollSnapshot(page, 'quarter');

  await context.setOffline(true);
  await waitForStatus(page, 'offline', 15000);
  const offline = await stateSnapshot(page);
  await context.setOffline(false);
  await waitForStatus(page, 'connected', 20000);
  await page.waitForTimeout(500);
  const scrollAfterReconnect = await terminalScrollSnapshot(page);
  const reconnected = await stateSnapshot(page);

  const reloadReadyIndex = tracker.received.length;
  const scrollBeforeReload = await terminalScrollSnapshot(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#terminal .xterm', { timeout: 20000 });
  await waitForStatus(page, 'connected', 20000);
  const reloadReady = await waitForTracker(tracker, item => item.received.slice(reloadReadyIndex).find(frame =>
    frame.type === 'ready' && String(frame.sessionId) === String(tracker.sessionIds[0]) && frame.isReconnect === true
  ), 'desktop reload reconnect', 20000);
  await page.waitForTimeout(1000);
  const scrollAfterReload = await terminalScrollSnapshot(page);
  const afterReload = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-desktop-after.png'), fullPage: true });
  await page.screenshot({ path: path.join(OUT_DIR, 'local-desktop-after-reload.png'), fullPage: true });

  await context.close();
  return {
    initialSession: tracker.sessionIds[0] || null,
    tracker,
    initial,
    sessionSwitch,
    modals,
    scrollBeforeReconnect,
    offline,
    scrollAfterReconnect,
    reconnected,
    reloadReady,
    scrollBeforeReload,
    scrollAfterReload,
    afterReload
  };
}

async function localMobileFlow(browser, state) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-mobile-320');
  await openApp(page, BASE_URL);
  const initial = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-320-starter.png'), fullPage: true });

  await page.click('#starterPanel button[data-starter-cmd="pwd"]');
  await waitFor(page, () => document.body.innerText.includes('/Users/'), null, 'pwd output', 15000);
  const afterFirstCommand = await stateSnapshot(page);

  await page.click('#startBtn');
  await waitFor(page, () => document.querySelector('#dock')?.classList.contains('agent-assist'), null, 'mobile launch assist', 15000);
  const launchAssist = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-320-launch.png'), fullPage: true });

  await page.locator('#agentbar button[aria-label="Escape"]').click();
  await page.locator('#agentbar button[aria-label="Ctrl-C"]').click();
  await page.waitForTimeout(500);

  await context.close();
  return { initialSession: tracker.sessionIds[0] || null, tracker, initial, afterFirstCommand, launchAssist };
}

async function localMultiViewerFlow(browser, state) {
  const contextA = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const pageA = await contextA.newPage();
  const trackerA = attachPageWatchers(pageA, state, 'local-multiviewer-primary');
  await openApp(pageA, BASE_URL);
  const firstSession = await waitForTracker(trackerA, item => item.sessionIds[0], 'primary multiviewer session');
  const primaryInitial = await stateSnapshot(pageA);

  const contextB = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const pageB = await contextB.newPage();
  const trackerB = attachPageWatchers(pageB, state, 'local-multiviewer-secondary');
  await openApp(pageB, BASE_URL, { params: { session: firstSession }, waitForStarter: false });
  const secondReady = await waitForTracker(trackerB, item => item.received.find(frame =>
    frame.type === 'ready' && frame.sessionId
  ), 'secondary multiviewer ready');
  const secondaryInitial = await stateSnapshot(pageB);
  const secondaryUrlCleaned = await pageB.evaluate(() => !new URLSearchParams(location.search).has('session'));

  await pageB.fill('#composeInput', 'echo FINAL_MULTIVIEW');
  await pageB.click('#composeSend');
  await waitFor(pageA, () => document.body.innerText.includes('FINAL_MULTIVIEW'), null, 'primary multiviewer output', 15000);
  await waitFor(pageB, () => document.body.innerText.includes('FINAL_MULTIVIEW'), null, 'secondary multiviewer output', 15000);
  const primaryAfter = await stateSnapshot(pageA);
  const secondaryAfter = await stateSnapshot(pageB);
  await pageA.screenshot({ path: path.join(OUT_DIR, 'local-multiviewer-primary.png'), fullPage: true });
  await pageB.screenshot({ path: path.join(OUT_DIR, 'local-multiviewer-secondary.png'), fullPage: true });

  await contextB.close();
  await contextA.close();
  return {
    firstSession,
    secondSession: secondReady.sessionId || null,
    secondaryReconnect: secondReady.isReconnect === true,
    secondaryUrlCleaned,
    trackerA,
    trackerB,
    primaryInitial,
    secondaryInitial,
    primaryAfter,
    secondaryAfter
  };
}

async function localCloseCurrentFlow(browser, state) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-close-current');
  await openApp(page, BASE_URL);
  const firstSession = await waitForTracker(tracker, item => item.sessionIds[0], 'close-current initial session');

  await page.fill('#composeInput', 'CLOSE_CURRENT_DRAFT');
  await page.evaluate((id) => {
    localStorage.setItem(`aab.terminalScroll.${id}`, JSON.stringify({ scrollTop: 123, maxScroll: 456, at: Date.now() }));
  }, firstSession);
  const before = await page.evaluate((id) => ({
    compose: document.querySelector('#composeInput')?.value || '',
    oldDraft: localStorage.getItem(`aab.composeDraft.${id}`),
    oldScroll: localStorage.getItem(`aab.terminalScroll.${id}`)
  }), firstSession);

  const readyIndex = tracker.received.length;
  await openSessionsModal(page);
  await page.click('#sessModal .sx-item.cur .kill');
  await page.waitForSelector('#sessModal .sx-item.cur .sx-confirm', { timeout: 15000 });
  await page.click('#sessModal .sx-item.cur .sx-confirm .danger');
  const replacementReady = await waitForTracker(tracker, item => item.received.slice(readyIndex).find(frame =>
    frame.type === 'ready' &&
    frame.sessionId &&
    String(frame.sessionId) !== String(firstSession) &&
    frame.isReconnect === false
  ), 'close-current replacement session', 20000);
  await waitForStatus(page, 'connected', 20000);
  await page.waitForTimeout(800);

  const secondSession = replacementReady.sessionId;
  const after = await page.evaluate((ids) => ({
    compose: document.querySelector('#composeInput')?.value || '',
    oldDraft: localStorage.getItem(`aab.composeDraft.${ids.first}`),
    oldScroll: localStorage.getItem(`aab.terminalScroll.${ids.first}`),
    newDraft: localStorage.getItem(`aab.composeDraft.${ids.second}`),
    newScroll: localStorage.getItem(`aab.terminalScroll.${ids.second}`)
  }), { first: firstSession, second: secondSession });
  const snapshot = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-close-current-after.png'), fullPage: true });

  await context.close();
  state.createdSessions.delete(firstSession);
  return { firstSession, secondSession, replacementReady, tracker, before, after, snapshot };
}

async function localMobileLandscapeFlow(browser, state) {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-mobile-landscape-844');
  await openApp(page, BASE_URL);
  const initial = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-landscape-844-starter.png'), fullPage: true });

  await page.click('#starterPanel button[data-starter-cmd="pwd"]');
  await waitFor(page, () => document.body.innerText.includes('/Users/'), null, 'landscape pwd output', 15000);
  const afterFirstCommand = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-landscape-844-after.png'), fullPage: true });

  await context.close();
  return { initialSession: tracker.sessionIds[0] || null, tracker, initial, afterFirstCommand };
}

async function localMobileKeyboardFlow(browser, state) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-mobile-keyboard-390');
  await openApp(page, BASE_URL);

  await page.fill('#composeInput', 'echo KEYBOARD_PROBE');
  await page.focus('#composeInput');
  const beforeShrink = await keyboardSnapshot(page);
  await page.setViewportSize({ width: 390, height: 560 });
  await page.waitForTimeout(250);
  const afterShrink = await keyboardSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-keyboard-390-shrink.png'), fullPage: true });

  await page.click('#composeSend');
  await waitFor(page, () => document.body.innerText.includes('KEYBOARD_PROBE'), null, 'keyboard shrink command output', 15000);
  const afterSend = await keyboardSnapshot(page);

  await context.close();
  return { initialSession: tracker.sessionIds[0] || null, tracker, beforeShrink, afterShrink, afterSend };
}

async function localMobileNotificationsFlow(browser, state) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-mobile-notifications-390');
  await openApp(page, BASE_URL);

  async function openNotifications() {
    await page.click('#notifBtn');
    await waitFor(page, () => document.querySelector('#notifModal')?.classList.contains('open'), null, 'notifications modal open');
  }
  async function chooseMode(mode) {
    await page.click(`#notifModes [data-push-mode="${mode}"]`);
    await waitFor(page, expected => {
      const button = document.querySelector(`#notifModes [data-push-mode="${expected}"]`);
      return button && button.getAttribute('aria-checked') === 'true' && button.classList.contains('on');
    }, mode, `${mode} notification mode`);
  }
  async function closeNotifications() {
    await page.click('#notifClose');
    await waitFor(page, () => !document.querySelector('#notifModal')?.classList.contains('open'), null, 'notifications modal close');
  }

  await openNotifications();
  const initial = await notificationSnapshot(page);
  await chooseMode('quiet');
  const quiet = await notificationSnapshot(page);
  await closeNotifications();
  await openNotifications();
  const quietReopen = await notificationSnapshot(page);
  await chooseMode('important');
  const important = await notificationSnapshot(page);
  await closeNotifications();
  await openNotifications();
  const importantReopen = await notificationSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-notifications-390.png'), fullPage: true });
  await closeNotifications();

  await context.close();
  return { initialSession: tracker.sessionIds[0] || null, tracker, initial, quiet, quietReopen, important, importantReopen };
}

async function setupFileFixture(state) {
  const id = `${Date.now()}-${process.pid}`;
  const dir = path.join(ROOT, 'uploads', 'ux-final-files', id);
  const fileName = 'mobile-preview.md';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), [
    '# Round 24 Mobile File UX',
    '',
    '- Markdown preview is visible on a phone viewport.',
    '- The file tree can open a project-scoped fixture.',
    '',
    '<script>window.__aabUxFinalXss = 1</script>',
    ''
  ].join('\n'), 'utf8');
  state.fixtureDirs.add(dir);

  const projectName = `AAB UX Final Files ${id}`;
  const response = await apiJson(BASE_URL, '/api/projects', {
    method: 'POST',
    body: { name: projectName, path: dir }
  });
  if (!response.ok || !response.body || !response.body.success) {
    throw new Error(`Could not create temporary file project: ${response.status}`);
  }
  state.createdProjects.add(projectName);
  return { dir, fileName, projectName };
}

async function mobileFilesFlow(browser, state) {
  const fixture = await setupFileFixture(state);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'local-mobile-files-390');
  await page.addInitScript((projectPath) => {
    localStorage.setItem('aab.selectedProjectPath', projectPath);
  }, fixture.dir);
  await openApp(page, BASE_URL);
  await page.waitForFunction(projectPath => {
    const sel = document.querySelector('#projectSel');
    return sel && Array.from(sel.options).some(option => option.value === projectPath);
  }, fixture.dir, { timeout: 15000 });
  await page.selectOption('#projectSel', fixture.dir);

  await page.click('#filesBtn');
  await page.waitForSelector('#fileExp.open', { timeout: 15000 });
  await waitFor(page, projectPath => {
    const crumb = document.querySelector('#fxCrumb');
    return crumb && crumb.textContent.includes(projectPath);
  }, fixture.dir, 'temporary project files root');

  await page.locator('#fxTree .fx-row').filter({ hasText: fixture.fileName }).first().click({ position: { x: 30, y: 20 } });
  await waitFor(page, fileName => {
    const name = document.querySelector('#fxFname');
    return name && name.textContent.includes(fileName);
  }, fixture.fileName, 'fixture markdown open');

  await page.click('#fxModes button[data-mode="preview"]');
  await waitFor(page, () => {
    const preview = document.querySelector('#fxPrev');
    return preview && getComputedStyle(preview).display !== 'none' && preview.innerText.includes('Round 24 Mobile File UX');
  }, null, 'mobile markdown preview');
  await page.screenshot({ path: path.join(OUT_DIR, 'local-mobile-files-preview.png'), fullPage: true });

  const fileState = await page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const rectOf = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) };
    };
    const editbarButtons = Array.from(document.querySelectorAll('#fxEditbar button'))
      .filter(visible)
      .map(button => {
        const rect = button.getBoundingClientRect();
        return {
          text: (button.textContent || button.getAttribute('aria-label') || '').trim(),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        };
      });
    const preview = document.querySelector('#fxPrev');
    const tree = document.querySelector('#fxTree');
    const textarea = document.querySelector('#fxTa');
    const fileExp = document.querySelector('#fileExp');
    return {
      open: !!document.querySelector('#fileExp.open'),
      fileName: document.querySelector('#fxFname')?.textContent || '',
      previewText: preview ? preview.innerText : '',
      previewVisible: visible(preview),
      textareaVisible: visible(textarea),
      treeVisible: visible(tree),
      previewMode: !!(fileExp && fileExp.classList.contains('fx-preview-mode')),
      previewRect: rectOf(preview),
      treeRect: rectOf(tree),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scriptExecuted: window.__aabUxFinalXss === 1,
      previewContainsScriptTag: !!(preview && preview.querySelector('script')),
      editbarButtons,
      editbarTouchSafe: editbarButtons.every(button => button.w >= 44 && button.h >= 44)
    };
  });

  await context.close();
  return { initialSession: tracker.sessionIds[0] || null, tracker, fixture: { dir: fixture.dir, fileName: fixture.fileName }, fileState };
}

async function funnelMobileFlow(browser, state) {
  if (SKIP_FUNNEL) return { skipped: true };
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const tracker = attachPageWatchers(page, state, 'funnel-mobile-390');
  await openApp(page, FUNNEL_URL);
  const initial = await stateSnapshot(page);
  await page.click('#starterPanel button[data-starter-cmd="pwd"]');
  await waitFor(page, () => document.body.innerText.includes('/Users/'), null, 'funnel pwd output', 20000);
  const afterFirstCommand = await stateSnapshot(page);
  await page.screenshot({ path: path.join(OUT_DIR, 'funnel-mobile-390.png'), fullPage: true });
  await context.close();
  return { initialSession: tracker.sessionIds[0] || null, tracker, initial, afterFirstCommand };
}

async function landingAudit(browser, state) {
  if (SKIP_LANDING) return { skipped: true };
  const viewports = [
    { name: 'landing-1440', width: 1440, height: 900 },
    { name: 'landing-390', width: 390, height: 844, isMobile: true },
    { name: 'landing-320', width: 320, height: 720, isMobile: true }
  ];
  const results = [];
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.isMobile
    });
    const page = await context.newPage();
    attachPageWatchers(page, state, vp.name);
    await page.goto(LANDING_URL, { waitUntil: 'networkidle', timeout: 45000 });
    const result = await page.evaluate(() => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const controls = Array.from(document.querySelectorAll('a.btn, .nav-cta, button')).filter(visible).map(el => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        };
      });
      const images = Array.from(document.images).map(img => ({
        src: img.currentSrc || img.src,
        complete: img.complete,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      }));
      const body = document.body.innerText;
      return {
        title: document.title,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        images,
        controls,
        touchSafe: controls.every(control => control.h >= 40 && control.w >= 40),
        markers: {
          starter: /starter/i.test(body),
          quiet: /Quiet/.test(body),
          launchAssist: /launch assist/i.test(body),
          node18: /Node\s*18\+/i.test(body)
        }
      };
    });
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}.png`), fullPage: true });
    await context.close();
    results.push({ viewport: vp, ...result });
  }
  return { results };
}

async function pwaEndpoints() {
  const paths = [
    '/manifest.webmanifest',
    '/sw.js',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-maskable-512.png'
  ];
  const results = [];
  for (const pathname of paths) {
    const response = await fetchWithTimeout(new URL(pathname, BASE_URL).toString(), {}, 15000);
    const bytes = Buffer.from(await response.arrayBuffer()).length;
    results.push({
      path: pathname,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get('content-type'),
      bytes
    });
  }
  const manifestResponse = await fetchWithTimeout(new URL('/manifest.webmanifest', BASE_URL).toString(), {}, 15000);
  const manifest = await manifestResponse.json();
  return {
    results,
    manifestName: manifest.name,
    display: manifest.display,
    startUrl: manifest.start_url,
    iconCount: Array.isArray(manifest.icons) ? manifest.icons.length : 0
  };
}

async function cleanupSessions(ids, beforeCount) {
  const deleteResults = [];
  for (const id of Array.from(ids).sort((a, b) => a - b)) {
    const response = await apiJson(BASE_URL, `/api/sessions/${id}`, { method: 'DELETE' });
    deleteResults.push({ id, status: response.status, ok: response.ok });
  }
  const after = await listSessions();
  return {
    beforeCount,
    created: Array.from(ids).sort((a, b) => a - b),
    deleteResults,
    afterCount: after.length,
    afterTail: after.slice(-5).map(item => item.sessionId)
  };
}

async function cleanupArtifacts(state) {
  const projectResults = [];
  for (const name of Array.from(state.createdProjects)) {
    const response = await apiJson(BASE_URL, `/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
    projectResults.push({ name, status: response.status, ok: response.ok });
  }
  const fixtureResults = [];
  for (const dir of Array.from(state.fixtureDirs)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      fixtureResults.push({ dir, ok: true });
    } catch (err) {
      fixtureResults.push({ dir, ok: false, error: compactMessage(err.message || err) });
    }
  }
  return {
    projects: projectResults,
    fixtures: fixtureResults,
    ok: projectResults.every(item => item.ok) && fixtureResults.every(item => item.ok)
  };
}

function buildChecks(report) {
  const desktop = report.flows.localDesktop;
  const mobile = report.flows.localMobile320;
  const multi = report.flows.localMultiViewer;
  const closeCurrent = report.flows.localCloseCurrent;
  const landscape = report.flows.localMobileLandscape844;
  const keyboard = report.flows.localMobileKeyboard390;
  const notifications = report.flows.localMobileNotifications390;
  const files = report.flows.mobileFiles390;
  const funnel = report.flows.funnelMobile390;
  const landing = report.landingProduction;
  const pwa = report.pwa;

  const modalValues = Object.values(desktop.modals || {});
  return {
    localDesktop: {
      newSession: !!desktop.initialSession,
      starterOpen: !!desktop.initial.starterOpen,
      noOverflow: !desktop.initial.overflowX && !desktop.reconnected.overflowX,
      sendToAgent: hasSent(desktop.tracker, 'sendToAgent', item => item.text === 'echo FINAL_DESKTOP'),
      outputSeen: desktop.reconnected.bodyHasFinalDesktop || hasReceived(desktop.tracker, 'output', item => /FINAL_DESKTOP/.test(item.sample || '')),
      imageAttached: /uploads\/.*pixel\.png/.test(desktop.offline.composeValue || desktop.reconnected.composeValue || ''),
      escInput: hasSent(desktop.tracker, 'input', item => item.data === '\x1b'),
      sessionSwitch: !!(desktop.sessionSwitch &&
        desktop.sessionSwitch.firstSession &&
        desktop.sessionSwitch.secondSession &&
        desktop.sessionSwitch.createdDifferent &&
        desktop.sessionSwitch.secondCommandVisible &&
        desktop.sessionSwitch.switchBackReady &&
        desktop.sessionSwitch.originalOutputRestored &&
        hasSent(desktop.tracker, 'sendToAgent', item => item.text === 'echo FINAL_SWITCH_SECOND')),
      draftIsolation: !!(desktop.sessionSwitch &&
        desktop.sessionSwitch.firstDraftContainsUpload &&
        desktop.sessionSwitch.secondStartedClean &&
        desktop.sessionSwitch.firstDraftRestored &&
        desktop.sessionSwitch.secondDraftRestored &&
        desktop.sessionSwitch.secondDraftIsolated),
      modalsAccessible: modalValues.length === 6 && modalValues.every(item =>
        item.opened.open &&
        item.opened.role === 'dialog' &&
        item.opened.modal === 'true' &&
        item.opened.labelledBy &&
        item.opened.focusInside &&
        item.closed.restoredTo === item.closed.expected
      ),
      reconnect: desktop.offline.status.includes('offline') && desktop.reconnected.status.includes('connected'),
      scrollPositionPreserved: desktop.scrollBeforeReconnect.available &&
        desktop.scrollAfterReconnect.available &&
        desktop.scrollBeforeReconnect.scrollHeight > desktop.scrollBeforeReconnect.clientHeight &&
        desktop.scrollBeforeReconnect.scrollTop > 0 &&
        Math.abs(desktop.scrollAfterReconnect.scrollTop - desktop.scrollBeforeReconnect.scrollTop) <= 30 &&
        desktop.scrollAfterReconnect.topRows[0] === desktop.scrollBeforeReconnect.topRows[0],
      reloadSameSession: desktop.reloadReady &&
        String(desktop.reloadReady.sessionId) === String(desktop.initialSession) &&
        desktop.reloadReady.isReconnect === true,
      reloadScrollPositionPreserved: desktop.scrollBeforeReload.available &&
        desktop.scrollAfterReload.available &&
        desktop.scrollBeforeReload.scrollTop > 0 &&
        Math.abs(desktop.scrollAfterReload.scrollTop - desktop.scrollBeforeReload.scrollTop) <= 30 &&
        desktop.scrollAfterReload.topRows[0] === desktop.scrollBeforeReload.topRows[0] &&
        !desktop.afterReload.overflowX
    },
    localMobile320: {
      newSession: !!mobile.initialSession,
      starterOpen: !!mobile.initial.starterOpen,
      starterTouch: mobile.initial.starterButtonsSafe44,
      oneTapFirstCommand: hasSent(mobile.tracker, 'sendToAgent', item => item.text === 'pwd') && mobile.afterFirstCommand.bodyHasHome,
      noOverflow: !mobile.initial.overflowX && !mobile.afterFirstCommand.overflowX && !mobile.launchAssist.overflowX,
      toolbarTouch: mobile.initial.toolbarTouchSafe44,
      launchAssist: !!mobile.launchAssist.agentAssist && mobile.launchAssist.agentButtonsSafe44,
      startAndKeys: hasSent(mobile.tracker, 'startAgent') &&
        hasSent(mobile.tracker, 'input', item => item.data === '\x1b') &&
        hasSent(mobile.tracker, 'input', item => item.data === '\x03')
    },
    localMultiViewer: {
      sameSession: !!multi.firstSession && String(multi.firstSession) === String(multi.secondSession),
      secondaryReconnect: multi.secondaryReconnect,
      secondaryUrlCleaned: multi.secondaryUrlCleaned,
      secondaryNoStarter: !multi.secondaryInitial.starterOpen,
      secondarySendToAgent: hasSent(multi.trackerB, 'sendToAgent', item => item.text === 'echo FINAL_MULTIVIEW'),
      primarySawOutput: multi.primaryAfter.bodyHasFinalMultiview ||
        hasReceived(multi.trackerA, 'output', item => /FINAL_MULTIVIEW/.test(item.sample || '')),
      secondarySawOutput: multi.secondaryAfter.bodyHasFinalMultiview ||
        hasReceived(multi.trackerB, 'output', item => /FINAL_MULTIVIEW/.test(item.sample || '')),
      noOverflow: !multi.primaryInitial.overflowX && !multi.secondaryInitial.overflowX &&
        !multi.primaryAfter.overflowX && !multi.secondaryAfter.overflowX
    },
    localCloseCurrent: {
      replacementSession: !!closeCurrent.firstSession && !!closeCurrent.secondSession &&
        String(closeCurrent.firstSession) !== String(closeCurrent.secondSession) &&
        closeCurrent.replacementReady && closeCurrent.replacementReady.isReconnect === false,
      draftSeeded: closeCurrent.before.compose === 'CLOSE_CURRENT_DRAFT' &&
        closeCurrent.before.oldDraft === 'CLOSE_CURRENT_DRAFT' &&
        !!closeCurrent.before.oldScroll,
      composeCleared: closeCurrent.after.compose === '',
      oldStatePurged: !closeCurrent.after.oldDraft && !closeCurrent.after.oldScroll,
      replacementStateClean: !closeCurrent.after.newDraft && !closeCurrent.after.newScroll,
      starterOpen: !!closeCurrent.snapshot.starterOpen,
      noOverflow: !closeCurrent.snapshot.overflowX
    },
    localMobileLandscape844: {
      newSession: !!landscape.initialSession,
      starterOpen: !!landscape.initial.starterOpen,
      starterTouch: landscape.initial.starterButtonsSafe44,
      oneTapFirstCommand: hasSent(landscape.tracker, 'sendToAgent', item => item.text === 'pwd') && landscape.afterFirstCommand.bodyHasHome,
      noOverflow: !landscape.initial.overflowX && !landscape.afterFirstCommand.overflowX,
      toolbarTouch: landscape.initial.toolbarTouchSafe44,
      terminalUsable: landscape.initial.termwrapRect && landscape.initial.termwrapRect.h >= 96
    },
    localMobileKeyboard390: {
      newSession: !!keyboard.initialSession,
      focusedBeforeShrink: keyboard.beforeShrink.activeId === 'composeInput',
      viewportShrank: keyboard.beforeShrink.viewport.height > keyboard.afterShrink.viewport.height,
      composeVisible: keyboard.afterShrink.inputVisible && keyboard.afterShrink.inputWithinViewport,
      sendVisible: keyboard.afterShrink.sendVisible && keyboard.afterShrink.sendWithinViewport,
      controlsTouch: keyboard.afterShrink.controlsTouchSafe44,
      noOverflow: !keyboard.beforeShrink.overflowX && !keyboard.afterShrink.overflowX && !keyboard.afterSend.overflowX,
      terminalUsable: keyboard.afterShrink.termwrapRect && keyboard.afterShrink.termwrapRect.h >= 160,
      sendToAgent: hasSent(keyboard.tracker, 'sendToAgent', item => item.text === 'echo KEYBOARD_PROBE'),
      outputSeen: keyboard.afterSend.bodyHasKeyboardProbe || hasReceived(keyboard.tracker, 'output', item => /KEYBOARD_PROBE/.test(item.sample || ''))
    },
    localMobileNotifications390: {
      newSession: !!notifications.initialSession,
      modalOpen: notifications.initial.open && notifications.quiet.open && notifications.important.open,
      quietSelected: notifications.quiet.activeMode === 'quiet' && /question/i.test(notifications.quiet.summary),
      quietPersists: notifications.quietReopen.activeMode === 'quiet' && /question/i.test(notifications.quietReopen.summary),
      importantSelected: notifications.important.activeMode === 'important' && /done/i.test(notifications.important.summary),
      importantPersists: notifications.importantReopen.activeMode === 'important' && /done/i.test(notifications.importantReopen.summary),
      singleActiveMode: notifications.quiet.singleActiveMode && notifications.quietReopen.singleActiveMode &&
        notifications.important.singleActiveMode && notifications.importantReopen.singleActiveMode,
      touchSafe: notifications.quiet.modesTouchSafe44 && notifications.important.modesTouchSafe44,
      noOverflow: !notifications.initial.overflowX && !notifications.quiet.overflowX && !notifications.importantReopen.overflowX
    },
    mobileFiles390: {
      newSession: !!files.initialSession,
      openedFixture: files.fileState.open && files.fileState.fileName.includes(files.fixture.fileName),
      previewVisible: files.fileState.previewVisible && files.fileState.previewText.includes('Round 24 Mobile File UX'),
      previewMode: files.fileState.previewMode && !files.fileState.textareaVisible,
      noOverflow: !files.fileState.overflowX,
      touchSafe: files.fileState.editbarTouchSafe,
      sanitized: !files.fileState.scriptExecuted && !files.fileState.previewContainsScriptTag
    },
    funnelMobile390: funnel.skipped ? { skipped: true } : {
      reachable: !!funnel.initialSession,
      newSession: !!funnel.initialSession,
      starterOpen: !!funnel.initial.starterOpen,
      starterTouch: funnel.initial.starterButtonsSafe44,
      firstCommand: hasSent(funnel.tracker, 'sendToAgent', item => item.text === 'pwd') && funnel.afterFirstCommand.bodyHasHome,
      noOverflow: !funnel.initial.overflowX && !funnel.afterFirstCommand.overflowX,
      toolbarTouch: funnel.initial.toolbarTouchSafe44
    },
    landingProduction: landing.skipped ? { skipped: true } : {
      allPassed: landing.results.every(result =>
        !result.overflowX &&
        result.images.every(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) &&
        result.touchSafe &&
        Object.values(result.markers).every(Boolean)
      )
    },
    pwa: {
      endpointsOk: pwa.results.every(item => item.ok),
      manifestOk: pwa.manifestName === 'AnyAgent Bridge' && pwa.display === 'standalone' && pwa.iconCount >= 4
    }
  };
}

function flattenChecks(checks, prefix = '') {
  const failures = [];
  for (const [key, value] of Object.entries(checks)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.skipped) continue;
      failures.push(...flattenChecks(value, label));
    } else if (!value) {
      failures.push(label);
    }
  }
  return failures;
}

async function main() {
  const health = await fetchWithTimeout(new URL('/health', BASE_URL).toString(), {}, 15000);
  if (!health.ok) throw new Error(`Local bridge health returned ${health.status}`);

  const beforeSessions = await listSessions();
  const state = createRunState();
  const report = {
    generatedAt: new Date().toISOString(),
    bases: {
      local: cleanUrl(BASE_URL),
      funnel: SKIP_FUNNEL ? null : cleanUrl(FUNNEL_URL),
      landing: SKIP_LANDING ? null : cleanUrl(LANDING_URL)
    },
    pageErrors: state.pageErrors,
    consoleErrors: state.consoleErrors,
    dialogs: state.dialogs,
    requestFailures: state.requestFailures,
    flows: {},
    landingProduction: null,
    pwa: null,
    cleanup: null,
    artifactCleanup: null,
    checks: null,
    failures: [],
    pass: false
  };

  let browser = null;
  let runError = null;
  try {
    browser = await chromium.launch();
    report.flows.localDesktop = await localDesktopFlow(browser, state);
    report.flows.localMobile320 = await localMobileFlow(browser, state);
    report.flows.localMultiViewer = await localMultiViewerFlow(browser, state);
    report.flows.localCloseCurrent = await localCloseCurrentFlow(browser, state);
    report.flows.localMobileLandscape844 = await localMobileLandscapeFlow(browser, state);
    report.flows.localMobileKeyboard390 = await localMobileKeyboardFlow(browser, state);
    report.flows.localMobileNotifications390 = await localMobileNotificationsFlow(browser, state);
    report.flows.mobileFiles390 = await mobileFilesFlow(browser, state);
    report.flows.funnelMobile390 = await funnelMobileFlow(browser, state);
    report.landingProduction = await landingAudit(browser, state);
    report.pwa = await pwaEndpoints();
  } catch (err) {
    runError = err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  try {
    report.cleanup = await cleanupSessions(state.createdSessions, beforeSessions.length);
  } catch (err) {
    report.cleanup = { beforeCount: beforeSessions.length, created: Array.from(state.createdSessions), error: compactMessage(err.message || err) };
  }

  try {
    report.artifactCleanup = await cleanupArtifacts(state);
  } catch (err) {
    report.artifactCleanup = { ok: false, error: compactMessage(err.message || err) };
  }

  const haveRequiredReports = report.flows.localDesktop && report.flows.localMobile320 && report.flows.localMultiViewer && report.flows.localCloseCurrent && report.flows.localMobileLandscape844 && report.flows.localMobileKeyboard390 && report.flows.localMobileNotifications390 && report.flows.mobileFiles390 && report.flows.funnelMobile390 && report.landingProduction && report.pwa;
  report.checks = haveRequiredReports ? buildChecks(report) : {};
  report.failures = [
    ...(runError ? [`runner error: ${compactMessage(runError.message || runError)}`] : []),
    ...flattenChecks(report.checks),
    ...state.pageErrors.map(item => `page error: ${item.page}: ${item.message}`),
    ...state.consoleErrors.map(item => `console error: ${item.page}: ${item.text}`),
    ...state.dialogs.map(item => `native dialog: ${item.page}: ${item.message}`),
    ...state.requestFailures.map(item => `request failed: ${item.page}: ${item.url}: ${item.error}`)
  ];
  if (report.cleanup.error) {
    report.failures.push(`cleanup error: ${report.cleanup.error}`);
  } else if (report.cleanup.afterCount !== report.cleanup.beforeCount) {
    report.failures.push(`session count changed from ${report.cleanup.beforeCount} to ${report.cleanup.afterCount}`);
  }
  if (report.cleanup.deleteResults && report.cleanup.deleteResults.some(item => !item.ok)) {
    report.failures.push('temporary session cleanup failed');
  }
  if (report.artifactCleanup && report.artifactCleanup.ok === false) {
    report.failures.push('temporary file/project cleanup failed');
  }
  report.pass = report.failures.length === 0;

  const reportPath = writeJson('final-ux-acceptance-report.json', report);
  const summary = {
    generatedAt: report.generatedAt,
    report: reportPath,
    checks: report.checks,
    cleanup: report.cleanup,
    artifactCleanup: report.artifactCleanup,
    failures: report.failures,
    pass: report.pass
  };
  writeJson('final-ux-acceptance-summary.json', summary);

  if (!report.pass) {
    console.error(`Final UX acceptance failed. Report: ${reportPath}`);
    for (const failure of report.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`Final UX acceptance passed. Report: ${reportPath}`);
}

main().catch(err => {
  console.error(compactMessage(err.stack || err.message || err));
  process.exit(1);
});
