import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const inlineConfirmation = asModule(readFileSync('extensions/ss-erp/pages/donor/inline-confirmation.js', 'utf8'));
const source = readFileSync('extensions/ss-erp/pages/donor/preparation-analysis-view.js', 'utf8')
  .replace("'./preparation-analysis-session.js'", JSON.stringify(asModule(readFileSync('extensions/ss-erp/pages/donor/preparation-analysis-session.js', 'utf8'))))
  .replace("'./hosted-reference-selection.js'", JSON.stringify(asModule(readFileSync('extensions/ss-erp/pages/donor/hosted-reference-selection.js', 'utf8'))))
  .replace("'./inline-confirmation.js'", JSON.stringify(inlineConfirmation));
const load = () => import(asModule(source));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('stage projection retains completed curation and shows only the actual vision stage as running with real elapsed seconds', async () => {
  const {preparationStageProjection}=await load();
  const rows=preparationStageProjection({status:'VISION_ANALYZING',stage:'VISION',busy:true,stageResults:{CURATION:{curation:[]}}},
    {stagedAnalysis:true,elapsedSeconds:17});
  assert.deepEqual(rows.map(row=>[row.id,row.status]),[['CURATION','COMPLETE'],['VISION','RUNNING'],['COPY','PENDING']]);
  assert.match(rows[1].message,/17 秒/);assert.ok(rows.every(row=>!row.message.includes('%')));
});

test('source media and snapshot drift produce an actionable message instead of a generic wait state', async () => {
  const { preparationFailureMessage } = await load();
  assert.match(preparationFailureMessage({ code: 'product_preparation_media_invalid' }), /来源商品图片已变化/);
  assert.match(preparationFailureMessage({ code: 'product_preparation_context_stale' }), /重新采集商品并新建草稿/);
  assert.match(preparationFailureMessage({ stage: 'VISION', code: 'provider_unavailable' }), /商品视觉分析尚未完成/);
});

test('stale source analysis exposes explicit re-collect action and resets its local session', async () => {
  const f = await fixture({ capability: stagedCapability, analyze: () => {
    throw Object.assign(new Error('来源图片已变化'), { code: 'product_preparation_media_invalid' });
  }});
  await assert.rejects(f.view.run(), /来源图片已变化/);
  assert.equal(f.element('source-reset').hidden, false);
  f.element('source-reset').click();
  await tick(); await tick();
  assert.equal(f.view.state().status, 'IDLE');
});

test('unknown copy stage keeps earlier results visible and manual continuation never reports AI completion', async () => {
  const {preparationStageProjection}=await load();
  const value={status:'RECOVERY_REQUIRED',stage:'COPY',busy:false,operation:{operationKey:'original-operation'},stageResults:{CURATION:{curation:[]},VISION:{visualDescription:{}}}};
  const rows=preparationStageProjection(value,{stagedAnalysis:true});
  assert.deepEqual(rows.map(row=>[row.id,row.status]),[['CURATION','COMPLETE'],['VISION','COMPLETE'],['COPY','RECOVERY_REQUIRED']]);
  assert.match(rows[2].message,/待核对/);
  const manual=preparationStageProjection({...value,status:'MANUAL_CONTINUATION',manuallyContinued:true},{stagedAnalysis:true});
  assert.equal(manual[2].status,'RECOVERY_REQUIRED');assert.ok(!manual[2].message.includes('已完成'));
});

test('stage projection does not infer completed results merely from the active stage or render copy candidates before its result', async () => {
  const {preparationStageProjection}=await load();
  const rows=preparationStageProjection({status:'COPY_GENERATING',stage:'COPY',busy:true,stageResults:{}},{stagedAnalysis:true,elapsedSeconds:0});
  assert.deepEqual(rows.map(row=>row.status),['PENDING','PENDING','RUNNING']);
  const complete=preparationStageProjection({status:'REVIEW_REQUIRED',receipt:{report:{}},stageResults:{}},{stagedAnalysis:true});
  assert.ok(complete.every(row=>row.status==='COMPLETE'));
});

test('an unsubmitted failed stage stays visibly unfinished and records the actual vision image count from its completed result',async()=>{
  const {preparationStageProjection}=await load();
  const rows=preparationStageProjection({status:'WAITING_INPUT',stage:'COPY',busy:false,failure:{stage:'COPY',code:'provider_unavailable'},
    stageResults:{CURATION:{curation:[]},VISION:{visualDescription:{},visionSourceMediaKeys:['one','two']}}},{stagedAnalysis:true});
  assert.equal(rows[2].status,'FAILED');assert.match(rows[2].message,/未完成/);assert.match(rows[1].message,/2 张/);
});

