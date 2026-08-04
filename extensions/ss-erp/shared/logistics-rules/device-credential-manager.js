(function (global) {
  'use strict';

  var CREDENTIAL_KEY = 'ss-erp:extension-device:credential:v1';
  var SESSION_ACCESS_KEY = 'ss-erp:extension-device:access:v1';
  var SESSION_ACCESS_VERSION = 'extension-device-session-access/v1';
  var SESSION_ACCESS_KEYS = [
    'contractVersion',
    'baseUrl',
    'deploymentId',
    'deviceId',
    'ownerUserId',
    'sessionId',
    'currentJti',
    'token',
    'expiresAt',
  ];
  var CREDENTIAL_LOCK_NAME = 'ss-erp:extension-device:credential-lock:v1';
  var MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;
  var MAX_ACCESS_TTL_SECONDS = 15 * 60;
  var MAX_ACCESS_CLOCK_SKEW_MS = 5 * 60 * 1000;
  var ACCESS_EXPIRY_RESERVE_MS = 30 * 1000;

  function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function requiredText(value, label) {
    var normalized = String(value == null ? '' : value).trim();
    if (!normalized) throw new TypeError(label + ' is required');
    return normalized;
  }

  function exactKeys(value, keys) {
    if (!isRecord(value)) return false;
    var actual = Object.keys(value);
    return actual.length === keys.length && keys.every(function (key) {
      return Object.prototype.hasOwnProperty.call(value, key);
    });
  }

  function decodeJwtPart(value) {
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    try {
      var base64 = value.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      var decoded = JSON.parse(atob(base64));
      return isRecord(decoded) ? decoded : null;
    } catch (_error) {
      return null;
    }
  }

  function tokenParts(token) {
    if (typeof token !== 'string' || !token || token.length > MAX_ACCESS_TOKEN_LENGTH) return null;
    var parts = token.split('.');
    if (parts.length !== 3 || !parts[2] || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
    var header = decodeJwtPart(parts[0]);
    var payload = decodeJwtPart(parts[1]);
    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT' || !payload) return null;
    return { payload: payload };
  }

  function normalizeBaseUrl(value) {
    var parsed = new URL(requiredText(value, 'baseUrl'));
    var local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
      throw new TypeError('ERP endpoint must use HTTPS');
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  }

  function tokenExpiresAt(token) {
    var parts = typeof token === 'string' ? token.split('.') : [];
    var payload = parts.length === 3 ? decodeJwtPart(parts[1]) : null;
    return payload && Number.isSafeInteger(payload.exp) ? payload.exp * 1000 : 0;
  }

  function scopesMatch(left, right) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every(function (scope, index) {
        return typeof scope === 'string' && scope && scope === right[index];
      });
  }

  function sessionAccessRecord(credential, token, currentTime, retainedExpiresAt) {
    var parts = tokenParts(token);
    var payload = parts && parts.payload;
    var issuedAt = payload && payload.iat;
    var expiresAtSeconds = payload && payload.exp;
    var tokenExpiresAt = Number.isSafeInteger(expiresAtSeconds) ? expiresAtSeconds * 1000 : 0;
    var tokenTtlMs = Number.isSafeInteger(issuedAt) && Number.isSafeInteger(expiresAtSeconds)
      ? (expiresAtSeconds - issuedAt) * 1000
      : 0;
    var observedExpiresAt = currentTime + tokenTtlMs;
    var expiresAt = retainedExpiresAt === undefined
      ? Math.min(tokenExpiresAt, observedExpiresAt)
      : retainedExpiresAt;
    var validLifetime = Number.isSafeInteger(issuedAt)
      && issuedAt > 0
      && Number.isSafeInteger(expiresAtSeconds)
      && expiresAtSeconds > issuedAt
      && expiresAtSeconds - issuedAt <= MAX_ACCESS_TTL_SECONDS
      && issuedAt * 1000 <= currentTime + MAX_ACCESS_CLOCK_SKEW_MS
      && tokenExpiresAt <= currentTime + MAX_ACCESS_TTL_SECONDS * 1000
        + MAX_ACCESS_CLOCK_SKEW_MS
      && Number.isSafeInteger(expiresAt)
      && expiresAt <= tokenExpiresAt
      && expiresAt <= observedExpiresAt + MAX_ACCESS_CLOCK_SKEW_MS;
    var validIdentity = payload
      && payload.typ === 'extension_device'
      && payload.tokenUse === 'access'
      && payload.deploymentId === credential.deploymentId
      && payload.sid === credential.sessionId
      && payload.sub === credential.sessionId
      && payload.deviceId === credential.deviceId
      && payload.ownerUserId === credential.ownerUserId
      && payload.actorUserId === credential.ownerUserId
      && typeof payload.jti === 'string'
      && Boolean(payload.jti.trim())
      && payload.jti === credential.currentJti
      && scopesMatch(payload.scopes, credential.scopes);
    if (!validLifetime || !validIdentity || expiresAt <= currentTime + ACCESS_EXPIRY_RESERVE_MS) {
      return null;
    }
    return {
      contractVersion: SESSION_ACCESS_VERSION,
      baseUrl: credential.baseUrl,
      deploymentId: credential.deploymentId,
      deviceId: credential.deviceId,
      ownerUserId: credential.ownerUserId,
      sessionId: credential.sessionId,
      currentJti: credential.currentJti,
      token: token,
      expiresAt: expiresAt,
    };
  }

  function sessionAccessMatches(value, expected) {
    return exactKeys(value, SESSION_ACCESS_KEYS)
      && SESSION_ACCESS_KEYS.every(function (key) { return value[key] === expected[key]; });
  }

  function publicSession(session) {
    return {
      state: 'paired',
      sessionId: session.id,
      deploymentId: session.deploymentId,
      deviceId: session.deviceId,
      ownerUserId: session.ownerUserId,
      scopes: session.scopes.slice(),
      expiresAt: session.expiresAt,
    };
  }

  function createManager(options) {
    var localStorage = options && options.localStorage;
    var sessionStorage = options && options.sessionStorage;
    var lockManager = options && options.lockManager;
    var fetchImpl = options && options.fetchImpl;
    var now = options && options.now ? options.now : function () { return new Date(); };
    var configuredRequestTimeoutMs = Number(options && options.requestTimeoutMs);
    var requestTimeoutMs = Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs > 0
      ? configuredRequestTimeoutMs
      : 6000;
    var expectedBaseUrl = options && options.expectedBaseUrl
      ? normalizeBaseUrl(options.expectedBaseUrl)
      : '';
    var validateBaseUrl = options && typeof options.validateBaseUrl === 'function'
      ? options.validateBaseUrl
      : null;
    var access = null;
    var refreshInFlight = null;
    var credentialEpoch = 0;

    function withCredentialLock(operation) {
      if (!lockManager) return Promise.resolve().then(operation);
      return lockManager.request(CREDENTIAL_LOCK_NAME, operation);
    }

    function supersededError() {
      return new Error('device credential operation superseded');
    }

    function assertCurrentEpoch(operationEpoch) {
      if (operationEpoch !== credentialEpoch) {
        throw supersededError();
      }
    }

    function sameStoredValue(left, right) {
      try {
        return JSON.stringify(left) === JSON.stringify(right);
      } catch (_error) {
        return false;
      }
    }

    async function removeSessionAccessIfCurrent(expected) {
      access = null;
      if (!sessionStorage || expected === undefined) return false;
      var stored = await sessionStorage.get([SESSION_ACCESS_KEY]);
      if (!sameStoredValue(stored && stored[SESSION_ACCESS_KEY], expected)) return false;
      await sessionStorage.remove([SESSION_ACCESS_KEY]);
      return true;
    }

    async function invalidateSessionAccess() {
      access = null;
      if (!sessionStorage) return false;
      var stored = await sessionStorage.get([SESSION_ACCESS_KEY]);
      return removeSessionAccessIfCurrent(stored && stored[SESSION_ACCESS_KEY]);
    }

    async function rememberSessionAccess(credential, accessToken) {
      var record = sessionAccessRecord(credential, accessToken, now().getTime());
      if (sessionStorage && !record) throw new Error('device access credential is invalid');
      var expiresAt = record ? record.expiresAt : tokenExpiresAt(accessToken);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now().getTime()) {
        throw new Error('device access credential is invalid');
      }
      if (sessionStorage) await sessionStorage.set({ [SESSION_ACCESS_KEY]: record });
      access = { token: accessToken, expiresAt: expiresAt };
      return accessToken;
    }

    async function readSessionAccess(credential, operationEpoch) {
      if (!sessionStorage) {
        return access && access.expiresAt > now().getTime() + ACCESS_EXPIRY_RESERVE_MS
          ? access.token
          : '';
      }
      var stored = await sessionStorage.get([SESSION_ACCESS_KEY]);
      assertCurrentEpoch(operationEpoch);
      var value = stored && stored[SESSION_ACCESS_KEY];
      var expected = value && sessionAccessRecord(
        credential,
        value.token,
        now().getTime(),
        value.expiresAt,
      );
      if (!expected || !sessionAccessMatches(value, expected)) {
        await removeSessionAccessIfCurrent(value);
        assertCurrentEpoch(operationEpoch);
        return '';
      }
      access = { token: expected.token, expiresAt: expected.expiresAt };
      return expected.token;
    }

    function trustedBaseUrl(value) {
      var normalized = normalizeBaseUrl(value);
      if (expectedBaseUrl && normalized !== expectedBaseUrl) {
        throw new Error('device credential belongs to another ERP deployment');
      }
      if (validateBaseUrl && validateBaseUrl(normalized) !== true) {
        throw new Error('device credential ERP endpoint is not allowed');
      }
      return normalized;
    }

    async function requestJsonWithDeadline(url, init, jsonStatus, timeoutMessage) {
      var controller = new AbortController();
      var timer = null;
      var timedOut = new Promise(function (_resolve, reject) {
        timer = setTimeout(function () {
          reject(new Error(timeoutMessage));
          controller.abort();
        }, requestTimeoutMs);
      });
      var request = Promise.resolve().then(async function () {
        var response = await fetchImpl(url, Object.assign({}, init, {
          signal: controller.signal,
        }));
        var body = response.status === jsonStatus ? await response.json() : null;
        return { response: response, body: body };
      });
      try {
        return await Promise.race([request, timedOut]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }

    function operationFromCredential(credential, operationEpoch, accessToken) {
      return {
        state: 'paired',
        epoch: operationEpoch,
        baseUrl: trustedBaseUrl(credential.baseUrl),
        deploymentId: requiredText(credential.deploymentId, 'deploymentId'),
        deviceId: requiredText(credential.deviceId, 'deviceId'),
        ownerUserId: requiredText(credential.ownerUserId, 'ownerUserId'),
        sessionId: requiredText(credential.sessionId, 'sessionId'),
        currentJti: String(credential.currentJti || ''),
        scopes: Array.isArray(credential.scopes) ? credential.scopes.map(String) : [],
        expiresAt: requiredText(credential.expiresAt, 'expiresAt'),
        accessToken: String(accessToken == null ? '' : accessToken),
      };
    }

    function credentialBindingMatchesOperation(credential, operation) {
      if (!isRecord(credential) || !isRecord(operation)
        || operation.state !== 'paired'
        || !Number.isSafeInteger(operation.epoch)) return false;
      try {
        return trustedBaseUrl(credential.baseUrl) === trustedBaseUrl(operation.baseUrl)
          && requiredText(credential.deploymentId, 'deploymentId') === operation.deploymentId
          && requiredText(credential.deviceId, 'deviceId') === operation.deviceId
          && requiredText(credential.ownerUserId, 'ownerUserId') === operation.ownerUserId
          && requiredText(credential.sessionId, 'sessionId') === operation.sessionId;
      } catch (_error) {
        return false;
      }
    }

    function credentialMatchesOperation(credential, operation) {
      return credentialBindingMatchesOperation(credential, operation)
        && String(credential.currentJti || '') === String(operation.currentJti || '');
    }

    if (!localStorage || typeof localStorage.get !== 'function' || typeof localStorage.set !== 'function' || typeof localStorage.remove !== 'function') {
      throw new TypeError('localStorage adapter is required');
    }
    if (sessionStorage && (typeof sessionStorage.get !== 'function'
      || typeof sessionStorage.set !== 'function'
      || typeof sessionStorage.remove !== 'function')) {
      throw new TypeError('sessionStorage adapter is invalid');
    }
    if (lockManager && typeof lockManager.request !== 'function') {
      throw new TypeError('lockManager adapter is invalid');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

    async function getCompatibleStoredCredential(operationEpoch) {
      var stored = await localStorage.get([CREDENTIAL_KEY]);
      var credential = stored && stored[CREDENTIAL_KEY];
      if (!credential) {
        assertCurrentEpoch(operationEpoch);
        await invalidateSessionAccess();
        assertCurrentEpoch(operationEpoch);
        return null;
      }
      try {
        trustedBaseUrl(credential.baseUrl);
        assertCurrentEpoch(operationEpoch);
        return credential;
      } catch (_error) {
        assertCurrentEpoch(operationEpoch);
        credentialEpoch += 1;
        await Promise.all([
          localStorage.remove([CREDENTIAL_KEY]),
          invalidateSessionAccess(),
        ]);
        return null;
      }
    }

    async function claim(input) {
      var baseUrl = trustedBaseUrl(input && input.baseUrl);
      var operationEpoch = ++credentialEpoch;
      await invalidateSessionAccess();
      assertCurrentEpoch(operationEpoch);
      var code = requiredText(input && input.code, 'pairing code');
      var deploymentId = requiredText(input && input.deploymentId, 'deploymentId');
      var deviceId = requiredText(input && input.deviceId, 'deviceId');
      var deviceLabel = requiredText(input && input.deviceLabel, 'deviceLabel');
      if (code.length < 20 || code.length > 1000 || deviceId.length > 200 || deviceLabel.length > 120) {
        throw new TypeError('pairing input is invalid');
      }
      var result = await requestJsonWithDeadline(
        baseUrl + '/api/extension-device/pairing-claims',
        {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        credentials: 'omit',
        cache: 'no-store',
        body: JSON.stringify({
          code: code,
          deploymentId: deploymentId,
          deviceId: deviceId,
          deviceLabel: deviceLabel,
        }),
        },
        201,
        'device pairing request timed out',
      );
      var response = result.response;
      if (response.status !== 201) {
        throw new Error('device pairing failed');
      }
      var body = result.body;
      var data = body && body.code === 1 && body.data;
      var session = data && data.session;
      if (
        !session ||
        requiredText(session.id, 'session.id').length > 200 ||
        requiredText(session.deploymentId, 'session.deploymentId') !== deploymentId ||
        requiredText(session.deviceId, 'session.deviceId') !== deviceId ||
        !Array.isArray(session.scopes) ||
        !session.scopes.length
      ) {
        throw new Error('device pairing response scope mismatch');
      }
      var ownerUserId = requiredText(session.ownerUserId, 'session.ownerUserId');
      var expiresAt = requiredText(session.expiresAt, 'session.expiresAt');
      if (!Number.isFinite(Date.parse(expiresAt))) throw new Error('device session expiry is invalid');
      var accessToken = requiredText(data.accessToken, 'access token');
      var refreshToken = requiredText(data.refreshToken, 'refresh token');
      var currentJti = sessionStorage
        ? requiredText(session.currentJti, 'session.currentJti')
        : String(session.currentJti || '');
      var nextCredential = {
        baseUrl: baseUrl,
        deploymentId: deploymentId,
        deviceId: deviceId,
        ownerUserId: ownerUserId,
        sessionId: session.id,
        currentJti: currentJti,
        scopes: session.scopes.map(String),
        expiresAt: expiresAt,
        refreshToken: refreshToken,
      };
      if (refreshToken.length < 32
        || tokenExpiresAt(accessToken) <= now().getTime()
        || (sessionStorage && !sessionAccessRecord(nextCredential, accessToken, now().getTime()))) {
        throw new Error('device credentials are invalid');
      }

      assertCurrentEpoch(operationEpoch);
      await localStorage.set({
        [CREDENTIAL_KEY]: nextCredential,
      });
      assertCurrentEpoch(operationEpoch);
      await rememberSessionAccess(nextCredential, accessToken);
      assertCurrentEpoch(operationEpoch);
      return publicSession({
        id: session.id,
        deploymentId: deploymentId,
        deviceId: deviceId,
        ownerUserId: ownerUserId,
        scopes: session.scopes.map(String),
        expiresAt: expiresAt,
      });
    }

    async function clear() {
      credentialEpoch += 1;
      await Promise.all([
        localStorage.remove([CREDENTIAL_KEY]),
        invalidateSessionAccess(),
      ]);
      return { state: 'unpaired' };
    }

    async function getStatus() {
      var operationEpoch = credentialEpoch;
      var credential = await getCompatibleStoredCredential(operationEpoch);
      if (!credential) return { state: 'unpaired' };
      return {
        state: 'paired',
        sessionId: credential.sessionId,
        deploymentId: credential.deploymentId,
        deviceId: credential.deviceId,
        ownerUserId: credential.ownerUserId,
        scopes: Array.isArray(credential.scopes) ? credential.scopes.slice() : [],
        expiresAt: credential.expiresAt,
      };
    }

    async function getConnection() {
      var operationEpoch = credentialEpoch;
      var credential = await getCompatibleStoredCredential(operationEpoch);
      if (!credential) return null;
      return {
        baseUrl: trustedBaseUrl(credential.baseUrl),
        deploymentId: requiredText(credential.deploymentId, 'deploymentId'),
        deviceId: requiredText(credential.deviceId, 'deviceId'),
        ownerUserId: requiredText(credential.ownerUserId, 'ownerUserId'),
        sessionId: requiredText(credential.sessionId, 'sessionId'),
      };
    }

    async function beginOperation() {
      var operationEpoch = credentialEpoch;
      var credential = await getCompatibleStoredCredential(operationEpoch);
      if (!credential) {
        return { state: 'unpaired', epoch: credentialEpoch };
      }
      assertCurrentEpoch(operationEpoch);
      var identity = operationFromCredential(credential, operationEpoch, '');
      var accessToken = await getAccessToken();
      assertCurrentEpoch(operationEpoch);
      var currentStored = await localStorage.get([CREDENTIAL_KEY]);
      assertCurrentEpoch(operationEpoch);
      var currentCredential = currentStored && currentStored[CREDENTIAL_KEY];
      if (!credentialBindingMatchesOperation(currentCredential, identity)) {
        throw supersededError();
      }
      return operationFromCredential(currentCredential, operationEpoch, accessToken);
    }

    async function isOperationCurrent(operation) {
      if (!isRecord(operation) || !Number.isSafeInteger(operation.epoch)
        || operation.epoch !== credentialEpoch) return false;
      var stored = await localStorage.get([CREDENTIAL_KEY]);
      if (operation.epoch !== credentialEpoch) return false;
      var credential = stored && stored[CREDENTIAL_KEY];
      if (operation.state === 'unpaired') return !credential;
      return credentialMatchesOperation(credential, operation);
    }

    async function clearIfCurrent(operation, _reason) {
      if (!isRecord(operation) || operation.state !== 'paired'
        || !Number.isSafeInteger(operation.epoch)
        || operation.epoch !== credentialEpoch) return false;
      var stored = await localStorage.get([CREDENTIAL_KEY]);
      if (operation.epoch !== credentialEpoch) return false;
      var credential = stored && stored[CREDENTIAL_KEY];
      if (!credentialMatchesOperation(credential, operation)) return false;
      credentialEpoch += 1;
      await Promise.all([
        localStorage.remove([CREDENTIAL_KEY]),
        invalidateSessionAccess(),
      ]);
      return true;
    }

    async function rotateRefreshCredential() {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async function () {
        var operationEpoch = credentialEpoch;
        var credential = await getCompatibleStoredCredential(operationEpoch);
        if (!credential) throw new Error('device refresh credential is unavailable');
        assertCurrentEpoch(operationEpoch);
        var refreshOperation = operationFromCredential(credential, operationEpoch, '');
        assertCurrentEpoch(operationEpoch);
        var baseUrl = trustedBaseUrl(credential.baseUrl);
        async function requireRepair(reason) {
          var cleared = await clearIfCurrent(refreshOperation, { reason: reason });
          if (!cleared) throw supersededError();
          throw new Error('device refresh result is uncertain; device re-pairing required');
        }
        var result;
        try {
          result = await requestJsonWithDeadline(
            baseUrl + '/api/extension-device/refresh',
            {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            credentials: 'omit',
            cache: 'no-store',
            body: JSON.stringify({
              refreshToken: requiredText(credential.refreshToken, 'refresh token'),
            }),
            },
            200,
            'device refresh request timed out',
          );
        } catch (_error) {
          return requireRepair('device_refresh_transport_ambiguous');
        }
        var response = result.response;
        if (response.status !== 200) {
          return requireRepair('device_refresh_http_' + response.status);
        }
        var body = result.body;
        var data = body && body.code === 1 && body.data;
        var session = data && data.session;
        var accessToken;
        var refreshToken;
        var accessExpiresAt;
        var expiresAt;
        try {
          if (
            !session ||
            requiredText(session.id, 'session.id') !== credential.sessionId ||
            requiredText(session.deploymentId, 'session.deploymentId') !== credential.deploymentId ||
            requiredText(session.deviceId, 'session.deviceId') !== credential.deviceId ||
            requiredText(session.ownerUserId, 'session.ownerUserId') !== credential.ownerUserId ||
            !Array.isArray(session.scopes)
          ) throw new Error('device refresh response scope mismatch');
          accessToken = requiredText(data.accessToken, 'access token');
          refreshToken = requiredText(data.refreshToken, 'refresh token');
          accessExpiresAt = tokenExpiresAt(accessToken);
          if (refreshToken.length < 32 || accessExpiresAt <= now().getTime()) {
            throw new Error('rotated device credentials are invalid');
          }
          expiresAt = requiredText(session.expiresAt, 'session.expiresAt');
          if (!Number.isFinite(Date.parse(expiresAt))) {
            throw new Error('device session expiry is invalid');
          }
          var nextCredential = {
            baseUrl: baseUrl,
            deploymentId: credential.deploymentId,
            deviceId: credential.deviceId,
            ownerUserId: credential.ownerUserId,
            sessionId: credential.sessionId,
            currentJti: sessionStorage
              ? requiredText(session.currentJti, 'session.currentJti')
              : String(session.currentJti || ''),
            scopes: session.scopes.map(String),
            expiresAt: expiresAt,
            refreshToken: refreshToken,
          };
          if (sessionStorage && !sessionAccessRecord(nextCredential, accessToken, now().getTime())) {
            throw new Error('rotated device access credential is invalid');
          }
        } catch (_error) {
          return requireRepair('device_refresh_response_invalid');
        }
        assertCurrentEpoch(operationEpoch);
        var currentStored = await localStorage.get([CREDENTIAL_KEY]);
        var currentCredential = currentStored && currentStored[CREDENTIAL_KEY];
        if (!currentCredential
          || currentCredential.sessionId !== credential.sessionId
          || currentCredential.deploymentId !== credential.deploymentId
          || currentCredential.refreshToken !== credential.refreshToken) {
          throw supersededError();
        }
        assertCurrentEpoch(operationEpoch);
        await localStorage.set({
          [CREDENTIAL_KEY]: nextCredential,
        });
        assertCurrentEpoch(operationEpoch);
        await rememberSessionAccess(nextCredential, accessToken);
        assertCurrentEpoch(operationEpoch);
        return accessToken;
      })();
      try {
        return await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
    }

    async function getAccessToken() {
      var operationEpoch = credentialEpoch;
      var credential = await getCompatibleStoredCredential(operationEpoch);
      if (!credential) throw new Error('device refresh credential is unavailable');
      assertCurrentEpoch(operationEpoch);
      var sessionAccess = await readSessionAccess(credential, operationEpoch);
      if (sessionAccess) return sessionAccess;
      return rotateRefreshCredential();
    }

    return {
      claim: function (input) { return withCredentialLock(function () { return claim(input); }); },
      beginOperation: function () { return withCredentialLock(beginOperation); },
      clear: function () { return withCredentialLock(clear); },
      clearIfCurrent: function (operation, reason) {
        return withCredentialLock(function () { return clearIfCurrent(operation, reason); });
      },
      getAccessToken: function () { return withCredentialLock(getAccessToken); },
      getStatus: function () { return withCredentialLock(getStatus); },
      getConnection: function () { return withCredentialLock(getConnection); },
      isOperationCurrent: function (operation) {
        return withCredentialLock(function () { return isOperationCurrent(operation); });
      },
    };
  }

  global.SS_ERP_EXTENSION_DEVICE_CREDENTIALS = {
    CREDENTIAL_KEY: CREDENTIAL_KEY,
    SESSION_ACCESS_KEY: SESSION_ACCESS_KEY,
    SESSION_ACCESS_VERSION: SESSION_ACCESS_VERSION,
    CREDENTIAL_LOCK_NAME: CREDENTIAL_LOCK_NAME,
    createManager: createManager,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
