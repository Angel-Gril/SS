try { importScripts('../shared/currency/price-currency.js'); } catch (e) { console.warn('[SS ERP] price-currency load error:', e); }

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
const OZON_CALC_ERP_QUEUE_KEY = 'ozon-calc:erp-queue';
const OZON_CALC_CAPTURE_ENTRIES_KEY = 'ozon-calc:capture-har-entries';
const OZON_CALC_PRODUCT_POOL_KEY = 'ozon-calc:product-pool';
const OZON_CALC_VISIBLE_SNAPSHOTS_KEY = 'ozon-calc:visible-snapshots';
const OZON_CALC_ERP_ENDPOINT_KEY = 'ozon-calc:erp-endpoint';
const OZON_CALC_ERP_TOKEN_KEY = 'ozon-calc:erp-token';
const OZON_CALC_ERP_PUSH_HISTORY_KEY = 'ozon-calc:erp-push-history';
const OZON_CALC_CONFIG_SNAPSHOT_KEY = 'ozon-calc:config-snapshot';
const OZON_CALC_CONFIG_UPDATED_AT_KEY = 'ozon-calc:config-updated-at';
const OZON_OFFICIAL_SNAPSHOT_KEY = 'ozon-calculator:official-snapshot';
const OZON_COMMISSION_SNAPSHOT_KEY = 'ozon-calculator:commission-snapshot';
const OZON_FX_SNAPSHOT_KEY = 'ozon-calculator:fx-snapshot';
const OZON_1688_PRICE_CHECK_CONTEXT_KEY = 'ss-erp:ozon-1688-price-check-context';
const OZON_COMMISSION_API_URLS = [
  'https://global-help.ozon.com/document-manager-api/global-help/api/v3/document/public/by-path?path=%2Fcommissions%2Fozon-fees%2Fcommissions&lang=zh&childDocsRegion=CHN',
  'https://global-help.ozon.com/document-manager-api/global-help/api/v3/document/public/by-path?path=%2Fcommissions%2Fozon-fees%2Fcommissions&lang=en&childDocsRegion=CHN',
  'https://global-help.ozon.com/document-manager-api/global-help/api/v3/document/public/by-path?path=%2Fcommissions%2Fozon-fees%2Fcommissions&lang=zh&childDocsRegion=OTHER',
];
const OZON_COMMISSION_DOC_URLS = [
  'https://global-help.ozon.com/zh/commissions/ozon-fees/commissions?region=CHN',
  'https://global-help.ozon.com/zh-hans/commissions/ozon-fees/commissions/?country=OTHER',
  'https://global-help.ozon.com/en/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.com/global/zh-hans/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.com/global/en/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.ru/global/zh-hans/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.ru/global/en/commissions/ozon-fees/commissions/?country=OTHER',
  'https://docs.ozon.com/global/zh-hans/commissions',
  'https://docs.ozon.ru/global/zh-hans/commissions',
];
const OZON_COMMISSION_BOOTSTRAP_URLS = [
  'https://global-help.ozon.com/zh/commissions/ozon-fees/commissions?region=CHN',
  'https://global-help.ozon.com/en/commissions/ozon-fees/commissions/?country=OTHER',
];
const OZON_FX_API_URL = 'https://open.er-api.com/v6/latest/CNY';
const OZON_CALC_CAPTURE_LIMIT = 200;
const OZON_CALC_VISIBLE_SNAPSHOT_LIMIT = 50;
const OZON_CALC_ERP_PUSH_HISTORY_LIMIT = 20;

try {
  importScripts('../shared/capture-bridge/captured-har-store.js');
} catch (error) {
  console.warn('[ozon-calc] capture store import failed', error);
}

try {
  importScripts('../shared/product-pool/product-pool-store.js');
} catch (error) {
  console.warn('[ozon-calc] product pool store import failed', error);
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
  importScripts('../shared/erp-package/erp-package-export.js');
} catch (error) {
  console.warn('[ozon-calc] erp package exporter import failed', error);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[ozon-calc] installed');
  if (self.SS_ERP_RUNTIME) self.SS_ERP_RUNTIME.syncRuntimeMode();
});

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

const LEGACY_VENDOR_KEY_CHARS = [113, 101, 104, 101, 108, 112];
const LEGACY_STORAGE_PREFIX = String.fromCharCode(...LEGACY_VENDOR_KEY_CHARS) + '-clone';
const LEGACY_CAPTURE_META_KEY = '_' + String.fromCharCode(...LEGACY_VENDOR_KEY_CHARS);

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

