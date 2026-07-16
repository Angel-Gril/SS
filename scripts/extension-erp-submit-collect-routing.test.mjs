import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadAdapter(filePath, adapterName) {
  const calls = [];
  const context = {
    console,
    URL,
    self: null,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { json: async () => ({ code: 1, data: { url } }) };
    },
  };
  context.self = context;
  context.SS_ERP_CONFIG = {
    getConfig: async () => ({
      baseUrl: 'http://erp.local',
      token: 'token-123',
    }),
  };

  vm.runInNewContext(fs.readFileSync(filePath, 'utf8'), context, { filename: filePath });
  return { adapter: context[adapterName], calls };
}

for (const [filePath, adapterName] of [
  ['extensions/ss-erp/shared/adapters/local-adapter.js', 'SS_ERP_LOCAL_ADAPTER'],
  ['extensions/ss-erp/shared/adapters/cloud-adapter.js', 'SS_ERP_CLOUD_ADAPTER'],
]) {
  const { adapter, calls } = loadAdapter(filePath, adapterName);

  assert.ok(adapter, `${adapterName} should be registered`);
  assert.equal(typeof adapter.submitCollect, 'function', `${adapterName}.submitCollect should exist`);

  await adapter.submitCollect({ items: [{ title: '1688 source product' }] });
  assert.equal(
    calls.at(-1)?.url,
    'http://erp.local/api/collect/batch',
    `${adapterName}.submitCollect({ items }) should route to the ERP batch collect API`,
  );

  await adapter.submitCollect({ title: 'single product' });
  assert.equal(
    calls.at(-1)?.url,
    'http://erp.local/api/collect',
    `${adapterName}.submitCollect(single) should keep the single collect API`,
  );

  const operation = {
    state: 'paired',
    baseUrl: 'https://device.erp.example',
    accessToken: 'device-access-token',
  };
  const command = {
    schemaVersion: 'source-product-capture-v2',
    platform: '1688',
    sourceProductId: '1000000000236',
    captureHash: 'a'.repeat(64),
    payloadBytes: 12345,
  };
  assert.equal(
    typeof adapter.requestSourceCaptureGrant,
    'function',
    `${adapterName}.requestSourceCaptureGrant should exist`,
  );
  await adapter.requestSourceCaptureGrant(operation, {
    idempotencyKey: `source-capture-${'a'.repeat(64)}`,
    command,
  });
  assert.equal(calls.at(-1)?.url, 'https://device.erp.example/api/extension-device/command-grants');
  assert.equal(calls.at(-1)?.options.credentials, 'omit');
  assert.equal(calls.at(-1)?.options.cache, 'no-store');
  assert.equal(calls.at(-1)?.options.headers.Authorization, 'Bearer device-access-token');
  assert.notEqual(calls.at(-1)?.options.headers.Authorization, 'Bearer token-123');
  assert.deepEqual(JSON.parse(calls.at(-1)?.options.body), {
    operation: 'SOURCE_CAPTURE',
    idempotencyKey: `source-capture-${'a'.repeat(64)}`,
    command,
  });

  assert.equal(
    typeof adapter.submitSourceCaptureV2,
    'function',
    `${adapterName}.submitSourceCaptureV2 should exist`,
  );
  await adapter.submitSourceCaptureV2(operation, {
    capture: { captureVersion: 'source-product-capture-v2' },
    captureHash: 'a'.repeat(64),
    payloadBytes: 12345,
    grantToken: 'grant-token',
    idempotencyKey: `source-capture-${'a'.repeat(64)}`,
  });
  assert.equal(calls.at(-1)?.url, 'https://device.erp.example/api/extension-device/source-captures/v2');
  assert.equal(calls.at(-1)?.options.credentials, 'omit');
  assert.equal(calls.at(-1)?.options.cache, 'no-store');
  assert.equal(calls.at(-1)?.options.headers.Authorization, 'Bearer device-access-token');
  assert.notEqual(calls.at(-1)?.options.headers.Authorization, 'Bearer token-123');
  assert.equal(calls.at(-1)?.options.headers['X-SS-ERP-Command-Grant'], 'grant-token');
  assert.equal(
    calls.at(-1)?.options.headers['X-SS-ERP-Idempotency-Key'],
    `source-capture-${'a'.repeat(64)}`,
  );
  assert.deepEqual(JSON.parse(calls.at(-1)?.options.body), {
    capture: { captureVersion: 'source-product-capture-v2' },
    captureHash: 'a'.repeat(64),
    payloadBytes: 12345,
  });
  assert.equal(calls.at(-1)?.options.body.includes('grant-token'), false);

  const publishCommand = {
    schemaVersion: 'ozon-publish-command/v1',
    draftRevision: 11,
    publishIntentId: 'intent-1',
    selectedSkuKeys: ['sku-1'],
  };
  assert.equal(typeof adapter.requestOzonPublishGrant, 'function');
  await adapter.requestOzonPublishGrant(operation, {
    shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
    idempotencyKey: 'ozon-publish-workflow-1-v7', command: publishCommand,
  });
  assert.equal(calls.at(-1)?.url, 'https://device.erp.example/api/extension-device/command-grants');
  assert.equal(calls.at(-1)?.options.credentials, 'omit');
  assert.equal(calls.at(-1)?.options.headers.Authorization, 'Bearer device-access-token');
  assert.deepEqual(JSON.parse(calls.at(-1)?.options.body), {
    operation: 'OZON_PUBLISH',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftVersion: 7,
    idempotencyKey: 'ozon-publish-workflow-1-v7',
    command: publishCommand,
  });
  await adapter.executeOzonPublish(operation, {
    shopId: 'shop-1', workflowId: 'workflow-1', draftVersion: 7,
    idempotencyKey: 'ozon-publish-workflow-1-v7', command: publishCommand,
    grantToken: 'g'.repeat(43),
  });
  assert.equal(calls.at(-1)?.url, 'https://device.erp.example/api/extension-device/ozon-publish/execute');
  assert.equal(calls.at(-1)?.options.headers['X-SS-ERP-Command-Grant'], 'g'.repeat(43));
  assert.equal(calls.at(-1)?.options.body.includes('g'.repeat(43)), false);
}

console.log('PASS ERP submitCollect routing');