// A small DOM adapter exercises the production view and its real session. It
// deliberately contains no preparation, capability or analysis behavior.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this.isConnected = true; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('#') ? node.id === selector.slice(1)
      : node.tagName === 'input' && (!selector.includes(':checked') || node.checked)
        && (!selector.includes('[data-analysis-source]') || node.dataset.analysisSource);
    const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
    return walk(this).filter(matches);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { return this.listeners.get('click')?.({ isTrusted: true }); }
}

const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'workflow', draftRevision: 1, draftVersion: 1 };
function receipt(input) {
  return { ...input, category: { categoryId: 1, typeId: 2, ...input.categoryRevision }, report: {
    contractVersion: 'product-preparation-analysis/v1', reviewState: 'CANDIDATE',
    curation: input.sourceMediaKeys.map(sourceMediaKey => ({ sourceMediaKey, decision: 'KEEP', reason: '展示商品' })),
    visualDescription: { composition: '居中', background: '白色', lighting: '柔光', style: '写实' },
    productSummary: { observations: ['盒子'], uncertainties: ['材质需确认'] },
    skuObservations: [{ skuKey: input.skuKey, observations: [], titleRu: 'Коробка' }],
    suggestedAttributes: [], copy: { titleRu: 'Коробка', descriptionRu: 'Коробка', tagsRu: [] },
  } };
}

async function fixture({ capability, checkpoint, analyze, read, media, inline = false } = {}) {
  globalThis.document = { createElement: tag => new Element(tag) };
  let confirmations = 0,stored=null;
  globalThis.confirm = () => { throw new Error('native confirmation must not be used'); };
  const root = new Element('div'), calls = [],requests=[], errors = [],completed=[],notices=[], state = {
    binding: { ...binding }, prerequisites: { draft: true, sku: true, category: true, schema: true }, busy: false,
  };
  const { createPreparationAnalysisView } = await load();
  const view = createPreparationAnalysisView({ root,
    runtime: { registerUi: async () => { calls.push('register'); }, checkpoint: {
      read: async () => { calls.push('checkpoint'); return checkpoint?.(state); }, write: async value => { calls.push('persist');stored=structuredClone(value.checkpoint); },
    } },
    command: async (type, payload) => {
      calls.push(type);
      requests.push({type,payload});
      if (type === 'PREPARATION_CAPABILITY') return { data: { capability: capability ? await capability(state) : { available: true, providerFeeNotice: '一次模型请求可能产生费用' } } };
      if (type === 'PREPARATION_ANALYZE') return { data: { analysis: analyze ? await analyze(payload) : receipt(payload) } };
      if (type === 'PREPARATION_READ') return { data: { analysis: read ? await read(payload) : null } };
      throw Error('Unexpected command: ' + type);
    },
    getBinding: () => state.prerequisites.draft ? state.binding : null,
    getSkuKey: () => state.prerequisites.sku ? 'sku' : '',
    getCategoryRevision: () => ({ catalogRevision: state.prerequisites.category ? 'a'.repeat(64) : undefined,
      schemaRevision: state.prerequisites.schema ? 'b'.repeat(64) : undefined }),
    getPrerequisites: () => state.prerequisites,
    getMedia: () => media||[{ key: 'image-1', url: 'https://example.com/image.jpg' }],
    getBusy: () => state.busy, getCopyCandidates: () => [],
    onCuration() {}, onVisual() {}, onAttributes() {}, saveCopy() {}, approveCopy() {},
    ...(inline ? {} : {confirmAction: async () => { confirmations++; return true; }}),
    onCompleted:step=>completed.push(step),onMessage:(message,variant)=>notices.push({message,variant}),report: error => errors.push(error),
  });
  return { view, root, state, calls,requests, errors,completed,notices, confirmations: () => confirmations,stored:()=>stored,
    element: id => root.querySelector('#precision-preparation-' + id) };
}

const inlineButtons = root => {
  const walk = node => [node, ...node.children.flatMap(walk)];
  return Object.fromEntries(walk(root).filter(node => node.dataset.inlineConfirm).map(node => [node.dataset.inlineConfirm, node]));
};

