import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { PrismaAiProviderReconciliationRepository } from '../repositories/ai-provider-reconciliation-repository.js';
import { getStorageBackend } from '../services/image-storage.js';
import {
  createAiProviderReconciliationService,
  isWanxEditReconciliationOperation,
  type AiProviderReconciliationClaim,
  type AiProviderReconciliationRepository,
  type AiProviderTaskLookupResult,
} from '../services/ai-provider-reconciliation.js';
import {
  isAiImageTranslationTransientError,
  type AiImageTranslationProvider,
} from '../services/ai-image-translation.js';
import {
  getAiImageTranslationProviderRuntimeConfig,
  resolveAiImageTranslationProvider,
  type AiImageTranslationProviderRuntimeConfig,
} from './ai-image-translation.js';
import { createAiImageEditRecovery, type AiImageEditRecoveryOptions } from '../services/ai-image-edit-recovery.js';
import { PrismaAiImageSuiteRecoveryRepository } from '../repositories/ai-image-suite-recovery-repository.js';
import { createAiImageSuiteRecovery, type AiImageSuiteRecoveryOptions } from '../services/ai-image-suite-recovery.js';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_LIMIT = 1;
const DEFAULT_DRAIN_LIMIT = 30;
const fakePng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2S8AAAAASUVORK5CYII=',
  'base64',
);

type LookupOverrides = {
  getProviderConfig?: () => Promise<AiImageTranslationProviderRuntimeConfig>;
  resolveProvider?: (
    provider: string,
    config: AiImageTranslationProviderRuntimeConfig,
  ) => AiImageTranslationProvider;
  nodeEnv?: string;
};

function reconciliationError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export async function lookupAiImageTranslationProviderTask(
  claim: AiProviderReconciliationClaim,
  overrides: LookupOverrides = {},
): Promise<AiProviderTaskLookupResult> {
  if (claim.operation !== 'IMAGE_TRANSLATE') {
    throw reconciliationError(
      'PROVIDER_LOOKUP_UNSUPPORTED',
      'Provider reconciliation only supports image translation tasks in this release',
    );
  }
  const nodeEnv = overrides.nodeEnv === undefined ? process.env.NODE_ENV : overrides.nodeEnv;
  if (claim.provider === 'fake') {
    if (nodeEnv === 'production') {
      throw reconciliationError(
        'PROVIDER_LOOKUP_UNSUPPORTED',
        'Fake Provider reconciliation is disabled in production',
      );
    }
    return {
      status: 'SUCCEEDED',
      providerJobId: claim.providerJobId,
      providerStatus: 'SUCCEEDED',
      image: {
        buffer: fakePng,
        mimeType: 'image/png',
        filename: `fake-reconciled-${claim.providerJobId}.png`,
      },
      actualCostCents: 0,
    };
  }

  const config = await (overrides.getProviderConfig || getAiImageTranslationProviderRuntimeConfig)();
  const frozenCostCents = Number(claim.estimatedCostCents);
  if (
    config.provider !== claim.provider
    || config.model !== claim.model
    || !config.apiKey.trim()
    || claim.provider !== 'dashscope-qwen-mt-image'
    || !Number.isSafeInteger(frozenCostCents)
    || frozenCostCents <= 0
  ) {
    throw reconciliationError(
      'PROVIDER_RECONCILIATION_CONFIG_UNAVAILABLE',
      'The frozen Provider task cannot be queried with the current server configuration',
    );
  }
  const provider = (overrides.resolveProvider || resolveAiImageTranslationProvider)(
    claim.provider,
    { ...config, costPerImageCents: frozenCostCents },
  );
  if (provider.name !== claim.provider) {
    throw reconciliationError(
      'PROVIDER_RECONCILIATION_CONFIG_UNAVAILABLE',
      'The Provider lookup adapter does not match the frozen task',
    );
  }
  try {
    const result = await provider.poll(claim.providerJobId);
    if (result.status === 'PENDING') {
      return {
        status: 'PENDING',
        providerJobId: claim.providerJobId,
        providerStatus: result.providerStatus,
      };
    }
    const actualCostCents = Math.max(0, Math.trunc(result.actualCostCents || 0));
    if (actualCostCents !== frozenCostCents) {
      throw reconciliationError(
        'PROVIDER_COST_EVIDENCE_MISMATCH',
        'Provider reconciliation cost does not match the frozen job price',
      );
    }
    return {
      status: 'SUCCEEDED',
      providerJobId: claim.providerJobId,
      providerStatus: result.providerStatus,
      image: result.image,
      actualCostCents: frozenCostCents,
    };
  } catch (error) {
    const code = String((error as { code?: unknown })?.code || 'PROVIDER_RECONCILIATION_FAILED');
    if (code === 'PROVIDER_TASK_FAILED') {
      return {
        status: 'NO_OUTPUT',
        providerJobId: claim.providerJobId,
        providerStatus: 'FAILED',
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : 'Provider task failed',
        billingDisposition: 'UNKNOWN',
      };
    }
    if (isAiImageTranslationTransientError(error)) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        code,
        transient: true,
      });
    }
    throw error;
  }
}

