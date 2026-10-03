import { renderProductEditor } from './donor/ui/modules/product-editor.js';
import { createSkuPickerController } from './donor/ui/presentation/views/sku-picker-view.js';
import { createPreviewController } from './donor/ui/presentation/views/preview-view.js';
import { createUiScaleController } from './donor/ui/presentation/controllers/ui-scale-controller.js';
import { createOfficialAttributeEditor } from './donor/official-attribute-editor.js';
import { createCopyEditor } from './donor/copy-editor.js';
import { createPrecisionPrivateRuntime } from './donor/precision-private-runtime.js';
import { createByokEditor } from './donor/byok-editor.js';
import { createCategoryDialog } from './donor/category-dialog.js';
import { createTranslationFlow } from './donor/translation-flow.js';
import { resolveSuitePrimaryAction } from './donor/suite-primary-action.js';
import { compileHostedReferenceSelection } from './donor/hosted-reference-selection.js';

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
let skuSelectSignature = '';
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
let editorLoading = false;
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
  const mutation = ['COLLECT', 'CREATE_DRAFT', 'EXECUTE_HOSTED_SUITE', 'ASSIGN_HOSTED_SUITE', 'PREPARE_MEDIA_MUTATION', 'EDITOR_SAVE', 'CREATE_TRANSLATION'].includes(type)
    || type === 'PUBLISH' && fields.action === 'CONFIRM';
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Object.assign(new Error('ERP 响应超时，请重新读取状态'), { outcome: mutation ? 'UNKNOWN_OUTCOME' : 'NOT_SUBMITTED' }));
    }, 90000);
    pending.set(requestId, { resolve, reject, timer, type, mutation });
  });
  parent.postMessage(outgoing, parentOrigin || '*');
  return promise;
}

