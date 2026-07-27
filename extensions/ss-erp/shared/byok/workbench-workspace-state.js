(function exposeByokWorkbenchWorkspaceState(global) {
  'use strict';

  var workbench = global.SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT;
  if (!workbench || !workbench.LIMITS || typeof workbench.parseExecutionMode !== 'function') {
    throw new Error('SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT is required');
  }

  var CONTRACT_VERSION = 'extension-byok-workbench-workspace-state/v1';
  var RUNTIME_CONTRACT_VERSION = 'extension-byok-workbench-workspace-runtime/v1';
  var ACTION_INTENT_CONTRACT_VERSION = 'extension-byok-workbench-action-intent/v1';
  var ACTION_OUTCOME_CONTRACT_VERSION = 'extension-byok-workbench-action-outcome/v1';
  var PUBLISH_PROJECTION_CONTRACT_VERSION =
    'extension-byok-workbench-publish-projection/v1';
  var EXTERNAL_CHARGE_WARNING_VERSION = 'external-provider-charge/v1';
  var DEFAULT_DISABLED_REASON = 'BATCH_COORDINATOR_NOT_READY';
  var DEFAULT_PUBLISH_DISABLED_REASON = 'PUBLISH_COORDINATOR_NOT_READY';
  var MEDIA_SOURCE_TYPES = Object.freeze(['CAPTURED', 'SKU', 'UPLOADED', 'GENERATED']);
  var SLOT_ROLES = Object.freeze(['HERO', 'DETAIL']);
  var KEYBOARD_SELECTION_KEYS = Object.freeze([
    'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End',
  ]);
  var KEYBOARD_SLOT_ORDER_KEYS = Object.freeze(['ArrowUp', 'ArrowDown', 'Home', 'End']);
  var ACTION_INTENTS = Object.freeze([
    'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
    'REJECT_ATTEMPT', 'REGENERATE_SLOT',
  ]);
  var PUBLISH_DRAFT_STATES = Object.freeze(['CURRENT', 'STALE', 'UNKNOWN']);
  var ALTERNATIVE_STATES = Object.freeze([
    'QUEUED', 'SUBMITTING', 'WAITING', 'CANDIDATE_READY', 'APPROVED', 'REJECTED',
    'INGESTING', 'INGESTED', 'BOUND', 'FAILED_RETRYABLE', 'FAILED_FINAL',
    'UNKNOWN_OUTCOME', 'CANCELLED', 'EXPIRED',
  ]);
  var TASK_STATES = Object.freeze([
    'READY', 'RUNNING', 'PAUSING', 'PAUSED', 'REVIEW', 'CANCELLED', 'FAILED',
  ]);
  var SLOT_STATUSES = Object.freeze(['EMPTY'].concat(ALTERNATIVE_STATES));
  var SELECTABLE_ALTERNATIVE_STATES = Object.freeze([
    'CANDIDATE_READY', 'APPROVED', 'INGESTING', 'INGESTED', 'BOUND',
  ]);
  var ACTIVE_ALTERNATIVE_STATES = Object.freeze([
    'QUEUED', 'SUBMITTING', 'WAITING', 'INGESTING',
  ]);
  var PROMPT_DISABLED_REASONS = Object.freeze([
    'SLOT_EXECUTION_FROZEN',
    'SLOT_EXECUTION_ACTIVE',
    'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
  ]);
  var REFERENCE_DISABLED_REASONS = Object.freeze([
    'GLOBAL_REFERENCES_FROZEN',
    'SLOT_EXECUTION_FROZEN',
    'SLOT_EXECUTION_ACTIVE',
    'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
  ]);
  var LIMITS = Object.freeze({
    maxSkus: 50,
    maxSlots: 500,
    maxLibraryItems: 1000,
    maxAlternatives: 500,
    maxAlternativesPerSlot: 100,
    maxReferences: workbench.LIMITS.maxReferenceImages,
  });

  var INPUT_KEYS = Object.freeze([
    'contractVersion', 'binding', 'executionMode', 'dispatched', 'selectedSkuKey',
    'selectedSlotKey', 'globalReferenceIds', 'libraryItems', 'skus',
  ]);
  var BINDING_KEYS = Object.freeze([
    'shopId', 'workflowId', 'draftRevision', 'draftVersion',
  ]);
  var LIBRARY_ITEM_KEYS = Object.freeze([
    'mediaId', 'sourceType', 'label', 'secondaryLabel', 'skuKeys', 'referenceEligible',
  ]);
  var SKU_KEYS = Object.freeze(['skuKey', 'label', 'slots']);
  var SLOT_KEYS = Object.freeze([
    'slotKey', 'role', 'prompt', 'negativePrompt', 'referenceIds', 'alternatives',
    'selectedAttemptId',
  ]);
  var ALTERNATIVE_KEYS = Object.freeze([
    'attemptId', 'state', 'mediaId', 'errorCode',
  ]);
  var RUNTIME_KEYS = Object.freeze([
    'contractVersion', 'binding', 'revision', 'task', 'libraryItems', 'slots',
  ]);
  var RUNTIME_TASK_KEYS = Object.freeze(['schedulerState', 'disabledReason']);
  var RUNTIME_SLOT_KEYS = Object.freeze([
    'slotKey', 'status', 'alternatives', 'selectedAttemptId',
  ]);
  var RUNTIME_SLOT_REVISION_KEYS = Object.freeze([
    'slotKey', 'status', 'alternatives', 'selectedAttemptId', 'slotRevision',
  ]);
  var PROMPT_UPDATE_KEYS = Object.freeze(['prompt', 'negativePrompt']);
  var CHARGE_ACKNOWLEDGEMENT_KEYS = Object.freeze(['warningVersion', 'confirmed']);
  var PUBLISH_PROJECTION_KEYS = Object.freeze([
    'contractVersion', 'binding', 'revision', 'expectedWorkspaceRevision',
    'expectedRuntimeRevision', 'draftState', 'disabledReason', 'orderedMedia',
  ]);
  var PUBLISH_MEDIA_ROW_KEYS = Object.freeze([
    'skuKey', 'slotKey', 'position', 'role', 'attemptId', 'mediaId',
  ]);

  function workspaceError(code, message) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokWorkbenchWorkspaceStateError';
    error.code = code;
    return error;
  }

  function invalid(message) {
    throw workspaceError('SS_ERP_BYOK_WORKSPACE_INPUT_INVALID', message);
  }

  function selectionInvalid(message) {
    throw workspaceError('SS_ERP_BYOK_WORKSPACE_SELECTION_INVALID', message);
  }

  function actionUnavailable(reason, message) {
    var error = workspaceError(
      'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE',
      message || 'workspace action is unavailable for the current state',
    );
    error.reason = reason;
    throw error;
  }

  function referenceLocked(reason) {
    var error = workspaceError(
      'SS_ERP_BYOK_WORKSPACE_REFERENCE_LOCKED',
      'reference selection cannot change after its execution input is frozen',
    );
    error.reason = reason;
    throw error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    if (!isRecord(value)) return false;
    var actual = Object.keys(value);
    return actual.length === keys.length
      && actual.every(function (key) { return keys.includes(key); });
  }

  function unsafeText(value) {
    return /(?:https?|blob|data|file|ftp):/iu.test(value)
      || /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/u.test(value)
      || /\bsk-[A-Za-z0-9_-]{8,}\b/u.test(value)
      || /(?:api[_ -]?key|authorization|client[_ -]?secret)\s*[:=]/iu.test(value);
  }

  function hasDisallowedControl(value) {
    return Array.from(value).some(function (character) {
      var code = character.charCodeAt(0);
      return (code < 32 && code !== 10) || code === 127;
    });
  }

  function text(value, minimum, maximum, label) {
    if (typeof value !== 'string') invalid(label + ' is invalid');
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value || normalized.length < minimum || normalized.length > maximum
      || hasDisallowedControl(normalized)
      || unsafeText(normalized)) {
      invalid(label + ' is invalid');
    }
    return normalized;
  }

  function identifier(value, maximum, label) {
    var normalized = text(value, 1, maximum, label);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)) {
      invalid(label + ' is invalid');
    }
    return normalized;
  }

  function nullableIdentifier(value, maximum, label) {
    return value === null ? null : identifier(value, maximum, label);
  }

  function contextKey(value, maximum, label) {
    var normalized = text(value, 1, maximum * 2, label);
    if (Array.from(normalized).length > maximum
      || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(normalized)) {
      invalid(label + ' is invalid');
    }
    return normalized;
  }

  function nullableContextKey(value, maximum, label) {
    return value === null ? null : contextKey(value, maximum, label);
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS)
      || !Number.isSafeInteger(value.draftRevision)
      || value.draftRevision < 1
      || !Number.isSafeInteger(value.draftVersion)
      || value.draftVersion < 1) {
      invalid('workspace binding is invalid');
    }
    return {
      shopId: contextKey(value.shopId, 200, 'binding shop ID'),
      workflowId: contextKey(value.workflowId, 200, 'binding workflow ID'),
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
    };
  }

  function sameBinding(left, right) {
    return left.shopId === right.shopId
      && left.workflowId === right.workflowId
      && left.draftRevision === right.draftRevision
      && left.draftVersion === right.draftVersion;
  }

  function cloneBinding(value) {
    return {
      shopId: value.shopId,
      workflowId: value.workflowId,
      draftRevision: value.draftRevision,
      draftVersion: value.draftVersion,
    };
  }

  function requireMatchingBinding(expected, value) {
    var actual = normalizeBinding(value);
    if (!sameBinding(expected, actual)) {
      throw workspaceError(
        'SS_ERP_BYOK_WORKSPACE_BINDING_MISMATCH',
        'workspace event binding does not match the active draft',
      );
    }
    return actual;
  }

  function unique(values, label) {
    if (new Set(values).size !== values.length) invalid(label + ' contains duplicates');
    return values;
  }

  function sameStringArray(left, right) {
    return left.length === right.length
      && left.every(function (value, index) { return value === right[index]; });
  }

  function deepFreeze(value, seen) {
    if (!value || typeof value !== 'object') return value;
    var visited = seen || new Set();
    if (visited.has(value)) return value;
    visited.add(value);
    Object.keys(value).forEach(function (key) { deepFreeze(value[key], visited); });
    return Object.freeze(value);
  }

  function normalizeSkuKeyList(value, knownSkuKeys, label) {
    if (!Array.isArray(value) || value.length > LIMITS.maxSkus) invalid(label + ' is invalid');
    return unique(value.map(function (skuKey) {
      var normalized = contextKey(skuKey, 500, label + ' item');
      if (!knownSkuKeys.has(normalized)) invalid(label + ' contains an unknown SKU');
      return normalized;
    }), label);
  }

  function normalizeLibraryItem(value, knownSkuKeys) {
    if (!exactKeys(value, LIBRARY_ITEM_KEYS)) invalid('library item is invalid');
    var sourceType = value.sourceType;
    if (!MEDIA_SOURCE_TYPES.includes(sourceType)) invalid('library source type is invalid');
    if (typeof value.referenceEligible !== 'boolean') {
      invalid('library reference eligibility is invalid');
    }
    var item = {
      mediaId: identifier(value.mediaId, 200, 'media ID'),
      sourceType: sourceType,
      label: text(value.label, 1, 200, 'library label'),
      secondaryLabel: text(value.secondaryLabel, 0, 200, 'library secondary label'),
      skuKeys: normalizeSkuKeyList(value.skuKeys, knownSkuKeys, 'library SKU keys'),
      referenceEligible: value.referenceEligible,
    };
    if (sourceType === 'SKU' && item.skuKeys.length === 0) {
      invalid('SKU library media must identify at least one SKU');
    }
    return item;
  }

  function normalizeLibrary(value, knownSkuKeys) {
    if (!Array.isArray(value) || value.length > LIMITS.maxLibraryItems) {
      invalid('library items are invalid');
    }
    var items = value.map(function (item) { return normalizeLibraryItem(item, knownSkuKeys); });
    unique(items.map(function (item) { return item.mediaId; }), 'library media IDs');
    return items;
  }

  function libraryMap(items) {
    return new Map(items.map(function (item) { return [item.mediaId, item]; }));
  }

  function referenceCompatible(item, skuKey) {
    return item.skuKeys.length === 0
      || (skuKey !== null && item.skuKeys.includes(skuKey));
  }

  function generatedMediaCompatible(item, skuKey) {
    return skuKey !== null && item.skuKeys.includes(skuKey);
  }

  function normalizeReferenceIds(value, mediaById, label, skuKey) {
    if (!Array.isArray(value) || value.length > LIMITS.maxReferences) {
      invalid(label + ' is invalid');
    }
    var ids = unique(value.map(function (mediaId) {
      return identifier(mediaId, 200, label + ' item');
    }), label);
    ids.forEach(function (mediaId) {
      var item = mediaById.get(mediaId);
      if (!item || item.referenceEligible !== true || !referenceCompatible(item, skuKey)) {
        invalid(label + ' contains unavailable media');
      }
    });
    return ids;
  }

  function normalizeAlternative(value, mediaById, skuKey) {
    if (!exactKeys(value, ALTERNATIVE_KEYS)) invalid('alternative is invalid');
    if (!ALTERNATIVE_STATES.includes(value.state)) invalid('alternative state is invalid');
    var mediaId = nullableIdentifier(value.mediaId, 200, 'alternative media ID');
    var errorCode = nullableIdentifier(value.errorCode, 200, 'alternative error code');
    if (mediaId !== null) {
      var item = mediaById.get(mediaId);
      if (!item || item.sourceType !== 'GENERATED') {
        invalid('alternative media must be a generated library item');
      }
      if (!generatedMediaCompatible(item, skuKey)) {
        invalid('alternative media does not belong to the target SKU');
      }
    }
    if (SELECTABLE_ALTERNATIVE_STATES.includes(value.state) && mediaId === null) {
      invalid('candidate alternative media is required');
    }
    if (!SELECTABLE_ALTERNATIVE_STATES.includes(value.state)
      && value.state !== 'REJECTED' && mediaId !== null) {
      invalid('non-candidate alternative media is invalid');
    }
    return {
      attemptId: identifier(value.attemptId, 200, 'attempt ID'),
      state: value.state,
      mediaId: mediaId,
      errorCode: errorCode,
    };
  }

  function normalizeAlternatives(value, mediaById, skuKey) {
    if (!Array.isArray(value) || value.length > LIMITS.maxAlternativesPerSlot) {
      invalid('alternatives are invalid');
    }
    var alternatives = value.map(function (item) {
      return normalizeAlternative(item, mediaById, skuKey);
    });
    unique(alternatives.map(function (item) { return item.attemptId; }), 'alternative attempt IDs');
    return alternatives;
  }

  function selectableAlternative(alternative) {
    return Boolean(alternative)
      && SELECTABLE_ALTERNATIVE_STATES.includes(alternative.state)
      && alternative.mediaId !== null;
  }

  function sameAlternatives(left, right) {
    return left.length === right.length && left.every(function (alternative, index) {
      var candidate = right[index];
      return candidate
        && alternative.attemptId === candidate.attemptId
        && alternative.state === candidate.state
        && alternative.mediaId === candidate.mediaId
        && alternative.errorCode === candidate.errorCode;
    });
  }

  function normalizeSelectedAttempt(value, alternatives) {
    var selectedAttemptId = nullableIdentifier(value, 200, 'selected attempt ID');
    if (selectedAttemptId === null) return null;
    var selected = alternatives.find(function (item) {
      return item.attemptId === selectedAttemptId;
    });
    if (!selectableAlternative(selected)) invalid('selected attempt is unavailable');
    return selectedAttemptId;
  }

  function derivedSlotStatus(alternatives, selectedAttemptId) {
    if (alternatives.some(function (alternative) {
      return alternative.state === 'UNKNOWN_OUTCOME';
    })) return 'UNKNOWN_OUTCOME';
    if (selectedAttemptId !== null) {
      var selected = alternatives.find(function (item) {
        return item.attemptId === selectedAttemptId;
      });
      if (selected) return selected.state;
    }
    return alternatives.length > 0 ? alternatives[alternatives.length - 1].state : 'EMPTY';
  }

  function normalizeInitialSlot(value, skuKey, mediaById) {
    if (!exactKeys(value, SLOT_KEYS)) invalid('workspace slot is invalid');
    if (!SLOT_ROLES.includes(value.role)) invalid('slot role is invalid');
    var alternatives = normalizeAlternatives(value.alternatives, mediaById, skuKey);
    var selectedAttemptId = normalizeSelectedAttempt(value.selectedAttemptId, alternatives);
    var referenceOverrideIds = value.referenceIds === null
      ? null
      : normalizeReferenceIds(value.referenceIds, mediaById, 'slot reference IDs', skuKey);
    return {
      slotKey: contextKey(value.slotKey, 200, 'slot key'),
      skuKey: skuKey,
      role: value.role,
      prompt: text(value.prompt, 0, workbench.LIMITS.maxPromptCharacters, 'slot Prompt'),
      negativePrompt: text(
        value.negativePrompt,
        0,
        workbench.LIMITS.maxNegativePromptCharacters,
        'slot negative Prompt',
      ),
      referenceOverrideIds: referenceOverrideIds,
      alternatives: alternatives,
      selectedAttemptId: selectedAttemptId,
      status: derivedSlotStatus(alternatives, selectedAttemptId),
      slotRevision: null,
      promptFrozen: alternatives.length > 0,
    };
  }

  function normalizeSkus(value, mediaById) {
    if (!Array.isArray(value) || value.length > LIMITS.maxSkus) invalid('SKUs are invalid');
    var normalizedSkuKeys = unique(value.map(function (item) {
      if (!isRecord(item) || typeof item.skuKey !== 'string') invalid('SKU is invalid');
      return contextKey(item.skuKey, 500, 'SKU key');
    }), 'SKU keys');
    var totalSlots = 0;
    var allSlotKeys = [];
    var allAttemptIds = [];
    var totalAlternatives = 0;
    var skus = value.map(function (item, index) {
      if (!exactKeys(item, SKU_KEYS) || item.skuKey !== normalizedSkuKeys[index]
        || !Array.isArray(item.slots) || item.slots.length < 1) {
        invalid('SKU is invalid');
      }
      var slots = item.slots.map(function (slot) {
        return normalizeInitialSlot(slot, normalizedSkuKeys[index], mediaById);
      });
      if (slots.filter(function (slot) { return slot.role === 'HERO'; }).length !== 1) {
        invalid('each SKU must have exactly one HERO slot');
      }
      if (slots[0].role !== 'HERO') {
        invalid('the first SKU slot must be the HERO slot');
      }
      totalSlots += slots.length;
      totalAlternatives += slots.reduce(function (sum, slot) {
        return sum + slot.alternatives.length;
      }, 0);
      slots.forEach(function (slot) {
        allSlotKeys.push(slot.slotKey);
        slot.alternatives.forEach(function (alternative) {
          allAttemptIds.push(alternative.attemptId);
        });
      });
      return {
        skuKey: normalizedSkuKeys[index],
        label: text(item.label, 1, 200, 'SKU label'),
        slots: slots,
      };
    });
    if (totalSlots > LIMITS.maxSlots || totalAlternatives > LIMITS.maxAlternatives) {
      invalid('workspace limits are exceeded');
    }
    unique(allSlotKeys, 'slot keys');
    unique(allAttemptIds, 'alternative attempt IDs');
    return skus;
  }

  function findSlot(skus, slotKey) {
    for (var index = 0; index < skus.length; index += 1) {
      var slot = skus[index].slots.find(function (candidate) {
        return candidate.slotKey === slotKey;
      });
      if (slot) return slot;
    }
    return null;
  }

  function deriveSchedulerStateFromStates(states) {
    if (states.some(function (state) {
      return ['QUEUED', 'SUBMITTING', 'WAITING', 'INGESTING'].includes(state);
    })) return 'RUNNING';
    if (states.includes('UNKNOWN_OUTCOME')) return 'FAILED';
    if (states.some(function (state) {
      return SELECTABLE_ALTERNATIVE_STATES.includes(state) || state === 'REJECTED';
    })) return 'REVIEW';
    if (states.length > 0 && states.every(function (state) { return state === 'CANCELLED'; })) {
      return 'CANCELLED';
    }
    if (states.some(function (state) {
      return ['FAILED_RETRYABLE', 'FAILED_FINAL', 'EXPIRED'].includes(state);
    })) return 'FAILED';
    return 'READY';
  }

  function deriveSchedulerState(skus) {
    var states = [];
    skus.forEach(function (sku) {
      sku.slots.forEach(function (slot) {
        slot.alternatives.forEach(function (alternative) { states.push(alternative.state); });
      });
    });
    return deriveSchedulerStateFromStates(states);
  }

  function allowedRuntimeSchedulerStates(states) {
    if (states.some(function (state) {
      return ['SUBMITTING', 'WAITING', 'INGESTING'].includes(state);
    })) return ['RUNNING', 'PAUSING'];
    if (states.includes('QUEUED')) return ['RUNNING', 'PAUSED'];
    return [deriveSchedulerStateFromStates(states)];
  }

  function createWorkspace(input) {
    if (!exactKeys(input, INPUT_KEYS) || input.contractVersion !== CONTRACT_VERSION
      || typeof input.dispatched !== 'boolean') {
      invalid('workspace input is invalid');
    }
    var binding = normalizeBinding(input.binding);
    var executionMode;
    try { executionMode = workbench.parseExecutionMode(input.executionMode); } catch {
      invalid('execution mode is invalid');
    }
    if (executionMode !== 'BYOK') {
      throw workspaceError(
        'SS_ERP_BYOK_WORKSPACE_MODE_UNAVAILABLE',
        'ERP-hosted execution is unavailable until the hosted adapter is connected',
      );
    }

    if (!Array.isArray(input.skus) || input.skus.length > LIMITS.maxSkus) {
      invalid('SKUs are invalid');
    }
    var knownSkuKeys = new Set(input.skus.map(function (item) {
      if (!isRecord(item) || typeof item.skuKey !== 'string') invalid('SKU is invalid');
      return contextKey(item.skuKey, 500, 'SKU key');
    }));
    if (knownSkuKeys.size !== input.skus.length) invalid('SKU keys contain duplicates');

    var libraryItems = normalizeLibrary(input.libraryItems, knownSkuKeys);
    var mediaById = libraryMap(libraryItems);
    var skus = normalizeSkus(input.skus, mediaById);
    var globalReferenceIds = normalizeReferenceIds(
      input.globalReferenceIds,
      mediaById,
      'global reference IDs',
      null,
    );
    var selectedSkuKey = nullableContextKey(input.selectedSkuKey, 500, 'selected SKU key');
    var selectedSlotKey = nullableContextKey(input.selectedSlotKey, 200, 'selected slot key');
    if (skus.length === 0) {
      if (selectedSkuKey !== null || selectedSlotKey !== null) {
        invalid('empty workspace selection is invalid');
      }
    } else {
      if (selectedSkuKey === null) selectedSkuKey = skus[0].skuKey;
      var selectedSku = skus.find(function (item) { return item.skuKey === selectedSkuKey; });
      if (!selectedSku) invalid('selected SKU is unavailable');
      if (selectedSlotKey === null) {
        selectedSlotKey = selectedSku.slots.find(function (slot) {
          return slot.role === 'HERO';
        }).slotKey;
      }
      if (!selectedSku.slots.some(function (slot) { return slot.slotKey === selectedSlotKey; })) {
        invalid('selected slot does not belong to the selected SKU');
      }
    }
    var hasInitialAlternatives = skus.some(function (sku) {
      return sku.slots.some(function (slot) { return slot.alternatives.length > 0; });
    });
    if (hasInitialAlternatives && input.dispatched !== true) {
      invalid('workspaces with attempts must be dispatched');
    }
    if (input.dispatched) {
      skus.forEach(function (sku) {
        sku.slots.forEach(function (slot) { slot.promptFrozen = true; });
      });
    }

    var state = {
      binding: binding,
      revision: 1,
      runtimeRevision: 0,
      publishRevision: 0,
      publishDraftState: 'UNKNOWN',
      publishDisabledReason: DEFAULT_PUBLISH_DISABLED_REASON,
      publishOrderedMedia: [],
      publishBasisWorkspaceRevision: null,
      publishBasisRuntimeRevision: null,
      executionMode: executionMode,
      dispatched: input.dispatched,
      selectedSkuKey: selectedSkuKey,
      selectedSlotKey: selectedSlotKey,
      globalReferenceIds: globalReferenceIds,
      libraryItems: libraryItems,
      skus: skus,
      schedulerState: deriveSchedulerState(skus),
      disabledReason: DEFAULT_DISABLED_REASON,
    };
    var selectedSlotBySku = new Map();
    state.skus.forEach(function (sku) {
      var initial = sku.skuKey === state.selectedSkuKey
        ? state.selectedSlotKey
        : sku.slots.find(function (slot) { return slot.role === 'HERO'; }).slotKey;
      selectedSlotBySku.set(sku.skuKey, initial);
    });
    var listeners = new Set();

    function promptEditDecision(slot) {
      if (slot.alternatives.some(function (alternative) {
        return alternative.state === 'UNKNOWN_OUTCOME';
      })) {
        return {
          editable: false,
          reason: 'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
        };
      }
      if (slot.alternatives.some(function (alternative) {
        return ACTIVE_ALTERNATIVE_STATES.includes(alternative.state);
      })) {
        return { editable: false, reason: 'SLOT_EXECUTION_ACTIVE' };
      }
      if (slot.promptFrozen) {
        return { editable: false, reason: 'SLOT_EXECUTION_FROZEN' };
      }
      return { editable: true, reason: null };
    }

    function regenerateDecision(slot) {
      if (state.disabledReason !== null) {
        return { available: false, reason: state.disabledReason };
      }
      if (slot.alternatives.length === 0) {
        return { available: false, reason: 'SLOT_NOT_EXECUTED' };
      }
      if (slot.alternatives.some(function (alternative) {
        return alternative.state === 'UNKNOWN_OUTCOME';
      })) {
        return { available: false, reason: 'UNKNOWN_OUTCOME_REQUIRES_RECOVERY' };
      }
      if (slot.alternatives.some(function (alternative) {
        return ACTIVE_ALTERNATIVE_STATES.includes(alternative.state);
      })) {
        return { available: false, reason: 'SLOT_EXECUTION_ACTIVE' };
      }
      if (!Number.isSafeInteger(slot.slotRevision) || slot.slotRevision < 1) {
        return { available: false, reason: 'SLOT_REVISION_UNAVAILABLE' };
      }
      var totalAttempts = state.skus.reduce(function (total, sku) {
        return total + sku.slots.reduce(function (skuTotal, candidate) {
          return skuTotal + candidate.alternatives.length;
        }, 0);
      }, 0);
      if (slot.alternatives.length >= LIMITS.maxAlternativesPerSlot
        || totalAttempts >= LIMITS.maxAlternatives) {
        return { available: false, reason: 'ATTEMPT_LIMIT_REACHED' };
      }
      return { available: true, reason: null };
    }

    function publishMediaDecision(slot) {
      var selected = slot.selectedAttemptId === null ? null : slot.alternatives.find(
        function (alternative) { return alternative.attemptId === slot.selectedAttemptId; },
      );
      if (slot.alternatives.some(function (alternative) {
        return alternative.state === 'UNKNOWN_OUTCOME';
      })) return { eligible: false, reason: 'UNKNOWN_OUTCOME', selected: selected };
      if (selected && selected.state === 'BOUND' && selected.mediaId !== null) {
        return { eligible: true, reason: null, selected: selected };
      }
      if (selected) {
        return { eligible: false, reason: 'RESULT_NOT_BOUND', selected: selected };
      }
      if (slot.alternatives.some(function (alternative) {
        return alternative.state === 'EXPIRED';
      })) return { eligible: false, reason: 'RESULT_EXPIRED', selected: null };
      if (slot.alternatives.length > 0 && slot.alternatives.every(function (alternative) {
        return alternative.state === 'REJECTED';
      })) return { eligible: false, reason: 'RESULT_REJECTED', selected: null };
      return { eligible: false, reason: 'MISSING_SELECTION', selected: null };
    }

    function taskControlDecision(action) {
      if (state.disabledReason !== null) {
        return { enabled: false, reason: state.disabledReason };
      }
      if (action === 'PAUSE_AFTER_CURRENT') {
        if (state.schedulerState === 'RUNNING') return { enabled: true, reason: null };
        if (state.schedulerState === 'PAUSING') {
          return { enabled: false, reason: 'PAUSE_ALREADY_REQUESTED' };
        }
        if (state.schedulerState === 'PAUSED') {
          return { enabled: false, reason: 'TASK_ALREADY_PAUSED' };
        }
        return { enabled: false, reason: 'TASK_NOT_RUNNING' };
      }
      if (action === 'CONTINUE') {
        if (state.schedulerState === 'PAUSED' || state.schedulerState === 'PAUSING') {
          return { enabled: true, reason: null };
        }
        return { enabled: false, reason: 'TASK_NOT_PAUSED' };
      }
      invalid('workspace action is invalid');
    }

    function queuedAttempts() {
      var queued = [];
      state.skus.forEach(function (sku) {
        sku.slots.forEach(function (slot) {
          slot.alternatives.forEach(function (alternative) {
            if (alternative.state === 'QUEUED') queued.push({
              attemptId: alternative.attemptId,
              slotKey: slot.slotKey,
              slot: slot,
            });
          });
        });
      });
      return queued;
    }

    function buildTaskControls() {
      var pause = taskControlDecision('PAUSE_AFTER_CURRENT');
      var resume = taskControlDecision('CONTINUE');
      var queued = queuedAttempts();
      var cancellable = queued.filter(function (item) {
        return Number.isSafeInteger(item.slot.slotRevision) && item.slot.slotRevision > 0;
      });
      var cancelEnabled = state.disabledReason === null && cancellable.length > 0;
      var cancelDisabledReason = state.disabledReason;
      if (cancelDisabledReason === null && queued.length === 0) {
        cancelDisabledReason = 'NO_QUEUED_ATTEMPTS';
      } else if (cancelDisabledReason === null && cancellable.length === 0) {
        cancelDisabledReason = 'SLOT_REVISION_UNAVAILABLE';
      }
      return {
        pauseAfterCurrent: { enabled: pause.enabled, disabledReason: pause.reason },
        continue: { enabled: resume.enabled, disabledReason: resume.reason },
        cancelQueued: {
          enabled: cancelEnabled,
          disabledReason: cancelEnabled ? null : cancelDisabledReason,
          attemptIds: cancellable.map(function (item) { return item.attemptId; }),
        },
      };
    }

    function appendUnique(values, value) {
      if (!values.includes(value)) values.push(value);
    }

    function orderedPublishMedia(slots) {
      var rows = slots.filter(function (slot) { return slot.publishMediaEligible; })
        .map(function (slot) {
          var selected = slot.alternatives.find(function (alternative) {
            return alternative.attemptId === slot.selectedAttemptId;
          });
          return {
            skuKey: slot.skuKey,
            slotKey: slot.slotKey,
            position: slot.position,
            role: slot.role,
            attemptId: selected.attemptId,
            mediaId: selected.mediaId,
          };
        });
      return slots.length > 0 && rows.length === slots.length ? rows : [];
    }

    function samePublishMedia(left, right) {
      return left.length === right.length && left.every(function (row, index) {
        var candidate = right[index];
        return candidate
          && row.skuKey === candidate.skuKey
          && row.slotKey === candidate.slotKey
          && row.position === candidate.position
          && row.role === candidate.role
          && row.attemptId === candidate.attemptId
          && row.mediaId === candidate.mediaId;
      });
    }

    function normalizePublishMedia(value) {
      if (!Array.isArray(value) || value.length > LIMITS.maxSlots) {
        invalid('publish ordered media is invalid');
      }
      var rows = value.map(function (row) {
        if (!exactKeys(row, PUBLISH_MEDIA_ROW_KEYS)
          || !Number.isSafeInteger(row.position)
          || row.position < 0
          || !SLOT_ROLES.includes(row.role)) {
          invalid('publish ordered media row is invalid');
        }
        return {
          skuKey: contextKey(row.skuKey, 500, 'publish SKU key'),
          slotKey: contextKey(row.slotKey, 200, 'publish slot key'),
          position: row.position,
          role: row.role,
          attemptId: identifier(row.attemptId, 200, 'publish attempt ID'),
          mediaId: identifier(row.mediaId, 200, 'publish media ID'),
        };
      });
      unique(rows.map(function (row) { return row.slotKey; }), 'publish slot keys');
      unique(rows.map(function (row) { return row.attemptId; }), 'publish attempt IDs');
      if (rows.length > 0 && rows[0].role !== 'HERO') {
        invalid('publish ordered media must begin with a HERO slot');
      }
      return rows;
    }

    function buildPublishSummary(slots) {
      var blockerCodes = [];
      var missingSlotKeys = [];
      var unboundSlotKeys = [];
      var unknownOutcomeSlotKeys = [];
      var expiredSlotKeys = [];
      var rejectedSlotKeys = [];
      var orderedMedia = orderedPublishMedia(slots);
      var readySlotCount = slots.filter(function (slot) {
        return slot.publishMediaEligible;
      }).length;
      if (state.publishDisabledReason !== null) {
        appendUnique(blockerCodes, state.publishDisabledReason);
      }
      if (state.publishDraftState === 'UNKNOWN') {
        appendUnique(blockerCodes, 'DRAFT_STATUS_UNKNOWN');
      } else if (state.publishDraftState === 'STALE') {
        appendUnique(blockerCodes, 'DRAFT_STALE');
      }
      if (slots.length === 0) appendUnique(blockerCodes, 'NO_MEDIA_SLOTS');
      if (state.publishRevision > 0
        && (state.publishBasisWorkspaceRevision !== state.revision
          || state.publishBasisRuntimeRevision !== state.runtimeRevision
          || !samePublishMedia(state.publishOrderedMedia, orderedMedia))) {
        appendUnique(blockerCodes, 'PUBLISH_BASIS_STALE');
      }
      slots.forEach(function (slot) {
        if (slot.publishMediaEligible) return;
        appendUnique(blockerCodes, slot.publishMediaDisabledReason);
        if (slot.publishMediaDisabledReason === 'UNKNOWN_OUTCOME') {
          unknownOutcomeSlotKeys.push(slot.slotKey);
        } else if (slot.publishMediaDisabledReason === 'RESULT_EXPIRED') {
          expiredSlotKeys.push(slot.slotKey);
        } else if (slot.publishMediaDisabledReason === 'RESULT_REJECTED') {
          rejectedSlotKeys.push(slot.slotKey);
        } else if (slot.publishMediaDisabledReason === 'RESULT_NOT_BOUND') {
          unboundSlotKeys.push(slot.slotKey);
        } else {
          missingSlotKeys.push(slot.slotKey);
        }
      });
      return {
        draftState: state.publishDraftState,
        disabledReason: state.publishDisabledReason,
        eligible: blockerCodes.length === 0 && orderedMedia.length === slots.length,
        blockerCodes: blockerCodes,
        totalSlots: slots.length,
        readySlots: readySlotCount,
        missingSlots: missingSlotKeys.length,
        unboundSlots: unboundSlotKeys.length,
        unknownOutcomeSlots: unknownOutcomeSlotKeys.length,
        expiredSlots: expiredSlotKeys.length,
        rejectedSlots: rejectedSlotKeys.length,
        missingSlotKeys: missingSlotKeys,
        unboundSlotKeys: unboundSlotKeys,
        unknownOutcomeSlotKeys: unknownOutcomeSlotKeys,
        expiredSlotKeys: expiredSlotKeys,
        rejectedSlotKeys: rejectedSlotKeys,
        orderedMedia: orderedMedia,
      };
    }

    function buildTaskSummary(slots) {
      var alternatives = [];
      var missingSlotKeys = [];
      var selectedSlots = 0;
      slots.forEach(function (slot) {
        slot.alternatives.forEach(function (alternative) { alternatives.push(alternative); });
        var selected = slot.selectedAttemptId === null ? null : slot.alternatives.find(
          function (alternative) { return alternative.attemptId === slot.selectedAttemptId; },
        );
        if (selectableAlternative(selected)) selectedSlots += 1;
        else missingSlotKeys.push(slot.slotKey);
      });
      function count(states) {
        return alternatives.filter(function (alternative) {
          return states.includes(alternative.state);
        }).length;
      }
      return {
        schedulerState: state.schedulerState,
        disabledReason: state.disabledReason,
        totalSlots: slots.length,
        selectedSlots: selectedSlots,
        missingSlots: missingSlotKeys.length,
        queuedAttempts: count(['QUEUED']),
        activeAttempts: count(['SUBMITTING', 'WAITING', 'INGESTING']),
        candidateReadyAttempts: count([
          'CANDIDATE_READY', 'APPROVED', 'INGESTED', 'BOUND',
        ]),
        failedAttempts: count(['FAILED_RETRYABLE', 'FAILED_FINAL']),
        unknownOutcomeAttempts: count(['UNKNOWN_OUTCOME']),
        cancelledAttempts: count(['CANCELLED']),
        expiredAttempts: count(['EXPIRED']),
        missingSlotKeys: missingSlotKeys,
      };
    }

    function getSnapshot() {
      var selectedSlot = state.selectedSlotKey === null
        ? null
        : findSlot(state.skus, state.selectedSlotKey);
      var effectiveSelectedReferences = selectedSlot === null
        ? []
        : (selectedSlot.referenceOverrideIds === null
          ? state.globalReferenceIds
          : selectedSlot.referenceOverrideIds);
      var publicLibrary = state.libraryItems.map(function (item) {
        return {
          mediaId: item.mediaId,
          sourceType: item.sourceType,
          label: item.label,
          secondaryLabel: item.secondaryLabel,
          skuKeys: item.skuKeys.slice(),
          referenceEligible: item.referenceEligible,
          selectedAsGlobalReference: state.globalReferenceIds.includes(item.mediaId),
          selectedAsSlotReference: effectiveSelectedReferences.includes(item.mediaId),
        };
      });
      var publicSkus = state.skus.map(function (sku) {
        var main = sku.slots.find(function (slot) { return slot.role === 'HERO'; });
        return {
          skuKey: sku.skuKey,
          label: sku.label,
          selected: sku.skuKey === state.selectedSkuKey,
          slotKeys: sku.slots.map(function (slot) { return slot.slotKey; }),
          mainSlotKey: main.slotKey,
        };
      });
      var publicSlots = [];
      state.skus.forEach(function (sku) {
        sku.slots.forEach(function (slot, position) {
          var effectiveReferences = slot.referenceOverrideIds === null
            ? state.globalReferenceIds
            : slot.referenceOverrideIds;
          var promptDecision = promptEditDecision(slot);
          var regeneration = regenerateDecision(slot);
          var publishMedia = publishMediaDecision(slot);
          publicSlots.push({
            slotKey: slot.slotKey,
            skuKey: sku.skuKey,
            position: position,
            role: slot.role,
            isMain: slot.role === 'HERO',
            selected: slot.slotKey === state.selectedSlotKey,
            status: slot.status,
            prompt: slot.prompt,
            negativePrompt: slot.negativePrompt,
            promptEditable: promptDecision.editable,
            promptDisabledReason: promptDecision.reason,
            referenceSource: slot.referenceOverrideIds === null ? 'GLOBAL' : 'SLOT_OVERRIDE',
            referenceIds: effectiveReferences.slice(),
            referenceOverrideIds: slot.referenceOverrideIds === null
              ? null
              : slot.referenceOverrideIds.slice(),
            referencesEditable: promptDecision.editable,
            referencesDisabledReason: promptDecision.reason,
            alternatives: slot.alternatives.map(function (alternative) {
              var candidateReady = alternative.state === 'CANDIDATE_READY';
              var reviewDisabledReason = state.disabledReason;
              if (reviewDisabledReason === null && slot.alternatives.some(
                function (candidate) { return candidate.state === 'UNKNOWN_OUTCOME'; },
              )) reviewDisabledReason = 'UNKNOWN_OUTCOME_REQUIRES_RECOVERY';
              if (reviewDisabledReason === null && !candidateReady) {
                reviewDisabledReason = 'ATTEMPT_NOT_REVIEWABLE';
              }
              if (reviewDisabledReason === null
                && (!Number.isSafeInteger(slot.slotRevision) || slot.slotRevision < 1)) {
                reviewDisabledReason = 'SLOT_REVISION_UNAVAILABLE';
              }
              var keepDisabledReason = reviewDisabledReason;
              if (keepDisabledReason === null
                && alternative.attemptId === slot.selectedAttemptId) {
                keepDisabledReason = 'ATTEMPT_ALREADY_SELECTED';
              }
              return {
                attemptId: alternative.attemptId,
                state: alternative.state,
                mediaId: alternative.mediaId,
                errorCode: alternative.errorCode,
                selected: alternative.attemptId === slot.selectedAttemptId,
                keepAvailable: keepDisabledReason === null,
                keepDisabledReason: keepDisabledReason,
                rejectAvailable: reviewDisabledReason === null,
                rejectDisabledReason: reviewDisabledReason,
                reviewDisabledReason: reviewDisabledReason,
              };
            }),
            selectedAttemptId: slot.selectedAttemptId,
            slotRevision: slot.slotRevision,
            regenerateAvailable: regeneration.available,
            regenerateDisabledReason: regeneration.reason,
            publishMediaEligible: publishMedia.eligible,
            publishMediaDisabledReason: publishMedia.reason,
          });
        });
      });
      var modeDisabledReasons = {
        ERP_HOSTED: 'HOSTED_ADAPTER_NOT_READY',
        BYOK: null,
      };
      var currentOrderedMedia = orderedPublishMedia(publicSlots);
      var snapshot = {
        contractVersion: CONTRACT_VERSION,
        runtimeContractVersion: RUNTIME_CONTRACT_VERSION,
        revision: state.revision,
        runtimeRevision: state.runtimeRevision,
        publishProjectionContractVersion: PUBLISH_PROJECTION_CONTRACT_VERSION,
        publishRevision: state.publishRevision,
        publishBasis: {
          expectedWorkspaceRevision: state.revision,
          expectedRuntimeRevision: state.runtimeRevision,
          binding: cloneBinding(state.binding),
          orderedMedia: currentOrderedMedia,
        },
        binding: cloneBinding(state.binding),
        executionMode: state.executionMode,
        executionModeFrozen: state.dispatched,
        modeDisabledReasons: modeDisabledReasons,
        selectedSkuKey: state.selectedSkuKey,
        selectedSlotKey: state.selectedSlotKey,
        globalReferenceIds: state.globalReferenceIds.slice(),
        globalReferencesEditable: !state.dispatched,
        globalReferencesDisabledReason: state.dispatched
          ? 'GLOBAL_REFERENCES_FROZEN'
          : null,
        libraryItems: publicLibrary,
        skus: publicSkus,
        slots: publicSlots,
        taskSummary: buildTaskSummary(publicSlots),
        taskControls: buildTaskControls(),
        publishSummary: buildPublishSummary(publicSlots),
      };
      workbench.assertPublicPayload(snapshot);
      return deepFreeze(snapshot);
    }

    function emit() {
      if (listeners.size === 0) return;
      var snapshot = getSnapshot();
      listeners.forEach(function (listener) {
        try { listener(snapshot); } catch {}
      });
    }

    function changed() {
      state.revision += 1;
      emit();
      return getSnapshot();
    }

    function invalidatePublishProjection(reason) {
      if (state.publishRevision === 0) return;
      state.publishDraftState = 'UNKNOWN';
      state.publishDisabledReason = reason;
    }

    function currentMediaById() {
      return libraryMap(state.libraryItems);
    }

    function requireSlot(slotKeyValue) {
      var slotKey = contextKey(slotKeyValue, 200, 'slot key');
      var slot = findSlot(state.skus, slotKey);
      if (!slot) selectionInvalid('slot is unavailable');
      return slot;
    }

    function requireAttempt(slot, attemptIdValue) {
      var attemptId = identifier(attemptIdValue, 200, 'attempt ID');
      var alternative = slot.alternatives.find(function (candidate) {
        return candidate.attemptId === attemptId;
      });
      if (!alternative) selectionInvalid('attempt is unavailable');
      return alternative;
    }

    function requireUnknownOutcomesRetained(slot, alternatives) {
      var unknownAttemptIds = slot.alternatives.filter(function (alternative) {
        return alternative.state === 'UNKNOWN_OUTCOME';
      }).map(function (alternative) { return alternative.attemptId; });
      var retained = unknownAttemptIds.every(function (attemptId) {
        return alternatives.some(function (alternative) {
          return alternative.attemptId === attemptId
            && alternative.state === 'UNKNOWN_OUTCOME';
        });
      });
      if (!retained) {
        throw workspaceError(
          'SS_ERP_BYOK_WORKSPACE_UNKNOWN_OUTCOME_LOCKED',
          'unknown Provider outcomes require an explicit recovery path',
        );
      }
    }

    function findAttempt(attemptIdValue) {
      var attemptId = identifier(attemptIdValue, 200, 'attempt ID');
      for (var skuIndex = 0; skuIndex < state.skus.length; skuIndex += 1) {
        for (var slotIndex = 0; slotIndex < state.skus[skuIndex].slots.length; slotIndex += 1) {
          var slot = state.skus[skuIndex].slots[slotIndex];
          var alternative = slot.alternatives.find(function (candidate) {
            return candidate.attemptId === attemptId;
          });
          if (alternative) return { slot: slot, alternative: alternative };
        }
      }
      return null;
    }

    function createActionIntent(
      action,
      slotKey,
      attemptId,
      expectedSlotRevision,
      acknowledgement,
      commandIdValue,
    ) {
      if (!ACTION_INTENTS.includes(action)) invalid('workspace action is invalid');
      var commandId = identifier(commandIdValue, 200, 'workspace command ID');
      var intent = {
        contractVersion: ACTION_INTENT_CONTRACT_VERSION,
        binding: cloneBinding(state.binding),
        action: action,
        commandId: commandId,
        expectedWorkspaceRevision: state.revision,
        expectedRuntimeRevision: state.runtimeRevision,
        expectedSlotRevision: expectedSlotRevision,
        slotKey: slotKey,
        attemptId: attemptId,
        externalChargeAcknowledgement: acknowledgement,
      };
      workbench.assertPublicPayload(intent);
      return deepFreeze(intent);
    }

    function createPauseAfterCurrentIntent(commandIdValue) {
      var decision = taskControlDecision('PAUSE_AFTER_CURRENT');
      if (!decision.enabled) actionUnavailable(decision.reason);
      return createActionIntent(
        'PAUSE_AFTER_CURRENT', null, null, null, null, commandIdValue,
      );
    }

    function createContinueIntent(commandIdValue) {
      var decision = taskControlDecision('CONTINUE');
      if (!decision.enabled) actionUnavailable(decision.reason);
      return createActionIntent('CONTINUE', null, null, null, null, commandIdValue);
    }

    function createCancelQueuedIntent(attemptIdValue, commandIdValue) {
      if (state.disabledReason !== null) actionUnavailable(state.disabledReason);
      var match = findAttempt(attemptIdValue);
      if (!match || match.alternative.state !== 'QUEUED') {
        actionUnavailable('ATTEMPT_NOT_QUEUED');
      }
      if (!Number.isSafeInteger(match.slot.slotRevision) || match.slot.slotRevision < 1) {
        actionUnavailable('SLOT_REVISION_UNAVAILABLE');
      }
      return createActionIntent(
        'CANCEL_QUEUED',
        match.slot.slotKey,
        match.alternative.attemptId,
        match.slot.slotRevision,
        null,
        commandIdValue,
      );
    }

    function createReviewIntent(action, slotKeyValue, attemptIdValue, commandIdValue) {
      if (state.disabledReason !== null) actionUnavailable(state.disabledReason);
      var slot = requireSlot(slotKeyValue);
      var alternative = requireAttempt(slot, attemptIdValue);
      if (slot.alternatives.some(function (candidate) {
        return candidate.state === 'UNKNOWN_OUTCOME';
      })) actionUnavailable('UNKNOWN_OUTCOME_REQUIRES_RECOVERY');
      if (alternative.state !== 'CANDIDATE_READY' || alternative.mediaId === null) {
        actionUnavailable('ATTEMPT_NOT_REVIEWABLE');
      }
      if (!Number.isSafeInteger(slot.slotRevision) || slot.slotRevision < 1) {
        actionUnavailable('SLOT_REVISION_UNAVAILABLE');
      }
      if (action === 'KEEP_ATTEMPT' && slot.selectedAttemptId === alternative.attemptId) {
        actionUnavailable('ATTEMPT_ALREADY_SELECTED');
      }
      return createActionIntent(
        action,
        slot.slotKey,
        alternative.attemptId,
        slot.slotRevision,
        null,
        commandIdValue,
      );
    }

    function createKeepAttemptIntent(slotKeyValue, attemptIdValue, commandIdValue) {
      return createReviewIntent(
        'KEEP_ATTEMPT', slotKeyValue, attemptIdValue, commandIdValue,
      );
    }

    function createRejectAttemptIntent(slotKeyValue, attemptIdValue, commandIdValue) {
      return createReviewIntent(
        'REJECT_ATTEMPT', slotKeyValue, attemptIdValue, commandIdValue,
      );
    }

    function normalizeChargeAcknowledgement(value) {
      if (!exactKeys(value, CHARGE_ACKNOWLEDGEMENT_KEYS)
        || value.warningVersion !== EXTERNAL_CHARGE_WARNING_VERSION
        || value.confirmed !== true) {
        throw workspaceError(
          'SS_ERP_BYOK_WORKSPACE_CHARGE_ACKNOWLEDGEMENT_REQUIRED',
          'the current external Provider charge warning must be confirmed',
        );
      }
      return {
        warningVersion: EXTERNAL_CHARGE_WARNING_VERSION,
        confirmed: true,
      };
    }

    function createRegenerateIntent(slotKeyValue, acknowledgementValue, commandIdValue) {
      var slot = requireSlot(slotKeyValue);
      var decision = regenerateDecision(slot);
      if (!decision.available) actionUnavailable(decision.reason);
      var acknowledgement = normalizeChargeAcknowledgement(acknowledgementValue);
      return createActionIntent(
        'REGENERATE_SLOT',
        slot.slotKey,
        null,
        slot.slotRevision,
        acknowledgement,
        commandIdValue,
      );
    }

    function setExecutionMode(requestedMode) {
      var parsedMode;
      try { parsedMode = workbench.parseExecutionMode(requestedMode); } catch {
        invalid('execution mode is invalid');
      }
      if (parsedMode !== state.executionMode) {
        if (state.dispatched) {
          throw workspaceError(
            'SS_ERP_BYOK_WORKSPACE_MODE_LOCKED',
            'execution mode is locked after dispatch',
          );
        }
        throw workspaceError(
          'SS_ERP_BYOK_WORKSPACE_MODE_UNAVAILABLE',
          'ERP-hosted execution is unavailable until the hosted adapter is connected',
        );
      }
      var mode;
      try {
        mode = workbench.resolveExecutionMode({
          currentMode: state.executionMode,
          requestedMode: parsedMode,
          dispatched: state.dispatched,
        });
      } catch (error) {
        if (error && error.code === 'AI_IMAGE_WORKBENCH_MODE_LOCKED') {
          throw workspaceError(
            'SS_ERP_BYOK_WORKSPACE_MODE_LOCKED',
            'execution mode is locked after dispatch',
          );
        }
        invalid('execution mode is invalid');
      }
      if (mode === state.executionMode) return getSnapshot();
      state.executionMode = mode;
      return changed();
    }

    function markDispatched() {
      var didChange = !state.dispatched;
      state.dispatched = true;
      state.skus.forEach(function (sku) {
        sku.slots.forEach(function (slot) {
          if (!slot.promptFrozen) didChange = true;
          slot.promptFrozen = true;
        });
      });
      return didChange ? changed() : getSnapshot();
    }

    function selectSku(skuKeyValue) {
      var skuKey = contextKey(skuKeyValue, 500, 'SKU key');
      var sku = state.skus.find(function (item) { return item.skuKey === skuKey; });
      if (!sku) selectionInvalid('SKU is unavailable');
      if (skuKey === state.selectedSkuKey) return getSnapshot();
      state.selectedSkuKey = skuKey;
      state.selectedSlotKey = selectedSlotBySku.get(skuKey);
      return changed();
    }

    function selectSkuByKeyboard(key) {
      if (!KEYBOARD_SELECTION_KEYS.includes(key) || state.skus.length === 0) {
        selectionInvalid('keyboard SKU selection is invalid');
      }
      var index = state.skus.findIndex(function (sku) {
        return sku.skuKey === state.selectedSkuKey;
      });
      var nextIndex = index;
      if (key === 'Home') nextIndex = 0;
      else if (key === 'End') nextIndex = state.skus.length - 1;
      else if (key === 'ArrowLeft' || key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
      else nextIndex = Math.min(state.skus.length - 1, index + 1);
      return selectSku(state.skus[nextIndex].skuKey);
    }

    function selectSlot(slotKeyValue) {
      var slot = requireSlot(slotKeyValue);
      if (slot.slotKey === state.selectedSlotKey) return getSnapshot();
      state.selectedSkuKey = slot.skuKey;
      state.selectedSlotKey = slot.slotKey;
      selectedSlotBySku.set(slot.skuKey, slot.slotKey);
      return changed();
    }

    function setGlobalReferenceIds(referenceIds) {
      if (state.dispatched) referenceLocked('GLOBAL_REFERENCES_FROZEN');
      var normalized = normalizeReferenceIds(
        referenceIds,
        currentMediaById(),
        'global reference IDs',
        null,
      );
      if (JSON.stringify(normalized) === JSON.stringify(state.globalReferenceIds)) {
        return getSnapshot();
      }
      state.globalReferenceIds = normalized;
      return changed();
    }

    function setSlotReferenceIds(slotKeyValue, referenceIds) {
      var slot = requireSlot(slotKeyValue);
      var referenceDecision = promptEditDecision(slot);
      if (!referenceDecision.editable) referenceLocked(referenceDecision.reason);
      var normalized = referenceIds === null
        ? null
        : normalizeReferenceIds(
          referenceIds,
          currentMediaById(),
          'slot reference IDs',
          slot.skuKey,
        );
      if (JSON.stringify(normalized) === JSON.stringify(slot.referenceOverrideIds)) {
        return getSnapshot();
      }
      slot.referenceOverrideIds = normalized;
      return changed();
    }

    function setSlotPrompt(slotKeyValue, value) {
      var slot = requireSlot(slotKeyValue);
      var promptDecision = promptEditDecision(slot);
      if (!promptDecision.editable) {
        var error = workspaceError(
          'SS_ERP_BYOK_WORKSPACE_PROMPT_LOCKED',
          'slot Prompt cannot change after execution starts',
        );
        error.reason = promptDecision.reason;
        throw error;
      }
      if (!exactKeys(value, PROMPT_UPDATE_KEYS)) invalid('slot Prompt update is invalid');
      var prompt = text(
        value.prompt,
        0,
        workbench.LIMITS.maxPromptCharacters,
        'slot Prompt',
      );
      var negativePrompt = text(
        value.negativePrompt,
        0,
        workbench.LIMITS.maxNegativePromptCharacters,
        'slot negative Prompt',
      );
      if (slot.prompt === prompt && slot.negativePrompt === negativePrompt) return getSnapshot();
      slot.prompt = prompt;
      slot.negativePrompt = negativePrompt;
      return changed();
    }

    function setAlternatives(slotKeyValue, alternativesValue, selectedAttemptIdValue) {
      var slot = requireSlot(slotKeyValue);
      var alternatives = normalizeAlternatives(
        alternativesValue,
        currentMediaById(),
        slot.skuKey,
      );
      requireUnknownOutcomesRetained(slot, alternatives);
      var selectedAttemptId = normalizeSelectedAttempt(selectedAttemptIdValue, alternatives);
      var total = alternatives.length;
      var attemptIds = alternatives.map(function (alternative) { return alternative.attemptId; });
      state.skus.forEach(function (sku) {
        sku.slots.forEach(function (candidate) {
          if (candidate !== slot) {
            total += candidate.alternatives.length;
            candidate.alternatives.forEach(function (alternative) {
              attemptIds.push(alternative.attemptId);
            });
          }
        });
      });
      if (total > LIMITS.maxAlternatives) invalid('workspace alternative limit is exceeded');
      unique(attemptIds, 'alternative attempt IDs');
      slot.alternatives = alternatives;
      slot.selectedAttemptId = selectedAttemptId;
      slot.status = derivedSlotStatus(alternatives, selectedAttemptId);
      slot.slotRevision = null;
      if (alternatives.length > 0) {
        slot.promptFrozen = true;
        state.dispatched = true;
      }
      state.schedulerState = deriveSchedulerState(state.skus);
      state.disabledReason = DEFAULT_DISABLED_REASON;
      invalidatePublishProjection('MEDIA_REBIND_REQUIRED');
      return changed();
    }

    function selectAttempt(slotKeyValue, attemptIdValue) {
      var slot = requireSlot(slotKeyValue);
      var attemptId = identifier(attemptIdValue, 200, 'attempt ID');
      var alternative = slot.alternatives.find(function (candidate) {
        return candidate.attemptId === attemptId;
      });
      if (!selectableAlternative(alternative)) selectionInvalid('attempt is unavailable');
      if (slot.selectedAttemptId === attemptId) return getSnapshot();
      slot.selectedAttemptId = attemptId;
      slot.status = alternative.state;
      invalidatePublishProjection('MEDIA_REBIND_REQUIRED');
      return changed();
    }

    function alignSlotRolesToOrder(sku) {
      sku.slots.forEach(function (candidate, index) {
        candidate.role = index === 0 ? 'HERO' : 'DETAIL';
      });
    }

    function setMainSlot(slotKeyValue) {
      var slot = requireSlot(slotKeyValue);
      var sku = state.skus.find(function (item) { return item.skuKey === slot.skuKey; });
      var index = sku.slots.findIndex(function (candidate) { return candidate === slot; });
      if (index === 0) return getSnapshot();
      sku.slots.splice(index, 1);
      sku.slots.unshift(slot);
      alignSlotRolesToOrder(sku);
      invalidatePublishProjection('ORDER_REBIND_REQUIRED');
      return changed();
    }

    function moveSelectedSlot(offset) {
      if (state.selectedSlotKey === null || state.selectedSkuKey === null) {
        selectionInvalid('selected slot is unavailable');
      }
      var sku = state.skus.find(function (item) { return item.skuKey === state.selectedSkuKey; });
      var index = sku.slots.findIndex(function (slot) {
        return slot.slotKey === state.selectedSlotKey;
      });
      var nextIndex = Math.max(0, Math.min(sku.slots.length - 1, index + offset));
      if (nextIndex === index) return getSnapshot();
      var selected = sku.slots[index];
      sku.slots.splice(index, 1);
      sku.slots.splice(nextIndex, 0, selected);
      alignSlotRolesToOrder(sku);
      invalidatePublishProjection('ORDER_REBIND_REQUIRED');
      return changed();
    }

    function moveSlotByKeyboard(slotKeyValue, key) {
      if (!KEYBOARD_SLOT_ORDER_KEYS.includes(key)) {
        selectionInvalid('keyboard slot ordering is invalid');
      }
      var slot = requireSlot(slotKeyValue);
      var sku = state.skus.find(function (item) { return item.skuKey === slot.skuKey; });
      var index = sku.slots.findIndex(function (candidate) { return candidate === slot; });
      var nextIndex = index;
      if (key === 'Home') nextIndex = 0;
      else if (key === 'End') nextIndex = sku.slots.length - 1;
      else if (key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
      else nextIndex = Math.min(sku.slots.length - 1, index + 1);
      var selectionChanged = state.selectedSlotKey !== slot.slotKey
        || state.selectedSkuKey !== slot.skuKey;
      state.selectedSkuKey = slot.skuKey;
      state.selectedSlotKey = slot.slotKey;
      selectedSlotBySku.set(slot.skuKey, slot.slotKey);
      if (nextIndex !== index) {
        sku.slots.splice(index, 1);
        sku.slots.splice(nextIndex, 0, slot);
        alignSlotRolesToOrder(sku);
        invalidatePublishProjection('ORDER_REBIND_REQUIRED');
        return changed();
      }
      return selectionChanged ? changed() : getSnapshot();
    }

    function upsertLibraryItem(value) {
      var item = normalizeLibraryItem(value, new Set(state.skus.map(function (sku) {
        return sku.skuKey;
      })));
      var index = state.libraryItems.findIndex(function (candidate) {
        return candidate.mediaId === item.mediaId;
      });
      if (index >= 0) {
        var existingItem = state.libraryItems[index];
        if (existingItem.sourceType !== item.sourceType) {
          invalid('library source type cannot change');
        }
        if (item.sourceType === 'GENERATED'
          && !sameStringArray(existingItem.skuKeys, item.skuKeys)) {
          invalid('generated media SKU scope cannot change');
        }
        var globallyReferenced = state.globalReferenceIds.includes(item.mediaId);
        var incompatibleSlotReference = state.skus.some(function (sku) {
          return sku.slots.some(function (slot) {
            return slot.referenceOverrideIds !== null
              && slot.referenceOverrideIds.includes(item.mediaId)
              && !referenceCompatible(item, slot.skuKey);
          });
        });
        var slotReferenced = state.skus.some(function (sku) {
          return sku.slots.some(function (slot) {
            return slot.referenceOverrideIds !== null
              && slot.referenceOverrideIds.includes(item.mediaId);
          });
        });
        if ((globallyReferenced || slotReferenced) && !item.referenceEligible) {
          invalid('referenced library media must remain eligible');
        }
        if ((globallyReferenced && !referenceCompatible(item, null))
          || incompatibleSlotReference) invalid('referenced library media scope cannot change');
        var incompatibleAlternative = state.skus.some(function (sku) {
          return sku.slots.some(function (slot) {
            return slot.alternatives.some(function (alternative) {
              return alternative.mediaId === item.mediaId
                && !generatedMediaCompatible(item, slot.skuKey);
            });
          });
        });
        if (incompatibleAlternative) invalid('generated media SKU scope cannot change');
        state.libraryItems[index] = item;
      } else {
        if (state.libraryItems.length >= LIMITS.maxLibraryItems) {
          invalid('library item limit is exceeded');
        }
        state.libraryItems.push(item);
      }
      return changed();
    }

    function applyRuntimeProjection(value) {
      if (!exactKeys(value, RUNTIME_KEYS)
        || value.contractVersion !== RUNTIME_CONTRACT_VERSION
        || !Number.isSafeInteger(value.revision) || value.revision < 1) {
        invalid('runtime projection is invalid');
      }
      requireMatchingBinding(state.binding, value.binding);
      if (value.revision <= state.runtimeRevision) {
        throw workspaceError(
          'SS_ERP_BYOK_WORKSPACE_RUNTIME_STALE',
          'runtime projection revision is stale',
        );
      }
      if (!exactKeys(value.task, RUNTIME_TASK_KEYS)
        || !TASK_STATES.includes(value.task.schedulerState)) {
        invalid('runtime task projection is invalid');
      }
      var disabledReason = nullableIdentifier(
        value.task.disabledReason,
        200,
        'runtime disabled reason',
      );
      if (!Array.isArray(value.libraryItems)
        || value.libraryItems.length > LIMITS.maxLibraryItems
        || !Array.isArray(value.slots)
        || value.slots.length > LIMITS.maxSlots) {
        invalid('runtime projection collections are invalid');
      }

      var knownSkuKeys = new Set(state.skus.map(function (sku) { return sku.skuKey; }));
      var nextLibrary = state.libraryItems.map(function (item) {
        return {
          mediaId: item.mediaId,
          sourceType: item.sourceType,
          label: item.label,
          secondaryLabel: item.secondaryLabel,
          skuKeys: item.skuKeys.slice(),
          referenceEligible: item.referenceEligible,
        };
      });
      var nextMediaById = libraryMap(nextLibrary);
      var runtimeItems = value.libraryItems.map(function (item) {
        var normalized = normalizeLibraryItem(item, knownSkuKeys);
        if (normalized.sourceType !== 'GENERATED') {
          invalid('runtime library items must be generated media');
        }
        return normalized;
      });
      unique(runtimeItems.map(function (item) { return item.mediaId; }), 'runtime media IDs');
      runtimeItems.forEach(function (item) {
        var existing = nextMediaById.get(item.mediaId);
        if (existing && existing.sourceType !== 'GENERATED') {
          invalid('runtime media cannot replace source media');
        }
        if (existing) {
          if (!sameStringArray(existing.skuKeys, item.skuKeys)) {
            invalid('generated runtime media SKU scope cannot change');
          }
          var globallyReferenced = state.globalReferenceIds.includes(item.mediaId);
          var referencedSlots = [];
          state.skus.forEach(function (sku) {
            sku.slots.forEach(function (slot) {
              if (slot.referenceOverrideIds !== null
                && slot.referenceOverrideIds.includes(item.mediaId)) referencedSlots.push(slot);
            });
          });
          if ((globallyReferenced || referencedSlots.length > 0) && !item.referenceEligible) {
            invalid('referenced runtime media must remain eligible');
          }
          if ((globallyReferenced && !referenceCompatible(item, null))
            || referencedSlots.some(function (slot) {
              return !referenceCompatible(item, slot.skuKey);
            })) invalid('referenced runtime media scope cannot change');
          var index = nextLibrary.findIndex(function (candidate) {
            return candidate.mediaId === item.mediaId;
          });
          nextLibrary[index] = item;
        } else {
          if (nextLibrary.length >= LIMITS.maxLibraryItems) {
            invalid('library item limit is exceeded');
          }
          nextLibrary.push(item);
        }
        nextMediaById.set(item.mediaId, item);
      });

      var runtimeSlotKeys = [];
      var patches = value.slots.map(function (runtimeSlot) {
        var hasSlotRevision = exactKeys(runtimeSlot, RUNTIME_SLOT_REVISION_KEYS);
        if (!(exactKeys(runtimeSlot, RUNTIME_SLOT_KEYS) || hasSlotRevision)
          || !SLOT_STATUSES.includes(runtimeSlot.status)) {
          invalid('runtime slot projection is invalid');
        }
        if (hasSlotRevision && (!Number.isSafeInteger(runtimeSlot.slotRevision)
          || runtimeSlot.slotRevision < 1)) {
          invalid('runtime slot revision is invalid');
        }
        var slotKey = contextKey(runtimeSlot.slotKey, 200, 'runtime slot key');
        var targetSlot = findSlot(state.skus, slotKey);
        if (!targetSlot) invalid('runtime slot is unavailable');
        if (hasSlotRevision && targetSlot.slotRevision !== null
          && runtimeSlot.slotRevision < targetSlot.slotRevision) {
          invalid('runtime slot revision is stale');
        }
        runtimeSlotKeys.push(slotKey);
        var alternatives = normalizeAlternatives(
          runtimeSlot.alternatives,
          nextMediaById,
          targetSlot.skuKey,
        );
        var selectedAttemptId = normalizeSelectedAttempt(
          runtimeSlot.selectedAttemptId,
          alternatives,
        );
        requireUnknownOutcomesRetained(targetSlot, alternatives);
        if (runtimeSlot.status !== derivedSlotStatus(alternatives, selectedAttemptId)) {
          invalid('runtime slot status does not match the selected attempt');
        }
        if (hasSlotRevision && targetSlot.slotRevision === runtimeSlot.slotRevision
          && (targetSlot.status !== runtimeSlot.status
            || targetSlot.selectedAttemptId !== selectedAttemptId
            || !sameAlternatives(targetSlot.alternatives, alternatives))) {
          throw workspaceError(
            'SS_ERP_BYOK_WORKSPACE_SLOT_REVISION_REUSED',
            'runtime slot revision cannot describe different slot state',
          );
        }
        return {
          slotKey: slotKey,
          status: runtimeSlot.status,
          alternatives: alternatives,
          selectedAttemptId: selectedAttemptId,
          slotRevision: hasSlotRevision ? runtimeSlot.slotRevision : null,
        };
      });
      unique(runtimeSlotKeys, 'runtime slot keys');
      var projectedAlternativeCount = 0;
      var projectedAlternativeStates = [];
      var projectedAttemptIds = [];
      state.skus.forEach(function (sku) {
        sku.slots.forEach(function (slot) {
          var patch = patches.find(function (candidate) {
            return candidate.slotKey === slot.slotKey;
          });
          var projectedAlternatives = patch ? patch.alternatives : slot.alternatives;
          projectedAlternativeCount += projectedAlternatives.length;
          projectedAlternatives.forEach(function (alternative) {
            projectedAttemptIds.push(alternative.attemptId);
            projectedAlternativeStates.push(alternative.state);
            if (alternative.mediaId === null) return;
            var item = nextMediaById.get(alternative.mediaId);
            if (!item || !generatedMediaCompatible(item, slot.skuKey)) {
              invalid('generated media does not belong to the projected slot SKU');
            }
          });
        });
      });
      if (projectedAlternativeCount > LIMITS.maxAlternatives) {
        invalid('workspace alternative limit is exceeded');
      }
      unique(projectedAttemptIds, 'projected alternative attempt IDs');
      if (!allowedRuntimeSchedulerStates(projectedAlternativeStates)
        .includes(value.task.schedulerState)) {
        invalid('runtime scheduler state contradicts projected attempts');
      }

      state.libraryItems = nextLibrary;
      patches.forEach(function (patch) {
        var slot = findSlot(state.skus, patch.slotKey);
        slot.status = patch.status;
        slot.alternatives = patch.alternatives;
        slot.selectedAttemptId = patch.selectedAttemptId;
        slot.slotRevision = patch.slotRevision;
        if (patch.alternatives.length > 0) slot.promptFrozen = true;
      });
      state.schedulerState = value.task.schedulerState;
      state.disabledReason = disabledReason;
      state.runtimeRevision = value.revision;
      if (value.task.schedulerState !== 'READY'
        || patches.some(function (patch) { return patch.alternatives.length > 0; })) {
        state.dispatched = true;
      }
      if (state.publishRevision > 0) {
        invalidatePublishProjection(
          patches.length > 0 ? 'MEDIA_REBIND_REQUIRED' : 'PUBLISH_BASIS_STALE',
        );
      }
      return changed();
    }

    function applyPublishProjection(value) {
      if (!exactKeys(value, PUBLISH_PROJECTION_KEYS)
        || value.contractVersion !== PUBLISH_PROJECTION_CONTRACT_VERSION
        || !Number.isSafeInteger(value.revision)
        || value.revision < 1
        || !Number.isSafeInteger(value.expectedWorkspaceRevision)
        || value.expectedWorkspaceRevision < 1
        || !Number.isSafeInteger(value.expectedRuntimeRevision)
        || value.expectedRuntimeRevision < 0
        || !PUBLISH_DRAFT_STATES.includes(value.draftState)) {
        invalid('publish projection is invalid');
      }
      requireMatchingBinding(state.binding, value.binding);
      var orderedMedia = normalizePublishMedia(value.orderedMedia);
      if (value.revision <= state.publishRevision) {
        throw workspaceError(
          'SS_ERP_BYOK_WORKSPACE_PUBLISH_STALE',
          'publish projection revision is stale',
        );
      }
      var current = getSnapshot().publishBasis;
      if (value.expectedWorkspaceRevision !== current.expectedWorkspaceRevision
        || value.expectedRuntimeRevision !== current.expectedRuntimeRevision
        || !samePublishMedia(orderedMedia, current.orderedMedia)) {
        throw workspaceError(
          'SS_ERP_BYOK_WORKSPACE_PUBLISH_BASIS_STALE',
          'publish projection does not match the current workspace basis',
        );
      }
      var disabledReason = value.disabledReason === null
        ? null
        : identifier(value.disabledReason, 200, 'publish disabled reason');
      state.publishRevision = value.revision;
      state.publishDraftState = value.draftState;
      state.publishDisabledReason = disabledReason;
      state.publishOrderedMedia = orderedMedia;
      state.publishBasisWorkspaceRevision = state.revision + 1;
      state.publishBasisRuntimeRevision = state.runtimeRevision;
      return changed();
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') invalid('workspace listener is invalid');
      listeners.add(listener);
      try { listener(getSnapshot()); } catch {}
      var active = true;
      return function unsubscribe() {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    }

    return Object.freeze({
      getSnapshot: getSnapshot,
      subscribe: subscribe,
      setExecutionMode: setExecutionMode,
      markDispatched: markDispatched,
      createPauseAfterCurrentIntent: createPauseAfterCurrentIntent,
      createContinueIntent: createContinueIntent,
      createCancelQueuedIntent: createCancelQueuedIntent,
      createKeepAttemptIntent: createKeepAttemptIntent,
      createRejectAttemptIntent: createRejectAttemptIntent,
      createRegenerateIntent: createRegenerateIntent,
      selectSku: selectSku,
      selectSkuByKeyboard: selectSkuByKeyboard,
      selectSlot: selectSlot,
      setGlobalReferenceIds: setGlobalReferenceIds,
      setSlotReferenceIds: setSlotReferenceIds,
      setSlotPrompt: setSlotPrompt,
      setAlternatives: setAlternatives,
      selectAttempt: selectAttempt,
      setMainSlot: setMainSlot,
      moveSelectedSlotUp: function () { return moveSelectedSlot(-1); },
      moveSelectedSlotDown: function () { return moveSelectedSlot(1); },
      moveSlotByKeyboard: moveSlotByKeyboard,
      upsertLibraryItem: upsertLibraryItem,
      applyRuntimeProjection: applyRuntimeProjection,
      applyPublishProjection: applyPublishProjection,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    RUNTIME_CONTRACT_VERSION: RUNTIME_CONTRACT_VERSION,
    ACTION_INTENT_CONTRACT_VERSION: ACTION_INTENT_CONTRACT_VERSION,
    ACTION_OUTCOME_CONTRACT_VERSION: ACTION_OUTCOME_CONTRACT_VERSION,
    PUBLISH_PROJECTION_CONTRACT_VERSION: PUBLISH_PROJECTION_CONTRACT_VERSION,
    EXTERNAL_CHARGE_WARNING_VERSION: EXTERNAL_CHARGE_WARNING_VERSION,
    MEDIA_SOURCE_TYPES: MEDIA_SOURCE_TYPES,
    SLOT_ROLES: SLOT_ROLES,
    ALTERNATIVE_STATES: ALTERNATIVE_STATES,
    TASK_STATES: TASK_STATES,
    KEYBOARD_SELECTION_KEYS: KEYBOARD_SELECTION_KEYS,
    KEYBOARD_SLOT_ORDER_KEYS: KEYBOARD_SLOT_ORDER_KEYS,
    ACTION_INTENTS: ACTION_INTENTS,
    PUBLISH_DRAFT_STATES: PUBLISH_DRAFT_STATES,
    PROMPT_DISABLED_REASONS: PROMPT_DISABLED_REASONS,
    REFERENCE_DISABLED_REASONS: REFERENCE_DISABLED_REASONS,
    LIMITS: LIMITS,
    createWorkspace: createWorkspace,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
