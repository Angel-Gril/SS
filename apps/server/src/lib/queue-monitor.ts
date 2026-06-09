import { Queue } from 'bullmq';
import type { JobType } from 'bullmq';
import { connection } from './bullmq-connection.js';
import { redisDisabled as defaultRedisDisabled } from './redis.js';

export interface QueueDefinition {
  name: string;
  label: string;
}

export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueFailedJob {
  id: string;
  name: string;
  failedReason: string | null;
  timestamp: string | null;
  finishedOn: string | null;
}

export interface QueueStatusRow {
  name: string;
  label: string;
  status: 'idle' | 'active' | 'warning' | 'error';
  counts: QueueCounts;
  recentFailed: QueueFailedJob[];
  error?: string;
}

export interface QueueOverview {
  status: 'ok' | 'degraded' | 'disabled';
  redisDisabled: boolean;
  queues: QueueStatusRow[];
  checkedAt: string;
}

type QueueLike = {
  getJobCounts: (...types: JobType[]) => Promise<Partial<Record<keyof QueueCounts, number>>>;
  getJobs: (types?: JobType | JobType[], start?: number, end?: number, asc?: boolean) => Promise<Array<{
    id?: string | number;
    name?: string;
    failedReason?: string;
    timestamp?: number;
    finishedOn?: number;
  }>>;
  close: () => Promise<unknown> | unknown;
};

interface QueueOverviewOptions {
  redisDisabled?: boolean;
  definitions?: QueueDefinition[];
  createQueue?: (name: string) => QueueLike;
}

export const DEFAULT_QUEUE_DEFINITIONS: QueueDefinition[] = [
  { name: 'product-sync', label: '商品同步' },
  { name: 'order-sync', label: '订单同步' },
  { name: 'finance-sync', label: '财务同步' },
  { name: 'solo-billing-snapshot', label: 'Solo 账单快照' },
  { name: 'scheduled-warehouse-dispatch', label: '仓库定时下发' },
  { name: 'exchange-rate-sync', label: '汇率同步' },
  { name: 'extension-sync', label: '插件同步' },
];

const COUNT_TYPES: JobType[] = ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'];

function toIso(value?: number): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function normalizeCounts(raw: Partial<Record<keyof QueueCounts, number>>): QueueCounts {
  return {
    waiting: raw.waiting || 0,
    active: raw.active || 0,
    completed: raw.completed || 0,
    failed: raw.failed || 0,
    delayed: raw.delayed || 0,
    paused: raw.paused || 0,
  };
}

function deriveQueueStatus(counts: QueueCounts): QueueStatusRow['status'] {
  if (counts.failed > 0) return 'warning';
  if (counts.active > 0 || counts.waiting > 0 || counts.delayed > 0) return 'active';
  return 'idle';
}

function defaultCreateQueue(name: string): QueueLike {
  return new Queue(name, { connection });
}

export async function getQueueOverview(options: QueueOverviewOptions = {}): Promise<QueueOverview> {
  const redisDisabled = options.redisDisabled ?? defaultRedisDisabled;
  const definitions = options.definitions ?? DEFAULT_QUEUE_DEFINITIONS;
  const checkedAt = new Date().toISOString();

  if (redisDisabled) {
    return {
      status: 'disabled',
      redisDisabled: true,
      queues: [],
      checkedAt,
    };
  }

  const createQueue = options.createQueue ?? defaultCreateQueue;
  const queues = await Promise.all(definitions.map(async (definition): Promise<QueueStatusRow> => {
    const queue = createQueue(definition.name);
    try {
      const [countsRaw, failedJobs] = await Promise.all([
        queue.getJobCounts(...COUNT_TYPES),
        queue.getJobs(['failed'], 0, 4, false),
      ]);
      const counts = normalizeCounts(countsRaw);
      return {
        ...definition,
        status: deriveQueueStatus(counts),
        counts,
        recentFailed: failedJobs.map((job) => ({
          id: String(job.id ?? ''),
          name: job.name || '',
          failedReason: job.failedReason || null,
          timestamp: toIso(job.timestamp),
          finishedOn: toIso(job.finishedOn),
        })),
      };
    } catch (e: any) {
      return {
        ...definition,
        status: 'error',
        counts: normalizeCounts({}),
        recentFailed: [],
        error: e?.message?.slice(0, 200) || 'unknown error',
      };
    } finally {
      await queue.close();
    }
  }));

  return {
    status: queues.some((queue) => queue.status === 'error') ? 'degraded' : 'ok',
    redisDisabled: false,
    queues,
    checkedAt,
  };
}
