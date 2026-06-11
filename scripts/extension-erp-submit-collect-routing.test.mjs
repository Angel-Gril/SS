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
}

console.log('PASS ERP submitCollect routing');
