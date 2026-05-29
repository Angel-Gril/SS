import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const checkSchema = z.object({
  platform: z.enum(['web', 'electron', 'extension']),
  currentVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
});

const createSchema = z.object({
  platform: z.enum(['web', 'electron', 'extension']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  minVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  releaseNotes: z.string().optional(),
  downloadUrl: z.string().url().optional(),
});

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

export function getLatestVersion<T extends { version: string }>(versions: T[]): T | null {
  return versions.reduce<T | null>((latest, candidate) => {
    if (!latest) return candidate;
    return compareVersions(candidate.version, latest.version) > 0 ? candidate : latest;
  }, null);
}

export async function appVersionRoutes(app: FastifyInstance) {
  // 公开接口：客户端检查更新
  app.post('/check', async (request, reply) => {
    const parsed = checkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const body = parsed.data;
    const activeVersions = await prisma.appVersion.findMany({
      where: { platform: body.platform, isActive: true },
    });
    const latest = getLatestVersion(activeVersions);

    if (!latest) {
      return reply.send({ code: 1, data: { updateAvailable: false } });
    }

    const needsUpdate = compareVersions(latest.version, body.currentVersion) > 0;
    const forceUpdate = compareVersions(latest.minVersion, body.currentVersion) > 0;

    return reply.send({
      code: 1,
      data: {
        updateAvailable: needsUpdate,
        forceUpdate,
        latestVersion: latest.version,
        minVersion: latest.minVersion,
        releaseNotes: latest.releaseNotes,
        downloadUrl: latest.downloadUrl,
      },
    });
  });

  // 管理员：创建版本
  app.post('/', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const body = parsed.data;
    if (compareVersions(body.minVersion, body.version) > 0) {
      return reply.status(400).send({ code: 0, msg: '最低兼容版本不能高于发布版本' });
    }

    const version = await prisma.appVersion.create({ data: body });
    return reply.send({ code: 1, data: version });
  });

  // 管理员：列出所有版本
  app.get('/', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const versions = await prisma.appVersion.findMany({
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });
    return reply.send({ code: 1, data: versions });
  });

  // 管理员：停用版本
  app.patch('/:id/deactivate', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const version = await prisma.appVersion.update({
      where: { id },
      data: { isActive: false },
    });
    return reply.send({ code: 1, data: version });
  });
}
