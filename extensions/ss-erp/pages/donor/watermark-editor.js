const VERSION = 'extension-workbench-watermark/v1';
const copy = value => JSON.parse(JSON.stringify(value));
const identity = value => JSON.stringify(value);
function unwrap(response) {
  if (response?.ok === false || response?.code === 0) throw new Error(response.message || response.msg || '水印操作未完成');
  return response?.data || response;
}
/** UI command state only. Selection, pixels, billing and draft ownership remain server-owned. */
export function createWatermarkFlow({ command, getBinding, getItems, onState = () => {}, onApplied = () => {} }) {
  let value = { busy: false, unknown: false, error: '', preview: null, applied: 0 };
  let prepared = null; let applyRequest = null;
  const context = () => ({ binding: getBinding(), items: getItems() });
  const emit = changes => { value = { ...value, ...changes }; onState({ ...value }); };
  const unchanged = () => prepared && identity(context()) === prepared.context;
  function invalidate() {
    if (value.busy || value.unknown) return false;
    prepared = null; applyRequest = null; emit({ preview: null, applied: 0, error: '' }); return true;
  }
  return {
    state: () => ({ ...value }), invalidate,
    async preview(config) {
      if (value.busy || value.unknown) return false;
      const current = context();
      if (!current.binding || !Array.isArray(current.items) || !current.items.length || current.items.length > 5) {
        emit({ error: '请先选择店铺草稿中的 1–5 张图片。' }); return false;
      }
      prepared = null; applyRequest = null; emit({ busy: true, error: '', preview: null, applied: 0 });
      try {
        const request = { contractVersion: VERSION, ...copy(current.binding), items: copy(current.items), config: copy(config) };
        const result = unwrap(await command('WATERMARK_PREVIEW', { request }));
        if (identity(context()) !== identity(current)) throw new Error('草稿或图片选择已变化，请重新预览。');
        if (!result || result.contractVersion !== VERSION || !/^[a-f0-9]{64}$/u.test(result.previewHash)
          || !Array.isArray(result.items) || result.items.length !== request.items.length
          || result.items.some(item => typeof item.dataUrl !== 'string' || !/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/u.test(item.dataUrl)
            || item.dataUrl.length > 70_000)) throw new Error('ERP 水印预览响应不完整。');
        prepared = { request, context: identity(current) }; emit({ preview: result }); return true;
      } catch (error) { emit({ error: error.message || '水印预览暂不可用。' }); return false; }
      finally { emit({ busy: false }); }
    },
    async apply() {
      if (value.busy || !prepared || !value.preview) return false;
      const current = getBinding();
      const sameIdentity = current && ['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(key => current[key] === prepared.request[key]);
      if (!unchanged() && !(value.unknown && sameIdentity)) { if (!value.unknown) invalidate(); emit({ error: '草稿或图片选择已变化，请重新预览。' }); return false; }
      if (!applyRequest) applyRequest = { ...copy(prepared.request), previewHash: value.preview.previewHash,
        idempotencyKey: `watermark-${crypto.randomUUID()}` };
      emit({ busy: true, error: '' });
      try {
        const result = unwrap(await command('WATERMARK_APPLY', { request: copy(applyRequest) }));
        if (!result?.draft || result.draft.id !== prepared.request.listingWorkflowId || result.draft.shopId !== prepared.request.shopId
          || result.draft.sourceCaptureSnapshotId !== prepared.request.snapshotId || result.draft.supplyGoodsId !== prepared.request.supplyGoodsId
          || result.draft.revision !== prepared.request.draftRevision + 1 || result.draft.draftVersion !== prepared.request.draftVersion + 1
          || !Array.isArray(result.assets) || !Number.isInteger(result.applied) || result.applied !== prepared.request.items.length) {
          throw Object.assign(new Error('水印应用回执不完整，请核对结果。'), { code: 'UNKNOWN_OUTCOME' });
        }
        emit({ applied: result.applied, unknown: false });
        // A successful mutation must not become an unknown outcome when a later read fails.
        try { await onApplied(result); } catch { emit({ error: '水印已应用，草稿状态刷新暂未完成，请读取最新状态。' }); }
        prepared = null; applyRequest = null; return true;
      } catch (error) {
        const unknown = error.code === 'UNKNOWN_OUTCOME' || error.outcome === 'UNKNOWN_OUTCOME' || error.unknownOutcome === true;
        emit({ unknown, error: unknown ? '应用结果尚待核对；请使用原请求核对，不要重新处理图片。' : error.message || '水印应用未完成。' });
        return false;
      } finally { emit({ busy: false }); }
    },
  };
}

/** Adapted from donor ui/panel.html #watermark-modal; the existing wm-* CSS owns its visual shell. */
export function createWatermarkEditor({ root, command, getBinding, getItems, getBusy = () => false, onApplied, report = () => {} }) {
  const doc = root.ownerDocument; let previousFocus = null;
  const make = (tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
  const modal = make('div'); modal.id = 'watermark-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'wm-title');
  const dialog = make('div', 'wm-dialog'); const head = make('div', 'wm-head');
  const title = make('span', 'wm-title', '水印设置'); title.id = 'wm-title';
  const close = make('button', 'ghost', '关闭'); close.id = 'wm-close-btn'; close.type = 'button'; head.append(title, close);
  const body = make('div', 'wm-body'); const form = make('div', 'wm-form');
  function field(label, input) { const row = make('div', 'wm-form-row'); const text = make('label', '', label); text.htmlFor = input.id; row.append(text, input); form.append(row); return input; }
  const text = make('input'); text.id = 'wm-text'; text.maxLength = 120; text.placeholder = '输入水印文字'; field('水印文字', text);
  const color = make('input'); color.id = 'wm-color-picker'; color.type = 'color'; color.value = '#ffffff'; field('颜色', color);
  const font = make('input'); font.id = 'wm-font-size'; font.type = 'number'; font.min = '6'; font.max = '200'; font.value = '36'; field('字体大小（px）', font);
  const position = make('select'); position.id = 'wm-position';
  for (const [id, label] of [['bottom-right', '右下角'], ['bottom-left', '左下角'], ['top-right', '右上角'], ['top-left', '左上角'], ['center', '居中'], ['tile', '重复斜向上']]) {
    const option = make('option', '', label); option.value = id; position.append(option);
  }
  field('位置', position);
  const opacity = make('input'); opacity.id = 'wm-opacity'; opacity.type = 'range'; opacity.min = '1'; opacity.max = '100'; opacity.value = '60'; field('不透明度（%）', opacity);
  const scope = make('p', '', '将水印应用到当前勾选图片的草稿槽位，原图保留。每次最多 5 张，不产生 AI 生图费用。'); form.append(scope);
  const pane = make('div', 'wm-preview-pane'); const previewLabel = make('span', 'wm-preview-label', '预览');
  const canvas = make('canvas'); canvas.id = 'wm-preview-canvas'; canvas.width = 300; canvas.height = 400;
  const choices = make('div', 'wm-preview-choices'); const notice = make('p'); notice.id = 'wm-status'; notice.setAttribute('role', 'status');
  pane.append(previewLabel, canvas, choices, notice); body.append(form, pane);
  const foot = make('div', 'wm-foot'); const preview = make('button', 'ghost', '预览水印'); preview.id = 'wm-preview-btn'; preview.type = 'button';
  const apply = make('button', 'primary', '应用到草稿'); apply.id = 'wm-apply-btn'; apply.type = 'button'; foot.append(preview, apply);
  dialog.append(head, body, foot); modal.append(dialog); root.append(modal);
  let previewIndex = 0; let lastPreview = null;
  function draw(item) {
    if (!item) { canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); return; }
    const image = new doc.defaultView.Image();
    image.onload = () => { canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')?.drawImage(image, 0, 0); };
    image.src = item.dataUrl;
  }
  const flow = createWatermarkFlow({ command, getBinding, getItems, onApplied,
    onState: state => {
      preview.disabled = state.busy || state.unknown || getBusy(); apply.disabled = state.busy || !state.preview || state.applied > 0 || getBusy();
      apply.textContent = state.unknown ? '核对应用结果' : state.busy ? '处理中…' : '应用到草稿'; close.disabled = state.busy;
      for (const input of [text, color, font, position, opacity]) input.disabled = state.busy || state.unknown;
      notice.textContent = state.error || (state.busy ? '正在处理所选图片…' : state.applied ? `已应用 ${state.applied} 张水印图片。` : state.preview ? '预览完成，确认后应用到草稿。' : '填写水印文字后点击预览。');
      if (lastPreview !== state.preview) {
        lastPreview = state.preview; previewIndex = 0; choices.replaceChildren();
        for (const [index, item] of (state.preview?.items || []).entries()) {
          const button = make('button', 'ghost', `图片 ${index + 1}`); button.type = 'button'; button.addEventListener('click', () => { previewIndex = index; draw(item); }); choices.append(button);
        }
        draw(state.preview?.items?.[previewIndex]);
      }
    } });
  const config = () => ({ type: 'text', text: text.value.trim(), position: position.value, opacity: Number(opacity.value), fontSize: Number(font.value), fontColor: color.value });
  for (const input of [text, color, font, position, opacity]) input.addEventListener('input', () => flow.invalidate());
  preview.addEventListener('click', event => { if (event.isTrusted && !preview.disabled && !getBusy()) flow.preview(config()).catch(report); });
  apply.addEventListener('click', event => { if (event.isTrusted && !apply.disabled && !getBusy()) flow.apply().catch(report); });
  function hide() { if (flow.state().busy) return; modal.hidden = true; previousFocus?.focus(); }
  close.addEventListener('click', hide); modal.addEventListener('click', event => { if (event.target === modal) hide(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button,input,select')].filter(node => !node.disabled && !node.hidden);
      const index = focusable.indexOf(doc.activeElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus(); }
    }
  });
  flow.invalidate();
  return { open() { if (getBusy()) return; previousFocus = doc.activeElement; flow.invalidate(); modal.hidden = false; (flow.state().unknown ? apply : text).focus(); },
    close: hide, state: flow.state, destroy() { modal.remove(); } };
}
