const STORAGE_KEYS = {
  config: "spb_self_hosted_config",
  lastCollected: "spb_self_hosted_last_collected"
};

var SS_ERP_COLLECT_LEGACY_OZON_COMPANY_ID_STORAGE_KEY = "ss_erp_ozon_company_id";
var SS_ERP_COLLECT_LEGACY_OZON_COMPANY_ID_CAPTURED_AT_STORAGE_KEY = "ss_erp_ozon_company_id_captured_at";
var SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_KEY = "ss_erp_ozon_company_id_session";
var SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_CAPTURED_AT_KEY = "ss_erp_ozon_company_id_session_captured_at";
var SS_ERP_COLLECT_OZON_INVALID_COMPANY_ID_STORAGE_KEY = "ss_erp_ozon_company_id_invalid";
var SS_ERP_COLLECT_RECENT_COMPANY_ID_MS = 10 * 60 * 1000;

const DEFAULT_CONFIG = {
  erpBaseUrl: "",
  erpPushPath: "/api/extensions/products/import",
  erpToken: "",
  requestMethod: "POST",
  includeRawPayload: false,
  timeoutMs: 20000,
  extraHeadersJson: "{}",
  debugMode: true
};

const OZON_ENDPOINTS = {
  analytics: "https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/data/v3",
  bundleByVariantId: "https://seller.ozon.ru/api/site/seller-prototype/create-bundle-by-variant-id",
  chartsGraph: "https://seller.ozon.ru/api/site/seller-analytics/charts/graph",
  chartsTable: "https://seller.ozon.ru/api/site/seller-analytics/charts/table",
  // V3 API (richer data, period comparison)
  chartsV3: "https://seller.ozon.ru/api/site/seller-analytics/charts/v3",
  chartsV3TableBySku: "https://seller.ozon.ru/api/site/seller-analytics/charts/v3/table/by_sku",
  chartsV3TableTotals: "https://seller.ozon.ru/api/site/seller-analytics/charts/v3/table/totals",
  chartsV3Recommendation: "https://seller.ozon.ru/api/site/seller-analytics/charts/v3/recommendation",
  salesFunnelRevenue: "https://seller.ozon.ru/api/site/seller-analytics/sales-funnel/v2/get_chart_revenue",
  sellerCategoryTree: "https://seller.ozon.ru/api/site/seller-analytics/charts/seller-category-tree",
  // Market data (may require Premium)
  whatToSellAllQueries: "https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/all_queries/v2",
  whatToSellTrends: "https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/trends/v2",
  whatToSellBestsellers: "https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/ozon_bestsellers/v2",
  whatToSellCompetitivePosition: "https://seller.ozon.ru/api/site/seller-analytics/what_to_sell/competitive_position/v2",
  productsList: "https://seller.ozon.ru/api/v1/products/list-by-filter"
};

const SELLER_OZON_ORIGIN = "https://seller.ozon.ru/*";
const SELLER_OZON_PERMISSION_ERROR = "扩展未获得 seller.ozon.ru 站点访问权限。请点击同步按钮时允许授权，或在 Chrome 扩展详情页把“网站访问权限”设为允许 seller.ozon.ru，然后刷新 seller 页面重试。";
const OZON_COLLECT_ENRICHMENT_QUEUE_KEY = "ss_erp_ozon_collect_enrichment_queue";
let ozonCollectEnrichmentRunQueue = Promise.resolve();

function normalizeErrorMessage(error) {
  return error && error.message ? error.message : String(error || "");
}

function containsCjkText(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function normalizeCollectedTitleText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickOzonRussianTitleFromInsights(insights) {
  const candidates = [];
  const item = insights && insights.item || {};
  const detail = insights && insights.detail || {};
  const analytics = insights && insights.analytics || {};
  candidates.push(item.name, item.title, item.productName);
  candidates.push(detail.name, detail.title, detail.productName);
  if (Array.isArray(analytics.items)) {
    for (const row of analytics.items) {
      candidates.push(row && row.name, row && row.title, row && row.productName);
    }
  }

  for (const candidate of candidates) {
    const title = normalizeCollectedTitleText(candidate);
    if (title && !containsCjkText(title)) return title;
  }
  return "";
}

function repairOzonCollectedTitleFromInsights(product, insights) {
  if (!product || typeof product !== "object") return product;
  const nextTitle = pickOzonRussianTitleFromInsights(insights);
  if (!nextTitle) return product;

  const currentTitle = normalizeCollectedTitleText(product.title);
  const currentPublishTitle = normalizeCollectedTitleText(product.publishTitle);
  const currentSourceTitle = normalizeCollectedTitleText(product.sourceTitleRaw);
  const needsRepair = !currentTitle
    || containsCjkText(currentTitle)
    || containsCjkText(currentPublishTitle)
    || containsCjkText(currentSourceTitle);
  if (!needsRepair) return product;

  const translated = [currentTitle, currentPublishTitle, currentSourceTitle]
    .find((value) => value && containsCjkText(value));
  if (translated && translated !== nextTitle && !product.sourceTitleTranslated) {
    product.sourceTitleTranslated = translated;
  }
  product.title = nextTitle;
  product.publishTitle = nextTitle;
  product.sourceTitleRaw = nextTitle;
  product.sourceLocale = "ru";
  return product;
}

function enqueueOzonCollectEnrichment(task) {
  const run = ozonCollectEnrichmentRunQueue.then(() => task());
  ozonCollectEnrichmentRunQueue = run.catch(() => {});
  return run;
}

async function readOzonCollectEnrichmentQueue() {
  const queue = await storageGet(OZON_COLLECT_ENRICHMENT_QUEUE_KEY);
  return Array.isArray(queue) ? queue : [];
}

async function writeOzonCollectEnrichmentQueue(queue) {
  await storageSet({ [OZON_COLLECT_ENRICHMENT_QUEUE_KEY]: Array.isArray(queue) ? queue : [] });
}

async function enqueueOzonCollectEnrichmentJob(job) {
  const queue = await readOzonCollectEnrichmentQueue();
  queue.push({
    productIds: Array.isArray(job && job.productIds) ? job.productIds.map((id) => String(id || "").trim()).filter(Boolean) : [],
    queuedAt: new Date().toISOString(),
  });
  await writeOzonCollectEnrichmentQueue(queue);
}

async function runOzonCollectEnrichmentJob(job, erpConn) {
  const pids = Array.isArray(job && job.productIds) ? job.productIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  if (!pids.length) return { ok: true, skipped: true };

  const sellerCompanyId = await getSellerCompanyId().catch(() => null);
  const collectPolicy = resolveOzonCollectionPolicy({ mode: "complete" });
  const collected = [];
  const errors = [];

  for (let i = 0; i < pids.length; i++) {
    const pid = pids[i];
    const r = await fetchOzonProductViaTab(pid);
    if (!r.ok) {
      errors.push({ productId: pid, error: r.error || "OZON 公开数据获取失败" });
      continue;
    }

    const productData = r.data;
    await completeOzonProductVariantsForCollection(productData, pid, collectPolicy);

    if (sellerCompanyId && collectPolicy.fetchRootSellerInsights) {
      try {
        const insights = await getOzonInsights(pid);
        repairOzonCollectedTitleFromInsights(productData, insights);
        if (insights.detail && Array.isArray(insights.detail.attributes)) {
          productData.ozonAttributes = insights.detail.attributes;
        }
        if (insights.detail) {
          productData.weight = insights.detail.weight || (insights.specs && insights.specs.weightGrams) || null;
          productData.length = insights.detail.depth || (insights.specs && insights.specs.lengthMm) || null;
          productData.width = insights.detail.width || (insights.specs && insights.specs.widthMm) || null;
          productData.height = insights.detail.height || (insights.specs && insights.specs.heightMm) || null;
          if (insights.detail.manufacturer) productData.manufacturerName = insights.detail.manufacturer;
          if (insights.detail.brand) productData.brandName = insights.detail.brand;
        } else if (insights.specs) {
          productData.weight = insights.specs.weightGrams;
          productData.length = insights.specs.lengthMm;
          productData.width = insights.specs.widthMm;
          productData.height = insights.specs.heightMm;
        }

        try {
          const treeRes = await sellerTabFetchJson(
            "https://seller.ozon.ru/api/v1/seller-tree/resolve/by-sku",
            { skus: [String(pid)] },
            sellerCompanyId
          );
          const resolved = treeRes && treeRes.resolved_categories_by_sku && treeRes.resolved_categories_by_sku[String(pid)];
          if (resolved) {
            productData.descriptionCategoryId = resolved.description_category_id_level_3 || null;
            productData.typeId = resolved.description_type_id || null;
          }
        } catch (e) {}

        if (Array.isArray(productData.variants) && productData.variants.length > 0) {
          const subPids = productData.variants
            .map((v) => v && v.sku ? String(v.sku) : null)
            .filter((s) => s && s !== String(pid));
          if (subPids.length) {
            const subMap = await fetchVariantInsightsConcurrent(subPids, 2, 200);
            productData.variants.forEach((v) => {
              if (!v || !v.sku) return;
              const sku = String(v.sku);
              if (sku === String(pid)) {
                v.ozonAttributes = productData.ozonAttributes || null;
                v.weight = productData.weight || null;
                v.depth = productData.length || null;
                v.width = productData.width || null;
                v.height = productData.height || null;
              } else if (subMap[sku] && subMap[sku].attributes) {
                v.ozonAttributes = subMap[sku].attributes;
                v.weight = subMap[sku].weight;
                v.depth = subMap[sku].depth;
                v.width = subMap[sku].width;
                v.height = subMap[sku].height;
                if (subMap[sku].manufacturer) v.manufacturerName = subMap[sku].manufacturer;
                if (subMap[sku].brand) v.brandName = subMap[sku].brand;
              } else {
                v._attrMissing = (subMap[sku] && subMap[sku].error) || "no insights";
              }
            });
          }
        }
      } catch (e) {}
    }

    if (Array.isArray(productData.variants) && productData.variants.length > 0) {
      productData.variants = sanitizeCollectedOzonVariantAttrs(productData.variants);
    }
    collected.push(productData);
  }

  if (!collected.length) {
    return { ok: false, error: errors[0] && errors[0].error ? errors[0].error : "完整补全失败", errors };
  }

  return pushOzonCollectedProductsToErp(erpConn.baseUrl, erpConn.token, collected, errors, {
    phase: "enrichment",
  });
}

async function flushOzonCollectEnrichmentQueue() {
  return enqueueOzonCollectEnrichment(async () => {
    const erpConn = await getStoredErpConnection();
    if (!erpConn.baseUrl || !erpConn.token) return;

    const queue = await readOzonCollectEnrichmentQueue();
    if (!queue.length) return;

    const remaining = [];
    for (let index = 0; index < queue.length; index += 1) {
      const job = queue[index];
      try {
        const result = await runOzonCollectEnrichmentJob(job, erpConn);
        if (!result || result.ok !== true) remaining.push(job);
      } catch (error) {
        remaining.push(job);
      }
    }
    await writeOzonCollectEnrichmentQueue(remaining);
  });
}

function normalizeRichDescriptionText(value) {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function visitRichDescriptionValue(value, parts, seen, depth) {
  if (value == null || depth > 8) return;
  if (typeof value === "string") {
    const text = normalizeRichDescriptionText(value);
    if (text) parts.push(text);
    return;
  }
  if (typeof value !== "object") return;
  if (seen.indexOf(value) >= 0) return;
  seen.push(value);
  if (Array.isArray(value)) {
    for (const item of value) visitRichDescriptionValue(item, parts, seen, depth + 1);
    return;
  }
  const preferredKeys = ["content", "text", "value", "title", "description", "children", "items", "blocks", "nodes"];
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      visitRichDescriptionValue(value[key], parts, seen, depth + 1);
    }
  }
}

function extractRichDescriptionPayload(state) {
  if (!state || typeof state !== "object") return { text: "", richJson: null };
  const richJson = state.richAnnotationJson || (state.richAnnotation && typeof state.richAnnotation === "object" ? state.richAnnotation : null);
  const candidates = [state.richAnnotation, state.description, state.text, state.content, richJson];
  let text = "";
  for (const candidate of candidates) {
    const parts = [];
    visitRichDescriptionValue(candidate, parts, [], 0);
    const next = normalizeRichDescriptionText(parts.join("\n")).slice(0, 5000);
    if (next && next.length > text.length) text = next;
  }
  return { text, richJson };
}

function resolveOzonCollectionPolicy(options) {
  if (globalThis.SS_ERP_OZON_COLLECTION_POLICY && typeof globalThis.SS_ERP_OZON_COLLECTION_POLICY.resolveOzonCollectionPolicy === "function") {
    return globalThis.SS_ERP_OZON_COLLECTION_POLICY.resolveOzonCollectionPolicy(options);
  }
  const mode = options && (options.mode === "complete" || options.collectMode === "complete") ? "complete"
    : (options && (options.mode === "balanced" || options.collectMode === "balanced") ? "balanced" : "quick");
  const complete = mode === "complete";
  return {
    mode,
    discoverVariants: complete,
    fetchRootSellerInsights: true,
    fetchVariantSellerInsights: complete,
    rootProductDelayMs: complete ? 200 : 0,
    recursive: {
      maxPages: complete ? 120 : 0,
      maxDepth: complete ? 3 : 0,
      delayMs: 0,
    },
  };
}

function isHostAccessError(error) {
  return /Cannot access contents|manifest must request permission|respective host|host permission|Missing host permission/i.test(normalizeErrorMessage(error));
}

function isExtensionContextError(error) {
  return /Extension context invalidated|context invalidated|Receiving end does not exist/i.test(normalizeErrorMessage(error));
}

function isOzonCompanyPermissionError(message) {
  return /PermissionDenied|no access to this company|user has no roles/i.test(normalizeErrorMessage(message));
}

function formatOzonCompanyPermissionError(companyId, rawError) {
  const suffix = companyId ? "当前 company_id=" + companyId + "。" : "";
  return "OZON 拒绝访问该店铺分析数据：" + suffix + "请在 seller.ozon.ru 确认已登录有权限的卖家账号，切换到对应店铺后刷新 seller 页面，并在扩展里重新同步 Cookie/company_id。原始错误: " + normalizeErrorMessage(rawError);
}

function chromePermissionsContains(permissions) {
  return new Promise((resolve) => {
    if (!chrome.permissions || typeof chrome.permissions.contains !== "function") {
      resolve(true);
      return;
    }

    chrome.permissions.contains(permissions, (granted) => {
      resolve(!chrome.runtime.lastError && Boolean(granted));
    });
  });
}

async function ensureSellerOzonHostAccess() {
  const granted = await chromePermissionsContains({ origins: [SELLER_OZON_ORIGIN] });
  if (!granted) {
    throw new Error(SELLER_OZON_PERMISSION_ERROR);
  }
}

async function executeScriptWithHostAccess(options, permissionErrorMessage) {
  try {
    return await chrome.scripting.executeScript(options);
  } catch (error) {
    if (isHostAccessError(error)) {
      throw new Error(permissionErrorMessage || SELLER_OZON_PERMISSION_ERROR);
    }
    throw error;
  }
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });
}

