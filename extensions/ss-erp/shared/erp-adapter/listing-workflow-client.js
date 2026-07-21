(function (global) {
  'use strict';

  function identifier(value, label) {
    var normalized = String(value == null ? '' : value).normalize('NFKC').trim();
    if (!normalized || normalized.length > 200) throw new TypeError(label + ' is invalid');
    return normalized;
  }

  function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function text(value, maximum, nullable) {
    if (value == null && nullable) return true;
    return typeof value === 'string' && value.length > 0 && value.length <= maximum;
  }

  function count(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function dateTime(value) {
    return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
  }

  function issue(value) {
    var item = record(value);
    return item
      && text(item.code, 100)
      && text(item.message, 1000)
      && text(item.fieldPath, 1000, true);
  }

  function validListingItem(value) {
    var item = record(value);
    return item
      && text(item.id, 200)
      && text(item.shopId, 200)
      && text(item.stage, 100)
      && text(item.status, 100)
      && text(item.runState, 100)
      && count(item.revision) && item.revision > 0
      && count(item.draftVersion) && item.draftVersion > 0
      && count(item.selectedSkuCount)
      && count(item.mediaAssignmentCount)
      && text(item.validationStatus, 100)
      && count(item.blockerCount)
      && count(item.warningCount)
      && Array.isArray(item.blockers) && item.blockers.length <= 20 && item.blockers.every(issue)
      && Array.isArray(item.warnings) && item.warnings.length <= 20 && item.warnings.every(issue)
      && dateTime(item.updatedAt);
  }

  function validMediaItem(value) {
    var item = record(value);
    return item
      && text(item.id, 200)
      && text(item.operation, 100)
      && text(item.status, 100)
      && text(item.reviewStatus, 100)
      && count(item.revision) && item.revision > 0
      && text(item.contextType, 100, true)
      && text(item.contextId, 200, true)
      && text(item.contextSkuKey, 500, true)
      && text(item.contextSlotKey, 1024, true)
      && typeof item.hasSelectedOutput === 'boolean'
      && typeof item.actionable === 'boolean'
      && dateTime(item.updatedAt);
  }

  function validCapability(value) {
    return record(value)
      && typeof value.enabled === 'boolean'
      && typeof value.reason === 'string'
      && value.reason.length > 0
      && value.reason.length <= 100
      && typeof value.revision === 'string'
      && value.revision.length > 0
      && value.revision.length <= 200;
  }

  function validStatus(value, snapshotId) {
    return record(value)
      && value.contractVersion === 'extension-source-workbench-status/v1'
      && record(value.snapshot)
      && value.snapshot.id === snapshotId
      && Number.isSafeInteger(value.snapshot.version)
      && value.snapshot.version > 0
      && dateTime(value.snapshot.capturedAt)
      && typeof value.snapshot.current === 'boolean'
      && record(value.listing)
      && Array.isArray(value.listing.items)
      && value.listing.items.length <= 10
      && value.listing.items.every(validListingItem)
      && typeof value.listing.truncated === 'boolean'
      && record(value.media)
      && Array.isArray(value.media.items)
      && value.media.items.length <= 50
      && value.media.items.every(validMediaItem)
      && typeof value.media.truncated === 'boolean'
      && Number.isSafeInteger(value.media.actionableCount)
      && value.media.actionableCount >= 0
      && value.media.actionableCount === value.media.items.filter(function (item) {
        return item.actionable === true;
      }).length;
  }

  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.get !== 'function') {
      throw new TypeError('source workflow transport is required');
    }
    return {
      async getStatus(input) {
        var snapshotId = identifier(input && input.snapshotId, 'snapshotId');
        var supplyGoodsId = identifier(input && input.supplyGoodsId, 'supplyGoodsId');
        var query = new URLSearchParams({
          snapshotId: snapshotId,
          supplyGoodsId: supplyGoodsId,
        });
        var response = await transport.get(
          '/api/extension-device/source-workbench/status?' + query.toString(),
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!data || !validCapability(data.capability)) {
          throw new Error('invalid source workbench capability response');
        }
        if (!data.capability.enabled) {
          if (data.status !== null) throw new Error('disabled source workbench returned status data');
          return { state: 'disabled', capability: data.capability, status: null };
        }
        if (!validStatus(data.status, snapshotId)) {
          throw new Error('invalid source workbench status response');
        }
        return { state: 'ready', capability: data.capability, status: data.status };
      },
    };
  }

  global.SS_ERP_LISTING_WORKFLOW_CLIENT = {
    createClient: createClient,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
