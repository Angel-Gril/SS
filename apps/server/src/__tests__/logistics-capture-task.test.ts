import { describe, expect, it } from 'vitest';
import { buildOzonStableServiceKey } from 'shared';
import {
  LogisticsCaptureTaskError,
  createLogisticsCaptureTaskService,
  type LogisticsCaptureAuthority,
  type LogisticsCaptureCandidateInput,
  type LogisticsCapturePersistenceResult,
  type LogisticsCaptureScope,
  type LogisticsCaptureTask,
  type LogisticsCaptureTaskRepository,
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
const EXPECTED_ENDPOINTS = ['seller/template/by-location', 'seller/provider-inventory'];
const LEGACY_ENDPOINTS = [
  'seller/template/by-location',
  'seller/category/list',
  'seller/delivery-speed',
  'seller/provider-inventory',
];
const OFFICIAL_FINGERPRINT: OfficialCaptureFingerprint = {
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  currency: 'CNY',
  declaredPriceMinor: '300000',
  weightGrams: '498',
  dimensionsMm: { length: '90', width: '160', height: '180' },
  batteryMode: 'NONE',
};

const RUSSIA_SERVICE_KEY = buildOzonStableServiceKey({
  providerId: 'provider-ru',
  description: 'Russia pickup',
  templateType: 'door_to_door',
  weightType: 'actual',
  batteryMode: 'no-battery',
});
const BELARUS_SERVICE_KEY = buildOzonStableServiceKey({
  providerId: 'provider-by',
  description: 'Belarus courier',
  templateType: 'door_to_door',
  weightType: 'volumetric',
  batteryMode: 'no-battery',
});

function calculationRule(
  serviceId: string,
  providerId: string,
  displayName: string,
  chargeMode: 'actual' | 'max_actual_volume',
) {
  return {
    ruleId: `rule-${providerId}`,
    serviceId,
    providerId,
    displayName,
    carrierName: providerId,
    priority: 1,
    deliveryPromise: '10-20 days',
    conditionNote: '',
    conditions: {
      weightRangeG: [0, 30_000],
      priceRangeCNY: ['0', '0'],
      priceRangeRUB: ['0', '0'],
      maxDimsCm: [60, 60, 60],
      longestSideCm: 60,
      battery: 'disallowed',
      chargeMode,
      volumetricDivisor: 5_000,
      volumeDivisorMm3: 0,
    },
    pricing: { type: 'per_kg', pricePerKg: '95', handling: '8' },
  };
}

function verifiedAuthority(): LogisticsCaptureAuthority {
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
    verifiedDestinations: [
      {
        countryUid: 'russia',
        locationUid: 'moscow',
        catalogVersion: 'catalog-2026-07-12',
        verifiedAt: NOW,
        invalidatedAt: null,
      },
    ],
  };
}

class MemoryCaptureRepository implements LogisticsCaptureTaskRepository {
  authority: LogisticsCaptureAuthority | null = verifiedAuthority();
  readonly tasks = new Map<string, LogisticsCaptureTask>();
  readonly persisted: Array<LogisticsCaptureCandidateInput & { candidateId: string }> = [];

  async resolveCaptureAuthority(): Promise<LogisticsCaptureAuthority | null> {
    return this.authority;
  }

  async createCaptureTask(task: LogisticsCaptureTask): Promise<LogisticsCaptureTask> {
    this.tasks.set(task.id, structuredClone(task));
    return structuredClone(task);
  }

  async findCaptureTask(taskId: string): Promise<LogisticsCaptureTask | null> {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }

  async claimCaptureTask(
    input: Parameters<LogisticsCaptureTaskRepository['claimCaptureTask']>[0],
  ): Promise<any> {
    const task = this.tasks.get(input.taskId);
    if (!task || !input.nonce || task.nonce !== input.nonce) return { state: 'not_found' };
    if (input.now.getTime() >= task.expiresAt.getTime()) return { state: 'expired' };
    const duplicate =
      task.status === 'CLAIMED' && task.claimedBySessionId === input.device.sessionId;
    if (task.status !== 'ISSUED' && !duplicate) return { state: 'not_found' };
    task.status = 'CLAIMED';
    task.claimedBySessionId = input.device.sessionId;
    task.claimedAt ||= new Date(input.now);
    return { state: 'claimed', duplicate, task: structuredClone(task) };
  }

