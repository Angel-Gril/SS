import type { PrismaClient } from '@prisma/client';
import type {
  ExtensionByokMediaProvenanceCreateInput,
  ExtensionByokMediaProvenanceCreateResult,
  ExtensionByokMediaProvenanceLinkPublishInput,
  ExtensionByokMediaProvenancePublishResult,
  ExtensionByokMediaProvenanceRecord,
  ExtensionByokMediaProvenanceRepository,
} from '../services/extension-byok-media-provenance.js';
import type {
  ExtensionByokPublishAssetInspection,
  ExtensionByokPublishDeviceAuthorization,
  ExtensionByokPublishProvenance,
} from '../services/extension-byok-publish-authorization.js';

function isUniqueConflict(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code || '') === 'P2002';
}

function optionalString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function provenanceRecord(row: any): ExtensionByokMediaProvenanceRecord {
  return {
    id: String(row.id),
    contractVersion: row.contractVersion,
    executionMode: row.executionMode,
    ownerUserId: String(row.ownerUserId),
    actorUserId: String(row.actorUserId),
    deviceSessionId: String(row.deviceSessionId),
    shopId: String(row.shopId),
    workflowId: String(row.workflowId),
    draftRevision: Number(row.draftRevision),
    draftVersion: Number(row.draftVersion),
    boundDraftRevision: Number(row.boundDraftRevision),
    boundDraftVersion: Number(row.boundDraftVersion),
    skuKey: String(row.skuKey),
    slotKey: String(row.slotKey),
    assignmentOrdinal: Number(row.assignmentOrdinal),
    assignmentSha256: String(row.assignmentSha256),
    policyRevision: Number(row.policyRevision),
    endpointOriginSha256: String(row.endpointOriginSha256),
    model: String(row.model),
    operation: row.operation,
    providerRequestIdSha256: optionalString(row.providerRequestIdSha256),
    promptSha256: String(row.promptSha256),
    negativePromptSha256: optionalString(row.negativePromptSha256),
    sourceSha256: optionalString(row.sourceSha256),
    referenceSha256s: Array.isArray(row.referenceSha256s)
      ? row.referenceSha256s.map(String)
      : [],
    maskSha256: optionalString(row.maskSha256),
    resultSha256: String(row.resultSha256),
    assetId: String(row.assetId),
    resultMimeType: row.resultMimeType,
    resultWidth: Number(row.resultWidth),
    resultHeight: Number(row.resultHeight),
    idempotencyKey: String(row.idempotencyKey),
    requestHash: String(row.requestHash),
    publishIntentId: optionalString(row.publishIntentId),
    publishReceiptId: optionalString(row.publishReceiptId),
    erpAiChargeCents: Number(row.erpAiChargeCents) as 0,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
  };
}

function sameArray(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => String(value) === right[index]);
}

function rowMatchesCreateInput(row: any, input: ExtensionByokMediaProvenanceCreateInput): boolean {
  return String(row.contractVersion) === input.contractVersion
    && String(row.executionMode) === input.executionMode
    && String(row.ownerUserId) === input.ownerUserId
    && String(row.actorUserId) === input.actorUserId
    && String(row.deviceSessionId) === input.deviceSessionId
    && String(row.shopId) === input.shopId
    && String(row.workflowId) === input.workflowId
    && Number(row.draftRevision) === input.draftRevision
    && Number(row.draftVersion) === input.draftVersion
    && Number(row.boundDraftRevision) === input.boundDraftRevision
    && Number(row.boundDraftVersion) === input.boundDraftVersion
    && String(row.skuKey) === input.skuKey
    && String(row.slotKey) === input.slotKey
    && Number(row.assignmentOrdinal) === input.assignmentOrdinal
    && String(row.assignmentSha256) === input.assignmentSha256
    && Number(row.policyRevision) === input.policyRevision
    && String(row.endpointOriginSha256) === input.endpointOriginSha256
    && String(row.model) === input.model
    && String(row.operation) === input.operation
    && optionalString(row.providerRequestIdSha256) === input.providerRequestIdSha256
    && String(row.promptSha256) === input.promptSha256
    && optionalString(row.negativePromptSha256) === input.negativePromptSha256
    && optionalString(row.sourceSha256) === input.sourceSha256
    && sameArray(row.referenceSha256s, input.referenceSha256s)
    && optionalString(row.maskSha256) === input.maskSha256
    && String(row.resultSha256) === input.resultSha256
    && String(row.assetId) === input.assetId
    && String(row.resultMimeType) === input.resultMimeType
    && Number(row.resultWidth) === input.resultWidth
    && Number(row.resultHeight) === input.resultHeight
    && String(row.idempotencyKey) === input.idempotencyKey
    && String(row.requestHash) === input.requestHash
    && optionalString(row.publishIntentId) === input.publishIntentId
    && optionalString(row.publishReceiptId) === input.publishReceiptId
    && Number(row.erpAiChargeCents) === 0;
}

