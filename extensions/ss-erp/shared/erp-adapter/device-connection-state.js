(function (root) {
  'use strict';

  function resolve(input) {
    var verificationFailed = Boolean(input && input.verificationFailed);
    var storedPaired = Boolean(input && input.storedPaired);
    var hasEndpoint = Boolean(input && input.hasEndpoint);
    if (verificationFailed) return storedPaired ? 'unreachable' : 'invalid';
    if (storedPaired) return 'paired';
    return hasEndpoint ? 'authorization_required' : 'unconfigured';
  }

  function isScopedStateAuthoritative(value) {
    return value === 'paired'
      || value === 'invalid'
      || value === 'unreachable'
      || value === 'authorization_required';
  }

  function parseOrigin(value) {
    try {
      var parsed = new URL(String(value || '').trim());
      if (parsed.username || parsed.password) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function isLocalPage(parsed) {
    return parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  }

  function senderPageUrl(sender) {
    if (typeof sender === 'string') return sender;
    return sender && (sender.url || sender.documentUrl || sender.tab && sender.tab.url) || '';
  }

  function isAllowedDeploymentSender(defaults, sender, runtimeId) {
    var target = String(defaults && defaults.target || 'source').trim();
    var senderUrl = parseOrigin(senderPageUrl(sender));
    if (!senderUrl) return false;
    var extensionId = String(runtimeId || '').trim();
    if (extensionId && sender && String(sender.id || '').trim() === extensionId
      && senderUrl.protocol === 'chrome-extension:' && senderUrl.hostname === extensionId) return true;
    if (target === 'local') return isLocalPage(senderUrl);
    if (target === 'source' && isLocalPage(senderUrl)) return true;
    if (target !== 'cloud' && target !== 'source') return false;
    if (senderUrl.protocol !== 'https:') return false;
    var allowedOrigins = [
      defaults && defaults.erpBaseUrl,
      defaults && defaults.erpAdminBaseUrl,
    ].map(parseOrigin).filter(function (value) {
      return value && value.protocol === 'https:';
    }).map(function (value) {
      return value.origin;
    });
    return allowedOrigins.includes(senderUrl.origin);
  }

  function isAllowedCloudDeviceClaim(defaults, sender, baseUrl, runtimeId) {
    if (String(defaults && defaults.target || '').trim() !== 'cloud') return false;
    if (!isAllowedDeploymentSender(defaults, sender, runtimeId)) return false;
    var packagedApiUrl = parseOrigin(defaults && defaults.erpApiBaseUrl);
    var requestedApiUrl = parseOrigin(baseUrl);
    return Boolean(packagedApiUrl && requestedApiUrl
      && packagedApiUrl.protocol === 'https:'
      && requestedApiUrl.protocol === 'https:'
      && packagedApiUrl.origin === requestedApiUrl.origin);
  }

  root.SS_ERP_EXTENSION_DEVICE_CONNECTION_STATE = Object.freeze({
    resolve: resolve,
    isScopedStateAuthoritative: isScopedStateAuthoritative,
    isAllowedDeploymentSender: isAllowedDeploymentSender,
    isAllowedCloudDeviceClaim: isAllowedCloudDeviceClaim,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
