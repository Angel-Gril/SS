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
    var limit = positiveInteger(options && options.limit);
    var now = options && typeof options.now === 'function' ? options.now : Date.now;
    var launchPath = String(options && options.launchPath || 'pages/media-confirm-launch.html');
    var confirmationPath = String(options && options.confirmationPath || 'pages/media-confirm.html');
    if (!contract || typeof contract.createNonce !== 'function'
      || typeof contract.isNonce !== 'function'
      || typeof contract.normalizeIntent !== 'function'
      || typeof contract.createSerialQueue !== 'function'
      || typeof contract.bindSender !== 'function'
      || typeof contract.isBoundSender !== 'function'
      || !storage || typeof storage.get !== 'function' || typeof storage.set !== 'function'
      || !windowsApi || typeof windowsApi.create !== 'function'
      || !tabsApi || typeof tabsApi.query !== 'function' || typeof tabsApi.update !== 'function'
      || !runtime || typeof runtime.getURL !== 'function'
      || !cryptoValue || typeof cryptoValue.getRandomValues !== 'function'
      || !storageKey || !ttlMs || !limit || !launchPath || !confirmationPath) {
      throw new Error('media confirmation coordinator options are invalid');
    }

    var writeQueue = Promise.resolve();
    var actionQueue = contract.createSerialQueue();

    function enqueueWrite(operation) {
      var next = writeQueue.then(operation, operation);
      writeQueue = next.catch(function () {});
      return next;
    }

    function normalize(value, currentTime) {
      return contract.normalizeIntent(value, {
        now: currentTime,
        maximumLifetimeMs: ttlMs,
      });
    }

    async function loadRecords() {
      var stored = await storage.get([storageKey]);
      var raw = stored && stored[storageKey];
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
    }

    async function read(nonceValue) {
      var nonce = String(nonceValue || '').trim();
      if (!contract.isNonce(nonce)) return null;
      var records = await loadRecords();
      return normalize(records[nonce], now());
    }

    async function persist(input) {
      return enqueueWrite(async function () {
        var currentTime = now();
        var nonce = String(input && input.nonce || '').trim();
        var intent = normalize({
          ...input,
          createdAt: currentTime,
          expiresAt: currentTime + ttlMs,
          completedAt: null,
        }, currentTime);
        if (!contract.isNonce(nonce) || !intent) {
          throw new Error('ERP 媒体确认内容无效');
        }
        var records = await loadRecords();
        records[nonce] = intent;
        var bounded = Object.fromEntries(Object.entries(records)
          .map(function (entry) { return [entry[0], normalize(entry[1], currentTime)]; })
          .filter(function (entry) { return Boolean(entry[1]); })
          .sort(function (left, right) {
            return left[1].createdAt - right[1].createdAt || left[0].localeCompare(right[0]);
          })
          .slice(-limit));
        await storage.set({ [storageKey]: bounded });
        return intent;
      });
    }

    async function remove(nonceValue) {
      var nonce = String(nonceValue || '').trim();
      if (!contract.isNonce(nonce)) return;
      await enqueueWrite(async function () {
        var records = await loadRecords();
        if (!Object.prototype.hasOwnProperty.call(records, nonce)) return;
        delete records[nonce];
        await storage.set({ [storageKey]: records });
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
        if (current.confirmationDocumentId !== normalized.confirmationDocumentId) {
          records[nonce] = normalized;
          await storage.set({ [storageKey]: records });
        }
        return normalized;
      });
    }

    async function complete(confirmation) {
      return enqueueWrite(async function () {
        var currentTime = now();
        if (!confirmation || !contract.isNonce(confirmation.nonce)) return null;
        var records = await loadRecords();
        var authorizedAt = Math.min(currentTime, confirmation.expiresAt - 1);
        var current = normalize(records[confirmation.nonce], authorizedAt);
        var expected = normalize(confirmation, authorizedAt);
        if (!current || !expected || current.completedAt !== null
          || JSON.stringify(current) !== JSON.stringify(expected)) return null;
        var completed = normalize({ ...current, completedAt: currentTime }, currentTime);
        if (!completed) return null;
        records[confirmation.nonce] = completed;
        await storage.set({ [storageKey]: records });
        return completed;
      });
    }

    function assertBoundSender(confirmation, sender) {
      if (!contract.isBoundSender(confirmation, sender)) {
        throw new Error('图片确认窗口身份无效，请从商品页重新发起');
      }
    }

    async function resolveConfirmationTabId(popup) {
      var tabId = Number(popup && popup.tabs && popup.tabs[0] && popup.tabs[0].id);
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        var popupTabs = Number.isSafeInteger(popup && popup.id)
          ? await tabsApi.query({ windowId: popup.id })
          : [];
        tabId = Number(popupTabs && popupTabs[0] && popupTabs[0].id);
      }
      if (!Number.isSafeInteger(tabId) || tabId < 0) {
        throw new Error('ERP 媒体确认窗口身份不可用');
      }
      return tabId;
    }

    async function open(input) {
      var nonce = contract.createNonce(cryptoValue);
      var popup = null;
      var confirmation = null;
      try {
        popup = await windowsApi.create({
          url: runtime.getURL(launchPath),
          type: 'popup',
          width: 440,
          height: 640,
          focused: true,
        });
        var confirmationTabId = await resolveConfirmationTabId(popup);
        confirmation = await persist({
          ...input,
          nonce: nonce,
          confirmationTabId: confirmationTabId,
          confirmationDocumentId: null,
        });
        await tabsApi.update(confirmationTabId, {
          url: runtime.getURL(
            confirmationPath + '#nonce=' + encodeURIComponent(confirmation.nonce),
          ),
        });
      } catch (error) {
        await remove(confirmation && confirmation.nonce || nonce);
        if (Number.isSafeInteger(popup && popup.id)
          && typeof windowsApi.remove === 'function') {
          try { await windowsApi.remove(popup.id); } catch {}
        }
        throw error;
      }
      return { state: 'confirmation_opened' };
    }

    async function submit(nonce, sender, execute) {
      if (typeof execute !== 'function') throw new Error('media confirmation execute is required');
      return actionQueue.run(async function () {
        var confirmation = await read(nonce);
        if (!confirmation) throw new Error('图片确认已失效，请从商品页重新发起');
        assertBoundSender(confirmation, sender);
        if (confirmation.completedAt !== null) {
          return {
            state: 'completed', replay: true, completedNow: false,
            confirmation: confirmation,
          };
        }
        var mutation = await execute(confirmation);
        var completed = await complete(confirmation);
        if (!completed) throw new Error('图片操作已执行，但确认状态暂不可用，请刷新商品页');
        return {
          state: 'completed',
          replay: Boolean(mutation && mutation.replay === true),
          completedNow: true,
          confirmation: completed,
        };
      });
    }

    async function cancel(nonce, sender) {
      return actionQueue.run(async function () {
        var confirmation = await read(nonce);
        if (confirmation) assertBoundSender(confirmation, sender);
        if (confirmation && confirmation.completedAt === null) {
          await remove(confirmation.nonce);
        }
        return {
          state: confirmation && confirmation.completedAt !== null ? 'completed' : 'cancelled',
        };
      });
    }

    return {
      open: open,
      read: read,
      claim: claim,
      submit: submit,
      cancel: cancel,
    };
  }

  root.SS_ERP_SOURCE_MEDIA_CONFIRMATION_COORDINATOR = {
    createCoordinator: createCoordinator,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
