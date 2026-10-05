import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const context = { URL, URLSearchParams };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js', 'utf8'), context);
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/workspace-contract.js', 'utf8'), context);
const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
const editor = { contractVersion: 'extension-listing-editor/v1', binding, selectedSkuKeys: ['sku'], category: null, pricing: null };

test('copy generation reads actual admission and creates only pending candidates using the frozen device draft', async () => {
  const calls = [];
  const capability = { available: true, reasonCode: 'AVAILABLE', providerFeeNotice: '生成文案可能产生 Provider 费用，不自动审核或发布。' };
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {},
    post: async (path, body, options) => { calls.push({ path, body, options });
      return { state: 'response', body: path.endsWith('copy-capability') ? { code: 1, data: capability }
        : { code: 1, data: editor, candidateId: 'candidate', replayed: false } }; } } });
  const available = await client.readDraftCopyCapability(binding);
  assert.deepEqual(JSON.parse(JSON.stringify(available.capability)), capability);
  const generated = await client.generateDraftCopy({ binding, operationKey: 'copy-generation-123', fields: ['title', 'description'], userInstructions: '保留真实规格' });
  assert.equal(generated.candidateId, 'candidate');
  assert.equal(calls[1].options.requiredScope, 'listing:write');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body)), { binding, operationKey: 'copy-generation-123', fields: ['title', 'description'], userInstructions: '保留真实规格' });
  const frame = { contractVersion: context.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION,
    type: 'EDITOR_COPY_GENERATE', requestId: 'copy-1', listingWorkflowId: binding.listingWorkflowId,
    binding, operationKey: 'copy-generation-123', fields: ['title', 'description'] };
  assert.equal(context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand(frame).type, frame.type);
  assert.throws(() => context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...frame, fields: ['title', 'attributes'] }));
  assert.throws(() => context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...frame, apiKey: 'forged' }));
});

test('copy generation rejects malformed requests before transport and preserves unknown mutation outcomes', async () => {
  const calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (path, body) => {
    calls.push({ path, body }); return { state: 'unknown_outcome' }; } } });
  const request = { binding, operationKey: 'copy-generation-123', fields: ['title'] };
  for (const invalid of [{ fields: [] }, { fields: ['title', 'title'] }, { fields: ['attributes'] },
    { operationKey: 'short' }, { userInstructions: 'a'.repeat(2001) }, { ownerUserId: 'foreign' }]) {
    await assert.rejects(client.generateDraftCopy({ ...request, ...invalid }));
  }
  assert.equal(calls.length, 0);
  await assert.rejects(client.generateDraftCopy(request), error => error.outcome === 'UNKNOWN_OUTCOME');
  assert.equal(calls.length, 1, 'an unknown generation is never automatically retried');
  const running = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async () => ({
    state: 'http_error', status: 409, body: { code: 0, errorCode: 'ozon_listing_ai_generation_in_progress', msg: '原请求仍待核对' },
  }) } });
  await assert.rejects(running.generateDraftCopy(request), error => error.outcome === 'UNKNOWN_OUTCOME');
});