function storageSet(patch) {
  return new Promise((resolve) => {
    chrome.storage.local.set(patch, resolve);
  });
}

function storageRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

function storageSessionGet(keys) {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.session) {
      resolve({});
      return;
    }
    chrome.storage.session.get(keys, (result) => resolve(result || {}));
  });
}

function storageSessionSet(patch) {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.session) {
      resolve();
      return;
    }
    chrome.storage.session.set(patch, resolve);
  });
}

function storageSessionRemove(keys) {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.session) {
      resolve();
      return;
    }
    chrome.storage.session.remove(keys, resolve);
  });
}

function normalizeOzonCompanyId(value) {
  return value == null ? "" : String(value).trim();
}

function buildOzonCollectBatchPayload(collected) {
  return {
    items: collected.map((p) => ({
      title: p.title,
      publishTitle: p.publishTitle || p.title,
      sourceTitleRaw: p.sourceTitleRaw || p.title,
      sourceLocale: p.sourceLocale || "ru",
      sourceUrl: p.url,
      sourcePlatform: "ozon",
      images: p.images,
      price: p.price || "",
      priceText: p.priceText || p.price || "",
      currency: p.currency || "RUB",
      description: p.description || "",
      richDescriptionJson: p.richDescriptionJson || null,
      sourceVideos: p.sourceVideos || null,
      sku: String(p.productId),
      sourceProductId: String(p.productId),
      attributes: p.attributes,
      ozonAttributes: p.ozonAttributes || null,
      descriptionCategoryId: p.descriptionCategoryId || null,
      typeId: p.typeId || null,
      weightG: p.weight || null,
      lengthMm: p.length || null,
      widthMm: p.width || null,
      heightMm: p.height || null,
      manufacturerName: p.manufacturerName || null,
      brandName: p.brandName || null,
      variants: Array.isArray(p.variants) && p.variants.length ? p.variants : null,
      modelId: p.modelId ? String(p.modelId) : null,
      widgetStatesDump: p.widgetStatesDump || null,
    })),
  };
}

async function notifyErpCollectCompleted(collectedCount, errorCount, options = {}) {
  try {
    var bridgeMatches = ["http://localhost/*", "https://localhost/*", "http://127.0.0.1/*", "https://127.0.0.1/*"];
    try {
      var mf = chrome.runtime.getManifest();
      var bridge = (mf.content_scripts || []).find(function (cs) {
        return Array.isArray(cs.js) && cs.js.indexOf("content/erp-collect-bridge.js") >= 0;
      });
      if (bridge && Array.isArray(bridge.matches) && bridge.matches.length) {
        bridgeMatches = bridge.matches.filter(function (m) { return /^https?:/.test(m); });
      }
    } catch (e) {}
    var erpTabs = await chrome.tabs.query({ url: bridgeMatches });
    for (var nti = 0; nti < erpTabs.length; nti++) {
      try {
        chrome.tabs.sendMessage(erpTabs[nti].id, {
          type: "ss-erp:collect-completed",
          collected: Number(collectedCount) || 0,
          errorCount: Number(errorCount) || 0,
          phase: options.phase || "collect",
        });
      } catch (e) {}
    }
  } catch (e) {}
}

async function pushOzonCollectedProductsToErp(erpBase, erpToken, collected, errors, options = {}) {
  const batchPayload = buildOzonCollectBatchPayload(collected);
  const pushResp = await fetch(erpBase + "/api/collect/batch", {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Authorization": "Bearer " + erpToken,
    },
    body: JSON.stringify(batchPayload),
  });

  const pushText = await pushResp.text();
  if (!pushResp.ok) {
    return { ok: false, error: "ERP 推送失败: HTTP " + pushResp.status + " " + pushText.slice(0, 200), collected: collected.length, errors };
  }

  let pushParsed = {};
  try { pushParsed = JSON.parse(pushText); } catch (e) {}
  const backendErrors = pushParsed && pushParsed.data && Array.isArray(pushParsed.data.errors)
    ? pushParsed.data.errors
    : [];
  const allErrors = (Array.isArray(errors) ? errors : []).concat(backendErrors);
  if (pushParsed && pushParsed.code === 0) {
    return {
      ok: false,
      error: pushParsed.msg || "ERP 采集失败",
      data: { collected: 0, pushed: pushParsed, errors: allErrors },
    };
  }

  const shouldBroadcast = options.broadcast !== false;
  if (shouldBroadcast) {
    await notifyErpCollectCompleted(collected.length, allErrors.length, {
      phase: options.phase || "collect",
    });
  }

  return {
    ok: true,
    data: {
      collected: collected.length,
      pushed: pushParsed,
      errors: allErrors,
    },
  };
}

function isRecentOzonCompanyIdCapture(value) {
  const capturedAt = Number(value) || 0;
  return capturedAt > 0 && Date.now() - capturedAt <= SS_ERP_COLLECT_RECENT_COMPANY_ID_MS;
}

function rememberRuntimeOzonCompanyId(value, capturedAt) {
  const companyId = normalizeOzonCompanyId(value);
  if (!companyId) return "";
  const nextCapturedAt = Number(capturedAt) || Date.now();
  globalThis.SS_ERP_OZON_COMPANY_ID_CAPTURE = {
    companyId,
    capturedAt: nextCapturedAt
  };
  storageSessionSet({
    [SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_KEY]: companyId,
    [SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_CAPTURED_AT_KEY]: nextCapturedAt
  }).catch(() => {});
  return companyId;
}

function getRuntimeOzonCompanyId() {
  const capture = globalThis.SS_ERP_OZON_COMPANY_ID_CAPTURE || {};
  if (!isRecentOzonCompanyIdCapture(capture.capturedAt)) return "";
  return normalizeOzonCompanyId(capture.companyId);
}

async function getCapturedOzonCompanyId() {
  const runtimeCompanyId = getRuntimeOzonCompanyId();
  if (runtimeCompanyId) return runtimeCompanyId;

  const session = await storageSessionGet([
    SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_KEY,
    SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_CAPTURED_AT_KEY
  ]);
  if (!isRecentOzonCompanyIdCapture(session[SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_CAPTURED_AT_KEY])) {
    return "";
  }
  const companyId = normalizeOzonCompanyId(session[SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_KEY]);
  if (companyId) rememberRuntimeOzonCompanyId(companyId, session[SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_CAPTURED_AT_KEY]);
  return companyId;
}

globalThis.SS_ERP_REMEMBER_OZON_COMPANY_ID = rememberRuntimeOzonCompanyId;

async function getInvalidSellerCompanyId() {
  const value = await storageGet(SS_ERP_COLLECT_OZON_INVALID_COMPANY_ID_STORAGE_KEY);
  if (!value || typeof value !== "object") return "";
  const companyId = normalizeOzonCompanyId(value.companyId);
  const invalidatedAt = Number(value.invalidatedAt) || 0;
  if (!companyId || Date.now() - invalidatedAt > 10 * 60 * 1000) return "";
  return companyId;
}

async function markSellerCompanyIdInvalid(companyId) {
  const normalized = normalizeOzonCompanyId(companyId);
  if (!normalized) return;
  if (getRuntimeOzonCompanyId() === normalized) {
    globalThis.SS_ERP_OZON_COMPANY_ID_CAPTURE = null;
  }
  await storageSessionRemove([
    SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_KEY,
    SS_ERP_COLLECT_SESSION_OZON_COMPANY_ID_CAPTURED_AT_KEY
  ]);
  await storageRemove([
    SS_ERP_COLLECT_LEGACY_OZON_COMPANY_ID_STORAGE_KEY,
    SS_ERP_COLLECT_LEGACY_OZON_COMPANY_ID_CAPTURED_AT_STORAGE_KEY
  ]);
  await storageSet({
    [SS_ERP_COLLECT_OZON_INVALID_COMPANY_ID_STORAGE_KEY]: {
      companyId: normalized,
      invalidatedAt: Date.now()
    }
  });
}

async function getConfig() {
  const saved = await storageGet(STORAGE_KEYS.config);
  return { ...DEFAULT_CONFIG, ...(saved || {}) };
}

async function saveConfig(config) {
  const next = { ...DEFAULT_CONFIG, ...(config || {}) };
  await storageSet({ [STORAGE_KEYS.config]: next });
  return next;
}

async function getLastCollected() {
  return (await storageGet(STORAGE_KEYS.lastCollected)) || null;
}

async function setLastCollected(payload) {
  await storageSet({ [STORAGE_KEYS.lastCollected]: payload });
  return payload;
}

