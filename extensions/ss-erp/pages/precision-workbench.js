import { renderProductEditor } from './donor/ui/modules/product-editor.js';
import { createSkuPickerController } from './donor/ui/presentation/views/sku-picker-view.js';
import { createPreviewController } from './donor/ui/presentation/views/preview-view.js';
import { createUiScaleController } from './donor/ui/presentation/controllers/ui-scale-controller.js';
import { createOfficialAttributeEditor } from './donor/official-attribute-editor.js';
import { createCopyEditor } from './donor/copy-editor.js';
import { createPricingTool } from './donor/pricing-tool.js';
import { createVisionTool } from './donor/vision-tool.js';
import { createAttributeSuggestions } from './donor/attribute-suggestions.js';
import { createPrecisionPrivateRuntime } from './donor/precision-private-runtime.js';
import { createByokEditor } from './donor/byok-editor.js';
import { createCategoryDialog } from './donor/category-dialog.js';
import { createTranslationFlow, normalizeTranslationPrice } from './donor/translation-flow.js';
import { resolveSuitePrimaryAction } from './donor/suite-primary-action.js';
import { compileHostedReferenceSelection } from './donor/hosted-reference-selection.js';
import { buildSkuImageRows, createSkuImageWorkspace, describeSuite } from './donor/sku-image-workspace.js';
import { createSourceVideoView } from './donor/source-video-view.js';
import { resolveCombinedImageAction } from './donor/combined-image-flow.js';
import { createWatermarkEditor } from './donor/watermark-editor.js';
import { createVideoPublishEditor } from './donor/video-publish-editor.js';
import { createPreparationAnalysisView, renderPreparationProcess } from './donor/preparation-analysis-view.js';

const Contract = globalThis.SS_ERP_DONOR_WORKBENCH_CONTRACT;
const Workflow = globalThis.SS_ERP_PRECISION_WORKFLOW;
const Prompt = globalThis.SS_ERP_DONOR_PROMPT_ADAPTER;
let privateRuntime = null;
try { privateRuntime = createPrecisionPrivateRuntime(); } catch {}
const element = (id) => document.getElementById(id);
let projection = Contract.createProjection({});
let selectedShopId = '';
let selectedSkuKey = '';
let editorSignature = '';
let editorRenderOwner = '';
let mediaSignature = '';
let candidateSignature = '';
let shopSelectSignature = '';
let byokRegistrationContext = '';
let drafts = [];
let sourceReady = false;
let userPromptEdited = false;
let visualJsonError = '';
let planSubmissionBusy = false;
let mediaMutationBusy = false;
let publishBusy = false;
let publishPreview = null;
let publishMessage = '';
let publishEditRevision = 0;
const unsavedListingFields = new Set();
const publishOperations = new Map();
const promptPlanLocks = new Map();
let selectedDraftSkuKeys = null;
let selectedDraftShopId = '';
let referenceSelectionInitialized = false;
let mediaStateBinding = '';
let pollingTimer = 0;
let pollingAttempts = 0;
let editor = null;
let editorLoadKey = '';
let editorReadFailureKey = '';
let editorLoading = false;
let editorReadTask=null;
let saveBusy = false;
let lastSave = null;
let imageMode = 'ai-suite';
let translationAvailability = { binding: '', state: 'idle', available: false, reason: '' };
const referenceKeys = new Set();
const translationKeys = new Set();
let translationSelectionContext = '';
const pending = new Map();
const events = [];
function allowedOrigin(value) {
  try {
    const source = new URL(value);
    if (source.protocol === 'https:' && (source.hostname === 'detail.1688.com'
      || source.hostname.endsWith('.pinduoduo.com') || source.hostname.endsWith('.yangkeduo.com')
      || source.hostname === 'item.taobao.com' || source.hostname === 'detail.tmall.com')) return source.origin;
  } catch {}
  return '';
}
let parentOrigin = allowedOrigin(document.referrer);

function command(type, fields = {}) {
  if (!parentOrigin && type !== 'READY') return Promise.reject(new Error('请从来源商品页打开工作台'));
  const requestId = crypto.randomUUID();
  const outgoing = { contractVersion: Contract.CONTRACT_VERSION, type, requestId, ...fields };
  if (type === 'EXECUTE_HOSTED_SUITE') {
    try { Contract.parseFrameCommand(outgoing); }
    catch { return Promise.reject(Object.assign(new Error('套图输入未通过校验，请重新读取并检查参考图与创作方向'), { outcome: 'NOT_SUBMITTED' })); }
  }
  const mutation = ['COLLECT', 'CREATE_DRAFT', 'EXECUTE_HOSTED_SUITE', 'ASSIGN_HOSTED_SUITE', 'PREPARE_MEDIA_MUTATION', 'EDITOR_SAVE', 'EDITOR_COPY_GENERATE', 'VISION_ANALYZE', 'PREPARATION_ANALYZE', 'PREPARATION_APPLY', 'CREATE_TRANSLATION', 'WATERMARK_APPLY', 'VIDEO_SAVE'].includes(type)
    || type === 'PUBLISH' && fields.action === 'CONFIRM';
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Object.assign(new Error('ERP 响应超时，请重新读取状态'), { outcome: mutation ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED' }));
    }, ['VISION_ANALYZE', 'PREPARATION_ANALYZE', 'EDITOR_COPY_GENERATE'].includes(type) ? 220000 : 90000);
    pending.set(requestId, { resolve, reject, timer, type, mutation });
  });
  parent.postMessage(outgoing, parentOrigin || '*');
  return promise;
}

const session = Workflow.createSession({ getProjection: () => projection, send: command });
let preparation;
let preparationAnalysis;
let preparationSchemaContext='',preparationSchemaRevision=null;
function listing() { return session.currentDraft(selectedShopId); }
function status(message, variant = '') {
  element('status-text').textContent = message;
  element('status-text').className = `status-pill ${variant}`;
  const notice = element('precision-image-notice');
  if (notice) { notice.textContent = message; notice.className = `image-manager-global-status${variant ? ` is-${variant}` : ''}`; }
}
function log(message, error = false) {
  events.push({ message, error, at: new Date().toLocaleTimeString() });
  if (events.length > 100) events.shift();
  const output = element('ai-output');
  output.replaceChildren();
  for (const entry of events) {
    const row = document.createElement('div');
    row.className = `precision-log${entry.error ? ' is-error' : ''}`;
    const time = document.createElement('time');
    time.textContent = entry.at;
    const content = document.createElement('div');
    content.textContent = entry.message;
    row.append(time, content);
    output.append(row);
  }
  element('process-title').textContent = message;
}
function report(error) { status(error.message || String(error), 'err'); log(error.message || String(error), true); }
function trusted(id, handler) {
  const target = element(id);
  if (!target) return;
  target.addEventListener('click', (event) => {
    if (!event.isTrusted || target.disabled) return;
    Promise.resolve().then(handler).catch(report).finally(render);
  });
}
function openModal(id) { element(id).hidden = false; }
document.querySelectorAll('[data-close-modal]').forEach((button) => {
  button.addEventListener('click', () => { element(button.dataset.closeModal).hidden = true; });
});

const pickerState = { pendingSkuResolve: null, pendingSkuRawData: null, skuPickerAuto: { timerId: 0, remainingSeconds: 0, userInteracted: false } };
const picker = createSkuPickerController({
  els: { skuPicker: element('sku-picker'), skuPickerList: element('sku-picker-list'), skuApplyBtn: element('sku-apply-btn'), skuToggleBtn: element('sku-toggle-btn'), skuPickedCount: element('sku-picked-count') },
  state: pickerState, text: { skuApply: '确认 SKU 并继续' }, autoSeconds: 0, setStatus: status,
});
trusted('sku-apply-btn', () => picker.onApplySelection());
trusted('sku-toggle-btn', () => picker.onToggleSelection());
trusted('sku-picker-close-btn', () => picker.cancelSelection());

const preview = createPreviewController({
  els: { previewModal: element('preview-modal'), previewImage: element('preview-image'), previewTitle: element('preview-title'), previewDesc: element('preview-desc'), previewCounter: element('preview-counter'), previewPrevBtn: element('preview-prev-btn'), previewNextBtn: element('preview-next-btn') },
  text: { previewTitle: '图片预览', previewUpdated: '图片素材', previewDesc: (role, review) => `${role} · ${review}` },
  getRoleLabel: (item) => item.reviewStatus ? '生成候选' : roleLabel(item.role),
  getStatusLabel: (item) => reviewStatusLabel(item.reviewStatus) || '来源素材',
  getItems: () => [
    ...visibleWorkspaceMedia(eligibleReferenceMedia()).map((item) => ({ ...item, id: item.key, originalUrl: item.url, group: 'gallery' })),
    ...(currentMediaContext().history?.items || []).filter(item => imageWorkspace.state().all || !item.contextSkuKey || item.contextSkuKey === selectedSkuKey).flatMap((item) => item.outputs.map((output) => ({
      id: `candidate:${output.id}`, originalUrl: output.url, reviewStatus: item.reviewStatus, group: 'gallery',
    }))),
  ],
});
trusted('preview-close-btn', () => { element('preview-modal').hidden = true; });
trusted('preview-prev-btn', () => preview.prev());
trusted('preview-next-btn', () => preview.next());
function roleLabel(value) { return ({ product_main: '商品主图', product_detail: '详情图', sku: 'SKU 图' })[value] || '商品图'; }
function reviewStatusLabel(value) { return ({ NOT_READY: '未就绪', PENDING: '待审核', APPROVED: '已通过', REJECTED: '已驳回' })[value] || ''; }
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const band = make('div', 'erp-source-band');
band.append(make('strong', '', '正在读取商品'), make('span', '', 'SS ERP'));
document.querySelector('.toolbar').after(band);
const sourceVideo = createSourceVideoView({ root: element('ui-scale-root'), getVideos: () => projection.videos,
  getSkuKey: () => selectedSkuKey, onSelectSku: key => { selectedSkuKey = key; }, onMessage: message => status(message, 'warn'),
  getContextKey: () => `${projection.source.sourceProductId}:${projection.handoff?.snapshotId}` });
const videoEditor = createVideoPublishEditor({ root: element('ui-scale-root'), command,
  getBinding: () => listing() ? currentEditorBinding() : null, getSkuKey: () => selectedSkuKey,
  onSelectSku: key => { selectedSkuKey = key; }, getBusy: () => projection.busy || saveBusy || mediaMutationBusy || publishBusy,
  getSourceVideos: () => (projection.videos || []).filter(item => !item.skuKeys.length || item.skuKeys.includes(selectedSkuKey)),
  openSourceVideo: source => sourceVideo.open(source), onMessage: message => status(message, 'warn'),
  onSaved: async () => { await command('REFRESH'); await loadEditor(); invalidatePublishPreview('视频已变化，请重新预览上传。'); status('视频已保存到当前草稿', 'ok'); } });
const imageWorkspace = createSkuImageWorkspace({ container: element('image-queue'), root: element('ui-scale-root'),
  renderVideoCell: (cell, value) => {
    cell.replaceChildren();
    if (value.role === 'MAIN') sourceVideo.renderCell(cell, { skuKey: value.skuKey, label: '来源视频' });
    const button = make('button', 'ghost precision-video-settings', '设置'); button.type = 'button';
    button.dataset.videoSku = value.skuKey; button.dataset.videoRole = value.role;
    button.setAttribute('aria-label', `设置 ${value.skuKey} 的${value.label}`);
    button.addEventListener('keydown', event => event.stopPropagation());
    button.addEventListener('click', event => { event.stopPropagation(); if (event.isTrusted && !button.disabled) void videoEditor.open(value.skuKey, value.role, button); });
    cell.append(button);
  },
  onSelect: key => { if (selectedSkuKey !== key) { selectedSkuKey = key; byok.invalidate(); } }, onChange: () => renderMedia(),
  onModeChange: mode => { imageMode = mode;
    document.querySelectorAll('input[name="image-workflow-mode"]').forEach(input => { input.checked = input.value === mode; });
    byok.setMode(mode); renderMedia(); } });
const mediaToolbar = make('div', 'precision-media-toolbar');
mediaToolbar.append(make('span', '', '套图参考图用于整个草稿；可切换 SKU 或查看整个草稿的素材。'));
const mediaSelectionCount = make('span'); mediaToolbar.append(mediaSelectionCount);
function watermarkItems() {
  const selected = ['translate', 'ai-main-translate'].includes(imageMode) ? translationKeys : referenceKeys;
  let gallery = 0;
  return visibleWorkspaceMedia(eligibleReferenceMedia()).filter(item => selected.has(item.key)).slice(0, 5).map(item => {
    const skuKey = item.skuKeys.length ? selectedSkuKey : null;
    return { sourceMediaKey: item.key, skuKey,
      slotKey: skuKey ? `sku:${skuKey}:hero` : gallery++ === 0 ? 'product-main' : `product-gallery-${gallery - 1}` };
  }).filter((item, index, all) => all.findIndex(other => other.slotKey === item.slotKey) === index);
}
const watermark = createWatermarkEditor({ root: element('ui-scale-root'), command,
  getBinding: () => listing() ? currentEditorBinding() : null, getItems: watermarkItems,
  getBusy: () => projection.busy || mediaMutationBusy || saveBusy || publishBusy,
  onApplied: async () => { await command('REFRESH'); await loadEditor(); status('水印图片已应用到当前草稿', 'ok'); }, report });
