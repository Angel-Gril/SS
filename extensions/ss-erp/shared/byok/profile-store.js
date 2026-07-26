(function (global) {
  'use strict';

  /*
   * The profile store is deliberately small and boring.  It is the only module that
   * knows where BYOK profile metadata and session secrets live.  Keeping the two
   * records separate makes it difficult for a settings page (or a content script)
   * to accidentally persist a key while still allowing the background worker to
   * retrieve it when making a Provider request.
   */
  var schema = global.SS_ERP_BYOK_PROFILE_SCHEMA;
  if (!schema) throw new Error('SS_ERP_BYOK_PROFILE_SCHEMA is required');

  // Use constructors from the owning global. This keeps values returned by the
  // store in the caller's realm when the contract is evaluated in a VM as well as
  // in a normal extension page/background context.
  var HostArray = global.Array || Array;
  var HostObject = global.Object || Object;
  var HostJSON = global.JSON || JSON;
  var UNCERTAIN_PROBE_CONTRACT_VERSION = 'extension-byok-uncertain-probe/v1';
  var PROVIDER_DISPATCH_CONTRACT_VERSION = 'extension-byok-provider-dispatch/v1';
  var MAX_UNCERTAIN_PROBES_PER_PROFILE = 12;
  var MAX_PROVIDER_DISPATCHES = 100;

  function storeError(code, message) {
    var result = new Error(message || code);
    result.code = code;
    return result;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function clone(value) {
    if (value === undefined) return undefined;
    return HostJSON.parse(HostJSON.stringify(value));
  }

  function hostObject() {
    return new HostObject();
  }

  function hostArray() {
    return new HostArray();
  }

  function externalProfile(value) {
    var result = hostObject();
    result.id = value.id;
    result.name = value.name;
    result.baseUrl = value.baseUrl;
    result.model = value.model;
    result.allowedOperations = hostArray();
    value.allowedOperations.forEach(function (operation) { result.allowedOperations.push(operation); });
    result.preferences = hostObject();
    result.preferences.defaultSize = value.preferences.defaultSize;
    result.preferences.quality = value.preferences.quality;
    result.preferences.outputFormat = value.preferences.outputFormat;
    return result;
  }

  function externalEvidence(value) {
    var result = hostObject();
    result.contractVersion = value.contractVersion;
    result.profileIdentity = value.profileIdentity;
    result.operation = value.operation;
    result.requestMode = value.requestMode;
    result.policyRevision = value.policyRevision;
    result.verifiedAt = value.verifiedAt;
    result.expiresAt = value.expiresAt;
    return result;
  }

  function nowDate(now) {
    var value = now();
    var parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      throw storeError('SS_ERP_BYOK_CLOCK_INVALID', 'Current time is unavailable');
    }
    return parsed;
  }

  function profileId(value) {
    if (typeof value !== 'string') return '';
    var normalized = value.normalize('NFKC').trim();
    return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(normalized) ? normalized : '';
  }

  function assertStorage(storage, code) {
    if (!storage || typeof storage.get !== 'function'
      || typeof storage.set !== 'function' || typeof storage.remove !== 'function') {
      throw storeError(code, code === 'SS_ERP_BYOK_SESSION_STORAGE_UNAVAILABLE'
        ? 'Session storage is unavailable'
        : 'Storage is unavailable');
    }
    return storage;
  }

  function assertSessionStorage(storage) {
    return assertStorage(storage, 'SS_ERP_BYOK_SESSION_STORAGE_UNAVAILABLE');
  }

  function normalizeApiKey(value) {
    if (typeof value !== 'string') {
      throw storeError('SS_ERP_BYOK_API_KEY_INVALID', 'API key is invalid');
    }
    // API keys are opaque credentials. Do not Unicode-normalize them; only remove
    // accidental outer whitespace and reject control characters.
    var normalized = value.trim();
    if (!normalized || normalized.length > schema.MAX_API_KEY_LENGTH) {
      throw storeError('SS_ERP_BYOK_API_KEY_INVALID', 'API key is invalid');
    }
    for (var index = 0; index < normalized.length; index += 1) {
      var codePoint = normalized.codePointAt(index);
      if (codePoint <= 0x1f || codePoint === 0x7f) {
        throw storeError('SS_ERP_BYOK_API_KEY_INVALID', 'API key is invalid');
      }
      if (codePoint > 0xffff) index += 1;
    }
    return normalized;
  }

  function normalizeProfiles(raw) {
    if (!Array.isArray(raw)) return hostArray();
    var profiles = hostArray();
    var seen = Object.create(null);
    raw.forEach(function (candidate) {
      try {
        var normalized = externalProfile(schema.publicProfile(candidate));
        if (!seen[normalized.id]) {
          seen[normalized.id] = true;
          profiles.push(normalized);
        }
      } catch {
        // Corrupt local data is discarded rather than being trusted or exposed.
      }
    });
    return profiles.slice(0, schema.MAX_PROFILE_COUNT);
  }

  function normalizeSecretMap(raw) {
    if (!isRecord(raw)) return Object.create(null);
    var result = Object.create(null);
    Object.keys(raw).forEach(function (key) {
      var id = profileId(key);
      if (!id) return;
      try {
        var entry = raw[key];
        // A credential is valid only when it carries the exact profile identity
        // that was current when it was entered. Legacy string-only records are
        // discarded rather than guessed or rebound.
        if (!isRecord(entry)
          || typeof entry.profileIdentity !== 'string'
          || !entry.profileIdentity
          || entry.profileIdentity.length > 500
          || !credentialRevision(entry.credentialRevision)) return;
        result[id] = {
          profileIdentity: entry.profileIdentity,
          apiKey: normalizeApiKey(entry.apiKey),
          credentialRevision: entry.credentialRevision,
        };
      } catch {
        // Invalid/corrupt secrets are not returned and are removed on the next write.
      }
    });
    return result;
  }

  function normalizeEvidenceMap(raw, currentTime) {
    var result = Object.create(null);
    if (!isRecord(raw)) return result;
    Object.keys(raw).forEach(function (key) {
      var id = profileId(key);
      if (!id) return;
      var rows = Array.isArray(raw[key]) ? raw[key] : [];
      var byIdentity = Object.create(null);
      rows.forEach(function (candidate) {
        try {
          // The expected identity is checked by the caller once the profile is known.
          if (!isRecord(candidate)) return;
          var identity = typeof candidate.profileIdentity === 'string'
            ? candidate.profileIdentity : '';
          var revision = credentialRevision(candidate.credentialRevision);
          var projected = externalEvidence(candidate);
          if (!identity || !revision || !schema.isEvidenceCurrent(projected, currentTime)) return;
          var operationKey = String(candidate.operation || '') + '\u0000' + String(candidate.requestMode || '');
          byIdentity[operationKey] = Object.assign({}, clone(projected), {
            credentialRevision: revision,
          });
        } catch {
          // Invalid evidence is stale by definition.
        }
      });
      var bounded = hostArray();
      Object.keys(byIdentity).forEach(function (entry) {
        bounded.push(byIdentity[entry]);
      });
      if (bounded.length) result[id] = bounded;
    });
    return result;
  }

  function normalizeProbeInput(value) {
    var keys = [
      'profileIdentity', 'operation', 'requestMode', 'policyRevision',
      'idempotencyKey', 'requestHash',
    ];
    if (!isRecord(value) || Object.keys(value).length !== keys.length
      || Object.keys(value).some(function (key) { return !keys.includes(key); })
      || typeof value.profileIdentity !== 'string'
      || !value.profileIdentity || value.profileIdentity.length > 500
      || !schema.OPERATIONS.includes(value.operation)
      || !schema.REQUEST_MODES.includes(value.requestMode)
      || typeof value.policyRevision !== 'string'
      || !value.policyRevision || value.policyRevision.length > 200
      || /[\u0000-\u001f\u007f]/u.test(value.policyRevision)
      || !profileId(value.idempotencyKey)
      || profileId(value.idempotencyKey) !== value.idempotencyKey
      || typeof value.requestHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.requestHash)) {
      throw storeError(
        'SS_ERP_BYOK_CAPABILITY_PROBE_INVALID',
        'Provider capability probe identity is invalid',
      );
    }
    return {
      profileIdentity: value.profileIdentity,
      operation: value.operation,
      requestMode: value.requestMode,
      policyRevision: value.policyRevision,
      idempotencyKey: value.idempotencyKey,
      requestHash: value.requestHash,
    };
  }

  function normalizeUncertainProbeMap(raw) {
    var result = Object.create(null);
    if (!isRecord(raw)) return result;
    Object.keys(raw).forEach(function (key) {
      var id = profileId(key);
      if (!id) return;
      var rows = Array.isArray(raw[key]) ? raw[key] : [];
      var byAuthority = Object.create(null);
      rows.forEach(function (candidate) {
        try {
          if (!isRecord(candidate)
            || candidate.contractVersion !== UNCERTAIN_PROBE_CONTRACT_VERSION
            || !['PENDING', 'UNKNOWN_OUTCOME'].includes(candidate.state)) return;
          var input = normalizeProbeInput({
            profileIdentity: candidate.profileIdentity,
            operation: candidate.operation,
            requestMode: candidate.requestMode,
            policyRevision: candidate.policyRevision,
            idempotencyKey: candidate.idempotencyKey,
            requestHash: candidate.requestHash,
          });
          var revision = credentialRevision(candidate.credentialRevision);
          if (!revision) return;
          var authorityKey = input.profileIdentity + '\u0001' + revision + '\u0001'
            + input.operation + '\u0001' + input.requestMode;
          var existing = byAuthority[authorityKey];
          if (!existing || candidate.state === 'UNKNOWN_OUTCOME') {
            byAuthority[authorityKey] = Object.assign({}, input, {
              contractVersion: UNCERTAIN_PROBE_CONTRACT_VERSION,
              credentialRevision: revision,
              state: candidate.state,
            });
          }
        } catch {
          // Corrupt guards cannot grant permission to retry a Provider POST.
        }
      });
      var normalized = Object.keys(byAuthority).map(function (authorityKey) {
        return byAuthority[authorityKey];
      }).slice(0, MAX_UNCERTAIN_PROBES_PER_PROFILE);
      if (normalized.length) result[id] = normalized;
    });
    return result;
  }

  function normalizeProviderDispatchInput(value) {
    var keys = ['profileIdentity', 'operation', 'requestMode', 'idempotencyKey', 'requestHash'];
    if (!isRecord(value) || Object.keys(value).length !== keys.length
      || Object.keys(value).some(function (key) { return !keys.includes(key); })
      || typeof value.profileIdentity !== 'string'
      || !value.profileIdentity || value.profileIdentity.length > 500
      || !schema.OPERATIONS.includes(value.operation)
      || !schema.REQUEST_MODES.includes(value.requestMode)
      || !profileId(value.idempotencyKey)
      || profileId(value.idempotencyKey) !== value.idempotencyKey
      || typeof value.requestHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.requestHash)) {
      throw storeError(
        'SS_ERP_BYOK_PROVIDER_DISPATCH_GUARD_INVALID',
        'Provider dispatch identity is invalid',
      );
    }
    return {
      profileIdentity: value.profileIdentity,
      operation: value.operation,
      requestMode: value.requestMode,
      idempotencyKey: value.idempotencyKey,
      requestHash: value.requestHash,
    };
  }

  function normalizeProviderDispatchMap(raw) {
    var result = Object.create(null);
    var corrupt = false;
    if (raw === undefined) return { values: result, corrupt: false };
    if (!isRecord(raw)) return { values: result, corrupt: true };
    if (!Object.keys(raw).length) return { values: result, corrupt: true };
    var total = 0;
    Object.keys(raw).forEach(function (key) {
      if (total >= MAX_PROVIDER_DISPATCHES) {
        corrupt = true;
        return;
      }
      var id = profileId(key);
      if (!id || !Array.isArray(raw[key]) || !raw[key].length) {
        corrupt = true;
        return;
      }
      var rows = hostArray();
      raw[key].forEach(function (candidate) {
        if (total >= MAX_PROVIDER_DISPATCHES) {
          corrupt = true;
          return;
        }
        try {
          if (!isRecord(candidate)
            || candidate.contractVersion !== PROVIDER_DISPATCH_CONTRACT_VERSION) {
            corrupt = true;
            return;
          }
          var input = normalizeProviderDispatchInput({
            profileIdentity: candidate.profileIdentity,
            operation: candidate.operation,
            requestMode: candidate.requestMode,
            idempotencyKey: candidate.idempotencyKey,
            requestHash: candidate.requestHash,
          });
          var revision = credentialRevision(candidate.credentialRevision);
          if (!revision) {
            corrupt = true;
            return;
          }
          if (rows.some(function (row) {
            return row.credentialRevision === revision
              && row.idempotencyKey === input.idempotencyKey;
          })) {
            corrupt = true;
            return;
          }
          rows.push(Object.assign({}, input, {
            contractVersion: PROVIDER_DISPATCH_CONTRACT_VERSION,
            credentialRevision: revision,
          }));
          total += 1;
        } catch {
          corrupt = true;
        }
      });
      if (rows.length) result[id] = rows;
      else corrupt = true;
    });
    return { values: result, corrupt: corrupt };
  }

  function findProfile(profiles, id) {
    var normalizedId = profileId(id);
    if (!normalizedId) return null;
    return profiles.find(function (candidate) { return candidate.id === normalizedId; }) || null;
  }

  function sameBinding(left, right) {
    return left && right
      && left.baseUrl === right.baseUrl
      && left.model === right.model;
  }

  function publicState(profile, hasKey, evidence) {
    var result = hostObject();
    result.profile = profile ? externalProfile(profile) : null;
    result.hasKey = Boolean(hasKey);
    result.evidence = hostArray();
    (evidence || []).forEach(function (item) {
      result.evidence.push(externalEvidence(item));
    });
    return result;
  }

  function matchingSecret(entry, identity) {
    return isRecord(entry)
      && entry.profileIdentity === identity
      && typeof entry.apiKey === 'string'
      && typeof entry.credentialRevision === 'string'
      && /^[a-f0-9]{64}$/u.test(entry.credentialRevision);
  }

  function credentialRevision(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value : '';
  }

  function unknownProbeError(replayed) {
    var error = storeError(
      'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
      'A Provider capability probe has an unknown outcome',
    );
    error.outcome = 'UNKNOWN_OUTCOME';
    error.automaticRetryAllowed = false;
    error.replayed = replayed === true;
    return error;
  }

  function unknownProviderDispatchError(replayed) {
    var error = storeError(
      'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
      'A Provider generation dispatch already exists in this browser session',
    );
    error.outcome = 'UNKNOWN_OUTCOME';
    error.automaticRetryAllowed = false;
    error.replayed = replayed === true;
    return error;
  }

  function providerDispatchConflictError() {
    var error = storeError(
      'SS_ERP_BYOK_PROVIDER_IDEMPOTENCY_CONFLICT',
      'The Provider idempotency key is bound to a different request',
    );
    error.outcome = 'FAILED_FINAL';
    error.automaticRetryAllowed = false;
    return error;
  }

  function providerDispatchLimitError() {
    var error = storeError(
      'SS_ERP_BYOK_PROVIDER_DISPATCH_LIMIT',
      'The browser session Provider dispatch limit has been reached',
    );
    error.outcome = 'FAILED_RETRYABLE';
    return error;
  }

  function sameProbeAuthority(row, input, revision) {
    return isRecord(row)
      && row.profileIdentity === input.profileIdentity
      && row.credentialRevision === revision
      && row.operation === input.operation
      && row.requestMode === input.requestMode;
  }

  function sameProbeRequest(row, input, revision) {
    return sameProbeAuthority(row, input, revision)
      && row.idempotencyKey === input.idempotencyKey
      && row.policyRevision === input.policyRevision
      && row.requestHash === input.requestHash;
  }

  function createStore(options) {
    var localStorage = options && options.localStorage;
    var sessionStorage = options && options.sessionStorage;
    var onCredentialAuthorityChanged = options && options.onCredentialAuthorityChanged;
    if (onCredentialAuthorityChanged !== undefined
      && typeof onCredentialAuthorityChanged !== 'function') {
      throw storeError(
        'SS_ERP_BYOK_CREDENTIAL_INVALIDATION_UNAVAILABLE',
        'Generated-result invalidation is unavailable',
      );
    }
    var now = options && typeof options.now === 'function' ? options.now : function () { return new Date(); };
    var randomValues = options && typeof options.randomValues === 'function'
      ? options.randomValues
      : function (bytes) {
          if (!global.crypto || typeof global.crypto.getRandomValues !== 'function') {
            throw storeError(
              'SS_ERP_BYOK_CREDENTIAL_REVISION_UNAVAILABLE',
              'Secure credential revision generation is unavailable',
            );
          }
          return global.crypto.getRandomValues(bytes);
        };
    assertStorage(localStorage, 'SS_ERP_BYOK_LOCAL_STORAGE_UNAVAILABLE');
    // Do not eagerly require session storage: metadata can still be read when Chrome
    // has not exposed the session area, but every secret/evidence operation fails closed.
    var writeQueue = Promise.resolve();
    var sessionGeneration = 0;

    function invalidateCredentialAuthority(reason, id) {
      if (typeof onCredentialAuthorityChanged !== 'function') return;
      try {
        var result = onCredentialAuthorityChanged({ reason: reason, profileId: id || null });
        if (result && typeof result.then === 'function') {
          throw new Error('credential invalidation must be synchronous');
        }
      } catch (_error) {
        throw storeError(
          'SS_ERP_BYOK_CREDENTIAL_INVALIDATION_UNAVAILABLE',
          'Generated results could not be invalidated',
        );
      }
    }

    function createCredentialRevision() {
      var bytes = new Uint8Array(32);
      randomValues(bytes);
      return Array.from(bytes).map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }

    function assertSessionGeneration(expected) {
      if (expected !== sessionGeneration) {
        throw storeError(
          'SS_ERP_BYOK_SESSION_INVALIDATED',
          'The BYOK browser session changed before the operation completed',
        );
      }
    }

    function enqueue(operation) {
      var next = writeQueue.then(operation, operation);
      writeQueue = next.catch(function () {});
      return next;
    }

    async function readProfiles() {
      var stored = await localStorage.get([schema.PROFILE_STORAGE_KEY]);
      return normalizeProfiles(stored && stored[schema.PROFILE_STORAGE_KEY]);
    }

    async function writeProfiles(profiles) {
      await localStorage.set({
        [schema.PROFILE_STORAGE_KEY]: profiles.map(function (profile) {
          return externalProfile(schema.publicProfile(profile));
        }),
      });
    }

    async function readSessionMaps() {
      var storage = assertSessionStorage(sessionStorage);
      var stored = await storage.get([
        schema.SESSION_SECRETS_STORAGE_KEY,
        schema.SESSION_EVIDENCE_STORAGE_KEY,
        schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY,
        schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY,
      ]);
      var currentTime = nowDate(now);
      var providerDispatchState = normalizeProviderDispatchMap(
        stored && stored[schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY],
      );
      return {
        storage: storage,
        secrets: normalizeSecretMap(stored && stored[schema.SESSION_SECRETS_STORAGE_KEY]),
        evidence: normalizeEvidenceMap(
          stored && stored[schema.SESSION_EVIDENCE_STORAGE_KEY],
          currentTime,
        ),
        uncertainProbes: normalizeUncertainProbeMap(
          stored && stored[schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY],
        ),
        providerDispatches: providerDispatchState.values,
        providerDispatchesCorrupt: providerDispatchState.corrupt,
        currentTime: currentTime,
      };
    }

    async function writeSessionMaps(maps, expectedGeneration) {
      assertSessionGeneration(expectedGeneration);
      if (maps.providerDispatchesCorrupt === true) {
        throw unknownProviderDispatchError(true);
      }
      var patch = {};
      if (maps.secrets && Object.keys(maps.secrets).length) {
        patch[schema.SESSION_SECRETS_STORAGE_KEY] = maps.secrets;
      } else {
        await maps.storage.remove([schema.SESSION_SECRETS_STORAGE_KEY]);
        assertSessionGeneration(expectedGeneration);
      }
      if (maps.evidence && Object.keys(maps.evidence).length) {
        patch[schema.SESSION_EVIDENCE_STORAGE_KEY] = maps.evidence;
      } else {
        await maps.storage.remove([schema.SESSION_EVIDENCE_STORAGE_KEY]);
        assertSessionGeneration(expectedGeneration);
      }
      if (maps.uncertainProbes && Object.keys(maps.uncertainProbes).length) {
        patch[schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY] = maps.uncertainProbes;
      } else {
        await maps.storage.remove([schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY]);
        assertSessionGeneration(expectedGeneration);
      }
      if (maps.providerDispatches && Object.keys(maps.providerDispatches).length) {
        patch[schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY] = maps.providerDispatches;
      } else {
        await maps.storage.remove([schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY]);
        assertSessionGeneration(expectedGeneration);
      }
      if (Object.keys(patch).length) {
        assertSessionGeneration(expectedGeneration);
        await maps.storage.set(patch);
        assertSessionGeneration(expectedGeneration);
      }
    }

    async function saveProfile(input) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var next = schema.publicProfile(input);
        var profiles = await readProfiles();
        var previous = findProfile(profiles, next.id);
        var changedBinding = Boolean(previous && !sameBinding(previous, next));
        var removedOperations = previous
          ? previous.allowedOperations.filter(function (operation) {
              return !next.allowedOperations.includes(operation);
            })
          : [];
        var replaced = false;
        var nextProfiles = profiles.map(function (candidate) {
          if (candidate.id !== next.id) return candidate;
          replaced = true;
          return next;
        });
        if (!replaced) nextProfiles.push(next);
        if (nextProfiles.length > schema.MAX_PROFILE_COUNT) {
          throw storeError('SS_ERP_BYOK_PROFILE_LIMIT', 'Too many Provider profiles');
        }
        if (changedBinding || removedOperations.length) {
          invalidateCredentialAuthority('profile_authority_changed', next.id);
          var maps = await readSessionMaps();
          if (changedBinding) {
            delete maps.secrets[next.id];
            delete maps.evidence[next.id];
            delete maps.uncertainProbes[next.id];
            delete maps.providerDispatches[next.id];
          } else {
            var remainingEvidence = (maps.evidence[next.id] || []).filter(function (candidate) {
              return !removedOperations.includes(candidate.operation);
            });
            if (remainingEvidence.length) maps.evidence[next.id] = remainingEvidence;
            else delete maps.evidence[next.id];
            var remainingDispatches = (maps.providerDispatches[next.id] || []).filter(function (candidate) {
              return !removedOperations.includes(candidate.operation);
            });
            if (remainingDispatches.length) maps.providerDispatches[next.id] = remainingDispatches;
            else delete maps.providerDispatches[next.id];
          }
          await writeSessionMaps(maps, expectedGeneration);
        }
        // Clear session-bound authority before committing the new binding. If the
        // metadata write then fails, the old profile merely requires key re-entry;
        // a stale key can never survive under a new endpoint/model identity.
        await writeProfiles(nextProfiles);
        var result = hostObject();
        result.profile = externalProfile(next);
        result.rebound = changedBinding;
        return result;
      });
    }

    async function getProfile(id) {
      return findProfile(await readProfiles(), id);
    }

    async function listPublicProfiles() {
      var result = hostArray();
      (await readProfiles()).forEach(function (profile) { result.push(externalProfile(profile)); });
      return result;
    }

    async function getPublicState(id) {
      var profile = await getProfile(id);
      if (!profile) return publicState(null, false, []);
      // A missing session area is represented as an empty redacted state.  No key
      // operation is silently redirected to local/sync storage.
      if (!sessionStorage) return publicState(profile, false, []);
      var maps;
      try {
        maps = await readSessionMaps();
      } catch (error) {
        if (error && error.code === 'SS_ERP_BYOK_SESSION_STORAGE_UNAVAILABLE') {
          return publicState(profile, false, []);
        }
        throw error;
      }
      var identity = schema.profileIdentity(profile);
      var secret = maps.secrets[profile.id];
      var hasKey = matchingSecret(secret, identity);
      var evidence = (maps.evidence[profile.id] || []).filter(function (candidate) {
        if (!hasKey || candidate.credentialRevision !== secret.credentialRevision) return false;
        try {
          var normalized = schema.normalizeEvidence(
            externalEvidence(candidate),
            identity,
            maps.currentTime,
          );
          return profile.allowedOperations.includes(normalized.operation);
        } catch {
          return false;
        }
      }).map(function (candidate) {
        return externalEvidence(schema.normalizeEvidence(
          externalEvidence(candidate),
          identity,
          maps.currentTime,
        ));
      });
      return publicState(profile, hasKey, hasKey ? evidence : []);
    }

    async function setApiKey(id, value) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        // Check the secret boundary before any metadata lookup.  A missing session
        // area must never be disguised as a profile/validation error.
        var session = assertSessionStorage(sessionStorage);
        var profile = normalizedId ? await getProfile(normalizedId) : null;
        if (!profile) {
          throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND', 'Provider profile is not found');
        }
        var key = normalizeApiKey(value);
        invalidateCredentialAuthority('session_key_set', normalizedId);
        var maps = await readSessionMaps();
        maps.storage = session;
        var identity = schema.profileIdentity(profile);
        maps.secrets[normalizedId] = {
          profileIdentity: identity,
          apiKey: key,
          credentialRevision: createCredentialRevision(),
        };
        // Every key load establishes a fresh credential authority, even if the
        // opaque bytes happen to be equal to the previous value.
        delete maps.evidence[normalizedId];
        delete maps.uncertainProbes[normalizedId];
        delete maps.providerDispatches[normalizedId];
        await writeSessionMaps(maps, expectedGeneration);
        var result = hostObject();
        result.profileId = normalizedId;
        result.hasKey = true;
        return result;
      });
    }

    async function readSecretForBackground(id) {
      var snapshot = await getCredentialSnapshotForBackground(id);
      return snapshot ? snapshot.apiKey : null;
    }

    async function getCredentialSnapshotForBackground(id) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        if (!normalizedId) return null;
        var profile = await getProfile(normalizedId);
        if (!profile) return null;
        var maps = await readSessionMaps();
        var identity = schema.profileIdentity(profile);
        var secret = maps.secrets[normalizedId];
        var evidence = hostArray();
        var hasSecret = matchingSecret(secret, identity);
        if (hasSecret) {
          (maps.evidence[normalizedId] || []).forEach(function (candidate) {
            if (candidate.credentialRevision !== secret.credentialRevision) return;
            try {
              var normalized = schema.normalizeEvidence(
                externalEvidence(candidate),
                identity,
                maps.currentTime,
              );
              if (profile.allowedOperations.includes(normalized.operation)) {
                evidence.push(externalEvidence(normalized));
              }
            } catch {
              // Evidence from another profile/key authority is not current.
            }
          });
        }
        assertSessionGeneration(expectedGeneration);
        var result = hostObject();
        result.profile = externalProfile(profile);
        result.apiKey = hasSecret ? secret.apiKey : null;
        result.credentialRevision = hasSecret ? secret.credentialRevision : null;
        result.evidence = evidence;
        return result;
      });
    }

    async function assertCredentialRevisionForBackground(
      id,
      expectedProfileIdentity,
      expectedCredentialRevision,
    ) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        if (!normalizedId || typeof expectedProfileIdentity !== 'string' || !expectedRevision) {
          throw storeError('SS_ERP_BYOK_CREDENTIAL_AUTHORITY_STALE');
        }
        var profile = await getProfile(normalizedId);
        var maps = await readSessionMaps();
        var identity = profile && schema.profileIdentity(profile);
        var secret = maps.secrets[normalizedId];
        assertSessionGeneration(expectedGeneration);
        if (!profile || identity !== expectedProfileIdentity
          || !matchingSecret(secret, identity)
          || secret.credentialRevision !== expectedRevision) {
          throw storeError(
            'SS_ERP_BYOK_CREDENTIAL_AUTHORITY_STALE',
            'Provider credential changed before the result was accepted',
          );
        }
        var result = hostObject();
        result.current = true;
        return result;
      });
    }

    async function commitWithCredentialRevisionForBackground(
      id,
      expectedProfileIdentity,
      expectedCredentialRevision,
      commit,
    ) {
      if (typeof commit !== 'function') {
        throw storeError('SS_ERP_BYOK_CREDENTIAL_AUTHORITY_STALE');
      }
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        var profile = normalizedId ? await getProfile(normalizedId) : null;
        var maps = await readSessionMaps();
        var identity = profile && schema.profileIdentity(profile);
        var secret = maps.secrets[normalizedId];
        assertSessionGeneration(expectedGeneration);
        if (!profile || identity !== expectedProfileIdentity
          || !matchingSecret(secret, identity)
          || secret.credentialRevision !== expectedRevision) {
          throw storeError(
            'SS_ERP_BYOK_CREDENTIAL_AUTHORITY_STALE',
            'Provider credential changed before the result was committed',
          );
        }
        return commit();
      });
    }

    async function beginProviderDispatch(id, inputValue, expectedCredentialRevision) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var input = normalizeProviderDispatchInput(inputValue);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        if (!normalizedId || !expectedRevision) {
          throw storeError('SS_ERP_BYOK_PROVIDER_DISPATCH_GUARD_INVALID');
        }
        var profile = await getProfile(normalizedId);
        if (!profile) throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND');
        var maps = await readSessionMaps();
        if (maps.providerDispatchesCorrupt) throw unknownProviderDispatchError(true);
        var identity = schema.profileIdentity(profile);
        var secret = maps.secrets[normalizedId];
        if (input.profileIdentity !== identity
          || !matchingSecret(secret, identity)
          || secret.credentialRevision !== expectedRevision
          || !profile.allowedOperations.includes(input.operation)) {
          throw storeError(
            'SS_ERP_BYOK_PROVIDER_DISPATCH_GUARD_INVALID',
            'Provider dispatch credential context is stale',
          );
        }
        var rows = maps.providerDispatches[normalizedId] || [];
        var existing = rows.find(function (candidate) {
          return candidate.profileIdentity === identity
            && candidate.credentialRevision === expectedRevision
            && candidate.idempotencyKey === input.idempotencyKey;
        });
        if (existing) {
          if (existing.operation !== input.operation
            || existing.requestMode !== input.requestMode
            || existing.requestHash !== input.requestHash) {
            throw providerDispatchConflictError();
          }
          throw unknownProviderDispatchError(true);
        }
        var total = Object.keys(maps.providerDispatches).reduce(function (count, profileKey) {
          return count + (maps.providerDispatches[profileKey] || []).length;
        }, 0);
        if (total >= MAX_PROVIDER_DISPATCHES) throw providerDispatchLimitError();
        rows.push(Object.assign({}, input, {
          contractVersion: PROVIDER_DISPATCH_CONTRACT_VERSION,
          credentialRevision: expectedRevision,
        }));
        maps.providerDispatches[normalizedId] = rows;
        await writeSessionMaps(maps, expectedGeneration);
        var result = hostObject();
        result.started = true;
        return result;
      });
    }

    function requireCurrentProbeContext(profile, maps, normalizedId, input, expectedRevision) {
      var identity = schema.profileIdentity(profile);
      var secret = maps.secrets[normalizedId];
      if (input.profileIdentity !== identity
        || !matchingSecret(secret, identity)
        || secret.credentialRevision !== expectedRevision
        || !profile.allowedOperations.includes(input.operation)) {
        throw storeError(
          'SS_ERP_BYOK_CAPABILITY_PROBE_INVALID',
          'Provider capability probe credential context is stale',
        );
      }
    }

    async function beginCapabilityProbe(id, inputValue, expectedCredentialRevision) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var input = normalizeProbeInput(inputValue);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        if (!normalizedId || !expectedRevision) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_PROBE_INVALID');
        }
        var profile = await getProfile(normalizedId);
        if (!profile) throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND');
        var maps = await readSessionMaps();
        requireCurrentProbeContext(profile, maps, normalizedId, input, expectedRevision);
        var rows = maps.uncertainProbes[normalizedId] || [];
        if (rows.some(function (candidate) {
          return sameProbeAuthority(candidate, input, expectedRevision);
        })) {
          throw unknownProbeError(true);
        }
        var currentEvidence = (maps.evidence[normalizedId] || []).find(function (candidate) {
          return candidate.credentialRevision === expectedRevision
            && candidate.operation === input.operation
            && candidate.requestMode === input.requestMode
            && candidate.policyRevision === input.policyRevision;
        });
        if (currentEvidence) {
          try {
            var replayedEvidence = schema.normalizeEvidence(
              externalEvidence(currentEvidence),
              input.profileIdentity,
              maps.currentTime,
            );
            var replay = hostObject();
            replay.started = false;
            replay.replayed = true;
            replay.evidence = externalEvidence(replayedEvidence);
            return replay;
          } catch {
            // Invalid or expired evidence does not authorize skipping a probe.
          }
        }
        rows.push(Object.assign({}, input, {
          contractVersion: UNCERTAIN_PROBE_CONTRACT_VERSION,
          credentialRevision: expectedRevision,
          state: 'PENDING',
        }));
        maps.uncertainProbes[normalizedId] = rows.slice(-MAX_UNCERTAIN_PROBES_PER_PROFILE);
        await writeSessionMaps(maps, expectedGeneration);
        var result = hostObject();
        result.started = true;
        return result;
      });
    }

    async function markCapabilityProbeUncertain(id, inputValue, expectedCredentialRevision) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var input = normalizeProbeInput(inputValue);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        if (!normalizedId || !expectedRevision) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_PROBE_INVALID');
        }
        var profile = await getProfile(normalizedId);
        if (!profile) throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND');
        var maps = await readSessionMaps();
        requireCurrentProbeContext(profile, maps, normalizedId, input, expectedRevision);
        var found = false;
        var rows = (maps.uncertainProbes[normalizedId] || []).map(function (candidate) {
          if (!sameProbeRequest(candidate, input, expectedRevision)) return candidate;
          found = true;
          return Object.assign({}, candidate, { state: 'UNKNOWN_OUTCOME' });
        });
        if (!found) throw storeError('SS_ERP_BYOK_CAPABILITY_PROBE_INVALID');
        maps.uncertainProbes[normalizedId] = rows;
        await writeSessionMaps(maps, expectedGeneration);
        var result = hostObject();
        result.recorded = true;
        return result;
      });
    }

    async function discardPendingCapabilityProbe(id, inputValue, expectedCredentialRevision) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var input = normalizeProbeInput(inputValue);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        if (!normalizedId || !expectedRevision) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_PROBE_INVALID');
        }
        var profile = await getProfile(normalizedId);
        if (!profile) throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND');
        var maps = await readSessionMaps();
        requireCurrentProbeContext(profile, maps, normalizedId, input, expectedRevision);
        var rows = maps.uncertainProbes[normalizedId] || [];
        var matched = rows.find(function (candidate) {
          return sameProbeRequest(candidate, input, expectedRevision);
        });
        if (matched && matched.state === 'UNKNOWN_OUTCOME') throw unknownProbeError(true);
        var remaining = rows.filter(function (candidate) {
          return !sameProbeRequest(candidate, input, expectedRevision);
        });
        if (remaining.length) maps.uncertainProbes[normalizedId] = remaining;
        else delete maps.uncertainProbes[normalizedId];
        await writeSessionMaps(maps, expectedGeneration);
        var result = hostObject();
        result.cleared = Boolean(matched);
        return result;
      });
    }

    async function setCapabilityEvidence(
      id,
      input,
      expectedCredentialRevision,
      completedProbeValue,
    ) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        var expectedRevision = credentialRevision(expectedCredentialRevision);
        if (!expectedRevision) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'Provider credential revision is missing');
        }
        assertSessionStorage(sessionStorage);
        var profile = await getProfile(normalizedId);
        if (!profile) throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND', 'Provider profile is not found');
        var maps = await readSessionMaps();
        var identity = schema.profileIdentity(profile);
        var secret = maps.secrets[normalizedId];
        if (!matchingSecret(secret, identity)
          || secret.credentialRevision !== expectedRevision) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'Provider credential context is missing');
        }
        var evidence = schema.normalizeEvidence(input, identity, maps.currentTime);
        if (!profile.allowedOperations.includes(evidence.operation)) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'Provider operation is not allowed');
        }
        var rows = (maps.evidence[normalizedId] || []).filter(function (candidate) {
          return candidate.operation !== evidence.operation || candidate.requestMode !== evidence.requestMode;
        });
        rows.push(Object.assign({}, evidence, { credentialRevision: expectedRevision }));
        maps.evidence[normalizedId] = rows;
        if (completedProbeValue !== undefined) {
          var completedProbe = normalizeProbeInput(completedProbeValue);
          if (completedProbe.profileIdentity !== identity
            || completedProbe.operation !== evidence.operation
            || completedProbe.requestMode !== evidence.requestMode
            || completedProbe.policyRevision !== evidence.policyRevision) {
            throw storeError('SS_ERP_BYOK_CAPABILITY_PROBE_INVALID');
          }
          var probeRows = maps.uncertainProbes[normalizedId] || [];
          var pending = probeRows.find(function (candidate) {
            return sameProbeRequest(candidate, completedProbe, expectedRevision);
          });
          if (!pending || pending.state !== 'PENDING') {
            if (pending && pending.state === 'UNKNOWN_OUTCOME') throw unknownProbeError(true);
            throw storeError('SS_ERP_BYOK_CAPABILITY_PROBE_INVALID');
          }
          var remainingProbes = probeRows.filter(function (candidate) {
            return !sameProbeRequest(candidate, completedProbe, expectedRevision);
          });
          if (remainingProbes.length) maps.uncertainProbes[normalizedId] = remainingProbes;
          else delete maps.uncertainProbes[normalizedId];
        }
        await writeSessionMaps(maps, expectedGeneration);
        return externalEvidence(evidence);
      });
    }

    async function clearSession() {
      sessionGeneration += 1;
      return enqueue(async function () {
        invalidateCredentialAuthority('session_cleared', null);
        var storage = assertSessionStorage(sessionStorage);
        await storage.remove([
          schema.SESSION_SECRETS_STORAGE_KEY,
          schema.SESSION_EVIDENCE_STORAGE_KEY,
          schema.SESSION_UNCERTAIN_PROBES_STORAGE_KEY,
          schema.SESSION_PROVIDER_DISPATCHES_STORAGE_KEY,
        ]);
        var result = hostObject();
        result.cleared = true;
        return result;
      });
    }

    async function clearApiKey(id) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        assertSessionStorage(sessionStorage);
        var profile = normalizedId ? await getProfile(normalizedId) : null;
        if (!profile) {
          throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND', 'Provider profile is not found');
        }
        invalidateCredentialAuthority('session_key_cleared', normalizedId);
        var maps = await readSessionMaps();
        var cleared = Boolean(
          maps.secrets[normalizedId]
          || maps.evidence[normalizedId]
          || maps.uncertainProbes[normalizedId]
          || maps.providerDispatches[normalizedId],
        );
        delete maps.secrets[normalizedId];
        delete maps.evidence[normalizedId];
        delete maps.uncertainProbes[normalizedId];
        delete maps.providerDispatches[normalizedId];
        await writeSessionMaps(maps, expectedGeneration);
        var result = hostObject();
        result.profileId = normalizedId;
        result.hasKey = false;
        result.cleared = cleared;
        return result;
      });
    }

    async function disconnectDevice() {
      return clearSession();
    }

    async function deleteProfile(id) {
      var expectedGeneration = sessionGeneration;
      return enqueue(async function () {
        var normalizedId = profileId(id);
        if (!normalizedId) {
          var invalidResult = hostObject();
          invalidResult.deleted = false;
          return invalidResult;
        }
        var profiles = await readProfiles();
        var next = profiles.filter(function (candidate) { return candidate.id !== normalizedId; });
        if (next.length !== profiles.length) {
          invalidateCredentialAuthority('profile_deleted', normalizedId);
        }
        var maps = await readSessionMaps();
        delete maps.secrets[normalizedId];
        delete maps.evidence[normalizedId];
        delete maps.uncertainProbes[normalizedId];
        delete maps.providerDispatches[normalizedId];
        await writeSessionMaps(maps, expectedGeneration);
        if (next.length !== profiles.length) await writeProfiles(next);
        var result = hostObject();
        result.deleted = next.length !== profiles.length;
        return result;
      });
    }

    async function clearProfile(id) {
      return deleteProfile(id);
    }

    return {
      saveProfile: saveProfile,
      getProfile: getProfile,
      listPublicProfiles: listPublicProfiles,
      listProfiles: listPublicProfiles,
      getPublicState: getPublicState,
      setApiKey: setApiKey,
      readSecretForBackground: readSecretForBackground,
      getCredentialSnapshotForBackground: getCredentialSnapshotForBackground,
      assertCredentialRevisionForBackground: assertCredentialRevisionForBackground,
      commitWithCredentialRevisionForBackground: commitWithCredentialRevisionForBackground,
      beginProviderDispatch: beginProviderDispatch,
      beginCapabilityProbe: beginCapabilityProbe,
      markCapabilityProbeUncertain: markCapabilityProbeUncertain,
      discardPendingCapabilityProbe: discardPendingCapabilityProbe,
      setCapabilityEvidence: setCapabilityEvidence,
      clearApiKey: clearApiKey,
      clearSession: clearSession,
      disconnectDevice: disconnectDevice,
      deleteProfile: deleteProfile,
      clearProfile: clearProfile,
    };
  }

  global.SS_ERP_BYOK_PROFILE_STORE = {
    createStore: createStore,
    normalizeApiKey: normalizeApiKey,
  };
}(typeof globalThis !== 'undefined' ? globalThis : self));
