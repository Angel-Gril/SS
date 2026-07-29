(function (global) {
  'use strict';

  var PROFILE_CONTRACT_VERSION = 'extension-byok-profile/v1';
  var CAPABILITY_EVIDENCE_CONTRACT_VERSION = 'extension-byok-capability/v1';
  var PROFILE_STORAGE_KEY = 'ss-erp:byok:profiles:v1';
  var SESSION_SECRETS_STORAGE_KEY = 'ss-erp:byok:session-secrets:v1';
  var SESSION_EVIDENCE_STORAGE_KEY = 'ss-erp:byok:capability-evidence:v1';
  var SESSION_UNCERTAIN_PROBES_STORAGE_KEY = 'ss-erp:byok:uncertain-probes:v1';
  var SESSION_PROVIDER_DISPATCHES_STORAGE_KEY = 'ss-erp:byok:provider-dispatches:v1';
  var OPERATIONS = ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'];
  var REQUEST_MODES = ['json', 'multipart', 'async'];
  var QUALITIES = ['auto', 'low', 'medium', 'high'];
  var OUTPUT_FORMATS = ['png', 'jpeg', 'webp'];
  var MAX_API_KEY_LENGTH = 4096;
  var MAX_PROFILE_COUNT = 100;
  var MAX_CAPABILITY_EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  function error(code, message) {
    var result = new Error(message || code);
    result.code = code;
    return result;
  }

  function text(value, maximum, label) {
    if (typeof value !== 'string') throw error('SS_ERP_BYOK_PROFILE_INVALID', label + ' is invalid');
    var normalized = value.normalize('NFKC').trim();
    var hasControl = false;
    for (var index = 0; index < normalized.length; index += 1) {
      var codePoint = normalized.codePointAt(index);
      if (codePoint <= 0x1f || codePoint === 0x7f) {
        hasControl = true;
        break;
      }
      if (codePoint > 0xffff) index += 1;
    }
    if (!normalized || normalized.length > maximum || hasControl) {
      throw error('SS_ERP_BYOK_PROFILE_INVALID', label + ' is invalid');
    }
    return normalized;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizedKey(value) {
    return String(value || '').replace(/[^a-z0-9]/giu, '').toLowerCase();
  }

  function isSecretKey(value) {
    var key = normalizedKey(value);
    return key === 'key'
      || key === 'sk'
      || key.endsWith('apikey')
      || key.endsWith('authorization')
      || key.endsWith('authheader')
      || key.endsWith('accesstoken')
      || key.endsWith('refreshtoken')
      || key.endsWith('clientsecret')
      || key.endsWith('privatekey')
      || key.endsWith('password')
      || key.endsWith('bearer')
      || key.endsWith('credential')
      || key.endsWith('credentials');
  }

  function assertClosedRecord(value, allowedKeys, code) {
    if (!isRecord(value)) throw error(code || 'SS_ERP_BYOK_PROFILE_INVALID', 'object is invalid');
    Object.keys(value).forEach(function (key) {
      if (isSecretKey(key)) throw error('SS_ERP_BYOK_PROFILE_SECRET_FIELD', 'secret fields are forbidden');
      if (!Object.prototype.hasOwnProperty.call(allowedKeys, key)) {
        throw error(code || 'SS_ERP_BYOK_PROFILE_INVALID', 'unknown field is forbidden');
      }
    });
  }

  function assertPublicHostname(hostname) {
    var normalized = String(hostname || '').toLowerCase();
    if (!normalized
      || normalized.endsWith('.')
      || normalized === 'localhost'
      || normalized.endsWith('.localhost')
      || normalized === 'metadata'
      || normalized === 'metadata.google.internal'
      || normalized.endsWith('.metadata.google.internal')
      || normalized === 'instance-data'
      || normalized.endsWith('.instance-data')
      || normalized.endsWith('.internal')
      || normalized.endsWith('.local')
      || normalized.endsWith('.home.arpa')) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint host is not public');
    }
    // Provider permissions are granted by origin. Keep profile endpoints on
    // canonical multi-label DNS hosts only so IP-literal aliases cannot widen
    // or obscure that authority.
    if (normalized.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized)) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint host is not public');
    }
    if (!normalized.includes('.')
      || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u.test(normalized)) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint host is not public');
    }
  }

  function canonicalizeEndpoint(value) {
    var input = text(value, 300, 'baseUrl');
    var authorityAndPath = input.slice('https://'.length);
    var pathOffset = authorityAndPath.indexOf('/');
    var authority = pathOffset < 0 ? authorityAndPath : authorityAndPath.slice(0, pathOffset);
    var inputPath = pathOffset < 0 ? '' : authorityAndPath.slice(pathOffset);
    if (!/^https:\/\/[^/]/iu.test(input)
      || input.includes('%')
      || input.includes('\\')
      || input.includes('?')
      || input.includes('#')
      || authority.includes('@')
      || inputPath.includes('//')
      || inputPath.split('/').some(function (segment) { return segment === '.' || segment === '..'; })) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint must be canonical HTTPS');
    }
    var raw;
    try {
      raw = new URL(input);
    } catch {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint is invalid');
    }
    if (raw.protocol !== 'https:' || raw.username || raw.password || raw.search || raw.hash) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint must be canonical HTTPS');
    }
    assertPublicHostname(raw.hostname);
    var pathname = raw.pathname || '';
    if (pathname.includes('%') || pathname.includes('\\') || pathname.includes('//')) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint path is invalid');
    }
    while (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    if (/\/images\/(?:generations|edits|tasks)(?:\/|$)/iu.test(pathname)) {
      throw error(
        'SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID',
        'Provider endpoint must be an API base, not an image operation path',
      );
    }
    if (!/\/v1$/iu.test(pathname)) pathname += '/v1';
    if (pathname.length > 240) {
      throw error('SS_ERP_BYOK_PROFILE_ENDPOINT_INVALID', 'Provider endpoint path is invalid');
    }
    return raw.origin + pathname;
  }

  function profileIdentity(profileOrEndpoint, model) {
    var endpoint = isRecord(profileOrEndpoint)
      ? profileOrEndpoint.baseUrl
      : profileOrEndpoint;
    var resolvedModel = isRecord(profileOrEndpoint) ? profileOrEndpoint.model : model;
    return canonicalizeEndpoint(endpoint) + '\u0000' + text(resolvedModel, 200, 'model');
  }

  function normalizeOperations(value) {
    var source = value == null ? ['TEXT_TO_IMAGE'] : value;
    if (!Array.isArray(source) || source.length < 1 || source.length > OPERATIONS.length) {
      throw error('SS_ERP_BYOK_PROFILE_INVALID', 'allowedOperations is invalid');
    }
    var result = Array.from(new Set(source.map(function (item) {
      var operation = String(item || '');
      if (!OPERATIONS.includes(operation)) {
        throw error('SS_ERP_BYOK_PROFILE_INVALID', 'allowedOperations contains an unsupported operation');
      }
      return operation;
    })));
    return OPERATIONS.filter(function (operation) { return result.includes(operation); });
  }

  function normalizePreferences(value) {
    var source = value == null ? {} : value;
    assertClosedRecord(source, {
      defaultSize: true,
      quality: true,
      outputFormat: true,
    });
    var defaultSize = source.defaultSize == null ? '1024x1024' : text(source.defaultSize, 32, 'defaultSize');
    if (!/^\d{2,4}x\d{2,4}$/u.test(defaultSize)) {
      throw error('SS_ERP_BYOK_PROFILE_INVALID', 'defaultSize is invalid');
    }
    var dimensions = defaultSize.split('x').map(Number);
    if (dimensions.some(function (dimension) { return dimension < 1 || dimension > 4096; })) {
      throw error('SS_ERP_BYOK_PROFILE_INVALID', 'defaultSize exceeds the workbench limit');
    }
    var quality = source.quality == null ? 'auto' : String(source.quality);
    var outputFormat = source.outputFormat == null ? 'png' : String(source.outputFormat);
    if (!QUALITIES.includes(quality) || !OUTPUT_FORMATS.includes(outputFormat)) {
      throw error('SS_ERP_BYOK_PROFILE_INVALID', 'profile preferences are invalid');
    }
    return {
      defaultSize: defaultSize,
      quality: quality,
      outputFormat: outputFormat,
    };
  }

  function normalizeProfile(value) {
    assertClosedRecord(value, {
      id: true,
      name: true,
      baseUrl: true,
      model: true,
      allowedOperations: true,
      preferences: true,
    });
    var id = text(value.id, 128, 'profile id');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(id)) {
      throw error('SS_ERP_BYOK_PROFILE_INVALID', 'profile id is invalid');
    }
    var name = text(value.name, 80, 'profile name');
    var baseUrl = canonicalizeEndpoint(value.baseUrl);
    var model = text(value.model, 200, 'model');
    return {
      id: id,
      name: name,
      baseUrl: baseUrl,
      model: model,
      allowedOperations: normalizeOperations(value.allowedOperations),
      preferences: normalizePreferences(value.preferences),
    };
  }

  function publicProfile(value) {
    var profile = normalizeProfile(value);
    return {
      id: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
      allowedOperations: profile.allowedOperations.slice(),
      preferences: Object.assign({}, profile.preferences),
    };
  }

  function normalizeEvidence(value, expectedIdentity, nowValue) {
    assertClosedRecord(value, {
      contractVersion: true,
      profileIdentity: true,
      operation: true,
      requestMode: true,
      policyRevision: true,
      verifiedAt: true,
      expiresAt: true,
    }, 'SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID');
    if (value.contractVersion !== CAPABILITY_EVIDENCE_CONTRACT_VERSION
      || value.profileIdentity !== expectedIdentity
      || !OPERATIONS.includes(String(value.operation))
      || !REQUEST_MODES.includes(String(value.requestMode))) {
      throw error('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'capability evidence identity is invalid');
    }
    var policyRevision = text(value.policyRevision, 200, 'policyRevision');
    var verifiedAt = text(value.verifiedAt, 64, 'verifiedAt');
    var expiresAt = text(value.expiresAt, 64, 'expiresAt');
    var verifiedMillis = Date.parse(verifiedAt);
    var expiresMillis = Date.parse(expiresAt);
    var nowMillis = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue || ''));
    if (!Number.isFinite(verifiedMillis) || !Number.isFinite(expiresMillis)
      || !Number.isFinite(nowMillis)
      || verifiedMillis > nowMillis
      || expiresMillis <= verifiedMillis
      || expiresMillis <= nowMillis
      || expiresMillis - verifiedMillis > MAX_CAPABILITY_EVIDENCE_TTL_MS) {
      throw error('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'capability evidence dates are invalid');
    }
    return {
      contractVersion: CAPABILITY_EVIDENCE_CONTRACT_VERSION,
      profileIdentity: expectedIdentity,
      operation: String(value.operation),
      requestMode: String(value.requestMode),
      policyRevision: policyRevision,
      verifiedAt: new Date(verifiedMillis).toISOString(),
      expiresAt: new Date(expiresMillis).toISOString(),
    };
  }

  function isEvidenceCurrent(value, nowValue) {
    if (!isRecord(value)) return false;
    var expires = Date.parse(String(value.expiresAt || ''));
    var nowMillis = nowValue instanceof Date ? nowValue.getTime() : Date.parse(String(nowValue || ''));
    return Number.isFinite(expires) && Number.isFinite(nowMillis) && expires > nowMillis;
  }

  global.SS_ERP_BYOK_PROFILE_SCHEMA = {
    PROFILE_CONTRACT_VERSION: PROFILE_CONTRACT_VERSION,
    CAPABILITY_EVIDENCE_CONTRACT_VERSION: CAPABILITY_EVIDENCE_CONTRACT_VERSION,
    PROFILE_STORAGE_KEY: PROFILE_STORAGE_KEY,
    // Keep the plural alias for callers that treat the local value as a profile collection.
    PROFILES_STORAGE_KEY: PROFILE_STORAGE_KEY,
    SESSION_SECRETS_STORAGE_KEY: SESSION_SECRETS_STORAGE_KEY,
    SESSION_EVIDENCE_STORAGE_KEY: SESSION_EVIDENCE_STORAGE_KEY,
    SESSION_UNCERTAIN_PROBES_STORAGE_KEY: SESSION_UNCERTAIN_PROBES_STORAGE_KEY,
    SESSION_PROVIDER_DISPATCHES_STORAGE_KEY: SESSION_PROVIDER_DISPATCHES_STORAGE_KEY,
    OPERATIONS: Object.freeze(OPERATIONS.slice()),
    REQUEST_MODES: Object.freeze(REQUEST_MODES.slice()),
    MAX_API_KEY_LENGTH: MAX_API_KEY_LENGTH,
    MAX_PROFILE_COUNT: MAX_PROFILE_COUNT,
    MAX_CAPABILITY_EVIDENCE_TTL_MS: MAX_CAPABILITY_EVIDENCE_TTL_MS,
    canonicalizeEndpoint: canonicalizeEndpoint,
    profileIdentity: profileIdentity,
    normalizeProfile: normalizeProfile,
    publicProfile: publicProfile,
    normalizeEvidence: normalizeEvidence,
    isEvidenceCurrent: isEvidenceCurrent,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
