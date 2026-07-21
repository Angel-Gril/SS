try { importScripts('../shared/logistics-rules/distribution-feature.js'); } catch (e) { console.warn('[SS ERP] logistics feature gate load error:', e); }
try { importScripts('../shared/message-security/runtime-message-policy.js'); } catch (e) { console.warn('[SS ERP] runtime message policy load error:', e); }
try { importScripts('../shared/currency/price-currency.js'); } catch (e) { console.warn('[SS ERP] price-currency load error:', e); }
try { importScripts('../shared/contracts/source-product-capture-v2.js'); } catch (e) { console.warn('[SS ERP] source capture V2 contract load error:', e); }
try { importScripts('../shared/source-capture/source-capture-submit.js'); } catch (e) { console.warn('[SS ERP] source capture V2 submit helper load error:', e); }
try { importScripts('../shared/ozon/variant-spec.js'); } catch (e) { console.warn('[SS ERP] ozon variant spec load error:', e); }
try { importScripts('../shared/ozon/collection-policy.js'); } catch (e) { console.warn('[SS ERP] ozon collection policy load error:', e); }
try { importScripts('../shared/ozon/sku-workbench.js'); } catch (e) { console.warn('[SS ERP] ozon sku workbench load error:', e); }

// Import collect/analytics background module
try { importScripts('collect-background.js'); } catch (e) { console.warn('[SS ERP] collect-background load error:', e); }

// Import runtime mode detection (cloud/local)
try { importScripts('../shared/erp-adapter/runtime-mode.js'); } catch (e) { console.warn('[SS ERP] runtime-mode load error:', e); }

// Import adapter layer (runtime-config → local/cloud adapter → unified client)
try {
  importScripts('../shared/adapters/runtime-config.js');
  importScripts('../shared/adapters/local-adapter.js');
  importScripts('../shared/adapters/cloud-adapter.js');
  importScripts('../shared/adapters/erp-client.js');
} catch (e) { console.warn('[SS ERP] adapter layer load error:', e); }

const OZON_CALC_SYNC_CHANNEL = 'ozon-calc:sync-config';
const OZON_CALC_SETTINGS_WRITE_CHANNELS = new Set([
  'ozon-calculator:build-config-from-captured-seller',
  'ozon-calculator:sync-captured-seller-official',
  'ozon-calculator:sync-captured-official',
  'ozon-calculator:update-fee-settings',
  'ozon-calculator:clear-captured-har',
  'ss-erp:logistics-device-claim',
  'ss-erp:logistics-device-clear',
  'ss-erp:logistics-device-status',
  'ss-erp:logistics-rules-sync',
  'ss-erp:logistics-capture-refresh',
  'ss-erp:logistics-capture-retry',
  'ss-erp:logistics-capture-status',
  'ss-erp:logistics-capture-cancel',
  'ss-erp:logistics-binding-probe-run',
  'ss-erp:logistics-binding-probe-status',
]);
const OZON_CALC_IMPORT_PAGE_WRITE_CHANNELS = new Set(['ozon-calc:erp-endpoint-save']);
const OZON_CALC_ERP_QUEUE_KEY = 'ozon-calc:erp-queue';
const OZON_CALC_CAPTURE_ENTRIES_KEY = 'ozon-calc:capture-har-entries';
const OZON_CALC_PRODUCT_POOL_KEY = 'ozon-calc:product-pool';
const SS_ERP_SOURCE_CANDIDATES_KEY = 'ss-erp:source-candidates';
const SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY = 'ss-erp:source-candidate-context';
const SS_ERP_SOURCE_QUOTES_KEY = 'ss-erp:source-quotes';
const SS_ERP_SOURCE_QUOTE_PENDING_KEY = 'ss-erp:source-quote-pending';
const SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY = 'ss-erp:source-workflow:last-handoff:v1';
const SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY = 'ss-erp:source-workflow:handoffs:v2';
const SS_ERP_SOURCE_WORKFLOW_HANDOFF_LIMIT = 20;
const SS_ERP_OPEN_SOURCE_WORKFLOW_HANDOFF_MESSAGE = 'ss-erp:open-source-workflow-handoff';
const SS_ERP_IMAGE_SEARCH_JOBS_KEY = 'ss-erp:image-search-jobs';
const SS_ERP_SOURCE_SEARCH_PLATFORM_PREFS_KEY = 'ss-erp:source-search-platforms';
const SS_ERP_DEFAULT_SOURCE_SEARCH_PLATFORMS = ['1688', 'pdd', 'taobao'];
let imageSearchJobsQueue = Promise.resolve();
let ozonInsightCookieSyncInFlight = null;
const OZON_CALC_VISIBLE_SNAPSHOTS_KEY = 'ozon-calc:visible-snapshots';
const OZON_CALC_ERP_ENDPOINT_KEY = 'ozon-calc:erp-endpoint';
const OZON_CALC_ERP_TOKEN_KEY = 'ozon-calc:erp-token';
const OZON_CALC_ERP_PUSH_HISTORY_KEY = 'ozon-calc:erp-push-history';
const OZON_SYNC_LEGACY_COMPANY_ID_STORAGE_KEY = 'ss_erp_ozon_company_id';
const OZON_SYNC_LEGACY_COMPANY_ID_CAPTURED_AT_KEY = 'ss_erp_ozon_company_id_captured_at';
const OZON_SYNC_SESSION_COMPANY_ID_KEY = 'ss_erp_ozon_company_id_session';
const OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY = 'ss_erp_ozon_company_id_session_captured_at';
const OZON_SYNC_RECENT_COMPANY_ID_MS = 10 * 60 * 1000;
const SS_ERP_SYNC_TIMES_KEY = 'ss_erp_sync_times';
const SS_ERP_OZON_AUTO_SYNC_STATE_KEY = 'ss_erp_ozon_auto_sync_state';
const SS_ERP_OZON_AUTO_SYNC_ALARM_NAME = 'ss-erp:ozon-auto-sync';
const SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES = 30;
const SS_ERP_OZON_AUTO_SYNC_INTERVAL_MS = SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES * 60 * 1000;
const SS_ERP_OZON_INSIGHT_COOKIE_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const OZON_CALC_CONFIG_SNAPSHOT_KEY = 'ozon-calc:config-snapshot';
const OZON_CALC_CONFIG_UPDATED_AT_KEY = 'ozon-calc:config-updated-at';
const OZON_LOGISTICS_CALCULATOR_STATE_KEY = 'ozon-logistics:calculator-state:v1';
const OZON_OFFICIAL_SNAPSHOT_KEY = 'ozon-calculator:official-snapshot';
const OZON_COMMISSION_SNAPSHOT_KEY = 'ozon-calculator:commission-snapshot';
const OZON_FX_SNAPSHOT_KEY = 'ozon-calculator:fx-snapshot';
const OZON_COMMISSION_DOC_URLS = [
  'https://global-help.ozon.com/zh/commissions/ozon-fees/commissions?region=CHN',
  'https://global-help.ozon.com/en/commissions/ozon-fees/commissions?region=CHN',
  'https://docs.ozon.com/global/zh-hans/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.com/global/en/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.ru/global/zh-hans/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.ru/global/en/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.com/global/zh-hans/commissions',
  'https://docs.ozon.ru/global/zh-hans/commissions',
];
const OZON_COMMISSION_FALLBACK_SNAPSHOT = {
  sourceUrl: 'local-fallback:ozon-chn-commission',
  source: 'local-fallback',
  rules: [
    {
      group: 'fallback',
      category: '智能手机和手机配件',
      aliases: ['手机配件', 'зарядное устройство', 'зарядка', 'кабель', 'iphone', 'phone', 'charger', 'magsafe'],
      bands: [
        { minRUB: 0, maxRUB: 1500, rfbs: 13, fbp: 13 },
        { minRUB: 1500, maxRUB: 5000, rfbs: 13, fbp: 13 },
        { minRUB: 5000, maxRUB: 0, rfbs: 13, fbp: 13 },
      ],
    },
    {
      group: 'fallback',
      category: '美容与健康',
      aliases: ['косметика', 'парфюм', 'уход', 'beauty', 'cosmetics', 'миостимулятор', 'массажер'],
      bands: [
        { minRUB: 0, maxRUB: 1500, rfbs: 15, fbp: 15 },
        { minRUB: 1500, maxRUB: 5000, rfbs: 15, fbp: 15 },
        { minRUB: 5000, maxRUB: 0, rfbs: 15, fbp: 15 },
      ],
    },
    {
      group: 'fallback',
      category: '家居与花园',
      aliases: ['декор', 'для дома', 'интерьера', 'home', 'decor', 'рафия'],
      bands: [
        { minRUB: 0, maxRUB: 1500, rfbs: 12, fbp: 12 },
        { minRUB: 1500, maxRUB: 5000, rfbs: 12, fbp: 12 },
        { minRUB: 5000, maxRUB: 0, rfbs: 12, fbp: 12 },
      ],
    },
    {
      group: 'fallback',
      category: '默认类目',
      aliases: ['default', 'прочее', 'товары'],
      bands: [
        { minRUB: 0, maxRUB: 1500, rfbs: 15, fbp: 15 },
        { minRUB: 1500, maxRUB: 5000, rfbs: 15, fbp: 15 },
        { minRUB: 5000, maxRUB: 0, rfbs: 15, fbp: 15 },
      ],
    },
  ],
  diagnostics: {
    fallbackReason: 'Ozon help pages can reject extension background fetches with 403 or redirect loops',
  },
};
globalThis.OZON_COMMISSION_FALLBACK_SNAPSHOT = OZON_COMMISSION_FALLBACK_SNAPSHOT;
const OZON_FX_API_URL = 'https://open.er-api.com/v6/latest/CNY';
const OZON_CALC_CAPTURE_LIMIT = 200;
const OZON_CALC_VISIBLE_SNAPSHOT_LIMIT = 50;
const OZON_CALC_ERP_PUSH_HISTORY_LIMIT = 20;
const SS_ERP_SOURCE_CANDIDATE_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;

try {
  importScripts('../shared/capture-bridge/captured-har-store.js');
} catch (error) {
  console.warn('[ozon-calc] capture store import failed', error);
}

try {
  importScripts('../shared/capture-bridge/provider-inventory-capture.js');
} catch (error) {
  console.warn('[SS ERP] provider inventory capture module failed to load', error);
}

try {
  importScripts('../shared/product-pool/product-pool-store.js');
} catch (error) {
  console.warn('[ozon-calc] product pool store import failed', error);
}

try {
  importScripts('../shared/source-candidates/source-candidate-store.js');
} catch (error) {
  console.warn('[SS ERP] source candidate store import failed', error);
}

try {
  importScripts('../shared/source-quotes/source-quote-store.js');
} catch (error) {
  console.warn('[SS ERP] source quote store import failed', error);
}

try {
  importScripts('../shared/source-search/image-search-job.js');
} catch (error) {
  console.warn('[SS ERP] image search job helper import failed', error);
}

try {
  importScripts('../shared/seller-products/seller-products-export.js');
} catch (error) {
  console.warn('[ozon-calc] seller products exporter import failed', error);
}

try {
  importScripts('../shared/official-freight/official-freight-export.js');
} catch (error) {
  console.warn('[ozon-calc] official freight exporter import failed', error);
}

try {
  importScripts('../shared/seller-logistics/seller-logistics-export.js');
} catch (error) {
  console.warn('[ozon-calc] seller logistics exporter import failed', error);
}

try {
  importScripts('../shared/calculator-core/catalog-store.js');
  importScripts('../shared/calculator-core/rule-engine.js');
  importScripts('../shared/calculator-core/har-import.js');
  importScripts('../shared/commission/commission-rates.js');
  importScripts('../shared/currency/fx-rates.js');
  importScripts('../shared/config-bridge/sync-schema.js');
} catch (error) {
  console.warn('[ozon-calc] calculator config import failed', error);
}

try {
  importScripts('../shared/logistics-rules/distribution-schema.js');
  importScripts('../shared/logistics-rules/device-credential-manager.js');
  importScripts('../shared/logistics-rules/version-policy.js');
  importScripts('../shared/logistics-rules/distribution-store.js');
  importScripts('../shared/logistics-rules/distribution-client.js');
  importScripts('../shared/logistics-rules/distribution-runtime.js');
} catch (error) {
  console.warn('[SS ERP] logistics distribution modules failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-workflow-device-session.js'); } catch (error) {
  console.warn('[SS ERP] source workflow device session module failed to load', error);
}
try { importScripts('../shared/erp-adapter/listing-workflow-client.js'); } catch (error) {
  console.warn('[SS ERP] listing workflow client module failed to load', error);
}

try { importScripts('../shared/logistics-rules/manual-fallback-persistence.js'); } catch (error) {
  console.warn('[SS ERP] logistics manual fallback module failed to load', error);
}

try {
  importScripts('../shared/logistics-rules/capture-task-adapter.js');
  importScripts('../shared/logistics-rules/capture-task-runtime.js');
} catch (error) {
  console.warn('[SS ERP] logistics capture modules failed to load', error);
}

try {
  importScripts('../shared/logistics-rules/binding-probe-adapter.js');
  importScripts('../shared/logistics-rules/binding-probe-collector.js');
  importScripts('../shared/logistics-rules/binding-probe-runtime.js');
} catch (error) {
  console.warn('[SS ERP] logistics binding probe modules failed to load', error);
}

let logisticsDistributionRuntime = null;
let logisticsDistributionMessageHandler = null;
let logisticsDeviceCredentials = null;
let logisticsManualFallbackPersistence = null;
let logisticsCaptureRuntime = null;
let logisticsCaptureMessageHandler = null;
let logisticsBindingProbeRuntime = null;
let logisticsBindingProbeMessageHandler = null;
let sourceCaptureSubmitter = null;
let sourceListingWorkflowClient = null;
const SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME = 'ss-erp-logistics-rule-sync-v1';
const SS_ERP_LOGISTICS_RULE_SYNC_INTERVAL_MINUTES = 30;
const SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME = 'ss-erp-logistics-capture-v1';
const SS_ERP_LOGISTICS_CAPTURE_INTERVAL_MINUTES = 1;

function isLogisticsDistributionFeatureEnabled() {
  const feature = globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE;
  return Boolean(feature && feature.enabled === true);
}

function disableLogisticsDistributionAlarms() {
  if (!chrome.alarms || typeof chrome.alarms.clear !== 'function') return;
  chrome.alarms.clear(SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME);
  chrome.alarms.clear(SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME);
}

function logisticsDistributionDisabledResult() {
  return { state: 'disabled', errorCode: 'feature_disabled' };
}

function getLogisticsDeviceCredentials() {
  if (logisticsDeviceCredentials) return logisticsDeviceCredentials;
  const api = globalThis.SS_ERP_EXTENSION_DEVICE_CREDENTIALS;
  if (!api || typeof api.createManager !== 'function') {
    throw new Error('扩展设备凭据管理器不可用');
  }
  logisticsDeviceCredentials = api.createManager({
    localStorage: chrome.storage.local,
    fetchImpl: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
  });
  return logisticsDeviceCredentials;
}

function getSourceCaptureSubmitter() {
  if (sourceCaptureSubmitter) return sourceCaptureSubmitter;
  const api = globalThis.SS_ERP_SOURCE_CAPTURE_SUBMIT;
  const contract = globalThis.SS_ERP_SOURCE_PRODUCT_CAPTURE_V2;
  if (!api || typeof api.createSubmitter !== 'function') {
    throw new Error('来源采集 V2 提交模块不可用');
  }
  if (!contract || typeof contract.createSourceProductCaptureV2Submission !== 'function') {
    throw new Error('来源采集 V2 契约不可用');
  }
  if (!self.SS_ERP_CLIENT) throw new Error('ERP 适配器未加载，请重新加载扩展后重试');
  sourceCaptureSubmitter = api.createSubmitter({
    credentials: getLogisticsDeviceCredentials(),
    client: self.SS_ERP_CLIENT,
    contract,
  });
  return sourceCaptureSubmitter;
}

function getSourceListingWorkflowClient() {
  if (sourceListingWorkflowClient) return sourceListingWorkflowClient;
  const sessionApi = globalThis.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION;
  const clientApi = globalThis.SS_ERP_LISTING_WORKFLOW_CLIENT;
  if (!sessionApi || typeof sessionApi.createTransport !== 'function'
    || !clientApi || typeof clientApi.createClient !== 'function') {
    throw new Error('来源商品扩展工作台模块不可用');
  }
  sourceListingWorkflowClient = clientApi.createClient({
    transport: sessionApi.createTransport({
      credentials: getLogisticsDeviceCredentials(),
      fetchImpl: globalThis.fetch.bind(globalThis),
    }),
  });
  return sourceListingWorkflowClient;
}

function sourceWorkflowHandoffText(value, maxLength) {
  const text = String(value == null ? '' : value).normalize('NFKC').trim();
  return text && text.length <= maxLength ? text : '';
}

function sourceWorkflowPlatform(value) {
  const platform = sourceWorkflowHandoffText(value, 20).toLowerCase();
  return ['1688', 'pdd', 'taobao', 'tmall'].includes(platform) ? platform : '';
}

function sourceWorkflowHandoffIdentity(platform, sourceProductId) {
  return encodeURIComponent(platform) + ':' + encodeURIComponent(sourceProductId);
}

