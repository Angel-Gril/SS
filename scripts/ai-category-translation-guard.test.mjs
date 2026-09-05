import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('apps/server/src/routes/collect.ts', 'utf8');
const usage = readFileSync('apps/server/src/services/ai-usage.ts', 'utf8');

assert.match(route, /MAX_CATEGORY_TRANSLATION_TERMS_PER_REQUEST\s*=\s*20/u);
assert.match(route, /maxTerms:\s*MAX_CATEGORY_TRANSLATION_TERMS_PER_REQUEST/u);
assert.match(route, /reserveAiDailyLimit\(/u);
assert.match(route, /namespace:\s*'category_term'/u);
assert.match(route, /reserved:\s*true/u);
assert.match(route, /isUnknownAiOutcome\(ai\)/u);
assert.match(usage, /ai_usage_quota_daily/u);
assert.match(usage, /ON CONFLICT[\s\S]*consumed_count[\s\S]*< \$\{limit\}/u);

console.log('PASS AI category translation quota and fan-out guard');
