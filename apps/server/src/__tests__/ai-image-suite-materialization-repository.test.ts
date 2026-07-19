import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageSuiteMaterializationRepository } from '../repositories/ai-image-suite-materialization-repository.js';
import {
  AI_IMAGE_SUITE_MATERIALIZATION_EVENT_VERSION,
  type MaterializeAiImageSuiteInput,
} from '../services/ai-image-suite-materialization.js';
import {
  AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION,
  AI_IMAGE_SUITE_PROMPT_SET_VERSION,
  AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
  AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
} from '../services/ai-image-suite-prompts.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const sourceCaptureHash = 'a'.repeat(64);
const sourceProfileHash = 'b'.repeat(64);
const assetSha256 = 'c'.repeat(64);
const providerConfigHash = 'd'.repeat(64);
const templateChecksum = 'e'.repeat(64);
const policyHash = 'f'.repeat(64);
const promptSetHash = '1'.repeat(64);
const referenceSetHash = '2'.repeat(64);
const assetBindingHash = '3'.repeat(64);

const input: MaterializeAiImageSuiteInput = {
  suiteId: 'suite-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  expectedRevision: 3,
  operationKey: 'materialize-operation-1',
};

function textHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function authorityFixture() {
  const slotSnapshot = {
    slotKey: 'sku:sku-1:hero',
    goal: 'sku_hero',
    ownership: { level: 'sku', key: 'sku-1' },
  };
  const referencesSnapshot = [{ candidateId: 'media-1' }];
  const templateSnapshot = {
    templateKey: 'image-suite-generation.base',
    releaseId: 'release-1',
    revisionId: 'revision-1',
    sequence: 1,
    checksum: templateChecksum,
    outputMode: 'media_candidate',
  };
  const variablesSnapshot = {
    slotSpecJson: '{"goal":"sku_hero"}',
    referenceManifestJson: '{"references":[{"ordinal":0}]}',
    verifiedFactsJson: '{"facts":["Product"]}',
    safetyConstraintsJson: '{"constraints":["preserve"]}',
  };
  const resolvedPrompt = 'Generate the frozen SKU hero.\n\nImmutable policy.';
  const resolvedNegativePrompt = 'No unsupported claims.\n\nImmutable policy.';
  const slotHash = hashAiMediaPlanningJson(slotSnapshot);
  const referencesHash = hashAiMediaPlanningJson(referencesSnapshot);
  const templateSnapshotHash = hashAiMediaPlanningJson(templateSnapshot);
  const promptCore = {
    version: AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    slotId: 'slot-1',
    ordinal: 0,
    slotKey: 'sku:sku-1:hero',
    slotHash,
    referencesHash,
    referenceSetHash,
    templateKey: 'image-suite-generation.base',
    templateReleaseId: 'release-1',
    templateRevisionId: 'revision-1',
    templateSequence: 1,
    templateChecksum,
    variablesSnapshot,
    variablesHash: hashAiMediaPlanningJson(variablesSnapshot),
    resolvedPrompt,
    resolvedNegativePrompt,
    compiledPromptHash: hashAiMediaPlanningJson({ resolvedPrompt, resolvedNegativePrompt }),
    resolvedPromptHash: textHash(resolvedPrompt),
    resolvedNegativePromptHash: textHash(resolvedNegativePrompt),
  };
  const prompt = {
    id: 'slot-prompt-1',
    promptSetId: 'prompt-set-1',
    ...promptCore,
    templateSnapshot,
    templateSnapshotHash,
    compilerVersion: AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION,
    policyVersion: AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
    policyHash,
    bindingHash: hashAiMediaPlanningJson({
      ...promptCore,
      templateSnapshotHash,
      compilerVersion: AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION,
      policyVersion: AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
      policyHash,
    }),
  };
  const promptSet = {
    id: 'prompt-set-1',
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    version: AI_IMAGE_SUITE_PROMPT_SET_VERSION,
    planId: 'plan-1',
    planVersionId: 'version-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    templateKey: prompt.templateKey,
    templateReleaseId: prompt.templateReleaseId,
    templateRevisionId: prompt.templateRevisionId,
    templateSequence: prompt.templateSequence,
    templateChecksum,
    templateSnapshot,
    templateSnapshotHash,
    compilerVersion: AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION,
    policyVersion: AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
    policyHash,
    planHash: '4'.repeat(64),
    provider: 'fake',
    model: 'fake-image-suite-v1',
    providerConfigHash,
    referenceSetHash,
    slotCount: 1,
    promptSetHash,
    slots: [prompt],
  };
  const slot: any = {
    id: 'slot-1',
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    ordinal: 0,
    slotKey: 'sku:sku-1:hero',
    goal: 'sku_hero',
    ownershipLevel: 'sku',
    ownershipKey: 'sku-1',
    compatibilityGroupKey: null,
    slotSnapshot,
    slotHash,
    referencesSnapshot,
    referencesHash,
    status: 'PLANNED',
    childWorkflowId: null,
    childWorkflow: null,
    prompt,
    attempt: 0,
    revision: 1,
    estimatedCostCents: 7,
    maximumCostCents: 11,
  };
  const referenceAsset = {
    id: 'suite-reference-1',
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    ordinal: 0,
    candidateId: 'media-1',
    assetId: 'asset-1',
    assetSha256,
    assetUrl: 'https://cdn.example/owner-1/product.png',
    mimeType: 'image/png',
    width: 900,
    height: 1200,
    bindingHash: assetBindingHash,
    asset: {
      id: 'asset-1',
      ownerUserId: 'owner-1',
      kind: 'SOURCE_ORIGINAL',
      sha256: assetSha256,
      url: 'https://cdn.example/owner-1/product.png',
      mimeType: 'image/png',
      width: 900,
      height: 1200,
    },
  };
  const events: any[] = [
    { revision: 1, eventType: 'CLAIMED', payload: { version: 'ai-image-suite-event/v1' } },
    {
      revision: 2,
      eventType: 'REFERENCES_INTERNALIZED',
      payload: {
        version: 'ai-image-suite-references-internalized/v1',
        referenceSetHash,
      },
    },
    {
      revision: 3,
      eventType: 'PROMPTS_FROZEN',
      payload: {
        version: 'ai-image-suite-prompts-frozen/v1',
        promptSetId: promptSet.id,
        promptSetHash,
        referenceSetHash,
      },
    },
  ];
  const suite: any = {
    id: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    planId: 'plan-1',
    planVersionId: 'version-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    contextType: 'collect',
    contextId: 'goods-1',
    status: 'PLANNED',
    revision: 3,
    provider: 'fake',
    model: 'fake-image-suite-v1',
    providerConfigHash,
    pricingVersion: 'fake-suite-pricing/v1',
    itemCount: 1,
    estimatedCostCents: 7,
    maximumCostCents: 11,
    slots: [slot],
    referenceAssets: [referenceAsset],
    promptSet,
    events,
    plan: {
      id: 'plan-1',
      ownerUserId: 'owner-1',
      sourceSubjectId: 'subject-1',
      contextType: 'collect',
      contextId: 'goods-1',
      reviewStatus: 'APPROVED',
      currentVersionId: 'version-1',
      approvedVersionId: 'version-1',
      staleAt: null,
    },
    planVersion: {
      id: 'version-1',
      planId: 'plan-1',
      ownerUserId: 'owner-1',
      sourceSubjectId: 'subject-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureHash,
      sourceProfileHash,
      sourceSchemaVersion: 'source-product-capture-v2',
      planHash: '4'.repeat(64),
    },
  };
  return { suite, slot, prompt, promptSet, events };
}

