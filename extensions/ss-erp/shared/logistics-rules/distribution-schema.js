(function (global) {
  'use strict';

  var semanticArrayKeys = new Set([
    'blockers',
    'cityAvailabilityOverlays',
    'clusterDeliverySpeeds',
    'destinationEvidence',
    'formulas',
    'methodBindings',
    'officialSamples',
    'providers',
    'requirements',
    'selectedServiceKeys',
    'services',
    'sources',
    'tariffs',
  ]);

  function compareCodeUnits(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function canonicalSortKey(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object') {
      var keys = [
        'stableServiceKey',
        'providerId',
        'fingerprintKey',
        'requirementKey',
        'sourceChecksum',
        'clusterName',
      ];
      for (var index = 0; index < keys.length; index += 1) {
        if (
          Object.prototype.hasOwnProperty.call(value, keys[index]) &&
          typeof value[keys[index]] === 'string'
        ) {
          return String(value[keys[index]]);
        }
      }
    }
    return JSON.stringify(value);
  }

  function normalizeCanonical(value, parentKey) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers');
      return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) {
      var values = value.map(function (item) {
        return normalizeCanonical(item, '');
      });
      if (semanticArrayKeys.has(parentKey || '')) {
        values.sort(function (left, right) {
          var keyOrder = compareCodeUnits(canonicalSortKey(left), canonicalSortKey(right));
          return keyOrder !== 0
            ? keyOrder
            : compareCodeUnits(JSON.stringify(left), JSON.stringify(right));
        });
      }
      return values;
    }
    if (typeof value !== 'object' || value === undefined) {
      throw new TypeError('Canonical JSON requires plain JSON objects');
    }
    var prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
      throw new TypeError('Canonical JSON requires plain JSON objects');
    }

    var result = Object.create(null);
    Object.keys(value)
      .sort(compareCodeUnits)
      .forEach(function (key) {
        if (value[key] === undefined)
          throw new TypeError('Canonical JSON does not allow undefined');
        result[key] = normalizeCanonical(value[key], key);
      });
    return result;
  }

  function canonicalStringify(value) {
    return JSON.stringify(normalizeCanonical(value, ''));
  }

  var CHECKSUM_RE = /^[a-f0-9]{64}$/;
  var VERSION_RE = /^\d+\.\d+\.\d+$/;
  var MAX_DEPTH = 64;
  var MAX_NODES = 200000;
  var MAX_ARRAY_LENGTH = 50000;
  var MAX_STRING_LENGTH = 300000;
  var MAX_KEY_LENGTH = 200;
  var MAX_ENCODED_BYTES = 8 * 1024 * 1024;
  var CREDENTIAL_KEYS = new Set([
    'accesstoken',
    'apikey',
    'apisecret',
    'authorization',
    'clientsecret',
    'cookie',
    'password',
    'refreshtoken',
    'setcookie',
  ]);

  var ENVELOPE_FIELDS = [
    'schemaVersion', 'deploymentId', 'assignmentId', 'releaseId', 'releaseSequence',
    'contentChecksum', 'effectiveChecksum', 'minExtensionVersion', 'validUntil',
    'staleUntil', 'payload',
  ];
  var PAYLOAD_FIELDS = [
    'scope', 'revisionPayload', 'manifest', 'assignment', 'deliveryMethodBindings',
    'officialResolutions',
  ];
  var FROZEN_SCOPE_FIELDS = [
    'deploymentId', 'schemaMajor',
    'channelId', 'scopeKey', 'tenantId', 'shopId', 'warehouseId', 'ozonCompanyId',
    'originCountryUid', 'originCityUid', 'originCountryCode', 'destinationCountryUid',
    'destinationLocationUid', 'destinationLabel', 'destinationCountryCode',
  ];
  var REVISION_FIELDS = [
    'schema', 'scope', 'sellerContext', 'sources', 'services', 'formulas',
    'officialSamples', 'cityAvailabilityOverlays', 'destinationEvidence',
    'officialPolicy', 'validationMatrixInput',
    'providerInventory', 'selectedServiceKeys', 'defaultServiceKeys', 'validationMatrix',
    'candidateSetChecksum', 'validUntil', 'staleUntil', 'minExtensionVersion',
  ];
  var REVISION_SCOPE_FIELDS = [
    'deploymentId', 'apiOrigin', 'tenantId', 'shopId', 'ozonCompanyId',
    'erpWarehouseId', 'platformWarehouseId', 'originCountryUid', 'originCityUid',
    'destinationCountryUid', 'destinationLocationUid', 'schemaMajor',
  ];
  var MANIFEST_FIELDS = [
    'schemaVersion', 'minimumExtensionVersion', 'destination', 'selectedServiceKeys',
    'defaultServiceKeys', 'deliveryMethodBindingIds', 'officialResolutions',
    'routeClassifications', 'validationReport', 'revisionId',
  ];
  var DESTINATION_FIELDS = [
    'destinationCountryUid', 'destinationLocationUid', 'destinationLabel',
    'destinationCountryCode',
  ];
  var ASSIGNMENT_FIELDS = [
    'id', 'destinationCountryUid', 'destinationCountryCode',
    'destinationLocationUid', 'destinationLabel',
  ];

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function addError(errors, message) {
    if (errors.length < 50) errors.push(message);
  }

  function normalizedCredentialKey(key) {
    return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function inspectJsonBudget(value, errors) {
    var stack = [{ value: value, depth: 0, path: '$' }];
    var nodes = 0;
    while (stack.length > 0 && errors.length < 50) {
      var current = stack.pop();
      nodes += 1;
      if (nodes > MAX_NODES) {
        addError(errors, 'Delivery payload exceeds the node budget');
        break;
      }
      if (current.depth > MAX_DEPTH) {
        addError(errors, 'Delivery payload exceeds the maximum depth budget');
        break;
      }
      var child = current.value;
      if (child === null || typeof child === 'boolean') continue;
      if (typeof child === 'string') {
        if (child.length > MAX_STRING_LENGTH) {
          addError(errors, current.path + ' exceeds the string size budget');
        }
        continue;
      }
      if (typeof child === 'number') {
        if (!Number.isFinite(child)) addError(errors, current.path + ' must be a finite number');
        continue;
      }
      if (Array.isArray(child)) {
        if (child.length > MAX_ARRAY_LENGTH) {
          addError(errors, current.path + ' exceeds the array length budget');
          continue;
        }
        for (var arrayIndex = child.length - 1; arrayIndex >= 0; arrayIndex -= 1) {
          stack.push({
            value: child[arrayIndex], depth: current.depth + 1,
            path: current.path + '[' + arrayIndex + ']',
          });
        }
        continue;
      }
      if (!isPlainObject(child)) {
        addError(errors, current.path + ' must contain only plain JSON objects');
        continue;
      }
      var keys = Object.keys(child);
      if (keys.length > MAX_ARRAY_LENGTH) {
        addError(errors, current.path + ' exceeds the object field budget');
        continue;
      }
      for (var keyIndex = keys.length - 1; keyIndex >= 0; keyIndex -= 1) {
        var key = keys[keyIndex];
        if (key.length > MAX_KEY_LENGTH) {
          addError(errors, current.path + ' contains an oversized field name');
          continue;
        }
        if (CREDENTIAL_KEYS.has(normalizedCredentialKey(key))) {
          addError(errors, current.path + '.' + key + ' contains forbidden credential material');
          continue;
        }
        if (child[key] === undefined) {
          addError(errors, current.path + '.' + key + ' cannot be undefined');
          continue;
        }
        stack.push({
          value: child[key], depth: current.depth + 1, path: current.path + '.' + key,
        });
      }
    }
    if (errors.length > 0) return;
    var serialized = JSON.stringify(value);
    if (new global.TextEncoder().encode(serialized).byteLength > MAX_ENCODED_BYTES) {
      addError(errors, 'Delivery payload exceeds the encoded size budget');
    }
  }

  function normalizeOrdered(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError('Canonical JSON requires finite numbers');
      return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) return value.map(normalizeOrdered);
    if (!isPlainObject(value)) throw new TypeError('Canonical JSON requires plain objects');
    var result = Object.create(null);
    Object.keys(value).sort(compareCodeUnits).forEach(function (key) {
      if (value[key] === undefined) throw new TypeError('Canonical JSON does not allow undefined');
      result[key] = normalizeOrdered(value[key]);
    });
    return result;
  }

  function orderedStringify(value) {
    return JSON.stringify(normalizeOrdered(value));
  }

  async function sha256Text(value) {
    if (!global.crypto || !global.crypto.subtle || typeof global.TextEncoder !== 'function') {
      throw new Error('SHA-256 Web Crypto support is unavailable');
    }
    var bytes = new global.TextEncoder().encode(value);
    var digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function sha256CanonicalValue(value) {
    return sha256Text(canonicalStringify(value));
  }

  function sha256OrderedValue(value) {
    return sha256Text(orderedStringify(value));
  }

  function validateClosedObject(value, fields, requiredFields, label, errors) {
    if (!isPlainObject(value)) {
      addError(errors, label + ' must be an object');
      return false;
    }
    var allowed = new Set(fields);
    Object.keys(value).forEach(function (key) {
      if (!allowed.has(key)) addError(errors, label + ' has unknown field ' + key);
    });
    requiredFields.forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) {
        addError(errors, label + '.' + field + ' is required');
      }
    });
    return true;
  }

  function textValue(value, label, errors, maxLength) {
    if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
      addError(errors, label + ' must be a non-empty trimmed string');
      return '';
    }
    if (value.length > (maxLength || 300)) addError(errors, label + ' is too long');
    return value;
  }

  function optionalCode(value, label, errors) {
    if (value === null || value === undefined) return;
    var code = textValue(value, label, errors, 10);
    if (code && !/^[A-Z]{2,3}$/.test(code)) addError(errors, label + ' must be an uppercase code');
  }

  function dateValue(value, label, errors) {
    var normalized = textValue(value, label, errors, 40);
    var milliseconds = Date.parse(normalized);
    if (!Number.isFinite(milliseconds)) addError(errors, label + ' must be an ISO date');
    return milliseconds;
  }

  function stringArray(value, label, errors, allowEmpty) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      addError(errors, label + ' must be ' + (allowEmpty ? 'an array' : 'a non-empty array'));
      return [];
    }
    var result = [];
    var seen = new Set();
    value.forEach(function (item, index) {
      var normalized = textValue(item, label + '[' + index + ']', errors, 500);
      if (normalized && seen.has(normalized)) addError(errors, label + ' must contain unique values');
      if (normalized) seen.add(normalized);
      result.push(normalized);
    });
    return result;
  }

  function sortedStrings(values) {
    return values.slice().sort(compareCodeUnits);
  }

  function sameStringSet(left, right) {
    return JSON.stringify(sortedStrings(left)) === JSON.stringify(sortedStrings(right));
  }

  function requireSame(left, right, label, errors) {
    if (left !== right) addError(errors, label + ' scope mismatch');
  }

  async function validateDeliveryEnvelope(value) {
    var errors = [];
    try {
      inspectJsonBudget(value, errors);
      if (errors.length > 0) return { valid: false, errors: errors };

      if (!validateClosedObject(value, ENVELOPE_FIELDS, ENVELOPE_FIELDS, 'delivery envelope', errors)) {
        return { valid: false, errors: errors };
      }
      if (value.schemaVersion !== 'ozon-logistics/delivery-v1') {
        addError(errors, 'delivery envelope schema version is unsupported');
      }
      var deploymentId = textValue(value.deploymentId, 'deploymentId', errors, 300);
      var assignmentId = textValue(value.assignmentId, 'assignmentId', errors, 300);
      textValue(value.releaseId, 'releaseId', errors, 300);
      if (!Number.isSafeInteger(value.releaseSequence) || value.releaseSequence < 1) {
        addError(errors, 'releaseSequence must be a positive safe integer');
      }
      var contentChecksum = textValue(value.contentChecksum, 'contentChecksum', errors, 64);
      var effectiveChecksum = textValue(value.effectiveChecksum, 'effectiveChecksum', errors, 64);
      if (!CHECKSUM_RE.test(contentChecksum)) addError(errors, 'contentChecksum must be lowercase SHA-256 hex');
      if (!CHECKSUM_RE.test(effectiveChecksum)) addError(errors, 'effectiveChecksum must be lowercase SHA-256 hex');
      var minimumVersion = textValue(value.minExtensionVersion, 'minExtensionVersion', errors, 40);
      if (!VERSION_RE.test(minimumVersion)) addError(errors, 'minExtensionVersion must be semantic version x.y.z');
      var validMilliseconds = dateValue(value.validUntil, 'validUntil', errors);
      var staleMilliseconds = dateValue(value.staleUntil, 'staleUntil', errors);
      if (Number.isFinite(validMilliseconds) && Number.isFinite(staleMilliseconds)
        && staleMilliseconds <= validMilliseconds) {
        addError(errors, 'staleUntil must be later than validUntil');
      }

      var payload = value.payload;
      validateClosedObject(payload, PAYLOAD_FIELDS, PAYLOAD_FIELDS, 'payload', errors);
      if (!isPlainObject(payload)) return { valid: false, errors: errors };
      var frozenScope = payload.scope;
      validateClosedObject(
        frozenScope,
        FROZEN_SCOPE_FIELDS,
        FROZEN_SCOPE_FIELDS.filter(function (field) {
          return field !== 'originCountryCode' && field !== 'destinationCountryCode';
        }),
        'payload.scope',
        errors,
      );
      var scopeValues = {};
      FROZEN_SCOPE_FIELDS.forEach(function (field) {
        if (field === 'schemaMajor') {
          if (!Number.isSafeInteger(frozenScope && frozenScope[field]) || frozenScope[field] !== 1) {
            addError(errors, 'payload.scope.schemaMajor must be 1');
          }
          scopeValues[field] = frozenScope && frozenScope[field];
          return;
        }
        if (field === 'originCountryCode' || field === 'destinationCountryCode') {
          optionalCode(frozenScope && frozenScope[field], 'payload.scope.' + field, errors);
        } else {
          scopeValues[field] = textValue(
            frozenScope && frozenScope[field],
            'payload.scope.' + field,
            errors,
            field === 'scopeKey' ? 4096 : 500,
          );
        }
      });

      var revision = payload.revisionPayload;
      validateClosedObject(revision, REVISION_FIELDS, REVISION_FIELDS, 'payload.revisionPayload', errors);
      if (!isPlainObject(revision)) return { valid: false, errors: errors };
      if (revision.schema !== 'ozon-logistics-release-content/v1') {
        addError(errors, 'revision payload schema is unsupported');
      }
      var revisionScope = revision.scope;
      validateClosedObject(
        revisionScope,
        REVISION_SCOPE_FIELDS,
        REVISION_SCOPE_FIELDS,
        'payload.revisionPayload.scope',
        errors,
      );
      var revisionScopeValues = {};
      REVISION_SCOPE_FIELDS.forEach(function (field) {
        if (field === 'schemaMajor') {
          if (!Number.isSafeInteger(revisionScope && revisionScope[field]) || revisionScope[field] !== 1) {
            addError(errors, 'payload.revisionPayload.scope.schemaMajor must be 1');
          }
          revisionScopeValues[field] = revisionScope && revisionScope[field];
        } else {
          revisionScopeValues[field] = textValue(
            revisionScope && revisionScope[field],
            'payload.revisionPayload.scope.' + field,
            errors,
            field === 'apiOrigin' ? 2048 : 500,
          );
        }
      });

      var manifest = payload.manifest;
      validateClosedObject(manifest, MANIFEST_FIELDS, MANIFEST_FIELDS, 'payload.manifest', errors);
      if (!isPlainObject(manifest)) return { valid: false, errors: errors };
      if (manifest.schemaVersion !== '1') addError(errors, 'payload.manifest schema version is unsupported');
      var manifestVersion = textValue(
        manifest.minimumExtensionVersion,
        'payload.manifest.minimumExtensionVersion',
        errors,
        40,
      );
      if (!VERSION_RE.test(manifestVersion)) addError(errors, 'manifest minimum version is invalid');
      textValue(manifest.revisionId, 'payload.manifest.revisionId', errors, 300);
      var destination = manifest.destination;
      validateClosedObject(
        destination,
        DESTINATION_FIELDS,
        DESTINATION_FIELDS.filter(function (field) { return field !== 'destinationCountryCode'; }),
        'payload.manifest.destination',
        errors,
      );
      var destinationValues = {};
      DESTINATION_FIELDS.forEach(function (field) {
        if (field === 'destinationCountryCode') {
          optionalCode(destination && destination[field], 'payload.manifest.destination.' + field, errors);
        } else {
          destinationValues[field] = textValue(
            destination && destination[field],
            'payload.manifest.destination.' + field,
            errors,
            500,
          );
        }
      });

      var assignment = payload.assignment;
      validateClosedObject(
        assignment,
        ASSIGNMENT_FIELDS,
        ASSIGNMENT_FIELDS.filter(function (field) { return field !== 'destinationCountryCode'; }),
        'payload.assignment',
        errors,
      );
      var assignmentValues = {};
      ASSIGNMENT_FIELDS.forEach(function (field) {
        if (field === 'destinationCountryCode') {
          optionalCode(assignment && assignment[field], 'payload.assignment.' + field, errors);
        } else {
          assignmentValues[field] = textValue(
            assignment && assignment[field],
            'payload.assignment.' + field,
            errors,
            500,
          );
        }
      });

      var selectedKeys = stringArray(revision.selectedServiceKeys, 'revision selectedServiceKeys', errors, false);
      var defaultKeys = stringArray(revision.defaultServiceKeys, 'revision defaultServiceKeys', errors, true);
      var manifestSelected = stringArray(manifest.selectedServiceKeys, 'manifest selectedServiceKeys', errors, false);
      var manifestDefaults = stringArray(manifest.defaultServiceKeys, 'manifest defaultServiceKeys', errors, true);
      var bindingIds = stringArray(manifest.deliveryMethodBindingIds, 'manifest deliveryMethodBindingIds', errors, true);
      if (!Array.isArray(revision.sources) || revision.sources.length === 0) addError(errors, 'revision sources are required');
      if (!Array.isArray(revision.services) || revision.services.length === 0) addError(errors, 'revision services are required');
      if (!Array.isArray(revision.formulas) || revision.formulas.length === 0) addError(errors, 'revision formulas are required');
      ['officialSamples', 'cityAvailabilityOverlays', 'destinationEvidence'].forEach(function (field) {
        if (!Array.isArray(revision[field])) addError(errors, 'revision ' + field + ' must be an array');
      });
      if (!isPlainObject(revision.providerInventory)) addError(errors, 'revision providerInventory must be an object');
      if (!isPlainObject(revision.validationMatrix)) addError(errors, 'revision validationMatrix must be an object');
      if (!isPlainObject(revision.officialPolicy)) addError(errors, 'revision officialPolicy must be an object');
      if (!isPlainObject(revision.validationMatrixInput)) addError(errors, 'revision validationMatrixInput must be an object');
      if (!CHECKSUM_RE.test(String(revision.candidateSetChecksum || ''))) {
        addError(errors, 'revision candidateSetChecksum must be lowercase SHA-256 hex');
      }
      if (!isPlainObject(manifest.routeClassifications)) addError(errors, 'manifest routeClassifications must be an object');
      if (!isPlainObject(manifest.validationReport)) addError(errors, 'manifest validationReport must be an object');
      if (!Array.isArray(manifest.officialResolutions)) addError(errors, 'manifest officialResolutions must be an array');
      if (!Array.isArray(payload.deliveryMethodBindings)) addError(errors, 'deliveryMethodBindings must be an array');
      if (!Array.isArray(payload.officialResolutions)) addError(errors, 'officialResolutions must be an array');

      requireSame(deploymentId, revisionScopeValues.deploymentId, 'deployment', errors);
      requireSame(scopeValues.tenantId, revisionScopeValues.tenantId, 'tenant', errors);
      requireSame(deploymentId, scopeValues.deploymentId, 'frozen deployment', errors);
      requireSame(scopeValues.schemaMajor, revisionScopeValues.schemaMajor, 'schema major', errors);
      requireSame(scopeValues.shopId, revisionScopeValues.shopId, 'shop', errors);
      requireSame(scopeValues.warehouseId, revisionScopeValues.erpWarehouseId, 'warehouse', errors);
      requireSame(scopeValues.ozonCompanyId, revisionScopeValues.ozonCompanyId, 'Ozon company', errors);
      requireSame(scopeValues.originCountryUid, revisionScopeValues.originCountryUid, 'origin country', errors);
      requireSame(scopeValues.originCityUid, revisionScopeValues.originCityUid, 'origin city', errors);
      requireSame(scopeValues.destinationCountryUid, revisionScopeValues.destinationCountryUid, 'destination country', errors);
      requireSame(scopeValues.destinationLocationUid, revisionScopeValues.destinationLocationUid, 'destination location', errors);
      requireSame(assignmentId, assignmentValues.id, 'assignment', errors);
      requireSame(scopeValues.destinationCountryUid, assignmentValues.destinationCountryUid, 'assignment destination country', errors);
      requireSame(scopeValues.destinationLocationUid, assignmentValues.destinationLocationUid, 'assignment destination location', errors);
      requireSame(scopeValues.destinationLabel, assignmentValues.destinationLabel, 'assignment destination label', errors);
      requireSame(scopeValues.destinationCountryUid, destinationValues.destinationCountryUid, 'manifest destination country', errors);
      requireSame(scopeValues.destinationLocationUid, destinationValues.destinationLocationUid, 'manifest destination location', errors);
      requireSame(scopeValues.destinationLabel, destinationValues.destinationLabel, 'manifest destination label', errors);
      requireSame(minimumVersion, manifestVersion, 'minimum extension version', errors);
      requireSame(minimumVersion, revision.minExtensionVersion, 'revision minimum extension version', errors);
      requireSame(value.validUntil, revision.validUntil, 'validUntil freshness', errors);
      requireSame(value.staleUntil, revision.staleUntil, 'staleUntil freshness', errors);
      if (!sameStringSet(selectedKeys, manifestSelected)) addError(errors, 'manifest selected services mismatch');
      if (!sameStringSet(defaultKeys, manifestDefaults)) addError(errors, 'manifest default services mismatch');
      defaultKeys.forEach(function (key) {
        if (selectedKeys.indexOf(key) < 0) addError(errors, 'default services must be selected services');
      });
      selectedKeys.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(manifest.routeClassifications || {}, key)) {
          addError(errors, 'selected service ' + key + ' has no route classification');
        }
      });
      if (Array.isArray(payload.deliveryMethodBindings)) {
        var frozenBindingIds = payload.deliveryMethodBindings.map(function (binding, index) {
          if (!isPlainObject(binding)) {
            addError(errors, 'deliveryMethodBindings[' + index + '] must be an object');
            return '';
          }
          return textValue(binding.id, 'deliveryMethodBindings[' + index + '].id', errors, 300);
        });
        if (!sameStringSet(bindingIds, frozenBindingIds)) {
          addError(errors, 'manifest delivery method bindings mismatch');
        }
      }

      if (errors.length === 0) {
        var expectedContentChecksum = await sha256CanonicalValue(revision);
        if (expectedContentChecksum !== contentChecksum) addError(errors, 'content checksum mismatch');
        var expectedEffectiveChecksum = await sha256OrderedValue({
          sequence: value.releaseSequence,
          channelId: scopeValues.channelId,
          scopeKey: scopeValues.scopeKey,
          contentChecksum: contentChecksum,
          frozenPayload: payload,
        });
        if (expectedEffectiveChecksum !== effectiveChecksum) addError(errors, 'effective checksum mismatch');
      }
    } catch (error) {
      addError(errors, error && error.message ? error.message : 'Delivery envelope validation failed');
    }
    return errors.length > 0
      ? { valid: false, errors: errors }
      : { valid: true, errors: [], bundle: value };
  }

  global.SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA = {
    canonicalStringify: canonicalStringify,
    sha256CanonicalValue: sha256CanonicalValue,
    validateDeliveryEnvelope: validateDeliveryEnvelope,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
