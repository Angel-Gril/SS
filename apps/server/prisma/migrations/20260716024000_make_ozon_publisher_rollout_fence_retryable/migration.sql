BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE body TEXT;
DECLARE snapshot_read TEXT :=
  'SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id";';
DECLARE locked_read TEXT :=
  'SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;';
DECLARE blocking_gate_lock TEXT :=
  'PERFORM pg_advisory_xact_lock(hashtextextended(NEW."id", 6381623));';
DECLARE retryable_gate_lock TEXT :=
  'IF TG_OP = ''UPDATE'' THEN
    IF NOT pg_try_advisory_xact_lock(hashtextextended(NEW."id", 6381623)) THEN
      RAISE EXCEPTION ''Ozon publisher rollout gate fence is busy; retry the CAS transaction''
        USING ERRCODE = ''40001'';
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW."id", 6381623));
  END IF;';
BEGIN
  SELECT prosrc INTO body
    FROM pg_proc
   WHERE oid = 'validate_ozon_publisher_rollout_attempt()'::regprocedure;
  IF body IS NULL OR strpos(body, snapshot_read) = 0 THEN
    RAISE EXCEPTION 'Unexpected rollout attempt validator definition' USING ERRCODE = '23514';
  END IF;
  body := replace(body, snapshot_read, locked_read);
  EXECUTE 'CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_attempt"() '
    || 'RETURNS trigger AS ' || quote_literal(body) || ' LANGUAGE plpgsql';

  SELECT prosrc INTO body
    FROM pg_proc
   WHERE oid = 'validate_ozon_publisher_rollout_evaluation()'::regprocedure;
  IF body IS NULL OR strpos(body, snapshot_read) = 0
    OR strpos(body, 'max(a."eligible_at") FILTER') = 0 THEN
    RAISE EXCEPTION 'Unexpected rollout evaluation validator definition' USING ERRCODE = '23514';
  END IF;
  body := replace(body, snapshot_read, locked_read);
  EXECUTE 'CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_evaluation"() '
    || 'RETURNS trigger AS ' || quote_literal(body) || ' LANGUAGE plpgsql';

  SELECT prosrc INTO body
    FROM pg_proc
   WHERE oid = 'validate_ozon_publisher_rollout_gate()'::regprocedure;
  IF body IS NULL OR strpos(body, blocking_gate_lock) = 0 THEN
    RAISE EXCEPTION 'Unexpected rollout gate validator definition' USING ERRCODE = '23514';
  END IF;
  body := replace(body, blocking_gate_lock, retryable_gate_lock);
  EXECUTE 'CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_gate"() '
    || 'RETURNS trigger AS ' || quote_literal(body) || ' LANGUAGE plpgsql';
END;
$$;

COMMIT;
