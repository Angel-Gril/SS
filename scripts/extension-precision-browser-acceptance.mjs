import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PAGE_ORIGIN = 'https://detail.1688.com';
const PAGE_URL = `${PAGE_ORIGIN}/offer/845581683597.html`;
const IMAGE_ORIGIN = 'https://images.ss-erp-fixture.invalid';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await pause(60);
  }
  throw new Error(`Timed out: ${label}`);
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params, message.sessionId);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP connection timeout')), 5_000);
      socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('CDP connection failed')); }, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timeout, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1217/chrome-win64/chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1208/chrome-win64/chrome.exe'),
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  assert.ok(executable, 'Independent Chromium is required');
  return executable;
}


function fixtureProduct() {
  return {
    productId: '845581683597', title: '测试商品 · 长袖上衣',
    captureV2: {
      sourceIdentity: { productId: '845581683597', canonicalUrl: PAGE_URL },
      sourceCategory: { name: '上衣', path: [] },
      skus: Array.from({ length: 16 }, (_, index) => ({
        key: 'sku-' + index, sourceSkuId: 'source-' + index, specText: '颜色 ' + index + ' / M',
        priceCny: 11.5, stock: index === 0 ? 0 : 99, mediaKeys: ['image-' + index],
      })),
      media: Array.from({ length: 16 }, (_, index) => ({
        key: 'image-' + index, role: index % 2 ? 'product_detail' : 'product_main',
        disposition: 'accepted', url: IMAGE_ORIGIN + '/image-' + index + '.png',
        skuKeys: index === 0 ? [] : ['sku-' + index],
      })),
    },
  };
}
function parentHtml() {
  return `<!doctype html><html><head><script src="/shared/donor-workbench/workspace-contract.js"></script></head>
  <body style="margin:0"><iframe id="workspace" src="/pages/precision-workbench.html" referrerpolicy="no-referrer"
  style="position:fixed;inset:0;width:100vw;height:100vh;border:0"></iframe>
  <script>
  const contract=SS_ERP_DONOR_WORKBENCH_CONTRACT;
  const product=${JSON.stringify(fixtureProduct())};
  const shops=[{id:'doth',name:'DOTH'},{id:'other-fixture',name:'另一个测试店铺'}];
  let handoff=null,workbench=null,pricing=null,category=null,packaging=[],billing=null,history=null,selectedSkuKeys=[];
  let readyForPublish=false,assignedMedia=false,publishPreviews=0,publishStatusPolls=0,publishCommitted=false;
  let copy={titleRu:null,descriptionRu:null,pendingCandidates:[]},validationPasses=0,validationStatus='NOT_RUN',validationBlockers=[];
  const savedOperations=new Set();
  const attributeValues=new Map();
  let attributeSchema='c'.repeat(64);
  const attributeFields=[
    {attributeId:201,name:'商品特点',required:true,valueType:'STRING',cardinality:'SINGLE',ownership:'EDITOR',editorMode:'EDITABLE',valuePolicy:'FREE_TEXT',dictionaryId:null,maxValues:1},
    {attributeId:202,name:'颜色',required:true,valueType:'STRING',cardinality:'SINGLE',ownership:'SKU',editorMode:'SKU_MATRIX',valuePolicy:'STRICT_DICTIONARY',dictionaryId:42,maxValues:1},
    {attributeId:203,name:'适用场景',required:false,valueType:'STRING',cardinality:'MULTI',ownership:'EDITOR',editorMode:'EDITABLE',valuePolicy:'STRICT_DICTIONARY',dictionaryId:43,maxValues:100},
    {attributeId:204,name:'系统标识',required:false,valueType:'STRING',cardinality:'SINGLE',ownership:'SYSTEM',editorMode:'MANUAL_REQUIRED',valuePolicy:'FREE_TEXT',dictionaryId:null,maxValues:1}
    ,{attributeId:205,name:'型号说明',required:true,valueType:'STRING',cardinality:'SINGLE',ownership:'EDITOR',editorMode:'EDITABLE',valuePolicy:'FREE_TEXT',dictionaryId:null,maxValues:1}
  ];
  const commands=[];
  window.__precisionCommands=commands;
  window.__precisionPrivateCalls=[];
  window.__precisionByokSession=null;
  window.__precisionByokLaunch=(skuKey)=>{
    const draft=workbench.status.listing.items[0];
    if(!selectedSkuKeys.includes(skuKey))throw new Error('fixture SKU is not selected');
    window.__precisionByokSession={contractVersion:'extension-byok-workbench-launch-context/v1',sourcePlatform:'1688',
      sourceProductId:'845581683597',sourceCaptureSnapshotId:handoff.snapshotId,supplyGoodsId:handoff.supplyGoodsId,
      shopId:draft.shopId,workflowId:draft.id,draftRevision:draft.revision,draftVersion:draft.draftVersion,
      skuKey,slotKey:'sku:'+skuKey+':hero',assignmentMode:'APPEND',assignmentOrdinal:2};
  };
  function projection(){return contract.createProjection({platform:'1688',product,shops,handoff,workbench,billing,history});}
  window.__precisionAdvanceDraft=()=>{
    const draft=workbench.status.listing.items[0];draft.revision++;draft.draftVersion++;
    if(billing){billing.projection.context.draftRevision=draft.revision;billing.projection.context.draftVersion=draft.draftVersion;}
    if(history){history.context.revision=draft.revision;history.context.draftVersion=draft.draftVersion;}
    document.getElementById('workspace').contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'PROJECTION',projection:projection()},location.origin);
  };
  window.__precisionSetCopySourceCurrent=(current)=>{copy.pendingCandidates.forEach(candidate=>candidate.sourceCurrent=current);};
  window.addEventListener('message',async event=>{
    const frame=document.getElementById('workspace');
    if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
    const command=contract.parseFrameCommand(event.data);
    commands.push(command);
    if(command.type==='COLLECT')handoff={snapshotId:'snapshot-fixture',supplyGoodsId:'goods-fixture',sourceProductId:'845581683597',platform:'1688'};
    if(command.type==='CREATE_DRAFT'){selectedSkuKeys=command.selectedSkuKeys;workbench={state:'ready',status:{snapshot:{current:true},listing:{items:[{
      id:'draft-fixture',shopId:command.shopId,stage:'CATEGORY_REVIEW',status:'ACTIVE',runState:'ACTIVE',
      revision:1,draftVersion:1,selectedSkuCount:command.selectedSkuKeys.length,mediaAssignmentCount:0,
      blockerCount:0,warningCount:0,blockers:[],warnings:[],updatedAt:'2026-09-30T08:00:00Z'
    }]},media:{items:[]}}};}
    let result;
    let candidateId;
    let replayed=false;
    if(command.type==='CHECK_TRANSLATION')result={available:window.__precisionTranslationDenied!==true,reasonCode:window.__precisionTranslationDenied?'MEDIA_PROVIDER_NOT_ALLOWED':'READY'};
    if(command.type==='CREATE_TRANSLATION'){
      result={state:'completed',replay:false,operation:'IMAGE_TRANSLATE',workflowId:'translation-fixture-'+command.sourceMediaKey,status:'QUEUED',revision:1};
    }
    if(command.type==='OPEN_EMBEDDED_MEDIA'){
      window.__precisionByokLaunch(command.preferredSkuKey);
      result={state:'workbench_embedded',frameId:7};
    }
    if(command.type==='EDITOR_SAVE'&&command.action==='ATTRIBUTES'&&window.__precisionRejectNextAttributeSave){
      window.__precisionRejectNextAttributeSave=false;attributeSchema='d'.repeat(64);
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'官方属性字段已更新，请重新读取后填写并保存',outcome:'NOT_SUBMITTED',code:'ozon_attribute_schema_mismatch'},location.origin);
      return;
    }
    if(command.type==='EDITOR_SAVE'){
      await new Promise(resolve=>setTimeout(resolve,200));
      replayed=savedOperations.has(command.operationKey);
      if(replayed&&command.action==='COPY_CANDIDATE')candidateId=copy.pendingCandidates.find(candidate=>candidate.titleRu===(command.value.titleRu??null)&&candidate.descriptionRu===(command.value.descriptionRu??null))?.id;
      if(!replayed){
        savedOperations.add(command.operationKey);
        if(command.action!=='VALIDATE'){readyForPublish=false;validationStatus='STALE';validationBlockers=[];}
        if(command.action==='PRICING')pricing=command.value;
        else if(command.action==='PACKAGING')packaging=command.value.items;
        else if(command.action==='ATTRIBUTES')for(const change of command.value.changes){
          attributeValues.set(JSON.stringify([change.attributeId,change.skuKey||null]),{attributeId:change.attributeId,skuKey:change.skuKey||null,value:change.action==='CLEAR'?null:change.value,dictionaryValueIds:change.dictionaryValueIds||[],reviewed:true});
        }
        else if(command.action==='COPY_CANDIDATE'){
          candidateId='manual-copy-'+(copy.pendingCandidates.length+1);
          copy.pendingCandidates.push({id:candidateId,fields:[...(Object.hasOwn(command.value,'titleRu')?['title']:[]),...(Object.hasOwn(command.value,'descriptionRu')?['description']:[])],titleRu:command.value.titleRu??null,descriptionRu:command.value.descriptionRu??null,sourceCurrent:true});
          readyForPublish=false;
        }
        else if(command.action==='COPY_APPROVE'){
          const candidate=copy.pendingCandidates.find(candidate=>candidate.id===command.value.candidateId);
          if(!candidate||!candidate.sourceCurrent)throw new Error('fixture copy is stale');
          if(candidate.fields.includes('title'))copy.titleRu=candidate.titleRu;
          if(candidate.fields.includes('description'))copy.descriptionRu=candidate.descriptionRu;
          copy.pendingCandidates=copy.pendingCandidates.filter(item=>item.id!==candidate.id);readyForPublish=false;
        }
        else if(command.action==='VALIDATE'){
          validationPasses++;
          validationBlockers=[];
          if(!attributeValues.get(JSON.stringify([205,null]))?.value)validationBlockers.push({code:'MODEL_REQUIRED',message:'请填写商品型号说明',fieldPath:'attributes.205'});
          if(!copy.titleRu)validationBlockers.push({code:'TITLE_REQUIRED',message:'请完成俄文标题审核',fieldPath:'copy.titleRu'});
          if(!assignedMedia)validationBlockers.push({code:'MEDIA_REQUIRED',message:'请应用已审核图片',fieldPath:'media'});
          readyForPublish=validationBlockers.length===0;
          validationStatus=readyForPublish?'VALID':'INVALID';
          workbench.status.listing.items[0].stage=readyForPublish?'READY_TO_PUBLISH':'VALIDATION';
        }
        else category={...command.value,categoryName:'Одежда',typeName:'Футболка'};
        workbench.status.listing.items[0].revision++;
        workbench.status.listing.items[0].draftVersion++;
      }
    }
    if(command.type==='EDITOR_READ'||command.type==='EDITOR_SAVE'){
      const draft=workbench.status.listing.items[0];
      result={state:'ready',replayed,...(candidateId?{candidateId}:{}),editor:{contractVersion:'extension-listing-editor/v1',binding:{snapshotId:'snapshot-fixture',supplyGoodsId:'goods-fixture',shopId:draft.shopId,listingWorkflowId:draft.id,draftRevision:draft.revision,draftVersion:draft.draftVersion},selectedSkuKeys,category,pricing,packaging,copy,stage:readyForPublish?'READY_TO_PUBLISH':'CATEGORY_REVIEW',validation:{status:validationStatus},blockers:validationBlockers,freshness:Object.fromEntries(['category','attributes','content','media','pricing','validation'].map(key=>[key,readyForPublish?'CURRENT':'STALE'])),mediaAssignments:assignedMedia?[{scope:'PRODUCT',skuKey:null,slotKey:'product-main',assetId:'suite-output-1'},{scope:'SKU',skuKey:'sku-1',slotKey:'sku-main',assetId:'source-output-1'}]:[]}};
    }
    if(command.type==='EDITOR_CATALOG')result={state:'ready',catalog:{catalogRevision:'catalog-fixture',entries:[{categoryId:10,typeId:20,label:'服装 / 上衣'}],truncated:false}};
    if(command.type==='EDITOR_ATTRIBUTES')result={state:'ready',workspace:{schemaRevision:attributeSchema,fields:attributeFields,values:attributeFields.flatMap(field=>(field.ownership==='SKU'?selectedSkuKeys:[null]).map(skuKey=>attributeValues.get(JSON.stringify([field.attributeId,skuKey]))||{attributeId:field.attributeId,skuKey,value:field.attributeId===204?'ERP自动关联':null,dictionaryValueIds:[],reviewed:false}))}};
    if(command.type==='EDITOR_DICTIONARY')result={state:'ready',dictionary:{schemaRevision:attributeSchema,attributeId:command.attributeId,values:command.attributeId===202?[{id:7,value:'Синий'},{id:8,value:'Зеленый'}]:[101,102,103,104].map(id=>({id,value:'选项'+id})),complete:true,dictionaryComplete:true,resultExhaustive:true,hasMore:false,resultTruncated:false}};
    if(command.type==='EXECUTE_HOSTED_SUITE'&&command.action==='CREATE_AND_REVIEW_PLAN'){
      const draft=workbench.status.listing.items[0];
      billing={state:'ready',listingWorkflowId:draft.id,projection:{contractVersion:'extension-ai-image-suite-projection/v1',context:{listingWorkflowId:draft.id,shopId:draft.shopId,draftRevision:draft.revision,draftVersion:draft.draftVersion},plan:{preview:{hash:'f'.repeat(64),currency:'CNY',itemCount:2,estimatedCostCents:28,maximumCostCents:28}},suite:null}};
    }
    if(command.type==='EXECUTE_HOSTED_SUITE'&&command.action==='START'){
      const draft=workbench.status.listing.items[0];
      const output=(id)=>({id,url:'${IMAGE_ORIGIN}/'+id+'.png',mimeType:'image/png',width:900,height:1200});
      const item=(id,reviewStatus,outputs)=>({id,operation:'IMAGE_TO_IMAGE',status:'SUCCEEDED',reviewStatus,revision:1,contextSkuKey:'sku-1',contextSlotKey:id,selectedOutputAssetId:'',outputs,application:null,createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z'});
      history={state:'ready',listingWorkflowId:draft.id,context:{snapshotId:'snapshot-fixture',supplyGoodsId:'goods-fixture',shopId:draft.shopId,listingWorkflowId:draft.id,revision:draft.revision,draftVersion:draft.draftVersion},items:[item('suite-workflow-1','PENDING',[output('suite-output-1'),output('suite-old-output')]),item('suite-workflow-2','PENDING',[output('suite-output-2')]),item('rejected-workflow','REJECTED',[output('rejected-output')])],nextCursor:null,receipt:null};
      billing.projection.suite={status:'SUCCEEDED',slots:[1,2].map(index=>({slotKey:'slot-'+index,goal:'scene',status:'SUCCEEDED',workflowId:'suite-workflow-'+index,reviewStatus:'PENDING',output:{id:'suite-output-'+index},commands:index===1?{REVIEW_SLOT:{workflowId:'suite-workflow-1',outputAssetId:'suite-output-1'}}:{},allowedActions:index===1?['REVIEW_SLOT']:[],billing:{mode:'ERP_HOSTED',currency:'CNY',estimatedCostMinor:14,maximumCostMinor:14,reservationStatus:'SETTLED',settlement:{kind:'CHARGE',actualCostMinor:14,billedUnits:1}}}))};
    }
    if(command.type==='EXECUTE_HOSTED_SUITE'&&command.action==='REVIEW_SLOT'){
      await new Promise(resolve=>setTimeout(resolve,200));
      const slot=billing.projection.suite.slots.find(slot=>slot.slotKey===command.slotKey);
      if(!slot||!slot.allowedActions.includes('REVIEW_SLOT'))throw new Error('fixture review has no slot authority');
      const item=history.items.find(item=>item.id===slot.workflowId);
      item.reviewStatus=slot.reviewStatus=command.decision==='APPROVE'?'APPROVED':'REJECTED';
      item.revision++;
      item.selectedOutputAssetId=command.decision==='APPROVE'?slot.output.id:'';
      slot.commands=command.decision==='APPROVE'?{APPLY_SLOT:{workflowId:slot.workflowId,outputAssetId:slot.output.id}}:{};
      slot.allowedActions=command.decision==='APPROVE'?['APPLY_SLOT']:[];
    }
    if(command.type==='ASSIGN_HOSTED_SUITE'){
      const slot=billing.projection.suite.slots[0];
      if(slot.reviewStatus!=='APPROVED')throw new Error('fixture assignment requires review');
      const item=history.items.find(item=>item.id===slot.workflowId);
      item.application={id:'application-fixture',state:'APPLIED',mode:'append',contextSkuKey:'sku-1',contextSlotKey:slot.slotKey,appliedAt:'2026-09-30T08:00:01Z',rolledBackAt:null};
      slot.commands={};slot.allowedActions=[];
      assignedMedia=true; workbench.status.listing.items[0].mediaAssignmentCount=2;
    }
    if(command.type==='PUBLISH'&&command.action==='PREVIEW'){
      if(!readyForPublish)throw new Error('fixture is not ready');
      const draft=workbench.status.listing.items[0];
      const selectedMedia=[{scope:'PRODUCT',skuKey:null,slotKey:'product-main',assetId:'suite-output-1'},{scope:'SKU',skuKey:'sku-1',slotKey:'sku-main',assetId:'source-output-1'}];
      publishPreviews++;
      result={contractVersion:'extension-workbench-listing-publish/v1',executionMode:'ERP_HOSTED',shopId:draft.shopId,workflowId:draft.id,basisDraftRevision:draft.revision,basisDraftVersion:draft.draftVersion,currentDraftRevision:draft.revision,currentDraftVersion:draft.draftVersion,previewHash:String(publishPreviews).repeat(64),selectedSkuKeys,selectedMedia,orderedMedia:selectedMedia.map((media,ordinal)=>({...media,ordinal,source:ordinal===0?'GENERATED':'SOURCE'}))};
    }
    if(command.type==='PUBLISH'&&command.action==='CONFIRM'){
      if(command.previewHash!==String(publishPreviews).repeat(64))throw new Error('fixture stale preview was confirmed');
      await new Promise(resolve=>setTimeout(resolve,200));
      publishCommitted=true;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'测试回执暂未返回，请核对状态',outcome:'UNKNOWN_OUTCOME'},location.origin);
      return;
    }
    if(command.type==='PUBLISH'&&command.action==='STATUS'){
      publishStatusPolls++;
      result=!publishCommitted||publishStatusPolls===1?null:{state:publishStatusPolls===2?'PENDING':'SUCCEEDED',receiptId:'publish-receipt-fixture',failureCode:null};
    }
    frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'PROJECTION',projection:projection()},location.origin);
    if(command.type==='EDITOR_SAVE'&&command.action==='PACKAGING'&&window.__precisionLoseNextPackagingReply){
      window.__precisionLoseNextPackagingReply=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'包装保存回执暂未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);
      return;
    }
    if(command.type==='EDITOR_SAVE'&&command.action==='ATTRIBUTES'&&window.__precisionLoseNextAttributeReply){
      window.__precisionLoseNextAttributeReply=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'属性回执暂未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);
      return;
    }
    if(command.type==='EDITOR_SAVE'&&command.action==='COPY_CANDIDATE'&&window.__precisionLoseNextCopyReply){
      window.__precisionLoseNextCopyReply=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'文案回执暂未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);
      return;
    }
    frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:true,error:'',...(result===undefined?{}:{data:result})},location.origin);
  });
  </script></body></html>`;
}

