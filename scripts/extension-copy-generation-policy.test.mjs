import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const context = { URL };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/message-security/runtime-message-policy.js', 'utf8'), context);
const policy = context.SS_ERP_RUNTIME_MESSAGE_POLICY;
const id = 'abcdefghijklmnopabcdefghijklmnop';
const source = { id, frameId: 0, documentId: 'document-fixture', url: 'https://detail.1688.com/offer/123.html',
  tab: { id: 7, url: 'https://detail.1688.com/offer/123.html' } };
for (const type of ['ss-erp:source-listing-workbench-editor-copy-capability', 'ss-erp:source-listing-workbench-editor-copy-generate']) {
  test(type + ' accepts only the supported source-product document', () => {
    assert.equal(policy.isAllowedRuntimeMessageSender(type, source, id), true);
    for (const sender of [{ ...source, frameId: 3 }, { ...source, documentId: '' },
      { id, url: `chrome-extension://${id}/pages/popup.html` }, { id, url: `chrome-extension://${id}/pages/precision-workbench.html` },
      { ...source, url: 'https://detail.1688.com/login', tab: { id: 7, url: 'https://detail.1688.com/login' } },
      { ...source, id: 'foreign' }]) assert.equal(policy.isAllowedRuntimeMessageSender(type, sender, id), false);
  });
}