function buildSourceWorkflowHandoffPath(value) {
  const params = new URLSearchParams();
  params.set('supplyGoodsId', value.supplyGoodsId);
  params.set('snapshotId', value.snapshotId);
  params.set('snapshotVersion', String(value.snapshotVersion));
  if (value.sourceProductId) params.set('sourceProductId', value.sourceProductId);
  params.set('platform', value.platform);
  params.set('section', 'listing');
  return '/collect/source?' + params.toString();
}

function buildLegacySourceWorkflowHandoffPath(value) {
  const params = new URLSearchParams();
  params.set('supplyGoodsId', value.supplyGoodsId);
  params.set('snapshotId', value.snapshotId);
  params.set('snapshotVersion', String(value.snapshotVersion));
  if (value.sourceProductId) params.set('sourceProductId', value.sourceProductId);
  params.set('section', 'listing');
  return '/collect/source?' + params.toString();
}

function createSourceWorkflowHandoff(result, sourceProductIdValue, platformValue) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  const supplyGoodsId = sourceWorkflowHandoffText(source.supplyGoodsId, 200);
  const snapshotId = sourceWorkflowHandoffText(source.snapshotId, 200);
  const snapshotVersion = Number(source.snapshotVersion);
  const sourceProductId = sourceWorkflowHandoffText(sourceProductIdValue, 200);
  const platform = sourceWorkflowPlatform(platformValue || source.platform);
  if (!supplyGoodsId || !snapshotId || !sourceProductId || !platform
    || !Number.isSafeInteger(snapshotVersion) || snapshotVersion < 1) {
    return null;
  }
  const identity = {
    supplyGoodsId,
    snapshotId,
    snapshotVersion,
    sourceProductId,
    platform,
  };
  return { ...identity, path: buildSourceWorkflowHandoffPath(identity) };
}

function validateSourceWorkflowHandoff(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowedKeys = new Set(['supplyGoodsId', 'snapshotId', 'snapshotVersion', 'sourceProductId', 'platform', 'path']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  const normalized = createSourceWorkflowHandoff(value, value.sourceProductId, value.platform);
  if (!normalized || sourceWorkflowHandoffText(value.path, 2048) !== normalized.path) return null;
  return normalized;
}

function migrateLegacySourceWorkflowHandoff(value, platformValue, sourceProductIdValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowedKeys = new Set(['supplyGoodsId', 'snapshotId', 'snapshotVersion', 'sourceProductId', 'path']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  const platform = sourceWorkflowPlatform(platformValue);
  const sourceProductId = sourceWorkflowHandoffText(sourceProductIdValue, 200);
  if (platform !== '1688' || !sourceProductId
    || sourceWorkflowHandoffText(value.sourceProductId, 200) !== sourceProductId) return null;
  const migrated = createSourceWorkflowHandoff(value, sourceProductId, platform);
  if (!migrated
    || sourceWorkflowHandoffText(value.path, 2048) !== buildLegacySourceWorkflowHandoffPath(migrated)) {
    return null;
  }
  return migrated;
}

let sourceWorkflowHandoffWriteQueue = Promise.resolve();

function enqueueSourceWorkflowHandoffWrite(operation) {
  const next = sourceWorkflowHandoffWriteQueue.then(operation, operation);
  sourceWorkflowHandoffWriteQueue = next.catch(() => undefined);
  return next;
}

async function persistSourceWorkflowHandoffs(values) {
  const handoffs = (Array.isArray(values) ? values : [values])
    .map((value) => validateSourceWorkflowHandoff(value))
    .filter(Boolean);
  if (!handoffs.length) return [];
  return enqueueSourceWorkflowHandoffWrite(async () => {
    const stored = await chrome.storage.local.get([SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY]);
    const raw = stored[SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY];
    const records = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    for (const handoff of handoffs) {
      const identity = sourceWorkflowHandoffIdentity(handoff.platform, handoff.sourceProductId);
      delete records[identity];
      records[identity] = handoff;
    }
    const boundedRecords = Object.fromEntries(
      Object.entries(records)
        .filter(([, candidate]) => Boolean(validateSourceWorkflowHandoff(candidate)))
        .slice(-SS_ERP_SOURCE_WORKFLOW_HANDOFF_LIMIT),
    );
    const latestHandoff = handoffs[handoffs.length - 1];
    await chrome.storage.local.set({
      [SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY]: latestHandoff,
      [SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY]: boundedRecords,
    });
    return handoffs;
  });
}

async function persistSourceWorkflowHandoff(value) {
  const handoffs = await persistSourceWorkflowHandoffs([value]);
  return handoffs.length ? handoffs[0] : null;
}

async function readPersistedSourceWorkflowHandoff(platformValue, sourceProductIdValue) {
  const platform = sourceWorkflowPlatform(platformValue);
  const sourceProductId = sourceWorkflowHandoffText(sourceProductIdValue, 200);
  const result = await chrome.storage.local.get([
    SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY,
    SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY,
  ]);
  if (platform && sourceProductId) {
    const records = result[SS_ERP_SOURCE_WORKFLOW_HANDOFFS_KEY];
    const candidate = records && typeof records === 'object' && !Array.isArray(records)
      ? records[sourceWorkflowHandoffIdentity(platform, sourceProductId)]
      : null;
    const current = validateSourceWorkflowHandoff(candidate);
    if (current) return current;
    const migrated = migrateLegacySourceWorkflowHandoff(
      result[SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY],
      platform,
      sourceProductId,
    );
    if (!migrated) return null;
    await persistSourceWorkflowHandoff(migrated);
    return migrated;
  }
  return validateSourceWorkflowHandoff(result[SS_ERP_SOURCE_WORKFLOW_HANDOFF_KEY]);
}

function inferErpWebBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('ERP 地址无效，请重新配置');
  try {
    const url = new URL(raw.replace(/\/+$/, ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('invalid ERP protocol or credentials');
    }
    url.pathname = url.pathname.replace(/\/api\/.*$/, '').replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname) && url.port === '3001') {
      url.port = '3000';
    }
    return url.href.replace(/\/+$/, '');
  } catch {
    throw new Error('ERP 地址无效，请重新配置');
  }
}

function buildConfiguredSourceWorkflowUrl(baseUrlValue, handoff) {
  const webBaseUrl = new URL(inferErpWebBaseUrl(baseUrlValue));
  const target = new URL(handoff.path, webBaseUrl);
  if (target.origin !== webBaseUrl.origin || target.pathname !== '/collect/source') {
    throw new Error('ERP 工作流地址无效');
  }
  return target.toString();
}

function validateDeliveryEnvelope(value) {
  const schema = globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA;
  if (!schema || typeof schema.validateDeliveryEnvelope !== 'function') {
    return { valid: false, errors: ['物流规则分发结构校验器不可用'] };
  }
  return schema.validateDeliveryEnvelope(value);
}

function getLogisticsDistributionRuntime() {
  if (logisticsDistributionRuntime) return logisticsDistributionRuntime;
  const api = globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_RUNTIME;
  if (!api || typeof api.createRuntime !== 'function') {
    throw new Error('物流规则分发运行时不可用');
  }
  logisticsDistributionRuntime = api.createRuntime({
    localStorage: chrome.storage.local,
    credentials: getLogisticsDeviceCredentials(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    validateBundle: validateDeliveryEnvelope,
    currentExtensionVersion: chrome.runtime.getManifest().version,
    randomId: () => globalThis.crypto.randomUUID(),
    now: () => new Date(),
  });
  return logisticsDistributionRuntime;
}

function getLogisticsManualFallbackPersistence() {
  if (logisticsManualFallbackPersistence) return logisticsManualFallbackPersistence;
  const api = globalThis.SS_ERP_LOGISTICS_MANUAL_FALLBACK;
  if (!api || typeof api.createPersistence !== 'function') {
    throw new Error('物流手工备用规则持久化模块不可用');
  }
  logisticsManualFallbackPersistence = api.createPersistence({
    storage: chrome.storage.local,
    getRuntime: getLogisticsDistributionRuntime,
    isFeatureEnabled: isLogisticsDistributionFeatureEnabled,
    now: () => new Date(),
  });
  return logisticsManualFallbackPersistence;
}

function persistManualCalculatorData(input) {
  return getLogisticsManualFallbackPersistence().persist(input);
}

function getLogisticsDistributionMessageHandler() {
  if (logisticsDistributionMessageHandler) return logisticsDistributionMessageHandler;
  const api = globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_RUNTIME;
  const securitySchema = globalThis.OZON_CALC_SYNC_SCHEMA;
  if (!api || typeof api.createMessageHandler !== 'function'
    || !securitySchema || typeof securitySchema.isTrustedSettingsSender !== 'function') {
    throw new Error('物流规则分发消息边界不可用');
  }
  logisticsDistributionMessageHandler = api.createMessageHandler({
    runtime: getLogisticsDistributionRuntime(),
    extensionId: chrome.runtime.id,
    isTrustedSettingsSender: securitySchema.isTrustedSettingsSender,
  });
  return logisticsDistributionMessageHandler;
}

function logisticsCaptureStatusKey() {
  const api = globalThis.SS_ERP_LOGISTICS_CAPTURE_RUNTIME;
  return api && api.STATUS_KEY || 'ss-erp:logistics-capture-task:status:v1';
}

async function readLogisticsCaptureEntries() {
  const result = await chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]);
  return Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY])
    ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
}

async function readLogisticsSelectedServiceIds() {
  const result = await chrome.storage.local.get([
    OZON_CALC_CONFIG_SNAPSHOT_KEY,
    OZON_LOGISTICS_CALCULATOR_STATE_KEY,
  ]);
  const calculatorState = result[OZON_LOGISTICS_CALCULATOR_STATE_KEY];
  const snapshot = calculatorState && calculatorState.snapshot
    || result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || {};
  const selected = snapshot && snapshot.userConfig && snapshot.userConfig.selectedServiceIds;
  return Array.isArray(selected) ? selected.map(String) : [];
}

async function writeLogisticsCaptureStatus(status) {
  await chrome.storage.local.set({ [logisticsCaptureStatusKey()]: status });
}

async function readLogisticsCaptureStatus() {
  const key = logisticsCaptureStatusKey();
  const result = await chrome.storage.local.get([key]);
  return result[key] || { state: 'idle' };
}

async function captureOzonSellerProviderInventory(input) {
  const collectApi = globalThis.SS_ERP_COLLECT_BACKGROUND;
  const inventoryCapture = globalThis.SS_ERP_PROVIDER_INVENTORY_CAPTURE;
  if (!collectApi || typeof collectApi.fetchOzonSellerDropoffPointsViaTab !== 'function') {
    throw new Error('Ozon Seller provider 采集器不可用');
  }
  if (!inventoryCapture || typeof inventoryCapture.appendSellerProviderInventory !== 'function') {
    throw new Error('provider inventory 净化存储不可用');
  }
  const inventory = await collectApi.fetchOzonSellerDropoffPointsViaTab(input.companyId, {
    point: input.point,
  });
  const entries = await readLogisticsCaptureEntries();
  const next = inventoryCapture.appendSellerProviderInventory(entries, {
    ...inventory,
    point: input.point,
    capturedAt: new Date().toISOString(),
  }, OZON_CALC_CAPTURE_LIMIT);
  await chrome.storage.local.set({ [OZON_CALC_CAPTURE_ENTRIES_KEY]: next });
  return {
    companyId: inventory.companyId,
    providerStats: inventory.providerStats,
  };
}

function getLogisticsCaptureRuntime() {
  if (logisticsCaptureRuntime) return logisticsCaptureRuntime;
  const api = globalThis.SS_ERP_LOGISTICS_CAPTURE_RUNTIME;
  if (!api || typeof api.createRuntime !== 'function') {
    throw new Error('物流规则采集运行时不可用');
  }
  logisticsCaptureRuntime = api.createRuntime({
    credentials: getLogisticsDeviceCredentials(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    readCapturedEntries: readLogisticsCaptureEntries,
    collectProviderInventory: captureOzonSellerProviderInventory,
    readSelectedServiceIds: readLogisticsSelectedServiceIds,
    writeStatus: writeLogisticsCaptureStatus,
    readStatus: readLogisticsCaptureStatus,
    now: () => new Date(),
  });
  return logisticsCaptureRuntime;
}

function getLogisticsCaptureMessageHandler() {
  if (logisticsCaptureMessageHandler) return logisticsCaptureMessageHandler;
  const api = globalThis.SS_ERP_LOGISTICS_CAPTURE_RUNTIME;
  const securitySchema = globalThis.OZON_CALC_SYNC_SCHEMA;
  if (!api || typeof api.createMessageHandler !== 'function'
    || !securitySchema || typeof securitySchema.isTrustedSettingsSender !== 'function') {
    throw new Error('物流规则采集消息边界不可用');
  }
  logisticsCaptureMessageHandler = api.createMessageHandler({
    runtime: getLogisticsCaptureRuntime(),
    extensionId: chrome.runtime.id,
    isTrustedSettingsSender: securitySchema.isTrustedSettingsSender,
  });
  return logisticsCaptureMessageHandler;
}

function logisticsBindingProbeStatusKey() {
  const api = globalThis.SS_ERP_LOGISTICS_BINDING_PROBE_RUNTIME;
  return api && api.STATUS_KEY || 'ss-erp:logistics-binding-probe:status:v1';
}

async function writeLogisticsBindingProbeStatus(status, operation) {
  const envelope = {
    status,
    ownerSessionId: toText(operation && operation.sessionId).trim(),
    ownerDeploymentId: toText(operation && operation.deploymentId).trim(),
    ownerUserId: toText(operation && operation.ownerUserId).trim(),
    ownerEpoch: Number(operation && operation.epoch),
  };
  await chrome.storage.local.set({ [logisticsBindingProbeStatusKey()]: envelope });
}

async function readLogisticsBindingProbeStatus() {
  const key = logisticsBindingProbeStatusKey();
  const result = await chrome.storage.local.get([key]);
  const stored = result[key];
  if (!stored) return { state: 'idle' };
  if (!stored.status || typeof stored.status !== 'object') return stored;
  const deviceStatus = await getLogisticsDeviceCredentials().getStatus();
  if (deviceStatus && deviceStatus.state === 'paired') {
    const sameOwner = stored.ownerSessionId
      && stored.ownerSessionId === deviceStatus.sessionId
      && stored.ownerDeploymentId === deviceStatus.deploymentId
      && stored.ownerUserId === deviceStatus.ownerUserId;
    return sameOwner ? stored.status : { state: 'idle' };
  }
  return stored.status.state === 'revoked' || stored.status.state === 'unpaired'
    ? stored.status : { state: 'idle' };
}

async function readCurrentOzonCompanyIdForBindingProbe() {
  if (!chrome.cookies || typeof chrome.cookies.get !== 'function') return '';
  try {
    const cookie = await chrome.cookies.get({
      url: 'https://seller.ozon.ru/',
      name: 'sc_company_id',
    });
    return normalizeOzonCompanyIdForSync(cookie && cookie.value);
  } catch (_error) {
    return '';
  }
}

async function collectLogisticsBindingProbeEvidence(probes) {
  const collector = globalThis.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR;
  if (!collector || typeof collector.collectWarehouseEvidence !== 'function'
    || !chrome.tabs || !chrome.scripting) {
    return { state: 'collector_unavailable', matches: [] };
  }
  const companyId = await readCurrentOzonCompanyIdForBindingProbe();
  if (!companyId) return { state: 'current_company_missing', matches: [] };
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });
  } catch (_error) {
    return { state: 'seller_tab_unavailable', matches: [] };
  }
  const candidates = [
    ...tabs.filter((tab) => tab && tab.active),
    ...tabs.filter((tab) => tab && (tab.url || '').includes('/app/')),
    ...tabs,
  ];
  const seen = new Set();
  for (const tab of candidates) {
    if (!tab || tab.id == null || seen.has(tab.id)) continue;
    seen.add(tab.id);
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: collector.collectWarehouseEvidence,
        args: [{ companyId, probes }],
      });
      const projection = results && results[0] && results[0].result;
      if (projection && Array.isArray(projection.matches)
        && projection.state !== 'request_failed') return projection;
    } catch (_error) {}
  }
  return { state: 'request_failed', matches: [] };
}

function getLogisticsBindingProbeRuntime() {
  if (logisticsBindingProbeRuntime) return logisticsBindingProbeRuntime;
  const api = globalThis.SS_ERP_LOGISTICS_BINDING_PROBE_RUNTIME;
  const adapter = globalThis.SS_ERP_LOGISTICS_BINDING_PROBE_ADAPTER;
  const collector = globalThis.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR;
  if (!api || typeof api.createRuntime !== 'function'
    || !adapter || typeof adapter.buildEvidence !== 'function'
    || !collector || typeof collector.collectWarehouseEvidence !== 'function') {
    throw new Error('物流店铺仓库验证运行时不可用');
  }
  logisticsBindingProbeRuntime = api.createRuntime({
    credentials: getLogisticsDeviceCredentials(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    adapter,
    collectEvidence: collectLogisticsBindingProbeEvidence,
    writeStatus: writeLogisticsBindingProbeStatus,
    readStatus: readLogisticsBindingProbeStatus,
    now: () => new Date(),
  });
  return logisticsBindingProbeRuntime;
}

function getLogisticsBindingProbeMessageHandler() {
  if (logisticsBindingProbeMessageHandler) return logisticsBindingProbeMessageHandler;
  const api = globalThis.SS_ERP_LOGISTICS_BINDING_PROBE_RUNTIME;
  const securitySchema = globalThis.OZON_CALC_SYNC_SCHEMA;
  if (!api || typeof api.createMessageHandler !== 'function'
    || !securitySchema || typeof securitySchema.isTrustedSettingsSender !== 'function') {
    throw new Error('物流店铺仓库验证消息边界不可用');
  }
  logisticsBindingProbeMessageHandler = api.createMessageHandler({
    runtime: getLogisticsBindingProbeRuntime(),
    extensionId: chrome.runtime.id,
    isTrustedSettingsSender: securitySchema.isTrustedSettingsSender,
  });
  return logisticsBindingProbeMessageHandler;
}

function ensureLogisticsCaptureAlarm() {
  if (!isLogisticsDistributionFeatureEnabled()) return;
  if (!chrome.alarms || typeof chrome.alarms.create !== 'function') return;
  chrome.alarms.create(SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: SS_ERP_LOGISTICS_CAPTURE_INTERVAL_MINUTES,
  });
}

