BEGIN;
SET LOCAL lock_timeout = '5s';

-- A row-level UPDATE locks the gate before its BEFORE ROW trigger runs. The
-- recorder/evaluator paths therefore must not take a gate row lock after they
-- acquire the shared advisory fence, or the two lock orders can deadlock.
DO $$
DECLARE body TEXT;
DECLARE locked_read TEXT :=
  'SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id" FOR KEY SHARE;';
DECLARE snapshot_read TEXT :=
  'SELECT * INTO gate_row FROM "ozon_publisher_rollout_gates" WHERE "id" = NEW."gate_id";';
BEGIN
  SELECT prosrc INTO body
    FROM pg_proc
   WHERE oid = 'validate_ozon_publisher_rollout_attempt()'::regprocedure;
  IF body IS NULL OR strpos(body, locked_read) = 0 THEN
    RAISE EXCEPTION 'Unexpected rollout attempt validator definition' USING ERRCODE = '23514';
  END IF;
  body := replace(body, locked_read, snapshot_read);
  EXECUTE 'CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_attempt"() '
    || 'RETURNS trigger AS ' || quote_literal(body) || ' LANGUAGE plpgsql';

  SELECT prosrc INTO body
    FROM pg_proc
   WHERE oid = 'validate_ozon_publisher_rollout_evaluation()'::regprocedure;
  IF body IS NULL OR strpos(body, locked_read) = 0
    OR strpos(body, 'max(p."observed_at") FILTER') = 0 THEN
    RAISE EXCEPTION 'Unexpected rollout evaluation validator definition' USING ERRCODE = '23514';
  END IF;
  body := replace(body, locked_read, snapshot_read);
  -- Freshness is anchored to the eligible write attempt. A delayed observation
  -- must not extend the 24-hour readiness window.
  body := replace(body, 'max(p."observed_at") FILTER', 'max(a."eligible_at") FILTER');
  EXECUTE 'CREATE OR REPLACE FUNCTION "validate_ozon_publisher_rollout_evaluation"() '
    || 'RETURNS trigger AS ' || quote_literal(body) || ' LANGUAGE plpgsql';
END;
$$;

COMMIT;
