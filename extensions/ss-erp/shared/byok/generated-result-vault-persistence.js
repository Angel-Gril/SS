(function exposeByokGeneratedResultVaultPersistence(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-result-vault-persistence/v1';
  var ENVELOPE_VERSION = 'extension-byok-result-vault-ciphertext/v1';
  var PAYLOAD_VERSION = 'extension-byok-result-vault-candidate/v1';
  var SESSION_KEY_VERSION = 'extension-byok-result-vault-session-key/v1';
  var SESSION_STORAGE_KEY = 'ss-erp:byok:generated-result-vault-key:v1';
  var DATABASE_NAME = 'ss-erp-byok-generated-result-vault-v1';
  var OBJECT_STORE_NAME = 'entries';
  var MAX_ENTRIES = 16;
  var MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  var MAX_RESULT_BYTES = 20 * 1024 * 1024;
  var MAX_TTL_MS = 10 * 60 * 1000;
  var MAX_PAYLOAD_METADATA_BYTES = 64 * 1024;
  var MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var BINDING_VERSION = 'extension-byok-readiness-binding/v2';
  var LIFECYCLE_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var BINDING_KEYS = [
    'contractVersion', 'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
    'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
    'sourceCaptureSnapshotId', 'supplyGoodsId', 'skuKey', 'slotKey',
    'assignmentMode', 'assignmentOrdinal', 'providerOrigin', 'model', 'operation',
    'policyRevision',
  ];
  var RESULT_REQUIRED_KEYS = [
    'contractVersion', 'outcome', 'operation', 'requestMode', 'profileId',
    'profileIdentity', 'providerOrigin', 'model', 'policyRevision',
    'executionIntentId', 'idempotencyKey', 'requestHash', 'promptHash',
    'negativePromptHash', 'endpointHash', 'providerRequestIdSha256', 'acceptedAt', 'image',
  ];
  var RESULT_ALLOWED_KEYS = RESULT_REQUIRED_KEYS.concat([
    'adapterId', 'providerTaskIdSha256', 'sourceSha256', 'referenceSha256s', 'maskSha256',
  ]);
  var IMAGE_REQUIRED_KEYS = ['blob', 'mimeType', 'byteLength', 'sha256'];
  var IMAGE_ALLOWED_KEYS = IMAGE_REQUIRED_KEYS.concat([
    'source', 'resultOrigin', 'resultUrlHash',
  ]);
  var ENVELOPE_KEYS = [
    'contractVersion', 'resultId', 'executionIntentHash', 'operationKeyHash',
    'expiresAtMillis', 'byteLength', 'identityHash', 'keyId', 'iv', 'ciphertext',
  ];

  function escrowError(code, message, cause) {
    var error = new Error(message || code);
    error.name = 'ExtensionByokGeneratedResultEscrowError';
    error.code = code;
    error.outcome = 'FAILED_FINAL';
    error.automaticRetryAllowed = false;
    if (cause) error.cause = cause;
    return error;
  }

  function invalid(message) {
    throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_INVALID', message);
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function exactKeys(value, keys) {
    return isRecord(value)
      && Object.keys(value).length === keys.length
      && Object.keys(value).every(function (key) { return keys.includes(key); });
  }

  function hasRequiredAndAllowedKeys(value, required, allowed) {
    return isRecord(value)
      && required.every(function (key) { return Object.prototype.hasOwnProperty.call(value, key); })
      && Object.keys(value).every(function (key) { return allowed.includes(key); });
  }

  function hasControlCharacter(value) {
    for (var index = 0; index < value.length; index += 1) {
      var code = value.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f) return true;
    }
    return false;
  }

  function text(value, maximum, label) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || hasControlCharacter(value)) invalid(label + ' is invalid');
    return value;
  }

  function identifier(value, maximum, label) {
    var normalized = text(value, maximum || 200, label);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(normalized)
      || /^(?:sk-[a-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|LTAI[a-zA-Z0-9]{12,}|AKID[a-zA-Z0-9]{12,})$/iu
        .test(normalized)
      || /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/u.test(normalized)) {
      invalid(label + ' is invalid');
    }
    return normalized;
  }

  function sha256(value, label) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
      invalid(label + ' is invalid');
    }
    return value;
  }

  function nullableSha256(value, label) {
    return value === null || value === undefined ? null : sha256(value, label);
  }

  function positiveInteger(value, maximum, label) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      invalid(label + ' is invalid');
    }
    return value;
  }

  function canonicalOrigin(value) {
    var origin = text(value, 300, 'Provider origin');
    var parsed;
    try { parsed = new global.URL(origin); } catch { invalid('Provider origin is invalid'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin !== origin) {
      invalid('Provider origin is invalid');
    }
    return origin;
  }

  function canonicalProfileIdentity(value, expectedModel) {
    if (typeof value !== 'string' || value.length < 3 || value.length > 600) {
      invalid('Provider profile identity is invalid');
    }
    var parts = value.split('\u0000');
    if (parts.length !== 2 || parts[1] !== expectedModel) {
      invalid('Provider profile identity is invalid');
    }
    var parsed;
    try { parsed = new global.URL(parts[0]); } catch { invalid('Provider profile identity is invalid'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || parsed.href !== parts[0]) {
      invalid('Provider profile identity is invalid');
    }
    return value;
  }

  function normalizeBinding(value) {
    if (!exactKeys(value, BINDING_KEYS) || value.contractVersion !== BINDING_VERSION
      || !OPERATIONS.includes(value.operation)
      || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
      || value.assignmentMode !== 'APPEND') invalid('Result binding is invalid');
    var skuKey = text(value.skuKey, 500, 'SKU key');
    var slotKey = text(value.slotKey, 200, 'Slot key');
    if (slotKey !== 'sku:' + skuKey + ':hero'
      && !['SCENE', 'DETAIL', 'SPEC', 'PACKAGING'].some(function (role) {
        return slotKey === 'shared:detail:' + role;
      })) invalid('Result binding is invalid');
    if (!Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0 || value.assignmentOrdinal > 499) {
      invalid('Assignment ordinal is invalid');
    }
    var normalized = {
      contractVersion: BINDING_VERSION,
      ownerUserId: text(value.ownerUserId, 200, 'Owner user ID'),
      deviceSessionId: text(value.deviceSessionId, 200, 'Device session ID'),
      shopId: text(value.shopId, 200, 'Shop ID'),
      workflowId: text(value.workflowId, 200, 'Workflow ID'),
      draftRevision: positiveInteger(value.draftRevision, Number.MAX_SAFE_INTEGER, 'Draft revision'),
      draftVersion: positiveInteger(value.draftVersion, Number.MAX_SAFE_INTEGER, 'Draft version'),
      sourcePlatform: value.sourcePlatform,
      sourceProductId: text(value.sourceProductId, 200, 'Source product ID'),
      sourceCaptureSnapshotId: text(
        value.sourceCaptureSnapshotId, 200, 'Source capture snapshot ID',
      ),
      supplyGoodsId: text(value.supplyGoodsId, 200, 'Supply goods ID'),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: value.assignmentOrdinal,
      providerOrigin: canonicalOrigin(value.providerOrigin),
      model: text(value.model, 200, 'Provider model'),
      operation: value.operation,
      policyRevision: identifier(value.policyRevision, 200, 'Policy revision'),
    };
    return normalized;
  }

  function normalizeLifecycleAuthority(value) {
    if (!exactKeys(value, ['contractVersion', 'epoch'])
      || value.contractVersion !== LIFECYCLE_VERSION
      || !Number.isSafeInteger(value.epoch) || value.epoch < 0) {
      invalid('Lifecycle authority is invalid');
    }
    return { contractVersion: LIFECYCLE_VERSION, epoch: value.epoch };
  }

  function normalizedEditHashes(result, operation) {
    var references = result.referenceSha256s === undefined
      ? []
      : Array.isArray(result.referenceSha256s)
        ? result.referenceSha256s.map(function (value) { return sha256(value, 'Reference SHA-256'); })
        : invalid('Reference SHA-256 values are invalid');
    var sourceSha256 = nullableSha256(result.sourceSha256, 'Source SHA-256');
    var maskSha256 = nullableSha256(result.maskSha256, 'Mask SHA-256');
    if ((operation === 'TEXT_TO_IMAGE'
      && (sourceSha256 !== null || references.length !== 0 || maskSha256 !== null))
      || (operation === 'IMAGE_TO_IMAGE'
        && (sourceSha256 !== null || references.length < 1 || references.length > 4
          || maskSha256 !== null))
      || (operation === 'FULL_EDIT'
        && (!sourceSha256 || references.length !== 0 || maskSha256 !== null))
      || (operation === 'INPAINT'
        && (!sourceSha256 || references.length !== 0 || !maskSha256))) {
      invalid('Operation image hashes are invalid');
    }
    return { sourceSha256: sourceSha256, referenceSha256s: references, maskSha256: maskSha256 };
  }

  function exactIso(value, label) {
    var normalized = text(value, 64, label);
    var parsed = new Date(normalized);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
      invalid(label + ' is invalid');
    }
    return normalized;
  }

  function imageMagicMatches(bytes, mimeType) {
    if (mimeType === 'image/png') {
      var png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return bytes.length >= png.length && png.every(function (value, index) {
        return bytes[index] === value;
      });
    }
    if (mimeType === 'image/jpeg') {
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }

  function normalizeResultMetadata(value, binding) {
    if (!hasRequiredAndAllowedKeys(value, RESULT_REQUIRED_KEYS, RESULT_ALLOWED_KEYS)
      || value.outcome !== 'SUCCEEDED' || !OPERATIONS.includes(value.operation)
      || value.operation !== binding.operation
      || (value.operation === 'TEXT_TO_IMAGE'
        ? value.requestMode !== 'json'
        : !['multipart', 'async'].includes(value.requestMode))) {
      invalid('Generated result is invalid');
    }
    if (!hasRequiredAndAllowedKeys(value.image, IMAGE_REQUIRED_KEYS, IMAGE_ALLOWED_KEYS)
      || typeof global.Blob !== 'function' || !(value.image.blob instanceof global.Blob)) {
      invalid('Generated result image is invalid');
    }
    var mimeType = text(value.image.mimeType, 32, 'Result MIME type').toLowerCase();
    var byteLength = positiveInteger(value.image.byteLength, MAX_RESULT_BYTES, 'Result byte length');
    if (!MIME_TYPES.includes(mimeType) || value.image.blob.type !== mimeType
      || value.image.blob.size !== byteLength) invalid('Generated result image is invalid');
    var model = text(value.model, 200, 'Provider model');
    var providerOrigin = canonicalOrigin(value.providerOrigin);
    if (binding.model !== model || binding.providerOrigin !== providerOrigin
      || binding.policyRevision !== value.policyRevision) invalid('Generated result binding is invalid');
    var editHashes = normalizedEditHashes(value, value.operation);
    var normalized = {
      contractVersion: text(value.contractVersion, 100, 'Result contract version'),
      outcome: 'SUCCEEDED',
      operation: value.operation,
      requestMode: value.requestMode,
      profileId: identifier(value.profileId, 128, 'Provider profile ID'),
      profileIdentity: canonicalProfileIdentity(value.profileIdentity, model),
      providerOrigin: providerOrigin,
      model: model,
      policyRevision: identifier(value.policyRevision, 200, 'Policy revision'),
      executionIntentId: identifier(value.executionIntentId, 200, 'Execution intent ID'),
      idempotencyKey: identifier(value.idempotencyKey, 200, 'Provider idempotency key'),
      requestHash: sha256(value.requestHash, 'Provider request hash'),
      promptHash: sha256(value.promptHash, 'Prompt hash'),
      negativePromptHash: nullableSha256(value.negativePromptHash, 'Negative Prompt hash'),
      endpointHash: sha256(value.endpointHash, 'Endpoint hash'),
      providerRequestIdSha256: nullableSha256(
        value.providerRequestIdSha256, 'Provider request ID hash',
      ),
      providerTaskIdSha256: nullableSha256(
        value.providerTaskIdSha256, 'Provider task ID hash',
      ),
      acceptedAt: exactIso(value.acceptedAt, 'Accepted timestamp'),
      image: {
        mimeType: mimeType,
        byteLength: byteLength,
        sha256: sha256(value.image.sha256, 'Result SHA-256'),
      },
    };
    if (value.operation !== 'TEXT_TO_IMAGE') {
      normalized.sourceSha256 = editHashes.sourceSha256;
      normalized.referenceSha256s = editHashes.referenceSha256s;
      normalized.maskSha256 = editHashes.maskSha256;
    }
    return normalized;
  }

  function normalizeCandidate(result, bindingValue, lifecycleAuthorityValue) {
    var binding = normalizeBinding(bindingValue);
    var lifecycleAuthority = normalizeLifecycleAuthority(lifecycleAuthorityValue);
    var normalizedResult = normalizeResultMetadata(result, binding);
    return {
      result: normalizedResult,
      binding: binding,
      lifecycleAuthority: lifecycleAuthority,
      blob: result.image.blob,
    };
  }

  function canonicalPayload(candidate) {
    return JSON.stringify({
      contractVersion: PAYLOAD_VERSION,
      result: candidate.result,
      binding: candidate.binding,
      lifecycleAuthority: candidate.lifecycleAuthority,
    });
  }

  function envelopeAad(value) {
    return JSON.stringify({
      contractVersion: ENVELOPE_VERSION,
      resultId: value.resultId,
      executionIntentHash: value.executionIntentHash,
      operationKeyHash: value.operationKeyHash,
      expiresAtMillis: value.expiresAtMillis,
      byteLength: value.byteLength,
      identityHash: value.identityHash,
      keyId: value.keyId,
    });
  }

  function bytesToHex(bytes) {
    return Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function createId(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return 'br_' + bytesToHex(bytes);
  }

  function requestPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('IndexedDB request failed')); };
    });
  }

  function transactionPromise(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () {
        reject(transaction.error || new Error('IndexedDB transaction failed'));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error('IndexedDB transaction aborted'));
      };
    });
  }

  function createIndexedDbRepository(options) {
    var indexedDB = options && options.indexedDB;
    var databaseName = options && options.databaseName || DATABASE_NAME;
    if (!indexedDB || typeof indexedDB.open !== 'function'
      || typeof databaseName !== 'string' || !databaseName) {
      throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE');
    }
    var databasePromise = null;

    function openDatabase() {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise(function (resolve, reject) {
        var request;
        try { request = indexedDB.open(databaseName, 1); } catch (error) { reject(error); return; }
        request.onupgradeneeded = function () {
          var database = request.result;
          var store = database.objectStoreNames.contains(OBJECT_STORE_NAME)
            ? request.transaction.objectStore(OBJECT_STORE_NAME)
            : database.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'resultId' });
          if (!store.indexNames.contains('executionIntentHash')) {
            store.createIndex('executionIntentHash', 'executionIntentHash', { unique: true });
          }
          if (!store.indexNames.contains('operationKeyHash')) {
            store.createIndex('operationKeyHash', 'operationKeyHash', { unique: true });
          }
        };
        request.onsuccess = function () {
          var database = request.result;
          database.onversionchange = function () { database.close(); };
          resolve(database);
        };
        request.onerror = function () { reject(request.error || new Error('IndexedDB open failed')); };
        request.onblocked = function () { reject(new Error('IndexedDB open blocked')); };
      }).catch(function (error) {
        databasePromise = null;
        throw error;
      });
      return databasePromise;
    }

    async function list() {
      var database = await openDatabase();
      var transaction = database.transaction(OBJECT_STORE_NAME, 'readonly');
      var complete = transactionPromise(transaction);
      var values = await requestPromise(transaction.objectStore(OBJECT_STORE_NAME).getAll());
      await complete;
      return values;
    }

    async function stage(record, limits) {
      var database = await openDatabase();
      var transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
      var complete = transactionPromise(transaction);
      var store = transaction.objectStore(OBJECT_STORE_NAME);
      try {
        var requests = [
          requestPromise(store.get(record.resultId)),
          requestPromise(store.index('executionIntentHash').get(record.executionIntentHash)),
          requestPromise(store.index('operationKeyHash').get(record.operationKeyHash)),
          requestPromise(store.getAll()),
        ];
        var values = await Promise.all(requests);
        var existing = values[0] || values[1] || values[2] || null;
        if (existing) {
          if (existing.identityHash !== record.identityHash) {
            throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_CONFLICT');
          }
          await complete;
          return { kind: 'existing', record: existing };
        }
        var totalBytes = values[3].reduce(function (sum, item) {
          return sum + Number(item && item.byteLength || 0);
        }, 0);
        if (values[3].length + 1 > limits.maxEntries
          || totalBytes + record.byteLength > limits.maxTotalBytes) {
          throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_FULL');
        }
        store.add(record);
        await complete;
        return { kind: 'inserted', record: record };
      } catch (error) {
        try { transaction.abort(); } catch {}
        void complete.catch(function () {});
        throw error;
      }
    }

    async function deleteMany(resultIds) {
      if (!resultIds.length) return;
      var database = await openDatabase();
      var transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
      var complete = transactionPromise(transaction);
      var store = transaction.objectStore(OBJECT_STORE_NAME);
      resultIds.forEach(function (resultId) { store.delete(resultId); });
      await complete;
    }

    async function clear() {
      var database = await openDatabase();
      var transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite');
      var complete = transactionPromise(transaction);
      transaction.objectStore(OBJECT_STORE_NAME).clear();
      await complete;
    }

    return Object.freeze({
      ready: openDatabase,
      list: list,
      stage: stage,
      deleteMany: deleteMany,
      clear: clear,
    });
  }

  function createStore(options) {
    var repository = options && options.repository;
    if (!repository && options && options.indexedDB) {
      repository = createIndexedDbRepository({ indexedDB: options.indexedDB });
    }
    var sessionStorage = options && options.sessionStorage;
    var cryptoImpl = options && options.crypto || global.crypto;
    var now = options && options.now || function () { return Date.now(); };
    var randomValues = options && options.randomValues
      || function (bytes) { return cryptoImpl.getRandomValues(bytes); };
    if (!repository || ['ready', 'list', 'stage', 'deleteMany', 'clear'].some(function (name) {
      return typeof repository[name] !== 'function';
    }) || !sessionStorage || typeof sessionStorage.get !== 'function'
      || typeof sessionStorage.set !== 'function' || typeof sessionStorage.remove !== 'function'
      || !cryptoImpl || !cryptoImpl.subtle
      || typeof cryptoImpl.subtle.encrypt !== 'function'
      || typeof cryptoImpl.subtle.decrypt !== 'function'
      || typeof cryptoImpl.subtle.digest !== 'function'
      || typeof cryptoImpl.subtle.importKey !== 'function'
      || typeof randomValues !== 'function' || typeof global.TextEncoder !== 'function'
      || typeof global.TextDecoder !== 'function' || typeof global.Blob !== 'function') {
      throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE');
    }

    var encoder = new global.TextEncoder();
    var decoder = new global.TextDecoder('utf-8', { fatal: true });
    var cacheById = new Map();
    var idByExecutionIntentHash = new Map();
    var idByOperationKeyHash = new Map();
    var usedIvs = new Set();
    var initialized = null;
    var mutationTail = Promise.resolve();
    var keyRecord = null;
    var cryptoKey = null;

    function currentMillis() {
      var value = Number(now());
      if (!Number.isSafeInteger(value) || value < 0) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE');
      }
      return value;
    }

    function enqueue(operation) {
      var next = mutationTail.catch(function () {}).then(operation);
      mutationTail = next.catch(function () {});
      return next;
    }

    async function hashBytes(value) {
      var digest = await cryptoImpl.subtle.digest('SHA-256', value);
      return bytesToHex(new Uint8Array(digest));
    }

    async function hashText(value) {
      return hashBytes(encoder.encode(value));
    }

    function validSessionKey(value) {
      return exactKeys(value, ['contractVersion', 'keyId', 'keyBytes'])
        && value.contractVersion === SESSION_KEY_VERSION
        && typeof value.keyId === 'string' && /^[a-f0-9]{32}$/u.test(value.keyId)
        && Array.isArray(value.keyBytes) && value.keyBytes.length === 32
        && value.keyBytes.every(function (byte) {
          return Number.isSafeInteger(byte) && byte >= 0 && byte <= 255;
        });
    }

    async function importSessionKey(value) {
      return cryptoImpl.subtle.importKey(
        'raw', new Uint8Array(value.keyBytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
      );
    }

    async function newSessionKey() {
      var keyBytes = new Uint8Array(32);
      var idBytes = new Uint8Array(16);
      randomValues(keyBytes);
      randomValues(idBytes);
      var value = {
        contractVersion: SESSION_KEY_VERSION,
        keyId: bytesToHex(idBytes),
        keyBytes: Array.from(keyBytes),
      };
      await sessionStorage.set({ [SESSION_STORAGE_KEY]: value });
      return { record: value, key: await importSessionKey(value) };
    }

    function validEnvelope(value) {
      return exactKeys(value, ENVELOPE_KEYS)
        && value.contractVersion === ENVELOPE_VERSION
        && typeof value.resultId === 'string' && /^br_[a-f0-9]{48}$/u.test(value.resultId)
        && typeof value.executionIntentHash === 'string'
        && /^[a-f0-9]{64}$/u.test(value.executionIntentHash)
        && typeof value.operationKeyHash === 'string'
        && /^[a-f0-9]{64}$/u.test(value.operationKeyHash)
        && Number.isSafeInteger(value.expiresAtMillis) && value.expiresAtMillis > 0
        && Number.isSafeInteger(value.byteLength)
        && value.byteLength > 0 && value.byteLength <= MAX_RESULT_BYTES
        && typeof value.identityHash === 'string' && /^[a-f0-9]{64}$/u.test(value.identityHash)
        && typeof value.keyId === 'string' && /^[a-f0-9]{32}$/u.test(value.keyId)
        && (value.iv instanceof ArrayBuffer || ArrayBuffer.isView(value.iv))
        && new Uint8Array(value.iv.buffer || value.iv, value.iv.byteOffset || 0, value.iv.byteLength).byteLength === 12
        && (value.ciphertext instanceof ArrayBuffer || ArrayBuffer.isView(value.ciphertext))
        && new Uint8Array(
          value.ciphertext.buffer || value.ciphertext,
          value.ciphertext.byteOffset || 0,
          value.ciphertext.byteLength,
        ).byteLength > value.byteLength;
    }

    function ivBytes(value) {
      return new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength);
    }

    async function encodePayload(candidate) {
      var metadata = encoder.encode(canonicalPayload(candidate));
      if (metadata.byteLength > MAX_PAYLOAD_METADATA_BYTES) invalid('Candidate metadata is too large');
      var image = new Uint8Array(await candidate.blob.arrayBuffer());
      if (!imageMagicMatches(image, candidate.result.image.mimeType)) {
        invalid('Generated image magic is invalid');
      }
      var actualHash = await hashBytes(image);
      if (actualHash !== candidate.result.image.sha256) invalid('Generated image hash is invalid');
      var payload = new Uint8Array(4 + metadata.byteLength + image.byteLength);
      new DataView(payload.buffer).setUint32(0, metadata.byteLength, false);
      payload.set(metadata, 4);
      payload.set(image, 4 + metadata.byteLength);
      return { payload: payload, metadata: metadata };
    }

    async function decryptEnvelope(envelope) {
      if (!validEnvelope(envelope) || envelope.keyId !== keyRecord.keyId
        || envelope.expiresAtMillis <= currentMillis()) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED');
      }
      var plain;
      try {
        plain = new Uint8Array(await cryptoImpl.subtle.decrypt({
          name: 'AES-GCM', iv: ivBytes(envelope.iv),
          additionalData: encoder.encode(envelopeAad(envelope)), tagLength: 128,
        }, cryptoKey, envelope.ciphertext));
      } catch (error) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED', null, error);
      }
      if (plain.byteLength < 5) throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED');
      var metadataLength = new DataView(
        plain.buffer, plain.byteOffset, plain.byteLength,
      ).getUint32(0, false);
      if (metadataLength < 2 || metadataLength > MAX_PAYLOAD_METADATA_BYTES
        || 4 + metadataLength >= plain.byteLength) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED');
      }
      var parsed;
      try { parsed = JSON.parse(decoder.decode(plain.slice(4, 4 + metadataLength))); } catch (error) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED', null, error);
      }
      if (!exactKeys(parsed, ['contractVersion', 'result', 'binding', 'lifecycleAuthority'])
        || parsed.contractVersion !== PAYLOAD_VERSION) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED');
      }
      var imageBytes = plain.slice(4 + metadataLength);
      var mimeType = parsed.result && parsed.result.image && parsed.result.image.mimeType;
      var blob = new global.Blob([imageBytes], { type: mimeType });
      var candidate;
      try {
        candidate = normalizeCandidate(
          { ...parsed.result, image: { ...parsed.result.image, blob: blob } },
          parsed.binding,
          parsed.lifecycleAuthority,
        );
      } catch (error) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED', null, error);
      }
      if (candidate.result.image.byteLength !== envelope.byteLength
        || !imageMagicMatches(imageBytes, candidate.result.image.mimeType)
        || await hashBytes(imageBytes) !== candidate.result.image.sha256
        || await hashText(canonicalPayload(candidate)) !== envelope.identityHash
        || await hashText(candidate.result.executionIntentId) !== envelope.executionIntentHash
        || await hashText(candidate.result.idempotencyKey) !== envelope.operationKeyHash) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_TAMPERED');
      }
      return {
        resultId: envelope.resultId,
        expiresAtMillis: envelope.expiresAtMillis,
        result: candidate.result,
        binding: candidate.binding,
        lifecycleAuthority: candidate.lifecycleAuthority,
        blob: blob,
      };
    }

    function publicCandidate(entry) {
      var result = {
        ...entry.result,
        image: Object.freeze({ ...entry.result.image, blob: entry.blob }),
      };
      if (Array.isArray(entry.result.referenceSha256s)) {
        result.referenceSha256s = Object.freeze(entry.result.referenceSha256s.slice());
      }
      return Object.freeze({
        resultId: entry.resultId,
        expiresAtMillis: entry.expiresAtMillis,
        result: Object.freeze(result),
        binding: Object.freeze({ ...entry.binding }),
        lifecycleAuthority: Object.freeze({ ...entry.lifecycleAuthority }),
      });
    }

    function cacheEntry(entry, envelope) {
      cacheById.set(entry.resultId, entry);
      idByExecutionIntentHash.set(envelope.executionIntentHash, entry.resultId);
      idByOperationKeyHash.set(envelope.operationKeyHash, entry.resultId);
      usedIvs.add(bytesToHex(ivBytes(envelope.iv)));
    }

    function uncache(resultId) {
      var entry = cacheById.get(resultId);
      if (!entry) return false;
      cacheById.delete(resultId);
      idByExecutionIntentHash.forEach(function (value, key) {
        if (value === resultId) idByExecutionIntentHash.delete(key);
      });
      idByOperationKeyHash.forEach(function (value, key) {
        if (value === resultId) idByOperationKeyHash.delete(key);
      });
      entry.blob = null;
      return true;
    }

    async function removeNow(resultIds) {
      var unique = Array.from(new Set(resultIds));
      try {
        await repository.deleteMany(unique);
      } catch (error) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE', null, error);
      }
      var removed = 0;
      unique.forEach(function (resultId) { if (uncache(resultId)) removed += 1; });
      return removed;
    }

    async function pruneExpired() {
      var current = currentMillis();
      var expired = [];
      cacheById.forEach(function (entry, resultId) {
        if (entry.expiresAtMillis <= current) expired.push(resultId);
      });
      if (expired.length) await removeNow(expired);
    }

    async function initialize() {
      try {
        await repository.ready();
        var stored = await sessionStorage.get([SESSION_STORAGE_KEY]);
        var existing = stored && stored[SESSION_STORAGE_KEY];
        if (!validSessionKey(existing)) {
          await repository.clear();
          await sessionStorage.remove([SESSION_STORAGE_KEY]);
          var created = await newSessionKey();
          keyRecord = created.record;
          cryptoKey = created.key;
        } else {
          keyRecord = existing;
          cryptoKey = await importSessionKey(existing);
        }
        var records = await repository.list();
        var invalidIds = [];
        var totalBytes = 0;
        for (const envelope of records) {
          if (!validEnvelope(envelope) || envelope.keyId !== keyRecord.keyId
            || envelope.expiresAtMillis <= currentMillis()
            || cacheById.size >= MAX_ENTRIES
            || totalBytes + Number(envelope.byteLength || 0) > MAX_TOTAL_BYTES) {
            if (envelope && typeof envelope.resultId === 'string') invalidIds.push(envelope.resultId);
            continue;
          }
          try {
            var entry = await decryptEnvelope(envelope);
            if (cacheById.has(entry.resultId)
              || idByExecutionIntentHash.has(envelope.executionIntentHash)
              || idByOperationKeyHash.has(envelope.operationKeyHash)) {
              invalidIds.push(envelope.resultId);
              continue;
            }
            cacheEntry(entry, envelope);
            totalBytes += envelope.byteLength;
          } catch {
            invalidIds.push(envelope.resultId);
          }
        }
        if (invalidIds.length) await repository.deleteMany(Array.from(new Set(invalidIds)));
        return Object.freeze({ size: cacheById.size, totalBytes: totalBytes });
      } catch (error) {
        throw error && String(error.code || '').startsWith('SS_ERP_BYOK_RESULT_ESCROW_')
          ? error
          : escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE', null, error);
      }
    }

    function ensureReady() {
      if (!initialized) initialized = initialize();
      return initialized;
    }

    function nextUniqueIv() {
      for (var attempt = 0; attempt < 4; attempt += 1) {
        var iv = new Uint8Array(12);
        randomValues(iv);
        var identity = bytesToHex(iv);
        if (!usedIvs.has(identity)) return iv;
      }
      throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_RANDOM_UNAVAILABLE');
    }

    function nextResultId() {
      for (var attempt = 0; attempt < 4; attempt += 1) {
        var resultId = createId(randomValues);
        if (!cacheById.has(resultId)) return resultId;
      }
      throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_RANDOM_UNAVAILABLE');
    }

    async function stageNow(result, binding, lifecycleAuthority) {
      await ensureReady();
      await pruneExpired();
      var candidate = normalizeCandidate(result, binding, lifecycleAuthority);
      var encoded = await encodePayload(candidate);
      var executionIntentHash = await hashText(candidate.result.executionIntentId);
      var operationKeyHash = await hashText(candidate.result.idempotencyKey);
      var identityHash = await hashText(canonicalPayload(candidate));
      var resultId = nextResultId();
      var iv = nextUniqueIv();
      var expiresAtMillis = currentMillis() + MAX_TTL_MS;
      var envelope = {
        contractVersion: ENVELOPE_VERSION,
        resultId: resultId,
        executionIntentHash: executionIntentHash,
        operationKeyHash: operationKeyHash,
        expiresAtMillis: expiresAtMillis,
        byteLength: candidate.result.image.byteLength,
        identityHash: identityHash,
        keyId: keyRecord.keyId,
        iv: iv.buffer.slice(0),
        ciphertext: null,
      };
      envelope.ciphertext = await cryptoImpl.subtle.encrypt({
        name: 'AES-GCM', iv: iv,
        additionalData: encoder.encode(envelopeAad(envelope)), tagLength: 128,
      }, cryptoKey, encoded.payload);
      var committed;
      try {
        committed = await repository.stage(envelope, {
          maxEntries: MAX_ENTRIES,
          maxTotalBytes: MAX_TOTAL_BYTES,
        });
      } catch (error) {
        if (error && error.name === 'QuotaExceededError') {
          throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_QUOTA', null, error);
        }
        if (error && ['SS_ERP_BYOK_RESULT_ESCROW_CONFLICT', 'SS_ERP_BYOK_RESULT_ESCROW_FULL']
          .includes(error.code)) {
          throw escrowError(error.code, null, error);
        }
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE', null, error);
      }
      if (!committed || !['inserted', 'existing'].includes(committed.kind)) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE');
      }
      var committedEnvelope = committed.record;
      var entry = committed.kind === 'inserted'
        ? {
            resultId: resultId,
            expiresAtMillis: expiresAtMillis,
            result: candidate.result,
            binding: candidate.binding,
            lifecycleAuthority: candidate.lifecycleAuthority,
            blob: candidate.blob,
          }
        : await decryptEnvelope(committedEnvelope);
      if (entry.result.executionIntentId !== candidate.result.executionIntentId
        || entry.result.idempotencyKey !== candidate.result.idempotencyKey
        || entry.result.image.sha256 !== candidate.result.image.sha256
        || JSON.stringify(entry.binding) !== JSON.stringify(candidate.binding)) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_CONFLICT');
      }
      cacheEntry(entry, committedEnvelope);
      return publicCandidate(entry);
    }

    async function findNow(value) {
      await ensureReady();
      await pruneExpired();
      if (!isRecord(value) || Object.keys(value).length !== 1) invalid('Escrow lookup is invalid');
      var resultId;
      if (Object.prototype.hasOwnProperty.call(value, 'resultId')) {
        resultId = text(value.resultId, 128, 'Result ID');
        if (!/^br_[a-f0-9]{48}$/u.test(resultId)) invalid('Result ID is invalid');
      } else if (Object.prototype.hasOwnProperty.call(value, 'operationKeyHash')) {
        resultId = idByOperationKeyHash.get(sha256(value.operationKeyHash, 'Operation key hash'));
      } else invalid('Escrow lookup is invalid');
      var entry = resultId && cacheById.get(resultId);
      return entry ? publicCandidate(entry) : null;
    }

    async function findByExecutionIntentIdNow(executionIntentIdValue, expected) {
      await ensureReady();
      await pruneExpired();
      var executionIntentId = identifier(executionIntentIdValue, 200, 'Execution intent ID');
      if (!exactKeys(expected, ['resultSha256', 'binding'])) invalid('Recovery proof is invalid');
      var resultSha256 = sha256(expected.resultSha256, 'Recovery result SHA-256');
      var binding = normalizeBinding(expected.binding);
      var intentHash = await hashText(executionIntentId);
      var resultId = idByExecutionIntentHash.get(intentHash);
      var entry = resultId && cacheById.get(resultId);
      if (!entry || entry.result.executionIntentId !== executionIntentId
        || entry.result.image.sha256 !== resultSha256
        || JSON.stringify(entry.binding) !== JSON.stringify(binding)) return null;
      return publicCandidate(entry);
    }

    async function deleteManyNow(values) {
      await ensureReady();
      if (!Array.isArray(values) || values.length > MAX_ENTRIES) invalid('Result IDs are invalid');
      var ids = values.map(function (value) {
        var resultId = text(value, 128, 'Result ID');
        if (!/^br_[a-f0-9]{48}$/u.test(resultId)) invalid('Result ID is invalid');
        return resultId;
      });
      return removeNow(ids);
    }

    async function deleteByExecutionIntentIdsNow(value) {
      await ensureReady();
      await pruneExpired();
      if (!exactKeys(value, ['executionIntentIds'])
        || !Array.isArray(value.executionIntentIds)
        || value.executionIntentIds.length > MAX_ENTRIES) {
        invalid('Execution intent IDs are invalid');
      }
      var intentIds = value.executionIntentIds.map(function (executionIntentId) {
        return identifier(executionIntentId, 200, 'Execution intent ID');
      });
      var intentHashes = await Promise.all(intentIds.map(hashText));
      var resultIds = intentHashes.map(function (intentHash) {
        return idByExecutionIntentHash.get(intentHash);
      }).filter(Boolean);
      return resultIds.length ? removeNow(resultIds) : 0;
    }

    async function clearAndRotateKeyNow() {
      await ensureReady();
      var created = await newSessionKey();
      keyRecord = created.record;
      cryptoKey = created.key;
      cacheById.forEach(function (entry) { entry.blob = null; });
      cacheById.clear();
      idByExecutionIntentHash.clear();
      idByOperationKeyHash.clear();
      usedIvs.clear();
      try { await repository.clear(); } catch (error) {
        throw escrowError('SS_ERP_BYOK_RESULT_ESCROW_UNAVAILABLE', null, error);
      }
      return Object.freeze({ cleared: true, keyRotated: true });
    }

    return Object.freeze({
      ready: ensureReady,
      stage: function (result, binding, lifecycleAuthority) {
        return enqueue(function () { return stageNow(result, binding, lifecycleAuthority); });
      },
      find: function (value) { return enqueue(function () { return findNow(value); }); },
      findByExecutionIntentId: function (executionIntentId, expected) {
        return enqueue(function () { return findByExecutionIntentIdNow(executionIntentId, expected); });
      },
      delete: function (resultId) {
        return enqueue(function () {
          return deleteManyNow([resultId]).then(function (count) { return count === 1; });
        });
      },
      deleteMany: function (resultIds) {
        return enqueue(function () { return deleteManyNow(resultIds); });
      },
      deleteByExecutionIntentIds: function (request) {
        return enqueue(function () {
          return deleteByExecutionIntentIdsNow(request);
        });
      },
      clearAndRotateKey: function () { return enqueue(clearAndRotateKeyNow); },
    });
  }

  global.SS_ERP_BYOK_GENERATED_RESULT_VAULT_PERSISTENCE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    ENVELOPE_VERSION: ENVELOPE_VERSION,
    SESSION_KEY_VERSION: SESSION_KEY_VERSION,
    SESSION_STORAGE_KEY: SESSION_STORAGE_KEY,
    MAX_ENTRIES: MAX_ENTRIES,
    MAX_TOTAL_BYTES: MAX_TOTAL_BYTES,
    MAX_RESULT_BYTES: MAX_RESULT_BYTES,
    MAX_TTL_MS: MAX_TTL_MS,
    createIndexedDbRepository: createIndexedDbRepository,
    createStore: createStore,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
