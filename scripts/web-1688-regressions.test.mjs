import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepoFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

test('1688 collect and listing pages expose saved SKU images for review', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const collectPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'collect', '1688', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', '1688', 'page.tsx');

  assert.match(packageJson.scripts['test:repo'], /web-1688-regressions\.test\.mjs/);

  for (const source of [collectPage, listingPage]) {
    assert.match(source, /images\?:\s*string\[\]\s*\|\s*null/);
    assert.match(source, /imageUrl\?:\s*string\s*\|\s*null/);
    assert.match(source, /sourceSkuId\?:\s*string\s*\|\s*null/);
    assert.match(source, /ozonSku\?:\s*string\s*\|\s*null/);
    assert.match(source, /imageUrl:\s*parts\[6\]\s*\|\|\s*undefined/);
    assert.match(source, /ozonSku:\s*parts\[7\]\s*\|\|\s*undefined/);
    assert.match(source, /SKU图片URL/);
    assert.match(source, /Ozon SKU/);
    assert.match(source, /variant\.sourceSkuId\s*\?\s*`货源SKU\s*\$\{variant\.sourceSkuId\}`/);
    assert.match(source, /variant\.ozonSku\s*\?\s*`Ozon SKU\s*\$\{variant\.ozonSku\}`/);
    assert.match(source, /function\s+variantImageUrl\(variant:\s*Alibaba1688Variant\)/);
    assert.match(source, /\.\.\.\(variant\.images\s*\|\|\s*\[\]\),\s*variant\.imageUrl\s*\|\|\s*''/);
    assert.match(source, /const\s+image\s*=\s*variantImageUrl\(variant\)/);
    assert.match(source, /src=\{image\}/);
    assert.match(source, /aria-label="SKU 图片"/);
  }
});

test('dashboard and main listing page expose 1688 workflow entry points', () => {
  const dashboardPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'page.tsx');
  const listingPage = readRepoFile('apps', 'web', 'src', 'app', '(dashboard)', 'listing', 'page.tsx');

  assert.match(dashboardPage, /href="\/collect\/1688"/);
  assert.match(dashboardPage, /href="\/listing\/1688"/);
  assert.match(listingPage, /router\.push\('\/collect\/1688'\)/);
  assert.match(listingPage, /router\.push\('\/listing\/1688'\)/);
});