function parseExtraHeaders(rawJson) {
  if (!rawJson || !rawJson.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (error) {
    throw new Error(`额外请求头 JSON 解析失败: ${error.message}`);
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`请求超时: ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function enrichCollectedOzonVariants(variants) {
  const specHelper = globalThis.SS_ERP_OZON_VARIANT_SPEC;
  if (specHelper && typeof specHelper.enrichOzonVariants === "function") {
    return specHelper.enrichOzonVariants(variants);
  }
  return variants;
}

function sanitizeCollectedOzonVariantAttrs(variants) {
  const specHelper = globalThis.SS_ERP_OZON_VARIANT_SPEC;
  if (specHelper && typeof specHelper.sanitizeOzonVariantsAttrs === "function") {
    return specHelper.sanitizeOzonVariantsAttrs(variants);
  }
  return variants;
}

function collectedOzonVariantsNeedSellerRepair(variants) {
  const specHelper = globalThis.SS_ERP_OZON_VARIANT_SPEC;
  const containsCjk = specHelper && typeof specHelper.containsCjkText === "function"
    ? specHelper.containsCjkText
    : containsCjkText;
  if (!Array.isArray(variants)) return false;
  return variants.some((variant) => {
    const attrs = variant && variant.attrs && typeof variant.attrs === "object" && !Array.isArray(variant.attrs)
      ? variant.attrs
      : null;
    if (!attrs) return false;
    return Object.entries(attrs).some(([key, value]) => containsCjk(key) || containsCjk(value));
  });
}

function mergeCollectedOzonVariantLists(baseVariants, incomingVariants) {
  const specHelper = globalThis.SS_ERP_OZON_VARIANT_SPEC;
  if (specHelper && typeof specHelper.mergeOzonVariantLists === "function") {
    return specHelper.mergeOzonVariantLists(baseVariants, incomingVariants);
  }
  return {
    variants: Array.isArray(baseVariants) ? baseVariants : [],
    addedCount: 0,
    mergedCount: 0,
  };
}

function collectOzonVariantDiscoveryRefs(variants, options) {
  const specHelper = globalThis.SS_ERP_OZON_VARIANT_SPEC;
  if (specHelper && typeof specHelper.collectOzonVariantDiscoveryRefs === "function") {
    return specHelper.collectOzonVariantDiscoveryRefs(variants, options);
  }
  return [];
}

function attachOzonVariantDiscoveryDiagnostics(productData, diagnostics) {
  if (!productData || !diagnostics) return;
  const currentDump = productData.widgetStatesDump && typeof productData.widgetStatesDump === "object"
    ? productData.widgetStatesDump
    : {};
  productData.widgetStatesDump = {
    ...currentDump,
    recursiveVariantDiscovery: diagnostics,
  };
}

function normalizeOzonDiscoveryId(value) {
  const text = String(value || "").trim();
  return /^\d{5,}$/.test(text) ? text : "";
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length) {
    throw new Error("没有找到当前标签页");
  }
  return tabs[0];
}

async function collectFromCurrentTab() {
  const tab = await getCurrentTab();
  if (!tab.id) {
    throw new Error("当前标签页没有有效 id");
  }

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "spb-self-hosted:collect-product"
  });

  if (!response || !response.ok) {
    throw new Error((response && response.error) || "采集失败");
  }

  const payload = {
    ...response.data,
    collectedAt: new Date().toISOString(),
    tabTitle: tab.title || "",
    tabUrl: tab.url || response.data.sourceUrl || ""
  };
  if (Array.isArray(payload.variants)) {
    payload.variants = enrichCollectedOzonVariants(payload.variants);
  }

  const ozonProductId = parseOzonProductId(payload.sourceUrl || payload.tabUrl || "");
  if (isOzonProductUrl(payload.sourceUrl || payload.tabUrl || "") && ozonProductId) {
    try {
      const ozonInsights = await getOzonInsights(ozonProductId);
      mergeOzonInsightsIntoProduct(payload, ozonInsights);
    } catch (error) {
      payload.metadata = {
        ...(payload.metadata || {}),
        ozonInsightsError: normalizeErrorMessage(error)
      };
      console.warn("[SS ERP] Ozon seller insights skipped:", error);
    }
  }

  await setLastCollected(payload);
  return payload;
}

function isOzonProductUrl(url) {
  return /^https:\/\/(?:www\.)?ozon\.(?:ru|kz|by)\/product\//i.test(String(url || ""));
}

function parseOzonProductId(url) {
  const path = String(url || "").split(/[?#]/)[0];
  const match = path.match(/(?:-|\/)([0-9]{6,})\/?$/i);
  return match ? match[1] : "";
}

async function getSellerCompanyId(preferredCompanyId) {
  const preferred = normalizeOzonCompanyId(preferredCompanyId);
  if (preferred) {
    return rememberRuntimeOzonCompanyId(preferred);
  }

  const cookieQueries = [
    { url: "https://seller.ozon.ru/", name: "sc_company_id" },
    { domain: ".ozon.ru", name: "sc_company_id" },
    { domain: "seller.ozon.ru", name: "sc_company_id" }
  ];

  for (const query of cookieQueries) {
    try {
      const cookies = await chrome.cookies.getAll(query);
      const companyId = normalizeOzonCompanyId(cookies[0] && cookies[0].value);
      if (companyId) {
        return rememberRuntimeOzonCompanyId(companyId);
      }
    } catch (error) {
      console.warn("[SS ERP] read Ozon company cookie failed:", error);
    }
  }

  const capturedCompanyId = await getCapturedOzonCompanyId();
  if (capturedCompanyId) {
    return capturedCompanyId;
  }

  throw new Error("未检测到 Ozon Seller Company ID。请在本机打开 seller.ozon.ru，选择对应店铺并进入商品/数据分析页面，等待扩展自动捕获 x-o3-company-id 后再重试；也可以在扩展的 Cookie 同步区域手动填写 company_id 并同步。");
}

async function getSellerTab() {
  await ensureSellerOzonHostAccess();

  const tabs = await chrome.tabs.query({ url: "https://seller.ozon.ru/*" });
  if (!tabs.length) {
    throw new Error("请先打开并登录 seller.ozon.ru");
  }

  return tabs.find((tab) => tab.active) || tabs.find((tab) => (tab.url || "").includes("/app/")) || tabs[0];
}

async function sellerTabFetchJson(url, body, companyId) {
  const targetTab = await getSellerTab();

  const results = await executeScriptWithHostAccess({
    target: { tabId: targetTab.id },
    world: "MAIN",
    args: [url, body, companyId],
    func: async (targetUrl, requestBody, xCompanyId) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);

      try {
        const response = await fetch(targetUrl, {
          method: "POST",
          signal: controller.signal,
          credentials: "include",
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json",
            origin: "https://seller.ozon.ru",
            "x-o3-app-name": "seller-ui",
            "x-o3-company-id": xCompanyId,
            "x-o3-language": "ru",
            "x-o3-page-type": "products-other"
          },
          body: JSON.stringify(requestBody)
        });

        clearTimeout(timer);

        if (response.redirected && /\/(signin|login)/i.test(response.url)) {
          return { ok: false, error: "seller.ozon.ru 登录态已过期" };
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { ok: false, error: `HTTP ${response.status}: ${text.slice(0, 160)}` };
        }

        return { ok: true, data: await response.json() };
      } catch (error) {
        clearTimeout(timer);
        if (error && error.name === "AbortError") {
          return { ok: false, error: "seller.ozon.ru 请求超时" };
        }
        return { ok: false, error: error && error.message ? error.message : String(error) };
      }
    }
  });

  const result = results && results[0] ? results[0].result : null;
  if (!result) {
    throw new Error("seller.ozon.ru 请求没有返回结果");
  }
  if (!result.ok) {
    if (isOzonCompanyPermissionError(result.error)) {
      throw new Error(formatOzonCompanyPermissionError(companyId, result.error));
    }
    throw new Error(result.error || "seller.ozon.ru 请求失败");
  }
  return result.data;
}

function buildOzonAnalyticsRequestBody(productId) {
  return {
    filter: {
      stock: "any_stock",
      sku: String(productId)
    },
    sort: {
      key: "sum_rating"
    },
    limit: 50,
    offset: 0
  };
}

function extractOzonSpecifications(productItem) {
  const result = {
    weightGrams: null,
    productWeightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    volumeMm3: null
  };

  const attributes = productItem && Array.isArray(productItem.attributes) ? productItem.attributes : [];
  attributes.forEach((attribute) => {
    const key = String(attribute && attribute.attribute_id != null ? attribute.attribute_id : (attribute.key || ""));
    const rawValue = attribute && Array.isArray(attribute.values) && attribute.values.length
      ? String(attribute.values[0].value || "").trim()
      : (attribute && attribute.value != null ? String(attribute.value).trim() : "");
    if (!rawValue) {
      return;
    }

    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    if (key === "4383") result.productWeightGrams = numericValue;
    if (key === "4497") result.weightGrams = numericValue;
    if (key === "9454") result.lengthMm = numericValue;
    if (key === "9455") result.widthMm = numericValue;
    if (key === "9456") result.heightMm = numericValue;
  });

  if (result.lengthMm && result.widthMm && result.heightMm) {
    result.volumeMm3 = result.lengthMm * result.widthMm * result.heightMm;
  }

  return result;
}

async function getOzonInsights(productId) {
  const companyId = await getSellerCompanyId();
  const analytics = await sellerTabFetchJson(
    OZON_ENDPOINTS.analytics,
    buildOzonAnalyticsRequestBody(productId),
    companyId
  );

  const firstItem = analytics && Array.isArray(analytics.items) && analytics.items.length ? analytics.items[0] : null;
  if (!firstItem) {
    return {
      source: "seller.ozon.ru analytics",
      productId: String(productId),
      analytics,
      item: null,
      detail: null,
      specs: null
    };
  }

  let detail = null;
  let specs = null;
  if (firstItem.variantId) {
    detail = await sellerTabFetchJson(
      OZON_ENDPOINTS.bundleByVariantId,
      {
        company_id: String(companyId),
        variant_id: String(firstItem.variantId),
        source: "SOURCE_UI_COPY_MERGED"
      },
      companyId
    );
    if (detail && detail.item) {
      specs = extractOzonSpecifications(detail.item);
    }
  }

  return {
    source: "seller.ozon.ru analytics + bundle detail",
    productId: String(productId),
    analytics,
    item: firstItem,
    detail: detail && detail.item ? detail.item : null,
    specs
  };
}

// 并发批量拉取多个变体 SKU 的 OZON 真实属性（颜色/尺码/dict_value_id 等）
// 用于多 SKU 复制/跟卖时，每个变体独立属性，避免共用源 SKU 的 cloned attributes 导致合并冲突
async function fetchVariantInsightsConcurrent(skus, concurrency = 2, intervalMs = 200) {
  const out = {};
  let cursor = 0;
  const workerCount = Math.min(concurrency, skus.length);
  if (workerCount <= 0) return out;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < skus.length) {
      const idx = cursor++;
      const sku = String(skus[idx]);
      try {
        const ins = await getOzonInsights(sku);
        if (ins && ins.detail) {
          out[sku] = {
            attributes: Array.isArray(ins.detail.attributes) ? ins.detail.attributes : null,
            weight: ins.detail.weight || null,
            depth: ins.detail.depth || null,
            width: ins.detail.width || null,
            height: ins.detail.height || null,
            manufacturer: ins.detail.manufacturer || null,
            brand: ins.detail.brand || null,
          };
        } else {
          out[sku] = { error: "no detail" };
        }
      } catch (e) {
        out[sku] = { error: (e && e.message) ? e.message.slice(0, 120) : "fetch failed" };
      }
      if (intervalMs) await new Promise((r) => setTimeout(r, intervalMs));
    }
  }));
  return out;
}

function mergeOzonInsightsIntoProduct(product, ozonInsights) {
  if (!product || !ozonInsights) {
    return product;
  }

  const item = ozonInsights.item || {};
  const specs = ozonInsights.specs || {};
  const detail = ozonInsights.detail || {};
  repairOzonCollectedTitleFromInsights(product, ozonInsights);

  if (item.sku) {
    product.productId = String(item.sku);
  }

  if (item.soldCount != null && item.soldCount !== "") {
    const value = Number(item.soldCount);
    if (Number.isFinite(value)) {
      product.monthlySales = value;
    }
  }

  if (specs.weightGrams != null) {
    product.grossWeightGrams = specs.weightGrams;
  }

  // 从 detail 中提取官方图片列表（优先级高于 DOM 采集的图片）
  const detailImages = [];
  if (detail.primaryImage) {
    detailImages.push(detail.primaryImage);
  }
  if (Array.isArray(detail.images)) {
    detail.images.forEach((img) => {
      if (img && typeof img === "string" && !detailImages.includes(img)) {
        detailImages.push(img);
      }
    });
  }
  if (Array.isArray(detail.marketingColor) && detail.marketingColor.length) {
    detail.marketingColor.forEach((mc) => {
      if (mc && mc.url && !detailImages.includes(mc.url)) {
        detailImages.push(mc.url);
      }
    });
  }
  if (detailImages.length > 0) {
    product.images = detailImages;
  }

  const existingSkuItems = Array.isArray(product.skuItems) ? product.skuItems : [];
  const primarySku = {
    skuId: item.sku != null ? String(item.sku) : product.productId || "",
    name: item.name || product.title || "",
    specText: "",
    price: item.avgPrice != null ? Number(item.avgPrice) : null,
    stock: item.stock != null ? Number(item.stock) : null,
    grossWeightGrams: specs.weightGrams != null ? specs.weightGrams : null
  };
  product.skuItems = [primarySku].concat(existingSkuItems.filter((entry) => String(entry.skuId || "") !== primarySku.skuId));
  product.skuCount = product.skuItems.length;

  product.ozonInsights = {
    source: ozonInsights.source,
    sellerId: item.sellerId != null ? String(item.sellerId) : "",
    sellerName: item.sellerName || "",
    brand: item.brand || "",
    category1: item.category1 || "",
    category3: item.category3 || "",
    soldSumRub: item.soldSum != null ? Number(item.soldSum) : null,
    salesDynamicsPercent: item.salesDynamics != null ? Number(item.salesDynamics) : null,
    avgPriceRub: item.avgPrice != null ? Number(item.avgPrice) : null,
    minSellerPriceRub: item.minSellerPrice != null ? Number(item.minSellerPrice) : null,
    addToCartRatePercent: item.convToCartPdp != null ? Number(item.convToCartPdp) : null,
    views: item.views != null ? Number(item.views) : null,
    stock: item.stock != null ? Number(item.stock) : null,
    avgDeliveryDays: item.avgDeliveryDays != null ? Number(item.avgDeliveryDays) : null,
    salesSchema: item.salesSchema || "",
    createDate: item.nullableCreateDate || "",
    dimensionsMm: {
      length: specs.lengthMm != null ? specs.lengthMm : null,
      width: specs.widthMm != null ? specs.widthMm : null,
      height: specs.heightMm != null ? specs.heightMm : null
    }
  };

  product.attributes = mergeAttributes(product.attributes, [
    { name: "brand", value: item.brand || "" },
    { name: "category1", value: item.category1 || "" },
    { name: "category3", value: item.category3 || "" },
    { name: "sellerName", value: item.sellerName || "" },
    { name: "salesSchema", value: item.salesSchema || "" }
  ]);

  product.warnings = (product.warnings || []).filter((warning) => {
    if (product.monthlySales != null && warning.includes("月销量")) return false;
    if (product.grossWeightGrams != null && warning.includes("克重")) return false;
    if (product.skuItems && product.skuItems.length && warning.includes("SKU")) return false;
    return true;
  });

  return product;
}

function mergeAttributes(existing, incoming) {
  const next = Array.isArray(existing) ? existing.slice() : [];
  const seen = new Set(next.map((item) => String(item && item.name ? item.name : "")));

  incoming.forEach((item) => {
    if (!item || !item.name || !item.value) {
      return;
    }
    if (seen.has(item.name)) {
      return;
    }
    seen.add(item.name);
    next.push(item);
  });

  return next;
}

/**
 * 订单物流追踪（纯客户端）
 * 1688 通过 mtop 接口查询，拼多多通过订单页 HTML 解析。
 */
async function trackOrderLogistics(orders, platform) {
  if (!orders || !orders.length) {
    throw new Error("请提供订单列表");
  }

  const results = [];
  const isPdd = platform === "pdd";

  for (const order of orders) {
    const orderId = order.cg_order_no || order.orderId || "";
    if (!orderId) {
      results.push({ ...order, trackingNumber: "", shippingName: "", expressStatus: 2, error: "缺少订单号" });
      continue;
    }

    try {
      const tabResult = await querySingleLogistics(orderId, isPdd);
      results.push({
        parentID: order.parentID || "",
        posting_number: order.posting_number || "",
        cg_order_no: orderId,
        ...tabResult
      });
    } catch (err) {
      results.push({
        parentID: order.parentID || "",
        posting_number: order.posting_number || "",
        cg_order_no: orderId,
        trackingNumber: "",
        shippingName: "",
        expressStatus: 2,
        error: err.message
      });
    }

    // 接口限流
    await new Promise((r) => setTimeout(r, 1000));
  }

  return { results, platform: platform || "1688" };
}

async function querySingleLogistics(orderId, isPdd) {
  if (isPdd) {
    return await queryPddOrderLogistics(orderId);
  }
  return await query1688OrderLogistics(orderId);
}

async function query1688OrderLogistics(orderId) {
  // 找到 1688 已登录的 tab
  const tabs = await chrome.tabs.query({ url: "https://*.1688.com/*" });
  const targetTab = tabs.find((t) => t.active) || tabs[0];
  if (!targetTab) {
    throw new Error("请先打开并登录 1688 订单页面");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: "MAIN",
    args: [orderId],
    func: async (id) => {
      if (!window.lib || !window.lib.mtop) {
        throw new Error("1688 MTOP 不可用，请确认已登录");
      }

      const resp = await window.lib.mtop.request({
        api: "mtop.1688.DeliveryOrderService.queryDeliveryOrderPackList",
        v: "1.0",
        type: "post",
        dataType: "jsonp",
        data: {
          orderId: String(id),
          userType: "buyer",
          needOfferWeight: true
        }
      });

      const ret = (resp.ret || [])[0] || "";
      if (ret.indexOf("SUCCESS") !== 0 || !(resp.data && resp.data.succeed)) {
        throw new Error("1688 物流查询失败: " + ret);
      }

      const model = (resp.data.model || [])[0] || {};
      return {
        trackingNumber: model.mailNo || "",
        shippingName: model.logisticsCompanyName || "",
        expressStatus: model.mailNo ? 1 : 0
      };
    }
  });

  const result = results && results[0] ? results[0].result : null;
  if (!result) throw new Error("1688 物流脚本未返回结果");
  return result;
}

async function queryPddOrderLogistics(orderSn) {
  // 打开 PDD 订单页获取 HTML
  const pddUrl = "https://mobile.pinduoduo.com/order.html" +
    "?order_sn=" + orderSn +
    "&page_from=1&is_tester=1" +
    "&refer_page_name=my_order" +
    "&refer_page_id=10032_" + Date.now() + "_" + Math.random().toString(36).slice(2) +
    "&refer_page_sn=10032";

  // 尝试在已有 PDD tab 上执行
  const tabs = await chrome.tabs.query({ url: "https://mobile.pinduoduo.com/*" });
  const targetTab = tabs[0];
  if (!targetTab) {
    throw new Error("请先打开拼多多订单页面");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    world: "MAIN",
    args: [pddUrl, orderSn],
    func: async (url, sn) => {
      function parseJsStringLiteral(literal) {
        if (!literal || literal.length < 2) return "";
        const quote = literal[0];
        if (quote === '"') return JSON.parse(literal);
        const inner = literal.slice(1, -1).replace(/\\'/g, "'");
        return JSON.parse('"' + inner.replace(/"/g, '\\"') + '"');
      }

      function extractBalancedLiteral(text, startIndex) {
        const open = text[startIndex];
        const close = open === "{" ? "}" : "]";
        let depth = 0;
        let quote = "";
        let escaped = false;
        for (let i = startIndex; i < text.length; i++) {
          const ch = text[i];
          if (quote) {
            if (escaped) {
              escaped = false;
            } else if (ch === "\\") {
              escaped = true;
            } else if (ch === quote) {
              quote = "";
            }
            continue;
          }
          if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            continue;
          }
          if (ch === open) depth++;
          if (ch === close) {
            depth--;
            if (depth === 0) return text.slice(startIndex, i + 1);
          }
        }
        return "";
      }

      function parseWindowRawDataAssignment(text) {
        const match = /window\.rawData\s*=\s*/.exec(text);
        if (!match) return null;
        let index = match.index + match[0].length;
        while (/\s/.test(text[index] || "")) index++;

        if (text.slice(index, index + 10) === "JSON.parse") {
          const paren = text.indexOf("(", index);
          if (paren < 0) return null;
          let argStart = paren + 1;
          while (/\s/.test(text[argStart] || "")) argStart++;
          const quote = text[argStart];
          if (quote !== '"' && quote !== "'") return null;
          let escaped = false;
          for (let i = argStart + 1; i < text.length; i++) {
            const ch = text[i];
            if (escaped) {
              escaped = false;
            } else if (ch === "\\") {
              escaped = true;
            } else if (ch === quote) {
              return JSON.parse(parseJsStringLiteral(text.slice(argStart, i + 1)));
            }
          }
          return null;
        }

        if (text[index] !== "{" && text[index] !== "[") return null;
        const literal = extractBalancedLiteral(text, index);
        return literal ? JSON.parse(literal) : null;
      }

      const resp = await fetch(url, { credentials: "include" });
      const html = await resp.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const scripts = doc.querySelectorAll("script");
      let rawData = null;

      for (const script of scripts) {
        const text = script.textContent || "";
        if (/window\.rawData\s*=/.test(text)) {
          try {
            rawData = parseWindowRawDataAssignment(text);
          } catch (e) { /* ignore */ }
          break;
        }
      }

      if (!rawData || !rawData.data) {
        throw new Error("PDD rawData 解析失败");
      }

      const express = rawData.data.expressInfo || {};
      return {
        trackingNumber: express.trackingNumber || "",
        shippingName: express.shippingName || "",
        expressStatus: express.trackingNumber ? 1 : 0
      };
    }
  });

  const result = results && results[0] ? results[0].result : null;
  if (!result) throw new Error("PDD 物流脚本未返回结果");
  return result;
}

/**
 * 检查 seller.ozon.ru 上 Ozon Premium 模拟是否已激活
 *
 * 返回三种状态:
 *   { active: true, activatedAt }  — 已激活，拦截器正在运行
 *   { active: false, reason: "no_tab" }  — 未打开 seller.ozon.ru
 *   { active: false, reason: "not_injected" }  — 页面已打开但脚本未注入
 */
async function checkOzonPremiumActive() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://seller.ozon.ru/*" });
    if (!tabs.length) {
      return { active: false, reason: "no_tab" };
    }

    // 优先检查已激活的 tab
    for (const tab of tabs) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => {
            const active = !!(window.__SPB_SELF_HOSTED_OZON_PREMIUM_V1__);
            let activatedAt = null;
            try {
              const ts = sessionStorage.getItem("spb_ozon_premium_activated_at");
              if (ts) activatedAt = ts;
            } catch (_) {}
            return { active, activatedAt };
          }
        });

        const data = results && results[0] ? results[0].result : null;
        if (data && data.active) {
          return { active: true, activatedAt: data.activatedAt };
        }
      } catch (_) {
        // 该 tab 可能正在加载中，继续检查下一个
      }
    }

    return { active: false, reason: "not_injected" };
  } catch (_) {
    return { active: false, reason: "error" };
  }
}

/**
 * 检测各平台登录状态（通过 Cookie 判断）
 */
async function checkPlatformLogins() {
  const checks = [
    { key: "a1688", domain: "1688.com", cookieName: "_m_h5_tk" },
    { key: "taobao", domain: "taobao.com", cookieName: "_m_h5_tk" },
    { key: "tmall", domain: "tmall.com", cookieName: "_m_h5_tk" },
    { key: "pdd", domain: "pinduoduo.com", cookieName: "PDDAccessToken" },
    { key: "ozonSeller", domain: ".ozon.ru", cookieName: "sc_company_id" }
  ];

  const result = {};
  for (const { key, domain, cookieName } of checks) {
    try {
      const cookies = await chrome.cookies.getAll({ domain, name: cookieName });
      result[key] = !!(cookies && cookies.length > 0);
    } catch (_) {
      result[key] = false;
    }
  }

  return result;
}

async function downloadProductJson(product) {
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `spb-self-hosted/product-${(product && product.productId) || "unknown"}-${now}.json`;
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(product, null, 2))}`;

  const downloadId = await chrome.downloads.download({
    url,
    filename,
    saveAs: true
  });

  return { ok: true, downloadId, filename };
}

/**
 * 测试 OZON 数据 API 可用性
 * 市场数据（搜索词/趋势/爆品/竞争定位）已确认需要 Premium Plus，标记为不可用
 */
async function testMarketDataApis(companyId) {
  const results = {};

  // 已确认需要 Premium Plus 的端点（404 ResourceNotFound）
  results.allQueries = { available: false, error: "需要 Premium Plus 订阅" };
  results.trends = { available: false, error: "需要 Premium Plus 订阅" };
  results.bestsellers = { available: false, error: "需要 Premium Plus 订阅" };
  results.competitivePosition = { available: false, error: "需要 Premium Plus 订阅" };

  // 免费可用的端点 — 实际测试
  // 1. 销售漏斗
  try {
    const funnel = await sellerTabFetchJson(
      OZON_ENDPOINTS.salesFunnelRevenue,
      { compare_type: "PREV_PERIOD", period: "period_7_days", price_range: 0 },
      companyId
    );
    results.salesFunnel = { available: true, data: funnel };
  } catch (e) {
    results.salesFunnel = { available: false, error: e.message };
  }

  // 2. 品类树
  try {
    const tree = await sellerTabFetchJson(
      OZON_ENDPOINTS.sellerCategoryTree,
      {},
      companyId
    );
    results.categoryTree = { available: true, data: tree };
  } catch (e) {
    results.categoryTree = { available: false, error: e.message };
  }

  // 3. V3 图表 API
  try {
    const dateToStr = new Date().toISOString().slice(0, 10);
    const dateFromStr = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const v3 = await sellerTabFetchJson(
      OZON_ENDPOINTS.chartsV3,
      {
        current_period: { date_from: dateFromStr, date_to: dateToStr },
        granularity: "days",
        metrics: ["revenue_graph"],
        filters: { desc_type_ids: [], category_3_ids: [], category_2_ids: [] },
        brand_ids: [], model_ids: [], category_2_ids: [], category_3_ids: [],
        desc_type_ids: [], skus: [], no_totals: false
      },
      companyId
    );
    results.chartsV3 = { available: true, sampleCount: (v3.items || []).length };
  } catch (e) {
    results.chartsV3 = { available: false, error: e.message };
  }

  // 4. Legacy 图表 API
  try {
    const dateToStr = new Date().toISOString().slice(0, 10) + " 23:59:59";
    const dateFromStr = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10) + " 00:00:00";
    const legacy = await sellerTabFetchJson(
      OZON_ENDPOINTS.chartsGraph,
      {
        metrics: ["ordered_units"],
        dimension: "DAY",
        sort: [{ key: "day", order: "ASC" }],
        filters: [],
        date_from: dateFromStr,
        date_to: dateToStr
      },
      companyId
    );
    const legacyItems = legacy && legacy.result && legacy.result.data ? legacy.result.data.length : 0;
    results.chartsLegacy = { available: true, sampleCount: legacyItems };
  } catch (e) {
    results.chartsLegacy = { available: false, error: e.message };
  }

  // 5. What to Sell (自己店铺数据)
  try {
    const wts = await sellerTabFetchJson(
      OZON_ENDPOINTS.analytics,
      { filter: { stock: "any_stock" }, sort: { key: "sum_rating" }, limit: 5, offset: 0 },
      companyId
    );
    results.whatToSellOwn = { available: true, sampleCount: (wts.items || []).length };
  } catch (e) {
    results.whatToSellOwn = { available: false, error: e.message };
  }

  return results;
}

/**
 * Legacy API 同步：旧版 charts/graph + charts/table（保底兜底）
 */
async function syncShopGraphsLegacy(companyId, period) {
  const dateTo = new Date();
  const dateFrom = new Date(Date.now() - period * 24 * 3600 * 1000);
  const dateFromStr = dateFrom.toISOString().slice(0, 10) + " 00:00:00";
  const dateToStr = dateTo.toISOString().slice(0, 10) + " 23:59:59";

  const graphData = await sellerTabFetchJson(
    OZON_ENDPOINTS.chartsGraph,
    {
      metrics: ["ordered_units", "revenue", "session_view", "session_view_pdp", "conv_tocart_pdp", "cancellations", "returns"],
      dimension: "DAY",
      sort: [{ key: "day", order: "ASC" }],
      filters: [],
      date_from: dateFromStr,
      date_to: dateToStr
    },
    companyId
  );

  const tableData = await sellerTabFetchJson(
    OZON_ENDPOINTS.chartsTable,
    {
      group_by: "SKU",
      metrics: ["ordered_units", "session_view", "session_view_pdp", "conv_tocart_pdp", "revenue", "cancellations", "returns", "position_category"],
      date_from: dateFromStr,
      date_to: dateToStr,
      filters: [],
      limit: "50",
      offset: "0",
      sort: [{ key: "ordered_units", order: "DESC" }]
    },
    companyId
  );

  return {
    version: "legacy",
    period: period + "d",
    dateFrom: dateFromStr,
    dateTo: dateToStr,
    graphData,
    tableData
  };
}

/**
 * V3 API 同步：含搜索位/环比/AI推荐。失败时调用方应回退到 syncShopGraphsLegacy。
 */
async function syncShopGraphsV3(companyId, period) {
  const dateTo = new Date();
  const dateFrom = new Date(Date.now() - period * 24 * 3600 * 1000);
  const dateFromStr = dateFrom.toISOString().slice(0, 10);
  const dateToStr = dateTo.toISOString().slice(0, 10);
  const prevFrom = new Date(Date.now() - period * 2 * 24 * 3600 * 1000);
  const prevFromStr = prevFrom.toISOString().slice(0, 10);
  const prevToStr = dateFrom.toISOString().slice(0, 10);

  const graphData = await sellerTabFetchJson(
    OZON_ENDPOINTS.chartsV3,
    {
      current_period: { date_from: dateFromStr, date_to: dateToStr },
      granularity: "days",
      metrics: ["revenue_graph"],
      filters: { desc_type_ids: [], category_3_ids: [], category_2_ids: [] },
      brand_ids: [], model_ids: [], category_2_ids: [], category_3_ids: [],
      desc_type_ids: [], skus: [], no_totals: false
    },
    companyId
  );

  const tableData = await sellerTabFetchJson(
    OZON_ENDPOINTS.chartsV3TableBySku,
    {
      current_period: { date_from: dateFromStr, date_to: dateToStr },
      previous_period: { date_from: prevFromStr, date_to: prevToStr },
      filters: { desc_type_ids: [], category_3_ids: [], category_2_ids: [] },
      limit: "50", offset: "0",
      metrics: ["search_position", "search_views", "ordered_units", "revenue", "conv_pdp_views_to_cart", "pdp_views", "cancelled_units", "returned_units"],
      sort: { key: "ordered_units_sort", order: "desc" }
    },
    companyId
  );

  const totals = await sellerTabFetchJson(
    OZON_ENDPOINTS.chartsV3TableTotals,
    {
      current_period: { date_from: dateFromStr, date_to: dateToStr },
      previous_period: { date_from: prevFromStr, date_to: prevToStr },
      filters: { desc_type_ids: [], category_3_ids: [], category_2_ids: [] },
      metrics: ["search_position", "search_views", "ordered_units", "revenue", "conv_pdp_views_to_cart", "pdp_views"]
    },
    companyId
  );

  let recommendations = null;
  const skuList = (tableData.items || []).slice(0, 30).map(function (item) {
    return item.productInfo && item.productInfo.sku ? String(item.productInfo.sku) : "";
  }).filter(Boolean);

  if (skuList.length > 0) {
    try {
      recommendations = await sellerTabFetchJson(
        OZON_ENDPOINTS.chartsV3Recommendation,
        { period: "weekly", skus: skuList },
        companyId
      );
    } catch (e) {
      recommendations = { error: e.message };
    }
  }

  let salesFunnel = null;
  try {
    salesFunnel = await sellerTabFetchJson(
      OZON_ENDPOINTS.salesFunnelRevenue,
      { compare_type: "PREV_PERIOD", period: "period_7_days", price_range: 0 },
      companyId
    );
  } catch (e) {
    salesFunnel = { error: e.message };
  }

  return {
    version: "v3",
    period: period + "d",
    dateFrom: dateFromStr,
    dateTo: dateToStr,
    prevFrom: prevFromStr,
    prevTo: prevToStr,
    graphData,
    tableData,
    totals,
    recommendations,
    salesFunnel
  };
}

/**
 * 主入口：先尝试 V3，失败则回退到 Legacy。
 * 返回格式包含 version 字段，后端/前端据此判断渲染方式。
 */
async function syncShopGraphsWithFallback(companyId, period) {
  try {
    const v3Result = await syncShopGraphsV3(companyId, period);
    return { ...v3Result, fallbackUsed: false };
  } catch (v3Error) {
    const legacyResult = await syncShopGraphsLegacy(companyId, period);
    return {
      ...legacyResult,
      fallbackUsed: true,
      v3Error: v3Error && v3Error.message ? v3Error.message : String(v3Error)
    };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await storageGet(STORAGE_KEYS.config);
  if (!current) {
    await saveConfig(DEFAULT_CONFIG);
  }
  flushOzonCollectEnrichmentQueue().catch(() => {});
});

if (chrome.runtime && typeof chrome.runtime.onStartup?.addListener === "function") {
  chrome.runtime.onStartup.addListener(() => {
    flushOzonCollectEnrichmentQueue().catch(() => {});
  });
}

// ---- Cookie 监控：检测 1688/淘宝/天猫登录态变化 ----
// 移植自 V3.1.74，_m_h5_tk 是 1688/淘宝系的防 CSRF token
chrome.cookies.onChanged.addListener((change) => {
  if (change.removed) return;
  const cookie = change.cookie;
  if (!cookie || cookie.name !== "_m_h5_tk") return;

  const rawValue = cookie.value || "";
  const tokenPart = rawValue.indexOf("_") > -1 ? rawValue.split("_")[0] : rawValue;

  if (!tokenPart || tokenPart.length === 0) return;

  const domain = cookie.domain || "";
  if (domain === ".taobao.com" || domain === "taobao.com") {
    storageSet({ spb_taobao_h5tk: tokenPart });
  } else if (domain === ".tmall.com" || domain === "tmall.com") {
    storageSet({ spb_tmall_h5tk: tokenPart });
  } else if (domain.includes("1688")) {
    storageSet({ spb_1688_h5tk: tokenPart });
  }
});

// === 调试工具：在 Service Worker 控制台直接调用 ===
globalThis.__testSpeed = async function(pid) {
  pid = pid || '2515213005';
  var tab = await getOzonPublicTab();
  if (!tab) { console.log('NO ozon.ru TAB'); return; }
  var r1 = await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',args:[pid],func:async function(id){var s=Date.now();var r=await fetch('/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/'+id+'/'),{credentials:'include',headers:{'x-o3-app-name':'dweb_client',accept:'application/json','x-o3-language':'ru','Accept-Language':'ru'}});var j=await r.json();return{ms:Date.now()-s,status:r.status,keys:Object.keys(j.widgetStates||{}).length}}});
  console.log('composer-api:', r1[0].result);
  var r2 = await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',args:[pid],func:async function(id){var s=Date.now();var r=await fetch('/api/entrypoint-api.bx/page/json/v2?url='+encodeURIComponent('/product/'+id+'/'),{credentials:'include',headers:{'x-o3-language':'ru','Accept-Language':'ru'}});var j=await r.json();return{ms:Date.now()-s,status:r.status,keys:Object.keys(j.widgetStates||{}).length}}});
  console.log('entrypoint-api:', r2[0].result);
};

globalThis.__testWidgets = async function(pid) {
  pid = pid || '2515213005';
  var tab = await getOzonPublicTab();
  if (!tab) { console.log('NO ozon.ru TAB'); return; }
  var r = await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',args:[pid],func:async function(id){var res=await fetch('/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/product/'+id+'/'),{credentials:'include',headers:{'x-o3-app-name':'dweb_client',accept:'application/json','x-o3-language':'ru','Accept-Language':'ru'}});var j=await res.json();var st=j.widgetStates||{};var out={};for(var k in st){if(k.indexOf('webShortCharacteristics')===0||k.indexOf('webDescription')===0||k.indexOf('webCharacteristics')===0||k.indexOf('textBlock')===0||k.indexOf('webRichAnnotation')===0){out[k]=st[k].slice(0,2000)}}return out}});
  console.log(JSON.stringify(r[0].result, null, 2));
};

globalThis.__testAttrs = async function(pid) {
  pid = pid || '2883334864';
  var r = await getOzonInsights(pid);
  if (r.detail) {
    console.log('DETAIL keys:', Object.keys(r.detail));
    if (r.detail.attributes) {
      var ids = r.detail.attributes.map(function(a) { return a.attribute_id; });
      console.log('All attribute_ids:', JSON.stringify(ids));
      console.log('Total attrs:', r.detail.attributes.length);
      // 打印所有属性的 value + dictionary_value_id 对照
      var suspicious = r.detail.attributes.filter(function(a) {
        if (!a.values || !a.values.length) return false;
        var v = a.values[0];
        var num = Number(v.value);
        return (!isNaN(num) && (num < -1000 || num > 1e9)) || String(a.attribute_id) === '8513' || String(a.attribute_id) === '85';
      });
      console.log('=== SUSPICIOUS / KEY ATTRS ===');
      suspicious.forEach(function(a) { console.log('attr ' + a.attribute_id + ':', JSON.stringify(a)); });
      console.log('=== ALL ATTRS WITH VALUES ===');
      r.detail.attributes.forEach(function(a) {
        if (a.values && a.values.length) {
          var v = a.values[0];
          console.log('  ' + a.attribute_id + ': value="' + v.value + '" dict_id=' + v.dictionary_value_id);
        }
      });
    }
    console.log('Top-level vendor:', r.detail.vendor);
    console.log('Top-level brand:', r.detail.brand);
    console.log('Top-level manufacturer:', r.detail.manufacturer);
  } else {
    console.log('no detail');
  }
};

async function getOzonPublicTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.ozon.ru/*" });
  if (tabs.length) {
    return tabs.find((t) => t.active) || tabs[0];
  }
  const kzTabs = await chrome.tabs.query({ url: "https://www.ozon.kz/*" });
  if (kzTabs.length) return kzTabs[0];
  const byTabs = await chrome.tabs.query({ url: "https://www.ozon.by/*" });
  if (byTabs.length) return byTabs[0];
  return null;
}

/**
 * 聚合多源 Premium 数据（按降级顺序拉取，能拿就拿，拿不到不阻塞）
 *
 * 数据来源优先级：
 *   1. seller.ozon.ru analytics（需要 Premium Plus，403/无权限时降级）
 *   2. OZON 公开 entrypoint API（提取 widgetStates 里的销量/卖家/评分）
 *   3. SS ERP 后端缓存（其他用户提交过的数据）
 *
 * 返回格式：{ ok: true, item: {...扁平字段...}, sources: [...] }
 */
function recordInsightSourceError(sourceErrors, source, error) {
  const message = normalizeErrorMessage(error).slice(0, 300);
  if (!message) return;
  sourceErrors.push({ source, error: message });
}

function hasInsightValue(value) {
  return value != null && value !== "" && !(Array.isArray(value) && value.length === 0);
}

function shouldFetchPublicProductFallback(item) {
  return !hasInsightValue(item.title)
    || !hasInsightValue(item.brand)
    || !hasInsightValue(item.category)
    || !hasInsightValue(item.category3)
    || !hasInsightValue(item.images)
    || !hasInsightValue(item.variants)
    || !hasInsightValue(item.modelId);
}

async function aggregateOzonProductInsights(productId) {
  const sku = String(productId || "").trim();
  if (!sku) return { ok: false, error: "缺少 productId" };

  const sources = [];
  const sourceErrors = [];
  let item = {};

  // 来源 1：seller-analytics（仅当登录 + 有 Premium 时成功）
  try {
    const analytics = await getOzonInsights(sku);
    if (analytics && analytics.item) {
      sources.push("seller-analytics");
      Object.assign(item, {
        soldCount: analytics.item.soldCount,
        soldSum: analytics.item.soldSum,
        salesDynamics: analytics.item.salesDynamics,
        avgPrice: analytics.item.avgPrice,
        minSellerPrice: analytics.item.minSellerPrice,
        convToCartPdp: analytics.item.convToCartPdp,
        views: analytics.item.views,
        stock: analytics.item.stock,
        brand: analytics.item.brand,
        category1: analytics.item.category1,
        category3: analytics.item.category3,
        title: analytics.item.name || analytics.item.title || item.title,
        name: analytics.item.name || analytics.item.title || item.name,
        sellerId: analytics.item.sellerId,
        sellerName: analytics.item.sellerName,
        avgDeliveryDays: analytics.item.avgDeliveryDays,
        salesSchema: analytics.item.salesSchema,
        nullableCreateDate: analytics.item.nullableCreateDate,
      });
    } else {
      recordInsightSourceError(sourceErrors, "seller-analytics", "seller.ozon.ru 未返回该 SKU 的分析数据");
    }
    if (analytics && analytics.specs) {
      Object.assign(item, {
        weightGrams: analytics.specs.weightGrams,
        productWeightGrams: analytics.specs.productWeightGrams,
        lengthMm: analytics.specs.lengthMm,
        widthMm: analytics.specs.widthMm,
        heightMm: analytics.specs.heightMm,
      });
    } else if (analytics && analytics.item) {
      recordInsightSourceError(sourceErrors, "seller-detail", "seller.ozon.ru 未返回该 SKU 的重量/尺寸明细");
    }
  } catch (e) {
    recordInsightSourceError(sourceErrors, "seller-analytics", e);
  }

  // 来源 2：OZON 公开 entrypoint API（widgetStates 提取）
  // seller 只返回部分字段时，也用公开接口补商品基础信息。
  if (shouldFetchPublicProductFallback(item)) {
    try {
      const pub = await fetchOzonProductViaTab(sku);
      if (pub && pub.ok && pub.data) {
        sources.push("public-entrypoint");
        const d = pub.data;
        // 公开 API 拿不到月销量/GMV，但能拿到标题/价格/评分/品牌/类目/图片/变体
        const publicTitle = normalizeCollectedTitleText(d.title);
        const nextTitle = publicTitle && (!containsCjkText(publicTitle) || !item.title || containsCjkText(item.title))
          ? publicTitle
          : item.title;
        Object.assign(item, {
          title: nextTitle || item.title,
          price: d.price || item.price,
          oldPrice: d.oldPrice,
          currency: d.currency,
          brand: d.brand || item.brand,
          category: d.category || item.category3,
          images: d.images,
          variants: d.variants,
          modelId: d.modelId,
          attributes: d.attributes,
          description: d.description,
          richDescriptionJson: d.richDescriptionJson || item.richDescriptionJson,
          sourceVideos: d.sourceVideos || item.sourceVideos,
        });
      } else {
        recordInsightSourceError(sourceErrors, "public-entrypoint", (pub && pub.error) || "OZON 公开商品接口无数据");
      }
    } catch (e) {
      recordInsightSourceError(sourceErrors, "public-entrypoint", e);
    }
  }

  // 来源 3：SS ERP 后端缓存（其他用户已采集过的 Premium 数据）
  try {
    const { baseUrl, token } = await getStoredErpConnection();
    if (baseUrl && token) {
      const r = await fetch(baseUrl + "/api/ozon-analytics/cache?sku=" + encodeURIComponent(sku), {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.code === 1 && j.data && j.data.metrics) {
          sources.push("erp-cache");
          // ERP 缓存优先级最低，只补缺失字段
          for (const k of Object.keys(j.data.metrics)) {
            if (item[k] == null && j.data.metrics[k] != null) {
              item[k] = j.data.metrics[k];
            }
          }
        } else if (j && j.code === 0 && j.msg && !/无缓存/.test(String(j.msg))) {
          recordInsightSourceError(sourceErrors, "erp-cache", j.msg);
        }
      } else {
        recordInsightSourceError(sourceErrors, "erp-cache", "HTTP " + r.status);
      }
    } else {
      recordInsightSourceError(sourceErrors, "erp-cache", "扩展未配置 ERP 连接或 Token，无法读取缓存");
    }
  } catch (e) {
    recordInsightSourceError(sourceErrors, "erp-cache", e);
  }

  // 如果拿到了 seller-analytics 数据，回写 ERP 缓存让其他用户复用
  if (sources.includes("seller-analytics")) {
    try {
      const { baseUrl, token } = await getStoredErpConnection();
      if (baseUrl && token) {
        await fetch(baseUrl + "/api/ozon-analytics/cache", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ sku, metrics: item, source: "seller-analytics" }),
        }).catch(() => {});
      }
    } catch (e) {}
  }

  return { ok: true, item, sources, sourceErrors };
}

