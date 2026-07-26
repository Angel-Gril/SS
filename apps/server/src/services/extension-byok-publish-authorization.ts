import { createHash } from 'node:crypto';
import type { OzonListingDraftMediaAssignment } from 'shared';
import {
  createExtensionByokPolicyEvaluator,
  parseExtensionByokPolicy,
  type ExtensionByokOperation,
  type ExtensionByokReadinessReason,
} from './extension-byok-policy.js';

export interface ExtensionByokPublishProvenance {
  assetId: string;
  ownerUserId: string;
  shopId: string;
  workflowId: string;
  deviceSessionId: string;
  endpointOriginSha256: string;
  operation: ExtensionByokOperation;
}

export interface ExtensionByokPublishAssetInspection {
  assetId: string;
  byokMarked: boolean;
  provenance: ExtensionByokPublishProvenance | null;
}

export interface ExtensionByokPublishDeviceAuthorization {
  sessionId: string;
  scopes: string[];
  status: string;
  expiresAt: Date;
  revokedAt: Date | null;
  ownerUserId: string;
  actorUserId: string;
  ownerStatus: string;
  actorStatus: string;
  ownerRole: string;
  actorRole: string;
  actorParentId: string | null;
  shopGrantStatus: string | null;
  shopId: string | null;
  shopOwnerUserId: string | null;
  shopStatus: string | null;
  shopPlatform: string | null;
}

export interface ExtensionByokPublishAuthorizationInput {
  ownerUserId: string;
  shopId: string;
  workflowId: string;
  assignments: ReadonlyArray<Pick<OzonListingDraftMediaAssignment, 'assetId'>>;
  requestingDeviceSessionId?: string;
}

export interface ExtensionByokPublishAuthorizationDecision {
  byokAssetIds: string[];
  policyRevision: number | null;
}

export class ExtensionByokPublishAuthorizationError extends Error {
  constructor(
    public readonly code:
      | 'EXTENSION_BYOK_PUBLISH_DISABLED'
      | 'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
    message: string,
    public readonly statusCode: number,
    public readonly reasonCode:
      | ExtensionByokReadinessReason
      | 'PROVENANCE_UNAVAILABLE',
  ) {
    super(message);
    this.name = 'ExtensionByokPublishAuthorizationError';
  }
}

function unavailable(): never {
  throw new ExtensionByokPublishAuthorizationError(
    'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
    'Extension BYOK publish policy is unavailable',
    503,
    'PROVENANCE_UNAVAILABLE',
  );
}

function denied(reasonCode: ExtensionByokReadinessReason): never {
  throw new ExtensionByokPublishAuthorizationError(
    'EXTENSION_BYOK_PUBLISH_DISABLED',
    'Extension BYOK media publishing is not enabled for this draft',
    409,
    reasonCode,
  );
}

function exactIdentifier(value: unknown): string {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!normalized || normalized !== value || normalized.length > 500) return unavailable();
  return normalized;
}

