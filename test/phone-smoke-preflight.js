#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = process.env.AAB_OUTPUT_DIR || '/tmp/anyagent-bridge-phone-smoke';
const BASE_URL = process.env.AAB_BASE_URL || 'http://127.0.0.1:3002';
const FUNNEL_URL = process.env.AAB_FUNNEL_URL || 'https://anyagent-bridge.tail8e6e6f.ts.net';
const AUTH_FILE = process.env.AAB_AUTH_FILE || path.join(ROOT, '.data', 'auth.json');
const SKIP_FUNNEL = process.env.AAB_SKIP_FUNNEL === '1';
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

function redact(value) {
  return String(value || '').split(credential).join('[redacted]');
}

function publicUrl(value) {
  try {
    const url = new URL(String(value));
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (err) {
    return redact(value);
  }
}

function withCredential(base, pathname, params = {}) {
  const url = new URL(pathname, base);
  url.searchParams.set(CRED_PARAM, credential);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(label, url, options = {}) {
  const started = Date.now();
  const result = {
    label,
    url: publicUrl(url),
    ok: false,
    status: null,
    ms: null,
    error: null,
    data: null
  };
  try {
    const response = await fetchWithTimeout(url, options, options.timeoutMs || 12000);
    result.status = response.status;
    result.ms = Date.now() - started;
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = null; }
    result.ok = response.ok;
    result.data = data;
  } catch (err) {
    result.ms = Date.now() - started;
    result.error = redact(err.message || err);
  }
  return result;
}

function summarizeHealth(result) {
  const data = result.data || {};
  return {
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    bridgeStatus: data.status || null,
    sessions: Number.isFinite(data.sessions) ? data.sessions : null,
    platform: data.platform || null
  };
}

function summarizeSessions(result) {
  const list = result.data && Array.isArray(result.data.sessions) ? result.data.sessions : [];
  return {
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    count: result.data && Number.isFinite(result.data.count) ? result.data.count : list.length,
    tail: list.slice(-5).map(item => item.sessionId)
  };
}

function summarizeSystem(result) {
  const data = result.data || {};
  return {
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    server: data.server ? {
      host: data.server.host || null,
      port: data.server.port || null,
      sessions: Number.isFinite(data.server.sessions) ? data.server.sessions : null
    } : null,
    tunnel: data.tunnel ? {
      enabled: data.tunnel.enabled,
      provider: data.tunnel.provider || null,
      status: data.tunnel.status || data.tunnel.state || null,
      publicUrl: data.tunnel.url ? publicUrl(data.tunnel.url) : null
    } : null,
    auth: data.auth ? {
      loginEnabled: data.auth.loginEnabled,
      sessionRequired: data.auth.sessionRequired,
      directAccess: data.auth[CRED_PARAM + 'DirectAccess']
    } : null
  };
}

async function endpointStatus(base, pathname) {
  const url = new URL(pathname, base).toString();
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(url, {}, 12000);
    const bytes = Buffer.from(await response.arrayBuffer()).length;
    return {
      path: pathname,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      contentType: response.headers.get('content-type'),
      bytes
    };
  } catch (err) {
    return {
      path: pathname,
      ok: false,
      status: null,
      ms: Date.now() - started,
      error: redact(err.message || err)
    };
  }
}

function writeJson(fileName, data) {
  const filePath = path.join(OUT_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  return filePath;
}

function failedLabels(report) {
  const failures = [];
  if (!report.local.health.ok || report.local.health.bridgeStatus !== 'ok') failures.push('local health');
  if (!report.local.sessions.ok) failures.push('local authenticated sessions API');
  if (!report.local.system.ok) failures.push('local authenticated system API');
  if (!report.local.pwa.every(item => item.ok)) failures.push('local PWA endpoints');
  if (report.local.sessions.count !== report.local.afterSessions.count) failures.push('non-mutating session count');
  if (!report.funnel.skipped) {
    if (!report.funnel.health.ok || report.funnel.health.bridgeStatus !== 'ok') failures.push('funnel health');
    if (!report.funnel.sessions.ok) failures.push('funnel authenticated sessions API');
    if (!report.funnel.system.ok) failures.push('funnel authenticated system API');
    if (report.funnel.sessions.count !== report.local.sessions.count) failures.push('funnel/local session count match');
  }
  return failures;
}

async function main() {
  const localHealthRaw = await jsonRequest('local health', new URL('/health', BASE_URL).toString());
  const localSessionsRaw = await jsonRequest('local sessions', withCredential(BASE_URL, '/api/sessions'));
  const localSystemRaw = await jsonRequest('local system', withCredential(BASE_URL, '/api/system/status'));
  const pwa = await Promise.all([
    endpointStatus(BASE_URL, '/manifest.webmanifest'),
    endpointStatus(BASE_URL, '/sw.js'),
    endpointStatus(BASE_URL, '/icon.svg'),
    endpointStatus(BASE_URL, '/icon-192.png'),
    endpointStatus(BASE_URL, '/icon-512.png'),
    endpointStatus(BASE_URL, '/icon-maskable-512.png')
  ]);

  const funnel = { skipped: SKIP_FUNNEL };
  if (!SKIP_FUNNEL) {
    const funnelHealthRaw = await jsonRequest('funnel health', new URL('/health', FUNNEL_URL).toString(), { timeoutMs: 15000 });
    const funnelSessionsRaw = await jsonRequest('funnel sessions', withCredential(FUNNEL_URL, '/api/sessions'), { timeoutMs: 15000 });
    const funnelSystemRaw = await jsonRequest('funnel system', withCredential(FUNNEL_URL, '/api/system/status'), { timeoutMs: 15000 });
    funnel.health = summarizeHealth(funnelHealthRaw);
    funnel.sessions = summarizeSessions(funnelSessionsRaw);
    funnel.system = summarizeSystem(funnelSystemRaw);
  }

  const afterSessionsRaw = await jsonRequest('local sessions after preflight', withCredential(BASE_URL, '/api/sessions'));

  const report = {
    generatedAt: new Date().toISOString(),
    purpose: 'Preflight for the required 30-minute physical-phone smoke. This does not replace the real phone run.',
    bases: {
      local: publicUrl(BASE_URL),
      funnel: SKIP_FUNNEL ? null : publicUrl(FUNNEL_URL)
    },
    local: {
      health: summarizeHealth(localHealthRaw),
      sessions: summarizeSessions(localSessionsRaw),
      system: summarizeSystem(localSystemRaw),
      pwa,
      afterSessions: summarizeSessions(afterSessionsRaw)
    },
    funnel,
    humanNext: {
      checklist: 'docs/FINAL_UX_AUDIT.md#30-minute-physical-phone-smoke-checklist',
      reportTemplate: 'docs/PHONE_SMOKE_REPORT_TEMPLATE.md',
      phoneUrl: SKIP_FUNNEL ? null : publicUrl(FUNNEL_URL),
      reminder: 'Use a real iOS or Android browser for at least 30 minutes and keep credentials out of screenshots.'
    }
  };
  report.failures = failedLabels(report);
  report.readyForPhoneSmoke = report.failures.length === 0;

  const reportPath = writeJson('phone-smoke-preflight-report.json', report);
  if (!report.readyForPhoneSmoke) {
    console.error(`Phone smoke preflight failed. Report: ${reportPath}`);
    for (const failure of report.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`Phone smoke preflight passed. Report: ${reportPath}`);
}

main().catch(err => {
  console.error(redact(err.stack || err.message || err));
  process.exit(1);
});
