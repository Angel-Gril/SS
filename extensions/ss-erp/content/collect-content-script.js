(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
  const BRIDGE_ID = "spb-self-hosted-page-bridge";
  const PAGE_STATE_TIMEOUT_MS = 8000;
  const OZON_PANEL_ID = "spb-self-hosted-ozon-panel";
  const SourceProductCore = globalThis.SS_ERP_SOURCE_PRODUCT_CORE || {};
  const detectPlatform = SourceProductCore.detectPlatform;
  const parseLooseNumber = SourceProductCore.parseLooseNumber;
  const formatMoney = SourceProductCore.formatMoney;
  const convertWeightToGrams = SourceProductCore.convertWeightToGrams;
  const guessWeightUnit = SourceProductCore.guessWeightUnit;
  const normalizeWhitespace = SourceProductCore.normalizeWhitespace;
  const collectDataSources = SourceProductCore.collectDataSources;
  const collectStringCandidates = SourceProductCore.collectStringCandidates;
  const collectObjectCandidates = SourceProductCore.collectObjectCandidates;
  const collectNumberCandidates = SourceProductCore.collectNumberCandidates;
  const summarizeSources = SourceProductCore.summarizeSources;
  const walkObject = SourceProductCore.walkObject;
  const hasAnyKey = SourceProductCore.hasAnyKey;
  const pickFirstValue = SourceProductCore.pickFirstValue;
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

  function shouldLogOzonDebug() {
    try {
      return globalThis.localStorage && localStorage.getItem("ss_erp_debug_ozon_collect") === "1";
    } catch (e) {
      return false;
    }
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

    const productPath = normalizeOzonProductPathForFetch(location.href, productId);
    const data = await fetchOzonWidgetJson("/api/entrypoint-api.bx/page/json/v2?url=" + encodeURIComponent(productPath));
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
    let richDescriptionJson = null;
    const sourceVideos = [];
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
      if (/^(webDescription|webRichAnnotation|description)/.test(k) && st) {
        const descriptionPayload = extractDescriptionPayload(st);
        if (descriptionPayload.text && (!description || descriptionPayload.text.length > description.length)) {
          description = descriptionPayload.text;
        }
        if (!richDescriptionJson && descriptionPayload.richJson) {
          richDescriptionJson = descriptionPayload.richJson;
        }
      }
      extractVideos(k, st, sourceVideos);
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

    try {
      const descriptionData = await fetchOzonDescriptionWidgetJson(productId, productPath);
      const descriptionStates = descriptionData && descriptionData.widgetStates;
      if (descriptionStates && typeof descriptionStates === "object") {
        for (const dKey of Object.keys(descriptionStates)) {
          let dState;
          try { dState = JSON.parse(descriptionStates[dKey]); } catch (e) { continue; }
          if (/^(webDescription|webRichAnnotation|description)/.test(dKey) && dState) {
            const descriptionPayload = extractDescriptionPayload(dState);
            if (descriptionPayload.text && (!description || descriptionPayload.text.length > description.length)) {
              description = descriptionPayload.text;
            }
            if (!richDescriptionJson && descriptionPayload.richJson) {
              richDescriptionJson = descriptionPayload.richJson;
            }
          }
          extractVideos(dKey, dState, sourceVideos);
          if (/^(webShortCharacteristics|webCharacteristics|characteristics)/.test(dKey) && dState && Array.isArray(dState.characteristics)) {
            for (const ch of dState.characteristics) {
              let nm = "";
              if (ch.title && Array.isArray(ch.title.textRs) && ch.title.textRs.length) {
                nm = ch.title.textRs[0].content || "";
              } else if (typeof ch.title === "string") {
                nm = ch.title;
              } else if (ch.name) {
                nm = ch.name;
              }
              let vl = "";
              if (Array.isArray(ch.values)) {
                vl = ch.values.map(v => (v.text || v.value || "").replace(/,\s*$/, "")).filter(Boolean).join(", ");
              }
              if (nm && vl && !attributes.some(attr => attr.name === nm && attr.value === vl)) {
                attributes.push({ name: nm, value: vl });
              }
            }
          }
        }
      }
    } catch (e) {}

    currency = detectCurrencyFromTextSafe(priceString, currency);

    if (!currency) {
      currency = fallbackCurrencyByHostSafe(location.hostname);
    }

    for (const a of attributes) {
      if (!brand && /бренд|brand|Бренд/i.test(a.name)) brand = a.value;
    }

    const variantsResult = extractOzonVariants(widgets, productId, currency);
    if (variantsResult.dump && shouldLogOzonDebug()) {
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
      description: typeof description === "string" ? description.slice(0, 5000) : "",
      richDescriptionJson: richDescriptionJson ? JSON.stringify(richDescriptionJson).slice(0, 30000) : null,
      sourceVideos: sourceVideos.length ? sourceVideos : null,
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

  async function fetchOzonWidgetJson(url) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { "x-o3-app-name": "dweb_client", "accept": "application/json", "x-o3-language": "ru", "Accept-Language": "ru" }
    });
    if (!res.ok) {
      throw new Error("Ozon API HTTP " + res.status);
    }
    return res.json();
  }

  function normalizeOzonProductPathForFetch(value, fallbackProductId) {
    let path = "";
    const raw = String(value || "").trim();
    if (raw) {
      try {
        const url = new URL(raw, "https://www.ozon.ru");
        if (/^\/product\//i.test(url.pathname)) path = url.pathname + url.search;
      } catch (e) {}
    }
    if (!path) path = "/product/" + fallbackProductId + "/";
    try {
      const parsed = new URL(path, "https://www.ozon.ru");
      parsed.searchParams.set("language", "ru");
      return parsed.pathname + parsed.search;
    } catch (e) {
      return path.indexOf("?") >= 0 ? path + "&language=ru" : path + "?language=ru";
    }
  }

  async function fetchOzonDescriptionWidgetJson(productId, productPath) {
    const bases = [];
    const addBase = (value) => {
      let base = String(value || "").split("?")[0];
      if (!base || !/^\/product\//i.test(base)) return;
      if (!/\/$/.test(base)) base += "/";
      if (!bases.includes(base)) bases.push(base);
    };
    addBase(productPath);
    addBase("/product/" + productId + "/");
    for (const base of bases) {
      const descriptionPath = base + "?layout_container=pdpPage2column&layout_page_index=2&oos_search=false&language=ru";
      try {
        const data = await fetchOzonWidgetJson("/api/entrypoint-api.bx/page/json/v2?url=" + encodeURIComponent(descriptionPath));
        const states = data && data.widgetStates;
        if (states && typeof states === "object" && Object.keys(states).some(k => /^(webDescription|webRichAnnotation|description)/.test(k))) {
          return data;
        }
      } catch (e) {}
    }
    return null;
  }

  function isStructuredRichValue(value, depth = 0) {
    if (value == null || depth > 5) return false;
    if (Array.isArray(value)) {
      return value.some((item) => isStructuredRichValue(item, depth + 1));
    }
    if (typeof value !== "object") return false;
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:richannotationjson|richannotation|content|blocks|children|items|nodes|widgets|gallery|img|image|picture|text|description|title)$/i.test(key)) {
        return true;
      }
      if (isStructuredRichValue(child, depth + 1)) return true;
    }
    return false;
  }

  function pickRichJsonCandidate(state) {
    const objectCandidates = [
      { key: "richAnnotationJson", value: state?.richAnnotationJson },
      { key: "richAnnotation", value: state?.richAnnotation },
      { key: "content", value: state?.content },
      { key: "description", value: state?.description },
      { key: "blocks", value: state?.blocks },
      { key: "items", value: state?.items },
      { key: "children", value: state?.children },
      { key: "nodes", value: state?.nodes },
      { key: "widgets", value: state?.widgets },
    ];
    for (const entry of objectCandidates) {
      const candidate = entry.value;
      if ((candidate && typeof candidate === "object") || Array.isArray(candidate)) {
        if (!isStructuredRichValue(candidate, 0)) continue;
        if (entry.key === "richAnnotationJson" || entry.key === "richAnnotation") return candidate;
        if (Array.isArray(candidate)) return { [entry.key]: candidate };
        return candidate;
      }
    }
    return null;
  }

  function extractDescriptionPayload(state) {
    const richJson = pickRichJsonCandidate(state);
    const candidates = [
      state.richAnnotation,
      state.description,
      state.text,
      state.content,
      state.blocks,
      richJson
    ];
    let text = "";
    for (const candidate of candidates) {
      const next = extractTextFromRichValue(candidate);
      if (next && next.length > text.length) text = next;
    }
    return { text, richJson };
  }

  function extractVideos(key, state, target) {
    if (!state || typeof state !== "object") return;
    if (!/(video|видео|gallery|media|rich)/i.test(key)) return;
    visitVideoValue(state, target, new Set(), 0);
  }

  function visitVideoValue(value, target, seen, depth) {
    if (value == null || depth > 8 || target.length >= 10) return;
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visitVideoValue(item, target, seen, depth + 1);
      return;
    }

    const url = pickVideoUrl(value);
    if (url) addSourceVideo(target, {
      url,
      coverUrl: pickCoverUrl(value),
      title: pickVideoTitle(value)
    });

    for (const child of Object.values(value)) {
      visitVideoValue(child, target, seen, depth + 1);
    }
  }

  function pickVideoUrl(obj) {
    for (const field of ["videoUrl", "videoURL", "video", "mp4", "hls", "src", "url", "link"]) {
      const raw = obj && obj[field];
      if (typeof raw === "string" && isVideoUrl(raw)) return raw.trim();
    }
    return "";
  }

  function pickCoverUrl(obj) {
    for (const field of ["coverUrl", "coverURL", "coverImage", "cover", "poster", "preview", "thumbnail", "image", "src"]) {
      const raw = obj && obj[field];
      if (typeof raw === "string" && isHttpUrl(raw) && !isVideoUrl(raw)) return raw.trim();
    }
    return "";
  }

  function pickVideoTitle(obj) {
    const raw = obj && (obj.title || obj.name || obj.caption);
    return typeof raw === "string" ? normalizeWhitespace(raw).slice(0, 200) : "";
  }

  function addSourceVideo(target, entry) {
    if (!entry || !entry.url || !isHttpUrl(entry.url)) return;
    if (target.some((video) => video.url === entry.url)) return;
    const next = { url: entry.url };
    if (entry.coverUrl && isHttpUrl(entry.coverUrl)) next.coverUrl = entry.coverUrl;
    if (entry.title) next.title = entry.title;
    target.push(next);
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || "").trim());
  }

  function isVideoUrl(value) {
    const text = String(value || "").trim();
    return isHttpUrl(text) && (/\.(?:mp4|m3u8|webm|mov)(?:[?#].*)?$/i.test(text) || /(?:stream|playlist)/i.test(text));
  }

  function extractTextFromRichValue(value) {
    const parts = [];
    const seen = new Set();
    visitRichValue(value, parts, seen, 0);
    return normalizeWhitespace(parts.join("\n")).slice(0, 5000);
  }

  function visitRichValue(value, parts, seen, depth) {
    if (value == null || depth > 8) return;
    if (typeof value === "string") {
      const text = normalizeWhitespace(value);
      if (text) parts.push(text);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visitRichValue(item, parts, seen, depth + 1);
      return;
    }
    const preferredKeys = ["content", "text", "value", "title", "description", "children", "items", "blocks", "nodes"];
    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        visitRichValue(value[key], parts, seen, depth + 1);
      }
    }
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
        const specHelper = globalThis.SS_ERP_OZON_VARIANT_SPEC;
        if (specHelper && typeof specHelper.buildOzonVariantsFromWebAspects === "function") {
          const parsedVariants = specHelper.buildOzonVariantsFromWebAspects(state, {
            normalizeImage: normalizeOzonCollectedImageUrl,
            parsePriceText: (priceText) => parsePriceWithCurrencySafe(priceText, currency),
          });
          if (typeof specHelper.mergeOzonVariantLists === "function") {
            variants = specHelper.mergeOzonVariantLists(variants, parsedVariants).variants;
          } else {
            variants = parsedVariants;
          }
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
            读取商品数据中...
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

    status.style.display = "none";
    status.textContent = "";

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
    const shopName = pickFirstDomText(config.shopSelectors) || pickStringByKey(context.sources, /(shopName|sellerName|companyName|storeName|supplierName)$/i);
    const productId = pickProductId(config.productIdRegexes, context.sources);
    const title = pickTitle(config.titleSelectors, context.sources, {
      platform: context.platform,
      productId,
      shopName
    });
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
    const skuItems = pickSkuItems(context.sources, context.pageText);
    const skuCount = skuItems.length || pickSkuCountFromDom();
    const grossWeightGrams = pickGrossWeight(context.pageText, context.sources, config.weightKeywords, skuItems);
    const images = pickImages(context.sources);
    const attributes = pickAttributes(context.sources, context.pageText);
    const categoryPath = pickCategoryPath(context.sources);
    const dimensions = pickDimensions(context.pageText, context.sources);
    const description = pickSourceDescription(context.sources, context.pageText);
    const sourceVideos = pickSourceVideos(context.sources);
    const extractionDiagnostics = buildSourceExtractionDiagnostics({
      title,
      images,
      skuItems,
      attributes,
      description,
      sourceVideos
    });

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
      weightG: grossWeightGrams,
      lengthMm: dimensions.lengthMm || undefined,
      widthMm: dimensions.widthMm || undefined,
      heightMm: dimensions.heightMm || undefined,
      dimensionsMm: dimensions.lengthMm && dimensions.widthMm && dimensions.heightMm ? dimensions : null,
      categoryPath,
      categoryName: categoryPath.length ? categoryPath[categoryPath.length - 1] : "",
      description,
      sourceVideos,
      extractionDiagnostics,
      skuCount,
      skuItems,
      variants: skuItems,
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

  function buildSourceExtractionDiagnostics(input) {
    return {
      titleFound: Boolean(normalizeWhitespace(input && input.title || "")),
      imageCount: Array.isArray(input && input.images) ? input.images.length : 0,
      skuCount: Array.isArray(input && input.skuItems) ? input.skuItems.length : 0,
      attributeCount: Array.isArray(input && input.attributes) ? input.attributes.length : 0,
      descriptionFound: Boolean(normalizeWhitespace(input && input.description || "")),
      videoCount: Array.isArray(input && input.sourceVideos) ? input.sourceVideos.length : 0
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

    const skuItems = pickSkuItems(context.sources, context.pageText);
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
    const selectedRow = pickSelectedSkuRowForSummary(context, summary);
    const selectedSku = selectedRow
      ? {
          ...selectedRow,
          price: summary.unitPrice,
          priceText: "¥" + formatMoney(summary.unitPrice),
          selected: true,
          quantity: summary.quantity,
          productAmount: summary.productAmount,
          shippingCny: summary.shipping != null ? summary.shipping : (summary.shippingFree ? 0 : null),
          shippingFree: summary.shippingFree
        }
      : {
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
        };
    return {
      price: summary.unitPrice,
      currency: "CNY",
      text: "¥" + formatMoney(summary.unitPrice),
      sourceType: "selectedOrderSummary",
      shippingCny: summary.shipping != null ? summary.shipping : (summary.shippingFree ? 0 : null),
      shippingText: summary.sample,
      shippingFree: summary.shippingFree,
      selectedSku
    };
  }

  function pickSelectedSkuRowForSummary(context, summary) {
    const rows = collectDomSkuPriceRows(context && context.pageText);
    if (!rows.length) return null;
    const matchesSummaryPrice = (row) => Math.abs((Number(row.price) || 0) - (Number(summary && summary.unitPrice) || 0)) < 0.01;
    return rows.find((row) => row.selected && matchesSummaryPrice(row))
      || rows.find((row) => row.selected)
      || rows.find(matchesSummaryPrice)
      || null;
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

  function pickTitle(selectors, sources, context) {
    const domTitle = pickFirstDomText(selectors);
    if (domTitle && !isLikelyShopTitle(domTitle, context)) {
      return domTitle;
    }

    return (
      pickProductTitleByKey(sources, context) ||
      pickDocumentProductTitle(context) ||
      buildFallbackProductTitle(context)
    );
  }

  function pickProductTitleByKey(sources, context) {
    const candidates = collectStringCandidates(sources, /(title|name|subject|productName|offerTitle)$/i)
      .filter((item) => !/(companyName|shopName|sellerName|storeName|supplierName)$/i.test(item.path))
      .filter((item) => !isForeignOzonTitleCandidate(item, context))
      .filter((item) => !isLikelyShopTitle(item.value, context))
      .map((item) => ({ ...item, score: scoreProductTitlePath(item.path) }))
      .sort((a, b) => b.score - a.score || a.value.length - b.value.length);
    return candidates.length ? candidates[0].value : "";
  }

  function pickDocumentProductTitle(context) {
    const title = normalizeWhitespace(document.title || "");
    if (!title || isForeignOzonTitleText(title, context) || isLikelyShopTitle(title, context)) {
      return "";
    }
    return title;
  }

  function isLikelyShopTitle(value, context) {
    const text = normalizeWhitespace(value || "");
    const shopName = normalizeWhitespace(context && context.shopName || "");
    if (!text || !shopName) return false;
    if (text === shopName) return true;
    const compactText = text.replace(/\s+/g, "");
    const compactShop = shopName.replace(/\s+/g, "");
    return compactText === compactShop || (compactShop.length >= 6 && compactText.includes(compactShop));
  }

  function isForeignOzonTitleCandidate(item, context) {
    if (String(context && context.platform || "").toLowerCase() === "ozon") {
      return false;
    }
    const path = String(item && item.path || "").toLowerCase();
    if (/(^|\.|_)(ozon|ozonproduct|ozon_product)(\.|_|$)/.test(path)) {
      return true;
    }
    return isForeignOzonTitleText(item && item.value, context);
  }

  function isForeignOzonTitleText(value, context) {
    if (String(context && context.platform || "").toLowerCase() === "ozon") {
      return false;
    }
    const text = normalizeWhitespace(value || "");
    if (!text) {
      return false;
    }
    return /\bozon\b/i.test(text)
      && (/\bsku\b/i.test(text) || /跟卖|核价/.test(text) || /\bozon\b\D{0,16}\d{6,}/i.test(text));
  }

  function buildFallbackProductTitle(context) {
    const platform = String(context && context.platform || "source").toLowerCase();
    const productId = normalizeWhitespace(context && context.productId || "");
    const labels = {
      "1688": "1688 商品",
      pdd: "拼多多商品",
      taobao: "淘宝商品",
      tmall: "天猫商品",
      jd: "京东商品",
      temu: "Temu 商品",
      aliexpress: "AliExpress 商品",
      wb: "Wildberries 商品"
    };
    const label = labels[platform] || "货源商品";
    return productId ? `${label} ${productId}` : label;
  }

  function scoreProductTitlePath(path) {
    const text = String(path || "");
    if (/(subject|offerTitle|productName|goodsName|itemTitle)$/i.test(text)) return 10;
    if (/(title|name)$/i.test(text)) return 4;
    return 1;
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

  function pickSkuItems(sources, pageText) {
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
    const sourceItems = best ? best.value : [];
    const domItems = collectDomSkuPriceRows(pageText);
    const normalized = sourceItems
      .map((item) => normalizeSkuItem(item))
      .concat(domItems)
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
    const attrs = normalizeSkuAttrs(pickFirstValue(item, ["attrs", "attributes", "skuAttrs", "skuAttributes", "properties", "props"]));
    const specText = [
      pickFirstValue(item, ["spec", "specText", "specValue", "skuSpec", "attributeValue"]),
      Array.isArray(item.attributes) ? item.attributes.map((entry) => {
        if (entry && typeof entry === "object") {
          const attrName = pickFirstValue(entry, ["name", "key", "attrName", "title"]);
          const attrValue = pickFirstValue(entry, ["value", "attrValue", "text", "content"]);
          return attrName && attrValue ? (attrName + ":" + attrValue) : "";
        }
        return String(entry || "");
      }).filter(Boolean).join(" / ") : "",
      Object.keys(attrs).map((key) => key + ":" + attrs[key]).join(" / ")
    ]
      .filter(Boolean)
      .join(" / ");
    const price = parseLooseNumber(pickFirstValue(item, ["price", "salePrice", "finalPrice", "discountPrice", "promotionPrice"]));
    const stock = parseLooseNumber(pickFirstValue(item, ["stock", "stockNum", "canBookCount", "quantity", "qty", "amountOnSale"]));
    const weightRaw = pickFirstValue(item, ["grossWeight", "weight", "weightGram", "skuWeight", "freightWeight"]);
    const grossWeightGrams = convertWeightToGrams(weightRaw, guessWeightUnit(weightRaw));
    const images = normalizeImageValues([
      pickFirstValue(item, ["image", "imageUrl", "img", "pic", "picture", "photo"]),
      item.images,
      item.imageUrls,
      item.pictures,
      item.photos
    ]);

    return {
      skuId: skuId == null ? "" : String(skuId),
      name: name == null ? "" : String(name),
      specText,
      price,
      stock,
      grossWeightGrams,
      attrs,
      images
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
      const normalized = normalizeOzonCollectedImageUrl(src);
      if (isValidSourceProductImage(normalized)) {
        imageSet.add(normalized);
      }
    });

    collectStringCandidates(sources, /(image|img|photo|picture)/i)
      .slice(0, 100)
      .forEach((item) => {
        const value = item.value;
        const normalized = normalizeOzonCollectedImageUrl(value);
        if (isValidSourceProductImage(normalized)) {
          imageSet.add(normalized);
        }
      });

    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        const pathText = path.join(".");
        if (!/(image|img|photo|picture|gallery|detailImages|mainImage|主图|详情图)/i.test(pathText)) return;
        normalizeImageValues(value).forEach((image) => {
          const normalized = normalizeOzonCollectedImageUrl(image);
          if (isValidSourceProductImage(normalized)) imageSet.add(normalized);
        });
      });
    });

    return Array.from(imageSet).slice(0, 20);
  }

  function isValidSourceProductImage(url) {
    const text = String(url || "");
    if (!/^https?:\/\//i.test(text) || text.length >= 1000) return false;
    const lower = text.toLowerCase();
    if (/\.(svg)(?:[?#]|$)/i.test(lower)) return false;
    if (/(logo|icon|avatar|badge|coupon|qrcode|qr-code|play_btn|playbtn|operate|operation|\/cms\/)/i.test(lower)) return false;
    const sizeMatch = lower.match(/(?:[-_]|\/)(\d{1,4})[-x](\d{1,4})(?:[._/-]|$)/i);
    if (sizeMatch && (Number(sizeMatch[1]) < 200 || Number(sizeMatch[2]) < 200)) return false;
    return true;
  }

  function normalizeImageValues(value) {
    const images = [];
    const seen = new Set();
    function push(raw) {
      if (!raw) return;
      if (Array.isArray(raw)) {
        raw.forEach(push);
        return;
      }
      if (raw && typeof raw === "object") {
        push(raw.url || raw.src || raw.imageUrl || raw.imgUrl || raw.originalUrl || raw.picUrl || raw.coverUrl || raw.thumbnail);
        return;
      }
      const text = String(raw || "").trim();
      if (!/^https?:\/\//i.test(text) || seen.has(text)) return;
      seen.add(text);
      images.push(text);
    }
    push(value);
    return images.slice(0, 100);
  }

  function pickAttributes(sources, pageText) {
    const attrs = [];
    const pairs = collectObjectCandidates(sources, /(attribute|spec|property|properties|props|参数|属性)/i).slice(0, 20);

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

    pickDomAttributes(pageText).forEach((attr) => attrs.push(attr));

    const unique = [];
    const seen = new Set();
    attrs.forEach((attr) => {
      const key = normalizeWhitespace((attr.name || "") + ":" + (attr.value || ""));
      if (!key || seen.has(key)) return;
      seen.add(key);
      unique.push(attr);
    });

    return unique.slice(0, 50);
  }

  function pickDomAttributes(pageText) {
    const rows = [];
    if (typeof document !== "undefined" && document.querySelectorAll) {
      const selectors = [
        "[class*='attr'], [class*='Attr'], [class*='prop'], [class*='Prop'], [class*='param'], [class*='Param'], [class*='spec'], [class*='Spec'], [class*='属性'], [class*='参数']"
      ];
      selectors.forEach((selector) => {
        Array.from(document.querySelectorAll(selector) || []).slice(0, 120).forEach((node) => {
          const text = normalizeWhitespace(node && (node.innerText || node.textContent) || "");
          const attr = parseDomAttributeText(text);
          if (attr) rows.push(attr);
        });
      });
    }

    const text = normalizeWhitespace(pageText || "");
    const knownNames = ["品牌", "材质", "成分", "面料", "适用性别", "性别", "季节", "上市年份季节", "风格", "版型", "厚薄", "颜色", "尺码", "货号"];
    knownNames.forEach((name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(new RegExp(escaped + "\\s*[:：]?\\s*([^\\s，,；;]{1,40})"));
      if (match && match[1] && match[1] !== name) rows.push({ name, value: match[1] });
    });

    return rows;
  }

  function parseDomAttributeText(text) {
    const normalized = normalizeWhitespace(text || "");
    if (!normalized || normalized.length > 120) return null;
    const colon = normalized.match(/^([^:：]{1,20})[:：]\s*(.{1,80})$/);
    if (colon) return { name: colon[1].trim(), value: colon[2].trim() };
    const parts = normalized.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && parts[0].length <= 20) {
      return { name: parts[0], value: parts.slice(1).join(" ") };
    }
    return null;
  }

  function normalizeSkuAttrs(value) {
    const attrs = {};
    if (!value) return attrs;
    if (Array.isArray(value)) {
      value.forEach((row) => {
        if (!row || typeof row !== "object") return;
        const name = pickFirstValue(row, ["name", "key", "attrName", "title"]);
        const attrValue = pickFirstValue(row, ["value", "attrValue", "text", "content"]);
        if (name && attrValue) attrs[String(name)] = String(attrValue);
      });
      return attrs;
    }
    if (typeof value === "object") {
      Object.keys(value).forEach((key) => {
        const attrValue = value[key];
        if (attrValue != null && attrValue !== "" && typeof attrValue !== "object") {
          attrs[String(key)] = String(attrValue);
        }
      });
    }
    return attrs;
  }

  function pickCategoryPath(sources) {
    const candidates = [];
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        const pathText = path.join(".");
        if (!/(categoryPath|category_path|breadcrumb|crumb|catPath|类目|分类)/i.test(pathText)) return;
        const normalized = normalizeCategoryPath(value);
        if (normalized.length) candidates.push(normalized);
      });
    });
    candidates.sort((a, b) => b.length - a.length);
    return candidates.length ? candidates[0].slice(0, 8) : [];
  }

  function normalizeCategoryPath(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (item && typeof item === "object") {
          return normalizeWhitespace(item.name || item.title || item.text || item.value || item.categoryName || "");
        }
        return normalizeWhitespace(item);
      }).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(/>|\/|»|›|,/).map(normalizeWhitespace).filter(Boolean);
    }
    if (typeof value === "object") {
      return normalizeCategoryPath(value.path || value.items || value.list || value.breadcrumbs || value.name);
    }
    return [];
  }

  function pickDimensions(pageText, sources) {
    const textHit = pickDimensionsFromText(pageText);
    if (textHit.lengthMm && textHit.widthMm && textHit.heightMm) return textHit;

    const candidates = [];
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        const pathText = path.join(".");
        if (!/(size|dimension|package|volume|spec|规格|尺寸|包装)/i.test(pathText) && !hasAnyKey(value, /(length|width|height|长|宽|高)/i)) return;
        const unit = pickFirstValue(value, ["unit", "sizeUnit", "dimensionUnit"]) || "";
        const lengthMm = dimensionToMm(pickFirstValue(value, ["length", "len", "depth", "long", "l", "长"]), unit);
        const widthMm = dimensionToMm(pickFirstValue(value, ["width", "wid", "w", "宽"]), unit);
        const heightMm = dimensionToMm(pickFirstValue(value, ["height", "hgt", "h", "高"]), unit);
        if (lengthMm && widthMm && heightMm) candidates.push({ lengthMm, widthMm, heightMm });
      });
    });
    return candidates.length ? candidates[0] : { lengthMm: 0, widthMm: 0, heightMm: 0 };
  }

  function pickDimensionsFromText(value) {
    const text = normalizeWhitespace(value || "");
    const match = text.match(/(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米)?/i);
    if (!match) return { lengthMm: 0, widthMm: 0, heightMm: 0 };
    const unit = match[4] || "cm";
    return {
      lengthMm: dimensionToMm(match[1], unit),
      widthMm: dimensionToMm(match[2], unit),
      heightMm: dimensionToMm(match[3], unit)
    };
  }

  function dimensionToMm(value, unitHint) {
    const number = Number(String(value == null ? "" : value).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(number) || number <= 0) return 0;
    const unit = String(unitHint || value || "").toLowerCase();
    if (/mm|毫米/.test(unit)) return Math.round(number);
    if (/m\b|米/.test(unit) && !/cm|mm/.test(unit)) return Math.round(number * 1000);
    return Math.round(number * 10);
  }

  function pickSourceDescription(sources, pageText) {
    const candidates = [];
    if (typeof document !== "undefined" && document.querySelectorAll) {
      const selectors = [
        "[class*='description'], [class*='Description'], [class*='desc'], [class*='Desc'], [class*='detail'], [class*='Detail'], [class*='详情'], [class*='描述']"
      ];
      selectors.forEach((selector) => {
        Array.from(document.querySelectorAll(selector) || []).slice(0, 30).forEach((node) => {
          const text = normalizeWhitespace(node && (node.innerText || node.textContent) || "");
          if (isLikelySourceDescription(text)) candidates.push(text);
        });
      });
    }
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        if (typeof value !== "string") return;
        const pathText = path.join(".");
        if (!/(description|desc|detail|content|介绍|详情|描述)/i.test(pathText)) return;
        const text = normalizeWhitespace(value);
        if (isLikelySourceDescription(text)) candidates.push(text);
      });
    });
    if (!candidates.length) {
      const text = normalizeWhitespace(pageText || "");
      const match = text.match(/(?:商品描述|产品描述|详情描述|描述|介绍)[:：]?\s*(.{20,500})/);
      if (match && isLikelySourceDescription(match[1])) candidates.push(match[1]);
    }
    candidates.sort((a, b) => b.length - a.length);
    return candidates.length ? candidates[0].slice(0, 5000) : "";
  }

  function isLikelySourceDescription(text) {
    const value = normalizeWhitespace(text || "");
    if (!value || /^https?:\/\//i.test(value)) return false;
    if (value.length < 12 || value.length > 8000) return false;
    if (/^(¥|￥)?\d+(?:\.\d+)?$/.test(value)) return false;
    return true;
  }

  function pickSourceVideos(sources) {
    const videos = [];
    const seen = new Set();
    function add(entry) {
      const url = entry && (entry.url || entry.videoUrl || entry.src || entry.link);
      if (!isVideoUrl(url) || seen.has(url)) return;
      seen.add(url);
      const next = { url: String(url).trim() };
      const coverUrl = entry.coverUrl || entry.cover || entry.poster || entry.preview || entry.thumbnail || "";
      const title = normalizeWhitespace(entry.title || entry.name || entry.caption || "");
      if (/^https?:\/\//i.test(String(coverUrl))) next.coverUrl = String(coverUrl).trim();
      if (title) next.title = title.slice(0, 200);
      videos.push(next);
    }
    (Array.isArray(sources) ? sources : []).forEach((source) => {
      walkObject(source, [], (value, path) => {
        const pathText = path.join(".");
        if (!/(video|media|视频)/i.test(pathText)) return;
        if (typeof value === "string" && isVideoUrl(value)) add({ url: value });
        if (value && typeof value === "object") add(value);
      });
    });
    return videos.slice(0, 10);
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

})();
