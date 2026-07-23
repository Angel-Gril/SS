import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { authenticate, requireSuperAdmin } from '../lib/auth.js';
import { readBackupStatus } from '../services/backup.service.js';
import {
  BackupRunInProgressError,
  BackupRunLeaseLostError,
  BackupRunLockUnavailableError,
  runDatabaseBackupSingleFlight,
  startManualDatabaseBackup,
} from '../services/backup-run.service.js';

const DEFAULT_STATUS_PATH = '/var/backups/ss-erp/backup-status.json';

async function requireLiveAccountSession(request: FastifyRequest, reply: FastifyReply) {
  if ((request as any).user?.tokenUse === 'account_session') return;
  return reply.status(403).send({
    code: 0,
    errorCode: 'ops_account_session_required',
    msg: '运维操作需要当前账号会话',
  });
}

export async function opsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireSuperAdmin);
  app.addHook('preHandler', requireLiveAccountSession);

  app.get('/backup-status', async (_request, reply) => {
    const serviceStatus = await readBackupStatus();
    if (serviceStatus) {
      return reply.send({ code: 1, data: { available: true, ...serviceStatus } });
    }

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

  app.post('/backup/run', async (_request, reply) => {
    const attempt = startManualDatabaseBackup();
    if (!attempt.accepted) {
      return reply.status(409).send({
        code: 0,
        errorCode: 'backup_in_progress',
        msg: '已有手动备份正在执行，请稍后重试',
      });
    }

    let result: Awaited<ReturnType<typeof runDatabaseBackupSingleFlight>>;
    try {
      result = await attempt.promise;
    } catch (error) {
      if (error instanceof BackupRunInProgressError) {
        return reply.status(409).send({
          code: 0,
          errorCode: 'backup_in_progress',
          msg: error.message,
        });
      }
      if (error instanceof BackupRunLockUnavailableError) {
        return reply.status(503).send({
          code: 0,
          errorCode: 'backup_lock_unavailable',
          msg: error.message,
        });
      }
      if (error instanceof BackupRunLeaseLostError) {
        return reply.status(503).send({
          code: 0,
          errorCode: 'backup_lease_lost',
          msg: error.message,
        });
      }
      throw error;
    }
    return reply.send({
      code: result.ok ? 1 : 0,
      msg: result.msg,
      data: result,
    });
  });
}
