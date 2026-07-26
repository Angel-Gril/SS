(function exposeByokImageEditAdapters(global) {
  'use strict';

  var workbench = global.SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT;
  if (!workbench || !workbench.LIMITS) {
    throw new Error('SS_ERP_AI_IMAGE_WORKBENCH_CONTRACT is required');
  }

  var CONTRACT_VERSION = 'extension-byok-image-edit-adapters/v1';
  var OPENAI_MULTIPART_SYNC_V1 = 'openai-images-edits-multipart-sync/v1';
  var EXPLICIT_ASYNC_TASK_V1 = 'ss-erp-images-edits-explicit-async-task/v1';
  var ASYNC_TASK_CONTRACT_VERSION = 'extension-byok-image-edit-async-task/v1';
  var MASK_SEMANTICS = 'TRANSPARENT_EDIT_OPAQUE_PRESERVE_V1';
  var EDIT_OPERATIONS = Object.freeze(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']);
  var IMAGE_MIME_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
  var ASYNC_TASK_STATES = Object.freeze(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
  var MAX_MODEL_CHARACTERS = 200;
  var MAX_RESULT_URL_CHARACTERS = 8192;
  var MULTIPART_FIXED_OVERHEAD_BYTES = 64 * 1024;
  var MULTIPART_PART_OVERHEAD_BYTES = 1024;

  function adapterError(code, message) {
    var result = new Error(message || code);
    result.name = 'ExtensionByokImageEditAdapterError';
    result.code = code;
    return result;
  }

  function requestError() {
    return adapterError(
      'SS_ERP_BYOK_IMAGE_EDIT_REQUEST_INVALID',
      'BYOK image edit request is invalid',
    );
  }

  function responseError() {
    return adapterError(
      'SS_ERP_BYOK_IMAGE_EDIT_RESPONSE_INVALID',
      'BYOK image edit response is invalid',
    );
  }

  function taskError() {
    return adapterError(
      'SS_ERP_BYOK_IMAGE_EDIT_TASK_INVALID',
      'BYOK image edit task response is invalid',
    );
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function allowedKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function text(value, maximum) {
    if (typeof value !== 'string') throw requestError();
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw requestError();
    }
    return normalized;
  }

  function prompt(value, maximum, nullable) {
    if (nullable && value === null) return null;
    if (typeof value !== 'string') throw requestError();
    var normalized = value.trim();
    if (!normalized || normalized.length > maximum) throw requestError();
    for (var index = 0; index < normalized.length; index += 1) {
      var codePoint = normalized.codePointAt(index);
      if (codePoint <= 0x08 || codePoint === 0x0b || codePoint === 0x0c
        || (codePoint >= 0x0e && codePoint <= 0x1f) || codePoint === 0x7f) {
        throw requestError();
      }
      if (codePoint > 0xffff) index += 1;
    }
    return normalized;
  }

  function normalizedSize(value) {
    if (typeof value !== 'string' || !/^\d{1,4}x\d{1,4}$/u.test(value)) throw requestError();
    var dimensions = value.split('x').map(Number);
    if (dimensions.some(function (dimension) {
      return !Number.isSafeInteger(dimension)
        || dimension < 1
        || dimension > workbench.LIMITS.maxDimension;
    }) || dimensions[0] * dimensions[1] > workbench.LIMITS.maxPixels) {
      throw requestError();
    }
    return value;
  }

  function canonicalApiBase(value, failure) {
    if (typeof value !== 'string' || !value || value.length > 300 || value.includes('\\')) {
      throw failure();
    }
    var parsed;
    try {
      parsed = new URL(value);
    } catch (_error) {
      throw failure();
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash) {
      throw failure();
    }
    var pathname = parsed.pathname.replace(/\/+$/u, '');
    if (pathname.length > 240
      || /\/images\/(?:generations|edits|tasks)(?:\/|$)/iu.test(pathname)) {
      throw failure();
    }
    return parsed.origin + pathname;
  }

  function dimensions(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1
      || width > workbench.LIMITS.maxDimension
      || height > workbench.LIMITS.maxDimension
      || width * height > workbench.LIMITS.maxPixels) {
      throw requestError();
    }
    return { width: width, height: height };
  }

  function normalizedImage(value, mask) {
    var keys = mask
      ? ['blob', 'mimeType', 'width', 'height', 'maskSemantics']
      : ['blob', 'mimeType', 'width', 'height'];
    if (!exactKeys(value, keys)
      || typeof global.Blob !== 'function'
      || !(value.blob instanceof global.Blob)
      || typeof value.mimeType !== 'string'
      || !IMAGE_MIME_TYPES.includes(value.mimeType)
      || value.blob.type !== value.mimeType
      || !Number.isSafeInteger(value.blob.size)
      || value.blob.size < 1
      || value.blob.size > workbench.LIMITS.maxResultBytes
      || (mask && (value.mimeType !== 'image/png'
        || value.maskSemantics !== MASK_SEMANTICS))) {
      throw requestError();
    }
    var measured = dimensions(value.width, value.height);
    return {
      blob: value.blob,
      mimeType: value.mimeType,
      width: measured.width,
      height: measured.height,
    };
  }

  function extensionForMime(value) {
    if (value === 'image/jpeg') return 'jpg';
    if (value === 'image/webp') return 'webp';
    return 'png';
  }

  function normalizedRequest(value) {
    var keys = [
      'apiBaseUrl', 'operation', 'model', 'prompt', 'negativePrompt', 'size', 'images', 'mask',
    ];
    if (!exactKeys(value, keys) || !EDIT_OPERATIONS.includes(value.operation)
      || !Array.isArray(value.images)) {
      throw requestError();
    }
    var maximumImages = value.operation === 'IMAGE_TO_IMAGE'
      ? workbench.LIMITS.maxReferenceImages
      : 1;
    if (value.images.length < 1 || value.images.length > maximumImages
      || (value.operation !== 'IMAGE_TO_IMAGE' && value.images.length !== 1)) {
      throw requestError();
    }
    var images = value.images.map(function (candidate) {
      return normalizedImage(candidate, false);
    });
    var mask = value.mask === null ? null : normalizedImage(value.mask, true);
    if (value.operation === 'INPAINT') {
      if (!mask || mask.width !== images[0].width || mask.height !== images[0].height) {
        throw requestError();
      }
    } else if (mask !== null) {
      throw requestError();
    }
    var model = text(value.model, MAX_MODEL_CHARACTERS);
    var positivePrompt = prompt(value.prompt, workbench.LIMITS.maxPromptCharacters, false);
    var negativePrompt = prompt(
      value.negativePrompt,
      workbench.LIMITS.maxNegativePromptCharacters,
      true,
    );
    var sentPrompt = negativePrompt
      ? positivePrompt + '\n\nAvoid: ' + negativePrompt
      : positivePrompt;
    var size = normalizedSize(value.size);
    var totalBytes = images.reduce(function (total, image) {
      return total + image.blob.size;
    }, mask ? mask.blob.size : 0);
    totalBytes += new TextEncoder().encode(model + sentPrompt + size).byteLength;
    totalBytes += MULTIPART_FIXED_OVERHEAD_BYTES
      + ((images.length + (mask ? 1 : 0) + 4) * MULTIPART_PART_OVERHEAD_BYTES);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > workbench.LIMITS.maxRequestBytes) {
      throw requestError();
    }
    return {
      apiBaseUrl: canonicalApiBase(value.apiBaseUrl, requestError),
      operation: value.operation,
      model: model,
      sentPrompt: sentPrompt,
      size: size,
      images: images,
      mask: mask,
    };
  }

  function createSubmitRequest(value, adapterId, requestMode, asyncContract) {
    var input = normalizedRequest(value);
    if (typeof global.FormData !== 'function') throw requestError();
    var body = new global.FormData();
    body.append('model', input.model);
    body.append('prompt', input.sentPrompt);
    body.append('n', '1');
    body.append('size', input.size);
    var imageField = input.images.length === 1 ? 'image' : 'image[]';
    input.images.forEach(function (image, index) {
      body.append(
        imageField,
        image.blob,
        'image-' + (index + 1) + '.' + extensionForMime(image.mimeType),
      );
    });
    if (input.mask) body.append('mask', input.mask.blob, 'mask.png');
    var headers = { Accept: 'application/json' };
    if (asyncContract) {
      headers['X-SS-ERP-Async-Task-Contract'] = ASYNC_TASK_CONTRACT_VERSION;
    }
    return Object.freeze({
      adapterId: adapterId,
      requestMode: requestMode,
      endpoint: input.apiBaseUrl + '/images/edits',
      method: 'POST',
      headers: Object.freeze(headers),
      body: body,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  }

  function normalizedBase64(value, failure) {
    if (typeof value !== 'string' || !value || value.length % 4 !== 0
      || value.length > Math.ceil(workbench.LIMITS.maxResultBytes / 3) * 4 + 4
      || !/^[a-zA-Z0-9+/]*={0,2}$/u.test(value)) {
      throw failure();
    }
    return value;
  }

  function normalizedResultUrl(value, failure) {
    if (typeof value !== 'string' || !value || value.length > MAX_RESULT_URL_CHARACTERS
      || value.includes('\\')) {
      throw failure();
    }
    var parsed;
    try {
      parsed = new URL(value);
    } catch (_error) {
      throw failure();
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
      throw failure();
    }
    return parsed.toString();
  }

  function normalizeImageResponse(value, failure) {
    if (!allowedKeys(value, ['id', 'created', 'data']) || !hasOwn(value, 'data')
      || (hasOwn(value, 'id') && (typeof value.id !== 'string'
        || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value.id)))
      || (hasOwn(value, 'created')
        && (!Number.isSafeInteger(value.created) || value.created < 0))
      || !Array.isArray(value.data) || value.data.length !== 1
      || !allowedKeys(value.data[0], ['b64_json', 'url', 'revised_prompt'])) {
      throw failure();
    }
    var item = value.data[0];
    var hasBase64 = hasOwn(item, 'b64_json');
    var hasUrl = hasOwn(item, 'url');
    if (hasBase64 === hasUrl
      || (hasOwn(item, 'revised_prompt') && (typeof item.revised_prompt !== 'string'
        || item.revised_prompt.length > workbench.LIMITS.maxPromptCharacters))) {
      throw failure();
    }
    if (hasBase64) {
      return Object.freeze({
        kind: 'IMAGE_RESULT',
        source: 'b64_json',
        b64Json: normalizedBase64(item.b64_json, failure),
        url: null,
      });
    }
    return Object.freeze({
      kind: 'IMAGE_RESULT',
      source: 'url',
      b64Json: null,
      url: normalizedResultUrl(item.url, failure),
    });
  }

  function normalizeTaskId(value) {
    if (typeof value !== 'string'
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/u.test(value)) {
      throw taskError();
    }
    return value;
  }

  function normalizeErrorCode(value) {
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_.:-]{0,99}$/u.test(value)) {
      throw taskError();
    }
    return value;
  }

  var OPENAI_MULTIPART_SYNC = Object.freeze({
    id: OPENAI_MULTIPART_SYNC_V1,
    requestMode: 'multipart',
    maskSemantics: MASK_SEMANTICS,
    createSubmitRequest: function (value) {
      return createSubmitRequest(value, OPENAI_MULTIPART_SYNC_V1, 'multipart', false);
    },
    normalizeSubmitResponse: function (value) {
      return normalizeImageResponse(value, responseError);
    },
  });

  var EXPLICIT_ASYNC_TASK = Object.freeze({
    id: EXPLICIT_ASYNC_TASK_V1,
    requestMode: 'async',
    maskSemantics: MASK_SEMANTICS,
    createSubmitRequest: function (value) {
      return createSubmitRequest(value, EXPLICIT_ASYNC_TASK_V1, 'async', true);
    },
    normalizeSubmitResponse: function (value) {
      if (!exactKeys(value, ['contractVersion', 'taskId', 'state'])
        || value.contractVersion !== ASYNC_TASK_CONTRACT_VERSION
        || value.state !== 'PENDING') {
        throw taskError();
      }
      return Object.freeze({
        kind: 'ASYNC_TASK',
        taskId: normalizeTaskId(value.taskId),
        state: 'PENDING',
      });
    },
    createPollRequest: function (value) {
      if (!exactKeys(value, ['apiBaseUrl', 'taskId'])) throw taskError();
      var apiBaseUrl = canonicalApiBase(value.apiBaseUrl, taskError);
      var taskId = normalizeTaskId(value.taskId);
      return Object.freeze({
        endpoint: apiBaseUrl + '/images/tasks/' + encodeURIComponent(taskId),
        method: 'GET',
        headers: Object.freeze({
          Accept: 'application/json',
          'X-SS-ERP-Async-Task-Contract': ASYNC_TASK_CONTRACT_VERSION,
        }),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
    },
    normalizePollResponse: function (value, expectedTaskIdValue) {
      if (!exactKeys(value, ['contractVersion', 'taskId', 'state', 'result', 'errorCode'])
        || value.contractVersion !== ASYNC_TASK_CONTRACT_VERSION
        || !ASYNC_TASK_STATES.includes(value.state)) {
        throw taskError();
      }
      var expectedTaskId = normalizeTaskId(expectedTaskIdValue);
      var taskId = normalizeTaskId(value.taskId);
      if (taskId !== expectedTaskId) throw taskError();
      var image = null;
      var errorCode = null;
      if (value.state === 'PENDING') {
        if (value.result !== null || value.errorCode !== null) throw taskError();
      } else if (value.state === 'SUCCEEDED') {
        if (value.errorCode !== null) throw taskError();
        image = normalizeImageResponse(value.result, taskError);
      } else if (value.state === 'FAILED') {
        if (value.result !== null) throw taskError();
        errorCode = normalizeErrorCode(value.errorCode);
      } else if (value.result !== null || value.errorCode !== null) {
        throw taskError();
      }
      return Object.freeze({
        kind: 'ASYNC_TASK_STATUS',
        taskId: taskId,
        state: value.state,
        terminal: value.state !== 'PENDING',
        image: image,
        errorCode: errorCode,
      });
    },
  });

  function resolveAdapter(value) {
    if (value === OPENAI_MULTIPART_SYNC_V1) return OPENAI_MULTIPART_SYNC;
    if (value === EXPLICIT_ASYNC_TASK_V1) return EXPLICIT_ASYNC_TASK;
    throw adapterError(
      'SS_ERP_BYOK_IMAGE_EDIT_ADAPTER_UNSUPPORTED',
      'BYOK image edit adapter is unsupported',
    );
  }

  global.SS_ERP_BYOK_IMAGE_EDIT_ADAPTERS = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    OPENAI_MULTIPART_SYNC_V1: OPENAI_MULTIPART_SYNC_V1,
    EXPLICIT_ASYNC_TASK_V1: EXPLICIT_ASYNC_TASK_V1,
    ASYNC_TASK_CONTRACT_VERSION: ASYNC_TASK_CONTRACT_VERSION,
    ADAPTER_IDS: Object.freeze([OPENAI_MULTIPART_SYNC_V1, EXPLICIT_ASYNC_TASK_V1]),
    OPENAI_MULTIPART_SYNC: OPENAI_MULTIPART_SYNC,
    EXPLICIT_ASYNC_TASK: EXPLICIT_ASYNC_TASK,
    resolveAdapter: resolveAdapter,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
