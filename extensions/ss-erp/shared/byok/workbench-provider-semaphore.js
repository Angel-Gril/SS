(function exposeByokWorkbenchProviderSemaphore(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-workbench-provider-semaphore/v1';
  var MAX_DEVICE_POOLS = 16;
  var MAX_PENDING_PER_DEVICE = 32;
  var MAX_PENDING_TOTAL = 64;

  function semaphoreError(code) {
    var error = new Error(code);
    error.name = 'ExtensionByokWorkbenchProviderSemaphoreError';
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

  function text(value, maximum) {
    if (typeof value !== 'string') {
      throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_INVALID');
    }
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_INVALID');
    }
    return normalized;
  }

  function createSemaphore(options) {
    var now = options && typeof options.now === 'function'
      ? options.now
      : function () { return new Date(); };
    var pools = new Map();

    function currentMillis() {
      var value = new Date(now()).getTime();
      if (!Number.isFinite(value)) {
        throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_INVALID');
      }
      return value;
    }

    function normalizeAuthority(value) {
      if (!exactKeys(value, [
        'ownerToken', 'ownerUserId', 'deviceSessionId', 'policyRevision',
        'maxConcurrency', 'expiresAt',
      ]) || !Number.isSafeInteger(value.maxConcurrency)
        || value.maxConcurrency < 1 || value.maxConcurrency > 4) {
        throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_INVALID');
      }
      var expiresAt = Date.parse(text(value.expiresAt, 64));
      if (!Number.isFinite(expiresAt)) {
        throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_INVALID');
      }
      return Object.freeze({
        ownerToken: text(value.ownerToken, 1000),
        ownerUserId: text(value.ownerUserId, 200),
        deviceSessionId: text(value.deviceSessionId, 200),
        policyRevision: text(value.policyRevision, 200),
        maxConcurrency: value.maxConcurrency,
        expiresAt: expiresAt,
      });
    }

    function authorityMatches(pool, authority) {
      return pool.ownerUserId === authority.ownerUserId
        && pool.policyRevision === authority.policyRevision
        && pool.maxConcurrency === authority.maxConcurrency;
    }

    function pendingCount() {
      var total = 0;
      pools.forEach(function (pool) { total += pool.queue.length; });
      return total;
    }

    function cleanupPool(pool) {
      if (pool.active.size || pool.queue.length) return;
      if (pools.get(pool.deviceSessionId) === pool) pools.delete(pool.deviceSessionId);
    }

    function rejectEntry(entry, error) {
      if (entry.settled) return false;
      entry.settled = true;
      entry.reject(error);
      return true;
    }

    function grant(pool, entry) {
      if (entry.authority.expiresAt <= currentMillis()) {
        rejectEntry(entry, semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_EXPIRED'));
        return false;
      }
      entry.settled = true;
      pool.active.add(entry);
      var released = false;
      entry.resolve(Object.freeze({
        release: function () {
          if (released) return false;
          released = true;
          if (!pool.active.delete(entry)) return false;
          pump(pool);
          cleanupPool(pool);
          return true;
        },
      }));
      return true;
    }

    function cancelQueue(pool, code) {
      var current = pool.queue.splice(0);
      var cancelled = 0;
      current.forEach(function (entry) {
        if (rejectEntry(entry, semaphoreError(code))) cancelled += 1;
      });
      return cancelled;
    }

    function pump(pool) {
      if (pool.invalidated) {
        cancelQueue(pool, 'SS_ERP_BYOK_PROVIDER_EXECUTION_CANCELLED');
        cleanupPool(pool);
        return;
      }
      while (pool.active.size < pool.maxConcurrency && pool.queue.length) {
        var entry = pool.queue.shift();
        if (!entry || entry.settled) continue;
        grant(pool, entry);
      }
      cleanupPool(pool);
    }

    async function acquire(value) {
      var authority = normalizeAuthority(value);
      if (authority.expiresAt <= currentMillis()) {
        throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_EXPIRED');
      }
      var pool = pools.get(authority.deviceSessionId);
      if (pool && pool.invalidated) {
        if (pool.active.size) {
          throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_CHANGED');
        }
        pools.delete(authority.deviceSessionId);
        pool = null;
      }
      if (pool && !authorityMatches(pool, authority)) {
        if (pool.active.size || pool.queue.length) {
          throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_CHANGED');
        }
        pools.delete(authority.deviceSessionId);
        pool = null;
      }
      if (!pool) {
        if (pools.size >= MAX_DEVICE_POOLS) {
          throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_QUEUE_FULL');
        }
        pool = {
          deviceSessionId: authority.deviceSessionId,
          ownerUserId: authority.ownerUserId,
          policyRevision: authority.policyRevision,
          maxConcurrency: authority.maxConcurrency,
          active: new Set(),
          queue: [],
          invalidated: false,
        };
        pools.set(authority.deviceSessionId, pool);
      }
      var ownerBusy = Array.from(pool.active).some(function (entry) {
        return entry.authority.ownerToken === authority.ownerToken;
      }) || pool.queue.some(function (entry) {
        return entry.authority.ownerToken === authority.ownerToken && !entry.settled;
      });
      if (ownerBusy) {
        throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_OWNER_BUSY');
      }
      var mustQueue = pool.active.size >= pool.maxConcurrency || pool.queue.length > 0;
      if (mustQueue && (pool.queue.length >= MAX_PENDING_PER_DEVICE
        || pendingCount() >= MAX_PENDING_TOTAL)) {
        throw semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_QUEUE_FULL');
      }
      return new Promise(function (resolve, reject) {
        var entry = { authority: authority, resolve: resolve, reject: reject, settled: false };
        if (!mustQueue) {
          grant(pool, entry);
          return;
        }
        pool.queue.push(entry);
        pump(pool);
      });
    }

    function cancelOwner(ownerTokenValue) {
      var ownerToken = text(ownerTokenValue, 1000);
      var cancelled = 0;
      pools.forEach(function (pool) {
        var retained = [];
        pool.queue.forEach(function (entry) {
          if (entry.authority.ownerToken !== ownerToken) {
            retained.push(entry);
            return;
          }
          if (rejectEntry(
            entry,
            semaphoreError('SS_ERP_BYOK_PROVIDER_EXECUTION_CANCELLED'),
          )) cancelled += 1;
        });
        pool.queue = retained;
        pump(pool);
      });
      return cancelled;
    }

    function invalidateAll() {
      var cancelled = 0;
      pools.forEach(function (pool) {
        pool.invalidated = true;
        cancelled += cancelQueue(pool, 'SS_ERP_BYOK_PROVIDER_EXECUTION_CANCELLED');
        cleanupPool(pool);
      });
      return cancelled;
    }

    return Object.freeze({
      acquire: acquire,
      cancelOwner: cancelOwner,
      invalidateAll: invalidateAll,
    });
  }

  global.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createSemaphore: createSemaphore,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
