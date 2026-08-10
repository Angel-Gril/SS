(function (global) {
  'use strict';

  var ANALYTICS_KIND = 'analytics';
  var GRAPHS_KIND = 'analytics-graphs';

  function shopId(value) {
    var text = String(value == null ? '' : value);
    var normalized = text.normalize('NFKC').trim();
    if (!normalized || normalized !== text || normalized.length > 200
      || normalized.includes('/') || normalized.includes('\\')) {
      throw new TypeError('shopId is invalid');
    }
    return normalized;
  }

  function payload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('analytics payload is invalid');
    }
    return value;
  }

  function errorResult(errorCode, message, extra) {
    return {
      ok: false,
      errorCode: errorCode,
      error: message,
      ...(extra || {}),
    };
  }

  function createWriter(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.post !== 'function') {
      throw new TypeError('device transport is required');
    }

    return {
      async write(input) {
        var kind = String(input && input.kind || '');
        if (kind !== ANALYTICS_KIND && kind !== GRAPHS_KIND) {
          throw new TypeError('analytics kind is invalid');
        }
        var normalizedShopId = shopId(input && input.shopId);
        var requestPayload = payload(input && input.payload);
        var path = '/api/extension-device/shops/'
          + encodeURIComponent(normalizedShopId) + '/' + kind;
        var result;
        try {
          result = await transport.post(path, requestPayload, {
            requiredScope: 'capture:write',
          });
        } catch (error) {
          var unknown = error && error.outcome === 'UNKNOWN_OUTCOME';
          return errorResult(
            unknown
              ? 'device_analytics_write_outcome_unknown'
              : 'device_analytics_write_failed',
            error && error.message ? error.message : '设备分析数据写入失败',
            unknown
              ? { outcome: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false }
              : null,
          );
        }

        if (!result || result.state === 'unpaired') {
          return errorResult('device_unpaired', '设备未配对');
        }
        if (result.state === 'scope_required') {
          return errorResult('device_scope_required', '设备缺少分析数据写入权限');
        }
        if (result.state === 'authorization_required') {
          return errorResult('device_authorization_required', '设备授权已失效，请重新配对');
        }
        if (result.state === 'http_error') {
          var errorBody = result.body && typeof result.body === 'object' ? result.body : {};
          return errorResult(
            String(errorBody.errorCode || 'device_analytics_write_failed'),
            String(errorBody.msg || errorBody.error || ('ERP 返回 HTTP ' + result.status)),
            { status: result.status },
          );
        }
        if (result.state !== 'response' || !result.body || result.body.code !== 1) {
          var body = result && result.body && typeof result.body === 'object' ? result.body : {};
          return errorResult(
            String(body.errorCode || 'device_analytics_write_failed'),
            String(body.msg || body.error || '设备分析数据写入失败'),
            result && Number.isSafeInteger(result.status) ? { status: result.status } : null,
          );
        }
        return {
          ok: true,
          authMode: 'device',
          data: result.body.data,
        };
      },
    };
  }

  global.SS_ERP_SHOP_ANALYTICS_DEVICE_WRITER = {
    createWriter: createWriter,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
