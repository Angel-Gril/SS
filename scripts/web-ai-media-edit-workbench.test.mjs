import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAiImageEditWorkflowRequest,
  describeAiMediaReadiness,
  isAiMediaWorkflowInputCurrent,
} from '../apps/web/src/lib/ai-media-workflow.ts';
import {
  appendAiImageMaskPoint,
  clearAiImageMaskHistory,
  commitAiImageMaskStroke,
  createAiImageMaskHistory,
  createAiImageMaskStroke,
  confirmAiImageMaskDraftDiscard,
  hasAiImageMaskPaint,
  isAiImageMaskDimensionsSupported,
  redoAiImageMaskHistory,
  undoAiImageMaskHistory,
} from '../apps/web/src/lib/ai-image-mask.ts';

const fullEdit = buildAiImageEditWorkflowRequest({
  operation: 'FULL_EDIT',
  sourceAssetId: ' source-1 ',
  userPrompt: ' Clean the background ',
  userNegativePrompt: ' no text ',
  idempotencyKey: 'full-edit-idempotency',
  contextId: 'collect-1',
  contextSkuKey: null,
  contextSlotKey: null,
});
assert.deepEqual(fullEdit, {
  operation: 'FULL_EDIT',
  sourceAssetId: 'source-1',
  userPrompt: 'Clean the background',
  userNegativePrompt: 'no text',
  idempotencyKey: 'full-edit-idempotency',
  context: { type: 'collect', id: 'collect-1', skuKey: null, slotKey: null },
});

const inpaint = buildAiImageEditWorkflowRequest({
  operation: 'INPAINT',
  sourceAssetId: 'source-1',
  maskAssetId: 'mask-1',
  userPrompt: 'Remove the label',
  userNegativePrompt: '',
  idempotencyKey: 'inpaint-idempotency',
  contextId: 'collect-1',
  contextSkuKey: ' sku-red ',
  contextSlotKey: ' hero ',
});
assert.deepEqual(inpaint, {
  operation: 'INPAINT',
  sourceAssetId: 'source-1',
  maskAssetId: 'mask-1',
  maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
  userPrompt: 'Remove the label',
  userNegativePrompt: '',
  idempotencyKey: 'inpaint-idempotency',
  context: { type: 'collect', id: 'collect-1', skuKey: 'sku-red', slotKey: 'hero' },
});
assert.throws(() => buildAiImageEditWorkflowRequest({
  operation: 'INPAINT',
  sourceAssetId: 'source-1',
  userPrompt: 'Remove the label',
  userNegativePrompt: '',
  idempotencyKey: 'inpaint-idempotency',
  contextId: 'collect-1',
}), /遮罩/u);
assert.equal(describeAiMediaReadiness('FULL_EDIT', {
  enabled: false,
  ready: false,
  reasonCode: 'AI_MEDIA_OPERATION_DISABLED',
  reason: 'disabled',
}), 'AI 全图编辑当前关闭。');
assert.equal(describeAiMediaReadiness('INPAINT', {
  enabled: true,
  ready: false,
  reasonCode: 'PROVIDER_NOT_READY',
  reason: 'provider unavailable',
}), 'AI 局部重绘 Provider 尚未完成生产验证。');
assert.equal(describeAiMediaReadiness('FULL_EDIT', {
  enabled: true,
  ready: false,
  reasonCode: 'STORAGE_NOT_READY',
  reason: 'storage unavailable',
}), 'AI 图片编辑需要可用的 OSS 或本地存储，当前存储配置不兼容。');
assert.equal(isAiImageMaskDimensionsSupported(1200, 800), true);
assert.equal(isAiImageMaskDimensionsSupported(100, 120000), false);
assert.equal(isAiImageMaskDimensionsSupported(100, 3000), false);
let discardPrompts = 0;
assert.equal(confirmAiImageMaskDraftDiscard(false, () => { discardPrompts += 1; return false; }), true);
assert.equal(confirmAiImageMaskDraftDiscard(true, () => { discardPrompts += 1; return false; }), false);
assert.equal(discardPrompts, 1);
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [
    { assetId: 'source-1', role: 'REFERENCE', url: '/source.png' },
    { assetId: 'mask-1', role: 'MASK', url: '/mask.png' },
  ] },
  [{
    sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png',
    assetId: 'source-1', assetUrl: '/source.png', mimeType: 'image/png', width: 800, height: 800,
  }],
), true, 'ephemeral edit masks must not make a current source look stale');
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [{ assetId: 'source-legacy', role: 'REFERENCE', url: '/source.png' }] },
  [{
    sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png',
    assetId: 'source-edit', assetUrl: '/source.png', mimeType: 'image/png', width: 800, height: 800,
    compatibleAssetIds: ['source-edit', 'source-legacy'], editReady: true,
  }],
), true, 'creating an edit companion must not make legacy workflows stale');
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [{ assetId: 'source-from-old-snapshot', role: 'REFERENCE', url: '/old.png' }] },
  [{
    sourceMediaKey: 'main', role: 'main', sourceUrl: '/source.png',
    assetId: 'source-edit', assetUrl: '/source.png', mimeType: 'image/png', width: 800, height: 800,
    compatibleAssetIds: ['source-edit', 'source-legacy'], editReady: true,
  }],
), false, 'compatibility aliases must not accept an asset from another snapshot');
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [{
    assetId: 'candidate-1', role: 'REFERENCE', kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: 'snapshot-1', url: '/candidate.png',
  }] },
  [],
  'snapshot-1',
), true, 'a normalized generated candidate remains current through its frozen source snapshot');
assert.equal(isAiMediaWorkflowInputCurrent(
  { inputs: [{
    assetId: 'candidate-old', role: 'REFERENCE', kind: 'AI_GENERATED',
    sourceCaptureSnapshotId: 'snapshot-old', url: '/candidate-old.png',
  }] },
  [],
  'snapshot-1',
), false, 'a generated candidate from an old snapshot must be stale');

