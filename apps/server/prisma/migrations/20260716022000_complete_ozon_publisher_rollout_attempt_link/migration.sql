BEGIN;
SET LOCAL lock_timeout = '5s';

-- Development databases may already have applied 160210 before the provenance
-- FK was added to that fresh-deploy migration. Keep both upgrade paths exact.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ozon_publisher_parity_observation_eligible_attempt_fkey'
       AND conrelid = 'ozon_publisher_parity_observations'::regclass
  ) THEN
    ALTER TABLE "ozon_publisher_parity_observations"
      ADD CONSTRAINT "ozon_publisher_parity_observation_eligible_attempt_fkey"
      FOREIGN KEY ("eligible_attempt_key")
      REFERENCES "ozon_publisher_rollout_recorder_attempts"("eligible_attempt_key")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END;
$$;

COMMIT;
