(function exposeErpSourcePrecisionLaunch(root) {
  'use strict';

  var CONTRACT_VERSION = 'extension-erp-source-precision-launch/v1';
  var STORAGE_KEY = 'ss-erp:erp-source-precision-launches:v1';
  var OPEN_MESSAGE_TYPE = 'ss-erp:precision-erp-workbench-open';
  var CLAIM_MESSAGE_TYPE = 'ss-erp:precision-erp-launch-claim';
  var TTL_MS = 10000;
  var LOADING_TIMEOUT_MS = 3000;
  var RETRY_DELAY_MS = 50;
  var MAX_PENDING = 8;
  var queues = new WeakMap();
  var ORIGINS = Object.freeze({
    '1688': 'https://detail.1688.com', taobao: 'https://item.taobao.com',
    tmall: 'https://detail.tmall.com', pdd: 'https://mobile.yangkeduo.com',
  });

  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys) {
    return record(value) && Object.keys(value).length === keys.length
      && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
  }
  function text(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
      && value === value.normalize('NFKC').trim()
      && !Array.from(value).some(function (character) { var code = character.charCodeAt(0); return code < 32 || code === 127; });
  }
  function tabId(value) { return Number.isSafeInteger(value) && value >= 0; }
  function nonceValid(value) { return typeof value === 'string' && /^[a-f0-9]{48}$/u.test(value); }
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function safeError(error, fallback) {
    var code = error && /^ERP_SOURCE_PRECISION_[A-Z_]{1,80}$/u.test(error.code || '') ? error.code : fallback;
    return Object.assign(new Error(code), { code: code });
  }
  function canonicalSourceUrl(context) {
    if (!record(context) || !Object.prototype.hasOwnProperty.call(ORIGINS, context.sourcePlatform)
      || !text(context.sourceProductId, 200)) fail('ERP_SOURCE_PRECISION_CONTEXT_INVALID');
    var productId = encodeURIComponent(context.sourceProductId);
    return ORIGINS[context.sourcePlatform] + (context.sourcePlatform === '1688'
      ? '/offer/' + productId + '.html' : context.sourcePlatform === 'pdd'
        ? '/goods.html?goods_id=' + productId : '/item.htm?id=' + productId);
  }
  function normalizeContext(value) {
    var api = root.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION;
    if (!api || typeof api.normalizeContext !== 'function') fail('ERP_SOURCE_PRECISION_UNAVAILABLE');
    try { return api.normalizeContext(value); } catch { return fail('ERP_SOURCE_PRECISION_CONTEXT_INVALID'); }
  }
  function normalizeAuthority(value) {
    var api = root.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH;
    var normalized = api && typeof api.normalizeAuthority === 'function' && api.normalizeAuthority(value);
    if (!normalized) fail('ERP_SOURCE_PRECISION_AUTHORITY_INVALID');
    return normalized;
  }
  function normalizeHandoff(value, context) {
    if (!exact(value, ['snapshotId', 'supplyGoodsId', 'snapshotVersion', 'sourceProductId', 'platform', 'path'])
      || value.snapshotId !== context.sourceCaptureSnapshotId || value.supplyGoodsId !== context.supplyGoodsId
      || value.sourceProductId !== context.sourceProductId || value.platform !== context.sourcePlatform
      || !Number.isSafeInteger(value.snapshotVersion) || value.snapshotVersion < 1) fail('ERP_SOURCE_PRECISION_BINDING_STALE');
    var path = '/collect/source?supplyGoodsId=' + encodeURIComponent(value.supplyGoodsId)
      + '&snapshotId=' + encodeURIComponent(value.snapshotId) + '&snapshotVersion=' + value.snapshotVersion
      + '&sourceProductId=' + encodeURIComponent(value.sourceProductId) + '&platform=' + value.platform + '&section=listing';
    if (value.path !== path) fail('ERP_SOURCE_PRECISION_BINDING_STALE');
    return Object.freeze({ snapshotId: value.snapshotId, supplyGoodsId: value.supplyGoodsId,
      snapshotVersion: value.snapshotVersion, sourceProductId: value.sourceProductId, platform: value.platform, path: path });
  }

  function createLauncher(options) {
    var tabs = options && options.tabs;
    var storage = options && options.sessionStorage;
    if (!options || !text(options.runtimeId, 200) || !tabs
      || ['query', 'create', 'get', 'update', 'sendMessage'].some(function (key) { return typeof tabs[key] !== 'function'; })
      || !storage || ['get', 'set'].some(function (key) { return typeof storage[key] !== 'function'; })
      || ['resolveProductUrl', 'verifyErpSourceAuthority', 'verifySourceDocument', 'loadBinding', 'persistHandoff'].some(function (key) {
        return typeof options[key] !== 'function';
      })) fail('ERP_SOURCE_PRECISION_UNAVAILABLE');
    var now = options.now || Date.now;
    var delay = options.delay || function (milliseconds) { return new Promise(function (resolve) { root.setTimeout(resolve, milliseconds); }); };
    var randomNonce = options.randomNonce || function () {
      return Array.from(root.crypto.getRandomValues(new Uint8Array(24)), function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
    };
    var loadingTimeout = options.loadingTimeoutMs === undefined ? LOADING_TIMEOUT_MS : options.loadingTimeoutMs;
    var acknowledgementTimeout = options.acknowledgementTimeoutMs === undefined ? 30000 : options.acknowledgementTimeoutMs;
    if (typeof now !== 'function' || typeof delay !== 'function' || typeof randomNonce !== 'function'
      || !Number.isSafeInteger(loadingTimeout) || loadingTimeout < 0 || loadingTimeout > LOADING_TIMEOUT_MS
      || !Number.isSafeInteger(acknowledgementTimeout) || acknowledgementTimeout < 1 || acknowledgementTimeout > 90000) fail('ERP_SOURCE_PRECISION_UNAVAILABLE');

    function timestamp() {
      var value = now();
      if (!Number.isSafeInteger(value) || value < 0) fail('ERP_SOURCE_PRECISION_CLOCK_INVALID');
      return value;
    }
    function enqueue(operation) {
      var previous = queues.get(storage) || Promise.resolve();
      var next = previous.then(operation, operation);
      queues.set(storage, next.catch(function () {}));
      return next;
    }
    function matchesSource(value, context) {
      try {
        var url = new URL(value), expected = new URL(canonicalSourceUrl(context));
        var product = options.resolveProductUrl(url.href);
        return url.protocol === 'https:' && url.origin === expected.origin && url.pathname === expected.pathname
          && !url.username && !url.password && !url.hash && !url.port
          && product && product.sourcePlatform === context.sourcePlatform && product.sourceProductId === context.sourceProductId;
      } catch { return false; }
    }
    async function load() {
      var values = await storage.get([STORAGE_KEY]);
      var state = values && values[STORAGE_KEY];
      if (state === undefined) return { contractVersion: CONTRACT_VERSION, records: {} };
      if (!exact(state, ['contractVersion', 'records']) || state.contractVersion !== CONTRACT_VERSION
        || !record(state.records) || Object.keys(state.records).length > MAX_PENDING) fail('ERP_SOURCE_PRECISION_STATE_INVALID');
      Object.entries(state.records).forEach(function (entry) {
        var key = entry[0], value = entry[1];
        if (!nonceValid(key) || !exact(value, ['context', 'erpSourceAuthority', 'sourceTabId', 'sourceDocumentId',
          'tabId', 'sourceUrl', 'createdAt', 'expiresAt', 'state', 'claimDocumentId', 'claimedAt'])
          || !tabId(value.sourceTabId) || !tabId(value.tabId) || !text(value.sourceDocumentId, 200)
          || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || !Number.isSafeInteger(value.expiresAt)
          || value.createdAt > timestamp()
          || !['PENDING', 'CLAIMING', 'CLAIMED'].includes(value.state)
          || (value.state === 'PENDING' ? value.claimDocumentId !== null : !text(value.claimDocumentId, 200))
          || (value.state === 'CLAIMED'
            ? !Number.isSafeInteger(value.claimedAt) || value.claimedAt < value.createdAt || value.claimedAt > timestamp()
              || value.expiresAt - value.claimedAt !== acknowledgementTimeout
            : value.claimedAt !== null || value.expiresAt - value.createdAt !== TTL_MS)) fail('ERP_SOURCE_PRECISION_STATE_INVALID');
        value.context = normalizeContext(value.context);
        value.erpSourceAuthority = normalizeAuthority(value.erpSourceAuthority);
        if (!matchesSource(value.sourceUrl, value.context)) fail('ERP_SOURCE_PRECISION_STATE_INVALID');
      });
      return state;
    }
    async function save(state) { await storage.set({ [STORAGE_KEY]: state }); }
    async function discard(nonce) {
      await enqueue(async function () { var state = await load(); delete state.records[nonce]; await save(state); });
    }
    function authorityInput(value) {
      return { erpSourceAuthority: value.erpSourceAuthority, sourceTabId: value.sourceTabId, sourceDocumentId: value.sourceDocumentId };
    }
    async function verifyAuthority(value) {
      if (await options.verifyErpSourceAuthority(authorityInput(value)) !== true) fail('ERP_SOURCE_PRECISION_AUTHORITY_STALE');
    }
    async function verifyBinding(context) {
      var loaded = await options.loadBinding(context);
      if (!exact(loaded, ['context', 'handoff'])
        || JSON.stringify(normalizeContext(loaded.context)) !== JSON.stringify(context)) fail('ERP_SOURCE_PRECISION_BINDING_STALE');
      return normalizeHandoff(loaded.handoff, context);
    }
    async function currentTab(value) {
      var current = await tabs.get(value.tabId);
      if (!current || current.id !== value.tabId || !matchesSource(current.url, value.context)
        || current.pendingUrl && !matchesSource(current.pendingUrl, value.context)) fail('ERP_SOURCE_PRECISION_SOURCE_CHANGED');
      return current;
    }
    function validateSender(sender, value) {
      if (!sender || sender.id !== options.runtimeId || sender.frameId !== 0
        || !sender.tab || sender.tab.id !== value.tabId || !text(sender.documentId, 200)
        || !matchesSource(sender.url, value.context) || !matchesSource(sender.tab.url, value.context)
        || sender.documentUrl !== undefined && sender.documentUrl !== sender.url
        || sender.origin !== new URL(sender.url).origin
        || sender.tab.pendingUrl && !matchesSource(sender.tab.pendingUrl, value.context)) fail('ERP_SOURCE_PRECISION_SENDER_DENIED');
    }

    async function claim(message, sender) {
      try {
        if (!exact(message, ['type', 'nonce']) || message.type !== CLAIM_MESSAGE_TYPE || !nonceValid(message.nonce)) fail('ERP_SOURCE_PRECISION_CLAIM_INVALID');
        var pending = await enqueue(async function () {
          var state = await load(), value = state.records[message.nonce];
          if (!value || value.state !== 'PENDING' || value.expiresAt <= timestamp()) fail('ERP_SOURCE_PRECISION_NONCE_UNAVAILABLE');
          validateSender(sender, value);
          value.state = 'CLAIMING'; value.claimDocumentId = sender.documentId;
          await save(state);
          return copy(value);
        });
        await currentTab(pending);
        await verifyAuthority(pending);
        var handoff = await verifyBinding(pending.context);
        await verifyAuthority(pending);
        await currentTab(pending);
        // Only a server-read handoff enters the normal capture cache. No binding is written here.
        var persisted = await options.persistHandoff(handoff);
        if (persisted !== undefined && JSON.stringify(normalizeHandoff(persisted, pending.context)) !== JSON.stringify(handoff)) fail('ERP_SOURCE_PRECISION_BINDING_STALE');
        await currentTab(pending);
        await enqueue(async function () {
          var state = await load(), latest = state.records[message.nonce];
          if (!latest || latest.state !== 'CLAIMING' || latest.claimDocumentId !== sender.documentId
            || latest.expiresAt <= timestamp()) fail('ERP_SOURCE_PRECISION_NONCE_UNAVAILABLE');
          // The one-time claim is now consumed. Slow read-only UI refresh gets its
          // own bounded acknowledgement lease and cannot claim the nonce again.
          latest.state = 'CLAIMED'; latest.claimedAt = timestamp();
          latest.expiresAt = latest.claimedAt + acknowledgementTimeout;
          await save(state);
        });
        return Object.freeze({ context: Object.freeze(copy(pending.context)), handoff: handoff });
      } catch (error) { throw safeError(error, 'ERP_SOURCE_PRECISION_CLAIM_UNAVAILABLE'); }
    }

    async function deliver(value, nonce) {
      var startedAt = timestamp(), attempts = 0;
      while (attempts++ < 61) {
        var current = await tabs.get(value.tabId);
        if (!current || current.id !== value.tabId) fail('ERP_SOURCE_PRECISION_SOURCE_CHANGED');
        if (!matchesSource(current.url, value.context)) {
          if (!matchesSource(current.pendingUrl, value.context) || current.status !== 'loading') fail('ERP_SOURCE_PRECISION_SOURCE_CHANGED');
        } else {
          if (current.pendingUrl && !matchesSource(current.pendingUrl, value.context)) fail('ERP_SOURCE_PRECISION_SOURCE_CHANGED');
          var acknowledgementTimer;
          try {
            return await Promise.race([
              tabs.sendMessage(value.tabId, { type: OPEN_MESSAGE_TYPE, nonce: nonce }, { frameId: 0 }),
              new Promise(function (_resolve, reject) {
                acknowledgementTimer = root.setTimeout(function () {
                  reject(Object.assign(new Error('ERP_SOURCE_PRECISION_ACK_UNKNOWN'), { code: 'ERP_SOURCE_PRECISION_ACK_UNKNOWN' }));
                }, acknowledgementTimeout);
              }),
            ]);
          } catch (error) {
            // Chrome proves this request was not delivered; every other transport error is unknown.
            if (!/^(?:Could not establish connection\. Receiving end does not exist\.?|Receiving end does not exist\.?)$/u.test(error && error.message || '')) {
              fail('ERP_SOURCE_PRECISION_ACK_UNKNOWN');
            }
          } finally { if (acknowledgementTimer !== undefined) root.clearTimeout(acknowledgementTimer); }
        }
        if (timestamp() - startedAt >= loadingTimeout) fail('ERP_SOURCE_PRECISION_SOURCE_NOT_READY');
        await delay(Math.min(RETRY_DELAY_MS, loadingTimeout - (timestamp() - startedAt)));
      }
      return fail('ERP_SOURCE_PRECISION_SOURCE_NOT_READY');
    }

    async function open(input) {
      var nonce, registered = false;
      try {
        if (!exact(input, ['context', 'sourceTabId', 'sourceDocumentId', 'erpSourceAuthority'])
          || !tabId(input.sourceTabId) || !text(input.sourceDocumentId, 200)) fail('ERP_SOURCE_PRECISION_CONTEXT_INVALID');
        var value = { context: normalizeContext(input.context), erpSourceAuthority: normalizeAuthority(input.erpSourceAuthority),
          sourceTabId: input.sourceTabId, sourceDocumentId: input.sourceDocumentId };
        await verifyAuthority(value);
        await verifyBinding(value.context);
        var candidates = await tabs.query({});
        if (!Array.isArray(candidates)) fail('ERP_SOURCE_PRECISION_SOURCE_UNAVAILABLE');
        var matches = candidates.filter(function (tab) {
          return tab && tabId(tab.id) && matchesSource(tab.pendingUrl || tab.url, value.context);
        });
        if (matches.length > 1) fail('ERP_SOURCE_PRECISION_SOURCE_AMBIGUOUS');
        var created = matches.length === 0;
        var source = created ? await tabs.create({ url: canonicalSourceUrl(value.context), active: false }) : matches[0];
        if (!source || !tabId(source.id)) fail('ERP_SOURCE_PRECISION_SOURCE_UNAVAILABLE');
        value.tabId = source.id; value.sourceUrl = canonicalSourceUrl(value.context);
        await verifyAuthority(value);
        nonce = randomNonce();
        if (!nonceValid(nonce)) fail('ERP_SOURCE_PRECISION_NONCE_INVALID');
        await enqueue(async function () {
          var state = await load(), current = timestamp();
          Object.keys(state.records).forEach(function (key) { if (state.records[key].expiresAt <= current) delete state.records[key]; });
          if (state.records[nonce] || Object.keys(state.records).length >= MAX_PENDING) fail('ERP_SOURCE_PRECISION_CAPACITY_EXCEEDED');
          state.records[nonce] = { ...value, createdAt: current, expiresAt: current + TTL_MS,
            state: 'PENDING', claimDocumentId: null, claimedAt: null };
          await save(state);
          registered = true;
        });
        var response = await deliver(value, nonce);
        var state = await load(), claimed = state.records[nonce];
        if (!claimed || claimed.state !== 'CLAIMED' || claimed.expiresAt <= timestamp()
          || !exact(response, ['ok', 'state', 'workflowId', 'draftRevision', 'draftVersion'])
          || response.ok !== true || response.state !== 'WORKBENCH_OPENED'
          || response.workflowId !== value.context.workflowId || response.draftRevision !== value.context.draftRevision
          || response.draftVersion !== value.context.draftVersion) fail('ERP_SOURCE_PRECISION_ACK_INVALID');
        await verifyAuthority(value);
        await verifyBinding(value.context);
        await currentTab(value);
        // A matching URL does not prove the claiming document survived a reload.
        // This read must target that exact Chrome document, never replay its open nonce.
        if (await options.verifySourceDocument({ tabId: value.tabId, documentId: claimed.claimDocumentId,
          context: value.context }) !== true) fail('ERP_SOURCE_PRECISION_SOURCE_CHANGED');
        await tabs.update(value.tabId, { active: true });
        return Object.freeze({ state: created ? 'workbench_opened' : 'workbench_focused', tabId: value.tabId });
      } catch (error) { throw safeError(error, 'ERP_SOURCE_PRECISION_UNAVAILABLE'); }
      finally { if (registered) { try { await discard(nonce); } catch {} } }
    }
    return Object.freeze({ open: open, claim: claim });
  }

  root.SS_ERP_ERP_SOURCE_PRECISION_LAUNCH = Object.freeze({ CONTRACT_VERSION: CONTRACT_VERSION,
    STORAGE_KEY: STORAGE_KEY, OPEN_MESSAGE_TYPE: OPEN_MESSAGE_TYPE, CLAIM_MESSAGE_TYPE: CLAIM_MESSAGE_TYPE,
    canonicalSourceUrl: canonicalSourceUrl, createLauncher: createLauncher });
}(typeof globalThis !== 'undefined' ? globalThis : self));
