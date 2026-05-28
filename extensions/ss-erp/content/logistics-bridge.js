/**
 * logistics-bridge.js — 订单物流追踪（纯客户端）
 *
 * 在 1688 订单页 / 拼多多订单页的 MAIN 世界中运行，
 * 从页面运行时数据中提取物流跟踪号、快递公司等信息。
 *
 * 数据来源：
 *   1688: window.lib.mtop.request → mtop.1688.DeliveryOrderService.queryDeliveryOrderPackList
 *   拼多多: 请求订单详情页 HTML → 解析 window.rawData
 *
 * 通信方式：
 *   接收 content-script 通过 window.postMessage 发送的请求
 *   通过 window.postMessage 返回结果
 *
 * 本文件完全在客户端运行，不依赖任何后端接口。
 */

(function () {
  "use strict";

  const GUARD_KEY = "__SPB_SELF_HOSTED_LOGISTICS_V1__";
  const NAMESPACE_REQUEST = "spb-self-hosted:logistics-request";
  const NAMESPACE_RESPONSE = "spb-self-hosted:logistics-response";

  if (window[GUARD_KEY]) return;
  window[GUARD_KEY] = true;

  // ---- 工具函数 ----
  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function readCookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function parseQueryString(str) {
    var params = new URLSearchParams(str);
    var result = {};
    params.forEach(function (value, key) {
      result[key] = value;
    });
    return result;
  }

  /**
   * 从 HTML 文本中提取 window.rawData
   * （用于拼多多订单详情页）
   */
  function extractRawDataFromHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, "text/html");
    var scripts = doc.querySelectorAll("script");
    var rawData = null;

    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || "";
      if (/window\.rawData\s*=/.test(text)) {
        try {
          var sandbox = {};
          new Function("window", text)(sandbox);
          rawData = sandbox.rawData;
        } catch (e) {
          // ignore eval errors
        }
        break;
      }
    }

    return rawData;
  }

  /**
   * 通过 fetch 获取拼多多订单详情页 HTML
   */
  async function fetchPddOrderPage(orderSn) {
    var url = "https://mobile.pinduoduo.com/order.html" +
      "?order_sn=" + orderSn +
      "&page_from=1&is_tester=1" +
      "&refer_page_name=my_order" +
      "&refer_page_id=10032_" + Date.now() + "_" + Math.random().toString(36).slice(2) +
      "&refer_page_sn=10032";

    var response = await fetch(url, { credentials: "include" });
    return await response.text();
  }

  // ---- 1688 物流查询 ----
  async function query1688Logistics(orderId) {
    if (!window.lib || !window.lib.mtop || typeof window.lib.mtop.request !== "function") {
      throw new Error("1688 MTOP 不可用，请确认已登录 1688");
    }

    var response = await window.lib.mtop.request({
      api: "mtop.1688.DeliveryOrderService.queryDeliveryOrderPackList",
      v: "1.0",
      type: "post",
      dataType: "jsonp",
      data: {
        orderId: String(orderId),
        userType: "buyer",
        needOfferWeight: true
      }
    });

    var ret = (response.ret || [])[0] || "";
    if (ret.indexOf("SUCCESS") !== 0 || !(response.data && response.data.succeed)) {
      throw new Error("1688 物流查询失败");
    }

    var model = (response.data.model || [])[0] || {};
    return {
      trackingNumber: model.mailNo || "",
      shippingName: model.logisticsCompanyName || "",
      expressStatus: model.mailNo ? 1 : 0
    };
  }

  // ---- 拼多多物流查询 ----
  async function queryPddLogistics(orderSn) {
    var html = await fetchPddOrderPage(orderSn);
    var rawData = extractRawDataFromHtml(html);

    if (!rawData || !rawData.data) {
      throw new Error("拼多多订单页 rawData 解析失败");
    }

    var expressInfo = rawData.data.expressInfo || {};
    return {
      trackingNumber: expressInfo.trackingNumber || "",
      shippingName: expressInfo.shippingName || "",
      expressStatus: expressInfo.trackingNumber ? 1 : 0
    };
  }

  // ---- 主处理函数 ----
  async function processLogisticsRequest(payload) {
    var orders = payload.orders || [];
    var platform = payload.platform || "1688";
    var results = [];

    for (var i = 0; i < orders.length; i++) {
      var order = orders[i];
      var entry = {
        parentID: order.parentID || "",
        posting_number: order.posting_number || "",
        cg_order_no: order.cg_order_no || order.orderId || "",
        trackingNumber: "",
        shippingName: "",
        expressStatus: 2 // 2 = 查询失败
      };

      try {
        if (platform === "pdd") {
          var info = await queryPddLogistics(entry.cg_order_no);
        } else {
          var info = await query1688Logistics(entry.cg_order_no);
        }
        entry.trackingNumber = info.trackingNumber;
        entry.shippingName = info.shippingName;
        entry.expressStatus = info.expressStatus;
      } catch (err) {
        // 单条失败不影响整体
        entry.error = err.message;
      }

      results.push(entry);

      // 逐条通知进度（content-script 侧可用）
      window.postMessage({
        direction: NAMESPACE_RESPONSE,
        type: "progress",
        data: entry,
        index: i,
        total: orders.length
      }, "*");

      // 1688/PDD 接口限流
      await delay(1000);
    }

    return results;
  }

  // ---- 消息监听 ----
  window.addEventListener("message", async function (event) {
    if (event.source !== window) return;

    var payload = event.data;
    if (!payload || payload.direction !== NAMESPACE_REQUEST) return;

    var requestId = payload.requestId;

    try {
      var results = await processLogisticsRequest(payload);
      window.postMessage({
        direction: NAMESPACE_RESPONSE,
        requestId: requestId,
        ok: true,
        data: {
          results: results,
          platform: payload.platform || "1688"
        }
      }, "*");
    } catch (err) {
      window.postMessage({
        direction: NAMESPACE_RESPONSE,
        requestId: requestId,
        ok: false,
        error: err.message || String(err)
      }, "*");
    }
  });

})();
