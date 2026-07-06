import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const listingRoute = fs.readFileSync('apps/server/src/routes/listing.ts', 'utf8');

test('listing routes retain a direct Ozon import-by-sku endpoint for backend SKU follow workflows', () => {
  assert.match(listingRoute, /app\.post\('\/ozon\/import-by-sku'/);
  assert.match(listingRoute, /directOzonImportBySkuSchema/);
  assert.match(listingRoute, /client\.importBySku\(/);
  assert.match(listingRoute, /PRODUCT_PUSH/);
  assert.match(listingRoute, /backend-sku-follow/);
  assert.match(listingRoute, /enqueueProductSyncAfterPublish\(shopId,\s*'backend-sku-follow'\)/);
  assert.doesNotMatch(listingRoute, /extension-workbench-direct/);

  const routeBody = listingRoute.match(/app\.post\('\/ozon\/import-by-sku'[\s\S]*?\n  \}\);/);
  assert.ok(routeBody, 'direct import-by-sku route body should be present');
  assert.doesNotMatch(routeBody[0], /prisma\.supplyGoods\.create/);
  assert.doesNotMatch(routeBody[0], /\/api\/collect\/publish-ozon/);
});

test('direct Ozon import-by-sku route stores workbench KPI context in sync job metadata', () => {
  const schemaBody = listingRoute.match(/const directOzonImportBySkuSchema[\s\S]*?\r?\n}\);\r?\n/);
  assert.ok(schemaBody, 'direct import schema should be present');
  for (const field of [
    'brand',
    'categoryPath',
    'salesSchema',
    'weightGrams',
    'commissionRate',
    'logisticsFeeCny',
    'costCny',
    'profitMarginPct',
    'soldCount',
    'soldSum',
    'returnCancelRate',
    'sellerCount',
    'sellerNames',
    'ozonMetrics',
  ]) {
    assert.match(schemaBody[0], new RegExp(`${field}:`), `direct import schema should accept ${field}`);
  }

  const routeBody = listingRoute.match(/app\.post\('\/ozon\/import-by-sku'[\s\S]*?\n  \}\);/);
  assert.ok(routeBody, 'direct import route body should be present');
  for (const field of [
    'brand',
    'categoryPath',
    'salesSchema',
    'weightGrams',
    'commissionRate',
    'logisticsFeeCny',
    'costCny',
    'profitMarginPct',
    'soldCount',
    'soldSum',
    'returnCancelRate',
    'sellerCount',
    'sellerNames',
    'ozonMetrics',
  ]) {
    assert.match(routeBody[0], new RegExp(`${field}:\\s*item\\.${field}`), `sync job inputItems should persist ${field}`);
  }
});
