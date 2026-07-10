CREATE TABLE "legal_acceptances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "terms_version" TEXT NOT NULL,
    "privacy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "legal_acceptances_user_id_idx" ON "legal_acceptances"("user_id");
CREATE INDEX "legal_acceptances_profile_idx" ON "legal_acceptances"("profile");
CREATE INDEX "legal_acceptances_accepted_at_idx" ON "legal_acceptances"("accepted_at");

ALTER TABLE "legal_acceptances"
ADD CONSTRAINT "legal_acceptances_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
