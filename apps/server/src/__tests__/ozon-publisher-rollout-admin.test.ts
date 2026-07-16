import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  createOzonPublisherRolloutAdminService,
  type OzonPublisherRolloutAdminActor,
  type OzonPublisherRolloutAdminEvaluation,
  type OzonPublisherRolloutAdminGate,
  type OzonPublisherRolloutAdminRepository,
  type OzonPublisherRolloutAdminStageControl,
  type OzonPublisherRolloutAdminStageTransition,
  type OzonPublisherRolloutAdminTransition,
} from '../services/ozon-publisher-rollout-admin.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const NOW = '2026-07-16T12:00:00.000Z';

const ACTOR: OzonPublisherRolloutAdminActor = {
  actorUserId: 'super-admin-1',
  actorRole: 'ADMIN',
  isSuperAdmin: true,
  tokenUse: 'account_session',
};

const GATE: OzonPublisherRolloutAdminGate = {
  id: 'rollout-gate-1',
  writerEntrypoint: 'COLLECT_PUBLISH_OZON',
  originChannel: 'DIRECT',
  rolloutRevision: 'publisher-revision-1',
  recordContractVersion: 'ozon-publisher-rollout-gate/v2',
  evidencePolicyHash: HASH_A,
  authorizedControlConfigHash: HASH_B,
  guardContractVersion: 'ozon-publisher-rollout-guard/v1',
  denominatorEnforcedFrom: NOW,
  state: 'NOT_READY',
  stateVersion: 0,
  readyEvaluationId: null,
  evidenceHash: null,
  evaluationHash: null,
  approvedByUserId: null,
  approvedAt: null,
  approvalReason: null,
  revokedByUserId: null,
  revokedAt: null,
  revocationReason: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const EVALUATION: OzonPublisherRolloutAdminEvaluation = {
  id: 'rollout-evaluation-1',
  evaluationKey: HASH_C,
  gateId: GATE.id,
  writerEntrypoint: GATE.writerEntrypoint,
  originChannel: GATE.originChannel,
  rolloutRevision: GATE.rolloutRevision,
  recordContractVersion: 'ozon-publisher-rollout-evaluation/v3',
  evaluatorVersion: 'ozon-publisher-rollout-readiness/v1',
  evidencePolicyHash: HASH_A,
  authorizedEvidencePolicyHash: HASH_A,
  controlConfigHash: HASH_B,
  authorizedControlConfigHash: HASH_B,
  guardContractVersion: 'ozon-publisher-rollout-guard/v1',
  result: 'READY',
  evidenceHash: HASH_C,
  evaluationHash: HASH_D,
  windowStart: '2026-07-02T12:00:00.000Z',
  windowEnd: NOW,
  evaluatedAt: NOW,
  evidenceRetainedUntil: '2026-08-15T12:00:00.000Z',
  validUntil: NOW,
  actorUserId: ACTOR.actorUserId,
  criteria: {
    contractVersion: 'ozon-publisher-rollout-readiness/v1',
    windowDays: 14,
    minimumEligibleAttempts: 100,
    minimumLinkedObservations: 100,
    minimumDistinctScopes: 25,
    minimumActiveUtcDays: 7,
    maximumLatestAgeHours: 24,
    rollbackEvidenceDays: 30,
  },
  metrics: {
    eligibleAttemptCount: 100,
    linkedObservationCount: 100,
    missingObservationCount: 0,
    failedAttemptCount: 0,
    invalidEvidenceCount: 0,
    distinctScopeCount: 25,
    activeUtcDayCount: 7,
    latestEligibleAt: NOW,
    minimumEvidenceExpiresAt: '2026-08-15T12:00:00.000Z',
  },
  blockers: [],
};

const TRANSITION: OzonPublisherRolloutAdminTransition = {
  id: 'rollout-transition-1',
  gateId: GATE.id,
  transitionVersion: 1,
  expectedStateVersion: 0,
  action: 'APPROVE',
  fromState: 'NOT_READY',
  resultState: 'READY',
  evaluationId: EVALUATION.id,
  evidenceHashSnapshot: HASH_C,
  evaluationHashSnapshot: HASH_D,
  actorUserId: ACTOR.actorUserId,
  reason: 'Evidence reviewed for the controlled rollout.',
  decidedAt: NOW,
};

const STAGE: OzonPublisherRolloutAdminStageControl = {
  boundary: 'COLLECT_PUBLISH_OZON',
  configKey: 'source_ozon_publisher_collect_publish_stage',
  stage: 'shadow',
  revision: 1,
  updatedAt: NOW,
};

const STAGE_TRANSITION: OzonPublisherRolloutAdminStageTransition = {
  id: 'stage-transition-1',
  boundary: STAGE.boundary,
  configKey: STAGE.configKey,
  transitionVersion: 2,
  expectedRevision: 1,
  fromStage: 'shadow',
  resultStage: 'v2',
  gateId: GATE.id,
  rolloutRevisionSnapshot: GATE.rolloutRevision,
  gateStateVersionSnapshot: 1,
  evidenceHashSnapshot: HASH_C,
  evaluationHashSnapshot: HASH_D,
  actorUserId: ACTOR.actorUserId,
  reason: 'Promote the reviewed boundary.',
  decidedAt: NOW,
};

function repository(): OzonPublisherRolloutAdminRepository {
  return {
    listGates: vi.fn(async () => ({
      items: [{ ...GATE, privatePayload: 'must-not-leak' } as OzonPublisherRolloutAdminGate],
      nextCursor: { sortAt: NOW, id: GATE.id },
    })),
    findGate: vi.fn(async () => ({ ...GATE, privatePayload: 'must-not-leak' } as OzonPublisherRolloutAdminGate)),
    provisionGate: vi.fn(async () => ({
      record: { ...GATE, privatePayload: 'must-not-leak' } as OzonPublisherRolloutAdminGate,
      idempotent: false,
    })),
    listEvaluations: vi.fn(async () => ({
      items: [{ ...EVALUATION, privatePayload: 'must-not-leak' } as OzonPublisherRolloutAdminEvaluation],
      nextCursor: null,
    })),
    listTransitions: vi.fn(async () => ({
      items: [{ ...TRANSITION, requestHash: 'must-not-leak' } as OzonPublisherRolloutAdminTransition],
      nextCursor: null,
    })),
    listStages: vi.fn(async () => [{ ...STAGE, storedValue: 'must-not-leak' } as OzonPublisherRolloutAdminStageControl]),
    evaluateGate: vi.fn(async () => ({ record: EVALUATION, idempotent: false })),
    approveGate: vi.fn(async () => ({ record: TRANSITION, idempotent: false })),
    revokeGate: vi.fn(async () => ({
      record: {
        ...TRANSITION,
        id: 'rollout-transition-2',
        transitionVersion: 2,
        expectedStateVersion: 1,
        action: 'REVOKE',
        fromState: 'READY',
        resultState: 'REVOKED',
      } satisfies OzonPublisherRolloutAdminTransition,
      idempotent: false,
    })),
    transitionStage: vi.fn(async () => ({ record: STAGE_TRANSITION, idempotent: false })),
  };
}

function setup() {
  const repo = repository();
  return { repo, service: createOzonPublisherRolloutAdminService({ repository: repo }) };
}

function evaluateRequest(actor = ACTOR) {
  return {
    actor,
    gateId: GATE.id,
    idempotencyKey: 'evaluate-gate-0001',
  };
}

function approveRequest(actor = ACTOR) {
  return {
    actor,
    gateId: GATE.id,
    expectedStateVersion: 0,
    expectedPreviewEvidenceHash: HASH_C,
    idempotencyKey: 'approve-gate-00001',
    reason: TRANSITION.reason,
  };
}

function revokeRequest(actor = ACTOR) {
  return {
    actor,
    gateId: GATE.id,
    expectedStateVersion: 1,
    expectedEvidenceHash: HASH_C,
    expectedEvaluationHash: HASH_D,
    idempotencyKey: 'revoke-gate-00001',
    reason: 'Emergency rollback after an operator review.',
  };
}

function stageRequest(actor = ACTOR) {
  return {
    actor,
    boundary: 'COLLECT_PUBLISH_OZON' as const,
    expectedRevision: 1,
    expectedStage: 'shadow' as const,
    targetStage: 'v2' as const,
    gateBinding: {
      gateId: GATE.id,
      rolloutRevision: GATE.rolloutRevision,
      expectedGateStateVersion: 1,
      expectedEvidenceHash: HASH_C,
      expectedEvaluationHash: HASH_D,
    },
    idempotencyKey: 'promote-stage-0001',
    reason: STAGE_TRANSITION.reason,
  };
}

describe('Ozon publisher rollout admin service', () => {
  it('normalizes bounded list filters and projects fixed public DTOs', async () => {
    const { repo, service } = setup();
    const result = await service.listGates({
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      rolloutRevision: GATE.rolloutRevision,
      state: 'NOT_READY',
      cursor: { sortAt: NOW, id: GATE.id },
      limit: 25,
    });

    expect(repo.listGates).toHaveBeenCalledWith({
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      rolloutRevision: GATE.rolloutRevision,
      state: 'NOT_READY',
      cursor: { sortAt: NOW, id: GATE.id },
      limit: 25,
    });
    expect(result.items).toEqual([GATE]);
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('projects fixed gate, evaluation, transition, and stage details', async () => {
    const { service } = setup();

    const gate = await service.getGate({ gateId: GATE.id });
    const evaluations = await service.listEvaluations({ gateId: GATE.id });
    const transitions = await service.listTransitions({ gateId: GATE.id });
    const stages = await service.listStages();

    expect(gate).toEqual(GATE);
    expect(evaluations.items).toEqual([EVALUATION]);
    expect(transitions.items).toEqual([TRANSITION]);
    expect(stages).toEqual([STAGE]);
    expect(JSON.stringify({ gate, evaluations, transitions, stages })).not.toContain('must-not-leak');
  });

  it('provisions a NOT_READY gate through the repository with a live superadmin actor', async () => {
    const { repo, service } = setup();
    const result = await service.provisionGate({
      actor: ACTOR,
      writerEntrypoint: GATE.writerEntrypoint,
      originChannel: GATE.originChannel,
      rolloutRevision: GATE.rolloutRevision,
    });

    expect(repo.provisionGate).toHaveBeenCalledWith({
      actor: ACTOR,
      writerEntrypoint: GATE.writerEntrypoint,
      originChannel: GATE.originChannel,
      rolloutRevision: GATE.rolloutRevision,
    });
    expect(result).toEqual({ record: GATE, idempotent: false });
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });

  it('returns a typed not-found error without fabricating a gate', async () => {
    const { repo, service } = setup();
    vi.mocked(repo.findGate).mockResolvedValueOnce(null);

    await expect(service.getGate({ gateId: GATE.id })).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_ROLLOUT_GATE_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects unknown fields and malformed cursors before repository access', async () => {
    const { repo, service } = setup();

    await expect(service.listGates({ unsafe: true } as never)).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_ROLLOUT_ADMIN_INVALID_REQUEST',
      statusCode: 400,
    });
    await expect(service.listGates({
      cursor: { sortAt: '2026-07-16', id: GATE.id },
    })).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_ROLLOUT_ADMIN_INVALID_REQUEST',
      statusCode: 400,
    });
    expect(repo.listGates).not.toHaveBeenCalled();
  });

  it.each([
    ['evaluate', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.evaluateGate(evaluateRequest(actor))],
    ['approve', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.approveGate(approveRequest(actor))],
    ['revoke', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.revokeGate(revokeRequest(actor))],
    ['stage transition', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.transitionStage(stageRequest(actor))],
  ])('requires a live super administrator for every %s write', async (_name, invoke) => {
    const { repo, service } = setup();
    await expect(invoke(service, { ...ACTOR, actorRole: 'USER', isSuperAdmin: false }))
      .rejects.toMatchObject({
        code: 'OZON_PUBLISHER_ROLLOUT_SUPER_ADMIN_REQUIRED',
        statusCode: 403,
      });
    expect(repo.evaluateGate).not.toHaveBeenCalled();
    expect(repo.approveGate).not.toHaveBeenCalled();
    expect(repo.revokeGate).not.toHaveBeenCalled();
    expect(repo.transitionStage).not.toHaveBeenCalled();
  });

  it.each([
    ['evaluate', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.evaluateGate(evaluateRequest(actor))],
    ['approve', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.approveGate(approveRequest(actor))],
    ['revoke', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.revokeGate(revokeRequest(actor))],
    ['stage transition', (service: ReturnType<typeof createOzonPublisherRolloutAdminService>, actor: OzonPublisherRolloutAdminActor) => service.transitionStage(stageRequest(actor))],
  ])('requires tokenUse=account_session for every %s write', async (_name, invoke) => {
    const { repo, service } = setup();
    await expect(invoke(service, { ...ACTOR, tokenUse: 'legacy_extension' }))
      .rejects.toMatchObject({
        code: 'OZON_PUBLISHER_ROLLOUT_ACCOUNT_SESSION_REQUIRED',
        statusCode: 403,
      });
    expect(repo.evaluateGate).not.toHaveBeenCalled();
    expect(repo.approveGate).not.toHaveBeenCalled();
    expect(repo.revokeGate).not.toHaveBeenCalled();
    expect(repo.transitionStage).not.toHaveBeenCalled();
  });

  it('derives stable evaluation idempotency keys without treating a preview as approval authority', async () => {
    const { repo, service } = setup();

    await service.evaluateGate(evaluateRequest());
    await service.evaluateGate(evaluateRequest());
    await service.evaluateGate({ ...evaluateRequest(), idempotencyKey: 'evaluate-gate-0002' });

    const first = vi.mocked(repo.evaluateGate).mock.calls[0]![0];
    const replay = vi.mocked(repo.evaluateGate).mock.calls[1]![0];
    const newOperation = vi.mocked(repo.evaluateGate).mock.calls[2]![0];
    expect(first.operationKey).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(replay).toEqual(first);
    expect(newOperation.operationKey).not.toBe(first.operationKey);
    expect(newOperation.requestHash).toBe(first.requestHash);
  });

  it('passes only preview evidence to an atomic live approval operation', async () => {
    const { repo, service } = setup();

    await service.approveGate(approveRequest());
    await service.approveGate({
      ...approveRequest(),
      reason: 'Evidence reviewed again after an operator handoff.',
    });

    const first = vi.mocked(repo.approveGate).mock.calls[0]![0];
    const changed = vi.mocked(repo.approveGate).mock.calls[1]![0];
    expect(first).toMatchObject({
      actor: ACTOR,
      gateId: GATE.id,
      expectedStateVersion: 0,
      expectedPreviewEvidenceHash: HASH_C,
      idempotencyKey: 'approve-gate-00001',
    });
    expect(first).not.toHaveProperty('evaluationId');
    expect(first).not.toHaveProperty('expectedEvaluationHash');
    expect(first.operationKey).toBe(changed.operationKey);
    expect(first.requestHash).not.toBe(changed.requestHash);
  });

  it('passes the complete revoke CAS and idempotency contract', async () => {
    const { repo, service } = setup();

    const result = await service.revokeGate(revokeRequest());

    expect(repo.revokeGate).toHaveBeenCalledWith(expect.objectContaining({
      actor: ACTOR,
      gateId: GATE.id,
      expectedStateVersion: 1,
      expectedEvidenceHash: HASH_C,
      expectedEvaluationHash: HASH_D,
      idempotencyKey: 'revoke-gate-00001',
      operationKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
    expect(result.record.action).toBe('REVOKE');
  });

  it('binds a v2 stage transition to an already-approved exact gate snapshot', async () => {
    const { repo, service } = setup();

    await service.transitionStage(stageRequest());

    expect(repo.transitionStage).toHaveBeenCalledWith(expect.objectContaining({
      actor: ACTOR,
      boundary: 'COLLECT_PUBLISH_OZON',
      configKey: 'source_ozon_publisher_collect_publish_stage',
      expectedRevision: 1,
      expectedStage: 'shadow',
      targetStage: 'v2',
      gateBinding: stageRequest().gateBinding,
      idempotencyKey: 'promote-stage-0001',
      operationKey: expect.stringMatching(/^[a-f0-9]{64}$/u),
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }));
  });

  it('allows a gate-free safe transition to shadow', async () => {
    const { repo, service } = setup();

    await service.transitionStage({
      actor: ACTOR,
      boundary: 'LISTING_BATCH',
      expectedRevision: 0,
      expectedStage: 'off',
      targetStage: 'shadow',
      idempotencyKey: 'shadow-stage-0001',
      reason: 'Begin bounded shadow observation.',
    });

    expect(repo.transitionStage).toHaveBeenCalledWith(expect.objectContaining({
      configKey: 'source_ozon_publisher_listing_batch_stage',
      gateBinding: null,
    }));
  });

  it.each([
    ['skipped promotion', { ...stageRequest(), expectedStage: 'off' as const }, 409],
    ['same stage', { ...stageRequest(), expectedStage: 'shadow' as const, targetStage: 'shadow' as const }, 409],
    ['unsupported extension v2', { ...stageRequest(), boundary: 'EXTENSION_ADAPTER' as const }, 409],
    ['gate on demotion', { ...stageRequest(), expectedStage: 'v2' as const, targetStage: 'off' as const }, 400],
  ])('rejects an invalid stage transition: %s', async (_name, request, statusCode) => {
    const { repo, service } = setup();

    await expect(service.transitionStage(request)).rejects.toMatchObject({ statusCode });
    expect(repo.transitionStage).not.toHaveBeenCalled();
  });

  it('rejects non-canonical idempotency values before a write', async () => {
    const { repo, service } = setup();

    await expect(service.evaluateGate({
      ...evaluateRequest(),
      idempotencyKey: ' evaluate-gate-0001',
    })).rejects.toMatchObject({
      code: 'OZON_PUBLISHER_ROLLOUT_ADMIN_INVALID_REQUEST',
      statusCode: 400,
    });
    expect(repo.evaluateGate).not.toHaveBeenCalled();
  });
});

describe('Ozon publisher rollout admin dependency boundary', () => {
  it('depends only on the crypto standard library and contains no publishing call surface', () => {
    const source = readFileSync(new URL(
      '../services/ozon-publisher-rollout-admin.ts',
      import.meta.url,
    ), 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);

    expect(imports).toEqual(['node:crypto']);
    expect(source).not.toMatch(/ozon-client|ozon-listing-publisher|ozon-publish-attempt/iu);
    expect(source).not.toMatch(/routes[\\/]collect|routes[\\/]listing/iu);
    expect(source).not.toMatch(/\/v[13]\/product\/import|import-by-sku/iu);
  });

  it('keeps the Prisma and HTTP admin adapters disconnected from physical Ozon writers', () => {
    const sources = [
      '../services/ozon-publisher-rollout-admin-prisma.ts',
      '../routes/admin-ozon-publisher-rollout.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

    for (const source of sources) {
      expect(source).not.toMatch(/ozon-client|ozon-listing-publisher|ozon-publish-attempt/iu);
      expect(source).not.toMatch(/routes[\\/]collect|routes[\\/]listing/iu);
      expect(source).not.toMatch(/\/v[13]\/product\/import|import-by-sku/iu);
    }
  });
});
