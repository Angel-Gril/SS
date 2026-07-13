import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(
  'extensions/ss-erp/shared/logistics-rules/distribution-schema.js',
  'utf8',
);

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalObject(value[key])]),
  );
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonicalObject(value))).digest('hex');
}

function loadSchema() {
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise,
    TextEncoder, crypto: webcrypto,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'distribution-schema.js' });
  return context.SS_ERP_LOGISTICS_DISTRIBUTION_SCHEMA;
}

async function envelope() {
  const schema = loadSchema();
  const revisionPayload = {
    schema: 'ozon-logistics-release-content/v1',
    scope: {
      deploymentId: 'local-dev',
      apiOrigin: 'https://erp.example',
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      ozonCompanyId: 'company-a',
      erpWarehouseId: 'warehouse-a',
      platformWarehouseId: 'ozon-warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      destinationCountryUid: 'russia',
      destinationLocationUid: 'moscow',
      schemaMajor: 1,
    },
    sellerContext: { companyId: 'company-a' },
    sources: [{ kind: 'seller', checksum: '1'.repeat(64) }],
    services: [{ stableServiceKey: 'service-1' }],
    formulas: [{ stableServiceKey: 'service-1', pricing: { baseFeeMinor: '1000' } }],
    officialSamples: [],
    cityAvailabilityOverlays: [],
    destinationEvidence: [{ stableServiceKey: 'service-1' }],
    providerInventory: { discovered: 1, attempted: 1, succeeded: 1, failed: 0, empty: 0 },
    selectedServiceKeys: ['service-1'],
    defaultServiceKeys: ['service-1'],
    officialPolicy: {
      activeSourceRevision: 'official-r1',
      activeBatchChecksum: '1'.repeat(64),
      freshnessCutoff: '2026-07-05T12:00:00.000Z',
    },
    validationMatrixInput: {
      generatedAt: '2026-07-12T12:00:00.000Z',
      selectedFormulas: [],
    },
    validationMatrix: { requirements: [] },
    candidateSetChecksum: '2'.repeat(64),
    validUntil: '2026-07-19T12:00:00.000Z',
    staleUntil: '2026-07-20T12:00:00.000Z',
    minExtensionVersion: '1.0.0',
  };
  const contentChecksum = await schema.sha256CanonicalValue(revisionPayload);
  const payload = {
    scope: {
      channelId: 'channel-a',
      scopeKey: 'scope-a',
      tenantId: 'tenant-a',
      deploymentId: 'local-dev',
      schemaMajor: 1,
      shopId: 'shop-a',
      warehouseId: 'warehouse-a',
      ozonCompanyId: 'company-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      originCountryCode: 'CN',
      destinationCountryUid: 'russia',
      destinationLocationUid: 'moscow',
      destinationLabel: 'Russia / Moscow',
      destinationCountryCode: 'RU',
    },
    revisionPayload,
    manifest: {
      schemaVersion: '1',
      minimumExtensionVersion: '1.0.0',
      destination: {
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        destinationLabel: 'Russia / Moscow',
        destinationCountryCode: 'RU',
      },
      selectedServiceKeys: ['service-1'],
      defaultServiceKeys: ['service-1'],
      deliveryMethodBindingIds: ['binding-1'],
      officialResolutions: [],
      routeClassifications: { 'service-1': 'official_exact_sample' },
      validationReport: { blockers: [] },
      revisionId: 'revision-1',
    },
    assignment: {
      id: 'assignment-a',
      destinationCountryUid: 'russia',
      destinationCountryCode: 'RU',
      destinationLocationUid: 'moscow',
      destinationLabel: 'Russia / Moscow',
    },
    deliveryMethodBindings: [{ id: 'binding-1', stableServiceKey: 'service-1' }],
    officialResolutions: [],
  };
  const releaseSequence = 1;
  const effectiveChecksum = hash({
    sequence: releaseSequence,
    channelId: payload.scope.channelId,
    scopeKey: payload.scope.scopeKey,
    contentChecksum,
    frozenPayload: payload,
  });
  return {
    schema,
    value: {
      schemaVersion: 'ozon-logistics/delivery-v1',
      deploymentId: 'local-dev',
      assignmentId: 'assignment-a',
      releaseId: 'release-1',
      releaseSequence,
      contentChecksum,
      effectiveChecksum,
      minExtensionVersion: '1.0.0',
      validUntil: revisionPayload.validUntil,
      staleUntil: revisionPayload.staleUntil,
      payload,
    },
  };
}

