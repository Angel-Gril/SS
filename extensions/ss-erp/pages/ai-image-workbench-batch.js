(function exposeByokWorkbenchBatchPage(global) {
  'use strict';

  var WORKSPACE_VERSION = 'extension-byok-workbench-workspace-state/v1';
  var WORKSPACE_ACTION_VERSION = 'extension-byok-workbench-workspace-action/v1';
  var WORKSPACE_INTENT_VERSION = 'extension-byok-workbench-action-intent/v1';
  var WORKSPACE_OUTCOME_VERSION = 'extension-byok-workbench-action-outcome/v1';
  var WORKSPACE_RUNTIME_VERSION = 'extension-byok-workbench-workspace-runtime/v1';
  var PREVIEW_STATE_VERSION = 'extension-byok-workbench-preview-state/v1';
  var BATCH_PROJECTION_VERSION = 'extension-byok-workbench-batch-coordinator/v1';
  var USER_START_VERSION = 'extension-byok-workbench-batch-user-start/v1';
  var INGEST_VERSION = 'extension-byok-workbench-batch-ingest/v1';
  var EXTERNAL_CHARGE_VERSION = 'external-provider-charge/v1';
  var DUPLICATE_CHARGE_VERSION = 'external-provider-duplicate-charge/v1';
  var MAX_SLOTS = 4;
  var SERIAL_REQUESTED_CONCURRENCY = 1;
  var MAX_PROMPT = 8000;
  var MAX_NEGATIVE_PROMPT = 4000;
  var SHARED_DETAIL_ROLES = Object.freeze(['SCENE', 'DETAIL', 'SPEC', 'PACKAGING']);
  var WORKSPACE_INTENT_ACTIONS = Object.freeze([
    'PAUSE_AFTER_CURRENT', 'CONTINUE', 'CANCEL_QUEUED', 'KEEP_ATTEMPT',
    'REJECT_ATTEMPT', 'REGENERATE_SLOT',
  ]);
  var ATTEMPT_STATES = Object.freeze([
    'QUEUED', 'SUBMITTING', 'WAITING', 'CANDIDATE_READY', 'FAILED_RETRYABLE',
    'FAILED_FINAL', 'UNKNOWN_OUTCOME', 'CANCELLED',
  ]);
  var SCHEDULER_STATES = Object.freeze([
    'READY', 'RUNNING', 'PAUSING', 'PAUSED', 'REVIEW', 'CANCELLED', 'FAILED',
  ]);
  var FORBIDDEN_PROJECTION_KEYS = Object.freeze(new Set([
    'batchid', 'binding', 'providerorigin', 'providerendpoint', 'endpoint', 'model',
    'apikey', 'authorization', 'requesthash', 'providerrequesthash', 'resultsha256',
    'providerresultsha256', 'intenthash', 'dispatchref', 'recoveryref', 'receipt',
  ]));

  function controllerError(code) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchBatchPageControllerError';
    error.code = code;
    return error;
  }

  function fail(code) {
    throw controllerError(code);
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function canonicalText(value, minimum, maximum, code) {
    if (typeof value !== 'string' || value.length < minimum || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u001f\u007f]/u.test(value)) fail(code);
    return value;
  }

  function promptText(value, maximum, nullable, code) {
    if (nullable && (value === null || value === '')) return null;
    if (typeof value !== 'string' || value.length < 1 || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      // Newlines and tabs are valid Prompt content; other controls are not.
      // eslint-disable-next-line no-control-regex
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(code);
    return value;
  }

  function identifier(value, minimum, maximum, code) {
    var result = canonicalText(value, minimum, maximum, code);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(result)) fail(code);
    return result;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) fail(code);
    return value;
  }

  function clone(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    return Object.fromEntries(Object.entries(value).map(function (entry) {
      return [entry[0], clone(entry[1])];
    }));
  }

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function sameBinding(left, right) {
    return isRecord(left) && isRecord(right)
      && left.shopId === right.shopId
      && left.workflowId === right.workflowId
      && left.draftRevision === right.draftRevision
      && left.draftVersion === right.draftVersion;
  }

  function supportedSlot(skuKey, slotKey) {
    return slotKey === 'sku:' + skuKey + ':hero'
      || SHARED_DETAIL_ROLES.some(function (role) {
        return slotKey === 'shared:detail:' + role;
      });
  }

  function safeErrorCode(error) {
    var candidate = error && typeof error === 'object' ? String(error.code || '') : '';
    return /^[A-Z][A-Z0-9_]{0,199}$/u.test(candidate)
      ? candidate : 'SS_ERP_BYOK_BATCH_PAGE_OPERATION_FAILED';
  }

  function uuid(cryptoImpl, prefix) {
    var value = cryptoImpl.randomUUID();
    if (typeof value !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
        .test(value)) fail('SS_ERP_BYOK_BATCH_PAGE_RANDOM_UNAVAILABLE');
    return prefix + value;
  }

  function imageSize(value) {
    var result = canonicalText(
      value, 3, 9, 'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
    );
    if (!/^\d{1,4}x\d{1,4}$/u.test(result)) {
      fail('SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID');
    }
    var dimensions = result.split('x').map(Number);
    if (dimensions.some(function (dimension) {
      return !Number.isSafeInteger(dimension) || dimension < 1 || dimension > 4096;
    }) || dimensions[0] * dimensions[1] > 4096 * 4096) {
      fail('SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID');
    }
    return result;
  }

  function hexadecimal(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 32) {
      fail('SS_ERP_BYOK_BATCH_PAGE_HASH_UNAVAILABLE');
    }
    return Array.from(new Uint8Array(buffer)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function inspectPublicProjection(value) {
    var seen = new Set();
    var nodes = 0;
    function visit(item, depth, fieldName) {
      nodes += 1;
      if (nodes > 8192 || depth > 12) fail('SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID');
      if (item === null || typeof item === 'boolean') return;
      if (typeof item === 'number') {
        if (!Number.isSafeInteger(item)) fail('SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID');
        return;
      }
      if (typeof item === 'string') {
        // Ordinary background projections never carry URLs or encoded media.
        if (item.length > 4096 || /^(?:https?|ftp|file|blob|data):/iu.test(item)) {
          fail('SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID');
        }
        return;
      }
      if (!item || typeof item !== 'object' || seen.has(item)
        || Object.prototype.toString.call(item) === '[object Blob]'
        || Object.prototype.toString.call(item) === '[object ArrayBuffer]') {
        fail('SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID');
      }
      seen.add(item);
      Object.keys(item).forEach(function (key) {
        var normalized = key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/gu, '');
        if (FORBIDDEN_PROJECTION_KEYS.has(normalized)) {
          fail('SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID');
        }
        visit(item[key], depth + 1, key);
      });
      seen.delete(item);
      void fieldName;
    }
    visit(value, 0, 'projection');
  }

  function normalizeBootstrap(value) {
    var code = 'SS_ERP_BYOK_BATCH_PAGE_BOOTSTRAP_INVALID';
    if (!isRecord(value) || value.contractVersion !== WORKSPACE_VERSION
      || value.executionMode !== 'BYOK' || value.dispatched !== false
      || !isRecord(value.binding) || !Array.isArray(value.skus)) fail(code);
    var binding = {
      shopId: identifier(value.binding.shopId, 1, 200, code),
      workflowId: identifier(value.binding.workflowId, 1, 200, code),
      draftRevision: positiveInteger(value.binding.draftRevision, code),
      draftVersion: positiveInteger(value.binding.draftVersion, code),
    };
    var slots = [];
    value.skus.forEach(function (sku) {
      if (!isRecord(sku) || !Array.isArray(sku.slots)) fail(code);
      var skuKey = canonicalText(sku.skuKey, 1, 500, code);
      var skuLabel = canonicalText(sku.label, 1, 500, code);
      sku.slots.forEach(function (slot) {
        if (!isRecord(slot) || !supportedSlot(skuKey, slot.slotKey)) return;
        slots.push({
          skuKey: skuKey,
          skuLabel: skuLabel,
          slotKey: identifier(slot.slotKey, 1, 200, code),
          role: slot.role === 'HERO' ? 'HERO' : 'DETAIL',
          prompt: promptText(slot.prompt, MAX_PROMPT, false, code),
          negativePrompt: promptText(slot.negativePrompt, MAX_NEGATIVE_PROMPT, true, code),
        });
      });
    });
    if (!slots.length || new Set(slots.map(function (slot) {
      return slot.slotKey;
    })).size !== slots.length) fail(code);
    return deepFreeze({
      binding: binding,
      selectedSlotKey: typeof value.selectedSlotKey === 'string' ? value.selectedSlotKey : null,
      slots: slots,
    });
  }

  function normalizeProjection(value) {
    var code = 'SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID';
    inspectPublicProjection(value);
    if (!isRecord(value) || value.contractVersion !== BATCH_PROJECTION_VERSION
      || value.executionMode !== 'BYOK' || !Number.isSafeInteger(value.revision)
      || value.revision < 0 || !isRecord(value.billing)
      || value.billing.erpGenerationChargeCents !== 0 || !Array.isArray(value.slots)) fail(code);
    if (value.scheduler !== null && (!isRecord(value.scheduler)
      || !SCHEDULER_STATES.includes(value.scheduler.state))) fail(code);
    value.slots.forEach(function (slot) {
      if (!isRecord(slot) || !Array.isArray(slot.attempts)
        || !Number.isSafeInteger(slot.revision) || slot.revision < 1) fail(code);
      identifier(slot.slotKey, 1, 200, code);
      canonicalText(slot.skuKey, 1, 500, code);
      slot.attempts.forEach(function (attempt) {
        if (!isRecord(attempt) || !ATTEMPT_STATES.includes(attempt.state)) fail(code);
        identifier(attempt.attemptId, 1, 200, code);
        if (attempt.resultId !== null && attempt.resultId !== undefined) {
          if (!/^br_[a-f0-9]{48}$/u.test(attempt.resultId)) fail(code);
        }
      });
    });
    if (value.ingest !== null && (!isRecord(value.ingest)
      || value.ingest.erpGenerationChargeCents !== 0)) fail(code);
    return deepFreeze(clone(value));
  }

  function createController(options) {
    var client = options && options.client;
    var cryptoImpl = options && options.crypto || global.crypto;
    var TextEncoderImpl = options && options.TextEncoder || global.TextEncoder;
    var BlobImpl = options && options.Blob || global.Blob;
    var urlApi = options && options.URL || global.URL;
    var nextRuntimeRevision = options && options.nextRuntimeRevision;
    var emit = options && options.emit;
    if (!client || ['state', 'start', 'command', 'openPreview', 'ingest', 'recover', 'clear']
      .some(function (name) { return typeof client[name] !== 'function'; })
      || !cryptoImpl || typeof cryptoImpl.randomUUID !== 'function'
      || !cryptoImpl.subtle || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof TextEncoderImpl !== 'function' || typeof BlobImpl !== 'function'
      || !urlApi || typeof urlApi.createObjectURL !== 'function'
      || typeof urlApi.revokeObjectURL !== 'function'
      || typeof nextRuntimeRevision !== 'function' || typeof emit !== 'function') {
      fail('SS_ERP_BYOK_BATCH_PAGE_DEPENDENCY_UNAVAILABLE');
    }

    var bootstrapState = null;
    var slotsByKey = new Map();
    var selectedSlotKeys = new Set();
    var projection = null;
    var started = false;
    var busy = false;
    var concurrency = SERIAL_REQUESTED_CONCURRENCY;
    var ingestIdempotencyKey = null;
    var preview = null;
    var previewEpoch = 0;
    var reloadEmitted = false;
    var workspaceRevision = 1;
    var runtimeRevision = 0;
    var lastErrorCode = null;
    var listeners = new Set();

    function notify() {
      var view = getView();
      listeners.forEach(function (listener) {
        try { listener(view); } catch {}
      });
    }

    function currentAttempts() {
      if (!projection) return [];
      return projection.slots.flatMap(function (slot) {
        return slot.attempts.map(function (attempt) {
          return { slot: slot, attempt: attempt };
        });
      });
    }

    function reviewReady() {
      if (!projection || !projection.slots.length || !projection.ingest
        || projection.ingest.state !== 'NOT_STARTED') return false;
      return projection.slots.every(function (slot) {
        if (!slot.selectedAttemptId) return false;
        var selected = slot.attempts.find(function (attempt) {
          return attempt.attemptId === slot.selectedAttemptId;
        });
        return Boolean(selected && selected.reviewState === 'KEPT'
          && selected.state === 'CANDIDATE_READY' && selected.resultId);
      });
    }

    function getView() {
      var ingest = projection && projection.ingest;
      var recoveryRows = currentAttempts().filter(function (row) {
        return ['FAILED_RETRYABLE', 'UNKNOWN_OUTCOME'].includes(row.attempt.state)
          && row.attempt.unknownOutcomeSuperseded !== true;
      }).map(function (row) {
        return {
          slotKey: row.slot.slotKey,
          attemptId: row.attempt.attemptId,
          state: row.attempt.state,
          expectedSlotRevision: row.slot.revision,
          chargeWarningVersion: row.attempt.chargeWarningVersion,
          recoveryRequirement: row.attempt.recoveryRequirement,
        };
      });
      return deepFreeze({
        available: Boolean(bootstrapState),
        active: started,
        locked: busy || started,
        busy: busy,
        concurrency: concurrency,
        slots: Array.from(slotsByKey.values()).map(function (slot) {
          return {
            skuKey: slot.skuKey,
            skuLabel: slot.skuLabel,
            slotKey: slot.slotKey,
            role: slot.role,
            promptReady: Boolean(slot.prompt),
            selected: selectedSlotKeys.has(slot.slotKey),
            disabled: started,
          };
        }),
        selectedCount: selectedSlotKeys.size,
        schedulerState: projection && projection.scheduler ? projection.scheduler.state : null,
        canIngest: reviewReady() && !busy,
        canRecoverIngest: Boolean(ingest && ingest.state === 'UNKNOWN_OUTCOME' && !busy),
        canClear: Boolean(started && !busy && (!ingest || [
          'NOT_STARTED', 'SUCCEEDED', 'FAILED_FINAL',
        ].includes(ingest.state))),
        ingestState: ingest ? ingest.state : null,
        recoveryRows: recoveryRows,
        erpGenerationChargeCents: projection ? projection.billing.erpGenerationChargeCents : 0,
        preview: preview ? {
          slotKey: preview.slotKey,
          attemptId: preview.attemptId,
          objectUrl: preview.objectUrl,
          metadata: clone(preview.metadata),
          ready: preview.ready,
        } : null,
        errorCode: lastErrorCode,
      });
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') fail('SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID');
      listeners.add(listener);
      listener(getView());
      var active = true;
      return function unsubscribe() {
        if (!active) return false;
        active = false;
        return listeners.delete(listener);
      };
    }

    function releasePreview() {
      if (!preview) return false;
      var prior = preview;
      preview = null;
      previewEpoch += 1;
      try { urlApi.revokeObjectURL(prior.objectUrl); } catch {}
      emit('ss-erp:workspace-preview-state', deepFreeze({
        contractVersion: PREVIEW_STATE_VERSION,
        slotKey: prior.slotKey,
        attemptId: prior.attemptId,
        ready: false,
      }));
      notify();
      return true;
    }

    function runtimeAttempt(attempt, selectedAttemptId, ingestState) {
      var state = attempt.reviewState === 'REJECTED' ? 'REJECTED' : attempt.state;
      if (attempt.attemptId === selectedAttemptId) {
        if (['SUBMITTING', 'RECOVERING'].includes(ingestState)) state = 'INGESTING';
        if (ingestState === 'SUCCEEDED') state = 'BOUND';
      }
      return {
        attemptId: attempt.attemptId,
        state: state,
        mediaId: state === 'REJECTED' ? null : attempt.resultId || null,
        errorCode: attempt.errorCode || null,
      };
    }

    function runtimeSlot(slot, ingestState) {
      var alternatives = slot.attempts.map(function (attempt) {
        return runtimeAttempt(attempt, slot.selectedAttemptId, ingestState);
      });
      var selected = alternatives.find(function (attempt) {
        return attempt.attemptId === slot.selectedAttemptId;
      });
      var unknown = alternatives.find(function (attempt) {
        return attempt.state === 'UNKNOWN_OUTCOME';
      });
      var latest = alternatives[alternatives.length - 1];
      return {
        slotKey: slot.slotKey,
        status: selected ? selected.state : unknown ? unknown.state : latest ? latest.state : 'EMPTY',
        alternatives: alternatives,
        selectedAttemptId: slot.selectedAttemptId || null,
        slotRevision: slot.revision,
      };
    }

    function emitRuntime(value) {
      if (!bootstrapState || !value.scheduler || !value.slots.length) return;
      var ingestState = value.ingest ? value.ingest.state : 'NOT_STARTED';
      var libraryRows = [];
      value.slots.forEach(function (slot) {
        slot.attempts.forEach(function (attempt) {
          if (!attempt.resultId || attempt.reviewState === 'REJECTED') return;
          libraryRows.push({
            mediaId: attempt.resultId,
            sourceType: 'GENERATED',
            label: '批次候选 ' + attempt.generation,
            secondaryLabel: attempt.reviewState === 'KEPT' ? '已保留' : attempt.state,
            skuKeys: [slot.skuKey],
            referenceEligible: false,
          });
        });
      });
      runtimeRevision = positiveInteger(
        nextRuntimeRevision(), 'SS_ERP_BYOK_BATCH_PAGE_RUNTIME_INVALID',
      );
      emit('ss-erp:workspace-runtime', deepFreeze({
        contractVersion: WORKSPACE_RUNTIME_VERSION,
        binding: clone(bootstrapState.binding),
        revision: runtimeRevision,
        task: {
          schedulerState: value.scheduler.state,
          disabledReason: null,
        },
        libraryItems: libraryRows,
        slots: value.slots.map(function (slot) { return runtimeSlot(slot, ingestState); }),
      }));
      workspaceRevision += 1;
    }

    async function handleProjection(value) {
      projection = normalizeProjection(value);
      lastErrorCode = null;
      if (projection.revision > 0) started = true;
      emitRuntime(projection);
      var ingest = projection.ingest;
      notify();
      if (ingest && ingest.state === 'SUCCEEDED' && ingest.rebootstrapRequired === true
        && !reloadEmitted) {
        var boundDraftRevision = positiveInteger(
          ingest.boundDraftRevision, 'SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID',
        );
        var boundDraftVersion = positiveInteger(
          ingest.boundDraftVersion, 'SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID',
        );
        try { await client.clear(); } catch {}
        started = false;
        releasePreview();
        reloadEmitted = true;
        emit('ss-erp:workspace-authoritative-reload', deepFreeze({
          contractVersion: 'extension-byok-workbench-authoritative-reload/v1',
          boundDraftRevision: boundDraftRevision,
          boundDraftVersion: boundDraftVersion,
        }));
      }
      return projection;
    }

    function bootstrap(value) {
      var normalized = normalizeBootstrap(value);
      if (bootstrapState && started && !sameBinding(bootstrapState.binding, normalized.binding)) {
        fail('SS_ERP_BYOK_BATCH_PAGE_BINDING_STALE');
      }
      bootstrapState = normalized;
      slotsByKey = new Map(normalized.slots.map(function (slot) {
        return [slot.slotKey, clone(slot)];
      }));
      if (!started) {
        selectedSlotKeys = new Set();
        var initial = slotsByKey.has(normalized.selectedSlotKey)
          ? normalized.selectedSlotKey : normalized.slots[0].slotKey;
        selectedSlotKeys.add(initial);
        concurrency = SERIAL_REQUESTED_CONCURRENCY;
      }
      notify();
      return getView();
    }

    function setSlotSelected(slotKeyValue, selected) {
      var slotKey = identifier(
        slotKeyValue, 1, 200, 'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
      );
      if (started || busy || !slotsByKey.has(slotKey) || typeof selected !== 'boolean') {
        fail('SS_ERP_BYOK_BATCH_PAGE_SELECTION_LOCKED');
      }
      if (selected) {
        if (selectedSlotKeys.size >= MAX_SLOTS) fail('SS_ERP_BYOK_BATCH_PAGE_SLOT_LIMIT');
        selectedSlotKeys.add(slotKey);
      } else {
        selectedSlotKeys.delete(slotKey);
      }
      concurrency = SERIAL_REQUESTED_CONCURRENCY;
      notify();
      return getView();
    }

    function setConcurrency(value) {
      if (started || busy || value !== SERIAL_REQUESTED_CONCURRENCY
        || selectedSlotKeys.size < 1) {
        fail('SS_ERP_BYOK_BATCH_PAGE_CONCURRENCY_INVALID');
      }
      concurrency = SERIAL_REQUESTED_CONCURRENCY;
      notify();
      return getView();
    }

    async function intentHash(slot, size) {
      var canonical = JSON.stringify({
        operation: 'TEXT_TO_IMAGE',
        skuKey: slot.skuKey,
        slotKey: slot.slotKey,
        prompt: slot.prompt,
        negativePrompt: slot.negativePrompt,
        size: size,
      });
      var bytes = new TextEncoderImpl().encode(canonical);
      if (!(bytes instanceof Uint8Array)) fail('SS_ERP_BYOK_BATCH_PAGE_HASH_UNAVAILABLE');
      return hexadecimal(await cryptoImpl.subtle.digest('SHA-256', bytes.buffer));
    }

    async function start(value) {
      if (!bootstrapState || started || busy || !isRecord(value)) {
        fail('SS_ERP_BYOK_BATCH_PAGE_START_UNAVAILABLE');
      }
      var profileId = identifier(
        value.profileId, 1, 128, 'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
      );
      var size = imageSize(value.size);
      if (typeof value.primaryPrompt === 'string' && bootstrapState.selectedSlotKey
        && slotsByKey.has(bootstrapState.selectedSlotKey)) {
        var primarySlot = slotsByKey.get(bootstrapState.selectedSlotKey);
        primarySlot.prompt = promptText(
          value.primaryPrompt, MAX_PROMPT, false, 'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
        );
        primarySlot.negativePrompt = promptText(
          value.primaryNegativePrompt, MAX_NEGATIVE_PROMPT, true,
          'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
        );
      }
      var selected = Array.from(selectedSlotKeys).map(function (slotKey) {
        return slotsByKey.get(slotKey);
      });
      if (selected.length < 1 || selected.length > MAX_SLOTS
        || concurrency !== SERIAL_REQUESTED_CONCURRENCY) {
        fail('SS_ERP_BYOK_BATCH_PAGE_SELECTION_INVALID');
      }
      busy = true;
      lastErrorCode = null;
      notify();
      try {
        var slots = [];
        for (const slot of selected) {
          slots.push({
            skuKey: slot.skuKey,
            slotKey: slot.slotKey,
            operation: 'TEXT_TO_IMAGE',
            providerIdempotencyKey: uuid(cryptoImpl, 'byok-page:'),
            intentHash: await intentHash(slot, size),
            prompt: slot.prompt,
            negativePrompt: slot.negativePrompt,
            size: size,
          });
        }
        var result = await client.start({
          profileId: profileId,
          requestedConcurrency: concurrency,
          slots: slots,
        });
        started = true;
        return await handleProjection(result);
      } catch (error) {
        lastErrorCode = safeErrorCode(error);
        if (error && error.outcome === 'UNKNOWN_OUTCOME') started = true;
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    function outcomeDetail(intent, status, errorCode) {
      return deepFreeze({
        contractVersion: WORKSPACE_OUTCOME_VERSION,
        binding: clone(intent.binding),
        action: intent.action,
        commandId: intent.commandId,
        expectedWorkspaceRevision: intent.expectedWorkspaceRevision,
        expectedRuntimeRevision: intent.expectedRuntimeRevision,
        expectedSlotRevision: intent.expectedSlotRevision,
        slotKey: intent.slotKey,
        attemptId: intent.attemptId,
        status: status,
        errorCode: errorCode,
      });
    }

    function commandFromIntent(intent) {
      var command = {
        kind: intent.action,
        commandId: identifier(
          intent.commandId, 1, 200, 'SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID',
        ),
        expectedWorkspaceRevision: positiveInteger(
          intent.expectedWorkspaceRevision, 'SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID',
        ),
        expectedRuntimeRevision: positiveInteger(
          projection && projection.revision,
          'SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID',
        ),
      };
      if (!['PAUSE_AFTER_CURRENT', 'CONTINUE'].includes(intent.action)) {
        command.slotKey = identifier(
          intent.slotKey, 1, 200, 'SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID',
        );
        command.expectedSlotRevision = positiveInteger(
          intent.expectedSlotRevision, 'SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID',
        );
      }
      if (['CANCEL_QUEUED', 'KEEP_ATTEMPT', 'REJECT_ATTEMPT'].includes(intent.action)) {
        command.attemptId = identifier(
          intent.attemptId, 1, 200, 'SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID',
        );
      }
      if (intent.action === 'REGENERATE_SLOT') {
        if (!exactKeys(intent.externalChargeAcknowledgement, ['warningVersion', 'confirmed'])
          || intent.externalChargeAcknowledgement.warningVersion !== EXTERNAL_CHARGE_VERSION
          || intent.externalChargeAcknowledgement.confirmed !== true) {
          fail('SS_ERP_BYOK_BATCH_PAGE_CHARGE_CONFIRMATION_REQUIRED');
        }
        command.externalChargeAcknowledgement = clone(intent.externalChargeAcknowledgement);
      }
      return command;
    }

    async function handleWorkspaceIntent(value) {
      var intent = value;
      if (!started || busy || !isRecord(intent)
        || intent.contractVersion !== WORKSPACE_INTENT_VERSION
        || !WORKSPACE_INTENT_ACTIONS.includes(intent.action)
        || !bootstrapState || !sameBinding(intent.binding, bootstrapState.binding)) {
        fail('SS_ERP_BYOK_BATCH_PAGE_INTENT_INVALID');
      }
      workspaceRevision = Math.max(workspaceRevision, intent.expectedWorkspaceRevision);
      busy = true;
      notify();
      try {
        var result = await client.command(commandFromIntent(intent));
        await handleProjection(result);
        emit('ss-erp:workspace-intent-outcome', outcomeDetail(intent, 'APPLIED', null));
        return result;
      } catch (error) {
        var errorCode = safeErrorCode(error);
        lastErrorCode = errorCode;
        emit('ss-erp:workspace-intent-outcome', outcomeDetail(intent, 'REJECTED', errorCode));
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    async function openPreview(slotKeyValue, attemptIdValue) {
      if (!started || busy) fail('SS_ERP_BYOK_BATCH_PAGE_PREVIEW_UNAVAILABLE');
      var slotKey = identifier(
        slotKeyValue, 1, 200, 'SS_ERP_BYOK_BATCH_PAGE_PREVIEW_INVALID',
      );
      var attemptId = identifier(
        attemptIdValue, 1, 200, 'SS_ERP_BYOK_BATCH_PAGE_PREVIEW_INVALID',
      );
      var match = currentAttempts().find(function (row) {
        return row.slot.slotKey === slotKey && row.attempt.attemptId === attemptId;
      });
      if (!match || match.attempt.state !== 'CANDIDATE_READY' || !match.attempt.resultId) {
        fail('SS_ERP_BYOK_BATCH_PAGE_PREVIEW_INVALID');
      }
      releasePreview();
      var epoch = previewEpoch;
      busy = true;
      notify();
      try {
        var result = await client.openPreview({ slotKey: slotKey, attemptId: attemptId });
        if (epoch !== previewEpoch) fail('SS_ERP_BYOK_BATCH_PAGE_PREVIEW_STALE');
        if (!isRecord(result) || !(result.image instanceof BlobImpl)
          || !isRecord(result.metadata)
          || !['image/png', 'image/jpeg', 'image/webp'].includes(result.metadata.mimeType)
          || !Number.isSafeInteger(result.metadata.byteLength)
          || result.metadata.byteLength < 1 || result.metadata.byteLength > 20 * 1024 * 1024
          || result.image.type !== result.metadata.mimeType
          || result.image.size !== result.metadata.byteLength
          || !/^[a-f0-9]{64}$/u.test(result.metadata.sha256)) {
          fail('SS_ERP_BYOK_BATCH_PAGE_PREVIEW_INVALID');
        }
        var objectUrl = urlApi.createObjectURL(result.image);
        if (typeof objectUrl !== 'string' || !objectUrl.startsWith('blob:')) {
          try { urlApi.revokeObjectURL(objectUrl); } catch {}
          fail('SS_ERP_BYOK_BATCH_PAGE_PREVIEW_INVALID');
        }
        preview = {
          slotKey: slotKey,
          attemptId: attemptId,
          objectUrl: objectUrl,
          metadata: clone(result.metadata),
          ready: false,
        };
        lastErrorCode = null;
        notify();
        return getView().preview;
      } catch (error) {
        lastErrorCode = safeErrorCode(error);
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    async function handleWorkspaceAction(value) {
      if (!isRecord(value) || value.contractVersion !== WORKSPACE_ACTION_VERSION
        || value.executionMode !== 'BYOK') return false;
      if (Number.isSafeInteger(value.revision)) {
        workspaceRevision = Math.max(workspaceRevision, value.revision);
      }
      if (value.action === 'SAVE_PROMPT' && !started && slotsByKey.has(value.slotKey)) {
        var slot = slotsByKey.get(value.slotKey);
        slot.prompt = promptText(
          value.prompt, MAX_PROMPT, false, 'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
        );
        slot.negativePrompt = promptText(
          value.negativePrompt, MAX_NEGATIVE_PROMPT, true,
          'SS_ERP_BYOK_BATCH_PAGE_INPUT_INVALID',
        );
        notify();
        return true;
      }
      if (value.action !== 'PREVIEW_ATTEMPT') return false;
      await openPreview(value.slotKey, value.attemptId);
      return true;
    }

    function markPreviewLoaded() {
      if (!preview) return false;
      preview.ready = true;
      emit('ss-erp:workspace-preview-state', deepFreeze({
        contractVersion: PREVIEW_STATE_VERSION,
        slotKey: preview.slotKey,
        attemptId: preview.attemptId,
        ready: true,
      }));
      notify();
      return true;
    }

    function markPreviewFailed() {
      return releasePreview();
    }

    async function ingest() {
      if (!reviewReady() || busy) fail('SS_ERP_BYOK_BATCH_PAGE_INGEST_UNAVAILABLE');
      if (!ingestIdempotencyKey) ingestIdempotencyKey = uuid(cryptoImpl, 'byok-ingest:');
      busy = true;
      notify();
      try {
        return await handleProjection(await client.ingest({
          idempotencyKey: ingestIdempotencyKey,
        }));
      } catch (error) {
        lastErrorCode = safeErrorCode(error);
        if (error && error.outcome === 'UNKNOWN_OUTCOME' && projection && projection.ingest) {
          var uncertain = clone(projection);
          uncertain.ingest.state = 'UNKNOWN_OUTCOME';
          uncertain.ingest.errorCode = lastErrorCode;
          uncertain.ingest.rebootstrapRequired = false;
          projection = deepFreeze(uncertain);
          emitRuntime(projection);
        }
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    async function recover() {
      if (!projection || !projection.ingest
        || projection.ingest.state !== 'UNKNOWN_OUTCOME' || !ingestIdempotencyKey || busy) {
        fail('SS_ERP_BYOK_BATCH_PAGE_RECOVERY_UNAVAILABLE');
      }
      busy = true;
      notify();
      try {
        return await handleProjection(await client.recover({
          idempotencyKey: ingestIdempotencyKey,
        }));
      } catch (error) {
        lastErrorCode = safeErrorCode(error);
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    function recoveryRow(slotKeyValue, attemptIdValue) {
      var row = currentAttempts().find(function (candidate) {
        return candidate.slot.slotKey === slotKeyValue
          && candidate.attempt.attemptId === attemptIdValue;
      });
      if (!row) fail('SS_ERP_BYOK_BATCH_PAGE_RECOVERY_UNAVAILABLE');
      return row;
    }

    async function recoverAttempt(value) {
      if (!isRecord(value) || busy || !started) {
        fail('SS_ERP_BYOK_BATCH_PAGE_RECOVERY_UNAVAILABLE');
      }
      var row = recoveryRow(value.slotKey, value.attemptId);
      var kind = value.kind;
      var command = {
        kind: kind,
        commandId: uuid(cryptoImpl, 'byok-command:'),
        expectedWorkspaceRevision: workspaceRevision,
        expectedRuntimeRevision: positiveInteger(
          projection && projection.revision,
          'SS_ERP_BYOK_BATCH_PAGE_RECOVERY_UNAVAILABLE',
        ),
        slotKey: row.slot.slotKey,
        attemptId: row.attempt.attemptId,
        expectedSlotRevision: row.slot.revision,
      };
      if (kind === 'RESOLVE_UNKNOWN_ATTEMPT') {
        if (row.attempt.state !== 'UNKNOWN_OUTCOME') {
          fail('SS_ERP_BYOK_BATCH_PAGE_RECOVERY_UNAVAILABLE');
        }
      } else if (kind === 'RETRY_ATTEMPT' && row.attempt.state === 'FAILED_RETRYABLE') {
        if (value.confirmed !== true) {
          fail('SS_ERP_BYOK_BATCH_PAGE_CHARGE_CONFIRMATION_REQUIRED');
        }
        command.externalChargeAcknowledgement = {
          warningVersion: EXTERNAL_CHARGE_VERSION,
          confirmed: true,
        };
      } else if (kind === 'RETRY_ATTEMPT' && row.attempt.state === 'UNKNOWN_OUTCOME') {
        if (value.confirmed !== true) {
          fail('SS_ERP_BYOK_BATCH_PAGE_CHARGE_CONFIRMATION_REQUIRED');
        }
        command.unknownOutcomeRecovery = {
          strategy: 'DUPLICATE_CHARGE_CONFIRMATION',
          warningVersion: DUPLICATE_CHARGE_VERSION,
          confirmed: true,
        };
      } else {
        fail('SS_ERP_BYOK_BATCH_PAGE_RECOVERY_UNAVAILABLE');
      }
      busy = true;
      notify();
      try {
        return await handleProjection(await client.command(command));
      } catch (error) {
        lastErrorCode = safeErrorCode(error);
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    async function refresh() {
      if (!bootstrapState || busy) return null;
      busy = true;
      notify();
      try {
        var result = await client.state();
        if (result.revision === 0) {
          var empty = normalizeProjection(result);
          if (empty.scheduler !== null || empty.slots.length !== 0 || empty.ingest !== null) {
            fail('SS_ERP_BYOK_BATCH_PAGE_RESPONSE_INVALID');
          }
          projection = null;
          started = false;
          ingestIdempotencyKey = null;
          lastErrorCode = null;
          notify();
          return null;
        }
        started = true;
        return await handleProjection(result);
      } catch (error) {
        lastErrorCode = safeErrorCode(error);
        throw error;
      } finally {
        busy = false;
        notify();
      }
    }

    async function clear() {
      if (busy) fail('SS_ERP_BYOK_BATCH_PAGE_CLEAR_UNAVAILABLE');
      busy = true;
      notify();
      try {
        await client.clear();
        releasePreview();
        projection = null;
        started = false;
        ingestIdempotencyKey = null;
        reloadEmitted = false;
        lastErrorCode = null;
        selectedSlotKeys = new Set();
        if (bootstrapState && bootstrapState.slots.length) {
          selectedSlotKeys.add(bootstrapState.slots[0].slotKey);
        }
        concurrency = SERIAL_REQUESTED_CONCURRENCY;
        notify();
        return true;
      } finally {
        busy = false;
        notify();
      }
    }

    function dispose() {
      releasePreview();
      listeners.clear();
      return true;
    }

    return Object.freeze({
      bootstrap: bootstrap,
      setSlotSelected: setSlotSelected,
      setConcurrency: setConcurrency,
      start: start,
      handleWorkspaceAction: handleWorkspaceAction,
      handleWorkspaceIntent: handleWorkspaceIntent,
      markPreviewLoaded: markPreviewLoaded,
      markPreviewFailed: markPreviewFailed,
      ingest: ingest,
      recover: recover,
      recoverAttempt: recoverAttempt,
      refresh: refresh,
      clear: clear,
      getView: getView,
      subscribe: subscribe,
      dispose: dispose,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE = Object.freeze({
    WORKSPACE_VERSION: WORKSPACE_VERSION,
    USER_START_VERSION: USER_START_VERSION,
    INGEST_VERSION: INGEST_VERSION,
    PREVIEW_STATE_VERSION: PREVIEW_STATE_VERSION,
    createController: createController,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));

(function initializeByokWorkbenchBatchPage(global) {
  'use strict';

  var SERIAL_REQUESTED_CONCURRENCY = 1;
  var api = global.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE;
  var clientApi = global.SS_ERP_BYOK_WORKBENCH_BATCH_CLIENT;
  var workspaceEvents = global.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS;
  var document = global.document;
  if (!api || !clientApi || typeof clientApi.createClient !== 'function'
    || !workspaceEvents || typeof workspaceEvents.nextRuntimeRevision !== 'function'
    || !document || typeof document.getElementById !== 'function') return;

  function byId(id) { return document.getElementById(id); }

  var nodes = {
    profileSelect: byId('profileSelect'),
    promptInput: byId('promptInput'),
    negativePromptInput: byId('negativePromptInput'),
    sizeSelect: byId('sizeSelect'),
    generateButton: byId('generateButton'),
    status: byId('batchStatus'),
    badge: byId('batchStateBadge'),
    slotList: byId('batchSlotSelection'),
    concurrency: byId('batchConcurrency'),
    acceptButton: byId('batchAcceptButton'),
    recoverButton: byId('batchRecoverButton'),
    clearButton: byId('batchClearButton'),
    recoveryList: byId('batchRecoveryList'),
    previewPanel: byId('batchPreviewPanel'),
    previewImage: byId('batchPreviewImage'),
    previewMeta: byId('batchPreviewMeta'),
    previewClose: byId('batchPreviewCloseButton'),
  };
  if (Object.values(nodes).some(function (node) { return !node; })) return;

  var client;
  try {
    client = clientApi.createClient({
      runtime: global.chrome && global.chrome.runtime,
      BroadcastChannel: global.BroadcastChannel,
      now: function () { return new Date(); },
    });
  } catch {
    return;
  }

  function emit(type, detail) {
    if (typeof global.CustomEvent !== 'function'
      || typeof document.dispatchEvent !== 'function') return false;
    document.dispatchEvent(new global.CustomEvent(type, { detail: detail }));
    return true;
  }

  var controller;
  try {
    controller = api.createController({
      client: client,
      crypto: global.crypto,
      TextEncoder: global.TextEncoder,
      Blob: global.Blob,
      URL: global.URL,
      nextRuntimeRevision: workspaceEvents.nextRuntimeRevision,
      emit: emit,
    });
  } catch {
    return;
  }

  var lifecyclePort = null;
  try {
    if (global.chrome && global.chrome.runtime
      && typeof global.chrome.runtime.connect === 'function') {
      lifecyclePort = global.chrome.runtime.connect({
        name: 'ss-erp:ai-image-workbench-batch-lifecycle',
      });
    }
  } catch {}

  var renderedSlotSignature = '';
  var renderedRecoverySignature = '';
  var lastPreviewUrl = '';
  var lastView = controller.getView();
  var pollTimer = null;
  var lastLockState = null;

  function stateClass(state) {
    if (state === 'REVIEW' || state === 'SUCCEEDED') return 'state-success';
    if (['FAILED', 'FAILED_FINAL'].includes(state)) return 'state-error';
    if (['UNKNOWN_OUTCOME', 'PAUSED', 'PAUSING'].includes(state)) return 'state-warning';
    return 'state-pending';
  }

  function statusText(view) {
    if (view.errorCode) return '批次操作被拒绝：' + view.errorCode;
    if (!view.available) return '等待当前草稿和槽位上下文';
    if (!view.active) {
      return '选择 1–4 个槽位。Provider 费用由您的 API 账户直接承担，ERP 生图费用为 0。';
    }
    if (view.ingestState === 'SUCCEEDED') return '图片已原子绑定，正在重新读取最新 ERP 草稿。';
    if (view.ingestState === 'UNKNOWN_OUTCOME') return 'ERP 接收结果待核对，只能查询原回执，不能再次提交。';
    if (view.schedulerState === 'REVIEW') return '生成完成。逐张预览并保留后，再一次性接收至 ERP。';
    if (view.schedulerState === 'PAUSED') return '批次已暂停，尚未提交的任务不会产生 Provider 费用。';
    if (view.schedulerState === 'FAILED') return '存在失败或未知结果，请使用下方精确恢复操作。';
    return '批次正在后台执行；超时不会自动重复提交 Provider 请求。';
  }

  function clearChildren(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderSlots(view) {
    var signature = JSON.stringify(view.slots);
    if (signature === renderedSlotSignature) return;
    renderedSlotSignature = signature;
    clearChildren(nodes.slotList);
    view.slots.forEach(function (slot) {
      var label = document.createElement('label');
      label.className = 'batch-slot-option';
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = slot.selected;
      checkbox.disabled = slot.disabled;
      checkbox.setAttribute('data-slot-key', slot.slotKey);
      var copy = document.createElement('span');
      var title = document.createElement('strong');
      title.textContent = slot.role === 'HERO' ? slot.skuLabel + ' · 主图' : '共享详情图';
      var meta = document.createElement('small');
      meta.textContent = slot.promptReady ? slot.slotKey : slot.slotKey + ' · 缺少提示词';
      copy.appendChild(title);
      copy.appendChild(meta);
      label.appendChild(checkbox);
      label.appendChild(copy);
      checkbox.addEventListener('change', function (event) {
        if (!event || event.isTrusted !== true) {
          checkbox.checked = !checkbox.checked;
          return;
        }
        try { controller.setSlotSelected(slot.slotKey, checkbox.checked); } catch {
          checkbox.checked = !checkbox.checked;
        }
      });
      nodes.slotList.appendChild(label);
    });
  }

  function renderConcurrency() {
    var signature = String(SERIAL_REQUESTED_CONCURRENCY);
    if (nodes.concurrency.dataset.renderSignature === signature) return;
    nodes.concurrency.dataset.renderSignature = signature;
    clearChildren(nodes.concurrency);
    var option = document.createElement('option');
    option.value = String(SERIAL_REQUESTED_CONCURRENCY);
    option.textContent = String(SERIAL_REQUESTED_CONCURRENCY);
    option.selected = true;
    nodes.concurrency.appendChild(option);
    nodes.concurrency.disabled = true;
  }

  function recoveryLabel(row) {
    if (row.state === 'UNKNOWN_OUTCOME') {
      return row.slotKey + '：Provider 结果未知';
    }
    return row.slotKey + '：可在确认费用后重试';
  }

  function runRecovery(value) {
    void controller.recoverAttempt(value).catch(function () {});
  }

  function renderRecovery(view) {
    var signature = JSON.stringify(view.recoveryRows) + '|' + String(view.busy);
    if (signature === renderedRecoverySignature) return;
    renderedRecoverySignature = signature;
    clearChildren(nodes.recoveryList);
    view.recoveryRows.forEach(function (row) {
      var item = document.createElement('li');
      item.className = 'batch-recovery-row';
      var label = document.createElement('p');
      label.textContent = recoveryLabel(row);
      item.appendChild(label);
      var actions = document.createElement('div');
      actions.className = 'batch-recovery-actions';
      if (row.state === 'UNKNOWN_OUTCOME') {
        var resolveButton = document.createElement('button');
        resolveButton.type = 'button';
        resolveButton.className = 'button button-secondary button-compact';
        resolveButton.textContent = '查询原请求';
        resolveButton.disabled = view.busy;
        resolveButton.addEventListener('click', function (event) {
          if (!event || event.isTrusted !== true || resolveButton.disabled) return;
          runRecovery({
            kind: 'RESOLVE_UNKNOWN_ATTEMPT',
            slotKey: row.slotKey,
            attemptId: row.attemptId,
          });
        });
        actions.appendChild(resolveButton);
      }
      if (row.recoveryRequirement === 'SERVICE_WORKER_RESTART_RECONCILIATION_REQUIRED') {
        item.appendChild(actions);
        nodes.recoveryList.appendChild(item);
        return;
      }
      var confirmationLabel = document.createElement('label');
      confirmationLabel.className = 'batch-charge-confirmation';
      var confirmation = document.createElement('input');
      confirmation.type = 'checkbox';
      confirmation.disabled = view.busy;
      var confirmationText = document.createElement('span');
      confirmationText.textContent = row.state === 'UNKNOWN_OUTCOME'
        ? '确认可能重复扣费' : '确认再次产生 Provider 费用';
      confirmationLabel.appendChild(confirmation);
      confirmationLabel.appendChild(confirmationText);
      var retryButton = document.createElement('button');
      retryButton.type = 'button';
      retryButton.className = 'button button-danger button-compact';
      retryButton.textContent = row.state === 'UNKNOWN_OUTCOME' ? '承担风险并重试' : '重试';
      retryButton.disabled = true;
      confirmation.addEventListener('change', function (event) {
        if (!event || event.isTrusted !== true) return;
        retryButton.disabled = view.busy || confirmation.checked !== true;
      });
      retryButton.addEventListener('click', function (event) {
        if (!event || event.isTrusted !== true || retryButton.disabled) return;
        runRecovery({
          kind: 'RETRY_ATTEMPT',
          slotKey: row.slotKey,
          attemptId: row.attemptId,
          confirmed: confirmation.checked === true,
        });
      });
      actions.appendChild(confirmationLabel);
      actions.appendChild(retryButton);
      item.appendChild(actions);
      nodes.recoveryList.appendChild(item);
    });
    nodes.recoveryList.hidden = view.recoveryRows.length === 0;
  }

  function renderPreview(view) {
    var preview = view.preview;
    nodes.previewPanel.hidden = !preview;
    if (!preview) {
      lastPreviewUrl = '';
      nodes.previewImage.removeAttribute('src');
      nodes.previewMeta.textContent = '选择候选后通过一次性通道读取预览';
      return;
    }
    if (lastPreviewUrl !== preview.objectUrl) {
      lastPreviewUrl = preview.objectUrl;
      nodes.previewImage.src = preview.objectUrl;
    }
    nodes.previewMeta.textContent = preview.ready
      ? preview.metadata.mimeType + ' · ' + preview.metadata.byteLength + ' bytes · 已验证'
      : '正在验证候选预览';
  }

  function render(view) {
    lastView = view;
    if (document.body && document.body.dataset) {
      document.body.dataset.byokBatchLocked = view.locked ? 'true' : 'false';
    }
    if (lastLockState !== view.locked) {
      lastLockState = view.locked;
      emit('ss-erp:byok-batch-lock-change', Object.freeze({ locked: view.locked }));
    }
    renderSlots(view);
    renderConcurrency(view);
    renderRecovery(view);
    renderPreview(view);
    nodes.status.textContent = statusText(view);
    var displayState = view.ingestState || view.schedulerState || (view.available ? 'READY' : 'PENDING');
    nodes.badge.textContent = displayState === 'READY' ? '待开始' : displayState || '等待上下文';
    nodes.badge.className = 'state-badge ' + stateClass(displayState);
    nodes.acceptButton.disabled = !view.canIngest;
    nodes.recoverButton.hidden = !view.canRecoverIngest;
    nodes.recoverButton.disabled = !view.canRecoverIngest;
    nodes.clearButton.disabled = !view.canClear;
    nodes.clearButton.hidden = !view.active;
    if (view.active) {
      nodes.generateButton.disabled = true;
      nodes.generateButton.textContent = '批次已开始';
      nodes.profileSelect.disabled = true;
      nodes.promptInput.disabled = true;
      nodes.negativePromptInput.disabled = true;
      nodes.sizeSelect.disabled = true;
    } else {
      nodes.generateButton.textContent = view.selectedCount > 1
        ? '生成所选 ' + view.selectedCount + ' 个槽位' : '生成所选槽位';
    }
    var polling = view.active && !view.busy && (
      view.schedulerState === null
      || ['READY', 'RUNNING', 'PAUSING'].includes(view.schedulerState)
      || ['SUBMITTING', 'RECOVERING'].includes(view.ingestState)
    );
    if (!polling && pollTimer !== null) {
      global.clearTimeout(pollTimer);
      pollTimer = null;
    } else if (polling && pollTimer === null) {
      pollTimer = global.setTimeout(function () {
        pollTimer = null;
        void controller.refresh().catch(function () {});
      }, 750);
    }
  }

  controller.subscribe(render);

  nodes.concurrency.addEventListener('change', function (event) {
    if (!event || event.isTrusted !== true) return;
    try { controller.setConcurrency(Number(nodes.concurrency.value)); } catch {}
  });
  nodes.acceptButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.acceptButton.disabled) return;
    void controller.ingest().catch(function () {});
  });
  nodes.recoverButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.recoverButton.disabled) return;
    void controller.recover().catch(function () {});
  });
  nodes.clearButton.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true || nodes.clearButton.disabled) return;
    void controller.clear().catch(function () {});
  });
  nodes.previewClose.addEventListener('click', function (event) {
    if (!event || event.isTrusted !== true) return;
    controller.markPreviewFailed();
  });
  nodes.previewImage.addEventListener('load', function () {
    if (!lastView.preview || nodes.previewImage.src !== lastView.preview.objectUrl
      || nodes.previewImage.complete !== true || nodes.previewImage.naturalWidth < 1
      || nodes.previewImage.naturalHeight < 1) return;
    controller.markPreviewLoaded();
  });
  nodes.previewImage.addEventListener('error', function () {
    if (!lastView.preview || nodes.previewImage.src !== lastView.preview.objectUrl) return;
    controller.markPreviewFailed();
  });

  document.addEventListener('ss-erp:workspace-bootstrap', function (event) {
    var detail = event && event.detail;
    if (!detail || detail.executionMode !== 'BYOK' || detail.dispatched !== false) return;
    try {
      controller.bootstrap(detail);
      void controller.refresh().catch(function () {});
    } catch {}
  });
  document.addEventListener('ss-erp:workspace-action', function (event) {
    void controller.handleWorkspaceAction(event && event.detail).catch(function () {});
  });
  document.addEventListener('ss-erp:workspace-intent', function (event) {
    void controller.handleWorkspaceIntent(event && event.detail).catch(function () {});
  });

  function startFromPage() {
    if (!lastView.available || lastView.active || lastView.busy) return Promise.resolve(false);
    return controller.start({
      profileId: String(nodes.profileSelect.value || ''),
      size: String(nodes.sizeSelect.value || ''),
      primaryPrompt: String(nodes.promptInput.value || '').normalize('NFKC').trim(),
      primaryNegativePrompt: String(nodes.negativePromptInput.value || '').normalize('NFKC').trim(),
    }).then(function () { return true; });
  }

  function syncGenerateControl(value) {
    var view = controller.getView();
    var baseDisabled = !value || value.baseDisabled === true;
    if (!view.available || view.active || view.busy || view.selectedCount < 1) {
      nodes.generateButton.disabled = true;
    } else {
      nodes.generateButton.disabled = baseDisabled;
    }
    render(view);
    return !nodes.generateButton.disabled;
  }

  function dispose() {
    if (pollTimer !== null) {
      global.clearTimeout(pollTimer);
      pollTimer = null;
    }
    try { controller.dispose(); } catch {}
    if (lifecyclePort) {
      try { lifecyclePort.disconnect(); } catch {}
      lifecyclePort = null;
    }
  }
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('pagehide', dispose, { once: true });
  }

  global.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE_CONTROLLER = Object.freeze({
    isAvailable: function () { return controller.getView().available; },
    isLocked: function () { return controller.getView().locked; },
    startFromPage: startFromPage,
    syncGenerateControl: syncGenerateControl,
    refresh: controller.refresh,
    clear: controller.clear,
    getView: controller.getView,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
