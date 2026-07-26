(function exposeByokWorkbenchClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-client/v1';
  var PREVIEW_VERSION = 'extension-byok-workbench-preview-channel/v1';
  var DEFAULT_TIMEOUT_MS = 30 * 1000;
  var PROVIDER_TIMEOUT_MS = 130 * 1000;
  var INGEST_TIMEOUT_MS = 130 * 1000;
  var PUBLISH_TIMEOUT_MS = 130 * 1000;
  var DEVICE_INVALIDATED_MESSAGE = 'ss-erp:byok-device-session-invalidated';
  var MESSAGE_TYPES = Object.freeze({
    GET_PUBLIC_STATE: 'ss-erp:ai-image-workbench-state',
    GET_READINESS: 'ss-erp:ai-image-workbench-readiness',
    EXECUTE_PROVIDER: 'ss-erp:ai-image-workbench-provider-execute',
    OPEN_PREVIEW: 'ss-erp:ai-image-workbench-preview-open',
    REVIEW_RESULT: 'ss-erp:ai-image-workbench-result-review',
    INGEST: 'ss-erp:ai-image-workbench-ingest',
    RECOVER_INGEST: 'ss-erp:ai-image-workbench-ingest-recover',
    PUBLISH: 'ss-erp:ai-image-workbench-publish',
  });

  function clientError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
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
        && payload && payload.action !== 'PREVIEW';
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
              finish(reject, clientError(code));
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
      openPreview: async function (resultIdValue) {
        var id = resultId(resultIdValue);
        var prepared = previewTicket(await send(MESSAGE_TYPES.OPEN_PREVIEW, { resultId: id }));
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
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DEVICE_INVALIDATED_MESSAGE: DEVICE_INVALIDATED_MESSAGE,
    MESSAGE_TYPES: MESSAGE_TYPES,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
