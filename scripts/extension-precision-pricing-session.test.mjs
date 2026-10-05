import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const file = 'extensions/ss-erp/pages/donor/pricing-tool.js';
const engineContext = { window: {} };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/calculator-core/profit-engine.js', 'utf8'), engineContext);
const load = () => import('../' + file);
const parameters = { commissionPct: 10, adPct: 0, otherPct: 0, targetMarginPct: 20,
  discountPct: 0, domesticFee: 0, packingFee: 0, currency: 'CNY' };

test('batch pricing binds confirmed per-SKU costs to one preview and applies only its prices', async () => {
  const { createPricingSession } = await load();
  const applied = [];
  const session = createPricingSession({ calculate: engineContext.window.OZON_CALC_PROFIT_ENGINE.calculateSalePriceForTargetMargin,
    getContext: () => 'draft:1:sku-a,sku-b', apply: value => applied.push(value) });
  const results = session.preview(parameters, [{ skuKey: 'a', cost: 14, shippingCost: 0 }, { skuKey: 'b', cost: 21, shippingCost: 0 }]);
  assert.deepEqual(results.map(result => result.price), ['20.00', '30.00']);
  assert.equal(applied.length, 0, 'preview does not save or mutate editor rows');
  session.apply(parameters, [{ skuKey: 'a', cost: 14, shippingCost: 0 }, { skuKey: 'b', cost: 21, shippingCost: 0 }]);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], { currency: 'CNY', items: [{ skuKey: 'a', price: '20.00', oldPrice: '20.00' },
    { skuKey: 'b', price: '30.00', oldPrice: '30.00' }] });
});

test('stale shop/draft, fees, currency or SKU costs reject application without touching rows', async () => {
  const { createPricingSession } = await load();
  for (const change of ['context', 'fees', 'rows', 'currency']) {
    let context = 'shop-a:draft:1';
    let applications = 0;
    const session = createPricingSession({ calculate: engineContext.window.OZON_CALC_PROFIT_ENGINE.calculateSalePriceForTargetMargin,
      getContext: () => context, apply: () => { applications++; } });
    const rows = [{ skuKey: 'a', cost: 14, shippingCost: 0 }];
    session.preview(parameters, rows);
    if (change === 'context') context = 'shop-b:draft:2';
    const updated = change === 'fees' ? { ...parameters, adPct: 1 } : change === 'currency' ? { ...parameters, currency: 'RUB', fxRate: 0.1 } : parameters;
    const selected = change === 'rows' ? [{ ...rows[0], cost: 15 }] : rows;
    assert.throws(() => session.apply(updated, selected), /重新计算/);
    assert.equal(applications, 0);
  }
});

test('a failed or incomplete preview cannot apply earlier results', async () => {
  const { createPricingSession } = await load();
  let applications = 0;
  const session = createPricingSession({ calculate: engineContext.window.OZON_CALC_PROFIT_ENGINE.calculateSalePriceForTargetMargin,
    getContext: () => 'draft:1', apply: () => { applications++; } });
  const rows = [{ skuKey: 'a', cost: 14, shippingCost: 0 }];
  session.preview(parameters, rows);
  assert.throws(() => session.preview(parameters, [{ ...rows[0], shippingCost: '' }]));
  assert.throws(() => session.apply(parameters, rows));
  assert.throws(() => session.preview(parameters, [rows[0], rows[0]]));
  assert.throws(() => session.preview(parameters, []));
  assert.equal(applications, 0);
});

