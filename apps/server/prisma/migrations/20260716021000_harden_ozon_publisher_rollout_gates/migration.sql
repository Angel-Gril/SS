BEGIN;
SET LOCAL lock_timeout = '5s';

-- Rollout activation has not been wired yet. Refuse to invent provenance if an
-- out-of-band caller populated the control-plane tables between migrations.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ozon_publisher_rollout_gates")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_recorder_attempts")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_recorder_outcomes")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_evaluations")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_transitions") THEN
    RAISE EXCEPTION 'Cannot harden non-empty Ozon publisher rollout control plane without provenance'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "ozon_publisher_parity_observations"
  ADD COLUMN "eligible_attempt_key" TEXT;
ALTER TABLE "ozon_publisher_parity_observations"
  ADD CONSTRAINT "ozon_publisher_parity_observation_eligible_attempt_key"
    UNIQUE ("eligible_attempt_key"),
  ADD CONSTRAINT "ozon_publisher_parity_observation_eligible_attempt_check"
    CHECK ("eligible_attempt_key" IS NULL OR "eligible_attempt_key" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ozon_publisher_rollout_gates"
  ADD COLUMN "evidence_policy_hash" TEXT NOT NULL,
  ADD COLUMN "authorized_control_config_hash" TEXT NOT NULL,
  ADD COLUMN "guard_contract_version" TEXT NOT NULL,
  ADD COLUMN "denominator_enforced_from" TIMESTAMPTZ(3) NOT NULL,
  ADD COLUMN "evaluation_hash" TEXT;

ALTER TABLE "ozon_publisher_rollout_recorder_attempts"
  ADD COLUMN "eligible_attempt_key" TEXT NOT NULL,
  ADD COLUMN "operation_key" TEXT NOT NULL,
  ADD COLUMN "request_hash" TEXT NOT NULL,
  ADD COLUMN "payload_hash" TEXT NOT NULL,
  ADD COLUMN "item_count" INTEGER NOT NULL,
  ADD COLUMN "attempt_contract_version" TEXT NOT NULL,
  ADD COLUMN "guard_contract_version" TEXT NOT NULL,
  ADD COLUMN "evidence_policy_hash" TEXT NOT NULL,
  ADD COLUMN "expires_at" TIMESTAMPTZ(3) NOT NULL,
  ADD CONSTRAINT "ozon_publisher_rollout_recorder_eligible_attempt_key"
    UNIQUE ("eligible_attempt_key"),
  ADD CONSTRAINT "ozon_publisher_rollout_recorder_operation_key"
    UNIQUE ("gate_id", "operation_key");

ALTER TABLE "ozon_publisher_rollout_recorder_outcomes"
  ADD COLUMN "subject_state_version_snapshot" INTEGER,
  ADD COLUMN "full_difference_signature_snapshot" TEXT,
  ADD CONSTRAINT "ozon_publisher_rollout_recorder_outcome_observation_fkey"
    FOREIGN KEY ("observation_id") REFERENCES "ozon_publisher_parity_observations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ozon_publisher_rollout_evaluations"
  ADD COLUMN "evidence_policy_hash" TEXT NOT NULL,
  ADD COLUMN "control_config_hash" TEXT NOT NULL,
  ADD COLUMN "authorized_control_config_hash" TEXT NOT NULL,
  ADD COLUMN "guard_contract_version" TEXT NOT NULL,
  ADD COLUMN "evaluation_hash" TEXT NOT NULL,
  ADD COLUMN "valid_until" TIMESTAMPTZ(3) NOT NULL,
  ADD COLUMN "blockers_json" JSONB NOT NULL;

ALTER TABLE "ozon_publisher_rollout_transitions"
  ADD COLUMN "evaluation_hash_snapshot" TEXT NOT NULL;

ALTER TABLE "ozon_publisher_rollout_gates"
  DROP CONSTRAINT "ozon_publisher_rollout_gate_identity_check",
  DROP CONSTRAINT "ozon_publisher_rollout_gate_state_shape_check",
  ADD CONSTRAINT "ozon_publisher_rollout_gate_identity_check" CHECK (
    length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "record_contract_version" = 'ozon-publisher-rollout-gate/v2'
    AND "evidence_policy_hash" ~ '^[0-9a-f]{64}$'
    AND "authorized_control_config_hash" ~ '^[0-9a-f]{64}$'
    AND "guard_contract_version" = 'ozon-publisher-rollout-guard/v1'
    AND "state_version" BETWEEN 0 AND 2
    AND ("origin_channel" = 'DIRECT'
      OR ("origin_channel" = 'BROWSER_ONE_CLICK'
        AND "writer_entrypoint" = 'COLLECT_PUBLISH_OZON'))
  ),
  ADD CONSTRAINT "ozon_publisher_rollout_gate_state_shape_check" CHECK (
    ("state" = 'NOT_READY' AND "state_version" = 0
      AND "ready_evaluation_id" IS NULL AND "evidence_hash" IS NULL AND "evaluation_hash" IS NULL
      AND "approved_by_user_id" IS NULL AND "approved_at" IS NULL AND "approval_reason" IS NULL
      AND "revoked_by_user_id" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
    OR ("state" = 'READY' AND "state_version" = 1
      AND "ready_evaluation_id" IS NOT NULL
      AND "evidence_hash" ~ '^[0-9a-f]{64}$' AND "evaluation_hash" ~ '^[0-9a-f]{64}$'
      AND "approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL
      AND length(btrim("approval_reason")) BETWEEN 1 AND 1000
      AND "revoked_by_user_id" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
    OR ("state" = 'REVOKED' AND "state_version" = 2
      AND "ready_evaluation_id" IS NOT NULL
      AND "evidence_hash" ~ '^[0-9a-f]{64}$' AND "evaluation_hash" ~ '^[0-9a-f]{64}$'
      AND "approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL
      AND length(btrim("approval_reason")) BETWEEN 1 AND 1000
      AND "revoked_by_user_id" IS NOT NULL AND "revoked_at" IS NOT NULL
      AND "revoked_at" >= "approved_at" AND length(btrim("revocation_reason")) BETWEEN 1 AND 1000)
  );

CREATE FUNCTION "ozon_publisher_rollout_observation_is_valid"(
  attempt_row "ozon_publisher_rollout_recorder_attempts",
  outcome_row "ozon_publisher_rollout_recorder_outcomes",
  observation_row "ozon_publisher_parity_observations",
  subject_row "ozon_publisher_parity_difference_subjects",
  retained_until TIMESTAMPTZ,
  evaluated_at TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
DECLARE expected_entrypoint TEXT;
BEGIN
  IF attempt_row."id" IS NULL OR outcome_row."id" IS NULL OR observation_row."id" IS NULL
    OR outcome_row."result" <> 'RECORDED' THEN RETURN FALSE; END IF;
  expected_entrypoint := CASE attempt_row."origin_channel"
    WHEN 'DIRECT' THEN attempt_row."writer_entrypoint"::TEXT
    WHEN 'BROWSER_ONE_CLICK' THEN 'BROWSER_ONE_CLICK'
    ELSE NULL
  END;
  IF expected_entrypoint IS NULL
    OR observation_row."eligible_attempt_key" IS DISTINCT FROM attempt_row."eligible_attempt_key"
    OR observation_row."entrypoint"::TEXT IS DISTINCT FROM expected_entrypoint
    OR observation_row."rollout_revision" IS DISTINCT FROM attempt_row."rollout_revision"
    OR observation_row."scope_hash" IS DISTINCT FROM attempt_row."scope_hash"
    OR observation_row."record_contract_version" <> 'ozon-publisher-parity-observation/v1'
    OR observation_row."report_contract_version" <> 'ozon-publisher-entrypoint-parity/v1'
    OR observation_row."publisher_contract_version" IS DISTINCT FROM
      'ozon-listing-production-compile-adapter/v1'
    OR observation_row."payload_compiler_version" IS DISTINCT FROM
      'ozon-listing-payload-compiler/v1'
    OR observation_row."observed_at" < attempt_row."eligible_at"
    OR observation_row."observed_at" > outcome_row."completed_at"
    OR observation_row."observed_at" > evaluated_at
    OR observation_row."expires_at" < retained_until
    OR attempt_row."expires_at" < retained_until
    OR outcome_row."observation_record_key" IS DISTINCT FROM observation_row."record_key"
    OR outcome_row."observation_report_hash" IS DISTINCT FROM observation_row."report_hash" THEN
    RETURN FALSE;
  END IF;
  IF observation_row."status" = 'MATCH' THEN
    RETURN observation_row."classification" = 'MATCH'
      AND observation_row."switch_eligible"
      AND observation_row."difference_total" = 0
      AND observation_row."difference_returned" = 0
      AND NOT observation_row."difference_truncated"
      AND observation_row."difference_subject_key" IS NULL
      AND observation_row."full_difference_signature" IS NULL
      AND outcome_row."subject_state_version_snapshot" IS NULL
      AND outcome_row."full_difference_signature_snapshot" IS NULL;
  END IF;
  IF observation_row."status" = 'DIFFERENT' THEN
    RETURN NOT observation_row."switch_eligible"
      AND NOT observation_row."difference_truncated"
      AND observation_row."difference_total" BETWEEN 1 AND 100
      AND observation_row."difference_returned" = observation_row."difference_total"
      AND observation_row."classification" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')
      AND subject_row."subject_key" IS NOT NULL
      AND subject_row."subject_key" IS NOT DISTINCT FROM observation_row."difference_subject_key"
      AND subject_row."entrypoint" IS NOT DISTINCT FROM observation_row."entrypoint"
      AND subject_row."rollout_revision" IS NOT DISTINCT FROM observation_row."rollout_revision"
      AND subject_row."record_contract_version" = 'ozon-publisher-parity-difference-subject/v1'
      AND subject_row."report_contract_version" = 'ozon-publisher-entrypoint-parity/v1'
      AND subject_row."approval_state" = 'APPROVED'
      AND subject_row."classification" IN ('INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM')
      AND subject_row."classification" IS NOT DISTINCT FROM observation_row."classification"
      AND subject_row."difference_total" = observation_row."difference_total"
      AND subject_row."full_difference_signature" IS NOT DISTINCT FROM
        observation_row."full_difference_signature"
      AND outcome_row."subject_state_version_snapshot" IS NOT DISTINCT FROM subject_row."state_version"
      AND outcome_row."full_difference_signature_snapshot" IS NOT DISTINCT FROM
        subject_row."full_difference_signature"
      AND subject_row."approved_at" IS NOT NULL AND subject_row."approved_at" <= evaluated_at;
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

CREATE FUNCTION "validate_ozon_publisher_rollout_observation_attempt"() RETURNS trigger AS $$
DECLARE attempt_row "ozon_publisher_rollout_recorder_attempts"%ROWTYPE;
BEGIN
  IF NEW."eligible_attempt_key" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO attempt_row FROM "ozon_publisher_rollout_recorder_attempts"
   WHERE "eligible_attempt_key" = NEW."eligible_attempt_key";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rollout parity observation has no eligible attempt' USING ERRCODE = '23503';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt_row."gate_id", 6381623));
  IF NEW."rollout_revision" IS DISTINCT FROM attempt_row."rollout_revision"
    OR NEW."scope_hash" IS DISTINCT FROM attempt_row."scope_hash"
    OR NEW."entrypoint" IS DISTINCT FROM attempt_row."parity_entrypoint"
    OR NEW."observed_at" < attempt_row."eligible_at"
    OR NEW."observed_at" > transaction_timestamp()::TIMESTAMPTZ(3) THEN
    RAISE EXCEPTION 'Rollout parity observation does not match eligible attempt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_attempt"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."gate_id", 6381623));
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."writer_entrypoint" IS DISTINCT FROM gate_row."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM gate_row."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM gate_row."rollout_revision"
    OR NEW."evidence_policy_hash" IS DISTINCT FROM gate_row."evidence_policy_hash"
    OR NEW."guard_contract_version" IS DISTINCT FROM gate_row."guard_contract_version"
    OR NEW."eligible_at" < gate_row."denominator_enforced_from" THEN
    RAISE EXCEPTION 'Ozon publisher rollout recorder attempt does not match its gate' USING ERRCODE = '23514';
  END IF;
  IF NEW."eligible_at" IS DISTINCT FROM db_now OR NEW."created_at" IS DISTINCT FROM db_now THEN
    RAISE EXCEPTION 'Ozon publisher rollout attempts cannot be backdated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_outcome"() RETURNS trigger AS $$
DECLARE attempt_row "ozon_publisher_rollout_recorder_attempts"%ROWTYPE;
DECLARE observation_row "ozon_publisher_parity_observations"%ROWTYPE;
DECLARE subject_row "ozon_publisher_parity_difference_subjects"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
BEGIN
  SELECT * INTO attempt_row FROM "ozon_publisher_rollout_recorder_attempts"
   WHERE "id" = NEW."attempt_id" FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rollout recorder attempt is missing' USING ERRCODE = '23503'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(attempt_row."gate_id", 6381623));
  IF NEW."completed_at" IS DISTINCT FROM db_now OR NEW."created_at" IS DISTINCT FROM db_now THEN
    RAISE EXCEPTION 'Ozon publisher rollout outcomes cannot be backdated' USING ERRCODE = '23514';
  END IF;
  IF NEW."result" = 'RECORDED' THEN
    SELECT * INTO observation_row FROM "ozon_publisher_parity_observations"
     WHERE "id" = NEW."observation_id" FOR KEY SHARE;
    IF observation_row."difference_subject_key" IS NOT NULL THEN
      SELECT * INTO subject_row FROM "ozon_publisher_parity_difference_subjects"
       WHERE "subject_key" = observation_row."difference_subject_key" FOR KEY SHARE;
    END IF;
    IF NOT "ozon_publisher_rollout_observation_is_valid"(
      attempt_row, NEW, observation_row, subject_row,
      LEAST(attempt_row."expires_at", observation_row."expires_at"), db_now
    ) THEN
      RAISE EXCEPTION 'Recorded rollout outcome has mismatched parity evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_evaluation"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
DECLARE eligible_count BIGINT; DECLARE completed_count BIGINT; DECLARE recorded_count BIGINT;
DECLARE failed_count BIGINT; DECLARE live_count BIGINT; DECLARE scope_count BIGINT;
DECLARE active_days BIGINT; DECLARE invalid_count BIGINT; DECLARE future_count BIGINT;
DECLARE coverage_bps BIGINT; DECLARE latest_at TIMESTAMPTZ; DECLARE minimum_expiry TIMESTAMPTZ;
DECLARE evidence_rows JSONB; DECLARE metrics JSONB; DECLARE blockers JSONB := '[]'::JSONB;
DECLARE calculated_evidence_hash TEXT; DECLARE calculated_evaluation_hash TEXT;
BEGIN
  IF NOT "ozon_publisher_rollout_thresholds_valid"(NEW."thresholds_json")
    OR NOT "ozon_publisher_rollout_metrics_valid"(NEW."metrics_json")
    OR NOT "ozon_publisher_rollout_blockers_valid"(NEW."blockers_json") THEN
    RAISE EXCEPTION 'Invalid Ozon publisher rollout evaluation JSON contract' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."gate_id", 6381623));
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."writer_entrypoint" IS DISTINCT FROM gate_row."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM gate_row."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM gate_row."rollout_revision"
    OR NEW."evidence_policy_hash" IS DISTINCT FROM gate_row."evidence_policy_hash"
    OR NEW."authorized_control_config_hash" IS DISTINCT FROM gate_row."authorized_control_config_hash"
    OR NEW."guard_contract_version" IS DISTINCT FROM gate_row."guard_contract_version" THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation does not match its gate' USING ERRCODE = '23514';
  END IF;
  IF NEW."evaluated_at" IS DISTINCT FROM db_now OR NEW."window_end" IS DISTINCT FROM db_now
    OR NEW."created_at" IS DISTINCT FROM db_now OR NEW."valid_until" IS DISTINCT FROM db_now
    OR NEW."window_start" IS DISTINCT FROM db_now - INTERVAL '14 days'
    OR NEW."evidence_retained_until" IS DISTINCT FROM db_now + INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluations cannot be backdated or cached' USING ERRCODE = '23514';
  END IF;

  SELECT count(a."id"), count(o."id"), count(*) FILTER (WHERE o."result" = 'RECORDED'),
         count(*) FILTER (WHERE o."result" = 'FAILED'),
         count(*) FILTER (WHERE "ozon_publisher_rollout_observation_is_valid"(
           a, o, p, s, NEW."evidence_retained_until", NEW."evaluated_at")),
         count(DISTINCT a."scope_hash") FILTER (WHERE "ozon_publisher_rollout_observation_is_valid"(
           a, o, p, s, NEW."evidence_retained_until", NEW."evaluated_at")),
         count(DISTINCT (a."eligible_at" AT TIME ZONE 'UTC')::DATE) FILTER
           (WHERE "ozon_publisher_rollout_observation_is_valid"(
             a, o, p, s, NEW."evidence_retained_until", NEW."evaluated_at")),
         max(p."observed_at") FILTER (WHERE "ozon_publisher_rollout_observation_is_valid"(
           a, o, p, s, NEW."evidence_retained_until", NEW."evaluated_at")),
         min(LEAST(a."expires_at", p."expires_at")) FILTER
           (WHERE "ozon_publisher_rollout_observation_is_valid"(
             a, o, p, s, NEW."evidence_retained_until", NEW."evaluated_at"))
    INTO eligible_count, completed_count, recorded_count, failed_count, live_count,
         scope_count, active_days, latest_at, minimum_expiry
    FROM "ozon_publisher_rollout_recorder_attempts" a
    LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
    LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
    LEFT JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
   WHERE a."gate_id" = NEW."gate_id"
     AND a."eligible_at" >= NEW."window_start" AND a."eligible_at" <= NEW."window_end";
  invalid_count := eligible_count - live_count;
  coverage_bps := CASE WHEN eligible_count = 0 THEN 0
    ELSE floor(recorded_count * 10000.0 / eligible_count) END;
  SELECT count(*) INTO future_count FROM "ozon_publisher_rollout_recorder_attempts"
   WHERE "gate_id" = NEW."gate_id" AND "eligible_at" > NEW."evaluated_at";

  metrics := jsonb_build_object(
    'eligibleAttemptCount', eligible_count, 'completedAttemptCount', completed_count,
    'recordedAttemptCount', recorded_count, 'failedAttemptCount', failed_count,
    'liveObservationCount', live_count, 'distinctScopeCount', scope_count,
    'activeUtcDays', active_days, 'invalidEvidenceCount', invalid_count,
    'recorderCoverageBps', coverage_bps
  );
  IF gate_row."denominator_enforced_from" > NEW."window_start" THEN
    blockers := blockers || jsonb_build_array('ATTEMPT_DENOMINATOR_WINDOW_INCOMPLETE'); END IF;
  IF NEW."control_config_hash" <> NEW."authorized_control_config_hash" THEN
    blockers := blockers || jsonb_build_array('CONTROL_CONFIG_DRIFT'); END IF;
  IF eligible_count < 100 THEN blockers := blockers || jsonb_build_array('ELIGIBLE_ATTEMPT_FLOOR'); END IF;
  IF completed_count <> eligible_count OR recorded_count <> eligible_count OR coverage_bps <> 10000 THEN
    blockers := blockers || jsonb_build_array('RECORDER_COVERAGE_INCOMPLETE'); END IF;
  IF failed_count <> 0 THEN blockers := blockers || jsonb_build_array('RECORDER_FAILURE_PRESENT'); END IF;
  IF live_count < 100 THEN blockers := blockers || jsonb_build_array('LINKED_OBSERVATION_FLOOR'); END IF;
  IF scope_count < 25 THEN blockers := blockers || jsonb_build_array('DISTINCT_SCOPE_FLOOR'); END IF;
  IF active_days < 7 THEN blockers := blockers || jsonb_build_array('ACTIVE_UTC_DAY_FLOOR'); END IF;
  IF latest_at IS NULL THEN blockers := blockers || jsonb_build_array('LATEST_OBSERVATION_MISSING');
  ELSIF latest_at < NEW."evaluated_at" - INTERVAL '24 hours' THEN
    blockers := blockers || jsonb_build_array('LATEST_OBSERVATION_STALE'); END IF;
  IF minimum_expiry IS NULL OR minimum_expiry < NEW."evidence_retained_until" THEN
    blockers := blockers || jsonb_build_array('ROLLBACK_EVIDENCE_RETENTION_SHORT'); END IF;
  IF invalid_count <> 0 THEN blockers := blockers || jsonb_build_array('INVALID_EVIDENCE_PRESENT'); END IF;
  IF future_count <> 0 THEN blockers := blockers || jsonb_build_array('FUTURE_EVIDENCE_PRESENT'); END IF;

  IF NEW."metrics_json" IS DISTINCT FROM metrics OR NEW."blockers_json" IS DISTINCT FROM blockers
    OR NEW."latest_observation_at" IS DISTINCT FROM latest_at
    OR NEW."result" IS DISTINCT FROM
      (CASE WHEN jsonb_array_length(blockers) = 0 THEN 'READY'::"OzonPublisherRolloutEvaluationResult"
        ELSE 'NOT_READY'::"OzonPublisherRolloutEvaluationResult" END) THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation snapshot does not match live evidence'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'attemptKey', a."attempt_key", 'eligibleAttemptKey', a."eligible_attempt_key",
      'operationKey', a."operation_key", 'requestHash', a."request_hash",
      'payloadHash', a."payload_hash", 'itemCount', a."item_count",
      'attemptContractVersion', a."attempt_contract_version",
      'guardContractVersion', a."guard_contract_version",
      'evidencePolicyHash', a."evidence_policy_hash", 'scopeHash', a."scope_hash",
      'eligibleAt', a."eligible_at", 'expiresAt', a."expires_at", 'outcome', o."result",
      'failureCode', o."failure_code", 'completedAt', o."completed_at",
      'observationId', p."id", 'observationRecordKey', p."record_key",
      'observationRecordContractVersion', p."record_contract_version",
      'observationReportContractVersion', p."report_contract_version",
      'observationReportHash', p."report_hash",
      'publisherContractVersion', p."publisher_contract_version",
      'payloadCompilerVersion', p."payload_compiler_version",
      'differenceSubjectKey', p."difference_subject_key",
      'differenceSubjectStateVersion', s."state_version",
      'differenceSubjectRecordContractVersion', s."record_contract_version",
      'differenceSubjectReportContractVersion', s."report_contract_version",
      'fullDifferenceSignature', s."full_difference_signature",
      'differenceApprovalState', s."approval_state"
    ) ORDER BY a."eligible_attempt_key"), '[]'::JSONB)
    INTO evidence_rows
    FROM "ozon_publisher_rollout_recorder_attempts" a
    LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
    LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
    LEFT JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
   WHERE a."gate_id" = NEW."gate_id" AND a."eligible_at" >= NEW."window_start";
  calculated_evidence_hash := encode(sha256(convert_to(jsonb_build_object(
    'writerEntrypoint', NEW."writer_entrypoint", 'originChannel', NEW."origin_channel",
    'rolloutRevision', NEW."rollout_revision", 'evidencePolicyHash', NEW."evidence_policy_hash",
    'guardContractVersion', NEW."guard_contract_version",
    'denominatorEnforcedFrom', gate_row."denominator_enforced_from",
    'windowStart', NEW."window_start", 'windowEnd', NEW."window_end",
    'evidenceRetainedUntil', NEW."evidence_retained_until", 'attempts', evidence_rows
  )::TEXT, 'UTF8')), 'hex');
  calculated_evaluation_hash := encode(sha256(convert_to(jsonb_build_object(
    'recordContractVersion', NEW."record_contract_version",
    'evaluatorVersion', NEW."evaluator_version", 'evidenceHash', calculated_evidence_hash,
    'controlConfigHash', NEW."control_config_hash",
    'authorizedControlConfigHash', NEW."authorized_control_config_hash",
    'evaluatedAt', NEW."evaluated_at", 'validUntil', NEW."valid_until",
    'thresholds', NEW."thresholds_json", 'metrics', metrics, 'blockers', blockers
  )::TEXT, 'UTF8')), 'hex');
  IF NEW."evidence_hash" <> calculated_evidence_hash
    OR NEW."evaluation_hash" <> calculated_evaluation_hash THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation hashes do not match live evidence'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_gate"() RETURNS trigger AS $$
