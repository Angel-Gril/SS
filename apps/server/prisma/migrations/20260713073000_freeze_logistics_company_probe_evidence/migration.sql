ALTER TABLE "logistics_company_probes"
  ADD COLUMN "issued_evidence_checksum" TEXT;

UPDATE "logistics_company_probes" p
   SET "issued_evidence_checksum" = b."evidence_checksum"
  FROM "logistics_scope_bootstraps" b
 WHERE b."id" = p."bootstrap_id";

ALTER TABLE "logistics_company_probes"
  ALTER COLUMN "issued_evidence_checksum" SET NOT NULL;

ALTER TABLE "logistics_company_probes"
  ADD CONSTRAINT "logistics_company_probes_issued_evidence_checksum_check"
  CHECK ("issued_evidence_checksum" ~ '^[0-9a-f]{64}$')
  NOT VALID;

ALTER TABLE "logistics_company_probes"
  VALIDATE CONSTRAINT "logistics_company_probes_issued_evidence_checksum_check";