async function runScheduledLogisticsCapture({ reason }) {
  if (!isLogisticsDistributionFeatureEnabled()) return logisticsDistributionDisabledResult();
  return getLogisticsCaptureRuntime().refresh({
    reason,
    extensionVersion: chrome.runtime.getManifest().version,
    allowProviderCollection: false,
  });
}
function ensureLogisticsRuleSyncAlarm(options = {}) {
  if (!isLogisticsDistributionFeatureEnabled()) return;
  if (!chrome.alarms || typeof chrome.alarms.create !== 'function') return;
  const requestedWhen = Number(options.when);
  const alarmOptions = Number.isFinite(requestedWhen) && requestedWhen > Date.now()
    ? { when: requestedWhen, periodInMinutes: SS_ERP_LOGISTICS_RULE_SYNC_INTERVAL_MINUTES }
    : { delayInMinutes: 1, periodInMinutes: SS_ERP_LOGISTICS_RULE_SYNC_INTERVAL_MINUTES };
  chrome.alarms.create(SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME, alarmOptions);
}

async function runScheduledLogisticsRuleSync({ reason }) {
  if (!isLogisticsDistributionFeatureEnabled()) return logisticsDistributionDisabledResult();
  const runtime = getLogisticsDistributionRuntime();
  if (!runtime || typeof runtime.syncStored !== 'function') {
    throw new Error('物流规则自动同步运行时不可用');
  }
  const extensionVersion = chrome.runtime.getManifest().version;
  const result = await runtime.syncStored({
    reason,
    extensionVersion,
  });
  const nextAttemptAt = Date.parse(String(result && result.nextAttemptAt || ''));
  if (Number.isFinite(nextAttemptAt) && nextAttemptAt > Date.now()) {
    ensureLogisticsRuleSyncAlarm({ when: nextAttemptAt });
  }
  return result;
}

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    if (!isLogisticsDistributionFeatureEnabled()) {
      disableLogisticsDistributionAlarms();
      return;
    }
    ensureLogisticsRuleSyncAlarm();
    ensureLogisticsCaptureAlarm();
    runScheduledLogisticsRuleSync({ reason: 'startup' }).catch((error) => {
      console.warn('[SS ERP] logistics rule startup sync failed:', error);
    });
    runScheduledLogisticsCapture({ reason: 'startup' }).catch((error) => {
      console.warn('[SS ERP] logistics capture startup poll failed:', error);
    });
  });
}

try {
  importScripts('../shared/erp-package/erp-package-export.js');
} catch (error) {
  console.warn('[ozon-calc] erp package exporter import failed', error);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ozon-calc] installed');
  if (self.SS_ERP_RUNTIME) self.SS_ERP_RUNTIME.syncRuntimeMode();
  ensureOzonAutoSyncAlarm();
  if (!isLogisticsDistributionFeatureEnabled()) {
    disableLogisticsDistributionAlarms();
    return;
  }
  ensureLogisticsRuleSyncAlarm();
  ensureLogisticsCaptureAlarm();
});

ensureOzonAutoSyncAlarm();
if (!isLogisticsDistributionFeatureEnabled()) {
  disableLogisticsDistributionAlarms();
}
ensureLogisticsRuleSyncAlarm();
ensureLogisticsCaptureAlarm();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !self.SS_ERP_RUNTIME) return;
  if (
    changes[OZON_CALC_ERP_ENDPOINT_KEY]
    || changes[OZON_CALC_ERP_TOKEN_KEY]
    || changes.ss_erp_connection
  ) {
    self.SS_ERP_RUNTIME.syncRuntimeMode();
  }
});

const LEGACY_STORAGE_PREFIX = String.fromCharCode(113, 101, 104, 101, 108, 112) + '-clone';
const LEGACY_CAPTURE_META_KEY = '_' + String.fromCharCode(113, 101, 104, 101, 108, 112);

function legacyStorageKey(suffix) {
  return LEGACY_STORAGE_PREFIX + ':' + suffix;
}

const STORAGE_MIGRATION_PAIRS = [
  [OZON_CALC_ERP_QUEUE_KEY, legacyStorageKey('erp-queue')],
  [OZON_CALC_CAPTURE_ENTRIES_KEY, legacyStorageKey('capture-har-entries')],
  [OZON_CALC_PRODUCT_POOL_KEY, legacyStorageKey('product-pool')],
  [OZON_CALC_VISIBLE_SNAPSHOTS_KEY, legacyStorageKey('visible-snapshots')],
  [OZON_CALC_ERP_ENDPOINT_KEY, legacyStorageKey('erp-endpoint')],
  [OZON_CALC_ERP_TOKEN_KEY, legacyStorageKey('erp-token')],
  [OZON_CALC_ERP_PUSH_HISTORY_KEY, legacyStorageKey('erp-push-history')],
  [OZON_CALC_CONFIG_SNAPSHOT_KEY, legacyStorageKey('config-snapshot')],
  [OZON_CALC_CONFIG_UPDATED_AT_KEY, legacyStorageKey('config-updated-at')],
];

function captureEntryMeta(entry) {
  if (!entry || typeof entry !== 'object') return {};
  return entry._ozonCalc || entry[LEGACY_CAPTURE_META_KEY] || {};
}

function migrateLegacyStorage() {
  if (!chrome || !chrome.storage || !chrome.storage.local || typeof chrome.storage.local.get !== 'function') {
    return Promise.resolve();
  }
  const keys = STORAGE_MIGRATION_PAIRS.reduce((all, pair) => all.concat(pair), []);
  return chrome.storage.local.get(keys).then((result) => {
    const updates = {};
    STORAGE_MIGRATION_PAIRS.forEach(([currentKey, legacyKey]) => {
      if (result[currentKey] === undefined && result[legacyKey] !== undefined) {
        updates[currentKey] = result[legacyKey];
      }
    });
    return Object.keys(updates).length ? chrome.storage.local.set(updates) : undefined;
  }).catch((error) => {
    console.warn('[ozon-calc] storage migration failed', error);
  });
}

const storageMigrationReady = migrateLegacyStorage();
globalThis.OZON_CALC_STORAGE_MIGRATION_READY = storageMigrationReady;

try {
  chrome.storage.local.remove([
    OZON_SYNC_LEGACY_COMPANY_ID_STORAGE_KEY,
    OZON_SYNC_LEGACY_COMPANY_ID_CAPTURED_AT_KEY
  ]).catch(() => {});
} catch (_) {}

function toText(value) {
  return value == null ? '' : String(value);
}

function normalizeOzonCompanyIdForSync(value) {
  return toText(value).trim();
}

function isRecentOzonCompanyIdForSync(value) {
  const capturedAt = Number(value) || 0;
  return capturedAt > 0 && Date.now() - capturedAt <= OZON_SYNC_RECENT_COMPANY_ID_MS;
}

function rememberRuntimeOzonCompanyIdForSync(value, capturedAt) {
  const companyId = normalizeOzonCompanyIdForSync(value);
  if (!companyId) return '';
  const nextCapturedAt = Number(capturedAt) || Date.now();
  if (typeof globalThis.SS_ERP_REMEMBER_OZON_COMPANY_ID === 'function') {
    return globalThis.SS_ERP_REMEMBER_OZON_COMPANY_ID(companyId, nextCapturedAt);
  }
  globalThis.SS_ERP_OZON_COMPANY_ID_CAPTURE = {
    companyId,
    capturedAt: nextCapturedAt
  };
  if (chrome.storage && chrome.storage.session) {
    chrome.storage.session.set({
      [OZON_SYNC_SESSION_COMPANY_ID_KEY]: companyId,
      [OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY]: nextCapturedAt
    }).catch(() => {});
  }
  return companyId;
}

function getRuntimeOzonCompanyIdForSync() {
  const capture = globalThis.SS_ERP_OZON_COMPANY_ID_CAPTURE || {};
  if (!isRecentOzonCompanyIdForSync(capture.capturedAt)) return '';
  return normalizeOzonCompanyIdForSync(capture.companyId);
}

function getCapturedOzonCompanyIdForSync() {
  const runtimeCompanyId = getRuntimeOzonCompanyIdForSync();
  if (runtimeCompanyId || !chrome.storage || !chrome.storage.session) {
    return Promise.resolve(runtimeCompanyId);
  }
  return chrome.storage.session.get([
    OZON_SYNC_SESSION_COMPANY_ID_KEY,
    OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY
  ]).then((result) => {
    if (!isRecentOzonCompanyIdForSync(result[OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY])) return '';
    const companyId = normalizeOzonCompanyIdForSync(result[OZON_SYNC_SESSION_COMPANY_ID_KEY]);
    if (companyId) rememberRuntimeOzonCompanyIdForSync(companyId, result[OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY]);
    return companyId;
  }).catch(() => '');
}

function findOzonCompanyIdFromCookies(cookies) {
  if (!Array.isArray(cookies)) return '';
  const direct = cookies.find((cookie) => cookie && cookie.name === 'sc_company_id' && cookie.domain && cookie.domain.includes('seller.ozon.ru'));
  const shared = cookies.find((cookie) => cookie && cookie.name === 'sc_company_id');
  return normalizeOzonCompanyIdForSync((direct || shared || {}).value);
}

function parseCookieValueFromStringForSync(cookieString, name) {
  const targetName = toText(name).trim();
  if (!targetName) return '';
  for (const part of toText(cookieString).split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const cookieName = part.slice(0, eq).trim();
    if (cookieName !== targetName) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch (_error) {
      return part.slice(eq + 1).trim();
    }
  }
  return '';
}

function mergeCookieStringsForSync(primary, fallback) {
  const out = [];
  const seen = new Set();
  for (const source of [primary, fallback]) {
    for (const rawPart of toText(source).split(';')) {
      const part = rawPart.trim();
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push(part);
    }
  }
  return out.join('; ');
}

function cookieStringFromOzonCookiesForSync(cookies) {
  if (!Array.isArray(cookies)) return '';
  const seen = new Set();
  return cookies
    .filter((cookie) => cookie && cookie.name && (cookie.domain || '').includes('ozon.ru'))
    .filter((cookie) => {
      const key = `${cookie.name}\n${cookie.domain || ''}\n${cookie.path || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function readOzonSellerCookieStringFromOpenTabForSync() {
  try {
    if (!chrome.tabs || !chrome.scripting) return '';
    const tabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });
    const candidates = [
      ...tabs.filter((tab) => tab.active),
      ...tabs.filter((tab) => (tab.url || '').includes('/app/')),
      ...tabs,
    ];
    const seen = new Set();
    for (const tab of candidates) {
      if (!tab || !tab.id || seen.has(tab.id)) continue;
      seen.add(tab.id);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => document.cookie || '',
        });
        const cookieString = toText(results && results[0] && results[0].result).trim();
        if (cookieString) return cookieString;
      } catch (_error) {}
    }
  } catch (_error) {}
  return '';
}

async function readOzonSellerCookieValueFromOpenTabForSync(name) {
  const cookieString = await readOzonSellerCookieStringFromOpenTabForSync();
  return normalizeOzonCompanyIdForSync(parseCookieValueFromStringForSync(cookieString, name));
}

async function getOzonSellerCookiesForSync() {
  const queries = [
    { url: 'https://seller.ozon.ru/' },
    { url: 'https://api.seller.ozon.ru/' },
    { domain: '.ozon.ru' },
    { domain: 'seller.ozon.ru' },
    { domain: 'api.seller.ozon.ru' },
  ];
  const merged = [];
  const seen = new Set();
  for (const query of queries) {
    try {
      const cookies = await chrome.cookies.getAll(query);
      for (const cookie of cookies || []) {
        const key = `${cookie.name}\n${cookie.domain || ''}\n${cookie.path || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(cookie);
      }
    } catch (_error) {}
  }
  return merged;
}

function fetchStoredOzonCompanyIdForSync(apiBase, token, shopId) {
  if (!apiBase || !token || !shopId) return Promise.resolve('');
  return fetch(apiBase + '/api/shops/' + encodeURIComponent(shopId) + '/ozon-cdn-auth', {
    headers: { 'authorization': 'Bearer ' + token },
  }).then((res) => res.json())
    .then((data) => normalizeOzonCompanyIdForSync(data && data.data && data.data.companyId))
    .catch(() => '');
}

function ensureOzonAutoSyncAlarm() {
  try {
    if (!chrome.alarms || typeof chrome.alarms.create !== 'function') return;
    chrome.alarms.create(SS_ERP_OZON_AUTO_SYNC_ALARM_NAME, {
      periodInMinutes: SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES,
      delayInMinutes: 1,
    });
  } catch (error) {
    console.warn('[SS ERP] create Ozon auto sync alarm failed:', error);
  }
}

async function getOzonAutoSyncConnection() {
  const result = await chrome.storage.local.get([
    OZON_CALC_ERP_ENDPOINT_KEY,
    OZON_CALC_ERP_TOKEN_KEY,
    'ss_erp_connection',
  ]);
  const conn = result.ss_erp_connection || {};
  const endpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY] || conn.baseUrl || '');
  const token = toText(result[OZON_CALC_ERP_TOKEN_KEY] || conn.token).trim();
  return {
    apiBase: endpoint ? endpoint.replace(/\/api\/.*$/, '') : '',
    token,
  };
}

async function fetchOzonShopsForAutoSync(apiBase, token) {
  if (!apiBase || !token) return [];
  const response = await fetch(apiBase + '/api/shops', {
    headers: { 'authorization': 'Bearer ' + token },
  });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  if (!data || data.code !== 1 || !Array.isArray(data.data)) return [];
  return data.data.filter((shop) => String(shop && shop.platform || '').toUpperCase() === 'OZON');
}

function shopMatchesOzonCompanyId(shop, companyId) {
  const target = normalizeOzonCompanyIdForSync(companyId);
  if (!target || !shop || typeof shop !== 'object') return false;
  return [
    shop.companyId,
    shop.ozonCompanyId,
    shop.sellerCompanyId,
    shop.sellerId,
    shop.clientId,
    shop.accountId,
  ].some((value) => normalizeOzonCompanyIdForSync(value) === target);
}

async function resolveOzonAutoSyncShop(apiBase, token, companyId) {
  const storage = await chrome.storage.local.get(['ss_erp_cookie_shop', 'ss_erp_selected_shop']);
  const shops = await fetchOzonShopsForAutoSync(apiBase, token);
  const matched = shops.find((shop) => shopMatchesOzonCompanyId(shop, companyId));
  if (matched && matched.id) {
    await chrome.storage.local.set({ ss_erp_cookie_shop: matched.id, ss_erp_selected_shop: matched.id });
    return matched;
  }
  const fallbackId = toText(storage.ss_erp_cookie_shop || storage.ss_erp_selected_shop).trim();
  if (!fallbackId) return null;
  return shops.find((shop) => shop.id === fallbackId) || { id: fallbackId };
}

async function updateOzonSyncTimes(patch) {
  const current = await chrome.storage.local.get([SS_ERP_SYNC_TIMES_KEY]);
  const times = current[SS_ERP_SYNC_TIMES_KEY] && typeof current[SS_ERP_SYNC_TIMES_KEY] === 'object'
    ? current[SS_ERP_SYNC_TIMES_KEY]
    : {};
  await chrome.storage.local.set({ [SS_ERP_SYNC_TIMES_KEY]: { ...times, ...patch } });
}

async function syncOzonCookieToShopForSync(shopId, options) {
  const normalizedShopId = toText(shopId).trim();
  if (!normalizedShopId) throw new Error('缺少 shopId，请先选择目标店铺');
  const [cookies, tabCookieStr, tabCompanyId] = await Promise.all([
    getOzonSellerCookiesForSync(),
    readOzonSellerCookieStringFromOpenTabForSync(),
    readOzonSellerCookieValueFromOpenTabForSync('sc_company_id'),
  ]);
  const cookieStr = mergeCookieStringsForSync(cookieStringFromOzonCookiesForSync(cookies), tabCookieStr);
  if (!cookieStr) throw new Error('未检测到 seller.ozon.ru 登录态，请先登录卖家后台');

  const connection = await getOzonAutoSyncConnection();
  if (!connection.apiBase) throw new Error('请先在插件设置中配置 ERP 地址');
  if (!connection.token) throw new Error('请先在插件设置中配置 ERP Token');

  const payloadCompanyId = normalizeOzonCompanyIdForSync(options && options.companyId);
  const cookieCompanyId = findOzonCompanyIdFromCookies(cookies);
  const [capturedCompanyId, storedCompanyId] = await Promise.all([
    getCapturedOzonCompanyIdForSync(),
    fetchStoredOzonCompanyIdForSync(connection.apiBase, connection.token, normalizedShopId),
  ]);
  const preferStoredCompanyId = options && options.useStoredCompanyId === true;
  const companyIdCandidates = preferStoredCompanyId
    ? [storedCompanyId, payloadCompanyId, tabCompanyId, capturedCompanyId, cookieCompanyId]
    : [tabCompanyId, payloadCompanyId, capturedCompanyId, cookieCompanyId, storedCompanyId];
  const companyId = companyIdCandidates.find((value) => normalizeOzonCompanyIdForSync(value)) || '';
  const body = { cookie: cookieStr };
  if (companyId) {
    body.companyId = companyId;
    rememberRuntimeOzonCompanyIdForSync(companyId);
  }

  const data = await fetch(connection.apiBase + '/api/shops/' + encodeURIComponent(normalizedShopId) + '/ozon-cdn-auth', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + connection.token },
    body: JSON.stringify(body),
  }).then((res) => res.json());
  if (!data || data.code !== 1) throw new Error((data && data.msg) || '同步失败');
  const now = new Date().toISOString();
  await updateOzonSyncTimes({ cookie: now });
  return { ok: true, shopId: normalizedShopId, companyId: companyId || '', data: data.data, syncedAt: now };
}