DECLARE evaluation_row "ozon_publisher_rollout_evaluations"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
DECLARE current_attempts BIGINT; DECLARE current_completed BIGINT; DECLARE current_valid BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."id", 6381623));
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'NOT_READY' OR NEW."state_version" <> 0
      OR NEW."created_at" IS DISTINCT FROM db_now OR NEW."updated_at" IS DISTINCT FROM db_now
      OR NEW."denominator_enforced_from" IS DISTINCT FROM db_now THEN
      RAISE EXCEPTION 'Ozon publisher rollout gate must start at the database coverage epoch'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."writer_entrypoint" IS DISTINCT FROM OLD."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM OLD."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM OLD."rollout_revision"
    OR NEW."record_contract_version" IS DISTINCT FROM OLD."record_contract_version"
    OR NEW."evidence_policy_hash" IS DISTINCT FROM OLD."evidence_policy_hash"
    OR NEW."authorized_control_config_hash" IS DISTINCT FROM OLD."authorized_control_config_hash"
    OR NEW."guard_contract_version" IS DISTINCT FROM OLD."guard_contract_version"
    OR NEW."denominator_enforced_from" IS DISTINCT FROM OLD."denominator_enforced_from"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Ozon publisher rollout gate identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."updated_at" IS DISTINCT FROM db_now OR NEW."state_version" <> OLD."state_version" + 1
    OR NOT ((OLD."state" = 'NOT_READY' AND NEW."state" = 'READY')
      OR (OLD."state" = 'READY' AND NEW."state" = 'REVOKED')) THEN
    RAISE EXCEPTION 'Illegal Ozon publisher rollout gate CAS transition' USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'READY' AND (
    NEW."ready_evaluation_id" IS DISTINCT FROM OLD."ready_evaluation_id"
    OR NEW."evidence_hash" IS DISTINCT FROM OLD."evidence_hash"
    OR NEW."evaluation_hash" IS DISTINCT FROM OLD."evaluation_hash"
    OR NEW."approved_by_user_id" IS DISTINCT FROM OLD."approved_by_user_id"
    OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
    OR NEW."approval_reason" IS DISTINCT FROM OLD."approval_reason") THEN
    RAISE EXCEPTION 'Ozon publisher rollout approval provenance is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."state" = 'READY' THEN
    IF NEW."approved_at" IS DISTINCT FROM db_now THEN
      RAISE EXCEPTION 'Ozon publisher rollout approval cannot be backdated' USING ERRCODE = '23514'; END IF;
    SELECT * INTO evaluation_row FROM "ozon_publisher_rollout_evaluations"
     WHERE "id" = NEW."ready_evaluation_id" FOR KEY SHARE;
    IF NOT FOUND OR evaluation_row."gate_id" IS DISTINCT FROM NEW."id"
      OR evaluation_row."result" <> 'READY' OR evaluation_row."valid_until" < db_now
      OR evaluation_row."evidence_policy_hash" IS DISTINCT FROM NEW."evidence_policy_hash"
      OR evaluation_row."authorized_control_config_hash" IS DISTINCT FROM NEW."authorized_control_config_hash"
      OR evaluation_row."control_config_hash" IS DISTINCT FROM NEW."authorized_control_config_hash"
      OR evaluation_row."guard_contract_version" IS DISTINCT FROM NEW."guard_contract_version"
      OR evaluation_row."evidence_hash" IS DISTINCT FROM NEW."evidence_hash"
      OR evaluation_row."evaluation_hash" IS DISTINCT FROM NEW."evaluation_hash" THEN
      RAISE EXCEPTION 'READY gate requires a live exact READY evaluation' USING ERRCODE = '23514';
    END IF;
    SELECT count(a."id"), count(o."id"), count(*) FILTER
      (WHERE "ozon_publisher_rollout_observation_is_valid"(
        a, o, p, s, evaluation_row."evidence_retained_until", db_now))
      INTO current_attempts, current_completed, current_valid
      FROM "ozon_publisher_rollout_recorder_attempts" a
      LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
      LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
      LEFT JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
     WHERE a."gate_id" = NEW."id" AND a."eligible_at" >= evaluation_row."window_start"
       AND a."eligible_at" <= evaluation_row."window_end";
    IF current_attempts <> (evaluation_row."metrics_json" ->> 'eligibleAttemptCount')::BIGINT
      OR current_completed <> current_attempts OR current_valid <> current_attempts THEN
      RAISE EXCEPTION 'READY gate live evidence changed after evaluation' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."state" = 'REVOKED' AND NEW."revoked_at" IS DISTINCT FROM db_now THEN
    RAISE EXCEPTION 'Ozon publisher rollout revocation cannot be backdated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "ozon_publisher_rollout_recorder_attempts"
  DROP CONSTRAINT "ozon_publisher_rollout_recorder_attempt_identity_check",
  ADD CONSTRAINT "ozon_publisher_rollout_recorder_attempt_identity_check" CHECK (
    length(btrim("attempt_key")) BETWEEN 16 AND 200
    AND "eligible_attempt_key" ~ '^[0-9a-f]{64}$'
    AND length(btrim("operation_key")) BETWEEN 16 AND 200
    AND "request_hash" ~ '^[0-9a-f]{64}$' AND "payload_hash" ~ '^[0-9a-f]{64}$'
    AND "item_count" BETWEEN 1 AND 50000
    AND "attempt_contract_version" = 'ozon-publisher-parity-eligible-attempt/v1'
    AND "guard_contract_version" = 'ozon-publisher-rollout-guard/v1'
    AND "evidence_policy_hash" ~ '^[0-9a-f]{64}$'
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "scope_hash" ~ '^[0-9a-f]{64}$'
    AND "expires_at" >= "eligible_at" + INTERVAL '44 days'
    AND "expires_at" <= "eligible_at" + INTERVAL '365 days'
    AND (("origin_channel" = 'DIRECT' AND "writer_entrypoint"::TEXT = "parity_entrypoint"::TEXT)
      OR ("origin_channel" = 'BROWSER_ONE_CLICK'
        AND "writer_entrypoint" = 'COLLECT_PUBLISH_OZON'
        AND "parity_entrypoint" = 'BROWSER_ONE_CLICK'))
  );