test('inline analysis confirmation cancels without submitting and deduplicates continuous starts', async () => {
  const f = await fixture({inline:true});
  const pending = f.view.run(); await tick(); await tick();
  const duplicate = f.view.run(); await tick();
  assert.equal(f.calls.filter(type=>type==='PREPARATION_ANALYZE').length, 0);
  inlineButtons(f.root).cancel.click();
  assert.equal((await pending).declined, true);
  assert.equal((await duplicate).declined, true);
  assert.equal(f.calls.filter(type=>type==='PREPARATION_ANALYZE').length, 0);
  f.view.dispose();
});

test('inline analysis approval for an old draft is invalidated before any model request', async () => {
  const f = await fixture({inline:true});
  const pending = f.view.run(); await tick(); await tick();
  f.state.binding.draftRevision++;
  f.view.sync();
  assert.equal((await pending).declined, true);
  assert.equal(f.calls.filter(type=>type==='PREPARATION_ANALYZE').length, 0);
  f.view.dispose();
});

test('closing and immediately reopening analysis cancels the old confirmation without waiting for polling', async () => {
  const f = await fixture({inline:true});
  const pending = f.view.run(); await tick(); await tick();
  f.element('analysis-close').click();
  await f.view.open();
  assert.equal((await pending).declined, true);
  assert.equal(f.calls.filter(type=>type==='PREPARATION_ANALYZE').length, 0);
  f.view.dispose();
});

test('analysis settings offer the donor Qwen 3.5 model while preserving the existing selection',async()=>{
  const f=await fixture();
  await f.view.settings(f.root,async()=>{});
  const model=f.element('analysis-model');
  assert.ok(model.children.some(option=>option.value==='qwen3.5-plus'));
  assert.equal(model.value,'qwen-vl-plus');
  assert.equal(f.calls.includes('PREPARATION_ANALYZE'),false);
  f.view.dispose();
});

test('missing draft, SKU, official category and schema show the specific next step before any AI read', async () => {
  for (const [key, message] of [['draft', /草稿/], ['sku', /SKU/], ['category', /确认官方类目/], ['schema', /读取官方字段/]]) {
    const f = await fixture(); f.state.prerequisites[key] = false;
    await assert.rejects(f.view.open());
    assert.match(f.element('analysis-state').textContent, message);
    const step = f.element('analysis-stages').children.find(item => item.dataset.preparationStep === key);
    assert.equal(step?.dataset.stageStatus, 'WAITING_INPUT');
    assert.equal(f.calls.length, 0);
  }
});

function stageReceipt(input){
  const full=receipt(input);
  if(input.stage==='COPY')return full;
  const {report,...base}=full;
  return input.stage==='CURATION'?{...base,curation:report.curation}:{...base,visualDescription:report.visualDescription,productSummary:report.productSummary,skuObservations:report.skuObservations};
}
const stagedCapability=()=>({available:true,stagedAnalysis:true,providerFeeNotice:'分阶段模型请求可能产生费用'});
const stageRows=f=>f.element('analysis-stages').children.filter(row=>row.dataset.analysisPhase);

test('hosted staged flow defaults to 24 source candidates and renders curation while the real vision stage is pending',async()=>{
  let releaseVision;
  const media=Array.from({length:26},(_,index)=>({key:'image-'+index,url:'https://example.com/'+index+'.jpg'}));
  const f=await fixture({media,capability:stagedCapability,analyze:input=>input.stage==='VISION'?new Promise(resolve=>{releaseVision=()=>resolve(stageReceipt(input));}):stageReceipt(input)});
  const running=f.view.run();await tick();await tick();
  assert.equal(f.requests.find(row=>row.type==='PREPARATION_ANALYZE').payload.sourceMediaKeys.length,24);
  assert.deepEqual(stageRows(f).map(row=>[row.dataset.analysisPhase,row.dataset.stageStatus]),[['CURATION','COMPLETE'],['VISION','RUNNING'],['COPY','PENDING']]);
  assert.equal(f.element('curation').children.length,24);
  assert.match(f.element('analysis-state').textContent,/视觉分析.*秒/);
  assert.equal(f.element('copy-title').disabled,true);
  const clock=Date.now;try{Date.now=()=>clock()+2500;f.view.sync();assert.match(stageRows(f)[1].children[1].textContent,/2 秒/);}finally{Date.now=clock;}
  releaseVision();await running;
  assert.deepEqual(f.requests.filter(row=>row.type==='PREPARATION_ANALYZE').map(row=>row.payload.stage),['CURATION','VISION','COPY']);
  assert.ok(stageRows(f).every(row=>row.dataset.stageStatus==='COMPLETE'));assert.equal(f.element('copy-title').disabled,false);
  assert.equal(f.confirmations(),1);f.view.dispose();
});

