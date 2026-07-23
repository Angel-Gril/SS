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

  var STANDALONE_MEDIA_OPERATIONS = [
    'IMAGE_TRANSLATE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
  ];

  function validStandaloneLaunchCapability(value, operation) {
    if (!validCapability(value)
      || typeof value.ready !== 'boolean'
      || !text(value.reasonCode, 100)
      || typeof value.testOnly !== 'boolean'
      || value.operation !== operation) return false;
    var commonKeys = [
      'enabled', 'ready', 'reasonCode', 'reason', 'revision', 'testOnly', 'operation',
      'estimatedCostCents', 'maximumCostCents',
    ];
    var operationKeys = operation === 'IMAGE_TRANSLATE'
      ? ['sourceLanguage', 'targetLanguage']
      : operation === 'IMAGE_TO_IMAGE'
        ? ['maxReferences']
        : operation === 'INPAINT'
          ? ['maskSemantics', 'maxMaskBytes']
          : [];
    if (Object.keys(value).some(function (key) {
      return !commonKeys.includes(key) && !operationKeys.includes(key);
    })) return false;
    if (value.estimatedCostCents !== undefined
      && (!Number.isSafeInteger(value.estimatedCostCents) || value.estimatedCostCents < 0)) return false;
    if (value.maximumCostCents !== undefined
      && (!Number.isSafeInteger(value.maximumCostCents)
        || value.maximumCostCents < Number(value.estimatedCostCents || 0))) return false;
    if (operation === 'IMAGE_TRANSLATE') {
      return value.sourceLanguage === 'zh' && value.targetLanguage === 'ru';
    }
    if (operation === 'IMAGE_TO_IMAGE') {
      return Number.isSafeInteger(value.maxReferences)
        && value.maxReferences >= 1 && value.maxReferences <= 4;
    }
    if (operation === 'INPAINT') {
      return value.maskSemantics === 'WHITE_EDIT_BLACK_PRESERVE_V1'
        && Number.isSafeInteger(value.maxMaskBytes)
        && value.maxMaskBytes > 0 && value.maxMaskBytes <= 20 * 1024 * 1024;
    }
    return true;
  }

  function validStandaloneLaunchOperations(value) {
    var operations = record(value);
    if (!operations || Object.keys(operations).some(function (key) {
      return !STANDALONE_MEDIA_OPERATIONS.includes(key);
    })) return false;
    return STANDALONE_MEDIA_OPERATIONS.every(function (operation) {
      return validStandaloneLaunchCapability(operations[operation], operation);
    });
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
        return ['snapshotId', 'listingWorkflowId', 'revision', 'draftVersion', 'contractVersion'].includes(key);
      })
      && requested.snapshotId === input.snapshotId
      && requested.listingWorkflowId === input.listingWorkflowId
      && requested.revision === input.revision
      && requested.draftVersion === input.draftVersion
      && (requested.contractVersion === undefined || requested.contractVersion === 2);
  }

  function normalizedSourceMediaKeys(value, operation) {
    if (!Array.isArray(value)) throw new TypeError('source media keys are invalid');
    var maximum = operation === 'IMAGE_TO_IMAGE' ? 4 : 1;
    if (value.length < 1 || value.length > maximum) {
      throw new TypeError('source media keys are invalid');
    }
    var keys = value.map(function (item) {
      return identifier(item, 'sourceMediaKey', 500);
    });
    if (new Set(keys).size !== keys.length) throw new TypeError('source media keys are invalid');
    return keys;
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

  async function executeGrantedMediaMutation(
    transport,
    operation,
    requiredScope,
    envelope,
    failureSubject,
  ) {
    var subject = text(failureSubject, 100) ? failureSubject : 'media mutation';
    var issued = await transport.post('/api/extension-device/command-grants', {
      operation: operation,
      ...envelope,
    }, { requiredScope: requiredScope });
    var issuedBody = issued && issued.state === 'response' ? record(issued.body) : null;
    var issuedData = issuedBody && issuedBody.code === 1 ? record(issuedBody.data) : null;
    if (!issuedData || !text(issuedData.grantToken, 1000)) {
      throw new Error(subject + ' command grant was not issued');
    }
    var executeEnvelope = operation === 'MEDIA_EXECUTE'
      ? envelope
      : { operation: operation, ...envelope };
    var executed = await transport.post(
      '/api/extension-device/media-workflows/execute',
      executeEnvelope,
      { commandGrant: issuedData.grantToken, requiredScope: requiredScope },
    );
    var executedBody = executed && executed.state === 'response' ? record(executed.body) : null;
    var executedData = executedBody && executedBody.code === 1 ? record(executedBody.data) : null;
    var receipt = executedData ? record(executedData.receipt) : null;
    var result = receipt ? record(receipt.result) : null;
    if (!receipt || receipt.status !== 'SUCCEEDED' || !result) {
      throw new Error(subject + ' command did not complete');
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

  var MEDIA_EDIT_MASK_SEMANTICS = 'WHITE_EDIT_BLACK_PRESERVE_V1';
  var MAX_MEDIA_EDIT_MASK_BYTES = 20 * 1024 * 1024;
  var MAX_MEDIA_EDIT_DIMENSION = 16384;
  var MAX_MEDIA_EDIT_PIXELS = 12 * 1000 * 1000;
  var MAX_MEDIA_EDIT_ASPECT_RATIO = 20;

  function normalizedMediaEditContext(input) {
    return {
      snapshotId: identifier(input && input.snapshotId, 'snapshotId'),
      supplyGoodsId: identifier(input && input.supplyGoodsId, 'supplyGoodsId'),
      shopId: identifier(input && input.shopId, 'shopId'),
      listingWorkflowId: identifier(input && input.listingWorkflowId, 'listingWorkflowId'),
      revision: positiveRevision(input && input.revision, 'revision'),
      draftVersion: positiveRevision(input && input.draftVersion, 'draftVersion'),
      sourceMediaKey: identifier(input && input.sourceMediaKey, 'sourceMediaKey', 500),
    };
  }

  function validMediaEditDimensions(width, height) {
    return Number.isSafeInteger(width) && width > 0 && width <= MAX_MEDIA_EDIT_DIMENSION
      && Number.isSafeInteger(height) && height > 0 && height <= MAX_MEDIA_EDIT_DIMENSION
      && Number.isSafeInteger(width * height) && width * height <= MAX_MEDIA_EDIT_PIXELS
      && Math.max(width, height) / Math.min(width, height) <= MAX_MEDIA_EDIT_ASPECT_RATIO;
  }

  function validMediaEditUrl(value) {
    if (!text(value, 4096)) return false;
    try {
      var parsed = new URL(value);
      var local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '[::1]' || parsed.hostname === '::1';
      return !parsed.username && !parsed.password && !parsed.hash
        && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && local));
    } catch (_error) {
      return false;
    }
  }

  function validPreparedMediaSource(value, expectedSourceMediaKey) {
    var data = record(value);
    var asset = data && record(data.sourceAsset);
    return data
      && Object.keys(data).every(function (key) {
        return [
          'contractVersion', 'sourceMediaKey', 'sourceAsset', 'maskSemantics', 'maxMaskBytes',
        ].includes(key);
      })
      && data.contractVersion === 'extension-media-edit-source/v1'
      && data.sourceMediaKey === expectedSourceMediaKey
      && data.maskSemantics === MEDIA_EDIT_MASK_SEMANTICS
      && Number.isSafeInteger(data.maxMaskBytes) && data.maxMaskBytes > 0
      && data.maxMaskBytes <= MAX_MEDIA_EDIT_MASK_BYTES
      && asset
      && Object.keys(asset).every(function (key) {
        return ['id', 'url', 'mimeType', 'width', 'height'].includes(key);
      })
      && text(asset.id, 200)
      && validMediaEditUrl(asset.url)
      && ['image/jpeg', 'image/png', 'image/webp'].includes(asset.mimeType)
      && validMediaEditDimensions(asset.width, asset.height);
  }

  function maskDataUrlBytes(value, maximum) {
    if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,iVBORw0KGgo')) {
      throw new TypeError('maskDataUrl is invalid');
    }
    var encoded = value.slice('data:image/png;base64,'.length);
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new TypeError('maskDataUrl is invalid');
    }
    var padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    var bytes = encoded.length / 4 * 3 - padding;
    if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > MAX_MEDIA_EDIT_MASK_BYTES
      || bytes <= 0 || bytes > maximum) throw new TypeError('maskDataUrl is too large');
    return bytes;
  }

  function validUploadedMediaMask(value, expected) {
    var data = record(value);
    if (!data || Object.keys(data).some(function (key) {
      return ![
        'contractVersion', 'sourceMediaKey', 'sourceAssetId', 'maskAssetId', 'url',
        'mimeType', 'width', 'height', 'maskSemantics', 'editPixelCount',
        'preservedPixelCount', 'featheredPixelCount',
      ].includes(key);
    })) return false;
    var countsValid = count(data.editPixelCount) && count(data.preservedPixelCount)
      && count(data.featheredPixelCount)
      && data.editPixelCount + data.preservedPixelCount === data.width * data.height
      && data.featheredPixelCount <= data.editPixelCount;
    return data.contractVersion === 'extension-media-edit-mask/v1'
      && data.sourceMediaKey === expected.sourceMediaKey
      && text(data.sourceAssetId, 200)
      && text(data.maskAssetId, 200)
      && validMediaEditUrl(data.url)
      && data.mimeType === 'image/png'
      && data.width === expected.width
      && data.height === expected.height
      && data.maskSemantics === MEDIA_EDIT_MASK_SEMANTICS
      && countsValid
      && data.editPixelCount > 0
      && data.preservedPixelCount > 0;
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
        var requestContext = {
          snapshotId: snapshotId,
          supplyGoodsId: supplyGoodsId,
          shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          revision: revision,
          draftVersion: draftVersion,
        };
        var versionedQuery = new URLSearchParams(query);
        versionedQuery.set('contractVersion', '2');
        var response = await transport.get(
          '/api/extension-device/source-workbench/media-launch?' + versionedQuery.toString(),
          { requiredScope: 'media:execute' },
        );
        if (response && response.state === 'http_error' && response.status === 400) {
          response = await transport.get(
            '/api/extension-device/source-workbench/media-launch?' + query.toString(),
            { requiredScope: 'media:execute' },
          );
        }
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (data && data.contractVersion === 'extension-media-launch/v2') {
          if (!text(data.revision, 200)
            || !validStandaloneLaunchOperations(data.operations)) {
            throw new Error('invalid source media launch v2 response');
          }
          if (data.context === null) {
            var enabled = STANDALONE_MEDIA_OPERATIONS.some(function (operation) {
              return data.operations[operation].enabled;
            });
            var ready = STANDALONE_MEDIA_OPERATIONS.some(function (operation) {
              return data.operations[operation].ready;
            });
            return {
              state: ready ? 'not_ready' : enabled ? 'not_ready' : 'disabled',
              contractVersion: 2,
              revision: data.revision,
              operations: data.operations,
              context: null,
            };
          }
          if (!validLaunchContext(data.context, requestContext)) {
            throw new Error('invalid source media launch v2 context response');
          }
          return {
            state: 'ready',
            contractVersion: 2,
            revision: data.revision,
            operations: data.operations,
            context: data.context,
          };
        }
        if (!data || !validLaunchCapability(data.capability)) {
          throw new Error('invalid source media launch capability response');
        }
        if (!data.capability.enabled || !data.capability.ready) {
          if (data.context !== null) throw new Error('disabled source media launch returned context data');
          return { state: data.capability.enabled ? 'not_ready' : 'disabled', capability: data.capability, context: null };
        }
        if (!validLaunchContext(data.context, requestContext)) {
          throw new Error('invalid source media launch context response');
        }
        return { state: 'ready', contractVersion: 1, capability: data.capability, context: data.context };
      },
      async prepareMediaEditSource(input) {
        var context = normalizedMediaEditContext(input);
        var response = await transport.post(
          '/api/extension-device/source-workbench/media-edit-source',
          context,
          { requiredScope: 'media:execute' },
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!validPreparedMediaSource(data, context.sourceMediaKey)) {
          throw new Error('invalid media edit source response');
        }
        return {
          state: 'ready',
          contractVersion: data.contractVersion,
          sourceMediaKey: data.sourceMediaKey,
          sourceAsset: { ...data.sourceAsset },
          maskSemantics: data.maskSemantics,
          maxMaskBytes: data.maxMaskBytes,
        };
      },
      async uploadMediaEditMask(input) {
        var context = normalizedMediaEditContext(input);
        var semantics = input && input.maskSemantics;
        if (semantics !== MEDIA_EDIT_MASK_SEMANTICS) {
          throw new TypeError('maskSemantics is invalid');
        }
        var expectedWidth = positiveRevision(input && input.expectedWidth, 'expectedWidth');
        var expectedHeight = positiveRevision(input && input.expectedHeight, 'expectedHeight');
        if (!validMediaEditDimensions(expectedWidth, expectedHeight)) {
          throw new TypeError('expected mask dimensions are invalid');
        }
        var maskDataUrl = input && input.maskDataUrl;
        maskDataUrlBytes(maskDataUrl, Number(input && input.maxMaskBytes));
        var response = await transport.post(
          '/api/extension-device/source-workbench/media-edit-mask',
          {
            ...context,
            maskSemantics: semantics,
            maskDataUrl: maskDataUrl,
          },
          { requiredScope: 'media:execute' },
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!envelope || typeof envelope.replayed !== 'boolean'
          || !validUploadedMediaMask(data, {
            sourceMediaKey: context.sourceMediaKey,
            width: expectedWidth,
            height: expectedHeight,
          })) {
          throw new Error('invalid media edit mask response');
        }
        return {
          state: 'ready',
          replayed: envelope.replayed,
          contractVersion: data.contractVersion,
          sourceMediaKey: data.sourceMediaKey,
          sourceAssetId: data.sourceAssetId,
          maskAssetId: data.maskAssetId,
          url: data.url,
          mimeType: data.mimeType,
          width: data.width,
          height: data.height,
          maskSemantics: data.maskSemantics,
          editPixelCount: data.editPixelCount,
          preservedPixelCount: data.preservedPixelCount,
          featheredPixelCount: data.featheredPixelCount,
        };
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
          || !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(result.status)
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
      async createWorkflowCommand(input) {
        var operation = input && input.operation;
        if (!['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)) {
          throw new TypeError('media workflow operation is invalid');
        }
        var shopId = identifier(input && input.shopId, 'shopId');
        var listingWorkflowId = identifier(input && input.listingWorkflowId, 'listingWorkflowId');
        var draftRevision = positiveRevision(input && input.draftRevision, 'draftRevision');
        var draftVersion = positiveRevision(input && input.draftVersion, 'draftVersion');
        var sourceMediaKeys = normalizedSourceMediaKeys(input && input.sourceMediaKeys, operation);
        var prompt = identifier(input && input.prompt, 'prompt', 8000);
        var rawNegativePrompt = input && input.negativePrompt == null
          ? ''
          : String(input.negativePrompt).normalize('NFKC').trim();
        if (rawNegativePrompt.length > 4000) throw new TypeError('negativePrompt is invalid');
        var workflowOperationKey = identifier(input && input.workflowOperationKey, 'workflowOperationKey');
        if (workflowOperationKey.length > 128) throw new TypeError('workflowOperationKey is invalid');
        var command = {
          schemaVersion: 'ai-media-workflow-create/v2',
          action: 'CREATE_WORKFLOW',
          operation: operation,
          sourceMediaKeys: sourceMediaKeys,
          prompt: prompt,
          negativePrompt: rawNegativePrompt,
          draftRevision: draftRevision,
          workflowOperationKey: workflowOperationKey,
        };
        if (operation === 'INPAINT') {
          command.maskAssetId = identifier(input && input.maskAssetId, 'maskAssetId');
          command.maskSemantics = 'WHITE_EDIT_BLACK_PRESERVE_V1';
        } else if (input && (input.maskAssetId != null || input.maskSemantics != null)) {
          throw new TypeError('maskAssetId is invalid for this operation');
        }
        var idempotencyKey = await freshAttemptKey({
          operation: 'MEDIA_EXECUTE',
          shopId: shopId,
          listingWorkflowId: listingWorkflowId,
          draftVersion: draftVersion,
          command: command,
        }, 'extension-media-create:');
        var envelope = {
          shopId: shopId,
          workflowId: listingWorkflowId,
          draftVersion: draftVersion,
          idempotencyKey: idempotencyKey,
          command: command,
        };
        var completed = await executeGrantedMediaMutation(
          transport,
          'MEDIA_EXECUTE',
          'media:execute',
          envelope,
          'media workflow',
        );
        var result = completed.result;
        if (!text(result.workflowId, 200)
          || result.action !== 'CREATE_WORKFLOW'
          || result.operation !== operation
          || !['QUEUED', 'RUNNING', 'SUCCEEDED'].includes(result.status)
          || !Number.isSafeInteger(result.revision)
          || result.revision <= 0) {
          throw new Error('media workflow command did not complete');
        }
        return {
          state: 'completed',
          replay: completed.executedData.replay === true,
          receipt: completed.receipt,
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
