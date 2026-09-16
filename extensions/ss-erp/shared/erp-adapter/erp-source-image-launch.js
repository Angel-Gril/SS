(function (root) {
  'use strict';
  var MESSAGE_TYPE = 'ss-erp:erp-source-image-open';
  var VERSION = 'extension-erp-source-launch/v1';
  var AUTHORITY_KEYS = ['provenance', 'ownerUserId', 'deviceSessionId', 'apiOrigin', 'webOrigin', 'grantSha256'];
  var BINDING_KEYS = ['sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion'];
  function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
  function exact(value, keys) {
    return record(value) && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }
  function text(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
      && value === value.normalize('NFKC').trim()
      && !Array.from(value).some(function (character) { return character.codePointAt(0) < 32; });
  }
  function origin(value) {
    try {
      var url = new URL(value);
      return url.origin === value && (url.protocol === 'https:'
        || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        ? value : null;
    } catch { return null; }
  }
  function fail(code) { var error = new Error(code); error.code = code; throw error; }
  function normalizeAuthority(value) {
    if (!exact(value, AUTHORITY_KEYS) || value.provenance !== 'ERP_SOURCE'
      || !text(value.ownerUserId, 200) || !text(value.deviceSessionId, 200)
      || !origin(value.apiOrigin) || !origin(value.webOrigin)
      || typeof value.grantSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.grantSha256)) return null;
    return Object.freeze(Object.fromEntries(AUTHORITY_KEYS.map(function (key) { return [key, value[key]]; })));
  }
  function sameDevice(left, right, apiOrigin) {
    return left && right && left.state === 'paired' && right.state === 'paired'
      && text(left.ownerUserId, 200) && text(left.sessionId, 200)
      && left.ownerUserId === right.ownerUserId && left.sessionId === right.sessionId
      && left.endpoint === apiOrigin && right.endpoint === apiOrigin
      && [left, right].every(function (item) {
        return Array.isArray(item.scopes) && ['listing:review', 'media:execute'].every(function (scope) {
          return item.scopes.includes(scope);
        });
      });
  }
  function normalizeGrant(value, device, apiOrigin) {
    if (!exact(value, ['contractVersion', 'provenance', 'ownerUserId', 'deviceSessionId', 'apiOrigin', 'mode', 'sourceMediaKeys', 'launchRequest', 'grantSha256'])
      || value.contractVersion !== VERSION || value.provenance !== 'ERP_SOURCE'
      || value.ownerUserId !== device.ownerUserId || value.deviceSessionId !== device.sessionId
      || value.apiOrigin !== apiOrigin || !['WORKBENCH', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(value.mode)
      || !Array.isArray(value.sourceMediaKeys) || value.sourceMediaKeys.some(function (key) { return !text(key, 500); })
      || new Set(value.sourceMediaKeys).size !== value.sourceMediaKeys.length
      || typeof value.grantSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.grantSha256)
      || !exact(value.launchRequest, BINDING_KEYS.concat(['preferredSkuKey', 'selectionKind']))) {
      fail('ERP_SOURCE_LAUNCH_AUTHORITY_INVALID');
    }
    var maximum = value.mode === 'WORKBENCH' ? 0 : value.mode === 'IMAGE_TO_IMAGE' ? 4 : 1;
    var request = value.launchRequest;
    if (value.sourceMediaKeys.length > maximum || (value.mode !== 'WORKBENCH' && value.sourceMediaKeys.length < 1)
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(request.sourcePlatform)
      || BINDING_KEYS.filter(function (key) { return !['draftRevision', 'draftVersion'].includes(key); })
        .some(function (key) { return !text(request[key], 200); })
      || !Number.isSafeInteger(request.draftRevision) || request.draftRevision < 1
      || !Number.isSafeInteger(request.draftVersion) || request.draftVersion < 1
      || !(request.preferredSkuKey === null || text(request.preferredSkuKey, 500))
      || request.selectionKind !== (request.preferredSkuKey === null ? 'HINT' : 'EXPLICIT')) {
      fail('ERP_SOURCE_LAUNCH_AUTHORITY_INVALID');
    }
    return Object.freeze({ ...value, sourceMediaKeys: Object.freeze(value.sourceMediaKeys.slice()),
      launchRequest: Object.freeze({ ...request }) });
  }
  function createLauncher(options) {
    var apiOrigin = origin(options && options.apiOrigin);
    var erpOrigins = options && Array.isArray(options.erpOrigins) ? options.erpOrigins.map(origin) : [];
    if (!apiOrigin || !erpOrigins.length || erpOrigins.some(function (value) { return !value; })
      || !text(options.runtimeId, 100) || ['readDevice', 'isSenderCurrent', 'consumeGrant', 'resolveWorkbench', 'openWorkbench', 'openEditor']
        .some(function (name) { return typeof options[name] !== 'function'; })) fail('ERP_SOURCE_LAUNCH_UNAVAILABLE');
    function sourceSender(sender) {
      try {
        var url = new URL(sender && sender.url || '');
        var tab = new URL(sender && sender.tab && sender.tab.url || '');
        if (!sender || sender.id !== options.runtimeId || sender.frameId !== 0
          || !text(sender.documentId, 200) || !Number.isSafeInteger(sender.tab.id) || sender.tab.id < 0
          || !erpOrigins.includes(url.origin) || sender.origin !== url.origin || tab.origin !== url.origin
          || url.username || url.password || tab.username || tab.password) fail('ERP_SOURCE_LAUNCH_SENDER_DENIED');
        return { tabId: sender.tab.id, documentId: sender.documentId, origin: url.origin };
      } catch { return fail('ERP_SOURCE_LAUNCH_SENDER_DENIED'); }
    }
    return Object.freeze({
      open: async function (message, sender) {
        try {
          var source = sourceSender(sender);
          if (!record(message) || message.type !== MESSAGE_TYPE
            || Object.keys(message).some(function (key) { return !['type', 'launchToken', 'requestId'].includes(key); })
            || typeof message.launchToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(message.launchToken)
            || (message.requestId !== undefined && !text(message.requestId, 200))) fail('ERP_SOURCE_LAUNCH_INPUT_INVALID');
          if (await options.isSenderCurrent(source) !== true) fail('ERP_SOURCE_LAUNCH_SENDER_STALE');
          var device = await options.readDevice();
          if (!sameDevice(device, device, apiOrigin)) fail('ERP_SOURCE_LAUNCH_DEVICE_UNAVAILABLE');
          var grant = normalizeGrant(await options.consumeGrant(message.launchToken), device, apiOrigin);
          var authority = normalizeAuthority({ provenance: 'ERP_SOURCE', ownerUserId: grant.ownerUserId,
            deviceSessionId: grant.deviceSessionId, apiOrigin: apiOrigin, webOrigin: source.origin, grantSha256: grant.grantSha256 });
          if (!authority) fail('ERP_SOURCE_LAUNCH_AUTHORITY_INVALID');
          var decision = grant.mode === 'WORKBENCH' ? await options.resolveWorkbench(grant.launchRequest) : null;
          if (!sameDevice(device, await options.readDevice(), apiOrigin)
            || await options.isSenderCurrent(source) !== true) fail('ERP_SOURCE_LAUNCH_SENDER_STALE');
          var result;
          if (grant.mode === 'WORKBENCH') {
            if (decision && decision.state === 'CHOICE_REQUIRED') return { state: 'choice_required', provenance: 'ERP_SOURCE' };
            var launch = decision && decision.context;
            if (!decision || !['READY', 'REVIEW_PUBLISH_ONLY'].includes(decision.state) || !record(launch)
              || BINDING_KEYS.some(function (key) { return launch[key] !== grant.launchRequest[key]; })
              || (grant.launchRequest.preferredSkuKey !== null && launch.skuKey !== grant.launchRequest.preferredSkuKey)) {
              fail('ERP_SOURCE_LAUNCH_CONTEXT_STALE');
            }
            result = await options.openWorkbench({ context: launch, sourceTabId: source.tabId,
              sourceDocumentId: source.documentId, erpSourceAuthority: authority });
          } else {
            result = await options.openEditor({ grant: grant, sourceTabId: source.tabId,
              sourceDocumentId: source.documentId, erpSourceAuthority: authority });
          }
          var states = grant.mode === 'WORKBENCH' ? ['workbench_opened', 'workbench_focused'] : ['editor_opened'];
          if (!result || !states.includes(result.state)
            || (result.tabId !== undefined && (!Number.isSafeInteger(result.tabId) || result.tabId < 0))
            || (grant.mode === 'WORKBENCH' && result.tabId === undefined)) fail('ERP_SOURCE_LAUNCH_RESULT_UNAVAILABLE');
          return { state: result.state, ...(result.tabId === undefined ? {} : { tabId: result.tabId }), provenance: 'ERP_SOURCE' };
        } catch (error) {
          if (error && /^ERP_(?:SOURCE_LAUNCH|LAUNCH)_[A-Z_]{1,80}$/.test(error.code || '')) throw error;
          return fail('ERP_SOURCE_LAUNCH_UNAVAILABLE');
        }
      },
    });
  }
  root.SS_ERP_ERP_SOURCE_IMAGE_LAUNCH = Object.freeze({
    MESSAGE_TYPE: MESSAGE_TYPE, CONTRACT_VERSION: VERSION,
    createLauncher: createLauncher, normalizeAuthority: normalizeAuthority,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
