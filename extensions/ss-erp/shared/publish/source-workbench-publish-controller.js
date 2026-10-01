(function exposeSourceWorkbenchPublishController(global) {
  'use strict';

  var MAX_OPERATIONS = 8;
  var BASIS_KEYS = ['binding', 'selectedSkuKeys', 'mediaAssignments', 'stage', 'validation'];
  var BINDING_KEYS = ['shopId', 'workflowId', 'draftRevision', 'draftVersion'];
  var MEDIA_KEYS = ['scope', 'skuKey', 'slotKey', 'assetId'];
  var HASH_PATTERN = /^[a-f0-9]{64}$/u;

  function controllerError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value) && Object.keys(value).length === keys.length
      && keys.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); });
  }

  function canonicalText(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum
      && value === value.normalize('NFKC').trim()
      && !/[\u0000-\u001f\u007f]/u.test(value);
  }

  function command(value) {
    var keys = value && value.action === 'CONFIRM'
      ? ['listingWorkflowId', 'action', 'previewHash']
      : ['listingWorkflowId', 'action'];
    if (!exactKeys(value, keys) || !canonicalText(value.listingWorkflowId, 200)
      || !['PREVIEW', 'CONFIRM', 'STATUS'].includes(value.action)
      || (value.action === 'CONFIRM'
        && (typeof value.previewHash !== 'string' || !HASH_PATTERN.test(value.previewHash)))) {
      throw controllerError('SS_ERP_SOURCE_WORKBENCH_PUBLISH_INPUT_INVALID');
    }
    return {
      listingWorkflowId: value.listingWorkflowId,
      action: value.action,
      previewHash: value.action === 'CONFIRM' ? value.previewHash : null,
    };
  }

  function invalidBasis() {
    throw controllerError('SS_ERP_SOURCE_WORKBENCH_PUBLISH_BASIS_INVALID');
  }

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function publishedAsset(value) {
    return canonicalText(value, 500)
      && !/^[a-z][a-z0-9+.-]*:/iu.test(value)
      && !/(?:https?:\/\/|blob:|data:)/iu.test(value)
      && !/^br_/iu.test(value);
  }

  function bindingFromBasis(value, workflowId) {
    if (!exactKeys(value, BASIS_KEYS) || !exactKeys(value.binding, BINDING_KEYS)
      || !canonicalText(value.binding.shopId, 200)
      || value.binding.workflowId !== workflowId
      || !positiveInteger(value.binding.draftRevision)
      || !positiveInteger(value.binding.draftVersion)
      || !canonicalText(value.stage, 100)
      || !isRecord(value.validation) || !canonicalText(value.validation.status, 100)) {
      invalidBasis();
    }
    return {
      shopId: value.binding.shopId,
      workflowId: workflowId,
      draftRevision: value.binding.draftRevision,
      draftVersion: value.binding.draftVersion,
    };
  }

  function requestFromBasis(value, workflowId) {
    var binding = bindingFromBasis(value, workflowId);
    if (!Array.isArray(value.selectedSkuKeys)
      || value.selectedSkuKeys.length < 1 || value.selectedSkuKeys.length > 500
      || !Array.isArray(value.mediaAssignments)
      || value.mediaAssignments.length < 1 || value.mediaAssignments.length > 500) {
      invalidBasis();
    }
    var selectedSkuKeys = new Set();
    value.selectedSkuKeys.forEach(function (skuKey) {
      if (!canonicalText(skuKey, 500) || selectedSkuKeys.has(skuKey)) invalidBasis();
      selectedSkuKeys.add(skuKey);
    });
    var slots = new Set();
    var assets = new Set();
    var selectedMedia = value.mediaAssignments.map(function (row) {
      if (!exactKeys(row, MEDIA_KEYS) || !['PRODUCT', 'SKU'].includes(row.scope)
        || !canonicalText(row.slotKey, 200) || !publishedAsset(row.assetId)
        || slots.has(row.slotKey) || assets.has(row.assetId)
        || (row.scope === 'PRODUCT' && row.skuKey !== null)
        || (row.scope === 'SKU'
          && (!canonicalText(row.skuKey, 500) || !selectedSkuKeys.has(row.skuKey)))) {
        invalidBasis();
      }
      slots.add(row.slotKey);
      assets.add(row.assetId);
      return { scope: row.scope, skuKey: row.skuKey, slotKey: row.slotKey, assetId: row.assetId };
    });
    return {
      executionMode: 'ERP_HOSTED',
      binding: binding,
      selectedMedia: selectedMedia,
    };
  }

  function terminal(state) {
    return state === 'SUCCEEDED' || state === 'FAILED';
  }

  function unknownOutcome(error) {
    return Boolean(error && (error.outcome === 'UNKNOWN_OUTCOME'
      || error.code === 'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME'));
  }

  function create(options) {
    var loadBasis = options && options.loadBasis;
    var coordinator = options && options.coordinator;
    if (typeof loadBasis !== 'function' || !coordinator
      || typeof coordinator.preview !== 'function'
      || typeof coordinator.confirm !== 'function'
      || typeof coordinator.getState !== 'function') {
      throw new TypeError('Source workbench publish controller dependencies are unavailable');
    }
    var operations = new Map();

    function remember(workflowId, request) {
      if (!operations.has(workflowId) && operations.size >= MAX_OPERATIONS) {
        var retired = null;
        operations.forEach(function (record, key) {
          if (retired === null && terminal(record.state)) retired = key;
        });
        if (retired === null) {
          throw controllerError('SS_ERP_SOURCE_WORKBENCH_PUBLISH_OPERATION_LIMIT');
        }
        operations.delete(retired);
      }
      var record = { request: request, needsStatus: false, state: 'CONFIRMING' };
      operations.set(workflowId, record);
      return record;
    }

    async function execute(input) {
      var parsed = command(input);
      var basis = await loadBasis(parsed.listingWorkflowId);
      var binding = bindingFromBasis(basis, parsed.listingWorkflowId);
      var existing = operations.get(parsed.listingWorkflowId);
      if (existing && existing.request.binding.shopId !== binding.shopId) {
        throw controllerError('SS_ERP_SOURCE_WORKBENCH_PUBLISH_CONTEXT_STALE');
      }
      var request = parsed.action === 'STATUS' && existing
        ? existing.request : requestFromBasis(basis, parsed.listingWorkflowId);
      if (parsed.action === 'STATUS') {
        var status = await coordinator.getState(request);
        if (existing && status) {
          existing.state = status.state;
          if (terminal(status.state)) existing.needsStatus = false;
        }
        return status;
      }
      if (parsed.action === 'PREVIEW') return coordinator.preview(request);
      if (existing && existing.needsStatus) {
        throw controllerError('SS_ERP_SOURCE_WORKBENCH_PUBLISH_RECONCILIATION_REQUIRED');
      }
      if (existing && !terminal(existing.state)
        && JSON.stringify(existing.request) !== JSON.stringify(request)) {
        throw controllerError('SS_ERP_SOURCE_WORKBENCH_PUBLISH_RECONCILIATION_REQUIRED');
      }
      var record = existing && !terminal(existing.state)
        ? existing : remember(parsed.listingWorkflowId, request);
      try {
        var confirmed = await coordinator.confirm(Object.assign({}, request, { previewHash: parsed.previewHash }));
        record.state = confirmed && confirmed.state;
        return confirmed;
      } catch (error) {
        if (unknownOutcome(error)) {
          record.needsStatus = true;
          record.state = 'OUTCOME_UNRESOLVED';
        } else if (record.state === 'CONFIRMING') {
          operations.delete(parsed.listingWorkflowId);
        }
        throw error;
      }
    }

    return Object.freeze({ execute: execute });
  }

  global.SS_ERP_SOURCE_WORKBENCH_PUBLISH_CONTROLLER = Object.freeze({ create: create });
})(typeof globalThis !== 'undefined' ? globalThis : self);
