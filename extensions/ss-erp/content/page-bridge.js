(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
  const DETECTED_GLOBAL_NAME_LIMIT = 80;
  const DETECTED_GLOBAL_RESULT_LIMIT = 20;
  const KNOWN_GLOBAL_VALUE_BYTES_LIMIT = 500000;
  const KNOWN_GLOBALS_BYTES_LIMIT = 2000000;
  const INLINE_SCRIPT_SCAN_LIMIT = 60;
  const INLINE_SCRIPT_BYTES_LIMIT = 500000;
  const INLINE_RESULT_LIMIT = 12;
  const INLINE_RESULTS_BYTES_LIMIT = 2000000;
  const INLINE_VIDEO_URL_LIMIT = 50;
  const GLOBAL_NAMES = [
    "rawData",
    "__NEXT_DATA__",
    "__INITIAL_STATE__",
    "__INIT_DATA__",
    "__NUXT__",
    "__PRELOADED_STATE__",
    "__APP_DATA__",
    "__INITIAL_DATA__",
    "__GLOBAL_DATA__",
    "__ICE_APP_DATA__",
    "__APOLLO_STATE__",
    "context",
    "pageData",
    "globalData",
    "offerDetailData",
    "iDetailData",
    "detailData",
    "offerData",
    "skuModel",
    "skuMap"
  ];

  function safeClone(value) {
    if (value == null) {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      try {
        return structuredClone(value);
      } catch (_error2) {
        return null;
      }
    }
  }

  function utf8ByteLength(value) {
    const text = String(value || "");
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(text).byteLength;
    }
    return unescape(encodeURIComponent(text)).length;
  }

  function pushTruncation(target, row) {
    target.push({
      stage: "page_bridge",
      fieldPath: row.fieldPath,
      observedCount: row.observedCount,
      retainedCount: row.retainedCount,
      limit: row.limit,
      unit: row.unit,
      reason: row.reason,
      recoverability: row.recoverability,
      fallbackSourcePath: row.fallbackSourcePath || null,
    });
  }

  function jsonPointerSegment(value) {
    return String(value || "").replace(/~/g, "~0").replace(/\//g, "~1");
  }

  function serializedByteLength(value) {
    return utf8ByteLength(JSON.stringify(value));
  }

  function tryRetainKnownGlobal(rootResult, container, name, value, sourcePath, truncations) {
    const cloned = safeClone(value);
    if (cloned == null) return false;

    let valueBytes;
    try {
      valueBytes = serializedByteLength(cloned);
    } catch (_error) {
      pushTruncation(truncations, {
        fieldPath: sourcePath,
        observedCount: 1,
        retainedCount: 0,
        limit: KNOWN_GLOBAL_VALUE_BYTES_LIMIT,
        unit: "items",
        reason: "parse_failure",
        recoverability: "not_recoverable",
      });
      return false;
    }

    if (valueBytes > KNOWN_GLOBAL_VALUE_BYTES_LIMIT) {
      pushTruncation(truncations, {
        fieldPath: sourcePath,
        observedCount: valueBytes,
        retainedCount: 0,
        limit: KNOWN_GLOBAL_VALUE_BYTES_LIMIT,
        unit: "utf8_bytes",
        reason: "size_limit",
        recoverability: "reload_page",
      });
      return false;
    }

    container[name] = cloned;
    let aggregateBytes;
    try {
      aggregateBytes = serializedByteLength(rootResult);
    } catch (_error) {
      delete container[name];
      pushTruncation(truncations, {
        fieldPath: sourcePath,
        observedCount: 1,
        retainedCount: 0,
        limit: KNOWN_GLOBALS_BYTES_LIMIT,
        unit: "items",
        reason: "parse_failure",
        recoverability: "not_recoverable",
      });
      return false;
    }

    if (aggregateBytes > KNOWN_GLOBALS_BYTES_LIMIT) {
      delete container[name];
      pushTruncation(truncations, {
        fieldPath: "/pageState/knownGlobals",
        observedCount: aggregateBytes,
        retainedCount: serializedByteLength(rootResult),
        limit: KNOWN_GLOBALS_BYTES_LIMIT,
        unit: "utf8_bytes",
        reason: "size_limit",
        recoverability: "reload_page",
        fallbackSourcePath: sourcePath,
      });
      return false;
    }
    return true;
  }

  function directOfferId(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const candidate = value.offerId ?? value.offerID ?? value.productId ?? value.itemId ?? value.goodsId;
    return candidate == null ? "" : String(candidate).trim();
  }

  function collectOfferIds(value, ids, depth, budget) {
    if (!value || typeof value !== "object" || depth > 16 || budget.remaining <= 0 || ids.size > 24) return;
    budget.remaining -= 1;
    const directId = directOfferId(value);
    if (directId) ids.add(directId);
    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      collectOfferIds(child, ids, depth + 1, budget);
      if (budget.remaining <= 0 || ids.size > 24) break;
    }
  }

  function pruneForeignOfferBranches(value, offerId, depth) {
    if (value == null || typeof value !== "object") return value;
    if (depth > 20) return undefined;
    const directId = directOfferId(value);
    if (directId && directId !== offerId) return undefined;
    if (Array.isArray(value)) {
      return value.map((child) => pruneForeignOfferBranches(child, offerId, depth + 1))
        .filter((child) => child !== undefined);
    }
    const result = {};
    Object.keys(value).forEach((key) => {
      const child = pruneForeignOfferBranches(value[key], offerId, depth + 1);
      if (child !== undefined) result[key] = child;
    });
    return result;
  }

  function scopeKnownGlobalValue(name, value, offerId, allowUnboundSku) {
    const ids = new Set();
    collectOfferIds(value, ids, 0, { remaining: 10000 });
    if (ids.has(offerId)) return pruneForeignOfferBranches(value, offerId, 0);
    if (ids.size) return undefined;
    if (allowUnboundSku && /^(?:skuModel|skuMap)$/i.test(String(name || ""))) return value;
    return undefined;
  }

  function scopeKnownGlobalsToCurrentOffer(result) {
    const offerId = current1688OfferId();
    if (!offerId) return result;
    const aggregateIds = new Set();
    collectOfferIds(result, aggregateIds, 0, { remaining: 20000 });
    const allowUnboundSku = aggregateIds.size === 1 && aggregateIds.has(offerId);
    const scoped = {};
    Object.keys(result || {}).forEach((name) => {
      if (name === "__detectedProductGlobals") {
        const detected = {};
        Object.keys(result[name] || {}).forEach((detectedName) => {
          const value = scopeKnownGlobalValue(detectedName, result[name][detectedName], offerId, allowUnboundSku);
          if (value !== undefined) detected[detectedName] = value;
        });
        if (Object.keys(detected).length) scoped[name] = detected;
        return;
      }
      const value = scopeKnownGlobalValue(name, result[name], offerId, allowUnboundSku);
      if (value !== undefined) scoped[name] = value;
    });
    return scoped;
  }

  function readKnownGlobals(truncations) {
    const result = {};
    GLOBAL_NAMES.forEach((name) => {
      if (typeof window[name] !== "undefined") {
        tryRetainKnownGlobal(
          result,
          result,
          name,
          window[name],
          `/pageState/knownGlobals/${jsonPointerSegment(name)}`,
          truncations
        );
      }
    });
    const detected = readLikelyProductGlobals(result, truncations);
    if (Object.keys(detected).length) {
      result.__detectedProductGlobals = detected;
    }
    return scopeKnownGlobalsToCurrentOffer(result);
  }

  function readLikelyProductGlobals(rootResult, truncations) {
    const result = {};
    const candidateNames = Object.keys(window)
      .filter((name) => /(?:offer|detail|sku|product|gallery|price|desc)/i.test(name))
      .filter((name) => !/^webkit|^chrome|^on/i.test(name))
      .filter((name) => !GLOBAL_NAMES.includes(name));
    const names = candidateNames.slice(0, DETECTED_GLOBAL_NAME_LIMIT);

    if (candidateNames.length > names.length) {
      pushTruncation(truncations, {
        fieldPath: "/pageState/knownGlobals/__detectedProductGlobals/candidateNames",
        observedCount: candidateNames.length,
        retainedCount: names.length,
        limit: DETECTED_GLOBAL_NAME_LIMIT,
        unit: "items",
        reason: "candidate_limit",
        recoverability: "reload_page",
      });
    }

    rootResult.__detectedProductGlobals = result;
    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(result, name)) continue;
      const value = window[name];
      if (!value || typeof value !== "object" || value === window || value === document) continue;
      const retained = tryRetainKnownGlobal(
        rootResult,
        result,
        name,
        value,
        `/pageState/knownGlobals/__detectedProductGlobals/${jsonPointerSegment(name)}`,
        truncations
      );
      if (!retained) continue;
      if (Object.keys(result).length >= DETECTED_GLOBAL_RESULT_LIMIT) {
        if (names.indexOf(name) < names.length - 1) {
          pushTruncation(truncations, {
            fieldPath: "/pageState/knownGlobals/__detectedProductGlobals",
            observedCount: names.length,
            retainedCount: DETECTED_GLOBAL_RESULT_LIMIT,
            limit: DETECTED_GLOBAL_RESULT_LIMIT,
            unit: "items",
            reason: "candidate_limit",
            recoverability: "reload_page",
          });
        }
        break;
      }
    }
    if (!Object.keys(result).length) delete rootResult.__detectedProductGlobals;
    return result;
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function current1688OfferId() {
    if (!/(?:^|\.)1688\.com$/i.test(String(location.hostname || ""))) return "";
    const fromPath = String(location.pathname || "").match(/\/offer\/(\d+)\.html/i)?.[1];
    if (fromPath) return fromPath;
    try {
      return new URLSearchParams(location.search || "").get("offerId") || "";
    } catch (_error) {
      return "";
    }
  }

  function scriptBindsOfferId(text, offerId) {
    if (!text || !offerId) return false;
    const escapedId = escapeRegExp(offerId);
    const keyedId = new RegExp(
      `["']?(?:offerId|offerID|productId|itemId|goodsId)["']?\\s*[:=]\\s*["']?${escapedId}["']?(?!\\d)`,
      "i"
    );
    const offerUrl = new RegExp(`/offer/${escapedId}\\.html(?:[?"'\\s]|$)`, "i");
    return keyedId.test(text) || offerUrl.test(text);
  }

  function findEnclosingObjectStarts(text, position) {
    const stack = [];
    let quote = "";
    let escaped = false;
    for (let index = 0; index < position; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        stack.push(index);
      } else if (char === "}") {
        stack.pop();
      }
    }
    return stack.reverse();
  }

  function findObjectWithDirectOfferId(value, offerId, depth) {
    const currentDepth = depth || 0;
    if (!value || typeof value !== "object" || currentDepth > 10) return null;
    if (!Array.isArray(value)) {
      const directId = value.offerId ?? value.offerID ?? value.productId ?? value.itemId ?? value.goodsId;
      if (directId != null && String(directId) === offerId) return value;
    }
    const children = Array.isArray(value) ? value.slice(0, 200) : Object.values(value).slice(0, 200);
    for (const child of children) {
      const found = findObjectWithDirectOfferId(child, offerId, currentDepth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractOfferBoundObject(text, offerId) {
    const escapedId = escapeRegExp(offerId);
    const binding = new RegExp(
      `["']?(?:offerId|offerID|productId|itemId|goodsId)["']?\\s*[:=]\\s*["']?${escapedId}["']?(?!\\d)`,
      "ig"
    );
    let match;
    while ((match = binding.exec(text))) {
      const starts = findEnclosingObjectStarts(text, match.index);
      for (const start of starts) {
        const end = findBalancedJsonEnd(text, start, "{", "}");
        if (end < match.index) continue;
        try {
          const parsed = JSON.parse(text.slice(start, end + 1));
          const bound = findObjectWithDirectOfferId(parsed, offerId, 0);
          if (bound) return pruneForeignOfferBranches(bound, offerId, 0);
        } catch (_error) {}
      }
    }
    return null;
  }

  function collectScriptOfferIds(text) {
    const ids = new Set();
    const matcher = /["']?(?:offerId|offerID|productId|itemId|goodsId)["']?\s*[:=]\s*["']?(\d+)["']?/ig;
    let match;
    while ((match = matcher.exec(text)) && ids.size <= 20) ids.add(match[1]);
    return ids;
  }

  function extractOfferBoundText(text, offerId) {
    const boundObject = extractOfferBoundObject(text, offerId);
    if (boundObject) return JSON.stringify(boundObject);
    const offerIds = collectScriptOfferIds(text);
    if (offerIds.size === 1 && offerIds.has(offerId)) return text;
    if (!offerIds.size && scriptBindsOfferId(text, offerId)) return text;
    return "";
  }

  function findBalancedJsonEnd(text, start, openChar, closeChar) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  function findInlineKey(text, key, startAt) {
    const escapedKey = escapeRegExp(key);
    const matcher = new RegExp(`(?:["']${escapedKey}["']|\\b${escapedKey}\\b)\\s*[:=]\\s*`, "g");
    matcher.lastIndex = startAt || 0;
    return matcher.exec(text);
  }

  function extractJsonValueByKey(text, key) {
    let offset = 0;
    while (offset < text.length) {
      const match = findInlineKey(text, key, offset);
      if (!match) return null;
      const start = match.index + match[0].length;
      const openChar = text[start];
      if (openChar === "{" || openChar === "[") {
        const end = findBalancedJsonEnd(text, start, openChar, openChar === "{" ? "}" : "]");
        if (end >= 0) {
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch (_error) {}
        }
      }
      offset = match.index + match[0].length;
    }
    return null;
  }

  function readQuotedString(text, start) {
    const quote = text[start];
    if (quote !== '"' && quote !== "'") return null;
    let escaped = false;
    for (let index = start + 1; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        const raw = text.slice(start, index + 1);
        if (quote === '"') {
          try { return { value: JSON.parse(raw), end: index }; } catch (_error) {}
        }
        return {
          value: raw.slice(1, -1)
            .replace(/\\u([0-9a-f]{4})/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
            .replace(/\\(['"\\/])/g, "$1"),
          end: index,
        };
      }
    }
    return null;
  }

  function extractScalarByKey(text, key) {
    let offset = 0;
    while (offset < text.length) {
      const match = findInlineKey(text, key, offset);
      if (!match) return null;
      const start = match.index + match[0].length;
      const quoted = readQuotedString(text, start);
      if (quoted) return quoted.value;
      const scalar = text.slice(start).match(/^-?\d+(?:\.\d+)?|^(?:true|false|null)\b/);
      if (scalar) {
        try { return JSON.parse(scalar[0]); } catch (_error) {}
      }
      offset = match.index + match[0].length;
    }
    return null;
  }

  function firstInlineValue(text, keys, extractor) {
    for (const key of keys) {
      const value = extractor(text, key);
      if (value != null && value !== "") return value;
    }
    return null;
  }

  function normalizeInlineCategoryPath(value) {
    if (typeof value === "string") {
      const text = value.replace(/\s+/g, " ").trim();
      return text && text.length <= 1000 ? text : null;
    }
    if (Array.isArray(value) && value.length <= 50) {
      const cloned = safeClone(value);
      return cloned && serializedByteLength(cloned) <= 20000 ? cloned : null;
    }
    return null;
  }

  function extractInlineCategoryPath(text) {
    const keys = ["categoryPath", "category_path", "categoryNamePath", "catPath", "breadcrumb", "breadCrumb"];
    const scalar = firstInlineValue(text, keys, extractScalarByKey);
    if (scalar != null) return normalizeInlineCategoryPath(scalar);
    const structured = firstInlineValue(text, keys, extractJsonValueByKey);
    return normalizeInlineCategoryPath(structured);
  }

  function extractInlineCategoryId(text) {
    const value = firstInlineValue(
      text,
      ["leafCategoryId", "leaf_category_id", "catId", "categoryId", "category_id"],
      extractScalarByKey
    );
    const normalized = String(value == null ? "" : value).trim();
    return /^\d{2,}$/.test(normalized) ? normalized : null;
  }

  function extractInlineSkuModel(text) {
    const value = extractJsonValueByKey(text, "skuModel");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const skuMap = value.skuInfoMap || value.skuMap;
    if (!skuMap || typeof skuMap !== "object" || Array.isArray(skuMap)) return null;
    return safeClone(value);
  }

  function extractInlineVideoUrls(text, truncations, fieldPath) {
    const normalizedText = String(text || "")
      .replace(/\\u002f/gi, "/")
      .replace(/\\\//g, "/");
    const pattern = /(?:https?:)?\/\/[^\s"'\\<>]+?\.(?:mp4|m3u8|mov|webm|m4v|flv|avi|qt|mpeg|mpg|mkv)(?:\?[^\s"'\\<>]*)?/gi;
    const urls = [];
    const seen = new Set();
    let match;
    while ((match = pattern.exec(normalizedText))) {
      try {
        const candidate = match[0].startsWith("//") ? `https:${match[0]}` : match[0];
        const parsed = new URL(candidate, location.href);
        if (!/^https?:$/.test(parsed.protocol) || seen.has(parsed.href)) continue;
        if (urls.length >= INLINE_VIDEO_URL_LIMIT) {
          pushTruncation(truncations, {
            fieldPath,
            observedCount: urls.length + 1,
            retainedCount: urls.length,
            limit: INLINE_VIDEO_URL_LIMIT,
            unit: "items",
            reason: "candidate_limit",
            recoverability: "reload_page",
          });
          break;
        }
        seen.add(parsed.href);
        urls.push(parsed.href);
      } catch (_error) {}
    }
    return urls;
  }

  function buildTargetedInlineSource(text, offerId, scriptIndex, truncations) {
    const boundText = extractOfferBoundText(text, offerId);
    if (!boundText) return null;
    const skuModel = extractInlineSkuModel(boundText);
    const categoryPath = extractInlineCategoryPath(boundText);
    const categoryId = extractInlineCategoryId(boundText);
    const videoUrls = extractInlineVideoUrls(
      boundText,
      truncations,
      `/pageState/targetedInlineEvidenceSources/scripts/${scriptIndex}/videoUrls`
    );
    if (!skuModel && !categoryPath && !categoryId && !videoUrls.length) return null;
    return {
      sourceType: "script",
      sourcePath: `/document/inlineScripts/${scriptIndex}`,
      offerId,
      ...(skuModel ? { skuModel } : {}),
      ...(categoryPath ? { categoryPath } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(videoUrls.length ? { videoUrls } : {}),
    };
  }

  function readTargetedInlineEvidenceSources(truncations) {
    const offerId = current1688OfferId();
    if (!offerId) return [];
    let inlineScripts;
    try {
      inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
        .filter((script) => !String(script.getAttribute?.("src") || "").trim());
    } catch (_error) {
      return [];
    }
    const scripts = inlineScripts.slice(0, INLINE_SCRIPT_SCAN_LIMIT);
    if (inlineScripts.length > scripts.length) {
      pushTruncation(truncations, {
        fieldPath: "/pageState/targetedInlineEvidenceSources/candidateScripts",
        observedCount: inlineScripts.length,
        retainedCount: scripts.length,
        limit: INLINE_SCRIPT_SCAN_LIMIT,
        unit: "items",
        reason: "candidate_limit",
        recoverability: "reload_page",
      });
    }

    const results = [];
    let matchedCount = 0;
    scripts.forEach((script, index) => {
      const text = String(script.textContent || "");
      const scriptBytes = utf8ByteLength(text);
      if (scriptBytes > INLINE_SCRIPT_BYTES_LIMIT) {
        pushTruncation(truncations, {
          fieldPath: `/pageState/targetedInlineEvidenceSources/scripts/${index}`,
          observedCount: scriptBytes,
          retainedCount: 0,
          limit: INLINE_SCRIPT_BYTES_LIMIT,
          unit: "utf8_bytes",
          reason: "size_limit",
          recoverability: "reload_page",
        });
        return;
      }
      const source = buildTargetedInlineSource(text, offerId, index, truncations);
      if (!source) return;
      matchedCount += 1;
      if (results.length >= INLINE_RESULT_LIMIT) return;
      results.push(source);
      const aggregateBytes = serializedByteLength(results);
      if (aggregateBytes > INLINE_RESULTS_BYTES_LIMIT) {
        results.pop();
        pushTruncation(truncations, {
          fieldPath: "/pageState/targetedInlineEvidenceSources",
          observedCount: aggregateBytes,
          retainedCount: serializedByteLength(results),
          limit: INLINE_RESULTS_BYTES_LIMIT,
          unit: "utf8_bytes",
          reason: "size_limit",
          recoverability: "reload_page",
          fallbackSourcePath: source.sourcePath,
        });
      }
    });
    if (matchedCount > INLINE_RESULT_LIMIT) {
      pushTruncation(truncations, {
        fieldPath: "/pageState/targetedInlineEvidenceSources",
        observedCount: matchedCount,
        retainedCount: Math.min(results.length, INLINE_RESULT_LIMIT),
        limit: INLINE_RESULT_LIMIT,
        unit: "items",
        reason: "candidate_limit",
        recoverability: "reload_page",
      });
    }
    return results;
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function queryStringToObject(queryString) {
    const params = new URLSearchParams(queryString);
    const result = {};
    params.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  async function getAliExpressData() {
    if (!location.hostname.includes("aliexpress")) {
      return null;
    }

    if (window.lib && window.lib.mtop && typeof window.lib.mtop.request === "function") {
      const regionData = queryStringToObject(readCookie("aep_usuc_f"));
      const productId = location.pathname.match(/\d+/)?.[0];
      if (!productId) {
        return null;
      }

      const response = await window.lib.mtop.request({
        api: "mtop.aliexpress.pdp.pc.query",
        v: "1.0",
        dataType: "originaljsonp",
        data: {
          productId,
          _lang: regionData.b_locale && regionData.region ? `${regionData.b_locale.slice(0, 2)}_${regionData.region}` : undefined,
          _currency: regionData.c_tp,
          country: regionData.region,
          clientType: "pc",
          sourceType: new URLSearchParams(location.search).get("sourceType") || undefined
        }
      });

      return safeClone(response);
    }

    const productId = location.pathname.match(/\d+/)?.[0];
    if (!productId) {
      return null;
    }

    const apiUrl = `${location.origin}/aer-jsonapi/v1/bx/pdp/web/productData?productId=${productId}`;
    const response = await fetch(apiUrl, { method: "GET", credentials: "include" });
    const data = await response.json();
    return safeClone(data);
  }

  /**
   * 从 1688 的 `window.context` 提取结构化商品数据。
   *
   * 背景（2026-11 实测）：
   *   1688 详情页把真实数据放在 `window.context`（约 55KB），结构为
   *     context.result.data.gallery.fields.subject        商品标题
   *     context.result.data.gallery.fields.offerImgList   主图数组
   *     context.result.global.globalData.model.offerDetail.featureAttributes  属性
   *     context.result.data.Root.fields.dataJson.skuModel SKU 模型
   *     context.result.data.productTitle.fields.shopInfo.companyName 店铺名
   *
   *   现有采集只读 DOM 与 `__INIT_DATA__`/`__GLOBAL_DATA__` 等全局变量，
   *   这些在现版页面上大多为空，导致标题抓到公司名、主图抓到 SVG 图标、
   *   属性丢失键值结构。这里补一条结构化来源。
   *
   * 本函数纯读取，不修改页面、不发请求。
   */
  function readContextPathProduct() {
    let ctx = null;
    try {
      ctx = window.context;
    } catch (_e) {
      return null;
    }
    if (!ctx || typeof ctx !== "object" || !ctx.result) return null;

    const dig = (obj, path) => {
      let cur = obj;
      for (const k of path) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = cur[k];
      }
      return cur;
    };
    const asText = (v, max = 500) => (typeof v === "string" ? v.normalize("NFKC").trim().slice(0, max) : "");
    const asArray = (v) => (Array.isArray(v) ? v : []);

    const normalizeUrl = (raw) => {
      let s = asText(raw, 2000);
      if (!s) return "";
      if (s.startsWith("//")) s = "https:" + s;
      if (!/^https?:\/\//i.test(s)) return "";
      // 排除 22x22 这类界面图标与 SVG
      if (/tps-\d+-\d+/.test(s)) return "";
      if (/\.svg(\?|$)/i.test(s)) return "";
      if (/(placeholder|default|icon|sprite|logo_|avatar)/i.test(s)) return "";
      // 去掉 _q50 / _sum 缩放后缀
      s = s.replace(/\.(jpg|jpeg|png|webp)_[^/?#]*$/i, ".$1");
      s = s.replace(/\.sum\.(jpg|png)$/i, ".$1");
      return s.split("?")[0].split("#")[0];
    };
    const uniqueImages = (list) => {
      const seen = new Set();
      const out = [];
      for (const raw of list) {
        const u = normalizeUrl(raw);
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push(u);
      }
      return out;
    };

    const data = dig(ctx, ["result", "data"]) || {};
    const galleryFields = dig(data, ["gallery", "fields"]) || {};
    const titleFields = dig(data, ["productTitle", "fields"]) || {};
    const dataJson = dig(data, ["Root", "fields", "dataJson"]) || {};
    const offerDetail = dig(ctx, ["result", "global", "globalData", "model", "offerDetail"]) || {};

    const title = asText(galleryFields.subject)
      || asText(offerDetail.subject)
      || asText(dataJson.subject);

    const shopName = asText(dig(titleFields, ["shopInfo", "companyName"]), 200)
      || asText(offerDetail.companyName, 200);

    const mainImages = uniqueImages(
      asArray(galleryFields.offerImgList)
        .concat(asArray(offerDetail.mainImageList))
        .concat(asArray(offerDetail.imageList))
    ).slice(0, 40);

    const attributes = asArray(offerDetail.featureAttributes)
      .map((item) => {
        if (!item) return null;
        const name = asText(item.name, 200);
        const value = asText(item.value, 500);
        if (!name || !value) return null;
        return { name, value };
      })
      .filter(Boolean);

    const skuInfoMap = dig(dataJson, ["skuModel", "skuInfoMap"]) || {};
    const skuItems = Object.keys(skuInfoMap).map((key) => {
      const row = skuInfoMap[key] || {};
      return {
        specText: asText(key, 300),
        skuId: row.skuId != null ? String(row.skuId) : "",
        price: row.priceAmount != null && Number.isFinite(Number(row.priceAmount)) ? Number(row.priceAmount) : null,
        stock: row.canBookCount != null && Number.isFinite(Number(row.canBookCount)) ? Number(row.canBookCount) : null
      };
    });

    const leafCategoryName = asText(offerDetail.leafCategoryName, 200) || asText(dataJson.leafCategoryName, 200);
    const descriptionFields = dig(data, ["description", "fields"]) || {};

    if (!title && !attributes.length && !mainImages.length) return null;

    return {
      source: "window.context",
      title,
      shopName,
      offerId: offerDetail.offerId != null ? String(offerDetail.offerId) : (dataJson.offerId != null ? String(dataJson.offerId) : ""),
      leafCategoryName,
      categoryIds: {
        top: offerDetail.topCategoryId != null ? Number(offerDetail.topCategoryId) : null,
        second: offerDetail.secondCategoryId != null ? Number(offerDetail.secondCategoryId) : null,
        leaf: offerDetail.leafCategoryId != null ? Number(offerDetail.leafCategoryId) : null
      },
      mainImages,
      attributes,
      skuItems,
      detailUrl: asText(descriptionFields.detailUrl, 500)
    };
  }

  async function getPayload() {
    const truncations = [];
    return {
      location: {
        href: location.href,
        host: location.host
      },
      knownGlobals: readKnownGlobals(truncations),
      targetedInlineEvidenceSources: readTargetedInlineEvidenceSources(truncations),
      aliExpressData: await getAliExpressData().catch(() => null),
      // 2026-11：该分支读 window.context（实测 372KB，深结构）后序列化，疑似把页面主线程压住，
    // 与「新商品工作台卡死」同时出现。先关掉，等卡死排查清楚再启用。
    contextPathProduct: null,
      truncations
    };
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.direction !== REQUEST_DIRECTION || payload.type !== "GET_PAGE_STATE") {
      return;
    }

    try {
      const data = await getPayload();
      window.postMessage(
        {
          direction: RESPONSE_DIRECTION,
          requestId: payload.requestId,
          ok: true,
          payload: data
        },
        "*"
      );
    } catch (error) {
      window.postMessage(
        {
          direction: RESPONSE_DIRECTION,
          requestId: payload.requestId,
          ok: false,
          error: error && error.message ? error.message : String(error)
        },
        "*"
      );
    }
  });
})();
