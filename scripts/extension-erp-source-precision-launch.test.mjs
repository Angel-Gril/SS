import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtimeId = 'abcdefghijklmnopabcdefghijklmnop';
const nonce = 'a'.repeat(48);
const context = {
  contractVersion: 'extension-byok-workbench-launch-context/v1',
  sourcePlatform: '1688', sourceProductId: '990499606077',
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
  shopId: 'shop-1', workflowId: 'draft-1', draftRevision: 3, draftVersion: 4,
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND', assignmentOrdinal: 0,
};
const authority = { provenance: 'ERP_SOURCE', ownerUserId: 'owner-1', deviceSessionId: 'device-1',
  apiOrigin: 'https://ss-erp.com', webOrigin: 'https://app.ss-erp.com', grantSha256: 'b'.repeat(64) };
const handoff = { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', snapshotVersion: 1,
  sourceProductId: '990499606077', platform: '1688',
  path: '/collect/source?supplyGoodsId=goods-1&snapshotId=snapshot-1&snapshotVersion=1&sourceProductId=990499606077&platform=1688&section=listing' };

function load() {
  const sandbox = vm.createContext({ URL, Date, Map, Set, WeakMap, Promise, setTimeout, clearTimeout });
  sandbox.globalThis = sandbox;
  for (const file of ['erp-source-image-launch.js', '../byok/workbench-launch-session.js', 'erp-source-precision-launch.js']) {
    vm.runInContext(readFileSync(new URL(`../extensions/ss-erp/shared/erp-adapter/${file}`, import.meta.url), 'utf8'), sandbox, { filename: file });
  }
  return sandbox.SS_ERP_ERP_SOURCE_PRECISION_LAUNCH;
}
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function resolveProductUrl(value) {
  const url = new URL(value);
  const platform = url.hostname === 'detail.1688.com' ? '1688' : url.hostname === 'item.taobao.com' ? 'taobao'
    : url.hostname === 'detail.tmall.com' ? 'tmall' : url.hostname === 'mobile.yangkeduo.com' ? 'pdd' : '';
  const productId = platform === '1688' ? url.pathname.match(/^\/offer\/(.+)\.html$/u)?.[1]
    : url.searchParams.get(platform === 'pdd' ? 'goods_id' : 'id');
  return platform && productId ? { sourcePlatform: platform, sourceProductId: decodeURIComponent(productId) } : null;
}

function fixture(overrides = {}) {
  const api = load(), values = {}, calls = [], sourceUrl = 'https://detail.1688.com/offer/990499606077.html';
  let now = 0, manager;
  let liveTab = { id: 12, url: sourceUrl, status: 'complete' };
  const sender = () => ({ id: runtimeId, tab: { ...liveTab }, frameId: 0,
    documentId: 'source-document', url: liveTab.url, origin: new URL(liveTab.url).origin });
  const sessionStorage = {
    async get(keys) { return Object.fromEntries(keys.filter(key => Object.hasOwn(values, key)).map(key => [key, plain(values[key])])); },
    async set(patch) { Object.assign(values, plain(patch)); },
    async remove(keys) { for (const key of keys) delete values[key]; },
  };
  const options = { runtimeId, sessionStorage, resolveProductUrl, randomNonce: () => nonce,
    now: () => now, delay: async milliseconds => { now += milliseconds; },
    verifyErpSourceAuthority: async input => { calls.push(['verify', plain(input)]); return true; },
    verifySourceDocument: async input => { calls.push(['document', plain(input)]); return true; },
    loadBinding: async input => { calls.push(['binding', plain(input)]); return { context: plain(input), handoff: plain(handoff) }; },
    persistHandoff: async input => { calls.push(['persist', plain(input)]); return input; },
    tabs: {
      async query() { return [{ ...liveTab }]; },
      async create(input) { calls.push(['create', input]); liveTab = { id: 24, url: input.url, status: 'complete' }; return { ...liveTab }; },
      async get(tabId) { assert.equal(tabId, liveTab.id); return { ...liveTab }; },
      async update(tabId, input) { calls.push(['focus', { tabId, ...input }]); return { ...liveTab }; },
      async sendMessage(tabId, input, target) {
        calls.push(['send', { tabId, input: plain(input), target: plain(target) }]);
        const claimed = await manager.claim({ type: api.CLAIM_MESSAGE_TYPE, nonce: input.nonce }, sender());
        return { ok: true, state: 'WORKBENCH_OPENED', workflowId: claimed.context.workflowId,
          draftRevision: claimed.context.draftRevision, draftVersion: claimed.context.draftVersion };
      },
    }, ...overrides,
  };
  manager = api.createLauncher(options);
  return { api, options, manager, values, calls, sender,
    setTab: value => { liveTab = { ...liveTab, ...value }; }, setNow: value => { now = value; },
    input: { context: plain(context), sourceTabId: 9, sourceDocumentId: 'erp-document', erpSourceAuthority: plain(authority) },
  };
}

