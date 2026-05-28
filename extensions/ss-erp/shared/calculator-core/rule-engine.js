(function (root) {
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizePair(pair, fallback) {
    if (!Array.isArray(pair) || pair.length !== 2) return fallback.slice();
    var normalized = pair.map(function (item) { return Number(item) || 0; });
    return normalized[0] <= normalized[1] ? normalized : [normalized[1], normalized[0]];
  }

  function normalizeRange(pair, fallback) {
    if (!Array.isArray(pair) || pair.length !== 2) return fallback.slice();
    var minValue = Number(pair[0]) || 0;
    var maxValue = Number(pair[1]) || 0;
    if (maxValue > 0 && minValue > maxValue) return [maxValue, minValue];
    return [minValue, maxValue];
  }

  function normalizeTriple(triple, fallback) {
    if (!Array.isArray(triple) || triple.length !== 3) return fallback.slice();
    return triple.map(function (item) { return Number(item) || 0; });
  }

  function normalizePricing(pricing) {
    pricing = pricing && typeof pricing === 'object' ? pricing : {};
    if (String(pricing.type) === 'linear') {
      return {
        type: 'linear',
        baseFee: Number(pricing.baseFee) || 0,
        stepSize: Math.max(1, Number(pricing.stepSize) || 1),
        stepFee: Number(pricing.stepFee) || 0,
        minBillableUnits: Math.max(0, Number(pricing.minBillableUnits) || 0),
      };
    }
    if (String(pricing.type) === 'stair') {
      return {
        type: 'stair',
        firstG: Number(pricing.firstG) || 50,
        firstFee: Number(pricing.firstFee) || 0,
        stepG: Number(pricing.stepG) || 50,
        stepFee: Number(pricing.stepFee) || 0,
        handling: Number(pricing.handling) || 0,
      };
    }
    return {
      type: 'per_kg',
      pricePerKg: Number(pricing.pricePerKg) || 0,
      handling: Number(pricing.handling) || 0,
    };
  }

  function normalizeRule(rule) {
    if (!rule || typeof rule !== 'object') return null;
    var ruleId = String(rule.ruleId || '').trim();
    var serviceId = String(rule.serviceId || '').trim();
    var rawChargeMode = String(rule.conditions && rule.conditions.chargeMode || 'actual');
    var chargeMode = rawChargeMode === 'volume_only' ? 'max_actual_volume' : rawChargeMode;
    if (!ruleId || !serviceId) return null;
    return {
      ruleId: ruleId,
      serviceId: serviceId,
      providerId: String(rule.providerId || '').trim(),
      displayName: String(rule.displayName || serviceId).trim(),
      carrierName: String(rule.carrierName || '').trim(),
      priority: Number(rule.priority) || 9999,
      deliveryPromise: String(rule.deliveryPromise || '').trim(),
      conditionNote: String(rule.conditionNote || '').trim(),
      conditions: {
        weightRangeG: normalizePair(rule.conditions && rule.conditions.weightRangeG, [1, 30000]),
        priceRangeCNY: normalizeRange(rule.conditions && rule.conditions.priceRangeCNY, [0, 0]),
        priceRangeRUB: normalizeRange(rule.conditions && rule.conditions.priceRangeRUB, [0, 0]),
        maxDimsCm: normalizeTriple(rule.conditions && rule.conditions.maxDimsCm, [150, 80, 80]),
        longestSideCm: Number(rule.conditions && rule.conditions.longestSideCm) || 0,
        battery: String(rule.conditions && rule.conditions.battery || 'any'),
        chargeMode: chargeMode,
        volumetricDivisor: Number(rule.conditions && rule.conditions.volumetricDivisor) || 12000,
        volumeDivisorMm3: Number(rule.conditions && rule.conditions.volumeDivisorMm3) || 0,
      },
      pricing: normalizePricing(rule.pricing),
    };
  }

  function normalizeRulePayload(payload) {
    var rawRules = Array.isArray(payload) ? payload : payload && Array.isArray(payload.services) ? payload.services : [];
    return {
      metadata: {
        source: payload && payload.metadata && payload.metadata.source ? String(payload.metadata.source) : 'imported',
        sourceLabel: payload && payload.metadata && payload.metadata.sourceLabel ? String(payload.metadata.sourceLabel) : '导入规则',
        syncedAt: payload && payload.metadata && payload.metadata.syncedAt ? String(payload.metadata.syncedAt) : new Date().toISOString(),
        status: payload && payload.metadata && payload.metadata.status ? String(payload.metadata.status) : 'imported',
        note: payload && payload.metadata && payload.metadata.note ? String(payload.metadata.note) : '',
      },
      services: rawRules.map(normalizeRule).filter(Boolean),
    };
  }

  function sortDesc(values) {
    return values.slice().sort(function (left, right) { return right - left; });
  }

  function roundUp(value, step) {
    if (value <= 0) return 0;
    return Math.ceil(value / step) * step;
  }

  function calcPricing(pricing, metrics) {
    if (pricing.type === 'linear') {
      var targetUnits = Math.max(metrics.billableUnits, pricing.minBillableUnits);
      var billedUnits = roundUp(targetUnits, pricing.stepSize);
      return pricing.baseFee + (billedUnits / pricing.stepSize) * pricing.stepFee;
    }
    if (pricing.type === 'stair') {
      var extra = Math.max(0, metrics.billableUnits - pricing.firstG);
      var steps = Math.ceil(extra / pricing.stepG);
      return pricing.firstFee + steps * pricing.stepFee + pricing.handling;
    }
    return metrics.chargeKg * pricing.pricePerKg + pricing.handling;
  }

  function inferPackingFee(rule, service) {
    // Default to 0 - user configures via settings "其他费用规则"
    return 0;
  }

  function evaluateRule(rule, input) {
    var dimsCm = [Number(input.lenCm) || 0, Number(input.widCm) || 0, Number(input.hgtCm) || 0];
    var hasDim = dimsCm.every(function (item) { return item > 0; });
    var actualG = Number(input.weightG) || 0;
    var actualKg = actualG / 1000;
    var priceRMB = Number(input.priceRMB) || 0;
    var priceRUB = Number(input.fxRate) > 0 ? priceRMB / Number(input.fxRate) : 0;
    var sortedDims = sortDesc(dimsCm);
    var sortedMax = sortDesc(rule.conditions.maxDimsCm);
    var volumeKg = hasDim ? (dimsCm[0] * dimsCm[1] * dimsCm[2]) / rule.conditions.volumetricDivisor : 0;
    var billableUnits = actualG;
    var chargeKg = actualKg;
    var reason = '按实重计费';

    if (input.hasBattery && rule.conditions.battery === 'disallowed') {
      return { matched: false, reason: '该物流方式规则明确不支持电池商品' };
    }

    if (hasDim) {
      for (var index = 0; index < sortedDims.length; index += 1) {
        if (sortedMax[index] > 0 && sortedDims[index] > sortedMax[index]) {
          return { matched: false, reason: '包装尺寸超过该物流方式允许上限 ' + rule.conditions.maxDimsCm.join('×') + ' cm' };
        }
      }

      if (rule.conditions.longestSideCm > 0 && sortedDims[0] > rule.conditions.longestSideCm) {
        return { matched: false, reason: '最长边超过该物流方式限制 ' + rule.conditions.longestSideCm + ' cm' };
      }
    }

    if (actualG < rule.conditions.weightRangeG[0] || actualG > rule.conditions.weightRangeG[1]) {
      return { matched: false, reason: '实重 ' + actualG + 'g 不在该物流方式适用区间内' };
    }

    if (rule.conditions.priceRangeCNY[0] > 0 || rule.conditions.priceRangeCNY[1] > 0) {
      if (priceRMB <= 0) {
        return { matched: false, reason: '该物流方式需要有效的售价后才能判断价档' };
      }
      if (priceRMB < rule.conditions.priceRangeCNY[0]) {
        return { matched: false, reason: '售价低于该物流方式的最低价档限制' };
      }
      if (rule.conditions.priceRangeCNY[1] > 0 && priceRMB > rule.conditions.priceRangeCNY[1]) {
        return { matched: false, reason: '售价超出该物流方式的价档上限' };
      }
    } else if (rule.conditions.priceRangeRUB[0] > 0 || rule.conditions.priceRangeRUB[1] > 0) {
      if (priceRUB <= 0) {
        return { matched: false, reason: '该物流方式需要有效售价和汇率后才能判断价档' };
      }
      if (priceRUB < rule.conditions.priceRangeRUB[0]) {
        return { matched: false, reason: '售价低于该物流方式的最低价档限制' };
      }
      if (rule.conditions.priceRangeRUB[1] > 0 && priceRUB > rule.conditions.priceRangeRUB[1]) {
        return { matched: false, reason: '售价超出该物流方式的价档上限' };
      }
    }

    if (rule.conditions.chargeMode === 'max_actual_volume') {
      if (!hasDim) {
        return { matched: false, reason: '该物流方式需要填写长宽高后才能判断计抛' };
      }
      billableUnits = Math.max(actualG, Math.ceil(volumeKg * 1000));
      chargeKg = billableUnits / 1000;
      reason = '按 max(实重, 体积重) 计费，体积重除数 ' + rule.conditions.volumetricDivisor;
    } else if (rule.conditions.chargeMode === 'hybrid') {
      billableUnits = actualG;
      chargeKg = actualKg;
      reason = '按 hybrid 模式保守回退为实重计费，建议继续补充更多 official HAR 样本校验';
    }

    return {
      matched: true,
      actualKg: actualKg,
      volumeKg: volumeKg,
      chargeKg: chargeKg,
      billableUnits: billableUnits,
      shippingCost: calcPricing(rule.pricing, {
        chargeKg: chargeKg,
        billableUnits: billableUnits,
      }),
      reason: reason,
    };
  }

  function buildServiceQuote(service, ruleProfiles, input) {
    if (!ruleProfiles.length) {
      return { available: false, serviceId: service.id, displayName: service.displayName, reason: '该物流方式还没有同步到规则快照' };
    }

    var matches = [];
    var firstMismatch = null;
    ruleProfiles.forEach(function (rule) {
      var verdict = evaluateRule(rule, input);
      if (verdict.matched) {
        matches.push({
          serviceId: service.id,
          providerId: service.providerId || rule.providerId || '',
          displayName: service.displayName,
          carrierName: service.carrierName,
          servicePriority: service.priority,
          rulePriority: rule.priority,
          chargeKg: verdict.chargeKg,
          actualKg: verdict.actualKg,
          volumeKg: verdict.volumeKg,
          billableUnits: verdict.billableUnits,
          shippingCost: verdict.shippingCost,
          packingFee: inferPackingFee(rule, service),
          deliveryPromise: rule.deliveryPromise,
          reason: verdict.reason,
          ruleId: rule.ruleId,
          conditionNote: rule.conditionNote,
          weightRangeG: Array.isArray(rule.conditions.weightRangeG) ? rule.conditions.weightRangeG.slice() : [],
          priceRangeCNY: Array.isArray(rule.conditions.priceRangeCNY) ? rule.conditions.priceRangeCNY.slice() : [],
          priceRangeRUB: Array.isArray(rule.conditions.priceRangeRUB) ? rule.conditions.priceRangeRUB.slice() : [],
          chargeMode: rule.conditions.chargeMode,
          deliveryMode: service.deliveryMode,
        });
      } else if (!firstMismatch) {
        firstMismatch = verdict.reason;
      }
    });

    if (!matches.length) {
      return { available: false, serviceId: service.id, displayName: service.displayName, reason: firstMismatch || '当前商品条件不匹配该物流方式规则' };
    }

    matches.sort(function (left, right) {
      return left.shippingCost - right.shippingCost || left.rulePriority - right.rulePriority;
    });

    return {
      available: true,
      serviceId: service.id,
      providerId: service.providerId || '',
      displayName: service.displayName,
      carrierName: service.carrierName,
      servicePriority: service.priority,
      matchedRule: matches[0],
    };
  }

  function resolveBestQuote(quotes, resolutionMode, priorityOrder) {
    var orderMap = new Map();
    priorityOrder.forEach(function (serviceId, index) {
      orderMap.set(serviceId, index);
    });

    return quotes.slice().sort(function (left, right) {
      if (resolutionMode === 'priority') {
        var leftIndex = orderMap.has(left.serviceId) ? orderMap.get(left.serviceId) : 9999;
        var rightIndex = orderMap.has(right.serviceId) ? orderMap.get(right.serviceId) : 9999;
        return leftIndex - rightIndex || left.shippingCost - right.shippingCost || left.displayName.localeCompare(right.displayName, 'zh-CN');
      }
      return left.shippingCost - right.shippingCost
        || ((orderMap.has(left.serviceId) ? orderMap.get(left.serviceId) : 9999) - (orderMap.has(right.serviceId) ? orderMap.get(right.serviceId) : 9999))
        || left.displayName.localeCompare(right.displayName, 'zh-CN');
    })[0];
  }

  root.OZON_CALC_RULE_ENGINE = {
    clone: clone,
    normalizeRulePayload: normalizeRulePayload,
    buildServiceQuote: buildServiceQuote,
    resolveBestQuote: resolveBestQuote,
  };
}(typeof window !== 'undefined' ? window : globalThis));
