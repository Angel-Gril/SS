(function (global) {
  'use strict';

  var STATUS_KEY = 'ss-erp:logistics-capture-task:status:v1';
  var CAPTURE_SCOPE = 'logistics:capture';
  var MAX_PENDING_TASKS = 50;
  var TASK_ENDPOINTS = {
    'logistics-capture-task/v1': {
      SELLER: [
        'seller/template/by-location',
        'seller/category/list',
        'seller/delivery-speed',
        'seller/provider-inventory',
      ],
      OFFICIAL: ['global-calculator/calculate'],
    },
    'logistics-capture-task/v2': {
      SELLER: [
        'seller/template/by-location',
        'seller/provider-inventory',
      ],
      OFFICIAL: ['global-calculator/calculate'],
    },
    'logistics-capture-task/v3': {
      SELLER: [
        'seller/template/by-location',
        'seller/provider-inventory',
      ],
      OFFICIAL: ['global-calculator/calculate'],
    },
  };

  function endpointsMatch(version, kind, endpoints) {
    var expected = TASK_ENDPOINTS[version] && TASK_ENDPOINTS[version][kind];
    return Boolean(expected) && endpoints.length === expected.length
      && new Set(endpoints).size === endpoints.length
      && expected.every(function (endpoint) { return endpoints.indexOf(endpoint) >= 0; });
  }

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

  function safeStringArray(value, limit) {
    if (!Array.isArray(value) || value.length > limit) return null;
    var output = value.map(text);
    return output.some(function (item) { return !item || item.length > 500; }) ? null : output;
  }

  function normalizeScope(value) {
    if (!isRecord(value)) return null;
    var fields = [
      'tenantId', 'shopId', 'companyId', 'warehouseId', 'originCountryUid', 'originCityUid',
    ];
    var scope = {};
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index];
      var normalized = text(value[field]);
      if (!normalized || normalized.length > 300) return null;
      scope[field] = normalized;
    }
    return scope;
  }

  function normalizeTask(value) {
    if (!isRecord(value)) return null;
    var id = text(value.id);
    var version = text(value.version);
    var kind = text(value.kind).toUpperCase();
    var status = text(value.status).toUpperCase();
    var scope = normalizeScope(value.scope);
    var expectedEndpoints = safeStringArray(value.expectedEndpoints, 500);
    var issuedAt = text(value.issuedAt);
    var expiresAt = text(value.expiresAt);
    var claimToken = text(value.claimToken);
    var nonce = text(value.nonce);
    if (!id || id.length > 300 || !endpointsMatch(version, kind, expectedEndpoints || [])
      || (kind !== 'SELLER' && kind !== 'OFFICIAL')
      || (status !== 'ISSUED' && status !== 'CLAIMED')
      || !scope || !expectedEndpoints || !expectedEndpoints.length
      || !Number.isFinite(Date.parse(issuedAt)) || !Number.isFinite(Date.parse(expiresAt))
      || Date.parse(expiresAt) <= Date.parse(issuedAt)
      || Boolean(claimToken) === Boolean(nonce)
      || (claimToken && (claimToken.length < 20 || claimToken.length > 2000))
      || (nonce && (nonce.length < 20 || nonce.length > 500))) return null;
    if (kind === 'OFFICIAL' && (!isRecord(value.destination)
      || !isRecord(value.officialFingerprint))) return null;
    return {
      id: id,
      version: version,
      kind: kind,
      scope: scope,
      destination: value.destination == null ? null : JSON.parse(JSON.stringify(value.destination)),
      officialFingerprint: value.officialFingerprint == null
        ? null : JSON.parse(JSON.stringify(value.officialFingerprint)),
      expectedEndpoints: expectedEndpoints,
      fingerprintChecksum: text(value.fingerprintChecksum),
      status: status,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      claimToken: claimToken,
      nonce: nonce,
    };
  }

  function proofForTask(task) {
    var proof = {
      taskVersion: task.version,
      scope: JSON.parse(JSON.stringify(task.scope)),
    };
    if (task.claimToken) proof.claimToken = task.claimToken;
    else proof.nonce = task.nonce;
    return proof;
  }

  function publicStatus(value, now) {
    value = isRecord(value) ? value : {};
    var output = {
      state: text(value.state) || 'unknown',
      updatedAt: now().toISOString(),
    };
    var textFields = [
      'taskId', 'kind', 'reason', 'candidateId', 'candidateState', 'errorCode',
    ];
    textFields.forEach(function (field) {
      var normalized = text(value[field]);
      if (normalized) output[field] = normalized.slice(0, 500);
    });
    ['missingEndpoints', 'failedEndpoints', 'emptyEndpoints'].forEach(function (field) {
      var values = safeStringArray(value[field], 500);
      if (values) output[field] = values;
    });
    if (typeof value.requiresReview === 'boolean') output.requiresReview = value.requiresReview;
    return output;
  }

  function createRuntime(options) {
    options = options && typeof options === 'object' ? options : {};
    var credentials = options.credentials;
    var fetchImpl = options.fetchImpl;
    var readCapturedEntries = options.readCapturedEntries;
    var readSelectedServiceIds = options.readSelectedServiceIds;
    var writeStatus = options.writeStatus;
    var readStatus = options.readStatus;
    var harImporter = options.harImporter || global.OZON_CALC_HAR_IMPORT;
    var collectProviderInventory = options.collectProviderInventory;
    var adapter = options.adapter || global.SS_ERP_LOGISTICS_CAPTURE_ADAPTER;
    var now = typeof options.now === 'function' ? options.now : function () { return new Date(); };
    if (!credentials || typeof credentials.beginOperation !== 'function'
      || typeof credentials.isOperationCurrent !== 'function'
      || typeof credentials.clearIfCurrent !== 'function') {
      throw new TypeError('epoch-aware device credentials are required');
    }
    if (typeof fetchImpl !== 'function' || typeof readCapturedEntries !== 'function'
      || typeof readSelectedServiceIds !== 'function'
      || typeof writeStatus !== 'function' || typeof readStatus !== 'function') {
      throw new TypeError('capture runtime dependencies are required');
    }
    if (!adapter || typeof adapter.buildCapture !== 'function') {
      throw new TypeError('capture adapter is required');
    }
    var refreshInFlight = null;

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

    async function persistResult(value, operation) {
      var stored = await persist(value, operation);
      return stored.state === 'superseded' ? stored : value;
    }

    function authorization(operation, extensionVersion) {
      if (!operation || operation.state === 'unpaired') return { state: 'unpaired' };
      var scopes = Array.isArray(operation.scopes) ? operation.scopes.map(String) : [];
      if (scopes.indexOf(CAPTURE_SCOPE) < 0) return { state: 'scope_missing' };
      var baseUrl = normalizeBaseUrl(operation.baseUrl);
      var ownerUserId = text(operation.ownerUserId);
      var accessToken = text(operation.accessToken);
      if (!text(operation.sessionId) || !text(operation.deploymentId) || !ownerUserId || !accessToken) {
        throw new Error('stored capture device operation context is invalid');
      }
      return {
        state: 'ready',
        baseUrl: baseUrl,
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
      try {
        body = await response.json();
      } catch (_error) {
        body = null;
      }
      if (!await isCurrent(operation)) return { state: 'superseded', status: 0, body: null };
      return { state: 'response', status: Number(response.status), body: body };
    }

    function errorCode(result) {
      return text(result && result.body && result.body.error && result.body.error.code);
    }

    function authorizationFailureState(result) {
      var code = errorCode(result);
      var taskTerminal = /^CAPTURE_TASK_/.test(code);
      return taskTerminal ? 'task_unavailable' : 'revoked';
    }

    async function finishAuthorizationFailure(value, operation, result) {
      var stored = await persist(value, operation);
      if (stored.state === 'superseded') return stored;
      if (value.state !== 'revoked') return value;
      var cleared = await credentials.clearIfCurrent(operation, {
        status: result && result.status,
        reason: 'capture_authorization_revoked',
      });
      return cleared ? value : superseded();
    }

    async function pending(auth, operation) {
      var result = await fetchJson(
        operation,
        auth.baseUrl + '/api/logistics-rules/capture-tasks/pending',
        {
          method: 'GET', headers: headers(auth, false),
          credentials: 'omit', cache: 'no-store',
        },
      );
      if (result.state === 'superseded') return superseded();
      if (result.state === 'network_error') return { state: 'retryable', reason: 'network' };
      if (result.status === 401 || result.status === 403 || result.status === 410) {
        return {
          state: 'authorization_failure',
          value: { state: authorizationFailureState(result), status: result.status },
          response: result,
        };
      }
      if (result.status !== 200) {
        return {
          state: result.status === 429 || result.status >= 500 ? 'retryable' : 'http_error',
          status: result.status,
        };
      }
      var tasks = result.body && result.body.code === 1 && result.body.data
        && result.body.data.tasks;
      if (!Array.isArray(tasks) || tasks.length > MAX_PENDING_TASKS) {
        throw new Error('invalid pending capture task response');
      }
      var normalized = tasks.map(normalizeTask);
      if (normalized.some(function (task) { return task === null; })) {
        throw new Error('invalid pending capture task');
      }
      normalized = normalized.filter(function (task) {
        return task.scope.tenantId === auth.ownerUserId
          && Date.parse(task.expiresAt) > now().getTime();
      }).sort(function (left, right) {
        return Date.parse(left.issuedAt) - Date.parse(right.issuedAt);
      });
      return { state: 'ready', tasks: normalized };
    }

    async function postTask(auth, operation, task, action, payload) {
      var body = proofForTask(task);
      if (payload !== undefined) body.payload = payload;
      return fetchJson(
        operation,
        auth.baseUrl + '/api/logistics-rules/capture-tasks/'
          + encodeURIComponent(task.id) + '/' + action,
        {
          method: 'POST', headers: headers(auth, true),
          credentials: 'omit', cache: 'no-store', body: JSON.stringify(body),
        },
      );
    }

    function waitingResult(task, built) {
      var missing = Array.isArray(built.missingEndpoints) ? built.missingEndpoints : [];
      var providerMissing = missing.indexOf('seller/provider-inventory') >= 0
        || built.reason === 'provider_inventory_incomplete';
      return {
        state: providerMissing ? 'waiting_for_provider_inventory' : 'waiting_for_capture',
        taskId: task.id,
        kind: task.kind,
        reason: built.reason,
        missingEndpoints: missing,
        failedEndpoints: Array.isArray(built.failedEndpoints) ? built.failedEndpoints : [],
        emptyEndpoints: Array.isArray(built.emptyEndpoints) ? built.emptyEndpoints : [],
      };
    }

    async function performRefresh(input) {
      input = input && typeof input === 'object' ? input : {};
      var operation = await credentials.beginOperation();
      var auth = authorization(operation, input.extensionVersion);
      if (auth.state !== 'ready') {
        return persistResult(auth, operation);
      }
      var discovered = await pending(auth, operation);
      if (discovered.state === 'superseded') return discovered;
      if (discovered.state === 'authorization_failure') {
        return finishAuthorizationFailure(discovered.value, operation, discovered.response);
      }
      if (discovered.state !== 'ready') {
        return persistResult(discovered, operation);
      }
      var task = discovered.tasks[0];
      if (!task) {
        var idle = { state: 'idle' };
        return persistResult(idle, operation);
      }
      var entries = await readCapturedEntries();
      var selectedServiceIds = await readSelectedServiceIds();
      var built = await adapter.buildCapture({
        task: task,
        entries: Array.isArray(entries) ? entries : [],
        selectedServiceIds: Array.isArray(selectedServiceIds) ? selectedServiceIds : [],
        harImporter: harImporter,
      });
      if (!await isCurrent(operation)) return superseded();
      if (!built || built.state !== 'ready') {
        var mayCollectProviders = input.allowProviderCollection === true
          && (input.reason === 'manual' || input.reason === 'retry')
          && task.kind === 'SELLER'
          && typeof collectProviderInventory === 'function';
        var providerMissing = built && built.state !== 'ready'
          && (built.reason === 'provider_inventory_incomplete'
            || (Array.isArray(built.missingEndpoints)
              && built.missingEndpoints.indexOf('seller/provider-inventory') >= 0));
        if (mayCollectProviders && providerMissing && isRecord(built.collectionContext)) {
          var collecting = await persist({
            state: 'collecting', taskId: task.id, kind: task.kind,
            reason: 'provider_inventory',
          }, operation);
          if (collecting.state === 'superseded') return collecting;
          await collectProviderInventory({
            companyId: text(built.collectionContext.companyId),
            point: JSON.parse(JSON.stringify(built.collectionContext.point)),
            task: task,
          });
          if (!await isCurrent(operation)) return superseded();
          entries = await readCapturedEntries();
          built = await adapter.buildCapture({
            task: task,
            entries: Array.isArray(entries) ? entries : [],
            selectedServiceIds: Array.isArray(selectedServiceIds) ? selectedServiceIds : [],
            harImporter: harImporter,
          });
          if (!await isCurrent(operation)) return superseded();
        }
        if (!built || built.state !== 'ready') {
          var waiting = waitingResult(task, built || { reason: 'capture_not_ready' });
          return persistResult(waiting, operation);
        }
      }
      var ready = await persist({ state: 'ready_to_upload', taskId: task.id, kind: task.kind }, operation);
      if (ready.state === 'superseded') return ready;
      var claimed = await postTask(auth, operation, task, 'claim');
      if (claimed.state === 'superseded') return superseded();
      if (claimed.state === 'network_error') {
        var claimRetry = { state: 'retryable', taskId: task.id, kind: task.kind, reason: 'network' };
        return persistResult(claimRetry, operation);
      }
      if (claimed.status === 401 || claimed.status === 403 || claimed.status === 404
        || claimed.status === 409 || claimed.status === 410) {
        var claimAuthorizationFailure = claimed.status === 401 || claimed.status === 403
          || claimed.status === 410;
        var claimFailure = {
          state: claimAuthorizationFailure ? authorizationFailureState(claimed) : 'task_unavailable',
          taskId: task.id, kind: task.kind,
          errorCode: errorCode(claimed),
        };
        return claimAuthorizationFailure
          ? finishAuthorizationFailure(claimFailure, operation, claimed)
          : persistResult(claimFailure, operation);
      }
      if (claimed.status !== 200) {
        var claimHttp = {
          state: claimed.status === 429 || claimed.status >= 500 ? 'retryable' : 'http_error',
          taskId: task.id, kind: task.kind, errorCode: errorCode(claimed),
        };
        return persistResult(claimHttp, operation);
      }
      var uploaded = await postTask(auth, operation, task, 'upload', built.payload);
      if (uploaded.state === 'superseded') return superseded();
      if (uploaded.state === 'network_error') {
        var uploadRetry = { state: 'retryable', taskId: task.id, kind: task.kind, reason: 'network' };
        return persistResult(uploadRetry, operation);
      }
      if (uploaded.status === 401 || uploaded.status === 403 || uploaded.status === 410) {
        var uploadAuthorizationFailure = {
          state: authorizationFailureState(uploaded),
          taskId: task.id, kind: task.kind, errorCode: errorCode(uploaded),
        };
        return finishAuthorizationFailure(uploadAuthorizationFailure, operation, uploaded);
      }

      if (uploaded.status !== 200 && uploaded.status !== 201) {
        var uploadFailure = {
          state: uploaded.status === 429 || uploaded.status >= 500 ? 'retryable' : 'rejected',
          taskId: task.id, kind: task.kind, errorCode: errorCode(uploaded),
        };
        return persistResult(uploadFailure, operation);
      }
      var data = uploaded.body && uploaded.body.code === 1 && uploaded.body.data;
      if (!isRecord(data) || !text(data.candidateId) || !text(data.state)) {
        throw new Error('invalid capture upload response');
      }
      var result = {
        state: 'uploaded',
        taskId: task.id,
        kind: task.kind,
        candidateId: text(data.candidateId),
        candidateState: text(data.state),
        requiresReview: Boolean(data.requiresReview),
      };
      return persistResult(result, operation);
    }

    function refresh(input) {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = performRefresh(input).finally(function () { refreshInFlight = null; });
      return refreshInFlight;
    }

    async function cancel(input) {
      input = input && typeof input === 'object' ? input : {};
      var taskId = text(input.taskId);
      if (!taskId) throw new TypeError('capture task id is required');
      var operation = await credentials.beginOperation();
      var auth = authorization(operation, input.extensionVersion);
      if (auth.state !== 'ready') return persistResult(auth, operation);
      var discovered = await pending(auth, operation);
      if (discovered.state === 'superseded') return discovered;
      if (discovered.state === 'authorization_failure') {
        return finishAuthorizationFailure(discovered.value, operation, discovered.response);
      }
      if (discovered.state !== 'ready') return persistResult(discovered, operation);
      var task = discovered.tasks.find(function (candidate) { return candidate.id === taskId; });
      if (!task) {
        var absent = { state: 'task_unavailable', taskId: taskId };
        return persistResult(absent, operation);
      }
      var cancelled = await postTask(auth, operation, task, 'cancel');
      if (cancelled.state === 'superseded') return superseded();
      if (cancelled.state === 'network_error') {
        var retry = { state: 'retryable', taskId: task.id, kind: task.kind, reason: 'network' };
        return persistResult(retry, operation);
      }
      if (cancelled.status === 401 || cancelled.status === 403 || cancelled.status === 410) {
        var cancelAuthorizationFailure = {
          state: authorizationFailureState(cancelled),
          taskId: task.id, kind: task.kind, errorCode: errorCode(cancelled),
        };
        return finishAuthorizationFailure(cancelAuthorizationFailure, operation, cancelled);
      }

      if (cancelled.status !== 200) {
        var failure = {
          state: cancelled.status === 429 || cancelled.status >= 500 ? 'retryable' : 'task_unavailable',
          taskId: task.id, kind: task.kind, errorCode: errorCode(cancelled),
        };
        return persistResult(failure, operation);
      }
      var result = { state: 'cancelled', taskId: task.id, kind: task.kind };
      return persistResult(result, operation);
    }

    return {
      refresh: refresh,
      retry: refresh,
      cancel: cancel,
      getStatus: readStatus,
    };
  }

  function createMessageHandler(options) {
    var runtime = options && options.runtime;
    var trusted = options && options.isTrustedSettingsSender;
    var supported = new Set([
      'ss-erp:logistics-capture-refresh',
      'ss-erp:logistics-capture-retry',
      'ss-erp:logistics-capture-status',
      'ss-erp:logistics-capture-cancel',
    ]);
    if (!runtime || typeof trusted !== 'function') {
      throw new TypeError('capture message handler dependencies are required');
    }
    return async function handle(message, sender) {
      if (!message || !supported.has(message.type)) return { handled: false };
      if (!trusted(sender, options.extensionId)) {
        return { handled: true, ok: false, errorCode: 'untrusted_sender' };
      }
      try {
        var data;
        if (message.type === 'ss-erp:logistics-capture-status') {
          data = await runtime.getStatus();
        } else if (message.type === 'ss-erp:logistics-capture-cancel') {
          data = await runtime.cancel({
            taskId: message.taskId,
            extensionVersion: message.extensionVersion,
          });
        } else {
          data = await runtime.refresh({
            reason: message.type === 'ss-erp:logistics-capture-retry' ? 'retry' : 'manual',
            extensionVersion: message.extensionVersion,
            allowProviderCollection: true,
          });
        }
        return { handled: true, ok: true, data: data };
      } catch (_error) {
        return { handled: true, ok: false, errorCode: 'operation_failed' };
      }
    };
  }

  global.SS_ERP_LOGISTICS_CAPTURE_RUNTIME = {
    STATUS_KEY: STATUS_KEY,
    createRuntime: createRuntime,
    createMessageHandler: createMessageHandler,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
