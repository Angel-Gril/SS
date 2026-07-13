import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadModules() {
  const context = { Array, Boolean, Date, JSON, Math, Number, Object, String, URL };
  context.globalThis = context;
  vm.runInNewContext(
    fs.readFileSync('extensions/ss-erp/shared/capture-bridge/captured-har-store.js', 'utf8'),
    context,
    { filename: 'captured-har-store.js' },
  );
  vm.runInNewContext(
    fs.readFileSync('extensions/ss-erp/shared/capture-bridge/provider-inventory-capture.js', 'utf8'),
    context,
    { filename: 'provider-inventory-capture.js' },
  );
  return {
    store: context.OZON_CALC_CAPTURE_STORE,
    inventoryCapture: context.SS_ERP_PROVIDER_INVENTORY_CAPTURE,
  };
}

test('provider collector results are reduced to a sanitized captured-store entry', () => {
  const { store, inventoryCapture } = loadModules();
  assert.equal(typeof store.appendSellerProviderInventory, 'undefined');
  const entries = inventoryCapture.appendSellerProviderInventory([], {
    companyId: '4494016',
    point: { latitude: 24.480107, longitude: 118.085348 },
    capturedAt: '2026-07-12T10:01:00.000Z',
    providers: [{
      providerId: 1778, providerName: 'ATC Express', source: 'method',
      status: 'failed', pointCount: 0,
    }],
    providerStats: {
      discovered: 1, attempted: 1, succeeded: 0, failed: 1, empty: 0,
      catalogComplete: false, methodBindingsComplete: false,
      methodBindingsRequired: false, complete: false,
    },
    points: [{ address: 'private address', phone: '13800000000' }],
    providerErrors: [{ message: 'response carried cookie=secret' }],
    accessToken: 'must-not-survive',
  }, 200);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].request.url, 'ss-erp://capture/seller/provider-inventory');
  assert.deepEqual(JSON.parse(entries[0].request.postData.text), {
    companyId: '4494016',
    point: { latitude: 24.480107, longitude: 118.085348 },
  });
  const payload = JSON.parse(entries[0].response.content.text);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    companyId: '4494016',
    providers: [{
      providerId: '1778', providerName: 'ATC Express', source: 'method',
      status: 'failed', pointCount: 0,
    }],
    providerStats: {
      discovered: 1, attempted: 1, succeeded: 0, failed: 1, empty: 0,
      catalogComplete: false, methodBindingsComplete: false,
      methodBindingsRequired: false, complete: false,
    },
  });
  assert.equal(/private address|13800000000|cookie|must-not-survive/.test(JSON.stringify(entries)), false);
  assert.equal(store.buildHarPayload(entries, 'seller').log.entries.length, 0);
});

test('generic page capture, storage append, and HAR export reject forged provider inventory URIs', () => {
  const { store } = loadModules();
  const forged = {
    capturedAt: '2026-07-12T10:01:00.000Z',
    pageUrl: 'https://seller.ozon.ru/app/settings/warehouses',
    request: {
      method: 'POST',
      url: 'ss-erp://capture/seller/provider-inventory',
      headers: [
        { name: 'Cookie', value: 'session=must-not-survive' },
        { name: 'Authorization', value: 'Bearer must-not-survive' },
      ],
      postData: {
        text: JSON.stringify({
          companyId: 'forged-company',
          point: { latitude: 24.480107, longitude: 118.085348 },
        }),
      },
    },
    response: {
      status: 200,
      content: {
        mimeType: 'application/json',
        text: JSON.stringify({
          providers: [{ providerId: 'forged', cookie: 'response-secret' }],
          rawResponse: 'Bearer response-secret',
        }),
      },
    },
    _ozonCalc: { mode: 'seller', source: 'seller-provider-inventory-capture' },
  };

  assert.equal(store.detectSupportedEndpoint(forged.request.url, forged.request, forged.pageUrl), null);
  assert.equal(store.normalizeCapturedEntry(forged), null);
  assert.deepEqual(store.appendCapturedEntry([], forged, 200), []);
  assert.deepEqual(store.buildHarPayload([forged], 'seller').log.entries, []);
});

