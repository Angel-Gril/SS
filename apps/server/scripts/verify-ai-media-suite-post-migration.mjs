#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import {
  EXPECTED_AI_MEDIA_SUITE_TRIGGER_COUNT,
  loadAiMediaSuiteTriggerRows,
  validateAiMediaSuiteTriggerRows,
} from './ai-media-suite-post-migration-contract.mjs';

const MIGRATION_NAME = '20260724140000_enable_paid_ai_image_suite_execution';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const rawTimeout = process.env.AI_MEDIA_SUITE_DB_GUARD_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS);
const timeoutMs = Number(rawTimeout);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60 * 60 * 1_000) {
  console.error('FAIL AI media suite post-migration DB guard timeout is invalid');
  process.exit(1);
}

const expectedFunctions = new Map([
  ['protect_ai_media_suite_materialized_slot_lifecycle()', 'trigger'],
  ['protect_ai_media_suite_slot_identity()', 'trigger'],
  ['assert_ai_media_suite_execution_graph(text, text)', 'void'],
  ['prevent_ai_media_suite_child_output_before_dispatch()', 'trigger'],
  ['protect_ai_media_suite_child_asset_identity()', 'trigger'],
  ['protect_ai_media_suite_selected_output()', 'trigger'],
  ['prevent_ai_media_suite_bound_child_insert()', 'trigger'],
  ['require_ai_media_suite_execution_graph_from_asset()', 'trigger'],
]);

function integer(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} count is invalid`);
  }
  return result;
}

function one(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${label} did not return exactly one row`);
  }
  return rows[0];
}

