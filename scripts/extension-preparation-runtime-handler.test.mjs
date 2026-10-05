import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const binding={snapshotId:'snapshot',supplyGoodsId:'goods',shopId:'shop',listingWorkflowId:'draft',draftRevision:1,draftVersion:1};
const sender={id:'extension',url:'chrome-extension://extension/pages/precision-workbench.html',origin:'chrome-extension://extension',
  tab:{id:1},frameId:2,documentId:'frame'};
function harness() {
 const env={URL,crypto:webcrypto,Date};
 vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/preparation-runtime-handler.js','utf8'),env);
 let claimed=0, dispatched=0, persisted=0;
 const api=env.SS_ERP_PREPARATION_RUNTIME_HANDLER.createHandler({runtimeId:'extension',
  claimFrame:async()=>{claimed++;return {source:{ownerUserId:'owner',deviceSessionId:'device',sourcePlatform:'1688',sourceProductId:'product'}};},
  assertBinding:async()=>{},getClient:()=>({getReadiness:async()=>({available:true}),analyzeProduct:async()=>{dispatched++;return {analysis:{report:{reviewState:'CANDIDATE'}}};},readProductAnalysis:async()=>({status:'UNKNOWN_OUTCOME'})}),
  getCheckpoint:()=>({read:async()=>null,write:async()=>{persisted++;return {saved:true};},clear:async()=>({cleared:true})})});
 return {api,counters:()=>({claimed,dispatched,persisted})};
}
test('only the registered precision document can call private analysis or checkpoint owners',async()=>{
 const h=harness();
 const payload={binding,skuKey:'sku',sourceMediaKeys:['image'],operationKey:'operation-1',profileId:'profile',analysisModel:'model',categoryRevision:{catalogRevision:'catalog',schemaRevision:'a'.repeat(64)}};
 assert.equal((await h.api.handle({type:'ss-erp:product-analysis-analyze',payload},sender)).ok,true);
 for(const bad of [{...sender,frameId:0},{...sender,url:'https://detail.1688.com/offer/1.html'},{...sender,id:'foreign'}])
   assert.equal((await h.api.handle({type:'ss-erp:product-analysis-analyze',payload},bad)).ok,false);
 assert.equal(h.counters().dispatched,1);
});
test('private read of unknown outcome never dispatches a new analysis',async()=>{
 const h=harness();
 const result=await h.api.handle({type:'ss-erp:product-analysis-read',payload:{binding,operationKey:'operation-1'}},sender);
 assert.equal(result.data.status,'UNKNOWN_OUTCOME');assert.equal(h.counters().dispatched,0);
 const forged=await h.api.handle({type:'ss-erp:preparation-checkpoint-write',payload:{binding,checkpoint:{apiKey:'forged'},ownerUserId:'other'}},sender);
 assert.equal(forged.ok,false);assert.equal(h.counters().persisted,0);
});
test('origin consent tickets are one-use, private-document bound and recheck the exact model policy', async () => {
  const env={URL,crypto:webcrypto,Date};
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/preparation-runtime-handler.js','utf8'),env);
  let policyRevision=3,commits=0;
  const api=env.SS_ERP_PREPARATION_RUNTIME_HANDLER.createHandler({runtimeId:'extension',
    claimFrame:async()=>({source:{ownerUserId:'owner',deviceSessionId:'device',sourcePlatform:'1688',sourceProductId:'product'}}),
    assertBinding:async()=>{},getClient:()=>({getReadiness:async()=>({readiness:{context:{providerOrigin:'https://model.example.com'},
      policyRevision,analysis:{ready:true}}})}),getProfileStore:()=>({getCredentialSnapshotForBackground:async()=>({credentialRevision:'credential-1'})}),
    getPermissionBroker:()=>({captureConsentEpoch:async()=>1,finalizeOriginConsent:async()=>{commits++;return{granted:true};}})});
  const payload={binding,profileId:'profile',skuKey:'sku',analysisModel:'vision-model'};
  const prepared=await api.handle({type:'ss-erp:product-analysis-permission-prepare',payload},sender);
  assert.equal(prepared.data.pattern,'https://model.example.com/*');
  const input={...payload,permissionTicket:prepared.data.permissionTicket};
  assert.equal((await api.handle({type:'ss-erp:product-analysis-permission-commit',payload:input},sender)).ok,true);
  assert.equal((await api.handle({type:'ss-erp:product-analysis-permission-commit',payload:input},sender)).ok,false);
  const second=await api.handle({type:'ss-erp:product-analysis-permission-prepare',payload},sender);policyRevision++;
  assert.equal((await api.handle({type:'ss-erp:product-analysis-permission-commit',payload:{...payload,permissionTicket:second.data.permissionTicket}},sender)).ok,false);
  assert.equal(commits,1);
});
