#!/usr/bin/env node
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const envCandidates = [
  process.env.SMOKE_ENV_FILE,
  '../../.env.staging',
  '../../.env.production',
  '.env',
].filter(Boolean);

for (const file of envCandidates) {
  if (existsSync(file)) {
    dotenv.config({ path: file, override: false });
  }
}

const apiBaseUrl = (process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ss-erp.com').replace(/\/+$/, '');
const marketingBaseUrl = (process.env.SMOKE_MARKETING_BASE_URL || 'https://ss-erp.com').replace(/\/+$/, '');
const userWebBaseUrl = (process.env.SMOKE_WEB_BASE_URL || process.env.NEXT_PUBLIC_WEB_BASE_URL || 'https://app.ss-erp.com').replace(/\/+$/, '');
const adminWebBaseUrl = (process.env.SMOKE_ADMIN_WEB_BASE_URL || 'https://admin.ss-erp.com').replace(/\/+$/, '');
const expectRuntime = process.env.SMOKE_EXPECT_RUNTIME || 'cloud';
const expectWebNoLocalFallback = process.env.SMOKE_EXPECT_WEB_NO_LOCAL_FALLBACK !== undefined
  ? process.env.SMOKE_EXPECT_WEB_NO_LOCAL_FALLBACK === 'true'
  : true;
const expectOss = process.env.SMOKE_EXPECT_OSS === 'true';
const expectBackupStatus = process.env.SMOKE_EXPECT_BACKUP_STATUS === 'true';
const expectAuthChallenges = process.env.SMOKE_EXPECT_AUTH_CHALLENGES === 'true';
let adminToken = process.env.SMOKE_ADMIN_TOKEN || '';
let adminCookie = process.env.SMOKE_ADMIN_COOKIE || '';
const adminPhone = process.env.SMOKE_ADMIN_PHONE || '';
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || '';
const userPhone = process.env.SMOKE_USER_PHONE || '';
const userPassword = process.env.SMOKE_USER_PASSWORD || '';
const expectUpload = process.env.SMOKE_EXPECT_UPLOAD === 'true' || expectOss;
const smokeDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const createTempUser = process.env.SMOKE_CREATE_TEMP_USER === 'true';
const tempSuffix = smokeDate.slice(-8);
const tempPhone = `188${tempSuffix}`;
const tempPassword = `Smoke${tempSuffix}Aa1`;
let userToken = process.env.SMOKE_USER_TOKEN || '';
let userCookie = process.env.SMOKE_USER_COOKIE || '';
let tempUserMode = 'none';

const checks = [];

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, body, text, headers: response.headers };
}

function authHeaders(extra = {}) {
  return {
    ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
    ...(adminCookie ? { cookie: adminCookie } : {}),
    ...extra,
  };
}

function userAuthHeaders(extra = {}) {
  return {
    ...(userToken ? { authorization: `Bearer ${userToken}` } : {}),
    ...(userCookie ? { cookie: userCookie } : {}),
    ...extra,
  };
}

async function resolveAdminCredentials() {
  if (adminToken || adminCookie) return;
  if (!adminPhone || !adminPassword) return;

  const login = await request(`${apiBaseUrl}/api/admin/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: adminPhone, password: adminPassword }),
  });
  if (login.status !== 200 || login.body?.code !== 1 || !login.body?.data?.token) {
    throw new Error(`admin login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }

  const setCookie = login.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  if (cookie) {
    adminCookie = cookie;
  }
  adminToken = login.body.data.token;
}