test('category catalog transports an exact readonly preview and retains the official tree and recommendations', async()=>{
  const preview={categoryId:10,typeId:20,catalogRevision:'catalog-1'};
  const leaf={categoryId:10,typeId:20,label:'服装 / T恤',typeLabel:'T恤',pathTitles:['服装']};
  const field={attributeId:201,name:'材质',required:true,valueType:'STRING',cardinality:'SINGLE',dictionaryId:null,
    ownership:'EDITOR',editorMode:'EDITABLE',valuePolicy:'FREE_TEXT',maxValues:1};
  let sent;
  const data={catalogRevision:'catalog-1',entries:[leaf],total:1,truncated:false,
    tree:[{categoryId:10,label:'服装',children:[],types:[leaf]}],treeTruncated:false,
    recommendations:[{...leaf,match:'recommended',reasons:['来源类目：女式T恤']}],
    attributePreview:{...preview,schemaRevision:'a'.repeat(64),fields:[field]}};
  const client=context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({transport:{get:async()=>{},post:async(path,body,options)=>{
    sent={path,body,options};return{state:'response',body:{code:1,data}};}}});
  const result=await client.readDraftCatalog({binding,query:'',preview});
  assert.deepEqual(JSON.parse(JSON.stringify(sent.body)),{binding,query:'',preview});
  assert.equal(sent.options.requiredScope,'listing:review');
  assert.deepEqual(JSON.parse(JSON.stringify(result.catalog)),data);
  for(const extra of [{apiKey:'secret'},{ownerUserId:'other'},{selected:true}])await assert.rejects(client.readDraftCatalog({binding,query:'',preview:{...preview,...extra}}));
  const command={contractVersion:context.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION,type:'EDITOR_CATALOG',requestId:'cat-1',listingWorkflowId:'draft',binding,query:'',preview};
  assert.deepEqual(JSON.parse(JSON.stringify(context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand(command))),command);
});

test('category catalog accepts all five server recommendations and rejects excess or invalid entries', async () => {
  const recommendations = Array.from({ length: 5 }, (_, index) => ({
    categoryId: 10 + index, typeId: 20 + index, label: '服装 / 类目 ' + index,
    match: 'recommended', reasons: ['源商品画像'],
  }));
  let data = { catalogRevision: 'catalog-1', entries: [], total: 0, truncated: false, recommendations };
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: {
    get: async () => {}, post: async () => ({ state: 'response', body: { code: 1, data } }),
  } });
  const result = await client.readDraftCatalog({ binding, query: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.catalog.recommendations)), recommendations);
  data = { ...data, recommendations: [...recommendations, { ...recommendations[0], typeId: 99 }] };
  await assert.rejects(client.readDraftCatalog({ binding, query: '' }), /invalid category recommendations/u);
  data = { ...data, recommendations: [{ ...recommendations[0], match: 'automatic' }] };
  await assert.rejects(client.readDraftCatalog({ binding, query: '' }), /invalid category recommendations/u);
});

test('editor preserves only server-bound ordered publish media and bounded readiness fields', async () => {
  const readiness = { ...editor, stage: 'MEDIA_REVIEW', validation: { status: 'STALE' }, blockers: [],
    freshness: { category: 'CURRENT', attributes: 'CURRENT', content: 'CURRENT', media: 'CURRENT', pricing: 'CURRENT', validation: 'STALE' },
    mediaAssignments: [{ scope: 'PRODUCT', skuKey: null, slotKey: 'product-main', assetId: 'asset-1' },
      { scope: 'SKU', skuKey: 'sku', slotKey: 'hero', assetId: 'asset-2' }] };
  let response = readiness;
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {},
    post: async () => ({ state: 'response', body: { code: 1, data: response } }) } });
  assert.deepEqual(JSON.parse(JSON.stringify((await client.readDraftEditor(binding)).editor.mediaAssignments)), readiness.mediaAssignments);
  for (const mediaAssignments of [[{ ...readiness.mediaAssignments[0], url: 'https://private.example' }],
    [{ ...readiness.mediaAssignments[1], skuKey: 'another' }], [{ ...readiness.mediaAssignments[0], assetId: '' }]]) {
    response = { ...readiness, mediaAssignments };
    await assert.rejects(client.readDraftEditor(binding), /invalid editor response/u);
  }
});
test('editor reads and saves only the exact device-bound draft through the closed transport', async () => {
  const calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: {
    get: async () => {}, post: async (path, body, options) => {
      calls.push({ path, body, options });
      return { state: 'response', body: { code: 1, data: editor, replayed: true } };
    },
  } });
  assert.equal((await client.readDraftEditor(binding)).state, 'ready');
  const saved = await client.saveDraftEditor({ binding, action: 'PRICING', operationKey: 'editor-123', value: { contractVersion: 'ozon-listing-pricing/v1', items: [] } });
  assert.equal(saved.replayed, true);
  assert.equal(calls[1].options.requiredScope, 'listing:write');
  assert.deepEqual(calls.map((item) => item.path), ['/api/extension-device/source-workbench/editor/read', '/api/extension-device/source-workbench/editor/save']);
});
test('frame editor commands reject forged identity and arbitrary fields', () => {
  const api = context.SS_ERP_DONOR_WORKBENCH_CONTRACT;
  const command = { contractVersion: api.CONTRACT_VERSION, type: 'EDITOR_SAVE', requestId: 'request-1', listingWorkflowId: 'draft',
    binding, action: 'CATEGORY', operationKey: 'category-123', value: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } };
  assert.equal(api.parseFrameCommand(command).type, 'EDITOR_SAVE');
  assert.throws(() => api.parseFrameCommand({ ...command, ownerUserId: 'forged' }));
  assert.throws(() => api.parseFrameCommand({ ...command, value: { ...command.value, apiKey: 'forged' } }));
});

