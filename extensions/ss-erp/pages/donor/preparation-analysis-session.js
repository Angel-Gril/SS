const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const identity = binding => ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].map(key => binding?.[key]);
const contextToken = context => context ? JSON.stringify([identity(context.binding), context.skuKey,
  context.sourceMediaKeys, context.categoryRevision, context.mode, context.analysisModel || '',context.profileId||'',context.stagedAnalysis===true]) : '';
const safeText = (value, max) => typeof value === 'string' && value.length <= max
  && [...value].every(character=>{const code=character.charCodeAt(0);return code>31||[9,10,13].includes(code);});
const textArray = (value, count, max) => Array.isArray(value) && value.length <= count && value.every(item => safeText(item, max));
const forbidden = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) =>
  /^(?:apikey|authorization|password|secret|accesstoken|refreshtoken|credentials)$/iu.test(key.replace(/[_-]/gu, '')) || forbidden(item));

export function validatePreparationReceipt(value, input) {
  const report = value?.report;
  if (!value || !input || JSON.stringify(value).length > 100000 || forbidden(value)
    || JSON.stringify(identity(value.binding)) !== JSON.stringify(identity(input.binding))
    || value.binding.draftRevision !== input.binding.draftRevision || value.binding.draftVersion !== input.binding.draftVersion
    || value.operationKey !== input.operationKey || value.skuKey !== input.skuKey
    || JSON.stringify(value.sourceMediaKeys) !== JSON.stringify(input.sourceMediaKeys)
    || value.category?.catalogRevision !== input.categoryRevision.catalogRevision
    || value.category?.schemaRevision !== input.categoryRevision.schemaRevision
    || report?.contractVersion !== 'product-preparation-analysis/v1' || report.reviewState !== 'CANDIDATE'
    || !Array.isArray(report.curation) || report.curation.length !== input.sourceMediaKeys.length
    || !report.curation.every((item, index) => item.sourceMediaKey === input.sourceMediaKeys[index]
      && ['KEEP', 'OMIT', 'REVIEW'].includes(item.decision) && safeText(item.reason, 2000))
    || !report.visualDescription || !['composition', 'background', 'lighting', 'style'].every(key => safeText(report.visualDescription[key], 2000))
    || !textArray(report.productSummary?.observations, 30, 2000) || !textArray(report.productSummary?.uncertainties, 30, 2000)
    || !Array.isArray(report.skuObservations) || report.skuObservations.length !== 1
    || report.skuObservations[0].skuKey !== input.skuKey || !textArray(report.skuObservations[0].observations, 30, 2000)
    || !safeText(report.skuObservations[0].titleRu, 500)
    || !Array.isArray(report.suggestedAttributes) || report.suggestedAttributes.length > 100
    || !report.suggestedAttributes.every(item => Number.isSafeInteger(item.attributeId) && item.attributeId > 0
      && item.manualReview === 'REQUIRED' && textArray(item.evidence?.sourceMediaKeys, input.stage==='COPY'?8:5, 500)
      && item.evidence.sourceMediaKeys.every(key => input.sourceMediaKeys.includes(key)) && safeText(item.evidence.observation, 2000))
    || !safeText(report.copy?.titleRu, 500) || !report.copy.titleRu.trim() || !safeText(report.copy?.descriptionRu, 4096)
    || !textArray(report.copy?.tagsRu, 20, 100)) throw new Error('商品分析回执与原请求不一致，请核对原操作');
  return clone(value);
}

const stages = ['CURATION','VISION','COPY'];
export function validatePreparationStageReceipt(value, input) {
  if (!stages.includes(input?.stage) || value?.stage !== input.stage || forbidden(value)
    || JSON.stringify(value).length > 100000
    || JSON.stringify(value.binding) !== JSON.stringify(input.binding)
    || value.operationKey !== input.operationKey || value.skuKey !== input.skuKey
    || JSON.stringify(value.sourceMediaKeys) !== JSON.stringify(input.sourceMediaKeys)
    || value.category?.catalogRevision !== input.categoryRevision.catalogRevision
    || value.category?.schemaRevision !== input.categoryRevision.schemaRevision) throw new Error('商品分析阶段回执与原请求不一致');
  if(input.stage==='COPY')return validatePreparationReceipt(value,input);
  if(input.stage==='CURATION') {
    if(!Array.isArray(value.curation)||value.curation.length!==input.sourceMediaKeys.length
      ||!value.curation.every((item,index)=>item.sourceMediaKey===input.sourceMediaKeys[index]
        &&['KEEP','OMIT','REVIEW'].includes(item.decision)&&safeText(item.reason,200)))throw new Error('筛图阶段回执图片范围错误');
  }else if(!value.visualDescription||!['composition','background','lighting','style'].every(key=>safeText(value.visualDescription[key],60))
    ||!textArray(value.productSummary?.observations,20,200)||!textArray(value.productSummary?.uncertainties,20,200)
    ||!Array.isArray(value.skuObservations)||value.skuObservations.length!==1||value.skuObservations[0].skuKey!==input.skuKey
    ||!textArray(value.skuObservations[0].observations,20,200)||!safeText(value.skuObservations[0].titleRu,500))throw new Error('商品视觉阶段回执格式错误');
  return clone(value);
}