type TickOverrides = LookupOverrides & {
  repository?: AiProviderReconciliationRepository;
  uploadBuffer?: (...args: any[]) => Promise<any>;
  workerId?: string;
  limit?: number;
  drainLimit?: number;
  now?: () => Date;
  getEditProviderConfig?: AiImageEditRecoveryOptions['getProviderConfig'];
  createWanxEditProvider?: AiImageEditRecoveryOptions['createProvider'];
  loadEditInputBuffer?: AiImageEditRecoveryOptions['loadInputBuffer'];
  suiteRecovery?: ReturnType<typeof createAiImageSuiteRecovery>;
  suiteRecoveryRepository?: AiImageSuiteRecoveryOptions['repository'];
};

export async function runAiProviderReconciliationTick(overrides: TickOverrides = {}) {
  const repository = overrides.repository
    || new PrismaAiProviderReconciliationRepository(prisma);
  const uploadBuffer = overrides.uploadBuffer || (async (...args: any[]) => {
    const storage = await getStorageBackend();
    return (storage.uploadBuffer as (...values: any[]) => Promise<any>).apply(storage, args);
  });
  const editRecovery = createAiImageEditRecovery({
    repository, uploadBuffer,
    getProviderConfig: overrides.getEditProviderConfig,
    createProvider: overrides.createWanxEditProvider,
    loadInputBuffer: overrides.loadEditInputBuffer,
  });
  const suiteRepository = overrides.suiteRecoveryRepository || new PrismaAiImageSuiteRecoveryRepository(prisma);
  const suiteRecovery = overrides.suiteRecovery || createAiImageSuiteRecovery({ repository: suiteRepository, uploadBuffer });
  const suiteClaims = new Set<string>();
  const service = createAiProviderReconciliationService({
    repository,
    lookupProviderTask: async (claim) => {
      if (claim.operation === 'IMAGE_TO_IMAGE' && claim.workflowId && await suiteRepository.isSuiteClaim(claim)) {
        suiteClaims.add(claim.jobId);
        return suiteRecovery.lookup(claim);
      }
      return isWanxEditReconciliationOperation(claim) ? editRecovery.lookup(claim) : lookupAiImageTranslationProviderTask(claim, overrides);
    },
    recoverEditOutput: (claim, result) => suiteClaims.has(claim.jobId)
      ? suiteRecovery.recover(claim, result) : editRecovery.recover(claim, result),
    uploadBuffer,
    now: overrides.now,
  });
  const workerId = overrides.workerId || `${hostname()}:${process.pid}:${randomUUID()}`;
  if (overrides.limit !== undefined) {
    return service.runTick({ workerId, limit: overrides.limit });
  }
  const total = { claimed: 0, recovered: 0, pending: 0, noOutput: 0, manualReview: 0 };
  const drainLimit = Math.min(100, Math.max(1, Math.trunc(
    overrides.drainLimit || DEFAULT_DRAIN_LIMIT,
  )));
  for (let index = 0; index < drainLimit; index += 1) {
    const result = await service.runTick({ workerId, limit: DEFAULT_LIMIT });
    for (const key of Object.keys(total) as Array<keyof typeof total>) total[key] += result[key];
    if (result.claimed === 0) break;
  }
  return total;
}

export function startAiProviderReconciliationWorker(options: {
  intervalMs?: number;
  runTick?: typeof runAiProviderReconciliationTick;
  logger?: Pick<Console, 'error'>;
} = {}) {
  const runTick = options.runTick || runAiProviderReconciliationTick;
  const logger = options.logger || console;
  let running = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await runTick();
    } catch (error) {
      logger.error('[ai-provider-reconciliation] tick failed', error);
    } finally {
      running = false;
    }
  };
  const interval = setInterval(() => void tick(), Math.max(1_000, options.intervalMs || DEFAULT_INTERVAL_MS));
  interval.unref();
  void tick();
  const controller = {
    tick,
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
  registerTimer(controller.stop);
  return controller;
}
