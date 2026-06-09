-- Track required SaaS legal consent for new registrations.
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "privacy_accepted_at" TIMESTAMP(3);
