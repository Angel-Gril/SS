(function (root) {
  'use strict';

  var SELLER_ORIGIN = 'https://seller.ozon.ru/*';
  var DENIED_MESSAGE = '当前 Chrome 配置文件未授权访问 seller.ozon.ru；'
    + '其他 Chrome 配置文件或扩展 ID 的授权不会共享。请再次点击当前操作并在当前窗口允许站点访问。';
  var API_UNAVAILABLE_MESSAGE = '当前扩展上下文无法检测 Seller 站点权限，请重新加载扩展后重试。';

  function permissionSpec() {
    return { origins: [SELLER_ORIGIN] };
  }

  function create(chromeApi) {
    var permissions = chromeApi && chromeApi.permissions;
    var runtime = chromeApi && chromeApi.runtime;
    var cachedGranted = null;
    var revision = 0;
    var subscribers = new Set();

    function runtimeErrorMessage() {
      var error = runtime && runtime.lastError;
      return error && error.message ? String(error.message) : '';
    }

    function publish(result) {
      subscribers.forEach(function (listener) {
        try {
          listener(result);
        } catch {}
      });
      return result;
    }

    function unavailableResult() {
      return {
        ok: false,
        granted: false,
        errorCode: 'seller_site_access_api_unavailable',
        error: API_UNAVAILABLE_MESSAGE,
      };
    }

    function checkFailure(error) {
      return {
        ok: false,
        granted: false,
        errorCode: 'seller_site_access_check_failed',
        error: error && error.message ? String(error.message) : String(error),
      };
    }

    function inspect(callback) {
      var settle = typeof callback === 'function' ? callback : function () {};
      if (!permissions || typeof permissions.contains !== 'function') {
        cachedGranted = null;
        settle(publish(unavailableResult()));
        return;
      }
      var startedAtRevision = revision;
      try {
        permissions.contains(permissionSpec(), function (granted) {
          if (startedAtRevision !== revision) {
            inspect(settle);
            return;
          }
          var error = runtimeErrorMessage();
          if (error) {
            cachedGranted = null;
            settle(publish(checkFailure(error)));
            return;
          }
          cachedGranted = Boolean(granted);
          settle(publish({ ok: true, granted: cachedGranted }));
        });
      } catch (error) {
        if (startedAtRevision === revision) {
          cachedGranted = null;
        }
        settle(publish(checkFailure(error)));
      }
    }

    function request(callback) {
      var settle = typeof callback === 'function' ? callback : function () {};
      if (cachedGranted === true) {
        inspect(function (verification) {
          if (!verification.ok) {
            settle(verification);
            return;
          }
          if (verification.granted) {
            settle({ ok: true, granted: true, requested: false });
            return;
          }
          settle({
            ok: false,
            granted: false,
            requested: false,
            errorCode: 'seller_site_access_denied',
            error: DENIED_MESSAGE,
          });
        });
        return;
      }
      if (!permissions || typeof permissions.request !== 'function') {
        cachedGranted = null;
        settle(publish(unavailableResult()));
        return;
      }

      // Keep the request synchronous with the trusted click handler.
      try {
        permissions.request(permissionSpec(), function (requested) {
          var requestError = runtimeErrorMessage();
          inspect(function (verification) {
            if (!verification.ok) {
              settle(verification);
              return;
            }
            if (verification.granted) {
              settle({ ok: true, granted: true, requested: Boolean(requested) });
              return;
            }
            if (requestError) {
              settle(publish({
                ok: false,
                granted: false,
                errorCode: 'seller_site_access_request_failed',
                error: requestError,
              }));
              return;
            }
            if (!verification.granted) {
              settle({
                ok: false,
                granted: false,
                requested: Boolean(requested),
                errorCode: 'seller_site_access_denied',
                error: DENIED_MESSAGE,
              });
              return;
            }
          });
        });
      } catch (error) {
        cachedGranted = null;
        settle(publish({
          ok: false,
          granted: false,
          errorCode: 'seller_site_access_request_failed',
          error: error && error.message ? String(error.message) : String(error),
        }));
      }
    }

    function prime() {
      inspect(function () {});
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') return function () {};
      subscribers.add(listener);
      return function () {
        subscribers.delete(listener);
      };
    }

    function affectsSellerOrigin(change) {
      var origins = change && Array.isArray(change.origins) ? change.origins : [];
      return origins.some(function (origin) {
        var value = String(origin || '').toLowerCase();
        return value === '<all_urls>'
          || value === 'https://*/*'
          || value === '*://*/*'
          || value === SELLER_ORIGIN
          || value === 'https://*.ozon.ru/*';
      });
    }

    if (permissions && permissions.onRemoved && typeof permissions.onRemoved.addListener === 'function') {
      permissions.onRemoved.addListener(function (change) {
        if (!affectsSellerOrigin(change)) return;
        revision += 1;
        cachedGranted = null;
        inspect(function () {});
      });
    }
    if (permissions && permissions.onAdded && typeof permissions.onAdded.addListener === 'function') {
      permissions.onAdded.addListener(function (change) {
        if (!affectsSellerOrigin(change)) return;
        revision += 1;
        cachedGranted = null;
        inspect(function () {});
      });
    }

    return Object.freeze({
      inspect: inspect,
      prime: prime,
      request: request,
      subscribe: subscribe,
    });
  }

  var defaultAccess = create(root.chrome);
  defaultAccess.prime();

  root.SS_ERP_SELLER_ORIGIN_ACCESS = Object.freeze({
    SELLER_ORIGIN: SELLER_ORIGIN,
    create: create,
    inspect: defaultAccess.inspect,
    prime: defaultAccess.prime,
    request: defaultAccess.request,
    subscribe: defaultAccess.subscribe,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
