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
