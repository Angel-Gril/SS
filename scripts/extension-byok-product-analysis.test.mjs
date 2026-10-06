import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const modules = ['profile-schema', 'product-analysis-contract', 'product-analysis-checkpoint', 'product-analysis-client'];
const binding = { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1', listingWorkflowId: 'draft-1', draftRevision: 1, draftVersion: 1 };
const owner = { ownerUserId: 'user-1', deviceSessionId: 'device-1', tabId: 1, frameId: 2, documentId: 'document-1', sourcePlatform: '1688', sourceProductId: 'product-1' };
const category = { categoryId: 10, typeId: 11, catalogRevision: 'catalog-1', schemaRevision: 'schema-1' };
const key = 'unit-test-secret-never-returned';
const clone = (value) => JSON.parse(JSON.stringify(value));
function storage() {
  const values = {};
  return { values, async get(keys) { return Object.fromEntries(keys.filter(k => Object.hasOwn(values, k)).map(k => [k, clone(values[k])])); },
    async set(rows) { Object.assign(values, clone(rows)); }, async remove(keys) { for (const k of keys) delete values[k]; } };
}
function report() {
  return { contractVersion: 'product-preparation-analysis/v1', reviewState: 'CANDIDATE',
    curation: [{ sourceMediaKey: 'media-1', decision: 'KEEP', reason: '产品完整可见' }],
    visualDescription: { composition: '正面', background: '白色', lighting: '柔和', style: '商品', observations: { colors: ['红色'], shapes: [], visibleComponents: [], visibleText: [] } },
    productSummary: { observations: ['红色轮廓'], uncertainties: ['材质不能从图片核实'] },
    skuObservations: [{ skuKey: 'sku-1', observations: ['红色'], titleRu: 'Красный товар' }],
    suggestedAttributes: [{ attributeId: 1, value: 'Красный', dictionaryValueId: 5, evidence: { sourceMediaKeys: ['media-1'], observation: '图片呈红色' }, manualReview: 'REQUIRED' }],
    copy: { titleRu: 'Красный товар', descriptionRu: 'Описание товара', tagsRu: ['красный'] } };
}
function request(overrides = {}) {
  return { binding, skuKey: 'sku-1', sourceMediaKeys: ['media-1'], operationKey: 'analysis-operation-1', profileId: 'profile-1', analysisModel: 'qwen-vl-plus',
    categoryRevision: { catalogRevision: category.catalogRevision, schemaRevision: category.schemaRevision }, ...overrides };
}
function fixture({ sessionStorage = storage(), fetchImpl, readiness, context, permission = true, onAssert, timeoutMs = 1000 } = {}) {
  const globals = { Array, ArrayBuffer, Blob, Boolean, Date, Error, JSON, Map, Math, Number, Object, Promise, Set, String, TextEncoder, TextDecoder, Uint8Array, URL,
    AbortController, Response, ReadableStream, btoa, crypto: webcrypto, setTimeout, clearTimeout };
  globals.globalThis = globals;
  for (const name of modules) vm.runInNewContext(readFileSync(`extensions/ss-erp/shared/byok/${name}.js`, 'utf8'), globals, { filename: name });
  const profile = { id: 'profile-1', name: 'Images and analysis', baseUrl: 'https://provider.example/compatible-mode/v1', model: 'image-model', allowedOperations: ['TEXT_TO_IMAGE'], preferences: { defaultSize: '1024x1024', quality: 'auto', outputFormat: 'png' } };
  const calls = [];
  let currentRevision = 'credential-1';
  const profileStore = { async getCredentialSnapshotForBackground() { return { profile, apiKey: key, credentialRevision: currentRevision }; },
    async assertCredentialRevisionForBackground(id, identity, revision) { if (revision !== currentRevision) throw new Error('credential changed'); },
    async commitWithCredentialRevisionForBackground(id, identity, revision, fn) { if (revision !== currentRevision) throw new Error('credential changed'); return fn(); } };
  const options = { sessionStorage, crypto: webcrypto, profileStore, timeoutMs,
    permissionBroker: { async hasOriginPermission() { return { granted: permission, origin: 'https://provider.example' }; }, async commitWithOriginPermission(origin, fn) { if (!permission) throw new Error('permission changed'); return fn(); } },
    sourceLibrary: { async readForBackground(ctx, mediaKey, purpose) { calls.push(['source', mediaKey, purpose, ctx]); const bytes = new Uint8Array([137,80,78,71,13,10,26,10]); return { blob: new Blob([bytes], {type:'image/png'}), mimeType:'image/png', width:64, height:64, byteLength:8, sha256: Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex') }; } },
    async getPreparationContext(input) { calls.push(['context', input]); return context || { binding, skuKey: input.skuKey, sourceMediaKeys: input.sourceMediaKeys,
      promptContext: { product: { title:'红色商品', description:'' }, sku: { skuKey:'sku-1', options:[] }, category,
        fields:[{ attributeId:1,name:'Цвет',description:'',valueType:'string',cardinality:'SINGLE',valuePolicy:'DICTIONARY_ONLY',aiSuggestionAllowed:true }], dictionaries: {'1':[{id:5,value:'Красный'}]}, sourceMediaKeys:input.sourceMediaKeys } }; },
    async getReadiness(input) { calls.push(['readiness', input]); return readiness || { contractVersion:'extension-byok-product-analysis-readiness/v1', context: { ownerUserId:owner.ownerUserId,deviceSessionId:owner.deviceSessionId,shopId:binding.shopId,providerOrigin:'https://provider.example',model:input.model }, policyRevision:1,mode:'pilot',maxConcurrency:1, analysis:{enabled:true,ready:true,reasonCode:'READY'} }; },
    async assertCurrent(input) { calls.push(['authority',input]); await onAssert?.(input); },
    async persistCandidate(value) { calls.push(['persist',value]);return {...value.analysisInput,report:value.report,replayed:false,receiptId:'server-receipt-1',category}; },
    async readCandidate(input) { calls.push(['read',input]);return null; },
    providerSemaphore: { async tryAcquire() { return { release() {} }; } },
    async fetchImpl(url, init) { calls.push(['provider', url, init]); return fetchImpl ? fetchImpl(url,init) : new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report())}}]}), {status:200,headers:{'content-type':'application/json'}}); } };
  const client = globals.SS_ERP_BYOK_PRODUCT_ANALYSIS_CLIENT.createClient(options);
  return { client, calls, globals, sessionStorage, profile, options, changeCredential() { currentRevision = 'credential-2'; } };
}
test('analysis uses an explicit model, exact policy, owned media bytes and returns candidate-only report', async () => {
  const f = fixture(); const result = await f.client.analyzeProduct(request(), owner);
  assert.equal(result.analysis.report.reviewState,'CANDIDATE'); assert.equal(result.analysis.mode,'BYOK'); assert.equal(result.analysis.status,'SUCCEEDED');
  assert.deepEqual(clone(result.analysis.category), category);
  const sent=f.calls.find(c=>c[0]==='provider'); assert.equal(sent[1], 'https://provider.example/compatible-mode/v1/chat/completions');
  const body=JSON.parse(sent[2].body); assert.equal(body.model,'qwen-vl-plus'); assert.notEqual(body.model,f.profile.model);
  assert.equal(sent[2].redirect,'error'); assert.equal(sent[2].credentials,'omit'); assert.equal(sent[2].headers.Authorization,`Bearer ${key}`);
  assert.equal(f.calls.find(c=>c[0]==='source')[2],'THUMBNAIL');
  const imageAuthority=f.calls.find(c=>c[0]==='source')[3];
  assert.deepEqual(clone(imageAuthority.categoryRevision),request().categoryRevision);
  assert.deepEqual(clone(imageAuthority.providerContext),{providerOrigin:'https://provider.example',model:'qwen-vl-plus',policyRevision:1});
  assert.equal(JSON.stringify(imageAuthority).includes(key),false);
  assert.equal(JSON.stringify(result).includes(key),false); assert.equal(JSON.stringify(f.sessionStorage.values).includes(key),false);
});
test('same operation is coalesced and exact success replays without another Provider POST after Worker restart',async()=>{
  const f=fixture(); const [a,b]=await Promise.all([f.client.analyzeProduct(request(),owner),f.client.analyzeProduct(request(),owner)]);
  assert.equal(a.analysis.receiptId,b.analysis.receiptId); assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);
  const restarted=fixture({sessionStorage:f.sessionStorage}); const c=await restarted.client.analyzeProduct(request(),owner);
  assert.equal(c.analysis.replayed,true); assert.equal(c.analysis.receiptId,a.analysis.receiptId); assert.equal(restarted.calls.filter(c=>c[0]==='provider').length,0);
  await assert.rejects(restarted.client.analyzeProduct(request({analysisModel:'other-model'}),owner),e=>e.code==='SS_ERP_BYOK_PRODUCT_ANALYSIS_IDEMPOTENCY_CONFLICT');
});
test('unknown POST persists, blocks new operation keys including after reload, and read never resubmits',async()=>{
  const f=fixture({fetchImpl:async()=>{throw new Error(`Provider network error ${key}`);}});
  await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='UNKNOWN_OUTCOME'&&!e.message.includes(key));
  const restarted=fixture({sessionStorage:f.sessionStorage}); const reloaded={...owner,documentId:'document-2'};
  await assert.rejects(restarted.client.analyzeProduct(request({operationKey:'analysis-operation-2'}),reloaded),e=>e.outcome==='UNKNOWN_OUTCOME');
  await assert.rejects(restarted.client.analyzeProduct(request({operationKey:'analysis-operation-3',binding:{...binding,draftRevision:2,draftVersion:2}}),reloaded),e=>e.outcome==='UNKNOWN_OUTCOME');
  const original=await restarted.client.readProductAnalysis({binding,operationKey:request().operationKey},reloaded);
  assert.equal(original.status,'UNKNOWN_OUTCOME'); assert.equal(original.automaticRetryAllowed,false);
  assert.equal(restarted.calls.filter(c=>c[0]==='provider').length,0);
});
test('image permission cannot substitute for explicit analysis policy, model or origin consent',async()=>{
  for(const options of [{permission:false},{readiness:{contractVersion:'extension-byok-readiness/v1',capabilities:{generation:{ready:true}}}},
    {readiness:{contractVersion:'extension-byok-product-analysis-readiness/v1',analysis:{ready:false,enabled:false,reasonCode:'ANALYSIS_DISABLED'}}}]) {
    const f=fixture(options); await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='NOT_SUBMITTED');
    assert.equal(f.calls.filter(c=>c[0]==='provider').length,0);
  }
});
test('rejects unowned source keys, stale official schema, raw media URLs and secret request fields before POST',async()=>{
  for(const input of [request({sourceMediaKeys:['https://evil.example/a.png']}),request({apiKey:key}),request({categoryRevision:{catalogRevision:'old',schemaRevision:'old'}})]) {
    const f=fixture(); await assert.rejects(f.client.analyzeProduct(input,owner),e=>e.outcome==='NOT_SUBMITTED');
    assert.equal(f.calls.filter(c=>c[0]==='provider').length,0);
  }
  const f=fixture({context:{binding,skuKey:'sku-1',sourceMediaKeys:['other-media'],promptContext:{}}});
  await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='NOT_SUBMITTED');
});
test('revoked credential or source authority rejects late results without exposing Provider bodies',async()=>{
  let f; f=fixture({fetchImpl:async()=>{f.changeCredential();return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(report())}}]}));}});
  await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='UNKNOWN_OUTCOME');
  assert.equal(JSON.stringify(await f.client.readProductAnalysis({binding,operationKey:request().operationKey},owner)).includes('report'),false);
});
test('a lost candidate-ingest response recovers only the original server receipt and never repeats Provider or ingest POST',async()=>{
  const f=fixture();let original;
  f.options.persistCandidate=async value=>{f.calls.push(['persist',value]);original=value;throw new Error('response lost after server accepted');};
  await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='UNKNOWN_OUTCOME');
  const restarted=fixture({sessionStorage:f.sessionStorage});
  restarted.options.readCandidate=async input=>{restarted.calls.push(['read',input]);assert.deepEqual(clone(input),clone(original.analysisInput));
    return {...input,report:original.report,replayed:true,category,receiptId:'server-recovered-1'};};
  const recovered=await restarted.client.readProductAnalysis({binding,operationKey:request().operationKey},owner);
  assert.equal(recovered.analysis.status,'SUCCEEDED');assert.equal(recovered.analysis.receiptId,'server-recovered-1');
  assert.equal(restarted.calls.some(c=>['provider','persist'].includes(c[0])),false);
  assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);
});
test('hostile report extra fields, fabricated fact attributes, other SKU and echoed secrets are not returned',async()=>{
  const hostile = [ {...report(),apiKey:key}, {...report(),copy:{...report().copy,titleRu:key}}, {...report(),suggestedAttributes:[{...report().suggestedAttributes[0],attributeId:99}]},
    {...report(),skuObservations:[{...report().skuObservations[0],skuKey:'sku-other'}]} ];
  for(const output of hostile){const f=fixture({fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}))});
    await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='UNKNOWN_OUTCOME'&&!e.message.includes(key));
    assert.equal(JSON.stringify(f.sessionStorage.values).includes(key),false);}
});
test('timeout is UNKNOWN_OUTCOME and oversized/malformed responses cannot trigger retries',async()=>{
  const timeout=fixture({timeoutMs:15,fetchImpl:()=>new Promise(()=>{})});
  await assert.rejects(timeout.client.analyzeProduct(request(),owner),e=>e.outcome==='UNKNOWN_OUTCOME');
  for(const response of [new Response('invalid json'), new Response('{}',{headers:{'content-length':String(256*1024+1)}})]){
    const f=fixture({fetchImpl:async()=>response}); await assert.rejects(f.client.analyzeProduct(request(),owner),e=>e.outcome==='UNKNOWN_OUTCOME');
    assert.equal(f.calls.filter(c=>c[0]==='provider').length,1);}
});
test('checkpoint is bound to current frame, source, device and exact draft; secrets and oversized state rejected',async()=>{
  const f=fixture();const checkpoint=f.globals.SS_ERP_BYOK_PRODUCT_ANALYSIS_CHECKPOINT.createStore({sessionStorage:f.sessionStorage});
  const state={version:1,context:{binding,skuKey:'sku-1',sourceMediaKeys:['media-1'],categoryRevision:request().categoryRevision,mode:'BYOK',analysisModel:'qwen-vl-plus',profileId:'profile-1'},
    operation:null,analysisInput:null,receipt:null,draft:null,review:{curationConfirmed:false,visualApplied:false,copySaved:false,attributesApplied:false}};
  await checkpoint.write({binding,owner,checkpoint:state});assert.deepEqual(clone(await checkpoint.read({binding,owner})),state);
  assert.deepEqual(clone(await checkpoint.read({binding,owner:{...owner,documentId:'other-document'}})),state);
  assert.deepEqual(clone(await checkpoint.read({binding:{...binding,draftVersion:2},owner})),state);
  assert.equal(await checkpoint.read({binding,owner:{...owner,tabId:2}}),null);
  assert.equal(await checkpoint.read({binding:{...binding,snapshotId:'other-snapshot'},owner}),null);
  const edited={...state,selections:{curationMediaKeys:['media-1'],visualDescription:report().visualDescription}};
  await checkpoint.write({binding,owner,checkpoint:edited});
  assert.deepEqual(clone(await checkpoint.read({binding,owner:{...owner,documentId:'document-after-reload'}})),edited);
  for(const invalidSelections of [{curationMediaKeys:['foreign-media'],visualDescription:null},
    {curationMediaKeys:['https://evil.example/image.png'],visualDescription:null},
    {curationMediaKeys:['media-1'],visualDescription:{...report().visualDescription,apiKey:key}},
    {curationMediaKeys:['media-1'],visualDescription:{...report().visualDescription,background:'https://evil.example'}}]) {
    await assert.rejects(checkpoint.write({binding,owner,checkpoint:{...state,selections:invalidSelections}}));
  }
  await assert.rejects(checkpoint.write({binding,owner,checkpoint:{...state,apiKey:key}}));
  await assert.rejects(checkpoint.write({binding,owner,checkpoint:{...state,draft:{titleRu:'x'.repeat(300000),descriptionRu:'',tagsRu:[]}}}));
  await checkpoint.clear({binding,owner});assert.equal(await checkpoint.read({binding,owner}),null);
});
test('hosted stage checkpoints retain completed results and unknown operation across reload without accepting foreign roots',async()=>{
  const f=fixture(),store=f.globals.SS_ERP_BYOK_PRODUCT_ANALYSIS_CHECKPOINT.createStore({sessionStorage:f.sessionStorage});
  const categoryRevision={catalogRevision:'catalog-1',schemaRevision:'a'.repeat(64)};
  const context={binding,skuKey:'sku-1',sourceMediaKeys:['media-1'],categoryRevision,mode:'ERP_HOSTED',stagedAnalysis:true};
  const operation={binding,skuKey:'sku-1',sourceMediaKeys:['media-1'],categoryRevision,operationKey:'staged-analysis-1',stage:'VISION'};
  const curation={binding,skuKey:'sku-1',sourceMediaKeys:['media-1'],category:{categoryId:10,typeId:11,...categoryRevision},
    operationKey:operation.operationKey,stage:'CURATION',curation:report().curation,replayed:false};
  const state={version:1,context,operation,analysisInput:null,receipt:null,draft:null,application:null,
    review:{curationConfirmed:false,visualApplied:false,copySaved:false,attributesApplied:false},selections:{curationMediaKeys:null,visualDescription:null},
    rootOperationKey:operation.operationKey,stage:'VISION',stageResults:{CURATION:curation},stageStartedAt:1000,
    failure:{stage:'VISION',code:'product_vision_timeout'},manuallyContinued:true};
  await store.write({binding,owner,checkpoint:state});
  assert.deepEqual(clone(await store.read({binding,owner:{...owner,documentId:'reloaded'}})),state);
  for(const corrupt of [value=>{value.stageResults.CURATION.binding.shopId='other';},value=>{value.rootOperationKey='other-operation';},
    value=>{value.stageResults.CURATION.sourceMediaKeys=['unowned'];},value=>{value.context.mode='BYOK';},
    value=>{value.stageResults.VISION={...value.stageResults.CURATION,stage:'VISION',apiKey:key};}]){
    const invalid=clone(state);corrupt(invalid);await assert.rejects(store.write({binding,owner,checkpoint:invalid}));
  }
});
