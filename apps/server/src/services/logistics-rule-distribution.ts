import { createHash } from 'node:crypto';
import { z } from 'zod';

const effectiveIdentitySchema = z.object({
  deploymentId: z.string().trim().min(1),
  assignmentId: z.string().trim().min(1),
  scopeKey: z.string().trim().min(1),
  releaseSequence: z.number().int().positive(),
  effectiveChecksum: z.string().regex(/^[a-f0-9]{64}$/i),
  minExtensionVersion: z.string().trim().min(1),
}).strict();

export type LogisticsRuleEffectiveIdentity = z.infer<typeof effectiveIdentitySchema>;

export function buildLogisticsRuleEffectiveEtag(input: LogisticsRuleEffectiveIdentity): string {
  const value = effectiveIdentitySchema.parse(input);
  const canonical = JSON.stringify({
    assignmentId: value.assignmentId,
    deploymentId: value.deploymentId,
    effectiveChecksum: value.effectiveChecksum.toLowerCase(),
    minExtensionVersion: value.minExtensionVersion,
    releaseSequence: value.releaseSequence,
    scopeKey: value.scopeKey,
  });
  return `"${createHash('sha256').update(canonical).digest('hex')}"`;
}

function normalizeEntityTag(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2).trim() : trimmed;
}

export function ifNoneMatchIncludes(header: string | undefined, currentEtag: string): boolean {
  if (!header) return false;
  const expected = normalizeEntityTag(currentEtag);
  return header.split(',').some((candidate) => {
    const normalized = normalizeEntityTag(candidate);
    return normalized === '*' || normalized === expected;
  });
}

interface LogisticsAssignmentAccessDevice {
  sessionId: string;
  ownerUserId: string;
  activeShopIds: string[];
}

interface LogisticsAssignmentAccessRecord {
  id: string;
  tenantId: string;
  shopId: string;
  retiredAt: Date | string | null;
}

interface LogisticsAssignmentPriorGrant {
  deviceSessionId: string;
  assignmentId: string;
  status: string;
  revokeReason?: string | null;
}

export type LogisticsAssignmentAccessResult =
  | { state: 'allowed'; assignmentId: string }
  | { state: 'gone'; assignmentId: string; reasonCode: string }
  | { state: 'not_found' };

const PUBLIC_SCOPE_REVOKE_REASONS = new Set([
  'assignment_retired',
  'shop_transferred',
  'shop_unlinked',
  'warehouse_retired',
]);

function sanitizeReasonCode(value: string | null | undefined): string {
  const normalized = String(value || '').trim().toLowerCase();
  return PUBLIC_SCOPE_REVOKE_REASONS.has(normalized) ? normalized : 'scope_revoked';
}

export function resolveLogisticsAssignmentAccess(input: {
  device: LogisticsAssignmentAccessDevice;
  assignment: LogisticsAssignmentAccessRecord | null;
  priorGrant: LogisticsAssignmentPriorGrant | null;
  requestedAssignmentId?: string;
}): LogisticsAssignmentAccessResult {
  const { device, assignment, priorGrant } = input;
  const requestedAssignmentId = String(input.requestedAssignmentId || assignment?.id || '').trim();
  const isCurrentlyAllowed = assignment !== null
    && assignment.retiredAt === null
    && assignment.tenantId === device.ownerUserId
    && device.activeShopIds.includes(assignment.shopId);

  if (isCurrentlyAllowed) {
    return { state: 'allowed', assignmentId: assignment.id };
  }

  const wasDeliveredToThisSession = requestedAssignmentId.length > 0
    && priorGrant?.deviceSessionId === device.sessionId
    && priorGrant.assignmentId === requestedAssignmentId
    && priorGrant.status === 'REVOKED';

  if (wasDeliveredToThisSession) {
    return {
      state: 'gone',
      assignmentId: requestedAssignmentId,
      reasonCode: sanitizeReasonCode(priorGrant.revokeReason),
    };
  }

  return { state: 'not_found' };
}
