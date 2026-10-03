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

  function mutationBoundaryError(code, message, outcome, requestDispatched) {
    var error = new Error(message);
    error.name = 'ExtensionListingWorkflowMutationError';
    error.code = code;
    error.outcome = outcome;
    error.requestDispatched = requestDispatched;
    if (outcome === 'UNKNOWN_OUTCOME') error.automaticRetryAllowed = false;
    return error;
  }

  function mutationNotSubmitted(message) {
    return mutationBoundaryError(
      'SS_ERP_LISTING_WORKFLOW_MUTATION_NOT_SUBMITTED',
      message,
      'NOT_SUBMITTED',
      false,
    );
  }

  function mutationUnknown(message) {
    return mutationBoundaryError(
      'SS_ERP_LISTING_WORKFLOW_MUTATION_UNKNOWN_OUTCOME',
      message,
      'UNKNOWN_OUTCOME',
      true,
    );
  }

  function requestOutcomeUnknown(error) {
    return Boolean(error && typeof error === 'object'
      && (error.requestDispatched === true || error.outcome === 'UNKNOWN_OUTCOME'));
  }

  function mutationResponseProvesRejection(response) {
    if (!response || typeof response !== 'object') return false;
    if (['unpaired', 'scope_required', 'authorization_required'].includes(response.state)) {
      return true;
    }
    if (response.state === 'http_error'
      && Number.isSafeInteger(response.status)
      && response.status >= 500) return false;
    var body = response.state === 'response' || response.state === 'http_error'
      ? record(response.body) : null;
    return Boolean(body && body.code === 0);
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
    if (!item || !text(item.sourceMediaKey, 500)) return false;
    var keys = Object.keys(item);
    if (keys.length === 1) return keys[0] === 'sourceMediaKey';
    if (keys.length !== 4
      || !['sourceMediaKey', 'role', 'scope', 'skuKeys'].every(function (key) {
        return Object.prototype.hasOwnProperty.call(item, key);
      })
      || !text(item.role, 100)
      || !['PRODUCT', 'SKU'].includes(item.scope)
      || !Array.isArray(item.skuKeys) || item.skuKeys.length > 500
      || item.skuKeys.some(function (skuKey) { return !text(skuKey, 500); })
      || new Set(item.skuKeys).size !== item.skuKeys.length) return false;
    return item.scope === 'SKU' ? item.skuKeys.length > 0 : item.skuKeys.length === 0;
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

  function validFailedCommandReceipt(executedData, receipt) {
    return exactKeys(executedData, ['replay', 'receipt'])
      && typeof executedData.replay === 'boolean'
      && exactKeys(receipt, ['id', 'status', 'result', 'failureCode'])
      && text(receipt.id, 200)
      && receipt.status === 'FAILED'
      && receipt.result === null
      && typeof receipt.failureCode === 'string'
      && /^[A-Z][A-Z0-9_]{0,99}$/u.test(receipt.failureCode);
  }

  async function executeGrantedMediaMutation(
    transport,
    operation,
    requiredScope,
    envelope,
    failureSubject,
  ) {
    var subject = text(failureSubject, 100) ? failureSubject : 'media mutation';
    var issued;
    try {
      issued = await transport.post('/api/extension-device/command-grants', {
        operation: operation,
        ...envelope,
      }, { requiredScope: requiredScope });
    } catch {
      throw mutationNotSubmitted(subject + ' command grant was not issued');
    }
    var issuedBody = issued && issued.state === 'response' ? record(issued.body) : null;
    var issuedData = issuedBody && issuedBody.code === 1 ? record(issuedBody.data) : null;
    if (!issuedData || !text(issuedData.grantToken, 1000)) {
      throw mutationNotSubmitted(subject + ' command grant was not issued');
    }
    var executeEnvelope = operation === 'MEDIA_EXECUTE'
      ? envelope
      : { operation: operation, ...envelope };
    var executed;
    try {
      executed = await transport.post(
        '/api/extension-device/media-workflows/execute',
        executeEnvelope,
        { commandGrant: issuedData.grantToken, requiredScope: requiredScope },
      );
    } catch (error) {
      if (requestOutcomeUnknown(error)) {
        throw mutationUnknown(subject + ' command outcome is unknown');
      }
      throw mutationNotSubmitted(subject + ' command was not submitted');
    }
    var executedBody = executed && executed.state === 'response' ? record(executed.body) : null;
    var executedData = executedBody && executedBody.code === 1 ? record(executedBody.data) : null;
    var receipt = executedData ? record(executedData.receipt) : null;
    var result = receipt ? record(receipt.result) : null;
    if (!receipt) {
      if (mutationResponseProvesRejection(executed)) {
        throw new Error(subject + ' command did not complete');
      }
      throw mutationUnknown(subject + ' command response is ambiguous');
    }
    if (receipt.status === 'FAILED') {
      if (!validFailedCommandReceipt(executedData, receipt)) {
        throw mutationUnknown(subject + ' command failure response is ambiguous');
      }
      throw new Error(subject + ' command did not complete');
    }
    if (receipt.status !== 'SUCCEEDED' || !result) {
      throw mutationUnknown(subject + ' command response is ambiguous');
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
    } catch {
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
      ...(input && input.target !== undefined ? { target: normalizedMediaTarget(input.target) } : {}),
    };
  }

  function normalizedMediaTarget(value) {
    if (!exactKeys(value, ['skuKey', 'slotKey'])) throw new TypeError('media target is invalid');
    return {
      skuKey: value.skuKey === null ? null : identifier(value.skuKey, 'target SKU', 500),
      slotKey: identifier(value.slotKey, 'target slot', 200),
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
    } catch {
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

  var AI_IMAGE_SUITE_PROJECTION_VERSION = 'extension-ai-image-suite-projection/v1';
  var AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION = 'extension-ai-image-suite-execute-command/v1';
  var AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION = 'extension-ai-image-suite-review-command/v1';
  var AI_IMAGE_SUITE_APPLY_COMMAND_VERSION = 'extension-ai-image-suite-apply-command/v1';
  var AI_IMAGE_SUITE_INTENT_WITNESS_VERSION = 'extension-ai-image-suite-intent-witness/v1';
  var AI_IMAGE_SUITE_MAX_COST_CENTS = 10000000;
  var AI_IMAGE_SUITE_STATUSES = [
    'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL_FAILURE',
    'CANCEL_REQUESTED', 'CANCELLED',
  ];
  var AI_IMAGE_SUITE_SLOT_STATUSES = [
    'PLANNED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED',
  ];
  var AI_IMAGE_SUITE_REVIEW_STATUSES = ['NOT_READY', 'PENDING', 'APPROVED', 'REJECTED'];

  function exactKeys(value, keys) {
    var item = record(value);
    return Boolean(item)
      && Object.keys(item).sort().join(',') === keys.slice().sort().join(',');
  }

  function boundedSuiteCost(value, positive) {
    return Number.isSafeInteger(value)
      && value >= (positive ? 1 : 0)
      && value <= AI_IMAGE_SUITE_MAX_COST_CENTS;
  }

  function exactSuitePriceKeys(value, keys) {
    var item = record(value);
    if (!item) return false;
    var hasCurrency = Object.prototype.hasOwnProperty.call(item, 'currency');
    var isCny = /^ai-image-suite-price-cny\/v1:[a-f0-9]{32}$/.test(item.pricingVersion);
    if (!isCny && /^ai-image-suite-price-cny\//.test(item.pricingVersion)) return false;
    return exactKeys(item, hasCurrency ? keys.concat('currency') : keys)
      && (isCny ? item.currency === 'CNY' : !hasCurrency || item.currency === 'USD');
  }

  function sha256(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  function nullableText(value, maximum) {
    return value === null || text(value, maximum);
  }

  function validSuiteBinding(value, expected) {
    return exactKeys(value, [
      'snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId',
      'draftRevision', 'draftVersion',
    ])
      && text(value.snapshotId, 200)
      && text(value.supplyGoodsId, 200)
      && text(value.shopId, 200)
      && text(value.listingWorkflowId, 200)
      && Number.isSafeInteger(value.draftRevision) && value.draftRevision > 0
      && Number.isSafeInteger(value.draftVersion) && value.draftVersion > 0
      && (!expected
        || (value.snapshotId === expected.snapshotId
          && value.supplyGoodsId === expected.supplyGoodsId
          && value.shopId === expected.shopId
          && value.listingWorkflowId === expected.listingWorkflowId
          && value.draftRevision === expected.draftRevision
          && value.draftVersion === expected.draftVersion));
  }

  function validSuiteAuthority(value, context) {
    return exactKeys(value, [
      'snapshotId', 'supplyGoodsId', 'draftRevision', 'planId', 'planVersionId',
      'planRevision', 'skuKey', 'authorityHash',
    ])
      && value.snapshotId === context.snapshotId
      && value.supplyGoodsId === context.supplyGoodsId
      && value.draftRevision === context.draftRevision
      && text(value.planId, 200)
      && text(value.planVersionId, 200)
      && Number.isSafeInteger(value.planRevision) && value.planRevision > 0
      && nullableText(value.skuKey, 500)
      && sha256(value.authorityHash);
  }

  function validAllowedCommands(value, commands, allowed) {
    if (!Array.isArray(value) || value.length > allowed.length
      || new Set(value).size !== value.length
      || value.some(function (action) { return !allowed.includes(action); })
      || !record(commands)) return false;
    var commandKeys = Object.keys(commands);
    return commandKeys.length === value.length
      && commandKeys.every(function (action) { return value.includes(action); });
  }

  function validApplicableSkuKeys(value, ownership) {
    if (!Array.isArray(value)
      || value.length < 1
      || value.length > 500
      || !value.every(function (skuKey) { return text(skuKey, 500); })
      || new Set(value).size !== value.length
      || value.some(function (skuKey, index) {
        return index > 0 && value[index - 1] >= skuKey;
      })) return false;
    return ownership.level === 'sku'
      ? value.length === 1 && value[0] === ownership.key
      : ownership.level === 'compatibility_group';
  }

  function validPlanSlot(value) {
    var slot = record(value);
    var ownership = slot && record(slot.ownership);
    return exactKeys(slot, [
      'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
      'estimatedCostCents', 'maximumCostCents',
    ])
      && Number.isSafeInteger(slot.ordinal) && slot.ordinal >= 0
      && text(slot.slotKey, 500)
      && text(slot.goal, 200)
      && exactKeys(ownership, ['level', 'key'])
      && ['sku', 'compatibility_group'].includes(ownership.level)
      && text(ownership.key, 500)
      && validApplicableSkuKeys(slot.applicableSkuKeys, ownership)
      && boundedSuiteCost(slot.estimatedCostCents, false)
      && boundedSuiteCost(slot.maximumCostCents, false)
      && slot.maximumCostCents >= slot.estimatedCostCents;
  }

  function validSuitePlan(value, authority) {
    var plan = record(value);
    var preview = plan && record(plan.preview);
    var commands = plan && record(plan.commands);
    if (!exactKeys(plan, [
      'id', 'versionId', 'revision', 'status', 'skuKey', 'preview', 'allowedActions', 'commands',
    ])
      || plan.id !== authority.planId
      || plan.versionId !== authority.planVersionId
      || plan.revision !== authority.planRevision
      || plan.status !== 'APPROVED'
      || plan.skuKey !== authority.skuKey
      || !exactSuitePriceKeys(preview, [
        'hash', 'pricingVersion', 'itemCount', 'estimatedCostCents',
        'maximumCostCents', 'slots',
      ])
      || !sha256(preview.hash)
      || !text(preview.pricingVersion, 100)
      || !Number.isSafeInteger(preview.itemCount) || preview.itemCount < 1 || preview.itemCount > 500
      || !boundedSuiteCost(preview.estimatedCostCents, false)
      || !boundedSuiteCost(preview.maximumCostCents, true)
      || preview.maximumCostCents < preview.estimatedCostCents
      || !Array.isArray(preview.slots) || preview.slots.length > 500
      || !preview.slots.every(validPlanSlot)
      || !validAllowedCommands(plan.allowedActions, commands, ['START'])) return false;
    if (!commands.START) return plan.allowedActions.length === 0;
    return exactKeys(commands.START, [
      'expectedPreviewHash', 'acceptedPricingVersion',
      'acceptedEstimatedCostCents', 'acceptedMaximumCostCents',
    ])
      && commands.START.expectedPreviewHash === preview.hash
      && commands.START.acceptedPricingVersion === preview.pricingVersion
      && commands.START.acceptedEstimatedCostCents === preview.estimatedCostCents
      && commands.START.acceptedMaximumCostCents === preview.maximumCostCents;
  }

  function validSuiteOutput(value) {
    if (value === null) return true;
    return exactKeys(value, ['id', 'url', 'storageBackend', 'mimeType', 'width', 'height'])
      && text(value.id, 200)
      && validPreviewUrl(value.url)
      && ['local', 'oss'].includes(value.storageBackend)
      && ['image/jpeg', 'image/png', 'image/webp'].includes(value.mimeType)
      && (value.width === null || (Number.isSafeInteger(value.width) && value.width > 0))
      && (value.height === null || (Number.isSafeInteger(value.height) && value.height > 0));
  }

  function validSuiteApplication(value) {
    if (value === null) return true;
    return exactKeys(value, ['state', 'target', 'mode', 'writesStoreDraft'])
      && ['APPLIED', 'ROLLED_BACK'].includes(value.state)
      && value.target === 'ERP_SOURCE_PRODUCT'
      && value.mode === 'append'
      && value.writesStoreDraft === false;
  }

  function validSuiteBilling(value, slot, currency) {
    var billing = record(value);
    var settlement = billing && billing.settlement;
    var reservationStatuses = [
      'NOT_CREATED', 'RESERVED', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED',
      'SETTLED', 'RELEASED',
    ];
    var settlementKinds = [
      'CHARGE', 'RELEASE', 'SUBMISSION_UNCERTAIN', 'RECONCILIATION_REQUIRED',
      'RECONCILED_CHARGE', 'RECONCILED_RELEASE',
    ];
    if (!exactKeys(billing, [
      'mode', 'currency', 'estimatedCostMinor', 'maximumCostMinor',
      'reservationStatus', 'settlement',
    ])
      || billing.mode !== 'ERP_HOSTED'
      || billing.currency !== currency
      || billing.estimatedCostMinor !== slot.estimatedCostCents
      || billing.maximumCostMinor !== slot.maximumCostCents
      || !reservationStatuses.includes(billing.reservationStatus)) return false;
    if (settlement === null) {
      return !['SETTLED', 'RELEASED'].includes(billing.reservationStatus);
    }
    if (!exactKeys(settlement, ['kind', 'actualCostMinor', 'billedUnits'])
      || !settlementKinds.includes(settlement.kind)
      || !(settlement.actualCostMinor === null
        || boundedSuiteCost(settlement.actualCostMinor, false))
      || !Number.isSafeInteger(settlement.billedUnits) || settlement.billedUnits < 0
      || settlement.billedUnits > 1000000000) return false;
    if (billing.reservationStatus === 'SETTLED') {
      return ['CHARGE', 'RECONCILED_CHARGE'].includes(settlement.kind)
        && settlement.actualCostMinor !== null;
    }
    if (billing.reservationStatus === 'RELEASED') {
      return ['RELEASE', 'RECONCILED_RELEASE'].includes(settlement.kind)
        && settlement.actualCostMinor === null;
    }
    return true;
  }

  function canonicalTimestamp(value) {
    if (typeof value !== 'string' || !value || value.length > 100) return false;
    var parsed = new Date(value);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
  }

  function validSlotCommand(action, value, slot, suite) {
    var command = record(value);
    var baseValid = command
      && command.suiteId === suite.id
      && command.slotId === slot.id
      && command.expectedSuiteRevision === suite.revision
      && command.expectedSlotRevision === slot.revision;
    if (!baseValid) return false;
    if (action === 'RETRY_SLOT') {
      return exactKeys(command, [
        'suiteId', 'slotId', 'expectedSuiteRevision', 'expectedSlotRevision',
        'acceptedAdditionalMaximumCostCents',
      ])
        && boundedSuiteCost(command.acceptedAdditionalMaximumCostCents, true)
        && command.acceptedAdditionalMaximumCostCents === slot.maximumCostCents;
    }
    var outputValid = command.workflowId === slot.workflowId
      && command.outputAssetId === (slot.output && slot.output.id)
      && command.expectedWorkflowRevision === slot.workflowRevision;
    if (!outputValid) return false;
    if (action === 'REVIEW_SLOT') {
      return exactKeys(command, [
        'suiteId', 'slotId', 'workflowId', 'outputAssetId', 'expectedSuiteRevision',
        'expectedSlotRevision', 'expectedWorkflowRevision', 'decisions',
      ])
        && Array.isArray(command.decisions)
        && command.decisions.length === 2
        && command.decisions.includes('APPROVE')
        && command.decisions.includes('REJECT');
    }
    return action === 'APPLY_SLOT'
      && exactKeys(command, [
        'suiteId', 'slotId', 'workflowId', 'outputAssetId', 'expectedSuiteRevision',
        'expectedSlotRevision', 'expectedWorkflowRevision', 'mode', 'target',
        'writesStoreDraft', 'expectedTargetUpdatedAt',
      ])
      && command.mode === 'append'
      && command.target === 'ERP_SOURCE_PRODUCT'
      && command.writesStoreDraft === false
      && canonicalTimestamp(command.expectedTargetUpdatedAt);
  }

  function validSuiteSlot(value, suite, currency) {
    var slot = record(value);
    var ownership = slot && record(slot.ownership);
    var commands = slot && record(slot.commands);
    var slotKeys = [
      'id', 'ordinal', 'slotKey', 'goal', 'ownership', 'applicableSkuKeys',
      'status', 'attempt', 'revision',
      'estimatedCostCents', 'maximumCostCents', 'workflowId', 'workflowRevision',
      'reviewStatus', 'output', 'application', 'allowedActions', 'commands',
    ];
    if (!exactKeys(slot, slot && slot.billing !== undefined ? slotKeys.concat('billing') : slotKeys)
      || !text(slot.id, 200)
      || !Number.isSafeInteger(slot.ordinal) || slot.ordinal < 0
      || !text(slot.slotKey, 500)
      || !text(slot.goal, 200)
      || !exactKeys(ownership, ['level', 'key'])
      || !['sku', 'compatibility_group'].includes(ownership.level)
      || !text(ownership.key, 500)
      || !validApplicableSkuKeys(slot.applicableSkuKeys, ownership)
      || !AI_IMAGE_SUITE_SLOT_STATUSES.includes(slot.status)
      || !Number.isSafeInteger(slot.attempt) || slot.attempt < 0
      || !Number.isSafeInteger(slot.revision) || slot.revision < 1
      || !boundedSuiteCost(slot.estimatedCostCents, false)
      || !boundedSuiteCost(slot.maximumCostCents, false)
      || slot.maximumCostCents < slot.estimatedCostCents
      || !nullableText(slot.workflowId, 200)
      || !(slot.workflowRevision === null
        || (Number.isSafeInteger(slot.workflowRevision) && slot.workflowRevision > 0))
      || (slot.workflowId === null) !== (slot.workflowRevision === null)
      || !AI_IMAGE_SUITE_REVIEW_STATUSES.includes(slot.reviewStatus)
      || !validSuiteOutput(slot.output)
      || !validSuiteApplication(slot.application)
      || (slot.billing !== undefined && !validSuiteBilling(slot.billing, slot, currency))
      || !validAllowedCommands(
        slot.allowedActions,
        commands,
        ['RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT'],
      )) return false;
    return Object.keys(commands).every(function (action) {
      return validSlotCommand(action, commands[action], slot, suite);
    });
  }

  function validCurrentSuite(value, plan) {
    var suite = record(value);
    var commands = suite && record(suite.commands);
    if (!exactKeys(suite, [
      'id', 'status', 'revision', 'previewHash', 'pricingVersion', 'itemCount',
      'estimatedCostCents', 'maximumCostCents', 'allowedActions', 'commands', 'slots',
    ])
      || !text(suite.id, 200)
      || !AI_IMAGE_SUITE_STATUSES.includes(suite.status)
      || !Number.isSafeInteger(suite.revision) || suite.revision < 1
      || suite.previewHash !== plan.preview.hash
      || suite.pricingVersion !== plan.preview.pricingVersion
      || !Number.isSafeInteger(suite.itemCount) || suite.itemCount < 1 || suite.itemCount > 500
      || !boundedSuiteCost(suite.estimatedCostCents, false)
      || !boundedSuiteCost(suite.maximumCostCents, true)
      || suite.maximumCostCents < suite.estimatedCostCents
      || !validAllowedCommands(suite.allowedActions, commands, ['CONTINUE', 'CANCEL'])
      || !Array.isArray(suite.slots) || suite.slots.length > 500) return false;
    if (!Object.keys(commands).every(function (action) {
      return exactKeys(commands[action], ['suiteId', 'expectedSuiteRevision'])
        && commands[action].suiteId === suite.id
        && commands[action].expectedSuiteRevision === suite.revision;
    })) return false;
    var currency = Object.prototype.hasOwnProperty.call(plan.preview, 'currency')
      ? plan.preview.currency : 'USD';
    return suite.slots.every(function (slot) { return validSuiteSlot(slot, suite, currency); });
  }

  function validAiImageSuiteProjection(value, expected) {
    var projection = record(value);
    var context = projection && record(projection.context);
    var policy = projection && record(projection.applyPolicy);
    if (!exactKeys(projection, [
      'contractVersion', 'context', 'commandAuthority', 'applyPolicy', 'plan', 'suite',
    ])
      || projection.contractVersion !== AI_IMAGE_SUITE_PROJECTION_VERSION
      || !validSuiteBinding(context, expected)
      || !exactKeys(policy, ['target', 'mode', 'writesStoreDraft'])
      || policy.target !== 'ERP_SOURCE_PRODUCT'
      || policy.mode !== 'append'
      || policy.writesStoreDraft !== false) return false;
    if (projection.plan === null) {
      return projection.commandAuthority === null && projection.suite === null;
    }
    return validSuiteAuthority(projection.commandAuthority, context)
      && validSuitePlan(projection.plan, projection.commandAuthority)
      && (projection.suite === null || validCurrentSuite(projection.suite, projection.plan));
  }

  function normalizedSuiteBinding(input) {
    return {
      snapshotId: identifier(input && input.snapshotId, 'snapshotId'),
      supplyGoodsId: identifier(input && input.supplyGoodsId, 'supplyGoodsId'),
      shopId: identifier(input && input.shopId, 'shopId'),
      listingWorkflowId: identifier(input && input.listingWorkflowId, 'listingWorkflowId'),
      draftRevision: positiveRevision(input && input.draftRevision, 'draftRevision'),
      draftVersion: positiveRevision(input && input.draftVersion, 'draftVersion'),
    };
  }

  function suiteAuthorityCommand(authority) {
    return {
      snapshotId: authority.snapshotId,
      supplyGoodsId: authority.supplyGoodsId,
      draftRevision: authority.draftRevision,
      planId: authority.planId,
      planVersionId: authority.planVersionId,
      planRevision: authority.planRevision,
      skuKey: authority.skuKey,
    };
  }

  function suiteCommandTemplate(projection, action, slotId) {
    if (action === 'START') {
      return projection.plan.allowedActions.includes(action)
        ? projection.plan.commands.START
        : null;
    }
    if (action === 'CONTINUE' || action === 'CANCEL') {
      return projection.suite && projection.suite.allowedActions.includes(action)
        ? projection.suite.commands[action]
        : null;
    }
    var slot = projection.suite && projection.suite.slots.find(function (item) {
      return item.id === slotId;
    });
    return slot && slot.allowedActions.includes(action) ? slot.commands[action] : null;
  }

  function cloneSuiteIntentValue(value) {
    if (Array.isArray(value)) return value.map(cloneSuiteIntentValue);
    if (record(value)) {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], cloneSuiteIntentValue(entry[1])];
      }));
    }
    return value;
  }

  function freezeSuiteIntentValue(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freezeSuiteIntentValue);
    return Object.freeze(value);
  }

  function boundedSuiteIntentValue(value, depth, budget) {
    if (budget.count >= 64 || depth > 4) return false;
    budget.count += 1;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0;
    if (typeof value === 'string') return value.length <= 500;
    if (Array.isArray(value)) {
      return value.length <= 4 && value.every(function (item) {
        return boundedSuiteIntentValue(item, depth + 1, budget);
      });
    }
    var item = record(value);
    if (!item || Object.keys(item).length > 16) return false;
    return Object.keys(item).every(function (key) {
      return key.length <= 100 && boundedSuiteIntentValue(item[key], depth + 1, budget);
    });
  }

  function sameSuiteIntentValue(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right)
        && left.length === right.length
        && left.every(function (value, index) {
          return sameSuiteIntentValue(value, right[index]);
        });
    }
    var leftRecord = record(left);
    var rightRecord = record(right);
    if (!leftRecord || !rightRecord) return false;
    var leftKeys = Object.keys(leftRecord).sort();
    var rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every(function (key, index) {
        return key === rightKeys[index]
          && sameSuiteIntentValue(leftRecord[key], rightRecord[key]);
      });
  }

  function createAiImageSuiteIntentWitness(input) {
    var projection = input && input.projection;
    if (!validAiImageSuiteProjection(projection, projection && projection.context)
      || !projection.commandAuthority || !projection.plan) {
      throw new TypeError('AI image suite projection is invalid');
    }
    var action = input && input.action;
    var actions = ['START', 'CONTINUE', 'CANCEL', 'RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT'];
    if (!actions.includes(action)) throw new TypeError('AI image suite action is invalid');
    var slotId = input && input.slotId == null ? null : identifier(input.slotId, 'slotId');
    var decision = input && input.decision == null ? null : input.decision;
    var slotAction = ['RETRY_SLOT', 'REVIEW_SLOT', 'APPLY_SLOT'].includes(action);
    if (slotAction !== Boolean(slotId)
      || (action === 'REVIEW_SLOT'
        ? !['APPROVE', 'REJECT'].includes(decision)
        : decision !== null)) {
      throw new TypeError('AI image suite intent shape is invalid');
    }
    var template = suiteCommandTemplate(projection, action, slotId);
    if (!template) throw new TypeError('AI image suite action is not currently allowed');
    if (action === 'REVIEW_SLOT' && !template.decisions.includes(decision)) {
      throw new TypeError('AI image suite review decision is invalid');
    }
    return freezeSuiteIntentValue({
      version: AI_IMAGE_SUITE_INTENT_WITNESS_VERSION,
      context: cloneSuiteIntentValue(projection.context),
      authorityHash: projection.commandAuthority.authorityHash,
      action: action,
      slotId: slotId,
      decision: decision,
      commandTemplate: cloneSuiteIntentValue(template),
    });
  }

  function matchesAiImageSuiteIntentWitness(received, expected) {
    if (!exactKeys(received, [
      'version', 'context', 'authorityHash', 'action', 'slotId', 'decision', 'commandTemplate',
    ]) || !exactKeys(expected, [
      'version', 'context', 'authorityHash', 'action', 'slotId', 'decision', 'commandTemplate',
    ]) || received.version !== AI_IMAGE_SUITE_INTENT_WITNESS_VERSION
      || expected.version !== AI_IMAGE_SUITE_INTENT_WITNESS_VERSION
      || !sha256(received.authorityHash)
      || !boundedSuiteIntentValue(received, 0, { count: 0 })) return false;
    return sameSuiteIntentValue(received, expected);
  }

  function buildSuiteCommand(input) {
    var projection = input && input.projection;
    if (!validAiImageSuiteProjection(projection, projection && projection.context)
      || !projection.commandAuthority || !projection.plan) {
      throw new TypeError('AI image suite projection is invalid');
    }
    var action = input && input.action;
    var executeActions = ['START', 'CONTINUE', 'CANCEL', 'RETRY_SLOT'];
    if (![...executeActions, 'REVIEW_SLOT', 'APPLY_SLOT'].includes(action)) {
      throw new TypeError('AI image suite action is invalid');
    }
    var slotId = input && input.slotId == null
      ? null
      : identifier(input.slotId, 'slotId');
    var template = suiteCommandTemplate(projection, action, slotId);
    if (!template) throw new TypeError('AI image suite action is not currently allowed');
    if ((action === 'START' || action === 'RETRY_SLOT') && input.costConfirmed !== true) {
      throw new TypeError('AI image suite cost confirmation is required');
    }
    var operation = executeActions.includes(action)
      ? 'MEDIA_EXECUTE'
      : action === 'REVIEW_SLOT' ? 'MEDIA_REVIEW' : 'MEDIA_APPLY';
    var version = operation === 'MEDIA_EXECUTE'
      ? AI_IMAGE_SUITE_EXECUTE_COMMAND_VERSION
      : operation === 'MEDIA_REVIEW'
        ? AI_IMAGE_SUITE_REVIEW_COMMAND_VERSION
        : AI_IMAGE_SUITE_APPLY_COMMAND_VERSION;
    var command = {
      version: version,
      action: action,
      ...suiteAuthorityCommand(projection.commandAuthority),
    };
    if (action === 'START') {
      Object.assign(command, {
        expectedPreviewHash: template.expectedPreviewHash,
        acceptedPricingVersion: template.acceptedPricingVersion,
        acceptedEstimatedCostCents: template.acceptedEstimatedCostCents,
        acceptedMaximumCostCents: template.acceptedMaximumCostCents,
      });
    } else if (action === 'CONTINUE' || action === 'CANCEL') {
      Object.assign(command, {
        suiteId: template.suiteId,
        expectedSuiteRevision: template.expectedSuiteRevision,
      });
    } else if (action === 'RETRY_SLOT') {
      Object.assign(command, {
        suiteId: template.suiteId,
        slotId: template.slotId,
        expectedSuiteRevision: template.expectedSuiteRevision,
        expectedSlotRevision: template.expectedSlotRevision,
        acceptedAdditionalMaximumCostCents: template.acceptedAdditionalMaximumCostCents,
      });
    } else {
      Object.assign(command, {
        suiteId: template.suiteId,
        slotId: template.slotId,
        workflowId: template.workflowId,
        outputAssetId: template.outputAssetId,
        expectedSuiteRevision: template.expectedSuiteRevision,
        expectedSlotRevision: template.expectedSlotRevision,
        expectedWorkflowRevision: template.expectedWorkflowRevision,
      });
      if (action === 'REVIEW_SLOT') {
        var decision = input && input.decision;
        if (!template.decisions.includes(decision)) {
          throw new TypeError('AI image suite review decision is invalid');
        }
        command.decision = decision;
      } else {
        command.mode = 'append';
        command.expectedTargetUpdatedAt = template.expectedTargetUpdatedAt;
      }
    }
    return { operation: operation, command: command };
  }

  function canonicalSuiteCommandValue(value) {
    if (Array.isArray(value)) return value.map(canonicalSuiteCommandValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort(function (left, right) {
        return left.localeCompare(right);
      }).map(function (key) {
        return [key, canonicalSuiteCommandValue(value[key])];
      }));
    }
    return value;
  }

  function validSuiteCommandResult(value, built) {
    var result = record(value);
    var common = result
      && text(result.action, 100)
      && result.action === built.command.action
      && text(result.suiteId, 200)
      && AI_IMAGE_SUITE_STATUSES.includes(result.status)
      && Number.isSafeInteger(result.revision) && result.revision > 0
      && typeof result.replayed === 'boolean';
    if (!common) return false;
    if (built.operation === 'MEDIA_EXECUTE') {
      return exactKeys(result, ['action', 'suiteId', 'status', 'revision', 'replayed']);
    }
    var outputCommandMatches = result.suiteId === built.command.suiteId
      && result.slotId === built.command.slotId
      && result.workflowId === built.command.workflowId;
    if (!outputCommandMatches) return false;
    if (built.operation === 'MEDIA_REVIEW') {
      return exactKeys(result, [
        'action', 'suiteId', 'slotId', 'workflowId', 'status', 'revision', 'replayed',
      ]);
    }
    return exactKeys(result, [
      'action', 'suiteId', 'slotId', 'workflowId', 'status', 'revision', 'replayed',
      'target', 'mode', 'writesStoreDraft',
    ])
      && result.target === 'ERP_SOURCE_PRODUCT'
      && result.mode === 'append'
      && result.writesStoreDraft === false;
  }

  function editorResult(response, binding) {
    if (!response || response.state !== 'response') return response;
    var body = record(response.body);
    var data = body && body.code === 1 && record(body.data);
    if (!data) throw new Error(body && body.msg || 'ERP 草稿编辑未完成');
    var fields = ['contractVersion', 'binding', 'selectedSkuKeys', 'category', 'pricing'];
    if (Object.prototype.hasOwnProperty.call(data, 'packaging')) fields.push('packaging');
    if (Object.prototype.hasOwnProperty.call(data, 'fieldIssues')) fields.push('fieldIssues');
    if (Object.prototype.hasOwnProperty.call(data, 'copy')) fields.push('copy');
    var readinessFields = ['mediaAssignments', 'stage', 'validation', 'blockers', 'freshness'];
    var hasReadiness = readinessFields.some(function (key) { return Object.prototype.hasOwnProperty.call(data, key); });
    if (hasReadiness) fields = fields.concat(readinessFields);
    if (!exactKeys(data, fields)
      || data.contractVersion !== 'extension-listing-editor/v1' || !record(data.binding)
      || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(function (key) { return data.binding[key] === binding[key]; })
      || !Number.isSafeInteger(data.binding.draftRevision) || data.binding.draftRevision < binding.draftRevision
      || !Number.isSafeInteger(data.binding.draftVersion) || data.binding.draftVersion < binding.draftVersion
      || !Array.isArray(data.selectedSkuKeys) || !data.selectedSkuKeys.length || data.selectedSkuKeys.length > 100
      || !data.selectedSkuKeys.every(function (key) { return text(key, 500); })) throw new Error('invalid editor response');
    if (fields.includes('packaging') && (!Array.isArray(data.packaging) || data.packaging.length > data.selectedSkuKeys.length
      || new Set(data.packaging.map(function (row) { return row && row.skuKey; })).size !== data.packaging.length
      || !data.packaging.every(function (row) { return exactKeys(row, ['skuKey', 'weightG', 'lengthMm', 'widthMm', 'heightMm'])
        && data.selectedSkuKeys.includes(row.skuKey) && ['weightG', 'lengthMm', 'widthMm', 'heightMm'].every(function (key) {
          return typeof row[key] === 'number' && Number.isFinite(row[key]) && row[key] > 0;
        }); }))) throw new Error('invalid editor response');
    if (fields.includes('fieldIssues') && (!Array.isArray(data.fieldIssues) || data.fieldIssues.length > 2
      || !data.fieldIssues.every(function (item) { return exactKeys(item, ['field', 'message'])
        && ['PRICING', 'PACKAGING'].includes(item.field) && text(item.message, 2000); }))) throw new Error('invalid editor response');
    if (fields.includes('copy')) {
      var copy = data.copy;
      var copyText = function (value, maximum) { return value === null || typeof value === 'string' && value.length <= maximum; };
      if (!exactKeys(copy, ['titleRu', 'descriptionRu', 'pendingCandidates']) || !copyText(copy.titleRu, 500) || !copyText(copy.descriptionRu, 200000)
        || !Array.isArray(copy.pendingCandidates) || copy.pendingCandidates.length > 20
        || new Set(copy.pendingCandidates.map(function (item) { return item && item.id; })).size !== copy.pendingCandidates.length
        || !copy.pendingCandidates.every(function (item) { return exactKeys(item, ['id', 'fields', 'titleRu', 'descriptionRu', 'sourceCurrent'])
          && text(item.id, 200) && typeof item.sourceCurrent === 'boolean' && copyText(item.titleRu, 500) && copyText(item.descriptionRu, 200000)
          && Array.isArray(item.fields) && item.fields.length > 0 && item.fields.length <= 2 && new Set(item.fields).size === item.fields.length
          && item.fields.every(function (field) { return ['title', 'description'].includes(field); }); })) throw new Error('invalid editor response');
    }
    if (hasReadiness) {
      var validMedia = Array.isArray(data.mediaAssignments) && data.mediaAssignments.length <= 500
        && data.mediaAssignments.every(function (item) {
          return exactKeys(item, ['scope', 'skuKey', 'slotKey', 'assetId']) && text(item.slotKey, 500) && text(item.assetId, 200)
            && (item.scope === 'PRODUCT' ? item.skuKey === null : item.scope === 'SKU' && data.selectedSkuKeys.includes(item.skuKey));
        });
      if (!validMedia || !text(data.stage, 100) || !exactKeys(data.validation, ['status'])
        || !['NOT_RUN', 'STALE', 'VALID', 'INVALID'].includes(data.validation.status)
        || !exactKeys(data.freshness, ['category', 'attributes', 'content', 'media', 'pricing', 'validation'])
        || !Object.values(data.freshness).every(function (state) { return ['CURRENT', 'STALE'].includes(state); })
        || !Array.isArray(data.blockers) || data.blockers.length > 500
        || !data.blockers.every(function (item) { return record(item) && text(item.code, 200) && text(item.message, 2000)
          && Object.keys(item).every(function (key) { return ['code', 'message', 'fieldPath'].includes(key); })
          && (item.fieldPath === undefined || text(item.fieldPath, 500)); })) throw new Error('invalid editor response');
    }
    if (body.candidateId !== undefined && !text(body.candidateId, 200)) throw new Error('invalid editor response');
    return { state: 'ready', editor: data, replayed: body.replayed === true,
      ...(body.candidateId === undefined ? {} : { candidateId: body.candidateId }) };
  }

  function validAttributeJson(value, depth, budget) {
    if (depth > 8 || ++budget.nodes > 500000) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') { budget.characters += value.length; return value.length <= 20000 && budget.characters <= 5000000; }
    if (Array.isArray(value)) return value.length <= 100 && value.every(function (item) { return validAttributeJson(item, depth + 1, budget); });
    var object = record(value);
    return Boolean(object) && Object.keys(object).length <= 100 && Object.keys(object).every(function (key) {
      return key.length <= 500 && validAttributeJson(object[key], depth + 1, budget);
    });
  }
  function validAttributeWorkspace(data) {
    if (!exactKeys(data, ['schemaRevision', 'fields', 'values']) || !/^[a-f0-9]{64}$/u.test(data.schemaRevision || '')
      || !Array.isArray(data.fields) || data.fields.length > 500 || !Array.isArray(data.values) || data.values.length > 50000) return false;
    var fields = new Map();
    for (var field of data.fields) {
      if (!exactKeys(field, ['attributeId', 'name', 'required', 'valueType', 'cardinality', 'ownership', 'editorMode', 'valuePolicy', 'dictionaryId', 'maxValues'])
        || !Number.isSafeInteger(field.attributeId) || field.attributeId < 1 || fields.has(field.attributeId) || !text(field.name, 1000)
        || typeof field.required !== 'boolean' || !['STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'DATETIME', 'JSON', 'UNKNOWN'].includes(field.valueType)
        || !['SINGLE', 'MULTI'].includes(field.cardinality) || !['SYSTEM', 'SKU', 'MEDIA', 'COMPLIANCE', 'EDITOR'].includes(field.ownership)
        || !['READ_ONLY', 'SKU_MATRIX', 'MEDIA_WORKBENCH', 'MANUAL_REQUIRED', 'EDITABLE'].includes(field.editorMode)
        || !['STRICT_DICTIONARY', 'OPEN_DICTIONARY', 'FREE_TEXT'].includes(field.valuePolicy)
        || !(field.dictionaryId === null || Number.isSafeInteger(field.dictionaryId) && field.dictionaryId > 0)
        || !Number.isSafeInteger(field.maxValues) || field.maxValues < 1 || field.maxValues > 100
        || field.cardinality === 'SINGLE' && field.maxValues !== 1) return false;
      fields.set(field.attributeId, field);
    }
    var values = new Set();
    var budget = { nodes: 0, characters: 0 };
    return data.values.every(function (row) {
      var field = row && fields.get(row.attributeId);
      if (!field || !exactKeys(row, ['attributeId', 'skuKey', 'value', 'dictionaryValueIds', 'reviewed']) || typeof row.reviewed !== 'boolean'
        || (field.ownership === 'SKU' ? !text(row.skuKey, 500) : row.skuKey !== null)
        || !Array.isArray(row.dictionaryValueIds) || row.dictionaryValueIds.length > field.maxValues
        || new Set(row.dictionaryValueIds).size !== row.dictionaryValueIds.length
        || !row.dictionaryValueIds.every(function (id) { return Number.isSafeInteger(id) && id > 0; })
        || !validAttributeJson(row.value, 0, budget)
        || field.cardinality === 'MULTI' && row.value !== null && (!Array.isArray(row.value) || row.value.length > field.maxValues)) return false;
      var key = JSON.stringify([row.attributeId, row.skuKey]);
      if (values.has(key)) return false;
      values.add(key);
      return true;
    });
  }
  function createClient(options) {
    var transport = options && options.transport;
    if (!transport || typeof transport.get !== 'function') {
      throw new TypeError('source workflow transport is required');
    }
    return {
      async readDraftEditor(input) {
        var binding = normalizedSuiteBinding(input);
        var response = await transport.post('/api/extension-device/source-workbench/editor/read', { binding: binding }, { requiredScope: 'listing:review' });
        return editorResult(response, binding);
      },
      async readDraftCatalog(input) {
        var binding = normalizedSuiteBinding(input.binding);
        if (typeof input.query !== 'string' || input.query.length > 100) throw new TypeError('invalid editor query');
        var preview=input.preview;
        if(preview!==undefined&&(!exactKeys(preview,['categoryId','typeId','catalogRevision'])||!Number.isSafeInteger(preview.categoryId)||preview.categoryId<1
          ||!Number.isSafeInteger(preview.typeId)||preview.typeId<1||!text(preview.catalogRevision,200)))throw new TypeError('invalid category preview');
        var response = await transport.post('/api/extension-device/source-workbench/editor/catalog', { binding: binding, query: input.query,
          ...(preview===undefined?{}:{preview:preview}) }, { requiredScope: 'listing:review' });
        if (!response || response.state !== 'response') return response;
        var body = record(response.body);
        var data = body && body.code === 1 && record(body.data);
        if (!data || !text(data.catalogRevision, 200) || !Array.isArray(data.entries) || data.entries.length > 50
          || !data.entries.every(function (entry) { return record(entry) && Number.isSafeInteger(entry.categoryId) && entry.categoryId > 0
            && Number.isSafeInteger(entry.typeId) && entry.typeId > 0 && text(entry.label, 1000); })) throw new Error('invalid catalog response');
        if(typeof data.truncated!=='boolean')throw new Error('invalid catalog response');
        if(data.tree!==undefined){
          var treeNodes=0,treeTypes=0;
          var validTree=function(nodes,depth){return Array.isArray(nodes)&&depth<=32&&nodes.every(function(node){
            if(++treeNodes>5000||!exactKeys(node,['categoryId','label','children','types'])||!Number.isSafeInteger(node.categoryId)||node.categoryId<1||!text(node.label,1000)||!Array.isArray(node.types))return false;
            return node.types.every(function(leaf){return ++treeTypes<=10000&&record(leaf)&&Number.isSafeInteger(leaf.categoryId)&&leaf.categoryId>0&&Number.isSafeInteger(leaf.typeId)&&leaf.typeId>0&&text(leaf.label,1000);})&&validTree(node.children,depth+1);
          });};
          if(!validTree(data.tree,0)||typeof data.treeTruncated!=='boolean')throw new Error('invalid catalog tree');
        }
        if(data.recommendations!==undefined&&(!Array.isArray(data.recommendations)||data.recommendations.length>3
          ||!data.recommendations.every(function(leaf){return record(leaf)&&Number.isSafeInteger(leaf.categoryId)&&leaf.categoryId>0&&Number.isSafeInteger(leaf.typeId)&&leaf.typeId>0&&text(leaf.label,1000)&&['recommended','optional','risky'].includes(leaf.match)&&Array.isArray(leaf.reasons)&&leaf.reasons.length<=10&&leaf.reasons.every(function(reason){return text(reason,1000);});})))throw new Error('invalid category recommendations');
        if(data.attributePreview!==undefined){var workspace={schemaRevision:data.attributePreview.schemaRevision,fields:data.attributePreview.fields,values:[]};
          if(!preview||data.attributePreview.categoryId!==preview.categoryId||data.attributePreview.typeId!==preview.typeId||data.attributePreview.catalogRevision!==preview.catalogRevision||!validAttributeWorkspace(workspace))throw new Error('invalid category attribute preview');}
        return { state: 'ready', catalog: data };
      },
      async readDraftAttributes(input) {
        var binding = normalizedSuiteBinding(input);
        var response = await transport.post('/api/extension-device/source-workbench/editor/attributes', { binding: binding }, { requiredScope: 'listing:review' });
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var body = record(response.body);
        var data = body && body.code === 1 && record(body.data);
        if (!validAttributeWorkspace(data)) throw new Error('invalid attribute workspace response');
        return { state: 'ready', workspace: data };
      },
      async readDraftDictionary(input) {
        if (!exactKeys(input, ['binding', 'schemaRevision', 'attributeId', 'query', 'limit'])
          || !/^[a-f0-9]{64}$/u.test(input.schemaRevision || '') || !Number.isSafeInteger(input.attributeId) || input.attributeId < 1
          || typeof input.query !== 'string' || input.query.length > 200 || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new TypeError('invalid attribute dictionary request');
        var binding = normalizedSuiteBinding(input.binding);
        var response = await transport.post('/api/extension-device/source-workbench/editor/dictionary', {
          binding: binding, schemaRevision: input.schemaRevision, attributeId: input.attributeId, query: input.query, limit: input.limit,
        }, { requiredScope: 'listing:review' });
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var body = record(response.body);
        var data = body && body.code === 1 && record(body.data);
        if (!exactKeys(data, ['schemaRevision', 'attributeId', 'values', 'complete', 'dictionaryComplete', 'resultExhaustive', 'hasMore', 'resultTruncated'])
          || data.schemaRevision !== input.schemaRevision || data.attributeId !== input.attributeId
          || !['complete', 'dictionaryComplete', 'resultExhaustive', 'hasMore', 'resultTruncated'].every(function (key) { return typeof data[key] === 'boolean'; })
          || !Array.isArray(data.values) || data.values.length > input.limit || new Set(data.values.map(function (row) { return row && row.id; })).size !== data.values.length
          || !data.values.every(function (row) { return exactKeys(row, ['id', 'value']) && Number.isSafeInteger(row.id) && row.id > 0 && text(row.value, 20000); })) throw new Error('invalid attribute dictionary response');
        return { state: 'ready', dictionary: data };
      },
      async saveDraftEditor(input) {
        var binding = normalizedSuiteBinding(input.binding);
        if (!['PRICING', 'CATEGORY', 'PACKAGING', 'ATTRIBUTES', 'COPY_CANDIDATE', 'COPY_APPROVE', 'VALIDATE'].includes(input.action) || !text(input.operationKey, 128) || input.operationKey.length < 8) throw new TypeError('invalid editor command');
        if (input.action === 'COPY_CANDIDATE') {
          var value = record(input.value);
          if (!value || !Object.keys(value).length || Object.keys(value).some(function (key) { return !['titleRu', 'descriptionRu'].includes(key); })
            || Object.prototype.hasOwnProperty.call(value, 'titleRu') && (typeof value.titleRu !== 'string' || value.titleRu.length > 500)
            || Object.prototype.hasOwnProperty.call(value, 'descriptionRu') && !(value.descriptionRu === null || typeof value.descriptionRu === 'string' && value.descriptionRu.length <= 10000)) throw new TypeError('invalid editor command');
        }
        if (input.action === 'COPY_APPROVE' && (!exactKeys(input.value, ['candidateId']) || !text(input.value.candidateId, 200))) throw new TypeError('invalid editor command');
        if (input.action === 'VALIDATE' && (!exactKeys(input.value, ['schemaRevision']) || !/^[a-f0-9]{64}$/u.test(input.value.schemaRevision || ''))) throw new TypeError('invalid editor command');
        var response;
        try {
          response = await transport.post('/api/extension-device/source-workbench/editor/save', {
            binding: binding, action: input.action, operationKey: input.operationKey, value: input.value,
          }, { requiredScope: 'listing:write' });
        } catch (error) {
          if (error && error.outcome === 'NOT_SUBMITTED') throw error;
          throw mutationUnknown('保存响应丢失，请核对原操作');
        }
        if (mutationResponseProvesRejection(response)) {
          var body = record(response && response.body);
          var rejection = mutationNotSubmitted(body && text(body.msg, 2000) ? body.msg : 'ERP 已拒绝保存，请修正后再提交');
          if (body && text(body.errorCode, 200)) {
            rejection.serverCode = rejection.code = body.errorCode;
            if (body.errorCode.toLowerCase() === 'ozon_attribute_schema_mismatch') rejection.message = '官方属性字段已更新，请重新读取后填写并保存';
          }
          throw rejection;
        }
        try {
          var result = editorResult(response, binding);
          if (result.state !== 'ready' || input.action === 'COPY_CANDIDATE' && !result.candidateId) throw new Error('invalid editor response');
          return result;
        } catch { throw mutationUnknown('保存回执不完整，请核对原操作'); }
      },
      async createDraft(input) {
        var snapshotId = identifier(input && input.snapshotId, 'snapshotId');
        var supplyGoodsId = identifier(input && input.supplyGoodsId, 'supplyGoodsId');
        var shopId = identifier(input && input.shopId, 'shopId');
        var selectedSkuKeys = Array.isArray(input && input.selectedSkuKeys)
          ? input.selectedSkuKeys.map(function (value) { return identifier(value, 'selectedSkuKey', 500); })
          : [];
        if (!selectedSkuKeys.length || selectedSkuKeys.length > 100) {
          throw new TypeError('selectedSkuKeys is invalid');
        }
        var response = await transport.post(
          '/api/extension-device/source-workbench/drafts',
          { snapshotId: snapshotId, supplyGoodsId: supplyGoodsId, shopId: shopId, selectedSkuKeys: selectedSkuKeys },
          { requiredScope: 'listing:write' },
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var data = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!data || !validListingItem(data) || data.shopId !== shopId) {
          throw new Error('invalid source listing draft response');
        }
        return { state: 'created', draft: data };
      },
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
      async getAiImageSuite(input) {
        var binding = normalizedSuiteBinding(input);
        var query = new URLSearchParams({
          snapshotId: binding.snapshotId,
          supplyGoodsId: binding.supplyGoodsId,
          shopId: binding.shopId,
          listingWorkflowId: binding.listingWorkflowId,
          draftRevision: String(binding.draftRevision),
          draftVersion: String(binding.draftVersion),
        });
        var response = await transport.get(
          '/api/extension-device/source-workbench/ai-image-suite?' + query.toString(),
          { requiredScope: 'listing:review' },
        );
        if (!response || response.state !== 'response') return response || { state: 'unavailable' };
        var envelope = record(response.body);
        var projection = envelope && envelope.code === 1 ? record(envelope.data) : null;
        if (!validAiImageSuiteProjection(projection, binding)) {
          throw new Error('invalid AI image suite projection response');
        }
        return { state: 'ready', projection: projection };
      },
      async executeAiImageSuiteCommand(input) {
        var projection = input && input.projection;
        var built = buildSuiteCommand(input);
        var context = projection.context;
        var idempotencyKey = await stableOperationKey(
          canonicalSuiteCommandValue(built.command),
          '',
        );
        var envelope = {
          shopId: context.shopId,
          workflowId: context.listingWorkflowId,
          draftVersion: context.draftVersion,
          idempotencyKey: idempotencyKey,
          command: built.command,
        };
        var requiredScope = built.operation === 'MEDIA_EXECUTE'
          ? 'media:execute'
          : built.operation === 'MEDIA_REVIEW' ? 'listing:review' : 'listing:write';
        var completed = await executeGrantedMediaMutation(
          transport,
          built.operation,
          requiredScope,
          envelope,
          'AI image suite',
        );
        if (!validSuiteCommandResult(completed.result, built)) {
          throw mutationUnknown('AI image suite command result is invalid');
        }
        return {
          state: 'completed',
          replay: completed.executedData.replay === true,
          action: built.command.action,
        };
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
          ...(input.target !== undefined ? { target: normalizedMediaTarget(input.target) } : {}),
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
    createAiImageSuiteIntentWitness: createAiImageSuiteIntentWitness,
    matchesAiImageSuiteIntentWitness: matchesAiImageSuiteIntentWitness,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
