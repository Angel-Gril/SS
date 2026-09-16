import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageSuitePromptRepository } from '../repositories/ai-image-suite-prompt-repository.js';
import {
  AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION,
  AI_IMAGE_SUITE_PROMPT_SET_VERSION,
  AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
  AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
  type CommitAiImageSuitePromptSetInput,
} from '../services/ai-image-suite-prompts.js';
import { AI_IMAGE_SUITE_REFERENCE_SET_VERSION } from '../services/ai-image-suite-references.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const sourceCaptureHash = 'a'.repeat(64);
const sourceProfileHash = 'b'.repeat(64);
const rawSourceSha256 = 'c'.repeat(64);
const assetSha256 = 'd'.repeat(64);
const providerConfigHash = 'e'.repeat(64);
const planHash = 'f'.repeat(64);
const templateChecksum = '1'.repeat(64);
const policyHash = '2'.repeat(64);
const sourceUrl = 'https://source.example/product.png';
const assetUrl = 'https://cdn.example/owner-1/product.png';

function frozenReference() {
  return {
    candidateId: 'media-1',
    evidenceIds: ['evidence:media-1'],
    source: {
      url: sourceUrl,
      width: 900,
      height: 1200,
      mimeType: 'image/png',
      role: 'product_main',
      skuKeys: ['sku-1'],
      contentHash: rawSourceSha256,
    },
  };
}

function slotSnapshot() {
  return {
    slotKey: 'sku:sku-1:hero',
    goal: 'sku_hero',
    aspectRatio: '3:4',
    ownership: { level: 'sku', key: 'sku-1' },
    references: [{ candidateId: 'media-1', evidenceIds: ['evidence:media-1'] }],
    factEvidenceIds: ['evidence:title'],
    safetyConstraints: ['preserve_product_identity'],
    acceptanceChecks: ['aspect_ratio_3_4'],
  };
}

function referenceRow() {
  const immutable = {
    version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    ordinal: 0,
    candidateId: 'media-1',
    assetId: 'asset-1',
    frozenSourceUrl: sourceUrl,
    expectedContentHash: rawSourceSha256,
    assetSha256,
    rawSourceSha256,
    assetUrl,
    storageBackend: 'oss',
    storageKey: 'owner-1/product.png',
    mimeType: 'image/png',
    sizeBytes: 1234,
    width: 900,
    height: 1200,
  };
  return { id: 'reference-1', ...immutable, bindingHash: hashAiMediaPlanningJson(immutable) };
}

function referenceSetHash() {
  const row = referenceRow();
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    bindings: [{
      ordinal: row.ordinal,
      candidateId: row.candidateId,
      sourceMediaKey: row.candidateId,
      sourceUrl: row.frozenSourceUrl,
      expectedContentHash: row.expectedContentHash,
      sourceSha256: row.rawSourceSha256,
      assetId: row.assetId,
      assetSha256: row.assetSha256,
      assetUrl: row.assetUrl,
      storageBackend: row.storageBackend,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
    }],
  });
}

