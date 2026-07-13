(function (global) {
  'use strict';

  var STATUS_KEY = 'ss-erp:logistics-binding-probe:status:v1';
  var REQUIRED_SCOPE = 'logistics:capture';
  var MAX_PENDING_PROBES = 50;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeBaseUrl(value) {
    var parsed = new URL(text(value));
    var local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new TypeError('ERP endpoint must use HTTPS');
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function requiredIdentifier(value) {
    var normalized = text(value);
    return normalized && normalized.length <= 300 ? normalized : '';
  }

  function normalizeProbe(value) {
    if (!isRecord(value) || !isRecord(value.expected)
      || !isRecord(value.expected.warehouse) || !isRecord(value.expected.deliveryMethod)) return null;
    var methodId = value.expected.deliveryMethod.platformMethodId;
    var normalized = {
      probeId: requiredIdentifier(value.probeId),
      bootstrapId: requiredIdentifier(value.bootstrapId),
      status: text(value.status).toUpperCase(),
      claimToken: text(value.claimToken),
      expiresAt: text(value.expiresAt),
      expected: {
        deploymentId: requiredIdentifier(value.expected.deploymentId),
        tenantId: requiredIdentifier(value.expected.tenantId),
        shopId: requiredIdentifier(value.expected.shopId),
        warehouse: {
          id: requiredIdentifier(value.expected.warehouse.id),
          platformWarehouseId: requiredIdentifier(value.expected.warehouse.platformWarehouseId),
        },
        deliveryMethod: {
          id: requiredIdentifier(value.expected.deliveryMethod.id),
          platformMethodId: methodId,
        },
      },
    };
    if (!normalized.probeId || !normalized.bootstrapId
      || (normalized.status !== 'ISSUED' && normalized.status !== 'CLAIMED')
      || normalized.claimToken.length < 20 || normalized.claimToken.length > 2000
      || !Number.isFinite(Date.parse(normalized.expiresAt))
      || !normalized.expected.deploymentId || !normalized.expected.tenantId
      || !normalized.expected.shopId || !normalized.expected.warehouse.id
      || !normalized.expected.warehouse.platformWarehouseId
      || !normalized.expected.deliveryMethod.id
      || !Number.isSafeInteger(methodId) || methodId <= 0) return null;
    normalized.expiresAt = new Date(normalized.expiresAt).toISOString();
    return normalized;
  }

  function publicStatus(value, now) {
    value = isRecord(value) ? value : {};
    var result = {
      state: text(value.state) || 'unknown',
      updatedAt: now().toISOString(),
    };
    ['probeId', 'reason', 'errorCode'].forEach(function (field) {
      var normalized = text(value[field]);
      if (normalized) result[field] = normalized.slice(0, 500);
    });
    if (typeof value.duplicate === 'boolean') result.duplicate = value.duplicate;
    return result;
  }

  function defaultEndpoints() {
    return {
      pending: function (baseUrl) {
        return baseUrl + '/api/logistics-rules/binding-probes/pending';
      },
      claim: function (baseUrl, probeId) {
        return baseUrl + '/api/logistics-rules/binding-probes/'
          + encodeURIComponent(probeId) + '/claim';
      },
      submit: function (baseUrl, probeId) {
        return baseUrl + '/api/logistics-rules/binding-probes/'
          + encodeURIComponent(probeId) + '/submit';
      },
    };
  }

  function createRuntime(options) {
    options = isRecord(options) ? options : {};
    var credentials = options.credentials;
    var fetchImpl = options.fetchImpl;
    var collectEvidence = options.collectEvidence;
    var writeStatus = options.writeStatus;
    var readStatus = options.readStatus;
    var adapter = options.adapter || global.SS_ERP_LOGISTICS_BINDING_PROBE_ADAPTER;
    var endpoints = options.endpoints || defaultEndpoints();
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    if (!credentials || typeof credentials.beginOperation !== 'function'
      || typeof credentials.isOperationCurrent !== 'function'
      || typeof credentials.clearIfCurrent !== 'function') {
      throw new TypeError('epoch-aware device credentials are required');
    }
    if (typeof fetchImpl !== 'function' || typeof collectEvidence !== 'function'
      || typeof writeStatus !== 'function' || typeof readStatus !== 'function'
      || !adapter || typeof adapter.buildEvidence !== 'function'
      || !endpoints || typeof endpoints.pending !== 'function'
      || typeof endpoints.claim !== 'function' || typeof endpoints.submit !== 'function') {
      throw new TypeError('binding probe runtime dependencies are required');
    }
    var runsByEpoch = new Map();

    function superseded() {
      return { state: 'superseded' };
    }

    async function isCurrent(operation) {
      try {
        return await credentials.isOperationCurrent(operation) === true;
      } catch (_error) {
        return false;
      }
    }

    async function persist(value, operation) {
      if (operation && !await isCurrent(operation)) return superseded();
      var status = publicStatus(value, now);
      await writeStatus(status, operation);
      if (operation && !await isCurrent(operation)) return superseded();
      return status;
    }

    function authorization(operation, extensionVersion) {
      if (!operation || operation.state === 'unpaired') return { state: 'unpaired' };
      var scopes = Array.isArray(operation.scopes) ? operation.scopes.map(String) : [];
      if (scopes.indexOf(REQUIRED_SCOPE) < 0) return { state: 'scope_missing' };
      var baseUrl = normalizeBaseUrl(operation.baseUrl);
      var deploymentId = requiredIdentifier(operation.deploymentId);
      var ownerUserId = requiredIdentifier(operation.ownerUserId);
      var accessToken = text(operation.accessToken);
      if (!requiredIdentifier(operation.sessionId) || !deploymentId || !ownerUserId || !accessToken) {
        throw new Error('stored binding probe operation context is invalid');
      }
      return {
        state: 'ready',
        baseUrl: baseUrl,
        deploymentId: deploymentId,
        ownerUserId: ownerUserId,
        extensionVersion: text(extensionVersion),
        accessToken: accessToken,
      };
    }

    function headers(auth, json) {
      var result = {
        Accept: 'application/json',
        Authorization: 'Bearer ' + auth.accessToken,
        'X-SS-ERP-Extension-Version': auth.extensionVersion,
      };
      if (json) result['Content-Type'] = 'application/json';
      return result;
    }

    async function fetchJson(operation, url, init) {
      if (!await isCurrent(operation)) return { state: 'superseded', status: 0, body: null };
      var response;
      try {
        response = await fetchImpl(url, init);
      } catch (_error) {
        if (!await isCurrent(operation)) return { state: 'superseded', status: 0, body: null };
        return { state: 'network_error', status: 0, body: null };
      }
      if (!await isCurrent(operation)) return { state: 'superseded', status: 0, body: null };
      var body = null;
      try { body = await response.json(); } catch (_error) {}
      if (!await isCurrent(operation)) return { state: 'superseded', status: 0, body: null };
      return { state: 'response', status: Number(response.status), body: body };
    }

    function errorCode(result) {
      return text(result && result.body && result.body.error && result.body.error.code);
    }

    async function authorizationFailure(result, operation) {
      var code = errorCode(result);
      if (result.status === 410 && code === 'BINDING_PROBE_EXPIRED') return 'expired';
      if (result.status !== 401 && result.status !== 403 && result.status !== 410) return '';
      return 'revoked';
    }

    async function finishAuthorizationFailure(state, value, operation, result) {
      if (state === 'superseded') return superseded();
      if (state !== 'revoked') return persist(value, operation);
      var persisted = await persist(value, operation);
      if (persisted.state === 'superseded') return persisted;
      var cleared = await credentials.clearIfCurrent(operation, {
        status: result && result.status,
        reason: 'binding_probe_authorization_revoked',
      });
      return cleared ? persisted : superseded();
    }

    function failureState(result) {
      var code = errorCode(result);
      if (result.status === 404 || code === 'BINDING_PROBE_UNAVAILABLE') return 'unavailable';
      if (code === 'BINDING_PROBE_EXPIRED') return 'expired';
      if (code === 'BINDING_PROBE_REPLAYED') return 'replayed';
      if (code === 'BINDING_PROBE_EVIDENCE_MISMATCH') return 'scope_mismatch';
      if (result.status === 429 || result.status >= 500) return 'retryable';
      return 'rejected';
    }

    async function pending(auth, operation) {
      var result = await fetchJson(operation, endpoints.pending(auth.baseUrl), {
        method: 'GET', headers: headers(auth, false), credentials: 'omit', cache: 'no-store',
      });
      if (result.state === 'superseded') return superseded();
      if (result.state === 'network_error') return { state: 'retryable', reason: 'network' };
      var authorizationState = await authorizationFailure(result, operation);
      if (authorizationState) {
        return finishAuthorizationFailure(authorizationState, {
          state: authorizationState, errorCode: errorCode(result),
        }, operation, result);
      }
      if (result.status !== 200) return { state: failureState(result), errorCode: errorCode(result) };
      var probes = result.body && result.body.code === 1 && result.body.data
        && result.body.data.probes;
      if (!Array.isArray(probes) || probes.length > MAX_PENDING_PROBES) {
        throw new Error('invalid pending binding probe response');
      }
      var normalized = probes.map(normalizeProbe);
      if (normalized.some(function (probe) { return probe === null; })) {
        throw new Error('invalid pending binding probe');
      }
      return { state: 'ready', probes: normalized };
    }

    async function postProbe(auth, operation, probe, action, body) {
      return fetchJson(operation, endpoints[action](auth.baseUrl, probe.probeId), {
        method: 'POST', headers: headers(auth, true), credentials: 'omit', cache: 'no-store',
        body: JSON.stringify(body),
      });
    }

    function collectorProbe(probe) {
      return {
        probeId: probe.probeId,
        expected: {
          warehouse: {
            platformWarehouseId: probe.expected.warehouse.platformWarehouseId,
          },
          deliveryMethod: {
            platformMethodId: probe.expected.deliveryMethod.platformMethodId,
          },
        },
      };
    }

    async function performRun(input, operation) {
      input = isRecord(input) ? input : {};
      if (!await isCurrent(operation)) return superseded();
      var auth = authorization(operation, input.extensionVersion);
      if (auth.state !== 'ready') return persist(auth, operation);
      var discovered = await pending(auth, operation);
      if (discovered.state === 'superseded') return superseded();
      if (discovered.state === 'revoked') return discovered;
      if (discovered.state !== 'ready') return persist(discovered, operation);
      if (!discovered.probes.length) return persist({ state: 'idle' }, operation);

      var eligible = [];
      var expired = [];
      var wrongScope = [];
      discovered.probes.forEach(function (probe) {
        if (probe.expected.deploymentId !== auth.deploymentId
          || probe.expected.tenantId !== auth.ownerUserId) {
          wrongScope.push(probe);
        } else if (Date.parse(probe.expiresAt) <= now().getTime()) {
          expired.push(probe);
        } else {
          eligible.push(probe);
        }
      });
      if (!eligible.length) {
        if (expired.length) return persist({ state: 'expired', probeId: expired[0].probeId }, operation);
        if (wrongScope.length) {
          return persist({ state: 'scope_mismatch', probeId: wrongScope[0].probeId }, operation);
        }
        return persist({ state: 'idle' }, operation);
      }

      if (!await isCurrent(operation)) return superseded();
      var collected = await collectEvidence(eligible.map(collectorProbe), operation);
      if (!await isCurrent(operation)) return superseded();
      if (!isRecord(collected) || !Array.isArray(collected.matches)) {
        return persist({ state: 'retryable', reason: 'seller_collection_failed' }, operation);
      }
      if (text(collected.state) !== 'ready') {
        return persist({ state: 'retryable', reason: 'seller_collection_failed' }, operation);
      }
      var byId = new Map(eligible.map(function (probe) { return [probe.probeId, probe]; }));
      var matched = [];
      var seen = new Set();
      for (var matchIndex = 0; matchIndex < collected.matches.length; matchIndex += 1) {
        var observed = collected.matches[matchIndex];
        var probeId = text(observed && observed.probeId);
        var probe = byId.get(probeId);
        if (!probe || seen.has(probeId)) {
          return persist({ state: 'rejected', reason: 'invalid_collector_projection' }, operation);
        }
        seen.add(probeId);
        var built = adapter.buildEvidence({ probe: probe, observedEvidence: observed.evidence });
        if (built && built.state === 'ready') matched.push({ probe: probe, evidence: built.evidence });
      }
      if (!matched.length) {
        return persist({ state: 'pending', reason: 'warehouse_method_not_observed' }, operation);
      }
      if (matched.length !== 1) {
        return persist({ state: 'ambiguous', reason: 'multiple_exact_matches' }, operation);
      }
      var selected = matched[0];
      var selectedProbe = selected.probe;

      var claim = await postProbe(auth, operation, selectedProbe, 'claim', {
        claimToken: selectedProbe.claimToken,
      });
      if (claim.state === 'superseded') return superseded();
      if (claim.state === 'network_error') {
        return persist({ state: 'retryable', probeId: selectedProbe.probeId, reason: 'network' }, operation);
      }
      var claimAuthorization = await authorizationFailure(claim, operation);
      if (claimAuthorization) {
        return finishAuthorizationFailure(claimAuthorization, {
          state: claimAuthorization, probeId: selectedProbe.probeId, errorCode: errorCode(claim),
        }, operation, claim);
      }
      if (claim.status !== 200) {
        return persist({
          state: failureState(claim), probeId: selectedProbe.probeId, errorCode: errorCode(claim),
        }, operation);
      }
      var claimData = claim.body && claim.body.code === 1 && claim.body.data;
      if (!isRecord(claimData) || text(claimData.probeId) !== selectedProbe.probeId
        || text(claimData.status).toUpperCase() !== 'CLAIMED') {
        throw new Error('invalid binding probe claim response');
      }

      var submitted = await postProbe(auth, operation, selectedProbe, 'submit', {
        claimToken: selectedProbe.claimToken,
        evidence: selected.evidence,
      });
      if (submitted.state === 'superseded') return superseded();
      if (submitted.state === 'network_error') {
        return persist({ state: 'retryable', probeId: selectedProbe.probeId, reason: 'network' }, operation);
      }
      var submitAuthorization = await authorizationFailure(submitted, operation);
      if (submitAuthorization) {
        return finishAuthorizationFailure(submitAuthorization, {
          state: submitAuthorization, probeId: selectedProbe.probeId, errorCode: errorCode(submitted),
        }, operation, submitted);
      }
      if (submitted.status !== 200 && submitted.status !== 201) {
        return persist({
          state: failureState(submitted), probeId: selectedProbe.probeId, errorCode: errorCode(submitted),
        }, operation);
      }
      var data = submitted.body && submitted.body.code === 1 && submitted.body.data;
      if (!isRecord(data) || text(data.probeId) !== selectedProbe.probeId
        || text(data.status).toUpperCase() !== 'SUBMITTED') {
        throw new Error('invalid binding probe submit response');
      }
      return persist({
        state: 'submitted', probeId: selectedProbe.probeId, duplicate: data.duplicate === true,
      }, operation);
    }

    function operationKey(operation) {
      return [operation && operation.epoch, operation && operation.sessionId,
        operation && operation.deploymentId, operation && operation.ownerUserId].map(text).join(':');
    }

    function run(input) {
      return Promise.resolve(credentials.beginOperation()).then(function (operation) {
        var key = operationKey(operation);
        if (runsByEpoch.has(key)) return runsByEpoch.get(key);
        var promise = performRun(input, operation).finally(function () {
          if (runsByEpoch.get(key) === promise) runsByEpoch.delete(key);
        });
        runsByEpoch.set(key, promise);
        return promise;
      });
    }

    return { run: run, getStatus: readStatus };
  }

  function createMessageHandler(options) {
    options = isRecord(options) ? options : {};
    var runtime = options.runtime;
    var trusted = options.isTrustedSettingsSender;
    var supported = new Set([
      'ss-erp:logistics-binding-probe-run',
      'ss-erp:logistics-binding-probe-status',
    ]);
    if (!runtime || typeof runtime.run !== 'function' || typeof runtime.getStatus !== 'function'
      || typeof trusted !== 'function') {
      throw new TypeError('binding probe message dependencies are required');
    }
    return async function handle(message, sender) {
      if (!message || !supported.has(message.type)) return { handled: false };
      if (!trusted(sender, options.extensionId)) {
        return { handled: true, ok: false, errorCode: 'untrusted_sender' };
      }
      try {
        var data = message.type === 'ss-erp:logistics-binding-probe-status'
          ? await runtime.getStatus()
          : await runtime.run({ extensionVersion: text(message.extensionVersion) });
        return { handled: true, ok: true, data: data };
      } catch (_error) {
        return { handled: true, ok: false, errorCode: 'operation_failed' };
      }
    };
  }

  global.SS_ERP_LOGISTICS_BINDING_PROBE_RUNTIME = {
    STATUS_KEY: STATUS_KEY,
    createRuntime: createRuntime,
    createMessageHandler: createMessageHandler,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
