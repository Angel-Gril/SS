(function (root) {
  'use strict';

  function positiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  }

  function createCoordinator(options) {
    var contract = options && options.contract;
    var storage = options && options.storage;
    var windowsApi = options && options.windows;
    var tabsApi = options && options.tabs;
    var runtime = options && options.runtime;
    var cryptoValue = options && options.crypto;
    var storageKey = String(options && options.storageKey || '').trim();
    var ttlMs = positiveInteger(options && options.ttlMs);
    var submitLeaseMs = positiveInteger(options && options.submitLeaseMs);
    var minimumSubmitRemainingMs = positiveInteger(
      options && options.minimumSubmitRemainingMs,
    );
    var limit = positiveInteger(options && options.limit);
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    var launchPath = String(options && options.launchPath || 'pages/media-confirm-launch.html');
    var editorPath = String(options && options.editorPath || 'pages/media-editor.html');
    if (!contract || typeof contract.createNonce !== 'function'
      || typeof contract.isNonce !== 'function'
      || typeof contract.normalizeSession !== 'function'
      || typeof contract.normalizeMaskCheckpoint !== 'function'
      || typeof contract.normalizeCompletion !== 'function'
      || typeof contract.bindSender !== 'function'
      || typeof contract.isBoundSender !== 'function'
      || typeof contract.createSerialQueue !== 'function'
      || !storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || !windowsApi || typeof windowsApi.create !== 'function'
      || !tabsApi || typeof tabsApi.query !== 'function' || typeof tabsApi.update !== 'function'
      || !runtime || typeof runtime.getURL !== 'function'
      || !cryptoValue || typeof cryptoValue.getRandomValues !== 'function'
      || !storageKey || !ttlMs || !submitLeaseMs
      || !minimumSubmitRemainingMs || minimumSubmitRemainingMs > submitLeaseMs
      || !limit || !launchPath || !editorPath) {
      throw new Error('media editor coordinator options are invalid');
    }
    var writeQueue = Promise.resolve();
    var submitQueues = new Map();

    function normalize(value, currentTime) {
      return contract.normalizeSession(value, {
        now: currentTime,
        maximumLifetimeMs: ttlMs,
        maximumSubmitLeaseMs: submitLeaseMs,
      });
    }

    function enqueueSubmit(nonce, operation) {
      var previous = submitQueues.get(nonce) || Promise.resolve();
      var next = previous.then(operation, operation);
      var settled = next.catch(function () {});
      submitQueues.set(nonce, settled);
      return next.finally(function () {
        if (submitQueues.get(nonce) === settled) submitQueues.delete(nonce);
      });
    }

    function enqueueWrite(operation) {
      var next = writeQueue.then(operation, operation);
      writeQueue = next.catch(function () {});
      return next;
    }

    async function loadRecords() {
      var stored = await storage.get([storageKey]);
      var raw = stored && stored[storageKey];
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    }

    async function storeRecords(records) {
      await storage.set({ [storageKey]: records });
    }

    async function read(nonceValue) {
      var nonce = String(nonceValue || '').trim();
      if (!contract.isNonce(nonce)) return null;
      var records = await loadRecords();
      return normalize(records[nonce], now());
    }

    async function remove(nonceValue) {
      var nonce = String(nonceValue || '').trim();
      if (!contract.isNonce(nonce)) return;
      await enqueueWrite(async function () {
        var records = await loadRecords();
        if (!Object.prototype.hasOwnProperty.call(records, nonce)) return;
        delete records[nonce];
        await storeRecords(records);
      });
    }

    async function persist(input) {
      return enqueueWrite(async function () {
        var currentTime = now();
        var session = normalize({
          ...input,
          maskCheckpoint: null,
          completion: null,
          createdAt: currentTime,
          expiresAt: currentTime + ttlMs,
          submitLeaseExpiresAt: null,
          completedAt: null,
        }, currentTime);
        if (!session) throw new Error('ERP 局部重绘编辑器上下文无效');
        var records = await loadRecords();
        var valid = Object.entries(records)
          .map(function (entry) { return [entry[0], normalize(entry[1], currentTime)]; })
          .filter(function (entry) { return Boolean(entry[1]); })
          .sort(function (left, right) {
            return left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]);
          });
        var protectedRecovery = valid.filter(function (entry) {
          return !entry[1].completion && entry[1].submitLeaseExpiresAt !== null;
        });
        if (protectedRecovery.length >= limit) {
          throw new Error('ERP 局部重绘恢复会话已达上限，请先恢复已有任务');
        }
        var ordinarySlots = limit - protectedRecovery.length - 1;
        var ordinaryCandidates = valid.filter(function (entry) {
          return entry[1].completion || entry[1].submitLeaseExpiresAt === null;
        });
        var ordinary = ordinarySlots > 0
          ? ordinaryCandidates.slice(-ordinarySlots)
          : [];
        var bounded = Object.fromEntries([
          ...protectedRecovery,
          ...ordinary,
          [session.nonce, session],
        ]);
        await storeRecords(bounded);
        return session;
      });
    }

    function samePreparedSource(left, right) {
      if (left === null || right === null) return left === right;
      if (!left || !right) return false;
      return [
        'sourceMediaKey', 'sourceAssetId', 'mimeType', 'width', 'height',
        'maskSemantics', 'maxMaskBytes',
      ].every(function (field) { return left[field] === right[field]; });
    }

    function sameExactContext(session, input) {
      var left = session.erpSourceAuthority;
      var right = input && input.erpSourceAuthority;
      if ((left === undefined || right === undefined) && left !== right) return false;
      if (left && right && ['provenance', 'ownerUserId', 'deviceSessionId', 'apiOrigin', 'webOrigin'].some(function (key) {
        return left[key] !== right[key];
      })) return false;
      if (Boolean(session.target) !== Boolean(input && input.target)
        || session.target && ['skuKey', 'slotKey'].some(function (key) {
          return session.target[key] !== input.target[key];
        })) return false;
      return Boolean(input && Array.isArray(input.sourceMediaKeys)) && [
        'platform', 'sourceProductId', 'snapshotId', 'supplyGoodsId', 'shopId',
        'listingWorkflowId', 'revision', 'draftVersion', 'operation',
      ].every(function (field) { return session[field] === input[field]; })
        && session.sourceMediaKeys.length === input.sourceMediaKeys.length
        && session.sourceMediaKeys.every(function (key, index) {
          return key === input.sourceMediaKeys[index];
        })
        && samePreparedSource(session.preparedSource, input.preparedSource);
    }

    async function reuseRecoverable(input, editorTabId) {
      return enqueueWrite(async function () {
        var currentTime = now();
        var records = await loadRecords();
        var matches = Object.values(records)
          .map(function (value) { return normalize(value, currentTime); })
          .filter(function (session) {
            return Boolean(session && !session.completion && session.submitLeaseExpiresAt
              && sameExactContext(session, input));
          })
          .sort(function (left, right) {
            return right.createdAt - left.createdAt || right.nonce.localeCompare(left.nonce);
          });
        if (!matches.length) return null;
        var recovered = normalize({
          ...matches[0],
          sourceTabId: input.sourceTabId,
          editorTabId: editorTabId,
          editorDocumentId: null,
          ...(input.erpSourceAuthority ? { erpSourceAuthority: input.erpSourceAuthority } : {}),
        }, currentTime);
        if (!recovered) throw new Error('ERP 局部重绘恢复会话无效');
        records[recovered.nonce] = recovered;
        await storeRecords(records);
        return recovered;
      });
    }

    async function claim(nonceValue, sender) {
      return enqueueWrite(async function () {
        var nonce = String(nonceValue || '').trim();
        if (!contract.isNonce(nonce)) return null;
        var currentTime = now();
        var records = await loadRecords();
        var current = normalize(records[nonce], currentTime);
        var bound = current ? contract.bindSender(current, sender) : null;
        var normalized = bound ? normalize(bound, currentTime) : null;
        if (!normalized) return null;
        if (current.editorDocumentId !== normalized.editorDocumentId) {
          records[nonce] = normalized;
          await storeRecords(records);
        }
        return normalized;
      });
    }

    async function resolveEditorTabId(popup) {
      var tabId = Number(popup && popup.tabs && popup.tabs[0] && popup.tabs[0].id);
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        var popupTabs = Number.isSafeInteger(popup && popup.id)
          ? await tabsApi.query({ windowId: popup.id })
          : [];
        tabId = Number(popupTabs && popupTabs[0] && popupTabs[0].id);
      }
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        throw new Error('ERP 局部重绘窗口身份不可用');
      }
      return tabId;
    }

    async function open(input) {
      var nonce = contract.createNonce(cryptoValue);
      var popup = null;
      var session = null;
      var createdSession = false;
      try {
        popup = await windowsApi.create({
          url: runtime.getURL(launchPath),
          type: 'popup',
          width: 1180,
          height: 860,
          focused: true,
        });
        var editorTabId = await resolveEditorTabId(popup);
        session = await reuseRecoverable(input, editorTabId);
        if (!session) {
          session = await persist({
            ...input,
            nonce: nonce,
            editorTabId: editorTabId,
            editorDocumentId: null,
          });
          createdSession = true;
        }
        await tabsApi.update(editorTabId, {
          url: runtime.getURL(editorPath + '#nonce=' + encodeURIComponent(session.nonce)),
        });
      } catch (error) {
        if (createdSession) await remove(session && session.nonce || nonce);
        if (Number.isSafeInteger(popup && popup.id)
          && typeof windowsApi.remove === 'function') {
          try { await windowsApi.remove(popup.id); } catch {}
        }
        throw error;
      }
      return { state: 'editor_opened' };
    }

    async function handleTabRemoved(tabIdValue) {
      var tabId = Number(tabIdValue);
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        return { state: 'ignored', removed: 0, retained: 0 };
      }
      return enqueueWrite(async function () {
        var currentTime = now();
        var records = await loadRecords();
        var removed = 0;
        var retained = 0;
        Object.entries(records).forEach(function (entry) {
          var session = normalize(entry[1], currentTime);
          if (!session || session.editorTabId !== tabId) return;
          if (!session.completion && session.submitLeaseExpiresAt !== null) {
            retained += 1;
            return;
          }
          delete records[entry[0]];
          removed += 1;
        });
        if (removed > 0) await storeRecords(records);
        return { state: 'cleaned', removed: removed, retained: retained };
      });
    }

    function assertBoundSender(session, sender) {
      if (!contract.isBoundSender(session, sender)) {
        throw new Error('局部重绘窗口身份无效，请从商品页重新发起');
      }
    }

    async function submit(nonceValue, sender, execute) {
      if (typeof execute !== 'function') throw new Error('media editor execute is required');
      var submitNonce = String(nonceValue || '').trim();
      return enqueueSubmit(submitNonce, async function () {
        var session = await read(nonceValue);
        if (!session) throw new Error('局部重绘会话已失效，请从商品页重新发起');
        assertBoundSender(session, sender);
        if (session.completion) {
          return { state: 'completed', replay: true, result: session.completion };
        }
        session = await enqueueWrite(async function () {
          var currentTime = now();
          var records = await loadRecords();
          var current = normalize(records[session.nonce], currentTime);
          if (!current || current.completion) {
            throw new Error('局部重绘会话状态已变化');
          }
          assertBoundSender(current, sender);
          var leaseExpiresAt = current.submitLeaseExpiresAt || current.expiresAt + submitLeaseMs;
          if (leaseExpiresAt - currentTime < minimumSubmitRemainingMs) {
            throw new Error('局部重绘会话即将失效，请从商品页重新发起');
          }
          var leased = normalize({
            ...current,
            submitLeaseExpiresAt: leaseExpiresAt,
          }, currentTime);
          if (!leased) throw new Error('局部重绘会话租约无效');
          records[leased.nonce] = leased;
          await storeRecords(records);
          return leased;
        });

        async function checkpointMask(input) {
          if (!input || !session.preparedSource) {
            throw new Error('局部重绘遮罩检查点无效');
          }
          var checkpoint = contract.normalizeMaskCheckpoint({
            ...input,
            sourceMediaKey: session.preparedSource.sourceMediaKey,
            sourceAssetId: session.preparedSource.sourceAssetId,
            sourceWidth: session.preparedSource.width,
            sourceHeight: session.preparedSource.height,
          });
          if (!checkpoint) throw new Error('局部重绘遮罩检查点无效');
          session = await enqueueWrite(async function () {
            var currentTime = now();
            var records = await loadRecords();
            var current = normalize(records[session.nonce], currentTime);
            if (!current || current.completion) {
              throw new Error('局部重绘会话状态已变化');
            }
            assertBoundSender(current, sender);
            var next = normalize({ ...current, maskCheckpoint: checkpoint }, currentTime);
            if (!next) throw new Error('局部重绘遮罩检查点无效');
            records[next.nonce] = next;
            await storeRecords(records);
            return next;
          });
          return session;
        }

        var executed = await execute(session, checkpointMask);
        var completion = contract.normalizeCompletion(executed && executed.result);
        if (!completion || typeof (executed && executed.replay) !== 'boolean') {
          throw new Error('局部重绘任务创建结果无效');
        }
        session = await enqueueWrite(async function () {
          var currentTime = now();
          var records = await loadRecords();
          var current = normalize(records[session.nonce], currentTime);
          if (!current || current.completion) throw new Error('局部重绘会话状态已变化');
          assertBoundSender(current, sender);
          var completed = normalize({
            ...current,
            completion: completion,
            completedAt: currentTime,
          }, currentTime);
          if (!completed) throw new Error('局部重绘完成状态无效');
          records[completed.nonce] = completed;
          await storeRecords(records);
          return completed;
        });
        return { state: 'completed', replay: executed.replay, result: session.completion };
      });
    }

    async function cancel(nonceValue, sender) {
      var submitNonce = String(nonceValue || '').trim();
      return enqueueSubmit(submitNonce, async function () {
        var session = await read(nonceValue);
        if (session) assertBoundSender(session, sender);
        if (session && session.completion) return { state: 'completed' };
        if (session && session.submitLeaseExpiresAt !== null) {
          return { state: 'recovery_required' };
        }
        if (session) await remove(session.nonce);
        return { state: 'cancelled' };
      });
    }

    return {
      open: open,
      read: read,
      claim: claim,
      submit: submit,
      cancel: cancel,
      handleTabRemoved: handleTabRemoved,
    };
  }

  root.SS_ERP_SOURCE_MEDIA_EDITOR_COORDINATOR = {
    createCoordinator: createCoordinator,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
