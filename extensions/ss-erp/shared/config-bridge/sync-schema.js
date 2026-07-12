(function (root) {
  var CURRENT_SCHEMA_VERSION = 'ozon-calculator/config-v1';
  var ACCEPTED_SCHEMA_VERSIONS = {
    'ozon-calculator/config-v1': true,
    'ozon-calc/config-v1': true,
  };
  var MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
  var MAX_SNAPSHOT_DEPTH = 20;
  var MAX_SERVICE_COUNT = 2000;

  function toText(value) {
    return value == null ? '' : String(value).trim();
  }

  function toNumber(value, fallbackValue) {
    var number = Number(value);
    return Number.isFinite(number) ? number : (fallbackValue == null ? 0 : fallbackValue);
  }

  function normalizeCustomFees(value) {
    var source = Array.isArray(value) ? value : Array.from([]);
    return source.slice(0, 0).concat(source.map(function (fee) {
      var normalized = fee && typeof fee === 'object' ? new fee.constructor() : {};
      normalized.label = toText(fee && fee.label);
      normalized.amount = toNumber(fee && fee.amount, 0);
      return normalized;
    })).filter(function (fee) {
      return fee.label && fee.amount > 0;
    });
  }

  function normalizeFormState(value) {
    value = value && typeof value === 'object' ? value : {};
    var legacyPackingFee = toNumber(value.packingFeeOverride, 0)
      + toNumber(value.labelFee, 0)
      + toNumber(value.transitFee, 0);
    return {
      fxRate: toNumber(value.fxRate, 0.08),
      commissionPct: toNumber(value.commissionPct, 12),
      commissionScheme: toText(value.commissionScheme || 'rfbs').toLowerCase() === 'fbp' ? 'fbp' : 'rfbs',
      autoCommissionSync: value.autoCommissionSync !== false,
      autoFxSync: value.autoFxSync !== false,
      hasBattery: Boolean(value.hasBattery),
      packingFee: toNumber(value.packingFee, legacyPackingFee),
      customFees: normalizeCustomFees(value.customFees),
    };
  }

  function mergeFormState(baseValue, overrideValue) {
    var base = normalizeFormState(baseValue);
    var override = overrideValue && typeof overrideValue === 'object' ? overrideValue : {};
    return normalizeFormState(Object.assign({}, base, override));
  }

  function normalizeUserConfig(value) {
    value = value && typeof value === 'object' ? value : {};
    return {
      selectedServiceIds: Array.isArray(value.selectedServiceIds)
        ? value.selectedServiceIds.map(String)
        : [],
      resolutionMode: value.resolutionMode === 'priority' ? 'priority' : 'lowest_cost',
      updatedAt: toText(value.updatedAt) || new Date().toISOString(),
    };
  }

  function utf8ByteLength(value) {
    var text = String(value || '');
    var bytes = 0;
    for (var index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        var next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function isNonNegativeNumericPath(path) {
    return /(fee|cost|amount|price|rate|commission|weight|dimension|length|width|height|handling|packing|step)/i.test(path);
  }

  function inspectRawValue(value, path, depth, seen, errors) {
    if (errors.length >= 20) return;
    if (depth > MAX_SNAPSHOT_DEPTH) {
      errors.push('payload 嵌套层级过深');
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        errors.push(path + ' 不是有限数字');
      } else if (Math.abs(value) > 1000000000000) {
        errors.push(path + ' 超出允许范围');
      } else if (value < 0 && isNonNegativeNumericPath(path)) {
        errors.push(path + ' 不能为负数');
      }
      return;
    }
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value !== 'object') {
      errors.push(path + ' 包含不支持的值类型');
      return;
    }
    if (seen.has(value)) {
      errors.push(path + ' 包含循环引用');
      return;
    }
    seen.add(value);
    Object.keys(value).forEach(function (key) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        errors.push(path + ' 包含不安全字段');
        return;
      }
      inspectRawValue(value[key], path + '.' + key, depth + 1, seen, errors);
    });
    seen.delete(value);
  }

  function validateRawSnapshot(payload) {
    var basic = validateSnapshot(payload);
    var errors = basic.errors.slice();
    var serialized = '';
    try {
      serialized = JSON.stringify(payload);
    } catch (error) {
      errors.push('payload 无法序列化');
    }
    if (!serialized) {
      errors.push('payload 为空');
    } else if (utf8ByteLength(serialized) > MAX_SNAPSHOT_BYTES) {
      errors.push('payload 超过 5 MiB 限制');
    }

    if (payload && typeof payload === 'object') {
      inspectRawValue(payload, 'payload', 0, new Set(), errors);
      var catalogServices = payload.catalogSnapshot && payload.catalogSnapshot.services;
      var ruleServices = payload.ruleSnapshot && payload.ruleSnapshot.services;
      if (Array.isArray(catalogServices) && catalogServices.length > MAX_SERVICE_COUNT) {
        errors.push('catalogSnapshot.services 数量过多');
      }
      if (Array.isArray(ruleServices) && ruleServices.length > MAX_SERVICE_COUNT) {
        errors.push('ruleSnapshot.services 数量过多');
      }
      if (Array.isArray(catalogServices) && catalogServices.some(function (service) {
        return !service || typeof service !== 'object' || !toText(service.id);
      })) {
        errors.push('catalogSnapshot.services 包含无效服务');
      }
      if (Array.isArray(ruleServices) && ruleServices.some(function (rule) {
        return !rule || typeof rule !== 'object' || !toText(rule.serviceId);
      })) {
        errors.push('ruleSnapshot.services 包含无效规则');
      }

      var formState = payload.formState && typeof payload.formState === 'object' ? payload.formState : {};
      if (formState.fxRate != null && (!(Number(formState.fxRate) > 0) || Number(formState.fxRate) > 1000)) {
        errors.push('formState.fxRate 超出允许范围');
      }
      if (formState.commissionPct != null && (Number(formState.commissionPct) < 0 || Number(formState.commissionPct) > 100)) {
        errors.push('formState.commissionPct 超出允许范围');
      }
    }

    return {
      valid: errors.length === 0,
      errors: Array.from(new Set(errors)),
    };
  }

  function prepareManualImport(payload) {
    var validation = validateRawSnapshot(payload);
    if (!validation.valid) {
      return {
        valid: false,
        errors: validation.errors,
        snapshot: null,
      };
    }
    var snapshot = normalizeSnapshot(payload);
    snapshot.source = 'local-fallback';
    return {
      valid: true,
      errors: [],
      snapshot: snapshot,
    };
  }

  function isTrustedExtensionPageUrl(value, runtimeId) {
    try {
      var parsed = new URL(toText(value));
      if (parsed.protocol !== 'chrome-extension:' || parsed.hostname !== runtimeId) return false;
      return parsed.pathname === '/pages/settings.html' || parsed.pathname === '/pages/config-import.html';
    } catch (error) {
      return false;
    }
  }

  function isTrustedManualImportSender(sender, runtimeId) {
    var extensionId = toText(runtimeId);
    if (!extensionId || !sender || toText(sender.id) !== extensionId) return false;
    var senderUrl = toText(sender.url || sender.documentUrl);
    if (!isTrustedExtensionPageUrl(senderUrl, extensionId)) return false;
    if (sender.origin && toText(sender.origin) !== 'chrome-extension://' + extensionId) return false;
    if (sender.tab && sender.tab.url && !isTrustedExtensionPageUrl(sender.tab.url, extensionId)) return false;
    return true;
  }

  function isTrustedSettingsSender(sender, runtimeId) {
    var extensionId = toText(runtimeId);
    if (!extensionId || !sender || toText(sender.id) !== extensionId) return false;
    var senderUrl = toText(sender.url || sender.documentUrl);
    var settingsUrl = 'chrome-extension://' + extensionId + '/pages/settings.html';
    if (senderUrl !== settingsUrl) return false;
    if (sender.origin && toText(sender.origin) !== 'chrome-extension://' + extensionId) return false;
    if (sender.tab && sender.tab.url && toText(sender.tab.url) !== settingsUrl) return false;
    return true;
  }

  function normalizeSnapshot(payload) {
    payload = payload && typeof payload === 'object' ? payload : {};
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      generatedAt: toText(payload.generatedAt) || new Date().toISOString(),
      source: toText(payload.source) || 'ozon-profit-calculator',
      userConfig: normalizeUserConfig(payload.userConfig),
      formState: normalizeFormState(payload.formState),
      catalogSnapshot: payload.catalogSnapshot && typeof payload.catalogSnapshot === 'object'
        ? payload.catalogSnapshot
        : { metadata: {}, services: [] },
      ruleSnapshot: payload.ruleSnapshot && typeof payload.ruleSnapshot === 'object'
        ? payload.ruleSnapshot
        : { metadata: {}, services: [] },
    };
  }

  function mergeSnapshotFormState(snapshot, formState) {
    var normalized = normalizeSnapshot(snapshot);
    return normalizeSnapshot(Object.assign({}, normalized, {
      generatedAt: new Date().toISOString(),
      userConfig: Object.assign({}, normalized.userConfig, {
        updatedAt: new Date().toISOString(),
      }),
      formState: mergeFormState(normalized.formState, formState),
    }));
  }

  function validateSnapshot(payload) {
    var errors = [];
    if (!payload || typeof payload !== 'object') errors.push('payload 不是对象');
    if (!ACCEPTED_SCHEMA_VERSIONS[toText(payload && payload.schemaVersion)]) errors.push('schemaVersion 不匹配');
    if (!Array.isArray(payload && payload.userConfig && payload.userConfig.selectedServiceIds) || !payload.userConfig.selectedServiceIds.length) {
      errors.push('selectedServiceIds 不能为空');
    }
    if (!payload || !payload.catalogSnapshot || !Array.isArray(payload.catalogSnapshot.services) || !payload.catalogSnapshot.services.length) {
      errors.push('catalogSnapshot 缺失或为空');
    }
    if (!payload || !payload.ruleSnapshot || !Array.isArray(payload.ruleSnapshot.services) || !payload.ruleSnapshot.services.length) {
      errors.push('ruleSnapshot 缺失或为空');
    }
    return {
      valid: errors.length === 0,
      errors: errors,
    };
  }

  root.OZON_CALC_SYNC_SCHEMA = {
    CURRENT_SCHEMA_VERSION: CURRENT_SCHEMA_VERSION,
    ACCEPTED_SCHEMA_VERSIONS: ACCEPTED_SCHEMA_VERSIONS,
    normalizeFormState: normalizeFormState,
    mergeFormState: mergeFormState,
    normalizeSnapshot: normalizeSnapshot,
    mergeSnapshotFormState: mergeSnapshotFormState,
    validateSnapshot: validateSnapshot,
    validateRawSnapshot: validateRawSnapshot,
    prepareManualImport: prepareManualImport,
    isTrustedManualImportSender: isTrustedManualImportSender,
    isTrustedSettingsSender: isTrustedSettingsSender,
  };
}(typeof window !== 'undefined' ? window : globalThis));
