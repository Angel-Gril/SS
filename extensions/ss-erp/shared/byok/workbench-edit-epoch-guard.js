(function exposeByokWorkbenchEditEpochGuard(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-edit-epoch-guard/v1';
  var STORAGE_KEY = 'ss-erp:byok:workbench-edit-epochs:v1';
  var MAX_RECORDS = 32;

  function guardError(code, outcome) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchEditEpochGuardError';
    error.code = code;
    if (outcome) error.outcome = outcome;
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

  function canonicalText(value, maximum, code) {
    if (typeof value !== 'string') throw guardError(code);
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw guardError(code);
    }
    return normalized;
  }

  function normalizeOwner(value) {
    var code = 'SS_ERP_BYOK_EDIT_OWNER_INVALID';
    if (!isRecord(value) || !Number.isSafeInteger(value.tabId) || value.tabId < 0) {
      throw guardError(code);
    }
    if (!isRecord(value.context)) throw guardError(code);
    var contextValues = [
      value.context.shopId,
      value.context.workflowId,
      value.context.draftRevision,
      value.context.draftVersion,
      value.context.sourceCaptureSnapshotId,
      value.context.supplyGoodsId,
      value.context.skuKey,
      value.context.slotKey,
    ];
    if (contextValues.some(function (item, index) {
      if (index === 2 || index === 3) return !Number.isSafeInteger(item) || item < 1;
      return typeof item !== 'string' || !item || item.length > 500
        || item !== item.normalize('NFKC').trim() || /[\u0000-\u001f\u007f]/u.test(item);
    })) throw guardError(code);
    return Object.freeze({
      tabId: value.tabId,
      documentId: canonicalText(value.documentId, 200, code),
      contextKey: JSON.stringify(contextValues),
    });
  }

  function randomEpoch(randomValues) {
    var bytes = new Uint8Array(24);
    randomValues(bytes);
    return 'we_' + Array.from(bytes).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function normalizeRecord(value) {
    if (!exactKeys(value, [
      'contractVersion', 'tabId', 'documentId', 'contextKey', 'workerEpochId', 'startedAt',
    ]) || value.contractVersion !== CONTRACT_VERSION
      || !Number.isSafeInteger(value.tabId) || value.tabId < 0
      || !Number.isSafeInteger(value.startedAt) || value.startedAt < 1) {
      throw guardError('SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID', 'UNKNOWN_OUTCOME');
    }
    var workerEpochId = canonicalText(
      value.workerEpochId,
      64,
      'SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID',
    );
    if (!/^we_[a-f0-9]{48}$/u.test(workerEpochId)) {
      throw guardError('SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID', 'UNKNOWN_OUTCOME');
    }
    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      tabId: value.tabId,
      documentId: canonicalText(
        value.documentId,
        200,
        'SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID',
      ),
      contextKey: canonicalText(
        value.contextKey,
        2000,
        'SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID',
      ),
      workerEpochId: workerEpochId,
      startedAt: value.startedAt,
    });
  }

  function createGuard(options) {
    var storage = options && options.sessionStorage;
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    var randomValues = options && options.randomValues
      || global.crypto && global.crypto.getRandomValues.bind(global.crypto);
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || typeof storage.remove !== 'function' || typeof randomValues !== 'function') {
      throw guardError('SS_ERP_BYOK_EDIT_EPOCH_DEPENDENCY_UNAVAILABLE');
    }
    var workerEpochId = randomEpoch(randomValues);
    var queue = Promise.resolve();

    function enqueue(operation) {
      var next = queue.then(operation, operation);
      queue = next.catch(function () {});
      return next;
    }

    function currentMillis() {
      var value = Number(now());
      if (!Number.isSafeInteger(value) || value < 1) {
        throw guardError('SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID', 'UNKNOWN_OUTCOME');
      }
      return value;
    }

    async function loadRecords() {
      var stored = await storage.get([STORAGE_KEY]);
      var raw = stored && stored[STORAGE_KEY];
      if (raw === undefined) return {};
      if (!isRecord(raw) || Object.keys(raw).length > MAX_RECORDS) {
        throw guardError('SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID', 'UNKNOWN_OUTCOME');
      }
      var records = {};
      Object.keys(raw).forEach(function (key) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(key)) {
          throw guardError('SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID', 'UNKNOWN_OUTCOME');
        }
        var record = normalizeRecord(raw[key]);
        if (String(record.tabId) !== key) {
          throw guardError('SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID', 'UNKNOWN_OUTCOME');
        }
        records[key] = record;
      });
      return records;
    }

    async function storeRecords(records) {
      if (!Object.keys(records).length) {
        await storage.remove([STORAGE_KEY]);
        return;
      }
      await storage.set({ [STORAGE_KEY]: records });
    }

    function recordsForContext(records, owner) {
      return Object.values(records).filter(function (record) {
        return record.contextKey === owner.contextKey;
      });
    }

    function assertRecord(records, owner, requireActive) {
      var record = records[String(owner.tabId)];
      if (!record) {
        if (recordsForContext(records, owner).length) {
          throw guardError('SS_ERP_BYOK_EDIT_WORKER_RESTARTED', 'UNKNOWN_OUTCOME');
        }
        if (requireActive) {
          throw guardError('SS_ERP_BYOK_EDIT_EPOCH_REQUIRED', 'UNKNOWN_OUTCOME');
        }
        return Object.freeze({ state: 'EMPTY' });
      }
      if (record.documentId !== owner.documentId || record.contextKey !== owner.contextKey
        || record.workerEpochId !== workerEpochId) {
        throw guardError('SS_ERP_BYOK_EDIT_WORKER_RESTARTED', 'UNKNOWN_OUTCOME');
      }
      return Object.freeze({ state: 'CURRENT' });
    }

    function assertCurrent(ownerValue, optionsValue) {
      var owner = normalizeOwner(ownerValue);
      var requireActive = Boolean(optionsValue && optionsValue.requireActive === true);
      return enqueue(async function () {
        var records = await loadRecords();
        return assertRecord(records, owner, requireActive);
      });
    }

    function begin(ownerValue) {
      var owner = normalizeOwner(ownerValue);
      return enqueue(async function () {
        var records = await loadRecords();
        var existing = records[String(owner.tabId)];
        if (existing) {
          assertRecord(records, owner, true);
          throw guardError('SS_ERP_BYOK_EDIT_WORKER_RESTARTED', 'UNKNOWN_OUTCOME');
        }
        if (recordsForContext(records, owner).length) {
          throw guardError('SS_ERP_BYOK_EDIT_WORKER_RESTARTED', 'UNKNOWN_OUTCOME');
        }
        if (Object.keys(records).length >= MAX_RECORDS) {
          throw guardError('SS_ERP_BYOK_EDIT_EPOCH_LIMIT', 'UNKNOWN_OUTCOME');
        }
        records[String(owner.tabId)] = Object.freeze({
          contractVersion: CONTRACT_VERSION,
          tabId: owner.tabId,
          documentId: owner.documentId,
          contextKey: owner.contextKey,
          workerEpochId: workerEpochId,
          startedAt: currentMillis(),
        });
        await storeRecords(records);
        return Object.freeze({ state: 'CURRENT', created: true });
      });
    }

    function clear(ownerValue) {
      var owner = normalizeOwner(ownerValue);
      return enqueue(async function () {
        var records = await loadRecords();
        var existing = records[String(owner.tabId)];
        if (!existing || existing.documentId !== owner.documentId
          || existing.contextKey !== owner.contextKey) return false;
        delete records[String(owner.tabId)];
        await storeRecords(records);
        return true;
      });
    }

    function clearByTab(tabId) {
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        return Promise.reject(guardError('SS_ERP_BYOK_EDIT_OWNER_INVALID'));
      }
      return enqueue(async function () {
        var records = await loadRecords();
        if (!records[String(tabId)]) return false;
        delete records[String(tabId)];
        await storeRecords(records);
        return true;
      });
    }

    function acknowledge(ownerValue, acknowledgement) {
      var owner = normalizeOwner(ownerValue);
      if (!exactKeys(acknowledgement, ['warningVersion', 'confirmed'])
        || acknowledgement.warningVersion !== 'external-provider-charge/v1'
        || acknowledgement.confirmed !== true) {
        return Promise.reject(guardError('SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED'));
      }
      return enqueue(async function () {
        var records = await loadRecords();
        var clearedCount = 0;
        Object.keys(records).forEach(function (key) {
          if (records[key].contextKey !== owner.contextKey) return;
          delete records[key];
          clearedCount += 1;
        });
        await storeRecords(records);
        return Object.freeze({ clearedCount: clearedCount });
      });
    }

    function clearAll() {
      return enqueue(async function () {
        await storage.remove([STORAGE_KEY]);
      });
    }

    function rotate() {
      workerEpochId = randomEpoch(randomValues);
      return true;
    }

    return Object.freeze({
      assertCurrent: assertCurrent,
      begin: begin,
      clear: clear,
      clearByTab: clearByTab,
      acknowledge: acknowledge,
      clearAll: clearAll,
      rotate: rotate,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_EDIT_EPOCH_GUARD = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    createGuard: createGuard,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