function clientFixture(options: {
  stale?: boolean;
  transactionFailure?: 'P2002' | 'P2034';
  activePlanConflict?: boolean;
} = {}) {
  const authority = authorityFixture();
  const { suite, slot, events } = authority;
  const eventByKey = new Map<string, any>();
  const latest = {
    id: options.stale ? 'snapshot-2' : 'snapshot-1',
    captureHash: options.stale ? '5'.repeat(64) : sourceCaptureHash,
    profileHash: options.stale ? '6'.repeat(64) : sourceProfileHash,
    schemaVersion: 'source-product-capture-v2',
  };
  let workflow: any = null;
  let workflowInputs: any[] = [];
  let job: any = null;
  let reservation: any = null;
  let workflowEvents: any[] = [];

  const hydrate = () => {
    if (!workflow || !slot.childWorkflowId) return;
    slot.childWorkflow = {
      ...workflow,
      inputs: workflowInputs,
      jobs: job ? [{ ...job, costReservation: reservation }] : [],
      events: workflowEvents,
    };
  };

  const tx: any = {
    aiMediaSuite: {
      findFirst: vi.fn(async ({ where }: any) => {
        hydrate();
        if (where.id === suite.id && where.ownerUserId === suite.ownerUserId) return suite;
        if (options.activePlanConflict
          && where.planId === suite.planId
          && where.ownerUserId === suite.ownerUserId
          && where.id?.not === suite.id) {
          return {
            id: 'suite-other-version',
            planId: suite.planId,
            planVersionId: 'version-2',
            ownerUserId: suite.ownerUserId,
            status: 'RUNNING',
            revision: 5,
          };
        }
        return null;
      }),
      updateMany: vi.fn(async ({ where }: any) => {
        if (where.id !== suite.id
          || where.ownerUserId !== suite.ownerUserId
          || where.revision !== suite.revision
          || where.status !== suite.status
          || where.planId !== suite.planId
          || where.planVersionId !== suite.planVersionId
          || where.sourceCaptureSnapshotId !== suite.sourceCaptureSnapshotId
          || where.providerConfigHash !== suite.providerConfigHash) return { count: 0 };
        if (options.activePlanConflict) {
          throw Object.assign(new Error(
            'Unique constraint failed on ai_media_suite_plan_active_key',
          ), { code: 'P2002' });
        }
        suite.revision += 1;
        return { count: 1 };
      }),
    },
    sourceCaptureSubject: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === suite.sourceSubjectId
          && where.ownerUserId === suite.ownerUserId
          && where.legacySupplyGoodsId === suite.contextId
          && where.legacySupplyGoods.userId === suite.ownerUserId
          ? { snapshots: [latest] }
          : null
      )),
    },
    aiMediaWorkflow: {
      create: vi.fn(async ({ data }: any) => {
        workflow = { id: 'workflow-1', ...data };
        return workflow;
      }),
    },
    aiMediaWorkflowInput: {
      createMany: vi.fn(async ({ data }: any) => {
        workflowInputs = data.map((row: any, index: number) => ({
          id: `workflow-input-${index + 1}`,
          ...row,
        }));
        return { count: data.length };
      }),
    },
    aiImageJob: {
      create: vi.fn(async ({ data }: any) => {
        job = { id: 'job-1', ...data };
        return job;
      }),
    },
    aiCostReservation: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.ai_cost_reservation_owner_idempotency;
        return reservation
          && key
          && key.ownerUserId === reservation.ownerUserId
          && key.idempotencyKey === reservation.idempotencyKey
          ? { ...reservation, settlements: [] }
          : null;
      }),
      create: vi.fn(async ({ data }: any) => {
        reservation = { id: 'reservation-1', ...data };
        return reservation;
      }),
    },
    aiMediaWorkflowEvent: {
      create: vi.fn(async ({ data }: any) => {
        const event = { id: 'workflow-event-1', ...data };
        workflowEvents = [event];
        return event;
      }),
    },
    aiMediaSuiteSlot: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== slot.id
          || where.suiteId !== suite.id
          || where.ownerUserId !== suite.ownerUserId
          || where.status !== slot.status
          || where.childWorkflowId !== slot.childWorkflowId
          || where.attempt !== slot.attempt
          || where.revision !== slot.revision) return { count: 0 };
        slot.childWorkflowId = data.childWorkflowId;
        slot.attempt = data.attempt;
        slot.revision += data.revision.increment;
        hydrate();
        return { count: 1 };
      }),
    },
    aiMediaSuiteEvent: {
      findUnique: vi.fn(async ({ where }: any) => eventByKey.get(where.eventKey) || null),
      findFirst: vi.fn(async ({ where }: any) => events.find((event) => (
        event.suiteId === where.suiteId
          && event.ownerUserId === where.ownerUserId
          && event.revision === where.revision
          && event.eventType === where.eventType
      )) || null),
      create: vi.fn(async ({ data }: any) => {
        const event = { id: 'materialization-event-1', ...data };
        events.push(event);
        eventByKey.set(data.eventKey, event);
        return event;
      }),
    },
  };
  let failOnce = options.transactionFailure;
  const client: any = {
    ...tx,
    $transaction: vi.fn(async (
      action: (transaction: any) => Promise<unknown>,
      settings: unknown,
    ) => {
      expect(settings).toEqual({ isolationLevel: 'Serializable' });
      const result = await action(tx);
      if (failOnce) {
        const code = failOnce;
        failOnce = undefined;
        throw Object.assign(new Error(code), { code });
      }
      return result;
    }),
  };
  return {
    ...authority,
    latest,
    tx,
    client,
    get workflow() { return workflow; },
    get workflowInputs() { return workflowInputs; },
    get job() { return job; },
    get reservation() { return reservation; },
  };
}

