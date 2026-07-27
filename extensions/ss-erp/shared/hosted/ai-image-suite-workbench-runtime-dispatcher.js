(function exposeHostedAiImageSuiteWorkbenchRuntimeDispatcher(global) {
  'use strict';

  var CONTRACT_VERSION =
    'extension-hosted-ai-image-suite-workbench-runtime-dispatcher/v1';
  var INTENT_VERSION = 'extension-ai-image-suite-intent-witness/v1';
  var MAX_COST_CENTS = 10000000;
  var MAX_ASSIGNMENT_ORDINAL = 499;
  var BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion',
  ]);
  var MESSAGE_TYPE_NAMES = Object.freeze([
    'GET_MODE_LOCK',
    'GET_CURRENT_PLAN',
    'CREATE_PLAN',
    'GET_PLAN',
    'REVIEW_PLAN',
    'LOAD_SUITE',
    'EXECUTE_INTENT',
    'OPEN_PREVIEW',
    'ASSIGN_APPROVED_OUTPUT',
    'CLEAR',
  ]);
  var CLIENT_METHODS = Object.freeze([
    'getModeLock', 'getCurrentPlan', 'createPlan', 'getPlan', 'reviewPlan', 'loadSuite',
    'executeIntent', 'openPreview', 'assignApprovedOutputs', 'clear',
  ]);
  var PUBLIC_CONTRACT_VERSIONS = Object.freeze(new Set([
    'extension-hosted-ai-image-mode-lock/v1',
    'extension-hosted-ai-image-suite-workbench-client/v1',
    'hosted-ai-image-suite-workbench-adapter/v1',
    'extension-hosted-ai-image-suite-candidate-preview-channel/v1',
    'extension-hosted-ai-image-listing-assignment/v2',
  ]));
  var FORBIDDEN_OUTPUT_KEYS = Object.freeze(new Set([
    'url', 'previewurl',
    'provider', 'providerid', 'providerorigin', 'providerendpoint', 'providerrequestid',
    'model', 'modelid',
    'prompt', 'prompthash', 'prompttext', 'prompttemplate',
    'apikey', 'secretkey', 'authorization',
    'storage', 'storagebackend', 'storagekey', 'storageid',
    'job', 'jobid',
    'reservation', 'reservationid', 'settlement', 'settlementid',
    'billing', 'billingid',
    'token', 'erptoken', 'accesstoken', 'refreshtoken', 'sessiontoken',
    'devicetoken', 'commandtoken', 'granttoken', 'credential', 'credentials', 'secret',
    'bytes', 'rawbytes', 'arraybuffer', 'blob', 'imagebytes',
    'projection', 'rawprojection', 'commandauthority', 'responsebody', 'requestbody',
  ]));

  function dispatcherError(code) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteWorkbenchRuntimeDispatcherError';
    error.code = code;
    return error;
  }

  function fail(code) {
    throw dispatcherError(code);
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

  function identifier(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (/(?:https?|ftp|file|blob|data):/iu.test(result)
      || result.includes('?')
      || result.includes('#')
      || result.includes('/')
      || result.includes('\\')) fail(code);
    return result;
  }

  function opaqueText(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (/(?:https?|ftp|file|blob|data):/iu.test(result)
      || result.includes('?')
      || result.includes('#')) fail(code);
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

  function suiteCommand(value, action, outerSlotId, decision, code) {
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
    if (!sameBinding(context, binding)) {
      fail('SS_ERP_HOSTED_WORKBENCH_CONTEXT_STALE');
    }
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
      commandTemplate: suiteCommand(
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
      || !Number.isSafeInteger(value.maximumCostCents)
      || value.maximumCostCents < 1
      || value.maximumCostCents > MAX_COST_CENTS
      || value.maximumCostCents !== expectedMaximum) {
      fail('SS_ERP_HOSTED_WORKBENCH_COST_CONFIRMATION_REQUIRED');
    }
    return deepFreeze({ confirmed: true, maximumCostCents: expectedMaximum });
  }

  function outputKey(value) {
    return value.toLowerCase().replace(/[_-]/gu, '');
  }

  function publicString(value) {
    return value.length <= 4000
      && !hasControlCharacter(value)
      && !/(?:https?|ftp|file|blob|data):/iu.test(value)
      && !/(?:bearer\s+|api[_-]?key\s*[:=]|authorization\s*[:=])/iu.test(value)
      && !/^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(value);
  }

  function clonePublic(value, depth, state, ancestors) {
    if (state.count >= 50000 || depth > 16) {
      fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
    }
    state.count += 1;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
      return value;
    }
    if (typeof value === 'string') {
      if (!publicString(value)) fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
      return value;
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) {
      fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
    }
    ancestors.add(value);
    var result;
    if (Array.isArray(value)) {
      if (value.length > 500) fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
      result = value.map(function (item) {
        return clonePublic(item, depth + 1, state, ancestors);
      });
    } else {
      if (Object.prototype.toString.call(value) !== '[object Object]') {
        fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
      }
      var keys = Object.keys(value);
      if (keys.length > 64) fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
      result = {};
      keys.forEach(function (key) {
        if (key.length < 1
          || key.length > 100
          || hasControlCharacter(key)
          || FORBIDDEN_OUTPUT_KEYS.has(outputKey(key))) {
          fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
        }
        result[key] = clonePublic(value[key], depth + 1, state, ancestors);
      });
    }
    ancestors.delete(value);
    return result;
  }

  function publicOutput(value) {
    var result = clonePublic(value, 0, { count: 0 }, new Set());
    if (!record(result)
      || typeof result.contractVersion !== 'string'
      || !PUBLIC_CONTRACT_VERSIONS.has(result.contractVersion)) {
      fail('SS_ERP_HOSTED_WORKBENCH_OUTPUT_INVALID');
    }
    return deepFreeze(result);
  }

  function publicMutationOutput(value, unknownCode) {
    try {
      return publicOutput(value);
    } catch {
      throw dispatcherError(unknownCode);
    }
  }

  function safeFailure(error) {
    var candidate = error && typeof error === 'object' ? String(error.code || '') : '';
    return deepFreeze({
      ok: false,
      errorCode: /^[A-Z][A-Z0-9_]{0,119}$/u.test(candidate)
        ? candidate
        : 'SS_ERP_HOSTED_WORKBENCH_OPERATION_FAILED',
      error: 'Hosted AI image workbench operation failed',
    });
  }

  function success(data) {
    return deepFreeze({ ok: true, data: data });
  }

  function guarded(operation) {
    return async function guardedHandler(context) {
      try {
        return success(await operation(context || {}));
      } catch (error) {
        return safeFailure(error);
      }
    };
  }

  function payload(context, keys) {
    var value = context && context.payload;
    if (!exactKeys(value, keys)) fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
    return value;
  }

  function createDispatcher(options) {
    var config = options || {};
    var messageTypes = config.messageTypes;
    var getClient = config.getClient;
    if (!exactKeys(messageTypes, MESSAGE_TYPE_NAMES) || typeof getClient !== 'function') {
      fail('SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }
    var typeValues = MESSAGE_TYPE_NAMES.map(function (name) {
      return canonicalText(
        messageTypes[name],
        1,
        200,
        'SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE',
      );
    });
    if (new Set(typeValues).size !== typeValues.length) {
      fail('SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }

    async function clientFor(context, binding) {
      var client = await getClient(context && context.sender, binding);
      if (!client || CLIENT_METHODS.some(function (name) {
        return typeof client[name] !== 'function';
      })) fail('SS_ERP_HOSTED_WORKBENCH_DEPENDENCY_UNAVAILABLE');
      return client;
    }

    var handlers = {};

    handlers[messageTypes.GET_MODE_LOCK] = guarded(async function (context) {
      var input = payload(context, ['binding']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.getModeLock(pinnedBinding));
    });

    handlers[messageTypes.GET_CURRENT_PLAN] = guarded(async function (context) {
      var input = payload(context, ['binding']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.getCurrentPlan(pinnedBinding));
    });

    handlers[messageTypes.CREATE_PLAN] = guarded(async function (context) {
      var input = payload(context, ['binding', 'idempotencyKey']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var idempotencyKey = identifier(
        input.idempotencyKey,
        8,
        128,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.createPlan(deepFreeze({
        binding: clone(pinnedBinding),
        idempotencyKey: idempotencyKey,
      })));
    });

    handlers[messageTypes.GET_PLAN] = guarded(async function (context) {
      var input = payload(context, ['binding', 'planId']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.getPlan(deepFreeze({
        binding: clone(pinnedBinding),
        planId: identifier(input.planId, 1, 200, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID'),
      })));
    });

    handlers[messageTypes.REVIEW_PLAN] = guarded(async function (context) {
      var input = payload(context, [
        'binding', 'planId', 'expectedRevision', 'operationKey', 'decision', 'note',
      ]);
      if (!['APPROVE', 'REJECT'].includes(input.decision)
        || !(input.note === null
          || typeof input.note === 'string'
            && input.note.length <= 2000
            && input.note === input.note.normalize('NFKC')
            && !hasControlCharacter(input.note))) {
        fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      }
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.reviewPlan(deepFreeze({
        binding: clone(pinnedBinding),
        planId: identifier(input.planId, 1, 200, 'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID'),
        expectedRevision: positiveInteger(
          input.expectedRevision,
          'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
        ),
        operationKey: identifier(
          input.operationKey,
          8,
          128,
          'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
        ),
        decision: input.decision,
        note: input.note,
      })));
    });

    handlers[messageTypes.LOAD_SUITE] = guarded(async function (context) {
      var input = payload(context, ['binding']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.loadSuite(pinnedBinding));
    });

    handlers[messageTypes.EXECUTE_INTENT] = guarded(async function (context) {
      var input = payload(context, ['binding', 'intent', 'confirmation']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var selectedIntent = normalizeIntent(input.intent, pinnedBinding);
      if (selectedIntent.action === 'APPLY_SLOT') {
        fail('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED');
      }
      var confirmation = normalizeConfirmation(selectedIntent, input.confirmation);
      var client = await clientFor(context, pinnedBinding);
      return publicMutationOutput(
        await client.executeIntent(selectedIntent, confirmation),
        'SS_ERP_HOSTED_WORKBENCH_EXECUTION_UNKNOWN_OUTCOME',
      );
    });

    handlers[messageTypes.OPEN_PREVIEW] = guarded(async function (context) {
      var input = payload(context, ['binding', 'slotId']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var slotId = identifier(
        input.slotId,
        1,
        200,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicOutput(await client.openPreview(slotId));
    });

    handlers[messageTypes.ASSIGN_APPROVED_OUTPUT] = guarded(async function (context) {
      var input = payload(context, [
        'binding', 'intents', 'assignmentStartOrdinal', 'idempotencyKey',
      ]);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      if (!Array.isArray(input.intents)
        || input.intents.length < 1
        || input.intents.length > 500) {
        fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      }
      var selectedIntents = input.intents.map(function (intentValue) {
        var selectedIntent = normalizeIntent(intentValue, pinnedBinding);
        if (selectedIntent.action !== 'APPLY_SLOT') {
          fail('SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_REQUIRED');
        }
        return selectedIntent;
      });
      if (new Set(selectedIntents.map(function (intent) { return intent.slotId; })).size
        !== selectedIntents.length) fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      var assignmentStartOrdinal = nonNegativeInteger(
        input.assignmentStartOrdinal,
        MAX_ASSIGNMENT_ORDINAL,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      if (assignmentStartOrdinal + selectedIntents.length > 500) {
        fail('SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID');
      }
      var idempotencyKey = identifier(
        input.idempotencyKey,
        16,
        200,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      return publicMutationOutput(
        await client.assignApprovedOutputs(deepFreeze({
          intents: selectedIntents,
          assignmentStartOrdinal: assignmentStartOrdinal,
          idempotencyKey: idempotencyKey,
        })),
        'SS_ERP_HOSTED_WORKBENCH_ASSIGNMENT_UNKNOWN_OUTCOME',
      );
    });

    handlers[messageTypes.CLEAR] = guarded(async function (context) {
      var input = payload(context, ['binding']);
      var pinnedBinding = normalizeBinding(
        input.binding,
        'SS_ERP_HOSTED_WORKBENCH_INPUT_INVALID',
      );
      var client = await clientFor(context, pinnedBinding);
      await client.clear();
      return deepFreeze({ cleared: true });
    });

    Object.freeze(handlers);

    async function dispatchAuthorized(messageType, context) {
      var selected = Object.prototype.hasOwnProperty.call(handlers, messageType)
        ? handlers[messageType]
        : null;
      if (!selected) {
        return safeFailure(dispatcherError('SS_ERP_HOSTED_WORKBENCH_HANDLER_UNAVAILABLE'));
      }
      return selected(context);
    }

    return Object.freeze({
      handlers: handlers,
      dispatchAuthorized: dispatchAuthorized,
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_DISPATCHER = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    MESSAGE_TYPE_NAMES: MESSAGE_TYPE_NAMES,
    createDispatcher: createDispatcher,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
