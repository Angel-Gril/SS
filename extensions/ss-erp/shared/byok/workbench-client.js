(function exposeByokWorkbenchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-client/v1';
  var PREVIEW_VERSION = 'extension-byok-workbench-preview-channel/v1';
  var MEDIA_CHANNEL_VERSION = 'extension-byok-workbench-media-channel/v1';
  var EDIT_CONTROLLER_VERSION = 'extension-byok-workbench-edit-controller/v1';
  var DEFAULT_TIMEOUT_MS = 30 * 1000;
  var PROVIDER_TIMEOUT_MS = 315 * 1000;
  var INGEST_TIMEOUT_MS = 130 * 1000;
  var PUBLISH_TIMEOUT_MS = 160 * 1000;
  var DEVICE_INVALIDATED_MESSAGE = 'ss-erp:byok-device-session-invalidated';
  var PUBLIC_READINESS_REASON_CODES = new Set([
    'POLICY_DISABLED',
    'OWNER_NOT_ALLOWED',
    'SHOP_NOT_ALLOWED',
    'DEVICE_NOT_ALLOWED',
    'ORIGIN_NOT_ALLOWED',
    'OPERATION_NOT_ALLOWED',
    'GENERATION_DISABLED',
  ]);
  var PUBLIC_READINESS_ERROR_CODES = new Set([
    'byok_readiness_request_invalid',
    'byok_readiness_scope_denied',
    'byok_readiness_shop_denied',
    'byok_readiness_draft_stale',
    'byok_readiness_target_stale',
    'byok_readiness_not_ready',
    'byok_readiness_unavailable',
  ]);
  var PUBLIC_READINESS_STATES = new Set([
    'response',
    'unpaired',
    'authorization_required',
    'invalid_response',
  ]);
  var MESSAGE_TYPES = Object.freeze({
    GET_PUBLIC_STATE: 'ss-erp:ai-image-workbench-state',
    GET_READINESS: 'ss-erp:ai-image-workbench-readiness',
    EXECUTE_PROVIDER: 'ss-erp:ai-image-workbench-provider-execute',
    OPEN_PREVIEW: 'ss-erp:ai-image-workbench-preview-open',
    REVIEW_RESULT: 'ss-erp:ai-image-workbench-result-review',
    INGEST: 'ss-erp:ai-image-workbench-ingest',
    RECOVER_INGEST: 'ss-erp:ai-image-workbench-ingest-recover',
    PUBLISH: 'ss-erp:ai-image-workbench-publish',
    EDIT_MEDIA_PREPARE: 'ss-erp:ai-image-workbench-edit-media-prepare',
    EDIT_MEDIA_RELEASE: 'ss-erp:ai-image-workbench-edit-media-release',
    EDIT_STATE: 'ss-erp:ai-image-workbench-edit-state',
    EDIT_REFERENCES: 'ss-erp:ai-image-workbench-edit-references',
    EDIT_START: 'ss-erp:ai-image-workbench-edit-start',
    EDIT_SELECT: 'ss-erp:ai-image-workbench-edit-select',
    EDIT_REGENERATE: 'ss-erp:ai-image-workbench-edit-regenerate',
    EDIT_PREVIEW: 'ss-erp:ai-image-workbench-edit-preview',
    EDIT_CLEANUP: 'ss-erp:ai-image-workbench-edit-cleanup',
  });

  function clientError(code, details) {
    var error = new Error(code);
    error.code = code;
    if (details && PUBLIC_READINESS_REASON_CODES.has(details.reasonCode)) {
      error.reasonCode = details.reasonCode;
    }
    if (details && PUBLIC_READINESS_ERROR_CODES.has(details.readinessErrorCode)) {
      error.readinessErrorCode = details.readinessErrorCode;
    }
    if (details && PUBLIC_READINESS_STATES.has(details.readinessState)) {
      error.readinessState = details.readinessState;
    }
    if (details && Number.isSafeInteger(details.readinessStatus)
      && details.readinessStatus >= 100 && details.readinessStatus <= 599) {
      error.readinessStatus = details.readinessStatus;
    }
    return error;
  }

  function projectedReadinessDetails(value) {
    if (!isRecord(value)) return null;
    var details = {};
    if (PUBLIC_READINESS_REASON_CODES.has(value.reasonCode)) details.reasonCode = value.reasonCode;
    if (PUBLIC_READINESS_ERROR_CODES.has(value.readinessErrorCode)) {
      details.readinessErrorCode = value.readinessErrorCode;
    }
    if (PUBLIC_READINESS_STATES.has(value.readinessState)) {
      details.readinessState = value.readinessState;
    }
    var status = Number(value.readinessStatus);
    if (Number.isSafeInteger(status) && status >= 100 && status <= 599) {
      details.readinessStatus = status;
    }
    return Object.keys(details).length ? details : null;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function text(value, minimum, maximum, code) {
    if (typeof value !== 'string') throw clientError(code);
    var normalized = value.normalize('NFKC').trim();
    if (normalized !== value || normalized.length < minimum || normalized.length > maximum
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
      throw clientError(code);
    }
    return normalized;
  }

  function profileId(value) {
    var result = text(value, 1, 128, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(result)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return result;
  }

  function resultId(value) {
    var result = text(value, 4, 128, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^br_[a-f0-9]{48}$/u.test(result)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return result;
  }

  function size(value) {
    var normalized = text(value, 3, 16, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^\d{1,4}x\d{1,4}$/u.test(normalized)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    var dimensions = normalized.split('x').map(Number);
    if (dimensions.some(function (item) { return item < 1 || item > 4096; })
      || dimensions[0] * dimensions[1] > 4096 * 4096) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return normalized;
  }

  function mediaPurpose(value) {
    if (!['REFERENCE', 'SOURCE', 'MASK'].includes(value)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return value;
  }

  function mediaHandle(value) {
    var result = text(value, 4, 128, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^mh_[a-f0-9]{48}$/u.test(result)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return result;
  }

  function attemptId(value) {
    var result = text(value, 4, 128, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    if (!/^attempt-\d{6}$/u.test(result)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    return result;
  }

  function editCommand(value, regeneration) {
    var baseKeys = [
      'profileId', 'operation', 'prompt', 'negativePrompt', 'size', 'sourceHandle',
      'maskHandle',
    ];
    var keys = regeneration
      ? baseKeys.concat(['expectedSlotRevision', 'chargeAcknowledgement'])
      : baseKeys;
    if (!exactKeys(value, keys)
      || !['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(value.operation)) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    var source = value.sourceHandle === null ? null : mediaHandle(value.sourceHandle);
    var mask = value.maskHandle === null ? null : mediaHandle(value.maskHandle);
    if ((value.operation === 'IMAGE_TO_IMAGE' && (source !== null || mask !== null))
      || (value.operation === 'FULL_EDIT' && (source === null || mask !== null))
      || (value.operation === 'INPAINT' && (source === null || mask === null))) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    var normalized = {
      profileId: profileId(value.profileId),
      operation: value.operation,
      prompt: text(value.prompt, 1, 8000, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID'),
      negativePrompt: value.negativePrompt == null || value.negativePrompt === ''
        ? null
        : text(value.negativePrompt, 1, 4000, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID'),
      size: size(value.size),
      sourceHandle: source,
      maskHandle: mask,
    };
    if (regeneration) {
      if (!Number.isSafeInteger(value.expectedSlotRevision) || value.expectedSlotRevision < 1
        || !exactKeys(value.chargeAcknowledgement, ['warningVersion', 'confirmed'])
        || value.chargeAcknowledgement.warningVersion !== 'external-provider-charge/v1'
        || value.chargeAcknowledgement.confirmed !== true) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
      }
      normalized.expectedSlotRevision = value.expectedSlotRevision;
      normalized.chargeAcknowledgement = {
        warningVersion: 'external-provider-charge/v1',
        confirmed: true,
      };
    }
    return normalized;
  }

  function readiness(value) {
    if (!exactKeys(value, ['readinessHandle', 'readinessBinding', 'expiresAt'])
      || !isRecord(value.readinessBinding)
      || value.readinessBinding.contractVersion !== 'extension-byok-readiness-binding/v2') {
      throw clientError('SS_ERP_BYOK_WORKBENCH_READINESS_INVALID');
    }
    var handle = text(
      value.readinessHandle,
      4,
      128,
      'SS_ERP_BYOK_WORKBENCH_READINESS_INVALID',
    );
    var expiresAt = text(value.expiresAt, 20, 64, 'SS_ERP_BYOK_WORKBENCH_READINESS_INVALID');
    if (!/^rh_[a-f0-9]{48}$/u.test(handle) || !Number.isFinite(Date.parse(expiresAt))) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_READINESS_INVALID');
    }
    return {
      readinessHandle: handle,
      readinessBinding: value.readinessBinding,
      expiresAt: expiresAt,
    };
  }

  function normalizeGenerate(value) {
    if (!exactKeys(value, [
      'profileId', 'prompt', 'negativePrompt', 'size', 'idempotencyKey', 'readiness',
    ])) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    }
    var negativePrompt = value.negativePrompt == null || value.negativePrompt === ''
      ? null
      : text(value.negativePrompt, 1, 4000, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
    return {
      profileId: profileId(value.profileId),
      prompt: text(value.prompt, 1, 8000, 'SS_ERP_BYOK_WORKBENCH_INPUT_INVALID'),
      negativePrompt: negativePrompt,
      size: size(value.size),
      idempotencyKey: profileId(value.idempotencyKey),
      readiness: readiness(value.readiness),
    };
  }

  function workspacePublishRequest(value) {
    var code = 'SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID';
    if (!exactKeys(value, ['executionMode', 'binding', 'selectedMedia'])
      || !['ERP_HOSTED', 'BYOK'].includes(value.executionMode)
      || !exactKeys(value.binding, ['shopId', 'workflowId', 'draftRevision', 'draftVersion'])
      || !Number.isSafeInteger(value.binding.draftRevision) || value.binding.draftRevision < 1
      || !Number.isSafeInteger(value.binding.draftVersion) || value.binding.draftVersion < 1
      || !Array.isArray(value.selectedMedia)
      || value.selectedMedia.length < 1 || value.selectedMedia.length > 500) {
      throw clientError(code);
    }
    var slots = new Set();
    var assets = new Set();
    var rows = value.selectedMedia.map(function (row) {
      if (!exactKeys(row, ['scope', 'skuKey', 'slotKey', 'assetId'])
        || !['PRODUCT', 'SKU'].includes(row.scope)
        || (row.scope === 'PRODUCT' && row.skuKey !== null)
        || (row.scope === 'SKU' && typeof row.skuKey !== 'string')) {
        throw clientError(code);
      }
      var skuKey = row.scope === 'PRODUCT'
        ? null : text(row.skuKey, 1, 500, code);
      var slotKey = text(row.slotKey, 1, 200, code);
      var assetId = text(row.assetId, 1, 500, code);
      if (slots.has(slotKey) || assets.has(assetId)) throw clientError(code);
      slots.add(slotKey);
      assets.add(assetId);
      return {
        scope: row.scope,
        skuKey: skuKey,
        slotKey: slotKey,
        assetId: assetId,
      };
    });
    return {
      executionMode: value.executionMode,
      binding: {
        shopId: text(value.binding.shopId, 1, 200, code),
        workflowId: text(value.binding.workflowId, 1, 200, code),
        draftRevision: value.binding.draftRevision,
        draftVersion: value.binding.draftVersion,
      },
      selectedMedia: rows,
    };
  }

  function publishPreviewHash(value) {
    var normalized = text(value, 64, 64, 'SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID');
    if (!/^[a-f0-9]{64}$/u.test(normalized)) {
      throw clientError('SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID');
    }
    return normalized;
  }

  function createClient(options) {
    var runtime = options && options.runtime || global.chrome && global.chrome.runtime;
    var Channel = options && options.BroadcastChannel || global.BroadcastChannel;
    var urlApi = options && options.URL || global.URL;
    var now = options && typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var timeoutMs = Number(options && options.timeoutMs) || DEFAULT_TIMEOUT_MS;
    if (!runtime || typeof runtime.sendMessage !== 'function'
      || typeof Channel !== 'function'
      || !urlApi || typeof urlApi.createObjectURL !== 'function'
      || typeof urlApi.revokeObjectURL !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) {
      throw clientError('SS_ERP_BYOK_WORKBENCH_DEPENDENCY_UNAVAILABLE');
    }

    function send(type, payload, readinessValue, operationTimeoutMs) {
      var message = { type: type, payload: payload || {} };
      var ingestOutcomeUnknown = type === MESSAGE_TYPES.INGEST
        || type === MESSAGE_TYPES.RECOVER_INGEST;
      var publishOutcomeUnknown = type === MESSAGE_TYPES.PUBLISH
        && payload && ['CONFIRM', 'RECOVER', 'WORKSPACE_CONFIRM', 'WORKSPACE_RECOVER']
          .includes(payload.action);
      if (readinessValue) {
        var normalized = readiness(readinessValue);
        message.readinessHandle = normalized.readinessHandle;
        message.readinessBinding = normalized.readinessBinding;
      }
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(clientError(
            type === MESSAGE_TYPES.EXECUTE_PROVIDER
              ? 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
              : ingestOutcomeUnknown
                ? 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
                : publishOutcomeUnknown
                  ? 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
                : 'SS_ERP_BYOK_WORKBENCH_RUNTIME_TIMEOUT',
          ));
        }, operationTimeoutMs || timeoutMs);
        function finish(callback, value) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          callback(value);
        }
        try {
          runtime.sendMessage(message, function (response) {
            if (runtime.lastError) {
              finish(reject, clientError(
                type === MESSAGE_TYPES.EXECUTE_PROVIDER
                  ? 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
                  : ingestOutcomeUnknown
                    ? 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
                    : publishOutcomeUnknown
                      ? 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
                    : 'SS_ERP_BYOK_WORKBENCH_RUNTIME_FAILED',
              ));
              return;
            }
            if (!isRecord(response) || response.ok !== true
              || !Object.prototype.hasOwnProperty.call(response, 'data')) {
              var code = isRecord(response) && typeof response.errorCode === 'string'
                && /^[A-Z][A-Z0-9_]{0,99}$/u.test(response.errorCode)
                ? response.errorCode
                : ingestOutcomeUnknown
                  ? 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
                  : publishOutcomeUnknown
                    ? 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
                  : 'SS_ERP_BYOK_WORKBENCH_OPERATION_FAILED';
              finish(reject, clientError(code, projectedReadinessDetails(response)));
              return;
            }
            finish(resolve, response.data);
          });
        } catch (_error) {
          finish(reject, clientError(
            type === MESSAGE_TYPES.EXECUTE_PROVIDER
              ? 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
              : ingestOutcomeUnknown
                ? 'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'
                : publishOutcomeUnknown
                  ? 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME'
                : 'SS_ERP_BYOK_WORKBENCH_RUNTIME_FAILED',
          ));
        }
      });
    }

    function previewTicket(value) {
      if (!exactKeys(value, [
        'contractVersion', 'channelName', 'previewTicket', 'expiresAt', 'metadata',
      ]) || value.contractVersion !== PREVIEW_VERSION || !exactKeys(value.metadata, [
        'mimeType', 'byteLength', 'sha256',
      ])) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      }
      var channelName = text(value.channelName, 1, 128, 'SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      var ticket = text(value.previewTicket, 4, 128, 'SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      var expiresAt = text(value.expiresAt, 20, 64, 'SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      var current = new Date(now()).getTime();
      var expires = Date.parse(expiresAt);
      var mimeType = text(value.metadata.mimeType, 1, 32, 'SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      var sha256 = text(value.metadata.sha256, 64, 64, 'SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      if (!/^ss-erp:byok-preview:[a-f0-9]{48}$/u.test(channelName)
        || !/^pt_[a-f0-9]{48}$/u.test(ticket)
        || !Number.isFinite(current) || !Number.isFinite(expires)
        || expires <= current || expires - current > 30 * 1000
        || !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)
        || !Number.isSafeInteger(value.metadata.byteLength)
        || value.metadata.byteLength < 1 || value.metadata.byteLength > 20 * 1024 * 1024
        || !/^[a-f0-9]{64}$/u.test(sha256)) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID');
      }
      return {
        channelName: channelName,
        previewTicket: ticket,
        expiresAt: expiresAt,
        metadata: {
          mimeType: mimeType,
          byteLength: value.metadata.byteLength,
          sha256: sha256,
        },
      };
    }

    function mediaTicket(value, expectedPurpose) {
      if (!exactKeys(value, [
        'contractVersion', 'channelName', 'uploadTicket', 'purpose', 'expiresAt',
      ]) || value.contractVersion !== MEDIA_CHANNEL_VERSION
        || value.purpose !== expectedPurpose) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_INVALID');
      }
      var channelName = text(
        value.channelName,
        1,
        128,
        'SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_INVALID',
      );
      var uploadTicket = text(
        value.uploadTicket,
        4,
        128,
        'SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_INVALID',
      );
      var expiresAt = text(
        value.expiresAt,
        20,
        64,
        'SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_INVALID',
      );
      var current = new Date(now()).getTime();
      var expires = Date.parse(expiresAt);
      if (!/^ss-erp:byok-media-upload:[a-f0-9]{48}$/u.test(channelName)
        || !/^ut_[a-f0-9]{48}$/u.test(uploadTicket)
        || !Number.isFinite(current) || !Number.isFinite(expires)
        || expires <= current || expires - current > 30 * 1000) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_INVALID');
      }
      return {
        channelName: channelName,
        uploadTicket: uploadTicket,
        purpose: expectedPurpose,
        expiresAt: expiresAt,
      };
    }

    function mediaMetadata(value, purpose, sourceBlob) {
      if (!exactKeys(value, ['mimeType', 'byteLength', 'width', 'height', 'sha256'])) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED');
      }
      var allowedMimeTypes = purpose === 'MASK'
        ? ['image/png']
        : ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowedMimeTypes.includes(value.mimeType)
        || value.mimeType !== sourceBlob.type
        || !Number.isSafeInteger(value.byteLength) || value.byteLength !== sourceBlob.size
        || value.byteLength < 1 || value.byteLength > 20 * 1024 * 1024
        || !Number.isSafeInteger(value.width) || value.width < 1 || value.width > 4096
        || !Number.isSafeInteger(value.height) || value.height < 1 || value.height > 4096
        || !Number.isSafeInteger(value.width * value.height)
        || value.width * value.height > 4096 * 4096
        || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED');
      }
      return Object.freeze({
        mimeType: value.mimeType,
        byteLength: value.byteLength,
        width: value.width,
        height: value.height,
        sha256: value.sha256,
      });
    }

    function editSnapshot(value) {
      var keys = [
        'contractVersion', 'executionMode', 'slotKey', 'profileId', 'operation',
        'references', 'operationAvailability', 'scheduler', 'slot', 'alternatives',
      ];
      if (!exactKeys(value, keys)
        || value.contractVersion !== EDIT_CONTROLLER_VERSION
        || value.executionMode !== 'BYOK'
        || !isRecord(value.references) || !isRecord(value.scheduler) || !isRecord(value.slot)
        || !Array.isArray(value.operationAvailability) || !Array.isArray(value.alternatives)) {
        throw clientError('SS_ERP_BYOK_WORKBENCH_EDIT_STATE_INVALID');
      }
      return value;
    }

    function openPreviewWithType(messageType, resultIdValue) {
      var id = resultId(resultIdValue);
      return send(messageType, { resultId: id }).then(previewTicket).then(function (prepared) {
        return new Promise(function (resolve, reject) {
          var channel = new Channel(prepared.channelName);
          var settled = false;
          var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            channel.close();
            reject(clientError('SS_ERP_BYOK_WORKBENCH_PREVIEW_TIMEOUT'));
          }, Math.max(1, Date.parse(prepared.expiresAt) - new Date(now()).getTime()));
          function fail() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            channel.close();
            reject(clientError('SS_ERP_BYOK_WORKBENCH_PREVIEW_INVALID'));
          }
          channel.onmessage = function (event) {
            var message = event && event.data;
            if (!exactKeys(message, [
              'contractVersion', 'type', 'previewTicket', 'image', 'metadata',
            ]) || message.contractVersion !== PREVIEW_VERSION || message.type !== 'PREVIEW'
              || message.previewTicket !== prepared.previewTicket
              || !exactKeys(message.metadata, ['mimeType', 'byteLength', 'sha256'])
              || typeof Blob === 'undefined' || !(message.image instanceof Blob)
              || message.image.type !== prepared.metadata.mimeType
              || message.image.size !== prepared.metadata.byteLength
              || message.metadata.mimeType !== prepared.metadata.mimeType
              || message.metadata.byteLength !== prepared.metadata.byteLength
              || message.metadata.sha256 !== prepared.metadata.sha256) {
              fail();
              return;
            }
            settled = true;
            clearTimeout(timer);
            channel.close();
            var objectUrl = urlApi.createObjectURL(message.image);
            var revoked = false;
            resolve(Object.freeze({
              objectUrl: objectUrl,
              metadata: Object.freeze({ ...prepared.metadata }),
              revoke: function () {
                if (revoked) return;
                revoked = true;
                urlApi.revokeObjectURL(objectUrl);
              },
            }));
          };
          try {
            channel.postMessage({ type: 'READY', previewTicket: prepared.previewTicket });
          } catch (_error) {
            fail();
          }
        });
      });
    }

    function uploadEditMedia(purposeValue, blob) {
      var purpose;
      try {
        purpose = mediaPurpose(purposeValue);
        if (typeof Blob === 'undefined' || !(blob instanceof Blob)
          || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > 20 * 1024 * 1024) {
          throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
        }
      } catch (error) {
        return Promise.reject(error);
      }
      return send(MESSAGE_TYPES.EDIT_MEDIA_PREPARE, { purpose: purpose })
        .then(function (value) { return mediaTicket(value, purpose); })
        .then(function (prepared) {
          return new Promise(function (resolve, reject) {
            var channel = new Channel(prepared.channelName);
            var settled = false;
            var timer = setTimeout(function () {
              if (settled) return;
              settled = true;
              channel.close();
              reject(clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_TICKET_EXPIRED'));
            }, Math.max(1, Date.parse(prepared.expiresAt) - new Date(now()).getTime()));
            function finish(callback, value) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              channel.close();
              callback(value);
            }
            channel.onmessage = function (event) {
              var message = event && event.data;
              if (!isRecord(message) || message.contractVersion !== MEDIA_CHANNEL_VERSION
                || message.uploadTicket !== prepared.uploadTicket) {
                finish(reject, clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED'));
                return;
              }
              if (message.type === 'REJECTED') {
                if (!exactKeys(message, [
                  'contractVersion', 'type', 'uploadTicket', 'errorCode',
                ])) {
                  finish(reject, clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED'));
                  return;
                }
                var errorCode = typeof message.errorCode === 'string'
                  && /^[A-Z][A-Z0-9_]{0,99}$/u.test(message.errorCode)
                  ? message.errorCode
                  : 'SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED';
                finish(reject, clientError(errorCode));
                return;
              }
              if (!exactKeys(message, [
                'contractVersion', 'type', 'uploadTicket', 'mediaHandle', 'purpose', 'metadata',
              ]) || message.type !== 'ACCEPTED' || message.purpose !== purpose
                || !isRecord(message.metadata)) {
                finish(reject, clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED'));
                return;
              }
              var handle;
              var metadata;
              try {
                handle = mediaHandle(message.mediaHandle);
                metadata = mediaMetadata(message.metadata, purpose, blob);
              } catch (error) {
                finish(reject, error);
                return;
              }
              finish(resolve, Object.freeze({
                mediaHandle: handle,
                purpose: purpose,
                metadata: metadata,
              }));
            };
            try {
              channel.postMessage({
                contractVersion: MEDIA_CHANNEL_VERSION,
                type: 'UPLOAD',
                uploadTicket: prepared.uploadTicket,
                purpose: purpose,
                image: blob,
              });
            } catch (_error) {
              finish(reject, clientError('SS_ERP_BYOK_WORKBENCH_MEDIA_REJECTED'));
            }
          });
        });
    }

    return Object.freeze({
      getPublicState: function () {
        return send(MESSAGE_TYPES.GET_PUBLIC_STATE, {});
      },
      getReadiness: function (profileIdValue) {
        return send(MESSAGE_TYPES.GET_READINESS, { profileId: profileId(profileIdValue) })
          .then(readiness);
      },
      generate: function (value) {
        var input = normalizeGenerate(value);
        return send(MESSAGE_TYPES.EXECUTE_PROVIDER, {
          profileId: input.profileId,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          size: input.size,
          idempotencyKey: input.idempotencyKey,
        }, input.readiness, PROVIDER_TIMEOUT_MS);
      },
      openPreview: function (resultIdValue) {
        return openPreviewWithType(MESSAGE_TYPES.OPEN_PREVIEW, resultIdValue);
      },
      reviewResult: function (resultIdValue, decision) {
        if (decision !== 'APPROVE' && decision !== 'REJECT') {
          return Promise.reject(clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID'));
        }
        return send(MESSAGE_TYPES.REVIEW_RESULT, {
          resultId: resultId(resultIdValue),
          decision: decision,
        });
      },
      ingestApproved: function (resultIdValue) {
        return send(
          MESSAGE_TYPES.INGEST,
          { resultId: resultId(resultIdValue) },
          null,
          INGEST_TIMEOUT_MS,
        );
      },
      recoverApprovedIngest: function (resultIdValue) {
        return send(
          MESSAGE_TYPES.RECOVER_INGEST,
          { resultId: resultId(resultIdValue) },
          null,
          INGEST_TIMEOUT_MS,
        );
      },
      getPublishPreview: function () {
        return send(MESSAGE_TYPES.PUBLISH, { action: 'PREVIEW' });
      },
      confirmPublish: function (previewHashValue) {
        var previewHash;
        try {
          previewHash = text(
            previewHashValue,
            64,
            64,
            'SS_ERP_BYOK_PUBLISH_INPUT_INVALID',
          );
          if (!/^[a-f0-9]{64}$/u.test(previewHash)) {
            throw clientError('SS_ERP_BYOK_PUBLISH_INPUT_INVALID');
          }
        } catch (error) {
          return Promise.reject(error);
        }
        return send(
          MESSAGE_TYPES.PUBLISH,
          { action: 'CONFIRM', previewHash: previewHash },
          null,
          PUBLISH_TIMEOUT_MS,
        );
      },
      recoverPublish: function () {
        return send(
          MESSAGE_TYPES.PUBLISH,
          { action: 'RECOVER' },
          null,
          PUBLISH_TIMEOUT_MS,
        );
      },
      getWorkspacePublishPreview: function (value) {
        try {
          return send(MESSAGE_TYPES.PUBLISH, {
            action: 'WORKSPACE_PREVIEW',
            request: workspacePublishRequest(value),
          });
        } catch (error) {
          return Promise.reject(error);
        }
      },
      getWorkspacePublishState: function (value) {
        try {
          return send(MESSAGE_TYPES.PUBLISH, {
            action: 'WORKSPACE_STATE',
            request: workspacePublishRequest(value),
          });
        } catch (error) {
          return Promise.reject(error);
        }
      },
      confirmWorkspacePublish: function (value, previewHashValue) {
        try {
          return send(
            MESSAGE_TYPES.PUBLISH,
            {
              action: 'WORKSPACE_CONFIRM',
              request: workspacePublishRequest(value),
              previewHash: publishPreviewHash(previewHashValue),
            },
            null,
            PUBLISH_TIMEOUT_MS,
          );
        } catch (error) {
          return Promise.reject(error);
        }
      },
      recoverWorkspacePublish: function (value) {
        try {
          return send(
            MESSAGE_TYPES.PUBLISH,
            {
              action: 'WORKSPACE_RECOVER',
              request: workspacePublishRequest(value),
            },
            null,
            PUBLISH_TIMEOUT_MS,
          );
        } catch (error) {
          return Promise.reject(error);
        }
      },
      getActiveWorkspacePublish: function () {
        return send(MESSAGE_TYPES.PUBLISH, { action: 'WORKSPACE_ACTIVE' });
      },
      uploadEditMedia: uploadEditMedia,
      releaseEditMedia: function (mediaHandleValue, purposeValue) {
        try {
          return send(MESSAGE_TYPES.EDIT_MEDIA_RELEASE, {
            mediaHandle: mediaHandle(mediaHandleValue),
            purpose: mediaPurpose(purposeValue),
          });
        } catch (error) {
          return Promise.reject(error);
        }
      },
      setEditReferences: function (value) {
        try {
          if (!isRecord(value) || !['SESSION_GLOBAL', 'SLOT'].includes(value.scope)
            || !Object.prototype.hasOwnProperty.call(value, 'handles')
            || Object.keys(value).some(function (key) {
              return !['scope', 'handles'].includes(key);
            })) {
            throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
          }
          var handles = value.handles === null
            ? null
            : Array.isArray(value.handles)
              ? value.handles.map(mediaHandle)
              : null;
          if ((value.handles !== null && !Array.isArray(value.handles))
            || (value.scope === 'SESSION_GLOBAL' && handles === null)
            || (handles && handles.length > 4)
            || (handles && new Set(handles).size !== handles.length)) {
            throw clientError('SS_ERP_BYOK_WORKBENCH_INPUT_INVALID');
          }
          return send(MESSAGE_TYPES.EDIT_REFERENCES, {
            scope: value.scope,
            handles: handles,
          }).then(editSnapshot);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      getEditState: function () {
        return send(MESSAGE_TYPES.EDIT_STATE, {}).then(editSnapshot);
      },
      startEdit: function (value) {
        try {
          return send(MESSAGE_TYPES.EDIT_START, editCommand(value, false)).then(editSnapshot);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      selectEditAlternative: function (attemptIdValue) {
        try {
          return send(MESSAGE_TYPES.EDIT_SELECT, {
            attemptId: attemptId(attemptIdValue),
          }).then(editSnapshot);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      regenerateEdit: function (value) {
        try {
          return send(MESSAGE_TYPES.EDIT_REGENERATE, editCommand(value, true))
            .then(editSnapshot);
        } catch (error) {
          return Promise.reject(error);
        }
      },
      openEditPreview: function (resultIdValue) {
        return openPreviewWithType(MESSAGE_TYPES.EDIT_PREVIEW, resultIdValue);
      },
      cleanupEditSession: function () {
        return send(MESSAGE_TYPES.EDIT_CLEANUP, {});
      },
      acknowledgeEditRestart: function () {
        return send(MESSAGE_TYPES.EDIT_CLEANUP, {
          restartAcknowledgement: {
            warningVersion: 'external-provider-charge/v1',
            confirmed: true,
          },
        });
      },
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DEVICE_INVALIDATED_MESSAGE: DEVICE_INVALIDATED_MESSAGE,
    MESSAGE_TYPES: MESSAGE_TYPES,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
