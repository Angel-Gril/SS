(function (global) {
  'use strict';

  var CREDENTIAL_KEY = 'ss-erp:extension-device:credential:v1';

  function isRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function requiredText(value, label) {
    var normalized = String(value == null ? '' : value).trim();
    if (!normalized) throw new TypeError(label + ' is required');
    return normalized;
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
    try {
      var part = String(token).split('.')[1];
      if (!part) return 0;
      var base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      var payload = JSON.parse(atob(base64));
      return Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
    } catch (_error) {
      return 0;
    }
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
    var fetchImpl = options && options.fetchImpl;
    var now = options && options.now ? options.now : function () { return new Date(); };
    var access = null;
    var refreshInFlight = null;
    var credentialEpoch = 0;

    function supersededError() {
      return new Error('device credential operation superseded');
    }

    function assertCurrentEpoch(operationEpoch) {
      if (operationEpoch !== credentialEpoch) {
        throw supersededError();
      }
    }

    function operationFromCredential(credential, operationEpoch, accessToken) {
      return {
        state: 'paired',
        epoch: operationEpoch,
        baseUrl: normalizeBaseUrl(credential.baseUrl),
        deploymentId: requiredText(credential.deploymentId, 'deploymentId'),
        deviceId: requiredText(credential.deviceId, 'deviceId'),
        ownerUserId: requiredText(credential.ownerUserId, 'ownerUserId'),
        sessionId: requiredText(credential.sessionId, 'sessionId'),
        scopes: Array.isArray(credential.scopes) ? credential.scopes.map(String) : [],
        expiresAt: requiredText(credential.expiresAt, 'expiresAt'),
        accessToken: String(accessToken == null ? '' : accessToken),
      };
    }

    function credentialMatchesOperation(credential, operation) {
      if (!isRecord(credential) || !isRecord(operation)
        || operation.state !== 'paired'
        || !Number.isSafeInteger(operation.epoch)) return false;
      try {
        return normalizeBaseUrl(credential.baseUrl) === normalizeBaseUrl(operation.baseUrl)
          && requiredText(credential.deploymentId, 'deploymentId') === operation.deploymentId
          && requiredText(credential.deviceId, 'deviceId') === operation.deviceId
          && requiredText(credential.ownerUserId, 'ownerUserId') === operation.ownerUserId
          && requiredText(credential.sessionId, 'sessionId') === operation.sessionId;
      } catch (_error) {
        return false;
      }
    }

    if (!localStorage || typeof localStorage.get !== 'function' || typeof localStorage.set !== 'function' || typeof localStorage.remove !== 'function') {
      throw new TypeError('localStorage adapter is required');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

    async function claim(input) {
      var baseUrl = normalizeBaseUrl(input && input.baseUrl);
      var operationEpoch = ++credentialEpoch;
      var code = requiredText(input && input.code, 'pairing code');
      var deploymentId = requiredText(input && input.deploymentId, 'deploymentId');
      var deviceId = requiredText(input && input.deviceId, 'deviceId');
      var deviceLabel = requiredText(input && input.deviceLabel, 'deviceLabel');
      if (code.length < 20 || code.length > 1000 || deviceId.length > 200 || deviceLabel.length > 120) {
        throw new TypeError('pairing input is invalid');
      }
      var response = await fetchImpl(baseUrl + '/api/extension-device/pairing-claims', {
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
      });
      if (response.status !== 201) {
        throw new Error('device pairing failed');
      }
      var body = await response.json();
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
      if (refreshToken.length < 32 || tokenExpiresAt(accessToken) <= now().getTime()) {
        throw new Error('device credentials are invalid');
      }

      assertCurrentEpoch(operationEpoch);
      await localStorage.set({
        [CREDENTIAL_KEY]: {
          baseUrl: baseUrl,
          deploymentId: deploymentId,
          deviceId: deviceId,
          ownerUserId: ownerUserId,
          sessionId: session.id,
          scopes: session.scopes.map(String),
          expiresAt: expiresAt,
          refreshToken: refreshToken,
        },
      });
      assertCurrentEpoch(operationEpoch);
      access = {
        token: accessToken,
        expiresAt: tokenExpiresAt(accessToken),
      };
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
      access = null;
      credentialEpoch += 1;
      await localStorage.remove([CREDENTIAL_KEY]);
      return { state: 'unpaired' };
    }

    async function getStatus() {
      var stored = await localStorage.get([CREDENTIAL_KEY]);
      var credential = stored && stored[CREDENTIAL_KEY];
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
      var stored = await localStorage.get([CREDENTIAL_KEY]);
      var credential = stored && stored[CREDENTIAL_KEY];
      if (!credential) return null;
      return {
        baseUrl: normalizeBaseUrl(credential.baseUrl),
        deploymentId: requiredText(credential.deploymentId, 'deploymentId'),
        deviceId: requiredText(credential.deviceId, 'deviceId'),
        ownerUserId: requiredText(credential.ownerUserId, 'ownerUserId'),
        sessionId: requiredText(credential.sessionId, 'sessionId'),
      };
    }

    async function beginOperation() {
      var operationEpoch = credentialEpoch;
      var stored = await localStorage.get([CREDENTIAL_KEY]);
      assertCurrentEpoch(operationEpoch);
      var credential = stored && stored[CREDENTIAL_KEY];
      if (!credential) {
        return { state: 'unpaired', epoch: operationEpoch };
      }
      var identity = operationFromCredential(credential, operationEpoch, '');
      var accessToken = await getAccessToken();
      assertCurrentEpoch(operationEpoch);
      var currentStored = await localStorage.get([CREDENTIAL_KEY]);
      assertCurrentEpoch(operationEpoch);
      var currentCredential = currentStored && currentStored[CREDENTIAL_KEY];
      if (!credentialMatchesOperation(currentCredential, identity)) {
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
      access = null;
      credentialEpoch += 1;
      await localStorage.remove([CREDENTIAL_KEY]);
      return true;
    }

    async function rotateRefreshCredential() {
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = (async function () {
        var stored = await localStorage.get([CREDENTIAL_KEY]);
        var operationEpoch = credentialEpoch;
        var credential = stored && stored[CREDENTIAL_KEY];
        if (!credential) throw new Error('device refresh credential is unavailable');
        var refreshOperation = operationFromCredential(credential, operationEpoch, '');
        assertCurrentEpoch(operationEpoch);
        var baseUrl = normalizeBaseUrl(credential.baseUrl);
        var response = await fetchImpl(baseUrl + '/api/extension-device/refresh', {
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
        });
        if (response.status === 401 || response.status === 403 || response.status === 410) {
          var cleared = await clearIfCurrent(refreshOperation, {
            status: response.status,
            reason: 'device_refresh_authorization_revoked',
          });
          if (!cleared) throw supersededError();
          throw new Error('device re-pairing required');
        }
        if (response.status !== 200) throw new Error('device refresh failed');
        var body = await response.json();
        var data = body && body.code === 1 && body.data;
        var session = data && data.session;
        if (
          !session ||
          requiredText(session.id, 'session.id') !== credential.sessionId ||
          requiredText(session.deploymentId, 'session.deploymentId') !== credential.deploymentId ||
          requiredText(session.deviceId, 'session.deviceId') !== credential.deviceId ||
          requiredText(session.ownerUserId, 'session.ownerUserId') !== credential.ownerUserId ||
          !Array.isArray(session.scopes)
        ) {
          throw new Error('device refresh response scope mismatch');
        }
        var accessToken = requiredText(data.accessToken, 'access token');
        var refreshToken = requiredText(data.refreshToken, 'refresh token');
        var accessExpiresAt = tokenExpiresAt(accessToken);
        if (refreshToken.length < 32 || accessExpiresAt <= now().getTime()) {
          throw new Error('rotated device credentials are invalid');
        }
        var expiresAt = requiredText(session.expiresAt, 'session.expiresAt');
        if (!Number.isFinite(Date.parse(expiresAt))) {
          throw new Error('device session expiry is invalid');
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
          [CREDENTIAL_KEY]: {
            baseUrl: baseUrl,
            deploymentId: credential.deploymentId,
            deviceId: credential.deviceId,
            ownerUserId: credential.ownerUserId,
            sessionId: credential.sessionId,
            scopes: session.scopes.map(String),
            expiresAt: expiresAt,
            refreshToken: refreshToken,
          },
        });
        assertCurrentEpoch(operationEpoch);
        access = { token: accessToken, expiresAt: accessExpiresAt };
        return accessToken;
      })();
      try {
        return await refreshInFlight;
      } finally {
        refreshInFlight = null;
      }
    }

    async function getAccessToken() {
      if (access && access.expiresAt > now().getTime() + 30 * 1000) return access.token;
      return rotateRefreshCredential();
    }

    return {
      claim: claim,
      beginOperation: beginOperation,
      clear: clear,
      clearIfCurrent: clearIfCurrent,
      getAccessToken: getAccessToken,
      getStatus: getStatus,
      getConnection: getConnection,
      isOperationCurrent: isOperationCurrent,
    };
  }

  global.SS_ERP_EXTENSION_DEVICE_CREDENTIALS = {
    CREDENTIAL_KEY: CREDENTIAL_KEY,
    createManager: createManager,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
