// 统一的可信事件闸门
//
// 为什么需要：
//   工作台、图片工作台、编辑器里曾有 132 处 `event.isTrusted` 分散检查，分布在 23 个文件。
//   一旦某处写错或漏写，就是「点了没反应」且没有任何痕迹。
//   这里把判断收敛成一个入口：行为与 `event.isTrusted` 完全等价，被拦下时在控制台留痕。
//
// 没有任何放行开关。自动化验收必须用真实输入事件（例如 CDP 的 Input.dispatchMouseEvent，
// 见 scripts/extension-browser-fixture.mjs），不能通过 URL 参数或全局变量绕过。
//
// 用法：
//   if (!SS_ERP_TRUST_GATE.ok(event, target)) return;
//
// 注意：target 传按钮元素本身（或 event.currentTarget）。传 null 时只判 isTrusted。
(function () {
  'use strict';
  if (globalThis.SS_ERP_TRUST_GATE) return;

  var blocked = 0;

  function describe(target) {
    if (!target) return '(anonymous)';
    if (typeof target === 'string') return target;
    try {
      if (target.id) return '#' + target.id;
      var cls = typeof target.className === 'string' ? target.className.trim().split(/\s+/)[0] : '';
      var tag = target.tagName ? target.tagName.toLowerCase() : 'node';
      return cls ? tag + '.' + cls : tag;
    } catch {
      return '(node)';
    }
  }

  function ok(event, target) {
    // 禁用元素一律拦下（原实现中 `|| btn.disabled` 就写在这里）
    if (target && target.disabled === true) return false;
    if (event && event.isTrusted === true) return true;
    blocked++;
    try { console.warn('[SSERP] untrusted event BLOCKED:', describe(target)); } catch { /* 控制台不可用时忽略 */ }
    return false;
  }

  function stats() {
    return Object.freeze({ blocked: blocked });
  }

  globalThis.SS_ERP_TRUST_GATE = Object.freeze({ ok: ok, stats: stats });
}());
