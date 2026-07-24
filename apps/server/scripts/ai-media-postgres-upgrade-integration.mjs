import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  loadAiMediaSuiteTriggerRows,
  validateAiMediaSuiteTriggerRows,
} from './ai-media-suite-post-migration-contract.mjs';

const EXECUTION_MIGRATION = '20260720120000_add_ai_media_suite_execution';
const PLAN_ACTIVITY_MIGRATION = '20260720130000_enforce_ai_media_suite_plan_activity';
const OUTPUT_JOB_OWNERSHIP_MIGRATION = '20260720140000_enforce_ai_media_output_job_ownership';
const EDIT_OUTPUT_GUARD_MIGRATION = '20260720154000_install_ai_image_edit_output_guards';
const CANDIDATE_CHAINING_MIGRATION = '20260720160000_allow_ai_image_edit_candidate_chaining';
const CANDIDATE_CONTRACT_MIGRATION = '20260720161000_require_ai_image_edit_candidate_contract';
const CANDIDATE_SCOPE_MIGRATION = '20260720162000_require_ai_image_edit_candidate_scope';
const CANDIDATE_DEPENDENCY_MIGRATION = '20260720163000_guard_ai_image_edit_candidate_dependencies';
const CANDIDATE_AUTHORITY_LOCK_MIGRATION = '20260720164000_lock_ai_image_edit_candidate_authority';
const CANDIDATE_MUTATION_SERIALIZATION_MIGRATION = '20260720165000_serialize_ai_image_edit_candidate_mutations';
const UNBOUND_CANDIDATE_REJECTION_MIGRATION = '20260720166000_reject_unbound_ai_image_edit_candidates';
const WORKFLOW_HISTORY_INDEX_MIGRATION = '20260720167000_add_ai_media_workflow_history_index';
const WORKFLOW_PRIORITY_INDEX_MIGRATION = '20260720168000_add_ai_media_workflow_priority_index';
const APPLICATION_MUTATION_MIGRATION = '20260720169000_add_ai_media_application_mutations';
const APPLICATION_AUTHORITY_MIGRATION = '20260720170000_harden_ai_media_application_mutation_authority';
const LISTING_DRAFT_SOURCE_KEY_MIGRATION = '20260721001000_prebuild_source_listing_draft_ai_media_context_key';
const LISTING_DRAFT_CONTEXT_COLUMNS_MIGRATION = '20260721002000_add_ai_media_listing_draft_context_columns';
const LISTING_DRAFT_WORKFLOW_INDEX_MIGRATION = '20260721003000_prebuild_ai_media_listing_draft_context_index';
const LISTING_DRAFT_CONTEXT_FK_MIGRATION = '20260721010000_add_ai_media_listing_draft_context';
const LISTING_DRAFT_CANDIDATE_SCOPE_MIGRATION = '20260721011000_allow_listing_draft_ai_image_edit_candidates';
const LISTING_DRAFT_APPLICATION_MUTATION_MIGRATION = '20260721120000_add_ai_media_listing_draft_application_mutations';
const LISTING_DRAFT_APPLICATION_AUTHORITY_MIGRATION = '20260721121000_harden_ai_media_listing_draft_application_authority';
const LISTING_DRAFT_PROJECTION_FIX_MIGRATION = '20260721122000_fix_ai_media_listing_draft_projection_constraints';
const LISTING_DRAFT_ACTOR_AUTHORITY_MIGRATION = '20260721123000_enforce_ai_media_listing_draft_actor_authority';
const PROVIDER_RECONCILIATION_STATE_MIGRATION = '20260721124000_add_ai_provider_reconciliation_state';
const PROVIDER_RECONCILIATION_HARDENING_MIGRATION = '20260721125000_harden_ai_provider_reconciliation_state';
const PROVIDER_RECONCILIATION_WORKFLOW_INDEX_MIGRATION = '20260721126000_add_ai_provider_reconciliation_workflow_index';
const PROVIDER_RECONCILIATION_EVENT_MIGRATION = '20260721127000_add_ai_provider_reconciliation_events';
const PROVIDER_RECONCILIATION_IDENTITY_MIGRATION = '20260721128000_normalize_ai_provider_reconciliation_identity';
const PROVIDER_RECONCILIATION_ANOMALY_MIGRATION = '20260721129000_allow_ai_provider_reconciliation_anomalies';
const PROVIDER_RECONCILIATION_LEASE_INDEX_MIGRATION = '20260721130000_index_ai_provider_reconciliation_leases';
const PROVIDER_RECONCILIATION_DEADLINE_MIGRATION = '20260721131000_extend_ai_provider_reconciliation_backfill_deadlines';
const EXTENSION_MEDIA_REVIEW_MIGRATION = '20260722100000_add_extension_media_review_apply_operations';
const PAID_SUITE_EXECUTION_MIGRATION = '20260724140000_enable_paid_ai_image_suite_execution';
const GLOBAL_SETTLEMENT_BUDGET_INDEX_MIGRATION = '20260724141000_index_global_ai_cost_settlements';
const GLOBAL_RESERVATION_BUDGET_INDEX_MIGRATION = '20260724142000_index_global_ai_cost_reservations';
const TEST_SCHEMA_PATTERN = /^ai_media_test_[a-z0-9_]+$/u;
const TEMP_ROOT_PREFIX = 'ss-erp-ai-media-upgrade-';
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = join(serverRoot, 'prisma');
const migrationsRoot = join(prismaRoot, 'migrations');
const baseDatabaseUrl = process.env.DATABASE_URL || '';
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');

const schema = `ai_media_test_upgrade_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const invalidSchema = `ai_media_test_upgrade_invalid_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const foreignFunctionSchema = `${schema}_foreign`;
if (!TEST_SCHEMA_PATTERN.test(schema)) throw new Error('Unsafe AI media upgrade test schema name');
if (!TEST_SCHEMA_PATTERN.test(invalidSchema)) throw new Error('Unsafe invalid AI media upgrade test schema name');
if (!TEST_SCHEMA_PATTERN.test(foreignFunctionSchema)) {
  throw new Error('Unsafe foreign-function AI media upgrade test schema name');
}

const testUrl = new URL(baseDatabaseUrl);
testUrl.searchParams.set('schema', schema);
const invalidTestUrl = new URL(baseDatabaseUrl);
invalidTestUrl.searchParams.set('schema', invalidSchema);
const globalPnpmCli = process.platform === 'win32'
  ? join(process.env.APPDATA || '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')
  : '';
const pnpmCli = process.env.npm_execpath
  || (globalPnpmCli && existsSync(globalPnpmCli) ? globalPnpmCli : '');
if (process.platform === 'win32' && !pnpmCli) {
  throw new Error('Unable to resolve the pnpm CLI without a Windows command shell');
}
const command = pnpmCli ? process.execPath : 'pnpm';
const admin = new PrismaClient({ datasources: { db: { url: baseDatabaseUrl } } });
const tempRoot = mkdtempSync(join(tmpdir(), TEMP_ROOT_PREFIX));
const tempPrismaRoot = join(tempRoot, 'prisma');
const tempSchemaPath = join(tempPrismaRoot, 'schema.prisma');
let fixtureClient;
let invalidFixtureClient;

function assertSafeTempRoot(target) {
  const resolvedTemp = resolve(tmpdir());
  const resolvedTarget = resolve(target);
  if (!resolvedTarget.startsWith(`${resolvedTemp}${sep}`)
    || !basename(resolvedTarget).startsWith(TEMP_ROOT_PREFIX)) {
    throw new Error(`Refusing to clean unsafe temporary path: ${resolvedTarget}`);
  }
}

function resolveCommand(args) {
  return { executable: command, args: pnpmCli ? [pnpmCli, ...args] : args };
}

