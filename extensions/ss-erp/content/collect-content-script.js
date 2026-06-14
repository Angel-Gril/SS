(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
  const BRIDGE_ID = "spb-self-hosted-page-bridge";
  const PAGE_STATE_TIMEOUT_MS = 8000;
  const OZON_PANEL_ID = "spb-self-hosted-ozon-panel";
  let lastOzonUrl = "";

  injectPageBridge();
  initOzonOverlay();

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

  function getPriceCurrencyApi() {
    return globalThis.SS_ERP_PRICE_CURRENCY || {};
  }

  function parsePriceWithCurrencySafe(text, fallback) {
    const priceCurrency = getPriceCurrencyApi();
    if (typeof priceCurrency.parsePriceWithCurrency === "function") {
      return priceCurrency.parsePriceWithCurrency(text, fallback);
    }
    return {
      price: text ? String(text).replace(/[^\d.,]/g, "").replace(",", ".") : null,
      currency: fallback || null,
    };
  }

  function detectCurrencyFromTextSafe(text, fallback) {
    const priceCurrency = getPriceCurrencyApi();
    if (typeof priceCurrency.detectCurrencyFromText === "function") {
      return priceCurrency.detectCurrencyFromText(text, fallback);
    }
    const raw = text == null ? "" : String(text);
    if (raw.indexOf("¥") >= 0 || raw.indexOf("￥") >= 0 || /\b(?:CNY|RMB)\b/i.test(raw)) return "CNY";
    if (raw.indexOf("₽") >= 0 || /\bRUB\b/i.test(raw)) return "RUB";
    if (raw.indexOf("₸") >= 0 || /\bKZT\b/i.test(raw)) return "KZT";
    if (/\bBYN\b/i.test(raw)) return "BYN";
    return fallback || null;
  }

  function fallbackCurrencyByHostSafe(host) {
    const priceCurrency = getPriceCurrencyApi();
    if (typeof priceCurrency.fallbackCurrencyByHost === "function") {
      return priceCurrency.fallbackCurrencyByHost(host);
    }
    const value = String(host || "").toLowerCase();
    if (value.includes("ozon.kz")) return "KZT";
    if (value.includes("ozon.by")) return "BYN";
    return "RUB";
  }

  function normalizeOzonCollectedImageUrl(raw) {
    let text = String(raw || "").trim();
    if (!text) return "";
    if (text.startsWith("//")) text = "https:" + text;
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      if (host.endsWith(".ozone.ru") || host.endsWith(".ozon.ru") || host.endsWith(".ozonstatic.cn")) {
        url.pathname = url.pathname.replace(/\/(?:wc|w|h|c)\d+(?:x\d+)?(?=\/)/i, "");
      }
      return url.href;
    } catch (e) {
      return text;
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
            if (typeof u === "string" && u.startsWith("http")) images.push(normalizeOzonCollectedImageUrl(u));
          }
        }
      }
      if (!price && /^(webPrice|webSale|price)/.test(k) && st) {
        const rp = st.cardPrice || st.price || st.finalPrice || st.tradePrice;
        const ro = st.originalPrice || st.priceWithoutDiscount || st.oldPrice;
        if (typeof rp === "string") {
          priceString = rp;
          const parsed = parsePriceWithCurrencySafe(rp, currency || st.currency);
          price = parsed.price;
          currency = parsed.currency || currency;
        }
        if (typeof ro === "string") {
          const parsedOld = parsePriceWithCurrencySafe(ro, currency || st.currency);
          oldPrice = parsedOld.price;
          currency = currency || parsedOld.currency;
        }
        currency = detectCurrencyFromTextSafe(st.disclaimerPriceHeader, currency || st.currency);
        if (Array.isArray(st.disclaimerPriceBodyRs)) {
          for (const row of st.disclaimerPriceBodyRs) {
            currency = detectCurrencyFromTextSafe(row && row.content, currency);
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

    currency = detectCurrencyFromTextSafe(priceString, currency);

    if (!currency) {
      currency = fallbackCurrencyByHostSafe(location.hostname);
    }

    for (const a of attributes) {
      if (!brand && /бренд|brand|Бренд/i.test(a.name)) brand = a.value;
    }

    // 占位：抽取 model_id + variants[]（结构未知，先 dump 全量 widgetStates 到 console 供二次完善）
    const variantsResult = extractOzonVariants(widgets, productId, currency);
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
      pagePriceValue: price ? Number(price) : (oldPrice ? Number(oldPrice) : 0),
      pagePriceCurrency: currency,
      currentPriceValue: price ? Number(price) : 0,
      oldPriceValue: oldPrice ? Number(oldPrice) : 0,
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
  function extractOzonVariants(widgets, currentProductId, currency) {
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
              const normalizedCover = cover ? normalizeOzonCollectedImageUrl(cover) : "";
              const priceText = v.data && v.data.price ? v.data.price : null;
              const parsedPrice = parsePriceWithCurrencySafe(priceText, currency);
              return {
                sku: String(v.sku),
                attrs: aspectName ? { [aspectName]: text || String(v.sku) } : (text ? { variant: text } : {}),
                price: parsedPrice.price || (typeof v.price === "number" ? v.price : null),
                priceCurrency: parsedPrice.currency || currency || null,
                priceText: priceText,
                ozonInternalPrice: typeof v.price === "number" ? v.price : null,
                images: normalizedCover ? [normalizedCover] : [],
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
    const path = String(url || "").split(/[?#]/)[0];
    const match = path.match(/(?:-|\/)([0-9]{6,})\/?$/i);
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

  function fillOzonPanel(panel, data) {
    panel._ozonData = data;

    const item = data.item || {};
    const specs = data.specs || {};
    window.__OZON_INSIGHTS_SPECS__ = specs;
    try {
      window.dispatchEvent(new CustomEvent("ss-erp:ozon-insights-specs", { detail: specs }));
    } catch (error) {}

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
    pdd: extractPddPageProduct,
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
    if (host.includes("pinduoduo.com") || host.includes("yangkeduo.com")) return "pdd";
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
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /近30天成交[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /毛重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".title-text", ".d-title"],
      priceSelectors: [".price", ".price-text", ".offer-price", "[class*='Price']", "[class*='price']"],
      shopSelectors: [".company-name", ".shop-name", ".mod-detail-company-name"],
      productIdRegexes: [/offer\/(\d+)\.html/i, /offerId[=:/"]+(\d+)/i]
    });
  }

  function extractPddPageProduct(context) {
    const collector = globalThis.SS_ERP_PDD_PRODUCT_COLLECTOR;
    if (collector && typeof collector.extractPddProduct === "function") {
      return collector.extractPddProduct({
        ...context,
        url: location.href,
        host: location.hostname,
        documentTitle: document.title || ""
      });
    }

    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /毛重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", "[class*=goods-name]", "[class*=goodsName]", ".goods-title"],
      shopSelectors: ["[class*=store-name]", "[class*=shop-name]", ".mall-name"],
      productIdRegexes: [/goods_id=(\d+)/i, /goods\/(\d+)/i]
    });
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
      priceSelectors: [".Price--priceText", ".priceText", ".tb-rmb-num", "[class*='priceText']", "[class*='Price']", "[class*='price']"],
      shopSelectors: [".shopName", ".ShopHeader--title"],
      productIdRegexes: [/id=(\d+)/i]
    });
  }

  function extractTmallProduct(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".ItemHeader--mainTitle", ".tb-detail-hd h1"],
      priceSelectors: [".Price--priceText", ".tm-price", ".tb-rmb-num", "[class*='priceText']", "[class*='Price']", "[class*='price']"],
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
    const sourcePrice = pickSourcePrice(context, config);
    const sourceShipping = sourcePrice.sourceType === "selectedOrderSummary" && sourcePrice.shippingCny != null
      ? {
          value: sourcePrice.shippingCny,
          currency: "CNY",
          text: sourcePrice.shippingText || "",
          free: Boolean(sourcePrice.shippingFree || sourcePrice.shippingCny === 0),
          sourceType: "selectedOrderSummary"
        }
      : pickSourceShipping(context);
    const totalCostCny = sourcePrice.price != null
      ? roundMoney(Number(sourcePrice.price) + (Number(sourceShipping.value) || 0))
      : null;
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
      price: sourcePrice.price != null ? sourcePrice.price : "",
      priceText: sourcePrice.text || "",
      priceCny: sourcePrice.price != null ? Number(sourcePrice.price) : null,
      currency: sourcePrice.currency || "CNY",
      priceSourceType: sourcePrice.sourceType || "",
      selectedSku: sourcePrice.selectedSku || null,
      shippingCny: sourceShipping.value != null ? Number(sourceShipping.value) : null,
      shippingText: sourceShipping.text || "",
      shippingFree: Boolean(sourceShipping.free),
      shippingSourceType: sourceShipping.sourceType || "",
      totalCostCny,
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

  function pickSourcePrice(context, config) {
    const visibleRange = context && context.platform === "1688" ? (pickVisiblePriceRange(context.pageText) || pickVisibleSkuPriceRangeFromDom(context.pageText)) : null;
    const selectedOrderSummaryPrice = pickSelectedOrderSummaryPrice(context);
    if (selectedOrderSummaryPrice && isTrustedPriceValue(selectedOrderSummaryPrice.price, visibleRange)) return selectedOrderSummaryPrice;

    const selectedSkuPrice = pickSelectedSkuPriceFromDom(context && context.pageText);
    if (selectedSkuPrice && isTrustedPriceValue(selectedSkuPrice.price, visibleRange)) return selectedSkuPrice;

    const domText = pickFirstDomText(config.priceSelectors || []);
    const sourceText = pickPriceTextFromSources(context.sources);
    const trustedDomText = domText && isTrustedSourcePriceText(domText, visibleRange) ? domText : "";
    const trustedSourceText = sourceText && isTrustedSourcePriceText(sourceText, visibleRange) ? sourceText : "";
    const visibleRangeText = visibleRange ? visibleRange.text : "";
    const text = normalizePriceDisplay(trustedDomText || trustedSourceText || visibleRangeText || "");
    const parsed = parseSourcePriceText(text || sourceText, "CNY");
    if (parsed.price != null && parsed.price !== "" && isTrustedPriceValue(parsed.price, visibleRange)) {
      return {
        price: roundMoney(Number(parsed.price)),
        currency: parsed.currency || "CNY",
        text: text || sourceText || String(parsed.price),
        sourceType: !trustedDomText && !trustedSourceText && visibleRangeText ? "visibleRangeHigh" : (parsed.sourceType || "dom")
      };
    }

    const skuItems = pickSkuItems(context.sources);
    const skuPrice = skuItems
      .map((item) => item.price)
      .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0 && isTrustedPriceValue(value, visibleRange))
      .sort((a, b) => a - b)[0];
    if (skuPrice != null) {
      return {
        price: skuPrice,
        currency: "CNY",
        text: "¥" + formatMoney(skuPrice),
        sourceType: "skuMinFallback"
      };
    }

    return { price: null, currency: "CNY", text: "", sourceType: "" };
  }

  function pickVisiblePriceRange(pageText) {
    const text = normalizeWhitespace(pageText || "");
    if (!text) return null;
    const matches = text.match(/[¥￥]?\s*\d[\d.,]*\s*(?:-|~|—|–|至|到)\s*[¥￥]?\s*\d[\d.,]*/g) || [];
    for (const raw of matches.slice(0, 20)) {
      if (!/[¥￥元]/.test(raw) && !/\d+\.\d{1,2}\s*(?:-|~|—|–|至|到)\s*\d+\.\d{1,2}/.test(raw)) continue;
      const values = raw
        .split(/(?:-|~|—|–|至|到)/)
        .map((part) => parseMoneyNumber(part))
        .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
      if (values.length >= 2) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        if (max > 0 && max >= min) {
          return { min, max, text: raw.replace(/\s+/g, " ").trim() };
        }
      }
    }
    return null;
  }

  function pickVisibleSkuPriceRangeFromDom(pageText) {
    const rows = collectDomSkuPriceRows(pageText);
    const prices = rows
      .map((row) => row.price)
      .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (!prices.length) return null;
    const min = prices[0];
    const max = prices[prices.length - 1];
    return { min, max, text: "¥" + formatMoney(min) + " ~ ¥" + formatMoney(max) };
  }

  function isTrustedSourcePriceText(sourceText, visibleRange) {
    if (!visibleRange) return true;
    const parsed = parseSourcePriceText(sourceText, "CNY");
    return isTrustedPriceValue(parsed && parsed.price, visibleRange);
  }

  function isTrustedPriceValue(value, visibleRange) {
    if (!visibleRange) return true;
    const price = Number(value) || 0;
    if (!(price > 0)) return false;
    const min = Number(visibleRange.min) || 0;
    const max = Number(visibleRange.max) || 0;
    if (!(max > 0)) return true;
    const toleranceHigh = Math.max(max * 1.2, max + 20);
    const toleranceLow = Math.max(0, min * 0.5);
    return price >= toleranceLow && price <= toleranceHigh;
  }

  function pickSelectedOrderSummaryPrice(context) {
    const summary = pickSelectedOrderSummary(context && context.pageText);
    if (!summary) return null;
    return {
      price: summary.unitPrice,
      currency: "CNY",
      text: "¥" + formatMoney(summary.unitPrice),
      sourceType: "selectedOrderSummary",
      shippingCny: summary.shipping != null ? summary.shipping : (summary.shippingFree ? 0 : null),
      shippingText: summary.sample,
      shippingFree: summary.shippingFree,
      selectedSku: {
        skuId: "",
        name: "",
        specText: "",
        price: summary.unitPrice,
        priceText: "¥" + formatMoney(summary.unitPrice),
        selected: true,
        quantity: summary.quantity,
        productAmount: summary.productAmount,
        shippingCny: summary.shipping != null ? summary.shipping : (summary.shippingFree ? 0 : null),
        shippingFree: summary.shippingFree,
        attrs: {}
      }
    };
  }

  function pickSelectedOrderSummary(value) {
    const text = normalizeWhitespace(value || "");
    if (!text) return null;

    const selectedRegex = /已选\s*(\d+)\s*款\s*(\d+)\s*(?:个|件|只|台)?/g;
    let selectedMatch = null;
    let match;
    while ((match = selectedRegex.exec(text))) {
      selectedMatch = match;
    }
    if (!selectedMatch) return null;

    const selectedKinds = Number(selectedMatch[1]);
    const quantity = Number(selectedMatch[2]);
    if (selectedKinds !== 1 || !(quantity > 0)) return null;

    const sample = text.slice(selectedMatch.index, selectedMatch.index + 260);
    if (!/(商品金额|货品金额|商品总额|小计|合计)/.test(sample)) return null;

    const productAmount = parseMoneyNearLabel(sample, /商品金额|货品金额|商品总额|小计|合计/i);
    if (!(productAmount > 0)) return null;

    let shipping = parseMoneyNearLabel(sample, /另需运费|运费|快递|配送|邮费|shipping|freight/i);
    const shippingFree = /包邮|免邮|免运费|卖家承担运费|free shipping/i.test(sample);
    if (shipping == null && shippingFree) shipping = 0;

    return {
      selectedKinds,
      quantity,
      productAmount: roundMoney(productAmount),
      unitPrice: roundMoney(productAmount / quantity),
      shipping: shipping != null ? roundMoney(shipping) : null,
      shippingFree,
      sample
    };
  }

  function pickSelectedSkuPriceFromDom(pageText) {
    const rows = collectDomSkuPriceRows(pageText);
    if (!rows.length) return null;

    const selected = rows.find((row) => row.selected && row.price > 0);
    if (selected) {
      return {
        price: selected.price,
        currency: "CNY",
        text: selected.priceText,
        sourceType: "selectedSku",
        selectedSku: selected
      };
    }

    const fallbackRows = rows.filter((row) => row.source !== "text");
    if (fallbackRows.length >= 2) {
      const max = fallbackRows.slice().sort((a, b) => b.price - a.price)[0];
      if (max && max.price > 0) {
        return {
          price: max.price,
          currency: "CNY",
          text: max.priceText,
          sourceType: "skuMaxFallback",
          selectedSku: null
        };
      }
    }

    return null;
  }

  function collectDomSkuPriceRows(pageText) {
    const selectors = [
      "[class*='sku'], [class*='Sku'], [class*='spec'], [class*='Spec'], [class*='offer'], [class*='Offer'], [class*='sale'], [class*='Sale'], [class*='amount'], [class*='Amount'], li, tr, [role='row']"
    ];
    const rows = [];
    const seen = new Set();

    if (typeof document !== "undefined" && document.querySelectorAll) {
      selectors.forEach((selector) => {
        Array.from(document.querySelectorAll(selector) || []).slice(0, 600).forEach((node) => {
          if (!node || seen.has(node)) return;
          seen.add(node);
          const text = normalizeWhitespace(node.innerText || node.textContent || "");
          if (!text || text.length > 320) return;
          if (!/[¥￥]\s*\d|\d[\d.,]*\s*元/.test(text)) return;
          if (!/(库存|现货|起批|件|个|颜色|尺码|规格|型号|sku|SKU)/.test(text)) return;
          const price = extractSkuRowPrice(text);
          if (!(price > 0)) return;
          const quantity = extractSkuRowQuantity(text) || extractControlQuantity(node);
          const selected = isSelectedSkuNode(node) || quantity > 0;
          rows.push(buildSkuRow({
            skuId: pickNodeAttribute(node, ["data-sku-id", "data-sku", "sku-id", "data-id"]) || "",
            text,
            price,
            selected,
            quantity,
            source: "dom"
          }));
        });
      });
    }

    rows.push(...collectSkuPriceRowsFromText(pageText));

    return dedupeSkuRows(rows);
  }

  function collectSkuPriceRowsFromText(pageText) {
    const text = normalizeWhitespace(pageText || "");
    if (!text) return [];
    const priceMatches = Array.from(text.matchAll(/[¥￥]\s*\d[\d.,]*/g));
    const rows = [];
    priceMatches.slice(0, 80).forEach((match, index) => {
      const price = parseMoneyNumber(match[0]);
      if (!(price > 0)) return;
      const start = Math.max(0, match.index - 80);
      const nextIndex = priceMatches[index + 1] ? priceMatches[index + 1].index : text.length;
      const end = Math.min(text.length, nextIndex);
      const sample = text.slice(start, end);
      if (!/(库存|现货|颜色|尺码|规格|型号|sku|SKU|(?:-|−|－)\s*\d+\s*\+)/.test(sample)) return;
      const quantity = extractSkuRowQuantity(sample);
      rows.push(buildSkuRow({
        skuId: "",
        text: sample,
        price,
        selected: quantity > 0,
        quantity,
        source: "text"
      }));
    });
    return rows;
  }

  function buildSkuRow(input) {
    const text = input && input.text ? input.text : "";
    const name = cleanupSkuRowName(text);
    return {
      skuId: input.skuId || "",
      name,
      specText: name,
      price: input.price,
      priceText: "¥" + formatMoney(input.price),
      selected: Boolean(input.selected),
      quantity: Number(input.quantity) || 0,
      source: input.source || "dom",
      attrs: name ? { spec: name } : {}
    };
  }

  function dedupeSkuRows(rows) {
    const unique = [];
    const seen = new Set();
    rows.forEach((row) => {
      const key = [row.skuId, row.name, row.price].join("|");
      if (seen.has(key)) return;
      seen.add(key);
      unique.push(row);
    });
    return unique;
  }

  function pickNodeAttribute(node, names) {
    for (const name of names || []) {
      if (node && typeof node.getAttribute === "function") {
        const value = node.getAttribute(name);
        if (value) return normalizeWhitespace(value);
      }
    }
    return "";
  }

  function isSelectedSkuNode(node) {
    const className = String((node && (node.className || (node.getAttribute && node.getAttribute("class")))) || "");
    if (/(^|\s)(selected|active|checked|current|is-selected|isActive)(\s|$)/i.test(className)) return true;
    if (node && typeof node.getAttribute === "function") {
      const aria = node.getAttribute("aria-selected");
      const dataSelected = node.getAttribute("data-selected") || node.getAttribute("selected");
      if (String(aria).toLowerCase() === "true" || String(dataSelected).toLowerCase() === "true") return true;
    }
    return false;
  }

  function extractControlQuantity(node) {
    const controls = [];
    if (node && typeof node.querySelectorAll === "function") {
      controls.push(...Array.from(node.querySelectorAll("input, [role='spinbutton'], [contenteditable='true']") || []));
    }
    if (node) controls.push(node);
    const values = controls.map((control) => {
      const raw = control && (control.value != null ? control.value : (control.getAttribute && control.getAttribute("value")));
      const number = Number(String(raw == null ? "" : raw).replace(/[^\d.-]/g, ""));
      return Number.isFinite(number) && number > 0 ? number : 0;
    }).filter((value) => value > 0);
    return values.length ? values[0] : 0;
  }

  function extractSkuRowQuantity(text) {
    const matches = Array.from(String(text || "").matchAll(/(?:-|−|－)\s*(\d+)\s*\+/g));
    if (!matches.length) return 0;
    const last = matches[matches.length - 1];
    const quantity = Number(last && last[1]);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  }

  function extractSkuRowPrice(text) {
    const matches = String(text || '').match(/[¥￥]\s*\d[\d.,]*/g);
    if (!matches || !matches.length) return null;
    const values = matches
      .map((item) => parseMoneyNumber(item))
      .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
    return values.length ? roundMoney(values[0]) : null;
  }

  function cleanupSkuRowName(text) {
    return normalizeWhitespace(text)
      .replace(/[¥￥]\s*\d[\d.,]*/g, " ")
      .replace(/库存\s*\d+\s*[个件]?/g, " ")
      .replace(/[-+]\s*\d+\s*[-+]?/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/颜色|尺码|规格|型号/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseSourcePriceText(text, fallbackCurrency) {
    const normalized = normalizeWhitespace(text || "");
    const range = normalized.match(/[¥￥]?\s*\d[\d.,]*\s*(?:-|~|—|–|至|到)\s*[¥￥]?\s*\d[\d.,]*/);
    if (range) {
      const values = range[0]
        .split(/(?:-|~|—|–|至|到)/)
        .map((part) => parseMoneyNumber(part))
        .filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
      if (values.length) {
        return {
          price: Math.max(...values),
          currency: detectCurrencyFromTextSafe(normalized, fallbackCurrency),
          sourceType: "rangeHigh"
        };
      }
    }
    const parsed = parsePriceWithCurrencySafe(normalized, fallbackCurrency);
    return {
      price: parsed.price != null && parsed.price !== "" ? Number(parsed.price) : null,
      currency: parsed.currency || fallbackCurrency || "CNY",
      sourceType: "dom"
    };
  }

  function pickPriceTextFromSources(sources) {
    const candidates = [];
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        const lastKey = path[path.length - 1] || "";
        if (!/(price|amount|promotion|sale|discount|range|价格|价)/i.test(String(lastKey))) return;
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          candidates.push({ score: scorePricePath(path), text: String(value), price: value });
          return;
        }
        if (typeof value === "string") {
          const text = normalizeWhitespace(value);
          const parsed = parsePriceWithCurrencySafe(text, "CNY");
          if (parsed.price != null && parsed.price !== "") {
            candidates.push({ score: scorePricePath(path), text, price: Number(parsed.price) });
          }
        }
      });
    });
    candidates.sort((a, b) => b.score - a.score || a.price - b.price);
    return candidates.length ? candidates[0].text : "";
  }

  function scorePricePath(path) {
    const text = path.join(".").toLowerCase();
    let score = 0;
    if (/promotion|discount|sale|current|actual|priceRange|range|offer|trade/.test(text)) score += 4;
    if (/price|价格|价/.test(text)) score += 3;
    if (/market|original|origin|old|retail|划线/.test(text)) score -= 5;
    if (/count|stock|quantity|sold|salecount|volume/.test(text)) score -= 4;
    return score;
  }

  function pickSourceShipping(context) {
    const summary = pickSelectedOrderSummary(context && context.pageText);
    if (summary && summary.shipping != null) {
      return {
        value: summary.shipping,
        currency: "CNY",
        text: summary.sample,
        free: summary.shippingFree || summary.shipping === 0,
        sourceType: "selectedOrderSummary"
      };
    }
    if (summary && summary.shippingFree) {
      return {
        value: 0,
        currency: "CNY",
        text: summary.sample,
        free: true,
        sourceType: "selectedOrderSummary"
      };
    }

    const textHit = pickShippingFromText(context && context.pageText);
    if (textHit.value != null) return textHit;
    const sourceHit = pickShippingFromSources(context && context.sources);
    if (sourceHit.value != null) return sourceHit;
    return { value: 0, currency: "CNY", text: "", free: false, sourceType: "missing" };
  }

  function pickShippingFromText(value) {
    const text = normalizeWhitespace(value || "");
    if (/包邮|免邮|免运费|卖家承担运费|free shipping/i.test(text)) {
      return { value: 0, currency: "CNY", text: "包邮", free: true, sourceType: "text" };
    }
    const labelMatch = text.match(/运费|快递|配送|邮费|shipping|freight/i);
    if (!labelMatch) return { value: null, currency: "CNY", text: "", free: false, sourceType: "" };
    const start = Math.max(0, labelMatch.index - 40);
    const sample = text.slice(start, labelMatch.index + 120);
    if (/包邮|免邮|免运费|卖家承担运费|free shipping/i.test(sample)) {
      return { value: 0, currency: "CNY", text: "包邮", free: true, sourceType: "text" };
    }
    const amount = parseMoneyNearLabel(sample, /运费|快递|配送|邮费|shipping|freight/i);
    if (amount != null) {
      return {
        value: roundMoney(amount),
        currency: "CNY",
        text: sample,
        free: amount === 0,
        sourceType: "text"
      };
    }
    return { value: null, currency: "CNY", text: sample, free: false, sourceType: "" };
  }

  function pickShippingFromSources(sources) {
    const candidates = [];
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        const keyText = path.join(".").toLowerCase();
        if (!/(freight|shipping|postage|delivery|logistics|express|运费|邮费|快递|配送)/i.test(keyText)) return;
        if (!/(fee|price|amount|cost|money|fare|运费|邮费|价|费)/i.test(keyText)) return;
        const price = parseMoneyNumber(value);
        if (price == null || price < 0) return;
        candidates.push({ price, text: String(value), score: /freight|shipping|postage|运费|邮费/i.test(keyText) ? 2 : 1 });
      });
    });
    candidates.sort((a, b) => b.score - a.score || a.price - b.price);
    if (!candidates.length) return { value: null, currency: "CNY", text: "", free: false, sourceType: "" };
    return {
      value: roundMoney(candidates[0].price),
      currency: "CNY",
      text: candidates[0].text,
      free: candidates[0].price === 0,
      sourceType: "json"
    };
  }

  function parseMoneyNearLabel(text, labelRegex) {
    const normalized = normalizeWhitespace(text || "");
    const index = normalized.search(labelRegex);
    if (index < 0) return null;
    const sample = index >= 0 ? normalized.slice(index, index + 80) : normalized;
    const direct = sample.match(/(?:¥|￥|RMB|CNY)?\s*\d[\d.,]*(?:\s*(?:元|¥|￥|RMB|CNY))?/i);
    if (!direct) return null;
    return parseMoneyNumber(direct[0]);
  }

  function parseMoneyNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
    const parsed = parsePriceWithCurrencySafe(String(value == null ? "" : value), "CNY");
    const number = Number(parsed.price);
    return Number.isFinite(number) ? roundMoney(number) : null;
  }

  function roundMoney(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function normalizePriceDisplay(value) {
    const text = normalizeWhitespace(value);
    if (!text) return "";
    const range = text.match(/[¥￥]?\s*\d[\d.,]*\s*(?:-|~|—|–|至|到)\s*[¥￥]?\s*\d[\d.,]*/);
    if (range) return range[0].replace(/\s+/g, " ").trim();
    const withCurrency = text.match(/[¥￥]\s*\d[\d.,]*/);
    if (withCurrency) return withCurrency[0].replace(/\s+/g, "");
    const yuan = text.match(/\d[\d.,]*\s*元/);
    if (yuan) return yuan[0].replace(/\s+/g, "");
    return text;
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
    const weightRaw = pickFirstValue(item, ["grossWeight", "weight", "weightGram", "skuWeight", "freightWeight"]);
    const grossWeightGrams = convertWeightToGrams(weightRaw, guessWeightUnit(weightRaw));

    return {
      skuId: skuId == null ? "" : String(skuId),
      name: name == null ? "" : String(name),
      specText,
      price,
      stock,
      grossWeightGrams
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
        imageSet.add(normalizeOzonCollectedImageUrl(src));
      }
    });

    collectStringCandidates(sources, /(image|img|photo|picture)/i)
      .slice(0, 100)
      .forEach((item) => {
        const value = item.value;
        if (/^https?:\/\//i.test(value)) {
          imageSet.add(normalizeOzonCollectedImageUrl(value));
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

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return "";
    return Number(value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
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
