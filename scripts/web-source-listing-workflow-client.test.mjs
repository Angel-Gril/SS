import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const modulePath = 'apps/web/src/lib/source-listing-workflow.ts';
assert.equal(fs.existsSync(modulePath), true, `${modulePath} should exist`);
assert.doesNotMatch(
  fs.readFileSync(modulePath, 'utf8'),
  /\/api\/collect\/publish-ozon/,
  'the Unit 6B client must not contain a legacy publisher fallback',
);

function loadClientModule(defaultApi = {}) {
  const source = fs.readFileSync(modulePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(specifier) {
      if (specifier === '@/lib/api') return { api: defaultApi };
      if (specifier === 'shared') {
        return {
          OZON_LISTING_CURRENCY_CODE_LENGTH: 3,
          OZON_LISTING_DECIMAL_MAX_LENGTH: 64,
          OZON_LISTING_IMPORT_MAX_ITEMS: 100,
          OZON_LISTING_OFFER_ID_MAX_LENGTH: 50,
          OZON_LISTING_PRICING_CONTRACT_VERSION: 'ozon-listing-pricing/v1',
          OZON_LISTING_SUPPORTED_CURRENCY_CODES: ['CNY', 'RUB'],
          OZON_LISTING_SUPPORTED_VAT_RATES: ['0', '0.05', '0.07', '0.1', '0.2', '0.22'],
          isOzonListingOldPriceAtLeastPrice(price, oldPrice) {
            const [priceInteger, priceFraction = ''] = price.split('.');
            const [oldPriceInteger, oldPriceFraction = ''] = oldPrice.split('.');
            if (oldPriceInteger.length !== priceInteger.length) {
              return oldPriceInteger.length > priceInteger.length;
            }
            if (oldPriceInteger !== priceInteger) return oldPriceInteger > priceInteger;
            const scale = Math.max(priceFraction.length, oldPriceFraction.length);
            return oldPriceFraction.padEnd(scale, '0') >= priceFraction.padEnd(scale, '0');
          },
        };
      }
      throw new Error(`Unexpected import: ${specifier}`);
    },
    AbortController,
    AbortSignal,
    BigInt,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URLSearchParams,
    clearTimeout,
    setTimeout,
  };
  vm.runInNewContext(compiled, sandbox, { filename: modulePath });
  return Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox.exports;
}

const workflow = loadClientModule();

{
  const parsed = workflow.parseSourceListingHandoff(
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&snapshotVersion=7&sourceProductId=12345678901234567890&section=listing&workflowId=workflow-1&attemptId=attempt-1',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), {
    supplyGoodsId: 'goods-1',
    snapshotId: 'snapshot-1',
    snapshotVersion: 7,
    sourceProductId: '12345678901234567890',
    section: 'listing',
    workflowId: 'workflow-1',
    attemptId: 'attempt-1',
  });
  const platformHandoff = workflow.parseSourceListingHandoff(
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&sourceProductId=12345678901234567890&platform=1688&section=listing',
  );
  assert.equal(platformHandoff.platform, '1688');
  assert.equal(
    workflow.buildSourceListingHandoffSearchParams(platformHandoff).get('platform'),
    '1688',
  );
  for (const invalid of [
    '?supplyGoodsId=goods-1',
    '?snapshotId=snapshot-1',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&token=secret',
    '?supplyGoodsId=goods-1&supplyGoodsId=goods-2&snapshotId=snapshot-1',
    '?supplyGoodsId=%20goods-1&snapshotId=snapshot-1',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&snapshotVersion=0',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&snapshotVersion=01',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&sourceProductId=not-numeric',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&section=overview',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&attemptId=attempt-1',
    '?supplyGoodsId=goods-1&snapshotId=snapshot-1&platform=ozon',
  ]) {
    assert.throws(
      () => workflow.parseSourceListingHandoff(invalid),
      (error) => error?.code === 'INVALID_HANDOFF',
      invalid,
    );
  }
}

