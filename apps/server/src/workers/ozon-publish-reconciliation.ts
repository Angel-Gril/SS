import { hostname } from 'node:os';

import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { createPrismaOzonPublishAttemptRepository } from '../services/ozon-publish-attempt-prisma.js';
import type { OzonPublishAttemptRepository } from '../services/ozon-publish-attempts.js';
import {
  runOzonPublishReconciliationTick,
  type OzonPublishReconciliationClient,
  type OzonPublishReconciliationLogger,
  type ResolveOwnedOzonPublishClient,
} from '../services/ozon-publish-reconciliation.js';
import {
  createSourceWorkflowOzonClient,
} from '../services/source-workflow-ozon-client.js';

export interface OzonPublishReconciliationWorkerLogger {
  info(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export type OzonPublishReconciliationSetTimeout = (
  callback: () => void,
  delayMs: number,
) => ReturnType<typeof setTimeout>;

export type OzonPublishReconciliationClearTimeout = (
  timer: ReturnType<typeof setTimeout>,
) => void;

export interface StartOzonPublishReconciliationWorkerOptions {
  runTick?: () => Promise<unknown>;
  intervalMs?: number;
  setTimeout?: OzonPublishReconciliationSetTimeout;
  clearTimeout?: OzonPublishReconciliationClearTimeout;
  registerStop?: (stop: () => Promise<void>) => void;
  logger?: OzonPublishReconciliationWorkerLogger;
}

export interface OzonPublishReconciliationWorkerController {
  stop: () => Promise<void>;
  isRunning: () => boolean;
}

export const DEFAULT_OZON_PUBLISH_RECONCILIATION_INTERVAL_MS = 15_000;

const defaultLogger: OzonPublishReconciliationWorkerLogger = {
  info: (message, details) => details === undefined ? console.log(message) : console.log(message, details),
  error: (message, details) => details === undefined ? console.error(message) : console.error(message, details),
};

type RunOzonPublishReconciliationWorkerTickOverrides = {
  repository?: OzonPublishAttemptRepository;
  resolveOwnedClient?: ResolveOwnedOzonPublishClient;
  workerId?: string;
  logger?: OzonPublishReconciliationLogger;
};

async function loadOwnedClient(
  ownerUserId: string,
  shopId: string,
): Promise<ReturnType<typeof createSourceWorkflowOzonClient>> {
  const shop = await prisma.shop.findFirst({
    where: {
      id: shopId,
      userId: ownerUserId,
      platform: 'OZON',
      status: 'ACTIVE',
    },
    select: { clientId: true, apiKeyEncrypted: true },
  });
  if (!shop?.clientId || !shop.apiKeyEncrypted) {
    throw Object.assign(new Error('Owned active Ozon shop was not found'), {
      code: 'SOURCE_LISTING_SHOP_NOT_FOUND',
      statusCode: 404,
    });
  }

  return createSourceWorkflowOzonClient({
    clientId: shop.clientId,
    apiKeyEncrypted: shop.apiKeyEncrypted,
  });
}

async function resolveOwnedClient(
  ownerUserId: string,
  shopId: string,
): Promise<OzonPublishReconciliationClient> {
  const client = await loadOwnedClient(ownerUserId, shopId);
  return {
    getImportInfo: (taskId) => client.getImportInfo(taskId),
    getProductInfoByOfferId: (offerIds) => client.getProductInfoByOfferId(offerIds),
  };
}

const TICK_COUNTERS = [
  'staleMarked',
  'claimed',
  'completed',
  'retried',
  'manualReview',
  'lateAcknowledged',
  'leaseLost',
  'failed',
  'skipped',
] as const;

function initialTickMessage(result: unknown): string {
  const record = result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : {};
  const counters = Object.fromEntries(TICK_COUNTERS.map((key) => [
    key,
    Number.isSafeInteger(record[key]) && Number(record[key]) >= 0 ? Number(record[key]) : null,
  ]));
  return `[ozon-publish-reconciliation] ${JSON.stringify({
    event: 'INITIAL_TICK_COMPLETED',
    ...counters,
  })}`;
}

export function runOzonPublishReconciliationWorkerTick(
  overrides: RunOzonPublishReconciliationWorkerTickOverrides = {},
) {
  return runOzonPublishReconciliationTick({
    repository: overrides.repository || createPrismaOzonPublishAttemptRepository({
      client: prisma as never,
    }),
    resolveOwnedClient: overrides.resolveOwnedClient || resolveOwnedClient,
    settings: {
      workerId: overrides.workerId
        || `ozon-publish-reconciliation:${hostname()}:${process.pid}`,
    },
    logger: overrides.logger,
  });
}

function normalizeInterval(value: unknown): number {
  const interval = value ?? DEFAULT_OZON_PUBLISH_RECONCILIATION_INTERVAL_MS;
  if (!Number.isSafeInteger(interval) || Number(interval) < 1_000 || Number(interval) > 24 * 60 * 60_000) {
    throw new Error('Ozon publish reconciliation interval must be between 1000 and 86400000 milliseconds');
  }
  return Number(interval);
}

export function startOzonPublishReconciliationWorker(
  options: StartOzonPublishReconciliationWorkerOptions = {},
): OzonPublishReconciliationWorkerController {
  const intervalMs = normalizeInterval(options.intervalMs);
  const schedule = options.setTimeout || ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.clearTimeout || ((timer) => clearTimeout(timer));
  const registerStop = options.registerStop || registerTimer;
  const logger = options.logger || defaultLogger;
  const runTick = options.runTick || runOzonPublishReconciliationWorkerTick;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let initialTickCompleted = false;
  let activeTick: Promise<void> | null = null;

  const stop = async () => {
    stopped = true;
    if (timer) {
      cancel(timer);
      timer = null;
    }
    await activeTick;
  };

  const scheduleNext = () => {
    if (stopped) return;
    timer = schedule(() => {
      timer = null;
      void runOnce();
    }, intervalMs);
    timer.unref?.();
  };

  const runOnce = () => {
    if (stopped || activeTick) return activeTick || Promise.resolve();
    const execution = (async () => {
      running = true;
      try {
        const result = await runTick();
        if (!initialTickCompleted) {
          initialTickCompleted = true;
          logger.info(initialTickMessage(result));
        }
      } catch (error) {
        logger.error('[ozon-publish-reconciliation] tick failed', error);
      } finally {
        running = false;
      }
    })();
    activeTick = execution;
    void execution.finally(() => {
      if (activeTick === execution) activeTick = null;
      scheduleNext();
    });
    return execution;
  };

  const controller: OzonPublishReconciliationWorkerController = {
    stop,
    isRunning: () => running,
  };
  registerStop(stop);
  void runOnce();
  logger.info('[ozon-publish-reconciliation] worker started', { intervalMs });
  return controller;
}
