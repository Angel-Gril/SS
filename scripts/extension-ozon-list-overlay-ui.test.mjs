import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

assert.doesNotMatch(
  overlay,
  /轻量商品指标条|ss-erp-details|更多数据|需授权/,
  'Ozon list overlay should not regress to the accidental lightweight redesign',
);
assert.match(
  overlay,
  /ss-erp-collect-btn/,
  'Ozon list overlay should keep the established list-card collect action',
);
assert.match(
  overlay,
  /ss-erp-expand-btn/,
  'Ozon list overlay should keep the established list-card expansion control',
);

assert.match(
  overlay,
  /ss-erp-overlay-card-expanded/,
  'Ozon list overlay should keep the established expanded-card styling hook',
);

assert.match(
  overlay,
  /ss-erp-status-pill["'][^>]+display:none/,
  'Ozon list overlay should hide the internal data-source pill without removing it',
);
assert.match(
  overlay,
  /Object\.assign\(\{\},\s*resp\.item,\s*\{\s*_sources:\s*resp\.sources\s*\|\|\s*\[\]/,
  'Ozon list overlay should still pass premium/source payloads into metric rendering',
);
assert.match(
  overlay,
  /_sourceErrors/,
  'Ozon list overlay should keep source failure details available for diagnostics',
);
assert.match(
  overlay,
  /hasDisplayablePremiumData/,
  'Ozon list overlay should not cache empty premium responses as successful detailed data',
);
assert.doesNotMatch(
  overlay,
  /数据状态|sourceErrors\.join/,
  'Ozon list overlay should not show raw seller/public/ERP source failures directly to users',
);
assert.match(
  background,
  /sourceErrors/,
  'Ozon insights aggregation should return sourceErrors instead of silently hiding data-source failures',
);
assert.doesNotMatch(
  background,
  /if\s*\(\s*!item\.soldCount\s*&&\s*!item\.sellerName\s*\)/,
  'Ozon insights aggregation should not skip public fallback just because seller returned partial fields',
);

console.log('PASS Ozon list overlay established UI');