async function resolveUserCredentials() {
  if (userToken || userCookie) return;

  if (userPhone && userPassword) {
    const login = await request(`${apiBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: userPhone, password: userPassword }),
    });
    if (login.status !== 200 || login.body?.code !== 1) {
      throw new Error(`user login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }
    const setCookie = login.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0];
    if (cookie) userCookie = cookie;
    userToken = login.body?.data?.token || '';
    tempUserMode = 'provided';
    return;
  }

  if (!createTempUser) return;

  const loginFirst = await request(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: tempPhone, password: tempPassword }),
  });
  if (loginFirst.status === 200 && loginFirst.body?.code === 1) {
    userToken = loginFirst.body?.data?.token || '';
    const loginCookie = (loginFirst.headers.get('set-cookie') || '').split(';')[0];
    if (loginCookie) userCookie = loginCookie;
    tempUserMode = 'reused';
    return;
  }

  if (loginFirst.status !== 401 && loginFirst.status !== 403) {
    throw new Error(`temp user pre-login failed: ${loginFirst.status} ${JSON.stringify(loginFirst.body)}`);
  }

  const register = await request(`${apiBaseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: tempPhone, password: tempPassword, nickname: 'Remote Smoke User' }),
  });
  if (register.status !== 201 || register.body?.code !== 1) {
    throw new Error(`temp user register failed: ${register.status} ${JSON.stringify(register.body)}`);
  }
  const setCookie = register.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0];
  if (cookie) userCookie = cookie;
  tempUserMode = 'created';

  const login = await request(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: tempPhone, password: tempPassword }),
  });
  if (login.status === 200 && login.body?.code === 1) {
    userToken = login.body?.data?.token || '';
    const loginCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    if (loginCookie) userCookie = loginCookie;
  }
}

function push(name, fn) {
  checks.push({ name, fn });
}

push('ready endpoint reports healthy', async () => {
  const out = await request(`${apiBaseUrl}/ready`);
  if (out.status !== 200 || out.body?.status !== 'ready' || out.body?.checks?.db !== 'ok' || out.body?.checks?.redis !== 'ok') {
    throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
  }
  return out.body.checks;
});

push('setup status reports initialized', async () => {
  const out = await request(`${apiBaseUrl}/api/setup/status`);
  if (out.status !== 200 || out.body?.code !== 1 || out.body?.data?.needsSetup !== false || out.body?.data?.hasAdmin !== true) {
    throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
  }
  return out.body.data;
});

push('public pages render', async () => {
  const pages = [
    { label: 'marketing /', url: `${marketingBaseUrl}/` },
    { label: 'user /', url: `${userWebBaseUrl}/` },
    { label: 'user /login', url: `${userWebBaseUrl}/login` },
    { label: 'user /register', url: `${userWebBaseUrl}/register` },
    { label: 'user /setup', url: `${userWebBaseUrl}/setup` },
    { label: 'admin /', url: `${adminWebBaseUrl}/` },
    { label: 'admin /admin/login', url: `${adminWebBaseUrl}/admin/login` },
  ];
  const result = {};
  for (const page of pages) {
    const out = await request(page.url, {
      headers: { accept: 'text/html' },
      redirect: 'manual',
    });
    result[page.label] = out.status;
    if (out.status !== 200 && out.status !== 307 && out.status !== 308) {
      throw new Error(`${page.label} returned ${out.status}`);
    }
  }
  return result;
});

push('next chunks do not hardcode localhost for cloud', async () => {
  const pages = [
    `${userWebBaseUrl}/login`,
    `${adminWebBaseUrl}/admin/login`,
    `${userWebBaseUrl}/setup`,
  ];
  const seen = new Set();
  const bad = [];
  for (const pageUrl of pages) {
    const page = new URL(pageUrl);
    const out = await request(pageUrl, { headers: { accept: 'text/html' } });
    const html = String(out.text || '');
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((src) => src.includes('/_next/'));
    for (const src of scripts) {
      const url = src.startsWith('http') ? src : `${page.origin}${src}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const res = await request(url);
      const js = String(res.text || '');
      const hasLocal = js.includes('http://localhost:3001');
      const hasBase = js.includes(apiBaseUrl);
      if (hasLocal && !hasBase) bad.push(url);
    }
  }
  if (expectWebNoLocalFallback && bad.length) {
    throw new Error(`bad chunks: ${bad.join(', ')}`);
  }
  return { checkedChunks: seen.size, localFallbackChunks: bad.length };
});

push('auth endpoints reject unauthenticated login attempts', async () => {
  const login = await request(`${apiBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '19900000000', password: 'bad-password' }),
  });
  const sms = await request(`${apiBaseUrl}/api/auth/sms-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone: '19900000001' }),
  });
  if (expectAuthChallenges) {
    if (login.status !== 403) throw new Error(`login without turnstile returned ${login.status}: ${JSON.stringify(login.body)}`);
    if (sms.status !== 403) throw new Error(`sms without turnstile returned ${sms.status}: ${JSON.stringify(sms.body)}`);
  }
  return { loginStatus: login.status, smsStatus: sms.status };
});

push('admin endpoints require auth', async () => {
  const integrations = await request(`${apiBaseUrl}/api/admin/system-status/integrations`);
  const backup = await request(`${apiBaseUrl}/api/admin/ops/backup-status`);
  const extension = await request(`${apiBaseUrl}/api/extension/runtime`);
  if (![401, 403].includes(integrations.status) || ![401, 403].includes(backup.status) || extension.status !== 401) {
    throw new Error(`unexpected auth behavior: ${integrations.status}, ${backup.status}, ${extension.status}`);
  }
  return { integrations: integrations.status, backup: backup.status, extension: extension.status };
});