test('a valid ERP grant focuses the real source precision iframe without legacy workbench navigation', async () => {
  const run = fixture();
  const result = await run.manager.open(run.input);
  assert.deepEqual(plain(result), { state: 'workbench_focused', tabId: 12 });
  assert.equal(run.calls.filter(([name]) => name === 'create').length, 0);
  assert.deepEqual(run.calls.find(([name]) => name === 'send')[1].input,
    { type: 'ss-erp:precision-erp-workbench-open', nonce });
  assert.deepEqual(run.calls.find(([name]) => name === 'persist')[1], handoff);
  assert.equal(JSON.stringify(run.calls).includes('ai-image-workbench'), false);
  await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce }, run.sender()));
});

test('one new canonical source tab is created when no source tab exists', async () => {
  const run = fixture(); run.options.tabs.query = async () => [];
  const result = await run.manager.open(run.input);
  assert.equal(result.state, 'workbench_opened');
  assert.equal(result.tabId, 24);
  assert.deepEqual(plain(run.calls.filter(([name]) => name === 'create').map(([, value]) => value)),
    [{ url: 'https://detail.1688.com/offer/990499606077.html', active: false }]);
});

test('canonical source URLs are fixed to the four supported marketplace origins', () => {
  const { api } = fixture();
  assert.equal(api.canonicalSourceUrl({ ...context, sourcePlatform: 'taobao' }), 'https://item.taobao.com/item.htm?id=990499606077');
  assert.equal(api.canonicalSourceUrl({ ...context, sourcePlatform: 'tmall' }), 'https://detail.tmall.com/item.htm?id=990499606077');
  assert.equal(api.canonicalSourceUrl({ ...context, sourcePlatform: 'pdd' }), 'https://mobile.yangkeduo.com/goods.html?goods_id=990499606077');
  assert.throws(() => api.canonicalSourceUrl({ ...context, sourcePlatform: 'jd' }));
});

test('ambiguous source tabs fail without choosing a tab or creating another', async () => {
  const run = fixture(); run.options.tabs.query = async () => [run.sender().tab, { ...run.sender().tab, id: 13 }];
  await assert.rejects(run.manager.open(run.input));
  assert.equal(run.calls.some(([name]) => ['create', 'send', 'focus'].includes(name)), false);
});

test('authority failure and wrong server snapshot or version refuse launch before source delivery', async () => {
  for (const key of ['device', 'snapshot', 'workflow', 'revision', 'version', 'sku']) {
    const run = fixture();
    if (key === 'device') run.options.verifyErpSourceAuthority = async () => false;
    else run.options.loadBinding = async value => ({ context: { ...value,
      ...(key === 'workflow' ? { workflowId: 'other-draft' } : key === 'revision' ? { draftRevision: 99 }
        : key === 'version' ? { draftVersion: 99 } : key === 'sku' ? { skuKey: 'other-sku', slotKey: 'sku:other-sku:hero' } : {}) },
      handoff: { ...handoff, ...(key === 'snapshot' ? { snapshotId: 'other-snapshot' } : {}) } });
    await assert.rejects(run.manager.open(run.input));
    assert.equal(run.calls.some(([name]) => ['create', 'send', 'persist'].includes(name)), false);
  }
});

