const identityKeys = ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'];
const versionKeys = ['draftRevision', 'draftVersion'];

function projectBinding(value) {
  if (!value || !identityKeys.every(key => typeof value[key] === 'string' && value[key].trim()
    && value[key].length <= 200) || !versionKeys.every(key => Number.isSafeInteger(value[key]) && value[key] > 0)) return null;
  return Object.freeze(Object.fromEntries([...identityKeys, ...versionKeys].map(key => [key, value[key]])));
}

function projectCatalog(value) {
  if (!value || typeof value.catalogRevision !== 'string' || !value.catalogRevision.trim()
    || value.catalogRevision.length > 200 || !Array.isArray(value.entries) || value.entries.length > 50
    || typeof value.truncated !== 'boolean') throw new TypeError('Invalid category catalog projection');
  const entries = value.entries.map(entry => {
    if (!entry || !Number.isSafeInteger(entry.categoryId) || entry.categoryId < 1
      || !Number.isSafeInteger(entry.typeId) || entry.typeId < 1
      || typeof entry.label !== 'string' || !entry.label.trim()) throw new TypeError('Invalid category catalog entry');
    return Object.freeze({ categoryId: entry.categoryId, typeId: entry.typeId, label: entry.label });
  });
  return { catalogRevision: value.catalogRevision, entries: Object.freeze(entries), truncated: value.truncated };
}

// This is a UI projection controller. The ERP editor remains the authority for category
// validation, permission, ownership and revision CAS when the caller saves selection().
export function createCategoryPicker({ getBinding, loadCatalog, onState = () => {} }) {
  if (typeof getBinding !== 'function' || typeof loadCatalog !== 'function' || typeof onState !== 'function') {
    throw new TypeError('Category picker requires binding, catalog transport and state callbacks');
  }
  const readBinding = () => { try { return projectBinding(getBinding()); } catch { return null; } };
  const bindingKey = binding => binding ? JSON.stringify(binding) : '';
  let epoch = 0, observedBinding = bindingKey(readBinding());
  let value = { open: false, status: 'idle', query: '', entries: [], catalogRevision: null,
    selected: null, canSave: false, truncated: false, message: '请输入商品或类目名称搜索' };

  function snapshot() {
    return Object.freeze({ ...value, entries: Object.freeze(value.entries.slice()),
      selected: value.selected ? Object.freeze({ ...value.selected }) : null });
  }
  function notify() { const result = snapshot(); onState(result); return result; }
  function clear(status, message, fields = {}) {
    value = { ...value, entries: [], catalogRevision: null, selected: null, canSave: false,
      truncated: false, status, message, ...fields };
  }
  function syncBinding() {
    const current = bindingKey(readBinding());
    if (observedBinding !== current) {
      epoch++; observedBinding = current;
      clear(current ? 'stale' : 'unavailable', current
        ? '店铺或草稿已变化，请重新搜索官方类目'
        : '请先选择店铺并创建 ERP 草稿，再搜索官方类目');
      notify();
    }
    return snapshot();
  }
  function currentRequest(requestEpoch, requestedBinding) {
    if (epoch !== requestEpoch || !value.open) return false;
    syncBinding();
    return epoch === requestEpoch && observedBinding === requestedBinding;
  }
  function state() { return syncBinding(); }

  async function search(query = value.query) {
    const current = readBinding(), requestedBinding = bindingKey(current), requestEpoch = ++epoch;
    observedBinding = requestedBinding;
    clear('loading', '正在读取 Ozon 官方类目…', { open: true, query });
    if (!current) {
      clear('unavailable', '请先选择店铺并创建 ERP 草稿，再搜索官方类目');
      return notify();
    }
    if (typeof query !== 'string' || query.trim().length > 100) {
      clear('error', '类目关键词最多 100 个字符，请缩短后重新搜索');
      return notify();
    }
    notify();
    try {
      const response = await loadCatalog(current, query.trim());
      if (!currentRequest(requestEpoch, requestedBinding)) return snapshot();
      const catalog = projectCatalog(response);
      value = { ...value, ...catalog, status: catalog.entries.length ? 'ready' : 'empty',
        message: !catalog.entries.length ? '未找到匹配类目，请调整关键词后搜索'
          : catalog.truncated ? '仅展示部分匹配类目，请使用更具体的关键词缩小范围，再明确选择类目'
            : `找到 ${catalog.entries.length} 个官方类目，请明确选择后确认` };
      return notify();
    } catch {
      if (!currentRequest(requestEpoch, requestedBinding)) return snapshot();
      clear('error', 'Ozon 类目读取失败，请重新搜索');
      return notify();
    }
  }

  return Object.freeze({
    state, search, syncBinding,
    open() {
      epoch++; observedBinding = bindingKey(readBinding());
      clear(observedBinding ? 'idle' : 'unavailable', observedBinding
        ? '请输入商品或类目名称搜索，并明确选择官方类目'
        : '请先选择店铺并创建 ERP 草稿，再搜索官方类目', { open: true });
      return notify();
    },
    select(pair) {
      syncBinding();
      if (!value.open || value.status !== 'ready') return snapshot();
      value.selected = value.entries.find(entry => entry.categoryId === pair?.categoryId && entry.typeId === pair?.typeId) || null;
      value.canSave = Boolean(value.selected);
      value.message = value.selected ? `已选择：${value.selected.label}${value.truncated ? '；目录仅展示部分匹配项' : ''}`
        : '请选择列表中的官方类目与商品类型';
      return notify();
    },
    selection() {
      syncBinding();
      return value.open && value.canSave ? Object.freeze({ categoryId: value.selected.categoryId,
        typeId: value.selected.typeId, catalogRevision: value.catalogRevision }) : null;
    },
    close() {
      epoch++; clear('closed', '类目选择已关闭', { open: false });
      return notify();
    },
  });
}
