import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const root = 'extensions/ss-erp';
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const flush = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const nodes = [], frameMessages = [], runtimeRequests = [], listeners = new Map();
  const pendingStatus = [], pendingBilling = [], pendingMutation = [];
  const handoff = { snapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture',
    sourceProductId: '845581683597', platform: '1688' };
  let listing = { id: 'draft-fixture', shopId: 'doth', stage: 'MEDIA_REVIEW', status: 'ACTIVE',
    runState: 'ACTIVE', revision: 2, draftVersion: 2, selectedSkuCount: 1, mediaAssignmentCount: 0,
    blockers: [], warnings: [], updatedAt: '2026-10-04T00:00:00.000Z' };
  let delayStatus = false, delayBilling = false, delayMutation = false, captureError = null;
  const statusResponse = () => ({ ok: true, handoff: structuredClone(handoff),
    result: { state: 'ready', status: { snapshot: { current: true },
      listing: { items: [structuredClone(listing)], truncated: false },
      media: { items: [], actionableCount: 0 } } } });
  const billingResponse = (reviewStatus = 'REJECTED') => ({ ok: true, result: { state: 'ready', projection: {
    contractVersion: 'extension-ai-image-suite-projection/v1', context: {
      ...handoff, shopId: listing.shopId, listingWorkflowId: listing.id,
      draftRevision: listing.revision, draftVersion: listing.draftVersion,
    }, plan: { preview: { currency: 'CNY', itemCount: 2, estimatedCostCents: 28, maximumCostCents: 28 } },
    suite: { status: 'SUCCEEDED', slots: [{ slotKey: 'sku:sku-white:hero', goal: '商品主图',
      status: 'SUCCEEDED', workflowId: 'media-fixture', reviewStatus, output: { id: 'output-fixture' },
      billing: { mode: 'ERP_HOSTED', currency: 'CNY', estimatedCostMinor: 14, maximumCostMinor: 14,
        reservationStatus: 'SETTLED', settlement: { kind: 'RECONCILED_CHARGE', actualCostMinor: 14, billedUnits: 1 } },
    }] },
  } } });
  function node() {
    const handlers = new Map();
    const item = { style: { removeProperty() {} }, hidden: false,
      contentWindow: { postMessage(message) { frameMessages.push(JSON.parse(JSON.stringify(message))); } },
      setAttribute() {}, appendChild() {}, remove() {},
      addEventListener(type, listener) { handlers.set(type, listener); },
      click() { handlers.get('click')?.({ target: item }); } };
    nodes.push(item); return item;
  }
  const environment = { URL, console,
    location: { href: `https://detail.1688.com/offer/${handoff.sourceProductId}.html`, hostname: 'detail.1688.com' },
    document: { documentElement: node(), createElement: node, addEventListener() {},
      getElementById(id) { return nodes.find(item => item.id === id); } },
    chrome: { runtime: { id: extensionId,
      getURL(path) { return `chrome-extension://${extensionId}/${path.replace(/^\//u, '')}`; },
      getManifest() { return { version: '1.0.412' }; }, onMessage: { addListener() {} },
      sendMessage(request, callback) {
        runtimeRequests.push(JSON.parse(JSON.stringify(request)));
        if (request.type === 'spb-self-hosted:get-ozon-shops') callback({ ok: true, data: [{ id: 'doth', name: 'DOTH', status: 'ACTIVE' }] });
        else if (request.type === 'ss-erp:source-listing-workbench-status') {
          if (delayStatus) pendingStatus.push(callback); else callback(statusResponse());
        } else if (request.type === 'ss-erp:source-listing-workbench-ai-image-suite') {
          if (delayBilling) pendingBilling.push(callback); else callback(billingResponse());
        } else if (request.type === 'ss-erp:source-listing-workbench-media-history') callback({ ok: true, result: {
          state: 'ready', history: { context: { ...handoff, shopId: listing.shopId,
            listingWorkflowId: listing.id, revision: listing.revision, draftVersion: listing.draftVersion },
          items: [], nextCursor: null },
        } });
        else if (request.type === 'ss-erp:source-listing-workbench-ai-image-suite-command'
          || request.type === 'ss-erp:source-listing-workbench-ai-image-suite-assignment') {
          if (delayMutation) pendingMutation.push(callback);
          else callback({ ok: true, result: { state: 'completed', action: request.action, replay: false } });
        } else throw new Error(`unexpected fixture request ${request.type}`);
      },
    } },
    SS_ERP_DONOR_1688_CAPTURE: { async collect() { if (captureError) throw captureError;
      return { productId: handoff.sourceProductId, title: '测试商品',
      captureV2: { skus: [{ key: 'sku-white', name: '白色 / S' }] } }; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    setTimeout() { return 1; }, clearTimeout() {},
  };
  environment.globalThis = environment;
  const context = vm.createContext(environment);
  vm.runInContext(readFileSync(`${root}/shared/donor-workbench/workspace-contract.js`, 'utf8'), context);
  vm.runInContext(readFileSync(`${root}/content/donor-workbench-bridge.js`, 'utf8'), context);
  const frame = nodes.find(item => item.id === 'ss-erp-donor-workbench-frame');
  nodes.find(item => item.id === 'ss-erp-donor-workbench-trigger').click();
  await flush();
  const command = (type, requestId, fields = {}) => listeners.get('message')({ source: frame.contentWindow,
    origin: new URL(frame.src).origin, data: { contractVersion: 'ss-erp-donor-workbench/v1',
      type, requestId, ...fields } });
  const review = (requestId = 'review-fixture') => command('EXECUTE_HOSTED_SUITE', requestId, {
    listingWorkflowId: listing.id, action: 'REVIEW_SLOT', slotKey: 'sku:sku-white:hero',
    decision: 'REJECT', costConfirmed: false,
  });
  return { frameMessages, runtimeRequests, pendingStatus, pendingBilling, pendingMutation, handoff,
    statusResponse, billingResponse, command, review,
    delay({ status = false, billing = false, mutation = false } = {}) {
      delayStatus = status; delayBilling = billing; delayMutation = mutation;
    },
    updateListing(value) { listing = { ...listing, ...value }; },
    failCapture(error) { captureError = error; },
    results(requestId) { return frameMessages.filter(item => item.type === 'COMMAND_RESULT' && item.requestId === requestId); },
    projection() { return frameMessages.filter(item => item.type === 'PROJECTION').at(-1)?.projection; },
  };
}

test('a confirmed slot review is acknowledged before a slow authority refresh', async () => {
  const h = await harness();
  h.delay({ status: true, billing: true });
  h.review(); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true],
    'read-only refresh latency must not turn a committed review into UNKNOWN_OUTCOME');
  assert.equal(h.pendingStatus.length, 1);
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.pendingBilling.length, 1);
  h.pendingBilling.shift()(h.billingResponse()); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().billing.suite.slots[0].media.reviewStatus, 'REJECTED');
});

