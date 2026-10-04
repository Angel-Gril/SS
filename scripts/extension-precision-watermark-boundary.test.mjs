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
  for (const type of ['ss-erp:source-workbench-watermark-preview', 'ss-erp:source-workbench-watermark-apply']) {
    assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, source, extensionId), true);
    for (const sender of [{ ...source, frameId: 2 }, { ...source, documentId: '' }, { ...source, id: 'foreign' },
      { ...source, url: 'https://detail.1688.com/login' }, { ...source, url: `chrome-extension://${extensionId}/pages/precision-workbench.html` },
      { ...source, url: `chrome-extension://${extensionId}/pages/settings.html` }, { ...source, url: 'https://app.ss-erp.com' }]) {
      assert.equal(context.SS_ERP_RUNTIME_MESSAGE_POLICY.isAllowedRuntimeMessageSender(type, sender, extensionId), false);
    }
  }
});