async function getStoredErpConnection() {
  const result = await chrome.storage.local.get([
    "ss_erp_connection",
    "ozon-calc:erp-endpoint",
    "ozon-calc:erp-token",
  ]);
  const conn = result.ss_erp_connection || {};
  const endpoint = String(result["ozon-calc:erp-endpoint"] || "").trim();
  const endpointBase = endpoint ? endpoint.replace(/\/api\/.*$/, "").replace(/\/+$/, "") : "";
  return {
    baseUrl: String(endpointBase || conn.baseUrl || "").replace(/\/+$/, ""),
    token: String(result["ozon-calc:erp-token"] || conn.token || "").trim(),
  };
}

function normalizeOzonProductPathForFetch(link, fallbackProductId) {
  const raw = String(link || "").trim();
  let path = "";
  if (raw) {
    try {
      const url = new URL(raw, "https://www.ozon.ru");
      if (/^\/product\//i.test(url.pathname)) {
        path = url.pathname + url.search;
      }
    } catch (e) {}
  }
  if (!path) {
    const pid = normalizeOzonDiscoveryId(fallbackProductId);
    if (!pid) return "";
    path = "/product/" + pid + "/";
  }

  try {
    const url = new URL(path, "https://www.ozon.ru");
    url.searchParams.set("language", "ru");
    return url.pathname + url.search;
  } catch (e) {
    return path.indexOf("?") >= 0 ? path + "&language=ru" : path + "?language=ru";
  }
}

