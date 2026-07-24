const ROW = 1;
const BEFORE = 2;
const INSERT = 4;
const DELETE = 8;
const UPDATE = 16;

function trigger(functionSignature, triggerType, options = {}) {
  return Object.freeze({
    functionSignature,
    triggerType,
    constraint: options.constraint === true,
    deferrable: options.deferrable === true,
    initiallyDeferred: options.initiallyDeferred === true,
    whenExpression: options.whenExpression || null,
    updateColumns: Object.freeze([...(options.updateColumns || [])].sort()),
  });
}

const expectedTriggers = new Map([
  ['ai_media_suite_slots.ai_media_suite_slots_materialized_lifecycle_protected',
    trigger('protect_ai_media_suite_materialized_slot_lifecycle()', ROW | BEFORE | UPDATE)],
  ['ai_media_suite_slots.ai_media_suite_slot_identity_immutable',
    trigger('protect_ai_media_suite_slot_identity()', ROW | BEFORE | UPDATE | DELETE)],
  ['ai_media_suites.ai_media_suite_execution_graph',
    trigger('require_ai_media_suite_execution_graph_from_suite()', ROW | UPDATE, {
      constraint: true,
      deferrable: true,
      initiallyDeferred: true,
      whenExpression: 'new.revision >= 5',
    })],
  ['ai_media_suite_slots.ai_media_suite_execution_slot_graph',
    trigger('require_ai_media_suite_execution_graph_from_slot()', ROW | UPDATE, {
      constraint: true, deferrable: true, initiallyDeferred: true,
    })],
  ['ai_media_workflows.ai_media_suite_execution_workflow_graph',
    trigger('require_ai_media_suite_execution_graph_from_workflow()', ROW | UPDATE, {
      constraint: true, deferrable: true, initiallyDeferred: true,
    })],
  ['ai_image_jobs.ai_media_suite_execution_job_graph',
    trigger('require_ai_media_suite_execution_graph_from_job()', ROW | INSERT | UPDATE, {
      constraint: true, deferrable: true, initiallyDeferred: true,
    })],
  ['ai_cost_reservations.ai_media_suite_execution_reservation_graph',
    trigger('require_ai_media_suite_execution_graph_from_reservation()', ROW | INSERT | UPDATE, {
      constraint: true, deferrable: true, initiallyDeferred: true,
    })],
  ['media_assets.ai_media_suite_execution_asset_graph',
    trigger('require_ai_media_suite_execution_graph_from_asset()', ROW | INSERT | UPDATE | DELETE, {
      constraint: true, deferrable: true, initiallyDeferred: true,
    })],
  ['media_assets.media_assets_referenced_identity_immutable',
    trigger('protect_referenced_media_asset_identity()', ROW | BEFORE | UPDATE, {
      updateColumns: [
        'id', 'owner_user_id', 'ai_image_job_id', 'kind', 'source_capture_snapshot_id',
        'source_media_key', 'source_url', 'url', 'storage_backend', 'storage_key',
        'mime_type', 'size_bytes', 'width', 'height', 'sha256', 'metadata', 'created_at',
      ],
    })],
  ['media_assets.media_assets_suite_child_output_before_dispatch',
    trigger('prevent_ai_media_suite_child_output_before_dispatch()', ROW | BEFORE | INSERT | UPDATE, {
      updateColumns: ['ai_image_job_id'],
    })],
  ['media_assets.media_assets_suite_child_identity_protected',
    trigger('protect_ai_media_suite_child_asset_identity()', ROW | BEFORE | UPDATE | DELETE)],
  ['ai_media_workflows.ai_media_workflows_suite_selected_output_protected',
    trigger('protect_ai_media_suite_selected_output()', ROW | BEFORE | UPDATE, {
      updateColumns: ['selected_output_asset_id', 'review_status'],
    })],
  ['ai_image_jobs.ai_image_jobs_suite_child_append_closed',
    trigger('prevent_ai_media_suite_bound_child_insert()', ROW | BEFORE | INSERT)],
  ['ai_media_workflow_inputs.ai_media_workflow_inputs_suite_child_append_closed',
    trigger('prevent_ai_media_suite_bound_child_insert()', ROW | BEFORE | INSERT)],
]);

