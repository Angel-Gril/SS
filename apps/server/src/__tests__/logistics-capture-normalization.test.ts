import { describe, expect, it } from 'vitest';
import { buildOzonStableServiceKey } from 'shared';
import {
  CAPTURE_TASK_VERSION,
  OFFICIAL_CAPTURE_SCHEMA,
  SELLER_CAPTURE_SCHEMA,
  createLogisticsCaptureTaskService,
  type LogisticsCaptureAuthority,
  type LogisticsCaptureCandidateInput,
  type LogisticsCaptureScope,
  type LogisticsCaptureTask,
  type OfficialCaptureFingerprint,
} from '../services/logistics-capture-task.js';

const NOW = new Date('2026-07-12T10:00:00.000Z');
const SCOPE: LogisticsCaptureScope = {
  tenantId: 'tenant-a',
  shopId: 'shop-a',
  companyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
};
const ENDPOINTS = [
  'seller/template/by-location',
  'seller/provider-inventory',
];
const SERVICE_KEY = buildOzonStableServiceKey({
  providerId: 'provider-ru',
  description: 'ATC pickup',
  templateType: 'door_to_door',
  weightType: 'actual',
  batteryMode: 'no-battery',
});
const RULE = {
  ruleId: 'rule-1',
  serviceId: SERVICE_KEY,
  providerId: 'provider-ru',
  displayName: 'ATC pickup',
  carrierName: 'ATC',
  priority: 1,
  deliveryPromise: '',
  conditionNote: '',
  conditions: {
    weightRangeG: [0, 30000],
    priceRangeCNY: ['0', '0'],
    priceRangeRUB: ['0', '0'],
    maxDimsCm: [60, 60, 60],
    longestSideCm: 60,
    battery: 'disallowed',
    chargeMode: 'actual',
    volumetricDivisor: 5000,
    volumeDivisorMm3: 0,
  },
  pricing: { type: 'per_kg', pricePerKg: '95', handling: '8' },
};

function authority(): LogisticsCaptureAuthority {
  return {
    companyBinding: {
      status: 'VERIFIED',
      tenantId: SCOPE.tenantId,
      shopId: SCOPE.shopId,
      companyId: SCOPE.companyId,
      openApiVerifiedAt: NOW,
      sellerProbeVerifiedAt: NOW,
      openApiIntersectionVerifiedAt: NOW,
      invalidatedAt: null,
      retiredAt: null,
    },
    originBinding: {
      status: 'VERIFIED',
      tenantId: SCOPE.tenantId,
      shopId: SCOPE.shopId,
      warehouseId: SCOPE.warehouseId,
      originCountryUid: SCOPE.originCountryUid,
      originCityUid: SCOPE.originCityUid,
      openApiAddressVerifiedAt: NOW,
      officialLocationVerifiedAt: NOW,
      invalidatedAt: null,
      retiredAt: null,
    },
    verifiedDestinations: [{
      countryUid: 'russia',
      locationUid: 'moscow',
      catalogVersion: 'catalog-a',
      verifiedAt: NOW,
      invalidatedAt: null,
    }],
  };
}

function harness() {
  const tasks = new Map<string, LogisticsCaptureTask>();
  const persisted: LogisticsCaptureCandidateInput[] = [];
  let sequence = 0;
  const repository = {
    resolveCaptureAuthority: async () => authority(),
    createCaptureTask: async (task: LogisticsCaptureTask) => {
      tasks.set(task.id, structuredClone(task));
      return task;
    },
    findCaptureTask: async (id: string) => structuredClone(tasks.get(id) || null),
    persistCaptureCandidate: async (input: LogisticsCaptureCandidateInput) => {
      persisted.push(structuredClone(input));
      return {
        kind: 'created' as const,
        candidateId: 'candidate-' + persisted.length,
        state: input.state,
        previousResponseChecksum: null,
      };
    },
    listReviewableCandidates: async () => [],
    getReviewableCandidate: async () => null,
    claimCaptureTask: async () => ({ state: 'not_found' as const }),
  };
  const service = createLogisticsCaptureTaskService({
    repository,
    now: () => new Date(NOW),
    taskId: () => 'task-' + (++sequence),
    nonce: () => 'capture-nonce-0123456789abcdef',
  });
  return { service, persisted };
}

function sellerPayload() {
  return {
    schema: SELLER_CAPTURE_SCHEMA,
    capturedAt: '2026-07-12T10:01:00.000Z',
    responseChecksum: 'a'.repeat(64),
    sellerContext: { point: { latitude: 24.480107, longitude: 118.085348 } },
    endpointBatch: {
      expected: ENDPOINTS,
      attempted: ENDPOINTS,
      succeeded: ENDPOINTS,
      failed: [],
      empty: [],
    },
    providerStats: {
      discovered: 2,
      attempted: 2,
      succeeded: 1,
      failed: 1,
      empty: 0,
      catalogComplete: false,
      methodBindingsComplete: true,
      methodBindingsRequired: true,
      complete: false,
    },
    providerRows: [{
      providerId: 'provider-ru',
      name: 'ATC',
      source: 'both',
      status: 'succeeded',
      pointCount: 1,
    }, {
      providerId: 'provider-unrelated',
      name: 'Unrelated',
      source: 'template',
      status: 'failed',
      pointCount: 0,
    }],
    services: [{
      stableServiceKey: SERVICE_KEY,
      providerId: 'provider-ru',
      normalizedDescription: 'atc pickup',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
      deliveryVariant: 'pickup',
      routeCandidates: [{
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        evidenceType: 'ozon_structured_destination',
      }],
      calculationRule: RULE,
    }],
  };
}

