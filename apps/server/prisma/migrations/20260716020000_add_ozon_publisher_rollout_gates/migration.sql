BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TYPE "OzonPublisherWriterEntrypoint" AS ENUM (
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU'
);
CREATE TYPE "OzonPublisherOriginChannel" AS ENUM (
  'DIRECT', 'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER'
);
CREATE TYPE "OzonPublisherRolloutGateState" AS ENUM ('NOT_READY', 'READY', 'REVOKED');
CREATE TYPE "OzonPublisherRolloutRecorderResult" AS ENUM ('RECORDED', 'FAILED');
CREATE TYPE "OzonPublisherRolloutEvaluationResult" AS ENUM ('NOT_READY', 'READY');
CREATE TYPE "OzonPublisherRolloutTransitionAction" AS ENUM ('APPROVE', 'REVOKE');

CREATE TABLE "ozon_publisher_rollout_gates" (
  "id" TEXT NOT NULL,
  "writer_entrypoint" "OzonPublisherWriterEntrypoint" NOT NULL,
  "origin_channel" "OzonPublisherOriginChannel" NOT NULL,
  "rollout_revision" TEXT NOT NULL,
  "record_contract_version" TEXT NOT NULL,
  "state" "OzonPublisherRolloutGateState" NOT NULL DEFAULT 'NOT_READY',
  "state_version" INTEGER NOT NULL DEFAULT 0,
  "ready_evaluation_id" TEXT,
  "evidence_hash" TEXT,
  "approved_by_user_id" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "approval_reason" VARCHAR(1000),
  "revoked_by_user_id" TEXT,
  "revoked_at" TIMESTAMPTZ(3),
  "revocation_reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ozon_publisher_rollout_gates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_rollout_gate_identity_key"
    UNIQUE ("writer_entrypoint", "origin_channel", "rollout_revision"),
  CONSTRAINT "ozon_publisher_rollout_gate_ready_evaluation_key" UNIQUE ("ready_evaluation_id"),
  CONSTRAINT "ozon_publisher_rollout_gate_approver_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_gate_revoker_fkey"
    FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_gate_identity_check" CHECK (
    length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "record_contract_version" = 'ozon-publisher-rollout-gate/v1'
    AND "state_version" BETWEEN 0 AND 2147483647
    AND (
      "origin_channel" = 'DIRECT'
      OR ("origin_channel" = 'BROWSER_ONE_CLICK' AND "writer_entrypoint" = 'COLLECT_PUBLISH_OZON')
    )
  ),
  CONSTRAINT "ozon_publisher_rollout_gate_state_shape_check" CHECK (
    ("state" = 'NOT_READY' AND "state_version" = 0
      AND "ready_evaluation_id" IS NULL AND "evidence_hash" IS NULL
      AND "approved_by_user_id" IS NULL AND "approved_at" IS NULL AND "approval_reason" IS NULL
      AND "revoked_by_user_id" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
    OR
    ("state" = 'READY' AND "state_version" = 1
      AND "ready_evaluation_id" IS NOT NULL AND "evidence_hash" ~ '^[0-9a-f]{64}$'
      AND "approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL
      AND length(btrim("approval_reason")) BETWEEN 1 AND 1000
      AND "revoked_by_user_id" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
    OR
    ("state" = 'REVOKED' AND "state_version" = 2
      AND "ready_evaluation_id" IS NOT NULL AND "evidence_hash" ~ '^[0-9a-f]{64}$'
      AND "approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL
      AND length(btrim("approval_reason")) BETWEEN 1 AND 1000
      AND "revoked_by_user_id" IS NOT NULL AND "revoked_at" IS NOT NULL
      AND "revoked_at" >= "approved_at"
      AND length(btrim("revocation_reason")) BETWEEN 1 AND 1000)
  )
);

CREATE INDEX "ozon_publisher_rollout_gate_state_idx"
  ON "ozon_publisher_rollout_gates"("state", "writer_entrypoint", "origin_channel");

CREATE TABLE "ozon_publisher_rollout_recorder_attempts" (
  "id" TEXT NOT NULL,
  "attempt_key" TEXT NOT NULL,
  "gate_id" TEXT NOT NULL,
  "writer_entrypoint" "OzonPublisherWriterEntrypoint" NOT NULL,
  "origin_channel" "OzonPublisherOriginChannel" NOT NULL,
  "parity_entrypoint" "OzonPublisherParityEntrypoint" NOT NULL,
  "rollout_revision" TEXT NOT NULL,
  "scope_hash" TEXT NOT NULL,
  "eligible_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_rollout_recorder_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_rollout_recorder_attempt_key" UNIQUE ("attempt_key"),
  CONSTRAINT "ozon_publisher_rollout_recorder_attempt_gate_fkey"
    FOREIGN KEY ("gate_id") REFERENCES "ozon_publisher_rollout_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_recorder_attempt_identity_check" CHECK (
    length(btrim("attempt_key")) BETWEEN 16 AND 200
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "scope_hash" ~ '^[0-9a-f]{64}$'
    AND "eligible_at" <= "created_at"
    AND (
      ("origin_channel" = 'DIRECT' AND "writer_entrypoint"::TEXT = "parity_entrypoint"::TEXT)
      OR ("origin_channel" = 'BROWSER_ONE_CLICK'
        AND "writer_entrypoint" = 'COLLECT_PUBLISH_OZON'
        AND "parity_entrypoint" = 'BROWSER_ONE_CLICK')
    )
  )
);
CREATE INDEX "ozon_publisher_rollout_recorder_attempt_gate_idx"
  ON "ozon_publisher_rollout_recorder_attempts"("gate_id", "eligible_at");
CREATE INDEX "ozon_publisher_rollout_recorder_attempt_scope_idx"
  ON "ozon_publisher_rollout_recorder_attempts"("rollout_revision", "scope_hash", "eligible_at");

CREATE TABLE "ozon_publisher_rollout_recorder_outcomes" (
  "id" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "result" "OzonPublisherRolloutRecorderResult" NOT NULL,
  "observation_id" TEXT,
  "observation_record_key" TEXT,
  "observation_report_hash" TEXT,
  "failure_code" VARCHAR(100),
  "completed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_rollout_recorder_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_rollout_recorder_outcome_attempt_key" UNIQUE ("attempt_id"),
  CONSTRAINT "ozon_publisher_rollout_recorder_outcome_observation_key" UNIQUE ("observation_id"),
  CONSTRAINT "ozon_publisher_rollout_recorder_outcome_attempt_fkey"
    FOREIGN KEY ("attempt_id") REFERENCES "ozon_publisher_rollout_recorder_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_recorder_outcome_shape_check" CHECK (
    "completed_at" <= "created_at"
    AND (("result" = 'RECORDED' AND "observation_id" IS NOT NULL
        AND "observation_record_key" IS NOT NULL
        AND "observation_report_hash" ~ '^[0-9a-f]{64}$' AND "failure_code" IS NULL)
      OR ("result" = 'FAILED' AND "observation_id" IS NULL
        AND "observation_record_key" IS NULL AND "observation_report_hash" IS NULL
        AND "failure_code" ~ '^[A-Z][A-Z0-9_]{0,99}$'))
  )
);
CREATE INDEX "ozon_publisher_rollout_recorder_outcome_result_idx"
  ON "ozon_publisher_rollout_recorder_outcomes"("result", "completed_at");

CREATE FUNCTION "ozon_publisher_rollout_json_integer"(value JSONB, minimum NUMERIC, maximum NUMERIC)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN jsonb_typeof(value) = 'number'
    AND value #>> '{}' ~ '^(0|[1-9][0-9]*)$'
    AND (value #>> '{}')::NUMERIC BETWEEN minimum AND maximum;
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

CREATE FUNCTION "ozon_publisher_rollout_thresholds_valid"(value JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN jsonb_typeof(value) = 'object'
    AND value ?& ARRAY[
      'windowDays', 'minEligibleAttempts', 'minLiveObservations', 'minDistinctScopes',
      'minActiveUtcDays', 'maxLatestObservationAgeHours', 'minRecorderCoverageBps',
      'rollbackHorizonDays'
    ]::TEXT[]
    AND (value - ARRAY[
      'windowDays', 'minEligibleAttempts', 'minLiveObservations', 'minDistinctScopes',
      'minActiveUtcDays', 'maxLatestObservationAgeHours', 'minRecorderCoverageBps',
      'rollbackHorizonDays'
    ]::TEXT[]) = '{}'::JSONB
    AND "ozon_publisher_rollout_json_integer"(value -> 'windowDays', 14, 365)
    AND "ozon_publisher_rollout_json_integer"(value -> 'minEligibleAttempts', 100, 1000000)
    AND "ozon_publisher_rollout_json_integer"(value -> 'minLiveObservations', 100, 1000000)
    AND "ozon_publisher_rollout_json_integer"(value -> 'minDistinctScopes', 25, 1000000)
    AND "ozon_publisher_rollout_json_integer"(value -> 'minActiveUtcDays', 7, 365)
    AND "ozon_publisher_rollout_json_integer"(value -> 'maxLatestObservationAgeHours', 1, 24)
    AND "ozon_publisher_rollout_json_integer"(value -> 'minRecorderCoverageBps', 10000, 10000)
    AND "ozon_publisher_rollout_json_integer"(value -> 'rollbackHorizonDays', 30, 365);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

CREATE FUNCTION "ozon_publisher_rollout_metrics_valid"(value JSONB)
RETURNS BOOLEAN AS $$
DECLARE key TEXT;
BEGIN
  IF jsonb_typeof(value) <> 'object'
    OR NOT value ?& ARRAY[
      'eligibleAttemptCount', 'completedAttemptCount', 'recordedAttemptCount',
      'failedAttemptCount', 'liveObservationCount', 'distinctScopeCount',
      'activeUtcDays', 'invalidEvidenceCount', 'recorderCoverageBps'
    ]::TEXT[]
    OR (value - ARRAY[
      'eligibleAttemptCount', 'completedAttemptCount', 'recordedAttemptCount',
      'failedAttemptCount', 'liveObservationCount', 'distinctScopeCount',
      'activeUtcDays', 'invalidEvidenceCount', 'recorderCoverageBps'
    ]::TEXT[]) <> '{}'::JSONB THEN
    RETURN FALSE;
  END IF;
  FOREACH key IN ARRAY ARRAY[
    'eligibleAttemptCount', 'completedAttemptCount', 'recordedAttemptCount',
    'failedAttemptCount', 'liveObservationCount', 'distinctScopeCount',
    'activeUtcDays', 'invalidEvidenceCount'
  ] LOOP
    IF NOT "ozon_publisher_rollout_json_integer"(value -> key, 0, 1000000000) THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN "ozon_publisher_rollout_json_integer"(value -> 'recorderCoverageBps', 0, 10000);
END;
$$ LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE;

CREATE TABLE "ozon_publisher_rollout_evaluations" (
  "id" TEXT NOT NULL,
  "evaluation_key" TEXT NOT NULL,
  "gate_id" TEXT NOT NULL,
  "writer_entrypoint" "OzonPublisherWriterEntrypoint" NOT NULL,
  "origin_channel" "OzonPublisherOriginChannel" NOT NULL,
  "rollout_revision" TEXT NOT NULL,
  "record_contract_version" TEXT NOT NULL,
  "evaluator_version" TEXT NOT NULL,
  "result" "OzonPublisherRolloutEvaluationResult" NOT NULL,
  "evidence_hash" TEXT NOT NULL,
  "window_start" TIMESTAMPTZ(3) NOT NULL,
  "window_end" TIMESTAMPTZ(3) NOT NULL,
  "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evidence_retained_until" TIMESTAMPTZ(3) NOT NULL,
  "latest_observation_at" TIMESTAMPTZ(3),
  "thresholds_json" JSONB NOT NULL,
  "metrics_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_rollout_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_rollout_evaluation_key" UNIQUE ("evaluation_key"),
  CONSTRAINT "ozon_publisher_rollout_evaluation_gate_fkey"
    FOREIGN KEY ("gate_id") REFERENCES "ozon_publisher_rollout_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_evaluation_shape_check" CHECK (
    length(btrim("evaluation_key")) BETWEEN 16 AND 200
    AND length(btrim("rollout_revision")) BETWEEN 1 AND 200
    AND "record_contract_version" = 'ozon-publisher-rollout-evaluation/v1'
    AND length(btrim("evaluator_version")) BETWEEN 1 AND 200
    AND "evidence_hash" ~ '^[0-9a-f]{64}$'
    AND "window_start" < "window_end" AND "window_end" <= "evaluated_at"
    AND "evaluated_at" <= "created_at"
    AND pg_column_size("thresholds_json") <= 8192 AND pg_column_size("metrics_json") <= 8192
    AND "ozon_publisher_rollout_thresholds_valid"("thresholds_json")
    AND "ozon_publisher_rollout_metrics_valid"("metrics_json")
    AND "window_end" - "window_start" >= make_interval(days => ("thresholds_json" ->> 'windowDays')::INTEGER)
    AND "evidence_retained_until" >= "evaluated_at"
      + make_interval(days => ("thresholds_json" ->> 'rollbackHorizonDays')::INTEGER)
    AND (("latest_observation_at" IS NULL AND "result" = 'NOT_READY') OR "latest_observation_at" IS NOT NULL)
  )
);
CREATE INDEX "ozon_publisher_rollout_evaluation_gate_idx"
  ON "ozon_publisher_rollout_evaluations"("gate_id", "evaluated_at");
CREATE INDEX "ozon_publisher_rollout_evaluation_result_idx"
  ON "ozon_publisher_rollout_evaluations"("result", "evaluated_at");

ALTER TABLE "ozon_publisher_rollout_gates"
  ADD CONSTRAINT "ozon_publisher_rollout_gate_ready_evaluation_fkey"
  FOREIGN KEY ("ready_evaluation_id") REFERENCES "ozon_publisher_rollout_evaluations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ozon_publisher_rollout_transitions" (
  "id" TEXT NOT NULL,
  "gate_id" TEXT NOT NULL,
  "transition_version" INTEGER NOT NULL,
  "expected_state_version" INTEGER NOT NULL,
  "transition_key" TEXT NOT NULL,
  "operation_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "action" "OzonPublisherRolloutTransitionAction" NOT NULL,
  "from_state" "OzonPublisherRolloutGateState" NOT NULL,
  "result_state" "OzonPublisherRolloutGateState" NOT NULL,
  "evaluation_id" TEXT NOT NULL,
  "evidence_hash_snapshot" TEXT NOT NULL,
  "actor_user_id" TEXT NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "decided_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ozon_publisher_rollout_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ozon_publisher_rollout_transition_key" UNIQUE ("transition_key"),
  CONSTRAINT "ozon_publisher_rollout_transition_version_key" UNIQUE ("gate_id", "transition_version"),
  CONSTRAINT "ozon_publisher_rollout_transition_operation_key" UNIQUE ("gate_id", "operation_key"),
  CONSTRAINT "ozon_publisher_rollout_transition_gate_fkey"
    FOREIGN KEY ("gate_id") REFERENCES "ozon_publisher_rollout_gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_transition_evaluation_fkey"
    FOREIGN KEY ("evaluation_id") REFERENCES "ozon_publisher_rollout_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_transition_actor_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ozon_publisher_rollout_transition_shape_check" CHECK (
    "transition_version" = "expected_state_version" + 1
    AND "transition_version" IN (1, 2)
    AND length(btrim("transition_key")) BETWEEN 16 AND 200
    AND length(btrim("operation_key")) BETWEEN 16 AND 200
    AND "request_hash" ~ '^[0-9a-f]{64}$'
    AND "evidence_hash_snapshot" ~ '^[0-9a-f]{64}$'
    AND length(btrim("reason")) BETWEEN 1 AND 1000
    AND "decided_at" <= "created_at"
    AND (("action" = 'APPROVE' AND "from_state" = 'NOT_READY' AND "result_state" = 'READY'
          AND "expected_state_version" = 0 AND "transition_version" = 1)
      OR ("action" = 'REVOKE' AND "from_state" = 'READY' AND "result_state" = 'REVOKED'
          AND "expected_state_version" = 1 AND "transition_version" = 2))
  )
);
CREATE INDEX "ozon_publisher_rollout_transition_gate_idx"
  ON "ozon_publisher_rollout_transitions"("gate_id", "created_at");
CREATE INDEX "ozon_publisher_rollout_transition_actor_idx"
  ON "ozon_publisher_rollout_transitions"("actor_user_id", "created_at");

CREATE FUNCTION "validate_ozon_publisher_rollout_attempt"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
BEGIN
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND
    OR NEW."writer_entrypoint" IS DISTINCT FROM gate_row."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM gate_row."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM gate_row."rollout_revision" THEN
    RAISE EXCEPTION 'Ozon publisher rollout recorder attempt does not match its gate' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_ozon_publisher_rollout_outcome"() RETURNS trigger AS $$
DECLARE attempt_row "ozon_publisher_rollout_recorder_attempts"%ROWTYPE;
DECLARE observation_row "ozon_publisher_parity_observations"%ROWTYPE;
DECLARE expected_entrypoint TEXT;
BEGIN
  SELECT * INTO attempt_row FROM "ozon_publisher_rollout_recorder_attempts"
   WHERE "id" = NEW."attempt_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."completed_at" < attempt_row."eligible_at" THEN
    RAISE EXCEPTION 'Ozon publisher rollout recorder outcome does not match its attempt' USING ERRCODE = '23514';
  END IF;
  IF NEW."result" = 'RECORDED' THEN
    SELECT * INTO observation_row FROM "ozon_publisher_parity_observations"
     WHERE "id" = NEW."observation_id" FOR KEY SHARE;
    expected_entrypoint := CASE attempt_row."origin_channel"
      WHEN 'DIRECT' THEN attempt_row."writer_entrypoint"::TEXT
      WHEN 'BROWSER_ONE_CLICK' THEN 'BROWSER_ONE_CLICK'
      ELSE NULL
    END;
    IF NOT FOUND OR expected_entrypoint IS NULL
      OR observation_row."entrypoint"::TEXT IS DISTINCT FROM expected_entrypoint
      OR observation_row."rollout_revision" IS DISTINCT FROM attempt_row."rollout_revision"
      OR observation_row."scope_hash" IS DISTINCT FROM attempt_row."scope_hash"
      OR NEW."observation_record_key" IS DISTINCT FROM observation_row."record_key"
      OR NEW."observation_report_hash" IS DISTINCT FROM observation_row."report_hash"
      OR observation_row."observed_at" < attempt_row."eligible_at"
      OR observation_row."observed_at" > NEW."completed_at" THEN
      RAISE EXCEPTION 'Recorded rollout outcome has mismatched parity evidence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_ozon_publisher_rollout_evaluation"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
DECLARE eligible_count BIGINT; DECLARE completed_count BIGINT; DECLARE recorded_count BIGINT;
DECLARE failed_count BIGINT; DECLARE live_count BIGINT; DECLARE scope_count BIGINT;
DECLARE active_days BIGINT; DECLARE invalid_count BIGINT; DECLARE coverage_bps BIGINT;
DECLARE latest_at TIMESTAMPTZ; DECLARE evidence_rows JSONB; DECLARE calculated_hash TEXT;
BEGIN
  IF NOT "ozon_publisher_rollout_thresholds_valid"(NEW."thresholds_json")
    OR NOT "ozon_publisher_rollout_metrics_valid"(NEW."metrics_json") THEN
    RAISE EXCEPTION 'Invalid Ozon publisher rollout evaluation JSON contract' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."writer_entrypoint" IS DISTINCT FROM gate_row."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM gate_row."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM gate_row."rollout_revision" THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation does not match its gate' USING ERRCODE = '23514';
  END IF;

  SELECT count(a."id"), count(o."id"), count(*) FILTER (WHERE o."result" = 'RECORDED'),
         count(*) FILTER (WHERE o."result" = 'FAILED'),
         count(*) FILTER (WHERE o."result" = 'RECORDED' AND p."expires_at" >= NEW."evidence_retained_until"),
         count(DISTINCT a."scope_hash") FILTER (WHERE o."result" = 'RECORDED' AND p."expires_at" >= NEW."evidence_retained_until"),
         count(DISTINCT (p."observed_at" AT TIME ZONE 'UTC')::DATE) FILTER
           (WHERE o."result" = 'RECORDED' AND p."expires_at" >= NEW."evidence_retained_until"),
         count(*) FILTER (WHERE o."result" = 'RECORDED' AND (p."id" IS NULL OR NOT (
           p."expires_at" >= NEW."evidence_retained_until"
           AND p."observed_at" >= NEW."window_start" AND p."observed_at" <= NEW."evaluated_at"
           AND p."switch_eligible"
           AND (p."status" = 'MATCH' OR (p."status" = 'DIFFERENT'
             AND s."approval_state" = 'APPROVED' AND s."approved_at" <= NEW."evaluated_at"))))),
         max(p."observed_at") FILTER (WHERE o."result" = 'RECORDED')
    INTO eligible_count, completed_count, recorded_count, failed_count, live_count,
         scope_count, active_days, invalid_count, latest_at
    FROM "ozon_publisher_rollout_recorder_attempts" a
    LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
    LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
    LEFT JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
   WHERE a."gate_id" = NEW."gate_id"
     AND a."eligible_at" >= NEW."window_start" AND a."eligible_at" < NEW."window_end";
  coverage_bps := CASE WHEN eligible_count = 0 THEN 0 ELSE floor(recorded_count * 10000.0 / eligible_count) END;

  IF (NEW."metrics_json" ->> 'eligibleAttemptCount')::BIGINT <> eligible_count
    OR (NEW."metrics_json" ->> 'completedAttemptCount')::BIGINT <> completed_count
    OR (NEW."metrics_json" ->> 'recordedAttemptCount')::BIGINT <> recorded_count
    OR (NEW."metrics_json" ->> 'failedAttemptCount')::BIGINT <> failed_count
    OR (NEW."metrics_json" ->> 'liveObservationCount')::BIGINT <> live_count
    OR (NEW."metrics_json" ->> 'distinctScopeCount')::BIGINT <> scope_count
    OR (NEW."metrics_json" ->> 'activeUtcDays')::BIGINT <> active_days
    OR (NEW."metrics_json" ->> 'invalidEvidenceCount')::BIGINT <> invalid_count
    OR (NEW."metrics_json" ->> 'recorderCoverageBps')::BIGINT <> coverage_bps
    OR NEW."latest_observation_at" IS DISTINCT FROM latest_at THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation metrics do not match recorder evidence' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'attemptKey', a."attempt_key", 'scopeHash', a."scope_hash", 'eligibleAt', a."eligible_at",
      'outcome', o."result", 'failureCode', o."failure_code", 'completedAt', o."completed_at",
      'observationRecordKey', p."record_key", 'observationReportHash', p."report_hash",
      'differenceSubjectKey', p."difference_subject_key", 'differenceApprovalState', s."approval_state"
    ) ORDER BY a."attempt_key"), '[]'::JSONB)
    INTO evidence_rows
    FROM "ozon_publisher_rollout_recorder_attempts" a
    LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
    LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
    LEFT JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
   WHERE a."gate_id" = NEW."gate_id"
     AND a."eligible_at" >= NEW."window_start" AND a."eligible_at" < NEW."window_end";
  calculated_hash := encode(sha256(convert_to(jsonb_build_object(
    'writerEntrypoint', NEW."writer_entrypoint", 'originChannel', NEW."origin_channel",
    'rolloutRevision', NEW."rollout_revision", 'windowStart', NEW."window_start",
    'windowEnd', NEW."window_end", 'evaluatedAt', NEW."evaluated_at",
    'evidenceRetainedUntil', NEW."evidence_retained_until", 'thresholds', NEW."thresholds_json",
    'metrics', NEW."metrics_json", 'attempts', evidence_rows
  )::TEXT, 'UTF8')), 'hex');
  IF NEW."evidence_hash" <> calculated_hash THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation evidence hash mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW."result" = 'READY' AND (
    eligible_count < (NEW."thresholds_json" ->> 'minEligibleAttempts')::BIGINT
    OR completed_count <> eligible_count OR recorded_count <> eligible_count OR failed_count <> 0
    OR live_count <> recorded_count OR invalid_count <> 0
    OR live_count < (NEW."thresholds_json" ->> 'minLiveObservations')::BIGINT
    OR scope_count < (NEW."thresholds_json" ->> 'minDistinctScopes')::BIGINT
    OR active_days < (NEW."thresholds_json" ->> 'minActiveUtcDays')::BIGINT
    OR coverage_bps < (NEW."thresholds_json" ->> 'minRecorderCoverageBps')::BIGINT
    OR latest_at < NEW."evaluated_at" - make_interval(hours =>
      (NEW."thresholds_json" ->> 'maxLatestObservationAgeHours')::INTEGER)
  ) THEN
    RAISE EXCEPTION 'Ozon publisher rollout evaluation is not READY' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_ozon_publisher_rollout_gate"() RETURNS trigger AS $$