test('validates both portable content and scope-bound effective checksums', async () => {
  const { schema, value } = await envelope();
  const result = await schema.validateDeliveryEnvelope(value);

  assert.equal(result.valid, true, result.errors && result.errors.join('; '));
  assert.equal(result.bundle.releaseId, 'release-1');
});

test('rejects payload tampering and assignment scope mismatches', async () => {
  const first = await envelope();
  first.value.payload.revisionPayload.formulas[0].pricing.baseFeeMinor = '9999';
  const tampered = await first.schema.validateDeliveryEnvelope(first.value);

  const second = await envelope();
  second.value.assignmentId = 'assignment-b';
  const wrongAssignment = await second.schema.validateDeliveryEnvelope(second.value);

  assert.equal(tampered.valid, false);
  assert.match(tampered.errors.join(' '), /content checksum/i);
  assert.equal(wrongAssignment.valid, false);
  assert.match(wrongAssignment.errors.join(' '), /assignment/i);
});

test('rejects unknown fields, credential material, and inconsistent frozen scope', async () => {
  const unknown = await envelope();
  unknown.value.unexpected = true;
  const unknownResult = await unknown.schema.validateDeliveryEnvelope(unknown.value);
  const unknownRevision = await envelope();
  unknownRevision.value.payload.revisionPayload.unexpected = true;
  const unknownRevisionResult =
    await unknownRevision.schema.validateDeliveryEnvelope(unknownRevision.value);

  const credential = await envelope();
  credential.value.payload.revisionPayload.formulas[0].authorization = 'Bearer secret';
  const credentialResult = await credential.schema.validateDeliveryEnvelope(credential.value);

  const wrongScope = await envelope();
  wrongScope.value.payload.scope.shopId = 'shop-b';
  const wrongScopeResult = await wrongScope.schema.validateDeliveryEnvelope(wrongScope.value);
  const wrongSchema = await envelope();
  wrongSchema.value.payload.scope.schemaMajor = 2;
  const wrongSchemaResult =
    await wrongSchema.schema.validateDeliveryEnvelope(wrongSchema.value);

  assert.equal(unknownResult.valid, false);
  assert.match(unknownResult.errors.join(' '), /unknown/i);
  assert.equal(credentialResult.valid, false);
  assert.equal(unknownRevisionResult.valid, false);
  assert.match(unknownRevisionResult.errors.join(' '), /revisionPayload.*unknown/i);
  assert.match(credentialResult.errors.join(' '), /credential|authorization/i);
  assert.equal(wrongScopeResult.valid, false);
  assert.match(wrongScopeResult.errors.join(' '), /scope|shop/i);
  assert.equal(wrongSchemaResult.valid, false);
  assert.match(wrongSchemaResult.errors.join(' '), /schemaMajor|schema major/i);
});

test('rejects inconsistent compatibility and freshness metadata', async () => {
  const version = await envelope();
  version.value.minExtensionVersion = '2.0.0';
  const versionResult = await version.schema.validateDeliveryEnvelope(version.value);

  const freshness = await envelope();
  freshness.value.staleUntil = '2026-07-18T12:00:00.000Z';
  const freshnessResult = await freshness.schema.validateDeliveryEnvelope(freshness.value);

  assert.equal(versionResult.valid, false);
  assert.match(versionResult.errors.join(' '), /version/i);
  assert.equal(freshnessResult.valid, false);
  assert.match(freshnessResult.errors.join(' '), /stale|freshness/i);
});

test('rejects deeply nested and oversized delivery payloads before activation', async () => {
  const deep = await envelope();
  let cursor = deep.value.payload.revisionPayload.formulas[0];
  for (let index = 0; index < 70; index += 1) {
    cursor.nested = {};
    cursor = cursor.nested;
  }
  const deepResult = await deep.schema.validateDeliveryEnvelope(deep.value);

  const oversized = await envelope();
  oversized.value.payload.revisionPayload.formulas[0].pricing.note = 'x'.repeat(300_001);
  const oversizedResult = await oversized.schema.validateDeliveryEnvelope(oversized.value);

  assert.equal(deepResult.valid, false);
  assert.match(deepResult.errors.join(' '), /depth|budget/i);
  assert.equal(oversizedResult.valid, false);
  assert.match(oversizedResult.errors.join(' '), /string|budget|size/i);
});
