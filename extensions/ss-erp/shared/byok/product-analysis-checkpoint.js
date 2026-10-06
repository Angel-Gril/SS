(function (global) {
  'use strict';
  var api = global.SS_ERP_BYOK_PRODUCT_ANALYSIS_CONTRACT;
  var STORAGE_KEY = 'ss-erp:product-preparation-session:v1';
  var MAX_STORAGE_BYTES = 2 * 1024 * 1024;
  var MAX_CHECKPOINTS = 16;
  var queue = Promise.resolve();
  function enqueue(fn) { var next = queue.catch(function () {}).then(fn); queue = next.catch(function () {}); return next; }
  function sameDraft(left, right) {
    return ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(function (key) { return left[key] === right[key]; });
  }
  function identity(binding, owner, includeFrame) {
    return JSON.stringify([owner.ownerUserId, owner.deviceSessionId, owner.sourcePlatform, owner.sourceProductId,
      ...(includeFrame ? [owner.tabId, owner.frameId] : []), includeFrame
        ? [binding.snapshotId, binding.supplyGoodsId, binding.shopId, binding.listingWorkflowId] : binding]);
  }
  function unresolvedInWorkflow(row, current) {
    if (row.status === 'SUCCEEDED') return false;
    try {
      return sameDraft(api.binding(row.analysisInput.binding), current.binding)
        && JSON.stringify(JSON.parse(row.identity).slice(0, 4)) === JSON.stringify([
          current.owner.ownerUserId, current.owner.deviceSessionId, current.owner.sourcePlatform, current.owner.sourceProductId]);
    } catch { throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_SESSION_CORRUPT', 'UNKNOWN_OUTCOME'); }
  }
  function createStore(options) {
    var storage = options && options.sessionStorage;
    if (!api || !storage || ['get', 'set', 'remove'].some(function (name) { return typeof storage[name] !== 'function'; })) {
      throw api?.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_SESSION_UNAVAILABLE') || new Error('SS_ERP_BYOK_PRODUCT_ANALYSIS_SESSION_UNAVAILABLE');
    }
    async function load() {
      var raw = (await storage.get([STORAGE_KEY]))[STORAGE_KEY];
      if (raw === undefined) return { version: 1, checkpoints: [], operations: [] };
      try {
        if (!api.exact(raw, ['version', 'checkpoints', 'operations']) || raw.version !== 1
          || !Array.isArray(raw.checkpoints) || raw.checkpoints.length > MAX_CHECKPOINTS
          || !Array.isArray(raw.operations) || raw.operations.length > api.LIMITS.maxOperations) throw new Error();
        return api.safeTree(raw, MAX_STORAGE_BYTES);
      } catch { throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_SESSION_CORRUPT', 'UNKNOWN_OUTCOME'); }
    }
    async function save(value) {
      try { await storage.set({ [STORAGE_KEY]: api.safeTree(value, MAX_STORAGE_BYTES) }); }
      catch { throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_SESSION_UNAVAILABLE', 'UNKNOWN_OUTCOME'); }
    }
    function scope(value, includeFrame) {
      var binding = api.binding(value.binding), owner = api.owner(value.owner);
      return { binding: binding, owner: owner, identity: identity(binding, owner, includeFrame) };
    }
    function checkpoint(value, binding) {
      var keys = ['version', 'context', 'operation', 'analysisInput', 'receipt', 'draft', 'review'];
      if (value?.contractVersion != null) keys.push('contractVersion');
      if (value && Object.hasOwn(value, 'application')) keys.push('application');
      if (value && Object.hasOwn(value, 'selections')) keys.push('selections');
      for(var extra of ['rootOperationKey','stage','stageResults','stageStartedAt','failure','manuallyContinued']) {
        if(value&&Object.hasOwn(value,extra))keys.push(extra);
      }
      if (!api.exact(value, keys) || value.version !== 1
        || value.contractVersion != null && value.contractVersion !== 'precision-preparation-checkpoint/v1'
        || !value.context || !sameDraft(api.binding(value.context.binding), binding)
        || !['ERP_HOSTED', 'BYOK'].includes(value.context.mode)
        || !api.exact(value.review, ['curationConfirmed', 'visualApplied', 'copySaved', 'attributesApplied'])
        || Object.values(value.review).some(function (flag) { return typeof flag !== 'boolean'; })) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      var originalBinding = api.binding(value.context.binding);
      var stages=['CURATION','VISION','COPY'],results=value.stageResults||{};
      if(value.context.stagedAnalysis!==undefined&&typeof value.context.stagedAnalysis!=='boolean'
        ||value.manuallyContinued!==undefined&&typeof value.manuallyContinued!=='boolean'
        ||value.stage!==undefined&&value.stage!==null&&!stages.includes(value.stage)
        ||value.stageStartedAt!==undefined&&value.stageStartedAt!==null&&(!Number.isSafeInteger(value.stageStartedAt)||value.stageStartedAt<0)
        ||!results||typeof results!=='object'||Array.isArray(results)||Object.keys(results).some(function(key){return !stages.includes(key);})
        ||value.rootOperationKey!==undefined&&value.rootOperationKey!==null&&api.identifier(value.rootOperationKey,128)!==value.rootOperationKey
        ||Object.keys(results).length&&(!value.context.stagedAnalysis||value.context.mode!=='ERP_HOSTED'))throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      var missing=false;
      for(var stage of stages){
        var result=results[stage];
        if(!result){missing=true;continue;}
        if(missing||result.stage!==stage||result.operationKey!==value.rootOperationKey
          ||JSON.stringify(api.binding(result.binding))!==JSON.stringify(originalBinding)
          ||result.skuKey!==value.context.skuKey||JSON.stringify(result.sourceMediaKeys)!==JSON.stringify(value.context.sourceMediaKeys)
          ||result.category?.catalogRevision!==value.context.categoryRevision?.catalogRevision
          ||result.category?.schemaRevision!==value.context.categoryRevision?.schemaRevision)throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      }
      if(value.operation?.stage&&(value.operation.operationKey!==value.rootOperationKey||value.operation.stage!==value.stage
        ||!stages.includes(value.operation.stage)))throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      if(value.failure!==undefined&&value.failure!==null&&(!api.exact(value.failure,['stage','code'])
        ||!stages.includes(value.failure.stage)||!/^[a-zA-Z0-9_]{1,100}$/u.test(value.failure.code)))throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      if (value.selections != null) {
        if (!api.exact(value.selections, ['curationMediaKeys', 'visualDescription'])) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
        var selectedKeys = value.selections.curationMediaKeys;
        if (selectedKeys !== null && (!Array.isArray(selectedKeys) || !selectedKeys.length || selectedKeys.length > (value.context.stagedAnalysis?24:5)
          || new Set(selectedKeys).size !== selectedKeys.length || !Array.isArray(value.context.sourceMediaKeys)
          || selectedKeys.some(function (key) { return !value.context.sourceMediaKeys.includes(api.identifier(key)); }))) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
        if (value.selections.visualDescription !== null) api.visualDescription(value.selections.visualDescription);
      }
      for (var item of [value.operation, value.analysisInput, value.receipt]) {
        if (item && JSON.stringify(api.binding(item.binding)) !== JSON.stringify(originalBinding)) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      }
      if (value.application && (!api.exact(value.application, ['kind', 'request'])
        || !['ATTRIBUTES', 'COPY'].includes(value.application.kind)
        || !sameDraft(api.binding(value.application.request?.binding), originalBinding)
        || value.application.request.binding.draftRevision < originalBinding.draftRevision
        || value.application.request.binding.draftVersion < originalBinding.draftVersion)) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      if (value.draft && (!api.exact(value.draft, ['titleRu', 'descriptionRu', 'tagsRu']) || !Array.isArray(value.draft.tagsRu)
        || value.draft.tagsRu.length > 20 || typeof value.draft.titleRu !== 'string' || value.draft.titleRu.length > 500
        || typeof value.draft.descriptionRu !== 'string' || value.draft.descriptionRu.length > 4096)) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_INVALID');
      return api.safeTree(value, api.LIMITS.maxCheckpointBytes);
    }
    async function read(value) {
      var current = scope(value, true);
      return enqueue(async function () {
        var data = await load(), row = data.checkpoints.find(function (entry) { return entry.identity === current.identity; });
        return row ? checkpoint(row.checkpoint, current.binding) : null;
      });
    }
    async function write(value) {
      var current = scope(value, true), state = checkpoint(value.checkpoint, current.binding);
      return enqueue(async function () {
        var data = await load(), rows = data.checkpoints.filter(function (entry) { return entry.identity !== current.identity; });
        if (rows.length >= MAX_CHECKPOINTS) throw api.error('SS_ERP_PREPARATION_CHECKPOINT_LIMIT');
        rows.push({ identity: current.identity, checkpoint: state }); data.checkpoints = rows;
        await save(data); return { saved: true };
      });
    }
    async function clear(value) {
      var current = scope(value, true);
      return enqueue(async function () {
        var data = await load(); data.checkpoints = data.checkpoints.filter(function (entry) { return entry.identity !== current.identity; });
        // A UI checkpoint reset never clears the dispatch guard of an unknown Provider POST.
        await save(data); return { cleared: true };
      });
    }
    async function lookup(value) {
      var current = scope(value, false), operationKey = api.identifier(value.operationKey, 128);
      return enqueue(async function () {
        var data = await load();
        return data.operations.find(function (row) { return row.identity === current.identity && row.operationKey === operationKey; }) || null;
      });
    }
    async function assertMayStart(value) {
      var current = scope(value, false), operationKey = api.identifier(value.operationKey, 128);
      return enqueue(async function () {
        var data = await load();
        var existing = data.operations.find(function (row) { return row.identity === current.identity && row.operationKey === operationKey; });
        if (existing) {
          if (existing.requestHash !== value.requestHash) throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_IDEMPOTENCY_CONFLICT');
          return existing;
        }
        if (data.operations.some(function (row) { return unresolvedInWorkflow(row, current); })) {
          throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        }
        return null;
      });
    }
    async function begin(value) {
      var current = scope(value, false), operationKey = api.identifier(value.operationKey, 128);
      if (typeof value.requestHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.requestHash)) throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_INPUT_INVALID');
      return enqueue(async function () {
        var data = await load();
        var existing = data.operations.find(function (row) { return row.identity === current.identity && row.operationKey === operationKey; });
        if (existing) {
          if (existing.requestHash !== value.requestHash) throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_IDEMPOTENCY_CONFLICT');
          throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        }
        if (data.operations.some(function (row) { return unresolvedInWorkflow(row, current); })) {
          throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_UNKNOWN_OUTCOME', 'UNKNOWN_OUTCOME');
        }
        if (data.operations.length >= api.LIMITS.maxOperations) throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_SESSION_LIMIT');
        data.operations.push({ identity: current.identity, operationKey: operationKey, requestHash: value.requestHash,
          status: 'SENDING', analysisInput: api.safeTree(value.analysisInput, api.LIMITS.maxContextBytes), report: null, receipt: null });
        await save(data); return { started: true };
      });
    }
    async function update(value) {
      var current = scope(value, false), operationKey = api.identifier(value.operationKey, 128);
      if (!['GENERATED', 'SUCCEEDED', 'UNKNOWN_OUTCOME'].includes(value.status)) throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_INPUT_INVALID');
      return enqueue(async function () {
        var data = await load(), row = data.operations.find(function (entry) { return entry.identity === current.identity && entry.operationKey === operationKey; });
        if (!row || row.requestHash !== value.requestHash || row.status === 'SUCCEEDED') throw api.error('SS_ERP_BYOK_PRODUCT_ANALYSIS_IDEMPOTENCY_CONFLICT');
        row.status = value.status;
        if (value.report !== undefined) row.report = api.safeTree(value.report, api.LIMITS.maxResponseBytes);
        if (value.receipt !== undefined) row.receipt = api.safeTree(value.receipt, api.LIMITS.maxResponseBytes);
        await save(data); return { saved: true };
      });
    }
    return Object.freeze({ read: read, write: write, clear: clear, lookup: lookup, assertMayStart: assertMayStart, begin: begin, update: update });
  }
  global.SS_ERP_BYOK_PRODUCT_ANALYSIS_CHECKPOINT = Object.freeze({ STORAGE_KEY: STORAGE_KEY, createStore: createStore });
}(typeof globalThis !== 'undefined' ? globalThis : self));
