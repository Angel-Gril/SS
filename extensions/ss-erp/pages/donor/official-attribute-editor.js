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

// 单个属性读取最多等这么久；超时视为那次请求已死，重置状态让用户能重试。
// ERP 的 EDITOR_ATTRIBUTES 在草稿刚建/刚改类目时会长时间不返回。
const LOAD_WAIT_CAP_MS = 45000;

export function createOfficialAttributeEditor({ root, send, getEditor, getBinding, getBusy, onSave, onDirty, onReset, onChanged, report, status }) {
  const make = (tag, className, text) => {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  };
  let workspace = null, loadedToken = '', requestedToken = '', loading = false, dialog = null;
  let loadTask = null;
  const edits = new Map();
  const token = () => {
    try {
      const binding = getBinding(), category = getEditor()?.category;
      return JSON.stringify([
        ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion'].map(key => binding?.[key]),
        [category?.categoryId, category?.typeId, category?.catalogRevision],
      ]);
    } catch { return ''; }
  };
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
      // 2026-11：这里原来是无条件 await pending.promise。
      // 一旦某次 EDITOR_ATTRIBUTES 因为 ERP 侧不响应而悬挂，loadTask 永远不会
      // 被 finally 清掉，之后每次 load() 都 await 这个死掉的 promise ——
      // 界面永久停在「正在读取官方属性并预填…」，而且一条命令都不再发出
      // （实测 hook sendMessage 后 __cmdLog 为空）。
      // 加一个有上限的等待：等不到就放弃这次合并，自己重新发。
      const settled = await Promise.race([
        pending.promise.then(() => true).catch(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), LOAD_WAIT_CAP_MS)),
      ]);
      if (!settled) {
        if (loadTask === pending) { loadTask = null; loading = false; }
        throw new Error('读取官方属性超时（' + Math.round(LOAD_WAIT_CAP_MS / 1000) + ' 秒未响应，已重置，请重试）');
      }
      if (pending.basis === token() && !clearAfterSave) return;
    }
    const data = getEditor();
    if (!data?.category || loading || getBusy() && !clearAfterSave) return;
    const basis = token();
    const binding = { ...getBinding() };
    if (!force && requestedToken === basis) return;
    requestedToken = basis; loading = true;
    const task = { basis, promise: null };
    task.promise = Promise.resolve().then(async () => {
      if (basis !== token()) return;
      let reply;
      try { reply = await send('EDITOR_ATTRIBUTES', { listingWorkflowId: data.binding.listingWorkflowId, binding }); }
      catch (error) { if (basis !== token()) return; throw error; }
      // Superseded reads are discarded. A caller awaiting the new revision
      // continues with its own bound read instead of inheriting a stale error.
      if (basis !== token()) return;
      const value = reply.data?.workspace;
      if (reply.data?.state !== 'ready' || !value || !Array.isArray(value.fields) || !Array.isArray(value.values) || !/^[a-f0-9]{64}$/u.test(value.schemaRevision || '')) throw new Error('官方属性读取未完成，请重新读取官方属性');
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
  search.addEventListener('click', (event) => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) void searchDictionary().catch(report); });
  apply.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || apply.disabled) return;
    try {
      const captured = dialog; assertEditable(captured?.field, captured?.token);
      const pairs = [...captured.selected.entries()];
      change(captured.field, captured.sku, captured.field.cardinality === 'MULTI' ? pairs.map((entry) => entry[1]) : pairs[0]?.[1] || '', pairs.map((entry) => entry[0]));
      modal.hidden = true; dialog = null;
    } catch (error) { report(error); }
  });
  textApply.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target)) return;
    try { assertEditable(textContext?.field, textContext?.token); change(textContext.field, textContext.sku, typed(textContext.field, textArea.value)); textModal.hidden = true; }
    catch (error) { report(error); }
  });
  refresh.addEventListener('click', (event) => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) && !refresh.disabled) void load(true).catch(report); });
  save.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || save.disabled) return;
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
    // 2026-11：本地属性预填。
    // 类目确定后 shared/ozon/attribute-prefill.js 会给出「有确定性依据」的
    // 若干条 change（制造国=中国、类目唯一类型、材质/受众由标题推得）。
    // 这里把它们塞进 edits，显示为「待保存」，用户核对后点「保存商品属性」提交。
    // 不直接调保存：预填只是候选，不能替用户提交官方字段。
    // 供本地预填读取当前官方字段定义（含 name / dictionaryId / valuePolicy /
    // editorMode / ownership），这些是 attribute-prefill 生成计划所必需的。
    getFields() { return workspace && Array.isArray(workspace.fields) ? workspace.fields.slice() : []; },
    getSchemaRevision() { return workspace ? workspace.schemaRevision : ''; },
    hasLoaded() { return current() && Boolean(workspace); },
    applyPrefill(changes) {
      if (!current()) return { applied: 0, skipped: 0, reason: '官方属性尚未加载' };
      if (!Array.isArray(changes) || !changes.length) return { applied: 0, skipped: 0, reason: '无可预填项' };
      let applied = 0, skipped = 0;
      const details = [];
      for (const item of changes) {
        try {
          const field = fieldById(Number(item.attributeId));
          if (!field) { skipped++; details.push({ id: item.attributeId, why: '该类目无此字段' }); continue; }
          if (!editable(field)) { skipped++; details.push({ id: item.attributeId, why: '字段只读' }); continue; }
          change(field, item.skuKey == null ? null : item.skuKey, item.value,
            Array.isArray(item.dictionaryValueIds) ? item.dictionaryValueIds : [], false);
          applied++;
          details.push({ id: item.attributeId, name: field.name, value: item.value, source: item.source || '' });
        } catch (error) {
          skipped++;
          details.push({ id: item.attributeId, why: String(error && error.message || error).slice(0, 80) });
        }
      }
      renderState();
      if (applied) status(`已预填 ${applied} 个官方字段，请核对后保存`, 'ok');
      return { applied, skipped, details };
    },
    reset() { workspace = null; loadedToken = requestedToken = ''; edits.clear(); modal.hidden = textModal.hidden = true; onReset(); renderState(); },
  };
}
