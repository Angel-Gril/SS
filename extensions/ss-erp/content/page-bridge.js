(function () {
  const REQUEST_DIRECTION = "spb-self-hosted:content";
  const RESPONSE_DIRECTION = "spb-self-hosted:bridge";
  const GLOBAL_NAMES = [
    "rawData",
    "__NEXT_DATA__",
    "__INITIAL_STATE__",
    "__INIT_DATA__",
    "__GLOBAL_DATA__",
    "__PAGE_DATA__",
    "__PDP_DATA__",
    "__STORE_DATA__",
    "__NUXT__",
    "__PRELOADED_STATE__",
    "__APP_DATA__",
    "pageData",
    "globalData",
    "offerDetailData",
    "goodsData",
    "goodsDetail",
    "goodsDetailData",
    "mallData",
    "detailData",
    "iDetailData",
    "skuData",
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
