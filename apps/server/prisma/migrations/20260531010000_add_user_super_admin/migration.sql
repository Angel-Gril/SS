-- Add super-admin marker for platform-level administration.
ALTER TABLE "users" ADD COLUMN "is_super_admin" BOOLEAN NOT NULL DEFAULT false;
