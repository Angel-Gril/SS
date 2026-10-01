(function exposePrecisionByokEditFlow(global) {
  'use strict';

  var CATALOG_VERSION = 'extension-byok-workbench-source-catalog/v1';
  var CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var SOURCE_OPERATION_VERSION = 'extension-byok-edit-review-handoff/v1';
  var BINDING_KEYS = ['sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey'];
  var record = function (value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); };
  var text = function (value, max) { return typeof value === 'string' && value.length > 0 && value.length <= (max || 500)
    && value === value.normalize('NFKC').trim() && !/[\u0000-\u001f\u007f]/u.test(value); };
  function fail(reason) { throw Object.assign(new Error('SS_ERP_PRECISION_BYOK_EDIT_' + reason), { code: 'SS_ERP_PRECISION_BYOK_EDIT_' + reason }); }
  function binding(value) {
    if (!record(value) || BINDING_KEYS.some(function (key) {
      return key === 'draftRevision' || key === 'draftVersion'
        ? !Number.isSafeInteger(value[key]) || value[key] < 1
        : !text(value[key], key === 'skuKey' ? 500 : 200);
    }) || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)) fail('CONTEXT_STALE');
    return Object.fromEntries(BINDING_KEYS.map(function (key) { return [key, value[key]]; }));
  }
  function same(left, right) { return BINDING_KEYS.every(function (key) { return left[key] === right[key]; }); }
  function context(value) {
    var normalized = binding(value);
    if (value.contractVersion !== CONTEXT_VERSION || value.slotKey !== 'sku:' + value.skuKey + ':hero'
      || value.assignmentMode !== 'APPEND' || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499) fail('RESPONSE_INVALID');
    return { ...normalized, slotKey: value.slotKey, assignmentMode: value.assignmentMode, assignmentOrdinal: value.assignmentOrdinal };
  }
  function createController(options) {
    var media = options && options.media;
    var getBinding = options && options.getBinding;
    if (!media || typeof getBinding !== 'function') throw new TypeError('precision edit dependencies unavailable');
    var connected = null;
    var catalog = [];
    var references = [];
    var snapshot = null;
    var candidate = null;
    var source = null;
    var mask = null;
    var preview = null;
    var busy = false;
    var readbackRequired = false;
    var handoff = null;
    var epoch = 0;
    function current() {
      try { return connected && same(binding(getBinding()), connected); } catch (_error) { return false; }
    }
    function state() { return { connected: Boolean(connected && current()), busy, readbackRequired,
      catalog: catalog.slice(), references: references.map(function (item) { return { ...item }; }),
      source: source && { ...source }, mask: mask && { ...mask },
      snapshot, candidate, preview: preview && { objectUrl: preview.objectUrl, resultId: preview.resultId }, handoff }; }
    function emit() { options.onChange?.(state()); }
    function releasePreview() { if (preview) preview.revoke(); preview = null; }
    async function exclusive(operation) {
      if (busy) fail('BUSY');
      busy = true; var started = epoch; emit();
      try { return await operation(function () { if (started !== epoch) fail('CONTEXT_STALE'); }); }
      finally { busy = false; emit(); }
    }
    async function connect() {
      return exclusive(async function (check) {
        var value = await media.getPublicState(); check();
        if (!record(value) || value.contractVersion !== 'extension-byok-workbench-public-state/v1'
          || value.executionMode !== 'BYOK' || !value.context) fail('RESPONSE_INVALID');
        connected = context(value.context);
        if (!current()) fail('CONTEXT_STALE');
        var loaded = await media.getEditState(); check();
        if (!record(loaded) || loaded.contractVersion !== 'extension-byok-workbench-edit-controller/v1') fail('RESPONSE_INVALID');
        snapshot = loaded; emit(); return state();
      });
    }
    async function loadCatalog() {
      return exclusive(async function (check) {
        if (!connected) fail('CONTEXT_STALE');
        var loaded = await media.getSourceCatalog(); check();
        if (!record(loaded) || loaded.contractVersion !== CATALOG_VERSION || !Array.isArray(loaded.items)) fail('RESPONSE_INVALID');
        catalog = loaded.items.filter(function (item) {
          return record(item) && text(item.sourceMediaKey, 500) && text(item.role, 100) && text(item.label, 200);
        }).slice(0, 50);
        emit(); return state();
      });
    }
    async function setReferences(keys) {
      return exclusive(async function (check) {
        if (!connected || !current()) fail('CONTEXT_STALE');
        var desired = Array.from(new Set(Array.isArray(keys) ? keys : []));
        if (!desired.length || desired.length > 4 || desired.some(function (key) { return !catalog.some(function (item) { return item.sourceMediaKey === key; }); })) fail('REFERENCE_INVALID');
        var added = [];
        try {
          for (var index = 0; index < desired.length; index += 1) {
            var source = await media.openSourcePreview(desired[index], 'WORKING'); check();
            var uploaded = await media.uploadEditMedia('REFERENCE', source.blob); check();
            source.revoke();
            added.push({ sourceMediaKey: desired[index], mediaHandle: uploaded.mediaHandle, metadata: uploaded.metadata });
          }
          var response = await media.setEditReferences({ scope: 'SLOT', handles: added.map(function (item) { return item.mediaHandle; }) }); check();
          if (!record(response) || response.executionMode !== 'BYOK') fail('RESPONSE_INVALID');
          for (var oldIndex = 0; oldIndex < references.length; oldIndex += 1) await media.releaseEditMedia(references[oldIndex].mediaHandle, 'REFERENCE');
          references = added; emit(); return state();
        } catch (error) {
          for (var addedIndex = 0; addedIndex < added.length; addedIndex += 1) await media.releaseEditMedia(added[addedIndex].mediaHandle, 'REFERENCE').catch(function () {});
          throw error;
        }
      });
    }
    async function setSource(sourceMediaKey) {
      return exclusive(async function (check) {
        if (!connected || !current() || !catalog.some(function (item) { return item.sourceMediaKey === sourceMediaKey; })) fail('SOURCE_INVALID');
        var opened = await media.openSourcePreview(sourceMediaKey, 'WORKING'); check();
        var uploaded = await media.uploadEditMedia('SOURCE', opened.blob); opened.revoke(); check();
        if (source) await media.releaseEditMedia(source.mediaHandle, 'SOURCE').catch(function () {});
        source = { sourceMediaKey: sourceMediaKey, mediaHandle: uploaded.mediaHandle, metadata: uploaded.metadata }; emit(); return state();
      });
    }
    async function setMaskBlob(blob) {
      return exclusive(async function (check) {
        if (!connected || !current() || !blob || typeof blob.size !== 'number' || blob.size < 1) fail('MASK_INVALID');
        var uploaded = await media.uploadEditMedia('MASK', blob); check();
        if (mask) await media.releaseEditMedia(mask.mediaHandle, 'MASK').catch(function () {});
        mask = { mediaHandle: uploaded.mediaHandle, metadata: uploaded.metadata }; emit(); return state();
      });
    }
    async function start(input) {
      return exclusive(async function (check) {
        if (!current()) fail('CONTEXT_STALE');
        if (!record(input)) fail('INPUT_INVALID_RECORD');
        if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(input.operation)) fail('INPUT_INVALID_OPERATION');
        if (!text(input.profileId, 128)) fail('INPUT_INVALID_PROFILE');
        if (!text(input.prompt, 8000)) fail('INPUT_INVALID_PROMPT');
        if (input.operation === 'IMAGE_TO_IMAGE' && (!references.length || input.sourceHandle !== null || input.maskHandle !== null)) fail('REFERENCE_REQUIRED');
        if (input.operation === 'FULL_EDIT' && (!source || input.sourceHandle !== source.mediaHandle || input.maskHandle !== null)) fail('SOURCE_REQUIRED');
        if (input.operation === 'INPAINT' && (!source || !mask || input.sourceHandle !== source.mediaHandle || input.maskHandle !== mask.mediaHandle)) fail('MASK_REQUIRED');
        var next = await media.startEdit({ profileId: input.profileId, operation: input.operation, prompt: input.prompt,
          negativePrompt: input.negativePrompt || null, size: input.size, sourceHandle: input.sourceHandle, maskHandle: input.maskHandle }); check();
        if (!record(next) || next.contractVersion !== 'extension-byok-workbench-edit-controller/v1') fail('RESPONSE_INVALID');
        snapshot = next; candidate = null; handoff = null; readbackRequired = false; emit(); return state();
      });
    }
    async function select(attemptId) { return exclusive(async function (check) {
      if (!snapshot || !text(attemptId, 200)) fail('CANDIDATE_INVALID');
      snapshot = await media.selectEditAlternative(attemptId); check(); emit(); return state();
    }); }
    async function openCandidate(attemptId) { return exclusive(async function (check) {
      var selected = snapshot && snapshot.alternatives?.find(function (item) { return item.attemptId === attemptId && item.candidateId; });
      if (!selected) fail('CANDIDATE_INVALID');
      releasePreview(); var opened = await media.openEditPreview(selected.candidateId); check();
      if (!opened || typeof opened.objectUrl !== 'string' || !opened.objectUrl.startsWith('blob:')) fail('RESPONSE_INVALID');
      preview = { ...opened, resultId: selected.candidateId }; candidate = { resultId: selected.candidateId, attemptId: selected.attemptId, state: selected.state };
      emit(); return state();
    }); }
    async function prepareReview() { return exclusive(async function (check) {
      if (!snapshot || !snapshot.slot || !candidate || candidate.state !== 'CANDIDATE_READY') fail('REVIEW_REQUIRED');
      var expectedSlotRevision = snapshot.slot.revision;
      handoff = await media.prepareEditReview(candidate.attemptId, expectedSlotRevision); check();
      if (!record(handoff)) fail('RESPONSE_INVALID');
      if (handoff.resultId !== candidate.resultId) fail('RESPONSE_INVALID');
      snapshot = null; emit(); return Object.freeze({ contractVersion: SOURCE_OPERATION_VERSION, resultId: candidate.resultId,
        attemptId: candidate.attemptId, expectedSlotRevision: expectedSlotRevision, handoff });
    }); }
    function invalidate() { epoch += 1; releasePreview(); catalog = []; references = []; source = null; mask = null; snapshot = null; candidate = null; handoff = null; connected = null; emit(); }
    return Object.freeze({ state, connect, loadCatalog, setReferences, setSource, setMaskBlob, start, select, openCandidate, prepareReview, invalidate });
  }
  global.SS_ERP_PRECISION_BYOK_EDIT_FLOW = Object.freeze({ createController });
}(typeof globalThis !== 'undefined' ? globalThis : self));
