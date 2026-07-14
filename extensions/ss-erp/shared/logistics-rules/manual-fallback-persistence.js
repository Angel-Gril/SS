(function (global) {
  'use strict';

  var CALCULATOR_STATE_KEY = 'ozon-logistics:calculator-state:v1';
  var SNAPSHOT_KEY = 'ozon-calc:config-snapshot';
  var UPDATED_AT_KEY = 'ozon-calc:config-updated-at';
  var OFFICIAL_SNAPSHOT_KEY = 'ozon-calculator:official-snapshot';
  var SCOPE_FIELDS = [
    'deploymentId', 'tenantSubject', 'shopId', 'ozonCompanyId', 'warehouseId',
    'originCountryUid', 'originCityUid', 'destinationCountryUid',
    'destinationLocationUid', 'assignmentId', 'schemaMajor',
  ];

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function completeScope(scope) {
    return scope && typeof scope === 'object' && SCOPE_FIELDS.every(function (field) {
      return Boolean(text(scope[field]));
    });
  }

  function sameScope(candidate, expected) {
    return completeScope(candidate) && completeScope(expected) && SCOPE_FIELDS.every(function (field) {
      return text(candidate[field]) === text(expected[field]);
    });
  }

  function sampleMatchesScope(sample, scope) {
    var request = sample && (sample.request || sample.fingerprint);
    var origin = request && request.origin;
    var destination = request && request.destination;
    return text(origin && origin.countryUid) === text(scope.originCountryUid)
      && text(origin && origin.cityUid) === text(scope.originCityUid)
      && text(destination && destination.countryUid) === text(scope.destinationCountryUid)
      && text(destination && destination.locationUid) === text(scope.destinationLocationUid);
  }

  function scopedOfficialSnapshot(value, scope) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('an Official snapshot is required');
    }
    if (value.scope && !sameScope(value.scope, scope)) {
      throw new Error('Official snapshot scope does not match the active scope');
    }
    var result = clone(value);
    if (Array.isArray(result.samples)) {
      var sourceCount = result.samples.length;
      result.samples = result.samples.filter(function (sample) {
        return sampleMatchesScope(sample, scope);
      });
      if (sourceCount > 0 && result.samples.length === 0) {
        throw new Error('Official snapshot has no samples for the active scope');
      }
    }
    result.scope = clone(scope);
    return result;
  }

  function createPersistence(options) {
    options = options && typeof options === 'object' ? options : {};
    var storage = options.storage;
    var runtime = options.runtime;
    var getRuntime = typeof options.getRuntime === 'function'
      ? options.getRuntime
      : function () { return runtime; };
    var isFeatureEnabled = options.isFeatureEnabled;
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('storage adapter is required');
    }
    if (!runtime && typeof options.getRuntime !== 'function') {
      throw new TypeError('logistics distribution runtime provider is required');
    }
    if (typeof isFeatureEnabled !== 'function') {
      throw new TypeError('distribution feature predicate is required');
    }

    async function persist(input) {
      input = input && typeof input === 'object' ? input : {};
      var hasSnapshot = Boolean(input.snapshot);
      var hasOfficial = Object.prototype.hasOwnProperty.call(input, 'officialSnapshot')
        && Boolean(input.officialSnapshot);
      if (!hasSnapshot && !hasOfficial) throw new TypeError('manual logistics data is required');

      if (!isFeatureEnabled()) {
        var legacyValues = {};
        if (hasSnapshot) {
          legacyValues[SNAPSHOT_KEY] = clone(input.snapshot);
          legacyValues[UPDATED_AT_KEY] = now().toISOString();
        }
        if (hasOfficial) legacyValues[OFFICIAL_SNAPSHOT_KEY] = clone(input.officialSnapshot);
        await storage.set(legacyValues);
        return {
          state: 'stored',
          mode: 'legacy_unscoped',
          snapshot: hasSnapshot ? clone(input.snapshot) : null,
          officialSnapshot: hasOfficial ? clone(input.officialSnapshot) : null,
        };
      }

      var stored = await storage.get([CALCULATOR_STATE_KEY]);
      var calculatorState = stored && stored[CALCULATOR_STATE_KEY];
      var scope = calculatorState && calculatorState.scope;
      if (!completeScope(scope)) {
        return { state: 'scope_required', mode: 'scope_required', snapshot: null, officialSnapshot: null };
      }

      var fallbackInput = { scopeBinding: clone(scope) };
      if (hasSnapshot) fallbackInput.snapshot = clone(input.snapshot);
      if (hasOfficial) fallbackInput.officialSnapshot = scopedOfficialSnapshot(input.officialSnapshot, scope);
      var activeRuntime = getRuntime();
      if (!activeRuntime) {
        throw new TypeError('logistics distribution runtime is required');
      }
      var useCombinedCommand = input.source === 'erp_release' && hasSnapshot;
      var updated;
      if (useCombinedCommand) {
        if (typeof activeRuntime.saveLocalFallbackWithPreferences !== 'function') {
          throw new TypeError('atomic logistics configuration runtime is required');
        }
        updated = await activeRuntime.saveLocalFallbackWithPreferences(fallbackInput);
      } else {
        if (typeof activeRuntime.saveLocalFallback !== 'function') {
          throw new TypeError('logistics distribution runtime is required');
        }
        updated = await activeRuntime.saveLocalFallback(fallbackInput);
      }
      return {
        state: updated && updated.state || 'stored',
        mode: 'scoped_fallback',
        snapshot: updated && updated.snapshot || clone(input.snapshot) || null,
        officialSnapshot: updated && updated.officialSnapshot
          || fallbackInput.officialSnapshot || null,
      };
    }

    return { persist: persist };
  }

  global.SS_ERP_LOGISTICS_MANUAL_FALLBACK = {
    createPersistence: createPersistence,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