  async listReviewableCandidates(): Promise<any[]> {
    return this.persisted.map((candidate) => ({
      candidateId: candidate.candidateId,
      taskId: candidate.taskId,
      taskKind: candidate.taskKind,
      ...candidate.scope,
      destination: candidate.destination,
      state: candidate.state,
      reviewStatus: candidate.reviewStatus,
      responseChecksum: candidate.responseChecksum,
      previousResponseChecksum: null,
      receivedAt: candidate.receivedAt.toISOString(),
    }));
  }

  async getReviewableCandidate(candidateId: string): Promise<any> {
    const candidate = this.persisted.find((row) => row.candidateId === candidateId);
    return candidate
      ? {
          candidateId,
          taskId: candidate.taskId,
          taskKind: candidate.taskKind,
          ...candidate.scope,
          destination: candidate.destination,
          state: candidate.state,
          reviewStatus: candidate.reviewStatus,
          responseChecksum: candidate.responseChecksum,
          previousResponseChecksum: null,
          receivedAt: candidate.receivedAt.toISOString(),
          sourceResponseChecksum: candidate.sourceResponseChecksum,
          capturedAt: candidate.capturedAt?.toISOString() || null,
          quarantineReasons: candidate.quarantineReasons,
          normalizedPayload: candidate.normalizedPayload,
          diagnostics: candidate.diagnostics,
        }
      : null;
  }

  async persistCaptureCandidate(
    input: LogisticsCaptureCandidateInput,
  ): Promise<LogisticsCapturePersistenceResult> {
    const duplicate = this.persisted.find(
      (candidate) =>
        candidate.fingerprintChecksum === input.fingerprintChecksum &&
        candidate.responseChecksum === input.responseChecksum,
    );
    if (duplicate) {
      return {
        kind: 'duplicate',
        candidateId: duplicate.candidateId,
        state: duplicate.state,
      };
    }
    const previous = [...this.persisted]
      .reverse()
      .find((candidate) => candidate.fingerprintChecksum === input.fingerprintChecksum);
    const candidateId = `candidate-${this.persisted.length + 1}`;
    this.persisted.push({ ...structuredClone(input), candidateId });
    return {
      kind: 'created',
      candidateId,
      state: input.state,
      previousResponseChecksum: previous?.responseChecksum || null,
    };
  }
}

function createHarness(repository = new MemoryCaptureRepository()) {
  let sequence = 0;
  let currentNow = new Date(NOW);
  const service = createLogisticsCaptureTaskService({
    repository,
    now: () => new Date(currentNow),
    taskId: () => `task-${++sequence}`,
    nonce: () => `nonce-${sequence}-0123456789abcdef`,
  });
  return {
    repository,
    service,
    setNow(value: Date) {
      currentNow = new Date(value);
    },
  };
}

function sellerPayload(responseChecksum = 'a'.repeat(64), endpoints = EXPECTED_ENDPOINTS) {
  return {
    schema: 'ozon-seller-logistics-capture/v1',
    capturedAt: '2026-07-12T10:02:00.000Z',
    responseChecksum,
    sellerContext: { point: { latitude: 24.480107, longitude: 118.085348 } },
    endpointBatch: {
      expected: [...endpoints],
      attempted: [...endpoints],
      succeeded: [...endpoints],
      failed: [] as string[],
      empty: [] as string[],
    },
    providerStats: {
      discovered: 2,
      attempted: 2,
      succeeded: 2,
      failed: 0,
      empty: 0,
      catalogComplete: true,
      methodBindingsComplete: true,
      methodBindingsRequired: true,
      complete: true,
    },
    providerRows: [
      {
        providerId: 'provider-ru',
        name: 'Russia provider',
        source: 'method',
        status: 'succeeded',
        pointCount: 1,
      },
      {
        providerId: 'provider-by',
        name: 'Belarus provider',
        source: 'template',
        status: 'succeeded',
        pointCount: 1,
      },
    ],
    services: [
      {
        stableServiceKey: RUSSIA_SERVICE_KEY,
        providerId: 'provider-ru',
        normalizedDescription: 'russia pickup',
        templateType: 'door_to_door',
        weightType: 'actual',
        batteryMode: 'no-battery',
        deliveryVariant: 'pickup',
        routeCandidates: [
          {
            destinationCountryUid: 'russia',
            destinationLocationUid: 'moscow',
            evidenceType: 'ozon_structured_destination',
          },
        ],
        calculationRule: calculationRule(
          RUSSIA_SERVICE_KEY,
          'provider-ru',
          'Russia pickup',
          'actual',
        ),
      },
      {
        stableServiceKey: BELARUS_SERVICE_KEY,
        providerId: 'provider-by',
        normalizedDescription: 'belarus courier',
        templateType: 'door_to_door',
        weightType: 'volumetric',
        batteryMode: 'no-battery',
        deliveryVariant: 'courier',
        routeCandidates: [
          {
            destinationCountryUid: 'belarus',
            destinationLocationUid: null,
            evidenceType: 'openapi_method_route',
          },
        ],
        calculationRule: calculationRule(
          BELARUS_SERVICE_KEY,
          'provider-by',
          'Belarus courier',
          'max_actual_volume',
        ),
      },
    ],
  };
}

