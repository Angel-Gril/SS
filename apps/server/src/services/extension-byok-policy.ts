import { assertAiImageWorkbenchPublicPayload } from 'shared';

export const EXTENSION_BYOK_POLICY_VERSION = 'extension-byok-policy/v1' as const;
export const EXTENSION_BYOK_READINESS_VERSION = 'extension-byok-readiness/v1' as const;

export const EXTENSION_BYOK_OPERATIONS = Object.freeze([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
] as const);

export type ExtensionByokOperation = typeof EXTENSION_BYOK_OPERATIONS[number];
export type ExtensionByokRolloutMode = 'off' | 'pilot' | 'global';

export interface ExtensionByokPolicySnapshot {
  contractVersion: typeof EXTENSION_BYOK_POLICY_VERSION;
  revision: number;
  mode: ExtensionByokRolloutMode;
  generationEnabled: boolean;
  ingestEnabled: boolean;
  publishEnabled: boolean;
  ownerUserIds: string[];
  shopIds: string[];
  deviceSessionIds: string[];
  allowedOrigins: string[];
  allowedOperations: ExtensionByokOperation[];
  maxConcurrency: number;
  analysisEnabled?: boolean;
  allowedAnalysisModels?: string[];
}

export type ExtensionByokReadinessReason =
  | 'READY'
  | 'POLICY_UNAVAILABLE'
  | 'POLICY_DISABLED'
  | 'OWNER_NOT_ALLOWED'
  | 'SHOP_NOT_ALLOWED'
  | 'DEVICE_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'OPERATION_NOT_ALLOWED'
  | 'GENERATION_DISABLED'
  | 'INGEST_DISABLED'
  | 'PUBLISH_DISABLED';

export interface ExtensionByokPolicyContext {
  ownerUserId: string;
  shopId: string;
  deviceSessionId: string;
  providerOrigin: string;
  operation: ExtensionByokOperation;
}

export interface ExtensionByokProductAnalysisContext {
  ownerUserId: string;
  shopId: string;
  deviceSessionId: string;
  providerOrigin: string;
  model: string;
}

export interface ExtensionByokProductAnalysisReadiness {
  contractVersion: 'extension-byok-product-analysis-readiness/v1';
  policyRevision: number | null;
  mode: ExtensionByokRolloutMode;
  context: ExtensionByokProductAnalysisContext;
  maxConcurrency: number;
  analysis: { enabled: boolean; ready: boolean;
    reasonCode: ExtensionByokReadinessReason | 'ANALYSIS_DISABLED' | 'MODEL_NOT_ALLOWED' };
}

interface ExtensionByokCapabilityDecision {
  enabled: boolean;
  ready: boolean;
  reasonCode: ExtensionByokReadinessReason;
}

export interface ExtensionByokReadinessDecision {
  contractVersion: typeof EXTENSION_BYOK_READINESS_VERSION;
  policyRevision: number | null;
  mode: ExtensionByokRolloutMode;
  context: ExtensionByokPolicyContext;
  maxConcurrency: number;
  capabilities: {
    generation: ExtensionByokCapabilityDecision;
    ingest: ExtensionByokCapabilityDecision;
    publish: ExtensionByokCapabilityDecision;
  };
}

export class ExtensionByokPolicyError extends Error {
  constructor(
    public readonly code: 'EXTENSION_BYOK_POLICY_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokPolicyError';
  }
}

function invalidPolicy(): never {
  throw new ExtensionByokPolicyError(
    'EXTENSION_BYOK_POLICY_INVALID',
    'Extension BYOK policy is invalid',
  );
}

function parseJsonPolicy(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return invalidPolicy();
  }
}

function exactObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  const parsed = parseJsonPolicy(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalidPolicy();
  if (Object.keys(parsed).sort().join(',') !== [...expectedKeys].sort().join(',')) {
    return invalidPolicy();
  }
  return parsed as Record<string, unknown>;
}

function identifier(value: unknown): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed || parsed.length > 500) return invalidPolicy();
  return parsed;
}

function identifierList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) return invalidPolicy();
  const parsed = value.map(identifier);
  if (new Set(parsed).size !== parsed.length) return invalidPolicy();
  return parsed;
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = -1, second = -1] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
    || first >= 224;
}

function isPublicProviderHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (!normalized
    || normalized.endsWith('.')
    || normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === 'metadata'
    || normalized === 'metadata.google.internal'
    || normalized.endsWith('.metadata.google.internal')
    || normalized === 'instance-data'
    || normalized.endsWith('.instance-data')
    || normalized.endsWith('.internal')
    || normalized.endsWith('.local')
    || normalized.endsWith('.home.arpa')
    || normalized.includes(':')
    || !normalized.includes('.')
    || isPrivateIpv4(normalized)) {
    return false;
  }
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u
    .test(normalized);
}

export function canonicalizeExtensionByokProviderOrigin(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 2048 || raw.includes('\\')) return invalidPolicy();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalidPolicy();
  }
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.origin === 'null'
    || !isPublicProviderHostname(parsed.hostname)
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    return invalidPolicy();
  }
  return parsed.origin;
}

