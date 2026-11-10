import { planDirectItems, offerIdFor } from '../../shared/publish/direct-lane.js';
import { buildRuTitle } from '../../shared/ozon/title-rules.js';

/**
 * 直连上架面板（Lane A）：标题 / 价格 / 库存 / 仓库 / 预检 / 上架 / 结果。
 *
 * 设计要点（都是踩过坑之后定的）：
 *   1. 价格在上架前一次性定好：每个 SKU 一行显式价格输入，首次上架用「成本×倍率」
 *      预填，已存在的商品用 Ozon 现有价预填。上架之后不再单独写价格 ——
 *      实测改价会让 Ozon 把卡片丢进「价格隔离」(Товар в карантине цен)。
 *   2. 标题走规则生成（shared/ozon/title-rules.js）：类目俄文名 + 性别 + 材质 + 特征。
 *      没有文本模型可用（provider 只挂了图像模型），所以不依赖 AI。
 *   3. 库存按仓库批量设置，提交到 /v2/products/stocks；仓库来自 /v2/warehouse/list
 *      （/v1 已废弃）。
 */
export function createDirectLanePanel({ root, make, send, getContext, status, report, onPublished }) {
  const panel = make('section', 'precision-direct-lane');
  panel.setAttribute('data-direct-lane', '1');
  const head = make('div', 'precision-local-fields');
  head.append(make('strong', '', '直连上架（不写 ERP）'),
    make('span', '', '按 SKU 一条商品，同款靠合并字段自动成多变体。'));

  const mkNumber = (label, value, attrs = {}) => {
    const wrap = make('label', '', label + ' ');
    const input = make('input');
    input.type = 'number';
    input.value = String(value);
    input.style.width = '80px';
    for (const [key, v] of Object.entries(attrs)) input.setAttribute(key, String(v));
    wrap.append(input);
    return { wrap, input };
  };

  const toolbar = make('div', 'precision-local-fields');
  const multiplier = mkNumber('倍率', '3.0', { step: '0.1', min: '1' });
  const markup = mkNumber('加价 CNY', '0', { step: '1', min: '0' });
  const strike = mkNumber('折扣前倍率', '1.5', { step: '0.1', min: '1' });
  const stockInput = mkNumber('库存', '10', { step: '1', min: '0' });
  const weightInput = mkNumber('重量 g', '250', { step: '10', min: '1' });
  const widthInput = mkNumber('宽 mm', '200', { step: '10', min: '1' });
  const heightInput = mkNumber('高 mm', '40', { step: '1', min: '1' });
  const depthInput = mkNumber('长 mm', '300', { step: '10', min: '1' });
  const warehouseWrap = make('label', '', '仓库 ');
  const warehouse = make('select');
  const refreshWarehouses = make('button', 'ghost', '刷新仓库');
  warehouseWrap.append(warehouse);
  const applyMultiplier = make('button', 'ghost', '按倍率填价');
  toolbar.append(multiplier.wrap, markup.wrap, strike.wrap, applyMultiplier, stockInput.wrap,
    weightInput.wrap, widthInput.wrap, heightInput.wrap, depthInput.wrap, warehouseWrap, refreshWarehouses);

  const copyRow = make('div', 'precision-local-fields');
  const titleWrap = make('label', '', '俄文标题 ');
  const titleInput = make('input');
  titleInput.type = 'text';
  titleInput.placeholder = '点「生成标题」或手填';
  titleInput.style.minWidth = '520px';
  titleWrap.append(titleInput);
  const generateTitle = make('button', 'ghost', '生成标题');
  const descWrap = make('label', '', '俄文描述 ');
  const descInput = make('input');
  descInput.type = 'text';
  descInput.placeholder = '（可留空）';
  descInput.style.minWidth = '360px';
  descWrap.append(descInput);
  copyRow.append(titleWrap, generateTitle, descWrap);

  const actions = make('div', 'precision-local-fields');
  const precheck = make('button', 'ghost', '预检载荷');
  const publishBtn = make('button', 'primary', '直连上架');
  const state = make('span', '', '');
  actions.append(precheck, publishBtn, state);

  const table = make('div');
  const output = make('pre');
  output.style.cssText = 'max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px;';
  panel.append(head, toolbar, copyRow, actions, table, output);
  root.append(panel);

  let busy = false;
  let lastPlan = null;
  let warehouses = [];
  let workspaceCache = null;
  // offerId → { priceInput, oldPriceInput }
  const priceInputs = new Map();

  const money = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—');

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
      // /v1/warehouse/list 已废弃（400 code 9 obsolete method），现役是 /v2
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

  /** 用当前倍率/加价重算每一行的价格输入 */
  function fillPricesByMultiplier(plan) {
    for (const item of plan.items) {
      const computed = priceFor(item.__cost);
      if (!computed) continue;
      const inputs = priceInputs.get(item.offerId);
      if (!inputs) continue;
      inputs.price.value = computed.price.toFixed(2);
      inputs.oldPrice.value = computed.oldPrice.toFixed(2);
      item.price = computed.price.toFixed(2);
      item.oldPrice = computed.oldPrice.toFixed(2);
      item.priceSource = '成本×倍率';
    }
  }

  function renderTable(plan) {
    table.replaceChildren();
    priceInputs.clear();
    for (const item of plan.items) {
      const row = make('div', 'precision-local-fields');
      row.append(make('span', '', `${item.suffix} · 成本 ${item.__cost == null ? '—' : money(item.__cost)}`));
      const priceWrap = make('label', '', ' 售价 ');
      const priceEl = make('input');
      priceEl.type = 'number';
      priceEl.step = '0.01';
      priceEl.min = '1';
      priceEl.style.width = '110px';
      priceEl.value = item.price || '';
      priceWrap.append(priceEl);
      const oldWrap = make('label', '', ' 折扣前 ');
      const oldEl = make('input');
      oldEl.type = 'number';
      oldEl.step = '0.01';
      oldEl.min = '1';
      oldEl.style.width = '110px';
      oldEl.value = item.oldPrice || '';
      oldWrap.append(oldEl);
      priceInputs.set(item.offerId, { priceInput: priceEl, oldPriceInput: oldEl });

      const badge = make('span', '', item.blockers.length ? ` 缺：${item.blockers.join(' / ')}` : ' 就绪');
      badge.style.color = item.blockers.length ? '#f59e0b' : '#22c55e';
      const source = make('span', '', item.priceSource ? `（${item.priceSource}）` : '');
      source.style.color = '#94a3b8';
      row.append(priceWrap, oldWrap, badge, source);
      table.append(row);
    }
  }

  /** 标题：规则生成。类目俄文名 + 性别 + 材质 + 特征词 */
  function generateTitleFor(context, workspace, ozonAttrs) {
    const fields = (workspace && workspace.fields) || [];
    const values = (workspace && workspace.values) || [];
    const byId = new Map(fields.map((field) => [Number(field.attributeId), field]));
    const fromOzon = new Map((ozonAttrs || []).map((one) => [Number(one.id), String(one.value || '')]));
    const attrValue = (id) => {
      if (!values.length && fromOzon.has(id)) return fromOzon.get(id);
      const rows = values.filter((row) => Number(row.attributeId) === id);
      const row = rows.find((one) => (Array.isArray(one.value) ? one.value.length : one.value)) || rows[0];
      if (!row) return fromOzon.get(id) || '';
      if (Array.isArray(row.dictionaryValueIds) && row.dictionaryValueIds.length && !row.value) return '';
      return Array.isArray(row.value) ? row.value.join(' ') : String(row.value || '');
    };
    const attributes = [];
    for (const [id, name] of [[9163, 'Пол'], [6383, 'Материал'], [8229, 'Тип']]) {
      const field = byId.get(id);
      const value = attrValue(id);
      if (value) attributes.push({ name: (field && field.name) || name, value });
    }
    return buildRuTitle({
      typeName: context.category && context.category.typeName,
      sourceTitle: context.sourceTitle,
      gender: attrValue(9163),
      material: attrValue(6383),
      attributes,
    });
  }

  /** 已上架商品：直接从 Ozon 读属性/尺寸/图片，完全不碰 ERP */
  async function fetchOzonProducts(offers) {
    if (!offers.length) return null;
    try {
      const result = await send('ss-erp:direct-ozon-post', {
        path: '/v4/product/info/attributes',
        body: { filter: { offer_id: offers, visibility: 'ALL' }, limit: Math.max(offers.length, 1) },
      });
      const rows = Array.isArray(result && result.result) ? result.result : [];
      if (!rows.length) return null;
      return new Map(rows.map((row) => [String(row.offer_id), row]));
    } catch (_error) { return null; }
  }

  /** 线上价格（/v4 product/info/attributes 不含价格，要单独查一次） */
  async function fetchOzonPrices(offers) {
    const map = new Map();
    if (!offers.length) return map;
    try {
      const info = await send('ss-erp:direct-ozon-post', {
        path: '/v3/product/info/list',
        body: { offer_id: offers },
      });
      for (const row of (info && Array.isArray(info.items) ? info.items : [])) {
        map.set(String(row.offer_id), { price: Number(row.price) || 0, oldPrice: Number(row.old_price) || 0 });
      }
    } catch (_error) { /* 忽略：预检里会显示缺价 */ }
    return map;
  }

  function planFromOzon(context, skus, offers, byOffer, priceMap) {
    const items = skus.map((sku, index) => {
      const offerId = offers[index];
      const row = byOffer.get(offerId);
      const values = (row.attributes || []).map((attribute) => {
        const list = (attribute.values || []).map((value) => {
          const id = Number(value && value.dictionary_value_id);
          if (Number.isSafeInteger(id) && id > 0) return { dictionary_value_id: id };
          const text = String((value && value.value) || '').trim();
          return text ? { value: text } : null;
        }).filter(Boolean);
        return list.length ? { id: Number(attribute.id), values: list } : null;
      }).filter(Boolean);
      const inputs = priceInputs.get(offerId);
      const fromInput = inputs ? Number(inputs.priceInput.value) : 0;
      const live = priceMap && priceMap.get(offerId);
      const price = Number.isFinite(fromInput) && fromInput > 0 ? fromInput : (live && live.price) || 0;
      const oldPrice = inputs && Number(inputs.oldPriceInput.value) > 0 ? Number(inputs.oldPriceInput.value) : (live && live.oldPrice) || 0;
      const images = (Array.isArray(row.images) ? row.images : []).filter((url) => /^https:\/\//.test(String(url))).slice(0, 15);
      const weight = Number(row.weight) || Number(weightInput.input.value);
      const dimensions = {
        height: Number(row.height) || Number(heightInput.input.value),
        depth: Number(row.depth) || Number(depthInput.input.value),
        width: Number(row.width) || Number(widthInput.input.value),
      };
      const name = String(titleInput.value || row.name || '').trim();
      const blockers = [];
      if (name.length < 3) blockers.push('TITLE_RU');
      if (!(price > 0)) blockers.push('PRICE');
      if (!(weight > 0)) blockers.push('WEIGHT');
      if (!(dimensions.height > 0 && dimensions.depth > 0 && dimensions.width > 0)) blockers.push('DIMENSIONS');
      if (!images.length) blockers.push('IMAGES');
      return {
        offerId, skuKey: sku.key, suffix: String(offerId).replace(String(context.offerBase) + '-', ''),
        categoryId: Number(row.description_category_id) || (context.category && context.category.categoryId),
        typeId: Number(row.type_id) || (context.category && context.category.typeId),
        attributes: values, attributeCount: values.length,
        price: price > 0 ? Number(price).toFixed(2) : null,
        oldPrice: null, currency: 'CNY', vat: '0',
        weight, dimensions, images, name,
        description: String(descInput.value || '').trim(),
        missingRequired: [], blockers, __cost: sku.cost, priceSource: '线上现有（来自 Ozon）',
      };
    });
    return {
      offerBase: context.offerBase,
      category: { categoryId: items[0] && items[0].categoryId, typeId: items[0] && items[0].typeId },
      skuCount: items.length,
      requiredFieldCount: 0,
      items,
      blockers: items.flatMap((item) => item.blockers.map((code) => ({ scope: item.offerId, code, detail: '' }))),
      notes: ['属性/尺寸/图片取自 Ozon 已上架商品，未读取 ERP 草稿'],
      ready: items.length > 0 && items.every((item) => item.blockers.length === 0),
    };
  }

  async function buildPlan() {
    const context = getContext();
    if (!context || !context.offerBase) throw new Error('请先采集来源商品');
    const skus = context.skus || [];
    const offers = skus.map((sku, index) => offerIdFor(context.offerBase, sku.key, index));

    // 已上架：属性/尺寸/图片从 Ozon 读（不依赖 ERP —— ERP 的 catalogRevision
    // 一变，editor/attributes 就会回 source_listing_catalog_stale，直连车道不该被它拖住）
    const existing = await fetchOzonProducts(offers);
    if (existing && offers.every((offer) => existing.has(offer))) {
      const priceMap = await fetchOzonPrices(offers);
      const plan = planFromOzon(context, skus, offers, existing, priceMap);
      if (!String(titleInput.value || '').trim()) titleInput.value = plan.items[0] && plan.items[0].name || '';
      return { plan, context, workspace: null };
    }

    // 新商品：必须有 ERP 草稿（要拿属性工作区）
    if (!context.binding) throw new Error('新商品需要先读取 ERP 草稿（当前草稿不可用）');
    const workspace = await send('ss-erp:direct-erp-editor', { kind: 'attributes', binding: context.binding });
    workspaceCache = workspace;

    // 标题为空时自动用规则生成一次
    if (!String(titleInput.value || '').trim()) {
      const built = generateTitleFor(context, workspace);
      if (built.title) titleInput.value = built.title;
    }

    const editorStub = {
      category: context.category,
      selectedSkuKeys: skus.map((sku) => sku.key),
      copy: { titleRu: String(titleInput.value || '').trim(), descriptionRu: String(descInput.value || '').trim() },
      pricing: { items: skus.map((sku) => {
        const computed = priceFor(sku.cost);
        return { skuKey: sku.key, price: computed ? computed.price : null, oldPrice: computed ? computed.oldPrice : null, currencyCode: 'CNY', vat: '0' };
      }) },
      packaging: skus.map((sku) => ({
        skuKey: sku.key,
        weightG: Number(weightInput.input.value),
        widthMm: Number(widthInput.input.value),
        heightMm: Number(heightInput.input.value),
        depthMm: Number(depthInput.input.value),
      })),
    };
    const plan = planDirectItems({
      editor: editorStub,
      workspace,
      offerBase: context.offerBase,
      images: (context.images || []).map((url) => ({ scope: 'PRODUCT', skuKey: null, url })),
      defaults: { currency: 'CNY', vat: '0' },
    });
    plan.items.forEach((item, index) => {
      item.__cost = skus[index] && skus[index].cost;
      item.categoryId = plan.category.categoryId;
      item.typeId = plan.category.typeId;
      item.priceSource = '成本×倍率';
    });

    // 已存在的商品：价格预填为线上现有价（上架前就定好，上架后不再改）
    try {
      const info = await send('ss-erp:direct-ozon-post', {
        path: '/v3/product/info/list',
        body: { offer_id: plan.items.map((item) => item.offerId) },
      });
      const byOffer = new Map((info && Array.isArray(info.items) ? info.items : []).map((it) => [String(it.offer_id), it]));
      for (const item of plan.items) {
        const hit = byOffer.get(item.offerId);
        const existing = hit && Number(hit.price) > 0 ? Number(hit.price) : 0;
        if (!existing) continue;
        item.price = existing.toFixed(2);
        if (Number(hit.old_price) > 0) item.oldPrice = Number(hit.old_price).toFixed(2);
        item.priceSource = '线上现有';
      }
    } catch (_error) { /* 读不到就保留成本×倍率 */ }
    return { plan, context, workspace };
  }

  /** 把表格里用户改过的价格写回 plan */
  function applyPriceInputs(plan) {
    for (const item of plan.items) {
      const inputs = priceInputs.get(item.offerId);
      if (!inputs) continue;
      const price = Number(inputs.priceInput.value);
      const oldPrice = Number(inputs.oldPriceInput.value);
      if (Number.isFinite(price) && price > 0) item.price = price.toFixed(2);
      else item.blockers.push('PRICE');
      if (Number.isFinite(oldPrice) && oldPrice > 0) item.oldPrice = oldPrice.toFixed(2);
      if (!item.price) item.blockers.push('PRICE');
    }
    plan.blockers = plan.items.flatMap((item) => item.blockers.map((code) => ({ scope: item.offerId, code, detail: '' })))
      .concat(plan.blockers.filter((one) => !/^(TITLE_RU|PRICE|WEIGHT|DIMENSIONS|IMAGES|REQUIRED_ATTRIBUTES)$/.test(String(one.code))));
    plan.ready = plan.items.length > 0
      && plan.items.every((item) => item.blockers.length === 0);
    return plan;
  }

  async function runPrecheck() {
    if (busy) return;
    busy = true;
    precheck.disabled = publishBtn.disabled = true;
    try {
      const { plan } = await buildPlan();
      const merged = applyPriceInputs(plan);
      lastPlan = merged;
      renderTable(merged);
      if (merged.items.length) fillPricesManualGuard(merged);
      if (warehouses.length === 0) await loadWarehouses();
      output.textContent = JSON.stringify({
        category: merged.category,
        skuCount: merged.skuCount,
        requiredFieldCount: merged.requiredFieldCount,
        ready: merged.ready,
        title: String(titleInput.value || ''),
        blockers: merged.blockers,
        notes: merged.notes,
        items: merged.items.map((item) => ({ offerId: item.offerId, attributes: item.attributeCount, price: item.price, oldPrice: item.oldPrice, images: item.images.length, missingRequired: item.missingRequired })),
      }, null, 2);
      state.textContent = merged.ready ? `预检通过：${merged.items.length} 条可上架` : `预检未通过：${merged.blockers.length} 个待补项`;
    } catch (error) {
      state.textContent = String((error && error.message) || error);
      report?.(error);
    } finally {
      busy = false;
      precheck.disabled = publishBtn.disabled = false;
    }
  }

  /** 预检时不要把用户刚填的价格再覆盖掉 */
  function fillPricesManualGuard(plan) {
    for (const item of plan.items) {
      const inputs = priceInputs.get(item.offerId);
      if (!inputs) continue;
      inputs.priceInput.value = item.price || '';
      inputs.oldPriceInput.value = item.oldPrice || '';
    }
  }

  async function runPublish() {
    if (busy) return;
    busy = true;
    precheck.disabled = publishBtn.disabled = true;
    try {
      const { plan } = await buildPlan();
      const merged = applyPriceInputs(plan);
      // 表格里的输入就是最终价格
      for (const item of merged.items) {
        const inputs = priceInputs.get(item.offerId);
        if (!inputs) continue;
        const price = Number(inputs.priceInput.value);
        const oldPrice = Number(inputs.oldPriceInput.value);
        if (Number.isFinite(price) && price > 0) item.price = price.toFixed(2);
        if (Number.isFinite(oldPrice) && oldPrice > 0) item.oldPrice = oldPrice.toFixed(2);
      }
      renderTable(merged);
      if (!merged.ready) throw new Error('预检未通过，先补齐：' + merged.blockers.map((one) => one.code).join(' / '));
      const items = merged.items.map((item) => ({
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
      const merged2 = new Map();
      for (const one of (result.items || [])) if (one.modelId) merged2.set(one.modelId, (merged2.get(one.modelId) || 0) + 1);
      state.textContent = `上架完成：${(result.items || []).length} 条，状态 ${result.status}`
        + (merged2.size ? `；合并到 ${merged2.size} 个 model（变体数 ${[...merged2.values()].join('/')}）` : '');

      const stockCount = Number(stockInput.input.value);
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
  generateTitle.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        const context = getContext();
        if (!context || !context.binding) throw new Error('请先读取 ERP 草稿');
        // ERP 读到就用它；读不到（catalog_stale 等）就用 Ozon 已上架商品的属性兜底
        let workspace = workspaceCache;
        if (!workspace) {
          try { workspace = await send('ss-erp:direct-erp-editor', { kind: 'attributes', binding: context.binding }); }
          catch (_error) { workspace = null; }
          if (workspace) workspaceCache = workspace;
        }
        let ozonAttrs = null;
        if (!workspace) {
          const skus = context.skus || [];
          const offers = skus.map((sku, index) => offerIdFor(context.offerBase, sku.key, index));
          const existing = await fetchOzonProducts(offers);
          const first = existing && existing.get(offers[0]);
          ozonAttrs = ((first && first.attributes) || []).map((attribute) => ({
            id: Number(attribute.id),
            value: (attribute.values || []).map((value) => String(value.value || '')).filter(Boolean).join(' '),
          }));
        }
        const built = generateTitleFor(context, workspace, ozonAttrs);
        titleInput.value = built.title;
        state.textContent = built.title
          ? `标题已生成（${built.parts.join(' / ')}）` + (built.dropped.length ? `；丢弃：${built.dropped.slice(0, 8).join(',')}` : '')
          : '标题生成失败：源标题里没有可用特征';
      } catch (error) {
        state.textContent = String((error && error.message) || error);
        report?.(error);
      }
    })();
  });
  applyMultiplier.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        const { plan } = await buildPlan();
        renderTable(plan);
        fillPricesByMultiplier(plan);
        state.textContent = '已按倍率填价：上架前请核对每一行';
      } catch (error) {
        state.textContent = String((error && error.message) || error);
      }
    })();
  });
  refreshWarehouses.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void loadWarehouses().then((result) => {
      state.textContent = result.error ? `仓库读取失败：${result.error}` : `仓库：${result.count} 个`;
    });
  });

  return { panel, refresh: () => loadWarehouses(), lastPlan: () => lastPlan };
}
