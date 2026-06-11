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
console.log('PASS cloud image search packaging allowlist');
