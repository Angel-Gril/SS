import 'dotenv/config';
import './bootstrap-config.js';
import { initSentry, Sentry } from './lib/sentry.js';
initSentry();
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { authRoutes } from './routes/auth.js';
import { setupRoutes } from './routes/setup.js';
import { userRoutes } from './routes/user.js';
import { shopRoutes } from './routes/shop.js';
import { orderRoutes } from './routes/order.js';
import { orderAnalyticsRoutes } from './routes/order/analytics.js';
import { financeRoutes } from './routes/finance.js';
import { inventoryRoutes } from './routes/inventory.js';
import { listingRoutes } from './routes/listing.js';
import { sourceCaptureViewRoutes } from './routes/source-capture-views.js';
import { sourceListingPublisherRoutes } from './routes/source-listing-publisher.js';
import { sourceListingWorkflowRoutes } from './routes/source-listing-workflows.js';
import { noticeRoutes } from './routes/notice.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { dashboardContentRoutes } from './routes/dashboard-content.js';
import { productRoutes } from './routes/product.js';
import { returnRoutes } from './routes/return.js';
import { issueRoutes } from './routes/issue.js';
import { supplyRoutes } from './routes/supply.js';
import { staffRoutes } from './routes/staff.js';
import { notificationRoutes } from './routes/notification.js';
import {
  collectRoutes,
  collectBatchForOwner,
  type CollectRoutesOptions,
} from './routes/collect.js';
import { ozonAnalyticsRoutes } from './routes/ozon-analytics.js';
import { ozonSyncRoutes } from './routes/ozon-sync.js';
import { warehouseRoutes } from './routes/warehouse.js';
import { warehouseTemplateRoutes } from './routes/warehouse-template.js';
import { ozonPickupPointRoutes } from './routes/ozon-pickup-point.js';
import { warehouseCommandRoutes } from './routes/warehouse-command.js';
import { userServiceTagRoutes } from './routes/user-service-tag.js';
import { adminRoutes, seedServiceTags, seedSuperAdmin } from './routes/admin.js';
import { seedSystemConfig } from './routes/system-config.js';
import { accountRoutes } from './routes/account.js';
import { rechargeRoutes } from './routes/recharge.js';
import { paymentRoutes } from './routes/payment.js';
import { adminPaymentRoutes } from './routes/admin-payment.js';
import { inviteRoutes } from './routes/invite.js';
import { logisticsBillRoutes } from './routes/logistics-bill.js';
import { logisticsRoutes } from './routes/logistics.js';
import { exportRoutes } from './routes/export.js';
import { searchRoutes } from './routes/search.js';
import { prisma } from './lib/prisma.js';
import { redis, redisDisabled } from './lib/redis.js';
import { providerRoutes } from './routes/provider.js';
import { ozonLogisticsRoutes, domesticAddressRoutes } from './routes/ozon-logistics.js';
import { systemConfigRoutes } from './routes/system-config.js';
import { watermarkTemplateRoutes } from './routes/watermark-template.js';
import { imageUploadRoutes } from './routes/image-upload.js';
import { cdnProxyRoutes } from './routes/cdn-proxy.js';
import { chatRoutes } from './routes/chat.js';
import { appVersionRoutes } from './routes/app-version.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { extensionConfigRoutes } from './routes/extension-config.js';
import { extensionDownloadRoutes } from './routes/extensions.js';
import { announcementRoutes } from './routes/announcements.js';
import { systemStatusRoutes } from './routes/system-status.js';
import { opsRoutes } from './routes/ops.js';
import { sourceCandidateRoutes } from './routes/source-candidates.js';
import {
  aiImageRoutes,
  resolveAiImageEditReadiness,
  resolveAiImageToImageReadiness,
} from './routes/ai-images.js';
import { aiImageSuiteRoutes } from './routes/ai-image-suites.js';
import { aiMediaPlanningRoutes } from './routes/ai-media-plans.js';
import {
  createAiImageSuiteService,
  type AiImageSuiteProviderConfig,
} from './services/ai-image-suite.js';
import {
  aiImageSuiteProviderConfigMatches,
  aiImageSuiteProviderRuntimeMatches,
  createAiImageSuiteProviderRuntimeSnapshot,
} from './services/ai-image-suite-provider-runtime.js';
import { getAiImageSuiteDispatchAuthorization } from './services/ai-image-suite-dispatch-authorization.js';
import { PrismaAiImageSuiteRepository } from './repositories/ai-image-suite-repository.js';
import { PrismaAiImageSuiteReferenceRepository } from './repositories/ai-image-suite-reference-repository.js';
import { PrismaAiImageSuitePromptRepository } from './repositories/ai-image-suite-prompt-repository.js';
import { PrismaAiImageSuiteMaterializationRepository } from './repositories/ai-image-suite-materialization-repository.js';
import { PrismaAiImageSuiteCandidateRepository } from './repositories/ai-image-suite-candidate-repository.js';
import {
  PrismaAiImageSuiteExecutionRepository,
  PrismaAiImageSuiteGenerationCoordinator,
} from './repositories/ai-image-suite-execution-repository.js';
import { adminAiPromptTemplateRoutes } from './routes/admin-ai-prompt-templates.js';
import { adminAiCostReconciliationRoutes } from './routes/admin-ai-cost-reconciliations.js';
import { adminAiProviderReconciliationRoutes } from './routes/admin-ai-provider-reconciliations.js';
import { adminOzonPublisherParityRoutes } from './routes/admin-ozon-publisher-parity.js';
import { adminOzonPublisherRolloutRoutes } from './routes/admin-ozon-publisher-rollout.js';
import {
  aiPromptTemplateRegistry,
  resolveActiveAiPrompt,
  resolveActiveAiTemplate,
} from './services/ai-prompt-template-registry.js';
import { createOzonPublisherRolloutAdminService } from './services/ozon-publisher-rollout-admin.js';
import { createPrismaOzonPublisherRolloutAdminRepository } from './services/ozon-publisher-rollout-admin-prisma.js';
import { createAiCostReconciliationAdminService } from './services/ai-cost-reconciliation-admin.js';
import { createAiProviderReconciliationAdminService } from './services/ai-provider-reconciliation-admin.js';
import { loadPrismaOzonPublisherRolloutControlSnapshot } from './services/ozon-publisher-rollout-control.js';
import { createPrismaOzonPublisherRolloutReadinessRepository } from './services/ozon-publisher-rollout-readiness-prisma.js';
import { createOzonPublisherRolloutReadinessService } from './services/ozon-publisher-rollout-readiness-service.js';
import { createOzonPublisherEntrypointRolloutService } from './services/ozon-publisher-entrypoint-rollout.js';
import { extensionDeviceRoutes } from './routes/extension-device.js';
import { extensionDeviceBrowserOneClickRoutes } from './routes/extension-device-browser-one-click.js';
import {
  createSourceWorkflowCommandResolver,
  extensionCommandGrantRoutes,
  type ExtensionCommandGrantRoutesOptions,
} from './routes/extension-command-grants.js';
import { extensionByokMediaRoutes } from './routes/extension-byok-media.js';
import { extensionByokPublishRoutes } from './routes/extension-byok-publish.js';
import { extensionWorkbenchPublishRoutes } from './routes/extension-workbench-publish.js';
import { extensionByokReadinessRoutes } from './routes/extension-byok-readiness.js';
import { extensionByokExecutionIntentRoutes } from './routes/extension-byok-execution-intent.js';
import { extensionByokExecutionBatchRoutes } from './routes/extension-byok-execution-batch.js';
import { extensionByokMediaBatchRoutes } from './routes/extension-byok-media-batch.js';
import { extensionSourceCaptureRoutes } from './routes/extension-source-captures.js';
import { extensionSourceWorkbenchRoutes } from './routes/extension-source-workbench.js';
import {
  EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES,
  extensionMediaLaunchRoutes,
} from './routes/extension-media-launch.js';
import { extensionMediaEditRoutes } from './routes/extension-media-edit.js';
import { extensionAiImageSuiteRoutes } from './routes/extension-ai-image-suite.js';
import {
  extensionHostedAiImageModeLockRoutes,
} from './routes/extension-hosted-ai-image-mode-lock.js';
import { extensionHostedAiImagePlanRoutes } from './routes/extension-hosted-ai-image-plan.js';
import {
  extensionHostedCandidatePreviewRoutes,
} from './routes/extension-hosted-ai-image-suite-candidate-preview.js';
import {
  extensionHostedAiImageListingAssignmentRoutes,
} from './routes/extension-hosted-ai-image-listing-assignment.js';
import { projectExtensionAiImageSuite } from './services/extension-ai-image-suite-projection.js';
import {
  createExtensionHostedAiImagePlanBindingRecord,
  createExtensionHostedAiImagePlanService,
} from './services/extension-hosted-ai-image-plan.js';
import {
  createPrismaExtensionHostedAiImagePlanBindingStore,
} from './services/extension-hosted-ai-image-plan-binding-prisma.js';
import {
  createPrismaExtensionHostedAiImageAuthorityLoader,
} from './services/extension-hosted-ai-image-authority-prisma.js';
import {
  createExtensionHostedAiImageModeLockService,
} from './services/extension-hosted-ai-image-mode-lock.js';
import {
  createPrismaExtensionHostedAiImageModeLockLoader,
} from './services/extension-hosted-ai-image-mode-lock-prisma.js';
import {
  createExtensionHostedCandidatePreviewService,
} from './services/extension-hosted-ai-image-suite-candidate-preview.js';
import {
  createHostedSuiteListingDraftAssignmentService,
} from './services/hosted-suite-listing-draft-assignment.js';
import {
  createPrismaHostedSuiteListingDraftAssignmentRepository,
} from './services/hosted-suite-listing-draft-assignment-prisma.js';
import {
  createExtensionHostedAiImagePolicyEvaluator,
} from './services/extension-hosted-ai-image-policy.js';
import { sourceWorkflowFeatureFlags } from './services/source-workflow-feature-flags.js';
import { getAiMediaRolloutDecision } from './services/ai-media-rollout.js';
import {
  SourceListingWorkflowError,
  createSourceListingWorkflowService,
} from './services/source-listing-workflow.js';
import { createSourceListingAiCopyService } from './services/source-listing-ai-copy.js';
import { createPrismaSourceListingAiCopyExecutionStore } from './services/source-listing-ai-copy-execution.js';
import { createPrismaSourceListingWorkflowRepository } from './services/source-listing-workflow-prisma.js';
import { createPrismaSourceListingWorkflowContextResolver } from './services/source-listing-workflow-context.js';
import { createSourceListingWorkflowCategoryValidator } from './services/source-listing-workflow-category.js';
import { createSourceListingWorkflowAttributeService } from './services/source-listing-workflow-attributes.js';
import {
  createSourceWorkflowOzonClient,
  findSourceWorkflowOzonCredentialsUnavailableError,
} from './services/source-workflow-ozon-client.js';
import { createSourceListingMediaImportService } from './services/source-listing-media-import.js';
import { createPrismaSourceListingMediaImportStore } from './services/source-listing-media-import-prisma.js';
import { getOwnedImageStorageBackend, getStorageBackend } from './services/image-storage.js';
import { createPrismaByokGeneratedAssetRepository } from './repositories/byok-generated-asset-repository.js';
import {
  createPrismaExtensionByokGeneratedAssetCommitter,
} from './repositories/extension-byok-generated-asset-commit-prisma.js';
import {
  createPrismaExtensionByokGeneratedAssetBatchCommitter,
} from './repositories/extension-byok-generated-asset-batch-commit-prisma.js';
import {
  createPrismaExtensionByokMediaIngestStatusRepository,
} from './repositories/extension-byok-media-ingest-status-repository.js';
import {
  createPrismaExtensionByokMediaBatchIngestStatusRepository,
} from './repositories/extension-byok-media-batch-ingest-status-repository.js';
import { getRuntimeConfigForStorage } from './adapters/runtime-config.js';
import {
  createAiImageSuiteReferenceService,
  normalizeAiImageSuiteOssCdnDomain,
  resolveAiImageSuiteReferenceStorageReadiness,
} from './services/ai-image-suite-references.js';
import { createRedisAiImageSuitePreparationLease } from './services/ai-image-suite-preparation-lease.js';
import { probeAiImageSuiteRuntime } from './services/ai-image-suite-runtime-readiness.js';
import { createAiImageSuitePromptService } from './services/ai-image-suite-prompts.js';
import { createAiImageSuiteMaterializationService } from './services/ai-image-suite-materialization.js';
import { createAiImageSuiteExecutionService } from './services/ai-image-suite-execution.js';
import { createAiImageSuiteCandidateService } from './services/ai-image-suite-candidates.js';
import {
  aiImageSuiteGenerationQueue,
  enqueueAiImageSuiteGenerationRecoveryJob,
} from './workers/ai-image-suite-generation.js';
import {
  createPrismaOzonAttributeDefinitionCacheStore,
  getCachedOzonAttributeDefinitions,
} from './services/ozon-attribute-definition-cache.js';
import {
  createPrismaOzonAttributeDictionaryCacheStore,
  getCachedOzonAttributeValues,
} from './services/ozon-attribute-dictionary-cache.js';
import { buildOzonAttributeSchema } from './services/ozon-attribute-schema.js';
import { sourceStandardDictionaryAliases } from './services/source-standard-dictionary-aliases.js';
import type { SourceProductProfile } from './services/source-product-profile.js';
import { buildSourceListingAttributeSourceContext } from './services/source-listing-workflow-source-context.js';
import { createSourceCaptureService } from './services/source-capture.js';
import { createPrismaSourceCaptureRepository } from './services/source-capture-prisma.js';
import { PrismaAiMediaPlanningRepository } from './repositories/ai-media-planning-repository.js';
import { createAiMediaPlanningService } from './services/ai-media-planning.js';
import { createSourceCaptureViewService } from './services/source-capture-view.js';
import { createExtensionSourceWorkbenchService } from './services/extension-source-workbench.js';
import { PrismaAiMediaWorkflowRepository } from './repositories/ai-media-workflow-repository.js';
import { PrismaAiImageJobRepository } from './repositories/ai-image-job-repository.js';
import { createAiMediaWorkflowService } from './services/ai-media-workflows.js';
import {
  AiMediaContextError,
  createAiMediaContextService,
} from './services/ai-media-context.js';
import { createExtensionMediaWorkflowCommandExecutor } from './services/extension-media-workflow-commands.js';
import {
  createExtensionMediaApplyCommandExecutor,
  createExtensionMediaReviewCommandExecutor,
} from './services/extension-media-review-commands.js';
import {
  createExtensionAiImageSuitePostCommitRunner,
  createExtensionAiImageSuiteApplyCommandExecutor,
  createExtensionAiImageSuiteExecuteCommandExecutor,
  createExtensionAiImageSuiteReviewCommandExecutor,
  ExtensionAiImageSuiteCommandError,
} from './services/extension-ai-image-suite-commands.js';
import { isExtensionAiImageExecutionModeConflict } from './services/extension-ai-image-execution-mode.js';
import {
  EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION,
  EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION,
  EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION,
} from './services/extension-ai-image-suite.js';
import {
  createExtensionMediaWorkflowLauncher,
  createExtensionMediaTranslationLauncher,
  resolveExtensionMediaWorkflowSourceMediaKey,
  resolveExtensionMediaTranslationReadiness,
  resolveExtensionMediaStandaloneReadiness,
} from './services/extension-media-workflow-launch.js';
import { resolveAiImageTranslationStorageReadiness } from './services/ai-image-translation-storage.js';
import { resolveTrustedAiImageTranslationCategory } from './services/ai-image-translation-glossary.js';
import { resolveAiImageEditStorageReadiness } from './services/ai-image-edit-storage.js';
import { getAiImageEditProviderRuntimeConfig } from './services/ai-image-edit-runtime-config.js';
import { AI_IMAGE_EDIT_MASK_SEMANTICS } from './services/ai-image-compositor.js';
import { createAiImageEditMask } from './services/ai-image-edit.js';
import type { AiImageProviderRuntimeContract } from './services/ai-image-provider-runtime-contract.js';
import { uploadLimiter } from './lib/upload-limiter.js';
import { applyAiMediaListingDraftApplication } from './services/ai-media-listing-draft-application-mutations.js';
import {
  createSourceOzonCategoryMappingService,
  PrismaSourceOzonCategoryMappingRepository,
} from './services/source-ozon-category-mapping.js';
import {
  createSourceOzonCategoryContextLoader,
  PrismaSourceOzonCategoryContextRepository,
} from './services/source-ozon-category-context.js';
import {
  createPrismaOzonCategoryCatalogSnapshotStore,
  getOrRefreshOzonCategoryCatalogSnapshotForShop,
  requireFreshOzonCategoryCatalogSnapshotForShop,
} from './services/ozon-category-catalog.js';
import type { OzonClient, OzonImportItem } from './services/ozon-client.js';
import { createOzonListingPublisher } from './services/ozon-listing-publisher.js';
import { createExtensionOzonPublishExecutor } from './services/extension-ozon-publish-execution.js';
import {
  createExtensionByokPublishAuthorizer,
} from './services/extension-byok-publish-authorization.js';
import {
  createPrismaExtensionByokPublishProvenanceReader,
} from './repositories/extension-byok-media-provenance-repository.js';
import {
  createPrismaExtensionByokPublishStatusRepository,
} from './repositories/extension-byok-publish-status-repository.js';
import {
  createExtensionByokListingPublishService,
} from './services/extension-byok-listing-publish.js';
import {
  createExtensionWorkbenchListingPublishService,
} from './services/extension-workbench-listing-publish.js';
import {
  createExtensionWorkbenchByokPublishProvenanceService,
} from './services/extension-workbench-byok-publish-provenance.js';
import { createPrismaOzonPublishAttemptRepository } from './services/ozon-publish-attempt-prisma.js';
import {
  createOzonListingProductionCompileAdapter,
  type OzonListingProductionCompileAdapterOptions,
} from './services/ozon-listing-production-compile-adapter.js';
import {
  createOzonListingProductionCompileCache,
  preflightOzonListingProductionCompile,
} from './services/ozon-listing-production-compile-cache.js';
import { createOzonPublisherEntrypointParityObserver } from './services/ozon-publisher-entrypoint-parity-shadow.js';
import { createPrismaOzonPublisherRolloutRecorder } from './services/ozon-publisher-rollout-recorder.js';
import { createOzonPublisherParityObservationService } from './services/ozon-publisher-parity-observations.js';
import { createPrismaOzonPublisherParityObservationRepository } from './services/ozon-publisher-parity-prisma.js';
import { getConfig, getStrictConfigSnapshot } from './config/system-config-schema.js';
import {
  createExtensionByokPolicyEvaluator,
} from './services/extension-byok-policy.js';
import {
  createExtensionByokSystemConfigPolicyLoader,
  EXTENSION_BYOK_CONFIG_KEYS,
} from './services/extension-byok-admin-controls.js';
import { generateProductContentDraft } from './services/product-content-ai.js';
import { generateAiText } from './services/ai-text.js';
import { createPrismaAiTranslationCacheStore } from './services/ai-translation-cache.js';
import { createPrismaAiUsageStore } from './services/ai-usage.js';
import { runOzonPublishReconciliationTick } from './services/ozon-publish-reconciliation.js';
import type { OzonListingDraft, SourceProductCaptureV2 } from 'shared';
import { createExtensionDeviceSessionService } from './services/extension-device-session.js';
import { createPrismaExtensionDeviceSessionRepository } from './services/extension-device-session-prisma.js';
import { createPrismaExtensionDeviceShopRepository } from './services/extension-device-shop-prisma.js';
import {
  createExtensionCommandGrantService,
  digestExtensionCommandGrantToken,
  resolveExtensionCommandGrantSecret,
} from './services/extension-command-grants.js';
import {
  createPrismaExtensionCommandGrantStore,
} from './services/extension-command-grants-prisma.js';
import { inspectByokMediaIngestGrant } from './services/extension-byok-media-ingest-grant.js';
import { createPrismaExtensionByokUploadStagingStore } from './services/extension-byok-upload-staging.js';
import { createPrismaExtensionByokIngestRateLimiter } from './services/extension-byok-ingest-rate-limit.js';
import { createExtensionByokExecutionIntentService } from './services/extension-byok-execution-intent.js';
import { createPrismaExtensionByokExecutionIntentRepository } from './services/extension-byok-execution-intent-prisma.js';
import { createExtensionByokExecutionBatchService } from './services/extension-byok-execution-batch.js';
import { createPrismaExtensionByokExecutionBatchRepository } from './services/extension-byok-execution-batch-prisma.js';
import {
  authenticateExtensionDevice,
  isExtensionDeviceAuthEnabled,
  isLogisticsDistributionEnabled,
  resolveExtensionDeviceAuthConfig,
} from './lib/extension-device-auth.js';
import { adminLogisticsRuleRoutes } from './routes/admin-logistics-rules.js';
import { createLogisticsRuleAdminService } from './services/logistics-rule-admin.js';
import { createPrismaLogisticsRuleAdminRepository } from './services/logistics-rule-admin-prisma.js';
import {
  adminLogisticsInputUnitContractRoutes,
} from './routes/admin-logistics-input-unit-contracts.js';
import { createOfficialInputUnitContractService } from './services/logistics-official-input-unit-contract.js';
import {
  createPrismaOfficialInputUnitContractRepository,
} from './services/logistics-official-input-unit-contract-prisma.js';
import {
  adminLogisticsCaptureTaskRoutes,
  logisticsCaptureTaskRoutes,
} from './routes/logistics-capture-tasks.js';
import { createLogisticsCaptureTaskService } from './services/logistics-capture-task.js';
import { createPrismaLogisticsCaptureTaskRepository } from './services/logistics-capture-task-prisma.js';
import { createReviewedCaptureDraftService } from './services/logistics-capture-draft.js';
import { logisticsRuleRoutes } from './routes/logistics-rules.js';
import { createPrismaLogisticsRuleDeviceRepository } from './services/logistics-rule-device-prisma.js';
import {
  adminLogisticsScopeBootstrapRoutes,
  logisticsScopeBootstrapDeviceRoutes,
} from './routes/logistics-scope-bootstrap.js';
import { createLogisticsScopeBootstrapService } from './services/logistics-scope-bootstrap.js';
import {
  createPrismaLogisticsScopeBootstrapRepository,
} from './services/logistics-scope-bootstrap-prisma.js';
import { getRuntimeConfig } from './adapters/runtime-config.js';

