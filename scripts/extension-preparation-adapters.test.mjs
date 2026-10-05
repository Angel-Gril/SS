import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const ctx = { URL, URLSearchParams };
for (const path of [
  'shared/erp-adapter/listing-workflow-client.js',
  'shared/donor-workbench/workspace-contract.js',
])
  vm.runInNewContext(readFileSync('extensions/ss-erp/' + path, 'utf8'), ctx);
const binding = {
  snapshotId: 's',
  supplyGoodsId: 'g',
  shopId: 'shop',
  listingWorkflowId: 'd',
  draftRevision: 1,
  draftVersion: 1,
};
const selection = {
  assignmentId: 'a',
  companyId: 'c',
  warehouseId: 'w',
  originCountryUid: 'cn',
  originCityUid: 'city',
  destinationCountryUid: 'ru',
  destinationLocationUid: 'dest',
};
test('attribute preparation applies only frozen server candidates and never caller-owned values', async () => {
  const requests = [];
  const workspace = { schemaRevision: 'a'.repeat(64), fields: [], values: [] };
  const client = ctx.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
    transport: {
      get: async () => {},
      post: async (path, body) => {
        requests.push(body);
        return {
          state: 'response',
          body: {
            code: 1,
            data: path.endsWith('attribute-suggestions')
              ? { state: 'ready', workspace, suggestions: [], blockedSuggestions: [] }
              : {
                  contractVersion: 'extension-listing-editor/v1',
                  binding,
                  selectedSkuKeys: ['sku'],
                  category: null,
                  pricing: null,
                },
          },
        };
      },
    },
  });
  assert.equal(
    (await client.readDraftAttributeSuggestions(binding)).suggestions.workspace.schemaRevision,
    workspace.schemaRevision,
  );
  const value = {
    schemaRevision: workspace.schemaRevision,
    candidates: [
      {
        attributeId: 10,
        candidateId: 'candidate',
        candidateHash: 'b'.repeat(64),
        schemaRevision: workspace.schemaRevision,
      },
    ],
  };
  await client.saveDraftEditor({
    binding,
    operationKey: 'attribute-operation',
    action: 'ATTRIBUTE_SUGGESTIONS',
    value,
  });
  await assert.rejects(
    client.saveDraftEditor({
      binding,
      operationKey: 'attribute-operation',
      action: 'ATTRIBUTE_SUGGESTIONS',
      value: { ...value, reviewed: true },
    }),
  );
  assert.equal(requests.length, 2);
});
test('logistics preparation returns only scoped quotes and rejects another draft before applying', async () => {
  let response = {
    contractVersion: 'extension-listing-logistics-pricing/v1',
    binding,
    selectedSkuKeys: ['sku'],
    packaging: [],
    assignments: [],
    hints: { commission: null, fx: null, requiresManual: ['commissionPct', 'fxRate'] },
    requiresSelection: true,
  };
  const client = ctx.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
    transport: {
      get: async () => {},
      post: async () => ({ state: 'response', body: { code: 1, data: response } }),
    },
  });
  assert.deepEqual(
    JSON.parse(
      JSON.stringify((await client.readDraftLogisticsScopes(binding)).logistics.assignments),
    ),
    [],
  );
  response = { ...response, binding: { ...binding, shopId: 'foreign' } };
  await assert.rejects(client.readDraftLogisticsScopes(binding));
  await assert.rejects(
    client.quoteDraftLogistics({
      binding,
      selection,
      releaseId: 'release',
      effectiveChecksum: 'b'.repeat(64),
      stableServiceKey: 'svc',
      items: [{ skuKey: 'sku', declaredPriceMinor: 0, hasBattery: false }],
    }),
  );
});
