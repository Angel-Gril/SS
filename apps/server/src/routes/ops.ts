import type { FastifyInstance } from 'fastify';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { getQueueOverview } from '../lib/queue-monitor.js';

const DEFAULT_STATUS_PATH = '/var/backups/ss-erp/backup-status.json';

export async function opsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);

  app.get('/backup-status', async (_request, reply) => {
    const statusPath = process.env.BACKUP_STATUS_PATH || DEFAULT_STATUS_PATH;
    if (!existsSync(statusPath)) {
      return reply.send({
        code: 1,
        data: {
          available: false,
          message: '备份状态文件不存在，请确认备份脚本已配置',
        },
      });
    }
    try {
      const raw = await readFile(statusPath, 'utf-8');
      const data = JSON.parse(raw);
      return reply.send({ code: 1, data: { available: true, ...data } });
    } catch (e: any) {
      return reply.send({
        code: 0,
        msg: `读取备份状态失败: ${e?.message?.slice(0, 200) || 'unknown'}`,
      });
    }
  });

  app.get('/queues', async (_request, reply) => {
    const overview = await getQueueOverview();
    return reply.send({ code: 1, data: overview });
  });
}