function run(args, extraEnv = {}) {
  const invocation = resolveCommand(args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: serverRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function runExpectingFailure(args, expectedPattern, extraEnv = {}) {
  const invocation = resolveCommand(args);
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: serverRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status === 0 || !expectedPattern.test(output)) {
    throw new Error(
      `pnpm ${args.join(' ')} did not fail with the expected migration error:\n${output.slice(-4000)}`,
    );
  }
  console.log('PASS rejected intentionally invalid populated AI edit upgrade');
}

function labeledCleanupError(label, error) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${label}: ${message}`, { cause: error });
}

function prepareHistoricalMigrations() {
  const names = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const executionIndex = names.indexOf(EXECUTION_MIGRATION);
  const editOutputGuardIndex = names.indexOf(EDIT_OUTPUT_GUARD_MIGRATION);
  const candidateChainingIndex = names.indexOf(CANDIDATE_CHAINING_MIGRATION);
  const candidateContractIndex = names.indexOf(CANDIDATE_CONTRACT_MIGRATION);
  const candidateScopeIndex = names.indexOf(CANDIDATE_SCOPE_MIGRATION);
  const candidateDependencyIndex = names.indexOf(CANDIDATE_DEPENDENCY_MIGRATION);
  const candidateAuthorityLockIndex = names.indexOf(CANDIDATE_AUTHORITY_LOCK_MIGRATION);
  const candidateMutationSerializationIndex = names.indexOf(CANDIDATE_MUTATION_SERIALIZATION_MIGRATION);
  const unboundCandidateRejectionIndex = names.indexOf(UNBOUND_CANDIDATE_REJECTION_MIGRATION);
  const workflowHistoryIndex = names.indexOf(WORKFLOW_HISTORY_INDEX_MIGRATION);
  const workflowPriorityIndex = names.indexOf(WORKFLOW_PRIORITY_INDEX_MIGRATION);
  const applicationMutationIndex = names.indexOf(APPLICATION_MUTATION_MIGRATION);
  const applicationAuthorityIndex = names.indexOf(APPLICATION_AUTHORITY_MIGRATION);
  const listingDraftSourceKeyIndex = names.indexOf(LISTING_DRAFT_SOURCE_KEY_MIGRATION);
  const listingDraftContextColumnsIndex = names.indexOf(LISTING_DRAFT_CONTEXT_COLUMNS_MIGRATION);
  const listingDraftWorkflowIndexIndex = names.indexOf(LISTING_DRAFT_WORKFLOW_INDEX_MIGRATION);
  const listingDraftContextFkIndex = names.indexOf(LISTING_DRAFT_CONTEXT_FK_MIGRATION);
  const listingDraftCandidateScopeIndex = names.indexOf(LISTING_DRAFT_CANDIDATE_SCOPE_MIGRATION);
  const listingDraftApplicationMutationIndex = names.indexOf(
    LISTING_DRAFT_APPLICATION_MUTATION_MIGRATION,
  );
  const listingDraftApplicationAuthorityIndex = names.indexOf(
    LISTING_DRAFT_APPLICATION_AUTHORITY_MIGRATION,
  );
  const listingDraftProjectionFixIndex = names.indexOf(LISTING_DRAFT_PROJECTION_FIX_MIGRATION);
  const listingDraftActorAuthorityIndex = names.indexOf(LISTING_DRAFT_ACTOR_AUTHORITY_MIGRATION);
  const providerReconciliationStateIndex = names.indexOf(PROVIDER_RECONCILIATION_STATE_MIGRATION);
  const providerReconciliationHardeningIndex = names.indexOf(
    PROVIDER_RECONCILIATION_HARDENING_MIGRATION,
  );
  const providerReconciliationWorkflowIndexIndex = names.indexOf(
    PROVIDER_RECONCILIATION_WORKFLOW_INDEX_MIGRATION,
  );
  const providerReconciliationEventIndex = names.indexOf(PROVIDER_RECONCILIATION_EVENT_MIGRATION);
  const providerReconciliationIdentityIndex = names.indexOf(
    PROVIDER_RECONCILIATION_IDENTITY_MIGRATION,
  );
  const providerReconciliationAnomalyIndex = names.indexOf(
    PROVIDER_RECONCILIATION_ANOMALY_MIGRATION,
  );
  const providerReconciliationLeaseIndexIndex = names.indexOf(
    PROVIDER_RECONCILIATION_LEASE_INDEX_MIGRATION,
  );
  const providerReconciliationDeadlineIndex = names.indexOf(
    PROVIDER_RECONCILIATION_DEADLINE_MIGRATION,
  );
  const extensionMediaReviewIndex = names.indexOf(EXTENSION_MEDIA_REVIEW_MIGRATION);
  const paidSuiteExecutionIndex = names.indexOf(PAID_SUITE_EXECUTION_MIGRATION);
  const globalSettlementBudgetIndex = names.indexOf(GLOBAL_SETTLEMENT_BUDGET_INDEX_MIGRATION);
  const globalReservationBudgetIndex = names.indexOf(GLOBAL_RESERVATION_BUDGET_INDEX_MIGRATION);
  if (executionIndex < 0
    || names[executionIndex + 1] !== PLAN_ACTIVITY_MIGRATION
    || names[executionIndex + 2] !== OUTPUT_JOB_OWNERSHIP_MIGRATION
    || names.filter((name) => name === EXECUTION_MIGRATION).length !== 1
    || names.filter((name) => name === PLAN_ACTIVITY_MIGRATION).length !== 1
    || names.filter((name) => name === OUTPUT_JOB_OWNERSHIP_MIGRATION).length !== 1) {
    throw new Error(
      `${EXECUTION_MIGRATION}, ${PLAN_ACTIVITY_MIGRATION}, and ${OUTPUT_JOB_OWNERSHIP_MIGRATION} must be one unique consecutive migration block`,
    );
  }
  if (editOutputGuardIndex <= executionIndex
    || candidateChainingIndex !== editOutputGuardIndex + 1
    || candidateContractIndex !== candidateChainingIndex + 1
    || candidateScopeIndex !== candidateContractIndex + 1
    || candidateDependencyIndex !== candidateScopeIndex + 1
    || candidateAuthorityLockIndex !== candidateDependencyIndex + 1
    || candidateMutationSerializationIndex !== candidateAuthorityLockIndex + 1
    || unboundCandidateRejectionIndex !== candidateMutationSerializationIndex + 1
    || workflowHistoryIndex !== unboundCandidateRejectionIndex + 1
    || workflowPriorityIndex !== workflowHistoryIndex + 1
    || applicationMutationIndex !== workflowPriorityIndex + 1
    || applicationAuthorityIndex !== applicationMutationIndex + 1
    || listingDraftSourceKeyIndex !== applicationAuthorityIndex + 1
    || listingDraftContextColumnsIndex !== listingDraftSourceKeyIndex + 1
    || listingDraftWorkflowIndexIndex !== listingDraftContextColumnsIndex + 1
    || listingDraftContextFkIndex !== listingDraftWorkflowIndexIndex + 1
    || listingDraftCandidateScopeIndex !== listingDraftContextFkIndex + 1
    || listingDraftApplicationMutationIndex !== listingDraftCandidateScopeIndex + 1
    || listingDraftApplicationAuthorityIndex !== listingDraftApplicationMutationIndex + 1
    || listingDraftProjectionFixIndex !== listingDraftApplicationAuthorityIndex + 1
    || listingDraftActorAuthorityIndex !== listingDraftProjectionFixIndex + 1
    || providerReconciliationStateIndex !== listingDraftActorAuthorityIndex + 1
    || providerReconciliationHardeningIndex !== providerReconciliationStateIndex + 1
    || providerReconciliationWorkflowIndexIndex !== providerReconciliationHardeningIndex + 1
    || providerReconciliationEventIndex !== providerReconciliationWorkflowIndexIndex + 1
    || providerReconciliationIdentityIndex !== providerReconciliationEventIndex + 1
    || providerReconciliationAnomalyIndex !== providerReconciliationIdentityIndex + 1
    || providerReconciliationLeaseIndexIndex !== providerReconciliationAnomalyIndex + 1
    || providerReconciliationDeadlineIndex !== providerReconciliationLeaseIndexIndex + 1
    || names.filter((name) => name === EDIT_OUTPUT_GUARD_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_CHAINING_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_CONTRACT_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_SCOPE_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_DEPENDENCY_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_AUTHORITY_LOCK_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_MUTATION_SERIALIZATION_MIGRATION).length !== 1
    || names.filter((name) => name === UNBOUND_CANDIDATE_REJECTION_MIGRATION).length !== 1
    || names.filter((name) => name === WORKFLOW_HISTORY_INDEX_MIGRATION).length !== 1
    || names.filter((name) => name === WORKFLOW_PRIORITY_INDEX_MIGRATION).length !== 1
    || names.filter((name) => name === APPLICATION_MUTATION_MIGRATION).length !== 1
    || names.filter((name) => name === APPLICATION_AUTHORITY_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_SOURCE_KEY_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_CONTEXT_COLUMNS_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_WORKFLOW_INDEX_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_CONTEXT_FK_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_CANDIDATE_SCOPE_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_APPLICATION_MUTATION_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_APPLICATION_AUTHORITY_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_PROJECTION_FIX_MIGRATION).length !== 1
    || names.filter((name) => name === LISTING_DRAFT_ACTOR_AUTHORITY_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_STATE_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_HARDENING_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_WORKFLOW_INDEX_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_EVENT_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_IDENTITY_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_ANOMALY_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_LEASE_INDEX_MIGRATION).length !== 1
    || names.filter((name) => name === PROVIDER_RECONCILIATION_DEADLINE_MIGRATION).length !== 1) {
    throw new Error(
      `${EDIT_OUTPUT_GUARD_MIGRATION} through ${PROVIDER_RECONCILIATION_DEADLINE_MIGRATION} must be one unique consecutive migration block`,
    );
  }
  if (extensionMediaReviewIndex !== providerReconciliationDeadlineIndex + 1
    || paidSuiteExecutionIndex !== extensionMediaReviewIndex + 1
    || globalSettlementBudgetIndex !== paidSuiteExecutionIndex + 1
    || globalReservationBudgetIndex !== globalSettlementBudgetIndex + 1
    || names.filter((name) => name === EXTENSION_MEDIA_REVIEW_MIGRATION).length !== 1
    || names.filter((name) => name === PAID_SUITE_EXECUTION_MIGRATION).length !== 1
    || names.filter((name) => name === GLOBAL_SETTLEMENT_BUDGET_INDEX_MIGRATION).length !== 1
    || names.filter((name) => name === GLOBAL_RESERVATION_BUDGET_INDEX_MIGRATION).length !== 1) {
    throw new Error(
      `${EXTENSION_MEDIA_REVIEW_MIGRATION} through ${GLOBAL_RESERVATION_BUDGET_INDEX_MIGRATION} must be one unique consecutive migration block`,
    );
  }

  mkdirSync(join(tempPrismaRoot, 'migrations'), { recursive: true });
  copyFileSync(join(prismaRoot, 'schema.prisma'), tempSchemaPath);
  copyFileSync(
    join(migrationsRoot, 'migration_lock.toml'),
    join(tempPrismaRoot, 'migrations', 'migration_lock.toml'),
  );
  for (const name of names.slice(0, executionIndex)) {
    cpSync(
      join(migrationsRoot, name),
      join(tempPrismaRoot, 'migrations', name),
      { recursive: true, errorOnExist: true },
    );
  }
  return {
    names,
    executionIndex,
    editOutputGuardIndex,
    candidateChainingIndex,
    candidateDependencyIndex,
    candidateAuthorityLockIndex,
    candidateMutationSerializationIndex,
    unboundCandidateRejectionIndex,
    workflowHistoryIndex,
    workflowPriorityIndex,
    applicationMutationIndex,
    applicationAuthorityIndex,
    listingDraftSourceKeyIndex,
    listingDraftContextColumnsIndex,
    listingDraftWorkflowIndexIndex,
    listingDraftContextFkIndex,
    listingDraftCandidateScopeIndex,
    listingDraftApplicationMutationIndex,
    listingDraftApplicationAuthorityIndex,
    listingDraftProjectionFixIndex,
    listingDraftActorAuthorityIndex,
    providerReconciliationStateIndex,
    providerReconciliationHardeningIndex,
    providerReconciliationWorkflowIndexIndex,
    providerReconciliationEventIndex,
    providerReconciliationIdentityIndex,
    providerReconciliationAnomalyIndex,
    providerReconciliationLeaseIndexIndex,
    providerReconciliationDeadlineIndex,
    extensionMediaReviewIndex,
    paidSuiteExecutionIndex,
    globalSettlementBudgetIndex,
    globalReservationBudgetIndex,
  };
}

function addHistoricalMigrationRange(names, startIndex, endIndex) {
  for (const name of names.slice(startIndex, endIndex + 1)) {
    cpSync(
      join(migrationsRoot, name),
      join(tempPrismaRoot, 'migrations', name),
      { recursive: true, errorOnExist: true },
    );
  }
}

async function seedLegacySuccessfulEditFixture(client, options = {}) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ownerUserId = `upgrade_edit_owner_${suffix}`;
  const goodsId = `upgrade_edit_goods_${suffix}`;
  const subjectId = `upgrade_edit_subject_${suffix}`;
  const snapshotId = `upgrade_edit_snapshot_${suffix}`;
  const sourceAssetId = `upgrade_edit_source_${suffix}`;
  const workflowId = `upgrade_edit_workflow_${suffix}`;
  const jobId = `upgrade_edit_job_${suffix}`;
  const rawAssetId = `upgrade_edit_raw_${suffix}`;
  const finalAssetId = `upgrade_edit_final_${suffix}`;
  const sourceSha256 = 'a'.repeat(64);
  const workflowCreatedAt = new Date(Date.now() - 120_000);
  const workflowCompletedAt = new Date(Date.now() - 60_000);

  await client.user.create({ data: {
    id: ownerUserId,
    phone: `upgrade_edit_${suffix}`,
    passwordHash: 'integration-test',
  } });
  await client.supplyGoods.create({ data: {
    id: goodsId,
    userId: ownerUserId,
    title: 'Legacy AI edit upgrade fixture',
    sourcePlatform: '1688',
    sourceProductId: `upgrade_product_${suffix}`,
    images: ['https://cdn.example/legacy-source.png'],
  } });
  await client.sourceCaptureSubject.create({ data: {
    id: subjectId,
    ownerUserId,
    sourcePlatform: '1688',
    sourceProductId: `upgrade_product_${suffix}`,
    legacySupplyGoodsId: goodsId,
  } });
  await client.sourceCaptureSnapshot.create({ data: {
    id: snapshotId,
    subjectId,
    version: 1,
    schemaVersion: 'source-product-capture-v2',
    captureHash: 'b'.repeat(64),
    payloadBytes: 2,
    payload: {},
    stageCounts: {},
    provenance: {},
    provenanceComplete: true,
    parserVersion: 'upgrade-integration',
    completeness: {},
    truncations: [],
    hasEstimatedValues: false,
    profile: {},
    profileHash: 'c'.repeat(64),
    actorUserId: ownerUserId,
    ingestChannel: 'WEB_ACCOUNT',
    rolloutRevision: 'upgrade-integration',
    rolloutStage: 'v2_only',
    capturedAt: new Date(),
  } });
  await client.mediaAsset.create({ data: {
    id: sourceAssetId,
    ownerUserId,
    kind: 'SOURCE_ORIGINAL',
    sourceCaptureSnapshotId: snapshotId,
    sourceMediaKey: 'legacy-main-1',
    sourceUrl: 'https://source.example/legacy-main.png',
    url: `/uploads/${sourceAssetId}.png`,
    storageBackend: 'local',
    storageKey: `${sourceAssetId}.png`,
    mimeType: 'image/png',
    sizeBytes: 68,
    width: 1,
    height: 1,
    sha256: sourceSha256,
    metadata: { pixelOrientationNormalized: true },
  } });

  await client.$transaction(async (tx) => {
    await tx.aiMediaWorkflow.create({ data: {
      id: workflowId,
      ownerUserId,
      actorUserId: ownerUserId,
      operation: 'FULL_EDIT',
      status: 'SUCCEEDED',
      reviewStatus: 'PENDING',
      requestFingerprint: 'd'.repeat(64),
      currentAttempt: 1,
      contextType: 'collect',
      contextId: goodsId,
      createdAt: workflowCreatedAt,
      completedAt: workflowCompletedAt,
    } });
    await tx.aiMediaWorkflowInput.create({ data: {
      id: `upgrade_edit_input_${suffix}`,
      workflowId,
      ownerUserId,
      assetId: sourceAssetId,
      role: 'REFERENCE',
      ordinal: 0,
      assetSha256: sourceSha256,
      assetUrl: `/uploads/${sourceAssetId}.png`,
      mimeType: 'image/png',
      width: 1,
      height: 1,
    } });
    await tx.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId,
      actorUserId: ownerUserId,
      status: 'SUCCEEDED',
      operation: 'FULL_EDIT',
      workflowId,
      workflowAttempt: 1,
      provider: 'fake',
      model: 'legacy-edit-v1',
      prompt: 'Legacy frozen edit prompt',
      resolvedPrompt: 'Legacy frozen edit prompt',
      requestFingerprint: 'd'.repeat(64),
      inputAssets: [{
        assetId: sourceAssetId,
        role: 'REFERENCE',
        ordinal: 0,
        sha256: sourceSha256,
        sizeBytes: 68,
      }],
      requestedImageCount: 1,
      width: 1,
      height: 1,
      maxAttempts: 1,
      idempotencyKey: `upgrade-edit-${suffix}:attempt:1`,
      progress: 100,
      completedAt: new Date(),
      billedUnits: 1,
    } });
    await tx.mediaAsset.create({ data: {
      id: rawAssetId,
      ownerUserId,
      aiImageJobId: jobId,
      kind: 'AI_PROVIDER_OUTPUT',
      url: `/uploads/${rawAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${rawAssetId}.png`,
      mimeType: 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      sha256: 'e'.repeat(64),
      metadata: { outputRole: 'PROVIDER_RAW', operation: 'FULL_EDIT' },
    } });
    await tx.mediaAsset.create({ data: {
      id: finalAssetId,
      ownerUserId,
      aiImageJobId: jobId,
      kind: 'AI_GENERATED',
      url: `/uploads/${finalAssetId}.png`,
      storageBackend: 'local',
      storageKey: `${finalAssetId}.png`,
      sourceCaptureSnapshotId: options.candidateContract ? snapshotId : undefined,
      mimeType: options.finalMimeType || 'image/png',
      sizeBytes: 68,
      width: 1,
      height: 1,
      sha256: 'f'.repeat(64),
      metadata: {
        outputRole: 'FINAL_CANDIDATE',
        operation: 'FULL_EDIT',
        providerOutputAssetId: rawAssetId,
        ...(options.candidateContract ? {
          pixelOrientationNormalized: true,
          editSourceContractVersion: 'ai-media-edit-source/v1',
        } : {}),
      },
    } });
  }, { isolationLevel: 'Serializable' });

  return {
    workflowId,
    jobId,
    finalAssetId,
    ownerUserId,
    goodsId,
    snapshotId,
  };
}

async function seedProviderReconciliationDeadlineFixture(client, ownerUserId) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const jobId = `upgrade_provider_reconciliation_job_${suffix}`;
  const seededAt = new Date();
  const initialDeadlineAt = new Date(seededAt.getTime() + 15 * 60 * 1000);

  await client.aiImageJob.create({ data: {
    id: jobId,
    ownerUserId,
    actorUserId: ownerUserId,
    status: 'FAILED',
    operation: 'IMAGE_TRANSLATE',
    provider: 'fake',
    model: 'historical-reconciliation-fixture',
    prompt: 'Historical accepted Provider task; never submit again',
    resolvedPrompt: 'Historical accepted Provider task; never submit again',
    requestFingerprint: '9'.repeat(64),
    requestedImageCount: 1,
    width: 1,
    height: 1,
    attemptCount: 1,
    maxAttempts: 1,
    providerDispatchedAt: seededAt,
    providerJobId: `historical-provider-task-${suffix}`,
    providerReconciliationStatus: 'PENDING',
    providerReconciliationRevision: 1,
    providerReconciliationNextAt: seededAt,
    providerReconciliationDeadlineAt: initialDeadlineAt,
    providerReconciliationLastErrorCode: 'PROVIDER_POLL_TIMEOUT',
    providerReconciliationLastErrorMessage: 'Historical task accepted before deadline extension',
    errorCode: 'PROVIDER_POLL_TIMEOUT',
    errorMessage: 'Historical task accepted before H4 deadline extension',
    completedAt: seededAt,
  } });

  return {
    jobId,
    minimumExtendedDeadlineAt: new Date(seededAt.getTime() + 23 * 60 * 60 * 1000),
  };
}

async function seedCandidateConsumerFixture(client, origin) {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const workflowId = `upgrade_invalid_consumer_${suffix}`;
  const jobId = `upgrade_invalid_consumer_job_${suffix}`;
  const candidate = await client.mediaAsset.findUniqueOrThrow({
    where: { id: origin.finalAssetId },
  });

  await client.$transaction(async (tx) => {
    await tx.aiMediaWorkflow.create({ data: {
      id: workflowId,
      ownerUserId: origin.ownerUserId,
      actorUserId: origin.ownerUserId,
      operation: 'FULL_EDIT',
      status: 'QUEUED',
      reviewStatus: 'NOT_READY',
      requestFingerprint: '1'.repeat(64),
      currentAttempt: 1,
      contextType: 'collect',
      contextId: origin.goodsId,
    } });
    await tx.aiMediaWorkflowInput.create({ data: {
      id: `upgrade_invalid_consumer_input_${suffix}`,
      workflowId,
      ownerUserId: origin.ownerUserId,
      assetId: candidate.id,
      role: 'REFERENCE',
      ordinal: 0,
      assetSha256: candidate.sha256,
      assetUrl: candidate.url,
      mimeType: candidate.mimeType,
      width: candidate.width,
      height: candidate.height,
    } });
    await tx.aiImageJob.create({ data: {
      id: jobId,
      ownerUserId: origin.ownerUserId,
      actorUserId: origin.ownerUserId,
      status: 'QUEUED',
      operation: 'FULL_EDIT',
      workflowId,
      workflowAttempt: 1,
      provider: 'fake',
      model: 'invalid-upgrade-edit-v1',
      prompt: 'Invalid candidate upgrade fixture',
      resolvedPrompt: 'Invalid candidate upgrade fixture',
      requestFingerprint: '1'.repeat(64),
      inputAssets: [{
        assetId: candidate.id,
        role: 'REFERENCE',
        ordinal: 0,
        sha256: candidate.sha256,
        sizeBytes: candidate.sizeBytes,
      }],
      requestedImageCount: 1,
      width: candidate.width,
      height: candidate.height,
      maxAttempts: 1,
      idempotencyKey: `upgrade-invalid-consumer-${suffix}:attempt:1`,
    } });
  }, { isolationLevel: 'Serializable' });

  return { workflowId, jobId };
}

async function validateCandidateConsumerFixture(client, fixture, ownerUserId, expectedMimeType) {
  const workflow = await client.aiMediaWorkflow.findFirst({
    where: { id: fixture.workflowId, ownerUserId },
    include: { inputs: { include: { asset: true } } },
  });
  const source = workflow?.inputs?.find((input) => input.role === 'REFERENCE')?.asset;
  if (!workflow
    || source?.kind !== 'AI_GENERATED'
    || source?.mimeType !== expectedMimeType
    || source?.metadata?.editSourceContractVersion !== 'ai-media-edit-source/v1'
    || source?.metadata?.pixelOrientationNormalized !== true) {
    throw new Error(`Candidate upgrade fixture does not match ${expectedMimeType}`);
  }
  await client.$queryRawUnsafe(
    'SELECT assert_standalone_ai_image_edit_graph($1::text, $2::text)::text AS "result"',
    fixture.workflowId,
    ownerUserId,
  );
  await client.$queryRawUnsafe(
    'SELECT assert_ai_image_edit_candidate_contract($1::text, $2::text)::text AS "result"',
    fixture.workflowId,
    ownerUserId,
  );
  await client.$queryRawUnsafe(
    'SELECT assert_ai_image_edit_candidate_scope($1::text, $2::text)::text AS "result"',
    fixture.workflowId,
    ownerUserId,
  );
}

async function validateLegacyEditUpgrade(client, fixture) {
  const workflow = await client.aiMediaWorkflow.findFirst({
    where: { id: fixture.workflowId, ownerUserId: fixture.ownerUserId },
    include: {
      inputs: { include: { asset: true } },
      jobs: { include: { assets: true } },
    },
  });
  const source = workflow?.inputs?.find((input) => input.role === 'REFERENCE')?.asset;
  const final = workflow?.jobs?.flatMap((job) => job.assets || [])
    .find((asset) => asset.id === fixture.finalAssetId);
  if (!workflow
    || workflow.status !== 'SUCCEEDED'
    || source?.kind !== 'SOURCE_ORIGINAL'
    || final?.kind !== 'AI_GENERATED'
    || final?.metadata?.editSourceContractVersion != null) {
    throw new Error('Legacy AI edit graph did not survive candidate-authority migrations exactly');
  }
  await client.$queryRawUnsafe(
    'SELECT assert_standalone_ai_image_edit_graph($1::text, $2::text)::text AS "result"',
    fixture.workflowId,
    fixture.ownerUserId,
  );
  await client.$queryRawUnsafe(
    'SELECT assert_ai_image_edit_candidate_contract($1::text, $2::text)::text AS "result"',
    fixture.workflowId,
    fixture.ownerUserId,
  );
}

async function addAiMediaContextCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_workflows"
      ADD COLUMN "context_draft_revision" INTEGER,
      ADD COLUMN "context_draft_version" INTEGER
  `);
}

