try { importScripts('../shared/logistics-rules/distribution-feature.js'); } catch (e) { console.warn('[SS ERP] logistics feature gate load error:', e); }
try { importScripts('../shared/contracts/ai-image-workbench-v1.js'); } catch (e) { console.warn('[SS ERP] AI image workbench contract load error:', e); }
try { importScripts('../shared/erp-adapter/erp-source-image-launch.js'); } catch (e) { console.warn('[SS ERP] ERP source image launcher load error:', e); }
try { importScripts('../shared/message-security/runtime-message-policy.js'); } catch (e) { console.warn('[SS ERP] runtime message policy load error:', e); }
try { importScripts('../shared/message-security/runtime-message-authorization.js'); } catch (e) { console.warn('[SS ERP] runtime message authorization load error:', e); }
try { importScripts('../shared/byok/profile-schema.js'); } catch (e) { console.warn('[SS ERP] BYOK profile schema load error:', e); }
try { importScripts('../shared/byok/profile-store.js'); } catch (e) { console.warn('[SS ERP] BYOK profile store load error:', e); }
try { importScripts('../shared/byok/device-session-lifecycle.js'); } catch (e) { console.warn('[SS ERP] BYOK device lifecycle load error:', e); }
try { importScripts('../shared/byok/runtime-authority.js'); } catch (e) { console.warn('[SS ERP] BYOK runtime authority load error:', e); }
try { importScripts('../shared/byok/permission-broker.js'); } catch (e) { console.warn('[SS ERP] BYOK permission broker load error:', e); }
try { importScripts('../shared/byok/readiness-handle-cache.js'); } catch (e) { console.warn('[SS ERP] BYOK readiness cache load error:', e); }
try { importScripts('../shared/byok/readiness-client.js'); } catch (e) { console.warn('[SS ERP] BYOK readiness client load error:', e); }
try { importScripts('../shared/byok/execution-intent-client.js'); } catch (e) { console.warn('[SS ERP] BYOK execution intent client load error:', e); }
try { importScripts('../shared/byok/execution-batch-client.js'); } catch (e) { console.warn('[SS ERP] BYOK execution batch client load error:', e); }
try { importScripts('../shared/byok/execution-intent-claim-broker.js'); } catch (e) { console.warn('[SS ERP] BYOK execution intent broker load error:', e); }
try { importScripts('../shared/byok/text-to-image-client.js'); } catch (e) { console.warn('[SS ERP] BYOK text-to-image client load error:', e); }
try { importScripts('../shared/byok/image-input-inspector.js'); } catch (e) { console.warn('[SS ERP] BYOK image input inspector load error:', e); }
try { importScripts('../shared/byok/image-mask-transform.js'); } catch (e) { console.warn('[SS ERP] BYOK image mask transform load error:', e); }
try { importScripts('../shared/byok/image-edit-adapters.js'); } catch (e) { console.warn('[SS ERP] BYOK image edit adapters load error:', e); }
try { importScripts('../shared/byok/image-edit-probe-media.js'); } catch (e) { console.warn('[SS ERP] BYOK image edit probe media load error:', e); }
try { importScripts('../shared/byok/image-edit-client.js'); } catch (e) { console.warn('[SS ERP] BYOK image edit client load error:', e); }
try { importScripts('../shared/byok/media-job-engine.js'); } catch (e) { console.warn('[SS ERP] BYOK media job engine load error:', e); }
try { importScripts('../shared/byok/workbench-batch-provider-executor.js'); } catch (e) { console.warn('[SS ERP] BYOK batch Provider executor load error:', e); }
try { importScripts('../shared/byok/workbench-batch-coordinator.js'); } catch (e) { console.warn('[SS ERP] BYOK batch coordinator load error:', e); }
try { importScripts('../shared/byok/workbench-provider-semaphore.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench Provider semaphore load error:', e); }
try { importScripts('../shared/byok/workbench-media-channel.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench media channel load error:', e); }
try { importScripts('../shared/byok/workbench-edit-media-store.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench edit media store load error:', e); }
try { importScripts('../shared/byok/workbench-edit-epoch-guard.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench edit epoch guard load error:', e); }
try { importScripts('../shared/byok/workbench-edit-controller.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench edit controller load error:', e); }
try { importScripts('../shared/byok/provider-settings-handler.js'); } catch (e) { console.warn('[SS ERP] BYOK Provider settings handler load error:', e); }
try { importScripts('../shared/byok/generated-result-vault-persistence.js'); } catch (e) { console.warn('[SS ERP] BYOK result escrow load error:', e); }
try { importScripts('../shared/byok/generated-result-vault.js'); } catch (e) { console.warn('[SS ERP] BYOK result vault load error:', e); }
try { importScripts('../shared/byok/generated-asset-ingest-client.js'); } catch (e) { console.warn('[SS ERP] BYOK ingest client load error:', e); }
try { importScripts('../shared/byok/generated-asset-batch-ingest-client.js'); } catch (e) { console.warn('[SS ERP] BYOK batch ingest client load error:', e); }
try { importScripts('../shared/byok/listing-publish-coordinator.js'); } catch (e) { console.warn('[SS ERP] BYOK publish coordinator load error:', e); }
try { importScripts('../shared/publish/workbench-listing-publish-coordinator.js'); } catch (e) { console.warn('[SS ERP] workbench publish coordinator load error:', e); }
try { importScripts('../shared/byok/workbench-launch-client.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench launch client load error:', e); }
try { importScripts('../shared/byok/workbench-batch-launch-client.js'); } catch (e) { console.warn('[SS ERP] BYOK batch launch client load error:', e); }
try { importScripts('../shared/byok/workbench-launch-session.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench session load error:', e); }
try { importScripts('../shared/byok/workbench-preview-channel.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench preview channel load error:', e); }
try { importScripts('../shared/byok/workbench-source-media-library.js'); } catch (e) { console.warn('[SS ERP] BYOK source media library load error:', e); }
try { importScripts('../shared/byok/workbench-runtime-handler.js'); } catch (e) { console.warn('[SS ERP] BYOK workbench runtime handler load error:', e); }
try { importScripts('../shared/byok/workbench-batch-registry.js'); } catch (e) { console.warn('[SS ERP] BYOK batch registry load error:', e); }
try { importScripts('../shared/byok/workbench-batch-runtime-handler.js'); } catch (e) { console.warn('[SS ERP] BYOK batch runtime handler load error:', e); }
try { importScripts('../shared/erp-adapter/deployment-defaults.js'); } catch (e) { console.warn('[SS ERP] deployment defaults load error:', e); }
try { importScripts('../shared/erp-adapter/device-connection-state.js'); } catch (e) { console.warn('[SS ERP] device connection state load error:', e); }
try { importScripts('../shared/erp-adapter/device-claim-queue.js'); } catch (e) { console.warn('[SS ERP] device claim queue load error:', e); }
try { importScripts('../shared/currency/price-currency.js'); } catch (e) { console.warn('[SS ERP] price-currency load error:', e); }
try { importScripts('../shared/contracts/source-product-capture-v2.js'); } catch (e) { console.warn('[SS ERP] source capture V2 contract load error:', e); }
try { importScripts('../shared/source-costing/ai-workbench-launch-context.js'); } catch (e) { console.warn('[SS ERP] source AI workbench launch context load error:', e); }
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
const SS_ERP_SOURCE_WORKBENCH_MEDIA_HISTORY_MESSAGE =
  'ss-erp:source-listing-workbench-media-history';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_COMMAND_MESSAGE =
  'ss-erp:source-listing-workbench-media-command';
const SS_ERP_SOURCE_WORKBENCH_AI_IMAGE_SUITE_MESSAGE =
  'ss-erp:source-listing-workbench-ai-image-suite';
const SS_ERP_SOURCE_WORKBENCH_AI_IMAGE_SUITE_COMMAND_MESSAGE =
  'ss-erp:source-listing-workbench-ai-image-suite-command';
const SS_ERP_SOURCE_AI_WORKBENCH_OPEN_MESSAGE = 'ss-erp:source-ai-workbench-open';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_PREPARE_MESSAGE =
  'ss-erp:source-listing-workbench-media-confirm-prepare';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_READ_MESSAGE =
  'ss-erp:source-listing-workbench-media-confirm-read';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_SUBMIT_MESSAGE =
  'ss-erp:source-listing-workbench-media-confirm-submit';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_CANCEL_MESSAGE =
  'ss-erp:source-listing-workbench-media-confirm-cancel';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_OPEN_MESSAGE =
  'ss-erp:source-listing-workbench-media-editor-open';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_READ_MESSAGE =
  'ss-erp:source-listing-workbench-media-editor-read';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_SUBMIT_MESSAGE =
  'ss-erp:source-listing-workbench-media-editor-submit';
const SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_CANCEL_MESSAGE =
  'ss-erp:source-listing-workbench-media-editor-cancel';
const SS_ERP_SOURCE_MEDIA_MUTATION_HISTORY_PAGE_LIMIT = 10;
const SS_ERP_SOURCE_MEDIA_MUTATION_HISTORY_MAX_PAGES = 5;
const SS_ERP_SOURCE_MEDIA_CONFIRMATIONS_KEY =
  'ss-erp:source-workbench:media-confirmations:v1';
const SS_ERP_SOURCE_MEDIA_CONFIRMATION_LIMIT = 20;
const SS_ERP_SOURCE_MEDIA_CONFIRMATION_TTL_MS = 2 * 60 * 1000;
const SS_ERP_SOURCE_MEDIA_EDITOR_SESSIONS_KEY =
  'ss-erp:source-workbench:media-editor-sessions:v1';
const SS_ERP_SOURCE_MEDIA_EDITOR_SESSION_LIMIT = 10;
const SS_ERP_SOURCE_MEDIA_EDITOR_SESSION_TTL_MS = 30 * 60 * 1000;
const SS_ERP_SOURCE_MEDIA_EDITOR_SUBMIT_LEASE_MS = 5 * 60 * 1000;
const SS_ERP_SOURCE_MEDIA_EDITOR_SUBMIT_MINIMUM_REMAINING_MS = 4 * 60 * 1000;
const SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY =
  'ss-erp:source-workbench:translation-intents:v1';
const SS_ERP_SOURCE_TRANSLATION_INTENT_LIMIT = 20;
// Translation jobs are asynchronous and may sit behind a queue for longer
// than the device access token. Keep the durable intent long enough to retry
// a lost response without creating a second billable workflow.
const SS_ERP_SOURCE_TRANSLATION_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const SS_ERP_SOURCE_MEDIA_MUTATION_INTENTS_KEY =
  'ss-erp:source-workbench:media-mutation-intents:v1';
const SS_ERP_SOURCE_MEDIA_MUTATION_INTENT_LIMIT = 20;
const SS_ERP_SOURCE_MEDIA_MUTATION_INTENT_TTL_MS = 24 * 60 * 60 * 1000;
const SS_ERP_IMAGE_SEARCH_JOBS_KEY = 'ss-erp:image-search-jobs';
const SS_ERP_SOURCE_SEARCH_PLATFORM_PREFS_KEY = 'ss-erp:source-search-platforms';
const SS_ERP_DEFAULT_SOURCE_SEARCH_PLATFORMS = ['1688', 'pdd', 'taobao'];
let imageSearchJobsQueue = Promise.resolve();
let ozonCookieOnlySyncInFlight = null;
let ozonSellerCookieLifecycleTimer = null;
let ozonSellerCookieLifecyclePending = false;
let ozonSellerCookieRemovalPending = false;
let ozonAutoSyncMaintenanceQueue = Promise.resolve();
let ozonCompanyMaintenanceTimer = null;
let ozonPendingMaintenanceCompanyId = '';
const ozonCdnWriteQueues = new Map();
const ozonCdnWriteEpochs = new Map();
const ozonCdnMemoryGuards = new Map();
let ozonCdnGuardStorageQueue = Promise.resolve();
const OZON_CALC_VISIBLE_SNAPSHOTS_KEY = 'ozon-calc:visible-snapshots';
const OZON_CALC_ERP_ENDPOINT_KEY = 'ozon-calc:erp-endpoint';
const OZON_CALC_ERP_TOKEN_KEY = 'ozon-calc:erp-token';
const SS_ERP_EXTENSION_DEVICE_ID_KEY = 'ss-erp:logistics-device-id';
// Durable fence: paired devices must fail closed after revoke/clear instead of
// silently falling back to a legacy account token.
const SS_ERP_EXTENSION_DEVICE_AUTHORITY_KEY = 'ss-erp:extension-device-authority:v1';
const OZON_CALC_ERP_PUSH_HISTORY_KEY = 'ozon-calc:erp-push-history';
const OZON_SYNC_LEGACY_COMPANY_ID_STORAGE_KEY = 'ss_erp_ozon_company_id';
const OZON_SYNC_LEGACY_COMPANY_ID_CAPTURED_AT_KEY = 'ss_erp_ozon_company_id_captured_at';
const OZON_SYNC_SESSION_COMPANY_ID_KEY = 'ss_erp_ozon_company_id_session';
const OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY = 'ss_erp_ozon_company_id_session_captured_at';
const OZON_SYNC_RECENT_COMPANY_ID_MS = 10 * 60 * 1000;
const SS_ERP_SYNC_TIMES_KEY = 'ss_erp_sync_times';
const SS_ERP_OZON_AUTO_SYNC_STATE_KEY = 'ss_erp_ozon_auto_sync_state';
const SS_ERP_OZON_CDN_WRITE_GUARDS_KEY = 'ss-erp:ozon-cdn-write-guards:v1';
const SS_ERP_OZON_CDN_WRITE_GUARD_MAX = 50;
const SS_ERP_OZON_AUTO_SYNC_ALARM_NAME = 'ss-erp:ozon-auto-sync';
const SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES = 30;
const SS_ERP_OZON_AUTO_SYNC_INTERVAL_MS = SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES * 60 * 1000;
const SS_ERP_OZON_INSIGHT_COOKIE_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const SS_ERP_OZON_COOKIE_LIFECYCLE_DEBOUNCE_MS = 750;
const SS_ERP_OZON_AUTH_COOKIE_NAME_PATTERN =
  /token|(?:^|[_-])(?:access|refresh|auth|authorization|session|jwt)(?:[_-]|$)/i;
const SS_ERP_DEVICE_JSON_RESPONSE_MAX_BYTES = 256 * 1024;
const SS_ERP_DEVICE_COOKIE_REQUEST_MAX_BYTES = 66 * 1024;
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
try { importScripts('../shared/erp-adapter/shop-analytics-device-writer.js'); } catch (error) {
  console.warn('[SS ERP] shop analytics device writer failed to load', error);
}
try { importScripts('../shared/erp-adapter/listing-workflow-client.js'); } catch (error) {
  console.warn('[SS ERP] listing workflow client module failed to load', error);
}
try { importScripts('../shared/hosted/ai-image-suite-workbench-adapter.js'); } catch (error) {
  console.warn('[SS ERP] hosted AI image suite workbench adapter failed to load', error);
}
try { importScripts('../shared/hosted/ai-image-suite-candidate-preview-bridge.js'); } catch (error) {
  console.warn('[SS ERP] hosted AI image suite preview bridge failed to load', error);
}
try { importScripts('../shared/hosted/ai-image-suite-workbench-client.js'); } catch (error) {
  console.warn('[SS ERP] hosted AI image suite workbench client failed to load', error);
}
try { importScripts('../shared/hosted/ai-image-suite-workbench-client-registry.js'); } catch (error) {
  console.warn('[SS ERP] hosted AI image suite client registry failed to load', error);
}
try { importScripts('../shared/hosted/ai-image-suite-workbench-runtime-dispatcher.js'); } catch (error) {
  console.warn('[SS ERP] hosted AI image suite runtime dispatcher failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-media-mutation-intent.js'); } catch (error) {
  console.warn('[SS ERP] source media mutation intent module failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-media-confirmation.js'); } catch (error) {
  console.warn('[SS ERP] source media confirmation module failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-media-confirmation-coordinator.js'); } catch (error) {
  console.warn('[SS ERP] source media confirmation coordinator failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-media-editor-session.js'); } catch (error) {
  console.warn('[SS ERP] source media editor session module failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-media-editor-coordinator.js'); } catch (error) {
  console.warn('[SS ERP] source media editor coordinator failed to load', error);
}
try { importScripts('../shared/erp-adapter/source-media-editor-lifecycle.js'); } catch (error) {
  console.warn('[SS ERP] source media editor lifecycle failed to load', error);
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
let extensionDeviceClaimQueue = null;
let logisticsManualFallbackPersistence = null;
let logisticsCaptureRuntime = null;
let logisticsCaptureMessageHandler = null;
let logisticsBindingProbeRuntime = null;
let logisticsBindingProbeMessageHandler = null;
let sourceCaptureSubmitter = null;
let sourceListingWorkflowClient = null;
let shopAnalyticsDeviceWriter = null;
let byokProfileStore = null;
let byokReadinessHandleCache = null;
let byokReadinessClient = null;
let byokExecutionIntentClient = null;
let byokExecutionBatchClient = null;
let byokExecutionIntentClaimBroker = null;
let byokDeviceTransport = null;
let byokPermissionBroker = null;
let byokTextToImageClient = null;
let byokImageEditClient = null;
let byokCapabilityClient = null;
let byokProviderSettingsDispatcher = null;
let byokGeneratedResultEscrow = null;
let byokGeneratedResultVault = null;
let byokGeneratedResultAuthorityResetQueue = Promise.resolve();
let byokDeviceSessionCleanupDepth = 0;
let byokGeneratedAssetIngestClient = null;
let byokGeneratedAssetBatchIngestClient = null;
let byokListingPublishCoordinator = null;
let workbenchListingPublishCoordinator = null;
let byokRuntimeAuthorityGuard = null;
let byokWorkbenchLaunchClient = null;
let byokWorkbenchBatchLaunchClient = null;
let byokWorkbenchSessionManager = null;
let byokWorkbenchPreviewBroker = null;
let byokWorkbenchSourceMediaLibrary = null;
let byokWorkbenchRuntimeDispatcher = null;
let byokWorkbenchBatchRegistry = null;
let byokWorkbenchBatchRuntimeDispatcher = null;
let byokWorkbenchMediaBroker = null;
let byokWorkbenchEditMediaStore = null;
let byokWorkbenchEditEpochGuard = null;
let byokWorkbenchEditController = null;
let byokWorkbenchProviderSemaphore = null;
let hostedAiImageSuitePreviewBridge = null;
let hostedAiImageSuiteClientRegistry = null;
let hostedAiImageSuiteRuntimeDispatcher = null;
let sourceTranslationIntentWriteQueue = Promise.resolve();
let sourceMediaMutationIntentStore = null;
let sourceMediaConfirmationCoordinator = null;
let sourceMediaEditorCoordinator = null;
const SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME = 'ss-erp-logistics-rule-sync-v1';
const SS_ERP_LOGISTICS_RULE_SYNC_INTERVAL_MINUTES = 30;
const SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME = 'ss-erp-logistics-capture-v1';
const SS_ERP_LOGISTICS_CAPTURE_INTERVAL_MINUTES = 1;
const SS_ERP_BYOK_BATCH_LIFECYCLE_PORT_NAME =
  'ss-erp:ai-image-workbench-batch-lifecycle';
const SS_ERP_BYOK_BATCH_LIFECYCLE_PING =
  'ss-erp:ai-image-workbench-batch-lifecycle-ping/v1';
const SS_ERP_BYOK_BATCH_LIFECYCLE_ACK =
  'ss-erp:ai-image-workbench-batch-lifecycle-ack/v1';

async function clearCachedByokGeneratedResults() {
  if (byokWorkbenchEditController) byokWorkbenchEditController.clear();
  if (byokWorkbenchEditMediaStore) byokWorkbenchEditMediaStore.clear();
  if (byokWorkbenchEditEpochGuard) byokWorkbenchEditEpochGuard.rotate();
  if (byokWorkbenchProviderSemaphore) byokWorkbenchProviderSemaphore.invalidateAll();
  if (byokGeneratedResultVault) byokGeneratedResultVault.clear();
  if (byokWorkbenchPreviewBroker) byokWorkbenchPreviewBroker.clear();

  const reset = async () => {
    const finalize = async () => {
      let failure = null;
      try {
        const escrow = getByokGeneratedResultEscrow();
        if (byokDeviceSessionCleanupDepth > 0) await escrow.clearAndDeleteKey();
        else await escrow.clearAndRotateKey();
      } catch (error) {
        failure = error;
      }
      try {
        if (byokGeneratedResultVault) byokGeneratedResultVault.clear();
      } catch (error) {
        if (!failure) failure = error;
      }
      try {
        if (byokWorkbenchPreviewBroker) byokWorkbenchPreviewBroker.clear();
      } catch (error) {
        if (!failure) failure = error;
      }
      if (byokWorkbenchSessionManager) {
        try {
          await byokWorkbenchSessionManager.clearProviderState();
        } catch (error) {
          if (!failure) failure = error;
        }
      }
      if (failure) throw failure;
    };
    if (byokWorkbenchBatchRegistry) {
      return byokWorkbenchBatchRegistry.clearAll(
        'provider_state_changed',
        finalize,
      );
    }
    return finalize();
  };
  const pending = byokGeneratedResultAuthorityResetQueue.then(reset, reset);
  byokGeneratedResultAuthorityResetQueue = pending.catch(function () {});
  return pending;
}

function clearHostedAiImageSuiteRuntime(reason) {
  if (hostedAiImageSuiteClientRegistry) {
    hostedAiImageSuiteClientRegistry.clearAll(
      String(reason || 'device_session_changed').slice(0, 100),
    );
  }
  if (hostedAiImageSuitePreviewBridge) hostedAiImageSuitePreviewBridge.clear();
}

function isLogisticsDistributionFeatureEnabled() {
  const feature = globalThis.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE;
  return Boolean(feature && feature.enabled === true);
}

function disableLogisticsDistributionAlarms() {
  if (!chrome.alarms || typeof chrome.alarms.clear !== 'function') return;
  chrome.alarms.clear(SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME);
  chrome.alarms.clear(SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME);
}

function notifyByokDeviceSessionInvalidated(reason) {
  const lifecycle = globalThis.SS_ERP_BYOK_DEVICE_SESSION_LIFECYCLE;
  if (!lifecycle || !lifecycle.INVALIDATED_MESSAGE
    || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') return;
  try {
    chrome.runtime.sendMessage({
      type: lifecycle.INVALIDATED_MESSAGE,
      reason: String(reason || 'device_session_changed'),
    }, () => {
      // Reading lastError prevents an expected no-listener case from being logged.
      void chrome.runtime.lastError;
    });
  } catch (_error) {
    // No extension page is required to be open during a device-session change.
  }
}

async function clearByokDeviceSessionState(input) {
  byokDeviceSessionCleanupDepth += 1;
  try {
    const reason = String(input && input.reason || 'device_session_changed').slice(0, 100);
    const cleanups = [
      Promise.resolve().then(function () { clearHostedAiImageSuiteRuntime(reason); }),
      Promise.resolve().then(function () { getByokReadinessHandleCache().clear(); }),
      Promise.resolve().then(function () {
        if (!byokWorkbenchBatchRegistry) return undefined;
        return byokWorkbenchBatchRegistry.clearAll(reason);
      }).catch(function () {}),
      Promise.resolve().then(function () {
        if (byokWorkbenchEditController) byokWorkbenchEditController.clear();
      }),
      Promise.resolve().then(function () {
        if (byokWorkbenchEditMediaStore) byokWorkbenchEditMediaStore.clear();
      }),
      Promise.resolve().then(function () {
        if (byokWorkbenchEditEpochGuard) byokWorkbenchEditEpochGuard.rotate();
      }),
      Promise.resolve().then(function () {
        if (byokWorkbenchProviderSemaphore) byokWorkbenchProviderSemaphore.invalidateAll();
      }),
      Promise.resolve().then(function () { getByokGeneratedResultVault().clear(); }),
      Promise.resolve().then(function () {
        if (byokWorkbenchPreviewBroker) byokWorkbenchPreviewBroker.clear();
      }),
      Promise.resolve().then(function () { return getByokProfileStore().disconnectDevice(); }),
      Promise.resolve().then(function () { return getByokPermissionBroker().clearSessionConsent(); }),
      Promise.resolve().then(function () { return getByokWorkbenchSessionManager().clearProviderState(); }),
      Promise.resolve().then(function () { return getByokListingPublishCoordinator().clear(); }),
      Promise.resolve().then(function () { return getWorkbenchListingPublishCoordinator().clear(); }),
      Promise.resolve().then(function () { return getByokGeneratedResultEscrow().clearAndDeleteKey(); }),
    ];
    notifyByokDeviceSessionInvalidated(input && input.reason);
    const outcomes = await Promise.allSettled(cleanups);
    const failed = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failed) throw failed.reason;
  } finally {
    byokDeviceSessionCleanupDepth = Math.max(0, byokDeviceSessionCleanupDepth - 1);
  }
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
  const defaults = globalThis.SS_ERP_DEPLOYMENT_DEFAULTS || {};
  const expectedBaseUrl = defaults.target === 'cloud' ? packagedErpDeviceBaseUrl() : '';
  if (defaults.target === 'cloud' && !expectedBaseUrl) {
    throw new Error('云端扩展安装包缺少受信任的 ERP API 地址');
  }
  const credentials = api.createManager({
    localStorage: chrome.storage.local,
    sessionStorage: chrome.storage.session,
    lockManager: globalThis.navigator && globalThis.navigator.locks,
    fetchImpl: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    requestTimeoutMs: 6000,
    ...(expectedBaseUrl ? { expectedBaseUrl } : {}),
  });
  const lifecycle = globalThis.SS_ERP_BYOK_DEVICE_SESSION_LIFECYCLE;
  if (!lifecycle || typeof lifecycle.createLifecycle !== 'function') {
    throw new Error('BYOK device lifecycle is unavailable');
  }
  logisticsDeviceCredentials = lifecycle.createLifecycle({
    credentials,
    sessionStorage: chrome.storage.session,
    lockManager: globalThis.navigator && globalThis.navigator.locks,
    clearByokState: clearByokDeviceSessionState,
  });
  return logisticsDeviceCredentials;
}

function trustedErpDeviceBaseUrl(value, sender) {
  let baseUrl;
  let senderUrl;
  try {
    baseUrl = new URL(String(value || '').trim());
    senderUrl = new URL(String(sender && (sender.url || sender.documentUrl) || '').trim());
  } catch (_error) {
    throw new Error('ERP 地址无效');
  }
  const localHosts = new Set(['localhost', '127.0.0.1']);
  const bothLocal = localHosts.has(baseUrl.hostname) && localHosts.has(senderUrl.hostname);
  if (baseUrl.username || baseUrl.password || (baseUrl.protocol !== 'https:' && !bothLocal)) {
    throw new Error('ERP 地址不安全');
  }
  const defaults = globalThis.SS_ERP_DEPLOYMENT_DEFAULTS || {};
  if (bothLocal) {
    if (defaults.target === 'cloud') throw new Error('云端扩展安装包不能连接本机 ERP');
    return baseUrl.origin;
  }
  if (defaults.target === 'cloud') {
    const connectionState = globalThis.SS_ERP_EXTENSION_DEVICE_CONNECTION_STATE;
    if (!connectionState || typeof connectionState.isAllowedCloudDeviceClaim !== 'function') {
      throw new Error('扩展部署领取校验模块不可用');
    }
    if (!connectionState.isAllowedCloudDeviceClaim(
      defaults,
      sender,
      baseUrl.origin,
      chrome.runtime.id,
    )) {
      throw new Error('ERP 地址与扩展安装包不一致');
    }
    return baseUrl.origin;
  }
  if (!bothLocal) {
    if (senderUrl.protocol !== 'https:') throw new Error('ERP 登录页面不安全');
    const deploymentRoot = (hostname) => {
      const normalized = String(hostname || '').toLowerCase();
      if (normalized === 'ss-erp.com' || normalized.endsWith('.ss-erp.com')) return 'ss-erp.com';
      if (normalized === 'ss-erp.cn' || normalized.endsWith('.ss-erp.cn')) return 'ss-erp.cn';
      return '';
    };
    const senderRoot = deploymentRoot(senderUrl.hostname);
    const baseRoot = deploymentRoot(baseUrl.hostname);
    if (defaults.target === 'local') {
      throw new Error('本地扩展安装包只能连接本机 ERP');
    }
    if (!senderRoot || senderRoot !== baseRoot) {
      throw new Error('ERP 地址与当前登录页面不属于同一部署');
    }
  }
  return baseUrl.origin;
}

function packagedErpDeviceBaseUrl() {
  const defaults = globalThis.SS_ERP_DEPLOYMENT_DEFAULTS || {};
  try {
    const parsed = new URL(String(
      defaults.erpApiBaseUrl || defaults.erpBaseUrl || '',
    ).trim());
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.username || parsed.password || (parsed.protocol !== 'https:' && !local)) return '';
    return parsed.origin;
  } catch (_error) {
    return '';
  }
}

