(function exposeByokRuntimeAuthority(global) {
  'use strict';

  var CONTRACT_VERSION = 'extension-byok-runtime-authority/v1';

  function authorityError() {
    var error = new Error('BYOK device authority is stale');
    error.code = 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE';
    return error;
  }

  function requiredMethod(value, name) {
    if (!value || typeof value[name] !== 'function') throw authorityError();
    return value[name].bind(value);
  }

  function createGuard(options) {
    var credentials = options && options.credentials;
    var captureAuthority = requiredMethod(credentials, 'captureAuthority');
    var isAuthorityCurrent = requiredMethod(credentials, 'isAuthorityCurrent');
    var getStatus = requiredMethod(credentials, 'getStatus');

    async function captureLifecycleAuthority() {
      try {
        return await captureAuthority();
      } catch {
        throw authorityError();
      }
    }

    async function lifecycleAuthorityIsCurrent(value) {
      try {
        return Boolean(await isAuthorityCurrent(value));
      } catch {
        throw authorityError();
      }
    }

    async function assertCurrent(context) {
      if (!context || !await lifecycleAuthorityIsCurrent(context.lifecycleAuthority)) {
        throw authorityError();
      }
      var status = await getStatus();
      if (!await lifecycleAuthorityIsCurrent(context.lifecycleAuthority)
        || !status || status.state !== 'paired'
        || status.ownerUserId !== context.ownerUserId
        || status.sessionId !== context.deviceSessionId) {
        throw authorityError();
      }
      return context;
    }

    async function capture(binding) {
      if (!binding || typeof binding !== 'object') throw authorityError();
      return assertCurrent({
        lifecycleAuthority: await captureLifecycleAuthority(),
        ownerUserId: binding.ownerUserId,
        deviceSessionId: binding.deviceSessionId,
        shopId: binding.shopId,
        workflowId: binding.workflowId,
        draftRevision: binding.draftRevision,
        draftVersion: binding.draftVersion,
        policyRevision: binding.policyRevision,
      });
    }

    async function commitGeneratedResult(input) {
      if (!input || !input.vault || typeof input.vault.put !== 'function') {
        throw authorityError();
      }
      await assertCurrent(input.authority);
      return input.vault.put(
        input.generated,
        input.binding,
        input.authority.lifecycleAuthority,
      );
    }

    function matchesVaultAuthority(entry, binding, context) {
      var stored = entry && entry.binding;
      return Boolean(stored)
        && entry.lifecycleEpoch === context.lifecycleAuthority.epoch
        && stored.ownerUserId === binding.ownerUserId
        && stored.deviceSessionId === binding.deviceSessionId
        && stored.shopId === binding.shopId
        && stored.workflowId === binding.workflowId
        && stored.draftRevision === binding.draftRevision
        && stored.draftVersion === binding.draftVersion
        && stored.sourcePlatform === binding.sourcePlatform
        && stored.sourceProductId === binding.sourceProductId
        && stored.sourceCaptureSnapshotId === binding.sourceCaptureSnapshotId
        && stored.supplyGoodsId === binding.supplyGoodsId
        && stored.skuKey === binding.skuKey
        && stored.slotKey === binding.slotKey
        && stored.assignmentMode === binding.assignmentMode
        && stored.assignmentOrdinal === binding.assignmentOrdinal
        && stored.providerOrigin === binding.providerOrigin
        && stored.model === binding.model
        && stored.operation === binding.operation
        && stored.policyRevision === binding.policyRevision;
    }

    return Object.freeze({
      capture: capture,
      assertCurrent: assertCurrent,
      commitGeneratedResult: commitGeneratedResult,
      matchesVaultAuthority: matchesVaultAuthority,
    });
  }

  global.SS_ERP_BYOK_RUNTIME_AUTHORITY = Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    createGuard: createGuard,
  });
}(typeof globalThis !== 'undefined' ? globalThis : self));