test('claims accept only a live exact source top document and refuse forged sender fields', async () => {
  const run = fixture();
  run.options.tabs.sendMessage = async (tabId, message) => {
    const actual = run.sender();
    for (const patch of [{ id: 'foreign' }, { frameId: 1 }, { documentId: '' },
      { tab: { ...actual.tab, id: 13 } }, { url: 'https://item.taobao.com/item.htm?id=990499606077' },
      { origin: 'https://evil.invalid' }, { url: actual.url + '#fake' }]) {
      await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, { ...actual, ...patch }));
    }
    const claimed = await run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, actual);
    return { ok: true, state: 'WORKBENCH_OPENED', workflowId: claimed.context.workflowId,
      draftRevision: claimed.context.draftRevision, draftVersion: claimed.context.draftVersion };
  };
  await run.manager.open(run.input);
  assert.equal(run.calls.filter(([name]) => name === 'persist').length, 1);
});

test('a claim is single use even when two documents race concurrently', async () => {
  const run = fixture();
  run.options.tabs.sendMessage = async (tabId, message) => {
    const results = await Promise.allSettled([run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, run.sender()),
      run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, { ...run.sender(), documentId: 'other-document' })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    return { ok: true, state: 'WORKBENCH_OPENED', workflowId: context.workflowId,
      draftRevision: context.draftRevision, draftVersion: context.draftVersion };
  };
  await run.manager.open(run.input);
  assert.equal(run.calls.filter(([name]) => name === 'persist').length, 1);
});

test('expired nonce and unknown or secret-bearing claim fields are rejected', async () => {
  const run = fixture();
  run.options.tabs.sendMessage = async (tabId, message) => {
    for (const input of [{ type: run.api.CLAIM_MESSAGE_TYPE, nonce: 'c'.repeat(48) },
      { type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce, launchToken: 'never-forward-this' }]) {
      await assert.rejects(run.manager.claim(input, run.sender()));
    }
    run.setNow(30_001);
    await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, run.sender()));
    return { ok: false };
  };
  await assert.rejects(run.manager.open(run.input));
  assert.equal(run.calls.some(([name]) => name === 'persist'), false);
});

test('device or draft changes between open and claim refuse the actual claim', async () => {
  for (const changed of ['authority', 'binding']) {
    const run = fixture();
    run.options.tabs.sendMessage = async (tabId, message) => {
      if (changed === 'authority') run.options.verifyErpSourceAuthority = async () => false;
      else run.options.loadBinding = async value => ({ context: { ...value, draftVersion: 99 }, handoff });
      await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, run.sender()));
      return { ok: false };
    };
    await assert.rejects(run.manager.open(run.input));
    assert.equal(run.calls.some(([name]) => name === 'persist'), false);
  }
});

test('navigation to another origin or product refuses claim without caching the handoff', async () => {
  for (const url of ['https://evil.invalid/offer/990499606077.html', 'http://detail.1688.com/offer/990499606077.html',
    'https://detail.1688.com/offer/other-product.html', 'https://detail.1688.com/login']) {
    const run = fixture();
    run.options.tabs.sendMessage = async (tabId, message) => {
      run.setTab({ url });
      await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, run.sender()));
      return { ok: false };
    };
    await assert.rejects(run.manager.open(run.input));
    assert.equal(run.calls.some(([name]) => name === 'persist'), false);
  }
});

test('source delivery retries only a proved absent receiver for a bounded loading interval', async () => {
  const run = fixture(); let delivered = 0;
  const send = run.options.tabs.sendMessage;
  run.options.tabs.sendMessage = async (...args) => {
    delivered += 1;
    if (delivered < 3) throw new Error('Could not establish connection. Receiving end does not exist.');
    return send(...args);
  };
  await run.manager.open(run.input);
  assert.equal(delivered, 3);
  assert.equal(run.calls.filter(([name]) => name === 'persist').length, 1);
});

