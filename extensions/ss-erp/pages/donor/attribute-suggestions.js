export function createAttributeSuggestions({
  root,
  command,
  getBinding,
  getBusy,
  hasUnsavedAttributes = () => false,
  getSkuLabel,
  onApply,
  onSaved,
  onManual,
  report,
}) {
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const modal = make('div', 'settings-modal');
  modal.id = 'precision-attribute-suggestions-modal';
  modal.hidden = true;
  const dialog = make('div', 'settings-dialog precision-attribute-suggestions-dialog'),
    head = make('div', 'settings-head');
  head.append(make('div', 'settings-title', '自动匹配商品属性'));
  const close = make('button', 'ghost', '关闭');
  close.id = 'precision-attribute-suggestions-close';
  close.addEventListener('click', () => {
    if (close.disabled) return;
    epoch += 1;
    modal.hidden = true;
    data = null;
  });
  head.append(close);
  const body = make('div', 'settings-body'),
    note = make(
      'p',
      '',
      '依据当前采集资料和官方选项匹配。检查各 SKU 的值与来源后，确认应用；未匹配的属性仍可手工补充。',
    ),
    list = make('div'),
    state = make('p');
  state.id = 'precision-attribute-suggestions-state';
  state.setAttribute('role', 'status');
  const apply = make('button', 'primary', '确认应用选中属性');
  apply.id = 'precision-attribute-suggestions-apply';
  const foot = make('div', 'settings-foot');
  const manual = make('button', 'ghost', '改为手工补充');
  manual.id = 'precision-attribute-suggestions-manual';
  manual.hidden = typeof onManual !== 'function';
  foot.append(manual, apply);
  body.append(note, list, state);
  dialog.append(head, body, foot);
  modal.append(dialog);
  root.append(modal);
  let token = '',
    data = null,
    opening = false,
    applying = false,
    epoch = 0;
  const context = () => {
    try {
      return JSON.stringify(getBinding());
    } catch {
      return '';
    }
  };
  const identity = (binding) => {
    try {
      const value = typeof binding === 'string' ? JSON.parse(binding) : binding;
      return JSON.stringify(['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].map((key) => value[key]));
    } catch { return ''; }
  };
  const unsavedMessage = '有商品属性编辑尚未保存，请先保存后再自动匹配。';
  function invalidate() {
    epoch += 1;
    modal.hidden = true;
    data = null;
    opening = false;
    state.textContent = '草稿或官方属性已变化，请重新读取自动匹配。';
    report(new Error(state.textContent));
  }
  const selected = () =>
    [...list.querySelectorAll('input:checked')].map(
      (input) => data.suggestions[Number(input.value)],
    );
  function sync() {
    if (modal.hidden) return;
    const stale = applying ? identity(context()) !== identity(token) : context() !== token;
    if (stale) { invalidate(); return; }
    close.disabled = applying;
    apply.disabled = getBusy() || hasUnsavedAttributes() || opening || applying || !data || !selected().length;
    manual.disabled = getBusy() || hasUnsavedAttributes() || opening || applying || !data;
    if (hasUnsavedAttributes()) state.textContent = unsavedMessage;
  }
  manual.addEventListener('click', (event) => {
    if (!event.isTrusted || manual.disabled || modal.hidden || !data || typeof onManual !== 'function') return;
    if (context() !== token || hasUnsavedAttributes() || getBusy() || opening || applying) { sync(); return; }
    modal.hidden = true;
    epoch += 1;
    data = null;
    onManual();
  });
  apply.addEventListener('click', (event) => {
    if (!event.isTrusted || apply.disabled) return;
    const attempt = epoch, basis = token;
    applying = true;
    sync();
    void Promise.resolve()
      .then(async () => {
        if (attempt !== epoch || context() !== basis) throw Error('草稿已变化，请重新读取候选');
        if (hasUnsavedAttributes()) throw Error(unsavedMessage);
        if (getBusy()) throw Error('请等待当前操作完成后再应用属性');
        const candidates = selected().map(
          ({ attributeId, candidateId, candidateHash, schemaRevision }) => ({
            attributeId,
            candidateId,
            candidateHash,
            schemaRevision,
          }),
        );
        await onApply({ schemaRevision: data.workspace.schemaRevision, candidates });
        if (attempt !== epoch || identity(context()) !== identity(basis)) return;
        modal.hidden = true;
        onSaved?.();
      })
      .catch((error) => {
        if (attempt !== epoch) return;
        state.textContent = error.message;
        report(error);
      })
      .finally(() => {
        applying = false;
        close.disabled = false;
        if (attempt === epoch) sync();
      });
  });
  return {
    sync,
    async open() {
      if (hasUnsavedAttributes()) throw Error(unsavedMessage);
      if (getBusy() || applying) throw Error('请等待当前操作完成后再自动匹配');
      const basis = context();
      if (!basis) throw Error('请先创建草稿并确认官方类目');
      const attempt = ++epoch;
      token = basis;
      modal.hidden = false;
      opening = true;
      data = null;
      list.replaceChildren();
      state.textContent = '正在匹配采集资料与官方属性…';
      sync();
      try {
        const binding = getBinding(),
          reply = await command('EDITOR_ATTRIBUTE_SUGGESTIONS', {
            binding,
            listingWorkflowId: binding.listingWorkflowId,
          });
        if (attempt !== epoch || modal.hidden) return;
        if (basis !== context()) { invalidate(); return; }
        data = reply.data?.suggestions;
        if (!data || data.state !== 'ready') throw Error('属性匹配响应不完整');
        data.suggestions.forEach((candidate, index) => {
          const card = make('section', 'precision-attribute-suggestion');
          const label = make('label'),
            checkbox = make('input');
          checkbox.type = 'checkbox';
          checkbox.value = String(index);
          checkbox.checked = candidate.rows.every((row) => !row.unresolvedValues.length);
          checkbox.dataset.attributeCandidate = candidate.candidateId;
          checkbox.addEventListener('change', sync);
          label.append(checkbox, make('strong', '', candidate.attributeName));
          card.append(label);
          for (const row of candidate.rows) {
            card.append(
              make(
                'p',
                '',
                `${row.skuKey ? getSkuLabel(row.skuKey) : '所有 SKU'}：${JSON.stringify(row.value)}`,
              ),
            );
            const details = make('details'),
              summary = make('summary', '', '来源依据');
            details.append(summary);
            for (const evidence of row.evidence)
              details.append(
                make('div', '', `${evidence.path}：${JSON.stringify(evidence.value)}`),
              );
            card.append(details);
            if (row.unresolvedValues.length)
              card.append(
                make(
                  'p',
                  'precision-attribute-warning',
                  '部分值未匹配官方选项，应用后仍需补齐：' + JSON.stringify(row.unresolvedValues),
                ),
              );
          }
          list.append(card);
        });
        for (const blocked of data.blockedSuggestions)
          list.append(
            make(
              'p',
              'precision-attribute-warning',
              `${blocked.attributeName}：${blocked.message}`,
            ),
          );
        state.textContent = data.suggestions.length
          ? `已匹配 ${data.suggestions.length} 组属性，请确认后应用。`
          : '没有可安全匹配的属性，请在当前表格补充。';
      } catch (error) {
        if (attempt !== epoch || modal.hidden) return;
        state.textContent = error.message;
        report(error);
      } finally {
        if (attempt === epoch) { opening = false; sync(); }
      }
    },
  };
}
