(function (global) {
  'use strict';

  function requiredText(value, label) {
    var normalized = String(value == null ? '' : value).trim();
    if (!normalized) throw new TypeError(label + ' is required');
    return normalized;
  }

  function normalizeBaseUrl(value) {
    var parsed = new URL(requiredText(value, 'baseUrl'));
    var local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new TypeError('ERP endpoint must use HTTPS');
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function assertResponseScope(data, namespace, assignmentId) {
    try {
      var payload = data && data.bundle;
      var scope = payload && payload.scope;
      var revisionScope = payload && payload.revisionPayload
        && payload.revisionPayload.scope;
      var assignment = payload && payload.assignment;
      var expected = [
        [scope && scope.tenantId, namespace.tenantSubject],
        [scope && scope.shopId, namespace.shopId],
        [scope && scope.ozonCompanyId, namespace.ozonCompanyId],
        [scope && scope.warehouseId, namespace.warehouseId],
        [scope && scope.originCountryUid, namespace.originCountryUid],
        [scope && scope.originCityUid, namespace.originCityUid],
        [scope && scope.destinationCountryUid, namespace.destinationCountryUid],
        [scope && scope.destinationLocationUid, namespace.destinationLocationUid],
        [revisionScope && revisionScope.deploymentId, namespace.deploymentId],
        [revisionScope && revisionScope.tenantId, namespace.tenantSubject],
        [revisionScope && revisionScope.shopId, namespace.shopId],
        [revisionScope && revisionScope.ozonCompanyId, namespace.ozonCompanyId],
        [revisionScope && revisionScope.erpWarehouseId, namespace.warehouseId],
        [revisionScope && revisionScope.originCountryUid, namespace.originCountryUid],
        [revisionScope && revisionScope.originCityUid, namespace.originCityUid],
        [revisionScope && revisionScope.destinationCountryUid, namespace.destinationCountryUid],
        [revisionScope && revisionScope.destinationLocationUid, namespace.destinationLocationUid],
        [assignment && assignment.id, assignmentId],
      ];
      for (var index = 0; index < expected.length; index += 1) {
        if (requiredText(expected[index][0], 'response scope')
          !== requiredText(expected[index][1], 'expected scope')) {
          throw new Error('scope mismatch');
        }
      }
      var actualSchemaMajor = revisionScope && revisionScope.schemaMajor;
      var expectedSchemaMajor = namespace && namespace.schemaMajor;
      if (!Number.isSafeInteger(actualSchemaMajor)
        || !Number.isSafeInteger(expectedSchemaMajor)
        || actualSchemaMajor !== expectedSchemaMajor) {
        throw new Error('schema mismatch');
      }
    } catch (_error) {
      throw new Error('logistics response scope mismatch');
    }
  }

  function createClient(options) {
    var fetchImpl = options && options.fetchImpl;
    var store = options && options.store;
    var credentials = options && options.credentials;
    var randomId = options && options.randomId;
    var now = options && options.now ? options.now : function () { return new Date(); };
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    if (!store || typeof store.stageAndActivate !== 'function') {
      throw new TypeError('distribution store is required');
    }
    if (!credentials || typeof credentials.beginOperation !== 'function'
      || typeof credentials.isOperationCurrent !== 'function'
      || typeof credentials.clearIfCurrent !== 'function') {
      throw new TypeError('device credentials are required');
    }
    if (typeof randomId !== 'function') throw new TypeError('randomId is required');

    function superseded() {
      return { state: 'superseded' };
    }

    async function beginCredentialOperation() {
      var operation = await credentials.beginOperation();
      if (!operation || operation.state !== 'paired') {
        throw new Error('device credentials are unavailable');
      }
      requiredText(operation.accessToken, 'device access token');
      return operation;
    }

    async function operationIsCurrent(operation) {
      return Boolean(await credentials.isOperationCurrent(operation));
    }


    async function revokeScopedAuthorization(response, namespace, assignmentId, operation) {
      var errorBody = null;
      try {
        errorBody = await response.json();
      } catch (_error) {
        errorBody = null;
      }
      var reason = String(
        errorBody && (errorBody.reasonCode || errorBody.errorCode)
          || 'authorization_revoked',
      ).trim();
      if (!/^[a-z0-9_]{1,80}$/.test(reason)) reason = 'authorization_revoked';
      var revoked = {
        status: response.status,
        reason: reason,
        assignmentId: assignmentId,
      };
      if (response.status === 410) {
        if (!await operationIsCurrent(operation)) return superseded();
      } else if (!await credentials.clearIfCurrent(operation, revoked)) {
        return superseded();
      }
      if (typeof store.markRevoked === 'function') await store.markRevoked(namespace, revoked);
      return { state: 'revoked', status: response.status, reason: reason };
    }
    async function discover(input) {
      var baseUrl = normalizeBaseUrl(input && input.baseUrl);
      var extensionVersion = requiredText(input && input.extensionVersion, 'extensionVersion');
      var operation = await beginCredentialOperation();
      var accessToken = operation.accessToken;
      var response;
      try {
        response = await fetchImpl(baseUrl + '/api/logistics-rules/assignments', {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + accessToken,
            'X-SS-ERP-Extension-Version': extensionVersion,
          },
          credentials: 'omit',
          cache: 'no-store',
        });
      } catch (_error) {
        if (!await operationIsCurrent(operation)) return superseded();
        return { state: 'retryable', reason: 'network', assignments: [] };
      }
      if (!await operationIsCurrent(operation)) return superseded();
      if (response.status === 401 || response.status === 403 || response.status === 410) {
        if (!await credentials.clearIfCurrent(operation, {
          status: response.status,
          reason: 'authorization_revoked',
        })) return superseded();
        return { state: 'revoked', status: response.status, assignments: [] };
      }
      if (response.status !== 200) {
        return { state: 'http_error', status: response.status, assignments: [] };
      }
      var body = await response.json();
      if (!await operationIsCurrent(operation)) return superseded();
      var assignments = body && body.code === 1 && body.data && body.data.assignments;
      if (!Array.isArray(assignments) || assignments.length > 500) {
        throw new Error('invalid logistics assignment response');
      }
      var fields = [
        'assignmentId',
        'shopId',
        'shopName',
        'companyId',
        'warehouseId',
        'warehouseName',
        'originCountryUid',
        'originCityUid',
        'originLabel',
        'destinationCountryUid',
        'destinationLocationUid',
        'destinationLabel',
      ];
      var normalized = assignments.map(function (assignment) {
        if (!assignment || typeof assignment !== 'object') {
          throw new Error('invalid logistics assignment');
        }
        var value = {};
        fields.forEach(function (field) {
          var text = requiredText(assignment[field], 'assignment.' + field);
          if (text.length > 300) throw new Error('logistics assignment field is too long');
          value[field] = text;
        });
        if (typeof assignment.effectiveReleaseAvailable !== 'boolean') {
          throw new Error('assignment effective release availability is required');
        }
        value.effectiveReleaseAvailable = assignment.effectiveReleaseAvailable;
        var sequence = Number(assignment.releaseSequence);
        if (!Number.isSafeInteger(sequence) || sequence < 0) {
          throw new Error('invalid logistics assignment sequence');
        }
        value.releaseSequence = sequence;
        return value;
      });
      return { state: 'ready', assignments: normalized };
    }

    async function refresh(input) {
      var baseUrl = normalizeBaseUrl(input && input.baseUrl);
      var assignmentId = requiredText(input && input.assignmentId, 'assignmentId');
      var extensionVersion = requiredText(input && input.extensionVersion, 'extensionVersion');
      var operation = await beginCredentialOperation();
      var accessToken = operation.accessToken;
      var pointer = typeof store.readPointer === 'function'
        ? await store.readPointer(input.namespace)
        : null;
      if (!await operationIsCurrent(operation)) return superseded();
      var activeBundle = null;
      if (pointer && pointer.state !== 'revoked' && pointer.etag
        && typeof store.readActive === 'function') {
        activeBundle = await store.readActive(input.namespace);
        if (!await operationIsCurrent(operation)) return superseded();
      }
      var headers = {
        Accept: 'application/json',
        Authorization: 'Bearer ' + accessToken,
        'X-SS-ERP-Extension-Version': extensionVersion,
      };
      if (pointer && pointer.state !== 'revoked' && pointer.etag
        && (typeof store.readActive !== 'function' || activeBundle)) {
        headers['If-None-Match'] = pointer.etag;
      }

      var url = baseUrl
        + '/api/logistics-rules/assignments/'
        + encodeURIComponent(assignmentId)
        + '/effective';
      var response;
      try {
        response = await fetchImpl(url, {
        method: 'GET',
        headers: headers,
        credentials: 'omit',
        cache: 'no-store',
        });
      } catch (_error) {
        if (!await operationIsCurrent(operation)) return superseded();
        return { state: 'retryable', reason: 'network' };
      }

      if (!await operationIsCurrent(operation)) return superseded();
      if (response.status === 401 || response.status === 403 || response.status === 410) {
        return revokeScopedAuthorization(response, input.namespace, assignmentId, operation);
      }
      if (response.status === 304) {
        if (!pointer || typeof store.applyNotModified !== 'function') {
          throw new Error('304 response has no active bundle');
        }
        var responseEtag = requiredText(response.headers.get('etag'), 'ETag');
        if (responseEtag !== pointer.etag) {
          throw new Error('304 ETag does not match the active bundle');
        }
        if (!await operationIsCurrent(operation)) return superseded();
        var notModified = await store.applyNotModified({
          namespace: input.namespace,
          etag: responseEtag,
          effectiveChecksum: requiredText(
            pointer.effectiveChecksum,
            'active effective checksum',
          ),
          serverTime: requiredText(
            response.headers.get('x-ss-erp-server-time'),
            'server time',
          ),
          authorizationValidUntil: requiredText(
            response.headers.get('x-ss-erp-authorization-valid-until'),
            'authorization valid until',
          ),
        });
        return {
          state: 'not_modified',
          generation: notModified && notModified.generation,
        };
      }
      if (response.status === 426) {
        var upgradeBody = null;
        try {
          upgradeBody = await response.json();
        } catch (_error) {
          upgradeBody = null;
        }
        if (!await operationIsCurrent(operation)) return superseded();
        var minimumVersion = String(
          upgradeBody && upgradeBody.data && upgradeBody.data.minExtensionVersion || '',
        ).trim();
        var upgradeResult = {
          state: 'upgrade_required',
          minExtensionVersion: minimumVersion || null,
        };
        if (!minimumVersion) upgradeResult.versionReason = 'minimum_version_unavailable';
        return upgradeResult;
      }
      if (response.status !== 200) {
        return { state: 'http_error', status: response.status };
      }
      var body = await response.json();
      if (!await operationIsCurrent(operation)) return superseded();
      var data = body && body.code === 1 && body.data;
      if (!data || typeof data !== 'object') throw new Error('invalid logistics response');
      if (
        requiredText(data.deploymentId, 'deploymentId') !== input.namespace.deploymentId ||
        requiredText(data.assignmentId, 'assignmentId') !== assignmentId ||
        input.namespace.assignmentId !== assignmentId
      ) {
        throw new Error('logistics response scope mismatch');
      }
      assertResponseScope(data, input.namespace, assignmentId);
      var etag = requiredText(response.headers.get('etag'), 'ETag');
      var receiptIdempotencyKey = requiredText(randomId(), 'receipt idempotency key');
      if (receiptIdempotencyKey.length < 16 || receiptIdempotencyKey.length > 200) {
        throw new Error('receipt idempotency key length is invalid');
      }
      var envelope = {
        schemaVersion: 'ozon-logistics/delivery-v1',
        deploymentId: data.deploymentId,
        assignmentId: data.assignmentId,
        releaseId: data.releaseId,
        releaseSequence: data.releaseSequence,
        contentChecksum: data.contentChecksum,
        effectiveChecksum: data.effectiveChecksum,
        minExtensionVersion: data.minExtensionVersion,
        validUntil: data.validUntil,
        staleUntil: data.staleUntil,
        payload: data.bundle,
      };
      if (!await operationIsCurrent(operation)) return superseded();
      var result = await store.stageAndActivate({
        namespace: input.namespace,
        bundle: envelope,
        etag: etag,
        serverTime: data.serverTime,
        authorizationValidUntil: data.authorizationValidUntil,
        receiptIdempotencyKey: receiptIdempotencyKey,
      });
      return {
        state: result && result.state || 'active',
        releaseId: data.releaseId,
        releaseSequence: data.releaseSequence,
      };
    }

    async function flushPendingReceipt(input) {
      if (
        typeof store.readPendingReceipt !== 'function' ||
        typeof store.markReceiptReported !== 'function'
      ) {
        throw new Error('receipt-capable distribution store is required');
      }
      var operation = await beginCredentialOperation();
      var proposedAppliedAt = now().toISOString();
      var pending = typeof store.preparePendingReceipt === 'function'
        ? await store.preparePendingReceipt(input && input.namespace, { appliedAt: proposedAppliedAt })
        : await store.readPendingReceipt(input && input.namespace);
      if (!await operationIsCurrent(operation)) return superseded();
      if (!pending) return { state: 'no_pending' };
      var baseUrl = normalizeBaseUrl(input && input.baseUrl);
      var assignmentId = requiredText(input && input.assignmentId, 'assignmentId');
      var extensionVersion = requiredText(input && input.extensionVersion, 'extensionVersion');
      var releaseId = requiredText(pending.releaseId, 'pending releaseId');
      var accessToken = operation.accessToken;
      var appliedAt = requiredText(pending.appliedAt || proposedAppliedAt, 'pending appliedAt');
      if (!Number.isFinite(Date.parse(appliedAt))) throw new TypeError('pending appliedAt is invalid');
      var url = baseUrl
        + '/api/logistics-rules/assignments/'
        + encodeURIComponent(assignmentId)
        + '/releases/'
        + encodeURIComponent(releaseId)
        + '/receipts';
      var response;
      try {
        response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + accessToken,
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({
          idempotencyKey: requiredText(pending.idempotencyKey, 'pending idempotencyKey'),
          effectiveChecksum: requiredText(
            pending.effectiveChecksum,
            'pending effectiveChecksum',
          ),
          status: 'applied',
          extensionVersion: extensionVersion,
          appliedAt: appliedAt,
        }),
        });
      } catch (_error) {
        if (!await operationIsCurrent(operation)) return superseded();
        return { state: 'retryable', reason: 'network' };
      }
      if (!await operationIsCurrent(operation)) return superseded();
      if (response.status === 401 || response.status === 403 || response.status === 410) {
        return revokeScopedAuthorization(response, input.namespace, assignmentId, operation);
      }
      if (response.status !== 200 && response.status !== 201) {
        return { state: 'retryable', status: response.status };
      }
      var body = await response.json();
      var receiptId = requiredText(
        body && body.code === 1 && body.data && body.data.receiptId,
        'receiptId',
      );
      if (!await operationIsCurrent(operation)) return superseded();
      await store.markReceiptReported(input.namespace, {
        idempotencyKey: pending.idempotencyKey,
        receiptId: receiptId,
        reportedAt: now().toISOString(),
      });
      return {
        state: 'reported',
        receiptId: receiptId,
        duplicate: Boolean(body.data.duplicate),
      };
    }

    return { discover: discover, refresh: refresh, flushPendingReceipt: flushPendingReceipt };
  }

  global.SS_ERP_LOGISTICS_DISTRIBUTION_CLIENT = {
    createClient: createClient,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