function suiteRow(overrides: Record<string, unknown> = {}) {
  const snapshot = slotSnapshot();
  const references = [frozenReference()];
  const slot = {
    id: 'slot-1',
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    ordinal: 0,
    slotKey: snapshot.slotKey,
    goal: snapshot.goal,
    ownershipLevel: 'sku',
    ownershipKey: 'sku-1',
    compatibilityGroupKey: null,
    slotSnapshot: snapshot,
    slotHash: hashAiMediaPlanningJson(snapshot),
    referencesSnapshot: references,
    referencesHash: hashAiMediaPlanningJson(references),
    status: 'PLANNED',
    childWorkflowId: null,
    attempt: 0,
    revision: 1,
  };
  const claimPayload = {
    version: 'ai-image-suite-event/v1',
    planId: 'plan-1',
    planVersionId: 'version-1',
    previewHash: '3'.repeat(64),
    itemCount: 1,
    maximumCostCents: 0,
    slotHashes: [slot.slotHash],
  };
  const referencesPayload = {
    version: 'ai-image-suite-references-internalized/v1',
    operationKey: 'references-operation-1',
    requestFingerprint: '4'.repeat(64),
    commitFingerprint: '5'.repeat(64),
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    referenceSetHash: referenceSetHash(),
    referenceCount: 1,
  };
  return {
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
    revision: 2,
    provider: 'fake',
    model: 'fake-image-suite-v1',
    providerConfigHash,
    previewHash: claimPayload.previewHash,
    itemCount: 1,
    slots: [slot],
    referenceAssets: [referenceRow()],
    events: [
      {
        id: 'claim-event-1', suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        revision: 1, eventType: 'CLAIMED', payload: claimPayload,
        payloadHash: hashAiMediaPlanningJson(claimPayload),
      },
      {
        id: 'references-event-1', suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        revision: 2, eventType: 'REFERENCES_INTERNALIZED', payload: referencesPayload,
        payloadHash: hashAiMediaPlanningJson(referencesPayload),
      },
    ],
    plan: {
      id: 'plan-1', ownerUserId: 'owner-1', sourceSubjectId: 'subject-1', contextType: 'collect',
      contextId: 'goods-1', reviewStatus: 'APPROVED', currentVersionId: 'version-1',
      approvedVersionId: 'version-1', reviewedByUserId: 'actor-1', reviewedAt: new Date(), staleAt: null,
    },
    planVersion: {
      id: 'version-1', planId: 'plan-1', ownerUserId: 'owner-1', sourceSubjectId: 'subject-1',
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash, sourceProfileHash,
      sourceSchemaVersion: 'source-product-capture-v2', planHash,
      planPayload: {
        compatibilityGroups: [],
        verifiedFacts: [{ path: 'facts.title', value: 'Product', evidenceIds: ['evidence:title'], skuKeys: ['sku-1'] }],
      },
    },
    sourceCaptureSnapshot: {
      id: 'snapshot-1', subjectId: 'subject-1', captureHash: sourceCaptureHash,
      profileHash: sourceProfileHash, schemaVersion: 'source-product-capture-v2',
      subject: { ownerUserId: 'owner-1' },
    },
    ...overrides,
  };
}

function textHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function commitInput(overrides: Partial<CommitAiImageSuitePromptSetInput> = {}, wanx = false): CommitAiImageSuitePromptSetInput {
  const templateKey = wanx ? 'ai_media_suite_generation_wanx' : 'image-suite-generation.base';
  const compilerVersion = wanx ? 'ai-image-suite-prompt-compiler-wanx/v1' as const : AI_IMAGE_SUITE_PROMPT_COMPILER_VERSION;
  const provider = wanx ? 'dashscope-wanx' : 'fake';
  const model = wanx ? 'wanx2.1-imageedit' : 'fake-image-suite-v1';
  const variablesSnapshot = {
    slotSpecJson: '{"goal":"sku_hero"}',
    referenceManifestJson: '{"references":["media-1"]}',
    verifiedFactsJson: '{"facts":["Product"]}',
    safetyConstraintsJson: '{"constraints":["preserve"]}',
  };
  const resolvedPrompt = 'Generate an exact SKU hero.\n\nImmutable policy.';
  const resolvedNegativePrompt = wanx ? '' : 'No unsupported claims.\n\nImmutable policy.';
  const templateSnapshot = {
    templateKey,
    releaseId: 'release-1',
    revisionId: 'revision-1',
    sequence: 1,
    checksum: templateChecksum,
    outputMode: 'media_candidate',
  };
  const templateSnapshotHash = hashAiMediaPlanningJson(templateSnapshot);
  const core = {
    version: AI_IMAGE_SUITE_SLOT_PROMPT_VERSION,
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    slotId: 'slot-1',
    ordinal: 0,
    slotKey: 'sku:sku-1:hero',
    slotHash: suiteRow().slots[0]!.slotHash,
    referencesHash: suiteRow().slots[0]!.referencesHash,
    referenceSetHash: referenceSetHash(),
    templateKey,
    templateReleaseId: 'release-1',
    templateRevisionId: 'revision-1',
    templateSequence: 1,
    templateChecksum,
    variablesSnapshot,
    variablesHash: hashAiMediaPlanningJson(variablesSnapshot),
    resolvedPrompt,
    resolvedNegativePrompt,
    resolvedPromptHash: textHash(resolvedPrompt),
    resolvedNegativePromptHash: textHash(resolvedNegativePrompt),
    compiledPromptHash: hashAiMediaPlanningJson({ resolvedPrompt, resolvedNegativePrompt }),
  } as const;
  const prompt = {
    ...core,
    bindingHash: hashAiMediaPlanningJson({
      ...core,
      templateSnapshotHash,
      compilerVersion,
      policyVersion: AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
      policyHash,
    }),
  };
  const setCore = {
    version: AI_IMAGE_SUITE_PROMPT_SET_VERSION,
    compilerVersion,
    policyVersion: AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
    policyHash,
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    planId: 'plan-1',
    planVersionId: 'version-1',
    planHash,
    provider,
    model,
    providerConfigHash,
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    referenceSetHash: referenceSetHash(),
    templateKey,
    templateReleaseId: 'release-1',
    templateRevisionId: 'revision-1',
    templateSequence: 1,
    templateChecksum,
    templateSnapshotHash,
    promptBindingHashes: [prompt.bindingHash],
  };
  return {
    promptSetVersion: AI_IMAGE_SUITE_PROMPT_SET_VERSION,
    compilerVersion,
    policyVersion: AI_IMAGE_SUITE_SLOT_POLICY_VERSION,
    policyHash,
    suiteId: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    expectedRevision: 2,
    operationKey: 'suite-prompts-operation-1',
    requestFingerprint: hashAiMediaPlanningJson({
      version: 'ai-image-suite-prompt-freeze-request/v1', suiteId: 'suite-1', ownerUserId: 'owner-1',
      actorUserId: 'actor-1', expectedRevision: 2, operationKey: 'suite-prompts-operation-1',
    }),
    planId: 'plan-1',
    planVersionId: 'version-1',
    planHash,
    provider,
    model,
    providerConfigHash,
    sourceSubjectId: 'subject-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash,
    sourceProfileHash,
    sourceSchemaVersion: 'source-product-capture-v2',
    referenceSetHash: referenceSetHash(),
    templateKey,
    templateReleaseId: 'release-1',
    templateRevisionId: 'revision-1',
    templateSequence: 1,
    templateChecksum,
    templateSnapshot,
    templateSnapshotHash,
    promptSetHash: hashAiMediaPlanningJson(setCore),
    prompts: [prompt],
    ...overrides,
  };
}

