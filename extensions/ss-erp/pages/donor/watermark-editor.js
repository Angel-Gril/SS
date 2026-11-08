const VERSION = 'extension-workbench-watermark/v1';
const copy = value => JSON.parse(JSON.stringify(value));
const identity = value => JSON.stringify(value);
function unwrap(response) {
  if (response?.ok === false || response?.code === 0) throw new Error(response.message || response.msg || '水印操作未完成');
  return response?.data || response;
}
/** UI command state only. Selection, pixels, billing and draft ownership remain server-owned. */
export function createWatermarkFlow({ command, getBinding, getItems, onState = () => {}, onApplied = () => {} }) {
  let value = { busy: false, unknown: false, error: '', preview: null, applied: 0, templates: [], templateLoading: false, templateError: '' };
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
    async loadTemplates() {
      if (value.busy || value.unknown || value.templateLoading) return false;
      const binding = copy(getBinding());
      if (!binding) { emit({ templates: [], templateError: '请先选择店铺并创建草稿，再读取水印模板。' }); return false; }
      emit({ templateLoading: true, templateError: '', templates: [] });
      try {
        const result = unwrap(await command('WATERMARK_TEMPLATES', { request: { contractVersion: VERSION, ...copy(binding) } }));
        if (identity(getBinding()) !== identity(binding)) throw new Error('草稿已变化，请重新读取水印模板。');
        const positions = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center', 'tile'];
        if (result?.contractVersion !== VERSION || !Array.isArray(result.templates) || result.templates.length > 100
          || new Set(result.templates.map(template => template.id)).size !== result.templates.length
          || result.templates.some(template => typeof template.id !== 'string' || !template.id || template.id.length > 200
            || typeof template.name !== 'string' || !template.name || template.name.length > 120 || !positions.includes(template.position)
            || !Number.isInteger(template.opacity) || template.opacity < 1 || template.opacity > 100
            || !Number.isInteger(template.scale) || template.scale < 5 || template.scale > 100 || typeof template.isDefault !== 'boolean')) {
          throw new Error('ERP 图案水印模板响应不完整。');
        }
        emit({ templates: copy(result.templates) }); return true;
      } catch (error) { emit({ templates: [], templateError: error.message || '图案水印模板暂时无法读取。' }); return false; }
      finally { emit({ templateLoading: false }); }
    },
    async preview(config) {
      if (value.busy || value.unknown || value.templateLoading) return false;
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
  let mode = 'text';
  const modeRow = make('div', 'wm-form-row'); const modeLabel = make('label', '', '水印类型');
  const modeSwitch = make('div', 'wm-mode-switch');
  const textMode = make('button', 'wm-mode-btn is-active', '文字水印'); textMode.id = 'wm-mode-text-btn'; textMode.type = 'button'; textMode.setAttribute('aria-pressed', 'true');
  const imageMode = make('button', 'wm-mode-btn', '图片水印'); imageMode.id = 'wm-mode-image-btn'; imageMode.type = 'button'; imageMode.setAttribute('aria-pressed', 'false');
  modeSwitch.append(textMode, imageMode); modeRow.append(modeLabel, modeSwitch); form.append(modeRow);
  const text = make('input'); text.id = 'wm-text'; text.maxLength = 120; text.placeholder = '输入水印文字'; field('水印文字', text);
  const color = make('input'); color.id = 'wm-color-picker'; color.type = 'color'; color.value = '#ffffff'; field('颜色', color);
  const font = make('input'); font.id = 'wm-font-size'; font.type = 'number'; font.min = '6'; font.max = '200'; font.value = '36'; field('字体大小（px）', font);
  const template = make('select'); template.id = 'wm-image-template'; field('店铺图案模板', template);
  const templateHelp = make('p'); templateHelp.id = 'wm-template-hint'; templateHelp.setAttribute('role', 'status'); form.append(templateHelp);
  const reloadTemplates = make('button', 'ghost', '重新读取水印模板'); reloadTemplates.id = 'wm-template-reload-btn'; reloadTemplates.type = 'button'; form.append(reloadTemplates);
  const scale = make('input'); scale.id = 'wm-image-size'; scale.type = 'range'; scale.min = '5'; scale.max = '100'; scale.value = '25'; field('图案宽度（%）', scale);
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
  let previewIndex = 0; let lastPreview = null; let drawRevision = 0;
  let templateListIdentity = '';
  function showMode() {
    for (const input of [text, color, font]) input.parentElement.hidden = mode !== 'text';
    for (const input of [template, scale]) input.parentElement.hidden = mode !== 'image';
    templateHelp.hidden = reloadTemplates.hidden = mode !== 'image';
    textMode.classList.toggle('is-active', mode === 'text'); imageMode.classList.toggle('is-active', mode === 'image');
    textMode.setAttribute('aria-pressed', String(mode === 'text')); imageMode.setAttribute('aria-pressed', String(mode === 'image'));
  }
  function useTemplateDefaults() {
    const selected = flow.state().templates.find(item => item.id === template.value);
    if (selected) { position.value = selected.position; opacity.value = String(selected.opacity); scale.value = String(selected.scale); }
  }
  function draw(item) {
    const revision = ++drawRevision;
    if (!item) { canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); return; }
    const image = new doc.defaultView.Image();
    image.onload = () => { if (revision !== drawRevision) return;
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d')?.drawImage(image, 0, 0); };
    image.src = item.dataUrl;
  }
  const flow = createWatermarkFlow({ command, getBinding, getItems, onApplied,
    onState: state => {
      preview.disabled = state.busy || state.unknown || state.templateLoading || getBusy() || mode === 'image' && !template.value;
      apply.disabled = state.busy || !state.preview || state.applied > 0 || getBusy();
      apply.textContent = state.unknown ? '核对应用结果' : state.busy ? '处理中…' : '应用到草稿'; close.disabled = state.busy;
      for (const input of [text, color, font, position, opacity, template, scale, textMode, imageMode]) input.disabled = state.busy || state.unknown;
      template.disabled ||= state.templateLoading;
      reloadTemplates.disabled = state.busy || state.unknown || state.templateLoading || getBusy();
      templateHelp.textContent = state.templateLoading ? '正在读取该店铺的图案水印模板…' : state.templateError || (state.templates.length
        ? '使用该店铺或通用的已保存图案，原图透明通道会保留。'
        : '请先在 ERP 的图片处理→水印模板添加图案模板，然后重新读取。');
      const listIdentity = identity(state.templates);
      if (templateListIdentity !== listIdentity) {
        templateListIdentity = listIdentity; const previous = template.value; template.replaceChildren();
        const placeholder = make('option', '', state.templateLoading ? '读取中…' : '选择图案模板'); placeholder.value = ''; template.append(placeholder);
        for (const item of state.templates) { const option = make('option', '', item.name); option.value = item.id; template.append(option); }
        template.value = state.templates.some(item => item.id === previous) ? previous : (state.templates.find(item => item.isDefault) || state.templates[0])?.id || '';
        const selected = state.templates.find(item => item.id === template.value);
        if (mode === 'image' && selected) { position.value = selected.position; opacity.value = String(selected.opacity); scale.value = String(selected.scale); }
        preview.disabled ||= mode === 'image' && !template.value;
      }
      notice.textContent = state.error || (state.busy ? '正在处理所选图片…' : state.applied ? `已应用 ${state.applied} 张水印图片。`
        : state.preview ? '预览完成，确认后应用到草稿。' : mode === 'image' ? '选择图案模板后点击预览。' : '填写水印文字后点击预览。');
      if (lastPreview !== state.preview) {
        lastPreview = state.preview; previewIndex = 0; choices.replaceChildren();
        for (const [index, item] of (state.preview?.items || []).entries()) {
          const button = make('button', 'ghost', `图片 ${index + 1}`); button.type = 'button'; button.addEventListener('click', () => { previewIndex = index; draw(item); }); choices.append(button);
        }
        draw(state.preview?.items?.[previewIndex]);
      }
    } });
  const config = () => mode === 'image' ? { type: 'image', templateId: template.value, position: position.value, opacity: Number(opacity.value), scale: Number(scale.value) }
    : { type: 'text', text: text.value.trim(), position: position.value, opacity: Number(opacity.value), fontSize: Number(font.value), fontColor: color.value };
  for (const input of [text, color, font, position, opacity, scale]) input.addEventListener('input', () => flow.invalidate());
  template.addEventListener('change', () => { useTemplateDefaults(); flow.invalidate(); });
  for (const [button, target] of [[textMode, 'text'], [imageMode, 'image']]) button.addEventListener('click', event => {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || button.disabled || getBusy()) return; mode = target; showMode();
    if (mode === 'image') useTemplateDefaults(); flow.invalidate();
  });
  reloadTemplates.addEventListener('click', event => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) && !reloadTemplates.disabled && !getBusy()) {
    flow.invalidate(); flow.loadTemplates().catch(report);
  } });
  preview.addEventListener('click', event => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) && !preview.disabled && !getBusy()) flow.preview(config()).catch(report); });
  apply.addEventListener('click', event => { if (SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) && !apply.disabled && !getBusy()) flow.apply().catch(report); });
  function hide() { if (flow.state().busy) return; modal.hidden = true; previousFocus?.focus(); }
  close.addEventListener('click', hide); modal.addEventListener('click', event => { if (event.target === modal) hide(); });
  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); hide(); }
    if (event.key === 'Tab') {
      const focusable = [...modal.querySelectorAll('button,input,select')].filter(node => !node.disabled && !node.hidden && !node.closest('[hidden]'));
      const index = focusable.indexOf(doc.activeElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === focusable.length - 1) { event.preventDefault(); focusable[event.shiftKey ? focusable.length - 1 : 0]?.focus(); }
    }
  });
  showMode(); flow.invalidate();
  return { open() { if (getBusy()) return; previousFocus = doc.activeElement; flow.invalidate(); modal.hidden = false;
    (flow.state().unknown ? apply : mode === 'image' ? template : text).focus(); flow.loadTemplates().catch(report); },
    close: hide, state: flow.state, destroy() { modal.remove(); } };
}
