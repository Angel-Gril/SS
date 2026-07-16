import { createHash, randomUUID } from 'node:crypto';

export const SOURCE_OZON_CATEGORY_SIGNATURE_VERSION = 'source-ozon-category-signature/v1';

export type SourceOzonCategoryMappingScope = 'TENANT' | 'GLOBAL';
export type SourceOzonCategoryMappingStatus = 'ACTIVE' | 'REJECTED' | 'RETIRED';
export type SourceOzonCategoryMappingDecisionAction = 'CONFIRM' | 'REJECT' | 'PROMOTE';

export interface CanonicalSourceOzonCategoryInput {
  snapshotId: string;
  profileHash: string;
  sourcePlatform: string;
  sourceCategoryId?: string | null;
  sourceCategoryPath: string[];
}

export interface SourceOzonCategoryIdentity {
  snapshotId: string;
  profileHash: string;
  sourcePlatform: string;
  sourceCategoryId: string | null;
  sourceCategoryPath: string[];
  sourceSignature: string;
}

export interface OfficialOzonCategoryTarget {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  catalogRevision: string;
}

export interface SourceOzonCategoryMappingRecord {
  id: string;
  scope: SourceOzonCategoryMappingScope;
  scopeKey: string;
  ownerUserId: string | null;
  sourcePlatform: string;
  sourceCategoryId: string | null;
  sourceCategoryPath: string[];
  sourceSignature: string;
  sourceSnapshotId: string;
  sourceProfileHash: string;
  targetCategoryId: number;
  targetTypeId: number;
  targetCategoryName: string;
  targetTypeName: string;
  catalogRevision: string;
  status: SourceOzonCategoryMappingStatus;
  transitionVersion: number;
  confirmCount: number;
  rejectCount: number;
  createdByUserId: string;
  updatedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  lastConfirmedAt: string | null;
  lastRejectedAt: string | null;
  promotedFromMappingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplyTenantSourceOzonCategoryDecisionInput {
  action: 'CONFIRM' | 'REJECT';
  scope: 'TENANT';
  scopeKey: string;
  ownerUserId: string;
  actorUserId: string;
  expectedTransitionVersion: number;
  source: SourceOzonCategoryIdentity;
  target: OfficialOzonCategoryTarget;
  operationKey: string;
  requestHash: string;
  decidedAt: Date;
}

export interface PromoteGlobalSourceOzonCategoryMappingInput {
  action: 'PROMOTE';
  scope: 'GLOBAL';
  scopeKey: 'global';
  sourceMappingId: string;
  expectedCatalogRevision: string;
  expectedTransitionVersion: number;
  actorUserId: string;
  reviewNote: string;
  operationKey: string;
  requestHash: string;
  reviewedAt: Date;
}

export interface SourceOzonCategoryMappingRepository {
  applyTenantDecision(input: ApplyTenantSourceOzonCategoryDecisionInput): Promise<{
    mapping: SourceOzonCategoryMappingRecord;
    idempotent: boolean;
  }>;
  listVisibleMappings(input: {
    ownerUserId: string;
    tenantScopeKey: string;
    sourceSignature: string;
  }): Promise<SourceOzonCategoryMappingRecord[]>;
  promoteGlobalMapping(input: PromoteGlobalSourceOzonCategoryMappingInput): Promise<{
    mapping: SourceOzonCategoryMappingRecord;
    idempotent: boolean;
  }>;
}

export class SourceOzonCategoryMappingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'SourceOzonCategoryMappingError';
  }
}

function invalid(message: string): never {
  throw new SourceOzonCategoryMappingError('INVALID_SOURCE_OZON_CATEGORY_MAPPING', message, 400);
}

function identifier(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string') return invalid(`${field} is required`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > maxLength) return invalid(`${field} is invalid`);
  return normalized;
}

function checksum(value: unknown, field: string): string {
  const normalized = identifier(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return invalid(`${field} is invalid`);
  return normalized;
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) return invalid(`${field} is invalid`);
  return Number(value);
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return invalid(`${field} is invalid`);
  return Number(value);
}

function normalizedCategoryToken(value: unknown, maxLength: number): string {
  return identifier(value, 'source category token', maxLength)
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function serverNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new SourceOzonCategoryMappingError(
      'SOURCE_OZON_CATEGORY_MAPPING_CLOCK_INVALID',
      'Source Ozon category mapping clock is invalid',
      500,
    );
  }
  return value;
}