DECLARE evaluation_row "ozon_publisher_rollout_evaluations"%ROWTYPE;
DECLARE current_attempts BIGINT; DECLARE current_recorded BIGINT; DECLARE current_invalid BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'NOT_READY' OR NEW."state_version" <> 0 THEN
      RAISE EXCEPTION 'Ozon publisher rollout gate must start NOT_READY at version zero' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."writer_entrypoint" IS DISTINCT FROM OLD."writer_entrypoint"
    OR NEW."origin_channel" IS DISTINCT FROM OLD."origin_channel"
    OR NEW."rollout_revision" IS DISTINCT FROM OLD."rollout_revision"
    OR NEW."record_contract_version" IS DISTINCT FROM OLD."record_contract_version"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Ozon publisher rollout gate identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."state_version" <> OLD."state_version" + 1
    OR NOT ((OLD."state" = 'NOT_READY' AND NEW."state" = 'READY')
      OR (OLD."state" = 'READY' AND NEW."state" = 'REVOKED')) THEN
    RAISE EXCEPTION 'Illegal Ozon publisher rollout gate CAS transition' USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'READY' AND (
    NEW."ready_evaluation_id" IS DISTINCT FROM OLD."ready_evaluation_id"
    OR NEW."evidence_hash" IS DISTINCT FROM OLD."evidence_hash"
    OR NEW."approved_by_user_id" IS DISTINCT FROM OLD."approved_by_user_id"
    OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at"
    OR NEW."approval_reason" IS DISTINCT FROM OLD."approval_reason") THEN
    RAISE EXCEPTION 'Ozon publisher rollout approval provenance is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."state" = 'READY' THEN
    SELECT * INTO evaluation_row FROM "ozon_publisher_rollout_evaluations"
     WHERE "id" = NEW."ready_evaluation_id" FOR KEY SHARE;
    IF NOT FOUND OR evaluation_row."gate_id" IS DISTINCT FROM NEW."id"
      OR evaluation_row."writer_entrypoint" IS DISTINCT FROM NEW."writer_entrypoint"
      OR evaluation_row."origin_channel" IS DISTINCT FROM NEW."origin_channel"
      OR evaluation_row."rollout_revision" IS DISTINCT FROM NEW."rollout_revision"
      OR evaluation_row."result" <> 'READY'
      OR evaluation_row."evidence_hash" IS DISTINCT FROM NEW."evidence_hash"
      OR NEW."approved_at" < evaluation_row."evaluated_at" THEN
      RAISE EXCEPTION 'READY gate requires exact current READY evaluation evidence' USING ERRCODE = '23514';
    END IF;
    SELECT count(a."id"), count(*) FILTER (WHERE o."result" = 'RECORDED'),
           count(*) FILTER (WHERE o."result" = 'RECORDED' AND (p."id" IS NULL OR NOT (
             p."expires_at" >= evaluation_row."evidence_retained_until" AND p."switch_eligible"
             AND (p."status" = 'MATCH' OR (p."status" = 'DIFFERENT' AND s."approval_state" = 'APPROVED')))))
      INTO current_attempts, current_recorded, current_invalid
      FROM "ozon_publisher_rollout_recorder_attempts" a
      LEFT JOIN "ozon_publisher_rollout_recorder_outcomes" o ON o."attempt_id" = a."id"
      LEFT JOIN "ozon_publisher_parity_observations" p ON p."id" = o."observation_id"
      LEFT JOIN "ozon_publisher_parity_difference_subjects" s ON s."subject_key" = p."difference_subject_key"
     WHERE a."gate_id" = NEW."id" AND a."eligible_at" >= evaluation_row."window_start"
       AND a."eligible_at" < evaluation_row."window_end";
    IF current_attempts <> (evaluation_row."metrics_json" ->> 'eligibleAttemptCount')::BIGINT
      OR current_recorded <> current_attempts OR current_invalid <> 0 THEN
      RAISE EXCEPTION 'READY gate evidence changed after evaluation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "validate_ozon_publisher_rollout_transition"() RETURNS trigger AS $$
