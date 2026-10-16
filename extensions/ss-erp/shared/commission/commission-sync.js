(function (root) {
  'use strict';
  var SNAPSHOT_KEY = 'ozon-calculator:commission-snapshot';
  var STATE_KEY = 'ozon-calculator:commission-sync-state';
  var MAX_BYTES = 2 * 1024 * 1024;
  var pending = null;
  function failedResult(snapshot, syncState, retained) {
    return { ok: false, state: retained ? 'cached' : 'fallback', snapshot: snapshot, ruleCount: snapshot.rules.length,
      syncState: syncState, errorCode: 'commission_document_unavailable',
      error: retained ? '本次未取得官方佣金费率，保留上次已保存的费率。' : '未取得官方佣金费率，正在使用本地备用费率，请核对或手动填写。' };
  }

  async function readDocument(fetchImpl, url, remaining, binary, noRedirect) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, Math.min(6000, remaining));
    var reader;
    try {
      var response = await fetchImpl(url, {
        method: 'GET', cache: 'no-store', credentials: 'omit', redirect: binary || noRedirect ? 'error' : 'follow', signal: controller.signal,
      });
      if (!response || !response.ok) throw new Error('document_http_error');
      if (response.url && !(binary ? response.url === url : ['global-help.ozon.com', 'docs.ozon.com', 'docs.ozon.ru'].includes(new URL(response.url).hostname))) {
        throw new Error('document_origin_rejected');
      }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('document_too_large');
      reader = response.body.getReader();
      var chunks = [], length = 0;
      while (true) {
        var item = await reader.read();
        if (item.done) break;
        length += item.value.length;
        if (length > MAX_BYTES) throw new Error('document_too_large');
        chunks.push(item.value);
      }
      var bytes = new Uint8Array(length), offset = 0;
      chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.length; });
      return binary ? bytes : new TextDecoder().decode(bytes);
    } finally {
      clearTimeout(timer);
      if (reader) await reader.cancel().catch(function () {});
    }
  }

  async function run(options) {
    var parser = options.parser, storage = options.storage;
    var stored = await storage.get([SNAPSHOT_KEY, STATE_KEY]);
    var previous = stored[SNAPSHOT_KEY];
    var retained = previous && ['official-docs', 'system-category-db'].includes(previous.source)
      && parser.normalizeSnapshot(previous).rules.length > 0;
    var active = retained ? previous : parser.normalizeSnapshot(Object.assign({}, options.fallbackSnapshot, { fetchedAt: '' }));
    var last = stored[STATE_KEY], age = Date.now() - Date.parse(last && last.attemptedAt);
    if (options.automatic === true && last && last.status === 'failed' && age >= 0 && age < 5 * 60 * 1000) {
      return failedResult(active, last, retained);
    }
    var deadline = Date.now() + 28000;
    var attemptedAt = new Date().toISOString();
    var workbook = root.OZON_CALC_COMMISSION_WORKBOOK;
    var nativeSnapshot;
    if (workbook) {
      try {
        var endpoint = 'https://global-help.ozon.com/document-manager-api/global-help/api/v3/document/public/by-path?path=%2Fcommissions%2Fozon-fees%2Fcommissions&lang=zh&childDocsRegion=CHN&policyFilter.policy=CONTENT_POLICY_CABINET_GLOBAL';
        var payload;
        try { payload = JSON.parse(await readDocument(options.fetchImpl, endpoint, deadline - Date.now(), false, true)); }
        catch (error) {
          if (!options.readPublicDocument) throw error;
          payload = await options.readPublicDocument();
        }
        var linked = workbook.attachment(payload);
        var bytes = await readDocument(options.fetchImpl, linked.url, deadline - Date.now(), true);
        var parsed = await workbook.parse(bytes);
        var digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
        nativeSnapshot = parser.normalizeSnapshot({ source: 'official-docs', sourceUrl: options.urls[0],
          rules: parsed.rules, diagnostics: { format: 'OZON_CHN_RFBS_FBP_WORKBOOK_V1', effectiveFrom: parsed.effectiveFrom,
            documentUpdated: linked.documentUpdated, attachmentUrl: linked.url,
            attachmentSha256: Array.from(digest, function (b) { return b.toString(16).padStart(2, '0'); }).join('') } });
      } catch { /* Only the validated ordinary workbook can replace the current official snapshot. */ }
    }
    if (nativeSnapshot) {
      var nativeState = { status: 'synced', attemptedAt: attemptedAt };
      await storage.set({ [SNAPSHOT_KEY]: nativeSnapshot, [STATE_KEY]: nativeState });
      return { ok: true, state: 'official', snapshot: nativeSnapshot, ruleCount: nativeSnapshot.rules.length, syncState: nativeState };
    }
    var failure = { status: 'failed', attemptedAt: attemptedAt, errorCode: 'commission_document_unavailable' };
    await storage.set(retained ? { [STATE_KEY]: failure } : { [SNAPSHOT_KEY]: active, [STATE_KEY]: failure });
    return failedResult(active, failure, retained);
  }

  root.OZON_CALC_COMMISSION_SYNC = {
    STATE_KEY: STATE_KEY,
    synchronize: function (options) {
      if (!pending) pending = run(options).finally(function () { pending = null; });
      return pending;
    },
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
