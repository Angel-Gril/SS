(function (root) {
  'use strict';
  const TYPES = ['ss-erp:product-analysis-readiness', 'ss-erp:product-analysis-analyze', 'ss-erp:product-analysis-read',
    'ss-erp:product-analysis-permission-prepare', 'ss-erp:product-analysis-permission-commit',
    'ss-erp:preparation-checkpoint-read', 'ss-erp:preparation-checkpoint-write', 'ss-erp:preparation-checkpoint-clear'];
  const exact = (value, fields) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
  const failure = () => { throw Object.assign(new Error('Private product preparation request denied'), { code: 'SS_ERP_PREPARATION_REQUEST_DENIED' }); };
  function createHandler(options) {
    const tickets = new Map();
    function assertSender(sender) {
      const origin = 'chrome-extension://' + options.runtimeId;
      if (sender?.id !== options.runtimeId || sender?.url !== origin + '/pages/precision-workbench.html'
        || sender?.origin !== origin || !Number.isSafeInteger(sender?.tab?.id) || !Number.isSafeInteger(sender?.frameId)
        || sender.frameId < 1 || typeof sender.documentId !== 'string' || !sender.documentId) failure();
    }
    const ticketInput = input => Object.fromEntries(['binding', 'profileId', 'skuKey', 'analysisModel'].map(key => [key, input[key]]));
    return Object.freeze({
      accepts: type => TYPES.includes(type),
      async handle(message, sender) {
        try {
          assertSender(sender);
          if (!exact(message, ['type', 'payload']) || !TYPES.includes(message.type)) failure();
          const payload = message.payload, type = message.type;
          const fields = type === 'ss-erp:product-analysis-analyze' ? ['binding', 'skuKey', 'sourceMediaKeys', 'operationKey', 'profileId', 'analysisModel', 'categoryRevision']
            : type === 'ss-erp:product-analysis-read' ? ['binding', 'operationKey']
            : type.startsWith('ss-erp:product-analysis-') ? ['binding', 'profileId', 'skuKey', 'analysisModel',
              ...(type.endsWith('commit') ? ['permissionTicket'] : [])]
            : ['binding', ...(type.endsWith('write') ? ['checkpoint'] : [])];
          if (!exact(payload, fields)) failure();
          const claim = await options.claimFrame(sender);
          const owner = { ownerUserId: claim.source.ownerUserId, deviceSessionId: claim.source.deviceSessionId,
            sourcePlatform: claim.source.sourcePlatform, sourceProductId: claim.source.sourceProductId,
            tabId: sender.tab.id, frameId: sender.frameId, documentId: sender.documentId };
          await options.assertBinding({ binding: payload.binding, owner, skuKey: payload.skuKey,
            allowPrevious: type.includes('checkpoint') || type === 'ss-erp:product-analysis-read' });
          let data;
          if (type.includes('checkpoint')) {
            const store = options.getCheckpoint();
            data = await store[type.split('-').at(-1)]({ ...payload, owner });
          } else if (type.includes('permission')) {
            if (type.endsWith('prepare')) {
              const readiness = await options.getClient().getReadiness(payload, owner);
              if (!readiness.readiness?.analysis?.ready) failure();
              const broker = options.getPermissionBroker(), credential = await options.getProfileStore().getCredentialSnapshotForBackground(payload.profileId);
              const origin = readiness.readiness.context.providerOrigin;
              const permissionTicket = root.crypto.randomUUID(), expiresAt = Date.now() + 60000;
              for (const [key, entry] of tickets) if (entry.expiresAt <= Date.now()) tickets.delete(key);
              if (tickets.size >= 32) failure();
              tickets.set(permissionTicket, { owner, input: ticketInput(payload), expiresAt, origin, readiness: readiness.readiness,
                credentialRevision: credential.credentialRevision, consentEpoch: await broker.captureConsentEpoch() });
              data = { permissionTicket, expiresAt, providerOrigin: origin, pattern: origin + '/*' };
            } else {
              const ticket = tickets.get(payload.permissionTicket); tickets.delete(payload.permissionTicket);
              if (!ticket || ticket.expiresAt <= Date.now() || JSON.stringify(ticket.owner) !== JSON.stringify(owner)
                || JSON.stringify(ticket.input) !== JSON.stringify(ticketInput(payload))) failure();
              const readiness = await options.getClient().getReadiness(ticket.input, owner);
              const credential = await options.getProfileStore().getCredentialSnapshotForBackground(payload.profileId);
              if (credential.credentialRevision !== ticket.credentialRevision
                || JSON.stringify(readiness.readiness) !== JSON.stringify(ticket.readiness)) failure();
              data = await options.getPermissionBroker().finalizeOriginConsent(ticket.origin, ticket.consentEpoch);
            }
          } else {
            const client = options.getClient();
            const method = type.endsWith('readiness') ? 'getReadiness' : type.endsWith('analyze') ? 'analyzeProduct' : 'readProductAnalysis';
            data = await client[method](payload, owner);
          }
          return { ok: true, data };
        } catch (cause) {
          const errorCode = /^SS_ERP_[A-Z0-9_]{1,90}$/u.test(cause?.code || '') ? cause.code : 'SS_ERP_PREPARATION_REQUEST_DENIED';
          return { ok: false, errorCode, outcome: cause?.outcome === 'UNKNOWN_OUTCOME' ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED' };
        }
      },
    });
  }
  root.SS_ERP_PREPARATION_RUNTIME_HANDLER = Object.freeze({ TYPES, createHandler });
})(typeof globalThis !== 'undefined' ? globalThis : self);
