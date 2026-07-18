BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "source_capture_snapshots"
  ADD CONSTRAINT "source_capture_snapshot_id_subject_key"
  UNIQUE USING INDEX "source_capture_snapshot_id_subject_idx";

ALTER TABLE "source_capture_subjects"
  ADD CONSTRAINT "source_capture_subject_id_owner_key"
  UNIQUE USING INDEX "source_capture_subject_id_owner_idx";

COMMIT;
