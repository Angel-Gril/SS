(function () {
  var SNAPSHOT_KEY = 'ozon-calc:config-snapshot';
  var UPDATED_AT_KEY = 'ozon-calc:config-updated-at';
  var OFFICIAL_SNAPSHOT_KEY = 'ozon-calculator:official-snapshot';
  var COMMISSION_SNAPSHOT_KEY = 'ozon-calculator:commission-snapshot';
  var FX_SNAPSHOT_KEY = 'ozon-calculator:fx-snapshot';
  var LOGISTICS_CALCULATOR_STATE_KEY = 'ozon-logistics:calculator-state:v1';
  var DEVICE_CREDENTIAL_KEY = 'ss-erp:extension-device:credential:v1';
  var AUTHORIZATION_CLOCK_SKEW_MS = 5 * 60 * 1000;
  var LEGACY_PREFIX = String.fromCharCode(113, 101, 104, 101, 108, 112) + '-clone';
  var LEGACY_SNAPSHOT_KEY = LEGACY_PREFIX + ':config-snapshot';
  var LEGACY_UPDATED_AT_KEY = LEGACY_PREFIX + ':config-updated-at';

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function isLogisticsDistributionFeatureEnabled() {
    var feature = window.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE;
    return Boolean(feature && feature.enabled === true);
  }

  function terminalState(remote) {
    var state = text(remote && remote.state);
    return ['authorization_expired', 'expired', 'revoked', 'upgrade_required']
      .includes(state) ? state : '';
  }

  function authorityMatches(remote, credential) {
    var authority = remote && remote.authority;
    return isRecord(authority) && isRecord(credential)
      && Boolean(text(authority.sessionId))
      && text(authority.sessionId) === text(credential.sessionId)
      && text(authority.deploymentId) === text(credential.deploymentId)
      && text(authority.ownerUserId) === text(credential.ownerUserId);
  }

  function evaluatedRemote(remote, credential) {
    var state = text(remote && remote.state) || 'unavailable';
    var terminal = terminalState(remote);
    if (terminal) {
      return { state: terminal, quoteAllowed: false };
    }
    if (remote && remote.quoteAllowed === true) {
      if (!isRecord(credential)) return { state: 'unpaired', quoteAllowed: false };
      if (!authorityMatches(remote, credential)) {
        return { state: 'session_mismatch', quoteAllowed: false };
      }
      var authorizationUntil = Date.parse(text(remote.authorizationValidUntil));
      if (!Number.isFinite(authorizationUntil)
        || Date.now() > authorizationUntil + AUTHORIZATION_CLOCK_SKEW_MS) {
        return { state: 'authorization_expired', quoteAllowed: false };
      }
      if (text(remote.source) === 'remote') {
        var validUntil = Date.parse(text(remote.validUntil));
        var staleUntil = Date.parse(text(remote.staleUntil));
        if (!Number.isFinite(validUntil) || !Number.isFinite(staleUntil)
          || staleUntil < validUntil) {
          return { state: 'invalid_bundle', quoteAllowed: false };
        }
        if (Date.now() > staleUntil) return { state: 'expired', quoteAllowed: false };
        if (Date.now() > validUntil) return { state: 'stale', quoteAllowed: true };
        if (state === 'stale') state = 'healthy';
      }
    }
    return { state: state, quoteAllowed: remote && remote.quoteAllowed === true };
  }

  function logisticsStatus(remote, evaluated) {
    return {
      state: evaluated.state,
      source: evaluated.quoteAllowed ? String(remote.source || 'none') : 'none',
      quoteAllowed: evaluated.quoteAllowed,
      scope: remote.scope || null,
      route: evaluated.quoteAllowed && isRecord(remote.route) ? remote.route : null,
      releaseId: remote.releaseId || null,
      releaseSequence: remote.releaseSequence || null,
      authorizationValidUntil: remote.authorizationValidUntil || null,
      validUntil: remote.validUntil || null,
      staleUntil: remote.staleUntil || null,
    };
  }

  function readSnapshot() {
    return chrome.storage.local.get([
      LOGISTICS_CALCULATOR_STATE_KEY,
      DEVICE_CREDENTIAL_KEY,
      SNAPSHOT_KEY,
      UPDATED_AT_KEY,
      LEGACY_SNAPSHOT_KEY,
      LEGACY_UPDATED_AT_KEY,
    ]).then(function (result) {
      var remote = result[LOGISTICS_CALCULATOR_STATE_KEY];
      if (isLogisticsDistributionFeatureEnabled() && remote && typeof remote === 'object') {
        var evaluated = evaluatedRemote(remote, result[DEVICE_CREDENTIAL_KEY]);
        return {
          snapshot: evaluated.quoteAllowed ? remote.snapshot || null : null,
          updatedAt: remote.updatedAt || result[UPDATED_AT_KEY] || '',
          logisticsStatus: logisticsStatus(remote, evaluated),
        };
      }
      return {
        snapshot: result[SNAPSHOT_KEY] || result[LEGACY_SNAPSHOT_KEY] || null,
        updatedAt: result[UPDATED_AT_KEY] || result[LEGACY_UPDATED_AT_KEY] || '',
        logisticsStatus: null,
      };
    });
  }

  function writeSnapshot(snapshot) {
    return chrome.storage.local.set({
      [SNAPSHOT_KEY]: snapshot,
      [UPDATED_AT_KEY]: new Date().toISOString(),
    });
  }

  function writeLogisticsCalculatorState(state) {
    return chrome.storage.local.set({
      [LOGISTICS_CALCULATOR_STATE_KEY]: state,
    });
  }

  function readOfficialSnapshot() {
    return chrome.storage.local.get([
      LOGISTICS_CALCULATOR_STATE_KEY,
      DEVICE_CREDENTIAL_KEY,
      OFFICIAL_SNAPSHOT_KEY,
    ]).then(function (result) {
      var remote = result[LOGISTICS_CALCULATOR_STATE_KEY];
      if (isLogisticsDistributionFeatureEnabled() && remote && typeof remote === 'object') {
        var evaluated = evaluatedRemote(remote, result[DEVICE_CREDENTIAL_KEY]);
        return evaluated.quoteAllowed ? remote.officialSnapshot || null : null;
      }
      return result[OFFICIAL_SNAPSHOT_KEY] || null;
    });
  }

  function readCommissionSnapshot() {
    return chrome.storage.local.get([COMMISSION_SNAPSHOT_KEY]).then(function (result) {
      return result[COMMISSION_SNAPSHOT_KEY] || null;
    });
  }

  function readFxSnapshot() {
    return chrome.storage.local.get([FX_SNAPSHOT_KEY]).then(function (result) {
      return result[FX_SNAPSHOT_KEY] || null;
    });
  }

  window.OZON_CALC_CONFIG_STORE = {
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    LOGISTICS_CALCULATOR_STATE_KEY: LOGISTICS_CALCULATOR_STATE_KEY,
    UPDATED_AT_KEY: UPDATED_AT_KEY,
    OFFICIAL_SNAPSHOT_KEY: OFFICIAL_SNAPSHOT_KEY,
    COMMISSION_SNAPSHOT_KEY: COMMISSION_SNAPSHOT_KEY,
    DEVICE_CREDENTIAL_KEY: DEVICE_CREDENTIAL_KEY,
    FX_SNAPSHOT_KEY: FX_SNAPSHOT_KEY,
    readSnapshot: readSnapshot,
    readOfficialSnapshot: readOfficialSnapshot,
    readCommissionSnapshot: readCommissionSnapshot,
    readFxSnapshot: readFxSnapshot,
    writeSnapshot: writeSnapshot,
    writeLogisticsCalculatorState: writeLogisticsCalculatorState,
  };
}());
