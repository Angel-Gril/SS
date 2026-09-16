(function exposeHostedAiImageSuiteWorkspaceProjection(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-hosted-ai-image-suite-workspace-projection/v1';
  var HOSTED_PROJECTION_VERSION = 'hosted-ai-image-suite-workbench-adapter/v1';
  var WORKSPACE_VERSION = 'extension-byok-workbench-workspace-state/v1';
  var WORKSPACE_RUNTIME_VERSION = 'extension-byok-workbench-workspace-runtime/v1';
  var WORKSPACE_ACTION_VERSION = 'extension-byok-workbench-action-intent/v1';
  var HOSTED_INTENT_VERSION = 'extension-ai-image-suite-intent-witness/v1';
  var LAUNCH_CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var HOSTED_CHARGE_WARNING_VERSION = 'erp-hosted-additional-cost/v1';
  var MAX_COST_CENTS = 10000000;
  var BINDING_KEYS = Object.freeze([
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ]);
  var HOSTED_BINDING_KEYS = Object.freeze([
    'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
    'draftRevision', 'draftVersion',
  ]);
  var LAUNCH_KEYS = Object.freeze([
    'contractVersion', 'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId',
    'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion',
    'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal',
  ]);
  var HOSTED_PROJECTION_KEYS = Object.freeze([
    'contractVersion', 'executionMode', 'binding', 'sourceBinding', 'applyPolicy',
    'quote', 'plan', 'suite',
  ]);
  var PLAN_KEYS = Object.freeze([
    'id', 'versionId', 'revision', 'status', 'skuKey', 'previewHash', 'slots',
    'startIntent',
  ]);
  var PLAN_SLOT_KEYS = Object.freeze([
    'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys', 'estimatedCostCents',
    'maximumCostCents',
  ]);
  var SUITE_KEYS = Object.freeze([
    'id', 'status', 'revision', 'itemCount', 'estimatedCostCents',
    'maximumCostCents', 'continueIntent', 'cancelIntent', 'slots',
  ]);
  var SUITE_SLOT_KEYS = Object.freeze([
    'id', 'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
    'status', 'attempt', 'revision',
    'estimatedCostCents', 'maximumCostCents', 'workflowId', 'workflowRevision',
    'reviewStatus', 'previewAvailable', 'output', 'application', 'retryIntent',
    'reviewIntents', 'applyIntent',
  ]);
  var WORKSPACE_ACTION_KEYS = Object.freeze([
    'contractVersion', 'binding', 'action', 'commandId', 'expectedWorkspaceRevision',
    'expectedRuntimeRevision', 'expectedSlotRevision', 'slotKey', 'attemptId',
    'externalChargeAcknowledgement',
  ]);
  var SUITE_STATUSES = Object.freeze([
    'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_FAILURE',
    'CANCEL_REQUESTED', 'CANCELLED',
  ]);
  var SLOT_STATUSES = Object.freeze([
    'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED',
    'CANCEL_REQUESTED', 'CANCELLED',
  ]);
  var REVIEW_STATUSES = Object.freeze(['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED']);
  var WORKSPACE_ACTIONS = Object.freeze([
    'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
    'REJECT_ATTEMPT', 'REGENERATE_SLOT',
  ]);

  function projectionError(code) {
    var error = new Error(code);
    error.name = 'ExtensionHostedAiImageSuiteWorkspaceProjectionError';
    error.code = code;
    return error;
  }

  function fail(code) {
    throw projectionError(code || 'SS_ERP_HOSTED_WORKSPACE_PROJECTION_INVALID');
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

  function text(value, minimum, maximum, code) {
    if (typeof value !== 'string'
      || value.length < minimum
      || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)
      || /(?:https?|ftp|file|blob|data):/iu.test(value)) fail(code);
    return value;
  }

  function identifier(value, maximum, code) {
    var result = text(value, 1, maximum, code);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) fail(code);
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

  function boundedCost(value, positive, code) {
    if (!Number.isSafeInteger(value)
      || value < (positive ? 1 : 0)
      || value > MAX_COST_CENTS) fail(code);
    return value;
  }

  function sha256(value, code) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) fail(code);
    return value;
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function deeplyFrozen(value, seen) {
    if (!value || typeof value !== 'object') return true;
    var visited = seen || new Set();
    if (visited.has(value)) return true;
    if (!Object.isFrozen(value)) return false;
    visited.add(value);
    return Object.values(value).every(function (item) {
      return deeplyFrozen(item, visited);
    });
  }

  function sameBinding(left, right) {
    return Boolean(left && right)
      && BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function sameHostedBinding(left, right) {
    return Boolean(left && right)
      && HOSTED_BINDING_KEYS.every(function (key) { return left[key] === right[key]; });
  }

  function publicValue(value, depth, count, ancestors) {
    if (depth > 20 || count.value > 50000) fail('SS_ERP_HOSTED_WORKSPACE_OUTPUT_INVALID');
    count.value += 1;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isSafeInteger(value);
    if (typeof value === 'string') {
      return value.length <= 8000
        && !hasControlCharacter(value)
        && !/(?:https?|ftp|file|blob|data):/iu.test(value)
        && !/(?:bearer\s+|api[_-]?key\s*[:=]|authorization\s*[:=])/iu.test(value);
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) return false;
    ancestors.add(value);
    var valid;
    if (Array.isArray(value)) {
      valid = value.length <= 1000 && value.every(function (item) {
        return publicValue(item, depth + 1, count, ancestors);
      });
    } else {
      valid = Object.keys(value).length <= 64 && Object.keys(value).every(function (key) {
        var normalized = key.toLowerCase().replace(/[_-]/gu, '');
        return ![
          'url', 'base64', 'apikey', 'secret', 'authorization', 'rawprojection',
          'provider', 'model', 'storage', 'job', 'billing', 'bytes', 'arraybuffer',
        ].some(function (marker) { return normalized.includes(marker); })
          && publicValue(value[key], depth + 1, count, ancestors);
      });
    }
    ancestors.delete(value);
    return valid;
  }

  function assertPublic(value) {
    if (!publicValue(value, 0, { value: 0 }, new Set())) {
      fail('SS_ERP_HOSTED_WORKSPACE_OUTPUT_INVALID');
    }
    return value;
  }

  function normalizeLaunchContext(value) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_LAUNCH_CONTEXT_INVALID';
    if (!exactKeys(value, LAUNCH_KEYS)
      || value.contractVersion !== LAUNCH_CONTEXT_VERSION
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND') fail(code);
    var result = {
      contractVersion: LAUNCH_CONTEXT_VERSION,
      sourcePlatform: value.sourcePlatform,
      sourceProductId: text(value.sourceProductId, 1, 200, code),
      sourceCaptureSnapshotId: text(value.sourceCaptureSnapshotId, 1, 200, code),
      supplyGoodsId: text(value.supplyGoodsId, 1, 200, code),
      shopId: text(value.shopId, 1, 200, code),
      workflowId: text(value.workflowId, 1, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
      skuKey: text(value.skuKey, 1, 500, code),
      slotKey: text(value.slotKey, 1, 200, code),
      assignmentMode: 'APPEND',
      assignmentOrdinal: nonNegativeInteger(value.assignmentOrdinal, 499, code),
    };
    if (result.slotKey !== 'sku:' + result.skuKey + ':hero') fail(code);
    return deepFreeze(result);
  }

  function hostedBinding(launch) {
    return deepFreeze({
      snapshotId: launch.sourceCaptureSnapshotId,
      supplyGoodsId: launch.supplyGoodsId,
      shopId: launch.shopId,
      listingWorkflowId: launch.workflowId,
      draftRevision: launch.draftRevision,
      draftVersion: launch.draftVersion,
    });
  }

  function workspaceBinding(launch) {
    return {
      shopId: launch.shopId,
      workflowId: launch.workflowId,
      draftRevision: launch.draftRevision,
      draftVersion: launch.draftVersion,
    };
  }

  function validIntent(value, expectedBinding, action, slotId, decision) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    if (value === null) return null;
    if (!deeplyFrozen(value)
      || !exactKeys(value, [
        'version', 'context', 'authorityHash', 'action', 'slotId', 'decision',
        'commandTemplate',
      ])
      || value.version !== HOSTED_INTENT_VERSION
      || value.action !== action
      || value.slotId !== slotId
      || value.decision !== decision
      || !exactKeys(value.context, HOSTED_BINDING_KEYS)
      || !sameHostedBinding(value.context, expectedBinding)
      || !record(value.commandTemplate)) fail(code);
    sha256(value.authorityHash, code);
    return value;
  }

  function validateStartCommand(intent, plan, quote) {
    if (!intent) return;
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    var command = intent.commandTemplate;
    if (!exactKeys(command, [
      'expectedPreviewHash', 'acceptedPricingVersion',
      'acceptedEstimatedCostCents', 'acceptedMaximumCostCents',
    ])
      || command.expectedPreviewHash !== plan.previewHash
      || command.acceptedPricingVersion !== quote.pricingVersion
      || command.acceptedEstimatedCostCents !== quote.estimatedCostCents
      || command.acceptedMaximumCostCents !== quote.maximumCostCents) fail(code);
  }

  function validateSuiteCommand(intent, suite) {
    if (!intent) return;
    var command = intent.commandTemplate;
    if (!exactKeys(command, ['suiteId', 'expectedSuiteRevision'])
      || command.suiteId !== suite.id
      || command.expectedSuiteRevision !== suite.revision) {
      fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
    }
  }

  function validateRetryCommand(intent, slot, suite) {
    if (!intent) return;
    var command = intent.commandTemplate;
    if (!exactKeys(command, [
      'suiteId', 'slotId', 'expectedSuiteRevision', 'expectedSlotRevision',
      'acceptedAdditionalMaximumCostCents',
    ])
      || command.suiteId !== suite.id
      || command.slotId !== slot.id
      || command.expectedSuiteRevision !== suite.revision
      || command.expectedSlotRevision !== slot.revision
      || command.acceptedAdditionalMaximumCostCents !== slot.maximumCostCents) {
      fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
    }
  }

  function validateOutputCommand(intent, slot, suite, action) {
    if (!intent) return;
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    var sharedKeys = [
      'suiteId', 'slotId', 'workflowId', 'outputAssetId', 'expectedSuiteRevision',
      'expectedSlotRevision', 'expectedWorkflowRevision',
    ];
    var keys = action === 'REVIEW_SLOT'
      ? sharedKeys.concat(['decisions'])
      : sharedKeys.concat([
        'mode', 'target', 'writesStoreDraft', 'expectedTargetUpdatedAt',
      ]);
    var command = intent.commandTemplate;
    if (!exactKeys(command, keys)
      || command.suiteId !== suite.id
      || command.slotId !== slot.id
      || command.workflowId !== slot.workflowId
      || command.outputAssetId !== slot.output.assetId
      || command.expectedSuiteRevision !== suite.revision
      || command.expectedSlotRevision !== slot.revision
      || command.expectedWorkflowRevision !== slot.workflowRevision) fail(code);
    if (action === 'REVIEW_SLOT') {
      if (!Array.isArray(command.decisions)
        || command.decisions.length !== 2
        || new Set(command.decisions).size !== 2
        || !command.decisions.includes('APPROVE')
        || !command.decisions.includes('REJECT')) fail(code);
      return;
    }
    if (command.mode !== 'append'
      || command.target !== 'ERP_SOURCE_PRODUCT'
      || command.writesStoreDraft !== false) fail(code);
    text(command.expectedTargetUpdatedAt, 1, 100, code);
  }

  function normalizeApplicableSkuKeys(value, slotOwnership, code) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 500) fail(code);
    var keys = value.map(function (skuKey) { return text(skuKey, 1, 500, code); });
    if (new Set(keys).size !== keys.length
      || keys.some(function (skuKey, index) {
        return index > 0 && keys[index - 1] >= skuKey;
      })) fail(code);
    if (slotOwnership.level === 'sku') {
      if (keys.length !== 1 || keys[0] !== slotOwnership.key) fail(code);
    } else if (slotOwnership.level !== 'compatibility_group') {
      fail(code);
    }
    return keys;
  }

  function planSlotRole(slot, code) {
    if (!exactKeys(slot.ownership, ['level', 'key'])) fail(code);
    var applicable = normalizeApplicableSkuKeys(slot.applicableSkuKeys, slot.ownership, code);
    var ownershipKey = text(slot.ownership.key, 1, 500, code);
    if (slot.ownership.level === 'sku') {
      var prefix = 'sku:' + ownershipKey + ':';
      if (!slot.slotKey.startsWith(prefix)) fail(code);
      var suffix = slot.slotKey.slice(prefix.length);
      if (suffix === 'hero') {
        return { skuKey: ownershipKey, role: 'HERO', applicableSkuKeys: applicable };
      }
      if (suffix === 'detail' || /^detail(?:[-:][A-Za-z0-9][A-Za-z0-9._:-]*)$/u.test(suffix)) {
        return { skuKey: ownershipKey, role: 'DETAIL', applicableSkuKeys: applicable };
      }
      fail(code);
    }
    if (slot.ownership.level === 'compatibility_group') {
      var groupPrefix = 'group:' + ownershipKey + ':gallery:';
      var galleryOrdinal = slot.slotKey.startsWith(groupPrefix)
        ? slot.slotKey.slice(groupPrefix.length)
        : '';
      if (!/^[1-9][0-9]{0,2}$/u.test(galleryOrdinal)
        || Number(galleryOrdinal) > 500) fail(code);
      return { skuKey: applicable[0], role: 'DETAIL', applicableSkuKeys: applicable };
    }
    fail(code);
  }

  function normalizePlanSlot(value) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    if (!exactKeys(value, PLAN_SLOT_KEYS)) fail(code);
    var estimated = boundedCost(value.estimatedCostCents, false, code);
    var maximum = boundedCost(value.maximumCostCents, false, code);
    if (maximum < estimated) fail(code);
    var slot = {
      ordinal: nonNegativeInteger(value.ordinal, 499, code),
      slotKey: text(value.slotKey, 1, 200, code),
      goal: text(value.goal, 1, 200, code),
      ownership: value.ownership,
      applicableSkuKeys: value.applicableSkuKeys,
      estimatedCostCents: estimated,
      maximumCostCents: maximum,
    };
    return { slot: slot, classification: planSlotRole(slot, code) };
  }

  function groupPlanSlots(values) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    if (!Array.isArray(values) || values.length < 1 || values.length > 500) fail(code);
    var rows = values.map(normalizePlanSlot).sort(function (left, right) {
      return left.slot.ordinal - right.slot.ordinal;
    });
    if (new Set(rows.map(function (row) { return row.slot.ordinal; })).size !== rows.length
      || new Set(rows.map(function (row) { return row.slot.slotKey; })).size !== rows.length) {
      fail(code);
    }
    var groups = [];
    var bySku = new Map();
    rows.forEach(function (row) {
      if (row.slot.ownership.level !== 'sku') return;
      var skuKey = row.classification.skuKey;
      if (!bySku.has(skuKey)) {
        var group = { skuKey: skuKey, slots: [] };
        bySku.set(skuKey, group);
        groups.push(group);
      }
    });
    rows.forEach(function (row) {
      var skuKey = row.classification.skuKey;
      var group = bySku.get(skuKey);
      if (row.slot.ownership.level === 'compatibility_group') {
        if (!group
          || row.classification.applicableSkuKeys.some(function (member) {
            return !bySku.has(member);
          })
          || !group.slots.some(function (slot) { return slot.role === 'HERO'; })) {
          fail(code);
        }
      } else if (!group) {
        fail(code);
      }
      group.slots.push({
        ordinal: row.slot.ordinal,
        slotKey: row.slot.slotKey,
        goal: row.slot.goal,
        ownership: row.slot.ownership,
        applicableSkuKeys: row.classification.applicableSkuKeys,
        role: row.classification.role,
        estimatedCostCents: row.slot.estimatedCostCents,
        maximumCostCents: row.slot.maximumCostCents,
      });
    });
    groups.forEach(function (group) {
      if (group.slots[0].role !== 'HERO'
        || group.slots.filter(function (slot) { return slot.role === 'HERO'; }).length !== 1) {
        fail(code);
      }
    });
    return groups;
  }

  function samePlanBasis(left, right) {
    return left.planId === right.planId
      && left.planVersionId === right.planVersionId
      && left.planRevision === right.planRevision
      && JSON.stringify(left.groups) === JSON.stringify(right.groups);
  }

  function groupScopeSupported(groups) {
    var selectedSkuKeys = groups.map(function (group) { return group.skuKey; }).sort();
    return groups.every(function (group) {
      return group.slots.every(function (slot) {
        return slot.ownership.level !== 'compatibility_group'
          || JSON.stringify(slot.applicableSkuKeys) === JSON.stringify(selectedSkuKeys);
      });
    });
  }

  function validateProjection(value, launch, expectedBasis) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    if (!deeplyFrozen(value)
      || !exactKeys(value, HOSTED_PROJECTION_KEYS)
      || value.contractVersion !== HOSTED_PROJECTION_VERSION
      || value.executionMode !== 'ERP_HOSTED'
      || !exactKeys(value.binding, BINDING_KEYS)
      || !sameBinding(value.binding, workspaceBinding(launch))
      || !exactKeys(value.sourceBinding, ['snapshotId', 'supplyGoodsId', 'skuKey'])
      || value.sourceBinding.snapshotId !== launch.sourceCaptureSnapshotId
      || value.sourceBinding.supplyGoodsId !== launch.supplyGoodsId
      || !(value.sourceBinding.skuKey === null
        || value.sourceBinding.skuKey === launch.skuKey)
      || !exactKeys(value.applyPolicy, ['target', 'mode', 'writesStoreDraft'])
      || value.applyPolicy.target !== 'ERP_SOURCE_PRODUCT'
      || value.applyPolicy.mode !== 'append'
      || value.applyPolicy.writesStoreDraft !== false
      || !exactKeys(value.plan, PLAN_KEYS)
      || value.plan.status !== 'APPROVED'
      || value.plan.skuKey !== value.sourceBinding.skuKey
      || !exactPriceKeys(value.quote, [
        'pricingVersion', 'itemCount', 'estimatedCostCents', 'maximumCostCents',
      ])) fail(code);
    assertPublic(value);
    text(value.plan.id, 1, 200, code);
    text(value.plan.versionId, 1, 200, code);
    positiveInteger(value.plan.revision, code);
    sha256(value.plan.previewHash, code);
    var groups = groupPlanSlots(value.plan.slots);
    var totalSlots = groups.reduce(function (total, group) {
      return total + group.slots.length;
    }, 0);
    var quoteEstimated = boundedCost(value.quote.estimatedCostCents, false, code);
    var quoteMaximum = boundedCost(value.quote.maximumCostCents, true, code);
    if (quoteMaximum < quoteEstimated
      || value.quote.itemCount !== totalSlots
      || !Number.isSafeInteger(value.quote.itemCount)
      || value.quote.itemCount < 1) fail(code);
    text(value.quote.pricingVersion, 1, 100, code);
    var selectedGroup = groups.find(function (group) { return group.skuKey === launch.skuKey; });
    if (!selectedGroup || !selectedGroup.slots.some(function (slot) {
      return slot.slotKey === launch.slotKey && slot.role === 'HERO';
    })) fail('SS_ERP_HOSTED_WORKSPACE_CONTEXT_STALE');
    var binding = hostedBinding(launch);
    var startIntent = validIntent(value.plan.startIntent, binding, 'START', null, null);
    validateStartCommand(startIntent, value.plan, value.quote);
    var basis = {
      planId: value.plan.id,
      planVersionId: value.plan.versionId,
      planRevision: value.plan.revision,
      groups: groups,
    };
    if (expectedBasis && !samePlanBasis(expectedBasis, basis)) {
      fail('SS_ERP_HOSTED_WORKSPACE_CONTEXT_STALE');
    }
    var suite = value.suite === null ? null : validateSuite(value.suite, basis, binding);
    var supportedGroupScope = groupScopeSupported(groups);
    if (!suite && !startIntent && supportedGroupScope) fail(code);
    return {
      source: value,
      binding: binding,
      basis: basis,
      startIntent: startIntent,
      suite: suite,
      groupScopeSupported: supportedGroupScope,
    };
  }

  function validateSuite(value, basis, binding) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    if (!exactKeys(value, SUITE_KEYS)
      || !SUITE_STATUSES.includes(value.status)
      || !Array.isArray(value.slots)
      || value.slots.length !== value.itemCount
      || value.slots.length !== basis.groups.reduce(function (total, group) {
        return total + group.slots.length;
      }, 0)) fail(code);
    text(value.id, 1, 200, code);
    positiveInteger(value.revision, code);
    positiveInteger(value.itemCount, code);
    var estimated = boundedCost(value.estimatedCostCents, false, code);
    var maximum = boundedCost(value.maximumCostCents, true, code);
    if (maximum < estimated) fail(code);
    var planSlots = new Map();
    basis.groups.forEach(function (group) {
      group.slots.forEach(function (slot) { planSlots.set(slot.slotKey, slot); });
    });
    var slots = value.slots.map(function (slot) {
      return validateSuiteSlot(slot, value, planSlots, binding);
    });
    if (new Set(slots.map(function (slot) { return slot.source.id; })).size !== slots.length
      || new Set(slots.map(function (slot) { return slot.source.slotKey; })).size !== slots.length) {
      fail(code);
    }
    var continueIntent = validIntent(value.continueIntent, binding, 'CONTINUE', null, null);
    var cancelIntent = validIntent(value.cancelIntent, binding, 'CANCEL', null, null);
    validateSuiteCommand(continueIntent, value);
    validateSuiteCommand(cancelIntent, value);
    return {
      source: value,
      id: value.id,
      status: value.status,
      revision: value.revision,
      continueIntent: continueIntent,
      cancelIntent: cancelIntent,
      slots: slots,
    };
  }

  function validateSuiteSlot(value, suite, planSlots, binding) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID';
    if (!exactKeys(value, SUITE_SLOT_KEYS)
      || !SLOT_STATUSES.includes(value.status)
      || !REVIEW_STATUSES.includes(value.reviewStatus)
      || typeof value.previewAvailable !== 'boolean'
      || !exactKeys(value.ownership, ['level', 'key'])) fail(code);
    var classification = planSlotRole(value, code);
    var planSlot = planSlots.get(value.slotKey);
    if (!planSlot
      || planSlot.ordinal !== value.ordinal
      || planSlot.goal !== value.goal
      || planSlot.role !== classification.role
      || value.ownership.level !== planSlot.ownership.level
      || value.ownership.key !== planSlot.ownership.key
      || JSON.stringify(classification.applicableSkuKeys)
        !== JSON.stringify(planSlot.applicableSkuKeys)) fail(code);
    identifier(value.id, 190, code);
    positiveInteger(value.revision, code);
    nonNegativeInteger(value.attempt, 1000, code);
    var output = value.output;
    if (output !== null) {
      if (!exactKeys(output, ['assetId', 'mimeType', 'width', 'height'])
        || !['image/png', 'image/jpeg', 'image/webp'].includes(output.mimeType)
        || !(output.width === null || Number.isSafeInteger(output.width) && output.width > 0)
        || !(output.height === null || Number.isSafeInteger(output.height) && output.height > 0)) {
        fail(code);
      }
      identifier(output.assetId, 200, code);
    }
    if (value.previewAvailable !== Boolean(output)) fail(code);
    var terminalWithOutput = value.status === 'SUCCEEDED';
    if (terminalWithOutput !== Boolean(output)
      || (terminalWithOutput && value.reviewStatus === 'NOT_READY')
      || (!terminalWithOutput && value.reviewStatus !== 'NOT_READY')
      || (terminalWithOutput
        && (typeof value.workflowId !== 'string'
          || !Number.isSafeInteger(value.workflowRevision)
          || value.workflowRevision < 1))) fail(code);
    var retryIntent = validIntent(value.retryIntent, binding, 'RETRY_SLOT', value.id, null);
    validateRetryCommand(retryIntent, value, suite);
    var reviewIntents = null;
    if (value.reviewIntents !== null) {
      if (!exactKeys(value.reviewIntents, ['APPROVE', 'REJECT'])) fail(code);
      reviewIntents = {
        APPROVE: validIntent(
          value.reviewIntents.APPROVE,
          binding,
          'REVIEW_SLOT',
          value.id,
          'APPROVE',
        ),
        REJECT: validIntent(
          value.reviewIntents.REJECT,
          binding,
          'REVIEW_SLOT',
          value.id,
          'REJECT',
        ),
      };
    }
    if ((value.reviewStatus === 'PENDING') !== Boolean(reviewIntents)) fail(code);
    if (reviewIntents) {
      validateOutputCommand(reviewIntents.APPROVE, value, suite, 'REVIEW_SLOT');
      validateOutputCommand(reviewIntents.REJECT, value, suite, 'REVIEW_SLOT');
    }
    var applyIntent = validIntent(value.applyIntent, binding, 'APPLY_SLOT', value.id, null);
    validateOutputCommand(applyIntent, value, suite, 'APPLY_SLOT');
    return {
      source: value,
      planSlot: planSlot,
      attemptId: 'hosted:' + value.id + ':' + value.attempt,
      output: output,
      retryIntent: retryIntent,
      reviewIntents: reviewIntents,
      applyIntent: applyIntent,
    };
  }

  function bootstrapFor(authority, launch) {
    var bootstrap = {
      contractVersion: WORKSPACE_VERSION,
      binding: workspaceBinding(launch),
      executionMode: 'ERP_HOSTED',
      availableExecutionModes: ['ERP_HOSTED', 'BYOK'],
      dispatched: authority.suite !== null,
      selectedSkuKey: launch.skuKey,
      selectedSlotKey: launch.slotKey,
      globalReferenceIds: [],
      libraryItems: [],
      skus: authority.basis.groups.map(function (group) {
        return {
          skuKey: group.skuKey,
          label: group.skuKey,
          slots: group.slots.map(function (slot) {
            return {
              slotKey: slot.slotKey,
              role: slot.role,
              prompt: '',
              negativePrompt: '',
              referenceIds: null,
              alternatives: [],
              selectedAttemptId: null,
              assignmentScope: slot.ownership.level === 'compatibility_group'
                ? 'PRODUCT' : 'SKU',
              applicableSkuKeys: [...slot.applicableSkuKeys],
            };
          }),
        };
      }),
    };
    assertPublic(bootstrap);
    return deepFreeze(bootstrap);
  }

  function workspaceAlternative(slot, suiteStatus) {
    var source = slot.source;
    var state;
    var mediaId = null;
    var errorCode = null;
    if (suiteStatus === 'CANCEL_REQUESTED'
      && ['PLANNED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(source.status)) {
      state = 'WAITING';
    } else if (source.status === 'PLANNED' || source.status === 'QUEUED') {
      state = 'QUEUED';
    } else if (source.status === 'RUNNING' || source.status === 'CANCEL_REQUESTED') {
      state = 'WAITING';
    } else if (source.status === 'FAILED') {
      state = slot.retryIntent ? 'FAILED_RETRYABLE' : 'FAILED_FINAL';
      errorCode = slot.retryIntent ? 'HOSTED_RETRY_AVAILABLE' : 'HOSTED_EXECUTION_FAILED';
    } else if (source.status === 'CANCELLED') {
      state = 'CANCELLED';
    } else if (source.reviewStatus === 'PENDING') {
      state = 'CANDIDATE_READY';
      mediaId = slot.output.assetId;
    } else if (source.reviewStatus === 'APPROVED') {
      state = 'APPROVED';
      mediaId = slot.output.assetId;
    } else if (source.reviewStatus === 'REJECTED') {
      state = 'REJECTED';
      mediaId = slot.output.assetId;
    } else {
      fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
    }
    return {
      attemptId: slot.attemptId,
      state: state,
      mediaId: mediaId,
      errorCode: errorCode,
    };
  }

  function schedulerFor(suite, alternatives) {
    if (!suite) return 'READY';
    if (suite.status === 'PLANNED') return 'PAUSED';
    if (suite.status === 'QUEUED' || suite.status === 'RUNNING') return 'RUNNING';
    if (suite.status === 'CANCEL_REQUESTED') return 'PAUSING';
    var states = alternatives.map(function (item) { return item.state; });
    var derived = states.some(function (state) {
      return ['CANDIDATE_READY', 'APPROVED', 'REJECTED'].includes(state);
    }) ? 'REVIEW'
      : states.length > 0 && states.every(function (state) { return state === 'CANCELLED'; })
        ? 'CANCELLED'
        : states.some(function (state) {
          return ['FAILED_RETRYABLE', 'FAILED_FINAL'].includes(state);
        }) ? 'FAILED'
          : 'READY';
    if ((suite.status === 'SUCCEEDED' && derived !== 'REVIEW')
      || (suite.status === 'FAILED' && derived !== 'FAILED')
      || (suite.status === 'CANCELLED'
        && !['REVIEW', 'CANCELLED', 'FAILED'].includes(derived))
      || (suite.status === 'PARTIAL_FAILURE' && !['REVIEW', 'FAILED'].includes(derived))) {
      fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
    }
    return derived;
  }

  function schedulerCompatible(schedulerState, alternatives) {
    var states = alternatives.map(function (item) { return item.state; });
    var allowed;
    if (states.some(function (state) {
      return ['SUBMITTING', 'WAITING', 'INGESTING'].includes(state);
    })) {
      allowed = ['RUNNING', 'PAUSING'];
    } else if (states.includes('QUEUED')) {
      allowed = ['RUNNING', 'PAUSED'];
    } else if (states.some(function (state) { return state === 'UNKNOWN_OUTCOME'; })) {
      allowed = ['FAILED'];
    } else if (states.some(function (state) {
      return ['CANDIDATE_READY', 'APPROVED', 'INGESTING', 'INGESTED', 'BOUND', 'REJECTED']
        .includes(state);
    })) {
      allowed = ['REVIEW'];
    } else if (states.length > 0
      && states.every(function (state) { return state === 'CANCELLED'; })) {
      allowed = ['CANCELLED'];
    } else if (states.some(function (state) {
      return ['FAILED_RETRYABLE', 'FAILED_FINAL', 'EXPIRED'].includes(state);
    })) {
      allowed = ['FAILED'];
    } else {
      allowed = ['READY'];
    }
    if (!allowed.includes(schedulerState)) {
      fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
    }
  }

  function runtimeFor(authority, launch, revision) {
    var suite = authority.suite;
    var libraryItems = [];
    var runtimeSlots = [];
    var alternatives = [];
    if (suite) {
      var assetIds = new Set();
      suite.slots.forEach(function (slot) {
        var alternative = workspaceAlternative(slot, suite.status);
        alternatives.push(alternative);
        if (alternative.mediaId !== null) {
          if (assetIds.has(alternative.mediaId)) {
            fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_INVALID');
          }
          assetIds.add(alternative.mediaId);
          libraryItems.push({
            mediaId: alternative.mediaId,
            sourceType: 'GENERATED',
            label: slot.source.goal,
            secondaryLabel: slot.source.reviewStatus,
            skuKeys: [...slot.source.applicableSkuKeys],
            referenceEligible: false,
          });
        }
        runtimeSlots.push({
          slotKey: slot.source.slotKey,
          status: alternative.state,
          alternatives: [alternative],
          selectedAttemptId: alternative.state === 'APPROVED'
            ? alternative.attemptId
            : null,
          slotRevision: slot.source.revision,
        });
      });
    }
    var schedulerState = schedulerFor(suite, alternatives);
    schedulerCompatible(schedulerState, alternatives);
    var disabledReason = suite && suite.status === 'PLANNED'
      ? !authority.groupScopeSupported
        ? 'HOSTED_GROUP_SCOPE_UNSUPPORTED'
        : !suite.continueIntent ? 'HOSTED_CONTINUE_UNAVAILABLE' : null
      : null;
    var runtime = {
      contractVersion: WORKSPACE_RUNTIME_VERSION,
      binding: workspaceBinding(launch),
      revision: revision,
      task: { schedulerState: schedulerState, disabledReason: disabledReason },
      libraryItems: libraryItems,
      slots: runtimeSlots,
    };
    assertPublic(runtime);
    return deepFreeze(runtime);
  }

  function validateWorkspaceAction(value, launch, runtimeRevision) {
    var code = 'SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID';
    if (!exactKeys(value, WORKSPACE_ACTION_KEYS)
      || value.contractVersion !== WORKSPACE_ACTION_VERSION
      || !WORKSPACE_ACTIONS.includes(value.action)
      || !exactKeys(value.binding, BINDING_KEYS)
      || !sameBinding(value.binding, workspaceBinding(launch))
      || !Number.isSafeInteger(value.expectedWorkspaceRevision)
      || value.expectedWorkspaceRevision < 1
      || value.expectedRuntimeRevision !== runtimeRevision) fail(code);
    identifier(value.commandId, 200, code);
    return value;
  }

  function resolved(intent, confirmation) {
    return deepFreeze({ intent: intent, confirmation: confirmation });
  }

  function createMapper(options) {
    if (!exactKeys(options, ['launchContext', 'projection'])) {
      fail('SS_ERP_HOSTED_WORKSPACE_DEPENDENCY_UNAVAILABLE');
    }
    var launch = normalizeLaunchContext(options.launchContext);
    var current = validateProjection(options.projection, launch, null);
    var basis = current.basis;
    var lastRuntimeRevision = 0;
    var lastSuiteId = current.suite && current.suite.id;
    var lastSuiteRevision = current.suite ? current.suite.revision : 0;
    var lastSuiteFingerprint = current.suite
      ? JSON.stringify(current.source.suite)
      : null;

    function projectRuntime(value) {
      if (!exactKeys(value, ['projection', 'revision'])
        || !Number.isSafeInteger(value.revision)
        || value.revision < 1) fail('SS_ERP_HOSTED_WORKSPACE_RUNTIME_INVALID');
      if (value.revision <= lastRuntimeRevision) {
        fail('SS_ERP_HOSTED_WORKSPACE_RUNTIME_STALE');
      }
      var next = validateProjection(value.projection, launch, basis);
      if (lastSuiteId && (!next.suite || next.suite.id !== lastSuiteId)) {
        fail('SS_ERP_HOSTED_WORKSPACE_CONTEXT_STALE');
      }
      if (next.suite && lastSuiteRevision > next.suite.revision) {
        fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_STALE');
      }
      if (next.suite
        && lastSuiteRevision === next.suite.revision
        && lastSuiteFingerprint !== null
        && JSON.stringify(next.source.suite) !== lastSuiteFingerprint) {
        fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_REVISION_REUSED');
      }
      if (current.suite && next.suite) {
        var priorSlotRevisions = new Map(current.suite.slots.map(function (slot) {
          return [slot.source.id, slot.source.revision];
        }));
        next.suite.slots.forEach(function (slot) {
          var prior = priorSlotRevisions.get(slot.source.id);
          if (prior && slot.source.revision < prior) {
            fail('SS_ERP_HOSTED_WORKSPACE_AUTHORITY_STALE');
          }
        });
      }
      var runtime = runtimeFor(next, launch, value.revision);
      current = next;
      lastRuntimeRevision = value.revision;
      if (next.suite) {
        lastSuiteId = next.suite.id;
        lastSuiteRevision = next.suite.revision;
        lastSuiteFingerprint = JSON.stringify(next.source.suite);
      }
      return runtime;
    }

    function requireRuntimeAction(value, action) {
      if (lastRuntimeRevision < 1) fail('SS_ERP_HOSTED_WORKSPACE_RUNTIME_REQUIRED');
      var workspaceIntent = validateWorkspaceAction(value, launch, lastRuntimeRevision);
      if (workspaceIntent.action !== action) fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      if (!current.suite) fail('SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE');
      return workspaceIntent;
    }

    function requireCurrentSlot(workspaceIntent) {
      if (typeof workspaceIntent.slotKey !== 'string'
        || typeof workspaceIntent.attemptId !== 'string'
        || !Number.isSafeInteger(workspaceIntent.expectedSlotRevision)
        || workspaceIntent.expectedSlotRevision < 1) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      }
      var slot = current.suite.slots.find(function (candidate) {
        return candidate.source.slotKey === workspaceIntent.slotKey
          && candidate.attemptId === workspaceIntent.attemptId;
      });
      if (!slot || slot.source.revision !== workspaceIntent.expectedSlotRevision) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_STALE');
      }
      return slot;
    }

    function lookupPauseIntent(value) {
      var input = requireRuntimeAction(value, 'PAUSE_AFTER_CURRENT');
      if (input.slotKey !== null || input.attemptId !== null
        || input.expectedSlotRevision !== null
        || input.externalChargeAcknowledgement !== null) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      }
      fail('SS_ERP_HOSTED_WORKSPACE_PAUSE_UNSUPPORTED');
    }

    function lookupContinueIntent(value) {
      var input = requireRuntimeAction(value, 'CONTINUE');
      if (input.slotKey !== null || input.attemptId !== null
        || input.expectedSlotRevision !== null
        || input.externalChargeAcknowledgement !== null) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      }
      if (!current.groupScopeSupported) {
        fail('SS_ERP_HOSTED_WORKSPACE_GROUP_SCOPE_UNSUPPORTED');
      }
      if (!current.suite.continueIntent) fail('SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE');
      return resolved(current.suite.continueIntent, null);
    }

    function lookupCancelIntent(value) {
      var input = requireRuntimeAction(value, 'CANCEL_QUEUED');
      var slot = requireCurrentSlot(input);
      if (input.externalChargeAcknowledgement !== null
        || workspaceAlternative(slot, current.suite.status).state !== 'QUEUED') {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      }
      var queued = current.suite.slots.filter(function (candidate) {
        return workspaceAlternative(candidate, current.suite.status).state === 'QUEUED';
      });
      if (queued.length !== 1 || queued[0] !== slot) {
        fail('SS_ERP_HOSTED_WORKSPACE_CANCEL_SCOPE_UNSUPPORTED');
      }
      if (!current.suite.cancelIntent) fail('SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE');
      return resolved(current.suite.cancelIntent, null);
    }

    function lookupReviewIntent(value) {
      if (lastRuntimeRevision < 1) fail('SS_ERP_HOSTED_WORKSPACE_RUNTIME_REQUIRED');
      var input = validateWorkspaceAction(value, launch, lastRuntimeRevision);
      if (!['KEEP_ATTEMPT', 'REJECT_ATTEMPT'].includes(input.action)) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      }
      if (!current.suite || input.externalChargeAcknowledgement !== null) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE');
      }
      var slot = requireCurrentSlot(input);
      if (workspaceAlternative(slot, current.suite.status).state !== 'CANDIDATE_READY'
        || !slot.reviewIntents) fail('SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE');
      return resolved(
        input.action === 'KEEP_ATTEMPT'
          ? slot.reviewIntents.APPROVE
          : slot.reviewIntents.REJECT,
        null,
      );
    }

    function lookupRegenerateIntent(value, confirmation) {
      var input = requireRuntimeAction(value, 'REGENERATE_SLOT');
      if (input.attemptId !== null
        || !Number.isSafeInteger(input.expectedSlotRevision)
        || input.expectedSlotRevision < 1
        || !exactKeys(input.externalChargeAcknowledgement, ['warningVersion', 'confirmed'])
        || input.externalChargeAcknowledgement.warningVersion !== HOSTED_CHARGE_WARNING_VERSION
        || input.externalChargeAcknowledgement.confirmed !== true) {
        fail('SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED');
      }
      if (!current.groupScopeSupported) {
        fail('SS_ERP_HOSTED_WORKSPACE_GROUP_SCOPE_UNSUPPORTED');
      }
      var slot = current.suite.slots.find(function (candidate) {
        return candidate.source.slotKey === input.slotKey;
      });
      if (!slot || slot.source.revision !== input.expectedSlotRevision || !slot.retryIntent) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_STALE');
      }
      var maximum = slot.retryIntent.commandTemplate.acceptedAdditionalMaximumCostCents;
      if (!exactKeys(confirmation, ['confirmed', 'maximumCostCents'])
        || confirmation.confirmed !== true
        || confirmation.maximumCostCents !== maximum) {
        fail('SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED');
      }
      return resolved(slot.retryIntent, deepFreeze({
        confirmed: true,
        maximumCostCents: maximum,
      }));
    }

    function lookupWorkspaceIntent(value, confirmation) {
      if (value && value.action === 'APPLY_SLOT') {
        fail('SS_ERP_HOSTED_WORKSPACE_DEDICATED_ASSIGNMENT_REQUIRED');
      }
      if (!value || !WORKSPACE_ACTIONS.includes(value.action)) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_INVALID');
      }
      if (value.action === 'PAUSE_AFTER_CURRENT') return lookupPauseIntent(value);
      if (value.action === 'CONTINUE') return lookupContinueIntent(value);
      if (value.action === 'CANCEL_QUEUED') return lookupCancelIntent(value);
      if (value.action === 'KEEP_ATTEMPT' || value.action === 'REJECT_ATTEMPT') {
        return lookupReviewIntent(value);
      }
      return lookupRegenerateIntent(value, confirmation);
    }

    function lookupStartIntent(confirmation) {
      if (!current.groupScopeSupported) {
        fail('SS_ERP_HOSTED_WORKSPACE_GROUP_SCOPE_UNSUPPORTED');
      }
      if (!current.startIntent || current.suite) {
        fail('SS_ERP_HOSTED_WORKSPACE_ACTION_UNAVAILABLE');
      }
      var maximum = current.startIntent.commandTemplate.acceptedMaximumCostCents;
      if (!exactKeys(confirmation, ['confirmed', 'maximumCostCents'])
        || confirmation.confirmed !== true
        || confirmation.maximumCostCents !== maximum) {
        fail('SS_ERP_HOSTED_WORKSPACE_COST_CONFIRMATION_REQUIRED');
      }
      return resolved(current.startIntent, deepFreeze({
        confirmed: true,
        maximumCostCents: maximum,
      }));
    }

    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      createBootstrap: function () { return bootstrapFor(current, launch); },
      projectRuntime: projectRuntime,
      lookupStartIntent: lookupStartIntent,
      lookupWorkspaceIntent: lookupWorkspaceIntent,
      lookupPauseIntent: lookupPauseIntent,
      lookupContinueIntent: lookupContinueIntent,
      lookupCancelIntent: lookupCancelIntent,
      lookupReviewIntent: lookupReviewIntent,
      lookupRegenerateIntent: lookupRegenerateIntent,
    });
  }

  global.SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKSPACE_PROJECTION = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    HOSTED_PROJECTION_VERSION: HOSTED_PROJECTION_VERSION,
    WORKSPACE_VERSION: WORKSPACE_VERSION,
    WORKSPACE_RUNTIME_VERSION: WORKSPACE_RUNTIME_VERSION,
    HOSTED_CHARGE_WARNING_VERSION: HOSTED_CHARGE_WARNING_VERSION,
    createMapper: createMapper,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