function assertTrustedErpDeviceSender(sender) {
  const connectionState = globalThis.SS_ERP_EXTENSION_DEVICE_CONNECTION_STATE;
  const defaults = globalThis.SS_ERP_DEPLOYMENT_DEFAULTS || {};
  if (!connectionState || typeof connectionState.isAllowedDeploymentSender !== 'function') {
    throw new Error('扩展部署来源校验模块不可用');
  }
  if (!connectionState.isAllowedDeploymentSender(defaults, sender, chrome.runtime.id)) {
    throw new Error('当前页面与扩展安装包的 ERP 部署不一致');
  }
}

async function ensureExtensionDeviceId() {
  const stored = await chrome.storage.local.get([SS_ERP_EXTENSION_DEVICE_ID_KEY]);
  let deviceId = toText(stored[SS_ERP_EXTENSION_DEVICE_ID_KEY]).trim();
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ [SS_ERP_EXTENSION_DEVICE_ID_KEY]: deviceId });
  }
  return deviceId;
}

async function readExtensionDeviceAuthority() {
  const stored = await chrome.storage.local.get([SS_ERP_EXTENSION_DEVICE_AUTHORITY_KEY]);
  const authority = stored[SS_ERP_EXTENSION_DEVICE_AUTHORITY_KEY];
  if (!authority || typeof authority !== 'object') return null;
  const state = toText(authority.state).trim();
  if (!['paired', 'revoked', 'cleared', 'owner_mismatch'].includes(state)) return null;
  return {
    state,
    ownerUserId: toText(authority.ownerUserId).trim(),
    sessionId: toText(authority.sessionId).trim(),
    updatedAt: toText(authority.updatedAt).trim(),
  };
}

async function markExtensionDeviceAuthority(state, details = {}) {
  if (!['paired', 'revoked', 'cleared', 'owner_mismatch'].includes(state)) {
    throw new Error('设备授权栅栏状态无效');
  }
  await chrome.storage.local.set({
    [SS_ERP_EXTENSION_DEVICE_AUTHORITY_KEY]: {
      state,
      ownerUserId: toText(details.ownerUserId).trim(),
      sessionId: toText(details.sessionId).trim(),
      updatedAt: new Date().toISOString(),
    },
  });
}

async function clearLegacyCompatibilityCredential() {
  const stored = await chrome.storage.local.get([
    OZON_CALC_ERP_ENDPOINT_KEY,
    'ss_erp_connection',
  ]);
  const legacy = stored.ss_erp_connection && typeof stored.ss_erp_connection === 'object'
    ? stored.ss_erp_connection
    : {};
  const baseUrl = toText(legacy.baseUrl).trim().replace(/\/+$/, '')
    || toText(stored[OZON_CALC_ERP_ENDPOINT_KEY]).trim().replace(/\/api\/.*$/, '').replace(/\/+$/, '');
  await chrome.storage.local.set({
    [OZON_CALC_ERP_ENDPOINT_KEY]: baseUrl ? baseUrl + '/api/collect' : '',
    [OZON_CALC_ERP_TOKEN_KEY]: '',
    ss_erp_connection: { baseUrl, token: '' },
  });
}

async function readExtensionDeviceStatus(verify) {
  const credentials = getLogisticsDeviceCredentials();
  let status = await credentials.getStatus();
  let connection = status && status.state === 'paired'
    ? await credentials.getConnection()
    : null;
  let verificationFailed = false;
  if (verify === true && status && status.state === 'paired') {
    try {
      const operation = await credentials.beginOperation();
      status = operation && operation.state === 'paired'
        ? {
            state: 'paired',
            sessionId: operation.sessionId,
            deploymentId: operation.deploymentId,
            deviceId: operation.deviceId,
            ownerUserId: operation.ownerUserId,
            scopes: operation.scopes,
            expiresAt: operation.expiresAt,
          }
        : { state: 'unpaired' };
    } catch (_error) {
      verificationFailed = true;
      status = await credentials.getStatus();
    }
  }
  if (!connection && status && status.state === 'paired') {
    connection = await credentials.getConnection();
  }
  const endpoint = connection && connection.baseUrl || packagedErpDeviceBaseUrl();
  const connectionState = globalThis.SS_ERP_EXTENSION_DEVICE_CONNECTION_STATE;
  if (!connectionState || typeof connectionState.resolve !== 'function') {
    throw new Error('扩展设备连接状态模块不可用');
  }
  const state = connectionState.resolve({
    verificationFailed,
    storedPaired: Boolean(status && status.state === 'paired'),
    hasEndpoint: Boolean(endpoint),
  });
  return {
    state,
    version: chrome.runtime.getManifest().version,
    endpoint,
    sessionId: status && status.sessionId || '',
    deploymentId: status && status.deploymentId || '',
    deviceId: status && status.deviceId || '',
    ownerUserId: status && status.ownerUserId || '',
    scopes: status && Array.isArray(status.scopes) ? status.scopes.slice() : [],
    expiresAt: status && status.expiresAt || '',
  };
}

async function readBoundedExtensionDeviceJson(response) {
  const declaredHeader = response && response.headers
    && typeof response.headers.get === 'function'
    ? response.headers.get('content-length')
    : null;
  const declaredLength = declaredHeader === null ? NaN : Number(declaredHeader);
  if (Number.isFinite(declaredLength)
    && (declaredLength < 0 || declaredLength > SS_ERP_DEVICE_JSON_RESPONSE_MAX_BYTES)) {
    throw new Error('设备响应过大');
  }
  if (!response || !response.body || typeof response.body.getReader !== 'function') {
    throw new Error('设备响应不支持受限流式读取');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const value = part.value;
      if (!ArrayBuffer.isView(value)
        || !Number.isSafeInteger(value.byteLength)
        || value.byteLength < 0) {
        throw new Error('设备响应流无效');
      }
      byteLength += value.byteLength;
      if (byteLength > SS_ERP_DEVICE_JSON_RESPONSE_MAX_BYTES) {
        try { await reader.cancel(); } catch (_error) {}
        throw new Error('设备响应过大');
      }
      chunks.push(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice());
    }
  } finally {
    try { reader.releaseLock(); } catch (_error) {}
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return text ? JSON.parse(text) : null;
}

async function readExtensionDeviceCollectOperation() {
  const credentials = getLogisticsDeviceCredentials();
  const authority = await readExtensionDeviceAuthority();
  const stored = await credentials.getStatus();
  if (authority && authority.state !== 'paired') {
    return {
      ok: false,
      state: 'blocked',
      errorCode: 'device_repair_required',
      error: '设备授权已撤销，请重新配对后再采集',
      legacyFallbackAllowed: false,
    };
  }
  if (!stored || stored.state !== 'paired') {
    if (authority) {
      return {
        ok: false,
        state: 'blocked',
        errorCode: 'device_repair_required',
        error: '设备授权已撤销，请重新配对后再采集',
        legacyFallbackAllowed: false,
      };
    }
    return {
      ok: false,
      state: 'unpaired',
      errorCode: 'device_unpaired',
      error: '设备未配对',
      legacyFallbackAllowed: authority === null,
    };
  }
  if (!authority) {
    await clearLegacyCompatibilityCredential();
    await markExtensionDeviceAuthority('paired', stored);
  }
  let operation;
  try {
    operation = await credentials.beginOperation();
  } catch (error) {
    return {
      ok: false,
      state: 'unreachable',
      errorCode: 'device_unreachable',
      error: error && error.message ? error.message : '设备授权验证失败',
      legacyFallbackAllowed: false,
    };
  }
  if (!operation || operation.state !== 'paired' || !operation.accessToken) {
    return {
      ok: false,
      state: 'blocked',
      errorCode: 'device_repair_required',
      error: '设备授权已撤销，请重新配对后再采集',
      legacyFallbackAllowed: false,
    };
  }
  if (!Array.isArray(operation.scopes) || !operation.scopes.includes('capture:write')) {
    return {
      ok: false,
      state: 'paired',
      errorCode: 'device_scope_required',
      error: '设备缺少商品采集权限',
      legacyFallbackAllowed: false,
    };
  }
  return { ok: true, state: 'paired', operation, legacyFallbackAllowed: false };
}

async function readExtensionDeviceCollectStatus() {
  const result = await readExtensionDeviceCollectOperation();
  return {
    ok: result.ok === true,
    state: result.state,
    authMode: result.ok === true ? 'device' : undefined,
    errorCode: result.errorCode,
    error: result.error,
    legacyFallbackAllowed: result.legacyFallbackAllowed === true,
    scopes: result.operation && Array.isArray(result.operation.scopes)
      ? result.operation.scopes.slice()
      : [],
  };
}

async function submitExtensionDeviceCollectBatch(payload) {
  const result = await readExtensionDeviceCollectOperation();
  if (!result.ok) return result;
  const operation = result.operation;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);
  let response;
  let body;
  try {
    response = await fetch(operation.baseUrl + '/api/extension-device/collect/batch', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json;charset=utf-8',
        Authorization: 'Bearer ' + operation.accessToken,
      },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 410) {
      await getLogisticsDeviceCredentials().clearIfCurrent(operation, {
        status: response.status,
        reason: 'device_collect_authorization_revoked',
      });
      await clearLegacyCompatibilityCredential();
      await markExtensionDeviceAuthority('revoked', operation);
      return {
        ok: false,
        state: 'blocked',
        errorCode: 'device_authorization_required',
        error: '设备授权已失效，请重新配对',
        status: response.status,
        legacyFallbackAllowed: false,
      };
    }
    body = await readBoundedExtensionDeviceJson(response);
  } catch (error) {
    return {
      ok: false,
      state: 'paired',
      errorCode: 'device_collect_outcome_unknown',
      error: error && error.message ? error.message : '设备采集请求失败',
      outcome: 'UNKNOWN_OUTCOME',
      automaticRetryAllowed: false,
      guardSessionId: operation.sessionId,
      legacyFallbackAllowed: false,
    };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok || !body || typeof body !== 'object') {
    return {
      ok: false,
      state: 'paired',
      errorCode: body && body.errorCode || 'device_collect_failed',
      error: body && (body.msg || body.error) || ('设备采集失败: HTTP ' + response.status),
      status: response.status,
      legacyFallbackAllowed: false,
    };
  }
  if (!await getLogisticsDeviceCredentials().isOperationCurrent(operation)) {
    return {
      ok: false,
      state: 'paired',
      errorCode: 'device_authority_changed',
      error: '设备授权在采集期间已变化，请刷新状态后重试',
      legacyFallbackAllowed: false,
    };
  }
  return { ok: true, state: 'paired', authMode: 'device', body, legacyFallbackAllowed: false };
}

globalThis.SS_ERP_EXTENSION_DEVICE_COLLECT = Object.freeze({
  status: readExtensionDeviceCollectStatus,
  submit: submitExtensionDeviceCollectBatch,
});

function deviceShopIdentifier(value) {
  const normalized = toText(value).trim();
  return normalized && normalized.length <= 200 && !/[\u0000-\u001F\u007F]/.test(normalized)
    ? normalized
    : null;
}

// Read-only shop metadata for extension pages. The legacy settings page used
// `/api/shops` with the old account-equivalent token, which is intentionally
// empty after a scoped device pairing. Keep the device token inside the
// service worker and call the device-scoped endpoint instead.
async function readExtensionDeviceOzonShops() {
  const credentials = getLogisticsDeviceCredentials();
  const stored = await credentials.getStatus();
  if (!stored || stored.state !== 'paired') {
    return { ok: false, errorCode: 'device_unpaired', error: '设备未配对' };
  }

  let operation;
  try {
    operation = await credentials.beginOperation();
  } catch (error) {
    return {
      ok: false,
      errorCode: 'device_unreachable',
      error: error && error.message ? error.message : '设备授权验证失败',
    };
  }
  if (!operation || operation.state !== 'paired' || !operation.accessToken) {
    return { ok: false, errorCode: 'device_unpaired', error: '设备未配对' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response;
  let body;
  try {
    response = await fetch(operation.baseUrl + '/api/extension-device/shops', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + operation.accessToken,
      },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 410) {
      await credentials.clearIfCurrent(operation, {
        status: response.status,
        reason: 'device_shop_authorization_revoked',
      });
      await clearLegacyCompatibilityCredential();
      await markExtensionDeviceAuthority('revoked', operation);
      return {
        ok: false,
        errorCode: 'device_authorization_required',
        error: '设备授权已失效，请重新配对',
        status: response.status,
      };
    }
    body = await readBoundedExtensionDeviceJson(response);
  } catch (error) {
    return {
      ok: false,
      errorCode: 'device_unreachable',
      error: error && error.message ? error.message : '设备店铺读取失败',
    };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok || !body || body.code !== 1 || !Array.isArray(body.data)) {
    return {
      ok: false,
      errorCode: body && body.errorCode || (response.status === 404 ? 'device_shop_route_unavailable' : 'device_shop_read_failed'),
      error: body && (body.msg || body.error) || '设备店铺读取失败',
    };
  }
  if (!await credentials.isOperationCurrent(operation)) {
    return {
      ok: false,
      errorCode: 'device_authority_changed',
      error: '设备授权在请求期间已变化，请刷新状态',
    };
  }
  return {
    ok: true,
    authMode: 'device',
    data: body.data
      .filter((shop) => String(shop && shop.platform || '').toUpperCase() === 'OZON')
      .map((shop) => ({
        id: deviceShopIdentifier(shop && shop.id),
        platform: 'OZON',
        name: deviceShopIdentifier(shop && shop.name),
        status: deviceShopIdentifier(shop && shop.status),
        clientId: deviceShopIdentifier(shop && shop.clientId),
        companyId: deviceShopIdentifier(shop && shop.companyId),
      }))
      .filter((shop) => Boolean(shop.id && shop.name && shop.status)),
  };
}

globalThis.SS_ERP_EXTENSION_DEVICE_SHOPS = readExtensionDeviceOzonShops;

function browserOneClickDeviceTransportResult(result, label, scopeFailure) {
  const body = result && result.body && typeof result.body === 'object'
    ? result.body
    : null;
  const ambiguousHttpOutcome = result && result.state === 'http_error'
    && ([408, 425, 429].includes(Number(result.status)) || Number(result.status) >= 500);
  const failureMetadata = body || ambiguousHttpOutcome
    ? {
        ...((body && body.outcome === 'UNKNOWN_OUTCOME') || ambiguousHttpOutcome
          ? { outcome: 'UNKNOWN_OUTCOME' } : {}),
        ...((body && body.automaticRetryAllowed === false) || ambiguousHttpOutcome
          ? { automaticRetryAllowed: false } : {}),
        ...((body && body.requestDispatched === true) || ambiguousHttpOutcome
          ? { requestDispatched: true } : {}),
      }
    : {};
  if (result && result.state === 'response' && result.body) {
    return result.body.code === 1
      ? { ok: true, ...(result.body.data ? { data: result.body.data } : {}), msg: result.body.msg }
      : {
          ok: false,
          errorCode: result.body.errorCode || 'device_request_failed',
          error: result.body.msg || label + '失败',
          status: Number(result.status) || undefined,
          terminal: result.body.terminal === true,
          ...failureMetadata,
        };
  }
  if (result && result.state === 'scope_required') {
    return {
      ok: false,
      errorCode: scopeFailure && scopeFailure.errorCode || 'device_publish_scope_required',
      error: scopeFailure && scopeFailure.error
        || '当前设备缺少 Ozon 上架授权，请在 ERP 设备管理中授权后重试',
    };
  }
  if (result && (result.state === 'authorization_required' || result.state === 'unpaired')) {
    return {
      ok: false,
      errorCode: 'device_authorization_required',
      error: '设备授权已失效，请重新连接 ERP',
    };
  }
  return {
    ok: false,
    errorCode: result && result.body && result.body.errorCode || 'device_request_failed',
    error: result && result.body && (result.body.msg || result.body.error)
      || label + '失败',
    status: Number(result && result.status) || undefined,
    terminal: Boolean(result && result.body && result.body.terminal === true),
    ...failureMetadata,
  };
}

async function createExtensionDeviceBrowserOneClickJob(payload) {
  const result = await getByokDeviceTransport().post(
    '/api/extension-device/browser-one-click/jobs',
    payload,
    { requiredScopes: ['capture:write', 'listing:publish'] },
  );
  const normalized = browserOneClickDeviceTransportResult(result, '创建上架任务');
  if (!normalized.ok) return normalized;
  return { ok: true, data: normalized.data, msg: normalized.msg };
}

async function patchExtensionDeviceBrowserOneClickJob(jobId, payload) {
  const normalizedJobId = String(jobId || '').normalize('NFKC').trim();
  if (!normalizedJobId || normalizedJobId.length > 200 || /[\\/]/.test(normalizedJobId)) {
    return { ok: false, errorCode: 'invalid_job_id', error: '上架任务 ID 无效' };
  }
  const result = await getByokDeviceTransport().post(
    '/api/extension-device/browser-one-click/jobs/' + encodeURIComponent(normalizedJobId),
    payload,
    { requiredScopes: ['capture:write', 'listing:publish'] },
  );
  return browserOneClickDeviceTransportResult(result, '更新上架任务');
}

async function readExtensionDeviceBrowserOneClickJob(jobId) {
  const normalizedJobId = String(jobId || '').normalize('NFKC').trim();
  if (!normalizedJobId || normalizedJobId.length > 200 || /[\\/]/.test(normalizedJobId)) {
    return { ok: false, errorCode: 'invalid_job_id', error: '上架任务 ID 无效' };
  }
  const result = await getByokDeviceTransport().post(
    '/api/extension-device/browser-one-click/jobs/' + encodeURIComponent(normalizedJobId) + '/read',
    {},
    { requiredScopes: ['capture:write', 'listing:publish'] },
  );
  return browserOneClickDeviceTransportResult(result, '读取上架任务状态');
}

async function readExtensionDeviceWatermarkTemplates(shopId) {
  const normalizedShopId = String(shopId || '').normalize('NFKC').trim();
  const result = await getByokDeviceTransport().post(
    '/api/extension-device/browser-one-click/watermark-templates/read',
    normalizedShopId ? { shopId: normalizedShopId } : {},
    { requiredScope: 'capture:write' },
  );
  const normalized = browserOneClickDeviceTransportResult(result, '获取水印模板');
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    data: Array.isArray(normalized.data) ? normalized.data : [],
    authMode: 'device',
  };
}

async function readExtensionDeviceBrowserOneClickStatus() {
  const status = await readExtensionDeviceStatusAfterClaims(false);
  if (!status || status.state !== 'paired') {
    return {
      ok: false,
      state: status && status.state || 'unpaired',
      authMode: 'device',
      endpoint: status && status.endpoint || '',
      scopes: [],
      canPublish: false,
    };
  }
  const result = await getByokDeviceTransport().post(
    '/api/extension-device/browser-one-click/status/read',
    {},
  );
  const normalized = browserOneClickDeviceTransportResult(result, '读取设备上架授权', {
    errorCode: 'device_publish_scope_required',
    error: '当前设备缺少 Ozon 上架授权，请在 ERP 设备管理中授权后重试',
  });
  if (!normalized.ok) {
    return {
      ...normalized,
      state: result && result.state || 'unreachable',
      authMode: 'device',
      endpoint: status.endpoint || '',
      scopes: [],
      canPublish: false,
    };
  }
  const scopes = Array.isArray(normalized.data && normalized.data.scopes)
    ? normalized.data.scopes.filter((scope) => typeof scope === 'string')
    : [];
  return {
    ok: true,
    state: 'paired',
    authMode: 'device',
    endpoint: status.endpoint || '',
    scopes: scopes.slice(),
    canPublish: scopes.includes('capture:write') && scopes.includes('listing:publish'),
  };
}

globalThis.SS_ERP_EXTENSION_DEVICE_ONE_CLICK = Object.freeze({
  status: readExtensionDeviceBrowserOneClickStatus,
  create: createExtensionDeviceBrowserOneClickJob,
  patch: patchExtensionDeviceBrowserOneClickJob,
  read: readExtensionDeviceBrowserOneClickJob,
  watermarks: readExtensionDeviceWatermarkTemplates,
});

