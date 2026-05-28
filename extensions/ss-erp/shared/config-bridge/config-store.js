(function () {
  var SNAPSHOT_KEY = 'ozon-calc:config-snapshot';
  var UPDATED_AT_KEY = 'ozon-calc:config-updated-at';
  var OFFICIAL_SNAPSHOT_KEY = 'ozon-calculator:official-snapshot';
  var COMMISSION_SNAPSHOT_KEY = 'ozon-calculator:commission-snapshot';
  var FX_SNAPSHOT_KEY = 'ozon-calculator:fx-snapshot';
  var LEGACY_PREFIX = String.fromCharCode(113, 101, 104, 101, 108, 112) + '-clone';
  var LEGACY_SNAPSHOT_KEY = LEGACY_PREFIX + ':config-snapshot';
  var LEGACY_UPDATED_AT_KEY = LEGACY_PREFIX + ':config-updated-at';

  function readSnapshot() {
    return chrome.storage.local.get([SNAPSHOT_KEY, UPDATED_AT_KEY, LEGACY_SNAPSHOT_KEY, LEGACY_UPDATED_AT_KEY]).then(function (result) {
      return {
        snapshot: result[SNAPSHOT_KEY] || result[LEGACY_SNAPSHOT_KEY] || null,
        updatedAt: result[UPDATED_AT_KEY] || result[LEGACY_UPDATED_AT_KEY] || '',
      };
    });
  }

  function writeSnapshot(snapshot) {
    return chrome.storage.local.set({
      [SNAPSHOT_KEY]: snapshot,
      [UPDATED_AT_KEY]: new Date().toISOString(),
    });
  }

  function readOfficialSnapshot() {
    return chrome.storage.local.get([OFFICIAL_SNAPSHOT_KEY]).then(function (result) {
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
    UPDATED_AT_KEY: UPDATED_AT_KEY,
    OFFICIAL_SNAPSHOT_KEY: OFFICIAL_SNAPSHOT_KEY,
    COMMISSION_SNAPSHOT_KEY: COMMISSION_SNAPSHOT_KEY,
    FX_SNAPSHOT_KEY: FX_SNAPSHOT_KEY,
    readSnapshot: readSnapshot,
    readOfficialSnapshot: readOfficialSnapshot,
    readCommissionSnapshot: readCommissionSnapshot,
    readFxSnapshot: readFxSnapshot,
    writeSnapshot: writeSnapshot,
  };
}());