globalThis.syncOzonCookieToShopForSync = syncOzonCookieToShopForSync;

async function syncCurrentOzonCookieForSync(options) {
  const connection = await getOzonAutoSyncConnection();
  if (!connection.apiBase) throw new Error('请先在插件设置中配置 ERP 地址');
  if (!connection.token) throw new Error('请先在插件设置中配置 ERP Token');

  const capturedCompanyId = normalizeOzonCompanyIdForSync(
    (options && options.companyId)
    || await getCapturedOzonCompanyIdForSync()
    || await readOzonSellerCookieValueFromOpenTabForSync('sc_company_id')
  );
  const shop = await resolveOzonAutoSyncShop(connection.apiBase, connection.token, capturedCompanyId);
  if (!shop || !shop.id) {
    throw new Error('未找到匹配的 Ozon 店铺，请先在扩展弹窗选择目标店铺，或在 seller.ozon.ru 切换到已绑定 company_id 的店铺');
  }

  const result = await syncOzonCookieToShopForSync(shop.id, { companyId: capturedCompanyId });
  const stateRow = await chrome.storage.local.get([SS_ERP_OZON_AUTO_SYNC_STATE_KEY]);
  const state = stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] && typeof stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] === 'object'
    ? stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY]
    : {};
  await chrome.storage.local.set({
    [SS_ERP_OZON_AUTO_SYNC_STATE_KEY]: {
      ...state,
      cookieAt: Date.now(),
      lastReason: 'quick_cookie_sync',
      ...(result.companyId ? { lastCompanyId: result.companyId } : {}),
    },
  });
  return result;
}

async function ensureCurrentOzonCookieSyncedForInsights(options) {
  const liveCompanyId = normalizeOzonCompanyIdForSync(
    (options && options.companyId)
    || await getCapturedOzonCompanyIdForSync()
    || await readOzonSellerCookieValueFromOpenTabForSync('sc_company_id')
  );
  const now = Date.now();
  const stateRow = await chrome.storage.local.get([SS_ERP_OZON_AUTO_SYNC_STATE_KEY]);
  const state = stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] && typeof stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] === 'object'
    ? stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY]
    : {};
  const lastCookieAt = Number(state.cookieAt) || 0;
  const sameCompany = !liveCompanyId || !state.lastCompanyId || state.lastCompanyId === liveCompanyId;
  if (sameCompany && lastCookieAt && now - lastCookieAt < SS_ERP_OZON_INSIGHT_COOKIE_SYNC_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: 'recent_cookie_sync', companyId: liveCompanyId || state.lastCompanyId || '' };
  }
  if (ozonInsightCookieSyncInFlight) return await ozonInsightCookieSyncInFlight;

  ozonInsightCookieSyncInFlight = syncCurrentOzonCookieForSync({
    ...(options && typeof options === 'object' ? options : {}),
    companyId: liveCompanyId || (options && options.companyId) || '',
  }).finally(() => {
    ozonInsightCookieSyncInFlight = null;
  });
  return await ozonInsightCookieSyncInFlight;
}
globalThis.ensureCurrentOzonCookieSyncedForInsights = ensureCurrentOzonCookieSyncedForInsights;

function shouldRunOzonAutoSyncSlot(state, key, now, force) {
  if (force) return true;
  const last = Number(state && state[key]) || 0;
  return !last || now - last >= SS_ERP_OZON_AUTO_SYNC_INTERVAL_MS;
}

function summarizeOzonAutoSyncResult(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = { ok: value.ok === true };
  if (value.error) summary.error = toText(value.error).slice(0, 240);
  if (value.skipped) summary.skipped = true;
  if (value.syncedAt) summary.syncedAt = value.syncedAt;
  if (value.data && typeof value.data === 'object') {
    if (value.data.itemCount !== undefined) summary.itemCount = value.data.itemCount;
    if (value.data.period !== undefined) summary.period = value.data.period;
  }
  return summary;
}

async function runOzonAutoSyncMaintenance(options) {
  const now = Date.now();
  const force = options && options.force === true;
  const reason = toText(options && options.reason).trim() || 'scheduled';
  const connection = await getOzonAutoSyncConnection();
  if (!connection.apiBase || !connection.token) return { ok: false, skipped: true, reason: 'missing_erp_connection' };

  const stateRow = await chrome.storage.local.get([SS_ERP_OZON_AUTO_SYNC_STATE_KEY]);
  const state = stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] && typeof stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] === 'object'
    ? stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY]
    : {};
  const capturedCompanyId = normalizeOzonCompanyIdForSync((options && options.companyId) || await getCapturedOzonCompanyIdForSync() || await readOzonSellerCookieValueFromOpenTabForSync('sc_company_id'));
  const shop = await resolveOzonAutoSyncShop(connection.apiBase, connection.token, capturedCompanyId);
  if (!shop || !shop.id) return { ok: false, skipped: true, reason: 'missing_ozon_shop' };

  const nextState = { ...state, lastReason: reason };
  const result = { ok: true, shopId: shop.id, companyId: capturedCompanyId || '', cookie: null, analytics: null, graphs: null };
  const companyChanged = capturedCompanyId && capturedCompanyId !== state.lastCompanyId;

  if (shouldRunOzonAutoSyncSlot(state, 'cookieAt', now, force || companyChanged)) {
    try {
      result.cookie = await syncOzonCookieToShopForSync(shop.id, { companyId: capturedCompanyId });
      nextState.cookieAt = now;
      if (capturedCompanyId) nextState.lastCompanyId = capturedCompanyId;
    } catch (error) {
      result.cookie = { ok: false, error: error && error.message ? error.message : String(error) };
    }
  }

  if (shouldRunOzonAutoSyncSlot(state, 'analyticsAt', now, force || companyChanged)) {
    const syncAnalytics = globalThis.SS_ERP_COLLECT_BACKGROUND && globalThis.SS_ERP_COLLECT_BACKGROUND.syncShopAnalyticsToErp;
    const response = typeof syncAnalytics === 'function'
      ? await syncAnalytics(shop.id, capturedCompanyId || undefined)
      : { ok: false, error: 'Ozon 分析同步模块未加载' };
    result.analytics = response;
    if (response && response.ok) {
      nextState.analyticsAt = now;
      await updateOzonSyncTimes({ analytics: new Date(now).toISOString() });
    }
  }

  if (shouldRunOzonAutoSyncSlot(state, 'graphsAt', now, force || companyChanged)) {
    const syncGraphs = globalThis.SS_ERP_COLLECT_BACKGROUND && globalThis.SS_ERP_COLLECT_BACKGROUND.syncShopGraphsToErp;
    const response = typeof syncGraphs === 'function'
      ? await syncGraphs(shop.id, capturedCompanyId || undefined, 30)
      : { ok: false, error: 'Ozon 图表同步模块未加载' };
    result.graphs = response;
    if (response && response.ok) {
      nextState.graphsAt = now;
      await updateOzonSyncTimes({ graphs: new Date(now).toISOString() });
    }
  }

  nextState.updatedAt = new Date(now).toISOString();
  nextState.lastResult = {
    cookie: summarizeOzonAutoSyncResult(result.cookie),
    analytics: summarizeOzonAutoSyncResult(result.analytics),
    graphs: summarizeOzonAutoSyncResult(result.graphs),
  };
  await chrome.storage.local.set({ [SS_ERP_OZON_AUTO_SYNC_STATE_KEY]: nextState });
  return result;
}

async function readOzonAutoSyncStatus() {
  const [connection, stateRow] = await Promise.all([
    getOzonAutoSyncConnection(),
    chrome.storage.local.get([SS_ERP_OZON_AUTO_SYNC_STATE_KEY]),
  ]);
  const state = stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] && typeof stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] === 'object'
    ? { ...stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] }
    : {};
  try {
    const capturedCompanyId = normalizeOzonCompanyIdForSync(
      await getCapturedOzonCompanyIdForSync() || await readOzonSellerCookieValueFromOpenTabForSync('sc_company_id')
    );
    if (capturedCompanyId && !state.lastCompanyId) state.lastCompanyId = capturedCompanyId;
  } catch (_) {
    // Status reads must stay non-blocking; the maintenance action performs the real diagnostics.
  }
  return {
    ok: true,
    hasErpConnection: Boolean(connection.apiBase && connection.token),
    apiBase: connection.apiBase || '',
    intervalMinutes: SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES,
    state,
  };
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm) return;
    if ((alarm.name === SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME
      || alarm.name === SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME)
      && !isLogisticsDistributionFeatureEnabled()) {
      disableLogisticsDistributionAlarms();
      return;
    }
    if (alarm.name === SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME) {
      runScheduledLogisticsCapture({ reason: 'alarm' }).catch((error) => {
        console.warn('[SS ERP] logistics capture alarm poll failed:', error);
      });
      return;
    }
    if (alarm.name === SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME) {
      runScheduledLogisticsRuleSync({ reason: 'alarm' }).catch((error) => {
        console.warn('[SS ERP] logistics rule alarm sync failed:', error);
      });
      return;
    }
    if (alarm.name !== SS_ERP_OZON_AUTO_SYNC_ALARM_NAME) return;
    runOzonAutoSyncMaintenance({ reason: 'alarm' }).catch((error) => {
      console.warn('[SS ERP] Ozon auto sync alarm failed:', error);
    });
  });
}

if (chrome.cookies && chrome.cookies.onChanged) {
  chrome.cookies.onChanged.addListener((change) => {
    const cookie = change && change.cookie;
    if (!cookie || cookie.name !== 'sc_company_id') return;
    if (!String(cookie.domain || '').includes('ozon.ru')) return;
    const companyId = rememberRuntimeOzonCompanyIdForSync(cookie.value);
    runOzonAutoSyncMaintenance({ reason: 'company_id_cookie_changed', companyId }).catch((error) => {
      console.warn('[SS ERP] Ozon auto sync after company switch failed:', error);
    });
  });
}

function safeIsoDate(value) {
  const text = toText(value).trim();
  if (text) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function csvEscape(value) {
  const text = toText(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeVisibleSnapshot(payload) {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const rows = Array.isArray(raw.rows) ? raw.rows.slice(0, 500).map((row) => {
    const item = row && typeof row === 'object' ? row : { text: row };
    return {
      text: toText(item.text).trim().slice(0, 2000),
      sku: toText(item.sku).trim(),
      price: Number(item.price) || 0,
      stock: Number(item.stock) || 0,
      capacity: toText(item.capacity).trim(),
      status: toText(item.status).trim(),
    };
  }) : [];
  return {
    source: toText(raw.source || 'visible-page').trim(),
    pageUrl: toText(raw.pageUrl).trim(),
    title: toText(raw.title).trim().slice(0, 300),
    capturedAt: safeIsoDate(raw.capturedAt),
    metrics: Object.assign({}, raw.metrics || {}, {
      rowCount: rows.length,
    }),
    rows,
  };
}

function exportVisibleSnapshotsAsJson(snapshots) {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    snapshots: Array.isArray(snapshots) ? snapshots : [],
  }, null, 2);
}

function exportVisibleSnapshotsAsCsv(snapshots) {
  const rows = ['capturedAt,source,pageUrl,title,rowIndex,sku,price,stock,text'];
  (Array.isArray(snapshots) ? snapshots : []).forEach((snapshot) => {
    const snapshotRows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    snapshotRows.forEach((row, index) => {
      rows.push([
        snapshot.capturedAt,
        snapshot.source,
        snapshot.pageUrl,
        snapshot.title,
        index + 1,
        row && row.sku,
        row && row.price,
        row && row.stock,
        row && row.text,
      ].map(csvEscape).join(','));
    });
    if (!snapshotRows.length) {
      rows.push([
        snapshot.capturedAt,
        snapshot.source,
        snapshot.pageUrl,
        snapshot.title,
        0,
        '',
        '',
        '',
        '',
      ].map(csvEscape).join(','));
    }
  });
  return rows.join('\n');
}

function normalizeEndpoint(value) {
  const endpoint = toText(value).trim();
  if (!endpoint) return '';
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function buildCaptureCounts(entries) {
  const counts = { seller: 0, official: 0, sellerProducts: 0, all: Array.isArray(entries) ? entries.length : 0 };
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const mode = captureEntryMeta(entry).mode || '';
    if (mode === 'seller') counts.seller += 1;
    if (mode === 'official') counts.official += 1;
    if (mode === 'seller-products') counts.sellerProducts += 1;
  });
  return counts;
}

async function fetchTextOrThrow(url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'include' });
  if (!response || !response.ok) {
    throw new Error(`请求失败：${response ? response.status : 'no-response'}`);
  }
  return response.text();
}

async function fetchJsonOrThrow(url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!response || !response.ok) {
    throw new Error(`请求失败：${response ? response.status : 'no-response'}`);
  }
  return response.json();
}

