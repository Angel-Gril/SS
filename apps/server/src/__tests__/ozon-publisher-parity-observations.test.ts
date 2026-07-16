import { describe, expect, it, vi } from 'vitest';

import {
  createOzonPublisherParityObservationService,
  deriveOzonPublisherParityDifferenceSubject,
  normalizeOzonPublisherParityReport,
  OzonPublisherParityObservationError,
  type OzonPublisherParityDifferenceSubject,
  type OzonPublisherParityDifferenceSubjectRecord,
  type OzonPublisherParityObservationRepository,
} from '../services/ozon-publisher-parity-observations.js';
import {
  compareOzonPublisherEntrypointParity,
  type OzonPublisherEntrypointParityReport,
} from '../services/ozon-publisher-entrypoint-parity.js';

function intentionalDifferenceReport(): OzonPublisherEntrypointParityReport {
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'COLLECT_PUBLISH_OZON',
    legacy: {
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'private-offer', weight: 500 }] },
    },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: { items: [{ offer_id: 'private-offer' }] },
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

function defectDifferenceReport(): OzonPublisherEntrypointParityReport {
  return compareOzonPublisherEntrypointParity({
    entrypoint: 'LISTING_BATCH',
    legacy: { endpoint: '/v3/product/import', payload: { items: [{ vat: '0' }] } },
    v2: {
      kind: 'COMPILED',
      endpoint: '/v3/product/import',
      payload: { items: [{ vat: '20' }] },
      compilerVersions: {
        publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
        payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
      },
    },
  });
}

function subject(
  report = intentionalDifferenceReport(),
  rolloutRevision = 'rollout-revision-7',
): OzonPublisherParityDifferenceSubject {
  const value = deriveOzonPublisherParityDifferenceSubject(
    normalizeOzonPublisherParityReport(report),
    rolloutRevision,
  );
  if (!value) throw new Error('test report must produce a difference subject');
  return value;
}

function storedSubject(
  report = intentionalDifferenceReport(),
): OzonPublisherParityDifferenceSubjectRecord {
  return {
    ...subject(report),
    approvalState: 'PENDING',
    stateVersion: 0,
    observationCount: 1,
    firstObservedAt: '2026-07-16T01:00:00.000Z',
    lastObservedAt: '2026-07-16T01:00:00.000Z',
    reviewedByUserId: null,
    reviewNote: null,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    revokedAt: null,
  };
}

function repository(
  overrides: Partial<OzonPublisherParityObservationRepository> = {},
): OzonPublisherParityObservationRepository {
  return {
    createObservation: vi.fn(async (input) => ({ observation: input, created: true })),
    listObservations: vi.fn(async () => ({ observations: [], nextCursor: null })),
    findDifferenceSubject: vi.fn(async () => null),
    listDifferenceSubjects: vi.fn(async () => ({ subjects: [], nextCursor: null })),
    applyDifferenceReview: vi.fn(async () => { throw new Error('not configured'); }),
    pruneObservations: vi.fn(async () => ({ deletedCount: 0, hasMore: false })),
    ...overrides,
  };
}