function normalizeTarget(input: OfficialOzonCategoryTarget): OfficialOzonCategoryTarget {
  return {
    categoryId: positiveSafeInteger(input.categoryId, 'categoryId'),
    typeId: positiveSafeInteger(input.typeId, 'typeId'),
    categoryName: identifier(input.categoryName, 'official categoryName', 500),
    typeName: identifier(input.typeName, 'official typeName', 500),
    catalogRevision: identifier(input.catalogRevision, 'catalogRevision', 200),
  };
}

function tenantScopeKey(ownerUserId: string): string {
  return `tenant:${ownerUserId}`;
}

export function deriveSourceOzonCategoryIdentity(
  input: CanonicalSourceOzonCategoryInput,
): SourceOzonCategoryIdentity {
  const sourcePlatform = normalizedCategoryToken(input.sourcePlatform, 40);
  if (!['1688', 'pdd', 'taobao', 'tmall'].includes(sourcePlatform)) {
    return invalid('sourcePlatform is unsupported');
  }
  const sourceCategoryId = input.sourceCategoryId == null || input.sourceCategoryId === ''
    ? null
    : normalizedCategoryToken(input.sourceCategoryId, 200);
  if (!Array.isArray(input.sourceCategoryPath) || input.sourceCategoryPath.length > 50) {
    return invalid('sourceCategoryPath is invalid');
  }
  const sourceCategoryPath = input.sourceCategoryPath
    .map((part) => normalizedCategoryToken(part, 160));
  if (!sourceCategoryId && sourceCategoryPath.length === 0) {
    return invalid('a canonical source category id or path is required');
  }
  const signaturePayload = {
    schema: SOURCE_OZON_CATEGORY_SIGNATURE_VERSION,
    sourcePlatform,
    sourceCategoryId,
    sourceCategoryPath,
  };
  return {
    snapshotId: identifier(input.snapshotId, 'snapshotId'),
    profileHash: checksum(input.profileHash, 'profileHash'),
    sourcePlatform,
    sourceCategoryId,
    sourceCategoryPath,
    sourceSignature: hash(signaturePayload),
  };
}

function tenantDecisionIdentity(input: {
  action: 'CONFIRM' | 'REJECT';
  scopeKey: string;
  actorUserId: string;
  expectedTransitionVersion: number;
  source: SourceOzonCategoryIdentity;
  target: OfficialOzonCategoryTarget;
}) {
  return {
    schema: 'source-ozon-category-decision-key/v1',
    action: input.action,
    scopeKey: input.scopeKey,
    actorUserId: input.actorUserId,
    expectedTransitionVersion: input.expectedTransitionVersion,
    snapshotId: input.source.snapshotId,
    sourceSignature: input.source.sourceSignature,
    targetCategoryId: input.target.categoryId,
    targetTypeId: input.target.typeId,
    catalogRevision: input.target.catalogRevision,
  };
}

