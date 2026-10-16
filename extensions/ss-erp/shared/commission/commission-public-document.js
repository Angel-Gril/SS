(function (root) {
  'use strict';
  var PAGE = 'https://global-help.ozon.com/zh/commissions/ozon-fees/commissions?region=CHN';
  function isPublicPage(url) {
    try { var value = new URL(url); return value.origin === 'https://global-help.ozon.com'
      && value.pathname === '/zh/commissions/ozon-fees/commissions'; } catch { return false; }
  }
  async function readWithinPublicPage() {
    if (location.origin !== 'https://global-help.ozon.com'
      || location.pathname !== '/zh/commissions/ozon-fees/commissions') throw new Error('public_page_rejected');
    var controller = new AbortController(), timer = setTimeout(function () { controller.abort(); }, 6000), reader;
    try {
      // A normal same-origin request; no cookie/token is read, exported, or copied.
      var endpoint = '/document-manager-api/global-help/api/v3/document/public/by-path?path=%2Fcommissions%2Fozon-fees%2Fcommissions&lang=zh&childDocsRegion=CHN&policyFilter.policy=CONTENT_POLICY_CABINET_GLOBAL';
      var response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('public_document_unavailable');
      reader = response.body.getReader(); var length = 0, chunks = [];
      while (true) {
        var part = await reader.read(); if (part.done) break;
        length += part.value.length; if (length > 2 * 1024 * 1024) throw new Error('public_document_too_large');
        chunks.push(part.value);
      }
      var bytes = new Uint8Array(length), offset = 0;
      chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.length; });
      return JSON.parse(new TextDecoder().decode(bytes));
    } finally { clearTimeout(timer); if (reader) await reader.cancel().catch(function () {}); }
  }
  async function read(options) {
    var tabs = options.tabs, scripting = options.scripting, id;
    try {
      var tab = await tabs.create({ url: PAGE, active: false }); id = tab.id;
      await new Promise(function (resolve, reject) {
        var timer = setTimeout(function () { finish(new Error('public_page_timeout')); }, 10000);
        function finish(error) { clearTimeout(timer); tabs.onUpdated.removeListener(update); error ? reject(error) : resolve(); }
        function check(value) {
          if (!isPublicPage(value.url || value.pendingUrl || PAGE)) return finish(new Error('public_page_rejected'));
          if (value.status === 'complete') finish();
        }
        function update(tabId, changes, current) { if (tabId === id) check(Object.assign({}, current, changes)); }
        tabs.onUpdated.addListener(update);
        tabs.get(id).then(check, function () { finish(new Error('public_page_unavailable')); });
      });
      var current = await tabs.get(id);
      if (!isPublicPage(current.url)) throw new Error('public_page_rejected');
      var result = await scripting.executeScript({ target: { tabId: id }, func: readWithinPublicPage, world: 'ISOLATED' });
      if (!result || result.length !== 1 || !result[0].result) throw new Error('public_document_unavailable');
      return result[0].result;
    } finally { if (Number.isInteger(id)) await tabs.remove(id).catch(function () {}); }
  }
  root.OZON_CALC_COMMISSION_PUBLIC_DOCUMENT = { read: read };
}(typeof globalThis !== 'undefined' ? globalThis : this));
