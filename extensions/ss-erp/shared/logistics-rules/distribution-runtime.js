(function (global) {
  'use strict';

  var SELECTION_KEY = 'ss-erp:logistics:selection:v1';
  var SCHEDULE_KEY = 'ss-erp:logistics:schedule:v1';
  var CALCULATOR_STATE_KEY = 'ozon-logistics:calculator-state:v1';
  var PREFERENCES_PREFIX = 'ozon-logistics:preferences:v1:';
  var FALLBACK_PREFIX = 'ozon-logistics:fallback:v1:';
  var SCOPE_FIELDS = [
    'deploymentId', 'tenantSubject', 'shopId', 'ozonCompanyId', 'warehouseId',
    'originCountryUid', 'originCityUid', 'destinationCountryUid',
    'destinationLocationUid', 'assignmentId', 'schemaMajor',
  ];
  var MIN_BACKOFF_MS = 60 * 1000;
  var MAX_BACKOFF_MS = 30 * 60 * 1000;
  var AUTHORITATIVE_GATE_STATES = new Set([
    'upgrade_required', 'no_remote_release', 'no_assignment', 'needs_selection',
    'scope_missing',
  ]);

  function requiredApi(value, name, methods) {
    if (!value) throw new Error(name + ' is unavailable');
    methods.forEach(function (method) {
      if (typeof value[method] !== 'function') throw new Error(name + '.' + method + ' is unavailable');
    });
    return value;
  }

  function normalizedBaseUrl(value) {
    var parsed = new URL(String(value == null ? '' : value).trim());
    var local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new TypeError('ERP endpoint must use HTTPS');
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function scopeStorageSuffix(scope) {
    if (!scope || typeof scope !== 'object') throw new TypeError('logistics scope is required');
    return SCOPE_FIELDS.map(function (field) {
      var value = String(scope[field] == null ? '' : scope[field]).trim();
      if (!value) throw new TypeError('logistics scope.' + field + ' is required');
      var encoded = encodeURIComponent(value);
      return encoded.length + ':' + encoded;
    }).join('|');
  }

  function preferenceKeyForScope(scope) {
    return PREFERENCES_PREFIX + scopeStorageSuffix(scope);
  }

  function fallbackKeyForScope(scope) {
    return FALLBACK_PREFIX + scopeStorageSuffix(scope);
  }

  function createRuntime(options) {
    var credentialsApi = requiredApi(
      global.SS_ERP_EXTENSION_DEVICE_CREDENTIALS,
      'device credentials',
      ['createManager'],
    );
    var storeApi = requiredApi(
      global.SS_ERP_LOGISTICS_DISTRIBUTION_STORE,
      'distribution store',
      ['createStore'],
    );
    var clientApi = requiredApi(
      global.SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT,
      'distribution client',
      ['createClient'],
    );
    var localStorage = options && options.localStorage;
    if (!localStorage || typeof localStorage.get !== 'function' || typeof localStorage.set !== 'function') {
      throw new TypeError('localStorage adapter is required');
    }
    var now = options && options.now ? options.now : function () { return new Date(); };
    var random = options && typeof options.random === 'function' ? options.random : Math.random;
    var configuredExtensionVersion = String(
      options && options.currentExtensionVersion != null ? options.currentExtensionVersion : '',
    ).trim();

    function extensionVersionFor(input) {
      var value = configuredExtensionVersion || String(input && input.extensionVersion || '').trim();
      if (!value) throw new TypeError('current extension version is required');
      return value;
    }

    var credentials = requiredApi(
      options && options.credentials || credentialsApi.createManager({
        localStorage: localStorage,
        fetchImpl: options.fetchImpl,
        now: now,
      }),
      'device credential manager',
      ['claim', 'clear', 'getStatus', 'getConnection', 'getAccessToken',
        'beginOperation', 'isOperationCurrent', 'clearIfCurrent'],
    );
    if (typeof credentials.getConnection !== 'function') {
      throw new Error('device connection lookup is unavailable');
    }
    var storeOptions = {
      storage: localStorage,
      validateBundle: options.validateBundle,
      now: now,
    };
    if (configuredExtensionVersion) {
      storeOptions.currentExtensionVersion = configuredExtensionVersion;
    }
    var store = storeApi.createStore(storeOptions);
    var client = clientApi.createClient({
      fetchImpl: options.fetchImpl,
      store: store,
      credentials: credentials,
      randomId: options.randomId,
      now: now,
    });
    var syncInFlight = null;
    var scopeMutationTails = new Map();
    var calculatorStateMutationTail = Promise.resolve();

    function superseded() {
      return { state: 'superseded' };
    }

    function scopeChanged() {
      return { state: 'scope_changed' };
    }

    async function operationIsCurrent(operation) {
      try {
        return await credentials.isOperationCurrent(operation) === true;
      } catch (_error) {
        return false;
      }
    }

    async function runScopeMutation(scope, mutate) {
      var key = scopeStorageSuffix(scope);
      var previous = scopeMutationTails.get(key) || Promise.resolve();
      var mutation = previous.catch(function () {}).then(mutate);
      scopeMutationTails.set(key, mutation);
      try {
        return await mutation;
      } finally {
        if (scopeMutationTails.get(key) === mutation) scopeMutationTails.delete(key);
      }
    }

    async function runCalculatorStateMutation(mutate) {
      var mutation = calculatorStateMutationTail.catch(function () {}).then(mutate);
      calculatorStateMutationTail = mutation;
      try {
        return await mutation;
      } finally {
        if (calculatorStateMutationTail === mutation) calculatorStateMutationTail = Promise.resolve();
      }
    }



    var adapter = global.OZON_CALC_LOGISTICS_RELEASE_ADAPTER;
    var buildCalculatorState = options && typeof options.buildCalculatorState === 'function'
      ? options.buildCalculatorState
      : adapter && adapter.buildCalculatorState;
    async function claim(input) {
      var result = await credentials.claim(input);
      if (result && result.state === 'paired' && typeof localStorage.remove === 'function') {
        await localStorage.remove([SCHEDULE_KEY, SELECTION_KEY, CALCULATOR_STATE_KEY]);
      }
      return result;
    }

    async function clear() {
      var result = await credentials.clear();
      if (typeof localStorage.remove === 'function') {
        await localStorage.remove([SCHEDULE_KEY, SELECTION_KEY, CALCULATOR_STATE_KEY]);
      }
      return result;
    }

    async function chooseAssignment(status, assignments, requestedId, operation) {
      var selectedId = String(requestedId || '').trim();
      if (!selectedId) {
        var stored = await localStorage.get([SELECTION_KEY]);
        var selection = stored && stored[SELECTION_KEY];
        if (
          selection &&
          selection.deploymentId === status.deploymentId &&
          selection.ownerUserId === status.ownerUserId
        ) {
          selectedId = String(selection.assignmentId || '');
        }
      }
      var selected = selectedId
        ? assignments.find(function (assignment) { return assignment.assignmentId === selectedId; })
        : null;
      if (!selected && assignments.length === 1) selected = assignments[0];
      if (!selected) return null;
      if (!await operationIsCurrent(operation)) return superseded();
      await localStorage.set({
        [SELECTION_KEY]: {
          assignmentId: selected.assignmentId,
          deploymentId: status.deploymentId,
          ownerUserId: status.ownerUserId,
        },
      });
      if (!await operationIsCurrent(operation)) return superseded();
      return selected;
    }

    function namespaceFor(status, assignment) {
      return {
        deploymentId: status.deploymentId,
        tenantSubject: status.ownerUserId,
        shopId: assignment.shopId,
        ozonCompanyId: assignment.companyId,
        warehouseId: assignment.warehouseId,
        originCountryUid: assignment.originCountryUid,
        originCityUid: assignment.originCityUid,
        destinationCountryUid: assignment.destinationCountryUid,
        destinationLocationUid: assignment.destinationLocationUid,
        assignmentId: assignment.assignmentId,
        schemaMajor: 1,
      };
    }


    function routeForAssignment(namespace, assignment) {
      if (!assignment || typeof assignment !== 'object') return null;
      var scopeFields = [
        'assignmentId',
        'originCountryUid',
        'originCityUid',
        'destinationCountryUid',
        'destinationLocationUid',
      ];
      var scoped = scopeFields.every(function (field) {
        return String(namespace && namespace[field] || '').trim()
          && String(namespace[field]).trim() === String(assignment[field] || '').trim();
      });
      var originLabel = String(assignment.originLabel || '').trim();
      var destinationLabel = String(assignment.destinationLabel || '').trim();
      if (!scoped || !originLabel || !destinationLabel) return null;
      return {
        source: 'erp_assignment',
        assignmentId: String(namespace.assignmentId),
        originCountryUid: String(namespace.originCountryUid),
        originCityUid: String(namespace.originCityUid),
        destinationCountryUid: String(namespace.destinationCountryUid),
        destinationLocationUid: String(namespace.destinationLocationUid),
        originLabel: originLabel,
        destinationLabel: destinationLabel,
      };
    }

    function scopesMatch(left, right) {
      try {
        return scopeStorageSuffix(left) === scopeStorageSuffix(right);
      } catch (_error) {
        return false;
      }
    }

    function authoritiesMatch(left, right) {
      if (!left || !right) return !left && !right;
      return ['sessionId', 'deploymentId', 'ownerUserId'].every(function (field) {
        return String(left[field] || '') === String(right[field] || '');
      });
    }

    function calculatorContextMatches(calculatorState, expectedContext) {
      return Boolean(
        calculatorState
        && expectedContext
        && scopesMatch(calculatorState.scope, expectedContext.scope)
        && authoritiesMatch(calculatorState.authority, expectedContext.authority),
      );
    }

    function authoritativeGate(value) {
      var source = value && value.authoritativeGate && typeof value.authoritativeGate === 'object'
        ? value.authoritativeGate
        : value;
      var state = String(source && source.state || '').trim();
      if (!AUTHORITATIVE_GATE_STATES.has(state)) return null;
      return {
        state: state,
        minExtensionVersion: source.minExtensionVersion || null,
        currentExtensionVersion: source.currentExtensionVersion || null,
        versionReason: source.versionReason || null,
        authorizationValidUntil: source.authorizationValidUntil || null,
        validUntil: source.validUntil || null,
        staleUntil: source.staleUntil || null,
      };
    }

    function usableForGate(gate) {
      return {
        state: gate.state,
        quoteAllowed: false,
        bundle: null,
        minExtensionVersion: gate.minExtensionVersion,
        currentExtensionVersion: gate.currentExtensionVersion,
        versionReason: gate.versionReason,
        authorizationValidUntil: gate.authorizationValidUntil,
        validUntil: gate.validUntil,
        staleUntil: gate.staleUntil,
      };
    }


    async function publishCalculatorStateUnlocked(namespace, operation, assignment, usableOverride, extensionVersion, clearAuthoritativeGate, expectedContext) {
      if (typeof buildCalculatorState !== 'function') return null;
      if (operation && !await operationIsCurrent(operation)) return superseded();
      var preferenceKey = preferenceKeyForScope(namespace);
      var fallbackKey = fallbackKeyForScope(namespace);
      var stored = await localStorage.get([
        preferenceKey,
        fallbackKey,
        CALCULATOR_STATE_KEY,
      ]);
      var existingState = stored && stored[CALCULATOR_STATE_KEY];
      if (expectedContext && !calculatorContextMatches(existingState, expectedContext)) {
        return scopeChanged();
      }
      var incomingGate = authoritativeGate(usableOverride);
      var existingGate = scopesMatch(existingState && existingState.scope, namespace)
        ? authoritativeGate(existingState) : null;
      var nextGate = clearAuthoritativeGate ? null : existingGate;
      var usable;
      if (incomingGate) {
        usable = usableForGate(incomingGate);
        nextGate = incomingGate;
      } else if (!clearAuthoritativeGate && existingGate) {
        usable = usableForGate(existingGate);
      } else if (usableOverride && typeof usableOverride === 'object') {
        usable = usableOverride;
      } else {
        var resolveInput = { at: now().toISOString() };
        var resolvedVersion = String(extensionVersion || configuredExtensionVersion || '').trim();
        if (resolvedVersion) resolveInput.currentExtensionVersion = resolvedVersion;
        usable = await store.resolveUsable(namespace, resolveInput);
      }
      if (operation && !await operationIsCurrent(operation)) return superseded();
      var state = buildCalculatorState({
        usable: usable,
        expectedScope: namespace,
        localPreferences: stored && stored[preferenceKey] || null,
        localFallback: stored && stored[fallbackKey] || null,
      });
      if (!state || typeof state !== 'object') {
        throw new Error('calculator adapter returned an invalid state');
      }
      var authority = operation ? {
        sessionId: String(operation.sessionId || ''),
        deploymentId: String(operation.deploymentId || ''),
        ownerUserId: String(operation.ownerUserId || ''),
      } : existingState && existingState.authority || null;
      var authorizationValidUntil = state.authorizationValidUntil
        || usable.authorizationValidUntil
        || operation && operation.expiresAt
        || existingState && existingState.authorizationValidUntil
        || null;
      var route = routeForAssignment(namespace, assignment)
        || routeForAssignment(namespace, existingState && existingState.route)
        || null;
      var persisted = Object.assign({}, state, {
        authority: authority,
        authoritativeGate: nextGate,
        authorizationValidUntil: authorizationValidUntil,
        validUntil: state.validUntil || usable.validUntil || null,
        staleUntil: state.staleUntil || usable.staleUntil || null,
        minExtensionVersion: state.minExtensionVersion
          || usable.minExtensionVersion
          || usable.bundle && usable.bundle.minExtensionVersion || null,
        currentExtensionVersion: state.currentExtensionVersion
          || usable.currentExtensionVersion || String(extensionVersion || configuredExtensionVersion || '').trim() || null,
        versionReason: state.versionReason || usable.versionReason || null,
        route: route,
        updatedAt: now().toISOString(),
      });
      if (operation && !await operationIsCurrent(operation)) return superseded();
      if (expectedContext) {
        var latest = await localStorage.get([CALCULATOR_STATE_KEY]);
        if (!calculatorContextMatches(latest && latest[CALCULATOR_STATE_KEY], expectedContext)) {
          return scopeChanged();
        }
      }
      await localStorage.set((function () {
        var values = {};
        values[CALCULATOR_STATE_KEY] = persisted;
        return values;
      })());
      if (operation && !await operationIsCurrent(operation)) return superseded();
      return persisted;
    }

    function publishCalculatorState(namespace, operation, assignment, usableOverride, extensionVersion, clearAuthoritativeGate, expectedContext) {
      return runCalculatorStateMutation(function () {
        return publishCalculatorStateUnlocked(
          namespace, operation, assignment, usableOverride, extensionVersion,
          clearAuthoritativeGate, expectedContext);
      });
    }


    function cloneJson(value) {
      return JSON.parse(JSON.stringify(value));
    }

    async function currentCalculatorContext() {
      var stored = await localStorage.get([CALCULATOR_STATE_KEY]);
      var current = stored && stored[CALCULATOR_STATE_KEY];
      if (!current || !current.scope || typeof current.scope !== 'object') {
        throw new Error('an active scoped calculator state is required');
      }
      scopeStorageSuffix(current.scope);
      return {
        scope: cloneJson(current.scope),
        authority: current.authority ? cloneJson(current.authority) : null,
      };
    }

    function commitManualCalculatorMutation(context, values) {
      return runCalculatorStateMutation(async function () {
        var stored = await localStorage.get([CALCULATOR_STATE_KEY]);
        if (!calculatorContextMatches(stored && stored[CALCULATOR_STATE_KEY], context)) {
          return scopeChanged();
        }
        await localStorage.set(values);
        return publishCalculatorStateUnlocked(
          context.scope, null, null, null, null, undefined, context);
      });
    }

    function normalizedPreference(snapshot, scope) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new TypeError('calculator preference snapshot is required');
      }
      var userConfig = snapshot.userConfig;
      var formState = snapshot.formState || {};
      if (!userConfig || typeof userConfig !== 'object' || Array.isArray(userConfig)) {
        throw new TypeError('calculator user preferences are required');
      }
      var selected = Array.isArray(userConfig.selectedServiceIds)
        ? userConfig.selectedServiceIds.map(function (value) { return String(value).trim(); })
        : [];
      if (selected.length > 500 || selected.some(function (value) { return !value || value.length > 500; })) {
        throw new TypeError('calculator selected services are invalid');
      }
      var unique = selected.filter(function (value, index, values) {
        return values.indexOf(value) === index;
      });
      var resolutionMode = userConfig.resolutionMode === 'priority' ? 'priority' : 'lowest_cost';
      var clonedFormState = cloneJson(formState);
      if (JSON.stringify(clonedFormState).length > 100000) {
        throw new TypeError('calculator fee preferences are too large');
      }
      return {
        scope: scope,
        userConfig: { selectedServiceIds: unique, resolutionMode: resolutionMode },
        formState: clonedFormState,
      };
    }

    async function updatePreferences(input) {
      var context = await currentCalculatorContext();
      var scope = context.scope;
      var preference = normalizedPreference(input && input.snapshot, scope);
      var key = preferenceKeyForScope(scope);
      var values = {};
      values[key] = preference;
      return commitManualCalculatorMutation(context, values);
    }

    async function mergedLocalFallback(scope, input) {
      var binding = input && input.scopeBinding;
      if (!binding || typeof binding !== 'object') {
        throw new TypeError('an explicit scope binding is required for local fallback');
      }
      var bindingSuffix;
      try {
        bindingSuffix = scopeStorageSuffix(binding);
      } catch (_error) {
        throw new TypeError('an explicit complete scope binding is required for local fallback');
      }
      if (bindingSuffix !== scopeStorageSuffix(scope)) throw new Error('scope binding does not match the active scope');
      var key = fallbackKeyForScope(scope);
      var stored = await localStorage.get([key]);
      var existing = stored && stored[key];
      var snapshot = input && input.snapshot || existing && existing.snapshot;
      if (!snapshot || !snapshot.userConfig || !snapshot.catalogSnapshot || !snapshot.ruleSnapshot) {
        throw new TypeError('a complete local calculator fallback is required');
      }
      var officialProvided = input && Object.prototype.hasOwnProperty.call(input, 'officialSnapshot');
      var officialSnapshot = officialProvided
        ? input.officialSnapshot
        : existing && existing.officialSnapshot || null;
      if (officialSnapshot) {
        var officialSuffix;
        try {
          officialSuffix = scopeStorageSuffix(officialSnapshot.scope);
        } catch (_error) {
          throw new TypeError('official snapshot scope does not match the active scope');
        }
        if (officialSuffix !== scopeStorageSuffix(scope)) {
          throw new Error('official snapshot scope does not match the active scope');
        }
      }
      var fallback = {
        scope: scope,
        snapshot: cloneJson(snapshot),
        officialSnapshot: cloneJson(officialSnapshot),
      };
      return { key: key, fallback: fallback };
    }

    async function saveLocalFallback(input) {
      var context = await currentCalculatorContext();
      var scope = context.scope;
      return runScopeMutation(scope, async function () {
        var merged = await mergedLocalFallback(scope, input);
        var values = {};
        values[merged.key] = merged.fallback;
        return commitManualCalculatorMutation(context, values);
      });
    }

    async function saveLocalFallbackWithPreferences(input) {
      var context = await currentCalculatorContext();
      var scope = context.scope;
      return runScopeMutation(scope, async function () {
        var merged = await mergedLocalFallback(scope, input);
        var preference = normalizedPreference(input && input.snapshot, scope);
        var values = {};
        values[merged.key] = merged.fallback;
        values[preferenceKeyForScope(scope)] = preference;
        return commitManualCalculatorMutation(context, values);
      });
    }


    function evaluateVersionCompatibility(currentVersion, minimumVersion) {
      var policy = global.SS_ERP_LOGISTICS_VERSION_POLICY;
      if (!policy || typeof policy.evaluateCompatibility !== 'function') {
        return {
          compatible: false,
          reason: 'version_policy_unavailable',
          currentExtensionVersion: String(currentVersion || '').trim(),
          minExtensionVersion: String(minimumVersion || '').trim(),
        };
      }
      return policy.evaluateCompatibility(currentVersion, minimumVersion);
    }

    function calculatorAuthorityMatchesStatus(calculatorState, status) {
      var authority = calculatorState && calculatorState.authority;
      return authority && status
        && String(authority.sessionId || '') === String(status.sessionId || '')
        && String(authority.deploymentId || '') === String(status.deploymentId || '')
        && String(authority.ownerUserId || '') === String(status.ownerUserId || '');
    }

    async function preflightCachedVersion(status, operation, extensionVersion) {
      var stored = await localStorage.get([CALCULATOR_STATE_KEY]);
      var calculatorState = stored && stored[CALCULATOR_STATE_KEY];
      if (!calculatorState || !calculatorAuthorityMatchesStatus(calculatorState, status)) return null;
      if (operation && !await operationIsCurrent(operation)) return superseded();

      if (
        calculatorState.state === 'upgrade_required'
        && String(calculatorState.minExtensionVersion || '').trim()
      ) {
        var persistedEvaluation = evaluateVersionCompatibility(
          extensionVersion,
          calculatorState.minExtensionVersion,
        );
        if (!persistedEvaluation || persistedEvaluation.compatible !== true) {
          var persisted = await markCalculatorUnavailable('upgrade_required', {
            minExtensionVersion: calculatorState.minExtensionVersion || null,
            currentExtensionVersion: String(extensionVersion || '').trim() || null,
            versionReason: persistedEvaluation && persistedEvaluation.reason || 'version_policy_unavailable',
          });
          return {
            state: 'upgrade_required',
            calculatorState: persisted,
            minExtensionVersion: calculatorState.minExtensionVersion || null,
          };
        }
      }

      if (!calculatorState.scope || typeof store.resolveUsable !== 'function') return null;
      var usable;
      try {
        usable = await store.resolveUsable(calculatorState.scope, {
          at: now().toISOString(),
          currentExtensionVersion: extensionVersion,
        });
      } catch (_error) {
        return null;
      }
      if (!usable || usable.state !== 'upgrade_required') return null;
      if (operation && !await operationIsCurrent(operation)) return superseded();
      var published = await publishCalculatorState(
        calculatorState.scope,
        operation,
        calculatorState.route || null,
        usable,
        extensionVersion,
      );
      if (published && published.state === 'superseded') return published;
      return {
        state: 'upgrade_required',
        calculatorState: published,
        minExtensionVersion: usable.minExtensionVersion || null,
      };
    }

    async function performSync(input) {
      input = input && typeof input === 'object' ? input : {};
      var operation = await credentials.beginOperation();
      if (!operation || operation.state !== 'paired') return { state: 'unpaired', assignments: [] };
      var status = operation;
      if (
        !String(operation.sessionId || '').trim()
        || !String(operation.deploymentId || '').trim()
        || !String(operation.ownerUserId || '').trim()
      ) {
        throw new Error('stored device operation scope mismatch');
      }
      var baseUrl = normalizedBaseUrl(operation.baseUrl);
      if (input.baseUrl && normalizedBaseUrl(input.baseUrl) !== baseUrl) {
        throw new Error('requested ERP endpoint does not match the paired deployment');
      }
      var extensionVersion = extensionVersionFor(input);
      var versionPreflight = await preflightCachedVersion(status, operation, extensionVersion);
      if (versionPreflight) return versionPreflight;

      var discovery = await client.discover({
        baseUrl: baseUrl,
        extensionVersion: extensionVersion,
      });
      if (discovery.state === 'revoked' || discovery.state === 'superseded') {
        return discovery;
      }
      if (!await operationIsCurrent(operation)) return superseded();
      if (discovery.state !== 'ready') return discovery;
      var assignment = await chooseAssignment(status, discovery.assignments, input.assignmentId, operation);
      if (!assignment) {
        return {
          state: discovery.assignments.length ? 'needs_selection' : 'no_assignment',
          assignments: discovery.assignments,
        };
      }
      if (assignment.state === 'superseded') return assignment;
      if (!await operationIsCurrent(operation)) return superseded();
      var namespace = namespaceFor(status, assignment);
      if (assignment.effectiveReleaseAvailable === false) {
        var unavailableState = await publishCalculatorState(
          namespace,
          operation,
          assignment,
          { state: 'no_remote_release', quoteAllowed: false, bundle: null },
          extensionVersion,
        );
        if (unavailableState && unavailableState.state === 'superseded') {
          return unavailableState;
        }
        return {
          state: 'no_remote_release',
          assignment: assignment,
          receipt: { state: 'no_pending' },
          cleanup: null,
          calculatorState: unavailableState,
          releaseId: null,
          releaseSequence: null,
        };
      }
      var initialReceipt = await client.flushPendingReceipt({
        baseUrl: baseUrl,
        assignmentId: assignment.assignmentId,
        namespace: namespace,
        extensionVersion: extensionVersion,
      });
      if (initialReceipt.state === 'revoked' || initialReceipt.state === 'superseded') {
        return initialReceipt;
      }
      if (!await operationIsCurrent(operation)) return superseded();
      var refreshed = await client.refresh({
        baseUrl: baseUrl,
        assignmentId: assignment.assignmentId,
        namespace: namespace,
        extensionVersion: extensionVersion,
      });
      if (refreshed.state === 'revoked' || refreshed.state === 'superseded') {
        return refreshed;
      }
      if (!await operationIsCurrent(operation)) return superseded();
      if (refreshed.state === 'upgrade_required') {
        var upgradeState = await publishCalculatorState(
          namespace,
          operation,
          assignment,
          {
            state: 'upgrade_required',
            quoteAllowed: false,
            bundle: null,
            minExtensionVersion: refreshed.minExtensionVersion || null,
            currentExtensionVersion: extensionVersion,
            versionReason: refreshed.versionReason || 'server_upgrade_required',
          },
          extensionVersion,
        );
        if (upgradeState && upgradeState.state === 'superseded') return upgradeState;
        return {
          state: 'upgrade_required',
          assignment: assignment,
          receipt: { state: 'no_pending' },
          cleanup: null,
          calculatorState: upgradeState,
          minExtensionVersion: refreshed.minExtensionVersion || null,
          releaseId: null,
          releaseSequence: null,
        };
      }
      var receipt = { state: 'no_pending' };
      var cleanup = null;
      if (refreshed.state === 'active' || refreshed.state === 'not_modified') {
        receipt = await client.flushPendingReceipt({
          baseUrl: baseUrl,
          assignmentId: assignment.assignmentId,
          namespace: namespace,
          extensionVersion: extensionVersion,
        });
        if (receipt.state === 'revoked' || receipt.state === 'superseded') {
          return receipt;
        }
        if (!await operationIsCurrent(operation)) return superseded();
        if (typeof store.garbageCollect === 'function') {
          try {
            cleanup = await store.garbageCollect(namespace);
          } catch (_error) {
            cleanup = { removed: 0, failed: true };
          }
        }
        if (!await operationIsCurrent(operation)) return superseded();
      }
      var clearGate = refreshed.state === 'active' || refreshed.state === 'not_modified';
      var calculatorState = await publishCalculatorState(
        namespace, operation, assignment, null, extensionVersion, clearGate);
      if (calculatorState && calculatorState.state === 'superseded') return calculatorState;
      return {
        state: refreshed.state,
        assignment: assignment,
        receipt: receipt,
        cleanup: cleanup,
        calculatorState: calculatorState,
        releaseId: refreshed.releaseId || null,
        releaseSequence: refreshed.releaseSequence || null,
      };
    }

    async function sync(input) {
      if (syncInFlight) return syncInFlight;
      syncInFlight = performSync(input);
      try {
        return await syncInFlight;
      } finally {
        syncInFlight = null;
      }
    }

    function retryableResult(result) {
      if (!result || result.state === 'retryable') return true;
      if (result.receipt && result.receipt.state === 'retryable') return true;
      var status = Number(result.status);
      return result.state === 'http_error' && (status === 429 || status >= 500);
    }

    async function scheduleState(status) {
      var stored = await localStorage.get([SCHEDULE_KEY]);
      var value = stored && stored[SCHEDULE_KEY];
      if (
        !value || value.sessionId !== status.sessionId
        || value.deploymentId !== status.deploymentId
      ) return { failures: 0, nextAttemptAt: null };
      return value;
    }

    async function clearSchedule() {
      if (typeof localStorage.remove === 'function') await localStorage.remove([SCHEDULE_KEY]);
    }

    async function markCalculatorUnavailableUnlocked(state, metadata) {
      var stored = await localStorage.get([CALCULATOR_STATE_KEY]);
      var current = stored && stored[CALCULATOR_STATE_KEY];
      if (!current || typeof current !== 'object') return null;
      var unavailableGate = authoritativeGate(Object.assign(
        { state: state },
        metadata && typeof metadata === 'object' ? metadata : {},
      ));
      var next = Object.assign({}, current,
        metadata && typeof metadata === 'object' ? metadata : {},
        {
        state: state,
        authoritativeGate: unavailableGate,
        source: 'none',
        quoteAllowed: false,
        snapshot: null,
        officialSnapshot: null,
        updatedAt: now().toISOString(),
        });
      var values = {};
      values[CALCULATOR_STATE_KEY] = next;
      await localStorage.set(values);
      return next;
    }

    function markCalculatorUnavailable(state, metadata) {
      return runCalculatorStateMutation(function () {
        return markCalculatorUnavailableUnlocked(state, metadata);
      });
    }

    async function disableAuthorityState(state) {
      await markCalculatorUnavailable(state);
      if (typeof localStorage.remove === 'function') {
        await localStorage.remove([SELECTION_KEY, SCHEDULE_KEY]);
      }
    }

    async function recordBackoff(status, previous, result) {
      var failures = Math.min(20, Math.max(0, Number(previous.failures) || 0) + 1);
      var baseDelay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * Math.pow(2, failures - 1));
      var randomValue = Math.max(0, Math.min(1, Number(random()) || 0));
      var delay = Math.min(MAX_BACKOFF_MS, Math.max(30 * 1000, Math.round(
        baseDelay * (0.75 + randomValue * 0.5),
      )));
      var nextAttemptAt = new Date(now().getTime() + delay).toISOString();
      await localStorage.set({
        [SCHEDULE_KEY]: {
          deploymentId: status.deploymentId,
          sessionId: status.sessionId,
          failures: failures,
          nextAttemptAt: nextAttemptAt,
          lastState: String(result && result.state || 'retryable'),
        },
      });
      return nextAttemptAt;
    }

    async function syncStored(input) {
      input = input && typeof input === 'object' ? input : {};
      var status = await credentials.getStatus();
      if (!status || status.state !== 'paired') {
        var unpaired = { state: 'unpaired', assignments: [] };
        await disableAuthorityState(unpaired.state);
        return unpaired;
      }
      var previous = await scheduleState(status);
      var nextMilliseconds = Date.parse(String(previous.nextAttemptAt || ''));
      if (input.reason !== 'manual' && Number.isFinite(nextMilliseconds)
        && nextMilliseconds > now().getTime()) {
        return { state: 'backoff', nextAttemptAt: previous.nextAttemptAt };
      }
      var result;
      try {
        result = await sync(input);
      } catch (error) {
        if (input.reason === 'manual') throw error;
        result = { state: 'retryable', reason: 'operation_failed' };
      }
      if (result && result.state === 'superseded') return result;
      if (result && [
        'revoked', 'unpaired', 'scope_missing', 'no_assignment', 'needs_selection',
      ].includes(result.state)) {
        await disableAuthorityState(result.state);
        return result;
      }
      if (retryableResult(result)) {
        var nextAttemptAt = await recordBackoff(status, previous, result);
        return Object.assign({}, result, { nextAttemptAt: nextAttemptAt });
      }
      await clearSchedule();
      return result;
    }

    return {
      claim: claim,
      clear: clear,
      getStatus: credentials.getStatus,
      sync: sync,
      syncStored: syncStored,
      saveLocalFallback: saveLocalFallback,
      saveLocalFallbackWithPreferences: saveLocalFallbackWithPreferences,
      updatePreferences: updatePreferences,
    };
  }

  function summarizeSyncResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    var summary = {};
    [
      'state', 'assignments', 'assignment', 'releaseId', 'releaseSequence',
      'nextAttemptAt', 'reason', 'status',
    ].forEach(function (field) {
      if (Object.prototype.hasOwnProperty.call(result, field)) summary[field] = result[field];
    });
    return summary;
  }

  function createMessageHandler(options) {
    var runtime = options && options.runtime;
    var trusted = options && options.isTrustedSettingsSender;
    var supported = new Set([
      'ss-erp:logistics-device-claim',
      'ss-erp:logistics-device-clear',
      'ss-erp:logistics-device-status',
      'ss-erp:logistics-rules-sync',
    ]);
    if (!runtime || typeof trusted !== 'function') {
      throw new TypeError('message handler dependencies are required');
    }

    return async function handleMessage(message, sender) {
      if (!message || !supported.has(message.type)) return { handled: false };
      if (!trusted(sender, options.extensionId)) {
        return { handled: true, ok: false, errorCode: 'untrusted_sender' };
      }
      try {
        var data;
        if (message.type === 'ss-erp:logistics-device-claim') {
          data = await runtime.claim({
            baseUrl: message.baseUrl,
            code: message.code,
            deploymentId: message.deploymentId,
            deviceId: message.deviceId,
            deviceLabel: message.deviceLabel,
          });
        } else if (message.type === 'ss-erp:logistics-device-clear') {
          data = await runtime.clear();
        } else if (message.type === 'ss-erp:logistics-device-status') {
          data = await runtime.getStatus();
        } else {
          var syncMethod = typeof runtime.syncStored === 'function'
            ? runtime.syncStored.bind(runtime)
            : runtime.sync.bind(runtime);
          data = summarizeSyncResult(await syncMethod({
            reason: 'manual',
            baseUrl: message.baseUrl,
            extensionVersion: message.extensionVersion,
            assignmentId: message.assignmentId,
          }));
        }
        return { handled: true, ok: true, data: data };
      } catch (_error) {
        return { handled: true, ok: false, errorCode: 'operation_failed' };
      }
    };
  }

  global.SS_ERP_LOGISTICS_DISTRIBUTION_RUNTIME = {
    SELECTION_KEY: SELECTION_KEY,
    SCHEDULE_KEY: SCHEDULE_KEY,
    CALCULATOR_STATE_KEY: CALCULATOR_STATE_KEY,
    fallbackKeyForScope: fallbackKeyForScope,
    preferenceKeyForScope: preferenceKeyForScope,
    scopeStorageSuffix: scopeStorageSuffix,
    createMessageHandler: createMessageHandler,
    createRuntime: createRuntime,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
