export interface AccessConfigRow { key: string; value: string; revision: number; label?: string | null; description?: string | null }
export interface AccessRule { mode: 'off' | 'pilot' | 'global'; stage?: string; listingStage?: string; ownerUserIds?: string[]; shopIds?: string[]; deviceSessionIds?: string[]; platforms?: string[] }
export interface SourcePolicy { revision: string; features: Record<string, AccessRule> }
export interface TenantPolicy { revision: number; tenantIds: string[]; mode?: 'allowlist' | 'all' }
export interface AccessOptions {
  owners: Array<{ id: string; nickname: string | null; accountCode: string | null; status: string }>;
  shops: Array<{ id: string; name: string; platform: string; status: string; ownerUserId: string }>;
  devices: Array<{ id: string; ownerUserId: string; status: string; shopIds: string[]; scopes: string[] }>;
  features: Array<{ name: string; configKey: string }>;
  hasMore: { owners: boolean; shops: boolean; devices: boolean };
}
export interface AccessSaveItem { key: string; value: string; expectedRevision: number }
export interface AccessChange { label: string; detail: string; expands: boolean }
export const SOURCE_POLICY_KEY: string;
export const TENANT_POLICY_KEY: string;
export const ACCESS_EXTRA_FLAGS: string[];
export const SHOP_SCOPED_FEATURES: string[];
export const SOURCE_FEATURE_LABELS: Record<string, string>;
export function accessRegionLabel(hostname: string): string;
export function parseSourcePolicy(raw: string): { value: SourcePolicy | null; error: string | null };
export function parseTenantPolicy(raw: string): { value: TenantPolicy | null; error: string | null };
export function initializeSourcePolicy(raw: string, confirmed: boolean): SourcePolicy | null;
export function prepareAccessSave(rows: AccessConfigRow[], draft: Record<string,string>, nextRevision: string): AccessSaveItem[];
export function describeAccessChanges(rows: AccessConfigRow[], draft: Record<string,string>, labels?: Record<string,string>): AccessChange[];
export function buildOptionsPath(search: string, ownerIds: string[]): string;
export function mergeOptions(previous: AccessOptions | null, next: AccessOptions): AccessOptions;
