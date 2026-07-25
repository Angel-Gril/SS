import { z } from 'zod';
import {
  EXTENSION_BYOK_OPERATIONS,
  EXTENSION_BYOK_POLICY_VERSION,
  canonicalizeExtensionByokProviderOrigin,
  parseExtensionByokPolicy,
  type ExtensionByokOperation,
  type ExtensionByokPolicySnapshot,
  type ExtensionByokRolloutMode,
} from './extension-byok-policy.js';

export const EXTENSION_BYOK_ADMIN_POLICY_VERSION = 'extension-byok-admin-policy/v1' as const;

export interface ExtensionByokAdminPolicy {
  contractVersion: typeof EXTENSION_BYOK_ADMIN_POLICY_VERSION;
  revision: number;
  mode: ExtensionByokRolloutMode;
  ownerUserIds: string[];
  shopIds: string[];
  deviceSessionIds: string[];
  allowedOrigins: string[];
  allowedOperations: ExtensionByokOperation[];
  maxConcurrency: number;
}

const DEFAULT_EXTENSION_BYOK_ADMIN_POLICY: ExtensionByokAdminPolicy = {
  contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION,
  revision: 0,
  mode: 'off',
  ownerUserIds: [],
  shopIds: [],
  deviceSessionIds: [],
  allowedOrigins: [],
  allowedOperations: [],
  maxConcurrency: 1,
};

export const DEFAULT_EXTENSION_BYOK_ADMIN_POLICY_JSON = JSON.stringify(
  DEFAULT_EXTENSION_BYOK_ADMIN_POLICY,
);

export class ExtensionByokAdminPolicyError extends Error {
  constructor(
    public readonly code: 'EXTENSION_BYOK_ADMIN_POLICY_INVALID',
    message = 'Extension BYOK administrator policy is invalid',
  ) {
    super(message);
    this.name = 'ExtensionByokAdminPolicyError';
  }
}

function invalidAdminPolicy(): never {
  throw new ExtensionByokAdminPolicyError('EXTENSION_BYOK_ADMIN_POLICY_INVALID');
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value || value.length > 100_000) return invalidAdminPolicy();
  try {
    return JSON.parse(value);
  } catch {
    return invalidAdminPolicy();
  }
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return invalidAdminPolicy();
  if (Object.keys(parsed).sort().join(',') !== [...keys].sort().join(',')) {
    return invalidAdminPolicy();
  }
  return parsed as Record<string, unknown>;
}

function identifier(value: unknown): string {
  const parsed = typeof value === 'string' ? value.trim() : '';
  const lower = parsed.toLowerCase();
  const containsControlCharacter = [...parsed].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
  const resemblesSecretOrTransport = parsed.includes('?')
    || parsed.includes('#')
    || lower.startsWith('data:')
    || /(?:https?|ftp):\/\//iu.test(parsed)
    || /(^|[\s:])authorization(?:[\s:=]|$)/iu.test(parsed)
    || /(^|[\s:])bearer\s+/iu.test(parsed)
    || /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[:=]/iu.test(parsed)
    || /^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)[A-Za-z0-9_-]+/iu
      .test(parsed);
  if (!parsed || parsed.length > 500 || containsControlCharacter || resemblesSecretOrTransport) {
    return invalidAdminPolicy();
  }
  return parsed;
}

function identifierList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 500) return invalidAdminPolicy();
  const result = value.map(identifier);
  if (new Set(result).size !== result.length) return invalidAdminPolicy();
  return result;
}

function originList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) return invalidAdminPolicy();
  const result = value.map((origin) => {
    if (typeof origin !== 'string' || origin !== origin.trim()) return invalidAdminPolicy();
    let canonical: string;
    try {
      canonical = canonicalizeExtensionByokProviderOrigin(origin);
    } catch {
      return invalidAdminPolicy();
    }
    if (canonical !== origin) return invalidAdminPolicy();
    return canonical;
  });
  if (new Set(result).size !== result.length) return invalidAdminPolicy();
  return result;
}

function operationList(value: unknown): ExtensionByokOperation[] {
  if (!Array.isArray(value) || value.length > EXTENSION_BYOK_OPERATIONS.length) {
    return invalidAdminPolicy();
  }
  const result = value.map((operation) => {
    if (!EXTENSION_BYOK_OPERATIONS.includes(operation as ExtensionByokOperation)) {
      return invalidAdminPolicy();
    }
    return operation as ExtensionByokOperation;
  });
  if (new Set(result).size !== result.length) return invalidAdminPolicy();
  return result;
}