test('official attribute reads preserve field policies, SKU ownership and more than three dictionary IDs', async () => {
  const schemaRevision = 'a'.repeat(64);
  const field = { attributeId: 201, name: '商品特点', required: true, valueType: 'STRING', cardinality: 'SINGLE', ownership: 'EDITOR', editorMode: 'EDITABLE', valuePolicy: 'FREE_TEXT', dictionaryId: null, maxValues: 1 };
  const multi = { ...field, attributeId: 203, name: '特性', cardinality: 'MULTI', valuePolicy: 'STRICT_DICTIONARY', dictionaryId: 9, maxValues: 100 };
  const workspace = { schemaRevision, fields: [field, multi], values: [
    { attributeId: 201, skuKey: null, value: '用户填写', dictionaryValueIds: [], reviewed: true },
    { attributeId: 203, skuKey: null, value: ['A', 'B', 'C', 'D'], dictionaryValueIds: [11, 12, 13, 14], reviewed: true },
  ] };
  const calls = [];
  let response = workspace;
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (path, body, options) => {
    calls.push({ path, body, options }); return { state: 'response', body: { code: 1, data: response } };
  } } });
  assert.deepEqual(JSON.parse(JSON.stringify((await client.readDraftAttributes(binding)).workspace)), workspace);
  assert.equal(calls[0].path, '/api/extension-device/source-workbench/editor/attributes');
  assert.equal(calls[0].options.requiredScope, 'listing:review');
  for (const invalid of [
    { ...workspace, apiKey: 'extra' }, { ...workspace, fields: [{ ...field, owner: 'caller' }] },
    { ...workspace, fields: [{ ...field, maxValues: 101 }] }, { ...workspace, fields: [field, field] },
    { ...workspace, values: [{ ...workspace.values[0], attributeId: 900 }] },
    { ...workspace, values: [{ ...workspace.values[0], skuKey: 'wrong' }] },
    { ...workspace, values: [{ ...workspace.values[0], reviewed: 'true' }] },
    { ...workspace, values: [{ ...workspace.values[1], dictionaryValueIds: [11, 11] }] },
    { ...workspace, values: [{ ...workspace.values[1], dictionaryValueIds: [0] }] },
    { ...workspace, schemaRevision: 'old' },
  ]) {
    response = invalid;
    await assert.rejects(client.readDraftAttributes(binding), /invalid attribute workspace response/);
  }
});