function toText(value) {
  return value == null ? '' : String(value);
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

const DOMESTIC_SUPPLY_PLATFORMS = ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'];

function inferDomesticSupplyPlatform(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const platform = String(data.sourcePlatform || data.platform || '').trim().toLowerCase();
  if (DOMESTIC_SUPPLY_PLATFORMS.indexOf(platform) >= 0) return platform;
  const url = String(data.sourceUrl || data.tabUrl || data.sourceHost || '').toLowerCase();
  if (/(^|\.)1688\.com/i.test(url)) return '1688';
  if (/(^|\.)taobao\.com/i.test(url)) return 'taobao';
  if (/(^|\.)tmall\.com/i.test(url)) return 'tmall';
  if (/(^|\.)jd\.com/i.test(url)) return 'jd';
  if (/(^|\.)(pinduoduo|yangkeduo)\.com/i.test(url)) return 'pinduoduo';
  return '';
}

function isDomesticSupplyCollectPayload(payload) {
  return !!inferDomesticSupplyPlatform(payload);
}

function normalizeCollectAttributeRecord(attributes) {
  if (!Array.isArray(attributes)) {
    return attributes && typeof attributes === 'object' ? attributes : undefined;
  }
  return attributes.reduce((record, item) => {
    if (!item || typeof item !== 'object') return record;
    const key = String(item.name || item.key || item.attrName || '').trim();
    const value = String(item.value || item.attrValue || item.text || '').trim();
    if (key && value) record[key] = value;
    return record;
  }, {});
}

function normalizeCollectPayloadForEndpoint(payload) {
  if (!isDomesticSupplyCollectPayload(payload)) {
    return { path: '/api/collect', body: payload || {} };
  }
  const data = payload && typeof payload === 'object' ? payload : {};
  return {
    path: '/api/collect/1688',
    body: {
      title: data.title,
      sourcePlatform: inferDomesticSupplyPlatform(data) || '1688',
      sourceUrl: data.sourceUrl || data.tabUrl,
      offerId: data.offerId || data.productId || data.sourceProductId || data.sku,
      sku: data.sku || data.productId,
      images: Array.isArray(data.images) ? data.images : undefined,
      price: data.price,
      priceText: data.priceText || data.price,
      currency: data.currency || 'CNY',
      categoryPath: data.categoryPath || data.categoryName,
      shopName: data.shopName,
      supplierName: data.supplierName || data.shopName,
      supplierLocation: data.supplierLocation,
      supplierYears: data.supplierYears,
      monthlySales: data.monthlySales,
      grossWeightGrams: data.grossWeightGrams,
      lengthMm: data.lengthMm,
      widthMm: data.widthMm,
      heightMm: data.heightMm,
      dimensionsText: data.dimensionsText,
      minOrderQty: data.minOrderQty,
      shippingInfo: data.shippingInfo,
      logisticsText: data.logisticsText,
      customizationInfo: data.customizationInfo,
      attributes: normalizeCollectAttributeRecord(data.attributes),
      skuItems: Array.isArray(data.skuItems) ? data.skuItems : data.variants,
      description: data.description,
      notes: data.notes,
      raw: {
        extractor: data.extractor || null,
        warnings: data.warnings || [],
        debug: data.debug || null,
        priceCheckContext: data.priceCheckContext || null,
        collectedAt: data.collectedAt || null,
      },
    },
  };
}

function normalizeOzonPriceCheckContext(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const images = Array.isArray(data.images)
    ? data.images.map((url) => toText(url).trim()).filter((url) => /^https?:\/\//i.test(url)).slice(0, 8)
    : [];
  const productId = toText(data.productId || data.ozonProductId).trim();
  return {
    sourcePlatform: 'ozon',
    productId,
    ozonProductId: toText(data.ozonProductId || data.productId).trim(),
    sku: toText(data.sku || data.ozonSku).trim(),
    ozonSku: toText(data.ozonSku || data.sku).trim(),
    offerId: toText(data.offerId || data.offer_id || data.ozonOfferId).trim(),
    ozonOfferId: toText(data.ozonOfferId || data.offerId || data.offer_id).trim(),
    title: toText(data.title).trim().slice(0, 300),
    price: data.price != null && data.price !== '' ? data.price : null,
    currency: toText(data.currency || 'RUB').trim().toUpperCase() || 'RUB',
    images,
    sourceUrl: normalizeEndpoint(data.sourceUrl),
    avgPriceRub: data.avgPriceRub != null ? data.avgPriceRub : null,
    soldCount30d: data.soldCount30d != null ? data.soldCount30d : null,
    createdAt: safeIsoDate(data.createdAt || new Date().toISOString()),
  };
}

function build1688SearchUrlFromOzonContext(context) {
  const imageUrl = Array.isArray(context.images) ? context.images.find((url) => /^https?:\/\//i.test(url)) : '';
  if (imageUrl) {
    return 'https://s.1688.com/youyuan/index.htm?tab=imageSearch&imageAddress=' + encodeURIComponent(imageUrl);
  }
  const keyword = toText(context.title || context.productId || '').trim();
  return 'https://s.1688.com/selloffer/offer_search.htm?keywords=' + encodeURIComponent(keyword || 'ozon');
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
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!response || !response.ok) {
    throw new Error(`请求失败：${response ? response.status : 'no-response'} ${url}`);
  }
  return response.text();
}

async function fetchJsonOrThrow(url, options) {
  const input = options && typeof options === 'object' ? options : {};
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: input.credentials || 'omit',
    headers: Object.assign({
      accept: 'application/json',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }, input.headers || {}),
  });
  if (!response || !response.ok) {
    throw new Error(`请求失败：${response ? response.status : 'no-response'} ${url}`);
  }
  const payload = await response.json();
  if (isOzonChallengePayload(payload)) {
    throw new Error('Ozon 帮助中心返回风控验证，请先打开帮助中心页面通过验证');
  }
  return payload;
}