describe('Ozon publisher parity observation service', () => {
  it('creates a bounded normalized observation and strips unrecognized report fields', async () => {
    const createObservation = vi.fn(async (input) => ({ observation: input, created: true }));
    const service = createOzonPublisherParityObservationService({
      repository: repository({ createObservation }),
      now: () => new Date('2026-07-16T01:00:00.000Z'),
      createId: () => 'observation-1',
    });
    const report = intentionalDifferenceReport() as OzonPublisherEntrypointParityReport & {
      privateToken?: string;
    };
    report.privateToken = 'Bearer must-never-persist';
    (report.differences.rows[0] as any).legacyValue = 'private product value';

    const result = await service.recordObservation({
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'rollout-revision-7',
      report,
    });

    expect(result.observation).toMatchObject({
      id: 'observation-1',
      recordKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      contractVersion: 'ozon-publisher-parity-observation/v1',
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'rollout-revision-7',
      entrypoint: 'COLLECT_PUBLISH_OZON',
      approvalEligible: true,
      differenceSubjectKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      reportHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      observedAt: '2026-07-16T01:00:00.000Z',
      expiresAt: '2027-01-12T01:00:00.000Z',
      report: {
        status: 'DIFFERENT',
        classification: 'INTENTIONAL_STRICTER',
        switchEligible: false,
        differences: {
          total: 1,
          returned: 1,
          truncated: false,
          rows: [{ path: '/items/0/weight', classification: 'INTENTIONAL_STRICTER' }],
        },
      },
    });
    const serialized = JSON.stringify(createObservation.mock.calls[0]![0]);
    expect(serialized).not.toContain('must-never-persist');
    expect(serialized).not.toContain('private product value');
    expect(serialized).not.toContain('private-offer');
  });

  it('requires the exact comparator contract and exact compiler v1 before creating a subject', () => {
    const report = intentionalDifferenceReport();
    const unknownCompiler = structuredClone(report) as any;
    unknownCompiler.status = 'NOT_COMPARABLE';
    unknownCompiler.classification = 'NOT_COMPARABLE';
    unknownCompiler.v2.compilerVersions = {
      publisherContractVersion: 'ozon-private-compiler/v1',
      payloadCompilerVersion: 'Bearer private-token',
    };

    const normalized = normalizeOzonPublisherParityReport(unknownCompiler);

    expect(normalized.v2.compilerVersions).toEqual({
      publisherContractVersion: null,
      payloadCompilerVersion: null,
    });
    expect(deriveOzonPublisherParityDifferenceSubject(normalized, 'rollout-revision-7')).toBeNull();
    expect(JSON.stringify(normalized)).not.toContain('private-token');
    expect(() => normalizeOzonPublisherParityReport({
      ...report,
      contractVersion: 'ozon-publisher-entrypoint-parity/v2',
    })).toThrowError(expect.objectContaining({
      code: 'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
    } satisfies Partial<OzonPublisherParityObservationError>));
  });

  it('normalizes the direct listing import-by-SKU entrypoint', () => {
    const product = { offer_id: 'private-offer' };
    const normalized = normalizeOzonPublisherParityReport(compareOzonPublisherEntrypointParity({
      entrypoint: 'LISTING_IMPORT_BY_SKU',
      legacy: { endpoint: '/v1/product/import-by-sku', payload: { items: [product] } },
      v2: {
        kind: 'COMPILED',
        endpoint: '/v3/product/import',
        payload: { items: [structuredClone(product)] },
        compilerVersions: {
          publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
          payloadCompilerVersion: 'ozon-listing-payload-compiler/v1',
        },
      },
    }));

    expect(normalized.entrypoint).toBe('LISTING_IMPORT_BY_SKU');
  });

  it.each([
    ['bad hash', (report: any) => { report.legacy.payloadHash = 'not-a-hash'; }],
    ['count mismatch', (report: any) => { report.differences.returned = 0; }],
    ['secret path', (report: any) => { report.differences.rows[0].path = '/items/0/private-secret'; }],
    ['oversized rows', (report: any) => {
      report.differences.rows = new Array(101).fill(report.differences.rows[0]);
      report.differences.returned = 101;
      report.differences.total = 101;
    }],
  ])('rejects a parity report with %s', (_label, mutate) => {
    const report = structuredClone(intentionalDifferenceReport()) as any;
    mutate(report);

    expect(() => normalizeOzonPublisherParityReport(report)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION' }),
    );
  });

  it('creates subjects only for complete compiled differences and approves only safe classifications', () => {
    const intentional = subject();
    const defect = subject(defectDifferenceReport());
    const truncatedReport = structuredClone(intentionalDifferenceReport()) as any;
    truncatedReport.differences.total = 2;
    truncatedReport.differences.truncated = true;
    const truncated = normalizeOzonPublisherParityReport(truncatedReport);
    const blocked = normalizeOzonPublisherParityReport(compareOzonPublisherEntrypointParity({
      entrypoint: 'COLLECT_PUBLISH_OZON',
      legacy: { endpoint: '/v3/product/import', payload: { items: [{}] } },
      v2: { kind: 'BLOCKED', blockerCode: 'OZON_LISTING_COMPILE_PACKAGE_INVALID' },
    }));

    expect(intentional).toMatchObject({ complete: true, approvalEligible: true });
    expect(defect).toMatchObject({ classification: 'DEFECT', approvalEligible: false });
    expect(deriveOzonPublisherParityDifferenceSubject(truncated, 'rollout-revision-7')).toBeNull();
    expect(deriveOzonPublisherParityDifferenceSubject(blocked, 'rollout-revision-7')).toBeNull();
    expect(subject(intentionalDifferenceReport(), 'rollout-revision-8').key).not.toBe(intentional.key);
    expect(intentional).toMatchObject({
      rolloutRevision: 'rollout-revision-7',
      legacyEndpointKind: 'OZON_V3_PRODUCT_IMPORT',
      v2EndpointKind: 'OZON_V3_PRODUCT_IMPORT',
      rows: [{ path: '/items/0/weight' }],
    });
  });

  it.each(['APPROVE', 'REJECT', 'REVOKE'] as const)(
    'gates %s behind super-admin and sends deterministic CAS hashes to the repository',
    async (action) => {
      const differenceSubject = storedSubject();
      const applyDifferenceReview = vi.fn(async (input) => ({
        review: {
          subjectKey: input.subjectKey,
          status: action === 'APPROVE' ? 'APPROVED' as const
            : action === 'REJECT' ? 'REJECTED' as const : 'REVOKED' as const,
          transitionVersion: input.expectedTransitionVersion + 1,
          actorUserId: input.actorUserId,
          reviewNote: input.reviewNote,
          reviewedAt: input.reviewedAt.toISOString(),
          operationKey: input.operationKey,
          requestHash: input.requestHash,
        },
        idempotent: false,
      }));
      const service = createOzonPublisherParityObservationService({
        repository: repository({
          findDifferenceSubject: vi.fn(async () => differenceSubject),
          applyDifferenceReview,
        }),
        now: () => new Date('2026-07-16T02:00:00.000Z'),
      });
      const input = {
        action,
        subjectKey: differenceSubject.key,
        expectedTransitionVersion: 0,
        actorUserId: 'super-admin-1',
        actorRole: 'ADMIN',
        isSuperAdmin: false,
        reviewNote: 'Reviewed against the complete sanitized difference.',
      };

      await expect(service.reviewDifference(input)).rejects.toMatchObject({
        code: 'OZON_PUBLISHER_PARITY_REVIEW_FORBIDDEN',
        statusCode: 403,
      });
      expect(applyDifferenceReview).not.toHaveBeenCalled();

      await service.reviewDifference({ ...input, isSuperAdmin: true });
      await service.reviewDifference({ ...input, isSuperAdmin: true });
      const first = applyDifferenceReview.mock.calls[0]![0];
      const second = applyDifferenceReview.mock.calls[1]![0];
      expect(first).toMatchObject({
        action,
        subjectKey: differenceSubject.key,
        expectedTransitionVersion: 0,
        actorUserId: 'super-admin-1',
        reviewedAt: new Date('2026-07-16T02:00:00.000Z'),
        operationKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(second.operationKey).toBe(first.operationKey);
      expect(second.requestHash).toBe(first.requestHash);
    },
  );

  it('rejects approval for a defect subject without changing report switch eligibility', async () => {
    const report = normalizeOzonPublisherParityReport(defectDifferenceReport());
    const differenceSubject = storedSubject(defectDifferenceReport());
    const applyDifferenceReview = vi.fn();
    const service = createOzonPublisherParityObservationService({
      repository: repository({
        findDifferenceSubject: vi.fn(async () => differenceSubject),
        applyDifferenceReview,
      }),
    });

    await expect(service.reviewDifference({
      action: 'APPROVE',
      subjectKey: differenceSubject.key,
      expectedTransitionVersion: 0,
      actorUserId: 'super-admin-1',
      actorRole: 'ADMIN',
      isSuperAdmin: true,
      reviewNote: 'This defect must not be approved.',
    })).rejects.toMatchObject({ code: 'OZON_PUBLISHER_PARITY_DIFFERENCE_NOT_APPROVABLE' });
    expect(applyDifferenceReview).not.toHaveBeenCalled();
    expect(report.switchEligible).toBe(false);
  });

  it('validates retention bounds and transparently delegates list and prune operations', async () => {
    const listObservations = vi.fn(async () => ({ observations: [], nextCursor: null }));
    const listDifferenceSubjects = vi.fn(async () => ({ subjects: [], nextCursor: null }));
    const pruneObservations = vi.fn(async () => ({ deletedCount: 7, hasMore: true }));
    const service = createOzonPublisherParityObservationService({
      repository: repository({ listObservations, listDifferenceSubjects, pruneObservations }),
    });

    expect(() => service.recordObservation({
      scopeHash: 'a'.repeat(64),
      rolloutRevision: 'revision-1',
      report: intentionalDifferenceReport(),
      retentionDays: 29,
    })).toThrowError(expect.objectContaining({
      code: 'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
    }));

    const listInput = { entrypoint: 'LISTING_IMPORT_BY_SKU' as const, limit: 50 };
    await service.listObservations(listInput);
    expect(listObservations).toHaveBeenCalledWith(listInput);
    const subjectListInput = { rolloutRevision: 'revision-1', limit: 25 };
    await service.listDifferenceSubjects(subjectListInput);
    expect(listDifferenceSubjects).toHaveBeenCalledWith(subjectListInput);
    const pruneInput = { expiredBefore: new Date('2026-01-01T00:00:00.000Z'), limit: 500 };
    await expect(service.pruneExpiredObservations(pruneInput)).resolves.toEqual({
      deletedCount: 7,
      hasMore: true,
    });
    expect(pruneObservations).toHaveBeenCalledWith(pruneInput);
  });
});
