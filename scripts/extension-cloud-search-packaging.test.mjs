import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildScript = fs.readFileSync('scripts/build-extension-package.mjs', 'utf8');

assert.match(
  buildScript,
  /https:\/\/s\.1688\.com\/\*/,
  'cloud package host/web-resource allowlist should include 1688 image search pages',
);
assert.match(
  buildScript,
  /https:\/\/\*\.1688\.com\/\*/,
  'cloud package host/web-resource allowlist should include 1688 subdomains',
);
assert.match(
  buildScript,
  /https:\/\/pifa\.pinduoduo\.com\/\*/,
  'cloud package host/web-resource allowlist should include PDD image search pages',
);
assert.match(
  buildScript,
  /https:\/\/www\.taobao\.com\/\*/,
  'cloud package host/web-resource allowlist should include Taobao image search entry',
);
assert.match(
  buildScript,
  /https:\/\/s\.taobao\.com\/\*/,
  'cloud package host/web-resource allowlist should include Taobao image search results',
);
console.log('PASS cloud image search packaging allowlist');
