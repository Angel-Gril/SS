BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE "ai_media_listing_draft_application_mutations"
  DROP CONSTRAINT "ai_media_listing_draft_mutation_before_state_check",
  DROP CONSTRAINT "ai_media_listing_draft_mutation_after_state_check";

ALTER TABLE "ai_media_listing_draft_application_mutations"
  ADD CONSTRAINT "ai_media_listing_draft_mutation_before_state_check" CHECK (
    jsonb_typeof("before_state_json") = 'object'
    AND ("before_state_json" - ARRAY['version', 'assignment']::text[]) = '{}'::jsonb
    AND "before_state_json"->>'version' = 'ai-media-listing-draft-assignment/v1'
    AND "before_state_json" ? 'assignment'
    AND (
      "before_state_json"->'assignment' = 'null'::jsonb
      OR (
        jsonb_typeof("before_state_json"->'assignment') = 'object'
        AND (("before_state_json"->'assignment') - ARRAY['scope', 'skuKey', 'slotKey', 'assetId', 'source']::text[]) = '{}'::jsonb
        AND jsonb_typeof("before_state_json"->'assignment'->'scope') = 'string'
        AND jsonb_typeof("before_state_json"->'assignment'->'slotKey') = 'string'
        AND jsonb_typeof("before_state_json"->'assignment'->'assetId') = 'string'
        AND jsonb_typeof("before_state_json"->'assignment'->'source') = 'string'
        AND "before_state_json"->'assignment'->>'scope' IN ('PRODUCT', 'SKU')
        AND "before_state_json"->'assignment'->>'source' IN ('SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED')
        AND btrim("before_state_json"->'assignment'->>'slotKey') <> ''
        AND char_length("before_state_json"->'assignment'->>'slotKey') <= 200
        AND btrim("before_state_json"->'assignment'->>'assetId') <> ''
        AND char_length("before_state_json"->'assignment'->>'assetId') <= 500
        AND (
          ("before_state_json"->'assignment'->>'scope' = 'PRODUCT'
            AND NOT ("before_state_json"->'assignment' ? 'skuKey'))
          OR ("before_state_json"->'assignment'->>'scope' = 'SKU'
            AND jsonb_typeof("before_state_json"->'assignment'->'skuKey') = 'string'
            AND btrim("before_state_json"->'assignment'->>'skuKey') <> ''
            AND char_length("before_state_json"->'assignment'->>'skuKey') <= 500)
        )
      )
    )
    AND octet_length("before_state_json"::text) <= 65536
  ),
  ADD CONSTRAINT "ai_media_listing_draft_mutation_after_state_check" CHECK (
    jsonb_typeof("after_state_json") = 'object'
    AND ("after_state_json" - ARRAY['version', 'assignment']::text[]) = '{}'::jsonb
    AND "after_state_json"->>'version' = 'ai-media-listing-draft-assignment/v1'
    AND "after_state_json" ? 'assignment'
    AND (
      "after_state_json"->'assignment' = 'null'::jsonb
      OR (
        jsonb_typeof("after_state_json"->'assignment') = 'object'
        AND (("after_state_json"->'assignment') - ARRAY['scope', 'skuKey', 'slotKey', 'assetId', 'source']::text[]) = '{}'::jsonb
        AND jsonb_typeof("after_state_json"->'assignment'->'scope') = 'string'
        AND jsonb_typeof("after_state_json"->'assignment'->'slotKey') = 'string'
        AND jsonb_typeof("after_state_json"->'assignment'->'assetId') = 'string'
        AND jsonb_typeof("after_state_json"->'assignment'->'source') = 'string'
        AND "after_state_json"->'assignment'->>'scope' IN ('PRODUCT', 'SKU')
        AND "after_state_json"->'assignment'->>'source' IN ('SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED')
        AND btrim("after_state_json"->'assignment'->>'slotKey') <> ''
        AND char_length("after_state_json"->'assignment'->>'slotKey') <= 200
        AND btrim("after_state_json"->'assignment'->>'assetId') <> ''
        AND char_length("after_state_json"->'assignment'->>'assetId') <= 500
        AND (
          ("after_state_json"->'assignment'->>'scope' = 'PRODUCT'
            AND NOT ("after_state_json"->'assignment' ? 'skuKey'))
          OR ("after_state_json"->'assignment'->>'scope' = 'SKU'
            AND jsonb_typeof("after_state_json"->'assignment'->'skuKey') = 'string'
            AND btrim("after_state_json"->'assignment'->>'skuKey') <> ''
            AND char_length("after_state_json"->'assignment'->>'skuKey') <= 500)
        )
      )
    )
    AND octet_length("after_state_json"::text) <= 65536
  );

COMMIT;
