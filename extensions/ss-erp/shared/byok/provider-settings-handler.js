(function exposeByokProviderSettingsHandler(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-provider-settings-handler/v1';
  var PUBLIC_READINESS_REASON_CODES = new Set([
    'POLICY_DISABLED',
    'OWNER_NOT_ALLOWED',
    'SHOP_NOT_ALLOWED',
    'DEVICE_NOT_ALLOWED',
    'ORIGIN_NOT_ALLOWED',
    'OPERATION_NOT_ALLOWED',
    'GENERATION_DISABLED',
  ]);
  var PUBLIC_READINESS_ERROR_CODES = new Set([
    'byok_readiness_request_invalid',
    'byok_readiness_scope_denied',
    'byok_readiness_shop_denied',
    'byok_readiness_draft_stale',
    'byok_readiness_target_stale',
    'byok_readiness_not_ready',
    'byok_readiness_unavailable',
  ]);
  var PUBLIC_READINESS_STATES = new Set([
    'response',
    'unpaired',
    'authorization_required',
    'invalid_response',
  ]);
  var CAPABILITY_PROMPT = 'A neutral catalog product test image on a plain white background. No text.';
  var REQUEST_MODE_BY_OPERATION = Object.freeze({
    TEXT_TO_IMAGE: 'json',
    IMAGE_TO_IMAGE: 'multipart',
    FULL_EDIT: 'multipart',
    INPAINT: 'multipart',
  });
  var MAX_PERMISSION_FINALIZATIONS = 64;
  var DEVICE_STATES = [
    'paired',
    'unpaired',
    'invalid',
    'unreachable',
    'authorization_required',
    'unconfigured',
  ];
  var READINESS_BINDING_KEYS = [
    'contractVersion',
    'ownerUserId',
    'deviceSessionId',
    'shopId',
    'workflowId',
    'draftRevision',
    'draftVersion',
    'sourcePlatform',
    'sourceProductId',
    'sourceCaptureSnapshotId',
    'supplyGoodsId',
    'skuKey',
    'slotKey',
    'assignmentMode',
    'assignmentOrdinal',
    'providerOrigin',
    'model',
    'operation',
    'policyRevision',
  ];

  function handlerError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function assertRecord(value, allowedKeys, requiredKeys) {
    if (!isRecord(value)
      || Object.keys(value).some(function (key) { return !allowedKeys.includes(key); })
      || requiredKeys.some(function (key) {
        return !Object.prototype.hasOwnProperty.call(value, key);
      })) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return value;
  }

  function text(value, maximum) {
    if (typeof value !== 'string') {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return normalized;
  }

  function profileId(value) {
    var normalized = text(value, 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(normalized)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return normalized;
  }

  function operation(value, schema) {
    var normalized = text(value, 64);
    if (!schema.OPERATIONS.includes(normalized)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return normalized;
  }

  function nullableText(value, maximum) {
    return value == null ? null : text(value, maximum);
  }

  function nullablePositiveInteger(value) {
    if (value == null) return null;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return value;
  }

  function optionalMoneyUsd(value) {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)
      || value <= 0 || value > 1000) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    var normalized = Math.round(value * 1000000) / 1000000;
    if (normalized !== value) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return normalized;
  }

  function isoDate(value, nullable) {
    if (nullable && (value == null || value === '')) return null;
    var parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
    return parsed.toISOString();
  }

  function expectedProviderOrigin(profile, schema) {
    return new URL(schema.canonicalizeEndpoint(profile.baseUrl)).origin;
  }

  function projectProfile(value, schema) {
    if (!isRecord(value)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
    try {
      return schema.publicProfile({
        id: value.id,
        name: value.name,
        baseUrl: value.baseUrl,
        model: value.model,
        allowedOperations: value.allowedOperations,
        preferences: value.preferences,
      });
    } catch (_error) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
  }

  function projectEvidence(value, schema) {
    if (!isRecord(value)) return null;
    var evidenceOperation;
    var requestMode;
    try {
      evidenceOperation = operation(value.operation, schema);
      requestMode = text(value.requestMode, 64);
      if (!schema.REQUEST_MODES.includes(requestMode)) return null;
      return {
        contractVersion: text(value.contractVersion, 100),
        operation: evidenceOperation,
        requestMode: requestMode,
        policyRevision: text(value.policyRevision, 200),
        verifiedAt: isoDate(value.verifiedAt, false),
        expiresAt: isoDate(value.expiresAt, false),
      };
    } catch (_error) {
      return null;
    }
  }

  function projectPublicState(value, schema) {
    var source = isRecord(value) ? value : {};
    var evidence = [];
    if (Array.isArray(source.evidence)) {
      source.evidence.forEach(function (candidate) {
        var projected = projectEvidence(candidate, schema);
        if (projected) evidence.push(projected);
      });
    }
    return {
      profile: source.profile ? projectProfile(source.profile, schema) : null,
      hasKey: Boolean(source.hasKey),
      evidence: Boolean(source.hasKey) ? evidence : [],
    };
  }

  function projectDevice(value) {
    var source = isRecord(value) ? value : {};
    var state = DEVICE_STATES.includes(source.state) ? source.state : 'unconfigured';
    var scopes = [];
    var seen = Object.create(null);
    (Array.isArray(source.scopes) ? source.scopes : []).slice(0, 64).forEach(function (candidate) {
      try {
        var scope = text(candidate, 100);
        if (!seen[scope]) {
          seen[scope] = true;
          scopes.push(scope);
        }
      } catch (_error) {
        // Ignore malformed public status rows rather than forwarding them.
      }
    });
    return {
      state: state,
      scopes: scopes,
      expiresAt: isoDate(source.expiresAt, true),
    };
  }

  function shopRows(value) {
    if (Array.isArray(value)) return value;
    if (isRecord(value) && value.ok === true && Array.isArray(value.data)) return value.data;
    throw handlerError('SS_ERP_BYOK_PROVIDER_SHOPS_UNAVAILABLE');
  }

  function projectShops(value) {
    var result = [];
    var seen = Object.create(null);
    shopRows(value).slice(0, 100).forEach(function (candidate) {
      if (!isRecord(candidate)) return;
      if (candidate.platform != null && String(candidate.platform).toUpperCase() !== 'OZON') return;
      try {
        var id = text(candidate.id, 200);
        if (seen[id]) return;
        seen[id] = true;
        result.push({
          id: id,
          name: text(candidate.name, 200),
          status: text(candidate.status, 64),
        });
      } catch (_error) {
        // A malformed shop is not a selectable authorization target.
      }
    });
    return result;
  }

  function projectReadinessBinding(value, schema) {
    if (!isRecord(value)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
    var result = {};
    READINESS_BINDING_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
    });
    result.contractVersion = text(value.contractVersion, 100);
    result.ownerUserId = text(value.ownerUserId, 200);
    result.deviceSessionId = text(value.deviceSessionId, 200);
    result.shopId = nullableText(value.shopId, 200);
    result.workflowId = nullableText(value.workflowId, 200);
    result.draftRevision = nullablePositiveInteger(value.draftRevision);
    result.draftVersion = nullablePositiveInteger(value.draftVersion);
    [
      'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
      'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal',
    ].forEach(function (key) {
      if (value[key] !== null) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      result[key] = null;
    });
    result.providerOrigin = text(value.providerOrigin, 300);
    result.model = text(value.model, 200);
    result.operation = operation(value.operation, schema);
    result.policyRevision = text(value.policyRevision, 200);
    return result;
  }

  function projectReadiness(value, schema) {
    if (!isRecord(value)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
    return {
      readinessHandle: text(value.readinessHandle, 4096),
      readinessBinding: projectReadinessBinding(value.readinessBinding, schema),
      expiresAt: isoDate(value.expiresAt, false),
    };
  }

  function projectProbe(value, expected, schema) {
    if (!isRecord(value)) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
    var evidence = isRecord(value.evidence) ? value.evidence : value;
    var result = {
      contractVersion: text(value.contractVersion, 100),
      profileId: profileId(value.profileId),
      operation: operation(value.operation, schema),
      requestMode: text(value.requestMode, 64),
      policyRevision: text(value.policyRevision, 200),
      verifiedAt: isoDate(evidence.verifiedAt, false),
      expiresAt: isoDate(evidence.expiresAt, false),
    };
    if (result.profileId !== expected.profileId
      || result.operation !== expected.operation
      || result.requestMode !== expected.requestMode
      || result.policyRevision !== expected.policyRevision) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
    }
    if (expected.quotedCostUsd !== null || expected.maximumCostUsd !== null) {
      if (expected.quotedCostUsd === null || expected.maximumCostUsd === null
        || expected.quotedCostUsd > expected.maximumCostUsd) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      result.costControl = {
        currency: 'USD',
        quotedCostUsd: expected.quotedCostUsd,
        maximumCostUsd: expected.maximumCostUsd,
      };
    }
    return result;
  }

  function safeFailure(error) {
    var candidate = error && typeof error === 'object' ? String(error.code || '') : '';
    var reasonCode = error && typeof error === 'object' ? error.reasonCode : null;
    var readinessErrorCode = error && typeof error === 'object' ? error.errorCode : null;
    var readinessState = error && typeof error === 'object' ? error.state : null;
    var readinessStatus = Number(error && typeof error === 'object' ? error.status : NaN);
    var failure = {
      ok: false,
      errorCode: /^[A-Z][A-Z0-9_]{0,99}$/u.test(candidate)
        ? candidate
        : 'SS_ERP_BYOK_PROVIDER_SETTINGS_OPERATION_FAILED',
      error: 'BYOK Provider settings operation failed',
    };
    if (PUBLIC_READINESS_REASON_CODES.has(reasonCode)) failure.reasonCode = reasonCode;
    if (PUBLIC_READINESS_ERROR_CODES.has(readinessErrorCode)) {
      failure.readinessErrorCode = readinessErrorCode;
    }
    if (PUBLIC_READINESS_STATES.has(readinessState)) failure.readinessState = readinessState;
    if (Number.isSafeInteger(readinessStatus) && readinessStatus >= 100 && readinessStatus <= 599) {
      failure.readinessStatus = readinessStatus;
    }
    return failure;
  }

  function success(data) {
    return { ok: true, data: data };
  }

  function guarded(operationHandler) {
    return async function guardedHandler(context) {
      try {
        return success(await operationHandler(context || {}));
      } catch (error) {
        return safeFailure(error);
      }
    };
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_DEPENDENCY_UNAVAILABLE');
    }
    return value[name].bind(value);
  }

  function requiredFunction(value) {
    if (typeof value !== 'function') {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_DEPENDENCY_UNAVAILABLE');
    }
    return value;
  }

  function payload(context, allowedKeys, requiredKeys) {
    return assertRecord(context && context.payload || {}, allowedKeys, requiredKeys);
  }

  function createDispatcher(options) {
    var config = options || {};
    var messageTypes = config.messageTypes;
    var schema = config.profileSchema || global.SS_ERP_BYOK_PROFILE_SCHEMA;
    if (!isRecord(messageTypes) || !schema
      || !Array.isArray(schema.OPERATIONS) || !Array.isArray(schema.REQUEST_MODES)
      || typeof schema.publicProfile !== 'function'
      || typeof schema.canonicalizeEndpoint !== 'function') {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_DEPENDENCY_UNAVAILABLE');
    }
    var typeNames = [
      'GET_SETUP_CONTEXT',
      'LIST_PROFILES',
      'GET_PROFILE_STATE',
      'SAVE_PROFILE',
      'REMOVE_PROFILE',
      'SET_SESSION_KEY',
      'CLEAR_SESSION_KEY',
      'PERMISSION_STATUS',
      'PREPARE_PERMISSION',
      'REQUEST_PERMISSION',
      'REVOKE_PERMISSION',
      'TEST_CAPABILITY',
      'GET_READINESS',
    ];
    var typeValues = typeNames.map(function (name) { return text(messageTypes[name], 200); });
    if (new Set(typeValues).size !== typeValues.length) {
      throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_DEPENDENCY_UNAVAILABLE');
    }

    var profileStore = config.profileStore;
    var listProfiles = profileStore && typeof profileStore.listPublicProfiles === 'function'
      ? profileStore.listPublicProfiles.bind(profileStore)
      : requiredMethod(profileStore, 'listProfiles');
    var getProfile = requiredMethod(profileStore, 'getProfile');
    var getPublicState = requiredMethod(profileStore, 'getPublicState');
    var saveProfile = requiredMethod(profileStore, 'saveProfile');
    var deleteProfile = requiredMethod(profileStore, 'deleteProfile');
    var setApiKey = requiredMethod(profileStore, 'setApiKey');
    var clearApiKey = requiredMethod(profileStore, 'clearApiKey');
    var permissionBroker = config.permissionBroker;
    var containsOrigin = requiredMethod(permissionBroker, 'containsOrigin');
    var hasOriginPermission = requiredMethod(permissionBroker, 'hasOriginPermission');
    var captureConsentEpoch = requiredMethod(permissionBroker, 'captureConsentEpoch');
    var finalizeOriginConsent = requiredMethod(permissionBroker, 'finalizeOriginConsent');
    var removeOriginPermission = requiredMethod(permissionBroker, 'removeOriginPermission');
    var getReadiness = requiredMethod(config.readinessClient, 'getReadiness');
    var probe = requiredMethod(config.capabilityClient, 'probe');
    var preparePermissionReadiness = requiredFunction(config.preparePermissionReadiness);
    var readDeviceStatus = requiredFunction(config.readDeviceStatus);
    var listShops = requiredFunction(config.listShops);
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    var permissionFinalizations = new Map();

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      return value;
    }

    function prunePermissionFinalizations(current) {
      permissionFinalizations.forEach(function (entry, ticket) {
        if (!entry || entry.expiresAtMillis <= current) permissionFinalizations.delete(ticket);
      });
      while (permissionFinalizations.size >= MAX_PERMISSION_FINALIZATIONS) {
        permissionFinalizations.delete(permissionFinalizations.keys().next().value);
      }
    }

    async function loadProfile(id) {
      var selected = await getProfile(id);
      if (!selected) throw handlerError('SS_ERP_BYOK_PROFILE_NOT_FOUND');
      return projectProfile(selected, schema);
    }

    async function revokeUnusedOrigin(selected, excludedProfileId) {
      var origin = expectedProviderOrigin(selected, schema);
      var profiles = await listProfiles();
      if (!Array.isArray(profiles)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      var stillReferenced = profiles.some(function (candidate) {
        var projected = projectProfile(candidate, schema);
        return projected.id !== excludedProfileId
          && expectedProviderOrigin(projected, schema) === origin;
      });
      if (stillReferenced) return false;
      var status = await removeOriginPermission(selected.baseUrl);
      if (!isRecord(status) || status.origin !== origin) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      if (status.removed !== true) {
        var remaining = await hasOriginPermission(selected.baseUrl);
        if (!isRecord(remaining) || remaining.origin !== origin) {
          throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
        }
        if (remaining.granted === true) {
          throw handlerError('SS_ERP_BYOK_PERMISSION_REVOKE_FAILED');
        }
      }
      return Boolean(status.removed);
    }

    var handlers = {};

    handlers[messageTypes.GET_SETUP_CONTEXT] = guarded(async function (context) {
      payload(context, [], []);
      var device = projectDevice(await readDeviceStatus());
      var shops = [];
      var shopsState = device.state === 'paired' ? 'available' : 'not_paired';
      if (device.state === 'paired') {
        try {
          shops = projectShops(await listShops());
        } catch (_error) {
          shopsState = 'unavailable';
        }
      }
      return { device: device, shops: shops, shopsState: shopsState };
    });

    handlers[messageTypes.LIST_PROFILES] = guarded(async function (context) {
      payload(context, [], []);
      var profiles = await listProfiles();
      if (!Array.isArray(profiles)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      return {
        profiles: profiles.map(function (candidate) { return projectProfile(candidate, schema); }),
      };
    });

    handlers[messageTypes.GET_PROFILE_STATE] = guarded(async function (context) {
      var input = payload(context, ['profileId'], ['profileId']);
      return projectPublicState(await getPublicState(profileId(input.profileId)), schema);
    });

    handlers[messageTypes.SAVE_PROFILE] = guarded(async function (context) {
      var input = payload(context, ['profile'], ['profile']);
      var selected = projectProfile(input.profile, schema);
      var previous = await getProfile(selected.id);
      if (previous) {
        var previousProfile = projectProfile(previous, schema);
        if (expectedProviderOrigin(previousProfile, schema)
          !== expectedProviderOrigin(selected, schema)) {
          await revokeUnusedOrigin(previousProfile, selected.id);
        }
      }
      var saved = await saveProfile(selected);
      var state = projectPublicState(await getPublicState(selected.id), schema);
      state.rebound = Boolean(saved && saved.rebound);
      return state;
    });

    handlers[messageTypes.REMOVE_PROFILE] = guarded(async function (context) {
      var input = payload(context, ['profileId'], ['profileId']);
      var id = profileId(input.profileId);
      var selected = await loadProfile(id);
      await revokeUnusedOrigin(selected, id);
      var result = await deleteProfile(id);
      return { profileId: id, deleted: Boolean(result && result.deleted) };
    });

    handlers[messageTypes.SET_SESSION_KEY] = guarded(async function (context) {
      if (!context || typeof context.readSecretPayload !== 'function') {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
      }
      var secretPayload = context.readSecretPayload();
      assertRecord(secretPayload, ['profileId', 'apiKey'], ['profileId', 'apiKey']);
      var id = profileId(secretPayload.profileId);
      var apiKey = secretPayload.apiKey;
      if (typeof apiKey !== 'string' || !apiKey || apiKey.length > schema.MAX_API_KEY_LENGTH) {
        throw handlerError('SS_ERP_BYOK_API_KEY_INVALID');
      }
      try {
        await setApiKey(id, apiKey);
      } finally {
        apiKey = null;
        secretPayload = null;
      }
      return projectPublicState(await getPublicState(id), schema);
    });

    handlers[messageTypes.CLEAR_SESSION_KEY] = guarded(async function (context) {
      var input = payload(context, ['profileId'], ['profileId']);
      var id = profileId(input.profileId);
      await clearApiKey(id);
      return projectPublicState(await getPublicState(id), schema);
    });

    handlers[messageTypes.PERMISSION_STATUS] = guarded(async function (context) {
      var input = payload(context, ['profileId'], ['profileId']);
      var id = profileId(input.profileId);
      var selected = await loadProfile(id);
      var expectedOrigin = expectedProviderOrigin(selected, schema);
      var status = await hasOriginPermission(selected.baseUrl);
      if (!isRecord(status) || status.origin !== expectedOrigin) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      return { profileId: id, origin: expectedOrigin, granted: Boolean(status.granted) };
    });

    handlers[messageTypes.PREPARE_PERMISSION] = guarded(async function (context) {
      var input = payload(context, ['profileId', 'operation'], ['profileId', 'operation']);
      var id = profileId(input.profileId);
      var requestedOperation = operation(input.operation, schema);
      var selected = await loadProfile(id);
      var verification = context && context.authorization && context.authorization.readiness;
      var binding = verification && verification.binding;
      if (!isRecord(verification) || !isRecord(binding)
        || binding.operation !== requestedOperation
        || binding.model !== selected.model
        || binding.providerOrigin !== expectedProviderOrigin(selected, schema)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH');
      }
      var prepared = projectReadiness(await preparePermissionReadiness({
        handleId: verification.handleId,
        expiresAt: verification.expiresAt,
        binding: binding,
      }), schema);
      var current = currentMillis();
      var expiresAtMillis = Date.parse(prepared.expiresAt);
      if (!Number.isFinite(expiresAtMillis) || expiresAtMillis <= current) {
        throw handlerError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
      }
      prunePermissionFinalizations(current);
      permissionFinalizations.set(prepared.readinessHandle, {
        profileId: id,
        shopId: binding.shopId,
        operation: requestedOperation,
        providerOrigin: binding.providerOrigin,
        model: binding.model,
        ownerUserId: binding.ownerUserId,
        deviceSessionId: binding.deviceSessionId,
        expiresAtMillis: expiresAtMillis,
        consentEpoch: await captureConsentEpoch(),
      });
      return prepared;
    });

    // permissions.request must execute in the extension page's real click task.
    // This background handler only finalizes app-owned consent after rechecking
    // the one-use ticket, live ERP readiness, and Chrome's exact-origin grant.
    handlers[messageTypes.REQUEST_PERMISSION] = guarded(async function (context) {
      var input = payload(context, [
        'profileId', 'shopId', 'operation', 'permissionTicket',
      ], [
        'profileId', 'shopId', 'operation', 'permissionTicket',
      ]);
      var id = profileId(input.profileId);
      var shopId = text(input.shopId, 200);
      var requestedOperation = operation(input.operation, schema);
      var ticketId = text(input.permissionTicket, 128);
      var current = currentMillis();
      prunePermissionFinalizations(current);
      var ticket = permissionFinalizations.get(ticketId);
      permissionFinalizations.delete(ticketId);
      if (!ticket || ticket.expiresAtMillis <= current
        || ticket.profileId !== id || ticket.shopId !== shopId
        || ticket.operation !== requestedOperation) {
        throw handlerError('SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE');
      }
      var selected = await loadProfile(id);
      var expectedOrigin = expectedProviderOrigin(selected, schema);
      if (ticket.providerOrigin !== expectedOrigin || ticket.model !== selected.model) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH');
      }
      var live = projectReadiness(await getReadiness({
        profileId: id,
        shopId: shopId,
        workflowId: null,
        draftRevision: null,
        draftVersion: null,
        operation: requestedOperation,
      }), schema);
      var binding = live.readinessBinding;
      if (binding.ownerUserId !== ticket.ownerUserId
        || binding.deviceSessionId !== ticket.deviceSessionId
        || binding.shopId !== shopId
        || binding.providerOrigin !== expectedOrigin
        || binding.model !== selected.model
        || binding.operation !== requestedOperation) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH');
      }
      var chromePermission = await containsOrigin(selected.baseUrl);
      if (!isRecord(chromePermission) || chromePermission.origin !== expectedOrigin
        || chromePermission.granted !== true) {
        throw handlerError('SS_ERP_BYOK_PERMISSION_REQUIRED');
      }
      var finalized = await finalizeOriginConsent(selected.baseUrl, ticket.consentEpoch);
      if (!isRecord(finalized) || finalized.origin !== expectedOrigin
        || finalized.granted !== true) {
        throw handlerError('SS_ERP_BYOK_PERMISSION_REQUIRED');
      }
      return { profileId: id, origin: expectedOrigin, granted: true };
    });

    handlers[messageTypes.REVOKE_PERMISSION] = guarded(async function (context) {
      var input = payload(context, ['profileId'], ['profileId']);
      var id = profileId(input.profileId);
      var selected = await loadProfile(id);
      var expectedOrigin = expectedProviderOrigin(selected, schema);
      var status = await removeOriginPermission(selected.baseUrl);
      if (!isRecord(status) || status.origin !== expectedOrigin) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_OUTPUT_INVALID');
      }
      return { profileId: id, origin: expectedOrigin, removed: Boolean(status.removed) };
    });

    handlers[messageTypes.TEST_CAPABILITY] = guarded(async function (context) {
      var input = payload(
        context,
        [
          'profileId', 'operation', 'idempotencyKey', 'prompt',
          'quotedCostUsd', 'maximumCostUsd',
        ],
        ['profileId', 'operation', 'idempotencyKey'],
      );
      var id = profileId(input.profileId);
      var requestedOperation = operation(input.operation, schema);
      var idempotencyKey = profileId(input.idempotencyKey);
      var prompt = input.prompt == null ? null : text(input.prompt, 8000);
      var quotedCostUsd = optionalMoneyUsd(input.quotedCostUsd);
      var maximumCostUsd = optionalMoneyUsd(input.maximumCostUsd);
      if ((quotedCostUsd === null) !== (maximumCostUsd === null)
        || (quotedCostUsd !== null && quotedCostUsd > maximumCostUsd)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
      }
      if (requestedOperation === 'TEXT_TO_IMAGE'
        && (prompt === null || quotedCostUsd === null || maximumCostUsd === null)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_COST_CONTROL_REQUIRED');
      }
      var binding = context && context.authorization && context.authorization.readiness
        && context.authorization.readiness.binding;
      var selected = await loadProfile(id);
      if (!isRecord(binding)
        || binding.operation !== requestedOperation
        || binding.model !== selected.model
        || binding.providerOrigin !== expectedProviderOrigin(selected, schema)) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_READINESS_MISMATCH');
      }
      var result = await probe({
        profileId: id,
        operation: requestedOperation,
        prompt: prompt || CAPABILITY_PROMPT,
        negativePrompt: null,
        size: selected.preferences.defaultSize,
        idempotencyKey: idempotencyKey,
        readinessBinding: binding,
        ...(quotedCostUsd === null ? {} : { quotedCostUsd, maximumCostUsd }),
      });
      return projectProbe(result, {
        profileId: id,
        operation: requestedOperation,
        requestMode: REQUEST_MODE_BY_OPERATION[requestedOperation],
        policyRevision: binding.policyRevision,
        quotedCostUsd,
        maximumCostUsd,
      }, schema);
    });

    handlers[messageTypes.GET_READINESS] = guarded(async function (context) {
      var input = payload(context, [
        'profileId',
        'shopId',
        'workflowId',
        'draftRevision',
        'draftVersion',
        'operation',
      ], ['profileId', 'shopId', 'operation']);
      var workflowId = nullableText(input.workflowId, 200);
      var draftRevision = nullablePositiveInteger(input.draftRevision);
      var draftVersion = nullablePositiveInteger(input.draftVersion);
      if ([workflowId, draftRevision, draftVersion].some(function (item) { return item === null; })
        && [workflowId, draftRevision, draftVersion].some(function (item) { return item !== null; })) {
        throw handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
      }
      var request = {
        profileId: profileId(input.profileId),
        shopId: text(input.shopId, 200),
        workflowId: workflowId,
        draftRevision: draftRevision,
        draftVersion: draftVersion,
        operation: operation(input.operation, schema),
      };
      return projectReadiness(await getReadiness(request), schema);
    });

    Object.freeze(handlers);

    async function dispatchAuthorized(messageType, context) {
      var selected = Object.prototype.hasOwnProperty.call(handlers, messageType)
        ? handlers[messageType]
        : null;
      if (!selected) {
        return safeFailure(handlerError('SS_ERP_BYOK_PROVIDER_SETTINGS_HANDLER_UNAVAILABLE'));
      }
      return selected(context);
    }

    return Object.freeze({
      handlers: handlers,
      dispatchAuthorized: dispatchAuthorized,
    });
  }

  global.SS_ERP_BYOK_PROVIDER_SETTINGS_HANDLER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    GET_SETUP_CONTEXT_MESSAGE_TYPE: 'ss-erp:byok-provider-setup-context',
    createDispatcher: createDispatcher,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
