(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
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

  function readKnownGlobals() {
    const result = {};
    GLOBAL_NAMES.forEach((name) => {
      if (typeof window[name] !== "undefined") {
        const cloned = safeClone(window[name]);
        if (cloned) {
          result[name] = cloned;
        }
      }
    });
    const detected = readLikelyProductGlobals();
    if (Object.keys(detected).length) {
      result.__detectedProductGlobals = detected;
    }
    return result;
  }

  function readLikelyProductGlobals() {
    const result = {};
    const names = Object.keys(window)
      .filter((name) => /(?:offer|detail|sku|product|gallery|price|desc)/i.test(name))
      .filter((name) => !/^webkit|^chrome|^on/i.test(name))
      .slice(0, 80);

    for (const name of names) {
      if (Object.prototype.hasOwnProperty.call(result, name)) continue;
      const value = window[name];
      if (!value || typeof value !== "object" || value === window || value === document) continue;
      const cloned = safeClone(value);
      if (!cloned) continue;
      try {
        const size = JSON.stringify(cloned).length;
        if (size > 500000) continue;
      } catch (_error) {
        continue;
      }
      result[name] = cloned;
      if (Object.keys(result).length >= 20) break;
    }
    return result;
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

  async function getPayload() {
    return {
      location: {
        href: location.href,
        host: location.host
      },
      knownGlobals: readKnownGlobals(),
      aliExpressData: await getAliExpressData().catch(() => null)
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
