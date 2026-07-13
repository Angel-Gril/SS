import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const collectBackground = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const sellerFixture = JSON.parse(fs.readFileSync('scripts/fixtures/ozon-logistics/current-seller-267.sanitized.json', 'utf8'));
const sellerSnapshotFixture = JSON.parse(fs.readFileSync(
  'scripts/fixtures/ozon-logistics/current-seller-267.sanitized.sync.json',
  'utf8',
));
const officialFixture = JSON.parse(fs.readFileSync('scripts/fixtures/ozon-logistics/official-25-request.sanitized.har.json', 'utf8'));

function extractFunctionSource(source, functionName) {
  const asyncStart = source.indexOf(`async function ${functionName}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${functionName}(`);
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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const currentMethodSandbox = {};
vm.runInNewContext(
  `${extractFunctionSource(collectBackground, 'collectOzonDeliveryMethodArrays')};`
    + `${extractFunctionSource(collectBackground, 'toPositiveNumber')};`
    + `${extractFunctionSource(collectBackground, 'toCleanString')};`
    + `${extractFunctionSource(collectBackground, 'extractOzonSellerDeliveryMethods')};`
    + 'globalThis.extractMethods = extractOzonSellerDeliveryMethods;',
  currentMethodSandbox,
);
assert.deepEqual(plain(currentMethodSandbox.extractMethods({
  delivery_methods: [{
    delivery_method_id: 32672640,
    warehouse_id: 'wh-101',
    delivery_method: 'RETS Xiamen configured method',
    tpl_provider_id: 1079,
    tpl_provider: 'RETS Standard Extra Small',
  }],
})), [{
  id: 32672640,
  name: 'RETS Xiamen configured method',
  warehouseId: 'wh-101',
  providerId: 1079,
  providerName: 'RETS Standard Extra Small',
  tplDropoffPointId: null,
}]);

const malformedDiscoverySandbox = {};
vm.runInNewContext(
  `${extractFunctionSource(collectBackground, 'toPositiveNumber')};`
    + `${extractFunctionSource(collectBackground, 'toCleanString')};`
    + `${extractFunctionSource(collectBackground, 'extractOzonSellerWarehouseIds')};`
    + `${extractFunctionSource(collectBackground, 'extractOzonSellerProvidersFromTemplates')};`
    + 'globalThis.extractWarehouseIds = extractOzonSellerWarehouseIds;'
    + 'globalThis.extractTemplateProviders = extractOzonSellerProvidersFromTemplates;',
  malformedDiscoverySandbox,
);
assert.throws(
  () => malformedDiscoverySandbox.extractWarehouseIds({}), /result/,
);
assert.throws(
  () => malformedDiscoverySandbox.extractTemplateProviders({}), /provider_templates/,
);

const discoveryCalls = [];
const currentDiscoverySandbox = {
  OZON_ENDPOINTS: {
    sellerWarehouseList: 'https://seller.ozon.ru/api/site/logistic-service/v2/warehouse/list',
    sellerDeliveryMethodList: 'https://seller.ozon.ru/api/posting-service/seller-ui/delivery-method/list',
  },
  sellerTabFetchJson: async (url, body, companyId, requestOptions) => {
    discoveryCalls.push({ url, body, companyId, requestOptions });
    if (url.endsWith('/api/site/logistic-service/v2/warehouse/list')) {
      return { result: [{ warehouse_id: 'wh-101' }, { warehouse_id: 'wh-202' }] };
    }
    if (!url.endsWith('/api/posting-service/seller-ui/delivery-method/list')) {
      throw new Error(`unexpected URL ${url}`);
    }
    if (body.delivery_method_statuses[0] === 'active' && !body.cursor) {
      return {
        delivery_methods: [{ delivery_method_id: 11, warehouse_id: 'wh-101', tpl_provider_id: 101, tpl_provider: 'Active provider' }],
        cursor: 'active-next',
      };
    }
    if (body.delivery_method_statuses[0] === 'active') {
      return {
        delivery_methods: [{ delivery_method_id: 12, warehouse_id: 'wh-202', tpl_provider_id: 202, tpl_provider: 'Active provider 2' }],
        cursor: '',
      };
    }
    return {
      delivery_methods: [{ delivery_method_id: 13, warehouse_id: 'wh-101', tpl_provider_id: 303, tpl_provider: 'Disabled provider' }],
      cursor: '',
    };
  },
};
vm.runInNewContext(
  `${extractFunctionSource(collectBackground, 'collectOzonDeliveryMethodArrays')};`
    + `${extractFunctionSource(collectBackground, 'toPositiveNumber')};`
    + `${extractFunctionSource(collectBackground, 'toCleanString')};`
    + `${extractFunctionSource(collectBackground, 'toOzonSellerTemplateCompanyId')};`
    + `${extractFunctionSource(collectBackground, 'extractOzonSellerDeliveryMethods')};`
    + `${extractFunctionSource(collectBackground, 'extractOzonSellerWarehouseIds')};`
    + `${extractFunctionSource(collectBackground, 'buildOzonSellerDeliveryMethodListBody')};`
    + `${extractFunctionSource(collectBackground, 'fetchOzonSellerConfiguredMethods')};`
    + 'globalThis.discoverMethods = fetchOzonSellerConfiguredMethods;',
  currentDiscoverySandbox,
);
const currentDiscovery = await currentDiscoverySandbox.discoverMethods('4494016');
assert.equal(currentDiscovery.complete, true);
assert.deepEqual(plain(currentDiscovery.warehouseIds), ['wh-101', 'wh-202']);
assert.deepEqual(plain(currentDiscovery.methods.map((method) => method.id)), [11, 12, 13]);
assert.deepEqual(plain(currentDiscovery.providers), [
  { providerId: 101, providerName: 'Active provider' },
  { providerId: 202, providerName: 'Active provider 2' },
  { providerId: 303, providerName: 'Disabled provider' },
]);
const methodCalls = discoveryCalls.filter((call) => call.url.endsWith('/delivery-method/list'));
assert.equal(methodCalls.length, 3);
assert.deepEqual(plain(methodCalls.map((call) => call.body.delivery_method_statuses)), [
  ['active'], ['active'], ['disabled', 'new'],
]);
assert.equal(methodCalls[0].body.limit, 20);
assert.equal(methodCalls[1].body.cursor, 'active-next');
assert.equal(methodCalls.every((call) => call.requestOptions.pageType === 'CbPostingsFbs'), true);
assert.equal(
  new Date(methodCalls[0].body.processed_at_to).getTime()
    - new Date(methodCalls[0].body.processed_at_from).getTime(),
  (91 * 24 * 60 * 60 * 1000) - 1,
);

const completenessSandbox = {};
vm.runInNewContext(
  `${extractFunctionSource(collectBackground, 'buildOzonSellerProviderStats')};`
    + 'globalThis.buildStats = buildOzonSellerProviderStats;',
  completenessSandbox,
);
assert.deepEqual(plain(completenessSandbox.buildStats({
  discovered: 2, attempted: 2, succeeded: 2, failed: 0, empty: 0,
  templateComplete: true, methodBindingsComplete: false, methodBindingsRequired: false,
})), {
  discovered: 2, attempted: 2, succeeded: 2, failed: 0, empty: 0,
  catalogComplete: true, methodBindingsComplete: false, methodBindingsRequired: false,
  complete: true,
});
assert.equal(completenessSandbox.buildStats({
  discovered: 2, attempted: 2, succeeded: 2, failed: 0, empty: 0,
  templateComplete: true, methodBindingsComplete: false, methodBindingsRequired: true,
}).complete, false);
assert.equal(completenessSandbox.buildStats({
  discovered: 2, attempted: 2, succeeded: 2, failed: 0, empty: 0,
  templateComplete: false, methodBindingsComplete: true, methodBindingsRequired: false,
}).complete, false);
const emptyOnlyStats = completenessSandbox.buildStats({
  discovered: 2, attempted: 2, succeeded: 1, failed: 0, empty: 1,
  templateComplete: true, methodBindingsComplete: true, methodBindingsRequired: true,
});
assert.equal(emptyOnlyStats.catalogComplete, false);
assert.equal(emptyOnlyStats.complete, false);

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
  { providerId: 101, providerName: 'Warehouse only', source: 'method', status: 'pending', pointCount: 0 },
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

const catalogServices = sellerSnapshotFixture.catalogSnapshot.services;
const formulaServices = sellerSnapshotFixture.ruleSnapshot.services;
const selectedServiceIds = new Set(sellerSnapshotFixture.userConfig.selectedServiceIds.map(String));
const selectedServices = catalogServices.filter((service) => selectedServiceIds.has(String(service.id)));
const chargeModes = formulaServices.reduce((counts, service) => {
  const mode = String(service.conditions && service.conditions.chargeMode || 'unknown');
  counts[mode] = (counts[mode] || 0) + 1;
  return counts;
}, {});
const selectedRouteMix = selectedServices.reduce((counts, service) => {
  const label = `${service.carrierName || ''} ${service.displayName || ''}`.toLowerCase();
  if (label.includes('belarus')) counts.belarus += 1;
  else if (label.includes('kazakhstan')) counts.kazakhstan += 1;
  else counts.unclassifiedRussiaCandidates += 1;
  return counts;
}, { belarus: 0, kazakhstan: 0, unclassifiedRussiaCandidates: 0 });

assert.equal(catalogServices.length, sellerFixture.characterization.templateCount);
assert.equal(formulaServices.length, sellerFixture.characterization.templateCount);
assert.equal(
  new Set(catalogServices.map((service) => String(service.providerId))).size,
  sellerFixture.characterization.providerCount,
);
assert.deepEqual(chargeModes, {
  actual: sellerFixture.characterization.chargeModes.actual,
  hybrid: sellerFixture.characterization.chargeModes.hybrid,
  max_actual_volume: sellerFixture.characterization.chargeModes.maxActualVolume,
});
assert.equal(selectedServices.length, sellerFixture.characterization.selectedServiceCount);
assert.deepEqual(selectedRouteMix, sellerFixture.characterization.selectedRouteMix);

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

for (const fixture of [sellerFixture, sellerSnapshotFixture, officialFixture]) {
  const serialized = JSON.stringify(fixture).toLowerCase();
  for (const forbidden of ['authorization', 'bearer ', 'cookie', 'access_token', 'refresh_token']) {
    assert.equal(serialized.includes(forbidden), false, `fixture must not contain ${forbidden}`);
  }
}

assert.match(
  collectBackground,
  /source:\s*['"]both['"]|provider\.source\s*=\s*['"]both['"]|method[\s\S]{0,300}template[\s\S]{0,300}both/,
  'browser collector should retain method/template/both provider provenance',
);
assert.match(
  collectBackground,
  /providerAttempted[\s\S]{0,1200}providerSucceeded[\s\S]{0,1200}providerFailed[\s\S]{0,1200}providerEmpty/,
  'browser progress should distinguish attempted, succeeded, failed, and empty provider responses',
);
assert.match(
  collectBackground,
  /providerStats\s*=\s*buildOzonSellerProviderStats\s*\(/,
  'browser collection should apply the source-aware completeness model',
);
assert.match(
  collectBackground,
  /pointKey\s*=\s*providerId\s*\+\s*["']:["']\s*\+\s*externalId/,
  'raw point relationships should remain unique by providerId:externalId',
);

console.log('PASS Ozon drop-off provider completeness');
