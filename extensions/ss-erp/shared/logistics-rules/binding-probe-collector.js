(function (global) {
  'use strict';

  async function collectWarehouseEvidence(input) {
    function text(value) {
      return String(value == null ? '' : value).trim();
    }

    function record(value) {
      return value && typeof value === 'object' && !Array.isArray(value);
    }

    function rowId(row, keys) {
      if (!record(row)) return '';
      for (var index = 0; index < keys.length; index += 1) {
        var value = text(row[keys[index]]);
        if (value) return value;
      }
      return '';
    }

    function requestCompanyId(companyId) {
      var numeric = Number(companyId);
      return /^[0-9]+$/.test(companyId) && Number.isSafeInteger(numeric) && numeric > 0
        ? numeric : companyId;
    }

    function buildMatches(expected, matchedProbeIds, companyId) {
      return expected.filter(function (candidate) {
        return matchedProbeIds.has(candidate.probeId);
      }).map(function (candidate) {
        return {
          probeId: candidate.probeId,
          evidence: {
            companyId: companyId,
            warehouse: { platformWarehouseId: candidate.warehouseId },
            deliveryMethod: { platformMethodId: candidate.methodId },
          },
        };
      });
    }

    function requestHeaders(companyId, pageType) {
      var headers = {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json',
        'x-o3-app-name': 'seller-ui',
        'x-o3-company-id': companyId,
        'x-o3-language': 'ru',
      };
      if (pageType) headers['x-o3-page-type'] = pageType;
      return headers;
    }

    async function readResponseText(response, maxBytes) {
      if (response.body && typeof response.body.getReader === 'function') {
        var reader = response.body.getReader();
        var chunks = [];
        var totalBytes = 0;
        while (true) {
          var part = await reader.read();
          if (part && part.done) break;
          var value = part && part.value;
          var chunkBytes = value && Number(value.byteLength);
          if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0) {
            try { await reader.cancel(); } catch (_cancelError) {}
            return null;
          }
          totalBytes += chunkBytes;
          if (!Number.isSafeInteger(totalBytes) || totalBytes > maxBytes) {
            try { await reader.cancel(); } catch (_cancelError) {}
            return null;
          }
          chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value));
        }
        try {
          if (typeof reader.releaseLock === 'function') reader.releaseLock();
        } catch (_releaseError) {}
        if (!totalBytes) return null;
        var merged = new Uint8Array(totalBytes);
        var offset = 0;
        for (var chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          merged.set(chunks[chunkIndex], offset);
          offset += chunks[chunkIndex].byteLength;
        }
        return new TextDecoder('utf-8').decode(merged);
      }
      var fallback = await response.text();
      if (typeof fallback !== 'string' || !fallback) return null;
      var fallbackBytes = new TextEncoder().encode(fallback).byteLength;
      return fallbackBytes <= maxBytes ? fallback : null;
    }

    async function fetchPayload(url, init, maxBytes) {
      var response = await fetch(url, init);
      if (!response || Number(response.status) !== 200) return null;
      var advertisedLength = text(response.headers
        && typeof response.headers.get === 'function'
        && response.headers.get('content-length'));
      if (advertisedLength) {
        var advertisedBytes = Number(advertisedLength);
        if (Number.isFinite(advertisedBytes) && advertisedBytes > maxBytes) return null;
      }
      var raw = await readResponseText(response, maxBytes);
      if (!raw) return null;
      var payload = JSON.parse(raw);
      return record(payload) ? payload : null;
    }

    function allMatched(candidates, matchedProbeIds) {
      return candidates.every(function (candidate) { return matchedProbeIds.has(candidate.probeId); });
    }

    input = record(input) ? input : {};
    var maxResponseBytes = 2 * 1024 * 1024;
    var companyId = text(input.companyId);
    var probes = Array.isArray(input.probes) ? input.probes : [];
    if (!companyId || companyId.length > 300 || probes.length > 50) {
      return { state: 'invalid_context', matches: [] };
    }
    var expected = [];
    for (var index = 0; index < probes.length; index += 1) {
      var probe = record(probes[index]) ? probes[index] : {};
      var scope = record(probe.expected) ? probe.expected : {};
      var warehouse = record(scope.warehouse) ? scope.warehouse : {};
      var method = record(scope.deliveryMethod) ? scope.deliveryMethod : {};
      var methodId = method.platformMethodId;
      var item = {
        probeId: text(probe.probeId),
        warehouseId: text(warehouse.platformWarehouseId),
        methodId: methodId,
      };
      if (!item.probeId || item.probeId.length > 300 || !item.warehouseId
        || !Number.isSafeInteger(methodId) || methodId <= 0) {
        return { state: 'invalid_context', matches: [] };
      }
      expected.push(item);
    }
    if (!expected.length) return { state: 'ready', matches: [] };

    try {
      var bodyCompanyId = requestCompanyId(companyId);
      var warehousePayload = await fetchPayload(
        'https://seller.ozon.ru/api/site/logistic-service/v2/warehouse/list',
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: requestHeaders(companyId),
          body: JSON.stringify({ company_id: bodyCompanyId }),
        },
        maxResponseBytes,
      );
      if (!warehousePayload || !Array.isArray(warehousePayload.result)
        || warehousePayload.result.length > 10000) {
        return { state: 'request_failed', matches: [] };
      }

      var warehouseIds = new Set();
      for (var warehouseIndex = 0; warehouseIndex < warehousePayload.result.length; warehouseIndex += 1) {
        var warehouseId = rowId(warehousePayload.result[warehouseIndex], ['warehouse_id']);
        if (warehouseId) warehouseIds.add(warehouseId);
      }

      var candidates = expected.filter(function (candidate) {
        return warehouseIds.has(candidate.warehouseId);
      });
      if (!candidates.length) return { state: 'ready', matches: [] };

      var current = new Date();
      if (!Number.isFinite(current.getTime())) return { state: 'request_failed', matches: [] };
      var from = new Date(Date.UTC(
        current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() - 90,
        0, 0, 0, 0,
      ));
      var to = new Date(Date.UTC(
        current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(),
        23, 59, 59, 999,
      ));
      var statusGroups = [['active'], ['disabled', 'new']];
      var matchedProbeIds = new Set();
      var pageBudget = 0;
      var rowBudget = 0;

      for (var statusIndex = 0; statusIndex < statusGroups.length; statusIndex += 1) {
        var cursor = '';
        var seenCursors = new Set();
        while (true) {
          pageBudget += 1;
          if (pageBudget > 100) return { state: 'request_failed', matches: [] };
          var requestBody = {
            company_id: bodyCompanyId,
            processed_at_from: from.toISOString(),
            processed_at_to: to.toISOString(),
            limit: 20,
            status_alias: ['awaiting_packaging'],
            delivery_method_statuses: statusGroups[statusIndex],
          };
          if (cursor) requestBody.cursor = cursor;
          var methodPayload = await fetchPayload(
            'https://seller.ozon.ru/api/posting-service/seller-ui/delivery-method/list',
            {
              method: 'POST',
              credentials: 'include',
              cache: 'no-store',
              headers: requestHeaders(companyId, 'CbPostingsFbs'),
              body: JSON.stringify(requestBody),
            },
            maxResponseBytes,
          );
          if (!methodPayload || !Array.isArray(methodPayload.delivery_methods)) {
            return { state: 'request_failed', matches: [] };
          }
          rowBudget += methodPayload.delivery_methods.length;
          if (rowBudget > 2000) return { state: 'request_failed', matches: [] };

          for (var methodIndex = 0; methodIndex < methodPayload.delivery_methods.length; methodIndex += 1) {
            var methodRow = methodPayload.delivery_methods[methodIndex];
            var observedWarehouseId = rowId(methodRow, ['warehouse_id']);
            var observedMethodId = Number(methodRow && methodRow.delivery_method_id);
            if (!observedWarehouseId || !Number.isSafeInteger(observedMethodId)
              || observedMethodId <= 0) continue;
            for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
              var candidate = candidates[candidateIndex];
              if (candidate.warehouseId === observedWarehouseId
                && candidate.methodId === observedMethodId) {
                matchedProbeIds.add(candidate.probeId);
              }
            }
          }
          if (allMatched(candidates, matchedProbeIds)) {
            return { state: 'ready', matches: buildMatches(expected, matchedProbeIds, companyId) };
          }

          var nextCursor = text(methodPayload.cursor);
          if (!nextCursor) break;
          if (nextCursor.length > 2000 || seenCursors.has(nextCursor)) {
            return { state: 'request_failed', matches: [] };
          }
          seenCursors.add(nextCursor);
          cursor = nextCursor;
        }
      }
      return { state: 'ready', matches: buildMatches(expected, matchedProbeIds, companyId) };
    } catch (_error) {
      return { state: 'request_failed', matches: [] };
    }
  }

  global.SS_ERP_LOGISTICS_BINDING_PROBE_COLLECTOR = {
    collectWarehouseEvidence: collectWarehouseEvidence,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
