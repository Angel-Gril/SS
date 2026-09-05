import { getRuntimeConfig } from './runtime-config.js';
import { Queue } from 'bullmq';
import { connection } from '../lib/bullmq-connection.js';
import { redisDisabled } from '../lib/redis.js';

const QUEUE_NAME = 'extension-sync';

export interface ExtensionSyncAdapter {
  mode: 'direct' | 'queue';
  submitTask(shopId: string, taskType: string, payload: unknown): Promise<{ taskId: string }>;
}

class DirectSyncAdapter implements ExtensionSyncAdapter {
  mode = 'direct' as const;
  async submitTask(_shopId: string, _taskType: string, _payload: unknown) {
    return { taskId: `local-${Date.now()}` };
  }
}

class QueueSyncAdapter implements ExtensionSyncAdapter {
  mode = 'queue' as const;
  private queue = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

  async submitTask(shopId: string, taskType: string, payload: unknown) {
    if (!this.queue) {
      throw new Error('Redis is disabled; extension queue sync is unavailable');
    }

    const job = await this.queue.add(taskType, { shopId, payload }, {
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
    return { taskId: String(job.id) };
  }
}

let syncAdapter: ExtensionSyncAdapter | null = null;

export function getExtensionSyncAdapter(): ExtensionSyncAdapter {
  if (!syncAdapter) {
    const config = getRuntimeConfig();
    syncAdapter = config.extensionSync === 'queue'
      ? new QueueSyncAdapter()
      : new DirectSyncAdapter();
  }
  return syncAdapter;
}