test('official dictionary responses and requests are closed, bounded and schema-bound', async () => {
  const schemaRevision = 'a'.repeat(64);
  const dictionary = { schemaRevision, attributeId: 202, values: [{ id: 7, value: 'Синий' }, { id: 8, value: 'Зеленый' }],
    complete: false, dictionaryComplete: false, resultExhaustive: false, hasMore: true, resultTruncated: true };
  const calls = [];
  let response = dictionary;
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (path, body, options) => {
    calls.push({ path, body, options }); return { state: 'response', body: { code: 1, data: response } };
  } } });
  const request = { binding, schemaRevision, attributeId: 202, query: '', limit: 100 };
  assert.deepEqual(JSON.parse(JSON.stringify((await client.readDraftDictionary(request)).dictionary)), dictionary);
  assert.equal(calls[0].path, '/api/extension-device/source-workbench/editor/dictionary');
  assert.equal(calls[0].options.requiredScope, 'listing:review');
  for (const extra of [{ limit: 0 }, { limit: 101 }, { query: 'a'.repeat(201) }, { attributeId: 0 }, { schemaRevision: 'old' }, { url: 'https://invalid.test' }]) {
    await assert.rejects(client.readDraftDictionary({ ...request, ...extra }), /invalid attribute dictionary request/);
  }
  assert.equal(calls.length, 1, 'invalid dictionary input fails before transport');
  for (const invalid of [{ ...dictionary, schemaRevision: 'b'.repeat(64) }, { ...dictionary, attributeId: 203 },
    { ...dictionary, provider: 'extra' }, { ...dictionary, values: [{ id: 0, value: 'bad' }] },
    { ...dictionary, values: [dictionary.values[0], dictionary.values[0]] }, { ...dictionary, hasMore: 'yes' }]) {
    response = invalid;
    await assert.rejects(client.readDraftDictionary(request), /invalid attribute dictionary response/);
  }
});

test('known attribute rejections allow correction while lost or malformed write receipts remain unknown', async () => {
  let response = { state: 'http_error', status: 409, body: { code: 0, errorCode: 'ozon_attribute_schema_mismatch', msg: '官方字段已更新，请重新读取' } };
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async () => response } });
  const request = { binding, action: 'ATTRIBUTES', operationKey: 'attributes-operation-1', value: { schemaRevision: 'a'.repeat(64), changes: [] } };
  await assert.rejects(client.saveDraftEditor(request), (error) => error.outcome === 'NOT_SUBMITTED' && error.serverCode === 'ozon_attribute_schema_mismatch');
  response = { state: 'http_error', status: 503, body: { code: 0, msg: '不可用' } };
  await assert.rejects(client.saveDraftEditor(request), (error) => error.outcome === 'UNKNOWN_OUTCOME');
  response = { state: 'response', body: { code: 1, data: { ...editor, binding: { ...binding, shopId: 'wrong' } } } };
  await assert.rejects(client.saveDraftEditor(request), (error) => error.outcome === 'UNKNOWN_OUTCOME');
});

test('manual copy DTO preserves long legacy descriptions and only closed pending candidate fields', async () => {
  const copy = { titleRu: 'Товар', descriptionRu: 'x'.repeat(200000), pendingCandidates: [
    { id: 'copy-1', fields: ['title'], titleRu: 'Новый товар', descriptionRu: null, sourceCurrent: true },
  ] };
  let response = { ...editor, copy };
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async () => ({ state: 'response', body: { code: 1, data: response } }) } });
  assert.equal((await client.readDraftEditor(binding)).editor.copy.descriptionRu.length, 200000);
  for (const invalid of [{ ...copy, kind: 'MANUAL' }, { ...copy, descriptionRu: 'x'.repeat(200001) },
    { ...copy, pendingCandidates: [{ ...copy.pendingCandidates[0], source: 'caller' }] },
    { ...copy, pendingCandidates: [{ ...copy.pendingCandidates[0], sourceCurrent: 'true' }] },
    { ...copy, pendingCandidates: [{ ...copy.pendingCandidates[0], fields: ['title', 'title'] }] },
    { ...copy, pendingCandidates: [copy.pendingCandidates[0], copy.pendingCandidates[0]] }]) {
    response = { ...editor, copy: invalid };
    await assert.rejects(client.readDraftEditor(binding), /invalid editor response/);
  }
});