{
  const pricing = workflow.buildOzonListingPricingV1({
    selectedSkuKeys: ['sku-2', 'sku-1'],
    items: [
      { skuKey: 'sku-1', price: '1299.00', oldPrice: '1499.00', currencyCode: 'RUB', vat: '0', offerId: 'offer-1' },
      { skuKey: 'sku-2', price: '1399', oldPrice: '1599', currencyCode: 'RUB', vat: '0' },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(pricing)), {
    contractVersion: 'ozon-listing-pricing/v1',
    items: [
      { skuKey: 'sku-2', price: '1399', oldPrice: '1599', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-1', price: '1299.00', oldPrice: '1499.00', currencyCode: 'RUB', vat: '0', offerId: 'offer-1' },
    ],
  });
  const cnyPricing = workflow.buildOzonListingPricingV1({
    selectedSkuKeys: ['sku-1'],
    items: [{ skuKey: 'sku-1', price: '180', oldPrice: '200', currencyCode: 'CNY', vat: '0' }],
  });
  assert.equal(cnyPricing.items[0].currencyCode, 'CNY');
  const maximumOfferId = 'a'.repeat(50);
  const boundaryPricing = workflow.buildOzonListingPricingV1({
    selectedSkuKeys: ['sku-1'],
    items: [{
      skuKey: 'sku-1', price: '180', oldPrice: '200', currencyCode: 'CNY', vat: '0',
      offerId: maximumOfferId,
    }],
  });
  assert.equal(boundaryPricing.items[0].offerId, maximumOfferId);
  for (const input of [
    { selectedSkuKeys: ['sku-1', 'sku-2'], items: [{ skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'RUB', vat: '0' }] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '0', oldPrice: '2', currencyCode: 'RUB', vat: '0' }] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '2.01', oldPrice: '2', currencyCode: 'RUB', vat: '0' }] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '9007199254740993', oldPrice: '9007199254740992', currencyCode: 'RUB', vat: '0' }] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '1.0000000000000000002', oldPrice: '1.0000000000000000001', currencyCode: 'RUB', vat: '0' }] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'RUB', vat: '0.20' }] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'USD', vat: '0' }] },
    { selectedSkuKeys: ['sku-1', 'sku-2'], items: [
      { skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'CNY', vat: '0' },
      { skuKey: 'sku-2', price: '1', oldPrice: '2', currencyCode: 'RUB', vat: '0' },
    ] },
    { selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: 1, oldPrice: '2', currencyCode: 'RUB', vat: '0' }] },
    { selectedSkuKeys: ['sku-1'], items: [
      { skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'RUB', vat: '0' },
    ] },
    { selectedSkuKeys: ['sku-1'], items: [{
      skuKey: 'sku-1', price: '1', oldPrice: '2', currencyCode: 'RUB', vat: '0',
      offerId: 'a'.repeat(51),
    }] },
  ]) {
    assert.throws(
      () => workflow.buildOzonListingPricingV1(input),
      (error) => error?.code === 'INVALID_PRICING',
    );
  }
}

{
  const first = workflow.buildSourceListingPublishIdempotencyKey({ draftId: 'draft-1', draftVersion: 7, revision: 11 });
  const replay = workflow.buildSourceListingPublishIdempotencyKey({ draftId: 'draft-1', draftVersion: 7, revision: 11 });
  const changed = workflow.buildSourceListingPublishIdempotencyKey({ draftId: 'draft-1', draftVersion: 7, revision: 12 });
  assert.equal(first, replay);
  assert.notEqual(first, changed);
  assert.match(first, /^source-publish-v1-[a-f0-9]{32}$/);
  assert.ok(first.length >= 8 && first.length <= 200);
}

function draft(revision = 4) {
  return {
    id: 'workflow-1',
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    shopId: 'shop-1',
    selectedSkuKeys: ['sku-1'],
    draftVersion: 2,
    revision,
  };
}

function attempt(overrides = {}) {
  return {
    id: 'attempt-1',
    workflowId: 'workflow-1',
    draftVersion: 2,
    revision: 5,
    state: 'SUBMITTED',
    reconciliationState: 'PENDING',
    stateVersion: 2,
    ozonTaskId: '12345',
    requestPayloadHash: 'b'.repeat(64),
    itemCount: 1,
    itemErrors: [],
    ...overrides,
  };
}