async function requestExtensionDeviceOzonCdnAuth(method, shopId, payload, expectedSessionId) {
  const normalizedShopId = String(shopId == null ? '' : shopId).trim();
  if (!normalizedShopId || normalizedShopId.length > 200 || /[\\/]/.test(normalizedShopId)) {
    return { ok: false, errorCode: 'invalid_shop_id', error: '店铺 ID 无效' };
  }
  const credentials = getLogisticsDeviceCredentials();
  const stored = await credentials.getStatus();
  if (!stored || stored.state !== 'paired') {
    return { ok: false, errorCode: 'device_unpaired', error: '设备未配对' };
  }

  let operation;
  try {
    operation = await credentials.beginOperation();
  } catch (error) {
    return {
      ok: false,
      errorCode: 'device_unreachable',
      error: error && error.message ? error.message : '设备授权验证失败',
    };
  }
  if (!operation || operation.state !== 'paired' || !operation.accessToken) {
    return { ok: false, errorCode: 'device_unpaired', error: '设备未配对' };
  }
  if (method === 'PUT' && expectedSessionId && operation.sessionId !== expectedSessionId) {
    return {
      ok: false,
      errorCode: 'device_authority_changed',
      error: '设备授权在写入前已变化，请重新发起同步',
    };
  }
  if (method === 'PUT' && (!Array.isArray(operation.scopes) || !operation.scopes.includes('capture:write'))) {
    return { ok: false, errorCode: 'device_scope_required', error: '设备缺少 Cookie 同步权限' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response;
  let body;
  try {
    const headers = {
      Accept: 'application/json',
      Authorization: 'Bearer ' + operation.accessToken,
    };
    const init = {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    };
    if (method === 'PUT') {
      headers['Content-Type'] = 'application/json;charset=utf-8';
      init.body = JSON.stringify(payload || {});
      if (new TextEncoder().encode(init.body).byteLength > SS_ERP_DEVICE_COOKIE_REQUEST_MAX_BYTES) {
        return { ok: false, errorCode: 'device_cookie_request_too_large', error: '设备 Cookie 请求过大' };
      }
    }
    response = await fetch(
      operation.baseUrl + '/api/extension-device/shops/'
        + encodeURIComponent(normalizedShopId) + '/ozon-cdn-auth',
      init,
    );
    if (response.status === 401 || response.status === 410) {
      await credentials.clearIfCurrent(operation, {
        status: response.status,
        reason: 'device_cookie_authorization_revoked',
      });
      await clearLegacyCompatibilityCredential();
      await markExtensionDeviceAuthority('revoked', operation);
      return {
        ok: false,
        errorCode: 'device_authorization_required',
        error: '设备授权已失效，请重新配对',
        status: response.status,
      };
    }
    body = await readBoundedExtensionDeviceJson(response);
  } catch (error) {
    return {
      ok: false,
      errorCode: method === 'PUT' ? 'device_cookie_write_outcome_unknown' : 'device_unreachable',
      error: error && error.message ? error.message : '设备 Cookie 请求失败',
      ...(method === 'PUT' ? {
        outcome: 'UNKNOWN_OUTCOME',
        automaticRetryAllowed: false,
        guardSessionId: operation.sessionId,
      } : {}),
    };
  } finally {
    clearTimeout(timeoutId);
  }
  const uncertainWriteResponse = method === 'PUT' && (
    response.status === 408
    || response.status === 425
    || response.status === 429
    || (response.status >= 500 && response.status <= 599)
    || (response.ok && (!body || body.code !== 1 || !body.data))
  );
  if (uncertainWriteResponse) {
    return {
      ok: false,
      errorCode: 'device_cookie_write_outcome_unknown',
      error: body && (body.msg || body.error) || ('设备 Cookie 写入结果未知: HTTP ' + response.status),
      status: response.status,
      outcome: 'UNKNOWN_OUTCOME',
      automaticRetryAllowed: false,
      guardSessionId: operation.sessionId,
    };
  }
  if (!response.ok || !body || body.code !== 1 || !body.data) {
    return {
      ok: false,
      errorCode: body && body.errorCode || 'device_cookie_request_failed',
      error: body && (body.msg || body.error) || ('设备 Cookie 请求失败: HTTP ' + response.status),
      status: response.status,
    };
  }
  if (!await credentials.isOperationCurrent(operation)) {
    return {
      ok: false,
      errorCode: 'device_authority_changed',
      error: '设备授权在请求期间已变化，请刷新状态',
      ...(method === 'PUT' ? {
        outcome: 'UNKNOWN_OUTCOME',
        automaticRetryAllowed: false,
        guardSessionId: operation.sessionId,
      } : {}),
    };
  }
  return { ok: true, authMode: 'device', data: body.data };
}

function readExtensionDeviceOzonCdnAuth(shopId) {
  return requestExtensionDeviceOzonCdnAuth('GET', shopId);
}

function writeExtensionDeviceOzonCdnAuth(shopId, payload, expectedSessionId) {
  return requestExtensionDeviceOzonCdnAuth('PUT', shopId, payload, expectedSessionId);
}

globalThis.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH = Object.freeze({
  read: readExtensionDeviceOzonCdnAuth,
  write: writeExtensionDeviceOzonCdnAuth,
});

async function writeExtensionDeviceShopAnalytics(input) {
  try {
    return await getShopAnalyticsDeviceWriter().write(input);
  } catch (error) {
    return {
      ok: false,
      errorCode: 'device_analytics_write_failed',
      error: error && error.message ? error.message : '设备分析数据写入失败',
    };
  }
}

globalThis.SS_ERP_EXTENSION_DEVICE_SHOP_ANALYTICS = writeExtensionDeviceShopAnalytics;

async function claimExtensionDeviceFromErp(message, sender) {
  const baseUrl = trustedErpDeviceBaseUrl(message.baseUrl, sender);
  if (message.onlyIfAuthorizationRequired === true) {
    const latestStatus = await readExtensionDeviceStatus(true);
    if (latestStatus.state !== 'authorization_required') return latestStatus;
  }
  const credentials = getLogisticsDeviceCredentials();
  const current = await credentials.getStatus();
  if (current && current.state === 'paired') {
    const connection = await credentials.getConnection();
    if (!connection || connection.baseUrl !== baseUrl) {
      throw new Error('扩展已连接其他 ERP，请先在完整设置中解除配对');
    }
    const verified = await readExtensionDeviceStatus(true);
    if (verified.state === 'paired' && message.reauthorize !== true) {
      await clearLegacyCompatibilityCredential();
      await markExtensionDeviceAuthority('paired', verified);
      return verified;
    }
    if (verified.state === 'unreachable') {
      throw new Error('原设备授权暂时无法验证，请恢复 ERP 网络后重试');
    }
    if (verified.state !== 'paired') await credentials.clear();
  }

  const deviceId = await ensureExtensionDeviceId();
  const claimed = await credentials.claim({
    baseUrl,
    code: message.code,
    deploymentId: message.deploymentId,
    deviceId,
    deviceLabel: toText(message.deviceLabel).trim() || 'Chrome extension',
  });

  // A scoped device session is the sole authority after pairing. Do not carry
  // forward a token from a previous owner or compatibility install.
  await clearLegacyCompatibilityCredential();
  await markExtensionDeviceAuthority('paired', claimed);
  if (self.SS_ERP_RUNTIME) self.SS_ERP_RUNTIME.syncRuntimeMode();
  return readExtensionDeviceStatus(false);
}

function enqueueExtensionDeviceClaim(message, sender) {
  assertTrustedErpDeviceSender(sender);
  if (!extensionDeviceClaimQueue) {
    const api = globalThis.SS_ERP_EXTENSION_DEVICE_CLAIM_QUEUE;
    if (!api || typeof api.create !== 'function') {
      throw new Error('扩展设备领取队列不可用');
    }
    extensionDeviceClaimQueue = api.create(claimExtensionDeviceFromErp);
  }
  return extensionDeviceClaimQueue(message, sender);
}

async function readExtensionDeviceStatusAfterClaims(verify) {
  if (extensionDeviceClaimQueue && typeof extensionDeviceClaimQueue.afterIdle === 'function') {
    return extensionDeviceClaimQueue.afterIdle(() => readExtensionDeviceStatus(verify));
  }
  return readExtensionDeviceStatus(verify);
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

function getByokProfileStore() {
  if (byokProfileStore) return byokProfileStore;
  const api = globalThis.SS_ERP_BYOK_PROFILE_STORE;
  if (!api || typeof api.createStore !== 'function') {
    throw new Error('BYOK Provider profile store is unavailable');
  }
  byokProfileStore = api.createStore({
    localStorage: chrome.storage.local,
    sessionStorage: chrome.storage.session,
    now: () => new Date(),
    onCredentialAuthorityChanged: clearCachedByokGeneratedResults,
  });
  return byokProfileStore;
}

function getByokReadinessHandleCache() {
  if (byokReadinessHandleCache) return byokReadinessHandleCache;
  const api = globalThis.SS_ERP_BYOK_READINESS_HANDLE_CACHE;
  if (!api || typeof api.createCache !== 'function') {
    throw new Error('BYOK readiness cache is unavailable');
  }
  byokReadinessHandleCache = api.createCache({ now: () => new Date() });
  return byokReadinessHandleCache;
}

function getByokDeviceTransport() {
  if (byokDeviceTransport) return byokDeviceTransport;
  const sessionApi = globalThis.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION;
  if (!sessionApi || typeof sessionApi.createTransport !== 'function') {
    throw new Error('BYOK ERP device transport is unavailable');
  }
  const credentials = getLogisticsDeviceCredentials();
  const byokCredentials = {
    beginOperation: (...args) => credentials.beginOperation(...args),
    isOperationCurrent: (...args) => credentials.isOperationCurrent(...args),
    clearIfCurrent: (...args) => credentials.clearIfCurrent(...args),
  };
  byokDeviceTransport = sessionApi.createTransport({
    credentials: byokCredentials,
    fetchImpl: globalThis.fetch.bind(globalThis),
  });
  return byokDeviceTransport;
}

function getShopAnalyticsDeviceWriter() {
  if (shopAnalyticsDeviceWriter) return shopAnalyticsDeviceWriter;
  const api = globalThis.SS_ERP_SHOP_ANALYTICS_DEVICE_WRITER;
  if (!api || typeof api.createWriter !== 'function') {
    throw new Error('设备分析数据写入模块不可用');
  }
  shopAnalyticsDeviceWriter = api.createWriter({
    transport: getByokDeviceTransport(),
  });
  return shopAnalyticsDeviceWriter;
}

function getHostedAiImageSuitePreviewBridge() {
  if (hostedAiImageSuitePreviewBridge) return hostedAiImageSuitePreviewBridge;
  const api = globalThis.SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_BRIDGE;
  if (!api || typeof api.createBridge !== 'function') {
    throw new Error('Hosted AI image suite preview bridge is unavailable');
  }
  const transport = getByokDeviceTransport();
  const previewPath =
    '/api/extension-device/source-workbench/ai-image-suite/candidate-preview';
  hostedAiImageSuitePreviewBridge = api.createBridge({
    async issuePreview(input) {
      const result = await transport.post(
        previewPath,
        { binding: input.binding },
        { requiredScope: 'listing:review' },
      );
      if (!result || result.state !== 'response'
        || !result.body || result.body.code !== 1 || !result.body.data) {
        throw new Error('Hosted AI image suite preview issue failed');
      }
      return result.body.data;
    },
    async consumePreview(input) {
      const result = await transport.postRaw(
        previewPath + '/consume',
        { binding: input.binding, token: input.token },
        { requiredScope: 'listing:review', signal: input.signal },
      );
      if (!result || result.state !== 'raw_response' || !result.response) {
        throw new Error('Hosted AI image suite preview consume failed');
      }
      return result.response;
    },
    BroadcastChannel: globalThis.BroadcastChannel,
    Blob: globalThis.Blob,
    AbortController: globalThis.AbortController,
    crypto: globalThis.crypto,
    now: () => new Date(),
  });
  return hostedAiImageSuitePreviewBridge;
}

function createHostedAiImageSuiteWorkbenchClient() {
  const clientApi = globalThis.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT;
  const adapterApi = globalThis.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_ADAPTER;
  const listingApi = globalThis.SS_ERP_LISTING_WORKFLOW_CLIENT;
  if (!clientApi || typeof clientApi.createClient !== 'function'
    || !adapterApi || typeof adapterApi.createAdapter !== 'function'
    || !listingApi || typeof listingApi.createAiImageSuiteIntentWitness !== 'function') {
    throw new Error('Hosted AI image suite workbench client is unavailable');
  }
  return clientApi.createClient({
    transport: getByokDeviceTransport(),
    listingClient: getSourceListingWorkflowClient(),
    adapter: adapterApi.createAdapter({ intentContract: listingApi }),
    previewBridge: getHostedAiImageSuitePreviewBridge(),
  });
}

function getHostedAiImageSuiteClientRegistry() {
  if (hostedAiImageSuiteClientRegistry) return hostedAiImageSuiteClientRegistry;
  const api = globalThis.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT_REGISTRY;
  if (!api || typeof api.createRegistry !== 'function') {
    throw new Error('Hosted AI image suite client registry is unavailable');
  }
  hostedAiImageSuiteClientRegistry = api.createRegistry({
    createClient() {
      return createHostedAiImageSuiteWorkbenchClient();
    },
  });
  return hostedAiImageSuiteClientRegistry;
}

function getHostedAiImageSuiteRuntimeDispatcher() {
  if (hostedAiImageSuiteRuntimeDispatcher) return hostedAiImageSuiteRuntimeDispatcher;
  const api = globalThis.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_DISPATCHER;
  const authorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
  if (!api || typeof api.createDispatcher !== 'function'
    || !authorization || !authorization.MESSAGE_TYPES?.HOSTED_WORKBENCH) {
    throw new Error('Hosted AI image suite runtime dispatcher is unavailable');
  }
  hostedAiImageSuiteRuntimeDispatcher = api.createDispatcher({
    messageTypes: authorization.MESSAGE_TYPES.HOSTED_WORKBENCH,
    async getClient(sender, binding) {
      const session = await getByokWorkbenchSessionManager().claim(sender);
      const context = session.context;
      if (context.sourceCaptureSnapshotId !== binding.snapshotId || context.supplyGoodsId !== binding.supplyGoodsId
        || context.shopId !== binding.shopId || context.workflowId !== binding.listingWorkflowId
        || context.draftRevision !== binding.draftRevision || context.draftVersion !== binding.draftVersion) {
        throw Object.assign(new Error('Hosted workbench context changed'), { code: 'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE' });
      }
      return getHostedAiImageSuiteClientRegistry().getClient(sender, binding);
    },
  });
  return hostedAiImageSuiteRuntimeDispatcher;
}

function getByokReadinessClient() {
  if (byokReadinessClient) return byokReadinessClient;
  const api = globalThis.SS_ERP_BYOK_READINESS_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK readiness client is unavailable');
  }
  byokReadinessClient = api.createClient({
    transport: getByokDeviceTransport(),
    profileStore: getByokProfileStore(),
    handleCache: getByokReadinessHandleCache(),
  });
  return byokReadinessClient;
}

function getByokExecutionIntentClient() {
  if (byokExecutionIntentClient) return byokExecutionIntentClient;
  const api = globalThis.SS_ERP_BYOK_EXECUTION_INTENT_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK execution intent client is unavailable');
  }
  byokExecutionIntentClient = api.createClient({ transport: getByokDeviceTransport() });
  return byokExecutionIntentClient;
}

function getByokExecutionBatchClient() {
  if (byokExecutionBatchClient) return byokExecutionBatchClient;
  const api = globalThis.SS_ERP_BYOK_EXECUTION_BATCH_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK execution batch client is unavailable');
  }
  byokExecutionBatchClient = api.createClient({ transport: getByokDeviceTransport() });
  return byokExecutionBatchClient;
}

function getByokExecutionIntentClaimBroker() {
  if (byokExecutionIntentClaimBroker) return byokExecutionIntentClaimBroker;
  const api = globalThis.SS_ERP_BYOK_EXECUTION_INTENT_CLAIM_BROKER;
  if (!api || typeof api.createBroker !== 'function') {
    throw new Error('BYOK execution intent claim broker is unavailable');
  }
  byokExecutionIntentClaimBroker = api.createBroker({
    fallback: getByokExecutionIntentClient(),
  });
  return byokExecutionIntentClaimBroker;
}

function getByokPermissionBroker() {
  if (byokPermissionBroker) return byokPermissionBroker;
  const api = globalThis.SS_ERP_BYOK_PERMISSION_BROKER;
  if (!api || typeof api.createBroker !== 'function') {
    throw new Error('BYOK permission broker is unavailable');
  }
  byokPermissionBroker = api.createBroker({
    permissions: chrome.permissions,
    sessionStorage: chrome.storage.session,
    consentAuthority: 'BACKGROUND',
    onConsentRevoked: clearCachedByokGeneratedResults,
  });
  return byokPermissionBroker;
}

function getByokTextToImageClient() {
  if (byokTextToImageClient) return byokTextToImageClient;
  const api = globalThis.SS_ERP_BYOK_TEXT_TO_IMAGE_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK text-to-image client is unavailable');
  }
  byokTextToImageClient = api.createClient({
    profileStore: getByokProfileStore(),
    permissionBroker: getByokPermissionBroker(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    authorizeResultOrigin: async () => false,
    crypto: globalThis.crypto,
    now: () => new Date(),
    executionIntentClient: getByokExecutionIntentClaimBroker(),
    stageResult: stageByokGeneratedResult,
  });
  return byokTextToImageClient;
}

function getByokImageEditClient() {
  if (byokImageEditClient) return byokImageEditClient;
  const clientApi = globalThis.SS_ERP_BYOK_IMAGE_EDIT_CLIENT;
  const inspectorApi = globalThis.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR;
  const maskApi = globalThis.SS_ERP_BYOK_IMAGE_MASK_TRANSFORM;
  const adapterApi = globalThis.SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS;
  const probeApi = globalThis.SS_ERP_BYOK_IMAGE_EDIT_PROBE_MEDIA;
  if (!clientApi || typeof clientApi.createClient !== 'function'
    || !inspectorApi || typeof inspectorApi.inspectImageBlob !== 'function'
    || !maskApi || typeof maskApi.createTransformer !== 'function'
    || !adapterApi || !adapterApi.OPENAI_MULTIPART_SYNC
    || !probeApi || typeof probeApi.createFactory !== 'function'
    || typeof globalThis.createImageBitmap !== 'function'
    || typeof globalThis.OffscreenCanvas !== 'function') {
    throw new Error('BYOK image edit client is unavailable');
  }
  const maskTransformer = maskApi.createTransformer({
    createImageBitmap: (blob) => globalThis.createImageBitmap(blob),
    OffscreenCanvas: globalThis.OffscreenCanvas,
  });
  const probeMediaFactory = probeApi.createFactory({
    OffscreenCanvas: globalThis.OffscreenCanvas,
  });
  byokImageEditClient = clientApi.createClient({
    profileStore: getByokProfileStore(),
    permissionBroker: getByokPermissionBroker(),
    imageInputInspector: inspectorApi,
    maskTransformer,
    probeMediaFactory,
    adapter: adapterApi.OPENAI_MULTIPART_SYNC,
    fetchImpl: globalThis.fetch.bind(globalThis),
    authorizeResultOrigin: async () => false,
    decodeImage: (blob) => globalThis.createImageBitmap(blob),
    crypto: globalThis.crypto,
    now: () => new Date(),
    executionIntentClient: getByokExecutionIntentClaimBroker(),
    stageResult: stageByokGeneratedResult,
  });
  return byokImageEditClient;
}

function getByokCapabilityClient() {
  if (byokCapabilityClient) return byokCapabilityClient;
  byokCapabilityClient = Object.freeze({
    probe(input) {
      if (input && input.operation === 'TEXT_TO_IMAGE') {
        const { operation: _operation, ...textToImageInput } = input;
        return getByokTextToImageClient().probe(textToImageInput);
      }
      return getByokImageEditClient().probe(input);
    },
  });
  return byokCapabilityClient;
}

function getByokProviderSettingsDispatcher() {
  if (byokProviderSettingsDispatcher) return byokProviderSettingsDispatcher;
  const api = globalThis.SS_ERP_BYOK_PROVIDER_SETTINGS_HANDLER;
  const authorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
  const profileSchema = globalThis.SS_ERP_BYOK_PROFILE_SCHEMA;
  if (!api || typeof api.createDispatcher !== 'function'
    || !authorization || !authorization.MESSAGE_TYPES
    || !profileSchema) {
    throw new Error('BYOK Provider settings dispatcher is unavailable');
  }
  byokProviderSettingsDispatcher = api.createDispatcher({
    messageTypes: authorization.MESSAGE_TYPES.PROVIDER_SETTINGS,
    profileSchema,
    profileStore: getByokProfileStore(),
    permissionBroker: getByokPermissionBroker(),
    readinessClient: getByokReadinessClient(),
    capabilityClient: getByokCapabilityClient(),
    preparePermissionReadiness: (verification) => {
      const bridge = getByokReadinessHandleCache().createPermissionBridge(verification);
      bridge.consume(
        verification.handleId,
        verification.binding,
        verification.binding.providerOrigin,
      );
      return {
        readinessHandle: verification.handleId,
        readinessBinding: verification.binding,
        expiresAt: verification.expiresAt,
      };
    },
    readDeviceStatus: () => readExtensionDeviceStatusAfterClaims(true),
    listShops: () => readExtensionDeviceOzonShops(),
  });
  return byokProviderSettingsDispatcher;
}

function getByokGeneratedResultVault() {
  if (byokGeneratedResultVault) return byokGeneratedResultVault;
  const api = globalThis.SS_ERP_BYOK_GENERATED_RESULT_VAULT;
  if (!api || typeof api.createVault !== 'function') {
    throw new Error('BYOK generated result vault is unavailable');
  }
  byokGeneratedResultVault = api.createVault({
    now: () => new Date(),
    onDiscardedResult: (resultId) => {
      void getByokGeneratedResultEscrow().delete(resultId).catch(function () {});
      try { byokGeneratedAssetIngestClient?.discardResult(resultId); } catch (_error) {}
      try { byokWorkbenchPreviewBroker?.releaseResult(resultId); } catch (_error) {}
    },
  });
  return byokGeneratedResultVault;
}

function getByokGeneratedResultEscrow() {
  if (byokGeneratedResultEscrow) return byokGeneratedResultEscrow;
  const api = globalThis.SS_ERP_BYOK_GENERATED_RESULT_VAULT_PERSISTENCE;
  if (!api || typeof api.createStore !== 'function'
    || typeof api.createIndexedDbRepository !== 'function') {
    throw new Error('BYOK generated result escrow is unavailable');
  }
  const repository = api.createIndexedDbRepository({ indexedDB: globalThis.indexedDB });
  byokGeneratedResultEscrow = api.createStore({
    repository,
    sessionStorage: chrome.storage.session,
    crypto: globalThis.crypto,
    randomValues: (bytes) => globalThis.crypto.getRandomValues(bytes),
    now: () => Date.now(),
  });
  return byokGeneratedResultEscrow;
}

async function stageByokGeneratedResult(result, binding) {
  const authority = await getByokRuntimeAuthorityGuard().capture(binding);
  return getByokGeneratedResultEscrow().stage(
    result,
    binding,
    authority.lifecycleAuthority,
  );
}

function getByokRuntimeAuthorityGuard() {
  if (byokRuntimeAuthorityGuard) return byokRuntimeAuthorityGuard;
  const api = globalThis.SS_ERP_BYOK_RUNTIME_AUTHORITY;
  if (!api || typeof api.createGuard !== 'function') {
    throw new Error('BYOK runtime authority guard is unavailable');
  }
  byokRuntimeAuthorityGuard = api.createGuard({
    credentials: getLogisticsDeviceCredentials(),
  });
  return byokRuntimeAuthorityGuard;
}

function getByokGeneratedAssetIngestClient() {
  if (byokGeneratedAssetIngestClient) return byokGeneratedAssetIngestClient;
  const api = globalThis.SS_ERP_BYOK_GENERATED_ASSET_INGEST_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK generated asset ingest client is unavailable');
  }
  byokGeneratedAssetIngestClient = api.createClient({
    transport: getByokDeviceTransport(),
    vault: getByokGeneratedResultVault(),
    isAuthorityCurrent: (authority) => (
      getLogisticsDeviceCredentials().isAuthorityCurrent(authority)
    ),
  });
  return byokGeneratedAssetIngestClient;
}

function getByokGeneratedAssetBatchIngestClient() {
  if (byokGeneratedAssetBatchIngestClient) return byokGeneratedAssetBatchIngestClient;
  const api = globalThis.SS_ERP_BYOK_GENERATED_ASSET_BATCH_INGEST_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK generated asset batch ingest client is unavailable');
  }
  byokGeneratedAssetBatchIngestClient = api.createClient({
    transport: getByokDeviceTransport(),
    vault: getByokGeneratedResultVault(),
    isAuthorityCurrent: (authority) => (
      getLogisticsDeviceCredentials().isAuthorityCurrent(authority)
    ),
  });
  return byokGeneratedAssetBatchIngestClient;
}

