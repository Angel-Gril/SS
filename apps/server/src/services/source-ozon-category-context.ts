import type { SourceProductProfile } from './source-product-profile.js';
import type { CanonicalSourceOzonCategoryInput } from './source-ozon-category-mapping.js';

export interface SourceOzonCategorySnapshotRecord {
  id: string;
  profileHash: string;
  payload: unknown;
  profile: unknown;
}

export interface SourceOzonCategoryContextRepository {
  findLatestSnapshot(input: {
    ownerUserId: string;
    supplyGoodsId: string;
  }): Promise<SourceOzonCategorySnapshotRecord | null>;
}

export interface SourceOzonCategoryContext {
  source: CanonicalSourceOzonCategoryInput;
  profile: SourceProductProfile;
}

export class SourceOzonCategoryContextError extends Error {
  readonly code = 'SOURCE_OZON_CATEGORY_CONTEXT_UNAVAILABLE';
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = 'SourceOzonCategoryContextError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredIdentifier(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 200) {
    throw new SourceOzonCategoryContextError(`Canonical ${field} is unavailable`);
  }
  return text;
}

export function createSourceOzonCategoryContextLoader(options: {
  repository: SourceOzonCategoryContextRepository;
}) {
  return {
    async load(input: {
      ownerUserId: string;
      supplyGoodsId: string;
    }): Promise<SourceOzonCategoryContext> {
      const ownerUserId = requiredIdentifier(input.ownerUserId, 'owner');
      const supplyGoodsId = requiredIdentifier(input.supplyGoodsId, 'supply goods');
      const snapshot = await options.repository.findLatestSnapshot({ ownerUserId, supplyGoodsId });
      if (!snapshot) throw new SourceOzonCategoryContextError('Canonical source snapshot is unavailable');

      const payload = record(snapshot.payload);
      const sourceCategory = record(payload?.sourceCategory);
      const profile = record(snapshot.profile);
      const profileHash = String(snapshot.profileHash || '').trim().toLowerCase();
      if (!payload || !sourceCategory || !profile || !/^[a-f0-9]{64}$/.test(profileHash)) {
        throw new SourceOzonCategoryContextError('Canonical source category profile is invalid');
      }

      const sourceCategoryId = sourceCategory.id == null
        ? null
        : String(sourceCategory.id).normalize('NFKC').trim() || null;
      const sourceCategoryPath = Array.isArray(sourceCategory.path)
        ? sourceCategory.path.map((part) => String(part)).filter((part) => part.trim())
        : [];
      if ((!sourceCategoryId && sourceCategoryPath.length === 0) || sourceCategoryPath.length > 50) {
        throw new SourceOzonCategoryContextError('Canonical source category identity is unavailable');
      }

      return {
        source: {
          snapshotId: requiredIdentifier(snapshot.id, 'snapshot id'),
          profileHash,
          sourcePlatform: requiredIdentifier(payload.platform, 'source platform'),
          sourceCategoryId,
          sourceCategoryPath,
        },
        profile: profile as unknown as SourceProductProfile,
      };
    },
  };
}

export class PrismaSourceOzonCategoryContextRepository
implements SourceOzonCategoryContextRepository {
  constructor(private readonly prisma: any) {}

  async findLatestSnapshot(input: { ownerUserId: string; supplyGoodsId: string }) {
    const subject = await this.prisma.sourceCaptureSubject.findFirst({
      where: {
        ownerUserId: input.ownerUserId,
        legacySupplyGoodsId: input.supplyGoodsId,
      },
      select: {
        snapshots: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, profileHash: true, payload: true, profile: true },
        },
      },
    });
    return subject?.snapshots?.[0] || null;
  }
}