DECLARE gate_row "ozon_publisher_rollout_gates"%ROWTYPE;
BEGIN
  SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;
  IF NOT FOUND OR NEW."transition_version" IS DISTINCT FROM gate_row."state_version"
    OR NEW."expected_state_version" IS DISTINCT FROM gate_row."state_version" - 1
    OR NEW."result_state" IS DISTINCT FROM gate_row."state"
    OR NEW."evaluation_id" IS DISTINCT FROM gate_row."ready_evaluation_id"
    OR NEW."evidence_hash_snapshot" IS DISTINCT FROM gate_row."evidence_hash"
    OR (NEW."action" = 'APPROVE' AND (
      NEW."actor_user_id" IS DISTINCT FROM gate_row."approved_by_user_id"
      OR NEW."reason" IS DISTINCT FROM gate_row."approval_reason"
      OR NEW."decided_at" IS DISTINCT FROM gate_row."approved_at"))
    OR (NEW."action" = 'REVOKE' AND (
      NEW."actor_user_id" IS DISTINCT FROM gate_row."revoked_by_user_id"
      OR NEW."reason" IS DISTINCT FROM gate_row."revocation_reason"
      OR NEW."decided_at" IS DISTINCT FROM gate_row."revoked_at")) THEN
    RAISE EXCEPTION 'Ozon publisher rollout transition does not match gate CAS state' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "require_ozon_publisher_rollout_transition"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ozon_publisher_rollout_transitions" t
     WHERE t."gate_id" = NEW."id" AND t."transition_version" = NEW."state_version"
       AND t."result_state" = NEW."state"
  ) THEN
    RAISE EXCEPTION 'Ozon publisher rollout gate CAS transition requires an immutable event' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION "prevent_ozon_publisher_rollout_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ozon publisher rollout history is immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ozon_publisher_rollout_attempt_validate" BEFORE INSERT
  ON "ozon_publisher_rollout_recorder_attempts" FOR EACH ROW
  EXECUTE FUNCTION "validate_ozon_publisher_rollout_attempt"();