import { isAllowedCorsOrigin } from './lib/cors.js';
import { registerMaintenanceHook } from './lib/maintenance.js';

const app = Fastify({
  bodyLimit: 1 * 1024 * 1024,
  // Nginx is the single trusted hop in production. Trusting an arbitrary XFF
  // chain lets direct-origin clients spoof request.ip and bypass IP quotas.
  trustProxy: process.env.NODE_ENV === 'production' ? '127.0.0.1' : false,
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.x-ss-erp-command-grant',
        'headers.authorization',
        'headers.x-ss-erp-command-grant',
      ],
      censor: '[REDACTED]',
    },
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

await app.register(helmet);
await app.register(cookie);
await app.register(cors, {
  origin: function (origin, cb) {
    if (isAllowedCorsOrigin(origin)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  credentials: true,
});
await app.register(rateLimit, {
  max: 200,
  timeWindow: '1 minute',
});
registerMaintenanceHook(app);

app.addHook('onClose', async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  const status = error.statusCode || 500;
  if (status >= 500) {
    Sentry.captureException(error, {
      tags: { route: request.routeOptions?.url || request.url, method: request.method },
    });
    request.log.error({ err: error }, 'unhandled error');
  }
  reply.status(status).send({ code: 0, msg: status >= 500 ? '服务器错误' : error.message || '请求失败' });
});

function deployedGitCommit() {
  try {
    const value = readFileSync(join(process.cwd(), '..', '..', 'DEPLOYED_COMMIT'), 'utf8');
    return value.match(/^([a-f0-9]{40})\n?$/u)?.[1] || null;
  } catch {
    return null;
  }
}

app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/ready', async (_request, reply) => {
  const checks: Record<string, string> = {};
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'fail';
  }
  try {
    if (process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true') {
      checks.redis = 'disabled';
    } else {
      await redis.ping();
      checks.redis = 'ok';
    }
  } catch {
    checks.redis = 'fail';
  }
  const healthy = checks.db === 'ok' && (checks.redis === 'ok' || checks.redis === 'disabled');
  const gitCommit = deployedGitCommit();
  return reply.status(healthy ? 200 : 503).send({
    status: healthy ? 'ready' : 'degraded',
    checks,
    ...(gitCommit ? { deployment: { gitCommit } } : {}),
  });
});

await app.register(authRoutes, { prefix: '/api/auth' });
const sourceOzonCategoryMappingService = createSourceOzonCategoryMappingService({
  repository: new PrismaSourceOzonCategoryMappingRepository(prisma),
});
const sourceOzonCategoryContextLoader = createSourceOzonCategoryContextLoader({
  repository: new PrismaSourceOzonCategoryContextRepository(prisma),
});
const sourceOzonCategoryCatalogSnapshotStore = createPrismaOzonCategoryCatalogSnapshotStore(prisma);
const loadCanonicalSourceOzonCategoryContext: NonNullable<CollectRoutesOptions['loadCanonicalSourceOzonCategoryContext']> =
  (input) => sourceOzonCategoryContextLoader.load(input);
const loadAuthoritativeOzonCategoryCatalog: NonNullable<CollectRoutesOptions['loadAuthoritativeOzonCategoryCatalog']> =
  async ({ shopId, fetchTree }) => {
    let result: Awaited<ReturnType<typeof getOrRefreshOzonCategoryCatalogSnapshotForShop>>;
    try {
      result = await getOrRefreshOzonCategoryCatalogSnapshotForShop({ shopId }, {
        store: sourceOzonCategoryCatalogSnapshotStore,
        fetchTree,
      });
    } catch (error) {
      const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(error);
      if (credentialError) throw credentialError;
      throw error;
    }
    const { snapshot } = result;
    if (!snapshot.authoritative || snapshot.stale) {
      const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(result.refreshCause);
      if (credentialError) throw credentialError;
      throw new Error('Current Ozon category catalog snapshot is not authoritative');
    }
    return {
      entries: snapshot.entries,
      categoryTree: [],
      catalogRevision: snapshot.revision,
    };
  };
const sourceListingWorkflowService = createSourceListingWorkflowService({
  repository: createPrismaSourceListingWorkflowRepository({ client: prisma as never }),
});
const sourceListingAiCopyService = createSourceListingAiCopyService({
  workflow: sourceListingWorkflowService,
  executionStore: createPrismaSourceListingAiCopyExecutionStore({ client: prisma as never }),
  loadOwnedSnapshot: async ({ ownerUserId, snapshotId }) => {
    const snapshot = await prisma.sourceCaptureSnapshot.findFirst({
      where: { id: snapshotId, subject: { ownerUserId } },
      select: {
        id: true,
        captureHash: true,
        payloadBytes: true,
        payload: true,
        profileHash: true,
      },
    });
    if (!snapshot) return null;
    return {
      id: snapshot.id,
      captureHash: snapshot.captureHash,
      payloadBytes: snapshot.payloadBytes,
      payload: snapshot.payload as unknown as SourceProductCaptureV2,
      profileHash: snapshot.profileHash,
    };
  },
  resolveTemplate: (input) => aiPromptTemplateRegistry.resolveTemplate(input),
  generateContent: async (input) => {
    const [
      enabled,
      provider,
      baseUrl,
      apiKey,
      model,
      titleModel,
      descriptionModel,
      providerLabel,
      timeoutMs,
      userDailyProductGenerationLimit,
    ] = await Promise.all([
      getConfig('ai_product_generation_enabled'),
      getConfig('ai_provider'),
      getConfig('ai_base_url'),
      getConfig('ai_api_key'),
      getConfig('ai_model'),
      getConfig('ai_product_title_model'),
      getConfig('ai_product_description_model'),
      getConfig('ai_provider_label'),
      getConfig('ai_timeout_ms'),
      getConfig('ai_user_daily_product_generation_limit'),
    ]);
    return generateProductContentDraft({
      item: { id: 'source-listing-copy' },
      actorUserId: input.actorUserId,
      fields: input.fields,
      config: {
        enabled,
        provider,
        baseUrl: String(baseUrl || '').trim(),
        apiKey: String(apiKey || '').trim(),
        model: String(model || '').trim(),
        titleModel: String(titleModel || '').trim(),
        descriptionModel: String(descriptionModel || '').trim(),
        providerLabel: String(providerLabel || '').trim(),
        timeoutMs: Number(timeoutMs) || 30_000,
        titlePrompt: '',
        descriptionPrompt: '',
        userDailyProductGenerationLimit: Number(userDailyProductGenerationLimit) || 0,
      },
      cacheStore: createPrismaAiTranslationCacheStore(prisma),
      usageStore: createPrismaAiUsageStore(prisma),
      generateText: generateAiText,
      promptOverrides: Object.fromEntries(input.fields.map((field) => {
        const prompt = input.prompts[field]!;
        return [field, {
          resolvedPrompt: prompt.resolved.resolvedPrompt,
          resolvedNegativePrompt: prompt.resolved.resolvedNegativePrompt,
          registryAuthority: prompt.registryAuthority,
        }];
      })),
    });
  },
});
const sourceListingWorkflowContext = createPrismaSourceListingWorkflowContextResolver({
  client: prisma,
});
const sourceListingMediaImportStore = createPrismaSourceListingMediaImportStore(prisma);
const sourceListingMediaImportService = createSourceListingMediaImportService({
  ...sourceListingMediaImportStore,
  getStorageBackend,
});
const sourceListingAttributeDefinitionStore = createPrismaOzonAttributeDefinitionCacheStore(prisma);
const sourceListingAttributeDictionaryStore = createPrismaOzonAttributeDictionaryCacheStore(prisma);
const sourceListingOzonClientCache = new Map<string, { client: OzonClient; expiresAt: number }>();

async function loadOwnedSourceListingOzonClient(ownerUserId: string, shopId: string): Promise<OzonClient> {
  const cacheKey = `${ownerUserId}:${shopId}`;
  const cached = sourceListingOzonClientCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.client;
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
  const client = createSourceWorkflowOzonClient({
    clientId: shop.clientId,
    apiKeyEncrypted: shop.apiKeyEncrypted,
  });
  sourceListingOzonClientCache.set(cacheKey, { client, expiresAt: Date.now() + 60_000 });
  return client;
}

const sourceListingWorkflowCategoryValidator = createSourceListingWorkflowCategoryValidator({
  loadCatalog: async ({ ownerUserId, shopId }) => {
    const catalog = await loadAuthoritativeOzonCategoryCatalog({
      shopId,
      fetchTree: async (language) => (
        await loadOwnedSourceListingOzonClient(ownerUserId, shopId)
      ).getDescriptionCategoryTree({ language }),
    });
    return { revision: catalog.catalogRevision, entries: catalog.entries };
  },
});

