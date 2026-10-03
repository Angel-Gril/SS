import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaAiImageSuiteRecoveryRepository } from '../repositories/ai-image-suite-recovery-repository.js';
import { PrismaAiProviderReconciliationRepository } from '../repositories/ai-provider-reconciliation-repository.js';
import { createAiProviderReconciliationAdminService } from '../services/ai-provider-reconciliation-admin.js';
import { createAiImageSuiteProviderRuntimeSnapshot } from '../services/ai-image-suite-provider-runtime.js';
import { type AiProviderReconciliationClaim } from '../services/ai-provider-reconciliation.js';

const enabled = process.env.RUN_AI_MEDIA_POSTGRES_TESTS === '1';
const url = process.env.AI_MEDIA_TEST_DATABASE_URL || '';
const H = (value: string) => createHash('sha256').update(value).digest('hex');
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const id = (key: string) => `suite_recovery_${key}_${suffix}`;
const owner = id('owner'); const subject = id('subject'); const snapshotId = id('snapshot');
const templateKey = 'ai_media_suite_generation_wanx';
const runtime = createAiImageSuiteProviderRuntimeSnapshot({ provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'synthetic-only-test', costPerImageCents: 14, currency: 'CNY',
  credentialRevision: { recordId: 'synthetic-test-record', revision: 1, updatedAt: '2026-10-04T09:00:00.000Z' } }, { nodeEnv: 'production' });
const rawSha = H('synthetic-raw'); const finalSha = H('synthetic-final');

