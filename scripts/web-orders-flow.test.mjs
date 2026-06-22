import assert from 'node:assert/strict';
import fs from 'node:fs';

const ordersPage = fs.readFileSync('apps/web/src/app/(dashboard)/orders/page.tsx', 'utf8');
const logisticsPage = fs.readFileSync('apps/web/src/app/(dashboard)/orders/logistics/page.tsx', 'utf8');

assert.match(
  ordersPage,
  /fulfillmentStage/,
  'orders page should send the selected fulfillment stage to the orders API',
);
assert.match(
  ordersPage,
  /warehouse_processing/,
  'orders page should expose the merged warehouse processing stage key',
);
assert.match(
  ordersPage,
  /仓库处理/,
  'orders page should display the merged warehouse processing stage label',
);
assert.match(
  ordersPage,
  /采购备货/,
  'orders page should rename purchased stage to purchase stocking',
);
assert.doesNotMatch(
  ordersPage,
  /inspecting|awaiting_label|验视\/打包|采购下单/,
  'orders page should not use old split warehouse stage keys or labels',
);
assert.doesNotMatch(
  logisticsPage,
  /awaiting_label/,
  'logistics page should not depend on the removed awaiting_label stage key',
);

console.log('PASS web orders flow');
