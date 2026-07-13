import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createPrismaLogisticsCaptureTaskRepository } from '../services/logistics-capture-task-prisma.js';
import {
  CAPTURE_TASK_VERSION,
  type LogisticsCaptureScope,
  type LogisticsCaptureTask,
} from '../services/logistics-capture-task.js';

const SCOPE: LogisticsCaptureScope = {
  tenantId: 'tenant-a',
  shopId: 'shop-a',
  companyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
};
const NOW = new Date('2026-07-12T10:00:00.000Z');

function task(): LogisticsCaptureTask {
  return {
    id: 'task-1',
    version: CAPTURE_TASK_VERSION,
    kind: 'SELLER',
    requestedByUserId: 'admin-a',
    scope: structuredClone(SCOPE),
    destination: null,
    officialFingerprint: null,
    expectedEndpoints: ['seller/template/by-location'],
    fingerprintChecksum: 'a'.repeat(64),
    nonce: 'capture-nonce-0123456789abcdef',
    status: 'ISSUED',
    claimedBySessionId: null,
    claimedAt: null,
    uploadedAt: null,
    reviewableAt: null,
    issuedAt: NOW,
    expiresAt: new Date('2026-07-12T10:10:00.000Z'),
  };
}

function row(status: 'ISSUED' | 'CLAIMED' = 'ISSUED') {
  return {
    id: 'task-1',
    version: CAPTURE_TASK_VERSION,
    kind: 'SELLER',
    requestedByUserId: 'admin-a',
    tenantId: 'tenant-a',
    shopId: 'shop-a',
    companyId: 'company-a',
    warehouseId: 'warehouse-a',
    originCountryUid: 'china',
    originCityUid: 'xiamen',
    destinationCountryUid: null,
    nonceDigest: createHash('sha256').update('capture-nonce-0123456789abcdef').digest('hex'),
    destinationLocationUid: null,
    officialFingerprint: null,
    expectedEndpoints: ['seller/template/by-location'],
    fingerprintChecksum: 'a'.repeat(64),
    status,
    claimedBySessionId: status === 'CLAIMED' ? 'session-a' : null,
    claimedAt: status === 'CLAIMED' ? new Date('2026-07-12T10:01:00.000Z') : null,
    uploadedAt: null,
    reviewableAt: null,
    issuedAt: NOW,
    expiresAt: new Date('2026-07-12T10:10:00.000Z'),
  };
}