const prisma = new PrismaClient();
try {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${timeoutMs}ms'`);

    const migration = one(await tx.$queryRawUnsafe(`
      SELECT
        count(*) FILTER (
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        )::INTEGER AS "activeFinished",
        count(*) FILTER (WHERE "rolled_back_at" IS NOT NULL)::INTEGER AS "rolledBack",
        count(*) FILTER (
          WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
        )::INTEGER AS "unfinished"
      FROM "_prisma_migrations"
      WHERE "migration_name" = '${MIGRATION_NAME}'
    `), 'Prisma migration guard');
    const activeFinished = integer(migration.activeFinished, 'active migration');
    const rolledBack = integer(migration.rolledBack, 'rolled-back migration');
    const unfinished = integer(migration.unfinished, 'unfinished migration');
    if (activeFinished !== 1 || unfinished !== 0) {
      throw new Error(
        `${MIGRATION_NAME} is not exactly once finished and active `
        + `(active=${activeFinished}, rolledBack=${rolledBack}, unfinished=${unfinished})`,
      );
    }

    const functionRows = await tx.$queryRawUnsafe(`
      SELECT
        proc.proname || '(' || pg_catalog.oidvectortypes(proc.proargtypes) || ')' AS "signature",
        pg_catalog.pg_get_function_result(proc.oid) AS "returnType"
      FROM pg_catalog.pg_proc proc
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = current_schema()
        AND proc.proname IN (
          'protect_ai_media_suite_materialized_slot_lifecycle',
          'protect_ai_media_suite_slot_identity',
          'assert_ai_media_suite_execution_graph',
          'prevent_ai_media_suite_child_output_before_dispatch',
          'protect_ai_media_suite_child_asset_identity',
          'protect_ai_media_suite_selected_output',
          'prevent_ai_media_suite_bound_child_insert',
          'require_ai_media_suite_execution_graph_from_asset'
        )
    `);
    const actualFunctions = new Map(functionRows.map((row) => [row.signature, row.returnType]));
    for (const [signature, returnType] of expectedFunctions) {
      if (actualFunctions.get(signature) !== returnType) {
        throw new Error(`critical function is missing or has the wrong return type: ${signature}`);
      }
    }
    if (actualFunctions.size !== expectedFunctions.size) {
      throw new Error('critical AI media suite function overload set is unexpected');
    }

    const triggerRows = await loadAiMediaSuiteTriggerRows(tx);
    validateAiMediaSuiteTriggerRows(triggerRows);

    const legacy = one(await tx.$queryRawUnsafe(`
      SELECT count(*)::INTEGER AS "legacyMissing"
      FROM "media_assets" AS asset
      JOIN "ai_image_jobs" AS job
        ON asset."ai_image_job_id" = job."id"
       AND asset."owner_user_id" = job."owner_user_id"
      JOIN "ai_media_workflows" AS workflow
        ON workflow."id" = job."workflow_id"
       AND workflow."owner_user_id" = job."owner_user_id"
      JOIN "ai_media_suite_slots" AS slot
        ON slot."child_workflow_id" = workflow."id"
       AND slot."owner_user_id" = workflow."owner_user_id"
      JOIN "ai_media_suites" AS suite
        ON suite."id" = slot."suite_id"
       AND suite."owner_user_id" = slot."owner_user_id"
      WHERE job."workflow_attempt" = slot."attempt"
        AND job."status" = 'SUCCEEDED'
        AND workflow."status" = 'SUCCEEDED'
        AND slot."status" = 'SUCCEEDED'
        AND suite."revision" >= 5
        AND suite."provider" = 'fake'
        AND asset."kind" = 'AI_GENERATED'
        AND asset."source_capture_snapshot_id" IS NULL
        AND asset."metadata"->>'version' = 'ai-image-suite-output/v1'
        AND asset."metadata"->>'suiteId' = suite."id"
        AND asset."metadata"->>'slotId' = slot."id"
        AND COALESCE(asset."metadata"->>'attempt', '') ~ '^[1-9][0-9]*$'
        AND (asset."metadata"->>'attempt')::INTEGER = job."workflow_attempt"
    `), 'legacy fake output guard');
    const legacyMissing = integer(legacy.legacyMissing, 'legacy missing output');
    if (legacyMissing !== 0) {
      throw new Error(`${legacyMissing} eligible legacy fake outputs still lack snapshot identity`);
    }

    const suites = one(await tx.$queryRawUnsafe(`
      SELECT count(*)::INTEGER AS "suitesValidated"
      FROM "ai_media_suites"
      WHERE "revision" >= 5
    `), 'suite graph count');
    const suitesValidated = integer(suites.suitesValidated, 'validated suite');

    const applied = one(await tx.$queryRawUnsafe(`
      SELECT count(*)::INTEGER AS "invalidApplied"
      FROM "ai_media_suites" suite
      JOIN "ai_media_suite_slots" slot
        ON slot."suite_id" = suite."id"
       AND slot."owner_user_id" = suite."owner_user_id"
      JOIN "ai_image_jobs" job
        ON job."workflow_id" = slot."child_workflow_id"
       AND job."owner_user_id" = slot."owner_user_id"
       AND job."workflow_attempt" = slot."attempt"
      WHERE suite."revision" >= 5
        AND job."applied_at" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM "extension_hosted_ai_image_listing_assignments" assignment
          WHERE assignment."job_id" = job."id"
            AND assignment."owner_user_id" = job."owner_user_id"
            AND assignment."child_workflow_id" = job."workflow_id"
            AND assignment."created_at" = job."applied_at"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ai_media_application_mutations" mutation
          WHERE mutation."job_id" = job."id"
            AND mutation."owner_user_id" = job."owner_user_id"
            AND mutation."kind" = 'APPLY'
            AND mutation."created_at" = job."applied_at"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "ai_media_listing_draft_application_mutations" mutation
          WHERE mutation."job_id" = job."id"
            AND mutation."owner_user_id" = job."owner_user_id"
            AND mutation."kind" = 'APPLY'
            AND mutation."created_at" = job."applied_at"
        )
    `), 'applied child graph ledger count');
    const invalidApplied = integer(applied.invalidApplied, 'invalid applied child graph');
    if (invalidApplied !== 0) {
      throw new Error(`${invalidApplied} applied suite child jobs have no application ledger`);
    }
    await tx.$executeRawUnsafe(`
      DO $ai_media_suite_post_migration_guard$
      DECLARE stored_suite RECORD;
      BEGIN
        FOR stored_suite IN
          SELECT "id", "owner_user_id"
          FROM "ai_media_suites"
          WHERE "revision" >= 5
            AND NOT EXISTS (
              SELECT 1
              FROM "ai_media_suite_slots" slot
              JOIN "ai_image_jobs" job
                ON job."workflow_id" = slot."child_workflow_id"
               AND job."owner_user_id" = slot."owner_user_id"
               AND job."workflow_attempt" = slot."attempt"
              WHERE slot."suite_id" = "ai_media_suites"."id"
                AND slot."owner_user_id" = "ai_media_suites"."owner_user_id"
                AND job."applied_at" IS NOT NULL
            )
          ORDER BY "id"
        LOOP
          PERFORM assert_ai_media_suite_execution_graph(
            stored_suite."id",
            stored_suite."owner_user_id"
          );
        END LOOP;
      END;
      $ai_media_suite_post_migration_guard$;
    `);

    return {
      activeFinished,
      rolledBack,
      unfinished,
      functions: expectedFunctions.size,
      triggers: EXPECTED_AI_MEDIA_SUITE_TRIGGER_COUNT,
      legacyMissing,
      suitesValidated,
    };
  }, { maxWait: 5_000, timeout: timeoutMs });

  console.log(
    'PASS AI media suite post-migration DB guard '
    + `(migrationActive=${result.activeFinished}; rolledBackAttempts=${result.rolledBack}; `
    + `unfinished=${result.unfinished}; functions=${result.functions}; triggers=${result.triggers}; `
    + `legacyMissing=${result.legacyMissing}; suitesValidated=${result.suitesValidated})`,
  );
} catch (error) {
  console.error(
    `FAIL AI media suite post-migration DB guard: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error(
      `FAIL AI media suite post-migration DB guard disconnect: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