function privateRuntimeFixtureScript(pngBytes) {
  const pngBase64 = pngBytes.toString('base64');
  const pngHash = createHash('sha256').update(pngBytes).digest('hex');
  return `(() => {
    window.__precisionScriptErrors = [];
    window.addEventListener('error', event => {
      try { parent.__precisionScriptErrors?.push(String(event.error?.stack || event.message || 'script error')); } catch {}
    });
    window.addEventListener('unhandledrejection', event => {
      try { parent.__precisionScriptErrors?.push(String(event.reason?.stack || event.reason || 'unhandled rejection')); } catch {}
    });
    if(location.pathname!=='/pages/precision-workbench.html')return;
    const profiles=new Map();
    let candidate=null;
    let editStateFixture={contractVersion:'extension-byok-workbench-edit-controller/v1',executionMode:'BYOK',slotKey:'sku:sku-1:hero',profileId:'',operation:'IMAGE_TO_IMAGE',references:{SLOT:[],SESSION_GLOBAL:[]},operationAvailability:[],scheduler:{state:'IDLE',activeCount:0,queuedCount:0},slot:{slotKey:'sku:sku-1:hero',revision:1,selectedAttemptId:null,selectedCandidateId:null},alternatives:[]};
    let editHandleIndex=0;
    const resultId='br_'+'a'.repeat(48);
    const png=new Blob([Uint8Array.from(atob(${JSON.stringify(pngBase64)}),character=>character.charCodeAt(0))],{type:'image/png'});
    const metadata={mimeType:'image/png',byteLength:png.size,sha256:${JSON.stringify(pngHash)}};
    function publicState(id){return {profile:profiles.get(id)?.profile,hasKey:profiles.get(id)?.hasKey===true,evidence:[]};}
    function editPreviewChannel(type, payload){
      const suffix=(''+(crypto.randomUUID?.()||'fixture')).replaceAll('-','').padEnd(48,'0').slice(0,48);
      const ticket='pt_'+suffix, channelName='ss-erp:byok-preview:'+suffix, channel=new BroadcastChannel(channelName);
      channel.onmessage=event=>{if(event.data.type==='READY'&&event.data.previewTicket===ticket){
        channel.postMessage({contractVersion:'extension-byok-workbench-preview-channel/v1',type:'PREVIEW',previewTicket:ticket,image:png,metadata}); setTimeout(()=>channel.close(),50);
      }};
      return {contractVersion:'extension-byok-workbench-preview-channel/v1',channelName,previewTicket:ticket,expiresAt:new Date(Date.now()+30000).toISOString(),metadata};
    }
    function readEditSnapshot(){return JSON.parse(JSON.stringify(editStateFixture));}
    const runtime={lastError:null,sendMessage(message,callback){
      const type=message.type,payload=message.payload||{};
      const safePayload=type==='ss-erp:byok-provider-session-key-set'?{profileId:payload.profileId,hasSecret:typeof payload.apiKey==='string'}:JSON.parse(JSON.stringify(payload));
      parent.__precisionPrivateCalls?.push({type,payload:safePayload});
      let data;
      if(type==='ss-erp:precision-frame-ui-register')data={state:parent.__precisionByokSession?'MEDIA_READY':'UI_REGISTERED',registered:true};
      else if(type==='ss-erp:byok-provider-profiles-list')data={profiles:[...profiles.values()].map(value=>value.profile)};
      else if(type==='ss-erp:byok-provider-profile-save'){
        const profile=SS_ERP_BYOK_PROFILE_SCHEMA.publicProfile(payload.profile),old=profiles.get(profile.id);
        const rebound=Boolean(old&&(old.profile.baseUrl!==profile.baseUrl||old.profile.model!==profile.model));
        profiles.set(profile.id,{profile,hasKey:rebound?false:old?.hasKey===true});data={...publicState(profile.id),rebound};
      } else if(type==='ss-erp:byok-provider-session-key-set'){
        profiles.get(payload.profileId).hasKey=true;data=publicState(payload.profileId);
      } else if(type==='ss-erp:byok-provider-session-key-clear'){
        profiles.get(payload.profileId).hasKey=false;data=publicState(payload.profileId);
      } else if(type==='ss-erp:byok-provider-profile-state')data=publicState(payload.profileId);
      else if(type==='ss-erp:byok-provider-permission-status')data={profileId:payload.profileId,origin:new URL(profiles.get(payload.profileId).profile.baseUrl).origin,granted:false};
      else if(type==='ss-erp:ai-image-workbench-state')data={contractVersion:'extension-byok-workbench-public-state/v1',executionMode:'BYOK',
        context:parent.__precisionByokSession,profiles:[...profiles.values()].map(value=>publicState(value.profile.id)),result:candidate,
        publish:null,generationOutcome:null,deliveryState:candidate?.deliveryState||'NOT_READY'};
      else if(type==='ss-erp:ai-image-workbench-readiness')data={readinessHandle:'rh_'+'b'.repeat(48),
        readinessBinding:{...parent.__precisionByokSession,contractVersion:'extension-byok-readiness-binding/v2'},expiresAt:new Date(Date.now()+30000).toISOString()};
      else if(type==='ss-erp:ai-image-workbench-provider-execute'){
        candidate={resultId,reviewState:'CANDIDATE_READY',deliveryState:'NOT_INGESTED'};data=candidate;
        if(parent.__precisionByokLoseGenerate){parent.__precisionByokLoseGenerate=false;callback({ok:false,errorCode:'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME'});return;}
      } else if(type==='ss-erp:ai-image-workbench-preview-open'){
        const suffix=crypto.randomUUID().replaceAll('-','').padEnd(48,'0'),ticket='pt_'+suffix;
        const channelName='ss-erp:byok-preview:'+suffix,channel=new BroadcastChannel(channelName);
        channel.onmessage=event=>{if(event.data.type==='READY'&&event.data.previewTicket===ticket){
          channel.postMessage({contractVersion:'extension-byok-workbench-preview-channel/v1',type:'PREVIEW',previewTicket:ticket,image:png,metadata});
          setTimeout(()=>channel.close(),50);
        }};
        data={contractVersion:'extension-byok-workbench-preview-channel/v1',channelName,previewTicket:ticket,expiresAt:new Date(Date.now()+30000).toISOString(),metadata};
      } else if(type==='ss-erp:ai-image-workbench-result-review'){
        if(payload.resultId!==candidate?.resultId)throw new Error('fixture candidate mismatch');
        data={...candidate,reviewState:payload.decision==='APPROVE'?'APPROVED':'REJECTED'};
        candidate=payload.decision==='APPROVE'?data:null;
      } else if(type==='ss-erp:ai-image-workbench-ingest'){
        if(candidate?.reviewState!=='APPROVED')throw new Error('fixture review is required');
        const context=parent.__precisionByokSession;
        const receipt={contractVersion:'extension-byok-generated-asset-ingest-client/v1',replayed:false,
          receiptId:'byok-receipt-fixture',assetId:'byok-asset-fixture',provenanceId:'byok-provenance-fixture',normalizedSha256:metadata.sha256,
          mimeType:'image/png',width:128,height:128,sourceDraftRevision:context.draftRevision,sourceDraftVersion:context.draftVersion,
          boundDraftRevision:context.draftRevision+1,boundDraftVersion:context.draftVersion+1,assignmentOrdinal:context.assignmentOrdinal,
          assignmentSha256:'e'.repeat(64),skuKey:context.skuKey,slotKey:context.slotKey};
        candidate={resultId,reviewState:'APPROVED',deliveryState:'BOUND',ingest:receipt};data=candidate;
        parent.__precisionAdvanceDraft();
        if(parent.__precisionByokLoseIngest){parent.__precisionByokLoseIngest=false;callback({ok:false,errorCode:'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME'});return;}
      } else if(type==='ss-erp:ai-image-workbench-source-catalog')data={contractVersion:'extension-byok-workbench-source-catalog/v1',items:[
        {sourceMediaKey:'image-0',role:'product_main',scope:'PRODUCT',skuKeys:[],label:'商品主图'},
        {sourceMediaKey:'image-1',role:'product_detail',scope:'SKU',skuKeys:['sku-1'],label:'SKU 图片 1'}]};
      else if(type==='ss-erp:ai-image-workbench-source-preview')data=editPreviewChannel(type,payload);
      else if(type==='ss-erp:ai-image-workbench-edit-media-prepare'){
        const purpose=payload.purpose,suffix=(''+(++editHandleIndex)).padStart(48,'0').slice(-48),channelName='ss-erp:byok-media-upload:'+suffix,uploadTicket='ut_'+suffix,channel=new BroadcastChannel(channelName);
        channel.onmessage=event=>{if(event.data.type==='UPLOAD'&&event.data.uploadTicket===uploadTicket){
          channel.postMessage({contractVersion:'extension-byok-workbench-media-channel/v1',type:'ACCEPTED',uploadTicket,purpose,mediaHandle:'mh_'+suffix,metadata:{mimeType:event.data.image.type||'image/png',byteLength:event.data.image.size,width:128,height:128,sha256:'c'.repeat(64)}}); setTimeout(()=>channel.close(),50);
        }};
        data={contractVersion:'extension-byok-workbench-media-channel/v1',channelName,uploadTicket,purpose,expiresAt:new Date(Date.now()+30000).toISOString()};
      } else if(type==='ss-erp:ai-image-workbench-edit-media-release')data={released:true};
      else if(type==='ss-erp:ai-image-workbench-edit-references'){
        editStateFixture={...editStateFixture,references:{...editStateFixture.references,SLOT:Array.isArray(payload.handles)?payload.handles:[]}}; data=readEditSnapshot();
      } else if(type==='ss-erp:ai-image-workbench-edit-state')data=readEditSnapshot();
      else if(type==='ss-erp:ai-image-workbench-edit-start'){
        const attemptId='attempt-000001',candidateId='br_'+'b'.repeat(48);
        editStateFixture={...editStateFixture,profileId:payload.profileId,operation:payload.operation,scheduler:{state:'REVIEW',activeCount:0,queuedCount:0},slot:{slotKey:'sku:sku-1:hero',revision:2,selectedAttemptId:attemptId,selectedCandidateId:candidateId},alternatives:[{attemptId,candidateId,state:'CANDIDATE_READY',selected:true}]}; data=readEditSnapshot();
      } else if(type==='ss-erp:ai-image-workbench-edit-select')data=readEditSnapshot();
      else if(type==='ss-erp:ai-image-workbench-edit-preview')data=editPreviewChannel(type,payload);
      else if(type==='ss-erp:ai-image-workbench-edit-review')data={resultId:'br_'+'b'.repeat(48),reviewState:'CANDIDATE_READY',deliveryState:'NOT_INGESTED'};
      else {callback({ok:false,errorCode:'FIXTURE_OPERATION_NOT_IMPLEMENTED'});return;}
      callback({ok:true,data});
    }};
    // Chrome exposes a non-configurable window.chrome object in headless mode.
    // Keep the fixture compatible with both extension and extension-disabled runs:
    // augment the existing object first, then replace it only when the property is
    // configurable.  A failed replacement must not silently make privateRuntime
    // appear unavailable.
    try {
      if (!window.chrome || typeof window.chrome !== 'object') throw new Error('chrome object unavailable');
      window.chrome.runtime = runtime;
      window.chrome.permissions = {};
    } catch (_error) {
      try {
        Object.defineProperty(window, 'chrome', {
          value: Object.assign({}, window.chrome || {}, { runtime, permissions: {} }),
          configurable: true,
          writable: true,
        });
      } catch (error) {
        window.__precisionFixtureChromeError = String(error && error.message || error);
      }
    }
  })();`;
}

