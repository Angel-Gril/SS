import { describe, expect, it, vi } from 'vitest';
import type { OzonListingDraft } from 'shared';
import { OzonApiError, OzonNetworkError } from '../services/ozon-client.js';
import {
  OzonPublishAttemptError,
  type OzonPublishAttemptRecord,
  type OzonPublishAttemptRepository,
  type OzonPublishLeaseClaim,
  type PrepareOzonPublishAttemptInput,
} from '../services/ozon-publish-attempts.js';
import {
  createOzonListingPublisher,
  type CompiledOzonListingPublishRequest,
} from '../services/ozon-listing-publisher.js';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { hashOzonListingPublishState } from '../services/source-listing-workflow.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import type {
  ExtensionByokPublishAuthorizationDecision,
  ExtensionByokPublishAuthorizationInput,
} from '../services/extension-byok-publish-authorization.js';

function draft(overrides: Partial<OzonListingDraft> = {}): OzonListingDraft {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-1'], draftVersion: 2, revision: 7,
    stage: 'READY_TO_PUBLISH', runState: 'ACTIVE', runStateReason: null,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    attributes: { values: {} },
    copy: { publishTitleRu: 'Товар', publishDescriptionRu: 'Описание', candidates: [], applyAudit: [] },
    media: { assignments: [] }, pricing: { value: null },
    validation: { status: 'VALID', report: { schemaRevision: 'b'.repeat(64) } },
    completedStepHashes: {}, blockers: [], warnings: [], publishTaskIds: [],
    freshness: Object.fromEntries(['category', 'attributes', 'content', 'media', 'pricing', 'validation']
      .map((key) => [key, { state: 'CURRENT', reason: null }])) as OzonListingDraft['freshness'],
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [], createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:00:00.000Z',
    ...overrides,
  };
}

function compilation(current: OzonListingDraft): CompiledOzonListingPublishRequest {
  return {
    publisherContractVersion: 'ozon-listing-publisher/v1',
    endpoint: '/v3/product/import',
    draftStateHash: hashOzonListingPublishState(current),
    catalogSnapshotId: 'catalog-snapshot-1',
    catalogRevision: 'catalog-1',
    catalogSnapshot: { revision: 'catalog-1' },
    catalogSnapshotHash: 'c'.repeat(64),
    attributeSchemaSnapshot: { revision: 'schema-1' },
    attributeSchemaHash: 'd'.repeat(64),
    requestPayload: { items: [{ offer_id: 'offer-1' }] },
    requestPayloadHash: 'e'.repeat(64),
    offerTrace: [{ ordinal: 0, offerId: 'offer-1', skuKey: 'sku-1' }],
  };
}

function attempt(overrides: Partial<OzonPublishAttemptRecord> = {}): OzonPublishAttemptRecord {
  return {
    id: 'attempt-1', publishIntentId: 'intent-1', workflowId: 'draft-1', ownerUserId: 'owner-1',
    shopId: 'shop-1', draftVersion: 2, revision: 8, sourceCaptureSnapshotId: 'snapshot-1',
    actorUserId: 'owner-1', idempotencyKey: 'publish-key-1', catalogSnapshotId: 'catalog-snapshot-1',
    catalogRevision: 'catalog-1', catalogSnapshot: { revision: 'catalog-1' }, catalogSnapshotHash: 'c'.repeat(64),
    attributeSchemaSnapshot: { revision: 'schema-1' }, attributeSchemaHash: 'd'.repeat(64),
    publisherContractVersion: 'ozon-listing-publisher/v1', endpoint: '/v3/product/import',
    draftPayloadHash: 'f'.repeat(64), draftStateHash: 'a'.repeat(64),
    requestPayload: { items: [{ offer_id: 'offer-1' }] }, requestPayloadHash: 'e'.repeat(64),
    offerTrace: [{ ordinal: 0, offerId: 'offer-1', skuKey: 'sku-1' }], itemCount: 1,
    state: 'PREPARED', reconciliationState: 'NOT_REQUIRED', stateVersion: 1,
    ozonTaskId: null, acceptanceSource: null, response: null, responseHash: null,
    itemResults: null, itemErrors: [], lastErrorCode: null, lastErrorMessage: null,
    leasePurpose: null, leaseToken: null, leaseOwner: null, leaseEpoch: 0,
    heartbeatAt: null, leaseExpiresAt: null, submitStartedAt: null, submittedAt: null,
    unknownAt: null, rejectedAt: null, nextReconcileAt: null, reconcileAttemptCount: 0,
    lastReconciledAt: null, completedAt: null, resolvedByUserId: null, resolutionNote: null,
    resolutionEvidence: null, resolutionEvidenceHash: null,
    createdAt: '2026-07-15T08:00:00.000Z', updatedAt: '2026-07-15T08:00:00.000Z',
    ...overrides,
  };
}

