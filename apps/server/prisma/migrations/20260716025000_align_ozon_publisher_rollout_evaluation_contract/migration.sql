BEGIN;
SET LOCAL lock_timeout = '5s';

-- The rollout control plane is not wired to writers yet. Refuse to reinterpret
-- any pre-existing audit history while replacing the preview evaluation shape.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ozon_publisher_rollout_gates")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_recorder_attempts")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_recorder_outcomes")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_evaluations")
    OR EXISTS (SELECT 1 FROM "ozon_publisher_rollout_transitions") THEN
    RAISE EXCEPTION 'Cannot replace a non-empty Ozon publisher rollout evaluation contract'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE "ozon_publisher_rollout_evaluations"
  ADD COLUMN "authorized_evidence_policy_hash" TEXT NOT NULL,
  ADD COLUMN "operation_key" TEXT NOT NULL,
  ADD COLUMN "request_hash" TEXT NOT NULL,
  ADD COLUMN "actor_user_id" TEXT NOT NULL;
ALTER TABLE "ozon_publisher_rollout_evaluations"
  RENAME COLUMN "latest_observation_at" TO "latest_eligible_at";
ALTER TABLE "ozon_publisher_rollout_evaluations"
  ALTER COLUMN "valid_until" DROP NOT NULL;
CREATE UNIQUE INDEX "ozon_publisher_rollout_evaluation_operation_key"
  ON "ozon_publisher_rollout_evaluations"("gate_id", "operation_key");
CREATE INDEX "ozon_publisher_rollout_evaluation_actor_idx"
  ON "ozon_publisher_rollout_evaluations"("actor_user_id", "evaluated_at");
ALTER TABLE "ozon_publisher_rollout_evaluations"
  ADD CONSTRAINT "ozon_publisher_rollout_evaluation_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "ozon_publisher_rollout_thresholds_valid"(value JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN jsonb_typeof(value) = 'object'
    AND value = jsonb_build_object(
      'contractVersion', 'ozon-publisher-rollout-readiness/v1',
      'windowDays', 14,
      'minimumEligibleAttempts', 100,
      'minimumLinkedObservations', 100,
      'minimumDistinctScopes', 25,
      'minimumActiveUtcDays', 7,
      'maximumLatestAgeHours', 24,
      'rollbackEvidenceDays', 30
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "ozon_publisher_rollout_metrics_valid"(value JSONB)
RETURNS BOOLEAN AS $$
DECLARE key TEXT;
DECLARE timestamp_value TEXT;
BEGIN
  IF jsonb_typeof(value) <> 'object'
    OR NOT value ?& ARRAY[
      'eligibleAttemptCount', 'linkedObservationCount', 'missingObservationCount',
      'failedAttemptCount', 'invalidEvidenceCount', 'distinctScopeCount',
      'activeUtcDayCount', 'latestEligibleAt', 'minimumEvidenceExpiresAt'
    ]::TEXT[]
    OR (value - ARRAY[
      'eligibleAttemptCount', 'linkedObservationCount', 'missingObservationCount',
      'failedAttemptCount', 'invalidEvidenceCount', 'distinctScopeCount',
      'activeUtcDayCount', 'latestEligibleAt', 'minimumEvidenceExpiresAt'
    ]::TEXT[]) <> '{}'::JSONB THEN
    RETURN FALSE;
  END IF;
  FOREACH key IN ARRAY ARRAY[
    'eligibleAttemptCount', 'linkedObservationCount', 'missingObservationCount',
    'failedAttemptCount', 'invalidEvidenceCount', 'distinctScopeCount',
    'activeUtcDayCount'
  ] LOOP
    IF NOT "ozon_publisher_rollout_json_integer"(value -> key, 0, 1000000000) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['latestEligibleAt', 'minimumEvidenceExpiresAt'] LOOP
    IF jsonb_typeof(value -> key) = 'null' THEN CONTINUE; END IF;
    IF jsonb_typeof(value -> key) <> 'string' THEN RETURN FALSE; END IF;
    timestamp_value := value ->> key;
    IF timestamp_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
      RETURN FALSE;
    END IF;
    BEGIN
      PERFORM timestamp_value::TIMESTAMPTZ;
    EXCEPTION WHEN OTHERS THEN
      RETURN FALSE;
    END;
  END LOOP;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "ozon_publisher_rollout_blockers_valid"(value JSONB)
RETURNS BOOLEAN AS $$
DECLARE blocker TEXT;
DECLARE normalized JSONB;
BEGIN
  IF jsonb_typeof(value) <> 'array' OR jsonb_array_length(value) > 32 THEN RETURN FALSE; END IF;
  FOR blocker IN SELECT item FROM jsonb_array_elements_text(value) elements(item) LOOP
    IF blocker NOT IN (
      'ATTEMPT_DENOMINATOR_UNAVAILABLE',
      'ATTEMPT_DENOMINATOR_IDENTITY_MISMATCH',
      'ATTEMPT_DENOMINATOR_WINDOW_INCOMPLETE',
      'ELIGIBLE_ATTEMPT_FLOOR',
      'LINKED_OBSERVATION_FLOOR',
      'RECORDER_COVERAGE_INCOMPLETE',
      'RECORDER_FAILURE_PRESENT',
      'DISTINCT_SCOPE_FLOOR',
      'ACTIVE_UTC_DAY_FLOOR',
      'LATEST_OBSERVATION_MISSING',
      'LATEST_OBSERVATION_STALE',
      'ROLLBACK_EVIDENCE_RETENTION_SHORT',
      'EVIDENCE_POLICY_DRIFT',
      'CONTROL_CONFIG_DRIFT',
      'CONTRACT_DRIFT',
      'FUTURE_EVIDENCE_PRESENT',
      'UNSUPPORTED_EVIDENCE_PRESENT',
      'UNAPPROVED_DIFFERENCE_PRESENT'
    ) THEN RETURN FALSE; END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(to_jsonb(item) ORDER BY item), '[]'::JSONB)
    INTO normalized FROM (SELECT DISTINCT item FROM jsonb_array_elements_text(value) rows(item)) sorted;
  RETURN value = normalized;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

