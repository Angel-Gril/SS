import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const asModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const source = readFileSync('extensions/ss-erp/pages/donor/preparation-analysis-view.js', 'utf8')
  .replace("'./preparation-analysis-session.js'", JSON.stringify(asModule(readFileSync('extensions/ss-erp/pages/donor/preparation-analysis-session.js', 'utf8'))))
  .replace("'./hosted-reference-selection.js'", JSON.stringify(asModule(readFileSync('extensions/ss-erp/pages/donor/hosted-reference-selection.js', 'utf8'))));
const load = () => import(asModule(source));
const tick = () => new Promise(resolve => setImmediate(resolve));

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

async function fixture({ capability, checkpoint, analyze } = {}) {
  globalThis.document = { createElement: tag => new Element(tag) };
  let confirmations = 0;
  globalThis.confirm = () => { confirmations++; return true; };
  const root = new Element('div'), calls = [], errors = [], state = {
    binding: { ...binding }, prerequisites: { draft: true, sku: true, category: true, schema: true }, busy: false,
  };
  const { createPreparationAnalysisView } = await load();
  const view = createPreparationAnalysisView({ root,
    runtime: { registerUi: async () => { calls.push('register'); }, checkpoint: {
      read: async () => { calls.push('checkpoint'); return checkpoint?.(state); }, write: async () => { calls.push('persist'); },
    } },
    command: async (type, payload) => {
      calls.push(type);
      if (type === 'PREPARATION_CAPABILITY') return { data: { capability: capability ? await capability(state) : { available: true, providerFeeNotice: '一次模型请求可能产生费用' } } };
      if (type === 'PREPARATION_ANALYZE') return { data: { analysis: analyze ? await analyze(payload) : receipt(payload) } };
      if (type === 'PREPARATION_READ') return { data: { analysis: null } };
      throw Error('Unexpected command: ' + type);
    },
    getBinding: () => state.prerequisites.draft ? state.binding : null,
    getSkuKey: () => state.prerequisites.sku ? 'sku' : '',
    getCategoryRevision: () => ({ catalogRevision: state.prerequisites.category ? 'a'.repeat(64) : undefined,
      schemaRevision: state.prerequisites.schema ? 'b'.repeat(64) : undefined }),
    getPrerequisites: () => state.prerequisites,
    getMedia: () => [{ key: 'image-1', url: 'https://example.com/image.jpg' }],
    getBusy: () => state.busy, getCopyCandidates: () => [],
    onCuration() {}, onVisual() {}, onAttributes() {}, saveCopy() {}, approveCopy() {}, report: error => errors.push(error),
  });
  return { view, root, state, calls, errors, confirmations: () => confirmations,
    element: id => root.querySelector('#precision-preparation-' + id) };
}

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