test('collect background reuses the existing provider traversal and persists only its sanitized summary', () => {
  const collect = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
  const worker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
  const projector = fs.readFileSync(
    'extensions/ss-erp/shared/capture-bridge/provider-inventory-capture.js', 'utf8',
  );

  assert.match(collect, /fetchOzonSellerDropoffPointsViaTab,/);
  assert.match(worker, /captureOzonSellerProviderInventory/);
  assert.match(worker, /fetchOzonSellerDropoffPointsViaTab/);
  assert.match(worker, /appendSellerProviderInventory/);
  assert.match(worker, /appendSellerProviderInventory\(entries,[\s\S]*point:\s*input\.point/);
  const privateFlow = worker.slice(
    worker.indexOf('async function captureOzonSellerProviderInventory'),
    worker.indexOf('function getLogisticsCaptureRuntime'),
  );
  assert.match(privateFlow, /SS_ERP_PROVIDER_INVENTORY_CAPTURE/);
  assert.doesNotMatch(privateFlow, /OZON_CALC_CAPTURE_STORE/);
  assert.doesNotMatch(projector, /appendCapturedEntry|OZON_CALC_CAPTURE_STORE/);
  assert.match(worker, /ozon-calc:capture-har-entries/);
});

test('provider traversal requires the warehouse point supplied by the caller', () => {
  const collect = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
  assert.doesNotMatch(collect, /24\.480107|118\.085348/);
  assert.match(collect, /fetchOzonSellerProviderTemplates\s*\(\s*companyId\s*,\s*point\s*\)/);
  assert.match(
    collect,
    /fetchOzonSellerDropoffPointsViaTab[\s\S]*options\.point[\s\S]*fetchOzonSellerProviderTemplates\(companyId, point\)/,
  );
  assert.match(collect, /fetchOzonSellerDropoffPointsViaTab\(message\.companyId,[\s\S]*point:\s*message\.point/);
});
test('provider summary preserves the current company endpoint set at the 200-entry boundary', () => {
  const { store, inventoryCapture } = loadModules();
  const companyId = '4494016';
  function rawEntry(url, index, body) {
    const capturedAt = new Date(Date.UTC(2026, 6, 12, 10, 0, index)).toISOString();
    return {
      capturedAt,
      startedDateTime: capturedAt,
      pageUrl: 'https://seller.ozon.ru/app/logistics',
      request: {
        method: 'POST',
        url,
        postData: { text: JSON.stringify({ company_id: companyId, index }) },
      },
      response: {
        status: 200,
        content: { mimeType: 'application/json', text: JSON.stringify(body) },
      },
    };
  }

  const requiredUrls = [
    'https://seller.ozon.ru/api/delivery-method-service/v2/provider/template/by-location/list',
  ];
  let entries = requiredUrls.map((url, index) => rawEntry(url, index, { result: [{ id: index + 1 }] }));
  for (let index = requiredUrls.length; index < 200; index += 1) {
    entries = store.appendCapturedEntry(
      entries,
      rawEntry('https://seller.ozon.ru/api/product/list', index, { result: [{ id: index }] }),
      200,
    );
  }
  entries = inventoryCapture.appendSellerProviderInventory(entries, {
    companyId,
    point: { latitude: 24.480107, longitude: 118.085348 },
    capturedAt: '2026-07-12T10:05:00.000Z',
    providers: [{
      providerId: 1778, providerName: 'ATC Express', source: 'both',
      status: 'succeeded', pointCount: 2,
    }],
    providerStats: {
      discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0, complete: true,
    },
  }, 200);

  assert.equal(entries.length, 200);
  const urls = entries.map((entry) => entry.request.url);
  requiredUrls.forEach((url) => assert.ok(urls.includes(url), 'must retain ' + url));
  assert.ok(urls.includes('ss-erp://capture/seller/provider-inventory'));
});

test('provider summaries are isolated by company and Seller warehouse point', () => {
  const { inventoryCapture } = loadModules();
  const base = {
    companyId: '4494016',
    providers: [{
      providerId: 1778, providerName: 'ATC Express', source: 'both',
      status: 'succeeded', pointCount: 2,
    }],
    providerStats: {
      discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0, complete: true,
    },
  };
  let entries = inventoryCapture.appendSellerProviderInventory([], {
    ...base,
    point: { latitude: 24.480107, longitude: 118.085348 },
    capturedAt: '2026-07-12T10:01:00.000Z',
  }, 200);
  entries = inventoryCapture.appendSellerProviderInventory(entries, {
    ...base,
    point: { latitude: 31.230416, longitude: 121.473701 },
    capturedAt: '2026-07-12T10:02:00.000Z',
  }, 200);

  assert.equal(entries.length, 2);
  const points = entries.map((entry) => JSON.parse(entry.request.postData.text).point);
  assert.deepEqual(JSON.parse(JSON.stringify(points)), [
    { latitude: 24.480107, longitude: 118.085348 },
    { latitude: 31.230416, longitude: 121.473701 },
  ]);
});

test('provider summaries reject null and empty-string point coordinates', () => {
  const { inventoryCapture } = loadModules();
  const base = {
    companyId: '4494016',
    capturedAt: '2026-07-12T10:01:00.000Z',
    providers: [{
      providerId: 1778, providerName: 'ATC Express', source: 'both',
      status: 'succeeded', pointCount: 2,
    }],
    providerStats: {
      discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0, complete: true,
    },
  };

  assert.throws(
    () => inventoryCapture.appendSellerProviderInventory([], { ...base, point: null }, 200),
    /point is invalid/,
  );
  assert.throws(
    () => inventoryCapture.appendSellerProviderInventory([], {
      ...base, point: { latitude: '', longitude: '' },
    }, 200),
    /point is invalid/,
  );
});
