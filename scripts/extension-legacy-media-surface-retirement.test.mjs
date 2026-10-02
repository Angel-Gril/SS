import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const collectContent = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const listOverlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

test('Ozon product collector keeps read-only data transport without legacy workbench entrypoints', () => {
  assert.match(
    collectContent,
    /message\.type !== ["']spb-self-hosted:collect-product["']/u,
    'the shared collector listener remains available to the precision workbench',
  );
  assert.match(collectContent, /collectCurrentPage\(\)/u);
  for (const marker of [
    'ss-erp-ozon-workbench-modal',
    'quick-open-workbench',
    'quick-open-erp',
    'showOzonSkuWorkbench',
    'publish-ozon-workbench-rows',
    '一键上架选中商品',
  ]) {
    assert.doesNotMatch(collectContent, new RegExp(marker, 'u'), `collector must not expose ${marker}`);
  }
  assert.match(collectContent, /quick-profit/u, 'profit shortcut remains available');
  assert.match(collectContent, /quick-bind-cookie/u, 'seller cookie maintenance remains available');
});

test('Ozon list overlay keeps analytics and selection tools without legacy collect/publish UI', () => {
  for (const marker of [
    'ss-erp-list-sku-workbench-modal',
    'quick-open-workbench',
    'quick-open-erp',
    'openListSkuWorkbench',
    'ss-erp-collect-btn',
    'ss-erp-publish-btn',
    'publish-ozon-workbench-rows',
    '一键上架选中商品',
  ]) {
    assert.doesNotMatch(listOverlay, new RegExp(marker, 'u'), `list overlay must not expose ${marker}`);
  }
  assert.match(listOverlay, /quick-profit/u, 'profit shortcut remains available');
  assert.match(listOverlay, /quick-selection-settings/u, 'selection settings remain available');
  assert.match(listOverlay, /quick-auto-scroll/u, 'analytics list scanning remains available');
  assert.match(listOverlay, /fetchPublicProduct/u, 'public product analytics transport remains available');
});