trusted('watermark-settings-btn', () => watermark.open());
const watermarkImageButton = make('button', 'ghost', '水印设置'); watermarkImageButton.id = 'precision-watermark-settings';
mediaToolbar.append(watermarkImageButton);
const translateImage = make('button', 'ghost', '图片翻译'); translateImage.id = 'precision-image-translate'; mediaToolbar.append(translateImage);
const library = make('div', 'precision-source-library');
library.id = 'precision-source-library';
const promptArea = make('div', 'precision-prompt');
const promptLabel = make('label', '', '套图创作方向（可选）');
const promptText = make('textarea');
promptText.id = 'precision-prompt-text';
promptText.placeholder = '例如：浅灰厨房台面、柔和自然光、写实构图。留空使用 ERP 规则。';
const promptHint = make('small');
promptHint.id = 'precision-prompt-hint';
promptText.addEventListener('input', () => { userPromptEdited = true; visualJsonError = ''; renderPromptState(); });
promptLabel.append(promptText, promptHint);
const negativeLabel = make('label', '', '反向提示词（可选）');
const negativeText = make('textarea');
negativeText.id = 'precision-negative-prompt';
negativeText.placeholder = '例如：不要装饰文字。最多 150 个字符。';
const negativeHint = make('small');
negativeText.addEventListener('input', () => { userPromptEdited = true; renderPromptState(); });
negativeLabel.append(negativeText, negativeHint);
const jsonLabel = make('label', '', '视觉描述 JSON');
const visualJson = make('textarea');
visualJson.id = 'precision-visual-json';
const visionTool = createVisionTool({ root: element('ui-scale-root'), command,
  getBinding: () => currentEditorForPublish() ? currentEditorBinding() : null, getSkuKey: () => selectedSkuKey,
  getMedia: () => eligibleReferenceMedia().filter(item => !item.skuKeys.length || item.skuKeys.includes(selectedSkuKey)),
  getBusy: () => projection.busy || saveBusy || mediaMutationBusy || planSubmissionBusy,
  applyDescription(description) {
    const brief = Prompt.compileVisualCreativeBrief(description);
    visualJson.value = JSON.stringify(description, null, 2);
    promptText.value = brief?.prompt || ''; userPromptEdited = true; visualJsonError = ''; renderPromptState();
    status('视觉 JSON 已应用到本地提示词，可继续编辑；尚未生图。', 'ok');
  }, onMessage: status, report });
const visionOpen = make('button', 'ghost', '看图生成视觉 JSON'); visionOpen.id = 'precision-vision-open';
mediaToolbar.append(visionOpen);
visionOpen.addEventListener('click', event => {
  if (event.isTrusted && !visionOpen.disabled) void visionTool.open().catch(report).finally(render);
});
visualJson.addEventListener('input', () => {
  try {
    const description = JSON.parse(visualJson.value);
    const brief = Prompt.compileVisualCreativeBrief(description);
    promptText.value = brief?.prompt || '';
    visualJsonError = '';
    userPromptEdited = true;
    renderPromptState();
    status('创作方向已在本地编译，可编辑后准备套图');
  } catch (error) {
    visualJsonError = error instanceof SyntaxError ? '视觉描述 JSON 格式不完整，请继续编辑' : error.message;
    status(visualJsonError, 'warn');
  }
});
jsonLabel.append(visualJson, make('small', '', '编辑构图、背景、光线和风格，同步生成上方创作方向；商品与 SKU 信息自动关联。'));
promptArea.append(promptLabel, negativeLabel, jsonLabel);
const suiteActions = make('div', 'precision-suite-actions');
const suiteState = make('span', '', '等待草稿');
suiteState.id = 'precision-suite-state';
suiteActions.append(suiteState);
const assignButton = make('button', 'ghost', '应用已审核图片'); assignButton.id = 'precision-assign';
suiteActions.append(assignButton);
const candidates = make('div', 'precision-candidates');
const creativeOptions = make('details', 'precision-creative-options');
creativeOptions.append(make('summary', '', '创作方向与视觉 JSON（可选）'), promptArea);
imageWorkspace.sourcePanel.append(mediaToolbar, library, creativeOptions);
trusted('precision-watermark-settings', () => watermark.open());
imageWorkspace.resultPanel.append(candidates);
imageWorkspace.foot.append(suiteActions);
const imagePrimary = make('button', 'primary'); imagePrimary.id = 'precision-image-primary'; imageWorkspace.foot.append(imagePrimary);
const mediaRefresh = make('button', 'ghost', '读取最新状态'); mediaRefresh.id = 'precision-image-refresh'; imageWorkspace.foot.append(mediaRefresh);
const translationPanel = make('section', 'precision-translation-panel');
translationPanel.id = 'precision-translation-panel'; translationPanel.hidden = true;
const translationState = make('p'); translationState.id = 'precision-translation-state'; translationState.setAttribute('role', 'status');
translationPanel.append(make('strong', '', '翻译已勾选的图片 · 中文 → 俄文'), make('p', '', '仅翻译图片中的文字；每次最多 5 张，原图保留。'), translationState);
const translationProgress = make('div', 'precision-translation-progress'); translationPanel.append(translationProgress);
const translationRefresh = make('button', 'ghost', '重新检查翻译可用性'); translationRefresh.id = 'precision-translation-refresh'; translationPanel.append(translationRefresh);
library.before(translationPanel);
const translation = createTranslationFlow({
  getContext: () => { const draft = listing(); return draft && { snapshotId: projection.handoff?.snapshotId, shopId: draft.shopId, listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion }; },
  getSelectedMedia: () => eligibleReferenceMedia().filter(item => translationKeys.has(item.key)),
  submit: fields => command('CREATE_TRANSLATION', fields),
  onState: view => {
    translationState.textContent = view.error || (view.busy ? '正在提交所选图片…' : view.queuedCount ? `${view.queuedCount} 张已提交，处理结果可在图片任务中重新读取。` : '勾选下方图片后，点击开始翻译。');
    translationProgress.replaceChildren(...view.items.map(item => make('span', '', `图片 ${eligibleReferenceMedia().findIndex(media => media.key === item.sourceMediaKey) + 1} · ${{SUBMITTING:'提交中',QUEUED:'已提交',UNKNOWN:'待核对',FAILED:'未提交'}[item.status]}`)));
    renderImageMode();
  },
});
function precisionByokBinding() {
  const draft = listing();
  const handoff = projection.handoff;
  if (!draft || !handoff || !selectedSkuKey) return null;
  return {
    sourcePlatform: projection.source.platform, sourceProductId: projection.source.sourceProductId,
    sourceCaptureSnapshotId: handoff.snapshotId, supplyGoodsId: handoff.supplyGoodsId,
    shopId: draft.shopId, workflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion,
    skuKey: selectedSkuKey, slotKey: `sku:${selectedSkuKey}:hero`, assignmentMode: 'APPEND',
    assignmentOrdinal: Math.max(0, Number(draft.mediaAssignmentCount) || 0),
  };
}
const byok = createByokEditor({ root: element('ui-scale-root'), container: imageWorkspace.sourcePanel, runtime: privateRuntime,
  getShopId: () => selectedShopId, getBinding: precisionByokBinding,
  openSession: async (value) => (await command('OPEN_EMBEDDED_MEDIA', value)).data,
  getBusy: () => projection.busy || saveBusy || mediaMutationBusy || publishBusy,
  onBound: async () => { await command('REFRESH'); }, report,
  onModeChange: () => renderImageMode() });
const byokMode = make('label');
const byokRadio = make('input'); byokRadio.type = 'radio'; byokRadio.name = 'image-workflow-mode'; byokRadio.value = 'byok';
byokMode.append(byokRadio, make('span', '', '自带 API')); element('image-workflow-mode').append(byokMode);
document.querySelectorAll('input[name="image-workflow-mode"]').forEach((input) => input.addEventListener('change', () => {
  if (input.checked) { imageMode = input.value; byok.setMode(imageMode); renderMedia(); }
}));
function renderImageMode() {
  const hostedMode = ['ai-suite', 'ai-main-translate'].includes(imageMode);
  const translationMode = ['translate', 'ai-main-translate'].includes(imageMode);
  suiteActions.hidden = promptArea.hidden = !hostedMode;
  creativeOptions.hidden = !hostedMode;
  candidates.hidden = imageMode === 'byok';
  translationPanel.hidden = !translationMode;
  translateImage.hidden = imageMode !== 'translate';
  const button = element('image-workflow-start-btn');
  const suiteAction = currentImageAction();
  button.textContent = imageMode === 'translate' ? (translation.state().busy ? '提交翻译中…' : '开始翻译所选图片')
    : imageMode === 'byok' ? '打开图片工作台' : suiteAction.action === 'PREPARE' ? '点击开始处理图片' : suiteAction.label;
  button.disabled = !listing() || projection.busy || mediaMutationBusy || translation.state().busy || translation.state().unknown
    || (imageMode === 'translate' && !translationAvailability.available) || (hostedMode && suiteAction.disabled);
  translateImage.disabled = button.disabled;
  imagePrimary.textContent = hostedMode ? suiteAction.label : imageMode === 'byok' ? '连接自带 API' : button.textContent;
  imagePrimary.disabled = button.disabled;
  imagePrimary.hidden = hostedMode && suiteAction.action === 'REVIEW' && imageWorkspace.state().tab === 'results';
  mediaRefresh.disabled = projection.busy || mediaMutationBusy;
  imageWorkspace.setMode(imageMode, projection.busy || mediaMutationBusy || translation.state().busy);
  translationRefresh.disabled = translationAvailability.state === 'loading' || translation.state().busy;
  if (translationMode) {
    if (listing() && projection.handoff) {
      const identity = JSON.stringify(currentEditorBinding());
      if (identity !== translationAvailability.binding) void readTranslationAvailability();
    }
    if (!translation.state().busy && !translation.state().error && !translationAvailability.available) translationState.textContent = translationAvailability.state === 'loading'
      ? '正在核对当前草稿的图片翻译状态…' : translationAvailability.reason || '请先创建当前店铺草稿';
  }
  document.querySelectorAll('input[name="image-workflow-mode"]').forEach(input => { input.disabled = translation.state().busy; });
}
function currentImageAction() {
  const input = { draftId: listing()?.id, busy: projection.busy || mediaMutationBusy || planSubmissionBusy,
    billing: projection.billing, lock: promptLockState() };
  return imageMode === 'ai-main-translate' ? resolveCombinedImageAction({ ...input,
    availability: translationAvailability, translation: translation.state() }) : resolveSuitePrimaryAction(input);
}
async function readTranslationAvailability(force = false) {
  const draft = listing(); if (!draft) return;
  const binding = JSON.stringify(currentEditorBinding());
  if (!force && translationAvailability.binding === binding) return;
  const requestState = { binding, state: 'loading', available: false, reason: '' }; translationAvailability = requestState;
  renderImageMode();
  try {
    const response = await command('CHECK_TRANSLATION', { listingWorkflowId: draft.id });
    if (translationAvailability !== requestState || binding !== JSON.stringify(currentEditorBinding())) return;
    const data = response.data;
    if (!data || typeof data.available !== 'boolean') throw new Error('图片翻译状态暂不可用，请重新读取');
    translationAvailability = { binding, state: 'ready', available: data.available,
      price: normalizeTranslationPrice(data.price),
      reason: data.available ? '' : ({ MEDIA_PROVIDER_NOT_ALLOWED: '图片翻译模型尚未通过生产验收或配置不完整。', MEDIA_CREATE_DISABLED: 'ERP 当前关闭了图片翻译。', AI_MEDIA_OPERATION_DISABLED: 'ERP 当前关闭了图片翻译。', MEDIA_STORAGE_NOT_READY: '图片存储暂不可用，请稍后重新读取。' }[data.reasonCode] || '当前草稿的图片翻译不可用，请核对 ERP 图片设置后重新读取。') };
  } catch (error) {
    if (translationAvailability !== requestState) return;
    translationAvailability = { binding, state: 'error', available: false, reason: error.message || '图片翻译状态读取失败，请重新读取' };
  }
  renderImageMode();
}
trusted('precision-translation-refresh', () => readTranslationAvailability(true));
const localNotice = make('div', 'precision-local-fields');
const editorState = make('span', '', '编辑售价、货号和实测包装参数后，保存到当前店铺草稿。');
const currency = make('select'); currency.id = 'editor-currency'; currency.setAttribute('aria-label', '售价币种');
currency.append(...['CNY', 'RUB'].map((value) => { const option = make('option', '', value); option.value = value; return option; }));
function renderCurrencyLabels() {
  document.querySelectorAll('.editor-table th').forEach((header) => {
    const label = header.querySelector('.th-label');
    if (label && /价格/.test(label.textContent)) label.childNodes.forEach((child) => {
      if (child.nodeType === 3) child.textContent = child.textContent.replace(/CNY|RUB/g, currency.value);
    });
  });
}
currency.addEventListener('change', () => { markListingEdited('currency'); renderCurrencyLabels(); });
const save = make('button', 'primary', '保存价格与货号'); save.id = 'editor-save-btn';
const packagingSave = make('button', 'primary', '保存包装参数'); packagingSave.id = 'editor-packaging-save-btn';
const replaySave = make('button', 'ghost', '核对上次保存'); replaySave.id = 'editor-replay-btn'; replaySave.hidden = true;
const skuSelection = make('button', 'ghost', '调整 SKU'); skuSelection.id = 'precision-sku-selection';
localNotice.append(editorState, skuSelection, currency, save, packagingSave, replaySave);
element('product-editor').after(localNotice);
const categoryModal = make('div', 'settings-modal'); categoryModal.id = 'editor-category-modal'; categoryModal.hidden = true;
element('ui-scale-root').append(categoryModal);
const categoryPicker = createCategoryDialog({root:categoryModal,getBinding:currentEditorBinding,getProduct:()=>projection.source,
  loadCatalog: async (binding, query) => {
    const response = await command('EDITOR_CATALOG', { binding, listingWorkflowId: binding.listingWorkflowId, query });
    return response.data?.catalog;
  },
  loadAttributePreview:async(binding,preview)=>{
    const response=await command('EDITOR_CATALOG',{binding,listingWorkflowId:binding.listingWorkflowId,query:'',preview});
    return response.data?.catalog?.attributePreview;
  },
  saveSelection:async(binding,selection)=>{
    if(JSON.stringify(binding)!==JSON.stringify(currentEditorBinding()))throw new Error('店铺或草稿已变化，请重新选择类目');
    return saveEditor('CATEGORY',selection);
  },onError:report,
});
const attributes = createOfficialAttributeEditor({
  root: element('ui-scale-root'), send: command, getEditor: () => {
    const data = currentEditorForPublish(); return data ? { ...data, selectedSkuKeys: editorSkuKeys() } : null;
  }, getBinding: currentEditorBinding,
  getBusy: () => projection.busy || saveBusy || Boolean(lastSave), onSave: (value) => saveEditor('ATTRIBUTES', value),
  onDirty: markListingEdited, onReset: () => { for (const key of unsavedListingFields) if (key.startsWith('official-')) unsavedListingFields.delete(key); },
  onChanged: (rebuild) => { if (rebuild) { editorSignature = ''; renderEditor(); } preparationAnalysis?.sync(); }, report, status,
});
let attributeSuggestionReviewed='';
const attributeSuggestionContext=()=>JSON.stringify([editorIdentity(editor),editorSkuKeys(),editor?.category]);
const attributeSuggestions=createAttributeSuggestions({root:element('ui-scale-root'),command,getBinding:currentEditorBinding,
 hasUnsavedAttributes:()=>[...unsavedListingFields].some(key=>key.startsWith('official-')),
 getBusy:()=>projection.busy||saveBusy||Boolean(lastSave),getSkuLabel:key=>projection.skus.find(sku=>sku.key===key)?.label||key,
 onApply:value=>saveEditor('ATTRIBUTE_SUGGESTIONS',value),onSaved:()=>{attributeSuggestionReviewed=attributeSuggestionContext();resumeAfterConfirmedStep('ATTRIBUTE_SUGGESTIONS');},
 onManual:()=>{attributeSuggestionReviewed=attributeSuggestionContext();element('product-editor').scrollIntoView({block:'start'});status('请手工补充官方必填属性；保存后点继续处理，上架前仍会校验完整性。');},report});
