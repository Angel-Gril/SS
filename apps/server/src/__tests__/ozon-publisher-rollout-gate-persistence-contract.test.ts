import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL(
  '../../prisma/migrations/20260716020000_add_ozon_publisher_rollout_gates/migration.sql',
  import.meta.url,
), 'utf8');
const hardeningMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716021000_harden_ozon_publisher_rollout_gates/migration.sql',
  import.meta.url,
), 'utf8');
const attemptLinkMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716022000_complete_ozon_publisher_rollout_attempt_link/migration.sql',
  import.meta.url,
), 'utf8');
const fenceOrderMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716023000_fix_ozon_publisher_rollout_fence_order/migration.sql',
  import.meta.url,
), 'utf8');
const retryableFenceMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716024000_make_ozon_publisher_rollout_fence_retryable/migration.sql',
  import.meta.url,
), 'utf8');
const canonicalEvaluationMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716025000_align_ozon_publisher_rollout_evaluation_contract/migration.sql',
  import.meta.url,
), 'utf8');
const stageCasMigration = readFileSync(new URL(
  '../../prisma/migrations/20260716026000_add_ozon_publisher_rollout_stage_cas/migration.sql',
  import.meta.url,
), 'utf8');

function modelBlock(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || '';
}

describe('Ozon publisher rollout gate persistence contract', () => {
  it('separates the current gate, eligible denominator, one-time outcome, evaluation, and transition', () => {
    const gate = modelBlock('OzonPublisherRolloutGate');
    const attempt = modelBlock('OzonPublisherRolloutRecorderAttempt');
    const outcome = modelBlock('OzonPublisherRolloutRecorderOutcome');
    const evaluation = modelBlock('OzonPublisherRolloutEvaluation');
    const transition = modelBlock('OzonPublisherRolloutTransition');

    expect(gate).toMatch(/writerEntrypoint\s+OzonPublisherWriterEntrypoint[\s\S]*originChannel\s+OzonPublisherOriginChannel[\s\S]*rolloutRevision\s+String/);
    expect(gate).toMatch(/state\s+OzonPublisherRolloutGateState[\s\S]*stateVersion\s+Int/);
    expect(attempt).toMatch(/attemptKey\s+String\s+@unique[\s\S]*parityEntrypoint\s+OzonPublisherParityEntrypoint[\s\S]*scopeHash\s+String[\s\S]*eligibleAt\s+DateTime/);
    expect(outcome).toMatch(/attemptId\s+String\s+@unique[\s\S]*result\s+OzonPublisherRolloutRecorderResult[\s\S]*observationId\s+String\?\s+@unique/);
    expect(evaluation).toMatch(/evidenceHash\s+String[\s\S]*windowStart\s+DateTime[\s\S]*windowEnd\s+DateTime[\s\S]*thresholds\s+Json[\s\S]*metrics\s+Json/);
    expect(transition).toMatch(/transitionVersion\s+Int[\s\S]*expectedStateVersion\s+Int[\s\S]*actorUserId\s+String[\s\S]*reason\s+String[\s\S]*decidedAt\s+DateTime/);
  });

  it('admits only currently real writer-origin-parity mappings', () => {
    expect(migration).toContain('"origin_channel" = \'DIRECT\' AND "writer_entrypoint"::TEXT = "parity_entrypoint"::TEXT');
    expect(migration).toContain('"origin_channel" = \'BROWSER_ONE_CLICK\'');
    expect(migration).toContain('"writer_entrypoint" = \'COLLECT_PUBLISH_OZON\'');
    expect(migration).toContain('"parity_entrypoint" = \'BROWSER_ONE_CLICK\'');
    expect(migration).not.toMatch(/"origin_channel" = 'EXTENSION_ADAPTER'\s+AND/);
  });

  it('counts every eligible attempt and accepts exactly one recorded or failed outcome', () => {
    expect(migration).toContain('ozon_publisher_rollout_recorder_outcome_attempt_key');
    expect(migration).toContain('ozon_publisher_rollout_recorder_outcome_observation_key');
    expect(migration).toContain("\"result\" = 'RECORDED' AND \"observation_id\" IS NOT NULL");
    expect(migration).toContain('NEW."observation_report_hash" IS DISTINCT FROM observation_row."report_hash"');
    expect(migration).toContain("\"result\" = 'FAILED' AND \"observation_id\" IS NULL");
    expect(migration).toContain('Recorded rollout outcome has mismatched parity evidence');
    expect(migration).toContain('observation_row."scope_hash" IS DISTINCT FROM attempt_row."scope_hash"');
  });

  it('enforces the readiness floor and database-owned coverage metrics', () => {
    expect(migration).toContain("value -> 'windowDays', 14, 365");
    expect(migration).toContain("value -> 'minEligibleAttempts', 100, 1000000");
    expect(migration).toContain("value -> 'minLiveObservations', 100, 1000000");
    expect(migration).toContain("value -> 'minDistinctScopes', 25, 1000000");
    expect(migration).toContain("value -> 'minActiveUtcDays', 7, 365");
    expect(migration).toContain("value -> 'maxLatestObservationAgeHours', 1, 24");
    expect(migration).toContain("value -> 'minRecorderCoverageBps', 10000, 10000");
    expect(migration).toContain("value -> 'rollbackHorizonDays', 30, 365");
    expect(migration).toContain('completed_count <> eligible_count OR recorded_count <> eligible_count OR failed_count <> 0');
    expect(migration).toContain('Ozon publisher rollout evaluation metrics do not match recorder evidence');
    expect(migration).toContain('Ozon publisher rollout evaluation evidence hash mismatch');
    expect(migration).toContain('sha256(convert_to(jsonb_build_object(');
  });

  it('allows only NOT_READY to READY to REVOKED with exact immutable CAS events', () => {
    expect(migration).toContain("OLD.\"state\" = 'NOT_READY' AND NEW.\"state\" = 'READY'");
    expect(migration).toContain("OLD.\"state\" = 'READY' AND NEW.\"state\" = 'REVOKED'");
    expect(migration).toContain('NEW."state_version" <> OLD."state_version" + 1');
    expect(migration).toContain('READY gate requires exact current READY evaluation evidence');
    expect(migration).toContain('Ozon publisher rollout gate CAS transition requires an immutable event');
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(migration).toContain('Ozon publisher rollout history is immutable');
    expect(migration).toContain('ozon_publisher_rollout_attempt_immutable');
    expect(migration).toContain('ozon_publisher_rollout_outcome_immutable');
    expect(migration).toContain('ozon_publisher_rollout_evaluation_immutable');
    expect(migration).toContain('ozon_publisher_rollout_transition_immutable');
  });

  it('binds denominator rows to exact requests, contracts, policy, observations, and expiry', () => {
    const attempt = modelBlock('OzonPublisherRolloutRecorderAttempt');
    const outcome = modelBlock('OzonPublisherRolloutRecorderOutcome');
    expect(attempt).toMatch(/eligibleAttemptKey\s+String\s+@unique[\s\S]*operationKey\s+String[\s\S]*requestHash\s+String[\s\S]*payloadHash\s+String[\s\S]*itemCount\s+Int/);
    expect(attempt).toMatch(/attemptContractVersion\s+String[\s\S]*guardContractVersion\s+String[\s\S]*evidencePolicyHash\s+String[\s\S]*expiresAt\s+DateTime/);
    expect(outcome).toMatch(/observationId\s+String\?\s+@unique[\s\S]*observation\s+OzonPublisherParityObservation\?/);
    expect(hardeningMigration).toContain('ozon_publisher_rollout_recorder_outcome_observation_fkey');
    expect(attemptLinkMigration).toContain('ozon_publisher_parity_observation_eligible_attempt_fkey');
    expect(attemptLinkMigration).toContain('REFERENCES "ozon_publisher_rollout_recorder_attempts"("eligible_attempt_key")');
    expect(hardeningMigration).toContain('observation_row."eligible_attempt_key" IS DISTINCT FROM attempt_row."eligible_attempt_key"');
    expect(hardeningMigration).toContain('outcome_row."subject_state_version_snapshot" IS NOT DISTINCT FROM subject_row."state_version"');
  });

  it('binds gate and evaluation authority to policy, config, guard, and coverage epoch', () => {
    const gate = modelBlock('OzonPublisherRolloutGate');
    const evaluation = modelBlock('OzonPublisherRolloutEvaluation');
    expect(gate).toMatch(/evidencePolicyHash\s+String[\s\S]*authorizedControlConfigHash\s+String[\s\S]*guardContractVersion\s+String[\s\S]*denominatorEnforcedFrom\s+DateTime/);
    expect(evaluation).toMatch(/evidencePolicyHash\s+String[\s\S]*controlConfigHash\s+String[\s\S]*authorizedControlConfigHash\s+String[\s\S]*guardContractVersion\s+String/);
    expect(evaluation).toMatch(/evaluationHash\s+String[\s\S]*validUntil\s+DateTime[\s\S]*blockers\s+Json/);
    expect(hardeningMigration).toContain("'denominatorEnforcedFrom', gate_row.\"denominator_enforced_from\"");
    expect(hardeningMigration).toContain("'differenceSubjectStateVersion', s.\"state_version\"");
    expect(hardeningMigration).toContain("'fullDifferenceSignature', s.\"full_difference_signature\"");
  });

  it('persists the TypeScript readiness contract while PostgreSQL independently guards READY', () => {
    const evaluation = modelBlock('OzonPublisherRolloutEvaluation');
    expect(evaluation).toMatch(/evidencePolicyHash\s+String[\s\S]*authorizedEvidencePolicyHash\s+String/);
    expect(evaluation).toMatch(/operationKey\s+String[\s\S]*requestHash\s+String[\s\S]*actorUserId\s+String/);
    expect(evaluation).toMatch(/validUntil\s+DateTime\?[\s\S]*latestEligibleAt\s+DateTime\?/);
    expect(canonicalEvaluationMigration).toContain('ozon-publisher-rollout-evaluation/v3');
    expect(canonicalEvaluationMigration).toContain("'linkedObservationCount', linked_count");
    expect(canonicalEvaluationMigration).toContain("'missingObservationCount', eligible_count - linked_count");
    expect(canonicalEvaluationMigration).toContain("'activeUtcDayCount', active_days");
    expect(canonicalEvaluationMigration).toContain("'latestEligibleAt'");
    expect(canonicalEvaluationMigration).toContain("'minimumEvidenceExpiresAt'");
    expect(canonicalEvaluationMigration).toContain('NEW."result" = \'READY\' AND NOT db_ready');
    expect(canonicalEvaluationMigration).toContain('evaluation_row."evaluated_at" IS DISTINCT FROM db_now');
    expect(canonicalEvaluationMigration).toContain('evaluation_row."valid_until" IS DISTINCT FROM db_now');
    expect(canonicalEvaluationMigration).toContain('PostgreSQL independently revalidates every condition that can authorize READY');
  });

  it('protects all five stage rows with revision CAS and immutable transition evidence', () => {
    const stageTransition = modelBlock('OzonPublisherRolloutStageTransition');
    const systemConfig = modelBlock('SystemConfig');
    expect(systemConfig).toMatch(/revision\s+Int\s+@default\(0\)/);
    expect(stageTransition).toMatch(/boundary\s+OzonPublisherRolloutBoundary[\s\S]*expectedRevision\s+Int/);
    expect(stageTransition).toMatch(/fromStage\s+OzonPublisherRolloutStage[\s\S]*resultStage\s+OzonPublisherRolloutStage/);
    expect(stageTransition).toMatch(/gateId\s+String\?[\s\S]*rolloutRevisionSnapshot\s+String\?[\s\S]*gateStateVersionSnapshot\s+Int\?/);
    expect(stageCasMigration).toContain('Ozon publisher rollout stages must enter CAS control at off revision zero');
    expect(stageCasMigration).toContain('Protected Ozon publisher rollout stage update requires an exact immutable CAS event');
    expect(stageCasMigration).toContain('Ozon publisher rollout v2 stage requires the exact READY gate');
    expect(stageCasMigration).toContain("'EXTENSION_ADAPTER'");
    expect(stageCasMigration).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(stageCasMigration).toContain('stage transition history is immutable');
  });

  it('uses database time and one gate advisory fence for attempt, outcome, evaluation, and approval', () => {
    expect(hardeningMigration).toContain('transaction_timestamp()::TIMESTAMPTZ(3)');
    expect(hardeningMigration).toContain('Ozon publisher rollout attempts cannot be backdated');
    expect(hardeningMigration).toContain('Ozon publisher rollout outcomes cannot be backdated');
    expect(hardeningMigration).toContain('Ozon publisher rollout evaluations cannot be backdated or cached');
    expect(hardeningMigration).toContain('NEW."window_start" IS DISTINCT FROM db_now - INTERVAL \'14 days\'');
    expect(hardeningMigration).toContain('NEW."valid_until" IS DISTINCT FROM db_now');
    expect(hardeningMigration.match(/pg_advisory_xact_lock\(hashtextextended\([^;]+6381623\)\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(hardeningMigration).toContain('evaluation_row."valid_until" < db_now');
    expect(fenceOrderMigration).toContain("replace(body, 'max(p.\"observed_at\") FILTER', 'max(a.\"eligible_at\") FILTER')");
    expect(fenceOrderMigration).toContain('snapshot_read');
    expect(retryableFenceMigration).toContain('pg_try_advisory_xact_lock');
    expect(retryableFenceMigration).toContain("USING ERRCODE = ''40001''");
    expect(retryableFenceMigration).toContain('body := replace(body, snapshot_read, locked_read)');
  });

  it('allows only complete approved difference evidence while MATCH remains switch eligible', () => {
    expect(hardeningMigration).toContain('observation_row."status" = \'MATCH\'');
    expect(hardeningMigration).toContain('AND observation_row."switch_eligible"');
    expect(hardeningMigration).toContain('observation_row."status" = \'DIFFERENT\'');
    expect(hardeningMigration).toContain('RETURN NOT observation_row."switch_eligible"');
    expect(hardeningMigration).toContain('observation_row."difference_returned" = observation_row."difference_total"');
    expect(hardeningMigration).toContain('subject_row."approval_state" = \'APPROVED\'');
    expect(hardeningMigration).toContain("subject_row.\"classification\" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')");
  });
});