class UiElement {
  constructor(tag, registry) { this.tag = tag; this.registry = registry; this.children = []; this.listeners = new Map(); this.dataset = {}; this.value = ''; this.disabled = false; }
  set id(value) { this.registry.set(value, this); }
  append(...items) { this.children.push(...items); }
  prepend(...items) { this.children.unshift(...items); }
  replaceChildren(...items) { this.children = items; this.value = ''; }
  setAttribute() {}
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  trigger(type, trusted = true) { return this.listeners.get(type)?.({ isTrusted: trusted }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
async function pricingUi(options = {}) {
  const { createPricingTool } = await load();
  const registry = new Map(), applied = [], commands = [], reports = [];
  globalThis.document = { createElement: tag => new UiElement(tag, registry) };
  globalThis.OZON_CALC_PROFIT_ENGINE = engineContext.window.OZON_CALC_PROFIT_ENGINE;
  const root = new UiElement('root', registry);
  let currentContext = 'draft:1', busy = false, lastQuote;
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 1, draftVersion: 1 };
  const selection = { assignmentId: 'assignment', warehouseId: 'warehouse', companyId: 'company', originCountryUid: 'cn', originCityUid: 'city', destinationCountryUid: 'ru', destinationLocationUid: 'dest' };
  const command = async (type, payload) => {
    commands.push({ type, payload });
    if (options.command) { const overridden = options.command(type, payload); if (overridden) return overridden; }
    const lease = () => new Date(Date.now() + 60_000).toISOString();
    const common = { binding, selection, releaseId: 'release', effectiveChecksum: 'b'.repeat(64), validUntil: lease(), authorizationValidUntil: lease() };
    const data = type === 'LOGISTICS_SCOPES'
      ? { binding, assignments: [{ ...selection, warehouseName: 'Warehouse', originLabel: 'CN/City', destinationLabel: 'RU/City' }], hints: { commission: null, fx: null } }
      : type === 'LOGISTICS_SERVICES' ? { ...common, services: [{ stableServiceKey: 'service', displayName: 'Parcel', deliveryPromise: '10 days' }] }
        : { ...common, stableServiceKey: 'service', items: payload.items.map(item => ({ ...item, shippingCostCny: 15 })) };
    if (type === 'LOGISTICS_QUOTE') lastQuote = data;
    return { data: { logistics: data } };
  };
  const tool = createPricingTool({ root, getRows: () => ['a', 'b'].map(skuKey => ({ skuKey, label: skuKey, cost: 70 })),
    getCurrency: () => 'CNY', getContext: () => currentContext, getBinding: () => binding,
    getBusy: () => busy, command, applyPrices: value => applied.push(value), report: error => reports.push(error) });
  tool.open();
  registry.get('precision-pricing-commissionPct').value = '10';
  const rowInput = (skuKey, kind) => {
    const stack = [root];
    while (stack.length) { const node = stack.pop(); if (node.dataset?.pricingSku === skuKey && node.dataset.pricingField === kind) return node; stack.push(...node.children); }
    throw Error('missing fixture row input');
  };
  return { tool, registry, applied, commands, reports, rowInput, lastQuote: () => lastQuote,
    setContext: value => { currentContext = value; }, setBusy: value => { busy = value; } };
}
async function applyAutomaticFreight(ui) {
  ui.registry.get('precision-pricing-logistics').trigger('click'); await tick();
  const scope = ui.registry.get('precision-logistics-scope'); scope.value = '0'; scope.trigger('change');
  ui.registry.get('precision-logistics-read').trigger('click'); await tick();
  const service = ui.registry.get('precision-logistics-service'); service.value = 'service'; service.trigger('change');
  const battery = ui.registry.get('precision-logistics-battery'); battery.value = 'no'; battery.trigger('change');
  ui.registry.get('precision-logistics-quote').trigger('click'); await tick();
  assert.equal(ui.rowInput('a', 'shipping').value, '15');
  assert.equal(ui.rowInput('b', 'shipping').value, '15');
}

test('real pricing UI invalidates automatic freight for every price-affecting input', async () => {
  for (const field of ['commissionPct', 'targetMarginPct', 'adPct', 'otherPct', 'packingFee', 'domesticFee', 'fxRate', 'discountPct', 'currency', 'cost']) {
    const ui = await pricingUi(); await applyAutomaticFreight(ui);
    const input = field === 'cost' ? ui.rowInput('a', 'cost') : ui.registry.get('precision-pricing-' + field);
    input.value = field === 'currency' ? 'RUB' : '30'; input.trigger(field === 'currency' ? 'change' : 'input');
    assert.equal(ui.rowInput('a', 'shipping').value, '', field);
    assert.equal(ui.rowInput('b', 'shipping').value, '', field);
    ui.registry.get('precision-pricing-preview').trigger('click');
    assert.equal(ui.registry.get('precision-pricing-apply').disabled, true, field);
    assert.equal(ui.applied.length, 0, field);
  }
});

test('editing freight explicitly retains the manual value and clears only the remaining automatic rows', async () => {
  const ui = await pricingUi(); await applyAutomaticFreight(ui);
  const freight = ui.rowInput('a', 'shipping'); freight.value = '25'; freight.trigger('input');
  assert.equal(freight.value, '25');
  assert.equal(ui.rowInput('b', 'shipping').value, '');
  ui.rowInput('b', 'shipping').value = '20'; ui.rowInput('b', 'shipping').trigger('input');
  ui.registry.get('precision-pricing-preview').trigger('click');
  assert.equal(ui.registry.get('precision-pricing-apply').disabled, false);
  ui.registry.get('precision-pricing-apply').trigger('click');
  assert.equal(ui.applied.length, 1);
  assert.equal(ui.commands.filter(item => item.type === 'LOGISTICS_QUOTE').length, 2);
});

test('manual freight survives commission changes and remains an explicitly editable estimate', async () => {
  const ui = await pricingUi();
  for (const skuKey of ['a', 'b']) { ui.rowInput(skuKey, 'shipping').value = '20'; ui.rowInput(skuKey, 'shipping').trigger('input'); }
  const commission = ui.registry.get('precision-pricing-commissionPct'); commission.value = '20'; commission.trigger('input');
  assert.equal(ui.rowInput('a', 'shipping').value, '20');
  assert.equal(ui.rowInput('b', 'shipping').value, '20');
  ui.registry.get('precision-pricing-preview').trigger('click'); ui.registry.get('precision-pricing-apply').trigger('click');
  assert.equal(ui.applied.length, 1);
  assert.equal(ui.commands.length, 0);
});

test('expired automatic authorization rejects preview and later application with no table mutation', async () => {
  const originalNow = Date.now;
  try {
    const ui = await pricingUi(); await applyAutomaticFreight(ui);
    ui.registry.get('precision-pricing-preview').trigger('click');
    assert.equal(ui.registry.get('precision-pricing-apply').disabled, false);
    Date.now = () => originalNow() + 61_000;
    ui.registry.get('precision-pricing-apply').trigger('click');
    assert.equal(ui.applied.length, 0);
    assert.match(ui.registry.get('precision-pricing-state').textContent, /过期/);
  } finally { Date.now = originalNow; }
});

test('a recalculated price outside the verified automatic quote invalidates the prepared session', async () => {
  const ui = await pricingUi(); await applyAutomaticFreight(ui);
  ui.rowInput('a', 'cost').value = '71'; // Changed through script without an input event must still fail.
  ui.registry.get('precision-pricing-preview').trigger('click');
  assert.equal(ui.registry.get('precision-pricing-apply').disabled, true);
  ui.registry.get('precision-pricing-apply').trigger('click');
  assert.equal(ui.applied.length, 0);
  assert.match(ui.registry.get('precision-pricing-state').textContent, /价档|变化/);
});

test('pending logistics reads disable repricing, preview, freight filling and table application', async () => {
  const pending = deferred();
  const ui = await pricingUi({ command: type => type === 'LOGISTICS_SCOPES' ? pending.promise : undefined });
  for (const sku of ['a', 'b']) ui.rowInput(sku, 'shipping').value = '10';
  ui.registry.get('precision-pricing-preview').trigger('click');
  ui.registry.get('precision-pricing-logistics').trigger('click'); await tick(); ui.tool.sync();
  for (const id of ['logistics', 'preview', 'fill-freight', 'apply']) assert.equal(ui.registry.get('precision-pricing-' + id).disabled, true, id);
  ui.registry.get('precision-pricing-logistics').trigger('click');
  ui.registry.get('precision-pricing-preview').trigger('click');
  ui.registry.get('precision-pricing-apply').trigger('click');
  assert.equal(ui.commands.length, 1);
  assert.equal(ui.applied.length, 0);
  pending.resolve({ data: { logistics: { assignments: [], hints: {} } } }); await tick();
});

test('workbench busy blocks automatic quotation as well as manual price application', async () => {
  const ui = await pricingUi(); ui.setBusy(true); ui.tool.sync();
  assert.equal(ui.registry.get('precision-pricing-logistics').disabled, true);
  ui.registry.get('precision-pricing-logistics').trigger('click'); await tick();
  assert.equal(ui.commands.length, 0);
});

test('closing, reopening or changing pricing context cancels a pending logistics callback', async () => {
  for (const action of ['close', 'open', 'context']) {
    const pending = deferred();
    const ui = await pricingUi({ command: type => type === 'LOGISTICS_SCOPES' ? pending.promise : undefined });
    ui.registry.get('precision-pricing-logistics').trigger('click'); await tick();
    if (action === 'close') ui.registry.get('precision-pricing-close').trigger('click');
    if (action === 'open') ui.tool.open();
    if (action === 'context') { ui.setContext('different:context'); ui.tool.sync(); }
    pending.resolve({ data: { logistics: { assignments: [], hints: { fx: { rate: 0.09 } } } } }); await tick();
    assert.equal(ui.registry.get('precision-logistics-modal').hidden, true, action);
    assert.equal(ui.registry.get('precision-pricing-fxRate').value, '', action);
    assert.equal(ui.applied.length, 0, action);
  }
});

test('logistics request completion restores parent pricing controls after projection-driven busy updates', async () => {
  let ui;
  ui = await pricingUi({ command: type => {
    if (type === 'LOGISTICS_SERVICES' || type === 'LOGISTICS_QUOTE') {
      ui.tool.sync(); // The source bridge sends a busy projection during the real command.
      assert.equal(ui.registry.get('precision-pricing-preview').disabled, true);
    }
  } });
  await applyAutomaticFreight(ui);
  ui.registry.get('precision-logistics-close').trigger('click');
  for (const id of ['preview', 'fill-freight', 'logistics']) assert.equal(ui.registry.get('precision-pricing-' + id).disabled, false, id);
  ui.registry.get('precision-pricing-preview').trigger('click');
  assert.equal(ui.registry.get('precision-pricing-apply').disabled, false);
  assert.equal(ui.applied.length, 0, 'a quote restores preview without applying prices');
  ui.registry.get('precision-pricing-apply').trigger('click');
  assert.equal(ui.applied.length, 1);
});

test('closing a pending logistics dialog releases local busy without requiring another projection', async () => {
  const pending = deferred();
  let ui;
  ui = await pricingUi({ command: type => {
    if (type === 'LOGISTICS_SERVICES') { ui.tool.sync(); return pending.promise; }
  } });
  ui.registry.get('precision-pricing-logistics').trigger('click'); await tick();
  const scope = ui.registry.get('precision-logistics-scope'); scope.value = '0'; scope.trigger('change');
  ui.registry.get('precision-logistics-read').trigger('click'); await tick();
  assert.equal(ui.registry.get('precision-pricing-preview').disabled, true);
  ui.registry.get('precision-logistics-close').trigger('click');
  assert.equal(ui.registry.get('precision-pricing-preview').disabled, false);
  pending.resolve({ data: { logistics: { services: [] } } }); await tick();
  assert.equal(ui.applied.length, 0);
});