test('readback failure stays visible without rewriting a successful mutation receipt', async () => {
  const h = await harness(); h.delay({ billing: true });
  h.review(); await flush();
  h.pendingBilling.shift()({ ok: false, error: 'AUTHORITY_READ_TEMPORARILY_UNAVAILABLE' }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().billing.state, 'error');
  assert.equal(h.projection().billing.error, 'AUTHORITY_READ_TEMPORARILY_UNAVAILABLE');
  assert.equal(h.projection().busy, false);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('suite-command')).length, 1);
});

test('a failed source refresh preserves its read error and the verified review receipt', async () => {
  const h = await harness(); h.failCapture(new Error('SOURCE_READ_TEMPORARILY_UNAVAILABLE'));
  h.review(); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().error, 'SOURCE_READ_TEMPORARILY_UNAVAILABLE');
  assert.equal(h.projection().busy, false);
});

test('a caller read joins the post-assignment refresh and observes the new draft version', async () => {
  const h = await harness(); h.delay({ status: true, billing: true });
  h.command('ASSIGN_HOSTED_SUITE', 'assign-fixture', { listingWorkflowId: 'draft-fixture' }); await flush();
  assert.deepEqual(h.results('assign-fixture').map(item => item.ok), [true]);
  h.command('LOAD_BILLING', 'billing-fixture', { listingWorkflowId: 'draft-fixture' }); await flush();
  assert.equal(h.pendingBilling.length, 0, 'do not read against the pre-assignment draft revision');
  h.updateListing({ revision: 3, draftVersion: 3, mediaAssignmentCount: 2 });
  h.pendingStatus.shift()(h.statusResponse()); await flush();
  assert.equal(h.pendingBilling.length, 1);
  h.pendingBilling.shift()(h.billingResponse('APPROVED')); await flush();
  assert.deepEqual(h.results('billing-fixture').map(item => item.ok), [true]);
  assert.equal(h.projection().workbench.status.listing.items[0].draftVersion, 3);
  assert.equal(h.projection().billing.state, 'ready');
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('ai-image-suite')).length, 1,
    'the caller reuses the just-completed bound readback');
});

test('a failed or unresolved mutation never becomes successful due to a later state read', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review(); await flush();
  h.pendingMutation.shift()({ ok: false, error: 'MUTATION_UNRESOLVED', outcome: 'UNKNOWN_OUTCOME' }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [false]);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('ai-image-suite')).length, 0);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('workbench-status')).length, 1);
});

test('an incomplete mutation response is not acknowledged as a completed review', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review(); await flush();
  h.pendingMutation.shift()({ ok: true, result: { state: 'unavailable' } }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [false]);
  assert.equal(h.runtimeRequests.filter(item => item.type.endsWith('ai-image-suite')).length, 0);
});

test('late mutation completion does not refresh a different source snapshot', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review(); await flush();
  h.handoff.snapshotId = 'new-snapshot';
  h.command('REFRESH', 'new-snapshot-refresh'); await flush();
  const before = h.runtimeRequests.length;
  h.pendingMutation.shift()({ ok: true, result: { state: 'completed', action: 'REVIEW_SLOT', replay: false } }); await flush();
  assert.deepEqual(h.results('review-fixture').map(item => item.ok), [true]);
  assert.equal(h.runtimeRequests.length, before, 'do not refresh or overwrite the successor snapshot with old mutation state');
  assert.equal(h.projection().handoff.snapshotId, 'new-snapshot');
});

test('the bridge does not dispatch a second mutation while the first is in flight', async () => {
  const h = await harness(); h.delay({ mutation: true });
  h.review('first-review'); h.review('second-review'); await flush();
  assert.equal(h.pendingMutation.length, 1);
  assert.deepEqual(h.results('second-review').map(item => item.ok), [false]);
  h.pendingMutation.shift()({ ok: true, result: { state: 'completed', action: 'REVIEW_SLOT', replay: false } }); await flush();
});
