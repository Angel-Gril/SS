import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadHarImporter() {
  const source = fs.readFileSync('extensions/ss-erp/shared/calculator-core/har-import.js', 'utf8');
  const context = { console, URL, globalThis: {} };
  vm.runInNewContext(source, context, { filename: 'har-import.js' });
  return context.globalThis.OZON_CALC_HAR_IMPORT;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function officialEntry(url, request, tariffs, capturedAt, pageUrl = 'https://globalcalculator.ozon.ru/tax-calculator') {
  return {
    startedDateTime: capturedAt,
    _ozonCalc: {
      pageUrl,
    },
    request: {
      method: 'POST',
      url,
      postData: { text: JSON.stringify(request) },
    },
    response: {
      status: 200,
      content: { text: JSON.stringify({ tariffs }) },
    },
  };
}

test('official importer retains every exact freight calculate request and ignores calculate-tax', () => {
  const importer = loadHarImporter();
  const requestBase = {
    height: 90,
    width: 160,
    length: 180,
    weight: 498,
    price: 3000,
    currency: 'CNY',
    countryUid: 'china',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
  };
  const payload = {
    log: {
      entries: [
        officialEntry('/p-api/tpl-api-global-calc-gw/v1/calculator/calculate', {
          ...requestBase,
          cityUid: 'xiamen',
        }, [{ providerId: '1', description: 'Xiamen route', price: 10 }], '2026-07-12T00:00:00.000Z'),
        officialEntry('/p-api/tpl-api-global-calc-gw/v1/calculator/calculate-tax', {
          ...requestBase,
          cityUid: 'xiamen',
        }, [{ providerId: 'tax', description: 'Tax is not freight', price: 99 }], '2026-07-12T00:00:01.000Z'),
        officialEntry('/p-api/tpl-api-global-calc-gw/v1/calculator/calculate', {
          ...requestBase,
          cityUid: 'shenzhen',
        }, [{ providerId: '1', description: 'Shenzhen route', price: 11 }], '2026-07-12T00:00:02.000Z'),
        officialEntry('https://evil.example/p-api/tpl-api-global-calc-gw/v1/calculator/calculate', {
          ...requestBase,
          cityUid: 'forged',
        }, [{ providerId: 'evil', description: 'Forged route', price: 1 }], '2026-07-12T00:00:03.000Z'),
      ],
    },
  };

  const result = importer.importOfficialHar(payload);

  assert.equal(result.samples.length, 2);
  assert.deepEqual(
    result.samples.map((sample) => sample.request.origin.cityUid),
    ['xiamen', 'shenzhen'],
  );
  assert.deepEqual(
    result.samples.map((sample) => sample.tariffs[0].providerId),
    ['1', '1'],
  );
});

test('official importer rejects a tax-only HAR as missing freight data', () => {
  const importer = loadHarImporter();
  const payload = {
    log: {
      entries: [
        officialEntry('/p-api/tpl-api-global-calc-gw/v1/calculator/calculate-tax', {
          height: 90,
          width: 160,
          length: 180,
          weight: 498,
          price: 3000,
          currency: 'CNY',
          cityUid: 'xiamen',
        }, [{ providerId: 'tax', price: 99 }], '2026-07-12T00:00:00.000Z'),
      ],
    },
  };

  assert.throws(
    () => importer.importOfficialHar(payload),
    /缺少 calculator\/calculate 响应/,
  );
});
test('official samples retain a complete location and product fingerprint with raw availability overlays', () => {
  const importer = loadHarImporter();
  const payload = {
    log: {
      entries: [
        officialEntry('/p-api/tpl-api-global-calc-gw/v1/calculator/calculate', {
          height: 90,
          width: 160,
          length: 180,
          weight: 498,
          price: 3000,
          currency: 'CNY',
          countryUid: 'china',
          cityUid: 'xiamen',
          destinationCountryUid: 'russia',
          destinationLocationUid: 'moscow',
        }, [{
          id: 'regenerated-response-id',
          providerId: '1778',
          providerName: 'ATC Express Premium Small',
          description: 'ATC Express Premium Small to Ozon pick-up point',
          price: 46.19,
          rating: null,
          weightType: 'weight',
          deliverySpeed: null,
          isDropOff: true,
          hasBattery: false,
          templateType: 'global',
          clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'A' }],
        }], '2026-07-12T00:00:00.000Z'),
      ],
    },
  };

  const sample = importer.importOfficialHar(payload).samples[0];

  assert.deepEqual(plain(sample.request), {
    origin: { countryUid: 'china', cityUid: 'xiamen' },
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    currency: 'CNY',
    declaredPrice: 3000,
    package: {
      weight: { value: 498, unit: 'g' },
      dimensions: { length: 180, width: 160, height: 90, unit: 'mm' },
    },
    batteryInput: null,
  });
  assert.equal(typeof sample.fingerprintKey, 'string');
  assert.ok(sample.fingerprintKey.includes('xiamen'));
  assert.deepEqual(plain(sample.tariffs[0]), {
    stableServiceKey: '1778|atc express premium small to ozon pick-up point|global|weight|no-battery',
    providerId: '1778',
    providerName: 'ATC Express Premium Small',
    description: 'ATC Express Premium Small to Ozon pick-up point',
    price: 46.19,
    currency: 'CNY',
    weightType: 'weight',
    hasBattery: false,
    isDropOff: true,
    templateType: 'global',
    clusterDeliverySpeeds: [{ min: 12, max: 19, clusterName: 'A' }],
    deliverySpeed: null,
    rating: null,
  });
});

