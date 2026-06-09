import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepoFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

function loadRuntimeModeHarness({ storage = {}, fetchImpl } = {}) {
  const source = readRepoFile('extensions', 'ss-erp', 'shared', 'erp-adapter', 'runtime-mode.js');
  const sets = [];
  const context = {
    console: { log() {}, warn() {} },
    AbortSignal: { timeout: () => ({}) },
    fetch: fetchImpl || (async () => ({ ok: false, json: async () => ({}) })),
    chrome: {
      storage: {
        local: {
          async get(keys) {
            const result = {};
            for (const key of keys) result[key] = storage[key];
            return result;
          },
          async set(value) {
            sets.push(value);
            Object.assign(storage, value);
          },
        },
      },
    },
  };
  context.self = context;
  vm.runInNewContext(source, context, { filename: 'runtime-mode.js' });
  return { runtime: context.self.SS_ERP_RUNTIME, storage, sets };
}

test('Ozon list overlay scans current list widgets and retries transient data failures quickly', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /\[data-widget="skuGridSimple"\]\s+\[data-index\]/);
  assert.match(source, /#layoutPage\s+\[data-index\]/);
  assert.match(source, /PREMIUM_FAILURE_TTL_MS\s*=\s*90\s*\*\s*1000/);
  assert.match(source, /PREMIUM_CONCURRENCY\s*=\s*3/);
  assert.match(source, /CARD_SCAN_FAST_MS\s*=\s*500/);
  assert.match(source, /data-ss-erp-overlay-sku/);
});

test('Ozon list overlay attaches only to single-product card targets', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /function\s+extractSkuFromHref/);
  assert.match(source, /function\s+collectDistinctProductSkus/);
  assert.match(source, /function\s+resolveProductCardTarget/);
  assert.match(source, /function\s+collectProductCardTargets/);
  assert.match(source, /countDistinctProductSkus\(target\)\s*!==\s*1/);
  assert.match(source, /attachOverlay\(target\)/);
  assert.doesNotMatch(source, /attachOverlay\(card\)/);
  assert.doesNotMatch(source, /io\.observe\(card\)/);
});

test('Ozon list overlay expanded panel uses a body portal to avoid Ozon card clipping', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /function\s+createExpandedPortal/);
  assert.match(source, /function\s+positionExpandedPanel/);
  assert.match(source, /function\s+setExpandedPanelOpen/);
  assert.match(source, /document\.body\.appendChild\(expanded\)/);
  assert.match(source, /data-ss-erp-portal/);
  assert.match(source, /ss-erp-overlay-card-expanded/);
  assert.match(source, /position:fixed/);
  assert.match(source, /window\.addEventListener\('scroll'/);
  assert.doesNotMatch(source, /ss-erp-expanded" style=/);
  assert.doesNotMatch(source, /wrap\.querySelector\('\\.ss-erp-expanded'\)/);
  assert.doesNotMatch(source, /position:absolute/);
});

test('Ozon commission sync primes the help center session before document-manager API requests', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');

  assert.match(source, /OZON_COMMISSION_BOOTSTRAP_URLS/);
  assert.match(source, /primeOzonCommissionSession/);
  assert.match(source, /fetchCommissionPayloadViaHelpTab/);
  assert.match(source, /isOzonChallengePayload/);
  assert.match(source, /document-manager-api\/global-help\/api\/v3\/document\/public\/by-path/);
  assert.match(source, /credentials:\s*'include'/);
});

test('Ozon seller company id detection falls back to captured x-o3-company-id', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'collect-background.js');

  assert.match(source, /ss_erp_ozon_company_id/);
  assert.match(source, /getStoredSellerCompanyId/);
  assert.match(source, /refreshSellerCompanyIdFromTab/);
  assert.match(source, /\.ozon\.ru/);
});

test('Ozon shop analytics sync falls back from charts table to what-to-sell data', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'collect-background.js');

  assert.match(source, /syncShopAnalyticsWithFallback/);
  assert.match(source, /fetchShopAnalyticsFromChartsV3/);
  assert.match(source, /fetchShopAnalyticsFromWhatToSell/);
  assert.match(source, /mapChartsV3AnalyticsItem/);
  assert.match(source, /mapWhatToSellAnalyticsItem/);
  assert.match(source, /OZON_ENDPOINTS\.chartsV3TableBySku/);
  assert.match(source, /OZON_ENDPOINTS\.analytics/);
  assert.match(source, /analyticsSource/);
  assert.doesNotMatch(source, /不再依赖\s+what_to_sell\/data\/v3/);
});