{
  const calls = [];
  const transport = {
    async get(path) {
      calls.push(['GET', path]);
      if (path.startsWith('/api/source-capture-views/')) {
        return { code: 1, msg: 'ok', data: {
          snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', captureHash: 'a'.repeat(64),
          version: 2, capturedAt: '2026-07-14T00:00:00.000Z',
          captureVersion: 'source-product-capture-v2', sourceIdentity: {}, facts: {}, completeness: {},
          truncations: [], counts: { version: 'source-capture-stage-counts-v1', fields: {} },
          skus: { items: [], total: 0, offset: 10, limit: 25 },
          media: { items: [], total: 0, offset: 2, limit: 12 },
        } };
      }
      if (path === '/api/source-listing-workflows/publisher-capability?shopId=shop-1') {
        return { code: 1, msg: 'ok', data: { enabled: true, legacyAllowed: false, reason: 'pilot_match', revision: 'rollout-1' } };
      }
      if (path === '/api/source-listing-workflows/workflow-1') return { code: 1, msg: 'ok', data: draft() };
      if (path === '/api/source-listing-workflows/workflow-1/ai-copy-capability') {
        return { code: 1, msg: 'ok', data: { enabled: true, revision: 4, reason: 'tenant_allowed' } };
      }
      if (path === '/api/source-listing-workflows/workflow-1/publish-attempts?limit=20&cursor=cursor-1') {
        return { code: 1, msg: 'ok', data: { items: [attempt()], nextCursor: null } };
      }
      if (path === '/api/source-listing-workflows/workflow-1/publish-attempts/attempt-1') {
        return { code: 1, msg: 'ok', data: attempt() };
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post(path, body) {
      calls.push(['POST', path, body]);
      if (path === '/api/source-listing-workflows') return { code: 1, msg: 'ok', data: draft() };
      if (path.endsWith('/ai-candidates/generate')) return { code: 1, msg: 'ok', data: {
        candidate: { id: 'generated-copy-1', kind: 'AI_GENERATED' },
        limit: { used: 1, remaining: 19, limit: 20 },
      } };
      if (path.endsWith('/ai-candidates')) return { code: 1, msg: 'ok', data: { id: 'copy-1' } };
      if (path.endsWith('/ai-candidates/apply')) return { code: 1, msg: 'ok', data: draft(5) };
      if (path.endsWith('/media/internalize')) return { code: 1, msg: 'ok', data: {
        assets: [{ sourceMediaKey: 'media-1', id: 'asset-1' }],
        assignments: [{ scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-1', source: 'SOURCE' }],
      } };
      if (path.endsWith('/validate')) return { code: 1, msg: 'ok', data: draft(8) };
      if (path.endsWith('/publish-attempts')) return { code: 1, msg: 'ok', data: attempt() };
      if (path.endsWith('/resolve')) return { code: 1, msg: 'ok', data: attempt({ state: 'SUBMITTED', reconciliationState: 'PENDING', stateVersion: 3 }) };
      throw new Error(`Unexpected POST ${path}`);
    },
    async put(path, body) {
      calls.push(['PUT', path, body]);
      if (path.endsWith('/media')) return { code: 1, msg: 'ok', data: draft(6) };
      if (path.endsWith('/pricing')) return { code: 1, msg: 'ok', data: draft(7) };
      throw new Error(`Unexpected PUT ${path}`);
    },
    async patch(path, body) {
      calls.push(['PATCH', path, body]);
      if (path === '/api/source-listing-workflows/workflow-1') return { code: 1, msg: 'ok', data: draft(5) };
      throw new Error(`Unexpected PATCH ${path}`);
    },
  };
  const client = workflow.createSourceListingWorkflowClient(transport);
  const handoff = workflow.parseSourceListingHandoff('?supplyGoodsId=goods-1&snapshotId=snapshot-1');
  await client.getCaptureView(handoff, { skuOffset: 10, skuLimit: 25, mediaOffset: 2, mediaLimit: 12 });
  await client.createWorkflowFromSnapshot({ handoff, shopId: 'shop-1', selectedSkuKeys: ['sku-1'] });
  await client.getDraft('workflow-1');
  await client.updateCategory('workflow-1', {
    expectedRevision: 4,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1', categoryName: 'Category', typeName: 'Type' },
  });
  await client.getPublisherCapability('shop-1');
  await client.getAiCopyCapability('workflow-1');
  await client.generateCopyCandidate('workflow-1', {
    expectedRevision: 4,
    operationKey: 'generate-copy-1',
    fields: ['title', 'description'],
    userInstructions: 'Concise copy',
  });
  await client.createCopyCandidate('workflow-1', { expectedRevision: 4, titleRu: 'Русское название', descriptionRu: null, sourcePromptVersion: 'copy-v1' });
  await client.applyCopyCandidate('workflow-1', { expectedRevision: 4, candidateId: 'copy-1', operationKey: 'apply-copy' });
  await client.internalizeMedia('workflow-1', {
    expectedRevision: 5,
    selections: [{ sourceMediaKey: 'media-1', slotKey: 'main', scope: 'PRODUCT' }],
  });
  await client.assignMedia('workflow-1', { expectedRevision: 5, assignments: [{ scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-1', source: 'SOURCE' }] });
  const pricing = workflow.buildOzonListingPricingV1({ selectedSkuKeys: ['sku-1'], items: [{ skuKey: 'sku-1', price: '1299', oldPrice: '1499', currencyCode: 'RUB', vat: '0' }] });
  await client.savePricing('workflow-1', { expectedRevision: 6, value: pricing });
  await client.validateFinalDraft('workflow-1', 7);
  await client.createPublishAttempt('workflow-1', { expectedRevision: 8, idempotencyKey: 'source-publish-v1-1234567890abcdef1234567890abcdef' });
  await client.listPublishAttempts('workflow-1', { limit: 20, cursor: 'cursor-1' });
  await client.getPublishAttempt('workflow-1', 'attempt-1');
  await client.resolvePublishAttempt('workflow-1', 'attempt-1', {
    expectedStateVersion: 2,
    decision: 'SUBMITTED',
    taskId: '12345',
    note: 'Ozon task confirmed',
    evidence: { source: 'ozon_task_lookup' },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
    'GET',
    '/api/source-capture-views/snapshot-1?supplyGoodsId=goods-1&skuOffset=10&skuLimit=25&mediaOffset=2&mediaLimit=12',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), ['POST', '/api/source-listing-workflows', {
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    selectedSkuKeys: ['sku-1'],
  }]);
  const internalizeCall = calls.find((entry) => String(entry[1]).endsWith('/media/internalize'));
  assert.deepEqual(JSON.parse(JSON.stringify(internalizeCall)), ['POST', '/api/source-listing-workflows/workflow-1/media/internalize', {
    expectedRevision: 5,
    selections: [{ sourceMediaKey: 'media-1', slotKey: 'main', scope: 'PRODUCT' }],
  }]);
  assert.equal(calls.some((entry) => String(entry[1]).includes('/api/collect/publish-ozon')), false);
  assert.ok(calls.some((entry) => entry[0] === 'POST' && String(entry[1]).endsWith('/publish-attempts')));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find((entry) => String(entry[1]).endsWith('/ai-candidates/generate')))), [
    'POST',
    '/api/source-listing-workflows/workflow-1/ai-candidates/generate',
    {
      expectedRevision: 4,
      operationKey: 'generate-copy-1',
      fields: ['title', 'description'],
      userInstructions: 'Concise copy',
    },
  ]);
}

{
  const conflict = { id: 'workflow-1', revision: 9 };
  const client = workflow.createSourceListingWorkflowClient({
    async get() {
      return {
        code: 0,
        msg: 'Listing draft revision changed',
        errorCode: 'OZON_LISTING_DRAFT_VERSION_CONFLICT',
        current: conflict,
        currentVersion: 9,
        currentDraftVersion: 3,
      };
    },
    async post() { throw new Error('unused'); },
    async put() { throw new Error('unused'); },
  });
  await assert.rejects(
    () => client.getDraft('workflow-1'),
    (error) => error?.errorCode === 'OZON_LISTING_DRAFT_VERSION_CONFLICT'
      && error?.current === conflict
      && error?.currentVersion === 9
      && error?.currentDraftVersion === 3,
  );
}

{
  let reads = 0;
  const states = [
    attempt({ state: 'SUBMITTING', reconciliationState: 'NOT_REQUIRED' }),
    attempt({ state: 'SUBMITTED', reconciliationState: 'RUNNING' }),
    attempt({ state: 'SUBMITTED', reconciliationState: 'SUCCEEDED' }),
  ];
  const client = workflow.createSourceListingWorkflowClient({
    async get() { return { code: 1, msg: 'ok', data: states[Math.min(reads++, states.length - 1)] }; },
    async post() { throw new Error('unused'); },
    async put() { throw new Error('unused'); },
  });
  const completed = await client.pollPublishAttempt('workflow-1', 'attempt-1', {
    maxAttempts: 5,
    intervalMs: 0,
    sleep: async () => {},
  });
  assert.equal(completed.reconciliationState, 'SUCCEEDED');
  assert.equal(reads, 3);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => client.pollPublishAttempt('workflow-1', 'attempt-1', { signal: controller.signal }),
    (error) => error?.code === 'POLL_CANCELLED',
  );

  await assert.rejects(
    () => client.pollPublishAttempt('workflow-1', 'attempt-1', {
      maxAttempts: 2,
      intervalMs: 0,
      sleep: async () => {},
      isTerminal: () => false,
    }),
    (error) => error?.code === 'POLL_LIMIT' && error?.lastAttempt?.id === 'attempt-1',
  );
}

console.log('PASS web source listing workflow client');
