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
import { aiImageRoutes } from './routes/ai-images.js';
import { aiImageSuiteRoutes } from './routes/ai-image-suites.js';
import { aiMediaPlanningRoutes } from './routes/ai-media-plans.js';
import type { AiImageSuiteProviderConfig } from './services/ai-image-suite.js';
import { PrismaAiImageSuiteReferenceRepository } from './repositories/ai-image-suite-reference-repository.js';
import { PrismaAiImageSuitePromptRepository } from './repositories/ai-image-suite-prompt-repository.js';
import { PrismaAiImageSuiteMaterializationRepository } from './repositories/ai-image-suite-materialization-repository.js';
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
import {
  createSourceWorkflowCommandResolver,
  extensionCommandGrantRoutes,
} from './routes/extension-command-grants.js';
import { extensionSourceCaptureRoutes } from './routes/extension-source-captures.js';
import { extensionSourceWorkbenchRoutes } from './routes/extension-source-workbench.js';
import { extensionMediaLaunchRoutes } from './routes/extension-media-launch.js';
import { sourceWorkflowFeatureFlags } from './services/source-workflow-feature-flags.js';
import {
  SourceListingWorkflowError,
  createSourceListingWorkflowService,
} from './services/source-listing-workflow.js';
import { createSourceListingAiCopyService } from './services/source-listing-ai-copy.js';
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
import { getStorageBackend } from './services/image-storage.js';
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
  createExtensionMediaTranslationLauncher,
  resolveExtensionMediaWorkflowSourceMediaKey,
  resolveExtensionMediaTranslationReadiness,
} from './services/extension-media-workflow-launch.js';
import { resolveAiImageTranslationStorageReadiness } from './services/ai-image-translation-storage.js';
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
} from './services/ozon-category-catalog.js';
import type { OzonClient, OzonImportItem } from './services/ozon-client.js';
import { createOzonListingPublisher } from './services/ozon-listing-publisher.js';
import { createPrismaOzonPublishAttemptRepository } from './services/ozon-publish-attempt-prisma.js';
import {
  createOzonListingProductionCompileAdapter,
  type OzonListingProductionCompileAdapterOptions,
} from './services/ozon-listing-production-compile-adapter.js';
import { createOzonPublisherEntrypointParityObserver } from './services/ozon-publisher-entrypoint-parity-shadow.js';
import { createPrismaOzonPublisherRolloutRecorder } from './services/ozon-publisher-rollout-recorder.js';
import { createOzonPublisherParityObservationService } from './services/ozon-publisher-parity-observations.js';
import { createPrismaOzonPublisherParityObservationRepository } from './services/ozon-publisher-parity-prisma.js';
import { getConfig } from './config/system-config-schema.js';
import { generateProductContentDraft } from './services/product-content-ai.js';
import { generateAiText } from './services/ai-text.js';
import { createPrismaAiTranslationCacheStore } from './services/ai-translation-cache.js';
import { createPrismaAiUsageStore } from './services/ai-usage.js';
import { runOzonPublishReconciliationTick } from './services/ozon-publish-reconciliation.js';
import type { OzonListingDraft, SourceProductCaptureV2 } from 'shared';
import { createExtensionDeviceSessionService } from './services/extension-device-session.js';
import { createPrismaExtensionDeviceSessionRepository } from './services/extension-device-session-prisma.js';
import {
  createExtensionCommandGrantService,
  resolveExtensionCommandGrantSecret,
} from './services/extension-command-grants.js';
import {
  createPrismaExtensionCommandGrantStore,
} from './services/extension-command-grants-prisma.js';
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
  trustProxy: process.env.NODE_ENV === 'production',
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
  return reply.status(healthy ? 200 : 503).send({ status: healthy ? 'ready' : 'degraded', checks });
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
    await sourceListingWorkflowCategoryValidator.validate({
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
const sourceOzonListingProductionCompile = createOzonListingProductionCompileAdapter({
  ...sourceOzonListingCompileAuthorityLoaders,
  loadAuthoritativeValidation: ({ ownerUserId, draft }) => (
    sourceListingWorkflowAttributeService.validateAuthoritative({ ownerUserId, draft })
  ),
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
const sourceOzonListingPublisher = createOzonListingPublisher({
  workflow: sourceListingWorkflowService,
  attempts: sourceOzonPublishAttemptRepository,
  compile: sourceOzonListingProductionCompile,
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
const extensionDeviceRepository = isExtensionDeviceAuthEnabled()
  ? createPrismaExtensionDeviceSessionRepository()
  : null;
let sourceCaptureService: ReturnType<typeof createSourceCaptureService> | null = null;
if (isExtensionDeviceAuthEnabled()) {
  if (!extensionDeviceRepository) throw new Error('Extension device repository is unavailable');
  const extensionDeviceAuthConfig = resolveExtensionDeviceAuthConfig();
  const extensionCommandGrantSecret = resolveExtensionCommandGrantSecret();
  const extensionMediaWorkflowService = createAiMediaWorkflowService(
    new PrismaAiMediaWorkflowRepository(prisma),
  );
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
          where: { ordinal: 0 },
          orderBy: { id: 'asc' },
          take: 1,
          select: { asset: { select: { sourceMediaKey: true, metadata: true } } },
        },
        jobs: {
          orderBy: [{ workflowAttempt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, provider: true },
        },
      },
    });
    if (!row) return null;
    const sourceAsset = row.inputs[0]?.asset;
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      operation: String(row.operation),
      provider: row.jobs[0]?.provider || null,
      status: String(row.status),
      revision: row.revision,
      contextType: row.contextType,
      contextId: row.contextId,
      contextDraftRevision: row.contextDraftRevision,
      contextDraftVersion: row.contextDraftVersion,
      suiteId: row.suiteSlot?.suiteId || null,
      sourceMediaKey: resolveExtensionMediaWorkflowSourceMediaKey(sourceAsset),
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
      return {
        id: draft.id,
        ownerUserId: draft.ownerUserId,
        shopId: draft.shopId,
        supplyGoodsId: draft.supplyGoodsId,
        snapshotId: draft.sourceCaptureSnapshotId,
        revision: draft.revision,
        draftVersion: draft.draftVersion,
        sourceMediaKeys: [...new Set(context.inputs
          .map((item) => String(item.sourceMediaKey || '').trim())
          .filter(Boolean))].slice(0, 50),
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
    getSettings: async () => ({
      enabled: await getConfig('feature_image_translate'),
      provider: await getConfig('ai_image_translation_provider'),
      model: await getConfig('ai_image_translation_model'),
      dailyLimit: await getConfig('ai_user_daily_image_translation_limit'),
      estimatedCostCents: await getConfig('ai_image_translation_cost_cents'),
    }),
    getStorageReadiness: async () => {
      try {
        return resolveAiImageTranslationStorageReadiness(await getRuntimeConfigForStorage());
      } catch {
        return { ready: false, reason: 'Image translation storage is unavailable' };
      }
    },
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
    launchTranslation: extensionMediaTranslationLauncher,
    loadListingDraft: loadExtensionListingDraft,
    getTranslationDailyLimit: async () => getConfig('ai_user_daily_image_translation_limit'),
    getEditDailyLimit: async () => getConfig('ai_user_daily_image_generation_limit'),
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
  });
  const executeExtensionMediaReviewCommand = createExtensionMediaReviewCommandExecutor({
    workflowService: extensionMediaWorkflowService,
    loadListingDraft: loadExtensionListingDraft,
    production: process.env.NODE_ENV === 'production',
  });
  const executeExtensionMediaApplyCommand = createExtensionMediaApplyCommandExecutor({
    workflowService: extensionMediaWorkflowService,
    applyListingDraftApplication: (input) => applyAiMediaListingDraftApplication(prisma, input),
    production: process.env.NODE_ENV === 'production',
  });
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
  });
  await app.register(extensionCommandGrantRoutes, {
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
      loadShop: ({ shopId, ownerUserId }) => prisma.shop.findFirst({
        where: { id: shopId, userId: ownerUserId },
        select: { id: true, userId: true, platform: true, status: true },
      }),
      loadDraft: ({ workflowId, ownerUserId }) => sourceListingWorkflowService.getDraft({
        draftId: workflowId,
        ownerUserId,
      }),
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
                status: true,
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
    executeOzonPublish: async ({ ownerUserId, actorUserId, workflowId, command }) => {
      const commandRow = command as { draftRevision?: unknown; publishIntentId?: unknown };
      const expectedRevision = Number(commandRow.draftRevision);
      const idempotencyKey = String(commandRow.publishIntentId || '').trim();
      if (!Number.isSafeInteger(expectedRevision) || !idempotencyKey) {
        throw new Error('Ozon publish command identity is invalid');
      }
      return sourceOzonListingPublisher.publish({
        draftId: workflowId,
        ownerUserId,
        actorUserId,
        expectedRevision,
        idempotencyKey,
      });
    },
    executeMediaWorkflowCommand: executeExtensionMediaWorkflowCommand,
    executeMediaReviewCommand: executeExtensionMediaReviewCommand,
    executeMediaApplyCommand: executeExtensionMediaApplyCommand,
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
      const draft = await sourceListingWorkflowService.getDraft({
        draftId: listingWorkflowId,
        ownerUserId,
      });
      if (draft.shopId !== shopId
        || draft.supplyGoodsId !== supplyGoodsId
        || draft.sourceCaptureSnapshotId !== snapshotId
        || draft.revision !== revision
        || draft.draftVersion !== draftVersion) return null;
      const context = await extensionMediaContextService.loadListingDraft(
        ownerUserId,
        listingWorkflowId,
        { expectedRevision: revision, expectedDraftVersion: draftVersion },
      );
      return {
        id: draft.id,
        ownerUserId: draft.ownerUserId,
        shopId: draft.shopId,
        supplyGoodsId: draft.supplyGoodsId,
        snapshotId: draft.sourceCaptureSnapshotId,
        revision: draft.revision,
        draftVersion: draft.draftVersion,
        sourceMediaKeys: [...new Set(context.inputs
          .map((item) => String(item.sourceMediaKey || '').trim())
          .filter(Boolean))].slice(0, 50),
      };
    },
    getCapability: async ({ workflowDecision }) => {
      const [enabled, provider, model, dailyLimit, estimatedCostCents, storage] = await Promise.all([
        getConfig('feature_image_translate'),
        getConfig('ai_image_translation_provider'),
        getConfig('ai_image_translation_model'),
        getConfig('ai_user_daily_image_translation_limit'),
        getConfig('ai_image_translation_cost_cents'),
        getRuntimeConfigForStorage().then(resolveAiImageTranslationStorageReadiness),
      ]);
      const readiness = resolveExtensionMediaTranslationReadiness({
        settings: {
          enabled,
          provider,
          model,
          dailyLimit,
          estimatedCostCents,
        },
        production: process.env.NODE_ENV === 'production',
        storageReadiness: storage,
      });
      return {
        enabled: readiness.enabled,
        ready: readiness.ready,
        reasonCode: readiness.reasonCode,
        reason: readiness.reason,
        revision: workflowDecision.revision,
        testOnly: true as const,
        operation: 'IMAGE_TRANSLATE' as const,
        sourceLanguage: 'zh' as const,
        targetLanguage: 'ru' as const,
      };
    },
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
await app.register(extensionDownloadRoutes, { prefix: '/api/extensions' });
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
});
const aiImageSuiteRuntimeReady = async (suite: {
  provider: string;
  model: string;
  estimatedCostCents: number;
  maximumCostCents: number;
}) => Boolean(
  aiImageSuiteGenerationQueue
  && process.env.NODE_ENV !== 'production'
  && suite.provider === 'fake'
  && suite.model === 'fake-image-suite-v1'
  && Number(suite.estimatedCostCents) === 0
  && Number(suite.maximumCostCents) === 0
);
const aiImageSuiteExecutionRepository = new PrismaAiImageSuiteExecutionRepository(prisma, {
  runtimeReady: aiImageSuiteRuntimeReady,
});
const aiImageSuiteGenerationCoordinator = new PrismaAiImageSuiteGenerationCoordinator(prisma, {
  runtimeReady: aiImageSuiteRuntimeReady,
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
  getSuiteRuntimeReadiness: async (
    _ownerUserId: string,
    providerConfig: AiImageSuiteProviderConfig,
  ) => {
    const operational = await probeAiImageSuiteRuntime({
      redis,
      queueAvailable: Boolean(aiImageSuiteGenerationQueue),
    });
    const providerRuntimeReady = await aiImageSuiteRuntimeReady({
      provider: providerConfig.provider,
      model: providerConfig.model,
      estimatedCostCents: providerConfig.estimatedCostPerImageCents,
      maximumCostCents: providerConfig.maximumCostPerImageCents,
    });
    return {
      queueReady: operational.queueReady,
      runtimeReady: operational.workerReady && providerRuntimeReady,
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
    new PrismaAiImageSuiteMaterializationRepository(prisma),
  ),
  executionService: createAiImageSuiteExecutionService(aiImageSuiteExecutionRepository),
  enqueueSuiteFrontier: enqueueAiImageSuiteFrontier,
});
await app.register(aiMediaPlanningRoutes, {
  prefix: '/api/ai-images',
});

// 静态文件：水印图片 + 上传图片
import { join } from 'path';
import { createReadStream, existsSync } from 'fs';

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
  ] = await Promise.all([
    import('./workers/warehouse-command-poll.js'),
    import('./workers/notification-cleanup.js'),
    import('./workers/oss-cleanup.js'),
    import('./workers/database-backup.js'),
    import('./workers/recharge-timeout.js'),
    import('./workers/listing-task-refresh.js'),
    import('./workers/ozon-publish-reconciliation.js'),
    import('./workers/ai-provider-reconciliation.js'),
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
            const numericTaskId = typeof taskId === 'number' ? taskId : Number(taskId);
            if (!Number.isSafeInteger(numericTaskId) || numericTaskId <= 0) {
              throw new Error('Ozon import task ID exceeds the supported read contract');
            }
            return client.getImportInfo(numericTaskId);
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
