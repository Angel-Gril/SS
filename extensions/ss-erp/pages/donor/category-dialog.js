// Direct adaptation of jp20260803's category-picker-view: recommendation cards,
// expandable official tree and an attribute preview. Transport, catalog identity
// and draft writes stay with the ERP owners; this module only projects their DTOs.
const bindingKeys = ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion'];

function bindingProjection(value) {
  if (!value || !bindingKeys.slice(0, 4).every(key => typeof value[key] === 'string' && value[key].trim() && value[key].length <= 200)
    || !bindingKeys.slice(4).every(key => Number.isSafeInteger(value[key]) && value[key] > 0)) return null;
  return Object.freeze(Object.fromEntries(bindingKeys.map(key => [key, value[key]])));
}

const pairKey = value => `${value.categoryId}:${value.typeId}`;
const validId = value => Number.isSafeInteger(value) && value > 0;
const safeText = (value, length = 500) => typeof value === 'string' ? value.trim().slice(0, length) : '';

function leafProjection(value) {
    if (!value || !validId(value.categoryId) || !validId(value.typeId) || !safeText(value.label)) {
    throw new TypeError('Invalid official category leaf');
  }
  const pathTitles = Array.isArray(value.pathTitles) ? value.pathTitles.map(title => safeText(title)).filter(Boolean).slice(0, 12)
    : Array.isArray(value.path) ? value.path.map(node => safeText(node?.label)).filter(Boolean).slice(0, 12)
      : safeText(value.label).split(' / ').slice(0, -1);
  return Object.freeze({ categoryId: value.categoryId, typeId: value.typeId, label: safeText(value.label),
    typeLabel: safeText(value.typeLabel) || safeText(value.label).split(' / ').at(-1), pathTitles: Object.freeze(pathTitles) });
}

function treeProjection(nodes, leaves, budget, depth = 0) {
  if (!Array.isArray(nodes) || depth > 32) throw new TypeError('Invalid official category tree');
  return nodes.map(node => {
    if (--budget.remaining < 0 || !node || !validId(node.categoryId) || !safeText(node.label)
      || !Array.isArray(node.children) || !Array.isArray(node.types)) throw new TypeError('Invalid official category branch');
    const types = node.types.map(value => {
      if (--budget.remaining < 0) throw new TypeError('Official category tree is too large');
      const leaf = leafProjection(value); leaves.set(pairKey(leaf), leaf); return leaf;
    });
    return Object.freeze({ categoryId: node.categoryId, label: safeText(node.label),
      children: Object.freeze(treeProjection(node.children, leaves, budget, depth + 1)), types: Object.freeze(types) });
  });
}