test('copy candidate, explicit approval and validation accept only their closed command values', async () => {
  const calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (path, body) => {
    calls.push({ path, body }); return { state: 'response', body: { code: 1, data: editor, candidateId: body.action === 'COPY_CANDIDATE' ? 'copy-1' : undefined } };
  } } });
  const candidate = await client.saveDraftEditor({ binding, action: 'COPY_CANDIDATE', operationKey: 'copy-operation-1', value: { titleRu: 'Название', descriptionRu: null } });
  assert.equal(candidate.candidateId, 'copy-1');
  await client.saveDraftEditor({ binding, action: 'COPY_APPROVE', operationKey: 'approve-operation-1', value: { candidateId: 'copy-1' } });
  await client.saveDraftEditor({ binding, action: 'VALIDATE', operationKey: 'validation-operation-1', value: { schemaRevision: 'a'.repeat(64) } });
  for (const [action, value] of [
    ['COPY_CANDIDATE', {}], ['COPY_CANDIDATE', { titleRu: null }], ['COPY_CANDIDATE', { titleRu: 'a'.repeat(501) }],
    ['COPY_CANDIDATE', { descriptionRu: 'a'.repeat(10001) }], ['COPY_CANDIDATE', { titleRu: 'Товар', kind: 'MANUAL' }],
    ['COPY_APPROVE', { candidateId: 'copy-1', reviewed: true }], ['COPY_APPROVE', { candidateId: '' }],
    ['VALIDATE', { schemaRevision: 'old' }], ['VALIDATE', { schemaRevision: 'a'.repeat(64), status: 'VALID' }],
  ]) await assert.rejects(client.saveDraftEditor({ binding, action, operationKey: 'invalid-operation-1', value }), /invalid editor command/);
  assert.equal(calls.length, 3, 'invalid claims never reach the transport');
  const missingId = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async () => ({ state: 'response', body: { code: 1, data: editor } }) } });
  await assert.rejects(missingId.saveDraftEditor({ binding, action: 'COPY_CANDIDATE', operationKey: 'missing-id-operation', value: { titleRu: 'Название' } }), (error) => error.outcome === 'UNKNOWN_OUTCOME');
});

test('packaging commands retain each SKU measurement and reject caller-owned evidence flags', async () => {
  const api = context.SS_ERP_DONOR_WORKBENCH_CONTRACT;
  const value = { items: [{ skuKey: 'sku', weightG: 200, lengthMm: 150, widthMm: 120, heightMm: 90 }], evidence: ['用户确认包装实测值'] };
  const command = { contractVersion: api.CONTRACT_VERSION, type: 'EDITOR_SAVE', requestId: 'packaging-request', listingWorkflowId: 'draft',
    binding, action: 'PACKAGING', operationKey: 'packaging-operation-1', value };
  assert.equal(api.parseFrameCommand(command).action, 'PACKAGING');
  for (const invalidValue of [{ ...value, reviewed: true }, { ...value, items: [{ ...value.items[0], weightG: 0 }] },
    { ...value, items: [{ ...value.items[0], source: 'MANUAL' }] }, { ...value, items: [value.items[0], value.items[0]] }]) {
    assert.throws(() => api.parseFrameCommand({ ...command, value: invalidValue }));
  }
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async () => ({
    state: 'response', body: { code: 1, data: { ...editor, packaging: value.items } },
  }) } });
  assert.deepEqual(JSON.parse(JSON.stringify((await client.saveDraftEditor({ binding, action: 'PACKAGING', operationKey: 'packaging-operation-1', value })).editor.packaging)), value.items);
});

test('SKU selection changes use only current source keys and preserve the original mutation identity', async () => {
  const requests = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (path, body) => {
    requests.push({ path, body }); return { state: 'response', body: { code: 1, replayed: false,
      data: { ...editor, binding: { ...binding, draftRevision: 2, draftVersion: 2 }, selectedSkuKeys: ['sku', 'sku-2'] } } };
  } } });
  const command = { binding, operationKey: 'sku-selection-operation', action: 'SKU_SELECTION', value: { selectedSkuKeys: ['sku', 'sku-2'] } };
  assert.deepEqual(JSON.parse(JSON.stringify((await client.saveDraftEditor(command)).editor.selectedSkuKeys)), ['sku', 'sku-2']);
  assert.equal(context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...command,
    contractVersion: context.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION, type: 'EDITOR_SAVE', requestId: 'select-1', listingWorkflowId: 'draft' }).action, 'SKU_SELECTION');
  for (const value of [{ selectedSkuKeys: [] }, { selectedSkuKeys: ['sku', 'sku'] },
    { selectedSkuKeys: ['sku'], copiedFrom: 'other' }, { selectedSkuKeys: ['a'.repeat(501)] }]) await assert.rejects(client.saveDraftEditor({ ...command, value }));
  assert.equal(requests.length, 1);
});

