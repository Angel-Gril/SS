import { planDirectItems, offerIdFor } from '../../shared/publish/direct-lane.js';
import { buildRuTitle, composeRuTitle } from '../../shared/ozon/title-rules.js';
import { DEFAULT_TITLE_AI, generateTitleWithAi, generateDescriptionWithAi, readTitleAiConfig, writeTitleAiConfig } from '../../shared/ozon/title-ai.js';
import { describeProductWithAi, visionToAttributePairs } from '../../shared/ozon/vision-ai.js';
import { parseVariantSpecs, pickDictionaryValue, planPrefill, planVariantPrefill } from '../../shared/ozon/attribute-prefill.js';
import { buildImagePromptPlan } from '../../shared/ozon/image-prompt-plan.js';
import { buildDirectPromptPlan } from '../../shared/ozon/direct-prompt-plan.js';
import { colorsFromText } from '../../shared/ozon/color-lexicon.js';
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
  // 视觉规范对齐参考实现（jp panel.html）：设计 token + 卡片 + status-pill + 进程日志。
  try {
    const style = document.createElement('style');
    style.textContent = `
      [data-direct-lane] {
        --ssdl-line: #dbe3ef; --ssdl-brand: #0068ff; --ssdl-text: #16202a;
        --ssdl-muted: #64748b; --ssdl-ok: #118a57; --ssdl-err: #c93d4b;
        --ssdl-warn: #b7791f; --ssdl-bg: #fff;
        font-size: 13px; color: var(--ssdl-text);
      }
      [data-direct-lane] .ssdl-scroll {
        max-height: 62vh; overflow: auto; padding-right: 4px;
      }
      [data-direct-lane] .ssdl-card {
      display: block !important; width: auto;
        border: 1px solid var(--ssdl-line); border-radius: 12px;
        background: var(--ssdl-bg); padding: 10px 12px; margin-bottom: 10px;
      }
      [data-direct-lane] .ssdl-card-title {
        display: block; width: 100%; white-space: nowrap;
        font-weight: 600; font-size: 12px; color: var(--ssdl-muted);
        letter-spacing: .04em; margin-bottom: 8px; text-transform: none;
      }
      [data-direct-lane] .ssdl-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      /* 输入区：label 在上、控件在下，按容器宽度自动分列，避免挤成一条 */
      [data-direct-lane] .precision-local-fields {
        display: grid !important; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 10px 14px !important; align-items: end;
      }
      [data-direct-lane] .precision-local-fields > label {
        display: flex; flex-direction: column; gap: 4px; font-size: 12px;
        color: var(--ssdl-muted); min-width: 0;
      }
      [data-direct-lane] .precision-local-fields > label > input,
      [data-direct-lane] .precision-local-fields > label > select {
        width: 100% !important; box-sizing: border-box;
      }
      /* 按钮行跨满整行，不要占栅格单元（否则会挤成一列） */
      [data-direct-lane] .precision-local-fields > .ssdl-buttons {
        grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
      }
      [data-direct-lane] .precision-local-fields > .ssdl-buttons > button { width: auto; }
      [data-direct-lane] .ssdl-pill {
        display: inline-flex; align-items: center; min-height: 22px; padding: 0 10px;
        border-radius: 999px; font-size: 12px; line-height: 1.4;
        background: #f1f5f9; color: var(--ssdl-muted); border: 1px solid var(--ssdl-line);
        max-width: 100%; word-break: break-word;
      }
      [data-direct-lane] .ssdl-pill[data-tone="ok"] { background: #e8f7ef; color: var(--ssdl-ok); border-color: #bfe8d4; }
      [data-direct-lane] .ssdl-pill[data-tone="err"] { background: #fdecef; color: var(--ssdl-err); border-color: #f6c9d0; }
      [data-direct-lane] .ssdl-pill[data-tone="warn"] { background: #fdf6e7; color: var(--ssdl-warn); border-color: #f0dfb5; }
      [data-direct-lane] .ssdl-log {
        margin-top: 8px; max-height: 160px; overflow: auto; font-size: 12px;
        font-family: ui-monospace, Menlo, Consolas, monospace; color: var(--ssdl-muted);
        border-top: 1px dashed var(--ssdl-line); padding-top: 6px;
      }
      [data-direct-lane] .ssdl-log div { white-space: pre-wrap; word-break: break-word; }
      [data-direct-lane] .ssdl-log div[data-tone="err"] { color: var(--ssdl-err); }
      [data-direct-lane] .ssdl-log div[data-tone="ok"] { color: var(--ssdl-ok); }
    `;
    document.head.append(style);
  } catch (_e) { /* 样式失败不影响功能 */ }

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

  // 变体组：1688 商品常把「套装 / 单件」放在规格第一段，而 Ozon 同一张卡里
  // 同色同码只能留一个变体（DUPLICATE_VARIANT）。0 = 全部合并（会丢组），
  // 1..N = 只发第 N 组，用不同货号前缀分别建卡。
  const variantGroupWrap = make('label', '', '变体组（0=全部）');
  const variantGroupInput = make('input');
  variantGroupInput.type = 'number';
  variantGroupInput.min = '0';
  variantGroupInput.value = '0';
  variantGroupInput.style.width = '70px';
  variantGroupWrap.append(variantGroupInput);
  // 按款式拆卡（alignment §12）：1688 有整类商品把几十个款式塞进「颜色」这一个维度、
  // 尺码全是均码。它们本来就不是「一张卡里的 N 个变体」，而是 N 个独立商品 ——
  // 一起发只会因为同色同码被判 DUPLICATE_VARIANT，最后只剩一条。
  // 勾上后按「标签第一段（款式名）」分组，一组一张单变体卡，货号 = 前缀 + 序号（A1…A55）。
  const splitByStyleWrap = make('label', '', '按款式拆卡 ');
  const splitByStyle = make('input');
  splitByStyle.type = 'checkbox';
  splitByStyle.id = 'ss-erp-split-by-style';
  splitByStyle.title = '每个款式单独一张卡（款式 = 规格标签第一段）；货号 = 前缀 + 序号';
  splitByStyle.addEventListener('change', () => {
    globalThis.__SSERP_SPLIT_BY_STYLE__ = Boolean(splitByStyle.checked);
  });
  splitByStyleWrap.append(splitByStyle);
  // 更新已存在卡：卡已经在 Ozon 上时，同货号 import 就是更新（改标题/文案/属性），不新建。
  const updateExistingWrap = make('label', '', '更新已存在卡 ');
  const updateExistingInput = make('input');
  updateExistingInput.type = 'checkbox';
  updateExistingInput.id = 'ss-erp-update-existing';
  updateExistingInput.title = '同货号重新 import = 更新（只改标题/文案/属性，不新建卡、不动价格库存）';
  updateExistingWrap.append(updateExistingInput);
  // 类目：新商品在 ERP 不可用时就靠这两个数字；有缓存会自动填
  const catWrap = make('label', '', '类目（自动识别）');
  const catIdInput = make('input');
  catIdInput.type = 'number';
  catIdInput.placeholder = '自动识别';
  catIdInput.style.width = '110px';
  const typeIdInput = make('input');
  typeIdInput.type = 'number';
  typeIdInput.placeholder = '自动识别';
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
  // 输入与动作分开：动作按钮单独一行，别占栅格单元（截图里会把输入挤歪）。
  const toolbarButtons = make('div', 'ssdl-buttons');
  toolbarButtons.append(applyMultiplier, autoPricing, refreshWarehouses);
  toolbar.append(offerBaseWrap, skuLimitWrap, variantGroupWrap, splitByStyleWrap, updateExistingWrap, catWrap, costInput.wrap, multiplier.wrap, markup.wrap, strike.wrap, stockInput.wrap,
    weightInput.wrap, widthInput.wrap, heightInput.wrap, depthInput.wrap, warehouseWrap);
  toolbar.append(toolbarButtons);

  const copyRow = make('div', 'precision-local-fields');
  const titleWrap = make('label', '', '俄文标题 ');
  const titleInput = make('input');
  titleInput.type = 'text';
  // 规则版标题优先：标题输入框默认由规则生成（属性驱动，长裙会输出 длинная）。
  // 只有用户**手动**改过（键盘输入）才保留人工值；之前是「输入框非空就保留」，
  // 于是 AI 生成的 Юбка … короткая 一直压着规则版，长裙被写成短裙。
  let titleTouched = false;
  titleInput.addEventListener('input', () => { titleTouched = true; });
  titleInput.addEventListener('keydown', () => { titleTouched = true; });
  titleInput.placeholder = '点「生成标题」或手填';
  titleInput.style.minWidth = '520px';
  titleWrap.append(titleInput);
  const generateTitle = make('button', 'ghost', '生成标题');
  const describeBtn = make('button', 'ghost', '视觉描述');
  const promptPlanBtn = make('button', 'ghost', '生成图片提示词');
  const genImageBtn = make('button', 'ghost', '出 1 张主图');
  const genAllBtn = make('button', 'primary', '按计划出 8 张');
  // 按款式出主图：拆卡场景专用。每个款式用它自己在 1688 的原图当参考图生成一张，
  // 这样 55 张卡的首图各不相同（参考实现同样是「SKU 封面 = 该 SKU 自己的图」）。
  const styleHeroBtn = make('button', 'ghost', '按款式出主图');
  // 按款式出标题：读图取配色/图案 → 每款一条俄文标题（品类名词在最前）。
  const styleTitleBtn = make('button', 'ghost', '按款式出标题');
  const descWrap = make('label', '', '俄文描述 ');
  const descInput = make('input');
  descInput.type = 'text';
  descInput.placeholder = '（可留空）';
  descInput.style.minWidth = '360px';
  descWrap.append(descInput);
  // 文案按钮单独成行，避免和输入框抢栅格单元（截图里挤在左侧）
  const copyButtons = make('div', 'ssdl-buttons');
  copyButtons.append(generateTitle, describeBtn, promptPlanBtn, genImageBtn, genAllBtn, styleHeroBtn, styleTitleBtn);
  copyRow.append(titleWrap, descWrap, copyButtons);

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
  state.className = 'ssdl-pill';
  // 把状态文字转成 pill：成功绿、失败红、其余中性。
  const setStateTone = (text) => {
    const value = String(text || "");
    state.dataset.tone = /完成|通过|成功|Продается/.test(value) ? 'ok'
      : /失败|错误|中断|未通过/.test(value) ? 'err' : '';
  };
  try {
    new MutationObserver(() => setStateTone(state.textContent)).observe(state, { childList: true, characterData: true, subtree: true });
  } catch (_e) {}
  const processLog = make('div', 'ssdl-log');
  const logLine = (text, tone) => {
    const row = document.createElement("div");
    row.textContent = new Date().toLocaleTimeString() + '  ' + String(text || '');
    if (tone) row.dataset.tone = tone;
    processLog.append(row);
    processLog.scrollTop = processLog.scrollHeight;
  };
  // 按钮和状态分行：以前挤在一行，状态一长就把按钮顶走，也看不清结果。
  const actionsRow = make('div');
  actionsRow.style.display = 'flex';
  actionsRow.style.alignItems = 'center';
  actionsRow.style.gap = '8px';
  actionsRow.style.flexWrap = 'wrap';
  // 一键上架：把「视觉 → 提示词 → 生图 → 预检 → 上架」串起来，
  // 这是精铺/知了的主路径；其余按钮收进「高级操作」，默认隐藏。
  const oneClickBtn = make('button', 'primary', '一键上架');
  const advancedToggle = make('button', 'ghost', '高级操作');
  const advancedRow = make('div');
  advancedRow.style.display = 'none';
  advancedRow.style.gap = '8px';
  advancedRow.style.flexWrap = 'wrap';
  advancedRow.style.marginTop = '6px';
  actionsRow.append(oneClickBtn, advancedToggle, precheck, publishBtn, restockBtn);
  actions.append(advancedRow);
  advancedToggle.addEventListener('click', () => {
    const hidden = advancedRow.style.display === 'none';
    advancedRow.style.display = hidden ? 'flex' : 'none';
    precheck.style.display = hidden ? '' : 'none';
    publishBtn.style.display = hidden ? '' : 'none';
    restockBtn.style.display = hidden ? '' : 'none';
    advancedToggle.textContent = hidden ? '收起高级' : '高级操作';
  });
  precheck.style.display = 'none';
  publishBtn.style.display = 'none';
  restockBtn.style.display = 'none';
  const statusRow = make('div');
  statusRow.style.marginTop = '6px';
  statusRow.style.minHeight = '20px';
  statusRow.style.fontSize = '13px';
  statusRow.style.lineHeight = '1.5';
  statusRow.style.whiteSpace = 'normal';
  statusRow.style.wordBreak = 'break-word';
  state.id = 'ss-erp-direct-status';
  state.addEventListener('DOMSubtreeModified', () => { globalThis.__SSERP_STATUS_BEAT__ = Date.now(); });
  try {
    const beatObserver = new MutationObserver(() => { globalThis.__SSERP_STATUS_BEAT__ = Date.now(); });
    beatObserver.observe(state, { childList: true, characterData: true, subtree: true });
  } catch (_e) { /* 无 MutationObserver 也不影响主流程 */ }
  statusRow.append(state);
  actions.append(actionsRow, statusRow);
  actions.append(processLog);

  const table = make('div');
  const output = make('pre');
  output.style.cssText = 'max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px;';
  panel.append(head, toolbar, copyRow, aiRow, actions, table, output);
  // 分区标题（对齐参考实现的卡片式分区）
  try {
    const decorate = (el, title) => {
      if (!el) return;
      el.classList.add('ssdl-card');
      const caption = document.createElement('div');
      caption.className = 'ssdl-card-title';
      caption.textContent = title;
      el.prepend(caption);
    };
    decorate(copyRow, '① 商品与文案');
    decorate(aiRow, '② AI 配置');
    decorate(actions, '③ 上架');
  } catch (_e) {}
  // 调试钩子（只暴露只读上下文，便于脚本核对 SKU key / 类目）
  try { globalThis.__SSERP_PANEL_DEBUG__ = { getContext, readCachedCategory, attributesFromRules, mergeWorkspaceValues, getLastVision: () => lastVisionReport, debugBuildPlan: buildPlan, debugApplyPrice: applyPriceInputs, debugRender: renderTable, debugSplitPlans: buildSplitPlans, debugStyleSegments: () => styleSegments((getContext() || {}).skus), debugDictionary: dictionaryFor, debugStyleHeroes: runStyleHeroes, debugStyleHeroMap: () => styleHeroMap, debugStyleTitles: runStyleTitles, debugStyleTitleMap: () => styleTitleMap, composeRuTitle, matchDictionaryValue }; } catch (_e) {}
  root.append(panel);

  // 直连面板是主路径，不能嵌在 ERP 编辑视图里（那样永远排在页面下方）。
  // 挂载后搬到工作台内容区最前，重渲染时由 renderEditor 的钩子再兜一次。
  try {
    const host = document.querySelector('.content') || document.body;
    if (root.parentElement !== host) host.prepend(root);
  } catch (_e) { /* 容器不可用就保留原位 */ }

  // 面板输入持久化：类目/类型/前缀/成本/上限以前只活在 DOM 里，
  // 一旦面板重建或页面重载就清空，流程随后报「没有类目」，非常难排查。
  // 这里把它们存到 localStorage，重建后自动恢复。
  try {
    const PERSIST_KEY = 'ss-erp:direct-lane:inputs';
    const sourceNow = () => String(((getContext() || {}).sourceProductId) || '');
    // 按**字段名**持久化，不再按 DOM 序号。序号会漂移：价格表格的行输入也在 root 里，
    // 行数一变后面所有字段就串位 —— 实测把 AI baseUrl 存进了「俄文描述」，描述被
    // stripLinks 清空，卡片判「Не удалось создать описание」。
    const PERSIST_NAMES = new Map([
      [offerBaseInput, 'offerBase'], [skuLimitInput, 'skuLimit'], [variantGroupInput, 'variantGroup'],
      [catIdInput, 'catId'], [typeIdInput, 'typeId'],
      [costInput.input, 'cost'], [multiplier.input, 'multiplier'], [markup.input, 'markup'],
      [strike.input, 'strike'], [stockInput.input, 'stock'],
      [weightInput.input, 'weight'], [widthInput.input, 'width'],
      [heightInput.input, 'height'], [depthInput.input, 'depth'],
      [titleInput, 'title'], [descInput, 'desc'], [aiBase, 'aiBase'], [aiModel, 'aiModel'],
    ]);
    for (const [el, name] of PERSIST_NAMES) {
      try { el.setAttribute('data-persist', name); } catch (_e) {}
    }
    const persistables = () => [...root.querySelectorAll('[data-persist]')];
    const saveInputs = () => {
      const data = {};
      for (const el of persistables()) data[el.getAttribute('data-persist')] = String(el.value || "");
      // 记下这批输入属于哪个货源商品：换商品后类目/类型不能沿用上一个的。
      data.__source = sourceNow();
      try { localStorage.setItem(PERSIST_KEY, JSON.stringify(data)); } catch (_e) {}
    };
    const restoreInputs = () => {
      let data = null;
      try { data = JSON.parse(localStorage.getItem(PERSIST_KEY) || "null"); } catch (_e) { data = null; }
      if (!data || typeof data !== 'object') return;
      // 旧版按序号存（键是 "0"/"1"…），字段已经串过位：整体丢弃，重新记一次就好。
      if (!('offerBase' in data) && data['0'] != null) {
        try { localStorage.removeItem(PERSIST_KEY); } catch (_e) {}
        return;
      }
      // 类目/类型按商品隔离：实测袜子商品沿用了上一个裙子商品的类目（200000933/93283），
      // 于是必填属性按裙子算、卡片按裙子建。换商品时这两个必须空着走自动识别。
      const sameSource = !data.__source || data.__source === sourceNow();
      for (const el of persistables()) {
        const key = el.getAttribute('data-persist');
        if (!sameSource && (key === 'catId' || key === 'typeId')) continue;
        const value = data[key];
        if (value != null && !String(el.value || '').trim()) el.value = value;
      }
    };
    restoreInputs();
    root.addEventListener('input', saveInputs);
    root.addEventListener('change', saveInputs);
  } catch (_e) { /* 持久化失败不影响使用 */ }

  let busy = false;
  // 采集上下文里的**原始**货号（源商品号）。buildPlan 会把 context.offerBase 改成前缀，
  // 之后任何「按源商品取缓存」的地方（生成图/类目）都会拿到前缀键，全部读空。
  // 第一次看到的货号记在这里，作为稳定的源身份。
  let sourceOfferBase = '';
  const sourceIdOf = (context) => String((context && (context.sourceProductId || sourceOfferBase || context.offerBase)) || '');
  // busy 卡死自愈：异常路径没走到 busy=false 时（实测踩过），10 分钟后自动放行
  let busySince = 0;
  const claimBusy = () => {
    if (busy && Date.now() - busySince > 120000) busy = false;
    if (busy) return false;
    busy = true;
    busySince = Date.now();
    return true;
  };
  // 看门狗：长任务（生图/发布）超时或被回收时，busy 会一直挂着，按钮永久变灰，
  // 表现就是「点什么都没反应」——之前只能靠重启浏览器。这里到点自动解锁并说明原因。
  setInterval(() => {
    if (!busy) return;
    // 用「状态多久没变化」判断，而不是总时长：14 个 SKU 的发布本来就要 5 分钟以上，
    // 按总时长会误判成卡死。
    if (Date.now() - (globalThis.__SSERP_STATUS_BEAT__ || busySince) < 180000) return;
    busy = false;
    try {
      precheck.disabled = false;
      publishBtn.disabled = false;
      oneClickBtn.disabled = false;
      restockBtn.disabled = false;
      globalThis.__SSERP_STATUS_BEAT__ = Date.now();
      state.textContent = "上一个操作超过 3 分钟未返回，已解锁；失败请重试";
    } catch (_e) { /* 面板可能已销毁 */ }
  }, 5000);
  let lastPlan = null;
  let warehouses = [];
  let workspaceCache = null;
  let lastVisionReport = null;   // 精铺形态的视觉报告（一次），喂标题/属性/生图
