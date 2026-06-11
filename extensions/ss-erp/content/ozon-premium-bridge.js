/**
 * ozon-bridge.js — Ozon Premium 模拟
 *
 * 在 seller.ozon.ru 的 MAIN 世界中运行，通过拦截 XHR / fetch 请求，
 * 对 Premium/Analytics 接口返回伪造数据，让普通账号也能使用 Premium 功能。
 *
 * 技术路线：
 *   1. 拦截 XMLHttpRequest / fetch，匹配 premium 相关端点
 *   2. 在 /analytics/graphs 页面检测模糊单元格 → 自动跳转激活拦截链
 *   3. 跳转后显示提示弹窗
 *
 * 本文件完全在客户端运行，不依赖任何后端接口。
 */

(function () {
  "use strict";

  const GUARD_KEY = "__SPB_SELF_HOSTED_OZON_PREMIUM_V1__";
  const STORAGE_FROM_GRAPHS = "spb_ozon_from_graphs";
  const STORAGE_ORIGINAL_PATH = "spb_ozon_original_path";

  // ---- 入口守卫：防止重复安装 ----
  if (window[GUARD_KEY]) return;
  window[GUARD_KEY] = true;

  const DEBUG = false;
  const log = DEBUG ? console.log.bind(console, "[OzonBridge]") : function () {};

  // ---- 工具函数 ----
  function parseCookies() {
    const result = {};
    document.cookie.split(";").forEach(function (pair) {
      const eq = pair.indexOf("=");
      if (eq === -1) return;
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (key) result[key] = decodeURIComponent(value);
    });
    return result;
  }

  // ---- Premium 数据伪造 ----
  /**
   * 根据 URL 生成对应的伪造 Premium 响应数据
   */
  function fakePremiumResponse(url) {
    const base = {
      status: "grace_good",
      is_premium: true,
      isPremiumPlus: true,
      isAnalyst: true,
      subscription: {
        current: "PREMIUM_PLUS",
        available: ["PREMIUM_PLUS"],
        grace_period_end_at: new Date(Date.now() + 4838400000).toISOString()
      },
      features: {
        analytics: "full",
        marketing: "full",
        api: "full_access",
        graphs: "full",
        reports: "full",
        statistics: "full",
        recommendations: "full"
      }
    };

    // 卖家分析 premium 状态接口
    if (/seller-analytics\/premium\/status/i.test(url) || /\/premium\/status/i.test(url) || /get-seller-premium-status/i.test(url)) {
      return {
        ...base,
        dataPoints: Array.from({ length: 15 }, function (_, i) {
          return {
            id: "metric_" + i,
            value: Math.floor(Math.random() * 616),
            trend: Math.random() > 0.5 ? "up" : "down",
            change: Math.floor(Math.random() * 36)
          };
        }),
        hasAccess: true,
        accessLevel: "FULL"
      };
    }

    // 图表 / 统计 数据接口
    if (/\/analytics\/graphs/i.test(url) || /\/graph\/data/i.test(url) || /\/statistics\/data/i.test(url)) {
      return {
        ...base,
        graphsAccess: true,
        dataSets: ["sales", "traffic", "conversion"],
        timeRanges: ["day", "week", "month"]
      };
    }

    return base;
  }

  /**
   * 判断 URL 是否需要拦截
   */
  function shouldIntercept(url) {
    if (!url) return false;
    return [
      /\/premium\/status/i,
      /seller-analytics\/premium\/status/i,
      /get-seller-premium-status/i,
      /\/analytics\/graphs/i,
      /\/graph\/data/i,
      /\/statistics\/data/i
    ].some(function (pattern) {
      return pattern.test(url);
    });
  }

  // ---- 弹窗提示 ----
  function showPremiumPrompt() {
    if (!location.search.includes("ozon_force_refresh")) return;

    log("显示 Premium 助力弹窗");

    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed",
      "top:0", "left:0",
      "width:100%", "height:100%",
      "background:rgba(0,0,0,0.5)",
      "display:flex",
      "justify-content:center",
      "align-items:center",
      "z-index:999999"
    ].join(";");

    const dialog = document.createElement("div");
    dialog.style.cssText = [
      "background:#fff",
      "padding:24px",
      "border-radius:8px",
      "max-width:400px",
      "text-align:center",
      "box-shadow:0 20px 60px rgba(0,0,0,0.3)"
    ].join(";");

    dialog.innerHTML =
      '<h2 style="color:#ea580c;margin:0 0 12px;font-size:18px">SS ERP · Premium 数据助手</h2>' +
      '<p style="margin:0 0 20px;color:#555;font-size:14px;line-height:1.6">已为您激活 Ozon Premium 数据访问，<br>点击确定即可查看完整分析图表。' +
      '<div style="font-size:12px;color:#999;margin-top:8px">（本功能完全在浏览器本地运行，不依赖后端）</div>' +
      '</p>' +
      '<button id="spb-ozon-premium-confirm" style="' +
      'background:#ea580c;color:#fff;border:0;padding:10px 28px;' +
      'border-radius:6px;cursor:pointer;font-size:14px">' +
      '确定</button>';

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.getElementById("spb-ozon-premium-confirm").onclick = function () {
      document.body.removeChild(overlay);
      // 回到 graphs 页面
      history.pushState(null, "", "https://seller.ozon.ru/app/analytics/graphs");
      window.dispatchEvent(new PopStateEvent("popstate"));
      setTimeout(function () {
        window.dispatchEvent(new CustomEvent("ozon-extension-trigger"));
      }, 100);
    };
  }

  // ---- 模糊单元格检测 + 跳转 ----
  function detectBlurredCellsAndRedirect() {
    if (!/\/analytics\/graphs/i.test(location.pathname)) return false;

    const blurredCells = document.querySelectorAll('[class*="styles_blurredCell_"], [class*="blurredCell"]');
    log("检测到模糊单元格数量:", blurredCells.length);

    if (blurredCells.length === 0) return false;

    sessionStorage.setItem(STORAGE_FROM_GRAPHS, "true");
    sessionStorage.setItem(STORAGE_ORIGINAL_PATH, location.pathname);
    history.pushState(null, "", "https://seller.ozon.ru/app/analytics");
    location.search = "?ozon_force_refresh=" + Date.now();
    return true;
  }

  // ---- XHR 拦截（class extends 方式，对齐 V3.1.74 实现） ----
  function installXhrInterceptor() {
    var NativeXHR = window.XMLHttpRequest;

    // 使用 class extends 而非 function wrapper
    // 原因：Ozon 可能做 instanceof XMLHttpRequest 检查
    var InterceptedXHR = function () {
      var xhr = new NativeXHR();
      var interceptedUrl = "";
      var isIntercepted = false;

      var originalOpen = xhr.open;
      xhr.open = function (method, url) {
        interceptedUrl = String(url || "");
        return originalOpen.apply(xhr, arguments);
      };

      var originalSend = xhr.send;
      xhr.send = function () {
        if (shouldIntercept(interceptedUrl)) {
          log("XHR 拦截:", interceptedUrl);
          isIntercepted = true;
          var fakeData = fakePremiumResponse(interceptedUrl);
          var fakeJson = JSON.stringify(fakeData);

          Object.defineProperties(xhr, {
            responseText: { value: fakeJson, writable: true, configurable: true },
            response: { value: fakeJson, writable: true, configurable: true },
            status: { value: 200, writable: true, configurable: true },
            statusText: { value: "OK", writable: true, configurable: true },
            readyState: {
              get: function () { return isIntercepted ? 4 : NativeXHR.DONE; },
              configurable: true
            }
          });

          // 异步触发回调
          Promise.resolve().then(function () {
            if (typeof xhr.onreadystatechange === "function") {
              xhr.onreadystatechange(new Event("readystatechange"));
            }
            if (typeof xhr.onload === "function") {
              xhr.onload(new Event("load"));
            }
            xhr.dispatchEvent(new Event("load"));
            xhr.dispatchEvent(new Event("loadend"));
          });

          // 弹窗
          if (/seller-analytics\/premium\/status/i.test(interceptedUrl)) {
            setTimeout(showPremiumPrompt, 1000);
          }
          return;
        }
        return originalSend.apply(xhr, arguments);
      };

      return xhr;
    };

    // 继承原型链 — 确保 instanceof XMLHttpRequest === true
    InterceptedXHR.prototype = NativeXHR.prototype;
    // 静态常量
    InterceptedXHR.UNSENT = 0;
    InterceptedXHR.OPENED = 1;
    InterceptedXHR.HEADERS_RECEIVED = 2;
    InterceptedXHR.LOADING = 3;
    InterceptedXHR.DONE = 4;

    window.XMLHttpRequest = InterceptedXHR;
    log("XHR 拦截器安装成功");
  }

  // ---- Fetch 拦截 ----
  function installFetchInterceptor() {
    const nativeFetch = window.fetch;

    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input :
        (input instanceof Request ? input.url : "");

      if (shouldIntercept(url)) {
        log("Fetch 拦截:", url);
        const fakeData = fakePremiumResponse(url);

        if (/seller-analytics\/premium\/status/i.test(url)) {
          setTimeout(showPremiumPrompt, 1000);
        }

        return Promise.resolve(new Response(JSON.stringify(fakeData), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Intercepted": "spb-self-hosted"
          }
        }));
      }

      return nativeFetch.call(window, input, init).catch(function (err) {
        log("Fetch 请求失败:", err);
        throw err;
      });
    };

    log("Fetch 拦截器安装成功");
  }

  // ---- DOM 就绪后的激活（模糊检测 + 弹窗 + 定时器） ----
  let postDomTimer = null;

  function postDomActivation() {
    if (postDomTimer) return;

    // 先检测模糊单元格
    const redirected = detectBlurredCellsAndRedirect();
    if (redirected) {
      log("检测到模糊单元格，已触发跳转");
      return;
    }

    // 持久化激活时间
    try { sessionStorage.setItem("spb_ozon_premium_active", "true"); } catch (_) {}
    try { sessionStorage.setItem("spb_ozon_premium_activated_at", String(Date.now())); } catch (_) {}

    // 在 analytics 页面且带 force_refresh 参数时弹出提示
    if (/\/analytics$/i.test(location.pathname) && location.search.includes("ozon_force_refresh")) {
      setTimeout(showPremiumPrompt, 800);
    }

    // 定时轮询（处理 Ozon SPA 内延迟渲染的图表页面）
    postDomTimer = setInterval(function () {
      const spinner = document.querySelector('[class*="styles_spinner_"], [class*="spinner"]');
      if (spinner) {
        log("页面 spinner 仍在加载中...");
        return;
      }

      if (/\/analytics\/graphs/i.test(location.pathname)) {
        clearInterval(postDomTimer);
        postDomTimer = null;
        window.__SPB_OZON_FULLY_ACTIVE__ = true;
        log("SPA 图表页面就绪，重新检测模糊单元格");
        detectBlurredCellsAndRedirect();
      }
    }, 5000);
  }

  // ---- SPA 路由变化监听（处理 pushState / popstate 导航） ----
  function setupSpaListener() {
    var origPushState = history.pushState;
    history.pushState = function () {
      origPushState.apply(history, arguments);
      onSpaNavigate();
    };

    var origReplaceState = history.replaceState;
    history.replaceState = function () {
      origReplaceState.apply(history, arguments);
      onSpaNavigate();
    };

    window.addEventListener("popstate", onSpaNavigate);
  }

  function onSpaNavigate() {
    log("SPA 导航: " + location.pathname);
    detectBlurredCellsAndRedirect();
    if (/\/analytics$/i.test(location.pathname) && location.search.includes("ozon_force_refresh")) {
      setTimeout(showPremiumPrompt, 500);
    }
  }

  // ═══════════════════════════════════════════
  //  ▸ 启动：拦截器必须在 document_start 立即安装
  //    否则 Ozon 的首批 API 请求会绕过拦截
  // ═══════════════════════════════════════════

  // ① 立即安装 XHR + Fetch 拦截器（拦截所有后续请求）
  installXhrInterceptor();
  installFetchInterceptor();
  log("XHR/Fetch 拦截器已安装 (document_start)");

  // ② SPA 路由监听
  setupSpaListener();

  // ③ DOM 就绪后执行 UI 相关激活
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", postDomActivation);
  } else {
    postDomActivation();
  }

})();