async function addAiProviderReconciliationCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    CREATE TYPE "AiProviderReconciliationStatus" AS ENUM (
      'NOT_REQUIRED',
      'PENDING',
      'RUNNING',
      'RETRY_WAIT',
      'MANUAL_REVIEW',
      'RECOVERED',
      'NO_OUTPUT',
      'NOT_SUBMITTED',
      'CANCELLED_OUTPUT_RETAINED'
    )
  `);
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_image_jobs"
      ADD COLUMN "provider_reconciliation_status" "AiProviderReconciliationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
      ADD COLUMN "provider_reconciliation_revision" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN "provider_reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN "provider_reconciliation_next_at" TIMESTAMP(3),
      ADD COLUMN "provider_reconciliation_deadline_at" TIMESTAMP(3),
      ADD COLUMN "provider_reconciliation_lease_owner" VARCHAR(100),
      ADD COLUMN "provider_reconciliation_lease_token_hash" CHAR(64),
      ADD COLUMN "provider_reconciliation_lease_expires_at" TIMESTAMP(3),
      ADD COLUMN "provider_reconciliation_last_provider_status" VARCHAR(100),
      ADD COLUMN "provider_reconciliation_last_error_code" VARCHAR(100),
      ADD COLUMN "provider_reconciliation_last_error_message" VARCHAR(500),
      ADD COLUMN "provider_reconciled_at" TIMESTAMP(3)
  `);
}

