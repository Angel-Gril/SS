(function exposeByokDeviceSessionLifecycle(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-device-session-lifecycle/v1';
  var INVALIDATED_MESSAGE = 'ss-erp:byok-device-session-invalidated';
  var AUTHORITY_EPOCH_STORAGE_KEY = 'ss-erp:byok:device-authority-epoch:v1';
  var AUTHORITY_LOCK_NAME = 'ss-erp:byok:device-authority:v1';

  function lifecycleError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') {
      throw lifecycleError('SS_ERP_BYOK_DEVICE_LIFECYCLE_DEPENDENCY_UNAVAILABLE');
    }
    return value[name].bind(value);
  }

  function createLifecycle(options) {
    var credentials = options && options.credentials;
    var clearByokState = options && options.clearByokState;
    var sessionStorage = options && options.sessionStorage;
    var lockManager = options && options.lockManager;
    var claim = requiredMethod(credentials, 'claim');
    var clear = requiredMethod(credentials, 'clear');
    var clearIfCurrent = requiredMethod(credentials, 'clearIfCurrent');
    var getAccessToken = requiredMethod(credentials, 'getAccessToken');
    var getStatus = requiredMethod(credentials, 'getStatus');
    var getConnection = requiredMethod(credentials, 'getConnection');
    var beginOperation = requiredMethod(credentials, 'beginOperation');
    var isOperationCurrent = requiredMethod(credentials, 'isOperationCurrent');
    var readSessionStorage = requiredMethod(sessionStorage, 'get');
    var writeSessionStorage = requiredMethod(sessionStorage, 'set');
    var requestAuthorityLock = requiredMethod(lockManager, 'request');
    if (typeof clearByokState !== 'function') {
      throw lifecycleError('SS_ERP_BYOK_DEVICE_LIFECYCLE_DEPENDENCY_UNAVAILABLE');
    }
    var cleanupTail = Promise.resolve();
    var authorityTail = Promise.resolve();
    var authorityInvalidations = 0;
    var authorityFailure = null;

    function authorityUnavailable() {
      if (!authorityFailure) {
        authorityFailure = lifecycleError(
          'SS_ERP_BYOK_DEVICE_LIFECYCLE_AUTHORITY_UNAVAILABLE',
        );
      }
      return authorityFailure;
    }

    async function readAuthorityEpoch() {
      if (authorityFailure) throw authorityFailure;
      try {
        var stored = await readSessionStorage([AUTHORITY_EPOCH_STORAGE_KEY]);
        var raw = stored && stored[AUTHORITY_EPOCH_STORAGE_KEY];
        var epoch = raw === undefined ? 0 : raw;
        if (!Number.isSafeInteger(epoch) || epoch < 0) throw authorityUnavailable();
        return epoch;
      } catch (error) {
        if (error === authorityFailure) throw error;
        throw authorityUnavailable();
      }
    }

    async function writeAuthorityEpoch(epoch) {
      if (authorityFailure) throw authorityFailure;
      try {
        await writeSessionStorage({ [AUTHORITY_EPOCH_STORAGE_KEY]: epoch });
      } catch {
        throw authorityUnavailable();
      }
    }

    async function withAuthorityLock(operation) {
      try {
        return await requestAuthorityLock(AUTHORITY_LOCK_NAME, operation);
      } catch (error) {
        if (error === authorityFailure) throw error;
        throw authorityUnavailable();
      }
    }

    function advanceAuthorityEpoch() {
      return withAuthorityLock(async function () {
        var epoch = await readAuthorityEpoch();
        if (epoch >= Number.MAX_SAFE_INTEGER) throw authorityUnavailable();
        var nextEpoch = epoch + 1;
        await writeAuthorityEpoch(nextEpoch);
        return nextEpoch;
      });
    }

    function cleanup(reason) {
      var next = cleanupTail.catch(function () {}).then(function () {
        return clearByokState({ reason: reason });
      });
      cleanupTail = next.catch(function () {});
      return next;
    }

    function enqueueInvalidation(operation) {
      // The pending marker changes synchronously so a result cannot commit
      // while the durable epoch advance or secret/vault cleanup is in flight.
      authorityInvalidations += 1;
      var next = authorityTail.catch(function () {}).then(async function () {
        try {
          return await operation();
        } finally {
          authorityInvalidations -= 1;
        }
      });
      authorityTail = next.catch(function () {});
      return next;
    }

    function invalidateAuthority(reason) {
      return enqueueInvalidation(async function () {
        var authorityError = null;
        try {
          await advanceAuthorityEpoch();
        } catch (error) {
          authorityError = error;
        }
        var cleanupError = null;
        try {
          await cleanup(reason);
        } catch (error) {
          cleanupError = error;
        }
        if (authorityError) throw authorityError;
        if (cleanupError) throw cleanupError;
      });
    }

    async function captureAuthority() {
      while (true) {
        var pending = authorityTail;
        await pending;
        if (authorityInvalidations > 0 || pending !== authorityTail) continue;
        var epoch = await withAuthorityLock(readAuthorityEpoch);
        if (authorityInvalidations > 0 || pending !== authorityTail) continue;
        return Object.freeze({
          contractVersion: CONTRACT_VERSION,
          epoch: epoch,
        });
      }
    }

    async function isAuthorityCurrent(snapshot) {
      if (authorityInvalidations > 0
        || !snapshot
        || typeof snapshot !== 'object'
        || snapshot.contractVersion !== CONTRACT_VERSION
        || !Number.isSafeInteger(snapshot.epoch)
        || snapshot.epoch < 0) return false;
      var pending = authorityTail;
      var epoch = await withAuthorityLock(readAuthorityEpoch);
      return authorityInvalidations === 0
        && pending === authorityTail
        && snapshot.epoch === epoch;
    }

    async function handleCredentialFailure(error) {
      var status = null;
      try {
        status = await getStatus();
      } catch (_statusError) {
        // The original credential failure remains authoritative.
      }
      if (status && status.state === 'unpaired') {
        await invalidateAuthority('device_authority_revoked');
      }
      throw error;
    }

    async function guardedCredentialCall(operation) {
      try {
        return await operation();
      } catch (error) {
        return handleCredentialFailure(error);
      }
    }

    return Object.freeze({
      async claim(input) {
        // A new claim establishes a new device-session authority. Clear any
        // ticket, secret, evidence, or generated bytes before it can be used.
        return enqueueInvalidation(async function () {
          var authorityError = null;
          try {
            await advanceAuthorityEpoch();
          } catch (error) {
            authorityError = error;
          }
          var cleanupError = null;
          try {
            await cleanup('device_claim');
          } catch (error) {
            cleanupError = error;
          }
          if (authorityError) throw authorityError;
          if (cleanupError) throw cleanupError;
          return claim(input);
        });
      },
      async clear() {
        return enqueueInvalidation(async function () {
          var authorityError = null;
          try {
            await advanceAuthorityEpoch();
          } catch (error) {
            authorityError = error;
          }
          var result;
          var credentialError = null;
          try {
            result = await clear();
          } catch (error) {
            credentialError = error;
          }
          var cleanupError = null;
          try {
            await cleanup('device_clear');
          } catch (error) {
            cleanupError = error;
          }
          if (authorityError) throw authorityError;
          if (credentialError) throw credentialError;
          if (cleanupError) throw cleanupError;
          return result;
        });
      },
      async clearIfCurrent(operation, reason) {
        var cleared = await clearIfCurrent(operation, reason);
        if (cleared) await invalidateAuthority('device_authority_revoked');
        return cleared;
      },
      getAccessToken: function () {
        return guardedCredentialCall(function () { return getAccessToken(); });
      },
      getStatus: getStatus,
      getConnection: getConnection,
      beginOperation: function () {
        return guardedCredentialCall(function () { return beginOperation(); });
      },
      isOperationCurrent: isOperationCurrent,
      captureAuthority: captureAuthority,
      isAuthorityCurrent: isAuthorityCurrent,
    });
  }

  global.SS_ERP_BYOK_DEVICE_SESSION_LIFECYCLE = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    INVALIDATED_MESSAGE: INVALIDATED_MESSAGE,
    AUTHORITY_EPOCH_STORAGE_KEY: AUTHORITY_EPOCH_STORAGE_KEY,
    createLifecycle: createLifecycle,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
