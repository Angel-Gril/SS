(function (global) {
  'use strict';

  var SELLER_SCHEMA = 'ozon-seller-logistics-capture/v1';
  var OFFICIAL_SCHEMA = 'ozon-official-logistics-capture/v1';
  var CLOCK_SKEW_MS = 2 * 60 * 1000;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function normalizedText(value) {
    return text(value).toLowerCase().replace(/\s+/g, ' ');
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function parseJson(value) {
    try {
      return JSON.parse(text(value));
    } catch (_error) {
      return null;
    }
  }

  function requestPayload(entry) {
    return parseJson(entry && entry.request && entry.request.postData
      && entry.request.postData.text) || {};
  }

  function requestHeader(entry, name) {
    var headers = entry && entry.request && entry.request.headers;
    var target = text(name).toLowerCase();
    if (Array.isArray(headers)) {
      for (var index = 0; index < headers.length; index += 1) {
        var row = headers[index];
        var rowName = Array.isArray(row) ? row[0] : row && (row.name || row.key);
        if (text(rowName).toLowerCase() === target) {
          return text(Array.isArray(row) ? row[1] : row.value);
        }
      }
      return '';
    }
    if (isRecord(headers)) {
      var keys = Object.keys(headers);
      for (var keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        if (text(keys[keyIndex]).toLowerCase() === target) return text(headers[keys[keyIndex]]);
      }
    }
    return '';
  }

  function requestCompanyIds(entry) {
    var payload = requestPayload(entry);
    return [
      text(payload.company_id),
      text(payload.companyId),
      requestHeader(entry, 'x-o3-company-id'),
    ].filter(function (value, index, values) {
      return value && values.indexOf(value) === index;
    });
  }

  function responsePayload(entry) {
    return parseJson(entry && entry.response && entry.response.content
      && entry.response.content.text);
  }

  function responseOk(entry) {
    var status = Number(entry && entry.response && entry.response.status);
    return status >= 200 && status < 300;
  }

  function capturedAt(entry) {
    var value = text(entry && (entry.startedDateTime || entry.capturedAt));
    var milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : '';
  }

  function normalizedPoint(value) {
    if (!isRecord(value)
      || typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
      return null;
    }
    var latitude = value.latitude;
    var longitude = value.longitude;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return null;
    }
    return { latitude: latitude, longitude: longitude };
  }

  function samePoint(left, right) {
    return Boolean(left) && Boolean(right)
      && left.latitude === right.latitude && left.longitude === right.longitude;
  }

  function isFreshForTask(entry, task) {
    var value = Date.parse(capturedAt(entry));
    var issued = Date.parse(text(task && task.issuedAt));
    var expires = Date.parse(text(task && task.expiresAt));
    return Number.isFinite(value) && Number.isFinite(issued) && Number.isFinite(expires)
      && value >= issued - CLOCK_SKEW_MS && value <= expires + CLOCK_SKEW_MS;
  }

  function endpointKey(entry) {
    var rawUrl = text(entry && entry.request && entry.request.url);
    if (rawUrl === 'ss-erp://capture/seller/provider-inventory') {
      return 'seller/provider-inventory';
    }
    try {
      var meta = entry && entry._ozonCalc || {};
      var parsed = new URL(rawUrl, text(meta.pageUrl) || undefined);
      if (parsed.hostname === 'seller.ozon.ru') {
        if (parsed.pathname === '/api/delivery-method-service/v2/provider/template/by-location/list')
          return 'seller/template/by-location';
        if (parsed.pathname === '/api/delivery-method-service/v2/provider/template/category/list')
          return 'seller/category/list';
        if (parsed.pathname === '/api/delivery-method-service/v2/provider/template/speed/list')
          return 'seller/delivery-speed';
      }
      if (parsed.hostname === 'globalcalculator.ozon.ru'
        && parsed.pathname === '/p-api/tpl-api-global-calc-gw/v1/calculator/calculate') {
        return 'global-calculator/calculate';
      }
    } catch (_error) {
      return '';
    }
    return '';
  }

  function sortLatest(left, right) {
    return Date.parse(capturedAt(left)) - Date.parse(capturedAt(right));
  }

  function latest(entries) {
    return entries.slice().sort(sortLatest).pop() || null;
  }

  function templatesFromPayload(payload) {
    if (!isRecord(payload)) return [];
    if (Array.isArray(payload.provider_templates)) return payload.provider_templates;
    if (isRecord(payload.result) && Array.isArray(payload.result.provider_templates)) {
      return payload.result.provider_templates;
    }
    return [];
  }

  function endpointHasRows(endpoint, payload) {
    if (!isRecord(payload)) return false;
    if (endpoint === 'seller/template/by-location') return templatesFromPayload(payload).length > 0;
    if (endpoint === 'seller/category/list' || endpoint === 'seller/delivery-speed') {
      return Array.isArray(payload.result) && payload.result.length > 0;
    }
    if (endpoint === 'seller/provider-inventory') {
      return Array.isArray(payload.providers) && payload.providers.length > 0;
    }
    if (endpoint === 'global-calculator/calculate') {
      return Array.isArray(payload.tariffs) && payload.tariffs.length > 0;
    }
    return false;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;
    var output = {};
    Object.keys(value).sort().forEach(function (key) {
      output[key] = canonicalize(value[key]);
    });
    return output;
  }

  async function checksum(value) {
    if (!global.crypto || !global.crypto.subtle || typeof TextEncoder !== 'function') {
      throw new Error('capture checksum support is unavailable');
    }
    var bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
    var digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function stableServiceKey(identity) {
    return 'svc:v2:' + JSON.stringify([
      identity.providerId,
      identity.normalizedDescription,
      identity.templateType,
      identity.weightType,
      identity.batteryMode,
    ]);
  }

  function deliveryVariant(template) {
    var type = normalizedText(template && (template.delivery_type || template.deliveryType));
    if (type === 'courier') return 'courier';
    if (type === 'pvz' || type === 'pickup' || type === 'pickup_point') return 'pickup';
    return '';
  }

  function routeCandidates(template) {
    var candidates = [];
    var sources = [
      template && template.destination,
      template && template.route,
      template,
    ];
    sources.forEach(function (source) {
      if (!isRecord(source)) return;
      var country = text(
        source.country_uid || source.countryUid
        || source.destination_country_uid || source.destinationCountryUid,
      );
      var location = text(
        source.location_uid || source.locationUid
        || source.destination_location_uid || source.destinationLocationUid,
      );
      if (!country) return;
      var key = country + '|' + location;
      if (candidates.some(function (candidate) { return candidate._key === key; })) return;
      candidates.push({
        _key: key,
        destinationCountryUid: country,
        destinationLocationUid: location || null,
        evidenceType: 'ozon_structured_destination',
      });
    });
    return candidates.map(function (candidate) {
      return {
        destinationCountryUid: candidate.destinationCountryUid,
        destinationLocationUid: candidate.destinationLocationUid,
        evidenceType: candidate.evidenceType,
      };
    });
  }

  function identityWeightType(value) {
    var normalized = normalizedText(value);
    if (normalized === '0' || normalized === '1' || normalized === '2' || normalized === '3'
      || normalized === 'weight') return 'weight';
    return '';
  }

  function canonicalDecimal(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number >= 1000000000000) return '';
    var rounded = Math.round((number + Number.EPSILON) * 1000000) / 1000000;
    var fixed = rounded.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return fixed || '0';
  }

  function canonicalizeRuleMoney(rule) {
    if (!isRecord(rule.conditions) || !isRecord(rule.pricing)
      || !Array.isArray(rule.conditions.priceRangeCNY)
      || !Array.isArray(rule.conditions.priceRangeRUB)
      || rule.conditions.priceRangeCNY.length !== 2
      || rule.conditions.priceRangeRUB.length !== 2
      || rule.pricing.type !== 'linear') return false;
    var values = rule.conditions.priceRangeCNY
      .concat(rule.conditions.priceRangeRUB)
      .concat([rule.pricing.baseFee, rule.pricing.stepFee])
      .map(canonicalDecimal);
    if (values.some(function (value) { return !value; })) return false;
    rule.conditions.priceRangeCNY = values.slice(0, 2);
    rule.conditions.priceRangeRUB = values.slice(2, 4);
    rule.pricing.baseFee = values[4];
    rule.pricing.stepFee = values[5];
    return true;
  }

  function sellerService(template, importedRule) {
    if (!isRecord(template) || !isRecord(importedRule)) return null;
    var providerId = text(template.provider_id || template.providerId);
    var description = normalizedText(template.template_name || template.templateName);
    var templateType = normalizedText(template.template_type || template.templateType)
      || 'global';
    var weightType = identityWeightType(
      template.weight_type == null ? template.weightType : template.weight_type,
    );
    var variant = deliveryVariant(template);
    if (!providerId || !description || !templateType || !weightType || !variant) return null;
    var batteryPresent = Object.prototype.hasOwnProperty.call(template, 'has_battery')
      || Object.prototype.hasOwnProperty.call(template, 'hasBattery');
    var batteryValue = Object.prototype.hasOwnProperty.call(template, 'has_battery')
      ? Boolean(template.has_battery) : Boolean(template.hasBattery);
    var identity = {
      providerId: providerId,
      normalizedDescription: description,
      templateType: templateType,
      weightType: weightType,
      batteryMode: batteryPresent ? (batteryValue ? 'battery' : 'no-battery') : 'unspecified',
      deliveryVariant: variant,
    };
    var key = stableServiceKey(identity);
    var rule = JSON.parse(JSON.stringify(importedRule));
    if (!canonicalizeRuleMoney(rule)) return null;
    if (identity.batteryMode === 'unspecified' && rule.conditions)
      rule.conditions.battery = 'any';
    rule.ruleId = key + ':default';
    rule.serviceId = key;
    rule.providerId = providerId;
    return {
      stableServiceKey: key,
      providerId: providerId,
      normalizedDescription: description,
      templateType: templateType,
      weightType: weightType,
      batteryMode: identity.batteryMode,
      deliveryVariant: variant,
      routeCandidates: routeCandidates(template),
      calculationRule: rule,
    };
  }

  function normalizedProviderInventory(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.providers)) return null;
    var allowedSources = ['method', 'template', 'both', 'warehouse'];
    var allowedStatuses = ['pending', 'succeeded', 'empty', 'failed'];
    var rows = payload.providers.map(function (provider) {
      if (!isRecord(provider)) return null;
      var providerId = text(provider.providerId || provider.provider_id);
      var name = text(provider.providerName || provider.provider_name || provider.name);
      var source = text(provider.source).toLowerCase();
      var status = text(provider.status).toLowerCase();
      var pointCount = Number(provider.pointCount);
      if (!providerId || !name || allowedSources.indexOf(source) < 0
        || allowedStatuses.indexOf(status) < 0
        || !Number.isSafeInteger(pointCount) || pointCount < 0) return null;
      return { providerId: providerId, name: name, source: source, status: status, pointCount: pointCount };
    });
    if (rows.some(function (row) { return row === null; })) return null;
    var stats = payload.providerStats;
    if (!isRecord(stats)
      || typeof stats.catalogComplete !== 'boolean'
      || typeof stats.methodBindingsComplete !== 'boolean'
      || typeof stats.methodBindingsRequired !== 'boolean'
      || typeof stats.complete !== 'boolean') {
      return null;
    }
    var providerIds = rows.map(function (row) { return row.providerId; });
    if (new Set(providerIds).size !== providerIds.length) return null;
    var numbers = [
      Number(stats.discovered), Number(stats.attempted),
      Number(stats.succeeded), Number(stats.failed),
      Number(stats.empty),
    ];
    if (numbers.some(function (value) { return !Number.isSafeInteger(value) || value < 0; }))
      return null;
    var statusCounts = { pending: 0, succeeded: 0, failed: 0, empty: 0 };
    rows.forEach(function (row) {
      statusCounts[row.status] += 1;
    });
    if (numbers[0] !== rows.length || numbers[1] !== numbers[2] + numbers[3] + numbers[4]
      || statusCounts.succeeded !== numbers[2]
      || statusCounts.failed !== numbers[3]
      || statusCounts.empty !== numbers[4]
      || statusCounts.pending !== numbers[0] - numbers[1]) return null;
    var catalogPrerequisitesComplete = numbers[0] === numbers[1]
      && numbers[3] === 0 && numbers[4] === 0;
    if (stats.catalogComplete && !catalogPrerequisitesComplete) return null;
    var expectedComplete = stats.catalogComplete
      && (!stats.methodBindingsRequired || stats.methodBindingsComplete);
    if (stats.complete !== expectedComplete) return null;
    return {
      rows: rows.sort(function (left, right) {
        return left.providerId.localeCompare(right.providerId, 'en', { numeric: true });
      }),
      providerStats: {
        discovered: numbers[0], attempted: numbers[1], succeeded: numbers[2],
        failed: numbers[3], empty: numbers[4],
        catalogComplete: stats.catalogComplete,
        methodBindingsComplete: stats.methodBindingsComplete,
        methodBindingsRequired: stats.methodBindingsRequired,
        complete: stats.complete,
      },
    };
  }

  function sellerEntrySelection(task, entries) {
    var expected = Array.isArray(task.expectedEndpoints) ? task.expectedEndpoints.map(text) : [];
    var fresh = (Array.isArray(entries) ? entries : []).filter(function (entry) {
      return isFreshForTask(entry, task);
    });
    var selected = {};
    var sawOtherCompany = false;
    var expectedCompanyId = text(task.scope && task.scope.companyId);
    expected.forEach(function (endpoint) {
      var matching = fresh.filter(function (entry) {
        if (endpointKey(entry) !== endpoint) return false;
        if (endpoint === 'seller/template/by-location'
          || endpoint === 'seller/category/list'
          || endpoint === 'seller/delivery-speed') {
          var companyIds = requestCompanyIds(entry);
          var companyRequired = endpoint === 'seller/template/by-location';
          if ((companyRequired && companyIds.length === 0)
            || companyIds.some(function (companyId) { return companyId !== expectedCompanyId; })) {
            if (companyIds.length > 0) sawOtherCompany = true;
            return false;
          }
        }
        if (endpoint === 'seller/provider-inventory') {
          var inventory = responsePayload(entry) || {};
          if (text(inventory.companyId) !== expectedCompanyId) {
            if (text(inventory.companyId)) sawOtherCompany = true;
            return false;
          }
        }
        return true;
      });
      if (matching.length) selected[endpoint] = latest(matching);
    });
    var templateEntry = selected['seller/template/by-location'];
    var templatePoint = normalizedPoint(requestPayload(templateEntry).point);
    var inventoryEntry = selected['seller/provider-inventory'];
    if (inventoryEntry) {
      var inventoryRequest = requestPayload(inventoryEntry);
      var inventoryPoint = normalizedPoint(inventoryRequest.point);
      if (text(inventoryRequest.companyId) !== text(task.scope && task.scope.companyId)
        || !samePoint(inventoryPoint, templatePoint)) {
        if (text(inventoryRequest.companyId)
          && text(inventoryRequest.companyId) !== text(task.scope && task.scope.companyId)) {
          sawOtherCompany = true;
        }
        delete selected['seller/provider-inventory'];
      }
    }
    var missing = expected.filter(function (endpoint) { return !selected[endpoint]; });
    return { expected: expected, selected: selected, missing: missing, sawOtherCompany: sawOtherCompany };
  }

  function endpointBatch(selection) {
    var attempted = [];
    var succeeded = [];
    var failed = [];
    var empty = [];
    selection.expected.forEach(function (endpoint) {
      var entry = selection.selected[endpoint];
      if (!entry) return;
      attempted.push(endpoint);
      var payload = responsePayload(entry);
      if (!responseOk(entry) || !payload) failed.push(endpoint);
      else if (!endpointHasRows(endpoint, payload)) empty.push(endpoint);
      else if (endpoint === 'seller/provider-inventory' && !normalizedProviderInventory(payload)) {
        failed.push(endpoint);
      } else succeeded.push(endpoint);
    });
    return {
      expected: selection.expected.slice(), attempted: attempted, succeeded: succeeded,
      failed: failed, empty: empty,
    };
  }

  async function buildSellerCapture(input) {
    var task = input.task;
    var selection = sellerEntrySelection(task, input.entries);
    if (selection.missing.length) {
      var waiting = {
        state: 'waiting',
        reason: selection.sawOtherCompany ? 'seller_scope_mismatch' : 'missing_endpoints',
        missingEndpoints: selection.missing,
      };
      var matchedTemplate = selection.selected['seller/template/by-location'];
      var matchedRequest = requestPayload(matchedTemplate);
      var matchedPoint = normalizedPoint(matchedRequest.point);
      if (matchedTemplate && matchedPoint) {
        waiting.collectionContext = {
          companyId: text(task.scope.companyId),
          point: { latitude: matchedPoint.latitude, longitude: matchedPoint.longitude },
        };
      }
      return waiting;
    }
    var batch = endpointBatch(selection);
    if (batch.failed.length || batch.empty.length) {
      return {
        state: 'waiting', reason: 'endpoint_incomplete', missingEndpoints: [],
        failedEndpoints: batch.failed, emptyEndpoints: batch.empty,
      };
    }
    var templateEntry = selection.selected['seller/template/by-location'];
    var request = requestPayload(templateEntry);
    var point = normalizedPoint(request.point);
    if (!point) {
      return { state: 'waiting', reason: 'seller_point_missing', missingEndpoints: [] };
    }
    var latitude = point.latitude;
    var longitude = point.longitude;
    var importer = input.harImporter;
    if (!importer || typeof importer.importSellerHar !== 'function') {
      throw new Error('Seller HAR importer is unavailable');
    }
    var harEntries = selection.expected.filter(function (endpoint) {
      return endpoint !== 'seller/provider-inventory';
    }).map(function (endpoint) { return selection.selected[endpoint]; });
    var imported;
    try {
      imported = importer.importSellerHar({ log: { entries: harEntries } });
    } catch (_error) {
      return { state: 'waiting', reason: 'seller_parse_failed', missingEndpoints: [] };
    }
    if (text(imported && imported.observedContext && imported.observedContext.companyId)
      !== text(task.scope && task.scope.companyId)) {
      return { state: 'waiting', reason: 'seller_scope_mismatch', missingEndpoints: [] };
    }
    var templates = templatesFromPayload(responsePayload(templateEntry));
    var ruleMap = {};
    var importedRules = imported && imported.ruleSnapshot && imported.ruleSnapshot.services;
    (Array.isArray(importedRules) ? importedRules : []).forEach(function (rule) {
      ruleMap[text(rule && rule.serviceId)] = rule;
    });
    var services = templates.map(function (template) {
      var templateId = text(template && (template.template_id || template.templateId));
      return sellerService(template, ruleMap[templateId]);
    });
    if (!services.length || services.some(function (service) { return service === null; })) {
      return { state: 'waiting', reason: 'seller_service_invalid', missingEndpoints: [] };
    }
    services.sort(function (left, right) {
      return left.stableServiceKey.localeCompare(right.stableServiceKey);
    });
    var inventoryPayload = responsePayload(selection.selected['seller/provider-inventory']);
    var providerInventory = normalizedProviderInventory(inventoryPayload);
    if (!providerInventory) {
      return { state: 'waiting', reason: 'provider_inventory_incomplete', missingEndpoints: [] };
    }
    var providerRows = providerInventory.rows;
    var providerStats = providerInventory.providerStats;
    if (providerStats.methodBindingsRequired && !providerStats.methodBindingsComplete) {
      return {
        state: 'waiting',
        reason: 'provider_inventory_incomplete',
        missingEndpoints: [],
        providerStats: providerStats,
      };
    }
    var selectedIds = Array.isArray(input.selectedServiceIds)
      ? input.selectedServiceIds.map(text).filter(Boolean) : [];
    var legacySelectedKeys = services.filter(function (service) {
      var parsed = JSON.parse(service.stableServiceKey.slice('svc:v2:'.length));
      var providerDescription = parsed[0] + '|' + parsed[1];
      var template = templates.find(function (candidate) {
        return text(candidate.provider_id || candidate.providerId) + '|'
          + normalizedText(candidate.template_name || candidate.templateName) === providerDescription;
      });
      var templateId = text(template && (template.template_id || template.templateId));
      return selectedIds.indexOf(templateId) >= 0
        || selectedIds.indexOf(service.stableServiceKey) >= 0;
    }).map(function (service) { return service.stableServiceKey; });
    var captureTimes = selection.expected.map(function (endpoint) {
      return capturedAt(selection.selected[endpoint]);
    }).sort();
    var payload = {
      schema: SELLER_SCHEMA,
      capturedAt: captureTimes[captureTimes.length - 1],
      endpointBatch: batch,
      sellerContext: { point: { latitude: latitude, longitude: longitude } },
      services: services,
      providerStats: providerStats,
      providerRows: providerRows,
      legacySelectedServiceKeys: legacySelectedKeys,
    };
    payload.responseChecksum = await checksum(payload);
    return { state: 'ready', payload: payload };
  }

  function observedOfficialFingerprint(value) {
    var fingerprint = JSON.parse(JSON.stringify(value));
    var batteryMode = fingerprint.batteryMode;
    delete fingerprint.batteryMode;
    if (batteryMode === 'NONE') fingerprint.batteryInput = false;
    if (batteryMode === 'CONTAINS_BATTERY') fingerprint.batteryInput = true;
    return fingerprint;
  }
  function officialRequestMatches(task, entry) {
    var fingerprint = task && task.officialFingerprint;
    var destination = task && task.destination;
    if (!isRecord(fingerprint) || !isRecord(fingerprint.dimensionsMm)
      || !isRecord(destination)) return false;
    if (fingerprint.originCountryUid !== task.scope.originCountryUid
      || fingerprint.originCityUid !== task.scope.originCityUid
      || fingerprint.destinationCountryUid !== destination.countryUid
      || fingerprint.destinationLocationUid !== destination.locationUid) return false;
    var request = requestPayload(entry);
    var batteryPresent = Object.prototype.hasOwnProperty.call(request, 'hasBattery')
      || Object.prototype.hasOwnProperty.call(request, 'has_battery');
    var battery = Object.prototype.hasOwnProperty.call(request, 'hasBattery')
      ? Boolean(request.hasBattery) : Boolean(request.has_battery);
    var batteryMatches = fingerprint.batteryMode === 'UNSPECIFIED'
      ? !batteryPresent
      : fingerprint.batteryMode === 'NONE'
        ? batteryPresent && !battery
        : fingerprint.batteryMode === 'CONTAINS_BATTERY' && batteryPresent && battery;
    return batteryMatches
      && text(request.countryUid) === fingerprint.originCountryUid
      && text(request.cityUid) === fingerprint.originCityUid
      && text(request.destinationCountryUid) === fingerprint.destinationCountryUid
      && text(request.destinationLocationUid) === fingerprint.destinationLocationUid
      && text(request.currency).toUpperCase() === fingerprint.currency
      && String(Math.round(Number(request.price) * 100)) === fingerprint.declaredPriceMinor
      && String(Number(request.weight)) === fingerprint.weightGrams
      && String(Number(request.length)) === fingerprint.dimensionsMm.length
      && String(Number(request.width)) === fingerprint.dimensionsMm.width
      && String(Number(request.height)) === fingerprint.dimensionsMm.height;
  }

  function officialQuote(tariff, currency) {
    if (!isRecord(tariff)) return null;
    var fields = [
      'stableServiceKey', 'providerId', 'normalizedDescription', 'templateType',
      'weightType', 'batteryMode', 'deliveryVariant',
    ];
    if (fields.some(function (field) { return !text(tariff[field]); })) return null;
    var priceMinor = Number(tariff.priceMinor);
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 0
      || text(tariff.currency).toUpperCase() !== currency) return null;
    var speeds = Array.isArray(tariff.clusterDeliverySpeeds)
      ? tariff.clusterDeliverySpeeds.map(function (speed) {
        if (!isRecord(speed)) return null;
        var min = Number(speed.min);
        var max = Number(speed.max);
        var clusterName = text(speed.clusterName);
        if (!Number.isFinite(min) || min < 0 || !Number.isFinite(max) || max < 0 || !clusterName) {
          return null;
        }
        return { min: min, max: max, clusterName: clusterName };
      }) : [];
    if (speeds.some(function (speed) { return speed === null; })) return null;
    var deliverySpeed = tariff.deliverySpeed == null ? null : Number(tariff.deliverySpeed);
    var rating = tariff.rating == null ? null : Number(tariff.rating);
    if ((deliverySpeed !== null && (!Number.isFinite(deliverySpeed) || deliverySpeed < 0))
      || (rating !== null && (!Number.isFinite(rating) || rating < 0))) return null;
    return {
      stableServiceKey: text(tariff.stableServiceKey),
      providerId: text(tariff.providerId),
      normalizedDescription: text(tariff.normalizedDescription),
      templateType: text(tariff.templateType),
      weightType: text(tariff.weightType),
      batteryMode: text(tariff.batteryMode),
      deliveryVariant: text(tariff.deliveryVariant),
      priceMinor: String(priceMinor),
      currency: currency,
      isDropOff: Boolean(tariff.isDropOff),
      clusterDeliverySpeeds: speeds,
      deliverySpeed: deliverySpeed,
      rating: rating,
    };
  }

  async function buildOfficialCapture(input) {
    var task = input.task;
    var candidates = (Array.isArray(input.entries) ? input.entries : []).filter(function (entry) {
      return isFreshForTask(entry, task)
        && endpointKey(entry) === 'global-calculator/calculate';
    });
    var matching = candidates.filter(function (entry) { return officialRequestMatches(task, entry); });
    if (!matching.length) {
      return {
        state: 'waiting', reason: candidates.length
          ? 'official_fingerprint_mismatch' : 'missing_endpoints',
        missingEndpoints: candidates.length ? [] : ['global-calculator/calculate'],
      };
    }
    var selected = latest(matching);
    var raw = responsePayload(selected);
    if (!responseOk(selected) || !endpointHasRows('global-calculator/calculate', raw)) {
      return { state: 'waiting', reason: 'official_response_incomplete', missingEndpoints: [] };
    }
    var importer = input.harImporter;
    if (!importer || typeof importer.importOfficialHar !== 'function') {
      throw new Error('Official HAR importer is unavailable');
    }
    var imported;
    try {
      imported = importer.importOfficialHar({ log: { entries: [selected] } });
    } catch (_error) {
      return { state: 'waiting', reason: 'official_parse_failed', missingEndpoints: [] };
    }
    var tariffs = imported && imported.samples && imported.samples[0]
      && imported.samples[0].tariffs;
    var currency = text(task.officialFingerprint.currency).toUpperCase();
    var quotes = (Array.isArray(tariffs) ? tariffs : []).map(function (tariff) {
      return officialQuote(tariff, currency);
    });
    if (!quotes.length || quotes.some(function (quote) { return quote === null; })) {
      return { state: 'waiting', reason: 'official_quote_invalid', missingEndpoints: [] };
    }
    quotes.sort(function (left, right) {
      return left.stableServiceKey.localeCompare(right.stableServiceKey);
    });
    var payload = {
      schema: OFFICIAL_SCHEMA,
      capturedAt: capturedAt(selected),
      fingerprint: observedOfficialFingerprint(task.officialFingerprint),
      quotes: quotes,
    };
    payload.responseChecksum = await checksum(payload);
    return { state: 'ready', payload: payload };
  }

  async function buildCapture(input) {
    if (!input || !isRecord(input.task) || !isRecord(input.task.scope)) {
      throw new TypeError('capture task is required');
    }
    if (input.task.kind === 'SELLER') return buildSellerCapture(input);
    if (input.task.kind === 'OFFICIAL') return buildOfficialCapture(input);
    throw new TypeError('unsupported capture task kind');
  }

  global.SS_ERP_LOGISTICS_CAPTURE_ADAPTER = {
    SELLER_SCHEMA: SELLER_SCHEMA,
    OFFICIAL_SCHEMA: OFFICIAL_SCHEMA,
    endpointKey: endpointKey,
    buildCapture: buildCapture,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