describe('Prisma logistics capture task repository', () => {
  it('stores only a SHA-256 nonce digest while returning the issued one-time nonce', async () => {
    const query = vi.fn(async () => [row()]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });

    const created = await repository.createCaptureTask(task());

    expect(created.nonce).toBe('capture-nonce-0123456789abcdef');
    const serializedCalls = JSON.stringify(query.mock.calls);
    expect(serializedCalls).not.toContain('capture-nonce-0123456789abcdef');
    expect(serializedCalls).toContain(
      createHash('sha256').update('capture-nonce-0123456789abcdef').digest('hex'),
    );
  });

  it('claims atomically for the matching live device scope and is non-enumerating otherwise', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([row('ISSUED')])
      .mockResolvedValueOnce([row('CLAIMED')])
      .mockResolvedValueOnce([]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });
    const input = {
      taskId: 'task-1',
      taskVersion: CAPTURE_TASK_VERSION,
      nonce: 'capture-nonce-0123456789abcdef',
      scope: SCOPE,
      device: {
        sessionId: 'session-a',
        ownerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
      },
      now: new Date('2026-07-12T10:01:00.000Z'),
    };

    await expect(repository.claimCaptureTask(input)).resolves.toMatchObject({
      state: 'claimed',
      duplicate: false,
      task: {
        id: 'task-1',
        status: 'CLAIMED',
        claimedBySessionId: 'session-a',
      },
    });
    await expect(
      repository.claimCaptureTask({
        ...input,
        device: { ...input.device, ownerUserId: 'tenant-b' },
      }),
    ).resolves.toEqual({ state: 'not_found' });

    const claimSql = String(query.mock.calls[0]?.[0]);
    expect(claimSql).toContain('extension_device_shop_grants');
    expect(claimSql).toContain('owner_user_id');
    expect(claimSql).toContain('nonce_digest');
  });

  it('retries a serialization conflict within a bound', async () => {
    const query = vi.fn(async () => [row('CLAIMED')]);
    const client: any = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
    };
    client.$transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementation(async (operation: any) => operation(client));
    const repository = createPrismaLogisticsCaptureTaskRepository({ client });

    await expect(
      repository.claimCaptureTask({
        taskId: 'task-1',
        taskVersion: CAPTURE_TASK_VERSION,
        nonce: 'capture-nonce-0123456789abcdef',
        scope: SCOPE,
        device: {
          sessionId: 'session-a',
          ownerUserId: 'tenant-a',
          allowedShopIds: ['shop-a'],
        },
        now: new Date('2026-07-12T10:01:00.000Z'),
      }),
    ).resolves.toMatchObject({ state: 'claimed', duplicate: true });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });

  it('returns the same reviewable candidate for an idempotent upload retry', async () => {
    const responseChecksum = 'b'.repeat(64);
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          ...row('CLAIMED'),
          status: 'REVIEWABLE',
          candidateId: 'candidate-1',
          uploadedAt: new Date('2026-07-12T10:02:00.000Z'),
          reviewableAt: new Date('2026-07-12T10:02:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'candidate-1',
          state: 'CAPTURED',
          fingerprintChecksum: 'a'.repeat(64),
          responseChecksum,
          previousResponseChecksum: null,
        },
      ]);
    const execute = vi.fn();
    const client: any = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: execute,
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client });

    await expect(
      repository.persistCaptureCandidate({
        taskId: 'task-1',
        taskKind: 'SELLER',
        taskVersion: CAPTURE_TASK_VERSION,
        scope: SCOPE,
        destination: null,
        fingerprintChecksum: 'a'.repeat(64),
        responseChecksum,
        sourceResponseChecksum: null,
        capturedAt: NOW,
        receivedAt: new Date('2026-07-12T10:03:00.000Z'),
        deviceSessionId: 'session-a',
        deviceOwnerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
        state: 'CAPTURED',
        reviewStatus: 'PENDING_REVIEW',
        sourceTrust: 'TENANT_ATTESTED',
        quarantineReasons: [],
        normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
        diagnostics: { schema: 'ozon-seller-logistics-capture/v1', historicalCountsOnly: true },
      }),
    ).resolves.toEqual({
      kind: 'duplicate',
      candidateId: 'candidate-1',
      state: 'CAPTURED',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('persists the immutable task version with a new capture candidate', async () => {
    const responseChecksum = 'd'.repeat(64);
    const query = vi
      .fn()
      .mockResolvedValueOnce([row('CLAIMED')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'candidate-2',
          state: 'CAPTURED',
          fingerprintChecksum: 'a'.repeat(64),
          responseChecksum,
          previousResponseChecksum: null,
        },
      ]);
    const execute = vi.fn(async () => 1);
    const client: any = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: execute,
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client });

    await expect(
      repository.persistCaptureCandidate({
        taskId: 'task-1',
        taskKind: 'SELLER',
        taskVersion: CAPTURE_TASK_VERSION,
        scope: SCOPE,
        destination: null,
        fingerprintChecksum: 'a'.repeat(64),
        responseChecksum,
        sourceResponseChecksum: null,
        capturedAt: NOW,
        receivedAt: new Date('2026-07-12T10:03:00.000Z'),
        deviceSessionId: 'session-a',
        deviceOwnerUserId: 'tenant-a',
        allowedShopIds: ['shop-a'],
        state: 'CAPTURED',
        reviewStatus: 'PENDING_REVIEW',
        sourceTrust: 'TENANT_ATTESTED',
        quarantineReasons: [],
        normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
        diagnostics: { schema: 'ozon-seller-logistics-capture/v1', historicalCountsOnly: true },
      }),
    ).resolves.toEqual({
      kind: 'created',
      candidateId: 'candidate-2',
      state: 'CAPTURED',
      previousResponseChecksum: null,
    });

    const insertCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO "logistics_capture_candidates"'),
    );
    expect(insertCall).toBeDefined();
    expect(String(insertCall?.[0])).toContain('"task_version"');
    expect(insertCall).toContain(CAPTURE_TASK_VERSION);
  });

  it('returns persisted normalized candidate detail after administrator review', async () => {
    const query = vi.fn(async () => [
      {
        candidateId: 'candidate-1',
        taskId: 'task-1',
        taskKind: 'SELLER',
        taskVersion: 'logistics-capture-task/v1',
        tenantId: 'tenant-a',
        shopId: 'shop-a',
        companyId: 'company-a',
        warehouseId: 'warehouse-a',
        originCountryUid: 'china',
        originCityUid: 'xiamen',
        destinationCountryUid: null,
        destinationLocationUid: null,
        state: 'CAPTURED',
        reviewStatus: 'VERIFIED',
        responseChecksum: 'b'.repeat(64),
        sourceResponseChecksum: 'c'.repeat(64),
        previousResponseChecksum: null,
        capturedAt: NOW,
        receivedAt: NOW,
        quarantineReasons: [],
        normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
        diagnostics: { schema: 'ozon-seller-logistics-capture/v1', historicalCountsOnly: true },
      },
    ]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });

    await expect(repository.getReviewableCandidate('candidate-1')).resolves.toMatchObject({
      reviewStatus: 'VERIFIED',
      candidateId: 'candidate-1',
      taskVersion: 'logistics-capture-task/v1',
      normalizedPayload: { schema: 'ozon-seller-logistics-capture/v1' },
      diagnostics: { historicalCountsOnly: true },
    });
    const calls = query.mock.calls as unknown as unknown[][];
    expect(String(calls[0]?.[0])).not.toContain("review_status\" = 'PENDING_REVIEW'");
  });

  it('exposes the immutable capture CandidateSet repository contract', () => {
    const client = {
      $queryRawUnsafe: vi.fn(),
      $executeRawUnsafe: vi.fn(),
      $transaction: vi.fn(),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });

    expect(repository).toEqual(
      expect.objectContaining({
        loadAssignmentContext: expect.any(Function),
        listVerifiedOfficialCandidates: expect.any(Function),
        createCandidateSet: expect.any(Function),
        getCandidateSet: expect.any(Function),
      }),
    );
  });

  it('loads only a verified assignment, channel, company and origin context with coordinates', async () => {
    const query = vi.fn(async () => [
      {
        assignmentId: 'assignment-a',
        channelId: 'channel-a',
        tenantId: 'tenant-a',
        shopId: 'shop-a',
        companyId: 'company-a',
        warehouseId: 'warehouse-a',
        originCountryUid: 'china',
        originCityUid: 'xiamen',
        destinationCountryUid: 'russia',
        destinationLocationUid: 'moscow',
        warehouseLatitude: 24.4802,
        warehouseLongitude: 118.0854,
        originBindingId: 'origin-binding-a',
        originVerifiedAt: new Date('2026-07-12T09:00:00.000Z'),
      },
    ]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });

    await expect(repository.loadAssignmentContext('assignment-a')).resolves.toMatchObject({
      assignmentId: 'assignment-a',
      channelId: 'channel-a',
      scope: SCOPE,
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      warehousePoint: { latitude: 24.4802, longitude: 118.0854 },
      originBindingId: 'origin-binding-a',
    });
    const calls = query.mock.calls as unknown as unknown[][];
    const sql = String(calls[0]?.[0]);
    expect(sql).toContain('shop_ozon_company_bindings');
    expect(sql).toContain('warehouse_ozon_origin_bindings');
    expect(sql).toContain('c."channel_type" = \'TENANT\'');
    expect(sql).not.toContain('SHOP_PRIVATE');
    expect(sql).toContain("'VERIFIED'");
  });

  it('persists CandidateSet content and Official membership in one transaction', async () => {
    const candidateSet = {
      id: 'candidate-set-a',
      sellerCandidateId: 'seller-candidate-a',
      officialCandidates: [
        {
          candidateId: 'official-candidate-a',
          fingerprintKey: 'fingerprint-a',
          responseChecksum: 'c'.repeat(64),
        },
      ],
      assignmentId: 'assignment-a',
      channelId: 'channel-a',
      scope: structuredClone(SCOPE),
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      selectedServiceKeys: ['service-a'],
      defaultServiceKeys: ['service-a'],
      matrixInput: { schema: 'matrix-input' },
      validationMatrix: { requirements: [] },
      pointEvidence: {
        status: 'matched',
        originBindingId: 'origin-binding-a',
        originVerifiedAt: '2026-07-12T09:00:00.000Z',
        sellerPoint: { latitude: 24.480107, longitude: 118.085348 },
        warehousePoint: { latitude: 24.4802, longitude: 118.0854 },
        distanceKm: 0.012,
        toleranceKm: 50,
      },
      contentChecksum: 'e'.repeat(64),
      minExtensionVersion: '1.0.127',
      createdById: 'admin-a',
      createdAt: '2026-07-12T10:05:00.000Z',
    };
    const query = vi.fn(async (sql: string) =>
      sql.includes('INSERT INTO "logistics_capture_candidate_sets"')
        ? [{ id: candidateSet.id }]
        : [],
    );
    const client: any = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
    };
    client.$transaction = vi.fn(async (operation: any) => operation(client));
    const repository = createPrismaLogisticsCaptureTaskRepository({ client });

    await expect(repository.createCandidateSet(candidateSet as never)).resolves.toEqual({
      candidateSet,
      duplicate: false,
    });
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO "logistics_capture_candidate_set_officials"'),
      ),
    ).toBe(true);
  });

  it('re-hydrates CandidateSet membership from relational rows', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'candidate-set-a',
          sellerCandidateId: 'seller-candidate-a',
          assignmentId: 'assignment-a',
          channelId: 'channel-a',
          tenantId: 'tenant-a',
          shopId: 'shop-a',
          companyId: 'company-a',
          warehouseId: 'warehouse-a',
          originCountryUid: 'china',
          originCityUid: 'xiamen',
          destinationCountryUid: 'russia',
          destinationLocationUid: 'moscow',
          officialCandidateIds: ['official-candidate-a'],
          selectedServiceKeys: ['service-a'],
          defaultServiceKeys: ['service-a'],
          matrixInput: { schema: 'matrix-input' },
          validationMatrix: { requirements: [] },
          pointEvidence: { status: 'matched' },
          contentChecksum: 'e'.repeat(64),
          minExtensionVersion: '1.0.127',
          createdById: 'admin-a',
          createdAt: new Date('2026-07-12T10:05:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          candidateId: 'official-candidate-a',
          fingerprintKey: 'fingerprint-a',
          responseChecksum: 'c'.repeat(64),
        },
      ]);
    const client = {
      $queryRawUnsafe: query,
      $executeRawUnsafe: vi.fn(),
      $transaction: async (operation: any) => operation(client),
    };
    const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });

    await expect(repository.getCandidateSet('candidate-set-a')).resolves.toMatchObject({
      id: 'candidate-set-a',
      scope: SCOPE,
      officialCandidates: [{ candidateId: 'official-candidate-a' }],
      createdAt: '2026-07-12T10:05:00.000Z',
    });
  });
});
it('loads the exact current persisted Official input-unit contract for the frozen scope', async () => {
  const at = new Date('2026-07-13T08:00:00.000Z');
  const query = vi.fn(async () => [
    {
      id: 'unit-contract-1',
      tenantId: 'tenant-a',
      shopId: 'shop-a',
      companyId: 'company-a',
      warehouseId: 'warehouse-a',
      originCountryUid: 'china',
      originCityUid: 'xiamen',
      destinationCountryUid: 'russia',
      destinationLocationUid: 'moscow',
      currency: 'CNY',
      weightUnit: 'g',
      dimensionUnit: 'mm',
      weightIncrementG: { toString: () => '0.1' },
      dimensionIncrementMm: { toString: () => '0.25' },
      currencyMinorIncrement: 1,
      sourceRevision: 'official-input-units/v1:' + 'd'.repeat(64),
      sourceChecksum: 'd'.repeat(64),
      reviewerId: 'super-admin-1',
      verifiedAt: new Date('2026-07-13T07:00:00.000Z'),
      validUntil: new Date('2026-07-20T07:00:00.000Z'),
    },
  ]);
  const client = {
    $queryRawUnsafe: query,
    $executeRawUnsafe: vi.fn(),
    $transaction: async (operation: any) => operation(client),
  };
  const repository = createPrismaLogisticsCaptureTaskRepository({ client: client as never });

  await expect(
    repository.loadVerifiedOfficialInputUnitContract({
      assignmentId: 'assignment-a',
      scope: SCOPE,
      destination: { countryUid: 'russia', locationUid: 'moscow' },
      at,
      sourceRevision: 'official-input-units/v1:' + 'd'.repeat(64),
      sourceChecksum: 'd'.repeat(64),
    }),
  ).resolves.toMatchObject({
    id: 'unit-contract-1',
    status: 'VERIFIED',
    scope: SCOPE,
    destination: { countryUid: 'russia', locationUid: 'moscow' },
    currency: 'CNY',
    weightUnit: 'g',
    dimensionUnit: 'mm',
    sourceChecksum: 'd'.repeat(64),
    weightIncrementG: 0.1,
    dimensionIncrementMm: 0.25,
    currencyMinorIncrement: 1,
  });
  const calls = query.mock.calls as unknown as unknown[][];
  const sql = String(calls[0]?.[0]);
  expect(sql).toContain('logistics_official_input_unit_contracts');
  expect(sql).toContain('NOT EXISTS');
  expect(sql).toContain('source_candidate_checksum');
  expect(sql).toContain('c."review_status" = \'VERIFIED\'');
  expect(sql).toContain('ch."channel_type" = \'TENANT\'');
  expect(calls[0]).toContain(at);
});