describe.skipIf(!enabled)('original suite task recovery PostgreSQL owner', () => {
  let db: PrismaClient; let claims: AiProviderReconciliationClaim[];
  const decisions: Parameters<ReturnType<typeof createAiProviderReconciliationAdminService>['resolveReconciliation']>[0][] = [];
  const suiteId = id('suite');
  beforeAll(async () => {
    if (!/^ai_media_test_[a-z0-9_]+$/u.test(new URL(url).searchParams.get('schema') || '')) throw new Error('Isolated schema required');
    db = new PrismaClient({ datasources: { db: { url } } }); await db.$connect();
    await db.user.create({ data: { id: owner, phone: id('phone'), passwordHash: 'synthetic' } });
    await db.sourceCaptureSubject.create({ data: { id: subject, ownerUserId: owner, sourcePlatform: '1688', sourceProductId: id('source') } });
    await db.sourceCaptureSnapshot.create({ data: { id: snapshotId, subjectId: subject, version: 1,
      schemaVersion: 'source-product-capture-v2', captureHash: H('capture'), payloadBytes: 2, payload: {}, stageCounts: {}, provenance: {},
      provenanceComplete: true, parserVersion: 'test', completeness: {}, truncations: [], hasEstimatedValues: false, profile: {},
      profileHash: H('profile'), actorUserId: owner, ingestChannel: 'WEB_ACCOUNT', rolloutRevision: 'test', rolloutStage: 'v2_only', capturedAt: new Date() } });
    // Construct the historical precondition only in the isolated schema. All
    // transitions under test run with every production trigger enabled.
    const tables = ['ai_media_plans','ai_media_planning_runs','ai_media_plan_versions','ai_media_suites','ai_media_workflows','ai_image_jobs',
      'ai_cost_reservations','ai_media_suite_slots','ai_media_suite_events','ai_media_suite_prompt_sets','ai_media_suite_slot_prompts',
      'ai_prompt_templates','ai_prompt_revisions','ai_prompt_releases','media_assets','ai_media_workflow_inputs'];
    await db.$transaction(async (tx: any) => {
      for (const table of tables) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
      await tx.aiPromptTemplate.upsert({ where: { key: templateKey }, update: {}, create: { key: templateKey, label: 'Synthetic suite' } });
      await tx.aiPromptRevision.create({ data: { id: id('template_revision'), templateKey, status: 'PUBLISHED', promptTemplate: '保留商品',
        negativePromptTemplate: '', checksum: H('template'), createdByUserId: owner, updatedByUserId: owner } });
      await tx.aiPromptRelease.create({ data: { id: id('release'), templateKey, revisionId: id('template_revision'), sequence: 1000,
        action: 'PUBLISH', actorUserId: owner } });
      await tx.aiMediaPlan.create({ data: { id: id('plan'), ownerUserId: owner, actorUserId: owner, sourceSubjectId: subject,
        contextType: 'collect', contextId: id('goods'), idempotencyKey: id('plan_key'), requestFingerprint: H('request'), revision: 2,
        latestVersion: 0, reviewStatus: 'NOT_READY' } });
      await tx.aiMediaPlanningRun.create({ data: { id: id('run'), planId: id('plan'), ownerUserId: owner, actorUserId: owner, sourceSubjectId: subject,
        sourceCaptureSnapshotId: snapshotId, attempt: 1, revision: 1, mode: 'RULE_BASED', engineVersion: 'test', status: 'SUCCEEDED',
        idempotencyKey: id('run_key'), requestFingerprint: H('request'), sourceCaptureHash: H('capture'), sourceProfileHash: H('profile'),
        inputFingerprint: H('input'), inputSnapshot: {}, inputHash: H('input'), inputBytes: 2, completedAt: new Date() } });
      await tx.aiMediaPlanVersion.create({ data: { id: id('version'), planId: id('plan'), ownerUserId: owner, actorUserId: owner,
        sourceSubjectId: subject, version: 1, planningRunId: id('run'), sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: H('capture'),
        sourceProfileHash: H('profile'), sourceSchemaVersion: 'source-product-capture-v2', selectedSkuHash: H('sku'), inputAssetSetHash: H('assets'),
        inputFingerprint: H('input'), planSchemaVersion: 'test', plannerVersion: 'test', mode: 'RULE_BASED', inputSnapshot: {}, inputHash: H('input'),
        curation: {}, curationHash: H('curation'), visionEvidence: {}, visionEvidenceHash: H('vision'), planPayload: {}, planHash: H('plan'),
        planBytes: 2, provenance: {}, provenanceHash: H('provenance') } });
      await tx.aiMediaPlan.update({ where: { id: id('plan') }, data: { latestVersion: 1, currentVersionId: id('version'),
        approvedVersionId: id('version'), reviewStatus: 'APPROVED', reviewedByUserId: owner, reviewedAt: new Date() } });
      await tx.aiMediaSuite.create({ data: { id: suiteId, ownerUserId: owner, actorUserId: owner, planId: id('plan'), planVersionId: id('version'),
        sourceSubjectId: subject, sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: H('capture'), sourceProfileHash: H('profile'),
        sourceSchemaVersion: 'source-product-capture-v2', contextType: 'collect', contextId: id('goods'), status: 'FAILED', revision: 9,
        idempotencyKey: id('suite_key'), requestFingerprint: H('request'), previewHash: H('preview'), provider: runtime.providerConfig!.provider,
        model: runtime.providerConfig!.model, providerConfigHash: runtime.providerConfig!.providerConfigHash,
        pricingVersion: runtime.providerConfig!.pricingVersion, itemCount: 2, estimatedCostCents: 28, maximumCostCents: 28,
        concurrencyLimit: 1, completedAt: new Date() } });
      const shared = { suiteId, ownerUserId: owner, version: 'ai-image-suite-prompt-set/v1', operationKey: id('prompt_key'), requestFingerprint: H('request'),
        planId: id('plan'), planVersionId: id('version'), sourceSubjectId: subject, sourceCaptureSnapshotId: snapshotId, sourceCaptureHash: H('capture'),
        sourceProfileHash: H('profile'), sourceSchemaVersion: 'source-product-capture-v2', templateKey, templateReleaseId: id('release'),
        templateRevisionId: id('template_revision'), templateSequence: 1000, templateChecksum: H('template'), templateSnapshot: {}, templateSnapshotHash: H('template'),
        compilerVersion: 'ai-image-suite-prompt-compiler-wanx/v1', policyVersion: 'test', policyHash: H('policy'), referenceSetHash: H('ref') };
      await tx.aiMediaSuitePromptSet.create({ data: { ...shared, id: id('promptset'), actorUserId: owner, planHash: H('plan'),
        provider: runtime.providerConfig!.provider, model: runtime.providerConfig!.model, providerConfigHash: runtime.providerConfig!.providerConfigHash,
        slotCount: 2, promptSetHash: H('promptset') } });
      for (const ordinal of [0,1]) {
        const key = (value: string) => id(`${value}_${ordinal}`);
        const accepted = new Date(Date.now() - 60_000);
        const source = await tx.mediaAsset.create({ data: { id: key('input'), ownerUserId: owner, kind: 'SOURCE_ORIGINAL', sourceCaptureSnapshotId: snapshotId,
          sourceMediaKey: key('source_media'), sourceUrl: 'https://synthetic.example/input.png',
          url: 'https://synthetic.example/input.png', storageBackend: 'local', storageKey: 'test.png', mimeType: 'image/png', sizeBytes: 10,
          width: 1024, height: 1024, sha256: H('reference') } });
        await tx.aiMediaWorkflow.create({ data: { id: key('workflow'), ownerUserId: owner, actorUserId: owner, operation: 'IMAGE_TO_IMAGE', status: 'FAILED',
          reviewStatus: 'NOT_READY', revision: 4, currentAttempt: 1, contextType: 'collect', contextId: id('goods'), contextSlotKey: key('slotkey'),
          idempotencyKey: key('workflow_key'), requestFingerprint: H(key('request')), completedAt: new Date() } });
        await tx.aiMediaWorkflowInput.create({ data: { workflowId: key('workflow'), ownerUserId: owner, assetId: source.id,
          role: 'REFERENCE', ordinal: 0, assetSha256: H('reference'), assetUrl: source.url, mimeType: source.mimeType, width: 1024, height: 1024 } });
        const config = { version: 'ai-image-suite-child-operation/v2', outputProfile: 'ozon-suite-3x4-900x1200/v1', width: 900, height: 1200,
          slotPromptId: key('prompt'), promptBindingHash: H('binding'), referenceSetHash: H('ref'), providerRuntime: runtime.providerRuntime,
          providerRequest: { count: 1, width: 1024, height: 1024 }, finalOutput: { profile: 'ozon-suite-3x4-900x1200/v1', width: 900, height: 1200,
            fit: 'contain', background: '#ffffff', format: 'png', normalizerVersion: 'ai-image-suite-output-normalizer/v1' } };
        await tx.aiImageJob.create({ data: { id: key('job'), ownerUserId: owner, actorUserId: owner, operation: 'IMAGE_TO_IMAGE', status: 'FAILED',
          workflowId: key('workflow'), workflowAttempt: 1, provider: runtime.providerConfig!.provider, model: runtime.providerConfig!.model,
          prompt: '保留商品', negativePrompt: '', resolvedPrompt: '保留商品', resolvedNegativePrompt: '', templateKey, templateReleaseId: id('release'),
          templateChecksum: H('template'), templateSnapshot: {}, requestFingerprint: H(key('request')),
          inputAssets: [{ assetId: source.id, role: 'REFERENCE', ordinal: 0, sha256: H('reference') }], operationConfig: config,
          width: 900, height: 1200, maxAttempts: 1, attemptCount: 1, estimatedCostCents: 14, billedUnits: 0, progress: 0,
          startedAt: accepted, completedAt: new Date(), providerDispatchedAt: accepted, providerJobId: key('accepted_task'),
          errorCode: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', errorMessage: '800x800 rejected', providerReconciliationStatus: 'MANUAL_REVIEW',
          providerReconciliationRevision: 1 } });
        await tx.aiCostReservation.create({ data: { id: key('reservation'), ownerUserId: owner, actorUserId: owner, workflowId: key('workflow'), jobId: key('job'),
          idempotencyKey: key('cost_key'), requestFingerprint: H(key('request')), provider: runtime.providerConfig!.provider,
          model: runtime.providerConfig!.model, operation: 'IMAGE_TO_IMAGE', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14,
          status: 'RECONCILIATION_REQUIRED', providerRequestId: key('accepted_task'), providerAcceptedAt: accepted, reconciliationRequiredAt: new Date() } });
        await tx.aiMediaSuiteSlot.create({ data: { id: key('slot'), suiteId, ownerUserId: owner, ordinal, slotKey: key('slotkey'), goal: 'sku_hero',
          ownershipLevel: 'sku', ownershipKey: key('sku'), slotSnapshot: {}, slotHash: H('slot'), referencesSnapshot: [], referencesHash: H('refs'),
          diagnostics: {}, status: 'FAILED', childWorkflowId: key('workflow'), attempt: 1, revision: 5, estimatedCostCents: 14, maximumCostCents: 14,
          errorCode: 'PROVIDER_OUTPUT_DIMENSIONS_MISMATCH', errorMessage: '800x800 rejected' } });
        await tx.aiMediaSuiteSlotPrompt.create({ data: { id: key('prompt'), promptSetId: id('promptset'), suiteId, slotId: key('slot'), ownerUserId: owner,
          version: 'ai-image-suite-slot-prompt/v1', ordinal, slotKey: key('slotkey'), slotHash: H('slot'), referencesHash: H('refs'), referenceSetHash: H('ref'),
          templateKey, templateReleaseId: id('release'), templateRevisionId: id('template_revision'), templateSequence: 1000, templateChecksum: H('template'),
          templateSnapshot: {}, templateSnapshotHash: H('template'), variablesSnapshot: {}, variablesHash: H('variables'), resolvedPrompt: '保留商品',
          resolvedNegativePrompt: '', compiledPromptHash: H('compiled'), compilerVersion: 'ai-image-suite-prompt-compiler-wanx/v1',
          policyVersion: 'test', policyHash: H('policy'), resolvedPromptHash: H('保留商品'), resolvedNegativePromptHash: H(''), bindingHash: H('binding') } });
      }
      await tx.aiMediaSuiteEvent.create({ data: { suiteId, ownerUserId: owner, actorUserId: owner, revision: 9, eventKey: id('failed_event'),
        eventType: 'SUITE_CHILD_FAILED', payload: { afterStatus: 'FAILED', counts: { planned: 0, queued: 0, running: 0, succeeded: 0,
          failed: 2, cancelRequested: 0, cancelled: 0, total: 2, active: 0 } }, payloadHash: H('failed') } });
      for (const table of tables) await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
    });
    const admin = createAiProviderReconciliationAdminService({ database: db });
    const list = await admin.listReconciliations({ limit: 100 });
    for (const ordinal of [0,1]) {
      const jobId = id(`job_${ordinal}`); const entry = list.items.find((row: any) => row.id === jobId)!;
      expect(entry.allowedActions).toContain('RESUME');
      const decision = { jobId, actorUserId: owner, requestId: randomUUID(), expectedStatus: 'MANUAL_REVIEW' as const,
        expectedRevision: entry.revision, expectedEvidenceHash: entry.evidenceHash, action: 'RESUME', providerJobId: entry.providerJobId,
        providerAcceptedAt: entry.providerAcceptedAt, reason: 'Recover the accepted task only; no additional Provider create request' } as const;
      decisions.push(decision);
      await admin.resolveReconciliation(decision);
    }
    claims = await new PrismaAiProviderReconciliationRepository(db).claimDue({ workerId: 'synthetic-suite-worker', now: new Date(), limit: 10, leaseMs: 120000 });
    expect(claims).toHaveLength(2);
  },120000);
  afterAll(async () => db?.$disconnect());

  function assets(claim: AiProviderReconciliationClaim) {
    const metadata = { version: 'ai-image-suite-provider-output/v1', sourceCaptureSnapshotId: snapshotId, providerJobId: claim.providerJobId,
      actualCostCents: 14, providerResultReceivedAt: new Date().toISOString(), normalizerVersion: 'ai-image-suite-output-normalizer/v1', normalizedSha256: finalSha };
    const common = { url: 'https://synthetic.example/output.png', storageBackend: 'local' as const, storageKey: `${claim.jobId}/output.png`,
      mimeType: 'image/png', sizeBytes: 10 };
    return { claim, providerJobId: claim.providerJobId, actualCostCents: 14,
      raw: { ...common, width: 800, height: 800, sha256: rawSha, metadata },
      output: { ...common, storageKey: `${claim.jobId}/final.png`, width: 900, height: 1200, sha256: finalSha,
        metadata: { sourceCaptureSnapshotId: snapshotId, normalizerVersion: 'ai-image-suite-output-normalizer/v1' } } };
  }
  it('rejects an unaudited FAILED transition and foreign owner, lease, task, amount or physical dimensions', async () => {
    const claim = claims[0]!;
    const repository = new PrismaAiImageSuiteRecoveryRepository(db);
    const authority = await db.$queryRawUnsafe<Array<{ allowed: boolean }>>('SELECT ai_media_suite_original_task_recovery_allowed($1) AS allowed', claim.jobId);
    const allowed = authority[0]!.allowed;
    expect(allowed).toBe(false);
    await expect(db.aiImageJob.update({ where: { id: claim.jobId }, data: { status: 'SUCCEEDED', progress: 100 } }))
      .rejects.toThrow(/invalid AI media suite child job state transition/u);
    for (const changed of [{ ...claim, ownerUserId: 'foreign-owner' }, { ...claim, leaseToken: 'wrong-lease' },
      { ...claim, providerJobId: 'other-accepted-task' }, { ...claim, workflowAttempt: 2 },
      { ...claim, deadlineAt: new Date(claim.deadlineAt.getTime() + 60_000) }]) {
      await expect(repository.getClaimedGraph(changed)).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    }
    await expect(repository.complete({ ...assets(claim), actualCostCents: 15 })).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    const wrongDimensions = assets(claim); wrongDimensions.raw.height = 801;
    await expect(repository.complete(wrongDimensions)).rejects.toThrow(/raw Provider output is invalid/u);
    expect(await db.mediaAsset.count({ where: { aiImageJobId: claim.jobId } })).toBe(0);
    expect(await db.aiCostSettlement.count({ where: { reservationId: id('reservation_0') } })).toBe(0);
  });
  it('proves the old raw-output owner rejects the recovery before restoring the precise migration', async () => {
    const definitions = await db.$queryRawUnsafe<Array<{ definition: string }>>('SELECT pg_get_functiondef(\'prevent_ai_media_suite_child_output_before_dispatch()\'::regprocedure) AS definition');
    const definition = definitions[0]!.definition;
    const old = await readFile(new URL('../../prisma/migrations/20260916110000_enable_wanx_reference_image_suites/migration.sql', import.meta.url),'utf8');
    const body = old.match(/CREATE OR REPLACE FUNCTION prevent_ai_media_suite_child_output_before_dispatch\(\)[\s\S]*?\$\$ LANGUAGE plpgsql;/u)![0];
    try {
      await db.$executeRawUnsafe(body);
      await expect(new PrismaAiImageSuiteRecoveryRepository(db).complete(assets(claims[0]!))).rejects.toThrow(/raw Provider output is invalid/u);
      expect(await db.mediaAsset.count({ where: { aiImageJobId: claims[0]!.jobId } })).toBe(0);
    } finally { await db.$executeRawUnsafe(definition); }
  });
  it('rolls back raw, final, original charge and audit when a later workflow transition fails', async () => {
    const claim = claims[0]!;
    await db.$executeRawUnsafe(`CREATE FUNCTION suite_recovery_test_failure() RETURNS trigger AS $$
      BEGIN IF NEW."id"='${claim.workflowId}' AND NEW."status"='SUCCEEDED' THEN
        RAISE EXCEPTION 'isolated forced late recovery failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe('CREATE TRIGGER suite_recovery_test_failure BEFORE UPDATE ON "ai_media_workflows" FOR EACH ROW EXECUTE FUNCTION suite_recovery_test_failure()');
    try {
      await expect(new PrismaAiImageSuiteRecoveryRepository(db).complete(assets(claim))).rejects.toThrow(/isolated forced late recovery failure/u);
      expect(await db.mediaAsset.count({ where: { aiImageJobId: claim.jobId } })).toBe(0);
      expect(await db.aiCostSettlement.count({ where: { reservationId: id('reservation_0') } })).toBe(0);
      expect(await db.aiProviderReconciliationEvent.count({ where: { jobId: claim.jobId, eventType: 'PROVIDER_RECONCILIATION_SUITE_RECOVERED' } })).toBe(0);
      expect(await db.aiImageJob.findUnique({ where: { id: claim.jobId } })).toMatchObject({ status: 'FAILED',
        providerReconciliationStatus: 'RUNNING', attemptCount: 1, providerJobId: claim.providerJobId, actualCostCents: null, billedUnits: 0 });
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER suite_recovery_test_failure ON "ai_media_workflows"');
      await db.$executeRawUnsafe('DROP FUNCTION suite_recovery_test_failure()');
    }
  });
  it('recovers both original attempts atomically into PENDING candidates and exactly two original charges', async () => {
    const repository = new PrismaAiImageSuiteRecoveryRepository(db);
    for (const claim of claims) await repository.complete(assets(claim));
    expect(await db.aiMediaSuite.findUnique({ where: { id: suiteId } })).toMatchObject({ status: 'SUCCEEDED', revision: 11 });
    const jobs = await db.aiImageJob.findMany({ where: { id: { in: claims.map(row => row.jobId) } }, include: { workflow: true, costReservation: { include: { settlements: true } }, assets: true } });
    for (const job of jobs) {
      expect(job).toMatchObject({ status: 'SUCCEEDED', workflowAttempt: 1, attemptCount: 1, actualCostCents: 14, billedUnits: 1,
        providerReconciliationStatus: 'RECOVERED', workflow: { currentAttempt: 1, reviewStatus: 'PENDING', selectedOutputAssetId: null },
        costReservation: { status: 'SETTLED' } });
      expect(job.costReservation!.settlements.filter(row => row.kind === 'RECONCILED_CHARGE')).toHaveLength(1);
      expect(job.assets).toHaveLength(2);
      expect(job.assets.find(row => row.kind === 'AI_PROVIDER_OUTPUT')).toMatchObject({ width: 800, height: 800 });
      await expect(repository.complete(assets(claims.find(row => row.jobId === job.id)!))).rejects.toMatchObject({ code: 'PROVIDER_RECONCILIATION_LEASE_LOST' });
    }
    expect(await db.aiProviderReconciliationEvent.count({ where: { eventType: 'PROVIDER_RECONCILIATION_SUITE_RECOVERED', ownerUserId: owner } })).toBe(2);
  });
  it('replays the original RESUME decision after recovery without reopening the task or changing audit', async () => {
    const admin = createAiProviderReconciliationAdminService({ database: db });
    for (const decision of decisions) await expect(admin.resolveReconciliation(decision)).resolves.toMatchObject({ status: 'RECOVERED' });
    expect(await db.aiProviderReconciliationEvent.count({ where: { eventType: 'PROVIDER_RECONCILIATION_RESUME', ownerUserId: owner } })).toBe(2);
  });
});
