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
          || entry.profileIdentity.length > 500) return;
        result[id] = {
          profileIdentity: entry.profileIdentity,
          apiKey: normalizeApiKey(entry.apiKey),
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
          if (!identity || !schema.isEvidenceCurrent(candidate, currentTime)) return;
          var operationKey = String(candidate.operation || '') + '\u0000' + String(candidate.requestMode || '');
          byIdentity[operationKey] = clone(candidate);
        } catch {
          // Invalid evidence is stale by definition.
        }
      });
      var bounded = hostArray();
      Object.keys(byIdentity).forEach(function (entry) {
        bounded.push(externalEvidence(byIdentity[entry]));
      });
      if (bounded.length) result[id] = bounded;
    });
    return result;
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
      && typeof entry.apiKey === 'string';
  }

  function createStore(options) {
    var localStorage = options && options.localStorage;
    var sessionStorage = options && options.sessionStorage;
    var now = options && typeof options.now === 'function' ? options.now : function () { return new Date(); };
    assertStorage(localStorage, 'SS_ERP_BYOK_LOCAL_STORAGE_UNAVAILABLE');
    // Do not eagerly require session storage: metadata can still be read when Chrome
    // has not exposed the session area, but every secret/evidence operation fails closed.
    var writeQueue = Promise.resolve();

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
      ]);
      var currentTime = nowDate(now);
      return {
        storage: storage,
        secrets: normalizeSecretMap(stored && stored[schema.SESSION_SECRETS_STORAGE_KEY]),
        evidence: normalizeEvidenceMap(
          stored && stored[schema.SESSION_EVIDENCE_STORAGE_KEY],
          currentTime,
        ),
        currentTime: currentTime,
      };
    }

    async function writeSessionMaps(maps) {
      var patch = {};
      if (maps.secrets && Object.keys(maps.secrets).length) {
        patch[schema.SESSION_SECRETS_STORAGE_KEY] = maps.secrets;
      } else {
        await maps.storage.remove([schema.SESSION_SECRETS_STORAGE_KEY]);
      }
      if (maps.evidence && Object.keys(maps.evidence).length) {
        patch[schema.SESSION_EVIDENCE_STORAGE_KEY] = maps.evidence;
      } else {
        await maps.storage.remove([schema.SESSION_EVIDENCE_STORAGE_KEY]);
      }
      if (Object.keys(patch).length) await maps.storage.set(patch);
    }

    async function saveProfile(input) {
      return enqueue(async function () {
        var next = schema.publicProfile(input);
        var profiles = await readProfiles();
        var previous = findProfile(profiles, next.id);
        var changedBinding = Boolean(previous && !sameBinding(previous, next));
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
        if (changedBinding) {
          var maps = await readSessionMaps();
          delete maps.secrets[next.id];
          delete maps.evidence[next.id];
          await writeSessionMaps(maps);
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
      var hasKey = matchingSecret(maps.secrets[profile.id], identity);
      var evidence = (maps.evidence[profile.id] || []).filter(function (candidate) {
        try {
          return schema.normalizeEvidence(candidate, identity, maps.currentTime);
        } catch {
          return false;
        }
      }).map(function (candidate) {
        return externalEvidence(schema.normalizeEvidence(candidate, identity, maps.currentTime));
      });
      return publicState(profile, hasKey, hasKey ? evidence : []);
    }

    async function setApiKey(id, value) {
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
        var maps = await readSessionMaps();
        maps.storage = session;
        var identity = schema.profileIdentity(profile);
        var previous = maps.secrets[normalizedId];
        maps.secrets[normalizedId] = {
          profileIdentity: identity,
          apiKey: key,
        };
        // A capability probe is evidence for a particular credential context.  A
        // changed key must be probed again even when endpoint/model stay the same.
        if (!matchingSecret(previous, identity) || previous.apiKey !== key) {
          delete maps.evidence[normalizedId];
        }
        await writeSessionMaps(maps);
        var result = hostObject();
        result.profileId = normalizedId;
        result.hasKey = true;
        return result;
      });
    }

    async function readSecretForBackground(id) {
      var normalizedId = profileId(id);
      if (!normalizedId) return null;
      var profile = await getProfile(normalizedId);
      if (!profile) return null;
      var maps = await readSessionMaps();
      var identity = schema.profileIdentity(profile);
      var entry = maps.secrets[normalizedId];
      return matchingSecret(entry, identity) ? entry.apiKey : null;
    }

    async function setCapabilityEvidence(id, input) {
      return enqueue(async function () {
        var normalizedId = profileId(id);
        assertSessionStorage(sessionStorage);
        var profile = await getProfile(normalizedId);
        if (!profile) throw storeError('SS_ERP_BYOK_PROFILE_NOT_FOUND', 'Provider profile is not found');
        var maps = await readSessionMaps();
        var identity = schema.profileIdentity(profile);
        if (!matchingSecret(maps.secrets[normalizedId], identity)) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'Provider credential context is missing');
        }
        var evidence = schema.normalizeEvidence(input, identity, maps.currentTime);
        if (!profile.allowedOperations.includes(evidence.operation)) {
          throw storeError('SS_ERP_BYOK_CAPABILITY_EVIDENCE_INVALID', 'Provider operation is not allowed');
        }
        var rows = (maps.evidence[normalizedId] || []).filter(function (candidate) {
          return candidate.operation !== evidence.operation || candidate.requestMode !== evidence.requestMode;
        });
        rows.push(evidence);
        maps.evidence[normalizedId] = rows;
        await writeSessionMaps(maps);
        return externalEvidence(evidence);
      });
    }

    async function clearSession() {
      return enqueue(async function () {
        var storage = assertSessionStorage(sessionStorage);
        await storage.remove([
          schema.SESSION_SECRETS_STORAGE_KEY,
          schema.SESSION_EVIDENCE_STORAGE_KEY,
        ]);
        var result = hostObject();
        result.cleared = true;
        return result;
      });
    }

    async function disconnectDevice() {
      return clearSession();
    }

    async function deleteProfile(id) {
      return enqueue(async function () {
        var normalizedId = profileId(id);
        if (!normalizedId) {
          var invalidResult = hostObject();
          invalidResult.deleted = false;
          return invalidResult;
        }
        var profiles = await readProfiles();
        var next = profiles.filter(function (candidate) { return candidate.id !== normalizedId; });
        var maps = await readSessionMaps();
        delete maps.secrets[normalizedId];
        delete maps.evidence[normalizedId];
        await writeSessionMaps(maps);
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
      setCapabilityEvidence: setCapabilityEvidence,
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
