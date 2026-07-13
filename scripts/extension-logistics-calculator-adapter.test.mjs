import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadAdapter() {
  const source = fs.readFileSync(
    'extensions/ss-erp/shared/calculator-core/rule-engine.js',
    'utf8',
  );
  const context = { console, JSON, Number, Object, Array, String, Boolean, Set, Map };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'rule-engine.js' });
  return context.OZON_CALC_LOGISTICS_RELEASE_ADAPTER;
}

const scope = {
  deploymentId: 'domestic-production',
  tenantSubject: 'tenant-a',
  shopId: 'shop-a',
  ozonCompanyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  assignmentId: 'assignment-a',
  schemaMajor: 1,
};

function service(key, providerId, deliveryVariant = 'pickup') {
  return {
    stableServiceKey: key,
    providerId,
    normalizedDescription: key,
    templateType: 'global',
    weightType: 'weight',
    batteryMode: 'no-battery',
    deliveryVariant,
  };
}

function formula(key, providerId) {
  return {
    stableServiceKey: key,
    calculationRule: {
      ruleId: `${key}:default`,
      serviceId: key,
      providerId,
      displayName: key.toUpperCase(),
      carrierName: `Carrier ${providerId}`,
      priority: 10,
      deliveryPromise: '12-19 days',
      conditionNote: '',
      conditions: {
        weightRangeG: [1, 20000],
        priceRangeCNY: ['0', '0'],
        priceRangeRUB: ['0', '0'],
        maxDimsCm: [100, 100, 100],
        longestSideCm: 100,
        battery: 'any',
        chargeMode: 'actual',
        volumetricDivisor: 12000,
        volumeDivisorMm3: 0,
      },
      pricing: {
        type: 'linear',
        baseFee: '10',
        stepSize: 100,
        stepFee: '1',
        minBillableUnits: 0,
      },
    },
  };
}

function remoteUsable() {
  const exactFingerprint = {
    origin: { countryUid: 'china', cityUid: 'xiamen' },
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    currency: 'CNY',
    declaredPriceMinor: 30000,
    package: {
      weight: { value: 500, unit: 'g' },
      dimensions: { length: 200, width: 100, height: 50, unit: 'mm' },
    },
    batteryInput: false,
  };
  return {
    state: 'healthy',
    quoteAllowed: true,
    bundle: {
      schemaVersion: 'ozon-logistics/delivery-v1',
      deploymentId: scope.deploymentId,
      assignmentId: scope.assignmentId,
      releaseId: 'release-a',
      releaseSequence: 3,
      contentChecksum: 'a'.repeat(64),
      effectiveChecksum: 'b'.repeat(64),
      validUntil: '2026-07-19T00:00:00.000Z',
      staleUntil: '2026-07-20T00:00:00.000Z',
      payload: {
        scope: {
          tenantId: scope.tenantSubject,
          shopId: scope.shopId,
          warehouseId: scope.warehouseId,
          ozonCompanyId: scope.ozonCompanyId,
          originCountryUid: scope.originCountryUid,
          originCityUid: scope.originCityUid,
          destinationCountryUid: scope.destinationCountryUid,
          destinationLocationUid: scope.destinationLocationUid,
        },
        revisionPayload: {
          scope: { ...scope },
          services: [service('route-a', '1'), service('route-b', '2'), service('route-c', '3')],
          formulas: [formula('route-a', '1'), formula('route-b', '2'), formula('route-c', '3')],
          selectedServiceKeys: ['route-a', 'route-b', 'route-c'],
          defaultServiceKeys: ['route-a', 'route-b'],
          destinationEvidence: [
            { stableServiceKey: 'route-a', destinationCountryUid: 'russia', destinationLocationUid: 'moscow' },
            { stableServiceKey: 'route-b', destinationCountryUid: 'russia', destinationLocationUid: 'moscow' },
            { stableServiceKey: 'route-c', destinationCountryUid: 'belarus', destinationLocationUid: 'minsk' },
          ],
          cityAvailabilityOverlays: [
            {
              origin: { countryUid: 'china', cityUid: 'xiamen' },
              destination: { countryUid: 'russia', locationUid: 'moscow' },
              services: [
                { stableServiceKey: 'route-a', isDropOff: true, clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'Moscow' }] },
                { stableServiceKey: 'route-b', isDropOff: false, clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'Moscow' }] },
              ],
            },
          ],
          officialSamples: [
            {
              fingerprint: exactFingerprint,
              tariffs: [
                {
                  ...service('route-a', '1'),
                  priceMinor: 2500,
                  currency: 'CNY',
                },
              ],
            },
          ],
        },
        manifest: {
          selectedServiceKeys: ['route-a', 'route-b', 'route-c'],
          defaultServiceKeys: ['route-a', 'route-b'],
          destination: {
            destinationCountryUid: 'russia',
            destinationLocationUid: 'moscow',
          },
        },
        deliveryMethodBindings: [
          { stableServiceKey: 'route-a' },
          { stableServiceKey: 'route-b' },
          { stableServiceKey: 'route-c' },
        ],
      },
    },
  };
}

