-- PostgreSQL enum values must be committed before later migrations use them
-- in functions, constraints, or data writes.
ALTER TYPE "AiMediaOperation" ADD VALUE IF NOT EXISTS 'FULL_EDIT';
ALTER TYPE "AiMediaOperation" ADD VALUE IF NOT EXISTS 'INPAINT';
ALTER TYPE "MediaAssetKind" ADD VALUE IF NOT EXISTS 'EDIT_MASK';
ALTER TYPE "MediaAssetKind" ADD VALUE IF NOT EXISTS 'AI_PROVIDER_OUTPUT';
