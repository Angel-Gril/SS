(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
  const BRIDGE_ID = "spb-self-hosted-page-bridge";
  const PAGE_STATE_TIMEOUT_MS = 8000;
  const OZON_PANEL_ID = "spb-self-hosted-ozon-panel";
  const SS_ERP_OZON_1688_CONTEXT_KEY = "ss-erp:ozon-1688-context";
  const OZON_1688_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;
  let lastOzonUrl = "";

  injectPageBridge();
  initOzonOverlay();
  init1688PricingPanel();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "spb-self-hosted:collect-product") {
      return false;
    }

    collectCurrentPage()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : String(error)
        });
      });

    return true;
  });

  function injectPageBridge() {
    if (document.getElementById(BRIDGE_ID)) {
      return;
    }

    const script = document.createElement("script");
    script.id = BRIDGE_ID;
    script.src = chrome.runtime.getURL("content/page-bridge.js");
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
  }

  function requestPageState() {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("读取页面状态超时"));
      }, PAGE_STATE_TIMEOUT_MS);

      function onMessage(event) {
        if (event.source !== window) {
          return;
        }

        const payload = event.data;
        if (!payload || payload.direction !== RESPONSE_DIRECTION || payload.requestId !== requestId) {
          return;
        }

        cleanup();
        if (payload.ok) {
          resolve(payload.payload || {});
        } else {
          reject(new Error(payload.error || "页面桥接失败"));
        }
      }

      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
      }

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          direction: REQUEST_DIRECTION,
          requestId,
          type: "GET_PAGE_STATE"
        },
        "*"
      );
    });
  }

  async function collectCurrentPage() {
    // Ozon 商品页：走 entrypoint-api 拿完整数据（含图片）
    if (isOzonProductPage()) {
      return collectOzonViaApi();
    }

    const pageState = await requestPageState().catch(() => ({}));
    const platform = detectPlatform(location.hostname);
    const allSources = collectDataSources(pageState);
    const pageText = normalizeWhitespace(document.body ? document.body.innerText : "");
    const jsonLd = parseJsonLd();

    if (jsonLd.length) {
      allSources.push(...jsonLd);
    }

    const extractor = PLATFORM_EXTRACTORS[platform] || extractGenericProduct;
    const data = extractor({
      platform,
      pageText,
      pageState,
      sources: allSources,
      jsonLd
    });

    const warnings = [];
    if (data.monthlySales == null) {
      warnings.push("未稳定提取到月销量，可能目标站点未公开展示，或当前页未完整加载。");
    }
    if (data.grossWeightGrams == null) {
      warnings.push("未稳定提取到克重，建议补充页面字段映射或改为详情页采集。");
    }
    if (!data.skuItems.length) {
      warnings.push("未稳定提取到 SKU 明细，当前结果可能只有 SKU 数量。");
    }

    return {
      ...data,
      warnings,
      sourceUrl: location.href,
      sourceHost: location.hostname,
      collectedAt: new Date().toISOString()
    };
  }

  function is1688DetailPage() {
    return /(^|\.)1688\.com$/i.test(location.hostname) && /\/offer\/\d+\.html/i.test(location.pathname);
  }

  function extract1688ProductIdFromUrl(url) {
    const match = String(url || "").match(/\/offer\/(\d+)\.html/i) || String(url || "").match(/[?&](?:offerId|id)=(\d+)/i);
    return match && match[1] ? match[1] : "";
  }

  function numberFromText(value, fallback) {
    if (value == null || value === "") return fallback;
    const text = String(value).replace(/,/g, ".");
    const match = text.match(/-?\d+(?:\.\d+)?/);
    const number = Number(match ? match[0] : text);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatPanelMoney(value, prefix) {
    const number = numberFromText(value, NaN);
    if (!Number.isFinite(number)) return "-";
    return (prefix || "") + String(Math.round(number * 100) / 100);
  }

  function getErpConnection() {
    return new Promise((resolve) => {
      chrome.storage.local.get("ss_erp_connection", function (data) {
        resolve(data.ss_erp_connection || {});
      });
    });
  }

  function getLocalStorageValue(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, function (data) {
        resolve(data || {});
      });
    });
  }

  function loadOzon1688Context() {
    return getLocalStorageValue([SS_ERP_OZON_1688_CONTEXT_KEY]).then((result) => {
      const context = result[SS_ERP_OZON_1688_CONTEXT_KEY];
      return isRecentOzon1688Context(context) ? context : null;
    });
  }

  function isRecentOzon1688Context(context) {
    if (!context || typeof context !== "object") return false;
    const savedAt = Date.parse(context.savedAt || context.createdAt || "");
    if (!Number.isFinite(savedAt)) return false;
    return Date.now() - savedAt <= OZON_1688_CONTEXT_TTL_MS;
  }

  function normalize1688SkuAttributes(value) {
    const attrs = {};
    if (!value) return attrs;

    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((row, index) => {
        if (row == null || row === "") return;
        if (typeof row !== "object") {
          attrs["属性" + (index + 1)] = String(row);
          return;
        }
        const name = pickFirstValue(row, ["name", "key", "attrName", "propName", "title"]);
        const attrValue = pickFirstValue(row, ["value", "attrValue", "text", "content", "propValue", "valueName"]);
        if (name && attrValue != null && attrValue !== "") {
          attrs[String(name)] = typeof attrValue === "object" ? JSON.stringify(attrValue).slice(0, 300) : attrValue;
        }
      });
      return attrs;
    }

    if (typeof value === "object") {
      Object.keys(value).slice(0, 20).forEach((key) => {
        const item = value[key];
        if (item == null || item === "") return;
        attrs[String(key)] = typeof item === "object" ? JSON.stringify(item).slice(0, 300) : item;
      });
    }
    return attrs;
  }

  function pickSkuImageUrl(item) {
    const direct = pickFirstValue(item, ["imageUrl", "imgUrl", "skuImageUrl", "picUrl", "pictureUrl", "thumbUrl", "image", "img", "src", "url"]);
    if (typeof direct === "string") return normalizeImageUrl(direct);
    if (direct && typeof direct === "object") {
      const nested = pickFirstValue(direct, ["url", "src", "imageUrl", "imgUrl"]);
      if (typeof nested === "string") return normalizeImageUrl(nested);
    }
    return "";
  }

  function normalize1688SkuItemsForImport(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const skuId = item && item.skuId != null ? String(item.skuId) : "";
        const name = item && item.name != null ? String(item.name) : "";
        const specText = item && item.specText != null ? String(item.specText) : "";
        const price = item ? item.price : null;
        const stock = item ? parseLooseNumber(pickFirstValue(item, ["stock", "stockNum", "canBookCount", "quantity", "qty", "amountOnSale"])) : null;
        const imageUrl = item ? pickSkuImageUrl(item) : "";
        const attributes = item ? normalize1688SkuAttributes(item.attributes || item.props || item.skuAttributes || item.specAttrs) : {};
        const logisticsFeeCny = item ? parseLooseNumber(pickFirstValue(item, ["logisticsFeeCny", "internationalLogisticsFeeCny", "shippingCostCny"])) : null;
        const grossWeightGrams = item ? item.grossWeightGrams : null;
        return {
          skuId,
          name,
          specText,
          price,
          stock,
          imageUrl,
          logisticsFeeCny,
          grossWeightGrams,
          attributes,
        };
      })
      .filter((item) => item.skuId || item.name || item.specText || item.price != null)
      .slice(0, 200);
  }

  function normalize1688DetailImages(value) {
    return (Array.isArray(value) ? value : [])
      .map((item) => String(item || "").trim())
      .filter((item) => /^https?:\/\//i.test(item))
      .slice(0, 100);
  }

  function build1688SourceDetailsMetadata(product) {
    const details = {};
    if (Array.isArray(product.attributes) && product.attributes.length) details.attributes = product.attributes.slice(0, 100);
    if (Array.isArray(product.priceTiers) && product.priceTiers.length) details.priceTiers = product.priceTiers.slice(0, 50);
    if (Array.isArray(product.detailImages) && product.detailImages.length) details.detailImages = product.detailImages.slice(0, 100);
    const dimensions = {};
    if (numberFromText(product.lengthMm, 0) > 0) dimensions.lengthMm = numberFromText(product.lengthMm, 0);
    if (numberFromText(product.widthMm, 0) > 0) dimensions.widthMm = numberFromText(product.widthMm, 0);
    if (numberFromText(product.heightMm, 0) > 0) dimensions.heightMm = numberFromText(product.heightMm, 0);
    if (Object.keys(dimensions).length) details.dimensions = dimensions;
    const skuItems = normalize1688SkuItemsForImport(product.skuItems);
    if (skuItems.length) details.skuItems = skuItems;
    return Object.keys(details).length ? details : null;
  }

  function normalize1688PanelProduct(data, ozonSourceContext) {
    const product = data && typeof data === "object" ? data : {};
    const ozonContext = ozonSourceContext && typeof ozonSourceContext === "object" ? ozonSourceContext : null;
    const skuItems = normalize1688SkuItemsForImport(product.skuItems);
    const firstSku = skuItems.find((item) => numberFromText(item && item.price, 0) > 0) || null;
    const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
    const purchasePrice = numberFromText(product.purchasePriceCny || product.purchasePrice || product.price, 0)
      || numberFromText(firstSku && firstSku.price, 0);

    return {
      sourcePlatform: "1688",
      sourceUrl: product.sourceUrl || location.href,
      sourceHost: product.sourceHost || location.hostname,
      title: product.title || product.name || document.title || "未命名1688商品",
      sourceProductId: product.sourceProductId || product.productId || product.offerId || extract1688ProductIdFromUrl(product.sourceUrl || location.href),
      sourceCategoryId: product.sourceCategoryId || product.categoryId || "",
      sourceCategoryName: product.sourceCategoryName || (ozonSourceContext && ozonSourceContext.categoryName) || product.categoryName || product.category || "",
      sourceCategoryPath: product.sourceCategoryPath || product.categoryPath || "",
      supplier: product.supplier || product.shopName || product.sellerName || "",
      sku: product.sku || product.sourceProductId || product.productId || extract1688ProductIdFromUrl(product.sourceUrl || location.href),
      images,
      notes: product.description || "",
      skuItems,
      attributes: Array.isArray(product.attributes) ? product.attributes.slice(0, 100) : [],
      priceTiers: Array.isArray(product.priceTiers) ? product.priceTiers.slice(0, 50) : [],
      detailImages: normalize1688DetailImages(product.detailImages),
      purchasePriceCny: purchasePrice,
      domesticShippingCny: numberFromText(product.domesticShippingCny, 0),
      weightG: numberFromText(product.weightG || product.grossWeightGrams || product.weight, 0),
      lengthMm: numberFromText(product.lengthMm || product.length, 0),
      widthMm: numberFromText(product.widthMm || product.width, 0),
      heightMm: numberFromText(product.heightMm || product.height, 0),
      packageFeeCny: numberFromText(product.packageFeeCny, 0),
      commissionPct: numberFromText(product.commissionPct, 12),
      logisticsFeeCny: numberFromText(product.logisticsFeeCny, 0),
      exchangeRateRubToCny: numberFromText(product.exchangeRateRubToCny, 0.08),
      targetMarginPct: numberFromText(product.targetMarginPct, 30),
      sourceOzonProductId: ozonContext && ozonContext.productId ? String(ozonContext.productId) : "",
      ozonSourceContext: ozonContext,
      collectedAt: product.collectedAt || new Date().toISOString(),
    };
  }

  function build1688ImportPayload(product, root) {
    function field(name, fallback) {
      const node = root && root.querySelector('[data-ss-erp-1688-field="' + name + '"]');
      return node ? node.value : fallback;
    }

    const logisticsFeeCny = numberFromText(field("logisticsFeeCny", product.logisticsFeeCny), 0);
    const autoLogisticsFeeCny = numberFromText(product.autoLogisticsFeeCny, 0);
    const keepSkuLogisticsFees = !(autoLogisticsFeeCny > 0) || Math.abs(logisticsFeeCny - autoLogisticsFeeCny) < 0.01;
    const skuItems = normalize1688SkuItemsForImport(product.skuItems).map((item) => {
      if (keepSkuLogisticsFees) return item;
      return {
        ...item,
        logisticsFeeCny: null,
      };
    });

    return {
      sourcePlatform: "1688",
      sourceUrl: product.sourceUrl,
      sourceHost: product.sourceHost,
      title: product.title,
      sourceProductId: product.sourceProductId || undefined,
      sourceCategoryId: product.sourceCategoryId || undefined,
      sourceCategoryName: product.sourceCategoryName || undefined,
      sourceCategoryPath: product.sourceCategoryPath || undefined,
      supplier: product.supplier || undefined,
      sku: product.sku || product.sourceProductId || undefined,
      images: product.images && product.images.length ? product.images : undefined,
      notes: product.notes || undefined,
      skuItems,
      attributes: product.attributes && product.attributes.length ? product.attributes : undefined,
      priceTiers: product.priceTiers && product.priceTiers.length ? product.priceTiers : undefined,
      detailImages: product.detailImages && product.detailImages.length ? product.detailImages : undefined,
      purchasePriceCny: numberFromText(field("purchasePriceCny", product.purchasePriceCny), 0),
      domesticShippingCny: numberFromText(field("domesticShippingCny", product.domesticShippingCny), 0),
      weightG: numberFromText(field("weightG", product.weightG), 0),
      lengthMm: product.lengthMm || undefined,
      widthMm: product.widthMm || undefined,
      heightMm: product.heightMm || undefined,
      packageFeeCny: numberFromText(field("packageFeeCny", product.packageFeeCny), 0),
      commissionPct: numberFromText(field("commissionPct", product.commissionPct), 12),
      logisticsFeeCny,
      exchangeRateRubToCny: numberFromText(field("exchangeRateRubToCny", product.exchangeRateRubToCny), 0.08),
      targetMarginPct: numberFromText(field("targetMarginPct", product.targetMarginPct), 30),
      metadata: {
        sourceDetails: build1688SourceDetailsMetadata(product),
        ...(product.ozonSourceContext ? {
          sourceOzonProductId: product.sourceOzonProductId || product.ozonSourceContext.productId,
          ozonSourceContext: product.ozonSourceContext,
        } : {}),
      },
    };
  }

  async function call1688Erp(path, payload) {
    const conn = await getErpConnection();
    if (!conn.baseUrl || !conn.token) {
      throw new Error("请先在扩展设置中配置 ERP 地址和 Token");
    }
    const res = await fetch(String(conn.baseUrl).replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + conn.token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 1) {
      throw new Error(data.msg || ("ERP 请求失败：" + res.status));
    }
    return data;
  }

  function set1688PanelStatus(root, message, tone) {
    const node = root && root.querySelector("[data-ss-erp-1688-summary]");
    if (!node) return;
    node.className = "ss-erp-1688-summary" + (tone ? " " + tone : "");
    node.textContent = message;
  }

  function set1688LogisticsHint(root, message, tone) {
    const node = root && root.querySelector("[data-ss-erp-1688-logistics-hint]");
    if (!node) return;
    node.className = "ss-erp-1688-logistics-hint" + (tone ? " " + tone : "");
    node.textContent = message;
  }

  async function load1688LogisticsQuote(root, product) {
    const engine = window.OZON_CALC_RULE_ENGINE;
    if (!engine || typeof engine.buildServiceQuote !== "function" || typeof engine.resolveBestQuote !== "function") {
      set1688LogisticsHint(root, "物流规则引擎未加载，可手工填写国际物流费。", "warning");
      return null;
    }

    const result = await getLocalStorageValue(["ozon-calc:config-snapshot"]);
    const snapshot = result["ozon-calc:config-snapshot"] || {};
    const selectedServiceIds = snapshot.userConfig && Array.isArray(snapshot.userConfig.selectedServiceIds)
      ? snapshot.userConfig.selectedServiceIds
      : [];
    const ruleSnapshot = snapshot.ruleSnapshot || { services: [] };
    const services = Array.isArray(ruleSnapshot.services) ? ruleSnapshot.services : [];

    if (!selectedServiceIds.length || !services.length) {
      set1688LogisticsHint(root, "未同步 Ozon 物流模板，可先在 Ozon 核价面板同步配置。", "warning");
      return null;
    }

    const input = {
      weightG: numberFromText(product.weightG, 0),
      priceRMB: numberFromText(product.purchasePriceCny, 0),
      fxRate: numberFromText(product.exchangeRateRubToCny, 0.08),
      lenCm: numberFromText(product.lengthCm || product.lengthMm / 10, 0),
      widCm: numberFromText(product.widthCm || product.widthMm / 10, 0),
      hgtCm: numberFromText(product.heightCm || product.heightMm / 10, 0),
      hasBattery: false,
    };
    const quotes = [];

    selectedServiceIds.forEach((serviceId) => {
      const ruleProfiles = services.filter((rule) => rule && rule.serviceId === serviceId);
      const serviceRule = ruleProfiles[0] || null;
      const quote = engine.buildServiceQuote({
        id: serviceId,
        providerId: serviceRule && serviceRule.providerId,
        displayName: serviceRule && serviceRule.displayName ? serviceRule.displayName : serviceId,
        carrierName: serviceRule && serviceRule.carrierName,
        priority: serviceRule && serviceRule.priority,
      }, ruleProfiles, input);
      if (quote && quote.available) {
        quotes.push(quote);
      }
    });

    const best = engine.resolveBestQuote(quotes, snapshot.userConfig && snapshot.userConfig.resolutionMode || "lowest_cost", selectedServiceIds);
    if (!best) {
      set1688LogisticsHint(root, "当前重量/售价未命中已同步物流模板，可手工填写国际物流费。", "warning");
      return null;
    }

    const field = root && root.querySelector('[data-ss-erp-1688-field="logisticsFeeCny"]');
    if (field && !(numberFromText(field.value, 0) > 0)) {
      field.value = String(Math.round(numberFromText(best.shippingCost, 0) * 100) / 100);
    }
    product.autoLogisticsFeeCny = Math.round(numberFromText(best.shippingCost, 0) * 100) / 100;
    product.logisticsFeeCny = numberFromText(field && field.value, best.shippingCost);
    product.skuItems = build1688SkuLogisticsFees(product, services, selectedServiceIds, snapshot, input);
    set1688LogisticsHint(root, "命中物流：" + best.displayName + " · 运费 ¥" + formatPanelMoney(best.shippingCost, "") + " · " + (best.reason || ""), "success");
    return best;
  }

  function build1688SkuLogisticsFees(product, services, selectedServiceIds, snapshot, baseInput) {
    const engine = window.OZON_CALC_RULE_ENGINE;
    if (!engine || typeof engine.buildServiceQuote !== "function" || typeof engine.resolveBestQuote !== "function") {
      return product.skuItems || [];
    }

    return (Array.isArray(product.skuItems) ? product.skuItems : []).map((item) => {
      const skuWeightG = numberFromText(item && item.grossWeightGrams, numberFromText(baseInput && baseInput.weightG, 0));
      const skuPriceCny = numberFromText(item && item.price, numberFromText(baseInput && baseInput.priceRMB, 0));
      if (!(skuWeightG > 0)) return item;

      const skuInput = {
        ...baseInput,
        weightG: skuWeightG,
        priceRMB: skuPriceCny,
      };
      const quotes = [];
      selectedServiceIds.forEach((serviceId) => {
        const ruleProfiles = services.filter((rule) => rule && rule.serviceId === serviceId);
        const serviceRule = ruleProfiles[0] || null;
        const quote = engine.buildServiceQuote({
          id: serviceId,
          providerId: serviceRule && serviceRule.providerId,
          displayName: serviceRule && serviceRule.displayName ? serviceRule.displayName : serviceId,
          carrierName: serviceRule && serviceRule.carrierName,
          priority: serviceRule && serviceRule.priority,
        }, ruleProfiles, skuInput);
        if (quote && quote.available) {
          quotes.push(quote);
        }
      });

      const best = engine.resolveBestQuote(quotes, snapshot.userConfig && snapshot.userConfig.resolutionMode || "lowest_cost", selectedServiceIds);
      if (!best) return item;
      return {
        ...item,
        logisticsFeeCny: Math.round(numberFromText(best.shippingCost, 0) * 100) / 100,
      };
    });
  }

  function set1688PanelBusy(root, busy) {
    if (!root) return;
    root.querySelectorAll("button[data-ss-erp-1688-action]").forEach((button) => {
      button.disabled = !!busy;
    });
  }

  function render1688PricingResult(root, data) {
    const preview = data && data.data ? data.data : {};
    const pricing = preview.pricing || {};
    const mapping = preview.mapping || null;
    const saveMode = preview.saveMode === "update" ? "更新已有货源" : "创建新货源";
    const parts = [
      saveMode,
      "建议售价 " + formatPanelMoney(pricing.suggestedSalePriceCny, "¥") + " / " + formatPanelMoney(pricing.suggestedSalePriceRub, "₽"),
      "预计利润 " + formatPanelMoney(pricing.estimatedProfitCny, "¥"),
      "利润率 " + formatPanelMoney(pricing.estimatedMarginPct, "") + "%",
      mapping ? ("类目映射 Ozon " + mapping.targetCategoryId + " / type " + mapping.targetTypeId) : "未命中类目映射",
    ];
    set1688PanelStatus(root, parts.join(" · "), "success");
  }

  async function preview1688Pricing(root, product) {
    set1688PanelBusy(root, true);
    set1688PanelStatus(root, "正在调用 ERP 核价...", "");
    try {
      const payload = build1688ImportPayload(product, root);
      const data = await call1688Erp("/api/supply/1688/preview", payload);
      render1688PricingResult(root, data);
    } catch (error) {
      set1688PanelStatus(root, error && error.message ? error.message : String(error), "error");
    } finally {
      set1688PanelBusy(root, false);
    }
  }

  async function import1688SupplyGood(root, product) {
    set1688PanelBusy(root, true);
    set1688PanelStatus(root, "正在保存 1688 商品到 ERP...", "");
    try {
      const payload = build1688ImportPayload(product, root);
      const data = await call1688Erp("/api/supply/1688/import", payload);
      set1688PanelStatus(root, data.msg || "1688 商品已保存到 ERP", "success");
      render1688PostImportActions(root, product, data);
    } catch (error) {
      set1688PanelStatus(root, error && error.message ? error.message : String(error), "error");
    } finally {
      set1688PanelBusy(root, false);
    }
  }

  function render1688PostImportActions(root, product, importResponse) {
    if (!root) return;
    const existing = root.querySelector("[data-ss-erp-1688-post-import]");
    if (existing) existing.remove();
    const supplyGood = importResponse && importResponse.data ? importResponse.data : {};
    const hasOzonContext = Boolean(product && product.ozonSourceContext);
    const wrap = document.createElement("div");
    wrap.className = "ss-erp-1688-post-import";
    wrap.setAttribute("data-ss-erp-1688-post-import", "ready");
    wrap.innerHTML = [
      hasOzonContext ? '<button type="button" data-ss-erp-1688-action="return-ozon">返回Ozon</button>' : "",
      '<button type="button" data-ss-erp-1688-action="open-erp-good">查看ERP货源</button>',
    ].filter(Boolean).join("");

    const summary = root.querySelector("[data-ss-erp-1688-summary]");
    if (summary && summary.parentNode) {
      summary.parentNode.insertBefore(wrap, summary.nextSibling);
    } else {
      root.appendChild(wrap);
    }

    const returnButton = wrap.querySelector('[data-ss-erp-1688-action="return-ozon"]');
    if (returnButton) {
      returnButton.addEventListener("click", () => returnToOzonSource(root, product));
    }
    const erpButton = wrap.querySelector('[data-ss-erp-1688-action="open-erp-good"]');
    if (erpButton) {
      erpButton.addEventListener("click", () => open1688ErpSupplyGood(root, product, supplyGood));
    }
  }

  async function returnToOzonSource(root, product) {
    const ozonSourceContext = product && product.ozonSourceContext ? product.ozonSourceContext : null;
    if (!ozonSourceContext) {
      set1688PanelStatus(root, "当前 1688 商品没有 Ozon 来源上下文。", "error");
      return;
    }
    try {
      const response = await sendRuntimeMessage({
        type: "ss-erp:return-to-ozon-source",
        ozonSourceContext,
      });
      if (!response || !response.ok) {
        throw new Error((response && (response.msg || response.error)) || "返回 Ozon 失败");
      }
      set1688PanelStatus(root, "已切回 Ozon 来源页。", "success");
    } catch (error) {
      set1688PanelStatus(root, error && error.message ? error.message : String(error), "error");
    }
  }

  async function open1688ErpSupplyGood(root, product, supplyGood) {
    const item = supplyGood && typeof supplyGood === "object" ? supplyGood : {};
    try {
      const response = await sendRuntimeMessage({
        type: "ss-erp:open-erp-supply-good",
        supplyGoodId: item.id || "",
        sku: item.sku || product.sku || product.sourceProductId || "",
      });
      if (!response || !response.ok) {
        throw new Error((response && (response.msg || response.error)) || "打开 ERP 货源失败");
      }
      set1688PanelStatus(root, "已打开 ERP 货源管理。", "success");
    } catch (error) {
      set1688PanelStatus(root, error && error.message ? error.message : String(error), "error");
    }
  }

  function render1688PricingPanel(product) {
    const root = document.createElement("div");
    root.id = "ss-erp-1688-panel";
    root.setAttribute("data-ss-erp-1688-panel", "ready");
    const image = product.images && product.images[0] ? product.images[0] : "";
    root.innerHTML = [
      '<div class="ss-erp-1688-head">',
      '  <div>',
      '    <div class="ss-erp-1688-title">SS ERP 1688核价采集</div>',
      '    <div class="ss-erp-1688-subtitle">扩展主流程：读取当前 1688 商品，按 ERP 计价配置核价并保存货源。</div>',
      '  </div>',
      '  <button type="button" class="ss-erp-1688-close" data-ss-erp-1688-close>×</button>',
      '</div>',
      '<div class="ss-erp-1688-body">',
      '  <div class="ss-erp-1688-product">',
      image ? '    <img src="' + escapeHtml(image) + '" alt="">' : '    <div></div>',
      '    <div>',
      '      <div class="ss-erp-1688-product-name">' + escapeHtml(product.title) + '</div>',
      '      <div class="ss-erp-1688-product-meta">ID ' + escapeHtml(product.sourceProductId || "-") + ' · ' + escapeHtml(product.supplier || "未识别供应商") + '</div>',
      '    </div>',
      '  </div>',
      build1688OzonContext(product.ozonSourceContext),
      '  <div class="ss-erp-1688-grid">',
      build1688Field("purchasePriceCny", "采购价 CNY", product.purchasePriceCny, "0.01"),
      build1688Field("domesticShippingCny", "国内运费", product.domesticShippingCny, "0.01"),
      build1688Field("weightG", "重量 g", product.weightG, "1"),
      build1688Field("packageFeeCny", "包装费", product.packageFeeCny, "0.01"),
      build1688Field("commissionPct", "Ozon佣金 %", product.commissionPct, "0.1"),
      build1688Field("logisticsFeeCny", "国际物流费", product.logisticsFeeCny, "0.01"),
      build1688Field("exchangeRateRubToCny", "RUB->CNY", product.exchangeRateRubToCny, "0.0001"),
      build1688Field("targetMarginPct", "目标利润率 %", product.targetMarginPct, "0.1"),
      '  </div>',
      '  <div class="ss-erp-1688-actions">',
      '    <button type="button" data-ss-erp-1688-action="preview">核价</button>',
      '    <button type="button" data-ss-erp-1688-action="collect">采集到ERP</button>',
      '  </div>',
      '  <div class="ss-erp-1688-logistics-hint" data-ss-erp-1688-logistics-hint>正在读取 Ozon 物流配置...</div>',
      '  <div class="ss-erp-1688-summary" data-ss-erp-1688-summary>已读取页面商品信息，可先核价再采集。</div>',
      '</div>',
    ].join("");

    root.querySelector("[data-ss-erp-1688-close]").addEventListener("click", () => root.remove());
    root.querySelector('[data-ss-erp-1688-action="preview"]').addEventListener("click", () => preview1688Pricing(root, product));
    root.querySelector('[data-ss-erp-1688-action="collect"]').addEventListener("click", () => import1688SupplyGood(root, product));
    return root;
  }

  function build1688OzonContext(ozonSourceContext) {
    if (!ozonSourceContext) return "";
    const title = ozonSourceContext.title || "Ozon 商品";
    const productId = ozonSourceContext.productId || "-";
    const category = ozonSourceContext.categoryName || "未识别类目";
    const image = Array.isArray(ozonSourceContext.images) && ozonSourceContext.images[0] ? ozonSourceContext.images[0] : "";
    return [
      '<div class="ss-erp-1688-ozon-context" data-ss-erp-1688-ozon-context>',
      image ? '  <img src="' + escapeHtml(image) + '" alt="">' : '  <div></div>',
      '  <div>',
      '    <div class="ss-erp-1688-ozon-title">来自 Ozon 以图搜：' + escapeHtml(title) + '</div>',
      '    <div class="ss-erp-1688-ozon-meta">SKU ' + escapeHtml(productId) + ' · ' + escapeHtml(category) + '</div>',
      '  </div>',
      '</div>',
    ].join("");
  }

  function build1688Field(name, label, value, step) {
    return [
      '<div class="ss-erp-1688-field">',
      '  <label>' + escapeHtml(label) + '</label>',
      '  <input type="number" step="' + escapeHtml(step) + '" data-ss-erp-1688-field="' + escapeHtml(name) + '" value="' + escapeHtml(String(value == null ? "" : value)) + '">',
      '</div>',
    ].join("");
  }

  async function init1688PricingPanel() {
    if (!is1688DetailPage() || window.SS_ERP_1688_PRICING_PANEL) return;
    window.SS_ERP_1688_PRICING_PANEL = { status: "initializing" };
    try {
      const ozonSourceContext = await loadOzon1688Context();
      const data = await collectCurrentPage();
      const product = normalize1688PanelProduct(data, ozonSourceContext);
      const panel = render1688PricingPanel(product);
      document.body.appendChild(panel);
      load1688LogisticsQuote(panel, product).catch((error) => {
        set1688LogisticsHint(panel, error && error.message ? error.message : String(error), "warning");
      });
      window.SS_ERP_1688_PRICING_PANEL = { status: "ready", product };
    } catch (error) {
      window.SS_ERP_1688_PRICING_PANEL = { status: "error", error: error && error.message ? error.message : String(error) };
    }
  }

  async function collectOzonViaApi() {
    const productId = parseOzonProductIdFromUrl(location.href);
    if (!productId) {
      throw new Error("无法从 URL 提取 product_id");
    }

    const url = "/api/entrypoint-api.bx/page/json/v2?url=" + encodeURIComponent("/product/" + productId + "/?language=ru");
    const res = await fetch(url, {
      credentials: "include",
      headers: { "x-o3-app-name": "dweb_client", "accept": "application/json", "x-o3-language": "ru", "Accept-Language": "ru" }
    });
    if (!res.ok) {
      throw new Error("Ozon API HTTP " + res.status);
    }
    const data = await res.json();
    const states = data && data.widgetStates;
    if (!states || typeof states !== "object") {
      throw new Error("Ozon API 未返回 widgetStates");
    }

    const widgets = [];
    for (const key of Object.keys(states)) {
      try { widgets.push({ key, state: JSON.parse(states[key]) }); } catch (e) {}
    }

    const priceCurrency = globalThis.SS_ERP_PRICE_CURRENCY || {};
    const parsePriceWithCurrency = priceCurrency.parsePriceWithCurrency || ((text, fallback) => ({
      price: text ? String(text).replace(/[^\d.,]/g, "").replace(",", ".") : null,
      currency: fallback || null,
    }));
    const detectCurrencyFromText = priceCurrency.detectCurrencyFromText || ((text, fallback) => {
      const raw = text == null ? "" : String(text);
      if (raw.indexOf("¥") >= 0 || raw.indexOf("￥") >= 0 || /\b(?:CNY|RMB)\b/i.test(raw)) return "CNY";
      if (raw.indexOf("₽") >= 0 || /\bRUB\b/i.test(raw)) return "RUB";
      if (raw.indexOf("₸") >= 0 || /\bKZT\b/i.test(raw)) return "KZT";
      if (/\bBYN\b/i.test(raw)) return "BYN";
      return fallback || null;
    });
    const fallbackCurrencyByHost = priceCurrency.fallbackCurrencyByHost || ((host) => {
      const value = String(host || "").toLowerCase();
      if (value.includes("ozon.kz")) return "KZT";
      if (value.includes("ozon.by")) return "BYN";
      return "RUB";
    });

    let currency = null;
    let priceString = null;

    let title = "";
    let images = [];
    let price = null;
    let oldPrice = null;
    let description = "";
    let brand = null;
    let category = null;
    const attributes = [];

    for (const { key: k, state: st } of widgets) {
      if (!title && /^(webProductHeading|webStickyProducts)/.test(k) && st && typeof st.title === "string") {
        title = st.title;
      }
      if (!title && /^webProduct/.test(k) && st && typeof st.name === "string") {
        title = st.name;
      }
      if (!images.length && /^(webGallery|webProductGallery|gallery)/.test(k) && st) {
        const src = st.images || st.coverImage || st.gallery || st.photos;
        if (Array.isArray(src)) {
          for (const img of src) {
            const u = typeof img === "string" ? img : (img && (img.src || img.url || img.originalUrl));
            if (typeof u === "string" && u.startsWith("http")) images.push(u);
          }
        }
      }
      if (!price && /^(webPrice|webSale|price)/.test(k) && st) {
        const rp = st.cardPrice || st.price || st.finalPrice || st.tradePrice;
        const ro = st.originalPrice || st.priceWithoutDiscount || st.oldPrice;
        if (typeof rp === "string") {
          priceString = rp;
          const parsed = parsePriceWithCurrency(rp, currency || st.currency);
          price = parsed.price;
          currency = parsed.currency || currency;
        }
        if (typeof ro === "string") {
          const parsedOld = parsePriceWithCurrency(ro, currency || st.currency);
          oldPrice = parsedOld.price;
          currency = currency || parsedOld.currency;
        }
        currency = detectCurrencyFromText(st.disclaimerPriceHeader, currency || st.currency);
        if (Array.isArray(st.disclaimerPriceBodyRs)) {
          for (const row of st.disclaimerPriceBodyRs) {
            currency = detectCurrencyFromText(row && row.content, currency);
          }
        }
      }
      if (!description && /^(webDescription|webRichAnnotation|description)/.test(k) && st) {
        description = st.richAnnotation || st.description || st.text || "";
      }
      if (!category && /^breadCrumbs/.test(k) && st && Array.isArray(st.breadcrumbs) && st.breadcrumbs.length) {
        category = st.breadcrumbs[st.breadcrumbs.length - 1].text || null;
      }
      if (/^(webShortCharacteristics|webCharacteristics)/.test(k) && st && Array.isArray(st.characteristics)) {
        for (const ch of st.characteristics) {
          let nm = "";
          if (ch.title && Array.isArray(ch.title.textRs) && ch.title.textRs.length) {
            nm = ch.title.textRs[0].content || "";
          } else if (typeof ch.title === "string") {
            nm = ch.title;
          }
          let vl = "";
          if (Array.isArray(ch.values)) {
            vl = ch.values.map(v => (v.text || v.value || "").replace(/,\s*$/, "")).filter(Boolean).join(", ");
          }
          if (nm && vl) attributes.push({ name: nm, value: vl });
        }
      }
    }

    currency = detectCurrencyFromText(priceString, currency);

    if (!currency) {
      currency = fallbackCurrencyByHost(location.hostname);
    }

    for (const a of attributes) {
      if (!brand && /бренд|brand|Бренд/i.test(a.name)) brand = a.value;
    }

    // 占位：抽取 model_id + variants[]（结构未知，先 dump 全量 widgetStates 到 console 供二次完善）
    const variantsResult = extractOzonVariants(widgets, productId);
    if (variantsResult.dump) {
      console.log("[ss-erp] OZON widgetStates dump (variants 解析占位):", variantsResult.dump);
    }

    return {
      title: title || "未知商品",
      publishTitle: title || "",
      sourceTitleRaw: title || "",
      sourceLocale: "ru",
      productId,
      sourceUrl: location.href,
      sourceHost: location.hostname,
      sourcePlatform: "ozon",
      images,
      price: price || oldPrice || "",
      currency,
      description: typeof description === "string" ? description.slice(0, 2000) : "",
      brand,
      categoryName: category,
      attributes,
      skuItems: [{ skuId: productId, name: title, price: price ? Number(price) : null }],
      skuCount: 1,
      variants: variantsResult.variants,
      modelId: variantsResult.modelId,
      widgetStatesDump: variantsResult.dump,
      warnings: [],
      collectedAt: new Date().toISOString()
    };
  }

  // 占位实现：扫描 widgetStates 找 model_id 和 variants 候选 widget
  // 当前阶段输出 console dump，等用户在真实多变体页面跑一次后，把 widget key + 字段路径补完即可
  function extractOzonVariants(widgets, currentProductId) {
    const candidateKeys = [];
    let modelId = null;
    let variants = [];
    let aspectName = null;

    for (const { key, state } of widgets) {
      // 候选 widget：名字含 aspect/variant/model/sku 都收集，dump 时人工核对
      if (/aspect|variant|model|sku/i.test(key)) {
        candidateKeys.push({ key, sample: state });
      }
      // webAspects 是真正的变体源
      if (/^webAspects/.test(key) && state && Array.isArray(state.aspects) && state.aspects.length) {
        const aspect = state.aspects[0];
        aspectName = aspect.aspectName || aspect.aspectKey || null;
        if (Array.isArray(aspect.variants)) {
          variants = aspect.variants
            .filter((v) => v && v.sku)
            .map((v) => {
              const text = v.data && Array.isArray(v.data.textRs) && v.data.textRs[0] ? v.data.textRs[0].content : null;
              const cover = v.data && v.data.coverImage ? v.data.coverImage : null;
              const priceText = v.data && v.data.price ? v.data.price : null;
              const parsedPrice = parsePriceWithCurrency(priceText, currency);
              return {
                sku: String(v.sku),
                attrs: aspectName ? { [aspectName]: text || String(v.sku) } : (text ? { variant: text } : {}),
                price: parsedPrice.price || (typeof v.price === "number" ? v.price : null),
                priceCurrency: parsedPrice.currency || currency || null,
                priceText: priceText,
                ozonInternalPrice: typeof v.price === "number" ? v.price : null,
                images: cover ? [cover] : [],
                availability: v.availability || null,
                active: !!v.active,
                title: v.data && v.data.title ? v.data.title : null,
              };
            });
        }
        // OZON 没暴露 model_id，用 from_sku（当前 product_id）作为分组标识
        if (aspect.aspectModalInfo && aspect.aspectModalInfo.link) {
          const m = String(aspect.aspectModalInfo.link).match(/from_sku=(\d+)/);
          if (m) modelId = m[1];
        }
        if (!modelId) modelId = String(currentProductId);
      }
    }

    // dump 仅保留候选 widget 摘要（仍保留供后续诊断）
    const dump = candidateKeys.length
      ? {
          currentProductId,
          modelIdGuess: modelId,
          aspectName,
          parsedVariantCount: variants.length,
          allWidgetKeys: widgets.map((w) => w.key),
          candidates: candidateKeys.slice(0, 20).map((c) => ({
            key: c.key,
            keys: c.sample && typeof c.sample === "object" ? Object.keys(c.sample).slice(0, 30) : [],
            preview: safePreview(c.sample, c.key)
          }))
        }
      : null;

    return {
      modelId,
      variants,
      dump
    };
  }

  function safePreview(obj, key) {
    try {
      const s = JSON.stringify(obj);
      const maxLen = /^webAspects/.test(String(key || "")) ? 60000 : 1500;
      return s.length > maxLen ? s.slice(0, maxLen) + "...[truncated]" : s;
    } catch (e) {
      return String(obj).slice(0, 500);
    }
  }

  function initOzonOverlay() {
    if (!/ozon\.(ru|kz|by)$/i.test(location.hostname)) {
      return;
    }

    const refresh = () => {
      if (location.href === lastOzonUrl) {
        return;
      }
      lastOzonUrl = location.href;
      if (isOzonProductPage()) {
        renderOzonPanel();
      } else {
        removeOzonPanel();
      }
    };

    refresh();
    setInterval(refresh, 1200);
  }

  function isOzonProductPage() {
    return /^https:\/\/(?:www\.)?ozon\.(?:ru|kz|by)\/product\//i.test(location.href);
  }

  function parseOzonProductIdFromUrl(url) {
    const match = String(url || "").split("?")[0].match(/-([0-9]{6,})\/?$/i);
    return match ? match[1] : "";
  }

  function removeOzonPanel() {
    const panel = document.getElementById(OZON_PANEL_ID);
    if (panel) {
      panel.remove();
    }
  }

  async function renderOzonPanel() {
    const productId = parseOzonProductIdFromUrl(location.href);
    if (!productId || document.getElementById(OZON_PANEL_ID)) {
      return;
    }

    const panel = createOzonPanelShell(productId);
    document.body.appendChild(panel);

    try {
      const response = await sendRuntimeMessage({
        type: "spb-self-hosted:get-ozon-insights",
        productId,
        sourceUrl: location.href
      });

      if (!response || !response.ok || !response.data) {
        throw new Error((response && response.error) || "读取 Ozon 数据失败");
      }

      fillOzonPanel(panel, response.data);
    } catch (error) {
      const status = panel.querySelector("[data-role='status']");
      if (status) {
        status.textContent = error && error.message ? error.message : String(error);
      }
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(formatRuntimeMessageError(chrome.runtime.lastError.message)));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        reject(new Error(formatRuntimeMessageError(error && error.message ? error.message : String(error))));
      }
    });
  }

  function formatRuntimeMessageError(message) {
    const text = String(message || "");
    if (/Extension context invalidated|context invalidated|Receiving end does not exist/i.test(text)) {
      return "扩展刚刚被重新加载，请刷新当前 Ozon 商品页后重试数据一览。";
    }
    return text || "扩展后台未响应";
  }

  function createOzonPanelShell(productId) {
    const panel = document.createElement("section");
    panel.id = OZON_PANEL_ID;
    panel.style.cssText = [
      "position:fixed",
      "left:0",
      "top:50%",
      "transform:translateY(-50%)",
      "z-index:2147483646",
      "width:44px",
      "background:#ffffff",
      "border-radius:0 12px 12px 0",
      "box-shadow:2px 4px 24px rgba(15,23,40,0.12), 0 1px 4px rgba(15,23,40,0.06)",
      "font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif",
      "color:#1a2332",
      "overflow:hidden",
      "user-select:none",
      "transition:width 0.25s cubic-bezier(0.4,0,0.2,1), border-radius 0.25s"
    ].join(";");

    panel.innerHTML = `
      <div data-role="tab" style="writing-mode:vertical-rl;text-orientation:mixed;padding:14px 10px;cursor:pointer;font-size:12px;font-weight:700;color:#9a3412;letter-spacing:0.05em;display:flex;align-items:center;gap:6px;white-space:nowrap;">
        <span style="writing-mode:horizontal-tb;font-size:14px;">📊</span>
        <span>数据一览</span>
      </div>
      <div data-role="expanded" style="display:none;width:340px;">
        <div style="background:linear-gradient(135deg,#9a3412 0%,#ea580c 100%);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
          <div>
            <div style="font-size:13px;font-weight:700;color:#fff;letter-spacing:0.01em;">Ozon 数据一览</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.72);margin-top:2px;">SKU ${productId}</div>
          </div>
          <div style="display:flex;gap:5px;">
            <button type="button" data-role="search-1688" title="用主图去 1688 搜同款" style="border:0;background:rgba(255,255,255,0.18);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.15s;">搜1688</button>
            <button type="button" data-role="copy" title="复制数据" style="border:0;background:rgba(255,255,255,0.18);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.15s;">复制</button>
            <button type="button" data-role="refresh" title="刷新数据" style="border:0;background:rgba(255,255,255,0.18);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.15s;">刷新</button>
            <button type="button" data-role="collapse" style="border:0;background:rgba(255,255,255,0.12);color:#fff;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;font-weight:700;transition:background 0.15s;">◀</button>
          </div>
        </div>
        <div data-role="body" style="padding:12px;max-height:70vh;overflow-y:auto;">
          <div data-role="status" style="font-size:12px;color:#6b7a93;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f0b400;animation:pulse 1.5s infinite;"></span>
            读取 seller.ozon.ru 分析数据中...
          </div>
          <div data-role="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;"></div>
        </div>
      </div>
      <style>
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        #${OZON_PANEL_ID}::-webkit-scrollbar { width: 4px; }
        #${OZON_PANEL_ID}::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }
      </style>
    `;

    let expanded = false;
    const tab = panel.querySelector("[data-role='tab']");
    const expandedArea = panel.querySelector("[data-role='expanded']");

    function expand() {
      expanded = true;
      panel.style.width = "340px";
      panel.style.borderRadius = "0 12px 12px 0";
      tab.style.display = "none";
      expandedArea.style.display = "block";
    }

    function collapse() {
      expanded = false;
      panel.style.width = "44px";
      tab.style.display = "flex";
      expandedArea.style.display = "none";
    }

    tab.addEventListener("click", expand);
    panel.querySelector("[data-role='collapse']").addEventListener("click", (e) => {
      e.stopPropagation();
      collapse();
    });

    // 默认展开数据一览窗
    expand();

    panel.querySelector("[data-role='refresh']").addEventListener("click", (e) => {
      e.stopPropagation();
      collapse();
      setTimeout(() => {
        panel.remove();
        lastOzonUrl = "";
        renderOzonPanel();
      }, 200);
    });

    panel.querySelector("[data-role='search-1688']").addEventListener("click", (e) => {
      e.stopPropagation();
      open1688ImageSearchFromOzon(panel);
    });

    panel.querySelector("[data-role='copy']").addEventListener("click", (e) => {
      e.stopPropagation();
      const data = panel._ozonData;
      if (data) {
        navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
          const btn = panel.querySelector("[data-role='copy']");
          const origHTML = btn.innerHTML;
          btn.innerHTML = "已复制";
          btn.style.background = "rgba(22,163,74,0.7)";
          setTimeout(() => { btn.innerHTML = origHTML; btn.style.background = "rgba(255,255,255,0.18)"; }, 1800);
        }).catch(() => {});
      }
    });

    // hover 自动展开/收起
    let hoverTimer = null;
    panel.addEventListener("mouseenter", () => {
      if (!expanded) {
        hoverTimer = setTimeout(expand, 300);
      }
    });
    panel.addEventListener("mouseleave", () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (expanded) {
        hoverTimer = setTimeout(collapse, 600);
      }
    });

    return panel;
  }

  function buildOzon1688SearchContext(data) {
    const payload = data && typeof data === "object" ? data : {};
    const item = payload.item || {};
    const detail = payload.detail || {};
    const specs = payload.specs || {};
    const imageCandidates = []
      .concat(item.image || [])
      .concat(item.imageUrl || [])
      .concat(item.photo || [])
      .concat(detail.primaryImage || [])
      .concat(Array.isArray(detail.images) ? detail.images : [])
      .concat(Array.isArray(item.images) ? item.images : []);
    const images = imageCandidates.filter((image, index, source) => {
      return typeof image === "string" && image && source.indexOf(image) === index;
    });
    return {
      productId: String(item.sku || item.productId || payload.productId || parseOzonProductIdFromUrl(location.href) || ""),
      title: item.title || item.name || detail.name || document.title || "",
      sourceUrl: location.href,
      sourceHost: location.hostname,
      imageUrl: images[0] || "",
      images,
      categoryName: item.category3 || item.category || item.category1 || detail.category || "",
      brand: item.brand || detail.brand || "",
      price: item.avgPrice || item.price || item.minSellerPrice || "",
      currency: item.currency || "RUB",
      weightG: specs.weightGrams || specs.productWeightGrams || item.weightGrams || "",
      lengthMm: specs.lengthMm || "",
      widthMm: specs.widthMm || "",
      heightMm: specs.heightMm || "",
      savedAt: new Date().toISOString(),
    };
  }

  async function open1688ImageSearchFromOzon(panel) {
    const button = panel && panel.querySelector("[data-role='search-1688']");
    const originalText = button ? button.textContent : "";
    try {
      const ozonSourceContext = buildOzon1688SearchContext(panel && panel._ozonData);
      if (!ozonSourceContext.imageUrl) {
        throw new Error("当前 Ozon 商品没有可用主图，无法以图搜索 1688");
      }
      if (button) {
        button.disabled = true;
        button.textContent = "打开中";
      }
      const response = await sendRuntimeMessage({
        type: "ss-erp:open-1688-image-search",
        ozonSourceContext,
      });
      if (!response || !response.ok) {
        throw new Error((response && (response.msg || response.error)) || "打开 1688 搜索失败");
      }
      if (button) {
        button.textContent = "已打开";
      }
    } catch (error) {
      const status = panel && panel.querySelector("[data-role='status']");
      if (status) {
        status.textContent = error && error.message ? error.message : String(error);
      }
      if (button) {
        button.textContent = "失败";
      }
    } finally {
      if (button) {
        setTimeout(() => {
          button.disabled = false;
          button.textContent = originalText || "搜1688";
        }, 1600);
      }
    }
  }

  function fillOzonPanel(panel, data) {
    panel._ozonData = data;

    const item = data.item || {};
    const specs = data.specs || {};
    window.__OZON_INSIGHTS_SPECS__ = specs;

    const status = panel.querySelector("[data-role='status']");
    const grid = panel.querySelector("[data-role='grid']");
    if (!status || !grid) {
      return;
    }

    status.innerHTML = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#16a34a;margin-right:6px;"></span>数据来源: seller.ozon.ru 卖家分析接口';

    const weightDisplay = buildWeightDisplay(specs);

    const rows = [
      ["30天销量", formatNumber(item.soldCount)],
      ["30天销售额", formatRub(item.soldSum)],
      ["销售变化", formatPercent(item.salesDynamics)],
      ["平均售价", formatRub(item.avgPrice)],
      ["最低售价", formatRub(item.minSellerPrice)],
      ["加购率", formatPercent(item.convToCartPdp)],
      ["曝光量", formatNumber(item.views)],
      ["库存", formatNumber(item.stock)],
      ["品牌", item.brand || "-"],
      ["一级类目", item.category1 || "-"],
      ["三级类目", item.category3 || "-"],
      ["卖家", item.sellerName || "-"],
      ["发货模式", item.salesSchema || "-"],
      ["配送天数", formatNumber(item.avgDeliveryDays)],
      ["产品净重", weightDisplay.productWeight],
      ["包装重量", weightDisplay.packageWeight],
      ["计算用重量", weightDisplay.calcWeight],
      ["尺寸", formatDimensions(specs)],
      ["上架时间", formatDate(item.nullableCreateDate)],
      ["variantId", item.variantId != null ? String(item.variantId) : "-"]
    ];

    grid.innerHTML = rows
      .map(
        ([label, value]) => `
          <div style="padding:8px;border-radius:8px;background:#fff8f3;transition:background 0.15s;">
            <div style="font-size:10px;color:#98a6ba;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.04em;">${escapeHtml(label)}</div>
            <div style="font-size:12px;font-weight:600;word-break:break-word;color:#1a2332;">${escapeHtml(value)}</div>
          </div>
        `
      )
      .join("");
  }

  function buildWeightDisplay(specs) {
    const productW = specs.productWeightGrams;
    const packageW = specs.weightGrams;
    const productWeight = productW != null ? `${formatNumber(productW)} g` : "-";
    const packageWeight = packageW != null ? `${formatNumber(packageW)} g` : "-";
    let calcWeight = "-";
    if (productW != null || packageW != null) {
      const maxW = Math.max(productW || 0, packageW || 0);
      calcWeight = `${formatNumber(maxW)} g (取大值)`;
    }
    return { productWeight, packageWeight, calcWeight };
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat("zh-CN").format(number) : "-";
  }

  function formatRub(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${new Intl.NumberFormat("zh-CN").format(number)} RUB` : "-";
  }

  function formatPercent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${number}%` : "-";
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    return String(value).split("T")[0];
  }

  function formatDimensions(specs) {
    const length = specs && specs.lengthMm != null ? specs.lengthMm : null;
    const width = specs && specs.widthMm != null ? specs.widthMm : null;
    const height = specs && specs.heightMm != null ? specs.heightMm : null;
    if (length == null || width == null || height == null) {
      return "-";
    }
    return `${length}×${width}×${height} mm`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const PLATFORM_EXTRACTORS = {
    "1688": extract1688Product,
    temu: extractTemuProduct,
    aliexpress: extractAliExpressProduct,
    wb: extractWildberriesProduct,
    ozon: extractOzonProduct,
    jd: extractJdProduct,
    taobao: extractTaobaoProduct,
    tmall: extractTmallProduct,
    amazon: extractAmazonProduct
  };

  function detectPlatform(hostname) {
    const host = (hostname || "").toLowerCase();
    if (host.includes("1688.com")) return "1688";
    if (host.includes("temu.com")) return "temu";
    if (host.includes("aliexpress.com")) return "aliexpress";
    if (host.includes("wildberries.ru")) return "wb";
    if (host.includes("ozon.ru")) return "ozon";
    if (host.includes("jd.com")) return "jd";
    if (host.includes("taobao.com")) return "taobao";
    if (host.includes("tmall.com")) return "tmall";
    if (host.includes("amazon.")) return "amazon";
    return "generic";
  }

  function collectDataSources(pageState) {
    const sources = [];
    if (pageState && pageState.knownGlobals) {
      Object.values(pageState.knownGlobals).forEach((value) => {
        if (value && typeof value === "object") {
          sources.push(value);
        }
      });
    }
    if (pageState && pageState.aliExpressData) {
      sources.push(pageState.aliExpressData);
    }
    return sources;
  }

  function parseJsonLd() {
    const results = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
      const text = (node.textContent || "").trim();
      if (!text) {
        return;
      }

      try {
        const parsed = JSON.parse(text);
        if (parsed) {
          results.push(parsed);
        }
      } catch (_error) {
        // ignore invalid blocks
      }
    });
    return results;
  }

  function extract1688Product(context) {
    const base = buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /近30天成交[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /毛重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".title-text", ".d-title"],
      shopSelectors: [".company-name", ".shop-name", ".mod-detail-company-name"],
      productIdRegexes: [/offer\/(\d+)\.html/i, /offerId[=:/"]+(\d+)/i]
    });
    return Object.assign(base, extract1688RichDetails(context));
  }

  function extract1688RichDetails(context) {
    const found = find1688OfferDetail(context);
    const offerDetail = found.offerDetail;
    const globalData = found.globalData;
    const category = pick1688CategoryPath(offerDetail, globalData, context && context.jsonLd);
    const price = pick1688PriceTiers(offerDetail, context && context.pageText);
    const detailImages = pick1688DetailImages(context);
    const attributes = pickAttributes(context.sources);
    const dimensions = pick1688Dimensions(context, attributes);
    return {
      sourceCategoryId: category.sourceCategoryId || "",
      sourceCategoryName: category.sourceCategoryName || "",
      sourceCategoryPath: category.sourceCategoryPath || "",
      priceTiers: price.priceTiers,
      purchasePriceCny: price.standardPriceCny || 0,
      newUserPriceCny: price.newUserPriceCny || 0,
      detailImages,
      lengthMm: dimensions.lengthMm || 0,
      widthMm: dimensions.widthMm || 0,
      heightMm: dimensions.heightMm || 0,
    };
  }

  function find1688OfferDetail(context) {
    const sources = context && Array.isArray(context.sources) ? context.sources : [];
    const queue = sources.map((source) => ({ globalData: source, node: source, depth: 0 }));
    const seen = new Set();
    let scanned = 0;
    while (queue.length && scanned < 500) {
      const current = queue.shift();
      const node = current && current.node;
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      scanned += 1;

      if (node.offerDetail && typeof node.offerDetail === "object") {
        return { globalData: current.globalData, offerDetail: node.offerDetail };
      }
      if (node.subject && (node.priceModel || node.skuModel || node.productAttribute)) {
        return { globalData: current.globalData, offerDetail: node };
      }
      if (node.data && node.data.offerDetail && typeof node.data.offerDetail === "object") {
        return { globalData: current.globalData, offerDetail: node.data.offerDetail };
      }

      if (current.depth >= 4) continue;
      Object.keys(node).slice(0, 80).forEach((key) => {
        const value = node[key];
        if (value && typeof value === "object") {
          queue.push({ globalData: current.globalData, node: value, depth: current.depth + 1 });
        }
      });
    }
    return { globalData: sources[0] || null, offerDetail: null };
  }

  function pick1688PriceTiers(offerDetail, pageText) {
    const priceTiers = [];
    let standardPriceCny = 0;
    let newUserPriceCny = 0;

    function addTier(raw) {
      if (!raw || typeof raw !== "object") return;
      const minQuantity = Math.max(1, parseLooseNumber(raw.beginAmount || raw.minQuantity || raw.minQty || raw.startQuantity || raw.quantity || raw.amount || raw.count || 1) || 1);
      const price = numberFromText(raw.price || raw.value || raw.salePrice || raw.discountPrice || raw.promotionPrice, 0);
      if (price > 0) priceTiers.push({ minQuantity, price });
    }

    const priceModel = offerDetail && offerDetail.priceModel;
    if (priceModel && typeof priceModel === "object") {
      (priceModel.originalPrices || []).forEach(addTier);
      if (priceTiers.length) standardPriceCny = priceTiers[0].price;
      if (!priceTiers.length) (priceModel.currentPrices || []).forEach(addTier);
      if (!standardPriceCny && priceTiers.length) standardPriceCny = priceTiers[0].price;
      if (Array.isArray(priceModel.newUserPrices) && priceModel.newUserPrices.length) {
        newUserPriceCny = numberFromText(priceModel.newUserPrices[0].price, 0);
      }
      const activityPrice = numberFromText(priceModel.activityPrice, 0);
      if (activityPrice > 0 && (!newUserPriceCny || activityPrice < newUserPriceCny)) newUserPriceCny = activityPrice;
    }

    if (!priceTiers.length) {
      const text = String(pageText || "").replace(/[¥￥]\s*\n\s*(\d+)\s*\n\s*\.(\d+)/g, "¥$1.$2");
      const tierPattern = /([≥>=]?\s*\d+)\s*件[^\n¥￥]{0,30}[\n\s]*[¥￥]\s*(\d+(?:\.\d{1,2})?)/g;
      let match;
      while ((match = tierPattern.exec(text)) !== null) {
        const minQuantity = Math.max(1, parseLooseNumber(match[1]) || 1);
        const price = numberFromText(match[2], 0);
        if (price > 0) priceTiers.push({ minQuantity, price });
      }
      const newUserMatch = text.slice(Math.max(0, text.indexOf("新人价")), text.indexOf("新人价") >= 0 ? text.indexOf("新人价") + 80 : 0).match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
      if (newUserMatch) newUserPriceCny = numberFromText(newUserMatch[1], 0);
    }

    const unique = [];
    const seen = new Set();
    priceTiers
      .filter((tier) => tier.price > 0)
      .sort((a, b) => a.minQuantity - b.minQuantity)
      .forEach((tier) => {
        const key = tier.minQuantity + ":" + tier.price;
        if (seen.has(key)) return;
        seen.add(key);
        unique.push(tier);
      });
    if (!standardPriceCny && unique.length) standardPriceCny = unique[0].price;
    return { priceTiers: unique.slice(0, 50), standardPriceCny, newUserPriceCny };
  }

  function pick1688CategoryPath(offerDetail, globalData, jsonLd) {
    let sourceCategoryId = "";
    let sourceCategoryPath = "";
    if (offerDetail && typeof offerDetail === "object") {
      sourceCategoryId = offerDetail.categoryId ? String(offerDetail.categoryId) : "";
      sourceCategoryPath = toCategoryPathText(offerDetail.categoryPath || offerDetail.categoryNamePath || offerDetail.categoryName);
    }
    if (!sourceCategoryId && globalData && typeof globalData === "object") {
      sourceCategoryId = String(globalData.industryId || globalData.categoryId || globalData.cat || "");
    }
    if (!sourceCategoryPath && globalData && typeof globalData === "object") {
      const categoryInfo = globalData.categoryInfo || globalData.category || (globalData.data && globalData.data.categoryInfo);
      if (categoryInfo) {
        sourceCategoryPath = toCategoryPathText(categoryInfo.categoryPath || categoryInfo.categoryName);
        if (!sourceCategoryId && categoryInfo.categoryId) sourceCategoryId = String(categoryInfo.categoryId);
      }
    }
    if (!sourceCategoryPath) {
      sourceCategoryPath = Array.from(document.querySelectorAll("[class*=crumb] a, [class*=breadcrumb] a, [class*=Breadcrumb] a, [class*=category-path] a, [class*=CategoryPath] a, nav a"))
        .map((node) => normalizeWhitespace(node.textContent || ""))
        .filter((text) => text && text.length < 30 && !/首页|home|1688/i.test(text))
        .slice(0, 8)
        .join(" > ");
    }
    if (!sourceCategoryPath && Array.isArray(jsonLd)) {
      const withCategory = jsonLd.find((item) => item && item.category);
      if (withCategory) sourceCategoryPath = String(withCategory.category);
    }
    const parts = sourceCategoryPath.split(/\s*>\s*/).filter(Boolean);
    return {
      sourceCategoryId,
      sourceCategoryPath,
      sourceCategoryName: parts.length ? parts[parts.length - 1] : sourceCategoryPath,
    };
  }

  function toCategoryPathText(value) {
    if (!value) return "";
    if (Array.isArray(value)) {
      return value.map((item) => item && (item.categoryName || item.name || item.title || item.text) || "").filter(Boolean).join(" > ");
    }
    return String(value);
  }

  function pick1688Dimensions(context, attributes) {
    const candidates = [];
    (Array.isArray(attributes) ? attributes : []).forEach((attr) => {
      if (attr && /(尺寸|规格|大小|长宽高|dimension|size)/i.test(String(attr.name || ""))) {
        candidates.push(String(attr.value || ""));
      }
    });
    candidates.push(String(context && context.pageText || ""));
    for (const candidate of candidates) {
      const parsed = parse1688Dimensions(candidate);
      if (parsed) return parsed;
    }
    return { lengthMm: 0, widthMm: 0, heightMm: 0 };
  }

  function parse1688Dimensions(text) {
    const match = String(text || "").match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|m|米)?/i);
    if (!match) return null;
    const unit = String(match[4] || "mm").toLowerCase();
    let factor = 1;
    if (unit === "cm" || unit === "厘米") factor = 10;
    if (unit === "m" || unit === "米") factor = 1000;
    return {
      lengthMm: Math.round(Number(match[1]) * factor),
      widthMm: Math.round(Number(match[2]) * factor),
      heightMm: Math.round(Number(match[3]) * factor),
    };
  }

  function pick1688DetailImages(context) {
    const imageSet = new Set();
    document.querySelectorAll("[class*=detail-content] img, [class*=desc] img, [class*=description] img, [class*=offer-detail] img, .d-content img").forEach((img) => {
      const src = normalizeImageUrl(img.getAttribute("data-src") || img.getAttribute("data-lazyload-src") || img.currentSrc || img.src);
      if (src) imageSet.add(src);
    });
    collectStringCandidates(context && context.sources || [], /(detail|desc|description|content|image|img|photo|picture)/i)
      .slice(0, 200)
      .forEach((item) => {
        const src = normalizeImageUrl(item.value);
        if (src) imageSet.add(src);
      });
    return Array.from(imageSet).slice(0, 100);
  }

  function normalizeImageUrl(value) {
    const text = String(value || "").trim();
    if (/^\/\//.test(text)) return location.protocol + text;
    if (/^https?:\/\//i.test(text)) return text;
    return "";
  }

  function extractTemuProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i, /sold[:：]?\s*([0-9.,kKmM+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", "[data-testid='pdp-product-name']", ".product-title"],
      shopSelectors: [".seller-name", "[data-testid='seller-name']"],
      productIdRegexes: [/-g-(\d+)\.html/i, /goods_id[=:/"]+(\d+)/i]
    });
  }

  function extractAliExpressProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/sold[:：]?\s*([0-9.,kKmM+]+)/i, /月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /shipping weight[:：]?\s*([0-9.,]+)\s*(g|kg)/i],
      titleSelectors: ["h1", ".product-title-text", "[data-pl='product-title']"],
      shopSelectors: [".store-name", ".shop-name", "[data-pl='shop-name']"],
      productIdRegexes: [/item\/(\d+)\.html/i, /productId[=:/"]+(\d+)/i]
    });
  }

  function extractWildberriesProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/продано\s*за\s*месяц[:：]?\s*([0-9\s]+)/i, /月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/вес[:：]?\s*([0-9.,]+)\s*(g|kg)/i, /重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".product-page__title", "[class*='productPage__title']"],
      shopSelectors: [".product-page__seller-wrap", ".seller-info__name"],
      productIdRegexes: [/catalog\/(\d+)\/detail.aspx/i, /nm[_-]?id[=:/"]+(\d+)/i]
    });
  }

  function extractOzonProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/за\s*месяц[:：]?\s*([0-9\s]+)/i, /月销量[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/вес[:：]?\s*([0-9.,]+)\s*(g|kg)/i, /重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", "[data-widget='webProductHeading'] h1", ".x8o_30"],
      shopSelectors: ["[data-widget='webSellerName'] a", ".l8o_30"],
      productIdRegexes: [/-([0-9]{6,})\/?$/i, /product[_-]?id[=:/"]+(\d+)/i]
    });
  }

  function extractJdProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/累计评价[:：]?\s*([0-9.,万wW+]+)/i, /月销量[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/商品毛重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".sku-name"],
      shopSelectors: [".popbox-inner .name", "#crumb-wrap a"],
      productIdRegexes: [/\/(\d+)\.html/i]
    });
  }

  function extractTaobaoProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".ItemHeader--mainTitle", ".tb-main-title"],
      shopSelectors: [".shopName", ".ShopHeader--title"],
      productIdRegexes: [/id=(\d+)/i]
    });
  }

  function extractTmallProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".ItemHeader--mainTitle", ".tb-detail-hd h1"],
      shopSelectors: [".shopName", ".slogo-shopname"],
      productIdRegexes: [/id=(\d+)/i]
    });
  }

  function extractAmazonProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [
        /Best Sellers Rank[:#]?\s*#?([0-9,]+)/i,
        /月销量[:：]?\s*([0-9.,万wW+]+)/i,
        /sold.*?month[:：]?\s*([0-9.,kKmM+]+)/i
      ],
      weightKeywords: [
        /Item Weight[:：]\s*([0-9.,]+)\s*(pounds|ounces|oz|lbs?|g|kg)/i,
        /Product Dimensions.*?weight[:：]?\s*([0-9.,]+)\s*(pounds|ounces|oz|lbs?|g|kg)/i,
        /Shipping Weight[:：]\s*([0-9.,]+)\s*(pounds|ounces|oz|lbs?|g|kg)/i,
        /重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i
      ],
      titleSelectors: ["#productTitle", "#title", "h1[data-automation-id='title']"],
      shopSelectors: ["#bylineInfo", ".a-link-normal[href*='seller']", "#sellerProfileTriggerId"],
      productIdRegexes: [
        /\/dp\/([A-Z0-9]{10})(?:\/|\?|$)/i,
        /\/product\/([A-Z0-9]{10})(?:\/|\?|$)/i,
        /\/gp\/product\/([A-Z0-9]{10})(?:\/|\?|$)/i,
        /asin[=:/"]+([A-Z0-9]{10})/i
      ]
    });
  }

  function extractGenericProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i, /sold[:：]?\s*([0-9.,kKmM+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", "title"],
      shopSelectors: [],
      productIdRegexes: []
    });
  }

  function buildProductResult(context, config) {
    const title = pickTitle(config.titleSelectors, context.sources);
    const shopName = pickFirstDomText(config.shopSelectors) || pickStringByKey(context.sources, /(shopName|sellerName|companyName|storeName|supplierName)$/i);
    const productId = pickProductId(config.productIdRegexes, context.sources);
    const monthlySales = pickMonthlySales(context.pageText, context.sources, config.monthlySalesKeywords);
    const skuItems = pickSkuItems(context.sources);
    const skuCount = skuItems.length || pickSkuCountFromDom();
    const grossWeightGrams = pickGrossWeight(context.pageText, context.sources, config.weightKeywords, skuItems);
    const images = pickImages(context.sources);
    const attributes = pickAttributes(context.sources);

    return {
      platform: context.platform,
      extractor: `self-hosted-${context.platform}`,
      title,
      shopName,
      productId,
      monthlySales,
      grossWeightGrams,
      skuCount,
      skuItems,
      images,
      attributes,
      debug: {
        pageState: context.pageState,
        productIdEvidence: productId ? "url/dom/json" : "",
        monthlySalesCandidates: collectNumberCandidates(context.sources, /(month|sale|sold|trade|销量|成交|已售)/i).slice(0, 20),
        weightCandidates: collectNumberCandidates(context.sources, /(weight|gross|gram|克|斤|重量|毛重|净重)/i).slice(0, 20),
        rawSources: summarizeSources(context.sources)
      }
    };
  }

  function pickTitle(selectors, sources) {
    const domTitle = pickFirstDomText(selectors);
    if (domTitle) {
      return domTitle;
    }

    return (
      pickStringByKey(sources, /(title|name|subject|productName|offerTitle)$/i) ||
      (document.title || "").trim()
    );
  }

  function pickProductId(regexes, sources) {
    const url = location.href;
    for (const regex of regexes || []) {
      const match = url.match(regex);
      if (match && match[1]) {
        return match[1];
      }
    }

    return (
      pickStringByKey(sources, /^(productId|offerId|itemId|goodsId|skuId|nmId|nmID|id)$/i) ||
      null
    );
  }

  function pickMonthlySales(pageText, sources, patterns) {
    for (const pattern of patterns || []) {
      const match = pageText.match(pattern);
      if (match && match[1]) {
        const value = parseLooseNumber(match[1]);
        if (value != null) {
          return value;
        }
      }
    }

    const candidates = collectNumberCandidates(sources, /(month|monthly|sale|sold|trade|销量|成交|已售|30d|30day)/i);
    const direct = candidates.find((item) => item.value != null && item.value >= 0);
    return direct ? direct.value : null;
  }

  function pickGrossWeight(pageText, sources, patterns, skuItems) {
    for (const pattern of patterns || []) {
      const match = pageText.match(pattern);
      if (match && match[1]) {
        const value = convertWeightToGrams(match[1], match[2] || "");
        if (value != null) {
          return value;
        }
      }
    }

    const skuWeight = skuItems
      .map((item) => item.grossWeightGrams)
      .filter((value) => typeof value === "number" && Number.isFinite(value))
      .sort((a, b) => a - b)[0];

    if (skuWeight != null) {
      return skuWeight;
    }

    const candidates = collectNumberCandidates(sources, /(weight|gross|gram|克|斤|重量|毛重|净重)/i);
    const weightHit = candidates.find((item) => item.weightGrams != null);
    return weightHit ? weightHit.weightGrams : null;
  }

  function pickSkuItems(sources) {
    const skuArrays = [];

    sources.forEach((source) => {
      walkObject(source, [], (value, path) => {
        if (!Array.isArray(value) || !value.length || typeof value[0] !== "object") {
          return;
        }

        const pathText = path.join(".");
        const score =
          (/(sku|skus|variant|variants|offer|offers|model|models|size|sizes)/i.test(pathText) ? 3 : 0) +
          (hasAnyKey(value[0], /(sku|price|stock|name|spec|weight)/i) ? 2 : 0);

        if (score >= 2) {
          skuArrays.push({ score, value });
        }
      });
    });

    skuArrays.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
    const best = skuArrays[0];
    if (!best) {
      return [];
    }

    const normalized = best.value
      .map((item) => normalizeSkuItem(item))
      .filter((item) => item.skuId || item.name || item.specText || item.price != null);

    const unique = [];
    const seen = new Set();
    normalized.forEach((item) => {
      const key = item.skuId || item.name || item.specText || JSON.stringify(item);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      unique.push(item);
    });

    return unique.slice(0, 200);
  }

  function normalizeSkuItem(item) {
    const skuId = pickFirstValue(item, ["skuId", "sku_id", "id", "offerId", "specId", "nameId"]);
    const name = pickFirstValue(item, ["name", "title", "skuName", "sku_name", "displayName"]);
    const specText = [
      pickFirstValue(item, ["spec", "specText", "specValue", "skuSpec", "attributeValue"]),
      Array.isArray(item.attributes) ? item.attributes.join(" / ") : ""
    ]
      .filter(Boolean)
      .join(" / ");
    const price = parseLooseNumber(pickFirstValue(item, ["price", "salePrice", "finalPrice", "discountPrice", "promotionPrice"]));
    const stock = parseLooseNumber(pickFirstValue(item, ["stock", "stockNum", "canBookCount", "quantity", "qty", "amountOnSale"]));
    const imageUrl = pickSkuImageUrl(item);
    const logisticsFeeCny = parseLooseNumber(pickFirstValue(item, ["logisticsFeeCny", "internationalLogisticsFeeCny", "shippingCostCny"]));
    const weightRaw = pickFirstValue(item, ["grossWeight", "weight", "weightGram", "skuWeight", "freightWeight"]);
    const grossWeightGrams = convertWeightToGrams(weightRaw, guessWeightUnit(weightRaw));
    const attributes = normalize1688SkuAttributes(item.attributes || item.props || item.skuAttributes || item.specAttrs);

    return {
      skuId: skuId == null ? "" : String(skuId),
      name: name == null ? "" : String(name),
      specText,
      price,
      stock,
      imageUrl,
      logisticsFeeCny,
      grossWeightGrams,
      attributes
    };
  }

  function pickSkuCountFromDom() {
    const nodes = document.querySelectorAll(
      "[data-sku-id], [data-sku], [class*='sku'] button, [class*='sku'] li, [class*='Sku'] button, [class*='Sku'] li"
    );

    const values = new Set();
    nodes.forEach((node) => {
      const text = normalizeWhitespace(node.textContent || "");
      if (text && text.length <= 80) {
        values.add(text);
      }
    });

    return values.size || 0;
  }

  function pickImages(sources) {
    const imageSet = new Set();

    document.querySelectorAll("img").forEach((img) => {
      const src = img.currentSrc || img.src || "";
      if (/^https?:\/\//i.test(src) && src.length < 1000) {
        imageSet.add(src);
      }
    });

    collectStringCandidates(sources, /(image|img|photo|picture)/i)
      .slice(0, 100)
      .forEach((item) => {
        const value = item.value;
        if (/^https?:\/\//i.test(value)) {
          imageSet.add(value);
        }
      });

    return Array.from(imageSet).slice(0, 20);
  }

  function pickAttributes(sources) {
    const attrs = [];
    const pairs = collectObjectCandidates(sources, /(attribute|spec|property|props|参数|属性)/i).slice(0, 20);

    pairs.forEach((item) => {
      if (Array.isArray(item.value)) {
        item.value.forEach((row) => {
          if (row && typeof row === "object") {
            const name = pickFirstValue(row, ["name", "key", "attrName", "title"]);
            const value = pickFirstValue(row, ["value", "attrValue", "text", "content"]);
            if (name && value) {
              attrs.push({ name: String(name), value: String(value) });
            }
          }
        });
      }
    });

    return attrs.slice(0, 50);
  }

  function pickFirstDomText(selectors) {
    for (const selector of selectors || []) {
      const node = document.querySelector(selector);
      if (!node) {
        continue;
      }
      const text = normalizeWhitespace(node.textContent || "");
      if (text) {
        return text;
      }
    }
    return "";
  }

  function pickStringByKey(sources, regex) {
    const candidates = collectStringCandidates(sources, regex);
    return candidates.length ? candidates[0].value : "";
  }

  function collectStringCandidates(sources, regex) {
    const results = [];
    sources.forEach((source) => {
      walkObject(source, [], (value, path) => {
        const lastKey = path[path.length - 1] || "";
        if (typeof value === "string" && regex.test(String(lastKey))) {
          const text = normalizeWhitespace(value);
          if (text && text.length <= 300) {
            results.push({ path: path.join("."), value: text });
          }
        }
      });
    });
    return results;
  }

  function collectObjectCandidates(sources, regex) {
    const results = [];
    sources.forEach((source) => {
      walkObject(source, [], (value, path) => {
        const lastKey = path[path.length - 1] || "";
        if (value && typeof value === "object" && regex.test(String(lastKey))) {
          results.push({ path: path.join("."), value });
        }
      });
    });
    return results;
  }

  function collectNumberCandidates(sources, regex) {
    const results = [];
    sources.forEach((source) => {
      walkObject(source, [], (value, path) => {
        const lastKey = path[path.length - 1] || "";
        if (!regex.test(String(lastKey))) {
          return;
        }

        if (typeof value === "number" && Number.isFinite(value)) {
          results.push({
            path: path.join("."),
            value,
            weightGrams: convertWeightToGrams(value, guessWeightUnit(lastKey))
          });
          return;
        }

        if (typeof value === "string") {
          const parsed = parseLooseNumber(value);
          if (parsed != null) {
            results.push({
              path: path.join("."),
              value: parsed,
              weightGrams: convertWeightToGrams(value, guessWeightUnit(value))
            });
          }
        }
      });
    });
    return results;
  }

  function summarizeSources(sources) {
    return sources.map((source, index) => ({
      index,
      keys: Object.keys(source || {}).slice(0, 20)
    }));
  }

  function walkObject(value, path, visitor, depth = 0) {
    if (depth > 12 || value == null) {
      return;
    }

    visitor(value, path);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walkObject(item, path.concat(String(index)), visitor, depth + 1);
      });
      return;
    }

    if (typeof value === "object") {
      Object.keys(value).forEach((key) => {
        walkObject(value[key], path.concat(key), visitor, depth + 1);
      });
    }
  }

  function hasAnyKey(obj, regex) {
    return Object.keys(obj || {}).some((key) => regex.test(key));
  }

  function pickFirstValue(obj, keys) {
    for (const key of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== "") {
        return obj[key];
      }
    }
    return null;
  }

  function parseLooseNumber(input) {
    if (input == null || input === "") {
      return null;
    }

    if (typeof input === "number" && Number.isFinite(input)) {
      return input;
    }

    const text = String(input).replace(/,/g, "").replace(/\s+/g, "").trim().toLowerCase();
    if (!text) {
      return null;
    }

    const match = text.match(/([0-9]+(?:\.[0-9]+)?)(万|w|k|m)?/i);
    if (!match) {
      return null;
    }

    let value = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(value)) {
      return null;
    }

    if (unit === "万") value *= 10000;
    if (unit === "w") value *= 10000;
    if (unit === "k") value *= 1000;
    if (unit === "m") value *= 1000000;
    return Math.round(value);
  }

  function convertWeightToGrams(value, unitHint) {
    if (value == null || value === "") {
      return null;
    }

    const unit = String(unitHint || guessWeightUnit(value) || "").toLowerCase();
    const parsed =
      typeof value === "number" && Number.isFinite(value)
        ? value
        : Number(String(value).replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/)?.[1]);

    if (!Number.isFinite(parsed)) {
      return null;
    }

    if (unit.includes("kg") || unit.includes("千克")) {
      return Math.round(parsed * 1000);
    }
    if (unit.includes("斤")) {
      return Math.round(parsed * 500);
    }
    if (unit.includes("lb") || unit.includes("pound") || unit.includes("磅")) {
      return Math.round(parsed * 453.592);
    }
    if (unit.includes("oz") || unit.includes("ounce")) {
      return Math.round(parsed * 28.3495);
    }
    return Math.round(parsed);
  }

  function guessWeightUnit(input) {
    const text = String(input || "").toLowerCase();
    if (text.includes("kg") || text.includes("千克")) return "kg";
    if (text.includes("斤")) return "斤";
    if (text.includes("lb") || text.includes("pound") || text.includes("磅")) return "lb";
    if (text.includes("oz") || text.includes("ounce")) return "oz";
    if (text.includes("g") || text.includes("克")) return "g";
    return "g";
  }

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }
})();
