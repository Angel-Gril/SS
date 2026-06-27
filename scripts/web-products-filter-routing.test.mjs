import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('apps/web/src/app/(dashboard)/products/page.tsx', 'utf8');

assert.match(source, /priceMin/i, 'products page should keep a minimum price filter');
assert.match(source, /priceMax/i, 'products page should keep a maximum price filter');
assert.match(source, /weightMin/i, 'products page should keep a minimum weight filter');
assert.match(source, /weightMax/i, 'products page should keep a maximum weight filter');
assert.match(source, /stockMin/i, 'products page should keep a minimum stock filter');
assert.match(source, /stockMax/i, 'products page should keep a maximum stock filter');
assert.match(source, /warehouseStockMode/i, 'products page should keep an explicit warehouse stock mode');

for (const param of ['priceMin', 'priceMax', 'weightMin', 'weightMax', 'stockMin', 'stockMax', 'warehouseStockMode']) {
  assert.match(source, new RegExp(`params\\.set\\('${param}'`), `products page should send ${param} to the product list API`);
}

assert.match(
  source,
  /defaultWarehouseId=\{selectedWarehouseId\}/,
  'batch stock dialog should default to the currently selected warehouse',
);

assert.match(
  source,
  /value="out_of_stock"/,
  'products page should support filtering products with no stock in the selected warehouse',
);

console.log('PASS web products filter routing');