function getByokListingPublishCoordinator() {
  if (byokListingPublishCoordinator) return byokListingPublishCoordinator;
  const api = globalThis.SS_ERP_BYOK_LISTING_PUBLISH_COORDINATOR;
  if (!api || typeof api.createCoordinator !== 'function') {
    throw new Error('BYOK listing publish coordinator is unavailable');
  }
  byokListingPublishCoordinator = api.createCoordinator({
    transport: getByokDeviceTransport(),
    store: chrome.storage.session,
    crypto: globalThis.crypto,
    now: () => Date.now(),
  });
  return byokListingPublishCoordinator;
}

function getWorkbenchListingPublishCoordinator() {
  if (workbenchListingPublishCoordinator) return workbenchListingPublishCoordinator;
  const api = globalThis.SS_ERP_WORKBENCH_LISTING_PUBLISH_COORDINATOR;
  if (!api || typeof api.createCoordinator !== 'function') {
    throw new Error('Workbench listing publish coordinator is unavailable');
  }
  workbenchListingPublishCoordinator = api.createCoordinator({
    transport: getByokDeviceTransport(),
    store: chrome.storage.session,
    crypto: globalThis.crypto,
    now: () => Date.now(),
  });
  return workbenchListingPublishCoordinator;
}

function getByokWorkbenchLaunchClient() {
  if (byokWorkbenchLaunchClient) return byokWorkbenchLaunchClient;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_LAUNCH_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK workbench launch client is unavailable');
  }
  byokWorkbenchLaunchClient = api.createClient({ transport: getByokDeviceTransport() });
  return byokWorkbenchLaunchClient;
}

function getByokWorkbenchBatchLaunchClient() {
  if (byokWorkbenchBatchLaunchClient) return byokWorkbenchBatchLaunchClient;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_BATCH_LAUNCH_CLIENT;
  if (!api || typeof api.createClient !== 'function') {
    throw new Error('BYOK workbench batch launch client is unavailable');
  }
  byokWorkbenchBatchLaunchClient = api.createClient({ transport: getByokDeviceTransport() });
  return byokWorkbenchBatchLaunchClient;
}

function getByokWorkbenchSessionManager() {
  if (byokWorkbenchSessionManager) return byokWorkbenchSessionManager;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION;
  if (!api || typeof api.createManager !== 'function') {
    throw new Error('BYOK workbench session manager is unavailable');
  }
  byokWorkbenchSessionManager = api.createManager({
    sessionStorage: chrome.storage.session,
    tabs: chrome.tabs,
    runtime: chrome.runtime,
    now: () => Date.now(),
    verifyErpSourceAuthority: async (authority) => {
      await assertErpSourceDeviceAuthority(authority);
      return true;
    },
    onDiscardedResult: (resultId) => {
      try { byokGeneratedResultVault?.release(resultId); } catch (_error) {}
      try { byokGeneratedAssetIngestClient?.discardResult(resultId); } catch (_error) {}
      try { byokWorkbenchPreviewBroker?.releaseResult(resultId); } catch (_error) {}
    },
  });
  return byokWorkbenchSessionManager;
}

function getByokWorkbenchPreviewBroker() {
  if (byokWorkbenchPreviewBroker) return byokWorkbenchPreviewBroker;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_PREVIEW_CHANNEL;
  if (!api || typeof api.createBroker !== 'function') {
    throw new Error('BYOK workbench preview channel is unavailable');
  }
  byokWorkbenchPreviewBroker = api.createBroker({
    BroadcastChannel: globalThis.BroadcastChannel,
    crypto: globalThis.crypto,
    now: () => new Date(),
  });
  return byokWorkbenchPreviewBroker;
}

function getByokWorkbenchSourceMediaLibrary() {
  if (byokWorkbenchSourceMediaLibrary) return byokWorkbenchSourceMediaLibrary;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_SOURCE_MEDIA_LIBRARY;
  if (!api || typeof api.createLibrary !== 'function') {
    throw new Error('BYOK source media library is unavailable');
  }
  byokWorkbenchSourceMediaLibrary = api.createLibrary({
    listingClient: getSourceListingWorkflowClient(),
    transport: getByokDeviceTransport(),
    previewBroker: getByokWorkbenchPreviewBroker(),
    crypto: globalThis.crypto,
    Blob: globalThis.Blob,
  });
  return byokWorkbenchSourceMediaLibrary;
}

function getByokWorkbenchMediaBroker() {
  if (byokWorkbenchMediaBroker) return byokWorkbenchMediaBroker;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_MEDIA_CHANNEL;
  const inspector = globalThis.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR;
  if (!api || typeof api.createBroker !== 'function'
    || !inspector || typeof inspector.inspectImageBlob !== 'function'
    || typeof globalThis.createImageBitmap !== 'function') {
    throw new Error('BYOK workbench media channel is unavailable');
  }
  byokWorkbenchMediaBroker = api.createBroker({
    BroadcastChannel: globalThis.BroadcastChannel,
    imageInspector: inspector,
    decodeImage: (blob) => globalThis.createImageBitmap(blob),
    crypto: globalThis.crypto,
    now: () => new Date(),
  });
  return byokWorkbenchMediaBroker;
}

function getByokWorkbenchEditMediaStore() {
  if (byokWorkbenchEditMediaStore) return byokWorkbenchEditMediaStore;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_EDIT_MEDIA_STORE;
  if (!api || typeof api.createStore !== 'function') {
    throw new Error('BYOK workbench edit media store is unavailable');
  }
  byokWorkbenchEditMediaStore = api.createStore({
    broker: getByokWorkbenchMediaBroker(),
  });
  return byokWorkbenchEditMediaStore;
}

function getByokWorkbenchEditController() {
  if (byokWorkbenchEditController) return byokWorkbenchEditController;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_EDIT_CONTROLLER;
  const engine = globalThis.SS_ERP_BYOK_MEDIA_JOB_ENGINE;
  if (!api || typeof api.createController !== 'function'
    || !engine || typeof engine.createEngine !== 'function') {
    throw new Error('BYOK workbench edit controller is unavailable');
  }
  byokWorkbenchEditController = api.createController({
    mediaJobEngine: engine,
    readinessClient: getByokReadinessClient(),
    imageEditClient: getByokImageEditClient(),
    generatedResultVault: getByokGeneratedResultVault(),
    authorityGuard: getByokRuntimeAuthorityGuard(),
    mediaStore: getByokWorkbenchEditMediaStore(),
    providerSemaphore: getByokWorkbenchProviderSemaphore(),
    crypto: globalThis.crypto,
    now: () => new Date(),
  });
  return byokWorkbenchEditController;
}

function getByokWorkbenchProviderSemaphore() {
  if (byokWorkbenchProviderSemaphore) return byokWorkbenchProviderSemaphore;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE;
  if (!api || typeof api.createSemaphore !== 'function') {
    throw new Error('BYOK workbench Provider semaphore is unavailable');
  }
  byokWorkbenchProviderSemaphore = api.createSemaphore({ now: () => new Date() });
  return byokWorkbenchProviderSemaphore;
}

function getByokWorkbenchEditEpochGuard() {
  if (byokWorkbenchEditEpochGuard) return byokWorkbenchEditEpochGuard;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_EDIT_EPOCH_GUARD;
  if (!api || typeof api.createGuard !== 'function') {
    throw new Error('BYOK workbench edit epoch guard is unavailable');
  }
  byokWorkbenchEditEpochGuard = api.createGuard({
    sessionStorage: chrome.storage.session,
    randomValues: (bytes) => globalThis.crypto.getRandomValues(bytes),
    now: () => Date.now(),
  });
  return byokWorkbenchEditEpochGuard;
}

function createByokWorkbenchBatchCoordinator(options) {
  const coordinatorApi = globalThis.SS_ERP_BYOK_WORKBENCH_BATCH_COORDINATOR;
  const providerExecutorApi = globalThis.SS_ERP_BYOK_WORKBENCH_BATCH_PROVIDER_EXECUTOR;
  const mediaJobEngine = globalThis.SS_ERP_BYOK_MEDIA_JOB_ENGINE;
  if (!coordinatorApi || typeof coordinatorApi.createCoordinator !== 'function'
    || !providerExecutorApi || typeof providerExecutorApi.createExecutor !== 'function'
    || !mediaJobEngine || typeof mediaJobEngine.createEngine !== 'function') {
    throw new Error('BYOK workbench batch coordinator is unavailable');
  }
  const concurrencyAuthority = options.concurrencyAuthority;
  const providerExecutor = providerExecutorApi.createExecutor({
    textClient: getByokTextToImageClient(),
    editClient: getByokImageEditClient(),
    authorityGuard: getByokRuntimeAuthorityGuard(),
    vault: getByokGeneratedResultVault(),
    providerSemaphore: getByokWorkbenchProviderSemaphore(),
    ownerToken: 'byok-batch:' + globalThis.crypto.randomUUID(),
    concurrencyAuthority,
  });
  return coordinatorApi.createCoordinator({
    mediaJobEngine,
    providerExecutor,
    resultVault: getByokGeneratedResultVault(),
    atomicBatchIngest: getByokGeneratedAssetBatchIngestClient(),
    requestedConcurrency: options.requestedConcurrency,
    concurrencyAuthority,
    runnerMaxConcurrency: coordinatorApi.MAX_SELECTED_SLOTS,
    resolveDispatchInput: options.resolveDispatchInput,
    resolveRecovery: options.resolveRecovery,
  });
}

function getByokWorkbenchBatchRegistry() {
  if (byokWorkbenchBatchRegistry) return byokWorkbenchBatchRegistry;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_BATCH_REGISTRY;
  if (!api || typeof api.createRegistry !== 'function') {
    throw new Error('BYOK workbench batch registry is unavailable');
  }
  byokWorkbenchBatchRegistry = api.createRegistry({
    sessionManager: getByokWorkbenchSessionManager(),
    batchLaunchClient: getByokWorkbenchBatchLaunchClient(),
    readinessClient: getByokReadinessClient(),
    executionBatchClient: getByokExecutionBatchClient(),
    claimBroker: getByokExecutionIntentClaimBroker(),
    textClient: getByokTextToImageClient(),
    editClient: getByokImageEditClient(),
    authorityGuard: getByokRuntimeAuthorityGuard(),
    createCoordinator: createByokWorkbenchBatchCoordinator,
    resolveProviderInput: async () => Object.freeze({}),
    resolveRecovery: async () => {
      const error = new Error('Trusted Provider lookup is unavailable');
      error.code = 'SS_ERP_BYOK_BATCH_PROVIDER_LOOKUP_UNAVAILABLE';
      error.outcome = 'UNKNOWN_OUTCOME';
      error.automaticRetryAllowed = false;
      throw error;
    },
    resultVault: getByokGeneratedResultVault(),
    resultEscrow: getByokGeneratedResultEscrow(),
    previewBroker: getByokWorkbenchPreviewBroker(),
    crypto: globalThis.crypto,
  });
  return byokWorkbenchBatchRegistry;
}

function getByokWorkbenchBatchRuntimeDispatcher() {
  if (byokWorkbenchBatchRuntimeDispatcher) return byokWorkbenchBatchRuntimeDispatcher;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_BATCH_RUNTIME_HANDLER;
  const authorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
  const workbenchTypes = authorization && authorization.MESSAGE_TYPES
    && authorization.MESSAGE_TYPES.WORKBENCH;
  if (!api || typeof api.createDispatcher !== 'function' || !workbenchTypes) {
    throw new Error('BYOK workbench batch runtime dispatcher is unavailable');
  }
  byokWorkbenchBatchRuntimeDispatcher = api.createDispatcher({
    messageTypes: {
      BATCH_STATE: workbenchTypes.BATCH_STATE,
      BATCH_START: workbenchTypes.BATCH_START,
      BATCH_COMMAND: workbenchTypes.BATCH_COMMAND,
      BATCH_PREVIEW: workbenchTypes.BATCH_PREVIEW,
      BATCH_INGEST: workbenchTypes.BATCH_INGEST,
      BATCH_RECOVER: workbenchTypes.BATCH_RECOVER,
      BATCH_CLEAR: workbenchTypes.BATCH_CLEAR,
    },
    registry: getByokWorkbenchBatchRegistry(),
  });
  return byokWorkbenchBatchRuntimeDispatcher;
}

function getByokWorkbenchRuntimeDispatcher() {
  if (byokWorkbenchRuntimeDispatcher) return byokWorkbenchRuntimeDispatcher;
  const api = globalThis.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER;
  const authorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
  if (!api || typeof api.createDispatcher !== 'function'
    || !authorization || !authorization.MESSAGE_TYPES?.WORKBENCH) {
    throw new Error('BYOK workbench runtime dispatcher is unavailable');
  }
  byokWorkbenchRuntimeDispatcher = api.createDispatcher({
    messageTypes: authorization.MESSAGE_TYPES.WORKBENCH,
    sessionManager: getByokWorkbenchSessionManager(),
    launchClient: getByokWorkbenchLaunchClient(),
    assertSourceCurrent: assertSourceAiWorkbenchPageCurrent,
    profileStore: getByokProfileStore(),
    permissionBroker: getByokPermissionBroker(),
    readinessClient: getByokReadinessClient(),
    providerClient: getByokTextToImageClient(),
    ingestClient: getByokGeneratedAssetIngestClient(),
    publishCoordinator: getByokListingPublishCoordinator(),
    workbenchPublishCoordinator: getWorkbenchListingPublishCoordinator(),
    vault: getByokGeneratedResultVault(),
    authorityGuard: getByokRuntimeAuthorityGuard(),
    previewBroker: getByokWorkbenchPreviewBroker(),
    sourceMediaLibrary: getByokWorkbenchSourceMediaLibrary(),
    editController: getByokWorkbenchEditController(),
    editMediaStore: getByokWorkbenchEditMediaStore(),
    editEpochGuard: getByokWorkbenchEditEpochGuard(),
    providerSemaphore: getByokWorkbenchProviderSemaphore(),
    now: () => new Date(),
  });
  return byokWorkbenchRuntimeDispatcher;
}

function installByokReadinessRuntime() {
  const authorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
  if (!authorization || !authorization.MESSAGE_TYPES) return;
  const previousHandlers = globalThis.SS_ERP_BYOK_RUNTIME_MESSAGE_HANDLERS || {};
  const providerSettingsDispatcher = getByokProviderSettingsDispatcher();
  const workbenchDispatcher = getByokWorkbenchRuntimeDispatcher();
  const batchWorkbenchDispatcher = getByokWorkbenchBatchRuntimeDispatcher();
  const hostedWorkbenchDispatcher = getHostedAiImageSuiteRuntimeDispatcher();
  globalThis.SS_ERP_BYOK_RUNTIME_MESSAGE_HANDLERS = Object.freeze({
    ...previousHandlers,
    ...providerSettingsDispatcher.handlers,
    ...workbenchDispatcher.handlers,
    ...batchWorkbenchDispatcher.handlers,
    ...hostedWorkbenchDispatcher.handlers,
  });
  globalThis.SS_ERP_BYOK_READINESS_HANDLE_VERIFIER = (input) => (
    getByokReadinessHandleCache().consume(input)
  );
  globalThis.SS_ERP_BYOK_RESPONSE_SECRET_VALUES = async ({ payload }) => {
    const profileId = payload && typeof payload.profileId === 'string'
      ? payload.profileId
      : payload && payload.startRequest
        && typeof payload.startRequest.profileId === 'string'
        ? payload.startRequest.profileId
        : '';
    if (!profileId) return [];
    const apiKey = await getByokProfileStore().readSecretForBackground(profileId);
    return apiKey ? [apiKey] : [];
  };
}

installByokReadinessRuntime();

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

function sourceTranslationIntentText(value, maxLength) {
  const normalized = String(value == null ? '' : value).normalize('NFKC').trim();
  return normalized && normalized.length <= maxLength ? normalized : '';
}

function sourceTranslationIntentIdentity(value) {
  const platform = sourceWorkflowPlatform(value && value.platform);
  const sourceProductId = sourceTranslationIntentText(value && value.sourceProductId, 200);
  const listingWorkflowId = sourceTranslationIntentText(value && value.listingWorkflowId, 200);
  const sourceMediaKey = sourceTranslationIntentText(value && value.sourceMediaKey, 500);
  const draftRevision = Number(value && value.draftRevision);
  const draftVersion = Number(value && value.draftVersion);
  if (!platform || !sourceProductId || !listingWorkflowId || !sourceMediaKey
    || !Number.isSafeInteger(draftRevision) || draftRevision <= 0
    || !Number.isSafeInteger(draftVersion) || draftVersion <= 0) return '';
  return [platform, sourceProductId, listingWorkflowId, draftRevision, draftVersion, sourceMediaKey]
    .map((part) => encodeURIComponent(String(part))).join(':');
}

function validateSourceTranslationIntent(value, expectedIdentity) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const allowed = new Set([
    'identity', 'platform', 'sourceProductId', 'listingWorkflowId', 'draftRevision', 'draftVersion',
    'sourceMediaKey', 'workflowOperationKey', 'createdAt',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  const identity = sourceTranslationIntentIdentity(value);
  const createdAt = Number(value.createdAt);
  const workflowOperationKey = sourceTranslationIntentText(value.workflowOperationKey, 128);
  if (!identity || identity !== expectedIdentity || value.identity !== identity
    || !workflowOperationKey || !Number.isSafeInteger(createdAt)
    || createdAt > Date.now() + 60_000
    || createdAt <= Date.now() - SS_ERP_SOURCE_TRANSLATION_INTENT_TTL_MS) return null;
  return {
    identity,
    platform: sourceWorkflowPlatform(value.platform),
    sourceProductId: sourceTranslationIntentText(value.sourceProductId, 200),
    listingWorkflowId: sourceTranslationIntentText(value.listingWorkflowId, 200),
    draftRevision: Number(value.draftRevision),
    draftVersion: Number(value.draftVersion),
    sourceMediaKey: sourceTranslationIntentText(value.sourceMediaKey, 500),
    workflowOperationKey,
    createdAt,
  };
}

async function readSourceTranslationIntent(identity) {
  if (!identity) return null;
  const stored = await chrome.storage.local.get([SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY]);
  const raw = stored[SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = validateSourceTranslationIntent(raw[identity], identity);
  if (candidate) return candidate;
  if (Object.prototype.hasOwnProperty.call(raw, identity)) {
    delete raw[identity];
    await chrome.storage.local.set({ [SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY]: raw });
  }
  return null;
}

function enqueueSourceTranslationIntentWrite(operation) {
  const next = sourceTranslationIntentWriteQueue.then(operation, operation);
  sourceTranslationIntentWriteQueue = next.catch(() => undefined);
  return next;
}

async function getOrCreateSourceTranslationIntent(input) {
  const identity = sourceTranslationIntentIdentity(input);
  if (!identity) throw new Error('图片翻译意图上下文无效');
  return enqueueSourceTranslationIntentWrite(async () => {
    const existing = await readSourceTranslationIntent(identity);
    if (existing) return existing;
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
      throw new Error('安全随机数不可用，无法创建图片翻译意图');
    }
    const randomBytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(randomBytes);
    const random = Array.from(randomBytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const intent = {
      identity,
      platform: sourceWorkflowPlatform(input.platform),
      sourceProductId: sourceTranslationIntentText(input.sourceProductId, 200),
      listingWorkflowId: sourceTranslationIntentText(input.listingWorkflowId, 200),
      draftRevision: Number(input.draftRevision),
      draftVersion: Number(input.draftVersion),
      sourceMediaKey: sourceTranslationIntentText(input.sourceMediaKey, 500),
      workflowOperationKey: `extension-media-workflow:${random}`.slice(0, 128),
      createdAt: Date.now(),
    };
    const valid = validateSourceTranslationIntent(intent, identity);
    if (!valid) throw new Error('图片翻译意图无效');
    const stored = await chrome.storage.local.get([SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY]);
    const raw = stored[SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY];
    const records = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    records[identity] = valid;
    const bounded = Object.fromEntries(
      Object.entries(records)
        .filter(([key, value]) => Boolean(validateSourceTranslationIntent(value, key)))
        .slice(-SS_ERP_SOURCE_TRANSLATION_INTENT_LIMIT),
    );
    await chrome.storage.local.set({ [SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY]: bounded });
    return valid;
  });
}

async function clearSourceTranslationIntent(identity) {
  if (!identity) return;
  await enqueueSourceTranslationIntentWrite(async () => {
    const stored = await chrome.storage.local.get([SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY]);
    const raw = stored[SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !Object.prototype.hasOwnProperty.call(raw, identity)) return;
    const records = { ...raw };
    delete records[identity];
    await chrome.storage.local.set({ [SS_ERP_SOURCE_TRANSLATION_INTENTS_KEY]: records });
  });
}

function getSourceMediaMutationIntentContract() {
  const contract = globalThis.SS_ERP_SOURCE_MEDIA_MUTATION_INTENT;
  if (!contract || typeof contract.identity !== 'function'
    || typeof contract.createStore !== 'function') {
    throw new Error('ERP 媒体结果操作意图安全契约不可用');
  }
  return contract;
}

function getSourceMediaMutationIntentStore() {
  if (sourceMediaMutationIntentStore) return sourceMediaMutationIntentStore;
  sourceMediaMutationIntentStore = getSourceMediaMutationIntentContract().createStore({
    storage: chrome.storage.local,
    storageKey: SS_ERP_SOURCE_MEDIA_MUTATION_INTENTS_KEY,
    ttlMs: SS_ERP_SOURCE_MEDIA_MUTATION_INTENT_TTL_MS,
    limit: SS_ERP_SOURCE_MEDIA_MUTATION_INTENT_LIMIT,
  });
  return sourceMediaMutationIntentStore;
}

function sourceMediaMutationIntentIdentity(value) {
  return getSourceMediaMutationIntentContract().identity(value);
}

function readSourceMediaMutationIntent(identity) {
  return getSourceMediaMutationIntentStore().read(identity);
}

async function getOrCreateSourceMediaMutationIntent(input) {
  const result = await getSourceMediaMutationIntentStore().getOrCreate(input);
  return result.intent;
}

async function executeSourceMediaMutationIntent(client, intent) {
  if (intent.action === 'REVIEW_APPROVE' || intent.action === 'REVIEW_REJECT') {
    return client.reviewMediaOutput({
      mediaWorkflowId: intent.mediaWorkflowId,
      shopId: intent.shopId,
      listingWorkflowId: intent.listingWorkflowId,
      outputAssetId: intent.outputAssetId,
      expectedRevision: intent.expectedWorkflowRevision,
      draftRevision: intent.expectedTargetRevision,
      draftVersion: intent.expectedTargetDraftVersion,
      decision: intent.action === 'REVIEW_APPROVE' ? 'APPROVE' : 'REJECT',
      note: null,
    });
  }
  return client.applyMediaOutput({
    mediaWorkflowId: intent.mediaWorkflowId,
    shopId: intent.shopId,
    listingWorkflowId: intent.listingWorkflowId,
    outputAssetId: intent.outputAssetId,
    expectedWorkflowRevision: intent.expectedWorkflowRevision,
    expectedTargetRevision: intent.expectedTargetRevision,
    expectedTargetDraftVersion: intent.expectedTargetDraftVersion,
  });
}

function currentSourceListingContext(result, requestedListingWorkflowId) {
  if (!result || result.state !== 'ready' || !result.status
    || result.status.snapshot?.current !== true) return null;
  const items = Array.isArray(result.status.listing?.items)
    ? result.status.listing.items.filter(Boolean)
    : [];
  const requested = sourceTranslationIntentText(requestedListingWorkflowId, 200);
  const item = requested
    ? items.find((candidate) => candidate.id === requested)
    : (items.length === 1 ? items[0] : null);
  if (!item) return null;
  if (!item.id || !item.shopId
    || !Number.isSafeInteger(item.revision) || item.revision <= 0
    || !Number.isSafeInteger(item.draftVersion) || item.draftVersion <= 0) return null;
  return {
    shopId: item.shopId,
    listingWorkflowId: item.id,
    revision: item.revision,
    draftVersion: item.draftVersion,
  };
}

function sourceAiWorkbenchSenderIdentity(sender, platform, sourceProductId) {
  if (!sender || sender.frameId !== 0
    || !Number.isSafeInteger(sender.tab?.id) || sender.tab.id < 0
    || typeof sender.documentId !== 'string' || !sender.documentId
    || sender.documentId !== sender.documentId.normalize('NFKC').trim()
    || sender.documentId.length > 200) return null;
  let parsed;
  try {
    parsed = new URL(sender.url || sender.documentUrl || '');
  } catch (_error) {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hash) return null;
  const hostname = parsed.hostname.toLowerCase();
  let pageProductId = '';
  if (platform === '1688' && (hostname === '1688.com' || hostname.endsWith('.1688.com'))) {
    const match = parsed.pathname.match(/^\/offer\/([^/]+)\.html$/u);
    if (match) {
      try { pageProductId = decodeURIComponent(match[1]); } catch (_error) { return null; }
    }
  } else if (platform === 'pdd' && (
    hostname === 'pinduoduo.com' || hostname.endsWith('.pinduoduo.com')
    || hostname === 'yangkeduo.com' || hostname.endsWith('.yangkeduo.com')
  ) && parsed.pathname === '/goods.html') {
    pageProductId = parsed.searchParams.get('goods_id') || '';
  } else if (platform === 'taobao' && hostname === 'item.taobao.com'
    && parsed.pathname === '/item.htm') {
    pageProductId = parsed.searchParams.get('id') || '';
  } else if (platform === 'tmall' && hostname === 'detail.tmall.com'
    && parsed.pathname === '/item.htm') {
    pageProductId = parsed.searchParams.get('id') || '';
  }
  if (!pageProductId || pageProductId.normalize('NFKC').trim() !== sourceProductId) return null;
  return {
    tabId: sender.tab.id,
    documentId: sender.documentId,
    frameId: 0,
  };
}

async function assertSourceAiWorkbenchPageCurrent(value) {
  const sourceSender = value && value.sourceSender;
  const request = value && value.request;
  let tab;
  try {
    tab = await chrome.tabs.get(sourceSender && sourceSender.tabId);
  } catch (_error) {
    tab = null;
  }
  const url = tab && (tab.pendingUrl || tab.url);
  const identity = sourceAiWorkbenchSenderIdentity({
    frameId: 0,
    documentId: sourceSender && sourceSender.documentId,
    url,
    tab: { id: tab && tab.id, url },
  }, request && request.sourcePlatform, request && request.sourceProductId);
  if (!identity || identity.tabId !== sourceSender.tabId
    || identity.documentId !== sourceSender.documentId) {
    const error = new Error('AI 图片工作台来源页面已变化');
    error.status = 409;
    throw error;
  }
  const launchContext = globalThis.SS_ERP_SOURCE_AI_WORKBENCH_LAUNCH_CONTEXT;
  if (!launchContext || typeof launchContext.createLiveSelectionVerifier !== 'function') {
    throw new Error('AI 图片工作台来源选择验证不可用');
  }
  const verifyLiveSelection = launchContext.createLiveSelectionVerifier({
    sendMessage: (tabId, message, options) => chrome.tabs.sendMessage(
      tabId,
      message,
      options,
    ),
  });
  await verifyLiveSelection({
    sourceSender,
    sourceProductId: request && request.sourceProductId,
    sourceSelectionKey: value && value.sourceSelectionKey,
  });
}

const SOURCE_AI_WORKBENCH_BINDING_KEYS = [
  'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
  'shopId', 'workflowId', 'draftRevision', 'draftVersion',
];

function sourceAiWorkbenchChoiceBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== SOURCE_AI_WORKBENCH_BINDING_KEYS.length
    || !SOURCE_AI_WORKBENCH_BINDING_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return null;
  }
  const binding = {
    sourcePlatform: sourceWorkflowPlatform(value.sourcePlatform),
    sourceProductId: sourceWorkflowHandoffText(value.sourceProductId, 200),
    sourceCaptureSnapshotId: sourceWorkflowHandoffText(value.sourceCaptureSnapshotId, 200),
    supplyGoodsId: sourceWorkflowHandoffText(value.supplyGoodsId, 200),
    shopId: sourceWorkflowHandoffText(value.shopId, 200),
    workflowId: sourceWorkflowHandoffText(value.workflowId, 200),
    draftRevision: value.draftRevision,
    draftVersion: value.draftVersion,
  };
  return Object.values(binding).every(Boolean)
    && Number.isSafeInteger(binding.draftRevision) && binding.draftRevision > 0
    && Number.isSafeInteger(binding.draftVersion) && binding.draftVersion > 0
    ? binding : null;
}

