import assert from 'node:assert/strict';
import fs from 'node:fs';

const pagePath = 'apps/web/src/app/(dashboard)/collect/source/page.tsx';
const clientPath = 'apps/web/src/lib/source-listing-workflow.ts';
const workbenchPath = 'apps/web/src/components/source-listing/source-listing-workbench.tsx';
const extensionPanelPath = 'extensions/ss-erp/content/source-costing-panel.js';
const extensionWorkerPath = 'extensions/ss-erp/background/service-worker.js';
const serverIntegrationPath = 'apps/server/src/__tests__/source-to-ozon-minimum-closure.integration.test.ts';

for (const path of [pagePath, clientPath, workbenchPath, extensionPanelPath, extensionWorkerPath]) {
  assert.equal(fs.existsSync(path), true, `${path} should exist`);
}

const page = fs.readFileSync(pagePath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');
const workbench = fs.readFileSync(workbenchPath, 'utf8');
const extensionPanel = fs.readFileSync(extensionPanelPath, 'utf8');
const extensionWorker = fs.readFileSync(extensionWorkerPath, 'utf8');

assert.match(
  page,
  /from ['"]@\/lib\/source-listing-workflow['"]/,
  'source page should use the centralized Unit 6B client',
);
assert.match(page, /useSearchParams/, 'source page should restore an authenticated extension handoff or workflow URL');
assert.match(workbench, /createPublishAttempt/, 'source workbench should render the immutable V2 publish attempt flow');
assert.match(workbench, /SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY/, 'product-only 1688 captures should remain publishable');
assert.match(client, /publish-attempts/, 'central client should own the immutable publish attempt API path');
assert.match(client, /\/api\/source-capture-views/, 'client should page the complete canonical source snapshot');
assert.match(client, /OZON_LISTING_PRICING_CONTRACT_VERSION/, 'client should build the strict V2 pricing contract');
assert.match(client, /POLL_CANCELLED/, 'attempt polling should be cancellable');
assert.doesNotMatch(client, /\/api\/collect\/publish-ozon/, 'the client must not contain a legacy publisher fallback');
assert.match(extensionPanel, /open-source-workflow/, 'capture success should expose a record-specific ERP Web CTA');
assert.match(extensionWorker, /collect\/source[?]/, 'the Service Worker should build the exact ERP Web handoff URL');
assert.equal(fs.existsSync(serverIntegrationPath), true, `${serverIntegrationPath} should close the server workflow contract`);

console.log('PASS web 1688 to Ozon listing closure');