async function fetchOzonProductViaTab(productId, productPath) {
  var tab = await getOzonPublicTab();
  if (!tab || !tab.id) {
    return { ok: false, error: "请先打开 www.ozon.ru 任意页面（需要登录状态）" };
  }

  // 临时把 ozon.ru 上跟语言相关的 cookie 都改成 ru，采集结束后恢复，避免用户中文界面导致返回中文翻译版
  var savedCookies = await switchOzonLanguageCookies("ru");
  try {
    return await doFetchOzonProductViaTab(tab, productId, productPath);
  } finally {
    await restoreOzonLanguageCookies(savedCookies);
  }
}

async function switchOzonLanguageCookies(targetLang) {
  var saved = [];
  try {
    var all = await chrome.cookies.getAll({ domain: ".ozon.ru" });
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      var nameLower = c.name.toLowerCase();
      // 命中 language / locale / lang / abt_data 等可能影响语言/地区的 cookie
      var hitLanguage = nameLower.indexOf("language") >= 0 || nameLower.indexOf("locale") >= 0 || (nameLower === "lang");
      if (!hitLanguage) continue;
      saved.push({ url: cookieUrl(c), name: c.name, original: c });
      try {
        await chrome.cookies.set({
          url: cookieUrl(c),
          name: c.name,
          value: targetLang,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
          expirationDate: c.expirationDate,
          storeId: c.storeId,
        });
      } catch (e) {
        console.warn("[lang-cookie] set failed:", c.name, e.message);
      }
    }
  } catch (e) {
    console.warn("[lang-cookie] enumerate failed:", e.message);
  }
  return saved;
}

async function restoreOzonLanguageCookies(saved) {
  for (var i = 0; i < saved.length; i++) {
    var c = saved[i].original;
    try {
      await chrome.cookies.set({
        url: saved[i].url,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
        storeId: c.storeId,
      });
    } catch (e) {
      console.warn("[lang-cookie] restore failed:", c.name, e.message);
    }
  }
}

function cookieUrl(c) {
  var protocol = c.secure ? "https://" : "http://";
  var host = c.domain.replace(/^\./, "");
  return protocol + host + c.path;
}

