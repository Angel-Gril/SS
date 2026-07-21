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
    var baseValid = item
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
    if (!baseValid) return false;
    if (item.commandContext === undefined && item.allowedActions === undefined) return true;
    var actions = item.allowedActions;
    var context = record(item.commandContext);
    if (!Array.isArray(actions)
      || actions.length > 2
      || new Set(actions).size !== actions.length
      || actions.some(function (action) { return action !== 'CANCEL' && action !== 'RETRY'; })) {
      return false;
    }
    if (!actions.length) return item.commandContext === null;
    return context
      && text(context.shopId, 200)
      && text(context.listingWorkflowId, 200)
      && Number.isSafeInteger(context.draftRevision) && context.draftRevision > 0
      && Number.isSafeInteger(context.draftVersion) && context.draftVersion > 0;
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
      async executeMediaCommand(input) {
        var action = input && input.action;
        if (action !== 'CANCEL' && action !== 'RETRY') {
          throw new TypeError('media command action is invalid');
        }
        var mediaWorkflowId = identifier(input.mediaWorkflowId, 'mediaWorkflowId');
        var shopId = identifier(input.shopId, 'shopId');
        var listingWorkflowId = identifier(input.listingWorkflowId, 'listingWorkflowId');
        var expectedRevision = Number(input.expectedRevision);
        var draftRevision = Number(input.draftRevision);
        var draftVersion = Number(input.draftVersion);
        if (![expectedRevision, draftRevision, draftVersion].every(function (value) {
          return Number.isSafeInteger(value) && value > 0;
        })) {
          throw new TypeError('media command revision is invalid');
        }
        var command = {
          schemaVersion: 'ai-media-workflow-command/v1',
          action: action,
          mediaWorkflowId: mediaWorkflowId,
          expectedRevision: expectedRevision,
          draftRevision: draftRevision,
        };
        var attemptBytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(attemptBytes);
        var attemptNonce = Array.from(attemptBytes)
          .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
          .join('');
        var identity = JSON.stringify({
          schemaVersion: command.schemaVersion,
          action: action,
          mediaWorkflowId: mediaWorkflowId,
          expectedRevision: expectedRevision,
          shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          draftRevision: draftRevision,
          draftVersion: draftVersion,
          attemptNonce: attemptNonce,
        });
        var digest = await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(identity),
        );
        var idempotencyKey = 'extension-media:' + Array.from(new Uint8Array(digest))
          .map(function (byte) { return byte.toString(16).padStart(2, '0'); })
          .join('');
        var envelope = {
          shopId: shopId,
          workflowId: listingWorkflowId,
          draftVersion: draftVersion,
          idempotencyKey: idempotencyKey,
          command: command,
        };
        var issued = await transport.post('/api/extension-device/command-grants', {
          operation: 'MEDIA_EXECUTE',
          ...envelope,
        });
        var issuedBody = issued && issued.state === 'response' ? record(issued.body) : null;
        var issuedData = issuedBody && issuedBody.code === 1 ? record(issuedBody.data) : null;
        if (!issuedData || !text(issuedData.grantToken, 1000)) {
          throw new Error('media command grant was not issued');
        }
        var executed = await transport.post(
          '/api/extension-device/media-workflows/execute',
          envelope,
          { commandGrant: issuedData.grantToken },
        );
        var executedBody = executed && executed.state === 'response' ? record(executed.body) : null;
        var executedData = executedBody && executedBody.code === 1 ? record(executedBody.data) : null;
        var receipt = executedData ? record(executedData.receipt) : null;
        if (!receipt || receipt.status !== 'SUCCEEDED') {
          throw new Error('media command did not complete');
        }
        return {
          state: 'completed',
          replay: executedData.replay === true,
          receipt: receipt,
        };
      },
    };
  }

  global.SS_ERP_LISTING_WORKFLOW_CLIENT = {
    createClient: createClient,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
