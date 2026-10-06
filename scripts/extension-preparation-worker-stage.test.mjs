import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { test } from 'node:test';

const root='extensions/ss-erp',path=root+'/background/service-worker.js';
const binding={snapshotId:'snapshot',supplyGoodsId:'goods',shopId:'shop',listingWorkflowId:'draft',draftRevision:1,draftVersion:1};
const input={binding,skuKey:'sku',sourceMediaKeys:['image-1'],operationKey:'stage-root-operation',stage:'CURATION',
  categoryRevision:{catalogRevision:'catalog',schemaRevision:'a'.repeat(64)}};
function harness({failure=false}={}) {
  const calls=[],env={URL};vm.createContext(env);
  vm.runInContext(readFileSync(root+'/shared/donor-workbench/product-preparation-client.js','utf8'),env);
  const actualClient=env.SS_ERP_PRODUCT_PREPARATION_CLIENT.createClient({transport:{post:async(path,request)=>{
    calls.push({path,request});
    if(failure)return{state:'response',status:409,body:{code:0,msg:'原分析结果未确认',outcome:'UNKNOWN_OUTCOME',
      stage:'CURATION',failureCode:'product_vision_timeout',failureKind:'TRANSPORT_UNKNOWN'}};
    const {categoryRevision,...receipt}=request;
    return{state:'response',body:{code:1,data:{...receipt,category:{categoryId:1,typeId:2,...categoryRevision},
      curation:request.sourceMediaKeys.map(sourceMediaKey=>({sourceMediaKey,decision:'KEEP',reason:'展示商品'})),replayed:false}}};
  }}});
  Object.assign(env,{sourceWorkflowPlatform:value=>value,sourceWorkflowHandoffText:value=>value,
    readPersistedSourceWorkflowHandoff:async()=>({snapshotId:binding.snapshotId,supplyGoodsId:binding.supplyGoodsId}),
    getSourceListingWorkflowClient:()=>({...actualClient,getStatus:async()=>({state:'ready'})}),
    currentSourceListingContext:()=>({shopId:binding.shopId,listingWorkflowId:binding.listingWorkflowId})});
  const source=process.argv.includes('--baseline')?execFileSync('git',['show','HEAD:'+path],{encoding:'utf8'}):readFileSync(path,'utf8');
  const start=source.indexOf("  if (['ss-erp:source-listing-workbench-editor-read'");
  const end=source.indexOf("\n  if (message.type === 'ss-erp:source-listing-workbench-publish')",start);
  assert.ok(start>=0&&end>start);
  vm.runInContext('globalThis.dispatch=function(message,sendResponse){'+source.slice(start,end)+'}',env);
  return{calls,dispatch:message=>new Promise(resolve=>env.dispatch(message,resolve))};
}
test('real Worker branch and real client preserve the stage through the device POST and read',async()=>{
  const h=harness();
  for(const action of ['analyze','read']){
    const response=await h.dispatch({type:'ss-erp:source-workbench-preparation-'+action,platform:'1688',sourceProductId:'123',
      listingWorkflowId:'draft',...input});
    assert.equal(response.ok,true);assert.equal(response.result.analysis.stage,'CURATION');
  }
  assert.deepEqual(h.calls.map(call=>call.request.stage),['CURATION','CURATION']);
  assert.deepEqual(h.calls.map(call=>call.path.split('/').at(-1)),['analyze','read']);
});
test('Worker keeps safe unknown classification rather than discarding server diagnostics',async()=>{
  const h=harness({failure:true});
  const response=await h.dispatch({type:'ss-erp:source-workbench-preparation-analyze',platform:'1688',sourceProductId:'123',
    listingWorkflowId:'draft',...input});
  assert.equal(response.ok,false);assert.equal(response.outcome,'UNKNOWN_OUTCOME');
  assert.equal(response.failureCode,'product_vision_timeout');assert.equal(response.failureKind,'TRANSPORT_UNKNOWN');
  assert.equal(h.calls.length,1);
});