ALTER TABLE "ozon_publisher_rollout_recorder_outcomes"
  DROP CONSTRAINT "ozon_publisher_rollout_recorder_outcome_shape_check",
  ADD CONSTRAINT "ozon_publisher_rollout_recorder_outcome_shape_check" CHECK (
    ("result" = 'RECORDED' AND "observation_id" IS NOT NULL
      AND "observation_record_key" IS NOT NULL AND "observation_report_hash" ~ '^[0-9a-f]{64}$'
      AND "failure_code" IS NULL
      AND (("subject_state_version_snapshot" IS NULL AND "full_difference_signature_snapshot" IS NULL)
        OR ("subject_state_version_snapshot" >= 1
          AND "full_difference_signature_snapshot" ~ '^[0-9a-f]{64}$')))
    OR ("result" = 'FAILED' AND "observation_id" IS NULL
      AND "observation_record_key" IS NULL AND "observation_report_hash" IS NULL
      AND "subject_state_version_snapshot" IS NULL AND "full_difference_signature_snapshot" IS NULL
      AND "failure_code" ~ '^[A-Z][A-Z0-9_]{0,99}$')
  );

CREATE OR REPLACE FUNCTION "ozon_publisher_rollout_thresholds_valid"(value JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN jsonb_typeof(value) = 'object'
    AND value = jsonb_build_object(
      'windowDays', 14, 'minEligibleAttempts', 100, 'minLiveObservations', 100,
      'minDistinctScopes', 25, 'minActiveUtcDays', 7,
      'maxLatestObservationAgeHours', 24, 'minRecorderCoverageBps', 10000,
      'rollbackHorizonDays', 30
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

CREATE FUNCTION "ozon_publisher_rollout_blockers_valid"(value JSONB)
RETURNS BOOLEAN AS $$
DECLARE blocker JSONB;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 32 THEN RETURN FALSE; END IF;
  FOR blocker IN SELECT item FROM jsonb_array_elements(value) elements(item) LOOP
    IF jsonb_typeof(blocker) <> 'string'
      OR blocker #>> '{}' !~ '^[A-Z][A-Z0-9_]{0,99}$' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN (SELECT count(*) = count(DISTINCT item) FROM jsonb_array_elements(value) elements(item));
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

ALTER TABLE "ozon_publisher_rollout_evaluations"
  DROP CONSTRAINT "ozon_publisher_rollout_evaluation_shape_check",
  ADD CONSTRAINT "ozon_publisher_rollout_evaluation_shape_check" CHECK (
    length(btrim("evaluation_key")) BETWEEN 16 AND 200
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "record_contract_version" = 'ozon-publisher-rollout-evaluation/v2'
    AND "evaluator_version" = 'ozon-publisher-rollout-readiness/v1'
    AND "guard_contract_version" = 'ozon-publisher-rollout-guard/v1'
    AND "evidence_policy_hash" ~ '^[0-9a-f]{64}$'
    AND "control_config_hash" ~ '^[0-9a-f]{64}$'
    AND "authorized_control_config_hash" ~ '^[0-9a-f]{64}$'
    AND "evidence_hash" ~ '^[0-9a-f]{64}$' AND "evaluation_hash" ~ '^[0-9a-f]{64}$'
    AND pg_column_size("thresholds_json") <= 8192 AND pg_column_size("metrics_json") <= 8192
    AND pg_column_size("blockers_json") <= 8192
    AND "ozon_publisher_rollout_thresholds_valid"("thresholds_json")
    AND "ozon_publisher_rollout_metrics_valid"("metrics_json")
    AND "ozon_publisher_rollout_blockers_valid"("blockers_json")
    AND (("result" = 'READY' AND "blockers_json" = '[]'::JSONB)
      OR ("result" = 'NOT_READY' AND jsonb_array_length("blockers_json") > 0))
  );

ALTER TABLE "ozon_publisher_rollout_transitions"
  DROP CONSTRAINT "ozon_publisher_rollout_transition_shape_check",
  ADD CONSTRAINT "ozon_publisher_rollout_transition_shape_check" CHECK (
    "transition_version" = "expected_state_version" + 1 AND "transition_version" IN (1, 2)
    AND length(btrim("transition_key")) BETWEEN 16 AND 200
    AND length(btrim("operation_key")) BETWEEN 16 AND 200
    AND "request_hash" ~ '^[0-9a-f]{64}$'
    AND "evidence_hash_snapshot" ~ '^[0-9a-f]{64}$'
    AND "evaluation_hash_snapshot" ~ '^[0-9a-f]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 1000
    AND (("action" = 'APPROVE' AND "from_state" = 'NOT_READY' AND "result_state" = 'READY'
          AND "expected_state_version" = 0 AND "transition_version" = 1)
      OR ("action" = 'REVOKE' AND "from_state" = 'READY' AND "result_state" = 'REVOKED'
          AND "expected_state_version" = 1 AND "transition_version" = 2))
  );

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_transition"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."gate_id", 6381623));
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."transition_version" IS DISTINCT FROM gate_row."state_version"
    OR NEW."expected_state_version" IS DISTINCT FROM gate_row."state_version" - 1
    OR NEW."result_state" IS DISTINCT FROM gate_row."state"
    OR NEW."evaluation_id" IS DISTINCT FROM gate_row."ready_evaluation_id"
    OR NEW."evidence_hash_snapshot" IS DISTINCT FROM gate_row."evidence_hash"
    OR NEW."evaluation_hash_snapshot" IS DISTINCT FROM gate_row."evaluation_hash"
    OR NEW."decided_at" IS DISTINCT FROM db_now OR NEW."created_at" IS DISTINCT FROM db_now
    OR (NEW."action" = 'APPROVE' AND (
      NEW."actor_user_id" IS DISTINCT FROM gate_row."approved_by_user_id"
      OR NEW."reason" IS DISTINCT FROM gate_row."approval_reason"
      OR NEW."decided_at" IS DISTINCT FROM gate_row."approved_at"))
    OR (NEW."action" = 'REVOKE' AND (
      NEW."actor_user_id" IS DISTINCT FROM gate_row."revoked_by_user_id"
      OR NEW."reason" IS DISTINCT FROM gate_row."revocation_reason"
      OR NEW."decided_at" IS DISTINCT FROM gate_row."revoked_at")) THEN
    RAISE EXCEPTION 'Ozon publisher rollout transition does not match gate CAS state'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_rollout_observation_attempt_validate"
  BEFORE INSERT ON "ozon_publisher_parity_observations"
  FOR EACH ROW EXECUTE FUNCTION "validate_ozon_publisher_rollout_observation_attempt"();

COMMIT;