ALTER TABLE "ozon_publisher_rollout_evaluations"
  DROP CONSTRAINT "ozon_publisher_rollout_evaluation_shape_check",
  ADD CONSTRAINT "ozon_publisher_rollout_evaluation_shape_check" CHECK (
    length(btrim("evaluation_key")) BETWEEN 16 AND 200
    AND length(btrim("operation_key")) BETWEEN 16 AND 200
    AND "request_hash" ~ '^[0-9a-f]{64}$'
    AND length(btrim("actor_user_id")) BETWEEN 1 AND 200
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "record_contract_version" = 'ozon-publisher-rollout-evaluation/v3'
    AND "evaluator_version" = 'ozon-publisher-rollout-readiness/v1'
    AND "guard_contract_version" = 'ozon-publisher-rollout-guard/v1'
    AND "evidence_policy_hash" ~ '^[0-9a-f]{64}$'
    AND "authorized_evidence_policy_hash" ~ '^[0-9a-f]{64}$'
    AND "control_config_hash" ~ '^[0-9a-f]{64}$'
    AND "authorized_control_config_hash" ~ '^[0-9a-f]{64}$'
    AND "evidence_hash" ~ '^[0-9a-f]{64}$'
    AND "evaluation_hash" ~ '^[0-9a-f]{64}$'
    AND pg_column_size("thresholds_json") <= 8192
    AND pg_column_size("metrics_json") <= 8192
    AND pg_column_size("blockers_json") <= 8192
    AND "ozon_publisher_rollout_thresholds_valid"("thresholds_json")
    AND "ozon_publisher_rollout_metrics_valid"("metrics_json")
    AND "ozon_publisher_rollout_blockers_valid"("blockers_json")
    AND (("result" = 'READY' AND "blockers_json" = '[]'::JSONB AND "valid_until" IS NOT NULL)
      OR ("result" = 'NOT_READY' AND jsonb_array_length("blockers_json") > 0
        AND "valid_until" IS NULL))
  );

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_evaluation"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
DECLARE eligible_count BIGINT; DECLARE completed_count BIGINT; DECLARE linked_count BIGINT;
DECLARE failed_count BIGINT; DECLARE valid_count BIGINT; DECLARE invalid_count BIGINT;
DECLARE scope_count BIGINT; DECLARE active_days BIGINT; DECLARE future_count BIGINT;
DECLARE latest_at TIMESTAMPTZ; DECLARE minimum_expiry TIMESTAMPTZ;
DECLARE metrics JSONB; DECLARE db_ready BOOLEAN;
BEGIN
  IF NOT "ozon_publisher_rollout_thresholds_valid"(NEW."thresholds_json")
    OR NOT "ozon_publisher_rollout_metrics_valid"(NEW."metrics_json")
    OR NOT "ozon_publisher_rollout_blockers_valid"(NEW."blockers_json") THEN
    RAISE EXCEPTION 'Invalid Ozon publisher rollout evaluation JSON contract' USING ERRCODE = '23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."gate_id", 6381623));
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates"
   WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."writer_entrypoint" IS DISTINCT FROM gate_row."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM gate_row."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM gate_row."rollout_revision"
    OR NEW."authorized_evidence_policy_hash" IS DISTINCT FROM gate_row."evidence_policy_hash"
    OR NEW."authorized_control_config_hash" IS DISTINCT FROM gate_row."authorized_control_config_hash"
    OR NEW."guard_contract_version" IS DISTINCT FROM gate_row."guard_contract_version" THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation does not match its gate' USING ERRCODE = '23514';
  END IF;
  IF NEW."evaluated_at" IS DISTINCT FROM db_now OR NEW."window_end" IS DISTINCT FROM db_now
    OR NEW."created_at" IS DISTINCT FROM db_now
    OR NEW."window_start" IS DISTINCT FROM db_now - INTERVAL '14 days'
    OR NEW."evidence_retained_until" IS DISTINCT FROM db_now + INTERVAL '30 days'
    OR (NEW."result" = 'READY' AND NEW."valid_until" IS DISTINCT FROM db_now)
    OR (NEW."result" = 'NOT_READY' AND NEW."valid_until" IS NOT NULL) THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluations cannot be backdated or cached'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(a."id"), count(o."id"),
         count(*) FILTER (WHERE o."result" = 'RECORDED' AND p."id" IS NOT NULL),
         count(*) FILTER (WHERE o."result" = 'FAILED'),
         count(*) FILTER (WHERE "ozon_publisher_rollout_observation_is_valid"(
           a, o, p, s, NEW."evidence_retained_until", NEW."evaluated_at")),
         count(*) FILTER (WHERE
           a."attempt_contract_version" <> 'ozon-publisher-parity-eligible-attempt/v1'
           OR a."guard_contract_version" <> 'ozon-publisher-rollout-guard/v1'
           OR a."evidence_policy_hash" <> NEW."evidence_policy_hash"
           OR (o."result" = 'RECORDED' AND (p."id" IS NULL OR NOT
             "ozon_publisher_rollout_observation_is_valid"(
               a, o, p, s, '-infinity'::TIMESTAMPTZ, NEW."evaluated_at")))
           OR (o."result" IS DISTINCT FROM 'RECORDED' AND p."id" IS NOT NULL)),
         count(DISTINCT a."scope_hash") FILTER
           (WHERE o."result" = 'RECORDED' AND p."id" IS NOT NULL),
         count(DISTINCT (a."eligible_at" AT TIME ZONE 'UTC')::DATE) FILTER
           (WHERE o."result" = 'RECORDED' AND p."id" IS NOT NULL),
         max(a."eligible_at") FILTER
           (WHERE o."result" = 'RECORDED' AND p."id" IS NOT NULL),
         min(CASE WHEN o."result" = 'RECORDED' AND p."id" IS NOT NULL
           THEN LEAST(a."expires_at", p."expires_at") ELSE a."expires_at" END)
    INTO eligible_count, completed_count, linked_count, failed_count, valid_count,
         invalid_count, scope_count, active_days, latest_at, minimum_expiry
    FROM "ozon_publisher_rollout_recorder_attempts" a
    LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
    LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
    LEFT JOIN "ozon_publisher_parity_difference_subjects" s
      ON s."subject_key" = p."difference_subject_key"
   WHERE a."gate_id" = NEW."gate_id"
     AND a."eligible_at" >= NEW."window_start" AND a."eligible_at" <= NEW."window_end";
  SELECT count(*) INTO future_count FROM "ozon_publisher_rollout_recorder_attempts"
   WHERE "gate_id" = NEW."gate_id" AND "eligible_at" > NEW."evaluated_at";

  metrics := jsonb_build_object(
    'eligibleAttemptCount', eligible_count,
    'linkedObservationCount', linked_count,
    'missingObservationCount', eligible_count - linked_count,
    'failedAttemptCount', failed_count,
    'invalidEvidenceCount', invalid_count,
    'distinctScopeCount', scope_count,
    'activeUtcDayCount', active_days,
    'latestEligibleAt', CASE WHEN latest_at IS NULL THEN NULL ELSE
      to_char(latest_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'minimumEvidenceExpiresAt', CASE WHEN minimum_expiry IS NULL THEN NULL ELSE
      to_char(minimum_expiry AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END
  );
  IF NEW."metrics_json" IS DISTINCT FROM metrics
    OR NEW."latest_eligible_at" IS DISTINCT FROM latest_at THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation metrics do not match live evidence'
      USING ERRCODE = '23514';
  END IF;

  db_ready := gate_row."denominator_enforced_from" <= NEW."window_start"
    AND NEW."evidence_policy_hash" = NEW."authorized_evidence_policy_hash"
    AND NEW."control_config_hash" = NEW."authorized_control_config_hash"
    AND eligible_count >= 100 AND linked_count >= 100
    AND completed_count = eligible_count AND linked_count = eligible_count
    AND failed_count = 0 AND valid_count = eligible_count AND invalid_count = 0
    AND scope_count >= 25 AND active_days >= 7
    AND latest_at IS NOT NULL AND latest_at >= NEW."evaluated_at" - INTERVAL '24 hours'
    AND minimum_expiry IS NOT NULL AND minimum_expiry >= NEW."evidence_retained_until"
    AND future_count = 0;
  IF NEW."result" = 'READY' AND NOT db_ready THEN
    RAISE EXCEPTION 'Ozon publisher rollout READY evaluation does not match live evidence'
      USING ERRCODE = '23514';
  END IF;

  -- The application owns one canonical stable serializer for these audit hashes.
  -- PostgreSQL independently revalidates every condition that can authorize READY.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_gate"() RETURNS trigger AS $$
DECLARE evaluation_row "ozon_publisher_rollout_evaluations"%ROWTYPE;
DECLARE db_now TIMESTAMPTZ(3) := transaction_timestamp()::TIMESTAMPTZ(3);
DECLARE current_attempts BIGINT; DECLARE current_completed BIGINT; DECLARE current_valid BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW."id", 6381623)) THEN
      RAISE EXCEPTION 'Ozon publisher rollout gate fence is busy; retry the CAS transaction'
        USING ERRCODE = '40001';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."id", 6381623));
  END IF;
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
      RAISE EXCEPTION 'Ozon publisher rollout approval cannot be backdated' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO evaluation_row FROM "ozon_publisher_rollout_evaluations"
     WHERE "id" = NEW."ready_evaluation_id" FOR KEY SHARE;
    IF NOT FOUND OR evaluation_row."gate_id" IS DISTINCT FROM NEW."id"
      OR evaluation_row."record_contract_version" <> 'ozon-publisher-rollout-evaluation/v3'
      OR evaluation_row."result" <> 'READY'
      OR evaluation_row."evaluated_at" IS DISTINCT FROM db_now
      OR evaluation_row."valid_until" IS DISTINCT FROM db_now
      OR evaluation_row."authorized_evidence_policy_hash" IS DISTINCT FROM NEW."evidence_policy_hash"
      OR evaluation_row."evidence_policy_hash" IS DISTINCT FROM NEW."evidence_policy_hash"
      OR evaluation_row."authorized_control_config_hash" IS DISTINCT FROM NEW."authorized_control_config_hash"
      OR evaluation_row."control_config_hash" IS DISTINCT FROM NEW."authorized_control_config_hash"
      OR evaluation_row."guard_contract_version" IS DISTINCT FROM NEW."guard_contract_version"
      OR evaluation_row."evidence_hash" IS DISTINCT FROM NEW."evidence_hash"
      OR evaluation_row."evaluation_hash" IS DISTINCT FROM NEW."evaluation_hash" THEN
      RAISE EXCEPTION 'READY gate requires an atomic live exact READY evaluation'
        USING ERRCODE = '23514';
    END IF;
    SELECT count(a."id"), count(o."id"), count(*) FILTER
      (WHERE "ozon_publisher_rollout_observation_is_valid"(
        a, o, p, s, evaluation_row."evidence_retained_until", db_now))
      INTO current_attempts, current_completed, current_valid
      FROM "ozon_publisher_rollout_recorder_attempts" a
      LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
      LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
      LEFT JOIN "ozon_publisher_parity_difference_subjects" s
        ON s."subject_key" = p."difference_subject_key"
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

COMMIT;
