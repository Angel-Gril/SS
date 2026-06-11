import assert from 'node:assert/strict';
import fs from 'node:fs';

const contentScript = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');

const signature = contentScript.match(/function\s+extractOzonVariants\s*\(([^)]*)\)/);
assert.ok(signature, 'collect content script should define extractOzonVariants');
assert.match(
  signature[1],
  /\bcurrency\b/,
  'extractOzonVariants should receive currency explicitly instead of reading collectOzonViaApi local scope',
);
assert.match(
  contentScript,
  /extractOzonVariants\s*\(\s*widgets\s*,\s*productId\s*,\s*currency\s*\)/,
  'collectOzonViaApi should pass the resolved currency to extractOzonVariants',
);

const functionStart = contentScript.indexOf('function extractOzonVariants');
const nextFunction = contentScript.indexOf('\n  function safePreview', functionStart);
assert.ok(functionStart >= 0 && nextFunction > functionStart, 'extractOzonVariants body should be discoverable');
const body = contentScript.slice(functionStart, nextFunction);

assert.match(
  body,
  /parsePriceWithCurrencySafe\s*\(\s*priceText\s*,\s*currency\s*\)/,
  'variant price parsing should use the top-level safe currency parser',
);
assert.doesNotMatch(
  body.replaceAll('parsePriceWithCurrencySafe', ''),
  /\bparsePriceWithCurrency\s*\(/,
  'extractOzonVariants should not call an out-of-scope parsePriceWithCurrency local',
);

console.log('PASS Ozon variant currency parser scope');
