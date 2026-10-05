(function (global) {
  'use strict';
  var MESSAGE_TYPES = Object.freeze({
    GET_READINESS: 'ss-erp:product-analysis-readiness',
    ANALYZE: 'ss-erp:product-analysis-analyze',
    READ: 'ss-erp:product-analysis-read',
    CHECKPOINT_READ: 'ss-erp:preparation-checkpoint-read',
    CHECKPOINT_WRITE: 'ss-erp:preparation-checkpoint-write',
    CHECKPOINT_CLEAR: 'ss-erp:preparation-checkpoint-clear',
    PERMISSION_PREPARE: 'ss-erp:product-analysis-permission-prepare',
    PERMISSION_COMMIT: 'ss-erp:product-analysis-permission-commit',
  });
  function error(code, outcome) {
    var result = new Error(code); result.code = code; result.outcome = outcome || 'NOT_SUBMITTED'; result.automaticRetryAllowed = false; return result;
  }
  function createClient(options) {
    var runtime = options && options.runtime;
    var permissions = options && options.permissions;
    var preparedPermissions = new Map();
    var timeoutMs = options?.timeoutMs ?? 210000;
    if (!runtime || typeof runtime.sendMessage !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 210000) throw error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_UNAVAILABLE');
    function send(type, payload, mutation) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        function finish(cause, value) { if (settled) return; settled = true; clearTimeout(timer); cause ? reject(cause) : resolve(value); }
        var timer = setTimeout(function () { finish(error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_TIMEOUT', mutation ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED')); },
          type === MESSAGE_TYPES.ANALYZE ? timeoutMs : 30000);
        try {
          runtime.sendMessage({ type: type, payload: payload }, function (response) {
            if (runtime.lastError || !response || typeof response !== 'object') { finish(error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_TRANSPORT', mutation ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED')); return; }
            if (response.ok !== true) {
              var code = /^[A-Z][A-Z0-9_]{0,99}$/u.test(response.errorCode || '') ? response.errorCode : 'SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_FAILED';
              finish(error(code, response.outcome === 'UNKNOWN_OUTCOME' ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED')); return;
            }
            finish(null, response.data);
          });
        } catch { finish(error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_TRANSPORT', mutation ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED')); }
      });
    }
    async function prepareProductAnalysisPermission(input) {
      var value = await send(MESSAGE_TYPES.PERMISSION_PREPARE, input, false), url;
      try { url = new URL(value?.providerOrigin); } catch { throw error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_TICKET_INVALID'); }
      if (!value || Object.keys(value).length !== 4 || typeof value.permissionTicket !== 'string' || value.permissionTicket.length < 8 || value.permissionTicket.length > 128
        || url.protocol !== 'https:' || url.origin !== value.providerOrigin || url.pathname !== '/' || url.username || url.password || url.search || url.hash
        || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu.test(url.hostname) || /^\d+(?:\.\d+){3}$/u.test(url.hostname)
        || /(?:^|\.)(?:localhost|local|internal)$/iu.test(url.hostname) || value.pattern !== value.providerOrigin + '/*'
        || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 120000) throw error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_TICKET_INVALID');
      if (preparedPermissions.size >= 16) preparedPermissions.delete(preparedPermissions.keys().next().value);
      var ticket = Object.freeze({ ...value });
      preparedPermissions.set(ticket.permissionTicket, { fingerprint: JSON.stringify(ticket), input: JSON.parse(JSON.stringify(input)) });
      return ticket;
    }
    function authorizeProductAnalysis(event, ticket) {
      var retained = preparedPermissions.get(ticket?.permissionTicket);
      preparedPermissions.delete(ticket?.permissionTicket);
      if (!event || event.isTrusted !== true) throw error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_GESTURE_REQUIRED');
      if (!retained || retained.fingerprint !== JSON.stringify(ticket) || ticket.expiresAt <= Date.now()) throw error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_TICKET_INVALID');
      if (!permissions || typeof permissions.request !== 'function') throw error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_UNAVAILABLE');
      // Invoke Chrome synchronously in the click task. Preparing the server
      // ticket beforehand avoids losing transient user activation at an await.
      return new Promise(function (resolve, reject) {
        try {
          permissions.request({ origins: [ticket.pattern] }, function (granted) {
            if (runtime.lastError) { reject(error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_UNAVAILABLE')); return; }
            if (granted !== true) { resolve({ granted: false }); return; }
            send(MESSAGE_TYPES.PERMISSION_COMMIT, { ...retained.input, permissionTicket: ticket.permissionTicket }, false).then(resolve, reject);
          });
        } catch { reject(error('SS_ERP_BYOK_PRODUCT_ANALYSIS_PERMISSION_UNAVAILABLE')); }
      });
    }
    return Object.freeze({ getReadiness: function (input) { return send(MESSAGE_TYPES.GET_READINESS, input, false); },
      prepareProductAnalysisPermission: prepareProductAnalysisPermission, authorizeProductAnalysis: authorizeProductAnalysis,
      invalidatePreparedPermissions: function () { preparedPermissions.clear(); },
      analyzeProduct: function (input) { return send(MESSAGE_TYPES.ANALYZE, input, true); },
      readProductAnalysis: function (input) { return send(MESSAGE_TYPES.READ, input, false); },
      checkpoint: Object.freeze({ read: function (input) { return send(MESSAGE_TYPES.CHECKPOINT_READ, input, false); },
        write: function (input) { return send(MESSAGE_TYPES.CHECKPOINT_WRITE, input, false); },
        clear: function (input) { return send(MESSAGE_TYPES.CHECKPOINT_CLEAR, input, false); } }) });
  }
  global.SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_CLIENT = Object.freeze({ MESSAGE_TYPES: MESSAGE_TYPES, createClient: createClient });
}(typeof globalThis !== 'undefined' ? globalThis : self));
