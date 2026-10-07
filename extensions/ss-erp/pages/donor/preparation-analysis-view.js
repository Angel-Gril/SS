import {createPreparationAnalysisSession} from './preparation-analysis-session.js';
import {compileHostedReferenceSelection} from './hosted-reference-selection.js';

const make = (tag, cls, text) => {const node = document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
const identity = binding => JSON.stringify(['snapshotId','supplyGoodsId','shopId','listingWorkflowId'].map(key=>binding?.[key]));
const phases = [['analysis','商品 AI 分析'],['curation','图片筛选建议'],['vision','商品视觉 JSON'],['candidates','属性与俄文文案候选']];
const stagedPhases=[['CURATION','AI 图片筛选'],['VISION','商品视觉分析'],['COPY','属性与俄文文案生成']];

export function preparationFailureMessage(failure) {
  if (failure?.code === 'product_preparation_media_invalid') {
    return '来源商品图片已变化：当前页面与 ERP 草稿快照不一致。请重新采集商品并新建草稿后继续。';
  }
  if (failure?.code === 'product_preparation_context_stale' || failure?.code === 'product_preparation_snapshot_invalid') {
    return '来源商品快照已变化：请重新采集商品并新建草稿后继续。';
  }
  const label = { CURATION: 'AI 图片筛选', VISION: '商品视觉分析', COPY: '属性与俄文文案生成' }[failure?.stage] || '商品 AI 分析';
  return `${label}尚未完成，请检查设置或继续手工编辑。`;
}

export function preparationStageProjection(view,{stagedAnalysis=false,elapsedSeconds=0,missing=false,opening=false}={}){
  if(!stagedAnalysis)return phases.map(([id,label])=>({id,label,status:view.receipt?'COMPLETE':id==='analysis'&&view.busy?'RUNNING':'PENDING',
    message:view.receipt?'分析已完成 · 待确认':id==='analysis'&&view.busy?`正在分析 · 已等待 ${elapsedSeconds} 秒`:missing?'等待商品准备':opening?'正在读取分析准备':'待分析'}));
  return stagedPhases.map(([id,label])=>{
    const complete=Boolean(view.receipt||view.stageResults?.[id]),active=view.stage===id;
    const status=complete?'COMPLETE':active&&view.busy?'RUNNING':active&&(view.operation||view.status==='RECOVERY_REQUIRED')?'RECOVERY_REQUIRED'
      :view.manuallyContinued?'MANUAL':view.failure?.stage===id?'FAILED':'PENDING';
    const visionCount=id==='VISION'?view.stageResults?.VISION?.visionSourceMediaKeys?.length:0;
    return{id,label,status,message:status==='COMPLETE'?visionCount?`已完成 · 已分析 ${visionCount} 张参考图`:'已完成 · 可查看结果':status==='RUNNING'?`正在处理 · 已等待 ${elapsedSeconds} 秒`
      :status==='RECOVERY_REQUIRED'?'原结果待核对 · 不重复提交':status==='MANUAL'?'未执行 · 继续手工编辑':status==='FAILED'?'此阶段未完成 · 可检查设置或继续手工编辑':missing?'等待商品准备':opening?'正在读取分析准备':'等待前一步'};
  });
}

export function renderPreparationProcess(target, state) {
  target.replaceChildren();
  const heading=make('h4','','商品准备阶段');target.append(heading);
  for(const step of state.steps || []) {
    const row=make('div','precision-preparation-stage');row.dataset.preparationStep=step.id;
    row.dataset.stageStatus=step.status;
    row.append(make('span','',step.label),make('span','',({PENDING:'待处理',RUNNING:'处理中',COMPLETE:'已完成',WAITING_INPUT:'等待确认',RECOVERY_REQUIRED:'待核对原操作'})[step.status]||step.status));
    target.append(row);
  }
}

export function createPreparationAnalysisView({root, runtime, command, getBinding, getSkuKey, getCategoryRevision, getMedia,
  getAttributeNames=()=>new Map(), getPrerequisites, getBusy, getRecoveryBusy=getBusy, getCopyCandidates, onCuration, onVisual, onAttributes, saveCopy, approveCopy,
  onSourceChanged=async()=>{}, onCompleted=()=>{}, onMessage=()=>{}, report}) {
  let safeKeys=[],rawKeys=[],mediaToken='',capability=null,opening=false,applying=false,loadedIdentity='',restoreComplete=false;
  let prepareTask=null,analysisTask=null,prepareError='',preparePhase='';
  let stagedEnabled=false,lastCuration='',lastVision='',heartbeat=null,heartbeatStage='',heartbeatStartedAt=0,elapsedSeconds=0;
  let mode='ERP_HOSTED',profileId='',analysisModel='qwen-vl-plus',profiles=[],inputDirty=false,lastReceipt='',copyCandidate=null,settingsChanged=false;
  const modal=make('div','settings-modal precision-preparation-analysis-shell');modal.id='precision-preparation-analysis-modal';modal.hidden=true;
  const dialog=make('div','settings-dialog precision-preparation-analysis-dialog'),head=make('div','settings-head');
  head.append(make('div','settings-title','采集与 AI · 检查商品准备候选'));
  const close=make('button','ghost','关闭');close.id='precision-preparation-analysis-close';close.type='button';close.addEventListener('click',()=>{modal.hidden=true;});head.append(close);
  const body=make('div','settings-body'),notice=make('p','precision-preparation-notice','一次分析提供筛图、视觉 JSON、属性与俄文候选；检查后分别确认，不会自动上架。');
  const stateText=make('p');stateText.id='precision-preparation-analysis-state';stateText.setAttribute('role','status');
  const stageList=make('div','precision-preparation-analysis-stages');stageList.id='precision-preparation-analysis-stages';
  const images=make('div','precision-preparation-curation');images.id='precision-preparation-curation';
  const summary=make('div');summary.id='precision-preparation-product-summary';
  const visualDetails=make('details'),visual=make('textarea');visual.id='precision-preparation-visual-json';visual.setAttribute('aria-label','商品视觉 JSON');
  visualDetails.append(make('summary','','商品视觉 JSON 与创作方向'),visual);
  const applyVisual=make('button','ghost','应用创作方向');applyVisual.id='precision-preparation-visual-apply';visualDetails.append(applyVisual);
  const attrSection=make('section'),attributeList=make('div');attributeList.id='precision-preparation-attributes';
  const applyAttributes=make('button','ghost','确认应用选中 AI 属性');applyAttributes.id='precision-preparation-attributes-apply';
  attrSection.append(make('h4','','属性候选'),make('p','precision-preparation-notice','AI 观察保留为 AI 候选依据。材质、尺寸、库存等须核对来源或实物，不会自动填为确定事实。'),attributeList,applyAttributes);
  const copySection=make('section'),titleLabel=make('label','field','俄文标题'),title=make('textarea');title.id='precision-preparation-copy-title';title.maxLength=500;titleLabel.append(title);
  const descriptionLabel=make('label','field','俄文描述'),description=make('textarea');description.id='precision-preparation-copy-description';description.maxLength=4096;descriptionLabel.append(description);
  const tagsLabel=make('label','field','俄文标签候选（逗号分隔）'),tags=make('input');tags.id='precision-preparation-copy-tags';tagsLabel.append(tags);
  const save=make('button','primary','保存我的编辑为待审核文案');save.id='precision-preparation-copy-save';
  const copyState=make('p');copyState.id='precision-preparation-copy-state';copyState.setAttribute('role','status');
  const approve=make('button','primary','确认所示待审核文案并审核');approve.id='precision-preparation-copy-approve';
  copySection.append(make('h4','','俄文文案候选'),titleLabel,descriptionLabel,tagsLabel,
    make('small','precision-preparation-notice','标签保留在当前会话候选中；ERP 文案字段尚不支持标签上架。'),save,copyState,approve);
  const foot=make('div','settings-foot'),start=make('button','primary','分析所选图片'),recover=make('button','ghost','核对原分析'),curation=make('button','ghost','确认筛图建议');
  const retry=make('button','ghost','重新读取分析准备');retry.id='precision-preparation-analysis-retry';retry.type='button';
  const recoverSave=make('button','ghost','核对原候选保存');recoverSave.id='precision-preparation-save-recover';
  const manual=make('button','ghost','保留当前结果，继续手工编辑');manual.id='precision-preparation-analysis-manual';manual.type='button';
  const sourceReset=make('button','ghost','重新采集并新建草稿');sourceReset.id='precision-preparation-source-reset';sourceReset.type='button';sourceReset.hidden=true;
  start.id='precision-preparation-analysis-start';recover.id='precision-preparation-analysis-recover';curation.id='precision-preparation-curation-confirm';foot.append(start,retry,recover,recoverSave,curation,sourceReset,manual);
  body.append(notice,stateText,stageList,images,summary,visualDetails,attrSection,copySection);dialog.append(head,body,foot);modal.append(dialog);root.append(modal);

  const safeBinding=()=>{try{return getBinding();}catch{return null;}};
  const currentMediaToken=()=>JSON.stringify(getMedia().map(item=>[item.key,item.url]));
  const preparationToken=()=>JSON.stringify([safeBinding(),getSkuKey(),getCategoryRevision(),currentMediaToken()]);
  const assertPreparationToken=token=>{if(token!==preparationToken())throw Object.assign(new Error('商品、草稿、SKU、图片或官方字段已变化，请重新读取分析准备。'),{outcome:'NOT_SUBMITTED'});};
  function prerequisites(){
    const supplied=getPrerequisites?.()||{},category=getCategoryRevision();
    return [['draft','当前店铺草稿',Boolean(safeBinding())&&supplied.draft!==false,'请先选择店铺并创建当前商品草稿。'],
      ['sku','当前 SKU',Boolean(getSkuKey())&&supplied.sku!==false,'请先选择需要处理的 SKU。'],
      ['category','官方类目确认',Boolean(category?.catalogRevision)&&supplied.category!==false,'请先确认官方类目；确认后会继续读取字段并准备 AI 分析。'],
      ['schema','官方字段读取',Boolean(category?.schemaRevision)&&supplied.schema!==false,'请先读取官方字段；字段读取完成后继续 AI 分析。'],
      ['media','当前 SKU 来源图片',Boolean(getMedia().length),'当前 SKU 没有可分析的来源图片，请先采集或选择商品图片。']];
  }
  const currentContext=()=>mediaToken&&mediaToken===currentMediaToken()?{binding:safeBinding(),skuKey:getSkuKey(),sourceMediaKeys:safeKeys.slice(),categoryRevision:getCategoryRevision(),mode,analysisModel,
    ...(stagedEnabled&&mode==='ERP_HOSTED'?{stagedAnalysis:true}:{}),...(profileId?{profileId}:{})}:null;
  const session=createPreparationAnalysisSession({getContext:currentContext,
    persist:async checkpoint=>{
      if(!runtime?.checkpoint?.write)throw new Error('扩展会话恢复通道未就绪，请重新连接扩展');
      await runtime.checkpoint.write({binding:checkpoint.context.binding,checkpoint});
    },
    analyze:async(input,context)=>context.mode==='BYOK'
      ? runtime.analyzeProduct({...input,profileId:context.profileId,analysisModel:context.analysisModel})
      : (await command('PREPARATION_ANALYZE',{...input,listingWorkflowId:input.binding.listingWorkflowId})).data?.analysis,
    read:async(input,context)=>context.mode==='BYOK'
      ? runtime.readProductAnalysis({binding:input.binding,operationKey:input.operationKey}).then(value=>value?.analysis?value:null)
      : (await command('PREPARATION_READ',{...input,listingWorkflowId:input.binding.listingWorkflowId})).data?.analysis,
    onState:view=>{
      sync();
      if(view.busy&&view.operation)onMessage(`正在${view.stage?stageLabel(view.stage):'分析当前商品'}，请等待原请求结果。`,'warn');
    else if(view.status==='RECOVERY_REQUIRED')onMessage(`${view.stage?stageLabel(view.stage):'当前商品分析'}结果未确认；可核对原请求或继续手工编辑。`,'warn');
      else if(view.status==='WAITING_INPUT'&&view.failure)onMessage(preparationFailureMessage(view.failure),'warn');
    },
  });
  const selectedImages=()=>[...images.querySelectorAll('input[data-analysis-source]:checked')].map(input=>input.value);
  const editedCopy=()=>({titleRu:title.value,descriptionRu:description.value,tagsRu:tags.value.split(/[,，\n]/u).map(value=>value.trim()).filter(Boolean)});
  const ready=()=>session.current()&&Boolean(session.state().receipt);
  const stageLabel=stage=>stagedPhases.find(row=>row[0]===stage)?.[1]||'商品 AI 分析';
  async function compileAnalysisSelection(keys){
    const limit=stagedEnabled&&mode==='ERP_HOSTED'?24:5;
    if(!keys.length||keys.length>limit||new Set(keys).size!==keys.length)throw new Error(`请选择 1 至 ${limit} 张当前商品来源图`);
    return(await Promise.all(keys.map(key=>compileHostedReferenceSelection([key],getMedia())))).map(values=>values[0]);
  }
  function syncHeartbeat(view){
    if(view.busy){
      const token=JSON.stringify([view.operation?.operationKey,view.stage||'ANALYSIS']);
      if(token!==heartbeatStage){heartbeatStage=token;heartbeatStartedAt=Number.isFinite(view.stageStartedAt)?view.stageStartedAt:Date.now();elapsedSeconds=0;}
      elapsedSeconds=Math.max(0,Math.floor((Date.now()-heartbeatStartedAt)/1000));
      if(!heartbeat){heartbeat=setInterval(()=>{if(modal.isConnected!==false)sync();else stopHeartbeat();},1000);heartbeat.unref?.();}
    }else stopHeartbeat();
  }
  function stopHeartbeat(){if(heartbeat){clearInterval(heartbeat);heartbeat=null;}heartbeatStage='';elapsedSeconds=0;}
  async function action(run,recovery=false){if(applying||opening||session.state().busy||(recovery?getRecoveryBusy():getBusy()))return;applying=true;sync();try{return await run();}catch(error){report(error);}finally{applying=false;sync();}}
  function sync() {
    const view=session.state(),working=opening||applying||view.busy||getBusy(),valid=ready(),pendingSave=Boolean(view.application);
    syncHeartbeat(view);
    const staged=stagedEnabled||Boolean(view.stageResults&&Object.keys(view.stageResults).length),current=session.current();
    const curationData=view.receipt?.report||view.stageResults?.CURATION;
    const visionData=view.receipt?.report||view.stageResults?.VISION;
    const curationReady=current&&Boolean(curationData?.curation),visionReady=current&&Boolean(visionData?.visualDescription);
    notice.textContent=staged?'依次筛选来源图片、分析商品视觉，再生成属性与俄文候选。每阶段结果会保留，可核对原步骤或继续手工编辑。':'一次分析提供筛图、视觉 JSON、属性与俄文候选；检查后分别确认，不会自动上架。';
    if(curationData&&JSON.stringify(curationData.curation)!==lastCuration){lastCuration=JSON.stringify(curationData.curation);renderImages(curationData);}
    if(visionData&&JSON.stringify(visionData)!==lastVision){lastVision=JSON.stringify(visionData);renderVisual(visionData,view);}
    visualDetails.hidden=!visionData;attrSection.hidden=copySection.hidden=!view.receipt;
    const required=prerequisites(),missing=required.find(step=>!step[2]);
    start.hidden=valid||Boolean(view.operation)||view.manuallyContinued===true;start.disabled=working||!restoreComplete||!capability?.available||selectedImages().length<1||selectedImages().length>(staged?24:5);
    retry.hidden=valid||Boolean(view.operation)||pendingSave||Boolean(restoreComplete&&capability?.available&&!missing&&!prepareError&&!view.failure);
    retry.disabled=opening||applying||view.busy;
    sourceReset.hidden=!['product_preparation_media_invalid','product_preparation_context_stale','product_preparation_snapshot_invalid'].includes(view.failure?.code);
    sourceReset.disabled=opening||applying||view.busy||getRecoveryBusy();
    recover.hidden=!view.operation;recover.disabled=working||!view.current;
    recover.textContent=view.stage?`核对原${stageLabel(view.stage)}`:'核对原分析';
    manual.hidden=view.manuallyContinued===true||valid||!staged&&!view.operation&&!view.failure;manual.disabled=working||typeof session.continueManually!=='function';
    const currentSelection=selectedImages().map(key=>safeKeys[rawKeys.indexOf(key)]);
    curation.hidden=!curationData;curation.disabled=working||!curationReady||view.review.curationConfirmed
      &&JSON.stringify(currentSelection)===JSON.stringify(view.selections.curationMediaKeys);
    applyVisual.disabled=working||!visionReady||view.review.visualApplied&&visual.value===JSON.stringify(view.selections.visualDescription,null,2);applyAttributes.disabled=working||!valid||pendingSave||view.review.attributesApplied||!attributeList.querySelector('input:checked');
    save.disabled=working||!valid||pendingSave||!inputDirty&&view.review.copySaved;title.disabled=description.disabled=tags.disabled=working||!valid||pendingSave;
    recoverSave.hidden=!pendingSave;recoverSave.disabled=opening||applying||view.busy||getRecoveryBusy()||!valid;
    for(const input of images.querySelectorAll('input'))input.disabled=working||Boolean(view.operation)&&!view.manuallyContinued||Boolean(curationData)&&!curationReady;
    for(const input of attributeList.querySelectorAll('input'))input.disabled=working||!valid||pendingSave||view.review.attributesApplied;
    const currentCandidate=getCopyCandidates()?.find(item=>item.id===copyCandidate?.id);
    approve.disabled=working||inputDirty||!valid||pendingSave||!currentCandidate?.sourceCurrent
      || currentCandidate.titleRu!==title.value||currentCandidate.descriptionRu!==description.value;
    copyState.textContent=copyCandidate?approve.disabled&&inputDirty?'有编辑尚未保存，请先保存为新候选。':currentCandidate?.sourceCurrent
      ?'ERP 已保存所示文案为待审核候选；请检查完整内容后明确审核。':'候选状态已变化，请重新保存或查看 ERP 文案。'
      :view.review.copySaved?'文案已保存或审核。':'分析输出仍是可编辑候选，保存前请核对商品事实与俄文内容。';
    if(view.receipt&&lastReceipt!==view.receipt.operationKey){lastReceipt=view.receipt.operationKey;renderReceipt(view);}
    stateText.textContent=view.busy?`${stageLabel(view.stage)}处理中，已等待 ${elapsedSeconds} 秒。已完成阶段的结果保留在下方。`
      :view.manuallyContinued?`已保留当前结果，后续内容请手工编辑。${view.operation?`原${stageLabel(view.stage)}结果仍待核对，不会重复提交。`:'未执行的 AI 阶段保持未完成。'}`
      :view.operation?`原${stageLabel(view.stage)}结果未确认，请核对原操作；已完成阶段的结果保留。`:pendingSave?'候选保存结果待核对；仅核对原保存，不会重新分析或更换请求。':view.receipt&&!view.current?'来源、SKU 或类目已变化，旧候选未应用。'
      :view.failure?`${stageLabel(view.failure.stage)}尚未完成，已完成结果保留。请检查设置或继续手工编辑。`
      :view.receipt?'图片筛选、商品观察和文案由本次分析生成，请检查后确认。':missing?missing[3]:opening?preparePhase||'正在读取当前商品的 AI 分析准备…'
      :prepareError?`分析准备读取失败：${prepareError} 可重新读取，不会自动发起模型请求。`:capability?.available?capability.providerFeeNotice
      :capability?.message||'此模式的商品分析尚未就绪，可继续手工完善当前商品。';
    let waiting=false;
    const requiredRows=required.map(([id,label,complete])=>{const row=make('div','precision-preparation-stage');row.dataset.preparationStep=id;
      row.dataset.stageStatus=complete?'COMPLETE':waiting?'PENDING':'WAITING_INPUT';if(!complete)waiting=true;
      row.append(make('span','',label),make('span','',complete?'已准备':row.dataset.stageStatus==='WAITING_INPUT'?'等待完成此步骤':'等待前一步'));return row;});
    stageList.replaceChildren(...requiredRows,...preparationStageProjection(view,{stagedAnalysis:staged,elapsedSeconds,missing:Boolean(missing),opening}).map(({id,label,status,message})=>{const row=make('div','precision-preparation-stage');row.dataset.analysisPhase=id;row.dataset.stageStatus=status;row.append(make('span','',label),make('span','',message));return row;}));
  }
  function renderImages(reportData){
    images.replaceChildren();
    const catalog=getMedia(),rows=reportData?.curation||catalog.map(item=>({rawKey:item.key}));
    for(const [index,row] of rows.entries()){
      const item=catalog.find(media=>media.key===(row.rawKey||rawKeys[safeKeys.indexOf(row.sourceMediaKey)]||rawKeys[index]));if(!item)continue;
      const card=make('label','precision-preparation-curation-item'),input=make('input'),image=make('img');input.type='checkbox';
      input.value=item.key;input.dataset.analysisSource=item.key;const confirmed=session.state().selections.curationMediaKeys;
      input.checked=reportData?confirmed?confirmed.includes(row.sourceMediaKey):row.decision!=='OMIT':rawKeys.includes(item.key);
      image.src=item.url;image.referrerPolicy='no-referrer';image.alt=item.label||'来源图';
      const text=make('div');text.append(make('strong','',reportData?({KEEP:'建议保留',OMIT:'建议不选',REVIEW:'需要确认'})[row.decision]:'分析参考图'),make('p','',row.reason||item.label||`来源图片 ${index+1}`));
      input.addEventListener('change',sync);card.append(input,image,text);images.append(card);
    }
  }
  function renderVisual(data,view){
    visual.value=JSON.stringify(view.selections.visualDescription||data.visualDescription,null,2);
    summary.replaceChildren(make('h4','','商品观察'),...(data.productSummary?.observations||[]).map(value=>make('p','',value)),
      make('h4','','仍需确认'),...(data.productSummary?.uncertainties||[]).map(value=>make('p','precision-preparation-notice',value)));
    const visionKeys=data.visionSourceMediaKeys||view.stageResults?.VISION?.visionSourceMediaKeys;
    if(visionKeys?.length)summary.append(make('small','precision-preparation-notice',`商品视觉分析实际使用 ${visionKeys.length} 张参考图。筛图结果仍按采集顺序保留。`));
    for(const sku of data.skuObservations||[])summary.append(make('p','',`SKU：${sku.skuKey} · ${sku.titleRu}`),...(sku.observations||[]).map(value=>make('p','',value)));
  }
  function renderReceipt(view){
    const data=view.receipt.report;renderImages(data);renderVisual(data,view);
    attributeList.replaceChildren();const names=getAttributeNames();
    for(const candidate of data.suggestedAttributes){const card=make('label','precision-preparation-attribute'),input=make('input');input.type='checkbox';input.value=String(candidate.attributeId);input.checked=false;
      input.addEventListener('change',sync);const detail=make('span');detail.append(make('strong','',names.get(candidate.attributeId)||`官方字段 ${candidate.attributeId}`),
        make('p','',JSON.stringify(candidate.value)),make('small','',`AI 观察：${candidate.evidence.observation}`));card.append(input,detail);attributeList.append(card);}
    if(!data.suggestedAttributes.length)attributeList.append(make('p','','没有可用的 AI 属性候选，请继续按采集依据匹配或手工填写。'));
    const copy=view.draft||data.copy;title.value=copy.titleRu;description.value=copy.descriptionRu;tags.value=copy.tagsRu.join(', ');inputDirty=false;
    copyCandidate=getCopyCandidates()?.find(item=>item.sourceCurrent&&item.titleRu===copy.titleRu&&item.descriptionRu===(copy.descriptionRu||null))||null;
  }
  function prepare(){
    const token=preparationToken(),key=JSON.stringify([token,mode,profileId,analysisModel]);
    if(prepareTask){
      if(prepareTask.key===key)return prepareTask.promise;
      return prepareTask.promise.catch(()=>{}).then(()=>{assertPreparationToken(token);return prepare();});
    }
    const promise=Promise.resolve().then(()=>prepareCurrent(token)).finally(()=>{if(prepareTask?.promise===promise)prepareTask=null;});
    prepareTask={key,promise};return promise;
  }
  async function prepareCurrent(token){
    const originalBinding=safeBinding(),owner=identity(originalBinding);
    const unchanged=()=>assertPreparationToken(token);
    unchanged();
    const missing=prerequisites().find(step=>!step[2]);
    if(missing){restoreComplete=false;capability=null;prepareError='';sync();throw Object.assign(new Error(missing[3]),{outcome:'NOT_SUBMITTED'});}
    if(owner===loadedIdentity&&session.current()&&(session.state().receipt||session.state().operation||session.state().manuallyContinued)){restoreComplete=true;prepareError='';sync();return;}
    opening=true;restoreComplete=false;capability=null;prepareError='';preparePhase='正在读取当前 SKU 的来源图片…';sync();
    try{
      await runtime?.registerUi?.();
      unchanged();
      mediaToken=currentMediaToken();rawKeys=getMedia().slice(0,3).map(item=>item.key);
      safeKeys=await compileHostedReferenceSelection(rawKeys,getMedia());
      unchanged();
      loadedIdentity=owner;
      preparePhase='正在读取当前商品的原分析与候选保存状态…';sync();
      const stored=await runtime?.checkpoint?.read?.({binding:originalBinding});
      unchanged();
      const saved=stored?.checkpoint||stored;
      if(!settingsChanged&&saved?.context&&identity(saved.context.binding)===owner){
        stagedEnabled=saved.context.stagedAnalysis===true;
        mode=saved.context.mode;analysisModel=saved.context.analysisModel||analysisModel;profileId=saved.context.profileId||'';
        const restoredKeys=[],restoredRaw=[];
        for(const item of getMedia()){const compiled=await compileHostedReferenceSelection([item.key],getMedia());if(saved.context.sourceMediaKeys.includes(compiled[0])){restoredKeys.push(compiled[0]);restoredRaw.push(item.key);}}
        unchanged();
        if(restoredKeys.length===saved.context.sourceMediaKeys.length){safeKeys=saved.context.sourceMediaKeys.slice();rawKeys=safeKeys.map(key=>restoredRaw[restoredKeys.indexOf(key)]);}
        session.restore(saved);
      }
      preparePhase='正在核对当前店铺、设备与商品分析模型…';sync();
      if(mode==='BYOK'){
        profiles=(await runtime.settings.listProfiles()).profiles||[];
        if(!profiles.some(profile=>profile.id===profileId))profileId=profiles[0]?.id||'';
        const profile=profileId?await runtime.settings.getProfileState(profileId):null;
        capability={available:false,message:'请选择自带 API 档案并加载当前会话密钥。'};
        if(profile?.hasKey&&runtime.getProductAnalysisReadiness){
          try{const readiness=await runtime.getProductAnalysisReadiness({binding:safeBinding(),profileId,skuKey:getSkuKey(),analysisModel});
            capability={...readiness,message:readiness.permissionRequired?'请在设置中授权商品分析接口来源后继续。':'此账号、店铺、设备或分析模型尚未获 ERP 准入。'};}
          catch{capability.message='当前自带 API 商品分析尚未就绪，请在设置中核对档案、密钥、来源授权与模型准入。';}
        }
      }else{
        capability=(await command('PREPARATION_CAPABILITY',{binding:originalBinding,listingWorkflowId:originalBinding.listingWorkflowId})).data?.capability;
      }
      unchanged();
      const retained=session.current()&&Boolean(session.state().receipt||session.state().operation||session.state().manuallyContinued);
      if(!retained){
        stagedEnabled=mode==='ERP_HOSTED'&&capability?.stagedAnalysis===true;
        rawKeys=getMedia().slice(0,stagedEnabled?24:3).map(item=>item.key);
        safeKeys=await compileAnalysisSelection(rawKeys);unchanged();
        lastCuration=lastVision=lastReceipt='';renderImages();
      }else if(!session.state().receipt&&!session.state().stageResults?.CURATION)renderImages();
      if(session.current()&&session.state().review.curationConfirmed){const selected=session.state().selections.curationMediaKeys||[];
        if(selected.length)onCuration(selected.map(key=>rawKeys[safeKeys.indexOf(key)]),rawKeys);}
      if(session.current()&&session.state().review.visualApplied&&session.state().selections.visualDescription)onVisual(session.state().selections.visualDescription);
      restoreComplete=true;
    }catch(error){prepareError=error.message;capability=null;restoreComplete=false;throw error;
    }finally{opening=false;sync();}
  }
  function analyze(){
    if(analysisTask)return analysisTask;
    const task=Promise.resolve().then(analyzeCurrent).finally(()=>{if(analysisTask===task)analysisTask=null;});
    analysisTask=task;return task;
  }
  async function analyzeCurrent(){
    if(session.state().operation)throw new Error('请先核对原商品分析');
    if(ready())return session.state();
    if(!restoreComplete)await prepare();
    if(!capability?.available)return {unavailable:true,message:capability?.message||'商品 AI 分析尚未启用，继续手工匹配和编辑。'};
    const token=preparationToken();
    if(!confirm(`${capability.providerFeeNotice}\n${stagedEnabled?'依次执行图片筛选、商品视觉分析、属性与俄文文案生成；已完成结果会保留。':'一次分析提供筛图、视觉、属性和俄文候选。'}确认执行？`))return {declined:true};
    rawKeys=selectedImages();safeKeys=await compileAnalysisSelection(rawKeys);
    assertPreparationToken(token);
    modal.hidden=false;
    const result=await session.analyze();
    if(result.manuallyContinued)onMessage('自动 AI 流程已停止，当前结果保留，请继续手工编辑。');
    else if(result.receipt)onMessage('商品 AI 分析完成，请检查筛图、属性与俄文候选。','ok');
    return result;
  }
  retry.addEventListener('click',event=>{if(event.isTrusted&&!retry.disabled)void prepare().catch(report);});
  start.addEventListener('click',event=>{if(event.isTrusted&&!start.disabled)void analyze().catch(report);});
    recover.addEventListener('click',event=>{if(event.isTrusted&&!recover.disabled)void action(async()=>{const state=await session.recover();if(state.receipt)onCompleted('analysis');});});
  curation.addEventListener('click',event=>{if(event.isTrusted&&!curation.disabled)void action(async()=>{
    if(!session.current()||!session.state().receipt&&!session.state().stageResults?.CURATION)throw new Error('筛图候选已变化');const selected=selectedImages();if(!selected.length)throw new Error('请保留至少一张当前商品参考图；来源图片仍保留。');
    await session.confirmCuration(selected.map(key=>safeKeys[rawKeys.indexOf(key)]));onCuration(selected,rawKeys);modal.hidden=true;onCompleted('analysis-review');});});
  applyVisual.addEventListener('click',event=>{if(event.isTrusted&&!applyVisual.disabled)void action(async()=>{const value=JSON.parse(visual.value);await session.confirmVisual(value);onVisual(value);});});
  applyAttributes.addEventListener('click',event=>{if(event.isTrusted&&!applyAttributes.disabled)void action(async()=>{
    const selectedAttributeIds=[...attributeList.querySelectorAll('input:checked')].map(input=>Number(input.value));
    const request={binding:safeBinding(),analysisInput:session.state().analysisInput,selectedAttributeIds,action:'ATTRIBUTES',operationKey:'precision-preparation-apply:'+crypto.randomUUID()};
    await session.stageApplication('ATTRIBUTES',request);
    try{await onAttributes(request);await session.clearApplication();await session.markReviewed('attributesApplied');onCompleted('attributes');}
    catch(error){if(error.outcome==='NOT_SUBMITTED')await session.clearApplication();throw error;}});});
  for(const input of [title,description,tags])input.addEventListener('input',()=>{inputDirty=true;sync();});
  visual.addEventListener('input',sync);
  manual.addEventListener('click',event=>{if(event.isTrusted&&!manual.disabled)void action(async()=>{
    const result=await session.continueManually();
    if(!result.manuallyContinued)throw new Error('未能保留当前结果，请先核对原操作');
    modal.hidden=true;onMessage('当前 AI 结果已保留；未完成阶段保持未完成，请继续手工编辑。');onCompleted('analysis-manual');
  });});
  sourceReset.addEventListener('click',event=>{if(!event.isTrusted||sourceReset.disabled)return;void action(async()=>{
    await onSourceChanged();
    session.reset();
    modal.hidden=true;
    onCompleted('source-reset');
  });});
  save.addEventListener('click',event=>{if(event.isTrusted&&!save.disabled)void action(async()=>{
    await session.updateDraft(editedCopy());
    try{await saveCopy({titleRu:title.value,descriptionRu:description.value||null},null,request=>session.stageApplication('COPY',request));await session.clearApplication();}
    catch(error){if(error.outcome==='NOT_SUBMITTED')await session.clearApplication();throw error;}
    copyCandidate=getCopyCandidates()?.find(item=>item.sourceCurrent&&item.titleRu===title.value&&item.descriptionRu===(description.value||null));
    if(!copyCandidate)throw new Error('ERP 保存回执尚未包含所示文案，请先读取草稿核对');inputDirty=false;await session.markReviewed('copySaved');});});
  recoverSave.addEventListener('click',event=>{if(event.isTrusted&&!recoverSave.disabled)void action(async()=>{
    const pending=session.state().application;if(!pending) return;
    if(pending.kind==='ATTRIBUTES'){await onAttributes(pending.request);await session.clearApplication();await session.markReviewed('attributesApplied');}
    else{await saveCopy(pending.request.value,pending.request);await session.clearApplication();copyCandidate=getCopyCandidates()?.find(item=>item.sourceCurrent&&item.titleRu===title.value&&item.descriptionRu===(description.value||null));await session.markReviewed('copySaved');}
    onCompleted(pending.kind==='ATTRIBUTES'?'attributes':'copy-save');},true);});
  approve.addEventListener('click',event=>{if(event.isTrusted&&!approve.disabled)void action(async()=>{
    const candidate=getCopyCandidates()?.find(item=>item.id===copyCandidate?.id);if(!candidate?.sourceCurrent||candidate.titleRu!==title.value||candidate.descriptionRu!==description.value)throw new Error('待审核文案已变化');
    await approveCopy(candidate.id);copyCandidate=null;onCompleted('copy');});});
  return {sync,state:()=>session.state(),current:ready,
    dispose:stopHeartbeat,
    async open(){modal.hidden=false;await prepare();},
    async run(){const token=preparationToken();await prepare();assertPreparationToken(token);return analyze();},
    async recover(){return action(async()=>{await prepare();return session.recover();});},
    async settings(container,openByokSettings){
      const connection=make('section','precision-preparation-settings');connection.append(make('h4','','AI 连接'));
      const modeLabel=make('label','field','执行方式'),modeSelect=make('select');modeSelect.id='precision-preparation-mode';
      for(const [value,label] of [['ERP_HOSTED','ERP 托管'],['BYOK','自带 API']]){const option=make('option','',label);option.value=value;modeSelect.append(option);}modeSelect.value=mode;modeLabel.append(modeSelect);
      const modelLabel=make('label','field','商品分析模型（自带 API）'),model=make('select');model.id='precision-preparation-analysis-model';
      for(const value of ['qwen-vl-plus','qwen-vl-max']){const option=make('option','',value);option.value=value;model.append(option);}model.value=analysisModel;modelLabel.append(model);
      const profileLabel=make('label','field','自带 API 档案'),profile=make('select');profile.id='precision-preparation-analysis-profile';
      try{await runtime?.registerUi?.();profiles=(await runtime.settings.listProfiles()).profiles||[];}catch{profiles=[];}
      for(const value of profiles){const option=make('option','',value.name);option.value=value.id;profile.append(option);}profile.value=profileId||profiles[0]?.id||'';profileLabel.append(profile);
      const configure=make('button','ghost','配置自带 API 与会话密钥');configure.id='precision-preparation-configure-api';
      configure.addEventListener('click',event=>{if(event.isTrusted&&!configure.disabled)void openByokSettings().catch(report);});
      const permission=make('button','primary','授权商品分析接口来源');permission.id='precision-preparation-analysis-permission';permission.hidden=true;permission.disabled=true;
      const readinessText=make('p','precision-preparation-notice');readinessText.id='precision-preparation-analysis-readiness';readinessText.setAttribute('role','status');
      let ticket=null,settingsEpoch=0,checking=false;
      const permissionInput=()=>({binding:safeBinding(),profileId:profile.value,skuKey:getSkuKey(),analysisModel:model.value});
      function changed(){const pending=Boolean(session.state().operation||session.state().application);modeSelect.disabled=model.disabled=profile.disabled=configure.disabled=pending||session.state().busy||getBusy();
        modelLabel.hidden=profileLabel.hidden=configure.hidden=modeSelect.value!=='BYOK';permission.disabled=!ticket||checking||pending;}
      async function check(){
        const expected=++settingsEpoch;ticket=null;permission.hidden=true;
        if(modeSelect.value!=='BYOK'){readinessText.textContent='托管能力与计费由当前 ERP 店铺核验。';changed();return;}
        if(!safeBinding()||!getSkuKey()||!profile.value){readinessText.textContent='请先准备当前商品草稿并配置自带 API 档案。';changed();return;}
        checking=true;readinessText.textContent='正在核对商品分析模型、设备店铺许可和接口来源…';changed();
        try{
          const input=permissionInput(),readiness=await runtime.getProductAnalysisReadiness(input);
          if(expected!==settingsEpoch||!connection.isConnected)return;
          readinessText.textContent=readiness.available?readiness.providerFeeNotice:readiness.permissionRequired?'需要授权此接口来源后，才能使用已配置的商品分析模型。':'当前商品分析能力尚未获 ERP 准入，请核对模型与店铺权限。';
          if(readiness.permissionRequired&&runtime.prepareProductAnalysisPermission){ticket=await runtime.prepareProductAnalysisPermission(input);if(expected!==settingsEpoch){ticket=null;return;}permission.hidden=false;}
        }catch{if(expected===settingsEpoch)readinessText.textContent='商品分析暂未就绪，请配置当前会话密钥并核对 ERP 的分析模型准入。';}
        finally{if(expected===settingsEpoch){checking=false;changed();}}
      }
      permission.addEventListener('click',event=>{
        if(!event.isTrusted||permission.disabled||!ticket)return;
        const activeTicket=ticket;ticket=null;permission.disabled=true;
        let pending;
        try{pending=runtime.authorizeProductAnalysis(event,activeTicket);}catch(error){report(error);void check();return;}
        void Promise.resolve(pending).then(()=>{restoreComplete=false;loadedIdentity='';return check();}).catch(error=>{report(error);void check();});
      });
      for(const input of [modeSelect,model,profile])input.addEventListener('change',()=>{if(opening||applying||session.state().busy||session.state().operation||session.state().application){changed();return;}mode=modeSelect.value;analysisModel=model.value;profileId=profile.value;settingsChanged=true;restoreComplete=false;loadedIdentity='';changed();void check();});
      connection.append(modeLabel,profileLabel,modelLabel,configure,permission,readinessText,make('p','precision-preparation-notice','图片模型与商品分析模型分别配置。密钥只加载到扩展当前浏览器会话。'));changed();container.append(connection);void check();
    },
  };
}