let history = createAiImageMaskHistory();
let stroke = createAiImageMaskStroke('paint', 0.05, { x: -1, y: 2 });
assert.deepEqual(stroke.points[0], { x: 0, y: 1 });
stroke = appendAiImageMaskPoint(stroke, { x: 0.5, y: 0.5 });
history = commitAiImageMaskStroke(history, stroke);
assert.equal(hasAiImageMaskPaint(history), true);
history = undoAiImageMaskHistory(history);
assert.equal(history.strokes.length, 0);
assert.equal(history.redo.length, 1);
history = redoAiImageMaskHistory(history);
assert.equal(history.strokes.length, 1);
history = clearAiImageMaskHistory(history);
assert.equal(history.strokes.length, 0);
history = undoAiImageMaskHistory(history);
assert.equal(history.strokes.length, 1, 'clear must be undoable');

const panel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const sourcePage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/source/page.tsx', 'utf8');
const editor = fs.readFileSync('apps/web/src/components/ai-media/source-ai-image-mask-editor.tsx', 'utf8');
const workflow = fs.readFileSync('apps/web/src/lib/ai-media-workflow.ts', 'utf8');
const preflight = fs.readFileSync('scripts/preflight.mjs', 'utf8');

assert.match(workflow, /'FULL_EDIT' \| 'INPAINT'/u);
assert.match(workflow, /buildAiImageEditWorkflowRequest/u);
assert.match(workflow, /input\.role !== 'MASK'/u);
assert.match(panel, /SourceAiImageMaskEditor/u);
assert.match(panel, /FULL_EDIT/u);
assert.match(panel, /INPAINT/u);
assert.match(panel, /edit-masks/u);
assert.match(panel, /purpose: requireEditReady \? 'EDIT' : 'GENERAL'/u);
assert.match(panel, /selected\.editReady/u);
assert.match(panel, /maskAssetId/u);
assert.match(panel, /fullEditIntentRef/u);
assert.match(panel, /inpaintIntentRef/u);
assert.match(panel, /mode: 'append'/u);
assert.match(panel, /confirmMaskDraftDiscard/u);
assert.match(panel, /beforeunload/u);
assert.match(panel, /popstate/u);
assert.match(panel, /history\.pushState/u);
assert.match(panel, /loadCoordinatorRef\.current\?\.invalidate\(\)/u);
assert.match(panel, /request\.interactive/u);
assert.match(panel, /load\(true, true, true\)/u);
assert.match(panel, /当前遮罩草稿已保留/u);
assert.match(panel, /onMaskDraftDirtyChange/u);
assert.match(sourcePage, /aiMaskDraftDirty/u);
assert.match(sourcePage, /confirmAiImageMaskDraftDiscard/u);
assert.match(sourcePage, /onMaskDraftDirtyChange=\{onAiMaskDraftDirtyChange\}/u);
assert.match(sourcePage, /onClick=\{\(\) => selectSection\(section\.key\)\}/u);
assert.match(sourcePage, /onOpenChange=\{\(open\) => \{ if \(!open\) closeDetail\(\); \}\}/u);
assert.match(panel, /workflow\.inputs\.find\(\(input\) => input\.role === 'REFERENCE'\)/u);
assert.match(panel, /selectCandidateSource/u);
assert.match(panel, /contextSkuKey: workflow\.contextSkuKey/u);
assert.match(panel, /contextSlotKey: workflow\.contextSlotKey/u);
assert.match(panel, /skuKey: selected\.contextSkuKey \?\? null/u);
assert.match(panel, /slotKey: selected\.contextSlotKey \?\? null/u);
assert.match(panel, /edit-masks[\s\S]{0,500}skuKey: selected\.contextSkuKey[\s\S]{0,200}slotKey: selected\.contextSlotKey/u);
assert.match(panel, /buildAiImageEditWorkflowRequest\([\s\S]{0,500}contextSkuKey: selected\.contextSkuKey[\s\S]{0,200}contextSlotKey: selected\.contextSlotKey/u);
assert.match(panel, /继续全图编辑/u);
assert.match(panel, /继续局部重绘/u);
assert.match(panel, /if \(!context \|\| !isAiMediaWorkflowInputCurrent\(\s*workflow,\s*context\.inputs,\s*context\.snapshot\.id,/u);
assert.match(editor, /onPointerDown/u);
assert.match(editor, /onPointerMove/u);
assert.match(editor, /onPointerUp/u);
assert.match(editor, /setPointerCapture/u);
assert.match(editor, /activePointerIdRef/u);
assert.match(editor, /onLostPointerCapture/u);
assert.match(editor, /touchAction: 'none'/u);
assert.match(editor, /stroke\.mode === 'erase' \? '#000000'/u);
assert.match(editor, /toBlob[\s\S]*'image\/png'/u);
assert.match(editor, /exportedMaskIsPartial/u);
assert.match(editor, /getImageData\(0, 0, width, height\)/u);
assert.match(editor, /FileReader/u);
assert.match(editor, /Undo2/u);
assert.match(editor, /Redo2/u);
assert.match(editor, /Eraser/u);
assert.match(editor, /type="range"/u);
assert.match(preflight, /web-ai-media-edit-workbench\.test\.mjs/u);

console.log('PASS Web AI media full-edit and inpaint workbench contract');
