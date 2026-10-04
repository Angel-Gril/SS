import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
const context = { URL };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/message-security/runtime-message-policy.js', 'utf8'), context);
const source = { id: extensionId, frameId: 0, documentId: 'source-document', url: 'https://detail.1688.com/offer/845581683597.html',
  tab: { id: 3, url: 'https://detail.1688.com/offer/845581683597.html' } };
test('watermark commands require the exact top-level marketplace source sender, including previews', () => {
  for (const type of ['ss-erp:source-workbench-watermark-preview', 'ss-erp:source-workbench-watermark-apply', 'ss-erp:source-workbench-watermark-templates',
    'ss-erp:source-workbench-video-read', 'ss-erp:source-workbench-video-save']) {
    assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, source, extensionId), true);
    for (const sender of [{ ...source, frameId: 2 }, { ...source, documentId: '' }, { ...source, id: 'foreign' },
      { ...source, url: 'https://detail.1688.com/login' }, { ...source, url: `chrome-extension://${extensionId}/pages/precision-workbench.html` },
      { ...source, url: `chrome-extension://${extensionId}/pages/settings.html` }, { ...source, url: 'https://app.ss-erp.com' }]) {
      assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, sender, extensionId), false);
    }
  }
});

test('image watermark transport accepts an owned template ID and never an arbitrary watermark URL', () => {
  const contract = {};
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/workspace-contract.js', 'utf8'), contract);
  const binding = { contractVersion: 'extension-workbench-watermark/v1', snapshotId: 'snapshot', supplyGoodsId: 'goods',
    shopId: 'shop', listingWorkflowId: 'draft', draftRevision: 2, draftVersion: 2 };
  const base = { contractVersion: 'ss-erp-donor-workbench/v1', type: 'WATERMARK_PREVIEW', requestId: 'request',
    request: { ...binding, items: [{ skuKey: null, slotKey: 'product-main', sourceMediaKey: 'main' }],
      config: { type: 'image', templateId: 'owned-template', position: 'center', opacity: 60, scale: 25 } } };
  assert.equal(contract.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand(base).request.config.templateId, 'owned-template');
  assert.throws(() => contract.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...base,
    request: { ...base.request, config: { ...base.request.config, imageUrl: 'https://evil.example/watermark.png' } } }));
  assert.equal(contract.SS_ERP_DONOR_WORKBENCH_CONTRACT.parseFrameCommand({ ...base, type: 'WATERMARK_TEMPLATES', request: binding }).type, 'WATERMARK_TEMPLATES');
});
