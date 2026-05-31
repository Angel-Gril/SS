#!/usr/bin/env node
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';

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

const baseUrl = (process.env.SMOKE_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'https://ss-erp.com').replace(/\/+$/, '');
const expectRuntime = process.env.SMOKE_EXPECT_RUNTIME || 'cloud';
const password = `Smoke${crypto.randomBytes(9).toString('base64url')}1!`;
const suffix = String(Date.now()).slice(-8);
const adminPhone = `199${suffix}`;
const plainAdminPhone = `196${suffix}`;
const userPhone = `198${suffix}`;
const blockedPhone = `197${suffix}`;
const smsCode = '123456';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Set SMOKE_ENV_FILE or run from a configured server environment.');
}
if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required. Set SMOKE_ENV_FILE or run from a configured server environment.');
}

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL);
const results = [];
const createdUserIds = new Set();
const maintenanceKeys = ['maintenance_enabled', 'maintenance_message', 'maintenance_allow_admin', 'maintenance_readonly'];
let adminToken = '';
let oldMaintenanceRows = null;

async function record(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (error) {
    results.push({ name, ok: false, detail: error?.message || String(error) });
  }
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const cookie = headers.get('set-cookie');
  return cookie ? [cookie] : [];
}

function assertSecureAuthCookie(headers, context) {
  const cookie = getSetCookies(headers).find((item) => item.startsWith('sserp_token='));
  if (!cookie) throw new Error(`${context} did not set sserp_token cookie`);
  const requiredAttrs = [/;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=Lax/i, /;\s*Path=\//i];
  for (const attr of requiredAttrs) {
    if (!attr.test(cookie)) throw new Error(`${context} cookie missing ${attr}: ${cookie}`);
  }
  return cookie;
}

function assertClearedAuthCookie(headers, context) {
  const cookie = getSetCookies(headers).find((item) => item.startsWith('sserp_token='));
  if (!cookie) throw new Error(`${context} did not clear sserp_token cookie`);
  if (!/;\s*Max-Age=0/i.test(cookie) && !/;\s*Expires=/i.test(cookie)) {
    throw new Error(`${context} clear cookie missing expiry: ${cookie}`);
  }
  return cookie;
}

async function expectOkJson(path) {
  const out = await api(path);
  if (out.status !== 200) {
    throw new Error(`${path} returned ${out.status}: ${JSON.stringify(out.body)}`);
  }
  return out.body;
}

async function putConfig(key, value) {
  const out = await api(`/api/admin/system-config/${key}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ value }),
  });
  if (out.status !== 200 || out.body?.code !== 1) {
    throw new Error(`config ${key} failed: ${out.status} ${JSON.stringify(out.body)}`);
  }
}

async function cleanup() {
  if (oldMaintenanceRows) {
    const existingKeys = new Set(oldMaintenanceRows.map((row) => row.key));
    for (const row of oldMaintenanceRows) {
      await prisma.systemConfig.upsert({
        where: { key: row.key },
        create: {
          key: row.key,
          value: row.value,
          label: row.label,
          group: row.group,
          description: row.description,
        },
        update: {
          value: row.value,
          label: row.label,
          group: row.group,
          description: row.description,
        },
      });
    }
    const missingBeforeTest = maintenanceKeys.filter((key) => !existingKeys.has(key));
    if (missingBeforeTest.length) {
      await prisma.systemConfig.deleteMany({ where: { key: { in: missingBeforeTest } } });
    }
  } else {
    await prisma.systemConfig.updateMany({
      where: { key: 'maintenance_enabled' },
      data: { value: 'false' },
    });
  }

  await redis.del(`sms:code:${userPhone}`, `sms:fail:${userPhone}`, `sms:rate:${userPhone}`);
  const ids = [...createdUserIds];
  for (const userId of ids) {
    const keys = await redis.keys(`session:${userId}:*`);
    if (keys.length) await redis.del(...keys);
  }
  await prisma.user.deleteMany({ where: { phone: { in: [adminPhone, plainAdminPhone, userPhone, blockedPhone] } } });
}

async function main() {
  await prisma.user.deleteMany({ where: { phone: { in: [adminPhone, plainAdminPhone, userPhone, blockedPhone] } } });

  await record('ready probes database and redis', async () => {
    const body = await expectOkJson('/ready');
    if (body?.status !== 'ready' || body?.checks?.db !== 'ok' || body?.checks?.redis !== 'ok') {
      throw new Error(JSON.stringify(body));
    }
    return body.checks;
  });

  await record('setup status is initialized', async () => {
    const body = await expectOkJson('/api/setup/status');
    if (body?.code !== 1 || body?.data?.needsSetup !== false || body?.data?.hasAdmin !== true) {
      throw new Error(JSON.stringify(body));
    }
    return body.data;
  });

  await record('setup init cannot run after initialization', async () => {
    const out = await api('/api/setup/init', {
      method: 'POST',
      body: JSON.stringify({ phone: `195${suffix}`, password, nickname: 'Repeat Setup', setupToken: 'wrong-token' }),
    });
    if (out.status !== 403 || out.body?.code === 1) {
      throw new Error(`setup init unexpectedly allowed: ${out.status} ${JSON.stringify(out.body)}`);
    }
    return { status: out.status, msg: out.body?.msg };
  });

  await record('public pages render', async () => {
    const pages = ['/', '/login', '/admin/login', '/register', '/setup', '/landing'];
    const statuses = {};
    for (const page of pages) {
      const out = await api(page, { headers: { accept: 'text/html' } });
      statuses[page] = out.status;
      if (out.status !== 200) throw new Error(`${page} returned ${out.status}`);
    }
    return statuses;
  });

  await record('next chunks include production API when localhost fallback exists', async () => {
    const pages = ['/login', '/admin/login', '/setup'];
    const seen = new Set();
    const bad = [];
    for (const page of pages) {
      const out = await api(page, { headers: { accept: 'text/html' } });
      const html = String(out.body || '');
      const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((src) => src.includes('/_next/'));
      for (const src of scripts) {
        const url = src.startsWith('http') ? src : `${baseUrl}${src}`;
        if (seen.has(url)) continue;
        seen.add(url);
        const res = await fetch(url);
        const js = await res.text();
        const hasLocal = js.includes('http://localhost:3001');
        const hasBase = js.includes(baseUrl);
        if (hasLocal && !hasBase) bad.push(url);
      }
    }
    if (bad.length) throw new Error(`bad chunks: ${bad.join(', ')}`);
    return { checkedChunks: seen.size };
  });

  await record('cors rejects untrusted origins', async () => {
    const maliciousOrigin = 'https://evil.example';
    const out = await api('/ready', {
      headers: { origin: maliciousOrigin },
    });
    const allowedOrigin = out.headers.get('access-control-allow-origin');
    if (allowedOrigin === maliciousOrigin || allowedOrigin === '*') {
      throw new Error(`unexpected CORS allow-origin: ${allowedOrigin}`);
    }
    return { status: out.status, allowOrigin: allowedOrigin };
  });

  await record('path traversal does not expose server files', async () => {
    const out = await api('/uploads/%2e%2e/%2e%2e/%2e%2e/etc/passwd');
    const body = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
    if (out.status < 400 || body.includes('root:x:')) {
      throw new Error(`unsafe traversal response: ${out.status} ${body.slice(0, 120)}`);
    }
    return { status: out.status };
  });

  await record('admin login rejects injection-shaped phone', async () => {
    const out = await api('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: "x' OR 1=1--", password: "' OR 1=1--" }),
    });
    if (out.status === 200 || out.body?.code === 1) {
      throw new Error(`injection login unexpectedly succeeded: ${JSON.stringify(out.body)}`);
    }
    return { status: out.status, msg: out.body?.msg };
  });

  const admin = await prisma.user.create({
    data: {
      phone: adminPhone,
      passwordHash: await bcrypt.hash(password, 12),
      nickname: 'Live Smoke Super Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      isSuperAdmin: true,
      accountCode: `SMK${suffix.slice(-5)}`,
    },
  });
  createdUserIds.add(admin.id);

  const plainAdmin = await prisma.user.create({
    data: {
      phone: plainAdminPhone,
      passwordHash: await bcrypt.hash(password, 12),
      nickname: 'Live Smoke Plain Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      isSuperAdmin: false,
      accountCode: `SMA${suffix.slice(-5)}`,
    },
  });
  createdUserIds.add(plainAdmin.id);

  await record('admin dedicated login works', async () => {
    const out = await api('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: adminPhone, password }),
    });
    if (out.status !== 200 || out.body?.code !== 1 || !out.body?.data?.token) {
      throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
    }
    assertSecureAuthCookie(out.headers, 'admin login');
    adminToken = out.body.data.token;
    return { status: out.status, role: out.body.data.user.role };
  });

  await record('admin me requires admin auth', async () => {
    const out = await api('/api/admin/auth/me', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (out.status !== 200 || out.body?.code !== 1 || out.body?.data?.role !== 'ADMIN') {
      throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
    }
    return out.body.data;
  });

  await record('orders stats empty state returns complete fields', async () => {
    const out = await api('/api/orders/stats', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (out.status !== 200 || out.body?.code !== 1) {
      throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
    }
    const data = out.body.data;
    if (data?.total !== 0 || !data.byStatus || data.todayOrders !== 0 || data.todayRevenue !== '0') {
      throw new Error(`unexpected empty stats payload: ${JSON.stringify(data)}`);
    }
    return data;
  });

  await record('super admin can read backup status', async () => {
    const out = await api('/api/admin/ops/backup-status', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (out.status !== 200 || out.body?.code !== 1 || out.body?.data?.available !== true) {
      throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
    }
    return { available: out.body.data.available, timestamp: out.body.data.timestamp || null };
  });

  await record('extension token requires auth and works as bearer token', async () => {
    const unauth = await api('/api/auth/extension-token', { method: 'POST' });
    if (unauth.status !== 401) {
      throw new Error(`extension-token without auth returned ${unauth.status}: ${JSON.stringify(unauth.body)}`);
    }

    const out = await api('/api/auth/extension-token', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (out.status !== 200 || out.body?.code !== 1 || !out.body?.data?.token) {
      throw new Error(`extension-token failed: ${out.status} ${JSON.stringify(out.body)}`);
    }

    const runtime = await api('/api/extension/runtime', {
      headers: { authorization: `Bearer ${out.body.data.token}` },
    });
    if (runtime.status !== 200 || runtime.body?.code !== 1 || runtime.body?.data?.mode !== expectRuntime) {
      throw new Error(`extension token unusable: ${runtime.status} ${JSON.stringify(runtime.body)}`);
    }
    return { unauthStatus: unauth.status, runtimeMode: runtime.body.data.mode };
  });

  await record('plain admin cannot access super admin config endpoints', async () => {
    const login = await api('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: plainAdminPhone, password }),
    });
    if (login.status !== 200 || login.body?.code !== 1 || !login.body?.data?.token) {
      throw new Error(`plain admin login failed: ${login.status} ${JSON.stringify(login.body)}`);
    }
    const plainAdminToken = login.body.data.token;
    const configRead = await api('/api/admin/system-config', {
      headers: { authorization: `Bearer ${plainAdminToken}` },
    });
    const backupRead = await api('/api/admin/ops/backup-status', {
      headers: { authorization: `Bearer ${plainAdminToken}` },
    });
    if (configRead.status !== 403 || backupRead.status !== 403) {
      throw new Error(`plain admin reached super admin endpoint: config=${configRead.status}, backup=${backupRead.status}`);
    }
    return { configStatus: configRead.status, backupStatus: backupRead.status };
  });

  await record('cloud login requires turnstile token', async () => {
    const out = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: adminPhone, password }),
    });
    if (expectRuntime === 'cloud' && out.status !== 403) {
      throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
    }
    return { status: out.status, msg: out.body?.msg };
  });

  await record('cloud registration requires SMS proof and SMS send requires Turnstile', async () => {
    const sms = await api('/api/auth/sms-code', {
      method: 'POST',
      body: JSON.stringify({ phone: userPhone }),
    });
    if (expectRuntime === 'cloud' && sms.status !== 403) {
      throw new Error(`sms without turnstile should be rejected, got ${sms.status}: ${JSON.stringify(sms.body)}`);
    }

    const register = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone: userPhone, password, nickname: 'No SMS User' }),
    });
    if (expectRuntime === 'cloud' && register.status !== 400) {
      throw new Error(`register without sms should be rejected, got ${register.status}: ${JSON.stringify(register.body)}`);
    }

    const existing = await prisma.user.findUnique({ where: { phone: userPhone }, select: { id: true } });
    if (existing) throw new Error(`user was created without SMS proof: ${existing.id}`);

    return { smsStatus: sms.status, registerStatus: register.status };
  });

  await record('registration with seeded sms creates normal user', async () => {
    await redis.set(`sms:code:${userPhone}`, smsCode, 'EX', 300);
    const out = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        phone: userPhone,
        password,
        nickname: 'Live Smoke User',
        smsCode,
      }),
    });
    if (out.status !== 201 || out.body?.code !== 1) {
      throw new Error(`${out.status} ${JSON.stringify(out.body)}`);
    }
    assertSecureAuthCookie(out.headers, 'user registration');
    const user = await prisma.user.findUnique({
      where: { phone: userPhone },
      select: { id: true, role: true, isSuperAdmin: true },
    });
    if (!user || user.role !== 'USER' || user.isSuperAdmin) {
      throw new Error(`unexpected user ${JSON.stringify(user)}`);
    }
    createdUserIds.add(user.id);
    return { role: user.role, isSuperAdmin: user.isSuperAdmin };
  });

  await record('normal user cannot use admin login or admin APIs', async () => {
    const user = await prisma.user.findUnique({
      where: { phone: userPhone },
      select: { id: true, role: true },
    });
    if (!user) throw new Error(`registered smoke user missing: ${userPhone}`);

    const adminLogin = await api('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone: userPhone, password }),
    });
    if (adminLogin.status !== 401 || adminLogin.body?.code === 1) {
      throw new Error(`normal user admin login unexpectedly succeeded: ${adminLogin.status} ${JSON.stringify(adminLogin.body)}`);
    }

    const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
    await redis.set(`session:${user.id}:${token.slice(-8)}`, '1', 'EX', 600);
    const adminApi = await api('/api/admin/ops/backup-status', {
      headers: { authorization: `Bearer ${token}` },
    });
    if (adminApi.status !== 403 || adminApi.body?.code === 1) {
      throw new Error(`normal user admin API unexpectedly succeeded: ${adminApi.status} ${JSON.stringify(adminApi.body)}`);
    }

    return { adminLoginStatus: adminLogin.status, adminApiStatus: adminApi.status };
  });

  await record('extension runtime and cloud cookie policy work', async () => {
    const unauth = await api('/api/extension/runtime');
    if (unauth.status !== 401) throw new Error(`runtime without auth returned ${unauth.status}`);

    const runtime = await api('/api/extension/runtime', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (runtime.status !== 200 || runtime.body?.code !== 1) {
      throw new Error(`${runtime.status} ${JSON.stringify(runtime.body)}`);
    }
    if (runtime.body.data?.mode !== expectRuntime) {
      throw new Error(`expected ${expectRuntime}, got ${runtime.body.data?.mode}`);
    }

    const sync = await api('/api/extension/sync-cookie', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ shopId: 'smoke-missing-shop', cookie: 'a=b', companyId: '1' }),
    });
    if (expectRuntime === 'cloud' && sync.status !== 400) {
      throw new Error(`cloud sync-cookie should be rejected, got ${sync.status}`);
    }
    return { mode: runtime.body.data.mode, syncCookieStatus: sync.status };
  });

  await record('maintenance mode blocks non-admin writes and keeps admin reachable', async () => {
    oldMaintenanceRows = await prisma.systemConfig.findMany({
      where: { key: { in: maintenanceKeys } },
    });
    await putConfig('maintenance_enabled', 'true');
    await putConfig('maintenance_message', 'Live smoke maintenance');
    await putConfig('maintenance_allow_admin', 'true');
    await putConfig('maintenance_readonly', 'true');
    await new Promise((resolve) => setTimeout(resolve, 5500));

    const blocked = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone: blockedPhone, password, nickname: 'Blocked', smsCode }),
    });
    if (blocked.status !== 503 || blocked.body?.maintenance !== true) {
      throw new Error(`non-admin write not blocked: ${blocked.status} ${JSON.stringify(blocked.body)}`);
    }

    const adminRoute = await api('/api/admin/ops/backup-status', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (adminRoute.status !== 200 || adminRoute.body?.code !== 1) {
      throw new Error(`admin route unavailable: ${adminRoute.status} ${JSON.stringify(adminRoute.body)}`);
    }
    return { blockedStatus: blocked.status, adminStatus: adminRoute.status };
  });

  await record('logout clears cookie and invalidates session token', async () => {
    const logout = await api('/api/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (logout.status !== 200 || logout.body?.code !== 1) {
      throw new Error(`logout failed: ${logout.status} ${JSON.stringify(logout.body)}`);
    }
    assertClearedAuthCookie(logout.headers, 'logout');

    const me = await api('/api/admin/auth/me', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (me.status !== 401) {
      throw new Error(`logged out token still accepted: ${me.status} ${JSON.stringify(me.body)}`);
    }
    return { logoutStatus: logout.status, meAfterLogoutStatus: me.status };
  });
}

try {
  await main();
} finally {
  await cleanup();
  await redis.quit();
  await prisma.$disconnect();
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.detail)}`);
}

if (results.some((result) => !result.ok)) {
  process.exit(1);
}
