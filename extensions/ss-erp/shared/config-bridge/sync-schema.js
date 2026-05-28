(function (root) {
  var CURRENT_SCHEMA_VERSION = 'ozon-calculator/config-v1';
  var ACCEPTED_SCHEMA_VERSIONS = {
    'ozon-calculator/config-v1': true,
    'ozon-calc/config-v1': true,
  };

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
  };
}(typeof window !== 'undefined' ? window : globalThis));