function originList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) return invalidPolicy();
  const parsed = value.map(canonicalizeExtensionByokProviderOrigin);
  if (new Set(parsed).size !== parsed.length) return invalidPolicy();
  return parsed;
}

function operation(value: unknown): ExtensionByokOperation {
  if (!EXTENSION_BYOK_OPERATIONS.includes(value as ExtensionByokOperation)) {
    return invalidPolicy();
  }
  return value as ExtensionByokOperation;
}

function operationList(value: unknown): ExtensionByokOperation[] {
  if (!Array.isArray(value) || value.length > EXTENSION_BYOK_OPERATIONS.length) {
    return invalidPolicy();
  }
  const parsed = value.map(operation);
  if (new Set(parsed).size !== parsed.length) return invalidPolicy();
  return parsed;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalidPolicy();
  return value;
}

export function parseExtensionByokPolicy(value: unknown): ExtensionByokPolicySnapshot {
  const raw = parseJsonPolicy(value);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalidPolicy();
  const optional = raw as Record<string, unknown>;
  const hasAnalysis = Object.prototype.hasOwnProperty.call(optional, 'analysisEnabled');
  if (hasAnalysis !== Object.prototype.hasOwnProperty.call(optional, 'allowedAnalysisModels')) return invalidPolicy();
  const parsed = exactObject(Object.fromEntries(Object.entries(optional)
    .filter(([key]) => !['analysisEnabled', 'allowedAnalysisModels'].includes(key))), [
    'allowedOperations',
    'allowedOrigins',
    'contractVersion',
    'deviceSessionIds',
    'generationEnabled',
    'ingestEnabled',
    'maxConcurrency',
    'mode',
    'ownerUserIds',
    'publishEnabled',
    'revision',
    'shopIds',
  ]);
  if (parsed.contractVersion !== EXTENSION_BYOK_POLICY_VERSION
    || !Number.isSafeInteger(parsed.revision)
    || Number(parsed.revision) < 0
    || !['off', 'pilot', 'global'].includes(String(parsed.mode || ''))
    || !Number.isSafeInteger(parsed.maxConcurrency)
    || Number(parsed.maxConcurrency) < 1
    || Number(parsed.maxConcurrency) > 4) {
    return invalidPolicy();
  }
  const snapshot: ExtensionByokPolicySnapshot = {
    contractVersion: EXTENSION_BYOK_POLICY_VERSION,
    revision: Number(parsed.revision),
    mode: parsed.mode as ExtensionByokRolloutMode,
    generationEnabled: boolean(parsed.generationEnabled),
    ingestEnabled: boolean(parsed.ingestEnabled),
    publishEnabled: boolean(parsed.publishEnabled),
    ownerUserIds: identifierList(parsed.ownerUserIds),
    shopIds: identifierList(parsed.shopIds),
    deviceSessionIds: identifierList(parsed.deviceSessionIds),
    allowedOrigins: originList(parsed.allowedOrigins),
    allowedOperations: operationList(parsed.allowedOperations),
    maxConcurrency: Number(parsed.maxConcurrency),
  };
  if (hasAnalysis) {
    snapshot.analysisEnabled = boolean(optional.analysisEnabled);
    if (!Array.isArray(optional.allowedAnalysisModels) || optional.allowedAnalysisModels.length > 100) return invalidPolicy();
    snapshot.allowedAnalysisModels = optional.allowedAnalysisModels.map((value) => {
      const model = identifier(value);
      if (model.length > 200 || Array.from(model).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return invalidPolicy();
      return model;
    });
    if (new Set(snapshot.allowedAnalysisModels).size !== snapshot.allowedAnalysisModels.length) return invalidPolicy();
    if (snapshot.analysisEnabled && !snapshot.allowedAnalysisModels.length) return invalidPolicy();
  }
  if (snapshot.mode === 'pilot'
    && (!snapshot.ownerUserIds.length
      || !snapshot.shopIds.length
      || !snapshot.deviceSessionIds.length)) {
    return invalidPolicy();
  }
  if (snapshot.mode !== 'off'
    && (!snapshot.allowedOrigins.length || !snapshot.allowedOperations.length
      && !(snapshot.analysisEnabled && snapshot.allowedAnalysisModels?.length))) {
    return invalidPolicy();
  }
  return snapshot;
}

function safeContext(input: ExtensionByokPolicyContext): ExtensionByokPolicyContext | null {
  try {
    return {
      ownerUserId: identifier(input?.ownerUserId),
      shopId: identifier(input?.shopId),
      deviceSessionId: identifier(input?.deviceSessionId),
      providerOrigin: canonicalizeExtensionByokProviderOrigin(input?.providerOrigin),
      operation: operation(input?.operation),
    };
  } catch {
    return null;
  }
}

function capability(
  enabled: boolean,
  allowed: boolean,
  deniedReason: ExtensionByokReadinessReason,
  disabledReason: ExtensionByokReadinessReason,
): ExtensionByokCapabilityDecision {
  if (!allowed) return { enabled, ready: false, reasonCode: deniedReason };
  if (!enabled) return { enabled: false, ready: false, reasonCode: disabledReason };
  return { enabled: true, ready: true, reasonCode: 'READY' };
}

function unavailableDecision(
  input: ExtensionByokPolicyContext,
): ExtensionByokReadinessDecision {
  const context = safeContext(input) || {
    ownerUserId: '', shopId: '', deviceSessionId: '', providerOrigin: '', operation: 'TEXT_TO_IMAGE',
  };
  return assertAiImageWorkbenchPublicPayload({
    contractVersion: EXTENSION_BYOK_READINESS_VERSION,
    policyRevision: null,
    mode: 'off',
    context,
    maxConcurrency: 1,
    capabilities: {
      generation: { enabled: false, ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
      ingest: { enabled: false, ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
      publish: { enabled: false, ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
    },
  });
}

function deniedReason(
  policy: ExtensionByokPolicySnapshot,
  context: ExtensionByokPolicyContext,
): ExtensionByokReadinessReason | null {
  const scopeReason = deniedScopeReason(policy, context);
  if (scopeReason) return scopeReason;
  if (!policy.allowedOperations.includes(context.operation)) return 'OPERATION_NOT_ALLOWED';
  return null;
}

function deniedScopeReason(
  policy: ExtensionByokPolicySnapshot,
  context: Omit<ExtensionByokPolicyContext, 'operation'>,
): ExtensionByokReadinessReason | null {
  if (policy.mode === 'off') return 'POLICY_DISABLED';
  if (policy.mode === 'pilot') {
    if (!policy.ownerUserIds.includes(context.ownerUserId)) return 'OWNER_NOT_ALLOWED';
    if (!policy.shopIds.includes(context.shopId)) return 'SHOP_NOT_ALLOWED';
    if (!policy.deviceSessionIds.includes(context.deviceSessionId)) return 'DEVICE_NOT_ALLOWED';
  }
  if (!policy.allowedOrigins.includes(context.providerOrigin)) return 'ORIGIN_NOT_ALLOWED';
  return null;
}

export function createExtensionByokPolicyEvaluator(options: {
  loadPolicy(): Promise<unknown>;
}) {
  return {
    async evaluateProductAnalysis(input: ExtensionByokProductAnalysisContext): Promise<ExtensionByokProductAnalysisReadiness> {
      let context: ExtensionByokProductAnalysisContext;
      let policy: ExtensionByokPolicySnapshot | null = null;
      try {
        context = { ownerUserId: identifier(input?.ownerUserId), shopId: identifier(input?.shopId),
          deviceSessionId: identifier(input?.deviceSessionId), providerOrigin: canonicalizeExtensionByokProviderOrigin(input?.providerOrigin),
          model: identifier(input?.model) };
        if (context.model.length > 200 || Array.from(context.model).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return invalidPolicy();
        policy = parseExtensionByokPolicy(await options.loadPolicy());
      } catch {
        context = { ownerUserId: '', shopId: '', deviceSessionId: '', providerOrigin: '', model: '' };
      }
      const reason = !policy ? 'POLICY_UNAVAILABLE' : deniedScopeReason(policy, context)
        || (!policy.analysisEnabled ? 'ANALYSIS_DISABLED' : !policy.allowedAnalysisModels?.includes(context.model)
          ? 'MODEL_NOT_ALLOWED' : !policy.generationEnabled ? 'GENERATION_DISABLED' : 'READY');
      return assertAiImageWorkbenchPublicPayload({
        contractVersion: 'extension-byok-product-analysis-readiness/v1' as const,
        policyRevision: policy?.revision ?? null, mode: policy?.mode ?? 'off', context,
        maxConcurrency: policy?.maxConcurrency ?? 1,
        analysis: { enabled: policy?.analysisEnabled === true, ready: reason === 'READY', reasonCode: reason },
      });
    },
    async evaluate(input: ExtensionByokPolicyContext): Promise<ExtensionByokReadinessDecision> {
      const context = safeContext(input);
      if (!context) return unavailableDecision(input);
      let policy: ExtensionByokPolicySnapshot;
      try {
        policy = parseExtensionByokPolicy(await options.loadPolicy());
      } catch {
        return unavailableDecision(context);
      }
      const reason = deniedReason(policy, context);
      const allowed = reason == null;
      const decision: ExtensionByokReadinessDecision = {
        contractVersion: EXTENSION_BYOK_READINESS_VERSION,
        policyRevision: policy.revision,
        mode: policy.mode,
        context,
        maxConcurrency: policy.maxConcurrency,
        capabilities: {
          generation: capability(
            policy.generationEnabled,
            allowed,
            reason || 'POLICY_DISABLED',
            'GENERATION_DISABLED',
          ),
          ingest: capability(
            policy.ingestEnabled,
            allowed,
            reason || 'POLICY_DISABLED',
            'INGEST_DISABLED',
          ),
          publish: capability(
            policy.publishEnabled,
            allowed,
            reason || 'POLICY_DISABLED',
            'PUBLISH_DISABLED',
          ),
        },
      };
      return assertAiImageWorkbenchPublicPayload(decision);
    },
  };
}
