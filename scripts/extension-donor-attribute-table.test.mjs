import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCollectionFieldValue } from '../extensions/ss-erp/pages/donor/ui/modules/product-editor-display-rules.js';

test('collection controls preserve four official values within the server limit', () => {
  assert.deepEqual(parseCollectionFieldValue('["A","B","C","D"]', 100), ['A', 'B', 'C', 'D']);
  assert.deepEqual(parseCollectionFieldValue(['A', 'B', 'C', 'D'], 4), ['A', 'B', 'C', 'D']);
});
test('over-limit collection readback is refused instead of silently truncated', () => {
  assert.throws(() => parseCollectionFieldValue(['A', 'B', 'C', 'D'], 3), /超过|limit/);
});