async function addCurrentClientCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_suite_slots"
      ADD COLUMN "execution_claim_token" CHAR(64),
      ADD COLUMN "execution_lease_expires_at" TIMESTAMP(3)
  `);
  await addAiMediaContextCompatibilityColumns(client);
  await addAiProviderReconciliationCompatibilityColumns(client);
}

async function dropAiMediaContextCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_workflows"
      DROP COLUMN "context_draft_revision",
      DROP COLUMN "context_draft_version"
  `);
  const rows = await client.$queryRawUnsafe(`
    SELECT count(*)::int AS "count"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ai_media_workflows'
      AND column_name IN ('context_draft_revision', 'context_draft_version')
  `);
  if (Number(rows[0]?.count) !== 0) {
    throw new Error('Temporary AI media context compatibility columns were not removed before H3a migrations');
  }
}

async function dropAiProviderReconciliationCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_image_jobs"
      DROP COLUMN "provider_reconciliation_status",
      DROP COLUMN "provider_reconciliation_revision",
      DROP COLUMN "provider_reconciliation_attempt_count",
      DROP COLUMN "provider_reconciliation_next_at",
      DROP COLUMN "provider_reconciliation_deadline_at",
      DROP COLUMN "provider_reconciliation_lease_owner",
      DROP COLUMN "provider_reconciliation_lease_token_hash",
      DROP COLUMN "provider_reconciliation_lease_expires_at",
      DROP COLUMN "provider_reconciliation_last_provider_status",
      DROP COLUMN "provider_reconciliation_last_error_code",
      DROP COLUMN "provider_reconciliation_last_error_message",
      DROP COLUMN "provider_reconciled_at"
  `);
  await client.$executeRawUnsafe('DROP TYPE "AiProviderReconciliationStatus"');
  const [columns, enumTypes] = await Promise.all([
    client.$queryRawUnsafe(`
      SELECT count(*)::int AS "count"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ai_image_jobs'
        AND (
          column_name LIKE 'provider_reconciliation_%'
          OR column_name = 'provider_reconciled_at'
        )
    `),
    client.$queryRawUnsafe(`
      SELECT count(*)::int AS "count"
      FROM pg_type type_state
      JOIN pg_namespace namespace_state ON namespace_state.oid = type_state.typnamespace
      WHERE namespace_state.nspname = current_schema()
        AND type_state.typname = 'AiProviderReconciliationStatus'
    `),
  ]);
  if (Number(columns[0]?.count) !== 0 || Number(enumTypes[0]?.count) !== 0) {
    throw new Error('Temporary AI Provider reconciliation compatibility schema was not removed before H4 migrations');
  }
}

async function loadAndValidateMaterializedFixtures(client) {
  const suites = await client.$queryRawUnsafe(`
    SELECT "id", "owner_user_id", "actor_user_id"
    FROM "ai_media_suites"
    WHERE "revision" = 4 AND "status" = 'PLANNED'
    ORDER BY "id"
  `);
  if (!Array.isArray(suites) || suites.length !== 2) {
    throw new Error(`Expected exactly two revision-4 materialized suites, found ${suites?.length ?? 0}`);
  }
  for (const fixture of suites) {
    await client.$queryRawUnsafe(
      'SELECT assert_ai_media_suite_materialized_graph($1::text, $2::text)::text AS "result"',
      fixture.id,
      fixture.owner_user_id,
    );
    await client.$queryRawUnsafe(
      'SELECT assert_ai_media_suite_materialized_authority($1::text, $2::text)::text AS "result"',
      fixture.id,
      fixture.owner_user_id,
    );
    const counts = await client.$queryRawUnsafe(`
      SELECT
        (SELECT count(*)::int FROM "ai_media_suite_slots" WHERE "suite_id" = $1) AS "slots",
        (SELECT count(*)::int FROM "ai_media_workflows" workflow
          JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id" = workflow."id"
          WHERE slot."suite_id" = $1) AS "workflows",
        (SELECT count(*)::int FROM "ai_image_jobs" job
          JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id" = job."workflow_id"
          WHERE slot."suite_id" = $1) AS "jobs",
        (SELECT count(*)::int FROM "ai_cost_reservations" reservation
          JOIN "ai_media_suite_slots" slot ON slot."child_workflow_id" = reservation."workflow_id"
          WHERE slot."suite_id" = $1) AS "reservations"
    `, fixture.id);
    const graphCounts = counts[0];
    if (!graphCounts
      || Number(graphCounts.slots) < 1
      || Number(graphCounts.slots) !== Number(graphCounts.workflows)
      || Number(graphCounts.slots) !== Number(graphCounts.jobs)
      || Number(graphCounts.slots) !== Number(graphCounts.reservations)) {
      throw new Error('Revision-4 populated fixture child graph is incomplete');
    }
  }
  return suites.map((fixture) => ({
    suiteId: String(fixture.id),
    ownerUserId: String(fixture.owner_user_id),
    actorUserId: String(fixture.actor_user_id),
  }));
}

async function validateLegacyFakeSuiteOutputUpgrade(client, fixture, expectedBackfilled) {
  const rows = await client.$queryRawUnsafe(`
    SELECT
      asset."id" AS "assetId",
      asset."source_capture_snapshot_id" AS "assetSnapshotId",
      asset."metadata"->>'version' AS "metadataVersion",
      asset."metadata"->>'suiteId' AS "metadataSuiteId",
      asset."metadata"->>'slotId' AS "metadataSlotId",
      asset."metadata"->>'attempt' AS "metadataAttempt",
      suite."source_capture_snapshot_id" AS "suiteSnapshotId",
      suite."provider" AS "provider",
      suite."status" AS "suiteStatus",
      suite."item_count" AS "itemCount",
      slot."id" AS "slotId",
      slot."attempt" AS "slotAttempt"
    FROM "ai_media_suites" suite
    JOIN "ai_media_suite_slots" slot
      ON slot."suite_id" = suite."id"
     AND slot."owner_user_id" = suite."owner_user_id"
    JOIN "ai_media_workflows" workflow
      ON workflow."id" = slot."child_workflow_id"
     AND workflow."owner_user_id" = slot."owner_user_id"
    JOIN "ai_image_jobs" job
      ON job."workflow_id" = workflow."id"
     AND job."owner_user_id" = workflow."owner_user_id"
     AND job."workflow_attempt" = slot."attempt"
    JOIN "media_assets" asset
      ON asset."ai_image_job_id" = job."id"
     AND asset."owner_user_id" = job."owner_user_id"
    WHERE suite."id" = $1
      AND suite."owner_user_id" = $2
      AND asset."kind" = 'AI_GENERATED'
    ORDER BY slot."ordinal"
  `, fixture.suiteId, fixture.ownerUserId);
  const itemCount = Number(rows[0]?.itemCount || 0);
  if (itemCount < 1 || rows.length !== itemCount
    || rows.some((row) => row.provider !== 'fake'
      || row.suiteStatus !== 'SUCCEEDED'
      || row.metadataVersion !== 'ai-image-suite-output/v1'
      || row.metadataSuiteId !== fixture.suiteId
      || row.metadataSlotId !== row.slotId
      || Number(row.metadataAttempt) !== Number(row.slotAttempt)
      || (expectedBackfilled
        ? row.assetSnapshotId !== row.suiteSnapshotId
        : row.assetSnapshotId !== null))) {
    throw new Error(
      expectedBackfilled
        ? 'Legacy fake suite outputs were not backfilled to the exact suite capture snapshot'
        : 'Legacy fake suite seed does not match the legal pre-upgrade missing-snapshot shape',
    );
  }
  await client.$queryRawUnsafe(
    'SELECT assert_ai_media_suite_execution_graph($1::text, $2::text)::text AS "result"',
    fixture.suiteId,
    fixture.ownerUserId,
  );
  if (expectedBackfilled) {
    const triggers = await client.$queryRawUnsafe(`
      SELECT trigger_state.tgname AS "name", trigger_state.tgenabled AS "enabled"
      FROM pg_trigger trigger_state
      WHERE trigger_state.tgrelid = 'media_assets'::regclass
        AND trigger_state.tgname IN (
          'media_assets_referenced_identity_immutable',
          'media_assets_suite_child_identity_protected'
        )
      ORDER BY trigger_state.tgname
    `);
    if (triggers.length !== 2 || triggers.some((trigger) => trigger.enabled !== 'O')) {
      throw new Error('AI media asset identity triggers were not restored after legacy backfill');
    }
  }
}

async function restoreExactHistoricalSchema(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_suite_slots"
      DROP COLUMN "execution_claim_token",
      DROP COLUMN "execution_lease_expires_at"
  `);
  const rows = await client.$queryRawUnsafe(`
    SELECT count(*)::int AS "count"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ai_media_suite_slots'
      AND column_name IN ('execution_claim_token', 'execution_lease_expires_at')
  `);
  if (Number(rows[0]?.count) !== 0) {
    throw new Error('Temporary Prisma compatibility columns were not removed before migration 95');
  }
}

