import { planDirectItems } from '../../shared/publish/direct-lane.js';

/**
 * 直连上架面板（Lane A）：价格 / 库存 / 仓库 / 预检 / 上架 / 结果。
 *
 * 为什么单独一条车道：ERP 的 /source-workbench/editor/save 是单点写通道，
 * 一次超时就把整个工作台拖死；而发一个商品到 Ozon 只需要
 * offer_id + 属性 + 价格 + 尺寸 + 图片，不依赖 ERP 写入。
 *
 * 价格与库存的设置形状参考了精铺/知了：
 *   - 倍率 + 固定加价 → 售价，折扣前价按倍率放大（可改）
 *   - 库存按仓库批量设置，逐 SKU 可改；仓库列表来自 /v2/warehouse/list
 */
export function createDirectLanePanel({ root, make, send, getContext, status, report, onPublished }) {
  const panel = make('section', 'precision-direct-lane');
  panel.setAttribute('data-direct-lane', '1');
  const head = make('div', 'precision-local-fields');
  const title = make('strong', '', '直连上架（不写 ERP）');
  const state = make('span', '', '按 SKU 一条商品，同款靠合并字段自动成多变体。');
  head.append(title, state);

  const toolbar = make('div', 'precision-local-fields');
  const mkInput = (label, value, attrs = {}) => {
    const wrap = make('label', '', label + ' ');
    const input = make('input');
    input.type = 'number';
    input.value = String(value);
    input.style.width = '76px';
    for (const [key, v] of Object.entries(attrs)) input.setAttribute(key, String(v));
    wrap.append(input);
    return { wrap, input };
  };
  const multiplier = mkInput('倍率', '3.0', { step: '0.1', min: '1' });
  const markup = mkInput('加价 CNY', '0', { step: '1', min: '0' });
  const strike = mkInput('折扣前倍率', '1.5', { step: '0.1', min: '1' });
  const stock = mkInput('库存', '10', { step: '1', min: '0' });
  const weight = mkInput('重量 g', '250', { step: '10', min: '1' });
  const widthIn = mkInput('宽 mm', '200', { step: '10', min: '1' });
  const heightIn = mkInput('高 mm', '40', { step: '1', min: '1' });
  const depthIn = mkInput('长 mm', '300', { step: '10', min: '1' });
  const warehouseWrap = make('label', '', '仓库 ');
  const warehouse = make('select');
  const refreshWarehouses = make('button', 'ghost', '刷新仓库');
  warehouseWrap.append(warehouse);
  // 2026-11：默认**不覆盖**线上已有价格。第一次实测里面板用「成本×3」把
  // 1990 改成了 84，这个开关就是那道闸。
  const overrideWrap = make('label', '');
  const overridePrice = make('input');
  overridePrice.type = 'checkbox';
  overrideWrap.append(overridePrice, make('span', '', ' 覆盖线上价（成本×倍率）'));
  toolbar.append(multiplier.wrap, markup.wrap, strike.wrap, stock.wrap, overrideWrap,
    weight.wrap, widthIn.wrap, heightIn.wrap, depthIn.wrap, warehouseWrap, refreshWarehouses);

  // 俄文文案：直连车道不依赖 ERP 的 COPY_GENERATE，先支持手填/粘贴
  const copyRow = make('div', 'precision-local-fields');
  const titleWrap = make('label', '', '俄文标题 ');
  const titleInput = make('input');
  titleInput.type = 'text';
  titleInput.placeholder = 'Платье женское летнее…';
  titleInput.style.minWidth = '420px';
  titleWrap.append(titleInput);
  const descWrap = make('label', '', '俄文描述 ');
  const descInput = make('input');
  descInput.type = 'text';
  descInput.placeholder = '（可留空，Ozon 允许无描述）';
  descInput.style.minWidth = '420px';
  descWrap.append(descInput);
  copyRow.append(titleWrap, descWrap);

  const actions = make('div', 'precision-local-fields');
  const precheck = make('button', 'ghost', '预检载荷');
  const publishBtn = make('button', 'primary', '直连上架');
  const closeHint = make('span', '', '');
  actions.append(precheck, publishBtn, closeHint);

  const table = make('div');
  const output = make('pre');
  output.style.cssText = 'max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px;';
  panel.append(head, toolbar, copyRow, actions, table, output);
  root.append(panel);

  let busy = false;
  let lastPlan = null;
  let warehouses = [];

  const money = (value) => (Number.isFinite(value) ? (Math.round(value * 100) / 100).toFixed(2) : '—');

  function priceFor(cost) {
    const base = Number(cost);
    if (!Number.isFinite(base) || base <= 0) return null;
    const m = Number(multiplier.input.value);
    const add = Number(markup.input.value);
    const k = Number(strike.input.value);
    const price = base * (Number.isFinite(m) && m > 0 ? m : 1) + (Number.isFinite(add) ? add : 0);
    const old = price * (Number.isFinite(k) && k > 1 ? k : 1);
    return { price: Math.round(price * 100) / 100, oldPrice: Math.round(old * 100) / 100 };
  }

  async function loadWarehouses() {
    try {
      // 2026-11：/v1/warehouse/list 已废弃（400 code 9 obsolete method），现役是 /v2
      const result = await send('ss-erp:direct-ozon-post', { path: '/v2/warehouse/list', body: {} });
      warehouses = Array.isArray(result && result.warehouses) ? result.warehouses
        : Array.isArray(result && result.result) ? result.result
          : (Array.isArray(result) ? result : []);
      warehouse.replaceChildren();
      if (!warehouses.length) {
        const option = make('option', '', '（该店铺没有仓库）');
        option.value = '';
        warehouse.append(option);
        return { count: 0 };
      }
      for (const one of warehouses) {
        const option = make('option', '', `${one.name || one.warehouse_id} (${one.warehouse_id})`);
        option.value = String(one.warehouse_id);
        warehouse.append(option);
      }
      return { count: warehouses.length };
    } catch (error) {
      warehouse.replaceChildren();
      const option = make('option', '', '读取仓库失败');
      option.value = '';
      warehouse.append(option);
      return { count: 0, error: String((error && error.message) || error) };
    }
  }

  function renderTable(plan) {
    table.replaceChildren();
    for (const item of plan.items) {
      const row = make('div', 'precision-local-fields');
      const cost = item.__cost;
      const label = make('span', '', `${item.suffix} · 成本 ${cost == null ? '—' : money(cost)} → 售价 ${item.price || '—'} / 折扣前 ${item.oldPrice || '—'}（${item.priceSource || '成本×倍率'}）`);
      label.style.marginRight = '10px';
      const badge = make('span', '', item.blockers.length ? `缺：${item.blockers.join(' / ')}` : '就绪');
      badge.style.color = item.blockers.length ? '#f59e0b' : '#22c55e';
      row.append(label, badge);
      table.append(row);
    }
  }

  async function buildPlan() {
    const context = getContext();
    if (!context || !context.binding) throw new Error('请先读取 ERP 草稿');
    const workspace = await send('ss-erp:direct-erp-editor', { kind: 'attributes', binding: context.binding });
    const skus = context.skus || [];
    const items = [];
    const editorStub = {
      category: context.category,
      selectedSkuKeys: skus.map((sku) => sku.key),
      copy: { titleRu: String(titleInput.value || '').trim(), descriptionRu: String(descInput.value || '').trim() },
      pricing: { items: skus.map((sku) => {
        const computed = priceFor(sku.cost);
        return { skuKey: sku.key, price: computed ? computed.price : null, oldPrice: computed ? computed.oldPrice : null, currencyCode: 'CNY', vat: '0' };
      }) },
      packaging: skus.map((sku) => ({ skuKey: sku.key, weightG: Number(weight.input.value), widthMm: Number(widthIn.input.value), heightMm: Number(heightIn.input.value), depthMm: Number(depthIn.input.value) })),
    };
    const plan = planDirectItems({
      editor: editorStub,
      workspace,
      offerBase: context.offerBase,
      images: (context.images || []).map((url) => ({ scope: 'PRODUCT', skuKey: null, url })),
      defaults: { currency: 'CNY', vat: '0' },
    });
    plan.items.forEach((item, index) => { item.__cost = skus[index] && skus[index].cost; item.categoryId = plan.category.categoryId; item.typeId = plan.category.typeId; item.priceSource = '成本×倍率'; });

    // 价格策略：先查线上现有价。
    //   - 没勾「覆盖线上价」→ 直接用现有价（重复上架不会产生任何改价）
    //   - 勾了 → 允许改价，但幅度超过 20% 直接拦下来，并说明后果
    // 2026-11 实测：上架时写 84、随后改回 1990，两次大幅改价让 Ozon 把三张卡
    // 全部丢进了「价格隔离」（availabilities.reasons = "Товар в карантине цен"），
    // 商品从在售变 Не продается。价格只能在上架前定一次，上架后改价是危险动作。
    if (plan.items.length) {
      try {
        const info = await send('ss-erp:direct-ozon-post', {
          path: '/v3/product/info/list',
          body: { offer_id: plan.items.map((item) => item.offerId) },
        });
        const byOffer = new Map((info && Array.isArray(info.items) ? info.items : []).map((it) => [String(it.offer_id), it]));
        for (const item of plan.items) {
          const hit = byOffer.get(item.offerId);
          const existing = hit && Number(hit.price) > 0 ? Number(hit.price) : 0;
          if (!existing) { item.priceSource = '首次上架'; continue; }
          if (!overridePrice.checked) {
            item.price = existing.toFixed(2);
            if (Number(hit.old_price) > 0) item.oldPrice = Number(hit.old_price).toFixed(2);
            item.priceSource = '线上现有';
            continue;
          }
          const next = Number(item.price);
          const ratio = existing > 0 && Number.isFinite(next) ? Math.abs(next - existing) / existing : 0;
          item.priceSource = `改价 ${existing.toFixed(2)} → ${Number(item.price).toFixed(2)}`;
          if (ratio > 0.2) {
            item.blockers.push('PRICE_JUMP');
            plan.blockers.push({
              scope: item.offerId,
              code: 'PRICE_JUMP',
              detail: `线上 ${existing.toFixed(2)} → ${Number(item.price).toFixed(2)}（${(ratio * 100).toFixed(0)}%），Ozon 会触发价格隔离、商品下架`,
            });
            plan.ready = false;
          }
        }
      } catch (_error) { /* 读不到就保留成本×倍率，预检里能看到价格 */ }
    }
    return plan;
  }

  async function runPrecheck() {
    if (busy) return;
    busy = true;
    precheck.disabled = publishBtn.disabled = true;
    try {
      const plan = await buildPlan();
      lastPlan = plan;
      renderTable(plan);
      if (warehouses.length === 0) await loadWarehouses();
      output.textContent = JSON.stringify({
        category: plan.category,
        skuCount: plan.skuCount,
        requiredFieldCount: plan.requiredFieldCount,
        ready: plan.ready,
        blockers: plan.blockers,
        notes: plan.notes,
        items: plan.items.map((item) => ({ offerId: item.offerId, attributes: item.attributeCount, price: item.price, oldPrice: item.oldPrice, images: item.images.length, missingRequired: item.missingRequired })),
      }, null, 2);
      state.textContent = plan.ready ? `预检通过：${plan.items.length} 条商品可上架` : `预检未通过：${plan.blockers.length} 个待补项`;
    } catch (error) {
      state.textContent = String((error && error.message) || error);
      report?.(error);
    } finally {
      busy = false;
      precheck.disabled = publishBtn.disabled = false;
    }
  }

  async function runPublish() {
    if (busy) return;
    busy = true;
    precheck.disabled = publishBtn.disabled = true;
    try {
      const plan = await buildPlan();
      lastPlan = plan;
      renderTable(plan);
      if (!plan.ready) throw new Error('预检未通过，先补齐：' + plan.blockers.map((one) => one.code).join(' / '));
      const items = plan.items.map((item) => ({
        offerId: item.offerId,
        name: item.name,
        description: item.description,
        categoryId: item.categoryId,
        typeId: item.typeId,
        price: item.price,
        oldPrice: item.oldPrice,
        currency: item.currency,
        vat: item.vat,
        weight: item.weight,
        dimensions: item.dimensions,
        images: item.images,
        attributes: item.attributes,
      }));
      state.textContent = `提交中：${items.length} 条，图片落定需要 40 秒…`;
      output.textContent = '';
      const result = await send('ss-erp:direct-publish', { items, options: { pictureSettleMs: 40000, maxPolls: 24 } });
      output.textContent = JSON.stringify(result, null, 2);
      const merged = new Map();
      for (const one of (result.items || [])) if (one.modelId) merged.set(one.modelId, (merged.get(one.modelId) || 0) + 1);
      state.textContent = `上架完成：${(result.items || []).length} 条，状态 ${result.status}`
        + (merged.size ? `；合并到 ${merged.size} 个 model（变体数 ${[...merged.values()].join('/')}）` : '');

      const stockCount = Number(stock.input.value);
      const warehouseId = Number(warehouse.value);
      if (Number.isFinite(stockCount) && stockCount > 0 && warehouseId > 0) {
        const offers = items.map((item) => item.offerId);
        const stocks = await send('ss-erp:direct-ozon-post', {
          // /v1/product/import/stocks 是 404，现役是 /v2/products/stocks
          path: '/v2/products/stocks',
          body: { stocks: offers.map((offerId) => ({ offer_id: offerId, stock: stockCount, warehouse_id: warehouseId })) },
        });
        output.textContent += '\n\n库存提交：' + JSON.stringify(stocks).slice(0, 600);
      } else if (Number.isFinite(stockCount) && stockCount > 0) {
        output.textContent += '\n\n库存未提交：没有可用仓库（店铺需先开通 FBS 仓库）';
      }
      onPublished?.(result);
    } catch (error) {
      state.textContent = String((error && error.message) || error);
      report?.(error);
    } finally {
      busy = false;
      precheck.disabled = publishBtn.disabled = false;
    }
  }

  precheck.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void runPrecheck();
  });
  publishBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void runPublish();
  });
  refreshWarehouses.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void loadWarehouses().then((result) => { state.textContent = result.error ? `仓库读取失败：${result.error}` : `仓库：${result.count} 个`; });
  });

  return {
    panel,
    refresh: () => loadWarehouses(),
    lastPlan: () => lastPlan,
  };
}
