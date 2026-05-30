import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from './prisma.js';

const BYPASS_PATHS = new Set([
  '/health',
  '/ready',
  '/api/setup/status',
  '/api/auth/login',
  '/api/admin/auth/login',
  '/api/user/me',
  '/api/app-version/check',
]);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

let cachedEnabled: boolean | null = null;
let cachedMessage = '系统维护中，请稍后再试';
let cachedAllowAdmin = true;
let cachedReadonly = true;
let cacheExpiry = 0;

async function loadMaintenanceConfig() {
  const now = Date.now();
  if (cachedEnabled !== null && now < cacheExpiry) return;

  const rows = await prisma.systemConfig.findMany({
    where: { group: 'maintenance' },
    select: { key: true, value: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));

  cachedEnabled = map.get('maintenance_enabled') === 'true';
  cachedMessage = map.get('maintenance_message') || '系统维护中，请稍后再试';
  cachedAllowAdmin = map.get('maintenance_allow_admin') !== 'false';
  cachedReadonly = map.get('maintenance_readonly') !== 'false';
  cacheExpiry = now + 5000;
}

export function registerMaintenanceHook(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    await loadMaintenanceConfig();
    if (!cachedEnabled) return;

    const path = request.url.split('?')[0]!;
    if (BYPASS_PATHS.has(path)) return;
    // Admin routes still authenticate later. Allowing this prefix keeps
    // super-admin controls reachable during maintenance.
    if (cachedAllowAdmin && path.startsWith('/api/admin/')) return;

    if (cachedReadonly && READ_METHODS.has(request.method)) return;

    return reply.status(503).send({
      code: 0,
      msg: cachedMessage,
      maintenance: true,
    });
  });
}

export function invalidateMaintenanceCache() {
  cacheExpiry = 0;
}
