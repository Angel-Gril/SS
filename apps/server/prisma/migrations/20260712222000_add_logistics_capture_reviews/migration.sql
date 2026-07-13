-- AlterTable
ALTER TABLE "logistics_capture_candidates"
  ADD COLUMN "reviewed_by_id" TEXT,
  ADD COLUMN "reviewed_at" TIMESTAMP(3),
  ADD COLUMN "review_reason" VARCHAR(1000);

ALTER TABLE "logistics_capture_candidates"
  ADD CONSTRAINT "capture_candidate_reviewer_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "logistics_capture_candidate_review_state_check" CHECK (
    ("review_status" = 'PENDING_REVIEW'
      AND "reviewed_by_id" IS NULL
      AND "reviewed_at" IS NULL
      AND "review_reason" IS NULL)
    OR
    ("review_status" = 'VERIFIED'
      AND "reviewed_by_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND "review_reason" IS NOT NULL
      AND length(btrim("review_reason")) BETWEEN 3 AND 1000)
    OR
    ("review_status" = 'REJECTED'
      AND "reviewed_by_id" IS NOT NULL
      AND "reviewed_at" IS NOT NULL
      AND "review_reason" IS NOT NULL
      AND length(btrim("review_reason")) BETWEEN 3 AND 1000)
  );

CREATE OR REPLACE FUNCTION "prevent_logistics_capture_candidate_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    OR to_jsonb(OLD) - ARRAY['review_status', 'reviewed_by_id', 'reviewed_at', 'review_reason']
       IS DISTINCT FROM
       to_jsonb(NEW) - ARRAY['review_status', 'reviewed_by_id', 'reviewed_at', 'review_reason'] THEN
    RAISE EXCEPTION 'logistics capture candidate content is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."review_status" <> 'PENDING_REVIEW'
    OR NEW."review_status" = 'PENDING_REVIEW' THEN
    RAISE EXCEPTION 'logistics capture candidate review is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
