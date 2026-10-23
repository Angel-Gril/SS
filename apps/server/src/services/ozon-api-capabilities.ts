import { z } from 'zod';
import type { OzonClient } from './ozon-client.js';

// Paths and operation IDs verified against the official Seller spec on 2026-10-23.
// Role names, prefixes and wildcards are not grants for a particular method.
const FEATURES = [
  { id: 'orders', label: '订单读取', methods: [
    ['/v4/posting/fbs/list', 'PostingFbsList'],
    ['/v3/posting/fbs/get', 'PostingAPI_GetFbsPostingV3'],
  ] },
  { id: 'labels', label: '订单面单', methods: [
    ['/v3/posting/fbs/package-label/create', 'PostingFbsPackageLabelCreate'],
    ['/v2/posting/fbs/package-label/get', 'PostingFbsPackageLabelGet'],
  ] },
  { id: 'carriage', label: '组包与货签', methods: [
    ['/v1/carriage/container/create', 'CarriageContainerCreate'],
    ['/v1/carriage/container/fill', 'CarriageContainerFill'],
    ['/v1/carriage/container/approve', 'CarriageContainerApprove'],
    ['/v1/carriage/container/get', 'CarriageContainerGet'],
    ['/v1/carriage/container/list', 'CarriageContainerList'],
    ['/v1/carriage/container/task/info', 'CarriageContainerTaskInfo'],
    ['/v1/carriage/container/label/get', 'CarriageContainerLabelGet'],
    ['/v1/carriage/container/document/get', 'CarriageContainerDocumentGet'],
    ['/v1/carriage/container/cancel', 'CarriageContainerCancel'],
    ['/v1/carriage/container/remove-postings', 'CarriageContainerRemovePostings'],
    ['/v1/carriage/container/place-into', 'CarriageContainerPlaceInto'],
    ['/v1/carriage/container/remove-from', 'CarriageContainerRemoveFrom'],
    ['/v1/carriage/container/status/get', 'CarriageContainerStatusGet'],
  ] },
  { id: 'finance', label: '财务读取', methods: [
    ['/v1/finance/accrual/by-day', 'GetFinanceAccrualByDay'],
    ['/v1/finance/accrual/types', 'GetFinanceAccrualTypes'],
  ] },
  { id: 'read', label: '仓库读取', methods: [
    ['/v2/warehouse/list', 'WarehouseListV2'],
  ] },
] as const;

const rolesSchema = z.object({
  expires_at: z.union([z.string().datetime({ offset: true }), z.literal('')]).nullish(),
  roles: z.array(z.object({
    name: z.string().max(200),
    methods: z.array(z.string().min(1).max(300)).max(2000),
  })).max(128),
}).refine((value) => value.roles.reduce((sum, role) => sum + role.methods.length, 0) <= 2000);

export type OzonApiCapabilityId = (typeof FEATURES)[number]['id'];

export interface OzonApiCapabilities {
  checkedAt: string;
  expiresAt: string | null;
  expiryStatus: 'expired' | 'expiring' | 'valid' | 'unknown';
  daysRemaining: number | null;
  carriageBusinessEligibility: 'unverified';
  features: Array<{
    id: OzonApiCapabilityId;
    label: string;
    status: 'allowed' | 'missing';
    requiredMethods: string[];
    missingMethods: string[];
  }>;
}

export class OzonApiCapabilitiesError extends Error {
  constructor(readonly code: 'OZON_CAPABILITIES_INVALID_RESPONSE' | 'OZON_CAPABILITIES_UNAVAILABLE') {
    super(code === 'OZON_CAPABILITIES_INVALID_RESPONSE'
      ? 'Ozon 返回的授权信息无法识别，暂时无法确认权限与到期时间'
      : '暂时无法读取 Ozon 授权信息，请检查密钥或稍后重试');
    this.name = 'OzonApiCapabilitiesError';
  }
}

/** Read-only diagnostic, not authority for dispatching any Ozon business action. */
export async function readOzonApiCapabilities(client: OzonClient, now = new Date()): Promise<OzonApiCapabilities> {
  let payload: unknown;
  try {
    payload = await client.request('/v1/roles', { method: 'POST', skipRetry: true, timeoutMs: 12_000 });
  } catch {
    // Never return raw provider errors: their body may echo submitted credentials.
    throw new OzonApiCapabilitiesError('OZON_CAPABILITIES_UNAVAILABLE');
  }
  const parsed = rolesSchema.safeParse(payload);
  if (!parsed.success) throw new OzonApiCapabilitiesError('OZON_CAPABILITIES_INVALID_RESPONSE');
  const expiresAt = parsed.data.expires_at ? new Date(parsed.data.expires_at).toISOString() : null;
  const remainingMs = expiresAt ? Date.parse(expiresAt) - now.getTime() : null;
  const daysRemaining = remainingMs === null ? null : Math.max(0, Math.ceil(remainingMs / 86_400_000));
  const expiryStatus = remainingMs === null ? 'unknown'
    : remainingMs <= 0 ? 'expired'
      : remainingMs <= 14 * 86_400_000 ? 'expiring' : 'valid';
  const grants = new Set(parsed.data.roles.flatMap((role) => role.methods));
  return {
    checkedAt: now.toISOString(),
    expiresAt,
    expiryStatus,
    daysRemaining,
    carriageBusinessEligibility: 'unverified',
    features: FEATURES.map((feature) => {
      const missingMethods = feature.methods
        .filter(([path, operationId]) => !grants.has(path) && !grants.has(operationId))
        .map(([path]) => path);
      return {
        id: feature.id,
        label: feature.label,
        status: missingMethods.length ? 'missing' : 'allowed',
        requiredMethods: feature.methods.map(([path]) => path),
        missingMethods,
      };
    }),
  };
}
