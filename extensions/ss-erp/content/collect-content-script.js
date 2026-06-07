(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
  const BRIDGE_ID = "spb-self-hosted-page-bridge";
  const PAGE_STATE_TIMEOUT_MS = 8000;
  const OZON_PANEL_ID = "spb-self-hosted-ozon-panel";
  const ALIBABA_1688_COLLECT_ID = "ss-erp-1688-collect-panel";
  const ALIBABA_1688_PRICE_CHECK_SEARCH_ID = "ss-erp-1688-search-price-check-panel";
  const OZON_1688_PRICE_CHECK_CONTEXT_KEY = "ss-erp:ozon-1688-price-check-context";
  let lastOzonUrl = "";

  injectPageBridge();
  initOzonOverlay();
  initAlibaba1688CollectButton();
  initAlibaba1688PriceCheckSearchPanel();

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
    const embeddedJson = parseEmbeddedJsonData();

    if (jsonLd.length) {
      allSources.push(...jsonLd);
    }
    if (embeddedJson.length) {
      allSources.push(...embeddedJson);
    }

    const extractor = PLATFORM_EXTRACTORS[platform] || extractGenericProduct;
    const data = extractor({
      platform,
      pageText,
      pageState,
      sources: allSources,
      jsonLd,
      embeddedJson
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

  function isAlibaba1688ProductPage() {
    return /^https:\/\/detail\.1688\.com\/offer\/\d+\.html/i.test(location.href);
  }

  function isAlibaba1688SearchPage() {
    return /^https:\/\/s\.1688\.com\//i.test(location.href);
  }

  function initAlibaba1688PriceCheckSearchPanel() {
    if (!isAlibaba1688SearchPage()) {
      return;
    }

    const render = () => {
      if (document.getElementById(ALIBABA_1688_PRICE_CHECK_SEARCH_ID)) {
        return;
      }

      loadPriceCheckContext().then((context) => {
        if (!context || document.getElementById(ALIBABA_1688_PRICE_CHECK_SEARCH_ID)) {
          return;
        }

        const panel = document.createElement("section");
        panel.id = ALIBABA_1688_PRICE_CHECK_SEARCH_ID;
        panel.style.cssText = [
          "position:fixed",
          "right:18px",
          "top:168px",
          "z-index:2147483646",
          "width:280px",
          "border-radius:10px",
          "background:#fff7ed",
          "border:1px solid #fed7aa",
          "box-shadow:0 10px 28px rgba(15,23,42,0.16)",
          "color:#7c2d12",
          "font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif",
          "font-size:12px",
          "line-height:1.45",
          "padding:10px",
          "text-align:left"
        ].join(";");

        const sourceLink = /^https?:\/\//i.test(String(context.sourceUrl || "")) ? String(context.sourceUrl) : "";
        panel.innerHTML = [
          '<div style="font-weight:800;font-size:13px;margin-bottom:5px;">Ozon 核价</div>',
          `<div style="font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(context.title || "")}">${escapeHtml(context.title || "未命名 Ozon 商品")}</div>`,
          `<div style="margin-top:3px;color:#9a3412;">售价：${escapeHtml(formatPriceForContext(context.price, context.currency))}</div>`,
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">',
          sourceLink ? `<a href="${escapeHtml(sourceLink)}" target="_blank" rel="noreferrer" style="border:1px solid #fdba74;border-radius:7px;background:#fff;color:#9a3412;padding:5px 8px;text-decoration:none;font-size:12px;font-weight:700;">打开Ozon</a>` : "",
          '<button type="button" data-role="price-check-clear" style="border:1px solid #fdba74;border-radius:7px;background:#fff;color:#9a3412;padding:5px 8px;cursor:pointer;font-size:12px;font-weight:700;">清除</button>',
          '</div>'
        ].join("");

        const clear = panel.querySelector("[data-role='price-check-clear']");
        if (clear) {
          clear.addEventListener("click", async () => {
            clear.disabled = true;
            await clearPriceCheckContext();
            panel.remove();
          });
        }

        document.body.appendChild(panel);
      }).catch(() => {});
    };

    if (document.body) {
      render();
    } else {
      window.addEventListener("DOMContentLoaded", render, { once: true });
    }
  }

  function initAlibaba1688CollectButton() {
    if (!isAlibaba1688ProductPage()) {
      return;
    }

    const render = () => {
      if (document.getElementById(ALIBABA_1688_COLLECT_ID)) {
        return;
      }

      const panel = document.createElement("section");
      panel.id = ALIBABA_1688_COLLECT_ID;
      panel.style.cssText = [
        "position:fixed",
        "right:18px",
        "top:168px",
        "z-index:2147483646",
        "display:flex",
        "flex-direction:column",
        "gap:6px",
        "align-items:flex-end",
        "font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif"
      ].join(";");

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "采集到ERP";
      button.style.cssText = [
        "border:0",
        "border-radius:8px",
        "background:#0f766e",
        "color:#fff",
        "box-shadow:0 8px 22px rgba(15,118,110,0.25)",
        "font-size:13px",
        "font-weight:700",
        "line-height:1",
        "padding:10px 12px",
        "cursor:pointer"
      ].join(";");

      const status = document.createElement("div");
      status.style.cssText = [
        "display:none",
        "max-width:220px",
        "border-radius:8px",
        "background:#fff",
        "border:1px solid rgba(15,23,42,0.12)",
        "box-shadow:0 8px 24px rgba(15,23,42,0.12)",
        "color:#334155",
        "font-size:12px",
        "padding:7px 9px",
        "text-align:right"
      ].join(";");

      function setStatus(text, isError) {
        status.textContent = text || "";
        status.style.display = text ? "block" : "none";
        status.style.color = isError ? "#b91c1c" : "#334155";
      }

      button.addEventListener("click", async () => {
        button.disabled = true;
        button.style.opacity = "0.72";
        button.textContent = "采集中...";
        setStatus("", false);

        try {
          const payload = await collectCurrentPage();
          const priceCheckContext = await loadPriceCheckContext();
          if (priceCheckContext) {
            payload.priceCheckContext = priceCheckContext;
          }
          const response = await sendRuntimeMessage({
            type: "ozon-calc:collect-to-erp",
            payload
          });

          if (!response || !response.ok) {
            throw new Error((response && (response.error || response.msg)) || "采集失败");
          }

          button.textContent = "已采集";
          button.style.background = "#16a34a";
          setStatus("已保存到ERP采集记录", false);
        } catch (error) {
          button.disabled = false;
          button.style.opacity = "1";
          button.textContent = "采集到ERP";
          setStatus(error && error.message ? error.message : String(error), true);
        }
      });

      const contextBox = document.createElement("div");
      contextBox.style.cssText = [
        "display:none",
        "max-width:260px",
        "border-radius:10px",
        "background:#fff7ed",
        "border:1px solid #fed7aa",
        "box-shadow:0 8px 24px rgba(15,23,42,0.10)",
        "color:#7c2d12",
        "font-size:12px",
        "line-height:1.45",
        "padding:9px 10px",
        "text-align:left"
      ].join(";");

      loadPriceCheckContext().then((context) => {
        if (!context) return;
        const sourceLink = /^https?:\/\//i.test(String(context.sourceUrl || "")) ? String(context.sourceUrl) : "";
        contextBox.style.display = "block";
        contextBox.innerHTML = [
          '<div style="font-weight:700;margin-bottom:4px;">Ozon 核价上下文</div>',
          `<div style="font-weight:600;max-width:236px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(context.title || "")}">${escapeHtml(context.title || "未命名 Ozon 商品")}</div>`,
          `<div style="margin-top:3px;color:#9a3412;">售价：${escapeHtml(formatPriceForContext(context.price, context.currency))}</div>`,
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:7px;">',
          '<button type="button" data-role="price-check-calc" style="border:0;border-radius:7px;background:#ea580c;color:#fff;padding:6px 9px;cursor:pointer;font-size:12px;font-weight:700;">计算当前页采购价</button>',
          sourceLink ? `<a href="${escapeHtml(sourceLink)}" target="_blank" rel="noreferrer" style="border:1px solid #fdba74;border-radius:7px;background:#fff;color:#9a3412;padding:5px 8px;text-decoration:none;font-size:12px;font-weight:700;">打开Ozon</a>` : "",
          '<button type="button" data-role="price-check-clear" style="border:1px solid #fdba74;border-radius:7px;background:#fff;color:#9a3412;padding:5px 8px;cursor:pointer;font-size:12px;font-weight:700;">清除</button>',
          '</div>'
        ].join("");
        const calc = contextBox.querySelector("[data-role='price-check-calc']");
        if (calc) {
          calc.addEventListener("click", async () => {
            calc.disabled = true;
            calc.textContent = "计算中...";
            try {
              const current = await collectCurrentPage();
              const summary = await buildPriceCheckSummary(context, current);
              setStatus(summary, false);
              calc.textContent = "已计算";
            } catch (error) {
              calc.disabled = false;
              calc.textContent = "计算当前页采购价";
              setStatus(error && error.message ? error.message : String(error), true);
            }
          });
        }
        const clear = contextBox.querySelector("[data-role='price-check-clear']");
        if (clear) {
          clear.addEventListener("click", async () => {
            clear.disabled = true;
            await clearPriceCheckContext();
            contextBox.remove();
            setStatus("已清除 Ozon 核价上下文", false);
          });
        }
      }).catch(() => {});

      panel.appendChild(contextBox);
      panel.appendChild(button);
      panel.appendChild(status);
      document.body.appendChild(panel);
    };

    if (document.body) {
      render();
    } else {
      window.addEventListener("DOMContentLoaded", render, { once: true });
    }
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
            <button type="button" data-role="price-check-1688" title="保存当前 Ozon 商品并打开 1688 搜索核价" style="border:0;background:rgba(255,255,255,0.18);color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;transition:background 0.15s;">1688核价</button>
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

    panel.querySelector("[data-role='price-check-1688']").addEventListener("click", async (e) => {
      e.stopPropagation();
      const btn = panel.querySelector("[data-role='price-check-1688']");
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "打开中...";
      btn.style.background = "rgba(22,163,74,0.7)";
      try {
        const payload = await collectCurrentPage();
        const context = buildOzonPriceCheckContext(payload, panel._ozonData, productId);
        const response = await sendRuntimeMessage({
          type: "ss-erp:start-1688-price-check",
          payload: context
        });
        if (!response || !response.ok) {
          throw new Error((response && (response.error || response.msg)) || "打开 1688 核价失败");
        }
        btn.textContent = "已打开";
      } catch (error) {
        btn.disabled = false;
        btn.textContent = original;
        btn.style.background = "rgba(255,255,255,0.18)";
        const status = panel.querySelector("[data-role='status']");
        if (status) {
          status.textContent = error && error.message ? error.message : String(error);
        }
      }
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

  function buildOzonPriceCheckContext(payload, insights, productId) {
    const item = insights && insights.item ? insights.item : {};
    const images = Array.isArray(payload && payload.images) ? payload.images : [];
    return {
      sourcePlatform: "ozon",
      productId: String((payload && payload.productId) || productId || ""),
      title: String((payload && payload.title) || item.name || document.querySelector("h1")?.textContent || "").trim(),
      price: payload && payload.price != null && payload.price !== "" ? payload.price : item.avgPrice,
      currency: (payload && payload.currency) || "RUB",
      images: images.slice(0, 8),
      sourceUrl: (payload && payload.sourceUrl) || location.href,
      avgPriceRub: item.avgPrice || null,
      soldCount30d: item.soldCount || null,
      createdAt: new Date().toISOString()
    };
  }

  function loadPriceCheckContext() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get([OZON_1688_PRICE_CHECK_CONTEXT_KEY], (result) => {
        const context = result && result[OZON_1688_PRICE_CHECK_CONTEXT_KEY];
        if (!context || typeof context !== "object") {
          resolve(null);
          return;
        }
        const createdAt = Date.parse(context.createdAt || "");
        if (Number.isFinite(createdAt) && Date.now() - createdAt > 24 * 60 * 60 * 1000) {
          resolve(null);
          return;
        }
        resolve(context);
      });
    });
  }

  function clearPriceCheckContext() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve();
        return;
      }
      chrome.storage.local.remove([OZON_1688_PRICE_CHECK_CONTEXT_KEY], () => resolve());
    });
  }

  async function buildPriceCheckSummary(ozonContext, alibabaProduct) {
    const ozonPrice = Number(ozonContext && ozonContext.price);
    const ozonCurrency = String((ozonContext && ozonContext.currency) || "RUB").toUpperCase();
    const purchasePrice = Number(alibabaProduct && alibabaProduct.price);
    const purchaseCurrency = String((alibabaProduct && alibabaProduct.currency) || "CNY").toUpperCase();
    const ozonText = formatPriceForContext(ozonContext && ozonContext.price, ozonCurrency);
    const purchaseText = formatPriceForContext(alibabaProduct && alibabaProduct.price, purchaseCurrency);
    if (Number.isFinite(ozonPrice) && Number.isFinite(purchasePrice) && ozonCurrency === purchaseCurrency) {
      return `核价：Ozon ${ozonText} / 1688 ${purchaseText} / 差额 ${formatPriceForContext(ozonPrice - purchasePrice, ozonCurrency)}`;
    }
    if (Number.isFinite(ozonPrice) && Number.isFinite(purchasePrice)) {
      const fxSnapshot = await loadFxSnapshot();
      const convertedPurchase = convertPriceForContext(purchasePrice, purchaseCurrency, ozonCurrency, fxSnapshot);
      if (Number.isFinite(convertedPurchase) && convertedPurchase > 0) {
        const diff = ozonPrice - convertedPurchase;
        return `核价：Ozon ${ozonText} / 1688采购 ${purchaseText} ≈ ${formatPriceForContext(convertedPurchase, ozonCurrency)} / 粗差 ${formatPriceForContext(diff, ozonCurrency)}`;
      }
    }
    return `核价：Ozon ${ozonText} / 1688采购 ${purchaseText}（币种不同，后续按汇率和费用核算利润）`;
  }

  function loadFxSnapshot() {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
        resolve(null);
        return;
      }
      chrome.storage.local.get(["ozon-calculator:fx-snapshot"], (result) => {
        resolve(result && result["ozon-calculator:fx-snapshot"] ? result["ozon-calculator:fx-snapshot"] : null);
      });
    });
  }

  function convertPriceForContext(value, fromCurrency, toCurrency, fxSnapshot) {
    const amount = Number(value);
    const from = String(fromCurrency || "").toUpperCase();
    const to = String(toCurrency || "").toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0 || !from || !to) return 0;
    if (from === to) return amount;
    if (window.OZON_CALC_FX_RATES) {
      if (to === "RUB" && typeof window.OZON_CALC_FX_RATES.priceToRUB === "function") {
        return window.OZON_CALC_FX_RATES.priceToRUB(amount, from, fxSnapshot, 0.08);
      }
      if (to === "CNY" && typeof window.OZON_CALC_FX_RATES.priceToCNY === "function") {
        return window.OZON_CALC_FX_RATES.priceToCNY(amount, from, fxSnapshot, 0.08);
      }
    }
    if (from === "CNY" && to === "RUB") return amount / 0.08;
    if (from === "RUB" && to === "CNY") return amount * 0.08;
    return 0;
  }

  function formatPriceForContext(price, currency) {
    if (price == null || price === "") return `- ${String(currency || "").toUpperCase() || "CNY"}`;
    const value = Number(price);
    const suffix = String(currency || "").toUpperCase() || "CNY";
    return Number.isFinite(value) ? `${value.toFixed(2)} ${suffix}` : `- ${suffix}`;
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

  function parseEmbeddedJsonData() {
    const results = [];
    const seen = new Set();
    document.querySelectorAll('script[type*="json"], script[id*="__NEXT_DATA__"], script[id*="__INIT_DATA__"], script[id*="data"]').forEach((node) => {
      if (results.length >= 20) {
        return;
      }
      const type = String(node.getAttribute("type") || "").toLowerCase();
      if (type.includes("ld+json")) {
        return;
      }
      const text = (node.textContent || "").trim();
      if (!text || text.length > 2_000_000 || seen.has(text)) {
        return;
      }
      seen.add(text);

      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          results.push(parsed);
        }
      } catch (_error) {
        // Ignore non-JSON inline scripts; page bridge covers known window globals.
      }
    });
    return results;
  }

  function extract1688Product(context) {
    return buildProductResult(context, {
      monthlySalesKeywords: [/月销量[:：]?\s*([0-9.,万wW+]+)/i, /近30天成交[:：]?\s*([0-9.,万wW+]+)/i, /已售[:：]?\s*([0-9.,万wW+]+)/i],
      weightKeywords: [/克重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /重量[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i, /毛重[:：]?\s*([0-9.,]+)\s*(g|kg|克|千克|斤)/i],
      titleSelectors: ["h1", ".title-text", ".d-title"],
      shopSelectors: [".company-name", ".shop-name", ".mod-detail-company-name", "[class*='company']", "[class*='supplier']", "[class*='shop']"],
      priceSelectors: [".price", ".price-text", ".price-range", ".ma-ref-price", "[class*='price']", "[class*='Price']"],
      categorySelectors: [".breadcrumb", ".bread-crumb", ".detail-breadcrumb", "[class*='breadcrumb']", "[class*='crumb']"],
      descriptionSelectors: ["#desc-lazyload-container", ".detail-description", ".description", "[class*='description']", "[class*='Description']", "[class*='detail-desc']", "[class*='DetailDesc']"],
      shippingSelectors: [".logistics", ".delivery", ".shipping", ".freight", "[class*='logistics']", "[class*='delivery']", "[class*='shipping']", "[class*='freight']"],
      productIdRegexes: [/offer\/(\d+)\.html/i, /offerId[=:/"]+(\d+)/i]
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
    const dimensions = pickDimensions(context.pageText, context.sources);
    const images = pickImages(context.sources);
    const attributes = pickAttributes(context.sources);
    const description = pickDescription(config.descriptionSelectors, context.sources);
    const priceInfo = pickPrice(config.priceSelectors, context.sources, skuItems);
    const categoryPath = pickCategoryPath(config.categorySelectors, context.sources);
    const minOrderQty = pickMinOrderQty(context.pageText, context.sources, skuItems);
    const supplierInfo = pickSupplierInfo(context.pageText, context.sources, shopName);
    const shippingInfo = pickShippingInfo(config.shippingSelectors, context.pageText, context.sources);
    const customizationInfo = pickCustomizationInfo(context.pageText, context.sources);

    return {
      platform: context.platform,
      extractor: `self-hosted-${context.platform}`,
      title,
      shopName,
      supplierName: supplierInfo.name || shopName,
      supplierLocation: supplierInfo.location,
      supplierYears: supplierInfo.years,
      productId,
      price: priceInfo.price,
      priceText: priceInfo.priceText,
      currency: priceInfo.currency,
      categoryPath,
      categoryName: categoryPath ? categoryPath.split(/\s*[>›/]\s*/).filter(Boolean).slice(-1)[0] || categoryPath : "",
      monthlySales,
      grossWeightGrams,
      lengthMm: dimensions.lengthMm,
      widthMm: dimensions.widthMm,
      heightMm: dimensions.heightMm,
      dimensionsText: dimensions.rawText,
      minOrderQty,
      shippingInfo,
      logisticsText: shippingInfo.text,
      customizationInfo,
      skuCount,
      skuItems,
      images,
      attributes,
      description,
      debug: {
        pageState: context.pageState,
        productIdEvidence: productId ? "url/dom/json" : "",
        priceCandidates: priceInfo.candidates,
        categoryPathEvidence: categoryPath ? "dom/json" : "",
        supplierEvidence: supplierInfo.evidence,
        shippingEvidence: shippingInfo.evidence,
        customizationEvidence: customizationInfo.evidence,
        monthlySalesCandidates: collectNumberCandidates(context.sources, /(month|sale|sold|trade|销量|成交|已售)/i).slice(0, 20),
        weightCandidates: collectNumberCandidates(context.sources, /(weight|gross|gram|克|斤|重量|毛重|净重)/i).slice(0, 20),
        dimensionCandidates: dimensions.candidates,
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

  function pickPrice(selectors, sources, skuItems) {
    const domTexts = [];
    for (const selector of selectors || []) {
      document.querySelectorAll(selector).forEach((node) => {
        const text = normalizeWhitespace(node.textContent || "");
        if (text && /[¥￥元]\s*[0-9]|[0-9][0-9.,]*\s*(?:元|CNY|RMB)/i.test(text)) {
          domTexts.push(text);
        }
      });
      if (domTexts.length) break;
    }

    const stringCandidates = collectStringCandidates(sources, /(price|salePrice|finalPrice|discountPrice|promotionPrice|amount|价格|售价)$/i)
      .slice(0, 30)
      .map((item) => item.value);
    const skuPrices = (Array.isArray(skuItems) ? skuItems : [])
      .map((item) => item && item.price)
      .filter((value) => Number.isFinite(Number(value)))
      .sort((a, b) => Number(a) - Number(b))
      .map((value) => String(value));
    const candidates = domTexts.concat(stringCandidates, skuPrices);

    for (const text of candidates) {
      const price = parsePriceValue(text);
      if (price != null && price > 0) {
        return {
          price,
          priceText: String(text),
          currency: inferCurrencyFromPriceText(text),
          candidates: candidates.slice(0, 10),
        };
      }
    }

    return { price: null, priceText: "", currency: "CNY", candidates: candidates.slice(0, 10) };
  }

  function pickDescription(selectors, sources) {
    const texts = [];
    for (const selector of selectors || []) {
      document.querySelectorAll(selector).forEach((node) => {
        const text = normalizeWhitespace(node.textContent || "");
        if (text && text.length >= 20 && text.length <= 6000) {
          texts.push(text);
        }
      });
      if (texts.length) break;
    }

    collectStringCandidates(sources, /(description|desc|productDescription|detailDesc|详情|描述|说明)$/i)
      .slice(0, 20)
      .forEach((item) => {
        if (item.value && item.value.length >= 20 && item.value.length <= 6000) {
          texts.push(item.value);
        }
      });

    return Array.from(new Set(texts))[0]?.slice(0, 2000) || "";
  }

  function parsePriceValue(input) {
    if (input == null || input === "") return null;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    const text = String(input).replace(/,/g, "").replace(/\s+/g, "");
    const prefixMatch = text.match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/);
    if (prefixMatch) return Number(prefixMatch[1]);
    const suffixMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:元|CNY|RMB)/i);
    if (suffixMatch) return Number(suffixMatch[1]);
    const numbers = Array.from(text.matchAll(/[0-9]+(?:\.[0-9]+)?/g))
      .map((match) => Number(match[0]))
      .filter((value) => Number.isFinite(value) && value > 0);
    return numbers.length ? Math.min(...numbers) : parseLooseNumber(text);
  }

  function inferCurrencyFromPriceText(text) {
    const raw = String(text || "");
    if (raw.includes("¥") || raw.includes("￥") || /(?:元|CNY|RMB)/i.test(raw)) return "CNY";
    return "CNY";
  }

  function pickCategoryPath(selectors, sources) {
    for (const selector of selectors || []) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const parts = Array.from(node.querySelectorAll("a, span, li"))
        .map((item) => normalizeWhitespace(item.textContent || ""))
        .filter((text) => text && text.length <= 80 && !/首页|主页|home/i.test(text));
      if (parts.length >= 2) {
        return Array.from(new Set(parts)).join(" > ");
      }
      const text = normalizeWhitespace(node.textContent || "");
      if (text && text.length <= 300) {
        return text.replace(/\s*[>›/]\s*/g, " > ");
      }
    }

    const candidates = collectStringCandidates(sources, /(category|categoryPath|catName|catPath|breadcrumb|crumb|类目|分类)$/i)
      .map((item) => item.value)
      .filter((value) => value && value.length <= 300);
    return candidates[0] || "";
  }

  function pickMinOrderQty(pageText, sources, skuItems) {
    const skuValues = (Array.isArray(skuItems) ? skuItems : [])
      .map((item) => item && item.minOrderQty)
      .filter((value) => Number.isFinite(Number(value)) && Number(value) > 0)
      .map(Number)
      .sort((a, b) => a - b);
    if (skuValues.length) return skuValues[0];

    const patterns = [
      /起订量[:：]?\s*([0-9.,]+)/i,
      /最小起订量[:：]?\s*([0-9.,]+)/i,
      /起批量[:：]?\s*([0-9.,]+)/i,
      /min(?:imum)?\s*order(?:\s*qty|\s*quantity)?[:：]?\s*([0-9.,]+)/i,
      /MOQ[:：]?\s*([0-9.,]+)/i
    ];
    for (const pattern of patterns) {
      const match = pageText.match(pattern);
      if (match && match[1]) {
        const value = parseLooseNumber(match[1]);
        if (value != null && value > 0) return value;
      }
    }

    const candidates = collectNumberCandidates(sources, /(minOrder|min_order|minimumOrder|moq|起订|起批)/i);
    const hit = candidates.find((item) => item.value != null && item.value > 0);
    return hit ? hit.value : null;
  }

  function pickSupplierInfo(pageText, sources, fallbackName) {
    const name = fallbackName || pickStringByKey(sources, /(supplierName|sellerName|companyName|shopName|storeName|供应商|公司名)$/i);
    const location =
      pickStringByKey(sources, /(province|city|location|area|address|region|所在地|地区|地址)$/i) ||
      matchTextValue(pageText, /(?:所在地|地区|地址)[:：]?\s*([^\n，,。]{2,40})/);
    const yearsText =
      pickStringByKey(sources, /(years|yearEstablished|established|经营年限|诚信通|年限)$/i) ||
      matchTextValue(pageText, /(?:经营|诚信通|开店)\s*([0-9]+)\s*年/);
    const years = parseLooseNumber(yearsText);
    return {
      name: normalizeWhitespace(name || ""),
      location: normalizeWhitespace(location || ""),
      years: Number.isFinite(Number(years)) && Number(years) > 0 ? Number(years) : null,
      evidence: [name ? "name" : "", location ? "location" : "", years ? "years" : ""].filter(Boolean).join(",")
    };
  }

  function pickShippingInfo(selectors, pageText, sources) {
    const texts = [];
    for (const selector of selectors || []) {
      document.querySelectorAll(selector).forEach((node) => {
        const text = normalizeWhitespace(node.textContent || "");
        if (text && text.length <= 240 && /(运费|物流|快递|配送|发货|shipping|delivery|freight)/i.test(text)) {
          texts.push(text);
        }
      });
      if (texts.length) break;
    }

    collectStringCandidates(sources, /(shipping|delivery|freight|logistics|postage|运费|物流|配送|发货)$/i)
      .slice(0, 10)
      .forEach((item) => {
        if (item.value && item.value.length <= 240) texts.push(item.value);
      });

    if (!texts.length) {
      const match = pageText.match(/(?:运费|物流|快递|配送|发货)[:：]?\s*([^\n。]{2,120})/);
      if (match && match[0]) texts.push(normalizeWhitespace(match[0]));
    }

    const text = Array.from(new Set(texts)).slice(0, 3).join(" / ");
    return {
      text,
      evidence: text ? "dom/json/text" : ""
    };
  }

  function pickCustomizationInfo(pageText, sources) {
    const texts = [];
    collectStringCandidates(sources, /(custom|customization|customized|定制|加工|印刷|贴牌|代工|OEM|ODM)$/i)
      .slice(0, 10)
      .forEach((item) => {
        if (item.value && item.value.length <= 240) texts.push(item.value);
      });
    const textMatch = pageText.match(/(?:支持)?(?:定制|贴牌|代工|OEM|ODM|加工)[:：]?\s*([^\n。]{0,120})/i);
    if (textMatch && textMatch[0]) texts.push(normalizeWhitespace(textMatch[0]));

    const text = Array.from(new Set(texts)).slice(0, 3).join(" / ");
    return {
      supported: text ? !/(不支持|无|否|not support)/i.test(text) : null,
      text,
      evidence: text ? "json/text" : ""
    };
  }

  function matchTextValue(text, pattern) {
    const match = String(text || "").match(pattern);
    return match && match[1] ? normalizeWhitespace(match[1]) : "";
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

  function pickDimensions(pageText, sources) {
    const candidates = [];
    const page = normalizeWhitespace(pageText);
    const combinedPattern = /(?:包装尺寸|产品尺寸|商品尺寸|外箱尺寸|尺寸|长宽高|规格)[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:x|X|×|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:x|X|×|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|毫米|cm|厘米|m|米|inch|in|英寸)?/ig;
    let match;
    while ((match = combinedPattern.exec(page)) && candidates.length < 8) {
      candidates.push({
        rawText: normalizeWhitespace(match[0]),
        length: match[1],
        width: match[2],
        height: match[3],
        unit: match[4] || ""
      });
    }

    const labelledMatch = page.match(/长(?:度)?[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|毫米|cm|厘米|m|米|inch|in|英寸)?[\s,，;；/]+宽(?:度)?[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|毫米|cm|厘米|m|米|inch|in|英寸)?[\s,，;；/]+高(?:度)?[:：]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|毫米|cm|厘米|m|米|inch|in|英寸)?/i);
    if (labelledMatch) {
      candidates.push({
        rawText: normalizeWhitespace(labelledMatch[0]),
        length: labelledMatch[1],
        width: labelledMatch[3],
        height: labelledMatch[5],
        unit: labelledMatch[2] || labelledMatch[4] || labelledMatch[6] || ""
      });
    }

    collectStringCandidates(sources, /(dimension|dimensions|size|packageSize|package_size|length|width|height|尺寸|长宽高|包装尺寸|商品尺寸)$/i)
      .slice(0, 20)
      .forEach((item) => {
        const text = normalizeWhitespace(item.value);
        const dim = parseDimensionText(text);
        if (dim) candidates.push({ ...dim, rawText: text, path: item.path });
      });

    collectStructuredDimensionCandidates(sources).forEach((item) => candidates.push(item));

    const hit = candidates
      .map((item) => normalizeDimensionCandidate(item))
      .find((item) => item.lengthMm && item.widthMm && item.heightMm);
    return hit || { lengthMm: null, widthMm: null, heightMm: null, rawText: "", candidates: candidates.slice(0, 10) };
  }

  function collectStructuredDimensionCandidates(sources) {
    const results = [];
    sources.forEach((source) => {
      walkObject(source, [], (value, path) => {
        if (!value || typeof value !== "object" || Array.isArray(value) || results.length >= 10) {
          return;
        }

        const fields = {};
        Object.keys(value).forEach((key) => {
          const field = classifyDimensionKey(key);
          if (!field || fields[field]) {
            return;
          }

          const parsed = parseDecimalNumber(value[key]);
          if (parsed != null && parsed > 0) {
            fields[field] = { key, value: value[key] };
          }
        });

        if (!fields.length || !fields.width || !fields.height) {
          return;
        }

        const unitText = normalizeWhitespace([
          value.unit,
          value.units,
          value.dimensionUnit,
          value.dimensionsUnit,
          value.lengthUnit,
          value.sizeUnit,
          fields.length.value,
          fields.width.value,
          fields.height.value
        ].filter(Boolean).join(" "));
        const unit = guessLengthUnit(unitText);
        const rawText = `${fields.length.value}x${fields.width.value}x${fields.height.value}${unit || ""}`;
        results.push({
          rawText,
          length: fields.length.value,
          width: fields.width.value,
          height: fields.height.value,
          unit,
          path: path.join(".")
        });
      });
    });
    return results;
  }

  function classifyDimensionKey(key) {
    const raw = String(key || "");
    const compact = raw.replace(/[\s_\-]/g, "").toLowerCase();
    if (/^(length|packagelength|productlength|itemlength|goodsLength|boxlength|cartonlength)$/i.test(raw) || /(长度|长)$/.test(raw)) {
      return "length";
    }
    if (/^(width|packagewidth|productwidth|itemwidth|goodswidth|boxwidth|cartonwidth)$/i.test(raw) || /(宽度|宽)$/.test(raw)) {
      return "width";
    }
    if (/^(height|packageheight|productheight|itemheight|goodsheight|boxheight|cartonheight)$/i.test(raw) || /(高度|高)$/.test(raw)) {
      return "height";
    }
    if (/(?:package|product|item|goods|box|carton)(?:length|width|height)$/.test(compact)) {
      if (compact.endsWith("length")) return "length";
      if (compact.endsWith("width")) return "width";
      if (compact.endsWith("height")) return "height";
    }
    return "";
  }

  function parseDimensionText(text) {
    const combined = String(text || "").match(/([0-9]+(?:\.[0-9]+)?)\s*(?:x|X|×|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:x|X|×|\*)\s*([0-9]+(?:\.[0-9]+)?)\s*(mm|毫米|cm|厘米|m|米|inch|in|英寸)?/i);
    if (combined) {
      return { length: combined[1], width: combined[2], height: combined[3], unit: combined[4] || "" };
    }
    return null;
  }

  function normalizeDimensionCandidate(candidate) {
    const unit = candidate && candidate.unit ? String(candidate.unit) : "";
    const lengthMm = convertLengthToMm(candidate && candidate.length, unit);
    const widthMm = convertLengthToMm(candidate && candidate.width, unit);
    const heightMm = convertLengthToMm(candidate && candidate.height, unit);
    return {
      lengthMm,
      widthMm,
      heightMm,
      rawText: candidate && candidate.rawText ? candidate.rawText : "",
      unit,
      candidates: [candidate].filter(Boolean)
    };
  }

  function convertLengthToMm(value, unitHint) {
    const parsed = parseDecimalNumber(value);
    if (parsed == null || parsed <= 0) return null;
    const unit = String(unitHint || "").toLowerCase();
    if (unit.includes("mm") || unit.includes("毫米")) return Math.round(parsed);
    if (unit.includes("cm") || unit.includes("厘米")) return Math.round(parsed * 10);
    if (unit === "m" || unit.includes("米")) return Math.round(parsed * 1000);
    if (unit.includes("inch") || unit === "in" || unit.includes("英寸")) return Math.round(parsed * 25.4);
    return Math.round(parsed);
  }

  function guessLengthUnit(text) {
    const unitText = String(text || "").toLowerCase();
    if (unitText.includes("mm") || unitText.includes("毫米")) return "mm";
    if (unitText.includes("cm") || unitText.includes("厘米")) return "cm";
    if (unitText.includes("inch") || unitText.includes("英寸")) return "inch";
    if (/(^|[^a-z])m([^a-z]|$)/i.test(unitText) || unitText.includes("米")) return "m";
    return "";
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
      return pickSkuItemsFromDom();
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

    return unique.length ? unique.slice(0, 200) : pickSkuItemsFromDom();
  }

  function normalizeSkuItem(item) {
    const skuId = pickFirstValue(item, ["skuId", "sku_id", "id", "offerId", "specId", "nameId"]);
    const name = pickFirstValue(item, ["name", "title", "skuName", "sku_name", "displayName"]);
    const attrs = normalizeSkuAttrs(item);
    const specText = [
      pickFirstValue(item, ["spec", "specText", "specValue", "skuSpec", "attributeValue"]),
      Object.keys(attrs).length ? Object.entries(attrs).map(([key, value]) => `${key}: ${value}`).join(" / ") : "",
      Array.isArray(item.attributes) ? item.attributes.map((entry) => {
        if (entry && typeof entry === "object") {
          const key = pickFirstValue(entry, ["name", "key", "attrName", "title"]);
          const value = pickFirstValue(entry, ["value", "attrValue", "text", "content"]);
          return key && value ? `${key}: ${value}` : "";
        }
        return String(entry || "");
      }).filter(Boolean).join(" / ") : ""
    ]
      .filter(Boolean)
      .join(" / ");
    const price = parseLooseNumber(pickFirstValue(item, ["price", "salePrice", "finalPrice", "discountPrice", "promotionPrice"]));
    const stock = parseLooseNumber(pickFirstValue(item, ["stock", "stockNum", "canBookCount", "quantity", "qty", "amountOnSale"]));
    const minOrderQty = parseLooseNumber(pickFirstValue(item, ["minOrderQty", "minOrderQuantity", "minimumOrderQuantity", "moq", "beginAmount", "startQuantity"]));
    const weightRaw = pickFirstValue(item, ["grossWeight", "weight", "weightGram", "skuWeight", "freightWeight"]);
    const grossWeightGrams = convertWeightToGrams(weightRaw, guessWeightUnit(weightRaw));

    return {
      skuId: skuId == null ? "" : String(skuId),
      name: name == null ? "" : String(name),
      attrs,
      specText,
      price,
      stock,
      minOrderQty,
      grossWeightGrams
    };
  }

  function normalizeSkuAttrs(item) {
    const output = {};
    const directAttrs = pickFirstValue(item, ["attrs", "attributes", "skuAttributes", "skuAttrs", "specAttrs", "props", "properties"]);
    const addPair = (key, value) => {
      const name = normalizeWhitespace(key);
      const text = normalizeWhitespace(value);
      if (name && text && name.length <= 80 && text.length <= 120) {
        output[name] = text;
      }
    };

    if (directAttrs && typeof directAttrs === "object" && !Array.isArray(directAttrs)) {
      Object.entries(directAttrs).forEach(([key, value]) => {
        if (value && typeof value === "object") {
          addPair(
            pickFirstValue(value, ["name", "key", "attrName", "title"]) || key,
            pickFirstValue(value, ["value", "attrValue", "text", "content", "name"]) || ""
          );
        } else {
          addPair(key, value);
        }
      });
    }

    if (Array.isArray(directAttrs)) {
      directAttrs.forEach((entry) => {
        if (!entry || typeof entry !== "object") return;
        addPair(
          pickFirstValue(entry, ["name", "key", "attrName", "title"]),
          pickFirstValue(entry, ["value", "attrValue", "text", "content"])
        );
      });
    }

    ["color", "colour", "颜色", "size", "尺码", "型号", "规格"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(item || {}, key)) {
        addPair(key, item[key]);
      }
    });

    return output;
  }

  function pickSkuItemsFromDom() {
    const nodes = document.querySelectorAll(
      "[data-sku-id], [data-sku], [class*='sku'] button, [class*='sku'] li, [class*='Sku'] button, [class*='Sku'] li"
    );
    const items = [];
    const seen = new Set();
    nodes.forEach((node) => {
      if (items.length >= 200) return;
      const skuId = normalizeWhitespace(
        node.getAttribute("data-sku-id") ||
        node.getAttribute("data-sku") ||
        node.getAttribute("data-id") ||
        ""
      );
      const text = normalizeWhitespace(
        node.getAttribute("title") ||
        node.getAttribute("aria-label") ||
        node.textContent ||
        ""
      );
      const specText = text && text.length <= 80 ? text : "";
      if (!skuId && !specText) return;
      if (!skuId && /(加入|购买|收藏|客服|价格|库存|起订|查看|确定|取消|立即|购物车|采购|数量|批发)/.test(specText)) {
        return;
      }
      const key = skuId || specText;
      if (seen.has(key)) return;
      seen.add(key);
      items.push({
        skuId: skuId || `dom-sku-${items.length + 1}`,
        name: "",
        attrs: specText ? { 规格: specText } : {},
        specText,
        price: null,
        stock: null,
        minOrderQty: null,
        grossWeightGrams: null
      });
    });
    return items;
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
    const seen = new Set();
    const addAttr = (name, value) => {
      const key = normalizeWhitespace(name);
      const text = normalizeWhitespace(value);
      if (!key || !text || key.length > 80 || text.length > 240) return;
      const signature = `${key}=${text}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      attrs.push({ name: key, value: text });
    };

    document.querySelectorAll("table tr, [class*='attribute'] li, [class*='attributes'] li, [class*='property'] li, [class*='props'] li, [class*='参数'] li, [class*='属性'] li").forEach((row) => {
      const cells = Array.from(row.querySelectorAll("th,td,span,div"))
        .map((node) => normalizeWhitespace(node.textContent || ""))
        .filter(Boolean);
      if (cells.length >= 2) {
        addAttr(cells[0], cells.slice(1).join(" "));
        return;
      }
      const text = normalizeWhitespace(row.textContent || "");
      const parts = text.split(/[:：]/);
      if (parts.length >= 2) {
        addAttr(parts.shift(), parts.join(":"));
      }
    });

    const pairs = collectObjectCandidates(sources, /(attribute|spec|property|props|参数|属性)/i).slice(0, 20);

    pairs.forEach((item) => {
      if (Array.isArray(item.value)) {
        item.value.forEach((row) => {
          if (row && typeof row === "object") {
            const name = pickFirstValue(row, ["name", "key", "attrName", "title"]);
            const value = pickFirstValue(row, ["value", "attrValue", "text", "content"]);
            addAttr(name, value);
          }
        });
        return;
      }
      if (item.value && typeof item.value === "object") {
        Object.entries(item.value).forEach(([key, value]) => {
          if (value && typeof value === "object") {
            addAttr(
              pickFirstValue(value, ["name", "key", "attrName", "title"]) || key,
              pickFirstValue(value, ["value", "attrValue", "text", "content"]) || ""
            );
          } else {
            addAttr(key, value);
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

  function parseDecimalNumber(input) {
    if (input == null || input === "") return null;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    const match = String(input).replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
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