async function validateWorkflowHistoryIndexes(client) {
  const rows = await client.$queryRawUnsafe(`
    SELECT
      index_class.relname AS "name",
      index_namespace.nspname AS "indexSchema",
      table_class.relname AS "tableName",
      table_namespace.nspname AS "tableSchema",
      index_state.indisvalid AS "valid",
      index_state.indisready AS "ready",
      array_agg(attribute.attname ORDER BY key.ordinality) AS "columns",
      array_agg(
        CASE WHEN pg_index_column_has_property(index_state.indexrelid, key.ordinality::int, 'desc')
          THEN 'DESC'
          ELSE 'ASC'
        END
        ORDER BY key.ordinality
      ) AS "directions"
    FROM pg_index index_state
    JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    JOIN pg_class table_class ON table_class.oid = index_state.indrelid
    JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
    JOIN LATERAL unnest(index_state.indkey) WITH ORDINALITY AS key(attnum, ordinality)
      ON key.ordinality <= index_state.indnkeyatts
    JOIN pg_attribute attribute
      ON attribute.attrelid = table_class.oid
      AND attribute.attnum = key.attnum
    WHERE index_namespace.nspname = current_schema()
      AND table_namespace.nspname = current_schema()
      AND table_class.relname = 'ai_media_workflows'
      AND index_class.relname IN (
        'ai_media_workflow_owner_context_history',
        'ai_media_workflow_owner_context_updates'
      )
    GROUP BY
      index_class.relname,
      index_namespace.nspname,
      table_class.relname,
      table_namespace.nspname,
      index_state.indisvalid,
      index_state.indisready
    ORDER BY index_class.relname
  `);
  const expected = new Map([
    ['ai_media_workflow_owner_context_history', {
      columns: ['owner_user_id', 'context_type', 'context_id', 'created_at', 'id'],
      directions: ['ASC', 'ASC', 'ASC', 'DESC', 'DESC'],
    }],
    ['ai_media_workflow_owner_context_updates', {
      columns: ['owner_user_id', 'context_type', 'context_id', 'updated_at', 'id'],
      directions: ['ASC', 'ASC', 'ASC', 'DESC', 'DESC'],
    }],
  ]);
  if (rows.length !== expected.size) throw new Error('AI media workflow history indexes are missing');
  for (const row of rows) {
    const contract = expected.get(String(row.name));
    if (!contract
      || row.indexSchema !== schema
      || row.tableSchema !== schema
      || row.tableName !== 'ai_media_workflows'
      || row.valid !== true
      || row.ready !== true
      || JSON.stringify(row.columns) !== JSON.stringify(contract.columns)
      || JSON.stringify(row.directions) !== JSON.stringify(contract.directions)) {
      throw new Error(`AI media workflow history index is invalid: ${String(row.name)}`);
    }
  }
}

async function validateListingDraftApplicationLedger(client) {
  const [tables, indexes, triggers, migrations] = await Promise.all([
    client.$queryRawUnsafe(`
      SELECT count(*)::int AS "count"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'ai_media_listing_draft_application_mutations'
    `),
    client.$queryRawUnsafe(`
      SELECT index_class.relname AS "name", index_state.indisvalid AS "valid",
             index_state.indisready AS "ready"
      FROM pg_index index_state
      JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_state.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_media_listing_draft_application_mutations'
        AND index_class.relname IN (
          'ai_media_listing_draft_mutation_operation_key',
          'ai_media_listing_draft_mutation_target_sequence_key',
          'ai_media_listing_draft_mutation_target_history_idx',
          'ai_media_listing_draft_mutation_workflow_history_idx',
          'ai_media_listing_draft_mutation_before_idx',
          'ai_media_listing_draft_mutation_after_idx'
        )
      ORDER BY index_class.relname
    `),
    client.$queryRawUnsafe(`
      SELECT trigger_state.tgname AS "name", trigger_state.tgenabled AS "enabled"
      FROM pg_trigger trigger_state
      JOIN pg_class table_class ON table_class.oid = trigger_state.tgrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_media_listing_draft_application_mutations'
        AND NOT trigger_state.tgisinternal
      ORDER BY trigger_state.tgname
    `),
    client.$queryRawUnsafe(`
      SELECT migration_name AS "name"
      FROM "_prisma_migrations"
      WHERE migration_name IN ($1, $2, $3, $4, $5)
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at, id
    `,
    LISTING_DRAFT_CANDIDATE_SCOPE_MIGRATION,
    LISTING_DRAFT_APPLICATION_MUTATION_MIGRATION,
    LISTING_DRAFT_APPLICATION_AUTHORITY_MIGRATION,
    LISTING_DRAFT_PROJECTION_FIX_MIGRATION,
    LISTING_DRAFT_ACTOR_AUTHORITY_MIGRATION),
  ]);
  if (Number(tables[0]?.count) !== 1) {
    throw new Error('AI media listing-draft application ledger table is missing');
  }
  const expectedIndexes = [
    'ai_media_listing_draft_mutation_after_idx',
    'ai_media_listing_draft_mutation_before_idx',
    'ai_media_listing_draft_mutation_operation_key',
    'ai_media_listing_draft_mutation_target_history_idx',
    'ai_media_listing_draft_mutation_target_sequence_key',
    'ai_media_listing_draft_mutation_workflow_history_idx',
  ];
  if (indexes.length !== expectedIndexes.length
    || indexes.some((row, index) => (
      row.name !== expectedIndexes[index] || row.valid !== true || row.ready !== true
    ))) {
    throw new Error('AI media listing-draft application ledger indexes are invalid');
  }
  const expectedTriggers = [
    'ai_media_listing_draft_mutation_actor_insert',
    'ai_media_listing_draft_mutation_authority_insert',
    'ai_media_listing_draft_mutation_immutable',
    'ai_media_listing_draft_mutation_validate_insert',
  ];
  if (triggers.length !== expectedTriggers.length
    || triggers.some((row, index) => row.name !== expectedTriggers[index] || row.enabled !== 'O')) {
    throw new Error('AI media listing-draft application ledger triggers are invalid');
  }
  const expectedMigrations = [
    LISTING_DRAFT_CANDIDATE_SCOPE_MIGRATION,
    LISTING_DRAFT_APPLICATION_MUTATION_MIGRATION,
    LISTING_DRAFT_APPLICATION_AUTHORITY_MIGRATION,
    LISTING_DRAFT_PROJECTION_FIX_MIGRATION,
    LISTING_DRAFT_ACTOR_AUTHORITY_MIGRATION,
  ];
  if (JSON.stringify(migrations.map((row) => row.name)) !== JSON.stringify(expectedMigrations)) {
    throw new Error('AI media listing-draft application migrations are missing or out of order');
  }
}