async function syncCommissionSnapshot() {
  const parser = globalThis.OZON_CALC_COMMISSION_RATES;
  if (!parser || typeof parser.buildSnapshotFromHtml !== 'function') {
    throw new Error('佣金费率解析器未加载');
  }
  let html = '';
  let sourceUrl = '';
  let lastError = null;
  for (const url of OZON_COMMISSION_DOC_URLS) {
    try {
      html = await fetchTextOrThrow(url);
      sourceUrl = url;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!html) {
    const fallback = parser.normalizeSnapshot(Object.assign({}, OZON_COMMISSION_FALLBACK_SNAPSHOT, {
      fetchedAt: new Date().toISOString(),
      diagnostics: Object.assign({}, OZON_COMMISSION_FALLBACK_SNAPSHOT.diagnostics, {
        onlineSyncError: lastError && lastError.message ? lastError.message : String(lastError || '无法请求 Ozon 佣金文档'),
      }),
    }));
    await chrome.storage.local.set({ [OZON_COMMISSION_SNAPSHOT_KEY]: fallback });
    return fallback;
  }
  const snapshot = parser.buildSnapshotFromHtml(html, sourceUrl);
  if (!snapshot || !Array.isArray(snapshot.rules) || !snapshot.rules.length) {
    const fallback = parser.normalizeSnapshot(Object.assign({}, OZON_COMMISSION_FALLBACK_SNAPSHOT, {
      fetchedAt: new Date().toISOString(),
      diagnostics: Object.assign({}, OZON_COMMISSION_FALLBACK_SNAPSHOT.diagnostics, {
        onlineSyncError: '未能从 Ozon 帮助中心解析到佣金费率表',
        sourceUrl,
      }),
    }));
    await chrome.storage.local.set({ [OZON_COMMISSION_SNAPSHOT_KEY]: fallback });
    return fallback;
  }
  await chrome.storage.local.set({ [OZON_COMMISSION_SNAPSHOT_KEY]: snapshot });
  return snapshot;
}

async function syncFxSnapshot(manualRubRate) {
  const fx = globalThis.OZON_CALC_FX_RATES;
  if (!fx || typeof fx.normalizeApiResponse !== 'function') {
    throw new Error('汇率解析器未加载');
  }
  const payload = await fetchJsonOrThrow(OZON_FX_API_URL);
  const snapshot = fx.normalizeApiResponse(Object.assign({}, payload, {
    sourceUrl: OZON_FX_API_URL,
    provider: 'open.er-api',
  }));
  if (manualRubRate && !(snapshot.cnyPerCurrency && snapshot.cnyPerCurrency.RUB > 0)) {
    snapshot.cnyPerCurrency.RUB = Number(manualRubRate) || 0.08;
  }
  await chrome.storage.local.set({ [OZON_FX_SNAPSHOT_KEY]: snapshot });
  return snapshot;
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).map(toText).map((value) => value.trim()).filter((value) => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function buildConfigSnapshotFromSellerHar(sellerHar, selectedServiceIds, existingSnapshot) {
  const importer = globalThis.OZON_CALC_HAR_IMPORT;
  const catalogStore = globalThis.OZON_CALC_CATALOG_STORE;
  const ruleEngine = globalThis.OZON_CALC_RULE_ENGINE;
  const schema = globalThis.OZON_CALC_SYNC_SCHEMA;
  if (!importer || typeof importer.importSellerHar !== 'function') throw new Error('后台物流解析器未加载');
  if (!catalogStore || typeof catalogStore.normalizeCatalogPayload !== 'function') throw new Error('物流目录解析器未加载');
  if (!ruleEngine || typeof ruleEngine.normalizeRulePayload !== 'function') throw new Error('物流规则解析器未加载');
  if (!schema || typeof schema.normalizeSnapshot !== 'function') throw new Error('同步配置结构未加载');

  const imported = importer.importSellerHar(sellerHar);
  const catalogSnapshot = catalogStore.normalizeCatalogPayload(imported.catalogSnapshot);
  const ruleSnapshot = ruleEngine.normalizeRulePayload(imported.ruleSnapshot);
  const validIds = new Set(catalogSnapshot.services.map((service) => String(service.id)));
  const requestedIds = uniqueStrings(selectedServiceIds);
  const existingIds = existingSnapshot && existingSnapshot.userConfig
    ? uniqueStrings(existingSnapshot.userConfig.selectedServiceIds)
    : [];
  const selectedIds = (requestedIds.length ? requestedIds : existingIds).filter((id) => validIds.has(id));

  return schema.normalizeSnapshot({
    source: 'extension-settings',
    userConfig: {
      selectedServiceIds: selectedIds,
      resolutionMode: existingSnapshot && existingSnapshot.userConfig
        ? existingSnapshot.userConfig.resolutionMode
        : 'lowest_cost',
      updatedAt: new Date().toISOString(),
    },
    formState: existingSnapshot && existingSnapshot.formState ? existingSnapshot.formState : {},
    catalogSnapshot,
    ruleSnapshot,
  });
}

function buildOfficialSnapshotFromHar(officialHar) {
  const importer = globalThis.OZON_CALC_HAR_IMPORT;
  if (!importer || typeof importer.importOfficialHar !== 'function') throw new Error('官方运费解析器未加载');
  return importer.importOfficialHar(officialHar);
}

function latestCapturedAt(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((latest, entry) => {
    const capturedAt = toText(captureEntryMeta(entry).capturedAt);
    return capturedAt > latest ? capturedAt : latest;
  }, '');
}

function buildCurrentErpPackageContent(result) {
  const captureStore = globalThis.OZON_CALC_CAPTURE_STORE;
  const sellerProductsExporter = globalThis.OZON_CALC_SELLER_PRODUCTS_EXPORT;
  const sellerLogisticsExporter = globalThis.OZON_CALC_SELLER_LOGISTICS_EXPORT;
  const officialFreightExporter = globalThis.OZON_CALC_OFFICIAL_FREIGHT_EXPORT;
  const erpExporter = globalThis.OZON_CALC_ERP_PACKAGE_EXPORT;
  if (!captureStore || typeof captureStore.buildHarPayload !== 'function') throw new Error('capture store 未加载');
  if (!erpExporter || typeof erpExporter.exportErpPackageAsJson !== 'function') throw new Error('erp package exporter 未加载');

  const productPool = Array.isArray(result[OZON_CALC_PRODUCT_POOL_KEY]) ? result[OZON_CALC_PRODUCT_POOL_KEY] : [];
  const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
  const visibleSnapshots = Array.isArray(result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY]) ? result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY] : [];
  const sellerProductsHar = captureStore.buildHarPayload(entries, 'seller-products');
  const sellerHar = captureStore.buildHarPayload(entries, 'seller');
  const officialHar = captureStore.buildHarPayload(entries, 'official');
  const allHar = captureStore.buildHarPayload(entries, 'all');
  const sellerProducts = sellerProductsExporter && typeof sellerProductsExporter.extractSellerProductsFromEntries === 'function'
    ? sellerProductsExporter.extractSellerProductsFromEntries(sellerProductsHar.log.entries)
    : [];
  const sellerLogistics = sellerLogisticsExporter && typeof sellerLogisticsExporter.extractSellerLogisticsTemplatesFromEntries === 'function'
    ? sellerLogisticsExporter.extractSellerLogisticsTemplatesFromEntries(sellerHar.log.entries)
    : [];
  const officialFreight = officialFreightExporter && typeof officialFreightExporter.extractOfficialFreightSamplesFromEntries === 'function'
    ? officialFreightExporter.extractOfficialFreightSamplesFromEntries(officialHar.log.entries)
    : [];
  const content = erpExporter.exportErpPackageAsJson({
    productPool,
    sellerProducts,
    sellerLogistics,
    officialFreight,
    visibleSnapshots,
    capturedHar: allHar,
  });
  return {
    content,
    parsed: JSON.parse(content),
  };
}

function buildErpPackageSummaryDiagnostics(counts) {
  const sectionLabels = [
    ['productPool', '选品池'],
    ['sellerProducts', 'seller 商品表'],
    ['sellerLogistics', 'seller 物流模板'],
    ['officialFreight', 'official 运费样本'],
    ['visibleSnapshots', '页面快照'],
    ['capturedHarEntries', 'HAR 捕获'],
  ];
  const normalizedCounts = counts && typeof counts === 'object' ? counts : {};
  const sectionStatus = sectionLabels.map(([key, label]) => {
    const count = Number(normalizedCounts[key]) || 0;
    return {
      key,
      label,
      count,
      ok: count > 0,
    };
  });
  const missingSections = sectionStatus.filter((section) => !section.ok).map((section) => section.key);
  const warnings = sectionStatus.filter((section) => !section.ok).map((section) => '缺少 ' + section.label);
  const totalCount = sectionStatus.reduce((total, section) => total + section.count, 0);
  return {
    sectionStatus,
    missingSections,
    warnings,
    totalCount,
  };
}

function appendErpPushHistory(result, item) {
  const existing = Array.isArray(result[OZON_CALC_ERP_PUSH_HISTORY_KEY]) ? result[OZON_CALC_ERP_PUSH_HISTORY_KEY] : [];
  const historyItem = {
    pushedAt: safeIsoDate(item.pushedAt),
    ok: Boolean(item.ok),
    endpoint: normalizeEndpoint(item.endpoint),
    hasToken: Boolean(item.hasToken),
    status: Number(item.status) || 0,
    counts: item.counts && typeof item.counts === 'object' ? item.counts : {},
    error: toText(item.error).slice(0, 500),
    responseText: toText(item.responseText).slice(0, 500),
  };
  const next = existing.concat([historyItem]).slice(-OZON_CALC_ERP_PUSH_HISTORY_LIMIT);
  return chrome.storage.local.set({ [OZON_CALC_ERP_PUSH_HISTORY_KEY]: next }).then(() => historyItem);
}

function normalizeSourceCandidateContext(payload, now) {
  const store = globalThis.SS_ERP_SOURCE_CANDIDATE_STORE;
  if (!store || typeof store.normalizeOzonProduct !== 'function') {
    throw new Error('source candidate store 未加载');
  }
  const ozon = store.normalizeOzonProduct(payload && typeof payload === 'object' ? payload : {}, { now });
  if (!ozon.productId && !ozon.url) {
    throw new Error('缺少 Ozon 商品上下文');
  }
  return {
    ozon,
    savedAt: safeIsoDate(now),
  };
}

function getFreshSourceCandidateContext(result) {
  const context = result && result[SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY];
  if (!context || typeof context !== 'object' || !context.ozon) return null;
  const savedAt = new Date(context.savedAt || '').getTime();
  if (!Number.isFinite(savedAt) || Date.now() - savedAt > SS_ERP_SOURCE_CANDIDATE_CONTEXT_TTL_MS) return null;
  return context;
}

function getSourceQuoteStore() {
  const store = globalThis.SS_ERP_SOURCE_QUOTE_STORE;
  if (!store || typeof store.normalizeQuote !== 'function' || typeof store.upsertQuote !== 'function') {
    throw new Error('source quote store 未加载');
  }
  return store;
}

function normalizeSourceQuoteFromPayload(payload, context, existingQuote) {
  const store = getSourceQuoteStore();
  const raw = payload && typeof payload === 'object' ? payload : {};
  const ozon = raw.ozon || raw.ozonProduct || (context && context.ozon);
  if (!ozon) {
    throw new Error('没有最近的 Ozon 商品上下文，请先在 Ozon 商品页点击“核价找货源”');
  }
  const sourceProduct = raw.sourceProduct || raw.source || raw.product || {};
  return store.normalizeQuote({
    ozon,
    sourceProduct,
    status: raw.status || 'selected_for_costing',
    costCny: raw.costCny,
  }, existingQuote || null, { now: raw.now || new Date().toISOString() });
}

function normalizeComparableUrl(value) {
  return toText(value).trim().split('#')[0].replace(/\/+$/, '');
}

function ozonQuoteMatchesTab(quote, tabUrl) {
  const ozon = quote && quote.ozon || {};
  const url = normalizeComparableUrl(tabUrl);
  if (!url) return false;
  if (ozon.url && normalizeComparableUrl(ozon.url) === url) return true;
  if (ozon.productId && new RegExp('(?:-|/)' + ozon.productId + '(?:/|$)').test(url)) return true;
  return false;
}

async function notifyOzonTabToApplySourceQuote(quote) {
  if (!quote || !quote.ozon || !quote.ozon.url) return;
  let targetTab = null;
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://*.ozon.ru/product/*',
        'https://*.ozon.kz/product/*',
        'https://*.ozon.by/product/*'
      ]
    });
    targetTab = (tabs || []).find((tab) => tab && ozonQuoteMatchesTab(quote, tab.url));
  } catch (_error) {}

  if (targetTab && targetTab.id != null) {
    try {
      await chrome.tabs.update(targetTab.id, { active: true });
      if (targetTab.windowId != null) await chrome.windows.update(targetTab.windowId, { focused: true });
    } catch (_error) {}
    try {
      await chrome.tabs.sendMessage(targetTab.id, {
        type: 'ss-erp:source-quote-apply',
        quote,
      });
    } catch (_error) {}
    return;
  }

  try {
    const created = await chrome.tabs.create({ url: quote.ozon.url, active: true });
    if (created && created.id != null) {
      setTimeout(() => {
        try {
          chrome.tabs.sendMessage(created.id, {
            type: 'ss-erp:source-quote-apply',
            quote,
          }).catch(() => {});
        } catch (_error) {}
      }, 1200);
    }
  } catch (_error) {}
}

