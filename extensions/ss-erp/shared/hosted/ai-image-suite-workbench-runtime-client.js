(function exposeHostedAiImageSuiteWorkbenchRuntimeClient(global) {
  'use strict';

  var CONTRACT_VERSION =
    'extension-hosted-ai-image-suite-workbench-runtime-client/v1';
  var MODE_LOCK_VERSION = 'extension-hosted-ai-image-mode-lock/v1';
  var HOSTED_CLIENT_VERSION = 'extension-hosted-ai-image-suite-workbench-client/v1';
  var SUITE_VERSION = 'hosted-ai-image-suite-workbench-adapter/v1';
  var INTENT_VERSION = 'extension-ai-image-suite-intent-witness/v1';
  var PREVIEW_VERSION = 'extension-hosted-ai-image-suite-candidate-preview-channel/v1';
  var ASSIGNMENT_VERSION = 'extension-hosted-ai-image-listing-assignment/v2';
  var DEFAULT_TIMEOUT_MS = 30 * 1000;
  var MAXIMUM_PREVIEW_CLOCK_SKEW_MS = 30 * 1000;
  var MAX_COST_CENTS = 10000000;
  var MAX_ASSIGNMENT_ORDINAL = 499;
  // Wire values mirror the ai-media-planning owner; contract tests enforce parity.
  var GALLERY_GOALS = Object.freeze(['scene', 'detail', 'function', 'fitment', 'spec', 'package', 'poster']);
  var BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion',
  ]);
  var MESSAGE_TYPES = Object.freeze({
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
  });
  var FORBIDDEN_KEY_MARKERS = Object.freeze([
    'url', 'base64', 'provider', 'model', 'prompt', 'storage', 'job', 'billing',
    'projection', 'rawprojection', 'token', 'secret', 'authorization', 'reservation',
    'settlement', 'rawbytes', 'imagebytes', 'arraybuffer',
  ]);

  function clientError(code, details) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteWorkbenchRuntimeClientError';
    error.code = code;
    if (details) Object.assign(error, details);
    return error;
  }

  function fail(code) {
    throw clientError(code);
  }

  function record(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  }

  function exactKeys(value, keys) {
    var item = record(value);
    return Boolean(item)
      && Object.keys(item).length === keys.length
      && Object.keys(item).every(function (key) { return keys.includes(key); });
  }

  function hasControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function canonicalText(value, minimum, maximum, code) {
    if (typeof value !== 'string'
      || value.length < minimum
      || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)) fail(code);
    return value;
  }

  function opaqueText(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (/(?:https?|ftp|file|blob|data):/iu.test(result)
      || result.includes('?')
      || result.includes('#')) fail(code);
    return result;
  }

  function identifier(value, minimum, maximum, code) {
    var result = opaqueText(value, minimum, maximum, code);
    if (result.includes('/') || result.includes('\\')) fail(code);
    return result;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  }

  function nonNegativeInteger(value, maximum, code) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(code);
    return value;
  }

  function cost(value, positive, code) {
    if (!Number.isSafeInteger(value)
      || value < (positive ? 1 : 0)
      || value > MAX_COST_CENTS) fail(code);
    return value;
  }

  function sha256(value, code) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
    return value;
  }

  function timestamp(value, code) {
    var result = canonicalText(value, 1, 100, code);
    var parsed = new Date(result);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) fail(code);
    return result;
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (record(value)) {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], clone(entry[1])];
      }));
    }
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function normalizeBinding(value, code) {
    if (!exactKeys(value, BINDING_KEYS)) fail(code);
    return deepFreeze({
      snapshotId: opaqueText(value.snapshotId, 1, 200, code),
      supplyGoodsId: opaqueText(value.supplyGoodsId, 1, 200, code),
      shopId: opaqueText(value.shopId, 1, 200, code),
      listingWorkflowId: opaqueText(value.listingWorkflowId, 1, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
    });
  }

  function sameBinding(left, right) {
    return Boolean(left && right)
      && BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function normalizeGalleryGoals(value, code) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > GALLERY_GOALS.length
      || value.some(function (goal) { return !GALLERY_GOALS.includes(goal); })
      || new Set(value).size !== value.length) fail(code);
    return value.slice();
  }

  function normalizeCandidateMediaKeys(value, code) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 1 || value.length > 25 || new Set(value).size !== value.length) fail(code);
    return value.map(function (key) {
      var normalized = opaqueText(key, 1, 500, code);
      if (/(?:javascript|ws|wss):|\b[a-z][a-z0-9+.-]*:\/\/|www\./iu.test(normalized)) fail(code);
      return normalized;
    });
  }

  function normalizeCreativeBrief(value, code) {
    if (value === undefined) return undefined;
    var keys = ['prompt'];
    if (record(value) && Object.prototype.hasOwnProperty.call(value, 'negativePrompt')) keys.push('negativePrompt');
    if (!exactKeys(value, keys)) fail(code);
    function creativeText(input, minimum, maximum) {
      if (typeof input !== 'string'
        || input.length > maximum * 2
        || input !== input.trim()
        || Array.from(input).length < minimum
        || Array.from(input).length > maximum
        || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(input)
        || /(?:https?|ftp|file|blob|data|javascript|ws|wss):|\b[a-z][a-z0-9+.-]*:\/\/|www\./iu.test(input)
        || /\b(?:api[_ -]?key|authorization|bearer)\b|\bsk-[A-Za-z0-9]/iu.test(input)
        || /^(?:rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(input)) fail(code);
      return input;
    }
    var result = { prompt: creativeText(value.prompt, 1, 300) };
    if (keys.includes('negativePrompt')) result.negativePrompt = creativeText(value.negativePrompt, 0, 150);
    return deepFreeze(result);
  }

  function normalizeSuiteCommand(value, action, outerSlotId, decision, code) {
    if (action === 'START') {
      if (!exactKeys(value, [
        'expectedPreviewHash', 'acceptedPricingVersion',
        'acceptedEstimatedCostCents', 'acceptedMaximumCostCents',
      ])) fail(code);
      var estimated = cost(value.acceptedEstimatedCostCents, false, code);
      var maximum = cost(value.acceptedMaximumCostCents, true, code);
      if (maximum < estimated) fail(code);
      return {
        expectedPreviewHash: sha256(value.expectedPreviewHash, code),
        acceptedPricingVersion: opaqueText(value.acceptedPricingVersion, 1, 100, code),
        acceptedEstimatedCostCents: estimated,
        acceptedMaximumCostCents: maximum,
      };
    }
    if (action === 'CONTINUE' || action === 'CANCEL') {
      if (!exactKeys(value, ['suiteId', 'expectedSuiteRevision'])) fail(code);
      return {
        suiteId: identifier(value.suiteId, 1, 200, code),
        expectedSuiteRevision: positiveInteger(value.expectedSuiteRevision, code),
      };
    }
    if (action === 'RETRY_SLOT') {
      if (!exactKeys(value, [
        'suiteId', 'slotId', 'expectedSuiteRevision', 'expectedSlotRevision',
        'acceptedAdditionalMaximumCostCents',
      ])) fail(code);
      var retrySlotId = identifier(value.slotId, 1, 200, code);
      if (retrySlotId !== outerSlotId) fail(code);
      return {
        suiteId: identifier(value.suiteId, 1, 200, code),
        slotId: retrySlotId,
        expectedSuiteRevision: positiveInteger(value.expectedSuiteRevision, code),
        expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
        acceptedAdditionalMaximumCostCents: cost(
          value.acceptedAdditionalMaximumCostCents,
          true,
          code,
        ),
      };
    }
    var sharedKeys = [
      'suiteId', 'slotId', 'workflowId', 'outputAssetId', 'expectedSuiteRevision',
      'expectedSlotRevision', 'expectedWorkflowRevision',
    ];
    var expectedKeys = action === 'REVIEW_SLOT'
      ? sharedKeys.concat(['decisions'])
      : sharedKeys.concat([
        'mode', 'target', 'writesStoreDraft', 'expectedTargetUpdatedAt',
      ]);
    if (!exactKeys(value, expectedKeys)) fail(code);
    var slotId = identifier(value.slotId, 1, 200, code);
    if (slotId !== outerSlotId) fail(code);
    var result = {
      suiteId: identifier(value.suiteId, 1, 200, code),
      slotId: slotId,
      workflowId: identifier(value.workflowId, 1, 200, code),
      outputAssetId: identifier(value.outputAssetId, 1, 200, code),
      expectedSuiteRevision: positiveInteger(value.expectedSuiteRevision, code),
      expectedSlotRevision: positiveInteger(value.expectedSlotRevision, code),
      expectedWorkflowRevision: positiveInteger(value.expectedWorkflowRevision, code),
    };
    if (action === 'REVIEW_SLOT') {
      if (!Array.isArray(value.decisions)
        || value.decisions.length !== 2
        || new Set(value.decisions).size !== 2
        || !value.decisions.includes('APPROVE')
        || !value.decisions.includes('REJECT')
        || !value.decisions.includes(decision)) fail(code);
      result.decisions = value.decisions.slice();
      return result;
    }
    if (value.mode !== 'append'
      || value.target !== 'ERP_SOURCE_PRODUCT'
      || value.writesStoreDraft !== false) fail(code);
    result.mode = 'append';
    result.target = 'ERP_SOURCE_PRODUCT';
    result.writesStoreDraft = false;
    result.expectedTargetUpdatedAt = timestamp(value.expectedTargetUpdatedAt, code);
    return result;
  }

  function normalizeIntent(value, binding) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
    if (!exactKeys(value, [
      'version', 'context', 'authorityHash', 'action', 'slotId', 'decision',
      'commandTemplate',
    ])
      || value.version !== INTENT_VERSION
      || !['START', 'CONTINUE', 'CANCEL', 'RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT']
        .includes(value.action)) fail(code);
    var context = normalizeBinding(value.context, code);
    if (!sameBinding(context, binding)) fail('SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE');
    var slotAction = ['RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT'].includes(value.action);
    var slotId = value.slotId === null ? null : identifier(value.slotId, 1, 200, code);
    var decision = value.decision;
    if (slotAction !== Boolean(slotId)
      || (value.action === 'REVIEW_SLOT'
        ? !['APPROVE', 'REJECT'].includes(decision)
        : decision !== null)) fail(code);
    return deepFreeze({
      version: INTENT_VERSION,
      context: clone(context),
      authorityHash: sha256(value.authorityHash, code),
      action: value.action,
      slotId: slotId,
      decision: decision,
      commandTemplate: normalizeSuiteCommand(
        value.commandTemplate,
        value.action,
        slotId,
        decision,
        code,
      ),
    });
  }

  function normalizeConfirmation(intent, value) {
    var costAction = intent.action === 'START' || intent.action === 'RETRY_SLOT';
    if (!costAction) {
      if (value !== null) fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      return null;
    }
    var expectedMaximum = intent.action === 'START'
      ? intent.commandTemplate.acceptedMaximumCostCents
      : intent.commandTemplate.acceptedAdditionalMaximumCostCents;
    if (!exactKeys(value, ['confirmed', 'maximumCostCents'])
      || value.confirmed !== true
      || cost(value.maximumCostCents, true, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID')
        !== expectedMaximum) {
      fail('SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED');
    }
    return deepFreeze({ confirmed: true, maximumCostCents: expectedMaximum });
  }

  function normalizedKey(value) {
    return value.toLowerCase().replace(/[_-]/gu, '');
  }

  function publicString(value) {
    return value.length <= 4000
      && !hasControlCharacter(value)
      && !/(?:https?|ftp|file|blob|data):/iu.test(value)
      && !/(?:bearer\s+|api[_-]?key\s*[:=]|authorization\s*[:=])/iu.test(value)
      && !/^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(value);
  }

  function clonePublic(value, depth, state, ancestors, path) {
    if (state.count > 50000 || depth > 16) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    state.count += 1;
    // Keep this exception confined to the safe plan-version projection.
    if (state.allowCreativeBrief && path.length === 3 && path[0] === 'plan'
      && ['currentVersion', 'approvedVersion'].includes(path[1]) && path[2] === 'creativeBrief') {
      if (value === undefined) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      return normalizeCreativeBrief(value, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      return value;
    }
    if (typeof value === 'string') {
      if (!publicString(value)) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    ancestors.add(value);
    var result;
    if (Array.isArray(value)) {
      if (value.length > 500) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      result = value.map(function (item, index) {
        return clonePublic(item, depth + 1, state, ancestors, path.concat(index));
      });
    } else {
      var keys = Object.keys(value);
      if (keys.length > 64) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      result = {};
      keys.forEach(function (key) {
        var markerKey = normalizedKey(key);
        if (key.length < 1
          || key.length > 100
          || hasControlCharacter(key)
          || FORBIDDEN_KEY_MARKERS.some(function (marker) {
            return markerKey.includes(marker);
          })) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
        result[key] = clonePublic(value[key], depth + 1, state, ancestors, path.concat(key));
      });
    }
    ancestors.delete(value);
    return result;
  }

  function publicData(value, allowCreativeBrief) {
    var result = clonePublic(value, 0, { count: 0, allowCreativeBrief: allowCreativeBrief === true }, new Set(), []);
    if (!record(result)) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    return result;
  }

  function normalizeModeLockData(value, expectedBinding) {
    var result = publicData(value);
    if (!exactKeys(result, [
      'contractVersion', 'context', 'state', 'hostedExecutionEnabled',
    ])
      || result.contractVersion !== MODE_LOCK_VERSION
      || !['NO_SUITE', 'HAS_SUITE'].includes(result.state)
      || typeof result.hostedExecutionEnabled !== 'boolean') {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    var responseBinding = normalizeBinding(
      result.context,
      'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID',
    );
    if (!sameBinding(responseBinding, expectedBinding)) {
      fail('SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE');
    }
    return deepFreeze(result);
  }

  function normalizePlanData(value, expectedBinding) {
    var result = publicData(value, true);
    if (!exactKeys(result, [
      'contractVersion', 'replayed', 'policyRevision', 'binding', 'plan',
    ])
      || result.contractVersion !== HOSTED_CLIENT_VERSION
      || typeof result.replayed !== 'boolean'
      || !Number.isSafeInteger(result.policyRevision)
      || result.policyRevision < 1
      || !(result.plan === null || record(result.plan))) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    var responseBinding = normalizeBinding(
      result.binding,
      'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID',
    );
    if (!sameBinding(responseBinding, expectedBinding)) {
      fail('SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE');
    }
    return deepFreeze(result);
  }

  function normalizeSuiteData(value, expectedBinding) {
    var result = publicData(value);
    if (!exactKeys(result, [
      'contractVersion', 'executionMode', 'binding', 'sourceBinding', 'applyPolicy',
      'quote', 'plan', 'suite',
    ])
      || result.contractVersion !== SUITE_VERSION
      || result.executionMode !== 'ERP_HOSTED'
      || !exactKeys(result.binding, [
        'shopId', 'workflowId', 'draftRevision', 'draftVersion',
      ])
      || result.binding.shopId !== expectedBinding.shopId
      || result.binding.workflowId !== expectedBinding.listingWorkflowId
      || result.binding.draftRevision !== expectedBinding.draftRevision
      || result.binding.draftVersion !== expectedBinding.draftVersion
      || !exactKeys(result.sourceBinding, ['snapshotId', 'supplyGoodsId', 'skuKey'])
      || result.sourceBinding.snapshotId !== expectedBinding.snapshotId
      || result.sourceBinding.supplyGoodsId !== expectedBinding.supplyGoodsId
      || !(result.sourceBinding.skuKey === null
        || typeof result.sourceBinding.skuKey === 'string')
      || !exactKeys(result.applyPolicy, ['target', 'mode', 'writesStoreDraft'])
      || result.applyPolicy.target !== 'ERP_SOURCE_PRODUCT'
      || result.applyPolicy.mode !== 'append'
      || result.applyPolicy.writesStoreDraft !== false
      || !(result.quote === null || record(result.quote))
      || !(result.plan === null || record(result.plan))
      || !(result.suite === null || record(result.suite))
      || (result.plan === null) !== (result.quote === null)
      || (result.suite !== null && result.plan === null)) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    return deepFreeze(result);
  }

  function normalizeExecuteData(value, expectedAction) {
    var result = publicData(value);
    if (!exactKeys(result, ['contractVersion', 'state', 'replayed', 'action'])
      || result.contractVersion !== HOSTED_CLIENT_VERSION
      || result.state !== 'completed'
      || typeof result.replayed !== 'boolean'
      || result.action !== expectedAction) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    return deepFreeze(result);
  }

  function normalizePreviewData(value, now) {
    var result = publicData(value);
    if (!exactKeys(result, [
      'contractVersion', 'channelName', 'previewTicket', 'expiresAt', 'metadata',
    ])
      || result.contractVersion !== PREVIEW_VERSION
      || !/^ss-erp:hosted-candidate-preview:[a-f0-9]{48}$/u.test(result.channelName)
      || !/^hp_[a-f0-9]{48}$/u.test(result.previewTicket)
      || !exactKeys(result.metadata, ['mimeType', 'byteLength'])
      || result.metadata.mimeType !== 'image/png'
      || result.metadata.byteLength !== null) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    timestamp(result.expiresAt, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    var currentTime = new Date(now()).getTime();
    var expiryTime = Date.parse(result.expiresAt);
    if (!Number.isFinite(currentTime)
      || !Number.isFinite(expiryTime)
      || expiryTime <= currentTime
      || expiryTime - currentTime > DEFAULT_TIMEOUT_MS + MAXIMUM_PREVIEW_CLOCK_SKEW_MS) {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    return deepFreeze(result);
  }

  function normalizeAssignmentData(value, expectedBinding, input) {
    var result = publicData(value);
    if (!exactKeys(result, [
      'contractVersion', 'batchId', 'replayed', 'shopId', 'listingWorkflowId',
      'sourceDraftRevision', 'sourceDraftVersion', 'boundDraftRevision',
      'boundDraftVersion', 'assignments', 'validationStatus', 'publishReadiness',
    ])
      || result.contractVersion !== ASSIGNMENT_VERSION
      || typeof result.replayed !== 'boolean'
      || result.shopId !== expectedBinding.shopId
      || result.listingWorkflowId !== expectedBinding.listingWorkflowId
      || result.sourceDraftRevision !== expectedBinding.draftRevision
      || result.sourceDraftVersion !== expectedBinding.draftVersion
      || result.boundDraftRevision !== expectedBinding.draftRevision + 1
      || result.boundDraftVersion !== expectedBinding.draftVersion + 1
      || !Array.isArray(result.assignments)
      || result.assignments.length !== input.intents.length
      || result.validationStatus !== 'STALE'
      || result.publishReadiness !== 'STALE') {
      fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    }
    identifier(result.batchId, 1, 200, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    var expectedAssets = new Set(input.intents.map(function (intent) {
      return intent.commandTemplate.outputAssetId;
    }));
    result.assignments.forEach(function (assignment, index) {
      if (!exactKeys(assignment, [
        'assignmentId', 'skuKey', 'slotKey', 'assignmentScope',
        'assignmentOrdinal', 'assetId',
      ])
        || !['SKU', 'PRODUCT'].includes(assignment.assignmentScope)
        || assignment.assignmentOrdinal !== input.assignmentStartOrdinal + index
        || !expectedAssets.delete(assignment.assetId)) {
        fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      }
      identifier(assignment.assignmentId, 1, 200, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      opaqueText(assignment.skuKey, 1, 500, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      opaqueText(assignment.slotKey, 1, 1_024, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
      identifier(assignment.assetId, 1, 500, 'SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    });
    if (expectedAssets.size !== 0) fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
    return deepFreeze(result);
  }

  function unknownOutcome(type) {
    return clientError(
      type === MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT
        ? 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME'
        : 'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
      {
        outcome: 'UNKNOWN_OUTCOME',
        automaticRetryAllowed: false,
        operation: type === MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT
          ? 'ASSIGN_APPROVED_OUTPUT'
          : 'EXECUTE_INTENT',
      },
    );
  }

  function createClient(options) {
    var config = options || {};
    var runtime = config.runtime || global.chrome && global.chrome.runtime;
    var schedule = config.setTimeout || global.setTimeout;
    var cancel = config.clearTimeout || global.clearTimeout;
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    var configuredTimeout = Number(config.timeoutMs);
    var timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? Math.min(configuredTimeout, DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
    if (!runtime || typeof runtime.sendMessage !== 'function'
      || typeof schedule !== 'function'
      || typeof cancel !== 'function') {
      fail('SS_ERP_HOSTED_WORKBENCH_RUNTIME_UNAVAILABLE');
    }

    var pinnedBinding = null;

    function pin(value) {
      var binding = normalizeBinding(value, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      if (pinnedBinding && !sameBinding(pinnedBinding, binding)) {
        fail('SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE');
      }
      if (!pinnedBinding) pinnedBinding = binding;
      return binding;
    }

    function send(type, payload, normalizeOutput) {
      var mutatingUnknown = type === MESSAGE_TYPES.EXECUTE_INTENT
        || type === MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT;
      var message = deepFreeze({ type: type, payload: clone(payload) });
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = schedule(function () {
          if (settled) return;
          settled = true;
          reject(mutatingUnknown
            ? unknownOutcome(type)
            : clientError('SS_ERP_HOSTED_WORKBENCH_RUNTIME_TIMEOUT'));
        }, timeoutMs);

        function finish(callback, value) {
          if (settled) return;
          settled = true;
          cancel(timer);
          callback(value);
        }

        try {
          runtime.sendMessage(message, function (response) {
            if (runtime.lastError) {
              finish(reject, mutatingUnknown
                ? unknownOutcome(type)
                : clientError('SS_ERP_HOSTED_WORKBENCH_RUNTIME_FAILED'));
              return;
            }
            if (!exactKeys(response, ['ok', 'data']) || response.ok !== true) {
              if (record(response) && response.ok === false) {
                var code = typeof response.errorCode === 'string'
                  && /^[A-Z][A-Z0-9_]{0,119}$/u.test(response.errorCode)
                  ? response.errorCode
                  : 'SS_ERP_HOSTED_WORKBENCH_OPERATION_FAILED';
                if (code.includes('UNKNOWN_OUTCOME')) {
                  finish(reject, mutatingUnknown
                    ? unknownOutcome(type)
                    : clientError(code));
                } else {
                  finish(reject, clientError(code));
                }
                return;
              }
              finish(reject, mutatingUnknown
                ? unknownOutcome(type)
                : clientError('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID'));
              return;
            }
            try {
              finish(resolve, normalizeOutput(response.data));
            } catch (error) {
              finish(reject, mutatingUnknown ? unknownOutcome(type) : error);
            }
          });
        } catch {
          finish(reject, mutatingUnknown
            ? unknownOutcome(type)
            : clientError('SS_ERP_HOSTED_WORKBENCH_RUNTIME_FAILED'));
        }
      });
    }

    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      messageTypes: MESSAGE_TYPES,

      getModeLock: function (bindingValue) {
        var binding = pin(bindingValue);
        return send(
          MESSAGE_TYPES.GET_MODE_LOCK,
          { binding: clone(binding) },
          function (data) { return normalizeModeLockData(data, binding); },
        );
      },

      getCurrentPlan: function (bindingValue) {
        var binding = pin(bindingValue);
        return send(
          MESSAGE_TYPES.GET_CURRENT_PLAN,
          { binding: clone(binding) },
          function (data) { return normalizePlanData(data, binding); },
        );
      },

      createPlan: function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        var keys = ['binding', 'idempotencyKey'];
        if (record(value) && Object.prototype.hasOwnProperty.call(value, 'galleryGoals')) keys.push('galleryGoals');
        if (record(value) && Object.prototype.hasOwnProperty.call(value, 'creativeBrief')) keys.push('creativeBrief');
        if (record(value) && Object.prototype.hasOwnProperty.call(value, 'candidateMediaKeys')) keys.push('candidateMediaKeys');
        if (!exactKeys(value, keys)) fail(code);
        var galleryGoals = normalizeGalleryGoals(value.galleryGoals, code);
        var creativeBrief = normalizeCreativeBrief(value.creativeBrief, code);
        var candidateMediaKeys = normalizeCandidateMediaKeys(value.candidateMediaKeys, code);
        var binding = pin(value.binding);
        var idempotencyKey = identifier(value.idempotencyKey, 8, 128, code);
        return send(
          MESSAGE_TYPES.CREATE_PLAN,
          {
            binding: clone(binding), idempotencyKey: idempotencyKey,
            ...(galleryGoals === undefined ? {} : { galleryGoals: galleryGoals }),
            ...(creativeBrief === undefined ? {} : { creativeBrief: clone(creativeBrief) }),
            ...(candidateMediaKeys === undefined ? {} : { candidateMediaKeys: candidateMediaKeys }),
          },
          function (data) { return normalizePlanData(data, binding); },
        );
      },

      getPlan: function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, ['binding', 'planId'])) fail(code);
        var binding = pin(value.binding);
        var planId = identifier(value.planId, 1, 200, code);
        return send(
          MESSAGE_TYPES.GET_PLAN,
          { binding: clone(binding), planId: planId },
          function (data) { return normalizePlanData(data, binding); },
        );
      },

      reviewPlan: function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, [
          'binding', 'planId', 'expectedRevision', 'operationKey', 'decision', 'note',
        ])
          || !['APPROVE', 'REJECT'].includes(value.decision)
          || !(value.note === null
            || typeof value.note === 'string'
              && value.note.length <= 2000
              && value.note === value.note.normalize('NFKC')
              && !hasControlCharacter(value.note)
              && publicString(value.note))) fail(code);
        var binding = pin(value.binding);
        var input = {
          binding: clone(binding),
          planId: identifier(value.planId, 1, 200, code),
          expectedRevision: positiveInteger(value.expectedRevision, code),
          operationKey: identifier(value.operationKey, 8, 128, code),
          decision: value.decision,
          note: value.note,
        };
        return send(
          MESSAGE_TYPES.REVIEW_PLAN,
          input,
          function (data) { return normalizePlanData(data, binding); },
        );
      },

      loadSuite: function (bindingValue) {
        var binding = pin(bindingValue);
        return send(
          MESSAGE_TYPES.LOAD_SUITE,
          { binding: clone(binding) },
          function (data) { return normalizeSuiteData(data, binding); },
        );
      },

      executeIntent: function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, ['binding', 'intent', 'confirmation'])) fail(code);
        var binding = pin(value.binding);
        var intent = normalizeIntent(value.intent, binding);
        if (intent.action === 'APPLY_SLOT') {
          fail('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED');
        }
        var confirmation = normalizeConfirmation(intent, value.confirmation);
        return send(
          MESSAGE_TYPES.EXECUTE_INTENT,
          { binding: clone(binding), intent: clone(intent), confirmation: clone(confirmation) },
          function (data) { return normalizeExecuteData(data, intent.action); },
        );
      },

      openPreview: function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, ['binding', 'slotId'])) fail(code);
        var binding = pin(value.binding);
        var slotId = identifier(value.slotId, 1, 200, code);
        return send(
          MESSAGE_TYPES.OPEN_PREVIEW,
          { binding: clone(binding), slotId: slotId },
          function (data) { return normalizePreviewData(data, now); },
        );
      },

      assignApprovedOutputs: function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, [
          'binding', 'intents', 'assignmentStartOrdinal', 'idempotencyKey',
        ])
          || !Array.isArray(value.intents)
          || value.intents.length < 1
          || value.intents.length > 500) fail(code);
        var binding = pin(value.binding);
        var intents = value.intents.map(function (intentValue) {
          var intent = normalizeIntent(intentValue, binding);
          if (intent.action !== 'APPLY_SLOT') {
            fail('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED');
          }
          return intent;
        });
        if (new Set(intents.map(function (intent) { return intent.slotId; })).size
          !== intents.length) fail(code);
        var input = {
          binding: clone(binding),
          intents: clone(intents),
          assignmentStartOrdinal: nonNegativeInteger(
            value.assignmentStartOrdinal,
            MAX_ASSIGNMENT_ORDINAL,
            code,
          ),
          idempotencyKey: identifier(value.idempotencyKey, 16, 200, code),
        };
        if (input.assignmentStartOrdinal + intents.length > 500) fail(code);
        return send(
          MESSAGE_TYPES.ASSIGN_APPROVED_OUTPUT,
          input,
          function (data) { return normalizeAssignmentData(data, binding, input); },
        );
      },

      clear: function (bindingValue) {
        var binding = pin(bindingValue);
        return send(
          MESSAGE_TYPES.CLEAR,
          { binding: clone(binding) },
          function (data) {
            var result = publicData(data);
            if (!exactKeys(result, ['cleared']) || result.cleared !== true) {
              fail('SS_ERP_HOSTED_WORKBENCH_RESPONSE_INVALID');
            }
            return deepFreeze(result);
          },
        );
      },
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    MAXIMUM_PREVIEW_CLOCK_SKEW_MS: MAXIMUM_PREVIEW_CLOCK_SKEW_MS,
    BINDING_KEYS: BINDING_KEYS,
    GALLERY_GOALS: GALLERY_GOALS,
    MESSAGE_TYPES: MESSAGE_TYPES,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