test('remote release becomes a legacy-compatible calculator snapshot after every scope and eligibility filter', () => {
  const adapter = loadAdapter();
  const result = adapter.buildCalculatorState({
    usable: remoteUsable(),
    expectedScope: scope,
    requireLocalDropoff: true,
    localPreferences: {
      scope,
      userConfig: { selectedServiceIds: ['route-a', 'route-b'], resolutionMode: 'priority' },
      formState: { packingFee: 7, customFees: [{ name: 'service', amount: 3 }] },
    },
  });

  assert.equal(result.state, 'healthy');
  assert.equal(result.source, 'remote');
  assert.equal(result.quoteAllowed, true);
  assert.deepEqual(
    result.snapshot.catalogSnapshot.services.map((item) => item.id),
    ['route-a'],
  );
  assert.deepEqual(result.snapshot.ruleSnapshot.services.map((item) => item.serviceId), ['route-a']);
  assert.deepEqual(plain(result.snapshot.userConfig), {
    selectedServiceIds: ['route-a'],
    resolutionMode: 'priority',
  });
  assert.deepEqual(plain(result.snapshot.formState), {
    packingFee: 7,
    customFees: [{ name: 'service', amount: 3 }],
  });
  assert.equal(result.officialSnapshot.samples.length, 1);
  assert.equal(result.scope.destinationLocationUid, 'moscow');
  assert.equal(result.validUntil, '2026-07-19T00:00:00.000Z');
  assert.equal(result.staleUntil, '2026-07-20T00:00:00.000Z');
});

test('scope mismatches fail closed before any remote formula reaches the calculator', () => {
  const adapter = loadAdapter();
  const mutations = [
    (input) => { input.expectedScope.shopId = 'shop-b'; },
    (input) => { input.usable.bundle.payload.revisionPayload.scope.schemaMajor = 2; },
    (input) => {
      input.usable.bundle.payload.manifest.destination.destinationLocationUid = 'minsk';
    },
  ];
  for (const mutate of mutations) {
    const input = {
      usable: remoteUsable(),
      expectedScope: { ...scope },
      requireLocalDropoff: false,
    };
    mutate(input);
    assert.throws(() => adapter.buildCalculatorState(input), /scope mismatch/i);
  }
});

test('only an exact scoped fallback is usable and revocation never falls back', () => {
  const adapter = loadAdapter();
  const fallbackSnapshot = {
    schemaVersion: 'ozon-calculator/config-v1',
    userConfig: { selectedServiceIds: ['manual-route'], resolutionMode: 'lowest_cost' },
    catalogSnapshot: { services: [{ id: 'manual-route', displayName: 'Manual route' }] },
    ruleSnapshot: { services: [{ serviceId: 'manual-route', ruleId: 'manual-rule' }] },
  };
  const unscoped = adapter.buildCalculatorState({
    usable: { state: 'no_config', quoteAllowed: false },
    expectedScope: scope,
    localFallback: fallbackSnapshot,
  });
  assert.equal(unscoped.state, 'no_config');
  assert.equal(unscoped.quoteAllowed, false);

  const scoped = adapter.buildCalculatorState({
    usable: { state: 'no_config', quoteAllowed: false },
    expectedScope: scope,
    localFallback: { scope, snapshot: fallbackSnapshot },
  });
  assert.equal(scoped.state, 'local_fallback');
  assert.equal(scoped.source, 'local_fallback');
  assert.equal(scoped.quoteAllowed, true);

  const revoked = adapter.buildCalculatorState({
    usable: { state: 'revoked', quoteAllowed: false },
    expectedScope: scope,
    localFallback: { scope, snapshot: fallbackSnapshot },
  });
  assert.equal(revoked.state, 'revoked');
  assert.equal(revoked.source, 'none');
  assert.equal(revoked.quoteAllowed, false);
});

