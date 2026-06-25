ALTER TABLE "ozon_category_catalog"
  ADD COLUMN "category_levels_json" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "translation_status" TEXT NOT NULL DEFAULT 'missing',
  ADD COLUMN "untranslated_terms_json" JSONB NOT NULL DEFAULT '[]';

WITH level_rows AS (
  SELECT
    c."id",
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'level', ru.ordinality,
          'categoryId', CASE
            WHEN ru.ordinality = jsonb_array_length(c."category_path_ru") THEN c."description_category_id"
            ELSE 0
          END,
          'nameRu', btrim(ru.name_ru),
          'nameZh', btrim(COALESCE(zh.name_zh, '')),
          'translated', btrim(COALESCE(zh.name_zh, '')) <> '' AND btrim(COALESCE(zh.name_zh, '')) !~ '[А-Яа-яЁё]'
        ) ORDER BY ru.ordinality
      ) FILTER (WHERE NULLIF(btrim(ru.name_ru), '') IS NOT NULL),
      '[]'::jsonb
    ) AS "category_levels_json"
  FROM "ozon_category_catalog" c
  LEFT JOIN LATERAL jsonb_array_elements_text(c."category_path_ru") WITH ORDINALITY AS ru(name_ru, ordinality) ON TRUE
  LEFT JOIN LATERAL jsonb_array_elements_text(c."category_path_zh") WITH ORDINALITY AS zh(name_zh, ordinality)
    ON zh.ordinality = ru.ordinality
  GROUP BY c."id"
)
UPDATE "ozon_category_catalog" c
SET "category_levels_json" = level_rows."category_levels_json"
FROM level_rows
WHERE c."id" = level_rows."id";

WITH audit_terms AS (
  SELECT
    c."id",
    ru.ordinality::integer AS sort_order,
    btrim(ru.name_ru) AS term,
    btrim(COALESCE(zh.name_zh, '')) <> '' AND btrim(COALESCE(zh.name_zh, '')) !~ '[А-Яа-яЁё]' AS translated,
    btrim(ru.name_ru) <> '' AND (
      btrim(COALESCE(zh.name_zh, '')) = '' OR btrim(COALESCE(zh.name_zh, '')) ~ '[А-Яа-яЁё]'
    ) AS untranslated
  FROM "ozon_category_catalog" c
  LEFT JOIN LATERAL jsonb_array_elements_text(c."category_path_ru") WITH ORDINALITY AS ru(name_ru, ordinality) ON TRUE
  LEFT JOIN LATERAL jsonb_array_elements_text(c."category_path_zh") WITH ORDINALITY AS zh(name_zh, ordinality)
    ON zh.ordinality = ru.ordinality

  UNION ALL

  SELECT
    c."id",
    10000 AS sort_order,
    btrim(c."type_name_ru") AS term,
    btrim(c."type_name_zh") <> '' AND btrim(c."type_name_zh") !~ '[А-Яа-яЁё]' AS translated,
    btrim(c."type_name_ru") <> '' AND (
      btrim(c."type_name_zh") = '' OR btrim(c."type_name_zh") ~ '[А-Яа-яЁё]'
    ) AS untranslated
  FROM "ozon_category_catalog" c
), audit_rows AS (
  SELECT
    "id",
    COALESCE(jsonb_agg(to_jsonb(term) ORDER BY sort_order) FILTER (WHERE untranslated), '[]'::jsonb) AS untranslated_terms_json,
    COALESCE(bool_or(translated), false) AS has_translation
  FROM audit_terms
  GROUP BY "id"
)
UPDATE "ozon_category_catalog" c
SET
  "untranslated_terms_json" = audit_rows.untranslated_terms_json,
  "translation_status" = CASE
    WHEN jsonb_array_length(audit_rows.untranslated_terms_json) = 0 THEN 'complete'
    WHEN audit_rows.has_translation THEN 'partial'
    ELSE 'missing'
  END
FROM audit_rows
WHERE c."id" = audit_rows."id";

CREATE INDEX "ozon_category_catalog_translation_status_idx" ON "ozon_category_catalog"("translation_status");
