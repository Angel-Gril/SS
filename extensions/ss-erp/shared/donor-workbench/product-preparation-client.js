(function (root) {
  'use strict';
  const PREFIX = '/api/extension-device/source-workbench/preparation/';
  const VERSION = 'product-preparation-analysis/v1';
  const STAGES = ['CURATION','VISION','COPY'];
  const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const exact = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => [...required, ...optional].includes(key));
  const text = (value, max = 500) => typeof value === 'string' && value.length <= max
    && !Array.from(value).some(character => { const code = character.charCodeAt(0); return code === 127 || code < 32 && ![9, 10, 13].includes(code); });
  const id = value => text(value) && value.length > 0 && value === value.normalize('NFKC').trim()
    && !/(?:https?|blob|data|file|ftp):/iu.test(value);
  const strings = (value, count = 30, length = 500) => Array.isArray(value) && value.length <= count && value.every(item => text(item, length));
  const scalar = value => text(value, 300) || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);
  function safe(value, depth = 0, budget = { nodes: 0 }) {
    if (depth > 18 || ++budget.nodes > 20000) return false;
    if (typeof value === 'string') return !/(?:https?|file|blob|data):|\b(?:authorization|bearer)\b|\bsk-[a-z0-9]{8}/iu.test(value);
    if (!value || typeof value !== 'object') return true;
    return Object.entries(value).every(([key, child]) => !/^(?:apikey|secret|password|accesstoken|refreshtoken|credentials)$/u.test(key.replace(/[_-]/gu, '').toLowerCase())
      && safe(child, depth + 1, budget));
  }
  function error(message, outcome = 'NOT_SUBMITTED') { return Object.assign(new Error(message), { outcome }); }
  function binding(value) {
    if (!exact(value, ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion'])
      || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(key => id(value[key]))
      || ![value.draftRevision, value.draftVersion].every(n => Number.isSafeInteger(n) && n > 0)) throw error('商品分析草稿绑定无效');
    return Object.freeze({ ...value });
  }
  function normalizeRequest(value, contextOnly = false) {
    const fields = ['binding', 'skuKey', 'sourceMediaKeys', 'categoryRevision'];
    if (!contextOnly) fields.push('operationKey');
    if (!exact(value, fields, contextOnly ? [] : ['executionMode', 'providerContext','stage'])
      || !id(value.skuKey) || !Array.isArray(value.sourceMediaKeys) || value.sourceMediaKeys.length < 1
      || value.sourceMediaKeys.length > (value.stage?24:5) || new Set(value.sourceMediaKeys).size !== value.sourceMediaKeys.length
      || !value.sourceMediaKeys.every(id) || !exact(value.categoryRevision, ['catalogRevision', 'schemaRevision'])
      || !id(value.categoryRevision.catalogRevision) || !/^[a-f0-9]{64}$/u.test(value.categoryRevision.schemaRevision)
      || !contextOnly && (!id(value.operationKey) || value.operationKey.length < 8 || value.operationKey.length > 128)) throw error('商品分析输入无效');
    if (value.executionMode !== undefined && !['ERP_HOSTED', 'BYOK'].includes(value.executionMode)) throw error('商品分析模式无效');
    if(value.stage!==undefined&&(!STAGES.includes(value.stage)||value.executionMode==='BYOK'))throw error('商品分析阶段无效');
    if (value.executionMode === 'BYOK') {
      const p = value.providerContext;
      if (!exact(p, ['providerOrigin', 'model', 'policyRevision']) || !text(p.model, 200) || !p.model
        || !Number.isSafeInteger(p.policyRevision) || p.policyRevision < 0) throw error('商品分析接口许可无效');
      let origin;
      try { origin = new URL(p.providerOrigin); } catch { throw error('商品分析接口来源无效'); }
      if (origin.protocol !== 'https:' || origin.origin !== p.providerOrigin || origin.username || origin.password
        || origin.search || origin.hash) throw error('商品分析接口来源无效');
    } else if (value.providerContext !== undefined) throw error('托管分析不能提交自带 API 上下文');
    return Object.freeze({ ...value, binding: binding(value.binding), sourceMediaKeys: Object.freeze(value.sourceMediaKeys.slice()),
      categoryRevision: Object.freeze({ ...value.categoryRevision }),
      ...(value.providerContext ? { providerContext: Object.freeze({ ...value.providerContext }) } : {}) });
  }
  function validateAnalysis(data, input) {
    if (!exact(data, ['binding', 'skuKey', 'sourceMediaKeys', 'operationKey', 'category', 'report', 'replayed'], ['executionMode', 'providerContext','stage'])
      || data.stage !== input.stage
      || JSON.stringify(binding(data.binding)) !== JSON.stringify(input.binding) || data.skuKey !== input.skuKey
      || data.operationKey !== input.operationKey || JSON.stringify(data.sourceMediaKeys) !== JSON.stringify(input.sourceMediaKeys)
      || typeof data.replayed !== 'boolean' || !exact(data.category, ['categoryId', 'typeId', 'catalogRevision', 'schemaRevision'])
      || ![data.category.categoryId, data.category.typeId].every(n => Number.isSafeInteger(n) && n > 0)
      || !Object.keys(input.categoryRevision).every(key => data.category[key] === input.categoryRevision[key])) throw error('商品分析回执绑定错误', 'UNKNOWN_OUTCOME');
    const report = data.report;
    if (!exact(report, ['contractVersion', 'reviewState', 'curation', 'visualDescription', 'productSummary', 'skuObservations', 'suggestedAttributes', 'copy'])
      || report.contractVersion !== VERSION || report.reviewState !== 'CANDIDATE'
      || !safe(report) || JSON.stringify(report).length > 32768) throw error('商品分析候选格式错误', 'UNKNOWN_OUTCOME');
    const keys = new Set(input.sourceMediaKeys);
    if (!Array.isArray(report.curation) || report.curation.length !== keys.size
      || new Set(report.curation.map(row => row.sourceMediaKey)).size !== keys.size
      || !report.curation.every(row => exact(row, ['sourceMediaKey', 'decision', 'reason']) && keys.has(row.sourceMediaKey)
        && ['KEEP', 'OMIT', 'REVIEW'].includes(row.decision) && text(row.reason, 500))) throw error('商品分析图片范围错误', 'UNKNOWN_OUTCOME');
    const visual = report.visualDescription;
    if (!exact(visual, ['composition', 'background', 'lighting', 'style', 'observations'])
      || !['composition', 'background', 'lighting', 'style'].every(key => text(visual[key], 60))
      || !exact(visual.observations, ['colors', 'shapes', 'visibleComponents', 'visibleText'])
      || !Object.values(visual.observations).every(items => strings(items, 10, 100))
      || !exact(report.productSummary, ['observations', 'uncertainties'])
      || !Object.values(report.productSummary).every(items => strings(items))) throw error('商品视觉候选格式错误', 'UNKNOWN_OUTCOME');
    if (!Array.isArray(report.skuObservations) || report.skuObservations.length > 100
      || !report.skuObservations.every(row => exact(row, ['skuKey', 'observations', 'titleRu'])
        && row.skuKey === input.skuKey && strings(row.observations) && text(row.titleRu, 500))
      || !Array.isArray(report.suggestedAttributes) || report.suggestedAttributes.length > 100
      || !report.suggestedAttributes.every(row => exact(row, ['attributeId', 'value', 'evidence', 'manualReview'], ['dictionaryValueId'])
        && Number.isSafeInteger(row.attributeId) && row.attributeId > 0 && row.manualReview === 'REQUIRED'
        && (scalar(row.value) || Array.isArray(row.value) && row.value.length > 0 && row.value.length <= 20 && row.value.every(scalar))
        && exact(row.evidence, ['sourceMediaKeys', 'observation']) && text(row.evidence.observation)
        && Array.isArray(row.evidence.sourceMediaKeys) && row.evidence.sourceMediaKeys.length > 0
        && row.evidence.sourceMediaKeys.every(key => keys.has(key))
        && (row.dictionaryValueId === undefined || Number.isSafeInteger(row.dictionaryValueId) && row.dictionaryValueId > 0))
      || !exact(report.copy, ['titleRu', 'descriptionRu', 'tagsRu']) || !text(report.copy.titleRu, 500)
      || !text(report.copy.descriptionRu, 20000) || !strings(report.copy.tagsRu, 30, 100)) throw error('商品字段候选格式错误', 'UNKNOWN_OUTCOME');
    return data;
  }
  function validateStage(data,input) {
    if(!input.stage)return validateAnalysis(data,input);
    if(input.stage==='COPY')return validateAnalysis(data,input);
    const fields=input.stage==='CURATION'?['curation']:['visualDescription','productSummary','skuObservations','visionSourceMediaKeys'];
    if(!exact(data,['binding','skuKey','sourceMediaKeys','operationKey','category','stage','replayed',...fields])
      ||data.stage!==input.stage||JSON.stringify(binding(data.binding))!==JSON.stringify(input.binding)
      ||data.skuKey!==input.skuKey||data.operationKey!==input.operationKey
      ||JSON.stringify(data.sourceMediaKeys)!==JSON.stringify(input.sourceMediaKeys)||typeof data.replayed!=='boolean'
      ||!exact(data.category,['categoryId','typeId','catalogRevision','schemaRevision'])
      ||![data.category.categoryId,data.category.typeId].every(n=>Number.isSafeInteger(n)&&n>0)
      ||!Object.keys(input.categoryRevision).every(key=>data.category[key]===input.categoryRevision[key])
      ||!safe(data)||JSON.stringify(data).length>100000)throw error('商品分析阶段回执绑定错误','UNKNOWN_OUTCOME');
    if(input.stage==='CURATION'){
      if(!Array.isArray(data.curation)||data.curation.length!==input.sourceMediaKeys.length
        ||!data.curation.every((row,index)=>exact(row,['sourceMediaKey','decision','reason'])
          &&row.sourceMediaKey===input.sourceMediaKeys[index]&&['KEEP','OMIT','REVIEW'].includes(row.decision)&&text(row.reason,200)))throw error('筛图阶段范围错误','UNKNOWN_OUTCOME');
    }else{
      const visual=data.visualDescription;
      if(!exact(visual,['composition','background','lighting','style','observations'])
        ||!['composition','background','lighting','style'].every(key=>text(visual[key],60))
        ||!exact(visual.observations,['colors','shapes','visibleComponents','visibleText'])
        ||!Object.values(visual.observations).every(items=>strings(items,10,100))
        ||!exact(data.productSummary,['observations','uncertainties'])||!Object.values(data.productSummary).every(items=>strings(items,20,200))
        ||!Array.isArray(data.skuObservations)||data.skuObservations.length!==1
        ||!data.skuObservations.every(row=>exact(row,['skuKey','observations','titleRu'])&&row.skuKey===input.skuKey&&strings(row.observations,20,200)&&text(row.titleRu,500))
        ||!Array.isArray(data.visionSourceMediaKeys)||!data.visionSourceMediaKeys.length||data.visionSourceMediaKeys.length>8
        ||new Set(data.visionSourceMediaKeys).size!==data.visionSourceMediaKeys.length
        ||data.visionSourceMediaKeys.some(key=>!input.sourceMediaKeys.includes(key)))throw error('视觉阶段候选格式错误','UNKNOWN_OUTCOME');
    }
    return data;
  }
  function createClient({ transport }) {
    async function send(action, input, mutating = false) {
      let response;
      try { response = await transport.post(PREFIX + action, input, { requiredScope: mutating ? 'media:execute' : 'listing:review' }); }
      catch (cause) { throw error(cause.outcome === 'NOT_SUBMITTED' ? cause.message : '商品分析响应未核对，请读取原操作', mutating && cause.outcome!=='NOT_SUBMITTED' ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'); }
      if (response?.state !== 'response' || response.body?.code !== 1) {
        const known = ['unpaired','scope_required','authorization_required'].includes(response?.state)
          || response?.body?.outcome === 'NOT_SUBMITTED' || [400,401,403,404,422,429].includes(response?.status);
        const cause=error(response?.body?.msg || '商品分析暂不可用', mutating && !known ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED');
        if(STAGES.includes(response?.body?.stage))cause.stage=response.body.stage;
        if(/^[a-z0-9_]{1,100}$/u.test(response?.body?.failureCode||''))cause.failureCode=response.body.failureCode;
        if(['TRANSPORT_UNKNOWN','RESPONSE_INVALID','REPORT_INVALID','PERSISTENCE_FAILED'].includes(response?.body?.failureKind))cause.failureKind=response.body.failureKind;
        throw cause;
      }
      return response.body.data;
    }
    return {
      async readProductPreparationCapability(input) {
        const data = await send('capability', { binding: binding(input) });
        if (!exact(data, ['available', 'reasonCode', 'providerFeeNotice'],['stagedAnalysis','stages']) || typeof data.available !== 'boolean'
          ||data.stagedAnalysis!==undefined&&typeof data.stagedAnalysis!=='boolean'
          ||data.stages!==undefined&&JSON.stringify(data.stages)!==JSON.stringify(STAGES)
          || !text(data.reasonCode, 100) || !text(data.providerFeeNotice)) throw error('商品分析能力回执无效');
        return { state: 'ready', capability: data };
      },
      async readProductPreparationContext(input) {
        const normalized = normalizeRequest(input, true), data = await send('context', normalized);
        if (!record(data) || !record(data.promptContext) || JSON.stringify(binding(data.binding)) !== JSON.stringify(normalized.binding)
          || data.skuKey !== normalized.skuKey || JSON.stringify(data.sourceMediaKeys) !== JSON.stringify(normalized.sourceMediaKeys)
          || !safe(data.promptContext)) throw error('商品分析上下文无效');
        return { state: 'ready', context: data };
      },
      async analyzeProductPreparation(input) {
        const normalized = normalizeRequest(input);
        if (normalized.executionMode === 'BYOK') throw error('自带 API 分析只能由扩展后台执行');
        return { state: 'ready', analysis: validateStage(await send('analyze', normalized, true), normalized) };
      },
      async readProductPreparation(input) {
        const normalized = normalizeRequest(input), data = await send('read', normalized);
        if (data === null || data?.analysis === null) return { state: 'ready', analysis: null };
        return { state: 'ready', analysis: validateStage(data, normalized) };
      },
      async ingestProductPreparationCandidate(input) {
        if (!exact(input, ['analysisInput', 'report'])) throw error('自带 API 分析候选输入无效');
        const normalized = normalizeRequest(input.analysisInput);
        if (normalized.executionMode !== 'BYOK' || !safe(input.report)) throw error('自带 API 分析候选输入无效');
        return { state: 'ready', analysis: validateAnalysis(await send('byok-candidates', { analysisInput: normalized, report: input.report }, true), normalized) };
      },
      async applyProductPreparation(input) {
        if (!exact(input, ['binding', 'analysisInput', 'operationKey', 'action', 'selectedAttributeIds']) || input.action !== 'ATTRIBUTES'
          || !id(input.operationKey) || input.operationKey.length < 8 || !Array.isArray(input.selectedAttributeIds)
          || !input.selectedAttributeIds.length || input.selectedAttributeIds.length > 100
          || new Set(input.selectedAttributeIds).size !== input.selectedAttributeIds.length
          || !input.selectedAttributeIds.every(n => Number.isSafeInteger(n) && n > 0)) throw error('商品属性应用输入无效');
        if(input.analysisInput.stage!==undefined&&input.analysisInput.stage!=='COPY')throw error('请先完成属性候选生成');
        const data = await send('apply', { ...input, binding: binding(input.binding), analysisInput: normalizeRequest(input.analysisInput) }, true);
        if (!exact(data, ['binding', 'selectedAttributeIds', 'replayed']) || !safe(data)
          || typeof data.replayed !== 'boolean' || JSON.stringify(data.selectedAttributeIds) !== JSON.stringify(input.selectedAttributeIds)
          || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(key => data.binding?.[key] === input.binding[key])
          || !Number.isSafeInteger(data.binding.draftRevision) || !Number.isSafeInteger(data.binding.draftVersion)
          || data.binding.draftRevision < input.binding.draftRevision || data.binding.draftVersion < input.binding.draftVersion) throw error('商品属性应用回执未核对', 'UNKNOWN_OUTCOME');
        return { state: 'ready', ...data };
      },
    };
  }
  root.SS_ERP_PRODUCT_PREPARATION_CLIENT = Object.freeze({ createClient, normalizeRequest, validateAnalysis });
})(typeof globalThis !== 'undefined' ? globalThis : self);
