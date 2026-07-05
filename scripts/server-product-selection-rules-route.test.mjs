import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync('apps/server/prisma/schema.prisma', 'utf8');
const route = fs.readFileSync('apps/server/src/routes/extension-config.ts', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

test('server exposes a user-scoped product selection rule center for the extension', () => {
  assert.match(schema, /model\s+ProductSelectionRule/, 'Prisma schema should persist product selection rules per user');
  assert.match(schema, /@@map\("product_selection_rules"\)/, 'selection rules should use a dedicated table');
  assert.match(schema, /userId\s+String\s+@map\("user_id"\)/, 'rules should be scoped to the authenticated user');
  assert.match(route, /productSelectionRuleSchema/, 'route should validate rule payloads');
  assert.match(route, /app\.get\('\/product-selection\/rules'/, 'route should list rules');
  assert.match(route, /app\.post\('\/product-selection\/rules'/, 'route should add or update rules');
  assert.match(route, /app\.post\('\/product-selection\/rules\/:id\/toggle'/, 'route should toggle enabled state');
  assert.match(route, /app\.delete\('\/product-selection\/rules\/:id'/, 'route should delete rules');
  assert.match(route, /WHERE\s+"user_id"\s*=\s*\$\{userId\}/, 'raw SQL should always constrain queries by userId');
  assert.match(
    route,
    /function\s+normalizeProductSelectionRuleBoolean/,
    'rule center should normalize boolean-like rule flags from extension snapshots',
  );
  assert.match(
    route,
    /autoFavorite:\s*normalizeProductSelectionRuleBoolean\([\s\S]*input\.autoFavorite[\s\S]*input\.auto_favorite[\s\S]*\)\s*===\s*true/,
    'rule center should accept Maozi-style numeric/string auto_favorite values',
  );
  for (const conditionKey of [
    'hasBrand',
    'minSalesDynamics',
    'maxSalesDynamics',
    'minDiscountPercent',
    'maxDiscountPercent',
    'minPaidPromotionDays',
    'maxPaidPromotionDays',
    'minSearchCatalogAddToCartRate',
    'priority',
  ]) {
    assert.match(route, new RegExp(`'${conditionKey}'`), `rule center should allow ${conditionKey} conditions`);
  }
});

test('extension proxies cloud rules and persists the enabled snapshot locally', () => {
  for (const type of [
    'spb-self-hosted:list-product-selection-rules',
    'spb-self-hosted:save-product-selection-rule',
    'spb-self-hosted:toggle-product-selection-rule',
    'spb-self-hosted:delete-product-selection-rule',
  ]) {
    assert.match(background, new RegExp(type), `background should proxy ${type}`);
  }
  assert.match(background, /\/api\/extension-config\/product-selection\/rules/, 'background should use our ERP rule center endpoint');
  assert.match(overlay, /chrome\.storage\.local/, 'content script should use extension local storage for active rule snapshots');
  assert.match(overlay, /productSelectionRules/, 'content script should keep a Maozi-style enabled rule snapshot key');
  assert.match(overlay, /syncProductSelectionRulesFromCloud/, 'selection modal should pull cloud rules before editing');
  assert.match(overlay, /persistProductSelectionRulesSnapshot/, 'selection modal should save enabled rule snapshots for local matching');
  assert.match(overlay, /autoFavorite/, 'rule model should preserve auto-favorite intent for future favorite integration');
});