test('seller import retains observed company and query point without claiming an ERP warehouse', () => {
  const importer = loadHarImporter();
  const payload = {
    log: {
      entries: [{
        startedDateTime: '2026-07-12T00:00:00.000Z',
        request: {
          method: 'POST',
          url: 'https://seller.ozon.ru/api/delivery-method-service/v2/provider/template/by-location/list',
          postData: {
            text: JSON.stringify({
              available_integration_type: 1,
              company_id: '4494016',
              point: { latitude: 24.480107, longitude: 118.085348 },
            }),
          },
        },
        response: {
          status: 200,
          content: { text: JSON.stringify({ provider_templates: [] }) },
        },
      }],
    },
  };

  const result = importer.importSellerHar(payload);

  assert.deepEqual(plain(result.observedContext), {
    companyId: '4494016',
    availableIntegrationType: 1,
    queryPoint: { latitude: 24.480107, longitude: 118.085348 },
    locationStatus: 'coordinates_only',
  });
  assert.equal(result.observedContext.shopId, undefined);
  assert.equal(result.observedContext.warehouseId, undefined);
});
function loadOfficialExporter() {
  const source = fs.readFileSync('extensions/ss-erp/shared/official-freight/official-freight-export.js', 'utf8');
  const context = { console, globalThis: {} };
  vm.runInNewContext(source, context, { filename: 'official-freight-export.js' });
  return context.globalThis.OZON_CALC_OFFICIAL_FREIGHT_EXPORT;
}

test('official exporter labels request dimensions as millimetres and inherits request currency', () => {
  const exporter = loadOfficialExporter();
  const entry = officialEntry('/p-api/tpl-api-global-calc-gw/v1/calculator/calculate', {
    height: 90,
    width: 160,
    length: 180,
    weight: 498,
    price: 3000,
    currency: 'CNY',
    countryUid: 'china',
    cityUid: 'xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
  }, [{
    providerId: '1778',
    providerName: 'ATC Express Premium Small',
    description: 'ATC route',
    price: 46.19,
  }], '2026-07-12T00:00:00.000Z');

  const sample = plain(exporter.extractOfficialFreightSamplesFromEntries([entry]))[0];

  assert.equal(sample.currency, 'CNY');
  assert.equal(sample.weightG, 498);
  assert.deepEqual(
    { lengthMm: sample.lengthMm, widthMm: sample.widthMm, heightMm: sample.heightMm },
    { lengthMm: 180, widthMm: 160, heightMm: 90 },
  );
  assert.equal('lengthCm' in sample, false);
  assert.deepEqual(sample.origin, { countryUid: 'china', cityUid: 'xiamen' });
  assert.deepEqual(sample.destination, { countryUid: 'russia', locationUid: 'moscow' });
  const csvHeader = exporter.exportOfficialFreightAsCsv([sample]).split('\n')[0].split(',');
  assert.ok(csvHeader.includes('lengthMm'));
  assert.ok(csvHeader.includes('originCityUid'));
  assert.ok(csvHeader.includes('destinationLocationUid'));
  assert.equal(csvHeader.includes('lengthCm'), false);
});
test('sanitized cumulative Official fixture retains 25 requests across 15 origins with 63 tariffs each', () => {
  const importer = loadHarImporter();
  const payload = JSON.parse(
    fs.readFileSync('scripts/fixtures/ozon-logistics/official-cumulative-25.sanitized.har.json', 'utf8'),
  );

  const result = importer.importOfficialHar(payload);

  assert.equal(result.samples.length, 25);
  assert.equal(new Set(result.samples.map((sample) => sample.request.origin.cityUid)).size, 15);
  assert.equal(result.samples.every((sample) => sample.request.currency === 'CNY'), true);
  assert.equal(result.samples.every((sample) => sample.tariffs.length === 63), true);
  assert.equal(
    result.samples.at(-1).tariffs.filter((tariff) => tariff.clusterDeliverySpeeds.length > 0).length,
    54,
  );
});
function loadSellerExporter() {
  const source = fs.readFileSync('extensions/ss-erp/shared/seller-logistics/seller-logistics-export.js', 'utf8');
  const context = { console, globalThis: {} };
  vm.runInNewContext(source, context, { filename: 'seller-logistics-export.js' });
  return context.globalThis.OZON_CALC_SELLER_LOGISTICS_EXPORT;
}

