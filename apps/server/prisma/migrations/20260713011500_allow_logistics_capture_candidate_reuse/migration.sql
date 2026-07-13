-- One immutable content candidate may prove identical uploads from multiple capture tasks.
DROP INDEX IF EXISTS "logistics_capture_tasks_candidate_id_key";
