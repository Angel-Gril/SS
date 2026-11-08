export function createPricingSession({ calculate, getContext, apply }) {
  let prepared = null;
  const fingerprint = (parameters, rows) => JSON.stringify([getContext(), parameters, rows]);
  return {
    preview(parameters, rows) {
      prepared = null;
      if (!getContext() || !Array.isArray(rows) || !rows.length || rows.length > 100
        || new Set(rows.map(row => row.skuKey)).size !== rows.length) throw new Error('请读取当前草稿所选 SKU 后重新计算');
      const results = rows.map(row => ({ skuKey: row.skuKey,
        ...calculate({ ...parameters, cost: row.cost, shippingCost: row.shippingCost }) }));
      prepared = { fingerprint: fingerprint(parameters, rows), currency: parameters.currency,
        items: results.map(({ skuKey, price, oldPrice }) => ({ skuKey, price, oldPrice })) };
      return results;
    },
    apply(parameters, rows) {
      if (!prepared || prepared.fingerprint !== fingerprint(parameters, rows)) throw new Error('草稿或定价输入已变化，请重新计算后再应用');
      const result = { currency: prepared.currency, items: prepared.items.map(item => ({ ...item })) };
      apply(result);
      prepared = null;
    },
    invalidate() { prepared = null; },
  };
}

