(function exposeHostedAiImageSuiteWorkbenchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-hosted-ai-image-suite-workbench-client/v1';
  var MODE_LOCK_VERSION = 'extension-hosted-ai-image-mode-lock/v1';
  var PLAN_VERSION = 'extension-hosted-ai-image-plan/v1';
  var PLAN_CREATE_VERSION = 'extension-hosted-ai-image-plan-create/v1';
  var PLAN_REVIEW_VERSION = 'extension-hosted-ai-image-plan-review/v1';
  // Wire values mirror the ai-media-planning owner; contract tests enforce parity.
  var GALLERY_GOALS = Object.freeze(['scene', 'detail', 'function', 'fitment', 'spec', 'package', 'poster']);
  var ADAPTER_VERSION = 'hosted-ai-image-suite-workbench-adapter/v1';
  var INTENT_VERSION = 'extension-ai-image-suite-intent-witness/v1';
  var PREVIEW_VERSION = 'extension-hosted-ai-image-suite-candidate-preview-channel/v1';
  var ASSIGNMENT_VERSION = 'extension-hosted-ai-image-listing-assignment/v2';
  var MODE_LOCK_PATH = '/api/extension-device/source-workbench/hosted-mode-lock';
  var PLAN_PATH = '/api/extension-device/source-workbench/plans';
  var ASSIGNMENT_PATH =
    '/api/extension-device/source-workbench/ai-image-suite/listing-assignments';
  var MAX_COST_CENTS = 10000000;
  var BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion',
  ]);
  var PREVIEW_BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion', 'planId', 'planVersionId', 'planRevision',
    'suiteId', 'suiteRevision', 'slotId', 'slotRevision', 'workflowId',
    'workflowRevision', 'outputAssetId',
  ]);
  var FORBIDDEN_KEYS = Object.freeze([
    'url', 'previewurl', 'preview_url', 'provider', 'providerid', 'provider_id',
    'providerorigin', 'provider_origin', 'providerendpoint', 'provider_endpoint',
    'providerrequestid', 'provider_request_id', 'model', 'modelid', 'model_id',
    'prompt', 'prompthash', 'prompt_hash', 'prompttext', 'prompt_text',
    'prompttemplate', 'prompt_template', 'apikey', 'api_key', 'secretkey',
    'secret_key', 'authorization', 'storagebackend', 'storage_backend',
    'storagekey', 'storage_key', 'storageid', 'storage_id', 'jobid', 'job_id',
    'reservationid', 'reservation_id', 'settlementid', 'settlement_id',
    'billingid', 'billing_id',
  ]);

  function clientError(code) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteWorkbenchClientError';
    error.code = code;
    return error;
  }

  function unknownOutcomeError(code, operation) {
    var error = clientError(code);
    error.outcome = 'UNKNOWN_OUTCOME';
    error.automaticRetryAllowed = false;
    error.operation = operation;
    return error;
  }

  function requestOutcomeUnknown(error) {
    return Boolean(error && typeof error === 'object'
      && (error.requestDispatched === true || error.outcome === 'UNKNOWN_OUTCOME'));
  }

  function mutationResponseProvesRejection(response) {
    if (!response || typeof response !== 'object') return false;
    if (['unpaired', 'scope_required', 'authorization_required'].includes(response.state)) {
      return true;
    }
    if (response.state === 'http_error'
      && Number.isSafeInteger(response.status)
      && response.status >= 500) return false;
    var body = response.state === 'response' || response.state === 'http_error'
      ? record(response.body) : null;
    return Boolean(body && body.code === 0);
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

  function normalizeGalleryGoals(value, code) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 1 || value.length > GALLERY_GOALS.length
      || value.some(function (goal) { return !GALLERY_GOALS.includes(goal); })
      || new Set(value).size !== value.length) fail(code);
    return value.slice();
  }

  function normalizeCandidateMediaKeys(value, code) {
    if (value === undefined) return undefined;
    code = code || 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
    if (!Array.isArray(value) || value.length < 1 || value.length > 25 || new Set(value).size !== value.length) fail(code);
    return Object.freeze(value.map(function (key) {
      var normalized = text(key, 500, code);
      if (/(?:javascript|ws|wss):|\b[a-z][a-z0-9+.-]*:\/\/|www\./iu.test(normalized)) fail(code);
      return normalized;
    }));
  }

  function normalizeCreativeBrief(value, code) {
    if (value === undefined) return undefined;
    code = code || 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
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

  function exactPriceKeys(value, keys) {
    var item = record(value);
    if (!item) return false;
    var hasCurrency = Object.prototype.hasOwnProperty.call(item, 'currency');
    var isCny = /^ai-image-suite-price-cny\/v1:[a-f0-9]{32}$/.test(item.pricingVersion);
    if (!isCny && /^ai-image-suite-price-cny\//.test(item.pricingVersion)) return false;
    return exactKeys(item, hasCurrency ? keys.concat('currency') : keys)
      && (isCny ? item.currency === 'CNY' : !hasCurrency || item.currency === 'USD');
  }

  function hasControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 31 || code === 127) return true;
    }
    return false;
  }

  function text(value, maximum, code) {
    if (typeof value !== 'string'
      || value.length < 1
      || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)
      || /(?:https?|ftp|file|blob|data):/iu.test(value)
      || value.includes('?')
      || value.includes('#')) fail(code);
    return value;
  }

  function nullableText(value, maximum, code) {
    return value === null ? null : text(value, maximum, code);
  }

  function pathIdentifier(value, code) {
    var result = text(value, 200, code);
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

  function sha256(value, code) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
    return value;
  }

  function cost(value, positive, code) {
    if (!Number.isSafeInteger(value)
      || value < (positive ? 1 : 0)
      || value > MAX_COST_CENTS) fail(code);
    return value;
  }

  function canonicalTimestamp(value, nullable, code) {
    if (nullable && value === null) return null;
    var textValue = text(value, 100, code);
    var parsed = new Date(textValue);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== textValue) fail(code);
    return textValue;
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

  function deeplyFrozen(value) {
    if (!value || typeof value !== 'object') return true;
    if (!Object.isFrozen(value)) return false;
    return Object.values(value).every(deeplyFrozen);
  }

  function sameValue(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left)
        && Array.isArray(right)
        && left.length === right.length
        && left.every(function (value, index) { return sameValue(value, right[index]); });
    }
    var leftRecord = record(left);
    var rightRecord = record(right);
    if (!leftRecord || !rightRecord) return false;
    var leftKeys = Object.keys(leftRecord).sort();
    var rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every(function (key, index) {
        return key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]);
      });
  }

  function leakFree(value, ancestors, path) {
    if (!ancestors) ancestors = new Set();
    if (!path) path = [];
    // Only the versioned user direction is public; raw Provider prompts remain forbidden.
    if (path.length === 3 && path[0] === 'plan'
      && ['currentVersion', 'approvedVersion'].includes(path[1]) && path[2] === 'creativeBrief') {
      try {
        normalizeCreativeBrief(value, 'SS_ERP_HOSTED_WORKBENCH_PLAN_RESPONSE_INVALID');
        return value !== undefined;
      } catch { return false; }
    }
    if (typeof value === 'string') {
      return !/(?:https?|ftp|file|blob|data):/iu.test(value)
        && !/(?:bearer\s+|api[_-]?key\s*[:=]|authorization\s*[:=])/iu.test(value)
        && !/^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(value);
    }
    if (!value || typeof value !== 'object') return true;
    if (ancestors.has(value)) return false;
    ancestors.add(value);
    var valid = Array.isArray(value)
      ? value.every(function (item, index) { return leakFree(item, ancestors, path.concat(index)); })
      : Object.entries(value).every(function (entry) {
        return !FORBIDDEN_KEYS.includes(entry[0].toLowerCase())
          && leakFree(entry[1], ancestors, path.concat(entry[0]));
      });
    ancestors.delete(value);
    return valid;
  }

  function normalizeBinding(value, code) {
    if (!exactKeys(value, BINDING_KEYS)) fail(code);
    return deepFreeze({
      snapshotId: text(value.snapshotId, 200, code),
      supplyGoodsId: text(value.supplyGoodsId, 200, code),
      shopId: text(value.shopId, 200, code),
      listingWorkflowId: text(value.listingWorkflowId, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
    });
  }

  function sameBinding(left, right) {
    return Boolean(left && right)
      && BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function bindingQuery(binding) {
    return new URLSearchParams({
      snapshotId: binding.snapshotId,
      supplyGoodsId: binding.supplyGoodsId,
      shopId: binding.shopId,
      listingWorkflowId: binding.listingWorkflowId,
      draftRevision: String(binding.draftRevision),
      draftVersion: String(binding.draftVersion),
    }).toString();
  }

  function normalizeModeLockResponse(response, expectedBinding) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_MODE_LOCK_RESPONSE_INVALID';
    var envelope = response && response.state === 'response' ? record(response.body) : null;
    if (!exactKeys(envelope, ['code', 'data'])
      || envelope.code !== 1
      || !exactKeys(envelope.data, [
        'contractVersion', 'context', 'state', 'hostedExecutionEnabled',
      ])
      || envelope.data.contractVersion !== MODE_LOCK_VERSION
      || !['NO_SUITE', 'HAS_SUITE'].includes(envelope.data.state)
      || typeof envelope.data.hostedExecutionEnabled !== 'boolean') fail(code);
    var context = normalizeBinding(envelope.data.context, code);
    if (!sameBinding(context, expectedBinding)) fail(code);
    var result = {
      contractVersion: MODE_LOCK_VERSION,
      context: clone(context),
      state: envelope.data.state,
      hostedExecutionEnabled: envelope.data.hostedExecutionEnabled,
    };
    if (!leakFree(result)) fail(code);
    return deepFreeze(result);
  }

  function validOwnership(value, code) {
    if (!exactKeys(value, ['level', 'key'])
      || !['sku', 'compatibility_group'].includes(value.level)) fail(code);
    return {
      level: value.level,
      key: text(value.key, 500, code),
    };
  }

  function validApplicableSkuKeys(value, ownership, code) {
    if (!Array.isArray(value)
      || value.length < 1
      || value.length > 500
      || new Set(value).size !== value.length) fail(code);
    var keys = value.map(function (skuKey) { return text(skuKey, 500, code); });
    if (keys.some(function (skuKey, index) {
      return index > 0 && keys[index - 1] >= skuKey;
    })
      || ownership.level === 'sku'
        && (keys.length !== 1 || keys[0] !== ownership.key)) fail(code);
    return keys;
  }

  function validPlanReference(value, code) {
    if (!exactKeys(value, ['candidateId'])) fail(code);
    return { candidateId: text(value.candidateId, 500, code) };
  }

  function validPlanVersion(value, context, code) {
    if (value === null) return null;
    var keys = [
      'id', 'version', 'sourceCaptureSnapshotId', 'sourceSchemaVersion',
      'planSchemaVersion', 'plannerVersion', 'mode', 'slots', 'createdAt',
    ];
    if (record(value) && Object.prototype.hasOwnProperty.call(value, 'creativeBrief')) keys.push('creativeBrief');
    if (!exactKeys(value, keys)
      || !['RULE_BASED', 'MODEL_ASSISTED'].includes(value.mode)
      || !Array.isArray(value.slots)
      || value.slots.length > 500) fail(code);
    var slots = value.slots.map(function (slot) {
      if (!exactKeys(slot, [
        'slotKey', 'goal', 'status', 'aspectRatio', 'ownership', 'references',
      ])
        || !Array.isArray(slot.references)
        || slot.references.length > 4) fail(code);
      return {
        slotKey: text(slot.slotKey, 500, code),
        goal: text(slot.goal, 200, code),
        status: text(slot.status, 100, code),
        aspectRatio: text(slot.aspectRatio, 50, code),
        ownership: validOwnership(slot.ownership, code),
        references: slot.references.map(function (reference) {
          return validPlanReference(reference, code);
        }),
      };
    });
    if (new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length) {
      fail(code);
    }
    var snapshotId = text(value.sourceCaptureSnapshotId, 200, code);
    if (snapshotId !== context.snapshotId) fail(code);
    return {
      id: text(value.id, 200, code),
      version: positiveInteger(value.version, code),
      sourceCaptureSnapshotId: snapshotId,
      sourceSchemaVersion: text(value.sourceSchemaVersion, 100, code),
      planSchemaVersion: text(value.planSchemaVersion, 100, code),
      plannerVersion: text(value.plannerVersion, 100, code),
      mode: value.mode,
      slots: slots,
      createdAt: canonicalTimestamp(value.createdAt, false, code),
      ...(keys.includes('creativeBrief') ? { creativeBrief: normalizeCreativeBrief(value.creativeBrief, code) } : {}),
    };
  }

  function validPlanView(value, context, expectedPlanId, code) {
    if (value === null) return null;
    if (!exactKeys(value, [
      'id', 'revision', 'latestVersion', 'currentVersionId', 'approvedVersionId',
      'reviewStatus', 'sourceCurrent', 'stale', 'currentVersion', 'approvedVersion',
      'reviewedAt', 'updatedAt',
    ])
      || !['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'].includes(value.reviewStatus)
      || value.sourceCurrent !== true
      || value.stale !== false) fail(code);
    var id = text(value.id, 200, code);
    if (expectedPlanId && id !== expectedPlanId) fail(code);
    var currentVersionId = text(value.currentVersionId, 200, code);
    var approvedVersionId = nullableText(value.approvedVersionId, 200, code);
    var currentVersion = validPlanVersion(value.currentVersion, context, code);
    var approvedVersion = validPlanVersion(value.approvedVersion, context, code);
    if (!currentVersion || currentVersion.id !== currentVersionId
      || (approvedVersionId === null) !== (approvedVersion === null)
      || (approvedVersion && approvedVersion.id !== approvedVersionId)) fail(code);
    return {
      id: id,
      revision: positiveInteger(value.revision, code),
      latestVersion: positiveInteger(value.latestVersion, code),
      currentVersionId: currentVersionId,
      approvedVersionId: approvedVersionId,
      reviewStatus: value.reviewStatus,
      sourceCurrent: true,
      stale: false,
      currentVersion: currentVersion,
      approvedVersion: approvedVersion,
      reviewedAt: canonicalTimestamp(value.reviewedAt, true, code),
      updatedAt: canonicalTimestamp(value.updatedAt, false, code),
    };
  }

  function normalizePlanResponse(response, expectedBinding, options) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_PLAN_RESPONSE_INVALID';
    var envelope = response && response.state === 'response' ? record(response.body) : null;
    if (!exactKeys(envelope, ['code', 'replayed', 'data'])
      || envelope.code !== 1
      || typeof envelope.replayed !== 'boolean'
      || !exactKeys(envelope.data, ['contractVersion', 'policyRevision', 'context', 'plan'])
      || envelope.data.contractVersion !== PLAN_VERSION) fail(code);
    var context = normalizeBinding(envelope.data.context, code);
    if (!sameBinding(context, expectedBinding)) fail(code);
    var plan = validPlanView(envelope.data.plan, context, options.planId || null, code);
    if (options.requirePlan && !plan) fail(code);
    var result = {
      contractVersion: CONTRACT_VERSION,
      replayed: envelope.replayed,
      policyRevision: positiveInteger(envelope.data.policyRevision, code),
      binding: clone(context),
      plan: plan,
    };
    if (!leakFree(result)) fail(code);
    return deepFreeze(result);
  }

  function validIntent(value, binding, action, slotId, decision, code) {
    if (value === null) return null;
    if (!exactKeys(value, [
      'version', 'context', 'authorityHash', 'action', 'slotId', 'decision',
      'commandTemplate',
    ])
      || value.version !== INTENT_VERSION
      || value.action !== action
      || value.slotId !== slotId
      || value.decision !== decision
      || !sameBinding(normalizeBinding(value.context, code), binding)
      || !record(value.commandTemplate)) fail(code);
    sha256(value.authorityHash, code);
    return value;
  }

  function validProjectedPlan(value, binding, code) {
    if (value === null) return null;
    if (!exactKeys(value, [
      'id', 'versionId', 'revision', 'status', 'skuKey', 'previewHash', 'slots',
      'startIntent',
    ])
      || value.status !== 'APPROVED'
      || !Array.isArray(value.slots)
      || value.slots.length > 500) fail(code);
    var slots = value.slots.map(function (slot) {
      if (!exactKeys(slot, [
        'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
        'estimatedCostCents', 'maximumCostCents',
      ])) fail(code);
      var estimated = cost(slot.estimatedCostCents, false, code);
      var maximum = cost(slot.maximumCostCents, false, code);
      if (maximum < estimated) fail(code);
      var ownership = validOwnership(slot.ownership, code);
      return {
        ordinal: nonNegativeInteger(slot.ordinal, 499, code),
        slotKey: text(slot.slotKey, 500, code),
        goal: text(slot.goal, 200, code),
        ownership: ownership,
        applicableSkuKeys: validApplicableSkuKeys(slot.applicableSkuKeys, ownership, code),
        estimatedCostCents: estimated,
        maximumCostCents: maximum,
      };
    });
    if (new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length) {
      fail(code);
    }
    return {
      id: text(value.id, 200, code),
      versionId: text(value.versionId, 200, code),
      revision: positiveInteger(value.revision, code),
      status: 'APPROVED',
      skuKey: nullableText(value.skuKey, 500, code),
      previewHash: sha256(value.previewHash, code),
      slots: slots,
      startIntent: validIntent(value.startIntent, binding, 'START', null, null, code),
    };
  }

  function validProjectedOutput(value, previewAvailable, code) {
    if (value === null) {
      if (previewAvailable) fail(code);
      return null;
    }
    if (!previewAvailable || !exactKeys(value, ['assetId', 'mimeType', 'width', 'height'])
      || !['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType)
      || !(value.width === null || Number.isSafeInteger(value.width) && value.width > 0)
      || !(value.height === null || Number.isSafeInteger(value.height) && value.height > 0)) {
      fail(code);
    }
    return {
      assetId: text(value.assetId, 200, code),
      mimeType: value.mimeType,
      width: value.width,
      height: value.height,
    };
  }

  function validProjectedApplication(value, code) {
    if (value === null) return null;
    if (!exactKeys(value, ['state', 'target', 'mode', 'writesStoreDraft'])
      || !['APPLIED', 'ROLLED_BACK'].includes(value.state)
      || value.target !== 'ERP_SOURCE_PRODUCT'
      || value.mode !== 'append'
      || value.writesStoreDraft !== false) fail(code);
    return clone(value);
  }

  function validProjectedSlot(value, binding, code) {
    if (!exactKeys(value, [
      'id', 'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
      'status', 'attempt', 'revision', 'estimatedCostCents', 'maximumCostCents',
      'workflowId', 'workflowRevision', 'reviewStatus', 'previewAvailable', 'output',
      'application', 'retryIntent', 'reviewIntents', 'applyIntent',
    ])
      || !['PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED',
        'CANCEL_REQUESTED', 'CANCELLED'].includes(value.status)
      || !['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'].includes(value.reviewStatus)
      || typeof value.previewAvailable !== 'boolean') fail(code);
    var estimated = cost(value.estimatedCostCents, false, code);
    var maximum = cost(value.maximumCostCents, false, code);
    if (maximum < estimated) fail(code);
    var workflowId = nullableText(value.workflowId, 200, code);
    var workflowRevision = value.workflowRevision === null
      ? null
      : positiveInteger(value.workflowRevision, code);
    if ((workflowId === null) !== (workflowRevision === null)) fail(code);
    var id = text(value.id, 200, code);
    var ownership = validOwnership(value.ownership, code);
    var reviewIntents = value.reviewIntents;
    if (reviewIntents !== null) {
      if (!exactKeys(reviewIntents, ['APPROVE', 'REJECT'])) fail(code);
      reviewIntents = {
        APPROVE: validIntent(
          reviewIntents.APPROVE,
          binding,
          'REVIEW_SLOT',
          id,
          'APPROVE',
          code,
        ),
        REJECT: validIntent(
          reviewIntents.REJECT,
          binding,
          'REVIEW_SLOT',
          id,
          'REJECT',
          code,
        ),
      };
    }
    return {
      id: id,
      ordinal: nonNegativeInteger(value.ordinal, 499, code),
      slotKey: text(value.slotKey, 500, code),
      goal: text(value.goal, 200, code),
      ownership: ownership,
      applicableSkuKeys: validApplicableSkuKeys(value.applicableSkuKeys, ownership, code),
      status: value.status,
      attempt: nonNegativeInteger(value.attempt, 1000, code),
      revision: positiveInteger(value.revision, code),
      estimatedCostCents: estimated,
      maximumCostCents: maximum,
      workflowId: workflowId,
      workflowRevision: workflowRevision,
      reviewStatus: value.reviewStatus,
      previewAvailable: value.previewAvailable,
      output: validProjectedOutput(value.output, value.previewAvailable, code),
      application: validProjectedApplication(value.application, code),
      retryIntent: validIntent(value.retryIntent, binding, 'RETRY_SLOT', id, null, code),
      reviewIntents: reviewIntents,
      applyIntent: validIntent(value.applyIntent, binding, 'APPLY_SLOT', id, null, code),
    };
  }

  function validProjectedSuite(value, binding, code) {
    if (value === null) return null;
    if (!exactKeys(value, [
      'id', 'status', 'revision', 'itemCount', 'estimatedCostCents',
      'maximumCostCents', 'continueIntent', 'cancelIntent', 'slots',
    ])
      || !['PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_FAILURE',
        'CANCEL_REQUESTED', 'CANCELLED'].includes(value.status)
      || !Array.isArray(value.slots)
      || value.slots.length > 500) fail(code);
    var itemCount = positiveInteger(value.itemCount, code);
    if (itemCount !== value.slots.length) fail(code);
    var estimated = cost(value.estimatedCostCents, false, code);
    var maximum = cost(value.maximumCostCents, true, code);
    if (maximum < estimated) fail(code);
    var id = text(value.id, 200, code);
    var slots = value.slots.map(function (slot) {
      return validProjectedSlot(slot, binding, code);
    });
    if (new Set(slots.map(function (slot) { return slot.id; })).size !== slots.length
      || new Set(slots.map(function (slot) { return slot.slotKey; })).size !== slots.length) {
      fail(code);
    }
    return {
      id: id,
      status: value.status,
      revision: positiveInteger(value.revision, code),
      itemCount: itemCount,
      estimatedCostCents: estimated,
      maximumCostCents: maximum,
      continueIntent: validIntent(value.continueIntent, binding, 'CONTINUE', null, null, code),
      cancelIntent: validIntent(value.cancelIntent, binding, 'CANCEL', null, null, code),
      slots: slots,
    };
  }

  function validateProjected(value, binding, rawProjection) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID';
    if (!exactKeys(value, [
      'contractVersion', 'executionMode', 'binding', 'sourceBinding', 'applyPolicy',
      'quote', 'plan', 'suite',
    ])
      || value.contractVersion !== ADAPTER_VERSION
      || value.executionMode !== 'ERP_HOSTED'
      || !exactKeys(value.binding, [
        'shopId', 'workflowId', 'draftRevision', 'draftVersion',
      ])
      || value.binding.shopId !== binding.shopId
      || value.binding.workflowId !== binding.listingWorkflowId
      || value.binding.draftRevision !== binding.draftRevision
      || value.binding.draftVersion !== binding.draftVersion
      || !exactKeys(value.sourceBinding, ['snapshotId', 'supplyGoodsId', 'skuKey'])
      || value.sourceBinding.snapshotId !== binding.snapshotId
      || value.sourceBinding.supplyGoodsId !== binding.supplyGoodsId
      || !(value.sourceBinding.skuKey === null
        || typeof value.sourceBinding.skuKey === 'string')
      || !exactKeys(value.applyPolicy, ['target', 'mode', 'writesStoreDraft'])
      || value.applyPolicy.target !== 'ERP_SOURCE_PRODUCT'
      || value.applyPolicy.mode !== 'append'
      || value.applyPolicy.writesStoreDraft !== false
      || !deeplyFrozen(value)
      || !leakFree(value)) fail(code);
    if (value.quote !== null) {
      if (!exactPriceKeys(value.quote, [
        'pricingVersion', 'itemCount', 'estimatedCostCents', 'maximumCostCents',
      ])) fail(code);
      text(value.quote.pricingVersion, 100, code);
      positiveInteger(value.quote.itemCount, code);
      var estimated = cost(value.quote.estimatedCostCents, false, code);
      var maximum = cost(value.quote.maximumCostCents, true, code);
      if (maximum < estimated) fail(code);
    }
    var sourceSkuKey = nullableText(value.sourceBinding.skuKey, 500, code);
    var plan = validProjectedPlan(value.plan, binding, code);
    var suite = validProjectedSuite(value.suite, binding, code);
    var rawPlan = record(rawProjection && rawProjection.plan);
    var rawPreview = rawPlan && record(rawPlan.preview);
    if ((plan === null) !== (value.quote === null)
      || (suite !== null && plan === null)
      || (plan && plan.skuKey !== sourceSkuKey)
      || (value.quote && value.quote.itemCount !== plan.slots.length)
      || (value.quote === null) !== (rawPreview === null)
      || (value.quote && (
        value.quote.pricingVersion !== rawPreview.pricingVersion
        || (value.quote.currency || 'USD') !== (rawPreview.currency || 'USD')
        || value.quote.itemCount !== rawPreview.itemCount
        || value.quote.estimatedCostCents !== rawPreview.estimatedCostCents
        || value.quote.maximumCostCents !== rawPreview.maximumCostCents
        || plan.previewHash !== rawPreview.hash
      ))) fail(code);
    return value;
  }

  function witnesses(projection) {
    var values = [];
    if (projection.plan && projection.plan.startIntent) values.push(projection.plan.startIntent);
    if (projection.suite) {
      if (projection.suite.continueIntent) values.push(projection.suite.continueIntent);
      if (projection.suite.cancelIntent) values.push(projection.suite.cancelIntent);
      projection.suite.slots.forEach(function (slot) {
        if (slot.retryIntent) values.push(slot.retryIntent);
        if (slot.applyIntent) values.push(slot.applyIntent);
        if (slot.reviewIntents) {
          values.push(slot.reviewIntents.APPROVE, slot.reviewIntents.REJECT);
        }
      });
    }
    return values;
  }

  function validPreviewTicket(value) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_PREVIEW_INVALID';
    if (!exactKeys(value, [
      'contractVersion', 'channelName', 'previewTicket', 'expiresAt', 'metadata',
    ])
      || value.contractVersion !== PREVIEW_VERSION
      || !/^ss-erp:hosted-candidate-preview:[a-f0-9]{48}$/u.test(value.channelName)
      || !/^hp_[a-f0-9]{48}$/u.test(value.previewTicket)
      || !exactKeys(value.metadata, ['mimeType', 'byteLength'])
      || value.metadata.mimeType !== 'image/png'
      || value.metadata.byteLength !== null
      || !leakFree(value)) fail(code);
    canonicalTimestamp(value.expiresAt, false, code);
    return deepFreeze(clone(value));
  }

  function validAssignmentResponse(response, expected, expectedAssignments) {
    var code = 'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_RESPONSE_INVALID';
    var envelope = response && response.state === 'response' ? record(response.body) : null;
    var data = exactKeys(envelope, ['code', 'data']) && envelope.code === 1
      ? envelope.data
      : null;
    if (!exactKeys(data, [
      'contractVersion', 'batchId', 'replayed', 'shopId', 'listingWorkflowId',
      'sourceDraftRevision', 'sourceDraftVersion', 'boundDraftRevision',
      'boundDraftVersion', 'assignments', 'validationStatus', 'publishReadiness',
    ])
      || data.contractVersion !== ASSIGNMENT_VERSION
      || typeof data.replayed !== 'boolean'
      || data.shopId !== expected.shopId
      || data.listingWorkflowId !== expected.listingWorkflowId
      || data.sourceDraftRevision !== expected.expectedDraftRevision
      || data.sourceDraftVersion !== expected.expectedDraftVersion
      || data.boundDraftRevision !== expected.expectedDraftRevision + 1
      || data.boundDraftVersion !== expected.expectedDraftVersion + 1
      || !Array.isArray(data.assignments)
      || data.assignments.length !== expectedAssignments.length
      || data.validationStatus !== 'STALE'
      || data.publishReadiness !== 'STALE'
      || !leakFree(data)) fail(code);
    text(data.batchId, 200, code);
    data.assignments.forEach(function (assignment, index) {
      var expectedAssignment = expectedAssignments[index];
      if (!exactKeys(assignment, [
        'assignmentId', 'skuKey', 'slotKey', 'assignmentScope',
        'assignmentOrdinal', 'assetId',
      ])
        || assignment.skuKey !== expectedAssignment.skuKey
        || assignment.slotKey !== expectedAssignment.slotKey
        || assignment.assignmentScope !== expectedAssignment.assignmentScope
        || assignment.assignmentOrdinal !== expected.assignmentStartOrdinal + index
        || assignment.assetId !== expectedAssignment.outputAssetId) fail(code);
      text(assignment.assignmentId, 200, code);
      text(assignment.skuKey, 500, code);
      text(assignment.slotKey, 1_024, code);
      text(assignment.assetId, 500, code);
    });
    return deepFreeze(clone(data));
  }

  function createClient(options) {
    var transport = options && options.transport;
    var listingClient = options && options.listingClient;
    var adapter = options && options.adapter;
    var previewBridge = options && options.previewBridge;
    if (!transport
      || typeof transport.get !== 'function'
      || typeof transport.post !== 'function'
      || !listingClient
      || typeof listingClient.getAiImageSuite !== 'function'
      || typeof listingClient.executeAiImageSuiteCommand !== 'function'
      || !adapter
      || typeof adapter.project !== 'function'
      || !previewBridge
      || typeof previewBridge.open !== 'function'
      || typeof previewBridge.revoke !== 'function') {
      throw clientError('SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }

    var pinnedBinding = null;
    var current = null;
    var previewBindings = [];

    function pin(value) {
      var binding = normalizeBinding(value, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      if (pinnedBinding && !sameBinding(pinnedBinding, binding)) {
        fail('SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE');
      }
      if (!pinnedBinding) pinnedBinding = binding;
      return binding;
    }

    function revokePreviews() {
      previewBindings.forEach(function (binding) {
        try { previewBridge.revoke(binding); } catch {}
      });
      previewBindings = [];
    }

    function clearCurrent() {
      revokePreviews();
      current = null;
    }

    async function request(method, path, body, requiredScope, unknownCode, operation) {
      try {
        return method === 'GET'
          ? await transport.get(path, { requiredScope: requiredScope })
          : await transport.post(path, body, { requiredScope: requiredScope });
      } catch (error) {
        if (unknownCode && requestOutcomeUnknown(error)) {
          throw unknownOutcomeError(unknownCode, operation);
        }
        fail('SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED');
      }
    }

    function exactCurrentWitness(value) {
      if (!current || !record(value) || !deeplyFrozen(value)) {
        fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
      }
      var match = witnesses(current.projected).find(function (candidate) {
        return sameValue(candidate, value);
      });
      if (!match) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
      return match;
    }

    function currentRawSlot(slotId) {
      var suite = current && current.rawProjection && current.rawProjection.suite;
      var slot = suite && Array.isArray(suite.slots)
        ? suite.slots.find(function (candidate) { return candidate.id === slotId; })
        : null;
      if (!slot) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
      return slot;
    }

    return Object.freeze({
      getModeLock: async function (value) {
        var binding = pin(value);
        var response = await request(
          'GET',
          MODE_LOCK_PATH + '?' + bindingQuery(binding),
          null,
          'listing:review',
        );
        return normalizeModeLockResponse(response, binding);
      },

      createPlan: async function (value) {
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
        var idempotencyKey = text(value.idempotencyKey, 128, code);
        if (idempotencyKey.length < 8) fail(code);
        clearCurrent();
        var response = await request('POST', PLAN_PATH, {
          contractVersion: PLAN_CREATE_VERSION,
          context: clone(binding),
          idempotencyKey: idempotencyKey,
          ...(galleryGoals === undefined ? {} : { galleryGoals: galleryGoals }),
          ...(creativeBrief === undefined ? {} : { creativeBrief: clone(creativeBrief) }),
          ...(candidateMediaKeys === undefined ? {} : { candidateMediaKeys: candidateMediaKeys }),
        }, 'media:execute');
        return normalizePlanResponse(response, binding, { requirePlan: true });
      },

      getCurrentPlan: async function (value) {
        var binding = pin(value);
        var response = await request(
          'GET',
          PLAN_PATH + '/current?' + bindingQuery(binding),
          null,
          'listing:review',
        );
        return normalizePlanResponse(response, binding, { requirePlan: false });
      },

      getPlan: async function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, ['binding', 'planId'])) fail(code);
        var binding = pin(value.binding);
        var planId = pathIdentifier(value.planId, code);
        var response = await request(
          'GET',
          PLAN_PATH + '/' + encodeURIComponent(planId) + '?' + bindingQuery(binding),
          null,
          'listing:review',
        );
        return normalizePlanResponse(response, binding, {
          requirePlan: true,
          planId: planId,
        });
      },

      reviewPlan: async function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, [
          'binding', 'planId', 'expectedRevision', 'operationKey', 'decision', 'note',
        ])
          || !['APPROVE', 'REJECT'].includes(value.decision)
          || !(value.note === null
            || typeof value.note === 'string'
              && value.note.length <= 2000
              && !hasControlCharacter(value.note))) fail(code);
        var binding = pin(value.binding);
        var planId = pathIdentifier(value.planId, code);
        var operationKey = text(value.operationKey, 128, code);
        if (operationKey.length < 8) fail(code);
        clearCurrent();
        var response = await request(
          'POST',
          PLAN_PATH + '/' + encodeURIComponent(planId) + '/review',
          {
            contractVersion: PLAN_REVIEW_VERSION,
            context: clone(binding),
            expectedRevision: positiveInteger(value.expectedRevision, code),
            operationKey: operationKey,
            decision: value.decision,
            note: value.note,
          },
          'listing:review',
        );
        return normalizePlanResponse(response, binding, {
          requirePlan: true,
          planId: planId,
        });
      },

      loadSuite: async function (value) {
        var binding = pin(value);
        var loaded;
        var rawProjection;
        var projected;
        clearCurrent();
        try {
          loaded = await listingClient.getAiImageSuite(clone(binding));
          if (!exactKeys(loaded, ['state', 'projection']) || loaded.state !== 'ready') {
            fail('SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID');
          }
          rawProjection = deepFreeze(clone(loaded.projection));
          projected = adapter.project(rawProjection);
          validateProjected(projected, binding, rawProjection);
        } catch (error) {
          if (error && error.code === 'SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE') throw error;
          fail('SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID');
        }
        current = {
          binding: binding,
          rawProjection: rawProjection,
          projected: projected,
        };
        return projected;
      },

      executeIntent: async function (intent, confirmation) {
        var witness = exactCurrentWitness(intent);
        if (witness.action === 'APPLY_SLOT') {
          fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
        }
        var requiresCost = witness.action === 'START' || witness.action === 'RETRY_SLOT';
        var expectedMaximum = witness.action === 'START'
          ? witness.commandTemplate.acceptedMaximumCostCents
          : witness.action === 'RETRY_SLOT'
            ? witness.commandTemplate.acceptedAdditionalMaximumCostCents
            : null;
        if (requiresCost) {
          if (!exactKeys(confirmation, ['confirmed', 'maximumCostCents'])
            || confirmation.confirmed !== true
            || confirmation.maximumCostCents !== expectedMaximum) {
            fail('SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED');
          }
        } else if (confirmation !== null && confirmation !== undefined) {
          fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
        }
        var input = {
          projection: current.rawProjection,
          action: witness.action,
          costConfirmed: requiresCost,
        };
        if (witness.slotId !== null) input.slotId = witness.slotId;
        if (witness.decision !== null) input.decision = witness.decision;
        var result;
        try {
          result = await listingClient.executeAiImageSuiteCommand(input);
        } catch (error) {
          if (requestOutcomeUnknown(error)) {
            throw unknownOutcomeError(
              'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
              'EXECUTE_INTENT',
            );
          }
          fail('SS_ERP_HOSTED_WORKBENCH_REQUEST_FAILED');
        }
        if (!exactKeys(result, ['state', 'replay', 'action'])
          || result.state !== 'completed'
          || typeof result.replay !== 'boolean'
          || result.action !== witness.action
          || !leakFree(result)) {
          fail('SS_ERP_HOSTED_WORKBENCH_SUITE_RESPONSE_INVALID');
        }
        clearCurrent();
        return deepFreeze({
          contractVersion: CONTRACT_VERSION,
          state: 'completed',
          replayed: result.replay,
          action: result.action,
        });
      },

      openPreview: async function (slotIdValue) {
        if (!current) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
        var slotId = text(
          slotIdValue,
          200,
          'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
        );
        var rawSlot = currentRawSlot(slotId);
        var projectedSlot = current.projected.suite
          && current.projected.suite.slots.find(function (slot) { return slot.id === slotId; });
        var raw = current.rawProjection;
        if (!projectedSlot
          || !projectedSlot.previewAvailable
          || !projectedSlot.output
          || !raw.commandAuthority
          || !raw.plan
          || !raw.suite
          || !rawSlot.output
          || rawSlot.output.id !== projectedSlot.output.assetId
          || rawSlot.workflowId === null
          || rawSlot.workflowRevision === null) {
          fail('SS_ERP_HOSTED_WORKBENCH_PREVIEW_INVALID');
        }
        var binding = deepFreeze({
          snapshotId: raw.context.snapshotId,
          supplyGoodsId: raw.context.supplyGoodsId,
          shopId: raw.context.shopId,
          listingWorkflowId: raw.context.listingWorkflowId,
          draftRevision: raw.context.draftRevision,
          draftVersion: raw.context.draftVersion,
          planId: raw.commandAuthority.planId,
          planVersionId: raw.commandAuthority.planVersionId,
          planRevision: raw.commandAuthority.planRevision,
          suiteId: raw.suite.id,
          suiteRevision: raw.suite.revision,
          slotId: rawSlot.id,
          slotRevision: rawSlot.revision,
          workflowId: rawSlot.workflowId,
          workflowRevision: rawSlot.workflowRevision,
          outputAssetId: rawSlot.output.id,
        });
        if (!exactKeys(binding, PREVIEW_BINDING_KEYS)) {
          fail('SS_ERP_HOSTED_WORKBENCH_PREVIEW_INVALID');
        }
        var result;
        try {
          var ticket = await previewBridge.open(binding);
          result = validPreviewTicket(ticket);
        } catch {
          try { previewBridge.revoke(binding); } catch {}
          fail('SS_ERP_HOSTED_WORKBENCH_PREVIEW_INVALID');
        }
        previewBindings.push(binding);
        return result;
      },

      assignApprovedOutputs: async function (value) {
        var code = 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID';
        if (!exactKeys(value, ['intents', 'assignmentStartOrdinal', 'idempotencyKey'])
          || !Array.isArray(value.intents)
          || value.intents.length < 1
          || value.intents.length > 500) fail(code);
        var selectedWitnesses = value.intents.map(function (intent) {
          var witness = exactCurrentWitness(intent);
          if (witness.action !== 'APPLY_SLOT') {
            fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
          }
          return witness;
        });
        if (new Set(selectedWitnesses.map(function (intent) { return intent.slotId; })).size
          !== selectedWitnesses.length) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
        var raw = current.rawProjection;
        var projectedSuite = current.projected.suite;
        var expectedWitnesses = projectedSuite
          ? projectedSuite.slots.flatMap(function (slot) {
            return slot.applyIntent ? [slot.applyIntent] : [];
          })
          : [];
        if (expectedWitnesses.length !== selectedWitnesses.length
          || expectedWitnesses.some(function (expectedIntent) {
            return !selectedWitnesses.some(function (selected) {
              return sameValue(selected, expectedIntent);
            });
          })) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
        if (!raw.commandAuthority
          || !raw.plan
          || !raw.suite
          || !projectedSuite) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
        var expectedAssignments = selectedWitnesses.map(function (witness) {
          var rawSlot = currentRawSlot(witness.slotId);
          var projectedSlot = projectedSuite.slots.find(function (slot) {
            return slot.id === witness.slotId;
          });
          var applicableSkuKeys = projectedSlot && projectedSlot.applicableSkuKeys;
          if (!projectedSlot
            || rawSlot.status !== 'SUCCEEDED'
            || rawSlot.reviewStatus !== 'APPROVED'
            || !rawSlot.output
            || rawSlot.output.id !== witness.commandTemplate.outputAssetId
            || rawSlot.workflowId === null
            || rawSlot.workflowRevision === null
            || !['sku', 'compatibility_group'].includes(rawSlot.ownership.level)
            || rawSlot.slotKey !== projectedSlot.slotKey
            || rawSlot.ownership.level !== projectedSlot.ownership.level
            || rawSlot.ownership.key !== projectedSlot.ownership.key
            || rawSlot.revision !== projectedSlot.revision
            || rawSlot.workflowId !== projectedSlot.workflowId
            || rawSlot.workflowRevision !== projectedSlot.workflowRevision
            || !projectedSlot.output
            || rawSlot.output.id !== projectedSlot.output.assetId
            || !Array.isArray(applicableSkuKeys)
            || applicableSkuKeys.length < 1
            || applicableSkuKeys.length > 50
            || new Set(applicableSkuKeys).size !== applicableSkuKeys.length
            || applicableSkuKeys.some(function (skuKey) {
              return typeof skuKey !== 'string' || skuKey.length < 1 || skuKey.length > 500;
            })
            || rawSlot.ownership.level === 'sku'
              && (applicableSkuKeys.length !== 1
                || applicableSkuKeys[0] !== rawSlot.ownership.key)) {
            fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
          }
          return {
            ordinal: rawSlot.ordinal,
            skuKey: applicableSkuKeys[0],
            slotKey: projectedSlot.slotKey,
            suiteSlotId: rawSlot.id,
            expectedSuiteSlotRevision: rawSlot.revision,
            childWorkflowId: rawSlot.workflowId,
            expectedChildWorkflowRevision: rawSlot.workflowRevision,
            outputAssetId: rawSlot.output.id,
            assignmentScope: rawSlot.ownership.level === 'sku' ? 'SKU' : 'PRODUCT',
          };
        }).sort(function (left, right) { return left.ordinal - right.ordinal; });
        if (new Set(expectedAssignments.map(function (item) { return item.ordinal; })).size
          !== expectedAssignments.length
          || new Set(expectedAssignments.map(function (item) { return item.outputAssetId; })).size
            !== expectedAssignments.length) fail('SS_ERP_HOSTED_WORKBENCH_INTENT_STALE');
        var assignmentStartOrdinal = nonNegativeInteger(
          value.assignmentStartOrdinal,
          499,
          code,
        );
        if (assignmentStartOrdinal + expectedAssignments.length > 500) fail(code);
        var idempotencyKey = text(value.idempotencyKey, 200, code);
        if (idempotencyKey.length < 16) fail(code);
        var body = {
          contractVersion: ASSIGNMENT_VERSION,
          shopId: raw.context.shopId,
          listingWorkflowId: raw.context.listingWorkflowId,
          expectedDraftRevision: raw.context.draftRevision,
          expectedDraftVersion: raw.context.draftVersion,
          sourceCaptureSnapshotId: raw.context.snapshotId,
          assignmentStartOrdinal: assignmentStartOrdinal,
          planId: raw.commandAuthority.planId,
          planVersionId: raw.commandAuthority.planVersionId,
          expectedPlanRevision: raw.commandAuthority.planRevision,
          suiteId: raw.suite.id,
          expectedSuiteRevision: raw.suite.revision,
          idempotencyKey: idempotencyKey,
          items: expectedAssignments.map(function (item) {
            return {
              skuKey: item.skuKey,
              slotKey: item.slotKey,
              suiteSlotId: item.suiteSlotId,
              expectedSuiteSlotRevision: item.expectedSuiteSlotRevision,
              childWorkflowId: item.childWorkflowId,
              expectedChildWorkflowRevision: item.expectedChildWorkflowRevision,
              outputAssetId: item.outputAssetId,
            };
          }),
        };
        var response = await request(
          'POST',
          ASSIGNMENT_PATH,
          body,
          'listing:write',
          'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
          'ASSIGN_APPROVED_OUTPUT',
        );
        var result;
        try {
          result = validAssignmentResponse(response, body, expectedAssignments);
        } catch (error) {
          if (!mutationResponseProvesRejection(response)) {
            throw unknownOutcomeError(
              'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
              'ASSIGN_APPROVED_OUTPUT',
            );
          }
          throw error;
        }
        clearCurrent();
        return result;
      },

      clear: function () {
        clearCurrent();
      },
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    MODE_LOCK_VERSION: MODE_LOCK_VERSION,
    GALLERY_GOALS: GALLERY_GOALS,
    PLAN_CONTRACTS: Object.freeze({
      response: PLAN_VERSION,
      create: PLAN_CREATE_VERSION,
      review: PLAN_REVIEW_VERSION,
    }),
    ASSIGNMENT_VERSION: ASSIGNMENT_VERSION,
    normalizeCreativeBrief: normalizeCreativeBrief,
    normalizeCandidateMediaKeys: normalizeCandidateMediaKeys,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
