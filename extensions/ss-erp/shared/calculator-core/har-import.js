(function (root) {
  function valueOf(field, fallbackValue) {
    if (!field || typeof field !== 'object') return fallbackValue;
    if (field.valid === false) return fallbackValue;
    if (field.value == null) return fallbackValue;
    return Number(field.value);
  }

  function moneyToNumber(money) {
    if (!money || typeof money !== 'object') return 0;
    return (Number(money.units) || 0) + (Number(money.nanos) || 0) / 1000000000;
  }

  function parseHarPayload(payload) {
    if (payload && payload.log && Array.isArray(payload.log.entries)) return payload.log.entries;
    throw new Error('文件不是有效的 HAR 结构。');
  }

  function findLatestEntry(entries, keyword) {
    for (var index = entries.length - 1; index >= 0; index -= 1) {
      var entry = entries[index];
      if (entry && entry.request && String(entry.request.url || '').indexOf(keyword) >= 0) {
        return entry;
      }
    }
    return null;
  }

  function isExactOfficialCalculateEntry(entry) {
    var rawUrl = entry && entry.request && String(entry.request.url || '').trim();
    if (!rawUrl) return false;
    try {
      var pageUrl = entry && entry._ozonCalc && entry._ozonCalc.pageUrl;
      var parsed = new URL(rawUrl, pageUrl || 'https://globalcalculator.ozon.ru');
      return parsed.hostname === 'globalcalculator.ozon.ru'
        && parsed.pathname === '/p-api/tpl-api-global-calc-gw/v1/calculator/calculate';
    } catch (error) {
      return false;
    }
  }

  function parseEntryJson(entry, sourceLabel) {
    if (!entry || !entry.response || !entry.response.content) {
      throw new Error(sourceLabel + ' 没有找到可解析的响应内容。');
    }
    return JSON.parse(entry.response.content.text || '{}');
  }

  function parseRequestJson(entry) {
    if (!entry || !entry.request || !entry.request.postData || !entry.request.postData.text) return {};
    return JSON.parse(entry.request.postData.text);
  }

  function buildCategoryMap(categoryPayload) {
    var map = new Map();
    ((categoryPayload && categoryPayload.result) || []).forEach(function (item) {
      map.set(Number(item.category_id), item);
    });
    return map;
  }

  function buildSpeedMap(speedPayload) {
    var map = new Map();
    ((speedPayload && speedPayload.result) || []).forEach(function (speed) {
      var speedName = String(speed.speed_name || '').toLowerCase();
      var categoryDays = new Map();
      (speed.category_delivery_days || []).forEach(function (item) {
        categoryDays.set(Number(item.category_id), {
          min: Number(item.delivery_days_min) || 0,
          max: Number(item.delivery_days_max) || 0,
        });
      });
      map.set(speedName, {
        speedName: String(speed.speed_name || ''),
        categoryDays: categoryDays,
      });
    });
    return map;
  }

  function speedNameFromTemplate(templateName, providerName, speedMap) {
    var haystack = (String(templateName || '') + ' ' + String(providerName || '')).toLowerCase();
    var matchedSpeed = '';
    speedMap.forEach(function (value, key) {
      if (!matchedSpeed && haystack.indexOf(key) >= 0) matchedSpeed = key;
    });
    return matchedSpeed;
  }

  function formatDayRange(minDays, maxDays) {
    if (!minDays && !maxDays) return '';
    if (minDays && maxDays) return minDays + '-' + maxDays + ' 天';
    return String(minDays || maxDays) + ' 天';
  }

  function inferDeliveryPromise(template, categoryMap, speedMap) {
    var contractMin = valueOf(template.contract_delivery_days_min, 0);
    var contractMax = valueOf(template.contract_delivery_days_max, 0);
    if (contractMin || contractMax) return formatDayRange(contractMin, contractMax);

    var speedKey = speedNameFromTemplate(template.template_name, template.provider_name, speedMap);
    var categoryId = template.categories && template.categories[0] ? Number(template.categories[0].category_id) : 0;
    if (speedKey && categoryId && speedMap.has(speedKey)) {
      var range = speedMap.get(speedKey).categoryDays.get(categoryId);
      if (range) return formatDayRange(range.min, range.max);
    }

    if (categoryId && categoryMap.has(categoryId)) {
      var category = categoryMap.get(categoryId);
      return formatDayRange(valueOf(category.weight_min, 0), valueOf(category.weight_max, 0));
    }
    return '';
  }

  function deliveryModeFromTemplate(template) {
    var deliveryType = String(template.delivery_type || '').toLowerCase();
    if (deliveryType === 'pvz') return 'pickup';
    if (deliveryType === 'courier') return 'courier';
    return 'courier_or_pickup';
  }

  function batteryModeFromTemplate(template) {
    return template.has_battery ? 'allowed' : 'disallowed';
  }

  function chargeModeFromWeightType(weightType) {
    if (weightType === 1) return 'hybrid';
    if (weightType === 3) return 'max_actual_volume';
    return 'actual';
  }

  function chargeLabel(weightType) {
    if (weightType === 1) return 'Hybrid';
    if (weightType === 3) return 'Volume';
    return 'Weight';
  }

  function categoryNames(template, categoryMap) {
    return (template.categories || []).map(function (item) {
      var category = categoryMap.get(Number(item.category_id));
      return category ? String(category.category_name || '') : '';
    }).filter(Boolean);
  }

  function priorityOfTemplate(template, categoryMap) {
    if (Array.isArray(template.categories) && template.categories.length) {
      return template.categories.reduce(function (best, item) {
        var category = categoryMap.get(Number(item.category_id));
        var categoryOrder = category ? Number(category.category_list_number) || 99 : 99;
        var tender = Number(item.tender_position) || 99;
        return Math.min(best, categoryOrder * 100 + tender);
      }, 9999);
    }
    return Number(template.template_id) || 9999;
  }

  function findPriceRestriction(template, currencyCode) {
    var restrictions = Array.isArray(template.price_restrictions) ? template.price_restrictions : [];
    for (var index = 0; index < restrictions.length; index += 1) {
      if (String(restrictions[index].currency || '').toUpperCase() === currencyCode) return restrictions[index];
    }
    return null;
  }

  function buildPriceRange(template, currencyCode, fallbackMinField, fallbackMaxField) {
    var restriction = findPriceRestriction(template, currencyCode);
    if (restriction) {
      return [
        Math.max(0, moneyToNumber(restriction.min_price)),
        restriction.max_price ? moneyToNumber(restriction.max_price) : 0,
      ];
    }
    return [
      Math.max(0, valueOf(fallbackMinField, 0)),
      Math.max(0, valueOf(fallbackMaxField, 0)),
    ];
  }

  function templateToCatalogService(template, categoryMap, speedMap) {
    var tags = categoryNames(template, categoryMap);
    var speedKey = speedNameFromTemplate(template.template_name, template.provider_name, speedMap);
    if (speedKey && speedMap.has(speedKey)) tags.push(speedMap.get(speedKey).speedName);
    tags.push(chargeLabel(Number(template.weight_type) || 0));

    return {
      id: String(template.template_id),
      templateId: String(template.template_id),
      carrierId: String(template.provider_id),
      providerId: String(template.provider_id),
      carrierName: String(template.provider_name || '未命名承运商').trim(),
      serviceName: String(template.template_name || '').trim(),
      displayName: String(template.template_name || '').trim(),
      deliveryMode: deliveryModeFromTemplate(template),
      batteryMode: batteryModeFromTemplate(template),
      tags: tags.filter(Boolean),
      priority: priorityOfTemplate(template, categoryMap),
      note: inferDeliveryPromise(template, categoryMap, speedMap),
    };
  }

  function templateToRule(template, categoryMap, speedMap) {
    var weightType = Number(template.weight_type) || 0;
    var maxLengthCm = valueOf(template.max_length, 0) / 10;
    var maxWidthCm = valueOf(template.max_width, 0) / 10;
    var maxHeightCm = valueOf(template.max_height, 0) / 10;
    var longestSideCm = valueOf(template.longest_side_limit, 0) / 10;
    var pricePerShipment = moneyToNumber(template.delivery_tariff && template.delivery_tariff.price_per_shipment);
    var stepFee = moneyToNumber(template.delivery_tariff && template.delivery_tariff.weight_rounding_step_price);
    var stepSize = Number(template.delivery_tariff && template.delivery_tariff.weight_rounding_step_grammes) || 1;
    var minPostingWeight = valueOf(template.delivery_tariff && template.delivery_tariff.min_posting_weight_in_grams, 0);
    var chargeMode = chargeModeFromWeightType(weightType);

    return {
      ruleId: String(template.template_id) + ':default',
      serviceId: String(template.template_id),
      providerId: String(template.provider_id),
      displayName: String(template.template_name || '').trim(),
      carrierName: String(template.provider_name || '').trim(),
      priority: priorityOfTemplate(template, categoryMap),
      deliveryPromise: inferDeliveryPromise(template, categoryMap, speedMap),
      conditionNote: weightType === 1
        ? 'weight_type=1 当前按 hybrid-实重保守模式处理'
        : weightType === 3
          ? 'weight_type=3 按 max(实重, 体积重) 计费，体积重除数 12000'
          : '',
      conditions: {
        weightRangeG: [Math.max(0, valueOf(template.min_weight, 0)), Math.max(0, valueOf(template.max_weight, 999999))],
        priceRangeCNY: buildPriceRange(template, 'CNY', null, null),
        priceRangeRUB: buildPriceRange(template, 'RUB', template.min_price, template.max_price),
        maxDimsCm: [
          maxLengthCm || 9999,
          maxWidthCm || 9999,
          maxHeightCm || 9999,
        ],
        longestSideCm: longestSideCm || 0,
        battery: template.has_battery ? 'any' : 'disallowed',
        chargeMode: chargeMode,
        volumetricDivisor: 12000,
        volumeDivisorMm3: 0,
      },
      pricing: {
        type: 'linear',
        baseFee: pricePerShipment,
        stepSize: stepSize,
        stepFee: stepFee,
        minBillableUnits: minPostingWeight,
      },
    };
  }

  function statsByWeightType(templates) {
    var stats = {};
    templates.forEach(function (item) {
      var key = String(Number(item.weight_type) || 0);
      stats[key] = (stats[key] || 0) + 1;
    });
    return stats;
  }

  function importSellerHar(payload) {
    var entries = parseHarPayload(payload);
    var templateEntry = findLatestEntry(entries, '/provider/template/by-location/list');
    if (!templateEntry) throw new Error('seller HAR 中缺少 provider/template/by-location/list 响应。');

    var categoryEntry = findLatestEntry(entries, '/provider/template/category/list');
    var speedEntry = findLatestEntry(entries, '/provider/template/speed/list');
    var templatePayload = parseEntryJson(templateEntry, 'seller 模板');
    var categoryPayload = categoryEntry ? parseEntryJson(categoryEntry, 'seller 类目') : { result: [] };
    var speedPayload = speedEntry ? parseEntryJson(speedEntry, 'seller 时效') : { result: [] };
    var requestPayload = parseRequestJson(templateEntry);

    var point = requestPayload.point && typeof requestPayload.point === 'object' ? requestPayload.point : {};
    var latitude = Number(point.latitude);
    var longitude = Number(point.longitude);
    var hasQueryPoint = Number.isFinite(latitude) && Number.isFinite(longitude);
    var observedContext = {
      companyId: String(requestPayload.company_id || requestPayload.companyId || ''),
      availableIntegrationType: Number(requestPayload.available_integration_type || requestPayload.availableIntegrationType) || 0,
      ...(hasQueryPoint ? { queryPoint: { latitude: latitude, longitude: longitude } } : {}),
      locationStatus: hasQueryPoint ? 'coordinates_only' : 'legacy_unscoped',
    };
    var templates = Array.isArray(templatePayload.provider_templates) ? templatePayload.provider_templates : [];
    var categoryMap = buildCategoryMap(categoryPayload);
    var speedMap = buildSpeedMap(speedPayload);
    var typeStats = statsByWeightType(templates);
    var warnings = [];

    if (typeStats['1']) warnings.push('检测到 weight_type=1 模板，当前按 hybrid-实重保守模式计算。');
    if (typeStats['3']) warnings.push('检测到 weight_type=3 模板，当前按 max(实重, 体积重) 计费，体积重除数 12000。');

    return {
      observedContext: observedContext,
      catalogSnapshot: {
        metadata: {
          source: 'seller-har',
          sourceLabel: 'seller HAR 导入',
          syncedAt: String(templateEntry.startedDateTime || new Date().toISOString()),
          status: 'imported',
          note: warnings.join(' '),
          companyId: requestPayload.company_id || '',
        },
        services: templates.map(function (item) {
          return templateToCatalogService(item, categoryMap, speedMap);
        }).sort(function (left, right) {
          return left.priority - right.priority || left.displayName.localeCompare(right.displayName, 'zh-CN');
        }),
      },
      ruleSnapshot: {
        metadata: {
          source: 'seller-har',
          sourceLabel: 'seller HAR 规则快照',
          syncedAt: String(templateEntry.startedDateTime || new Date().toISOString()),
          status: 'imported',
          note: warnings.join(' '),
          companyId: requestPayload.company_id || '',
        },
        services: templates.map(function (item) {
          return templateToRule(item, categoryMap, speedMap);
        }),
      },
      diagnostics: {
        templateCount: templates.length,
        weightTypeStats: typeStats,
        warnings: warnings,
      },
    };
  }

  function finiteNumber(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function normalizeOfficialRequest(requestPayload) {
    requestPayload = requestPayload && typeof requestPayload === 'object' ? requestPayload : {};
    var batteryInput = null;
    if (Object.prototype.hasOwnProperty.call(requestPayload, 'hasBattery')) {
      batteryInput = Boolean(requestPayload.hasBattery);
    } else if (Object.prototype.hasOwnProperty.call(requestPayload, 'has_battery')) {
      batteryInput = Boolean(requestPayload.has_battery);
    }
    return {
      origin: {
        countryUid: String(requestPayload.countryUid || ''),
        cityUid: String(requestPayload.cityUid || ''),
      },
      destination: {
        countryUid: String(requestPayload.destinationCountryUid || ''),
        locationUid: String(requestPayload.destinationLocationUid || ''),
      },
      currency: String(requestPayload.currency || '').toUpperCase(),
      declaredPrice: finiteNumber(requestPayload.price),
      package: {
        weight: { value: finiteNumber(requestPayload.weight), unit: 'g' },
        dimensions: {
          length: finiteNumber(requestPayload.length),
          width: finiteNumber(requestPayload.width),
          height: finiteNumber(requestPayload.height),
          unit: 'mm',
        },
      },
      batteryInput: batteryInput,
    };
  }

  function buildOfficialFingerprintKey(request) {
    return [
      request.origin.countryUid,
      request.origin.cityUid,
      request.destination.countryUid,
      request.destination.locationUid,
      request.currency,
      request.declaredPrice,
      request.package.weight.value,
      request.package.dimensions.length,
      request.package.dimensions.width,
      request.package.dimensions.height,
      request.batteryInput == null ? 'battery-unknown' : (request.batteryInput ? 'battery' : 'no-battery'),
    ].join('|');
  }

  function normalizeServiceIdentityText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function normalizeOfficialTariffs(calculatePayload, currency) {
    return Array.isArray(calculatePayload.tariffs) ? calculatePayload.tariffs.map(function (item) {
      var providerId = String(item.providerId || '');
      var description = String(item.description || '');
      var templateType = String(item.templateType || '');
      var weightType = String(item.weightType || '');
      var batteryKey = item.hasBattery ? 'battery' : 'no-battery';
      return {
        stableServiceKey: [
          providerId,
          normalizeServiceIdentityText(description),
          normalizeServiceIdentityText(templateType),
          normalizeServiceIdentityText(weightType),
          batteryKey,
        ].join('|'),
        providerId: providerId,
        providerName: String(item.providerName || ''),
        description: description,
        price: finiteNumber(item.price),
        currency: String(currency || '').toUpperCase(),
        weightType: weightType,
        hasBattery: Boolean(item.hasBattery),
        isDropOff: Boolean(item.isDropOff),
        templateType: templateType,
        clusterDeliverySpeeds: Array.isArray(item.clusterDeliverySpeeds) ? item.clusterDeliverySpeeds : [],
        deliverySpeed: item.deliverySpeed == null ? null : item.deliverySpeed,
        rating: item.rating == null ? null : item.rating,
      };
    }) : [];
  }

  function importOfficialHar(payload) {
    var entries = parseHarPayload(payload);
    var providerEntry = findLatestEntry(entries, '/v1/provider/');
    var calculateEntries = entries.filter(isExactOfficialCalculateEntry);
    var calculateEntry = calculateEntries.length ? calculateEntries[calculateEntries.length - 1] : null;
    if (!calculateEntry) throw new Error('official HAR 中缺少 calculator/calculate 响应。');

    var providerPayload = providerEntry ? parseEntryJson(providerEntry, 'official provider') : { providers: [] };
    var calculatePayload = parseEntryJson(calculateEntry, 'official calculate');
    var requestPayload = parseRequestJson(calculateEntry);

    var samples = calculateEntries.map(function (entry) {
      var request = normalizeOfficialRequest(parseRequestJson(entry));
      var samplePayload = parseEntryJson(entry, 'official calculate');
      return {
        fingerprintKey: buildOfficialFingerprintKey(request),
        capturedAt: String(entry.startedDateTime || ''),
        request: request,
        tariffs: normalizeOfficialTariffs(samplePayload, request.currency),
      };
    });

    return {
      metadata: {
        source: 'official-har',
        sourceLabel: 'official HAR 样本',
        syncedAt: String(calculateEntry.startedDateTime || new Date().toISOString()),
        status: 'official',
        note: '仅用于样本校验，不会实时请求官方计算器。',
      },
      sampleRequest: requestPayload,
      samples: samples,
      providers: Array.isArray(providerPayload.providers) ? providerPayload.providers.map(function (item) {
        return {
          id: String(item.id || ''),
          name: String(item.name || ''),
        };
      }) : [],
      tariffs: normalizeOfficialTariffs(calculatePayload, requestPayload.currency),
    };
  }

  root.OZON_CALC_HAR_IMPORT = {
    importSellerHar: importSellerHar,
    importOfficialHar: importOfficialHar,
  };
}(typeof window !== 'undefined' ? window : globalThis));
