import assert from 'node:assert/strict';
import fs from 'node:fs';

const orderRoute = fs.readFileSync('apps/server/src/routes/order.ts', 'utf8');
const printPage = fs.readFileSync('apps/web/src/app/(dashboard)/warehouse/print/page.tsx', 'utf8');
const ordersPage = fs.readFileSync('apps/web/src/app/(dashboard)/orders/page.tsx', 'utf8');

assert.match(
  orderRoute,
  /label-print-logs/,
  'orders API should expose persisted label print logs',
);
assert.match(
  orderRoute,
  /operationType:\s*'label_print'/,
  'label print logs should be backed by warehouse label_print records',
);
assert.match(
  printPage,
  /\/api\/orders\/label-print-logs/,
  'warehouse print page should load persisted label print history',
);
assert.match(
  printPage,
  /面单打印时间/,
  'warehouse print history should label the persisted print time',
);
assert.match(
  ordersPage,
  /面单打印/,
  'orders page should explicitly display label print time',
);
assert.match(
  ordersPage,
  /labelPrintedAt\s*\?\s*formatDate\(order\.labelPrintedAt\)/,
  'orders list should render labelPrintedAt when available',
);

console.log('PASS web order label print history');