import { createLogisticsPricing } from './logistics-pricing.js';
export function createPricingTool({ root, getRows, getCurrency, getContext, getBusy, getBinding, command, applyPrices, report }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const modal = make('div', 'settings-modal'); modal.id = 'precision-pricing-modal'; modal.hidden = true;
  const dialog = make('div', 'settings-dialog precision-pricing-dialog');
  const head = make('div', 'settings-head'); head.append(make('div', 'settings-title', '定价工具'));
  const close = make('button', 'ghost', '关闭'); close.id = 'precision-pricing-close'; close.type = 'button';
  close.addEventListener('click', () => closePricing()); head.append(close);
  const body = make('div', 'settings-body');
  const notice = make('p', 'precision-pricing-notice', '按销售收入计算目标毛利。运费、佣金与汇率由你确认；划线价按折扣比例计算，仅作为参考价。');
  const inputs = new Map();
  const grid = make('div', 'precision-pricing-fields');
  const parameters = [
    ['commissionPct', '平台佣金（%）', ''], ['targetMarginPct', '目标销售毛利（%）', '20'],
    ['discountPct', '划线价折扣比例（%）', '30'], ['adPct', '广告费（%）', '0'],
    ['otherPct', '其他比例费用（%）', '0'], ['packingFee', '每件包装费（CNY）', '0'],
    ['domesticFee', '每件国内运费及杂费（CNY）', '0'], ['fxRate', '汇率：1 RUB = 多少 CNY', ''],
  ];
  for (const [key, label, value] of parameters) {
    const field = make('label', 'field', label), input = make('input');
    input.id = 'precision-pricing-' + key; input.type = 'number'; input.min = '0'; input.step = '0.01'; input.value = value;
    input.setAttribute('aria-label', label); field.append(input); grid.append(field); inputs.set(key, input);
  }
  const currencyLabel = make('label', 'field', '售价币种'), currency = make('select'); currency.id = 'precision-pricing-currency';
  for (const code of ['CNY', 'RUB']) { const option = make('option', '', code); option.value = code; currency.append(option); }
  currencyLabel.append(currency); grid.append(currencyLabel);
  const batch = make('div', 'precision-pricing-batch'), freight = make('input'); freight.id = 'precision-pricing-freight';
  freight.type = 'number'; freight.min = '0'; freight.step = '0.01'; freight.setAttribute('aria-label', '统一运费估算（CNY/件）');
  const freightLabel = make('label', '', '统一运费估算（CNY/件）'); freightLabel.htmlFor = freight.id;
  const fillFreight = make('button', 'ghost', '填写全部 SKU'); fillFreight.id = 'precision-pricing-fill-freight'; fillFreight.type = 'button';
  batch.append(freightLabel, freight, fillFreight);
  const automatic=make('button','ghost','按店铺物流自动计算');automatic.id='precision-pricing-logistics';automatic.type='button';batch.append(automatic);
  const tableWrap = make('div', 'precision-pricing-table'), table = make('table'), header = make('thead'), headerRow = make('tr');
  for (const label of ['SKU', '采购成本 CNY', '运费估算 CNY', '售价', '划线价', '预计毛利']) headerRow.append(make('th', '', label));
  header.append(headerRow); const rowsBody = make('tbody'); table.append(header, rowsBody); tableWrap.append(table);
  const state = make('p'); state.id = 'precision-pricing-state'; state.setAttribute('role', 'status');
  const foot = make('div', 'settings-foot'), preview = make('button', 'ghost', '计算预览'), apply = make('button', 'primary', '应用到表格');
  preview.id = 'precision-pricing-preview'; apply.id = 'precision-pricing-apply'; preview.type = apply.type = 'button'; apply.disabled = true;
  foot.append(preview, apply);
  const saveNotice = make('p', 'precision-pricing-notice', '应用只填写售价与划线价。点击原表格“保存价格与货号”后，才会写入当前草稿。');
  body.append(notice, grid, batch, tableWrap, state, saveNotice); dialog.append(head, body, foot); modal.append(dialog); root.append(modal);
  let context = '', rows = [], hasPreview = false, automaticQuote = null, viewEpoch = 0;
  const session = createPricingSession({ calculate: input => globalThis.OZON_CALC_PROFIT_ENGINE.calculateSalePriceForTargetMargin(input), getContext, apply: applyPrices });
  const readParameters = () => ({ ...Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])), currency: currency.value });
  const readRows = () => rows.map(row => ({ skuKey: row.skuKey, cost: row.cost.value, shippingCost: row.freight.value }));
  let logistics = null;
  logistics=createLogisticsPricing({root,command,getBinding,getRows:readRows,getParameters:readParameters,
   onBusyChanged(){ if (logistics) sync(); },
   calculate:input=>globalThis.OZON_CALC_PROFIT_ENGINE.calculateSalePriceForTargetMargin(input),onQuote(value){
    if (modal.hidden || context !== getContext() || value.items.length !== rows.length
      || new Set(value.items.map(item => item.skuKey)).size !== rows.length
      || value.items.some(item => !rows.some(row => row.skuKey === item.skuKey))) {
      throw Error('草稿或定价窗口已变化，报价未应用，请重新计算');
    }
    invalidate();
    for(const item of value.items){const row=rows.find(row=>row.skuKey===item.skuKey);row.freight.value=String(item.shippingCostCny);row.automaticFreight=true;}
    automaticQuote=value;
    state.textContent='运费已按当前店铺路线更新，请点击计算预览。';
   },report});
  const operationBusy = () => getBusy() || logistics.isBusy();
  const interactive = () => !modal.hidden && context === getContext() && !operationBusy();
  automatic.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || automatic.disabled || !interactive()) return;
    const run = ++viewEpoch;
    invalidate();
    const pending = logistics.open();
    sync();
    void pending.then(data => {
      if (run !== viewEpoch || modal.hidden || context !== getContext()) return;
      let changed = false;
      if (data?.hints?.fx && !inputs.get('fxRate').value) { inputs.get('fxRate').value = String(data.hints.fx.rate); changed = true; }
      if (data?.hints?.commission && !inputs.get('commissionPct').value) { inputs.get('commissionPct').value = String(data.hints.commission.percent); changed = true; }
      if (changed) invalidate();
    }).catch(report).finally(() => { if (run === viewEpoch) sync(); });
  });
  function invalidate(dropAutomatic = true, manualSkuKey) {
    if (dropAutomatic) {
      for (const row of rows) {
        if (row.automaticFreight && row.skuKey !== manualSkuKey) row.freight.value = '';
        row.automaticFreight = false;
      }
      automaticQuote = null;
    }
    session.invalidate(); hasPreview = false; apply.disabled = true;
    for (const row of rows) for (const cell of row.outputs) cell.replaceChildren();
    state.textContent = '请填写费用后计算预览。';
  }
  for (const input of inputs.values()) input.addEventListener('input', ()=>invalidate());
  currency.addEventListener('change', () => { inputs.get('fxRate').disabled = currency.value !== 'RUB'; invalidate(); });
  fillFreight.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || fillFreight.disabled || !interactive()) return;
    if (!freight.value || !Number.isFinite(Number(freight.value)) || Number(freight.value) < 0) {
      state.textContent = '请填写非负的统一运费估算，免运费可明确填写 0。'; return;
    }
    invalidate();
    for (const row of rows) row.freight.value = freight.value;
  });
  preview.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || preview.disabled || !interactive()) return;
    try {
      invalidate(false);
      const results = session.preview(readParameters(), readRows());
      if(automaticQuote){
        if(!['validUntil','authorizationValidUntil'].every(key=>Date.parse(automaticQuote[key])>Date.now()))throw Error('物流报价已过期，请重新按店铺物流计算');
        const params=readParameters();if(results.some(result=>{const quoted=automaticQuote.items.find(item=>item.skuKey===result.skuKey);return!quoted||Math.ceil(Number(result.price)*100*(params.currency==='RUB'?Number(params.fxRate):1))!==quoted.declaredPriceMinor;}))throw Error('售价与物流报价价档已变化，请重新计算物流');
      }
      results.forEach((result, index) => {
        rows[index].outputs[0].textContent = `${result.price} ${result.currency}`;
        rows[index].outputs[1].textContent = `${result.oldPrice} ${result.currency}`;
        const detail = make('details'), summary = make('summary', '', `${result.quote.marginPct.toFixed(2)}%`);
        detail.append(summary);
        for (const line of result.quote.feeLines) detail.append(make('div', '', `${line.label}：${line.amount.toFixed(2)} CNY`));
        detail.append(make('div', '', `预计利润：${result.quote.profit.toFixed(2)} CNY`));
        rows[index].outputs[2].append(detail);
      });
      hasPreview = true; apply.disabled = false; state.textContent = `已计算 ${results.length} 个 SKU，检查价格和费用后再应用。`;
    } catch (error) { invalidate(); state.textContent = error.message; }
  });
  apply.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || apply.disabled || !hasPreview || !interactive()) return;
    try {
      if(automaticQuote&&!['validUntil','authorizationValidUntil'].every(key=>Date.parse(automaticQuote[key])>Date.now()))throw Error('物流报价已过期，请重新计算');
      session.apply(readParameters(), readRows());
      hasPreview = false; closePricing();
    } catch (error) { invalidate(); state.textContent = error.message; report(error); }
  });
  function closePricing() {
    viewEpoch += 1;
    modal.hidden = true;
    logistics.close();
    invalidate();
  }
  function sync() {
    if (modal.hidden) return;
    if (context !== getContext()) { closePricing(); return; }
    const busy = operationBusy(); preview.disabled = fillFreight.disabled = automatic.disabled = busy; apply.disabled = busy || !hasPreview;
    currency.disabled = freight.disabled = busy;
    for (const [key, input] of inputs) input.disabled = busy || key === 'fxRate' && currency.value !== 'RUB';
    for (const row of rows) row.cost.disabled = row.freight.disabled = busy;
  }
  return {
    sync,
    open() {
      if (!getContext() || !getRows().length) throw new Error('请先采集并选择店铺建立草稿');
      viewEpoch += 1; logistics.close(); invalidate();
      context = getContext(); rowsBody.replaceChildren(); rows = [];
      currency.value = getCurrency(); inputs.get('fxRate').disabled = currency.value !== 'RUB';
      for (const source of getRows()) {
        const row = make('tr'), label = make('td', '', source.label), cost = make('input'), shipping = make('input');
        for (const [input, kind] of [[cost, 'cost'], [shipping, 'shipping']]) {
          input.type = 'number'; input.min = '0'; input.step = '0.01'; input.dataset.pricingSku = source.skuKey; input.dataset.pricingField = kind;
          input.setAttribute('aria-label', `${source.label} ${kind === 'cost' ? '采购成本 CNY' : '运费估算 CNY'}`);
          input.addEventListener('input', () => invalidate(true, kind === 'shipping' ? source.skuKey : undefined));
        }
        cost.value = source.cost > 0 ? String(source.cost) : ''; shipping.value = '';
        const costCell = make('td'), shippingCell = make('td'); costCell.append(cost); shippingCell.append(shipping);
        const outputs = [make('td'), make('td'), make('td')]; row.append(label, costCell, shippingCell, ...outputs); rowsBody.append(row);
        rows.push({ skuKey: source.skuKey, cost, freight: shipping, outputs, automaticFreight: false });
      }
      modal.hidden = false; invalidate(); sync();
    },
  };
}
