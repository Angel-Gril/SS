import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const collectBackground = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const sellerFixture = JSON.parse(fs.readFileSync('scripts/fixtures/ozon-logistics/current-seller-267.sanitized.json', 'utf8'));
const officialFixture = JSON.parse(fs.readFileSync('scripts/fixtures/ozon-logistics/official-25-request.sanitized.har.json', 'utf8'));

function extractFunctionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${functionName}`);
}

const browserSandbox = {};
vm.runInNewContext(
  `${extractFunctionSource(collectBackground, 'mergeOzonSellerProviderSources')};`
    + 'globalThis.mergeProviders = mergeOzonSellerProviderSources;',
  browserSandbox,
);
const browserUnion = browserSandbox.mergeProviders(
  [
    { providerId: 101, providerName: 'Warehouse only' },
    { providerId: 202, providerName: 'Warehouse shared' },
  ],
  [
    { providerId: 202, providerName: 'Template shared' },
    { providerId: 303, providerName: 'Template only' },
  ],
);
assert.deepEqual(JSON.parse(JSON.stringify(browserUnion)), [
  { providerId: 101, providerName: 'Warehouse only', source: 'warehouse', status: 'pending', pointCount: 0 },
  { providerId: 202, providerName: 'Warehouse shared', source: 'both', status: 'pending', pointCount: 0 },
  { providerId: 303, providerName: 'Template only', source: 'template', status: 'pending', pointCount: 0 },
]);

assert.equal(sellerFixture.scope, 'legacy-unverified-xiamen-sample');
assert.equal(sellerFixture.characterization.templateCount, 267);
assert.equal(sellerFixture.characterization.providerCount, 159);
assert.deepEqual(sellerFixture.characterization.chargeModes, {
  actual: 209,
  maxActualVolume: 55,
  hybrid: 3,
});
assert.deepEqual(sellerFixture.characterization.selectedRouteMix, {
  belarus: 12,
  kazakhstan: 12,
  unclassifiedRussiaCandidates: 13,
});

assert.equal(officialFixture.scope, 'historical-validation-sample-not-production-catalog');
assert.equal(officialFixture.characterization.calculateRequestCount, 25);
assert.equal(officialFixture.characterization.originCityCount, 15);
assert.equal(officialFixture.characterization.latestTariffCount, 63);
assert.equal(officialFixture.characterization.matchReport.exactMatches, 57);
assert.equal(officialFixture.characterization.matchReport.driftingTariffs, 6);
assert.equal(officialFixture.characterization.matchReport.driftingProviders, 3);
assert.deepEqual(officialFixture.characterization.matchReport.providerFamilies, ['ATC']);
assert.equal(
  officialFixture.characterization.matchReport.exactMatches
    + officialFixture.characterization.matchReport.driftingTariffs,
  officialFixture.characterization.latestTariffCount,
);

for (const fixture of [sellerFixture, officialFixture]) {
  const serialized = JSON.stringify(fixture).toLowerCase();
  for (const forbidden of ['authorization', 'bearer ', 'cookie', 'access_token', 'refresh_token']) {
    assert.equal(serialized.includes(forbidden), false, `fixture must not contain ${forbidden}`);
  }
}

assert.match(
  collectBackground,
  /source:\s*['"]both['"]|provider\.source\s*=\s*['"]both['"]|warehouse[\s\S]{0,300}template[\s\S]{0,300}both/,
  'browser collector should retain warehouse/template/both provider provenance',
);
assert.match(
  collectBackground,
  /providerAttempted[\s\S]{0,1200}providerSucceeded[\s\S]{0,1200}providerFailed[\s\S]{0,1200}providerEmpty/,
  'browser progress should distinguish attempted, succeeded, failed, and empty provider responses',
);
assert.match(
  collectBackground,
  /complete:\s*providerAttempted\s*===\s*providerEntries\.length\s*&&\s*providerFailed\s*===\s*0/,
  'browser collection completeness should require every attempt and zero failures',
);
assert.match(
  collectBackground,
  /pointKey\s*=\s*providerId\s*\+\s*["']:["']\s*\+\s*externalId/,
  'raw point relationships should remain unique by providerId:externalId',
);

console.log('PASS Ozon drop-off provider completeness');
