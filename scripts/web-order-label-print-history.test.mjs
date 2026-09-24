import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const orderRoute = fs.readFileSync('apps/server/src/routes/order.ts', 'utf8');
const printPage = fs.readFileSync('apps/web/src/app/(dashboard)/warehouse/print/page.tsx', 'utf8');
const scanOutPage = fs.readFileSync('apps/web/src/app/(dashboard)/warehouse/scan-out/page.tsx', 'utf8');
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
  printPage,
  /fetchLabelBlob\(orderId, null, apiRequestUrl\(''\)\)/,
  'warehouse printing should use the authenticated same-origin API transport',
);
assert.match(
  scanOutPage,
  /fetch\(apiRequestUrl\(`\/api\/orders\/\$\{orderId\}\/label`\)/,
  'scan-out label printing should use the authenticated same-origin API transport',
);
assert.match(
  ordersPage,
  /面单打印/,
  'orders page should explicitly display label print time',
);
assert.match(
  ordersPage,
  /\{order\.labelPrintedAt && <div><span[^>]*>面单<\/span>\s*\{formatCompactDate\(order\.labelPrintedAt\)\}<\/div>\}/,
  'orders list should format the persisted labelPrintedAt only when it is available',
);

const ordersAst = ts.createSourceFile('orders/page.tsx', ordersPage, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dateFormatter = ordersAst.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'formatCompactDate',
);
assert.ok(dateFormatter, 'orders list must define its compact date formatter');
// Execute the production formatter without importing the page and its UI dependencies.
const compiledFormatter = ts.transpileModule(dateFormatter.getText(ordersAst), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const formatCompactDate = vm.runInNewContext(`${compiledFormatter}\nformatCompactDate;`, { Date, Intl }, {
  filename: 'orders-label-print-date.cjs',
  timeout: 1_000,
});
const printedAt = new Date(2026, 8, 16, 14, 5, 38);
assert.equal(
  formatCompactDate(printedAt),
  '09/16 14:05',
  'label print history should retain month, day, hour and minute',
);
assert.equal(
  formatCompactDate(printedAt.toISOString()),
  '09/16 14:05',
  'server timestamp strings should render in the same local time as Date values',
);

console.log('PASS web order label print history');
