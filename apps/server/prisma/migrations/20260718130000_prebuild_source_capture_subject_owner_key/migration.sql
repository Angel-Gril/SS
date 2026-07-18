CREATE UNIQUE INDEX CONCURRENTLY "source_capture_subject_id_owner_idx"
  ON "source_capture_subjects"("id", "owner_user_id");