function submission(task: LogisticsCaptureTask, payload: unknown) {
  return {
    taskId: task.id,
    taskVersion: task.version,
    nonce: task.nonce,
    scope: structuredClone(SCOPE),
    payload,
  };
}

async function issueSeller(service: ReturnType<typeof createLogisticsCaptureTaskService>) {
  return service.issueSellerTask({
    requestedByUserId: 'operator-a',
    scope: structuredClone(SCOPE),
    expectedEndpoints: [...EXPECTED_ENDPOINTS],
  });
}

describe('logistics capture task service', () => {
  it('issues Seller tasks only from independently verified company and origin bindings', async () => {
    const valid = createHarness();
    const task = await issueSeller(valid.service);

    expect(task).toMatchObject({
      id: 'task-1',
      version: 'logistics-capture-task/v3',
      kind: 'SELLER',
      scope: SCOPE,
      destination: null,
      expectedEndpoints: EXPECTED_ENDPOINTS,
      status: 'ISSUED',
    });
    expect(task.expiresAt.toISOString()).toBe('2026-07-12T10:10:00.000Z');

    for (const authority of [
      {
        ...verifiedAuthority(),
        companyBinding: {
          ...verifiedAuthority().companyBinding,
          sellerProbeVerifiedAt: null,
        },
      },
      {
        ...verifiedAuthority(),
        originBinding: {
          ...verifiedAuthority().originBinding,
          officialLocationVerifiedAt: null,
        },
      },
    ]) {
      const harness = createHarness();
      harness.repository.authority = authority;
      await expect(issueSeller(harness.service)).rejects.toMatchObject({
        code: 'CAPTURE_BINDING_NOT_VERIFIED',
        statusCode: 409,
      });
      expect(harness.repository.tasks.size).toBe(0);
    }
  });

  it('accepts stored v1 Seller tasks with the retired endpoint batch for legacy uploads', async () => {
    const harness = createHarness();
    const legacyTask = {
      id: 'legacy-task',
      version: 'logistics-capture-task/v1',
      kind: 'SELLER',
      requestedByUserId: 'operator-a',
      scope: structuredClone(SCOPE),
      destination: null,
      officialFingerprint: null,
      expectedEndpoints: [...LEGACY_ENDPOINTS],
      fingerprintChecksum: 'f'.repeat(64),
      nonce: 'legacy-nonce-0123456789abcdef',
      status: 'ISSUED',
      claimedBySessionId: null,
      claimedAt: null,
      uploadedAt: null,
      reviewableAt: null,
      issuedAt: new Date(NOW),
      expiresAt: new Date('2026-07-12T10:10:00.000Z'),
    } as unknown as LogisticsCaptureTask;
    harness.repository.tasks.set(legacyTask.id, structuredClone(legacyTask));
    const payload = sellerPayload('9'.repeat(64), LEGACY_ENDPOINTS);
    payload.providerRows[0]!.source = 'warehouse';
    delete (payload.providerStats as Record<string, unknown>).catalogComplete;
    delete (payload.providerStats as Record<string, unknown>).methodBindingsComplete;
    delete (payload.providerStats as Record<string, unknown>).methodBindingsRequired;
    delete (payload.providerStats as Record<string, unknown>).complete;

    await expect(
      harness.service.submitCapture(submission(legacyTask, payload)),
    ).resolves.toMatchObject({ state: 'CAPTURED' });
    expect(harness.repository.persisted[0]).toMatchObject({
      taskVersion: 'logistics-capture-task/v1',
      diagnostics: { endpointBatch: { expected: LEGACY_ENDPOINTS } },
    });
  });
  it('claims one task idempotently for one authorized device session', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);
    const input = {
      taskId: task.id,
      taskVersion: task.version,
      nonce: task.nonce,
      scope: structuredClone(SCOPE),
      device: {
        sessionId: 'session-a',
        ownerUserId: SCOPE.tenantId,
        allowedShopIds: [SCOPE.shopId],
      },
    };

    const claimed = await harness.service.claimCaptureTask(input);
    expect(claimed).toMatchObject({
      status: 'CLAIMED',
      claimedBySessionId: 'session-a',
    });
    await expect(harness.service.claimCaptureTask(input)).resolves.toMatchObject({
      status: 'CLAIMED',
      claimedBySessionId: 'session-a',
    });

    await expect(
      harness.service.claimCaptureTask({
        ...input,
        scope: { ...SCOPE, shopId: 'shop-b' },
      }),
    ).rejects.toMatchObject({
      code: 'CAPTURE_TASK_MISMATCH',
      statusCode: 404,
    });
  });

  it('issues Official tasks only for a complete exact fingerprint and verified destination', async () => {
    const harness = createHarness();
    const task = await harness.service.issueOfficialTask({
      requestedByUserId: 'operator-a',
      scope: structuredClone(SCOPE),
      destination: {
        countryUid: 'russia',
        locationUid: 'moscow',
      },
      fingerprint: structuredClone(OFFICIAL_FINGERPRINT),
    });

    expect(task).toMatchObject({
      kind: 'OFFICIAL',
      scope: SCOPE,
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      officialFingerprint: OFFICIAL_FINGERPRINT,
    });

    await expect(
      harness.service.issueOfficialTask({
        requestedByUserId: 'operator-a',
        scope: structuredClone(SCOPE),
        destination: { countryUid: 'russia', locationUid: 'moscow' },
        fingerprint: {
          ...OFFICIAL_FINGERPRINT,
          dimensionsMm: { length: '90', width: '', height: '180' },
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_OFFICIAL_FINGERPRINT', statusCode: 400 });

    const unverified = createHarness();
    unverified.repository.authority = {
      ...verifiedAuthority(),
      verifiedDestinations: [],
    };
    await expect(
      unverified.service.issueOfficialTask({
        requestedByUserId: 'operator-a',
        scope: structuredClone(SCOPE),
        destination: { countryUid: 'russia', locationUid: 'moscow' },
        fingerprint: structuredClone(OFFICIAL_FINGERPRINT),
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_DESTINATION_NOT_VERIFIED', statusCode: 409 });
  });

  it('captures a complete current Seller endpoint batch with mixed routes without fixed historical counts', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);
    const result = await harness.service.submitCapture(submission(task, sellerPayload()));

    expect(result).toEqual({
      kind: 'created',
      candidateId: 'candidate-1',
      state: 'CAPTURED',
      duplicate: false,
      changedFromResponseChecksum: null,
      requiresReview: true,
    });
    expect(harness.repository.persisted).toHaveLength(1);
    expect(harness.repository.persisted[0]).toMatchObject({
      taskId: task.id,
      state: 'CAPTURED',
      reviewStatus: 'PENDING_REVIEW',
      sourceTrust: 'TENANT_ATTESTED',
      destination: null,
      diagnostics: {
        historicalCountsOnly: true,
        endpointBatch: {
          expected: EXPECTED_ENDPOINTS,
          attempted: EXPECTED_ENDPOINTS,
          succeeded: EXPECTED_ENDPOINTS,
          failed: [],
          empty: [],
          counts: {
            expected: EXPECTED_ENDPOINTS.length,
            attempted: EXPECTED_ENDPOINTS.length,
            succeeded: EXPECTED_ENDPOINTS.length,
            failed: 0,
            empty: 0,
          },
        },
      },
      normalizedPayload: {
        services: [
          { routeCandidates: [{ destinationCountryUid: 'russia' }] },
          { routeCandidates: [{ destinationCountryUid: 'belarus' }] },
        ],
      },
    });
    expect(harness.repository.persisted[0]?.state).not.toMatch(/VERIFIED|PUBLISHED/);
  });

  it('requires exact task nonce, version, scope, and expiry before persistence', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);
    const base = submission(task, sellerPayload());

    const cases = [
      { input: { ...base, nonce: 'wrong-nonce-0123456789abcdef' }, code: 'CAPTURE_TASK_MISMATCH' },
      {
        input: { ...base, taskVersion: 'logistics-capture-task/v1' },
        code: 'CAPTURE_TASK_MISMATCH',
      },
      { input: { ...base, nonce: null as never }, code: 'CAPTURE_TASK_MISMATCH' },
      { input: { ...base, scope: null as never }, code: 'CAPTURE_TASK_MISMATCH' },
      {
        input: { ...base, scope: { ...SCOPE, shopId: 'shop-b' } },
        code: 'CAPTURE_TASK_MISMATCH',
      },
    ];
    for (const candidate of cases) {
      await expect(harness.service.submitCapture(candidate.input)).rejects.toMatchObject({
        code: candidate.code,
        statusCode: 404,
      });
    }

    harness.setNow(new Date('2026-07-12T10:10:00.001Z'));
    await expect(harness.service.submitCapture(base)).rejects.toMatchObject({
      code: 'CAPTURE_TASK_EXPIRED',
      statusCode: 410,
    });
    expect(harness.repository.persisted).toHaveLength(0);
  });

  it('revalidates independent bindings when a task is submitted', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);
    harness.repository.authority = {
      ...verifiedAuthority(),
      companyBinding: {
        ...verifiedAuthority().companyBinding,
        invalidatedAt: new Date('2026-07-12T10:05:00.000Z'),
      },
    };

    await expect(
      harness.service.submitCapture(submission(task, sellerPayload())),
    ).rejects.toMatchObject({
      code: 'CAPTURE_BINDING_NOT_VERIFIED',
      statusCode: 409,
    });
    expect(harness.repository.persisted).toHaveLength(0);
  });

  it('rejects credential-bearing fields recursively before candidate persistence', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);
    const payload = sellerPayload();
    (payload.services[0]! as { calculationRule: Record<string, unknown> }).calculationRule = {
      nested: {
        request: {
          headers: {
            Authorization: 'Bearer must-never-reach-storage',
          },
        },
      },
    };

    await expect(harness.service.submitCapture(submission(task, payload))).rejects.toEqual(
      expect.objectContaining<Partial<LogisticsCaptureTaskError>>({
        code: 'CREDENTIAL_FIELDS_FORBIDDEN',
        statusCode: 400,
      }),
    );
    expect(harness.repository.persisted).toHaveLength(0);
  });
  it('rejects non-JSON top-level payloads with one fixed public error', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);

    for (const payload of [undefined, () => 'not-json', Symbol('not-json')]) {
      await expect(harness.service.submitCapture(submission(task, payload))).rejects.toEqual(
        expect.objectContaining<Partial<LogisticsCaptureTaskError>>({
          code: 'CAPTURE_PAYLOAD_INVALID',
          statusCode: 400,
        }),
      );
    }
    expect(harness.repository.persisted).toHaveLength(0);
  });

  it('quarantines partial, empty, and unknown-schema captures without auto-verification', async () => {
    const harness = createHarness();
    const task = await issueSeller(harness.service);

    const partial = sellerPayload('b'.repeat(64));
    partial.endpointBatch.succeeded = EXPECTED_ENDPOINTS.slice(0, 1);
    partial.endpointBatch.failed = [EXPECTED_ENDPOINTS[1]!];
    const partialResult = await harness.service.submitCapture(submission(task, partial));
    expect(partialResult).toMatchObject({ state: 'QUARANTINED', requiresReview: true });
    const emptyEndpoint = sellerPayload('c'.repeat(64));
    emptyEndpoint.endpointBatch.succeeded = EXPECTED_ENDPOINTS.slice(0, 1);
    emptyEndpoint.endpointBatch.empty = [EXPECTED_ENDPOINTS[1]!];
    const emptyEndpointResult = await harness.service.submitCapture(
      submission(task, emptyEndpoint),
    );
    expect(emptyEndpointResult).toMatchObject({ state: 'QUARANTINED', requiresReview: true });

    const empty = sellerPayload('d'.repeat(64));
    empty.services = [];
    const emptyResult = await harness.service.submitCapture(submission(task, empty));
    expect(emptyResult).toMatchObject({ state: 'QUARANTINED', requiresReview: true });

    const unknown = {
      schema: 'ozon-seller-logistics-capture/v99',
      responseChecksum: 'e'.repeat(64),
      capturedAt: '2026-07-12T10:03:00.000Z',
      futureOpaqueValue: 'must-not-be-persisted',
    };
    const unknownResult = await harness.service.submitCapture(submission(task, unknown));
    expect(unknownResult).toMatchObject({ state: 'QUARANTINED', requiresReview: true });

    expect(harness.repository.persisted.map((candidate) => candidate.quarantineReasons)).toEqual([
      expect.arrayContaining(['ENDPOINT_BATCH_INCOMPLETE']),
      expect.arrayContaining(['EMPTY_ENDPOINT_RESPONSE']),
      expect.arrayContaining(['EMPTY_CAPTURE']),
      expect.arrayContaining(['UNKNOWN_SCHEMA']),
    ]);
    expect(harness.repository.persisted[0]?.diagnostics.endpointBatch).toMatchObject({
      failed: [EXPECTED_ENDPOINTS[1]],
      empty: [],
    });
    expect(harness.repository.persisted[1]?.diagnostics.endpointBatch).toMatchObject({
      failed: [],
      empty: [EXPECTED_ENDPOINTS[1]],
    });
    expect(harness.repository.persisted[3]?.normalizedPayload).toBeNull();
    expect(JSON.stringify(harness.repository.persisted[3])).not.toContain('must-not-be-persisted');
    expect(
      harness.repository.persisted.every(
        (candidate) => candidate.state === 'CAPTURED' || candidate.state === 'QUARANTINED',
      ),
    ).toBe(true);
  });

  it('quarantines inconsistent provider completeness flags', async () => {
    const harness = createHarness();
    const mutations = [
      (payload: ReturnType<typeof sellerPayload>) => {
        payload.providerStats.complete = false;
      },
      (payload: ReturnType<typeof sellerPayload>) => {
        payload.providerStats.catalogComplete = false;
      },
      (payload: ReturnType<typeof sellerPayload>) => {
        payload.providerStats.methodBindingsComplete = false;
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const task = await issueSeller(harness.service);
      const payload = sellerPayload((index + 1).toString().repeat(64));
      mutate(payload);
      await expect(harness.service.submitCapture(submission(task, payload))).resolves.toMatchObject(
        {
          state: 'QUARANTINED',
          requiresReview: true,
        },
      );
    }

    expect(harness.repository.persisted).toHaveLength(3);
    expect(
      harness.repository.persisted.every((candidate) =>
        candidate.quarantineReasons.includes('PROVIDER_STATS_MISMATCH'),
      ),
    ).toBe(true);
  });

  it('derives canonical response checksums instead of trusting a client hash', async () => {
    const harness = createHarness();
    const claimedChecksum = '7'.repeat(64);

    const firstPayload = sellerPayload(claimedChecksum);
    const firstTask = await issueSeller(harness.service);
    const first = await harness.service.submitCapture(submission(firstTask, firstPayload));
    expect(first).toMatchObject({ kind: 'created', candidateId: 'candidate-1' });

    const changedPayload = sellerPayload(claimedChecksum);
    changedPayload.services[0]!.calculationRule.pricing.pricePerKg = '96';
    const changedTask = await issueSeller(harness.service);
    const changed = await harness.service.submitCapture(submission(changedTask, changedPayload));
    expect(changed).toMatchObject({ kind: 'created', candidateId: 'candidate-2' });

    const [firstCandidate, changedCandidate] = harness.repository.persisted;
    expect(firstCandidate?.sourceResponseChecksum).toBe(claimedChecksum);
    expect(changedCandidate?.sourceResponseChecksum).toBe(claimedChecksum);
    expect(firstCandidate?.responseChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(firstCandidate?.responseChecksum).not.toBe(claimedChecksum);
    expect(changedCandidate?.responseChecksum).not.toBe(firstCandidate?.responseChecksum);
    expect(changed.changedFromResponseChecksum).toBe(firstCandidate?.responseChecksum);

    const sameContentWithAnotherClaim = sellerPayload('8'.repeat(64));
    sameContentWithAnotherClaim.services[0]!.calculationRule.pricing.pricePerKg = '96';
    const retryTask = await issueSeller(harness.service);
    const retry = await harness.service.submitCapture(
      submission(retryTask, sameContentWithAnotherClaim),
    );
    expect(retry).toMatchObject({
      kind: 'duplicate',
      candidateId: 'candidate-2',
      duplicate: true,
    });
    expect(harness.repository.persisted).toHaveLength(2);
  });

  it('includes the capture task version in the server response checksum', async () => {
    const harness = createHarness();
    const currentTask = await issueSeller(harness.service);
    const legacyTask = {
      ...structuredClone(currentTask),
      id: 'legacy-checksum-task',
      version: 'logistics-capture-task/v1',
      nonce: 'legacy-checksum-nonce-0123456789abcdef',
    } as LogisticsCaptureTask;
    harness.repository.tasks.set(legacyTask.id, structuredClone(legacyTask));
    const payload = sellerPayload('6'.repeat(64));

    await expect(
      harness.service.submitCapture(submission(currentTask, payload)),
    ).resolves.toMatchObject({ kind: 'created', candidateId: 'candidate-1' });
    await expect(
      harness.service.submitCapture(submission(legacyTask, payload)),
    ).resolves.toMatchObject({ kind: 'created', candidateId: 'candidate-2' });

    expect(harness.repository.persisted[0]?.responseChecksum).not.toBe(
      harness.repository.persisted[1]?.responseChecksum,
    );
  });

  it('keeps canonical response checksums stable when capture collections are reordered', async () => {
    const harness = createHarness();
    const firstSellerTask = await issueSeller(harness.service);
    const seller = sellerPayload('1'.repeat(64));
    const firstSeller = await harness.service.submitCapture(submission(firstSellerTask, seller));
    expect(firstSeller).toMatchObject({ kind: 'created', candidateId: 'candidate-1' });

    const reorderedSeller = structuredClone(seller);
    reorderedSeller.responseChecksum = '2'.repeat(64);
    reorderedSeller.endpointBatch.expected.reverse();
    reorderedSeller.endpointBatch.attempted.reverse();
    reorderedSeller.endpointBatch.succeeded.reverse();
    reorderedSeller.providerRows.reverse();
    reorderedSeller.services.reverse();
    const secondSellerTask = await issueSeller(harness.service);
    await expect(
      harness.service.submitCapture(submission(secondSellerTask, reorderedSeller)),
    ).resolves.toMatchObject({
      kind: 'duplicate',
      candidateId: 'candidate-1',
      duplicate: true,
    });

    const issueOfficial = () =>
      harness.service.issueOfficialTask({
        requestedByUserId: 'operator-a',
        scope: structuredClone(SCOPE),
        destination: { countryUid: 'russia', locationUid: 'moscow' },
        fingerprint: structuredClone(OFFICIAL_FINGERPRINT),
      });
    const { batteryMode: _batteryMode, ...officialBase } = OFFICIAL_FINGERPRINT;
    const officialPayload = {
      schema: 'ozon-official-logistics-capture/v1',
      capturedAt: '2026-07-12T10:04:00.000Z',
      responseChecksum: '3'.repeat(64),
      fingerprint: { ...officialBase, batteryInput: false },
      quotes: [
        {
          stableServiceKey: RUSSIA_SERVICE_KEY,
          providerId: 'provider-ru',
          normalizedDescription: 'russia pickup',
          templateType: 'door_to_door',
          weightType: 'actual',
          batteryMode: 'no-battery',
          deliveryVariant: 'pickup',
          priceMinor: '1350',
          currency: 'CNY',
          isDropOff: true,
          clusterDeliverySpeeds: [],
          deliverySpeed: 15,
          rating: null,
        },
        {
          stableServiceKey: BELARUS_SERVICE_KEY,
          providerId: 'provider-by',
          normalizedDescription: 'belarus courier',
          templateType: 'door_to_door',
          weightType: 'volumetric',
          batteryMode: 'no-battery',
          deliveryVariant: 'courier',
          priceMinor: '1550',
          currency: 'CNY',
          isDropOff: false,
          clusterDeliverySpeeds: [],
          deliverySpeed: 20,
          rating: null,
        },
      ],
    };
    const firstOfficialTask = await issueOfficial();
    const firstOfficial = await harness.service.submitCapture(
      submission(firstOfficialTask, officialPayload),
    );
    expect(firstOfficial).toMatchObject({ kind: 'created', candidateId: 'candidate-2' });

    const reorderedOfficial = structuredClone(officialPayload);
    reorderedOfficial.responseChecksum = '4'.repeat(64);
    reorderedOfficial.quotes.reverse();
    const secondOfficialTask = await issueOfficial();
    await expect(
      harness.service.submitCapture(submission(secondOfficialTask, reorderedOfficial)),
    ).resolves.toMatchObject({
      kind: 'duplicate',
      candidateId: 'candidate-2',
      duplicate: true,
    });
  });

  it('deduplicates the same fingerprint and response while surfacing changed responses as candidate diffs', async () => {
    const harness = createHarness();

    const firstTask = await issueSeller(harness.service);
    const first = await harness.service.submitCapture(
      submission(firstTask, sellerPayload('e'.repeat(64))),
    );
    expect(first).toMatchObject({ kind: 'created', duplicate: false });

    const retryTask = await issueSeller(harness.service);
    const retry = await harness.service.submitCapture(
      submission(retryTask, sellerPayload('e'.repeat(64))),
    );
    expect(retry).toEqual({
      kind: 'duplicate',
      candidateId: 'candidate-1',
      state: 'CAPTURED',
      duplicate: true,
      changedFromResponseChecksum: null,
      requiresReview: true,
    });

    const changedPayload = sellerPayload('f'.repeat(64));
    changedPayload.services[0]!.calculationRule.pricing.pricePerKg = '96';
    const previousCanonicalChecksum = harness.repository.persisted[0]!.responseChecksum;
    const changedTask = await issueSeller(harness.service);
    const changed = await harness.service.submitCapture(submission(changedTask, changedPayload));
    expect(changed).toEqual({
      kind: 'created',
      candidateId: 'candidate-2',
      state: 'CAPTURED',
      duplicate: false,
      changedFromResponseChecksum: previousCanonicalChecksum,
      requiresReview: true,
    });
    expect(harness.repository.persisted).toHaveLength(2);
    expect(harness.repository.persisted[0]?.fingerprintChecksum).toBe(
      harness.repository.persisted[1]?.fingerprintChecksum,
    );
  });

  it('accepts Official samples only when the submitted full fingerprint exactly matches the task', async () => {
    const harness = createHarness();
    const task = await harness.service.issueOfficialTask({
      requestedByUserId: 'operator-a',
      scope: structuredClone(SCOPE),
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      fingerprint: structuredClone(OFFICIAL_FINGERPRINT),
    });
    const { batteryMode: _batteryMode, ...officialBase } = OFFICIAL_FINGERPRINT;
    const observedFingerprint = { ...officialBase, batteryInput: false };
    const payload = {
      schema: 'ozon-official-logistics-capture/v1',
      capturedAt: '2026-07-12T10:04:00.000Z',
      responseChecksum: '9'.repeat(64),
      fingerprint: structuredClone(observedFingerprint),
      quotes: [
        {
          stableServiceKey: RUSSIA_SERVICE_KEY,
          providerId: 'provider-ru',
          normalizedDescription: 'russia pickup',
          templateType: 'door_to_door',
          weightType: 'actual',
          batteryMode: 'no-battery',
          deliveryVariant: 'pickup',
          priceMinor: '1350',
          currency: 'CNY',
          isDropOff: true,
          clusterDeliverySpeeds: [],
          deliverySpeed: 15,
          rating: null,
        },
      ],
    };

    await expect(
      harness.service.submitCapture(
        submission(task, {
          ...payload,
          fingerprint: { ...observedFingerprint, originCityUid: 'shenzhen' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CAPTURE_FINGERPRINT_MISMATCH', statusCode: 409 });

    const accepted = await harness.service.submitCapture(submission(task, payload));
    expect(accepted).toMatchObject({ state: 'CAPTURED', requiresReview: true });
    expect(harness.repository.persisted[0]).toMatchObject({
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      normalizedPayload: { fingerprint: observedFingerprint },
      state: 'CAPTURED',
    });
  });
});