async function validateAiProviderReconciliationSchema(client, deadlineFixture) {
  const [
    columns,
    enumLabels,
    indexes,
    checks,
    triggers,
    eventTables,
    eventIndexes,
    eventConstraints,
    eventTriggers,
    migrations,
    deadlineRows,
    deadlineEvents,
  ] = await Promise.all([
    client.$queryRawUnsafe(`
      SELECT
        column_name AS "name",
        is_nullable AS "nullable",
        udt_name AS "type",
        character_maximum_length::int AS "length"
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'ai_image_jobs'
        AND (
          column_name LIKE 'provider_reconciliation_%'
          OR column_name = 'provider_reconciled_at'
        )
      ORDER BY column_name
    `),
    client.$queryRawUnsafe(`
      SELECT enum_state.enumlabel AS "label"
      FROM pg_type type_state
      JOIN pg_namespace namespace_state ON namespace_state.oid = type_state.typnamespace
      JOIN pg_enum enum_state ON enum_state.enumtypid = type_state.oid
      WHERE namespace_state.nspname = current_schema()
        AND type_state.typname = 'AiProviderReconciliationStatus'
      ORDER BY enum_state.enumsortorder
    `),
    client.$queryRawUnsafe(`
      SELECT
        index_class.relname AS "name",
        index_state.indisvalid AS "valid",
        index_state.indisready AS "ready",
        array_agg(attribute.attname ORDER BY key.ordinality) AS "columns"
      FROM pg_index index_state
      JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_state.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      JOIN LATERAL unnest(index_state.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        ON key.ordinality <= index_state.indnkeyatts
      JOIN pg_attribute attribute
        ON attribute.attrelid = table_class.oid
        AND attribute.attnum = key.attnum
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_image_jobs'
        AND index_class.relname IN (
          'ai_image_job_provider_reconciliation_due',
          'ai_image_job_provider_reconciliation_lease_due',
          'ai_image_job_workflow_provider_reconciliation'
        )
      GROUP BY index_class.relname, index_state.indisvalid, index_state.indisready
      ORDER BY index_class.relname
    `),
    client.$queryRawUnsafe(`
      SELECT
        constraint_state.conname AS "name",
        constraint_state.contype AS "type",
        constraint_state.convalidated AS "validated"
      FROM pg_constraint constraint_state
      JOIN pg_class table_class ON table_class.oid = constraint_state.conrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_image_jobs'
        AND constraint_state.conname IN (
          'ai_image_job_provider_reconciliation_state_check',
          'ai_image_job_provider_job_id_nonblank_check'
        )
      ORDER BY constraint_state.conname
    `),
    client.$queryRawUnsafe(`
      SELECT trigger_state.tgname AS "name", trigger_state.tgenabled AS "enabled"
      FROM pg_trigger trigger_state
      JOIN pg_class table_class ON table_class.oid = trigger_state.tgrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_image_jobs'
        AND NOT trigger_state.tgisinternal
        AND trigger_state.tgname = 'ai_image_jobs_provider_reconciliation_transition'
    `),
    client.$queryRawUnsafe(`
      SELECT count(*)::int AS "count"
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = 'ai_provider_reconciliation_events'
    `),
    client.$queryRawUnsafe(`
      SELECT
        index_class.relname AS "name",
        index_state.indisunique AS "unique",
        index_state.indisvalid AS "valid",
        index_state.indisready AS "ready",
        array_agg(attribute.attname ORDER BY key.ordinality) AS "columns"
      FROM pg_index index_state
      JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_state.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      JOIN LATERAL unnest(index_state.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        ON key.ordinality <= index_state.indnkeyatts
      JOIN pg_attribute attribute
        ON attribute.attrelid = table_class.oid
        AND attribute.attnum = key.attnum
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_provider_reconciliation_events'
        AND index_class.relname IN (
          'ai_provider_reconciliation_event_job_revision',
          'ai_provider_reconciliation_event_key',
          'ai_provider_reconciliation_event_owner_created',
          'ai_provider_reconciliation_event_workflow_created'
        )
      GROUP BY
        index_class.relname,
        index_state.indisunique,
        index_state.indisvalid,
        index_state.indisready
      ORDER BY index_class.relname
    `),
    client.$queryRawUnsafe(`
      SELECT constraint_state.conname AS "name", constraint_state.contype AS "type",
             constraint_state.convalidated AS "validated"
      FROM pg_constraint constraint_state
      JOIN pg_class table_class ON table_class.oid = constraint_state.conrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_provider_reconciliation_events'
        AND constraint_state.conname IN (
          'ai_provider_reconciliation_event_shape_check',
          'ai_provider_reconciliation_event_job_owner_fkey',
          'ai_provider_reconciliation_event_workflow_owner_fkey',
          'ai_provider_reconciliation_event_actor_fkey'
        )
      ORDER BY constraint_state.conname
    `),
    client.$queryRawUnsafe(`
      SELECT trigger_state.tgname AS "name", trigger_state.tgenabled AS "enabled"
      FROM pg_trigger trigger_state
      JOIN pg_class table_class ON table_class.oid = trigger_state.tgrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      WHERE table_namespace.nspname = current_schema()
        AND table_class.relname = 'ai_provider_reconciliation_events'
        AND NOT trigger_state.tgisinternal
      ORDER BY trigger_state.tgname
    `),
    client.$queryRawUnsafe(`
      SELECT migration_name AS "name"
      FROM "_prisma_migrations"
      WHERE migration_name IN ($1, $2, $3, $4, $5, $6, $7, $8)
        AND finished_at IS NOT NULL
        AND rolled_back_at IS NULL
      ORDER BY started_at, id
    `,
    PROVIDER_RECONCILIATION_STATE_MIGRATION,
    PROVIDER_RECONCILIATION_HARDENING_MIGRATION,
    PROVIDER_RECONCILIATION_WORKFLOW_INDEX_MIGRATION,
    PROVIDER_RECONCILIATION_EVENT_MIGRATION,
    PROVIDER_RECONCILIATION_IDENTITY_MIGRATION,
    PROVIDER_RECONCILIATION_ANOMALY_MIGRATION,
    PROVIDER_RECONCILIATION_LEASE_INDEX_MIGRATION,
    PROVIDER_RECONCILIATION_DEADLINE_MIGRATION),
    client.$queryRawUnsafe(`
      SELECT
        "provider" AS "provider",
        "provider_reconciliation_status"::text AS "status",
        "provider_reconciliation_revision" AS "revision",
        "provider_reconciliation_next_at" AS "nextAt",
        "provider_reconciliation_deadline_at" AS "deadlineAt"
      FROM "ai_image_jobs"
      WHERE "id" = $1
    `, deadlineFixture.jobId),
    client.$queryRawUnsafe(`
      SELECT
        "reconciliation_revision" AS "revision",
        "event_type" AS "eventType",
        "payload" ->> 'schema' AS "payloadSchema",
        "payload" ->> 'source' AS "source",
        "payload" ->> 'status' AS "status",
        ("payload" ->> 'deadlineAt')::timestamp AS "deadlineAt"
      FROM "ai_provider_reconciliation_events"
      WHERE "job_id" = $1
        AND "event_type" = 'PROVIDER_RECONCILIATION_DEADLINE_EXTENDED'
      ORDER BY "created_at", "id"
    `, deadlineFixture.jobId),
  ]);

  const expectedColumns = [
    ['provider_reconciled_at', 'YES', 'timestamp', null],
    ['provider_reconciliation_attempt_count', 'NO', 'int4', null],
    ['provider_reconciliation_deadline_at', 'YES', 'timestamp', null],
    ['provider_reconciliation_last_error_code', 'YES', 'varchar', 100],
    ['provider_reconciliation_last_error_message', 'YES', 'varchar', 500],
    ['provider_reconciliation_last_provider_status', 'YES', 'varchar', 100],
    ['provider_reconciliation_lease_expires_at', 'YES', 'timestamp', null],
    ['provider_reconciliation_lease_owner', 'YES', 'varchar', 100],
    ['provider_reconciliation_lease_token_hash', 'YES', 'bpchar', 64],
    ['provider_reconciliation_next_at', 'YES', 'timestamp', null],
    ['provider_reconciliation_revision', 'NO', 'int4', null],
    ['provider_reconciliation_status', 'NO', 'AiProviderReconciliationStatus', null],
  ];
  const actualColumns = columns.map((column) => [
    column.name,
    column.nullable,
    column.type,
    column.length,
  ]);
  if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
    throw new Error('AI Provider reconciliation columns are missing or invalid');
  }

  const expectedEnumLabels = [
    'NOT_REQUIRED',
    'PENDING',
    'RUNNING',
    'RETRY_WAIT',
    'MANUAL_REVIEW',
    'RECOVERED',
    'NO_OUTPUT',
    'NOT_SUBMITTED',
    'CANCELLED_OUTPUT_RETAINED',
  ];
  if (JSON.stringify(enumLabels.map((row) => row.label)) !== JSON.stringify(expectedEnumLabels)) {
    throw new Error('AI Provider reconciliation status enum is missing or invalid');
  }

  const expectedIndexes = new Map([
    ['ai_image_job_provider_reconciliation_due', [
      'provider_reconciliation_status',
      'provider_reconciliation_next_at',
      'id',
    ]],
    ['ai_image_job_provider_reconciliation_lease_due', [
      'provider_reconciliation_status',
      'provider_reconciliation_lease_expires_at',
      'id',
    ]],
    ['ai_image_job_workflow_provider_reconciliation', [
      'workflow_id',
      'provider_reconciliation_status',
    ]],
  ]);
  if (indexes.length !== expectedIndexes.size
    || indexes.some((row) => (
      row.valid !== true
      || row.ready !== true
      || JSON.stringify(row.columns) !== JSON.stringify(expectedIndexes.get(String(row.name)))
    ))) {
    throw new Error('AI Provider reconciliation indexes are missing or invalid');
  }
  const expectedChecks = [
    'ai_image_job_provider_job_id_nonblank_check',
    'ai_image_job_provider_reconciliation_state_check',
  ];
  if (checks.length !== expectedChecks.length
    || checks.some((row, index) => (
      row.name !== expectedChecks[index] || row.type !== 'c' || row.validated !== true
    ))) {
    throw new Error('AI Provider reconciliation state check is missing or unvalidated');
  }
  if (triggers.length !== 1
    || triggers[0].name !== 'ai_image_jobs_provider_reconciliation_transition'
    || triggers[0].enabled !== 'O') {
    throw new Error('AI Provider reconciliation transition trigger is missing or disabled');
  }
  if (Number(eventTables[0]?.count) !== 1) {
    throw new Error('AI Provider reconciliation event ledger is missing');
  }
  const expectedEventIndexes = new Map([
    ['ai_provider_reconciliation_event_job_revision', {
      unique: false,
      columns: ['job_id', 'reconciliation_revision', 'created_at'],
    }],
    ['ai_provider_reconciliation_event_key', {
      unique: true,
      columns: ['event_key'],
    }],
    ['ai_provider_reconciliation_event_owner_created', {
      unique: false,
      columns: ['owner_user_id', 'created_at'],
    }],
    ['ai_provider_reconciliation_event_workflow_created', {
      unique: false,
      columns: ['workflow_id', 'created_at'],
    }],
  ]);
  if (eventIndexes.length !== expectedEventIndexes.size
    || eventIndexes.some((row) => (
      row.valid !== true
      || row.ready !== true
      || row.unique !== expectedEventIndexes.get(String(row.name))?.unique
      || JSON.stringify(row.columns)
        !== JSON.stringify(expectedEventIndexes.get(String(row.name))?.columns)
    ))) {
    throw new Error('AI Provider reconciliation event indexes are missing or invalid');
  }
  if (eventConstraints.length !== 4
    || eventConstraints.some((row) => row.validated !== true)
    || eventConstraints.filter((row) => row.type === 'f').length !== 3
    || eventConstraints.filter((row) => row.type === 'c').length !== 1) {
    throw new Error('AI Provider reconciliation event constraints are missing or invalid');
  }
  if (eventTriggers.length !== 1
    || eventTriggers[0].name !== 'ai_provider_reconciliation_events_immutable'
    || eventTriggers[0].enabled !== 'O') {
    throw new Error('AI Provider reconciliation event immutability trigger is missing or disabled');
  }
  const expectedMigrations = [
    PROVIDER_RECONCILIATION_STATE_MIGRATION,
    PROVIDER_RECONCILIATION_HARDENING_MIGRATION,
    PROVIDER_RECONCILIATION_WORKFLOW_INDEX_MIGRATION,
    PROVIDER_RECONCILIATION_EVENT_MIGRATION,
    PROVIDER_RECONCILIATION_IDENTITY_MIGRATION,
    PROVIDER_RECONCILIATION_ANOMALY_MIGRATION,
    PROVIDER_RECONCILIATION_LEASE_INDEX_MIGRATION,
    PROVIDER_RECONCILIATION_DEADLINE_MIGRATION,
  ];
  if (JSON.stringify(migrations.map((row) => row.name)) !== JSON.stringify(expectedMigrations)) {
    throw new Error('AI Provider reconciliation migrations are missing or out of order');
  }
  if (deadlineRows.length !== 1
    || deadlineRows[0].provider !== 'fake'
    || deadlineRows[0].status !== 'PENDING'
    || deadlineRows[0].revision !== 2
    || !(deadlineRows[0].nextAt instanceof Date)
    || !(deadlineRows[0].deadlineAt instanceof Date)
    || deadlineRows[0].deadlineAt < deadlineFixture.minimumExtendedDeadlineAt) {
    throw new Error('Historical AI Provider reconciliation deadline was not extended revision-safely');
  }
  if (deadlineEvents.length !== 1
    || deadlineEvents[0].revision !== 2
    || deadlineEvents[0].eventType !== 'PROVIDER_RECONCILIATION_DEADLINE_EXTENDED'
    || deadlineEvents[0].payloadSchema !== 'ai-provider-reconciliation-event/v1'
    || deadlineEvents[0].source !== 'MIGRATION_DEADLINE_EXTENSION'
    || deadlineEvents[0].status !== 'PENDING'
    || !(deadlineEvents[0].deadlineAt instanceof Date)
    || deadlineEvents[0].deadlineAt.getTime() !== deadlineRows[0].deadlineAt.getTime()) {
    throw new Error('Historical AI Provider deadline extension event is missing or invalid');
  }
}

