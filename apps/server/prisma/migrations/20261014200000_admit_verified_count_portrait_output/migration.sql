BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

-- The configured count service returned a decoded 1086x1448 image for the
-- frozen 1008x1344 request. Admit only this additional exact 3:4 frame; keep
-- original dimensions, bytes, provenance, frozen request and settlement guards.
-- No business rows or historical receipts are rewritten.
DO $$
DECLARE
  signature TEXT;
  original_fragment TEXT;
  replacement_fragment TEXT;
  function_definition TEXT;
BEGIN
  FOR signature, original_fragment, replacement_fragment IN
    VALUES
      ('assert_ai_media_suite_execution_graph(text,text)',
       'WHEN donor_suite THEN raw_output."width"=1008 AND raw_output."height"=1344',
       'WHEN donor_suite THEN (raw_output."width",raw_output."height") IN ((1008,1344),(1086,1448))'),
      ('prevent_ai_media_suite_child_output_before_dispatch()',
       'WHEN donor_suite THEN NEW."width"=1008 AND NEW."height"=1344',
       'WHEN donor_suite THEN (NEW."width",NEW."height") IN ((1008,1344),(1086,1448))')
  LOOP
    SELECT replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n') INTO function_definition;
    IF function_definition IS NULL
      OR (length(function_definition) - length(replace(function_definition, original_fragment, '')))
        <> length(original_fragment)
    THEN
      RAISE EXCEPTION 'unexpected count portrait output guard definition: %', signature;
    END IF;
    EXECUTE replace(function_definition, original_fragment, replacement_fragment);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMIT;
