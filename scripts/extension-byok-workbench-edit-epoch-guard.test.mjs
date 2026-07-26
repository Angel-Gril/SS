import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-edit-epoch-guard.js';
const source = await readFile(modulePath, 'utf8');

function loadApi() {
  const context = vm.createContext({ crypto: globalThis.crypto });
  vm.runInContext(source, context, { filename: modulePath });
  return context.SS_ERP_BYOK_WORKBENCH_EDIT_EPOCH_GUARD;
}

function storageFixture() {
  const values = {};
  return {
    values,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    async remove(keys) { keys.forEach((key) => delete values[key]); },
  };
}

function random(byte) {
  return (bytes) => bytes.fill(byte);
}

function sequentialRandom(firstByte = 1) {
  let byte = firstByte;
  return (bytes) => {
    bytes.fill(byte);
    byte += 1;
  };
}

const context = {
  shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
  sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', skuKey: 'sku-1',
  slotKey: 'sku:sku-1:hero',
};
const owner = { tabId: 42, documentId: 'document-42', context };

test('keeps one active worker epoch current and clears it by exact owner', async () => {
  const api = loadApi();
  const storage = storageFixture();
  const guard = api.createGuard({
    sessionStorage: storage,
    randomValues: sequentialRandom(1),
    now: () => 1000,
  });
  assert.deepEqual({ ...(await guard.assertCurrent(owner)) }, { state: 'EMPTY' });
  assert.deepEqual({ ...(await guard.begin(owner)) }, { state: 'CURRENT', created: true });
  await assert.rejects(
    guard.begin(owner),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.deepEqual({ ...(await guard.assertCurrent(owner, { requireActive: true })) }, {
    state: 'CURRENT',
  });
  guard.rotate();
  await assert.rejects(
    guard.assertCurrent(owner),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED',
  );
  assert.deepEqual({ ...(await guard.acknowledge(owner, {
    warningVersion: 'external-provider-charge/v1', confirmed: true,
  })) }, { clearedCount: 1 });
  await guard.begin(owner);
  assert.equal(await guard.clear({ ...owner, documentId: 'other-document' }), false);
  assert.equal(await guard.clear(owner), true);
  await assert.rejects(
    guard.assertCurrent(owner, { requireActive: true }),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_EPOCH_REQUIRED',
  );
});

test('retained same-document marker blocks a new start until explicit acknowledgement', async () => {
  const api = loadApi();
  const storage = storageFixture();
  const guard = api.createGuard({
    sessionStorage: storage,
    randomValues: random(7),
    now: () => 7000,
  });
  await guard.begin(owner);

  await assert.rejects(
    guard.begin(owner),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  assert.deepEqual({ ...(await guard.acknowledge(owner, {
    warningVersion: 'external-provider-charge/v1', confirmed: true,
  })) }, { clearedCount: 1 });
  assert.deepEqual({ ...(await guard.begin(owner)) }, { state: 'CURRENT', created: true });
});

test('fails closed after a service-worker restart until the tab is explicitly cleared', async () => {
  const api = loadApi();
  const storage = storageFixture();
  const first = api.createGuard({
    sessionStorage: storage,
    randomValues: random(2),
    now: () => 2000,
  });
  await first.begin(owner);

  const restarted = api.createGuard({
    sessionStorage: storage,
    randomValues: random(3),
    now: () => 3000,
  });
  await assert.rejects(
    restarted.assertCurrent(owner),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED'
      && error.outcome === 'UNKNOWN_OUTCOME',
  );
  await assert.rejects(
    restarted.begin(owner),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED',
  );
  assert.deepEqual({ ...(await restarted.acknowledge({
    ...owner,
    tabId: 84,
    documentId: 'new-workbench-document',
  }, {
    warningVersion: 'external-provider-charge/v1',
    confirmed: true,
  })) }, { clearedCount: 1 });
  assert.deepEqual({ ...(await restarted.begin(owner)) }, { state: 'CURRENT', created: true });
});

test('document replacement cannot inherit or erase another document epoch', async () => {
  const api = loadApi();
  const storage = storageFixture();
  const guard = api.createGuard({
    sessionStorage: storage,
    randomValues: random(4),
    now: () => 4000,
  });
  await guard.begin(owner);
  const replacement = { ...owner, documentId: 'document-reloaded' };
  await assert.rejects(
    guard.assertCurrent(replacement),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED',
  );
  assert.equal(await guard.clear(replacement), false);
  assert.equal(await guard.clearByTab(owner.tabId), true);
  assert.deepEqual({ ...(await guard.assertCurrent(replacement)) }, { state: 'EMPTY' });
});

test('closing and reopening another tab cannot bypass an unresolved context marker', async () => {
  const api = loadApi();
  const storage = storageFixture();
  const first = api.createGuard({
    sessionStorage: storage,
    randomValues: random(6),
    now: () => 6000,
  });
  await first.begin(owner);
  const reopened = {
    ...owner,
    tabId: 99,
    documentId: 'document-reopened',
  };
  await assert.rejects(
    first.begin(reopened),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_WORKER_RESTARTED',
  );
  await assert.rejects(
    first.acknowledge(reopened, {
      warningVersion: 'external-provider-charge/v1', confirmed: false,
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );
  assert.deepEqual({ ...(await first.acknowledge(reopened, {
    warningVersion: 'external-provider-charge/v1', confirmed: true,
  })) }, { clearedCount: 1 });
  assert.deepEqual({ ...(await first.begin(reopened)) }, { state: 'CURRENT', created: true });
});

test('invalid persisted state remains fail closed', async () => {
  const api = loadApi();
  const storage = storageFixture();
  storage.values[api.STORAGE_KEY] = { '42': { forged: true } };
  const guard = api.createGuard({
    sessionStorage: storage,
    randomValues: random(5),
    now: () => 5000,
  });
  await assert.rejects(
    guard.assertCurrent(owner),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_EPOCH_STATE_INVALID',
  );
  await guard.clearAll();
  assert.equal(storage.values[api.STORAGE_KEY], undefined);
});
