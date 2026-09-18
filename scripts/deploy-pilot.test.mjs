import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./deploy-pilot.sh', import.meta.url), 'utf8');

test('pilot deployment requires an explicit hosted-pilot expectation and snapshot', () => {
  assert.match(source, /AI_MEDIA_ROLLOUT_EXPECTATION:-/u);
  assert.match(source, /hosted-pilot/u);
  assert.match(source, /AI_MEDIA_PILOT_EXPECTATIONS_JSON/u);
  assert.match(source, /must be valid JSON/u);
  assert.match(source, /exec bash scripts\/deploy\.sh/u);
});

test('pilot deployment does not mutate rollout flags or invoke a generic bypass', () => {
  assert.doesNotMatch(source, /systemConfig|feature_extension_hosted_ai|UPDATE\s/iu);
  assert.doesNotMatch(source, /--skip|SKIP.*dark|verify-ai-media-dark.*true/iu);
});