function build(options: {
  submit?: () => Promise<unknown>;
  prepared?: OzonPublishAttemptRecord;
  existing?: OzonPublishAttemptRecord | null;
  claim?: OzonPublishLeaseClaim | null;
  authorizeDraftMediaPublish?: (
    input: ExtensionByokPublishAuthorizationInput,
  ) => Promise<ExtensionByokPublishAuthorizationDecision>;
} = {}) {
  const current = draft();
  const prepared = options.prepared || attempt({ draftStateHash: hashOzonListingPublishState(current) });
  const completed: OzonPublishAttemptRecord[] = [];
  const repository = {
    getByPublishIntent: vi.fn(async () => options.existing ?? null),
    prepare: vi.fn(async (_input: PrepareOzonPublishAttemptInput) => ({ attempt: prepared, idempotent: false })),
    claimSubmission: vi.fn(async () => options.claim === undefined
      ? { attempt: prepared, leaseToken: 'lease-1', leaseEpoch: 1 }
      : options.claim),
    heartbeat: vi.fn(async () => true),
    completeSubmission: vi.fn(async ({ outcome }) => {
      const next = attempt({
        ...prepared,
        state: outcome.kind,
        ozonTaskId: outcome.kind === 'SUBMITTED' ? outcome.taskId : null,
      });
      completed.push(next);
      return next;
    }),
    getOwned: vi.fn(async () => completed.at(-1) || prepared),
    recoverSubmissionAcknowledgement: vi.fn(async ({ taskId, response }) => attempt({
      ...prepared,
      state: 'SUBMITTED',
      reconciliationState: 'PENDING',
      ozonTaskId: taskId,
      acceptanceSource: 'RECOVERED_TASK_RESPONSE',
      response,
    })),
    attachLateAcknowledgement: vi.fn(async ({ taskId }) => attempt({ ...prepared, state: 'SUBMITTED', ozonTaskId: taskId })),
    resolveUnknown: vi.fn(async () => attempt({ ...prepared, state: 'REJECTED' })),
  } as unknown as OzonPublishAttemptRepository;
  const workflow = {
    getDraft: vi.fn(async () => current),
    recordPublishIntent: vi.fn(async () => ({
      draft: draft({ stage: 'PUBLISH_INTENT_RECORDED', revision: 8 }),
      intent: {
        id: 'intent-1', draftId: current.id, ownerUserId: current.ownerUserId, shopId: current.shopId,
        draftVersion: current.draftVersion, revision: 8, idempotencyKey: 'publish-key-1',
        payloadHash: hashOzonListingPublishState(current), actorUserId: current.ownerUserId,
        createdAt: '2026-07-15T08:00:00.000Z',
      },
      idempotent: false,
    })),
  };
  const compile = vi.fn(async () => compilation(current));
  const submitImportOnce = vi.fn(options.submit || (async () => ({ result: { task_id: 123 } })));
  const authorizeDraftMediaPublish = options.authorizeDraftMediaPublish || vi.fn(async (
    _input: ExtensionByokPublishAuthorizationInput,
  ) => ({ byokAssetIds: [], policyRevision: null }));
  const publisher = createOzonListingPublisher({
    workflow,
    attempts: repository,
    compile,
    submitImportOnce,
    authorizeDraftMediaPublish,
    workerId: 'api-1',
    leaseMs: 60_000,
  });
  return {
    publisher, workflow, repository, compile, submitImportOnce,
    authorizeDraftMediaPublish, current,
  };
}

