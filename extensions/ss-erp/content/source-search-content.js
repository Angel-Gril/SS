(function () {
  const SS_ERP_SOURCE_SEARCH_JOBS_KEY = "ss-erp:sourcing-search-jobs";
  const REQUEST_SOURCE = "ss-erp-source-search-content";
  const RESULT_SOURCE = "ss-erp-source-search-page";
  const BRIDGE_ID = "ss-erp-source-search-page-bridge";
  const STATUS_ID = "ss-erp-source-search-status";
  const JOB_TTL_MS = 30 * 60 * 1000;
  let bridgeLoadPromise = null;

  initSourceSearchBridge().catch((error) => {
    renderStatus(error && error.message ? error.message : String(error), true);
  });

  async function initSourceSearchBridge() {
    const params = new URLSearchParams(location.search);
    if (params.get("ssErpSourceSearch") !== "1") return;
    const platform = (params.get("ssErpPlatform") || "").toLowerCase();
    const token = params.get("ssErpToken") || "";
    if (platform !== "1688" || !token) return;

    const job = await loadJob(token);
    if (!job || job.platform !== "1688") {
      renderStatus("SS ERP search job was not found. Please start image search from the Ozon panel again.", true);
      return;
    }
    if (isExpired(job)) {
      await removeJob(token);
      renderStatus("SS ERP search job expired. Please start image search from the Ozon panel again.", true);
      return;
    }

    renderStatus("Uploading Ozon image to 1688 image search...");
    const result = await requestPageUpload(job);
    if (result && result.ok && result.url) {
      await markJob(token, { status: "opened", imageId: result.imageId || "", resultUrl: result.url });
      renderStatus("1688 image search opened.");
      window.setTimeout(() => {
        location.href = result.url;
      }, 80);
      return;
    }

    const error = result && (result.error || result.msg) ? result.error || result.msg : "1688 image search failed";
    await markJob(token, { status: "fallback", error });
    renderStatus(error + ". Opening fallback search...", true);
    window.setTimeout(() => {
      location.href = job.fallbackUrl || buildFallbackUrl(job);
    }, 600);
  }

  function loadJob(token) {
    return new Promise((resolve) => {
      chrome.storage.local.get([SS_ERP_SOURCE_SEARCH_JOBS_KEY], (result) => {
        const jobs = result[SS_ERP_SOURCE_SEARCH_JOBS_KEY] || {};
        resolve(jobs[token] || null);
      });
    });
  }

  function updateJobs(mutator) {
    return new Promise((resolve) => {
      chrome.storage.local.get([SS_ERP_SOURCE_SEARCH_JOBS_KEY], (result) => {
        const jobs = result[SS_ERP_SOURCE_SEARCH_JOBS_KEY] || {};
        mutator(jobs);
        chrome.storage.local.set({ [SS_ERP_SOURCE_SEARCH_JOBS_KEY]: jobs }, resolve);
      });
    });
  }

  function removeJob(token) {
    return updateJobs((jobs) => {
      delete jobs[token];
    });
  }

  function markJob(token, patch) {
    return updateJobs((jobs) => {
      if (!jobs[token]) return;
      jobs[token] = Object.assign({}, jobs[token], patch, { updatedAt: new Date().toISOString() });
    });
  }

  function isExpired(job) {
    const createdAt = Date.parse(job && job.createdAt || "");
    return !Number.isFinite(createdAt) || Date.now() - createdAt > JOB_TTL_MS;
  }

  function requestPageUpload(job) {
    return new Promise((resolve) => {
      const requestId = "ss-erp-" + Date.now() + "-" + Math.random().toString(36).slice(2);
      const timer = window.setTimeout(() => {
        cleanup();
        resolve({ ok: false, error: "1688 image search bridge timed out" });
      }, 24000);

      function cleanup() {
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
      }

      function onMessage(event) {
        const data = event.data || {};
        if (event.source !== window || data.source !== RESULT_SOURCE || data.requestId !== requestId) return;
        cleanup();
        resolve(data);
      }

      window.addEventListener("message", onMessage);
      return injectPageBridge().then(() => {
        window.postMessage({
          source: REQUEST_SOURCE,
          requestId,
          token: job.token,
          imageBase64: job.imageBase64,
          imageMimeType: job.imageMimeType || "image/jpeg",
          fallbackUrl: job.fallbackUrl || buildFallbackUrl(job),
        }, location.origin);
      }).catch((error) => {
        cleanup();
        resolve({
          ok: false,
          error: error && error.message ? error.message : String(error),
        });
      });
    });
  }

  function injectPageBridge() {
    if (bridgeLoadPromise) return bridgeLoadPromise;
    if (document.getElementById(BRIDGE_ID)) return Promise.resolve();
    bridgeLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.id = BRIDGE_ID;
      script.src = chrome.runtime.getURL("content/source-search-1688-page.js");
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("SS ERP 1688 image search bridge failed to load"));
      (document.head || document.documentElement).appendChild(script);
    });
    return bridgeLoadPromise;
  }

  function buildFallbackUrl(job) {
    const context = job && job.ozonSourceContext || {};
    const url = new URL("https://s.1688.com/selloffer/offer_search.htm");
    if (context.imageUrl) url.searchParams.set("imageAddress", context.imageUrl);
    if (context.title) url.searchParams.set("keywords", String(context.title).slice(0, 80));
    url.searchParams.set("ssErpSource", "ozon");
    return url.toString();
  }

  function renderStatus(message, isError) {
    let node = document.getElementById(STATUS_ID);
    if (!node) {
      node = document.createElement("div");
      node.id = STATUS_ID;
      node.style.cssText = [
        "position:fixed",
        "right:18px",
        "top:18px",
        "z-index:2147483647",
        "max-width:360px",
        "padding:12px 14px",
        "border-radius:8px",
        "box-shadow:0 8px 28px rgba(15,23,42,0.18)",
        "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
        "background:#fff",
        "color:#172033",
        "border:1px solid rgba(15,23,42,0.12)"
      ].join(";");
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.style.borderColor = isError ? "#ef4444" : "rgba(15,23,42,0.12)";
  }
}());
