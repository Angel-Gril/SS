-- Deterministic image processing has distinct provenance from Provider output.
-- No existing assets or ledger entries are rewritten.
ALTER TYPE "MediaAssetKind" ADD VALUE IF NOT EXISTS 'IMAGE_PROCESSED';
