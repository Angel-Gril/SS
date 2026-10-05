import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const load = () => {
  const context = {};
  vm.runInNewContext(
    readFileSync('extensions/ss-erp/shared/donor-workbench/precision-preparation-flow.js', 'utf8'),
    context,
  );
  return context.SS_ERP_PRECISION_PREPARATION_FLOW;
};
test('changing the current shop while a step waits never records preparation for the wrong shop', async () => {
  const api=load(); let currentShop='a',release,next=0;
  const flow=api.create({getSource:()=> 'source',getCurrentShop:()=>currentShop,selectShop:async shop=>{currentShop=shop;},
    steps:[{id:'first',run:()=>new Promise(resolve=>release=resolve)},{id:'second',run:async()=>{next++;return{completed:true};}}]});
  const pending=flow.start(['a']); await new Promise(resolve=>setImmediate(resolve)); currentShop='b'; release({completed:true}); await pending;
  assert.equal(flow.state().status,'CONTEXT_CHANGED'); assert.equal(next,0); assert.deepEqual([...flow.state().completedShopIds],[]);
});

test('preparation continues in one workbench, pauses for current input and resumes at the same shop', async () => {
  const api = load(),
    called = [];
  let categoryReady = false;
  const flow = api.create({
    getSource: () => 'source-1',
    selectShop: async (shop) => called.push('shop:' + shop),
    steps: [
      {
        id: 'draft',
        run: async () => {
          called.push('draft');
          return { completed: true };
        },
      },
      {
        id: 'category',
        run: async () => {
          called.push('category');
          return { completed: categoryReady, message: '选择当前官方类目' };
        },
      },
      {
        id: 'pricing',
        run: async () => {
          called.push('pricing');
          return { completed: true };
        },
      },
    ],
  });
  const first = await flow.start(['doth', 'bini']);
  assert.equal(first.status, 'WAITING_INPUT');
  assert.equal(first.stepId, 'category');
  assert.equal(first.shopId, 'doth');
  assert.equal(called.includes('pricing'), false);
  categoryReady = true;
  await flow.continue();
  assert.equal(flow.state().status, 'COMPLETE');
  assert.deepEqual([...flow.state().completedShopIds], ['doth', 'bini']);
});

test('an unresolved write blocks the rest of the queue and is never automatically retried', async () => {
  const api = load();
  let attempts = 0;
  const flow = api.create({
    getSource: () => 'source-1',
    selectShop: async () => {},
    steps: [
      {
        id: 'copy',
        run: async () => {
          attempts++;
          throw Object.assign(new Error('核对原文案请求'), { outcome: 'UNKNOWN_OUTCOME' });
        },
      },
    ],
  });
  const first = await flow.start(['doth', 'bini']);
  assert.equal(first.status, 'RECOVERY_REQUIRED');
  assert.equal(attempts, 1);
  await assert.rejects(flow.continue(), /核对/);
  assert.equal(attempts, 1);
  flow.markRecovered();
  await flow.continue();
  assert.equal(attempts, 2, 'only explicit confirmed recovery resumes caller-owned step');
});

test('source changes and cancel stop later steps without treating an in-flight command as canceled', async () => {
  const api = load();
  let source = 'a',
    nextCalls = 0,
    release;
  const flow = api.create({
    getSource: () => source,
    selectShop: async () => {},
    steps: [
      { id: 'first', run: () => new Promise((r) => (release = r)) },
      {
        id: 'second',
        run: async () => {
          nextCalls++;
          return { completed: true };
        },
      },
    ],
  });
  const pending = flow.start(['doth']);
  await new Promise((resolve) => setImmediate(resolve));
  source = 'b';
  release({ completed: true });
  await pending;
  assert.equal(flow.state().status, 'CONTEXT_CHANGED');
  assert.equal(nextCalls, 0);
  source = 'a';
  const another = flow.start(['doth']);
  await new Promise((resolve) => setImmediate(resolve));
  flow.cancel();
  release({ completed: true });
  await another;
  assert.equal(flow.state().status, 'STOPPED');
  assert.equal(nextCalls, 0);
});
test('multi-shop continuation never calls later shops while the first shop requires review', async () => {
  const api = load(),
    shops = [];
  let accepted = false;
  const flow = api.create({
    getSource: () => 'source',
    selectShop: async (shop) => shops.push(shop),
    steps: [{ id: 'review', run: async () => ({ completed: accepted }) }],
  });
  await flow.start(['doth', 'bini']);
  assert.deepEqual(shops, ['doth']);
  accepted = true;
  await flow.continue();
  assert.deepEqual(shops, ['doth', 'doth', 'bini']);
  assert.equal(flow.state().status, 'COMPLETE');
});
