import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  copyFileSync,
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
const TEST_SCHEMA_PATTERN = /^ai_media_test_[a-z0-9_]+$/u;
const TEMP_ROOT_PREFIX = 'ss-erp-ai-media-upgrade-';
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const prismaRoot = join(serverRoot, 'prisma');
const migrationsRoot = join(prismaRoot, 'migrations');
const baseDatabaseUrl = process.env.DATABASE_URL || '';
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required');

const schema = `ai_media_test_upgrade_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const invalidSchema = `ai_media_test_upgrade_invalid_${new Date().toISOString().replace(/\D/gu, '').slice(0, 14)}_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
if (!TEST_SCHEMA_PATTERN.test(schema)) throw new Error('Unsafe AI media upgrade test schema name');
if (!TEST_SCHEMA_PATTERN.test(invalidSchema)) throw new Error('Unsafe invalid AI media upgrade test schema name');

const testUrl = new URL(baseDatabaseUrl);
testUrl.searchParams.set('schema', schema);
const invalidTestUrl = new URL(baseDatabaseUrl);
invalidTestUrl.searchParams.set('schema', invalidSchema);
const pnpmCli = process.env.npm_execpath || '';
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

function run(args, extraEnv = {}) {
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: serverRoot,
    env: { ...process.env, ...extraEnv },
    stdio: 'inherit',
    shell: !pnpmCli && process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function runExpectingFailure(args, expectedPattern, extraEnv = {}) {
  const commandArgs = pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: serverRoot,
    env: { ...process.env, ...extraEnv },
    encoding: 'utf8',
    shell: !pnpmCli && process.platform === 'win32',
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
    || names.filter((name) => name === EDIT_OUTPUT_GUARD_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_CHAINING_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_CONTRACT_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_SCOPE_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_DEPENDENCY_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_AUTHORITY_LOCK_MIGRATION).length !== 1
    || names.filter((name) => name === CANDIDATE_MUTATION_SERIALIZATION_MIGRATION).length !== 1
    || names.filter((name) => name === UNBOUND_CANDIDATE_REJECTION_MIGRATION).length !== 1) {
    throw new Error(
      `${EDIT_OUTPUT_GUARD_MIGRATION} through ${UNBOUND_CANDIDATE_REJECTION_MIGRATION} must be one unique consecutive migration block`,
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

async function addCurrentClientCompatibilityColumns(client) {
  await client.$executeRawUnsafe(`
    ALTER TABLE "ai_media_suite_slots"
      ADD COLUMN "execution_claim_token" CHAR(64),
      ADD COLUMN "execution_lease_expires_at" TIMESTAMP(3)
  `);
}

async function loadAndValidateMaterializedFixture(client) {
  const suites = await client.$queryRawUnsafe(`
    SELECT "id", "owner_user_id", "actor_user_id"
    FROM "ai_media_suites"
    WHERE "revision" = 4 AND "status" = 'PLANNED'
    ORDER BY "id"
  `);
  if (!Array.isArray(suites) || suites.length !== 1) {
    throw new Error(`Expected exactly one revision-4 materialized suite, found ${suites?.length ?? 0}`);
  }
  const fixture = suites[0];
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
  return {
    suiteId: String(fixture.id),
    ownerUserId: String(fixture.owner_user_id),
    actorUserId: String(fixture.actor_user_id),
  };
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
  run([
    'exec', 'vitest', 'run', '--no-file-parallelism',
    'src/__tests__/ai-image-suite.postgres.integration.test.ts',
    '--testNamePattern', selectedFixtureTests,
  ], {
    DATABASE_URL: testUrl.toString(),
    AI_MEDIA_TEST_DATABASE_URL: testUrl.toString(),
    RUN_AI_MEDIA_POSTGRES_TESTS: '1',
  });

  const fixture = await loadAndValidateMaterializedFixture(fixtureClient);
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

  if (migrationStages.unboundCandidateRejectionIndex < migrationStages.names.length - 1) {
    addHistoricalMigrationRange(
      migrationStages.names,
      migrationStages.unboundCandidateRejectionIndex + 1,
      migrationStages.names.length - 1,
    );
    run(['exec', 'prisma', 'migrate', 'deploy', '--schema', tempSchemaPath], {
      DATABASE_URL: testUrl.toString(),
    });
  }

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
