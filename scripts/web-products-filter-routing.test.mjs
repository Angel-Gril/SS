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
assert.match(source, /profitFilter/i, 'products page should keep a profitability filter');
assert.match(source, /pageSize/i, 'products page should keep a page size selector');
assert.match(source, /pageJumpInput/i, 'products page should keep a direct page jump input');

for (const param of ['priceMin', 'priceMax', 'weightMin', 'weightMax', 'stockMin', 'stockMax', 'warehouseStockMode', 'profitFilter']) {
  assert.match(source, new RegExp(`params\\.set\\('${param}'`), `products page should send ${param} to the product list API`);
}

assert.match(source, /limit:\s*String\(pageSize\)/, 'products page should use selected page size as API limit');
assert.match(source, /setPageSize\(Number\(e\.target\.value\)\)/, 'products page should let users change rows per page');

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

assert.match(source, /value:\s*'very_profitable'|value="very_profitable"/, 'products page should support a very profitable filter option');
assert.match(source, /priceField/i, 'batch price dialog should support choosing which price field to modify');
assert.match(source, /minPrice/i, 'batch price dialog should support the Ozon minimum price field');

console.log('PASS web products filter routing');