CREATE TRIGGER "ozon_publisher_rollout_attempt_immutable" BEFORE UPDATE OR DELETE
  ON "ozon_publisher_rollout_recorder_attempts" FOR EACH ROW
  EXECUTE FUNCTION "prevent_ozon_publisher_rollout_history_mutation"();
CREATE TRIGGER "ozon_publisher_rollout_outcome_validate" BEFORE INSERT
  ON "ozon_publisher_rollout_recorder_outcomes" FOR EACH ROW
  EXECUTE FUNCTION "validate_ozon_publisher_rollout_outcome"();
CREATE TRIGGER "ozon_publisher_rollout_outcome_immutable" BEFORE UPDATE OR DELETE
  ON "ozon_publisher_rollout_recorder_outcomes" FOR EACH ROW
  EXECUTE FUNCTION "prevent_ozon_publisher_rollout_history_mutation"();
CREATE TRIGGER "ozon_publisher_rollout_evaluation_validate" BEFORE INSERT
  ON "ozon_publisher_rollout_evaluations" FOR EACH ROW
  EXECUTE FUNCTION "validate_ozon_publisher_rollout_evaluation"();
CREATE TRIGGER "ozon_publisher_rollout_evaluation_immutable" BEFORE UPDATE OR DELETE
  ON "ozon_publisher_rollout_evaluations" FOR EACH ROW
  EXECUTE FUNCTION "prevent_ozon_publisher_rollout_history_mutation"();
