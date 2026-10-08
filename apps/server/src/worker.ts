import 'dotenv/config';
import './bootstrap-config.js';
import { startProductSyncWorker } from './workers/product-sync.js';
import { startOrderSyncWorker } from './workers/order-sync.js';
import { startWarehouseCommandPollWorker } from './workers/warehouse-command-poll.js';
import { startSoloBillingWorker } from './workers/solo-billing.js';
import { startScheduledDispatchWorker } from './workers/scheduled-dispatch.js';
import { startExchangeRateSyncWorker } from './workers/exchange-rate-sync.js';
import { startFinanceSyncWorker } from './workers/finance-sync.js';
import { startDataRetentionWorker } from './workers/data-retention-cleanup.js';
import { startOssCleanupWorker } from './workers/oss-cleanup.js';
import { startDatabaseBackupWorker } from './workers/database-backup.js';
import { startRechargeTimeoutWorker } from './workers/recharge-timeout.js';
import { startListingTaskRefreshWorker } from './workers/listing-task-refresh.js';
import { startBrowserOneClickListingWorker } from './workers/browser-one-click-listing.js';
import {
  startAiImageGenerationWorker,
} from './workers/ai-image-generation.js';
import { startAiImageTranslationWorker } from './workers/ai-image-translation.js';
import { startAiImageEditWorker } from './workers/ai-image-edit.js';
import { startAiImageSuiteGenerationWorker } from './workers/ai-image-suite-generation.js';
import { startAiProviderReconciliationWorker } from './workers/ai-provider-reconciliation.js';
import { startOzonPublishReconciliationWorker } from './workers/ozon-publish-reconciliation.js';
import { startExtensionByokUploadCleanupWorker } from './workers/extension-byok-upload-cleanup.js';
import { prisma } from './lib/prisma.js';
import { PrismaAiImageSuiteGenerationCoordinator } from './repositories/ai-image-suite-execution-repository.js';
import { shutdownAllWorkers } from './lib/worker-registry.js';
import {
  aiImageSuiteProviderRuntimeMatches,
  createAiImageSuiteProviderRuntimeSnapshot,
} from './services/ai-image-suite-provider-runtime.js';
import { getRuntimeConfigForStorage } from './adapters/runtime-config.js';
import { getAiImageSuiteDispatchAuthorization } from './services/ai-image-suite-dispatch-authorization.js';
import { getAiImageSuiteProviderRuntimeConfig } from './services/ai-image-suite-runtime-config.js';

console.log('[worker] starting all workers as standalone process...');

startWarehouseCommandPollWorker();
startDataRetentionWorker();
startOssCleanupWorker();
startDatabaseBackupWorker();
startRechargeTimeoutWorker();
startListingTaskRefreshWorker();
startBrowserOneClickListingWorker();
startAiImageGenerationWorker();
startAiImageTranslationWorker();
startAiImageEditWorker();
const standaloneSuiteRuntimeEvidence = async (suite: {
  provider: string;
  model: string;
  providerConfigHash: string;
  pricingVersion: string;
  concurrencyLimit: number;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
}) => {
  const snapshot = createAiImageSuiteProviderRuntimeSnapshot(
    await getAiImageSuiteProviderRuntimeConfig(),
  );
  if (!snapshot.executionReady || !aiImageSuiteProviderRuntimeMatches(suite, snapshot)) return null;
  return snapshot.capability?.evidenceLevel === 'sandbox-verified'
    ? 'sandbox-verified' as const
    : snapshot.capability?.evidenceLevel === 'local-test'
      ? 'local-test' as const
      : null;
};
startAiImageSuiteGenerationWorker(new PrismaAiImageSuiteGenerationCoordinator(prisma, {
  runtimeReady: async (suite) => Boolean(await standaloneSuiteRuntimeEvidence(suite)),
  getRuntimeEvidence: standaloneSuiteRuntimeEvidence,
  outputStorageReady: async () => {
    const runtime = await getRuntimeConfigForStorage();
    return runtime.imageStorage === 'local' || runtime.imageStorage === 'oss';
  },
  getDispatchAuthorization: getAiImageSuiteDispatchAuthorization,
}));
startAiProviderReconciliationWorker();
startOzonPublishReconciliationWorker();
startExtensionByokUploadCleanupWorker();
startProductSyncWorker();
startOrderSyncWorker();
startSoloBillingWorker();
startScheduledDispatchWorker();
startExchangeRateSyncWorker();
startFinanceSyncWorker();

console.log('[worker] all workers running');

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down...`);
  try {
    await shutdownAllWorkers(30000);
    process.exit(0);
  } catch (err) {
    console.error('[worker] shutdown error:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
