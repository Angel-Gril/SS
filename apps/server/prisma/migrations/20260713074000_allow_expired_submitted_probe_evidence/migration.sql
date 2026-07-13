ALTER TABLE "logistics_company_probes"
  DROP CONSTRAINT "logistics_company_probe_state_check";

ALTER TABLE "logistics_company_probes"
  ADD CONSTRAINT "logistics_company_probe_state_check" CHECK (
    ("status" = 'ISSUED'
      AND "claimed_by_session_id" IS NULL AND "claimed_at" IS NULL
      AND "submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
      AND "submitted_at" IS NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "review_reason" IS NULL)
    OR
    ("status" = 'CLAIMED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
      AND "submitted_at" IS NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "review_reason" IS NULL)
    OR
    ("status" = 'SUBMITTED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "submitted_company_id" IS NOT NULL AND "submitted_evidence" IS NOT NULL
      AND "submitted_at" IS NOT NULL AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL AND "review_reason" IS NULL)
    OR
    ("status" = 'CONFIRMED'
      AND "claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
      AND "submitted_company_id" IS NOT NULL AND "submitted_evidence" IS NOT NULL
      AND "submitted_at" IS NOT NULL AND "company_binding_id" IS NOT NULL
      AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND "review_reason" IS NOT NULL)
    OR
    ("status" = 'REJECTED'
      AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NOT NULL AND "reviewed_at" IS NOT NULL
      AND "review_reason" IS NOT NULL)
    OR
    ("status" = 'EXPIRED'
      AND "company_binding_id" IS NULL
      AND "reviewed_by_id" IS NULL AND "reviewed_at" IS NULL
      AND "review_reason" IS NULL
      AND (
        ("claimed_by_session_id" IS NULL AND "claimed_at" IS NULL
          AND "submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
          AND "submitted_at" IS NULL)
        OR
        ("claimed_by_session_id" IS NOT NULL AND "claimed_at" IS NOT NULL
          AND (
            ("submitted_company_id" IS NULL AND "submitted_evidence" IS NULL
              AND "submitted_at" IS NULL)
            OR
            ("submitted_company_id" IS NOT NULL AND "submitted_evidence" IS NOT NULL
              AND "submitted_at" IS NOT NULL)
          ))
      ))
  );
