import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const htmlPath = `${root}/pages/ai-image-workbench.html`;
const launchPath = `${root}/pages/ai-image-workbench-launch.html`;
const cssPath = `${root}/pages/ai-image-workbench.css`;
const pagePath = `${root}/pages/ai-image-workbench.js`;
const workspaceStatePath = `${root}/shared/byok/workbench-workspace-state.js`;
const workspacePagePath = `${root}/pages/ai-image-workbench-workspace.js`;
const hostedPagePath = `${root}/pages/ai-image-workbench-hosted.js`;
const batchClientPath = `${root}/shared/byok/workbench-batch-client.js`;
const batchPagePath = `${root}/pages/ai-image-workbench-batch.js`;
const publishCoordinatorPath = `${root}/shared/publish/workbench-listing-publish-coordinator.js`;
const publishPagePath = `${root}/pages/ai-image-workbench-publish.js`;

for (const path of [
  htmlPath, launchPath, cssPath, pagePath, workspaceStatePath, workspacePagePath,
  hostedPagePath, batchClientPath, batchPagePath, publishCoordinatorPath, publishPagePath,
]) {
  assert.equal(fs.existsSync(path), true, `${path} should exist`);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const launchHtml = fs.readFileSync(launchPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');
const hostedPageSource = fs.readFileSync(hostedPagePath, 'utf8');
const batchPageSource = fs.readFileSync(batchPagePath, 'utf8');
const publishPageSource = fs.readFileSync(publishPagePath, 'utf8');
const verifierSource = fs.readFileSync('scripts/verify-extension-package.mjs', 'utf8');
const preflightSource = fs.readFileSync('scripts/preflight.mjs', 'utf8');

assert.match(html, /ai-image-workbench\.css/u);
assert.match(html, /shared\/byok\/workbench-client\.js/u);
assert.match(html, /shared\/byok\/workbench-batch-client\.js/u);
assert.match(html, /shared\/contracts\/ai-image-workbench-v1\.js/u);
assert.match(html, /shared\/byok\/workbench-workspace-state\.js/u);
assert.match(html, /ai-image-workbench-workspace\.js/u);
assert.match(html, /ai-image-workbench-publish\.js/u);
assert.ok(
  html.indexOf('shared/contracts/ai-image-workbench-v1.js')
    < html.indexOf('shared/byok/workbench-workspace-state.js'),
  'the shared contract must load before workspace state',
);
assert.ok(
  html.indexOf('./ai-image-workbench-workspace.js')
    < html.indexOf('./ai-image-workbench-publish.js')
    && html.indexOf('./ai-image-workbench-publish.js')
      < html.indexOf('./ai-image-workbench-hosted.js'),
  'the unified publish listener must load before hosted work can emit a bound workspace',
);
assert.ok(
  html.indexOf('./ai-image-workbench-hosted.js') < html.indexOf('./ai-image-workbench.js'),
  'the fail-closed hosted authority controller must load before BYOK page startup',
);
assert.ok(
  html.indexOf('./ai-image-workbench-batch.js') < html.indexOf('./ai-image-workbench.js'),
  'the BYOK batch page controller must load before the legacy page delegate',
);
assert.ok(
  html.indexOf('shared/byok/workbench-workspace-state.js')
    < html.indexOf('ai-image-workbench-workspace.js'),
  'workspace state must load before the page controller',
);
assert.match(html, /ai-image-workbench\.js/u);
for (const id of [
  'workspaceRecovery', 'workspaceRecoveryMessage', 'workspaceRecoveryReturnButton',
  'workspaceShell', 'workspaceModeSummary', 'workspaceSkuList', 'workspaceLibraryTabs',
  'workspaceLibraryList', 'workspaceSlotList', 'workspacePromptInspector',
  'workspacePromptInput', 'workspaceNegativePromptInput', 'workspaceSavePromptButton',
  'workspaceReferenceSummary', 'workspaceTaskDock', 'workspaceTaskSummary',
  'batchStatus', 'batchStateBadge', 'batchSlotSelection', 'batchConcurrency',
  'batchAcceptButton', 'batchRecoverButton', 'batchClearButton', 'batchRecoveryList',
  'batchPreviewPanel', 'batchPreviewImage', 'batchPreviewMeta', 'batchPreviewCloseButton',
  'workspacePublishControls', 'workspacePublishMode', 'workspacePublishShop',
  'workspacePublishDraft', 'workspacePublishSkus', 'workspacePublishMedia',
  'workspacePublishOperationStatus', 'workspacePublishConfirmationRow',
  'workspacePublishConfirmation', 'workspacePublishConfirmButton',
  'workspacePublishRefreshButton', 'workspacePublishRecoverButton',
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`, 'u'));
}
assert.match(html, /id=["']executionModeByok["'][^>]*checked/u);
assert.match(html, /id=["']executionModeHosted["'][^>]*disabled/u);
assert.match(html, /id=["']profileSelect["']/u);
assert.match(html, /id=["']promptInput["'][^>]*maxlength=["']8000["']/u);
assert.match(html, /id=["']negativePromptInput["'][^>]*maxlength=["']4000["']/u);
assert.match(html, /id=["']generateButton["']/u);
assert.match(
  html,
  /<select\s+id=["']batchConcurrency["']\s+disabled>\s*<option\s+value=["']1["']>1<\/option>\s*<\/select>/u,
);
assert.match(html, /id=["']rejectButton["']/u);
assert.match(html, /id=["']approveButton["']/u);
assert.match(html, /接收并绑定 ERP/u);
assert.match(html, /id=["']publishPanel["']/u);
assert.match(html, /id=["']publishMediaList["']/u);
assert.match(html, /id=["']publishConfirmation["'][^>]*type=["']checkbox["']/u);
assert.match(html, /id=["']publishConfirmButton["']/u);
assert.match(html, /id=["']publishRecoverButton["']/u);
assert.match(html, /href=["']\.\/ai-provider-settings\.html["'][^>]*target=["']_blank["']/u);
assert.match(html, /id=["']contextKicker["']/u);
assert.match(html, /id=["']contextBadge["']/u);
assert.ok(
  html.indexOf('id="workspaceRecovery"') < html.indexOf('id="workspaceShell"'),
  'an unavailable launch must retain a media-first recovery workspace before live controls',
);
assert.match(
  html,
  /id=["']workspaceRecovery["'][\s\S]*等待来源商品图片[\s\S]*选择图片后在这里预览和处理/u,
  'the recovery surface should preserve the source-library and selected-image mental model',
);
assert.match(html, /id=["']workspaceRecoveryReturnButton["']/u);
assert.match(html, /id=["']flowToolbar["'][\s\S]*data-flow-step=["']context["'][\s\S]*data-flow-step=["']sku["'][\s\S]*data-flow-step=["']media["'][\s\S]*data-flow-step=["']review["']/u,
  'workbench should expose a compact linear flow toolbar');
assert.match(html, /id=["']flowProcessButton["'][^>]*>[\s\S]*任务/u,
  'workbench should keep task progress behind an explicit task action');
assert.match(
  html,
  /id=["']mediaCommandBar["'][\s\S]*id=["']mediaOperationTextToImage["'][\s\S]*id=["']mediaOperationImageToImage["'][\s\S]*id=["']mediaOperationFullEdit["'][\s\S]*id=["']mediaOperationInpaint["'][\s\S]*id=["']mediaPrimaryAction["']/u,
  'the first viewport should expose one compact image-operation command bar',
);
assert.match(html, /id="mediaPrimaryStatus"[^>]*aria-live="polite"[^>]*aria-atomic="true"/u);
assert.match(html, /id="mediaPrimaryAction"[\s\S]{0,220}aria-describedby="mediaPrimaryStatus"/u);
assert.ok(
  html.indexOf('id="mediaPrimaryAction"') < html.indexOf('id="workspaceSlotList"'),
  'generation results must follow the primary image operation instead of interrupting it',
);
assert.ok(
  html.indexOf('id="contextTitle"') < html.indexOf('id="workspaceActionPane"')
    && html.indexOf('id="workspaceActionPane"') < html.indexOf('id="mediaCommandBar"')
    && html.indexOf('id="mediaCommandBar"') < html.indexOf('id="promptInput"')
    && html.indexOf('id="promptInput"') < html.indexOf('id="mediaPrimaryAction"'),
  'the contextual action pane should lead from operation to prompt to one primary action',
);
assert.match(html, /批量槽位规则[\s\S]*仅用于逐槽位提示词/u,
  'advanced slot rules must be distinct from the primary single-operation prompt');
assert.match(html, /<details\s+id=["']batchAdvancedDetails["'][\s\S]*批量与恢复[\s\S]*id=["']batchSlotSelection["']/u,
  'batch slots and recovery should stay behind an advanced disclosure');
assert.match(
  html,
  /<details\s+id=["']byokControlPanel["'][^>]*class=["'][^"']*generation-settings-disclosure[^"']*["'][\s\S]*<summary[^>]*>[\s\S]*生成设置[\s\S]*Provider、批量与恢复/u,
  'Provider and recovery controls should remain available behind one compact disclosure',
);
assert.match(
  html,
  /<details\s+id=["']workspacePromptDisclosure["'][^>]*class=["'][^"']*workspace-prompt-disclosure[^"']*["'][\s\S]*id=["']workspacePromptInspector["']/u,
  'slot prompt controls should stay behind a contextual disclosure instead of occupying a permanent canvas column',
);
assert.match(batchPageSource, /advancedDetails[\s\S]*view\.active[\s\S]*view\.recoveryRows/u,
  'an active or recoverable batch should reopen the advanced disclosure');
assert.match(
  batchPageSource,
  /generationSettingsDetails[\s\S]*view\.active[\s\S]*view\.recoveryRows[\s\S]*generationSettingsDetails\.open\s*=\s*true/u,
  'active or recoverable batch work must also reopen the parent generation settings',
);
assert.match(pageSource, /function setFlowStage\(stage[\s\S]*dataset\.flowStage/u,
  'workbench should switch visible panels by workflow stage');
assert.match(pageSource, /function flowStageAvailable\(stage\)[\s\S]*reviewPublishOnly\(\)[\s\S]*state\.candidate/u,
  'workflow navigation must be gated by the current publish mode and candidate state');
assert.match(pageSource, /function renderFlowState\(\)[\s\S]*flowSummary/u,
  'workbench should summarize the current shop, SKU and candidate state');
assert.match(pageSource, /ORIGIN_NOT_ALLOWED[\s\S]*高级设置检查来源/u,
  'workbench should explain an exact-origin readiness denial');
assert.match(html, /已批准但尚未上传 ERP/u);
assert.doesNotMatch(html, /api[_ -]?key|remember key|记住密钥/iu);
assert.doesNotMatch(html, /<script[^>]*>\s*[^<]/iu, 'workbench page must not use inline scripts');
assert.ok(
  verifierSource.includes('shared/publish/workbench-listing-publish-coordinator.js')
    && verifierSource.includes('pages/ai-image-workbench-publish.js'),
  'the package verifier must require both unified publish modules',
);
for (const testPath of [
  'scripts/extension-workbench-listing-publish-coordinator.test.mjs',
  'scripts/extension-ai-image-workbench-publish-controller.test.mjs',
]) {
  assert.ok(preflightSource.includes(testPath), `preflight must run ${testPath}`);
}
assert.doesNotMatch(html, /https?:\/\//iu, 'workbench page must not load remote assets');
assert.doesNotMatch(launchHtml, /<script|product-|workflow-|api[_ -]?key/iu);
assert.match(css, /@media\s*\(max-width:\s*720px\)/u);
assert.match(css, /\.workspace-shell\s*\{[\s\S]*grid-template-columns/u);
assert.match(
  css,
  /\.workspace-recovery-board\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s+minmax\(0,\s*1\.1fr\)/u,
  'the recovery workspace should keep a stable source/selected two-pane layout on desktop',
);
assert.match(
  css,
  /\.workspace-board\s*\{[\s\S]*grid-template-columns:\s*minmax\(260px,\s*0\.62fr\)\s+minmax\(440px,\s*1\.3fr\)\s+minmax\(340px,\s*0\.9fr\)/u,
  'the primary workspace should keep source, active canvas and current action visible together',
);
assert.match(
  css,
  /\.workspace-library-list\s*\{[\s\S]*grid-template-columns:\s*1fr/u,
  'source media should render as one readable image list instead of narrow card tiles',
);
assert.match(
  html,
  /id=["']workspaceMobileSwitcher["'][\s\S]*data-workspace-mobile-view=["']library["'][\s\S]*data-workspace-mobile-view=["']canvas["'][\s\S]*data-workspace-mobile-view=["']actions["']/u,
  'mobile should switch between focused panes instead of stacking the desktop workspace',
);
assert.match(
  css,
  /@media\s*\(max-width:\s*720px\)[\s\S]*\.workspace-recovery-board\s*\{[\s\S]*grid-template-columns:\s*1fr/u,
  'the recovery workspace should collapse to one column on narrow screens',
);
assert.match(css, /\.workspace-task-dock\s*\{[\s\S]*position:\s*sticky/u);
assert.match(
  css,
  /@media\s*\(max-width:\s*520px\)[\s\S]*\.flow-step-list\s*\{[\s\S]*overflow-x:\s*auto/u,
  'the compact flow toolbar must keep every step reachable on narrow screens',
);
assert.match(
  css,
  /@media\s*\(max-width:\s*520px\)[\s\S]*\.media-operation-bar\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,/u,
  'the primary operation selector should stay stable in two columns on mobile',
);
assert.match(css, /\.media-operation-button\s*\{[\s\S]*min-height:\s*44px/u);
assert.match(
  css,
  /@media\s*\(min-width:\s*721px\)[\s\S]*\.workspace-source-visual\s*\{[\s\S]*height:\s*clamp\(250px,\s*28dvh,\s*360px\)/u,
  'desktop source preview should leave room for operation, prompt and primary action',
);
assert.doesNotMatch(
  css,
  /\.workspace-source-visual\s*\{\s*min-height:\s*420px/u,
  'a late desktop override must not expand the source preview beyond the primary workflow',
);
assert.match(
  css,
  /@media\s*\(min-width:\s*721px\)[\s\S]*\.workspace-source-actions,[\s\S]*\.workspace-action-heading\s*\{[\s\S]*display:\s*none/u,
  'desktop should not repeat source actions and the current-operation heading',
);
assert.match(
  css,
  /@media\s*\(min-width:\s*721px\)\s*\{[\s\S]*\.workspace-organizer-heading\s*\{[\s\S]*display:\s*none/u,
  'desktop should not repeat the workspace title and adapter status above the source-first board',
);
assert.match(
  css,
  /@media\s*\(max-width:\s*720px\)[\s\S]*\.workspace-library-item\s*\{[\s\S]*grid-template-rows:\s*minmax\(68px,\s*auto\)\s+auto[\s\S]*\.workspace-library-item\s+\.workspace-library-select\s*\{[\s\S]*grid-row:\s*1/u,
  'mobile source thumbnails and their action row must occupy separate grid rows',
);
assert.match(pageSource, /function startTextGenerationFromUserAction\(\)/u);
assert.match(pageSource, /function openGenerationSettings\(\)[\s\S]*generationSettingsDetails\.open\s*=\s*true/u);
assert.match(pageSource, /function setWorkspaceRecoveryState\(mode, message\)/u);
assert.match(
  pageSource,
  /workspaceRecoveryReturnButton[\s\S]*event\.isTrusted\s*!==\s*true[\s\S]*global\.close\(\)/u,
  'returning to the source page must require a trusted user action',
);
assert.match(pageSource, /mediaPrimaryAction[\s\S]*event\.isTrusted\s*!==\s*true/u);
assert.match(hostedPageSource, /HOSTED_MODE_STATE_EVENT[\s\S]*hosted-mode-state-change[\s\S]*emit\(HOSTED_MODE_STATE_EVENT/u);
assert.match(hostedPageSource, /modeStateKey[\s\S]*lastModeStateKey[\s\S]*emit\(HOSTED_MODE_STATE_EVENT/u);
assert.match(pageSource, /hosted-mode-state-change[\s\S]*renderMediaPrimaryControls/u);
assert.match(pageSource, /hostedContinuationTarget[\s\S]*hostedCostConfirmation[\s\S]*hostedStartButton/u,
  'Hosted primary navigation focuses explicit cost confirmation before the paid start action');
assert.match(pageSource, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)[\s\S]*behavior:\s*reducedMotion\s*\?\s*'auto'/u);
assert.match(css, /\.context-band\s*\{[\s\S]*position:\s*static/u);
assert.match(
  pageSource,
  /flowProcessButton[\s\S]*workspaceTaskDock\.hidden\s*=\s*false/u,
  'the process action must reveal the task dock before scrolling to it',
);
assert.doesNotMatch(
  pageSource,
  /flowProcessButton[\s\S]{0,700}setFlowStage\([^\n]*true\)/u,
  'the process action must not bypass review-stage availability',
);
assert.match(
  pageSource,
  /WORKSPACE_RUNTIME_EVENT[\s\S]*workspaceRuntimeCandidateState[\s\S]*reconcileFlowStage/u,
  'flow navigation should react to edit, batch, and hosted workspace candidates',
);
assert.match(
  css,
  /data-process-visible=["']true["'][\s\S]*#workspaceTaskDock[\s\S]*display:\s*grid\s*!important/u,
  'the process action should reveal the task dock without entering review',
);
assert.match(css, /@media\s*\(max-width:\s*1120px\)/u);
assert.match(css, /\.workspace-task-dock\s*\{[\s\S]*grid-column:\s*3/u);
assert.match(
  css,
  /@media\s*\(max-width:\s*720px\)[\s\S]*\.workspace-task-dock\s*\{[\s\S]*position:\s*static/u,
);
assert.match(css, /prefers-reduced-motion/u);
assert.match(
  css,
  /body\.is-review-publish-only\s+\.workspace-rail,[\s\S]*#workspacePublishSummary[\s\S]*display:\s*none\s*!important/u,
);
assert.doesNotMatch(
  css,
  /body\.is-review-publish-only\s+\.workbench-grid\s*,/u,
  'review-only publish must not hide the publish dock ancestor',
);
assert.match(
  css,
  /body\.is-review-publish-only\s+\.workbench-grid\s*>\s*:not\(#workspaceTaskDock\)[\s\S]*display:\s*none\s*!important/u,
  'review-only publish must hide every non-publish workbench panel',
);
assert.match(
  css,
  /body\.is-review-publish-only\s+\.workbench-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
  'review-only publish must render its dock in one stable column',
);
assert.match(
  css,
  /body\.is-review-publish-only\s+\.workspace-task-dock\s*\{[\s\S]*position:\s*static/u,
);
assert.doesNotMatch(pageSource, /innerHTML|localStorage|storage\.local|storage\.sync|apiKey/u);
assert.match(pageSource, /event\.isTrusted\s*!==\s*true/u);
assert.match(batchPageSource, /nodes\.concurrency\.disabled\s*=\s*true/u);
assert.match(pageSource, /preview\.revoke\(\)/u);
assert.doesNotMatch(pageSource, /只查询同一幂等回执|不会重新生成或重复上传/u);
assert.match(pageSource, /先核对[^。]*回执[^。]*没有活动[^。]*同一图片字节/u);
assert.match(pageSource, /接收身份不可重用[^。]*候选图已清除[^。]*重新生成/u);
assert.match(pageSource, /getPublishPreview\(\)/u);
assert.match(pageSource, /confirmPublish\(state\.publishPreview\.previewHash\)/u);
assert.match(pageSource, /recoverPublish\(\)/u);
assert.doesNotMatch(html + pageSource, /Ozon 发布仍保持关闭|当前不能发布/u);
assert.match(verifierSource, /pages\/ai-image-workbench\.html/u);
assert.match(verifierSource, /shared\/byok\/workbench-runtime-handler\.js/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-ui\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-runtime-handler\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-source-media-library\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-workspace-state\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-workspace-ui\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-batch-client\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-batch-page-controller\.test\.mjs/u);

class TestNode {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.src = '';
    this.complete = true;
    this.naturalWidth = 1024;
    this.naturalHeight = 1024;
    this.alt = '';
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.className = '';
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
      remove: (...values) => values.forEach((value) => this.classList.values.delete(value)),
      toggle: (value, force) => {
        if (force === true) this.classList.values.add(value);
        else if (force === false) this.classList.values.delete(value);
        else if (this.classList.values.has(value)) this.classList.values.delete(value);
        else this.classList.values.add(value);
      },
    };
  }

  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
}

const ids = [
  'pageStatus', 'contextSource', 'contextShop', 'contextDraft', 'contextSku',
  'contextKicker', 'contextBadge',
  'executionModeByok', 'executionModeHosted', 'profileSelect', 'profileSummary',
  'promptInput', 'negativePromptInput', 'sizeSelect', 'generateButton',
  'resultPanel', 'previewFrame', 'previewImage', 'previewMeta', 'resultStatus', 'rejectButton',
  'approveButton', 'approvedNotice', 'refreshButton',
  'flowToolbar', 'flowSummary', 'flowProcessButton',
  'mediaCommandBar', 'mediaOperationBar', 'mediaPrimaryStatus', 'mediaPrimaryAction',
  'mediaOperationTextToImage', 'mediaOperationImageToImage',
  'mediaOperationFullEdit', 'mediaOperationInpaint', 'advancedSettingsLink',
  'operationTextToImage', 'runEditButton', 'editInputPanel', 'hostedControlPanel',
  'publishPanel', 'publishStatus', 'publishShop', 'publishDraft', 'publishSkuOrder',
  'publishMediaList', 'publishNotice', 'publishConfirmationRow', 'publishConfirmation',
  'publishConfirmButton', 'publishRecoverButton',
  'workspaceShell', 'workspaceTaskDock',
  'workspacePublishControls', 'workspacePublishMode', 'workspacePublishShop',
  'workspacePublishDraft', 'workspacePublishSkus', 'workspacePublishMedia',
  'workspacePublishOperationStatus', 'workspacePublishConfirmationRow',
  'workspacePublishConfirmation', 'workspacePublishConfirmButton',
  'workspacePublishRefreshButton', 'workspacePublishRecoverButton',
  'emptyResult',
];
const nodes = Object.fromEntries(ids.map((id) => [id, new TestNode(
  id,
  id === 'profileSelect' || id === 'sizeSelect' ? 'select'
    : id === 'promptInput' || id === 'negativePromptInput' ? 'textarea'
      : id.endsWith('Button') ? 'button'
        : id === 'previewImage' ? 'img' : 'div',
)]));
nodes.promptInput.value = 'Create a clean catalog hero image for the described product';
nodes.sizeSelect.value = '1024x1024';
nodes.executionModeByok.checked = true;
nodes.executionModeHosted.disabled = true;
nodes.operationTextToImage.checked = true;
nodes.operationTextToImage.value = 'TEXT_TO_IMAGE';

const publicState = {
  contractVersion: 'extension-byok-workbench-public-state/v1',
  executionMode: 'BYOK',
  context: {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 2,
  },
  profiles: [{
    profile: {
      id: 'profile-1', name: 'Relay', baseUrl: 'https://relay.example/v1',
      model: 'image-model-v1', allowedOperations: ['TEXT_TO_IMAGE'], preferences: {},
    },
    hasKey: true,
    permissionState: 'GRANTED',
    textToImageEvidence: {
      operation: 'TEXT_TO_IMAGE', requestMode: 'json', policyRevision: 'policy-7',
      verifiedAt: '2026-07-26T09:00:00.000Z', expiresAt: '2099-07-27T09:00:00.000Z',
    },
  }],
  result: null,
  publish: null,
  generationOutcome: null,
  deliveryState: 'NOT_READY',
};
const readiness = {
  readinessHandle: 'rh_' + 'a'.repeat(48),
  readinessBinding: {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 2, providerOrigin: 'https://relay.example',
    model: 'image-model-v1', operation: 'TEXT_TO_IMAGE', policyRevision: 'policy-7',
  },
  expiresAt: '2099-07-26T10:10:00.000Z',
};
const resultId = 'br_' + 'b'.repeat(48);
const candidateExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const ingestReceipt = {
  contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
  receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'd'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assignmentOrdinal: 2, assignmentSha256: 'e'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};
const publishPreview = {
  contractVersion: 'extension-byok-listing-publish/v1',
  previewHash: '9'.repeat(64),
  shopId: 'shop-1', workflowId: 'workflow-1',
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'd'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 2,
  assignmentSha256: 'e'.repeat(64),
  selectedSkuKeys: ['sku-2', 'sku-1'],
  orderedMedia: [
    {
      ordinal: 0, scope: 'PRODUCT', skuKey: null, slotKey: 'product:hero',
      assetId: 'asset-source', source: 'SOURCE',
    },
    {
      ordinal: 1, scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
      assetId: 'asset-sku-2', source: 'REVIEWED',
    },
    {
      ordinal: 2, scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
      assetId: 'asset-1', source: 'GENERATED',
    },
  ],
};
const calls = [];
let revokeCount = 0;
let generateMode = 'unknown';
let reviewMode = 'valid';
let stateMode = 'valid';
let previewMode = 'valid';
const client = {
  async getPublicState() {
    calls.push(['state']);
    if (stateMode === 'error') throw Object.assign(new Error('stale'), {
      code: 'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE',
    });
    return publicState;
  },
  async getReadiness(profileId) { calls.push(['readiness', profileId]); return readiness; },
  async generate(value) {
    calls.push(['generate', value]);
    if (generateMode === 'unknown') {
      publicState.generationOutcome = 'UNKNOWN_OUTCOME';
      throw Object.assign(new Error('timeout'), {
        code: 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
      });
    }
    return {
      resultId, reviewState: 'CANDIDATE_READY',
      expiresAt: candidateExpiresAt,
      image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
    };
  },
  async openPreview(id) {
    calls.push(['preview', id]);
    if (previewMode === 'error') throw Object.assign(new Error('preview unavailable'), {
      code: 'SS_ERP_BYOK_WORKBENCH_PREVIEW_TIMEOUT',
    });
    return {
      objectUrl: 'blob:workbench-preview',
      metadata: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
      revoke() { revokeCount += 1; },
    };
  },
  async reviewResult(id, decision) {
    calls.push(['review', id, decision]);
    if (reviewMode === 'invalid') return { resultId: 'br_' + 'f'.repeat(48), reviewState: 'APPROVED' };
    if (decision === 'REJECT') publicState.result = null;
    return decision === 'APPROVE'
      ? { resultId: id, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED' }
      : { resultId: id, reviewState: 'REJECTED' };
  },
  async ingestApproved(id) {
    calls.push(['ingest', id]);
    return {
      resultId: id,
      reviewState: 'APPROVED',
      deliveryState: 'BOUND',
      ingest: ingestReceipt,
    };
  },
  async recoverApprovedIngest(id) {
    calls.push(['recover-ingest', id]);
    return {
      resultId: id, reviewState: 'APPROVED', deliveryState: 'BOUND',
      ingest: { ...ingestReceipt, replayed: true },
    };
  },
  async getPublishPreview() {
    calls.push(['publish-preview']);
    return publishPreview;
  },
  async confirmPublish(previewHash) {
    calls.push(['publish-confirm', previewHash]);
    publicState.publish = {
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
    };
    return publicState.publish;
  },
  async recoverPublish() {
    calls.push(['publish-recover']);
    return publicState.publish;
  },
};
let randomByte = 1;
const windowListeners = {};
const runtimeMessageListeners = [];
const context = {
  Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, Uint8Array,
  document: {
    getElementById(id) { return nodes[id] || null; },
    createElement(tagName) { return new TestNode('', tagName); },
  },
  crypto: {
    getRandomValues(bytes) { bytes.fill(randomByte++); return bytes; },
  },
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) { runtimeMessageListeners.push(listener); },
      },
    },
  },
  setTimeout,
  clearTimeout,
};
context.window = context;
context.globalThis = context;
context.addEventListener = (type, listener) => { windowListeners[type] = listener; };
context.SS_ERP_BYOK_WORKBENCH_CLIENT = {
  DEVICE_INVALIDATED_MESSAGE: 'ss-erp:byok-device-session-invalidated',
  createClient() { return client; },
};
context.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER = {
  isActive() { return false; },
  isAvailable() { return true; },
  isByokExecutionAllowed() { return true; },
  async refresh() { return true; },
};

vm.runInNewContext(pageSource, context, { filename: pagePath });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));

assert.equal(nodes.contextSource.textContent, '1688 · product-1');
assert.match(nodes.contextDraft.textContent, /workflow-1.*r3.*v4/u);
assert.equal(nodes.contextSku.textContent, 'sku-1 · 主图 · 追加位置 3');
assert.equal(nodes.profileSelect.value, 'profile-1');
assert.equal(nodes.generateButton.disabled, false);
assert.match(nodes.profileSummary.textContent, /会话密钥已加载.*来源已授权.*能力证据有效/u);
assert.equal(nodes.contextKicker.textContent, '服务器已绑定');
assert.equal(nodes.contextBadge.textContent, '精确草稿');

publicState.result = {
  resultId, reviewState: 'CANDIDATE_READY',
  expiresAt: candidateExpiresAt,
  image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
};
previewMode = 'error';
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.resultPanel.hidden, false);
assert.equal(nodes.rejectButton.disabled, false, 'preview transport failure preserves Reject');
assert.equal(nodes.approveButton.disabled, true);
assert.match(nodes.resultStatus.textContent, /预览.*可驳回/u);
nodes.rejectButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
previewMode = 'valid';
assert.equal(nodes.resultPanel.hidden, true);
assert.equal(nodes.generateButton.disabled, false);

nodes.generateButton.listeners.click({ isTrusted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 0);
nodes.generateButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 1);
assert.equal(nodes.generateButton.disabled, true);
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.generateButton.disabled, true, 'unknown outcome remains locked after refresh');
nodes.generateButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 1);
assert.match(nodes.pageStatus.textContent, /结果仍未知|不会重新提交/u);

publicState.generationOutcome = null;
generateMode = 'success';
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
nodes.generateButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 2);
assert.equal(nodes.previewImage.src, 'blob:workbench-preview');
assert.equal(nodes.resultPanel.hidden, false);
assert.equal(nodes.rejectButton.disabled, false);
assert.equal(nodes.approveButton.disabled, true, 'approval waits for a decoded visible preview');
assert.match(nodes.resultStatus.textContent, /等待审核/u);
nodes.previewImage.src = 'blob:stale-preview';
nodes.previewImage.listeners.load();
assert.equal(nodes.approveButton.disabled, true, 'a stale preview load cannot unlock approval');
nodes.previewImage.src = 'blob:workbench-preview';
nodes.previewImage.listeners.load();
assert.equal(nodes.approveButton.disabled, false);
nodes.previewImage.listeners.error();
assert.equal(nodes.approveButton.disabled, true, 'a preview error revokes approval readiness');
nodes.previewImage.listeners.load();
assert.equal(nodes.approveButton.disabled, false);

const approveReviewsBeforeUntrustedClick = calls.filter(
  (row) => row[0] === 'review' && row[2] === 'APPROVE',
).length;
nodes.approveButton.listeners.click({ isTrusted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter(
  (row) => row[0] === 'review' && row[2] === 'APPROVE',
).length, approveReviewsBeforeUntrustedClick);
reviewMode = 'invalid';
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.approvedNotice.hidden, true, 'a mismatched approval response fails closed');
assert.match(nodes.resultStatus.textContent, /等待审核/u);
reviewMode = 'valid';
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(calls.filter((row) => row[0] === 'review').at(-1).slice(1), [resultId, 'APPROVE']);
assert.equal(nodes.approvedNotice.hidden, false);
assert.match(nodes.resultStatus.textContent, /已批准.*尚未上传 ERP/u);
assert.equal(nodes.generateButton.disabled, true);
assert.equal(nodes.approveButton.disabled, false, 'approved result can advance to ERP ingest');
assert.match(nodes.approveButton.textContent, /接收.*ERP/u);
const readinessCallsBeforeIngest = calls.filter((row) => row[0] === 'readiness').length;
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  calls.filter((row) => row[0] === 'readiness').length,
  readinessCallsBeforeIngest,
  'ingest uses its dedicated server grant instead of generation readiness',
);
const ingestCall = calls.find((row) => row[0] === 'ingest');
assert.equal(ingestCall[1], resultId);
assert.match(nodes.resultStatus.textContent, /已绑定 ERP/u);
assert.match(nodes.approvedNotice.textContent, /receipt-1.*v5/u);
assert.equal(nodes.approveButton.disabled, true);
assert.equal(nodes.previewFrame.hidden, true, 'released Blob preview is hidden after binding');

publicState.result = {
  resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
};
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.match(nodes.approveButton.textContent, /核对.*回执/u);
assert.equal(nodes.rejectButton.disabled, true, 'unknown ingest outcome cannot be deleted blindly');
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'recover-ingest').length, 1);
assert.match(nodes.resultStatus.textContent, /已绑定 ERP/u);

const revokeBeforeExpiry = revokeCount;
publicState.result = {
  resultId, reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED',
  expiresAt: new Date(Date.now() + 20).toISOString(),
  image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
};
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(nodes.resultPanel.hidden, true);
assert.ok(revokeCount > revokeBeforeExpiry, 'candidate expiry must revoke the page object URL');
assert.match(nodes.pageStatus.textContent, /已过期/u);

publicState.result = {
  resultId, reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED',
  expiresAt: candidateExpiresAt,
  image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
};
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
const revokeBeforeInvalidation = revokeCount;
assert.equal(nodes.previewImage.src, 'blob:workbench-preview');
assert.equal(runtimeMessageListeners.length, 1);
runtimeMessageListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
assert.equal(nodes.resultPanel.hidden, true);
assert.equal(nodes.contextKicker.textContent, '服务器绑定不可用');
assert.ok(revokeCount > revokeBeforeInvalidation, 'device invalidation must revoke the page object URL');
assert.match(nodes.pageStatus.textContent, /设备会话已变化/u);

stateMode = 'error';
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.contextSource.textContent, '不可用');
assert.equal(nodes.contextShop.textContent, '不可用');
assert.equal(nodes.contextDraft.textContent, '不可用');
assert.equal(nodes.contextSku.textContent, '不可用');
assert.equal(nodes.contextKicker.textContent, '服务器绑定不可用');
assert.equal(nodes.contextBadge.textContent, '上下文失效');

windowListeners.pagehide();
assert.ok(revokeCount >= 1);
assert.equal(JSON.stringify(calls).includes('apiKey'), false);
assert.equal(JSON.stringify(calls).includes('base64'), false);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function unifiedPublishPreview(value) {
  const selectedSkuKeys = value.selectedMedia
    .filter((row) => row.scope === 'SKU')
    .map((row) => row.skuKey);
  return {
    contractVersion: 'extension-workbench-listing-publish/v1',
    executionMode: value.executionMode,
    shopId: value.binding.shopId,
    workflowId: value.binding.workflowId,
    basisDraftRevision: value.binding.draftRevision,
    basisDraftVersion: value.binding.draftVersion,
    selectedMedia: cloneValue(value.selectedMedia),
    currentDraftRevision: value.binding.draftRevision,
    currentDraftVersion: value.binding.draftVersion,
    previewHash: '8'.repeat(64),
    selectedSkuKeys,
    orderedMedia: value.selectedMedia.map((row, ordinal) => ({
      ordinal,
      scope: row.scope,
      skuKey: row.skuKey,
      slotKey: row.slotKey,
      assetId: row.assetId,
      source: 'GENERATED',
    })),
  };
}

function isolatedPublicState(result = null) {
  const value = cloneValue(publicState);
  value.result = result;
  value.generationOutcome = null;
  value.deliveryState = result?.deliveryState || 'NOT_READY';
  return value;
}

function isolatedCandidate(reviewState = 'CANDIDATE_READY', deliveryState = 'NOT_INGESTED') {
  return {
    resultId,
    reviewState,
    deliveryState,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
  };
}

function createManualTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) { callbacks.delete(id); },
    runAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
  };
}

function createPageHarness(options = {}) {
  const harnessNodes = Object.fromEntries(ids.map((id) => [id, new TestNode(
    id,
    id === 'profileSelect' || id === 'sizeSelect' ? 'select'
      : id === 'promptInput' || id === 'negativePromptInput' ? 'textarea'
        : id.endsWith('Button') ? 'button'
          : id === 'previewImage' ? 'img' : 'div',
  )]));
  harnessNodes.promptInput.value = 'Create a clean catalog hero image';
  harnessNodes.sizeSelect.value = '1024x1024';
  harnessNodes.executionModeByok.checked = true;
  harnessNodes.executionModeHosted.disabled = true;
  const flowButtons = ['context', 'sku', 'media', 'review'].map((stage) => {
    const button = new TestNode(`flow-${stage}`, 'button');
    button.dataset.flowStep = stage;
    return button;
  });
  harnessNodes.flowToolbar.querySelectorAll = (selector) => (
    selector === '[data-flow-step]' ? flowButtons : []
  );

  const authoritative = options.authoritative || { value: isolatedPublicState() };
  const harnessCalls = [];
  let harnessRevokeCount = 0;
  const operations = {
    getPublicState: options.getPublicState || (() => authoritative.value),
    getSourceCatalog: options.getSourceCatalog || (() => ({
      contractVersion: 'extension-byok-workbench-source-catalog/v1',
      items: [],
    })),
    openSourcePreview: options.openSourcePreview || (() => {
      throw new Error('source preview is not expected');
    }),
    getReadiness: options.getReadiness || (() => readiness),
    generate: options.generate || (() => isolatedCandidate()),
    openPreview: options.openPreview || (() => ({
      objectUrl: 'blob:isolated-preview',
      metadata: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
      revoke() { harnessRevokeCount += 1; },
    })),
    reviewResult: options.reviewResult || ((id, decision) => ({
      resultId: id,
      reviewState: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      ...(decision === 'APPROVE' ? { deliveryState: 'NOT_INGESTED' } : {}),
    })),
    ingestApproved: options.ingestApproved || ((id) => ({
      resultId: id, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    })),
    recoverApprovedIngest: options.recoverApprovedIngest || ((id) => ({
      resultId: id, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    })),
    getPublishPreview: options.getPublishPreview || (() => publishPreview),
    confirmPublish: options.confirmPublish || (() => ({
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
    })),
    recoverPublish: options.recoverPublish || (() => ({
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
    })),
    confirmWorkspacePublish: options.confirmWorkspacePublish || ((value, previewHash) => ({
      contractVersion: 'extension-workbench-listing-publish/v1',
      request: cloneValue(value),
      state: 'SUCCEEDED',
      executionMode: value.executionMode,
      shopId: value.binding.shopId,
      workflowId: value.binding.workflowId,
      currentDraftRevision: value.binding.draftRevision,
      currentDraftVersion: value.binding.draftVersion,
      previewHash,
      receiptId: 'workspace-receipt-1',
      failureCode: null,
    })),
  };
  const harnessClient = {
    async getPublicState() { harnessCalls.push(['state']); return operations.getPublicState(); },
    async getSourceCatalog() {
      harnessCalls.push(['source-catalog']);
      return operations.getSourceCatalog();
    },
    async openSourcePreview(sourceMediaKey, purpose) {
      harnessCalls.push(['source-preview', sourceMediaKey, purpose]);
      return operations.openSourcePreview(sourceMediaKey, purpose);
    },
    async getReadiness(profileId) {
      harnessCalls.push(['readiness', profileId]);
      return operations.getReadiness(profileId);
    },
    async generate(input) { harnessCalls.push(['generate', input]); return operations.generate(input); },
    async openPreview(id) { harnessCalls.push(['preview', id]); return operations.openPreview(id); },
    async reviewResult(id, decision) {
      harnessCalls.push(['review', id, decision]);
      return operations.reviewResult(id, decision);
    },
    async ingestApproved(id) { harnessCalls.push(['ingest', id]); return operations.ingestApproved(id); },
    async recoverApprovedIngest(id) {
      harnessCalls.push(['recover-ingest', id]);
      return operations.recoverApprovedIngest(id);
    },
    async getPublishPreview() {
      harnessCalls.push(['publish-preview']);
      return operations.getPublishPreview();
    },
    async confirmPublish(previewHash) {
      harnessCalls.push(['publish-confirm', previewHash]);
      return operations.confirmPublish(previewHash);
    },
    async recoverPublish() {
      harnessCalls.push(['publish-recover']);
      return operations.recoverPublish();
    },
    async getActiveWorkspacePublish() {
      harnessCalls.push(['workspace-active']);
      return null;
    },
    async getWorkspacePublishState(value) {
      harnessCalls.push(['workspace-state', cloneValue(value)]);
      return null;
    },
    async getWorkspacePublishPreview(value) {
      harnessCalls.push(['workspace-preview', cloneValue(value)]);
      return unifiedPublishPreview(value);
    },
    async confirmWorkspacePublish(value, previewHash) {
      harnessCalls.push(['workspace-confirm', cloneValue(value), previewHash]);
      return operations.confirmWorkspacePublish(value, previewHash);
    },
    async recoverWorkspacePublish() {
      throw new Error('workspace recovery is not expected in the page integration fixture');
    },
  };
  const harnessWindowListeners = {};
  const harnessRuntimeListeners = [];
  const harnessDocumentListeners = new Map();
  const harnessDocumentEvents = [];
  const harnessBody = new TestNode('body', 'body');
  harnessBody.dataset.editTaskLocked = options.editTaskLocked ? 'true' : 'false';
  harnessBody.dataset.editTaskState = options.editTaskState
    || (options.editTaskLocked ? 'SUBMITTING' : 'IDLE');
  const timerApi = options.timers || createManualTimers();
  let harnessRandomByte = 32;
  const harnessContext = {
    Array, Blob, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, Uint8Array,
    document: {
      body: harnessBody,
      getElementById(id) { return harnessNodes[id] || null; },
      createElement(tagName) { return new TestNode('', tagName); },
      addEventListener(type, listener) {
        const values = harnessDocumentListeners.get(type) || [];
        values.push(listener);
        harnessDocumentListeners.set(type, values);
      },
      dispatchEvent(event) {
        harnessDocumentEvents.push(event);
        for (const listener of harnessDocumentListeners.get(event.type) || []) listener(event);
        return true;
      },
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    crypto: {
      getRandomValues(bytes) { bytes.fill(harnessRandomByte++); return bytes; },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) { harnessRuntimeListeners.push(listener); },
        },
      },
    },
    setTimeout: timerApi.setTimeout.bind(timerApi),
    clearTimeout: timerApi.clearTimeout.bind(timerApi),
  };
  harnessContext.window = harnessContext;
  harnessContext.globalThis = harnessContext;
  harnessContext.addEventListener = (type, listener) => { harnessWindowListeners[type] = listener; };
  harnessContext.SS_ERP_BYOK_WORKBENCH_CLIENT = {
    DEVICE_INVALIDATED_MESSAGE: 'ss-erp:byok-device-session-invalidated',
    createClient() { return harnessClient; },
  };
  harnessContext.SS_ERP_HOSTED_AI_IMAGE_WORKBENCH_CONTROLLER = options.hostedController || {
    isActive() { return false; },
    isAvailable() { return true; },
    isByokExecutionAllowed() { return true; },
    async refresh() { return true; },
  };
  if (options.batchController) {
    harnessContext.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE_CONTROLLER = options.batchController;
  }
  let workspaceRuntimeRevision = 0;
  harnessContext.SS_ERP_BYOK_WORKBENCH_WORKSPACE_EVENTS = Object.freeze({
    nextRuntimeRevision() {
      workspaceRuntimeRevision += 1;
      return workspaceRuntimeRevision;
    },
  });
  if (options.simulateWorkspaceController) {
    harnessContext.document.addEventListener('ss-erp:workspace-clear', function () {
      harnessNodes.workspaceShell.hidden = true;
      harnessNodes.workspaceShell.setAttribute('aria-busy', 'true');
      harnessNodes.workspaceShell.setAttribute('aria-disabled', 'true');
      harnessNodes.workspaceShell.setAttribute('data-runtime-state', 'CLEARED');
      harnessNodes.workspaceTaskDock.hidden = true;
    });
  }
  if (options.integratePublishController) {
    harnessContext.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE = Object.freeze({
      PUBLISH_PROJECTION_CONTRACT_VERSION:
        'extension-byok-workbench-publish-projection/v1',
    });
    vm.runInNewContext(publishPageSource, harnessContext, { filename: publishPagePath });
  }
  vm.runInNewContext(pageSource, harnessContext, { filename: pagePath });
  return {
    authoritative,
    calls: harnessCalls,
    nodes: harnessNodes,
    flowButtons,
    body: harnessBody,
    runtimeListeners: harnessRuntimeListeners,
    windowListeners: harnessWindowListeners,
    documentEvents: harnessDocumentEvents,
    publishController: harnessContext.SS_ERP_WORKBENCH_PUBLISH_PAGE_CONTROLLER || null,
    dispatchDocument(type, detail) {
      harnessContext.document.dispatchEvent(new harnessContext.CustomEvent(type, { detail }));
    },
    get revokeCount() { return harnessRevokeCount; },
  };
}

{
  const pendingConfirm = createDeferred();
  const reviewContext = {
    contractVersion: 'extension-byok-workbench-review-launch-context/v1',
    launchMode: 'REVIEW_PUBLISH_ONLY',
    sourcePlatform: '1688', sourceProductId: 'product-confirm-race',
    sourceCaptureSnapshotId: 'snapshot-confirm-race', supplyGoodsId: 'goods-confirm-race',
    shopId: 'shop-confirm-race', workflowId: 'workflow-confirm-race',
    draftRevision: 11, draftVersion: 9,
    skuKey: 'sku-confirm-race', slotKey: 'sku:sku-confirm-race:hero', assignmentOrdinal: 0,
    assetId: 'byok_asset-confirm-race', source: 'GENERATED',
  };
  const publishRequest = {
    executionMode: 'BYOK',
    binding: {
      shopId: reviewContext.shopId,
      workflowId: reviewContext.workflowId,
      draftRevision: 11,
      draftVersion: 9,
    },
    selectedMedia: [{
      scope: 'SKU',
      skuKey: reviewContext.skuKey,
      slotKey: reviewContext.slotKey,
      assetId: reviewContext.assetId,
    }],
  };
  const reviewState = {
    contractVersion: 'extension-byok-workbench-review-public-state/v1',
    executionMode: 'BYOK',
    context: reviewContext,
    publishRequest,
  };
  const harness = createPageHarness({
    simulateWorkspaceController: true,
    integratePublishController: true,
    authoritative: { value: reviewState },
    confirmWorkspacePublish: () => pendingConfirm.promise,
  });
  await flushAsync(8);
  harness.nodes.workspacePublishConfirmation.checked = true;
  harness.nodes.workspacePublishConfirmation.listeners.change({ isTrusted: true });
  harness.nodes.workspacePublishConfirmButton.listeners.click({ isTrusted: true });
  assert.equal(harness.publishController.getState().busy, true);
  assert.equal(harness.calls.filter((row) => row[0] === 'workspace-confirm').length, 1);
  const authoritativeReads = harness.calls.filter((row) => row[0] === 'state').length;

  harness.nodes.refreshButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.equal(
    harness.calls.filter((row) => row[0] === 'state').length,
    authoritativeReads,
    'header refresh must not revalidate while the exact publish confirm is in flight',
  );
  assert.equal(harness.publishController.getState().busy, true);
  assert.equal(harness.publishController.getState().directReview, true);
  assert.equal(harness.calls.filter((row) => row[0] === 'workspace-confirm').length, 1);

  pendingConfirm.resolve({
    contractVersion: 'extension-workbench-listing-publish/v1',
    request: publishRequest,
    state: 'SUCCEEDED',
    executionMode: 'BYOK',
    shopId: reviewContext.shopId,
    workflowId: reviewContext.workflowId,
    currentDraftRevision: 11,
    currentDraftVersion: 9,
    previewHash: '8'.repeat(64),
    receiptId: 'workspace-receipt-confirm-race',
    failureCode: null,
  });
  await flushAsync(8);
  assert.equal(harness.publishController.getState().busy, false);
  assert.equal(harness.publishController.getState().publishState.state, 'SUCCEEDED');
  assert.equal(harness.calls.filter((row) => row[0] === 'workspace-confirm').length, 1);
}

{
  const reviewContext = {
    contractVersion: 'extension-byok-workbench-review-launch-context/v1',
    launchMode: 'REVIEW_PUBLISH_ONLY',
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 11, draftVersion: 9,
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 1,
    assetId: 'byok_asset-1', source: 'GENERATED',
  };
  const publishRequest = {
    executionMode: 'BYOK',
    binding: {
      shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 11, draftVersion: 9,
    },
    selectedMedia: [{
      scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'byok_asset-1',
    }],
  };
  const harness = createPageHarness({
    simulateWorkspaceController: true,
    authoritative: {
      value: {
        contractVersion: 'extension-byok-workbench-review-public-state/v1',
        executionMode: 'BYOK',
        context: reviewContext,
        publishRequest,
      },
    },
  });
  await flushAsync(8);
  assert.equal(harness.body.classList.values.has('is-review-publish-only'), true);
  assert.equal(harness.nodes.workspaceShell.hidden, false);
  assert.equal(harness.nodes.workspaceTaskDock.hidden, false);
  assert.equal(harness.nodes.workspaceShell.attributes['aria-busy'], 'false');
  assert.equal(harness.nodes.workspaceShell.attributes['aria-disabled'], 'false');
  assert.equal(
    harness.nodes.workspaceShell.attributes['data-runtime-state'],
    'REVIEW_PUBLISH_ONLY',
  );
  assert.equal(harness.nodes.contextBadge.textContent, '只读发布');
  assert.equal(harness.nodes.contextSku.textContent, 'sku-1 · 主图 · 已绑定位置 2');
  assert.equal(harness.nodes.generateButton.disabled, true);
  assert.equal(harness.nodes.profileSelect.disabled, true);
  assert.equal(harness.nodes.promptInput.disabled, true);
  assert.equal(harness.nodes.negativePromptInput.disabled, true);
  assert.equal(harness.calls.filter((row) => row[0] === 'readiness').length, 0);
  assert.equal(harness.calls.filter((row) => row[0] === 'generate').length, 0);
  assert.match(harness.nodes.flowSummary.textContent, /无需 Provider 设置/u);
  const reviewOnlyMediaStep = harness.flowButtons.find((button) => button.dataset.flowStep === 'media');
  assert.equal(reviewOnlyMediaStep.disabled, true);
  harness.nodes.flowToolbar.listeners.click({
    isTrusted: true,
    target: { closest: () => reviewOnlyMediaStep },
  });
  assert.equal(harness.body.dataset.flowStage, 'review');
  assert.equal(harness.nodes.workspaceTaskDock.hidden, false);
  const reviewEvent = harness.documentEvents.find((event) => (
    event.type === 'ss-erp:workbench-publish-review'
  ));
  assert.deepEqual(cloneValue(reviewEvent?.detail), publishRequest);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  )), false);
  harness.nodes.generateButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.equal(harness.calls.filter((row) => row[0] === 'generate').length, 0);
  harness.dispatchDocument('ss-erp:workspace-refresh-request', null);
  assert.equal(
    harness.body.classList.values.has('is-review-publish-only'),
    true,
    'a delayed hosted workspace refresh must not revoke review-only authority',
  );
  assert.equal(harness.nodes.workspaceShell.hidden, false);
  assert.equal(harness.nodes.workspaceTaskDock.hidden, false);
  harness.authoritative.value = null;
  harness.nodes.refreshButton.listeners.click({ isTrusted: true });
  await flushAsync(4);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workbench-publish-review-clear'
  )), true);
  assert.equal(harness.body.classList.values.has('is-review-publish-only'), false);
  assert.equal(harness.nodes.workspaceShell.hidden, true);
  assert.equal(harness.nodes.workspaceTaskDock.hidden, true);
}

{
  const harness = createPageHarness({ authoritative: { value: isolatedPublicState() } });
  await flushAsync(8);
  const reviewStep = harness.flowButtons.find((button) => button.dataset.flowStep === 'review');
  assert.equal(reviewStep.disabled, true, 'review cannot be entered before a candidate exists');
  harness.nodes.flowToolbar.listeners.click({
    isTrusted: true,
    target: { closest: () => reviewStep },
  });
  assert.equal(harness.body.dataset.flowStage, 'media');
  harness.nodes.flowProcessButton.listeners.click({ isTrusted: true });
  assert.equal(
    harness.body.dataset.flowStage,
    'media',
    'viewing process before a candidate exists must not enter review',
  );
  assert.equal(harness.body.dataset.processVisible, 'true');
  assert.equal(harness.nodes.workspaceTaskDock.hidden, false);
  assert.equal(harness.nodes.flowProcessButton.getAttribute('aria-expanded'), 'true');

  harness.dispatchDocument('ss-erp:workspace-runtime', {
    contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
    slots: [{
      alternatives: [{
        attemptId: 'batch-attempt-1',
        state: 'CANDIDATE_READY',
        mediaId: 'batch-result-1',
      }],
    }],
  });
  assert.equal(
    harness.body.dataset.flowStage,
    'media',
    'a completed workspace candidate must not pull the operator away from the active canvas',
  );
  assert.equal(reviewStep.disabled, false);
  harness.nodes.flowToolbar.listeners.click({
    isTrusted: true,
    target: { closest: () => reviewStep },
  });
  assert.equal(
    harness.body.dataset.flowStage,
    'review',
    'the enabled review stage should open only after an explicit operator action',
  );

  harness.dispatchDocument('ss-erp:workspace-runtime', {
    contractVersion: 'extension-byok-workbench-workspace-runtime/v1',
    slots: [{ alternatives: [] }],
  });
  assert.equal(harness.body.dataset.flowStage, 'media');
}

{
  const deferred = createDeferred();
  let reads = 0;
  const reviewContext = {
    contractVersion: 'extension-byok-workbench-review-launch-context/v1',
    launchMode: 'REVIEW_PUBLISH_ONLY',
    sourcePlatform: '1688', sourceProductId: 'product-refresh',
    sourceCaptureSnapshotId: 'snapshot-refresh', supplyGoodsId: 'goods-refresh',
    shopId: 'shop-refresh', workflowId: 'workflow-refresh', draftRevision: 11, draftVersion: 9,
    skuKey: 'sku-refresh', slotKey: 'sku:sku-refresh:hero', assignmentOrdinal: 0,
    assetId: 'byok_asset-refresh', source: 'GENERATED',
  };
  const publishRequest = {
    executionMode: 'BYOK',
    binding: {
      shopId: 'shop-refresh', workflowId: 'workflow-refresh', draftRevision: 11, draftVersion: 9,
    },
    selectedMedia: [{
      scope: 'SKU', skuKey: 'sku-refresh', slotKey: 'sku:sku-refresh:hero',
      assetId: 'byok_asset-refresh',
    }],
  };
  const reviewState = {
    contractVersion: 'extension-byok-workbench-review-public-state/v1',
    executionMode: 'BYOK',
    context: reviewContext,
    publishRequest,
  };
  const harness = createPageHarness({
    simulateWorkspaceController: true,
    integratePublishController: true,
    getPublicState() {
      reads += 1;
      return reads === 1 ? reviewState : deferred.promise;
    },
  });
  await flushAsync(8);
  assert.equal(harness.publishController.getState().directReview, true);
  assert.equal(harness.nodes.workspacePublishControls.hidden, false);
  assert.equal(harness.nodes.workspacePublishConfirmationRow.hidden, false);
  assert.equal(harness.nodes.workspacePublishConfirmButton.disabled, true);

  harness.nodes.refreshButton.listeners.click({ isTrusted: true });
  assert.equal(
    harness.publishController.getState().directReview,
    false,
    'authoritative refresh must synchronously revoke the prior direct-review authority',
  );
  assert.equal(harness.nodes.workspacePublishControls.hidden, true);
  harness.nodes.workspacePublishConfirmation.checked = true;
  harness.nodes.workspacePublishConfirmation.listeners.change({ isTrusted: true });
  harness.nodes.workspacePublishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.equal(harness.calls.filter((row) => row[0] === 'workspace-confirm').length, 0);

  deferred.resolve(reviewState);
  await flushAsync(8);
  assert.equal(harness.publishController.getState().directReview, true);
  assert.equal(harness.nodes.workspaceShell.hidden, false);
  assert.equal(harness.nodes.workspaceTaskDock.hidden, false);
  assert.equal(harness.nodes.workspacePublishControls.hidden, false);
  assert.equal(harness.calls.filter((row) => row[0] === 'workspace-confirm').length, 0);
}

{
  let hostedAllowed = false;
  let hostedActive = false;
  let hostedRefreshCount = 0;
  const harness = createPageHarness({
    hostedController: {
      isActive() { return hostedActive; },
      isAvailable() { return hostedAllowed; },
      isByokExecutionAllowed() { return hostedAllowed && !hostedActive; },
      async refresh() { hostedRefreshCount += 1; return hostedAllowed; },
    },
  });
  await flushAsync(8);
  assert.equal(harness.nodes.generateButton.disabled, true,
    'BYOK generation stays disabled while hosted authority is pending');
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
      && event.detail.executionMode === 'BYOK'
  )), false, 'a faster BYOK state callback cannot publish before hosted authority resolves');
  harness.nodes.generateButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.equal(harness.calls.some((row) => row[0] === 'generate'), false);
  assert.ok(hostedRefreshCount >= 1);

  hostedAllowed = true;
  harness.dispatchDocument('ss-erp:workspace-refresh-request', null);
  assert.equal(harness.nodes.generateButton.disabled, false);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
      && event.detail.executionMode === 'BYOK'
      && event.detail.dispatched === false
  )), true, 'an explicit no-suite authority decision releases the BYOK bootstrap');
}

{
  const harness = createPageHarness({
    hostedController: {
      isActive() { return true; },
      isAvailable() { return true; },
      isByokExecutionAllowed() { return false; },
      async refresh() { return true; },
    },
  });
  await flushAsync(8);
  assert.equal(harness.nodes.generateButton.disabled, true);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
      && event.detail.executionMode === 'BYOK'
  )), false, 'an already-resolved hosted suite never exposes a BYOK-ready bootstrap');
  harness.dispatchDocument('ss-erp:workspace-refresh-request', null);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
      && event.detail.executionMode === 'BYOK'
  )), false);
}

{
  let hostedAllowed = true;
  const authoritative = { value: isolatedPublicState(isolatedCandidate()) };
  const harness = createPageHarness({
    authoritative,
    hostedController: {
      isActive() { return !hostedAllowed; },
      isAvailable() { return true; },
      isByokExecutionAllowed() { return hostedAllowed; },
      async refresh() { return hostedAllowed; },
    },
  });
  await flushAsync(8);
  assert.equal(harness.nodes.rejectButton.disabled, false);
  hostedAllowed = false;
  harness.nodes.rejectButton.listeners.click({ isTrusted: true });
  await flushAsync(4);
  assert.equal(harness.calls.some((row) => row[0] === 'review'), false,
    'a stale enabled review button cannot mutate after Hosted takes the mode lock');
  harness.dispatchDocument('ss-erp:workspace-refresh-request', null);
  assert.equal(harness.nodes.rejectButton.disabled, true);
}

for (const deliveryState of ['NOT_INGESTED', 'INGESTING']) {
  let hostedAllowed = true;
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', deliveryState)),
  };
  const harness = createPageHarness({
    authoritative,
    hostedController: {
      isActive() { return !hostedAllowed; },
      isAvailable() { return true; },
      isByokExecutionAllowed() { return hostedAllowed; },
      async refresh() { return hostedAllowed; },
    },
  });
  await flushAsync(8);
  assert.equal(harness.nodes.approveButton.disabled, false);
  hostedAllowed = false;
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(4);
  assert.equal(harness.calls.some((row) => (
    row[0] === (deliveryState === 'INGESTING' ? 'recover-ingest' : 'ingest')
  )), false, 'stale ingest controls cannot bypass the Hosted authority lock');
  harness.dispatchDocument('ss-erp:workspace-refresh-request', null);
  assert.equal(harness.nodes.approveButton.disabled, true);
}

for (const recovery of [false, true]) {
  let hostedAllowed = true;
  const bound = {
    ...isolatedCandidate('APPROVED', 'BOUND'),
    ingest: cloneValue(ingestReceipt),
  };
  const authoritative = { value: isolatedPublicState(bound) };
  if (recovery) {
    authoritative.value.publish = {
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'OUTCOME_UNRESOLVED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: null, failureCode: null,
    };
  }
  const harness = createPageHarness({
    authoritative,
    hostedController: {
      isActive() { return !hostedAllowed; },
      isAvailable() { return true; },
      isByokExecutionAllowed() { return hostedAllowed; },
      async refresh() { return hostedAllowed; },
    },
  });
  await flushAsync(10);
  if (!recovery) {
    harness.nodes.publishConfirmation.checked = true;
    harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
    assert.equal(harness.nodes.publishConfirmButton.disabled, false);
  } else {
    assert.equal(harness.nodes.publishRecoverButton.disabled, false);
  }
  hostedAllowed = false;
  const button = recovery ? harness.nodes.publishRecoverButton : harness.nodes.publishConfirmButton;
  button.listeners.click({ isTrusted: true });
  await flushAsync(4);
  assert.equal(harness.calls.some((row) => (
    row[0] === (recovery ? 'publish-recover' : 'publish-confirm')
  )), false, 'stale publish controls cannot bypass the Hosted authority lock');
  harness.dispatchDocument('ss-erp:workspace-refresh-request', null);
  assert.equal(button.disabled, true);
}

{
  const authoritative = { value: isolatedPublicState() };
  authoritative.value.generationOutcome = 'UNKNOWN_OUTCOME';
  const harness = createPageHarness({ authoritative });
  await flushAsync(8);
  const runtime = harness.documentEvents.find((event) => (
    event.type === 'ss-erp:workspace-runtime'
  ));
  assert.ok(runtime, 'an unknown single-image outcome must project into the task dock');
  assert.equal(runtime.detail.task.schedulerState, 'FAILED');
  assert.equal(runtime.detail.slots[0].status, 'UNKNOWN_OUTCOME');
  assert.equal(runtime.detail.slots[0].alternatives[0].state, 'UNKNOWN_OUTCOME');
  assert.equal(runtime.detail.slots[0].alternatives[0].mediaId, null);
  assert.deepEqual(cloneValue(runtime.detail.binding), {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  });
  assert.notEqual(runtime.detail.task.schedulerState, 'READY');
  const generateCount = harness.calls.filter((row) => row[0] === 'generate').length;
  harness.nodes.mediaPrimaryAction.listeners.click({ isTrusted: true });
  await flushAsync(4);
  assert.equal(harness.calls.filter((row) => row[0] === 'generate').length, generateCount,
    'the command bar only reconciles an unknown Provider outcome and never re-posts it');
}

{
  const dispatched = createDeferred();
  const harness = createPageHarness({ generate: () => dispatched.promise });
  await flushAsync(8);
  const eventOffset = harness.documentEvents.length;
  harness.nodes.generateButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  const frozenBootstrap = harness.documentEvents.slice(eventOffset).findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  assert.equal(frozenBootstrap?.detail.dispatched, true,
    'the Prompt freezes before the Provider dispatch can settle');
  const originalPrompt = harness.nodes.promptInput.value;
  harness.dispatchDocument('ss-erp:workspace-action', {
    contractVersion: 'extension-byok-workbench-workspace-action/v1',
    action: 'SAVE_PROMPT',
    revision: 2,
    executionMode: 'BYOK',
    skuKey: null,
    slotKey: publicState.context.slotKey,
    mediaId: null,
    attemptId: null,
    libraryKind: null,
    direction: null,
    prompt: 'This late Prompt must not replace the dispatched input.',
    negativePrompt: '',
  });
  assert.equal(harness.nodes.promptInput.value, originalPrompt);
  dispatched.reject(new Error('definitive Provider rejection'));
  await flushAsync(4);
  const releasedBootstrap = harness.documentEvents.findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  assert.equal(releasedBootstrap.detail.dispatched, false,
    'a definitive pre-result failure restores Prompt editing');
}

{
  const refreshedReadiness = createDeferred();
  const dispatched = createDeferred();
  const initialReadiness = cloneValue(readiness);
  const nextReadiness = {
    ...cloneValue(readiness),
    readinessHandle: 'rh_' + 'c'.repeat(48),
  };
  let readinessCallCount = 0;
  const harness = createPageHarness({
    getReadiness() {
      readinessCallCount += 1;
      return readinessCallCount === 1 ? initialReadiness : refreshedReadiness.promise;
    },
    generate: () => dispatched.promise,
  });
  await flushAsync(8);
  initialReadiness.expiresAt = '2000-01-01T00:00:00.000Z';
  harness.nodes.promptInput.value = 'Prompt A before delayed readiness';
  harness.nodes.generateButton.listeners.click({ isTrusted: true });
  harness.nodes.mediaPrimaryAction.listeners.click({ isTrusted: true });
  harness.nodes.generateButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.equal(readinessCallCount, 2,
    'new and legacy controls share one readiness single-flight after the initial page check');
  assert.equal(harness.calls.filter((row) => row[0] === 'generate').length, 0,
    'the Provider request waits for the one authoritative readiness result');
  harness.dispatchDocument('ss-erp:workspace-action', {
    contractVersion: 'extension-byok-workbench-workspace-action/v1',
    action: 'SAVE_PROMPT',
    revision: 2,
    executionMode: 'BYOK',
    skuKey: null,
    slotKey: publicState.context.slotKey,
    mediaId: null,
    attemptId: null,
    libraryKind: null,
    direction: null,
    prompt: 'Prompt B saved while readiness is pending',
    negativePrompt: 'no watermark',
  });
  refreshedReadiness.resolve(nextReadiness);
  await flushAsync(4);
  const generateCall = harness.calls.findLast((row) => row[0] === 'generate');
  assert.equal(harness.calls.filter((row) => row[0] === 'generate').length, 1,
    'rapid clicks across both visible submit controls dispatch exactly one paid request');
  assert.equal(generateCall?.[1].prompt, 'Prompt B saved while readiness is pending');
  assert.equal(generateCall?.[1].negativePrompt, 'no watermark');
  const pendingBootstrap = harness.documentEvents.findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap' && event.detail.dispatched === true
  ));
  const pendingSlot = pendingBootstrap?.detail.skus[0].slots[0];
  assert.equal(pendingSlot?.prompt, 'Prompt B saved while readiness is pending');
  assert.equal(pendingSlot?.alternatives[0].state, 'SUBMITTING');
  assert.equal(pendingSlot?.alternatives[0].mediaId, null);
  assert.doesNotMatch(JSON.stringify(pendingBootstrap?.detail), /"READY"/u);
  dispatched.reject(new Error('definitive Provider rejection'));
  await flushAsync(4);
}

{
  const harness = createPageHarness({ editTaskLocked: true });
  await flushAsync(8);
  const pendingBootstrap = harness.documentEvents.findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  const pendingSlot = pendingBootstrap?.detail.skus[0].slots[0];
  assert.equal(pendingBootstrap?.detail.dispatched, true);
  assert.equal(pendingSlot?.alternatives[0].state, 'SUBMITTING');
  assert.equal(pendingSlot?.alternatives[0].mediaId, null);
  assert.equal(harness.nodes.promptInput.disabled, true);
  assert.equal(harness.nodes.profileSelect.disabled, true);
}

{
  const harness = createPageHarness({
    editTaskLocked: true,
    editTaskState: 'UNKNOWN_OUTCOME',
  });
  await flushAsync(8);
  const unknownBootstrap = harness.documentEvents.findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  const unknownSlot = unknownBootstrap?.detail.skus[0].slots[0];
  assert.equal(unknownBootstrap?.detail.dispatched, true);
  assert.equal(unknownSlot?.alternatives[0].state, 'UNKNOWN_OUTCOME');
  assert.equal(unknownSlot?.alternatives[0].mediaId, null);
  assert.equal(unknownSlot?.alternatives[0].errorCode, 'PROVIDER_OUTCOME_UNKNOWN');
  assert.doesNotMatch(JSON.stringify(unknownBootstrap?.detail), /"SUBMITTING"|"READY"/u);
}

{
  const harness = createPageHarness();
  await flushAsync(8);
  const bootstrap = harness.documentEvents.find((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  assert.ok(bootstrap, 'the authoritative single-slot state bootstraps the workspace shell');
  assert.deepEqual(Object.keys(bootstrap.detail).sort(), [
    'availableExecutionModes', 'binding', 'contractVersion', 'dispatched',
    'executionMode', 'globalReferenceIds',
    'libraryItems', 'selectedSkuKey', 'selectedSlotKey', 'skus',
  ].sort());
  assert.deepEqual(cloneValue(bootstrap.detail.availableExecutionModes), ['BYOK', 'ERP_HOSTED']);
  assert.deepEqual(cloneValue(bootstrap.detail.binding), {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  });
  assert.equal(bootstrap.detail.executionMode, 'BYOK');
  assert.equal(bootstrap.detail.selectedSkuKey, publicState.context.skuKey);
  assert.equal(bootstrap.detail.selectedSlotKey, publicState.context.slotKey);
  assert.equal(bootstrap.detail.skus.length, 1);
  assert.equal(bootstrap.detail.skus[0].slots.length, 1);
  assert.equal(JSON.stringify(bootstrap.detail).includes('apiKey'), false);
  assert.equal(JSON.stringify(bootstrap.detail).includes('https://'), false);

  harness.dispatchDocument('ss-erp:workspace-action', {
    contractVersion: 'extension-byok-workbench-workspace-action/v1',
    action: 'SAVE_PROMPT',
    revision: 2,
    executionMode: 'BYOK',
    skuKey: null,
    slotKey: publicState.context.slotKey,
    mediaId: null,
    attemptId: null,
    libraryKind: null,
    direction: null,
    prompt: 'Keep the verified product centered on a neutral background.',
    negativePrompt: 'watermark, invented labels',
  });
  assert.equal(
    harness.nodes.promptInput.value,
    'Keep the verified product centered on a neutral background.',
  );
  assert.equal(harness.nodes.negativePromptInput.value, 'watermark, invented labels');

  harness.dispatchDocument('ss-erp:workspace-action', {
    contractVersion: 'extension-byok-workbench-workspace-action/v1',
    action: 'SAVE_PROMPT',
    revision: 3,
    executionMode: 'BYOK',
    skuKey: null,
    slotKey: 'different-slot',
    mediaId: null,
    attemptId: null,
    libraryKind: null,
    direction: null,
    prompt: 'This must not replace the current prompt.',
    negativePrompt: '',
  });
  assert.equal(
    harness.nodes.promptInput.value,
    'Keep the verified product centered on a neutral background.',
    'a workspace action for another slot cannot mutate the exact single-slot form',
  );
}

{
  const authoritative = { value: isolatedPublicState() };
  delete authoritative.value.context.draftVersion;
  const harness = createPageHarness({ authoritative });
  await flushAsync(8);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
      || event.type === 'ss-erp:workspace-runtime'
  )), false, 'an incomplete draft binding never produces workspace state');
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-clear'
  )), true, 'an incomplete draft binding clears any retained workspace state');
}

{
  const authoritative = { value: isolatedPublicState() };
  authoritative.value.context.slotKey = 'sku:sku-1:detail';
  const harness = createPageHarness({ authoritative });
  await flushAsync(8);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
      || event.type === 'ss-erp:workspace-runtime'
  )), false, 'a non-canonical detail launch cannot synthesize a hero-only workspace');
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-clear'
  )), true, 'a non-canonical detail launch clears any retained workspace state');
}

{
  const lateState = createDeferred();
  const harness = createPageHarness({ getPublicState: () => lateState.promise });
  harness.runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
  lateState.resolve(isolatedPublicState());
  await flushAsync();
  assert.equal(harness.nodes.contextSource.textContent, '设备已断开');
  assert.match(harness.nodes.pageStatus.textContent, /设备会话已变化/u);
  assert.equal(harness.calls.filter((row) => row[0] === 'readiness').length, 0,
    'a stale state load must not start readiness after invalidation');
}

{
  const lateReadiness = createDeferred();
  const harness = createPageHarness({ getReadiness: () => lateReadiness.promise });
  await flushAsync();
  assert.equal(harness.calls.filter((row) => row[0] === 'readiness').length, 1);
  harness.runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
  const invalidatedStatus = harness.nodes.pageStatus.textContent;
  lateReadiness.resolve(readiness);
  await flushAsync();
  assert.equal(harness.nodes.pageStatus.textContent, invalidatedStatus,
    'late readiness must not overwrite disconnected UI');
}

{
  const lateIngest = createDeferred();
  const authoritative = { value: isolatedPublicState(isolatedCandidate('APPROVED')) };
  const harness = createPageHarness({ authoritative, ingestApproved: () => lateIngest.promise });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  harness.runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
  lateIngest.resolve({
    resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
  });
  await flushAsync();
  assert.equal(harness.nodes.resultPanel.hidden, true);
  assert.equal(harness.nodes.contextSource.textContent, '设备已断开');
  assert.match(harness.nodes.pageStatus.textContent, /设备会话已变化/u,
    'late ingest must not overwrite disconnected UI');
}

{
  const latePreview = createDeferred();
  let latePreviewRevokes = 0;
  const authoritative = { value: isolatedPublicState(isolatedCandidate()) };
  const harness = createPageHarness({ authoritative, openPreview: () => latePreview.promise });
  await flushAsync(1);
  harness.windowListeners.pagehide();
  const hiddenStatus = harness.nodes.pageStatus.textContent;
  latePreview.resolve({
    objectUrl: 'blob:late-pagehide-preview',
    metadata: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
    revoke() { latePreviewRevokes += 1; },
  });
  await flushAsync();
  assert.equal(latePreviewRevokes, 1, 'a preview arriving after pagehide is revoked');
  assert.equal(harness.nodes.pageStatus.textContent, hiddenStatus,
    'a preview arriving after pagehide must not mutate page state');
}

{
  const timers = createManualTimers();
  const lateReview = createDeferred();
  const authoritative = { value: isolatedPublicState(isolatedCandidate()) };
  const harness = createPageHarness({
    authoritative,
    timers,
    reviewResult: () => lateReview.promise,
  });
  await flushAsync();
  harness.nodes.previewImage.listeners.load();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  timers.runAll();
  assert.equal(harness.nodes.resultPanel.hidden, false,
    'preview expiry must not clear a candidate while review is unresolved');
  authoritative.value.result = null;
  lateReview.resolve({ resultId, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED' });
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    'expiry during review reloads authoritative state after review settles');
  assert.equal(harness.nodes.resultPanel.hidden, true);
}

{
  const timers = createManualTimers();
  const lateIngest = createDeferred();
  const authoritative = { value: isolatedPublicState(isolatedCandidate('APPROVED')) };
  const harness = createPageHarness({
    authoritative,
    timers,
    ingestApproved: () => lateIngest.promise,
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  timers.runAll();
  assert.equal(harness.nodes.resultPanel.hidden, false,
    'preview expiry must not clear a candidate while ingest is unresolved');
  authoritative.value.result = {
    resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
  };
  lateIngest.resolve(authoritative.value.result);
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    'expiry during ingest reloads authoritative state after ingest settles');
  assert.match(harness.nodes.resultStatus.textContent, /已绑定 ERP/u);
}

for (const terminalCode of [
  'SS_ERP_BYOK_INGEST_RECOVERY_REJECTED',
  'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND',
  'SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED',
]) {
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', 'INGESTING')),
  };
  const harness = createPageHarness({
    authoritative,
    recoverApprovedIngest: () => {
      authoritative.value.result = isolatedCandidate('APPROVED', 'NOT_INGESTED');
      throw Object.assign(new Error('terminal recovery rejection'), {
        code: terminalCode,
      });
    },
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    `${terminalCode} reloads the background-reset public state`);
  assert.match(harness.nodes.approveButton.textContent, /接收并绑定 ERP/u);
  assert.equal(harness.nodes.rejectButton.disabled, false);
}

{
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', 'INGESTING')),
  };
  const harness = createPageHarness({
    authoritative,
    recoverApprovedIngest: () => {
      authoritative.value.result = null;
      throw Object.assign(new Error('immutable failed receipt'), {
        code: 'SS_ERP_BYOK_INGEST_RECEIPT_FAILED',
      });
    },
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    'an immutable failed receipt reloads the cleared authoritative state');
  assert.equal(harness.nodes.resultPanel.hidden, true,
    'an immutable failed receipt must not expose another receive action');
}

for (const transientCode of [
  'SS_ERP_BYOK_INGEST_RECEIPT_PENDING',
  'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
]) {
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', 'INGESTING')),
  };
  const harness = createPageHarness({
    authoritative,
    recoverApprovedIngest: () => {
      throw Object.assign(new Error('transient recovery state'), { code: transientCode });
    },
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync();
  assert.equal(harness.calls.filter((row) => row[0] === 'state').length, 1,
    `${transientCode} must preserve INGESTING without an implicit retry`);
  assert.match(harness.nodes.approveButton.textContent, /核对 ERP 回执/u);
  assert.match(harness.nodes.resultStatus.textContent, /等待 ERP 回执/u);
}

{
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate()),
  };
  const harness = createPageHarness({ authoritative });
  await flushAsync(8);
  const candidateBootstrap = harness.documentEvents.findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  assert.deepEqual(cloneValue(candidateBootstrap?.detail.binding), {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  }, 'a candidate without an ingest receipt remains bound to the source draft');
  assert.equal(
    candidateBootstrap?.detail.skus[0].slots[0].alternatives[0].state,
    'CANDIDATE_READY',
  );
}

{
  const confirmation = createDeferred();
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  const harness = createPageHarness({
    authoritative,
    confirmPublish: () => confirmation.promise,
  });
  await flushAsync(8);
  const boundBootstrap = harness.documentEvents.findLast((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  ));
  assert.deepEqual(cloneValue(boundBootstrap?.detail.binding), {
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 4, draftVersion: 5,
  }, 'a verified BOUND receipt moves the workspace binding to the bound draft');
  assert.equal(boundBootstrap?.detail.skus[0].slots[0].alternatives[0].state, 'BOUND');
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-preview').length, 1);
  assert.equal(harness.nodes.publishPanel.hidden, false);
  assert.equal(harness.nodes.publishShop.textContent, 'shop-1');
  assert.match(harness.nodes.publishDraft.textContent, /workflow-1.*r4.*v5/u);
  assert.equal(harness.nodes.publishSkuOrder.textContent, 'sku-2 -> sku-1');
  assert.equal(harness.nodes.publishMediaList.children.length, 3);
  assert.equal(
    harness.nodes.publishMediaList.children[2].classList.values.has('is-bound-asset'),
    true,
    'the newly bound BYOK asset is highlighted in the authoritative media order',
  );
  assert.equal(harness.nodes.publishConfirmButton.disabled, true,
    'publish requires a separate explicit confirmation');
  harness.nodes.publishConfirmation.checked = true;
  harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
  assert.equal(harness.nodes.publishConfirmButton.disabled, false);
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: false });
  await flushAsync(1);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-confirm').length, 0);
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-confirm').length, 1,
    'double-click must share the page operation lock');
  confirmation.resolve({
    contractVersion: 'extension-byok-listing-publish/v1',
    state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
    boundDraftRevision: 4, boundDraftVersion: 5,
    previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
  });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /已提交/u);
  assert.match(harness.nodes.publishNotice.textContent, /publish-receipt-1/u);
  assert.equal(harness.nodes.publishRecoverButton.hidden, true);
  assert.equal(harness.nodes.publishConfirmButton.disabled, true);
}

{
  const authoritative = {
    value: isolatedPublicState({
      resultId,
      reviewState: 'APPROVED',
      deliveryState: 'BOUND',
      ingest: { ...ingestReceipt, normalizedSha256: 'not-a-sha256' },
    }),
  };
  const harness = createPageHarness({ authoritative });
  await flushAsync(8);
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
  )), false, 'an unverified BOUND receipt cannot produce workspace state');
  assert.equal(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-clear'
  )), true, 'an unverified BOUND receipt clears any retained workspace binding');
}

{
  const recovery = createDeferred();
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  authoritative.value.publish = {
    contractVersion: 'extension-byok-listing-publish/v1',
    state: 'PENDING', shopId: 'shop-1', workflowId: 'workflow-1',
    boundDraftRevision: 4, boundDraftVersion: 5,
    previewHash: '9'.repeat(64), receiptId: 'publish-receipt-pending', failureCode: null,
  };
  const harness = createPageHarness({
    authoritative,
    recoverPublish: () => recovery.promise,
  });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /尚未形成终态/u);
  assert.match(harness.nodes.publishNotice.textContent, /处理或等待对账/u);
  assert.equal(harness.nodes.publishConfirmationRow.hidden, true);
  assert.equal(harness.nodes.publishRecoverButton.hidden, false);
  harness.nodes.publishRecoverButton.listeners.click({ isTrusted: true });
  harness.nodes.publishRecoverButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-recover').length, 1,
    'PENDING recovery must also be single-flight');
  recovery.resolve({
    contractVersion: 'extension-byok-listing-publish/v1',
    state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
    boundDraftRevision: 4, boundDraftVersion: 5,
    previewHash: '9'.repeat(64), receiptId: 'publish-receipt-pending', failureCode: null,
  });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /已提交/u);
}

{
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  const harness = createPageHarness({
    authoritative,
    confirmPublish: () => {
      throw Object.assign(new Error('unknown publish outcome'), {
        code: 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME',
      });
    },
  });
  await flushAsync(8);
  harness.nodes.publishConfirmation.checked = true;
  harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /结果未知/u);
  assert.equal(harness.nodes.publishRecoverButton.hidden, false);
  assert.match(harness.nodes.publishNotice.textContent, /同一发布身份/u);
}

{
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  const harness = createPageHarness({
    authoritative,
    confirmPublish: () => ({
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'FAILED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-failed',
      failureCode: 'OZON_IMPORT_REJECTED',
    }),
  });
  await flushAsync(8);
  harness.nodes.publishConfirmation.checked = true;
  harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /提交失败/u);
  assert.match(harness.nodes.publishNotice.textContent, /OZON_IMPORT_REJECTED/u);
  assert.match(harness.nodes.pageStatus.textContent, /确认失败.*OZON_IMPORT_REJECTED/u);
  assert.doesNotMatch(harness.nodes.pageStatus.textContent, /恢复流程|继续核对/u);
  assert.equal(harness.nodes.publishRecoverButton.hidden, true);
}

{
  let batchStarts = 0;
  const harness = createPageHarness({
    batchController: {
      isAvailable() { return true; },
      isLocked() { return false; },
      syncGenerateControl() { return true; },
      async startFromPage() { batchStarts += 1; return true; },
    },
  });
  await flushAsync(8);
  harness.nodes.mediaPrimaryAction.listeners.click({ isTrusted: false });
  await flushAsync(2);
  assert.equal(batchStarts, 0, 'synthetic command-bar clicks cannot start batch work');
  harness.nodes.mediaPrimaryAction.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.equal(batchStarts, 1, 'the first-viewport command delegates to the batch controller');
  assert.equal(harness.calls.some((row) => row[0] === 'generate'), false,
    'the legacy Provider path cannot run beside an available batch controller');
}

for (const [errorCode, expectedLabel] of [
  [
    'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE',
    /ERP 草稿或目标槽位已变化.*来源商品页重新打开/u,
  ],
  [
    'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
    /设备连接或商品审核权限已失效.*重新连接/u,
  ],
]) {
  const harness = createPageHarness({
    batchController: {
      isAvailable() { return true; },
      isLocked() { return false; },
      syncGenerateControl() { return true; },
      async startFromPage() {
        throw Object.assign(new Error('redacted batch launch failure'), { code: errorCode });
      },
    },
  });
  await flushAsync(8);
  harness.nodes.generateButton.listeners.click({ isTrusted: true });
  await flushAsync(2);
  assert.match(harness.nodes.pageStatus.textContent, expectedLabel);
  assert.doesNotMatch(harness.nodes.pageStatus.textContent, /redacted batch launch failure/u);
}

{
  const authoritative = { value: isolatedPublicState() };
  const harness = createPageHarness({ authoritative });
  await flushAsync(8);
  const next = isolatedPublicState();
  next.context.draftRevision = 4;
  next.context.draftVersion = 5;
  authoritative.value = next;
  harness.dispatchDocument('ss-erp:workspace-authoritative-reload', {
    contractVersion: 'extension-byok-workbench-authoritative-reload/v1',
    boundDraftRevision: 4,
    boundDraftVersion: 5,
  });
  await flushAsync(8);
  assert.equal(harness.calls.filter((row) => row[0] === 'state').length >= 2, true);
  assert.match(harness.nodes.contextDraft.textContent, /r4.*v5/u,
    'batch ingest success must reload the authoritative bound draft');
}

{
  const sourceMediaId = `sm_${'a'.repeat(48)}`;
  const sourceBlob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  let sourcePreviewSequence = 0;
  const harness = createPageHarness({
    getSourceCatalog: () => ({
      contractVersion: 'extension-byok-workbench-source-catalog/v1',
      items: [{
        mediaId: sourceMediaId,
        sourceMediaKey: 'source-main-1',
        role: 'product_main',
        scope: 'PRODUCT',
        skuKeys: [],
        label: '商品主图 1',
      }],
    }),
    openSourcePreview: (_sourceMediaKey, purpose) => ({
      blob: sourceBlob,
      objectUrl: `blob:source-${purpose.toLowerCase()}-${++sourcePreviewSequence}`,
      revoke() {},
    }),
  });
  await flushAsync(10);
  const bootstrap = harness.documentEvents.find((event) => (
    event.type === 'ss-erp:workspace-bootstrap'
    && event.detail.libraryItems.some((item) => item.mediaId === sourceMediaId)
  ));
  assert.ok(bootstrap, 'the source catalog must enter the independent workspace bootstrap');
  assert.deepEqual(cloneValue(bootstrap.detail.libraryItems[0]), {
    mediaId: sourceMediaId,
    sourceType: 'CAPTURED',
    label: '商品主图 1',
    secondaryLabel: '商品来源图',
    skuKeys: [],
    referenceEligible: true,
  });
  assert.ok(harness.documentEvents.some((event) => (
    event.type === 'ss-erp:workspace-source-preview-state'
    && event.detail.mediaId === sourceMediaId
    && event.detail.objectUrl.startsWith('blob:source-thumbnail-')
  )), 'the first source images should receive safe thumbnail projections');
  const projectedPreviewCount = harness.documentEvents.filter((event) => (
    event.type === 'ss-erp:workspace-source-preview-state'
    && event.detail.mediaId === sourceMediaId
    && event.detail.ready === true
  )).length;
  harness.dispatchDocument('ss-erp:workspace-source-preview-request', {
    contractVersion: 'extension-byok-workbench-source-preview-state/v1',
    mediaId: sourceMediaId,
  });
  await flushAsync(2);
  assert.equal(harness.documentEvents.filter((event) => (
    event.type === 'ss-erp:workspace-source-preview-state'
    && event.detail.mediaId === sourceMediaId
    && event.detail.ready === true
  )).length, projectedPreviewCount + 1,
  'a cached source preview must be projected again after workspace re-bootstrap');
  harness.dispatchDocument('ss-erp:workspace-source-operation', {
    contractVersion: 'extension-byok-workbench-source-operation/v1',
    mediaId: sourceMediaId,
    operation: 'FULL_EDIT',
  });
  await flushAsync(6);
  const ready = harness.documentEvents.find((event) => (
    event.type === 'ss-erp:workbench-source-operation-ready'
  ));
  assert.equal(ready.detail.mediaId, sourceMediaId);
  assert.equal(ready.detail.operation, 'FULL_EDIT');
  assert.equal(ready.detail.blob, sourceBlob);
  assert.equal(harness.calls.some((row) => row[0] === 'source-preview'
    && row[1] === 'source-main-1' && row[2] === 'WORKING'), true);
}

{
  const authoritative = { value: isolatedPublicState() };
  const harness = createPageHarness({ authoritative, editTaskLocked: true, editTaskState: 'CANDIDATE_READY' });
  await flushAsync(6);
  const previousReads = harness.calls.filter((row) => row[0] === 'state').length;
  authoritative.value = isolatedPublicState(isolatedCandidate());
  harness.dispatchDocument('ss-erp:workbench-edit-review-ready', { resultId: 'forged-page-result' });
  await flushAsync(2);
  assert.equal(harness.calls.filter((row) => row[0] === 'state').length, previousReads);
  harness.dispatchDocument('ss-erp:workbench-edit-review-ready', null);
  await flushAsync(8);
  assert.equal(harness.calls.filter((row) => row[0] === 'state').length, previousReads + 1);
  assert.equal(harness.nodes.resultPanel.hidden, false,
    'edited candidates must reach the existing explicit review panel');
  assert.equal(harness.nodes.approveButton.disabled, true, 'decode must finish before approval');
  harness.nodes.previewImage.complete = true;
  harness.nodes.previewImage.naturalWidth = 1024;
  harness.nodes.previewImage.naturalHeight = 1024;
  harness.nodes.previewImage.listeners.load();
  assert.equal(harness.nodes.approveButton.disabled, false);
  assert.equal(harness.calls.some((row) => ['review', 'ingest', 'generate'].includes(row[0])), false);
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(6);
  assert.equal(harness.calls.filter((row) => row[0] === 'review').length, 1);
  assert.equal(harness.calls.some((row) => row[0] === 'ingest'), false);
  assert.equal(harness.nodes.approveButton.textContent, '接收并绑定 ERP');
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(6);
  assert.equal(harness.calls.filter((row) => row[0] === 'ingest').length, 1);
  assert.equal(harness.nodes.approveButton.textContent, '已绑定 ERP');
  assert.equal(harness.calls.some((row) => row[0] === 'publish-confirm'), false);
}

console.log('extension BYOK workbench UI tests passed');