push('admin auth can inspect integrations and backup status', async () => {
  if (!adminToken && !adminCookie) {
    return { skipped: 'no admin credentials provided' };
  }

  const me = await request(`${apiBaseUrl}/api/admin/auth/me`, { headers: authHeaders() });
  if (me.status !== 200 || me.body?.code !== 1 || me.body?.data?.role !== 'ADMIN') {
    throw new Error(`admin auth failed: ${me.status} ${JSON.stringify(me.body)}`);
  }

  const integrations = await request(`${apiBaseUrl}/api/admin/system-status/integrations`, {
    headers: authHeaders(),
  });
  if (integrations.status !== 200 || integrations.body?.code !== 1) {
    throw new Error(`integrations failed: ${integrations.status} ${JSON.stringify(integrations.body)}`);
  }

  const ossCheck = Array.isArray(integrations.body?.data?.checks)
    ? integrations.body.data.checks.find((item) => item?.key === 'oss')
    : null;
  if (expectOss && !ossCheck?.configured) {
    throw new Error(`oss integration not configured: ${JSON.stringify(ossCheck)}`);
  }

  let ossResult = { skipped: true };
  if (expectOss) {
    const test = await request(`${apiBaseUrl}/api/admin/system-status/test/oss`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (test.status !== 200 || test.body?.code !== 1) {
      throw new Error(`oss test failed: ${test.status} ${JSON.stringify(test.body)}`);
    }
    ossResult = { message: test.body?.msg || null };
  }

  const backup = await request(`${apiBaseUrl}/api/admin/ops/backup-status`, {
    headers: authHeaders(),
  });
  if (backup.status !== 200 || backup.body?.code !== 1) {
    throw new Error(`backup status failed: ${backup.status} ${JSON.stringify(backup.body)}`);
  }
  if (expectBackupStatus && backup.body?.data?.available !== true) {
    throw new Error(`backup not available: ${JSON.stringify(backup.body)}`);
  }

  return {
    integrations: ossCheck ? { configured: ossCheck.configured, detail: ossCheck.detail || null } : null,
    oss: ossResult,
    backup: { available: backup.body?.data?.available ?? null, timestamp: backup.body?.data?.timestamp || null },
  };
});

push('authenticated upload stores image in expected backend', async () => {
  if (!expectUpload) {
    return { skipped: 'SMOKE_EXPECT_UPLOAD/SMOKE_EXPECT_OSS not set' };
  }
  await resolveUserCredentials();
  if (!userToken && !userCookie) {
    return { skipped: 'no user credentials provided' };
  }

  const runtime = await request(`${apiBaseUrl}/api/extension/runtime`, {
    headers: userAuthHeaders(),
  });
  if (runtime.status !== 200 || runtime.body?.code !== 1) {
    throw new Error(`extension runtime failed: ${runtime.status} ${JSON.stringify(runtime.body)}`);
  }
  const runtimeMode = runtime.body?.data?.mode || null;
  if (expectOss && runtime.body?.data?.capabilities?.imageUpload !== 'oss') {
    throw new Error(`expected extension runtime imageUpload=oss, got ${JSON.stringify(runtime.body?.data?.capabilities || {})}`);
  }

  const oneByOnePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const upload = await request(`${apiBaseUrl}/api/images/upload-base64`, {
    method: 'POST',
    headers: userAuthHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ dataUrl: oneByOnePng, filename: `remote-smoke-${Date.now()}.png` }),
  });
  if (upload.status !== 200 || upload.body?.code !== 1) {
    throw new Error(`upload failed: ${upload.status} ${JSON.stringify(upload.body)}`);
  }
  const data = upload.body?.data || {};
  if (expectOss && data.backend !== 'oss') {
    throw new Error(`expected oss backend, got ${JSON.stringify(data)}`);
  }
  return {
    backend: data.backend || null,
    url: data.url || null,
    userMode: tempUserMode,
    runtimeImageUpload: runtime.body?.data?.capabilities?.imageUpload || null,
    runtimeMode,
  };
});

for (const { name, fn } of checks) {
  try {
    if (name === 'admin auth can inspect integrations and backup status') {
      await resolveAdminCredentials();
    }
    const detail = await fn();
    console.log(`PASS ${name}: ${JSON.stringify(detail)}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${JSON.stringify(error?.message || String(error))}`);
    process.exitCode = 1;
    break;
  }
}
