import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('extensions/ss-erp/shared/config-bridge/config-store.js', 'utf8');
const operations = [
  ['readSnapshot', []],
  ['readOfficialSnapshot', []],
  ['readCommissionSnapshot', []],
  ['readFxSnapshot', []],
  ['writeSnapshot', [{ userConfig: { selectedServiceIds: ['test-route'] } }]],
  ['writeLogisticsCalculatorState', [{ state: 'unavailable', quoteAllowed: false }]],
];

function loadStore(local, enabled = true) {
  const context = {
    window: { SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE: { enabled } },
    chrome: { storage: { local }, runtime: { getManifest: () => ({ version: '1.0.458' }) } },
  };
  vm.runInNewContext(source, context, { filename: 'config-store.js' });
  return context.window.OZON_CALC_CONFIG_STORE;
}

for (const [method, args] of operations) {
  for (const mode of ['throw', 'reject']) {
    test(`${method} converts ${mode} invalidated context into a catchable, redacted rejection`, async () => {
      const invalidation = new Error('Extension context invalidated. diagnostic=private-test-sentinel');
      const fail = () => {
        if (mode === 'throw') throw invalidation;
        return Promise.reject(invalidation);
      };
      const store = loadStore({ get: fail, set: fail });
      let result;
      assert.doesNotThrow(() => { result = store[method](...args); });
      assert.equal(typeof result?.then, 'function', 'storage operations must always return a Promise');
      await assert.rejects(result, (error) => {
        assert.equal(error.code, 'extension_context_invalidated');
        assert.match(error.message, /刷新/);
        assert.doesNotMatch(String(error.stack), /private-test-sentinel/);
        return true;
      });
    });
  }

  test(`${method} preserves non-context storage failures without resolving healthy defaults`, async () => {
    const unavailable = new Error('Storage unavailable');
    const fail = () => { throw unavailable; };
    const store = loadStore({ get: fail, set: fail });
    let result;
    assert.doesNotThrow(() => { result = store[method](...args); });
    await assert.rejects(result, (error) => error === unavailable);
  });
}

test('a throwing Chrome storage getter is also inside the Promise boundary', async () => {
  const local = Object.defineProperty({}, 'get', {
    get() { throw new Error('Extension context invalidated.'); },
  });
  const store = loadStore(local);
  let result;
  assert.doesNotThrow(() => { result = store.readSnapshot(); });
  await assert.rejects(result, { code: 'extension_context_invalidated' });
});

test('successful storage keeps exact snapshot reads and writes', async () => {
  const values = {
    'ozon-calc:config-snapshot': { userConfig: { selectedServiceIds: ['manual-route'] } },
    'ozon-calculator:official-snapshot': { samples: [{ id: 'sample' }] },
    'ozon-calculator:commission-snapshot': { rate: 0.12 },
    'ozon-calculator:fx-snapshot': { RUB: 0.1 },
  };
  const store = loadStore({
    get: async (keys) => Object.fromEntries(keys.map((key) => [key, values[key]])),
    set: async (input) => { Object.assign(values, input); },
  }, false);
  assert.deepEqual(JSON.parse(JSON.stringify(await store.readSnapshot())), {
    snapshot: values['ozon-calc:config-snapshot'], updatedAt: '', logisticsStatus: null,
  });
  assert.equal(await store.readOfficialSnapshot(), values['ozon-calculator:official-snapshot']);
  assert.equal(await store.readCommissionSnapshot(), values['ozon-calculator:commission-snapshot']);
  assert.equal(await store.readFxSnapshot(), values['ozon-calculator:fx-snapshot']);
  const nextSnapshot = { userConfig: { selectedServiceIds: ['next-route'] } };
  await store.writeSnapshot(nextSnapshot);
  assert.equal(values['ozon-calc:config-snapshot'], nextSnapshot);
  assert.equal(Number.isFinite(Date.parse(values['ozon-calc:config-updated-at'])), true);
  const denied = { state: 'revoked', quoteAllowed: false };
  await store.writeLogisticsCalculatorState(denied);
  assert.equal(values['ozon-logistics:calculator-state:v1'], denied);
});

test('successful storage never turns an unpaired cached authority into allowed quotes', async () => {
  const remote = {
    source: 'remote', state: 'healthy', quoteAllowed: true,
    snapshot: { privateRules: 'must-not-be-exposed' },
    officialSnapshot: { privateRules: 'must-not-be-exposed' },
    authority: { sessionId: 'cached-session', deploymentId: 'test-deployment', ownerUserId: 'test-owner' },
  };
  const store = loadStore({ get: async () => ({ 'ozon-logistics:calculator-state:v1': remote }) });
  const result = await store.readSnapshot();
  assert.equal(result.snapshot, null);
  assert.equal(result.logisticsStatus.state, 'unpaired');
  assert.equal(result.logisticsStatus.quoteAllowed, false);
  assert.equal(result.logisticsStatus.route, null);
  assert.equal(await store.readOfficialSnapshot(), null);
});
