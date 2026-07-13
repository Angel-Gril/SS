import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));

test('logistics distribution ships behind extension version 1.0.196', () => {
  assert.equal(manifest.version, '1.0.196');
});
