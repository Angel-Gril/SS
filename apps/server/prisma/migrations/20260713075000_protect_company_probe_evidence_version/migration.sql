CREATE OR REPLACE FUNCTION "protect_logistics_company_probe_provenance"()
RETURNS trigger AS $$
BEGIN
  IF NEW."bootstrap_id" IS DISTINCT FROM OLD."bootstrap_id"
    OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
    OR NEW."nonce_digest" IS DISTINCT FROM OLD."nonce_digest"
    OR NEW."issued_evidence_checksum" IS DISTINCT FROM OLD."issued_evidence_checksum"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    RAISE EXCEPTION 'logistics company probe provenance is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."submitted_company_id" IS NOT NULL
    AND (NEW."submitted_company_id" IS DISTINCT FROM OLD."submitted_company_id"
      OR NEW."submitted_evidence" IS DISTINCT FROM OLD."submitted_evidence"
      OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at") THEN
    RAISE EXCEPTION 'logistics company probe submitted evidence is immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
