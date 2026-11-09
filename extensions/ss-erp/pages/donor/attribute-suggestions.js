/**
 * 用直连把 ERP 报的 unresolvedValues 解析成官方 dictionary_value_id。
 *
 * ERP 的 attribute-suggestions 只做文本匹配，遇到 STRICT_DICTIONARY 字段就
 * 把值原样丢进 unresolvedValues，理由是「必须由服务器解析」——而它自己的
 * 解析器（EDITOR_DICTIONARY）在草稿刚建/刚改类目时会挂起，所以永远解析不了。
 *
 * Ozon 的 /v1/description-category/attribute/values 就是权威字典，直连即可。
 * 解析成功的值补进 row.dictionaryValueIds，并把该值从 unresolvedValues 移除，
 * 界面上的警告随之消失，勾选框也能真正勾上。
 */
async function resolveUnresolved(suggestions, ctx) {
  if (!suggestions || !Array.isArray(suggestions.suggestions)) return;
  const { categoryId, typeId, send } = ctx || {};
  const cid = Number(categoryId), tid = Number(typeId);
  if (!Number.isSafeInteger(cid) || !Number.isSafeInteger(tid) || cid <= 0 || tid <= 0) return;

  // attributeName → attributeId：ERP 的 candidate 只给名字，没有 id
  let nameToId = new Map();
  try {
    const schema = await send('ss-erp:direct-ozon-attributes', { categoryId: cid, typeId: tid });
    const fields = (schema && schema.fields) || [];
    for (const f of fields) nameToId.set(String(f.name || '').trim(), Number(f.attributeId));
  } catch (_e) { return; }

  for (const candidate of suggestions.suggestions) {
    const attributeId = nameToId.get(String(candidate.attributeName || '').trim());
    if (!Number.isSafeInteger(attributeId)) continue;
    for (const row of (candidate.rows || [])) {
      if (!row || !Array.isArray(row.unresolvedValues) || !row.unresolvedValues.length) continue;
      const stillUnresolved = [];
      row.dictionaryValueIds = Array.isArray(row.dictionaryValueIds) ? row.dictionaryValueIds : [];
      for (const raw of row.unresolvedValues) {
        const query = String(raw == null ? '' : raw).trim();
        if (!query) continue;
        try {
          const found = await send('ss-erp:direct-ozon-attribute-values', {
            categoryId: cid, typeId: tid, attributeId, query, limit: 50,
          });
          const values = (found && found.values) || [];
          // 复用主预填的匹配策略：唯一命中才接受，有歧义就不填
          const picked = pickBest(values, query);
          if (picked && !row.dictionaryValueIds.includes(picked.id)) {
            row.dictionaryValueIds.push(picked.id);
            row.resolvedByDirect = true;
          } else {
            stillUnresolved.push(raw);
          }
        } catch (_e) { stillUnresolved.push(raw); }
      }
      row.unresolvedValues = stillUnresolved;
    }
  }
}

/** 与 attribute-prefill 的 pickDictionaryValue 同策略：精确 > 词干 > 唯一包含 */
function pickBest(values, query) {
  const list = Array.isArray(values) ? values.filter(v => v && Number.isSafeInteger(v.id)) : [];
  if (!list.length) return null;
  const want = String(query).toLowerCase().replace(/\s+/g, ' ').trim();
  const eq = list.filter(v => String(v.value).toLowerCase().trim() === want);
  if (eq.length === 1) return eq[0];
  const stem = (s) => String(s).toLowerCase().replace(/[^а-яёa-z0-9]/gi, '')
    .replace(/(ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ых|их|ую|юю|а|я|о|е|ы|и|у|ю)$/u, '').slice(0, 12);
  const ws = stem(want);
  if (ws.length >= 3) {
    const byStem = list.filter(v => stem(v.value) === ws);
    if (byStem.length === 1) return byStem[0];
    if (byStem.length > 1) return byStem.slice().sort((a,b) => Math.abs(String(a.value).length-want.length) - Math.abs(String(b.value).length-want.length))[0];
  }
  const contains = list.filter(v => String(v.value).toLowerCase().includes(want) || (want.length >= 4 && want.includes(String(v.value).toLowerCase())));
  return contains.length === 1 ? contains[0] : null;
}

export function createAttributeSuggestions({
  root,
  command,
  getBinding,
  getEditor,
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
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || manual.disabled || modal.hidden || !data || typeof onManual !== 'function') return;
    if (context() !== token || hasUnsavedAttributes() || getBusy() || opening || applying) { sync(); return; }
    modal.hidden = true;
    epoch += 1;
    data = null;
    onManual();
  });
  apply.addEventListener('click', (event) => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || apply.disabled) return;
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
        // 2026-11：ERP 只做「从商品文本推候选属性」，遇到严格字典字段时它自己
        // 不解析，直接回 unresolvedValues，界面上就成了
        // "Strict dictionary values must be resolved by the server before they
        //  can be suggested" —— 用户点了也填不进任何东西。
        // 字典解析我们自己能用直连做（Ozon 的 attribute/values 接口），
        // 所以拿到 ERP 的候选后，在渲染前把未解析的值补成 dictionary_value_id。
        const __editor = typeof getEditor === 'function' ? getEditor() : null;
        await resolveUnresolved(data, {
          categoryId: __editor && __editor.category && __editor.category.categoryId,
          typeId: __editor && __editor.category && __editor.category.typeId,
          send: command,
        });
        if (attempt !== epoch || modal.hidden) return;
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