test('SKU duplication transports only a source key and consumes safe independent offer rows', async () => {
  const rowKey = 'listing-copy:' + 'a'.repeat(64);
  const row = { rowKey, sourceSkuKey: 'sku', offerId: 'copy-offer', pricing: null, packaging: null };
  const data = { ...editor, offerRows: { contractVersion: 'source-listing-offer-rows/v1', rows: [row] } };
  const calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (...args) => {
    calls.push(args); return { state: 'response', body: { code: 1, data } };
  } } });
  const command = { binding, action: 'SKU_DUPLICATE', operationKey: 'copy-operation-1', value: { sourceSkuKey: 'sku' } };
  assert.deepEqual(JSON.parse(JSON.stringify((await client.saveDraftEditor(command)).editor.offerRows)), data.offerRows);
  assert.equal(context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...command, type: 'EDITOR_SAVE',
    contractVersion: context.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION, requestId: 'copy-1', listingWorkflowId: 'draft' }).action, 'SKU_DUPLICATE');
  for (const value of [{ sourceSkuKey: 'sku', rowKey }, { sourceSkuKey: '' }, { sourceSkuKey: 'sku', reviewed: true }]) {
    await assert.rejects(client.saveDraftEditor({ ...command, value }));
  }
  assert.equal(calls.length, 1);
  for (const change of [
    value => { value.rows[0].sourceSkuKey = 'foreign'; },
    value => { value.rows[0].attributes = { secret: 'sentinel' }; },
    value => { value.rows[0].pricing = { apiKey: 'sentinel' }; },
    value => { value.rows[0].pricing = { skuKey: rowKey, price: '-1', oldPrice: '1', currencyCode: 'CNY', vat: '0', offerId: 'copy-offer' }; },
    value => { value.rows[0].pricing = { skuKey: rowKey, price: '1', oldPrice: '1', currencyCode: 'CNY', vat: '0', offerId: { apiKey: 'sentinel' } }; },
    value => { value.rows[0].packaging = { weightG: 0, lengthMm: 1, widthMm: 1, heightMm: 1 }; },
    value => { value.rows.push({ ...value.rows[0] }); },
  ]) {
    const bad = JSON.parse(JSON.stringify(data)); change(bad.offerRows);
    const rejecting = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {},
      post: async () => ({ state: 'response', body: { code: 1, data: bad } }) } });
    await assert.rejects(rejecting.readDraftEditor(binding), /invalid editor/);
  }
});

test('removing a copy submits the exact row identity without deleting its source SKU', async () => {
  const rowKey = 'listing-copy:' + 'b'.repeat(64), calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async (...args) => {
    calls.push(args); return { state: 'response', body: { code: 1, data: editor } };
  } } });
  const command = { binding, action: 'SKU_COPY_REMOVE', operationKey: 'remove-copy-operation', value: { rowKey } };
  await client.saveDraftEditor(command);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1].value)), { rowKey });
  assert.equal(context.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...command, type: 'EDITOR_SAVE',
    contractVersion: context.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION, requestId: 'remove-1', listingWorkflowId: 'draft' }).action, 'SKU_COPY_REMOVE');
  for (const value of [{ rowKey: 'sku' }, { rowKey, sourceSkuKey: 'sku' }]) await assert.rejects(client.saveDraftEditor({ ...command, value }));
  assert.equal(calls.length, 1);
});