test('unknown transport outcome is never retried and is reported without dependency secrets', async () => {
  const run = fixture(); let delivered = 0;
  run.options.tabs.sendMessage = async () => { delivered += 1; throw new Error('The message port closed before a response was received. PRIVATE_SENTINEL'); };
  await assert.rejects(run.manager.open(run.input), error => error.code === 'ERP_SOURCE_PRECISION_ACK_UNKNOWN'
    && !error.message.includes('PRIVATE_SENTINEL'));
  assert.equal(delivered, 1);
  assert.equal(run.calls.some(([name]) => name === 'persist'), false);
});

test('successful-looking acknowledgements without claim or with wrong binding are rejected', async () => {
  for (const field of ['unclaimed', 'workflowId', 'draftRevision', 'draftVersion', 'state']) {
    const run = fixture();
    const original = run.options.tabs.sendMessage;
    run.options.tabs.sendMessage = async (...args) => {
      const response = field === 'unclaimed' ? { ok: true, state: 'WORKBENCH_OPENED', workflowId: context.workflowId,
        draftRevision: context.draftRevision, draftVersion: context.draftVersion } : await original(...args);
      return field === 'unclaimed' ? response : { ...response, [field]: field.startsWith('draft') ? 99 : 'wrong' };
    };
    await assert.rejects(run.manager.open(run.input));
    assert.equal(run.calls.some(([name]) => name === 'focus'), false);
  }
});

test('pending claims survive Worker reconstruction with single-use and live authority checks', async () => {
  const run = fixture();
  run.options.tabs.sendMessage = async (tabId, message) => {
    const restarted = run.api.createLauncher(run.options);
    const claimed = await restarted.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, run.sender());
    await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce: message.nonce }, run.sender()));
    return { ok: true, state: 'WORKBENCH_OPENED', workflowId: claimed.context.workflowId,
      draftRevision: claimed.context.draftRevision, draftVersion: claimed.context.draftVersion };
  };
  await run.manager.open(run.input);
  assert.equal(run.calls.filter(([name]) => name === 'persist').length, 1);
});

test('binding or source changes after source acknowledgement are rejected before focus', async () => {
  const run = fixture(); const original = run.options.tabs.sendMessage;
  run.options.tabs.sendMessage = async (...args) => { const response = await original(...args); run.setTab({ url: 'https://detail.1688.com/login' }); return response; };
  await assert.rejects(run.manager.open(run.input));
  assert.equal(run.calls.some(([name]) => name === 'focus'), false);
});

test('an always-absent receiver stops within three seconds without creating more tabs', async () => {
  const run = fixture(); let delivered = 0;
  run.options.tabs.query = async () => [];
  run.options.tabs.sendMessage = async () => { delivered += 1; throw new Error('Could not establish connection. Receiving end does not exist.'); };
  await assert.rejects(run.manager.open(run.input), { code: 'ERP_SOURCE_PRECISION_SOURCE_NOT_READY' });
  assert.ok(delivered <= 61);
  assert.equal(run.calls.filter(([name]) => name === 'create').length, 1);
  assert.equal(run.calls.some(([name]) => name === 'persist'), false);
});

test('a nonce collision cannot consume or remove another in-flight launch', async () => {
  const run = fixture(); const original = run.options.tabs.sendMessage;
  let release, entered;
  const isEntered = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  run.options.tabs.sendMessage = async (...args) => { entered(); await wait; return original(...args); };
  const first = run.manager.open(run.input);
  await isEntered;
  await assert.rejects(run.manager.open(run.input), { code: 'ERP_SOURCE_PRECISION_CAPACITY_EXCEEDED' });
  release();
  assert.equal((await first).state, 'workbench_focused');
  assert.equal(run.calls.filter(([name]) => name === 'persist').length, 1);
});

