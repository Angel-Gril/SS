(function (global) {
  'use strict';

  var PREFIX = 'ozon-logistics:distribution:v1';
  var NAMESPACE_FIELDS = [
    'deploymentId',
    'tenantSubject',
    'shopId',
    'ozonCompanyId',
    'warehouseId',
    'originCountryUid',
    'originCityUid',
    'destinationCountryUid',
    'destinationLocationUid',
    'assignmentId',
    'schemaMajor',
  ];
  var CHECKSUM_RE = /^[a-f0-9]{64}$/i;
  var MAX_PENDING_RECEIPTS = 50;

  function requiredText(value, label) {
    var normalized = String(value == null ? '' : value).trim();
    if (!normalized) throw new TypeError(label + ' is required');
    return normalized;
  }

  function validDate(value, label) {
    var normalized = requiredText(value, label);
    if (!Number.isFinite(Date.parse(normalized))) throw new TypeError(label + ' must be an ISO date');
    return normalized;
  }

  function namespaceKey(namespace) {
    if (!namespace || typeof namespace !== 'object') {
      throw new TypeError('namespace is required');
    }
    return NAMESPACE_FIELDS.map(function (field) {
      var value = requiredText(namespace[field], 'namespace.' + field);
      var encoded = encodeURIComponent(value);
      return encoded.length + ':' + encoded;
    }).join('|');
  }

  function pointerKey(namespace) {
    return PREFIX + ':' + namespaceKey(namespace) + ':pointer';
  }

  function blobKey(namespace, checksum) {
    return PREFIX + ':' + namespaceKey(namespace) + ':blob:' + checksum.toLowerCase();
  }

  function validationError(result) {
    var errors = result && Array.isArray(result.errors) ? result.errors : [];
    return errors.length ? errors.map(String).join('; ') : 'bundle validation failed';
  }

  function pendingReceiptsFor(pointer) {
    var pendingReceipts = pointer && Array.isArray(pointer.pendingReceipts)
      ? pointer.pendingReceipts.map(function (receipt) { return Object.assign({}, receipt); })
      : [];
    if (pendingReceipts.length === 0 && pointer && pointer.pendingReceipt) {
      pendingReceipts.push(Object.assign({}, pointer.pendingReceipt));
    }
    return pendingReceipts;
  }

  function createStore(options) {
    var storage = options && options.storage;
    var validateBundle = options && options.validateBundle;
    var now = options && options.now ? options.now : function () { return new Date(); };
    var mutationTails = new Map();
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new TypeError('storage adapter is required');
    }
    if (typeof validateBundle !== 'function') {
      throw new TypeError('validateBundle is required');
    }

    async function validate(value) {
      var result = await validateBundle(value);
      if (!result || result.valid !== true) throw new TypeError(validationError(result));
      return Object.prototype.hasOwnProperty.call(result, 'bundle') ? result.bundle : value;
    }

    function currentVersionContext(input) {
      if (input && typeof input === 'object'
        && Object.prototype.hasOwnProperty.call(input, 'currentExtensionVersion')) {
        return { enabled: true, value: input.currentExtensionVersion };
      }
      if (options && Object.prototype.hasOwnProperty.call(options, 'currentExtensionVersion')) {
        return { enabled: true, value: options.currentExtensionVersion };
      }
      return { enabled: false, value: null };
    }

    function incompatibleVersionResult(bundle, input, metadata) {
      var current = currentVersionContext(input);
      if (!current.enabled) return null;
      var policy = global.SS_ERP_LOGISTICS_VERSION_POLICY;
      var minimum = String(bundle && bundle.minExtensionVersion != null
        ? bundle.minExtensionVersion : '').trim();
      var currentText = String(current.value == null ? '' : current.value).trim();
      var evaluation = policy && typeof policy.evaluateCompatibility === 'function'
        ? policy.evaluateCompatibility(current.value, minimum)
        : {
          compatible: false,
          reason: 'version_policy_unavailable',
          currentExtensionVersion: currentText,
          minExtensionVersion: minimum,
        };
      if (evaluation && evaluation.compatible === true) return null;
      return Object.assign({
        state: 'upgrade_required',
        quoteAllowed: false,
        bundle: bundle,
        minExtensionVersion: minimum || null,
        currentExtensionVersion: currentText || null,
        versionReason: evaluation && evaluation.reason || 'version_policy_unavailable',
      }, metadata);
    }

    async function readPointer(namespace) {
      var key = pointerKey(namespace);
      var result = await storage.get([key]);
      return result && result[key] ? result[key] : null;
    }

    async function runNamespaceMutation(namespace, mutate) {
      var queueKey = namespaceKey(namespace);
      var previous = mutationTails.get(queueKey) || Promise.resolve();
      var mutation = previous.catch(function () {}).then(mutate);
      mutationTails.set(queueKey, mutation);
      try {
        return await mutation;
      } finally {
        if (mutationTails.get(queueKey) === mutation) mutationTails.delete(queueKey);
      }
    }

    function isQuotaError(error) {
      var name = String(error && error.name || '').toLowerCase();
      var message = String(error && error.message || '').toLowerCase();
      return name.indexOf('quota') >= 0 || message.indexOf('quota') >= 0;
    }

    async function garbageCollect(namespace, options) {
      if (typeof storage.remove !== 'function') return { removed: 0, keys: [] };
      var pointer = await readPointer(namespace);
      var keep = new Set();
      if (pointer && CHECKSUM_RE.test(pointer.activeChecksum || '')) {
        keep.add(String(pointer.activeChecksum).toLowerCase());
      }
      if (pointer && CHECKSUM_RE.test(pointer.previousChecksum || '')) {
        keep.add(String(pointer.previousChecksum).toLowerCase());
      }
      var extra = options && Array.isArray(options.keepChecksums)
        ? options.keepChecksums
        : [];
      extra.forEach(function (checksum) {
        if (CHECKSUM_RE.test(checksum || '')) keep.add(String(checksum).toLowerCase());
      });
      var all = await storage.get(null);
      var prefix = PREFIX + ':' + namespaceKey(namespace) + ':blob:';
      var removable = Object.keys(all || {}).filter(function (key) {
        if (key.indexOf(prefix) !== 0) return false;
        var checksum = key.slice(prefix.length).toLowerCase();
        return CHECKSUM_RE.test(checksum) && !keep.has(checksum);
      });
      if (removable.length > 0) await storage.remove(removable);
      return { removed: removable.length, keys: removable };
    }

    async function writeBlobWithQuotaRecovery(namespace, key, candidate) {
      var write = {};
      write[key] = candidate;
      try {
        await storage.set(write);
      } catch (error) {
        if (!isQuotaError(error) || typeof storage.remove !== 'function') throw error;
        await garbageCollect(namespace);
        await storage.set(write);
      }
    }

    async function stageAndActivateNow(input) {
      if (!input || typeof input !== 'object') throw new TypeError('activation input is required');
      var candidate = await validate(input.bundle);
      var releaseId = requiredText(candidate && candidate.releaseId, 'bundle.releaseId');
      var releaseSequence = Number(candidate && candidate.releaseSequence);
      var contentChecksum = requiredText(
        candidate && candidate.contentChecksum,
        'bundle.contentChecksum',
      ).toLowerCase();
      var effectiveChecksum = requiredText(
        candidate && candidate.effectiveChecksum,
        'bundle.effectiveChecksum',
      ).toLowerCase();
      if (!Number.isSafeInteger(releaseSequence) || releaseSequence < 1) {
        throw new TypeError('bundle.releaseSequence must be a positive safe integer');
      }
      if (!CHECKSUM_RE.test(contentChecksum) || !CHECKSUM_RE.test(effectiveChecksum)) {
        throw new TypeError('bundle checksums must be SHA-256 hex');
      }

      var etag = requiredText(input.etag, 'etag');
      var serverTime = validDate(input.serverTime, 'serverTime');
      var authorizationValidUntil = validDate(
        input.authorizationValidUntil,
        'authorizationValidUntil',
      );
      if (Date.parse(authorizationValidUntil) <= Date.parse(serverTime)) {
        throw new TypeError('authorizationValidUntil must be later than serverTime');
      }
      var receiptIdempotencyKey = requiredText(
        input.receiptIdempotencyKey,
        'receiptIdempotencyKey',
      );
      if (receiptIdempotencyKey.length < 16 || receiptIdempotencyKey.length > 200) {
        throw new TypeError('receiptIdempotencyKey length is invalid');
      }

      var existing = await readPointer(input.namespace);
      if (existing && Number.isSafeInteger(existing.releaseSequence)) {
        if (releaseSequence < existing.releaseSequence) {
          throw new Error('release sequence rollback rejected');
        }
        if (releaseSequence === existing.releaseSequence) {
          var sameRelease = String(existing.releaseId || '') === releaseId
            && String(existing.contentChecksum || '').toLowerCase() === contentChecksum
            && String(existing.effectiveChecksum || '').toLowerCase() === effectiveChecksum;
          if (!sameRelease) throw new Error('release sequence conflict');
          var activeBundle = await readBundleByChecksum(input.namespace, effectiveChecksum);
          if (!activeBundle) {
            var repairKey = blobKey(input.namespace, effectiveChecksum);
            await writeBlobWithQuotaRecovery(input.namespace, repairKey, candidate);
            var repaired = await storage.get([repairKey]);
            if (!repaired || !repaired[repairKey]) {
              throw new Error('staged bundle read-back failed');
            }
            var verifiedRepair = await validate(repaired[repairKey]);
            if (
              !verifiedRepair ||
              String(verifiedRepair.effectiveChecksum || '').toLowerCase() !== effectiveChecksum
            ) {
              throw new Error('stored bundle checksum mismatch');
            }
          }
          var renewed = Object.assign({}, existing, {
            state: 'active',
            etag: etag,
            serverTime: serverTime,
            authorizationValidUntil: authorizationValidUntil,
          });
          delete renewed.revocation;
          var renewedPointerKey = pointerKey(input.namespace);
          await storage.set((function () {
            var value = {};
            value[renewedPointerKey] = renewed;
            return value;
          })());
          return renewed;
        }
      }
      var pendingReceipts = pendingReceiptsFor(existing);
      if (pendingReceipts.length >= MAX_PENDING_RECEIPTS) {
        throw new Error('receipt outbox is full');
      }
      var contentKey = blobKey(input.namespace, effectiveChecksum);
      await writeBlobWithQuotaRecovery(input.namespace, contentKey, candidate);

      var stored = await storage.get([contentKey]);
      if (!stored || !stored[contentKey]) throw new Error('staged bundle read-back failed');
      var verified = await validate(stored[contentKey]);
      if (
        !verified ||
        String(verified.effectiveChecksum || '').toLowerCase() !== effectiveChecksum
      ) {
        throw new Error('stored bundle checksum mismatch');
      }

      var activatedAt = now().toISOString();
      var pendingReceipt = {
        effectiveChecksum: effectiveChecksum,
        idempotencyKey: receiptIdempotencyKey,
        releaseId: releaseId,
        releaseSequence: releaseSequence,
        appliedAt: activatedAt,
      };
      pendingReceipts.push(pendingReceipt);
      var pointer = {
        state: 'active',
        activeChecksum: effectiveChecksum,
        previousChecksum: existing && existing.activeChecksum !== effectiveChecksum
          ? existing.activeChecksum
          : existing && existing.previousChecksum || null,
        generation: existing && Number.isSafeInteger(existing.generation)
          ? existing.generation + (existing.activeChecksum === effectiveChecksum ? 0 : 1)
          : 1,
        etag: etag,
        releaseId: releaseId,
        releaseSequence: releaseSequence,
        contentChecksum: contentChecksum,
        effectiveChecksum: effectiveChecksum,
        validUntil: candidate.validUntil || null,
        staleUntil: candidate.staleUntil || null,
        serverTime: serverTime,
        authorizationValidUntil: authorizationValidUntil,
        activatedAt: activatedAt,
        pendingReceipt: pendingReceipts[0],
        pendingReceipts: pendingReceipts,
      };
      var activePointerKey = pointerKey(input.namespace);
      await storage.set((function () {
        var value = {};
        value[activePointerKey] = pointer;
        return value;
      })());
      return pointer;
    }
    async function stageAndActivate(input) {
      if (!input || typeof input !== 'object') {
        throw new TypeError('activation input is required');
      }
      return runNamespaceMutation(input.namespace, function () {
        return stageAndActivateNow(input);
      });
    }
    async function applyNotModifiedNow(input) {
      if (!input || typeof input !== 'object') {
        throw new TypeError('not-modified input is required');
      }
      var existing = await readPointer(input.namespace);
      if (!existing || existing.state !== 'active') {
        throw new Error('active bundle is unavailable');
      }
      var etag = requiredText(input.etag, 'etag');
      var effectiveChecksum = requiredText(
        input.effectiveChecksum,
        'effectiveChecksum',
      ).toLowerCase();
      if (etag !== existing.etag || effectiveChecksum !== existing.effectiveChecksum) {
        throw new Error('not-modified response does not match the active bundle');
      }
      var serverTime = validDate(input.serverTime, 'serverTime');
      var authorizationValidUntil = validDate(
        input.authorizationValidUntil,
        'authorizationValidUntil',
      );
      if (Date.parse(authorizationValidUntil) <= Date.parse(serverTime)) {
        throw new TypeError('authorizationValidUntil must be later than serverTime');
      }
      var pointer = Object.assign({}, existing, {
        serverTime: serverTime,
        authorizationValidUntil: authorizationValidUntil,
      });
      var key = pointerKey(input.namespace);
      await storage.set((function () {
        var value = {};
        value[key] = pointer;
        return value;
      })());
      return pointer;
    }

    async function applyNotModified(input) {
      if (!input || typeof input !== 'object') {
        throw new TypeError('not-modified input is required');
      }
      return runNamespaceMutation(input.namespace, function () {
        return applyNotModifiedNow(input);
      });
    }

    async function readActive(namespace) {
      var pointer = await readPointer(namespace);
      if (!pointer || pointer.state !== 'active' || !CHECKSUM_RE.test(pointer.activeChecksum || '')) {
        return null;
      }
      var key = blobKey(namespace, pointer.activeChecksum);
      var result = await storage.get([key]);
      if (!result || !result[key]) return null;
      try {
        var verified = await validate(result[key]);
        return String(verified.effectiveChecksum || '').toLowerCase() === pointer.activeChecksum
          ? verified
          : null;
      } catch (_error) {
        return null;
      }
    }

    async function preparePendingReceiptNow(namespace, input) {
      var existing = await readPointer(namespace);
      if (!existing || existing.state !== 'active') return null;
      var pendingReceipts = pendingReceiptsFor(existing);
      if (pendingReceipts.length === 0) return null;
      var pendingReceipt = pendingReceipts[0];
      var existingAppliedAt = String(
        pendingReceipt && pendingReceipt.appliedAt || '',
      ).trim();
      if (existingAppliedAt) {
        validDate(existingAppliedAt, 'pending receipt appliedAt');
        return Object.assign({}, pendingReceipt);
      }
      var appliedAt = validDate(input && input.appliedAt, 'pending receipt appliedAt');
      pendingReceipt.appliedAt = appliedAt;
      pendingReceipts[0] = pendingReceipt;
      var pointer = Object.assign({}, existing, {
        pendingReceipt: pendingReceipt,
        pendingReceipts: pendingReceipts,
      });
      var key = pointerKey(namespace);
      await storage.set((function () {
        var value = {};
        value[key] = pointer;
        return value;
      })());
      return Object.assign({}, pendingReceipt);
    }

    async function preparePendingReceipt(namespace, input) {
      return runNamespaceMutation(namespace, function () {
        return preparePendingReceiptNow(namespace, input);
      });
    }

    async function readPendingReceipt(namespace) {
      var pointer = await readPointer(namespace);
      if (!pointer || pointer.state !== 'active') return null;
      var pendingReceipts = pendingReceiptsFor(pointer);
      return pendingReceipts.length > 0 ? Object.assign({}, pendingReceipts[0]) : null;
    }

    async function markReceiptReportedNow(namespace, input) {
      var existing = await readPointer(namespace);
      if (!existing || existing.state !== 'active') {
        throw new Error('pending receipt is unavailable');
      }
      var pendingReceipts = pendingReceiptsFor(existing);
      if (pendingReceipts.length === 0) throw new Error('pending receipt is unavailable');
      var pendingReceipt = pendingReceipts[0];
      var idempotencyKey = requiredText(input && input.idempotencyKey, 'idempotencyKey');
      if (idempotencyKey !== pendingReceipt.idempotencyKey) {
        throw new Error('receipt does not match the pending release');
      }
      var receiptId = requiredText(input && input.receiptId, 'receiptId');
      var reportedAt = validDate(input && input.reportedAt, 'reportedAt');
      pendingReceipts.shift();
      var pointer = Object.assign({}, existing, {
        pendingReceipt: pendingReceipts[0] || null,
        pendingReceipts: pendingReceipts,
        lastReceipt: {
          effectiveChecksum: pendingReceipt.effectiveChecksum,
          idempotencyKey: idempotencyKey,
          receiptId: receiptId,
          releaseId: pendingReceipt.releaseId,
          releaseSequence: pendingReceipt.releaseSequence,
          reportedAt: reportedAt,
        },
      });
      var key = pointerKey(namespace);
      await storage.set((function () {
        var value = {};
        value[key] = pointer;
        return value;
      })());
      return pointer;
    }

    async function markReceiptReported(namespace, input) {
      return runNamespaceMutation(namespace, function () {
        return markReceiptReportedNow(namespace, input);
      });
    }

    async function readBundleByChecksum(namespace, checksum) {
      if (!CHECKSUM_RE.test(checksum || '')) return null;
      var key = blobKey(namespace, checksum);
      var result = await storage.get([key]);
      if (!result || !result[key]) return null;
      try {
        var verified = await validate(result[key]);
        return String(verified.effectiveChecksum || '').toLowerCase() === checksum
          ? verified
          : null;
      } catch (_error) {
        return null;
      }
    }

    function bundlePolicy(bundle, pointer, at, active) {
      var validUntil = active ? bundle.validUntil || pointer.validUntil : bundle.validUntil;
      var staleUntil = active ? bundle.staleUntil || pointer.staleUntil : bundle.staleUntil;
      var validMs = Date.parse(String(validUntil || ''));
      var staleMs = Date.parse(String(staleUntil || ''));
      if (!Number.isFinite(validMs) || !Number.isFinite(staleMs) || staleMs < validMs) {
        return 'invalid';
      }
      if (at <= validMs) return 'healthy';
      if (at <= staleMs) return 'stale';
      return 'expired';
    }

    async function resolveUsable(namespace, input) {
      var pointer = await readPointer(namespace);
      if (!pointer) return { state: 'no_config', quoteAllowed: false, bundle: null };
      if (pointer.state === 'revoked') {
        return { state: 'revoked', quoteAllowed: false, bundle: null };
      }
      var atText = validDate(input && input.at, 'at');
      var at = Date.parse(atText);
      var authorizationUntil = Date.parse(String(pointer.authorizationValidUntil || ''));
      var clockSkewMs = options && Number.isFinite(options.clockSkewMs)
        ? Math.max(0, Math.min(options.clockSkewMs, 5 * 60 * 1000))
        : 5 * 60 * 1000;
      if (!Number.isFinite(authorizationUntil) || at > authorizationUntil + clockSkewMs) {
        return {
          state: 'authorization_expired',
          quoteAllowed: false,
          bundle: null,
          authorizationValidUntil: pointer.authorizationValidUntil || null,
          validUntil: pointer.validUntil || null,
          staleUntil: pointer.staleUntil || null,
        };
      }

      var active = await readBundleByChecksum(namespace, pointer.activeChecksum);
      if (active) {
        var activeVersion = incompatibleVersionResult(active, input, {
          effectiveChecksum: pointer.activeChecksum,
          authorizationValidUntil: pointer.authorizationValidUntil || null,
          validUntil: active.validUntil || pointer.validUntil || null,
          staleUntil: active.staleUntil || pointer.staleUntil || null,
        });
        if (activeVersion) return activeVersion;
        var activePolicy = bundlePolicy(active, pointer, at, true);
        if (activePolicy === 'healthy' || activePolicy === 'stale') {
          return {
            state: activePolicy,
            quoteAllowed: true,
            bundle: active,
            effectiveChecksum: pointer.activeChecksum,
            authorizationValidUntil: pointer.authorizationValidUntil || null,
            validUntil: active.validUntil || pointer.validUntil || null,
            staleUntil: active.staleUntil || pointer.staleUntil || null,
          };
        }
        return {
          state: activePolicy,
          quoteAllowed: false,
          bundle: active,
          authorizationValidUntil: pointer.authorizationValidUntil || null,
          validUntil: active.validUntil || pointer.validUntil || null,
          staleUntil: active.staleUntil || pointer.staleUntil || null,
        };
      }

      var previous = await readBundleByChecksum(namespace, pointer.previousChecksum);
      if (previous) {
        var previousVersion = incompatibleVersionResult(previous, input, {
          effectiveChecksum: pointer.previousChecksum,
          authorizationValidUntil: pointer.authorizationValidUntil || null,
          validUntil: previous.validUntil || null,
          staleUntil: previous.staleUntil || null,
        });
        if (previousVersion) return previousVersion;
        var previousPolicy = bundlePolicy(previous, pointer, at, false);
        if (previousPolicy === 'healthy' || previousPolicy === 'stale') {
          return {
            state: 'recovered_previous',
            freshness: previousPolicy,
            quoteAllowed: true,
            bundle: previous,
            effectiveChecksum: pointer.previousChecksum,
            authorizationValidUntil: pointer.authorizationValidUntil || null,
            validUntil: previous.validUntil || null,
            staleUntil: previous.staleUntil || null,
          };
        }
        return {
          state: previousPolicy,
          quoteAllowed: false,
          bundle: previous,
          authorizationValidUntil: pointer.authorizationValidUntil || null,
          validUntil: previous.validUntil || null,
          staleUntil: previous.staleUntil || null,
        };
      }
      return { state: 'invalid_bundle', quoteAllowed: false, bundle: null };
    }
    async function markRevokedNow(namespace, input) {
      var existing = await readPointer(namespace);
      if (!existing) return null;
      var status = Number(input && input.status);
      if (status !== 401 && status !== 403 && status !== 410) {
        throw new TypeError('revocation status is invalid');
      }
      var reason = String(input && input.reason || '').trim();
      if (!/^[a-z0-9_]{1,80}$/.test(reason)) reason = 'authorization_revoked';
      var pointer = Object.assign({}, existing, {
        state: 'revoked',
        authorizationValidUntil: null,
        revocation: {
          status: status,
          reason: reason,
          at: now().toISOString(),
        },
      });
      var key = pointerKey(namespace);
      await storage.set((function () {
        var value = {};
        value[key] = pointer;
        return value;
      })());
      return pointer;
    }

    async function markRevoked(namespace, input) {
      return runNamespaceMutation(namespace, function () {
        return markRevokedNow(namespace, input);
      });
    }

    return {
      applyNotModified: applyNotModified,
      garbageCollect: garbageCollect,
      markRevoked: markRevoked,
      markReceiptReported: markReceiptReported,
      preparePendingReceipt: preparePendingReceipt,
      readPendingReceipt: readPendingReceipt,
      readActive: readActive,
      readPointer: readPointer,
      resolveUsable: resolveUsable,
      stageAndActivate: stageAndActivate,
    };
  }

  global.SS_ERP_LOGISTICS_DISTRIBUTION_STORE = {
    createStore: createStore,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