let lastVisionText = "";
  let lastPromptPlan = null;     // PromptPlan v2（主图 + 7 张详情图）
let lastWorkspaceForPlan = null;   // 规则版提示词要读已填属性

  // 类目类型名的俄文写法：类目树用中文查（ZH_HANS）拿到的是「T恤」，拼进俄文标题会变成 "T женский…"。
  // 这里按 type_id 反查俄文名并缓存，标题一律用俄文名词。
  let russianTypeNameCache = null;
  let ozonTypeListCache = null;
  let ozonTypeZhCache = null;
  // 拉一次类目树（俄文名），缓存 typeId → 名称 与完整类型表。
  async function loadOzonTypes() {
    if (russianTypeNameCache && ozonTypeListCache) return { byId: russianTypeNameCache, list: ozonTypeListCache };
    const byId = new Map();
    const list = [];
    const zhList = [];
    const ruTree = await send('ss-erp:direct-ozon-post', { path: '/v1/description-category/tree', body: { language: 'DEFAULT' } });
    for (const top of (ruTree && ruTree.result) || []) {
      for (const cat of (top.children || [])) {
        for (const leaf of (cat.children || [])) {
          const typeId = Number(leaf.type_id);
          const typeName = String(leaf.type_name || "").trim();
          const categoryId = Number(cat.description_category_id || cat.category_id) || 0;
          if (!typeId || !typeName) continue;
          byId.set(typeId, typeName);
          list.push({ typeId, typeName, categoryId });
        }
      }
    }
    // 中文树：用来匹配中文商品标题（俄文树匹配不到中文）
    try {
      const zhTree = await send('ss-erp:direct-ozon-post', { path: '/v1/description-category/tree', body: { language: 'ZH_HANS' } });
      for (const top of (zhTree && zhTree.result) || []) {
        for (const cat of (top.children || [])) {
          for (const leaf of (cat.children || [])) {
            const typeId = Number(leaf.type_id);
            const zhName = String(leaf.type_name || "").trim();
            const categoryId = Number(cat.description_category_id || cat.category_id) || 0;
            const topName = String(top.category_name || "").trim();
            if (typeId && zhName) zhList.push({ typeId, zhName, categoryId, topName });
          }
        }
      }
    } catch (_e) { /* 中文树拿不到就只用俄文 */ }
    russianTypeNameCache = byId;
    ozonTypeListCache = list;
    ozonTypeZhCache = zhList;
    return { byId, list, zhList };
  }
  async function russianTypeName(typeId) {
    const target = Number(typeId) || 0;
    if (!target) return "";
    try {
      const { byId } = await loadOzonTypes();
      return String(byId.get(target) || "");
    } catch (_e) { return ""; }
  }
  // 从文本（视觉报告的类型名 / 商品标题）猜类目：优先俄文类型名精确/包含匹配。
  // 从文本猜类目：俄文类型名精确/包含优先；中文标题按「类型名覆盖度」打分。
  async function resolveCategoryFromText(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    const needle = raw.toLowerCase();
    try {
      const { list, zhList } = await loadOzonTypes();
      const exact = list.find((one) => one.typeName.toLowerCase() === needle);
      if (exact) return exact;
      const contains = list.find((one) => one.typeName.length >= 3 && needle.includes(one.typeName.toLowerCase()));
      if (contains) return contains;
      // 中文匹配：标题里出现、类型名最长的优先。
      // 但必须限定「服装」大类——否则「蝴蝶结」这种配饰词会把类目带到 Бабочка（领结）。
      const matches = [];
      for (const one of zhList || []) {
        const name = String(one.zhName || "").trim();
        if (name.length < 2 || !raw.includes(name)) continue;
        matches.push(one);
      }
      if (!matches.length) return null;
      const isApparel = (one) => /服饰|服装|女装|男装|衣着|内衣/.test(String(one.topName || ""));
      const apparel = matches.filter(isApparel);
      const pool = apparel.length ? apparel : matches;
      let best = null;
      // 同长度时取标题里更靠后的（中文标题中心词通常在末尾），
      // 并把「蝴蝶 / 蕾丝」这类修饰词压到后面（它们是装饰，不是品类）。
      const scoreOf = (one) => {
        const name = String(one.zhName || "");
        const at = raw.lastIndexOf(name);
        const modifierPenalty = /蝴蝶|蕾丝|花边|绣花/.test(name) ? -1000 : 0;
        return name.length * 100 + at + modifierPenalty;
      };
      for (const one of pool) {
        if (!best || scoreOf(one) > scoreOf(best)) best = one;
      }
      if (!best) return null;
      const ru = list.find((one) => one.typeId === best.typeId);
      return { typeId: best.typeId, categoryId: best.categoryId, typeName: (ru && ru.typeName) || best.zhName };
    } catch (_e) { return null; }
  }
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
      // priceInputs 里存的键是 priceInput/oldPriceInput；早先写成 price/oldPrice，
      // 于是「按倍率填价」看起来点了、其实一行都没改（静默无效）。
      inputs.priceInput.value = computed.price.toFixed(2);
      inputs.oldPriceInput.value = computed.oldPrice.toFixed(2);
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
      row.append(make('span', '', `${item.__style ? String(item.__style) + ' · ' : ''}${item.suffix} · 成本 ${item.__cost == null ? '—' : money(item.__cost)}`));
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
  // 已上架查询：必须带超时 + 短缓存。
  // 实测：预检调一次没问题，紧接着的上架再调同一个接口会撞限流，而 sendMessage 没有
  // 超时 → buildPlan 永久等，表现就是「点直连上架后按钮一直灰、状态不动」。
  const existingCache = new Map();   // offers 键 → { at, map }
  const OZON_QUERY_TIMEOUT_MS = 20000;
  async function withTimeout(promise, ms, fallback) {
    let timer = 0;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
    try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
  }
  async function fetchOzonProducts(offers) {
    if (!offers.length) return null;
    const key = offers.join('|');
    const hit = existingCache.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.map;
    try {
      const result = await withTimeout(send('ss-erp:direct-ozon-post', {
        path: '/v4/product/info/attributes',
        body: { filter: { offer_id: offers, visibility: 'ALL' }, limit: Math.max(offers.length, 1) },
      }), OZON_QUERY_TIMEOUT_MS, null);
      const rows = Array.isArray(result && result.result) ? result.result : [];
      const map = rows.length ? new Map(rows.map((row) => [String(row.offer_id), row])) : null;
      existingCache.set(key, { at: Date.now(), map });
      return map;
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

  function planFromOzon(context, skus, offers, byOffer, priceMap, titleOverride) {
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
      const name = String(titleOverride || titleInput.value || row.name || '').trim();
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
    // 有生成图就只用生成图：混进 1688 原图会把中文水印带回 listing（实测 8 生成 + 6 原图 = 14 张）。
    // 只有一张生成图都没有时，才退回采集原图。
    const pool = generated.length ? generated : source;
    return pool.filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    }).slice(0, 15);
  }

  /** 生成图落本地：重开面板/重载扩展都不丢，listing 直接复用 */
  async function saveGeneratedImages(results) {
    try {
      // 采集上下文不一定带 sourceProductId（1688 适配器只给 offerBase），
      // 之前只用 sourceProductId → 空 → 生成图一张都没存下来，重载扩展就得重新生图。
      const sourceId = sourceIdOf(getContext());
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

  // ── 按款式出主图（拆卡用）──────────────────────────────────────────────
  // 参考实现（精铺 §11.1）里 SKU 封面是「该 SKU 自己的图」，产品级共享图另算。
  // 55 款商品如果共用一套生成图，店铺里就是 55 个长得一模一样的商品 —— 买家分不出款式。
  // 所以每个款式用它自己在 1688 的原图当参考图生成一张主图，按款式名缓存。
  const styleHeroKey = (sourceId) => 'ss-erp:direct-lane:style-hero:' + String(sourceId || '');
  let styleHeroMap = new Map();

  async function loadStyleHeroes(sourceId) {
    styleHeroMap = new Map();
    if (!sourceId) return styleHeroMap;
    try {
      const got = await chrome.storage.local.get(styleHeroKey(sourceId));
      const list = got && got[styleHeroKey(sourceId)];
      for (const one of (Array.isArray(list) ? list : [])) {
        if (one && one.segment && /^https:\/\//.test(String(one.url || ''))) styleHeroMap.set(String(one.segment), String(one.url));
      }
    } catch (_error) { /* 读不到就当没生成过 */ }
    return styleHeroMap;
  }

  async function saveStyleHero(segment, url) {    const sourceId = sourceIdOf(getContext());
    if (!sourceId || !segment || !url) return;
    styleHeroMap.set(String(segment), String(url));
    try {
      await chrome.storage.local.set({
        [styleHeroKey(sourceId)]: [...styleHeroMap.entries()].map(([seg, u]) => ({ segment: seg, url: u, at: Date.now() })),
      });
    } catch (_error) { /* 存不下不影响本轮 */ }
  }

  // 提示词要点（实测出来的，别乱改）：
  //   · 参考图是 1688 的礼盒照，袜口带 "alo" 字样 —— 必须显式要求「素罗纹袜口、无字样」，
  //     否则模型会照抄字母（v2「只取配色」那版就抄回来了）。
  //   · 只保留配色 / 条纹 / 针织物性，盒子、吊牌、卡片全部显式排除。
  const STYLE_HERO_PROMPT = [
    'Studio e-commerce product photograph for an Ozon listing, aspect ratio 3:4.',
    'Show five loose socks standing side by side on a plain light grey seamless background.',
    'Keep only the colour palette, the stripes and the knit texture of the reference image.',
    'The cuffs are completely plain ribbed knit: no lettering, no monogram, no logo, no brand mark of any kind.',
    'Do not copy any text, word or symbol from the reference image. Socks only, no box, no packaging, no tag.',
    'Soft even studio light, front view, product fills about 75% of the frame, sharp commercial retouching.',
  ].join(' ');

  /** 逐款式出主图（已生成过的跳过；limit>0 只做前 N 个款式，便于先试几张） */
  async function runStyleHeroes(limit) {
    await refreshStyleCaches();
    const context = getContext();
    const allSkus = (context && context.skus) || [];
    const segments = styleSegments(allSkus);
    if (!segments.length) throw new Error('请先采集来源商品');
    const picked = Number(limit) > 0 ? segments.slice(0, Number(limit)) : segments;
    const failed = [];
    let ok = 0;
    let skipped = 0;
    for (const [index, segment] of picked.entries()) {
      if (styleHeroMap.has(segment)) { ok += 1; skipped += 1; continue; }
      const sku = allSkus.find((one) => styleOf(one) === segment);
      const reference = String((sku && sku.imageUrl) || '');
      state.textContent = `款式主图 ${index + 1}/${picked.length}：${segment}…`;
      try {
        const result = await send('ss-erp:direct-image-generate', {
          prompt: STYLE_HERO_PROMPT,
          // 参考图必须带上：没有它，55 个款式会生成出 55 张几乎一样的图
          inputImageUrls: /^https?:\/\//.test(reference) ? [reference] : [],
          timeoutMs: 240000,
        });
        const url = result && (result.url || result.imageUrl || (result.urls && result.urls[0]));
        if (!url) throw new Error('生图没有返回地址');
        await saveStyleHero(segment, url);
        ok += 1;
      } catch (error) {
        failed.push({ segment, error: String((error && error.message) || error).slice(0, 120) });
        logLine(`款式主图失败 ${segment}：${String((error && error.message) || error).slice(0, 80)}`, 'err');
      }
    }
    globalThis.__SSERP_STYLE_HEROES__ = { total: picked.length, ok, skipped, failed };
    state.textContent = `款式主图完成：${ok}/${picked.length}` + (skipped ? `（跳过已有 ${skipped}）` : '') + (failed.length ? `，失败 ${failed.length}` : '');
    return { ok, total: picked.length, skipped, failed };
  }

  // ── 款式标题（拆卡时每款一条，2026-11-18）────────────────────────────────
  // 55 张卡共用一条标题，搜索侧完全一样，买家没法区分；这里按「款式名 + 视觉配色」
  // 给每个款式一条自己的俄文标题，仍然遵守「品类名词在最前」这条硬约束。
  const styleTitleKey = (sourceId) => 'ss-erp:direct-lane:style-title:' + String(sourceId || '');
  let styleTitleMap = new Map();
  // 生成标题时用到的输入（配色/图案）也一起缓存：改拼装规则时可以直接重算，
  // 不用再对 55 张图跑一遍视觉（那次要 11 分钟）。
  let styleMetaMap = new Map();
  // 款式名里的高度/功能词（1688 的款式名是中文，只能按关键词映射）
  const STYLE_HEIGHT = [
    [/反光/, 'со светоотражающими элементами'],
    [/中筒/, 'средней высоты'],
    [/长筒|长袜/, 'длинные'],
    [/船袜|隐形/, 'невидимые'],
    [/短筒|短袜/, 'короткие'],
  ];
  // 视觉给出的图案词（中文）→ 俄文短语，用来把同色同族的款式再区分开
  const STYLE_PATTERN = [
    [/条纹|条子/, 'в полоску'],
    [/人字|方框|菱形/, 'в елочку'],
    [/扎染|喷染/, 'тай-дай'],
    [/拼色|撞色/, 'двухцветные'],
    [/印花|图案/, 'с принтом'],
    [/纯色/, 'однотонные'],
  ];

  async function loadStyleTitles(sourceId) {
    styleTitleMap = new Map();
    styleMetaMap = new Map();
    if (!sourceId) return styleTitleMap;
    try {
      const got = await chrome.storage.local.get(styleTitleKey(sourceId));
      const list = got && got[styleTitleKey(sourceId)];
      for (const one of (Array.isArray(list) ? list : [])) {
        if (!one || !one.segment) continue;
        if (String(one.title || '').trim()) styleTitleMap.set(String(one.segment), String(one.title));
        if (Array.isArray(one.colours) || one.pattern) {
          styleMetaMap.set(String(one.segment), { colours: Array.isArray(one.colours) ? one.colours : [], pattern: String(one.pattern || '') });
        }
      }
    } catch (_error) { /* 读不到就当没生成过 */ }
    return styleTitleMap;
  }

  async function saveStyleTitle(segment, title, meta) {
    const sourceId = sourceIdOf(getContext());
    if (!sourceId || !segment || !title) return;
    styleTitleMap.set(String(segment), String(title));
    if (meta) styleMetaMap.set(String(segment), meta);
    try {
      await chrome.storage.local.set({
        [styleTitleKey(sourceId)]: [...styleTitleMap.entries()].map(([seg, t]) => ({
          segment: seg,
          title: t,
          colours: (styleMetaMap.get(seg) || {}).colours || [],
          pattern: (styleMetaMap.get(seg) || {}).pattern || '',
          at: Date.now(),
        })),
      });
    } catch (_error) { /* 存不下不影响本轮 */ }
  }

  /** 看图取「配色 + 图案」（中文），用于区分同族款式；失败返回空，标题仍能出 */
  async function observeStylePattern(imageUrl, cfg) {
    if (!cfg || !cfg.apiKey || !/^https?:\/\//.test(String(imageUrl || ''))) return { colours: [], pattern: '' };
    try {
      const result = await send('ss-erp:direct-ai-text', {
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: 'qwen3.8-flash',
        maxTokens: 120,
        timeoutMs: 60000,
        responseFormat: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Answer with one JSON object only.' },
          {
            role: 'user',
            content: [
              { type: 'text', text: '看这张袜子商品图，只回 JSON：{"颜色":"最主要的 1-2 个中文颜色词","图案":"中文图案词（纯色/条纹/人字纹/扎染/印花/拼色）"}。颜色只用常见词：黑/白/灰/米色/粉色/蓝色/深蓝/绿色/黄色/橙色/棕色/紫色/红色。' },
              { type: 'image_url', image_url: { url: String(imageUrl) } },
            ],
          },
        ],
      });
      let parsed = {};
      try { parsed = JSON.parse(String((result && result.content) || '{}')); } catch (_error) { parsed = {}; }
      const colourText = String(parsed['颜色'] || parsed.colors || '');
      return { colours: colorsFromText(colourText).slice(0, 2), pattern: String(parsed['图案'] || parsed.pattern || '') };
    } catch (_error) {
      return { colours: [], pattern: '' };
    }
  }

  /** 逐款式生成俄文标题（有配色缓存则只重算；limit>0 只做前 N 个款式） */
  async function runStyleTitles(limit, force = false) {
    await refreshStyleCaches();
    const context = getContext();
    if (!context || !context.skus || !context.skus.length) throw new Error('请先采集来源商品');
    const cfg = await readTitleAiConfig();
    const allSkus = context.skus || [];
    const segments = styleSegments(allSkus);
    const picked = Number(limit) > 0 ? segments.slice(0, Number(limit)) : segments;
    // 品类名词 / 材质直接复用规则标题（它已经算出 «Носки» 与 «хлопковые»）
    const base = buildRuTitle({
      typeName: (context.category && context.category.typeName) || TYPE_NAME_BY_ID[Number(typeIdInput.value)] || '',
      sourceTitle: context.sourceTitle || '',
      fallbackTypeName: 'Носки',
    });
    const noun = base.category || 'Носки';
    const material = base.material || '';
    const failed = [];
    let ok = 0;
    let skipped = 0;
    let collided = 0;
    const used = new Set(styleTitleMap.values());
    for (const [index, segment] of picked.entries()) {
      const sku = allSkus.find((one) => styleOf(one) === segment);
      const image = styleHeroMap.get(segment) || String((sku && sku.imageUrl) || '');
      const cached = styleMetaMap.get(segment);
      // 已经有配色缓存就直接重算标题（改拼装规则时不必再跑视觉）；
      // 没有缓存才读图。
      if (styleTitleMap.has(segment) && cached && !force) { ok += 1; skipped += 1; continue; }
      state.textContent = `款式标题 ${index + 1}/${picked.length}：${segment}…`;
      try {
        const seen = cached || await observeStylePattern(image, cfg);
        const gender = /男/.test(segment) ? 'мужск' : /女/.test(segment) ? 'женск' : '';
        const features = STYLE_HEIGHT.filter(([re]) => re.test(segment)).map(([, ru]) => ru);
        let { title } = composeRuTitle({ category: noun, gender, material, features, colours: seen.colours });
        if (!title) throw new Error('标题为空');
        // 同族同色会撞标题：加上图案短语，仍撞就带型号，保证 55 条互不相同
        if (used.has(title) && styleTitleMap.get(segment) !== title) {
          collided += 1;
          const extra = STYLE_PATTERN.filter(([re]) => re.test(seen.pattern)).map(([, ru]) => ru);
          const withPattern = composeRuTitle({ category: noun, gender, material, features: [...features, ...extra], colours: seen.colours }).title;
          title = withPattern && !used.has(withPattern) ? withPattern : `${title}, модель ${index + 1}`;
        }
        used.delete(styleTitleMap.get(segment));
        used.add(title);
        await saveStyleTitle(segment, title, seen);
        ok += 1;
      } catch (error) {
        failed.push({ segment, error: String((error && error.message) || error).slice(0, 120) });
        logLine(`款式标题失败 ${segment}：${String((error && error.message) || error).slice(0, 80)}`, 'err');
      }
    }
    globalThis.__SSERP_STYLE_TITLES__ = { total: picked.length, ok, skipped, collided, failed, titles: [...styleTitleMap.entries()].slice(0, 60) };
    state.textContent = `款式标题完成：${ok}/${picked.length}` + (skipped ? `（跳过已有 ${skipped}）` : '') + (collided ? `，撞名修正 ${collided}` : '') + (failed.length ? `，失败 ${failed.length}` : '');
    return { ok, total: picked.length, skipped, collided, failed };
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
  // 兜底写入前先清掉该属性上的「未解析占位行」：否则 attributeMapFor 仍会看到那一行，
  // 预检照样报「字典没解析到属性 10096, 9163」。
  // 该属性是否已有「已解析」的值（占位行不算）
  function hasColorResolved(workspace, attributeId) {
    // 10096 是 SKU 级集合属性：产品级那一行不算数，否则会被误判成「已有颜色」而跳过兜底。
    return ((workspace && workspace.values) || []).some((row) => Number(row.attributeId) === Number(attributeId)
      && String(row.skuKey || '').trim()
      && !row.__unresolved
      && (((row.dictionaryValueIds || []).length) || String(row.value || "").trim()));
  }

  // Ozon 禁止文本属性里出现外部链接（error_external_link_in_text_attribute@4191）。
  // 生成的描述偶尔带来源链接，发之前统一清掉。
  // 重复上架台账：同一个 1688 货源商品换前缀重发，Ozon 会判
  // 「类似商品重复」（SPU_ALREADY_EXISTS）——之前我在同一个商品上发了 A1..E1 五遍，
  // 80 条里 64 条报错。这里记账，重发前先拦。
  const PUBLISHED_KEY = "ss-erp:published-sources:v1";
  async function readPublishedSources() {
    try {
      const got = await chrome.storage.local.get([PUBLISHED_KEY]);
      const value = got[PUBLISHED_KEY];
      return value && typeof value === "object" ? value : {};
    } catch (_e) { return {}; }
  }
  async function rememberPublished(sourceId, offerBase, splitBase) {
    if (!sourceId || !offerBase) return;
    try {
      const all = await readPublishedSources();
      const previous = all[String(sourceId)] || {};
      // splitBase：按款式拆卡时用的「卡号前缀」。普通上架没有这一项，保留旧值不影响判断。
      all[String(sourceId)] = splitBase
        ? { offerBase: String(offerBase), splitBase: String(splitBase), at: new Date().toISOString() }
        : { offerBase: String(offerBase), at: new Date().toISOString() };
      if (!splitBase && previous.splitBase) all[String(sourceId)].splitBase = previous.splitBase;
      await chrome.storage.local.set({ [PUBLISHED_KEY]: all });
    } catch (_e) { /* 记不上不影响上架 */ }
  }

  function stripLinks(text) {
    return String(text || "")
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/www\.\S+/gi, "")
      .replace(/[a-z0-9-]+\.(com|cn|ru|net|org)(\/\S*)?/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // 颜色按名查字典：buildPlan 与 attributesFromRules 都要用，必须放在工厂作用域。
  // 之前定义在 attributesFromRules 内部，buildPlan 里调用会抛 ReferenceError，
  // 而外层 catch 是静默的 —— 表现就是「归一化没生效但也不报错」。
  const colourValueCache = new Map();
  async function lookupColourValue(attributeId, colourWord) {
    const key = [category.categoryId, category.typeId, attributeId, String(colourWord || "").trim()].join("|");
    if (colourValueCache.has(key)) return colourValueCache.get(key);
    const want = String(colourWord || "").trim().toLowerCase();
    // Ozon 会忽略 /attribute/values 的 query 过滤（实测传 value=120 也返回同一批），
    // 所以这里必须翻页拿全量再本地匹配，否则颜色会全部退化成默认色。
    let hit = null;
    let lastValueId = 0;
    for (let page = 0; page < 8 && !hit; page += 1) {
      const asked = await send("ss-erp:direct-ozon-attribute-values", {
        categoryId: category.categoryId, typeId: category.typeId,
        attributeId, query: "", limit: 200, lastValueId, language: "DEFAULT",
      }).catch(() => null);
      const values = (asked && asked.values && (asked.values[attributeId] || asked.values)) || [];
      const list = Array.isArray(values) ? values : [];
      if (!list.length) break;
      hit = list.find((one) => String(one.value || "").trim().toLowerCase() === want) || null;
      lastValueId = Number(list[list.length - 1].id) || 0;
      if (!lastValueId || list.length < 200) break;
    }
    colourValueCache.set(key, hit);
    return hit;
  }

  function replaceUnresolved(workspace, attributeId) {
    workspace.values = (workspace.values || []).filter((row) => !(Number(row.attributeId) === Number(attributeId) && row.__unresolved));
  }

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
  // 数值型（尺码等）：字典里没有这个数就取最近的。
  // 实测儿童睡衣是 120/130/140cm，而 Ozon 俄罗斯尺码只有 116/122/128/134/140…，
  // 没有最近值匹配就会整体缺尺码，所有变体被合并成一条。
  const needleNum = Number(String(text || '').replace(/[^0-9.]/g, ''));
  if (Number.isFinite(needleNum) && needleNum > 0) {
    let best = null;
    let bestGap = Infinity;
    for (const one of rows) {
      const num = Number(String(one.value || '').replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(num) || num <= 0) continue;
      const gap = Math.abs(num - needleNum);
      if (gap < bestGap) { bestGap = gap; best = one; }
    }
    if (best) return best;
  }
  return byTwo || null;
  }

  /**
   * 取一份字典值（内存 memo → 本地缓存 → 实时拉，带退避重试）。
   * 为什么要有它：55 张卡连续规划时每一张都裸打一次 /attribute/values，Ozon 立刻限流、
   * 返回空列表 → 尺码映射不上 → 31 张卡全报 REQUIRED_ATTRIBUTES（实测 2026-11-17）。
   * 缓存键与 attributesFromRules 里的 dictStorageKey 保持一致，两边共用同一份。
   */
  const dictMemo = new Map();
  async function dictionaryFor(categoryRef, attributeId) {
    const id = Number(attributeId) || 0;
    if (!id || !categoryRef) return [];
    const memoKey = `${categoryRef.categoryId}|${categoryRef.typeId}|${id}`;
    if (dictMemo.has(memoKey)) return dictMemo.get(memoKey);
    const key = `ss-erp:dict:${categoryRef.categoryId}:${categoryRef.typeId}:${id}`;
    const readCached = async () => {
      try {
        const got = await chrome.storage.local.get([key]);
        return Array.isArray(got[key]) ? got[key] : [];
      } catch (_e) { return []; }
    };
    const cached = await readCached();
    if (cached.length) { dictMemo.set(memoKey, cached); return cached; }
    // 限流时字典会连着回空：重试要够长（3s/6s/12s/18s），一次失败就判死会毁掉整批卡
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const listed = await send('ss-erp:direct-ozon-attribute-values', {
        categoryId: categoryRef.categoryId, typeId: categoryRef.typeId,
        attributeIds: [id], query: '', limit: 1000, language: 'DEFAULT',
      }).catch(() => null);
      const list = (listed && listed.values && listed.values[id]) || [];
      if (list.length) {
        dictMemo.set(memoKey, list);
        try { await chrome.storage.local.set({ [key]: list.slice(0, 400) }); } catch (_e) {}
        return list;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt * (attempt > 1 ? 2 : 1)));
    }
    return [];
  }

  async function attributesFromRules(context, category, skus) {
    // 字典列表按 attributeId 缓存：之前每个属性 × 每个 SKU 各请求一次（limit 1000），
    // 12 个 SKU 就是上百次往返 + 大 JSON 解析，实测把渲染进程卡死。
    const dictCache = new Map();
  // 同一个 attributeId 在不同 类目/类型 下字典不同：
  // 实测 10096 用睡衣(93176)的字典值发到半身裙(93283)，Ozon 回
  // error_attribute_values_out_of_range。所以缓存 key 必须带类目和类型。
  const dictScope = () => String(category.categoryId) + "|" + String(category.typeId);
  const dictKeyOf = (attributeId) => dictScope() + "|" + String(attributeId);
    let dictFailures = 0;   // 熔断计数：SW 挂了的时候别一个属性等 45 秒，十个就是七八分钟
  // 字典本地缓存：Ozon 限流时（实测同一天几百次调用后必然出现）字典会返回空，
  // 空结果 → 必填属性补齐失败 → 上架被拒。这里把成功过的字典存到 chrome.storage，
  // 读不到实时数据时退回缓存，颜色这类稳定字典完全没必要每次都拉。
  const dictStorageKey = (attributeId) => `ss-erp:dict:${category.categoryId}:${category.typeId}:${attributeId}`;
  // 按颜色名精确查一个字典值：整份列表拉不到（限流）时也能逐个拿到，
  // 否则每个 SKU 都会退回同一个默认色，多色商品会被合并成一条。

  async function readCachedDict(attributeId) {
    try {
      const key = dictStorageKey(attributeId);
      const got = await chrome.storage.local.get([key]);
      return Array.isArray(got[key]) ? got[key] : [];
    } catch (_e) { return []; }
  }
  async function writeCachedDict(attributeId, list) {
    if (!Array.isArray(list) || !list.length) return;
    try {
      const key = dictStorageKey(attributeId);
      await chrome.storage.local.set({ [key]: list.slice(0, 400) });
    } catch (_e) { /* 存不下不影响主流程 */ }
  }

    const dictionaryOf = async (attributeId) => {
      if (dictFailures >= 2) return [];   // 已判定不可用：本轮直接当空
      const id = Number(attributeId);
  if (dictCache.has(dictKeyOf(id))) return dictCache.get(dictKeyOf(id));
      let list = [];
      try {
        const found = await send('ss-erp:direct-ozon-attribute-values', {
          categoryId: category.categoryId, typeId: category.typeId, attributeId: id, query: '', limit: 400,
        });
        list = (found && found.values) || [];
      } catch (_error) { list = []; }
      // 网关可能无视 limit 返回上千条；大列表上的模糊匹配会把渲染线程堵死（实测 180s+）
      if (list.length > 400) list = list.slice(0, 400);
  // 只缓存「拿到了值」的结果：空结果缓存 + 熔断组合起来会把字典永久判死，
  // 表现就是换个类目后报「字典没解析到属性 10096, 9163」。
  if (list.length) { dictCache.set(dictKeyOf(id), list); dictFailures = 0; void writeCachedDict(id, list); }
  else {
    // 实时读失败（多半是限流）：用上次成功缓存的字典顶上。
    const cached = await readCachedDict(id);
    if (cached.length) { dictCache.set(dictKeyOf(id), cached); return cached; }
  }
  return list;
      return list;
    };
    const schema = await send('ss-erp:direct-ozon-attributes', { categoryId: category.categoryId, typeId: category.typeId });
    const fields = (schema && schema.fields) || [];
  // schema 为空多半是 Ozon 限流（今天同一个店铺调用了几百次）。
  // 不重试就会带着空字段往下走，最后报「字典没解析到属性」，看不出真实原因。
  if (!fields.length) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const retried = await send('ss-erp:direct-ozon-attributes', { categoryId: category.categoryId, typeId: category.typeId }).catch(() => null);
    const retriedFields = (retried && retried.fields) || [];
    if (!retriedFields.length) {
      throw new Error("读取类目属性失败（Ozon 限流或接口异常）：" + String(category.categoryId) + "/" + String(category.typeId) + "，稍后重试");
    }
    fields.push(...retriedFields);
  }
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

    // 字典预热：一次消息批量取回所有需要的 attributeId。
    // 逐个属性各发一条消息，偶发不回的属性会把整个 buildPlan 拖成几分钟（实测 7.5 分钟）；
    // 批量后即使失败也只影响这一批，且立即返回。
    {
      const need = [...new Set(items.filter((one) => one.kind !== 'text').map((one) => Number(one.attributeId)))]
        .filter((id) => id > 0 && !dictCache.has(id));
      if (need.length) {
        const started = Date.now();
        const response = await send('ss-erp:direct-ozon-attribute-values', {
          categoryId: category.categoryId, typeId: category.typeId, attributeIds: need, query: '', limit: 400, language: 'DEFAULT',
        }).catch(() => null);
        const map = (response && response.values) || {};
        for (const id of need) {
          const list = Array.isArray(map[id]) ? map[id].slice(0, 400) : [];
        if (!list.length) continue;   // 空结果不缓存、不计熔断（下次还能重试）
        dictFailures = 0;
        dictCache.set(dictKeyOf(Number(id)), list);
        }
        globalThis.__SSERP_DICT_BATCH__ = { need: need.length, ms: Date.now() - started };
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

  /** 款式名 = 规格标签第一段（1688 常把钱 55 个款式放在「颜色」维度里） */
  const styleOf = (sku) => String((sku && sku.label) || "").split("/")[0].trim();

  /** 按款式名去重后的款式列表（保持采集顺序；「变体组」用的是同一套切分） */
  function styleSegments(skus) {
    const out = [];
    const seen = new Set();
    for (const sku of (Array.isArray(skus) ? skus : [])) {
      const segment = styleOf(sku);
      if (!segment || seen.has(segment)) continue;
      seen.add(segment);
      out.push(segment);
    }
    return out;
  }

  /**
   * 组装一条上架计划。
   * opts（拆卡模式用）：
   *   skus              只用这些 SKU（一张卡一组款式）；默认取采集到的全部
   *   offerBase         本张卡的货号前缀（A1…A55），优先于输入框
   *   ignoreVariantGroup 忽略「变体组」过滤 —— 拆卡是按款式循环，不是只取第 N 组
   */
  async function buildPlan(opts = {}) {
    const context = getContext();
    if (!context || !context.offerBase) throw new Error('请先采集来源商品');
    if (!sourceOfferBase) sourceOfferBase = String(context.sourceProductId || context.offerBase || '');
    // 缓存键（类目/生成图）必须用**源商品号**，不能被下面改的货号前缀带跑
    const sourceKey = sourceIdOf(context);
    // 货号前缀可改：用它就能基于同一份采集建一条全新 listing
    // 拆卡时由调用方逐卡传入（A1…A55），这时不能回写输入框，只改本次上下文。
    const prefixed = String(opts.offerBase || offerBaseInput.value || '').trim();
    if (opts.offerBase) context.offerBase = prefixed;
    else if (!prefixed) offerBaseInput.value = context.offerBase;
    else context.offerBase = prefixed;
    const allSkus = (Array.isArray(opts.skus) && opts.skus.length) ? opts.skus : (context.skus || []);
    const limitValue = Number(String(skuLimitInput.value || '0')) || 0;
    // 规格去重：1688 有些商品的 SKU 规格名完全重复（同色同码出现两次）。
  // 变体组过滤：先按「标签第一段」分组，再取第 N 组（0 = 全部）。
  // 「斗篷猫睡袍」和「斗篷猫睡袍+裤子」这类套装差异必须拆卡，否则会被 DUPLICATE_VARIANT 合并。
  const variantGroupValue = opts.ignoreVariantGroup ? 0 : (Number(String((variantGroupInput && variantGroupInput.value) || "0")) || 0);
  const groupSegments = [];
  for (const sku of allSkus) {
    const segment = String((sku && sku.label) || "").split("/")[0].trim();
    if (segment && !groupSegments.includes(segment)) groupSegments.push(segment);
  }
  const groupedSkus = variantGroupValue > 0 && groupSegments.length > 1
    ? allSkus.filter((sku) => String((sku && sku.label) || "").split("/")[0].trim() === groupSegments[variantGroupValue - 1])
    : allSkus;
  globalThis.__SSERP_VARIANT_GROUPS__ = { segments: groupSegments, picked: variantGroupValue };
    // 直接发会得到 XXXL 和 XXXL-2 两个可变特性一样的变体，Ozon 报
    // 「无法与其他商品合并…至少更改一个可变特性」。这里按规格名去重，
    // 重复的那条直接丢掉（它和第一条是同一件商品）。
    const seenLabels = new Set();
    const dedupedSkus = groupedSkus.filter((sku) => {
      const labelKey = String((sku && sku.label) || '').trim().toLowerCase();
      if (!labelKey) return true;
      if (seenLabels.has(labelKey)) return false;
      seenLabels.add(labelKey);
      return true;
    });
    if (dedupedSkus.length < groupedSkus.length) {
      globalThis.__SSERP_DEDUPED_SKUS__ = { total: groupedSkus.length, kept: dedupedSkus.length };
    }
    // 拆卡时 opts.skus 已经是「这一张卡」的 SKU 子集，上限在那边按卡数生效
    const skus = (Array.isArray(opts.skus) && opts.skus.length)
      ? dedupedSkus
      : (limitValue > 0 ? dedupedSkus.slice(0, limitValue) : dedupedSkus);
    // 成本覆盖：采集值缺失或被人工改价时用面板输入
    const costOverride = Number(costInput.input.value) || 0;
    if (costOverride > 0) for (const sku of skus) sku.cost = costOverride;
    // 货号必须唯一：offerSuffix 只取尺码，多颜色时不同颜色的同一尺码会撞号，
    // Ozon 直接回 400 "not allowed to specify several items with the same offer_id"。
    const offers = (() => {
      const used = new Map();
      return skus.map((sku, index) => {
        const base = offerIdFor(context.offerBase, sku.key, index);
        const count = (used.get(base) || 0) + 1;
        used.set(base, count);
        return count === 1 ? base : base + "-" + count;
      });
    })();

    // 已上架：属性/尺寸/图片从 Ozon 读（不依赖 ERP —— ERP 的 catalogRevision
    // 一变，editor/attributes 就会回 source_listing_catalog_stale，直连车道不该被它拖住）
    // 拆卡时一张卡只有一个款式，最终货号就是卡号（A1…A55，不带 -1 后缀）：
    // 存在性预检必须用**最终货号**去查，否则已经建好的卡会被当成新商品重发。
    const probeOffers = (Array.isArray(opts.skus) && opts.skus.length === 1 && opts.offerBase)
      ? [String(opts.offerBase)]
      : offers;
    const existing = await fetchOzonProducts(probeOffers);
    if (existing && probeOffers.every((offer) => existing.has(offer))) {
      const priceMap = await fetchOzonPrices(probeOffers);
      const plan = planFromOzon(context, skus, probeOffers, existing, priceMap, opts.titleOverride);
      plan.__fromExisting = true;   // 这些 offer 已在 Ozon 存在：不能当新商品再发一次
      if (!String(titleInput.value || '').trim()) titleInput.value = plan.items[0] && plan.items[0].name || '';
      return { plan, context, workspace: null };
    }

    // 新商品属性：规则打底（确定性、覆盖齐），ERP 有值就覆盖同键。
    // 只靠 ERP 会缺项（草稿经常只剩 2 个属性 → REQUIRED_ATTRIBUTES），
    // 只靠规则又会丢掉卖家在 ERP 里手工改过的值。
    // 类目优先级：面板手填 > 工作区 > 缓存（新商品常常三者只剩手填）
    // 类目自动识别：手填优先；没填就用视觉报告的「类型」去类目树里找，再退回标题关键词。
    // 这样「一键上架」只需要货号前缀 + 成本两个输入。
    if (!(Number(catIdInput.value) > 0 && Number(typeIdInput.value) > 0)) {
      const visionType = String(((lastVisionReport || {})["属性观察"] || {})["类型"] || "").trim();
      const guessed = (await resolveCategoryFromText(visionType))
        || (await resolveCategoryFromText(context.sourceTitle))
        || null;
      if (guessed) {
        catIdInput.value = String(guessed.categoryId);
        typeIdInput.value = String(guessed.typeId);
        state.textContent = `类目自动识别：${guessed.typeName}（${guessed.categoryId}/${guessed.typeId}）`;
        globalThis.__SSERP_AUTO_CATEGORY__ = guessed;
      }
    }
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
  // 颜色兜底（最外层，必执行）：10096 是 SKU 级必填集合属性。
  // 变体名常常不是颜色（「斗篷猫睡袍」这种套装名），这里直接保证每个 SKU 都有颜色，
  // 取值顺序：标题/视觉里的颜色 → 中性默认。否则预检永远卡在 REQUIRED_ATTRIBUTES。
  {
    const colourField0 = ((workspace && workspace.fields) || []).find((field) => Number(field.attributeId || field.id) === 10096)
      || ((workspace && workspace.fields) || []).find((field) => /颜色/i.test(String(field.name || "")));
    const colourId0 = colourField0 ? Number(colourField0.attributeId || colourField0.id) : 0;
    if (colourId0) {
      const textForColour = [String(context.sourceTitle || ""), String(lastVisionText || "")].join(" ");
      const guess0 = colorsFromText(textForColour)[0] || "бежевый";
      const listed0 = await send("ss-erp:direct-ozon-attribute-values", {
        categoryId: category.categoryId, typeId: category.typeId, attributeIds: [colourId0], query: "", limit: 400, language: "DEFAULT",
      }).catch(() => null);
      const list0 = (listed0 && listed0.values && listed0.values[colourId0]) || [];
      const chosen0 = matchDictionaryValue(list0, guess0) || pickDictionaryValue(list0, "fuzzy", guess0, {});
      if (chosen0) {
        // 只补「没有颜色」的 SKU；已有真实颜色的绝不动——无条件覆盖会把多色商品
        // 全部改成同一个颜色，56 个 SKU 会被判成重复变体只剩 1 条（已踩过）。
        // 标签里能识别出颜色时不要兜底：那是「每个 SKU 一个颜色」的正路。
        // 兜底只在标签完全没有颜色词时启用（否则会把多色商品涂成同一个颜色）。
        const labelsHaveColour = skus.some((sku) => colorsFromText(String(sku.label || "")).length > 0);
        if (!labelsHaveColour) {
        const resolvedSkuKeys = new Set((workspace.values || [])
          .filter((row) => Number(row.attributeId) === colourId0 && !row.__unresolved && String(row.skuKey || '').trim())
          .map((row) => String(row.skuKey)));
        workspace.values = (workspace.values || []).filter((row) => !(Number(row.attributeId) === colourId0 && row.__unresolved));
        for (const sku of skus) {
          if (resolvedSkuKeys.has(String(sku.key))) continue;
          workspace.values.push({ attributeId: colourId0, skuKey: sku.key, value: String(chosen0.value || ""), dictionaryValueIds: [chosen0.id] });
        }
        globalThis.__SSERP_COLOR_FALLBACK__ = { value: chosen0.value, guess: guess0 };
        }
      }
    }
  }
  // 尺码兜底：规则只认 S/M/L/XL，儿童身高码（120cm / 130cm）会被整段丢掉，
  // 结果 56 个 SKU 只剩 5 个颜色、尺码维度消失（实测 sizeRows: 0）。
  // 这里按「标签最后一段」取尺码文本，走字典 + 最近数值匹配逐个补。
  {
    // 4295「俄罗斯尺码」优先：服装类目里往往还有 9533「制造商尺码」，按名字模糊匹配会先
    // 命中 9533 —— 均码在它的字典里根本不存在，于是 4295（必填）永远补不上（袜子实测）。
    const sizeField = ((workspace && workspace.fields) || []).find((field) => field && Number(field.attributeId || field.id) === 4295)
      || ((workspace && workspace.fields) || []).find((field) => field
        && field.required
        && /размер|尺码|尺寸/i.test(String(field.name || ""))
        && String(field.ownership || "").toUpperCase() === "SKU")
      || ((workspace && workspace.fields) || []).find((field) => field
        && /размер|尺码|尺寸/i.test(String(field.name || ""))
        && String(field.ownership || "").toUpperCase() === "SKU");
    const sizeId = sizeField ? Number(sizeField.attributeId || sizeField.id) : 0;
    if (sizeId) {
      const hasSize = (workspace.values || []).some((row) => Number(row.attributeId) === sizeId
        && String(row.skuKey || '').trim() && !row.__unresolved
        && (((row.dictionaryValueIds || []).length) || String(row.value || "").trim()));
      if (!hasSize) {
        const sizeList = await dictionaryFor(category, sizeId);
        // 定位用：字典回空时能直接看出是「没拉到字典」还是「匹配不上」
        globalThis.__SSERP_SIZE_DEBUG__ = { sizeId, hasSize, listLen: (sizeList || []).length, label: String(skus[0] && skus[0].label || '') };
        if (sizeList.length) {
          let filled = 0;
          for (const sku of skus) {
            const parts = String(sku.label || '').split('/');
            const rawSize = String(parts[parts.length - 1] || '').trim();
            if (!rawSize) continue;
            // 均码：Ozon 的「俄罗斯尺码」字典里对应「универсальный」(35646)。
            // 袜子 / 帽子 / 围巾这类整款均码的商品只有这一个可用值；不映射的话
            // 4295 是必填项 → 每张卡都卡在 REQUIRED_ATTRIBUTES（实测袜子 55 款全中）。
            const sizeText = /均码|统一码|均一码|free\s*size|one\s*size/i.test(rawSize) ? 'универсальный' : rawSize;
            const chosen = matchDictionaryValue(sizeList, sizeText) || (await lookupColourValue(sizeId, sizeText));
            if (!chosen) continue;
            workspace.values.push({ attributeId: sizeId, skuKey: sku.key, value: String(chosen.value || ""), dictionaryValueIds: [chosen.id] });
            filled += 1;
          }
          globalThis.__SSERP_SIZE_FALLBACK__ = { filled, total: skus.length };
        }
      }
    }
  }

    // 视觉观察回填（通用）：视觉报告里的「属性观察」按字段名匹配类目 schema；
    // 规则没算出来的必填项（性别、颜色、材质…）用它补。已有值不覆盖。

    // 颜色兜底（与商品无关）：视觉报告解析失败时，从采集到的标题/描述里取颜色。
    // 之前颜色只能来自视觉，模型一次输出格式不对，整条商品就缺颜色、预检不过。
    // 性别兜底：视觉报告缺「属性观察」时，从中文标题判断（女/男/童）。
    // 与颜色兜底同理，避免换个类目就因为缺 9163 卡住预检。
    {
      const genderField = (workspace.fields || []).find((field) => field && /性别|пол/i.test(String(field.name || "")));
      const genderId = genderField ? Number(genderField.attributeId || genderField.id) : 0;
      if (genderId) {
        const hasGender = (workspace.values || []).some((row) => Number(row.attributeId) === genderId
          && !row.__unresolved
          && (((row.dictionaryValueIds || []).length) || String(row.value || "").trim()));
        if (!hasGender) {
          const titleText = String(context.sourceTitle || "");
          // 服装类目（200000933）默认女装：标题里常常一个性别字都没有，
          // 不默认就等于永远缺 9163，20 条变体全被预检拦住。
          const guessRu = /男/.test(titleText) ? "мужской" : "женский";
          if (guessRu) {
            const listed = await send("ss-erp:direct-ozon-attribute-values", {
              categoryId: category.categoryId, typeId: category.typeId, attributeIds: [genderId], query: "", limit: 100, language: "DEFAULT",
            }).catch(() => null);
            const list = (listed && listed.values && listed.values[genderId]) || [];
            const chosen = matchDictionaryValue(list, guessRu) || pickDictionaryValue(list, "fuzzy", guessRu, {});
            if (chosen) {
              for (const sku of skus) {
              replaceUnresolved(workspace, genderId);
                workspace.values.push({ attributeId: genderId, skuKey: sku.key, value: String(chosen.value || ""), dictionaryValueIds: [chosen.id] });
              }
              globalThis.__SSERP_GENDER_FALLBACK__ = { from: "title", value: chosen.value };
            }
          }
        }
      }
    }
    {
  // ownership 不一定被填（实测有些 schema 只给 is_collection），
  // 之前严格要求 ownership === 'SKU'，导致颜色字段找不到 → 每个变体都没颜色 → 全被合并。
  const colorField = ((workspace && workspace.fields) || []).find((field) => field
    && /颜色|色彩/.test(String(field.name || ""))
    && String(field.ownership || "").toUpperCase() === "SKU")
    || ((workspace && workspace.fields) || []).find((field) => field && Number(field.attributeId || field.id) === 10096)
    || ((workspace && workspace.fields) || []).find((field) => field && /颜色|色彩/.test(String(field.name || "")));
      const colorId = colorField ? Number(colorField.attributeId || colorField.id) : 0;
      if (colorId) {
        const hasColor = ((workspace && workspace.values) || []).some((row) => Number(row.attributeId) === colorId
    && String(row.skuKey || '').trim()
          && !row.__unresolved
          && (((row.dictionaryValueIds || []).length) || String(row.value || "").trim()));
        if (!hasColor) {
      const sourceText = [context.sourceTitle, context.description, lastVisionText, ...(skus || []).map((sku) => sku.label)].join(" ");
          const candidates = colorsFromText(sourceText);
          if (candidates.length) {
            const listed = await send("ss-erp:direct-ozon-attribute-values", {
              categoryId: category.categoryId, typeId: category.typeId, attributeIds: [colorId], query: "", limit: 400, language: 'DEFAULT',
            }).catch(() => null);
            const list = (listed && listed.values && listed.values[colorId]) || [];
            let chosen = null;
            for (const candidate of candidates) {
              chosen = matchDictionaryValue(list, candidate) || pickDictionaryValue(list, "fuzzy", candidate, {});
              if (chosen) break;
            }
            if (chosen) {
              for (const sku of skus) {
                // 颜色必须按 SKU 各自的规格填：全填同一个颜色会让同尺码两个 SKU 的可变特性
                // 完全相同，Ozon 拒绝合并（实测 XXXL 单独成卡，报「至少更改一个可变特性」）。
                const ownColours = colorsFromText(String(sku.label || ''));
                let perSku = chosen;
                if (ownColours.length) {
        let hit = matchDictionaryValue(list, ownColours[0]) || pickDictionaryValue(list, 'fuzzy', ownColours[0], {});
        // 列表为空（限流）或没命中时，按颜色名单独查一次，拿到它自己的字典值。
        if (!hit) hit = await lookupColourValue(colorId, ownColours[0]);
                  if (hit) perSku = hit;
                }
              replaceUnresolved(workspace, colorId);
                workspace.values.push({ attributeId: colorId, skuKey: sku.key, value: String(perSku.value || ''), dictionaryValueIds: [perSku.id] });
              }
              globalThis.__SSERP_COLOR_FALLBACK__ = { from: "text", candidates, value: chosen.value };
        // 兜底 2：变体名不是颜色词（例如「斗篷猫睡袍」/「+裤子」这种套装差异），
        // 用视觉描述里出现的颜色，最后退到中性色，保证 10096 有值可发。
        if (!hasColorResolved(workspace, colorId)) {
          const textSources = [
            String((lastVisionReport && (lastVisionReport["视觉总结"] || lastVisionReport["核心卖点"])) || ""),
            String(lastVisionText || ""),
            String(context.sourceTitle || ""),
          ].join(" ");
          const guessed = colorsFromText(textSources)[0] || "бежевый";
          const listed2 = await send("ss-erp:direct-ozon-attribute-values", {
            categoryId: category.categoryId, typeId: category.typeId, attributeIds: [colorId], query: "", limit: 400, language: "DEFAULT",
          }).catch(() => null);
          const list2 = (listed2 && listed2.values && listed2.values[colorId]) || [];
          const chosen2 = matchDictionaryValue(list2, guessed) || pickDictionaryValue(list2, "fuzzy", guessed, {});
          if (chosen2) {
            replaceUnresolved(workspace, colorId);
            for (const sku of skus) {
              workspace.values.push({ attributeId: colorId, skuKey: sku.key, value: String(chosen2.value || ""), dictionaryValueIds: [chosen2.id] });
            }
            globalThis.__SSERP_COLOR_FALLBACK__ = { from: "vision/text", value: chosen2.value };
          }
        }
            }
          }
        }
      }
    }
    try {
      // 属性观察有两种形状：扁平 { 性别: "女性" }，或嵌套 { 类目: "Юбка", "以下字段…": [{label,desc}] }。
      // 统一拍平成 name -> value，否则嵌套形状一个属性都填不进去（qwen3.6 就爱这么答）。
      const flattenObserved = (raw) => {
        const out = {};
        const take = (name, value) => {
          const key = String(name == null ? '' : name).trim();
          if (Array.isArray(value)) { for (const one of value) take(key, one); return; }
          if (value && typeof value === 'object') {
            if ('label' in value || 'desc' in value) { take(value.label, value.desc); return; }
            for (const [k, v] of Object.entries(value)) take(k, v);
            return;
          }
          if (!key || key.length > 24) return;
          const text = String(value == null ? '' : value).trim();
          if (text) out[key] = text;
        };
        take('', raw);
        return out;
      };
      const observed = flattenObserved(lastVisionReport && lastVisionReport['属性观察']);
      const observedNames = Object.keys(observed);
      if (observedNames.length && workspace && Array.isArray(workspace.fields)) {
        for (const obsName of observedNames) {
          // 每个键单独兜错：之前「类目」先抛异常，后面的性别/颜色就被整段跳过了。
          try {
            const obsText = String(observed[obsName] || '');
            if (!obsText.trim()) continue;
            const field = workspace.fields.find((f) => String((f && f.name) || '') === obsName)
              || workspace.fields.find((f) => obsName && String((f && f.name) || '').includes(obsName));
            const attributeId = field ? Number(field.attributeId || field.id) : 0;
            if (!attributeId) continue;
            const hasValue = (workspace.values || []).some((row) => Number(row.attributeId) === attributeId
              && (((row.dictionaryValueIds || []).length) || String(row.value || '').trim()));
            if (hasValue) continue;
            const found = await send('ss-erp:direct-ozon-attribute-values', {
              categoryId: category.categoryId, typeId: category.typeId, attributeId, query: '', limit: 400, language: 'DEFAULT',
            }).catch(() => null);
            const list = (found && found.values) || [];
            const obsCandidates = obsText.split(/[;,、\/|]/).map((one) => one.trim()).filter(Boolean);
            let chosen = null;
            for (const candidate of obsCandidates) {
              chosen = matchDictionaryValue(list, candidate) || pickDictionaryValue(list, 'fuzzy', candidate, {});
              if (chosen) break;
            }
            if (!chosen) continue;
            const skuOwned = String((field && field.ownership) || '').toUpperCase() === 'SKU';
            const targets = skuOwned ? skus.map((sku) => sku.key) : [null];
            for (const key of targets) {
              workspace.values.push({ attributeId, skuKey: key, value: String(chosen.value || ''), dictionaryValueIds: [chosen.id] });
            }
          } catch (_oneError) { /* 这个键填不进去就跳过 */ }
        }
      }
    } catch (_error) { /* 回填失败不影响主流程 */ }
    if (!workspace) throw new Error('没有类目：先在「类目」步骤确认一次（会缓存到本地）');
    lastWorkspaceForPlan = workspace;
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
    // 集合属性只有一个取值时同样剔除：它分不出任何变体，留着只会让 Ozon 一直「等变体」。
    // 实测：2 个尺码 + 1 个颜色 → is_created=false / validation pending / variant_wait；
    // 多色多码时颜色有多个取值，不会被这条规则命中。
    {
      const skuOwnedIds = new Set((workspace.fields || [])
        .filter((field) => String((field && (field.ownership || (field.isCollection ? 'SKU' : ''))) || '').toUpperCase() === 'SKU')
        .map((field) => Number(field.attributeId || field.id)));
      const seen = new Map();
      for (const row of workspace.values || []) {
        const id = Number(row.attributeId);
        if (!skuOwnedIds.has(id)) continue;
        const valueKey = String((row.dictionaryValueIds || [])[0] || row.value || '').trim();
        if (!seen.has(id)) seen.set(id, new Set());
        if (valueKey) seen.get(id).add(valueKey);
      }
      // 必填属性不能剔除（剔了预检直接不过）；这里只清理非必填的单值集合属性。
      const requiredIds = new Set((workspace.fields || [])
        .filter((field) => field && field.required)
        .map((field) => Number(field.attributeId || field.id)));
      const singleValued = [...seen.entries()]
        .filter(([id, set]) => set.size === 1 && !requiredIds.has(id))
        .map(([id]) => id);
      if (singleValued.length) {
        workspace.values = (workspace.values || []).filter((row) => !singleValued.includes(Number(row.attributeId)));
        globalThis.__SSERP_SINGLE_VALUED__ = singleValued;
      }
    }
    if (workspace.__singleCard) {
      state.textContent = '单品卡：已剔除集合属性（Ozon 会把单值集合属性当成等待变体）';
    } else if (skus.length === 1) {
      state.textContent = '提示：' + variant.info.reason;
    }
    if (workspace.values.some((one) => one.__unresolved)) {
      const ids = [...new Set(workspace.values.filter((one) => one.__unresolved).map((one) => one.attributeId))];
  globalThis.__SSERP_UNRESOLVED_ATTRS__ = ids;
  // 不抛错：字典偶发为空（限流）时让预检如实报缺项，而不是整条链中断。
    }

    const reportForText = lastVisionReport || {};
    const observedForText = reportForText["属性观察"] || {};
    const russianType = await russianTypeName(context.category && context.category.typeId).catch(() => '');
    const typeRu = String(russianType || observedForText["类型"] || "").trim();

    // 标题：以规则版为准（精铺/知了的做法）。
    // 规则版固定「品类名词 + 性别 + 材质 + 特征 + 场景」顺序，天然以名词开头；
    // 而 AI 版实测会输出「Женский с длинным рукавом…」这种形容词碎片，
    // Ozon 审核判「名称中有无意义的文本」，卡片直接建不出来。
    {
      const genderAttr = (workspace.values || []).find((row) => {
        const field = (workspace.fields || []).find((f) => Number(f.attributeId || f.id) === Number(row.attributeId));
        return field && /性别|пол/i.test(String(field.name || ""));
      });
      const genderText = String((genderAttr && genderAttr.value) || "").trim();
      const ruleTitle = buildRuTitle({
        sourceTitle: context.sourceTitle || "",
        typeName: typeRu || (context.category && context.category.typeName) || "",
        gender: genderText,
        attributes: (workspace.values || []).slice(0, 12).map((row) => {
          const field = (workspace.fields || []).find((f) => Number(f.attributeId || f.id) === Number(row.attributeId));
          return { name: field ? String(field.name || "") : "", value: String(row.value || "") };
        }),
      });
      const current = String(titleInput.value || "").trim();
      const noun = String((ruleTitle && ruleTitle.category) || "").toLowerCase();
    const useRule = !titleTouched || !current;
    if (ruleTitle && ruleTitle.title && useRule) {
        titleInput.value = String(ruleTitle.title).slice(0, 200);
        globalThis.__SSERP_TITLE_SOURCE__ = "rules";
      } else {
        globalThis.__SSERP_TITLE_SOURCE__ = "ai";
      }
    }

    // 描述不能留空：Ozon 会回「Не удалось создать описание」并把商品判进 variant_wait，
    // 库存永远设不上（实测 1091114984558 的 16 条全卡在这里）。没填就用视觉摘要+卖点拼一段。
    // 商品类型（俄文名词）：视觉报告里的「类型」最准，退回类目名。
    // 标题必须以商品名词开头：实测 AI 给出的是「Женский с длинным рукавом…」这种形容词堆，
    // Ozon 审核判「名称中有无意义的文本」。这里补上名词。
    if (typeRu) {
      const titleNow = String(titleInput.value || "").trim();
      const lower = titleNow.toLowerCase();
      const noun = typeRu.toLowerCase().split(/[;,\/|\s,(]/).filter(Boolean)[0] || '';
      const head = (typeRu.split(/[;,\/|]/)[0] || '').trim();
      const headCap = head ? head.charAt(0).toUpperCase() + head.slice(1) : '';
      // 类型名可能是中文（类目名），中文不能进俄文标题：只在类型是西里尔文时补名词。
      const cyrillic = /[\u0400-\u04FF]/.test(headCap) && !/[\u4e00-\u9fff]/.test(headCap);
      if (titleNow && noun && !lower.includes(noun) && headCap && cyrillic) {
        // 防止「Лонгслив женский Женский с…」这种重复性别词：Ozon 判名称异常，卡片建不出来。
        const rest = titleNow.replace(/^женск[а-яё]*\s+/i, "").trim();
        titleInput.value = (headCap + " женский " + rest).slice(0, 200);
      }
    }
    // 描述：不能直接发中文摘要（Ozon 侧会存成空），用 AI 生成俄文；失败退回俄文标题。
    const autoDescription = await (async () => {
      const manual = String(descInput.value || "").trim();
      if (manual) return manual;
      const summary = String(reportForText["视觉总结"] || lastVisionText || "").trim();
      const points = Array.isArray(reportForText["核心卖点"]) ? reportForText["核心卖点"] : [];
      const titleRu = String(titleInput.value || "").trim();
      try {
        const cfg = await readTitleAiConfig();
        if (cfg && cfg.apiKey) {
          const generated = await generateDescriptionWithAi({
            baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model || "qwen3.6-flash",
            typeName: typeRu, titleRu, summary, sellingPoints: points,
          });
          if (generated) return generated;
        }
      } catch (_e) { /* 退回下面的兜底 */ }
      return [titleRu, typeRu].filter(Boolean).join(". ").slice(0, 600);
    })();
    // 描述必须落在属性 4191「简介」上：实测 item 级 description 会被忽略，
    // /v1/product/info/description 一直是空，卡片审核被判「Не удалось создать описание」。
    try {
    // 简介固定用 4191：按名字模糊匹配会命中 4180「名称」之类的属性，
    // 描述就写到别处去了（实测 descLen 一直是 0）。
    const introField = (workspace.fields || []).find((field) => Number(field.attributeId || field.id) === 4191);
      const introId = introField ? Number(introField.attributeId || introField.id) : 4191;
      const hasIntro = (workspace.values || []).some((row) => Number(row.attributeId) === introId
        && String(row.value || "").trim().length > 20);
      if (!hasIntro && autoDescription) {
        workspace.values.push({ attributeId: introId, skuKey: null, value: stripLinks(autoDescription).slice(0, 6000), dictionaryValueIds: [] });
      }
    } catch (_e) { /* 没有该属性就不写 */ }
    const editorStub = {
      category: context.category,
      selectedSkuKeys: skus.map((sku) => sku.key),
    // 拆卡时每个款式有自己的标题（规则 + 视觉配色）：优先用它，否则用输入框里那条
    copy: { titleRu: String(opts.titleOverride || titleInput.value || '').trim(), descriptionRu: stripLinks(autoDescription) },
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
    // 定位用：把喂给计划层的字段/值快照暴露出来（颜色没进分组时用得上）。
    try {
      const colourRows = (workspace.values || []).filter((row) => Number(row.attributeId) === 10096);
      globalThis.__SSERP_WS_DUMP__ = {
        fields: (workspace.fields || []).map((f) => ({ id: f.attributeId || f.id, name: f.name, own: f.ownership })),
        valueCount: (workspace.values || []).length,
        colourRows: colourRows.length,
        colourSkus: new Set(colourRows.map((row) => String(row.skuKey || ""))).size,
        byAttr: (() => { const m = {}; for (const row of (workspace.values || [])) { const k = String(row.attributeId); m[k] = (m[k] || 0) + 1; } return m; })(),
        sizeValues: [...new Set((workspace.values || []).filter((r) => Number(r.attributeId) === 4295).map((r) => String(r.value || '')))].slice(0, 10),
        sizeRows: (workspace.values || []).filter((r) => Number(r.attributeId) === 4295).length,
        distinctDicts: [...new Set(colourRows.map((row) => String((row.dictionaryValueIds || [])[0] || "")))].slice(0, 12),
        distinctValues: [...new Set(colourRows.map((row) => String(row.value || "")))].slice(0, 12),
        sampleColours: colourRows.slice(0, 3).map((row) => ({ sku: String(row.skuKey || "").slice(-12), v: row.value, dict: (row.dictionaryValueIds || [])[0] })),
        skus: skus.length,
      };
    } catch (_e) { /* 定位代码不允许影响主流程 */ }

    // 颜色归一化：规则会把源标签的中文颜色直接写进去，且没有字典 id，
    // Ozon 收到中文文本（或只有 id 没有文本）都会判 error_attribute_values_out_of_range。
    // 这里统一走「中文 → 俄语词 → 字典项」把 value 和 dictionaryValueIds 一起补齐。
    try {
      const colourFieldX = ((workspace.fields) || []).find((field) => Number(field.attributeId || field.id) === 10096);
      const colourIdX = colourFieldX ? Number(colourFieldX.attributeId || colourFieldX.id) : 0;
      if (colourIdX) {
        let fixed = 0;
        for (const row of (workspace.values || [])) {
          if (Number(row.attributeId) !== colourIdX) continue;
          if (!String(row.skuKey || "").trim()) continue;
          const current = String(row.value || "").trim();
          const hasId = (row.dictionaryValueIds || []).length > 0;
          const isRussian = /[а-яё]/i.test(current);
          if (hasId && isRussian) continue;
          const ru = colorsFromText(current)[0] || colorsFromText(String(row.skuKey))[0];
          if (!ru) continue;
          const hit = await lookupColourValue(colourIdX, ru);
          if (!hit) continue;
          row.value = String(hit.value || ru);
          row.dictionaryValueIds = [Number(hit.id)];
          fixed += 1;
        }
        globalThis.__SSERP_COLOUR_NORMALIZE__ = { fixed };
      }
    } catch (_e) { /* 归一化失败就让预检报缺项 */ }

    // 补全字典文本：规则/兜底只填了 dictionaryValueIds 时 value 会是空的，
    // Ozon 把这个当成「值不在字典里」（error_attribute_values_out_of_range）。
    try {
      const needText = (workspace.values || []).filter((row) => (row.dictionaryValueIds || []).length
        && !String(row.value || "").trim());
      if (needText.length) {
        const ids = [...new Set(needText.map((row) => Number(row.attributeId)))];
        const fetched = await send("ss-erp:direct-ozon-attribute-values", {
          categoryId: category.categoryId, typeId: category.typeId, attributeIds: ids, query: "", limit: 400, language: "DEFAULT",
        }).catch(() => null);
        const byAttr = (fetched && fetched.values) || {};
        let filledText = 0;
        for (const row of needText) {
          const list = byAttr[Number(row.attributeId)] || [];
          const wantId = Number((row.dictionaryValueIds || [])[0]);
          const hit = list.find((one) => Number(one.id) === wantId);
          if (hit && String(hit.value || "").trim()) { row.value = String(hit.value); filledText += 1; }
        }
        globalThis.__SSERP_VALUE_TEXT_FILL__ = { need: needText.length, filled: filledText };
      }
    } catch (_e) { /* 补不上就让 Ozon 报错，至少不静默 */ }

    const plan = planDirectItems({
      editor: editorStub,
      workspace,
      offerBase: context.offerBase,
      // 生成图优先（主图在最前），源图补位 —— 生图链路的结果在这里回灌 listing
      // 图片分两级：
      //   SKU 级 —— 该颜色自己在 1688 的原图，放在最前，变体切换时看到的就是这个颜色的商品；
      //   产品级 —— 生成图补位。之前只传产品级，结果所有颜色共用同一套生成图（灰的）。
      images: [
        ...skus
    .map((sku) => {
      // 颜色主图优先：采集没给每 SKU 图时，这是唯一能区分颜色的来源。
      const colourValue = String(((lastWorkspaceForPlan && lastWorkspaceForPlan.values) || [])
        .filter((row) => String(row.skuKey) === String(sku.key) && !row.__unresolved)
        .map((row) => String(row.value || "").trim())
        .find((value) => colourHeroMap.has(value)) || "");
      // 首图优先用「该颜色在 1688 的原图」：它就是真实商品照，颜色一定对。
      // 生成的颜色主图只作兜底——实测四张生成图肉眼几乎一样，Ozon 上三个颜色
      // 会共用同一张首图（майлстоун B1/C1 都踩过）。
      const sourceCover = String(sku.imageUrl || "");
      // 拆卡时优先用「该款式自己的生成主图」：55 张卡各看各的，别长得一模一样。
      // 没有该款式的生成图时，拆卡路径**不**退回 1688 原图 —— 原图会被审核判 decline（§12.5）。
      const styleHero = styleHeroMap.get(styleOf(sku)) || "";
      const splitting = Array.isArray(opts.skus) && opts.skus.length > 0;
      const url = styleHero
        || (splitting ? "" : (/^https?:\/\//.test(sourceCover) ? sourceCover : (colourHeroMap.get(colourValue) || "")));
      return { scope: 'SKU', skuKey: sku.key, url };
    })
          .filter((one) => /^https:\/\//.test(one.url)),
        // 产品级张数可限：拆卡时 55 张卡共用同一套图，9 张 2.1MB 的 PNG 会让 Ozon 的
        // 异步抓图整批超时（实测 images:0 / primary 为空），3 张以内最稳。
        ...imagesForPlan(context).slice(0, Number(opts.maxProductImages) > 0 ? Number(opts.maxProductImages) : 15).map((url) => ({ scope: 'PRODUCT', skuKey: null, url })),
      ],
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
    plan.blockers = plan.items.flatMap((item) => item.blockers.map((code) => ({
      scope: item.offerId,
      code,
      // 缺哪个属性必须写出来：只有 REQUIRED_ATTRIBUTES 时根本没法定位（实测 31 张卡都缺 4295）
      detail: code === 'REQUIRED_ATTRIBUTES'
        ? (item.missingRequired || []).map((field) => field.name || field.id).join(' / ')
        : '',
    })))
      .concat(plan.blockers.filter((one) => !/^(TITLE_RU|PRICE|WEIGHT|DIMENSIONS|IMAGES|REQUIRED_ATTRIBUTES)$/.test(String(one.code))));
    plan.ready = plan.items.length > 0
      && plan.items.every((item) => item.blockers.length === 0);
    return plan;
  }

  /**
   * 把「生成图 / 款式主图 / 款式标题」三份缓存从 storage 重新读一遍。
   * 为什么要它：面板刚挂载时采集上下文可能还没到（挂载早于采集完成），
   * 那时 sourceId 为空、三份缓存全读不到 —— 实测重载扩展后 heroes 变 0，
   * 于是 55 张卡又退回同一套图。每次规划/出图前刷新一次，成本就是几次 storage.get。
   */
  async function refreshStyleCaches() {
    const sourceId = sourceIdOf(getContext());
    if (!sourceId) return;
    const heroes = await loadStyleHeroes(sourceId);
    const titles = await loadStyleTitles(sourceId);
    const stored = await loadGeneratedImages(sourceId);
    if (stored.length) lastImageResults = stored.map((one) => ({ goalType: one.goalType, url: one.url }));
    globalThis.__SSERP_STYLE_CACHE__ = { sourceId, heroes: heroes.size, titles: titles.size, generated: stored.length };
  }

  /**
   * 按款式拆卡（alignment §12）——规划阶段。
   *
   * 触发商品：1087518215857（袜子，55 个款式、全是均码、每款带图）。
   * 为什么必须拆：变体只能靠**可变的字典属性**区分，而这 55 款的颜色/尺码都拉不开
   * （款式名不是颜色词、尺码只有「均码」）→ 一起发只会大面积 DUPLICATE_VARIANT。
   * 它们本来就不是一张卡里的 55 个变体，而是 55 个独立商品。
   *
   * 产物：每款一张单变体卡，货号 = 前缀 + 序号（前缀 A → A1…A55），
   * 且每张卡的 8292「合并至一张卡片」取不同值，Ozon 不会把它们并成一张。
   * 图只生成一次，N 张卡复用同一套（§12 关键约束）。
   */
  async function buildSplitPlans() {
    const context = getContext();
    if (!context || !context.offerBase) throw new Error('请先采集来源商品');
    await refreshStyleCaches();
    const base = String(offerBaseInput.value || '').trim() || String(context.offerBase || '').trim();
    const allSkus = context.skus || [];
    const segments = styleSegments(allSkus);
    if (segments.length < 2) {
      throw new Error(`按款式拆卡需要 ≥2 个款式（当前只有 ${segments.length} 个）。只有一个款式请用普通上架。`);
    }
    // 拆卡模式下「SKU 上限」按**卡数**算：分批试跑/续跑都靠它
    const limit = Number(String(skuLimitInput.value || '0')) || 0;
    const picked = limit > 0 ? segments.slice(0, limit) : segments;
    const originalBase = String(context.offerBase || '');
    // 「更新已存在卡」：卡已经在 Ozon 上时，同货号重新 import 就是**更新**（标题/文案/属性），
    // 不新建、不动价格库存。改 55 条标题就靠它，否则只能跳过。
    const updateExisting = Boolean(updateExistingInput && updateExistingInput.checked);
    const cards = [];
    const items = [];
    const blockers = [];
    const notes = [];
    let skippedCount = 0;
    let updatedCount = 0;
    try {
      for (const [index, segment] of picked.entries()) {
        const cardBase = base + String(index + 1);
        const subSkus = allSkus.filter((sku) => styleOf(sku) === segment);
        state.textContent = `拆卡规划 ${index + 1}/${picked.length}：${segment}`;
        let built = null;
        try {
          built = await buildPlan({
            skus: subSkus, offerBase: cardBase, ignoreVariantGroup: true, maxProductImages: 2,
            titleOverride: styleTitleMap.get(segment) || '',
          });
        } catch (error) {
          blockers.push({ scope: cardBase, code: 'PLAN_FAILED', detail: `${segment}：${String((error && error.message) || error)}` });
          continue;
        }
        const plan = built.plan || {};
        // 已经建过的卡：不勾「更新已存在卡」就跳过（重发会被判「类似商品重复」）
        const existingCard = Boolean(plan.__fromExisting);
        if (existingCard && !updateExisting) {
          skippedCount += 1;
          notes.push({ scope: cardBase, code: 'CARD_EXISTS', detail: `${segment}：${cardBase} 在 Ozon 已存在，本次跳过` });
          continue;
        }
        // 单款式卡：货号就是卡号本身。planDirectItems 会给每 SKU 追加 -1/-S 这类后缀，
        // 拆卡后一张卡只有一个款式，带着后缀反而和「货号 A1…A55」对不上。
        if (Array.isArray(plan.items) && plan.items.length === 1) plan.items[0].offerId = cardBase;
        applyPriceInputs(plan);
        const cardItems = Array.isArray(plan.items) ? plan.items : [];
        if (!cardItems.length) {
          blockers.push({ scope: cardBase, code: 'NO_ITEM', detail: segment });
          continue;
        }
        for (const item of cardItems) {
          item.__style = segment;
          item.__cardBase = cardBase;
          item.__sourceSkus = subSkus.map((sku) => String(sku.key)).join(',');
          item.__update = existingCard;
          items.push(item);
        }
        for (const blocker of (plan.blockers || [])) blockers.push({ scope: blocker.scope || cardBase, code: blocker.code, detail: blocker.detail });
        if (existingCard) updatedCount += 1;
        cards.push({ segment, cardBase, plan, items: cardItems, update: existingCard });
        // 首卡算出来的俄文描述直接复用：每张卡都调一次文本模型会把 55 张拖到一小时以上
        if (!String(descInput.value || '').trim()) {
          const firstDescription = String((cardItems[0] || {}).description || '').trim();
          if (firstDescription) descInput.value = firstDescription;
        }
      }
    } finally {
      // 上下文里的 offerBase 是「源商品号」，被逐卡前缀改过，必须还原
      context.offerBase = originalBase || context.offerBase;
    }
    const merged = {
      offerBase: base,
      category: (cards[0] && cards[0].plan && cards[0].plan.category) || (context.category || { categoryId: null, typeId: null }),
      skuCount: items.length,
      requiredFieldCount: (cards[0] && cards[0].plan && cards[0].plan.requiredFieldCount) || 0,
      items,
      blockers,
      notes,
      split: true,
      segmentCount: picked.length,
      cardCount: cards.length,
      skipped: skippedCount,
      updated: updatedCount,
      ready: blockers.length === 0 && (cards.length + skippedCount) === picked.length && (items.length > 0 || skippedCount > 0),
    };
    return { merged, cards, segments: picked };
  }

  async function runPrecheck() {
    globalThis.__SSERP_ENTER__ = 'precheck@' + Date.now();
    if (!claimBusy()) { globalThis.__SSERP_BUSY_BLOCKED__ = (globalThis.__SSERP_BUSY_BLOCKED__ || 0) + 1; return; }
    precheck.disabled = publishBtn.disabled = true;
    try {
      // 勾了「按款式拆卡」且确实有多个款式 → 走拆卡规划（N 张单变体卡）
      const splitContext = getContext() || {};
      const splitting = Boolean(splitByStyle.checked) && styleSegments(splitContext.skus).length > 1;
      const splitBuilt = splitting ? await buildSplitPlans() : null;
      const plan = splitting ? splitBuilt.merged : (await buildPlan()).plan;
    // 同一个货源商品换前缀重发会被 Ozon 判「类似商品重复」（SPU_ALREADY_EXISTS），
    // 之前我在同一个商品上发了 A1..E1 五遍，80 条里 64 条报错。这里先查台账。
    {
      const ctx0 = splitContext;
      const sourceId = String((ctx0.sourceProductId || ctx0.offerBase || '').trim());
      const ledger = await readPublishedSources();
      const hit = ledger[sourceId];
      const splitBase = splitting ? String(plan.offerBase || '') : '';
      // 拆卡时记的是「卡号前缀」（A）；普通上架记的是货号前缀。各比各的，别互相顶。
      const currentBase = splitting ? splitBase : String(ctx0.offerBase || '');
      const recorded = hit && (splitting ? String(hit.splitBase || '') : String(hit.offerBase || ''));
      if (recorded && recorded !== currentBase) {
        throw new Error(`这个货源商品已经用前缀 ${recorded} 上架过了（${String(hit.at || '').slice(0, 10)}）。` +
          '换前缀重发会被 Ozon 判「类似商品重复」。要改内容请用原前缀更新，要补库存请点「补库存」。');
      }
      void rememberPublished(sourceId, currentBase, splitBase);
    }
      const merged = splitting ? plan : applyPriceInputs(plan);
      lastPlan = merged;
      renderTable(merged);
      globalThis.__SSERP_PROGRESS__ = 'rendered';
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
        split: splitting ? { segments: merged.segmentCount, cards: merged.cardCount, cardBase: merged.offerBase } : undefined,
        items: merged.items.map((item) => ({ offerId: item.offerId, style: item.__style || undefined, attributes: item.attributeCount, price: item.price, oldPrice: item.oldPrice, images: item.images.length, missingRequired: item.missingRequired })),
      }, null, 2);
      if (splitting) {
        const skipped = (merged.notes || []).filter((one) => one.code === 'CARD_EXISTS').length;
        state.textContent = merged.ready
          ? `预检通过：拆卡 ${merged.cardCount} 张（${merged.segmentCount} 个款式）` + (skipped ? `，已存在跳过 ${skipped}` : '')
          : `预检未通过：${merged.blockers.length} 个待补项`;
      } else {
        state.textContent = merged.ready ? `预检通过：${merged.items.length} 条可上架` : `预检未通过：${merged.blockers.length} 个待补项`;
      }
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
    globalThis.__SSERP_ENTER__ = 'publish@' + Date.now();
    if (!claimBusy()) { globalThis.__SSERP_BUSY_BLOCKED__ = (globalThis.__SSERP_BUSY_BLOCKED__ || 0) + 1; return; }
    precheck.disabled = publishBtn.disabled = true;
    try {
      // 按款式拆卡：一张卡一个款式，逐卡 import/价格/库存；图片只提交一次（见 runSplitPublish）
      const splitContext = getContext() || {};
      if (Boolean(splitByStyle.checked) && styleSegments(splitContext.skus).length > 1) {
        await runSplitPublish();
        return;
      }
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
      globalThis.__SSERP_PROGRESS__ = 'ready=' + merged.ready + ' blockers=' + JSON.stringify((merged.blockers || []).map((b) => b.code || b));
      if (!merged.ready) throw new Error('预检未通过，先补齐：' + merged.blockers.map((one) => one.code).join(' / '));
      // 上架必须用 AI 生成图。采集原图带中文水印/文字，直接发上去等于绕过生图
      // （也解释过为什么店铺里出现了带中文的图）。这里做成硬性检查，不再默默兜底。
      const generatedReady = (lastImageResults || [])
        .map((one) => String((one && one.url) || ""))
        .filter((url) => /^https:\/\//.test(url));
      if (!generatedReady.length) {
        throw new Error("还没有 AI 生成图：直连上架会退回 1688 原图（带中文水印）。先在「生图」里出图，再发布。");
      }
      // 防回归：多颜色变体却共用同一套图 —— 之前就是这样，所有颜色都显示灰的那张。
      // 只要存在 ≥2 个不同颜色，就要求每个 SKU 的首图不同，否则直接拦下。
      {
        const colourField = ((lastWorkspaceForPlan && lastWorkspaceForPlan.fields) || []).find((f) => /颜色|色彩/i.test(String(f.name || ""))
          && String(f.ownership || "").toUpperCase() === "SKU");
        const colourId = colourField ? Number(colourField.attributeId || colourField.id) : 0;
        if (colourId) {
          const colours = new Set(((lastWorkspaceForPlan && lastWorkspaceForPlan.values) || [])
            .filter((row) => Number(row.attributeId) === colourId)
            .map((row) => String((row.dictionaryValueIds || [])[0] || row.value || "").trim())
            .filter(Boolean));
          if (colours.size >= 2) {
            const firsts = (merged.items || []).map((item) => String((item.images || [])[0] || ""));
            const distinct = new Set(firsts.filter(Boolean));
            if (distinct.size < colours.size) {
              throw new Error(`变体图未按颜色区分：${colours.size} 个颜色但只有 ${distinct.size} 张不同的首图。`
                + "每个 SKU 的首图必须是它自己的颜色图（1688 原图），否则买家看到的全是一个颜色。");
            }
          }
        }
      }
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
      const step = (action, payload) => send('ss-erp:direct-publish-step', Object.assign({ action }, payload || {}));
      const offers = items.map((one) => one.offerId);
      output.textContent = '';
      // 1) 图片（单步）
      globalThis.__SSERP_PROGRESS__ = 'pictures-start';
      state.textContent = `提交图片（${items.length} 条）…`;
      // 诊断：图片这一步曾把页面卡死（渲染线程同步占满，evaluate 都超时）。
      // 记录载荷大小与三个时间点，区分是「序列化过大」还是「调用不返回」。
      globalThis.__SSERP_PICTURES__ = { start: Date.now() };
      const picturesPayload = { entries: items.map((one) => ({ offerId: one.offerId, imageUrls: one.images })) };
      try {
        const serialized = JSON.stringify(picturesPayload);
        globalThis.__SSERP_PICTURES__.bytes = serialized.length;
        globalThis.__SSERP_PICTURES__.offers = picturesPayload.entries.length;
        globalThis.__SSERP_PICTURES__.images = picturesPayload.entries.reduce((n, one) => n + (one.imageUrls || []).length, 0);
      } catch (error) {
        globalThis.__SSERP_PICTURES__.serializeError = String((error && error.message) || error);
      }
      globalThis.__SSERP_PICTURES__.serializedAt = Date.now();
      await step('pictures', picturesPayload);
      globalThis.__SSERP_PICTURES__.doneAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 40000));
      // 2) 导入（单步，拿到 taskId）
      state.textContent = `导入商品（${items.length} 条）…`;
      const imported = await step('import', { items });
      if (!imported || !imported.taskId) throw new Error('Ozon 没有返回 task_id');
      // 3) 轮询导入结果（面板驱动，SW 只做单次查询）
      let poll = { done: false, items: [] };
      for (let i = 0; i < 30 && !poll.done; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        poll = await step('poll', { taskId: imported.taskId });
        const okCount = (poll.items || []).filter((one) => one.status === 'imported').length;
        state.textContent = `导入中 ${i + 1}：${okCount}/${(poll.items || []).length}（task ${imported.taskId}）`;
      }
      // 4) 等商品真正创建（单步查询 + 面板循环）
      let pending = offers.slice();
      let products = { ready: [], pending, rows: [] };
      for (let i = 0; i < 30 && pending.length; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 6000));
        products = await step('products', { offers });
        pending = products.pending || [];
        state.textContent = `等待创建 ${products.ready.length}/${offers.length}…`;
      }
      // 5) 价格 + 库存（单步，各自一次）
      const first = items[0] || {};
      if (products.ready.length) {
        state.textContent = '提交价格…';
        await step('price', { offers: products.ready, price: first.price, oldPrice: first.oldPrice, currency: first.currency, vat: first.vat });
        const stockCount = Number(stockInput.input.value);
        let warehouseId = Number(warehouse.value);
        if (stockCount > 0 && !(warehouseId > 0)) {
          await loadWarehouses();
          if (!Number(warehouse.value) && warehouse.options.length) warehouse.value = warehouse.options[0].value;
          warehouseId = Number(warehouse.value);
        }
        if (stockCount > 0 && warehouseId > 0) {
          state.textContent = '提交库存…';
          // 库存会在商品「刚建好但还没标记完成」时回 PRODUCT_IS_NOT_CREATED；
          // 这是时序，不是失败，必须退避重试（实测创建后还要几秒到几十秒）。
          let stocked = { ok: [], failed: [] };
          for (let attempt = 1; attempt <= 6; attempt += 1) {
            stocked = await step('stock', { offers: products.ready, stock: stockCount, warehouseId });
            const retryable = (stocked.failed || []).some((one) => (one.codes || []).some((code) =>
              ['PRODUCT_IS_NOT_CREATED', 'TOO_MANY_REQUESTS', 'NOT_PASS_MODERATION'].includes(code)));
            if (!(stocked.failed || []).length || !retryable) break;
            state.textContent = `库存重试 ${attempt}：${(stocked.failed || []).map((one) => (one.codes || [])[0]).join(',')}`;
            await new Promise((resolve) => setTimeout(resolve, 8000 * attempt));
          }
          output.textContent = JSON.stringify({ imported, products, stocked }, null, 2).slice(0, 2500);
          state.textContent = `上架完成：创建 ${products.ready.length}/${offers.length}，库存 ${stocked.ok.length}/${products.ready.length}`;
        } else {
          output.textContent = JSON.stringify({ imported, products }, null, 2).slice(0, 2000);
          state.textContent = `上架完成：创建 ${products.ready.length}/${offers.length}（未设库存：仓库不可用）`;
        }
      } else {
        output.textContent = JSON.stringify({ imported, poll }, null, 2).slice(0, 2000);
        throw new Error('商品没有创建出来：看「导入中」的错误码');
      }
      const result = { taskId: imported.taskId, items: products.rows || [], poll };
      onPublished?.(result);
    } catch (error) {
      state.textContent = String((error && error.message) || error);
      report?.(error);
    } finally {
      busy = false;
      precheck.disabled = publishBtn.disabled = false;
    }
  }

  /**
   * 按款式拆卡的上架执行（alignment §12）。
   *
   * 顺序（与普通上架同一套单步执行器，只是按卡循环）：
   *   1. 图片**只提交一次**：55 个 offer 一起发 /v2/product/pictures/import，
   *      然后只等一轮 40 秒。若每张卡都等一轮，55 × 40s 就白等 35 分钟。
   *   2. 逐卡：import（1 条） → poll → products → price → stock。
   *      每张卡单独 import，一张卡失败不影响其余 54 张，进度也能逐卡显示。
   *   3. 结果落 __SSERP_SPLIT_RESULT__，失败卡片带错误码，便于定点重发。
   */
  async function runSplitPublish() {
    const { merged, cards } = await buildSplitPlans();
    lastPlan = merged;
    renderTable(merged);
    fillPricesManualGuard(merged);
    const skipped = (merged.notes || []).filter((one) => one.code === 'CARD_EXISTS');
    // 全部卡都已存在：不重发（重发会被判「类似商品重复」），直接收工
    if (!cards.length && skipped.length) {
      globalThis.__SSERP_SPLIT_RESULT__ = { total: 0, created: 0, stocked: 0, skipped: skipped.length, offerBase: merged.offerBase, cards: [], failed: [] };
      state.textContent = `拆卡：${skipped.length} 张卡都已在 Ozon 存在，无需重发`;
      return;
    }
    globalThis.__SSERP_PROGRESS__ = 'split-ready=' + merged.ready + ' blockers=' + JSON.stringify((merged.blockers || []).map((one) => one.code));
    if (!merged.ready) {
      const head = (merged.blockers || []).slice(0, 5).map((one) => `${one.scope}/${one.code}`).join(' / ');
      throw new Error(`拆卡预检未通过（${(merged.blockers || []).length} 项）：${head}`);
    }
    // 与普通上架同一条硬门槛：必须有 AI 生成图，否则会把带中文水印的 1688 原图发上去
    const generatedReady = (lastImageResults || [])
      .map((one) => String((one && one.url) || ""))
      .filter((url) => /^https:\/\//.test(url));
    if (!generatedReady.length) {
      throw new Error("还没有 AI 生成图：每张卡的首图会是 1688 原图（带中文水印）。先在「生图」里出图，再发布。");
    }
    const step = (action, payload) => send('ss-erp:direct-publish-step', Object.assign({ action }, payload || {}));
    const toImportItem = (item) => ({
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
    });
    // 库存仓库：先取一次，循环里不再重复读
    const stockCount = Number(stockInput.input.value);
    let warehouseId = Number(warehouse.value);
    if (stockCount > 0 && !(warehouseId > 0)) {
      await loadWarehouses();
      if (!Number(warehouse.value) && warehouse.options.length) warehouse.value = warehouse.options[0].value;
      warehouseId = Number(warehouse.value);
    }
    output.textContent = '';
    // 1) 图片：55 张卡共用同一套生成图 + 各自的款式原图，一次性提交
    state.textContent = `拆卡：提交图片（${cards.length} 张卡）…`;
    const pictureEntries = [];
    for (const card of cards) {
      for (const item of card.items) {
        const urls = (item.images || []).filter((url) => /^https:\/\//.test(String(url)));
        if (urls.length) pictureEntries.push({ offerId: item.offerId, imageUrls: urls });
      }
    }
    globalThis.__SSERP_SPLIT_PICTURES__ = { cards: cards.length, entries: pictureEntries.length, start: Date.now() };
    // 纯更新（改动只在标题/文案）时不用再提交图片：重发会让 Ozon 重新审图，
    // 白白把「Продается」打回 pending（实测改标题这类操作不该动图）。
    const needsPictures = cards.some((card) => !card.update);
    if (needsPictures && pictureEntries.length) {
      await step('pictures', { entries: pictureEntries });
      globalThis.__SSERP_SPLIT_PICTURES__.doneAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 40000));
    }
    // 2) 逐卡上架
    const results = [];
    for (const [index, card] of cards.entries()) {
      const importItems = card.items.map(toImportItem);
      const offers = importItems.map((one) => one.offerId);
      const record = { cardBase: card.cardBase, segment: card.segment, offers, created: [], rows: [], stock: 'skipped', update: Boolean(card.update) };
      state.textContent = `拆卡 ${index + 1}/${cards.length}：${card.segment}（${card.cardBase}）${card.update ? ' 更新' : ''}…`;
      // 限流（periodic_limit_exceeded）不是失败：Ozon 的导入配额按周期恢复，
      // 等一会儿重发同一张卡就行（import 对同 offer 幂等）。55 张连发必然遇到。
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        record.created = [];
        record.rows = [];
        record.error = undefined;
        let retry = false;
      try {
        const imported = await step('import', { items: importItems });
        if (!imported || !imported.taskId) throw new Error('Ozon 没有返回 task_id');
        let poll = { done: false, items: [] };
        for (let i = 0; i < 20 && !poll.done; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 4000));
          poll = await step('poll', { taskId: imported.taskId });
        }
        record.importStatus = (poll.items || []).map((one) => one.status).join(',');
        record.importErrors = [...new Set((poll.items || []).flatMap((one) => one.errors || []))];
        let products = { ready: [], pending: offers, rows: [] };
        for (let i = 0; i < 12; i += 1) {
          if (i) await new Promise((resolve) => setTimeout(resolve, 5000));
          products = await step('products', { offers });
          if (!(products.pending || []).length) break;
        }
        record.created = products.ready || [];
        record.rows = products.rows || [];
        if (!record.created.length) {
          record.error = 'NOT_CREATED';
        } else if (card.update) {
          // 更新已存在卡：只 import（改标题/文案/属性），价格库存保持线上原值
          record.price = 'kept';
          record.stock = 'kept';
        } else {
          // 价格：import 已经带了价，这里再发一次是为了「已经建好但导入时价格没落库」的情况。
          // 新建卡在审核前会回 updated:false，所以要退避重试，不是失败。
          let priced = { ok: [], failed: [] };
          for (let attempt = 1; attempt <= 3; attempt += 1) {
            priced = await step('price', {
              offers: record.created, price: importItems[0].price, oldPrice: importItems[0].oldPrice,
              currency: importItems[0].currency, vat: importItems[0].vat,
            }).catch((error) => ({ ok: [], failed: [], error: String((error && error.message) || error) }));
            if (priced.error || (priced.ok || []).length) break;
            await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
          }
          record.price = priced && priced.error ? priced.error : `${(priced.ok || []).length}/${record.created.length}`;
          record.priceErrors = [...new Set((priced.failed || []).flatMap((one) => one.codes || []))];
          if (stockCount > 0 && warehouseId > 0) {
            let stocked = { ok: [], failed: [] };
            for (let attempt = 1; attempt <= 4; attempt += 1) {
              stocked = await step('stock', { offers: record.created, stock: stockCount, warehouseId })
                .catch(() => ({ ok: [], failed: record.created.map((offerId) => ({ offerId, codes: ['STOCK_CALL_FAILED'] })) }));
              const retryable = (stocked.failed || []).some((one) => (one.codes || []).some((code) =>
                ['PRODUCT_IS_NOT_CREATED', 'TOO_MANY_REQUESTS', 'NOT_PASS_MODERATION'].includes(code)));
              if (!(stocked.failed || []).length || !retryable) break;
              await new Promise((resolve) => setTimeout(resolve, 6000 * attempt));
            }
            record.stock = `${(stocked.ok || []).length}/${record.created.length}`;
            record.stockErrors = [...new Set((stocked.failed || []).flatMap((one) => one.codes || []))];
          }
        }
      } catch (error) {
        const message = String((error && error.message) || error);
        retry = attempt < 3 && /periodic_limit_exceeded|TOO_MANY_REQUESTS|HTTP 429|超时|连接失败/i.test(message);
        if (retry) {
          state.textContent = `拆卡 ${index + 1}/${cards.length}：限流，等 ${20 * attempt}s 重发（${attempt}/3）`;
          await new Promise((resolve) => setTimeout(resolve, 20000 * attempt));
        } else {
          record.error = message.slice(0, 160);
        }
      }
        if (!retry) break;
      }
      results.push(record);
      logLine(`拆卡 ${index + 1}/${cards.length} ${card.cardBase} ${card.segment} → `
        + (record.created.length ? `created ${record.created.join(',')}` : (record.error || 'pending'))
        + (record.importErrors && record.importErrors.length ? ` | ${record.importErrors.slice(0, 2).join(',')}` : ''),
      record.created.length ? 'ok' : 'err');
      output.textContent = JSON.stringify({
        done: results.length, total: cards.length,
        created: results.filter((one) => (one.created || []).length).length,
        tail: results.slice(-2),
      }, null, 1).slice(0, 2500);
    }
    const createdCount = results.filter((one) => (one.created || []).length).length;
    // 3) 收尾对账：库存只能等审核过（NOT_PASS_MODERATION 是时序，不是失败）。
    // 逐卡设库存时几乎必然撞上「还在审核」，所以最后再对全部已创建的卡补一次。
    // 更新模式的卡不动库存（线上已有），只对新建的卡补。
    const createdOffers = results.filter((one) => !one.update).flatMap((one) => one.created || []);
    if (stockCount > 0 && warehouseId > 0 && createdOffers.length) {
      state.textContent = `拆卡：等审核后补库存（${createdOffers.length} 张）…`;
      let stocked = { ok: [], failed: [] };
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        stocked = await step('stock', { offers: createdOffers, stock: stockCount, warehouseId })
          .catch(() => ({ ok: [], failed: createdOffers.map((offerId) => ({ offerId, codes: ['STOCK_CALL_FAILED'] })) }));
        const retryable = (stocked.failed || []).some((one) => (one.codes || []).some((code) =>
          ['PRODUCT_IS_NOT_CREATED', 'TOO_MANY_REQUESTS', 'NOT_PASS_MODERATION'].includes(code)));
        if (!(stocked.failed || []).length || !retryable) break;
        state.textContent = `拆卡：补库存重试 ${attempt}（仍有 ${(stocked.failed || []).length} 张在审核）…`;
        await new Promise((resolve) => setTimeout(resolve, 20000 * attempt));
      }
      globalThis.__SSERP_SPLIT_STOCK__ = { ok: stocked.ok || [], failed: stocked.failed || [] };
      // 回填到逐卡结果：只有真收到库存的卡才算 stocked
      for (const offerId of (stocked.ok || [])) {
        const hit = results.find((one) => (one.created || []).includes(offerId));
        if (hit) hit.stock = `${(hit.created || []).filter((id) => (stocked.ok || []).includes(id)).length}/${(hit.created || []).length}`;
      }
      for (const one of (stocked.failed || [])) {
        const hit = results.find((item) => (item.created || []).includes(one.offerId));
        if (hit && hit.stock === 'skipped') hit.stock = `0/${(hit.created || []).length}`;
        if (hit) hit.stockErrors = [...new Set([...(hit.stockErrors || []), ...(one.codes || [])])];
      }
    }
    const stockedCount = results.filter((one) => /^\d+\/\d+$/.test(String(one.stock || '')) && Number(String(one.stock).split('/')[0]) > 0).length;
    const failed = results.filter((one) => !(one.created || []).length);
    const updatedDone = results.filter((one) => one.update && (one.created || []).length).length;
    globalThis.__SSERP_SPLIT_RESULT__ = {
      total: cards.length, created: createdCount, updated: updatedDone, stocked: stockedCount, skipped: skipped.length,
      offerBase: merged.offerBase,
      failed: failed.map((one) => ({ cardBase: one.cardBase, segment: one.segment, error: one.error, importErrors: one.importErrors, status: one.importStatus })),
      cards: results.map((one) => ({ cardBase: one.cardBase, segment: one.segment, created: one.created, stock: one.stock, price: one.price })),
    };
    output.textContent = JSON.stringify(globalThis.__SSERP_SPLIT_RESULT__, null, 1).slice(0, 4000);
    state.textContent = `拆卡上架完成：${createdCount}/${cards.length} 张卡已创建`
      + (updatedDone ? `（其中更新 ${updatedDone} 张）` : '')
      + (stockCount > 0 && warehouseId > 0 ? `，库存 ${stockedCount}/${createdCount - updatedDone}` : '（未设库存：仓库不可用）')
      + (skipped.length ? `，已存在跳过 ${skipped.length}` : '')
      + (failed.length ? `，失败 ${failed.length}` : '');
    onPublished?.({ split: true, total: cards.length, created: createdCount, results });
  }

  describeBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      // 视觉在跑时先锁住下游：提示词/生图都依赖视觉报告，用户连点只会得到「先点视觉描述」。
      const lockedButtons = [promptPlanBtn, genImageBtn, genAllBtn];
      for (const button of lockedButtons) button.disabled = true;
      try {
        const context = getContext();
        if (!context || !context.offerBase) throw new Error('请先采集来源商品');
        // 先给状态反馈：以前拿配置就卡住时，界面连「正在看图」都不显示，像点了没反应。
        state.textContent = '读取 AI 配置…';
        // 配置读取也要有上限：storage/SW 异常时不能把整条视觉流程拖死。
        const cfg = await Promise.race([
          readTitleAiConfig(),
          new Promise((_resolve) => setTimeout(() => _resolve(null), 15000)),
        ]);
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
        // 纯文本摘要永远有：JSON 解析失败时它仍能提供颜色等关键信息，
        // 所以颜色兜底也要看它，而不是只依赖结构化报告。
        lastVisionText = String(result.summary || "");
        output.textContent = JSON.stringify(result, null, 2).slice(0, 2000);
            for (const button of lockedButtons) button.disabled = false;
        state.textContent = `视觉描述：${result.summary.slice(0, 120)}`;
      } catch (error) {
        state.textContent = `视觉描述失败：${String((error && error.message) || error).slice(0, 160)}`;
        report?.(error);
      }
          for (const button of lockedButtons) button.disabled = false;
          for (const button of [promptPlanBtn, genImageBtn, genAllBtn]) button.disabled = false;
    })();
  });

  promptPlanBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void (async () => {
      try {
  // 视觉是增强项：模型偶发不返回时，规则版提示词照样能出图（标题/属性/参考图都在），
  // 不能因为一次视觉失败就把整条上架链堵死。
  if (!lastVisionReport) {
    state.textContent = '视觉报告缺失，按规则生成提示词';
    logLine('视觉报告缺失，按规则生成提示词', 'warn');
  }
        const cfg = await readTitleAiConfig();
        if (!cfg) throw new Error('先在上面填 AI key');
        const context = getContext();
        const skus = (context.skus || []).map((sku, index) => {
          const parsed = parseVariantSpecs([{ label: sku.label }]);
          return { rowIndex: index + 1, skuLabel: sku.label, specs: { color_name_cn: parsed.colorsZh[0] || '', size_name_cn: parsed.sizes[0] || '' } };
        });
        const rawData = {
  // 规划不需要每个 SKU：14 个 SKU 的矩阵会把提示词撑大，模型要 300 秒以上。
  // 取前 8 个足够表达颜色/尺码维度。
  sku_matrix: skus.slice(0, 8),
          sourceTitle: context.sourceTitle || '',
          images: (context.images || []).length,
        };
        state.textContent = `规划图片提示词（${cfg.model}）…`;
        // 规则版提示词（与精铺/知了一致）：纯函数、零模型调用，瞬时返回。
        // 之前用 AI 规划，14 个 SKU 时要 300 秒以上，而参考实现根本不需要模型。
        const mediaList = (context.images || []).map((url, index) => ({
          refId: "img" + (index + 1),
          url: String(url || ""),
          sourceType: index === 0 ? "main" : "detail",
          visualRole: index === 0 ? "front" : "",
        }));
        const rulePlan = buildDirectPromptPlan({
          product: {
            title: String(titleInput.value || context.sourceTitle || "").trim(),
            attributes: ((lastWorkspaceForPlan && lastWorkspaceForPlan.values) || []).map((row) => {
              const field = ((lastWorkspaceForPlan && lastWorkspaceForPlan.fields) || []).find((f) => Number(f.attributeId || f.id) === Number(row.attributeId));
              return { name: field ? String(field.name || "") : "", value: String(row.value || "") };
            }).filter((one) => one.name && one.value),
          },
          media: mediaList,
          skus: skus.map((sku) => ({ key: sku.key, label: sku.label, imageUrl: sku.imageUrl || "" })),
          perSkuCount: 8,
        });
        // 结构映射：规则版是 sharedSlots/perSku，面板消费 sharedGalleryPlans/skuHeroPlans。
        const result = {
          plan: {
            ...rulePlan,
            // 实测模块导出的是 sharedGallery（不是 sharedSlots），两者都兼容
    sharedGalleryPlans: rulePlan.sharedGallery || rulePlan.sharedSlots || [],
            skuHeroPlans: (rulePlan.perSku || []).flatMap((one) => one.slots || []),
          },
          parsed: rulePlan,
        };
        lastPromptPlan = result.plan;
        const slots = (result.plan.sharedGalleryPlans || []).map((slot) => ({
          slotId: slot.slotId, goal: slot.goalType,
          sellingPoint: String(slot.sellingPoint || '').slice(0, 60),
          prompt: String(slot.prompt || '').slice(0, 120),
        }));
        output.textContent = JSON.stringify({ parsed: result.parsed, heroes: (result.plan.skuHeroPlans || []).length, slots }, null, 2).slice(0, 3000);
        const imagePlan = computeImagePlan(getContext());
      state.textContent = `图片计划：${imagePlan.gallery} 张详情 + ${imagePlan.heroes} 张颜色主图（共 ${imagePlan.total} 张，${imagePlan.colourCount} 个颜色）`;
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

  // 按颜色生成主图：1688 未登录时采集拿不到「颜色→图」，只能用生成补。
  // 每个颜色出一张，作为该颜色所有 SKU 的首图——这样点绿色变体看到的就是绿色。
  // 图片数量不是固定 8 张。参考实现的规则：
  //   精铺 PROMPT_PLAN_SHARED_GALLERY_COUNT = 7（7 张共享详情）+ 每个 SKU 一张 hero
  //   知了 aiSharedGalleryImageCount 默认 7，且是按参数传的
  // 我们按「详情 7 张 + 每个颜色 1 张主图」算，总数封顶 Ozon 的 15 张。
  const OZON_MAX_IMAGES = 15;
  const SHARED_GALLERY_COUNT = 7;
  function computeImagePlan(context) {
    const skus = (context && context.skus) || [];
    const colours = [...new Set(skus
      .map((sku) => String(sku.label || "").split("/")[0].trim())
      .filter(Boolean))];
    const colourCount = Math.max(1, colours.length);
    const heroes = Math.min(colourCount, 8, OZON_MAX_IMAGES - 1);
    const gallery = Math.min(SHARED_GALLERY_COUNT, OZON_MAX_IMAGES - heroes);
    return { heroes, gallery, total: heroes + gallery, colourCount };
  }

  const colourHeroMap = new Map();
  async function runColourHeroes() {
    const workspace = lastWorkspaceForPlan;
    if (!workspace) return { generated: 0 };
    const colourField = (workspace.fields || []).find((field) => field
      && /颜色|色彩/i.test(String(field.name || ""))
      && String(field.ownership || "").toUpperCase() === "SKU")
      || (workspace.fields || []).find((field) => Number(field.attributeId || field.id) === 10096);
    const colourId = colourField ? Number(colourField.attributeId || colourField.id) : 0;
    if (!colourId) return { generated: 0 };
    const colours = [...new Set((workspace.values || [])
      .filter((row) => Number(row.attributeId) === colourId && !row.__unresolved)
      .map((row) => String(row.value || "").trim())
      .filter(Boolean))];
    if (colours.length < 2) return { generated: 0, colours: colours.length };
    const planned = computeImagePlan(getContext());
    const limit = Math.min(colours.length, planned.heroes);
    const context = getContext();
    // 每个颜色自己的 1688 原图：作为该颜色主图的参考图。
    // 之前四种颜色共用同一组参考图，模型画出来的四张几乎一样，
    // 结果 Ozon 上三个颜色共用一张首图（实测只有 коричневый 不同）。
    const refByColour = new Map();
    for (const sku of (context.skus || [])) {
      const ru = colorsFromText(String(sku.label || ""))[0];
      if (ru && !refByColour.has(ru) && /^https?:\/\//.test(String(sku.imageUrl || ""))) {
        refByColour.set(ru, String(sku.imageUrl));
      }
    }
    let generated = 0;
    for (let index = 0; index < limit; index += 1) {
      const colour = colours[index];
      if (colourHeroMap.has(colour)) { generated += 1; continue; }
      state.textContent = `颜色主图 ${index + 1}/${limit}：${colour}…`;
      const prompt = [
        "Studio product photograph of a woman wearing a long-sleeve half-turtleneck knit top.",
        `The garment colour is exactly ${colour} and it must dominate the frame - a viewer must read the colour as ${colour} at a glance.`,
        "Full front view, plain light background, garment occupying 70-80% of the frame, no text, no watermark.",
      ].join(" ");
      const ownRef = refByColour.get(colour);
      const refs = ownRef ? [ownRef] : (context.images || []).slice(0, 2);
      try {
        const result = await send("ss-erp:direct-image-generate", {
          prompt,
          inputImageUrls: refs,
          timeoutMs: 180000,
        });
        const url = result && (result.url || result.imageUrl || (result.urls && result.urls[0]));
        if (url) { colourHeroMap.set(colour, url); generated += 1; }
      } catch (_error) { /* 单色失败不拖垮整批 */ }
    }
    globalThis.__SSERP_COLOUR_HEROES__ = Object.fromEntries(colourHeroMap);
    globalThis.__SSERP_COLOUR_REFS__ = Object.fromEntries(refByColour);
    return { generated, colours: colours.length };
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
    void runPlanImages(computeImagePlan(getContext()).gallery + 1).catch((error) => {
      state.textContent = `生图失败：${String((error && error.message) || error).slice(0, 200)}`;
      report?.(error);
    });
  });

  styleHeroBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    if (!claimBusy()) return;
    styleHeroBtn.disabled = true;
    void runStyleHeroes(0)
      .catch((error) => { state.textContent = `款式主图失败：${String((error && error.message) || error).slice(0, 160)}`; })
      .finally(() => { busy = false; styleHeroBtn.disabled = false; });
  });

  styleTitleBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    if (!claimBusy()) return;
    styleTitleBtn.disabled = true;
    void runStyleTitles(0)
      .catch((error) => { state.textContent = `款式标题失败：${String((error && error.message) || error).slice(0, 160)}`; })
      .finally(() => { busy = false; styleTitleBtn.disabled = false; });
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

  // 一键上架：顺序点击现有按钮并等待状态推进，任一环节失败立即停止。
  async function runOneClick() {
    // 不能用 claimBusy：本函数依次点击预检/上架，它们各自也会 claimBusy，
    // 一开始就占用会让后续步骤直接被拒（实测停在第 3 步后空等）。
    if (oneClickBtn.disabled) return;
    oneClickBtn.disabled = true;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const step = async (button, done, failure, label, maxSeconds) => {
      state.textContent = label;
      button.click();
      for (let elapsed = 0; elapsed < maxSeconds; elapsed += 2) {
        await wait(2000);
        const text = String(state.textContent || "");
        if (failure && failure.test(text)) throw new Error(text);
        if (done.test(text)) return;
      }
      throw new Error(label + " 超时");
    };
    try {
      // 视觉是增强项，不是必须项：模型偶发不返回时不能把整条链卡死，
      // 属性有颜色/性别/标题兜底，缺了视觉仍然能出单。
      try {
        await step(describeBtn, /视觉描述：/, /失败/, "1/5 视觉分析…", 150);
      } catch (visionError) {
        logLine("视觉分析未返回，按规则继续：" + String((visionError && visionError.message) || visionError).slice(0, 60), "warn");
      }
      await step(promptPlanBtn, /图片计划：|图片提示词：/, /失败/, "2/5 生成提示词…", 120);
      await step(genAllBtn, /生图完成/, /失败/, "3/5 生成图片…", 900);
      // 标题必须按当前商品重算：输入框的值会跨商品保留，
      // 之前长裙沿用了上一件短裙的标题（Юбка … короткая）。
      try {
        state.textContent = "3.6/5 刷新标题…";
        // 不再点 AI 生成：规则版标题更稳（见 buildPlan 的规则优先逻辑）。
        await wait(1200);
      } catch (_e) { /* 刷不出来就用手里的标题 */ }
      await step(precheck, /预检通过/, /预检未通过|失败/, "4/5 预检…", 300);
      // 颜色主图必须在预检之后：预检才建出 workspace（颜色已归一化），
      // 之前放在生图之后跑，lastWorkspaceForPlan 还是空的，整步被静默跳过。
      // 多色商品先补每个颜色的主图，否则所有变体显示同一张（买家看到的都是灰的）。
      state.textContent = "3.5/5 颜色主图…";
      try {
        const colourRun = await runColourHeroes();
        if (colourRun && colourRun.generated) logLine(`颜色主图：${colourRun.generated}/${colourRun.colours} 个颜色`, "ok");
      } catch (_error) { /* 颜色主图失败不阻断上架 */ }
      await step(publishBtn, /上架完成/, /失败|补齐/, "5/5 上架…", 1200);
    } catch (error) {
      state.textContent = "一键上架中断：" + String((error && error.message) || error).slice(0, 120);
    } finally {
      oneClickBtn.disabled = false;
      busy = false;
    }
  }
  oneClickBtn.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    void runOneClick();
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
        const offers = (() => {
          // 拆卡模式下货号是「前缀 + 卡序号」（A1…A55），不是「前缀-尺码后缀」，
          // 补库存必须用同一套货号，否则一条都对不上。
          const segments = styleSegments(allSkus);
          if (Boolean(splitByStyle.checked) && segments.length > 1) {
            const cards = limitValue > 0 ? segments.slice(0, limitValue) : segments;
            return cards.map((_segment, index) => prefixed + String(index + 1));
          }
          return skus.map((sku, index) => offerIdFor(prefixed, sku.key, index));
        })();
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
  // 生成图 + 款式主图回填：之前生成过就直接用于 listing（等上下文就绪，最多 15 秒）
  void (async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const context = getContext();
      const sourceId = sourceIdOf(context);
      if (!sourceId) continue;
      const stored = await loadGeneratedImages(sourceId);
      const heroes = await loadStyleHeroes(sourceId);
      const titles = await loadStyleTitles(sourceId);
      if (!Number(catIdInput.value) && !Number(typeIdInput.value)) {
        const cached = await readCachedCategory(sourceId);
        if (cached) { catIdInput.value = String(cached.categoryId); typeIdInput.value = String(cached.typeId); }
      }
      if (!stored.length && !heroes.size && !titles.size) return;
      lastImageResults = stored.map((one) => ({ goalType: one.goalType, url: one.url }));
      state.textContent = `已载入 ${stored.length} 张生成图 / ${heroes.size} 张款式主图 / ${titles.size} 条款式标题`;
      return;
    }
  })();

  return { panel, refresh: () => loadWarehouses(), lastPlan: () => lastPlan };
}