test('1688 ERP collect adapter posts normalized payloads to supply import without changing Ozon collect path', () => {
  const adapter = readRepoFile('extensions', 'ss-erp', 'shared', 'erp-adapter', 'collect-product.js');
  const localAdapter = readRepoFile('extensions', 'ss-erp', 'shared', 'adapters', 'local-adapter.js');
  const cloudAdapter = readRepoFile('extensions', 'ss-erp', 'shared', 'adapters', 'cloud-adapter.js');

  for (const source of [adapter, localAdapter, cloudAdapter]) {
    assert.match(source, /function\s+is1688CollectPayload/);
    assert.match(source, /function\s+normalize1688ImportPayload/);
    assert.match(source, /\/api\/supply\/1688\/import/);
    assert.match(source, /purchasePriceCny/);
    assert.match(source, /exchangeRateRubToCny/);
    assert.match(source, /sourceCategoryName/);
  }

  assert.match(adapter, /var\s+path\s*=\s*is1688CollectPayload\(payload\)\s*\?\s*'\/api\/supply\/1688\/import'\s*:\s*'\/api\/collect'/);
  assert.match(localAdapter, /return\s+this\.request\(resolveCollectPath\(payload\)/);
  assert.match(cloudAdapter, /return\s+this\.request\(resolveCollectPath\(payload\)/);
  assert.match(adapter, /normalizeCollectPayload\(payload\)/);
  assert.match(localAdapter, /normalizeCollectPayload\(payload\)/);
  assert.match(cloudAdapter, /normalizeCollectPayload\(payload\)/);
});

test('1688 detail pages render extension pricing and collect workflow as the primary entry', () => {
  const manifest = readRepoFile('extensions', 'ss-erp', 'manifest.json');
  const content = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const css = readRepoFile('extensions', 'ss-erp', 'content', 'collect-1688-panel.css');

  assert.match(manifest, /content\/collect-1688-panel\.css/);
  assert.match(content, /function\s+init1688PricingPanel/);
  assert.match(content, /function\s+render1688PricingPanel/);
  assert.match(content, /function\s+preview1688Pricing/);
  assert.match(content, /function\s+import1688SupplyGood/);
  assert.match(content, /\/api\/supply\/1688\/preview/);
  assert.match(content, /\/api\/supply\/1688\/import/);
  assert.match(content, /data-ss-erp-1688-action="preview"/);
  assert.match(content, /data-ss-erp-1688-action="collect"/);
  assert.match(content, /SS_ERP_1688_PRICING_PANEL/);
  assert.match(content, /sourcePlatform:\s*"1688"/);
  assert.match(css, /#ss-erp-1688-panel/);
  assert.match(css, /ss-erp-1688-summary/);
});

test('1688 pricing panel prefills logistics fee from synced Ozon logistics snapshot', () => {
  const manifest = readRepoFile('extensions', 'ss-erp', 'manifest.json');
  const content = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');

  assert.match(manifest, /shared\/calculator-core\/rule-engine\.js[\s\S]*content\/collect-content-script\.js/);
  assert.match(content, /function\s+load1688LogisticsQuote/);
  assert.match(content, /ozon-calc:config-snapshot/);
  assert.match(content, /const\s+engine\s*=\s*window\.OZON_CALC_RULE_ENGINE/);
  assert.match(content, /engine\.buildServiceQuote/);
  assert.match(content, /engine\.resolveBestQuote/);
  assert.match(content, /logisticsFeeCny/);
  assert.match(content, /data-ss-erp-1688-logistics-hint/);
  assert.match(content, /命中物流/);
});

test('Ozon product panel opens 1688 image search with current Ozon context', () => {
  const content = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const worker = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');

  assert.match(content, /function\s+buildOzon1688SearchContext/);
  assert.match(content, /function\s+open1688ImageSearchFromOzon/);
  assert.match(content, /data-role="search-1688"/);
  assert.match(content, /ss-erp:open-1688-image-search/);
  assert.match(content, /ozonSourceContext/);
  assert.match(content, /images\[0\]/);

  assert.match(worker, /const\s+SS_ERP_OZON_1688_CONTEXT_KEY\s*=\s*'ss-erp:ozon-1688-context'/);
  assert.match(worker, /function\s+build1688ImageSearchUrl/);
  assert.match(worker, /message\.type\s*===\s*'ss-erp:open-1688-image-search'/);
  assert.match(worker, /chrome\.storage\.local\.set\(\{\s*\[SS_ERP_OZON_1688_CONTEXT_KEY\]:\s*context\s*\}\)/);
  assert.match(worker, /chrome\.tabs\.create\(\{\s*url:\s*targetUrl\s*\}\)/);
  assert.match(worker, /s\.1688\.com\/selloffer\/offer_search\.htm/);
});

test('1688 pricing panel shows the Ozon source context saved before image search', () => {
  const content = readRepoFile('extensions', 'ss-erp', 'content', 'collect-content-script.js');
  const css = readRepoFile('extensions', 'ss-erp', 'content', 'collect-1688-panel.css');

  assert.match(content, /SS_ERP_OZON_1688_CONTEXT_KEY\s*=\s*"ss-erp:ozon-1688-context"/);
  assert.match(content, /function\s+loadOzon1688Context/);
  assert.match(content, /function\s+isRecentOzon1688Context/);
  assert.match(content, /ozonSourceContext/);
  assert.match(content, /data-ss-erp-1688-ozon-context/);
  assert.match(content, /来自 Ozon 以图搜/);
  assert.match(content, /sourceCategoryName:\s*product\.sourceCategoryName\s*\|\|\s*\(ozonSourceContext/);
  assert.match(content, /sourceOzonProductId/);
  assert.match(css, /ss-erp-1688-ozon-context/);
});

test('extension runtime detection clears stale cloud mode when runtime endpoint is unavailable', async () => {
  const { runtime, storage } = loadRuntimeModeHarness({
    storage: {
      'ozon-calc:erp-endpoint': 'http://127.0.0.1:3001/api/collect',
      'ozon-calc:erp-token': 'token-1',
      'ozon-calc:runtime-mode': 'cloud',
      'ozon-calc:runtime-capabilities': {
        imageUpload: 'oss',
        sync: 'queue',
        ozonCdnDirect: false,
        serverSideUpload: true,
        queuedTasks: true,
      },
    },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ code: 0 }) }),
  });

  await runtime.syncRuntimeMode();

  assert.equal(storage['ozon-calc:runtime-mode'], 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(storage['ozon-calc:runtime-capabilities'])), {
    imageUpload: 'local',
    sync: 'direct',
    ozonCdnDirect: true,
    serverSideUpload: false,
    queuedTasks: false,
    cookieSync: true,
    presignedUpload: false,
  });
  assert.equal(storage['ozon-calc:runtime-sync-status'].ok, false);
  assert.equal(storage['ozon-calc:runtime-sync-status'].fallbackMode, 'local');
});

