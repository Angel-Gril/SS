-- BYOK Provider execution stays in the extension.  ERP accepts reviewed
-- output only through this distinct, device-scoped command operation.
ALTER TYPE "ExtensionCommandOperation"
  ADD VALUE IF NOT EXISTS 'BYOK_MEDIA_INGEST';