test('a lost acknowledgement is bounded, unknown and never automatically sent again', async () => {
  const run = fixture({ acknowledgementTimeoutMs: 5 }); let delivered = 0;
  run.options.tabs.sendMessage = () => { delivered += 1; return new Promise(() => {}); };
  await assert.rejects(run.manager.open(run.input), { code: 'ERP_SOURCE_PRECISION_ACK_UNKNOWN' });
  assert.equal(delivered, 1);
});

test('dependency exception text is redacted even when its code is recognized', async () => {
  const run = fixture();
  run.options.verifyErpSourceAuthority = async () => { throw Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'ERP_SOURCE_PRECISION_AUTHORITY_STALE' }); };
  await assert.rejects(run.manager.open(run.input), error => error.code === 'ERP_SOURCE_PRECISION_AUTHORITY_STALE'
    && error.message === 'ERP_SOURCE_PRECISION_AUTHORITY_STALE');
});

test('a consumed claim permits a bounded slow read-only iframe refresh without extending claim permission', async () => {
  const run = fixture(); const original = run.options.tabs.sendMessage;
  run.options.tabs.sendMessage = async (...args) => {
    const response = await original(...args);
    run.setNow(20_000);
    await assert.rejects(run.manager.claim({ type: run.api.CLAIM_MESSAGE_TYPE, nonce }, run.sender()));
    return response;
  };
  assert.equal((await run.manager.open(run.input)).state, 'workbench_focused');
  assert.equal(run.calls.filter(([name]) => name === 'persist').length, 1);
});

test('a consumed claim still refuses a readback acknowledgement after its independent deadline', async () => {
  const run = fixture(); const original = run.options.tabs.sendMessage;
  run.options.tabs.sendMessage = async (...args) => { const response = await original(...args); run.setNow(30_001); return response; };
  await assert.rejects(run.manager.open(run.input), { code: 'ERP_SOURCE_PRECISION_ACK_INVALID' });
  assert.equal(run.calls.some(([name]) => name === 'focus'), false);
});

test('a source document fence is required before constructing the launcher', () => {
  const run = fixture();
  assert.throws(() => run.api.createLauncher({ ...run.options, verifySourceDocument: undefined }),
    { code: 'ERP_SOURCE_PRECISION_UNAVAILABLE' });
});

test('a successful acknowledgement checks the exact nonce-claiming document before focusing', async () => {
  const run = fixture();
  await run.manager.open(run.input);
  assert.deepEqual(run.calls.find(([name]) => name === 'document')[1],
    { tabId: 12, documentId: 'source-document', context });
  assert.ok(run.calls.findIndex(([name]) => name === 'document') < run.calls.findIndex(([name]) => name === 'focus'));
});

test('same-URL source reload cannot use its previous document acknowledgement', async () => {
  const run = fixture();
  run.options.verifySourceDocument = async input => {
    assert.equal(input.documentId, 'source-document');
    assert.equal(run.sender().url, 'https://detail.1688.com/offer/990499606077.html');
    return false;
  };
  await assert.rejects(run.manager.open(run.input), { code: 'ERP_SOURCE_PRECISION_SOURCE_CHANGED' });
  assert.equal(run.calls.some(([name]) => name === 'focus'), false);
});

test('a lost document check fails safely without resending the open nonce', async () => {
  const run = fixture(); let opens = 0;
  const original = run.options.tabs.sendMessage;
  run.options.tabs.sendMessage = async (...args) => { opens += 1; return original(...args); };
  run.options.verifySourceDocument = async () => { throw new Error('PRIVATE_DOCUMENT_SENTINEL'); };
  await assert.rejects(run.manager.open(run.input), error => !error.message.includes('PRIVATE_DOCUMENT_SENTINEL'));
  assert.equal(opens, 1);
  assert.equal(run.calls.some(([name]) => name === 'focus'), false);
});