function expectNoWrites(fixture: ReturnType<typeof clientFixture>): void {
  expect(fixture.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();
  expect(fixture.tx.aiMediaWorkflow.create).not.toHaveBeenCalled();
  expect(fixture.tx.aiMediaWorkflowInput.createMany).not.toHaveBeenCalled();
  expect(fixture.tx.aiImageJob.create).not.toHaveBeenCalled();
  expect(fixture.tx.aiCostReservation.create).not.toHaveBeenCalled();
  expect(fixture.tx.aiMediaWorkflowEvent.create).not.toHaveBeenCalled();
  expect(fixture.tx.aiMediaSuiteSlot.updateMany).not.toHaveBeenCalled();
  expect(fixture.tx.aiMediaSuiteEvent.create).not.toHaveBeenCalled();
}

describe('Prisma AI image suite materialization repository', () => {
  it('atomically writes one frozen child graph and rev4 audit event without dispatching work', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);

    await expect(repository.materialize(input)).resolves.toMatchObject({
      kind: 'committed',
      suiteId: 'suite-1',
      revision: 4,
      childCount: 1,
      estimatedCostCents: 7,
      maximumCostCents: 11,
      children: [{ ordinal: 0, slotKey: 'sku:sku-1:hero', childWorkflowId: 'workflow-1' }],
    });

    expect(fixture.client.$transaction).toHaveBeenCalledTimes(1);
    expect(fixture.tx.aiMediaWorkflow.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'IMAGE_TO_IMAGE',
        status: 'QUEUED',
        reviewStatus: 'NOT_READY',
        contextSkuKey: 'sku-1',
        contextSlotKey: 'sku:sku-1:hero',
      }),
    });
    expect(fixture.tx.aiMediaWorkflowInput.createMany).toHaveBeenCalledWith({
      data: [{
        workflowId: 'workflow-1',
        ownerUserId: 'owner-1',
        assetId: 'asset-1',
        role: 'REFERENCE',
        ordinal: 0,
        assetSha256,
        assetUrl: 'https://cdn.example/owner-1/product.png',
        mimeType: 'image/png',
        width: 900,
        height: 1200,
      }],
    });
    expect(fixture.tx.aiImageJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'workflow-1',
        status: 'PENDING',
        operation: 'IMAGE_TO_IMAGE',
        prompt: fixture.prompt.resolvedPrompt,
        negativePrompt: fixture.prompt.resolvedNegativePrompt,
        maxAttempts: 1,
        requestedImageCount: 1,
        width: 900,
        height: 1200,
      }),
    });
    expect(fixture.tx.aiCostReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workflowId: 'workflow-1',
        jobId: 'job-1',
        status: 'RESERVED',
        estimatedCostMinor: 7,
        maximumCostMinor: 11,
      }),
    });
    expect(fixture.tx.aiMediaSuiteSlot.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'slot-1',
        childWorkflowId: null,
        attempt: 0,
        revision: 1,
      }),
      data: { childWorkflowId: 'workflow-1', attempt: 1, revision: { increment: 1 } },
    });
    expect(fixture.tx.aiMediaSuiteEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        suiteId: 'suite-1',
        revision: 4,
        eventType: 'CHILDREN_MATERIALIZED',
        payload: expect.objectContaining({
          version: AI_IMAGE_SUITE_MATERIALIZATION_EVENT_VERSION,
          actorUserId: 'actor-1',
          childCount: 1,
          estimatedCostCents: 7,
          maximumCostCents: 11,
          children: [expect.objectContaining({
            slotId: 'slot-1',
            childWorkflowId: 'workflow-1',
            jobId: 'job-1',
            reservationId: 'reservation-1',
            promptBindingHash: fixture.prompt.bindingHash,
          })],
        }),
      }),
    });
    expect(fixture.job.status).toBe('PENDING');
    expect(fixture.job.providerDispatchedAt).toBeUndefined();
    expect(fixture.tx).not.toHaveProperty('queue');
    expect(fixture.tx).not.toHaveProperty('provider');
  });

  it.each([
    ['stale source authority', () => clientFixture({ stale: true }), 'stale'],
    ['invalid frozen Prompt authority', () => {
      const fixture = clientFixture();
      fixture.prompt.resolvedPromptHash = '9'.repeat(64);
      return fixture;
    }, 'prompts-not-ready'],
  ] as const)('rejects %s before any write', async (_label, makeFixture, expectedKind) => {
    const fixture = makeFixture();
    const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);

    await expect(repository.materialize(input)).resolves.toEqual({ kind: expectedKind });
    expectNoWrites(fixture);
  });

  it('returns an exact replay before consulting mutable source authority or writing again', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);
    await expect(repository.materialize(input)).resolves.toMatchObject({ kind: 'committed' });
    const writeCounts = {
      suites: fixture.tx.aiMediaSuite.updateMany.mock.calls.length,
      workflows: fixture.tx.aiMediaWorkflow.create.mock.calls.length,
      jobs: fixture.tx.aiImageJob.create.mock.calls.length,
      reservations: fixture.tx.aiCostReservation.create.mock.calls.length,
      events: fixture.tx.aiMediaSuiteEvent.create.mock.calls.length,
    };
    fixture.suite.plan.staleAt = new Date();
    fixture.latest.id = 'snapshot-2';
    fixture.suite.revision = 5;
    fixture.suite.status = 'RUNNING';
    fixture.slot.status = 'RUNNING';
    fixture.slot.attempt = 2;
    fixture.slot.revision = 3;
    fixture.workflow.status = 'RUNNING';
    fixture.workflow.revision = 2;
    fixture.workflow.currentAttempt = 2;
    fixture.job.status = 'PROCESSING';
    fixture.reservation.status = 'SETTLED';
    fixture.tx.sourceCaptureSubject.findFirst.mockImplementation(async () => {
      throw new Error('mutable source authority must not be read during exact replay');
    });

    await expect(repository.materialize(input)).resolves.toMatchObject({
      kind: 'existing',
      suiteId: 'suite-1',
      revision: 4,
      childCount: 1,
      children: [{ childWorkflowId: 'workflow-1' }],
    });
    expect(fixture.tx.aiMediaSuite.updateMany).toHaveBeenCalledTimes(writeCounts.suites);
    expect(fixture.tx.aiMediaWorkflow.create).toHaveBeenCalledTimes(writeCounts.workflows);
    expect(fixture.tx.aiImageJob.create).toHaveBeenCalledTimes(writeCounts.jobs);
    expect(fixture.tx.aiCostReservation.create).toHaveBeenCalledTimes(writeCounts.reservations);
    expect(fixture.tx.aiMediaSuiteEvent.create).toHaveBeenCalledTimes(writeCounts.events);
    expect(fixture.tx.sourceCaptureSubject.findFirst).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['actor', (payload: any) => { payload.actorUserId = 'other-actor'; }],
    ['provider', (payload: any) => { payload.provider = 'other-provider'; }],
    ['output dimensions', (payload: any) => { payload.width = 1_024; }],
    ['child binding', (payload: any) => { payload.children[0].bindingHash = '9'.repeat(64); }],
  ] as const)('rejects an exact replay whose immutable %s event core was tampered', async (_label, tamper) => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);
    await expect(repository.materialize(input)).resolves.toMatchObject({ kind: 'committed' });
    const event = fixture.events.find((candidate: any) => candidate.eventType === 'CHILDREN_MATERIALIZED');
    tamper(event.payload);
    event.payloadHash = hashAiMediaPlanningJson(event.payload);

    await expect(repository.findReplay(input)).resolves.toEqual({ kind: 'conflict' });
  });

  it('maps a slot CAS loss to a typed conflict after rolling back the child graph', async () => {
    const fixture = clientFixture();
    fixture.tx.aiMediaSuiteSlot.updateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);

    await expect(repository.materialize(input)).resolves.toEqual({ kind: 'conflict' });
  });

  it('maps the plan-level partial unique index winner to a recoverable active-suite conflict', async () => {
    const fixture = clientFixture({ activePlanConflict: true });
    const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);

    await expect(repository.materialize(input)).resolves.toEqual({
      kind: 'active-suite-conflict',
    });
    expect(fixture.tx.aiMediaSuite.updateMany).toHaveBeenCalledOnce();
    expect(fixture.tx.aiMediaWorkflow.create).not.toHaveBeenCalled();
    expect(fixture.tx.aiImageJob.create).not.toHaveBeenCalled();
    expect(fixture.tx.aiCostReservation.create).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2034'] as const)(
    'recovers the exact committed winner after a %s race',
    async (code) => {
      const fixture = clientFixture({ transactionFailure: code });
      const repository = new PrismaAiImageSuiteMaterializationRepository(fixture.client);

      await expect(repository.materialize(input)).resolves.toMatchObject({
        kind: 'existing',
        suiteId: 'suite-1',
        revision: 4,
        childCount: 1,
        children: [{ childWorkflowId: 'workflow-1' }],
      });
      expect(fixture.tx.aiMediaWorkflow.create).toHaveBeenCalledTimes(1);
      expect(fixture.tx.aiImageJob.create).toHaveBeenCalledTimes(1);
      expect(fixture.tx.aiCostReservation.create).toHaveBeenCalledTimes(1);
      expect(fixture.tx.aiMediaSuiteEvent.create).toHaveBeenCalledTimes(1);
    },
  );
});