async function syncSourceCandidateQuote(quote) {
  if (!self.SS_ERP_CLIENT || typeof self.SS_ERP_CLIENT.syncSourceCandidateQuote !== 'function') {
    return { ok: false, error: 'ERP 适配器未加载，请重新加载扩展后重试' };
  }
  try {
    const data = await self.SS_ERP_CLIENT.syncSourceCandidateQuote({
      ozon: quote && quote.ozon,
      sourceProduct: quote && quote.source,
      quote,
    });
    if (!data || data.code !== 1) {
      return { ok: false, error: (data && data.msg) || 'ERP 同步失败' };
    }
    return { ok: true, data: data.data || null };
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

function firstText(values) {
  for (const value of values) {
    const text = toText(value).trim();
    if (text) return text;
  }
  return '';
}

function getHostnameFromUrl(value) {
  try {
    return new URL(toText(value)).hostname.toLowerCase();
  } catch (_error) {
    return '';
  }
}

function normalizeSourcePlatformForCollect(product) {
  const sourceUrl = firstText([product.sourceUrl, product.tabUrl, product.url]);
  const host = firstText([product.sourceHost, getHostnameFromUrl(sourceUrl)]).toLowerCase();
  const raw = firstText([product.sourcePlatform, product.platform, host]).toLowerCase();
  const haystack = [raw, host, sourceUrl.toLowerCase()].join(' ');
  if (haystack.includes('1688')) return '1688';
  if (haystack.includes('pinduoduo') || haystack.includes('yangkeduo') || /\bpdd\b/.test(haystack)) return 'pdd';
  if (haystack.includes('tmall') || haystack.includes('天猫')) return 'tmall';
  if (haystack.includes('taobao') || haystack.includes('淘宝')) return 'taobao';
  return firstText([product.sourcePlatform, product.platform]) || 'source';
}

function normalizeCollectImages(product) {
  const values = [];
  function append(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    const text = toText(value).trim();
    const normalized = normalizeCollectImageUrl(text);
    if (normalized && !values.includes(normalized)) values.push(normalized);
  }
  append(product.images);
  append(product.imageUrls);
  append(product.mainImage);
  append(product.imageUrl);
  return values.slice(0, 50);
}

function normalizeCollectImageUrl(value) {
  let text = toText(value).trim();
  if (!text) return '';
  if (text.startsWith('//')) text = 'https:' + text;
  if (!/^https?:\/\//i.test(text)) return '';
  const lower = text.toLowerCase();
  if (/\.(svg)(?:[?#]|$)/i.test(lower)) return '';
  if (/(logo|icon|avatar|badge|coupon|qrcode|qr-code|play_btn|playbtn|operate|operation|\/cms\/)/i.test(lower)) return '';
  if (/[-_]tps[-_]\d{1,4}[-x]\d{1,4}|55-tps|\b2-tps\b|gg_dtc|[-_/]rate(?:[._/-]|$)/i.test(lower)) return '';
  if (/imgextra\/i\d\/600000\d+\/.*(?:-tps-|gg_dtc|160-160|44-45|24-24|16-16)/i.test(lower)) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname
      .replace(/\.(jpe?g|png|webp)_\.webp$/i, '.$1')
      .replace(/\.(jpe?g|png|webp)_(?:sum|b)\.(?:jpe?g|png|webp)$/i, '.$1')
      .replace(/\.(jpe?g|png|webp)_(?:\d{2,4}x\d{2,4}|q\d+)\.(?:jpe?g|png|webp)$/i, '.$1');
    return url.href;
  } catch (_error) {
    return text;
  }
}

function isForeignOzonTitleTextForSourceCollect(value, product) {
  const platform = normalizeSourcePlatformForCollect(product).toLowerCase();
  if (platform === 'ozon') return false;
  const text = firstText([value]);
  if (!text) return false;
  return /\bozon\b/i.test(text)
    && (/\bsku\b/i.test(text) || /跟卖|核价/.test(text) || /\bozon\b\D{0,16}\d{6,}/i.test(text));
}

function buildSourceCollectFallbackTitle(product, sourceProductId) {
  const platform = normalizeSourcePlatformForCollect(product).toLowerCase();
  const labels = {
    '1688': '1688 商品',
    pdd: '拼多多商品',
    taobao: '淘宝商品',
    tmall: '天猫商品',
    jd: '京东商品',
    temu: 'Temu 商品',
    aliexpress: 'AliExpress 商品',
    wb: 'Wildberries 商品',
  };
  const label = labels[platform] || '货源商品';
  return sourceProductId ? label + ' ' + sourceProductId : label;
}

function pickSourceCollectTitle(product, sourceProductId, candidates) {
  const source = product && typeof product === 'object' ? product : {};
  const values = Array.isArray(candidates)
    ? candidates
    : [source.title, source.titleZh, source.name, source.tabTitle];
  for (const value of values) {
    const text = firstText([value]);
    if (text && !isForeignOzonTitleTextForSourceCollect(text, source)) return text;
  }
  return buildSourceCollectFallbackTitle(source, sourceProductId);
}

function normalizeSourceProductForErpCollect(product) {
  const source = product && typeof product === 'object' ? product : {};
  const sourceUrl = firstText([source.sourceUrl, source.tabUrl, source.url]);
  const sourceProductId = firstText([
    source.sourceProductId,
    source.productId,
    source.goodsId,
    source.offerId,
    source.sku,
  ]);
  const title = pickSourceCollectTitle(source, sourceProductId);
  const unitPriceText = firstText([source.priceText, source.price, source.priceCny]);
  const purchaseCostText = firstText([source.totalCostCny, source.purchaseCostCny, source.landedCostCny, unitPriceText]);
  const selectedSku = source.selectedSku && typeof source.selectedSku === 'object' ? source.selectedSku : null;
  const selectedSkuText = selectedSku ? firstText([selectedSku.skuId, selectedSku.sku, selectedSku.id, selectedSku.name, selectedSku.specText]) : '';
  const item = {
    ...source,
    captureV2: undefined,
    title,
    publishTitle: '',
    sourceTitleRaw: pickSourceCollectTitle(source, sourceProductId, [source.sourceTitleRaw, source.title, source.titleZh, source.name]),
    sourceLocale: firstText([source.sourceLocale]) || 'zh-CN',
    sourceUrl,
    sourcePlatform: normalizeSourcePlatformForCollect(source),
    sourceProductId: sourceProductId || undefined,
    sku: firstText([selectedSkuText, source.sku, sourceProductId]) || undefined,
    images: normalizeCollectImages(source),
    price: purchaseCostText,
    priceText: purchaseCostText,
    unitPriceText,
    shippingCny: source.shippingCny != null ? source.shippingCny : source.freightCny,
    totalCostCny: source.totalCostCny != null ? source.totalCostCny : source.purchaseCostCny,
    selectedSku: selectedSku || undefined,
    skuItems: Array.isArray(source.skuItems) ? source.skuItems.slice(0, 100) : undefined,
    variants: Array.isArray(source.variants) && source.variants.length
      ? source.variants.slice(0, 100)
      : (Array.isArray(source.skuItems) ? source.skuItems.slice(0, 100) : undefined),
    priceSourceType: source.priceSourceType,
    currency: firstText([source.currency]) || 'CNY',
  };
  if (!item.weightG && source.grossWeightGrams) item.weightG = source.grossWeightGrams;
  return item;
}

async function notifyErpCollectCompleted(collected, errorCount) {
  try {
    let bridgeMatches = ['http://localhost/*', 'https://localhost/*', 'http://127.0.0.1/*', 'https://127.0.0.1/*'];
    try {
      const mf = chrome.runtime.getManifest();
      const bridge = (mf.content_scripts || []).find((cs) => {
        return Array.isArray(cs.js) && cs.js.indexOf('content/erp-collect-bridge.js') >= 0;
      });
      if (bridge && Array.isArray(bridge.matches) && bridge.matches.length) {
        bridgeMatches = bridge.matches.filter((match) => /^https?:/.test(match));
      }
    } catch (_error) {}
    const erpTabs = await chrome.tabs.query({ url: bridgeMatches });
    for (const tab of erpTabs) {
      try {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ss-erp:collect-completed',
          collected: Number(collected) || 0,
          errorCount: Number(errorCount) || 0,
        });
      } catch (_error) {}
    }
  } catch (_error) {}
}

function enqueueImageSearchJob(task) {
  const run = imageSearchJobsQueue.then(() => task());
  imageSearchJobsQueue = run.catch(() => {});
  return run;
}

function normalizeSourceSearchPlatforms(value) {
  const raw = Array.isArray(value) ? value : [];
  const normalized = [];
  for (const item of raw) {
    const text = toText(item).trim().toLowerCase();
    const platform = text === '1688' || text === 'ali1688'
      ? '1688'
      : (text === 'pdd' || text === 'pinduoduo' ? 'pdd' : (text === 'taobao' || text === 'tb' ? 'taobao' : ''));
    if (platform && !normalized.includes(platform)) normalized.push(platform);
  }
  return normalized;
}

function normalizeRemoteImageUrl(value) {
  const text = toText(value).trim();
  if (!text) return '';
  return text.startsWith('//') ? ('https:' + text) : text;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function fetchImageAsBase64(imageUrl) {
  const normalizedUrl = normalizeRemoteImageUrl(imageUrl);
  if (!/^https?:\/\//i.test(normalizedUrl)) throw new Error('缺少可用的 Ozon 主图链接');
  const response = await fetch(normalizedUrl, { credentials: 'omit' });
  if (!response.ok) throw new Error('读取 Ozon 主图失败：HTTP ' + response.status);
  const contentType = response.headers && response.headers.get ? response.headers.get('content-type') : '';
  if (contentType && !/^image\//i.test(contentType)) throw new Error('Ozon 主图响应不是图片');
  const buffer = await response.arrayBuffer();
  if (!buffer || !buffer.byteLength) throw new Error('Ozon 主图为空，无法以图搜图');
  return arrayBufferToBase64(buffer);
}

async function openImageSearchTabsFromOzon(payload) {
  payload = payload && typeof payload === 'object' ? payload : {};
  const prefs = await chrome.storage.local.get([SS_ERP_SOURCE_SEARCH_PLATFORM_PREFS_KEY]);
  const platforms = normalizeSourceSearchPlatforms(payload.platforms).length
    ? normalizeSourceSearchPlatforms(payload.platforms)
    : (normalizeSourceSearchPlatforms(prefs[SS_ERP_SOURCE_SEARCH_PLATFORM_PREFS_KEY]).length
      ? normalizeSourceSearchPlatforms(prefs[SS_ERP_SOURCE_SEARCH_PLATFORM_PREFS_KEY])
      : SS_ERP_DEFAULT_SOURCE_SEARCH_PLATFORMS.slice());
  if (!platforms.length) throw new Error('请至少选择一个核价网站');

  const imageUrl = normalizeRemoteImageUrl(payload.imageUrl || payload.mainImage || payload.image);
  const imageBase64 = toText(payload.imageBase64).trim() || await fetchImageAsBase64(imageUrl);
  const helper = globalThis.SS_ERP_IMAGE_SEARCH_JOB;
  if (!helper || typeof helper.createImageSearchJob !== 'function') {
    throw new Error('image search job helper 未加载');
  }

  const jobsToOpen = await enqueueImageSearchJob(async () => {
    const result = await chrome.storage.local.get([SS_ERP_IMAGE_SEARCH_JOBS_KEY]);
    let jobs = result[SS_ERP_IMAGE_SEARCH_JOBS_KEY] && typeof result[SS_ERP_IMAGE_SEARCH_JOBS_KEY] === 'object'
      ? result[SS_ERP_IMAGE_SEARCH_JOBS_KEY]
      : {};
    const opened = [];
    for (const platform of platforms) {
      const created = helper.createImageSearchJob(jobs, {
        platform,
        imageUrl,
        imageBase64,
        imagePreviewDataUrl: payload.imagePreviewDataUrl,
        imageSize: payload.imageSize,
        ozon: payload.ozon,
      });
      jobs = created.jobs;
      opened.push({ platform, token: created.token, url: created.url });
    }
    await chrome.storage.local.set({ [SS_ERP_IMAGE_SEARCH_JOBS_KEY]: jobs });
    return opened;
  });

  for (const job of jobsToOpen) {
    await chrome.tabs.create({ url: job.url });
  }
  return jobsToOpen;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  const runtimeMessagePolicy = globalThis.SS_ERP_RUNTIME_MESSAGE_POLICY;
  if (!runtimeMessagePolicy
    || typeof runtimeMessagePolicy.isKnownRuntimeMessageType !== 'function'
    || typeof runtimeMessagePolicy.isAllowedRuntimeMessageSender !== 'function') {
    sendResponse({ ok: false, error: '扩展消息安全策略不可用' });
    return false;
  }
  if (!runtimeMessagePolicy.isKnownRuntimeMessageType(message.type)) return false;
  if (!runtimeMessagePolicy.isAllowedRuntimeMessageSender(message.type, sender, chrome.runtime.id)) {
    sendResponse({ ok: false, error: '不允许的扩展消息来源' });
    return false;
  }
  if (message.type === SS_ERP_OPEN_SOURCE_WORKFLOW_HANDOFF_MESSAGE) {
    Promise.resolve().then(async () => {
      if (!self.SS_ERP_CONFIG || typeof self.SS_ERP_CONFIG.getConfig !== 'function') {
        throw new Error('ERP 运行配置不可用');
      }
      const [config, handoff] = await Promise.all([
        self.SS_ERP_CONFIG.getConfig(),
        readPersistedSourceWorkflowHandoff(message.platform, message.sourceProductId),
      ]);
      if (!handoff) throw new Error('没有可继续的 ERP 来源商品记录');
      const expectedSnapshotId = sourceWorkflowHandoffText(message.snapshotId, 200);
      if (!expectedSnapshotId || expectedSnapshotId !== handoff.snapshotId) {
        throw new Error('ERP 来源商品记录已变化，请使用最新采集结果继续');
      }
      const url = buildConfiguredSourceWorkflowUrl(config && config.baseUrl, handoff);
      await chrome.tabs.create({ url, active: true });
      return { url, handoff };
    }).then((result) => {
      sendResponse({ ok: true, ...result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-listing-workbench-status') {
    Promise.resolve().then(async () => {
      const sourceProductId = sourceWorkflowHandoffText(message.sourceProductId, 200);
      const platform = sourceWorkflowPlatform(message.platform);
      const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
      if (!handoff || !sourceProductId || !platform
        || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
        return { state: 'unavailable', reason: 'source_handoff_mismatch' };
      }
      const result = await getSourceListingWorkflowClient().getStatus({
        snapshotId: handoff.snapshotId,
        supplyGoodsId: handoff.supplyGoodsId,
      });
      return { handoff, result };
    }).then((result) => {
      sendResponse({ ok: true, ...result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type)) {
    const securitySchema = globalThis.OZON_CALC_SYNC_SCHEMA;
    if (!securitySchema
      || typeof securitySchema.isTrustedSettingsSender !== 'function'
      || !securitySchema.isTrustedSettingsSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: '该计算器操作仅允许从插件设置页发起' });
      return false;
    }
  }

  if (OZON_CALC_IMPORT_PAGE_WRITE_CHANNELS.has(message.type)) {
    const securitySchema = globalThis.OZON_CALC_SYNC_SCHEMA;
    if (!securitySchema
      || typeof securitySchema.isTrustedManualImportSender !== 'function'
      || !securitySchema.isTrustedManualImportSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: '该配置操作仅允许从插件设置页发起' });
      return false;
    }
  }

  if (OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type)
    && message.type.startsWith('ss-erp:logistics-')) {
    if (!isLogisticsDistributionFeatureEnabled()) {
      sendResponse({ handled: true, ok: false, errorCode: 'feature_disabled' });
      return false;
    }
    try {
      const handler = message.type.startsWith('ss-erp:logistics-capture-')
        ? getLogisticsCaptureMessageHandler()
        : message.type.startsWith('ss-erp:logistics-binding-probe-')
          ? getLogisticsBindingProbeMessageHandler()
          : getLogisticsDistributionMessageHandler();
      Promise.resolve(handler(message, sender)).then(sendResponse).catch(() => {
        sendResponse({ handled: true, ok: false, errorCode: 'operation_failed' });
      });
    } catch (_error) {
      sendResponse({ handled: true, ok: false, errorCode: 'runtime_unavailable' });
      return false;
    }
    return true;
  }

  if (message.type === 'ss-erp:ozon-company-id-captured') {
    rememberRuntimeOzonCompanyIdForSync(message.companyId, message.capturedAt);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'ss-erp:ping') {
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, 'ss_erp_connection']).then((result) => {
      const legacyConn = result.ss_erp_connection || {};
      const rawEndpoint = result[OZON_CALC_ERP_ENDPOINT_KEY] || (legacyConn.baseUrl ? legacyConn.baseUrl + '/api/collect' : '');
      const endpoint = normalizeEndpoint(rawEndpoint);
      const baseUrl = endpoint
        ? endpoint.replace(/\/api\/.*$/, '').replace(/\/+$/, '')
        : toText(legacyConn.baseUrl).trim().replace(/\/+$/, '');
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY] || legacyConn.token).trim();
      const collectModule = globalThis.SS_ERP_COLLECT_BACKGROUND || {};
      sendResponse({
        ok: true,
        version: chrome.runtime.getManifest().version,
        endpoint: baseUrl,
        hasEndpoint: Boolean(baseUrl),
        hasToken: Boolean(token),
        hasCollectModule: Boolean(collectModule.collectOzonProductsToErp),
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === OZON_CALC_SYNC_CHANNEL) {
    const schema = globalThis.OZON_CALC_SYNC_SCHEMA;
    if (!schema
      || typeof schema.isTrustedManualImportSender !== 'function'
      || typeof schema.prepareManualImport !== 'function') {
      sendResponse({ ok: false, error: '同步配置安全校验不可用' });
      return false;
    }
    if (!schema.isTrustedManualImportSender(sender, chrome.runtime.id)) {
      sendResponse({ ok: false, error: '不允许的配置写入来源' });
      return false;
    }

    const prepared = schema.prepareManualImport(message.payload);
    if (!prepared.valid || !prepared.snapshot) {
      sendResponse({
        ok: false,
        error: prepared.errors.length ? prepared.errors.join('；').slice(0, 500) : '配置无效',
      });
      return false;
    }

    const snapshot = prepared.snapshot;
    (async () => {
      const source = toText(
        snapshot.catalogSnapshot && snapshot.catalogSnapshot.metadata
          && snapshot.catalogSnapshot.metadata.source
      );
      const persisted = await persistManualCalculatorData({
        snapshot,
        source,
      });
      if (persisted.state === 'scope_required') {
        sendResponse({ ok: false, errorCode: 'scope_required', error: '请先绑定物流规则范围后再导入' });
        return;
      }
      sendResponse({
        ok: true,
        snapshot: persisted.snapshot || snapshot,
        officialSnapshot: persisted.officialSnapshot || null,
        mode: persisted.mode,
        state: persisted.state,
      });
    })().catch((error) => {
      sendResponse({
        ok: false,
        errorCode: error && error.code || undefined,
        error: error && error.message ? error.message : String(error),
      });
    });
    return true;
  }

  if (message.type === 'ozon-calc:erp-enqueue') {
    chrome.storage.local.get([OZON_CALC_ERP_QUEUE_KEY]).then((result) => {
      const queue = Array.isArray(result[OZON_CALC_ERP_QUEUE_KEY]) ? result[OZON_CALC_ERP_QUEUE_KEY] : [];
      queue.push({
        ...message.payload,
        queuedAt: new Date().toISOString(),
      });
      return chrome.storage.local.set({ [OZON_CALC_ERP_QUEUE_KEY]: queue });
    }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:collect-to-erp') {
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY]).then((result) => {
      const baseEndpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY]);
      if (!baseEndpoint) throw new Error('请先在插件设置中配置 ERP 地址');
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY]).trim();
      if (!token) throw new Error('请先在插件设置中配置 ERP Token');
      const collectUrl = baseEndpoint.replace(/\/api\/.*$/, '') + '/api/collect';
      const headers = { 'content-type': 'application/json;charset=utf-8' };
      headers.authorization = 'Bearer ' + token;
      return fetch(collectUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(message.payload || {}),
      }).then((response) => {
        return response.text().then((text) => {
          if (!response.ok) {
            throw new Error('ERP 返回 HTTP ' + response.status + ': ' + text.slice(0, 300));
          }
          let parsed = {};
          try { parsed = JSON.parse(text); } catch (e) {}
          if (parsed.code === 0) throw new Error(parsed.msg || '采集失败');
          sendResponse({ ok: true, data: parsed });
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:query-collect-status') {
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, 'ss_erp_connection']).then((result) => {
      const legacyConn = result.ss_erp_connection || {};
      const baseEndpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY] || (legacyConn.baseUrl ? legacyConn.baseUrl + '/api/collect' : ''));
      if (!baseEndpoint) {
        sendResponse({ ok: false, msg: '未配置 ERP' });
        return;
      }
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY] || legacyConn.token).trim();
      if (!token) {
        sendResponse({ ok: false, msg: '未配置 ERP Token' });
        return;
      }
      const sku = String(message.sku || '').trim();
      if (!sku) {
        sendResponse({ ok: false, msg: '缺少 SKU' });
        return;
      }
      const queryUrl = baseEndpoint.replace(/\/api\/.*$/, '') + '/api/collect/status?sku=' + encodeURIComponent(sku);
      return fetch(queryUrl, {
        method: 'GET',
        headers: { authorization: 'Bearer ' + token },
      }).then((response) => response.text().then((text) => {
        if (!response.ok) {
          sendResponse({ ok: false, msg: 'HTTP ' + response.status });
          return;
        }
        let parsed = {};
        try { parsed = JSON.parse(text); } catch (e) {}
        if (parsed.code === 1 && parsed.data) {
          sendResponse({ ok: true, collected: !!parsed.data.collected, shopName: parsed.data.shopName || null });
        } else {
          sendResponse({ ok: true, collected: false });
        }
      }));
    }).catch((error) => {
      sendResponse({ ok: false, msg: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:query-collect-batch-snapshot') {
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, 'ss_erp_connection']).then((result) => {
      const legacyConn = result.ss_erp_connection || {};
      const baseEndpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY] || (legacyConn.baseUrl ? legacyConn.baseUrl + '/api/collect' : ''));
      if (!baseEndpoint) {
        sendResponse({ ok: false, msg: '未配置 ERP' });
        return;
      }
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY] || legacyConn.token).trim();
      if (!token) {
        sendResponse({ ok: false, msg: '未配置 ERP Token' });
        return;
      }
      const skus = Array.isArray(message.skus)
        ? message.skus.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
      if (!skus.length) {
        sendResponse({ ok: false, msg: '缺少 SKU 列表' });
        return;
      }
      const queryUrl = baseEndpoint.replace(/\/api\/.*$/, '') + '/api/collect/batch-snapshot';
      return fetch(queryUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json;charset=utf-8',
          authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ skus: skus.slice(0, 100) }),
      }).then((response) => response.text().then((text) => {
        if (!response.ok) {
          sendResponse({ ok: false, msg: 'HTTP ' + response.status });
          return;
        }
        let parsed = {};
        try { parsed = JSON.parse(text); } catch (e) {}
        if (parsed.code === 1) {
          sendResponse({ ok: true, data: parsed.data || {} });
        } else {
          sendResponse({ ok: false, msg: parsed.msg || '查询失败' });
        }
      }));
    }).catch((error) => {
      sendResponse({ ok: false, msg: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:collect-product') {
    // 复用 collect-background.js 暴露的完整链路，避免 background 自发消息导致 MV3 接收端丢失。
    const sku = String(message.sku || '').trim();
    if (!sku) {
      sendResponse({ ok: false, msg: '缺少 SKU' });
      return false;
    }
    const collector = globalThis.SS_ERP_COLLECT_BACKGROUND && globalThis.SS_ERP_COLLECT_BACKGROUND.collectOzonProductsToErp;
    if (typeof collector !== 'function') {
      sendResponse({ ok: false, msg: '采集模块未加载，请重新加载扩展后重试' });
      return false;
    }
    collector([sku]).then((resp) => {
        if (!resp || !resp.ok) {
          sendResponse({ ok: false, msg: (resp && resp.error) || '采集失败' });
          return;
        }
        const data = resp.data || {};
        const errors = Array.isArray(data.errors) ? data.errors : [];
        const collected = Number(data.collected) || 0;
        if (collected > 0) {
          const firstError = errors[0];
          sendResponse({
            ok: true,
            collected,
            errorCount: errors.length,
            msg: errors.length
              ? `已采集 ${collected} 件，${errors.length} 件失败：${firstError?.error || '未知错误'}`
              : `已采集 ${collected} 件商品`,
          });
        } else {
          const firstError = errors[0];
          sendResponse({
            ok: false,
            msg: firstError?.error || '采集失败：未拿到商品数据',
          });
        }
      }).catch((error) => {
        sendResponse({ ok: false, msg: error && error.message ? error.message : String(error) });
      });
    return true;
  }

  if (message.type === 'ozon-calc:erp-endpoint-save') {
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    const endpoint = normalizeEndpoint(payload.endpoint);
    const token = toText(payload.token).trim();
    if (!endpoint) {
      sendResponse({ ok: false, error: 'ERP 导入地址必须是 http/https URL' });
      return false;
    }
    const baseUrl = endpoint.replace(/\/api\/.*$/, '').replace(/\/+$/, '');
    Promise.resolve().then(async () => {
      let user = null;
      if (token) {
        const userResponse = await fetch(baseUrl + '/api/user/me', {
          method: 'GET',
          headers: { 'Authorization': 'Bearer ' + token },
        });
        const userPayload = await userResponse.json().catch(() => null);
        if (!userResponse.ok || !userPayload || userPayload.code !== 1 || !userPayload.data) {
          throw new Error((userPayload && userPayload.msg) || 'ERP Token 无效，请重新生成扩展 Token');
        }
        const boundUser = userPayload.data;
        user = {
          id: boundUser.id ? String(boundUser.id) : '',
          phone: boundUser.phone ? String(boundUser.phone) : '',
          nickname: boundUser.nickname ? String(boundUser.nickname) : '',
          accountCode: boundUser.accountCode ? String(boundUser.accountCode) : '',
          role: boundUser.role ? String(boundUser.role) : '',
        };
      }
      await chrome.storage.local.set({
        [OZON_CALC_ERP_ENDPOINT_KEY]: endpoint,
        [OZON_CALC_ERP_TOKEN_KEY]: token,
        ss_erp_connection: { baseUrl, token },
      });
      if (self.SS_ERP_RUNTIME) self.SS_ERP_RUNTIME.syncRuntimeMode();
      sendResponse({ ok: true, endpoint, hasToken: Boolean(token), user: user });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:erp-endpoint-get') {
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, OZON_CALC_ERP_PUSH_HISTORY_KEY, 'ss_erp_connection']).then((result) => {
      const history = Array.isArray(result[OZON_CALC_ERP_PUSH_HISTORY_KEY]) ? result[OZON_CALC_ERP_PUSH_HISTORY_KEY] : [];
      const legacyConn = result.ss_erp_connection || {};
      const endpoint = toText(result[OZON_CALC_ERP_ENDPOINT_KEY] || legacyConn.baseUrl).trim();
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY] || legacyConn.token).trim();
      sendResponse({
        ok: true,
        endpoint,
        hasToken: Boolean(token),
        lastPush: history.length ? history[history.length - 1] : null,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:erp-push-history-list') {
    chrome.storage.local.get([OZON_CALC_ERP_PUSH_HISTORY_KEY]).then((result) => {
      const history = Array.isArray(result[OZON_CALC_ERP_PUSH_HISTORY_KEY]) ? result[OZON_CALC_ERP_PUSH_HISTORY_KEY] : [];
      sendResponse({
        ok: true,
        history,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:capture-har-entry') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.appendCapturedEntry !== 'function') {
        throw new Error('capture store 未加载');
      }
      const existing = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const next = store.appendCapturedEntry(existing, message.payload, OZON_CALC_CAPTURE_LIMIT);
      return chrome.storage.local.set({ [OZON_CALC_CAPTURE_ENTRIES_KEY]: next }).then(() => {
        const last = next[next.length - 1] || null;
        sendResponse({
          ok: true,
          entryCount: next.length,
          mode: captureEntryMeta(last).mode || '',
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:get-captured-har') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('capture store 未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const mode = String(message.mode || 'all').toLowerCase();
      const payload = store.buildHarPayload(entries, mode);
      sendResponse({
        ok: true,
        mode,
        entryCount: payload.log.entries.length,
        payload,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:product-pool-upsert') {
    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_PRODUCT_POOL_STORE;
      if (!store || typeof store.upsertProduct !== 'function') {
        throw new Error('product pool store 未加载');
      }
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const now = payload.now || new Date().toISOString();
      const existing = Array.isArray(result[OZON_CALC_PRODUCT_POOL_KEY]) ? result[OZON_CALC_PRODUCT_POOL_KEY] : [];
      let products = store.upsertProduct(existing, payload.product || {}, { now });
      const normalized = store.normalizeProduct(payload.product || {}, { now });
      if (payload.meta && typeof store.updateProductMeta === 'function') {
        products = store.updateProductMeta(products, normalized.key, payload.meta, { now });
      }
      const product = products.find((item) => item && item.key === normalized.key) || null;
      return chrome.storage.local.set({ [OZON_CALC_PRODUCT_POOL_KEY]: products }).then(() => {
        sendResponse({
          ok: true,
          count: products.length,
          product,
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:product-pool-update-meta') {
    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_PRODUCT_POOL_STORE;
      if (!store || typeof store.updateProductMeta !== 'function') {
        throw new Error('product pool store 未加载');
      }
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const existing = Array.isArray(result[OZON_CALC_PRODUCT_POOL_KEY]) ? result[OZON_CALC_PRODUCT_POOL_KEY] : [];
      const products = store.updateProductMeta(existing, String(payload.key || ''), payload.meta || {}, {
        now: payload.now || new Date().toISOString(),
      });
      const product = products.find((item) => item && item.key === payload.key) || null;
      return chrome.storage.local.set({ [OZON_CALC_PRODUCT_POOL_KEY]: products }).then(() => {
        sendResponse({
          ok: Boolean(product),
          count: products.length,
          product,
          error: product ? '' : '未找到商品记录',
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:product-pool-list') {
    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY]).then((result) => {
      const products = Array.isArray(result[OZON_CALC_PRODUCT_POOL_KEY]) ? result[OZON_CALC_PRODUCT_POOL_KEY] : [];
      sendResponse({
        ok: true,
        count: products.length,
        products,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-candidate-context-save') {
    Promise.resolve().then(() => {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const context = normalizeSourceCandidateContext(payload.ozon || payload, payload.now || new Date().toISOString());
      return chrome.storage.local.set({ [SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY]: context }).then(() => {
        sendResponse({ ok: true, context });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-candidate-context-get') {
    chrome.storage.local.get([SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY]).then((result) => {
      const context = getFreshSourceCandidateContext(result);
      if (!context && result[SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY]) {
        chrome.storage.local.remove([SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY]).catch(() => {});
      }
      sendResponse({ ok: true, context });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:collect-source-to-erp') {
    Promise.resolve().then(async () => {
      if (!self.SS_ERP_CLIENT || typeof self.SS_ERP_CLIENT.submitCollect !== 'function') {
        throw new Error('ERP 适配器未加载，请重新加载扩展后重试');
      }
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const rawItems = Array.isArray(payload.items)
        ? payload.items
        : [payload.product || payload.sourceProduct || payload.item || payload].filter((item) => item && typeof item === 'object');
      if (!rawItems.length) throw new Error('缺少货源商品数据');
      const nativeCaptureItems = rawItems.filter((item) => item && item.captureV2 && item.captureV2.provenanceMode === 'native_v2');
      if (nativeCaptureItems.length && nativeCaptureItems.length !== rawItems.length) {
        throw new Error('不能在同一次请求中混合来源采集 V2 与旧版数据');
      }
      if (nativeCaptureItems.length) {
        const submitter = getSourceCaptureSubmitter();
        const submitted = [];
        const handoffs = [];
        for (const sourceItem of nativeCaptureItems) {
          const outcome = await submitter.submit(sourceItem.captureV2);
          if (outcome.state === 'legacy_compatible') {
            if (submitted.length) {
              throw new Error('来源采集策略在批次执行期间发生变化，请检查已写入记录后重试');
            }
            break;
          }
          if (outcome.state !== 'submitted') throw new Error('来源采集 V2 返回未知状态');
          submitted.push(true);
          const sourceProductId = sourceItem.captureV2 && sourceItem.captureV2.sourceIdentity
            ? sourceItem.captureV2.sourceIdentity.productId
            : null;
          const handoff = createSourceWorkflowHandoff(
            outcome.data,
            sourceProductId,
            sourceItem.captureV2 && sourceItem.captureV2.platform,
          );
          if (handoff) handoffs.push(handoff);
        }
        if (submitted.length === nativeCaptureItems.length) {
          const persistedHandoffs = await persistSourceWorkflowHandoffs(handoffs);
          const handoff = persistedHandoffs.length ? persistedHandoffs[persistedHandoffs.length - 1] : null;
          notifyErpCollectCompleted(submitted.length, 0);
          sendResponse({
            ok: true,
            data: { code: 1, data: { saved: submitted.length } },
            saved: submitted.length,
            errorCount: 0,
            handoff,
            captureVersion: 'source-product-capture-v2',
          });
          return;
        }
      }
      const items = rawItems.map(normalizeSourceProductForErpCollect);
      const data = await self.SS_ERP_CLIENT.submitCollect({ items: items });
      if (!data || data.code !== 1) {
        throw new Error((data && data.msg) || 'ERP 采集失败');
      }
      const saved = Number(data.data && data.data.saved) || items.length;
      const errors = data.data && Array.isArray(data.data.errors) ? data.data.errors : [];
      notifyErpCollectCompleted(saved, errors.length);
      sendResponse({ ok: true, data, saved, errorCount: errors.length });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-quote-save') {
    Promise.resolve().then(async () => {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const result = await chrome.storage.local.get([SS_ERP_SOURCE_QUOTES_KEY, SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY]);
      const context = payload.ozon || payload.ozonProduct ? null : getFreshSourceCandidateContext(result);
      const existingQuotes = Array.isArray(result[SS_ERP_SOURCE_QUOTES_KEY]) ? result[SS_ERP_SOURCE_QUOTES_KEY] : [];
      const quoteProbe = normalizeSourceQuoteFromPayload(payload, context, null);
      const existingQuote = existingQuotes.find((item) => item && item.key === quoteProbe.key) || null;
      const quote = normalizeSourceQuoteFromPayload(payload, context, existingQuote);
      const store = getSourceQuoteStore();
      const quotes = store.upsertQuote(existingQuotes, quote);
      await chrome.storage.local.set({
        [SS_ERP_SOURCE_QUOTES_KEY]: quotes,
        [SS_ERP_SOURCE_QUOTE_PENDING_KEY]: quote,
      });
      if (!payload.suppressOzonApply) {
        await notifyOzonTabToApplySourceQuote(quote);
      }
      sendResponse({
        ok: true,
        quote,
        quoteCount: quotes.length,
        ozonUrl: quote.ozon && quote.ozon.url || '',
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-quote-pending-get') {
    chrome.storage.local.get([SS_ERP_SOURCE_QUOTE_PENDING_KEY]).then((result) => {
      const store = getSourceQuoteStore();
      const quote = result[SS_ERP_SOURCE_QUOTE_PENDING_KEY] || null;
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const ozon = payload.ozon || payload.product || payload.productId || '';
      const matched = quote && (!ozon || store.quoteMatchesOzon(quote, ozon)) ? quote : null;
      sendResponse({ ok: true, quote: matched });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-quote-pending-clear') {
    chrome.storage.local.get([SS_ERP_SOURCE_QUOTE_PENDING_KEY]).then((result) => {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const pending = result[SS_ERP_SOURCE_QUOTE_PENDING_KEY] || null;
      const requestedKey = toText(payload.key || message.key).trim();
      if (!pending || (requestedKey && pending.key !== requestedKey)) {
        sendResponse({ ok: true, cleared: false });
        return null;
      }
      return chrome.storage.local.remove([SS_ERP_SOURCE_QUOTE_PENDING_KEY]).then(() => {
        sendResponse({ ok: true, cleared: true });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-quote-list') {
    chrome.storage.local.get([SS_ERP_SOURCE_QUOTES_KEY]).then((result) => {
      const store = getSourceQuoteStore();
      const quotes = Array.isArray(result[SS_ERP_SOURCE_QUOTES_KEY]) ? result[SS_ERP_SOURCE_QUOTES_KEY] : [];
      const ozon = message.ozon || message.productId || '';
      const filtered = ozon ? store.listQuotesForOzon(quotes, ozon) : quotes;
      sendResponse({
        ok: true,
        count: filtered.length,
        quotes: filtered,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-quote-export') {
    chrome.storage.local.get([SS_ERP_SOURCE_QUOTES_KEY]).then((result) => {
      const store = getSourceQuoteStore();
      const quotes = Array.isArray(result[SS_ERP_SOURCE_QUOTES_KEY]) ? result[SS_ERP_SOURCE_QUOTES_KEY] : [];
      sendResponse({
        ok: true,
        format: 'csv',
        filename: 'ss-erp-source-quotes.csv',
        mimeType: 'text/csv;charset=utf-8',
        content: store.exportQuotesAsCsv(quotes),
        count: quotes.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-candidate-upsert') {
    chrome.storage.local.get([SS_ERP_SOURCE_CANDIDATES_KEY, SS_ERP_SOURCE_CANDIDATE_CONTEXT_KEY]).then((result) => {
      const store = globalThis.SS_ERP_SOURCE_CANDIDATE_STORE;
      if (!store || typeof store.upsertCandidateSet !== 'function') {
        throw new Error('source candidate store 未加载');
      }
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const context = payload.ozon ? null : getFreshSourceCandidateContext(result);
      const ozon = payload.ozon || (context && context.ozon);
      if (!ozon) {
        sendResponse({ ok: false, error: '没有最近的 Ozon 商品上下文' });
        return null;
      }
      const existing = Array.isArray(result[SS_ERP_SOURCE_CANDIDATES_KEY]) ? result[SS_ERP_SOURCE_CANDIDATES_KEY] : [];
      const nextSets = store.upsertCandidateSet(existing, ozon, payload.sourceProduct || {}, {
        now: payload.now || new Date().toISOString(),
      });
      const normalizedOzon = store.normalizeOzonProduct(ozon);
      const candidateSet = nextSets.find((item) => item && item.key === normalizedOzon.key) || null;
      return chrome.storage.local.set({ [SS_ERP_SOURCE_CANDIDATES_KEY]: nextSets }).then(() => {
        sendResponse({
          ok: true,
          count: nextSets.length,
          candidateCount: candidateSet && Array.isArray(candidateSet.candidates) ? candidateSet.candidates.length : 0,
          candidateSet,
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-candidate-list') {
    chrome.storage.local.get([SS_ERP_SOURCE_CANDIDATES_KEY]).then((result) => {
      const store = globalThis.SS_ERP_SOURCE_CANDIDATE_STORE;
      const sets = Array.isArray(result[SS_ERP_SOURCE_CANDIDATES_KEY]) ? result[SS_ERP_SOURCE_CANDIDATES_KEY] : [];
      const ozon = message.ozon || message.productId || '';
      const filtered = ozon && store && typeof store.listCandidatesForOzon === 'function'
        ? store.listCandidatesForOzon(sets, ozon)
        : sets;
      sendResponse({
        ok: true,
        count: filtered.length,
        sets: filtered,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:image-search-open-from-ozon') {
    Promise.resolve().then(async () => {
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const jobs = await openImageSearchTabsFromOzon(payload);
      sendResponse({
        ok: true,
        count: jobs.length,
        jobs,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:image-search-create') {
    enqueueImageSearchJob(() => chrome.storage.local.get([SS_ERP_IMAGE_SEARCH_JOBS_KEY]).then((result) => {
      const helper = globalThis.SS_ERP_IMAGE_SEARCH_JOB;
      if (!helper || typeof helper.createImageSearchJob !== 'function') {
        throw new Error('image search job helper 未加载');
      }
      const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
      const existingJobs = result[SS_ERP_IMAGE_SEARCH_JOBS_KEY] && typeof result[SS_ERP_IMAGE_SEARCH_JOBS_KEY] === 'object'
        ? result[SS_ERP_IMAGE_SEARCH_JOBS_KEY]
        : {};
      const created = helper.createImageSearchJob(existingJobs, Object.assign({}, payload, {
        platform: payload.platform || '1688',
      }));
      return chrome.storage.local.set({ [SS_ERP_IMAGE_SEARCH_JOBS_KEY]: created.jobs }).then(() => {
        sendResponse({
          ok: true,
          token: created.token,
          url: created.url,
          platform: payload.platform || '1688',
        });
      });
    })).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:product-pool-export') {
    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_PRODUCT_POOL_STORE;
      if (!store || typeof store.exportProductsAsJson !== 'function' || typeof store.exportProductsAsCsv !== 'function') {
        throw new Error('product pool store 未加载');
      }
      const products = Array.isArray(result[OZON_CALC_PRODUCT_POOL_KEY]) ? result[OZON_CALC_PRODUCT_POOL_KEY] : [];
      const format = String(message.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
      const content = format === 'csv'
        ? store.exportProductsAsCsv(products)
        : store.exportProductsAsJson(products);
      sendResponse({
        ok: true,
        format,
        filename: 'ozon-calc-ozon-product-pool.' + format,
        mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        content,
        count: products.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:visible-snapshot-save') {
    chrome.storage.local.get([OZON_CALC_VISIBLE_SNAPSHOTS_KEY]).then((result) => {
      const existing = Array.isArray(result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY]) ? result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY] : [];
      const snapshot = normalizeVisibleSnapshot(message.payload || {});
      const snapshots = existing.concat([snapshot]).slice(-OZON_CALC_VISIBLE_SNAPSHOT_LIMIT);
      return chrome.storage.local.set({ [OZON_CALC_VISIBLE_SNAPSHOTS_KEY]: snapshots }).then(() => {
        sendResponse({
          ok: true,
          count: snapshots.length,
          snapshot,
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:visible-snapshot-list') {
    chrome.storage.local.get([OZON_CALC_VISIBLE_SNAPSHOTS_KEY]).then((result) => {
      const snapshots = Array.isArray(result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY]) ? result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY] : [];
      sendResponse({
        ok: true,
        count: snapshots.length,
        snapshots,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:visible-snapshot-export') {
    chrome.storage.local.get([OZON_CALC_VISIBLE_SNAPSHOTS_KEY]).then((result) => {
      const snapshots = Array.isArray(result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY]) ? result[OZON_CALC_VISIBLE_SNAPSHOTS_KEY] : [];
      const format = String(message.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
      sendResponse({
        ok: true,
        format,
        filename: 'ozon-calc-visible-page-snapshots.' + format,
        mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        content: format === 'csv' ? exportVisibleSnapshotsAsCsv(snapshots) : exportVisibleSnapshotsAsJson(snapshots),
        count: snapshots.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:seller-products-export') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      const exporter = globalThis.OZON_CALC_SELLER_PRODUCTS_EXPORT;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('capture store 未加载');
      }
      if (!exporter || typeof exporter.extractSellerProductsFromEntries !== 'function') {
        throw new Error('seller products exporter 未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const sellerProductsHar = store.buildHarPayload(entries, 'seller-products');
      const products = exporter.extractSellerProductsFromEntries(sellerProductsHar.log.entries);
      const format = String(message.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
      const content = format === 'csv'
        ? exporter.exportSellerProductsAsCsv(products)
        : exporter.exportSellerProductsAsJson(products);
      sendResponse({
        ok: true,
        format,
        filename: 'ozon-calc-seller-products.' + format,
        mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        content,
        count: products.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:official-freight-export') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      const exporter = globalThis.OZON_CALC_OFFICIAL_FREIGHT_EXPORT;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('capture store 未加载');
      }
      if (!exporter || typeof exporter.extractOfficialFreightSamplesFromEntries !== 'function') {
        throw new Error('official freight exporter 未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const officialHar = store.buildHarPayload(entries, 'official');
      const samples = exporter.extractOfficialFreightSamplesFromEntries(officialHar.log.entries);
      const format = String(message.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
      const content = format === 'csv'
        ? exporter.exportOfficialFreightAsCsv(samples)
        : exporter.exportOfficialFreightAsJson(samples);
      sendResponse({
        ok: true,
        format,
        filename: 'ozon-calc-official-freight-samples.' + format,
        mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        content,
        count: samples.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:seller-logistics-export') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      const exporter = globalThis.OZON_CALC_SELLER_LOGISTICS_EXPORT;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('capture store 未加载');
      }
      if (!exporter || typeof exporter.extractSellerLogisticsTemplatesFromEntries !== 'function') {
        throw new Error('seller logistics exporter 未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const sellerHar = store.buildHarPayload(entries, 'seller');
      const templates = exporter.extractSellerLogisticsTemplatesFromEntries(sellerHar.log.entries);
      const format = String(message.format || 'json').toLowerCase() === 'csv' ? 'csv' : 'json';
      const content = format === 'csv'
        ? exporter.exportSellerLogisticsAsCsv(templates)
        : exporter.exportSellerLogisticsAsJson(templates);
      sendResponse({
        ok: true,
        format,
        filename: 'ozon-calc-seller-logistics-templates.' + format,
        mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
        content,
        count: templates.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:erp-package-export') {
    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY, OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_VISIBLE_SNAPSHOTS_KEY]).then((result) => {
      const built = buildCurrentErpPackageContent(result);
      sendResponse({
        ok: true,
        format: 'json',
        filename: 'ozon-calc-erp-package.json',
        mimeType: 'application/json;charset=utf-8',
        content: built.content,
        count: built.parsed.counts || {},
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

	  if (message.type === 'ozon-calc:erp-package-summary') {
	    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY, OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_VISIBLE_SNAPSHOTS_KEY, OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, OZON_CALC_ERP_PUSH_HISTORY_KEY]).then((result) => {
	      const built = buildCurrentErpPackageContent(result);
	      const counts = built.parsed.counts || {};
	      const diagnostics = buildErpPackageSummaryDiagnostics(counts);
	      const history = Array.isArray(result[OZON_CALC_ERP_PUSH_HISTORY_KEY]) ? result[OZON_CALC_ERP_PUSH_HISTORY_KEY] : [];
	      const endpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY]);
	      sendResponse({
	        ok: true,
	        ready: Boolean(endpoint) && diagnostics.totalCount > 0,
	        endpointConfigured: Boolean(endpoint),
	        hasToken: Boolean(toText(result[OZON_CALC_ERP_TOKEN_KEY]).trim()),
	        counts,
	        totalCount: diagnostics.totalCount,
	        sectionStatus: diagnostics.sectionStatus,
	        missingSections: diagnostics.missingSections,
	        warnings: diagnostics.warnings,
	        lastPush: history.length ? history[history.length - 1] : null,
	      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:erp-package-push') {
    chrome.storage.local.get([OZON_CALC_PRODUCT_POOL_KEY, OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_VISIBLE_SNAPSHOTS_KEY, OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, OZON_CALC_ERP_PUSH_HISTORY_KEY]).then((result) => {
      const endpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY]);
      if (!endpoint) throw new Error('请先在插件弹窗配置 ERP 导入地址');
      const built = buildCurrentErpPackageContent(result);
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY]).trim();
      const headers = {
        'content-type': 'application/json;charset=utf-8',
      };
      if (token) headers.authorization = 'Bearer ' + token;
      return fetch(endpoint, {
        method: 'POST',
        headers,
        body: built.content,
      }).then((response) => {
        return response.text().then((text) => {
          if (!response.ok) {
            const errorMessage = 'ERP 返回 HTTP ' + response.status + ': ' + text.slice(0, 300);
            return appendErpPushHistory(result, {
              pushedAt: new Date().toISOString(),
              ok: false,
              endpoint,
              hasToken: Boolean(token),
              status: response.status,
              counts: built.parsed.counts || {},
              error: errorMessage,
              responseText: text,
            }).then((historyItem) => {
              sendResponse({ ok: false, error: errorMessage, historyItem });
            });
          }
          return appendErpPushHistory(result, {
            pushedAt: new Date().toISOString(),
            ok: true,
            endpoint,
            hasToken: Boolean(token),
            status: response.status,
            counts: built.parsed.counts || {},
            responseText: text,
          }).then((historyItem) => {
            sendResponse({
              ok: true,
              endpoint,
              status: response.status,
              responseText: text.slice(0, 1000),
              count: built.parsed.counts || {},
              historyItem,
            });
          });
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:status') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_CONFIG_SNAPSHOT_KEY, OZON_CALC_CONFIG_UPDATED_AT_KEY, OZON_OFFICIAL_SNAPSHOT_KEY, OZON_COMMISSION_SNAPSHOT_KEY, OZON_FX_SNAPSHOT_KEY, OZON_LOGISTICS_CALCULATOR_STATE_KEY]).then((result) => {
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const logisticsState = isLogisticsDistributionFeatureEnabled()
        ? result[OZON_LOGISTICS_CALCULATOR_STATE_KEY] || null
        : null;
      const snapshot = logisticsState ? logisticsState.snapshot || null : result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || null;
      const officialSnapshot = logisticsState ? logisticsState.officialSnapshot || null : result[OZON_OFFICIAL_SNAPSHOT_KEY] || null;
      const commissionSnapshot = result[OZON_COMMISSION_SNAPSHOT_KEY] || null;
      const fxSnapshot = result[OZON_FX_SNAPSHOT_KEY] || null;
      sendResponse({
        ok: true,
        counts: buildCaptureCounts(entries),
        latestCapturedAt: latestCapturedAt(entries),
        configUpdatedAt: toText(logisticsState && logisticsState.updatedAt || result[OZON_CALC_CONFIG_UPDATED_AT_KEY]),
        selectedServiceCount: snapshot && snapshot.userConfig && Array.isArray(snapshot.userConfig.selectedServiceIds)
          ? snapshot.userConfig.selectedServiceIds.length
          : 0,
        officialSampleCount: officialSnapshot && Array.isArray(officialSnapshot.samples)
          ? officialSnapshot.samples.length
          : officialSnapshot && Array.isArray(officialSnapshot.tariffs) ? officialSnapshot.tariffs.length : 0,
        officialUpdatedAt: toText(logisticsState && logisticsState.updatedAt || officialSnapshot && officialSnapshot.metadata && officialSnapshot.metadata.syncedAt),
        commissionRuleCount: commissionSnapshot && Array.isArray(commissionSnapshot.rules) ? commissionSnapshot.rules.length : 0,
        commissionUpdatedAt: commissionSnapshot ? toText(commissionSnapshot.fetchedAt) : '',
        fxCurrencyCount: fxSnapshot && fxSnapshot.cnyPerCurrency ? Object.keys(fxSnapshot.cnyPerCurrency).length : 0,
        fxUpdatedAt: fxSnapshot ? toText(fxSnapshot.fetchedAt) : '',
        commissionSnapshot,
        fxSnapshot,
        logisticsState,
        snapshot,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:build-config-from-captured-seller') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_CONFIG_SNAPSHOT_KEY, OZON_LOGISTICS_CALCULATOR_STATE_KEY]).then(async (result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('后台物流数据存储未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const sellerHar = store.buildHarPayload(entries, 'seller');
      const snapshot = buildConfigSnapshotFromSellerHar(
        sellerHar,
        message.selectedServiceIds,
        isLogisticsDistributionFeatureEnabled() && result[OZON_LOGISTICS_CALCULATOR_STATE_KEY] && result[OZON_LOGISTICS_CALCULATOR_STATE_KEY].snapshot
          || result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || null
      );
      const persisted = await persistManualCalculatorData({ snapshot, source: 'extension-settings' });
      if (persisted.state === 'scope_required') {
        sendResponse({
          ok: false,
          errorCode: 'scope_required',
          error: '请先绑定物流规则范围后再同步 Seller 数据',
        });
        return;
      }
      sendResponse({
        ok: true,
        snapshot: persisted.snapshot || snapshot,
        mode: persisted.mode,
        state: persisted.state,
        serviceCount: snapshot.catalogSnapshot.services.length,
        selectedServiceCount: snapshot.userConfig.selectedServiceIds.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:sync-captured-seller-official') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_CONFIG_SNAPSHOT_KEY, OZON_LOGISTICS_CALCULATOR_STATE_KEY]).then(async (result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('后台物流数据存储未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const sellerHar = store.buildHarPayload(entries, 'seller');
      const officialHar = store.buildHarPayload(entries, 'official');
      const snapshot = buildConfigSnapshotFromSellerHar(
        sellerHar,
        message.selectedServiceIds,
        isLogisticsDistributionFeatureEnabled() && result[OZON_LOGISTICS_CALCULATOR_STATE_KEY] && result[OZON_LOGISTICS_CALCULATOR_STATE_KEY].snapshot
          || result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || null
      );
      let officialSnapshot = null;
      let officialError = '';
      try {
        officialSnapshot = buildOfficialSnapshotFromHar(officialHar);
      } catch (error) {
        officialError = error && error.message ? error.message : String(error);
      }
      const persisted = await persistManualCalculatorData({
        snapshot,
        officialSnapshot,
        source: 'extension-settings',
      });
      if (persisted.state === 'scope_required') {
        sendResponse({
          ok: false,
          errorCode: 'scope_required',
          error: '请先绑定物流规则范围后再同步 Seller 与 Official 数据',
        });
        return;
      }
      sendResponse({
        ok: true,
        snapshot: persisted.snapshot || snapshot,
        officialSnapshot: persisted.officialSnapshot || officialSnapshot,
        officialError,
        mode: persisted.mode,
        state: persisted.state,
        sellerEntryCount: sellerHar.log.entries.length,
        officialEntryCount: officialHar.log.entries.length,
        serviceCount: snapshot.catalogSnapshot.services.length,
        selectedServiceCount: snapshot.userConfig.selectedServiceIds.length,
        officialSampleCount: officialSnapshot && Array.isArray(officialSnapshot.tariffs) ? officialSnapshot.tariffs.length : 0,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:sync-captured-official') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then(async (result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('后台物流数据存储未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const officialHar = store.buildHarPayload(entries, 'official');
      const officialSnapshot = buildOfficialSnapshotFromHar(officialHar);
      const persisted = await persistManualCalculatorData({ officialSnapshot });
      if (persisted.state === 'scope_required') {
        sendResponse({
          ok: false,
          errorCode: 'scope_required',
          error: '请先绑定物流规则范围后再同步 Official 数据',
        });
        return;
      }
      sendResponse({
        ok: true,
        officialSnapshot: persisted.officialSnapshot || officialSnapshot,
        mode: persisted.mode,
        state: persisted.state,
        officialEntryCount: officialHar.log.entries.length,
        officialSampleCount: officialSnapshot.tariffs.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:sync-commission-rates') {
    syncCommissionSnapshot().then((snapshot) => {
      sendResponse({
        ok: true,
        snapshot,
        ruleCount: snapshot.rules.length,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:sync-fx-rates') {
    chrome.storage.local.get([OZON_CALC_CONFIG_SNAPSHOT_KEY]).then((result) => {
      const snapshot = result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || {};
      const manualRubRate = snapshot && snapshot.formState ? Number(snapshot.formState.fxRate) || 0.08 : 0.08;
      return syncFxSnapshot(manualRubRate);
    }).then((snapshot) => {
      sendResponse({
        ok: true,
        snapshot,
        currencyCount: snapshot.cnyPerCurrency ? Object.keys(snapshot.cnyPerCurrency).length : 0,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:update-fee-settings') {
    (async () => {
      const result = await chrome.storage.local.get([
        OZON_CALC_CONFIG_SNAPSHOT_KEY,
        OZON_LOGISTICS_CALCULATOR_STATE_KEY,
      ]);
      const schema = globalThis.OZON_CALC_SYNC_SCHEMA;
      if (!schema || typeof schema.mergeSnapshotFormState !== 'function') {
        throw new Error('同步配置结构未加载');
      }
      const calculatorState = isLogisticsDistributionFeatureEnabled()
        ? result[OZON_LOGISTICS_CALCULATOR_STATE_KEY]
        : null;
      const snapshot = schema.mergeSnapshotFormState(
        calculatorState && calculatorState.snapshot || result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || {},
        message.formState || {}
      );
      if (calculatorState && calculatorState.scope) {
        const updated = await getLogisticsDistributionRuntime().updatePreferences({ snapshot });
        sendResponse({ ok: true, snapshot: updated.snapshot, mode: 'scoped_preferences' });
        return;
      }
      await chrome.storage.local.set({
        [OZON_CALC_CONFIG_SNAPSHOT_KEY]: snapshot,
        [OZON_CALC_CONFIG_UPDATED_AT_KEY]: new Date().toISOString(),
      });
      sendResponse({ ok: true, snapshot, mode: 'local_unscoped' });
    })().catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:clear-captured-har') {
    chrome.storage.local.set({ [OZON_CALC_CAPTURE_ENTRIES_KEY]: [] }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  // ─── OZON CDN Cookie + Company ID 同步到指定店铺 ───
  if (message.type === 'ozon-calc:sync-ozon-cookie') {
    const shopId = message.payload && message.payload.shopId;
    if (!shopId) {
      sendResponse({ ok: false, error: '缺少 shopId，请先选择目标店铺' });
      return false;
    }
    syncOzonCookieToShopForSync(shopId, {
      companyId: message.payload && message.payload.companyId,
    }).then((result) => {
      sendResponse({ ok: true, msg: 'Cookie 已同步到该店铺', data: result.data });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:sync-current-ozon-cookie') {
    syncCurrentOzonCookieForSync(message.payload || {}).then((result) => {
      sendResponse({
        ok: true,
        msg: 'Cookie 已同步到当前 Ozon 店铺',
        data: {
          ...(result.data && typeof result.data === 'object' ? result.data : {}),
          shopId: result.shopId,
          companyId: result.companyId,
          syncedAt: result.syncedAt,
        },
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:auto-sync-maintenance') {
    runOzonAutoSyncMaintenance(message.payload || {}).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:auto-sync-status') {
    readOzonAutoSyncStatus().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  // ─── 仅同步 Company ID 到指定店铺 ───
  if (message.type === 'ozon-calc:sync-ozon-company-id') {
    const shopId = message.payload && message.payload.shopId;
    const companyId = normalizeOzonCompanyIdForSync(message.payload && message.payload.companyId);
    if (!shopId || !companyId) {
      sendResponse({ ok: false, error: '缺少 shopId 或 companyId' });
      return false;
    }
    rememberRuntimeOzonCompanyIdForSync(companyId);
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY]).then((result) => {
      const baseEndpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY]);
      if (!baseEndpoint) throw new Error('请先在插件设置中配置 ERP 地址');
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY]).trim();
      if (!token) throw new Error('请先在插件设置中配置 ERP Token');
      const apiBase = baseEndpoint.replace(/\/api\/.*$/, '');
      return fetch(apiBase + '/api/shops/' + encodeURIComponent(shopId) + '/ozon-cdn-auth', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
        body: JSON.stringify({ companyId: String(companyId) }),
      }).then((res) => res.json());
    }).then((data) => {
      if (data && data.code === 1) {
        sendResponse({ ok: true, msg: 'Company ID 已同步', data: data.data });
      } else {
        throw new Error((data && data.msg) || '同步失败');
      }
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  return false;
});
