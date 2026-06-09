import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { mkdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opsRoutes } from '../routes/ops.js';
import { signToken } from '../lib/auth.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
}));

const queueMonitorMock = vi.hoisted(() => ({
  getQueueOverview: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));
vi.mock('../lib/queue-monitor.js', () => ({ getQueueOverview: queueMonitorMock.getQueueOverview }));

const tmpDir = path.join(process.cwd(), 'tmp', 'ops-test');
const statusPath = path.join(tmpDir, 'backup-status.json');
const previousBackupStatusPath = process.env.BACKUP_STATUS_PATH;

async function buildOpsApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(opsRoutes, { prefix: '/api/admin/ops' });
  await app.ready();
  return app;
}

function adminAuthHeader() {
  return {
    authorization: `Bearer ${signToken({ userId: 'admin-1', role: 'ADMIN' })}`,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.BACKUP_STATUS_PATH = statusPath;
  await rm(tmpDir, { recursive: true, force: true });
  redisMock.exists.mockResolvedValue(1);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'admin-1',
    parentId: null,
    accountCode: '001',
    status: 'ACTIVE',
    role: 'ADMIN',
    isSuperAdmin: true,
  });
  queueMonitorMock.getQueueOverview.mockResolvedValue({
    status: 'disabled',
    redisDisabled: true,
    queues: [],
    checkedAt: '2026-06-09T00:00:00.000Z',
  });
});

afterEach(async () => {
  if (previousBackupStatusPath === undefined) {
    delete process.env.BACKUP_STATUS_PATH;
  } else {
    process.env.BACKUP_STATUS_PATH = previousBackupStatusPath;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe('ops routes', () => {
  it('reports missing backup status file as unavailable', async () => {
    const app = await buildOpsApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/ops/backup-status',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        available: false,
        message: '备份状态文件不存在，请确认备份脚本已配置',
      },
    });
    await app.close();
  });

  it('returns parsed backup status details when the status file exists', async () => {
    const app = await buildOpsApp();
    await mkdir(tmpDir, { recursive: true });
    await writeFile(statusPath, JSON.stringify({
      ok: true,
      lastBackupAt: '2026-06-09T01:02:03.000Z',
      filename: 'ss-erp-20260609.sql.gz',
      sizeBytes: 123456,
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/ops/backup-status',
      headers: adminAuthHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        available: true,
        ok: true,
        lastBackupAt: '2026-06-09T01:02:03.000Z',
        filename: 'ss-erp-20260609.sql.gz',
        sizeBytes: 123456,
      },
    });
    await app.close();
  });
});
