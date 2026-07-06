import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const collectRoute = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');
const listOverlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

test('browser one-click listing uses temporary collect records instead of polluting SKU collect page', () => {
  assert.match(
    background,
    /collectOzonProductsToErp\(productIds,[\s\S]*ephemeralListing:\s*true/,
    'one-click publish should collect into temporary ERP records',
  );
  assert.match(
    background,
    /includeEphemeral=1/,
    'publish follow-up lookup should explicitly include temporary collect records',
  );
  assert.match(
    background,
    /ephemeralHit[\s\S]*metadata[\s\S]*ephemeralListing\s*===\s*true/,
    'publish follow-up lookup should prefer the newly created temporary record over older normal collect rows',
  );
  assert.match(
    collectRoute,
    /function\s+applyVisibleSupplyGoodsFilter/,
    'collect list/status queries should share a visible-record filter',
  );
  assert.match(
    collectRoute,
    /metadata:\s*\{\s*path:\s*\['ephemeralListing'\],\s*equals:\s*true\s*\}/,
    'visible-record filter should hide temporary one-click listing records by default',
  );
  assert.match(
    collectRoute,
    /if\s*\(\s*query\.includeEphemeral\s*!==\s*'1'\s*\)/,
    'collect list endpoint should only show temporary records when explicitly requested',
  );
  assert.match(
    collectRoute,
    /scheduleEphemeralListingCleanup\(items,\s*userId,\s*5\s*\*\s*60\s*\*\s*1000\)/,
    'successful publish should schedule temporary collect records for cleanup after five minutes',
  );
  assert.match(
    collectRoute,
    /function\s+purgeExpiredEphemeralListingRecords/,
    'server should have a best-effort cleanup for temporary records after restart',
  );
  assert.match(
    collectRoute,
    /status:\s*'listed'[\s\S]*updatedAt:\s*\{\s*lt:\s*new Date\(Date\.now\(\)\s*-\s*EPHEMERAL_LISTING_TTL_MS\)/,
    'restart-safe cleanup should only purge successfully listed temporary records after the TTL',
  );
});

test('Ozon list publish mode renders a lightweight publish confirmation instead of KPI table', () => {
  const publishConfirmFunction = listOverlay.match(/function\s+renderListWorkbenchPublishConfirm[\s\S]*?\n  }\n\n  async function publishListWorkbenchSelectedRows/);
  assert.ok(publishConfirmFunction, 'publish confirmation renderer should be present');
  assert.match(
    listOverlay,
    /data-role="publish-confirm-wrap"/,
    'list workbench should have a dedicated publish confirmation surface',
  );
  assert.match(
    listOverlay,
    /function\s+renderListWorkbenchPublishConfirm/,
    'publish mode should render through a dedicated confirmation renderer',
  );
  assert.match(
    listOverlay,
    /modal\.__ssErpWorkbenchFocus\s*===\s*'publish'[\s\S]*renderListWorkbenchPublishConfirm/,
    'publish mode should bypass the dense KPI table renderer',
  );
  assert.doesNotMatch(
    publishConfirmFunction[0],
    /月销量|广告费占比|跟卖最低价/,
    'publish confirmation should not render KPI/analytics columns',
  );
});