async function openAuthoritativeSourceAiWorkbench(message, sender) {
  if (!message || Object.keys(message).length !== 7
    || ![
      'type', 'platform', 'sourceProductId', 'listingWorkflowId', 'preferredSkuKey', 'choiceBinding',
      'sourceSelectionKey',
    ].every(
      (key) => Object.prototype.hasOwnProperty.call(message, key),
    )) {
    throw new Error('AI 图片工作台启动请求无效');
  }
  const sourceProductId = sourceWorkflowHandoffText(message.sourceProductId, 200);
  const platform = sourceWorkflowPlatform(message.platform);
  const requestedListingWorkflowId = sourceWorkflowHandoffText(message.listingWorkflowId, 200);
  const preferredSkuKey = message.preferredSkuKey === null
    ? null : sourceWorkflowHandoffText(message.preferredSkuKey, 500);
  const choiceBinding = message.choiceBinding === null
    ? null : sourceAiWorkbenchChoiceBinding(message.choiceBinding);
  const sourceSelectionKey = message.sourceSelectionKey === null
    ? null : sourceWorkflowHandoffText(message.sourceSelectionKey, 500);
  const sourceSender = sourceAiWorkbenchSenderIdentity(sender, platform, sourceProductId);
  if (!sourceProductId || !platform || !requestedListingWorkflowId || !sourceSender
    || (message.preferredSkuKey !== null && !preferredSkuKey)
    || (message.choiceBinding !== null && !choiceBinding)
    || (message.sourceSelectionKey !== null && !sourceSelectionKey)
    || (!choiceBinding && preferredSkuKey !== sourceSelectionKey)
    || (choiceBinding && !preferredSkuKey)) {
    throw new Error('AI 图片工作台只能从当前货源商品页启动');
  }
  try {
    const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
    if (!handoff || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
      return { state: 'stale' };
    }
    const current = await getSourceListingWorkflowClient().getStatus({
      snapshotId: handoff.snapshotId,
      supplyGoodsId: handoff.supplyGoodsId,
    });
    if (current && ['unpaired', 'scope_required', 'authorization_required'].includes(current.state)) {
      return { state: 'unavailable', reason: 'device_session_unavailable' };
    }
    const listing = currentSourceListingContext(current, requestedListingWorkflowId);
    if (!listing) return { state: 'stale' };
    const currentBinding = {
      sourcePlatform: platform,
      sourceProductId,
      sourceCaptureSnapshotId: handoff.snapshotId,
      supplyGoodsId: handoff.supplyGoodsId,
      shopId: listing.shopId,
      workflowId: listing.listingWorkflowId,
      draftRevision: listing.revision,
      draftVersion: listing.draftVersion,
    };
    if (choiceBinding && SOURCE_AI_WORKBENCH_BINDING_KEYS.some(
      (key) => choiceBinding[key] !== currentBinding[key],
    )) return { state: 'stale' };
    return await getByokWorkbenchRuntimeDispatcher().openFromSource({
      request: {
        ...currentBinding,
        preferredSkuKey,
        selectionKind: choiceBinding ? 'EXPLICIT' : 'HINT',
      },
      sourceSender,
      sourceSelectionKey,
    });
  } catch (error) {
    if (Number(error && error.status) === 409) return { state: 'stale' };
    if (Number(error && error.status) === 403
      || ['unpaired', 'scope_required', 'authorization_required'].includes(
        String(error && error.state || '')
      )) {
      return { state: 'unavailable', reason: 'device_session_unavailable' };
    }
    throw error;
  }
}

let erpSourceImageLauncher = null;
function getErpSourceImageLauncher() {
  if (erpSourceImageLauncher) return erpSourceImageLauncher;
  const api = globalThis.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH;
  const defaults = globalThis.SS_ERP_DEPLOYMENT_DEFAULTS || {};
  if (!api || typeof api.createLauncher !== 'function') throw new Error('ERP 图片扩展入口不可用');
  erpSourceImageLauncher = api.createLauncher({
    runtimeId: chrome.runtime.id,
    apiOrigin: packagedErpDeviceBaseUrl(),
    erpOrigins: [defaults.erpBaseUrl, defaults.erpAdminBaseUrl].filter(Boolean).map(value => new URL(value).origin),
    readDevice: () => readExtensionDeviceStatus(true),
    isSenderCurrent: async (source) => {
      try {
        const response = await chrome.tabs.sendMessage(source.tabId, { type: 'ss-erp:erp-source-launch-current' },
          { frameId: 0, documentId: source.documentId });
        return response?.ok === true && response.origin === source.origin;
      } catch { return false; }
    },
    consumeGrant: async (launchToken) => {
      const response = await getByokDeviceTransport().post('/api/extension-device/erp-launch-grants/consume',
        { launchToken }, { requiredScope: 'media:execute' });
      if (response?.state !== 'response' || response.body?.code !== 1 || !response.body.data) {
        const code = /^ERP_LAUNCH_[A-Z_]{1,80}$/.test(response?.body?.errorCode || '')
          ? response.body.errorCode : 'ERP_SOURCE_LAUNCH_UNAVAILABLE';
        throw Object.assign(new Error(code), { code });
      }
      return response.body.data;
    },
    resolveWorkbench: (request) => getByokWorkbenchLaunchClient().resolve(request),
    openWorkbench: (request) => getByokWorkbenchSessionManager().open(request),
    openEditor: openErpSourceMediaEditor,
  });
  return erpSourceImageLauncher;
}

async function assertErpSourceDeviceAuthority(value) {
  const api = globalThis.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH;
  const authority = api && typeof api.normalizeAuthority === 'function' ? api.normalizeAuthority(value) : null;
  const device = await readExtensionDeviceStatus(true);
  if (!authority || device.state !== 'paired' || device.ownerUserId !== authority.ownerUserId
    || device.sessionId !== authority.deviceSessionId || device.endpoint !== authority.apiOrigin
    || authority.apiOrigin !== packagedErpDeviceBaseUrl()
    || !['listing:review', 'media:execute'].every(scope => device.scopes.includes(scope))) {
    throw new Error('ERP 图片编辑授权已变化，请从当前账号重新打开');
  }
}

async function openErpSourceMediaEditor(input) {
  const grant = input.grant;
  const binding = grant.launchRequest;
  const session = {
    platform: binding.sourcePlatform, sourceProductId: binding.sourceProductId,
    snapshotId: binding.sourceCaptureSnapshotId, supplyGoodsId: binding.supplyGoodsId,
    shopId: binding.shopId, listingWorkflowId: binding.workflowId,
    revision: binding.draftRevision, draftVersion: binding.draftVersion,
    operation: grant.mode, sourceMediaKeys: [...grant.sourceMediaKeys],
    target: grant.target,
    sourceTabId: input.sourceTabId, erpSourceAuthority: input.erpSourceAuthority,
  };
  const authority = await loadFrozenSourceMediaEditorAuthority(session, true);
  return getSourceMediaEditorCoordinator().open({ ...session,
    preparedSource: authority.prepared ? sourceMediaEditorPreparedSnapshot(authority.prepared) : null });
}

async function loadAuthoritativeSourceAiImageSuiteProjection(message) {
  const sourceProductId = sourceWorkflowHandoffText(message?.sourceProductId, 200);
  const platform = sourceWorkflowPlatform(message?.platform);
  const requestedListingWorkflowId = sourceWorkflowHandoffText(
    message?.listingWorkflowId,
    200,
  );
  const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
  if (!handoff || !sourceProductId || !platform || !requestedListingWorkflowId
    || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
    throw new Error('ERP AI 主图/套图上下文无效，请刷新后重试');
  }
  const client = getSourceListingWorkflowClient();
  // The content script supplies only page identity. Re-read every mutable authority layer.
  const current = await client.getStatus({
    snapshotId: handoff.snapshotId,
    supplyGoodsId: handoff.supplyGoodsId,
  });
  const listing = currentSourceListingContext(current, requestedListingWorkflowId);
  if (!listing) throw new Error('ERP 商品草稿状态已变化，请刷新后重试');
  const result = await client.getAiImageSuite({
    snapshotId: handoff.snapshotId,
    supplyGoodsId: handoff.supplyGoodsId,
    shopId: listing.shopId,
    listingWorkflowId: listing.listingWorkflowId,
    draftRevision: listing.revision,
    draftVersion: listing.draftVersion,
  });
  if (!result || result.state !== 'ready' || !result.projection) {
    throw new Error('ERP AI 主图/套图状态暂不可用');
  }
  return { handoff, client, listing, result };
}

async function executeAuthoritativeSourceAiImageSuiteCommand(message) {
  const allowedKeys = new Set([
    'type', 'sourceProductId', 'platform', 'listingWorkflowId',
    'action', 'slotId', 'decision', 'costConfirmed', 'intentWitness',
  ]);
  if (!message || typeof message !== 'object' || Array.isArray(message)
    || Object.keys(message).some((key) => !allowedKeys.has(key))) {
    throw new Error('ERP AI 主图/套图请求字段无效');
  }
  const action = typeof message.action === 'string' ? message.action : '';
  if (!['START', 'CONTINUE', 'CANCEL', 'RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT']
    .includes(action)) {
    throw new Error('ERP AI 主图/套图操作无效');
  }
  const rawSlotId = message.slotId;
  const slotId = rawSlotId == null ? null : sourceWorkflowHandoffText(rawSlotId, 200);
  if (rawSlotId != null && (typeof rawSlotId !== 'string' || slotId !== rawSlotId)) {
    throw new Error('ERP AI 主图/套图槽位无效');
  }
  const decision = message.decision == null ? null : message.decision;
  if (decision !== null && decision !== 'APPROVE' && decision !== 'REJECT') {
    throw new Error('ERP AI 主图/套图审核决定无效');
  }
  if (message.costConfirmed !== undefined && typeof message.costConfirmed !== 'boolean') {
    throw new Error('ERP AI 主图/套图费用确认无效');
  }
  const costConfirmed = message.costConfirmed === true;
  const validShape = action === 'START'
    ? slotId === null && decision === null && costConfirmed
    : action === 'CONTINUE' || action === 'CANCEL'
      ? slotId === null && decision === null && !costConfirmed
      : action === 'RETRY_SLOT'
        ? Boolean(slotId) && decision === null && costConfirmed
        : action === 'REVIEW_SLOT'
          ? Boolean(slotId) && Boolean(decision) && !costConfirmed
          : Boolean(slotId) && decision === null && !costConfirmed;
  if (!validShape) throw new Error('ERP AI 主图/套图请求字段无效');

  const authority = await loadAuthoritativeSourceAiImageSuiteProjection(message);
  const intentContract = globalThis.SS_ERP_LISTING_WORKFLOW_CLIENT;
  if (!intentContract
    || typeof intentContract.createAiImageSuiteIntentWitness !== 'function'
    || typeof intentContract.matchesAiImageSuiteIntentWitness !== 'function') {
    throw new Error('ERP AI 主图/套图意图校验不可用');
  }
  let expectedIntentWitness;
  try {
    expectedIntentWitness = intentContract.createAiImageSuiteIntentWitness({
      projection: authority.result.projection,
      action,
      slotId,
      decision,
    });
  } catch {
    throw new Error('ERP AI 主图/套图状态已变化，请刷新并重新确认');
  }
  if (!intentContract.matchesAiImageSuiteIntentWitness(
    message.intentWitness,
    expectedIntentWitness,
  )) {
    throw new Error('ERP AI 主图/套图状态已变化，请刷新并重新确认');
  }
  const input = {
    projection: authority.result.projection,
    action,
    costConfirmed,
  };
  if (slotId) input.slotId = slotId;
  if (decision) input.decision = decision;
  const result = await authority.client.executeAiImageSuiteCommand(input);
  return { handoff: authority.handoff, result };
}

async function executeSourceMediaCreateWorkflow(input) {
  const client = input?.client;
  const shopId = sourceWorkflowHandoffText(input?.shopId, 200);
  const listingWorkflowId = sourceWorkflowHandoffText(input?.listingWorkflowId, 200);
  const revision = Number(input?.revision);
  const draftVersion = Number(input?.draftVersion);
  const operation = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(input?.operation)
    ? input.operation
    : '';
  const maximumSources = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
  const sourceMediaKeys = Array.isArray(input?.sourceMediaKeys)
    ? input.sourceMediaKeys.map((value) => sourceWorkflowHandoffText(value, 500))
    : [];
  const prompt = sourceWorkflowHandoffText(input?.prompt, 8000);
  const negativePrompt = String(input?.negativePrompt == null ? '' : input.negativePrompt)
    .normalize('NFKC').trim();
  const maskAssetId = input?.maskAssetId == null
    ? null
    : sourceWorkflowHandoffText(input.maskAssetId, 200);
  const attemptId = String(input?.attemptId || '').trim();
  if (!client || typeof client.createWorkflowCommand !== 'function'
    || !shopId || !listingWorkflowId
    || !Number.isSafeInteger(revision) || revision <= 0
    || !Number.isSafeInteger(draftVersion) || draftVersion <= 0 || !operation
    || !prompt || negativePrompt.length > 4000
    || sourceMediaKeys.length < 1 || sourceMediaKeys.length > maximumSources
    || sourceMediaKeys.some((value) => !value)
    || new Set(sourceMediaKeys).size !== sourceMediaKeys.length
    || !/^[a-f0-9]{64}$/.test(attemptId)
    || (operation === 'INPAINT' ? !maskAssetId : maskAssetId !== null)) {
    throw new Error('ERP 图片创建请求无效，请检查图片和指令');
  }
  const result = await client.createWorkflowCommand({
    shopId,
    listingWorkflowId,
    draftRevision: revision,
    draftVersion,
    operation,
    sourceMediaKeys,
    prompt,
    negativePrompt,
    maskAssetId,
    workflowOperationKey: 'extension-media-workflow:' + attemptId.slice(0, 32),
    ...(input.target !== undefined ? { target: input.target } : {}),
  });
  return { result };
}

function getSourceMediaEditorContract() {
  const contract = globalThis.SS_ERP_SOURCE_MEDIA_EDITOR_SESSION;
  if (!contract || typeof contract.normalizeSession !== 'function'
    || typeof contract.normalizeMaskCheckpoint !== 'function'
    || typeof contract.createNonce !== 'function'
    || typeof contract.bindSender !== 'function'
    || typeof contract.isBoundSender !== 'function') {
    throw new Error('ERP 局部重绘会话安全契约不可用');
  }
  return contract;
}

function getSourceMediaEditorCoordinator() {
  if (sourceMediaEditorCoordinator) return sourceMediaEditorCoordinator;
  const factory = globalThis.SS_ERP_SOURCE_MEDIA_EDITOR_COORDINATOR;
  if (!factory || typeof factory.createCoordinator !== 'function') {
    throw new Error('ERP 局部重绘会话编排契约不可用');
  }
  if (!chrome.storage?.session || typeof chrome.storage.session.get !== 'function'
    || typeof chrome.storage.session.set !== 'function') {
    throw new Error('浏览器不支持安全的临时编辑器存储');
  }
  sourceMediaEditorCoordinator = factory.createCoordinator({
    contract: getSourceMediaEditorContract(),
    storage: chrome.storage.session,
    windows: chrome.windows,
    tabs: chrome.tabs,
    runtime: chrome.runtime,
    crypto: globalThis.crypto,
    storageKey: SS_ERP_SOURCE_MEDIA_EDITOR_SESSIONS_KEY,
    ttlMs: SS_ERP_SOURCE_MEDIA_EDITOR_SESSION_TTL_MS,
    submitLeaseMs: SS_ERP_SOURCE_MEDIA_EDITOR_SUBMIT_LEASE_MS,
    minimumSubmitRemainingMs: SS_ERP_SOURCE_MEDIA_EDITOR_SUBMIT_MINIMUM_REMAINING_MS,
    limit: SS_ERP_SOURCE_MEDIA_EDITOR_SESSION_LIMIT,
    launchPath: 'pages/media-confirm-launch.html',
    editorPath: 'pages/media-editor.html',
  });
  return sourceMediaEditorCoordinator;
}

function registerSourceMediaEditorTabCleanup() {
  const lifecycle = globalThis.SS_ERP_SOURCE_MEDIA_EDITOR_LIFECYCLE;
  if (!lifecycle || typeof lifecycle.registerTabCleanup !== 'function') {
    console.warn('[SS ERP] source media editor tab cleanup is unavailable');
    return;
  }
  lifecycle.registerTabCleanup({
    tabs: chrome.tabs,
    getCoordinator: getSourceMediaEditorCoordinator,
    onError(error) {
      console.warn('[SS ERP] source media editor tab cleanup failed', error);
    },
  });
}

registerSourceMediaEditorTabCleanup();

