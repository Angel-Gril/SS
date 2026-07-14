(function (global) {
  'use strict';

  var VERSION_RE = /^\d+\.\d+\.\d+$/;

  function normalizedText(value) {
    return String(value == null ? '' : value).trim();
  }

  function parseVersion(value) {
    var text = normalizedText(value);
    if (!VERSION_RE.test(text)) return null;
    var parts = text.split('.').map(Number);
    if (parts.some(function (part) {
      return !Number.isSafeInteger(part) || part < 0;
    })) return null;
    return { text: text, parts: parts };
  }

  function compareVersions(currentExtensionVersion, minExtensionVersion) {
    var current = parseVersion(currentExtensionVersion);
    var minimum = parseVersion(minExtensionVersion);
    if (!current || !minimum) return null;
    for (var index = 0; index < 3; index += 1) {
      if (current.parts[index] === minimum.parts[index]) continue;
      return current.parts[index] > minimum.parts[index] ? 1 : -1;
    }
    return 0;
  }

  function evaluateCompatibility(currentExtensionVersion, minExtensionVersion) {
    var currentText = normalizedText(currentExtensionVersion);
    var minimumText = normalizedText(minExtensionVersion);
    var current = parseVersion(currentText);
    if (!current) {
      return {
        compatible: false,
        reason: 'current_version_invalid',
        currentExtensionVersion: currentText,
        minExtensionVersion: minimumText,
      };
    }
    var minimum = parseVersion(minimumText);
    if (!minimum) {
      return {
        compatible: false,
        reason: 'minimum_version_invalid',
        currentExtensionVersion: currentText,
        minExtensionVersion: minimumText,
      };
    }
    var comparison = compareVersions(currentText, minimumText);
    return {
      compatible: comparison >= 0,
      reason: comparison >= 0 ? 'compatible' : 'upgrade_required',
      currentExtensionVersion: currentText,
      minExtensionVersion: minimumText,
    };
  }

  global.SS_ERP_LOGISTICS_VERSION_POLICY = {
    compareVersions: compareVersions,
    evaluateCompatibility: evaluateCompatibility,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
