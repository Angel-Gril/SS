(function (global) {
  'use strict';

  var CONTRACT_VERSION = 'hosted-ai-image-suite-workbench-adapter/v1';
  var SOURCE_CONTRACT_VERSION = 'extension-ai-image-suite-projection/v1';
  var ERROR_CODE = 'SS_ERP_HOSTED_WORKBENCH_PROJECTION_INVALID';
  var MAX_ITEMS = 500;
  var MAX_COST_CENTS = 10000000;
  var SUITE_STATUSES = [
    'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_FAILURE',
    'CANCEL_REQUESTED', 'CANCELLED',
  ];
  var SLOT_STATUSES = [
    'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED',
    'CANCEL_REQUESTED', 'CANCELLED',
  ];
  var REVIEW_STATUSES = ['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'];

  function invalidProjection() {
    var error = new TypeError('Hosted AI image suite projection is invalid');
    error.code = ERROR_CODE;
    return error;
  }

  function fail() {
    throw invalidProjection();
  }

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function exactKeys(value, keys) {
    var item = record(value);
    return Boolean(item)
      && Object.keys(item).sort().join(',') === keys.slice().sort().join(',');
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

  function text(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
  }

  function nullableText(value, maximum) {
    return value === null || text(value, maximum);
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function cost(value, positive) {
    return Number.isSafeInteger(value)
      && value >= (positive ? 1 : 0)
      && value <= MAX_COST_CENTS;
  }

  function sha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  function ownership(value) {
    return exactKeys(value, ['level', 'key'])
      && ['sku', 'compatibility_group'].includes(value.level)
      && text(value.key, 500);
  }

  function applicableSkuKeys(value, slotOwnership) {
    if (!Array.isArray(value)
      || value.length < 1
      || value.length > MAX_ITEMS
      || !value.every(function (skuKey) { return text(skuKey, 500); })
      || new Set(value).size !== value.length
      || value.some(function (skuKey, index) {
        return index > 0 && value[index - 1] >= skuKey;
      })) return false;
    return slotOwnership.level === 'sku'
      ? value.length === 1 && value[0] === slotOwnership.key
      : slotOwnership.level === 'compatibility_group';
  }

  function validBinding(value) {
    return exactKeys(value, [
      'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
      'draftRevision', 'draftVersion',
    ])
      && text(value.snapshotId, 200)
      && text(value.supplyGoodsId, 200)
      && text(value.shopId, 200)
      && text(value.listingWorkflowId, 200)
      && positiveInteger(value.draftRevision)
      && positiveInteger(value.draftVersion);
  }

  function validAuthority(value, context) {
    return exactKeys(value, [
      'snapshotId', 'supplyGoodsId', 'draftRevision', 'planId', 'planVersionId',
      'planRevision', 'skuKey', 'authorityHash',
    ])
      && value.snapshotId === context.snapshotId
      && value.supplyGoodsId === context.supplyGoodsId
      && value.draftRevision === context.draftRevision
      && text(value.planId, 200)
      && text(value.planVersionId, 200)
      && positiveInteger(value.planRevision)
      && nullableText(value.skuKey, 500)
      && sha256(value.authorityHash);
  }

  function validActionMap(actions, commands, allowed) {
    if (!Array.isArray(actions)
      || actions.length > allowed.length
      || new Set(actions).size !== actions.length
      || actions.some(function (action) { return !allowed.includes(action); })
      || !record(commands)) return false;
    var commandKeys = Object.keys(commands);
    return commandKeys.length === actions.length
      && commandKeys.every(function (action) { return actions.includes(action); });
  }

  function validPlanSlot(value) {
    var slot = record(value);
    return exactKeys(slot, [
      'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
      'estimatedCostCents', 'maximumCostCents',
    ])
      && nonNegativeInteger(slot.ordinal)
      && text(slot.slotKey, 500)
      && text(slot.goal, 200)
      && ownership(slot.ownership)
      && applicableSkuKeys(slot.applicableSkuKeys, slot.ownership)
      && cost(slot.estimatedCostCents, false)
      && cost(slot.maximumCostCents, false)
      && slot.maximumCostCents >= slot.estimatedCostCents;
  }

  function validPlan(value, authority) {
    var plan = record(value);
    var preview = plan && record(plan.preview);
    var commands = plan && record(plan.commands);
    if (!exactKeys(plan, [
      'id', 'versionId', 'revision', 'status', 'skuKey', 'preview', 'allowedActions', 'commands',
    ])
      || plan.id !== authority.planId
      || plan.versionId !== authority.planVersionId
      || plan.revision !== authority.planRevision
      || plan.status !== 'APPROVED'
      || plan.skuKey !== authority.skuKey
      || !exactPriceKeys(preview, [
        'hash', 'pricingVersion', 'itemCount', 'estimatedCostCents',
        'maximumCostCents', 'slots',
      ])
      || !sha256(preview.hash)
      || !text(preview.pricingVersion, 100)
      || !positiveInteger(preview.itemCount)
      || preview.itemCount > MAX_ITEMS
      || !cost(preview.estimatedCostCents, false)
      || !cost(preview.maximumCostCents, true)
      || preview.maximumCostCents < preview.estimatedCostCents
      || !Array.isArray(preview.slots)
      || preview.slots.length !== preview.itemCount
      || preview.slots.length > MAX_ITEMS
      || !preview.slots.every(validPlanSlot)
      || new Set(preview.slots.map(function (slot) { return slot.ordinal; })).size !== preview.slots.length
      || new Set(preview.slots.map(function (slot) { return slot.slotKey; })).size !== preview.slots.length
      || !validActionMap(plan.allowedActions, commands, ['START'])) return false;
    if (!commands.START) return plan.allowedActions.length === 0;
    return exactKeys(commands.START, [
      'expectedPreviewHash', 'acceptedPricingVersion',
      'acceptedEstimatedCostCents', 'acceptedMaximumCostCents',
    ])
      && commands.START.expectedPreviewHash === preview.hash
      && commands.START.acceptedPricingVersion === preview.pricingVersion
      && commands.START.acceptedEstimatedCostCents === preview.estimatedCostCents
      && commands.START.acceptedMaximumCostCents === preview.maximumCostCents;
  }

  function validCandidate(value) {
    if (value === null) return true;
    var parsed;
    try {
      parsed = new URL(value.url);
    } catch {
      return false;
    }
    return exactKeys(value, ['id', 'url', 'storageBackend', 'mimeType', 'width', 'height'])
      && text(value.id, 200)
      && parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && ['local', 'oss'].includes(value.storageBackend)
      && ['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType)
      && (value.width === null || positiveInteger(value.width))
      && (value.height === null || positiveInteger(value.height));
  }

  function validApplication(value) {
    if (value === null) return true;
    return exactKeys(value, ['state', 'target', 'mode', 'writesStoreDraft'])
      && ['APPLIED', 'ROLLED_BACK'].includes(value.state)
      && value.target === 'ERP_SOURCE_PRODUCT'
      && value.mode === 'append'
      && value.writesStoreDraft === false;
  }

  function canonicalTimestamp(value) {
    if (!text(value, 100)) return false;
    var parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }

  function validSlotCommand(action, command, slot, suite) {
    if (!record(command)
      || command.suiteId !== suite.id
      || command.slotId !== slot.id
      || command.expectedSuiteRevision !== suite.revision
      || command.expectedSlotRevision !== slot.revision) return false;
    if (action === 'RETRY_SLOT') {
      return exactKeys(command, [
        'suiteId', 'slotId', 'expectedSuiteRevision', 'expectedSlotRevision',
        'acceptedAdditionalMaximumCostCents',
      ])
        && command.acceptedAdditionalMaximumCostCents === slot.maximumCostCents
        && cost(command.acceptedAdditionalMaximumCostCents, true);
    }
    if (command.workflowId !== slot.workflowId
      || command.outputAssetId !== (slot.output && slot.output.id)
      || command.expectedWorkflowRevision !== slot.workflowRevision) return false;
    if (action === 'REVIEW_SLOT') {
      return exactKeys(command, [
        'suiteId', 'slotId', 'workflowId', 'outputAssetId', 'expectedSuiteRevision',
        'expectedSlotRevision', 'expectedWorkflowRevision', 'decisions',
      ])
        && Array.isArray(command.decisions)
        && command.decisions.length === 2
        && command.decisions.includes('APPROVE')
        && command.decisions.includes('REJECT');
    }
    return action === 'APPLY_SLOT'
      && exactKeys(command, [
        'suiteId', 'slotId', 'workflowId', 'outputAssetId', 'expectedSuiteRevision',
        'expectedSlotRevision', 'expectedWorkflowRevision', 'mode', 'target',
        'writesStoreDraft', 'expectedTargetUpdatedAt',
      ])
      && command.mode === 'append'
      && command.target === 'ERP_SOURCE_PRODUCT'
      && command.writesStoreDraft === false
      && canonicalTimestamp(command.expectedTargetUpdatedAt);
  }

  function validSuiteSlot(value, suite) {
    var slot = record(value);
    var commands = slot && record(slot.commands);
    if (!exactKeys(slot, [
      'id', 'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
      'status', 'attempt', 'revision',
      'estimatedCostCents', 'maximumCostCents', 'workflowId', 'workflowRevision',
      'reviewStatus', 'output', 'application', 'allowedActions', 'commands',
    ])
      || !text(slot.id, 200)
      || !nonNegativeInteger(slot.ordinal)
      || !text(slot.slotKey, 500)
      || !text(slot.goal, 200)
      || !ownership(slot.ownership)
      || !applicableSkuKeys(slot.applicableSkuKeys, slot.ownership)
      || !SLOT_STATUSES.includes(slot.status)
      || !nonNegativeInteger(slot.attempt)
      || !positiveInteger(slot.revision)
      || !cost(slot.estimatedCostCents, false)
      || !cost(slot.maximumCostCents, false)
      || slot.maximumCostCents < slot.estimatedCostCents
      || !nullableText(slot.workflowId, 200)
      || !(slot.workflowRevision === null || positiveInteger(slot.workflowRevision))
      || (slot.workflowId === null) !== (slot.workflowRevision === null)
      || !REVIEW_STATUSES.includes(slot.reviewStatus)
      || !validCandidate(slot.output)
      || !validApplication(slot.application)
      || !validActionMap(
        slot.allowedActions,
        commands,
        ['RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT'],
      )) return false;
    return Object.keys(commands).every(function (action) {
      return validSlotCommand(action, commands[action], slot, suite);
    });
  }

  function validSuite(value, plan) {
    if (value === null) return true;
    var suite = record(value);
    var commands = suite && record(suite.commands);
    if (!exactKeys(suite, [
      'id', 'status', 'revision', 'previewHash', 'pricingVersion', 'itemCount',
      'estimatedCostCents', 'maximumCostCents', 'allowedActions', 'commands', 'slots',
    ])
      || !text(suite.id, 200)
      || !SUITE_STATUSES.includes(suite.status)
      || !positiveInteger(suite.revision)
      || suite.previewHash !== plan.preview.hash
      || suite.pricingVersion !== plan.preview.pricingVersion
      || !positiveInteger(suite.itemCount)
      || suite.itemCount > MAX_ITEMS
      || !cost(suite.estimatedCostCents, false)
      || !cost(suite.maximumCostCents, true)
      || suite.maximumCostCents < suite.estimatedCostCents
      || !validActionMap(suite.allowedActions, commands, ['CONTINUE', 'CANCEL'])
      || !Array.isArray(suite.slots)
      || suite.slots.length !== suite.itemCount
      || suite.slots.length > MAX_ITEMS
      || new Set(suite.slots.map(function (slot) { return slot.id; })).size !== suite.slots.length
      || new Set(suite.slots.map(function (slot) { return slot.slotKey; })).size !== suite.slots.length
      || !suite.slots.every(function (slot) { return validSuiteSlot(slot, suite); })) return false;
    var planSlots = new Map(plan.preview.slots.map(function (slot) {
      return [slot.slotKey, slot];
    }));
    if (!suite.slots.every(function (slot) {
      var planSlot = planSlots.get(slot.slotKey);
      return Boolean(planSlot)
        && slot.ordinal === planSlot.ordinal
        && slot.goal === planSlot.goal
        && slot.ownership.level === planSlot.ownership.level
        && slot.ownership.key === planSlot.ownership.key
        && JSON.stringify(slot.applicableSkuKeys) === JSON.stringify(planSlot.applicableSkuKeys);
    })) return false;
    return Object.keys(commands).every(function (action) {
      return exactKeys(commands[action], ['suiteId', 'expectedSuiteRevision'])
        && commands[action].suiteId === suite.id
        && commands[action].expectedSuiteRevision === suite.revision;
    });
  }

  function validProjection(value) {
    var projection = record(value);
    if (!exactKeys(projection, [
      'contractVersion', 'context', 'commandAuthority', 'applyPolicy', 'plan', 'suite',
    ])
      || projection.contractVersion !== SOURCE_CONTRACT_VERSION
      || !validBinding(projection.context)
      || !exactKeys(projection.applyPolicy, ['target', 'mode', 'writesStoreDraft'])
      || projection.applyPolicy.target !== 'ERP_SOURCE_PRODUCT'
      || projection.applyPolicy.mode !== 'append'
      || projection.applyPolicy.writesStoreDraft !== false) return false;
    if (projection.plan === null) {
      return projection.commandAuthority === null && projection.suite === null;
    }
    return validAuthority(projection.commandAuthority, projection.context)
      && validPlan(projection.plan, projection.commandAuthority)
      && validSuite(projection.suite, projection.plan);
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

  function createIntent(intentContract, projection, action, slotId, decision) {
    try {
      return intentContract.createAiImageSuiteIntentWitness({
        projection: projection,
        action: action,
        slotId: slotId == null ? null : slotId,
        decision: decision == null ? null : decision,
      });
    } catch {
      fail();
    }
  }

  function actionIntent(intentContract, projection, allowedActions, action, slotId, decision) {
    if (!allowedActions.includes(action)) return null;
    return clone(createIntent(intentContract, projection, action, slotId, decision));
  }

  function projectPlan(intentContract, projection) {
    var plan = projection.plan;
    if (!plan) return null;
    return {
      id: plan.id,
      versionId: plan.versionId,
      revision: plan.revision,
      status: plan.status,
      skuKey: plan.skuKey,
      previewHash: plan.preview.hash,
      slots: plan.preview.slots.map(function (slot) {
        return {
          ordinal: slot.ordinal,
          slotKey: slot.slotKey,
          goal: slot.goal,
          ownership: clone(slot.ownership),
          applicableSkuKeys: clone(slot.applicableSkuKeys),
          estimatedCostCents: slot.estimatedCostCents,
          maximumCostCents: slot.maximumCostCents,
        };
      }),
      startIntent: actionIntent(
        intentContract,
        projection,
        plan.allowedActions,
        'START',
        null,
        null,
      ),
    };
  }

  function projectReviewIntents(intentContract, projection, slot) {
    if (!slot.allowedActions.includes('REVIEW_SLOT')) return null;
    return {
      APPROVE: clone(createIntent(
        intentContract,
        projection,
        'REVIEW_SLOT',
        slot.id,
        'APPROVE',
      )),
      REJECT: clone(createIntent(
        intentContract,
        projection,
        'REVIEW_SLOT',
        slot.id,
        'REJECT',
      )),
    };
  }

  function projectSuiteSlot(intentContract, projection, slot) {
    return {
      id: slot.id,
      ordinal: slot.ordinal,
      slotKey: slot.slotKey,
      goal: slot.goal,
      ownership: clone(slot.ownership),
      applicableSkuKeys: clone(slot.applicableSkuKeys),
      status: slot.status,
      attempt: slot.attempt,
      revision: slot.revision,
      estimatedCostCents: slot.estimatedCostCents,
      maximumCostCents: slot.maximumCostCents,
      workflowId: slot.workflowId,
      workflowRevision: slot.workflowRevision,
      reviewStatus: slot.reviewStatus,
      previewAvailable: Boolean(slot.output),
      output: slot.output ? {
        assetId: slot.output.id,
        mimeType: slot.output.mimeType,
        width: slot.output.width,
        height: slot.output.height,
      } : null,
      application: slot.application ? clone(slot.application) : null,
      retryIntent: actionIntent(
        intentContract,
        projection,
        slot.allowedActions,
        'RETRY_SLOT',
        slot.id,
        null,
      ),
      reviewIntents: projectReviewIntents(intentContract, projection, slot),
      applyIntent: actionIntent(
        intentContract,
        projection,
        slot.allowedActions,
        'APPLY_SLOT',
        slot.id,
        null,
      ),
    };
  }

  function projectSuite(intentContract, projection) {
    var suite = projection.suite;
    if (!suite) return null;
    return {
      id: suite.id,
      status: suite.status,
      revision: suite.revision,
      itemCount: suite.itemCount,
      estimatedCostCents: suite.estimatedCostCents,
      maximumCostCents: suite.maximumCostCents,
      continueIntent: actionIntent(
        intentContract,
        projection,
        suite.allowedActions,
        'CONTINUE',
        null,
        null,
      ),
      cancelIntent: actionIntent(
        intentContract,
        projection,
        suite.allowedActions,
        'CANCEL',
        null,
        null,
      ),
      slots: suite.slots.map(function (slot) {
        return projectSuiteSlot(intentContract, projection, slot);
      }),
    };
  }

  function project(intentContract, rawProjection) {
    if (!validProjection(rawProjection)) fail();
    var context = rawProjection.context;
    var preview = rawProjection.plan && rawProjection.plan.preview;
    var projected = {
      contractVersion: CONTRACT_VERSION,
      executionMode: 'ERP_HOSTED',
      binding: {
        shopId: context.shopId,
        workflowId: context.listingWorkflowId,
        draftRevision: context.draftRevision,
        draftVersion: context.draftVersion,
      },
      sourceBinding: {
        snapshotId: context.snapshotId,
        supplyGoodsId: context.supplyGoodsId,
        skuKey: rawProjection.commandAuthority ? rawProjection.commandAuthority.skuKey : null,
      },
      applyPolicy: clone(rawProjection.applyPolicy),
      quote: preview ? {
        pricingVersion: preview.pricingVersion,
        ...(Object.prototype.hasOwnProperty.call(preview, 'currency')
          ? { currency: preview.currency } : {}),
        itemCount: preview.itemCount,
        estimatedCostCents: preview.estimatedCostCents,
        maximumCostCents: preview.maximumCostCents,
      } : null,
      plan: projectPlan(intentContract, rawProjection),
      suite: projectSuite(intentContract, rawProjection),
    };
    return deepFreeze(projected);
  }

  function sameBinding(left, right) {
    return Boolean(left && right)
      && left.snapshotId === right.snapshotId
      && left.supplyGoodsId === right.supplyGoodsId
      && left.shopId === right.shopId
      && left.listingWorkflowId === right.listingWorkflowId
      && left.draftRevision === right.draftRevision
      && left.draftVersion === right.draftVersion;
  }

  function createAdapter(options) {
    var intentContract = options && options.intentContract;
    if (!intentContract
      || typeof intentContract.createAiImageSuiteIntentWitness !== 'function'
      || typeof intentContract.matchesAiImageSuiteIntentWitness !== 'function') {
      throw new TypeError('Hosted AI image suite intent contract is required');
    }
    var boundContext = null;
    return deepFreeze({
      project: function (rawProjection) {
        var projected = project(intentContract, rawProjection);
        if (boundContext && !sameBinding(boundContext, rawProjection.context)) fail();
        if (!boundContext) boundContext = deepFreeze(clone(rawProjection.context));
        return projected;
      },
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_ADAPTER = {
    CONTRACT_VERSION: CONTRACT_VERSION,
    createAdapter: createAdapter,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
