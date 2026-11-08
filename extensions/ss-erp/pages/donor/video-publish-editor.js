import { createInlineConfirmation } from './inline-confirmation.js';

const copy = value => JSON.parse(JSON.stringify(value));
const identity = value => JSON.stringify(value);
const sameTarget = (a, b) => a && b && ['snapshotId','supplyGoodsId','shopId','listingWorkflowId'].every(key => a[key] === b[key]);
function readResult(response, expected, save) {
  const value = response?.data || response;
  if (value?.state !== 'ready' || !sameTarget(value.binding, expected) || !Array.isArray(value.videoBindings)
    || value.videoBindings.length > 202 || !Number.isSafeInteger(value.binding.draftRevision) || !Number.isSafeInteger(value.binding.draftVersion)
    || (save ? value.binding.draftRevision !== expected.draftRevision + 1 || value.binding.draftVersion !== expected.draftVersion + 1
      : value.binding.draftRevision !== expected.draftRevision || value.binding.draftVersion !== expected.draftVersion)) {
    throw Object.assign(new Error('视频草稿响应不完整，请重新读取'), { outcome: save ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED' });
  }
  return value;
}

export function createVideoPublishFlow({ getBinding, getSkuKey, command, onState = () => {}, onSaved = () => {} }) {
  let view = { busy: false, unknown: false, error: '', binding: null, videoBindings: [], saved: false };
  let readContext = null, pending = null;
  const context = () => ({ binding: getBinding(), skuKey: getSkuKey() });
  const emit = changes => { view = { ...view, ...changes }; onState({ ...view }); };
  async function sendSave(request) {
    emit({ busy: true, error: '' });
    try {
      const result = readResult(await command('VIDEO_SAVE', { request: copy(request) }), request.binding, true);
      pending = null; emit({ unknown: false, saved: true, ...result });
      try { await onSaved(result); } catch { emit({ error: '视频已保存，草稿刷新暂未完成，请重新读取。' }); }
      readContext = { binding: copy(result.binding), skuKey: request.skuKey };
      return true;
    } catch (error) {
      const unknown = error.outcome !== 'NOT_SUBMITTED';
      if (!unknown) pending = null;
      emit({ unknown, error: unknown ? '保存结果待核对，请核对原请求，不要重复保存。' : error.message });
      return false;
    } finally { emit({ busy: false }); }
  }
  return {
    state: () => ({ ...view }),
    async read() {
      if (view.busy || view.unknown) return false;
      const before = context();
      if (!before.binding) { emit({ error: '请先创建当前店铺草稿。' }); return false; }
      emit({ busy: true, error: '', saved: false });
      try {
        const result = readResult(await command('VIDEO_READ', { request: { binding: copy(before.binding) } }), before.binding, false);
        if (identity(context()) !== identity(before)) throw new Error('草稿或 SKU 已变化，请重新打开视频设置。');
        readContext = copy(before); emit(result); return true;
      } catch (error) { emit({ error: error.message }); return false; }
      finally { emit({ busy: false }); }
    },
    async save({ mainUrl, richContentUrl }) {
      if (view.busy || view.unknown) return false;
      if (!readContext || identity(context()) !== identity(readContext)) {
        emit({ error: '草稿或 SKU 已变化，请重新读取。' }); return false;
      }
      if ([mainUrl, richContentUrl].some(value => value !== null && (typeof value !== 'string' || value.length > 4096))) {
        emit({ error: '视频地址过长或格式不完整。' }); return false;
      }
      pending = { binding: copy(readContext.binding), skuKey: readContext.skuKey,
        mainUrl, richContentUrl, operationKey: `video-${crypto.randomUUID()}` };
      return sendSave(pending);
    },
    async replay() {
      if (!pending || !view.unknown || view.busy) return false;
      const now = context();
      if (!sameTarget(now.binding, pending.binding) || now.skuKey !== pending.skuKey) {
        emit({ error: '原视频请求属于另一草稿或 SKU，请返回原草稿核对。' }); return false;
      }
      return sendSave(pending);
    },
  };
}

export function createVideoPublishEditor({ root, command, getBinding, getSkuKey, getBusy = () => false, onSelectSku,
  getSourceVideos = () => [], openSourceVideo, onSaved, onMessage = () => {}, confirmAction }) {
  const doc = root.ownerDocument;
  const make = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
  const modal = make('section', 'settings-modal precision-video-publish-modal'); modal.id = 'precision-video-publish-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'precision-video-publish-title');
  const dialog = make('div', 'settings-dialog');
  const head = make('header', 'settings-head'); const title = make('strong', '', '主图与富内容视频'); title.id = 'precision-video-publish-title';
  const close = make('button', 'ghost', '关闭'); close.id = 'precision-video-publish-close'; head.append(title, close);
  const body = make('div', 'settings-body');
  body.append(make('p', '', '确认视频内容后保存到当前 SKU 草稿；上传 Ozon 时会连同商品提交。清空地址可移除相应视频。'));
  const fields = [];
  for (const [id, label] of [['main', '主图视频'], ['rich', '富内容视频']]) {
    const row = make('label', 'precision-video-field', label); const input = make('input'); input.id = `precision-video-${id}-url`;
    input.type = 'url'; input.maxLength = 4096; input.placeholder = '粘贴已上传到 Ozon 的视频地址'; row.append(input); body.append(row); fields.push(input);
  }
  body.append(make('p', 'precision-video-help', '支持 Ozon 官方视频和临时媒体地址。1688 等来源视频可先预览；未经上传的来源地址不能直接提交到 Ozon。'));
  const previewSource = make('button', 'ghost', '预览采集视频'); previewSource.id = 'precision-video-source-preview'; body.append(previewSource);
  const notice = make('p'); notice.id = 'precision-video-publish-state'; notice.setAttribute('role', 'status'); body.append(notice);
  const foot = make('footer', 'settings-foot'); const read = make('button', 'ghost', '重新读取'); read.id = 'precision-video-read';
  const replay = make('button', 'ghost', '核对上次保存'); replay.id = 'precision-video-replay'; replay.hidden = true;
  const save = make('button', 'primary', '保存视频'); save.id = 'precision-video-save'; foot.append(read, replay, save);
  dialog.append(head, body, foot); modal.append(dialog); root.append(modal);
  const confirmation = createInlineConfirmation({ container: body, make });
  const ask = confirmAction || (options => confirmation.request(options));
  let opener = null, displayedBinding = '';
  const flow = createVideoPublishFlow({ getBinding, getSkuKey, command, onSaved,
    onState: state => {
      confirmation.sync(JSON.stringify([state.binding, getSkuKey(), fields.map(field => field.value.trim())]));
      save.disabled = state.busy || state.unknown || !state.binding || getBusy(); read.disabled = state.busy || state.unknown || getBusy();
      replay.hidden = !state.unknown; replay.disabled = state.busy || getBusy();
      close.disabled = state.busy; fields.forEach(input => { input.disabled = state.busy || state.unknown; });
      notice.textContent = state.error || (state.busy ? '正在处理视频草稿…' : state.saved ? '视频已保存到草稿，尚未提交 Ozon。' : '请确认当前 SKU 的视频内容和地址。');
      const next = state.binding && identity(state.binding);
      if (next && next !== displayedBinding && !state.busy) {
        displayedBinding = next;
        fields[0].value = state.videoBindings.find(item => item.skuKey === getSkuKey() && item.role === 'MAIN')?.url || '';
        fields[1].value = state.videoBindings.find(item => item.skuKey === getSkuKey() && item.role === 'RICH_CONTENT')?.url || '';
      }
    } });
  const act = (node, handler) => node.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || node.disabled) return;
    Promise.resolve().then(handler).catch(error => onMessage(error.message));
  });
  act(read, () => flow.read()); act(replay, () => flow.replay());
  act(save, async () => {
    const token = () => JSON.stringify([getBinding(), getSkuKey(), fields.map(field => field.value.trim())]);
    const frozenToken = token();
    if (await ask({ message: '确认视频内容并保存到当前 SKU 草稿？', detail: '本次不会提交 Ozon；清空地址会移除相应视频。', token: frozenToken, getToken: token, validate: () => frozenToken === token() })) {
      await flow.save({ mainUrl: fields[0].value.trim() || null, richContentUrl: fields[1].value.trim() || null });
    }
  });
  function hide() { if (flow.state().busy) return; confirmation.cancel(); modal.hidden = true; opener?.focus(); }
  act(close, hide);
  act(previewSource, () => { const source = getSourceVideos()[0]; if (source) { hide(); openSourceVideo?.(source); } });
  modal.addEventListener('click', event => { if (event.target === modal) hide(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    if (event.key !== 'Tab') return;
    const choices = [...modal.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(node => node.getClientRects().length);
    if (doc.activeElement === (event.shiftKey ? choices[0] : choices.at(-1))) { event.preventDefault(); (event.shiftKey ? choices.at(-1) : choices[0])?.focus(); }
  });
  return { flow, async open(skuKey, role, trigger) {
    if (getBusy()) return;
    onSelectSku(skuKey); opener = trigger || doc.activeElement; modal.hidden = false;
    previewSource.disabled = !getSourceVideos().length;
    if (!flow.state().unknown) { displayedBinding = ''; await flow.read(); }
    fields[role === 'RICH_CONTENT' ? 1 : 0].focus();
  } };
}
