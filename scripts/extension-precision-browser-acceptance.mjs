import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_ROOT = path.join(ROOT, 'extensions', 'ss-erp');
const PAGE_ORIGIN = 'https://detail.1688.com';
const PAGE_URL = `${PAGE_ORIGIN}/offer/845581683597.html`;
const IMAGE_ORIGIN = 'https://images.ss-erp-fixture.invalid';
const STAGED_ANALYSIS = process.argv.includes('--staged-analysis');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let acceptanceWaitPump;

async function until(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await acceptanceWaitPump?.();
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
      media: [...Array.from({ length: 16 }, (_, index) => ({
        key: 'image-' + index, role: index % 2 ? 'product_detail' : 'product_main',
        disposition: 'accepted', url: IMAGE_ORIGIN + '/image-' + index + '.png',
        skuKeys: index === 0 ? [] : ['sku-' + index],
      })), ...(STAGED_ANALYSIS?Array.from({length:24},(_,index)=>({key:'common-'+index,role:'product_detail',disposition:'accepted',url:IMAGE_ORIGIN+'/common-'+index+'.png',skuKeys:[]})):[]),
      { key: 'video-fixture', kind: 'video', role: 'video', disposition: 'accepted',
        url: IMAGE_ORIGIN + '/source.mp4', skuKeys: [] }],
    },
  };
}
function parentHtml(watermarkJpeg, sourceMediaBridge = '') {
  return `<!doctype html><html><head><script src="/shared/donor-workbench/product-preparation-client.js"></script><script src="/shared/donor-workbench/workspace-contract.js"></script></head>
  <body style="margin:0"><iframe id="workspace" src="/pages/precision-workbench.html" referrerpolicy="no-referrer"
  style="position:fixed;inset:0;width:100vw;height:100vh;border:0"></iframe>
  <script>
  const contract=SS_ERP_DONOR_WORKBENCH_CONTRACT;
  const processFixturePaid=${process.argv.includes('--paid-translation-flow')};
  const product=${JSON.stringify(fixtureProduct())};
  const shops=[{id:'doth',name:'DOTH'},{id:'other-fixture',name:'另一个测试店铺'}];
  let handoff=null,workbench=null,pricing=null,category=null,packaging=[],billing=null,history=null,selectedSkuKeys=[],offerRows=[];
  let imageProcessFinal=null,imageProcessHistory=null;
  const editorKeys=()=>selectedSkuKeys.concat(offerRows.map(row=>row.rowKey));
  let readyForPublish=false,assignedMedia=false,publishPreviews=0,publishStatusPolls=0,publishCommitted=false;
  let copy={titleRu:null,descriptionRu:null,pendingCandidates:[]},validationPasses=0,validationStatus='NOT_RUN',validationBlockers=[];
  const savedOperations=new Set();
  const preparationAnalyses=new Map();
  const stagedFixture=${STAGED_ANALYSIS};
  window.__precisionSimulatedModelSubmits=[];
  window.__precisionCheckpoints=new Map();
  const watermarkRequests=new Map();
  let videoBindings=[];
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
  window.__precisionExistingReviewedMedia=()=>{assignedMedia=true;window.__precisionAdvanceDraft();};
  window.__precisionInstallSourceDisplayBridge=()=>{
    const nodes=[];let transferStatus='PENDING';window.__precisionSourceDisplayReads=[];
    const currentFrame=document.getElementById('workspace');
    function node(){const handlers=new Map();const item={hidden:false,style:{removeProperty(){}},
      contentWindow:{postMessage(message,origin){
        // Join the already-open fixture only after the real bridge has read its existing draft.
        if(message.type==='PROJECTION'&&!message.projection?.handoff)return;
        currentFrame.contentWindow.postMessage(message,origin);}},setAttribute(){},appendChild(){},remove(){},
      addEventListener(type,handler){handlers.set(type,handler);},click(){handlers.get('click')?.({target:item});}};nodes.push(item);return item;}
    const fakeDocument={documentElement:node(),createElement:node,addEventListener(){},getElementById(id){return nodes.find(node=>node.id===id);}};
    const runtime={id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getManifest(){return{version:'1.0.452'};},
      getURL(path){return location.origin+'/'+path.replace(/^\\//,'');},onMessage:{addListener(){}},sendMessage(request,callback){
        window.__precisionSourceDisplayReads.push(JSON.parse(JSON.stringify(request)));
        if(request.type==='spb-self-hosted:get-ozon-shops'){callback({ok:true,data:shops});return;}
        if(request.type!=='ss-erp:source-listing-workbench-status')throw Error('unexpected source display write');
        callback({ok:true,handoff,result:{state:'ready',status:{...workbench.status,
          snapshot:{...workbench.status.snapshot,id:handoff.snapshotId,captureHash:'a'.repeat(64)},
          sourceMedia:{snapshotId:handoff.snapshotId,captureHash:'a'.repeat(64),transferStatus,
            items:transferStatus==='COMPLETE'?product.captureV2.media.filter(item=>item.role!=='video').map(item=>({
              key:item.key,sourceUrl:item.url,displayUrl:${JSON.stringify(IMAGE_ORIGIN)}+'/stored-'+item.key+'.png'})):[]}}}});
      }};
    const scope={SS_ERP_DONOR_WORKBENCH_CONTRACT:contract,SS_ERP_DONOR_1688_CAPTURE:{async collect(){return product;}},
      addEventListener(){},setTimeout:window.setTimeout.bind(window),clearTimeout:window.clearTimeout.bind(window)};
    new Function('globalThis','document','chrome','location',${JSON.stringify(sourceMediaBridge)})(scope,fakeDocument,{runtime},location);
    nodes.find(node=>node.id==='ss-erp-donor-workbench-trigger').click();
    window.__precisionCompleteSourceTransfer=()=>{transferStatus='COMPLETE';};
  };
  window.addEventListener('message',async event=>{
    const frame=document.getElementById('workspace');
    if(event.source!==frame.contentWindow||event.origin!==location.origin)return;
    const command=contract.parseFrameCommand(event.data);
    commands.push(command);
    if(${process.argv.includes('--image-process-flow')}&&imageProcessFinal&&command.type==='LOAD_BILLING'){
      const loading=contract.createProjection({platform:'1688',product,shops,handoff,workbench,
        billing:{state:'loading',listingWorkflowId:billing.listingWorkflowId},history});
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'PROJECTION',projection:loading},location.origin);
      await new Promise(resolve=>setTimeout(resolve,80));
    }
    if(command.type==='REFRESH'&&window.__precisionCategoryRefresh)await window.__precisionCategoryRefresh;
    if(command.type==='EDITOR_READ'&&${process.argv.includes('--editor-read-recovery')}&&!window.__precisionFailedEditorRead){
      window.__precisionFailedEditorRead=true;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,
        ok:false,error:'设备草稿读取暂时不可用，请重新读取',outcome:'NOT_SUBMITTED',code:'DEVICE_READ_UNAVAILABLE'},location.origin);return;
    }
    if(command.type==='COLLECT')handoff={snapshotId:'snapshot-fixture',supplyGoodsId:'goods-fixture',sourceProductId:'845581683597',platform:'1688'};
    if(command.type==='CREATE_DRAFT'){selectedSkuKeys=command.selectedSkuKeys;workbench={state:'ready',status:{snapshot:{current:true},listing:{items:[{
      id:'draft-fixture',shopId:command.shopId,stage:'CATEGORY_REVIEW',status:'ACTIVE',runState:'ACTIVE',
      revision:1,draftVersion:1,selectedSkuCount:command.selectedSkuKeys.length,mediaAssignmentCount:0,
      blockerCount:0,warningCount:0,blockers:[],warnings:[],updatedAt:'2026-09-30T08:00:00Z'
    }]},media:{items:[]}}};}
    let result;
    if(command.type==='PREPARATION_CAPABILITY')result={state:'ready',capability:{available:${process.argv.includes('--preparation-analysis')||STAGED_ANALYSIS},
      reasonCode:'${process.argv.includes('--preparation-analysis')||STAGED_ANALYSIS?'READY':'VISION_OFF'}',...(stagedFixture?{stagedAnalysis:true}:{}),providerFeeNotice:stagedFixture?'依次执行三个模型阶段，可能产生模型费用。':'商品分析使用一个模型请求，可能产生模型费用。'}};
    if(command.type==='PREPARATION_ANALYZE'){
      const analysis={binding:command.binding,skuKey:command.skuKey,sourceMediaKeys:command.sourceMediaKeys,operationKey:command.operationKey,
        category:{categoryId:category.categoryId,typeId:category.typeId,...command.categoryRevision},replayed:false,
        report:{contractVersion:'product-preparation-analysis/v1',reviewState:'CANDIDATE',
          curation:command.sourceMediaKeys.map((sourceMediaKey,index)=>({sourceMediaKey,decision:index?'REVIEW':'KEEP',reason:index?'检查图中文字':'展示商品轮廓'})),
          visualDescription:{composition:'商品居中',background:'浅灰背景',lighting:'柔光',style:'写实',observations:{colors:[],shapes:['来源商品轮廓'],visibleComponents:[],visibleText:[]}},
          productSummary:{observations:['图片中可见商品轮廓'],uncertainties:['材质和包装尺寸需要核对']},
          skuObservations:[{skuKey:command.skuKey,observations:['按当前采集 SKU 保留款式'],titleRu:'Товар'}],
          suggestedAttributes:[{attributeId:201,value:'Простой дизайн',evidence:{sourceMediaKeys:command.sourceMediaKeys.slice(0,5),observation:'图片中外形简洁'},manualReview:'REQUIRED'}],
          copy:{titleRu:'Товар для дома',descriptionRu:'Описание товара по выбранным изображениям.',tagsRu:['товар','дом']}}};
      let prepared=analysis;
      const receiptKey=command.operationKey+(command.stage?':'+command.stage:'');
      if(command.stage){
        const prior=preparationAnalyses.get(receiptKey);
        if(prior)prepared={...prior,replayed:true};
        else{
          const {report,...basis}=analysis;
          prepared=command.stage==='CURATION'?{...basis,stage:command.stage,curation:report.curation}
            :command.stage==='VISION'?{...basis,stage:command.stage,visualDescription:report.visualDescription,productSummary:report.productSummary,skuObservations:report.skuObservations,visionSourceMediaKeys:command.sourceMediaKeys.slice(0,8)}
            :{...analysis,stage:command.stage};
          window.__precisionSimulatedModelSubmits.push({operationKey:command.operationKey,stage:command.stage,skuKey:command.skuKey});
        }
      }
      preparationAnalyses.set(receiptKey,prepared);result={state:'ready',analysis:prepared};
      if(stagedFixture&&command.skuKey==='sku-1'&&command.stage==='VISION')await new Promise(resolve=>{window.__precisionReleaseStagedVision=resolve;});
      if(stagedFixture&&(command.skuKey==='sku-7'&&command.stage==='VISION'||command.skuKey==='sku-2'&&command.stage==='COPY')){
        frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:command.stage==='VISION'?'视觉分析响应暂未返回，请核对原视觉阶段':'文案生成响应暂未返回，请核对原文案阶段',outcome:'UNKNOWN_OUTCOME'},location.origin);return;
      }
      if(window.__precisionLosePreparationReply){window.__precisionLosePreparationReply=false;
        frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'商品分析响应暂未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);return;}
    }
    if(command.type==='PREPARATION_READ')result={state:'ready',analysis:preparationAnalyses.get(command.operationKey+(command.stage?':'+command.stage:''))||null};
    if(command.type==='PREPARATION_APPLY'){
      const draft=workbench.status.listing.items[0];
      if(!savedOperations.has(command.operationKey)){savedOperations.add(command.operationKey);draft.revision++;draft.draftVersion++;}
      result={state:'ready',application:{binding:{...command.binding,draftRevision:draft.revision,draftVersion:draft.draftVersion},selectedAttributeIds:command.selectedAttributeIds,replayed:false}};
    }
    if(command.type==='WATERMARK_TEMPLATES')result={contractVersion:'extension-workbench-watermark/v1',
      templates:[{id:'image-template',name:'DOTH 图案',position:'center',opacity:60,scale:25,isDefault:true}]};
    if(command.type==='VIDEO_READ')result={state:'ready',binding:{...command.request.binding},videoBindings};
    if(command.type==='VIDEO_SAVE'){
      const request=command.request;
      if([request.mainUrl,request.richContentUrl].some(url=>url&&!url.startsWith('https://cdn1.ozone.ru/s3/sc-temporary/'))){
        frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,
          ok:false,error:'来源视频请先上传至 Ozon，不能直接提交来源地址',outcome:'NOT_SUBMITTED'},location.origin);return;
      }
      videoBindings=videoBindings.filter(video=>video.skuKey!==request.skuKey);
      for(const [role,url]of [['MAIN',request.mainUrl],['RICH_CONTENT',request.richContentUrl]])if(url)videoBindings.push({skuKey:request.skuKey,role,url,
        sourceMediaKey:null,sourceCaptureSnapshotId:handoff.snapshotId,sourceCaptureHash:'a'.repeat(64),approvedByUserId:'owner-fixture',approvedAt:'2026-10-04T00:00:00Z'});
      const draft=workbench.status.listing.items[0];draft.revision++;draft.draftVersion++;
      result={state:'ready',replayed:false,binding:{...request.binding,draftRevision:draft.revision,draftVersion:draft.draftVersion},videoBindings};
    }
    if(command.type==='WATERMARK_PREVIEW')result={contractVersion:'extension-workbench-watermark/v1',previewHash:'d'.repeat(64),
      items:command.request.items.map(item=>({...item,width:128,height:128,dataUrl:'data:image/jpeg;base64,${watermarkJpeg}'})),erpGenerationChargeMinor:0};
    if(command.type==='WATERMARK_APPLY'){
      const prior=watermarkRequests.get(command.request.idempotencyKey);
      if(prior)result={...prior,replayed:true};
      else{
        const draft=workbench.status.listing.items[0];draft.revision++;draft.draftVersion++;
        result={draft:{...draft,sourceCaptureSnapshotId:handoff.snapshotId,supplyGoodsId:handoff.supplyGoodsId},
          assets:command.request.items.map((item,index)=>({id:'watermark-'+index,url:'${IMAGE_ORIGIN}/watermarked-'+index+'.jpg',kind:'IMAGE_PROCESSED'})),
          applied:command.request.items.length,replayed:false};
        watermarkRequests.set(command.request.idempotencyKey,result);
      }
    }
    if(command.type==='LOAD_BILLING'&&window.__precisionFailNextMediaRead){
      window.__precisionFailNextMediaRead=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,
        ok:false,error:'测试只读刷新暂时不可用',outcome:'NOT_SUBMITTED'},location.origin);
      return;
    }
    if(command.type==='LOAD_BILLING'&&(!billing||billing.projection.plan===null)&&workbench){
      const draft=workbench.status.listing.items[0];
      billing={state:'ready',listingWorkflowId:draft.id,projection:{contractVersion:'extension-ai-image-suite-projection/v1',
        context:{listingWorkflowId:draft.id,shopId:draft.shopId,draftRevision:draft.revision,draftVersion:draft.draftVersion},plan:null,suite:null}};
    }
    let candidateId;
    let replayed=false;
    if(command.type==='CHECK_TRANSLATION')result={available:window.__precisionTranslationDenied!==true,reasonCode:window.__precisionTranslationDenied?'MEDIA_PROVIDER_NOT_ALLOWED':'READY',
      ...(processFixturePaid?{testOnly:false,price:{currency:'CNY',unitCostCents:14,maximumCostCents:14,quoteFingerprint:'c'.repeat(64)}}:{testOnly:true})};
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
    if(command.type==='EDITOR_ATTRIBUTES'&&window.__precisionFailNextAttributeRead){
      window.__precisionFailNextAttributeRead=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'官方属性只读刷新暂时不可用',outcome:'NOT_SUBMITTED'},location.origin);return;
    }
    if(command.type==='EDITOR_SAVE'){
      await new Promise(resolve=>setTimeout(resolve,200));
      replayed=savedOperations.has(command.operationKey);
      if(replayed&&command.action==='COPY_CANDIDATE')candidateId=copy.pendingCandidates.find(candidate=>candidate.titleRu===(command.value.titleRu??null)&&candidate.descriptionRu===(command.value.descriptionRu??null))?.id;
      if(!replayed){
        savedOperations.add(command.operationKey);
        if(command.action!=='VALIDATE'){readyForPublish=false;validationStatus='STALE';validationBlockers=[];}
        if(command.action==='PRICING')pricing=command.value;
        else if(command.action==='SKU_DUPLICATE'){
          const sourceSkuKey=command.value.sourceSkuKey,rowKey='listing-copy:'+'a'.repeat(64);
          offerRows.push({rowKey,sourceSkuKey,offerId:'copy-'+('a'.repeat(40)),
            pricing:pricing?.items.find(row=>row.skuKey===sourceSkuKey)||null,packaging:packaging.find(row=>row.skuKey===sourceSkuKey)?Object.fromEntries(Object.entries(packaging.find(row=>row.skuKey===sourceSkuKey)).filter(([key])=>key!=='skuKey')):null});
        }
        else if(command.action==='SKU_COPY_REMOVE'){
          const rowKey=command.value.rowKey;offerRows=offerRows.filter(row=>row.rowKey!==rowKey);
          if(pricing)pricing={...pricing,items:pricing.items.filter(row=>row.skuKey!==rowKey)};
          packaging=packaging.filter(row=>row.skuKey!==rowKey);
        }
        else if(command.action==='SKU_SELECTION'){
          selectedSkuKeys=[...command.value.selectedSkuKeys];
          workbench.status.listing.items[0].selectedSkuCount=selectedSkuKeys.length;
        }
        else if(command.action==='PACKAGING')packaging=command.value.items;
        else if(command.action==='ATTRIBUTES')for(const change of command.value.changes){
          attributeValues.set(JSON.stringify([change.attributeId,change.skuKey||null]),{attributeId:change.attributeId,skuKey:change.skuKey||null,value:change.action==='CLEAR'?null:change.value,dictionaryValueIds:change.dictionaryValueIds||[],reviewed:true});
        }
        else if(command.action==='ATTRIBUTE_SUGGESTIONS'){
          for(const field of attributeFields.filter(field=>field.ownership!=='SYSTEM'))for(const skuKey of field.ownership==='SKU'?selectedSkuKeys:[null])attributeValues.set(JSON.stringify([field.attributeId,skuKey]),{attributeId:field.attributeId,skuKey,value:field.attributeId===202?'Синий':field.cardinality==='MULTI'?['选项101']:field.attributeId===205?'fixture-model':'来源资料确认值',dictionaryValueIds:field.dictionaryId?[field.attributeId===202?7:101]:[],reviewed:true});
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
    if(command.type==='EDITOR_COPY_CAPABILITY')result={state:'ready',capability:{available:!window.__precisionCopyGenerationDenied,
      reasonCode:window.__precisionCopyGenerationDenied?'LISTING_COPY_OFF':'AVAILABLE',providerFeeNotice:'生成文案可能产生 Provider 费用，不自动审核或发布。'}};
    if(command.type==='VISION_CAPABILITY')result={state:'ready',capability:{available:!window.__precisionVisionDisabled,
      reasonCode:window.__precisionVisionDisabled?'VISION_OFF':'READY',providerFeeNotice:'看图分析可能产生模型费用，仅用于编辑提示词。'}};
    if(command.type==='VISION_ANALYZE'){
      replayed=savedOperations.has(command.operationKey);savedOperations.add(command.operationKey);
      result={state:'ready',analysis:{binding:command.binding,operationKey:command.operationKey,skuKey:command.skuKey,
        sourceMediaKeys:command.sourceMediaKeys,replayed,
        visualDescription:{composition:'商品居中展示',background:'浅灰背景',lighting:'柔和自然光',style:'写实商品摄影',
          observations:{colors:['白色'],shapes:['方形'],visibleComponents:['提手'],visibleText:[]}}}};
      if(window.__precisionAdvanceDuringVision){window.__precisionAdvanceDuringVision=false;window.__precisionAdvanceDraft();}
    }
    if(command.type==='EDITOR_COPY_GENERATE'){
      replayed=savedOperations.has(command.operationKey);
      candidateId='generated-copy-fixture';
      if(!replayed){
        savedOperations.add(command.operationKey);
        copy.pendingCandidates.push({id:candidateId,fields:[...command.fields],titleRu:'Женская хлопковая футболка',
          descriptionRu:'Хлопковая футболка с длинными рукавами.',sourceCurrent:true});
        workbench.status.listing.items[0].revision++;workbench.status.listing.items[0].draftVersion++;
      }
    }
    if(command.type==='EDITOR_READ'||command.type==='EDITOR_SAVE'||command.type==='EDITOR_COPY_GENERATE'){
      const draft=workbench.status.listing.items[0];
      const freshness={category:category?'CURRENT':'STALE',attributes:attributeValues.size?'CURRENT':'STALE',content:copy.titleRu?'CURRENT':'STALE',media:assignedMedia?'CURRENT':'STALE',pricing:pricing?'CURRENT':'STALE',validation:readyForPublish?'CURRENT':'STALE'};
      result={state:'ready',replayed,...(candidateId?{candidateId}:{}),editor:{contractVersion:'extension-listing-editor/v1',binding:{snapshotId:'snapshot-fixture',supplyGoodsId:'goods-fixture',shopId:draft.shopId,listingWorkflowId:draft.id,draftRevision:draft.revision,draftVersion:draft.draftVersion},selectedSkuKeys,...(offerRows.length?{offerRows:{contractVersion:'source-listing-offer-rows/v1',rows:offerRows.map(row=>({...row,pricing:pricing?.items.find(item=>item.skuKey===row.rowKey)||row.pricing}))}}:{}),category,pricing,packaging,copy,stage:readyForPublish?'READY_TO_PUBLISH':'CATEGORY_REVIEW',validation:{status:validationStatus},blockers:validationBlockers,freshness,mediaAssignments:assignedMedia?[{scope:'PRODUCT',skuKey:null,slotKey:'product-main',assetId:'suite-output-1'},{scope:'SKU',skuKey:'sku-1',slotKey:'sku-main',assetId:'source-output-1'}]:[]}};
    }
    if(command.type==='EDITOR_CATALOG'){
      const leaf={categoryId:10,typeId:20,label:'服装 / 上衣',typeLabel:'上衣',pathTitles:['服装']};
      result={state:'ready',catalog:{catalogRevision:'catalog-fixture',entries:[leaf],truncated:false,total:1,
        tree:[{categoryId:10,label:'服装',children:[],types:[leaf]}],treeTruncated:false,
        recommendations:[{...leaf,match:'recommended',reasons:['来源类目：女式T恤']}],
        ...(command.preview?{attributePreview:{...command.preview,schemaRevision:'c'.repeat(64),fields:[{attributeId:201,name:'商品特点',required:true,valueType:'STRING',cardinality:'SINGLE',dictionaryId:null,ownership:'EDITOR',editorMode:'EDITABLE',valuePolicy:'FREE_TEXT',maxValues:1}]}}:{})}};
    }
    if(command.type==='EDITOR_ATTRIBUTES')result={state:'ready',workspace:{schemaRevision:attributeSchema,fields:attributeFields,values:attributeFields.flatMap(field=>(field.ownership==='SKU'?editorKeys():[null]).map(skuKey=>attributeValues.get(JSON.stringify([field.attributeId,skuKey]))||{attributeId:field.attributeId,skuKey,value:field.attributeId===204?'ERP自动关联':null,dictionaryValueIds:[],reviewed:false}))}};
    if(command.type==='EDITOR_ATTRIBUTE_SUGGESTIONS')result={state:'ready',workspace:{schemaRevision:attributeSchema,fields:attributeFields,values:[]},suggestions:attributeFields.filter(field=>field.ownership!=='SYSTEM').map(field=>({attributeId:field.attributeId,attributeName:field.name,candidateId:'candidate-'+field.attributeId,candidateHash:'e'.repeat(64),schemaRevision:attributeSchema,reviewed:false,
      rows:(field.ownership==='SKU'?selectedSkuKeys:[null]).map(skuKey=>({skuKey,value:field.attributeId===202?'Синий':field.cardinality==='MULTI'?['选项101']:'来源资料确认值',sourceValue:'采集资料',source:'SOURCE',dictionaryValueIds:field.dictionaryId?[field.attributeId===202?7:101]:[],reviewed:false,evidence:[{id:'source-evidence',source:'SOURCE_STANDARD',path:'source.attributes',value:'采集资料',isEstimated:false,confidence:1}],unresolvedValues:[]}))})),blockedSuggestions:[]};
    if(command.type==='EDITOR_ATTRIBUTE_SUGGESTIONS')result={state:'ready',suggestions:result};
    if(command.type==='EDITOR_ATTRIBUTE_SUGGESTIONS'&&${process.argv.includes('--empty-attributes-flow')})result.suggestions.suggestions=[];
    if(command.type.startsWith('LOGISTICS_')){
      const hint={commission:null,fx:{rate:0.1,source:'open.er-api.com',fetchedAt:new Date().toISOString()},requiresManual:['commissionPct']};
      const scope={assignmentId:'assignment-fixture',shopId:'doth',shopName:'DOTH',companyId:'company-fixture',warehouseId:'warehouse-fixture',warehouseName:'广州仓',originCountryUid:'cn',originCityUid:'guangzhou',originLabel:'广州',destinationCountryUid:'ru',destinationLocationUid:'moscow',destinationLabel:'莫斯科',releaseSequence:1,effectiveReleaseAvailable:true};
      const common={contractVersion:'extension-listing-logistics-pricing/v1',binding:command.binding,hints:hint};
      const lease={validUntil:new Date(Date.now()+3600000).toISOString(),authorizationValidUntil:new Date(Date.now()+300000).toISOString()};
      if(command.type==='LOGISTICS_SCOPES')result={state:'ready',logistics:{...common,selectedSkuKeys,packaging,assignments:[scope],requiresSelection:true}};
      if(command.type==='LOGISTICS_SERVICES')result={state:'ready',logistics:{...common,...lease,selection:command.selection,releaseId:'release-fixture',releaseSequence:1,effectiveChecksum:'f'.repeat(64),services:[{stableServiceKey:'service-fixture',providerId:'fixture-provider',displayName:'标准陆运',deliveryVariant:'pickup',deliveryPromise:'12–24天'}],requiresSelection:true}};
      if(command.type==='LOGISTICS_QUOTE')result={state:'ready',logistics:{...common,...lease,selection:command.selection,releaseId:'release-fixture',effectiveChecksum:'f'.repeat(64),stableServiceKey:'service-fixture',source:'ERP_PUBLISHED_FORMULA',currency:'CNY',items:command.items.map(item=>({skuKey:item.skuKey,declaredPriceMinor:item.declaredPriceMinor,shippingMinor:250,packingMinor:0,totalLogisticsMinor:250,shippingCostMinor:250,shippingCostCny:2.5,matchedBand:{priceRangeCNY:['0','0'],priceRangeRUB:['0','0']},matchedRuleDigest:'d'.repeat(64)})),requiresPricePreview:true,writesDraft:false}};
    }
    if(command.type==='EDITOR_DICTIONARY')result={state:'ready',dictionary:{schemaRevision:attributeSchema,attributeId:command.attributeId,values:command.attributeId===202?[{id:7,value:'Синий'},{id:8,value:'Зеленый'}]:[101,102,103,104].map(id=>({id,value:'选项'+id})),complete:true,dictionaryComplete:true,resultExhaustive:true,hasMore:false,resultTruncated:false}};
    if(command.type==='EXECUTE_HOSTED_SUITE'&&command.action==='CREATE_AND_REVIEW_PLAN'){
      const draft=workbench.status.listing.items[0];
      const count=command.galleryGoals?.length===0?1:2;
      billing={state:'ready',listingWorkflowId:draft.id,projection:{contractVersion:'extension-ai-image-suite-projection/v1',context:{listingWorkflowId:draft.id,shopId:draft.shopId,draftRevision:draft.revision,draftVersion:draft.draftVersion},plan:{preview:{hash:'f'.repeat(64),currency:'CNY',itemCount:count,estimatedCostCents:count*14,maximumCostCents:count*14}},suite:null}};
    }
    if(command.type==='EXECUTE_HOSTED_SUITE'&&command.action==='START'){
      const draft=workbench.status.listing.items[0];
      const output=(id)=>({id,url:'${IMAGE_ORIGIN}/'+id+'.png',mimeType:'image/png',width:900,height:1200});
      const item=(id,reviewStatus,outputs)=>({id,operation:'IMAGE_TO_IMAGE',status:'SUCCEEDED',reviewStatus,revision:1,contextSkuKey:'sku-1',contextSlotKey:id,selectedOutputAssetId:'',outputs,application:null,createdAt:'2026-09-30T08:00:00Z',updatedAt:'2026-09-30T08:00:00Z'});
      history={state:'ready',listingWorkflowId:draft.id,context:{snapshotId:'snapshot-fixture',supplyGoodsId:'goods-fixture',shopId:draft.shopId,listingWorkflowId:draft.id,revision:draft.revision,draftVersion:draft.draftVersion},items:[item('suite-workflow-1','PENDING',[output('suite-output-1'),output('suite-old-output')]),item('suite-workflow-2','PENDING',[output('suite-output-2')]),item('rejected-workflow','REJECTED',[output('rejected-output')])],nextCursor:null,receipt:null};
      billing.projection.suite={status:'SUCCEEDED',slots:[1,2].map(index=>({slotKey:'slot-'+index,goal:'scene',status:'SUCCEEDED',workflowId:'suite-workflow-'+index,reviewStatus:'PENDING',output:{id:'suite-output-'+index},commands:index===1?{REVIEW_SLOT:{workflowId:'suite-workflow-1',outputAssetId:'suite-output-1'}}:{},allowedActions:index===1?['REVIEW_SLOT']:[],billing:{mode:'ERP_HOSTED',currency:'CNY',estimatedCostMinor:14,maximumCostMinor:14,reservationStatus:'SETTLED',settlement:{kind:'CHARGE',actualCostMinor:14,billedUnits:1}}}))};
      if(billing.projection.plan.preview.itemCount===1){
        billing.projection.suite.slots=billing.projection.suite.slots.slice(0,1);
        billing.projection.suite.slots[0].goal='sku_hero';
        history.items=history.items.slice(0,1);
      }
      if(${process.argv.includes('--image-process-flow')}){
        imageProcessFinal=structuredClone(billing.projection.suite);imageProcessHistory=structuredClone(history.items);
        imageProcessFinal.slots[0].goal='sku_hero';
        window.__precisionImagePhase='QUEUED';
      }
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
    if(command.type==='EDITOR_SAVE'&&command.action==='CATEGORY'&&${process.argv.includes('--category-refresh-race')}){
      window.__precisionCategoryRefresh=new Promise(resolve=>setTimeout(resolve,200));
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:true,error:'',data:result},location.origin);
      await window.__precisionCategoryRefresh;window.__precisionCategoryRefresh=null;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'PROJECTION',projection:projection()},location.origin);return;
    }
    if(${process.argv.includes('--image-process-flow')}&&imageProcessFinal){
      const phase=window.__precisionImagePhase||'QUEUED',final=structuredClone(imageProcessFinal);
      final.status=phase;
      final.slots=final.slots.map((slot,index)=>{
        if(phase==='SUCCEEDED'||(index===0&&phase!=='QUEUED'))return slot;
        return {...slot,status:phase==='PARTIAL_FAILURE'?'FAILED':phase,workflowId:null,output:null,
          reviewStatus:'NOT_READY',commands:{},allowedActions:[],billing:{...slot.billing,reservationStatus:'RESERVED',settlement:null}};
      });
      billing.projection.suite=final;
      const old=Array.from({length:12},(_,i)=>({...imageProcessHistory[0],id:'history-'+i,
        outputs:[{...imageProcessHistory[0].outputs[0],id:'history-output-'+i,url:'${IMAGE_ORIGIN}/history-'+i+'.png'}]}));
      history.items=[...(phase==='QUEUED'?[]:phase==='SUCCEEDED'?imageProcessHistory.slice(0,2):imageProcessHistory.slice(0,1)),...old];
    }
    frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'PROJECTION',projection:projection()},location.origin);
    if(command.type==='EDITOR_SAVE'&&command.action==='SKU_DUPLICATE'&&${process.argv.includes('--sku-copy-flow')}&&!window.__precisionLostCopyReply){
      window.__precisionLostCopyReply=true;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'复制 SKU 回执未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);return;
    }
    if(command.type==='CREATE_DRAFT'&&${process.argv.includes('--draft-recovery-flow')}&&!window.__precisionLostDraftReply){
      window.__precisionLostDraftReply=true;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'草稿回执尚未返回，请核对原结果',outcome:'UNKNOWN_OUTCOME'},location.origin);return;
    }
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
    if(command.type==='EDITOR_COPY_GENERATE'&&window.__precisionLoseNextGeneratedCopyReply){
      window.__precisionLoseNextGeneratedCopyReply=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,ok:false,error:'文案生成回执暂未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);
      return;
    }
    if(command.type==='VISION_ANALYZE'&&window.__precisionLoseNextVisionReply){
      window.__precisionLoseNextVisionReply=false;
      frame.contentWindow.postMessage({contractVersion:contract.CONTRACT_VERSION,type:'COMMAND_RESULT',requestId:command.requestId,
        ok:false,error:'看图回执尚未返回，请核对原操作',outcome:'UNKNOWN_OUTCOME'},location.origin);return;
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
      else if(type==='ss-erp:product-analysis-readiness')data={available:parent.__precisionAnalysisPermission===true,permissionRequired:parent.__precisionAnalysisPermission!==true,profileId:payload.profileId,analysisModel:payload.analysisModel,providerFeeNotice:'自带 API 分析由你的 API 服务计费。'};
      else if(type==='ss-erp:product-analysis-permission-prepare')data={permissionTicket:'analysis-permission-'+crypto.randomUUID(),providerOrigin:'https://provider.ss-erp-fixture.invalid',pattern:'https://provider.ss-erp-fixture.invalid/*',expiresAt:Date.now()+60000};
      else if(type==='ss-erp:product-analysis-permission-commit'){parent.__precisionAnalysisPermission=true;data={granted:true};}
      else if(type==='ss-erp:preparation-checkpoint-read')data=parent.__precisionCheckpoints.get(JSON.stringify([payload.binding.snapshotId,payload.binding.shopId,payload.binding.listingWorkflowId]))||null;
      else if(type==='ss-erp:preparation-checkpoint-write'){parent.__precisionCheckpoints.set(JSON.stringify([payload.binding.snapshotId,payload.binding.shopId,payload.binding.listingWorkflowId]),JSON.parse(JSON.stringify(payload.checkpoint)));data={saved:true};}
      else if(type==='ss-erp:preparation-checkpoint-clear'){parent.__precisionCheckpoints.delete(JSON.stringify([payload.binding.snapshotId,payload.binding.shopId,payload.binding.listingWorkflowId]));data={cleared:true};}
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
      window.chrome.permissions = {request:(input,callback)=>{parent.__precisionPrivateCalls?.push({type:'permissions.request',payload:input,trusted:navigator.userActivation.isActive});callback(true);}};
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
  const summary = { ok: false, artifacts, scope: 'LOCAL_BROWSER_FIXTURE', screenshots: [], pageErrors: [], blockedRequests: [], dialogs: [], inlineConfirmations: [], providerRequests: 0, ozonRequests: 0, productionMutations: 0 };
  let cdp;
  let diagnose;
  const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
  const watermarkJpeg = (await require('sharp')(await readFile(path.join(EXTENSION_ROOT, 'icons/icon128.png'))).jpeg().toBuffer()).toString('base64');
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
      pricing: await workspace('({state:document.getElementById("precision-pricing-state")?.textContent,inputs:[...document.querySelectorAll("#precision-pricing-modal input")].map(input=>({id:input.id,value:input.value,field:input.dataset.pricingField}))})'),
      vision: await workspace('({open:document.getElementById("precision-vision-modal")?.hidden===false,state:document.getElementById("precision-vision-state")?.textContent,media:document.querySelectorAll("#precision-vision-modal input").length,sourceOpen:document.getElementById("precision-image-source-panel")?.hidden===false,managerOpen:document.getElementById("precision-image-manager")?.hidden===false,button:document.getElementById("precision-vision-open")?.getBoundingClientRect().toJSON(),focused:document.activeElement?.id})'),
      state: await workspace('({status:document.getElementById("status-text")?.textContent,categoryOpen:document.getElementById("editor-category-modal")?.hidden===false,categoryOptions:document.getElementById("editor-category-select")?.options.length,categoryDisabled:document.getElementById("editor-category-save")?.disabled,suite:document.getElementById("precision-suite-state")?.textContent,generateDisabled:document.getElementById("precision-generate")?.disabled,privateRuntime:!!window.chrome?.runtime,byokState:document.getElementById("precision-byok-config-state")?.textContent,byokProfileSdk:!!window.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT,byokMediaSdk:!!window.SS_ERP_BYOK_WORKBENCH_CLIENT,editState:document.getElementById("precision-byok-edit-state")?.textContent,editError:document.getElementById("precision-byok-edit-state")?.textContent,editSourceCount:document.querySelectorAll("#precision-byok-edit-sources input").length,editLoadDisabled:document.getElementById("precision-byok-edit-load")?.disabled,editStartDisabled:document.getElementById("precision-byok-edit-start")?.disabled,editOperation:document.getElementById("precision-byok-edit-operation")?.value,editPrompt:document.getElementById("precision-byok-edit-prompt")?.value,readyState:document.readyState,moduleScripts:[...document.scripts].map(script=>({src:script.src,type:script.type})),resources:performance.getEntriesByType("resource").map(entry=>entry.name).filter(name=>name.includes("precision-workbench")),scriptErrors:parent.__precisionScriptErrors||[]})'),
    });
    cdp.on('Runtime.exceptionThrown', (event, observedSession) => {
      const message = event.exceptionDetails.exception?.description || event.exceptionDetails.text;
      if (message) summary.pageErrors.push(`${observedSession || 'root'}: ${message}`);
    });
    cdp.on('Page.javascriptDialogOpening', (event, observedSession) => {
      if (observedSession !== sessionId) return;
      // Native dialogs block the iframe and are forbidden for the workbench flow.
      // Cancel only to release Chromium; the recorded page error makes the
      // acceptance fail instead of silently accepting a business mutation.
      summary.dialogs.push(event.message);
      summary.pageErrors.push(`native JavaScript dialog: ${event.message}`);
      void send('Page.handleJavaScriptDialog', { accept: false });
    });
    cdp.on('Fetch.requestPaused', (event, observedSession) => {
      if (observedSession !== sessionId) return;
      void (async () => {
        const url = new URL(event.request.url);
        let body, type;
        if (url.href === PAGE_URL) { body = Buffer.from(parentHtml(watermarkJpeg,
          process.argv.includes('--source-media-display') ? await readFile(path.join(EXTENSION_ROOT, 'content/donor-workbench-bridge.js'), 'utf8') : '')); type = 'text/html'; }
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
        await send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type + '; charset=utf-8' },
          ...(url.origin === IMAGE_ORIGIN ? [{ name: 'Access-Control-Allow-Origin', value: PAGE_ORIGIN }] : [])], body: body.toString('base64') });
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
    if (process.argv.includes('--sku-images')) {
      assert.equal(await workspace('document.querySelectorAll("[data-image-sku-key]").length'), 16,
        'the image workspace must show one original-style summary row per canonical SKU');
      assert.equal(await workspace('!!document.getElementById("precision-media-sku")'), false,
        'SKU image navigation must use rows, not the old draft SKU dropdown');
      assert.ok(await workspace('(()=>{const content=document.querySelector(".content");return window.getComputedStyle(content).overflowY==="auto"&&content.scrollHeight>content.clientHeight;})()'),
        'all sixteen SKU image rows retain whole-workbench vertical scrolling');
    }
    await until(() => workspace('document.querySelectorAll(".precision-source-tile img").length === '+(STAGED_ANALYSIS?40:16)), 'all fixture source images');
    assert.equal(await workspace('document.referrer'), '');
    await until(() => workspace('[...document.querySelectorAll(".precision-source-tile img")].every(image=>image.complete&&image.naturalWidth>0)'), 'decoded preview images');
    let inlineMonitorBusy = false;
    const inlineAutoMode = process.argv.includes('--inline-confirmation-flow') ? 'manual' : 'accept';
    const inlineState = async () => workspace(`(()=>{const panel=[...document.querySelectorAll('[data-inline-confirmation]')].find(node=>!node.hidden&&node.getClientRects().length>0);if(!panel)return null;const accept=panel.querySelector('[data-inline-confirm="accept"]'),cancel=panel.querySelector('[data-inline-confirm="cancel"]');return {text:panel.textContent||'',acceptDisabled:Boolean(accept?.disabled),cancelDisabled:Boolean(cancel?.disabled)};})()`);
    const click = async (selector, options = {}) => {
      // Navigate the actual SKU dialog before interacting with its controls.
      // All clicks, including navigation, still use trusted CDP mouse input.
      const location = await workspace('(()=>{const node=[...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(node=>node.getClientRects().length>0)||document.querySelector(' + JSON.stringify(selector) + ');return {inside:!!node?.closest("#precision-image-manager"),nested:!!node?.closest(".settings-modal,.preview-modal,#watermark-modal"),open:document.getElementById("precision-image-manager")?.hidden===false,result:!!node?.closest("#precision-image-result-panel"),source:!!node?.closest("#precision-image-source-panel"),creative:!!node?.closest(".precision-creative-options"),detailsOpen:node?.closest(".precision-creative-options")?.open};})()');
      if (location.open && !location.inside && !location.nested && selector !== '#precision-image-close') await click('#precision-image-close');
      if (location.inside && !location.open) {
        await click('[data-image-sku-key="sku-1"]');
        await click('#precision-image-scope');
      }
      if (location.inside && location.result && await workspace('document.getElementById("precision-image-result-panel").hidden')) await click('#precision-image-results');
      if (location.source && await workspace('document.getElementById("precision-image-source-panel").hidden')) await click('#precision-image-sources');
      if (location.creative && !location.detailsOpen && selector !== '.precision-creative-options summary') await click('.precision-creative-options summary');
      await workspace('([...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(node=>node.getClientRects().length>0)||document.querySelector(' + JSON.stringify(selector) + ')).scrollIntoView({block:"center",inline:"center",behavior:"instant"})');
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const point = await workspace('(() => {const node=[...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(node=>node.getClientRects().length>0)||document.querySelector(' + JSON.stringify(selector) + ');if(!node)throw new Error("missing "+' + JSON.stringify(selector) + ');const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};})()');
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      if (!options.skipInlineMonitor && inlineAutoMode === 'accept') await pause(0);
    };
    const resolveInline = async ({ decision = 'accept', expected = '', label = 'inline confirmation', timeout = 15_000 } = {}) => {
      const state = await until(async () => {
        const value = await inlineState();
        return value && (!expected || value.text.includes(expected)) ? value : false;
      }, label, timeout);
      summary.inlineConfirmations.push({ decision, text: state.text });
      const selector = `[data-inline-confirmation] [data-inline-confirm="${decision === 'accept' ? 'accept' : 'cancel'}"]`;
      await click(selector, { skipInlineMonitor: true });
      if (decision === 'accept') await until(async () => !(await inlineState()), `${label} settled`);
      else await until(async () => !(await inlineState()), `${label} cancelled`);
      return state;
    };
    if (inlineAutoMode === 'accept') {
      acceptanceWaitPump = async () => {
        if (inlineMonitorBusy) return;
        inlineMonitorBusy = true;
        try {
          const state = await inlineState();
          if (state && !state.acceptDisabled && !state.cancelDisabled) await resolveInline({ label: 'automatic inline confirmation' });
        } finally { inlineMonitorBusy = false; }
      };
    }
    const screenshot = async (name) => {
      await pause(200);
      const file = path.join(artifacts, name + '.png');
      const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(file, Buffer.from(result.data, 'base64'));
      summary.screenshots.push(file);
    };
    await screenshot('donor-workspace');
    if (process.argv.includes('--usability-only')) {
      const outer = await workspace('(()=>{const e=document.querySelector(".content");return{overflowY:window.getComputedStyle(e).overflowY,height:e.clientHeight,total:e.scrollHeight};})()');
      assert.equal(outer.overflowY, 'auto', 'the whole workbench content must scroll');
      assert.ok(outer.total > outer.height, 'sixteen SKU rows provide a natural outer scroll range');
      await workspace('document.querySelector(".content").scrollTop=0');
      const wheelPoint = await workspace('(()=>{const r=document.querySelector(".content").getBoundingClientRect();return{x:r.left+3,y:r.top+r.height/2};})()');
      const toolbarTop = await workspace('document.querySelector(".toolbar").getBoundingClientRect().top');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...wheelPoint });
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY: 350 });
      await until(() => workspace('document.querySelector(".content").scrollTop>0'), 'actual mouse wheel scrolls the complete workbench');
      assert.equal(await workspace('document.querySelector(".toolbar").getBoundingClientRect().top'), toolbarTop);
      await screenshot('usability-outer-scroll');
      assert.equal(await workspace('document.querySelector("input[name=image-workflow-mode][value=translate]").disabled'), false,
        'translation must have its own usable image workflow instead of a permanently disabled donor button');
      await click('input[name="image-workflow-mode"][value="translate"] + span');
      await until(() => workspace('document.getElementById("precision-translation-state").textContent.includes("请先创建")'), 'translation before draft shows prerequisite instead of throwing');
      assert.equal(await workspace('document.getElementById("image-workflow-start-btn").disabled'), true);
      assert.deepEqual(await workspace('parent.__precisionScriptErrors||[]'), []);
      await click('input[name="image-workflow-mode"][value="ai-suite"] + span');
    }
    await click(process.argv.includes('--ai-entry-flow')?'#precision-preparation-analysis-open':'#start-btn');
    await until(() => workspace('document.getElementById("sku-picker").hidden===false'), 'original donor SKU picker');
    assert.equal(await workspace('document.querySelectorAll(".sku-picker-item").length'), 16);
    assert.equal(await workspace('document.getElementById("sku-apply-btn").textContent.includes("s)")'), false, 'no automatic mutation countdown');
    await click('#sku-toggle-btn');
    await click('input[data-row-id="sku-1"]');
    await click('input[data-row-id="sku-7"]');
    if(STAGED_ANALYSIS)await click('input[data-row-id="sku-2"]');
    await screenshot('sku-selection');
    await click('#sku-apply-btn');
    await until(() => evaluate('window.__precisionCommands.some(command=>command.type==="CREATE_DRAFT")'), 'draft create command');
    if(process.argv.includes('--editor-read-recovery')){
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("设备草稿读取暂时不可用")'),'one failed read pauses at the actual failure');
      await pause(150);
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_READ").length'),1,'same binding does not render-loop reads');
      await click('#erp-refresh-btn');
      await until(()=>workspace('!document.getElementById("editor-save-btn").disabled&&document.getElementById("status-text").textContent.includes("已刷新")'),'explicit refresh restores the editable table');
      assert.equal(await workspace('document.querySelectorAll("tr[data-editor-row-index]").length'),2);
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_READ").length'),2,'explicit refresh sends exactly one new read');
      assert.equal(await evaluate('window.__precisionCommands.some(c=>["EDITOR_SAVE","PREPARATION_ANALYZE","EXECUTE_HOSTED_SUITE","PUBLISH"].includes(c.type))'),false);
      await screenshot('failed-editor-read-recovered');summary.editorReadRecovery={failedReads:1,recoveredReads:1,automaticLoop:false,editableRows:2,writeRequests:0};summary.ok=true;
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if(process.argv.includes('--draft-recovery-flow')){
      await until(()=>workspace('document.getElementById("status-text").textContent.includes("草稿回执")'),'unknown creation retains original recovery');
      await click('#precision-preparation-recover');
      await until(()=>workspace('document.getElementById("status-text").textContent.includes("已核对")'),'readonly draft recovery');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_DRAFT").length'),1);
      assert.ok(await evaluate('window.__precisionCommands.some(c=>c.type==="EDITOR_READ")'));
      await click('#start-btn');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("选择官方类目")'),'recovered draft continues without rebuilding');
      await screenshot('draft-readonly-recovery');summary.draftRecovery={readonly:true,createRequests:1,continued:true};summary.ok=true;
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    await until(() => workspace('document.getElementById("status-text").textContent.includes("草稿已就绪")'), 'draft readback');
    assert.equal(await workspace('document.querySelectorAll("tr[data-editor-row-index]").length'), STAGED_ANALYSIS?3:2);
    await until(() => workspace('document.querySelectorAll("[data-image-sku-key]").length==='+ (STAGED_ANALYSIS?3:2)), 'image workbench uses only selected draft SKUs');
    assert.deepEqual(await workspace('[...document.querySelectorAll("[data-image-sku-key]")].map(row=>row.dataset.imageSkuKey)'), STAGED_ANALYSIS?['sku-1','sku-2','sku-7']:['sku-1', 'sku-7']);
    assert.deepEqual(await workspace('[...document.querySelectorAll(".precision-source-tile")].map(tile=>tile.dataset.referenceKey)'), STAGED_ANALYSIS?['image-0','image-1','image-2','image-7',...Array.from({length:24},(_,index)=>'common-'+index)]:['image-0', 'image-1', 'image-7'], 'product-level and selected SKU media are eligible');
    assert.ok(await workspace('document.querySelector(".editor-table-spec").textContent.includes("颜色 1")'));
    assert.equal(await workspace('[...document.querySelectorAll(".editor-row-copy-btn")].some(button=>!button.disabled)'),true,'source SKU duplication is available in the same editor');
    await screenshot('selected-draft');
    await until(() => workspace('document.getElementById("editor-save-btn").disabled===false'), 'draft editor loaded');
    await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("选择官方类目")'), 'continuous preparation pauses at explicit official category review');
    if (process.argv.includes('--bounded-dialogs')) {
      const problems = [], windows = [];
      async function inspectDialog(id, name, closeSelector, bodySelector = '.settings-body') {
        for (const [width, height] of [[1920, 1080], [1280, 900], [390, 844]]) {
          await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
          await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const measurement = await workspace(`(()=>{
            const modal=document.getElementById(${JSON.stringify(id)}),dialog=modal.querySelector('.settings-dialog,.precision-image-dialog'),
              head=modal.querySelector('.settings-head,.precision-image-head'),body=modal.querySelector(${JSON.stringify(bodySelector)}),
              close=modal.querySelector(${JSON.stringify(closeSelector)}),foot=modal.querySelector('.settings-foot,.image-manager-foot');
            const rect=n=>n?.getBoundingClientRect().toJSON(),hit=n=>{const r=n.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===n||n.contains(e);};
            return {id:modal.id,viewport:{width:window.innerWidth,height:window.innerHeight},dialog:rect(dialog),head:rect(head),body:rect(body),foot:rect(foot),
              close:rect(close),closeReachable:hit(close),background:window.getComputedStyle(dialog).backgroundColor,
              pageWidth:document.documentElement.scrollWidth,visibleWindows:[...document.querySelectorAll('.settings-modal')].filter(e=>!e.hidden).map(e=>e.id),
              scrollTop:body.scrollTop,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight};})()`);
          windows.push({ name, ...measurement });
          await screenshot(`bounded-${name}-${width}`);
          const gutter = width > 620 ? 16 : 8;
          const { dialog, viewport } = measurement;
          if (dialog.x < gutter - 1 || dialog.y < gutter - 1 || dialog.right > viewport.width - gutter + 1 || dialog.bottom > viewport.height - gutter + 1)
            problems.push(`${name} at ${width}px covers the viewport instead of leaving a visible window boundary`);
          if (width > 620 && dialog.width > Math.min(1240, viewport.width - 2 * gutter) + 1)
            problems.push(`${name} at ${width}px has no desktop width bound`);
          if (measurement.background !== 'rgb(255, 255, 255)') problems.push(`${name} at ${width}px lets the editor show through the panel`);
          if (!measurement.closeReachable || measurement.close.bottom > viewport.height || measurement.close.y < 0)
            problems.push(`${name} at ${width}px hides or covers the close button`);
          if (measurement.foot && (measurement.foot.bottom > dialog.bottom + 1 || measurement.foot.top < dialog.top))
            problems.push(`${name} at ${width}px hides its confirmation footer`);
          if (measurement.pageWidth > viewport.width) problems.push(`${name} at ${width}px overflows the page horizontally`);
          if (measurement.visibleWindows.length !== 1) problems.push(`${name} at ${width}px stacks modal overlays`);
          if (bodySelector === '.settings-body' && measurement.scrollHeight > measurement.clientHeight + 50) {
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: measurement.body.x + 3,
              y: measurement.body.y + measurement.body.height / 2, deltaX: 0, deltaY: 300 });
            await until(() => workspace(`document.getElementById(${JSON.stringify(id)}).querySelector('.settings-body').scrollTop > ${measurement.scrollTop}`), 'dialog content scrolls independently');
            const after = await workspace(`document.getElementById(${JSON.stringify(id)}).querySelector('.settings-head').getBoundingClientRect().top`);
            assert.equal(after, measurement.head.top, 'scrolling content keeps the title and close button fixed');
            await workspace(`document.getElementById(${JSON.stringify(id)}).querySelector('.settings-body').scrollTop=0`);
          }
        }
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      }
      await until(() => workspace('document.querySelectorAll("#editor-category-modal .category-auto-card").length>0'), 'category recommendation cards');
      await inspectDialog('editor-category-modal', 'category', '.settings-head button', '.category-dialog__body');
      await click('#editor-category-modal .category-auto-card');
      await until(() => workspace('!document.querySelector("[data-category-confirm]").disabled'), 'category attribute preview');
      await click('[data-category-confirm]');
      await until(() => workspace('!document.getElementById("precision-attribute-suggestions-modal").hidden&&!document.getElementById("precision-attribute-suggestions-close").disabled'), 'automatic attribute preview');
      await inspectDialog('precision-attribute-suggestions-modal', 'attributes', '#precision-attribute-suggestions-close');
      await click('#precision-attribute-suggestions-close');
      await click('#precision-preparation-stop');
      await click('#pricing-tool-btn');
      await until(() => workspace('!document.getElementById("precision-pricing-modal").hidden'), 'pricing window');
      await inspectDialog('precision-pricing-modal', 'pricing', '#precision-pricing-close');
      await click('#precision-pricing-close');
      await click('#editor-copy-btn');
      await until(() => workspace('!document.getElementById("precision-copy-modal").hidden'), 'Russian copy window');
      await inspectDialog('precision-copy-modal', 'russian-copy', '#precision-copy-close');
      await click('#precision-copy-close');
      await click('#precision-preparation-analysis-open');
      await until(() => workspace('!document.getElementById("precision-preparation-analysis-modal").hidden'), 'AI preparation window');
      await inspectDialog('precision-preparation-analysis-modal', 'analysis', '#precision-preparation-analysis-close');
      await click('#precision-preparation-analysis-close');
      summary.boundedDialogs = { windows, problems, physicalClicks: true, viewportWidths: [1920, 1280, 390], actualContentScroll: true };
      summary.ok = problems.length === 0;
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify({ ok: summary.ok, artifacts, problems, providerRequests: 0, ozonRequests: 0 }, null, 2));
      assert.deepEqual(problems, [], 'subwindows stay opaque, bounded, scrollable and operable');
      return;
    }
    if (process.argv.includes('--source-media-display')) {
      await click('#editor-category-modal .settings-head button');
      const priceSelector = 'input[data-row-index="1"][data-field-key="价格，CNY"]';
      await click(priceSelector);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await send('Input.insertText', { text: '37.25' });
      const before = await evaluate('JSON.stringify(window.__precisionCommands)');
      await evaluate('window.__precisionInstallSourceDisplayBridge()');
      await until(() => evaluate('window.__precisionSourceDisplayReads?.some(request=>request.type==="ss-erp:source-listing-workbench-status")'), 'real bridge reads pending source transfer');
      assert.equal(await workspace('document.querySelector(' + JSON.stringify(priceSelector) + ').value'), '37.25');
      await evaluate('window.__precisionCompleteSourceTransfer()');
      await until(() => workspace('[...document.querySelectorAll(".precision-source-tile img")].every(image=>image.src.includes("/stored-")&&image.complete&&image.naturalWidth===128)'), 'real bridge automatically replaces and decodes stored source images');
      assert.equal(await workspace('document.querySelector(' + JSON.stringify(priceSelector) + ').value'), '37.25', 'automatic source display refresh preserves unsaved pricing');
      assert.equal(await workspace('document.querySelectorAll("tr[data-editor-row-index]").length'), 2);
      assert.ok(await workspace('[...document.querySelectorAll("[data-image-sku-key] img")].every(image=>image.src.includes("/stored-")&&image.crossOrigin==="anonymous")'));
      assert.ok(await workspace('[...document.querySelectorAll(".editor-table-image img")].every(image=>image.src.includes("/stored-")&&image.crossOrigin==="anonymous")'));
      assert.equal(await evaluate('JSON.stringify(window.__precisionCommands)'), before, 'source polling never emits an editor save or new frame command');
      assert.ok(await evaluate('window.__precisionSourceDisplayReads.every(request=>["spb-self-hosted:get-ozon-shops","ss-erp:source-listing-workbench-status"].includes(request.type))'));
      await screenshot('source-images-auto-internalized');
      summary.sourceMediaDisplay = { actualBridgePolling: true, imageDecoded: true, unsavedPrice: '37.25',
        selectedSkuRows: 2, sourceGalleryAndSkuAndEditor: true, providerWrites: 0, ozonWrites: 0, databaseWrites: 0 };
      summary.ok = true;
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2)); return;
    }
    if(process.argv.includes('--process-category-recovery')){
      await click('#editor-category-modal .settings-head button');await click('#process-view-btn');
      await until(()=>workspace('!document.getElementById("process-modal").hidden'),'same-window process view');
      assert.equal(await workspace('document.getElementById("precision-process-continue").textContent'),'确认官方类目并继续');
      const style=await workspace('(()=>{const keys=["borderRadius","fontFamily","fontSize","lineHeight"];return ["start-btn","precision-process-continue"].map(id=>Object.fromEntries(keys.map(key=>[key,getComputedStyle(document.getElementById(id))[key]])));})()');
      assert.deepEqual(style[0],style[1],'process and toolbar primary buttons use the same typography and shape');
      await screenshot('process-current-category');await click('#precision-process-continue');
      await until(()=>workspace('!document.getElementById("editor-category-modal").hidden&&document.querySelectorAll(".category-auto-card").length>0'),'process action reopens the current category');
      await click('.category-auto-card');await until(()=>workspace('!document.querySelector("[data-category-confirm]").disabled'),'official category preview');
      assert.equal(await workspace('document.querySelector("[data-category-confirm]").textContent'),'确认类目并继续');
      await screenshot('category-confirm-and-continue');await click('[data-category-confirm]');
      await until(()=>workspace('!document.getElementById("precision-attribute-suggestions-modal").hidden&&!document.getElementById("precision-attribute-suggestions-manual").disabled'),'category save proceeds to attributes without manual refresh');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_SAVE"&&c.action==="CATEGORY").length'),1);
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_DRAFT").length'),1);
      assert.equal(await evaluate('window.__precisionCommands.some(c=>["PREPARATION_ANALYZE","EXECUTE_HOSTED_SUITE","PUBLISH"].includes(c.type))'),false);
      summary.categoryContinuation={processAction:true,unifiedButtons:true,savedOnce:true,automaticAttributes:true,responseBeforeProjection:process.argv.includes('--category-refresh-race')};summary.ok=true;
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if(process.argv.includes('--sku-copy-flow')){
      await click('#editor-category-modal .settings-head button');await click('#precision-preparation-stop');
      await click('.editor-row-copy-btn[data-row-index="1"]');
      await until(()=>workspace('document.getElementById("status-text").textContent.includes("复制 SKU 回执")'),'unknown copy requires original replay');
      assert.equal(await workspace('document.getElementById("editor-replay-btn").hidden'),false);
      await click('#editor-replay-btn');await until(()=>workspace('document.querySelectorAll("tr[data-editor-row-index]").length===3'),'copy appears after original receipt');
      await until(()=>evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_SAVE"&&c.action==="SKU_DUPLICATE").length===2'),'original copy replay dispatch');
      await until(()=>workspace('document.getElementById("editor-replay-btn").hidden&&!document.getElementById("editor-save-btn").disabled'),'copy replay confirmed');
      const requests=await evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_SAVE"&&c.action==="SKU_DUPLICATE")');
      assert.equal(requests.length,2);assert.equal(requests[0].operationKey,requests[1].operationKey);
      assert.equal(await workspace('document.querySelectorAll(".editor-row-copy-btn")[2].textContent'),'移除副本');
      await until(()=>workspace('document.querySelectorAll("[data-image-sku-key]").length===3'),'copied row participates in image management');
      const replace=async(selector,text)=>{await click(selector);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text});};
      for(const row of [1,2,3]){await replace(`input[data-row-index="${row}"][data-field-key="价格，CNY"]`,String(30+row));await replace(`input[data-row-index="${row}"][data-field-key="折扣前价格，CNY"]`,String(50+row));}
      await click('#editor-save-btn');await until(()=>workspace('document.getElementById("status-text").textContent.includes("保存价格")'),'independent prices saved');
      const prices=await evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_SAVE"&&c.action==="PRICING").at(-1).value.items');
      assert.equal(prices.length,3);assert.equal(new Set(prices.map(row=>row.offerId)).size,3);assert.equal(prices[2].price,'33');
      for(const row of [1,2,3])for(const[field,value]of [['毛重，克',String(300+row)],['包装长度，毫米','140'],['包装宽度，毫米','80'],['包装高度，毫米','60']])await replace(`input[data-row-index="${row}"][data-field-key="${field}"]`,value);
      await click('#editor-packaging-save-btn');await until(()=>workspace('document.getElementById("status-text").textContent.includes("保存包装")'),'independent packaging saved');
      const packages=await evaluate('window.__precisionCommands.filter(c=>c.type==="EDITOR_SAVE"&&c.action==="PACKAGING").at(-1).value.items');assert.equal(packages.length,3);assert.equal(packages[2].weightG,303);
      await click('[data-image-sku-key="listing-copy:'+'a'.repeat(64)+'"]');
      await until(()=>workspace('!document.getElementById("precision-image-manager").hidden'),'same-window copy images');
      await screenshot('independent-sku-copy');
      await click('#precision-image-close');
      await click('.editor-row-copy-btn[data-row-index="3"]');
      await until(()=>workspace('document.querySelectorAll("tr[data-editor-row-index]").length===2'),'copy removal preserves source rows');
      await until(()=>workspace('document.querySelectorAll("[data-image-sku-key]").length===2'),'removed copy image row disappears');
      assert.deepEqual(await workspace('[...document.querySelectorAll("[data-image-sku-key]")].map(row=>row.dataset.imageSkuKey)'),['sku-1','sku-7']);
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_DRAFT").length'),1);
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="PUBLISH")'),false);
      summary.skuCopy={originalReplay:true,sourceIdentityUnchanged:true,independentPriceAndPackaging:true,imageRow:true,removeCopyOnly:true,automaticPublish:false};summary.ok=true;
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if(process.argv.includes('--empty-attributes-flow')){
      await until(()=>workspace('document.querySelectorAll(".category-auto-card").length>0'),'category loaded');await click('.category-auto-card');
      await until(()=>workspace('!document.querySelector("[data-category-confirm]").disabled'),'category ready');await click('[data-category-confirm]');
      await until(()=>workspace('!document.getElementById("precision-attribute-suggestions-modal").hidden&&!document.getElementById("precision-attribute-suggestions-manual").disabled'),'empty suggestions show manual continuation');
      assert.equal(await workspace('document.getElementById("precision-attribute-suggestions-apply").disabled'),true);
      await click('#precision-attribute-suggestions-manual');await click('#precision-preparation-continue');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("包装")'),'manual attribute path reaches next input');
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="EDITOR_SAVE"&&c.action==="ATTRIBUTE_SUGGESTIONS")'),false);
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="PUBLISH")'),false);
      await screenshot('empty-attributes-manual');summary.emptyAttributes={explicitManual:true,noMutation:true,continues:true};summary.ok=true;
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if(STAGED_ANALYSIS){
      summary.scope='LOCAL_STAGED_ANALYSIS_BROWSER_FIXTURE';
      summary.modelEvidence='Synthetic stage responses only; no real model quality or production acceptance is claimed.';
      const stages=()=>workspace('[...document.querySelectorAll("#precision-preparation-analysis-stages [data-analysis-phase]")].map(row=>({stage:row.dataset.analysisPhase,status:row.dataset.stageStatus,message:row.lastElementChild.textContent}))');
      const requests=sku=>evaluate('window.__precisionCommands.filter(c=>c.type==="PREPARATION_ANALYZE"&&c.skuKey==='+JSON.stringify(sku)+')');
      await until(()=>workspace('document.querySelectorAll(".category-auto-card").length>0'),'staged preparation category recommendations');
      await click('.category-auto-card');await until(()=>workspace('!document.querySelector("[data-category-confirm]").disabled'),'staged category ready');await click('[data-category-confirm]');
      await until(()=>workspace('document.querySelector("[data-analysis-phase=CURATION]")?.dataset.stageStatus==="COMPLETE"&&document.querySelector("[data-analysis-phase=VISION]")?.dataset.stageStatus==="RUNNING"'),'curation is visible while the distinct vision request waits');
      assert.equal(await workspace('document.querySelectorAll("#precision-preparation-curation input[data-analysis-source]").length'),24,'hosted analysis includes 24 available candidates by default');
      assert.equal((await requests('sku-1'))[0].sourceMediaKeys.length,24);
      await until(()=>workspace('/[1-9][0-9]* 秒/.test(document.getElementById("precision-preparation-analysis-state").textContent)'),'actual waiting heartbeat advances without fictional percent');
      assert.equal(await workspace('document.getElementById("precision-preparation-analysis-state").textContent.includes("%")'),false);
      assert.equal(await workspace('document.getElementById("precision-preparation-copy-title").disabled'),true,'copy output is not invented before its stage');
      await screenshot('staged-curation-complete-vision-waiting');
      await evaluate('window.__precisionReleaseStagedVision()');
      await until(()=>workspace('document.querySelector("[data-analysis-phase=COPY]")?.dataset.stageStatus==="COMPLETE"&&!document.getElementById("precision-preparation-copy-title").disabled'),'three-stage success produces editable candidates');
      assert.deepEqual((await requests('sku-1')).map(row=>row.stage),['CURATION','VISION','COPY']);
      assert.equal(new Set((await requests('sku-1')).map(row=>row.operationKey)).size,1,'the success chain has one frozen root operation');
      assert.ok((await stages()).every(row=>row.status==='COMPLETE'));
      assert.match((await stages()).find(row=>row.stage==='VISION').message,/8 张/,'vision UI presents the actual bounded reference count');
      await screenshot('staged-analysis-success');
      async function startNextSku(sku){
        await click('#precision-preparation-analysis-close');await click('#precision-preparation-stop');
        await click('[data-image-sku-key="'+sku+'"]');await until(()=>workspace('!document.getElementById("precision-image-manager").hidden'),'next SKU selected in original image table');
        await click('#precision-image-close');await click('#start-btn');
      }
      await startNextSku('sku-7');
      await until(()=>workspace('document.querySelector("[data-analysis-phase=VISION]")?.dataset.stageStatus==="RECOVERY_REQUIRED"&&!document.getElementById("precision-preparation-analysis-recover").disabled'),'lost vision response retains completed curation and exact stage recovery');
      assert.deepEqual((await stages()).map(row=>row.status),['COMPLETE','RECOVERY_REQUIRED','PENDING']);
      assert.equal((await requests('sku-7')).length,2,'unknown vision blocks the not-yet-started copy stage');
      const originalVision=(await requests('sku-7')).find(row=>row.stage==='VISION');
      await screenshot('staged-vision-original-recovery');await click('#precision-preparation-analysis-recover');
      await until(()=>workspace('document.querySelector("[data-analysis-phase=COPY]")?.dataset.stageStatus==="COMPLETE"'),'original vision readback proceeds to the first copy request');
      const recoveredRead=await evaluate('window.__precisionCommands.filter(c=>c.type==="PREPARATION_READ"&&c.skuKey==="sku-7")');
      assert.equal(recoveredRead.length,1);assert.equal(recoveredRead[0].stage,'VISION');assert.equal(recoveredRead[0].operationKey,originalVision.operationKey);
      assert.deepEqual(recoveredRead[0].binding,originalVision.binding);assert.deepEqual(recoveredRead[0].sourceMediaKeys,originalVision.sourceMediaKeys);
      assert.deepEqual((await requests('sku-7')).map(row=>row.stage),['CURATION','VISION','COPY'],'the original vision model request is not resent');
      await screenshot('staged-vision-readonly-recovered');
      await startNextSku('sku-2');
      await until(()=>workspace('document.querySelector("[data-analysis-phase=COPY]")?.dataset.stageStatus==="RECOVERY_REQUIRED"&&!document.getElementById("precision-preparation-analysis-manual").disabled'),'unknown copy preserves curation and visual results and exposes manual continuation');
      assert.deepEqual((await stages()).map(row=>row.status),['COMPLETE','COMPLETE','RECOVERY_REQUIRED']);
      assert.ok(await workspace('document.getElementById("precision-preparation-visual-json").value.includes("浅灰背景")'));
      const submitsBefore=await evaluate('window.__precisionSimulatedModelSubmits.length');
      await screenshot('staged-copy-unknown-with-partial-results');await click('#precision-preparation-analysis-manual');
      await until(()=>workspace('document.querySelector("#precision-preparation-process [data-preparation-step=analysis]")?.dataset.stageStatus==="SKIPPED"'),'manual continuation marks the AI step skipped, never completed');
      await until(()=>workspace('!document.getElementById("precision-attribute-suggestions-modal").hidden&&!document.getElementById("precision-attribute-suggestions-manual").disabled'),'manual field preparation remains available in the same workbench');
      await click('#precision-attribute-suggestions-manual');await click('#precision-preparation-continue');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("包装")'),'manual editing proceeds to actual missing packaging');
      await click('input[data-row-index="1"][data-field-key="毛重，克"]');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:'350'});
      assert.equal(await workspace('document.querySelector('+JSON.stringify('input[data-row-index="1"][data-field-key="毛重，克"]')+').value'),'350','manual product fields remain editable without changing unknown AI authority');
      assert.equal(await evaluate('window.__precisionSimulatedModelSubmits.length'),submitsBefore,'manual continuation issues no additional simulated provider submit');
      await screenshot('staged-manual-fields-ai-skipped');
      await click('#precision-preparation-stop');await click('#precision-preparation-analysis-open');
      await until(()=>workspace('document.getElementById("precision-preparation-analysis-state").textContent.includes("待核对")&&!document.getElementById("precision-preparation-analysis-recover").hidden'),'original unknown copy remains independently available after manual editing');
      assert.equal(await workspace('document.getElementById("precision-preparation-analysis-start").hidden'),true);
      const privateCheckpoint=await evaluate('[...window.__precisionCheckpoints.values()].find(c=>c.context.skuKey==="sku-2")');
      assert.equal(privateCheckpoint.manuallyContinued,true);assert.equal(privateCheckpoint.operation.stage,'COPY');assert.equal(privateCheckpoint.receipt,null);
      assert.ok(privateCheckpoint.stageResults.CURATION&&privateCheckpoint.stageResults.VISION);assert.equal(privateCheckpoint.stageResults.COPY,undefined);
      assert.equal((await requests('sku-2')).length,3);
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="PUBLISH"||c.type==="EXECUTE_HOSTED_SUITE")'),false);
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      summary.stagedAnalysis={fixtureOnly:true,physicalClicks:true,candidateImages:24,visionImages:8,successfulStageRequests:3,
        partialResultsDuringVision:true,realElapsedHeartbeat:true,readonlyVisionRecovery:true,visionPostRetries:0,unknownCopyManualContinuation:true,
        aiStepStatusAfterManual:'SKIPPED',manualFieldsEditable:true,unknownOperationRetained:true,simulatedModelSubmits:submitsBefore,
        additionalModelSubmitsAfterManual:0,automaticPublish:false};summary.ok=true;
      await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if(process.argv.includes('--preparation-analysis')){
      await evaluate('window.__precisionLosePreparationReply=true');
      await until(()=>workspace('document.querySelectorAll(".category-auto-card").length>0'),'AI preparation category recommendations');
      await click('.category-auto-card');await until(()=>workspace('!document.querySelector("[data-category-confirm]").disabled'),'AI preparation category ready');await click('[data-category-confirm]');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("核对原操作")'),'unknown analysis blocks the preparation queue');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="PREPARATION_ANALYZE").length'),1);
      await click('#precision-preparation-analysis-open');await until(()=>workspace('!document.getElementById("precision-preparation-analysis-recover").disabled'),'same-window original analysis recovery');
      await screenshot('unknown-analysis-recovery');
      await click('#precision-preparation-analysis-recover');
      await until(()=>workspace('document.querySelectorAll("[data-analysis-phase]").length===4&&!document.getElementById("precision-preparation-copy-title").disabled'),'one receipt projects curation visual and editable copy');
      assert.equal(await workspace('document.getElementById("precision-preparation-copy-title").value'),'Товар для дома');
      assert.equal(await workspace('document.getElementById("precision-preparation-copy-approve").disabled'),true,'unpersisted model output is not approved');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="PREPARATION_ANALYZE").length'),1);
      const original=await evaluate('window.__precisionCommands.find(c=>c.type==="PREPARATION_ANALYZE")');
      const recovery=await evaluate('window.__precisionCommands.find(c=>c.type==="PREPARATION_READ")');assert.equal(recovery.operationKey,original.operationKey);
      await screenshot('continuous-ai-candidates');
      await click('#precision-preparation-attributes input');await click('#precision-preparation-attributes-apply');
      await until(()=>evaluate('window.__precisionCommands.filter(c=>c.type==="PREPARATION_APPLY").length===1'),'explicit AI attribute evidence application');
      await until(()=>workspace('document.getElementById("precision-preparation-analysis-state").textContent.includes("本次分析生成")'),'attribute authority readback complete');
      await click('#precision-preparation-copy-title');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text:'Мой проверенный товар'});
      await evaluate('window.__precisionLoseNextCopyReply=true');await click('#precision-preparation-copy-save');
      await until(()=>workspace('!document.getElementById("precision-preparation-save-recover").hidden&&!document.getElementById("editor-replay-btn").hidden'),'unknown candidate save keeps durable original request');
      await evaluate('document.getElementById("workspace").contentWindow.location.reload()');
      await until(()=>workspace('!!document.getElementById("precision-preparation-analysis-open")'),'workbench iframe restored');
      await until(()=>workspace('document.getElementById("editor-save-btn")?.disabled===false'),'restored draft authority readback');
      await click('#precision-preparation-analysis-open');
      await until(()=>workspace('document.getElementById("precision-preparation-save-recover")?.hidden===false&&document.getElementById("precision-preparation-save-recover")?.disabled===false'),'candidate checkpoint restored after iframe reload');
      assert.equal(await workspace('document.getElementById("precision-preparation-copy-title").value'),'Мой проверенный товар');
      await click('#precision-preparation-save-recover');
      await until(()=>workspace('!document.getElementById("precision-preparation-copy-approve").disabled'),'exact idempotent saved copy recovered');
      await click('#precision-preparation-copy-approve');
      await until(()=>evaluate('window.__precisionCommands.some(c=>c.type==="EDITOR_SAVE"&&c.action==="COPY_APPROVE")'),'explicit same-window copy review');
      await until(()=>workspace('!document.getElementById("precision-preparation-visual-apply").disabled'),'copy review authority refreshed');
      await click('#precision-preparation-analysis-modal details summary');
      await click('#precision-preparation-visual-json');
      await click('#precision-preparation-visual-apply');
      await until(()=>workspace('document.getElementById("precision-prompt-text").value.includes("浅灰背景")'),'visual candidate compiles editable direction');
      await click('#precision-preparation-curation-confirm');
      await until(()=>workspace('document.getElementById("precision-preparation-analysis-modal").hidden'),'curation review returns same workbench');
      await click('#settings-btn');await until(()=>workspace('!!document.getElementById("precision-preparation-mode")'),'simplified AI settings');
      assert.equal(await workspace('document.querySelector(".precision-preparation-diagnostics").open'),false,'internal diagnostics collapsed');
      await screenshot('simplified-ai-settings');
      const setSelect=async(id,value)=>workspace('(()=>{const input=document.getElementById('+JSON.stringify(id)+');input.value='+JSON.stringify(value)+';input.dispatchEvent(new window.Event("change",{bubbles:true}));})()');
      const replace=async(selector,text)=>{await click(selector);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text});};
      await setSelect('precision-preparation-mode','BYOK');await click('#precision-preparation-configure-api');
      await until(()=>workspace('!document.getElementById("precision-byok-config-modal").hidden'),'unified settings opens existing private API profile editor');
      await replace('#precision-byok-name','商品分析测试接口');await replace('#precision-byok-endpoint','https://provider.ss-erp-fixture.invalid/v1');await replace('#precision-byok-model','image-model-fixture');
      await click('#precision-byok-save-profile');await until(()=>workspace('!document.getElementById("precision-byok-set-key").disabled'),'profile saved in existing owner');
      await replace('#precision-byok-key','ss-erp-fixture-private-secret-sentinel');await click('#precision-byok-set-key');
      await until(()=>workspace('document.getElementById("precision-byok-config-state").textContent.includes("密钥已加载")'),'private session key loaded');
      await click('#precision-byok-config-close');await click('[data-close-modal="basic-modal"]');await click('#settings-btn');
      await until(()=>workspace('document.querySelectorAll("#precision-preparation-analysis-profile option").length===1'),'unified named API profiles refreshed');
      await setSelect('precision-preparation-analysis-model','qwen-vl-max');
      await until(()=>workspace('document.getElementById("precision-preparation-analysis-permission")?.hidden===false&&document.getElementById("precision-preparation-analysis-permission")?.disabled===false'),'cached exact analysis origin permission ticket prepared');
      await click('#precision-preparation-analysis-permission');
      await until(()=>workspace('document.getElementById("precision-preparation-analysis-readiness").textContent.includes("由你的 API 服务计费")'),'trusted origin authorization restores analysis readiness');
      assert.ok(await evaluate('window.__precisionPrivateCalls.some(call=>call.type==="permissions.request"&&call.trusted===true&&call.payload.origins[0]==="https://provider.ss-erp-fixture.invalid/*")'),'Chrome permission requested synchronously from trusted activation');
      assert.ok(await evaluate('window.__precisionPrivateCalls.some(call=>call.type==="ss-erp:product-analysis-permission-commit"&&call.payload.analysisModel==="qwen-vl-max")'),'analysis model permission uses separate explicitly selected model');
      assert.equal(JSON.stringify(await evaluate('window.__precisionCommands')).includes('ss-erp-fixture-private-secret-sentinel'),false,'private key never crosses source-page messages');
      await screenshot('byok-analysis-settings');
      const requests=await evaluate('window.__precisionCommands');
      const copySaves=requests.filter(c=>c.type==='EDITOR_SAVE'&&c.action==='COPY_CANDIDATE');assert.equal(copySaves.length,2);assert.equal(copySaves[0].operationKey,copySaves[1].operationKey);
      assert.equal(requests.filter(c=>c.type==='PREPARATION_ANALYZE').length,1,'reload and review never resend model analysis');
      assert.equal(requests.some(c=>c.type==='PUBLISH'),false);assert.equal(requests.some(c=>c.type==='EXECUTE_HOSTED_SUITE'),false);
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      summary.preparationAnalysis={oneModelReceipt:true,readOnlyUnknownRecovery:true,editableRussianCandidates:true,explicitAIAttributeEvidence:true,durableReloadRecovery:true,exactCopyReplay:true,sameWindowReview:true,localCuration:true,collapsedDiagnostics:true,byokAnalysisModelSelection:true,trustedOriginPermission:true,privateKeySeparation:true,automaticPublish:false};summary.ok=true;
      await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if(!process.argv.includes('--complete-preparation-flow')){
      await click('#editor-category-modal .settings-head button');
      await click('#precision-preparation-stop');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("已停止")'),'explicit manual editing exits preparation queue');
    }
    if(process.argv.includes('--complete-preparation-flow')){
      const replace=async(selector,text)=>{await click(selector);assert.equal(await workspace('document.activeElement.matches('+JSON.stringify(selector)+')'),true);await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await send('Input.insertText',{text});};
      await until(()=>workspace('document.querySelectorAll(".category-auto-card").length>0'),'category recommendations loaded');
      await click('.category-auto-card');
      await until(()=>workspace('!document.querySelector("[data-category-confirm]").disabled'),'explicit category preview');await click('[data-category-confirm]');
      await until(()=>workspace('!document.getElementById("precision-attribute-suggestions-modal").hidden&&!document.getElementById("precision-attribute-suggestions-apply").disabled'),'automatically opened attribute candidates');
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="EDITOR_SAVE"&&c.action==="ATTRIBUTE_SUGGESTIONS")'),false);
      await screenshot('source-attribute-candidates');await evaluate('window.__precisionFailNextAttributeRead=true');await click('#precision-attribute-suggestions-apply');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("包装")'),'continuous packaging prerequisite');
      assert.match(await workspace('document.getElementById("status-text").textContent'),/已保存.*刷新/);
      assert.equal(await workspace('document.getElementById("editor-replay-btn").hidden'),true,'readback failure never becomes unknown save');
      for(const row of [1,2])for(const[field,value]of [['毛重，克','350'],['包装长度，毫米','140'],['包装宽度，毫米','80'],['包装高度，毫米','60']])await replace(`input[data-row-index="${row}"][data-field-key="${field}"]`,value);
      await click('#editor-packaging-save-btn');
      await until(()=>workspace('!document.getElementById("precision-pricing-modal").hidden'),'pricing automatically continues');
      await replace('#precision-pricing-commissionPct','10');await replace('#precision-pricing-discountPct','0');
      await click('#precision-pricing-logistics');await until(()=>workspace('document.querySelectorAll("#precision-logistics-scope option").length===2'),'current-shop routes');
      await workspace('(()=>{const n=document.getElementById("precision-logistics-scope");n.value="0";n.dispatchEvent(new window.Event("change",{bubbles:true}));})()');await click('#precision-logistics-read');
      await until(()=>workspace('document.querySelectorAll("#precision-logistics-service option").length===2'),'authorized services');
      await workspace('(()=>{for(const[id,value]of [["precision-logistics-service","service-fixture"],["precision-logistics-battery","no"]]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new window.Event("change",{bubbles:true}));}})()');
      await click('#precision-logistics-quote');await until(()=>workspace('document.getElementById("precision-logistics-state").textContent.includes("价档核验")'),'shipping and sale-price stable band');
      await screenshot('authorized-logistics-pricing');await click('#precision-logistics-close');await click('#precision-pricing-preview');
      assert.equal(await workspace('document.getElementById("precision-pricing-apply").disabled'),false);
      await replace('#precision-pricing-commissionPct','11');
      assert.equal(await workspace('document.getElementById("precision-pricing-apply").disabled'),true,'fee change invalidates sale preview');
      assert.equal(await workspace('document.querySelectorAll("#precision-pricing-modal input[data-pricing-field=shipping]").length'),2);
      assert.ok(await workspace('[...document.querySelectorAll("#precision-pricing-modal input[data-pricing-field=shipping]")].every(input=>input.value==="")'),'fee change discards automatic freight');
      await replace('#precision-pricing-commissionPct','10');
      await click('#precision-pricing-logistics');await until(()=>workspace('document.querySelectorAll("#precision-logistics-scope option").length===2'),'new route read');
      await workspace('(()=>{const n=document.getElementById("precision-logistics-scope");n.value="0";n.dispatchEvent(new window.Event("change",{bubbles:true}));})()');await click('#precision-logistics-read');
      await until(()=>workspace('document.querySelectorAll("#precision-logistics-service option").length===2'),'new service read');
      await workspace('(()=>{for(const[id,value]of [["precision-logistics-service","service-fixture"],["precision-logistics-battery","no"]]){const n=document.getElementById(id);n.value=value;n.dispatchEvent(new window.Event("change",{bubbles:true}));}})()');
      await click('#precision-logistics-quote');await until(()=>workspace('document.getElementById("precision-logistics-state").textContent.includes("价档核验")'),'requoted changed fees');
      await click('#precision-logistics-close');await click('#precision-pricing-preview');await click('#precision-pricing-apply');
      await click('#editor-save-btn');await until(()=>workspace('!document.getElementById("precision-copy-modal").hidden&&!document.getElementById("precision-copy-generate").disabled'),'copy next action same-window');
      await click('#precision-copy-generate');await until(()=>workspace('!document.getElementById("precision-copy-approve").disabled'),'pending copy review');await click('#precision-copy-approve');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("图片")'),'explicit media review gate');
      await click('#precision-copy-close');await evaluate('window.__precisionExistingReviewedMedia()');
      await until(()=>workspace('!document.getElementById("editor-save-btn").disabled'),'reviewed-media readback');await click('#precision-preparation-continue');
      await until(()=>workspace('document.getElementById("precision-preparation-state").textContent.includes("准备已完成")'),'complete preparation chain');
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="PUBLISH")'),false,'complete preparation never publishes automatically');
      const quotes=await evaluate('window.__precisionCommands.filter(c=>c.type==="LOGISTICS_QUOTE")');assert.equal(quotes.length,4);assert.deepEqual(quotes.at(-1).items.map(i=>i.declaredPriceMinor),[2000,2000]);
      await screenshot('continuous-preparation-complete');assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      await click('#precision-preparation-shops');await until(()=>workspace('!document.getElementById("precision-preparation-shop-modal").hidden'),'multi-shop queue dialog');
      await click('#precision-preparation-shop-modal input[value="other-fixture"]');await click('#precision-preparation-queue-start');
      await until(()=>workspace('!document.getElementById("sku-picker").hidden'),'next authorized shop source-SKU selection');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_DRAFT").length'),1,'second-shop mutation waits for explicit SKU choice');
      await click('#sku-toggle-btn');await click('input[data-row-id="sku-1"]');await click('input[data-row-id="sku-7"]');await click('#sku-apply-btn');
      await until(()=>evaluate('window.__precisionCommands.some(c=>c.type==="CREATE_DRAFT"&&c.shopId==="other-fixture")'),'same-window next-shop draft');
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="PUBLISH")'),false);
      await screenshot('multi-shop-next-draft');
      summary.preparation={automaticAttributes:true,sourceProvenance:true,scopeBoundLogistics:true,priceBandVerified:true,continuousSteps:true,explicitCopyAndMediaReview:true,automaticPublish:false};summary.ok=true;await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if (process.argv.includes('--vision-sku-flow')) {
      await click('#precision-sku-selection');
      await until(() => workspace('!document.getElementById("sku-picker").hidden'), 'adjust SKU in original picker');
      assert.deepEqual(await workspace('[...document.querySelectorAll("#sku-picker input:checked")].map(input=>input.dataset.rowId)'), ['sku-1','sku-7']);
      await click('input[data-row-id="sku-7"]'); await click('input[data-row-id="sku-2"]');
      await screenshot('sku-adjustment'); await click('#sku-apply-btn');
      await until(() => workspace('document.getElementById("status-text").textContent.includes("SKU 已调整")'), 'updated same draft SKU selection');
      const selection = await evaluate('window.__precisionCommands.find(command=>command.type==="EDITOR_SAVE"&&command.action==="SKU_SELECTION")');
      assert.deepEqual(selection.value.selectedSkuKeys, ['sku-1','sku-2']);
      await until(() => workspace('document.querySelectorAll("[data-image-sku-key]").length===2'), 'new image row scope');
      assert.deepEqual(await workspace('[...document.querySelectorAll("[data-image-sku-key]")].map(row=>row.dataset.imageSkuKey)'), ['sku-1','sku-2']);
      await until(() => workspace('!document.getElementById("precision-sku-selection").disabled'), 'SKU selection save and refresh are complete');
      await click('[data-image-sku-key="sku-1"]');
      await click('#precision-image-sources');
      await workspace('document.querySelector("#precision-vision-open").scrollIntoView({block:"center",behavior:"instant"})');
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const hit = await workspace('(()=>{const n=document.getElementById("precision-vision-open"),r=n.getBoundingClientRect();return{visible:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.id,disabled:n.disabled}})()');
      assert.equal(hit.visible, 'precision-vision-open'); assert.equal(hit.disabled, false);
      await click('#precision-vision-open');
      await until(() => workspace('!document.getElementById("precision-vision-modal").hidden&&!document.getElementById("precision-vision-start").disabled'), 'vision capability admitted');
      assert.equal(await workspace('document.querySelectorAll("#precision-vision-modal input").length'), 2, 'only current SKU and shared source media are offered');
      await evaluate('window.__precisionLoseNextVisionReply=true'); await click('#precision-vision-start');
      await until(() => workspace('!document.getElementById("precision-vision-recover").hidden'), 'unknown vision keeps original recovery');
      await click('#precision-vision-recover');
      await until(() => workspace('!document.getElementById("precision-vision-apply").disabled'), 'readback visual JSON before application');
      assert.equal(await workspace('document.getElementById("status-text").textContent.includes("看图分析完成")'),true, 'successful recovery replaces the earlier missing-receipt error');
      await screenshot('vision-json-result');
      const visions = await evaluate('window.__precisionCommands.filter(command=>command.type==="VISION_ANALYZE")');
      assert.equal(visions.length,2); assert.equal(visions[0].operationKey,visions[1].operationKey);
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE")'), false);
      await click('#precision-vision-apply');
      assert.equal(await workspace('document.getElementById("precision-visual-json").value.includes("提手")'),true);
      assert.equal(await workspace('document.getElementById("precision-prompt-text").value.includes("浅灰背景")'),true);
      await click('#precision-vision-open');
      await until(() => workspace('!document.getElementById("precision-vision-start").disabled'), 'second vision visible');
      await evaluate('window.__precisionAdvanceDuringVision=true'); await click('#precision-vision-start');
      await until(() => workspace('document.getElementById("precision-vision-state").textContent.includes("已变化")'), 'late visual result does not overwrite changed draft');
      assert.equal(await workspace('document.getElementById("precision-vision-apply").disabled'),true);
      await click('#precision-vision-close');
      await evaluate('window.__precisionVisionDisabled=true');
      await until(() => workspace('!document.getElementById("editor-save-btn").disabled'), 'fresh draft editor read');
      await click('#precision-vision-open');
      await until(() => workspace('document.getElementById("precision-vision-state").textContent.includes("未启用")'), 'disabled vision stays manual');
      assert.equal(await workspace('document.getElementById("precision-vision-start").disabled'),true);
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="PUBLISH")'),false);
      assert.deepEqual(summary.pageErrors,[]);assert.deepEqual(summary.blockedRequests,[]);
      summary.skuAdjustment={sameDraft:true,selection:['sku-1','sku-2'],sourceOnly:true};
      summary.vision={editableJson:true,promptApplied:true,sameKeyRecovery:true,staleResultRejected:true,unavailableStaysManual:true};
      summary.ok=true;await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
    }
    if (process.argv.includes('--pricing-copy-flow')) {
      const replace = async (selector, text) => {
        await click(selector);
        assert.equal(await workspace('document.activeElement.matches(' + JSON.stringify(selector) + ')'), true, 'physical input focuses ' + selector);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await send('Input.insertText', { text });
        assert.equal(await workspace('document.querySelector(' + JSON.stringify(selector) + ').value'), text);
      };
      await click('#pricing-tool-btn');
      await until(() => workspace('!document.getElementById("precision-pricing-modal").hidden'), 'same-window pricing tool');
      assert.equal(await workspace('document.querySelectorAll("[data-pricing-field=cost]").length'), 2);
      await replace('#precision-pricing-commissionPct', '10');
      await replace('#precision-pricing-discountPct', '0');
      await click('#precision-pricing-preview');
      assert.equal(await workspace('document.getElementById("precision-pricing-apply").disabled'), true, 'missing freight cannot become a free-shipping estimate');
      await replace('#precision-pricing-freight', '2.5'); await click('#precision-pricing-fill-freight');
      await click('#precision-pricing-preview');
      await until(() => workspace('!document.getElementById("precision-pricing-apply").disabled'), 'per-SKU price preview');
      await screenshot('pricing-preview');
      await replace('#precision-pricing-adPct', '1');
      assert.equal(await workspace('document.getElementById("precision-pricing-apply").disabled'), true, 'fee edit invalidates the old preview');
      await click('#precision-pricing-preview'); await click('#precision-pricing-apply');
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EDITOR_SAVE")'), false, 'price application is only a local edit');
      assert.equal(await workspace('document.querySelector(' + JSON.stringify('input[data-row-index="1"][data-field-key="价格，CNY"]') + ').value'), '20.29');
      await until(() => workspace('!document.getElementById("editor-save-btn").disabled'), 'explicit price save is ready');
      await click('#editor-save-btn');
      await until(() => workspace('document.getElementById("status-text").textContent.includes("ERP 已保存价格与货号")'), 'explicit pricing save receipt');
      const pricing = await evaluate('window.__precisionCommands.find(command=>command.type==="EDITOR_SAVE"&&command.action==="PRICING")');
      assert.deepEqual(pricing.value.items.map(item => item.price), ['20.29', '20.29']);
      assert.ok(pricing.value.items.every(item => item.currencyCode === 'CNY'));
      await until(() => workspace('!document.getElementById("editor-copy-btn").disabled'), 'pricing save completes before editing copy');
      await click('#editor-copy-btn');
      await until(() => workspace('!document.getElementById("precision-copy-modal").hidden'), 'same-window copy editor');
      await until(() => workspace('!document.getElementById("precision-copy-generate").disabled'), 'copy generation admitted');
      await evaluate('window.__precisionLoseNextGeneratedCopyReply=true');
      await click('#precision-copy-generate');
      await until(() => workspace('!document.getElementById("precision-copy-generation-recover").hidden'), 'unknown generation keeps original recovery');
      assert.equal(await workspace('document.getElementById("precision-copy-generate").disabled'), true);
      await click('#precision-copy-generation-recover');
      await until(() => workspace('document.getElementById("precision-copy-title").value.includes("футболка")&&!document.getElementById("precision-copy-approve").disabled'), 'generated candidate readback and review');
      const generations = await evaluate('window.__precisionCommands.filter(command=>command.type==="EDITOR_COPY_GENERATE")');
      assert.equal(generations.length, 2);
      assert.equal(generations[0].operationKey, generations[1].operationKey, 'recovery retains the original generation key');
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EDITOR_SAVE"&&command.action==="COPY_APPROVE")'), false);
      await screenshot('generated-copy-review');
      await click('#precision-copy-approve');
      await until(() => workspace('document.getElementById("precision-copy-state").textContent.includes("已审核")'), 'explicit generated-copy approval');
      await click('#precision-copy-close');
      await evaluate('window.__precisionCopyGenerationDenied=true'); await click('#editor-copy-btn');
      await until(() => workspace('document.getElementById("precision-copy-capability").textContent.includes("未启用")'), 'disabled production generation stays manual');
      assert.equal(await workspace('document.getElementById("precision-copy-generate").disabled'), true);
      assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="EDITOR_COPY_GENERATE").length'), 2);
      await screenshot('copy-generation-disabled');
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="PUBLISH"||command.type==="EXECUTE_HOSTED_SUITE")'), false);
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      summary.pricing = { preview: true, staleInputsRejected: true, explicitSave: true, perSkuCount: 2 };
      summary.copy = { generatedPending: true, explicitApproval: true, sameKeyRecovery: true, unavailableStaysManual: true };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (process.argv.includes('--inline-confirmation-flow')) {
      const suiteStarts = () => evaluate('window.__precisionCommands.filter(command=>command.type==="EXECUTE_HOSTED_SUITE"&&command.action==="START").length');
      const translationPosts = () => evaluate('window.__precisionCommands.filter(command=>command.type==="CREATE_TRANSLATION").length');
      await click('input[name="image-workflow-mode"][value="translate"] + span');
      await until(() => workspace('document.getElementById("image-workflow-start-btn").disabled===false'), 'translation quote ready');
      await click('#image-workflow-start-btn');
      await click('#precision-image-primary');
      await until(inlineState, 'translation asks inside the current work area');
      await click('[data-reference-key=image-7] input');
      await until(async () => (await inlineState())?.acceptDisabled, 'changed selected media invalidates translation confirmation');
      assert.equal(await translationPosts(), 0, 'a stale selected-image confirmation sends no translation request');
      await screenshot('inline-translation-selection-changed');
      await resolveInline({ decision: 'cancel', label: 'close invalidated translation confirmation' });
      await click('input[name="image-workflow-mode"][value="ai-suite"] + span');
      await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-image-primary").textContent.includes("确认费用")'), 'fresh suite quote');
      await click('#precision-image-primary');
      const pending = await until(inlineState, 'suite cost confirmation is inline');
      assert.ok(pending.text.includes('CNY 0.28'), 'exact maximum cost is visible before START');
      assert.equal(await suiteStarts(), 0, 'opening confirmation does not start the suite');
      await workspace('(()=>{const panel=[...document.querySelectorAll("[data-inline-confirmation]")].find(node=>!node.hidden&&node.getClientRects().length>0);panel.querySelector("[data-inline-confirm=accept]").click();})()');
      assert.equal(await suiteStarts(), 0, 'untrusted synthetic approval cannot start the suite');
      assert.ok(await inlineState(), 'synthetic click leaves the confirmation pending');
      await screenshot('inline-suite-cost-desktop');
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await workspace('([...document.querySelectorAll("[data-inline-confirmation]")].find(node=>!node.hidden&&node.getClientRects().length>0)).scrollIntoView({block:"center"})');
      await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      assert.ok(await workspace('document.documentElement.scrollWidth<=window.innerWidth'), 'inline confirmation does not overflow a narrow workbench');
      await screenshot('inline-suite-cost-mobile');
      await resolveInline({ decision: 'cancel', expected: 'CNY 0.28', label: 'cancel suite cost confirmation' });
      assert.equal(await suiteStarts(), 0, 'cancel sends no START');
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      await click('#precision-image-primary');
      await until(inlineState, 'suite confirmation before close');
      await workspace('(()=>{document.getElementById("precision-image-close").click();document.querySelector("[data-image-sku-key=sku-1]").click();})()');
      assert.equal(await inlineState(), null, 'close followed by an immediate same-target reopen cannot resurrect an old confirmation');
      assert.equal(await suiteStarts(), 0, 'closing a pending confirmation never starts the suite');
      await click('#precision-image-primary');
      await until(inlineState, 'second suite confirmation');
      await evaluate('window.__precisionAdvanceDraft()');
      await until(async () => (await inlineState())?.acceptDisabled, 'new draft revision invalidates the old suite confirmation');
      assert.equal(await suiteStarts(), 0, 'draft change sends no START');
      await screenshot('inline-suite-draft-changed');
      await resolveInline({ decision: 'cancel', label: 'close invalidated suite confirmation' });
      await click('#precision-image-refresh');
      await until(() => workspace('document.getElementById("precision-image-primary").disabled===false'), 'current suite quote readback');
      await click('#precision-image-primary');
      await resolveInline({ expected: 'CNY 0.28', label: 'approve current suite quote' });
      await until(async () => await suiteStarts() === 1, 'fresh explicit approval starts exactly one suite');
      assert.equal(await translationPosts(), 0);
      assert.deepEqual(summary.dialogs, []);
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      summary.inlineConfirmation = { nativeDialogs: 0, syntheticApprovalRejected: true, cancelledSuiteStarts: 0,
        staleDraftSuiteStarts: 0, staleSelectedMediaTranslations: 0, closedConfirmationDoesNotRevive: true, approvedSuiteStarts: 1, desktopAndMobile: true };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2)); return;
    }
    if (process.argv.includes('--image-process-flow')) {
      await click('#image-workflow-start-btn'); await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-image-primary").textContent.includes("确认费用")'), 'image process quote');
      await click('#precision-image-primary');
      await until(() => workspace('!document.getElementById("precision-image-manager").hidden&&document.getElementById("precision-image-result-panel").hidden===false'), 'confirmed start automatically opens current image process');
      assert.equal(await workspace('document.getElementById("process-modal").hidden'), true, 'generic preparation modal stays closed');
      assert.equal(await workspace('document.getElementById("precision-image-process").dataset.suiteStatus'), 'QUEUED');
      assert.equal(await workspace('document.querySelector(".precision-image-task-history").open'), false);
      assert.equal(await workspace('document.querySelector(".precision-image-result-history").open'), false);
      assert.equal(await workspace('document.querySelectorAll("#precision-image-result-panel > .precision-candidates > .precision-candidate").length'), 0);
      await screenshot('image-process-queued');
      await evaluate('window.__precisionImagePhase="RUNNING"');
      await until(() => workspace('document.getElementById("precision-image-process").dataset.suiteStatus==="RUNNING"&&document.querySelectorAll("#precision-image-result-panel > .precision-candidates > .precision-candidate").length===1'), 'read-only polling shows completed slot candidates while another runs');
      await until(() => workspace('[...document.querySelectorAll("#precision-image-result-panel > .precision-candidates > .precision-candidate img")].every(image=>image.complete&&image.naturalWidth>0)'), 'current generated candidates decode under anonymous CORS');
      await screenshot('image-process-running');
      await click('#precision-image-close');
      await evaluate('window.__precisionImagePhase="PARTIAL_FAILURE"');
      await until(() => workspace('document.getElementById("precision-image-process").dataset.suiteStatus==="PARTIAL_FAILURE"'), 'closed process still reads the original current task');
      assert.equal(await workspace('document.getElementById("precision-image-manager").hidden'), true, 'close neither cancels nor reopens automatically');
      await click('#ai-image-process-btn');
      assert.match(await workspace('document.getElementById("precision-image-process-status").textContent'), /部分.*失败/u);
      await screenshot('image-process-partial-failure');
      await click('.precision-image-result-history summary');
      assert.equal(await workspace('document.querySelector(".precision-image-result-history").open'), true, 'history remains viewable');
      await screenshot('image-process-history');
      await evaluate('window.__precisionImagePhase="SUCCEEDED"'); await click('#precision-image-refresh');
      await until(() => workspace('document.getElementById("precision-image-process").dataset.suiteStatus==="SUCCEEDED"'), 'explicit refresh restores current success');
      await screenshot('image-process-complete');
      const readsAtTerminal=await evaluate('window.__precisionCommands.filter(command=>command.type==="LOAD_BILLING").length');
      await pause(3300);
      assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="LOAD_BILLING").length'), readsAtTerminal, 'terminal task stops timers');
      await evaluate('new Promise(resolve=>{const frame=document.getElementById("workspace");frame.addEventListener("load",()=>resolve(),{once:true});frame.contentWindow.location.reload();})');
      await until(() => workspace('document.getElementById("precision-image-process")?.dataset.suiteStatus==="SUCCEEDED"&&document.querySelectorAll("[data-image-sku-key]").length===2'), 'iframe reload restores existing task without another start');
      await click('#ai-image-process-btn');
      assert.equal(await workspace('document.querySelector(".precision-image-result-history").open'), false, 'reload keeps old results collapsed');
      await screenshot('image-process-reloaded');
      const writes=await evaluate('window.__precisionCommands.filter(command=>command.type==="EXECUTE_HOSTED_SUITE").map(command=>command.action)');
      assert.deepEqual(writes,['CREATE_AND_REVIEW_PLAN','START'], 'progress never continues, retries, reviews or applies');
      assert.equal(await evaluate('window.__precisionCommands.filter(command=>["ASSIGN_HOSTED_SUITE","PUBLISH"].includes(command.type)).length'),0);
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      summary.imageProcess={autoOpen:true,historyCollapsed:true,queuedRunningPartialSuccess:true,currentCandidates:true,closeKeepsTask:true,terminalStopsPolling:true,iframeReloadRestores:true,readOnlyProgress:true};
      summary.ok=true; await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2)); return;
    }
    if (process.argv.includes('--video-flow')) {
      await click('[data-video-sku="sku-1"][data-video-role=MAIN]');
      await until(() => workspace('document.getElementById("precision-video-publish-modal").hidden===false&&!document.getElementById("precision-video-save").disabled'), 'video draft settings');
      await click('#precision-video-main-url'); await send('Input.insertText',{text:'https://source.example/source.mp4'});
      await click('#precision-video-save');
      await until(() => workspace('document.getElementById("precision-video-publish-state").textContent.includes("先上传")'), 'source URL rejected as not yet Ozon media');
      await click('#precision-video-main-url');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
      await send('Input.insertText',{text:'https://cdn1.ozone.ru/s3/sc-temporary/main.mp4'});
      await click('#precision-video-rich-url');await send('Input.insertText',{text:'https://cdn1.ozone.ru/s3/sc-temporary/rich.mp4'});
      await click('#precision-video-save');
      await until(() => workspace('document.getElementById("precision-video-publish-state").textContent.includes("已保存")'), 'both video slots saved');
      await screenshot('video-draft-saved');
      await click('#precision-video-publish-close');
      await click('[data-video-sku="sku-1"][data-video-role=RICH_CONTENT]');
      await until(() => workspace('document.getElementById("precision-video-rich-url").value.includes("rich.mp4")'), 'video readback preserves exact SKU and role');
      assert.equal(await workspace('document.getElementById("precision-video-main-url").value'), 'https://cdn1.ozone.ru/s3/sc-temporary/main.mp4');
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="PUBLISH")'), false);
      summary.video = { officialMainAndRichSaved: true, sourceUrlRejected: true, serverPublishFixture: false };
      assert.deepEqual(summary.pageErrors, []);assert.deepEqual(summary.blockedRequests, []);
      summary.ok=true;await writeFile(path.join(artifacts,'summary.json'),JSON.stringify(summary,null,2));return;
    }
    if (process.argv.includes('--watermark-flow') || process.argv.includes('--image-watermark-flow')) {
      await click('#watermark-settings-btn');
      await until(() => workspace('document.getElementById("watermark-modal").hidden===false'), 'original watermarks dialog');
      if(process.argv.includes('--image-watermark-flow')){
        await until(() => workspace('document.querySelectorAll("#wm-image-template option").length>0&&!document.getElementById("wm-mode-image-btn").disabled'), 'owned image template list');
        await click('#wm-mode-image-btn');
      } else { await click('#wm-text'); await send('Input.insertText', { text: 'DOTH' }); }
      await click('#wm-preview-btn');
      await until(() => workspace('document.getElementById("wm-apply-btn").disabled===false'), 'server watermark preview decoded and frozen');
      assert.equal(await workspace('document.getElementById("wm-preview-canvas").width'), 128);
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="WATERMARK_APPLY")'), false);
      await screenshot('watermark-preview');
      await click('#wm-apply-btn');
      await until(() => workspace('document.getElementById("wm-status").textContent.includes("已应用")'), 'watermark application readback');
      assert.equal(await workspace('document.getElementById("wm-apply-btn").disabled'), true);
      assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="WATERMARK_APPLY").length'), 1);
      if(process.argv.includes('--image-watermark-flow')){
        const applied=await evaluate('window.__precisionCommands.find(command=>command.type==="WATERMARK_APPLY")');
        assert.equal(applied.request.config.type,'image'); assert.equal(applied.request.config.templateId,'image-template');
        assert.equal(Object.hasOwn(applied.request.config,'imageUrl'),false);
      }
      assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE"||command.type==="CREATE_TRANSLATION"||command.type==="PUBLISH")'), false);
      await screenshot('watermark-applied');
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      summary.watermark = { preview: true, applyRequests: 1, erpGenerationChargeMinor: 0, scope: 'LOCAL_OWNER_FIXTURE' };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2)); return;
    }
    if (process.argv.includes('--combined-flow')) {
      await click('[data-image-sku-key="sku-1"] .precision-source-video-button');
      assert.equal(await workspace('document.getElementById("precision-source-video-modal").hidden'), false);
      assert.ok(await workspace('document.getElementById("precision-source-video-player").src.endsWith("source.mp4")'));
      await workspace('document.getElementById("precision-source-video-player").dispatchEvent(new window.Event("error"))');
      assert.match(await workspace('document.getElementById("precision-source-video-modal").textContent'), /暂时无法播放/u);
      await click('#precision-source-video-close');
      assert.equal(await workspace('document.getElementById("precision-source-video-player").getAttribute("src")'), null);
      await click('input[name=image-workflow-mode][value=ai-main-translate] + span');
      await until(() => workspace('document.getElementById("image-workflow-start-btn").disabled===false'), 'combined translation availability checked');
      await click('#image-workflow-start-btn');
      await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-suite-state").textContent.includes("0.14")'), 'single-image ERP quote');
      const request = await evaluate('window.__precisionCommands.find(c=>c.type==="EXECUTE_HOSTED_SUITE")');
      assert.deepEqual(request.galleryGoals, []);
      await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-image-primary").textContent.includes("审核")'), 'main image review is required before translation');
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="CREATE_TRANSLATION")'), false);
      await click('#precision-image-primary');
      await click('[data-suite-slot-key=slot-1][data-review-decision=APPROVE]');
      await until(() => workspace('document.getElementById("precision-image-primary").textContent.includes("继续翻译")'), 'approval enables follow-up translations');
      await click('#precision-image-sources');
      await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-translation-state").textContent.includes("3 张已提交")'), 'selected source translations follow reviewed AI main');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_TRANSLATION").length'), 3);
      await click('#precision-image-primary');
      assert.equal(await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_TRANSLATION").length'), 3);
      await screenshot('combined-main-translation');
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      summary.combined = { mainImageCount: 1, sourceTranslations: 3, explicitMainReview: true, sourceVideoPreview: true,
        realVideoPlaybackVerified: false, ozonVideoPublish: false };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      return;
    }
    if (process.argv.includes('--sku-images')) {
      await workspace('document.getElementById("image-card").scrollIntoView({block:"start"})');
      await screenshot('sku-image-summary');
      await click('[data-image-sku-key="sku-7"]');
      assert.equal(await workspace('document.getElementById("precision-image-manager").hidden'), false);
      assert.match(await workspace('document.getElementById("precision-image-manager-title").textContent'), /颜色 7/u);
      assert.deepEqual(await workspace('[...document.querySelectorAll(".precision-source-tile")].map(tile=>tile.dataset.referenceKey)'), ['image-0', 'image-7']);
      await click('#precision-image-previous');
      assert.deepEqual(await workspace('[...document.querySelectorAll(".precision-source-tile")].map(tile=>tile.dataset.referenceKey)'), ['image-0', 'image-1']);
      await click('#precision-image-scope');
      assert.deepEqual(await workspace('[...document.querySelectorAll(".precision-source-tile")].map(tile=>tile.dataset.referenceKey)'), ['image-0', 'image-1', 'image-7']);
      assert.equal(await workspace('!!document.getElementById("precision-plan")||!!document.getElementById("precision-generate")||!!document.getElementById("precision-continue")'), false);
      await screenshot('sku-image-sources');
      await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-image-primary").textContent.includes("确认费用")'), 'single primary action shows authoritative quote');
      await click('#precision-image-primary');
      await until(() => workspace('document.querySelectorAll(".precision-candidate").length===4'), 'fixture suite results');
      await click('#precision-image-results');
      await evaluate('window.__precisionFailNextMediaRead=true');
      await click('[data-suite-slot-key=slot-1][data-review-decision=REJECT]');
      await until(() => workspace('document.querySelector("[data-candidate-output=suite-output-1]")?.textContent.includes("已驳回")'), 'rejected candidate readback');
      await until(() => workspace('document.getElementById("precision-image-notice").textContent.includes("状态刷新暂未完成")'), 'confirmed review is distinct from unavailable readback');
      assert.equal(await workspace('document.getElementById("status-text").classList.contains("err")'), false, 'confirmed review clears stale failure notice');
      assert.equal(await evaluate('window.__precisionCommands.filter(command=>command.type==="EXECUTE_HOSTED_SUITE"&&command.action==="REVIEW_SLOT").length'), 1);
      await click('#precision-image-refresh');
      await until(() => workspace('document.getElementById("precision-image-notice").textContent.includes("已刷新")'), 'explicit read refresh clears the warning without another mutation');
      assert.match(await workspace('document.querySelector("[data-image-sku-key=sku-1]").textContent'), /已驳回/u);
      assert.equal(await workspace('document.getElementById("precision-assign").disabled'), true, 'rejected images cannot be applied');
      await screenshot('sku-image-results');
      await click('#precision-image-close');
      await screenshot('sku-image-task-rows');
      assert.equal(await workspace('document.getElementById("precision-image-manager").hidden'), true);
      assert.equal(await workspace('document.activeElement.dataset.imageSkuKey'), 'sku-7', 'closing returns focus to the SKU row');
      await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 844, deviceScaleFactor: 1, mobile: false });
      await pause(100);
      assert.ok(await workspace('document.documentElement.scrollWidth<=window.innerWidth'), 'SKU table scroll stays inside workbench at narrow widths');
      await screenshot('sku-image-mobile');
      assert.deepEqual(summary.pageErrors, []); assert.deepEqual(summary.blockedRequests, []);
      summary.skuImages = { selectedRows: 2, scopedSources: true, singlePrimary: true, review: 'REJECTED', assignmentRequests: 0 };
      summary.ok = true;
      await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
      return;
    }
    if (process.argv.includes('--usability-only')) {
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
      await until(() => workspace('document.querySelectorAll("#editor-category-modal .category-auto-card").length>0'), 'category recommendation cards');
      assert.equal(await workspace('document.querySelector("[data-category-confirm]").disabled'), true, 'an arbitrary first official category is never approved automatically');
      await screenshot('usability-category');
      await click('#editor-category-modal .settings-head button');
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
      await click('#precision-image-primary');
      await until(() => workspace('document.getElementById("precision-translation-state").textContent.includes("3 张已提交")'), 'selected images reach translation owner and the bounded batch completes');
      const translated = await evaluate('window.__precisionCommands.filter(c=>c.type==="CREATE_TRANSLATION")');
      assert.equal(translated.length, 3);
      assert.deepEqual(translated.map(c=>c.sourceMediaKey), ['image-0','image-1','image-7']);
      assert.equal(await evaluate('window.__precisionCommands.some(c=>c.type==="EXECUTE_HOSTED_SUITE")'), false, 'translation never falls into suite generation');
      await screenshot('usability-translation');
      await click('#precision-image-primary');
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
      await until(() => workspace(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return node&&!node.disabled&&!node.readOnly;})()`), 'editable control: ' + selector);
      await click(selector);
      assert.equal(await workspace(`document.activeElement===document.querySelector(${JSON.stringify(selector)})`), true, 'typing targets the exact requested control: ' + selector);
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
    await until(() => workspace('document.querySelectorAll("#editor-category-modal .category-auto-card").length>0'), 'official category recommendation');
    assert.equal(await workspace('document.querySelector("[data-category-confirm]").disabled'), true, 'an explicit selection is required even for a single match');
    await click('#editor-category-modal .category-auto-card');
    await until(() => workspace('document.querySelector("[data-category-confirm]").disabled===false'), 'explicit official category choice and attribute preview');
    await click('[data-category-confirm]');
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
    await until(() => workspace('document.querySelectorAll("tr[data-editor-row-index]").length===2&&document.querySelectorAll("[data-image-sku-key]").length===2'), 'reopened existing draft retains only selected SKUs');
    await screenshot('saved-pricing-category');
    assert.equal(await workspace('document.getElementById("precision-prompt-text").value'), '', 'empty brief uses service rules');
    assert.equal(await workspace('!!document.getElementById("precision-negative-prompt")'), true, 'optional negative direction is available');
    await replaceText('#precision-prompt-text', '😀'.repeat(301));
    await click('#precision-image-primary');
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
    await click('#precision-image-primary');
    await until(() => workspace('document.getElementById("status-text").textContent.includes("参考图")'), 'empty reference selection rejected visibly');
    assert.equal(await evaluate('window.__precisionCommands.some(command=>command.type==="EXECUTE_HOSTED_SUITE")'), false, 'empty references cannot silently create a plan');
    await click('#erp-refresh-btn');
    assert.equal(await workspace('document.querySelectorAll(".precision-source-tile input:checked").length'), 0, 'readonly refresh does not silently restore deselected references');
    await click('[data-reference-key=image-1] input[type="checkbox"]');
    await click('[data-reference-key=image-7] input[type="checkbox"]');
    await workspace('document.getElementById("precision-prompt-text").scrollIntoView({block:"center"})');
    await screenshot('editable-suite-direction');
    await click('#precision-image-primary');
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
    assert.ok(await workspace('document.getElementById("precision-image-primary").textContent.includes("确认费用")'), 'frozen plan offers only its next action, not another plan');
    await workspace('document.getElementById("precision-prompt-text").scrollIntoView({block:"center"})');
    await screenshot('frozen-suite-direction');
    await click('#precision-image-primary');
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
    // Kept inactive for historical evidence; the active BYOK edit scenario runs earlier in this script.
    // eslint-disable-next-line no-constant-condition, no-constant-binary-expression
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
    if(process.argv.includes('--paid-translation-flow')){
      const submitted=await evaluate('window.__precisionCommands.filter(command=>command.type==="CREATE_TRANSLATION")');
      assert.equal(submitted.length,3); assert.ok(submitted.every(command=>command.priceConfirmation.currency==='CNY'&&command.priceConfirmation.maximumCostCents===14&&command.priceConfirmation.quoteFingerprint==='c'.repeat(64)));
      assert.ok(summary.inlineConfirmations.some(item=>item.decision==='accept'&&item.text.includes('CNY 0.42')),'explicit batch maximum fee is presented inline before submit');
      assert.deepEqual(summary.dialogs, [], 'the payment confirmation never opens a native browser dialog');
      summary.translation.paidConfirmation={currency:'CNY',perImageMaximum:14,batchMaximum:42};
    }
    await writeFile(path.join(artifacts, 'summary.json'), JSON.stringify(summary, null, 2));
  } finally {
    acceptanceWaitPump = undefined;
    if (summary.dialogs.length) summary.ok = false;
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