function classifyCreate(
  row: any,
  input: ExtensionByokMediaProvenanceCreateInput,
): ExtensionByokMediaProvenanceCreateResult {
  return rowMatchesCreateInput(row, input)
    ? { kind: 'replayed', provenance: provenanceRecord(row) }
    : { kind: 'conflict' };
}

function publishMatches(
  row: any,
  input: ExtensionByokMediaProvenanceLinkPublishInput,
): boolean {
  return optionalString(row.publishIntentId) === input.publishIntentId
    && optionalString(row.publishReceiptId) === input.publishReceiptId;
}

function publishConflicts(
  row: any,
  input: ExtensionByokMediaProvenanceLinkPublishInput,
): boolean {
  const intent = optionalString(row.publishIntentId);
  const receipt = optionalString(row.publishReceiptId);
  return (intent !== null && intent !== input.publishIntentId)
    || (receipt !== null && receipt !== input.publishReceiptId)
    || (intent === null) !== (receipt === null);
}

export class PrismaExtensionByokMediaProvenanceRepository
implements ExtensionByokMediaProvenanceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async findByIdempotency(input: Pick<
    ExtensionByokMediaProvenanceCreateInput,
    'ownerUserId' | 'idempotencyKey'
  >) {
    return (this.prisma as any).extensionByokMediaProvenance.findUnique({
      where: {
        extension_byok_media_provenance_owner_idempotency: {
          ownerUserId: input.ownerUserId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
  }

  async createOrReplay(
    input: ExtensionByokMediaProvenanceCreateInput,
  ): Promise<ExtensionByokMediaProvenanceCreateResult> {
    const existing = await this.findByIdempotency(input);
    if (existing) return classifyCreate(existing, input);

    try {
      const created = await (this.prisma as any).extensionByokMediaProvenance.create({
        data: input,
      });
      return { kind: 'created', provenance: provenanceRecord(created) };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const winner = await this.findByIdempotency(input);
      if (!winner) throw error;
      return classifyCreate(winner, input);
    }
  }

  async linkPublish(
    input: ExtensionByokMediaProvenanceLinkPublishInput,
  ): Promise<ExtensionByokMediaProvenancePublishResult> {
    const delegate = (this.prisma as any).extensionByokMediaProvenance;
    const existing = await delegate.findFirst({
      where: { id: input.provenanceId, ownerUserId: input.ownerUserId },
    });
    if (!existing) return { kind: 'not_found' };
    if (publishConflicts(existing, input)) return { kind: 'conflict' };
    if (publishMatches(existing, input)) {
      return { kind: 'replayed', provenance: provenanceRecord(existing) };
    }

    const updated = await delegate.updateMany({
      where: {
        id: input.provenanceId,
        ownerUserId: input.ownerUserId,
        publishIntentId: optionalString(existing.publishIntentId),
        publishReceiptId: optionalString(existing.publishReceiptId),
      },
      data: {
        publishIntentId: input.publishIntentId,
        publishReceiptId: input.publishReceiptId,
      },
    });
    const winner = await delegate.findFirst({
      where: { id: input.provenanceId, ownerUserId: input.ownerUserId },
    });
    if (!winner) return { kind: 'not_found' };
    if (!publishMatches(winner, input)) return { kind: 'conflict' };
    return {
      kind: updated.count === 1 ? 'linked' : 'replayed',
      provenance: provenanceRecord(winner),
    };
  }
}

export function createPrismaExtensionByokPublishProvenanceReader(prisma: PrismaClient) {
  function metadataRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  function isByokMarkedAsset(row: any): boolean {
    const metadata = metadataRecord(row.metadata);
    return String(row.id || '').startsWith('byok_')
      || String(row.sourceMediaKey || '').startsWith('extension-byok:')
      || metadata.generatedAssetSource === 'EXTENSION_BYOK'
      || metadata.executionMode === 'BYOK'
      || metadata.outputRole === 'BYOK_ACCEPTED';
  }

  function publishProvenance(row: any): ExtensionByokPublishProvenance {
    return {
      assetId: String(row.assetId),
      ownerUserId: String(row.ownerUserId),
      shopId: String(row.shopId),
      workflowId: String(row.workflowId),
      deviceSessionId: String(row.deviceSessionId),
      endpointOriginSha256: String(row.endpointOriginSha256),
      operation: row.operation,
    };
  }

  return {
    async inspectDraftAssets(input: {
      ownerUserId: string;
      shopId: string;
      workflowId: string;
      assetIds: string[];
    }): Promise<ExtensionByokPublishAssetInspection[]> {
      if (!input.assetIds.length) return [];
      const rows = await (prisma as any).mediaAsset.findMany({
        where: {
          ownerUserId: input.ownerUserId,
          id: { in: input.assetIds },
        },
        select: {
          id: true,
          ownerUserId: true,
          sourceMediaKey: true,
          metadata: true,
          extensionByokMediaProvenance: {
            where: {
              executionMode: 'BYOK',
              ownerUserId: input.ownerUserId,
              shopId: input.shopId,
              workflowId: input.workflowId,
            },
            select: {
              assetId: true,
              ownerUserId: true,
              shopId: true,
              workflowId: true,
              deviceSessionId: true,
              endpointOriginSha256: true,
              operation: true,
            },
          },
        },
      });
      return rows.map((row: any) => {
        const provenanceRows = Array.isArray(row.extensionByokMediaProvenance)
          ? row.extensionByokMediaProvenance
          : [];
        if (provenanceRows.length > 1) {
          throw new Error('BYOK publish provenance identity is ambiguous');
        }
        return {
          assetId: String(row.id),
          byokMarked: isByokMarkedAsset(row),
          provenance: provenanceRows[0] ? publishProvenance(provenanceRows[0]) : null,
        };
      });
    },

    async loadDeviceAuthorization(input: {
      sessionId: string;
      ownerUserId: string;
      shopId: string;
    }): Promise<ExtensionByokPublishDeviceAuthorization | null> {
      const session = await (prisma as any).extensionDeviceSession.findUnique({
        where: { id: input.sessionId },
        select: {
          id: true,
          scopes: true,
          status: true,
          expiresAt: true,
          revokedAt: true,
          ownerUserId: true,
          actorUserId: true,
          owner: { select: { status: true, role: true } },
          actor: { select: { status: true, role: true, parentId: true } },
          shopGrants: {
            where: { shopId: input.shopId },
            select: {
              status: true,
              shop: { select: { id: true, userId: true, status: true, platform: true } },
            },
          },
        },
      });
      if (!session) return null;
      const grants = Array.isArray(session.shopGrants) ? session.shopGrants : [];
      if (grants.length > 1) throw new Error('BYOK publish device shop grant is ambiguous');
      const grant = grants[0] || null;
      return {
        sessionId: String(session.id),
        scopes: Array.isArray(session.scopes) ? session.scopes.map(String) : [],
        status: String(session.status),
        expiresAt: session.expiresAt instanceof Date
          ? session.expiresAt
          : new Date(session.expiresAt),
        revokedAt: session.revokedAt == null
          ? null
          : session.revokedAt instanceof Date
            ? session.revokedAt
            : new Date(session.revokedAt),
        ownerUserId: String(session.ownerUserId),
        actorUserId: String(session.actorUserId),
        ownerStatus: String(session.owner?.status || ''),
        actorStatus: String(session.actor?.status || ''),
        ownerRole: String(session.owner?.role || ''),
        actorRole: String(session.actor?.role || ''),
        actorParentId: session.actor?.parentId == null ? null : String(session.actor.parentId),
        shopGrantStatus: grant ? String(grant.status) : null,
        shopId: grant?.shop ? String(grant.shop.id) : null,
        shopOwnerUserId: grant?.shop ? String(grant.shop.userId) : null,
        shopStatus: grant?.shop ? String(grant.shop.status) : null,
        shopPlatform: grant?.shop ? String(grant.shop.platform) : null,
      };
    },
  };
}