function clientFixture(options: { latestId?: string; transactionFailure?: string } = {}) {
  const suite: any = suiteRow();
  const events = new Map<string, any>();
  let promptSet: any = null;
  let slotPrompts: any[] = [];
  const latest = {
    id: options.latestId || 'snapshot-1',
    captureHash: options.latestId ? '6'.repeat(64) : sourceCaptureHash,
    profileHash: options.latestId ? '7'.repeat(64) : sourceProfileHash,
    schemaVersion: 'source-product-capture-v2',
  };
  const tx: any = {
    aiMediaSuite: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === suite.id && where.ownerUserId === suite.ownerUserId ? suite : null
      )),
      updateMany: vi.fn(async ({ where }: any) => {
        if (where.id !== suite.id || where.ownerUserId !== suite.ownerUserId
          || where.revision !== suite.revision || where.status !== suite.status) return { count: 0 };
        suite.revision += 1;
        return { count: 1 };
      }),
    },
    sourceCaptureSubject: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === suite.sourceSubjectId && where.ownerUserId === suite.ownerUserId
          && where.legacySupplyGoodsId === suite.contextId
          && where.legacySupplyGoods.userId === suite.ownerUserId
          ? { snapshots: [latest] }
          : null
      )),
    },
    aiPromptRelease: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === 'release-1' && where.templateKey === 'image-suite-generation.base'
          ? { id: 'release-1', templateKey: 'image-suite-generation.base', revisionId: 'revision-1', sequence: 1 }
          : null
      )),
    },
    aiPromptRevision: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === 'revision-1' && where.templateKey === 'image-suite-generation.base'
          ? { id: 'revision-1', templateKey: 'image-suite-generation.base', status: 'PUBLISHED', checksum: templateChecksum }
          : null
      )),
    },
    aiMediaSuitePromptSet: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (!promptSet || promptSet.suiteId !== where.suiteId || promptSet.ownerUserId !== where.ownerUserId) return null;
        return { ...promptSet, slots: slotPrompts };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (!promptSet) return null;
        if (where.ai_media_suite_prompt_set_owner_operation_key) {
          const key = where.ai_media_suite_prompt_set_owner_operation_key;
          return promptSet.ownerUserId === key.ownerUserId && promptSet.operationKey === key.operationKey
            ? { ...promptSet, slots: slotPrompts }
            : null;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: any) => {
        promptSet = { id: 'prompt-set-1', ...data };
        return promptSet;
      }),
    },
    aiMediaSuiteSlotPrompt: {
      findMany: vi.fn(async () => slotPrompts),
      createMany: vi.fn(async ({ data }: any) => {
        slotPrompts = data.map((row: any, index: number) => ({ id: `slot-prompt-${index + 1}`, ...row }));
        return { count: data.length };
      }),
    },
    aiMediaSuiteEvent: {
      findUnique: vi.fn(async ({ where }: any) => events.get(where.eventKey) || null),
      findFirst: vi.fn(async ({ where }: any) => (
        [...events.values()].find((event) => event.suiteId === where.suiteId
          && event.ownerUserId === where.ownerUserId && event.eventType === where.eventType) || null
      )),
      create: vi.fn(async ({ data }: any) => {
        const event = { id: 'prompt-event-1', ...data };
        events.set(data.eventKey, event);
        return event;
      }),
    },
  };
  let failOnce = options.transactionFailure;
  const client: any = {
    ...tx,
    $transaction: vi.fn(async (action: (transaction: any) => Promise<unknown>, settings: unknown) => {
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
    suite, latest, tx, client, events,
    get promptSet() { return promptSet; },
    get slotPrompts() { return slotPrompts; },
  };
}

describe('Prisma AI image suite Prompt repository', () => {
  it('persists and replays the separately versioned Wanx compiler with its joined negative constraints', async () => {
    const fixture = clientFixture();
    const input = commitInput({}, true);
    Object.assign(fixture.suite, { provider: input.provider, model: input.model });
    fixture.tx.aiPromptRelease.findFirst.mockResolvedValue({ id: 'release-1', templateKey: input.templateKey, revisionId: 'revision-1', sequence: 1 });
    fixture.tx.aiPromptRevision.findFirst.mockResolvedValue({ id: 'revision-1', templateKey: input.templateKey, status: 'PUBLISHED', checksum: templateChecksum });
    const repository = new PrismaAiImageSuitePromptRepository(fixture.client);
    await expect(repository.commitPromptSet(input)).resolves.toMatchObject({ kind: 'committed', templateKey: 'ai_media_suite_generation_wanx' });
    await expect(repository.findCommitReplay({ suiteId: input.suiteId, ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId, expectedRevision: 2, operationKey: input.operationKey })).resolves.toMatchObject({ kind: 'existing' });
    expect(fixture.slotPrompts[0].resolvedNegativePrompt).toBe('');
  });

  it('loads only an owner-scoped approved/current rev2 authority with exact claim, references, and latest capture', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuitePromptRepository(fixture.client);

    await expect(repository.loadAuthority({ suiteId: 'suite-1', ownerUserId: 'owner-1' }))
      .resolves.toMatchObject({
        kind: 'ready',
        authority: {
          suiteId: 'suite-1', revision: 2, planHash, referenceSetHash: referenceSetHash(),
          slots: [{ id: 'slot-1', ordinal: 0 }],
          referenceAssets: [{ candidateId: 'media-1', assetId: 'asset-1' }],
          planPayload: expect.objectContaining({ verifiedFacts: expect.any(Array) }),
        },
      });
    expect(fixture.tx.aiMediaSuite.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'suite-1', ownerUserId: 'owner-1' },
      include: expect.objectContaining({
        plan: expect.any(Object), planVersion: expect.any(Object), sourceCaptureSnapshot: expect.any(Object),
        slots: { orderBy: { ordinal: 'asc' } },
        referenceAssets: { orderBy: { ordinal: 'asc' } },
      }),
    }));
    await expect(repository.loadAuthority({ suiteId: 'suite-1', ownerUserId: 'owner-2' }))
      .resolves.toEqual({ kind: 'not-found' });

    const stale = clientFixture({ latestId: 'snapshot-2' });
    await expect(new PrismaAiImageSuitePromptRepository(stale.client)
      .loadAuthority({ suiteId: 'suite-1', ownerUserId: 'owner-1' }))
      .resolves.toEqual({ kind: 'stale' });
  });

  it('atomically advances rev2 to rev3 and stores the exact Prompt set, slots, and event without child work', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuitePromptRepository(fixture.client);
    const input = commitInput();

    await expect(repository.commitPromptSet(input)).resolves.toEqual({
      kind: 'committed', promptSetHash: input.promptSetHash, promptCount: 1,
      templateKey: input.templateKey, templateReleaseId: input.templateReleaseId,
      templateSequence: input.templateSequence, templateChecksum: input.templateChecksum,
    });
    expect(fixture.suite.revision).toBe(3);
    expect(fixture.tx.aiMediaSuitePromptSet.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        operationKey: input.operationKey, requestFingerprint: input.requestFingerprint,
        promptSetHash: input.promptSetHash, slotCount: 1,
      }),
    });
    expect(fixture.tx.aiMediaSuiteSlotPrompt.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        promptSetId: 'prompt-set-1', slotId: 'slot-1', ordinal: 0,
        bindingHash: input.prompts[0]!.bindingHash,
        compiledPromptHash: input.prompts[0]!.compiledPromptHash,
      })],
    });
    expect(fixture.tx.aiMediaSuiteEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        revision: 3, eventType: 'PROMPTS_FROZEN',
        payload: expect.objectContaining({
          promptSetId: 'prompt-set-1', promptSetHash: input.promptSetHash,
          referenceSetHash: input.referenceSetHash,
          slotPromptHashes: [input.prompts[0]!.bindingHash],
        }),
      }),
    });
    expect(fixture.tx).not.toHaveProperty('aiMediaWorkflow');
    expect(fixture.tx).not.toHaveProperty('aiImageJob');
    expect(fixture.tx).not.toHaveProperty('aiCostReservation');
  });

  it('replays exact response loss before mutable authority and distinguishes actor/key conflicts', async () => {
    const fixture = clientFixture();
    const repository = new PrismaAiImageSuitePromptRepository(fixture.client);
    const input = commitInput();
    await repository.commitPromptSet(input);

    fixture.suite.plan.staleAt = new Date();
    fixture.latest.id = 'snapshot-2';
    fixture.tx.aiPromptRelease.findFirst.mockImplementation(async () => { throw new Error('must not resolve'); });
    await expect(repository.commitPromptSet(input)).resolves.toMatchObject({ kind: 'existing' });
    await expect(repository.findCommitReplay({
      suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 2, operationKey: input.operationKey,
    })).resolves.toMatchObject({ kind: 'existing', promptSetHash: input.promptSetHash });
    await expect(repository.findCommitReplay({
      suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-2',
      expectedRevision: 2, operationKey: input.operationKey,
    })).resolves.toEqual({ kind: 'conflict' });
    await expect(repository.findCommitReplay({
      suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 2, operationKey: 'suite-prompts-operation-2',
    })).resolves.toEqual({ kind: 'already-frozen' });
  });

  it('rejects stale, wrong-revision, forged Prompt, and mismatched release authority before persistence', async () => {
    const stale = clientFixture({ latestId: 'snapshot-2' });
    await expect(new PrismaAiImageSuitePromptRepository(stale.client).commitPromptSet(commitInput()))
      .resolves.toEqual({ kind: 'stale' });
    expect(stale.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();

    const revision = clientFixture();
    revision.suite.revision = 1;
    await expect(new PrismaAiImageSuitePromptRepository(revision.client).commitPromptSet(commitInput()))
      .resolves.toEqual({ kind: 'references-not-ready' });

    const forged = clientFixture();
    const bad = commitInput({ promptSetHash: '9'.repeat(64) });
    await expect(new PrismaAiImageSuitePromptRepository(forged.client).commitPromptSet(bad))
      .resolves.toEqual({ kind: 'conflict' });
    expect(forged.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();

    const release = clientFixture();
    release.tx.aiPromptRelease.findFirst.mockResolvedValue(null);
    await expect(new PrismaAiImageSuitePromptRepository(release.client).commitPromptSet(commitInput()))
      .resolves.toEqual({ kind: 'conflict' });
    expect(release.tx.aiMediaSuite.updateMany).not.toHaveBeenCalled();
  });

  it.each(['P2002', 'P2034'])('recovers an exact committed winner after %s', async (code) => {
    const fixture = clientFixture({ transactionFailure: code });
    const input = commitInput();
    await expect(new PrismaAiImageSuitePromptRepository(fixture.client).commitPromptSet(input))
      .resolves.toMatchObject({ kind: 'existing', promptSetHash: input.promptSetHash });
    expect(fixture.slotPrompts).toHaveLength(1);
  });
});
