(function exposePrecisionByokFlow(global) {
  'use strict';

  // Command orchestration only. The existing runtime/session/ingest owners still
  // decide device, shop, capability, fees, review and assignment authority.
  const BINDING_KEYS = ['sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
    'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey'];
  const RECEIPT_KEYS = ['contractVersion', 'replayed', 'receiptId', 'assetId', 'provenanceId', 'normalizedSha256',
    'mimeType', 'width', 'height', 'sourceDraftRevision', 'sourceDraftVersion', 'boundDraftRevision',
    'boundDraftVersion', 'assignmentOrdinal', 'assignmentSha256', 'skuKey', 'slotKey'];
  const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const text = (value, max = 200) => typeof value === 'string' && value.length > 0 && value.length <= max
    && value === value.normalize('NFKC').trim() && !/[\u0000-\u001f\u007f]/u.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
  function fail(reason) { throw Object.assign(new Error('SS_ERP_PRECISION_BYOK_' + reason), { code: 'SS_ERP_PRECISION_BYOK_' + reason }); }
  function binding(value) {
    if (!record(value) || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || BINDING_KEYS.some(key => key.startsWith('draft') ? !Number.isSafeInteger(value[key]) || value[key] < 1
        : !text(value[key], key === 'skuKey' ? 500 : 200))) fail('CONTEXT_STALE');
    return Object.fromEntries(BINDING_KEYS.map(key => [key, value[key]]));
  }
  const same = (left, right) => BINDING_KEYS.every(key => left[key] === right[key]);
  const sameContext = (left, right) => same(left, right)
    && left.slotKey === right.slotKey && left.assignmentMode === right.assignmentMode
    && (left.assignmentOrdinal == null || right.assignmentOrdinal == null || left.assignmentOrdinal === right.assignmentOrdinal);
  function context(value) {
    const normalized = binding(value);
    if (value.contractVersion !== 'extension-byok-workbench-launch-context/v1'
      || value.slotKey !== 'sku:' + value.skuKey + ':hero' || value.assignmentMode !== 'APPEND'
      || !Number.isSafeInteger(value.assignmentOrdinal) || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499) fail('RESPONSE_INVALID');
    return { ...normalized, slotKey: value.slotKey, assignmentMode: value.assignmentMode, assignmentOrdinal: value.assignmentOrdinal };
  }
  function launchContext(value) {
    const normalized = binding(value);
    return { ...normalized, slotKey: value.slotKey || `sku:${value.skuKey}:hero`, assignmentMode: value.assignmentMode || 'APPEND',
      assignmentOrdinal: Number.isSafeInteger(value.assignmentOrdinal) ? value.assignmentOrdinal : null };
  }
  function candidate(value, expectedContext) {
    if (!record(value) || !/^br_[a-f0-9]{48}$/u.test(value.resultId || '')
      || !['CANDIDATE_READY', 'APPROVED'].includes(value.reviewState)) fail('RESPONSE_INVALID');
    const deliveryState = value.deliveryState || 'NOT_INGESTED';
    if (!['NOT_INGESTED', 'INGESTING', 'BOUND'].includes(deliveryState)
      || deliveryState !== 'NOT_INGESTED' && value.reviewState !== 'APPROVED') fail('RESPONSE_INVALID');
    const result = { resultId: value.resultId, reviewState: value.reviewState, deliveryState };
    if (deliveryState === 'BOUND') {
      const receipt = value.ingest;
      if (!record(receipt) || Object.keys(receipt).length !== RECEIPT_KEYS.length || RECEIPT_KEYS.some(key => !Object.hasOwn(receipt, key))
        || receipt.contractVersion !== 'extension-byok-generated-asset-ingest-client/v1' || typeof receipt.replayed !== 'boolean'
        || ['receiptId', 'assetId', 'provenanceId'].some(key => !text(receipt[key]))
        || !hash(receipt.normalizedSha256) || !hash(receipt.assignmentSha256)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(receipt.mimeType)
        || !Number.isSafeInteger(receipt.width) || receipt.width < 1 || receipt.width > 4096
        || !Number.isSafeInteger(receipt.height) || receipt.height < 1 || receipt.height > 4096
        || receipt.sourceDraftRevision !== expectedContext.draftRevision || receipt.sourceDraftVersion !== expectedContext.draftVersion
        || receipt.boundDraftRevision !== expectedContext.draftRevision + 1 || receipt.boundDraftVersion !== expectedContext.draftVersion + 1
        || receipt.skuKey !== expectedContext.skuKey || receipt.slotKey !== expectedContext.slotKey
        || receipt.assignmentOrdinal !== expectedContext.assignmentOrdinal) fail('RESPONSE_INVALID');
      result.ingest = Object.fromEntries(RECEIPT_KEYS.map(key => [key, receipt[key]]));
    }
    return result;
  }
  function createController({ media, registerUi, openSession, getBinding, newOperationKey, onChange = () => {} }) {
    if (!media || [registerUi, openSession, getBinding, newOperationKey].some(value => typeof value !== 'function')) throw new TypeError('precision BYOK dependencies unavailable');
    let connected = null, result = null, busy = false, ready = false, unknown = false, pending = null, preview = null, previewReady = false;
    let epoch = 0;
    function current(candidateValue = result, expectedContext = connected) {
      if (!expectedContext) return false;
      try {
        const actual = launchContext(getBinding());
        const expected = candidateValue?.deliveryState === 'BOUND' ? { ...expectedContext,
          draftRevision: candidateValue.ingest.boundDraftRevision, draftVersion: candidateValue.ingest.boundDraftVersion } : expectedContext;
        return sameContext(actual, expected) || candidateValue?.deliveryState === 'BOUND' && sameContext(actual, expectedContext);
      } catch { return false; }
    }
    function state() {
      const active = ready && current();
      return { ready: active, busy, generationUnknown: unknown, readbackRequired: Boolean(pending),
        context: connected && { ...connected }, candidate: result && global.structuredClone(result),
        previewReady: active && previewReady, canGenerate: active && !busy && !unknown && !pending && !result };
    }
    const emit = () => onChange(state());
    function releasePreview() { if (preview) preview.revoke(); preview = null; previewReady = false; }
    async function exclusive(operation) {
      if (busy) fail('BUSY');
      busy = true; const started = epoch; emit();
      try { return await operation(() => { if (epoch !== started) fail('CONTEXT_STALE'); }); }
      finally { busy = false; emit(); }
    }
    function requireCurrent() { if (!ready || !current()) fail('CONTEXT_STALE'); }
    async function read(check) {
      const value = await media.getPublicState(); check();
      if (!record(value) || value.contractVersion !== 'extension-byok-workbench-public-state/v1' || value.executionMode !== 'BYOK'
        || ![null, 'UNKNOWN_OUTCOME'].includes(value.generationOutcome) || value.result && value.generationOutcome !== null) fail('RESPONSE_INVALID');
      const nextContext = context(value.context);
      if (connected && !sameContext(nextContext, connected)) fail('CONTEXT_STALE');
      const next = value.result == null ? null : candidate(value.result, nextContext);
      if (!current(next, nextContext)) fail('CONTEXT_STALE');
      if (next?.resultId !== result?.resultId || next?.deliveryState === 'BOUND') releasePreview();
      connected = nextContext; result = next; unknown = value.generationOutcome === 'UNKNOWN_OUTCOME'; pending = null; ready = true;
      return state();
    }
    return Object.freeze({
      state,
      connect: () => exclusive(async check => {
        const expected = launchContext(getBinding());
        if (connected && (result || pending || unknown)) {
          if (!current()) fail('RESULT_PENDING');
          await registerUi(); check(); return read(check);
        }
        ready = false; releasePreview();
        const registration = await registerUi(); check();
        if (!registration?.registered) fail('REGISTRATION_REQUIRED');
        if (!sameContext(launchContext(getBinding()), expected)) fail('CONTEXT_STALE');
        const opened = await openSession({ listingWorkflowId: expected.workflowId, preferredSkuKey: expected.skuKey }); check();
        if (opened?.state !== 'workbench_embedded') fail('MEDIA_SESSION_REQUIRED');
        const upgraded = await registerUi(); check();
        if (upgraded?.state !== 'MEDIA_READY' || !sameContext(launchContext(getBinding()), expected)) fail('MEDIA_SESSION_REQUIRED');
        connected = null; result = null; return read(check);
      }),
      refresh: () => exclusive(async check => { if (!connected) fail('MEDIA_SESSION_REQUIRED'); return read(check); }),
      generate: input => exclusive(async check => {
        if (input?.chargeConfirmed !== true) fail('CONFIRMATION_REQUIRED');
        requireCurrent(); if (result || unknown || pending) fail('RESULT_PENDING');
        const frozen = { profileId: input.profileId, prompt: input.prompt, negativePrompt: input.negativePrompt || null, size: input.size };
        if (!text(frozen.profileId, 128) || typeof frozen.prompt !== 'string' || !frozen.prompt.trim()
          || frozen.prompt.length > 8000 || frozen.negativePrompt !== null && (typeof frozen.negativePrompt !== 'string' || frozen.negativePrompt.length > 4000)
          || !/^\d{1,4}x\d{1,4}$/u.test(frozen.size || '')) fail('INPUT_INVALID');
        const readiness = await media.getReadiness(frozen.profileId); check(); requireCurrent();
        pending = 'GENERATE'; unknown = true; emit();
        // The private client owns request normalization, readiness validation and timeout semantics.
        result = candidate(await media.generate({ ...frozen, idempotencyKey: newOperationKey(), readiness }), connected);
        check(); requireCurrent(); unknown = false; pending = null; releasePreview(); return state();
      }),
      preview: () => exclusive(async check => {
        requireCurrent(); if (!result || result.deliveryState !== 'NOT_INGESTED') fail('PREVIEW_REQUIRED');
        const id = result.resultId; releasePreview(); const next = await media.openPreview(id);
        try { check(); requireCurrent(); if (result.resultId !== id || typeof next?.objectUrl !== 'string' || !next.objectUrl.startsWith('blob:')
          || typeof next.revoke !== 'function') fail('RESPONSE_INVALID'); }
        catch (error) { next?.revoke?.(); throw error; }
        preview = next; return { resultId: id, objectUrl: next.objectUrl, metadata: { ...next.metadata } };
      }),
      confirmPreview(id) { requireCurrent(); if (!preview || id !== result?.resultId) fail('PREVIEW_REQUIRED'); previewReady = true; emit(); },
      review: decision => exclusive(async check => {
        requireCurrent(); if (pending) fail('READBACK_REQUIRED');
        if (!result || result.deliveryState !== 'NOT_INGESTED' || !['APPROVE', 'REJECT'].includes(decision)
          || decision === 'APPROVE' && result.reviewState !== 'CANDIDATE_READY') fail('REVIEW_REQUIRED');
        if (decision === 'APPROVE' && !previewReady) fail('PREVIEW_REQUIRED');
        const id = result.resultId; pending = 'REVIEW'; emit();
        const reply = await media.reviewResult(id, decision); check(); requireCurrent();
        if (reply?.resultId !== id) fail('RESPONSE_INVALID');
        if (decision === 'REJECT') { if (reply.reviewState !== 'REJECTED') fail('RESPONSE_INVALID'); result = null; releasePreview(); }
        else { const approved = candidate(reply, connected); if (approved.reviewState !== 'APPROVED' || approved.deliveryState !== 'NOT_INGESTED') fail('RESPONSE_INVALID'); result = approved; }
        pending = null; return state();
      }),
      ingest: () => exclusive(async check => {
        requireCurrent(); if (pending) fail('READBACK_REQUIRED');
        if (!result || result.reviewState !== 'APPROVED' || result.deliveryState !== 'NOT_INGESTED') fail('REVIEW_REQUIRED');
        const id = result.resultId; pending = 'INGEST'; emit();
        const accepted = candidate(await media.ingestApproved(id), connected); check();
        if (accepted.resultId !== id || accepted.deliveryState !== 'BOUND' || !current(accepted)) fail('RESPONSE_INVALID');
        result = accepted; pending = null; releasePreview(); return state();
      }),
      invalidate() { epoch++; ready = false; releasePreview(); emit(); },
      closePreview() { releasePreview(); emit(); },
    });
  }
  global.SS_ERP_PRECISION_BYOK_FLOW = Object.freeze({ createController });
}(typeof globalThis !== 'undefined' ? globalThis : self));
