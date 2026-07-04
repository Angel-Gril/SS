import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = [
  'apps/web/src/app/(dashboard)/finance/page.tsx',
  'apps/web/src/app/(dashboard)/finance/profit/page.tsx',
  'apps/web/src/app/(dashboard)/finance/logistics/page.tsx',
  'apps/web/src/app/(dashboard)/admin/accounts/page.tsx',
  'apps/web/src/app/(dashboard)/admin/users/page.tsx',
  'apps/web/src/app/(dashboard)/admin/solo-billing/page.tsx',
  'apps/web/src/app/(dashboard)/settings/staff/page.tsx',
  'apps/web/src/app/(dashboard)/shops/ozon/page.tsx',
];

const tableReplacedByEmptyDivPattern = /\)\s*:\s*[A-Za-z0-9_?.]+\.length === 0 \? \([\s\S]{0,260}<div[\s\S]{0,900}<Table/;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    tableReplacedByEmptyDivPattern,
    `${file} should keep table headers visible for empty results`,
  );
  assert.match(
    source,
    /<TableCell colSpan=\{\d+\}/,
    `${file} should render empty states as full-width table body rows`,
  );
}

console.log('PASS web table empty states');