export function createCategoryDialog({ root, getBinding, getProduct = () => null, loadCatalog,
  loadSuggestions, loadAttributePreview, saveSelection, localCatalog = null, skipAttributePreview = false,
  onError = () => {}, onState = () => {} }) {
  if (!root?.ownerDocument || typeof getBinding !== 'function' || typeof loadCatalog !== 'function'
    || typeof saveSelection !== 'function') throw new TypeError('Category dialog requires an element and ERP owner adapters');
  const document = root.ownerDocument;
  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }
  const dialog = make('section', 'settings-dialog category-dialog precision-category-dialog');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', '选择 Ozon 类目');
  const header = make('div', 'settings-head');
  const heading = make('div'); heading.append(make('div', 'settings-title', '选择 Ozon 类目'));
  const status = make('div', 'settings-tip'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); heading.append(status);
  const closeButton = make('button', 'ghost', '关闭'); closeButton.type = 'button';
  header.append(heading, closeButton);
  const searchArea = make('div', 'category-dialog__search');
  const searchRow = make('div', 'precision-category-search-row');
  const searchInput = make('input'); searchInput.type = 'search'; searchInput.maxLength = 100;
  searchInput.placeholder = '搜索类目名称…'; searchInput.setAttribute('aria-label', '搜索 Ozon 官方类目'); searchInput.dataset.categorySearch = '';
  const searchButton = make('button', 'ghost', '搜索'); searchButton.type = 'button';
  searchRow.append(searchInput, searchButton);
  const autoPanel = make('div', 'category-auto-panel');
  autoPanel.append(make('div', 'category-auto-title', '推荐类目'));
  const autoList = make('div', 'category-auto-list'); autoPanel.append(autoList); searchArea.append(searchRow, autoPanel);
  const body = make('div', 'category-dialog__body');
  const treePane = make('div', 'category-dialog__pane category-dialog__pane--tree'); treePane.dataset.categoryTree = '';
  const attrsPane = make('div', 'category-dialog__pane category-dialog__pane--attrs'); attrsPane.dataset.categoryAttributes = '';
  body.append(treePane, attrsPane);
  const footer = make('div', 'settings-foot precision-category-footer');
  const selectedLabel = make('div', 'settings-tip', '未选择类目');
  const confirmButton = make('button', 'primary', '确认选择'); confirmButton.type = 'button'; confirmButton.disabled = true; confirmButton.dataset.categoryConfirm = '';
  footer.append(selectedLabel, confirmButton); dialog.append(header, searchArea, body, footer);
  root.replaceChildren(dialog); root.hidden = true;

  let epoch = 0, previewEpoch = 0, sessionEpoch = 0, searchTimer, observedBinding = '', catalogTree = [], officialLeaves = new Map(), recommendations = [];
  let value = { open: false, status: 'closed', query: '', catalogRevision: null, selected: null,
    canSave: false, previewStatus: 'idle', message: '未选择类目', truncated: false, treeTruncated: false, total: 0 };
  let entries = [];
  const readBinding = () => { try { return bindingProjection(getBinding()); } catch { return null; } };
  const keyOfBinding = binding => binding ? JSON.stringify(binding) : '';
  const snapshot = () => Object.freeze({ ...value, selected: value.selected ? Object.freeze({ ...value.selected }) : null });
  function notifyError(code, message) { const error = new Error(message); error.code = code; onError(error); }
  function resetCatalog() {
    entries = []; catalogTree = []; officialLeaves = new Map(); recommendations = [];
    value = { ...value, catalogRevision: null, selected: null, canSave: false, previewStatus: 'idle', total: 0,
      truncated: false, treeTruncated: false };
    selectedLabel.textContent = '未选择类目'; attrsPane.textContent = '请先在左侧选择一个叶子类目';
  }
  function renderStatus() {
    status.textContent = value.message;
    status.classList.toggle('precision-category-error', value.status === 'error' || value.previewStatus === 'error');
    confirmButton.disabled = !value.canSave || value.status === 'saving';
    confirmButton.textContent = value.status === 'saving' ? '正在保存…'
      : value.previewStatus === 'ready' ? '确认类目并继续' : '确认选择';
    searchButton.disabled = value.status === 'saving'; searchInput.disabled = value.status === 'saving';
    onState(snapshot());
  }
  // 2026-11 诊断：把 binding 变化轨迹写进 DOM，主 world 可直接读取。
  var catDialogTrail = [];
  function catDiag(msg) {
    try {
      catDialogTrail.push(msg);
      if (catDialogTrail.length > 30) catDialogTrail.shift();
      document.documentElement.setAttribute('data-cat-diag', catDialogTrail.join(' >> ').slice(-1800));
    } catch (_e) {}
  }
  function syncBinding() {
    const current = keyOfBinding(readBinding());
    if (current !== observedBinding) {
      catDiag('syncBinding:changed prev=' + observedBinding.slice(0, 120) + ' next=' + current.slice(0, 120));
      observedBinding = current; epoch++; previewEpoch++; clearTimeout(searchTimer); resetCatalog();
      value.status = current ? 'stale' : 'unavailable';
      value.message = current ? '店铺或草稿已变化，请重新读取官方类目' : '请先选择店铺并创建 ERP 草稿';
      renderTree(); renderRecommendations(); renderStatus();
    }
    const currentState = snapshot(); onState(currentState); return currentState;
  }
  function isCurrent(requestEpoch, bindingKey) {
    syncBinding();
    const ok = value.open && epoch === requestEpoch && observedBinding === bindingKey;
    if (!ok) catDiag('isCurrent:false epochMatch=' + (epoch === requestEpoch) + ' bindingMatch=' + (observedBinding === bindingKey) + ' open=' + value.open);
    else catDiag('isCurrent:true');
    return ok;
  }
  function selectionFor(leaf) {
    return Object.freeze({ categoryId: leaf.categoryId, typeId: leaf.typeId, catalogRevision: value.catalogRevision });
  }
  function markSelected() {
    const selectedKey = value.selected ? pairKey(value.selected) : '';
    root.querySelectorAll('[data-category-leaf], .category-auto-card').forEach(node => {
      const selected = node.dataset.categoryPair === selectedKey;
      node.classList.toggle('is-selected', selected); node.setAttribute('aria-pressed', String(selected));
    });
  }
  function renderAttributes(preview) {
    const fields = preview?.fields || preview?.attributes;
    if (!Array.isArray(fields) || fields.length > 500) throw new TypeError('Invalid attribute preview');
    attrsPane.replaceChildren();
    attrsPane.append(make('div', 'precision-category-attribute-title', '商品属性预览'));
    if (!fields.length) attrsPane.append(make('div', 'settings-tip', '当前类目没有需要展示的商品属性'));
    for (const field of fields) {
      const row = make('div', 'precision-category-attribute');
      if (field.required) row.append(make('span', 'precision-category-required', '必填 '));
      const dictionary = validId(field.dictionaryId) || field.valueType === 'dictionary' || field.type === 'dictionary';
      const typeLabels = { STRING: '文本', INTEGER: '数值', DECIMAL: '数值', BOOLEAN: '布尔', DATE: '日期', DATETIME: '日期时间', JSON: '结构化值' };
      const typeLabel = dictionary ? '选项' : typeLabels[String(field.valueType || field.type || '').toUpperCase()] || '文本';
      row.append(make('span', 'settings-tip', `[${typeLabel}] `));
      row.append(document.createTextNode(safeText(field.name) || '商品属性'));
      if (field.editorMode === 'READ_ONLY' || field.ownership === 'SYSTEM') row.append(make('span', 'settings-tip', '（系统管理）'));
      attrsPane.append(row);
    }
    attrsPane.append(make('p', 'settings-tip', '确认后在工作台填写商品属性；具体字段与校验以 ERP 官方属性为准。'));
  }
  async function selectLeaf(leafKey) {
    syncBinding();
    const leaf = officialLeaves.get(leafKey), binding = readBinding();
    const bindingRequired = !skipAttributePreview;
    if (!value.open || (bindingRequired && !binding) || !value.catalogRevision || !leaf
      || value.status === 'saving' || value.status === 'loading') return;
    const requestEpoch = epoch, requestedBinding = observedBinding, requestPreview = ++previewEpoch;
    value.selected = leaf; value.canSave = false; value.previewStatus = 'loading';
    value.message = '正在读取所选类目的官方属性…'; selectedLabel.textContent = '已选：' + leaf.typeLabel;
    attrsPane.textContent = '正在读取商品属性…'; markSelected(); renderStatus();

    // 2026-11：属性预览走 ERP /editor/catalog，而该接口的回执在
    // chrome.runtime.sendMessage 上不稳定（实测 712KB 时彻底丢失）。
    // 属性本来就是「确认类目后在工作台填写」的后续步骤，不是选类目的前置条件，
    // 因此提供 skipAttributePreview：直接放行保存，属性留到工作台里填。
    if (skipAttributePreview) {
      value.previewStatus = 'ready'; value.canSave = true;
      value.message = '已选类目；点击「确认类目并继续」写入草稿，属性稍后在工作台填写';
      attrsPane.replaceChildren();
      attrsPane.append(make('div', 'precision-category-attribute-title', '商品属性'));
      attrsPane.append(make('p', 'settings-tip', '属性在确认类目后由工作台按官方 schema 读取并填写。'));
      renderStatus();
      return;
    }

    try {
      if (typeof loadAttributePreview !== 'function') throw new Error('Attribute preview adapter unavailable');
      const selection = selectionFor(leaf);
      const response = await loadAttributePreview(binding, selection);
      if (!isCurrent(requestEpoch, requestedBinding) || requestPreview !== previewEpoch) return;
      const preview = response?.attributePreview || response;
      if (!preview || preview.categoryId !== selection.categoryId || preview.typeId !== selection.typeId
        || preview.catalogRevision !== selection.catalogRevision) throw new TypeError('Attribute preview owner mismatch');
      renderAttributes(preview); value.previewStatus = 'ready'; value.canSave = true;
      value.message = '已读取官方属性；点击“确认类目并继续”后刷新草稿并继续下一步'; renderStatus();
    } catch {
      if (!isCurrent(requestEpoch, requestedBinding) || requestPreview !== previewEpoch) return;
      value.previewStatus = 'error'; value.canSave = false; value.message = '商品属性读取失败，请重新选择类目后重试';
      attrsPane.textContent = '未取得当前类目的官方属性，请重新选择或刷新'; renderStatus();
      notifyError('CATEGORY_ATTRIBUTE_PREVIEW_FAILED', value.message);
    }
  }
  function leafButton(leaf) {
    const button = make('button', 'precision-category-leaf', leaf.typeLabel); button.type = 'button';
    button.dataset.categoryLeaf = ''; button.dataset.categoryPair = pairKey(leaf);
    button.title = leaf.label; button.addEventListener('click', () => void selectLeaf(pairKey(leaf))); return button;
  }
  function branchElement(node, expand = false) {
    const details = make('details', 'precision-category-branch');
    const summary = make('summary', '', node.label); details.append(summary);
    let populated = false;
    function populate() {
      if (populated || !details.open) return; populated = true;
      const children = make('div', 'precision-category-children');
      for (const branch of node.children) children.append(branchElement(branch, expand));
      for (const leaf of node.types) children.append(leafButton(leaf));
      details.append(children); markSelected();
    }
    details.addEventListener('toggle', populate);
    details.open = expand; populate(); return details;
  }
  function groupedEntries() {
    const roots = [], groups = new Map();
    for (const leaf of entries) {
      let destination = roots, pathKey = '';
      for (const label of leaf.pathTitles) {
        pathKey += '\u0000' + label;
        let branch = groups.get(pathKey);
        if (!branch) { branch = { label, children: [], types: [] }; groups.set(pathKey, branch); destination.push(branch); }
        destination = branch.children;
      }
      if (pathKey) groups.get(pathKey).types.push(leaf);
      else roots.push({ label: leaf.typeLabel, children: [], types: [leaf] });
    }
    return roots;
  }
  function renderTree() {
    treePane.replaceChildren();
    if (!value.catalogRevision) { treePane.append(make('div', 'precision-category-tree-message settings-tip', value.message)); return; }
    const nodes = value.query ? groupedEntries() : catalogTree.length ? catalogTree : groupedEntries();
    for (const node of nodes) treePane.append(branchElement(node, Boolean(value.query)));
    if (!nodes.length) treePane.append(make('div', 'precision-category-tree-message settings-tip', '没有匹配类目，请换一个更具体的商品关键词'));
    if (value.truncated || (!value.query && value.treeTruncated)) {
      treePane.append(make('div', 'precision-category-tree-message settings-tip', '目录较多，仅展示部分结果；请输入具体商品名称搜索完整目录'));
    }
    markSelected();
  }
  function projectRecommendations(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.slice(0, 12).flatMap(item => {
      const key = item && validId(item.categoryId) && validId(item.typeId) ? pairKey(item) : '';
      if (!key || seen.has(key)) return [];
      // 推荐项来自「全量官方类目」，而 entries 在空关键词时只包含目录的前 50 条，
      // 两者通常不重合。此前这里用 officialLeaves.get(key) 查不到就静默丢弃，
      // 导致推荐卡片恒为空（实测命中率≈0）。
      // 改为：查不到时用推荐项自身字段构造 leaf，并回填 officialLeaves，
      // 保证后续 selectLeaf() 点击时仍能取到该类目。
      let leaf = officialLeaves.get(key);
      if (!leaf) {
        try {
          leaf = leafProjection(item);
        } catch {
          return [];
        }
        officialLeaves.set(key, leaf);
      }
      seen.add(key);
      return [{ ...leaf, match: ['recommended', 'optional', 'risky'].includes(item.match) ? item.match : 'optional',
        reasons: Array.isArray(item.reasons) ? item.reasons.map(reason => safeText(reason, 300)).filter(Boolean).slice(0, 3) : [] }];
    }).slice(0, 3);
  }
  function renderRecommendations() {
    autoPanel.hidden = !recommendations.length;
    autoList.replaceChildren();
    recommendations.forEach((leaf, index) => {
      const button = make('button', 'category-auto-card'); button.type = 'button'; button.dataset.categoryPair = pairKey(leaf);
      const head = make('div', 'category-auto-card__header');
      head.append(make('div', 'category-auto-card__title', `${index + 1}. ${leaf.typeLabel}`));
      head.append(make('span', 'category-auto-card__confidence', {recommended:'推荐',optional:'参考',risky:'需核对'}[leaf.match]));
      button.append(head, make('div', 'category-auto-card__path', leaf.pathTitles.join(' / ')), make('div', 'category-auto-card__reason', leaf.reasons.join('；')));
      button.addEventListener('click', () => void selectLeaf(pairKey(leaf))); autoList.append(button);
    }); markSelected();
  }
  function applyCatalog(catalog) {
    if (!catalog || !safeText(catalog.catalogRevision, 200) || catalog.catalogRevision.length > 200
      || !Array.isArray(catalog.entries) || catalog.entries.length > 500
      || typeof catalog.truncated !== 'boolean') throw new TypeError('Invalid official catalog');
    const sameRevision = value.catalogRevision === catalog.catalogRevision;
    if (!sameRevision) { catalogTree = []; officialLeaves = new Map(); recommendations = []; }
    entries = catalog.entries.map(leafProjection);
    for (const leaf of entries) officialLeaves.set(pairKey(leaf), leaf);
    if (catalog.tree !== undefined) catalogTree = treeProjection(catalog.tree, officialLeaves, { remaining: 20000 });
    value.catalogRevision = catalog.catalogRevision; value.total = validId(catalog.total) ? catalog.total : entries.length;
    value.truncated = catalog.truncated; value.treeTruncated = Boolean(catalog.treeTruncated);
    if (catalog.recommendations !== undefined) recommendations = projectRecommendations(catalog.recommendations);
    value.status = entries.length || catalogTree.length ? 'ready' : 'empty';
    value.message = value.query ? (entries.length ? `找到 ${entries.length} 个官方类目，请选择匹配的商品类型` : '没有匹配类目，请尝试具体商品名称')
      : '请选择推荐类目，或展开左侧目录选择商品类型';
    renderTree(); renderRecommendations(); renderStatus();
  }
  async function search(query = searchInput.value) {
    clearTimeout(searchTimer); syncBinding();
    const binding = readBinding(), requestedBinding = observedBinding, requestEpoch = ++epoch;
    previewEpoch++; value.query = safeText(query, 101); value.selected = null; value.canSave = false; value.previewStatus = 'idle';
    selectedLabel.textContent = '未选择类目'; attrsPane.textContent = '请先在左侧选择一个叶子类目';
    // 2026-11：localCatalog 存在时不需要 ERP binding（草稿），
    // 类目来自内置的 Ozon 官方快照，纯本地匹配，0 网络、0 草稿依赖。
    // 这解开了「选类目需要草稿、建草稿流程第一步又要选类目」的死锁。
    if (!value.open) { value.status = 'closed'; renderStatus(); return snapshot(); }
    if (!binding && typeof localCatalog !== 'function') {
      value.status = 'unavailable'; value.message = '请先选择店铺并创建 ERP 草稿'; renderStatus(); return snapshot();
    }
    if (value.query.length > 100) { value.status = 'error'; value.message = '类目关键词最多 100 个字符'; renderStatus(); return snapshot(); }
    value.status = 'loading';
    value.message = typeof localCatalog === 'function' ? '正在本地检索 Ozon 官方类目…' : '正在读取 Ozon 官方类目…';
    renderStatus();
    try {
      const catalog = typeof localCatalog === 'function'
        ? localCatalog(value.query)
        : await loadCatalog(binding, value.query);
      if (!isCurrent(requestEpoch, requestedBinding)) return snapshot();
      applyCatalog(catalog);
      if (!value.query && typeof localCatalog !== 'function' && typeof loadSuggestions === 'function') {
        const response = await loadSuggestions(binding, getProduct(), catalog);
        if (!isCurrent(requestEpoch, requestedBinding)) return snapshot();
        if (response?.catalogRevision !== value.catalogRevision) return snapshot();
        recommendations = projectRecommendations(response.recommendations || response.suggestions); renderRecommendations();
      }
    } catch {
      if (!isCurrent(requestEpoch, requestedBinding)) return snapshot();
      value.status = 'error'; value.canSave = false; value.message = 'Ozon 官方类目读取失败，请重新搜索'; renderStatus();
      notifyError('CATEGORY_CATALOG_FAILED', value.message);
    }
    return snapshot();
  }
  async function confirm() {
    syncBinding();
    if (!value.open || !value.canSave || value.status === 'saving' || !value.selected) return;
    const binding = readBinding(), selection = selectionFor(value.selected), requestedBinding = observedBinding,
      requestEpoch = epoch, requestSession = sessionEpoch;
    // saveSelection 的调用方（precision-workbench.js）会在 binding 缺失时先建草稿。
    value.status = 'saving'; renderStatus();
    try {
      await saveSelection(binding, selection);
      // A confirmed ERP write normally increments draftRevision. It may trigger
      // syncBinding while awaiting the receipt; only a different dialog session
      // should prevent closing this successfully saved selection.
      if (value.open && sessionEpoch === requestSession) close();
    } catch (error) {
      if (!isCurrent(requestEpoch, requestedBinding)) return;
      // 2026-11：原来是无参数 catch，把 saveSelection 的真实失败原因全部吞掉，
      // 界面只剩「类目保存未确认」这种无法行动的文案。现在透出原始信息，
      // 并同时在控制台留痕，便于判断是 ERP 拒单、回读校验失败还是网络问题。
      const detail = String((error && error.message) || error || '').trim().slice(0, 240);
      value.status = 'error'; value.canSave = false;
      value.message = detail
        ? `类目保存未确认：${detail}`
        : '类目保存未确认，请重新读取草稿后选择';
      renderStatus();
      try { console.warn('[SSERP] CATEGORY_SAVE_UNCONFIRMED', detail || '(no message)', error); } catch (_e) {}
      notifyError('CATEGORY_SAVE_UNCONFIRMED', value.message);
    }
  }
  function close() {
    epoch++; previewEpoch++; sessionEpoch++; clearTimeout(searchTimer); value.open = false; value.status = 'closed'; value.canSave = false; root.hidden = true;
    return snapshot();
  }
  closeButton.addEventListener('click', close); confirmButton.addEventListener('click', () => void confirm());
  // E2E 模式下允许脚本触发搜索（生产行为不变）
  function e2eOk() {
    try {
      if (globalThis.__SSERP_E2E__ === true) return true;
      if (new URLSearchParams(location.search).get('sserp-e2e') === '1') { globalThis.__SSERP_E2E__ = true; return true; }
    } catch (_e) {}
    return false;
  }
  searchButton.addEventListener('click', () => void search());
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer); epoch++; previewEpoch++; value.canSave = false; value.selected = null;
    value.status = 'loading'; value.message = '正在搜索官方类目…'; renderStatus();
    searchTimer = setTimeout(() => void search(), 180);
  });
  searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } });
  root.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  root.addEventListener('click', event => { if (event.target === root) close(); });
  return Object.freeze({
    async open() {
      epoch++; previewEpoch++; sessionEpoch++; clearTimeout(searchTimer); observedBinding = keyOfBinding(readBinding()); resetCatalog();
      value = { ...value, open: true, status: 'loading', query: '', message: '正在读取 Ozon 官方类目…' };
      searchInput.value = ''; root.hidden = false; renderStatus(); searchInput.focus(); return search('');
    }, close, search, syncBinding, state() { return syncBinding(); },
    // 2026-11：核对完「建草稿结果」之后调用。
    // recoverPreparation() 之前只调 workbench 的 render()，管不到本 dialog 自己的
    // value 对象，于是出现「状态栏说已核对、这里还显示类目保存未确认、确认按钮仍禁用」
    // —— 用户点了两次、两次都成功，界面还在挡着他。
    // 不重新搜索（不打断已选类目），只把错误态和可保存位恢复。
    clearError() {
      if (!value.open || value.status === 'saving') return snapshot();
      if (value.status !== 'error' && value.previewStatus !== 'error') return snapshot();
      value.status = 'ready';
      value.previewStatus = value.selected ? 'ready' : 'idle';
      value.canSave = Boolean(value.selected);
      value.message = value.selected
        ? '已核对原请求结果；可继续确认类目'
        : '已核对原请求结果，请重新选择类目';
      renderStatus();
      return snapshot();
    },
  });
}
