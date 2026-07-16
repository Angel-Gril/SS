import { registerTimer } from '../lib/worker-registry.js';

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
  runTick: () => Promise<unknown>;
  intervalMs?: number;
  setTimeout?: OzonPublishReconciliationSetTimeout;
  clearTimeout?: OzonPublishReconciliationClearTimeout;
  registerStop?: (stop: () => void) => void;
  logger?: OzonPublishReconciliationWorkerLogger;
}

export interface OzonPublishReconciliationWorkerController {
  stop: () => void;
  isRunning: () => boolean;
}

export const DEFAULT_OZON_PUBLISH_RECONCILIATION_INTERVAL_MS = 15_000;

const defaultLogger: OzonPublishReconciliationWorkerLogger = {
  info: (message, details) => details === undefined ? console.log(message) : console.log(message, details),
  error: (message, details) => details === undefined ? console.error(message) : console.error(message, details),
};

function normalizeInterval(value: unknown): number {
  const interval = value ?? DEFAULT_OZON_PUBLISH_RECONCILIATION_INTERVAL_MS;
  if (!Number.isSafeInteger(interval) || Number(interval) < 1_000 || Number(interval) > 24 * 60 * 60_000) {
    throw new Error('Ozon publish reconciliation interval must be between 1000 and 86400000 milliseconds');
  }
  return Number(interval);
}

export function startOzonPublishReconciliationWorker(
  options: StartOzonPublishReconciliationWorkerOptions,
): OzonPublishReconciliationWorkerController {
  const intervalMs = normalizeInterval(options.intervalMs);
  const schedule = options.setTimeout || ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.clearTimeout || ((timer) => clearTimeout(timer));
  const registerStop = options.registerStop || registerTimer;
  const logger = options.logger || defaultLogger;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (timer) {
      cancel(timer);
      timer = null;
    }
  };

  const scheduleNext = () => {
    if (stopped) return;
    timer = schedule(() => {
      timer = null;
      void runOnce();
    }, intervalMs);
    timer.unref?.();
  };

  const runOnce = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await options.runTick();
    } catch (error) {
      logger.error('[ozon-publish-reconciliation] tick failed', error);
    } finally {
      running = false;
      scheduleNext();
    }
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