export function createPreparationAnalysisSession({ getContext, analyze, read, persist, onState = () => {},
  createOperationKey = () => 'precision-preparation:' + crypto.randomUUID() }) {
  let context = null, operation = null, application = null, analysisInput = null, receipt = null, draft = null, status = 'IDLE', busy = false;
  let rootOperationKey=null,stage=null,stageResults={},stageStartedAt=null,failure=null,manuallyContinued=false;
  let review = {curationConfirmed: false, visualApplied: false, copySaved: false, attributesApplied: false};
  let selections={curationMediaKeys:null,visualDescription:null};
  function current() { try { return Boolean(context && contextToken(context) === contextToken(getContext())); } catch { return false; } }
  const checkpoint = () => clone({version: 1, context, operation, application, analysisInput, receipt, draft, review,selections,
    rootOperationKey,stage,stageResults,stageStartedAt,failure,manuallyContinued});
  function state() { return clone({status, busy, current: current(), operation, application, analysisInput, receipt, draft, review,selections,
    rootOperationKey,stage,stageResults,stageStartedAt,failure,manuallyContinued}); }
  function publish() { onState(state()); }
  async function save() { await persist(checkpoint()); }
  function accept(value, input) {
    const validated = validatePreparationReceipt(value?.analysis || value, input);
    const frozen=value?.analysisInput||input;
    if(JSON.stringify(identity(frozen.binding))!==JSON.stringify(identity(input.binding))
      ||frozen.binding.draftRevision!==input.binding.draftRevision||frozen.binding.draftVersion!==input.binding.draftVersion
      ||frozen.operationKey!==input.operationKey||frozen.skuKey!==input.skuKey
      ||JSON.stringify(frozen.sourceMediaKeys)!==JSON.stringify(input.sourceMediaKeys)
      ||JSON.stringify(frozen.categoryRevision)!==JSON.stringify(input.categoryRevision)
      ||context.mode==='BYOK'&&(frozen.executionMode!=='BYOK'||!frozen.providerContext
        ||frozen.providerContext.model!==context.analysisModel||!Number.isSafeInteger(frozen.providerContext.policyRevision)
        ||typeof frozen.providerContext.providerOrigin!=='string'))throw new Error('原分析回执的模式或绑定不一致');
    if (!current()) throw Object.assign(new Error('商品、SKU、图片或类目已变化，分析候选未应用'), {outcome: 'UNKNOWN_OUTCOME'});
    receipt = validated; analysisInput = clone(frozen); operation = null;
    draft = clone(validated.report.copy); status = 'REVIEW_REQUIRED';
  }
  function acceptStage(value,input) {
    const validated=validatePreparationStageReceipt(value?.analysis||value,input);
    if(!current())throw Object.assign(new Error('商品、SKU、图片或类目已变化，阶段候选未应用'),{outcome:'UNKNOWN_OUTCOME'});
    stageResults[input.stage]=validated;failure=null;
    if(input.stage==='COPY')accept(value,input);
    else operation=null;
    publish();
  }
  function originalInput(nextStage) {
    return {binding:clone(context.binding),skuKey:context.skuKey,sourceMediaKeys:clone(context.sourceMediaKeys),
      categoryRevision:clone(context.categoryRevision),operationKey:rootOperationKey,...(nextStage?{stage:nextStage}:{})};
  }
  async function runStages() {
    for(const nextStage of stages) {
      if(stageResults[nextStage])continue;
      if(manuallyContinued)return state();
      stage=nextStage;stageStartedAt=Date.now();status={CURATION:'CURATING',VISION:'VISION_ANALYZING',COPY:'COPY_GENERATING'}[stage];
      operation=originalInput(stage);publish();let dispatched=false;
      try {
        await save();
        if(!current()||JSON.stringify(getContext()?.binding)!==JSON.stringify(context.binding))throw Object.assign(new Error('发送下一阶段前草稿上下文已变化'),{outcome:'NOT_SUBMITTED'});
        dispatched=true;const input=clone(operation);
        acceptStage(await analyze(input,clone(context)),input);await save();
      }catch(error){
        if(!dispatched||error.outcome==='NOT_SUBMITTED'){operation=null;status='WAITING_INPUT';}
        else if(operation){status='RECOVERY_REQUIRED';error.outcome='UNKNOWN_OUTCOME';}
        failure={stage,code:/^[a-zA-Z0-9_]{1,100}$/u.test(error.failureCode||error.code||'')?error.failureCode||error.code:'analysis_result_unconfirmed'};
        try{await save();}catch{}throw error;
      }
    }
    return state();
  }
  return {
    state, checkpoint, current,
    reset() {
      if (busy) throw new Error('请等待当前分析结束后重新采集');
      context = null; operation = null; application = null; analysisInput = null;
      receipt = null; draft = null; status = 'IDLE'; rootOperationKey = null;
      stage = null; stageResults = {}; stageStartedAt = null; failure = null;
      manuallyContinued = false;
      review = { curationConfirmed: false, visualApplied: false, copySaved: false, attributesApplied: false };
      selections = { curationMediaKeys: null, visualDescription: null };
      publish();
    },
    restore(value) {
      if (busy || !value || value.version !== 1 || forbidden(value) || !value.context
        || contextToken(value.context) !== contextToken(getContext())) return false;
      try { if (value.receipt) validatePreparationReceipt(value.receipt, value.analysisInput); }
      catch { return false; }
      try {
        if(value.context.stagedAnalysis&&value.context.mode!=='ERP_HOSTED')return false;
        if(value.stageResults&&Object.keys(value.stageResults).length){
          if(!value.context.stagedAnalysis||Object.keys(value.stageResults).some(key=>!stages.includes(key)))return false;
          let missing=false;
          for(const key of stages){
            if(!value.stageResults[key]){missing=true;continue;}
            if(missing)return false;
            validatePreparationStageReceipt(value.stageResults[key],{...value.context,operationKey:value.rootOperationKey,stage:key});
          }
        }
        if(value.stage&&!stages.includes(value.stage)||value.rootOperationKey&&!safeText(value.rootOperationKey,128)
          ||value.operation?.stage&&!stages.includes(value.operation.stage))return false;
      }catch{return false;}
      if (value.operation && (JSON.stringify(value.operation.binding) !== JSON.stringify(value.context.binding)
        || JSON.stringify(value.operation.sourceMediaKeys) !== JSON.stringify(value.context.sourceMediaKeys)
        || value.operation.skuKey !== value.context.skuKey || !safeText(value.operation.operationKey, 200))) return false;
      if(value.application&&(!['ATTRIBUTES','COPY'].includes(value.application.kind)
        || JSON.stringify(identity(value.application.request?.binding))!==JSON.stringify(identity(value.context.binding))))return false;
      if(value.selections?.curationMediaKeys&&(!Array.isArray(value.selections.curationMediaKeys)
        ||!value.selections.curationMediaKeys.length||value.selections.curationMediaKeys.some(key=>!value.context.sourceMediaKeys.includes(key))))return false;
      context = clone(value.context); operation = clone(value.operation); application=clone(value.application)||null; analysisInput = clone(value.analysisInput);
      receipt = clone(value.receipt); draft = clone(value.draft); review = {...review, ...value.review};
      selections=clone(value.selections)||{curationMediaKeys:null,visualDescription:null};
      rootOperationKey=value.rootOperationKey||null;stage=value.stage||null;stageResults=clone(value.stageResults)||{};
      stageStartedAt=value.stageStartedAt||null;failure=clone(value.failure)||null;manuallyContinued=value.manuallyContinued===true;
      status = manuallyContinued?'MANUAL_CONTINUATION':operation ? 'RECOVERY_REQUIRED' : receipt ? 'REVIEW_REQUIRED' : 'IDLE'; publish(); return true;
    },
    async analyze() {
      if (busy) throw new Error('商品分析正在处理');
      if (operation) throw new Error('先核对原商品分析，不会重复发送模型请求');
      if (application) throw new Error('先核对原候选保存，不会重复开始处理');
      if (receipt && current()) return state();
      if(manuallyContinued&&current())return state();
      const resumeStages=Boolean(context?.stagedAnalysis&&current()&&rootOperationKey);
      if(!resumeStages)context = clone(getContext());
      if (!context?.binding || !context.skuKey || !Array.isArray(context.sourceMediaKeys)
        || context.sourceMediaKeys.length < 1 || context.sourceMediaKeys.length > (context.stagedAnalysis&&context.mode==='ERP_HOSTED'?24:5) || !context.categoryRevision
        || !['ERP_HOSTED', 'BYOK'].includes(context.mode)) throw new Error('请先确认当前 SKU、图片和官方类目');
      if(context.stagedAnalysis&&context.mode==='ERP_HOSTED'){
        if(!resumeStages){rootOperationKey=createOperationKey();stageResults={};receipt=draft=analysisInput=null;
          review={curationConfirmed:false,visualApplied:false,copySaved:false,attributesApplied:false};selections={curationMediaKeys:null,visualDescription:null};}
        busy=true;publish();try{return await runStages();}finally{busy=false;publish();}
      }
      receipt = draft = analysisInput = null; review = {curationConfirmed:false,visualApplied:false,copySaved:false,attributesApplied:false};
      selections={curationMediaKeys:null,visualDescription:null};
      operation = {binding:clone(context.binding),skuKey:context.skuKey,sourceMediaKeys:clone(context.sourceMediaKeys),
        categoryRevision:clone(context.categoryRevision),operationKey:createOperationKey()};
      busy = true; status = 'RUNNING'; publish(); let dispatched = false;
      try {
        await save();
        if (!current()) throw Object.assign(new Error('发送前商品上下文已变化'), {outcome:'NOT_SUBMITTED'});
        dispatched = true;
        accept(await analyze(clone(operation), clone(context)), operation);
        await save();
        return state();
      } catch (error) {
        if (!dispatched || error.outcome === 'NOT_SUBMITTED') { operation = null; status = 'WAITING_INPUT'; }
        else if (operation) { status = 'RECOVERY_REQUIRED'; error.outcome = 'UNKNOWN_OUTCOME'; }
        try { await save(); } catch {}
        throw error;
      } finally { busy = false; publish(); }
    },
    async recover() {
      if (busy) throw new Error('请等待当前核对完成');
      if (!operation) return state();
      if (!current()) throw new Error('请回到原商品、店铺、SKU 和类目核对分析');
      busy = true; publish();
      try {
        const input = clone(operation), value = await read(input, clone(context));
        if (value) {
          if(input.stage){acceptStage(value,input);await save();if(!manuallyContinued)await runStages();}
          else {accept(value, input);await save();}
        } else status = manuallyContinued?'MANUAL_CONTINUATION':'RECOVERY_REQUIRED';
        return state();
      } finally { busy = false; publish(); }
    },
    async continueManually(){
      if(!context)context=clone(getContext());
      if(busy||!current()||application||!context.binding||!context.skuKey)throw new Error('请等待当前分析结束后继续手工编辑');
      manuallyContinued=true;status='MANUAL_CONTINUATION';await save();publish();return state();
    },
    async updateDraft(value) {
      if (!current() || !receipt || busy || application) throw new Error('商品分析候选已失效或保存结果待核对');
      if (!safeText(value.titleRu,500) || !value.titleRu.trim() || !safeText(value.descriptionRu,4096)
        || !textArray(value.tagsRu,20,100)) throw new Error('文案长度或标签不符合要求');
      draft = clone(value); review.copySaved = false; await save(); publish();
    },
    async markReviewed(key) {
      if (!current() || !receipt || busy || !Object.hasOwn(review,key)) throw new Error('分析候选已变化，请重新读取');
      review[key] = true; await save(); publish();
    },
    async confirmCuration(keys){
      if(!current()||!(receipt||stageResults.CURATION)||busy||!Array.isArray(keys)||!keys.length||keys.length>(context.stagedAnalysis?24:5)
        ||new Set(keys).size!==keys.length||keys.some(key=>!context.sourceMediaKeys.includes(key)))throw new Error('确认图片不属于本次商品分析');
      selections.curationMediaKeys=keys.slice();review.curationConfirmed=true;await save();publish();
    },
    async confirmVisual(value){
      if(!current()||!(receipt||stageResults.VISION)||busy||forbidden(value)||JSON.stringify(value).length>8000
        ||!['composition','background','lighting','style'].every(key=>safeText(value?.[key],60)))throw new Error('视觉 JSON 不符合当前商品创作方向');
      selections.visualDescription=clone(value);review.visualApplied=true;await save();publish();
    },
    async stageApplication(kind,request){
      if(!current()||!receipt||busy||application||!['ATTRIBUTES','COPY'].includes(kind)
        ||JSON.stringify(identity(request?.binding))!==JSON.stringify(identity(context.binding)))throw new Error('候选保存上下文已变化或原保存待核对');
      application={kind,request:clone(request)};
      try{await save();}catch(error){application=null;throw error;}publish();
    },
    async clearApplication(){application=null;await save();publish();},
  };
}
