import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function modules() {
  const context={URL,Array,Boolean,Date,Error,Map,Math,Number,Object,Promise,Set,String};context.globalThis=context;
  for(const file of ['erp-adapter/erp-source-image-launch.js','byok/workbench-launch-session.js','erp-adapter/source-media-editor-session.js']){
    vm.runInNewContext(readFileSync('extensions/ss-erp/shared/'+file,'utf8'),context,{filename:file});
  }
  return context;
}
const authority={provenance:'ERP_SOURCE',ownerUserId:'owner-a',deviceSessionId:'device-a',apiOrigin:'https://ss-erp.com',webOrigin:'https://app.ss-erp.com',grantSha256:'b'.repeat(64)};
const launch={contractVersion:'extension-byok-workbench-launch-context/v1',sourcePlatform:'1688',sourceProductId:'fixed-qa-cup',sourceCaptureSnapshotId:'snapshot-a',supplyGoodsId:'goods-a',shopId:'shop-a',workflowId:'draft-a',draftRevision:7,draftVersion:3,skuKey:'__ss_erp_product_only__',slotKey:'sku:__ss_erp_product_only__:hero',assignmentMode:'APPEND',assignmentOrdinal:0};
test('ERP_SOURCE proof survives the ordinary MV3 workbench session restart without a marketplace handoff',async()=>{
  const context=modules(),values={};const storage={async get(keys){return Object.fromEntries(keys.filter(k=>Object.hasOwn(values,k)).map(k=>[k,values[k]]));},async set(patch){Object.assign(values,JSON.parse(JSON.stringify(patch)));},async remove(keys){for(const k of keys)delete values[k];}};
  const options={sessionStorage:storage,tabs:{async create(){return{id:17};},async update(id){return{id};},async remove(){}},runtime:{getURL:path=>'chrome-extension://runtime-id/'+path},now:()=>Date.parse('2026-09-16T12:00:00.000Z'),verifyErpSourceAuthority:async()=>true};
  const manager=context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION.createManager(options);
  await manager.open({context:launch,sourceTabId:9,sourceDocumentId:'erp-document',erpSourceAuthority:authority});
  const resumed=context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION.createManager(options);
  const session=await resumed.claim({tabId:17,documentId:'workbench-document',frameId:0});
  assert.deepEqual(JSON.parse(JSON.stringify(session.erpSourceAuthority)),authority);
  assert.equal(session.sourceDocumentId,'erp-document');
  assert.equal(Object.keys(values).some(key=>key.includes('source-workflow:handoff')),false);
  await assert.rejects(manager.open({context:launch,sourceTabId:9,sourceDocumentId:'erp-document',erpSourceAuthority:{...authority,provenance:'native_v2'}}));
});
test('same-owner re-pairing cannot reuse the previous ERP session and cleanup cannot deadlock the claim',async()=>{
  const context=modules(),values={};let liveDevice='device-a';let manager;
  const storage={async get(keys){return Object.fromEntries(keys.filter(k=>Object.hasOwn(values,k)).map(k=>[k,values[k]]));},async set(patch){Object.assign(values,JSON.parse(JSON.stringify(patch)));},async remove(keys){for(const k of keys)delete values[k];}};
  const options={sessionStorage:storage,tabs:{async create(){return{id:17};},async update(id){return{id};},async remove(){}},runtime:{getURL:path=>'chrome-extension://runtime-id/'+path},now:()=>Date.parse('2026-09-16T12:00:00.000Z'),
    verifyErpSourceAuthority:async value=>{
      if(value.deviceSessionId===liveDevice)return true;
      await manager.clearProviderState();
      return false;
    },
  };
  manager=context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION.createManager(options);
  await manager.open({context:launch,sourceTabId:9,sourceDocumentId:'erp-document',erpSourceAuthority:authority});
  await manager.claim({tabId:17,documentId:'workbench-document',frameId:0});
  liveDevice='device-b';
  const result=await Promise.race([
    manager.claim({tabId:17,documentId:'workbench-document',frameId:0}).then(()=> 'ALLOWED',error=>error.code),
    new Promise(resolve=>setTimeout(()=>resolve('DEADLOCK'),200)),
  ]);
  assert.equal(result,'SS_ERP_BYOK_WORKBENCH_SESSION_AUTHORITY_STALE');
  const unconfigured=context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION.createManager({...options,verifyErpSourceAuthority:undefined});
  await assert.rejects(unconfigured.open({context:launch,sourceTabId:9,sourceDocumentId:'erp-document',erpSourceAuthority:authority}));
});
test('ordinary editor sessions retain only valid ERP_SOURCE authority and keep native legacy sessions readable',()=>{
  const context=modules(),api=context.SS_ERP_SOURCE_MEDIA_EDITOR_SESSION;
  const now=Date.parse('2026-09-16T12:00:00.000Z');
  const session={nonce:'a'.repeat(64),platform:'1688',sourceProductId:'fixed-qa-cup',snapshotId:'snapshot-a',supplyGoodsId:'goods-a',shopId:'shop-a',listingWorkflowId:'draft-a',revision:7,draftVersion:3,operation:'FULL_EDIT',sourceMediaKeys:['white-cup'],preparedSource:null,sourceTabId:9,editorTabId:18,editorDocumentId:null,maskCheckpoint:null,completion:null,createdAt:now,expiresAt:now+60000,submitLeaseExpiresAt:null,completedAt:null};
  const options={now,maximumLifetimeMs:120000,maximumSubmitLeaseMs:60000};
  assert.ok(api.normalizeSession(session,options));
  const result=api.normalizeSession({...session,erpSourceAuthority:authority},options);
  assert.ok(result);assert.deepEqual(JSON.parse(JSON.stringify(result.erpSourceAuthority)),authority);
  assert.equal(api.normalizeSession({...session,erpSourceAuthority:{...authority,launchToken:'secret'}},options),null);
  assert.equal(api.normalizeSession({...session,erpSourceAuthority:{...authority,provenance:'native_v2'}},options),null);
});