async function validateGlobalAiBudgetIndexes(client) {
  const [indexes, migrations] = await Promise.all([
    client.$queryRawUnsafe(`
      SELECT
        index_class.relname AS "name",
        table_class.relname AS "tableName",
        access_method.amname AS "method",
        index_state.indisunique AS "unique",
        index_state.indisvalid AS "valid",
        index_state.indisready AS "ready",
        index_state.indnkeyatts::int AS "keyCount",
        index_state.indnatts::int AS "attributeCount",
        pg_get_expr(index_state.indpred, index_state.indrelid) AS "predicate",
        ARRAY(
          SELECT attribute_state.attname
          FROM unnest(index_state.indkey::smallint[]) WITH ORDINALITY AS key_state(attnum, ordinal)
          JOIN pg_attribute attribute_state
            ON attribute_state.attrelid = index_state.indrelid
           AND attribute_state.attnum = key_state.attnum
          ORDER BY key_state.ordinal
        ) AS "columns"
      FROM pg_index index_state
      JOIN pg_class index_class ON index_class.oid = index_state.indexrelid
      JOIN pg_class table_class ON table_class.oid = index_state.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      JOIN pg_am access_method ON access_method.oid = index_class.relam
      WHERE table_namespace.nspname = current_schema()
        AND index_class.relname IN (
          'ai_cost_settlements_global_budget_idx',
          'ai_cost_reservations_global_budget_idx'
        )
      ORDER BY index_class.relname
    `),
    client.$queryRawUnsafe(`
      SELECT migration_name AS "name", finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
      FROM "_prisma_migrations"
      WHERE migration_name IN ($1, $2)
      ORDER BY migration_name
    `, GLOBAL_SETTLEMENT_BUDGET_INDEX_MIGRATION, GLOBAL_RESERVATION_BUDGET_INDEX_MIGRATION),
  ]);
  const expected = new Map([
    ['ai_cost_reservations_global_budget_idx', {
      tableName: 'ai_cost_reservations',
      columns: ['status', 'maximum_cost_minor'],
    }],
    ['ai_cost_settlements_global_budget_idx', {
      tableName: 'ai_cost_settlements',
      columns: ['kind', 'created_at', 'actual_cost_minor'],
    }],
  ]);
  if (indexes.length !== expected.size) {
    throw new Error('Global AI budget indexes are missing');
  }
  for (const index of indexes) {
    const definition = expected.get(index.name);
    if (!definition
      || index.tableName !== definition.tableName
      || index.method !== 'btree'
      || index.unique !== false
      || index.valid !== true
      || index.ready !== true
      || index.predicate !== null
      || index.keyCount !== definition.columns.length
      || index.attributeCount !== definition.columns.length
      || JSON.stringify(index.columns) !== JSON.stringify(definition.columns)) {
      throw new Error(`Global AI budget index definition is invalid: ${index.name}`);
    }
  }
  if (migrations.length !== 2
    || migrations.some((migration) => !(migration.finishedAt instanceof Date) || migration.rolledBackAt !== null)) {
    throw new Error('Global AI budget index migrations are not fully applied');
  }
}

async function validatePostMigrationTriggerFiringGuard(client) {
  validateAiMediaSuiteTriggerRows(await loadAiMediaSuiteTriggerRows(client));
  const triggerName = 'ai_media_workflows_suite_selected_output_protected';
  const restoreTrigger = async () => {
    await client.$executeRawUnsafe(`
      DROP TRIGGER IF EXISTS "${triggerName}" ON "ai_media_workflows"
    `);
    await client.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OF "selected_output_asset_id", "review_status" ON "ai_media_workflows"
      FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_selected_output()
    `);
  };
  await client.$executeRawUnsafe(`
    DROP TRIGGER "${triggerName}" ON "ai_media_workflows"
  `);
  await client.$executeRawUnsafe(`
    CREATE TRIGGER "${triggerName}"
    AFTER UPDATE OF "selected_output_asset_id", "review_status" ON "ai_media_workflows"
    FOR EACH ROW EXECUTE FUNCTION protect_ai_media_suite_selected_output()
  `);
  let rejectedError;
  try {
    validateAiMediaSuiteTriggerRows(await loadAiMediaSuiteTriggerRows(client));
  } catch (error) {
    rejectedError = error;
  } finally {
    await restoreTrigger();
  }
  if (!(rejectedError instanceof Error)
    || !rejectedError.message.includes('wrong firing contract')) {
    throw new Error('Post-migration guard accepted a trigger with the wrong firing contract');
  }
  validateAiMediaSuiteTriggerRows(await loadAiMediaSuiteTriggerRows(client));

  await client.$executeRawUnsafe(`CREATE SCHEMA "${foreignFunctionSchema}"`);
  let foreignBindingRejectedError;
  try {
    await client.$executeRawUnsafe(`
      CREATE FUNCTION "${foreignFunctionSchema}".protect_ai_media_suite_selected_output()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        RETURN NEW;
      END;
      $function$
    `);
    await client.$executeRawUnsafe(`
      DROP TRIGGER "${triggerName}" ON "ai_media_workflows"
    `);
    await client.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OF "selected_output_asset_id", "review_status" ON "ai_media_workflows"
      FOR EACH ROW EXECUTE FUNCTION
        "${foreignFunctionSchema}".protect_ai_media_suite_selected_output()
    `);
    validateAiMediaSuiteTriggerRows(await loadAiMediaSuiteTriggerRows(client));
  } catch (error) {
    foreignBindingRejectedError = error;
  } finally {
    await restoreTrigger();
    await client.$executeRawUnsafe(`DROP SCHEMA "${foreignFunctionSchema}" CASCADE`);
  }
  if (!(foreignBindingRejectedError instanceof Error)
    || !foreignBindingRejectedError.message.includes('wrong pg_proc binding')) {
    throw new Error('Post-migration guard accepted a trigger bound to a foreign-schema function');
  }
  validateAiMediaSuiteTriggerRows(await loadAiMediaSuiteTriggerRows(client));
}

