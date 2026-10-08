import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const context = { URL, console };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/workspace-contract.js', 'utf8'), context);
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/donor-workbench/precision-workflow.js', 'utf8'), context);
const api = context.SS_ERP_PRECISION_WORKFLOW;
const contract = context.SS_ERP_DONOR_WORKBENCH_CONTRACT;
const copy = (value) => JSON.parse(JSON.stringify(value));
function product() {
  return {
    productId: '845581683597', title: '长袖上衣',
    captureV2: {
      sourceIdentity: { productId: '845581683597', canonicalUrl: 'https://detail.1688.com/offer/845581683597.html' },
      sourceCategory: { name: '女式上衣', path: [] },
      skus: Array.from({ length: 16 }, (_, index) => ({
        key: `sku-${index}`, specText: `颜色 ${index} / M`, sourceSkuId: `${5795435287061 + index}`,
        priceCny: 11.5, stock: index === 0 ? 0 : 999,
        mediaKeys: [`sku-image-${index}`],
      })),
      media: Array.from({ length: 16 }, (_, index) => ({
        key: `sku-image-${index}`, role: 'sku', disposition: 'accepted',
        url: `https://cbu01.alicdn.com/img/${index}.jpg`, skuKeys: [`sku-${index}`],
      })),
    },
  };
}
function fixture() {
  let projection = contract.createProjection({ platform: '1688', product: product(), shops: [{ id: 'doth', name: 'DOTH' }, { id: 'bini', name: 'BINI' }] });
  const commands = [];
  const session = api.createSession({
    getProjection: () => projection,
    send: async (type, fields) => {
      commands.push({ type, ...fields });
      if (type === 'COLLECT') projection = contract.createProjection({
        ...projection, product: product(), platform: '1688',
        handoff: { snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1', sourceProductId: '845581683597', platform: '1688' },
      });
      if (type === 'CREATE_DRAFT') projection = contract.createProjection({
        ...projection, product: product(), platform: '1688',
        workbench: { state: 'ready', status: { snapshot: { current: true }, listing: { items: [{
          id: 'draft-1', shopId: fields.shopId, stage: 'CATEGORY_REVIEW', status: 'ACTIVE', runState: 'ACTIVE',
          revision: 1, draftVersion: 1, selectedSkuCount: fields.selectedSkuKeys.length, mediaAssignmentCount: 0,
          blockerCount: 0, warningCount: 0, blockers: [], warnings: [], updatedAt: '2026-09-30T08:00:00Z',
        }] }, media: { items: [] } } },
      });
      return { ok: true };
    },
  });
  return { session, commands, getProjection: () => projection, setProjection: (next) => { projection = next; } };
}

test('canonical SKU images, price, zero stock and identities survive the iframe projection', () => {
  const projection = contract.parseProjection(contract.createProjection({ platform: '1688', product: product() }));
  const raw = api.toDonorData(projection);
  assert.equal(raw.sku_matrix.length, 16);
  assert.equal(raw.sku_matrix[0].row_id, 'sku-0');
  assert.equal(raw.sku_matrix[0].sku_image_url, 'https://cbu01.alicdn.com/img/0.jpg');
  assert.equal(raw.sku_matrix[0].price.amount, 11.5);
  assert.equal(raw.sku_matrix[0].stock, 0);
  assert.equal(raw.sku_matrix[0].source_sku_id, '5795435287061');
});

test('collector fallback reads all skuItems and source image arrays without fabricating a product SKU', () => {
  const projection = contract.createProjection({ platform: '1688', product: {
    productId: '845581683597', skuItems: [{ skuId: 'native-1', specText: '白色 / M', price: 11.5, stock: 0, images: ['https://cbu01.alicdn.com/white.jpg'] }],
    sourceMainImages: ['https://cbu01.alicdn.com/main.jpg'], sourceDetailImages: ['https://cbu01.alicdn.com/detail.jpg'],
  } });
  assert.equal(projection.skus[0].key, 'native-1');
  assert.equal(projection.media.length, 2);
});

test('legacy draft SKU keys resolve to the current capture row while preserving the draft key', () => {
  const skus = [
    { key: 'sku:6261116830598|规格=中号塑料收纳盒|中号塑料收纳盒', sourceSkuId: '6261116830598', label: '中号塑料收纳盒' },
    { key: 'sku:6261116830599|规格=大号塑料收纳盒|大号塑料收纳盒', sourceSkuId: '6261116830599', label: '大号塑料收纳盒' },
  ];
  assert.equal(api.resolveProjectionSkuForDraftKey(skus, skus[0].key), skus[0]);
  assert.equal(api.resolveProjectionSkuForDraftKey(skus, 'sku:6261116830598|中号塑料收纳盒').key, skus[0].key);
  assert.equal(api.resolveProjectionSkuForDraftKey(skus, '6261116830598').key, skus[0].key);
  assert.equal(api.resolveProjectionSkuForDraftKey(skus, 'sku:missing|未知'), null);
});

test('start selects SKUs, collects and creates an exact shop draft in one session', async () => {
  const run = fixture();
  const draft = await run.session.start({ shopId: 'doth', selectSkus: async (raw) => ({ ...raw, sku_matrix: [raw.sku_matrix[1], raw.sku_matrix[7]] }) });
  assert.equal(draft.id, 'draft-1');
  assert.deepEqual(copy(run.commands).map((command) => command.type), ['REFRESH', 'COLLECT', 'CREATE_DRAFT']);
  assert.deepEqual(copy(run.commands[2]), { type: 'CREATE_DRAFT', shopId: 'doth', selectedSkuKeys: ['sku-1', 'sku-7'] });
});

test('cancelled SKU selection performs no ERP mutation', async () => {
  const run = fixture();
  assert.equal(await run.session.start({ shopId: 'doth', selectSkus: async () => null }), null);
  assert.deepEqual(copy(run.commands).map((command) => command.type), ['REFRESH']);
});

test('a changed source while the picker is open fails before collection', async () => {
  const run = fixture();
  await assert.rejects(run.session.start({ shopId: 'doth', selectSkus: async (raw) => {
    run.setProjection(contract.createProjection({ platform: '1688', product: { productId: 'other' }, shops: [{ id: 'doth', name: 'DOTH' }] }));
    return raw;
  } }), /商品已变化/);
  assert.equal(run.commands.length, 1);
});

test('a readback with another shop never substitutes that draft', () => {
  const projection = { workbench: { status: { listing: { items: [{ id: 'other', shopId: 'bini' }] } } } };
  assert.equal(api.listingForShop(projection, 'doth'), null);
});

test('lost mutation result is not retried and requires recovery before another start', async () => {
  const run = fixture();
  let dispatched = 0;
  const session = api.createSession({ getProjection: run.getProjection, send: async (type) => {
    if (type === 'COLLECT') { dispatched += 1; throw Object.assign(new Error('响应超时'), { outcome: 'UNKNOWN_OUTCOME' }); }
    return { ok: true };
  } });
  const input = { shopId: 'doth', selectSkus: async (raw) => raw };
  await assert.rejects(session.start(input), /响应超时/);
  await assert.rejects(session.start(input), /核对/);
  assert.equal(dispatched, 1);
});

test('a concurrent start cannot create a second collection or draft', async () => {
  const run = fixture();
  let release;
  const pending = run.session.start({ shopId: 'doth', selectSkus: (raw) => new Promise((resolve) => { release = () => resolve(raw); }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(run.session.start({ shopId: 'doth', selectSkus: async (raw) => raw }), /正在执行/);
  release();
  await pending;
  assert.equal(run.commands.filter((command) => command.type === 'CREATE_DRAFT').length, 1);
});

function pinnedFixture() {
  const run = fixture();
  const source = run.getProjection();
  const context = { contractVersion: 'extension-byok-workbench-launch-context/v1', sourcePlatform: '1688',
    sourceProductId: source.source.sourceProductId, sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'doth', workflowId: 'erp-selected-draft', draftRevision: 3, draftVersion: 2, skuKey: 'sku-7',
    slotKey: 'sku:sku-7:hero', assignmentMode: 'APPEND', assignmentOrdinal: 0 };
  const drafts = ['first-same-shop', context.workflowId].map(id => ({ id, shopId: 'doth', revision: 3,
    draftVersion: 2, selectedSkuCount: 1, mediaAssignmentCount: 0, stage: 'MEDIA_REVIEW', runState: 'ACTIVE' }));
  run.setProjection(contract.createProjection({ platform: '1688', product: product(), shops: source.shops,
    handoff: { platform: '1688', sourceProductId: source.source.sourceProductId, snapshotId: 'snapshot-1', supplyGoodsId: 'goods-1' },
    workbench: { state: 'ready', status: { snapshot: { current: true }, listing: { items: drafts }, media: { items: [] } } } }));
  return { ...run, context };
}

test('ERP entry selects the exact workflow when a shop has several drafts', () => {
  const run = pinnedFixture();
  assert.equal(run.session.pinDraft(run.context).id, run.context.workflowId);
  assert.equal(run.session.currentDraft('doth').id, run.context.workflowId);
});

test('a missing pinned ERP draft never substitutes another draft or creates a replacement', async () => {
  const run = pinnedFixture();
  run.session.pinDraft(run.context);
  const next = copy(run.getProjection());
  next.workbench.status.listing.items = next.workbench.status.listing.items.slice(0, 1);
  run.setProjection(next);
  assert.equal(run.session.currentDraft('doth'), null);
  await assert.rejects(run.session.start({ shopId: 'doth', selectSkus: async () => { throw Error('must not choose new SKUs'); } }), /草稿/);
  assert.deepEqual(run.commands.map(item => item.type), ['REFRESH']);
});

test('a pinned ERP draft survives fresh projections and its own saved revision advances', () => {
  const run = pinnedFixture();
  run.session.pinDraft(run.context);
  const next = copy(run.getProjection());
  next.workbench.status.listing.items.reverse();
  next.workbench.status.listing.items[0].revision += 1;
  next.workbench.status.listing.items[0].draftVersion += 1;
  run.setProjection(next);
  assert.equal(run.session.currentDraft('doth').id, run.context.workflowId);
  assert.equal(run.session.currentDraft('doth').revision, 4);
});

test('pinning rejects wrong source, snapshot, shop and draft version without selecting the first draft', () => {
  for (const change of [value => { value.sourceProductId = 'other'; }, value => { value.sourceCaptureSnapshotId = 'other'; },
    value => { value.shopId = 'bini'; }, value => { value.draftRevision++; }, value => { value.draftVersion++; }]) {
    const run = pinnedFixture(), context = copy(run.context);
    change(context);
    assert.throws(() => run.session.pinDraft(context), /草稿|来源|快照/);
    assert.equal(run.session.currentDraft(context.shopId), null);
  }
});

test('changing the pinned source snapshot or revoking its shop blocks readback until a new entry', () => {
  for (const change of [next => { next.handoff.snapshotId = 'new-snapshot'; }, next => { next.source.sourceProductId = 'other'; },
    next => { next.shops = []; }, next => { next.workbench.status.snapshot.current = false; }]) {
    const run = pinnedFixture();
    run.session.pinDraft(run.context);
    const next = copy(run.getProjection()); change(next); run.setProjection(next);
    assert.equal(run.session.currentDraft('doth'), null);
  }
});