export function createSourceOzonCategoryMappingService(options: {
  repository: SourceOzonCategoryMappingRepository;
  now?: () => Date;
}) {
  const now = options.now || (() => new Date());

  const applyTenantDecision = async (input: {
    action: 'CONFIRM' | 'REJECT';
    ownerUserId: string;
    actorUserId: string;
    expectedTransitionVersion: number;
    source: CanonicalSourceOzonCategoryInput;
    target: OfficialOzonCategoryTarget;
  }) => {
    const ownerUserId = identifier(input.ownerUserId, 'ownerUserId');
    const actorUserId = identifier(input.actorUserId, 'actorUserId');
    const expectedTransitionVersion = nonNegativeSafeInteger(
      input.expectedTransitionVersion,
      'expectedTransitionVersion',
    );
    const source = deriveSourceOzonCategoryIdentity(input.source);
    const target = normalizeTarget(input.target);
    const scopeKey = tenantScopeKey(ownerUserId);
    const logicalDecision = tenantDecisionIdentity({
      action: input.action,
      scopeKey,
      actorUserId,
      expectedTransitionVersion,
      source,
      target,
    });
    const request = {
      ...logicalDecision,
      profileHash: source.profileHash,
      sourcePlatform: source.sourcePlatform,
      sourceCategoryId: source.sourceCategoryId,
      sourceCategoryPath: source.sourceCategoryPath,
      targetCategoryName: target.categoryName,
      targetTypeName: target.typeName,
    };
    return options.repository.applyTenantDecision({
      action: input.action,
      scope: 'TENANT',
      scopeKey,
      ownerUserId,
      actorUserId,
      expectedTransitionVersion,
      source,
      target,
      operationKey: hash(logicalDecision),
      requestHash: hash(request),
      decidedAt: serverNow(now),
    });
  };

  return {
    confirmTenantMapping(input: {
      ownerUserId: string;
      actorUserId: string;
      expectedTransitionVersion: number;
      source: CanonicalSourceOzonCategoryInput;
      target: OfficialOzonCategoryTarget;
    }) {
      return applyTenantDecision({ ...input, action: 'CONFIRM' });
    },

    rejectTenantMapping(input: {
      ownerUserId: string;
      actorUserId: string;
      expectedTransitionVersion: number;
      source: CanonicalSourceOzonCategoryInput;
      target: OfficialOzonCategoryTarget;
    }) {
      return applyTenantDecision({ ...input, action: 'REJECT' });
    },

    async listVisibleMappings(input: {
      ownerUserId: string;
      source: CanonicalSourceOzonCategoryInput;
    }) {
      const ownerUserId = identifier(input.ownerUserId, 'ownerUserId');
      const source = deriveSourceOzonCategoryIdentity(input.source);
      const ownScopeKey = tenantScopeKey(ownerUserId);
      const rows = await options.repository.listVisibleMappings({
        ownerUserId,
        tenantScopeKey: ownScopeKey,
        sourceSignature: source.sourceSignature,
      });
      return rows.filter((row) => (
        row.status === 'ACTIVE'
        && row.sourceSignature === source.sourceSignature
        && (
          (row.scope === 'TENANT' && row.scopeKey === ownScopeKey && row.ownerUserId === ownerUserId)
          || (row.scope === 'GLOBAL'
            && row.scopeKey === 'global'
            && row.ownerUserId === null
            && !!row.reviewedByUserId
            && !!row.reviewedAt)
        )
      ));
    },

    async promoteGlobalMapping(input: {
      sourceMappingId: string;
      expectedGlobalTransitionVersion: number;
      expectedCatalogRevision: string;
      actorUserId: string;
      actorRole: string;
      isSuperAdmin: boolean;
      reviewNote: string;
    }) {
      if (input.actorRole !== 'ADMIN' || input.isSuperAdmin !== true) {
        throw new SourceOzonCategoryMappingError(
          'GLOBAL_PROMOTION_FORBIDDEN',
          'Global Ozon category mapping promotion requires a super administrator',
          403,
        );
      }
      const sourceMappingId = identifier(input.sourceMappingId, 'sourceMappingId');
      const expectedCatalogRevision = identifier(
        input.expectedCatalogRevision,
        'expectedCatalogRevision',
      );
      const expectedTransitionVersion = nonNegativeSafeInteger(
        input.expectedGlobalTransitionVersion,
        'expectedGlobalTransitionVersion',
      );
      const actorUserId = identifier(input.actorUserId, 'actorUserId');
      const reviewNote = identifier(input.reviewNote, 'reviewNote', 1000);
      if (reviewNote.length < 3) return invalid('reviewNote is invalid');
      const logicalDecision = {
        schema: 'source-ozon-category-global-promotion-key/v1',
        action: 'PROMOTE' as const,
        sourceMappingId,
        expectedCatalogRevision,
        expectedTransitionVersion,
        actorUserId,
      };
      return options.repository.promoteGlobalMapping({
        action: 'PROMOTE',
        scope: 'GLOBAL',
        scopeKey: 'global',
        sourceMappingId,
        expectedCatalogRevision,
        expectedTransitionVersion,
        actorUserId,
        reviewNote,
        operationKey: hash(logicalDecision),
        requestHash: hash({ ...logicalDecision, reviewNote }),
        reviewedAt: serverNow(now),
      });
    },
  };
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function mappingRecord(row: any): SourceOzonCategoryMappingRecord {
  return {
    id: String(row.id),
    scope: row.scope,
    scopeKey: String(row.scopeKey),
    ownerUserId: row.ownerUserId == null ? null : String(row.ownerUserId),
    sourcePlatform: String(row.sourcePlatform),
    sourceCategoryId: row.sourceCategoryId == null ? null : String(row.sourceCategoryId),
    sourceCategoryPath: Array.isArray(row.sourceCategoryPath)
      ? row.sourceCategoryPath.map(String)
      : [],
    sourceSignature: String(row.sourceSignature),
    sourceSnapshotId: String(row.sourceSnapshotId),
    sourceProfileHash: String(row.sourceProfileHash),
    targetCategoryId: Number(row.targetCategoryId),
    targetTypeId: Number(row.targetTypeId),
    targetCategoryName: String(row.targetCategoryName),
    targetTypeName: String(row.targetTypeName),
    catalogRevision: String(row.catalogRevision),
    status: row.status,
    transitionVersion: Number(row.confirmCount) + Number(row.rejectCount),
    confirmCount: Number(row.confirmCount),
    rejectCount: Number(row.rejectCount),
    createdByUserId: String(row.createdByUserId),
    updatedByUserId: String(row.updatedByUserId),
    reviewedByUserId: row.reviewedByUserId == null ? null : String(row.reviewedByUserId),
    reviewedAt: iso(row.reviewedAt),
    lastConfirmedAt: iso(row.lastConfirmedAt),
    lastRejectedAt: iso(row.lastRejectedAt),
    promotedFromMappingId: row.promotedFromMappingId == null
      ? null
      : String(row.promotedFromMappingId),
    createdAt: iso(row.createdAt) || '',
    updatedAt: iso(row.updatedAt) || '',
  };
}

function idempotencyConflict(): SourceOzonCategoryMappingError {
  return new SourceOzonCategoryMappingError(
    'SOURCE_OZON_CATEGORY_MAPPING_IDEMPOTENCY_CONFLICT',
    'Source Ozon category mapping decision key was reused with a different request',
    409,
  );
}

function mappingTransitionVersion(row: any | null): number {
  if (!row) return 0;
  const version = Number(row.confirmCount) + Number(row.rejectCount);
  if (!Number.isSafeInteger(version) || version <= 0) {
    throw new SourceOzonCategoryMappingError(
      'SOURCE_OZON_CATEGORY_MAPPING_AUDIT_BROKEN',
      'Source Ozon category mapping transition counters are invalid',
      500,
    );
  }
  return version;
}

function transitionDecisionKey(operationKey: string, transitionVersion: number): string {
  return hash({
    schema: 'source-ozon-category-transition-key/v1',
    operationKey,
    transitionVersion,
  });
}

async function resolveExpectedTransition(
  client: any,
  row: any | null,
  expectedTransitionVersion: number,
  operationKey: string,
  requestHash: string,
): Promise<
  | { kind: 'apply'; transitionVersion: number }
  | { kind: 'idempotent'; mapping: SourceOzonCategoryMappingRecord }
> {
  const currentVersion = mappingTransitionVersion(row);
  if (currentVersion === expectedTransitionVersion) {
    return { kind: 'apply', transitionVersion: currentVersion + 1 };
  }
  if (!row || currentVersion < expectedTransitionVersion) {
    throw new SourceOzonCategoryMappingError(
      'SOURCE_OZON_CATEGORY_MAPPING_VERSION_CONFLICT',
      'Source Ozon category mapping transition version changed',
      409,
    );
  }
  const transitionVersion = expectedTransitionVersion + 1;
  const decision = await client.sourceOzonCategoryMappingDecision.findUnique({
    where: {
      source_ozon_category_mapping_transition_key: {
        mappingId: String(row.id),
        transitionVersion,
      },
    },
  });
  if (!decision || String(decision.operationKey) !== operationKey) {
    throw new SourceOzonCategoryMappingError(
      'SOURCE_OZON_CATEGORY_MAPPING_VERSION_CONFLICT',
      'Source Ozon category mapping transition version changed',
      409,
    );
  }
  if (String(decision.requestHash) !== requestHash) throw idempotencyConflict();
  return { kind: 'idempotent', mapping: mappingRecord(row) };
}

export class PrismaSourceOzonCategoryMappingRepository
implements SourceOzonCategoryMappingRepository {
  constructor(private readonly prisma: any) {}

  private async runTransition<T>(callback: (tx: any) => Promise<T>): Promise<T> {
    let lastConflict: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(callback, { isolationLevel: 'Serializable' });
      } catch (error: any) {
        if (!['P2002', 'P2034'].includes(String(error?.code || ''))) throw error;
        lastConflict = error;
      }
    }
    throw lastConflict;
  }

  async applyTenantDecision(input: ApplyTenantSourceOzonCategoryDecisionInput) {
    return this.runTransition(async (tx: any) => {
      const identity = {
        scopeKey: input.scopeKey,
        sourceSignature: input.source.sourceSignature,
        targetCategoryId: input.target.categoryId,
        targetTypeId: input.target.typeId,
      };
      const current = await tx.sourceOzonCategoryMapping.findUnique({
        where: { source_ozon_category_mapping_identity_key: identity },
      });
      const transition = await resolveExpectedTransition(
        tx,
        current,
        input.expectedTransitionVersion,
        input.operationKey,
        input.requestHash,
      );
      if (transition.kind === 'idempotent') {
        return { mapping: transition.mapping, idempotent: true };
      }
      const transitionVersion = transition.transitionVersion;

      const confirmed = input.action === 'CONFIRM';
      const mapping = await tx.sourceOzonCategoryMapping.upsert({
        where: {
          source_ozon_category_mapping_identity_key: identity,
        },
        create: {
          id: randomUUID(),
          scope: 'TENANT',
          scopeKey: input.scopeKey,
          ownerUserId: input.ownerUserId,
          sourcePlatform: input.source.sourcePlatform,
          sourceCategoryId: input.source.sourceCategoryId,
          sourceCategoryPath: input.source.sourceCategoryPath,
          sourceSignature: input.source.sourceSignature,
          sourceSnapshotId: input.source.snapshotId,
          sourceProfileHash: input.source.profileHash,
          targetCategoryId: input.target.categoryId,
          targetTypeId: input.target.typeId,
          targetCategoryName: input.target.categoryName,
          targetTypeName: input.target.typeName,
          catalogRevision: input.target.catalogRevision,
          status: confirmed ? 'ACTIVE' : 'REJECTED',
          confirmCount: confirmed ? 1 : 0,
          rejectCount: confirmed ? 0 : 1,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
          reviewedByUserId: input.actorUserId,
          reviewedAt: input.decidedAt,
          lastConfirmedAt: confirmed ? input.decidedAt : null,
          lastRejectedAt: confirmed ? null : input.decidedAt,
          promotedFromMappingId: null,
          createdAt: input.decidedAt,
          updatedAt: input.decidedAt,
        },
        update: {
          sourcePlatform: input.source.sourcePlatform,
          sourceCategoryId: input.source.sourceCategoryId,
          sourceCategoryPath: input.source.sourceCategoryPath,
          sourceSnapshotId: input.source.snapshotId,
          sourceProfileHash: input.source.profileHash,
          targetCategoryName: input.target.categoryName,
          targetTypeName: input.target.typeName,
          catalogRevision: input.target.catalogRevision,
          status: confirmed ? 'ACTIVE' : 'REJECTED',
          ...(confirmed
            ? { confirmCount: { increment: 1 }, lastConfirmedAt: input.decidedAt }
            : { rejectCount: { increment: 1 }, lastRejectedAt: input.decidedAt }),
          updatedByUserId: input.actorUserId,
          reviewedByUserId: input.actorUserId,
          reviewedAt: input.decidedAt,
          updatedAt: input.decidedAt,
        },
      });

      await tx.sourceOzonCategoryMappingDecision.create({
        data: {
          id: randomUUID(),
          mappingId: mapping.id,
          operationKey: input.operationKey,
          transitionVersion,
          decisionKey: transitionDecisionKey(input.operationKey, transitionVersion),
          requestHash: input.requestHash,
          action: input.action,
          scope: 'TENANT',
          scopeKey: input.scopeKey,
          ownerUserId: input.ownerUserId,
          actorUserId: input.actorUserId,
          sourceSnapshotId: input.source.snapshotId,
          sourceProfileHash: input.source.profileHash,
          catalogRevision: input.target.catalogRevision,
          reviewNote: null,
          createdAt: input.decidedAt,
        },
      });
      return { mapping: mappingRecord(mapping), idempotent: false };
    });
  }

  async listVisibleMappings(input: {
    ownerUserId: string;
    tenantScopeKey: string;
    sourceSignature: string;
  }) {
    const rows = await this.prisma.sourceOzonCategoryMapping.findMany({
      where: {
        sourceSignature: input.sourceSignature,
        status: 'ACTIVE',
        OR: [
          {
            scope: 'TENANT',
            scopeKey: input.tenantScopeKey,
            ownerUserId: input.ownerUserId,
          },
          {
            scope: 'GLOBAL',
            scopeKey: 'global',
            ownerUserId: null,
            reviewedByUserId: { not: null },
            reviewedAt: { not: null },
          },
        ],
      },
      orderBy: [
        { scope: 'asc' },
        { confirmCount: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
    return rows.map(mappingRecord);
  }

  async promoteGlobalMapping(input: PromoteGlobalSourceOzonCategoryMappingInput) {
    return this.runTransition(async (tx: any) => {
      const source = await tx.sourceOzonCategoryMapping.findFirst({
        where: {
          id: input.sourceMappingId,
          scope: 'TENANT',
          status: 'ACTIVE',
          catalogRevision: input.expectedCatalogRevision,
        },
      });
      if (!source) {
        throw new SourceOzonCategoryMappingError(
          'GLOBAL_PROMOTION_SOURCE_INVALID',
          'Global promotion requires an active tenant mapping at the expected catalog revision',
          409,
        );
      }
      const identity = {
        scopeKey: 'global',
        sourceSignature: source.sourceSignature,
        targetCategoryId: source.targetCategoryId,
        targetTypeId: source.targetTypeId,
      };
      const current = await tx.sourceOzonCategoryMapping.findUnique({
        where: { source_ozon_category_mapping_identity_key: identity },
      });
      const transition = await resolveExpectedTransition(
        tx,
        current,
        input.expectedTransitionVersion,
        input.operationKey,
        input.requestHash,
      );
      if (transition.kind === 'idempotent') {
        return { mapping: transition.mapping, idempotent: true };
      }
      const transitionVersion = transition.transitionVersion;

      const mapping = await tx.sourceOzonCategoryMapping.upsert({
        where: {
          source_ozon_category_mapping_identity_key: identity,
        },
        create: {
          id: randomUUID(),
          scope: 'GLOBAL',
          scopeKey: 'global',
          ownerUserId: null,
          sourcePlatform: source.sourcePlatform,
          sourceCategoryId: source.sourceCategoryId,
          sourceCategoryPath: source.sourceCategoryPath,
          sourceSignature: source.sourceSignature,
          sourceSnapshotId: source.sourceSnapshotId,
          sourceProfileHash: source.sourceProfileHash,
          targetCategoryId: source.targetCategoryId,
          targetTypeId: source.targetTypeId,
          targetCategoryName: source.targetCategoryName,
          targetTypeName: source.targetTypeName,
          catalogRevision: source.catalogRevision,
          status: 'ACTIVE',
          confirmCount: 1,
          rejectCount: 0,
          createdByUserId: input.actorUserId,
          updatedByUserId: input.actorUserId,
          reviewedByUserId: input.actorUserId,
          reviewedAt: input.reviewedAt,
          lastConfirmedAt: input.reviewedAt,
          lastRejectedAt: null,
          promotedFromMappingId: source.id,
          createdAt: input.reviewedAt,
          updatedAt: input.reviewedAt,
        },
        update: {
          sourcePlatform: source.sourcePlatform,
          sourceCategoryId: source.sourceCategoryId,
          sourceCategoryPath: source.sourceCategoryPath,
          sourceSnapshotId: source.sourceSnapshotId,
          sourceProfileHash: source.sourceProfileHash,
          targetCategoryName: source.targetCategoryName,
          targetTypeName: source.targetTypeName,
          catalogRevision: source.catalogRevision,
          status: 'ACTIVE',
          confirmCount: { increment: 1 },
          updatedByUserId: input.actorUserId,
          reviewedByUserId: input.actorUserId,
          reviewedAt: input.reviewedAt,
          lastConfirmedAt: input.reviewedAt,
          promotedFromMappingId: source.id,
          updatedAt: input.reviewedAt,
        },
      });
      await tx.sourceOzonCategoryMappingDecision.create({
        data: {
          id: randomUUID(),
          mappingId: mapping.id,
          operationKey: input.operationKey,
          transitionVersion,
          decisionKey: transitionDecisionKey(input.operationKey, transitionVersion),
          requestHash: input.requestHash,
          action: 'PROMOTE',
          scope: 'GLOBAL',
          scopeKey: 'global',
          ownerUserId: null,
          actorUserId: input.actorUserId,
          sourceSnapshotId: source.sourceSnapshotId,
          sourceProfileHash: source.sourceProfileHash,
          catalogRevision: source.catalogRevision,
          reviewNote: input.reviewNote,
          createdAt: input.reviewedAt,
        },
      });
      return { mapping: mappingRecord(mapping), idempotent: false };
    });
  }
}