async function run() {
  const artifacts = await mkdtemp(path.join(os.tmpdir(), 'ss-erp-precision-ui-evidence-'));
  const profile = await realpath(await mkdtemp(path.join(os.tmpdir(), 'ss-erp-precision-ui-profile-')));
  const summary = { ok: false, artifacts, scope: 'LOCAL_BROWSER_FIXTURE', screenshots: [], pageErrors: [], blockedRequests: [], providerRequests: 0, ozonRequests: 0, productionMutations: 0 };
  let cdp;
  let diagnose;
  const child = spawn(chromeExecutable(), [
    '--headless=new', '--window-size=1440,1100', '--user-data-dir=' + profile, '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--host-resolver-rules=MAP * ~NOTFOUND', 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  try {
    const activePort = await until(async () => {
      try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/u); } catch { return null; }
    }, 'isolated browser startup');
    cdp = await Cdp.connect('ws://127.0.0.1:' + activePort[0] + activePort[1]);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const sessionId = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const workspace = (expression) => evaluate('(() => {const window=globalThis.document.getElementById("workspace").contentWindow;const document=window.document;return (' + expression + ');})()');
    diagnose = async () => ({
      commands: await evaluate('window.__precisionCommands'),
      privateCalls: await evaluate('window.__precisionPrivateCalls'),
      state: await workspace('({status:document.getElementById("status-text")?.textContent,categoryOpen:document.getElementById("editor-category-modal")?.hidden===false,categoryOptions:document.getElementById("editor-category-select")?.options.length,categoryDisabled:document.getElementById("editor-category-save")?.disabled,suite:document.getElementById("precision-suite-state")?.textContent,generateDisabled:document.getElementById("precision-generate")?.disabled,privateRuntime:!!window.chrome?.runtime,byokState:document.getElementById("precision-byok-config-state")?.textContent,byokProfileSdk:!!window.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT,byokMediaSdk:!!window.SS_ERP_BYOK_WORKBENCH_CLIENT,editState:document.getElementById("precision-byok-edit-state")?.textContent,editError:document.getElementById("precision-byok-edit-state")?.textContent,editSourceCount:document.querySelectorAll("#precision-byok-edit-sources input").length,editLoadDisabled:document.getElementById("precision-byok-edit-load")?.disabled,editStartDisabled:document.getElementById("precision-byok-edit-start")?.disabled,editOperation:document.getElementById("precision-byok-edit-operation")?.value,editPrompt:document.getElementById("precision-byok-edit-prompt")?.value,readyState:document.readyState,moduleScripts:[...document.scripts].map(script=>({src:script.src,type:script.type})),resources:performance.getEntriesByType("resource").map(entry=>entry.name).filter(name=>name.includes("precision-workbench")),scriptErrors:parent.__precisionScriptErrors||[]})'),
    });
    cdp.on('Runtime.exceptionThrown', (event, observedSession) => {
      const message = event.exceptionDetails.exception?.description || event.exceptionDetails.text;
      if (message) summary.pageErrors.push(`${observedSession || 'root'}: ${message}`);
    });
    cdp.on('Page.javascriptDialogOpening', (event, observedSession) => {
      if (observedSession === sessionId) void send('Page.handleJavaScriptDialog', { accept: true });
    });
    cdp.on('Fetch.requestPaused', (event, observedSession) => {
      if (observedSession !== sessionId) return;
      void (async () => {
        const url = new URL(event.request.url);
        let body, type;
        if (url.href === PAGE_URL) { body = Buffer.from(parentHtml()); type = 'text/html'; }
        else if (url.origin === PAGE_ORIGIN && url.pathname === '/favicon.ico') {
          await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204 }); return;
        } else if (url.origin === PAGE_ORIGIN) {
          const relative = decodeURIComponent(url.pathname).replace(/^\//u, '');
          const absolute = path.resolve(EXTENSION_ROOT, relative);
          assert.ok(absolute.startsWith(EXTENSION_ROOT + path.sep) && !relative.includes('..'));
          body = await readFile(absolute);
          type = relative.endsWith('.css') ? 'text/css' : relative.endsWith('.html') ? 'text/html' : 'text/javascript';
        } else if (url.origin === IMAGE_ORIGIN) {
          body = await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png')); type = 'image/png';
        } else {
          summary.blockedRequests.push(event.request.url);
          await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); return;
        }
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type + '; charset=utf-8' }], body: body.toString('base64') });
      })().catch(async (error) => {
        summary.pageErrors.push(error.message);
        try { await send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }); } catch {}
      });
    });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: privateRuntimeFixtureScript(await readFile(path.join(EXTENSION_ROOT, 'icons', 'icon128.png'))) });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: PAGE_URL });
    await until(() => evaluate('!!document.getElementById("workspace")?.contentDocument?.getElementById("start-btn")'), 'workbench document');
    await until(() => workspace('document.querySelectorAll("tr[data-editor-row-index]").length === 16'), 'all sixteen donor editor rows');
    await until(() => workspace('document.querySelectorAll(".precision-source-tile img").length === 16'), 'sixteen images');
    assert.equal(await workspace('document.referrer'), '');
    await until(() => workspace('[...document.querySelectorAll(".precision-source-tile img")].every(image=>image.complete&&image.naturalWidth>0)'), 'decoded preview images');
    const click = async (selector) => {
      const point = await workspace('(() => {const node=document.querySelector(' + JSON.stringify(selector) + ');if(!node)throw new Error("missing "+' + JSON.stringify(selector) + ');node.scrollIntoView({block:"center"});const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const screenshot = async (name) => {
      await pause(200);
      const file = path.join(artifacts, name + '.png');
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(file, Buffer.from(result.data, 'base64'));
      summary.screenshots.push(file);
    };
    await screenshot('donor-workspace');
    if (process.argv.includes('--usability-only')) {
      assert.equal(await workspace('document.querySelector("input[name=image-workflow-mode][value=translate]").disabled'), false,
        'translation must have its own usable image workflow instead of a permanently disabled donor button');
      await click('input[name="image-workflow-mode"][value="translate"] + span');
      await until(() => workspace('document.getElementById("precision-translation-state").textContent.includes("请先创建")'), 'translation before draft shows prerequisite instead of throwing');
      assert.equal(await workspace('document.getElementById("image-workflow-start-btn").disabled'), true);
      assert.deepEqual(await workspace('parent.__precisionScriptErrors||[]'), []);
      await click('input[name="image-workflow-mode"][value="ai-suite"] + span');
    }
    await click('#start-btn');
    await until(() => workspace('document.getElementById("sku-picker").hidden===false'), 'original donor SKU picker');
    assert.equal(await workspace('document.querySelectorAll(".sku-picker-item").length'), 16);
    assert.equal(await workspace('document.getElementById("sku-apply-btn").textContent.includes("s)")'), false, 'no automatic mutation countdown');
    await click('#sku-toggle-btn');
    await click('input[data-row-id="sku-1"]');
    await click('input[data-row-id="sku-7"]');
    await screenshot('sku-selection');
    await click('#sku-apply-btn');
    await until(() => evaluate('window.__precisionCommands.some(command=>command.type==="CREATE_DRAFT")'), 'draft create command');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("草稿已就绪")'), 'draft readback');
    assert.equal(await workspace('document.querySelectorAll("tr[data-editor-row-index]").length'), 2);
    await until(() => workspace('document.querySelectorAll("#precision-media-sku option").length===2'), 'image workbench uses only selected draft SKUs');
    assert.deepEqual(await workspace('[...document.querySelectorAll("#precision-media-sku option")].map(option=>option.value)'), ['sku-1', 'sku-7']);
    assert.deepEqual(await workspace('[...document.querySelectorAll(".precision-source-tile")].map(tile=>tile.dataset.referenceKey)'), ['image-0', 'image-1', 'image-7'], 'product-level and selected SKU media are eligible');
    assert.ok(await workspace('document.querySelector(".editor-table-spec").textContent.includes("颜色 1")'));
    await screenshot('selected-draft');
    await until(() => workspace('document.getElementById("editor-save-btn").disabled===false'), 'draft editor loaded');
    if (process.argv.includes('--usability-only')) {
      const outer = await workspace('(()=>{const e=document.querySelector(".content");return{overflowY:window.getComputedStyle(e).overflowY,height:e.clientHeight,total:e.scrollHeight};})()');
      assert.equal(outer.overflowY, 'auto', 'the whole workbench content must scroll');
      assert.ok(outer.total > outer.height, 'the full editor/image content has an outer scroll range');
      await workspace('document.querySelector(".content").scrollTop=0');
      const wheelPoint = await workspace('(()=>{const r=document.querySelector(".content").getBoundingClientRect();return{x:r.left+3,y:r.top+r.height/2};})()');
      const toolbarTop = await workspace('document.querySelector(".toolbar").getBoundingClientRect().top');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...wheelPoint });
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      summary.wheelBefore = await workspace(`(()=>{const e=document.querySelector('.content');return{left:e.getBoundingClientRect().left,top:e.getBoundingClientRect().top,scrollTop:e.scrollTop,total:e.scrollHeight,height:e.clientHeight,hit:document.elementFromPoint(${wheelPoint.x},${wheelPoint.y})?.className};})()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 350 });
      await until(() => workspace('document.querySelector(".content").scrollTop>0'), 'actual mouse wheel scrolls the complete workbench');
      assert.equal(await workspace('document.querySelector(".toolbar").getBoundingClientRect().top'), toolbarTop, 'toolbar stays available during body scroll');
      await screenshot('usability-outer-scroll');
      const before = await evaluate('window.__precisionCommands.filter(c=>["COLLECT","CREATE_DRAFT"].includes(c.type)).length');
      await click('#start-btn');
      await pause(150);
      assert.equal(await workspace('document.getElementById("sku-picker").hidden'), true, 'continue editing must not reopen SKU collection');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>["COLLECT","CREATE_DRAFT"].includes(c.type)).length'), before);
      await click('#settings-btn');
      await until(() => workspace('document.getElementById("basic-modal").hidden===false'), 'basic information opens its original modal');
      assert.equal(await workspace('document.getElementById("basic-info").textContent.includes("长袖上衣")'), true);
      await click('[data-close-modal="basic-modal"]');
      await click('#category-select-btn');
      await until(() => workspace('document.getElementById("editor-category-select").options.length>1'), 'category choices and explicit placeholder');
      assert.equal(await workspace('document.getElementById("editor-category-save").disabled'), true, 'an arbitrary first official category is never approved automatically');
      await screenshot('usability-category');
      await click('#editor-category-close');
      await click('input[name="image-workflow-mode"][value="translate"] + span');
      await until(() => workspace('document.getElementById("precision-translation-panel").hidden===false'), 'translation mode panel');
      assert.equal(await workspace('document.getElementById("precision-prompt-text").closest(".precision-prompt").hidden'), true, 'translation must hide hosted generation prompts');
      assert.equal(await workspace('document.getElementById("precision-byok-generation").hidden'), true);
      if (process.argv.includes('--translation-denied')) {
        await evaluate('window.__precisionTranslationDenied=true');
        await click('#erp-refresh-btn');
        await pause(200);
        assert.equal(await workspace('document.getElementById("image-workflow-start-btn").disabled'), true, 'a disabled production translation provider is shown as unavailable before any mutation');
        assert.equal(await workspace('document.getElementById("precision-image-translate").disabled'), true, 'the secondary translation button obeys the same readiness');
        assert.match(await workspace('document.getElementById("precision-translation-state").textContent'), /未开放|未开启/u);
        assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="CREATE_TRANSLATION"||c.type==="EXECUTE_HOSTED_SUITE")'), false);
        await screenshot('usability-translation-disabled');
        summary.usability = { translationProviderDisabled: true, translationPosts: 0, suitePosts: 0 };
        summary.ok = true;
        await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
        return;
      }
      if (!await workspace('document.querySelector("[data-reference-key=image-7] input").checked')) await click('[data-reference-key=image-7] input');
      await click('#image-workflow-start-btn');
      await until(() => workspace('document.getElementById("precision-translation-state").textContent.includes("3 张已提交")'), 'selected images reach translation owner and the bounded batch completes');
      const translated = await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_TRANSLATION")');
      assert.equal(translated.length, 3);
      assert.deepEqual(translated.map(c=>c.sourceMediaKey), ['image-0','image-1','image-7']);
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="EXECUTE_HOSTED_SUITE")'), false, 'translation never falls into suite generation');
      await screenshot('usability-translation');
      await click('#image-workflow-start-btn');
      await pause(150);
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_TRANSLATION").length'), 3, 'queued translations are not submitted again');
      summary.usability = { outerContentScroll: true, continueDoesNotRecollect: true, explicitCategorySelection: true, translationCommands: 3, suiteCommands: 0 };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      return;
    }
    const byokEditMode = process.argv.includes('--byok-edit-inpaint') ? 'INPAINT'
      : process.argv.includes('--byok-edit-full') ? 'FULL_EDIT'
        : process.argv.includes('--byok-edit-quick') ? 'IMAGE_TO_IMAGE' : '';
    if (byokEditMode) {
      await click('input[name=image-workflow-mode][value=byok] + span');
      await click('#precision-byok-config');
      await until(() => workspace('document.getElementById("precision-byok-config-modal").hidden===false'), 'BYOK edit profile opens');
      await replaceText('#precision-byok-name', '参考图测试接口');
      await replaceText('#precision-byok-endpoint', 'https://provider.ss-erp-fixture.invalid/v1');
      await replaceText('#precision-byok-model', 'image-model-fixture');
      await click('input[name="precision-byok-operation"][value="' + byokEditMode + '"]');
      await click('#precision-byok-save-profile');
      await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("已保存")'), 'BYOK edit profile saved');
      await replaceText('#precision-byok-key', 'ss-erp-fixture-private-secret-sentinel');
      await click('#precision-byok-set-key');
      await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("密钥已加载")'), 'BYOK edit key loaded');
      await click('#precision-byok-config-close');
      await click('#precision-byok-generation-refresh');
      await until(() => evaluate('window.__precisionCommands.some(command=>command.type==="OPEN_EMBEDDED_MEDIA")'), 'edit media session opened');
      await click('#precision-byok-edit-load');
      await until(() => workspace('document.querySelectorAll("#precision-byok-edit-sources input").length===2'), 'edit source catalog loaded');
      if (byokEditMode === 'IMAGE_TO_IMAGE') {
        await click('#precision-byok-edit-sources input[value="image-0"]');
      } else {
        await workspace(`(() => { const select = document.getElementById('precision-byok-edit-operation'); select.value = ${JSON.stringify(byokEditMode)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await workspace(`(() => { const select = document.getElementById('precision-byok-edit-source'); select.value = 'image-0'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        if (byokEditMode === 'INPAINT') {
          const evaluated = await send('Runtime.evaluate', { expression: 'document.getElementById("workspace").contentWindow.document.getElementById("precision-byok-edit-mask")', returnByValue: false });
          const objectId = evaluated.result?.objectId;
          assert.ok(objectId, 'mask file input object');
          const described = await send('DOM.describeNode', { objectId });
          await send('DOM.setFileInputFiles', { files: [path.join(EXTENSION_ROOT, 'icons', 'icon128.png')], backendNodeId: described.node.backendNodeId });
        }
      }
      await replaceText('#precision-byok-edit-prompt', '保持商品结构,生成浅灰背景场景');
      await click('#precision-byok-edit-start');
      await until(() => workspace('document.getElementById("precision-byok-edit-preview").disabled===false'), 'reference candidate ready');
      await click('#precision-byok-edit-preview');
      await until(() => workspace('document.getElementById("precision-byok-edit-review").disabled===false'), 'reference candidate previewed');
      await click('#precision-byok-edit-review');
      await until(() => workspace('document.getElementById("precision-byok-edit-state").textContent.includes("审核")'), 'reference edit review handoff');
      const editCallTypes = await evaluate('window.__precisionPrivateCalls.map(call=>call.type)');
      assert.equal(editCallTypes.includes('ss-erp:ai-image-workbench-edit-start'), true);
      assert.equal(editCallTypes.includes('ss-erp:ai-image-workbench-edit-preview'), true);
      assert.equal(editCallTypes.includes('ss-erp:ai-image-workbench-edit-review'), true);
      await screenshot('byok-edit-reference-handoff');
      summary.byokEdit = { operation: byokEditMode, sourceMediaKey: 'image-0', candidatePreviewed: true, reviewHandoff: true };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      return;
    }
    async function fill(selector, value) {
      await click(selector);
      await send('Input.insertText', { text: value });
    }
    async function replaceText(selector, value) {
      await until(() => workspace(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return node&&!node.disabled&&!node.readOnly&&node.getClientRects().length>0;})()`), 'editable control: ' + selector);
      await click(selector);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.insertText', { text: value });
    }
    const fieldValue = (row, field) => workspace(`document.querySelector(${JSON.stringify(`input[data-row-index="${row}"][data-field-key="${field}"]`)}).value`);
    for (const row of [1, 2]) {
      await fill('input[data-row-index="' + row + '"][data-field-key="价格，CNY"]', '100');
      await fill('input[data-row-index="' + row + '"][data-field-key="折扣前价格，CNY"]', '120');
    }
    await click('#editor-save-btn');
    await until(() => workspace('document.querySelector(".precision-local-fields").textContent.includes("ERP 已保存")'), 'pricing saved and read back');
    const pricingSave = await evaluate('window.__precisionCommands.find(command=>command.type==="EDITOR_SAVE"&&command.action==="PRICING")');
    assert.deepEqual(pricingSave.value.items.map((item) => item.skuKey), ['sku-1', 'sku-7']);
    assert.equal(pricingSave.value.items[0].price, '100');
    assert.equal(await workspace('!!document.getElementById("editor-packaging-save-btn")'), true, 'packaging has its own explicit save');
    await click('#editor-packaging-save-btn');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("包装")'), 'empty packaging rejected visibly');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EDITOR_SAVE"&&command.action==="PACKAGING")'), false, 'unknown packaging cannot be guessed or submitted');
    const measuredPackages = [
      { skuKey: 'sku-1', weightG: 350, lengthMm: 140, widthMm: 80, heightMm: 60 },
      { skuKey: 'sku-7', weightG: 620, lengthMm: 240, widthMm: 120, heightMm: 75 },
    ];
    for (const [index, measured] of measuredPackages.entries()) {
      for (const [field, value] of [['毛重，克', measured.weightG], ['包装长度，毫米', measured.lengthMm], ['包装宽度，毫米', measured.widthMm], ['包装高度，毫米', measured.heightMm]]) {
        await replaceText(`input[data-row-index="${index + 1}"][data-field-key="${field}"]`, String(value));
      }
    }
    await replaceText('input[data-row-index="1"][data-field-key="毛重，克"]', '0');
    await click('#editor-packaging-save-btn');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EDITOR_SAVE"&&command.action==="PACKAGING")'), false, 'zero is not a measured package weight');
    await replaceText('input[data-row-index="1"][data-field-key="毛重，克"]', '350');
    await replaceText('input[data-row-index="1"][data-field-key="价格，CNY"]', '109');
    await click('#editor-packaging-save-btn');
    await click('#editor-packaging-save-btn');
    await until(() => workspace('document.querySelector(".precision-local-fields").textContent.includes("ERP 已保存包装")'), 'per-SKU packaging saved and read back');
    const packagingSave = await evaluate('window.__precisionCommands.find(command=>command.type==="EDITOR_SAVE"&&command.action==="PACKAGING")');
    assert.deepEqual(packagingSave.value.items, measuredPackages);
    assert.deepEqual(packagingSave.value.evidence, ['用户在扩展工作台确认各 SKU 实测包装，重量克、尺寸毫米']);
    assert.deepEqual(Object.keys(packagingSave.value.items[0]), ['skuKey', 'weightG', 'lengthMm', 'widthMm', 'heightMm']);
    assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="EDITOR_SAVE"&&command.action==="PACKAGING").length'), 1, 'double click saves packaging only once');
    assert.equal(await fieldValue(1, '毛重，克'), '350');
    assert.equal(await fieldValue(2, '毛重，克'), '620');
    for (const [index, measured] of measuredPackages.entries()) {
      for (const [field, value] of [['包装长度，毫米', measured.lengthMm], ['包装宽度，毫米', measured.widthMm], ['包装高度，毫米', measured.heightMm]]) {
        assert.equal(await fieldValue(index + 1, field), String(value), 'each measured package dimension survives readback');
      }
    }
    assert.equal(await fieldValue(1, '价格，CNY'), '109', 'packaging readback preserves unsaved pricing');
    assert.equal(await workspace('document.getElementById("editor-save-btn").disabled'), false, 'pricing remains independently available');
    await evaluate('window.__precisionAdvanceDraft()');
    await until(() => workspace('document.getElementById("editor-save-btn").disabled===false'), 'fresh editor readback after another revision');
    assert.equal(await fieldValue(1, '价格，CNY'), '109', 'automatic readback cannot overwrite another unsaved edit');
    await screenshot('per-sku-packaging');
    await replaceText('input[data-row-index="1"][data-field-key="毛重，克"]', '351');
    await evaluate('window.__precisionLoseNextPackagingReply=true');
    await click('#editor-packaging-save-btn');
    await until(() => workspace('document.getElementById("editor-replay-btn").hidden===false'), 'unknown packaging keeps its original operation');
    assert.equal(await workspace('document.getElementById("editor-packaging-save-btn").disabled'), true, 'unknown saves cannot create a new operation');
    await click('#editor-replay-btn');
    await until(() => workspace('document.getElementById("editor-replay-btn").hidden===true'), 'original packaging operation reconciled');
    assert.ok(await workspace('document.getElementById("status-text").textContent.includes("已核对")'), 'packaging reconciliation clears the earlier error');
    const packagingRequests = await evaluate('window.__precisionCommands.filter(command=>command.type==="EDITOR_SAVE"&&command.action==="PACKAGING")');
    assert.equal(packagingRequests.length, 3);
    assert.deepEqual(packagingRequests[2].value, packagingRequests[1].value);
    assert.equal(packagingRequests[2].operationKey, packagingRequests[1].operationKey, 'recovery uses the same frozen operation');
    assert.deepEqual(packagingRequests[2].binding, packagingRequests[1].binding);
    assert.equal(await fieldValue(1, '价格，CNY'), '109');
    await click('#editor-save-btn');
    await until(() => workspace('document.querySelector(".precision-local-fields").textContent.includes("ERP 已保存价格")'), 'unsaved pricing can be committed separately');
    await click('#category-select-btn');
    await until(() => workspace('document.getElementById("editor-category-select").options.length>1'), 'official category options');
    assert.equal(await workspace('document.getElementById("editor-category-save").disabled'), true, 'an explicit selection is required even for a single match');
    await workspace('(()=>{const e=document.getElementById("editor-category-select");e.value="0";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
    await until(() => workspace('document.getElementById("editor-category-save").disabled===false'), 'explicit official category choice');
    await click('#editor-category-save');
    await until(() => workspace('document.getElementById("editor-category-modal").hidden===true'), 'category saved without leaving the workbench');
    const categorySave = await evaluate('window.__precisionCommands.find(command=>command.type==="EDITOR_SAVE"&&command.action==="CATEGORY")');
    assert.equal(categorySave.value.categoryId, 10);
    assert.equal(categorySave.value.catalogRevision, 'catalog-fixture');
    await until(() => workspace(`!!document.querySelector(${JSON.stringify('[data-field-key=official-201][data-row-index="1"]')})`), 'official fields appended to original donor table');
    assert.equal(await workspace(`document.querySelector(${JSON.stringify('[data-field-key=official-204][data-row-index="1"]')}).disabled`), true, 'SYSTEM remains readonly even when schema says MANUAL_REQUIRED');
    await replaceText('[data-field-key=official-201][data-row-index="1"]', 'Для дома');
    async function chooseDictionary(attributeId, row, ids) {
      await click(`[data-field-key=official-${attributeId}][data-row-index="${row}"]`);
      await until(() => workspace('document.getElementById("precision-attribute-dictionary-modal")?.hidden===false&&document.querySelectorAll("[data-dictionary-id]").length>0'), 'same-window official dictionary');
      for (const id of ids) await click(`[data-dictionary-id="${id}"]`);
      await click('#precision-attribute-dictionary-apply');
      await until(() => workspace('document.getElementById("precision-attribute-dictionary-modal").hidden===true'), 'dictionary choice confirmed locally');
    }
    await chooseDictionary(202, 1, [7]);
    await chooseDictionary(202, 2, [8]);
    await chooseDictionary(203, 1, [101, 102, 103, 104]);
    await replaceText('input[data-row-index="1"][data-field-key="价格，CNY"]', '113');
    await replaceText('input[data-row-index="1"][data-field-key="包装长度，毫米"]', '149');
    await click('#editor-attributes-save-btn');
    await until(() => workspace('document.querySelector(".precision-local-fields").textContent.includes("ERP 已保存商品属性")'), 'official attribute saved and read back');
    const attributeSave = await evaluate('window.__precisionCommands.find(command=>command.type==="EDITOR_SAVE"&&command.action==="ATTRIBUTES")');
    assert.equal(attributeSave.value.schemaRevision, 'c'.repeat(64));
    assert.equal(attributeSave.value.changes.find(change=>change.attributeId===201).value, 'Для дома');
    assert.deepEqual(attributeSave.value.changes.filter(change=>change.attributeId===202).map(change=>[change.skuKey,change.dictionaryValueIds]), [['sku-1',[7]],['sku-7',[8]]]);
    assert.deepEqual(attributeSave.value.changes.find(change=>change.attributeId===203).dictionaryValueIds, [101,102,103,104]);
    assert.equal(attributeSave.value.changes.some(change=>change.attributeId===204), false);
    assert.equal(attributeSave.value.changes.some(change=>Object.hasOwn(change,'reviewed')), false, 'review flags remain server-owned');
    assert.equal(await fieldValue(1, '价格，CNY'), '113');
    assert.equal(await fieldValue(1, '包装长度，毫米'), '149');
    await click('[data-field-key=official-203][data-row-index="1"]');
    await until(() => workspace('document.querySelectorAll("[data-dictionary-id]:checked").length===4'), 'four official IDs survive saved workspace readback');
    await click('#precision-attribute-dictionary-close');
    await screenshot('official-attribute-table');
    await replaceText('[data-field-key=official-201][data-row-index="1"]', 'Старая схема');
    await evaluate('window.__precisionRejectNextAttributeSave=true');
    await click('#editor-attributes-save-btn');
    await until(() => workspace('document.getElementById("precision-attributes-state").textContent.includes("0 项待保存")&&document.getElementById("editor-save-btn").disabled===false'), 'known schema rejection reloads fields and permits correction');
    assert.equal(await workspace('document.getElementById("editor-replay-btn").hidden'), true, 'known rejected writes are not treated as unknown receipts');
    assert.equal(await fieldValue(1, '价格，CNY'), '113');
    assert.equal(await fieldValue(1, '包装长度，毫米'), '149');
    await replaceText('[data-field-key=official-201][data-row-index="1"]', 'Для кухни');
    await evaluate('window.__precisionLoseNextAttributeReply=true');
    await click('#editor-attributes-save-btn');
    await until(() => workspace('document.getElementById("editor-replay-btn").hidden===false'), 'unknown attributes preserve original operation');
    assert.equal(await workspace('document.getElementById("editor-attributes-save-btn").disabled'), true);
    await click('#editor-replay-btn');
    await until(() => workspace('document.getElementById("editor-replay-btn").hidden===true'), 'attribute operation reconciled');
    const attributeRequests = await evaluate('window.__precisionCommands.filter(command=>command.type==="EDITOR_SAVE"&&command.action==="ATTRIBUTES")');
    assert.equal(attributeRequests.length, 4);
    assert.equal(attributeRequests[2].operationKey, attributeRequests[3].operationKey);
    assert.deepEqual(attributeRequests[2].value, attributeRequests[3].value);
    assert.equal(attributeRequests[2].value.schemaRevision, 'd'.repeat(64), 'corrected edit uses the freshly loaded schema');
    await click('#editor-save-btn');
    await until(() => workspace('document.getElementById("editor-save-btn").disabled===false'), 'pricing save after attribute edits');
    await click('#editor-packaging-save-btn');
    await until(() => workspace('document.getElementById("editor-packaging-save-btn").disabled===false'), 'packaging save after attribute edits');
    await evaluate('document.getElementById("workspace").contentWindow.location.reload()');
    await until(() => workspace('document.querySelectorAll("tr[data-editor-row-index]").length===2&&document.querySelectorAll("#precision-media-sku option").length===2'), 'reopened existing draft retains only selected SKUs');
    await screenshot('saved-pricing-category');
    assert.equal(await workspace('document.getElementById("precision-prompt-text").value'), '', 'empty brief uses service rules');
    assert.equal(await workspace('!!document.getElementById("precision-negative-prompt")'), true, 'optional negative direction is available');
    await replaceText('#precision-prompt-text', '😀'.repeat(301));
    await click('#precision-plan');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("300")'), 'over-limit direction rejected visibly');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE")'), false, 'invalid direction submits no plan');
    await replaceText('#precision-visual-json', JSON.stringify({ subject: 'forged product', composition: '居中', background: '浅灰厨房台面', lighting: '柔和自然光', style: '写实' }));
    const compiledDirection = await workspace('document.getElementById("precision-prompt-text").value');
    assert.equal(compiledDirection, '构图：居中；背景：浅灰厨房台面；光线：柔和自然光；风格：写实');
    await replaceText('#precision-prompt-text', compiledDirection + '；侧视角');
    await replaceText('#precision-negative-prompt', '不加装饰文字');
    await click('#erp-refresh-btn');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("已刷新")'), 'readonly refresh');
    assert.equal(await workspace('document.getElementById("precision-prompt-text").value'), compiledDirection + '；侧视角', 'readback preserves edited direction');
    const checkedReferences = await workspace('[...document.querySelectorAll(".precision-source-tile")].filter(tile=>tile.querySelector("input").checked).map(tile=>tile.dataset.referenceKey)');
    for (const key of checkedReferences) await click(`[data-reference-key="${key}"] input[type="checkbox"]`);
    assert.equal(await workspace('document.getElementById("precision-prompt-text").value'), compiledDirection + '；侧视角', 'reference selection preserves suite direction');
    await click('#precision-plan');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("参考图")'), 'empty reference selection rejected visibly');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE")'), false, 'empty references cannot silently create a plan');
    await click('#erp-refresh-btn');
    assert.equal(await workspace('document.querySelectorAll(".precision-source-tile input:checked").length'), 0, 'readonly refresh does not silently restore deselected references');
    await click('[data-reference-key=image-1] input[type="checkbox"]');
    await click('[data-reference-key=image-7] input[type="checkbox"]');
    await workspace('document.getElementById("precision-prompt-text").scrollIntoView({block:"center"})');
    await screenshot('editable-suite-direction');
    await click('#precision-plan');
    await until(() => evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE")'), 'same-window plan request');
    await until(() => workspace('document.getElementById("precision-prompt-text").readOnly===true'), 'frozen direction locked');
    const planRequest = await evaluate('window.__precisionCommands.find(command=>command.type==="EXECUTE_HOSTED_SUITE")');
    assert.equal(planRequest.action, 'CREATE_AND_REVIEW_PLAN');
    assert.deepEqual(planRequest.creativeBrief, { prompt: compiledDirection + '；侧视角', negativePrompt: '不加装饰文字' });
    assert.deepEqual(planRequest.candidateMediaKeys, ['image-1', 'image-7'], 'the actual selected reference identifiers enter the create request');
    assert.ok(await workspace('[...document.querySelectorAll(".precision-source-tile input")].every(input=>input.disabled)'), 'reference choices freeze with the plan');
    assert.equal(JSON.stringify(planRequest).includes('forged product'), false, 'local JSON product facts are not forwarded');
    assert.equal(await workspace('document.getElementById("precision-negative-prompt").readOnly&&document.getElementById("precision-visual-json").readOnly'), true);
    await click('#erp-refresh-btn');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("已刷新")'), 'frozen plan readonly refresh');
    assert.equal(await workspace('document.getElementById("precision-prompt-text").value'), compiledDirection + '；侧视角');
    assert.equal(await workspace('document.getElementById("precision-plan").disabled'), true, 'same owner cannot create a second plan by editing directions');
    await workspace('document.getElementById("precision-prompt-text").scrollIntoView({block:"center"})');
    await screenshot('frozen-suite-direction');
    await click('#precision-generate');
    await until(() => evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE"&&command.action==="START")'), 'fixture starts frozen plan from same window');
    const startRequest = await evaluate('window.__precisionCommands.find(command=>command.type==="EXECUTE_HOSTED_SUITE"&&command.action==="START")');
    assert.equal(startRequest.costConfirmed, true);
    assert.deepEqual(startRequest.quoteWitness, { previewHash: 'f'.repeat(64), currency: 'CNY', itemCount: 2, maxCostMinor: 28 }, 'START binds the exact quote the user saw');
    assert.equal(Object.hasOwn(startRequest, 'creativeBrief'), false, 'later suite actions do not replace frozen directions');
    assert.equal(Object.hasOwn(startRequest, 'candidateMediaKeys'), false, 'start uses frozen plan references without changing choices');
    await until(() => workspace('document.querySelectorAll(".precision-candidate").length===4'), 'suite candidate readback');
    await until(() => workspace('!!document.querySelector("[data-suite-slot-key=slot-1][data-review-decision=APPROVE]")'), 'authorized suite review control');
    assert.equal(await workspace('document.querySelectorAll("[data-candidate-workflow=suite-workflow-2] button").length'), 0, 'unauthorized suite candidate has no mutation controls');
    assert.equal(await workspace('document.querySelectorAll("[data-candidate-output=suite-old-output] button").length'), 0, 'another output on the same suite workflow cannot fall through to generic review');
    assert.equal(await workspace('document.querySelectorAll("[data-candidate-workflow=rejected-workflow] button").length'), 0, 'rejected candidate has no mutation controls');
    assert.equal(await workspace('document.getElementById("precision-assign").disabled'), true, 'pending outputs cannot be assigned');
    await click('[data-candidate-output=suite-output-1] img');
    await until(() => workspace('document.getElementById("preview-modal").hidden===false'), 'same-window pending candidate preview');
    assert.ok(await workspace('document.getElementById("preview-image").src.endsWith("/suite-output-1.png")'));
    await screenshot('pending-suite-preview');
    await click('#preview-close-btn');
    await click('input[name=image-workflow-mode][value=byok] + span');
    await until(() => workspace('document.getElementById("precision-byok-config")?.disabled===false'), 'registered private API configuration');
    await click('#precision-byok-config');
    await until(() => workspace('document.getElementById("precision-byok-config-modal")?.hidden===false'), 'same-window provider configuration');
    await replaceText('#precision-byok-name', '我的测试接口');
    await replaceText('#precision-byok-endpoint', 'https://provider.ss-erp-fixture.invalid/v1');
    await replaceText('#precision-byok-model', 'image-model-fixture');
    await click('#precision-byok-save-profile');
    await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("已保存")'), 'profile saved through private runtime');
    const sentinel='ss-erp-fixture-private-secret-sentinel';
    await replaceText('#precision-byok-key', sentinel);
    await click('#precision-byok-set-key');
    await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("密钥已加载")'), 'session key loaded through private runtime');
    assert.equal(await workspace('document.getElementById("precision-byok-key").value'), '');
    assert.equal(JSON.stringify(await evaluate('window.__precisionCommands')).includes(sentinel), false, 'secret never enters source-page commands');
    assert.equal(JSON.stringify(await evaluate('window.__precisionPrivateCalls')).includes(sentinel), false, 'private fixture recording is redacted');
    assert.equal(await workspace(`document.body.textContent.includes(${JSON.stringify(sentinel)})||Object.values(localStorage).some(value=>value.includes(${JSON.stringify(sentinel)}))`), false, 'secret is not persisted or logged in page');
    const privateCalls=await evaluate('window.__precisionPrivateCalls');
    assert.ok(privateCalls.some(call=>call.type==='ss-erp:byok-provider-session-key-set'&&call.payload.hasSecret));
    assert.equal(privateCalls.some(call=>call.type==='ss-erp:byok-provider-capability-test'||call.type==='ss-erp:ai-image-workbench-provider-execute'), false, 'saving configuration never dispatches a provider');
    await screenshot('byok-private-settings');
    await click('#precision-byok-clear-key');
    await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("已清除")'), 'session key cleared');
    await click('#precision-byok-config-close');
    await click('input[name=image-workflow-mode][value=ai-suite] + span');
    await click('[data-suite-slot-key=slot-1][data-review-decision=APPROVE]');
    await click('[data-suite-slot-key=slot-1][data-review-decision=APPROVE]');
    await until(() => workspace('document.querySelector("[data-candidate-output=suite-output-1]")?.textContent.includes("已通过")'), 'slot owner approved readback');
    const reviewRequests = await evaluate('window.__precisionCommands.filter(command=>command.type==="EXECUTE_HOSTED_SUITE"&&command.action==="REVIEW_SLOT")');
    assert.equal(reviewRequests.length, 1, 'double click submits only one slot review');
    assert.equal(reviewRequests[0].slotKey, 'slot-1');
    assert.equal(reviewRequests[0].decision, 'APPROVE');
    assert.equal(reviewRequests[0].costConfirmed, false);
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="PREPARE_MEDIA_MUTATION")'), false, 'suite candidate uses its slot review owner');
    await until(() => workspace('document.getElementById("precision-assign").disabled===false'), 'approved suite can be assigned');
    await workspace('document.querySelector("[data-candidate-output=suite-output-1]").scrollIntoView({block:"center"})');
    await screenshot('approved-suite-candidate');
    await click('#precision-assign');
    await until(() => workspace('document.querySelector("[data-candidate-output=suite-output-1]")?.textContent.includes("已应用到草稿")'), 'assignment readback in same window');
    assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="ASSIGN_HOSTED_SUITE").length'), 1);
    assert.equal(await workspace('document.querySelector("[data-candidate-output=suite-old-output]")?.textContent.includes("已应用到草稿")'), false, 'an old output is not marked as assigned');
    assert.equal(await workspace('document.querySelector("[data-candidate-output=suite-old-output]")?.textContent.includes("已通过")'), false, 'workflow approval does not approve another output');
    assert.equal(await workspace('document.getElementById("precision-assign").disabled'), true, 'assigned output no longer offers a second application');
    await workspace('document.querySelector("[data-candidate-output=suite-output-1]").scrollIntoView({block:"center"})');
    await screenshot('assigned-suite-candidate');
    await click('#store-switch-btn');
    await workspace('document.getElementById("erp-shop-select").value="other-fixture"');
    await click('#shop-confirm-btn');
    assert.equal(await workspace('document.querySelectorAll(".precision-candidate").length'), 0, 'another shop cannot display current draft candidates');
    assert.equal(await workspace('document.getElementById("precision-assign").disabled'), true, 'another shop cannot assign this suite');
    await click('#store-switch-btn');
    await workspace('document.getElementById("erp-shop-select").value="doth"');
    await click('#shop-confirm-btn');
    await until(() => workspace('document.querySelectorAll(".precision-candidate").length===4'), 'returning to original draft restores the same readback');
    await replaceText('input[data-row-index="1"][data-field-key="价格，CNY"]', '114');
    await replaceText('input[data-row-index="1"][data-field-key="包装高度，毫米"]', '61');
    await until(() => workspace(`!document.querySelector(${JSON.stringify('[data-field-key=official-201][data-row-index="1"]')}).disabled`), 'official copy-related field ready');
    await replaceText('[data-field-key=official-201][data-row-index="1"]', 'Для спальни');
    await click('#ai-translation-process-btn');
    await until(() => workspace('document.getElementById("precision-copy-modal")?.hidden===false'), 'same-window manual Russian copy');
    await replaceText('#precision-copy-title', 'Товар для дома');
    await replaceText('#precision-copy-description', 'Для хранения вещей.');
    await evaluate('window.__precisionLoseNextCopyReply=true');
    await click('#precision-copy-save');
    await until(() => workspace('document.getElementById("editor-replay-btn").hidden===false'), 'unknown manual copy preserves its operation');
    await click('#precision-copy-close');
    await click('#editor-replay-btn');
    await until(() => workspace('document.getElementById("editor-replay-btn").hidden===true'), 'manual copy recovered with original operation');
    const copyCreates = await evaluate('window.__precisionCommands.filter(command=>command.type==="EDITOR_SAVE"&&command.action==="COPY_CANDIDATE")');
    assert.equal(copyCreates.length, 2);
    assert.equal(copyCreates[0].operationKey, copyCreates[1].operationKey);
    assert.deepEqual(copyCreates[0].value, copyCreates[1].value);
    await click('#ai-translation-process-btn');
    await until(() => workspace('document.querySelectorAll("[data-copy-candidate]").length===1&&document.querySelector("[data-copy-candidate]").disabled===false'), 'manual copy saved as pending review');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EDITOR_SAVE"&&command.action==="COPY_APPROVE")'), false, 'creating copy cannot implicitly approve it');
    await click('[data-copy-candidate]');
    assert.ok(await workspace('document.getElementById("precision-copy-review").textContent.includes("Товар для дома")'));
    assert.ok(await workspace('document.getElementById("precision-copy-review").textContent.includes("Для хранения вещей.")'));
    await screenshot('manual-copy-preview');
    await click('#precision-copy-close');
    await evaluate('window.__precisionSetCopySourceCurrent(false)');
    await click('#ai-translation-process-btn');
    await until(() => workspace('document.querySelector("[data-copy-candidate]")?.textContent.includes("来源已变化")'), 'stale copy source readback');
    assert.equal(await workspace('document.getElementById("precision-copy-approve").disabled'), true, 'stale source candidates cannot be approved');
    await click('#precision-copy-close');
    await evaluate('window.__precisionSetCopySourceCurrent(true)');
    await click('#ai-translation-process-btn');
    await until(() => workspace('document.querySelector("[data-copy-candidate]")?.disabled===false'), 'current copy source readback');
    await click('[data-copy-candidate]');
    await click('#precision-copy-approve');
    await until(() => workspace('document.getElementById("precision-copy-state").textContent.includes("已审核")'), 'explicit manual copy approval readback');
    await click('#precision-copy-close');
    assert.equal(await fieldValue(1, '价格，CNY'), '114', 'copy approval preserves pending pricing');
    assert.equal(await fieldValue(1, '包装高度，毫米'), '61', 'copy approval preserves pending packaging');
    assert.equal(await fieldValue(1, 'official-201'), 'Для спальни', 'copy approval preserves pending attributes');
    await click('#editor-save-btn');
    await until(() => workspace('document.getElementById("editor-save-btn").disabled===false'), 'copy-related pricing edit saved');
    await click('#editor-packaging-save-btn');
    await until(() => workspace('document.getElementById("editor-packaging-save-btn").disabled===false'), 'copy-related package edit saved');
    await until(() => workspace('document.getElementById("editor-attributes-save-btn").disabled===false'), 'copy-related official edits ready');
    await click('#editor-attributes-save-btn');
    await until(() => workspace('document.getElementById("editor-attributes-save-btn").disabled===true&&document.getElementById("editor-validate-btn").disabled===false'), 'copy-related official edits saved');
    await until(() => workspace('document.getElementById("editor-validate-btn").disabled===false'), 'validation uses current official schema');
    await click('#editor-validate-btn');
    await until(() => workspace('document.getElementById("precision-validation-state").textContent.includes("型号说明")'), 'owner validation returns concrete blockers');
    await click('#confirm-export-btn');
    await until(() => workspace('document.getElementById("precision-publish-modal").hidden===false'), 'blocked publication explains readiness');
    assert.equal(await workspace('document.getElementById("precision-publish-confirm").disabled'), true, 'invalid validation cannot publish');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="PUBLISH"&&command.action==="PREVIEW")'), false, 'blocked readiness cannot request a confirmable preview');
    await click('#precision-publish-close');
    await until(() => workspace(`!document.querySelector(${JSON.stringify('[data-field-key=official-205][data-row-index="1"]')}).disabled`), 'missing required official field editable');
    await replaceText('[data-field-key=official-205][data-row-index="1"]', 'Модель А');
    await click('#editor-attributes-save-btn');
    await until(() => workspace('document.getElementById("editor-validate-btn").disabled===false'), 'corrected attributes saved before validation');
    await click('#editor-validate-btn');
    await until(() => workspace('document.getElementById("precision-validation-state").textContent.includes("可上架")'), 'server validation marks complete ready draft');
    assert.equal(await workspace('document.getElementById("confirm-export-btn").disabled'), false, 'original upload entry opens the publication preview');
    await click('#confirm-export-btn');
    await until(() => workspace('document.getElementById("precision-publish-modal")?.hidden===false&&document.getElementById("precision-publish-confirm")?.disabled===false'), 'same-window server publish preview');
    assert.ok(await workspace('document.getElementById("precision-publish-details").textContent.includes("DOTH")'));
    assert.ok(await workspace('document.getElementById("precision-publish-details").textContent.includes("2 个 SKU")'));
    assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="PUBLISH"&&command.action==="CONFIRM").length'), 0, 'preview does not execute upload');
    await screenshot('publish-preview');
    await evaluate('window.__precisionAdvanceDraft()');
    await until(() => workspace('document.getElementById("precision-publish-modal").hidden===true'), 'a newer draft readback invalidates the old preview');
    assert.equal(await workspace('document.getElementById("precision-publish-confirm").disabled'), true);
    await until(() => workspace('document.getElementById("editor-save-btn").disabled===false'), 'newer draft editor readback');
    await click('#confirm-export-btn');
    await until(() => workspace('document.getElementById("precision-publish-confirm").disabled===false'), 'fresh preview after a newer readback');
    await click('#precision-publish-close');
    await replaceText('input[data-row-index="1"][data-field-key="价格，CNY"]', '105');
    await click('#confirm-export-btn');
    await until(() => workspace('document.getElementById("precision-publish-status").textContent.includes("未保存")'), 'unsaved edits invalidate the old preview');
    assert.equal(await workspace('document.getElementById("precision-publish-confirm").disabled'), true);
    assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="PUBLISH"&&command.action==="PREVIEW").length'), 2, 'unsaved changes do not silently upload old ERP values');
    await click('#precision-publish-close');
    await click('#editor-save-btn');
    await until(() => workspace('document.querySelector(".precision-local-fields").textContent.includes("ERP 已保存")'), 'publish-related pricing edit saved');
    await until(() => workspace('document.getElementById("editor-validate-btn").disabled===false'), 'changed pricing requires a fresh official schema view');
    await click('#editor-validate-btn');
    await until(() => workspace('document.getElementById("precision-validation-state").textContent.includes("可上架")'), 'changed pricing is revalidated before a new preview');
    await click('#confirm-export-btn');
    await until(() => workspace('document.getElementById("precision-publish-confirm").disabled===false'), 'new preview after saving changed draft');
    await click('#precision-publish-close');
    await click('#store-switch-btn');
    await workspace('document.getElementById("erp-shop-select").value="other-fixture"');
    await click('#shop-confirm-btn');
    await click('#store-switch-btn');
    await workspace('document.getElementById("erp-shop-select").value="doth"');
    await click('#shop-confirm-btn');
    await click('#confirm-export-btn');
    await until(() => workspace('document.getElementById("precision-publish-confirm").disabled===false'), 'new preview after returning from another shop');
    const latestPreview = await evaluate('window.__precisionCommands.filter(command=>command.type==="PUBLISH"&&command.action==="PREVIEW").length');
    assert.equal(latestPreview, 4);
    await click('#precision-publish-confirm');
    await click('#precision-publish-confirm');
    await until(() => workspace('document.getElementById("precision-publish-status").textContent.includes("核对")&&document.getElementById("precision-publish-refresh").disabled===false'), 'unknown confirmation outcome stays in current modal');
    const publishConfirmRequests = await evaluate('window.__precisionCommands.filter(command=>command.type==="PUBLISH"&&command.action==="CONFIRM")');
    assert.equal(publishConfirmRequests.length, 1, 'double click cannot submit another upload');
    assert.equal(publishConfirmRequests[0].previewHash, '4'.repeat(64), 'confirmation uses the current preview after readback/editor/shop changes');
    await click('#precision-publish-refresh');
    await until(() => workspace('document.getElementById("precision-publish-status").textContent.includes("未找到")'), 'null status is displayed without clearing unresolved confirmation');
    assert.equal(await workspace('document.getElementById("precision-publish-confirm").disabled'), true, 'null status cannot unlock unknown writes');
    await click('#precision-publish-refresh');
    await until(() => workspace('document.getElementById("precision-publish-status").textContent.includes("处理中")'), 'pending receipt readback');
    assert.equal(await workspace('document.getElementById("precision-publish-confirm").disabled'), true, 'pending receipt cannot be confirmed again');
    await click('#precision-publish-refresh');
    await until(() => workspace('document.getElementById("precision-publish-status").textContent.includes("已完成")'), 'publication receipt readback in same window');
    assert.ok(await workspace('document.getElementById("precision-publish-status").textContent.includes("publish-receipt-fixture")'));
    assert.ok(await workspace('document.getElementById("status-text").textContent.includes("已完成")'), 'confirmed receipt clears the earlier error message');
    await screenshot('publish-receipt');
    await click('#precision-publish-close');
    if (false && process.argv.includes('--byok-edit') && !process.argv.includes('--byok-flow')) {
      await click('input[name=image-workflow-mode][value=byok] + span');
      await click('#precision-byok-config');
      await until(() => workspace('document.getElementById("precision-byok-config-modal").hidden===false'), 'BYOK edit profile opens');
      await replaceText('#precision-byok-name', '参考图测试接口');
      await replaceText('#precision-byok-endpoint', 'https://provider.ss-erp-fixture.invalid/v1');
      await replaceText('#precision-byok-model', 'image-model-fixture');
      await click('input[name="precision-byok-operation"][value="IMAGE_TO_IMAGE"]');
      await click('#precision-byok-save-profile');
      await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("已保存")'), 'BYOK edit profile saved');
      await replaceText('#precision-byok-key', 'ss-erp-fixture-private-secret-sentinel');
      await click('#precision-byok-set-key');
      await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("密钥已加载")'), 'BYOK edit key loaded');
      await click('#precision-byok-config-close');
      await click('#precision-byok-generation-refresh');
      await until(() => evaluate('window.__precisionCommands.some(command=>command.type==="OPEN_EMBEDDED_MEDIA")'), 'edit media session opened');
      await click('#precision-byok-edit-load');
      await until(() => workspace('document.querySelectorAll("#precision-byok-edit-sources input").length===2'), 'edit source catalog loaded');
      await click('#precision-byok-edit-sources input[value="image-0"]');
      await replaceText('#precision-byok-edit-prompt', '保持商品结构,生成浅灰背景场景');
      await click('#precision-byok-edit-start');
      await until(() => workspace('document.getElementById("precision-byok-edit-preview").disabled===false'), 'reference candidate ready');
      await click('#precision-byok-edit-preview');
      await until(() => workspace('document.getElementById("precision-byok-edit-review").disabled===false'), 'reference candidate previewed');
      await click('#precision-byok-edit-review');
      await until(() => workspace('document.getElementById("precision-byok-edit-state").textContent.includes("审核")'), 'reference edit review handed off');
      const editCallTypes = await evaluate('window.__precisionPrivateCalls.map(call=>call.type)');
      assert.equal(editCallTypes.includes('ss-erp:ai-image-workbench-edit-start'), true);
      assert.equal(editCallTypes.includes('ss-erp:ai-image-workbench-edit-preview'), true);
      assert.equal(editCallTypes.includes('ss-erp:ai-image-workbench-edit-review'), true);
      summary.byokEdit = { operation: 'IMAGE_TO_IMAGE', sourceMediaKey: 'image-0', candidatePreviewed: true, reviewHandoff: true };
      await click('input[name=image-workflow-mode][value=ai-suite] + span');
    }
    if (process.argv.includes('--byok-flow')) {
      await click('input[name=image-workflow-mode][value=byok] + span');
      await click('#precision-byok-config');
      await until(() => workspace('document.getElementById("precision-byok-config-modal").hidden===false'), 'BYOK configuration reopens');
      await replaceText('#precision-byok-key', 'ss-erp-fixture-private-secret-sentinel');
      await click('#precision-byok-set-key');
      await until(() => workspace('document.getElementById("precision-byok-config-state").textContent.includes("密钥已加载")'), 'BYOK session key ready');
      await click('#precision-byok-config-close');
      await click('#precision-byok-generation-refresh');
      await until(() => workspace('document.getElementById("precision-byok-generation-submit").disabled===false'), 'source-page launch upgrades exact iframe to MEDIA_READY');
      const launches = await evaluate('window.__precisionCommands.filter(command=>command.type==="OPEN_EMBEDDED_MEDIA")');
      assert.equal(launches.length, 1);
      assert.deepEqual(Object.keys(launches[0]).sort(), ['contractVersion', 'listingWorkflowId', 'preferredSkuKey', 'requestId', 'type'].sort());
      assert.equal(launches[0].preferredSkuKey, 'sku-1');
      await replaceText('#precision-byok-generation-prompt', '保留收纳商品，浅灰背景，柔和侧光');
      await evaluate('window.__precisionByokLoseGenerate=true');
      await click('#precision-byok-generation-submit');
      await until(() => workspace('document.getElementById("precision-byok-generation-state").textContent.includes("未知")'), 'unknown generation fenced');
      assert.equal(await workspace('document.getElementById("precision-byok-generation-submit").disabled'), true);
      await click('#precision-byok-generation-refresh');
      await until(() => workspace('document.getElementById("precision-byok-generation-show-preview").disabled===false'), 'same result recovered by readonly state');
      assert.equal(await workspace('document.getElementById("precision-byok-generation-approve").disabled'), true, 'readback cannot approve a candidate without viewing it');
      await click('#precision-byok-generation-show-preview');
      await until(() => workspace('document.getElementById("precision-byok-preview-modal").hidden===false&&document.getElementById("precision-byok-preview-image").naturalWidth===128'), 'actual PNG Blob preview decoded');
      await screenshot('byok-single-pending-preview');
      await click('#precision-byok-preview-close');
      await until(() => workspace('document.getElementById("precision-byok-generation-approve").disabled===false'), 'decoded candidate is reviewable');
      await click('#precision-byok-generation-approve');
      await until(() => workspace('document.getElementById("precision-byok-generation-ingest").disabled===false'), 'explicit approval does not ingest');
      assert.equal(await evaluate('window.__precisionPrivateCalls.filter(call=>call.type==="ss-erp:ai-image-workbench-ingest").length'), 0);
      await screenshot('byok-single-approved');
      await evaluate('window.__precisionByokLoseIngest=true');
      await click('#precision-byok-generation-ingest');
      await until(() => workspace('document.getElementById("precision-byok-generation-refresh").disabled===false'), 'lost ingest remains readback-only');
      assert.equal(await workspace('document.getElementById("precision-byok-generation-ingest").disabled'), true);
      await click('#precision-byok-generation-refresh');
      await until(() => workspace('document.getElementById("precision-byok-generation-state").textContent.includes("绑定")'), 'exact bound receipt recovered without another ingest');
      const privateMediaCalls = await evaluate('window.__precisionPrivateCalls');
      assert.equal(privateMediaCalls.filter(call=>call.type==='ss-erp:ai-image-workbench-provider-execute').length, 1);
      assert.equal(privateMediaCalls.filter(call=>call.type==='ss-erp:ai-image-workbench-ingest').length, 1);
      assert.equal(privateMediaCalls.filter(call=>call.type==='ss-erp:ai-image-workbench-result-review').length, 1);
      assert.equal(privateMediaCalls.some(call=>call.type==='ss-erp:ai-image-workbench-publish'), false);
      assert.equal(JSON.stringify(await evaluate('window.__precisionCommands')).includes('ss-erp-fixture-private-secret-sentinel'), false);
      await screenshot('byok-single-bound');
      summary.byokSingle = { scope: 'NATIVE_RUNTIME_STUB_LOCAL_FIXTURE', sourceLaunches: 1, simulatedProviderDispatches: 1,
        simulatedIngestRequests: 1, explicitReviews: 1, blobDecoded: true, unknownGenerationReadback: true, unknownIngestReadback: true, receiptId: 'byok-receipt-fixture' };
      await click('input[name=image-workflow-mode][value=ai-suite] + span');
    }
    if (process.argv.includes('--translation')) {
      await click('input[name="image-workflow-mode"][value="translate"] + span');
      await until(() => workspace('document.getElementById("image-workflow-start-btn").disabled===false'), 'translation readiness readback');
      await click('#precision-image-translate');
      await until(() => workspace('document.getElementById("status-text").textContent.includes("3 张翻译图片已提交")'), 'selected translation batch submitted');
      const translationCommands = await evaluate('window.__precisionCommands.filter(command=>command.type==="CREATE_TRANSLATION")');
      assert.deepEqual(translationCommands.map(command=>command.listingWorkflowId), ['draft-fixture', 'draft-fixture', 'draft-fixture']);
      assert.deepEqual(translationCommands.map(command=>command.sourceMediaKey), ['image-0', 'image-1', 'image-7']);
      summary.translation = { ownerCommand: 'CREATE_TRANSLATION', sourceMediaKeys: ['image-0', 'image-1', 'image-7'], replaySafe: true };
    }
    const commands = await evaluate('window.__precisionCommands');
    const mutationCommands = commands.filter((command) => ['COLLECT', 'CREATE_DRAFT'].includes(command.type));
    assert.deepEqual(mutationCommands.map((command) => command.type), ['COLLECT', 'CREATE_DRAFT']);
    assert.deepEqual(mutationCommands[1].selectedSkuKeys, ['sku-1', 'sku-7']);
    assert.equal(mutationCommands[1].shopId, 'doth');
    assert.equal(commands.some((command) => command.type === 'OPEN_MEDIA_WORKBENCH'), false);
    await click('.precision-source-tile .preview-button');
    await until(() => workspace('document.getElementById("preview-modal").hidden===false'), 'reused donor image preview');
    assert.equal(await workspace('document.getElementById("preview-image").naturalWidth>0'), true);
    await screenshot('image-preview');
    await click('#preview-close-btn');
    await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 844, deviceScaleFactor: 1, mobile: false });
    await pause(150);
    const mobile = await workspace('({viewport:window.innerWidth,width:document.documentElement.scrollWidth})');
    assert.ok(mobile.width <= mobile.viewport, JSON.stringify(mobile));
    await screenshot('mobile-workspace');
    assert.deepEqual(summary.pageErrors, []);
    assert.deepEqual(summary.blockedRequests, []);
    summary.ok = true;
    summary.selectedSkuKeys = mutationCommands[1].selectedSkuKeys;
    summary.editorSaveActions = ['PRICING', 'PACKAGING', 'CATEGORY', 'ATTRIBUTES', 'COPY_CANDIDATE', 'COPY_APPROVE', 'VALIDATE'];
    summary.attributes = { textAttributeId: 201, skuDictionaryIds: [7,8], multiDictionaryIds: [101,102,103,104], explicitReplayRequests: 1, selectedRowsAfterReload: 2 };
    summary.packaging = { items: measuredPackages, mutationRequests: 2, explicitReplayRequests: 1, unsavedPricingPreserved: true };
    summary.creativeBrief = planRequest.creativeBrief;
    summary.creativeBriefFrozen = true;
    summary.candidateMediaKeys = planRequest.candidateMediaKeys;
    summary.suiteReview = { slotKey: reviewRequests[0].slotKey, decision: reviewRequests[0].decision, requests: reviewRequests.length, assignmentRequests: 1 };
    summary.publish = { previews: latestPreview, confirmations: publishConfirmRequests.length, readonlyStatusRequests: 3, receiptId: 'publish-receipt-fixture' };
    summary.copy = { manualCandidate: true, explicitApproval: true, explicitReplayRequests: 1, staleApprovalDenied: true, otherEditsPreserved: true, validationRequests: commands.filter(command=>command.type==='EDITOR_SAVE'&&command.action==='VALIDATE').length, blockerResolved: 'MODEL_REQUIRED' };
    summary.browser = (await cdp.send('Browser.getVersion')).product;
    summary.byokConfiguration={scope:'NATIVE_RUNTIME_STUB_LOCAL_FIXTURE',registered:true,sessionKeyRedacted:true,configurationProviderDispatches:0};
    await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
  } finally {
    if (!summary.ok && diagnose) {
      try { await writeFile(path.join(artifacts, 'failure.json'), JSON.stringify({ ...(await diagnose()), wheelBefore: summary.wheelBefore }, null, 2)); console.error('Failure diagnostics: ' + path.join(artifacts, 'failure.json')); } catch {}
    }
    if (cdp) { try { await cdp.send('Browser.close'); } catch {} }
    if (child.exitCode === null) child.kill();
    await pause(500);
    const temporaryRoot = path.resolve(os.tmpdir());
    assert.ok(profile.startsWith(temporaryRoot + path.sep) && path.basename(profile).startsWith('ss-erp-precision-ui-profile-'));
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
  console.log(JSON.stringify(summary, null, 2));
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