function sourceMediaEditorOpenRequest(value, sender) {
  const allowedKeys = new Set([
    'type', 'sourceProductId', 'platform', 'snapshotId', 'supplyGoodsId', 'shopId',
    'listingWorkflowId', 'revision', 'draftVersion', 'operation', 'sourceMediaKeys',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  const operation = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(value.operation)
    ? value.operation
    : '';
  const maximumSources = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
  const sourceMediaKeys = Array.isArray(value.sourceMediaKeys)
    ? value.sourceMediaKeys.map((key) => sourceWorkflowHandoffText(key, 500))
    : [];
  const request = {
    sourceProductId: sourceWorkflowHandoffText(value.sourceProductId, 200),
    platform: sourceWorkflowPlatform(value.platform),
    snapshotId: sourceWorkflowHandoffText(value.snapshotId, 200),
    supplyGoodsId: sourceWorkflowHandoffText(value.supplyGoodsId, 200),
    shopId: sourceWorkflowHandoffText(value.shopId, 200),
    listingWorkflowId: sourceWorkflowHandoffText(value.listingWorkflowId, 200),
    revision: Number(value.revision),
    draftVersion: Number(value.draftVersion),
    operation,
    sourceMediaKeys,
    sourceTabId: Number(sender?.tab?.id),
  };
  if (!request.sourceProductId || !request.platform || !request.snapshotId
    || !request.supplyGoodsId || !request.shopId || !request.listingWorkflowId
    || !Number.isSafeInteger(request.revision) || request.revision <= 0
    || !Number.isSafeInteger(request.draftVersion) || request.draftVersion <= 0
    || !request.operation
    || request.sourceMediaKeys.length < 1 || request.sourceMediaKeys.length > maximumSources
    || request.sourceMediaKeys.some((key) => !key)
    || new Set(request.sourceMediaKeys).size !== request.sourceMediaKeys.length
    || !Number.isSafeInteger(request.sourceTabId) || request.sourceTabId < 0
    || sender?.frameId !== 0 || !sourceWorkflowHandoffText(sender?.documentId, 200)) return null;
  return request;
}

function sourceMediaEditorCapability(launch, operation, sourceMediaKeys) {
  const capability = launch && launch.contractVersion === 2
    && launch.operations && launch.operations[operation];
  const allowedSourceKeys = new Set(launch && launch.context
    && Array.isArray(launch.context.sourceInputs)
    ? launch.context.sourceInputs.map((item) => item.sourceMediaKey)
    : []);
  const maximumSources = operation === 'IMAGE_TO_IMAGE'
    ? Number(capability && capability.maxReferences)
    : 1;
  if (!launch || launch.state !== 'ready' || launch.contractVersion !== 2
    || !launch.context || !capability || capability.enabled !== true || capability.ready !== true
    || !Number.isSafeInteger(maximumSources) || maximumSources < 1
    || sourceMediaKeys.length > maximumSources
    || sourceMediaKeys.some((key) => !allowedSourceKeys.has(key))
    || (operation === 'INPAINT'
      && capability.maskSemantics !== 'WHITE_EDIT_BLACK_PRESERVE_V1')) {
    throw new Error('当前 AI 图片能力或来源图片已变化，请刷新后重试');
  }
  return capability;
}

function sourceMediaEditorPreparedSnapshot(prepared) {
  if (!prepared || prepared.state !== 'ready' || !prepared.sourceAsset) {
    throw new Error('局部重绘来源图片暂不可用');
  }
  return {
    sourceMediaKey: prepared.sourceMediaKey,
    sourceAssetId: prepared.sourceAsset.id,
    mimeType: prepared.sourceAsset.mimeType,
    width: prepared.sourceAsset.width,
    height: prepared.sourceAsset.height,
    maskSemantics: prepared.maskSemantics,
    maxMaskBytes: prepared.maxMaskBytes,
  };
}

function sameSourceMediaEditorPreparedSource(frozen, prepared) {
  if (!frozen || !prepared) return frozen === null && prepared === null;
  const latest = sourceMediaEditorPreparedSnapshot(prepared);
  return frozen.sourceMediaKey === latest.sourceMediaKey
    && frozen.sourceAssetId === latest.sourceAssetId
    && frozen.mimeType === latest.mimeType
    && frozen.width === latest.width
    && frozen.height === latest.height
    && frozen.maskSemantics === latest.maskSemantics
    && frozen.maxMaskBytes === latest.maxMaskBytes;
}

async function resolveSourceMediaEditorOpenAuthority(request) {
  const handoff = await readPersistedSourceWorkflowHandoff(
    request.platform,
    request.sourceProductId,
  );
  if (!handoff || handoff.sourceProductId !== request.sourceProductId
    || handoff.platform !== request.platform) {
    throw new Error('ERP 局部重绘上下文已变化，请刷新后重试');
  }
  const client = getSourceListingWorkflowClient();
  const current = await client.getStatus({
    snapshotId: handoff.snapshotId,
    supplyGoodsId: handoff.supplyGoodsId,
  });
  const listing = currentSourceListingContext(current, request.listingWorkflowId);
  if (!listing) throw new Error('ERP 商品草稿状态已变化，请刷新后重试');
  const launch = await client.getMediaLaunch({
    snapshotId: handoff.snapshotId,
    supplyGoodsId: handoff.supplyGoodsId,
    ...listing,
  });
  sourceMediaEditorCapability(launch, request.operation, request.sourceMediaKeys);
  if (launch.context.snapshotId !== request.snapshotId
    || launch.context.supplyGoodsId !== request.supplyGoodsId
    || launch.context.shopId !== request.shopId
    || launch.context.id !== request.listingWorkflowId
    || launch.context.revision !== request.revision
    || launch.context.draftVersion !== request.draftVersion) {
    throw new Error('ERP 商品草稿已变化，请刷新后重试');
  }
  const prepared = request.operation === 'INPAINT'
    ? await client.prepareMediaEditSource({
      snapshotId: launch.context.snapshotId,
      supplyGoodsId: launch.context.supplyGoodsId,
      shopId: launch.context.shopId,
      listingWorkflowId: launch.context.id,
      revision: launch.context.revision,
      draftVersion: launch.context.draftVersion,
      sourceMediaKey: request.sourceMediaKeys[0],
    })
    : null;
  const preparedSource = prepared ? sourceMediaEditorPreparedSnapshot(prepared) : null;
  return { handoff, client, listing, launch, prepared, preparedSource };
}

async function openSourceMediaEditor(request) {
  const authority = await resolveSourceMediaEditorOpenAuthority(request);
  const context = authority.launch.context;
  return getSourceMediaEditorCoordinator().open({
    platform: request.platform,
    sourceProductId: request.sourceProductId,
    snapshotId: context.snapshotId,
    supplyGoodsId: context.supplyGoodsId,
    shopId: context.shopId,
    listingWorkflowId: context.id,
    revision: context.revision,
    draftVersion: context.draftVersion,
    operation: request.operation,
    sourceMediaKeys: [...request.sourceMediaKeys],
    preparedSource: authority.preparedSource,
    sourceTabId: request.sourceTabId,
  });
}

async function loadFrozenSourceMediaEditorAuthority(session, preparingErpSource = false) {
  if (session.erpSourceAuthority) {
    if (!globalThis.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH?.normalizeEditorTarget(session.target)) {
      throw new Error('ERP 图片编辑缺少冻结槽位，请从当前草稿重新打开');
    }
    await assertErpSourceDeviceAuthority(session.erpSourceAuthority);
  } else {
    if (preparingErpSource) throw new Error('ERP 图片编辑授权不可用');
    const handoff = await readPersistedSourceWorkflowHandoff(session.platform, session.sourceProductId);
    if (!handoff || handoff.sourceProductId !== session.sourceProductId
      || handoff.platform !== session.platform || handoff.snapshotId !== session.snapshotId
      || handoff.supplyGoodsId !== session.supplyGoodsId) {
      throw new Error('ERP 局部重绘上下文已变化，请从商品页重新发起');
    }
  }
  const client = getSourceListingWorkflowClient();
  const current = await client.getStatus({
    snapshotId: session.snapshotId,
    supplyGoodsId: session.supplyGoodsId,
  });
  const listing = currentSourceListingContext(current, session.listingWorkflowId);
  if (!listing || listing.shopId !== session.shopId
    || listing.revision !== session.revision
    || listing.draftVersion !== session.draftVersion) {
    throw new Error('ERP 商品草稿已变化，请从商品页重新发起');
  }
  const launch = await client.getMediaLaunch({
    snapshotId: session.snapshotId,
    supplyGoodsId: session.supplyGoodsId,
    shopId: session.shopId,
    listingWorkflowId: session.listingWorkflowId,
    revision: session.revision,
    draftVersion: session.draftVersion,
  });
  sourceMediaEditorCapability(launch, session.operation, session.sourceMediaKeys);
  const context = launch.context;
  if (context.snapshotId !== session.snapshotId
    || context.supplyGoodsId !== session.supplyGoodsId
    || context.shopId !== session.shopId
    || context.id !== session.listingWorkflowId
    || context.revision !== session.revision
    || context.draftVersion !== session.draftVersion) {
    throw new Error('ERP 局部重绘授权已变化，请从商品页重新发起');
  }
  const prepared = session.operation === 'INPAINT'
    ? await client.prepareMediaEditSource({
      snapshotId: session.snapshotId,
      supplyGoodsId: session.supplyGoodsId,
      shopId: session.shopId,
      listingWorkflowId: session.listingWorkflowId,
      revision: session.revision,
      draftVersion: session.draftVersion,
      sourceMediaKey: session.sourceMediaKeys[0],
      ...(session.target ? { target: session.target } : {}),
    })
    : null;
  if (!preparingErpSource && !sameSourceMediaEditorPreparedSource(session.preparedSource, prepared)) {
    throw new Error('局部重绘来源图片已变化，请从商品页重新发起');
  }
  if (session.erpSourceAuthority) await assertErpSourceDeviceAuthority(session.erpSourceAuthority);
  return { client, listing, launch, prepared };
}

async function readSourceMediaEditor(nonce, sender) {
  const session = await getSourceMediaEditorCoordinator().claim(nonce, sender);
  if (!session) throw new Error('局部重绘会话已失效，请从商品页重新发起');
  const authority = await loadFrozenSourceMediaEditorAuthority(session);
  return {
    operation: session.operation,
    sourceMediaKeys: session.sourceMediaKeys,
    ...(session.target ? { target: session.target } : {}),
    expiresAt: session.expiresAt,
    completed: session.completion !== null,
    completion: session.completion,
    source: authority.prepared ? {
      url: authority.prepared.sourceAsset.url,
      mimeType: authority.prepared.sourceAsset.mimeType,
      width: authority.prepared.sourceAsset.width,
      height: authority.prepared.sourceAsset.height,
      maskSemantics: authority.prepared.maskSemantics,
      maxMaskBytes: authority.prepared.maxMaskBytes,
    } : null,
  };
}

async function sourceMediaMaskSha256(maskDataUrl) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(maskDataUrl),
  );
  return Array.from(new Uint8Array(digest)).map((byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
}

async function submitSourceMediaEditor(message, sender) {
  const operation = ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(message?.operation)
    ? message.operation
    : '';
  const allowedKeys = new Set([
    'type', 'nonce', 'operation', 'prompt', 'negativePrompt',
    ...(operation === 'INPAINT' ? ['maskDataUrl'] : []),
  ]);
  const prompt = sourceWorkflowHandoffText(message?.prompt, 8000);
  const negativePrompt = String(message?.negativePrompt == null ? '' : message.negativePrompt)
    .normalize('NFKC').trim();
  if (!message || Object.keys(message).some((key) => !allowedKeys.has(key))
    || !operation || typeof message.prompt !== 'string'
    || typeof message.negativePrompt !== 'string'
    || !prompt || negativePrompt.length > 4000
    || (operation === 'INPAINT' && (typeof message.maskDataUrl !== 'string'
      || message.maskDataUrl.length > 30 * 1024 * 1024))) {
    throw new Error('AI 图片任务提交请求无效');
  }
  const coordinator = getSourceMediaEditorCoordinator();
  const outcome = await coordinator.submit(
    message.nonce,
    sender,
    async (session, saveMaskCheckpoint) => {
      if (session.operation !== operation) {
        throw new Error('AI 图片编辑器操作已变化，请重新打开');
      }
      const authority = await loadFrozenSourceMediaEditorAuthority(session);
      let maskAssetId = null;
      if (session.operation === 'INPAINT') {
        if (typeof message.maskDataUrl !== 'string') {
          throw new Error('局部重绘遮罩请求无效');
        }
        const maskSha256 = await sourceMediaMaskSha256(message.maskDataUrl);
        maskAssetId = session.maskCheckpoint
          && session.maskCheckpoint.maskSha256 === maskSha256
          ? session.maskCheckpoint.maskAssetId
          : '';
        if (!maskAssetId) {
          const uploaded = await authority.client.uploadMediaEditMask({
            snapshotId: session.snapshotId,
            supplyGoodsId: session.supplyGoodsId,
            shopId: session.shopId,
            listingWorkflowId: session.listingWorkflowId,
            revision: session.revision,
            draftVersion: session.draftVersion,
            sourceMediaKey: session.sourceMediaKeys[0],
            ...(session.target ? { target: session.target } : {}),
            maskSemantics: authority.prepared.maskSemantics,
            maskDataUrl: message.maskDataUrl,
            expectedWidth: authority.prepared.sourceAsset.width,
            expectedHeight: authority.prepared.sourceAsset.height,
            maxMaskBytes: authority.prepared.maxMaskBytes,
          });
          if (!uploaded || uploaded.state !== 'ready') {
            throw new Error('局部重绘遮罩上传失败');
          }
          const checkpointed = await saveMaskCheckpoint({
            maskSha256,
            maskAssetId: uploaded.maskAssetId,
          });
          maskAssetId = checkpointed.maskCheckpoint.maskAssetId;
        }
      }
      const created = await executeSourceMediaCreateWorkflow({
        client: authority.client,
        shopId: session.shopId,
        listingWorkflowId: session.listingWorkflowId,
        revision: session.revision,
        draftVersion: session.draftVersion,
        operation: session.operation,
        sourceMediaKeys: session.sourceMediaKeys,
        ...(session.target ? { target: session.target } : {}),
        prompt,
        negativePrompt,
        maskAssetId,
        attemptId: session.nonce,
      });
      const completion = created.result.result;
      return {
        replay: created.result.replay === true,
        result: {
          workflowId: completion.workflowId,
          operation: completion.operation,
          status: completion.status,
          revision: completion.revision,
        },
      };
    },
  );
  const session = await coordinator.read(message.nonce);
  if (session && outcome.state === 'completed') {
    try {
      await chrome.tabs.sendMessage(session.sourceTabId, {
        type: 'ss-erp:source-listing-workbench-media-confirmed',
        platform: session.platform,
        sourceProductId: session.sourceProductId,
        listingWorkflowId: session.listingWorkflowId,
        resultKind: 'TASK_QUEUED',
      });
    } catch {}
  }
  return outcome;
}

async function cancelSourceMediaEditor(nonce, sender) {
  return getSourceMediaEditorCoordinator().cancel(nonce, sender);
}

async function loadBoundedSourceMediaHistoryItem(client, handoff, listing, mediaWorkflowId) {
  let beforeCursor = null;
  const seenCursors = new Set();
  for (let page = 0; page < SS_ERP_SOURCE_MEDIA_MUTATION_HISTORY_MAX_PAGES; page += 1) {
    const result = await client.getMediaHistory({
      snapshotId: handoff.snapshotId,
      supplyGoodsId: handoff.supplyGoodsId,
      shopId: listing.shopId,
      listingWorkflowId: listing.listingWorkflowId,
      revision: listing.revision,
      draftVersion: listing.draftVersion,
      limit: SS_ERP_SOURCE_MEDIA_MUTATION_HISTORY_PAGE_LIMIT,
      beforeCursor,
    });
    if (!result || result.state !== 'ready' || !result.history) {
      throw new Error('ERP 媒体历史暂不可用');
    }
    const item = result.history.items.find((candidate) => candidate.id === mediaWorkflowId);
    if (item) return item;
    const nextCursor = result.history.nextCursor;
    if (!nextCursor) return null;
    if (seenCursors.has(nextCursor)) throw new Error('ERP 媒体历史游标重复');
    seenCursors.add(nextCursor);
    beforeCursor = nextCursor;
  }
  throw new Error('ERP 媒体任务超出安全读取范围，请在 ERP 中处理');
}

function getSourceMediaConfirmationContract() {
  const contract = globalThis.SS_ERP_SOURCE_MEDIA_CONFIRMATION;
  if (!contract || typeof contract.createNonce !== 'function'
    || typeof contract.isNonce !== 'function'
    || typeof contract.normalizeIntent !== 'function'
    || typeof contract.publicConfirmation !== 'function'
    || typeof contract.createSerialQueue !== 'function'
    || typeof contract.bindSender !== 'function'
    || typeof contract.isBoundSender !== 'function') {
    throw new Error('ERP 媒体确认安全契约不可用');
  }
  return contract;
}

function getSourceMediaConfirmationCoordinator() {
  if (sourceMediaConfirmationCoordinator) return sourceMediaConfirmationCoordinator;
  const factory = globalThis.SS_ERP_SOURCE_MEDIA_CONFIRMATION_COORDINATOR;
  if (!factory || typeof factory.createCoordinator !== 'function') {
    throw new Error('ERP 媒体确认编排契约不可用');
  }
  if (!chrome.storage?.session || typeof chrome.storage.session.get !== 'function'
    || typeof chrome.storage.session.set !== 'function') {
    throw new Error('浏览器不支持安全的临时确认存储');
  }
  sourceMediaConfirmationCoordinator = factory.createCoordinator({
    contract: getSourceMediaConfirmationContract(),
    storage: chrome.storage.session,
    windows: chrome.windows,
    tabs: chrome.tabs,
    runtime: chrome.runtime,
    crypto: globalThis.crypto,
    storageKey: SS_ERP_SOURCE_MEDIA_CONFIRMATIONS_KEY,
    ttlMs: SS_ERP_SOURCE_MEDIA_CONFIRMATION_TTL_MS,
    limit: SS_ERP_SOURCE_MEDIA_CONFIRMATION_LIMIT,
  });
  return sourceMediaConfirmationCoordinator;
}

function sourceMediaMutationRequest(value) {
  const action = ['REVIEW_APPROVE', 'REVIEW_REJECT', 'APPLY_APPEND'].includes(value && value.action)
    ? value.action
    : '';
  const request = {
    sourceProductId: sourceWorkflowHandoffText(value && value.sourceProductId, 200),
    platform: sourceWorkflowPlatform(value && value.platform),
    listingWorkflowId: sourceWorkflowHandoffText(value && value.listingWorkflowId, 200),
    mediaWorkflowId: sourceWorkflowHandoffText(value && value.mediaWorkflowId, 200),
    outputAssetId: sourceWorkflowHandoffText(value && value.outputAssetId, 200),
    expectedWorkflowRevision: Number(value && value.expectedRevision),
    action,
  };
  if (!request.sourceProductId || !request.platform || !request.listingWorkflowId
    || !request.mediaWorkflowId || !request.outputAssetId || !request.action
    || !Number.isSafeInteger(request.expectedWorkflowRevision)
    || request.expectedWorkflowRevision <= 0) return null;
  return request;
}

function assertSourceMediaMutationItem(item, request) {
  const output = item && Array.isArray(item.outputs)
    ? item.outputs.find((candidate) => candidate.id === request.outputAssetId)
    : null;
  if (!item || item.id !== request.mediaWorkflowId
    || item.revision !== request.expectedWorkflowRevision
    || item.status !== 'SUCCEEDED' || !output) {
    throw new Error('ERP 媒体结果已变化，请刷新后重试');
  }
  if (request.action === 'REVIEW_APPROVE' || request.action === 'REVIEW_REJECT') {
    if (item.reviewStatus !== 'PENDING' || item.application !== null) {
      throw new Error('ERP 媒体结果已不再等待审核');
    }
  } else if (item.reviewStatus !== 'APPROVED'
    || item.selectedOutputAssetId !== request.outputAssetId
    || item.application !== null) {
    throw new Error('ERP 媒体结果尚未通过审核或已写入草稿');
  }
  return output;
}

async function loadSourceMediaMutationAuthority(request) {
  const handoff = await readPersistedSourceWorkflowHandoff(
    request.platform,
    request.sourceProductId,
  );
  if (!handoff || handoff.sourceProductId !== request.sourceProductId
    || handoff.platform !== request.platform) {
    throw new Error('ERP 媒体确认上下文无效，请刷新后重试');
  }
  const client = getSourceListingWorkflowClient();
  const current = await client.getStatus({
    snapshotId: handoff.snapshotId,
    supplyGoodsId: handoff.supplyGoodsId,
  });
  const listing = currentSourceListingContext(current, request.listingWorkflowId);
  if (!listing) throw new Error('ERP 商品草稿状态已变化，请刷新后重试');
  const item = await loadBoundedSourceMediaHistoryItem(
    client,
    handoff,
    listing,
    request.mediaWorkflowId,
  );
  const output = assertSourceMediaMutationItem(item, request);
  return { handoff, client, listing, item, output };
}

async function openSourceMediaConfirmation(request, sender) {
  const sourceTabId = Number(sender?.tab?.id);
  if (!Number.isSafeInteger(sourceTabId) || sourceTabId < 0) {
    throw new Error('ERP 媒体确认来源标签页无效');
  }
  const authority = await loadSourceMediaMutationAuthority(request);
  return getSourceMediaConfirmationCoordinator().open({
    platform: request.platform,
    sourceProductId: request.sourceProductId,
    snapshotId: authority.handoff.snapshotId,
    listingWorkflowId: authority.listing.listingWorkflowId,
    shopId: authority.listing.shopId,
    mediaWorkflowId: authority.item.id,
    outputAssetId: authority.output.id,
    action: request.action,
    operation: authority.item.operation,
    expectedWorkflowRevision: authority.item.revision,
    expectedTargetRevision: authority.listing.revision,
    expectedTargetDraftVersion: authority.listing.draftVersion,
    preview: {
      url: authority.output.url,
      mimeType: authority.output.mimeType,
      width: authority.output.width,
      height: authority.output.height,
    },
    sourceTabId,
  });
}

async function executeConfirmedSourceMediaMutation(confirmation) {
  const handoff = await readPersistedSourceWorkflowHandoff(
    confirmation.platform,
    confirmation.sourceProductId,
  );
  if (!handoff || handoff.sourceProductId !== confirmation.sourceProductId
    || handoff.platform !== confirmation.platform
    || handoff.snapshotId !== confirmation.snapshotId) {
    throw new Error('ERP 媒体确认上下文已过期');
  }
  const client = getSourceListingWorkflowClient();
  const current = await client.getStatus({
    snapshotId: handoff.snapshotId,
    supplyGoodsId: handoff.supplyGoodsId,
  });
  const listing = currentSourceListingContext(current, confirmation.listingWorkflowId);
  if (!listing || listing.shopId !== confirmation.shopId
    || listing.revision < confirmation.expectedTargetRevision
    || listing.draftVersion < confirmation.expectedTargetDraftVersion) {
    throw new Error('ERP 商品草稿状态已变化，请刷新后重试');
  }
  const mutationIdentity = sourceMediaMutationIntentIdentity({
    ...confirmation,
    expectedWorkflowRevision: confirmation.expectedWorkflowRevision,
  });
  const existingIntent = await readSourceMediaMutationIntent(mutationIdentity);
  if (existingIntent) {
    if (existingIntent.snapshotId !== confirmation.snapshotId
      || existingIntent.listingWorkflowId !== confirmation.listingWorkflowId
      || existingIntent.shopId !== confirmation.shopId
      || existingIntent.expectedTargetRevision !== confirmation.expectedTargetRevision
      || existingIntent.expectedTargetDraftVersion !== confirmation.expectedTargetDraftVersion) {
      throw new Error('ERP 媒体结果操作意图上下文冲突');
    }
    return executeSourceMediaMutationIntent(client, existingIntent);
  }
  const item = await loadBoundedSourceMediaHistoryItem(
    client,
    handoff,
    listing,
    confirmation.mediaWorkflowId,
  );
  assertSourceMediaMutationItem(item, {
    mediaWorkflowId: confirmation.mediaWorkflowId,
    outputAssetId: confirmation.outputAssetId,
    action: confirmation.action,
    expectedWorkflowRevision: confirmation.expectedWorkflowRevision,
  });
  const intent = await getOrCreateSourceMediaMutationIntent({
    platform: confirmation.platform,
    sourceProductId: confirmation.sourceProductId,
    snapshotId: confirmation.snapshotId,
    listingWorkflowId: confirmation.listingWorkflowId,
    shopId: confirmation.shopId,
    mediaWorkflowId: confirmation.mediaWorkflowId,
    outputAssetId: confirmation.outputAssetId,
    action: confirmation.action,
    expectedWorkflowRevision: confirmation.expectedWorkflowRevision,
    expectedTargetRevision: confirmation.expectedTargetRevision,
    expectedTargetDraftVersion: confirmation.expectedTargetDraftVersion,
  });
  return executeSourceMediaMutationIntent(client, intent);
}

async function submitSourceMediaConfirmation(nonce, sender) {
  const outcome = await getSourceMediaConfirmationCoordinator().submit(
    nonce,
    sender,
    executeConfirmedSourceMediaMutation,
  );
  if (outcome.completedNow) {
    try {
      await chrome.tabs.sendMessage(outcome.confirmation.sourceTabId, {
        type: 'ss-erp:source-listing-workbench-media-confirmed',
        platform: outcome.confirmation.platform,
        sourceProductId: outcome.confirmation.sourceProductId,
        listingWorkflowId: outcome.confirmation.listingWorkflowId,
        resultKind: 'MUTATION_COMPLETED',
      });
    } catch {}
  }
  return { state: outcome.state, replay: outcome.replay };
}

async function cancelSourceMediaConfirmation(nonce, sender) {
  return getSourceMediaConfirmationCoordinator().cancel(nonce, sender);
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

function packagedErpBridgeRegistration() {
  const manifest = chrome.runtime.getManifest();
  return (manifest.content_scripts || []).find((entry) => (
    Array.isArray(entry.js)
    && entry.js.includes('content/erp-collect-bridge.js')
  )) || null;
}

async function injectErpBridgeIntoOpenTabs() {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function'
    || !chrome.scripting || typeof chrome.scripting.executeScript !== 'function') return;
  const registration = packagedErpBridgeRegistration();
  const matches = registration && Array.isArray(registration.matches)
    ? registration.matches.filter((value) => /^https?:\/\//u.test(String(value || '')))
    : [];
  if (!matches.length) return;
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.allSettled((tabs || []).filter((tab) => tab && Number.isInteger(tab.id)).map((tab) => (
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        'shared/erp-adapter/deployment-defaults.js',
        'content/erp-collect-bridge.js',
      ],
    })
  )));
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
  injectErpBridgeIntoOpenTabs().catch(() => {});
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

async function clearRuntimeOzonCompanyIdForSync() {
  globalThis.SS_ERP_OZON_COMPANY_ID_CAPTURE = null;
  if (!chrome.storage || !chrome.storage.session
    || typeof chrome.storage.session.remove !== 'function') return;
  await chrome.storage.session.remove([
    OZON_SYNC_SESSION_COMPANY_ID_KEY,
    OZON_SYNC_SESSION_COMPANY_ID_CAPTURED_AT_KEY,
  ]).catch(() => {});
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

async function readOzonCdnAuthForSync(shopId) {
  return readExtensionDeviceOzonCdnAuth(shopId);
}

async function writeOzonCdnAuthForSync(shopId, payload, options) {
  const normalizedShopId = deviceShopIdentifier(shopId);
  if (!normalizedShopId) throw new Error('店铺 ID 无效');
  const writeEpoch = ozonCdnWriteEpochs.get(normalizedShopId) || 0;
  return enqueueOzonCdnWrite(normalizedShopId, async (sessionId) => {
    const requestSha256 = await ozonCdnWriteRequestSha256(payload);
    const guard = await prepareOzonCdnWriteGuard(
      normalizedShopId,
      sessionId,
      requestSha256,
      options && options.automatic === true,
      writeEpoch,
    );
    let result;
    try {
      result = await writeExtensionDeviceOzonCdnAuth(
        normalizedShopId,
        payload,
        sessionId,
      );
    } catch (error) {
      result = {
        ok: false,
        errorCode: 'device_cookie_write_outcome_unknown',
        error: error && error.message ? error.message : '设备 Cookie 写入结果未知',
        outcome: 'UNKNOWN_OUTCOME',
        automaticRetryAllowed: false,
        guardSessionId: sessionId,
      };
    }
    return requireOzonCdnWriteSuccess(
      normalizedShopId,
      sessionId,
      requestSha256,
      guard.preexisting,
      result,
    );
  });
}

async function fetchStoredOzonCompanyIdForSync(shopId) {
  const result = await readOzonCdnAuthForSync(shopId);
  return normalizeOzonCompanyIdForSync(result && result.ok && result.data && result.data.companyId);
}

function ozonCdnWriteError(result) {
  const error = new Error(result && result.error || '同步店铺 Cookie 失败');
  error.errorCode = result && result.errorCode || 'device_cookie_write_failed';
  if (result && result.outcome) error.outcome = result.outcome;
  if (result && result.automaticRetryAllowed === false) error.automaticRetryAllowed = false;
  return error;
}

function publicOzonSyncError(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error),
    ...(error && error.errorCode ? { errorCode: error.errorCode } : {}),
    ...(error && error.outcome ? { outcome: error.outcome } : {}),
    ...(error && error.automaticRetryAllowed === false ? { automaticRetryAllowed: false } : {}),
  };
}

