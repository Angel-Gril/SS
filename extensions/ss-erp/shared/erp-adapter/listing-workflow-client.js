(function (global) {
  'use strict';

  function identifier(value, label, maximum) {
    var normalized = String(value == null ? '' : value).normalize('NFKC').trim();
    var limit = Number.isSafeInteger(maximum) && maximum > 0 ? maximum : 200;
    if (!normalized || normalized.length > limit) throw new TypeError(label + ' is invalid');
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

  function validLaunchCapability(value) {
    return validCapability(value)
      && typeof value.ready === 'boolean'
      && text(value.reasonCode, 100)
      && value.testOnly === true
      && value.operation === 'IMAGE_TRANSLATE'
      && value.sourceLanguage === 'zh'
      && value.targetLanguage === 'ru';
  }

  function positiveRevision(value, label) {
    var normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
      throw new TypeError(label + ' is invalid');
    }
    return normalized;
  }

  function validSourceInput(value) {
    var item = record(value);
    return item
      && Object.keys(item).every(function (key) { return key === 'sourceMediaKey'; })
      && text(item.sourceMediaKey, 500);
  }

  function validLaunchContext(value, input) {
    var context = record(value);
    if (!context) return false;
    if (Object.keys(context).some(function (key) {
      return !['id', 'shopId', 'supplyGoodsId', 'snapshotId', 'revision', 'draftVersion', 'sourceInputs', 'requested'].includes(key);
    })) return false;
    if (!text(context.id, 200)
      || context.id !== input.listingWorkflowId
      || !text(context.shopId, 200)
      || context.shopId !== input.shopId
      || !text(context.supplyGoodsId, 200)
      || context.supplyGoodsId !== input.supplyGoodsId
      || !text(context.snapshotId, 200)
      || context.snapshotId !== input.snapshotId
      || context.revision !== input.revision
      || context.draftVersion !== input.draftVersion
      || !Array.isArray(context.sourceInputs)
      || context.sourceInputs.length > 50
      || !context.sourceInputs.every(validSourceInput)) return false;
    var sourceKeys = context.sourceInputs.map(function (item) { return item.sourceMediaKey; });
    if (new Set(sourceKeys).size !== sourceKeys.length) return false;
    var requested = record(context.requested);
    return requested
      && Object.keys(requested).every(function (key) {
        return ['snapshotId', 'listingWorkflowId', 'revision', 'draftVersion'].includes(key);
      })
      && requested.snapshotId === input.snapshotId
      && requested.listingWorkflowId === input.listingWorkflowId
      && requested.revision === input.revision
      && requested.draftVersion === input.draftVersion;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  async function freshAttemptKey(identity, prefix) {
    var nonce = new Uint8Array(16);
    globalThis.crypto.getRandomValues(nonce);
    var digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify({ identity: identity, nonce: bytesToHex(nonce) })),
    );
    return prefix + bytesToHex(new Uint8Array(digest));
  }

  async function stableOperationKey(identity, prefix) {
    var digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(identity)),
    );
    return prefix + bytesToHex(new Uint8Array(digest));
  }

  async function executeGrantedMediaMutation(transport, operation, requiredScope, envelope) {
    var issued = await transport.post('/api/extension-device/command-grants', {
      operation: operation,
      ...envelope,
    }, { requiredScope: requiredScope });
    var issuedBody = issued && issued.state === 'response' ? record(issued.body) : null;
    var issuedData = issuedBody && issuedBody.code === 1 ? record(issuedBody.data) : null;
    if (!issuedData || !text(issuedData.grantToken, 1000)) {
      throw new Error('media mutation command grant was not issued');
    }
    var executed = await transport.post(
      '/api/extension-device/media-workflows/execute',
      { operation: operation, ...envelope },
      { commandGrant: issuedData.grantToken, requiredScope: requiredScope },
    );
    var executedBody = executed && executed.state === 'response' ? record(executed.body) : null;
    var executedData = executedBody && executedBody.code === 1 ? record(executedBody.data) : null;
    var receipt = executedData ? record(executedData.receipt) : null;
    var result = receipt ? record(receipt.result) : null;
    if (!receipt || receipt.status !== 'SUCCEEDED' || !result) {
      throw new Error('media mutation command did not complete');
    }
    return { executedData: executedData, receipt: receipt, result: result };
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

  function validPreviewUrl(value) {
    if (!text(value, 4096)) return false;
    try {
      var parsed = new URL(value);
      if (parsed.username || parsed.password) return false;
      var hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
      var local = hostname === 'localhost' || hostname.endsWith('.localhost')
        || hostname.endsWith('.local') || hostname === '::1';
      var octets = hostname.split('.').map(Number);
      var ipv4 = octets.length === 4 && octets.every(function (item) {
        return Number.isInteger(item) && item >= 0 && item <= 255;
      });
      var privateIpv4 = ipv4 && (octets[0] === 0 || octets[0] === 10
        || octets[0] === 127 || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
        || (octets[0] === 169 && octets[1] === 254)
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
        || (octets[0] === 192 && octets[1] === 168) || octets[0] >= 224);
      var ipv6Literal = hostname.includes(':');
      if (parsed.protocol === 'https:') return !local && !privateIpv4 && !ipv6Literal;
      return parsed.protocol === 'http:'
        && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
    } catch (_error) {
      return false;
    }
  }

  function validHistoryOutput(value) {
    var output = record(value);
    return output
      && Object.keys(output).every(function (key) {
        return ['id', 'url', 'mimeType', 'width', 'height'].includes(key);
      })
      && text(output.id, 200)
      && validPreviewUrl(output.url)
      && text(output.mimeType, 100)
      && ['image/jpeg', 'image/png', 'image/webp'].includes(output.mimeType.toLowerCase())
      && (output.width === null || (Number.isSafeInteger(output.width) && output.width > 0))
      && (output.height === null || (Number.isSafeInteger(output.height) && output.height > 0));
  }

  function validHistoryApplication(value) {
    if (value === null) return true;
    var application = record(value);
    return application
      && Object.keys(application).every(function (key) {
        return [
          'id', 'mode', 'state', 'targetId', 'contextSkuKey', 'contextSlotKey',
          'appliedAt', 'rolledBackAt',
        ].includes(key);
      })
      && text(application.id, 200)
      && (application.mode === 'append' || application.mode === 'replace')
      && (application.state === 'APPLIED' || application.state === 'ROLLED_BACK')
      && text(application.targetId, 200)
      && text(application.contextSkuKey, 500, true)
      && text(application.contextSlotKey, 1024, true)
      && dateTime(application.appliedAt)
      && (application.rolledBackAt === null || dateTime(application.rolledBackAt));
  }

  function validHistoryItem(value) {
    var item = record(value);
    return item
      && Object.keys(item).every(function (key) {
        return [
          'id', 'operation', 'status', 'reviewStatus', 'revision', 'contextSkuKey',
          'contextSlotKey', 'selectedOutputAssetId', 'outputs', 'application',
          'createdAt', 'updatedAt',
        ].includes(key);
      })
      && text(item.id, 200)
      && text(item.operation, 100)
      && text(item.status, 100)
      && text(item.reviewStatus, 100)
      && Number.isSafeInteger(item.revision) && item.revision > 0
      && text(item.contextSkuKey, 500, true)
      && text(item.contextSlotKey, 1024, true)
      && text(item.selectedOutputAssetId, 200, true)
      && Array.isArray(item.outputs)
      && item.outputs.length <= 4
      && item.outputs.every(validHistoryOutput)
      && validHistoryApplication(item.application)
      && dateTime(item.createdAt)
      && dateTime(item.updatedAt);
  }

  function validMediaHistory(value, input) {
    var history = record(value);
    var context = history && record(history.context);
    var snapshot = history && record(history.snapshot);
    return history
      && Object.keys(history).every(function (key) {
        return ['contractVersion', 'context', 'snapshot', 'items', 'nextCursor'].includes(key);
      })
      && history.contractVersion === 'extension-source-media-history/v1'
      && context
      && Object.keys(context).every(function (key) {
        return [
          'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
          'revision', 'draftVersion',
        ].includes(key);
      })
      && context.snapshotId === input.snapshotId
      && context.supplyGoodsId === input.supplyGoodsId
      && context.shopId === input.shopId
      && context.listingWorkflowId === input.listingWorkflowId
      && context.revision === input.revision
      && context.draftVersion === input.draftVersion
      && snapshot
      && Object.keys(snapshot).every(function (key) {
        return ['id', 'version', 'capturedAt'].includes(key);
      })
      && snapshot.id === input.snapshotId
      && Number.isSafeInteger(snapshot.version) && snapshot.version > 0
      && dateTime(snapshot.capturedAt)
      && Array.isArray(history.items)
      && history.items.length <= input.limit
      && history.items.every(validHistoryItem)
      && (history.nextCursor === null || text(history.nextCursor, 1000));
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
      async getMediaHistory(input) {
        var normalized = {
          snapshotId: identifier(input && input.snapshotId, 'snapshotId'),
          supplyGoodsId: identifier(input && input.supplyGoodsId, 'supplyGoodsId'),
          shopId: identifier(input && input.shopId, 'shopId'),
          listingWorkflowId: identifier(input && input.listingWorkflowId, 'listingWorkflowId'),
          revision: positiveRevision(input && input.revision, 'revision'),
          draftVersion: positiveRevision(input && input.draftVersion, 'draftVersion'),
          limit: Number(input && input.limit),
        };
        normalized.limit = Number.isSafeInteger(normalized.limit)
          ? Math.max(1, Math.min(20, normalized.limit))
          : 10;
        var query = new URLSearchParams({
          snapshotId: normalized.snapshotId,
          supplyGoodsId: normalized.supplyGoodsId,
          shopId: normalized.shopId,
          listingWorkflowId: normalized.listingWorkflowId,
          revision: String(normalized.revision),
          draftVersion: String(normalized.draftVersion),
          limit: String(normalized.limit),
        });
        if (input && input.beforeCursor != null) {
          query.set('beforeCursor', identifier(input.beforeCursor, 'beforeCursor', 1000));
        }
        var response = await transport.get(
          '/api/extension-device/source-workbench/media-history?' + query.toString(),
          { requiredScope: 'listing:review' },
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!data || !validCapability(data.capability)) {
          throw new Error('invalid source media history capability response');
        }
        if (!data.capability.enabled) {
          if (data.history !== null) throw new Error('disabled source media history returned tenant data');
          return { state: 'disabled', capability: data.capability, history: null };
        }
        if (!validMediaHistory(data.history, normalized)) {
          throw new Error('invalid source media history response');
        }
        return { state: 'ready', capability: data.capability, history: data.history };
      },
      async getMediaLaunch(input) {
        var snapshotId = identifier(input && input.snapshotId, 'snapshotId');
        var supplyGoodsId = identifier(input && input.supplyGoodsId, 'supplyGoodsId');
        var shopId = identifier(input && input.shopId, 'shopId');
        var listingWorkflowId = identifier(input && input.listingWorkflowId, 'listingWorkflowId');
        var revision = positiveRevision(input && input.revision, 'revision');
        var draftVersion = positiveRevision(input && input.draftVersion, 'draftVersion');
        var query = new URLSearchParams({
          snapshotId: snapshotId,
          supplyGoodsId: supplyGoodsId,
          shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          revision: String(revision),
          draftVersion: String(draftVersion),
        });
        var response = await transport.get(
          '/api/extension-device/source-workbench/media-launch?' + query.toString(),
          { requiredScope: 'media:execute' },
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!data || !validLaunchCapability(data.capability)) {
          throw new Error('invalid source media launch capability response');
        }
        if (!data.capability.enabled || !data.capability.ready) {
          if (data.context !== null) throw new Error('disabled source media launch returned context data');
          return { state: data.capability.enabled ? 'not_ready' : 'disabled', capability: data.capability, context: null };
        }
        if (!validLaunchContext(data.context, {
          snapshotId: snapshotId,
          supplyGoodsId: supplyGoodsId,
          shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          revision: revision,
          draftVersion: draftVersion,
        })) {
          throw new Error('invalid source media launch context response');
        }
        return { state: 'ready', capability: data.capability, context: data.context };
      },
      async createTranslationCommand(input) {
        var shopId = identifier(input && input.shopId, 'shopId');
        var listingWorkflowId = identifier(input && input.listingWorkflowId, 'listingWorkflowId');
        var supplyGoodsId = identifier(input && input.supplyGoodsId, 'supplyGoodsId');
        var snapshotId = identifier(input && input.snapshotId, 'snapshotId');
        var sourceMediaKey = identifier(input && input.sourceMediaKey, 'sourceMediaKey', 500);
        var draftRevision = positiveRevision(input && input.draftRevision, 'draftRevision');
        var draftVersion = positiveRevision(input && input.draftVersion, 'draftVersion');
        var workflowOperationKey = identifier(input && input.workflowOperationKey, 'workflowOperationKey');
        if (workflowOperationKey.length > 128) throw new TypeError('workflowOperationKey is invalid');
        var command = {
          schemaVersion: 'ai-media-workflow-create/v1',
          action: 'CREATE_TRANSLATION',
          sourceMediaKey: sourceMediaKey,
          draftRevision: draftRevision,
          workflowOperationKey: workflowOperationKey,
        };
        var idempotencyKey = await freshAttemptKey({
          schemaVersion: command.schemaVersion,
          action: command.action,
          sourceMediaKey: sourceMediaKey,
          shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          draftRevision: draftRevision,
          draftVersion: draftVersion,
          supplyGoodsId: supplyGoodsId,
          snapshotId: snapshotId,
          workflowOperationKey: workflowOperationKey,
        }, 'extension-media-create:');
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
          throw new Error('media translation command grant was not issued');
        }
        var executed = await transport.post(
          '/api/extension-device/media-workflows/execute',
          envelope,
          { commandGrant: issuedData.grantToken },
        );
        var executedBody = executed && executed.state === 'response' ? record(executed.body) : null;
        var executedData = executedBody && executedBody.code === 1 ? record(executedBody.data) : null;
        var receipt = executedData ? record(executedData.receipt) : null;
        var result = receipt ? record(receipt.result) : null;
        if (!receipt || receipt.status !== 'SUCCEEDED'
          || !result
          || !text(result.workflowId, 200)
          || result.action !== 'CREATE_TRANSLATION'
          || result.operation !== 'IMAGE_TRANSLATE'
          || !text(result.status, 100)
          || !Number.isSafeInteger(result.revision)
          || result.revision <= 0) {
          throw new Error('media translation command did not complete');
        }
        return {
          state: 'completed',
          replay: executedData.replay === true,
          receipt: receipt,
          result: result,
          workflowOperationKey: workflowOperationKey,
        };
      },
      async reviewMediaOutput(input) {
        var mediaWorkflowId = identifier(input && input.mediaWorkflowId, 'mediaWorkflowId');
        var shopId = identifier(input && input.shopId, 'shopId');
        var listingWorkflowId = identifier(input && input.listingWorkflowId, 'listingWorkflowId');
        var outputAssetId = identifier(input && input.outputAssetId, 'outputAssetId');
        var expectedRevision = positiveRevision(input && input.expectedRevision, 'expectedRevision');
        var draftRevision = positiveRevision(input && input.draftRevision, 'draftRevision');
        var draftVersion = positiveRevision(input && input.draftVersion, 'draftVersion');
        var decision = input && input.decision;
        if (decision !== 'APPROVE' && decision !== 'REJECT') {
          throw new TypeError('media review decision is invalid');
        }
        var note = input && input.note == null ? null : identifier(input.note, 'note', 1000);
        var command = {
          schemaVersion: 'ai-media-workflow-review/v1',
          action: 'REVIEW',
          mediaWorkflowId: mediaWorkflowId,
          expectedRevision: expectedRevision,
          draftRevision: draftRevision,
          outputAssetId: outputAssetId,
          decision: decision,
          note: note,
        };
        var idempotencyKey = await stableOperationKey({
          operation: 'MEDIA_REVIEW', shopId: shopId,
          listingWorkflowId: listingWorkflowId, draftVersion: draftVersion,
          command: command,
        }, 'extension-media-review:');
        var envelope = {
          shopId: shopId,
          workflowId: listingWorkflowId,
          draftVersion: draftVersion,
          idempotencyKey: idempotencyKey,
          command: command,
        };
        var completed = await executeGrantedMediaMutation(
          transport,
          'MEDIA_REVIEW',
          'listing:review',
          envelope,
        );
        var result = completed.result;
        var allowed = [
          'workflowId', 'action', 'status', 'reviewStatus', 'selectedOutputAssetId',
          'revision', 'replayed',
        ];
        var expectedReviewStatus = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        if (Object.keys(result).some(function (key) { return !allowed.includes(key); })
          || result.workflowId !== mediaWorkflowId
          || result.action !== 'REVIEW'
          || result.status !== 'SUCCEEDED'
          || result.reviewStatus !== expectedReviewStatus
          || result.selectedOutputAssetId !== outputAssetId
          || !Number.isSafeInteger(result.revision) || result.revision <= expectedRevision
          || typeof result.replayed !== 'boolean') {
          throw new Error('media review result is invalid');
        }
        return {
          state: 'completed',
          replay: completed.executedData.replay === true,
          receipt: completed.receipt,
          result: result,
          idempotencyKey: idempotencyKey,
        };
      },
      async applyMediaOutput(input) {
        var mediaWorkflowId = identifier(input && input.mediaWorkflowId, 'mediaWorkflowId');
        var shopId = identifier(input && input.shopId, 'shopId');
        var listingWorkflowId = identifier(input && input.listingWorkflowId, 'listingWorkflowId');
        var outputAssetId = identifier(input && input.outputAssetId, 'outputAssetId');
        var expectedWorkflowRevision = positiveRevision(
          input && input.expectedWorkflowRevision,
          'expectedWorkflowRevision',
        );
        var expectedTargetRevision = positiveRevision(
          input && input.expectedTargetRevision,
          'expectedTargetRevision',
        );
        var expectedTargetDraftVersion = positiveRevision(
          input && input.expectedTargetDraftVersion,
          'expectedTargetDraftVersion',
        );
        var command = {
          schemaVersion: 'ai-media-workflow-apply/v1',
          action: 'APPLY',
          mediaWorkflowId: mediaWorkflowId,
          expectedWorkflowRevision: expectedWorkflowRevision,
          expectedTargetRevision: expectedTargetRevision,
          expectedTargetDraftVersion: expectedTargetDraftVersion,
          outputAssetId: outputAssetId,
          mode: 'append',
        };
        var idempotencyKey = await stableOperationKey({
          operation: 'MEDIA_APPLY', shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          command: command,
        }, 'extension-media-apply:');
        var envelope = {
          shopId: shopId,
          workflowId: listingWorkflowId,
          draftVersion: expectedTargetDraftVersion,
          idempotencyKey: idempotencyKey,
          command: command,
        };
        var completed = await executeGrantedMediaMutation(
          transport,
          'MEDIA_APPLY',
          'listing:write',
          envelope,
        );
        var result = completed.result;
        var allowed = [
          'workflowId', 'action', 'status', 'reviewStatus', 'selectedOutputAssetId',
          'revision', 'applicationId', 'targetRevision', 'targetDraftVersion', 'replayed',
        ];
        if (Object.keys(result).some(function (key) { return !allowed.includes(key); })
          || result.workflowId !== mediaWorkflowId
          || result.action !== 'APPLY'
          || result.status !== 'SUCCEEDED'
          || result.reviewStatus !== 'APPROVED'
          || result.selectedOutputAssetId !== outputAssetId
          || !Number.isSafeInteger(result.revision) || result.revision <= expectedWorkflowRevision
          || !text(result.applicationId, 200)
          || !Number.isSafeInteger(result.targetRevision)
          || result.targetRevision <= expectedTargetRevision
          || !Number.isSafeInteger(result.targetDraftVersion)
          || result.targetDraftVersion <= expectedTargetDraftVersion
          || typeof result.replayed !== 'boolean') {
          throw new Error('media application result is invalid');
        }
        return {
          state: 'completed',
          replay: completed.executedData.replay === true,
          receipt: completed.receipt,
          result: result,
          idempotencyKey: idempotencyKey,
        };
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