function sellerTemplateEntry(companyId, point, templateId) {
  return {
    startedDateTime: '2026-07-12T00:00:00.000Z',
    request: {
      method: 'POST',
      url: 'https://seller.ozon.ru/api/delivery-method-service/v2/provider/template/by-location/list',
      postData: {
        text: JSON.stringify({
          available_integration_type: 1,
          company_id: companyId,
          point,
        }),
      },
    },
    response: {
      status: 200,
      content: {
        text: JSON.stringify({
          provider_templates: [{
            template_id: templateId,
            provider_id: 1778,
            provider_name: 'ATC',
            template_name: 'ATC route',
          }],
        }),
      },
    },
  };
}

test('seller capture export retains one observed company and query point', () => {
  const exporter = loadSellerExporter();
  const capture = plain(exporter.extractSellerLogisticsCaptureFromEntries([
    sellerTemplateEntry('4494016', { latitude: 24.480107, longitude: 118.085348 }, 100),
  ]));

  assert.equal(capture.quarantined, false);
  assert.deepEqual(capture.observedContext, {
    companyId: '4494016',
    availableIntegrationType: 1,
    queryPoint: { latitude: 24.480107, longitude: 118.085348 },
    locationStatus: 'coordinates_only',
  });
  assert.equal(capture.templates.length, 1);
});

test('seller capture export quarantines entries with conflicting company or point contexts', () => {
  const exporter = loadSellerExporter();
  const capture = plain(exporter.extractSellerLogisticsCaptureFromEntries([
    sellerTemplateEntry('4494016', { latitude: 24.480107, longitude: 118.085348 }, 100),
    sellerTemplateEntry('other-company', { latitude: 22.5, longitude: 114.1 }, 200),
  ]));

  assert.equal(capture.quarantined, true);
  assert.equal(capture.templates.length, 0);
  assert.match(capture.errors.join(' '), /上下文冲突/);
});
function loadCaptureStore() {
  const source = fs.readFileSync('extensions/ss-erp/shared/capture-bridge/captured-har-store.js', 'utf8');
  const context = { console, URL, globalThis: {} };
  vm.runInNewContext(source, context, { filename: 'captured-har-store.js' });
  return context.globalThis.OZON_CALC_CAPTURE_STORE;
}

test('capture store accepts only the exact Official freight host and path', () => {
  const store = loadCaptureStore();
  const pageUrl = 'https://globalcalculator.ozon.ru/tax-calculator';

  assert.equal(
    store.detectSupportedEndpoint(
      '/p-api/tpl-api-global-calc-gw/v1/calculator/calculate',
      { method: 'POST' },
      pageUrl,
    ).mode,
    'official',
  );
  assert.equal(
    store.detectSupportedEndpoint(
      '/p-api/tpl-api-global-calc-gw/v1/calculator/calculate-tax',
      { method: 'POST' },
      pageUrl,
    ),
    null,
  );
  assert.equal(
    store.detectSupportedEndpoint(
      'https://evil.example/p-api/tpl-api-global-calc-gw/v1/calculator/calculate',
      { method: 'POST' },
      pageUrl,
    ),
    null,
  );
});
