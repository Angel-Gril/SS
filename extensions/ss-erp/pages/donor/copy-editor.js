export function createCopyEditor({ root, getEditor, getBinding, getSourceTitle, getBusy, reloadEditor, saveEditor, onDirty, onReset, report }) {
  const make = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const binding = () => { try { return getBinding(); } catch { return null; } };
  const token = () => JSON.stringify(binding());
  const identity = () => { const value = binding(); return value ? JSON.stringify([value.snapshotId, value.supplyGoodsId, value.shopId, value.listingWorkflowId]) : ''; };
  let context = '', selected = null, opening = false;
  const dirty = new Set();
  const modal = make('div', 'settings-modal'); modal.id = 'precision-copy-modal'; modal.hidden = true;
  const card = make('div', 'settings-dialog'), head = make('div', 'settings-head'); head.append(make('div', 'settings-title', '俄文标题与描述 · 手工编辑和审核'));
  const close = make('button', 'ghost', '关闭'); close.id = 'precision-copy-close'; close.addEventListener('click', () => { modal.hidden = true; }); head.append(close);
  const body = make('div', 'settings-body'), source = make('p'), notice = make('p', '', '文案统一用于当前草稿所有 SKU。保存后先预览待审核内容，再明确审核。');
  const titleLabel = make('label', 'field', '俄文标题'), title = make('textarea'); title.id = 'precision-copy-title';
  const descriptionLabel = make('label', 'field', '俄文描述'), description = make('textarea'); description.id = 'precision-copy-description';
  titleLabel.style.cssText = descriptionLabel.style.cssText = 'display:grid;gap:8px;';
  for (const input of [title, description]) input.style.cssText = 'width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:10px;padding:10px;resize:vertical;font-family:inherit;font-size:14px;line-height:1.5;letter-spacing:normal;';
  title.style.minHeight = '88px'; description.style.minHeight = '150px';
  titleLabel.append(title); descriptionLabel.append(description);
  const save = make('button', 'primary', '保存为待审核文案'); save.id = 'precision-copy-save';
  const state = make('p'); state.id = 'precision-copy-state'; state.setAttribute('role', 'status');
  const candidates = make('div'); const review = make('div'); review.id = 'precision-copy-review';
  const approve = make('button', 'primary', '确认所示文案并审核'); approve.id = 'precision-copy-approve';
  body.append(source, notice, titleLabel, descriptionLabel, save, state, candidates, review, approve);
  card.append(head, body); modal.append(card); root.append(modal);
  const candidate = () => getEditor()?.copy?.pendingCandidates.find((item) => item.id === selected?.id);
  function reviewCurrent() { const value = candidate(); return value && value.sourceCurrent === true && selected.token === token() && selected.contents === JSON.stringify(value); }
  function finalCopy(value) {
    const current = getEditor()?.copy;
    return { titleRu: value.fields.includes('title') ? value.titleRu : current?.titleRu,
      descriptionRu: value.fields.includes('description') ? value.descriptionRu : current?.descriptionRu };
  }
  function select(value) { selected = { id: value.id, token: token(), contents: JSON.stringify(value) }; sync(); }
  function sync() {
    const key = identity();
    if (context && context !== key) { modal.hidden = true; selected = null; dirty.clear(); onReset(); }
    context = key;
    const data = getEditor();
    const value = candidate();
    source.textContent = `采集标题：${getSourceTitle() || '尚未读取'}`;
    if (data?.copy) {
      const copy = value ? finalCopy(value) : data.copy;
      if (!dirty.has('title')) title.value = copy.titleRu ?? '';
      if (!dirty.has('description')) description.value = copy.descriptionRu ?? '';
    }
    title.readOnly = description.readOnly = !data?.copy || opening || getBusy();
    save.disabled = !data?.copy || !dirty.size || opening || getBusy();
    approve.disabled = !reviewCurrent() || dirty.size > 0 || opening || getBusy();
    state.textContent = opening || !data?.copy ? '正在读取当前草稿文案。' : dirty.size ? '有手工编辑尚未保存。'
      : data.copy.pendingCandidates.length ? '待审核文案已保存，选择下方候选预览后审核。'
      : data.copy.titleRu ? '俄文文案已审核，可继续校验上架信息。' : '请准备俄文标题与描述。';
    candidates.replaceChildren();
    for (const item of data?.copy?.pendingCandidates || []) {
      const button = make('button', 'ghost', item.sourceCurrent ? `预览待审核文案 ${item.id}` : '来源已变化 · 此候选不可审核');
      button.dataset.copyCandidate = item.id; button.disabled = !item.sourceCurrent || opening || getBusy();
      button.addEventListener('click', (event) => { if (event.isTrusted && !button.disabled) select(item); });
      candidates.append(button);
    }
    review.replaceChildren();
    if (value) {
      const content = finalCopy(value);
      review.append(make('h4', '', '本次审核将使用的完整文案'), make('p', '', content.titleRu ?? '尚无俄文标题'));
      const text = make('pre', '', content.descriptionRu ?? '无描述'); text.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;font-family:inherit;letter-spacing:normal;'; review.append(text);
      if (!reviewCurrent()) review.append(make('p', '', '草稿或候选已变化，请重新选择并预览后再审核。'));
    }
  }
  title.addEventListener('input', () => { dirty.add('title'); onDirty('copy.title'); sync(); });
  description.addEventListener('input', () => { dirty.add('description'); onDirty('copy.description'); sync(); });
  save.addEventListener('click', (event) => {
    if (!event.isTrusted || save.disabled) return;
    void Promise.resolve().then(async () => {
      const value = {};
      if (dirty.has('title')) {
        if (!title.value.trim() || title.value.length > 500) throw new Error('俄文标题须填写内容，最多 500 个字符，不会自动截断');
        value.titleRu = title.value;
      }
      if (dirty.has('description')) {
        if (description.value.length > 10000) throw new Error('编辑后的俄文描述最多 10000 个字符，请手动缩短；未编辑的旧描述会保留');
        value.descriptionRu = description.value.trim() ? description.value : null;
      }
      await saveEditor('COPY_CANDIDATE', value);
    }).catch(report);
  });
  approve.addEventListener('click', (event) => {
    if (!event.isTrusted || approve.disabled) return;
    void Promise.resolve().then(async () => {
      if (!reviewCurrent()) throw new Error('草稿或候选已变化，请重新预览');
      await saveEditor('COPY_APPROVE', { candidateId: selected.id });
    }).catch(report);
  });
  return {
    sync,
    async open() {
      if (!binding()) throw new Error('请先创建当前店铺草稿');
      modal.hidden = false; opening = true; sync();
      try { await reloadEditor(); } finally { opening = false; sync(); }
    },
    afterSave(action, response) {
      if (!['COPY_CANDIDATE', 'COPY_APPROVE'].includes(action)) return;
      dirty.clear(); onReset();
      if (action === 'COPY_APPROVE') selected = null;
      else {
        const value = getEditor()?.copy?.pendingCandidates.find((item) => item.id === response?.candidateId);
        if (value) selected = { id: value.id, token: token(), contents: JSON.stringify(value) };
      }
      sync();
    },
    reset() { context = ''; selected = null; dirty.clear(); onReset(); modal.hidden = true; },
  };
}