function normalizedWhenExpression(value) {
  if (value == null) return '';
  return String(value)
    .replaceAll('"', '')
    .replace(/[()]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function triggerWhenContractMatches(definition, expected) {
  const normalized = normalizedWhenExpression(definition);
  if (!expected) return !normalized.includes(' when ');
  return normalized.includes(` when ${expected} execute function `);
}

function normalizedColumns(value) {
  return Array.isArray(value) ? value.map(String).sort() : [];
}

export const EXPECTED_AI_MEDIA_SUITE_TRIGGER_COUNT = expectedTriggers.size;

export async function loadAiMediaSuiteTriggerRows(database) {
  return await database.$queryRawUnsafe(`
    SELECT
      namespace.nspname AS "tableSchema",
      relation.relname AS "tableName",
      catalog_trigger.tgname AS "triggerName",
      catalog_trigger.tgenabled AS "enabled",
      catalog_trigger.tgtype::integer AS "triggerType",
      catalog_trigger.tgdeferrable AS "deferrable",
      catalog_trigger.tginitdeferred AS "initiallyDeferred",
      (catalog_trigger.tgconstraint <> 0) AS "constraint",
      pg_catalog.pg_get_triggerdef(catalog_trigger.oid, true) AS "definition",
      ARRAY(
        SELECT attribute.attname
        FROM unnest(catalog_trigger.tgattr::smallint[]) WITH ORDINALITY
          AS update_column(attnum, ordinal)
        JOIN pg_catalog.pg_attribute attribute
          ON attribute.attrelid = catalog_trigger.tgrelid
         AND attribute.attnum = update_column.attnum
        ORDER BY update_column.ordinal
      ) AS "updateColumns",
      catalog_trigger.tgfoid::oid AS "functionOid",
      procedure_namespace.nspname AS "functionSchema",
      procedure.proname || '(' || pg_catalog.oidvectortypes(procedure.proargtypes) || ')'
        AS "functionSignature"
    FROM pg_catalog.pg_trigger catalog_trigger
    JOIN pg_catalog.pg_class relation ON relation.oid = catalog_trigger.tgrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_proc procedure ON procedure.oid = catalog_trigger.tgfoid
    JOIN pg_catalog.pg_namespace procedure_namespace ON procedure_namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = current_schema()
      AND NOT catalog_trigger.tgisinternal
  `);
}

export function validateAiMediaSuiteTriggerRows(rows) {
  const actual = new Map(rows.map((row) => [
    `${row.tableName}.${row.triggerName}`,
    row,
  ]));
  for (const [identity, expected] of expectedTriggers) {
    const row = actual.get(identity);
    if (!row) throw new Error(`critical trigger is missing: ${identity}`);
    if (row.enabled !== 'O') {
      throw new Error(`critical trigger is not enabled for origin writes: ${identity}`);
    }
    if (row.functionSchema !== row.tableSchema
      || row.functionSignature !== expected.functionSignature
      || row.functionOid == null) {
      throw new Error(`critical trigger has the wrong pg_proc binding: ${identity}`);
    }
    const firingContractMatches = Number(row.triggerType) === expected.triggerType
      && row.constraint === expected.constraint
      && row.deferrable === expected.deferrable
      && row.initiallyDeferred === expected.initiallyDeferred
      && triggerWhenContractMatches(row.definition, expected.whenExpression)
      && JSON.stringify(normalizedColumns(row.updateColumns))
        === JSON.stringify(expected.updateColumns);
    if (!firingContractMatches) {
      throw new Error(`critical trigger has the wrong firing contract: ${identity}`);
    }
  }
}
