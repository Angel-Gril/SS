import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('extensions/ss-erp/pages/donor/category-picker.js', 'utf8');
const { createCategoryPicker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const initialBinding = { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', shopId: 'shop-1',
  listingWorkflowId: 'draft-1', draftRevision: 1, draftVersion: 1 };
const catalog = (entries = [
  { categoryId: 10, typeId: 20, label: '服装 / 上衣' },
  { categoryId: 10, typeId: 21, label: '服装 / 衬衫' },
], extra = {}) => ({ catalogRevision: 'catalog-fixture', entries, truncated: false, ...extra });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(loader = async () => catalog()) {
  let binding = { ...initialBinding };
  const calls = [], changes = [];
  const picker = createCategoryPicker({ getBinding: () => binding,
    loadCatalog: (current, query) => { calls.push({ binding: structuredClone(current), query }); return loader(current, query); },
    onState: value => changes.push(value) });
  return { picker, calls, changes, setBinding: value => { binding = value; } };
}

test('search exposes loading then requires explicit selection instead of choosing the first result', async () => {
  const request = deferred(), f = harness(() => request.promise);
  const search = f.picker.search('  上衣  ');
  assert.equal(f.picker.state().status, 'loading');
  assert.equal(f.picker.state().canSave, false);
  assert.match(f.picker.state().message, /正在|读取|搜索/);
  request.resolve(catalog()); await search;
  assert.equal(f.picker.state().status, 'ready');
  assert.equal(f.picker.state().selected, null);
  assert.equal(f.picker.selection(), null);
  assert.equal(f.picker.state().canSave, false);
  assert.equal(f.picker.state().query, '  上衣  ');
  assert.deepEqual(f.calls[0], { binding: initialBinding, query: '上衣' });
});
test('selection requires the exact visible category/type pair and carries the loaded catalog revision', async () => {
  const f = harness(); await f.picker.search('服装');
  f.picker.select({ categoryId: 10, typeId: 21 });
  assert.deepEqual(f.picker.selection(), { categoryId: 10, typeId: 21, catalogRevision: 'catalog-fixture' });
  f.picker.select({ categoryId: 10, typeId: 999 });
  assert.equal(f.picker.selection(), null);
  assert.equal(f.picker.state().canSave, false);
  f.picker.select({ categoryId: '10', typeId: 21 });
  assert.equal(f.picker.selection(), null);
});
test('a currently confirmed category may be explicitly selected only with its exact returned type', async () => {
  const f = harness(); await f.picker.search('服装');
  const currentCategory = { categoryId: 10, typeId: 20, catalogRevision: 'old-revision' };
  f.picker.select(currentCategory);
  assert.deepEqual(f.picker.selection(), { categoryId: 10, typeId: 20, catalogRevision: 'catalog-fixture' });
});
test('starting another search immediately retires the old selection', async () => {
  const request = deferred(); let index = 0;
  const f = harness(() => index++ ? request.promise : Promise.resolve(catalog()));
  await f.picker.search('上衣'); f.picker.select({ categoryId: 10, typeId: 20 });
  const running = f.picker.search('食品');
  assert.equal(f.picker.selection(), null);
  assert.equal(f.picker.state().selected, null);
  assert.deepEqual(f.picker.state().entries, []);
  request.resolve(catalog([{ categoryId: 11, typeId: 22, label: '食品 / 零食' }])); await running;
  assert.equal(f.picker.selection(), null);
});
test('overlapping searches keep the newest response and never restore an older selection', async () => {
  const old = deferred(), fresh = deferred(); let index = 0;
  const f = harness(() => index++ ? fresh.promise : old.promise);
  const first = f.picker.search('旧关键词'), second = f.picker.search('新关键词');
  fresh.resolve(catalog([{ categoryId: 30, typeId: 40, label: '新结果' }], { catalogRevision: 'new' }));
  await second; f.picker.select({ categoryId: 30, typeId: 40 });
  old.resolve(catalog()); await first;
  assert.deepEqual(f.picker.selection(), { categoryId: 30, typeId: 40, catalogRevision: 'new' });
  assert.equal(f.picker.state().query, '新关键词');
});
test('an old failed search cannot replace a newer ready result with an error', async () => {
  const old = deferred(); let index = 0;
  const f = harness(() => index++ ? Promise.resolve(catalog()) : old.promise);
  const first = f.picker.search('旧关键词'); await f.picker.search('新关键词');
  old.reject(new Error('旧请求失败')); await first;
  assert.equal(f.picker.state().status, 'ready');
  assert.equal(f.picker.state().query, '新关键词');
});
test('closing preserves the keyword and rejects a response from the previous open dialog', async () => {
  const request = deferred(), f = harness(() => request.promise);
  const running = f.picker.search('上衣'); f.picker.close();
  request.resolve(catalog()); await running;
  assert.equal(f.picker.state().open, false);
  assert.equal(f.picker.selection(), null);
  assert.deepEqual(f.picker.state().entries, []);
  assert.equal(f.picker.state().query, '上衣');
  f.picker.open();
  assert.equal(f.picker.state().open, true);
  assert.equal(f.picker.state().query, '上衣');
  assert.equal(f.picker.state().canSave, false);
});
test('close then reopen fences the earlier pending response even on the same draft', async () => {
  const request = deferred(), f = harness(() => request.promise);
  const running = f.picker.search('上衣'); f.picker.close(); f.picker.open();
  request.resolve(catalog()); await running;
  assert.equal(f.picker.state().open, true);
  assert.deepEqual(f.picker.state().entries, []);
  assert.equal(f.picker.state().canSave, false);
});
test('each draft binding dimension invalidates a pending response without authorizing save', async () => {
  for (const key of Object.keys(initialBinding)) {
    const request = deferred(), f = harness(() => request.promise);
    const running = f.picker.search('上衣');
    f.setBinding({ ...initialBinding, [key]: typeof initialBinding[key] === 'number' ? 2 : `${initialBinding[key]}-changed` });
    request.resolve(catalog()); await running;
    assert.equal(f.picker.state().status, 'stale', key);
    assert.equal(f.picker.selection(), null, key);
    assert.deepEqual(f.picker.state().entries, [], key);
    assert.match(f.picker.state().message, /草稿|店铺|变化|重新/, key);
  }
});
test('already selected entries become stale on read when the binding changes', async () => {
  const f = harness(); await f.picker.search('上衣'); f.picker.select({ categoryId: 10, typeId: 20 });
  f.setBinding({ ...initialBinding, draftRevision: 2 });
  assert.equal(f.picker.selection(), null);
  assert.equal(f.picker.state().canSave, false);
  assert.equal(f.picker.state().status, 'stale');
});
test('observed binding changes remain fenced when the user returns to the former binding', async () => {
  const request = deferred(), f = harness(() => request.promise);
  const running = f.picker.search('上衣');
  f.setBinding({ ...initialBinding, shopId: 'shop-2' }); f.picker.syncBinding();
  f.setBinding({ ...initialBinding }); f.picker.syncBinding();
  request.resolve(catalog()); await running;
  assert.equal(f.picker.selection(), null);
  assert.deepEqual(f.picker.state().entries, []);
});
test('empty, failed, and truncated results have distinct actionable messages', async () => {
  const empty = harness(async () => catalog([])); await empty.picker.search('未匹配');
  assert.equal(empty.picker.state().status, 'empty');
  assert.match(empty.picker.state().message, /未找到|无匹配/);
  assert.equal(empty.picker.state().canSave, false);
  const failed = harness(async () => { throw new Error('暂时无法连接'); }); await failed.picker.search('上衣');
  assert.equal(failed.picker.state().status, 'error');
  assert.match(failed.picker.state().message, /失败|重试|重新/);
  assert.equal(failed.picker.selection(), null);
  const truncated = harness(async () => catalog(undefined, { truncated: true })); await truncated.picker.search('服装');
  assert.equal(truncated.picker.state().truncated, true);
  assert.match(truncated.picker.state().message, /部分|缩小|更具体|前 50/);
  assert.equal(truncated.picker.selection(), null);
  truncated.picker.select({ categoryId: 10, typeId: 20 });
  assert.equal(truncated.picker.state().canSave, true);
});
test('a missing binding gives a visible prerequisite without invoking the catalog transport', async () => {
  const f = harness(); f.setBinding(null); await f.picker.search('上衣');
  assert.equal(f.calls.length, 0);
  assert.equal(f.picker.state().canSave, false);
  assert.match(f.picker.state().message, /草稿|店铺/);
});
test('catalog responses with malformed revision or pairs cannot be saved', async () => {
  for (const result of [
    { entries: [], truncated: false }, catalog([{ categoryId: 0, typeId: 20, label: '无效' }]),
    catalog([{ categoryId: 10, typeId: 20, label: '' }]), catalog([], { catalogRevision: '' }),
  ]) {
    const f = harness(async () => result); await f.picker.search('上衣');
    assert.equal(f.picker.state().status, 'error');
    assert.equal(f.picker.selection(), null);
  }
});
test('catalog and selection snapshots cannot be mutated through callback or returned state', async () => {
  const original = catalog(), f = harness(async () => original); await f.picker.search('上衣');
  f.picker.select({ categoryId: 10, typeId: 20 });
  original.entries[0].categoryId = 999;
  const published = f.picker.state();
  try { published.entries[0].categoryId = 888; } catch {}
  try { published.selected.typeId = 888; } catch {}
  assert.deepEqual(f.picker.selection(), { categoryId: 10, typeId: 20, catalogRevision: 'catalog-fixture' });
});
test('overlong query is retained for correction and never sent past the existing 100 character contract', async () => {
  const f = harness(); const query = '衣'.repeat(101); await f.picker.search(query);
  assert.equal(f.calls.length, 0);
  assert.equal(f.picker.state().query, query);
  assert.equal(f.picker.state().canSave, false);
  assert.match(f.picker.state().message, /100/);
});
