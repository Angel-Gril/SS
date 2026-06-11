import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

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

console.log('PASS Ozon list overlay established UI');
