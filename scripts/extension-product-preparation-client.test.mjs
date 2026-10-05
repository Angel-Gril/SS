import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
function load() {
  const env = { URL, URLSearchParams, TextEncoder };
  for (const file of ['shared/donor-workbench/product-preparation-client.js',
    'shared/erp-adapter/listing-workflow-client.js', 'shared/donor-workbench/workspace-contract.js',
    'shared/message-security/runtime-message-policy.js']) {
    vm.runInNewContext(readFileSync('extensions/ss-erp/' + file, 'utf8'), env);
  }
  return env;
}
const binding = { snapshotId:'snapshot', supplyGoodsId:'goods', shopId:'shop', listingWorkflowId:'draft', draftRevision:1, draftVersion:1 };
const request = { binding, skuKey:'sku', sourceMediaKeys:['image-1'], operationKey:'prepare-operation-1',
  categoryRevision:{catalogRevision:'catalog-1',schemaRevision:'a'.repeat(64)} };
const analysis = { ...request, category:{categoryId:1,typeId:2,...request.categoryRevision}, report:{
  contractVersion:'product-preparation-analysis/v1',reviewState:'CANDIDATE',
  curation:[{sourceMediaKey:'image-1',decision:'KEEP',reason:'可见主体清晰'}],
  visualDescription:{composition:'居中',background:'白色',lighting:'柔和',style:'实拍',observations:{colors:[],shapes:[],visibleComponents:[],visibleText:[]}},
  productSummary:{observations:['主体可见'],uncertainties:[]},skuObservations:[{skuKey:'sku',observations:['白色'],titleRu:'Товар'}],
  suggestedAttributes:[],copy:{titleRu:'Товар',descriptionRu:'Белый товар.',tagsRu:['#товар']},
},replayed:false };
delete analysis.categoryRevision;
test('analysis keeps the original bound candidate, and recovery uses only the read owner', async () => {
  const env=load(),calls=[];
  const client=env.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({transport:{get:async()=>{},post:async(path,body,options)=>{
    calls.push({path,body,options});return {state:'response',body:{code:1,data:structuredClone(analysis)}};
  }}});
  assert.equal((await client.analyzeProductPreparation(request)).analysis.report.reviewState,'CANDIDATE');
  await client.readProductPreparation(request);
  assert.deepEqual(calls.map(c=>c.path), ['/api/extension-device/source-workbench/preparation/analyze',
    '/api/extension-device/source-workbench/preparation/read']);
  assert.equal(calls[0].options.requiredScope,'media:execute');
  assert.equal(calls[1].options.requiredScope,'listing:review');
  assert.equal(calls.length,2);
});
test('candidate responses cannot inject secrets, foreign media, SKU or confirmed facts', async () => {
  for(const corrupt of [a=>{a.report.apiKey='secret';},a=>{a.report.curation[0].sourceMediaKey='foreign';},
    a=>{a.report.skuObservations[0].skuKey='other';},a=>{a.report.reviewState='APPROVED';},
    a=>{a.report.verifiedFacts={material:'steel'};}]) {
    const env=load();let count=0;
    const client=env.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({transport:{get:async()=>{},post:async()=>{
      count++;const data=structuredClone(analysis);corrupt(data);return {state:'response',body:{code:1,data}};
    }}});
    await assert.rejects(client.analyzeProductPreparation(request),e=>e.outcome==='UNKNOWN_OUTCOME');
    assert.equal(count,1);
  }
});
test('official attribute multi-values and the exact application receipt stay bound to the current draft', async () => {
  const env = load();
  const accepted = structuredClone(analysis);
  accepted.report.suggestedAttributes = [{ attributeId: 1, value: [1, true], manualReview: 'REQUIRED',
    evidence: { sourceMediaKeys: ['image-1'], observation: '可见形状' } }];
  let applied = { binding: { ...binding, draftRevision: 2, draftVersion: 2 }, selectedAttributeIds: [1], replayed: false };
  const client = env.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => {}, post: async path => ({
    state: 'response', body: { code: 1, data: path.endsWith('apply') ? applied : accepted } }) } });
  await client.analyzeProductPreparation(request);
  const apply = { binding, analysisInput: request, operationKey: 'apply-operation-1', action: 'ATTRIBUTES', selectedAttributeIds: [1] };
  assert.equal((await client.applyProductPreparation(apply)).binding.draftRevision, 2);
  applied = { ...applied, binding: { ...applied.binding, shopId: 'foreign' } };
  await assert.rejects(client.applyProductPreparation(apply), e => e.outcome === 'UNKNOWN_OUTCOME');
});
test('analysis requests reject URLs and duplicate references before network, frame calls remain closed', async () => {
  const env=load();let calls=0;
  const client=env.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({transport:{get:async()=>{},post:async()=>{calls++;}}});
  for(const extra of [{apiKey:'forged'},{sourceMediaKeys:['http://127.0.0.1/image']},{sourceMediaKeys:['image-1','image-1']}])
    await assert.rejects(client.analyzeProductPreparation({...request,...extra}));
  assert.equal(calls,0);
  const frame={...request,type:'PREPARATION_ANALYZE',listingWorkflowId:'draft',requestId:'request-1',contractVersion:env.SS_ERP_DONOR_WORKBENCH_CONTRACT.CONTRACT_VERSION};
  assert.equal(env.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand(frame).type,'PREPARATION_ANALYZE');
  assert.throws(()=>env.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({...frame,url:'https://other.test'}));
});
test('hosted preparation commands require the exact source product main document', () => {
  const env=load(),id='abcdefghijklmnopabcdefghijklmnop';
  const sender={id,frameId:0,documentId:'source-doc',url:'https://detail.1688.com/offer/1.html',tab:{id:1,url:'https://detail.1688.com/offer/1.html'}};
  for(const action of ['capability','context','analyze','read','apply']) {
    const type='ss-erp:source-workbench-preparation-'+action;
    assert.equal(env.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type,sender,id),true);
    assert.equal(env.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type,{...sender,frameId:2},id),false);
  }
});