async function doFetchOzonProductViaTab(tab, productId, productPath) {
  var results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    args: [String(productId), String(productPath || "")],
    func: async (pid, requestedPath) => {
      var priceCurrency = globalThis.SS_ERP_PRICE_CURRENCY || {};
      var parsePriceWithCurrency = priceCurrency.parsePriceWithCurrency || function (text, fallback) {
        return {
          price: text ? String(text).replace(/[^\d.,]/g, "").replace(",", ".") : null,
          currency: fallback || null
        };
      };
      var detectCurrencyFromText = priceCurrency.detectCurrencyFromText || function (text, fallback) {
        var raw = text == null ? "" : String(text);
        if (raw.indexOf("¥") >= 0 || raw.indexOf("￥") >= 0 || /\b(?:CNY|RMB)\b/i.test(raw)) return "CNY";
        if (raw.indexOf("₽") >= 0 || /\bRUB\b/i.test(raw)) return "RUB";
        if (raw.indexOf("₸") >= 0 || /\bKZT\b/i.test(raw)) return "KZT";
        if (/\bBYN\b/i.test(raw)) return "BYN";
        return fallback || null;
      };
      var fallbackCurrencyByHost = priceCurrency.fallbackCurrencyByHost || function (host) {
        var value = String(host || "").toLowerCase();
        if (value.indexOf("ozon.kz") >= 0) return "KZT";
        if (value.indexOf("ozon.by") >= 0) return "BYN";
        return "RUB";
      };
      function isHttpUrl(value) {
        return /^https?:\/\//i.test(String(value || "").trim());
      }
      function isVideoUrl(value) {
        var text = String(value || "").trim();
        return isHttpUrl(text) && (/\.(?:mp4|m3u8|webm|mov)(?:[?#].*)?$/i.test(text) || /(?:stream|playlist)/i.test(text));
      }
      function pickVideoUrl(obj) {
        var fields = ["videoUrl", "videoURL", "video", "mp4", "hls", "src", "url", "link"];
        for (var i = 0; i < fields.length; i++) {
          var raw = obj && obj[fields[i]];
          if (typeof raw === "string" && isVideoUrl(raw)) return raw.trim();
        }
        return "";
      }
      function pickCoverUrl(obj) {
        var fields = ["coverUrl", "coverURL", "coverImage", "cover", "poster", "preview", "thumbnail", "image", "src"];
        for (var i = 0; i < fields.length; i++) {
          var raw = obj && obj[fields[i]];
          if (typeof raw === "string" && isHttpUrl(raw) && !isVideoUrl(raw)) return raw.trim();
        }
        return "";
      }
      function pickVideoTitle(obj) {
        var raw = obj && (obj.title || obj.name || obj.caption);
        return typeof raw === "string" ? String(raw).replace(/\s+/g, " ").trim().slice(0, 200) : "";
      }
      function addSourceVideo(target, entry) {
        if (!entry || !entry.url || !isHttpUrl(entry.url)) return;
        for (var i = 0; i < target.length; i++) {
          if (target[i].url === entry.url) return;
        }
        var next = { url: entry.url };
        if (entry.coverUrl && isHttpUrl(entry.coverUrl)) next.coverUrl = entry.coverUrl;
        if (entry.title) next.title = entry.title;
        target.push(next);
      }
      function visitVideoValue(value, target, seen, depth) {
        if (value == null || depth > 8 || target.length >= 10) return;
        if (typeof value !== "object") return;
        if (seen.indexOf(value) >= 0) return;
        seen.push(value);
        if (Array.isArray(value)) {
          for (var i = 0; i < value.length; i++) visitVideoValue(value[i], target, seen, depth + 1);
          return;
        }
        var url = pickVideoUrl(value);
        if (url) addSourceVideo(target, { url: url, coverUrl: pickCoverUrl(value), title: pickVideoTitle(value) });
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length; k++) visitVideoValue(value[keys[k]], target, seen, depth + 1);
      }
      function extractSourceVideosFromWidget(key, state, target) {
        if (!state || typeof state !== "object") return;
        if (!/(video|видео|gallery|media|rich)/i.test(key)) return;
        visitVideoValue(state, target, [], 0);
      }

      function normalizeRequestedProductPath(value, fallbackProductId) {
        var path = "";
        var raw = String(value || "").trim();
        if (raw) {
          try {
            var url = new URL(raw, "https://www.ozon.ru");
            if (/^\/product\//i.test(url.pathname)) path = url.pathname + url.search;
          } catch (e) {}
        }
        if (!path) path = "/product/" + fallbackProductId + "/";
        try {
          var parsed = new URL(path, "https://www.ozon.ru");
          parsed.searchParams.set("language", "ru");
          return parsed.pathname + parsed.search;
        } catch (e) {
          return path.indexOf("?") >= 0 ? path + "&language=ru" : path + "?language=ru";
        }
      }
      function buildDescriptionFetchPaths(fallbackProductId, currentProductPath) {
        var bases = [];
        function addBase(path) {
          path = String(path || "").split("?")[0];
          if (!path || !/^\/product\//i.test(path)) return;
          if (!/\/$/.test(path)) path += "/";
          if (bases.indexOf(path) < 0) bases.push(path);
        }
        addBase(currentProductPath);
        addBase("/product/" + fallbackProductId + "/");
        var out = [];
        for (var i = 0; i < bases.length; i++) {
          out.push(bases[i] + "?layout_container=pdpPage2column&layout_page_index=2&oos_search=false&language=ru");
        }
        return out;
      }

      // 强制俄语：language=ru 放进内嵌 url，避免被中文 cookie 覆盖
      var productPath = normalizeRequestedProductPath(requestedPath, pid);
      var encodedPath = encodeURIComponent(productPath);
      var primaryUrl = "/api/entrypoint-api.bx/page/json/v2?url=" + encodedPath;
      var fallbackUrl = "/api/composer-api.bx/page/json/v2?url=" + encodedPath;

      async function doFetch(url) {
        var r = await fetch(url, { credentials: "include", headers: { "x-o3-app-name": "dweb_client", "accept": "application/json", "x-o3-language": "ru", "Accept-Language": "ru" } });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }

      var data;
      var usedApi = "entrypoint";
      try {
        data = await doFetch(primaryUrl);
      } catch (e1) {
        usedApi = "composer";
        try {
          data = await doFetch(fallbackUrl);
        } catch (e2) {
          return { ok: false, error: "both APIs failed: " + e1.message + " / " + e2.message };
        }
      }

      var states = data && data.widgetStates;
      if (!states || typeof states !== "object") {
        return { ok: false, error: "no widgetStates" };
      }

      var widgets = [];
      var rawKeys = Object.keys(states);
      for (var i = 0; i < rawKeys.length; i++) {
        try { widgets.push({ key: rawKeys[i], state: JSON.parse(states[rawKeys[i]]) }); } catch (e) {}
      }

      var title = "";
      var images = [];
      var price = null;
      var oldPrice = null;
      var priceText = null;
      var currency = null;
      var description = "";
      var richDescriptionJson = null;
      var sourceVideos = [];
      var brand = null;
      var category = null;
      var attributes = [];

      for (var w = 0; w < widgets.length; w++) {
        var k = widgets[w].key;
        var st = widgets[w].state;

        if (!title && /^(webProductHeading|webStickyProducts)/.test(k) && st && typeof st.title === "string") {
          title = st.title;
        }
        if (!title && /^webProduct/.test(k) && st && typeof st.name === "string") {
          title = st.name;
        }

        if (!images.length && /^(webGallery|webProductGallery|gallery)/.test(k) && st) {
          var src = st.images || st.coverImage || st.gallery || st.photos;
          if (Array.isArray(src)) {
            for (var ii = 0; ii < src.length; ii++) {
              var img = src[ii];
              var u = typeof img === "string" ? img : (img && (img.src || img.url || img.originalUrl));
              if (typeof u === "string" && u.indexOf("http") === 0) images.push(u);
            }
          }
        }

        if (!price && /^(webPrice|webSale|price)/.test(k) && st) {
          var rp = st.cardPrice || st.price || st.finalPrice || st.tradePrice;
          var ro = st.originalPrice || st.priceWithoutDiscount || st.oldPrice;
          if (typeof rp === "string") {
            priceText = rp;
            var parsedPrice = parsePriceWithCurrency(rp, currency || st.currency);
            price = parsedPrice.price;
            currency = parsedPrice.currency || currency;
          }
          if (typeof ro === "string") {
            var parsedOldPrice = parsePriceWithCurrency(ro, currency || st.currency);
            oldPrice = parsedOldPrice.price;
            currency = currency || parsedOldPrice.currency;
          }
          currency = detectCurrencyFromText(st.disclaimerPriceHeader, currency || st.currency);
          if (Array.isArray(st.disclaimerPriceBodyRs)) {
            for (var dpi = 0; dpi < st.disclaimerPriceBodyRs.length; dpi++) {
              currency = detectCurrencyFromText(st.disclaimerPriceBodyRs[dpi] && st.disclaimerPriceBodyRs[dpi].content, currency);
            }
          }
        }

        if (/^(webDescription|webRichAnnotation|description)/.test(k) && st) {
          var firstDescriptionPayload = extractRichDescriptionPayload(st);
          if (firstDescriptionPayload.text && (!description || firstDescriptionPayload.text.length > description.length)) {
            description = firstDescriptionPayload.text;
          }
          if (!richDescriptionJson && firstDescriptionPayload.richJson) {
            richDescriptionJson = firstDescriptionPayload.richJson;
          }
        }

        extractSourceVideosFromWidget(k, st, sourceVideos);

        if (!category && /^breadCrumbs/.test(k) && st && Array.isArray(st.breadcrumbs) && st.breadcrumbs.length) {
          category = st.breadcrumbs[st.breadcrumbs.length - 1].text || null;
        }

        if (/^(webShortCharacteristics|webCharacteristics|characteristics)/.test(k) && st) {
          var chars = st.characteristics;
          if (Array.isArray(chars)) {
            for (var ci = 0; ci < chars.length; ci++) {
              var ch = chars[ci];
              var nm = "";
              if (ch.title && Array.isArray(ch.title.textRs) && ch.title.textRs.length) {
                nm = ch.title.textRs[0].content || "";
              } else if (typeof ch.title === "string") {
                nm = ch.title;
              } else if (ch.name) {
                nm = ch.name;
              }
              var vl = "";
              if (Array.isArray(ch.values)) {
                var parts = [];
                for (var vi = 0; vi < ch.values.length; vi++) {
                  var v = ch.values[vi];
                  var t = v.text || v.value || "";
                  if (t) parts.push(t.replace(/,\s*$/, ""));
                }
                vl = parts.join(", ");
              }
              if (nm && vl) attributes.push({ name: nm, value: vl });
            }
          }
        }
      }

      if (!title) {
        return { ok: false, error: "title not found (product may not exist)", _rawKeys: rawKeys };
      }

      for (var a = 0; a < attributes.length; a++) {
        if (!brand && /бренд|brand|品牌|Бренд/i.test(attributes[a].name)) {
          brand = attributes[a].value;
        }
      }

      // 占位：扫描 widgetStates 找 model_id + variants 候选 widget（结构未知，dump 候选给后端落库）
      var modelId = null;
      var variants = [];
      var aspectName = null;
      var variantCandidates = [];
      var allWidgetKeys = [];
      // sku → variant 索引，用于跨多个 aspects 合并同一个 SKU 的属性
      var variantSkuIndex = {};
      for (var wi = 0; wi < widgets.length; wi++) {
        var wk = widgets[wi].key;
        var wst = widgets[wi].state;
        allWidgetKeys.push(wk);
        // webAspects = OZON 真实变体维度（颜色/尺码等）
        if (/^webAspects/.test(wk) && wst && Array.isArray(wst.aspects) && wst.aspects.length) {
          // 首个 aspect 用作 modelId 提取 + fallback aspectName
          var firstAspect = wst.aspects[0];
          if (!aspectName) aspectName = firstAspect.aspectName || firstAspect.aspectKey || null;

          // 遍历所有维度（颜色 + 尺码 + 等），按 sku 合并 attrs
          for (var ai = 0; ai < wst.aspects.length; ai++) {
            var asp = wst.aspects[ai];
            var dimName = asp.aspectName || asp.aspectKey || null;
            if (!dimName || !Array.isArray(asp.variants)) continue;
            for (var avi = 0; avi < asp.variants.length; avi++) {
              var av = asp.variants[avi];
              if (!av || !av.sku) continue;
              var skuKey = String(av.sku);
              var avText = av.data && Array.isArray(av.data.textRs) && av.data.textRs[0] ? av.data.textRs[0].content : null;
              var avCover = av.data && av.data.coverImage ? av.data.coverImage : null;
              var avPriceText = av.data && av.data.price ? av.data.price : null;
              var avParsedPrice = parsePriceWithCurrency(avPriceText, currency);
              if (!variantSkuIndex[skuKey]) {
                var variantObj = {
                  sku: skuKey,
                  attrs: {},
                  price: avParsedPrice.price || (typeof av.price === "number" ? av.price : null),
                  priceCurrency: avParsedPrice.currency || currency || null,
                  priceText: avPriceText,
                  ozonInternalPrice: typeof av.price === "number" ? av.price : null,
                  images: avCover ? [avCover] : [],
                  availability: av.availability || null,
                  active: !!av.active,
                  title: av.data && av.data.title ? av.data.title : null,
                  link: av.link || null
                };
                variantSkuIndex[skuKey] = variantObj;
                variants.push(variantObj);
              }
              // 累加当前维度的值（颜色/尺码同时存在时不会互相覆盖）
              variantSkuIndex[skuKey].attrs[dimName] = avText || skuKey;
              // 补全缺失的元数据
              if (avPriceText && !variantSkuIndex[skuKey].priceText) variantSkuIndex[skuKey].priceText = avPriceText;
              if (avParsedPrice.price && !variantSkuIndex[skuKey].price) variantSkuIndex[skuKey].price = avParsedPrice.price;
              if (avParsedPrice.currency && !variantSkuIndex[skuKey].priceCurrency) variantSkuIndex[skuKey].priceCurrency = avParsedPrice.currency;
              if (avCover && !(variantSkuIndex[skuKey].images && variantSkuIndex[skuKey].images.length)) variantSkuIndex[skuKey].images = [avCover];
              if (av.link && !variantSkuIndex[skuKey].link) variantSkuIndex[skuKey].link = av.link;
            }
          }

          if (firstAspect.aspectModalInfo && firstAspect.aspectModalInfo.link) {
            var lm = String(firstAspect.aspectModalInfo.link).match(/from_sku=(\d+)/);
            if (lm) modelId = lm[1];
          }
          if (!modelId) modelId = String(pid);
        }
        if (/aspect|variant|model|sku/i.test(wk) && wst && typeof wst === "object") {
          var preview = "";
          // webAspects 是变体核心数据，需要完整 dump，其他候选只留摘要
          var maxLen = /^webAspects/.test(wk) ? 60000 : 1500;
          try {
            var s = JSON.stringify(wst);
            preview = s.length > maxLen ? s.slice(0, maxLen) + "...[truncated]" : s;
          } catch (e) { preview = String(wst).slice(0, 500); }
          variantCandidates.push({
            key: wk,
            keys: Object.keys(wst).slice(0, 30),
            preview: preview
          });
        }
      }
      // 收集所有 webAspects 下每个 aspect 的 modal 链接（多维度都要拉，去重）
      // 之前只取 aspects[0] 的 modal 导致变体维度遗漏（如颜色 12 个有 modal、尺码 8 个也有 modal）
      var modalLinks = [];
      var seenModalLink = {};
      for (var ww = 0; ww < widgets.length; ww++) {
        var wkk = widgets[ww].key;
        var wstt = widgets[ww].state;
        if (!/^webAspects/.test(wkk) || !wstt || !Array.isArray(wstt.aspects)) continue;
        for (var aspi = 0; aspi < wstt.aspects.length; aspi++) {
          var aspx = wstt.aspects[aspi];
          if (!aspx || !aspx.aspectModalInfo || !aspx.aspectModalInfo.link) continue;
          var lnk = aspx.aspectModalInfo.link;
          if (seenModalLink[lnk]) continue;
          seenModalLink[lnk] = true;
          modalLinks.push({
            link: lnk,
            realCount: parseInt(aspx.aspectModalInfo.realNumberOfVariants, 10) || null,
            fromAspect: aspx.aspectName || aspx.aspectKey || null,
          });
        }
      }
      // 兼容老字段：modalLink/modalRealCount 取首个用于诊断
      var modalLink = modalLinks.length ? modalLinks[0].link : null;
      var modalRealCount = modalLinks.length ? modalLinks[0].realCount : null;
      var modalVariantCount = 0;

      for (var mi = 0; mi < modalLinks.length; mi++) {
        var modalEntry = modalLinks[mi];
        try {
          var modalEncoded = encodeURIComponent(modalEntry.link);
          var modalData = await doFetch("/api/entrypoint-api.bx/page/json/v2?url=" + modalEncoded);
          var modalStates = modalData && modalData.widgetStates;
          if (!modalStates || typeof modalStates !== "object") continue;
          var modalKeys = Object.keys(modalStates);
          for (var mk = 0; mk < modalKeys.length; mk++) {
            var mwk = modalKeys[mk];
            var mwst;
            try { mwst = JSON.parse(modalStates[mwk]); } catch (e) { continue; }
            if (!/aspect/i.test(mwk)) continue;

            // modal 里也可能多维度：遍历所有 aspects；兼容顶层 variants[] 的旧结构
            var mAspectsList = (mwst && Array.isArray(mwst.aspects) && mwst.aspects.length)
              ? mwst.aspects
              : (mwst && Array.isArray(mwst.variants) ? [{ aspectName: modalEntry.fromAspect, variants: mwst.variants }] : null);
            if (!mAspectsList) continue;

            for (var mai = 0; mai < mAspectsList.length; mai++) {
              var mAsp = mAspectsList[mai];
              var mDimName = mAsp.aspectName || mAsp.aspectKey || modalEntry.fromAspect || null;
              var mVList = Array.isArray(mAsp.variants) ? mAsp.variants : null;
              if (!mDimName || !mVList) continue;
              for (var mv = 0; mv < mVList.length; mv++) {
                var mav = mVList[mv];
                if (!mav || !mav.sku) continue;
                var mSku = String(mav.sku);
                var mvText = mav.data && Array.isArray(mav.data.textRs) && mav.data.textRs[0] ? mav.data.textRs[0].content : null;
                var mvCover = mav.data && mav.data.coverImage ? mav.data.coverImage : null;
                var mvPriceText = mav.data && mav.data.price ? mav.data.price : null;
                var mvParsedPrice = parsePriceWithCurrency(mvPriceText, currency);
                if (!variantSkuIndex[mSku]) {
                  var mObj = {
                    sku: mSku,
                    attrs: {},
                    price: mvParsedPrice.price || (typeof mav.price === "number" ? mav.price : null),
                    priceCurrency: mvParsedPrice.currency || currency || null,
                    priceText: mvPriceText,
                    ozonInternalPrice: typeof mav.price === "number" ? mav.price : null,
                    images: mvCover ? [mvCover] : [],
                    availability: mav.availability || null,
                    active: !!mav.active,
                    title: mav.data && mav.data.title ? mav.data.title : null,
                    link: mav.link || null,
                    _fromModal: true
                  };
                  variantSkuIndex[mSku] = mObj;
                  variants.push(mObj);
                  modalVariantCount++;
                }
                // 合并维度值
                variantSkuIndex[mSku].attrs[mDimName] = mvText || mSku;
                if (mvPriceText && !variantSkuIndex[mSku].priceText) variantSkuIndex[mSku].priceText = mvPriceText;
                if (mvParsedPrice.price && !variantSkuIndex[mSku].price) variantSkuIndex[mSku].price = mvParsedPrice.price;
                if (mvParsedPrice.currency && !variantSkuIndex[mSku].priceCurrency) variantSkuIndex[mSku].priceCurrency = mvParsedPrice.currency;
                if (mvCover && !(variantSkuIndex[mSku].images && variantSkuIndex[mSku].images.length)) variantSkuIndex[mSku].images = [mvCover];
                if (mav.link && !variantSkuIndex[mSku].link) variantSkuIndex[mSku].link = mav.link;
              }
            }
          }
        } catch (e) {
          // modal 拉失败不致命，保留 widget 拿到的
        }
      }

      try {
        var descriptionPaths = buildDescriptionFetchPaths(pid, productPath);
        var descriptionStates = null;
        for (var dpi = 0; dpi < descriptionPaths.length; dpi++) {
          try {
            var descriptionData = await doFetch("/api/entrypoint-api.bx/page/json/v2?url=" + encodeURIComponent(descriptionPaths[dpi]));
            var candidateStates = descriptionData && descriptionData.widgetStates;
            if (candidateStates && typeof candidateStates === "object") {
              var hasDescriptionState = Object.keys(candidateStates).some(function (stateKey) {
                return /^(webDescription|webRichAnnotation|description)/.test(stateKey);
              });
              if (hasDescriptionState) {
                descriptionStates = candidateStates;
                break;
              }
            }
          } catch (e) {}
        }
        if (descriptionStates && typeof descriptionStates === "object") {
          var descriptionKeys = Object.keys(descriptionStates);
          for (var dsk = 0; dsk < descriptionKeys.length; dsk++) {
            var dKey = descriptionKeys[dsk];
            var dState;
            try { dState = JSON.parse(descriptionStates[dKey]); } catch (e) { continue; }
            if (/^(webDescription|webRichAnnotation|description)/.test(dKey) && dState) {
              var descriptionPayload = extractRichDescriptionPayload(dState);
              if (descriptionPayload.text && (!description || descriptionPayload.text.length > description.length)) {
                description = descriptionPayload.text;
              }
              if (!richDescriptionJson && descriptionPayload.richJson) {
                richDescriptionJson = descriptionPayload.richJson;
              }
            }
            extractSourceVideosFromWidget(dKey, dState, sourceVideos);
            if (/^(webShortCharacteristics|webCharacteristics|characteristics)/.test(dKey) && dState) {
              var dChars = dState.characteristics;
              if (Array.isArray(dChars)) {
                for (var dci = 0; dci < dChars.length; dci++) {
                  var dCh = dChars[dci];
                  var dNm = "";
                  if (dCh.title && Array.isArray(dCh.title.textRs) && dCh.title.textRs.length) {
                    dNm = dCh.title.textRs[0].content || "";
                  } else if (typeof dCh.title === "string") {
                    dNm = dCh.title;
                  } else if (dCh.name) {
                    dNm = dCh.name;
                  }
                  var dVl = "";
                  if (Array.isArray(dCh.values)) {
                    var dParts = [];
                    for (var dvi = 0; dvi < dCh.values.length; dvi++) {
                      var dVal = dCh.values[dvi];
                      var dText = dVal.text || dVal.value || "";
                      if (dText) dParts.push(dText.replace(/,\s*$/, ""));
                    }
                    dVl = dParts.join(", ");
                  }
                  if (dNm && dVl && !attributes.some(function (attr) { return attr.name === dNm && attr.value === dVl; })) {
                    attributes.push({ name: dNm, value: dVl });
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        // Description page is optional; keep first-page data if Ozon rejects it.
      }

      var widgetStatesDump = variantCandidates.length ? {
        currentProductId: pid,
        modelIdGuess: modelId,
        aspectName: aspectName,
        parsedVariantCount: variants.length,
        modalLink: modalLink,
        modalRealCount: modalRealCount,
        modalAdded: modalVariantCount,
        allWidgetKeys: allWidgetKeys,
        candidates: variantCandidates.slice(0, 20)
      } : null;

      return {
        ok: true,
        data: {
          productId: Number(pid),
          title: title,
          publishTitle: title,
          sourceTitleRaw: title,
          sourceLocale: "ru",
          images: images,
          price: price,
          priceText: priceText,
          oldPrice: oldPrice,
          currency: currency || fallbackCurrencyByHost(location.hostname),
          description: typeof description === "string" ? description.slice(0, 5000) : "",
          richDescriptionJson: richDescriptionJson ? JSON.stringify(richDescriptionJson).slice(0, 30000) : null,
          sourceVideos: sourceVideos.length ? sourceVideos : null,
          brand: brand,
          category: category,
          attributes: attributes,
          url: "https://www.ozon.ru" + String(productPath || ("/product/" + pid + "/")).split("?")[0],
          _usedApi: usedApi,
          modelId: modelId,
          variants: variants,
          widgetStatesDump: widgetStatesDump
        }
      };
    }
  });

  var result = results && results[0] ? results[0].result : null;
  if (!result) {
    return { ok: false, error: "脚本未返回结果，请确认 ozon.ru 页面已完全加载" };
  }
  if (result.ok && result.data && Array.isArray(result.data.variants)) {
    result.data.variants = enrichCollectedOzonVariants(result.data.variants);
  }
  return result;
}

async function discoverOzonVariantsRecursively(productData, rootProductId, options = {}) {
  if (!productData || !Array.isArray(productData.variants) || productData.variants.length === 0) {
    return productData;
  }

  const maxPages = Number.isFinite(Number(options.maxPages)) ? Number(options.maxPages) : 120;
  const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 3;
  const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 350;
  const rootSku = normalizeOzonDiscoveryId(rootProductId || productData.productId);
  const visitedSkus = new Set(rootSku ? [rootSku] : []);
  const visitedProductIds = new Set(rootSku ? [rootSku] : []);
  const queuedKeys = new Set();
  const diagnostics = {
    enabled: true,
    rootProductId: String(rootProductId || productData.productId || ""),
    initialVariantCount: productData.variants.length,
    visitedPageCount: 0,
    queuedPageCount: 0,
    addedVariantCount: 0,
    mergedVariantCount: 0,
    finalVariantCount: productData.variants.length,
    maxPages,
    maxDepth,
    maxReached: false,
    errors: [],
  };

  const queue = collectOzonVariantDiscoveryRefs(productData.variants, {
    excludeSkus: rootSku ? [rootSku] : [],
    seenSkus: Array.from(visitedSkus),
    seenProductIds: Array.from(visitedProductIds),
    limit: maxPages,
  }).map((ref) => ({ ...ref, depth: 1 }));

  queue.forEach((ref) => queuedKeys.add(ref.fetchId || ref.sku || ref.productId));
  diagnostics.queuedPageCount = queue.length;

  const tab = await getOzonPublicTab();
  if (!tab || !tab.id) {
    diagnostics.errors.push({ error: "请先打开 www.ozon.ru 任意页面（需要登录状态）" });
    attachOzonVariantDiscoveryDiagnostics(productData, diagnostics);
    return productData;
  }

  const savedCookies = await switchOzonLanguageCookies("ru");
  try {
    while (queue.length > 0 && diagnostics.visitedPageCount < maxPages) {
      const ref = queue.shift();
      if (!ref || ref.depth > maxDepth) continue;

      const fetchId = normalizeOzonDiscoveryId(ref.fetchId || ref.sku || ref.productId);
      const sku = normalizeOzonDiscoveryId(ref.sku || fetchId);
      const productId = normalizeOzonDiscoveryId(ref.productId || fetchId);
      const visitKey = fetchId || sku || productId;
      if (!visitKey) continue;
      if (sku) {
        if (visitedSkus.has(sku)) continue;
      } else if (productId && visitedProductIds.has(productId)) {
        continue;
      }

      visitedSkus.add(sku || visitKey);
      visitedProductIds.add(productId || visitKey);
      diagnostics.visitedPageCount += 1;

      try {
        const productPath = normalizeOzonProductPathForFetch(ref.link, fetchId);
        const result = await doFetchOzonProductViaTab(tab, fetchId, productPath);
        if (!result.ok || !result.data) {
          if (diagnostics.errors.length < 10) {
            diagnostics.errors.push({
              fetchId,
              error: result.error || "OZON 变体页公开数据获取失败",
            });
          }
        } else {
          const incomingVariants = Array.isArray(result.data.variants) ? result.data.variants : [];
          if (incomingVariants.length > 0) {
            const merged = mergeCollectedOzonVariantLists(productData.variants, incomingVariants);
            productData.variants = enrichCollectedOzonVariants(merged.variants);
            diagnostics.addedVariantCount += merged.addedCount || 0;
            diagnostics.mergedVariantCount += merged.mergedCount || 0;

            const nextRefs = collectOzonVariantDiscoveryRefs(incomingVariants, {
              excludeSkus: rootSku ? [rootSku] : [],
              seenSkus: Array.from(visitedSkus),
              seenProductIds: Array.from(visitedProductIds),
              limit: Math.max(0, maxPages - diagnostics.visitedPageCount),
            });
            nextRefs.forEach((nextRef) => {
              const nextFetchId = normalizeOzonDiscoveryId(nextRef.fetchId || nextRef.sku || nextRef.productId);
              if (!nextFetchId || queuedKeys.has(nextFetchId)) return;
              queuedKeys.add(nextFetchId);
              queue.push({ ...nextRef, depth: ref.depth + 1 });
            });
            diagnostics.queuedPageCount = Math.max(diagnostics.queuedPageCount, queuedKeys.size);
          }
        }
      } catch (error) {
        if (diagnostics.errors.length < 10) {
          diagnostics.errors.push({
            fetchId,
            error: normalizeErrorMessage(error).slice(0, 160),
          });
        }
      }

      if (delayMs > 0 && queue.length > 0 && diagnostics.visitedPageCount < maxPages) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } finally {
    await restoreOzonLanguageCookies(savedCookies);
  }

  diagnostics.maxReached = queue.length > 0 && diagnostics.visitedPageCount >= maxPages;
  diagnostics.finalVariantCount = Array.isArray(productData.variants) ? productData.variants.length : 0;
  attachOzonVariantDiscoveryDiagnostics(productData, diagnostics);
  return productData;
}

async function completeOzonProductVariantsForCollection(productData, productId, options = {}) {
  if (!productData || !Array.isArray(productData.variants) || productData.variants.length === 0) {
    return productData;
  }
  const policy = resolveOzonCollectionPolicy(options.mode || options.collectMode || options.discoverVariants !== undefined ? options : { mode: "complete" });
  if (!policy.discoverVariants) {
    attachOzonVariantDiscoveryDiagnostics(productData, {
      enabled: false,
      skipped: true,
      mode: policy.mode,
      rootProductId: String(productId || productData.productId || ""),
      initialVariantCount: productData.variants.length,
      finalVariantCount: productData.variants.length,
      reason: "quick collect skips recursive variant pages",
    });
    return productData;
  }
  try {
    return await discoverOzonVariantsRecursively(productData, productId, policy.recursive || {});
  } catch (error) {
    attachOzonVariantDiscoveryDiagnostics(productData, {
      enabled: true,
      mode: policy.mode,
      rootProductId: String(productId || ""),
      initialVariantCount: productData.variants.length,
      finalVariantCount: productData.variants.length,
      failed: true,
      error: normalizeErrorMessage(error).slice(0, 200),
    });
    return productData;
  }
}

async function collectOzonProductsToErp(productIds, options = {}) {
  const pids = Array.isArray(productIds)
    ? productIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!pids.length) {
    return { ok: false, error: "缺少 productIds" };
  }

  const erpConn = await getStoredErpConnection();
  const erpBase = erpConn.baseUrl;
  const erpToken = erpConn.token;
  if (!erpBase || !erpToken) {
    return { ok: false, error: "请先配置 ERP 连接" };
  }

  let sellerCompanyId = null;
  try { sellerCompanyId = await getSellerCompanyId(); } catch (e) {}
  const collectPolicy = resolveOzonCollectionPolicy(options);

  const collected = [];
  const errors = [];
  for (let i = 0; i < pids.length; i++) {
    const pid = pids[i];
    const r = await fetchOzonProductViaTab(pid);
    if (!r.ok) {
      errors.push({ productId: pid, error: r.error || "OZON 公开数据获取失败" });
      if (i < pids.length - 1) await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }

    const productData = r.data;
    await completeOzonProductVariantsForCollection(productData, pid, collectPolicy);

    if (sellerCompanyId && collectPolicy.fetchRootSellerInsights) {
      try {
        const insights = await getOzonInsights(pid);
        repairOzonCollectedTitleFromInsights(productData, insights);
        if (insights.detail && Array.isArray(insights.detail.attributes)) {
          productData.ozonAttributes = insights.detail.attributes;
        } else {
          productData._attrWarning = "seller API 无法获取该商品属性（analytics 未索引），上架可能失败";
        }
        if (insights.detail) {
          productData.weight = insights.detail.weight || (insights.specs && insights.specs.weightGrams) || null;
          productData.length = insights.detail.depth || (insights.specs && insights.specs.lengthMm) || null;
          productData.width = insights.detail.width || (insights.specs && insights.specs.widthMm) || null;
          productData.height = insights.detail.height || (insights.specs && insights.specs.heightMm) || null;
          if (insights.detail.manufacturer) productData.manufacturerName = insights.detail.manufacturer;
          if (insights.detail.brand) productData.brandName = insights.detail.brand;
        } else if (insights.specs) {
          productData.weight = insights.specs.weightGrams;
          productData.length = insights.specs.lengthMm;
          productData.width = insights.specs.widthMm;
          productData.height = insights.specs.heightMm;
        }

        try {
          const treeRes = await sellerTabFetchJson(
            "https://seller.ozon.ru/api/v1/seller-tree/resolve/by-sku",
            { skus: [String(pid)] },
            sellerCompanyId
          );
          const resolved = treeRes && treeRes.resolved_categories_by_sku && treeRes.resolved_categories_by_sku[String(pid)];
          if (resolved) {
            productData.descriptionCategoryId = resolved.description_category_id_level_3 || null;
            productData.typeId = resolved.description_type_id || null;
          }
        } catch (e) {}

        if ((collectPolicy.fetchVariantSellerInsights || collectedOzonVariantsNeedSellerRepair(productData.variants)) && Array.isArray(productData.variants) && productData.variants.length > 0) {
          const subPids = productData.variants
            .map((v) => v && v.sku ? String(v.sku) : null)
            .filter((s) => s && s !== String(pid));
          if (subPids.length) {
            const subMap = await fetchVariantInsightsConcurrent(subPids, 2, 200);
            productData.variants.forEach((v) => {
              if (!v || !v.sku) return;
              const sku = String(v.sku);
              if (sku === String(pid)) {
                v.ozonAttributes = productData.ozonAttributes || null;
                v.weight = productData.weight || null;
                v.depth = productData.length || null;
                v.width = productData.width || null;
                v.height = productData.height || null;
              } else if (subMap[sku] && subMap[sku].attributes) {
                v.ozonAttributes = subMap[sku].attributes;
                v.weight = subMap[sku].weight;
                v.depth = subMap[sku].depth;
                v.width = subMap[sku].width;
                v.height = subMap[sku].height;
                if (subMap[sku].manufacturer) v.manufacturerName = subMap[sku].manufacturer;
                if (subMap[sku].brand) v.brandName = subMap[sku].brand;
              } else {
                v._attrMissing = (subMap[sku] && subMap[sku].error) || "no insights";
              }
            });
          }
        }
      } catch (e) {}
    }

    if (Array.isArray(productData.variants) && productData.variants.length > 0) {
      productData.variants = sanitizeCollectedOzonVariantAttrs(productData.variants);
    }

    collected.push(productData);
    if (collectPolicy.rootProductDelayMs > 0 && i < pids.length - 1) await new Promise((resolve) => setTimeout(resolve, collectPolicy.rootProductDelayMs));
  }

  if (!collected.length) {
    const firstErr = Array.isArray(errors) && errors[0] ? errors[0].error : "";
    return { ok: false, error: firstErr ? `全部采集失败：${firstErr}` : "全部采集失败", errors };
  }

  const pushResult = await pushOzonCollectedProductsToErp(erpBase, erpToken, collected, errors);
  if (pushResult.ok && collectPolicy.mode === "balanced") {
    await enqueueOzonCollectEnrichmentJob({ productIds: pids });
    flushOzonCollectEnrichmentQueue().catch(() => {});
  }
  return pushResult;
}

globalThis.SS_ERP_COLLECT_BACKGROUND = Object.assign(globalThis.SS_ERP_COLLECT_BACKGROUND || {}, {
  aggregateOzonProductInsights,
  collectOzonProductsToErp,
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type || !message.type.startsWith('spb-self-hosted:')) {
    return false;
  }

  (async () => {
    switch (message.type) {
      case "spb-self-hosted:get-config":
        return { ok: true, config: await getConfig() };
      case "spb-self-hosted:save-config":
        return { ok: true, config: await saveConfig(message.config) };
      case "spb-self-hosted:get-last-collected":
        return { ok: true, data: await getLastCollected() };
      case "spb-self-hosted:collect-current-tab":
        return { ok: true, data: await collectFromCurrentTab() };
      case "spb-self-hosted:get-ozon-insights":
        try {
          return { ok: true, data: await getOzonInsights(message.productId || parseOzonProductId(message.sourceUrl || "")) };
        } catch (error) {
          if (isExtensionContextError(error)) {
            return { ok: false, error: "扩展刚刚被重新加载，请刷新当前 Ozon 商品页后重试数据一览。" };
          }
          throw error;
        }
      case "spb-self-hosted:download-product":
        return await downloadProductJson(message.product);
      case "spb-self-hosted:track-logistics":
        return { ok: true, data: await trackOrderLogistics(message.orders, message.platform) };
      case "spb-self-hosted:check-premium": {
        const status = await checkOzonPremiumActive();
        return { ok: true, ...status };
      }
      case "spb-self-hosted:check-logins":
        return { ok: true, logins: await checkPlatformLogins() };
      case "spb-self-hosted:sync-shop-analytics": {
        // 从 seller.ozon.ru 获取商品分析数据并推送到 ERP
        // 使用 chartsV3TableBySku（已验证可用），不再依赖 what_to_sell/data/v3
        const companyId = await getSellerCompanyId(message.companyId);
        let analyticsItems = [];

        try {
          const dateTo = new Date();
          const dateFrom = new Date(Date.now() - 30 * 24 * 3600 * 1000);
          const dateFromStr = dateFrom.toISOString().slice(0, 10);
          const dateToStr = dateTo.toISOString().slice(0, 10);
          const prevFrom = new Date(Date.now() - 60 * 24 * 3600 * 1000);
          const prevFromStr = prevFrom.toISOString().slice(0, 10);
          const prevToStr = dateFromStr;

          const PAGE_SIZE = 50;
          const MAX_PAGES = 20;
          let offset = 0;

          for (let page = 0; page < MAX_PAGES; page++) {
            const tableResult = await sellerTabFetchJson(
              OZON_ENDPOINTS.chartsV3TableBySku,
              {
                current_period: { date_from: dateFromStr, date_to: dateToStr },
                previous_period: { date_from: prevFromStr, date_to: prevToStr },
                filters: { desc_type_ids: [], category_3_ids: [], category_2_ids: [] },
                limit: String(PAGE_SIZE), offset: String(offset),
                metrics: ["search_position", "search_views", "ordered_units", "revenue", "conv_pdp_views_to_cart", "pdp_views", "cancelled_units", "returned_units"],
                sort: { key: "ordered_units_sort", order: "desc" }
              },
              companyId
            );

            const pageItems = tableResult && Array.isArray(tableResult.items) ? tableResult.items : [];
            if (!pageItems.length) break;

            pageItems.forEach(function (item) {
              const info = item.productInfo || {};
              const m = item.metrics || {};
              analyticsItems.push({
                sku: info.sku || "",
                name: info.name || info.sku || "",
                image: info.image || "",
                article: info.article || "",
                soldCount: Number(m.orderedUnits) || 0,
                soldSum: Number(m.revenue) || 0,
                views: Number(m.pdpViews) || 0,
                searchViews: Number(m.searchViews) || 0,
                searchPosition: Number(m.searchPosition) || 0,
                convToCartPdp: Number(m.convPdpViewsToCart) || 0,
                cancellations: Number(m.cancelledUnits) || 0,
                returns: Number(m.returnedUnits) || 0,
                _source: "charts_v3_table"
              });
            });

            if (pageItems.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
          }
        } catch (e) {
          const messageText = e.message || String(e);
          if (isOzonCompanyPermissionError(messageText)) {
            return { ok: false, error: messageText };
          }
          return { ok: false, error: "获取分析数据失败。请确认已登录 seller.ozon.ru 并打开了卖家后台页面。错误: " + messageText };
        }

        if (!analyticsItems.length) {
          return { ok: false, error: "未获取到分析数据，请确认已登录 seller.ozon.ru" };
        }

        // 获取 ERP 连接配置
        const conn = await getStoredErpConnection();
        const baseUrl = conn.baseUrl;
        const token = conn.token;

        if (!baseUrl) {
          return { ok: false, error: "请先在设置中配置 ERP 后端地址" };
        }
        if (!token) {
          return { ok: false, error: "请先在设置中配置 ERP Token" };
        }

        // 需要 shopId，从消息中获取
        const shopId = message.shopId;
        if (!shopId) {
          return { ok: false, error: "请指定店铺 ID" };
        }

        const pushUrl = baseUrl + "/api/shops/" + shopId + "/analytics";
        const pushResponse = await fetch(pushUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=utf-8",
            "Authorization": "Bearer " + token
          },
          body: JSON.stringify({
            items: analyticsItems,
            period: "30d"
          })
        });

        const pushText = await pushResponse.text();
        if (!pushResponse.ok) {
          return { ok: false, error: "ERP 返回 HTTP " + pushResponse.status + ": " + pushText.slice(0, 300) };
        }

        let pushParsed = {};
        try { pushParsed = JSON.parse(pushText); } catch (e) {}

        return {
          ok: true,
          data: {
            itemCount: analyticsItems.length,
            erpResponse: pushParsed
          }
        };
      }
      case "spb-self-hosted:sync-shop-graphs": {
        const companyId = await getSellerCompanyId(message.companyId);
        const period = message.period || 30;

        const v3Result = await syncShopGraphsWithFallback(companyId, period);

        const graphShopId = message.shopId;
        if (graphShopId) {
          const graphConn = await getStoredErpConnection();
          const graphBaseUrl = graphConn.baseUrl;
          const graphToken = graphConn.token;

          if (graphBaseUrl && graphToken) {
            await fetch(graphBaseUrl + "/api/shops/" + graphShopId + "/analytics-graphs", {
              method: "POST",
              headers: {
                "Content-Type": "application/json;charset=utf-8",
                "Authorization": "Bearer " + graphToken
              },
              body: JSON.stringify(v3Result)
            });
          }
        }

        return { ok: true, data: v3Result };
      }
      case "spb-self-hosted:test-market-apis": {
        const companyId = await getSellerCompanyId(message.companyId);
        const testResults = await testMarketDataApis(companyId);
        return { ok: true, data: testResults };
      }
      case "spb-self-hosted:get-ozon-shops": {
        // 从 ERP 获取用户的 OZON 店铺列表
        const shopConn = await getStoredErpConnection();
        const shopBaseUrl = shopConn.baseUrl;
        const shopToken = shopConn.token;

        if (!shopBaseUrl || !shopToken) {
          return { ok: false, error: "请先配置 ERP 连接" };
        }

        const shopsResponse = await fetch(shopBaseUrl + "/api/shops", {
          method: "GET",
          headers: { "Authorization": "Bearer " + shopToken }
        });

        if (!shopsResponse.ok) {
          return { ok: false, error: "获取店铺列表失败: HTTP " + shopsResponse.status };
        }

        const shopsData = await shopsResponse.json();
        if (shopsData.code !== 1) {
          return { ok: false, error: shopsData.msg || "获取店铺列表失败" };
        }

        const ozonShops = (shopsData.data || []).filter(function (s) {
          return s.platform === "OZON";
        });

        return { ok: true, data: ozonShops };
      }

      case "spb-self-hosted:fetch-ozon-product": {
        const productId = message.productId;
        if (!productId) return { ok: false, error: "缺少 productId" };
        const fetchResult = await fetchOzonProductViaTab(productId);
        if (fetchResult && fetchResult.ok && fetchResult.data) {
          await completeOzonProductVariantsForCollection(fetchResult.data, productId);
        }
        return fetchResult;
      }

      case "spb-self-hosted:aggregate-product-insights": {
        // 聚合多源数据（seller-analytics + 公开 API + ERP 缓存）
        // 失败的源静默降级，保证 list overlay 总能拿到能展示的字段
        const productId = message.productId;
        if (!productId) return { ok: false, error: "缺少 productId" };
        try {
          return await aggregateOzonProductInsights(productId);
        } catch (e) {
          return { ok: false, error: e && e.message ? e.message : String(e) };
        }
      }

      case "spb-self-hosted:fetch-ozon-product-batch": {
        const productIds = message.productIds;
        if (!Array.isArray(productIds) || !productIds.length) {
          return { ok: false, error: "缺少 productIds 数组" };
        }
        const batchResults = [];
        for (let i = 0; i < productIds.length; i++) {
          const pid = productIds[i];
          const r = await fetchOzonProductViaTab(pid);
          if (r && r.ok && r.data) {
            await completeOzonProductVariantsForCollection(r.data, pid);
          }
          batchResults.push(r);
          if (i < productIds.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
        return { ok: true, data: batchResults };
      }

      case "spb-self-hosted:get-listing-data": {
        const pids = message.productIds;
        if (!Array.isArray(pids) || !pids.length) {
          return { ok: false, error: "缺少 productIds" };
        }
        const companyId = await getSellerCompanyId();
        const listingResults = [];
        for (let i = 0; i < pids.length; i++) {
          const pid = pids[i];
          try {
            // 用 seller-tree/resolve/by-sku 直接拿 category_id + type_id
            let catId = null;
            let tId = null;
            try {
              const treeRes = await sellerTabFetchJson(
                "https://seller.ozon.ru/api/v1/seller-tree/resolve/by-sku",
                { skus: [String(pid)] },
                companyId
              );
              const resolved = treeRes && treeRes.resolved_categories_by_sku && treeRes.resolved_categories_by_sku[String(pid)];
              if (resolved) {
                catId = resolved.description_category_id_level_3 || resolved.description_category_id || null;
                tId = resolved.description_type_id || resolved.type_id || null;
              }
            } catch (e) {}

            // 补充重量/尺寸从 bundleByVariantId
            const insights = await getOzonInsights(pid);
            const specs = insights.specs || {};

            listingResults.push({
              ok: true,
              productId: pid,
              descriptionCategoryId: catId || (insights.detail && insights.detail.description_category_id) || null,
              typeId: tId,
              weight: specs.weightGrams || null,
              height: specs.heightMm || null,
              width: specs.widthMm || null,
              depth: specs.lengthMm || null,
              brand: insights.item && insights.item.brand || null,
              category: insights.item && (insights.item.category3 || insights.item.category1) || null,
            });
          } catch (e) {
            listingResults.push({ ok: false, productId: pid, error: e.message || String(e) });
          }
          if (i < pids.length - 1) await new Promise(r => setTimeout(r, 500));
        }
        return { ok: true, data: listingResults };
      }

      case "spb-self-hosted:fetch-ozon-product-to-erp": {
        return await collectOzonProductsToErp(message.productIds, {
          mode: message.mode || message.collectMode || "complete",
        });
      }
    }
  })().then(sendResponse).catch((error) => {
    sendResponse({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  });

  return true;
});