const suggestionsOpen=make('button','ghost','自动匹配属性');suggestionsOpen.id='precision-attribute-suggestions-open';attributes.bar.append(suggestionsOpen);
suggestionsOpen.addEventListener('click',event=>{if(event.isTrusted&&!suggestionsOpen.disabled)void attributeSuggestions.open().catch(report);});
const fieldsSection = make('div');
localNotice.replaceWith(fieldsSection);
fieldsSection.append(localNotice, attributes.bar);
const copyEditor = createCopyEditor({ root: element('ui-scale-root'), getEditor: currentEditorForPublish,
  getBinding: currentEditorBinding, getSourceTitle: () => projection.source.title,
  getBusy: () => projection.busy || saveBusy || Boolean(lastSave), reloadEditor: loadEditor, saveEditor,
  readCapability: async () => {
    const binding = currentEditorBinding();
    const response = await command('EDITOR_COPY_CAPABILITY', { binding, listingWorkflowId: binding.listingWorkflowId });
    return response.data?.capability;
  },
  getGenerationPending: () => lastSave?.action === 'COPY_GENERATE' && lastSave.binding.listingWorkflowId === listing()?.id && !saveBusy,
  onDirty: markListingEdited, onReset: () => { for (const key of unsavedListingFields) if (key.startsWith('copy.')) unsavedListingFields.delete(key); }, report });
const pricingTool = createPricingTool({ root: element('ui-scale-root'), getCurrency: () => currency.value,
  command,getBinding:()=>currentEditorForPublish()?currentEditorBinding():null,
  getRows: () => drafts.map(row => ({ skuKey: row.canonicalSkuKey, label: row.sourceSpec,
    cost: projection.skus.find(sku => sku.key === (row.sourceSkuKey || row.canonicalSkuKey))?.priceCny })),
  getContext: () => currentEditorForPublish() ? JSON.stringify([currentEditorBinding(), currency.value,
    drafts.map(row => [row.canonicalSkuKey, row.offerId, row.fields['价格，CNY'], row.fields['折扣前价格，CNY']]),
    projection.skus.map(sku => [sku.key, sku.priceCny])]) : '',
  getBusy: () => projection.busy || saveBusy || Boolean(lastSave),
  applyPrices(value) {
    if (!currentEditorForPublish() || projection.busy || saveBusy || lastSave) throw new Error('草稿状态已变化，请重新计算');
    const selected = editorSkuKeys();
    if (value.items.length !== selected.length || value.items.some(item => !selected.includes(item.skuKey))) throw new Error('所选 SKU 已变化，请重新计算');
    for (const item of value.items) {
      const row = drafts.find(candidate => candidate.canonicalSkuKey === item.skuKey);
      row.fields['价格，CNY'] = item.price; row.fields['折扣前价格，CNY'] = item.oldPrice;
    }
    currency.value = value.currency;
    for (const field of ['价格，CNY', '折扣前价格，CNY', 'currency']) markListingEdited(field);
    editorSignature = ''; render();
    status('已填写计算后的售价与划线价，点击“保存价格与货号”写入当前草稿。', 'ok');
  }, report });
const validationBar = make('div', 'precision-local-fields');
const validationState = make('span', '', '完成文案、图片与必填信息后，校验上架信息。'); validationState.id = 'precision-validation-state';
const copyOpen = make('button', 'ghost', '俄文标题与描述'); copyOpen.id = 'editor-copy-btn';
const validate = make('button', 'primary', '校验上架信息'); validate.id = 'editor-validate-btn';
validationBar.append(validationState, copyOpen, validate); fieldsSection.append(validationBar);
trusted('editor-copy-btn', () => copyEditor.open());
trusted('editor-validate-btn', async () => {
  if (unsavedListingFields.size) throw new Error('有编辑尚未保存，请分别保存后再校验上架信息');
  const schemaRevision = attributes.currentSchemaRevision();
  if (!schemaRevision) throw new Error('请先重新读取当前草稿的官方属性');
  await saveEditor('VALIDATE', { schemaRevision });
});

const publishModal = make('div', 'settings-modal'); publishModal.id = 'precision-publish-modal'; publishModal.hidden = true;
const publishDialog = make('div', 'settings-dialog');
const publishHead = make('div', 'settings-head'); publishHead.append(make('div', 'settings-title', '上传 Ozon · 确认预览'));
const publishClose = make('button', 'ghost', '关闭'); publishClose.id = 'precision-publish-close';
publishClose.addEventListener('click', () => { publishModal.hidden = true; }); publishHead.append(publishClose);
const publishBody = make('div', 'settings-body');
const publishDetails = make('div'); publishDetails.id = 'precision-publish-details';
const publishStatus = make('p'); publishStatus.id = 'precision-publish-status'; publishStatus.setAttribute('role', 'status');
const publishConfirm = make('button', 'primary', '确认上传 Ozon'); publishConfirm.id = 'precision-publish-confirm';
const publishRefresh = make('button', 'ghost', '核对上传状态'); publishRefresh.id = 'precision-publish-refresh';
publishConfirm.disabled = true;
publishBody.append(publishDetails, publishStatus, publishConfirm, publishRefresh);
publishDialog.append(publishHead, publishBody); publishModal.append(publishDialog); element('ui-scale-root').append(publishModal);

function publishBinding() {
  const draft = listing();
  return draft ? { workflowId: draft.id, shopId: draft.shopId, draftRevision: draft.revision, draftVersion: draft.draftVersion } : null;
}
function publishToken() {
  return JSON.stringify([publishBinding(), projection.handoff?.snapshotId, publishEditRevision]);
}
function publishOperationKey(binding = publishBinding()) {
  return binding ? `${binding.shopId}:${binding.workflowId}` : '';
}
function invalidatePublishPreview(message, close = true) {
  publishPreview = null;
  publishMessage = message;
  if (close) publishModal.hidden = true;
}
function markListingEdited(field) {
  unsavedListingFields.add(field || 'field');
  publishEditRevision += 1;
  invalidatePublishPreview('表格有未保存修改，请先保存或重新读取，再预览上传。');
}
function currentEditorForPublish() {
  const binding = publishBinding();
  return binding && editor?.binding.shopId === binding.shopId && editor.binding.listingWorkflowId === binding.workflowId
    && editor.binding.draftRevision === binding.draftRevision && editor.binding.draftVersion === binding.draftVersion ? editor : null;
}
function serverPublishReady() {
  const data = currentEditorForPublish();
  return Boolean(data && data.stage === 'READY_TO_PUBLISH' && data.validation?.status === 'VALID'
    && Array.isArray(data.blockers) && data.blockers.length === 0 && data.freshness
    && ['category', 'attributes', 'content', 'media', 'pricing', 'validation'].every((key) => data.freshness[key] === 'CURRENT'));
}
function publishStateMessage(view) {
  const receipt = view.receiptId ? ` 回执：${view.receiptId}` : '';
  if (view.state === 'SUCCEEDED') return `上传已完成。${receipt}`;
  if (view.state === 'FAILED') return `上传失败：${view.failureCode || '请核对 ERP 回执'}。${receipt}`;
  if (['UNKNOWN_OUTCOME', 'OUTCOME_UNRESOLVED'].includes(view.state)) return '上传结果尚未确认，请核对状态，勿重复确认。';
  if (view.state === 'NOT_COMMITTED') return 'ERP 回执显示尚未提交，请继续核对原操作，勿重复确认。';
  return `上传处理中，仅核对回执，勿重复确认。${receipt}`;
}
function renderPublish() {
  if (publishPreview && publishPreview.token !== publishToken()) invalidatePublishPreview('草稿或店铺已变化，请重新预览上传。');
  const binding = publishBinding();
  const operation = publishOperations.get(publishOperationKey(binding));
  publishConfirm.disabled = publishBusy || projection.busy || !publishPreview || Boolean(operation) || unsavedListingFields.size > 0 || !serverPublishReady();
  publishRefresh.disabled = publishBusy || projection.busy || !binding;
  publishDetails.replaceChildren();
  const shop = projection.shops.find((item) => item.id === binding?.shopId);
  if (publishPreview) {
    const view = publishPreview.view;
    publishDetails.append(make('p', '', `${shop?.name || view.shopId} · ${view.selectedSkuKeys.length} 个 SKU · ${view.orderedMedia.length} 个图片槽`));
    publishDetails.append(make('p', '', '确认后按以下顺序上传 ERP 已保存的图片：'));
    const order = make('ol');
    for (const media of [...view.orderedMedia].sort((left, right) => left.ordinal - right.ordinal)) {
      const sku = projection.skus.find((item) => item.key === media.skuKey);
      const origin = { SOURCE: '来源图', REVIEWED: '审核图', GENERATED: '生成图', TRANSLATED: '翻译图', EDITED: '修图' }[media.source] || '图片';
      order.append(make('li', '', `${media.scope === 'PRODUCT' ? '商品' : sku?.label || media.skuKey} · ${media.slotKey} · ${origin}`));
    }
    for (const video of view.videoBindings || []) publishDetails.append(make('p', '',
      `${video.skuKey ? `SKU ${video.skuKey}` : '所有 SKU'} · ${video.role === 'MAIN' ? '主图视频' : '富内容视频'} · ${video.url}`));
    publishDetails.append(order);
  } else {
    publishDetails.append(make('p', '', shop ? `店铺：${shop.name}` : '请先选择有草稿的店铺'));
    const data = currentEditorForPublish();
    if (data) {
      const stage = { READY_TO_PUBLISH: '待上架', PUBLISHED: '已上架', CATEGORY_REVIEW: '类目审核', VALIDATION: '草稿核验' }[data.stage] || '草稿处理中';
      publishDetails.append(make('p', '', `${stage} · ${data.validation?.status === 'VALID' ? '已核验' : '待核验'} · 草稿 v${binding.draftVersion}`));
      for (const blocker of data.blockers || []) publishDetails.append(make('p', '', blocker.message || '请补齐 ERP 草稿信息'));
      const freshnessLabels = { category: '类目', attributes: '属性', content: '商品内容', media: '图片', pricing: '价格', validation: '最终核验' };
      const stale = Object.keys(freshnessLabels).filter((key) => data.freshness?.[key] === 'STALE');
      if (stale.length) publishDetails.append(make('p', '', `待重新核对：${stale.map((key) => freshnessLabels[key]).join('、')}`));
      if (!Array.isArray(data.mediaAssignments) || !data.mediaAssignments.length) publishDetails.append(make('p', '', '尚无已绑定到草稿的图片，请先审核并应用图片。'));
    }
  }
  publishStatus.textContent = publishMessage || (operation ? publishStateMessage(operation) : '先核对 ERP 预览，再明确确认上传。');
}
function acceptPublishPreview(view, binding, token) {
  if (!view || view.contractVersion !== 'extension-workbench-listing-publish/v1' || view.executionMode !== 'ERP_HOSTED'
    || view.workflowId !== binding.workflowId || view.shopId !== binding.shopId
    || view.basisDraftRevision !== binding.draftRevision || view.basisDraftVersion !== binding.draftVersion
    || view.currentDraftRevision !== binding.draftRevision || view.currentDraftVersion !== binding.draftVersion
    || !/^[a-f0-9]{64}$/u.test(view.previewHash || '') || token !== publishToken()
    || !Array.isArray(view.selectedSkuKeys) || !view.selectedSkuKeys.length || view.selectedSkuKeys.length > 500
    || !Array.isArray(view.selectedMedia) || !Array.isArray(view.orderedMedia) || !view.orderedMedia.length || view.orderedMedia.length > 500
    || view.videoBindings !== undefined && (!Array.isArray(view.videoBindings) || view.videoBindings.length > 1002
      || !view.videoBindings.every(video => video && ['MAIN','RICH_CONTENT'].includes(video.role)
        && (video.skuKey === null || view.selectedSkuKeys.includes(video.skuKey)) && typeof video.url === 'string' && video.url.startsWith('https://')))
    || !view.orderedMedia.every((row) => row && Number.isSafeInteger(row.ordinal) && row.ordinal >= 0
      && ['PRODUCT', 'SKU'].includes(row.scope) && typeof row.slotKey === 'string' && typeof row.assetId === 'string')) {
    throw new Error('ERP 上传预览与当前草稿不一致，请重新读取状态后再预览');
  }
  publishPreview = { view, token };
}
function acceptPublishStatus(view, binding) {
  if (view === null) {
    publishMessage = '未找到已提交的发布回执；已有待核对操作仍保留，请继续核对状态。';
    status(publishMessage, 'warn');
    return;
  }
  if (!view || !['CONFIRMED', 'PREPARING', 'PREPARED', 'DISPATCHING', 'OUTCOME_UNRESOLVED', 'NOT_COMMITTED', 'PENDING', 'SUCCEEDED', 'FAILED'].includes(view.state)
    || view.shopId !== undefined && view.shopId !== binding.shopId
    || view.workflowId !== undefined && view.workflowId !== binding.workflowId) throw new Error('ERP 发布回执不完整，请继续核对状态');
  publishOperations.set(publishOperationKey(binding), view);
  publishMessage = publishStateMessage(view);
  status(publishMessage, view.state === 'SUCCEEDED' ? 'ok' : view.state === 'FAILED' ? 'err' : 'warn');
}
async function openPublish() {
  const binding = publishBinding();
  if (!binding) throw new Error('请先创建当前店铺的 ERP 草稿');
  if (publishBusy) return;
  publishModal.hidden = false;
  publishPreview = null;
  publishMessage = '';
  if (publishOperations.has(publishOperationKey(binding))) { renderPublish(); return; }
  if (unsavedListingFields.size) { publishMessage = '表格有未保存修改，请先保存或重新读取，再预览上传。'; renderPublish(); return; }
  publishBusy = true;
  publishMessage = '正在读取 ERP 草稿与上传预览，尚未执行上传。';
  renderPublish();
  try {
    await loadEditor();
    if (!serverPublishReady()) { publishMessage = '请完成具体待办并校验上架信息；当前 ERP 草稿尚不可上架。'; return; }
    const token = publishToken();
    const current = publishBinding();
    if (!current || current.workflowId !== binding.workflowId || current.shopId !== binding.shopId) throw new Error('店铺草稿已变化，请重新打开上传预览');
    const response = await command('PUBLISH', { listingWorkflowId: current.workflowId, action: 'PREVIEW' });
    acceptPublishPreview(response.data, current, token);
    publishMessage = 'ERP 预览已核对；点击确认上传才会提交到 Ozon。';
  } catch (error) {
    publishMessage = error.message || 'ERP 预览未通过，请补齐草稿';
    throw error;
  } finally { publishBusy = false; renderPublish(); }
}
trusted('precision-publish-confirm', async () => {
  if (publishBusy || !publishPreview || publishPreview.token !== publishToken() || unsavedListingFields.size || !serverPublishReady()) throw new Error('上传预览或 ERP 校验状态已失效，请重新校验并预览');
  const binding = publishBinding();
  if (!binding || publishOperations.has(publishOperationKey(binding))) throw new Error('已有上传操作，请核对原回执');
  const hash = publishPreview.view.previewHash;
  publishPreview = null;
  publishBusy = true;
  publishOperations.set(publishOperationKey(binding), { state: 'DISPATCHING', receiptId: null, failureCode: null });
  publishMessage = '正在提交一次上传，请等待回执，勿重复确认。';
  renderPublish();
  try {
    const response = await command('PUBLISH', { listingWorkflowId: binding.workflowId, action: 'CONFIRM', previewHash: hash });
    acceptPublishStatus(response.data, binding);
    publishPreview = null;
  } catch (error) {
    publishPreview = null;
    if (error.outcome === 'NOT_SUBMITTED') {
      publishOperations.delete(publishOperationKey(binding));
      publishMessage = `尚未提交上传：${error.message}。请重新预览。`;
    } else {
      publishOperations.set(publishOperationKey(binding), { state: 'UNKNOWN_OUTCOME', receiptId: null, failureCode: null });
      publishMessage = '上传结果尚未确认，请核对状态，勿重复确认。';
    }
    report(error);
  } finally { publishBusy = false; renderPublish(); }
});
trusted('precision-publish-refresh', async () => {
  const binding = publishBinding();
  if (!binding || publishBusy) return;
  publishBusy = true;
  renderPublish();
  try {
    const response = await command('PUBLISH', { listingWorkflowId: binding.workflowId, action: 'STATUS' });
    acceptPublishStatus(response.data, binding);
  } finally { publishBusy = false; renderPublish(); }
});

