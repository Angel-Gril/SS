BEGIN;

CREATE OR REPLACE FUNCTION source_listing_sku_keys_are_canonical(keys JSONB)
RETURNS BOOLEAN AS $$
DECLARE
  canonical JSONB;
BEGIN
  IF jsonb_typeof(keys) <> 'array'
    OR jsonb_array_length(keys) < 1
    OR jsonb_array_length(keys) > 500 THEN
    RETURN FALSE;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(keys) item
    WHERE jsonb_typeof(item) <> 'string'
      OR item #>> '{}' <> btrim(item #>> '{}')
      OR length(item #>> '{}') NOT BETWEEN 1 AND 500
  ) THEN
    RETURN FALSE;
  END IF;
  SELECT jsonb_agg(to_jsonb(value) ORDER BY value) INTO canonical
  FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(keys) value) normalized;
  RETURN canonical = keys;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMIT;
