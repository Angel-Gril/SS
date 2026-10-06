import { parseCollectionFieldValue } from './ui/modules/product-editor-display-rules.js';

const baseFields = [
  ['价格，CNY', 'price', true], ['折扣前价格，CNY', 'old_price', false], ['毛重，克', 'weight_g', true],
  ['包装宽度，毫米', 'width_mm', true], ['包装高度，毫米', 'height_mm', true], ['包装长度，毫米', 'depth_mm', true],
];
const fieldKey = (id) => `official-${id}`;
const leafKey = (id, sku) => JSON.stringify([id, sku || null]);
const editable = (field) => !['SYSTEM', 'MEDIA'].includes(field.ownership)
  && ['EDITABLE', 'MANUAL_REQUIRED', 'SKU_MATRIX'].includes(field.editorMode);
const displayValue = (value) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function createOfficialAttributeEditor({ root, send, getEditor, getBinding, getBusy, onSave, onDirty, onReset, onChanged, report, status }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  };
  let workspace = null, loadedToken = '', requestedToken = '', loading = false, dialog = null;
  let loadTask = null;
  const edits = new Map();
  const token = () => { try { return JSON.stringify([getBinding(), getEditor()?.category]); } catch { return ''; } };
  const current = () => workspace && loadedToken === token();
  const bar = make('div', 'precision-local-fields');
  const state = make('span', '', '选择官方类目后读取商品属性。'); state.id = 'precision-attributes-state';
  const save = make('button', 'primary', '保存商品属性'); save.id = 'editor-attributes-save-btn';
  const refresh = make('button', 'ghost', '刷新官方属性'); refresh.id = 'editor-attributes-refresh-btn';
  bar.append(state, save, refresh);
  const modal = make('div', 'settings-modal'); modal.id = 'precision-attribute-dictionary-modal'; modal.hidden = true;
  const card = make('div', 'settings-dialog'), head = make('div', 'settings-head'), title = make('div', 'settings-title');
  const close = make('button', 'ghost', '关闭'); close.id = 'precision-attribute-dictionary-close'; close.addEventListener('click', () => { modal.hidden = true; dialog = null; }); head.append(title, close);
  const body = make('div', 'settings-body'), query = make('input'), search = make('button', 'ghost', '搜索官方选项');
  query.id = 'precision-attribute-dictionary-query'; query.placeholder = '搜索官方选项';
  const list = make('div'), message = make('p'), apply = make('button', 'primary', '确认选项');
  list.style.cssText = 'max-height:320px;overflow:auto;';
  apply.id = 'precision-attribute-dictionary-apply';
  body.append(query, search, list, message, apply); card.append(head, body); modal.append(card); root.append(modal);
  const textModal = make('div', 'settings-modal'); textModal.hidden = true;
  const textCard = make('div', 'settings-dialog'), textHead = make('div', 'settings-head'), textTitle = make('div', 'settings-title');
  const textClose = make('button', 'ghost', '关闭'); textClose.addEventListener('click', () => { textModal.hidden = true; }); textHead.append(textTitle, textClose);
  const textBody = make('div', 'settings-body'), textArea = make('textarea'), textApply = make('button', 'primary', '确认编辑');
  textArea.id = 'precision-attribute-text'; textBody.append(textArea, textApply); textCard.append(textHead, textBody); textModal.append(textCard); root.append(textModal);
  let textContext = null;

  function fieldById(id) { return workspace?.fields.find((field) => field.attributeId === id); }
  function leaf(field, sku) {
    const key = field.ownership === 'SKU' ? sku : null;
    const edit = edits.get(leafKey(field.attributeId, key));
    if (edit) return { ...edit, value: edit.action === 'CLEAR' ? null : edit.value };
    return workspace.values.find((row) => row.attributeId === field.attributeId && row.skuKey === key)
      || { value: null, dictionaryValueIds: [] };
  }
  function assertEditable(field, contextToken = loadedToken) {
    if (!field || !editable(field) || !current() || contextToken !== token() || getBusy()) throw new Error('官方字段或草稿已变化，请重新读取后编辑');
  }
  function change(field, sku, value, ids, rebuild = true) {
    assertEditable(field);
    if (field.ownership === 'SKU' && !getEditor().selectedSkuKeys.includes(sku)) throw new Error('该属性不属于当前草稿 SKU');
    const cleared = value === '' || value === null || Array.isArray(value) && !value.length;
    const item = { attributeId: field.attributeId, ...(field.ownership === 'SKU' ? { skuKey: sku } : {}),
      action: cleared ? 'CLEAR' : 'SET', ...(cleared ? {} : { value, ...(ids ? { dictionaryValueIds: ids.slice() } : {}) }),
      evidence: ['用户在扩展工作台确认官方属性值与选项'] };
    edits.set(leafKey(field.attributeId, field.ownership === 'SKU' ? sku : null), item);
    onDirty(fieldKey(field.attributeId)); renderState(); onChanged(rebuild);
  }
  function typed(field, value) {
    if (value === '') return '';
    if (field.cardinality === 'MULTI') return parseCollectionFieldValue(value, field.maxValues);
    if (['INTEGER', 'DECIMAL'].includes(field.valueType)) {
      const number = Number(value);
      if (!Number.isFinite(number) || field.valueType === 'INTEGER' && !Number.isInteger(number)) throw new Error('请填写符合官方字段要求的数字');
      return number;
    }
    if (field.valueType === 'BOOLEAN') {
      if (!['true', 'false'].includes(String(value))) throw new Error('请填写 true 或 false');
      return value === 'true';
    }
    if (field.valueType === 'JSON') return JSON.parse(value);
    return value;
  }
  async function load(force = false, clearAfterSave = false) {
    if (loadTask) {
      const pending = loadTask;
      await pending.promise;
      if (pending.basis === token() && !clearAfterSave) return;
    }
    const data = getEditor();
    if (!data?.category || loading || getBusy() && !clearAfterSave) return;
    const basis = token();
    if (!force && requestedToken === basis) return;
    requestedToken = basis; loading = true;
    const task = { basis, promise: null };
    task.promise = Promise.resolve().then(async () => {
      const reply = await send('EDITOR_ATTRIBUTES', { listingWorkflowId: data.binding.listingWorkflowId, binding: getBinding() });
      const value = reply.data?.workspace;
      if (reply.data?.state !== 'ready' || !value || !Array.isArray(value.fields) || !Array.isArray(value.values) || !/^[a-f0-9]{64}$/u.test(value.schemaRevision || '') || basis !== token()) throw new Error('官方属性与当前草稿不一致，请刷新官方属性');
      if (workspace && workspace.schemaRevision !== value.schemaRevision || clearAfterSave) {
        if (!clearAfterSave && edits.size) status('官方字段已更新，旧属性编辑需重新填写', 'warn');
        edits.clear(); onReset();
      }
      workspace = value; loadedToken = basis;
    }).finally(() => {
      if (loadTask === task) { loadTask = null; loading = false; renderState(); onChanged(true); }
    });
    loadTask = task;
    renderState(); onChanged(true);
    return task.promise;
  }
  function renderState() {
    const data = getEditor();
    save.disabled = !current() || loading || getBusy() || !edits.size;
    refresh.disabled = !data?.category || loading || getBusy();
    state.textContent = loading ? '正在读取官方属性…' : workspace && current()
      ? `${workspace.fields.length} 个官方字段 · ${edits.size} 项待保存；只读字段由 ERP 自动关联。`
      : data?.category ? '需要读取当前草稿的官方字段。' : '选择官方类目后读取商品属性。';
  }
  function selectedSku(row) { return getEditor()?.selectedSkuKeys[row - 1]; }
  async function searchDictionary() {
    const captured = dialog;
    assertEditable(captured?.field, captured?.token);
    if (query.value.length > 200) throw new Error('字典查询最多 200 个字符');
    apply.disabled = true; search.disabled = true;
    try {
      const reply = await send('EDITOR_DICTIONARY', { listingWorkflowId: getBinding().listingWorkflowId, binding: getBinding(),
        schemaRevision: workspace.schemaRevision, attributeId: captured.field.attributeId, query: query.value.trim(), limit: 100 });
      const result = reply.data?.dictionary;
      if (dialog !== captured || captured.token !== token() || reply.data?.state !== 'ready' || !result || result.schemaRevision !== workspace.schemaRevision
        || result.attributeId !== captured.field.attributeId || !Array.isArray(result.values)) throw new Error('官方字典已变化，请重新打开');
      list.replaceChildren();
      for (const entry of result.values) {
        const label = make('label', 'field'), input = make('input'); input.type = captured.field.cardinality === 'MULTI' ? 'checkbox' : 'radio';
        input.name = 'official-attribute-choice'; input.dataset.dictionaryId = String(entry.id); input.checked = captured.selected.has(entry.id);
        input.addEventListener('change', () => {
          if (input.checked) {
            if (captured.field.cardinality === 'SINGLE') captured.selected.clear();
            if (!captured.selected.has(entry.id) && captured.selected.size >= captured.field.maxValues) { input.checked = false; message.textContent = `最多选择 ${captured.field.maxValues} 项`; return; }
            captured.selected.set(entry.id, entry.value);
          } else captured.selected.delete(entry.id);
          message.textContent = `已选 ${captured.selected.size} 项；确认选项后再保存商品属性。`;
        });
        label.append(input, document.createTextNode(entry.value)); list.append(label);
      }
      message.textContent = result.hasMore || result.resultTruncated ? '当前检索结果不完整，可继续搜索；已选项会保留。' : '选项来自官方字典，确认后再保存商品属性。';
      apply.disabled = false;
    } finally { search.disabled = false; }
  }
  async function openDictionary({ attributeId, rowIndex }) {
    const field = fieldById(attributeId); assertEditable(field);
    const sku = field.ownership === 'SKU' ? selectedSku(rowIndex) : null;
    const value = leaf(field, sku), labels = Array.isArray(value.value) ? value.value : [value.value];
    dialog = { field, sku, token: token(), selected: new Map((value.dictionaryValueIds || []).map((id, index) => [id, String(labels[index] ?? id)])) };
    title.textContent = `${field.name}${sku ? ' · ' + sku : ' · 全商品统一值'}`;
    query.value = ''; list.replaceChildren(); modal.hidden = false; apply.disabled = true;
    await searchDictionary();
  }
  search.addEventListener('click', (event) => { if (event.isTrusted) void searchDictionary().catch(report); });
  apply.addEventListener('click', (event) => {
    if (!event.isTrusted || apply.disabled) return;
    try {
      const captured = dialog; assertEditable(captured?.field, captured?.token);
      const pairs = [...captured.selected.entries()];
      change(captured.field, captured.sku, captured.field.cardinality === 'MULTI' ? pairs.map((entry) => entry[1]) : pairs[0]?.[1] || '', pairs.map((entry) => entry[0]));
      modal.hidden = true; dialog = null;
    } catch (error) { report(error); }
  });
  textApply.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    try { assertEditable(textContext?.field, textContext?.token); change(textContext.field, textContext.sku, typed(textContext.field, textArea.value)); textModal.hidden = true; }
    catch (error) { report(error); }
  });
  refresh.addEventListener('click', (event) => { if (event.isTrusted && !refresh.disabled) void load(true).catch(report); });
  save.addEventListener('click', (event) => {
    if (!event.isTrusted || save.disabled) return;
    void Promise.resolve().then(() => {
      if (edits.size > 500) throw new Error('一次最多保存 500 项属性变更，请减少本次编辑后再保存');
      return onSave({ schemaRevision: workspace.schemaRevision, changes: [...edits.values()].map((value) => structuredClone(value)) });
    }).catch(report);
  });
  return {
    bar, load, renderState,
    afterSave: () => load(true, true),
    currentSchemaRevision: () => current() ? workspace.schemaRevision : null,
    signature: () => JSON.stringify([loadedToken, token(), workspace?.schemaRevision, loading, getBusy()]),
    fieldValues(sku) {
      if (!getEditor()?.category) return {};
      return Object.fromEntries((workspace?.fields || []).map((field) => [fieldKey(field.attributeId), displayValue(leaf(field, sku).value)]));
    },
    templateMeta() {
      if (!workspace || !getEditor()?.category) return null;
      const fieldMeta = Object.fromEntries(baseFields.map(([key, type, required]) => [key, { editorLabel: key, valueKind: 'numeric', required, editable: true, _systemFieldType: type }]));
      for (const field of workspace.fields) {
        fieldMeta[fieldKey(field.attributeId)] = { attributeId: field.attributeId, editorLabel: field.name, required: field.required, _isAspect: field.ownership === 'SKU',
          valueKind: ['INTEGER', 'DECIMAL'].includes(field.valueType) ? 'numeric' : 'text', editable: editable(field) && current() && !getBusy(),
          displayReadOnly: true, isCollection: field.cardinality === 'MULTI', maxValues: field.maxValues,
          officialDictionary: field.dictionaryId !== null && field.valuePolicy !== 'FREE_TEXT',
          openDictionary: (value) => { void openDictionary(value).catch(report); } };
      }
      return { editorOrder: [...baseFields.map(([key]) => key), ...workspace.fields.map((field) => fieldKey(field.attributeId))], fieldMeta };
    },
    handleChange(changeEvent) {
      if (!String(changeEvent.fieldKey || '').startsWith('official-')) return false;
      const field = fieldById(Number(changeEvent.fieldKey.slice(9))); assertEditable(field);
      if (field.dictionaryId !== null && field.valuePolicy !== 'FREE_TEXT') {
        if (changeEvent.scope !== 'allRows') throw new Error('请使用官方字典选择属性');
        const original = leaf(field, selectedSku(1));
        for (const sku of field.ownership === 'SKU' ? getEditor().selectedSkuKeys : [null]) change(field, sku, original.value, original.dictionaryValueIds, false);
      } else {
        const value = typed(field, changeEvent.value);
        const skus = field.ownership !== 'SKU' ? [null] : changeEvent.scope === 'allRows' ? getEditor().selectedSkuKeys : [selectedSku(changeEvent.rowIndex)];
        skus.forEach((sku) => change(field, sku, value, undefined, false));
      }
      return true;
    },
    openText(value) {
      const field = fieldById(Number(String(value.fieldKey).slice(9))); assertEditable(field);
      textContext = { field, sku: field.ownership === 'SKU' ? selectedSku(value.rowIndex) : null, token: token() };
      textTitle.textContent = field.name; textArea.value = displayValue(leaf(field, textContext.sku).value); textModal.hidden = false;
    },
    reset() { workspace = null; loadedToken = requestedToken = ''; edits.clear(); modal.hidden = textModal.hidden = true; onReset(); renderState(); },
  };
}