function currentEditorBinding() {
  const draft = listing();
  if (!draft || !projection.handoff) throw new Error('请先创建 ERP 草稿');
  return { snapshotId: projection.handoff.snapshotId, supplyGoodsId: projection.handoff.supplyGoodsId,
    shopId: draft.shopId, listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion };
}
function applyAnalysisVisual(description) {
  const brief=Prompt.compileVisualCreativeBrief(description);
  visualJson.value=JSON.stringify(description,null,2);promptText.value=brief?.prompt||'';
  userPromptEdited=true;visualJsonError='';renderPromptState();
  status('商品视觉 JSON 已用于可编辑创作方向，尚未发起生图。','ok');
}
preparationAnalysis=createPreparationAnalysisView({root:element('ui-scale-root'),runtime:privateRuntime,command,
  getBinding:()=>currentEditorForPublish()?currentEditorBinding():null,getSkuKey:()=>selectedSkuKey,
  getCategoryRevision:()=>{
    const data=currentEditorForPublish(),context=JSON.stringify([editorIdentity(data),data?.category,data?.selectedSkuKeys]);
    if(context!==preparationSchemaContext){preparationSchemaContext=context;preparationSchemaRevision=null;}
    const schema=attributes.currentSchemaRevision();if(schema)preparationSchemaRevision=schema;
    return{catalogRevision:data?.category?.catalogRevision,schemaRevision:preparationSchemaRevision};
  },
  getMedia:()=>eligibleReferenceMedia().filter(item=>!item.skuKeys.length||item.skuKeys.includes(selectedSkuKey)),
  getAttributeNames:()=>new Map(Object.values(attributes.templateMeta()?.fieldMeta||{}).filter(field=>field.attributeId).map(field=>[field.attributeId,field.editorLabel])),
  getBusy:()=>projection.busy||saveBusy||mediaMutationBusy||planSubmissionBusy||Boolean(lastSave),
  getRecoveryBusy:()=>projection.busy||saveBusy||mediaMutationBusy||planSubmissionBusy,
  getCopyCandidates:()=>currentEditorForPublish()?.copy?.pendingCandidates||[],
  onCuration(keys,analyzedKeys){for(const key of analyzedKeys)referenceKeys.delete(key);for(const key of keys.slice(0,5))referenceKeys.add(key);referenceSelectionInitialized=true;mediaSignature='';renderMedia();},
  onVisual:applyAnalysisVisual,
  onAttributes:async request=>{
    const response=await command('PREPARATION_APPLY',{...request,listingWorkflowId:request.binding.listingWorkflowId});
    const saved=response.data?.application||response.data;
    if(!saved?.binding||saved.binding.shopId!==request.binding.shopId||saved.binding.listingWorkflowId!==request.binding.listingWorkflowId)throw Object.assign(new Error('AI 属性保存回执不完整，请核对原保存'),{outcome:'UNKNOWN_OUTCOME'});
    await command('REFRESH');await loadEditor();await attributes.load(true);
    attributeSuggestionReviewed=attributeSuggestionContext();
    status('已按 AI 候选依据保存选中属性，请补齐未确认事实。','ok');
  },
  saveCopy:async(value,replayRequest,beforeDispatch)=>{
    if(replayRequest){lastSave=replayRequest;return saveEditor('COPY_CANDIDATE',value,true);}
    return saveEditor('COPY_CANDIDATE',value,false,beforeDispatch);
  },approveCopy:candidateId=>saveEditor('COPY_APPROVE',{candidateId}),
  onCompleted:step=>{
    if(step==='analysis'&&preparation?.state().status==='RECOVERY_REQUIRED')preparation.markRecovered();
    if(['analysis','analysis-review'].includes(step)&&['WAITING_INPUT','RECOVERY_REQUIRED'].includes(preparation?.state().status))queueMicrotask(()=>{void continuePreparation().catch(report);});
  },onMessage:status,report});