const sourceListingPublishCategoryValidator = createSourceListingWorkflowCategoryValidator({
  loadCatalog: async ({ ownerUserId, shopId }) => {
    const ownedShop = await prisma.shop.findFirst({
      where: { id: shopId, userId: ownerUserId, platform: 'OZON', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!ownedShop) throw new Error('Owned active Ozon shop was not found');
    const snapshot = await requireFreshOzonCategoryCatalogSnapshotForShop({ shopId }, {
      store: sourceOzonCategoryCatalogSnapshotStore,
    });
    return { revision: snapshot.revision, entries: snapshot.entries };
  },
});

async function loadSourceListingAttributeSourceContext(input: {
  ownerUserId: string;
  draft: OzonListingDraft;
}) {
  const snapshot = await prisma.sourceCaptureSnapshot.findFirst({
    where: {
      id: input.draft.sourceCaptureSnapshotId,
      subject: { ownerUserId: input.ownerUserId },
    },
    select: { profile: true, payload: true },
  });
  if (!snapshot) {
    throw Object.assign(new Error('Owned source capture snapshot was not found'), {
      code: 'SOURCE_LISTING_SNAPSHOT_NOT_FOUND',
      statusCode: 404,
    });
  }
  return buildSourceListingAttributeSourceContext({
    capture: snapshot.payload as unknown as SourceProductCaptureV2,
    sourceProfile: snapshot.profile as unknown as SourceProductProfile,
    selectedSkuKeys: input.draft.selectedSkuKeys,
  });
}

function throwShadowAuthorityUnavailable(): never {
  throw Object.assign(new Error('Cached Ozon publish authority is unavailable'), {
    code: 'OZON_LISTING_SHADOW_AUTHORITY_UNAVAILABLE',
  });
}

const sourceListingWorkflowAttributeService = createSourceListingWorkflowAttributeService({
  loadSchema: async ({ ownerUserId, draft, category, freshness }) => {
    const categoryValidator = freshness === 'PUBLISH_CACHE_REQUIRED'
      ? sourceListingPublishCategoryValidator
      : sourceListingWorkflowCategoryValidator;
    await categoryValidator.validate({
      ownerUserId,
      shopId: draft.shopId,
      category,
    });
    const cacheKey = {
      shopId: draft.shopId,
      descriptionCategoryId: category.categoryId,
      typeId: category.typeId,
      language: 'DEFAULT',
      catalogRevision: category.catalogRevision,
    };
    const definitions = await getCachedOzonAttributeDefinitions(cacheKey, {
      store: sourceListingAttributeDefinitionStore,
      forceRefresh: freshness === 'OFFICIAL_REFRESH_REQUIRED',
      cacheOnly: freshness === 'PUBLISH_CACHE_REQUIRED',
      fetchDefinitions: async () => (
        await loadOwnedSourceListingOzonClient(ownerUserId, draft.shopId)
      ).getDescriptionCategoryAttributes({
          description_category_id: category.categoryId,
          type_id: category.typeId,
          language: 'DEFAULT',
        }),
    });
    return buildOzonAttributeSchema({ cacheKey, definitionCache: definitions });
  },
  loadDictionary: async ({ ownerUserId, draft, schema, field, freshness }) => {
    const dictionary = await getCachedOzonAttributeValues({
      description_category_id: schema.descriptionCategoryId,
      type_id: schema.typeId,
      attribute_id: field.attributeId,
      language: schema.language,
      catalogRevision: schema.catalogRevision,
    }, {
      store: sourceListingAttributeDictionaryStore,
      forceRefresh: freshness === 'OFFICIAL_REFRESH_REQUIRED',
      cacheOnly: freshness === 'PUBLISH_CACHE_REQUIRED',
      fetchPage: async (params) => (
        await loadOwnedSourceListingOzonClient(ownerUserId, draft.shopId)
      ).getAttributeValuesPage({
          description_category_id: params.description_category_id,
          type_id: params.type_id,
          attribute_id: params.attribute_id,
          language: params.language,
          last_value_id: params.last_value_id,
          limit: params.limit,
        }),
    });
    return {
      complete: dictionary.complete === true,
      values: dictionary.values,
      source: dictionary.source,
      ...(dictionary.warning ? { warning: dictionary.warning } : {}),
    };
  },
  searchDictionary: async ({ ownerUserId, draft, schema, field, queries }) => {
    const client = await loadOwnedSourceListingOzonClient(ownerUserId, draft.shopId);
    const resultSets = await Promise.all(
      [...new Set(queries.map((value) => String(value || '').normalize('NFKC').trim()).filter(Boolean))]
        .slice(0, 5)
        .map((value) => client.searchAttributeValues({
          description_category_id: schema.descriptionCategoryId,
          type_id: schema.typeId,
          attribute_id: field.attributeId,
          language: schema.language,
          value,
          limit: 100,
        })),
    );
    const values = [...new Map(resultSets.flat().map((entry) => [Number(entry.id), entry])).values()]
      .filter((entry) => Number.isSafeInteger(Number(entry.id)) && Number(entry.id) > 0)
      .slice(0, 500);
    return {
      scope: 'SEARCH_RESULTS' as const,
      catalogRevision: schema.catalogRevision,
      values,
      source: 'ozon_api' as const,
      resultExhaustive: resultSets.every((items) => items.length < 100),
    };
  },
  loadSourceContext: loadSourceListingAttributeSourceContext,
  dictionaryAliases: sourceStandardDictionaryAliases,
});
const sourceListingShadowAttributeService = createSourceListingWorkflowAttributeService({
  loadSchema: async ({ draft, category }) => {
    const cacheKey = {
      shopId: draft.shopId,
      descriptionCategoryId: category.categoryId,
      typeId: category.typeId,
      language: 'DEFAULT',
      catalogRevision: category.catalogRevision,
    };
    const definitions = await getCachedOzonAttributeDefinitions(cacheKey, {
      store: sourceListingAttributeDefinitionStore,
      fetchDefinitions: async () => throwShadowAuthorityUnavailable(),
    });
    if (definitions.source !== 'cache'
      || definitions.complete !== true
      || definitions.warning) {
      throwShadowAuthorityUnavailable();
    }
    return buildOzonAttributeSchema({ cacheKey, definitionCache: definitions });
  },
  loadDictionary: async ({ schema, field }) => {
    const dictionary = await getCachedOzonAttributeValues({
      description_category_id: schema.descriptionCategoryId,
      type_id: schema.typeId,
      attribute_id: field.attributeId,
      language: schema.language,
      catalogRevision: schema.catalogRevision,
    }, {
      store: sourceListingAttributeDictionaryStore,
      fetchPage: async () => throwShadowAuthorityUnavailable(),
    });
    if (dictionary.source !== 'cache'
      || dictionary.complete !== true
      || dictionary.warning) {
      throwShadowAuthorityUnavailable();
    }
    return {
      complete: true,
      values: dictionary.values,
      source: dictionary.source,
    };
  },
  loadSourceContext: loadSourceListingAttributeSourceContext,
  dictionaryAliases: sourceStandardDictionaryAliases,
});
const sourceOzonPublishAttemptRepository = createPrismaOzonPublishAttemptRepository({
  client: prisma as never,
});
const sourceOzonPublisherParityObservationRepository =
  createPrismaOzonPublisherParityObservationRepository({ client: prisma as never });
const sourceOzonPublisherParityObservationService =
  createOzonPublisherParityObservationService({
    repository: sourceOzonPublisherParityObservationRepository,
  });
const sourceOzonPublisherRolloutRecorder = createPrismaOzonPublisherRolloutRecorder({
  client: prisma as never,
});
const ozonPublisherRolloutAdminService = createOzonPublisherRolloutAdminService({
  repository: createPrismaOzonPublisherRolloutAdminRepository({
    client: prisma as never,
    loadControlSnapshot: (tx, input) => loadPrismaOzonPublisherRolloutControlSnapshot(
      tx as never,
      input,
    ),
  }),
});
const ozonPublisherRolloutReadinessService = createOzonPublisherRolloutReadinessService({
  repository: createPrismaOzonPublisherRolloutReadinessRepository({
    client: prisma as never,
    loadControlSnapshot: (tx, input) => loadPrismaOzonPublisherRolloutControlSnapshot(
      tx as never,
      input,
    ),
  }),
});
const ozonPublisherEntrypointRolloutService = createOzonPublisherEntrypointRolloutService({
  featureFlags: sourceWorkflowFeatureFlags,
  loadReadiness: (input) => ozonPublisherRolloutReadinessService.loadReadiness(input),
});
const sourceOzonListingCompileAuthorityLoaders: Pick<
  OzonListingProductionCompileAdapterOptions,
  'loadOwnedCapture' | 'loadCurrentCatalogAuthority' | 'loadOwnedMediaAssets'
> = {
  loadOwnedCapture: async ({ ownerUserId, snapshotId }) => {
    const snapshot = await prisma.sourceCaptureSnapshot.findFirst({
      where: { id: snapshotId, subject: { ownerUserId } },
      select: {
        id: true,
        captureHash: true,
        payload: true,
        subject: { select: { ownerUserId: true } },
      },
    });
    if (!snapshot) return null;
    return {
      snapshotId: snapshot.id,
      ownerUserId: snapshot.subject.ownerUserId,
      captureHash: snapshot.captureHash,
      capture: snapshot.payload as unknown as SourceProductCaptureV2,
    };
  },
  loadCurrentCatalogAuthority: async ({ ownerUserId, shopId }) => {
    const ownedShop = await prisma.shop.findFirst({
      where: { id: shopId, userId: ownerUserId, platform: 'OZON', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!ownedShop) return null;
    const snapshot = await sourceOzonCategoryCatalogSnapshotStore.find(shopId);
    if (!snapshot) return null;
    const current = await prisma.ozonCategoryCatalogSnapshot.findFirst({
      where: { shopId, revision: snapshot.revision, isCurrent: true },
      select: { id: true },
    });
    if (!current) return null;
    return { snapshotId: current.id, shopId, snapshot };
  },
  loadOwnedMediaAssets: ({ ownerUserId, assetIds }) => prisma.mediaAsset.findMany({
    where: { ownerUserId, id: { in: assetIds } },
    select: {
      id: true,
      ownerUserId: true,
      url: true,
      storageBackend: true,
      storageKey: true,
      mimeType: true,
    },
  }),
};
const sourceOzonListingProductionCompileOptions: OzonListingProductionCompileAdapterOptions = {
  ...sourceOzonListingCompileAuthorityLoaders,
  loadAuthoritativeValidation: ({ ownerUserId, draft }) => (
    sourceListingWorkflowAttributeService.validateForPublish({ ownerUserId, draft })
  ),
};
const sourceOzonListingProductionCompileUncached = createOzonListingProductionCompileAdapter(
  sourceOzonListingProductionCompileOptions,
);
const sourceOzonListingProductionCompile = createOzonListingProductionCompileCache({
  compile: sourceOzonListingProductionCompileUncached,
});
const sourceOzonListingShadowCompile = createOzonListingProductionCompileAdapter({
  ...sourceOzonListingCompileAuthorityLoaders,
  loadAuthoritativeValidation: ({ ownerUserId, draft }) => (
    sourceListingShadowAttributeService.validateAuthoritative({ ownerUserId, draft })
  ),
});
const sourceOzonPublisherEntrypointParityObserver = createOzonPublisherEntrypointParityObserver({
  beginAttempt: (input) => sourceOzonPublisherRolloutRecorder.begin(input),
  failAttempt: (input) => sourceOzonPublisherRolloutRecorder.fail(input),
  loadDraft: ({ draftId, ownerUserId }) => sourceListingWorkflowService.getDraft({
    draftId,
    ownerUserId,
  }),
  loadSkuAliases: async ({ ownerUserId, draft }) => {
    const snapshot = await prisma.sourceCaptureSnapshot.findFirst({
      where: {
        id: draft.sourceCaptureSnapshotId,
        subject: { ownerUserId },
      },
      select: { payload: true },
    });
    const capture = snapshot?.payload as unknown as SourceProductCaptureV2 | undefined;
    if (!capture || capture.captureVersion !== 'source-product-capture-v2' || !Array.isArray(capture.skus)) {
      return [];
    }
    if (capture.skus.length === 0) {
      return [{
        skuKey: draft.selectedSkuKeys[0] || '',
        aliases: [draft.selectedSkuKeys[0] || ''],
      }];
    }
    return capture.skus.map((sku) => ({
      skuKey: sku.key,
      aliases: [sku.key, sku.sourceSkuId || ''].filter(Boolean),
    }));
  },
  compile: sourceOzonListingShadowCompile,
  record: async (diagnostic) => {
    const retentionDays = await getConfig('retention_ozon_publisher_parity_days');
    const stored = await sourceOzonPublisherParityObservationService.recordObservation({
      scopeHash: diagnostic.scopeHash,
      rolloutRevision: diagnostic.rolloutRevision,
      report: diagnostic.report,
      eligibleAttemptKey: diagnostic.eligibleAttemptKey,
      retentionDays,
    });
    if (diagnostic.eligibleAttemptKey) {
      await sourceOzonPublisherRolloutRecorder.complete({
        eligibleAttemptKey: diagnostic.eligibleAttemptKey,
        observation: stored.observation,
      });
    }
    app.log.info({
      ozonPublisherEntrypointParity: {
        observationId: stored.observation.id,
        created: stored.created,
        entrypoint: stored.observation.entrypoint,
        status: stored.observation.report.status,
        classification: stored.observation.report.classification,
        differenceSubjectKey: stored.observation.differenceSubjectKey,
      },
    }, 'Ozon publisher parity observed');
  },
  warn: (message) => app.log.warn(message),
});
const sourceOzonPublisherInstanceId = String(
  process.env.INSTANCE_ID || process.env.HOSTNAME || process.env.COMPUTERNAME || 'server',
).normalize('NFKC').trim().slice(0, 80) || 'server';
const loadExtensionByokPolicy = createExtensionByokSystemConfigPolicyLoader({
  readSnapshot: () => getStrictConfigSnapshot(EXTENSION_BYOK_CONFIG_KEYS),
});
const extensionByokPolicyEvaluator = createExtensionByokPolicyEvaluator({
  loadPolicy: loadExtensionByokPolicy,
});
const extensionByokPublishAuthorizer = createExtensionByokPublishAuthorizer({
  loadPolicy: loadExtensionByokPolicy,
  ...createPrismaExtensionByokPublishProvenanceReader(prisma),
});
const sourceOzonListingPublisher = createOzonListingPublisher({
  workflow: sourceListingWorkflowService,
  attempts: sourceOzonPublishAttemptRepository,
  compile: sourceOzonListingProductionCompile,
  authorizeDraftMediaPublish: extensionByokPublishAuthorizer,
  submitImportOnce: async ({ ownerUserId, shopId, requestPayload }) => {
    if (!Array.isArray(requestPayload.items)) {
      throw new Error('Persisted Ozon publish request has no item array');
    }
    const client = await loadOwnedSourceListingOzonClient(ownerUserId, shopId);
    return client.importProductsOnce(requestPayload.items as unknown as OzonImportItem[]);
  },
  workerId: `ozon-publish-submit:${sourceOzonPublisherInstanceId}:${process.pid}`,
  warn: (message, error) => app.log.warn({ err: error }, message),
});
const executeExtensionOzonPublish = createExtensionOzonPublishExecutor({
  publisher: sourceOzonListingPublisher,
  attempts: sourceOzonPublishAttemptRepository,
});
const extensionDeviceRepository = isExtensionDeviceAuthEnabled()
  ? createPrismaExtensionDeviceSessionRepository()
  : null;
const getAiImageSuiteCostControls = async () => {
  const [dailyLimit, globalDailyBudgetCents] = await Promise.all([
    getConfig('ai_user_daily_image_generation_limit'),
    getConfig('ai_daily_budget_cents'),
  ]);
  return { dailyLimit, globalDailyBudgetCents };
};
const getAiImageSuiteProviderRuntime = async () => {
  const [provider, baseUrl, apiKey, model, costPerImageCents] = await Promise.all([
    getConfig('ai_image_provider'),
    getConfig('ai_image_base_url'),
    getConfig('ai_image_api_key'),
    getConfig('ai_image_model'),
    getConfig('ai_image_generation_cost_cents'),
  ]);
  return createAiImageSuiteProviderRuntimeSnapshot({
    provider,
    baseUrl,
    apiKey,
    model,
    costPerImageCents,
  });
};
const requireAiImageSuiteProviderRuntime = async () => {
  const snapshot = await getAiImageSuiteProviderRuntime();
  if (!snapshot.providerConfig) {
    throw new Error(snapshot.reason);
  }
  return snapshot;
};
const requireAiImageSuiteExecutionRuntime = async () => {
  const snapshot = await requireAiImageSuiteProviderRuntime();
  if (!snapshot.executionReady || !aiImageSuiteGenerationQueue) {
    throw new Error(snapshot.executionReady
      ? 'AI image suite generation queue is unavailable'
      : snapshot.reason);
  }
  return snapshot;
};
type AiImageSuiteRuntimeIdentity = {
  provider: string;
  model: string;
  providerConfigHash: string;
  pricingVersion: string;
  concurrencyLimit: number;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
};
const aiImageSuiteRuntimeEvidence = async (suite: AiImageSuiteRuntimeIdentity) => {
  if (!aiImageSuiteGenerationQueue) return null;
  const snapshot = await getAiImageSuiteProviderRuntime();
  if (!snapshot.executionReady || !aiImageSuiteProviderRuntimeMatches(suite, snapshot)) return null;
  return snapshot.capability?.evidenceLevel === 'sandbox-verified'
    ? 'sandbox-verified' as const
    : snapshot.capability?.evidenceLevel === 'local-test'
      ? 'local-test' as const
      : null;
};
const aiImageSuiteRuntimeReady = async (suite: AiImageSuiteRuntimeIdentity) => (
  Boolean(await aiImageSuiteRuntimeEvidence(suite))
);
let sourceCaptureService: ReturnType<typeof createSourceCaptureService> | null = null;
if (isExtensionDeviceAuthEnabled()) {
  if (!extensionDeviceRepository) throw new Error('Extension device repository is unavailable');
  const extensionDeviceAuthConfig = resolveExtensionDeviceAuthConfig();
  const extensionCommandGrantSecret = resolveExtensionCommandGrantSecret();
  const extensionMediaWorkflowService = createAiMediaWorkflowService(
    new PrismaAiMediaWorkflowRepository(prisma),
  );
  const extensionAiImageSuiteService = createAiImageSuiteService(
    new PrismaAiImageSuiteRepository(prisma),
  );
  const extensionHostedAiImagePlanBindings =
    createPrismaExtensionHostedAiImagePlanBindingStore(prisma);
  const extensionHostedAiImageAuthority =
    createPrismaExtensionHostedAiImageAuthorityLoader(prisma);
  const extensionHostedAiImageModeLockLoader =
    createPrismaExtensionHostedAiImageModeLockLoader(prisma);
  const evaluateExtensionHostedAiImagePolicy =
    createExtensionHostedAiImagePolicyEvaluator();
  const extensionHostedAiImageModeLockService =
    createExtensionHostedAiImageModeLockService({
      loadAuthority: (input) => extensionHostedAiImageAuthority.loadPlanAuthority(input),
      hasHostedSuite: (input) => extensionHostedAiImageModeLockLoader.hasHostedSuite(input),
      evaluatePolicy: evaluateExtensionHostedAiImagePolicy,
    });
  const findExtensionHostedAiImageRecoveryBinding = async (
    input: Parameters<typeof extensionHostedAiImageModeLockService.get>[0],
  ) => {
    const authority = await extensionHostedAiImageAuthority.loadPlanAuthority({
      ownerUserId: input.identity.ownerUserId,
      listingWorkflowId: input.binding.listingWorkflowId,
    });
    if (!authority
      || authority.ownerUserId !== input.identity.ownerUserId
      || authority.snapshotId !== input.binding.snapshotId
      || authority.supplyGoodsId !== input.binding.supplyGoodsId
      || authority.shopId !== input.binding.shopId
      || authority.listingWorkflowId !== input.binding.listingWorkflowId
      || authority.draftRevision !== input.binding.draftRevision
      || authority.draftVersion !== input.binding.draftVersion
      || authority.sourceCaptureCurrent !== true
      || authority.workflowStatus !== 'ACTIVE'
      || authority.draftStage !== 'MEDIA_REVIEW') return null;
    const lookupRecord = createExtensionHostedAiImagePlanBindingRecord({
      planId: 'hosted-plan-binding-recovery-lookup',
      identity: input.identity,
      binding: input.binding,
      selectedSkuKeys: [...authority.selectedSkuKeys].sort(),
      candidateMediaKeys: [...authority.candidateMediaKeys].sort(),
    });
    const {
      planId: _lookupPlanId,
      authorityHash: _lookupAuthorityHash,
      bindingHash: _lookupBindingHash,
      ...bindingLookup
    } = lookupRecord;
    return extensionHostedAiImagePlanBindings.find(bindingLookup);
  };
  const loadExtensionHostedAiImageReadPolicy = async (
    input: Parameters<typeof extensionHostedAiImageModeLockService.get>[0],
  ) => {
    const modeLock = await extensionHostedAiImageModeLockService.get(input);
    if (modeLock.hostedExecutionEnabled) {
      return { readEnabled: true, writeEnabled: true };
    }
    if (modeLock.state !== 'HAS_SUITE') {
      return { readEnabled: false, writeEnabled: false };
    }
    const hostedFeatureEnabled = await getConfig('feature_extension_hosted_ai');
    if (hostedFeatureEnabled !== false) {
      return { readEnabled: false, writeEnabled: false };
    }
    const recoveryBinding = await findExtensionHostedAiImageRecoveryBinding(input);
    const currentSuite = recoveryBinding
      ? await extensionAiImageSuiteService.getCurrentByPlan(
        recoveryBinding.planId,
        input.identity.ownerUserId,
      )
      : null;
    return {
      readEnabled: Boolean(currentSuite),
      writeEnabled: false,
    };
  };
  const extensionHostedAiImagePlanningService =
    createAiMediaPlanningService(new PrismaAiMediaPlanningRepository(prisma));
  const extensionHostedAiImagePlanService = createExtensionHostedAiImagePlanService({
    planning: extensionHostedAiImagePlanningService,
    bindings: extensionHostedAiImagePlanBindings,
    loadAuthority: (input) => extensionHostedAiImageAuthority.loadPlanAuthority(input),
    evaluatePolicy: evaluateExtensionHostedAiImagePolicy,
  });
  const extensionHostedAiImageReadPlanCore = createExtensionHostedAiImagePlanService({
    planning: extensionHostedAiImagePlanningService,
    bindings: extensionHostedAiImagePlanBindings,
    loadAuthority: (input) => extensionHostedAiImageAuthority.loadPlanAuthority(input),
    evaluatePolicy: async (input) => {
      const decision = await evaluateExtensionHostedAiImagePolicy(input);
      if (!decision
        || typeof decision.enabled !== 'boolean'
        || !Number.isSafeInteger(decision.revision)
        || decision.revision < 1
        || decision.ownerUserId !== input.ownerUserId
        || decision.shopId !== input.shopId
        || decision.deviceSessionId !== input.deviceSessionId) {
        throw new Error('Hosted AI image read policy is unavailable');
      }
      return decision.enabled ? decision : { ...decision, enabled: true };
    },
  });
  const extensionHostedAiImageReadPlanService = {
    get: extensionHostedAiImageReadPlanCore.get,
    getCurrent: extensionHostedAiImageReadPlanCore.getCurrent,
  };
  const extensionHostedAiImagePlanRouteService = {
    create: (input: Parameters<typeof extensionHostedAiImagePlanService.create>[0]) => (
      extensionHostedAiImagePlanService.create(input)
    ),
    get: async (input: Parameters<typeof extensionHostedAiImagePlanService.get>[0]) => {
      const readPolicy = await loadExtensionHostedAiImageReadPolicy({
        identity: input.identity,
        binding: input.binding,
      });
      return readPolicy.readEnabled && !readPolicy.writeEnabled
        ? extensionHostedAiImageReadPlanService.get(input)
        : extensionHostedAiImagePlanService.get(input);
    },
    getCurrent: async (input: Parameters<typeof extensionHostedAiImagePlanService.getCurrent>[0]) => {
      const readPolicy = await loadExtensionHostedAiImageReadPolicy({
        identity: input.identity,
        binding: input.binding,
      });
      return readPolicy.readEnabled && !readPolicy.writeEnabled
        ? extensionHostedAiImageReadPlanService.getCurrent(input)
        : extensionHostedAiImagePlanService.getCurrent(input);
    },
    review: (input: Parameters<typeof extensionHostedAiImagePlanService.review>[0]) => (
      extensionHostedAiImagePlanService.review(input)
    ),
  };
  const extensionHostedCandidatePreviewService = createExtensionHostedCandidatePreviewService({
    loadCurrentCandidate: async (input) => {
      const readPolicy = await loadExtensionHostedAiImageReadPolicy({
        identity: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.ownerUserId,
          deviceSessionId: input.deviceSessionId,
        },
        binding: {
          snapshotId: input.binding.snapshotId,
          supplyGoodsId: input.binding.supplyGoodsId,
          shopId: input.binding.shopId,
          listingWorkflowId: input.binding.listingWorkflowId,
          draftRevision: input.binding.draftRevision,
          draftVersion: input.binding.draftVersion,
        },
      });
      return readPolicy.readEnabled
        ? extensionHostedAiImageAuthority.loadCandidateAuthority(input)
        : null;
    },
  });
  const extensionHostedListingAssignmentCore =
    createHostedSuiteListingDraftAssignmentService(
      createPrismaHostedSuiteListingDraftAssignmentRepository(prisma as never),
    );
  const extensionHostedListingAssignmentService = {
    assign: async (input: Parameters<typeof extensionHostedListingAssignmentCore.assign>[0]) => {
      const decision = await evaluateExtensionHostedAiImagePolicy({
        ownerUserId: input.ownerUserId,
        shopId: input.shopId,
        deviceSessionId: input.deviceSessionId,
      });
      if (!decision.enabled) throw new Error('Hosted listing assignment policy is disabled');
      return extensionHostedListingAssignmentCore.assign(input);
    },
  };
  const extensionMediaContextService = createAiMediaContextService(prisma);
  const extensionMediaJobRepository = new PrismaAiImageJobRepository(prisma);
  const loadExtensionMediaTranslationExistingWorkflow = async ({
    ownerUserId,
    idempotencyKey,
  }: {
    ownerUserId: string;
    idempotencyKey: string;
  }) => {
    const row = await prisma.aiMediaWorkflow.findFirst({
      where: { ownerUserId, idempotencyKey, suiteSlot: { is: null } },
      select: {
        id: true,
        ownerUserId: true,
        operation: true,
        status: true,
        revision: true,
        contextType: true,
        contextId: true,
        contextDraftRevision: true,
        contextDraftVersion: true,
        suiteSlot: { select: { suiteId: true } },
        inputs: {
          orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
          select: {
            role: true,
            ordinal: true,
            asset: { select: { id: true, sourceMediaKey: true, metadata: true } },
          },
        },
        jobs: {
          orderBy: [{ workflowAttempt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            provider: true,
            model: true,
            prompt: true,
            negativePrompt: true,
            estimatedCostCents: true,
            operationConfig: true,
          },
        },
      },
    });
    if (!row) return null;
    const sourceInputs = row.inputs.filter((item) => item.role === 'REFERENCE');
    const sourceMediaKeys = sourceInputs.flatMap((item) => {
      const sourceMediaKey = resolveExtensionMediaWorkflowSourceMediaKey(item.asset);
      return sourceMediaKey ? [sourceMediaKey] : [];
    });
    const maskAssetId = row.inputs.find((item) => item.role === 'MASK')?.asset.id || null;
    const sourceAsset = sourceInputs[0]?.asset;
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      operation: String(row.operation),
      provider: row.jobs[0]?.provider || null,
      model: row.jobs[0]?.model || null,
      status: String(row.status),
      revision: row.revision,
      contextType: row.contextType,
      contextId: row.contextId,
      contextDraftRevision: row.contextDraftRevision,
      contextDraftVersion: row.contextDraftVersion,
      suiteId: row.suiteSlot?.suiteId || null,
      sourceMediaKey: resolveExtensionMediaWorkflowSourceMediaKey(sourceAsset),
      sourceMediaKeys,
      maskAssetId,
      prompt: row.jobs[0]?.prompt || null,
      negativePrompt: row.jobs[0]?.negativePrompt || null,
      estimatedCostCents: row.jobs[0]?.estimatedCostCents ?? null,
      providerRuntimeContract: (() => {
        const operationConfig = row.jobs[0]?.operationConfig;
        if (!operationConfig || typeof operationConfig !== 'object' || Array.isArray(operationConfig)) {
          return null;
        }
        const candidate = row.operation === 'IMAGE_TO_IMAGE'
          ? operationConfig
          : (operationConfig as Record<string, unknown>).providerRuntime;
        return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? candidate as AiImageProviderRuntimeContract
          : null;
      })(),
      jobId: row.jobs[0]?.id || null,
    };
  };
  const loadExtensionMediaTranslationContext = async ({
    ownerUserId,
    listingWorkflowId,
    draftRevision,
    draftVersion,
  }: {
    ownerUserId: string;
    listingWorkflowId: string;
    draftRevision: number;
    draftVersion: number;
  }) => {
    try {
      const draft = await sourceListingWorkflowService.getDraft({
        draftId: listingWorkflowId,
        ownerUserId,
      });
      const context = await extensionMediaContextService.loadListingDraft(
        ownerUserId,
        listingWorkflowId,
        { expectedRevision: draftRevision, expectedDraftVersion: draftVersion },
      );
      if (draft.revision !== draftRevision || draft.draftVersion !== draftVersion) return null;
      const trustedCategory = resolveTrustedAiImageTranslationCategory(draft);
      const sourceInputs = context.inputs.map((item) => ({
        sourceMediaKey: String(item.sourceMediaKey || '').trim(),
        role: String(item.role || 'unknown').trim() || 'unknown',
        scope: item.scope === 'SKU' ? 'SKU' as const : 'PRODUCT' as const,
        skuKeys: Array.isArray(item.skuKeys) ? [...item.skuKeys] : [],
      })).filter((item) => item.sourceMediaKey);
      return {
        id: draft.id,
        ownerUserId: draft.ownerUserId,
        shopId: draft.shopId,
        supplyGoodsId: draft.supplyGoodsId,
        snapshotId: draft.sourceCaptureSnapshotId,
        revision: draft.revision,
        draftVersion: draft.draftVersion,
        sourceMediaKeys: [...new Set(sourceInputs.map((item) => item.sourceMediaKey))].slice(0, 50),
        sourceInputs: sourceInputs.slice(0, 50),
        ...(trustedCategory ? { category: trustedCategory } : {}),
      };
    } catch (error) {
      if (error instanceof SourceListingWorkflowError) {
        if (error.code === 'OZON_LISTING_DRAFT_NOT_FOUND'
          || error.code === 'OZON_LISTING_DRAFT_VERSION_CONFLICT') return null;
      }
      if (error instanceof AiMediaContextError) {
        if (error.statusCode === 404 || error.statusCode === 409) return null;
      }
      throw error;
    }
  };
  const loadExtensionAiImageSuiteState = async (input: {
    ownerUserId: string;
    deviceSessionId: string;
    snapshotId: string;
    supplyGoodsId: string;
    shopId: string;
    listingWorkflowId: string;
    draftRevision: number;
    draftVersion: number;
  }) => {
    const [context, readPolicy, planAuthority] = await Promise.all([
      loadExtensionMediaTranslationContext({
        ownerUserId: input.ownerUserId,
        listingWorkflowId: input.listingWorkflowId,
        draftRevision: input.draftRevision,
        draftVersion: input.draftVersion,
      }),
      loadExtensionHostedAiImageReadPolicy({
        identity: {
          ownerUserId: input.ownerUserId,
          actorUserId: input.ownerUserId,
          deviceSessionId: input.deviceSessionId,
        },
        binding: {
          snapshotId: input.snapshotId,
          supplyGoodsId: input.supplyGoodsId,
          shopId: input.shopId,
          listingWorkflowId: input.listingWorkflowId,
          draftRevision: input.draftRevision,
          draftVersion: input.draftVersion,
        },
      }),
      extensionHostedAiImageAuthority.loadPlanAuthority({
        ownerUserId: input.ownerUserId,
        listingWorkflowId: input.listingWorkflowId,
      }),
    ]);
    if (!readPolicy.readEnabled || !context || !planAuthority
      || context.snapshotId !== input.snapshotId
      || context.supplyGoodsId !== input.supplyGoodsId
      || context.shopId !== input.shopId
      || planAuthority.ownerUserId !== input.ownerUserId
      || planAuthority.snapshotId !== input.snapshotId
      || planAuthority.supplyGoodsId !== input.supplyGoodsId
      || planAuthority.shopId !== input.shopId
      || planAuthority.listingWorkflowId !== input.listingWorkflowId
      || planAuthority.draftRevision !== input.draftRevision
      || planAuthority.draftVersion !== input.draftVersion) return null;
    const lookupRecord = createExtensionHostedAiImagePlanBindingRecord({
      planId: 'hosted-plan-binding-lookup',
      identity: {
        ownerUserId: input.ownerUserId,
        actorUserId: input.ownerUserId,
        deviceSessionId: input.deviceSessionId,
      },
      binding: {
        snapshotId: input.snapshotId,
        supplyGoodsId: input.supplyGoodsId,
        shopId: input.shopId,
        listingWorkflowId: input.listingWorkflowId,
        draftRevision: input.draftRevision,
        draftVersion: input.draftVersion,
      },
      selectedSkuKeys: [...planAuthority.selectedSkuKeys].sort(),
      candidateMediaKeys: [...planAuthority.candidateMediaKeys].sort(),
    });
    const {
      planId: _lookupPlanId,
      authorityHash: _lookupAuthorityHash,
      bindingHash: _lookupBindingHash,
      ...bindingLookup
    } = lookupRecord;
    const storedBinding = await extensionHostedAiImagePlanBindings.find(bindingLookup);
    const planPromise = storedBinding
      ? prisma.aiMediaPlan.findFirst({
        where: {
          id: storedBinding.planId,
          ownerUserId: input.ownerUserId,
          contextType: 'collect',
          contextId: input.supplyGoodsId,
          reviewStatus: 'APPROVED',
          staleAt: null,
          approvedVersion: { is: { sourceCaptureSnapshotId: input.snapshotId } },
        },
        select: {
          id: true,
          revision: true,
          contextType: true,
          contextId: true,
          reviewStatus: true,
          staleAt: true,
          currentVersionId: true,
          approvedVersionId: true,
          approvedVersion: {
            select: { id: true, sourceCaptureSnapshotId: true, planPayload: true },
          },
        },
      })
      : Promise.resolve(null);
    const [plan, target] = await Promise.all([
      planPromise,
      prisma.supplyGoods.findFirst({
        where: { id: input.supplyGoodsId, userId: input.ownerUserId },
        select: { updatedAt: true },
      }),
    ]);
    const authority = {
      deviceSessionId: input.deviceSessionId,
      snapshotId: input.snapshotId,
      supplyGoodsId: input.supplyGoodsId,
      shopId: input.shopId,
      listingWorkflowId: input.listingWorkflowId,
      draftRevision: input.draftRevision,
      draftVersion: input.draftVersion,
    };
    if (!plan || !plan.approvedVersion) {
      return {
        authority,
        plan: null,
        suite: null,
        targetUpdatedAt: target?.updatedAt.toISOString() || null,
      };
    }
    const currentSuite = await extensionAiImageSuiteService.getCurrentByPlan(
      plan.id,
      input.ownerUserId,
    );
    const providerRuntime = currentSuite ? null : await getAiImageSuiteProviderRuntime();
    const preview = currentSuite
      ? {
        version: 'ai-image-suite-preview/v1',
        planId: plan.id,
        planVersionId: currentSuite.planVersionId,
        planRevision: plan.revision,
        provider: currentSuite.provider,
        model: currentSuite.model,
        providerConfigHash: currentSuite.providerConfigHash,
        pricingVersion: currentSuite.pricingVersion,
        concurrencyLimit: currentSuite.concurrencyLimit,
        itemCount: currentSuite.itemCount,
        estimatedCostCents: currentSuite.estimatedCostCents,
        maximumCostCents: currentSuite.maximumCostCents,
        previewHash: currentSuite.previewHash,
        slots: currentSuite.slots.map((rawSlot) => {
          const slot = rawSlot as Record<string, any>;
          return {
            ordinal: Number(slot.ordinal),
            slotKey: String(slot.slotKey),
            goal: String(slot.goal),
            ownership: {
              level: slot.ownershipLevel,
              key: String(slot.ownershipKey),
            },
            compatibilityGroupKey: slot.compatibilityGroupKey || null,
            references: [],
            estimatedCostCents: Number(slot.estimatedCostCents),
            maximumCostCents: Number(slot.maximumCostCents),
          };
        }),
      }
      : providerRuntime?.providerConfig
        ? await extensionAiImageSuiteService.preview({
          ownerUserId: input.ownerUserId,
          actorUserId: input.ownerUserId,
          planId: plan.id,
          providerConfig: providerRuntime.providerConfig,
        }).catch(() => null)
        : null;
    if (!preview) {
      return {
        authority,
        plan: null,
        suite: null,
        targetUpdatedAt: target?.updatedAt.toISOString() || null,
        executionReady: false,
      };
    }
    const suite = currentSuite ? {
      ...currentSuite,
      slots: currentSuite.slots.map((rawSlot) => {
        const slot = rawSlot as Record<string, any>;
        const workflow = slot.childWorkflow as Record<string, any> | null | undefined;
        const application = Array.isArray(workflow?.applicationMutations)
          ? workflow.applicationMutations[0] || null
          : null;
        return {
          ...slot,
          childWorkflow: workflow ? { ...workflow, application } : null,
        };
      }),
    } : null;
    if (!readPolicy.writeEnabled) {
      return {
        authority,
        plan: { ...plan, skuKey: null, preview },
        suite,
        targetUpdatedAt: target?.updatedAt.toISOString() || null,
        executionReady: false,
      };
    }
    const [authorization, operational, storageRuntime] = await Promise.all([
      getAiImageSuiteDispatchAuthorization(input.ownerUserId),
      probeAiImageSuiteRuntime({
        redis,
        queueAvailable: Boolean(aiImageSuiteGenerationQueue),
      }),
      getRuntimeConfigForStorage(),
    ]);
    const frozenRuntimeReady = currentSuite
      ? await aiImageSuiteRuntimeReady(currentSuite)
      : providerRuntime?.executionReady === true;
    const providerName = currentSuite?.provider || providerRuntime?.providerConfig?.provider;
    const storageReady = providerName === 'fake'
      ? ['local', 'oss'].includes(storageRuntime.imageStorage)
      : storageRuntime.imageStorage === 'oss' && Boolean(storageRuntime.oss);
    return {
      authority,
      plan: { ...plan, skuKey: null, preview },
      suite,
      targetUpdatedAt: target?.updatedAt.toISOString() || null,
      executionReady: readPolicy.writeEnabled
        && authorization.enabled
        && operational.queueReady
        && operational.workerReady
        && frozenRuntimeReady
        && storageReady,
    };
  };
  const loadExtensionAiImageSuitePreviewOrigins = async () => {
    const runtime = await getRuntimeConfigForStorage();
    return [runtime.localBaseUrl, normalizeAiImageSuiteOssCdnDomain(runtime.oss?.cdnDomain)]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
  };
  const loadExtensionAiImageSuiteProjection = async (
    input: Parameters<typeof loadExtensionAiImageSuiteState>[0],
    scopes: string[],
  ) => {
    const state = await loadExtensionAiImageSuiteState(input);
    if (!state) return null;
    return projectExtensionAiImageSuite({
      requested: input,
      state,
      ownerUserId: input.ownerUserId,
      scopes,
      trustedPreviewOrigins: await loadExtensionAiImageSuitePreviewOrigins(),
      allowInsecureLocalPreview: process.env.NODE_ENV !== 'production',
    });
  };
  const extensionAiImageSuiteReferenceService = createAiImageSuiteReferenceService({
    repository: new PrismaAiImageSuiteReferenceRepository(prisma),
    preparationLease: createRedisAiImageSuitePreparationLease({
      redis,
      disabled: redisDisabled,
    }),
    getStorage: async () => {
      const runtime = await getRuntimeConfigForStorage();
      if (runtime.imageStorage === 'ozon-cdn') {
        throw new Error('AI image suite references require local or OSS storage');
      }
      const storage = await getStorageBackend();
      return {
        backend: runtime.imageStorage,
        uploadBuffer: storage.uploadBuffer.bind(storage),
      };
    },
  });
  const extensionAiImageSuitePromptService = createAiImageSuitePromptService({
    repository: new PrismaAiImageSuitePromptRepository(prisma),
    templateResolver: aiPromptTemplateRegistry,
  });
  const extensionAiImageSuiteMaterializationService = createAiImageSuiteMaterializationService(
    new PrismaAiImageSuiteMaterializationRepository(prisma, {
      getCostControls: getAiImageSuiteCostControls,
      getProviderRuntime: async () => getAiImageSuiteProviderRuntime(),
    }),
  );
  const extensionAiImageSuiteExecutionRepository = new PrismaAiImageSuiteExecutionRepository(
    prisma,
    {
      runtimeReady: aiImageSuiteRuntimeReady,
      getCostControls: getAiImageSuiteCostControls,
    },
  );
  const extensionAiImageSuiteExecutionService = createAiImageSuiteExecutionService(
    extensionAiImageSuiteExecutionRepository,
  );
  const extensionAiImageSuiteCandidateService = createAiImageSuiteCandidateService(
    new PrismaAiImageSuiteCandidateRepository(prisma),
  );
  const enqueueExtensionAiImageSuiteFrontier = async (suiteId: string) => {
    const tasks = await extensionAiImageSuiteExecutionRepository.listQueueableTasks(suiteId);
    await Promise.all(tasks.map((task) => enqueueAiImageSuiteGenerationRecoveryJob(task)));
  };
  const commitExtensionAiImageSuiteWithFrontierRecovery =
    createExtensionAiImageSuitePostCommitRunner({
      enqueue: enqueueExtensionAiImageSuiteFrontier,
      onDeferred: (suiteId, error) => app.log.error(
        { err: error, suiteId },
        'AI image suite frontier enqueue deferred to recovery',
      ),
    });
  const getExtensionMediaTranslationSettings = async () => ({
    enabled: await getConfig('feature_image_translate'),
    provider: await getConfig('ai_image_translation_provider'),
    model: await getConfig('ai_image_translation_model'),
    dailyLimit: await getConfig('ai_user_daily_image_translation_limit'),
    estimatedCostCents: await getConfig('ai_image_translation_cost_cents'),
    globalDailyBudgetCents: await getConfig('ai_daily_budget_cents'),
    categoryGlossaryJson: await getConfig('ai_image_translation_category_glossary_json'),
  });
  const getExtensionMediaTranslationStorageReadiness = async () => {
    try {
      return resolveAiImageTranslationStorageReadiness(await getRuntimeConfigForStorage());
    } catch {
      return { ready: false, reason: 'Image translation storage is unavailable' };
    }
  };
  const extensionMediaTranslationLauncher = createExtensionMediaTranslationLauncher({
    workflowService: extensionMediaWorkflowService,
    loadContext: loadExtensionMediaTranslationContext,
    loadExisting: loadExtensionMediaTranslationExistingWorkflow,
    internalizeSource: async ({ ownerUserId, listingWorkflowId, sourceMediaKey, draftRevision, draftVersion }) => {
      const asset = await extensionMediaContextService.internalizeListingDraft(
        ownerUserId,
        listingWorkflowId,
        sourceMediaKey,
        { expectedRevision: draftRevision, expectedDraftVersion: draftVersion },
        'GENERAL',
      );
      return { id: asset.id };
    },
    getSettings: getExtensionMediaTranslationSettings,
    getStorageReadiness: getExtensionMediaTranslationStorageReadiness,
    resolvePrompt: resolveActiveAiTemplate,
    enqueue: async (jobId) => {
      const worker = await import('./workers/ai-image-translation.js');
      await worker.enqueueAiImageTranslationJob(jobId);
    },
    markEnqueueFailed: async (jobId) => extensionMediaJobRepository.markEnqueueFailed(jobId, {
      attemptCount: 0,
      errorCode: 'QUEUE_UNAVAILABLE',
      errorMessage: 'AI media queue is temporarily unavailable',
    }),
  });
  const getExtensionStandaloneReadiness = async (
    operation: 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
    frozenRuntime?: AiImageProviderRuntimeContract,
  ) => {
    const [
      generationEnabled,
      imageToImageEnabled,
      fullEditEnabled,
      inpaintEnabled,
      providerRuntime,
      globalDailyBudgetCents,
      runtimeConfig,
    ] = await Promise.all([
      getConfig('ai_image_generation_enabled'),
      getConfig('feature_ai_media_image_to_image'),
      getConfig('feature_ai_media_full_edit'),
      getConfig('feature_ai_media_inpaint'),
      getAiImageEditProviderRuntimeConfig(),
      getConfig('ai_daily_budget_cents'),
      getRuntimeConfigForStorage(),
    ]);
    return resolveExtensionMediaStandaloneReadiness(operation, {
      generationEnabled,
      imageToImageEnabled,
      fullEditEnabled,
      inpaintEnabled,
      provider: providerRuntime.provider,
      model: providerRuntime.model,
      baseUrl: providerRuntime.baseUrl,
      costPerImageCents: providerRuntime.costPerImageCents,
      currency: providerRuntime.currency,
      credentialRevision: providerRuntime.credentialRevision,
      globalDailyBudgetCents,
    }, {
      production: process.env.NODE_ENV === 'production',
      storageReadiness: resolveAiImageEditStorageReadiness(runtimeConfig),
      resolveImageToImageReadiness: resolveAiImageToImageReadiness,
      resolveAiImageEditReadiness,
    }, frozenRuntime);
  };
  const extensionMediaWorkflowLauncher = createExtensionMediaWorkflowLauncher({
    workflowService: extensionMediaWorkflowService,
    loadContext: loadExtensionMediaTranslationContext,
    loadExisting: loadExtensionMediaTranslationExistingWorkflow,
    internalizeSource: async ({
      ownerUserId,
      listingWorkflowId,
      sourceMediaKey,
      draftRevision,
      draftVersion,
      role,
    }) => {
      const asset = await extensionMediaContextService.internalizeListingDraft(
        ownerUserId,
        listingWorkflowId,
        sourceMediaKey,
        { expectedRevision: draftRevision, expectedDraftVersion: draftVersion },
        role,
      );
      return {
        id: asset.id,
        width: Number(asset.width),
        height: Number(asset.height),
      };
    },
    getReadiness: getExtensionStandaloneReadiness,
    getEditDailyLimit: async () => getConfig('ai_user_daily_image_generation_limit'),
    resolvePrompt: resolveActiveAiTemplate,
    enqueueGeneration: async (jobId) => {
      const worker = await import('./workers/ai-image-generation.js');
      await worker.enqueueAiImageJob(jobId);
    },
    enqueueEdit: async (jobId) => {
      const worker = await import('./workers/ai-image-edit.js');
      await worker.enqueueAiImageEditJob(jobId);
    },
    markEnqueueFailed: async (jobId) => extensionMediaJobRepository.markEnqueueFailed(jobId, {
      attemptCount: 0,
      errorCode: 'QUEUE_UNAVAILABLE',
      errorMessage: 'AI media queue is temporarily unavailable',
    }),
    production: process.env.NODE_ENV === 'production',
  });
  const absoluteExtensionMediaUrl = async (value: string) => {
    const runtimeConfig = await getRuntimeConfigForStorage();
    const publicOrigin = new URL(runtimeConfig.localBaseUrl).origin;
    return new URL(value, `${publicOrigin}/`).toString();
  };
  const loadExtensionListingDraft = async ({
    listingWorkflowId,
    ownerUserId,
  }: {
    listingWorkflowId: string;
    ownerUserId: string;
  }) => {
    try {
      const draft = await sourceListingWorkflowService.getDraft({
        draftId: listingWorkflowId,
        ownerUserId,
      });
      return {
        id: draft.id,
        ownerUserId: draft.ownerUserId,
        shopId: draft.shopId,
        revision: draft.revision,
        draftVersion: draft.draftVersion,
      };
    } catch (error) {
      if (error instanceof SourceListingWorkflowError
        && error.code === 'OZON_LISTING_DRAFT_NOT_FOUND') return null;
      throw error;
    }
  };
  const executeExtensionMediaWorkflowCommand = createExtensionMediaWorkflowCommandExecutor({
    workflowService: extensionMediaWorkflowService,
    launchWorkflow: extensionMediaWorkflowLauncher,
    launchTranslation: extensionMediaTranslationLauncher,
    loadListingDraft: loadExtensionListingDraft,
    getTranslationDailyLimit: async () => getConfig('ai_user_daily_image_translation_limit'),
    getEditDailyLimit: async () => getConfig('ai_user_daily_image_generation_limit'),
    getRetryReadiness: async (operation) => {
      if (operation === 'IMAGE_TRANSLATE') {
        const [settings, storageReadiness] = await Promise.all([
          getExtensionMediaTranslationSettings(),
          getExtensionMediaTranslationStorageReadiness(),
        ]);
        const readiness = resolveExtensionMediaTranslationReadiness({
          settings,
          production: process.env.NODE_ENV === 'production',
          storageReadiness,
        });
        return {
          ...readiness,
          provider: settings.provider,
          model: settings.model,
          globalDailyBudgetCents: settings.globalDailyBudgetCents,
        };
      }
      if (operation === 'IMAGE_TO_IMAGE' || operation === 'FULL_EDIT' || operation === 'INPAINT') {
        return getExtensionStandaloneReadiness(operation);
      }
      return { ready: false };
    },
    enqueueGeneration: async (jobId) => {
      const worker = await import('./workers/ai-image-generation.js');
      await worker.enqueueAiImageJob(jobId);
    },
    enqueueTranslation: async (jobId) => {
      const worker = await import('./workers/ai-image-translation.js');
      await worker.enqueueAiImageTranslationJob(jobId);
    },
    enqueueEdit: async (jobId) => {
      const worker = await import('./workers/ai-image-edit.js');
      await worker.enqueueAiImageEditJob(jobId);
    },
    markEnqueueFailed: async (jobId) => {
      return extensionMediaJobRepository.markEnqueueFailed(jobId, {
        attemptCount: 0,
        errorCode: 'QUEUE_UNAVAILABLE',
        errorMessage: 'AI media queue is temporarily unavailable',
      });
    },
    production: process.env.NODE_ENV === 'production',
  });
  const executeExtensionMediaReviewCommand = createExtensionMediaReviewCommandExecutor({
    workflowService: extensionMediaWorkflowService,
    loadListingDraft: loadExtensionListingDraft,
    getProviderReadiness: async (operation) => {
      if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)) {
        return { enabled: false, ready: false };
      }
      return getExtensionStandaloneReadiness(
        operation as 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
      );
    },
    production: process.env.NODE_ENV === 'production',
  });
  const executeExtensionMediaApplyCommand = createExtensionMediaApplyCommandExecutor({
    workflowService: extensionMediaWorkflowService,
    applyListingDraftApplication: (input) => applyAiMediaListingDraftApplication(prisma, input),
    getProviderReadiness: async (operation) => {
      if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)) {
        return { enabled: false, ready: false };
      }
      return getExtensionStandaloneReadiness(
        operation as 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT',
      );
    },
    production: process.env.NODE_ENV === 'production',
  });
  const extensionAiImageSuiteCommandLoaders = (scopes: string[]) => ({
    loadAuthority: async (input: Parameters<typeof loadExtensionAiImageSuiteState>[0]) => {
      const state = await loadExtensionAiImageSuiteState(input);
      return state ? {
        ownerUserId: input.ownerUserId,
        ...state.authority,
      } : null;
    },
    loadProjection: async (input: Parameters<typeof loadExtensionAiImageSuiteState>[0]) => (
      loadExtensionAiImageSuiteProjection(input, scopes)
    ),
  });
  const assertExtensionAiImageSuiteWriteEnabled = async (input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
  }) => {
    const decision = await evaluateExtensionHostedAiImagePolicy(input);
    if (!decision.enabled) throw new Error('Hosted AI image suite policy is disabled');
  };
  const executeExtensionAiImageSuiteCommand = createExtensionAiImageSuiteExecuteCommandExecutor({
    ...extensionAiImageSuiteCommandLoaders(['listing:review', 'media:execute']),
    start: async (input) => {
      await assertExtensionAiImageSuiteWriteEnabled(input);
      const providerRuntime = await requireAiImageSuiteExecutionRuntime();
      let result;
      try {
        result = await extensionAiImageSuiteService.claim({
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          planId: input.planId,
          expectedPlanRevision: input.planRevision,
          idempotencyKey: input.operationKey,
          expectedPreviewHash: input.expectedPreviewHash,
          providerConfig: providerRuntime.providerConfig!,
        });
      } catch (error) {
        if (isExtensionAiImageExecutionModeConflict(error)) {
          throw new ExtensionAiImageSuiteCommandError(
            'AI_IMAGE_SUITE_COMMAND_MODE_CONFLICT',
            409,
            'This listing draft already started BYOK image execution',
          );
        }
        throw error;
      }
      return {
        suiteId: result.suite.id,
        status: result.suite.status,
        revision: result.suite.revision,
        replayed: result.replayed,
      };
    },
    continue: async (input) => {
      await assertExtensionAiImageSuiteWriteEnabled(input);
      await requireAiImageSuiteExecutionRuntime();
      let suite = await extensionAiImageSuiteService.get(input.suiteId, input.ownerUserId);
      if (suite.revision !== input.expectedSuiteRevision) {
        throw new Error('AI image suite revision changed');
      }
      const advance = async (expectedRevision: 1 | 2 | 3, action: () => Promise<unknown>) => {
        try {
          await action();
        } catch (error) {
          const refreshed = await extensionAiImageSuiteService.get(input.suiteId, input.ownerUserId);
          if (refreshed.revision <= expectedRevision) throw error;
          return refreshed;
        }
        return extensionAiImageSuiteService.get(input.suiteId, input.ownerUserId);
      };
      if (suite.revision === 1) {
        suite = await advance(1, () => extensionAiImageSuiteReferenceService.internalize({
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          expectedRevision: 1,
          operationKey: `${input.operationKey}:references`,
        }));
      }
      if (suite.revision === 2) {
        suite = await advance(2, () => extensionAiImageSuitePromptService.freeze({
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          expectedRevision: 2,
          operationKey: `${input.operationKey}:prompts`,
        }));
      }
      if (suite.revision === 3) {
        suite = await advance(3, () => extensionAiImageSuiteMaterializationService.materialize({
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          expectedRevision: 3,
          operationKey: `${input.operationKey}:children`,
        }));
      }
      if (suite.revision === 4) {
        const dispatched = await commitExtensionAiImageSuiteWithFrontierRecovery(
          input.suiteId,
          () => extensionAiImageSuiteExecutionService.dispatch({
            suiteId: input.suiteId,
            ownerUserId: input.ownerUserId,
            actorUserId: input.actorUserId,
            expectedRevision: 4,
            operationKey: `${input.operationKey}:dispatch`,
          }),
        );
        return {
          suiteId: dispatched.suiteId,
          status: dispatched.status,
          revision: dispatched.revision,
          replayed: dispatched.replayed,
        };
      }
      return {
        suiteId: suite.id,
        status: suite.status,
        revision: suite.revision,
        replayed: true,
      };
    },
    cancel: async (input) => {
      await assertExtensionAiImageSuiteWriteEnabled(input);
      const result = await commitExtensionAiImageSuiteWithFrontierRecovery(
        input.suiteId,
        () => extensionAiImageSuiteExecutionService.cancel({
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          expectedRevision: input.expectedSuiteRevision,
          operationKey: input.operationKey,
        }),
      );
      return {
        suiteId: result.suiteId,
        status: result.status,
        revision: result.revision,
        replayed: result.replayed,
      };
    },
    retry: async (input) => {
      await assertExtensionAiImageSuiteWriteEnabled(input);
      await requireAiImageSuiteExecutionRuntime();
      const result = await commitExtensionAiImageSuiteWithFrontierRecovery(
        input.suiteId,
        () => extensionAiImageSuiteExecutionService.retryFailedSlot({
          suiteId: input.suiteId,
          slotId: input.slotId,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          expectedSlotRevision: input.expectedSlotRevision,
          operationKey: input.operationKey,
        }),
      );
      return {
        suiteId: result.suiteId,
        status: result.status,
        revision: result.revision,
        replayed: result.replayed,
      };
    },
  });
  const executeExtensionAiImageSuiteReview = createExtensionAiImageSuiteReviewCommandExecutor({
    ...extensionAiImageSuiteCommandLoaders(['listing:review']),
    review: async (input) => {
      await assertExtensionAiImageSuiteWriteEnabled(input);
      const result = await extensionAiImageSuiteCandidateService.review({
        suiteId: input.suiteId,
        slotId: input.slotId,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedWorkflowRevision: input.expectedWorkflowRevision,
        operationKey: input.operationKey,
        outputAssetId: input.outputAssetId,
        decision: input.decision,
        note: null,
        production: process.env.NODE_ENV === 'production',
      });
      const suite = await extensionAiImageSuiteService.get(input.suiteId, input.ownerUserId);
      return {
        suiteId: suite.id,
        status: suite.status,
        revision: suite.revision,
        replayed: result.replayed,
      };
    },
  });
  const executeExtensionAiImageSuiteApply = createExtensionAiImageSuiteApplyCommandExecutor({
    ...extensionAiImageSuiteCommandLoaders(['listing:review', 'listing:write']),
    apply: async (input) => {
      await assertExtensionAiImageSuiteWriteEnabled(input);
      const result = await extensionAiImageSuiteCandidateService.apply({
        suiteId: input.suiteId,
        slotId: input.slotId,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        expectedWorkflowRevision: input.expectedWorkflowRevision,
        operationKey: input.operationKey,
        expectedTargetUpdatedAt: input.expectedTargetUpdatedAt,
        production: process.env.NODE_ENV === 'production',
      });
      const suite = await extensionAiImageSuiteService.get(input.suiteId, input.ownerUserId);
      return {
        suiteId: suite.id,
        status: suite.status,
        revision: suite.revision,
        replayed: result.replayed,
      };
    },
  });
  type ExtensionMediaExecutorInput = Parameters<NonNullable<
    ExtensionCommandGrantRoutesOptions['executeMediaWorkflowCommand']
  >>[0];
  const legacyMediaExecutorInput = (input: ExtensionMediaExecutorInput) => {
    const { deviceSessionId: _deviceSessionId, ...legacyInput } = input;
    return legacyInput;
  };
  const executeExtensionMediaOrSuiteCommand = async (input: ExtensionMediaExecutorInput) => (
    input.command.version === EXTENSION_AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION
      ? executeExtensionAiImageSuiteCommand(input)
      : executeExtensionMediaWorkflowCommand(legacyMediaExecutorInput(input))
  );
  const executeExtensionMediaOrSuiteReview = async (input: ExtensionMediaExecutorInput) => (
    input.command.version === EXTENSION_AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION
      ? executeExtensionAiImageSuiteReview(input)
      : executeExtensionMediaReviewCommand(legacyMediaExecutorInput(input))
  );
  const executeExtensionMediaOrSuiteApply = async (input: ExtensionMediaExecutorInput) => (
    input.command.version === EXTENSION_AI_IMAGE_SUITE_APPLY_COMMAND_VERSION
      ? executeExtensionAiImageSuiteApply(input)
      : executeExtensionMediaApplyCommand(legacyMediaExecutorInput(input))
  );
  sourceCaptureService = createSourceCaptureService({
    repository: createPrismaSourceCaptureRepository({
      client: prisma,
      commandGrantSecret: extensionCommandGrantSecret,
    }),
  });
  await app.register(extensionDeviceRoutes, {
    prefix: '/api/extension-device',
    sessionService: createExtensionDeviceSessionService({
      repository: extensionDeviceRepository, authConfig: extensionDeviceAuthConfig,
    }),
    managementRepository: extensionDeviceRepository,
    collectBatch: async (input) => collectBatchForOwner({
      ownerUserId: input.ownerUserId,
      body: input.body,
      dependencies: {
        featureFlags: sourceWorkflowFeatureFlags,
        sourceCaptureService: sourceCaptureService || undefined,
      },
      log: input.log,
    }),
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    authenticateShopAnalyticsDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['capture:write'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
      shopIdFromRequest: (request) => {
        const params = request.params as { shopId?: unknown };
        return typeof params.shopId === 'string' ? params.shopId : null;
      },
    }),
    authenticateCollectDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['capture:write'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    shopRepository: createPrismaExtensionDeviceShopRepository(prisma),
    shopAnalyticsRepository: {
      createSnapshot: async ({ ownerUserId, shopId, snapshot }) => {
        const shop = await prisma.shop.findFirst({
          where: {
            id: shopId,
            userId: ownerUserId,
            platform: 'OZON',
            status: { not: 'DISABLED' },
          },
          select: { id: true },
        });
        if (!shop) return null;
        const stored = await prisma.shopAnalyticsSnapshot.create({
          data: {
            shopId: shop.id,
            ...snapshot,
          },
          select: { id: true, productCount: true },
        });
        return stored;
      },
    },
  });
  await app.register(extensionDeviceBrowserOneClickRoutes, {
    prefix: '/api/extension-device/browser-one-click',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    featureFlags: sourceWorkflowFeatureFlags,
    publisherRollout: ozonPublisherEntrypointRolloutService,
    sourceCaptureService: sourceCaptureService || undefined,
  });
  const loadExtensionCommandShop = ({ shopId, ownerUserId }: {
    shopId: string;
    ownerUserId: string;
  }) => prisma.shop.findFirst({
    where: { id: shopId, userId: ownerUserId },
    select: { id: true, userId: true, platform: true, status: true },
  });
  const loadExtensionCommandDraft = ({ workflowId, ownerUserId }: {
    workflowId: string;
    ownerUserId: string;
  }) => sourceListingWorkflowService.getDraft({ draftId: workflowId, ownerUserId });
  const loadExtensionByokWorkbenchDraft = async ({ workflowId, ownerUserId }: {
    workflowId: string;
    ownerUserId: string;
  }) => {
    let draft;
    try {
      draft = await sourceListingWorkflowService.getDraft({ draftId: workflowId, ownerUserId });
    } catch (error) {
      if (error instanceof SourceListingWorkflowError
        && error.code === 'OZON_LISTING_DRAFT_NOT_FOUND') return null;
      throw error;
    }
    const snapshot = await prisma.sourceCaptureSnapshot.findFirst({
      where: {
        id: draft.sourceCaptureSnapshotId,
        subject: { ownerUserId },
      },
      select: {
        id: true,
        subject: {
          select: {
            sourcePlatform: true,
            sourceProductId: true,
            snapshots: {
              orderBy: { version: 'desc' },
              take: 1,
              select: { id: true },
            },
          },
        },
      },
    });
    if (!snapshot || snapshot.id !== draft.sourceCaptureSnapshotId) return null;
    return {
      ...draft,
      sourceCaptureCurrent: snapshot.subject.snapshots[0]?.id === snapshot.id,
      sourcePlatform: snapshot.subject.sourcePlatform,
      sourceProductId: snapshot.subject.sourceProductId,
    };
  };
  await app.register(extensionByokReadinessRoutes, {
    prefix: '/api/extension-device/byok-media',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['byok:media:ingest'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    authenticateLaunchDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['listing:review'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    loadShop: loadExtensionCommandShop,
    loadDraft: loadExtensionByokWorkbenchDraft,
    authorizeBoundSlotLaunch: async (input) => {
      const provenance = await prisma.extensionByokMediaProvenance.findFirst({
        where: {
          executionMode: 'BYOK',
          ownerUserId: input.ownerUserId,
          actorUserId: input.ownerUserId,
          shopId: input.shopId,
          workflowId: input.workflowId,
          skuKey: input.skuKey,
          slotKey: input.slotKey,
          assetId: input.assetId,
          erpAiChargeCents: 0,
        },
        select: { assetId: true },
      });
      if (!provenance || provenance.assetId !== input.assetId) {
        return { authorized: false as const, assetId: null };
      }
      const decision = await extensionByokPublishAuthorizer({
        ownerUserId: input.ownerUserId,
        shopId: input.shopId,
        workflowId: input.workflowId,
        assignments: [{ assetId: input.assetId }],
        requestingDeviceSessionId: input.requestingDeviceSessionId,
      });
      return decision.byokAssetIds.length === 1
        && decision.byokAssetIds[0] === input.assetId
        ? { authorized: true as const, assetId: input.assetId }
        : { authorized: false as const, assetId: null };
    },
    getReadiness: (input) => extensionByokPolicyEvaluator.evaluate(input),
  });
  await app.register(extensionByokExecutionIntentRoutes, {
    prefix: '/api/extension-device/byok-media',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['byok:media:ingest'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    service: createExtensionByokExecutionIntentService({
      loadShop: loadExtensionCommandShop,
      loadDraft: loadExtensionByokWorkbenchDraft,
      evaluatePolicy: (input) => extensionByokPolicyEvaluator.evaluate(input),
      repository: createPrismaExtensionByokExecutionIntentRepository(prisma),
    }),
  });
  await app.register(extensionByokExecutionBatchRoutes, {
    prefix: '/api/extension-device/byok-media',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['byok:media:ingest'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    service: createExtensionByokExecutionBatchService({
      loadShop: loadExtensionCommandShop,
      loadDraft: loadExtensionByokWorkbenchDraft,
      evaluatePolicy: (input) => extensionByokPolicyEvaluator.evaluate(input),
      repository: createPrismaExtensionByokExecutionBatchRepository(prisma as never),
    }),
  });
  const extensionCommandRoutesOptions: ExtensionCommandGrantRoutesOptions & { prefix: string } = {
    prefix: '/api/extension-device',
    service: createExtensionCommandGrantService({
      store: createPrismaExtensionCommandGrantStore({ client: prisma }),
      secret: extensionCommandGrantSecret,
    }),
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    resolveCommand: createSourceWorkflowCommandResolver({
      featureFlags: sourceWorkflowFeatureFlags,
      getMediaWorkflowDecision: getAiMediaRolloutDecision,
      getAiImageSuiteEnabled: async (ownerUserId) => {
        const [hostedEnabled, authorization] = await Promise.all([
          getConfig('feature_extension_hosted_ai'),
          getAiImageSuiteDispatchAuthorization(ownerUserId),
        ]);
        return hostedEnabled && authorization.enabled;
      },
      getByokReadiness: (input) => extensionByokPolicyEvaluator.evaluate(input),
      authorizeByokPublish: extensionByokPublishAuthorizer,
      production: process.env.NODE_ENV === 'production',
      loadShop: loadExtensionCommandShop,
      loadDraft: loadExtensionCommandDraft,
      loadMediaWorkflow: async ({ workflowId, ownerUserId }) => {
        const row = await prisma.aiMediaWorkflow.findFirst({
          where: { id: workflowId, ownerUserId },
          select: {
            id: true,
            ownerUserId: true,
            operation: true,
            contextType: true,
            contextId: true,
            contextDraftRevision: true,
            contextDraftVersion: true,
            revision: true,
            status: true,
            reviewStatus: true,
            selectedOutputAssetId: true,
            suiteSlot: { select: { suiteId: true } },
            jobs: {
              orderBy: [{ workflowAttempt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: {
                id: true,
                provider: true,
                model: true,
                status: true,
                operationConfig: true,
                assets: {
                  where: { kind: 'AI_GENERATED' },
                  take: 10,
                  select: {
                    id: true,
                    ownerUserId: true,
                    aiImageJobId: true,
                  },
                },
              },
            },
            events: {
              where: { eventType: { in: ['REVIEW_APPROVED', 'REVIEW_REJECTED'] } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 20,
              select: {
                eventKey: true,
                eventType: true,
                assetId: true,
                payload: true,
              },
            },
            listingDraftApplicationMutations: {
              where: { kind: 'APPLY' },
              orderBy: [{ targetSequence: 'desc' }, { id: 'desc' }],
              take: 20,
              select: {
                assetId: true,
                operationKey: true,
                requestFingerprint: true,
                workflowRevisionBefore: true,
                workflowRevisionAfter: true,
                targetRevisionBefore: true,
                targetDraftVersionBefore: true,
                targetRevisionAfter: true,
                targetDraftVersionAfter: true,
                rolledBackBy: { select: { id: true } },
              },
            },
          },
        });
        return row ? {
          id: row.id,
          ownerUserId: row.ownerUserId,
          operation: String(row.operation),
          contextType: row.contextType,
          contextId: row.contextId,
          contextDraftRevision: row.contextDraftRevision,
          contextDraftVersion: row.contextDraftVersion,
          revision: row.revision,
          status: row.status,
          reviewStatus: row.reviewStatus,
          selectedOutputAssetId: row.selectedOutputAssetId,
          suiteId: row.suiteSlot?.suiteId || null,
          provider: row.jobs[0]?.provider || null,
          model: row.jobs[0]?.model || null,
          operationConfig: row.jobs[0]?.operationConfig,
          currentJobStatus: row.jobs[0]?.status || null,
          outputAssetIds: (row.jobs[0]?.assets || [])
            .filter((asset) => asset.ownerUserId === ownerUserId
              && asset.aiImageJobId === row.jobs[0]?.id)
            .map((asset) => asset.id),
          reviewEvents: row.events.map((event) => ({
            eventKey: event.eventKey,
            eventType: event.eventType,
            assetId: event.assetId,
            payload: event.payload,
          })),
          applications: row.listingDraftApplicationMutations.map((item) => ({
            assetId: item.assetId,
            operationKey: item.operationKey,
            requestFingerprint: item.requestFingerprint,
            workflowRevisionBefore: item.workflowRevisionBefore,
            workflowRevisionAfter: item.workflowRevisionAfter,
            targetRevisionBefore: item.targetRevisionBefore,
            targetDraftVersionBefore: item.targetDraftVersionBefore,
            targetRevisionAfter: item.targetRevisionAfter,
            targetDraftVersionAfter: item.targetDraftVersionAfter,
            rolledBackById: item.rolledBackBy?.id || null,
          })),
        } : null;
      },
      loadMediaLaunchContext: async ({ ownerUserId, workflowId, draftRevision, draftVersion, sourceMediaKey }) => {
        const context = await loadExtensionMediaTranslationContext({
          ownerUserId,
          listingWorkflowId: workflowId,
          draftRevision,
          draftVersion,
        });
        return context && context.sourceMediaKeys.includes(sourceMediaKey)
          ? { sourceMediaKeys: context.sourceMediaKeys }
          : null;
      },
    }),
    executeOzonPublish: async ({
      deviceSessionId, ownerUserId, actorUserId, workflowId, idempotencyKey, command,
    }) => {
      const commandRow = command as { draftRevision?: unknown; publishIntentId?: unknown };
      const expectedRevision = Number(commandRow.draftRevision);
      const publishIntentId = String(commandRow.publishIntentId || '').trim();
      if (!Number.isSafeInteger(expectedRevision) || !idempotencyKey || !publishIntentId) {
        throw new Error('Ozon publish command identity is invalid');
      }
      return executeExtensionOzonPublish({
        draftId: workflowId,
        ownerUserId,
        actorUserId,
        expectedRevision,
        idempotencyKey,
        publishIntentId,
        requestingDeviceSessionId: deviceSessionId,
      });
    },
    executeMediaWorkflowCommand: executeExtensionMediaOrSuiteCommand,
    executeMediaReviewCommand: executeExtensionMediaOrSuiteReview,
    executeMediaApplyCommand: executeExtensionMediaOrSuiteApply,
  };
  await app.register(extensionCommandGrantRoutes, extensionCommandRoutesOptions);
  const extensionByokPublishStatusRepository =
    createPrismaExtensionByokPublishStatusRepository(prisma);
  const extensionWorkbenchByokPublishProvenanceService =
    createExtensionWorkbenchByokPublishProvenanceService(prisma);
  const loadExtensionByokAcceptedPublishProvenance = async ({
    provenanceId,
    ownerUserId,
  }: {
    provenanceId: string;
    ownerUserId: string;
  }) => {
    const row = await prisma.extensionByokMediaProvenance.findFirst({
      where: { id: provenanceId, ownerUserId },
      select: {
        id: true,
        executionMode: true,
        ownerUserId: true,
        actorUserId: true,
        deviceSessionId: true,
        shopId: true,
        workflowId: true,
        draftRevision: true,
        draftVersion: true,
        boundDraftRevision: true,
        boundDraftVersion: true,
        skuKey: true,
        slotKey: true,
        assignmentOrdinal: true,
        assignmentSha256: true,
        operation: true,
        assetId: true,
        publishIntentId: true,
        publishReceiptId: true,
        erpAiChargeCents: true,
        resultSha256: true,
        asset: { select: { sha256: true } },
      },
    });
    const normalizedSha256 = row?.asset.sha256;
    if (!row
      || row.executionMode !== 'BYOK'
      || !normalizedSha256
      || normalizedSha256 !== row.resultSha256) return null;
    return {
      id: row.id,
      executionMode: 'BYOK' as const,
      ownerUserId: row.ownerUserId,
      actorUserId: row.actorUserId,
      deviceSessionId: row.deviceSessionId,
      shopId: row.shopId,
      workflowId: row.workflowId,
      draftRevision: row.draftRevision,
      draftVersion: row.draftVersion,
      boundDraftRevision: row.boundDraftRevision,
      boundDraftVersion: row.boundDraftVersion,
      skuKey: row.skuKey,
      slotKey: row.slotKey,
      assignmentOrdinal: row.assignmentOrdinal,
      assignmentSha256: row.assignmentSha256,
      operation: String(row.operation),
      assetId: row.assetId,
      normalizedSha256,
      publishIntentId: row.publishIntentId,
      publishReceiptId: row.publishReceiptId,
      erpAiChargeCents: row.erpAiChargeCents,
    };
  };
  await app.register(extensionByokPublishRoutes, {
    prefix: '/api/extension-device/byok-publish',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['listing:publish'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    service: createExtensionByokListingPublishService({
      loadDraft: async ({ workflowId, ownerUserId }) => {
        try {
          return await sourceListingWorkflowService.getDraft({
            draftId: workflowId,
            ownerUserId,
          });
        } catch (error) {
          if (error instanceof SourceListingWorkflowError
            && error.code === 'OZON_LISTING_DRAFT_NOT_FOUND') return null;
          throw error;
        }
      },
      loadAcceptedProvenance: loadExtensionByokAcceptedPublishProvenance,
      authorizePublish: extensionByokPublishAuthorizer,
      recordPublishIntent: (input) => sourceListingWorkflowService.recordPublishIntent(input),
      findPublishStatus: (input) => extensionByokPublishStatusRepository.findStatus(input),
      linkPublish: (input) => extensionWorkbenchByokPublishProvenanceService.linkStatus(input),
    }),
  });
  await app.register(extensionWorkbenchPublishRoutes, {
    prefix: '/api/extension-device/workbench-publish',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['listing:publish'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    service: createExtensionWorkbenchListingPublishService({
      loadDraft: async ({ workflowId, ownerUserId }) => {
        try {
          return await sourceListingWorkflowService.getDraft({
            draftId: workflowId,
            ownerUserId,
          });
        } catch (error) {
          if (error instanceof SourceListingWorkflowError
            && error.code === 'OZON_LISTING_DRAFT_NOT_FOUND') return null;
          throw error;
        }
      },
      authorizePublish: extensionByokPublishAuthorizer,
      assertReusableByokAssets: (input) => (
        extensionWorkbenchByokPublishProvenanceService.assertReusable(input)
      ),
      preflightPublishAuthority: async (input) => {
        await preflightOzonListingProductionCompile(
          sourceOzonListingProductionCompile,
          input,
        );
      },
      recordPublishIntent: (input) => sourceListingWorkflowService.recordPublishIntent(input),
      findPublishStatus: (input) => extensionByokPublishStatusRepository.findStatus(input),
      linkPublishedByokAssets: (input) => (
        extensionWorkbenchByokPublishProvenanceService.linkStatus(input)
      ),
    }),
  });
  const byokGeneratedAssetRepository = createPrismaByokGeneratedAssetRepository(prisma);
  const byokMediaIngestStatusRepository = createPrismaExtensionByokMediaIngestStatusRepository(prisma);
  const byokMediaBatchIngestStatusRepository =
    createPrismaExtensionByokMediaBatchIngestStatusRepository(prisma);
  const byokUploadStagingStore = createPrismaExtensionByokUploadStagingStore(prisma as never);
  const byokIngestRateLimiter = createPrismaExtensionByokIngestRateLimiter(prisma as never);
  await app.register(extensionByokMediaRoutes, {
    prefix: '/api/extension-device/byok-media',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['byok:media:ingest'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    resolveCommand: extensionCommandRoutesOptions.resolveCommand,
    digestGrantToken: (token) => digestExtensionCommandGrantToken(extensionCommandGrantSecret, token),
    inspectGrant: (input) => inspectByokMediaIngestGrant(prisma as never, input),
    ingestRateLimiter: byokIngestRateLimiter,
    stagingStore: byokUploadStagingStore,
    getStorage: getOwnedImageStorageBackend,
    findStoredAsset: (input) => byokGeneratedAssetRepository.findById(input),
    commit: createPrismaExtensionByokGeneratedAssetCommitter(prisma),
    findIngestStatus: (input) => byokMediaIngestStatusRepository.findStatus(input),
  });
  await app.register(extensionByokMediaBatchRoutes, {
    prefix: '/api/extension-device/byok-media',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['byok:media:ingest'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    resolveCommand: extensionCommandRoutesOptions.resolveCommand,
    digestGrantToken: (token) => digestExtensionCommandGrantToken(extensionCommandGrantSecret, token),
    inspectGrant: (input) => inspectByokMediaIngestGrant(prisma as never, input),
    ingestRateLimiter: byokIngestRateLimiter,
    stagingStore: byokUploadStagingStore,
    getStorage: getOwnedImageStorageBackend,
    findStoredAsset: (input) => byokGeneratedAssetRepository.findById(input),
    commit: createPrismaExtensionByokGeneratedAssetBatchCommitter(prisma as never),
    findBatchStatus: (input) => byokMediaBatchIngestStatusRepository.findStatus(input),
  });
  await app.register(extensionSourceCaptureRoutes, {
    prefix: '/api/extension-device',
    service: sourceCaptureService,
    featureFlags: sourceWorkflowFeatureFlags,
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['capture:write'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
  });
  await app.register(extensionSourceWorkbenchRoutes, {
    prefix: '/api/extension-device/source-workbench',
    service: createExtensionSourceWorkbenchService({
      production: process.env.NODE_ENV === 'production',
      loadAllowedPreviewOrigins: async () => {
        const config = await getRuntimeConfigForStorage();
        return [config.localBaseUrl, config.oss?.cdnDomain]
          .filter((value): value is string => Boolean(value));
      },
    }),
    featureFlags: sourceWorkflowFeatureFlags,
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['listing:review'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
  });
  await app.register(extensionMediaLaunchRoutes, {
    prefix: '/api/extension-device/source-workbench',
    featureFlags: sourceWorkflowFeatureFlags,
    getMediaWorkflowDecision: getAiMediaRolloutDecision,
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['listing:review'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    loadContext: async ({
      ownerUserId,
      snapshotId,
      supplyGoodsId,
      shopId,
      listingWorkflowId,
      revision,
      draftVersion,
    }) => {
      const context = await loadExtensionMediaTranslationContext({
        ownerUserId,
        listingWorkflowId,
        draftRevision: revision,
        draftVersion,
      });
      if (!context
        || context.shopId !== shopId
        || context.supplyGoodsId !== supplyGoodsId
        || context.snapshotId !== snapshotId) return null;
      return context;
    },
    loadPreview: ({
      ownerUserId,
      listingWorkflowId,
      revision,
      draftVersion,
      skuKey,
      sourceMediaKey,
      purpose,
    }) => extensionMediaContextService.loadListingDraftPreview(
      ownerUserId,
      listingWorkflowId,
      sourceMediaKey,
      {
        expectedRevision: revision,
        expectedDraftVersion: draftVersion,
        skuKey,
      },
      purpose,
    ),
    getCapability: async ({ workflowDecision }) => {
      const [
        enabled, provider, model, dailyLimit, estimatedCostCents, categoryGlossaryJson, storage,
      ] = await Promise.all([
        getConfig('feature_image_translate'),
        getConfig('ai_image_translation_provider'),
        getConfig('ai_image_translation_model'),
        getConfig('ai_user_daily_image_translation_limit'),
        getConfig('ai_image_translation_cost_cents'),
        getConfig('ai_image_translation_category_glossary_json'),
        getRuntimeConfigForStorage().then(resolveAiImageTranslationStorageReadiness),
      ]);
      const readiness = resolveExtensionMediaTranslationReadiness({
        settings: {
          enabled,
          provider,
          model,
          dailyLimit,
          estimatedCostCents,
          categoryGlossaryJson,
        },
        production: process.env.NODE_ENV === 'production',
        storageReadiness: storage,
      });
      return {
        enabled: readiness.enabled,
        ready: readiness.ready,
        reasonCode: readiness.reasonCode,
        reason: readiness.reason,
        revision: String(workflowDecision.revision),
        testOnly: true as const,
        operation: 'IMAGE_TRANSLATE' as const,
        sourceLanguage: 'zh' as const,
        targetLanguage: 'ru' as const,
      };
    },
    getCapabilities: async ({ workflowDecision }) => {
      const [
        imageToImage,
        fullEdit,
        inpaint,
        translationEnabled,
        translationProvider,
        translationModel,
        translationDailyLimit,
        translationEstimatedCostCents,
        translationCategoryGlossaryJson,
        runtimeConfig,
      ] = await Promise.all([
        getExtensionStandaloneReadiness('IMAGE_TO_IMAGE'),
        getExtensionStandaloneReadiness('FULL_EDIT'),
        getExtensionStandaloneReadiness('INPAINT'),
        getConfig('feature_image_translate'),
        getConfig('ai_image_translation_provider'),
        getConfig('ai_image_translation_model'),
        getConfig('ai_user_daily_image_translation_limit'),
        getConfig('ai_image_translation_cost_cents'),
        getConfig('ai_image_translation_category_glossary_json'),
        getRuntimeConfigForStorage(),
      ]);
      const production = process.env.NODE_ENV === 'production';
      const translation = resolveExtensionMediaTranslationReadiness({
        settings: {
          enabled: translationEnabled,
          provider: translationProvider,
          model: translationModel,
          dailyLimit: translationDailyLimit,
          estimatedCostCents: translationEstimatedCostCents,
          categoryGlossaryJson: translationCategoryGlossaryJson,
        },
        production,
        storageReadiness: resolveAiImageTranslationStorageReadiness(runtimeConfig),
      });
      const operation = <T extends 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT'>(
        name: T,
        readiness: typeof imageToImage,
      ) => ({
        enabled: readiness.enabled,
        ready: readiness.ready,
        reasonCode: readiness.reasonCode,
        reason: readiness.reason,
        revision: String(workflowDecision.revision),
        testOnly: readiness.testOnly === true,
        operation: name,
      });
      return {
        IMAGE_TO_IMAGE: {
          ...operation('IMAGE_TO_IMAGE', imageToImage),
          maxReferences: 4,
        },
        IMAGE_TRANSLATE: {
          enabled: translation.enabled,
          ready: translation.ready,
          reasonCode: translation.reasonCode,
          reason: translation.reason,
          revision: String(workflowDecision.revision),
          testOnly: true,
          operation: 'IMAGE_TRANSLATE' as const,
          sourceLanguage: 'zh' as const,
          targetLanguage: 'ru' as const,
        },
        FULL_EDIT: operation('FULL_EDIT', fullEdit),
        INPAINT: {
          ...operation('INPAINT', inpaint),
          maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
          maxMaskBytes: EXTENSION_MEDIA_EDIT_MASK_MAX_BYTES,
        },
      };
    },
  });
  await app.register(extensionAiImageSuiteRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['listing:review'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    loadState: loadExtensionAiImageSuiteState,
    loadTrustedPreviewOrigins: loadExtensionAiImageSuitePreviewOrigins,
    allowInsecureLocalPreview: process.env.NODE_ENV !== 'production',
  });
  const authenticateExtensionHostedAiImageDevice = authenticateExtensionDevice({
    config: extensionDeviceAuthConfig,
    loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
  });
  await app.register(extensionHostedAiImageModeLockRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: authenticateExtensionHostedAiImageDevice,
    service: extensionHostedAiImageModeLockService,
  });
  await app.register(extensionHostedAiImagePlanRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: authenticateExtensionHostedAiImageDevice,
    service: extensionHostedAiImagePlanRouteService,
  });
  await app.register(extensionHostedCandidatePreviewRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: authenticateExtensionHostedAiImageDevice,
    service: extensionHostedCandidatePreviewService,
  });
  await app.register(extensionHostedAiImageListingAssignmentRoutes, {
    prefix: '/api/extension-device/source-workbench',
    authenticateDevice: authenticateExtensionHostedAiImageDevice,
    service: extensionHostedListingAssignmentService,
  });
  await app.register(extensionMediaEditRoutes, {
    prefix: '/api/extension-device/source-workbench',
    featureFlags: sourceWorkflowFeatureFlags,
    getMediaWorkflowDecision: getAiMediaRolloutDecision,
    authenticateDevice: authenticateExtensionDevice({
      config: extensionDeviceAuthConfig,
      requiredScopes: ['media:execute'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    getReadiness: () => getExtensionStandaloneReadiness('INPAINT'),
    loadContext: ({ ownerUserId, listingWorkflowId, revision, draftVersion }) => (
      loadExtensionMediaTranslationContext({
        ownerUserId,
        listingWorkflowId,
        draftRevision: revision,
        draftVersion,
      })
    ),
    internalizeSource: async ({
      ownerUserId,
      listingWorkflowId,
      sourceMediaKey,
      revision,
      draftVersion,
      role,
    }) => {
      const asset = await extensionMediaContextService.internalizeListingDraft(
        ownerUserId,
        listingWorkflowId,
        sourceMediaKey,
        { expectedRevision: revision, expectedDraftVersion: draftVersion },
        role,
      );
      return {
        id: asset.id,
        url: await absoluteExtensionMediaUrl(asset.url),
        mimeType: asset.mimeType,
        width: Number(asset.width),
        height: Number(asset.height),
      };
    },
    checkMaskRequestRate: async (ownerUserId) => {
      if (!await getConfig('upload_rate_limit_enabled')) return { allowed: true } as const;
      const maxPerMinute = await getConfig('upload_rate_limit_per_minute');
      return await uploadLimiter.checkRateLimit(ownerUserId, maxPerMinute)
        ? { allowed: true } as const
        : { allowed: false, reason: `Edit mask upload exceeds ${maxPerMinute} requests per minute` } as const;
    },
    createMask: async (input) => {
      const result = await createAiImageEditMask(input, {
        database: prisma as any,
        getStorage: getStorageBackend,
        loadListingDraftContext: (ownerUserId, draftId, scope) => (
          extensionMediaContextService.loadListingDraft(ownerUserId, draftId, scope)
        ),
        checkUploadQuota: async (ownerUserId, bytes) => {
          if (!await getConfig('upload_daily_quota_enabled')) return { allowed: true } as const;
          const maxMegabytes = await getConfig('upload_daily_quota_mb');
          return await uploadLimiter.checkDailyQuota(ownerUserId, bytes, maxMegabytes * 1024 * 1024)
            ? { allowed: true } as const
            : {
              allowed: false,
              reason: `Edit mask upload exceeds the ${maxMegabytes} MB daily quota`,
            } as const;
        },
      });
      return {
        ...result,
        asset: {
          ...result.asset,
          url: await absoluteExtensionMediaUrl(result.asset.url),
        },
      };
    },
    production: process.env.NODE_ENV === 'production',
  });
}
if (isLogisticsDistributionEnabled()) {
  if (!extensionDeviceRepository) throw new Error('Extension device repository is unavailable');
  const logisticsAuthConfig = resolveExtensionDeviceAuthConfig();
  const logisticsRuntimeConfig = getRuntimeConfig();
  const logisticsAdminRepository = createPrismaLogisticsRuleAdminRepository({
    prisma,
    deploymentId: logisticsAuthConfig.deploymentId,
    apiOrigin: new URL(logisticsRuntimeConfig.localBaseUrl).origin,
  });
  const logisticsAdminService = createLogisticsRuleAdminService({
    repository: logisticsAdminRepository,
    releaseDatabase: prisma,
    deploymentId: logisticsAuthConfig.deploymentId,
    schemaMajor: 1,
  });
  await app.register(adminLogisticsRuleRoutes, {
    prefix: '/api/admin/logistics-rules',
    service: logisticsAdminService,
  });
  const officialInputUnitContractRepository =
    createPrismaOfficialInputUnitContractRepository({ client: prisma });
  const officialInputUnitContractService = createOfficialInputUnitContractService({
    repository: officialInputUnitContractRepository,
  });
  await app.register(adminLogisticsInputUnitContractRoutes, {
    prefix: '/api/admin/logistics-rules',
    service: officialInputUnitContractService,
  });
  const logisticsDeviceRepository = createPrismaLogisticsRuleDeviceRepository({ client: prisma });
  await app.register(logisticsRuleRoutes, {
    prefix: '/api/logistics-rules',
    repository: logisticsDeviceRepository,
    authenticateDiscover: authenticateExtensionDevice({
      config: logisticsAuthConfig,
      requiredScopes: ['logistics:discover'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    authenticateRead: authenticateExtensionDevice({
      config: logisticsAuthConfig,
      requiredScopes: ['logistics:read'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    authenticateReceipt: authenticateExtensionDevice({
      config: logisticsAuthConfig,
      requiredScopes: ['logistics:receipt'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
    deploymentId: logisticsAuthConfig.deploymentId,
  });
  const logisticsCaptureRepository = createPrismaLogisticsCaptureTaskRepository({ client: prisma });
  const logisticsCaptureService = createLogisticsCaptureTaskService({
    repository: logisticsCaptureRepository,
  });
  const logisticsCaptureDraftService = createReviewedCaptureDraftService({
    captureRepository: logisticsCaptureRepository,
    candidateSetRepository: logisticsCaptureRepository,
    adminService: logisticsAdminService,
  });
  await app.register(adminLogisticsCaptureTaskRoutes, {
    prefix: '/api/admin/logistics-rules',
    service: logisticsCaptureService,
    draftService: logisticsCaptureDraftService,
  });
  await app.register(logisticsCaptureTaskRoutes, {
    prefix: '/api/logistics-rules',
    service: logisticsCaptureService,
    authenticateCapture: authenticateExtensionDevice({
      config: logisticsAuthConfig,
      requiredScopes: ['logistics:capture'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
  });
  const logisticsScopeBootstrapRepository =
    createPrismaLogisticsScopeBootstrapRepository({ client: prisma });
  const logisticsScopeBootstrapService = createLogisticsScopeBootstrapService({
    repository: logisticsScopeBootstrapRepository,
    deploymentId: logisticsAuthConfig.deploymentId,
    tokenSecret: logisticsAuthConfig.secret,
  });
  await app.register(adminLogisticsScopeBootstrapRoutes, {
    prefix: '/api/admin/logistics-rules',
    service: logisticsScopeBootstrapService,
  });
  await app.register(logisticsScopeBootstrapDeviceRoutes, {
    prefix: '/api/logistics-rules',
    service: logisticsScopeBootstrapService,
    authenticateDevice: authenticateExtensionDevice({
      config: logisticsAuthConfig,
      requiredScopes: ['logistics:capture'],
      loadAuthorization: (sessionId) => extensionDeviceRepository.loadAuthorization(sessionId),
    }),
  });
}
await app.register(setupRoutes, { prefix: '/api/setup' });
await app.register(userRoutes, { prefix: '/api/user' });
await app.register(shopRoutes, { prefix: '/api/shops' });
await app.register(orderRoutes, { prefix: '/api/orders' });
await app.register(orderAnalyticsRoutes, { prefix: '/api/orders' });
await app.register(financeRoutes, { prefix: '/api/finance' });
await app.register(inventoryRoutes, { prefix: '/api/inventory' });
await app.register(listingRoutes, {
  prefix: '/api/listing',
  featureFlags: sourceWorkflowFeatureFlags,
  sourceCaptureService: sourceCaptureService || undefined,
  publisherRollout: ozonPublisherEntrypointRolloutService,
  publisherParityObserver: sourceOzonPublisherEntrypointParityObserver,
});
await app.register(sourceCaptureViewRoutes, {
  prefix: '/api/source-capture-views',
  service: createSourceCaptureViewService(),
});
await app.register(sourceListingPublisherRoutes, {
  prefix: '/api/source-listing-workflows',
  featureFlags: sourceWorkflowFeatureFlags,
  loadShop: ({ shopId, ownerUserId }) => prisma.shop.findFirst({
    where: {
      id: shopId,
      userId: ownerUserId,
      platform: 'OZON',
      status: 'ACTIVE',
    },
    select: { id: true, userId: true, platform: true, status: true },
  }),
  workflow: sourceListingWorkflowService,
  publisher: sourceOzonListingPublisher,
});
await app.register(sourceListingWorkflowRoutes, {
  prefix: '/api/source-listing-workflows',
  service: sourceListingWorkflowService,
  featureFlags: sourceWorkflowFeatureFlags,
  ownership: sourceListingWorkflowContext,
  categoryValidator: sourceListingWorkflowCategoryValidator,
  attributeWorkflow: sourceListingWorkflowAttributeService,
  mediaWorkflow: sourceListingMediaImportService,
  aiCopyWorkflow: sourceListingAiCopyService,
  authorizeByokPublish: extensionByokPublishAuthorizer,
  publisher: sourceOzonListingPublisher,
});
await app.register(noticeRoutes, { prefix: '/api/notices' });
await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
await app.register(dashboardContentRoutes, { prefix: '/api/dashboard-content' });
await app.register(productRoutes, { prefix: '/api/products' });
await app.register(returnRoutes, { prefix: '/api/returns' });
await app.register(issueRoutes, { prefix: '/api/issues' });
await app.register(supplyRoutes, { prefix: '/api/supply' });
await app.register(staffRoutes, { prefix: '/api/staff' });
await app.register(notificationRoutes, { prefix: '/api/notifications' });
await app.register(collectRoutes, {
  prefix: '/api/collect',
  featureFlags: sourceWorkflowFeatureFlags,
  publisherParityObserver: sourceOzonPublisherEntrypointParityObserver,
  sourceOzonCategoryMappingService,
  loadCanonicalSourceOzonCategoryContext,
  loadAuthoritativeOzonCategoryCatalog,
  ...(sourceCaptureService ? { sourceCaptureService } : {}),
});
await app.register(ozonAnalyticsRoutes, { prefix: '/api/ozon-analytics' });
await app.register(ozonSyncRoutes, { prefix: '/api/ozon-sync' });
await app.register(warehouseRoutes, { prefix: '/api/warehouse' });
await app.register(warehouseTemplateRoutes, { prefix: '/api/admin/warehouse' });
await app.register(ozonPickupPointRoutes, { prefix: '/api/ozon-pickup-points' });
await app.register(warehouseCommandRoutes, { prefix: '/api/warehouse-commands' });
await app.register(userServiceTagRoutes, { prefix: '/api/user-service-tags' });
await app.register(adminRoutes, { prefix: '/api/admin' });
await app.register(accountRoutes, { prefix: '/api/account' });
await app.register(rechargeRoutes, { prefix: '/api/recharges' });
await app.register(paymentRoutes, { prefix: '/api/payments' });
await app.register(adminPaymentRoutes, { prefix: '/api/admin/payments' });
await app.register(inviteRoutes, { prefix: '/api/invite' });
await app.register(logisticsBillRoutes, { prefix: '/api/logistics-bills' });
await app.register(logisticsRoutes, { prefix: '/api/logistics' });
await app.register(exportRoutes, { prefix: '/api/export' });
await app.register(searchRoutes, { prefix: '/api/search' });
await app.register(providerRoutes, { prefix: '/api/provider' });
await app.register(ozonLogisticsRoutes, { prefix: '/api/ozon-logistics' });
await app.register(domesticAddressRoutes, { prefix: '/api/domestic-addresses' });
await app.register(systemConfigRoutes, { prefix: '/api/admin/system-config' });
await app.register(watermarkTemplateRoutes, { prefix: '/api/watermark-templates' });
await app.register(imageUploadRoutes, { prefix: '/api/images' });
await app.register(cdnProxyRoutes);
await app.register(cdnProxyRoutes, { prefix: '/api' });
await app.register(chatRoutes, { prefix: '/api/chat' });
await app.register(appVersionRoutes, { prefix: '/api/app-version' });
await app.register(adminAuthRoutes, { prefix: '/api/admin/auth' });
await app.register(extensionConfigRoutes, { prefix: '/api/extension' });
await app.register(extensionConfigRoutes, { prefix: '/api/extension-config' });
const extensionPublicationApiOrigin = process.env.EXTENSION_RELEASE_EXPECTED_API_ORIGIN || '';
const extensionPublicationHostname = (() => {
  try {
    return new URL(extensionPublicationApiOrigin).hostname.toLowerCase();
  } catch {
    return '';
  }
})();
const extensionPublicationRegion = extensionPublicationHostname.endsWith('.cn')
  ? 'CN' as const
  : extensionPublicationHostname.endsWith('.com')
    ? 'COM' as const
    : undefined;
await app.register(extensionDownloadRoutes, {
  prefix: '/api/extensions',
  allowVerifiedDevelopmentBuild: process.env.NODE_ENV === 'development'
    || process.env.NODE_ENV === 'test',
  publicationRoot: process.env.EXTENSION_WEBSITE_PUBLICATION_ROOT || undefined,
  expectedDistributionOrigin: extensionPublicationApiOrigin || undefined,
  expectedRegion: extensionPublicationRegion,
});
await app.register(announcementRoutes, { prefix: '/api/announcements' });
await app.register(systemStatusRoutes, { prefix: '/api/admin/system-status' });
await app.register(adminAiPromptTemplateRoutes, {
  prefix: '/api/admin/ai-prompt-templates',
  service: aiPromptTemplateRegistry,
});
await app.register(adminAiCostReconciliationRoutes, {
  prefix: '/api/admin/ai-cost-reconciliations',
  service: createAiCostReconciliationAdminService({ database: prisma as never }),
});
await app.register(adminAiProviderReconciliationRoutes, {
  prefix: '/api/admin/ai-provider-reconciliations',
  service: createAiProviderReconciliationAdminService({ database: prisma as never }),
});
await app.register(adminOzonPublisherParityRoutes, {
  prefix: '/api/admin/ozon-publisher-parity',
  service: sourceOzonPublisherParityObservationService,
});
await app.register(adminOzonPublisherRolloutRoutes, {
  prefix: '/api/admin/ozon-publisher-rollout',
  service: ozonPublisherRolloutAdminService,
});
await app.register(opsRoutes, { prefix: '/api/admin/ops' });
await app.register(sourceCandidateRoutes, { prefix: '/api/source-candidates' });
await app.register(aiImageRoutes, {
  prefix: '/api/ai-images',
  resolvePrompt: resolveActiveAiPrompt,
  getTranslationCategory: async ({ ownerUserId, context }: {
    ownerUserId: string;
    context:
      | { type: 'collect'; id: string; skuKey?: string | null; slotKey?: string | null }
      | {
        type: 'listing-draft'; id: string; revision: number; draftVersion: number;
        skuKey?: string | null; slotKey?: string | null;
      };
  }) => {
    if (context.type !== 'listing-draft') return null;
    try {
      const draft = await sourceListingWorkflowService.getDraft({
        draftId: context.id,
        ownerUserId,
      });
      if (draft.revision !== context.revision || draft.draftVersion !== context.draftVersion) return null;
      return resolveTrustedAiImageTranslationCategory(draft);
    } catch (error) {
      if (error instanceof SourceListingWorkflowError
        && error.code === 'OZON_LISTING_DRAFT_NOT_FOUND') return null;
      throw error;
    }
  },
});
const aiImageSuiteExecutionRepository = new PrismaAiImageSuiteExecutionRepository(prisma, {
  runtimeReady: aiImageSuiteRuntimeReady,
  getCostControls: getAiImageSuiteCostControls,
});
const aiImageSuiteGenerationCoordinator = new PrismaAiImageSuiteGenerationCoordinator(prisma, {
  runtimeReady: aiImageSuiteRuntimeReady,
  getRuntimeEvidence: aiImageSuiteRuntimeEvidence,
  outputStorageReady: async () => {
    const runtime = await getRuntimeConfigForStorage();
    return runtime.imageStorage === 'local' || runtime.imageStorage === 'oss';
  },
  getDispatchAuthorization: getAiImageSuiteDispatchAuthorization,
});
const aiImageSuitePreparationLease = createRedisAiImageSuitePreparationLease({
  redis,
  disabled: redisDisabled,
});
const enqueueAiImageSuiteFrontier = async (suiteId: string) => {
  const tasks = await aiImageSuiteExecutionRepository.listQueueableTasks(suiteId);
  await Promise.all(tasks.map((task) => enqueueAiImageSuiteGenerationRecoveryJob(task)));
};
await app.register(aiImageSuiteRoutes, {
  prefix: '/api/ai-images',
  getProviderConfig: async () => (await requireAiImageSuiteProviderRuntime()).providerConfig!,
  getSuiteRuntimeReadiness: async (
    ownerUserId: string,
    providerConfig: AiImageSuiteProviderConfig,
  ) => {
    const [operational, activeRuntime, authorization] = await Promise.all([
      probeAiImageSuiteRuntime({
        redis,
        queueAvailable: Boolean(aiImageSuiteGenerationQueue),
      }),
      getAiImageSuiteProviderRuntime(),
      getAiImageSuiteDispatchAuthorization(ownerUserId),
    ]);
    const providerRuntimeReady = activeRuntime.executionReady
      && aiImageSuiteProviderConfigMatches(providerConfig, activeRuntime);
    return {
      queueReady: operational.queueReady,
      runtimeReady: authorization.enabled && operational.workerReady && providerRuntimeReady,
    };
  },
  getReferenceStorageReadiness: async (
    _ownerUserId: string,
    providerConfig: AiImageSuiteProviderConfig,
  ) => {
    const runtime = await getRuntimeConfigForStorage();
    const backend = runtime.imageStorage;
    const publicBaseUrl = backend === 'oss'
      ? normalizeAiImageSuiteOssCdnDomain(runtime.oss?.cdnDomain) || runtime.localBaseUrl
      : runtime.localBaseUrl;
    return resolveAiImageSuiteReferenceStorageReadiness({
      provider: providerConfig.provider,
      backend,
      ossConfigured: Boolean(runtime.oss),
      publicBaseUrl: publicBaseUrl || null,
    });
  },
  referenceService: createAiImageSuiteReferenceService({
    repository: new PrismaAiImageSuiteReferenceRepository(prisma),
    preparationLease: aiImageSuitePreparationLease,
    getStorage: async () => {
      const runtime = await getRuntimeConfigForStorage();
      if (runtime.imageStorage === 'ozon-cdn') {
        throw new Error('AI image suite references require local or OSS storage');
      }
      const storage = await getStorageBackend();
      return {
        backend: runtime.imageStorage,
        uploadBuffer: storage.uploadBuffer.bind(storage),
      };
    },
  }),
  promptService: createAiImageSuitePromptService({
    repository: new PrismaAiImageSuitePromptRepository(prisma),
    templateResolver: aiPromptTemplateRegistry,
  }),
  materializationService: createAiImageSuiteMaterializationService(
    new PrismaAiImageSuiteMaterializationRepository(prisma, {
      getCostControls: getAiImageSuiteCostControls,
      getProviderRuntime: async () => getAiImageSuiteProviderRuntime(),
    }),
  ),
  executionService: createAiImageSuiteExecutionService(aiImageSuiteExecutionRepository),
  enqueueSuiteFrontier: enqueueAiImageSuiteFrontier,
});
await app.register(aiMediaPlanningRoutes, {
  prefix: '/api/ai-images',
});

// 静态文件：水印图片 + 上传图片
import { join } from 'path';
import { createReadStream, existsSync, readFileSync } from 'fs';

function isSafeFilename(name: string): boolean {
  return !name.includes('..') && !name.includes('/') && !name.includes('\\') && !name.includes('\0') && /^[\w.\-]+$/.test(name);
}

function setPublicImageHeaders(reply: any) {
  reply.header('Cache-Control', 'public, max-age=86400');
  reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
}

app.get('/watermarked/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (!isSafeFilename(filename)) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'watermarked', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  setPublicImageHeaders(reply);
  reply.type('image/jpeg');
  return reply.send(createReadStream(filepath));
});

app.get('/uploads/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (!isSafeFilename(filename)) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'uploads', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  const ext = filename.toLowerCase().split('.').pop();
  setPublicImageHeaders(reply);
  reply.type(ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  return reply.send(createReadStream(filepath));
});

app.get('/resized/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  if (!isSafeFilename(filename)) return reply.status(400).send('invalid');
  const filepath = join(process.cwd(), 'public', 'resized', filename);
  if (!existsSync(filepath)) return reply.status(404).send('not found');
  setPublicImageHeaders(reply);
  reply.type('image/jpeg');
  return reply.send(createReadStream(filepath));
});

await seedServiceTags();
await seedSuperAdmin();
await seedSystemConfig();

const RUN_WORKERS = process.env.RUN_WORKERS !== '0' && process.env.RUN_WORKERS !== 'false';

if (RUN_WORKERS) {
  const [
    { startWarehouseCommandPollWorker },
    { startNotificationCleanupWorker },
    { startOssCleanupWorker },
    { startDatabaseBackupWorker },
    { startRechargeTimeoutWorker },
    { startListingTaskRefreshWorker },
    { startOzonPublishReconciliationWorker },
    { startAiProviderReconciliationWorker },
    { startExtensionByokUploadCleanupWorker },
  ] = await Promise.all([
    import('./workers/warehouse-command-poll.js'),
    import('./workers/notification-cleanup.js'),
    import('./workers/oss-cleanup.js'),
    import('./workers/database-backup.js'),
    import('./workers/recharge-timeout.js'),
    import('./workers/listing-task-refresh.js'),
    import('./workers/ozon-publish-reconciliation.js'),
    import('./workers/ai-provider-reconciliation.js'),
    import('./workers/extension-byok-upload-cleanup.js'),
  ]);

  startWarehouseCommandPollWorker();
  startNotificationCleanupWorker();
  startOssCleanupWorker();
  startDatabaseBackupWorker();
  startRechargeTimeoutWorker();
  startListingTaskRefreshWorker();
  startOzonPublishReconciliationWorker({
    runTick: () => runOzonPublishReconciliationTick({
      repository: sourceOzonPublishAttemptRepository,
      resolveOwnedClient: async (ownerUserId, shopId) => {
        const client = await loadOwnedSourceListingOzonClient(ownerUserId, shopId);
        return {
          getImportInfo: (taskId) => {
            return client.getImportInfo(taskId);
          },
          getProductInfoByOfferId: (offerIds) => client.getProductInfoByOfferId(offerIds),
        };
      },
      settings: {
        workerId: `ozon-publish-reconciliation:${sourceOzonPublisherInstanceId}:${process.pid}`,
      },
      logger: {
        info: (message, details) => app.log.info({ details }, message),
        warn: (message, details) => app.log.warn({ details }, message),
        error: (message, details) => app.log.error({ err: details }, message),
      },
    }),
    logger: {
      info: (message, details) => app.log.info({ details }, message),
      error: (message, details) => app.log.error({ err: details }, message),
    },
  });
  startAiProviderReconciliationWorker({
    logger: {
      error: (message, details) => app.log.error({ err: details }, message),
    },
  });
  startExtensionByokUploadCleanupWorker();
  if (process.env.REDIS_DISABLED !== '1' && process.env.REDIS_DISABLED !== 'true') {
    const [
      { startProductSyncWorker },
      { startOrderSyncWorker },
      { startSoloBillingWorker },
      { startScheduledDispatchWorker },
      { startExchangeRateSyncWorker },
      { startFinanceSyncWorker },
      { startBrowserOneClickListingWorker },
      { startAiImageGenerationWorker },
      { startAiImageTranslationWorker },
      { startAiImageEditWorker },
      { startAiImageSuiteGenerationWorker },
    ] = await Promise.all([
      import('./workers/product-sync.js'),
      import('./workers/order-sync.js'),
      import('./workers/solo-billing.js'),
      import('./workers/scheduled-dispatch.js'),
      import('./workers/exchange-rate-sync.js'),
      import('./workers/finance-sync.js'),
      import('./workers/browser-one-click-listing.js'),
      import('./workers/ai-image-generation.js'),
      import('./workers/ai-image-translation.js'),
      import('./workers/ai-image-edit.js'),
      import('./workers/ai-image-suite-generation.js'),
    ]);

    startProductSyncWorker();
    startOrderSyncWorker();
    startSoloBillingWorker();
    startScheduledDispatchWorker();
    startExchangeRateSyncWorker();
    startFinanceSyncWorker();
    startBrowserOneClickListingWorker();
    startAiImageGenerationWorker();
    startAiImageTranslationWorker();
    startAiImageEditWorker();
    startAiImageSuiteGenerationWorker(aiImageSuiteGenerationCoordinator);
  } else {
    console.log('[bootstrap] REDIS_DISABLED=1, skipping BullMQ workers');
  }
} else {
  console.log('[bootstrap] RUN_WORKERS=0, this instance is API-only (no workers)');
}

const port = Number(process.env.SERVER_PORT) || 3001;
const host = process.env.SERVER_HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
  app.log.info(`Server running at http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing gracefully...`);
  try {
    const { shutdownAllWorkers } = await import('./lib/worker-registry.js');
    await shutdownAllWorkers(30000);
    await app.close();
    process.exit(0);
  } catch (err) {
    console.error('[shutdown] error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
