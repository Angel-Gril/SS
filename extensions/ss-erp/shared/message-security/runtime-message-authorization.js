(function (root) {
  'use strict';

  var legacyPolicy = root.SS_ERP_RUNTIME_MESSAGE_POLICY;
  if (!legacyPolicy
    || typeof legacyPolicy.isKnownRuntimeMessageType !== 'function'
    || typeof legacyPolicy.isAllowedRuntimeMessageSender !== 'function') {
    throw new Error('SS_ERP_RUNTIME_MESSAGE_POLICY is required');
  }

  var CONTRACT_VERSION = 'extension-runtime-message-authorization/v1';
  var READINESS_BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var READINESS_VERIFICATION_VERSION = 'extension-byok-readiness-verification/v2';
  var MAX_ID_LENGTH = 200;
  var MAX_HANDLE_LENGTH = 4096;
  var MAX_STRING_LENGTH = 65536;
  var MAX_DEPTH = 12;
  var MAX_NODES = 4096;
  var MAX_READINESS_TTL_MS = 10 * 60 * 1000;
  var SHARED_DETAIL_ROLES = Object.freeze(['SCENE', 'DETAIL', 'SPEC', 'PACKAGING']);

  var SENDER_SURFACES = Object.freeze({
    WORKBENCH: 'ai_image_workbench',
    PROVIDER_SETTINGS: 'ai_provider_settings',
  });

  var MESSAGE_TYPES = Object.freeze({
    PROVIDER_SETTINGS: Object.freeze({
      GET_SETUP_CONTEXT: 'ss-erp:byok-provider-setup-context',
      LIST_PROFILES: 'ss-erp:byok-provider-profiles-list',
      GET_PROFILE_STATE: 'ss-erp:byok-provider-profile-state',
      SAVE_PROFILE: 'ss-erp:byok-provider-profile-save',
      REMOVE_PROFILE: 'ss-erp:byok-provider-profile-remove',
      SET_SESSION_KEY: 'ss-erp:byok-provider-session-key-set',
      CLEAR_SESSION_KEY: 'ss-erp:byok-provider-session-key-clear',
      PERMISSION_STATUS: 'ss-erp:byok-provider-permission-status',
      PREPARE_PERMISSION: 'ss-erp:byok-provider-permission-prepare',
      REQUEST_PERMISSION: 'ss-erp:byok-provider-permission-request',
      REVOKE_PERMISSION: 'ss-erp:byok-provider-permission-revoke',
      TEST_CAPABILITY: 'ss-erp:byok-provider-capability-test',
      GET_READINESS: 'ss-erp:byok-provider-readiness',
    }),
    WORKBENCH: Object.freeze({
      GET_PUBLIC_STATE: 'ss-erp:ai-image-workbench-state',
      GET_READINESS: 'ss-erp:ai-image-workbench-readiness',
      EXECUTE_PROVIDER: 'ss-erp:ai-image-workbench-provider-execute',
      RECOVER_PROVIDER: 'ss-erp:ai-image-workbench-provider-recover',
      OPEN_PREVIEW: 'ss-erp:ai-image-workbench-preview-open',
      SOURCE_CATALOG: 'ss-erp:ai-image-workbench-source-catalog',
      SOURCE_PREVIEW: 'ss-erp:ai-image-workbench-source-preview',
      REVIEW_RESULT: 'ss-erp:ai-image-workbench-result-review',
      INGEST: 'ss-erp:ai-image-workbench-ingest',
      RECOVER_INGEST: 'ss-erp:ai-image-workbench-ingest-recover',
      PUBLISH: 'ss-erp:ai-image-workbench-publish',
      EDIT_MEDIA_PREPARE: 'ss-erp:ai-image-workbench-edit-media-prepare',
      EDIT_MEDIA_RELEASE: 'ss-erp:ai-image-workbench-edit-media-release',
      EDIT_STATE: 'ss-erp:ai-image-workbench-edit-state',
      EDIT_REFERENCES: 'ss-erp:ai-image-workbench-edit-references',
      EDIT_START: 'ss-erp:ai-image-workbench-edit-start',
      EDIT_SELECT: 'ss-erp:ai-image-workbench-edit-select',
      EDIT_REVIEW: 'ss-erp:ai-image-workbench-edit-review',
      EDIT_REGENERATE: 'ss-erp:ai-image-workbench-edit-regenerate',
      EDIT_PREVIEW: 'ss-erp:ai-image-workbench-edit-preview',
      EDIT_CLEANUP: 'ss-erp:ai-image-workbench-edit-cleanup',
      BATCH_STATE: 'ss-erp:ai-image-workbench-batch-state',
      BATCH_START: 'ss-erp:ai-image-workbench-batch-start',
      BATCH_COMMAND: 'ss-erp:ai-image-workbench-batch-command',
      BATCH_PREVIEW: 'ss-erp:ai-image-workbench-batch-preview',
      BATCH_INGEST: 'ss-erp:ai-image-workbench-batch-ingest',
      BATCH_RECOVER: 'ss-erp:ai-image-workbench-batch-ingest-recover',
      BATCH_CLEAR: 'ss-erp:ai-image-workbench-batch-clear',
    }),
    HOSTED_WORKBENCH: Object.freeze({
      GET_MODE_LOCK: 'SS_ERP_HOSTED_WORKBENCH_GET_MODE_LOCK',
      GET_CURRENT_PLAN: 'SS_ERP_HOSTED_WORKBENCH_GET_CURRENT_PLAN',
      CREATE_PLAN: 'SS_ERP_HOSTED_WORKBENCH_CREATE_PLAN',
      GET_PLAN: 'SS_ERP_HOSTED_WORKBENCH_GET_PLAN',
      REVIEW_PLAN: 'SS_ERP_HOSTED_WORKBENCH_REVIEW_PLAN',
      LOAD_SUITE: 'SS_ERP_HOSTED_WORKBENCH_LOAD_SUITE',
      EXECUTE_INTENT: 'SS_ERP_HOSTED_WORKBENCH_EXECUTE_INTENT',
      OPEN_PREVIEW: 'SS_ERP_HOSTED_WORKBENCH_OPEN_PREVIEW',
      ASSIGN_APPROVED_OUTPUT: 'SS_ERP_HOSTED_WORKBENCH_ASSIGN_APPROVED_OUTPUT',
      CLEAR: 'SS_ERP_HOSTED_WORKBENCH_CLEAR',
    }),
  });

  var PROVIDER_SETTINGS_TYPES = new Set(Object.keys(MESSAGE_TYPES.PROVIDER_SETTINGS)
    .map(function (key) { return MESSAGE_TYPES.PROVIDER_SETTINGS[key]; }));
  var WORKBENCH_TYPES = new Set(Object.keys(MESSAGE_TYPES.WORKBENCH)
    .map(function (key) { return MESSAGE_TYPES.WORKBENCH[key]; }));
  var HOSTED_WORKBENCH_TYPES = new Set(Object.keys(MESSAGE_TYPES.HOSTED_WORKBENCH)
    .map(function (key) { return MESSAGE_TYPES.HOSTED_WORKBENCH[key]; }));
  var NEW_TYPES = new Set([
    ...PROVIDER_SETTINGS_TYPES,
    ...WORKBENCH_TYPES,
    ...HOSTED_WORKBENCH_TYPES,
  ]);
  var SECRET_REQUEST_TYPES = new Set([
    MESSAGE_TYPES.PROVIDER_SETTINGS.SET_SESSION_KEY,
  ]);
  var READINESS_REQUIRED_TYPES = new Set([
    MESSAGE_TYPES.PROVIDER_SETTINGS.PREPARE_PERMISSION,
    MESSAGE_TYPES.PROVIDER_SETTINGS.TEST_CAPABILITY,
    MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
    MESSAGE_TYPES.WORKBENCH.RECOVER_PROVIDER,
  ]);
  var DRAFT_BOUND_TYPES = new Set([
    MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
    MESSAGE_TYPES.WORKBENCH.RECOVER_PROVIDER,
    MESSAGE_TYPES.WORKBENCH.INGEST,
    MESSAGE_TYPES.WORKBENCH.PUBLISH,
  ]);
  var PROVIDER_BOUND_TYPES = new Set([
    MESSAGE_TYPES.PROVIDER_SETTINGS.PREPARE_PERMISSION,
    MESSAGE_TYPES.PROVIDER_SETTINGS.TEST_CAPABILITY,
    MESSAGE_TYPES.WORKBENCH.EXECUTE_PROVIDER,
    MESSAGE_TYPES.WORKBENCH.RECOVER_PROVIDER,
  ]);
  var SECRET_FIELD_NAMES = new Set([
    'key',
    'sk',
    'token',
    'secret',
    'secretkey',
    'apikey',
    'authorization',
    'authheader',
    'accesstoken',
    'refreshtoken',
    'client' + 'secret',
    'privatekey',
    'password',
    'bearer',
    'credential',
    'credentials',
    'commandgrant',
    'rawbase64',
    'providerresulturl',
    'providerbody',
    'base64',
    'b64json',
    'imagedata',
    'imagebytes',
    'rawimage',
    'resulturl',
    'providerurl',
    'sourceurl',
  ]);
  var RESPONSE_URL_FIELD_NAMES = new Set([
    'url',
    'imageurl',
    'mediaurl',
    'downloadurl',
    'resulturl',
    'providerurl',
    'providerresulturl',
    'sourceurl',
  ]);

  var BINDING_KEYS = [
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

  var OPERATION_VALUES = new Set([
    'TEXT_TO_IMAGE',
    'IMAGE_TO_IMAGE',
    'FULL_EDIT',
    'INPAINT',
    'BYOK_MEDIA_INGEST',
    'OZON_PUBLISH',
  ]);
  var AI_OPERATION_VALUES = new Set([
    'TEXT_TO_IMAGE',
    'IMAGE_TO_IMAGE',
    'FULL_EDIT',
    'INPAINT',
  ]);

  function normalizedKey(value) {
    return String(value == null ? '' : value).replace(/[^a-z0-9]/giu, '').toLowerCase();
  }

  function isSecretField(value) {
    var key = normalizedKey(value);
    if (SECRET_FIELD_NAMES.has(key)) return true;
    return key.endsWith('apikey')
      || key.endsWith('authorization')
      || key.endsWith('authtoken')
      || key.endsWith('accesstoken')
      || key.endsWith('refreshtoken')
      || key.endsWith('client' + 'secret')
      || key.endsWith('privatekey')
      || key.endsWith('password')
      || key.endsWith('credential')
      || key.endsWith('credentials')
      || key.endsWith('commandgrant')
      || key.endsWith('rawbase64')
      || key.endsWith('providerresulturl')
      || key.endsWith('providerbody');
  }

  function authError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isRecord(value) {
    return Boolean(value)
      && typeof value === 'object'
      && !Array.isArray(value)
      && Object.prototype.toString.call(value) === '[object Object]';
  }

  function text(value, maximum) {
    if (typeof value !== 'string') throw authError('SS_ERP_RUNTIME_MESSAGE_INVALID');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized.length > maximum) throw authError('SS_ERP_RUNTIME_MESSAGE_INVALID');
    for (var index = 0; index < normalized.length; index += 1) {
      var codePoint = normalized.codePointAt(index);
      if (codePoint <= 0x1f || codePoint === 0x7f) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_INVALID');
      }
      if (codePoint > 0xffff) index += 1;
    }
    return normalized;
  }

  function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every(function (key) { return allowed.has(key); });
  }

  function sameAuthority(left, right) {
    return left.protocol === right.protocol
      && left.hostname === right.hostname
      && left.port === right.port;
  }

  function parseUrl(value) {
    try {
      return new URL(value);
    } catch (_error) {
      return null;
    }
  }

  function isPrivateIpv4(hostname) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
    var parts = hostname.split('.').map(Number);
    if (parts.some(function (part) { return !Number.isInteger(part) || part < 0 || part > 255; })) {
      return true;
    }
    var first = parts[0];
    var second = parts[1];
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0)
      || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19 || second === 51))
      || (first === 203 && second === 0)
      || first >= 224;
  }

  function assertPublicOriginHost(hostname) {
    var normalized = String(hostname || '').toLowerCase();
    if (!normalized
      || normalized.endsWith('.')
      || normalized === 'localhost'
      || normalized.endsWith('.localhost')
      || normalized === 'metadata'
      || normalized === 'metadata.google.internal'
      || normalized.endsWith('.metadata.google.internal')
      || normalized === 'instance-data'
      || normalized.endsWith('.instance-data')
      || normalized.endsWith('.internal')
      || normalized.endsWith('.local')
      || normalized.endsWith('.home.arpa')
      || normalized.includes(':')
      || isPrivateIpv4(normalized)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)) {
      var parts = normalized.split('.').map(Number);
      if (parts.some(function (part) { return !Number.isInteger(part) || part < 0 || part > 255; })) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
      }
      return;
    }
    if (!normalized.includes('.')
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(normalized)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
  }

  function exactExtensionUrl(sender, runtimeId, expectedPath) {
    if (!sender || typeof sender !== 'object' || String(sender.id || '') !== runtimeId) return null;
    if (typeof sender.frameId === 'number' && sender.frameId !== 0) return null;
    var rawUrl = typeof sender.url === 'string' && sender.url
      ? sender.url
      : sender.documentUrl;
    var parsed = parseUrl(rawUrl);
    if (!parsed || parsed.protocol !== 'chrome-extension:' || parsed.hostname !== runtimeId
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== expectedPath) return null;

    if (sender.url && sender.documentUrl && sender.url !== sender.documentUrl) return null;
    if (sender.origin) {
      var origin = parseUrl(String(sender.origin));
      if (!origin || origin.protocol !== 'chrome-extension:' || origin.hostname !== runtimeId
        || (origin.pathname !== '' && origin.pathname !== '/') || origin.search || origin.hash
        || !sameAuthority(parsed, origin)) {
        return null;
      }
    }
    if (sender.tab && sender.tab.url) {
      var tab = parseUrl(String(sender.tab.url));
      if (!tab || tab.protocol !== 'chrome-extension:' || tab.hostname !== runtimeId
        || tab.pathname !== expectedPath || tab.search || tab.hash || !sameAuthority(parsed, tab)) {
        return null;
      }
    }
    return parsed;
  }

  function senderSurface(sender, runtimeId) {
    if (exactExtensionUrl(sender, runtimeId, '/pages/ai-image-workbench.html')) {
      return SENDER_SURFACES.WORKBENCH;
    }
    if (exactExtensionUrl(sender, runtimeId, '/pages/ai-provider-settings.html')) {
      return SENDER_SURFACES.PROVIDER_SETTINGS;
    }
    return null;
  }

  function internalSenderIdentity(sender) {
    var tabId = Number(sender && sender.tab && sender.tab.id);
    var documentId = sender && typeof sender.documentId === 'string'
      ? sender.documentId.normalize('NFKC').trim()
      : '';
    return Object.freeze({
      tabId: Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null,
      documentId: documentId && documentId.length <= MAX_ID_LENGTH ? documentId : null,
      frameId: Number.isSafeInteger(sender && sender.frameId) ? sender.frameId : null,
    });
  }

  function descriptorFor(type) {
    if (MESSAGE_TYPES.PROVIDER_SETTINGS && PROVIDER_SETTINGS_TYPES.has(type)) {
      return {
        surface: SENDER_SURFACES.PROVIDER_SETTINGS,
        readiness: READINESS_REQUIRED_TYPES.has(type),
        draft: DRAFT_BOUND_TYPES.has(type),
        provider: PROVIDER_BOUND_TYPES.has(type),
        secretRequest: SECRET_REQUEST_TYPES.has(type),
      };
    }
    if (WORKBENCH_TYPES.has(type) || HOSTED_WORKBENCH_TYPES.has(type)) {
      return {
        surface: SENDER_SURFACES.WORKBENCH,
        readiness: READINESS_REQUIRED_TYPES.has(type),
        draft: DRAFT_BOUND_TYPES.has(type),
        provider: PROVIDER_BOUND_TYPES.has(type),
        secretRequest: false,
      };
    }
    return null;
  }

  function isNewType(type) {
    return NEW_TYPES.has(String(type == null ? '' : type).trim());
  }

  function isKnownRuntimeMessageType(type) {
    var normalized = String(type == null ? '' : type).trim();
    return isNewType(normalized) || legacyPolicy.isKnownRuntimeMessageType(normalized);
  }

  function isAllowedRuntimeMessageSender(type, sender, runtimeId) {
    var normalized = String(type == null ? '' : type).trim();
    var surface = senderSurface(sender, runtimeId);
    if (isNewType(normalized)) {
      var descriptor = descriptorFor(normalized);
      return Boolean(descriptor && surface === descriptor.surface);
    }
    // A future workbench/settings page must not inherit the broad legacy extension
    // page allowlist. Legacy pages continue through the existing policy unchanged.
    if (surface) return false;
    return legacyPolicy.isAllowedRuntimeMessageSender(normalized, sender, runtimeId);
  }

  function assertSafeString(value, forbiddenValues) {
    if (typeof value !== 'string') return;
    if (value.length > MAX_STRING_LENGTH) throw authError('SS_ERP_RUNTIME_MESSAGE_PAYLOAD_INVALID');
    if (/^(?:iVBORw0KGgo|\/9j\/|UklGR)[a-z0-9+/_=-]{128,}$/iu.test(value)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_BINARY_FORBIDDEN');
    }
    if (/^data:(?:image|audio|video)\/[^;]+;base64,/iu.test(value)
      || /\bbearer\s+[a-z0-9._~+/=-]{8,}/iu.test(value)
      || /\b(?:sk|rk)[-_][a-z0-9._-]{12,}/iu.test(value)
      || /\b(?:ghp|gho|ghs|ghr)_[a-z0-9._-]{12,}/iu.test(value)
      || /\b(?:xox[baprs]-|github_pat_|AIza|AKIA)[a-z0-9._-]{12,}/iu.test(value)
      || /\beyJ[a-z0-9_-]{16,}\.[a-z0-9_-]{8,}\./iu.test(value)
      || /https?:\/\/[^\s]+[?&](?:api[_-]?key|access[_-]?token|authorization|secret|password)=/iu.test(value)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
    }
    (forbiddenValues || []).forEach(function (secret) {
      if (typeof secret === 'string' && secret && value.includes(secret)) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
      }
    });
  }

  function inspectPublicValue(value, state, forbiddenValues, responseMode) {
    if (value === null || typeof value === 'string' || typeof value === 'number'
      || typeof value === 'boolean') {
      if (typeof value === 'string') assertSafeString(value, forbiddenValues);
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_PAYLOAD_INVALID');
      }
      return;
    }
    if (typeof value !== 'object' || state.depth >= MAX_DEPTH || state.nodes >= MAX_NODES) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_PAYLOAD_INVALID');
    }
    state.nodes += 1;
    if (Array.isArray(value)) {
      if (value.length > MAX_NODES) throw authError('SS_ERP_RUNTIME_MESSAGE_PAYLOAD_INVALID');
      if (value.length >= 4 && value.every(function (item) {
        return Number.isInteger(item) && item >= 0 && item <= 255;
      })) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_BINARY_FORBIDDEN');
      }
      state.depth += 1;
      value.forEach(function (item) {
        inspectPublicValue(item, state, forbiddenValues, responseMode);
      });
      state.depth -= 1;
      return;
    }
    if (!isRecord(value)) throw authError('SS_ERP_RUNTIME_MESSAGE_PAYLOAD_INVALID');
    state.depth += 1;
    Object.keys(value).forEach(function (key) {
      if (isSecretField(key)) throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
      if (responseMode && RESPONSE_URL_FIELD_NAMES.has(normalizedKey(key))) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
      }
      inspectPublicValue(value[key], state, forbiddenValues, responseMode);
    });
    state.depth -= 1;
  }

  function assertNoSecretPayload(value) {
    inspectPublicValue(value == null ? {} : value, { depth: 0, nodes: 0 }, [], false);
    return value;
  }

  function normalizeProfileId(value) {
    var result = text(value, MAX_ID_LENGTH);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(result)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_PAYLOAD_INVALID');
    }
    return result;
  }

  function normalizeHandle(value) {
    return text(value, MAX_HANDLE_LENGTH);
  }

  function normalizeOrigin(value) {
    var origin = text(value, 300);
    var parsed = parseUrl(origin);
    if (!parsed || parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== origin) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    assertPublicOriginHost(parsed.hostname);
    return parsed.origin;
  }

  function normalizeNullableId(value) {
    if (value === null) return null;
    return normalizeProfileId(value);
  }

  function normalizePositiveInteger(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    return value;
  }

  function normalizeNullableText(value, maximum) {
    if (value === null) return null;
    var normalized = text(value, maximum);
    if (normalized !== value) throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    return normalized;
  }

  function normalizeAssignmentOrdinal(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 499) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    return value;
  }

  function isSupportedSlotKey(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function normalizeBinding(value) {
    if (!isRecord(value)) throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    var allowed = new Set(BINDING_KEYS);
    if (!hasOnlyKeys(value, allowed) || Object.keys(value).length !== BINDING_KEYS.length) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    if (value.contractVersion !== READINESS_BINDING_VERSION) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    var operation = value.operation === null ? null : text(value.operation, 64);
    if (operation !== null && !OPERATION_VALUES.has(operation)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    var providerOrigin = value.providerOrigin === null ? null : normalizeOrigin(value.providerOrigin);
    var model = value.model === null ? null : text(value.model, MAX_ID_LENGTH);
    if (model !== null) assertSafeString(model, []);
    var workflowId = normalizeNullableId(value.workflowId);
    var draftRevision = normalizePositiveInteger(value.draftRevision);
    var draftVersion = normalizePositiveInteger(value.draftVersion);
    var sourcePlatform = normalizeNullableText(value.sourcePlatform, 16);
    var sourceProductId = normalizeNullableText(value.sourceProductId, 200);
    var sourceCaptureSnapshotId = normalizeNullableText(value.sourceCaptureSnapshotId, 200);
    var supplyGoodsId = normalizeNullableText(value.supplyGoodsId, 200);
    var skuKey = normalizeNullableText(value.skuKey, 500);
    var slotKey = normalizeNullableText(value.slotKey, 200);
    var assignmentMode = normalizeNullableText(value.assignmentMode, 16);
    var assignmentOrdinal = normalizeAssignmentOrdinal(value.assignmentOrdinal);
    var draftContext = [
      workflowId, draftRevision, draftVersion, sourcePlatform, sourceProductId,
      sourceCaptureSnapshotId, supplyGoodsId, skuKey, slotKey, assignmentMode,
      assignmentOrdinal,
    ];
    if (draftContext.some(function (item) { return item === null; })
      && draftContext.some(function (item) { return item !== null; })) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    if (workflowId !== null && (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)
      || assignmentMode !== 'APPEND'
      || !isSupportedSlotKey(skuKey, slotKey))) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    return {
      contractVersion: READINESS_BINDING_VERSION,
      ownerUserId: normalizeProfileId(value.ownerUserId),
      deviceSessionId: normalizeProfileId(value.deviceSessionId),
      shopId: normalizeNullableId(value.shopId),
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
      providerOrigin: providerOrigin,
      model: model,
      operation: operation,
      policyRevision: text(value.policyRevision, MAX_ID_LENGTH),
    };
  }

  function sameBinding(left, right) {
    return BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function assertBindingRequirements(binding, descriptor) {
    if (descriptor.draft && (!binding.shopId || !binding.workflowId
      || binding.draftRevision === null || binding.draftVersion === null)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    if (descriptor.provider && (!binding.providerOrigin || !binding.model || !binding.operation)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    if (descriptor.provider && !AI_OPERATION_VALUES.has(binding.operation)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
  }

  function comparePayloadBinding(payload, binding) {
    if (!isRecord(payload)) return;
    [
      'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'sourcePlatform',
      'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey',
      'slotKey', 'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model',
      'operation',
    ]
      .forEach(function (key) {
        if (payload[key] === undefined || payload[key] === null) return;
        if (binding[key] !== payload[key]) {
          throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_MISMATCH');
        }
      });
  }

  function normalizeMessage(message, descriptor) {
    if (!isRecord(message) || message.type == null) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_INVALID');
    }
    var allowedKeys = new Set(['type', 'payload']);
    if (descriptor.readiness) {
      allowedKeys.add('readinessHandle');
      allowedKeys.add('readinessBinding');
    }
    if (Object.keys(message).some(function (key) { return !allowedKeys.has(key); })) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_INVALID');
    }
    if (descriptor.secretRequest) {
      if (!isRecord(message.payload)
        || !hasOnlyKeys(message.payload, new Set(['profileId', 'apiKey']))
        || Object.keys(message.payload).length !== 2) {
        throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
      }
      normalizeProfileId(message.payload.profileId);
      var key = text(message.payload.apiKey, 4096);
      if (!key) throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN');
    } else {
      assertNoSecretPayload(message.payload);
    }
    if (!descriptor.readiness) return { payload: message.payload == null ? {} : message.payload };
    if (!Object.prototype.hasOwnProperty.call(message, 'readinessHandle')
      || !Object.prototype.hasOwnProperty.call(message, 'readinessBinding')) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_UNAVAILABLE');
    }
    var binding = normalizeBinding(message.readinessBinding);
    assertBindingRequirements(binding, descriptor);
    comparePayloadBinding(message.payload, binding);
    return {
      payload: message.payload == null ? {} : message.payload,
      handle: normalizeHandle(message.readinessHandle),
      binding: binding,
    };
  }

  function normalizeVerification(value, expectedBinding, now) {
    if (!isRecord(value) || value.authenticated !== true
      || value.contractVersion !== READINESS_VERIFICATION_VERSION) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    var verificationKeys = new Set([
      'contractVersion', 'authenticated', 'handleId', 'expiresAt', 'binding',
    ]);
    if (!hasOnlyKeys(value, verificationKeys) || Object.keys(value).length !== verificationKeys.size) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    var handleId = normalizeProfileId(value.handleId);
    var expiresAt = text(value.expiresAt, 64);
    var expires = Date.parse(expiresAt);
    var nowMillis = now.getTime();
    if (!Number.isFinite(expires) || expires <= nowMillis
      || expires - nowMillis > MAX_READINESS_TTL_MS) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    var binding = normalizeBinding(value.binding);
    if (!sameBinding(binding, expectedBinding)) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_MISMATCH');
    }
    var concurrency = value.concurrencyAuthority;
    if (!isRecord(concurrency)
      || Object.keys(concurrency).length !== 2
      || !Object.keys(concurrency).every(function (key) {
        return ['policyRevision', 'maxConcurrency'].includes(key);
      })
      || concurrency.policyRevision !== binding.policyRevision
      || !Number.isSafeInteger(concurrency.maxConcurrency)
      || concurrency.maxConcurrency < 1 || concurrency.maxConcurrency > 4) {
      throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    }
    var normalized = {
      handleId: handleId,
      expiresAt: new Date(expires).toISOString(),
      binding: binding,
    };
    Object.defineProperty(normalized, 'concurrencyAuthority', {
      value: Object.freeze({
        policyRevision: binding.policyRevision,
        maxConcurrency: concurrency.maxConcurrency,
      }),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return Object.freeze(normalized);
  }

  async function authorizeRuntimeMessage(input) {
    if (!isRecord(input)) return { allowed: false, code: 'SS_ERP_RUNTIME_MESSAGE_INVALID' };
    var runtimeId = typeof input.runtimeId === 'string' ? input.runtimeId.trim() : '';
    var message = input.message;
    var type = message && typeof message.type === 'string' ? message.type.trim() : '';
    var descriptor = descriptorFor(type);
    if (!descriptor || !isAllowedRuntimeMessageSender(type, input.sender, runtimeId)) {
      return { allowed: false, code: 'SS_ERP_RUNTIME_MESSAGE_SENDER_DENIED' };
    }

    var normalized;
    try {
      normalized = normalizeMessage(message, descriptor);
    } catch (error) {
      return {
        allowed: false,
        code: error && error.code ? error.code : 'SS_ERP_RUNTIME_MESSAGE_INVALID',
      };
    }

    var result = {
      allowed: true,
      contractVersion: CONTRACT_VERSION,
      messageType: type,
      senderSurface: descriptor.surface,
      secretRequest: descriptor.secretRequest,
      readiness: null,
    };
    if (!descriptor.readiness) return result;

    if (typeof input.verifyReadinessHandle !== 'function') {
      return { allowed: false, code: 'SS_ERP_RUNTIME_MESSAGE_READINESS_UNAVAILABLE' };
    }
    var now;
    try {
      now = input.now ? new Date(input.now()) : new Date();
      if (!Number.isFinite(now.getTime())) throw authError('SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID');
    } catch (_error) {
      return { allowed: false, code: 'SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID' };
    }
    var verified;
    try {
      verified = await input.verifyReadinessHandle({
        handle: normalized.handle,
        expectedBinding: normalized.binding,
        messageType: type,
        senderSurface: descriptor.surface,
      });
    } catch (_error) {
      return { allowed: false, code: 'SS_ERP_RUNTIME_MESSAGE_READINESS_UNAVAILABLE' };
    }
    try {
      result.readiness = normalizeVerification(verified, normalized.binding, now);
    } catch (error) {
      return {
        allowed: false,
        code: error && error.code ? error.code : 'SS_ERP_RUNTIME_MESSAGE_READINESS_INVALID',
      };
    }
    return result;
  }

  function assertSafeRuntimeResponse(value, forbiddenValues) {
    try {
      inspectPublicValue(value, { depth: 0, nodes: 0 }, forbiddenValues || [], true);
    } catch (error) {
      if (error && error.code === 'SS_ERP_RUNTIME_MESSAGE_SECRET_FORBIDDEN') {
        throw authError('SS_ERP_RUNTIME_RESPONSE_SECRET');
      }
      throw authError('SS_ERP_RUNTIME_RESPONSE_INVALID');
    }
    return value;
  }

  function createSafeSendResponse(message, sendResponse, extraForbiddenValues) {
    if (typeof sendResponse !== 'function') {
      throw authError('SS_ERP_RUNTIME_RESPONSE_INVALID');
    }
    var forbiddenValues = [];
    var type = message && typeof message.type === 'string' ? message.type.trim() : '';
    if (SECRET_REQUEST_TYPES.has(type) && message && isRecord(message.payload)
      && typeof message.payload.apiKey === 'string' && message.payload.apiKey) {
      forbiddenValues.push(message.payload.apiKey);
    }
    if (Array.isArray(extraForbiddenValues)) {
      extraForbiddenValues.forEach(function (value) {
        if (typeof value === 'string' && value) forbiddenValues.push(value);
      });
    }
    var settled = false;
    return function safeSendResponse(value) {
      if (settled) return false;
      settled = true;
      try {
        return sendResponse(assertSafeRuntimeResponse(value, forbiddenValues));
      } catch (_error) {
        return sendResponse({
          ok: false,
          errorCode: 'SS_ERP_RUNTIME_RESPONSE_SECRET',
          error: '扩展响应被安全策略阻止',
        });
      }
    };
  }

  function handlerFor(handlers, type) {
    if (!handlers || typeof handlers !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(handlers, type)) return null;
    var candidate = handlers[type];
    return typeof candidate === 'function' ? candidate : null;
  }

  function secretPayloadReader(message) {
    var consumed = false;
    return function readSecretPayload() {
      if (consumed) throw authError('SS_ERP_RUNTIME_MESSAGE_SECRET_ALREADY_READ');
      consumed = true;
      return {
        profileId: message.payload.profileId,
        apiKey: message.payload.apiKey,
      };
    };
  }

  async function dispatchAuthorizedRuntimeMessage(input) {
    if (!isRecord(input) || !isNewType(input.message && input.message.type)) return false;
    var respond;
    try {
      respond = createSafeSendResponse(input.message, input.sendResponse);
    } catch (_error) {
      return false;
    }
    var decision;
    try {
      decision = await authorizeRuntimeMessage({
        runtimeId: input.runtimeId,
        sender: input.sender,
        message: input.message,
        verifyReadinessHandle: input.verifyReadinessHandle,
        now: input.now,
      });
    } catch (_error) {
      respond({
        ok: false,
        errorCode: 'SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION_FAILED',
        error: '扩展请求未通过安全校验',
      });
      return false;
    }
    if (!decision.allowed) {
      respond({
        ok: false,
        errorCode: decision.code,
        error: '扩展请求未通过安全校验',
      });
      return false;
    }
    if (input.forbiddenResponseValues) {
      var extraForbiddenValues;
      try {
        extraForbiddenValues = typeof input.forbiddenResponseValues === 'function'
          ? await input.forbiddenResponseValues({
            authorization: decision,
            payload: decision.secretRequest ? null : (input.message.payload || {}),
          })
          : input.forbiddenResponseValues;
        if (!Array.isArray(extraForbiddenValues)) {
          throw authError('SS_ERP_RUNTIME_RESPONSE_GUARD_UNAVAILABLE');
        }
        respond = createSafeSendResponse(input.message, input.sendResponse, extraForbiddenValues);
      } catch (_error) {
        respond({
          ok: false,
          errorCode: 'SS_ERP_RUNTIME_RESPONSE_GUARD_UNAVAILABLE',
          error: '扩展响应安全校验不可用',
        });
        return false;
      }
    }
    var handler = handlerFor(input.handlers, decision.messageType);
    if (!handler) {
      respond({
        ok: false,
        errorCode: 'SS_ERP_RUNTIME_MESSAGE_HANDLER_UNAVAILABLE',
        error: '扩展功能尚未启用',
      });
      return false;
    }
    var context = {
      authorization: decision,
      sender: internalSenderIdentity(input.sender),
    };
    if (decision.secretRequest) {
      context.readSecretPayload = secretPayloadReader(input.message);
    } else {
      context.payload = input.message.payload == null ? {} : input.message.payload;
    }
    try {
      var response = await handler(Object.freeze(context));
      respond(response);
      return true;
    } catch (_error) {
      respond({
        ok: false,
        errorCode: 'SS_ERP_RUNTIME_MESSAGE_HANDLER_FAILED',
        error: '扩展请求处理失败',
      });
      return false;
    }
  }

  var publicApi = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    READINESS_BINDING_VERSION: READINESS_BINDING_VERSION,
    READINESS_VERIFICATION_VERSION: READINESS_VERIFICATION_VERSION,
    SENDER_SURFACES: SENDER_SURFACES,
    MESSAGE_TYPES: MESSAGE_TYPES,
    senderSurface: senderSurface,
    isNewRuntimeMessageType: isNewType,
    isKnownRuntimeMessageType: isKnownRuntimeMessageType,
    isAllowedRuntimeMessageSender: isAllowedRuntimeMessageSender,
    authorizeRuntimeMessage: authorizeRuntimeMessage,
    assertSafeRuntimeResponse: assertSafeRuntimeResponse,
    createSafeSendResponse: createSafeSendResponse,
    dispatchAuthorizedRuntimeMessage: dispatchAuthorizedRuntimeMessage,
  });

  root.SS_ERP_RUNTIME_MESSAGE_AUTHORIZATION = publicApi;
  root.SS_ERP_RUNTIME_MESSAGE_POLICY = Object.freeze({
    isKnownRuntimeMessageType: isKnownRuntimeMessageType,
    isAllowedRuntimeMessageSender: isAllowedRuntimeMessageSender,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
