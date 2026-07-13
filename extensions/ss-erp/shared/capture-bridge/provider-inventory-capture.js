(function (global) {
  'use strict';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function safeIsoDate(value) {
    var parsed = new Date(text(value));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  }

  function normalizePoint(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
      throw new TypeError('provider inventory point is invalid');
    }
    var latitude = value.latitude;
    var longitude = value.longitude;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new TypeError('provider inventory point is invalid');
    }
    return { latitude: latitude, longitude: longitude };
  }

  function samePoint(left, right) {
    return left.latitude === right.latitude && left.longitude === right.longitude;
  }

  function inventoryScope(entry) {
    try {
      var request = entry && entry.request && entry.request.postData;
      var payload = JSON.parse(text(request && request.text));
      var companyId = text(payload.companyId);
      if (!companyId) return null;
      return { companyId: companyId, point: normalizePoint(payload.point) };
    } catch (_error) {
      return null;
    }
  }

  var REQUIRED_SELLER_ENDPOINTS = [
    '/provider/template/by-location/list',
    '/provider/template/category/list',
    '/provider/template/speed/list',
  ];

  function requestCompanyId(entry) {
    try {
      var postData = entry && entry.request && entry.request.postData;
      var payload = JSON.parse(text(postData && postData.text));
      return text(payload.company_id || payload.companyId);
    } catch (_error) {
      return '';
    }
  }

  function prioritizeSellerEndpointEntries(entries, companyId) {
    var latest = {};
    var remaining = [];
    (Array.isArray(entries) ? entries : []).forEach(function (entry) {
      var url = text(entry && entry.request && entry.request.url);
      var endpoint = REQUIRED_SELLER_ENDPOINTS.find(function (keyword) {
        return url.indexOf(keyword) >= 0;
      });
      if (!endpoint || requestCompanyId(entry) !== companyId) {
        remaining.push(entry);
        return;
      }
      if (latest[endpoint]) remaining.push(latest[endpoint]);
      latest[endpoint] = entry;
    });
    return remaining.concat(REQUIRED_SELLER_ENDPOINTS.map(function (endpoint) {
      return latest[endpoint];
    }).filter(Boolean));
  }

  function createAppender() {
    return function appendSellerProviderInventory(existingEntries, rawInventory, limit) {
      rawInventory = rawInventory && typeof rawInventory === 'object' ? rawInventory : {};
      var companyId = text(rawInventory.companyId);
      var point = normalizePoint(rawInventory.point);
      if (!companyId || companyId.length > 300) {
        throw new TypeError('provider inventory companyId is invalid');
      }
      var allowedSources = ['method', 'template', 'both', 'warehouse'];
      var allowedStatuses = ['pending', 'succeeded', 'empty', 'failed'];
      var providers = (Array.isArray(rawInventory.providers) ? rawInventory.providers : []).map(function (provider) {
        provider = provider && typeof provider === 'object' ? provider : {};
        var providerId = text(provider.providerId);
        var providerName = text(provider.providerName);
        var source = text(provider.source).toLowerCase();
        var status = text(provider.status).toLowerCase();
        var pointCount = Number(provider.pointCount);
        if (!providerId || !providerName || providerId.length > 300 || providerName.length > 500
          || allowedSources.indexOf(source) < 0 || allowedStatuses.indexOf(status) < 0
          || !Number.isSafeInteger(pointCount) || pointCount < 0) {
          throw new TypeError('provider inventory row is invalid');
        }
        return {
          providerId: providerId,
          providerName: providerName,
          source: source,
          status: status,
          pointCount: pointCount,
        };
      });
      var stats = rawInventory.providerStats && typeof rawInventory.providerStats === 'object'
        ? rawInventory.providerStats : {};
      var providerStats = {
        discovered: Number(stats.discovered),
        attempted: Number(stats.attempted),
        succeeded: Number(stats.succeeded),
        failed: Number(stats.failed),
        empty: Number(stats.empty),
        catalogComplete: typeof stats.catalogComplete === 'boolean'
          ? stats.catalogComplete : stats.complete === true,
        methodBindingsComplete: typeof stats.methodBindingsComplete === 'boolean'
          ? stats.methodBindingsComplete : false,
        methodBindingsRequired: typeof stats.methodBindingsRequired === 'boolean'
          ? stats.methodBindingsRequired : false,
        complete: typeof stats.complete === 'boolean'
          ? stats.complete : false,
      };
      ['discovered', 'attempted', 'succeeded', 'failed', 'empty'].forEach(function (field) {
        if (!Number.isSafeInteger(providerStats[field]) || providerStats[field] < 0) {
          throw new TypeError('provider inventory stats are invalid');
        }
      });
      var capturedAt = safeIsoDate(rawInventory.capturedAt);
      var existing = (Array.isArray(existingEntries) ? existingEntries : []).filter(function (entry) {
        if (text(entry && entry.request && entry.request.url)
          !== 'ss-erp://capture/seller/provider-inventory') return true;
        var scope = inventoryScope(entry);
        return scope && (scope.companyId !== companyId || !samePoint(scope.point, point));
      });
      existing = prioritizeSellerEndpointEntries(existing, companyId);
      existing.push({
        capturedAt: capturedAt,
        startedDateTime: capturedAt,
        pageUrl: 'ss-erp://capture/seller',
        request: {
          method: 'POST',
          url: 'ss-erp://capture/seller/provider-inventory',
          postData: { text: JSON.stringify({ companyId: companyId, point: point }) },
        },
        response: {
          status: 200,
          content: {
            mimeType: 'application/json',
            text: JSON.stringify({
              companyId: companyId,
              providers: providers,
              providerStats: providerStats,
            }),
          },
        },
        _ozonCalc: {
          mode: 'seller',
          source: 'seller-provider-inventory-capture',
          pageUrl: 'ss-erp://capture/seller',
          capturedAt: capturedAt,
        },
      });
      var maxEntries = Math.max(1, Number(limit) || 200);
      return existing.length > maxEntries ? existing.slice(existing.length - maxEntries) : existing;
    };
  }

  global.SS_ERP_PROVIDER_INVENTORY_CAPTURE = {
    createAppender: createAppender,
    appendSellerProviderInventory: createAppender(),
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
