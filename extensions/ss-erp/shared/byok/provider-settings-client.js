(function exposeByokProviderSettingsClient(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-provider-settings-client/v1';
  var DEVICE_SESSION_INVALIDATED_MESSAGE = 'ss-erp:byok-device-session-invalidated';
  var DEFAULT_TIMEOUT_MS = 15 * 1000;
  var CAPABILITY_TIMEOUT_MS = 135 * 1000;
  var MAX_PREPARED_PERMISSIONS = 64;
  var MESSAGE_TYPES = Object.freeze({
    GET_SETUP_CONTEXT: 'ss-erp:byok-provider-setup-context',
    LIST_PROFILES: 'ss-erp:byok-provider-profiles-list',
    GET_PROFILE_STATE: 'ss-erp:byok-provider-profile-state',
    SAVE_PROFILE: 'ss-erp:byok-provider-profile-save',
    REMOVE_PROFILE: 'ss-erp:byok-provider-profile-remove',
    SET_SESSION_KEY: 'ss-erp:byok-provider-session-key-set',
    CLEAR_SESSION_KEY: 'ss-erp:byok-provider-session-key-clear',
    PERMISSION_STATUS: 'ss-erp:byok-provider-permission-status',
    PREPARE_PERMISSION: 'ss-erp:byok-provider-permission-prepare',
    REQUEST_PERMISSION: 'ss-erp:byok-provider-permission-request',
    REVOKE_PERMISSION: 'ss-erp:byok-provider-permission-revoke',
    TEST_CAPABILITY: 'ss-erp:byok-provider-capability-test',
    GET_READINESS: 'ss-erp:byok-provider-readiness',
  });

  function clientError(code, details) {
    var error = new Error(code);
    error.code = code;
    if (details) Object.assign(error, details);
    return error;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function text(value, maximum) {
    if (typeof value !== 'string') throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    var normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized !== value || normalized.length > maximum
      || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return normalized;
  }

  function profileId(value) {
    var id = text(value, 128);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(id)) {
      throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return id;
  }

  function secretText(value) {
    if (typeof value !== 'string') {
      throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    var normalized = value.trim();
    if (!normalized || normalized.length > 4096 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
      throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
    }
    return normalized;
  }

  function runtimeApi(value) {
    var candidate = value || global.chrome && global.chrome.runtime;
    if (!candidate || typeof candidate.sendMessage !== 'function') {
      throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_RUNTIME_UNAVAILABLE');
    }
    return candidate;
  }

  function preparedPermissionFingerprint(value) {
    if (!isRecord(value) || !isRecord(value.readinessBinding)) {
      throw clientError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    }
    var handle = text(value.readinessHandle, 128);
    var expiresAt = text(value.expiresAt, 64);
    if (!Number.isFinite(Date.parse(expiresAt))) {
      throw clientError('SS_ERP_BYOK_PERMISSION_READINESS_INVALID');
    }
    return {
      handle: handle,
      fingerprint: JSON.stringify({
        readinessHandle: handle,
        readinessBinding: value.readinessBinding,
        expiresAt: expiresAt,
      }),
    };
  }

  function createClient(options) {
    var config = options || {};
    var runtime = runtimeApi(config.runtime);
    var permissions = config.permissions || global.chrome && global.chrome.permissions;
    var permissionApi = config.permissionApi || global.SS_ERP_BYOK_PERMISSION_BROKER;
    var readinessBridgeApi = config.readinessBridgeApi
      || global.SS_ERP_BYOK_PERMISSION_READINESS_BRIDGE;
    var now = typeof config.now === 'function' ? config.now : function () { return new Date(); };
    var timeoutMs = Number.isFinite(Number(config.timeoutMs)) && Number(config.timeoutMs) > 0
      ? Math.min(Number(config.timeoutMs), DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
    var preparedPermissions = new Map();
    var uncertainCapabilityProbes = new Map();

    function rememberPreparedPermission(value) {
      var identity = preparedPermissionFingerprint(value);
      while (preparedPermissions.size >= MAX_PREPARED_PERMISSIONS) {
        preparedPermissions.delete(preparedPermissions.keys().next().value);
      }
      preparedPermissions.set(identity.handle, identity.fingerprint);
      return value;
    }

    function consumePreparedPermission(value) {
      var identity = preparedPermissionFingerprint(value);
      var expected = preparedPermissions.get(identity.handle);
      preparedPermissions.delete(identity.handle);
      if (!expected || expected !== identity.fingerprint) {
        throw clientError('SS_ERP_BYOK_PERMISSION_READINESS_UNAVAILABLE');
      }
    }

    function send(type, payload, readiness, operationTimeoutMs) {
      var message = { type: type, payload: payload || {} };
      if (readiness) {
        message.readinessHandle = readiness.readinessHandle;
        message.readinessBinding = readiness.readinessBinding;
      }
      return new Promise(function (resolve, reject) {
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          reject(clientError(
            type === MESSAGE_TYPES.TEST_CAPABILITY
              ? 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'
              : 'SS_ERP_BYOK_PROVIDER_SETTINGS_RUNTIME_TIMEOUT',
            type === MESSAGE_TYPES.TEST_CAPABILITY
              ? { outcome: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false }
              : null,
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
            var lastError = runtime.lastError;
            if (lastError) {
              finish(reject, type === MESSAGE_TYPES.TEST_CAPABILITY
                ? unknownCapabilityError(false)
                : clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_RUNTIME_FAILED'));
              return;
            }
            if (!isRecord(response) || response.ok !== true
              || !Object.prototype.hasOwnProperty.call(response, 'data')) {
              var code = isRecord(response) && typeof response.errorCode === 'string'
                && /^[A-Z][A-Z0-9_]{0,99}$/u.test(response.errorCode)
                ? response.errorCode
                : 'SS_ERP_BYOK_PROVIDER_SETTINGS_OPERATION_FAILED';
              finish(reject, clientError(code));
              return;
            }
            finish(resolve, response.data);
          });
        } catch (_error) {
          finish(reject, clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_RUNTIME_FAILED'));
        }
      });
    }

    function capabilityProbeKey(profileIdValue, operationValue) {
      return profileIdValue + '\u0000' + operationValue;
    }

    function unknownCapabilityError(replayed) {
      return clientError('SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME', {
        outcome: 'UNKNOWN_OUTCOME',
        automaticRetryAllowed: false,
        replayed: replayed === true,
      });
    }

    function clearUncertainCapabilityProbes(profileIdValue) {
      var prefix = profileIdValue + '\u0000';
      Array.from(uncertainCapabilityProbes.keys()).forEach(function (key) {
        if (key.startsWith(prefix)) uncertainCapabilityProbes.delete(key);
      });
    }

    function getReadiness(input) {
      if (!isRecord(input)) throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
      return send(MESSAGE_TYPES.GET_READINESS, {
        profileId: profileId(input.profileId),
        shopId: text(input.shopId, 200),
        workflowId: null,
        draftRevision: null,
        draftVersion: null,
        operation: text(input.operation, 64),
      });
    }

    return Object.freeze({
      contractVersion: CONTRACT_VERSION,
      messageTypes: MESSAGE_TYPES,
      getSetupContext: function () {
        return send(MESSAGE_TYPES.GET_SETUP_CONTEXT, {});
      },
      listProfiles: function () {
        return send(MESSAGE_TYPES.LIST_PROFILES, {});
      },
      getProfileState: function (id) {
        return send(MESSAGE_TYPES.GET_PROFILE_STATE, { profileId: profileId(id) });
      },
      saveProfile: function (profile) {
        if (!isRecord(profile)) throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
        return send(MESSAGE_TYPES.SAVE_PROFILE, { profile: profile });
      },
      removeProfile: function (id) {
        return send(MESSAGE_TYPES.REMOVE_PROFILE, { profileId: profileId(id) });
      },
      setSessionKey: function (id, apiKey) {
        var normalizedId = profileId(id);
        return send(MESSAGE_TYPES.SET_SESSION_KEY, {
          profileId: normalizedId,
          apiKey: secretText(apiKey),
        }).then(function (result) {
          clearUncertainCapabilityProbes(normalizedId);
          return result;
        });
      },
      clearSessionKey: function (id) {
        var normalizedId = profileId(id);
        return send(MESSAGE_TYPES.CLEAR_SESSION_KEY, { profileId: normalizedId }).then(function (result) {
          clearUncertainCapabilityProbes(normalizedId);
          return result;
        });
      },
      getPermissionStatus: function (id) {
        return send(MESSAGE_TYPES.PERMISSION_STATUS, { profileId: profileId(id) });
      },
      preparePermission: function (input) {
        if (!isRecord(input) || !isRecord(input.readiness)) {
          throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
        }
        return send(MESSAGE_TYPES.PREPARE_PERMISSION, {
          profileId: profileId(input.profileId),
          operation: text(input.operation, 64),
        }, input.readiness).then(rememberPreparedPermission);
      },
      revokePermission: function (id) {
        return send(MESSAGE_TYPES.REVOKE_PERMISSION, { profileId: profileId(id) });
      },
      getReadiness: getReadiness,
      testCapability: function (input) {
        if (!isRecord(input) || !isRecord(input.readiness)) {
          throw clientError('SS_ERP_BYOK_PROVIDER_SETTINGS_INPUT_INVALID');
        }
        var normalizedProfileId = profileId(input.profileId);
        var normalizedOperation = text(input.operation, 64);
        var probeKey = capabilityProbeKey(normalizedProfileId, normalizedOperation);
        if (uncertainCapabilityProbes.has(probeKey)) {
          return Promise.reject(unknownCapabilityError(true));
        }
        return send(MESSAGE_TYPES.TEST_CAPABILITY, {
          profileId: normalizedProfileId,
          operation: normalizedOperation,
          idempotencyKey: profileId(input.idempotencyKey),
        }, input.readiness, CAPABILITY_TIMEOUT_MS).catch(function (error) {
          if (error && error.code === 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME') {
            uncertainCapabilityProbes.set(probeKey, true);
            throw unknownCapabilityError(Boolean(error.replayed));
          }
          throw error;
        });
      },
      requestPermissionFromGesture: function (input) {
        if (!isRecord(input) || !isRecord(input.profile) || !isRecord(input.readiness)
          || !permissionApi || typeof permissionApi.createBroker !== 'function'
          || !readinessBridgeApi || typeof readinessBridgeApi.createBridge !== 'function') {
          throw clientError('SS_ERP_BYOK_PERMISSION_GESTURE_REQUIRED');
        }
        var operation = text(input.operation, 64);
        consumePreparedPermission(input.readiness);
        var bridge = readinessBridgeApi.createBridge({
          readiness: input.readiness,
          profile: input.profile,
          shopId: text(input.shopId, 200),
          operation: operation,
          now: now,
        });
        var broker = permissionApi.createBroker({
          permissions: permissions,
          readinessBridge: bridge,
          consentAuthority: 'REQUEST_ONLY',
        });
        var trustedGesture = broker.createTrustedGestureToken(input.event);
        return broker.requestOriginPermission({
          endpoint: input.profile.baseUrl,
          readinessHandle: input.readiness.readinessHandle,
          readinessBinding: input.readiness.readinessBinding,
          trustedGesture: trustedGesture,
        }).then(function (permission) {
          if (!permission || permission.granted !== true) return permission;
          return send(MESSAGE_TYPES.REQUEST_PERMISSION, {
            profileId: profileId(input.profile.id),
            shopId: text(input.shopId, 200),
            operation: operation,
            permissionTicket: text(input.readiness.readinessHandle, 128),
          });
        });
      },
      invalidatePreparedPermissions: function () {
        var cleared = preparedPermissions.size;
        preparedPermissions.clear();
        uncertainCapabilityProbes.clear();
        return { cleared: cleared };
      },
      discardPreparedPermission: function (value) {
        var identity = preparedPermissionFingerprint(value);
        var matched = preparedPermissions.get(identity.handle) === identity.fingerprint;
        preparedPermissions.delete(identity.handle);
        return { discarded: matched };
      },
    });
  }

  global.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    DEVICE_SESSION_INVALIDATED_MESSAGE: DEVICE_SESSION_INVALIDATED_MESSAGE,
    MESSAGE_TYPES: MESSAGE_TYPES,
    createClient: createClient,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