const publishInput = {
  draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
  expectedRevision: 7, idempotencyKey: 'publish-key-1',
};

describe('Ozon listing publisher', () => {
  it('blocks BYOK media before recording intent when the live publish policy denies it', async () => {
    const denied = Object.assign(new Error('BYOK publish is disabled'), {
      code: 'EXTENSION_BYOK_PUBLISH_DISABLED', statusCode: 409,
    });
    const authorizeDraftMediaPublish = vi.fn(async (
      _input: ExtensionByokPublishAuthorizationInput,
    ): Promise<ExtensionByokPublishAuthorizationDecision> => { throw denied; });
    const built = build({ authorizeDraftMediaPublish });

    await expect(built.publisher.publish({
      ...publishInput,
      requestingDeviceSessionId: 'device-publisher',
    })).rejects.toBe(denied);
    expect(authorizeDraftMediaPublish).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'draft-1',
      assignments: [],
      requestingDeviceSessionId: 'device-publisher',
    });
    expect(built.workflow.recordPublishIntent).not.toHaveBeenCalled();
    expect(built.compile).not.toHaveBeenCalled();
    expect(built.repository.claimSubmission).not.toHaveBeenCalled();
    expect(built.submitImportOnce).not.toHaveBeenCalled();
  });

  it('rechecks the live BYOK policy immediately before claiming an Ozon submission', async () => {
    const denied = Object.assign(new Error('BYOK publish was disabled'), {
      code: 'EXTENSION_BYOK_PUBLISH_DISABLED', statusCode: 409,
    });
    const authorizeDraftMediaPublish = vi.fn(async (
      _input: ExtensionByokPublishAuthorizationInput,
    ): Promise<ExtensionByokPublishAuthorizationDecision> => (
      { byokAssetIds: [], policyRevision: null }
    ))
      .mockResolvedValueOnce({ byokAssetIds: [], policyRevision: 17 })
      .mockRejectedValueOnce(denied);
    const built = build({ authorizeDraftMediaPublish });

    await expect(built.publisher.publish(publishInput)).rejects.toBe(denied);
    expect(authorizeDraftMediaPublish).toHaveBeenCalledTimes(2);
    expect(built.workflow.recordPublishIntent).toHaveBeenCalledTimes(1);
    expect(built.repository.prepare).toHaveBeenCalledTimes(1);
    expect(built.repository.claimSubmission).not.toHaveBeenCalled();
    expect(built.submitImportOnce).not.toHaveBeenCalled();
  });

  it('binds the final BYOK decision and requesting session into the submission claim', async () => {
    const authorizeDraftMediaPublish = vi.fn(async () => ({
      byokAssetIds: ['asset-byok'],
      policyRevision: 17,
    }));
    const built = build({ authorizeDraftMediaPublish });

    await expect(built.publisher.publish({
      ...publishInput,
      requestingDeviceSessionId: 'device-publisher',
    })).resolves.toMatchObject({ state: 'SUBMITTED' });
    expect(authorizeDraftMediaPublish).toHaveBeenCalledTimes(2);
    expect(built.repository.claimSubmission).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      workerId: 'api-1',
      leaseMs: 60_000,
      byokAssetIds: ['asset-byok'],
      requestingDeviceSessionId: 'device-publisher',
    });
    expect(built.repository.claimSubmission).toHaveBeenCalledBefore(built.submitImportOnce);
  });

  it('persists the frozen request and SUBMITTING lease before one external call', async () => {
    const { publisher, workflow, repository, submitImportOnce, current } = build();

    await expect(publisher.publish(publishInput)).resolves.toMatchObject({
      state: 'SUBMITTED', ozonTaskId: '123',
    });
    expect(workflow.recordPublishIntent).toHaveBeenCalledWith(publishInput);
    expect(repository.prepare).toHaveBeenCalledWith(expect.objectContaining({
      publishIntentId: 'intent-1', requestPayloadHash: 'e'.repeat(64),
      offerTrace: [{ ordinal: 0, offerId: 'offer-1', skuKey: 'sku-1' }],
    }));
    expect(repository.claimSubmission).toHaveBeenCalledBefore(submitImportOnce);
    expect(repository.claimSubmission).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      workerId: 'api-1',
      leaseMs: 60_000,
      byokAssetIds: [],
      requestingDeviceSessionId: null,
    });
    expect(submitImportOnce).toHaveBeenCalledTimes(1);
    expect(submitImportOnce).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', shopId: 'shop-1',
      requestPayload: { items: [{ offer_id: 'offer-1' }] },
    }));
    expect(current.stage).toBe('READY_TO_PUBLISH');
  });

  it('returns a persisted non-PREPARED replay without another Ozon call', async () => {
    const submitted = attempt({ state: 'SUBMITTED', ozonTaskId: '123' });
    const { publisher, submitImportOnce, repository, compile } = build({ existing: submitted });

    await expect(publisher.publish(publishInput)).resolves.toMatchObject({ state: 'SUBMITTED' });
    expect(repository.prepare).not.toHaveBeenCalled();
    expect(repository.claimSubmission).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(submitImportOnce).not.toHaveBeenCalled();
  });

  it('revalidates a persisted PREPARED attempt before its first Ozon call', async () => {
    const prepared = attempt();
    const { publisher, repository, compile, submitImportOnce } = build({
      existing: prepared,
      prepared,
    });

    await expect(publisher.publish(publishInput)).resolves.toMatchObject({
      state: 'SUBMITTED', ozonTaskId: '123',
    });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(repository.prepare).toHaveBeenCalledTimes(1);
    expect(repository.claimSubmission).toHaveBeenCalledTimes(1);
    expect(submitImportOnce).toHaveBeenCalledTimes(1);
  });

  it('does not submit a PREPARED attempt when current authority no longer matches it', async () => {
    const prepared = attempt();
    const built = build({ existing: prepared, prepared });
    vi.mocked(built.repository.prepare).mockRejectedValueOnce(
      new OzonPublishAttemptError('IDEMPOTENCY_CONFLICT', 'immutable request changed'),
    );

    await expect(built.publisher.publish(publishInput))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(built.compile).toHaveBeenCalledTimes(1);
    expect(built.repository.claimSubmission).not.toHaveBeenCalled();
    expect(built.submitImportOnce).not.toHaveBeenCalled();
  });

  it('replays the same key after the real workflow intent advances the revision', async () => {
    const workflow = createSourceListingWorkflowService({
      repository: new InMemoryOzonListingDraftRepository(),
      idFactory: (prefix) => `${prefix}-replay`,
    });
    const created = await workflow.createDraft({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      shopId: 'shop-1',
      supplyGoodsId: 'goods-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureHash: 'a'.repeat(64),
      selectedSkuKeys: ['sku-1'],
    });
    const categorized = await workflow.setCategory({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: created.revision,
      category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    });
    const withAttributes = await workflow.setAttributeValues({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: categorized.revision,
      values: {},
      operation: 'SYSTEM_SYNC',
    });
    const copyCandidate = await workflow.addAiCopyCandidate({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: withAttributes.revision,
      titleRu: 'Товар для тестовой публикации',
      descriptionRu: 'Проверенное описание товара.',
      sourcePromptVersion: 'copy-v1',
    });
    const copied = await workflow.applyAiCopyCandidate({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: copyCandidate.draft.revision,
      candidateId: copyCandidate.candidate.id,
      operationKey: 'apply-copy-replay-1',
    });
    const withMedia = await workflow.setMediaAssignments({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: copied.revision,
      assignments: [{
        scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset-main', source: 'SOURCE',
      }],
    });
    const priced = await workflow.setPricing({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: withMedia.revision,
      value: {
        contractVersion: 'ozon-listing-pricing/v1',
        items: [{
          skuKey: 'sku-1', price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0',
        }],
      },
    });
    const ready = await workflow.recordValidationResult({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: priced.revision,
      status: 'VALID',
      report: {
        schemaRevision: 'schema-1',
        operationReadiness: { ozonImport: { status: 'READY', issues: [] } },
      },
      blockers: [],
      warnings: [],
    });
    let persisted = attempt({
      id: 'attempt-replay',
      workflowId: ready.id,
      revision: ready.revision + 1,
      draftStateHash: hashOzonListingPublishState(ready),
    });
    let prepared = false;
    const attempts = {
      getByPublishIntent: vi.fn(async () => prepared ? persisted : null),
      prepare: vi.fn(async () => {
        if (!prepared) {
          prepared = true;
          return { attempt: persisted, idempotent: false };
        }
        return { attempt: persisted, idempotent: true };
      }),
      claimSubmission: vi.fn(async () => ({
        attempt: persisted,
        leaseToken: 'lease-replay',
        leaseEpoch: 1,
      })),
      heartbeat: vi.fn(async () => true),
      completeSubmission: vi.fn(async ({ outcome }) => {
        persisted = attempt({
          ...persisted,
          state: outcome.kind,
          reconciliationState: outcome.kind === 'SUBMITTED' ? 'PENDING' : 'NOT_REQUIRED',
          ozonTaskId: outcome.kind === 'SUBMITTED' ? outcome.taskId : null,
        });
        return persisted;
      }),
      getOwned: vi.fn(async () => persisted),
    } as unknown as OzonPublishAttemptRepository;
    const compile = vi.fn(async ({ draft: frozen }: { draft: OzonListingDraft }) => (
      compilation(frozen)
    ));
    const submitImportOnce = vi.fn(async () => ({ result: { task_id: 123 } }));
    const publisher = createOzonListingPublisher({
      workflow,
      attempts,
      compile,
      submitImportOnce,
      authorizeDraftMediaPublish: async () => ({ byokAssetIds: [], policyRevision: null }),
      workerId: 'api-replay',
      leaseMs: 60_000,
    });
    const input = {
      draftId: ready.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: ready.revision,
      idempotencyKey: 'publish-replay-1',
    };

    await expect(publisher.publish({
      ...input,
      expectedRevision: ready.revision - 1,
      idempotencyKey: 'publish-stale-new-key',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
    expect(submitImportOnce).not.toHaveBeenCalled();
    await expect(publisher.publish(input)).resolves.toMatchObject({ state: 'SUBMITTED' });
    compile.mockRejectedValueOnce(new Error('mutable catalog became unavailable'));
    await expect(publisher.publish(input)).resolves.toMatchObject({ state: 'SUBMITTED' });
    expect(submitImportOnce).toHaveBeenCalledTimes(1);
    expect(attempts.claimSubmission).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect((await workflow.getDraft({ draftId: ready.id, ownerUserId: 'owner-1' })).revision)
      .toBe(ready.revision + 1);
  });

  it('reloads when another instance owns the submission claim', async () => {
    const { publisher, submitImportOnce, repository } = build({ claim: null });

    await expect(publisher.publish(publishInput)).resolves.toMatchObject({ state: 'PREPARED' });
    expect(repository.getOwned).toHaveBeenCalled();
    expect(submitImportOnce).not.toHaveBeenCalled();
  });

  it('records a network failure as UNKNOWN without retrying', async () => {
    const { publisher, submitImportOnce, repository } = build({
      submit: async () => { throw new OzonNetworkError('/v3/product/import', new Error('reset'), 20_000); },
    });

    await expect(publisher.publish(publishInput)).resolves.toMatchObject({ state: 'UNKNOWN' });
    expect(submitImportOnce).toHaveBeenCalledTimes(1);
    expect(repository.completeSubmission).toHaveBeenCalledWith(expect.objectContaining({
      outcome: expect.objectContaining({ kind: 'UNKNOWN' }),
    }));
  });

  it('heartbeats the submission lease only while the external request is in flight', async () => {
    vi.useFakeTimers();
    try {
      let markStarted!: () => void;
      let finishRequest!: (value: unknown) => void;
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const request = new Promise<unknown>((resolve) => { finishRequest = resolve; });
      const built = build({
        submit: async () => {
          markStarted();
          return request;
        },
      });

      const publishing = built.publisher.publish(publishInput);
      await started;
      await vi.advanceTimersByTimeAsync(20_000);

      expect(built.repository.heartbeat).toHaveBeenCalledWith({
        attemptId: 'attempt-1',
        workerId: 'api-1',
        leaseToken: 'lease-1',
        leaseEpoch: 1,
        leaseMs: 60_000,
      });
      const heartbeatCount = vi.mocked(built.repository.heartbeat).mock.calls.length;

      finishRequest({ result: { task_id: 123 } });
      await expect(publishing).resolves.toMatchObject({ state: 'SUBMITTED' });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(built.repository.heartbeat).toHaveBeenCalledTimes(heartbeatCount);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers a trusted task acknowledgement after losing the submission lease', async () => {
    const warn = vi.fn();
    const built = build();
    const recovered = attempt({
      state: 'SUBMITTED',
      reconciliationState: 'PENDING',
      ozonTaskId: '123',
      acceptanceSource: 'RECOVERED_TASK_RESPONSE',
      nextReconcileAt: '2026-07-15T08:01:00.000Z',
    });
    vi.mocked(built.repository.completeSubmission).mockRejectedValueOnce(
      new OzonPublishAttemptError('LEASE_LOST', 'submission lease expired'),
    );
    vi.mocked(built.repository.recoverSubmissionAcknowledgement).mockResolvedValueOnce(recovered);
    const publisher = createOzonListingPublisher({
      workflow: built.workflow,
      attempts: built.repository,
      compile: built.compile,
      submitImportOnce: built.submitImportOnce,
      authorizeDraftMediaPublish: built.authorizeDraftMediaPublish,
      workerId: 'api-1',
      leaseMs: 60_000,
      warn,
    });

    await expect(publisher.publish(publishInput)).resolves.toBe(recovered);
    expect(built.repository.recoverSubmissionAcknowledgement).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      workerId: 'api-1',
      leaseToken: 'lease-1',
      leaseEpoch: 1,
      taskId: '123',
      response: { result: { task_id: 123 } },
    });
    expect(built.repository.getOwned).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('recovering its acknowledgement'),
      expect.objectContaining({ code: 'LEASE_LOST' }),
    );
  });

  it('retries an idempotent acknowledgement recovery after a transient database failure', async () => {
    const warn = vi.fn();
    const sleep = vi.fn(async () => {});
    const built = build();
    const recovered = attempt({
      state: 'SUBMITTED', reconciliationState: 'PENDING', ozonTaskId: '123',
      acceptanceSource: 'RECOVERED_TASK_RESPONSE',
    });
    vi.mocked(built.repository.completeSubmission).mockRejectedValueOnce(
      new Error('database connection reset after Ozon acknowledgement'),
    );
    vi.mocked(built.repository.recoverSubmissionAcknowledgement)
      .mockRejectedValueOnce(new Error('database still unavailable'))
      .mockResolvedValueOnce(recovered);
    const publisher = createOzonListingPublisher({
      workflow: built.workflow,
      attempts: built.repository,
      compile: built.compile,
      submitImportOnce: built.submitImportOnce,
      authorizeDraftMediaPublish: built.authorizeDraftMediaPublish,
      workerId: 'api-1',
      leaseMs: 60_000,
      acknowledgementRecoveryAttempts: 3,
      sleep,
      warn,
    });

    await expect(publisher.publish(publishInput)).resolves.toBe(recovered);
    expect(built.repository.recoverSubmissionAcknowledgement).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Ozon task 123'),
      expect.any(Error),
    );
  });

  it('never returns an unacknowledged state after trusted task recovery is rejected', async () => {
    const warn = vi.fn();
    const built = build();
    vi.mocked(built.repository.completeSubmission).mockRejectedValueOnce(
      new OzonPublishAttemptError('LEASE_LOST', 'submission lease expired'),
    );
    vi.mocked(built.repository.recoverSubmissionAcknowledgement).mockRejectedValueOnce(
      new OzonPublishAttemptError('LEASE_LOST', 'original submission claim was not found'),
    );
    const publisher = createOzonListingPublisher({
      workflow: built.workflow,
      attempts: built.repository,
      compile: built.compile,
      submitImportOnce: built.submitImportOnce,
      authorizeDraftMediaPublish: built.authorizeDraftMediaPublish,
      workerId: 'api-1',
      leaseMs: 60_000,
      warn,
    });

    await expect(publisher.publish(publishInput)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(built.repository.recoverSubmissionAcknowledgement).toHaveBeenCalledTimes(1);
    expect(built.repository.getOwned).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL: Ozon task 123'),
      expect.objectContaining({ code: 'LEASE_LOST' }),
    );
  });

  it('delegates audited unknown resolution for the owner only', async () => {
    const built = build();
    const input = {
      attemptId: 'attempt-1',
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedStateVersion: 4,
      resolution: {
        decision: 'NOT_SUBMITTED' as const,
        note: 'No matching task exists',
        evidence: { source: 'operator-task-log' },
      },
    };

    await expect(built.publisher.resolveAttempt(input)).resolves.toMatchObject({ state: 'REJECTED' });
    expect(built.repository.resolveUnknown).toHaveBeenCalledWith(input);
    await expect(built.publisher.resolveAttempt({ ...input, actorUserId: 'staff-1' }))
      .rejects.toMatchObject({ code: 'OZON_PUBLISH_OWNER_REQUIRED', statusCode: 403 });
  });

  it.each([
    { status: 400, expected: 'REJECTED' },
    { status: 422, expected: 'REJECTED' },
    { status: 408, expected: 'UNKNOWN' },
    { status: 429, expected: 'UNKNOWN' },
    { status: 500, expected: 'UNKNOWN' },
  ] as const)('classifies Ozon HTTP $status as $expected', async ({ status, expected }) => {
    const { publisher } = build({
      submit: async () => { throw new OzonApiError(status, '{"message":"failed"}', '/v3/product/import'); },
    });

    await expect(publisher.publish(publishInput)).resolves.toMatchObject({ state: expected });
  });

  it.each([null, 0, -1, Number.MAX_SAFE_INTEGER + 1, 'not-a-task'])('records malformed task acknowledgement %j as UNKNOWN', async (taskId) => {
    const { publisher } = build({ submit: async () => ({ result: { task_id: taskId } }) });
    await expect(publisher.publish(publishInput)).resolves.toMatchObject({ state: 'UNKNOWN' });
  });

  it('rejects cross-owner invocation before compiling or recording intent', async () => {
    const { publisher, compile, workflow } = build();
    await expect(publisher.publish({ ...publishInput, actorUserId: 'staff-1' }))
      .rejects.toMatchObject({ code: 'OZON_PUBLISH_OWNER_REQUIRED', statusCode: 403 });
    expect(compile).not.toHaveBeenCalled();
    expect(workflow.recordPublishIntent).not.toHaveBeenCalled();
  });

  it('rejects a compiler result that is not bound to the exact draft state', async () => {
    const built = build();
    built.compile.mockResolvedValue({ ...compilation(built.current), draftStateHash: '0'.repeat(64) });
    await expect(built.publisher.publish(publishInput))
      .rejects.toMatchObject({ code: 'OZON_PUBLISH_COMPILE_STALE', statusCode: 409 });
    expect(built.workflow.recordPublishIntent).toHaveBeenCalledTimes(1);
  });
});