const selectedFixtureTests = [
  'allows one serializable claim and exact replay under concurrent requests',
  'rejects cross-authority and forged reference bindings without leaving partial rows',
  'commits repeated candidates once with exact concurrency replay and an audited barrier',
  'freezes one complete Prompt set under concurrency without materializing paid work',
  'materializes the frozen suite atomically into child graphs and replays without dispatch',
].join('|');

let bodyError;
const cleanupErrors = [];

try {
  const migrationStages = prepareHistoricalMigrations();
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  console.log(`[ai-media-postgres-upgrade] schema=${schema} historicalMigrations=${migrationStages.executionIndex}`);

  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await addCurrentClientCompatibilityColumns(fixtureClient);
  for (let fixtureIndex = 0; fixtureIndex < 2; fixtureIndex += 1) {
    run([
      'exec', 'vitest', 'run', '--no-file-parallelism',
      'src/__tests__/ai-image-suite.postgres.integration.test.ts',
      '--testNamePattern', selectedFixtureTests,
    ], {
      DATABASE_URL: testUrl.toString(),
      AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
      RUN_AI_MEDIA_POSTGRES_TESTS: '1',
    });
  }

  const [legacySuiteFixture, fixture] = await loadAndValidateMaterializedFixtures(fixtureClient);
  await restoreExactHistoricalSchema(fixtureClient);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.executionIndex,
    migrationStages.editOutputGuardIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });
  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  const legacyEditFixture = await seedLegacySuccessfulEditFixture(fixtureClient);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.candidateChainingIndex,
    migrationStages.candidateDependencyIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });
  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  const validOrigin = await seedLegacySuccessfulEditFixture(fixtureClient, {
    candidateContract: true,
    finalMimeType: 'image/png',
  });
  const validConsumer = await seedCandidateConsumerFixture(fixtureClient, validOrigin);
  await validateCandidateConsumerFixture(
    fixtureClient,
    validConsumer,
    validOrigin.ownerUserId,
    'image/png',
  );
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  await admin.$executeRawUnsafe(`CREATE SCHEMA "${invalidSchema}"`);
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: invalidTestUrl.toString(),
  });
  invalidFixtureClient = new PrismaClient({
    datasources: { db: { url: invalidTestUrl.toString() } },
  });
  await invalidFixtureClient.$connect();
  await addAiMediaContextCompatibilityColumns(invalidFixtureClient);
  await addAiProviderReconciliationCompatibilityColumns(invalidFixtureClient);
  const invalidOrigin = await seedLegacySuccessfulEditFixture(invalidFixtureClient, {
    candidateContract: true,
    finalMimeType: 'image/webp',
  });
  const invalidConsumer = await seedCandidateConsumerFixture(invalidFixtureClient, invalidOrigin);
  await validateCandidateConsumerFixture(
    invalidFixtureClient,
    invalidConsumer,
    invalidOrigin.ownerUserId,
    'image/webp',
  );
  await invalidFixtureClient.$disconnect();
  invalidFixtureClient = undefined;

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.candidateAuthorityLockIndex,
    migrationStages.candidateAuthorityLockIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });
  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await validateCandidateConsumerFixture(
    fixtureClient,
    validConsumer,
    validOrigin.ownerUserId,
    'image/png',
  );
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  runExpectingFailure(
    ['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath],
    /manual AI image edit candidate contract is invalid|current transaction is aborted/u,
    { DATABASE_URL: invalidTestUrl.toString() },
  );

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.candidateMutationSerializationIndex,
    migrationStages.candidateMutationSerializationIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });
  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await validateCandidateConsumerFixture(
    fixtureClient,
    validConsumer,
    validOrigin.ownerUserId,
    'image/png',
  );
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.unboundCandidateRejectionIndex,
    migrationStages.unboundCandidateRejectionIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });
  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await validateCandidateConsumerFixture(
    fixtureClient,
    validConsumer,
    validOrigin.ownerUserId,
    'image/png',
  );
  await validateLegacyEditUpgrade(fixtureClient, legacyEditFixture);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await dropAiMediaContextCompatibilityColumns(fixtureClient);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;
  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.unboundCandidateRejectionIndex + 1,
    migrationStages.listingDraftActorAuthorityIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await dropAiProviderReconciliationCompatibilityColumns(fixtureClient);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;
  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.providerReconciliationStateIndex,
    migrationStages.providerReconciliationWorkflowIndexIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  const providerDeadlineFixture = await seedProviderReconciliationDeadlineFixture(
    fixtureClient,
    fixture.ownerUserId,
  );
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.providerReconciliationWorkflowIndexIndex + 1,
    migrationStages.paidSuiteExecutionIndex - 1,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });

  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/ai-image-suite-populated-upgrade.postgres.integration.test.ts',
  ], {
    DATABASE_URL: testUrl.toString(),
    AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
    AI_MEDIA_LEGACY_SUITE_ID: legacySuiteFixture.suiteId,
    AI_MEDIA_LEGACY_OWNER_USER_ID: legacySuiteFixture.ownerUserId,
    AI_MEDIA_LEGACY_ACTOR_USER_ID: legacySuiteFixture.actorUserId,
    RUN_AI_MEDIA_LEGACY_SUCCESS_SEED_TESTS: '1',
  });

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await validateLegacyFakeSuiteOutputUpgrade(fixtureClient, legacySuiteFixture, false);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  addHistoricalMigrationRange(
    migrationStages.names,
    migrationStages.paidSuiteExecutionIndex,
    migrationStages.paidSuiteExecutionIndex,
  );
  run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
    DATABASE_URL: testUrl.toString(),
  });

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await validateLegacyFakeSuiteOutputUpgrade(fixtureClient, legacySuiteFixture, true);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  if (migrationStages.paidSuiteExecutionIndex < migrationStages.names.length - 1) {
    addHistoricalMigrationRange(
      migrationStages.names,
      migrationStages.paidSuiteExecutionIndex + 1,
      migrationStages.names.length - 1,
    );
    run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
      DATABASE_URL: testUrl.toString(),
    });
  }

  fixtureClient = new PrismaClient({ datasources: { db: { url: testUrl.toString() } } });
  await fixtureClient.$connect();
  await validateLegacyFakeSuiteOutputUpgrade(fixtureClient, legacySuiteFixture, true);
  await validateWorkflowHistoryIndexes(fixtureClient);
  await validateListingDraftApplicationLedger(fixtureClient);
  await validateAiProviderReconciliationSchema(fixtureClient, providerDeadlineFixture);
  await validateGlobalAiBudgetIndexes(fixtureClient);
  await validatePostMigrationTriggerFiringGuard(fixtureClient);
  await fixtureClient.$disconnect();
  fixtureClient = undefined;

  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/ai-image-suite-populated-upgrade.postgres.integration.test.ts',
  ], {
    DATABASE_URL: testUrl.toString(),
    AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
    AI_MEDIA_UPGRADE_SUITE_ID: fixture.suiteId,
    AI_MEDIA_UPGRADE_OWNER_USER_ID: fixture.ownerUserId,
    AI_MEDIA_UPGRADE_ACTOR_USER_ID: fixture.actorUserId,
    RUN_AI_MEDIA_POPULATED_UPGRADE_TESTS: '1',
  });
} catch (error) {
  bodyError = error;
} finally {
  try {
    await fixtureClient?.$disconnect();
  } catch (error) {
    cleanupErrors.push(labeledCleanupError('disconnect main fixture client', error));
  }
  try {
    await invalidFixtureClient?.$disconnect();
  } catch (error) {
    cleanupErrors.push(labeledCleanupError('disconnect invalid fixture client', error));
  }
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } catch (error) {
    cleanupErrors.push(labeledCleanupError(`drop schema ${schema}`, error));
  }
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${invalidSchema}" CASCADE`);
  } catch (error) {
    cleanupErrors.push(labeledCleanupError(`drop schema ${invalidSchema}`, error));
  }
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${foreignFunctionSchema}" CASCADE`);
  } catch (error) {
    cleanupErrors.push(labeledCleanupError(`drop schema ${foreignFunctionSchema}`, error));
  }
  try {
    await admin.$disconnect();
  } catch (error) {
    cleanupErrors.push(labeledCleanupError('disconnect admin client', error));
  }
  try {
    assertSafeTempRoot(tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(labeledCleanupError(`remove temp root ${tempRoot}`, error));
  }
}

if (bodyError) {
  if (cleanupErrors.length > 0) {
    console.error('AI media upgrade cleanup also failed:', cleanupErrors);
  }
  throw bodyError;
}
if (cleanupErrors.length === 1) throw cleanupErrors[0];
if (cleanupErrors.length > 1) {
  throw new AggregateError(cleanupErrors, 'AI media upgrade cleanup failed');
}

console.log('PASS AI media populated migration upgrade');