async function ozonCdnWriteRequestSha256(payload) {
  const normalized = {
    cookie: payload && typeof payload.cookie === 'string' ? payload.cookie : null,
    companyId: payload && payload.companyId != null ? String(payload.companyId) : null,
  };
  if (payload && payload.clearCookie === true) normalized.clearCookie = true;
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
}

async function enqueueOzonCdnWrite(shopId, task) {
  const key = shopId;
  const previous = ozonCdnWriteQueues.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(async () => {
    const status = await getLogisticsDeviceCredentials().getStatus();
    const sessionId = status && status.state === 'paired'
      ? deviceShopIdentifier(status.sessionId)
      : null;
    if (!sessionId) throw ozonCdnWriteError({
      errorCode: 'device_unpaired',
      error: '设备未配对',
    });
    return task(sessionId);
  });
  let tail;
  tail = run.catch(() => {}).finally(() => {
    if (ozonCdnWriteQueues.get(key) === tail) ozonCdnWriteQueues.delete(key);
  });
  ozonCdnWriteQueues.set(key, tail);
  return run;
}

function ozonCdnWriteGuardError(message) {
  const error = new Error(message);
  error.errorCode = 'device_cookie_write_guard_unavailable';
  error.outcome = 'UNKNOWN_OUTCOME';
  error.automaticRetryAllowed = false;
  return error;
}

function normalizeOzonCdnWriteGuard(guard) {
  if (!guard || typeof guard !== 'object') return null;
  const shopId = deviceShopIdentifier(guard.shopId);
  const sessionId = deviceShopIdentifier(guard.sessionId);
  const requestSha256 = toText(guard.requestSha256).trim().toLowerCase();
  const createdAt = toText(guard.createdAt).trim();
  if (
    !shopId
    || !sessionId
    || !/^[a-f0-9]{64}$/.test(requestSha256)
    || guard.outcome !== 'UNKNOWN_OUTCOME'
    || !createdAt
    || createdAt.length > 64
  ) return null;
  return { shopId, sessionId, requestSha256, outcome: 'UNKNOWN_OUTCOME', createdAt };
}

function ozonCdnWriteGuardKey(guard) {
  return `${guard.sessionId}\n${guard.shopId}`;
}

function normalizeOzonCdnWriteGuards(value, source) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw ozonCdnWriteGuardError(`设备 Cookie UNKNOWN guard ${source} 格式无效`);
  }
  const guards = value.map(normalizeOzonCdnWriteGuard);
  if (guards.some((guard) => !guard)) {
    throw ozonCdnWriteGuardError(`设备 Cookie UNKNOWN guard ${source} 包含无效记录`);
  }
  return guards;
}

function replaceOzonCdnMemoryGuards(guards) {
  ozonCdnMemoryGuards.clear();
  guards.forEach((guard) => {
    ozonCdnMemoryGuards.set(ozonCdnWriteGuardKey(guard), guard);
  });
}

function ozonCdnLocalGuardStorage() {
  const area = chrome.storage && chrome.storage.local;
  if (
    !area
    || typeof area.get !== 'function'
    || typeof area.set !== 'function'
    || typeof area.remove !== 'function'
  ) throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 本地存储不可用');
  return area;
}

function mergeOzonCdnWriteGuard(guards, guard) {
  const key = ozonCdnWriteGuardKey(guard);
  const existing = guards.get(key);
  if (existing && existing.requestSha256 !== guard.requestSha256) {
    throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 存在冲突请求');
  }
  guards.set(key, existing || guard);
}

async function readOzonCdnWriteGuards(activeSessionId) {
  const sessionId = deviceShopIdentifier(activeSessionId);
  if (!sessionId) throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 会话无效');
  let stored;
  try {
    stored = await ozonCdnLocalGuardStorage().get([SS_ERP_OZON_CDN_WRITE_GUARDS_KEY]);
  } catch (_error) {
    throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 无法读取');
  }
  const persisted = normalizeOzonCdnWriteGuards(
    stored && stored[SS_ERP_OZON_CDN_WRITE_GUARDS_KEY],
    'local',
  ).filter((guard) => guard.sessionId === sessionId);
  const guards = new Map();
  persisted.forEach((guard) => mergeOzonCdnWriteGuard(guards, guard));
  Array.from(ozonCdnMemoryGuards.values())
    .filter((guard) => guard.sessionId === sessionId)
    .forEach((guard) => mergeOzonCdnWriteGuard(guards, guard));
  if (guards.size > SS_ERP_OZON_CDN_WRITE_GUARD_MAX) {
    throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 超出授权店铺上限');
  }
  return Array.from(guards.values());
}

async function writeOzonCdnWriteGuards(value) {
  const guards = normalizeOzonCdnWriteGuards(value, 'memory');
  const unique = new Map();
  guards.forEach((guard) => mergeOzonCdnWriteGuard(unique, guard));
  if (unique.size > SS_ERP_OZON_CDN_WRITE_GUARD_MAX) {
    throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 超出授权店铺上限');
  }
  const canonical = Array.from(unique.values());
  try {
    const area = ozonCdnLocalGuardStorage();
    if (canonical.length) {
      await area.set({ [SS_ERP_OZON_CDN_WRITE_GUARDS_KEY]: canonical });
    } else {
      await area.remove([SS_ERP_OZON_CDN_WRITE_GUARDS_KEY]);
    }
  } catch (_error) {
    throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 无法持久化');
  }
  replaceOzonCdnMemoryGuards(canonical);
}

function mutateOzonCdnWriteGuards(activeSessionId, mutator) {
  const run = ozonCdnGuardStorageQueue.catch(() => {}).then(async () => {
    const current = await readOzonCdnWriteGuards(activeSessionId);
    const mutation = mutator(current);
    await writeOzonCdnWriteGuards(mutation.guards);
    return mutation.value;
  });
  ozonCdnGuardStorageQueue = run.catch(() => {});
  return run;
}

async function prepareOzonCdnWriteGuard(
  shopId,
  sessionId,
  requestSha256,
  automatic,
  writeEpoch,
) {
  const normalizedShopId = deviceShopIdentifier(shopId);
  const operationSessionId = deviceShopIdentifier(sessionId);
  if (!normalizedShopId || !operationSessionId || !/^[a-f0-9]{64}$/.test(requestSha256)) {
    throw ozonCdnWriteGuardError('设备 Cookie UNKNOWN guard 输入无效');
  }
  const currentEpoch = ozonCdnWriteEpochs.get(normalizedShopId) || 0;
  if (currentEpoch !== writeEpoch) {
    const error = new Error('设备 Cookie 写入队列已被未知结果中止，请重新发起手动同步');
    error.errorCode = 'device_cookie_write_queue_superseded';
    error.outcome = 'UNKNOWN_OUTCOME';
    error.automaticRetryAllowed = false;
    throw error;
  }
  return mutateOzonCdnWriteGuards(operationSessionId, (guards) => {
    const activeGuard = guards.find((guard) => guard.shopId === normalizedShopId) || null;
    if (activeGuard) {
      if (!automatic && activeGuard.requestSha256 === requestSha256) {
        return { guards, value: { preexisting: true } };
      }
      const error = new Error(automatic
        ? '上次设备 Cookie 写入结果未知，已停止后台自动重试；请手动同步相同内容确认'
        : '上次设备 Cookie 写入结果未知，只允许手动重试相同内容或重新配对');
      error.errorCode = 'device_cookie_write_blocked_unknown';
      error.outcome = 'UNKNOWN_OUTCOME';
      error.automaticRetryAllowed = false;
      throw error;
    }
    const next = guards.concat({
      shopId: normalizedShopId,
      sessionId: operationSessionId,
      requestSha256,
      outcome: 'UNKNOWN_OUTCOME',
      createdAt: new Date().toISOString(),
    });
    return { guards: next, value: { preexisting: false } };
  });
}

async function clearOzonCdnWriteGuard(shopId, sessionId, requestSha256) {
  const normalizedShopId = deviceShopIdentifier(shopId);
  if (!normalizedShopId) return;
  await mutateOzonCdnWriteGuards(sessionId, (guards) => ({
    guards: guards.filter((guard) => (
      guard.shopId !== normalizedShopId
      || guard.requestSha256 !== requestSha256
    )),
    value: undefined,
  }));
}

function advanceOzonCdnWriteEpoch(shopId) {
  const normalizedShopId = deviceShopIdentifier(shopId) || shopId;
  ozonCdnWriteEpochs.set(
    normalizedShopId,
    (ozonCdnWriteEpochs.get(normalizedShopId) || 0) + 1,
  );
}

async function requireOzonCdnWriteSuccess(
  shopId,
  sessionId,
  requestSha256,
  preexisting,
  result,
) {
  if (result && result.ok) {
    try {
      await clearOzonCdnWriteGuard(shopId, sessionId, requestSha256);
    } catch (error) {
      advanceOzonCdnWriteEpoch(shopId);
      throw error;
    }
    return result;
  }
  if (result && result.outcome === 'UNKNOWN_OUTCOME') {
    advanceOzonCdnWriteEpoch(shopId);
  } else if (!preexisting) {
    try {
      await clearOzonCdnWriteGuard(shopId, sessionId, requestSha256);
    } catch (error) {
      advanceOzonCdnWriteEpoch(shopId);
      throw error;
    }
  }
  throw ozonCdnWriteError(result);
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

async function readOzonShopsForAutoSync() {
  const deviceResult = await readExtensionDeviceOzonShops();
  if (deviceResult && deviceResult.ok) return deviceResult.data || [];
  throw new Error(deviceResult && deviceResult.error || '设备店铺读取失败');
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

async function resolveOzonAutoSyncShop(companyId, options) {
  const storage = await chrome.storage.local.get(['ss_erp_cookie_shop', 'ss_erp_selected_shop']);
  const shops = await readOzonShopsForAutoSync();
  const normalizedCompanyId = normalizeOzonCompanyIdForSync(companyId);
  const matches = normalizedCompanyId
    ? shops.filter((shop) => shopMatchesOzonCompanyId(shop, normalizedCompanyId))
    : [];
  if (matches.length === 1 && matches[0].id) {
    const matched = matches[0];
    await chrome.storage.local.set({ ss_erp_cookie_shop: matched.id, ss_erp_selected_shop: matched.id });
    return matched;
  }
  if (normalizedCompanyId) return null;
  if (options && options.requireCompanyMatch === true) return null;
  const fallbackId = toText(storage.ss_erp_cookie_shop || storage.ss_erp_selected_shop).trim();
  const fallback = fallbackId ? shops.find((shop) => shop.id === fallbackId) : null;
  return fallback || (shops.length === 1 ? shops[0] : null);
}

async function updateOzonSyncTimes(patch) {
  try {
    const current = await chrome.storage.local.get([SS_ERP_SYNC_TIMES_KEY]);
    const times = current[SS_ERP_SYNC_TIMES_KEY] && typeof current[SS_ERP_SYNC_TIMES_KEY] === 'object'
      ? current[SS_ERP_SYNC_TIMES_KEY]
      : {};
    await chrome.storage.local.set({ [SS_ERP_SYNC_TIMES_KEY]: { ...times, ...patch } });
    return true;
  } catch (_error) {
    return false;
  }
}

async function syncOzonCookieToShopForSync(shopId, options) {
  const normalizedShopId = toText(shopId).trim();
  if (!normalizedShopId) throw new Error('缺少 shopId，请先选择目标店铺');
  const [cookies, tabCookieStr, tabCompanyId, authCookieState] = await Promise.all([
    getOzonSellerCookiesForSync(),
    readOzonSellerCookieStringFromOpenTabForSync(),
    readOzonSellerCookieValueFromOpenTabForSync('sc_company_id'),
    options && options.clearIfMissingAuth === true
      ? hasCurrentOzonSellerAuthCookieForSync()
      : Promise.resolve(null),
  ]);
  const cookieStr = mergeCookieStringsForSync(cookieStringFromOzonCookiesForSync(cookies), tabCookieStr);

  const payloadCompanyId = normalizeOzonCompanyIdForSync(options && options.companyId);
  const cookieCompanyId = findOzonCompanyIdFromCookies(cookies);
  const [capturedCompanyId, storedCompanyId] = await Promise.all([
    getCapturedOzonCompanyIdForSync(),
    fetchStoredOzonCompanyIdForSync(normalizedShopId),
  ]);
  const preferStoredCompanyId = options && options.useStoredCompanyId === true;
  const automatic = options && options.automatic === true;
  const requireCompanyMatch = automatic || (options && options.requireCompanyMatch === true);
  const clearCookie = options && options.clearIfMissingAuth === true && authCookieState === false;
  const liveCompanyIds = [tabCompanyId, cookieCompanyId]
    .map(normalizeOzonCompanyIdForSync)
    .filter((value, index, values) => value && values.indexOf(value) === index);
  if (clearCookie && (
    !payloadCompanyId
    || !storedCompanyId
    || payloadCompanyId !== storedCompanyId
  )) {
    const error = new Error('当前 seller 店铺与 ERP 店铺绑定不一致，已停止 Cookie 撤销');
    error.errorCode = 'ozon_company_binding_mismatch';
    throw error;
  }
  if (!clearCookie && requireCompanyMatch && (
    !payloadCompanyId
    || liveCompanyIds.length === 0
    || liveCompanyIds.some((value) => value !== payloadCompanyId)
  )) {
    const error = new Error('当前 seller 店铺与已解析的 ERP 店铺不一致，已停止自动同步');
    error.errorCode = 'ozon_company_binding_mismatch';
    throw error;
  }
  const companyIdCandidates = requireCompanyMatch
    ? [payloadCompanyId]
    : preferStoredCompanyId
      ? [storedCompanyId, payloadCompanyId, tabCompanyId, capturedCompanyId, cookieCompanyId]
      : [tabCompanyId, payloadCompanyId, capturedCompanyId, cookieCompanyId, storedCompanyId];
  const companyId = companyIdCandidates.find((value) => normalizeOzonCompanyIdForSync(value)) || '';
  if (!clearCookie && !cookieStr) {
    throw new Error('未检测到 seller.ozon.ru 登录态，请先登录卖家后台');
  }
  const body = clearCookie ? { clearCookie: true } : { cookie: cookieStr };
  if (companyId) {
    body.companyId = companyId;
    rememberRuntimeOzonCompanyIdForSync(companyId);
  }

  const writeResult = await writeOzonCdnAuthForSync(
    normalizedShopId,
    body,
    { automatic },
  );
  const now = new Date().toISOString();
  await updateOzonSyncTimes({ cookie: now }).catch(() => false);
  return {
    ok: true,
    authMode: writeResult.authMode,
    shopId: normalizedShopId,
    companyId: companyId || '',
    cleared: clearCookie,
    data: writeResult.data,
    syncedAt: now,
  };
}

globalThis.syncOzonCookieToShopForSync = syncOzonCookieToShopForSync;

async function syncCurrentOzonCookieForSync(options) {
  const capturedCompanyId = normalizeOzonCompanyIdForSync(
    (options && options.companyId)
    || await getCapturedOzonCompanyIdForSync()
    || await readOzonSellerCookieValueFromOpenTabForSync('sc_company_id')
  );
  const automatic = options && options.automatic === true;
  const shop = await resolveOzonAutoSyncShop(capturedCompanyId, {
    requireCompanyMatch: automatic,
  });
  if (!shop || !shop.id) {
    throw new Error('未找到匹配的 Ozon 店铺，请先在扩展弹窗选择目标店铺，或在 seller.ozon.ru 切换到已绑定 company_id 的店铺');
  }

  const result = await syncOzonCookieToShopForSync(shop.id, {
    companyId: capturedCompanyId,
    automatic,
    requireCompanyMatch: Boolean(capturedCompanyId),
    clearIfMissingAuth: options && options.clearIfMissingAuth === true,
  });
  try {
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
  } catch (_error) {
    // Remote success is authoritative; local timestamps are diagnostics only.
  }
  return result;
}

function runOzonCookieOnlySyncSingleFlight(options) {
  if (ozonCookieOnlySyncInFlight) return ozonCookieOnlySyncInFlight;
  ozonCookieOnlySyncInFlight = syncCurrentOzonCookieForSync({
    ...(options && typeof options === 'object' ? options : {}),
    automatic: true,
  }).finally(() => {
    ozonCookieOnlySyncInFlight = null;
  });
  return ozonCookieOnlySyncInFlight;
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
  return await runOzonCookieOnlySyncSingleFlight({
    ...(options && typeof options === 'object' ? options : {}),
    companyId: liveCompanyId || (options && options.companyId) || '',
  });
}
globalThis.ensureCurrentOzonCookieSyncedForInsights = ensureCurrentOzonCookieSyncedForInsights;

function isOzonSellerTabUrlForSync(value) {
  try {
    const url = new URL(toText(value));
    return url.protocol === 'https:' && url.hostname === 'seller.ozon.ru';
  } catch {
    return false;
  }
}

function isOzonSellerCookieDomainForSync(value) {
  const domain = toText(value).trim().toLowerCase().replace(/^\./, '');
  return domain === 'ozon.ru' || domain.endsWith('.ozon.ru');
}

function isOzonSellerSessionAuthCookieForSync(cookie) {
  if (!cookie || !isOzonSellerCookieDomainForSync(cookie.domain)) return false;
  return SS_ERP_OZON_AUTH_COOKIE_NAME_PATTERN.test(toText(cookie.name).trim());
}

async function hasCurrentOzonSellerAuthCookieForSync() {
  if (!chrome.cookies || typeof chrome.cookies.getAll !== 'function') return null;
  const queries = [{ domain: '.ozon.ru' }, { domain: 'seller.ozon.ru' }];
  let completedQueries = 0;
  for (const query of queries) {
    try {
      const cookies = await chrome.cookies.getAll(query);
      completedQueries += 1;
      if ((cookies || []).some(isOzonSellerSessionAuthCookieForSync)) return true;
    } catch (_error) {}
  }
  return completedQueries === queries.length ? false : null;
}

function isRelevantOzonSellerAuthCookieForSync(cookie) {
  if (!cookie || !isOzonSellerCookieDomainForSync(cookie.domain)) return false;
  const name = toText(cookie.name).trim();
  return name === 'sc_company_id' || isOzonSellerSessionAuthCookieForSync(cookie);
}

function flushOzonSellerCookieLifecycleSync() {
  ozonSellerCookieLifecycleTimer = null;
  if (!ozonSellerCookieLifecyclePending) return;
  if (ozonCookieOnlySyncInFlight) {
    const scheduleAfterCurrent = () => {
      if (ozonSellerCookieLifecyclePending) scheduleOzonSellerCookieLifecycleSync();
    };
    ozonCookieOnlySyncInFlight.then(scheduleAfterCurrent, scheduleAfterCurrent);
    return;
  }

  ozonSellerCookieLifecyclePending = false;
  const clearIfMissingAuth = ozonSellerCookieRemovalPending;
  ozonSellerCookieRemovalPending = false;
  runOzonCookieOnlySyncSingleFlight({ automatic: true, clearIfMissingAuth })
    .then(async (result) => {
      if (result && result.cleared === true) {
        const authCookieState = await hasCurrentOzonSellerAuthCookieForSync();
        if (authCookieState === false) await clearRuntimeOzonCompanyIdForSync();
        await broadcastOzonCompanyContextChanged();
      }
      return result;
    })
    .catch(() => null)
    .finally(() => {
      if (ozonSellerCookieLifecyclePending) scheduleOzonSellerCookieLifecycleSync();
    });
}

function scheduleOzonSellerCookieLifecycleSync() {
  ozonSellerCookieLifecyclePending = true;
  if (ozonSellerCookieLifecycleTimer !== null) {
    clearTimeout(ozonSellerCookieLifecycleTimer);
  }
  ozonSellerCookieLifecycleTimer = setTimeout(
    flushOzonSellerCookieLifecycleSync,
    SS_ERP_OZON_COOKIE_LIFECYCLE_DEBOUNCE_MS,
  );
}

async function scheduleOzonSellerCookieLifecycleSyncWhenTabExists() {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function') return;
  const tabs = await chrome.tabs.query({ url: 'https://seller.ozon.ru/*' });
  if ((tabs || []).some((tab) => tab && isOzonSellerTabUrlForSync(tab.url))) {
    scheduleOzonSellerCookieLifecycleSync();
  }
}

function shouldRunOzonAutoSyncSlot(state, key, now, force) {
  if (force) return true;
  const last = Number(state && state[key]) || 0;
  return !last || now - last >= SS_ERP_OZON_AUTO_SYNC_INTERVAL_MS;
}

function summarizeOzonAutoSyncResult(value) {
  if (!value || typeof value !== 'object') return null;
  const summary = { ok: value.ok === true };
  if (value.error) summary.error = toText(value.error).slice(0, 240);
  if (value.errorCode) summary.errorCode = toText(value.errorCode).slice(0, 100);
  if (value.outcome) summary.outcome = toText(value.outcome).slice(0, 100);
  if (value.automaticRetryAllowed === false) summary.automaticRetryAllowed = false;
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

  const stateRow = await chrome.storage.local.get([SS_ERP_OZON_AUTO_SYNC_STATE_KEY]);
  const state = stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] && typeof stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY] === 'object'
    ? stateRow[SS_ERP_OZON_AUTO_SYNC_STATE_KEY]
    : {};
  const capturedCompanyId = normalizeOzonCompanyIdForSync((options && options.companyId) || await getCapturedOzonCompanyIdForSync() || await readOzonSellerCookieValueFromOpenTabForSync('sc_company_id'));
  const shop = await resolveOzonAutoSyncShop(capturedCompanyId, {
    requireCompanyMatch: true,
  });
  if (!shop || !shop.id) return { ok: false, skipped: true, reason: 'missing_ozon_shop' };

  const nextState = { ...state, lastReason: reason };
  const result = { ok: true, shopId: shop.id, companyId: capturedCompanyId || '', cookie: null, analytics: null, graphs: null };
  const companyChanged = capturedCompanyId && capturedCompanyId !== state.lastCompanyId;

  const cookieSyncRequired = shouldRunOzonAutoSyncSlot(
    state,
    'cookieAt',
    now,
    force || companyChanged,
  );
  if (cookieSyncRequired) {
    try {
      result.cookie = await syncOzonCookieToShopForSync(shop.id, {
        companyId: capturedCompanyId,
        automatic: true,
      });
      nextState.cookieAt = now;
      if (capturedCompanyId) nextState.lastCompanyId = capturedCompanyId;
    } catch (error) {
      result.cookie = publicOzonSyncError(error);
    }
  }
  const shopBindingVerified = !cookieSyncRequired || Boolean(result.cookie && result.cookie.ok);
  if (!shopBindingVerified) {
    result.ok = false;
    result.analytics = { ok: false, skipped: true, reason: 'company_binding_unverified' };
    result.graphs = { ok: false, skipped: true, reason: 'company_binding_unverified' };
  }

  if (shopBindingVerified && shouldRunOzonAutoSyncSlot(
    state,
    'analyticsAt',
    now,
    force || companyChanged,
  )) {
    const syncAnalytics = globalThis.SS_ERP_COLLECT_BACKGROUND && globalThis.SS_ERP_COLLECT_BACKGROUND.syncShopAnalyticsToErp;
    let response;
    try {
      response = typeof syncAnalytics === 'function'
        ? await syncAnalytics(shop.id, capturedCompanyId || undefined)
        : { ok: false, error: 'Ozon 分析同步模块未加载' };
    } catch (error) {
      response = publicOzonSyncError(error);
    }
    result.analytics = response;
    if (response && response.ok) {
      nextState.analyticsAt = now;
      await updateOzonSyncTimes({ analytics: new Date(now).toISOString() }).catch(() => false);
    }
  }

  if (shopBindingVerified && shouldRunOzonAutoSyncSlot(
    state,
    'graphsAt',
    now,
    force || companyChanged,
  )) {
    const syncGraphs = globalThis.SS_ERP_COLLECT_BACKGROUND && globalThis.SS_ERP_COLLECT_BACKGROUND.syncShopGraphsToErp;
    let response;
    try {
      response = typeof syncGraphs === 'function'
        ? await syncGraphs(shop.id, capturedCompanyId || undefined, 30)
        : { ok: false, error: 'Ozon 图表同步模块未加载' };
    } catch (error) {
      response = publicOzonSyncError(error);
    }
    result.graphs = response;
    if (response && response.ok) {
      nextState.graphsAt = now;
      await updateOzonSyncTimes({ graphs: new Date(now).toISOString() }).catch(() => false);
    }
  }

  nextState.updatedAt = new Date(now).toISOString();
  nextState.lastResult = {
    cookie: summarizeOzonAutoSyncResult(result.cookie),
    analytics: summarizeOzonAutoSyncResult(result.analytics),
    graphs: summarizeOzonAutoSyncResult(result.graphs),
  };
  await chrome.storage.local.set({ [SS_ERP_OZON_AUTO_SYNC_STATE_KEY]: nextState }).catch(() => {});
  return result;
}

