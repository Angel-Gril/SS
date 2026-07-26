(function exposeByokWorkbenchLaunchSession(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-launch-session/v1';
  var CONTEXT_VERSION = 'extension-byok-workbench-launch-context/v1';
  var STORAGE_KEY = 'ss-erp:byok:workbench-launch-sessions:v1';
  var DEFAULT_TTL_MS = 10 * 60 * 1000;
  var MAX_TTL_MS = 15 * 60 * 1000;
  var DEFAULT_LIMIT = 8;
  var CONTEXT_KEYS = [
    'contractVersion', 'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId',
    'supplyGoodsId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion', 'skuKey',
    'slotKey', 'assignmentMode', 'assignmentOrdinal',
  ];
  var SESSION_KEYS = [
    'contractVersion', 'context', 'sourceTabId', 'sourceDocumentId', 'workbenchTabId',
    'workbenchDocumentId', 'operation', 'result', 'createdAt', 'expiresAt',
  ];

  function sessionError(code) {
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

  function exactText(value, maximum, code) {
    if (typeof value !== 'string' || !value || value.length > maximum
      || value !== value.normalize('NFKC').trim()
      || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw sessionError(code);
    }
    return value;
  }

  function tabId(value, code) {
    if (!Number.isSafeInteger(value) || value < 0) throw sessionError(code);
    return value;
  }

  function positiveInteger(value, code) {
    if (!Number.isSafeInteger(value) || value < 1) throw sessionError(code);
    return value;
  }

  function normalizeContext(value) {
    var code = 'SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID';
    if (!exactKeys(value, CONTEXT_KEYS) || value.contractVersion !== CONTEXT_VERSION) {
      throw sessionError(code);
    }
    var sourcePlatform = exactText(value.sourcePlatform, 16, code);
    var skuKey = exactText(value.skuKey, 500, code);
    var slotKey = exactText(value.slotKey, 200, code);
    if (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)
      || value.assignmentMode !== 'APPEND'
      || slotKey !== 'sku:' + skuKey + ':hero'
      || !Number.isSafeInteger(value.assignmentOrdinal)
      || value.assignmentOrdinal < 0
      || value.assignmentOrdinal > 499) {
      throw sessionError(code);
    }
    return Object.freeze({
      contractVersion: CONTEXT_VERSION,
      sourcePlatform: sourcePlatform,
      sourceProductId: exactText(value.sourceProductId, 200, code),
      sourceCaptureSnapshotId: exactText(value.sourceCaptureSnapshotId, 200, code),
      supplyGoodsId: exactText(value.supplyGoodsId, 200, code),
      shopId: exactText(value.shopId, 200, code),
      workflowId: exactText(value.workflowId, 200, code),
      draftRevision: positiveInteger(value.draftRevision, code),
      draftVersion: positiveInteger(value.draftVersion, code),
      skuKey: skuKey,
      slotKey: slotKey,
      assignmentMode: 'APPEND',
      assignmentOrdinal: value.assignmentOrdinal,
    });
  }

  function sameContext(left, right) {
    var normalized;
    try { normalized = normalizeContext(right); } catch (_error) { return false; }
    return CONTEXT_KEYS.every(function (key) { return left[key] === normalized[key]; });
  }

  function normalizeResult(value) {
    if (value === null) return null;
    if (!exactKeys(value, ['resultId', 'reviewState'])) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    }
    var resultId = exactText(value.resultId, 128, 'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    if (!/^br_[a-f0-9]{48}$/u.test(resultId)
      || !['CANDIDATE_READY', 'APPROVED'].includes(value.reviewState)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID');
    }
    return Object.freeze({ resultId: resultId, reviewState: value.reviewState });
  }

  function normalizeOperation(value) {
    if (value === null) return null;
    if (!exactKeys(value, ['idempotencyKey', 'state'])
      || value.state !== 'OUTCOME_UNRESOLVED') {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID');
    }
    var idempotencyKey = exactText(
      value.idempotencyKey,
      128,
      'SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID',
    );
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(idempotencyKey)) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_INVALID');
    }
    return Object.freeze({ idempotencyKey: idempotencyKey, state: 'OUTCOME_UNRESOLVED' });
  }

  function normalizeSession(value, current, ttlMs) {
    try {
      if (!exactKeys(value, SESSION_KEYS) || value.contractVersion !== CONTRACT_VERSION) return null;
      var createdAt = Number(value.createdAt);
      var expiresAt = Number(value.expiresAt);
      if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt)
        || expiresAt <= current || createdAt > current + 60 * 1000
        || expiresAt <= createdAt || expiresAt - createdAt > ttlMs) return null;
      var workbenchDocumentId = value.workbenchDocumentId === null
        ? null
        : exactText(value.workbenchDocumentId, 200, 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID');
      return Object.freeze({
        contractVersion: CONTRACT_VERSION,
        context: normalizeContext(value.context),
        sourceTabId: tabId(value.sourceTabId, 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID'),
        sourceDocumentId: exactText(
          value.sourceDocumentId,
          200,
          'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID',
        ),
        workbenchTabId: tabId(value.workbenchTabId, 'SS_ERP_BYOK_WORKBENCH_SESSION_INVALID'),
        workbenchDocumentId: workbenchDocumentId,
        operation: normalizeOperation(value.operation),
        result: normalizeResult(value.result),
        createdAt: createdAt,
        expiresAt: expiresAt,
      });
    } catch (_error) {
      return null;
    }
  }

  function senderIdentity(value) {
    if (!isRecord(value) || value.frameId !== 0) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
    }
    return {
      tabId: tabId(value.tabId, 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED'),
      documentId: exactText(
        value.documentId,
        200,
        'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED',
      ),
    };
  }

  function createManager(options) {
    var storage = options && options.sessionStorage;
    var tabs = options && options.tabs;
    var runtime = options && options.runtime;
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    var ttlMs = Number(options && options.ttlMs) || DEFAULT_TTL_MS;
    var limit = Number(options && options.limit) || DEFAULT_LIMIT;
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || typeof storage.remove !== 'function'
      || !tabs || typeof tabs.create !== 'function' || typeof tabs.update !== 'function'
      || !runtime || typeof runtime.getURL !== 'function'
      || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_TTL_MS
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 32) {
      throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_DEPENDENCY_UNAVAILABLE');
    }
    var queue = Promise.resolve();

    function enqueue(operation) {
      var next = queue.then(operation, operation);
      queue = next.catch(function () {});
      return next;
    }

    function currentMillis() {
      var value = Number(now());
      if (!Number.isSafeInteger(value)) {
        throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_INVALID');
      }
      return value;
    }

    function renewLease(session, current) {
      return {
        ...session,
        createdAt: current,
        expiresAt: current + ttlMs,
      };
    }

    async function loadRecords(current) {
      var stored = await storage.get([STORAGE_KEY]);
      var raw = stored && stored[STORAGE_KEY];
      var records = isRecord(raw) ? raw : {};
      var valid = {};
      Object.keys(records).forEach(function (key) {
        var session = normalizeSession(records[key], current, ttlMs);
        if (session && String(session.workbenchTabId) === key) valid[key] = session;
      });
      return valid;
    }

    async function storeRecords(records) {
      if (!Object.keys(records).length) {
        await storage.remove([STORAGE_KEY]);
        return;
      }
      await storage.set({ [STORAGE_KEY]: records });
    }

    async function mutateForSender(sender, operation) {
      var identity = senderIdentity(sender);
      return enqueue(async function () {
        var current = currentMillis();
        var records = await loadRecords(current);
        var session = records[String(identity.tabId)];
        if (!session) {
          await storeRecords(records);
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_NOT_FOUND');
        }
        if (session.workbenchDocumentId !== null
          && session.workbenchDocumentId !== identity.documentId) {
          delete records[String(identity.tabId)];
          await storeRecords(records);
          var denied = sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
          if (session.result && session.result.resultId) {
            denied.discardedResultId = session.result.resultId;
          }
          throw denied;
        }
        var next = operation(session, identity, current);
        var normalized = normalizeSession(next, current, ttlMs);
        if (!normalized) throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_INVALID');
        records[String(identity.tabId)] = normalized;
        await storeRecords(records);
        return normalized;
      });
    }

    async function open(value) {
      var context = normalizeContext(value && value.context);
      var sourceTabId = tabId(
        value && value.sourceTabId,
        'SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID',
      );
      var sourceDocumentId = exactText(
        value && value.sourceDocumentId,
        200,
        'SS_ERP_BYOK_WORKBENCH_SESSION_CONTEXT_INVALID',
      );
      var created = await tabs.create({
        url: runtime.getURL('pages/ai-image-workbench-launch.html'),
        active: true,
      });
      var workbenchTabId;
      try {
        workbenchTabId = tabId(
          created && created.id,
          'SS_ERP_BYOK_WORKBENCH_SESSION_OPEN_FAILED',
        );
        await enqueue(async function () {
          var current = currentMillis();
          var records = await loadRecords(current);
          var ordered = Object.values(records).sort(function (left, right) {
            return left.createdAt - right.createdAt || left.workbenchTabId - right.workbenchTabId;
          });
          while (ordered.length >= limit) {
            var discarded = ordered.shift();
            delete records[String(discarded.workbenchTabId)];
          }
          records[String(workbenchTabId)] = {
            contractVersion: CONTRACT_VERSION,
            context: context,
            sourceTabId: sourceTabId,
            sourceDocumentId: sourceDocumentId,
            workbenchTabId: workbenchTabId,
            workbenchDocumentId: null,
            operation: null,
            result: null,
            createdAt: current,
            expiresAt: current + ttlMs,
          };
          await storeRecords(records);
        });
        await tabs.update(workbenchTabId, {
          url: runtime.getURL('pages/ai-image-workbench.html'),
          active: true,
        });
        return Object.freeze({ state: 'workbench_opened', tabId: workbenchTabId });
      } catch (error) {
        if (Number.isSafeInteger(workbenchTabId)) {
          await enqueue(async function () {
            var records = await loadRecords(currentMillis());
            delete records[String(workbenchTabId)];
            await storeRecords(records);
          }).catch(function () {});
          if (typeof tabs.remove === 'function') {
            try { await tabs.remove(workbenchTabId); } catch (_removeError) {}
          }
        }
        throw error;
      }
    }

    function claim(sender) {
      return mutateForSender(sender, function (session, identity, current) {
        return renewLease({ ...session, workbenchDocumentId: identity.documentId }, current);
      });
    }

    function beginOperation(sender, idempotencyKeyValue) {
      var operation = normalizeOperation({
        idempotencyKey: idempotencyKeyValue,
        state: 'OUTCOME_UNRESOLVED',
      });
      return mutateForSender(sender, function (session, _identity, current) {
        if (session.result) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        if (session.operation) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return renewLease({ ...session, operation: operation }, current);
      });
    }

    function clearOperation(sender, idempotencyKeyValue) {
      var operation = normalizeOperation({
        idempotencyKey: idempotencyKeyValue,
        state: 'OUTCOME_UNRESOLVED',
      });
      return mutateForSender(sender, function (session) {
        if (!session.operation
          || session.operation.idempotencyKey !== operation.idempotencyKey) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return { ...session, operation: null };
      });
    }

    function attachResult(sender, result, idempotencyKeyValue) {
      var normalizedResult = normalizeResult(result);
      var operation = normalizeOperation({
        idempotencyKey: idempotencyKeyValue,
        state: 'OUTCOME_UNRESOLVED',
      });
      if (!normalizedResult || normalizedResult.reviewState !== 'CANDIDATE_READY') {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session) {
        if (session.result && session.result.resultId !== normalizedResult.resultId) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        if (session.result) return session;
        if (!session.operation
          || session.operation.idempotencyKey !== operation.idempotencyKey) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_OPERATION_CONFLICT');
        }
        return { ...session, operation: null, result: normalizedResult };
      });
    }

    function setReviewState(sender, resultIdValue, reviewState) {
      var resultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      if (reviewState !== 'APPROVED') {
        return Promise.reject(sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID'));
      }
      return mutateForSender(sender, function (session) {
        if (!session.result || session.result.resultId !== resultId
          || session.result.reviewState !== 'CANDIDATE_READY') {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return { ...session, result: { resultId: resultId, reviewState: 'APPROVED' } };
      });
    }

    function clearResult(sender, resultIdValue) {
      var resultId = exactText(
        resultIdValue,
        128,
        'SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_INVALID',
      );
      return mutateForSender(sender, function (session) {
        if (!session.result || session.result.resultId !== resultId) {
          throw sessionError('SS_ERP_BYOK_WORKBENCH_SESSION_RESULT_CONFLICT');
        }
        return { ...session, result: null };
      });
    }

    function takeByTab(value) {
      var id = tabId(value, 'SS_ERP_BYOK_WORKBENCH_SESSION_SENDER_DENIED');
      return enqueue(async function () {
        var records = await loadRecords(currentMillis());
        var session = records[String(id)] || null;
        if (!session) {
          await storeRecords(records);
          return null;
        }
        delete records[String(id)];
        await storeRecords(records);
        return session;
      });
    }

    function removeByTab(value) {
      return takeByTab(value).then(function (session) { return session ? 1 : 0; });
    }

    function clear() {
      return enqueue(async function () {
        await storage.remove([STORAGE_KEY]);
      });
    }

    return Object.freeze({
      open: open,
      claim: claim,
      beginOperation: beginOperation,
      clearOperation: clearOperation,
      attachResult: attachResult,
      setReviewState: setReviewState,
      clearResult: clearResult,
      removeByTab: removeByTab,
      takeByTab: takeByTab,
      clear: clear,
      sameContext: sameContext,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    CONTEXT_VERSION: CONTEXT_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    createManager: createManager,
    normalizeContext: normalizeContext,
    sameContext: sameContext,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