test('extension settings connection test displays server runtime mode and capabilities', () => {
  const settings = readRepoFile('extensions', 'ss-erp', 'pages', 'settings.js');

  assert.match(settings, /\/api\/extension\/runtime/);
  assert.match(settings, /formatRuntimeMode/);
  assert.match(settings, /formatRuntimeCapabilities/);
  assert.match(settings, /运行模式/);
  assert.match(settings, /图片上传/);
  assert.match(settings, /任务模式/);
});

test('Ozon list overlay uses ERP batch snapshots for collected actions without blocking Premium fallback', () => {
  const overlay = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');
  const worker = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');
  const collectPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', 'page.tsx');

  assert.match(overlay, /COLLECT_SNAPSHOT_TTL_MS\s*=\s*60\s*\*\s*1000/);
  assert.match(overlay, /const\s+collectSnapshotCache\s*=\s*new Map/);
  assert.match(overlay, /function\s+queueCollectSnapshot/);
  assert.match(overlay, /function\s+fetchCollectSnapshots/);
  assert.match(overlay, /type:\s*'ss-erp:query-collect-batch-snapshot'/);
  assert.match(overlay, /function\s+renderCollectActions/);
  assert.match(overlay, /ss-erp-open-btn/);
  assert.match(overlay, /ss-erp-recollect-btn/);
  assert.match(overlay, /查看 ERP/);
  assert.match(overlay, /重采集/);
  assert.match(overlay, /ERP 未连接|采集状态未知/);

  assert.match(worker, /function\s+resolveErpWebBaseUrl/);
  assert.match(worker, /ss-erp:open-erp-collect/);
  assert.match(worker, /url\.port\s*=\s*'3003'/);
  assert.match(worker, /chrome\.tabs\.create\(\{\s*url:\s*targetUrl\s*\}\)/);

  assert.match(collectPage, /useSearchParams/);
  assert.match(collectPage, /initialSearch/);
});

test('production sources and extension package do not contain competitor brand markers', () => {
  const files = [
    ['extensions', 'ss-erp', 'content', 'ozon-list-overlay.js'],
    ['extensions', 'ss-erp', 'background', 'service-worker.js'],
    ['apps', 'server', 'src', 'routes', 'collect.ts'],
  ];
  const blocked = new RegExp(['企' + '鹅', '店' + '长', 'qe' + 'help', 'hq' + 'ozon'].join('|'), 'i');

  for (const parts of files) {
    assert.doesNotMatch(readRepoFile(...parts), blocked, parts.join('/'));
  }
});