function officialTaskFingerprint(
  batteryMode: OfficialCaptureFingerprint['batteryMode'],
): OfficialCaptureFingerprint {
  return {
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    currency: 'CNY',
    declaredPriceMinor: '300000',
    weightGrams: '498',
    dimensionsMm: { length: '90', width: '160', height: '180' },
    batteryMode,
  };
}

function observedFingerprint(batteryInput: boolean | undefined) {
  return {
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destinationCountryUid: 'russia',
    destinationLocationUid: 'moscow',
    currency: 'CNY',
    declaredPriceMinor: '300000',
    weightGrams: '498',
    dimensionsMm: { length: '90', width: '160', height: '180' },
    ...(batteryInput === undefined ? {} : { batteryInput }),
  };
}

function officialPayload(batteryInput: boolean | undefined) {
  return {
    schema: OFFICIAL_CAPTURE_SCHEMA,
    capturedAt: '2026-07-12T10:02:00.000Z',
    responseChecksum: 'b'.repeat(64),
    fingerprint: observedFingerprint(batteryInput),
    quotes: [{
      stableServiceKey: SERVICE_KEY,
      providerId: 'provider-ru',
      normalizedDescription: 'atc pickup',
      templateType: 'door_to_door',
      weightType: 'actual',
      batteryMode: 'no-battery',
      deliveryVariant: 'pickup',
      priceMinor: '5535',
      currency: 'CNY',
      isDropOff: true,
      clusterDeliverySpeeds: [],
      deliverySpeed: 15,
      rating: null,
    }],
  };
}

describe('complete logistics capture normalization', () => {
  it('keeps canonical Seller identities/formulas and complete provider outcome statistics', async () => {
    const { service, persisted } = harness();
    const task = await service.issueSellerTask({
      requestedByUserId: 'admin-a',
      scope: SCOPE,
      expectedEndpoints: ENDPOINTS,
    });

    await expect(service.submitCapture({
      taskId: task.id,
      taskVersion: CAPTURE_TASK_VERSION,
      nonce: task.nonce,
      scope: SCOPE,
      payload: sellerPayload(),
    })).resolves.toMatchObject({ state: 'CAPTURED' });

    expect(persisted[0]).toMatchObject({
      state: 'CAPTURED',
      normalizedPayload: {
        sellerContext: { point: { latitude: 24.480107, longitude: 118.085348 } },
        providerStats: { discovered: 2, attempted: 2, succeeded: 1, failed: 1, empty: 0 },
        providerRows: [
          { providerId: 'provider-ru', status: 'succeeded' },
          { providerId: 'provider-unrelated', status: 'failed' },
        ],
        services: [{
          stableServiceKey: SERVICE_KEY,
          calculationRule: { serviceId: SERVICE_KEY },
        }],
      },
    });
  });

  it('accepts an omitted battery request only for UNSPECIFIED and rejects fabricated NONE evidence', async () => {
    const unspecified = harness();
    const unspecifiedTask = await unspecified.service.issueOfficialTask({
      requestedByUserId: 'admin-a',
      scope: SCOPE,
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      fingerprint: officialTaskFingerprint('UNSPECIFIED'),
    });
    await expect(unspecified.service.submitCapture({
      taskId: unspecifiedTask.id,
      taskVersion: unspecifiedTask.version,
      nonce: unspecifiedTask.nonce,
      scope: SCOPE,
      payload: officialPayload(undefined),
    })).resolves.toMatchObject({ state: 'CAPTURED' });
    expect(unspecified.persisted[0]?.normalizedPayload).toMatchObject({
      fingerprint: { batteryInput: null },
      quotes: [{ priceMinor: '5535', providerId: 'provider-ru' }],
    });

    const none = harness();
    const noneTask = await none.service.issueOfficialTask({
      requestedByUserId: 'admin-a',
      scope: SCOPE,
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      fingerprint: officialTaskFingerprint('NONE'),
    });
    await expect(none.service.submitCapture({
      taskId: noneTask.id,
      taskVersion: noneTask.version,
      nonce: noneTask.nonce,
      scope: SCOPE,
      payload: officialPayload(undefined),
    })).rejects.toMatchObject({ code: 'CAPTURE_FINGERPRINT_MISMATCH', statusCode: 409 });
    await expect(none.service.submitCapture({
      taskId: noneTask.id,
      taskVersion: noneTask.version,
      nonce: noneTask.nonce,
      scope: SCOPE,
      payload: officialPayload(false),
    })).resolves.toMatchObject({ state: 'CAPTURED' });
  });
  it('requires the complete current Seller contract when issuing a task', async () => {
    const { service } = harness();
    await expect(service.issueSellerTask({
      requestedByUserId: 'admin-a',
      scope: SCOPE,
      expectedEndpoints: [...ENDPOINTS, 'seller/category/list'],
    })).rejects.toMatchObject({ code: 'INVALID_CAPTURE_ENDPOINTS', statusCode: 400 });
  });
});