function editorIdentity(data) {
  return data?.binding ? JSON.stringify(['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].map((key) => data.binding[key])) : '';
}
function editorSkuKeys() {
  return editor ? [...editor.selectedSkuKeys, ...(editor.offerRows?.rows || []).map((row) => row.rowKey)] : [];
}
function fieldSavedByAction(action, field) {
  if (action === 'COPY_CANDIDATE' || action === 'COPY_GENERATE') return field.startsWith('copy.');
  if (action === 'ATTRIBUTES' || action==='ATTRIBUTE_SUGGESTIONS') return field.startsWith('official-');
  if (action === 'PACKAGING') return ['毛重，克', '包装长度，毫米', '包装宽度，毫米', '包装高度，毫米'].includes(field);
  if (action === 'PRICING') return ['价格，CNY', '折扣前价格，CNY', '__skuPrefix', 'skuPrefix', 'currency'].includes(field);
  return false;
}
function editorBindingKey(binding) {
  return JSON.stringify(['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion'].map(key => binding[key]));
}
function acceptEditor(data, savedAction = null) {
  const current = currentEditorBinding();
  if (!data || data.contractVersion !== 'extension-listing-editor/v1' || !data.binding
    || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every((key) => data.binding[key] === current[key])
    || !savedAction && (data.binding.draftRevision !== current.draftRevision || data.binding.draftVersion !== current.draftVersion)
    || !Array.isArray(data.selectedSkuKeys) || data.selectedSkuKeys.length < 1 || data.selectedSkuKeys.length > 100) throw new Error('ERP 草稿详情不完整');
  if (editorIdentity(editor) !== editorIdentity(data)) unsavedListingFields.clear();
  else for (const field of unsavedListingFields) if (fieldSavedByAction(savedAction, field)) unsavedListingFields.delete(field);
  editor = data;
  selectedDraftSkuKeys = new Set(editor.selectedSkuKeys);
  editorLoadKey = editorBindingKey(data.binding);
  editorReadFailureKey = '';
  if (!unsavedListingFields.has('currency')) currency.value = editor.pricing?.items[0]?.currencyCode || 'CNY';
  editorSignature = '';
  render();
}
async function loadEditor() {
  if(editorReadTask)return editorReadTask;
  if (saveBusy || !listing()) return;
  const initialBinding = currentEditorBinding();
  let attemptedKey = editorBindingKey(initialBinding);
  editorLoadKey = attemptedKey;
  editorLoading = true;
  editorReadTask=(async()=>{try {
    const binding = initialBinding;
    let response;
    try {
      response = await command('EDITOR_READ', { listingWorkflowId: binding.listingWorkflowId, binding });
    } catch (error) {
      if (error?.code !== 'EDITOR_CONTEXT_REFRESH_REQUIRED') throw error;
      const refreshed = await command('REFRESH');
      if (!refreshed?.ok) throw error;
      const current = currentEditorBinding();
      if (!['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every(key => current[key] === initialBinding[key])) throw error;
      attemptedKey = editorBindingKey(current);
      editorLoadKey = attemptedKey;
      response = await command('EDITOR_READ', { listingWorkflowId: current.listingWorkflowId, binding: current });
    }
    acceptEditor(response.data?.editor);
    editorState.textContent = editor.fieldIssues?.length ? editor.fieldIssues.map((item) => item.message).join(' ')
      : '修改后请分别保存价格与货号、包装参数。';
  } catch (error) {
    // Stop render-driven retries for this exact binding. The explicit refresh button
    // clears this key; a new draft/revision naturally produces a different key.
    editorReadFailureKey = attemptedKey;
    throw error;
  } finally { editorLoading = false; }})();
  try{return await editorReadTask;}finally{editorReadTask=null;}
}
async function saveEditor(action, value, replay = false, beforeDispatch = null) {
  if (saveBusy) return;
  if (!editor) throw new Error('请先读取 ERP 草稿详情');
  if (lastSave && !replay) throw new Error('上次保存结果尚待核对，请先核对原操作');
  const current = currentEditorBinding();
  if (replay) {
    if (!lastSave || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every((key) => lastSave.binding[key] === current[key])) {
      throw new Error('请回到原来源商品和店铺草稿，再核对原保存操作');
    }
  } else if (!currentEditorForPublish()) throw new Error('草稿版本已变化，请重新读取后保存');
  saveBusy = true;
  let refreshAttributeSchema = false;
  let mutationConfirmed = false;
  let readbackWarning = '';
  render();
  try {
    if (!replay) {
      const request={listingWorkflowId:editor.binding.listingWorkflowId,binding:{...editor.binding},action,value,operationKey:'precision-editor:'+crypto.randomUUID()};
      if(beforeDispatch)await beforeDispatch(request);
      lastSave=request;
    }
    const response = action === 'COPY_GENERATE'
      ? await command('EDITOR_COPY_GENERATE', { binding: lastSave.binding, listingWorkflowId: lastSave.listingWorkflowId,
        operationKey: lastSave.operationKey, ...lastSave.value })
      : await command('EDITOR_SAVE', lastSave);
    acceptEditor(response.data?.editor, action);
    mutationConfirmed = true;
    lastSave=null;replaySave.hidden=true;
    if (action === 'ATTRIBUTES'||action==='ATTRIBUTE_SUGGESTIONS'){
      try{await attributes.afterSave();}catch{readbackWarning='属性已保存，官方字段刷新暂未成功，请使用“刷新官方属性”。';}
    }
    if(action==='ATTRIBUTES')attributeSuggestionReviewed=attributeSuggestionContext();
    copyEditor.afterSave(action, response.data);
    editorState.textContent = response.data?.replayed ? '同次保存已核对，草稿未重复写入。'
      : action === 'COPY_GENERATE' ? '已生成待审核俄文，请检查内容后明确审核。'
        : action === 'COPY_CANDIDATE' ? 'ERP 已保存待审核文案，请预览后明确审核。' : action === 'COPY_APPROVE' ? 'ERP 已审核俄文文案。'
        : action === 'SKU_SELECTION' ? 'SKU 已调整，请重新核对价格、属性、文案与图片。'
          : action === 'SKU_DUPLICATE' ? '已复制来源 SKU，请补充独立货号、包装、价格、图片并重新校验。'
            : action === 'SKU_COPY_REMOVE' ? '已移除复制行，来源 SKU 与历史图片仍保留。'
          : action==='ATTRIBUTE_SUGGESTIONS'?'已按来源证据应用选中属性，请补齐未匹配字段。':action === 'VALIDATE' ? 'ERP 已返回上架校验结果。' : action === 'ATTRIBUTES' ? 'ERP 已保存商品属性。' : action === 'PACKAGING' ? 'ERP 已保存包装参数。' : action === 'PRICING' ? 'ERP 已保存价格与货号。' : 'ERP 已保存官方类目。';
    log(editorState.textContent);
    status(readbackWarning || editorState.textContent, readbackWarning ? 'warn' : 'ok');
    lastSave = null; replaySave.hidden = true;
  } catch (error) {
    if (mutationConfirmed || error.outcome === 'NOT_SUBMITTED') {
      lastSave = null; replaySave.hidden = true;
      refreshAttributeSchema = action === 'ATTRIBUTES' && String(error.code || '').toLowerCase() === 'ozon_attribute_schema_mismatch';
    }
    else replaySave.hidden = false;
    throw error;
  } finally {
    saveBusy = false; render();
    if(mutationConfirmed&&replay&&!session.needsRecovery()&&preparation?.state().status==='RECOVERY_REQUIRED'&&preparation.state().shopId===current.shopId){preparation.markRecovered();}
    if(mutationConfirmed&&!session.needsRecovery()&&action!=='ATTRIBUTE_SUGGESTIONS')resumeAfterConfirmedStep(action);
    if (refreshAttributeSchema) {
      try { await command('REFRESH'); await loadEditor(); await attributes.load(true); }
      catch (error) { report(error); }
    }
  }
}
function resumeAfterConfirmedStep(action){
 const step=preparation?.state().stepId;
 if(preparation?.state().status!=='WAITING_INPUT'||preparation.isRunning())return;
 if(({CATEGORY:'category',ATTRIBUTE_SUGGESTIONS:'attributes',ATTRIBUTES:'attributes',PACKAGING:'packaging',PRICING:'pricing',COPY_APPROVE:'copy'})[action]!==step)return;
 queueMicrotask(()=>{void continuePreparation().catch(report);});
}
trusted('editor-save-btn', () => {
  if (!currentEditorForPublish()) throw new Error('请先读取当前店铺草稿');
  const items = editorSkuKeys().map((skuKey) => {
    const row = drafts.find((draft) => draft.canonicalSkuKey === skuKey);
    if (!row) throw new Error('所选 SKU 与来源已变化，请重新采集');
    const previous = editor.pricing?.items.find((item) => item.skuKey === skuKey);
    const price = String(row.fields['价格，CNY']).trim();
    const oldPrice = String(row.fields['折扣前价格，CNY']).trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price) || Number(price) <= 0
      || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(oldPrice) || Number(oldPrice) < Number(price)) {
      throw new Error(`请填写「${row.sourceSpec}」的正数售价，以及不低于售价的折扣前价格`);
    }
    return { skuKey, price, oldPrice,
      offerId: row.offerId, currencyCode: currency.value, vat: previous?.vat || '0' };
  });
  return saveEditor('PRICING', { contractVersion: 'ozon-listing-pricing/v1', items });
});
trusted('editor-packaging-save-btn', () => {
  if (!currentEditorForPublish()) throw new Error('请先读取当前店铺草稿');
  const items = editorSkuKeys().map((skuKey) => {
    const row = drafts.find((draft) => draft.canonicalSkuKey === skuKey);
    if (!row) throw new Error('所选 SKU 与来源已变化，请重新读取');
    const item = { skuKey };
    for (const [name, field] of [['weightG', '毛重，克'], ['lengthMm', '包装长度，毫米'], ['widthMm', '包装宽度，毫米'], ['heightMm', '包装高度，毫米']]) {
      const text = String(row.fields[field] ?? '').trim();
      const measured = Number(text);
      if (!text || !Number.isFinite(measured) || measured <= 0) throw new Error(`请填写「${row.sourceSpec}」的正数包装重量和长、宽、高（克、毫米），未知值请保持为空`);
      item[name] = measured;
    }
    return item;
  });
  return saveEditor('PACKAGING', { items, evidence: ['用户在扩展工作台确认各 SKU 实测包装，重量克、尺寸毫米'] });
});
trusted('editor-replay-btn', () => lastSave ? saveEditor(lastSave.action, lastSave.value, true) : undefined);
trusted('precision-sku-selection', async () => {
  if (!currentEditorForPublish()) throw new Error('请先读取当前店铺草稿');
  if (unsavedListingFields.size || lastSave) throw new Error('有编辑尚未保存或核对，请处理后再调整 SKU');
  if (projection.skus.length < 2) { status('来源商品只有一个 SKU，无需调整'); return; }
  const expectedBinding = JSON.stringify(currentEditorBinding());
  const previous = [...editor.selectedSkuKeys];
  const selected = await picker.selectSkuRowsByUI(Workflow.toDonorData(projection), { selectedRowIds: previous });
  if (!selected) return;
  if (expectedBinding !== JSON.stringify(currentEditorBinding())) throw new Error('草稿已变化，请重新选择 SKU');
  const keys = selected.sku_matrix.map(row => row.row_id);
  if (JSON.stringify([...keys].sort()) === JSON.stringify([...previous].sort())) { status('SKU 选择未变化'); return; }
  if (!confirm(`将草稿调整为 ${keys.length} 个 SKU。价格、属性、文案和图片需重新核对，旧发布确认将失效。继续？`)) return;
  await saveEditor('SKU_SELECTION', { selectedSkuKeys: keys });
  selectedDraftSkuKeys = new Set(editor.selectedSkuKeys);
  byok.invalidate();
  invalidatePublishPreview('SKU 已调整，请重新核对商品信息后预览上传。');
  render();
});

function compilePrompt() {
  if (!userPromptEdited && !visualJson.value) {
    visualJson.value = JSON.stringify({ composition: '', background: '', lighting: '', style: '' }, null, 2);
  }
}
function promptLockState() {
  const draft = listing();
  if (!draft) return null;
  const locked = promptPlanLocks.get(draft.id);
  if (locked) return locked;
  if (projection.billing.listingWorkflowId === draft.id && projection.billing.quote) {
    return { status: 'existing' };
  }
  return null;
}
function renderPromptState() {
  const locked = promptLockState();
  promptText.readOnly = negativeText.readOnly = visualJson.readOnly = Boolean(locked);
  const promptCount = Array.from(promptText.value.trim()).length;
  const negativeCount = Array.from(negativeText.value.trim()).length;
  if (locked?.status === 'unknown') {
    promptHint.textContent = '计划提交结果待核对，保留本次方向；请读取 ERP 状态，勿重复创建。';
  } else if (locked?.status === 'submitting') {
    promptHint.textContent = '正在提交本次创作方向，请等待 ERP 响应。';
  } else if (locked?.status === 'existing') {
    promptHint.textContent = '当前草稿已有冻结计划；此处本地草稿不会修改该计划。新方向需使用新的草稿。';
  } else if (locked) {
    promptHint.textContent = '本次套图方向已冻结，ERP 刷新会保留编辑内容。新方向需使用新的草稿。';
  } else {
    promptHint.textContent = `${promptCount}/300 字符；应用于所有套图槽。留空使用 ERP 规则，准备后冻结。`;
  }
  negativeHint.textContent = `${negativeCount}/150 字符；超出上限需手动缩短，不会截断。`;
}
function currentQuoteWitness() {
  const quote = currentMediaContext().billing?.quote;
  if (!quote || !/^[a-f0-9]{64}$/u.test(quote.previewHash || '')) throw new Error('套图报价缺少可核验记录，请重新读取后再确认');
  return { previewHash: quote.previewHash, currency: quote.currency, itemCount: quote.itemCount, maxCostMinor: quote.maximumCostMinor };
}
function currentMediaContext() {
  const draft = listing();
  const billing = draft && projection.billing.state === 'ready' && projection.billing.listingWorkflowId === draft.id
    ? projection.billing : null;
  const history = draft && projection.history.state === 'ready' && projection.history.listingWorkflowId === draft.id
    && projection.history.context?.shopId === draft.shopId
    && projection.history.context.revision === draft.revision
    && projection.history.context.draftVersion === draft.draftVersion ? projection.history : null;
  return { draft, billing, history };
}
function suiteSlotForItem(billing, item) {
  return billing?.suite?.slots.find((slot) => slot.media?.workflowId === item.id
    || slot.slotKey === item.contextSlotKey);
}
function suiteCandidateCanReview(slot, item, output) {
  return slot?.status === 'SUCCEEDED' && slot.media?.canReview === true
    && slot.media.workflowId === item.id && slot.media.outputAssetId === output.id
    && slot.media.reviewStatus === 'PENDING' && item.reviewStatus === 'PENDING'
    && item.status === 'SUCCEEDED' && !item.application;
}
function assignableSuiteSlots(context = currentMediaContext()) {
  if (!context.history || !['SUCCEEDED', 'PARTIAL_FAILURE'].includes(context.billing?.suite?.status)) return [];
  return context.billing.suite.slots.filter((slot) => {
    if (slot.status !== 'SUCCEEDED' || slot.media?.canApply !== true || slot.media.reviewStatus !== 'APPROVED') return false;
    const item = context.history.items.find((candidate) => candidate.id === slot.media.workflowId);
    return item?.status === 'SUCCEEDED' && item.reviewStatus === 'APPROVED' && !item.application
      && item.selectedOutputAssetId === slot.media.outputAssetId
      && item.outputs.some((output) => output.id === slot.media.outputAssetId);
  });
}
async function runMediaMutation(execute) {
  if (mediaMutationBusy || projection.busy) return;
  mediaMutationBusy = true;
  renderMedia();
  try { await execute(); }
  finally { mediaMutationBusy = false; render(); }
}
async function reviewCandidate(workflowId, outputId, decision) {
  const { draft, billing, history } = currentMediaContext();
  const item = history?.items.find((candidate) => candidate.id === workflowId);
  const output = item?.outputs.find((candidate) => candidate.id === outputId);
  if (!draft || !item || !output || item.status !== 'SUCCEEDED'
    || item.reviewStatus !== 'PENDING' || item.application
    || (!billing && item.operation !== 'IMAGE_TRANSLATE')) throw new Error('候选或草稿已变化，请重新读取状态');
  const slot = suiteSlotForItem(billing, item);
  if (slot) {
    if (!suiteCandidateCanReview(slot, item, output)) throw new Error('当前套图槽不允许审核，请重新读取状态');
    await command('EXECUTE_HOSTED_SUITE', { listingWorkflowId: draft.id, action: 'REVIEW_SLOT',
      slotKey: slot.slotKey, decision, costConfirmed: false });
  } else {
    await command('PREPARE_MEDIA_MUTATION', { listingWorkflowId: draft.id, mediaWorkflowId: item.id,
      outputAssetId: output.id, expectedRevision: item.revision,
      action: decision === 'APPROVE' ? 'REVIEW_APPROVE' : 'REVIEW_REJECT' });
  }
  await refreshConfirmedMedia(decision === 'APPROVE' ? '图片审核通过，尚未应用到草稿' : '图片已驳回');
}
function renderEditor() {
  const visibleSkus = draftSkuChoices();
  const signature = JSON.stringify([projection.source.sourceProductId, visibleSkus, editor?.pricing, editor?.packaging, editor?.offerRows, editorIdentity(editor), attributes.signature()]);
  if (signature !== editorSignature) {
    editorSignature = signature;
    const previousRows = new Map(drafts.map((row) => [row.canonicalSkuKey, row]));
    const preserveLocal = Boolean(editorRenderOwner && editorRenderOwner === editorIdentity(editor));
    editorRenderOwner = editorIdentity(editor);
    drafts = visibleSkus.map((sku, index) => {
      const copy = editor?.offerRows?.rows.find((item) => item.rowKey === sku.key);
      const saved = editor?.pricing?.items.find((item) => item.skuKey === sku.key) || copy?.pricing;
      const measured = editor?.packaging?.find((item) => item.skuKey === sku.key) || copy?.packaging;
      const previous = preserveLocal ? previousRows.get(sku.key) : null;
      const fields = { '价格，CNY': saved?.price || '', '毛重，克': measured?.weightG ?? '',
        '包装宽度，毫米': measured?.widthMm ?? '', '包装高度，毫米': measured?.heightMm ?? '',
        '包装长度，毫米': measured?.lengthMm ?? '', '折扣前价格，CNY': saved?.oldPrice || '', ...attributes.fieldValues(sku.key) };
      if (previous) for (const field of Object.keys(fields)) {
        if (unsavedListingFields.has(field) && Object.prototype.hasOwnProperty.call(previous.fields, field)) fields[field] = previous.fields[field];
      }
      const offerId = previous && (unsavedListingFields.has('skuPrefix') || unsavedListingFields.has('__skuPrefix'))
        ? previous.offerId : copy?.offerId || saved?.offerId || sku.sourceSkuId || sku.key;
      return {
      rowIndex: index + 1, skuCode: sku.sourceSkuId || sku.key, offerId,
      canonicalSkuKey: sku.key,
      sourceSkuKey: copy?.sourceSkuKey, isCopiedSku: Boolean(copy),
      title: projection.source.title, sourceSpec: sku.label,
      sourceImageUrl: sku.imageUrl, media: { mainImage: sku.imageUrl },
      fields,
    }; });
    renderProductEditor({ container: element('product-editor'), drafts, templateMeta: attributes.templateMeta(), onOpenLongText: (value) => { try { attributes.openText(value); } catch (error) { report(error); } }, onFieldChange: (change) => {
      try {
        if (attributes.handleChange(change)) {
          for (const row of drafts) {
            const fields = attributes.fieldValues(row.canonicalSkuKey);
            Object.assign(row.fields, fields);
          }
          document.querySelectorAll('#product-editor input[data-field-key]').forEach((input) => {
            if (input.dataset.fieldKey.startsWith('official-')) {
              const row = drafts.find((item) => item.rowIndex === Number(input.dataset.rowIndex));
              if (row) input.value = row.fields[input.dataset.fieldKey];
            }
          });
          return;
        }
      } catch (error) { report(error); return; }
      if (change.scope === 'duplicateSku') {
        const source = drafts.find((row) => row.rowIndex === change.rowIndex);
        if (!currentEditorForPublish() || projection.busy || saveBusy || lastSave) { status('请等待当前操作完成并读取草稿后复制。', 'warn'); return; }
        if (unsavedListingFields.size) { status('请先保存当前表格编辑，再复制该 SKU。', 'warn'); return; }
        if (!source) return;
        if (source.isCopiedSku) {
          if (globalThis.confirm('移除当前复制行？来源 SKU、图片资产和历史记录会保留。'))
            void saveEditor('SKU_COPY_REMOVE', { rowKey: source.canonicalSkuKey }).catch(report);
          return;
        }
        void saveEditor('SKU_DUPLICATE', { sourceSkuKey: source.canonicalSkuKey }).catch(report);
        return;
      }
      markListingEdited(change.fieldKey || change.scope);
      if (change.scope === 'allRows') {
        drafts.forEach((row) => {
          row.fields[change.fieldKey] = change.value;
          if (change.fieldKey === '__skuPrefix') row.offerId = `${String(change.value).trim()}-${row.rowIndex}`;
        });
        document.querySelectorAll('#product-editor input[data-field-key]').forEach((input) => {
          if (input.dataset.fieldKey === change.fieldKey) input.value = String(change.value);
        });
        status('已同步当前表格；点击保存价格与货号提交到 ERP');
        return;
      }
      if (change.scope === 'skuUpload' || change.scope === 'allSkuUpload') {
        drafts.forEach((row) => { if (change.scope === 'allSkuUpload' || row.rowIndex === change.rowIndex) row.uploadEnabled = change.value !== false; });
        return;
      }
      const draft = drafts.find((row) => row.rowIndex === change.rowIndex);
      if (draft && change.scope === 'skuPrefix') {
        draft.offerId = `${String(change.value).trim()}-${draft.rowIndex}`;
        draft.fields[change.fieldKey] = change.value;
      } else if (draft) draft.fields[change.fieldKey] = change.value;
    } });
    document.querySelectorAll('#product-editor .editor-row-copy-btn').forEach((button) => {
      const row = drafts[Number(button.dataset.rowIndex) - 1];
      button.disabled = !currentEditorForPublish() || projection.busy || saveBusy || Boolean(lastSave);
      button.textContent = row?.isCopiedSku ? '移除副本' : '复制';
      button.title = row?.isCopiedSku ? '只移除当前复制行，保留原始来源 SKU。' : '复制当前来源 SKU，服务端会生成独立货号。';
    });
    if (listing()) document.querySelectorAll('#product-editor input[type="checkbox"]').forEach((checkbox) => { checkbox.disabled = true; });
    renderCurrencyLabels();
  }
}
function draftSkuChoices() {
  const draft = listing();
  if (!draft) return projection.skus;
  const data = currentEditorForPublish();
  const previousSameDraft = editor?.binding.listingWorkflowId === draft.id && editor.binding.shopId === draft.shopId
    && editor.binding.snapshotId === projection.handoff?.snapshotId && editor.binding.supplyGoodsId === projection.handoff?.supplyGoodsId ? editor : null;
  const selected = data || previousSameDraft ? (data || previousSameDraft).selectedSkuKeys
    : selectedDraftShopId === draft.shopId && selectedDraftSkuKeys ? [...selectedDraftSkuKeys] : [];
  const byKey = new Map(projection.skus.map((sku) => [sku.key, sku]));
  const rows = selected.map((key) => byKey.get(key)).filter(Boolean);
  for (const copy of (data || previousSameDraft)?.offerRows?.rows || []) {
    const source = byKey.get(copy.sourceSkuKey);
    if (source) rows.push({ ...source, key: copy.rowKey, sourceSkuKey: copy.sourceSkuKey, label: `${source.label} · 复制行` });
  }
  return rows;
}
function eligibleReferenceMedia(skus = draftSkuChoices()) {
  const keys = new Set(skus.map((sku) => sku.key));
  return projection.media.map((item) => ({ ...item, skuKeys: [...item.skuKeys,
    ...(editor?.offerRows?.rows || []).filter(row => item.skuKeys.includes(row.sourceSkuKey)).map(row => row.rowKey)] }))
    .filter((item) => !item.skuKeys.length || item.skuKeys.some((key) => keys.has(key)));
}
function visibleWorkspaceMedia(media) {
  const workspaceState = imageWorkspace.state();
  return workspaceState.open && !workspaceState.all
    ? media.filter(item => !item.skuKeys.length || item.skuKeys.includes(selectedSkuKey)) : media;
}
function renderMedia() {
  const skus = draftSkuChoices();
  if (!skus.some((sku) => sku.key === selectedSkuKey)) selectedSkuKey = skus[0]?.key || '';
  const media = eligibleReferenceMedia(skus);
  const workspaceState = imageWorkspace.state();
  const visibleMedia = visibleWorkspaceMedia(media);
  const eligible = new Set(media.map((item) => item.key));
  for (const key of referenceKeys) if (!eligible.has(key)) referenceKeys.delete(key);
  for (const key of translationKeys) if (!eligible.has(key)) translationKeys.delete(key);
  const translationTarget = listing() ? `${projection.handoff?.snapshotId}:${listing().shopId}:${listing().id}` : '';
  if (['translate', 'ai-main-translate'].includes(imageMode) && translationTarget && translationTarget !== translationSelectionContext) {
    translationSelectionContext = translationTarget;
    translationKeys.clear(); media.slice(0, 5).forEach(item => translationKeys.add(item.key));
  }
  if (!referenceSelectionInitialized && media.length) {
    media.slice(0, 4).forEach((item) => referenceKeys.add(item.key));
    referenceSelectionInitialized = true;
  }
  const signature = JSON.stringify([projection.source.sourceProductId, listing()?.id, selectedSkuKey, workspaceState.all, imageMode, visibleMedia]);
  if (signature !== mediaSignature) {
    mediaSignature = signature;
    library.replaceChildren();
    visibleMedia.forEach((item) => {
      const tile = make('div', `precision-source-tile${referenceKeys.has(item.key) ? ' is-selected' : ''}`);
      tile.dataset.referenceKey = item.key;
      const image = make('img'); image.decoding = 'async';
      image.src = item.url;
      image.alt = roleLabel(item.role);
      image.referrerPolicy = 'no-referrer';
      const label = make('small', '', roleLabel(item.role));
      image.addEventListener('error', () => { tile.classList.add('is-broken'); label.textContent = '预览加载失败'; });
      const check = make('input');
      check.type = 'checkbox';
      check.checked = referenceKeys.has(item.key);
      check.setAttribute('aria-label', `选择${roleLabel(item.role)}`);
      check.addEventListener('change', () => {
        const selectedKeys = ['translate', 'ai-main-translate'].includes(imageMode) ? translationKeys : referenceKeys;
        if (check.disabled || (!['translate', 'ai-main-translate'].includes(imageMode) && promptLockState()) || planSubmissionBusy) {
          check.checked = selectedKeys.has(item.key);
          return;
        }
        if (check.checked && selectedKeys.size >= 5) {
          check.checked = false; status(imageMode === 'translate' ? '每次最多选择 5 张翻译图片' : '最多选择 5 张参考图', 'warn'); return;
        }
        if (check.checked) selectedKeys.add(item.key); else selectedKeys.delete(item.key);
        tile.classList.toggle('is-selected', check.checked);
        renderSelectionCount();
        if (imageMode !== 'translate') compilePrompt();
        renderImageMode();
      });
      const open = make('button', 'ghost preview-button', '预览');
      open.addEventListener('click', () => preview.open({ id: item.key }));
      tile.append(check, image, label, open);
      library.append(tile);
    });
  }
  library.querySelectorAll('input[type="checkbox"]').forEach((check) => {
    const keys = ['translate', 'ai-main-translate'].includes(imageMode) ? translationKeys : referenceKeys;
    check.checked = keys.has(check.closest('.precision-source-tile').dataset.referenceKey);
    check.closest('.precision-source-tile').classList.toggle('is-selected', check.checked);
    check.disabled = (!['translate', 'ai-main-translate'].includes(imageMode) && Boolean(promptLockState())) || planSubmissionBusy || projection.busy || translation.state().busy;
  });
  renderSelectionCount();
  const context = currentMediaContext();
  const billing = context.billing;
  const mediaBusy = projection.busy || mediaMutationBusy;
  suiteState.textContent = describeSuite(billing);
  element('precision-assign').disabled = mediaBusy || !assignableSuiteSlots(context).length;
  const visibleHistory = (context.history?.items || []).filter(item => workspaceState.all || !item.contextSkuKey || item.contextSkuKey === selectedSkuKey);
  imageWorkspace.render(buildSkuImageRows({ skus, media, history: context.history, billing, title: projection.source.title }), selectedSkuKey);
  const nextCandidateSignature = JSON.stringify([context.draft?.id, selectedSkuKey, workspaceState.all, visibleHistory, billing?.suite?.slots]);
  if (candidateSignature !== nextCandidateSignature) {
  candidateSignature = nextCandidateSignature;
  const existingCandidates = new Map([...candidates.querySelectorAll('.precision-candidate')].map(card => [`${card.dataset.candidateWorkflow}:${card.dataset.candidateOutput}`, card]));
  const nextCandidates = [];
  for (const item of visibleHistory) {
    const slot = suiteSlotForItem(billing, item);
    for (const output of item.outputs) {
      const card = existingCandidates.get(`${item.id}:${output.id}`) || make('article', 'precision-candidate');
      card.dataset.candidateWorkflow = item.id;
      card.dataset.candidateOutput = output.id;
      let image = card.querySelector('img');
      if (!image) {
        image = make('img'); image.src = output.url; image.alt = '候选图'; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
        image.addEventListener('click', () => preview.open({ id: `candidate:${output.id}` }));
      } else if (image.getAttribute('src') !== output.url) image.src = output.url;
      const reviewLabel = item.reviewStatus === 'APPROVED' && item.selectedOutputAssetId !== output.id
        ? '历史候选 · 未选用' : reviewStatusLabel(item.reviewStatus);
      card.replaceChildren(image, make('p', '', reviewLabel));
      const canReview = slot ? suiteCandidateCanReview(slot, item, output)
        : item.status === 'SUCCEEDED' && item.reviewStatus === 'PENDING' && !item.application
          && (Boolean(billing) || item.operation === 'IMAGE_TRANSLATE');
      if (canReview) {
        for (const [decision, label] of [['APPROVE', '通过'], ['REJECT', '驳回']]) {
          const button = make('button', 'ghost', label);
          if (slot) button.dataset.suiteSlotKey = slot.slotKey;
          button.dataset.reviewDecision = decision;
          button.disabled = mediaBusy;
          button.addEventListener('click', (event) => {
            if (!event.isTrusted || button.disabled) return;
            void runMediaMutation(() => reviewCandidate(item.id, output.id, decision)).catch(report);
          });
          card.append(button);
        }
      }
      if (item.selectedOutputAssetId === output.id && item.application) {
        card.append(make('p', '', item.application.state === 'APPLIED' ? '已应用到草稿' : '已撤回应用'));
      }
      nextCandidates.push(card);
    }
  }
  candidates.replaceChildren(...nextCandidates);
  if (!nextCandidates.length) candidates.append(make('p', 'precision-candidates-empty', '当前 SKU 还没有图片结果。处理完成后可在这里预览、审核。'));
  }
  candidates.querySelectorAll('button').forEach(button => { button.disabled = mediaBusy; });
  compilePrompt();
  renderPromptState();
  renderImageMode();
  byok.render();
}
function renderSelectionCount() {
  const keys = ['translate', 'ai-main-translate'].includes(imageMode) ? translationKeys : referenceKeys;
  mediaSelectionCount.textContent = `整个草稿已勾选 ${keys.size}/5 张${imageMode === 'translate' ? '翻译图片' : '参考图'}`;
}
function render() {
  band.firstChild.textContent = projection.source.title || '正在读取商品';
  band.lastChild.textContent = `${projection.source.platform} · ${projection.skus.length} SKU · ${projection.media.length} 张图`;
  const select = element('erp-shop-select');
  const nextShopSignature = JSON.stringify(projection.shops.map(shop => [shop.id, shop.name]));
  if (shopSelectSignature !== nextShopSignature) {
    shopSelectSignature = nextShopSignature;
    select.replaceChildren(...projection.shops.map((shop) => { const option = make('option', '', shop.name); option.value = shop.id; return option; }));
  }
  if (!projection.shops.some((shop) => shop.id === selectedShopId)) selectedShopId = projection.shops[0]?.id || '';
  select.value = selectedShopId;
  element('store-switch-btn').textContent = projection.shops.find((shop) => shop.id === selectedShopId)?.name || '选择店铺';
  listing();
  element('start-btn').disabled = projection.busy || session.isActive() || session.needsRecovery() || !sourceReady;
  preparationRecover.disabled=!session.needsRecovery()||session.isActive()||projection.busy||saveBusy;
  if(preparation?.isRunning())element('start-btn').disabled=true;
  element('start-btn').textContent = session.isActive() ? '执行中' : listing() ? '继续编辑' : '开始执行';
  element('confirm-export-btn').disabled = projection.busy || publishBusy || mediaMutationBusy || saveBusy || !listing();
  element('confirm-export-btn').title = '在当前工作台核对 ERP 上传预览与回执';
  element('image-card').hidden = !projection.skus.length;
  element('erp-connection-status').textContent = projection.shops.length ? 'ERP 已连接' : '尚无授权店铺';
  if (projection.error) status(projection.error, 'err');
  renderEditor(); renderMedia();
  sourceVideo.refresh();
  renderPublish();
  element('source-output').textContent = JSON.stringify(Workflow.toDonorData(projection), null, 2);
  element('process-source-summary').replaceChildren(make('div', '', `${projection.skus.length} 个 SKU · ${projection.media.length} 张素材`));
  const draft = listing();
  const binding = draft && projection.handoff ? editorBindingKey(currentEditorBinding()) : '';
  if (binding && binding !== mediaStateBinding && !projection.busy) {
    mediaStateBinding = binding;
    void refreshMediaState().catch(report);
  }
  save.disabled = packagingSave.disabled = !currentEditorForPublish() || projection.busy || saveBusy || Boolean(lastSave);
  skuSelection.disabled = !currentEditorForPublish() || projection.busy || saveBusy || Boolean(lastSave) || unsavedListingFields.size > 0;
  replaySave.disabled = projection.busy || saveBusy;
  attributes.renderState();
  attributeSuggestions.sync();
  suggestionsOpen.disabled=!currentEditorForPublish()?.category||projection.busy||saveBusy||Boolean(lastSave)||[...unsavedListingFields].some(key=>key.startsWith('official-'));
  copyEditor.sync();
  preparationAnalysis?.sync();
  visionTool.sync();
  pricingTool.sync();
  categoryPicker.syncBinding();
  validate.disabled = !currentEditorForPublish() || !attributes.currentSchemaRevision() || projection.busy || saveBusy || Boolean(lastSave);
  copyOpen.disabled = !listing() || projection.busy || saveBusy;
  const validationEditor = currentEditorForPublish();
  validationState.textContent = validationEditor?.blockers?.length ? validationEditor.blockers.map((item) => item.message).join(' ')
    : serverPublishReady() ? 'ERP 校验已通过，所有信息为当前状态，可上架。' : '完成文案、图片与必填信息后，校验上架信息。';
  if (currentEditorForPublish()?.category && !editorLoading && !saveBusy && !projection.busy) void attributes.load().catch(report);
  if (binding && binding !== editorLoadKey && binding !== editorReadFailureKey
    && !projection.busy && !session.isActive() && !editorLoading && !saveBusy) {
    editorLoadKey = binding;
    void loadEditor().catch(report);
  }
  const registrationContext = JSON.stringify([projection.source.sourceProductId, projection.shops.map(shop => shop.id)]);
  if (projection.shops.length && registrationContext !== byokRegistrationContext && !byok.state().registered) {
    byokRegistrationContext = registrationContext;
    void byok.initialize();
  }
  schedulePolling();
}

let mediaReadback = null;
async function refreshMediaState() {
  const draft = listing();
  if (!draft) return;
  const identity = `${draft.id}:${draft.revision}:${draft.draftVersion}`;
  if (mediaReadback?.identity === identity) return mediaReadback.promise;
  const promise = (async () => {
    await command('LOAD_BILLING', { listingWorkflowId: draft.id });
    if (listing()?.id !== draft.id) return;
    await command('LOAD_MEDIA_HISTORY', { listingWorkflowId: draft.id });
  })();
  mediaReadback = { identity, promise };
  try { await promise; } finally { if (mediaReadback?.promise === promise) mediaReadback = null; }
}
async function refreshConfirmedMedia(message) {
  status(message, 'ok'); log(message);
  const draftId = listing()?.id;
  try { await refreshMediaState(); if (listing()?.id === draftId) status(message, 'ok'); }
  catch (error) {
    if (listing()?.id === draftId) {
      status(`${message}；状态刷新暂未完成，请读取最新状态`, 'warn');
      log(`操作回执已确认；只读刷新：${error.message || String(error)}`);
    }
  }
}
function schedulePolling() {
  const suite = projection.billing.suite;
  if (pollingTimer || !suite || !['PLANNED', 'QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(suite.status)
    || pollingAttempts >= 20) return;
  pollingTimer = setTimeout(async () => {
    pollingTimer = 0;
    pollingAttempts += 1;
    try { await refreshMediaState(); } catch (error) { report(error); }
    schedulePolling();
  }, 3000);
}

async function ensureCurrentDraft(){
  if(session.needsRecovery())throw Object.assign(Error('上次采集或建草稿结果尚待核对，请点击“核对建草稿结果”。'),{outcome:'UNKNOWN_OUTCOME'});
  if (listing()) { await loadEditor(); return listing(); }
  log('读取来源商品并选择 SKU');
  const selectedShopAtStart = selectedShopId;
  let draft;
  try{draft = await session.start({ shopId: selectedShopAtStart, selectSkus: async (raw) => {
    const selected = new Set(drafts.filter((row) => row.uploadEnabled !== false).map((row) => row.canonicalSkuKey));
    const result = await picker.selectSkuRowsByUI({ ...raw, sku_matrix: raw.sku_matrix.filter((row) => selected.has(row.row_id)) });
    if(selectedShopId!==selectedShopAtStart)throw Error('选择 SKU 期间店铺已切换，请重新开始当前店铺。');
    if (result) {
      selectedDraftSkuKeys = new Set(result.sku_matrix.map((row) => row.row_id));
      selectedDraftShopId = selectedShopAtStart;
    }
    if (pickerState.skuPickerAuto.timerId) { clearInterval(pickerState.skuPickerAuto.timerId); pickerState.skuPickerAuto.timerId = 0; }
    return result;
  } });}finally{render();}
  if(selectedShopId!==selectedShopAtStart)throw Error('草稿请求已在原店铺完成，请切回原店铺检查后继续。');
  if (draft) { log('ERP 草稿已创建，继续在当前工作台处理图片'); status('草稿已就绪，选择图片处理方式'); }
  render();
  return draft;
}
const preparationBar=make('div','precision-preparation-bar'),preparationState=make('span','','商品准备：采集与 SKU → 类目 → AI 筛图与分析 → 属性/俄文候选 → 图片审核。');preparationState.id='precision-preparation-state';
const preparationContinue=make('button','ghost','继续处理'),preparationStop=make('button','ghost','停止后续步骤'),prepareShops=make('button','ghost','多店连续准备');
const preparationRecover=make('button','ghost','核对建草稿结果');preparationRecover.id='precision-preparation-recover';preparationRecover.disabled=true;
preparationContinue.id='precision-preparation-continue';preparationStop.id='precision-preparation-stop';prepareShops.id='precision-preparation-shops';
const analysisOpen=make('button','ghost','商品 AI 分析');analysisOpen.id='precision-preparation-analysis-open';
analysisOpen.addEventListener('click',event=>{if(event.isTrusted&&!analysisOpen.disabled)void(async()=>{await loadEditor();await attributes.load(true);await preparationAnalysis.open();})().catch(report);});
preparationBar.append(preparationState,analysisOpen,preparationContinue,preparationRecover,preparationStop,prepareShops);fieldsSection.before(preparationBar);
const processStages=make('div','precision-preparation-process');processStages.id='precision-preparation-process';element('ai-output').before(processStages);
preparation=globalThis.SS_ERP_PRECISION_PREPARATION_FLOW.create({
 getSource:()=>JSON.stringify([projection.source.platform,projection.source.sourceProductId,projection.handoff?.snapshotId]),getCurrentShop:()=>selectedShopId,
 selectShop:async shopId=>{if(!projection.shops.some(shop=>shop.id===shopId))throw Error('店铺授权已变化');selectedShopId=shopId;render();await ensureCurrentDraft();},
 onState:value=>{preparationState.textContent=`${projection.shops.find(shop=>shop.id===value.shopId)?.name||'当前商品'}：${value.message}`;preparationContinue.disabled=value.status==='RUNNING'||value.status==='RECOVERY_REQUIRED';preparationStop.disabled=value.status!=='RUNNING'&&value.status!=='WAITING_INPUT';
   renderPreparationProcess(processStages,value);element('process-title').textContent=value.message;
   element('process-detail').textContent='按当前处理阶段展示。图片筛选、商品观察和文案由本次分析生成，请检查后确认。';
   element('process-status-badge').textContent=({RUNNING:'处理中',COMPLETE:'已完成',WAITING_INPUT:'等待确认',RECOVERY_REQUIRED:'核对原请求',STOPPED:'已停止',CONTEXT_CHANGED:'上下文已变化'})[value.status]||'待开始';},
 steps:[
  {id:'draft',label:'读取当前草稿',run:async()=>{await loadEditor();if(!currentEditorForPublish())return{completed:false,message:'请读取当前草稿后继续'};if(lastSave)throw Object.assign(Error('先核对原保存请求'),{outcome:'UNKNOWN_OUTCOME'});return{completed:true};}},
  {id:'category',label:'确认官方类目',run:async()=>{if(currentEditorForPublish()?.category)return{completed:true};await categoryPicker.open();return{completed:false,message:'在当前窗口选择官方类目，保存后继续处理'};}},
  {id:'analysis',label:'AI 筛图、商品视觉与候选生成',isCurrent:()=>preparationAnalysis.current(),run:async()=>{
    await attributes.load(true);
    const result=await preparationAnalysis.run();
    if(result?.receipt)return{completed:true,receipt:{operationKey:result.receipt.operationKey},message:'AI 分析已完成，请检查筛图、视觉、属性与俄文候选'};
    if(result?.unavailable){log(result.message);return{completed:true,message:result.message};}
    return{completed:false,message:'商品 AI 分析等待费用确认，可在同窗候选中继续'};
  }},
  {id:'analysis-review',label:'确认图片筛选与视觉候选',run:async()=>{
    if(!preparationAnalysis.current())return{completed:true};
    if(preparationAnalysis.state().review.curationConfirmed)return{completed:true};
    await preparationAnalysis.open();return{completed:false,message:'检查筛图、商品观察和可编辑候选；确认筛图后继续'};
  }},
  {id:'attributes',label:'匹配商品属性',run:async()=>{await attributes.load(true);if(attributeSuggestionReviewed!==attributeSuggestionContext()){await attributeSuggestions.open();return{completed:false,message:'检查自动匹配属性并确认应用，未匹配字段在原表格补充后继续'};}return{completed:true};}},
  {id:'packaging',label:'确认包装',run:async()=>{if(currentEditorForPublish()?.packaging.length===editorSkuKeys().length)return{completed:true};element('product-editor').scrollIntoView({block:'start'});return{completed:false,message:'填写当前 SKU 实测包装并保存，随后继续'};}},
  {id:'pricing',label:'计算售价',run:async()=>{const data=currentEditorForPublish();if(data?.pricing?.items.length===data.selectedSkuKeys.length&&data.freshness?.pricing==='CURRENT')return{completed:true};pricingTool.open();return{completed:false,message:'按店铺物流计算并预览售价，保存价格后继续'};}},
  {id:'copy',label:'确认俄文文案',run:async()=>{if(currentEditorForPublish()?.copy.titleRu&&editor.freshness?.content==='CURRENT')return{completed:true};
    if(preparationAnalysis.current()){await preparationAnalysis.open();return{completed:false,message:'编辑同一分析返回的俄文候选，保存为待审核文案并明确审核后继续'};}
    await copyEditor.open();return{completed:false,message:'生成或编辑俄文文案，预览并明确审核后继续'};}},
  {id:'media',label:'处理商品图片',run:async()=>{const data=currentEditorForPublish();if(data?.mediaAssignments?.length&&data.freshness?.media==='CURRENT')return{completed:true};imageWorkspace.open(selectedSkuKey);renderMedia();return{completed:false,message:'在图片窗口处理、审核并应用素材，确认费用后才会生图'};}},
  {id:'validation',label:'校验上架信息',run:async()=>{if(unsavedListingFields.size)return{completed:false,message:'还有编辑尚未保存，请保存后继续'};await attributes.load(true);await saveEditor('VALIDATE',{schemaRevision:attributes.currentSchemaRevision()});return{completed:serverPublishReady(),message:editor.blockers?.map(item=>item.message).join('；')||'检查上架信息后继续'};}},
 ]});
async function continuePreparation(){if(session.needsRecovery())throw Error('请先核对原采集或建草稿结果');if(lastSave)throw Error('请先核对原保存请求');await preparation.continue();render();}
async function recoverPreparation(){
 const shopAtStart=selectedShopId,sourceAtStart=JSON.stringify([projection.source.platform,projection.source.sourceProductId]);
 const result=await session.recoverCurrentDraft();
 if(shopAtStart!==selectedShopId||sourceAtStart!==JSON.stringify([projection.source.platform,projection.source.sourceProductId]))throw Error('商品或店铺已切换，请回到原上下文核对');
 if(result.state!=='ready')throw Error(result.message||'原采集或建草稿结果仍未核对，不会重新提交');
 if(result.draft&&result.draft.shopId!==shopAtStart)throw Error('请切回原请求的店铺核对草稿');
 if(result.draft)await loadEditor();
 preparation.markRecovered();render();status('原采集或建草稿结果已核对，请点击开始或继续处理。','ok');
}
preparationRecover.addEventListener('click',event=>{if(event.isTrusted&&!preparationRecover.disabled)void recoverPreparation().catch(report).finally(render);});
trusted('start-btn',async()=>{if(!listing()){await ensureCurrentDraft();if(!listing())return;}await preparation.start([selectedShopId]);render();});
preparationContinue.addEventListener('click',event=>{if(event.isTrusted&&!preparationContinue.disabled)void continuePreparation().catch(report);});
preparationStop.addEventListener('click',event=>{if(event.isTrusted)preparation.cancel();});
const queueModal=make('div','settings-modal');queueModal.id='precision-preparation-shop-modal';queueModal.hidden=true;const queueDialog=make('div','settings-dialog'),queueHead=make('div','settings-head');queueHead.append(make('div','settings-title','多店连续准备 · 不自动发布'));
const queueClose=make('button','ghost','关闭');queueClose.addEventListener('click',()=>{queueModal.hidden=true;});queueHead.append(queueClose);const queueBody=make('div','settings-body'),queueStart=make('button','primary','开始所选店铺准备');queueStart.id='precision-preparation-queue-start';queueDialog.append(queueHead,queueBody,queueStart);queueModal.append(queueDialog);element('ui-scale-root').append(queueModal);
prepareShops.addEventListener('click',event=>{if(!event.isTrusted||preparation.isRunning())return;queueBody.replaceChildren();for(const shop of projection.shops){const label=make('label'),input=make('input');input.type='checkbox';input.value=shop.id;input.checked=shop.id===selectedShopId;label.append(input,make('span','',shop.name));queueBody.append(label);}queueModal.hidden=false;});
queueStart.addEventListener('click',event=>{if(!event.isTrusted)return;const shops=[...queueBody.querySelectorAll('input:checked')].map(input=>input.value);queueModal.hidden=true;void(async()=>{if(!shops.length)throw Error('请选择至少一个已授权店铺');selectedShopId=shops[0];render();if(!await ensureCurrentDraft())return;await preparation.start(shops);})().catch(report).finally(render);});
trusted('store-switch-btn', () => openModal('shop-modal'));
trusted('shop-confirm-btn', () => { selectedShopId = element('erp-shop-select').value; element('shop-modal').hidden = true; render(); });
trusted('settings-btn', () => {
  const draft = listing(); const info = element('basic-info');
  const values = [['商品标题', projection.source.title], ['来源平台', projection.source.platform], ['来源类目', projection.source.categoryName || '未提供'],
    ['当前店铺', projection.shops.find(shop => shop.id === selectedShopId)?.name || '未选择'], ['已选 SKU', String(draftSkuChoices().length)], ['来源图片', String(projection.media.length)], ['店铺草稿', draft ? '已创建' : '尚未创建']];
  info.replaceChildren(...values.map(([label, value]) => { const row = make('div', 'field'); row.append(make('label', '', label), make('div', '', value)); return row; }));
  const diagnostics=make('details','precision-preparation-diagnostics');diagnostics.append(make('summary','','高级诊断'),make('pre','',JSON.stringify({draft: draft?{id:draft.id,revision:draft.revision,draftVersion:draft.draftVersion}:null,policy:projection.billing?.policyRevision||'由 ERP 核验'},null,2)));
  info.append(diagnostics);void preparationAnalysis.settings(info,()=>byok.openSettings()).catch(report);
  openModal('basic-modal');
});
trusted('category-select-btn', async () => {
  if (!listing()) throw new Error('请先开始执行并创建草稿');
  if (!editor) await loadEditor();
  await categoryPicker.open();
});
for (const id of ['process-view-btn', 'ai-image-process-btn']) trusted(id, () => openModal('process-modal'));
element('ai-translation-process-btn').textContent = '俄文文案';
trusted('ai-translation-process-btn', () => copyEditor.open());
trusted('process-close-btn', () => { element('process-modal').hidden = true; });
trusted('erp-refresh-btn', async () => {
  if(session.needsRecovery()){await recoverPreparation();return;}
  editorReadFailureKey = '';
  editorLoadKey = '';
  await command('REFRESH');
  await refreshMediaState();
  if (imageMode === 'translate') await readTranslationAvailability(true);
  await loadEditor();
  status('商品、草稿与图片任务已刷新', 'ok');
});
trusted('precision-image-refresh', async () => { await refreshMediaState(); status('图片任务与审核状态已刷新', 'ok'); });
trusted('close-btn', async () => { picker.cancelSelection(); await command('CLOSE'); });
async function suiteCommand(action, costConfirmed = false) {
  if (!listing()) throw new Error('请先开始执行并创建 ERP 草稿');
  const draftId = listing().id;
  let creativeBrief;
  let candidateMediaKeys;
  let referenceSelection;
  let planBinding;
  const quoteWitness = action === 'START' ? currentQuoteWitness() : undefined;
  if (action === 'CREATE_AND_REVIEW_PLAN') {
    if (promptLockState() || planSubmissionBusy) throw new Error('该草稿已有或正在提交套图计划，请读取并继续现有计划');
    if (visualJsonError) throw new Error(visualJsonError);
    creativeBrief = Prompt.compileCreativeBrief({ prompt: promptText.value, negativePrompt: negativeText.value });
    const eligible = new Set(eligibleReferenceMedia().map((item) => item.key));
    const selectedKeys = [...referenceKeys];
    if (!selectedKeys.length) throw new Error('请选择至少一张当前草稿的参考图，再准备套图');
    if (selectedKeys.length > 5 || selectedKeys.some((key) => !eligible.has(key))) throw new Error('参考图与当前草稿不一致，请重新选择');
    referenceSelection = { selectedKeys, eligible: eligibleReferenceMedia() };
    planBinding = JSON.stringify(currentEditorBinding());
    planSubmissionBusy = true;
    promptPlanLocks.set(draftId, { status: 'submitting' });
    render();
  }
  log(action === 'CREATE_AND_REVIEW_PLAN' ? '准备 ERP 套图计划' : '提交图片操作');
  try {
    if (action === 'CREATE_AND_REVIEW_PLAN') {
      candidateMediaKeys = await compileHostedReferenceSelection(referenceSelection.selectedKeys, referenceSelection.eligible);
      if (JSON.stringify(currentEditorBinding()) !== planBinding) {
        throw Object.assign(new Error('草稿已变化，请重新读取后准备套图'), { outcome: 'NOT_SUBMITTED' });
      }
    }
    await command('EXECUTE_HOSTED_SUITE', { listingWorkflowId: draftId, action, slotKey: null, decision: null, costConfirmed,
      ...(action === 'CREATE_AND_REVIEW_PLAN' && imageMode === 'ai-main-translate' ? { galleryGoals: [] } : {}),
      ...(creativeBrief ? { creativeBrief } : {}),
      ...(quoteWitness ? { quoteWitness } : {}),
      ...(candidateMediaKeys ? { candidateMediaKeys } : {}) });
    if (action === 'CREATE_AND_REVIEW_PLAN') promptPlanLocks.set(draftId, { status: 'frozen' });
  } catch (error) {
    if (action === 'CREATE_AND_REVIEW_PLAN') {
      if (error.outcome === 'UNKNOWN_OUTCOME') promptPlanLocks.set(draftId, { status: 'unknown' });
      else promptPlanLocks.delete(draftId);
    }
    throw error;
  } finally {
    if (action === 'CREATE_AND_REVIEW_PLAN') { planSubmissionBusy = false; renderPromptState(); }
  }
  pollingAttempts = 0;
  await refreshConfirmedMedia('图片操作已确认');
}
trusted('precision-assign', () => runMediaMutation(async () => {
  const context = currentMediaContext();
  if (!context.draft || !assignableSuiteSlots(context).length) throw new Error('尚无可应用的已审核套图，请重新读取状态');
  await command('ASSIGN_HOSTED_SUITE', { listingWorkflowId: context.draft.id });
  await refreshConfirmedMedia('图片已应用到草稿');
  if(preparation?.state().status==='WAITING_INPUT'&&preparation.state().stepId==='media')queueMicrotask(()=>{void continuePreparation().catch(report);});
}));
async function startImageWorkflow() {
  if (!imageWorkspace.state().open) {
    imageWorkspace.open(selectedSkuKey, { tab: imageMode === 'ai-suite' && projection.billing.suite ? 'results' : 'sources', all: true });
    return;
  }
  if (imageMode === 'translate') { await startTranslation(); return; }
  if (byokRadio.checked) { await byok.readMediaState(); return; }
  const next = currentImageAction();
  if(next.disabled)return;
  if(next.action==='CHECK'){await readTranslationAvailability(true);return;}
  if(next.action==='EXISTING_SUITE'){imageWorkspace.open(selectedSkuKey,{tab:'results',all:true});status('已有套图计划，请继续该计划；AI 主图＋翻译需在新草稿准备。','warn');return;}
  if(next.action==='TRANSLATE'){
    if(translation.state().queuedCount){imageWorkspace.open(selectedSkuKey,{tab:'results',all:true});return;}
    await startTranslation();return;
  }
  if(next.action==='READ'){await refreshMediaState();status('已读取当前草稿图片任务，请继续当前步骤');return;}
  if(next.action==='PREPARE')return suiteCommand('CREATE_AND_REVIEW_PLAN');
  if(next.action==='CONTINUE')return suiteCommand('CONTINUE');
  if(next.action==='REVIEW'){imageWorkspace.open(selectedSkuKey,{tab:'results',all:true});status('预览并审核当前草稿的图片结果');return;}
  currentQuoteWitness();
  const quote = projection.billing.quote;
  if (confirm(`生成 ${quote.itemCount} 张图片，最高费用 ${quote.currency} ${(quote.maximumCostMinor / 100).toFixed(2)}。确认开始？`)) await suiteCommand('START', true);
}
trusted('image-workflow-start-btn', startImageWorkflow);
trusted('precision-image-primary', startImageWorkflow);
trusted('precision-image-translate', async () => {
  await startTranslation();
});
async function startTranslation() {
  if (!translationAvailability.available || translationAvailability.binding !== JSON.stringify(currentEditorBinding())) throw new Error(translationAvailability.reason || '请先核对当前草稿的图片翻译状态');
  const count = eligibleReferenceMedia().filter(item => translationKeys.has(item.key)).length;
  if (!count) throw new Error('请勾选要翻译的来源图片');
  const price = translationAvailability.price;
  const fee = price ? `每张最高 ${price.currency} ${(price.maximumCostCents / 100).toFixed(2)}，本批最高 ${price.currency} ${(count * price.maximumCostCents / 100).toFixed(2)}。` : '';
  if (!confirm(`翻译已勾选的 ${count} 张图片中的中文文字为俄文，原图保留。${fee}确认提交 ERP 图片翻译？`)) return;
  const view = await translation.start({ ...(price ? { priceConfirmation: {
    currency: price.currency, maximumCostCents: price.maximumCostCents, quoteFingerprint: price.quoteFingerprint,
  } } : {}) });
  status(`${view.queuedCount} 张翻译图片已提交，可重新读取处理状态。`, 'ok');
  await command('LOAD_MEDIA_HISTORY', { listingWorkflowId: listing().id });
}
trusted('confirm-export-btn', openPublish);
trusted('pricing-tool-btn', () => pricingTool.open());
window.addEventListener('message', (event) => {
  if (event.source !== parent || !allowedOrigin(event.origin) || (parentOrigin && event.origin !== parentOrigin)
    || !event.data || event.data.contractVersion !== Contract.CONTRACT_VERSION) return;
  if (event.data.type === 'PROJECTION') {
    if (!parentOrigin) parentOrigin = event.origin;
    if (projection.source.sourceProductId !== event.data.projection?.source?.sourceProductId) {
      selectedDraftSkuKeys = null; selectedDraftShopId = ''; referenceKeys.clear(); referenceSelectionInitialized = false; userPromptEdited = false; mediaStateBinding = '';
      promptText.value = ''; negativeText.value = ''; visualJson.value = ''; visualJsonError = '';
      editor = null; editorLoadKey = '';
      translation.reset(); byok.invalidate(); byokRegistrationContext = '';
      translationKeys.clear(); translationSelectionContext = '';
      translationAvailability = { binding: '', state: 'idle', available: false, reason: '' };
      attributes.reset();
      copyEditor.reset();
      unsavedListingFields.clear(); publishEditRevision += 1; invalidatePublishPreview('来源商品已变化，请重新预览上传。');
    }
    projection = Contract.parseProjection(event.data.projection);
    sourceReady = Boolean(projection.source.sourceProductId && projection.skus.length);
    render();
  } else if (event.data.type === 'COMMAND_RESULT') {
    const task = pending.get(event.data.requestId);
    if (!task) return;
    clearTimeout(task.timer); pending.delete(event.data.requestId);
    if (event.data.ok === true) task.resolve(event.data);
    else task.reject(Object.assign(new Error(event.data.error || 'ERP 操作失败'), {
      code: event.data.code || null,
      outcome: event.data.outcome || (task.mutation ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED'),
    }));
  }
});
window.addEventListener('pagehide', () => {
  byok.invalidate(); privateRuntime?.invalidate();
  clearTimeout(pollingTimer);
  picker.cancelSelection();
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('工作台已关闭')); }
  pending.clear();
});
createUiScaleController().init();
element('language-select').disabled = true;
document.querySelectorAll('input[name="image-workflow-mode"]').forEach((radio) => {
  radio.checked = radio.value === 'ai-suite';
  radio.disabled = false;
});
element('plugin-version').textContent = 'SS ERP 接口适配版';
render();
if (parent !== window) void command('READY').then(() => byok.initialize()).catch(report);
else status('请从 1688、淘宝或拼多多商品页打开精铺工作台', 'warn');
