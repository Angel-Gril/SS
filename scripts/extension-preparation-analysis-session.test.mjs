import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const moduleSource = () => readFileSync('extensions/ss-erp/pages/donor/preparation-analysis-session.js', 'utf8');
const load = async () => import('data:text/javascript;base64,' + Buffer.from(moduleSource()).toString('base64'));
const binding = {snapshotId:'snapshot',supplyGoodsId:'goods',shopId:'shop',listingWorkflowId:'workflow',draftRevision:1,draftVersion:1};
const basis = () => ({binding:{...binding},skuKey:'sku',sourceMediaKeys:['image-1','image-2'],categoryRevision:{catalogRevision:'a'.repeat(64),schemaRevision:'b'.repeat(64)},mode:'ERP_HOSTED',analysisModel:'qwen-vl-plus'});
function report(input) {return {binding:input.binding,skuKey:input.skuKey,sourceMediaKeys:input.sourceMediaKeys,operationKey:input.operationKey,
  category:{categoryId:1,typeId:2,...input.categoryRevision},report:{contractVersion:'product-preparation-analysis/v1',reviewState:'CANDIDATE',
  curation:input.sourceMediaKeys.map(sourceMediaKey=>({sourceMediaKey,decision:'KEEP',reason:'展示商品'})),
  visualDescription:{composition:'居中',background:'白色',lighting:'柔光',style:'写实',observations:[]},
  productSummary:{observations:['图片中是盒子'],uncertainties:['材质需要确认']},skuObservations:[{skuKey:input.skuKey,observations:[],titleRu:'Коробка'}],
  suggestedAttributes:[],copy:{titleRu:'Коробка',descriptionRu:'Прозрачная коробка',tagsRu:['коробка']}}};}
