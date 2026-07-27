(function exposeByokReadinessClient(global) {
  'use strict';

  var REQUEST_VERSION = 'extension-byok-readiness-request/v2';
  var READINESS_PATH = '/api/extension-device/byok-media/readiness';
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var SHARED_DETAIL_ROLES = ['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'];

  function clientError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, maximum) {
    if (typeof value !== 'string') throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    return normalized;
  }

  function nullableText(value) {
    return value == null ? null : text(value, 200);
  }

  function nullableSkuKey(value) {
    return value == null ? null : text(value, 500);
  }

  function nullablePositiveInteger(value) {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    return value;
  }

  function nullableAssignmentOrdinal(value) {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    return value;
  }

  function isSupportedSlotKey(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function requestInput(value) {
    if (!isRecord(value)) throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    var allowedKeys = [
      'profileId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'operation',
      'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
      'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal',
    ];
    if (Object.keys(value).some(function (key) { return !allowedKeys.includes(key); })) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    var operation = text(value.operation, 64);
    if (!OPERATIONS.includes(operation)) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    var workflowId = nullableText(value.workflowId);
    var draftRevision = nullablePositiveInteger(value.draftRevision);
    var draftVersion = nullablePositiveInteger(value.draftVersion);
    var sourcePlatform = value.sourcePlatform == null ? null : text(value.sourcePlatform, 16);
    var sourceProductId = nullableText(value.sourceProductId);
    var sourceCaptureSnapshotId = nullableText(value.sourceCaptureSnapshotId);
    var supplyGoodsId = nullableText(value.supplyGoodsId);
    var skuKey = nullableSkuKey(value.skuKey);
    var slotKey = nullableText(value.slotKey);
    var assignmentMode = value.assignmentMode == null ? null : text(value.assignmentMode, 16);
    var assignmentOrdinal = nullableAssignmentOrdinal(value.assignmentOrdinal);
    var draftContext = [
      workflowId, draftRevision, draftVersion, sourcePlatform, sourceProductId,
      sourceCaptureSnapshotId, supplyGoodsId, skuKey, slotKey, assignmentMode,
      assignmentOrdinal,
    ];
    if (draftContext.some(function (item) { return item === null; })
      && draftContext.some(function (item) { return item !== null; })) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    if (workflowId !== null && (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)
      || assignmentMode !== 'APPEND'
      || !isSupportedSlotKey(skuKey, slotKey))) {
      throw clientError('SS_ERP_BYOK_READINESS_REQUEST_INVALID');
    }
    return {
      profileId: text(value.profileId, 128),
      shopId: text(value.shopId, 200),
      workflowId: workflowId,
      draftRevision: draftRevision,
      draftVersion: draftVersion,
      sourcePlatform: sourcePlatform,
      sourceProductId: sourceProductId,
      sourceCaptureSnapshotId: sourceCaptureSnapshotId,
      supplyGoodsId: supplyGoodsId,
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: assignmentMode,
      assignmentOrdinal: assignmentOrdinal,
      operation: operation,
    };
  }

  function createClient(options) {
    var transport = options && options.transport;
    var profileStore = options && options.profileStore;
    var handleCache = options && options.handleCache;
    var profileSchema = options && options.profileSchema || global.SS_ERP_BYOK_PROFILE_SCHEMA;
    if (!transport || typeof transport.post !== 'function'
      || !profileStore || typeof profileStore.getProfile !== 'function'
      || !handleCache || typeof handleCache.issue !== 'function'
      || !profileSchema || typeof profileSchema.canonicalizeEndpoint !== 'function') {
      throw clientError('SS_ERP_BYOK_READINESS_DEPENDENCY_UNAVAILABLE');
    }

    return Object.freeze({
      async getReadiness(value) {
        var input = requestInput(value);
        var profile = await profileStore.getProfile(input.profileId);
        if (!profile || !Array.isArray(profile.allowedOperations)
          || !profile.allowedOperations.includes(input.operation)) {
          throw clientError('SS_ERP_BYOK_READINESS_PROFILE_UNAVAILABLE');
        }
        var endpoint = profileSchema.canonicalizeEndpoint(profile.baseUrl);
        var providerOrigin = new URL(endpoint).origin;
        var response = await transport.post(READINESS_PATH, {
          contractVersion: REQUEST_VERSION,
          shopId: input.shopId,
          workflowId: input.workflowId,
          draftRevision: input.draftRevision,
          draftVersion: input.draftVersion,
          sourcePlatform: input.sourcePlatform,
          sourceProductId: input.sourceProductId,
          sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
          supplyGoodsId: input.supplyGoodsId,
          skuKey: input.skuKey,
          slotKey: input.slotKey,
          assignmentMode: input.assignmentMode,
          assignmentOrdinal: input.assignmentOrdinal,
          providerOrigin: providerOrigin,
          model: text(profile.model, 200),
          operation: input.operation,
        }, { requiredScope: 'byok:media:ingest' });
        if (!response || response.state !== 'response' || response.status !== 200
          || !isRecord(response.body) || response.body.code !== 1 || !isRecord(response.body.data)) {
          if (response && ['unpaired', 'authorization_required'].includes(response.state)
            && typeof handleCache.clear === 'function') {
            handleCache.clear();
          }
          var error = clientError('SS_ERP_BYOK_READINESS_UNAVAILABLE');
          error.state = response && response.state || 'invalid_response';
          error.status = response && response.status || null;
          error.errorCode = response && response.body && response.body.errorCode || null;
          throw error;
        }
        return handleCache.issue(response.body.data);
      },
    });
  }

  global.SS_ERP_BYOK_READINESS_CLIENT = Object.freeze({
    REQUEST_VERSION: REQUEST_VERSION,
    READINESS_PATH: READINESS_PATH,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