function selectedAssetIds(
  assignments: ExtensionByokPublishAuthorizationInput['assignments'],
): string[] {
  if (!Array.isArray(assignments) || assignments.length > 500) return unavailable();
  const assetIds = assignments.map((assignment) => exactIdentifier(assignment?.assetId));
  return [...new Set(assetIds)];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function createExtensionByokPublishAuthorizer(options: {
  loadPolicy(): Promise<unknown>;
  inspectDraftAssets(input: {
    ownerUserId: string;
    shopId: string;
    workflowId: string;
    assetIds: string[];
  }): Promise<ExtensionByokPublishAssetInspection[]>;
  loadDeviceAuthorization(input: {
    sessionId: string;
    ownerUserId: string;
    shopId: string;
  }): Promise<ExtensionByokPublishDeviceAuthorization | null>;
  now?: () => Date;
}) {
  return async (
    input: ExtensionByokPublishAuthorizationInput,
  ): Promise<ExtensionByokPublishAuthorizationDecision> => {
    const ownerUserId = exactIdentifier(input?.ownerUserId);
    const shopId = exactIdentifier(input?.shopId);
    const workflowId = exactIdentifier(input?.workflowId);
    const assetIds = selectedAssetIds(input?.assignments);
    if (!assetIds.length) return { byokAssetIds: [], policyRevision: null };

    let inspections: ExtensionByokPublishAssetInspection[];
    try {
      inspections = await options.inspectDraftAssets({
        ownerUserId, shopId, workflowId, assetIds,
      });
    } catch {
      return unavailable();
    }
    if (!Array.isArray(inspections) || inspections.length !== assetIds.length) {
      return unavailable();
    }

    const selected = new Set(assetIds);
    const inspected = new Set<string>();
    const provenanceRows: ExtensionByokPublishProvenance[] = [];
    for (const inspection of inspections) {
      if (!inspection
        || !selected.has(inspection.assetId)
        || inspected.has(inspection.assetId)) return unavailable();
      inspected.add(inspection.assetId);
      const row = inspection.provenance;
      if (inspection.byokMarked !== Boolean(row)) return unavailable();
      if (!row) continue;
      if (row.assetId !== inspection.assetId
        || row.ownerUserId !== ownerUserId
        || row.shopId !== shopId
        || row.workflowId !== workflowId) return unavailable();
      provenanceRows.push(row);
    }
    if (!provenanceRows.length) return { byokAssetIds: [], policyRevision: null };

    let policy;
    try {
      policy = parseExtensionByokPolicy(await options.loadPolicy());
    } catch {
      return unavailable();
    }
    const originsByHash = new Map(policy.allowedOrigins.map((origin) => [sha256(origin), origin]));
    const evaluate = createExtensionByokPolicyEvaluator({ loadPolicy: async () => policy });
    const now = (options.now || (() => new Date()))();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return unavailable();
    const liveDeviceCache = new Map<string, ExtensionByokPublishDeviceAuthorization>();

    const requireLiveDevice = async (
      sessionId: string,
      requiredScope: string,
    ): Promise<ExtensionByokPublishDeviceAuthorization> => {
      const exactSessionId = exactIdentifier(sessionId);
      const cached = liveDeviceCache.get(exactSessionId);
      if (cached) {
        if (!cached.scopes.includes(requiredScope)) denied('DEVICE_NOT_ALLOWED');
        return cached;
      }
      let authorization: ExtensionByokPublishDeviceAuthorization | null;
      try {
        authorization = await options.loadDeviceAuthorization({
          sessionId: exactSessionId,
          ownerUserId,
          shopId,
        });
      } catch {
        unavailable();
      }
      if (!authorization) denied('DEVICE_NOT_ALLOWED');
      if (authorization.sessionId !== exactSessionId) unavailable();
      if (!Array.isArray(authorization.scopes)
        || authorization.scopes.some((scope) => typeof scope !== 'string')
        || !authorization.scopes.includes(requiredScope)
        || authorization.status !== 'ACTIVE'
        || authorization.revokedAt !== null
        || !(authorization.expiresAt instanceof Date)
        || authorization.expiresAt.getTime() <= now.getTime()
        || authorization.ownerUserId !== ownerUserId
        || authorization.actorUserId !== ownerUserId
        || authorization.ownerStatus !== 'ACTIVE'
        || authorization.actorStatus !== 'ACTIVE'
        || !['USER', 'ADMIN'].includes(authorization.ownerRole)
        || !['USER', 'ADMIN'].includes(authorization.actorRole)
        || authorization.actorParentId !== null
        || authorization.shopGrantStatus !== 'ACTIVE'
        || authorization.shopId !== shopId
        || authorization.shopOwnerUserId !== ownerUserId
        || authorization.shopStatus !== 'ACTIVE'
        || authorization.shopPlatform !== 'OZON') {
        denied('DEVICE_NOT_ALLOWED');
      }
      liveDeviceCache.set(exactSessionId, authorization);
      return authorization;
    };

    for (const row of provenanceRows) {
      const providerOrigin = originsByHash.get(row.endpointOriginSha256);
      if (!providerOrigin) return denied('ORIGIN_NOT_ALLOWED');
      const provenanceDeviceSessionId = exactIdentifier(row.deviceSessionId);
      await requireLiveDevice(provenanceDeviceSessionId, 'byok:media:ingest');
      const deviceSessionIds = [provenanceDeviceSessionId];
      if (input.requestingDeviceSessionId) {
        const requestingDeviceSessionId = exactIdentifier(input.requestingDeviceSessionId);
        await requireLiveDevice(requestingDeviceSessionId, 'listing:publish');
        if (requestingDeviceSessionId !== provenanceDeviceSessionId) {
          deviceSessionIds.push(requestingDeviceSessionId);
        }
      }
      for (const deviceSessionId of deviceSessionIds) {
        const decision = await evaluate.evaluate({
          ownerUserId,
          shopId,
          deviceSessionId,
          providerOrigin,
          operation: row.operation,
        });
        if (!decision.capabilities.publish.ready) {
          return denied(decision.capabilities.publish.reasonCode);
        }
      }
    }

    return {
      byokAssetIds: assetIds.filter((assetId) => provenanceRows.some((row) => row.assetId === assetId)),
      policyRevision: policy.revision,
    };
  };
}

export type ExtensionByokPublishAuthorizer = ReturnType<
  typeof createExtensionByokPublishAuthorizer
>;