export function parseExtensionByokAdminPolicy(value: unknown): ExtensionByokAdminPolicy {
  const parsed = exactObject(value, [
    'allowedOperations',
    'allowedOrigins',
    'contractVersion',
    'deviceSessionIds',
    'maxConcurrency',
    'mode',
    'ownerUserIds',
    'revision',
    'shopIds',
  ]);
  if (parsed.contractVersion !== EXTENSION_BYOK_ADMIN_POLICY_VERSION
    || !Number.isSafeInteger(parsed.revision)
    || Number(parsed.revision) < 0
    || !['off', 'pilot', 'global'].includes(String(parsed.mode || ''))
    || !Number.isSafeInteger(parsed.maxConcurrency)
    || Number(parsed.maxConcurrency) < 1
    || Number(parsed.maxConcurrency) > 4) {
    return invalidAdminPolicy();
  }

  const policy: ExtensionByokAdminPolicy = {
    contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION,
    revision: Number(parsed.revision),
    mode: parsed.mode as ExtensionByokRolloutMode,
    ownerUserIds: identifierList(parsed.ownerUserIds),
    shopIds: identifierList(parsed.shopIds),
    deviceSessionIds: identifierList(parsed.deviceSessionIds),
    allowedOrigins: originList(parsed.allowedOrigins),
    allowedOperations: operationList(parsed.allowedOperations),
    maxConcurrency: Number(parsed.maxConcurrency),
  };
  if (policy.mode === 'pilot'
    && (!policy.ownerUserIds.length || !policy.shopIds.length || !policy.deviceSessionIds.length)) {
    return invalidAdminPolicy();
  }
  if (policy.mode !== 'off'
    && (!policy.allowedOrigins.length || !policy.allowedOperations.length)) {
    return invalidAdminPolicy();
  }
  return policy;
}

export const extensionByokAdminPolicyStringSchema = z.string()
  .max(100_000)
  .superRefine((value, context) => {
    try {
      parseExtensionByokAdminPolicy(value);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'BYOK 管理策略 JSON 无效或包含未允许字段',
      });
    }
  });

export function composeExtensionByokPolicyFromAdminControls(input: {
  generationEnabled: boolean;
  ingestEnabled: boolean;
  publishEnabled: boolean;
  adminPolicy: unknown;
}): ExtensionByokPolicySnapshot {
  if (typeof input?.generationEnabled !== 'boolean'
    || typeof input?.ingestEnabled !== 'boolean'
    || typeof input?.publishEnabled !== 'boolean') {
    return invalidAdminPolicy();
  }
  const adminPolicy = parseExtensionByokAdminPolicy(input.adminPolicy);
  return parseExtensionByokPolicy({
    ...adminPolicy,
    contractVersion: EXTENSION_BYOK_POLICY_VERSION,
    generationEnabled: input.generationEnabled,
    ingestEnabled: input.ingestEnabled,
    publishEnabled: input.publishEnabled,
  });
}

type ExtensionByokConfigKey =
  | 'feature_extension_byok_ai'
  | 'feature_extension_byok_ingest'
  | 'feature_extension_byok_publish'
  | 'extension_byok_admin_policy';

export function createExtensionByokSystemConfigPolicyLoader(options: {
  readConfig(key: ExtensionByokConfigKey): Promise<unknown>;
}) {
  return async (): Promise<ExtensionByokPolicySnapshot> => {
    const [generationEnabled, ingestEnabled, publishEnabled, adminPolicy] = await Promise.all([
      options.readConfig('feature_extension_byok_ai'),
      options.readConfig('feature_extension_byok_ingest'),
      options.readConfig('feature_extension_byok_publish'),
      options.readConfig('extension_byok_admin_policy'),
    ]);
    return composeExtensionByokPolicyFromAdminControls({
      generationEnabled: generationEnabled as boolean,
      ingestEnabled: ingestEnabled as boolean,
      publishEnabled: publishEnabled as boolean,
      adminPolicy,
    });
  };
}

export function createExtensionHostedAiFlagLoader(options: {
  readConfig(key: 'feature_extension_hosted_ai'): Promise<unknown>;
}) {
  return async (): Promise<boolean> => {
    try {
      return await options.readConfig('feature_extension_hosted_ai') === true;
    } catch {
      return false;
    }
  };
}