CREATE TRIGGER "ozon_publisher_rollout_gate_validate" BEFORE INSERT OR UPDATE
  ON "ozon_publisher_rollout_gates" FOR EACH ROW
  EXECUTE FUNCTION "validate_ozon_publisher_rollout_gate"();
CREATE TRIGGER "ozon_publisher_rollout_gate_no_delete" BEFORE DELETE
  ON "ozon_publisher_rollout_gates" FOR EACH ROW
  EXECUTE FUNCTION "prevent_ozon_publisher_rollout_history_mutation"();
CREATE TRIGGER "ozon_publisher_rollout_transition_validate" BEFORE INSERT
  ON "ozon_publisher_rollout_transitions" FOR EACH ROW
  EXECUTE FUNCTION "validate_ozon_publisher_rollout_transition"();
CREATE TRIGGER "ozon_publisher_rollout_transition_immutable" BEFORE UPDATE OR DELETE
  ON "ozon_publisher_rollout_transitions" FOR EACH ROW
  EXECUTE FUNCTION "prevent_ozon_publisher_rollout_history_mutation"();
CREATE CONSTRAINT TRIGGER "ozon_publisher_rollout_transition_required"
  AFTER UPDATE ON "ozon_publisher_rollout_gates" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "require_ozon_publisher_rollout_transition"();

COMMIT;