const session = Workflow.createSession({ getProjection: () => projection, send: command });
function listing() { return Workflow.listingForShop(projection, selectedShopId); }
function status(message, variant = '') {
  element('status-text').textContent = message;
  element('status-text').className = `status-pill ${variant}`;
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
    ...eligibleReferenceMedia().map((item) => ({ ...item, id: item.key, originalUrl: item.url, group: 'gallery' })),
    ...(currentMediaContext().history?.items || []).flatMap((item) => item.outputs.map((output) => ({
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
const mediaToolbar = make('div', 'precision-media-toolbar');
mediaToolbar.append(make('strong', '', '草稿 SKU'));
const skuSelect = make('select');
skuSelect.id = 'precision-media-sku';
skuSelect.addEventListener('change', () => { selectedSkuKey = skuSelect.value; });
mediaToolbar.append(skuSelect, make('span', '', '参考图按整个草稿选择；ERP 为每张套图从勾选素材挑选参考。'));
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
for (const [id, label] of [['precision-plan', '准备套图'], ['precision-generate', '确认并生成'], ['precision-continue', '继续任务'], ['precision-assign', '应用已审核图片']]) {
  const button = make('button', 'ghost', label);
  button.id = id;
  suiteActions.append(button);
}
const candidates = make('div', 'precision-candidates');
element('image-queue').append(mediaToolbar, suiteActions, library, promptArea, candidates);
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
const byok = createByokEditor({ root: element('ui-scale-root'), container: element('image-queue'), runtime: privateRuntime,
  getShopId: () => selectedShopId, getBinding: precisionByokBinding,
  openSession: async (value) => (await command('OPEN_EMBEDDED_MEDIA', value)).data,
  getBusy: () => projection.busy || saveBusy || mediaMutationBusy || publishBusy,
  onBound: async () => { await command('REFRESH'); }, report,
  onModeChange: () => renderImageMode() });
const byokMode = make('label');
const byokRadio = make('input'); byokRadio.type = 'radio'; byokRadio.name = 'image-workflow-mode'; byokRadio.value = 'byok';
byokMode.append(byokRadio, make('span', '', '自带 API')); element('image-workflow-mode').append(byokMode);
document.querySelector('input[name="image-workflow-mode"][value="ai-suite"]').closest('label').querySelector('span').textContent = 'ERP 托管套图';
document.querySelectorAll('input[name="image-workflow-mode"]').forEach((input) => input.addEventListener('change', () => {
  if (input.checked) { imageMode = input.value; byok.setMode(imageMode); renderMedia(); }
}));
function renderImageMode() {
  suiteActions.hidden = promptArea.hidden = imageMode !== 'ai-suite';
  candidates.hidden = imageMode === 'byok';
  translationPanel.hidden = imageMode !== 'translate';
  translateImage.hidden = imageMode !== 'translate';
  const button = element('image-workflow-start-btn');
  const suiteAction = resolveSuitePrimaryAction({draftId:listing()?.id,busy:projection.busy||mediaMutationBusy||planSubmissionBusy,
    billing:projection.billing,lock:promptLockState()});
  button.textContent = imageMode === 'translate' ? (translation.state().busy ? '提交翻译中…' : '开始翻译所选图片')
    : imageMode === 'byok' ? '连接自带 API' : suiteAction.label;
  button.disabled = !listing() || projection.busy || mediaMutationBusy || translation.state().busy || translation.state().unknown
    || (imageMode === 'translate' && !translationAvailability.available) || (imageMode === 'ai-suite' && suiteAction.disabled);
  translateImage.disabled = button.disabled;
  translationRefresh.disabled = translationAvailability.state === 'loading' || translation.state().busy;
  if (imageMode === 'translate') {
    if (listing() && projection.handoff) {
      const identity = JSON.stringify(currentEditorBinding());
      if (identity !== translationAvailability.binding) void readTranslationAvailability();
    }
    if (!translation.state().busy && !translation.state().error && !translationAvailability.available) translationState.textContent = translationAvailability.state === 'loading'
      ? '正在核对当前草稿的图片翻译状态…' : translationAvailability.reason || '请先创建当前店铺草稿';
  }
  document.querySelectorAll('input[name="image-workflow-mode"]').forEach(input => { if (input.value !== 'ai-main-translate') input.disabled = translation.state().busy; });
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
      reason: data.available ? '' : ({ MEDIA_PROVIDER_NOT_ALLOWED: '当前环境尚未开放图片翻译。', MEDIA_CREATE_DISABLED: 'ERP 当前关闭了图片翻译。', AI_MEDIA_OPERATION_DISABLED: 'ERP 当前关闭了图片翻译。', MEDIA_STORAGE_NOT_READY: '图片存储暂不可用，请稍后重新读取。' }[data.reasonCode] || '当前草稿的图片翻译不可用，请核对 ERP 图片设置后重新读取。') };
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
localNotice.append(editorState, currency, save, packagingSave, replaySave);
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
  root: element('ui-scale-root'), send: command, getEditor: currentEditorForPublish, getBinding: currentEditorBinding,
  getBusy: () => projection.busy || saveBusy || Boolean(lastSave), onSave: (value) => saveEditor('ATTRIBUTES', value),
  onDirty: markListingEdited, onReset: () => { for (const key of unsavedListingFields) if (key.startsWith('official-')) unsavedListingFields.delete(key); },
  onChanged: (rebuild) => { if (rebuild) { editorSignature = ''; renderEditor(); } }, report, status,
});
const fieldsSection = make('div');
localNotice.replaceWith(fieldsSection);
fieldsSection.append(localNotice, attributes.bar);
const copyEditor = createCopyEditor({ root: element('ui-scale-root'), getEditor: currentEditorForPublish,
  getBinding: currentEditorBinding, getSourceTitle: () => projection.source.title,
  getBusy: () => projection.busy || saveBusy || Boolean(lastSave), reloadEditor: loadEditor, saveEditor,
  onDirty: markListingEdited, onReset: () => { for (const key of unsavedListingFields) if (key.startsWith('copy.')) unsavedListingFields.delete(key); }, report });
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
function editorIdentity(data) {
  return data?.binding ? JSON.stringify(['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].map((key) => data.binding[key])) : '';
}
function fieldSavedByAction(action, field) {
  if (action === 'COPY_CANDIDATE') return field.startsWith('copy.');
  if (action === 'ATTRIBUTES') return field.startsWith('official-');
  if (action === 'PACKAGING') return ['毛重，克', '包装长度，毫米', '包装宽度，毫米', '包装高度，毫米'].includes(field);
  if (action === 'PRICING') return ['价格，CNY', '折扣前价格，CNY', '__skuPrefix', 'skuPrefix', 'currency'].includes(field);
  return false;
}
function acceptEditor(data, savedAction = null) {
  const current = currentEditorBinding();
  if (!data || data.contractVersion !== 'extension-listing-editor/v1' || !data.binding
    || !['snapshotId', 'supplyGoodsId', 'shopId', 'listingWorkflowId'].every((key) => data.binding[key] === current[key])
    || !Array.isArray(data.selectedSkuKeys) || data.selectedSkuKeys.length < 1 || data.selectedSkuKeys.length > 100) throw new Error('ERP 草稿详情不完整');
  if (editorIdentity(editor) !== editorIdentity(data)) unsavedListingFields.clear();
  else for (const field of unsavedListingFields) if (fieldSavedByAction(savedAction, field)) unsavedListingFields.delete(field);
  editor = data;
  selectedDraftSkuKeys = new Set(editor.selectedSkuKeys);
  editorLoadKey = `${data.binding.listingWorkflowId}:${data.binding.draftRevision}:${data.binding.draftVersion}`;
  if (!unsavedListingFields.has('currency')) currency.value = editor.pricing?.items[0]?.currencyCode || 'CNY';
  editorSignature = '';
  render();
}
async function loadEditor() {
  if (editorLoading || saveBusy || !listing()) return;
  editorLoading = true;
  try {
    const binding = currentEditorBinding();
    const response = await command('EDITOR_READ', { listingWorkflowId: binding.listingWorkflowId, binding });
    acceptEditor(response.data?.editor);
    editorState.textContent = editor.fieldIssues?.length ? editor.fieldIssues.map((item) => item.message).join(' ')
      : '修改后请分别保存价格与货号、包装参数。';
  } finally { editorLoading = false; }
}
async function saveEditor(action, value, replay = false) {
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
  render();
  try {
    if (!replay) lastSave = { listingWorkflowId: editor.binding.listingWorkflowId, binding: { ...editor.binding }, action,
      value, operationKey: 'precision-editor:' + crypto.randomUUID() };
    const response = await command('EDITOR_SAVE', lastSave);
    acceptEditor(response.data?.editor, action);
    if (action === 'ATTRIBUTES') await attributes.afterSave();
    copyEditor.afterSave(action, response.data);
    editorState.textContent = response.data?.replayed ? '同次保存已核对，草稿未重复写入。'
      : action === 'COPY_CANDIDATE' ? 'ERP 已保存待审核文案，请预览后明确审核。' : action === 'COPY_APPROVE' ? 'ERP 已审核俄文文案。'
        : action === 'VALIDATE' ? 'ERP 已返回上架校验结果。' : action === 'ATTRIBUTES' ? 'ERP 已保存商品属性。' : action === 'PACKAGING' ? 'ERP 已保存包装参数。' : action === 'PRICING' ? 'ERP 已保存价格与货号。' : 'ERP 已保存官方类目。';
    log(editorState.textContent);
    status(editorState.textContent, 'ok');
    lastSave = null; replaySave.hidden = true;
  } catch (error) {
    if (error.outcome === 'NOT_SUBMITTED') {
      lastSave = null; replaySave.hidden = true;
      refreshAttributeSchema = action === 'ATTRIBUTES' && String(error.code || '').toLowerCase() === 'ozon_attribute_schema_mismatch';
    }
    else replaySave.hidden = false;
    throw error;
  } finally {
    saveBusy = false; render();
    if (refreshAttributeSchema) {
      try { await command('REFRESH'); await loadEditor(); await attributes.load(true); }
      catch (error) { report(error); }
    }
  }
}
trusted('editor-save-btn', () => {
  if (!currentEditorForPublish()) throw new Error('请先读取当前店铺草稿');
  const items = editor.selectedSkuKeys.map((skuKey) => {
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
  const items = editor.selectedSkuKeys.map((skuKey) => {
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
  await refreshMediaState();
  log('ERP 已确认候选审核状态');
}
function renderEditor() {
  const visibleSkus = draftSkuChoices();
  const signature = JSON.stringify([projection.source.sourceProductId, visibleSkus, editor?.pricing, editor?.packaging, editorIdentity(editor), attributes.signature()]);
  if (signature !== editorSignature) {
    editorSignature = signature;
    const previousRows = new Map(drafts.map((row) => [row.canonicalSkuKey, row]));
    const preserveLocal = Boolean(editorRenderOwner && editorRenderOwner === editorIdentity(editor));
    editorRenderOwner = editorIdentity(editor);
    drafts = visibleSkus.map((sku, index) => {
      const saved = editor?.pricing?.items.find((item) => item.skuKey === sku.key);
      const measured = editor?.packaging?.find((item) => item.skuKey === sku.key);
      const previous = preserveLocal ? previousRows.get(sku.key) : null;
      const fields = { '价格，CNY': saved?.price || '', '毛重，克': measured?.weightG ?? '',
        '包装宽度，毫米': measured?.widthMm ?? '', '包装高度，毫米': measured?.heightMm ?? '',
        '包装长度，毫米': measured?.lengthMm ?? '', '折扣前价格，CNY': saved?.oldPrice || '', ...attributes.fieldValues(sku.key) };
      if (previous) for (const field of Object.keys(fields)) {
        if (unsavedListingFields.has(field) && Object.prototype.hasOwnProperty.call(previous.fields, field)) fields[field] = previous.fields[field];
      }
      const offerId = previous && (unsavedListingFields.has('skuPrefix') || unsavedListingFields.has('__skuPrefix'))
        ? previous.offerId : saved?.offerId || sku.sourceSkuId || sku.key;
      return {
      rowIndex: index + 1, skuCode: sku.sourceSkuId || sku.key, offerId,
      canonicalSkuKey: sku.key,
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
        status('复制行尚未接入 ERP 草稿保存，请先使用来源 SKU', 'warn');
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
  return selected.map((key) => byKey.get(key)).filter(Boolean);
}
function eligibleReferenceMedia(skus = draftSkuChoices()) {
  const keys = new Set(skus.map((sku) => sku.key));
  return projection.media.filter((item) => !item.skuKeys.length || item.skuKeys.some((key) => keys.has(key)));
}
function renderMedia() {
  const skus = draftSkuChoices();
  const media = eligibleReferenceMedia(skus);
  const eligible = new Set(media.map((item) => item.key));
  for (const key of referenceKeys) if (!eligible.has(key)) referenceKeys.delete(key);
  for (const key of translationKeys) if (!eligible.has(key)) translationKeys.delete(key);
  const translationTarget = listing() ? `${projection.handoff?.snapshotId}:${listing().shopId}:${listing().id}` : '';
  if (imageMode === 'translate' && translationTarget && translationTarget !== translationSelectionContext) {
    translationSelectionContext = translationTarget;
    translationKeys.clear(); media.slice(0, 5).forEach(item => translationKeys.add(item.key));
  }
  if (!referenceSelectionInitialized && media.length) {
    media.slice(0, 4).forEach((item) => referenceKeys.add(item.key));
    referenceSelectionInitialized = true;
  }
  const signature = JSON.stringify([projection.source.sourceProductId, listing()?.id, skus.map((sku) => sku.key), media]);
  if (signature !== mediaSignature) {
    mediaSignature = signature;
    library.replaceChildren();
    media.forEach((item) => {
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
        const selectedKeys = imageMode === 'translate' ? translationKeys : referenceKeys;
        if (check.disabled || (imageMode !== 'translate' && promptLockState()) || planSubmissionBusy) {
          check.checked = selectedKeys.has(item.key);
          return;
        }
        if (check.checked && selectedKeys.size >= 5) {
          check.checked = false; status(imageMode === 'translate' ? '每次最多选择 5 张翻译图片' : '最多选择 5 张参考图', 'warn'); return;
        }
        if (check.checked) selectedKeys.add(item.key); else selectedKeys.delete(item.key);
        tile.classList.toggle('is-selected', check.checked);
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
    const keys = imageMode === 'translate' ? translationKeys : referenceKeys;
    check.checked = keys.has(check.closest('.precision-source-tile').dataset.referenceKey);
    check.closest('.precision-source-tile').classList.toggle('is-selected', check.checked);
    check.disabled = (imageMode !== 'translate' && Boolean(promptLockState())) || planSubmissionBusy || projection.busy || translation.state().busy;
  });
  const nextSkuSignature = JSON.stringify(skus.map(sku => [sku.key, sku.label]));
  if (nextSkuSignature !== skuSelectSignature) {
    skuSelectSignature = nextSkuSignature;
    skuSelect.replaceChildren(...skus.map((sku) => { const option = make('option', '', sku.label); option.value = sku.key; return option; }));
  }
  if (!skus.some((sku) => sku.key === selectedSkuKey)) selectedSkuKey = skus[0]?.key || '';
  skuSelect.value = selectedSkuKey;
  const context = currentMediaContext();
  const billing = context.billing;
  const quote = billing?.quote;
  const mediaBusy = projection.busy || mediaMutationBusy;
  suiteState.textContent = quote ? `${quote.itemCount} 张 · 最高 ${quote.currency} ${(quote.maximumCostMinor / 100).toFixed(2)} · ${billing.suite?.status || '待开始'}` : projection.billing.error || '先准备套图获取报价';
  element('precision-plan').disabled = mediaBusy || planSubmissionBusy || !listing() || Boolean(promptLockState());
  element('precision-generate').disabled = mediaBusy || !quote?.previewHash || Boolean(billing?.suite);
  element('precision-continue').disabled = mediaBusy || !billing?.suite;
  element('precision-assign').disabled = mediaBusy || !assignableSuiteSlots(context).length;
  const nextCandidateSignature = JSON.stringify([context.draft?.id, context.history?.items, billing?.suite?.slots]);
  if (candidateSignature !== nextCandidateSignature) {
  candidateSignature = nextCandidateSignature;
  const existingCandidates = new Map([...candidates.querySelectorAll('.precision-candidate')].map(card => [`${card.dataset.candidateWorkflow}:${card.dataset.candidateOutput}`, card]));
  const nextCandidates = [];
  for (const item of context.history?.items || []) {
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
  }
  candidates.querySelectorAll('button').forEach(button => { button.disabled = mediaBusy; });
  compilePrompt();
  renderPromptState();
  renderImageMode();
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
  element('start-btn').disabled = projection.busy || session.isActive() || !sourceReady;
  element('start-btn').textContent = session.isActive() ? '执行中' : listing() ? '继续编辑' : '开始执行';
  element('confirm-export-btn').disabled = projection.busy || publishBusy || mediaMutationBusy || saveBusy || !listing();
  element('confirm-export-btn').title = '在当前工作台核对 ERP 上传预览与回执';
  element('image-card').hidden = !projection.skus.length;
  element('erp-connection-status').textContent = projection.shops.length ? 'ERP 已连接' : '尚无授权店铺';
  if (projection.error) status(projection.error, 'err');
  renderEditor(); renderMedia();
  renderPublish();
  element('source-output').textContent = JSON.stringify(Workflow.toDonorData(projection), null, 2);
  element('process-source-summary').replaceChildren(make('div', '', `${projection.skus.length} 个 SKU · ${projection.media.length} 张素材`));
  const draft = listing();
  const binding = draft ? `${draft.id}:${draft.revision}:${draft.draftVersion}` : '';
  if (binding && binding !== mediaStateBinding && !projection.busy) {
    mediaStateBinding = binding;
    void refreshMediaState().catch(report);
  }
  save.disabled = packagingSave.disabled = !currentEditorForPublish() || projection.busy || saveBusy || Boolean(lastSave);
  replaySave.disabled = projection.busy || saveBusy;
  attributes.renderState();
  copyEditor.sync();
  categoryPicker.syncBinding();
  validate.disabled = !currentEditorForPublish() || !attributes.currentSchemaRevision() || projection.busy || saveBusy || Boolean(lastSave);
  copyOpen.disabled = !listing() || projection.busy || saveBusy;
  const validationEditor = currentEditorForPublish();
  validationState.textContent = validationEditor?.blockers?.length ? validationEditor.blockers.map((item) => item.message).join(' ')
    : serverPublishReady() ? 'ERP 校验已通过，所有信息为当前状态，可上架。' : '完成文案、图片与必填信息后，校验上架信息。';
  if (currentEditorForPublish()?.category && !editorLoading && !saveBusy && !projection.busy) void attributes.load().catch(report);
  if (binding && binding !== editorLoadKey && !projection.busy && !session.isActive() && !editorLoading && !saveBusy) {
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

async function refreshMediaState() {
  const draft = listing();
  if (!draft) return;
  await command('LOAD_BILLING', { listingWorkflowId: draft.id });
  await command('LOAD_MEDIA_HISTORY', { listingWorkflowId: draft.id });
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

trusted('start-btn', async () => {
  if (listing()) { element('product-editor').scrollIntoView({ block: 'start' }); status('继续编辑当前店铺草稿'); return; }
  log('读取来源商品并选择 SKU');
  const selectedShopAtStart = selectedShopId;
  const draft = await session.start({ shopId: selectedShopAtStart, selectSkus: async (raw) => {
    const selected = new Set(drafts.filter((row) => row.uploadEnabled !== false).map((row) => row.canonicalSkuKey));
    const result = await picker.selectSkuRowsByUI({ ...raw, sku_matrix: raw.sku_matrix.filter((row) => selected.has(row.row_id)) });
    if (result) {
      selectedDraftSkuKeys = new Set(result.sku_matrix.map((row) => row.row_id));
      selectedDraftShopId = selectedShopAtStart;
    }
    if (pickerState.skuPickerAuto.timerId) { clearInterval(pickerState.skuPickerAuto.timerId); pickerState.skuPickerAuto.timerId = 0; }
    return result;
  } });
  if (draft) { log('ERP 草稿已创建，继续在当前工作台处理图片'); status('草稿已就绪，选择图片处理方式'); }
  render();
});
trusted('store-switch-btn', () => openModal('shop-modal'));
trusted('shop-confirm-btn', () => { selectedShopId = element('erp-shop-select').value; element('shop-modal').hidden = true; render(); });
trusted('settings-btn', () => {
  const draft = listing(); const info = element('basic-info');
  const values = [['商品标题', projection.source.title], ['来源平台', projection.source.platform], ['来源类目', projection.source.categoryName || '未提供'],
    ['当前店铺', projection.shops.find(shop => shop.id === selectedShopId)?.name || '未选择'], ['已选 SKU', String(draftSkuChoices().length)], ['来源图片', String(projection.media.length)], ['店铺草稿', draft ? '已创建' : '尚未创建']];
  info.replaceChildren(...values.map(([label, value]) => { const row = make('div', 'field'); row.append(make('label', '', label), make('div', '', value)); return row; }));
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
trusted('erp-refresh-btn', async () => { await command('REFRESH'); if (imageMode === 'translate') await readTranslationAvailability(true); status('商品与草稿状态已刷新'); });
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
  await refreshMediaState();
  log('ERP 图片操作响应已确认');
}
trusted('precision-plan', () => suiteCommand('CREATE_AND_REVIEW_PLAN'));
trusted('precision-generate', async () => {
  currentQuoteWitness();
  const quote = projection.billing.quote;
  if (!quote) throw new Error('请先准备套图');
  if (confirm(`生成 ${quote.itemCount} 张图片，最高费用 ${quote.currency} ${(quote.maximumCostMinor / 100).toFixed(2)}。确认开始？`)) await suiteCommand('START', true);
});
trusted('precision-continue', () => suiteCommand('CONTINUE'));
trusted('precision-assign', () => runMediaMutation(async () => {
  const context = currentMediaContext();
  if (!context.draft || !assignableSuiteSlots(context).length) throw new Error('尚无可应用的已审核套图，请重新读取状态');
  await command('ASSIGN_HOSTED_SUITE', { listingWorkflowId: context.draft.id });
  await refreshMediaState();
  log('ERP 已确认图片应用结果');
}));
trusted('image-workflow-start-btn', async () => {
  if (imageMode === 'translate') { await startTranslation(); return; }
  if (byokRadio.checked) { await byok.readMediaState(); return; }
  const next=resolveSuitePrimaryAction({draftId:listing()?.id,busy:projection.busy||mediaMutationBusy||planSubmissionBusy,
    billing:projection.billing,lock:promptLockState()});
  if(next.disabled)return;
  if(next.action==='READ'){await refreshMediaState();status('已读取当前草稿图片任务，请继续当前步骤');return;}
  if(next.action==='PREPARE')return suiteCommand('CREATE_AND_REVIEW_PLAN');
  if(next.action==='CONTINUE')return suiteCommand('CONTINUE');
  if(next.action==='REVIEW'){candidates.scrollIntoView({block:'center'});status('预览并审核当前草稿的图片结果');return;}
  currentQuoteWitness();
  const quote = projection.billing.quote;
  if (confirm(`生成 ${quote.itemCount} 张图片，最高费用 ${quote.currency} ${(quote.maximumCostMinor / 100).toFixed(2)}。确认开始？`)) await suiteCommand('START', true);
});
trusted('precision-image-translate', async () => {
  await startTranslation();
});
async function startTranslation() {
  if (!translationAvailability.available || translationAvailability.binding !== JSON.stringify(currentEditorBinding())) throw new Error(translationAvailability.reason || '请先核对当前草稿的图片翻译状态');
  const count = eligibleReferenceMedia().filter(item => translationKeys.has(item.key)).length;
  if (!count) throw new Error('请勾选要翻译的来源图片');
  if (!confirm(`翻译已勾选的 ${count} 张图片中的中文文字为俄文，原图保留。确认提交 ERP 图片翻译？`)) return;
  const view = await translation.start();
  status(`${view.queuedCount} 张翻译图片已提交，可重新读取处理状态。`, 'ok');
  await command('LOAD_MEDIA_HISTORY', { listingWorkflowId: listing().id });
}
trusted('confirm-export-btn', openPublish);
trusted('pricing-tool-btn', () => { element('product-editor').scrollIntoView({ block: 'center' }); status('填写售价、折扣前价与货号，再点击保存价格与货号。'); });
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
  radio.disabled = !['translate', 'ai-suite', 'byok'].includes(radio.value);
  if (radio.disabled) { radio.closest('label').title = '主图与图片翻译的连续处理暂不可用，请分别选择套图或仅翻译'; radio.closest('label').querySelector('span').textContent = 'AI主图+翻译（暂不可用）'; }
});
element('plugin-version').textContent = 'SS ERP 接口适配版';
render();
if (parent !== window) void command('READY').then(() => byok.initialize()).catch(report);
else status('请从 1688、淘宝或拼多多商品页打开精铺工作台', 'warn');