function isOzonChallengePayload(payload) {
  return Boolean(payload && typeof payload === 'object' && (
    payload.challengeURL
    || payload.incidentId
    || payload.blockURL
  ));
}

async function primeOzonCommissionSession() {
  for (const url of OZON_COMMISSION_BOOTSTRAP_URLS) {
    try {
      await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      return true;
    } catch (error) {
      // Ozon may return an anti-bot page here. The API retry below is still useful
      // because this request can set the redirect/session cookies first.
    }
  }
  return false;
}

async function getOrCreateOzonHelpTab() {
  const tabs = await chrome.tabs.query({ url: 'https://global-help.ozon.com/*' });
  const selected = tabs.find((tab) => (tab.url || '').includes('/commissions/ozon-fees/commissions'))
    || tabs.find((tab) => tab.active)
    || tabs[0];
  if (selected && selected.id) {
    await waitForChromeTabReady(selected.id, 12000).catch(() => {});
    return selected;
  }

  const created = await chrome.tabs.create({
    url: OZON_COMMISSION_BOOTSTRAP_URLS[0],
    active: false,
  });
  if (!created || !created.id) {
    throw new Error('无法打开 Ozon 帮助中心页面');
  }
  await waitForChromeTabReady(created.id, 20000).catch(() => {});
  return created;
}

function waitForChromeTabReady(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      reject(new Error('标签页无效'));
      return;
    }

    let done = false;
    const finish = (ok, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      if (ok) resolve();
      else reject(error || new Error('页面加载超时'));
    };

    const timer = setTimeout(() => finish(false), timeoutMs || 12000);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(true);
    };
    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(false, new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab && tab.status === 'complete') finish(true);
    });
  });
}

async function fetchCommissionPayloadViaHelpTab(url) {
  const tab = await getOrCreateOzonHelpTab();
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [url],
      func: async (targetUrl) => {
        try {
          const response = await fetch(targetUrl, {
            cache: 'no-store',
            credentials: 'include',
            headers: {
              accept: 'application/json,text/plain,*/*',
              'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
          });
          const text = await response.text();
          if (!response.ok) {
            return { ok: false, error: 'HTTP ' + response.status + ': ' + text.slice(0, 200) };
          }
          try {
            const payload = JSON.parse(text);
            if (payload && (payload.challengeURL || payload.incidentId || payload.blockURL)) {
              return { ok: false, challenge: true, error: 'Ozon 帮助中心需要验证' };
            }
            return { ok: true, payload };
          } catch (error) {
            return { ok: false, error: 'JSON 解析失败: ' + text.slice(0, 200) };
          }
        } catch (error) {
          return { ok: false, error: error && error.message ? error.message : String(error) };
        }
      },
    });
  } catch (error) {
    throw new Error('无法在 Ozon 帮助中心页面请求佣金表。请手动打开 global-help.ozon.com 佣金页，通过验证后重试同步。');
  }
  const result = results && results[0] ? results[0].result : null;
  if (!result || !result.ok) {
    const message = result && result.challenge
      ? 'Ozon 帮助中心需要验证。请打开 global-help.ozon.com 佣金页完成验证后，再点击同步。'
      : (result && result.error ? result.error : '帮助中心页面请求没有返回结果');
    throw new Error(message);
  }
  return result.payload;
}

