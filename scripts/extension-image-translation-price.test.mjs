import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import vm from 'node:vm';

const context = { URL, URLSearchParams, TextEncoder, crypto: webcrypto };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/erp-adapter/listing-workflow-client.js', 'utf8'), context);
const input = { shopId: 'shop-1', listingWorkflowId: 'draft-1', snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  revision: 1, draftRevision: 1, draftVersion: 1, sourceMediaKey: 'main-1', workflowOperationKey: 'translation-1' };
const price = { currency: 'CNY', unitCostCents: 14, maximumCostCents: 14, quoteFingerprint: 'a'.repeat(64) };
const capability = { enabled: false, ready: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED', reason: '待验收',
  revision: '1', testOnly: false, operation: 'IMAGE_TRANSLATE', sourceLanguage: 'zh', targetLanguage: 'ru', price };

test('paid image translation price survives strict legacy and v2 launch projection parsing', async () => {
  const operations = Object.fromEntries(['IMAGE_TRANSLATE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].map(operation => [operation, {
    enabled: false, ready: false, reasonCode: 'MEDIA_PROVIDER_NOT_ALLOWED', reason: '待验收', revision: '1', testOnly: false, operation,
    ...(operation === 'IMAGE_TRANSLATE' ? { sourceLanguage: 'zh', targetLanguage: 'ru', price } : {}),
    ...(operation === 'IMAGE_TO_IMAGE' ? { maxReferences: 1 } : {}),
    ...(operation === 'INPAINT' ? { maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1', maxMaskBytes: 1024 } : {}),
  }]));
  for (const data of [{ capability, context: null }, { contractVersion: 'extension-media-launch/v2', revision: '1', operations, context: null }]) {
    const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => ({ state: 'response', body: { code: 1, data } }) } });
    const result = await client.getMediaLaunch(input);
    assert.equal(result.state, 'disabled');
    assert.deepEqual(JSON.parse(JSON.stringify((result.operations?.IMAGE_TRANSLATE || result.capability).price)), price);
  }
});

test('translation price confirmation travels unchanged through the device grant and execute envelope', async () => {
  const calls = [];
  const client = context.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({ transport: { get: async () => { throw new Error('no GET'); }, post: async (path, body) => {
    calls.push({ path, body });
    return { state: 'response', body: { code: 1, data: path.endsWith('/command-grants')
      ? { grantToken: 'g'.repeat(43) }
      : { receipt: { status: 'SUCCEEDED', result: { workflowId: 'translation-1', action: 'CREATE_TRANSLATION', operation: 'IMAGE_TRANSLATE', status: 'QUEUED', revision: 1 } } } } };
  } } });
  const confirmation = { currency: price.currency, maximumCostCents: price.maximumCostCents, quoteFingerprint: price.quoteFingerprint };
  await client.createTranslationCommand({ ...input, priceConfirmation: confirmation });
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body.command.priceConfirmation)), confirmation);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].body.command.priceConfirmation)), confirmation);
  calls.length = 0;
  for (const priceConfirmation of [{ ...confirmation, apiKey: 'forbidden' }, { ...confirmation, maximumCostCents: 0 }, { ...confirmation, currency: 'EUR' }]) {
    await assert.rejects(client.createTranslationCommand({ ...input, priceConfirmation }));
  }
  assert.equal(calls.length, 0);
});
