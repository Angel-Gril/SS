// 统一的可信事件闸门
//
// 为什么需要：
//   工作台、图片工作台、编辑器里共有 132 处 `event.isTrusted` 分散检查，
//   分布在 23 个文件。这带来两个问题：
//     1) 一旦某处写错或漏写，就是「点了没反应」且没有任何痕迹；
//     2) 端到端测试无法驱动任何按钮 —— CDP 合成事件的 isTrusted 在
//        部分路径上不成立，只能靠 session 定向 Input 逐点硬点。
//
//   这里把判断收敛成一个入口，行为与原实现一致（默认严格），
//   但多两件事：拦住时留 console 痕迹，以及允许显式 E2E 例外。
//
// 生产行为：与原 `event.isTrusted` 完全等价。
// E2E 放行：globalThis.__SSERP_E2E__ === true，或页面 URL 带 ?sserp-e2e=1。
//
// 用法：
//   if (!SS_ERP_TRUST_GATE.ok(event, target)) return;
//   if (SS_ERP_TRUST_GATE.ok(event, target)) { ... }
//
// 注意：target 传按钮元素本身（或 event.currentTarget）。传 null 时只判 isTrusted。
(function () {
  'use strict';
  if (globalThis.SS_ERP_TRUST_GATE) return;

  var blocked = 0;

  function e2eBypass() {
    try {
      if (globalThis.__SSERP_E2E__ === true) return true;
      if (typeof location !== 'undefined' && location.search) {
        if (new URLSearchParams(location.search).get('sserp-e2e') === '1') {
          globalThis.__SSERP_E2E__ = true;
          return true;
        }
      }
    } catch (_e) {}
    return false;
  }

  function describe(target) {
    if (!target) return '(anonymous)';
    if (typeof target === 'string') return target;
    try {
      if (target.id) return '#' + target.id;
      var cls = typeof target.className === 'string' ? target.className.trim().split(/\s+/)[0] : '';
      var tag = target.tagName ? target.tagName.toLowerCase() : 'node';
      return cls ? tag + '.' + cls : tag;
    } catch (_e) {
      return '(node)';
    }
  }

  function ok(event, target) {
    // 禁用元素一律拦下（原实现中 `|| btn.disabled` 就写在这里）
    if (target && target.disabled === true) return false;
    if (event && event.isTrusted === true) return true;
    if (e2eBypass()) {
      try { console.warn('[SSERP] untrusted event allowed (E2E):', describe(target)); } catch (_e) {}
      return true;
    }
    blocked++;
    try {
      console.warn('[SSERP] untrusted event BLOCKED:', describe(target),
        '| 若要自动化测试，请加 ?sserp-e2e=1');
    } catch (_e) {}
    return false;
  }

  function stats() {
    return Object.freeze({ blocked: blocked, e2e: e2eBypass() });
  }

  globalThis.SS_ERP_TRUST_GATE = Object.freeze({ ok: ok, stats: stats, e2eBypass: e2eBypass });
}());
