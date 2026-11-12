import { planDirectItems, offerIdFor } from '../../shared/publish/direct-lane.js';
import { buildRuTitle } from '../../shared/ozon/title-rules.js';
import { DEFAULT_TITLE_AI, generateTitleWithAi, readTitleAiConfig, writeTitleAiConfig } from '../../shared/ozon/title-ai.js';
import { describeProductWithAi, visionToAttributePairs } from '../../shared/ozon/vision-ai.js';
import { parseVariantSpecs, pickDictionaryValue, planPrefill, planVariantPrefill } from '../../shared/ozon/attribute-prefill.js';
import { buildImagePromptPlan } from '../../shared/ozon/image-prompt-plan.js';
import { calculatePricing } from '../../shared/ozon/pricing-calculator.js';
import { variantBlockers } from '../../shared/ozon/variant-key.js';
import { pickUsableWarehouse, setStocks, waitForProducts } from '../../shared/ozon/publish-flow.js';

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
  // 成本：采集不到 1688 价格时（有些页面解析不出）用它兜底，0 = 用采集值
  const costInput = mkNumber('成本 CNY', '0', { step: '0.01', min: '0' });
  // 货号前缀：默认取来源商品号；改它就能用同一份采集结果建一条全新 listing
  const offerBaseWrap = make('label', '', '货号前缀 ');
  const offerBaseInput = make('input');
  offerBaseInput.type = 'text';
  offerBaseInput.style.width = '150px';
  offerBaseWrap.append(offerBaseInput);
  // SKU 上限：0 = 全部；测试或分批上架时用它，避免一次发上百条
  const skuLimitWrap = make('label', '', 'SKU 上限 ');
  const skuLimitInput = make('input');
  skuLimitInput.type = 'number';
  skuLimitInput.min = '0';
  skuLimitInput.value = '0';
  skuLimitInput.style.width = '70px';
  skuLimitWrap.append(skuLimitInput);
  // 类目：新商品在 ERP 不可用时就靠这两个数字；有缓存会自动填
  const catWrap = make('label', '', '类目 ');
  const catIdInput = make('input');
  catIdInput.type = 'number';
  catIdInput.placeholder = 'categoryId';
  catIdInput.style.width = '110px';
  const typeIdInput = make('input');
  typeIdInput.type = 'number';
  typeIdInput.placeholder = 'typeId';
  typeIdInput.style.width = '100px';
  catWrap.append(catIdInput, typeIdInput);
  const weightInput = mkNumber('重量 g', '250', { step: '10', min: '1' });
  const widthInput = mkNumber('宽 mm', '200', { step: '10', min: '1' });
  const heightInput = mkNumber('高 mm', '40', { step: '1', min: '1' });
  const depthInput = mkNumber('长 mm', '300', { step: '10', min: '1' });
  const warehouseWrap = make('label', '', '仓库 ');
  const warehouse = make('select');
  const refreshWarehouses = make('button', 'ghost', '刷新仓库');
  warehouseWrap.append(warehouse);
  const applyMultiplier = make('button', 'ghost', '按倍率填价');
  const autoPricing = make('button', 'ghost', '按成本自动定价');
  toolbar.append(offerBaseWrap, skuLimitWrap, catWrap, costInput.wrap, multiplier.wrap, markup.wrap, strike.wrap, applyMultiplier, autoPricing, stockInput.wrap,
    weightInput.wrap, widthInput.wrap, heightInput.wrap, depthInput.wrap, warehouseWrap, refreshWarehouses);

  const copyRow = make('div', 'precision-local-fields');
  const titleWrap = make('label', '', '俄文标题 ');
  const titleInput = make('input');
  titleInput.type = 'text';
  titleInput.placeholder = '点「生成标题」或手填';
  titleInput.style.minWidth = '520px';
  titleWrap.append(titleInput);
  const generateTitle = make('button', 'ghost', '生成标题');
  const describeBtn = make('button', 'ghost', '视觉描述');
  const promptPlanBtn = make('button', 'ghost', '生成图片提示词');
  const genImageBtn = make('button', 'ghost', '出 1 张主图');
  const genAllBtn = make('button', 'primary', '按计划出 8 张');
  const descWrap = make('label', '', '俄文描述 ');
  const descInput = make('input');
  descInput.type = 'text';
  descInput.placeholder = '（可留空）';
  descInput.style.minWidth = '360px';
  descWrap.append(descInput);
  copyRow.append(titleWrap, generateTitle, describeBtn, promptPlanBtn, genImageBtn, genAllBtn, descWrap);

  // AI 文本配置：BYOK 的 profile 只登记了图像操作，文本走自己这份配置。
  // 留空就用规则生成；填了 key 就优先用模型（阿里 DashScope compatible-mode 已预填）。
  const aiRow = make('div', 'precision-local-fields');
  const aiBase = make('input');
  aiBase.type = 'text';
  aiBase.placeholder = DEFAULT_TITLE_AI.baseUrl;
  aiBase.style.minWidth = '300px';
  const aiModel = make('input');
  aiModel.type = 'text';
  aiModel.placeholder = DEFAULT_TITLE_AI.model;
  aiModel.style.width = '170px';
  const aiKey = make('input');
  aiKey.type = 'password';
  aiKey.placeholder = 'API key（留空=用规则生成）';
  aiKey.style.width = '220px';
  const aiSave = make('button', 'ghost', '保存 AI 配置');
  const aiStatus = make('span', '', 'AI 未配置：标题用规则生成');
  aiStatus.style.color = '#94a3b8';
  aiRow.append(make('span', '', 'AI 文本：'), aiBase, aiModel, aiKey, aiSave, aiStatus);

  const actions = make('div', 'precision-local-fields');
  const precheck = make('button', 'ghost', '预检载荷');
  const publishBtn = make('button', 'primary', '直连上架');
  // 已存在的 offer 只想补库存/修属性时用这个，不重新 import
  const restockBtn = make('button', 'ghost', '补库存');
  const state = make('span', '', '');
  actions.append(precheck, publishBtn, restockBtn, state);

  const table = make('div');
  const output = make('pre');
  output.style.cssText = 'max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px;';
  panel.append(head, toolbar, copyRow, aiRow, actions, table, output);
  // 调试钩子（只暴露只读上下文，便于脚本核对 SKU key / 类目）
  try { globalThis.__SSERP_PANEL_DEBUG__ = { getContext, readCachedCategory, attributesFromRules, mergeWorkspaceValues, getLastVision: () => lastVisionReport, matchDictionaryValue }; } catch (_e) {}
  root.append(panel);

  let busy = false;
  // busy 卡死自愈：异常路径没走到 busy=false 时（实测踩过），10 分钟后自动放行
  let busySince = 0;
  const claimBusy = () => {
    if (busy && Date.now() - busySince > 600000) busy = false;
    if (busy) return false;
    busy = true;
    busySince = Date.now();
    return true;
  };
  let lastPlan = null;
  let warehouses = [];
  let workspaceCache = null;
  let lastVisionReport = null;   // 精铺形态的视觉报告（一次），喂标题/属性/生图
  let lastPromptPlan = null;     // PromptPlan v2（主图 + 7 张详情图）
  let lastImageResults = [];     // 本轮生成结果 [{goalType,url,elapsedMs}]
  // 类目 ID → 俄文类型名（标题规则需要它；context.category 在无草稿时为空）
  const TYPE_NAME_BY_ID = { 93182: 'Платье', 93283: 'Юбка', 93211: 'Платье', 608042980: 'Фартук' };
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
      // 退货仓收不了库存（rets → PRODUCT_HAS_NOT_BEEN_TAGGED_YET），
      // 过滤规则放在共享层，面板与脚本用同一份。
      const { usable, warehouse: bestWarehouse } = pickUsableWarehouse(warehouses);
      const pickList = usable.length ? usable : warehouses;
      for (const one of pickList) {
        const option = make('option', '', `${one.name || one.warehouse_id} (${one.warehouse_id})`);
        option.value = String(one.warehouse_id);
        warehouse.append(option);
      }
      // 默认选中第一个仓库：否则补库存那步会因 warehouseId=0 被静默跳过，
      // 结果就是「上架成功但 Не продается、model 建不出来」（T9 实测）
      if (!Number(warehouse.value) && warehouse.options.length) warehouse.value = warehouse.options[0].value;
      return { count: warehouses.length, selected: warehouse.value };
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

  /** 从 ERP 工作区或 Ozon 商品属性里取「Пол / Материал / Тип」三个值 */
  function collectAttributePairs(workspace, ozonAttrs) {
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
    const pairs = [];
    // 颜色也要取：否则视觉推断的「米色」会盖过卖家数据（实测踩过）
    for (const [id, name] of [[9163, 'Пол'], [6383, 'Материал'], [8229, 'Тип'], [10096, 'Цвет']]) {
      const field = byId.get(id);
      const value = attrValue(id);
      if (value) pairs.push({ name: (field && field.name) || name, value });
    }
    return pairs;
  }

  /** 标题：规则生成。类目俄文名 + 性别 + 材质 + 特征词 */
  function generateTitleFor(context, workspace, ozonAttrs) {
    const pairs = collectAttributePairs(workspace, ozonAttrs);
    const attrValue = (id) => {
      const label = id === 9163 ? 'Пол' : id === 6383 ? 'Материал' : id === 10096 ? 'Цвет' : 'Тип';
      const pair = pairs.find((one) => one.name === label);
      return pair ? pair.value : '';
    };
    return buildRuTitle({
      typeName: (context.category && context.category.typeName) || TYPE_NAME_BY_ID[Number(typeIdInput.value)] || '',
      sourceTitle: context.sourceTitle,
      gender: attrValue(9163),
      material: attrValue(6383),
      attributes: pairs,
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

  /**
   * listing 用哪些图：生图结果优先（按 hero → 7 个详情槽位顺序），源图补位。
   * Ozon import 会自己去下载 URL，所以生成图不用先上传。
   */
  function imagesForPlan(context) {
    const generated = (lastImageResults || []).map((one) => one.url).filter((url) => /^https:\/\//.test(String(url)));
    const source = (context.images || []).filter((url) => /^https:\/\//.test(String(url)));
    const seen = new Set();
    return generated.concat(source).filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    }).slice(0, 15);
  }

  /** 生成图落本地：重开面板/重载扩展都不丢，listing 直接复用 */
  async function saveGeneratedImages(results) {
    try {
      const sourceId = (getContext() && getContext().sourceProductId) || '';
      if (!sourceId) return;
      const urls = (results || []).filter((one) => one && one.url).map((one) => ({ goalType: one.goalType, url: one.url, at: Date.now() }));
      await chrome.storage.local.set({ ['ss-erp:direct-lane:generated:' + sourceId]: urls });
    } catch (_error) { /* 存不下不影响本轮 */ }
  }

  async function loadGeneratedImages(sourceId) {
    if (!sourceId) return [];
    try {
      const key = 'ss-erp:direct-lane:generated:' + sourceId;
      const got = await chrome.storage.local.get(key);
      const list = got && got[key];
      return Array.isArray(list) ? list : [];
    } catch (_error) { return []; }
  }

  /**
   * 合并两份属性工作区：规则打底，override 覆盖同 (attributeId, skuKey) 的行。
   * fields 取并集（按 attributeId），values 按 key 去重。
   */
  function mergeWorkspaceValues(base, override) {
    if (!base) return override || null;
    if (!override || !Array.isArray(override.values)) return base;
    const keyOf = (row) => `${Number(row.attributeId)}|${row.skuKey == null ? '' : String(row.skuKey)}`;
    const map = new Map();
    for (const row of base.values || []) map.set(keyOf(row), row);
    for (const row of override.values || []) {
      const key = keyOf(row);
      const hasValue = Array.isArray(row.dictionaryValueIds) ? row.dictionaryValueIds.length : Boolean(String(row.value || '').trim());
      if (hasValue) map.set(key, row);
    }
    const fieldsById = new Map();
    for (const field of [...(override.fields || []), ...(base.fields || [])]) {
      const id = Number(field && (field.attributeId || field.id));
      if (id) fieldsById.set(id, field);
    }
    return { fields: [...fieldsById.values()], values: [...map.values()] };
  }

  /** 类目缓存：类目确认时由工作台写入，ERP 草稿读不到时靠它继续 */
  async function readCachedCategory(sourceId) {
    if (!sourceId) return null;
    try {
      const key = 'ss-erp:direct-lane:category:' + sourceId;
      const got = await chrome.storage.local.get(key);
      const hit = got && got[key];
      if (hit && Number(hit.categoryId) > 0 && Number(hit.typeId) > 0) {
        return { categoryId: Number(hit.categoryId), typeId: Number(hit.typeId), typeName: String(hit.typeName || '') };
      }
    } catch (_error) { /* 没缓存就返回 null */ }
    return null;
  }

  /**
   * 新商品的属性：Ozon schema + 本地规则（planPrefill / planVariantPrefill）+ 官方字典。
   * 与弹窗里那套规则同源，所以「必填 6 项」在直连车道上同样成立。
   */
  /**
   * 通用字典匹配：视觉/标题给出的自由文本 → Ozon 字典值。
   * 逐级放宽，避免「女性」vs「女士」这类一字之差直接放弃：
   *   1) 归一化全等  2) 互相包含  3) 首字相同  4) 前两字相同
   * 与商品无关，任何类目都能用。
   */
  function matchDictionaryValue(list, text) {
    const rows = Array.isArray(list) ? list : [];
    const norm = (value) => String(value || '').toLowerCase().replace(/[\s\-_,.()]/g, '');
    const needle = norm(text);
    if (!needle) return null;
    const byExact = rows.find((one) => norm(one.value) === needle);
    if (byExact) return byExact;
    const byIncludes = rows.find((one) => norm(one.value).includes(needle) || needle.includes(norm(one.value)));
    if (byIncludes) return byIncludes;
    const byFirst = rows.find((one) => norm(one.value).slice(0, 1) === needle.slice(0, 1));
    if (byFirst) return byFirst;
    const byTwo = rows.find((one) => norm(one.value).slice(0, 2) === needle.slice(0, 2));
    return byTwo || null;
  }

  async function attributesFromRules(context, category, skus) {
    // 字典列表按 attributeId 缓存：之前每个属性 × 每个 SKU 各请求一次（limit 1000），
    // 12 个 SKU 就是上百次往返 + 大 JSON 解析，实测把渲染进程卡死。
    const dictCache = new Map();
    const dictionaryOf = async (attributeId) => {
      const id = Number(attributeId);
      if (dictCache.has(id)) return dictCache.get(id);
      let list = [];
      try {
        const found = await send('ss-erp:direct-ozon-attribute-values', {
          categoryId: category.categoryId, typeId: category.typeId, attributeId: id, query: '', limit: 400,
        });
        list = (found && found.values) || [];
      } catch (_error) { list = []; }
      // 网关可能无视 limit 返回上千条；大列表上的模糊匹配会把渲染线程堵死（实测 180s+）
      if (list.length > 400) list = list.slice(0, 400);
      dictCache.set(id, list);
      return list;
    };
    const schema = await send('ss-erp:direct-ozon-attributes', { categoryId: category.categoryId, typeId: category.typeId });
    const fields = (schema && schema.fields) || [];
    if (!fields.length) return { fields: [], values: [] };
    const product = {
      title: context.sourceTitle || '',
      offerId: context.offerBase,
      sourceProductId: context.offerBase,
      typeId: category.typeId,
      skus: skus.map((sku) => ({ key: sku.key, label: sku.label })),
      attributes: [],
    };
    const items = planPrefill(product, fields).concat(planVariantPrefill(product, fields));
    // 这个类目（连衣裙 93182）全部字段 ownership=SKU：产品级的品牌/类型/国家/合并字段
    // 不能丢，要按 SKU 展开；否则 Ozon 收到「有字段无值」，建不出 model。
    const skuOwned = new Set(
      fields.filter((field) => String(field && field.ownership || '').toUpperCase() === 'SKU')
        .map((field) => Number(field.attributeId || field.id)),
    );
    const skuKeys = skus.map((sku) => sku.key);
    const collected = new Map();   // `${id}|${skuKey}` → row，先来的优先（variant 先于 prefill）
    const put = (row, skuKey) => {
      const key = `${Number(row.attributeId)}|${skuKey == null ? '' : String(skuKey)}`;
      if (!collected.has(key)) collected.set(key, { ...row, skuKey: skuKey == null ? null : String(skuKey) });
    };
    const resolveItem = async (item) => {
      if (item.kind === 'text') {
        return { attributeId: item.attributeId, value: String(item.value || ''), dictionaryValueIds: [] };
      }
      let list = await dictionaryOf(item.attributeId);
      const queries = Array.isArray(item.queries) && item.queries.length ? item.queries : [item.query || ''];
      let chosen = null;
      for (const query of queries) {
        // 先按关键词预筛，避免在上千条上跑模糊匹配
        const needle = String(query || '').trim().toLowerCase();
        const pool = needle
          ? (list.filter((one) => String(one && one.value || '').toLowerCase().includes(needle)).slice(0, 200))
          : list;
        chosen = pickDictionaryValue(pool.length ? pool : list, item.pick, query, {
          id: item.fallbackValueId,
          typeId: item.attributeId === 8229 ? category.typeId : undefined,
        });
        if (chosen) break;
      }
      if (!chosen && !item.fallbackValueId && list.length === 0 && queries.some(Boolean)) {
        try {
          const retry = await send('ss-erp:direct-ozon-attribute-values', {
            categoryId: category.categoryId, typeId: category.typeId,
            attributeId: item.attributeId, query: String(queries[0] || ''), limit: 50,
          });
          const retryList = (retry && retry.values) || [];
          for (const query of queries) {
            chosen = pickDictionaryValue(retryList, item.pick, query, { id: item.fallbackValueId });
            if (chosen) break;
          }
        } catch (_error) { /* 仍然失败就记未解析 */ }
      }
      return {
        attributeId: item.attributeId,
        value: chosen ? String(chosen.value || '') : String(item.fallbackValue || item.query || ''),
        dictionaryValueIds: chosen ? [chosen.id] : (item.fallbackValueId ? [item.fallbackValueId] : []),
        // 「查到了但值是空」也算未解析：Ozon 的字典字段收到空串会存成有字段无值
        __unresolved: !(
          (chosen && (Number(chosen.id) > 0 || String(chosen.value || '').trim()))
          || item.fallbackValueId
        ) && Boolean(queries.some(Boolean)),
      };
    };

    // 0) 字典预热：把所有要用的 attributeId 一次性并发取回（每批 6 个）。
    //    之前是解析到一个才取一个，串行下来 40+ 个属性要几分钟。
    {
      const need = [...new Set(items.filter((one) => one.kind !== 'text').map((one) => Number(one.attributeId)))].filter((id) => id > 0);
      for (let i = 0; i < need.length; i += 6) {
        await Promise.all(need.slice(i, i + 6).map((id) => dictionaryOf(id)));
      }
    }
    // 1) 变体行先占位（颜色/尺码按 SKU 精确）
    for (const item of items.filter((one) => one.skuKey != null)) {
      const row = await resolveItem(item);
      put(row, item.skuKey);
    }
    // 2) 产品级行：SKU 归属的字段按 SKU 展开，其余保持 null
    for (const item of items.filter((one) => one.skuKey == null)) {
      const row = await resolveItem(item);
      if (skuOwned.has(Number(item.attributeId))) {
        for (const skuKey of skuKeys) put(row, skuKey);
      } else {
        put(row, null);
      }
    }
    const values = [...collected.values()];
    // 服装类目性别兜底：标题里常没写性别（裙/衣），但 9163 是必填。
    // 默认女装，标题出现「男」才用男装 —— 与弹窗那套规则互补。
    if (Number(category.categoryId) === 200000933 && !values.some((one) => Number(one.attributeId) === 9163)) {
      try {
        const found = await send('ss-erp:direct-ozon-attribute-values', {
          categoryId: category.categoryId, typeId: category.typeId, attributeId: 9163, query: '', limit: 200,
        });
        const list = (found && found.values) || [];
        const wanted = /男/.test(String(context.sourceTitle || '')) ? ['Мужской', 'мужской'] : ['Женский', 'женский'];
        let chosen = null;
        for (const query of wanted) { chosen = pickDictionaryValue(list, 'fuzzy', query, {}); if (chosen) break; }
        if (chosen) {
          for (const skuKey of skuKeys) {
            values.push({ attributeId: 9163, skuKey, value: String(chosen.value || ''), dictionaryValueIds: [chosen.id], __unresolved: false });
          }
        }
      } catch (_error) { /* 兜底失败就让预检报缺项 */ }
    }
    return { fields, values };
  }

  async function buildPlan() {
    const context = getContext();
    if (!context || !context.offerBase) throw new Error('请先采集来源商品');
    // 缓存键（类目/生成图）必须用**源商品号**，不能被下面改的货号前缀带跑
    const sourceKey = String(context.sourceProductId || context.offerBase);
    // 货号前缀可改：用它就能基于同一份采集建一条全新 listing
    const prefixed = String(offerBaseInput.value || '').trim();
    if (!prefixed) offerBaseInput.value = context.offerBase;
    else context.offerBase = prefixed;
    const allSkus = context.skus || [];
    const limitValue = Number(String(skuLimitInput.value || '0')) || 0;
    const skus = limitValue > 0 ? allSkus.slice(0, limitValue) : allSkus;
    // 成本覆盖：采集值缺失或被人工改价时用面板输入
    const costOverride = Number(costInput.input.value) || 0;
    if (costOverride > 0) for (const sku of skus) sku.cost = costOverride;
    const offers = skus.map((sku, index) => offerIdFor(context.offerBase, sku.key, index));

    // 已上架：属性/尺寸/图片从 Ozon 读（不依赖 ERP —— ERP 的 catalogRevision
    // 一变，editor/attributes 就会回 source_listing_catalog_stale，直连车道不该被它拖住）
    const existing = await fetchOzonProducts(offers);
    if (existing && offers.every((offer) => existing.has(offer))) {
      const priceMap = await fetchOzonPrices(offers);
      const plan = planFromOzon(context, skus, offers, existing, priceMap);
      plan.__fromExisting = true;   // 这些 offer 已在 Ozon 存在：不能当新商品再发一次
      if (!String(titleInput.value || '').trim()) titleInput.value = plan.items[0] && plan.items[0].name || '';
      return { plan, context, workspace: null };
    }

    // 新商品属性：规则打底（确定性、覆盖齐），ERP 有值就覆盖同键。
    // 只靠 ERP 会缺项（草稿经常只剩 2 个属性 → REQUIRED_ATTRIBUTES），
    // 只靠规则又会丢掉卖家在 ERP 里手工改过的值。
    // 类目优先级：面板手填 > 工作区 > 缓存（新商品常常三者只剩手填）
    const typedCategoryId = Number(catIdInput.value) || 0;
    const typedTypeId = Number(typeIdInput.value) || 0;
    const category = typedCategoryId > 0 && typedTypeId > 0
      ? { categoryId: typedCategoryId, typeId: typedTypeId, typeName: (context.category && context.category.typeName) || '' }
      : (context.category && context.category.categoryId
        ? context.category
        : await readCachedCategory(sourceKey));
    let erpWorkspace = null;
    if (context.binding) {
      try { erpWorkspace = await send('ss-erp:direct-erp-editor', { kind: 'attributes', binding: context.binding }); }
      catch (_error) { erpWorkspace = null; }
    }
    const rulesWorkspace = category ? await attributesFromRules(context, category, skus) : null;
    if (rulesWorkspace) context.category = category || context.category;
    const workspace = mergeWorkspaceValues(rulesWorkspace, erpWorkspace);
    // 视觉观察回填（通用）：视觉报告里的「属性观察」按字段名匹配类目 schema；
    // 规则没算出来的必填项（性别、颜色、材质…）用它补。已有值不覆盖。
    try {
      const observed = lastVisionReport && lastVisionReport['属性观察'];
      if (observed && typeof observed === 'object' && workspace && Array.isArray(workspace.fields)) {
        for (const [obsName, obsRaw] of Object.entries(observed)) {
          const obsText = Array.isArray(obsRaw) ? obsRaw.join(' ') : String(obsRaw || '');
          if (!obsText.trim()) continue;
          const field = workspace.fields.find((f) => String((f && f.name) || '') === obsName)
            || workspace.fields.find((f) => obsName && String((f && f.name) || '').includes(obsName));
          const attributeId = field ? Number(field.attributeId || field.id) : 0;
          if (!attributeId) continue;
          const hasValue = (workspace.values || []).some((row) => Number(row.attributeId) === attributeId
            && (((row.dictionaryValueIds || []).length) || String(row.value || '').trim()));
          if (hasValue) continue;
          const found = await send('ss-erp:direct-ozon-attribute-values', {
            categoryId: category.categoryId, typeId: category.typeId, attributeId, query: '', limit: 400,
          }).catch(() => null);
          const list = (found && found.values) || [];
          const chosen = matchDictionaryValue(list, obsText)
            || pickDictionaryValue(list, 'fuzzy', obsText, {});
          if (!chosen) continue;
          const skuOwned = String((field && field.ownership) || '').toUpperCase() === 'SKU';
          const targets = skuOwned ? skus.map((sku) => sku.key) : [null];
          for (const key of targets) {
            workspace.values.push({ attributeId, skuKey: key, value: String(chosen.value || ''), dictionaryValueIds: [chosen.id] });
          }
        }
      }
    } catch (_error) { /* 回填失败不影响主流程 */ }
    if (!workspace) throw new Error('没有类目：先在「类目」步骤确认一次（会缓存到本地）');
    if (workspace.values && workspace.values.length) workspaceCache = workspace;
    if (!workspace.values || !workspace.values.length) throw new Error('规则没有算出属性：检查类目与 SKU 规格');
    // 该类目能不能把多个 SKU 合成一张卡？判错一次就留一张永远不销售的坏卡。
    const variant = variantBlockers({ fields: workspace.fields, skuCount: skus.length });
    if (variant.blockers.length) {
      throw new Error('类目不支持多变体成组：' + variant.info.reason + '。请每次只发 1 个 SKU（把「SKU 上限」设为 1）。');
    }
    if (skus.length === 1 && !variant.info.supported) {
      // 单品卡：Ozon 会忽略单值的集合属性，但带着它反而卡在 variant_wait（实测）。
      // 所以这里把集合属性整条剔除，只留产品级属性。
      const collectionIds = new Set(
        (workspace.fields || []).filter((field) => String((field && (field.ownership || (field.isCollection ? 'SKU' : ''))) || '').toUpperCase() === 'SKU')
          .map((field) => Number(field.attributeId || field.id)),
      );
      workspace.values = (workspace.values || []).filter((row) => !collectionIds.has(Number(row.attributeId)));
      workspace.__singleCard = true;
    }
    if (workspace.__singleCard) {
      state.textContent = '单品卡：已剔除集合属性（Ozon 会把单值集合属性当成等待变体）';
    } else if (skus.length === 1) {
      state.textContent = '提示：' + variant.info.reason;
    }
    if (workspace.values.some((one) => one.__unresolved)) {
      const ids = [...new Set(workspace.values.filter((one) => one.__unresolved).map((one) => one.attributeId))];
      throw new Error(`字典没解析到属性 ${ids.join(', ')}：现在上架会存成「有字段无值」，商品不会进入销售。稍后重试或手工补值。`);
    }

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
      // 生成图优先（主图在最前），源图补位 —— 生图链路的结果在这里回灌 listing
      images: imagesForPlan(context).map((url) => ({ scope: 'PRODUCT', skuKey: null, url })),
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
    if (!claimBusy()) return;
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
    if (!claimBusy()) return;
    precheck.disabled = publishBtn.disabled = true;
    try {
      const { plan } = await buildPlan();
      const merged = applyPriceInputs(plan);
    // 同一货号重复发布会撞 Ozon「已上架/归档」，一个前缀只当新商品用一次；补库存走「补库存」按钮
    if (merged.__fromExisting) {
      throw new Error('这个货号前缀在 Ozon 已存在（重复发布会判同款/归档）。换一个新前缀；只想补库存请点「补库存」。');
    }
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
      let warehouseId = Number(warehouse.value);
      // 仓库下拉可能还没加载完（新装/新 profile 常见），发布后补库存前再拉一次并自动选第一个
      if (stockCount > 0 && !(warehouseId > 0)) {
        await loadWarehouses();
        if (!Number(warehouse.value) && warehouse.options.length) warehouse.value = warehouse.options[0].value;
        warehouseId = Number(warehouse.value);
      }
      if (Number.isFinite(stockCount) && stockCount > 0 && warehouseId > 0) {
        const offers = items.map((item) => item.offerId);
        // 通用流程（shared/ozon/publish-flow.js）：等创建 → 设库存（内置退避）。
        // 面板与 Node 脚本共用同一份实现，避免两边行为不一致。
        state.textContent = `等待商品创建（0/${offers.length}）…`;
        const created = await waitForProducts({
          post: (path, body) => send('ss-erp:direct-ozon-post', { path, body }),
          offers,
          onTick: ({ ready, total }) => { state.textContent = `等待商品创建（${ready}/${total}）…`; },
        });
        const stocks = await setStocks({
          post: (path, body) => send('ss-erp:direct-ozon-post', { path, body }),
          offers: created.ready,
          stock: stockCount,
          warehouseId,
          onTick: ({ attempt, pending }) => { state.textContent = `设置库存（第 ${attempt} 轮，剩 ${pending}）…`; },
        });
        output.textContent += '\n\n库存：成功 ' + stocks.ok.length + ' / 失败 ' + stocks.failed.length
          + (stocks.failed.length ? '\n' + JSON.stringify(stocks.failed).slice(0, 400) : '')
          + (created.pending.length ? '\n未创建：' + created.pending.slice(0, 5).join(', ') : '');
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

  describeBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        const context = getContext();
        if (!context || !context.offerBase) throw new Error('请先采集来源商品');
        const cfg = await readTitleAiConfig();
        if (!cfg) throw new Error('先在上面填 AI key（视觉描述和标题用同一把）');
        // 按精铺的入参形态准备：SKU 表（带中文字段）+ 官方属性 + 类目名
        const skus = (context.skus || []).map((sku) => {
          const parsed = parseVariantSpecs([{ label: sku.label }]);
          return { label: sku.label, color: parsed.colorsZh[0] || '', size: parsed.sizes[0] || '' };
        });
        // 把类目 schema 的属性清单交给视觉模型：报告里才会有「属性观察」，
        // 之后可以用它填补规则没覆盖到的必填项（例如性别）。与具体商品无关。
        let fields = [];
        try {
          const typedCatId = Number(catIdInput.value) || 0;
          const typedTypeId = Number(typeIdInput.value) || 0;
          const vCategory = (typedCatId > 0 && typedTypeId > 0)
            ? { categoryId: typedCatId, typeId: typedTypeId, typeName: (context.category && context.category.typeName) || '' }
            : ((context.category && context.category.categoryId)
              ? context.category
              : await readCachedCategory(String(context.sourceProductId || context.offerBase)));
          if (vCategory) {
            const schema = await send('ss-erp:direct-ozon-attributes', { categoryId: vCategory.categoryId, typeId: vCategory.typeId });
            // 必填字段优先：视觉一次只看十来项，排在后面的必填项（例如性别）会被截掉。与商品无关。
            const allFields = (schema && schema.fields ? schema.fields : []).filter((field) => field && field.name);
            const isRequired = (field) => Boolean(field.required || field.isRequired || field.is_required);
            const orderedFields = allFields.filter(isRequired).concat(allFields.filter((field) => !isRequired(field)));
            fields = orderedFields.slice(0, 12)
              .map((field) => ({ name: field.name, description: field.description || '', options: field.options || [] }));
          }
        } catch (_error) { /* 没有字段也能跑，只是不做属性观察 */ }
        try { globalThis.__SSERP_VISION_DEBUG__ = { typedCatId: Number(catIdInput.value) || 0, typedTypeId: Number(typeIdInput.value) || 0, fieldCount: fields.length, names: fields.slice(0, 5).map((f) => f.name) }; } catch (_e) {}
        state.textContent = `正在看图（${cfg.model}）…`;
        const result = await describeProductWithAi({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: 'qwen3.8-flash',
          imageUrls: context.images || [],
          product: { title: context.sourceTitle || '', skus },
          fields,
          categoryTitle: (context.category && context.category.typeName) || '',
        });
        lastVisionReport = result.report || null;
        output.textContent = JSON.stringify(result, null, 2).slice(0, 2000);
        state.textContent = `视觉描述：${result.summary.slice(0, 120)}`;
      } catch (error) {
        state.textContent = `视觉描述失败：${String((error && error.message) || error).slice(0, 160)}`;
        report?.(error);
      }
    })();
  });

  promptPlanBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        if (!lastVisionReport) throw new Error('先点「视觉描述」——提示词计划要基于视觉报告');
        const cfg = await readTitleAiConfig();
        if (!cfg) throw new Error('先在上面填 AI key');
        const context = getContext();
        const skus = (context.skus || []).map((sku, index) => {
          const parsed = parseVariantSpecs([{ label: sku.label }]);
          return { rowIndex: index + 1, skuLabel: sku.label, specs: { color_name_cn: parsed.colorsZh[0] || '', size_name_cn: parsed.sizes[0] || '' } };
        });
        const rawData = {
          sku_matrix: skus,
          sourceTitle: context.sourceTitle || '',
          images: (context.images || []).length,
        };
        state.textContent = `规划图片提示词（${cfg.model}）…`;
        const result = await buildImagePromptPlan({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: 'qwen3.6-flash',
          visionReport: lastVisionReport,
          rawData,
          categoryTitle: (context.category && context.category.typeName) || '',
        });
        lastPromptPlan = result.plan;
        const slots = (result.plan.sharedGalleryPlans || []).map((slot) => ({
          slotId: slot.slotId, goal: slot.goalType,
          sellingPoint: String(slot.sellingPoint || '').slice(0, 60),
          prompt: String(slot.prompt || '').slice(0, 120),
        }));
        output.textContent = JSON.stringify({ parsed: result.parsed, heroes: (result.plan.skuHeroPlans || []).length, slots }, null, 2).slice(0, 3000);
        state.textContent = `图片提示词：${slots.length} 个详情槽位 + ${(result.plan.skuHeroPlans || []).length} 个主图`;
      } catch (error) {
        state.textContent = `提示词规划失败：${String((error && error.message) || error).slice(0, 180)}`;
        report?.(error);
      }
    })();
  });

  /** 按 PromptPlan 出图：hero + 7 个详情槽位，limit 控制本轮张数 */
  async function runPlanImages(limit) {
    if (!lastPromptPlan) throw new Error('先点「生成图片提示词」');
    const context = getContext();
    const slots = [];
    const hero = (lastPromptPlan.skuHeroPlans || [])[0];
    if (hero && hero.prompt) slots.push({ goalType: 'sku_hero', prompt: hero.prompt });
    for (const slot of (lastPromptPlan.sharedGalleryPlans || [])) {
      if (slot && slot.prompt) slots.push({ goalType: slot.goalType || slot.slotId, prompt: slot.prompt });
    }
    if (!slots.length) throw new Error('计划里没有可用提示词');
    const chosen = slots.slice(0, Math.max(1, limit));
    const results = [];
    lastImageResults = results;   // 增量保存：中途失败也能把已成功的图回灌 listing
    for (let index = 0; index < chosen.length; index += 1) {
      const slot = chosen[index];
      state.textContent = `生图 ${index + 1}/${chosen.length}：${slot.goalType}（约 30–60 秒）…`;
      let record = null;
      // 单张失败不拖垮整批：503（渠道占满）退 6 秒再试一次，仍失败就记下来继续
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const result = await send('ss-erp:direct-image-generate', {
            prompt: slot.prompt,
            // 采集到的原图作参考，保持同款同色（精铺的 referenceSelection 思路）
            inputImageUrls: (context.images || []).slice(0, 3),
            timeoutMs: 180000,
          });
          const url = result && (result.url || result.imageUrl || (result.urls && result.urls[0]));
          record = { index: index + 1, goalType: slot.goalType, url: url || null, elapsedMs: result && result.elapsedMs };
          break;
        } catch (error) {
          const message = String((error && error.message) || error).slice(0, 160);
          const retryable = /503|502|504|timeout|超时/i.test(message);
          if (attempt === 1 && retryable) { await new Promise((r) => setTimeout(r, 6000)); continue; }
          record = { index: index + 1, goalType: slot.goalType, url: null, error: message };
        }
      }
      results.push(record);
      lastImageResults = results.slice();
      void saveGeneratedImages(results);
      output.textContent = JSON.stringify(results, null, 1).slice(0, 3000);
    }
    const ok = results.filter((one) => one && one.url).length;
    state.textContent = `生图完成：${ok}/${results.length} 张`;
    return results;
  }

  genImageBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void runPlanImages(1).catch((error) => {
      state.textContent = `生图失败：${String((error && error.message) || error).slice(0, 200)}`;
      report?.(error);
    });
  });
  genAllBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void runPlanImages(8).catch((error) => {
      state.textContent = `生图失败：${String((error && error.message) || error).slice(0, 200)}`;
      report?.(error);
    });
  });

  autoPricing.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        const { plan } = await buildPlan();
        renderTable(plan);
        const breakdown = [];
        for (const item of plan.items) {
          const cost = Number(item.__cost);
          if (!Number.isFinite(cost) || cost <= 0) { breakdown.push({ offerId: item.offerId, skipped: 'no cost' }); continue; }
          const result = calculatePricing({
            procurementCostCny: cost,
            packageWeightG: Number(weightInput.input.value),
            lengthCm: Number(depthInput.input.value) / 10,
            widthCm: Number(widthInput.input.value) / 10,
            heightCm: Number(heightInput.input.value) / 10,
            commissionRate: 20.5,          // DOTH 店 FBS 档（商品详情 commissions 实测）
            targetMarginRate: 20,
            frontDiscountRate: Number(strike.input.value) > 1 ? 30 : 0,
            preferredMode: 'auto',
          });
          const best = (result && result.bestByMode && result.bestByMode[0] && result.bestByMode[0].best) || null;
          if (!best) { breakdown.push({ offerId: item.offerId, ok: false, reason: (result && result.reason) || 'no tariff' }); continue; }
          const inputs = priceInputs.get(item.offerId);
          if (inputs) {
            inputs.priceInput.value = Number(best.salePriceCny).toFixed(2);
            // 折扣前价按「售价 / (1 - 折扣率)」反推，保证折扣是真的
            const discount = 0.3;
            inputs.oldPriceInput.value = (Number(best.salePriceCny) / (1 - discount)).toFixed(2);
          }
          item.price = Number(best.salePriceCny).toFixed(2);
          item.oldPrice = (Number(best.salePriceCny) / 0.7).toFixed(2);
          breakdown.push({
            offerId: item.offerId, mode: best.mode, tariff: best.tariff && best.tariff.channelName,
            billableKg: best.billableWeightKg, crossBorderCny: best.crossBorderFeeCny,
            priceCny: best.salePriceCny, priceRub: Math.round(Number(best.salePriceCny) * 11.1359),
          });
        }
        output.textContent = JSON.stringify(breakdown, null, 2).slice(0, 2500);
        state.textContent = '已按成本 + 精铺运费档定价：核对每行售价后再上架';
      } catch (error) {
        state.textContent = String((error && error.message) || error);
        report?.(error);
      }
    })();
  });

  restockBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        const context = getContext();
        if (!context || !context.offerBase) throw new Error('请先采集来源商品');
        const prefixed = String(offerBaseInput.value || '').trim() || context.offerBase;
        const allSkus = context.skus || [];
        const limitValue = Number(String(skuLimitInput.value || '0')) || 0;
        const skus = limitValue > 0 ? allSkus.slice(0, limitValue) : allSkus;
    // 成本覆盖：采集值缺失或被人工改价时用面板输入
    const costOverride = Number(costInput.input.value) || 0;
    if (costOverride > 0) for (const sku of skus) sku.cost = costOverride;
        const offers = skus.map((sku, index) => offerIdFor(prefixed, sku.key, index));
        const stockCount = Number(stockInput.input.value);
        if (!(stockCount > 0)) throw new Error('库存要大于 0');
        if (!Number(warehouse.value)) await loadWarehouses();
        if (!Number(warehouse.value) && warehouse.options.length) warehouse.value = warehouse.options[0].value;
        const warehouseId = Number(warehouse.value);
        if (!(warehouseId > 0)) throw new Error('没有可用仓库');
        state.textContent = '补库存：等商品就绪…';
        const post = (path, body) => send('ss-erp:direct-ozon-post', { path, body });
        const created = await waitForProducts({ post, offers, onTick: ({ ready, total }) => { state.textContent = `补库存：等创建 ${ready}/${total}`; } });
        if (!created.ready.length) throw new Error('商品还没创建，稍后再点一次');
        const stocks = await setStocks({ post, offers: created.ready, stock: stockCount, warehouseId });
        output.textContent = JSON.stringify({ ok: stocks.ok, failed: stocks.failed, pending: created.pending }, null, 2).slice(0, 1500);
        state.textContent = `补库存：成功 ${stocks.ok.length} / 失败 ${stocks.failed.length}`;
      } catch (error) {
        state.textContent = `补库存失败：${String((error && error.message) || error).slice(0, 160)}`;
        report?.(error);
      }
    })();
  });

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
        // 标题不需要 ERP：有草稿就读，没有就用 Ozon 已上架商品的属性/规则兜底
        if (!context || !context.offerBase) throw new Error('请先采集来源商品');
        // ERP 读到就用它；读不到（catalog_stale 等）就用 Ozon 已上架商品的属性兜底
        let workspace = workspaceCache;
        if (!workspace) {
          try { workspace = await send('ss-erp:direct-erp-editor', { kind: 'attributes', binding: context.binding }); }
          catch (_error) { workspace = null; }
          if (workspace) workspaceCache = workspace;
        }
        let ozonAttrs = null;
        let pairs = [];
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
        // 属性（卖家数据）优先于视觉推断：视觉只补属性里没有的项
        const attrPairs = collectAttributePairs(workspace, ozonAttrs);
        const visionPairs = visionToAttributePairs(lastVisionReport);
        const merged = new Map(visionPairs.map((one) => [one.name, one.value]));
        for (const one of attrPairs) merged.set(one.name, one.value);
        pairs = [...merged.entries()].map(([name, value]) => ({ name, value }));

        // 配了文本模型就先用模型；失败再退回规则，界面上说明走的是哪条路
        const aiConfig = await readTitleAiConfig();
        let aiError = '';
        if (aiConfig) {
          try {
            state.textContent = `正在用 ${aiConfig.model} 生成标题…`;
            const ai = await generateTitleWithAi({
              ...aiConfig,
              sourceTitle: context.sourceTitle,
              typeName: (context.category && context.category.typeName) || TYPE_NAME_BY_ID[Number(typeIdInput.value)] || '',
              attributes: pairs,
            });
            titleInput.value = ai.title;
            state.textContent = `标题由 ${aiConfig.model} 生成`;
            return;
          } catch (error) {
            aiError = String((error && error.message) || error).slice(0, 160);
          }
        }

        const built = generateTitleFor(context, workspace, ozonAttrs);
        titleInput.value = built.title;
        state.textContent = built.title
          ? `标题已生成（规则：${built.parts.join(' / ')}）` + (built.dropped.length ? `；丢弃：${built.dropped.slice(0, 8).join(',')}` : '')
            + (aiError ? `｜AI 失败：${aiError}` : '')
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
  aiSave.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
        const saved = await writeTitleAiConfig({
          baseUrl: String(aiBase.value || '').trim() || DEFAULT_TITLE_AI.baseUrl,
          model: String(aiModel.value || '').trim() || DEFAULT_TITLE_AI.model,
          apiKey: String(aiKey.value || '').trim(),
        });
        aiKey.value = '';
        aiStatus.textContent = saved.hasKey ? `AI 已配置：${saved.model}` : 'AI 未配置：标题用规则生成';
        state.textContent = saved.hasKey ? `AI 文本已保存（${saved.model}）` : '未填 key：标题走规则生成';
      } catch (error) {
        state.textContent = String((error && error.message) || error);
      }
    })();
  });
  // 打开面板时回填已保存的 AI 配置（key 不回填，只显示模型名）
  void (async () => {
    const cfg = await readTitleAiConfig();
    if (!cfg) return;
    aiBase.value = cfg.baseUrl;
    aiModel.value = cfg.model;
    aiStatus.textContent = `AI 已配置：${cfg.model}`;
  })();
  // 生成图回填：之前生成过就直接用于 listing（等上下文就绪，最多 15 秒）
  void (async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const context = getContext();
      const sourceId = (context && (context.sourceProductId || context.offerBase)) || '';
      if (!sourceId) continue;
      const stored = await loadGeneratedImages(sourceId);
      if (!stored.length) return;
      lastImageResults = stored.map((one) => ({ goalType: one.goalType, url: one.url }));
      if (Number(catIdInput.value) === 0 && Number(typeIdInput.value) === 0) {
        const cached = await readCachedCategory(sourceId);
        if (cached) { catIdInput.value = String(cached.categoryId); typeIdInput.value = String(cached.typeId); }
      }
      state.textContent = `已载入 ${stored.length} 张生成图，listing 会优先用它们`;
      const cachedCat = await readCachedCategory(sourceId);
      if (cachedCat && !Number(catIdInput.value)) { catIdInput.value = String(cachedCat.categoryId); typeIdInput.value = String(cachedCat.typeId); }
      return;
    }
  })();

  return { panel, refresh: () => loadWarehouses(), lastPlan: () => lastPlan };
}