test('one analysis receipt feeds all candidate stages and resume never resends the model call',async()=>{
  const {createPreparationAnalysisSession}=await load(); let posts=0,checkpoint=null;
  const session=createPreparationAnalysisSession({getContext:basis,createOperationKey:()=> 'operation',
    analyze:async input=>{posts++;return report(input);},read:async()=>null,
    persist:async value=>{checkpoint=value;}});
  await session.analyze();assert.equal(posts,1);assert.equal(session.state().status,'REVIEW_REQUIRED');
  const restored=createPreparationAnalysisSession({getContext:basis,analyze:async()=>{posts++;},read:async()=>null,persist:async()=>{}});
  assert.equal(restored.restore(checkpoint),true);await restored.analyze();assert.equal(posts,1);
  assert.equal(restored.state().receipt.report.copy.titleRu,'Коробка');
});
test('unknown model response persists original request before dispatch and read only recovers it',async()=>{
  const {createPreparationAnalysisSession}=await load(); let posts=0,reads=0,stored;
  const session=createPreparationAnalysisSession({getContext:basis,createOperationKey:()=> 'operation',
    persist:async value=>{stored=structuredClone(value);},
    analyze:async()=>{assert.equal(stored.operation.operationKey,'operation');posts++;throw Object.assign(Error('timeout'),{outcome:'UNKNOWN_OUTCOME'});},
    read:async input=>{reads++;return report(input);}});
  await assert.rejects(session.analyze(),/timeout/);await assert.rejects(session.analyze(),/核对/);
  await session.recover();assert.equal(posts,1);assert.equal(reads,1);assert.equal(session.state().status,'REVIEW_REQUIRED');
});
test('foreign receipts and changed source or category never apply and checkpoints cannot cross drafts',async()=>{
  const {createPreparationAnalysisSession}=await load();let current=basis();
  const session=createPreparationAnalysisSession({getContext:()=>current,createOperationKey:()=> 'operation',persist:async()=>{},
    analyze:async input=>({...report(input),binding:{...input.binding,shopId:'foreign'}}),read:async()=>null});
  await assert.rejects(session.analyze(),/回执/);assert.equal(session.state().status,'RECOVERY_REQUIRED');
  const saved=session.checkpoint();current={...current,binding:{...current.binding,shopId:'other'}};
  assert.equal(session.restore(saved),false);assert.equal(session.current(),false);
});
test('confirmed local selection and editable candidates survive own draft revision advance but not category changes',async()=>{
  const {createPreparationAnalysisSession}=await load();let current=basis();
  const session=createPreparationAnalysisSession({getContext:()=>current,createOperationKey:()=> 'operation',persist:async()=>{},analyze:async input=>report(input),read:async()=>null});
  await session.analyze();await session.updateDraft({titleRu:'Мой заголовок',descriptionRu:'Описание',tagsRu:['тест']});
  await session.markReviewed('curationConfirmed');current={...current,binding:{...current.binding,draftRevision:2,draftVersion:2}};
  assert.equal(session.current(),true);assert.equal(session.state().draft.titleRu,'Мой заголовок');
  current={...current,categoryRevision:{...current.categoryRevision,schemaRevision:'c'.repeat(64)}};assert.equal(session.current(),false);
});
test('checkpoint failure prevents dispatch and unresolved reads never start a second paid request',async()=>{
  const {createPreparationAnalysisSession}=await load();let posts=0;
  const session=createPreparationAnalysisSession({getContext:basis,createOperationKey:()=> 'operation',persist:async()=>{throw Error('storage failed');},
    analyze:async()=>{posts++;},read:async()=>null});
  await assert.rejects(session.analyze(),/storage/);assert.equal(posts,0);
  const unknown=createPreparationAnalysisSession({getContext:basis,createOperationKey:()=> 'operation',persist:async()=>{},
    analyze:async()=>{posts++;throw Error('network');},read:async()=>null});
  await assert.rejects(unknown.analyze());await unknown.recover();await assert.rejects(unknown.analyze(),/核对/);assert.equal(posts,1);
});
test('unknown candidate save resumes the exact application after reload without starting another model call',async()=>{
  const {createPreparationAnalysisSession}=await load();let current=basis(),checkpoint,models=0;
  const create=()=>createPreparationAnalysisSession({getContext:()=>current,createOperationKey:()=> 'operation',persist:async value=>{checkpoint=structuredClone(value);},
    analyze:async input=>{models++;return report(input);},read:async()=>null});
  const first=create();await first.analyze();current={...current,binding:{...current.binding,draftRevision:2,draftVersion:2}};
  await first.stageApplication('COPY',{binding:current.binding,listingWorkflowId:'workflow',operationKey:'copy-operation',action:'COPY_CANDIDATE',value:{titleRu:'Заголовок',descriptionRu:'Описание'}});
  const next=create();assert.equal(next.restore(checkpoint),true);assert.equal(next.state().application.request.operationKey,'copy-operation');
  await assert.rejects(next.analyze(),/核对/);assert.equal(models,1);
  await next.clearApplication();await next.analyze();assert.equal(models,1);
});
test('BYOK receipt keeps exact server candidate input including model and policy for application',async()=>{
  const {createPreparationAnalysisSession}=await load();const current={...basis(),mode:'BYOK',profileId:'provider-profile'};
  const session=createPreparationAnalysisSession({getContext:()=>current,createOperationKey:()=> 'operation',persist:async()=>{},
    analyze:async input=>({analysisInput:{...input,executionMode:'BYOK',providerContext:{providerOrigin:'https://dashscope.aliyuncs.com',model:current.analysisModel,policyRevision:7}},analysis:report(input)}),read:async()=>null});
  await session.analyze();assert.equal(session.state().analysisInput.executionMode,'BYOK');assert.equal(session.state().analysisInput.providerContext.policyRevision,7);
  const changed={...session.checkpoint(),context:{...current,profileId:'foreign-profile'}};assert.equal(session.restore(changed),false);
});
test('explicit image and editable visual decisions survive reload as selections, without dropping uncertain source images',async()=>{
  const {createPreparationAnalysisSession}=await load();let checkpoint;
  const create=()=>createPreparationAnalysisSession({getContext:basis,createOperationKey:()=> 'operation',persist:async value=>{checkpoint=structuredClone(value);},analyze:async input=>report(input),read:async()=>null});
  const session=create();await session.analyze();
  await session.confirmCuration(['image-2']);await session.confirmVisual({...session.state().receipt.report.visualDescription,background:'浅灰厨房背景'});
  const recovered=create();assert.equal(recovered.restore(checkpoint),true);
  assert.deepEqual(recovered.state().selections.curationMediaKeys,['image-2']);assert.equal(recovered.state().selections.visualDescription.background,'浅灰厨房背景');
  await assert.rejects(recovered.confirmCuration(['foreign-media']),/图片/);
});
