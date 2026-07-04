import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const productRoute = readFileSync('apps/server/src/routes/product.ts', 'utf8');
const productWorker = readFileSync('apps/server/src/workers/product-sync.ts', 'utf8');
const metadata = readFileSync('apps/server/src/services/product-sync-metadata.ts', 'utf8');

assert.match(metadata, /resolveOzonPriceIndexSnapshot/, 'metadata helpers should parse Ozon price index snapshots');
assert.match(metadata, /getOzonPriceIndexSnapshot/, 'metadata helpers should read stored Ozon price snapshots');
assert.match(metadata, /ozonPriceIndexFilter/, 'computed product filters should support Ozon price index filtering');

for (const [name, source] of [
  ['sync commissions route', productRoute],
  ['product sync worker', productWorker],
]) {
  assert.match(source, /mergeProductOzonPriceMeta/, `${name} should merge Ozon price index data into product metadata`);
  assert.match(source, /variants:\s*mergeProductOzonPriceMeta\(product\.variants,\s*item\)/, `${name} should persist Ozon price metadata to product variants`);
}

console.log('PASS server products Ozon price index');
