import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('ERP URL collection preserves full Ozon product URLs for description fetches', () => {
  const collectPageSource = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');
  const panelSource = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');
  const popupSource = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
  const backgroundSource = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(collectPageSource, /const\s+productUrls:\s*string\[\]\s*=\s*\[\]/);
  assert.match(collectPageSource, /productUrls\.push\(line\)/);
  assert.match(
    collectPageSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*productUrls/,
  );

  assert.match(
    panelSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*productUrls:\s*\[window\.location\.href\]/,
  );
  assert.match(
    popupSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*productUrls:\s*\[primaryActionState\.sourceUrl\]/,
  );

  assert.match(backgroundSource, /function\s+normalizeOzonCollectionInputs\(/);
  assert.match(backgroundSource, /normalizeOzonCollectionInputs\(productIds,\s*options\.productUrls\)/);
  assert.match(backgroundSource, /fetchOzonProductViaTab\(pid,\s*sourceUrl,\s*collectPolicy\)/);
  assert.match(backgroundSource, /productUrls:\s*message\.productUrls/);
});

test('background description fetch tries multiple Ozon APIs and records diagnostics', () => {
  const backgroundSource = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(backgroundSource, /function\s+buildDescriptionFetchRequests\(/);
  assert.match(backgroundSource, /\/api\/entrypoint-api\.bx\/page\/json\/v2/);
  assert.match(backgroundSource, /\/api\/composer-api\.bx\/page\/json\/v2/);
  assert.match(backgroundSource, /layout_page_index=3/);
  assert.match(backgroundSource, /descriptionFetchTrace/);
  assert.match(backgroundSource, /descriptionFetchDiagnostics/);
});