async function syncCommissionSnapshot() {
  const parser = globalThis.OZON_CALC_COMMISSION_RATES;
  if (!parser || typeof parser.buildSnapshotFromHtml !== 'function') {
    throw new Error('佣金费率解析器未加载');
  }
  if (typeof parser.buildSnapshotFromOzonDocumentPayload !== 'function') {
    throw new Error('Ozon 佣金文档解析器未加载');
  }
  let snapshot = null;
  let lastError = null;
  await primeOzonCommissionSession();
  for (const url of OZON_COMMISSION_API_URLS) {
    try {
      let payload;
      try {
        payload = await fetchJsonOrThrow(url, { credentials: 'include' });
      } catch (directError) {
        lastError = directError;
        payload = await fetchCommissionPayloadViaHelpTab(url);
      }
      snapshot = parser.buildSnapshotFromOzonDocumentPayload(payload, url);
      if (snapshot && Array.isArray(snapshot.rules) && snapshot.rules.length) {
        await chrome.storage.local.set({ [OZON_COMMISSION_SNAPSHOT_KEY]: snapshot });
        return snapshot;
      }
      throw new Error('未能从 Ozon 文档接口解析到佣金费率表');
    } catch (error) {
      lastError = error;
    }
  }
  let html = '';
  let sourceUrl = '';
  await primeOzonCommissionSession();
  for (const url of OZON_COMMISSION_DOC_URLS) {
    try {
      html = await fetchTextOrThrow(url);
      sourceUrl = url;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!html) throw lastError || new Error('无法请求 Ozon 佣金文档。请先在浏览器打开 global-help.ozon.com 佣金页面，通过验证后重试同步。');
  const htmlSnapshot = parser.buildSnapshotFromHtml(html, sourceUrl);
  if (!htmlSnapshot || !Array.isArray(htmlSnapshot.rules) || !htmlSnapshot.rules.length) {
    throw new Error('未能从 Ozon 帮助中心解析到佣金费率表');
  }
  await chrome.storage.local.set({ [OZON_COMMISSION_SNAPSHOT_KEY]: htmlSnapshot });
  return htmlSnapshot;
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === OZON_CALC_SYNC_CHANNEL) {
    const schema = globalThis.OZON_CALC_SYNC_SCHEMA;
    const snapshot = schema && typeof schema.normalizeSnapshot === 'function'
      ? schema.normalizeSnapshot(message.payload || {})
      : (message.payload || null);
    chrome.storage.local.set({
      [OZON_CALC_CONFIG_SNAPSHOT_KEY]: snapshot,
      [OZON_CALC_CONFIG_UPDATED_AT_KEY]: new Date().toISOString(),
    }).then(() => {
      sendResponse({ ok: true });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
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

  if (message.type === 'ss-erp:start-1688-price-check') {
    Promise.resolve().then(() => {
      const context = normalizeOzonPriceCheckContext(message.payload || {});
      if (!context.title && !context.productId && !context.images.length) {
        throw new Error('缺少 Ozon 商品信息，无法打开 1688 核价');
      }
      const url = build1688SearchUrlFromOzonContext(context);
      return chrome.storage.local.set({ [OZON_1688_PRICE_CHECK_CONTEXT_KEY]: context }).then(() => (
        chrome.tabs.create({ url, active: true })
      )).then((tab) => {
        sendResponse({ ok: true, url, tabId: tab && tab.id });
      });
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
      const normalized = normalizeCollectPayloadForEndpoint(message.payload || {});
      const collectUrl = baseEndpoint.replace(/\/api\/.*$/, '') + normalized.path;
      const headers = { 'content-type': 'application/json;charset=utf-8' };
      headers.authorization = 'Bearer ' + token;
      return fetch(collectUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(normalized.body),
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
      const queryUrl = baseEndpoint.replace(/\/api\/.*$/, '') + '/api/collect/status?sku=' + encodeURIComponent(sku) + '&sourcePlatform=ozon';
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
        body: JSON.stringify({ skus: skus.slice(0, 100), sourcePlatform: 'ozon' }),
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
    chrome.storage.local.set({
      [OZON_CALC_ERP_ENDPOINT_KEY]: endpoint,
      [OZON_CALC_ERP_TOKEN_KEY]: token,
      ss_erp_connection: { baseUrl, token },
    }).then(() => {
      if (self.SS_ERP_RUNTIME) self.SS_ERP_RUNTIME.syncRuntimeMode();
      sendResponse({ ok: true, endpoint, hasToken: Boolean(token) });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calc:erp-endpoint-get') {
    chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY, OZON_CALC_ERP_PUSH_HISTORY_KEY]).then((result) => {
      const history = Array.isArray(result[OZON_CALC_ERP_PUSH_HISTORY_KEY]) ? result[OZON_CALC_ERP_PUSH_HISTORY_KEY] : [];
      sendResponse({
        ok: true,
        endpoint: toText(result[OZON_CALC_ERP_ENDPOINT_KEY]).trim(),
        hasToken: Boolean(toText(result[OZON_CALC_ERP_TOKEN_KEY]).trim()),
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
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_CONFIG_SNAPSHOT_KEY, OZON_CALC_CONFIG_UPDATED_AT_KEY, OZON_OFFICIAL_SNAPSHOT_KEY, OZON_COMMISSION_SNAPSHOT_KEY, OZON_FX_SNAPSHOT_KEY]).then((result) => {
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const snapshot = result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || null;
      const officialSnapshot = result[OZON_OFFICIAL_SNAPSHOT_KEY] || null;
      const commissionSnapshot = result[OZON_COMMISSION_SNAPSHOT_KEY] || null;
      const fxSnapshot = result[OZON_FX_SNAPSHOT_KEY] || null;
      sendResponse({
        ok: true,
        counts: buildCaptureCounts(entries),
        latestCapturedAt: latestCapturedAt(entries),
        configUpdatedAt: toText(result[OZON_CALC_CONFIG_UPDATED_AT_KEY]),
        selectedServiceCount: snapshot && snapshot.userConfig && Array.isArray(snapshot.userConfig.selectedServiceIds)
          ? snapshot.userConfig.selectedServiceIds.length
          : 0,
        officialSampleCount: officialSnapshot && Array.isArray(officialSnapshot.tariffs) ? officialSnapshot.tariffs.length : 0,
        officialUpdatedAt: officialSnapshot && officialSnapshot.metadata ? toText(officialSnapshot.metadata.syncedAt) : '',
        commissionRuleCount: commissionSnapshot && Array.isArray(commissionSnapshot.rules) ? commissionSnapshot.rules.length : 0,
        commissionUpdatedAt: commissionSnapshot ? toText(commissionSnapshot.fetchedAt) : '',
        fxCurrencyCount: fxSnapshot && fxSnapshot.cnyPerCurrency ? Object.keys(fxSnapshot.cnyPerCurrency).length : 0,
        fxUpdatedAt: fxSnapshot ? toText(fxSnapshot.fetchedAt) : '',
        commissionSnapshot,
        fxSnapshot,
        snapshot,
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:build-config-from-captured-seller') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_CONFIG_SNAPSHOT_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('后台物流数据存储未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const sellerHar = store.buildHarPayload(entries, 'seller');
      const snapshot = buildConfigSnapshotFromSellerHar(
        sellerHar,
        message.selectedServiceIds,
        result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || null
      );
      return chrome.storage.local.set({
        [OZON_CALC_CONFIG_SNAPSHOT_KEY]: snapshot,
        [OZON_CALC_CONFIG_UPDATED_AT_KEY]: new Date().toISOString(),
      }).then(() => {
        sendResponse({
          ok: true,
          snapshot,
          serviceCount: snapshot.catalogSnapshot.services.length,
          selectedServiceCount: snapshot.userConfig.selectedServiceIds.length,
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:sync-captured-seller-official') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY, OZON_CALC_CONFIG_SNAPSHOT_KEY]).then((result) => {
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
        result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || null
      );
      let officialSnapshot = null;
      let officialError = '';
      try {
        officialSnapshot = buildOfficialSnapshotFromHar(officialHar);
      } catch (error) {
        officialError = error && error.message ? error.message : String(error);
      }
      const values = {
        [OZON_CALC_CONFIG_SNAPSHOT_KEY]: snapshot,
        [OZON_CALC_CONFIG_UPDATED_AT_KEY]: new Date().toISOString(),
      };
      if (officialSnapshot) values[OZON_OFFICIAL_SNAPSHOT_KEY] = officialSnapshot;
      return chrome.storage.local.set(values).then(() => {
        sendResponse({
          ok: true,
          snapshot,
          officialSnapshot,
          officialError,
          sellerEntryCount: sellerHar.log.entries.length,
          officialEntryCount: officialHar.log.entries.length,
          serviceCount: snapshot.catalogSnapshot.services.length,
          selectedServiceCount: snapshot.userConfig.selectedServiceIds.length,
          officialSampleCount: officialSnapshot && Array.isArray(officialSnapshot.tariffs) ? officialSnapshot.tariffs.length : 0,
        });
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  if (message.type === 'ozon-calculator:sync-captured-official') {
    chrome.storage.local.get([OZON_CALC_CAPTURE_ENTRIES_KEY]).then((result) => {
      const store = globalThis.OZON_CALC_CAPTURE_STORE;
      if (!store || typeof store.buildHarPayload !== 'function') {
        throw new Error('后台物流数据存储未加载');
      }
      const entries = Array.isArray(result[OZON_CALC_CAPTURE_ENTRIES_KEY]) ? result[OZON_CALC_CAPTURE_ENTRIES_KEY] : [];
      const officialHar = store.buildHarPayload(entries, 'official');
      const officialSnapshot = buildOfficialSnapshotFromHar(officialHar);
      return chrome.storage.local.set({
        [OZON_OFFICIAL_SNAPSHOT_KEY]: officialSnapshot,
      }).then(() => {
        sendResponse({
          ok: true,
          officialSnapshot,
          officialEntryCount: officialHar.log.entries.length,
          officialSampleCount: officialSnapshot.tariffs.length,
        });
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
    chrome.storage.local.get([OZON_CALC_CONFIG_SNAPSHOT_KEY]).then((result) => {
      const schema = globalThis.OZON_CALC_SYNC_SCHEMA;
      if (!schema || typeof schema.mergeSnapshotFormState !== 'function') {
        throw new Error('同步配置结构未加载');
      }
      const snapshot = schema.mergeSnapshotFormState(
        result[OZON_CALC_CONFIG_SNAPSHOT_KEY] || {},
        message.formState || {}
      );
      return chrome.storage.local.set({
        [OZON_CALC_CONFIG_SNAPSHOT_KEY]: snapshot,
        [OZON_CALC_CONFIG_UPDATED_AT_KEY]: new Date().toISOString(),
      }).then(() => {
        sendResponse({
          ok: true,
          snapshot,
        });
      });
    }).catch((error) => {
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
    chrome.cookies.getAll({ domain: '.ozon.ru' }).then((cookies) => {
      const sellerCookies = cookies.filter((c) =>
        c.domain.includes('seller.ozon.ru') || c.domain === '.ozon.ru'
      );
      const cookieStr = sellerCookies.map((c) => c.name + '=' + c.value).join('; ');
      if (!cookieStr) throw new Error('未检测到 seller.ozon.ru 登录态，请先登录卖家后台');

      const companyId = message.payload && message.payload.companyId;

      return chrome.storage.local.get([OZON_CALC_ERP_ENDPOINT_KEY, OZON_CALC_ERP_TOKEN_KEY]).then((result) => {
        const baseEndpoint = normalizeEndpoint(result[OZON_CALC_ERP_ENDPOINT_KEY]);
        if (!baseEndpoint) throw new Error('请先在插件设置中配置 ERP 地址');
        const token = toText(result[OZON_CALC_ERP_TOKEN_KEY]).trim();
        if (!token) throw new Error('请先在插件设置中配置 ERP Token');
        const apiBase = baseEndpoint.replace(/\/api\/.*$/, '');
        const body = { cookie: cookieStr };
        if (companyId) body.companyId = String(companyId);
        return fetch(apiBase + '/api/shops/' + encodeURIComponent(shopId) + '/ozon-cdn-auth', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
          body: JSON.stringify(body),
        }).then((res) => res.json());
      }).then((data) => {
        if (data && data.code === 1) {
          sendResponse({ ok: true, msg: 'Cookie 已同步到该店铺', data: data.data });
        } else {
          throw new Error((data && data.msg) || '同步失败');
        }
      });
    }).catch((error) => {
      sendResponse({ ok: false, error: error && error.message ? error.message : String(error) });
    });
    return true;
  }

  // ─── 仅同步 Company ID 到指定店铺 ───
  if (message.type === 'ozon-calc:sync-ozon-company-id') {
    const shopId = message.payload && message.payload.shopId;
    const companyId = message.payload && message.payload.companyId;
    if (!shopId || !companyId) {
      sendResponse({ ok: false, error: '缺少 shopId 或 companyId' });
      return false;
    }
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