function enqueueOzonAutoSyncMaintenance(options) {
  const run = ozonAutoSyncMaintenanceQueue.then(() => runOzonAutoSyncMaintenance(options));
  ozonAutoSyncMaintenanceQueue = run.catch(() => null);
  return run;
}

async function broadcastOzonCompanyContextChanged() {
  if (typeof globalThis.invalidateOzonWorkbenchInsightContext === 'function') {
    globalThis.invalidateOzonWorkbenchInsightContext();
  }
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function'
    || typeof chrome.tabs.sendMessage !== 'function') return;
  const tabs = await chrome.tabs.query({
    url: [
      'https://*.ozon.ru/*',
      'https://*.ozon.kz/*',
      'https://*.ozon.by/*',
    ],
  });
  await Promise.allSettled((tabs || []).filter((tab) => tab && Number.isInteger(tab.id)).map((tab) => (
    chrome.tabs.sendMessage(tab.id, { type: 'ss-erp:ozon-company-context-changed' })
  )));
}

function flushOzonCompanyMaintenance() {
  ozonCompanyMaintenanceTimer = null;
  const companyId = ozonPendingMaintenanceCompanyId;
  ozonPendingMaintenanceCompanyId = '';
  if (!companyId) return;
  enqueueOzonAutoSyncMaintenance({ reason: 'company_id_cookie_changed', companyId }).catch(() => {
    console.warn('[SS ERP] Ozon auto sync after company switch failed');
  });
}

function scheduleOzonCompanyMaintenance(companyId) {
  const normalized = normalizeOzonCompanyIdForSync(companyId);
  if (!normalized) return;
  ozonPendingMaintenanceCompanyId = normalized;
  if (ozonCompanyMaintenanceTimer !== null) clearTimeout(ozonCompanyMaintenanceTimer);
  ozonCompanyMaintenanceTimer = setTimeout(
    flushOzonCompanyMaintenance,
    SS_ERP_OZON_COOKIE_LIFECYCLE_DEBOUNCE_MS,
  );
}

function handleCapturedOzonCompanyIdForSync(companyId, capturedAt) {
  const previousCompanyId = getRuntimeOzonCompanyIdForSync();
  const nextCompanyId = rememberRuntimeOzonCompanyIdForSync(companyId, capturedAt);
  if (nextCompanyId && nextCompanyId !== previousCompanyId) {
    broadcastOzonCompanyContextChanged().catch(() => {});
    scheduleOzonCompanyMaintenance(nextCompanyId);
  }
  return nextCompanyId;
}

async function readOzonAutoSyncStatus() {
  const [connection, deviceConnection, stateRow] = await Promise.all([
    getOzonAutoSyncConnection(),
    getLogisticsDeviceCredentials().getConnection().catch(() => null),
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
    hasErpConnection: Boolean(deviceConnection && deviceConnection.baseUrl)
      || Boolean(connection.apiBase && connection.token),
    apiBase: deviceConnection && deviceConnection.baseUrl || connection.apiBase || '',
    intervalMinutes: SS_ERP_OZON_AUTO_SYNC_INTERVAL_MINUTES,
    state,
  };
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (!changeInfo || changeInfo.status !== 'complete') return;
    if (!isOzonSellerTabUrlForSync(tab && tab.url)) return;
    scheduleOzonSellerCookieLifecycleSync();
  });
}

if (chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(() => {
    injectErpBridgeIntoOpenTabs().catch(() => {});
    scheduleOzonSellerCookieLifecycleSyncWhenTabExists().catch(() => {});
  });
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
    enqueueOzonAutoSyncMaintenance({ reason: 'alarm' }).catch((error) => {
      console.warn('[SS ERP] Ozon auto sync alarm failed:', error);
    });
  });
}

function handleOzonSellerCookieChange(change) {
  const cookie = change && change.cookie;
  if (!isRelevantOzonSellerAuthCookieForSync(cookie)) return;
  if (change.removed) {
    ozonSellerCookieRemovalPending = true;
    if (cookie.name === 'sc_company_id') broadcastOzonCompanyContextChanged().catch(() => {});
    scheduleOzonSellerCookieLifecycleSync();
    return;
  }
  if (cookie.name === 'sc_company_id') {
    const companyId = rememberRuntimeOzonCompanyIdForSync(cookie.value);
    broadcastOzonCompanyContextChanged().catch(() => {});
    scheduleOzonCompanyMaintenance(companyId);
    return;
  }
  scheduleOzonSellerCookieLifecycleSync();
}

if (chrome.cookies && chrome.cookies.onChanged) {
  chrome.cookies.onChanged.addListener(handleOzonSellerCookieChange);
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

function isOzonPageRuntimeSender(sender) {
  try {
    const url = new URL(String(sender && (sender.url || sender.documentUrl) || ''));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (
      hostname === 'ozon.ru'
      || hostname.endsWith('.ozon.ru')
      || hostname === 'ozon.kz'
      || hostname.endsWith('.ozon.kz')
      || hostname === 'ozon.by'
      || hostname.endsWith('.ozon.by')
    );
  } catch (_error) {
    return false;
  }
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

  // New BYOK/workbench messages must pass the dedicated authorization
  // dispatcher.  Keeping this branch before the legacy handlers prevents a
  // future handler from accidentally inheriting the broad legacy sender matrix
  // or echoing a secret-bearing response.  Phase 1 intentionally registers no
  // Single-image, edit, batch, and server-owned publish handlers all pass through
  // the same sender, payload, and response authorization boundary.
  const runtimeAuthorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
  if (runtimeAuthorization
    && typeof runtimeAuthorization.isNewRuntimeMessageType === 'function'
    && runtimeAuthorization.isNewRuntimeMessageType(message.type)) {
    Promise.resolve(runtimeAuthorization.dispatchAuthorizedRuntimeMessage({
      runtimeId: chrome.runtime.id,
      sender,
      message,
      sendResponse,
      handlers: globalThis.SS_ERP_BYOK_RUNTIME_MESSAGE_HANDLERS || {},
      verifyReadinessHandle: globalThis.SS_ERP_BYOK_READINESS_HANDLE_VERIFIER,
      forbiddenResponseValues: globalThis.SS_ERP_BYOK_RESPONSE_SECRET_VALUES,
    })).catch(() => {
      try {
        sendResponse({
          ok: false,
          errorCode: 'SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION_FAILED',
          error: '扩展请求未通过安全校验',
        });
      } catch (_error) {
        // The channel may already have been closed; there is nothing else to do.
      }
    });
    return true;
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

  if (message.type === 'ss-erp:erp-source-image-open') {
    Promise.resolve().then(() => getErpSourceImageLauncher().open(message, sender)).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      const errorCode = /^ERP_(?:SOURCE_LAUNCH|LAUNCH)_[A-Z_]{1,80}$/.test(error?.code || '')
        ? error.code : 'ERP_SOURCE_LAUNCH_UNAVAILABLE';
      sendResponse({ ok: false, errorCode, error: '扩展启动授权不可用，请核对当前配对账号与草稿后重新打开' });
    });
    return true;
  }
  if (message.type === SS_ERP_SOURCE_AI_WORKBENCH_OPEN_MESSAGE) {
    Promise.resolve(openAuthoritativeSourceAiWorkbench(message, sender)).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:source-listing-workbench-status') {
    Promise.resolve().then(async () => {
      const sourceProductId = sourceWorkflowHandoffText(message.sourceProductId, 200);
      const platform = sourceWorkflowPlatform(message.platform);
      const listingWorkflowId = sourceWorkflowHandoffText(message.listingWorkflowId, 200);
      const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
      if (!handoff || !sourceProductId || !platform
        || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
        return {
          handoff: null,
          result: { state: 'unavailable', reason: 'source_handoff_mismatch' },
          launch: null,
        };
      }
      const result = await getSourceListingWorkflowClient().getStatus({
        snapshotId: handoff.snapshotId,
        supplyGoodsId: handoff.supplyGoodsId,
      });
      let launch = null;
      const listing = currentSourceListingContext(result, listingWorkflowId);
      if (listing) {
        try {
          launch = await getSourceListingWorkflowClient().getMediaLaunch({
            snapshotId: handoff.snapshotId,
            supplyGoodsId: handoff.supplyGoodsId,
            ...listing,
          });
        } catch (error) {
          launch = { state: 'unavailable', reason: error && error.message ? error.message : String(error) };
        }
      }
      return { handoff, result, launch };
    }).then((result) => {
      sendResponse({ ok: true, ...result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_AI_IMAGE_SUITE_MESSAGE) {
    Promise.resolve().then(async () => {
      const authority = await loadAuthoritativeSourceAiImageSuiteProjection(message);
      return { handoff: authority.handoff, result: authority.result };
    }).then((result) => {
      sendResponse({ ok: true, ...result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_AI_IMAGE_SUITE_COMMAND_MESSAGE) {
    Promise.resolve().then(
      () => executeAuthoritativeSourceAiImageSuiteCommand(message),
    ).then((result) => {
      sendResponse({ ok: true, ...result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_HISTORY_MESSAGE) {
    Promise.resolve().then(async () => {
      const sourceProductId = sourceWorkflowHandoffText(message.sourceProductId, 200);
      const platform = sourceWorkflowPlatform(message.platform);
      const requestedListingWorkflowId = sourceWorkflowHandoffText(message.listingWorkflowId, 200);
      const beforeCursor = message.beforeCursor == null
        ? null
        : sourceWorkflowHandoffText(message.beforeCursor, 1000);
      if (message.beforeCursor != null && !beforeCursor) {
        throw new Error('ERP 媒体历史游标无效');
      }
      const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
      if (!handoff || !sourceProductId || !platform || !requestedListingWorkflowId
        || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
        throw new Error('ERP 媒体历史上下文无效，请刷新后重试');
      }
      const client = getSourceListingWorkflowClient();
      const current = await client.getStatus({
        snapshotId: handoff.snapshotId,
        supplyGoodsId: handoff.supplyGoodsId,
      });
      const listing = currentSourceListingContext(current, requestedListingWorkflowId);
      if (!listing) throw new Error('ERP 商品草稿状态已变化，请刷新后重试');
      const result = await client.getMediaHistory({
        snapshotId: handoff.snapshotId,
        supplyGoodsId: handoff.supplyGoodsId,
        shopId: listing.shopId,
        listingWorkflowId: listing.listingWorkflowId,
        revision: listing.revision,
        draftVersion: listing.draftVersion,
        limit: 10,
        beforeCursor,
      });
      return { handoff, result };
    }).then((result) => {
      sendResponse({ ok: true, ...result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_PREPARE_MESSAGE) {
    Promise.resolve().then(async () => {
      const request = sourceMediaMutationRequest(message);
      if (!request) throw new Error('ERP 媒体确认请求无效，请刷新后重试');
      return openSourceMediaConfirmation(request, sender);
    }).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_READ_MESSAGE) {
    Promise.resolve().then(async () => {
      const confirmation = await getSourceMediaConfirmationCoordinator().claim(message.nonce, sender);
      if (!confirmation) throw new Error('图片确认已失效，请从商品页重新发起');
      return getSourceMediaConfirmationContract().publicConfirmation(confirmation);
    }).then((confirmation) => {
      sendResponse({ ok: true, confirmation });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_SUBMIT_MESSAGE) {
    Promise.resolve().then(() => submitSourceMediaConfirmation(message.nonce, sender)).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_CONFIRM_CANCEL_MESSAGE) {
    Promise.resolve().then(() => cancelSourceMediaConfirmation(message.nonce, sender)).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_OPEN_MESSAGE) {
    Promise.resolve().then(async () => {
      const request = sourceMediaEditorOpenRequest(message, sender);
      if (!request) throw new Error('ERP 局部重绘打开请求无效');
      return openSourceMediaEditor(request);
    }).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_READ_MESSAGE) {
    Promise.resolve().then(() => readSourceMediaEditor(message.nonce, sender)).then((editor) => {
      sendResponse({ ok: true, editor });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_SUBMIT_MESSAGE) {
    Promise.resolve().then(() => submitSourceMediaEditor(message, sender)).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_EDITOR_CANCEL_MESSAGE) {
    Promise.resolve().then(() => cancelSourceMediaEditor(message.nonce, sender)).then((result) => {
      sendResponse({ ok: true, result });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_COMMAND_MESSAGE) {
    Promise.resolve().then(async () => {
      const sourceProductId = sourceWorkflowHandoffText(message.sourceProductId, 200);
      const platform = sourceWorkflowPlatform(message.platform);
      if (message.action === 'CREATE_TRANSLATION') {
        const requestedSourceMediaKey = sourceTranslationIntentText(message.sourceMediaKey, 500);
        const requestedListingWorkflowId = sourceTranslationIntentText(message.listingWorkflowId, 200);
        const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
        if (!handoff || !sourceProductId || !platform || !requestedSourceMediaKey
          || !requestedListingWorkflowId
          || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
          throw new Error('ERP 图片翻译上下文无效，请刷新后重试');
        }
        const client = getSourceListingWorkflowClient();
        // Re-read the authoritative listing and launch context for every attempt.
        const current = await client.getStatus({
          snapshotId: handoff.snapshotId,
          supplyGoodsId: handoff.supplyGoodsId,
        });
        const listing = currentSourceListingContext(current, requestedListingWorkflowId);
        if (!listing) throw new Error('ERP 商品草稿状态暂不可用，请先在 ERP 选择店铺和 SKU');
        const launch = await client.getMediaLaunch({
          snapshotId: handoff.snapshotId,
          supplyGoodsId: handoff.supplyGoodsId,
          ...listing,
        });
        if (!launch || launch.state !== 'ready' || !launch.context
          || !launch.context.sourceInputs.some((item) => item.sourceMediaKey === requestedSourceMediaKey)) {
          throw new Error('当前图片不在服务器允许的来源列表中');
        }
        const intent = await getOrCreateSourceTranslationIntent({
          platform,
          sourceProductId,
          listingWorkflowId: listing.listingWorkflowId,
          draftRevision: listing.revision,
          draftVersion: listing.draftVersion,
          sourceMediaKey: requestedSourceMediaKey,
        });
        const result = await client.createTranslationCommand({
          snapshotId: handoff.snapshotId,
          supplyGoodsId: handoff.supplyGoodsId,
          shopId: listing.shopId,
          listingWorkflowId: listing.listingWorkflowId,
          draftRevision: listing.revision,
          draftVersion: listing.draftVersion,
          sourceMediaKey: requestedSourceMediaKey,
          workflowOperationKey: intent.workflowOperationKey,
        });
        await clearSourceTranslationIntent(intent.identity);
        return { handoff, result, launch };
      }
      const mediaWorkflowId = sourceWorkflowHandoffText(message.mediaWorkflowId, 200);
      const expectedRevision = Number(message.expectedRevision);
      const action = message.action === 'CANCEL' || message.action === 'RETRY'
        ? message.action
        : '';
      const handoff = await readPersistedSourceWorkflowHandoff(platform, sourceProductId);
      if (!handoff || !sourceProductId || !platform || !mediaWorkflowId || !action
        || !Number.isSafeInteger(expectedRevision) || expectedRevision <= 0
        || handoff.sourceProductId !== sourceProductId || handoff.platform !== platform) {
        throw new Error('ERP 媒体任务上下文无效，请刷新后重试');
      }
      const client = getSourceListingWorkflowClient();
      const current = await client.getStatus({
        snapshotId: handoff.snapshotId,
        supplyGoodsId: handoff.supplyGoodsId,
      });
      if (!current || current.state !== 'ready' || !current.status) {
        throw new Error('ERP 媒体任务状态暂不可用');
      }
      const task = current.status.media.items.find((item) => (
        item.id === mediaWorkflowId
        && item.revision === expectedRevision
        && item.commandContext
        && Array.isArray(item.allowedActions)
        && item.allowedActions.includes(action)
      ));
      if (!task) throw new Error('ERP 媒体任务已变化，请刷新后重试');
      const result = await client.executeMediaCommand({
        action,
        mediaWorkflowId: task.id,
        expectedRevision: task.revision,
        shopId: task.commandContext.shopId,
        listingWorkflowId: task.commandContext.listingWorkflowId,
        draftRevision: task.commandContext.draftRevision,
        draftVersion: task.commandContext.draftVersion,
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
    handleCapturedOzonCompanyIdForSync(message.companyId, message.capturedAt);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'ss-erp:extension-device-status') {
    Promise.resolve().then(() => {
      assertTrustedErpDeviceSender(sender);
      return readExtensionDeviceStatusAfterClaims(message.verify === true);
    }).then((deviceStatus) => {
      sendResponse({ ok: true, data: deviceStatus });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:extension-device-claim') {
    Promise.resolve().then(() => enqueueExtensionDeviceClaim(message, sender)).then((deviceStatus) => {
      if (deviceStatus && deviceStatus.state === 'paired') {
        broadcastOzonCompanyContextChanged().catch(() => {});
        scheduleOzonSellerCookieLifecycleSync();
      }
      sendResponse({ ok: true, data: deviceStatus });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:extension-device-clear') {
    Promise.resolve().then(() => {
      // This message is settings-page-only in the runtime policy. Keep the
      // sender assertion here as a second boundary before deleting the
      // service-worker-owned credential.
      assertTrustedErpDeviceSender(sender);
      return getLogisticsDeviceCredentials().clear().then(async (deviceStatus) => {
        await clearLegacyCompatibilityCredential();
        await markExtensionDeviceAuthority(message.reason === 'owner_mismatch' ? 'owner_mismatch' : 'cleared');
        return deviceStatus;
      });
    }).then((deviceStatus) => {
      broadcastOzonCompanyContextChanged().catch(() => {});
      sendResponse({ ok: true, data: deviceStatus });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ss-erp:ping') {
    Promise.resolve().then(() => {
      assertTrustedErpDeviceSender(sender);
      return Promise.all([
        chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, 'ss_erp_connection']),
        readExtensionDeviceStatusAfterClaims(false),
        readExtensionDeviceCollectStatus(),
      ]);
    }).then(([result, deviceStatus, deviceCollectStatus]) => {
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
        deviceState: deviceStatus.state,
        deviceScopes: Array.isArray(deviceStatus.scopes) ? deviceStatus.scopes.slice() : [],
        deviceEndpoint: deviceStatus.endpoint,
        deviceCollectState: deviceCollectStatus.state,
        deviceLegacyFallbackAllowed: deviceCollectStatus.legacyFallbackAllowed === true,
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
    Promise.all([
      chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, OZON_CALC_ERP_PUSH_HISTORY_KEY, 'ss_erp_connection']),
      readExtensionDeviceBrowserOneClickStatus().catch(() => null),
    ]).then(([result, deviceStatus]) => {
      const history = Array.isArray(result[OZON_CALC_ERP_PUSH_HISTORY_KEY]) ? result[OZON_CALC_ERP_PUSH_HISTORY_KEY] : [];
      const legacyConn = result.ss_erp_connection || {};
      const devicePaired = Boolean(deviceStatus && deviceStatus.ok === true
        && deviceStatus.state === 'paired');
      const deviceObserved = Boolean(deviceStatus && deviceStatus.authMode === 'device');
      const endpoint = toText(
        devicePaired && deviceStatus.endpoint
          || result[OZON_CALC_ERP_ENDPOINT_KEY]
          || legacyConn.baseUrl,
      ).trim();
      const token = toText(result[OZON_CALC_ERP_TOKEN_KEY] || legacyConn.token).trim();
      const scopes = devicePaired && Array.isArray(deviceStatus.scopes)
        ? deviceStatus.scopes.slice()
        : [];
      sendResponse({
        ok: true,
        endpoint,
        hasToken: Boolean(token),
        connected: devicePaired,
        authMode: deviceObserved ? 'device' : (token ? 'legacy_token' : 'none'),
        scopes,
        canPublish: devicePaired
          && scopes.includes('capture:write')
          && scopes.includes('listing:publish'),
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
      const legacyPayload = { items: items };
      const deviceCollect = globalThis.SS_ERP_EXTENSION_DEVICE_COLLECT;
      const deviceStatus = deviceCollect && typeof deviceCollect.status === 'function'
        ? await deviceCollect.status()
        : { ok: false, state: 'unpaired', legacyFallbackAllowed: true };
      let data;
      if (deviceStatus.ok === true) {
        const deviceResult = await deviceCollect.submit(legacyPayload);
        if (!deviceResult || deviceResult.ok !== true) {
          throw Object.assign(
            new Error(deviceResult && deviceResult.error || '设备来源采集失败'),
            { errorCode: deviceResult && deviceResult.errorCode },
          );
        }
        data = deviceResult.body;
      } else if (deviceStatus.legacyFallbackAllowed !== true) {
        throw Object.assign(
          new Error(deviceStatus.error || '设备来源采集授权不可用'),
          { errorCode: deviceStatus.errorCode },
        );
      } else {
        data = await self.SS_ERP_CLIENT.submitCollect(legacyPayload);
      }
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
  if (message.type === 'ozon-calc:get-ozon-cdn-auth') {
    const shopId = message.payload && message.payload.shopId;
    if (!shopId) {
      sendResponse({ ok: false, error: '缺少 shopId，请先选择目标店铺' });
      return false;
    }
    readOzonCdnAuthForSync(shopId).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

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
      sendResponse(publicOzonSyncError(error));
    });
    return true;
  }

  if (message.type === 'ozon-calc:sync-current-ozon-cookie') {
    const payload = message.payload && typeof message.payload === 'object'
      ? { ...message.payload }
      : {};
    if (isOzonPageRuntimeSender(sender)) payload.automatic = true;
    syncCurrentOzonCookieForSync(payload).then((result) => {
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
      sendResponse(publicOzonSyncError(error));
    });
    return true;
  }

  if (message.type === 'ozon-calc:auto-sync-maintenance') {
    enqueueOzonAutoSyncMaintenance(message.payload || {}).then((result) => {
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
    writeOzonCdnAuthForSync(shopId, { companyId: String(companyId) }).then((result) => {
      sendResponse({ ok: true, msg: 'Company ID 已同步', data: result.data });
    }).catch((error) => {
      sendResponse(publicOzonSyncError(error));
    });
    return true;
  }

  return false;
});

if (chrome.runtime?.onConnect?.addListener) {
  chrome.runtime.onConnect.addListener((port) => {
    if (!port || port.name !== SS_ERP_BYOK_BATCH_LIFECYCLE_PORT_NAME) return;
    const authorization = globalThis.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION;
    const sender = port.sender;
    const tabId = Number(sender?.tab?.id);
    const documentId = typeof sender?.documentId === 'string'
      ? sender.documentId.normalize('NFKC').trim()
      : '';
    const trusted = authorization
      && typeof authorization.senderSurface === 'function'
      && authorization.senderSurface(sender, chrome.runtime.id)
        === authorization.SENDER_SURFACES?.WORKBENCH
      && Number.isSafeInteger(tabId) && tabId >= 0
      && documentId.length > 0 && documentId.length <= 200;
    if (!trusted) {
      try { port.disconnect(); } catch {}
      return;
    }
    const owner = Object.freeze({ tabId, documentId });
    port.onMessage.addListener((message) => {
      if (message !== SS_ERP_BYOK_BATCH_LIFECYCLE_PING) {
        try { port.disconnect(); } catch {}
        return;
      }
      try { port.postMessage(SS_ERP_BYOK_BATCH_LIFECYCLE_ACK); } catch {}
    });
    port.onDisconnect.addListener(() => {
      if (!byokWorkbenchBatchRegistry) return;
      void Promise.resolve(byokWorkbenchBatchRegistry.clear(owner)).catch(() => {});
    });
  });
}

if (chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    Promise.allSettled([
      Promise.resolve().then(() => getByokWorkbenchRuntimeDispatcher().removeTab(tabId)),
      Promise.resolve().then(() => getByokWorkbenchBatchRegistry().removeTab(tabId)),
      Promise.resolve().then(() => getHostedAiImageSuiteClientRegistry().removeTab(tabId)),
    ]).catch(() => {});
  });
}