test('Official comparison requires the complete location, currency, price, package and battery fingerprint', () => {
  const adapter = loadAdapter();
  const state = adapter.buildCalculatorState({
    usable: remoteUsable(),
    expectedScope: scope,
    requireLocalDropoff: true,
  });
  const quote = {
    serviceId: 'route-a',
    providerId: '1',
    shippingCost: 30,
    displayName: 'ROUTE-A',
  };
  const exactInput = {
    logisticsScope: scope,
    currency: 'CNY',
    priceRMB: 300,
    weightG: 500,
    lenCm: 20,
    widCm: 10,
    hgtCm: 5,
    hasBattery: false,
  };
  const exact = adapter.attachExactOfficialSample(quote, state.officialSnapshot, exactInput);
  assert.equal(exact.officialSampleStatus, 'exact');
  assert.equal(exact.officialSamplePrice, 25);
  assert.equal(exact.officialSampleDiff, 5);

  for (const changed of [
    { priceRMB: 301 },
    { currency: 'RUB' },
    { weightG: 501 },
    { lenCm: 21 },
    { hasBattery: true },
    { logisticsScope: { ...scope, destinationLocationUid: 'minsk' } },
  ]) {
    const result = adapter.attachExactOfficialSample(
      quote,
      state.officialSnapshot,
      { ...exactInput, ...changed },
    );
    assert.equal(result.officialSampleStatus, 'unavailable');
    assert.equal(result.officialSamplePrice, undefined);
  }
});