test('failed staged copy retains visual and curation and manual editing leaves the unknown operation available without another model request',async()=>{
  const f=await fixture({capability:stagedCapability,analyze:input=>{if(input.stage==='COPY')throw Object.assign(Error('copy pending'),{outcome:'UNKNOWN_OUTCOME'});return stageReceipt(input);}});
  await assert.rejects(f.view.run(),/copy pending/);
  assert.deepEqual(stageRows(f).map(row=>row.dataset.stageStatus),['COMPLETE','COMPLETE','RECOVERY_REQUIRED']);
  assert.match(f.element('visual-json').value,/白色/);assert.equal(f.element('curation').children.length,1);
  assert.match(f.element('analysis-recover').textContent,/俄文文案/);assert.equal(f.element('analysis-recover').disabled,false);
  assert.equal(f.element('analysis-manual').disabled,false);f.element('analysis-manual').click();await tick();await tick();
  assert.equal(f.view.state().manuallyContinued,true);assert.ok(f.view.state().operation);assert.equal(f.view.state().receipt,null);
  assert.deepEqual(f.completed,['analysis-manual']);assert.equal(f.calls.filter(type=>type==='PREPARATION_ANALYZE').length,3);
  assert.ok(f.notices.every(notice=>notice.variant!=='ok'));assert.match(f.element('analysis-state').textContent,/待核对/);
  assert.equal(f.element('analysis-start').hidden,true);assert.equal(f.element('analysis-recover').hidden,false);f.view.dispose();
});
test('current stage and unknown result replace the workbench footer instead of leaving an earlier SKU success',async()=>{
  const f=await fixture({capability:stagedCapability,analyze:input=>{if(input.stage==='VISION')throw Object.assign(Error('timeout'),{outcome:'UNKNOWN_OUTCOME'});return stageReceipt(input);}});
  await assert.rejects(f.view.run());
  assert.ok(f.notices.some(notice=>/正在.*视觉/.test(notice.message)));
  assert.match(f.notices.at(-1).message,/视觉.*未确认/);assert.equal(f.notices.at(-1).variant,'warn');
  f.view.dispose();
});

test('readonly stage recovery reuses only original vision request then submits the not-yet-started copy stage',async()=>{
  let lost=true;
  const f=await fixture({capability:stagedCapability,analyze:input=>{if(input.stage==='VISION'&&lost){lost=false;throw Object.assign(Error('vision pending'),{outcome:'UNKNOWN_OUTCOME'});}return stageReceipt(input);},read:input=>stageReceipt(input)});
  await assert.rejects(f.view.run(),/vision pending/);const original=f.requests.find(row=>row.type==='PREPARATION_ANALYZE'&&row.payload.stage==='VISION').payload;
  await f.view.recover();
  assert.deepEqual(f.requests.filter(row=>row.type==='PREPARATION_ANALYZE').map(row=>row.payload.stage),['CURATION','VISION','COPY']);
  assert.deepEqual(f.requests.find(row=>row.type==='PREPARATION_READ').payload,original);
  assert.equal(f.view.state().status,'REVIEW_REQUIRED');assert.ok(stageRows(f).every(row=>row.dataset.stageStatus==='COMPLETE'));f.view.dispose();
});

test('non-staged capability retains the existing three-reference default and one analysis request',async()=>{
  const f=await fixture({media:Array.from({length:8},(_,index)=>({key:'legacy-'+index,url:'https://example.com/'+index+'.jpg'}))});
  await f.view.run();const requests=f.requests.filter(row=>row.type==='PREPARATION_ANALYZE');
  assert.equal(requests.length,1);assert.equal(requests[0].payload.sourceMediaKeys.length,3);assert.equal(requests[0].payload.stage,undefined);f.view.dispose();
});

test('reload restores original staged mode and completed results even if the latest capability turns unavailable',async()=>{
  const media=Array.from({length:12},(_,index)=>({key:'image-'+index,url:'https://example.com/'+index+'.jpg'}));
  const first=await fixture({media,capability:stagedCapability,analyze:input=>{if(input.stage==='VISION')throw Object.assign(Error('vision pending'),{outcome:'UNKNOWN_OUTCOME'});return stageReceipt(input);}});
  await assert.rejects(first.view.run());const saved=first.stored();first.view.dispose();
  const restored=await fixture({media,checkpoint:()=>saved,capability:()=>({available:false,stagedAnalysis:false,providerFeeNotice:'已暂停新分析'})});
  await restored.view.open();
  assert.deepEqual(stageRows(restored).map(row=>[row.dataset.analysisPhase,row.dataset.stageStatus]),[['CURATION','COMPLETE'],['VISION','RECOVERY_REQUIRED'],['COPY','PENDING']]);
  assert.equal(restored.element('curation').children.length,12);assert.equal(restored.element('analysis-start').hidden,true);
  assert.equal(restored.element('analysis-recover').disabled,false);assert.equal(restored.calls.includes('PREPARATION_ANALYZE'),false);restored.view.dispose();
});

