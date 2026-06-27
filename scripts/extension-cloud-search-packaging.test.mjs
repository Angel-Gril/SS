import assert from 'node:assert/strict';
import fs from 'node:fs';

const buildScript = fs.readFileSync('scripts/build-extension-package.mjs', 'utf8');
const manifest = fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8');

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
assert.match(
  buildScript,
  /https:\/\/www\.goofish\.com\/\*/,
  'cloud package host/web-resource allowlist should include Goofish/Xianyu product pages',
);
assert.match(
  buildScript,
  /https:\/\/2\.taobao\.com\/\*/,
  'cloud package host/web-resource allowlist should include legacy Xianyu product pages',
);
assert.match(
  manifest,
  /shared\/collectors\/marketplace-product\.js/,
  'extension manifest should inject the marketplace collector on supported product pages',
);
assert.match(
  manifest,
  /https:\/\/www\.goofish\.com\/\*/,
  'extension manifest should match Goofish/Xianyu product pages',
);
assert.match(
  manifest,
  /https:\/\/2\.taobao\.com\/\*/,
  'extension manifest should match legacy Xianyu product pages',
);
console.log('PASS cloud image search packaging allowlist');