async function loadConfigStore(values, clock = { now: '2026-07-13T00:00:00.000Z' }, featureEnabled = true) {
  const source = fs.readFileSync(
    'extensions/ss-erp/shared/config-bridge/config-store.js',
    'utf8',
  );
  class ClockDate extends Date {
    constructor(value) {
      super(arguments.length ? value : clock.now);
    }

    static now() {
      return Date.parse(clock.now);
    }
  }
  const context = {
    console,
    Date: ClockDate,
    window: {
      SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE: Object.freeze({
        enabled: featureEnabled,
      }),
    },
    chrome: {
      storage: {
        local: {
          async get(keys) {
            return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
          },
          async set(input) {
            Object.assign(values, input);
          },
        },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: 'config-store.js' });
  return context.window.OZON_CALC_CONFIG_STORE;
}

test('config store prioritizes the calculator adapter state without overwriting legacy preferences', async () => {
  const legacySnapshot = { userConfig: { selectedServiceIds: ['legacy'] } };
  const remoteSnapshot = { userConfig: { selectedServiceIds: ['route-a'] } };
  const officialSnapshot = { samples: [{ fingerprintKey: 'fp:v2:[]' }] };
  const values = {
    'ozon-calc:config-snapshot': legacySnapshot,
    'ss-erp:extension-device:credential:v1': {
      sessionId: 'session-a', deploymentId: scope.deploymentId,
      ownerUserId: scope.tenantSubject,
    },
    'ozon-logistics:calculator-state:v1': {
      state: 'stale',
      source: 'remote',
      quoteAllowed: true,
      scope,
      authority: {
        sessionId: 'session-a', deploymentId: scope.deploymentId,
        ownerUserId: scope.tenantSubject,
      },
      authorizationValidUntil: '2026-07-14T00:00:00.000Z',
      validUntil: '2026-07-12T00:00:00.000Z',
      staleUntil: '2026-07-20T00:00:00.000Z',
      route: {
        source: 'erp_assignment',
        assignmentId: scope.assignmentId,
        originCountryUid: scope.originCountryUid,
        originCityUid: scope.originCityUid,
        destinationCountryUid: scope.destinationCountryUid,
        destinationLocationUid: scope.destinationLocationUid,
        originLabel: 'China / Xiamen',
        destinationLabel: 'Russia / Moscow',
      },
      snapshot: remoteSnapshot,
      officialSnapshot,
      releaseId: 'release-a',
      releaseSequence: 3,
    },
  };
  const store = await loadConfigStore(values);
  const result = await store.readSnapshot();

  assert.deepEqual(plain(result.snapshot), remoteSnapshot);
  assert.equal(result.logisticsStatus.state, 'stale');
  assert.equal(result.logisticsStatus.source, 'remote');
  assert.equal(result.logisticsStatus.route.originLabel, 'China / Xiamen');
  assert.equal(result.logisticsStatus.route.destinationLabel, 'Russia / Moscow');
  assert.deepEqual(plain(await store.readOfficialSnapshot()), officialSnapshot);
  assert.deepEqual(values['ozon-calc:config-snapshot'], legacySnapshot);

  values['ozon-logistics:calculator-state:v1'] = {
    state: 'revoked',
    source: 'none',
    quoteAllowed: false,
    snapshot: null,
    officialSnapshot: null,
  };
  const revoked = await store.readSnapshot();
  assert.equal(revoked.snapshot, null);
  assert.equal(revoked.logisticsStatus.state, 'revoked');
});

test('config store ignores cached remote rules when rollout feature is disabled', async () => {
  const legacySnapshot = { userConfig: { selectedServiceIds: ['manual-route'] } };
  const legacyOfficial = { tariffs: [{ id: 'manual-sample' }] };
  const values = {
    'ozon-calc:config-snapshot': legacySnapshot,
    'ozon-calculator:official-snapshot': legacyOfficial,
    'ozon-logistics:calculator-state:v1': {
      state: 'healthy',
      source: 'remote',
      quoteAllowed: true,
      snapshot: { userConfig: { selectedServiceIds: ['cached-remote-route'] } },
      officialSnapshot: { samples: [{ id: 'cached-remote-sample' }] },
    },
  };
  const store = await loadConfigStore(values, undefined, false);
  const result = await store.readSnapshot();
  assert.deepEqual(plain(result.snapshot), legacySnapshot);
  assert.equal(result.logisticsStatus, null);
  assert.deepEqual(plain(await store.readOfficialSnapshot()), legacyOfficial);
});

test('config store revalidates freshness, authorization, and device session on every read', async () => {
  const clock = { now: '2026-07-13T12:15:00.000Z' };
  const remoteSnapshot = { userConfig: { selectedServiceIds: ['route-a'] } };
  const officialSnapshot = { samples: [{ fingerprintKey: 'fp:v2:[]' }] };
  const values = {
    'ss-erp:extension-device:credential:v1': {
      sessionId: 'session-a', deploymentId: scope.deploymentId,
      ownerUserId: scope.tenantSubject,
    },
    'ozon-logistics:calculator-state:v1': {
      state: 'healthy', source: 'remote', quoteAllowed: true, scope,
      authority: {
        sessionId: 'session-a', deploymentId: scope.deploymentId,
        ownerUserId: scope.tenantSubject,
      },
      authorizationValidUntil: '2026-07-13T13:00:00.000Z',
      validUntil: '2026-07-13T12:10:00.000Z',
      staleUntil: '2026-07-13T12:20:00.000Z',
      snapshot: remoteSnapshot,
      officialSnapshot,
    },
  };
  const store = await loadConfigStore(values, clock);

  const stale = await store.readSnapshot();
  assert.deepEqual(plain(stale.snapshot), remoteSnapshot);
  assert.equal(stale.logisticsStatus.state, 'stale');

  clock.now = '2026-07-13T12:21:00.000Z';
  const expired = await store.readSnapshot();
  assert.equal(expired.snapshot, null);
  assert.equal(expired.logisticsStatus.state, 'expired');
  assert.equal(await store.readOfficialSnapshot(), null);

  clock.now = '2026-07-13T12:05:00.000Z';
  values['ss-erp:extension-device:credential:v1'].sessionId = 'session-b';
  const superseded = await store.readSnapshot();
  assert.equal(superseded.snapshot, null);
  assert.equal(superseded.logisticsStatus.state, 'session_mismatch');

  delete values['ss-erp:extension-device:credential:v1'];
  const unpaired = await store.readSnapshot();
  assert.equal(unpaired.snapshot, null);
  assert.equal(unpaired.logisticsStatus.state, 'unpaired');
  assert.equal(await store.readOfficialSnapshot(), null);

  values['ss-erp:extension-device:credential:v1'] = {
    sessionId: 'session-a', deploymentId: scope.deploymentId,
    ownerUserId: scope.tenantSubject,
  };
  clock.now = '2026-07-13T13:05:00.001Z';
  const authorizationExpired = await store.readSnapshot();
  assert.equal(authorizationExpired.snapshot, null);
  assert.equal(authorizationExpired.logisticsStatus.state, 'authorization_expired');
});

test('Ozon panel consumes adapter status and delegates only exact Official comparison', () => {
  const source = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');
  assert.match(
    source,
    /OZON_CALC_LOGISTICS_RELEASE_ADAPTER[\s\S]*attachExactOfficialSample/,
  );
  assert.match(source, /state\.logisticsStatus\s*=\s*result\.logisticsStatus/);
  assert.match(
    source,
    /state\.logisticsStatus[\s\S]*quoteAllowed[\s\S]*无法进行权威核价/,
  );
});