test('manual continuation allows explicit use of completed curation and visual outputs while the unknown copy operation stays guarded',async()=>{
  const f=await fixture({capability:stagedCapability,analyze:input=>{if(input.stage==='COPY')throw Object.assign(Error('copy pending'),{outcome:'UNKNOWN_OUTCOME'});return stageReceipt(input);}});
  await assert.rejects(f.view.run());f.element('analysis-manual').click();await tick();await tick();
  assert.equal(f.element('curation-confirm').disabled,false);assert.equal(f.element('visual-apply').disabled,false);
  f.element('visual-apply').click();await tick();await tick();
  f.element('curation-confirm').click();await tick();await tick();
  assert.equal(f.view.state().review.visualApplied,true);assert.equal(f.view.state().review.curationConfirmed,true);
  assert.equal(f.view.state().operation.stage,'COPY');assert.equal(f.view.state().receipt,null);
  assert.equal(f.calls.filter(type=>type==='PREPARATION_ANALYZE').length,3);assert.deepEqual(f.errors,[]);f.view.dispose();
});

test('open and continuous run await one read-only preparation and submit only one confirmed analysis', async () => {
  let release;
  const f = await fixture({ checkpoint: () => new Promise(resolve => { release = resolve; }) });
  f.state.busy = true;
  const open = f.view.open(), run = f.view.run(), duplicate = f.view.run();
  await tick();
  assert.equal(f.calls.filter(item => item === 'checkpoint').length, 1);
  assert.equal(f.calls.includes('PREPARATION_ANALYZE'), false);
  f.state.busy = false; release(null);
  await Promise.all([open, run, duplicate]);
  assert.equal(f.calls.filter(item => item === 'PREPARATION_CAPABILITY').length, 1);
  assert.equal(f.calls.filter(item => item === 'PREPARATION_ANALYZE').length, 1);
  assert.equal(f.confirmations(), 1);
  assert.equal(f.view.state().status, 'REVIEW_REQUIRED');
});

test('failed capability preparation offers an explicit read retry and never starts the model automatically', async () => {
  let failed = true;
  const f = await fixture({ capability: async () => { if (failed) throw Error('设备读取超时'); return { available: true, providerFeeNotice: '模型费用' }; } });
  await assert.rejects(f.view.open(), /读取超时/);
  assert.match(f.element('analysis-state').textContent, /设备读取超时/);
  const retry = f.element('analysis-retry');
  assert.ok(retry); assert.equal(retry.hidden, false); assert.equal(retry.disabled, false);
  failed = false; retry.click(); await tick(); await tick();
  assert.equal(f.element('analysis-start').disabled, false);
  assert.equal(f.calls.filter(item => item === 'PREPARATION_CAPABILITY').length, 2);
  assert.equal(f.calls.includes('PREPARATION_ANALYZE'), false);
  assert.equal(f.confirmations(), 0);
});

test('late preparation of another draft is rejected and cannot enable or submit analysis', async () => {
  let release;
  const f = await fixture({ checkpoint: () => new Promise(resolve => { release = resolve; }) });
  const pending = f.view.run(); await tick();
  f.state.binding = { ...binding, listingWorkflowId: 'different' };
  release(null);
  await assert.rejects(pending, /已变化/);
  assert.equal(f.element('analysis-start').disabled, true);
  assert.equal(f.calls.includes('PREPARATION_ANALYZE'), false);
  assert.equal(f.confirmations(), 0);
});

test('unknown analysis keeps only original recovery available after reopening and readonly retry', async () => {
  const f = await fixture({ analyze: async () => { throw Object.assign(Error('lost response'), { outcome: 'UNKNOWN_OUTCOME' }); } });
  await assert.rejects(f.view.run(), /lost response/);
  await f.view.open();
  assert.equal(f.element('analysis-start').hidden, true);
  assert.equal(f.element('analysis-recover').hidden, false);
  await assert.rejects(f.view.run(), /核对原商品分析/);
  assert.equal(f.calls.filter(item => item === 'PREPARATION_ANALYZE').length, 1);
  assert.equal(f.confirmations(), 1);
});
