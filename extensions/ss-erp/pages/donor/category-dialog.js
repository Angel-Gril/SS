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
  loadSuggestions, loadAttributePreview, saveSelection, onError = () => {} }) {
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
    confirmButton.textContent = value.status === 'saving' ? '正在保存…' : '确认选择';
    searchButton.disabled = value.status === 'saving'; searchInput.disabled = value.status === 'saving';
  }
  function syncBinding() {
    const current = keyOfBinding(readBinding());
    if (current !== observedBinding) {
      observedBinding = current; epoch++; previewEpoch++; clearTimeout(searchTimer); resetCatalog();
      value.status = current ? 'stale' : 'unavailable';
      value.message = current ? '店铺或草稿已变化，请重新读取官方类目' : '请先选择店铺并创建 ERP 草稿';
      renderTree(); renderRecommendations(); renderStatus();
    }
    return snapshot();
  }
  function isCurrent(requestEpoch, bindingKey) {
    syncBinding(); return value.open && epoch === requestEpoch && observedBinding === bindingKey;
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
    if (!value.open || !binding || !value.catalogRevision || !leaf || value.status === 'saving' || value.status === 'loading') return;
    const requestEpoch = epoch, requestedBinding = observedBinding, requestPreview = ++previewEpoch;
    value.selected = leaf; value.canSave = false; value.previewStatus = 'loading';
    value.message = '正在读取所选类目的官方属性…'; selectedLabel.textContent = '已选：' + leaf.typeLabel;
    attrsPane.textContent = '正在读取商品属性…'; markSelected(); renderStatus();
    try {
      if (typeof loadAttributePreview !== 'function') throw new Error('Attribute preview adapter unavailable');
      const selection = selectionFor(leaf);
      const response = await loadAttributePreview(binding, selection);
      if (!isCurrent(requestEpoch, requestedBinding) || requestPreview !== previewEpoch) return;
      const preview = response?.attributePreview || response;
      if (!preview || preview.categoryId !== selection.categoryId || preview.typeId !== selection.typeId
        || preview.catalogRevision !== selection.catalogRevision) throw new TypeError('Attribute preview owner mismatch');
      renderAttributes(preview); value.previewStatus = 'ready'; value.canSave = true;
      value.message = '已读取官方属性，请确认所选类目与商品匹配'; renderStatus();
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
      const leaf = officialLeaves.get(key);
      if (!leaf || seen.has(key)) return []; seen.add(key);
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
    if (!value.open || !binding) { value.status = 'unavailable'; value.message = '请先选择店铺并创建 ERP 草稿'; renderStatus(); return snapshot(); }
    if (value.query.length > 100) { value.status = 'error'; value.message = '类目关键词最多 100 个字符'; renderStatus(); return snapshot(); }
    value.status = 'loading'; value.message = '正在读取 Ozon 官方类目…'; renderStatus();
    try {
      const catalog = await loadCatalog(binding, value.query);
      if (!isCurrent(requestEpoch, requestedBinding)) return snapshot();
      applyCatalog(catalog);
      if (!value.query && typeof loadSuggestions === 'function') {
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
    value.status = 'saving'; renderStatus();
    try {
      await saveSelection(binding, selection);
      // A confirmed ERP write normally increments draftRevision. It may trigger
      // syncBinding while awaiting the receipt; only a different dialog session
      // should prevent closing this successfully saved selection.
      if (value.open && sessionEpoch === requestSession) close();
    } catch {
      if (!isCurrent(requestEpoch, requestedBinding)) return;
      value.status = 'error'; value.canSave = false; value.message = '类目保存未确认，请重新读取草稿后选择'; renderStatus();
      notifyError('CATEGORY_SAVE_UNCONFIRMED', value.message);
    }
  }
  function close() {
    epoch++; previewEpoch++; sessionEpoch++; clearTimeout(searchTimer); value.open = false; value.status = 'closed'; value.canSave = false; root.hidden = true;
    return snapshot();
  }
  closeButton.addEventListener('click', close); confirmButton.addEventListener('click', () => void confirm());
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
  });
}
