CREATE UNIQUE INDEX CONCURRENTLY "source_capture_snapshot_id_subject_idx"
  ON "source_capture_snapshots"("id", "subject_id");
