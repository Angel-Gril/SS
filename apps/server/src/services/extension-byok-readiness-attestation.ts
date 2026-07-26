import { z } from 'zod';
import { AI_IMAGE_WORKBENCH_LIMITS } from 'shared';
import {
  canonicalizeExtensionByokProviderOrigin,
  EXTENSION_BYOK_OPERATIONS,
  EXTENSION_BYOK_READINESS_VERSION,
  type ExtensionByokReadinessDecision,
} from './extension-byok-policy.js';

export const EXTENSION_BYOK_READINESS_REQUEST_VERSION =
  'extension-byok-readiness-request/v2' as const;
export const EXTENSION_BYOK_READINESS_ATTESTATION_VERSION =
  'extension-byok-readiness-attestation/v3' as const;
export const EXTENSION_BYOK_READINESS_BINDING_VERSION =
  'extension-byok-readiness-binding/v2' as const;
export const EXTENSION_BYOK_READINESS_TTL_MS = 5 * 60 * 1000;
export const EXTENSION_BYOK_READINESS_MAX_TTL_MS = 10 * 60 * 1000;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

const identifier = z.string().min(1).max(200)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/(?:https?|ftp):\/\//iu.test(value))
  .refine((value) => !/(?:api[_-]?key|access[_-]?token|authorization|password|secret)\s*[:=]/iu.test(value));
const skuIdentifier = z.string().min(1).max(500)
  .refine((value) => value === value.normalize('NFKC').trim())
  .refine((value) => !hasControlCharacter(value))
  .refine((value) => !/[?#]/u.test(value))
  .refine((value) => !/(?:https?|ftp|data):/iu.test(value));

const requestSchema = z.object({
  contractVersion: z.literal(EXTENSION_BYOK_READINESS_REQUEST_VERSION),
  shopId: identifier,
  workflowId: identifier.nullable(),
  draftRevision: z.number().int().positive().nullable(),
  draftVersion: z.number().int().positive().nullable(),
  sourcePlatform: z.enum(['1688', 'pdd', 'taobao', 'tmall']).nullable(),
  sourceProductId: identifier.nullable(),
  sourceCaptureSnapshotId: identifier.nullable(),
  supplyGoodsId: identifier.nullable(),
  skuKey: skuIdentifier.nullable(),
  slotKey: identifier.nullable(),
  assignmentMode: z.literal('APPEND').nullable(),
  assignmentOrdinal: z.number().int().min(0).max(499).nullable(),
  providerOrigin: z.string().min(1).max(2048),
  model: identifier,
  operation: z.enum(EXTENSION_BYOK_OPERATIONS),
}).strict().superRefine((value, context) => {
  const draftValues = [
    value.workflowId,
    value.draftRevision,
    value.draftVersion,
    value.sourcePlatform,
    value.sourceProductId,
    value.sourceCaptureSnapshotId,
    value.supplyGoodsId,
    value.skuKey,
    value.slotKey,
    value.assignmentMode,
    value.assignmentOrdinal,
  ];
  if (!draftValues.every((item) => item === null) && !draftValues.every((item) => item !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['workflowId'],
      message: 'draft readiness identity must be entirely present or absent',
    });
  }
});

export type ExtensionByokReadinessRequest = z.infer<typeof requestSchema> & {
  providerOrigin: string;
};

export interface ExtensionByokReadinessBinding {
  contractVersion: typeof EXTENSION_BYOK_READINESS_BINDING_VERSION;
  ownerUserId: string;
  deviceSessionId: string;
  shopId: string;
  workflowId: string | null;
  draftRevision: number | null;
  draftVersion: number | null;
  sourcePlatform: '1688' | 'pdd' | 'taobao' | 'tmall' | null;
  sourceProductId: string | null;
  sourceCaptureSnapshotId: string | null;
  supplyGoodsId: string | null;
  skuKey: string | null;
  slotKey: string | null;
  assignmentMode: 'APPEND' | null;
  assignmentOrdinal: number | null;
  providerOrigin: string;
  model: string;
  operation: typeof EXTENSION_BYOK_OPERATIONS[number];
  policyRevision: string;
}

export interface ExtensionByokReadinessAttestation {
  contractVersion: typeof EXTENSION_BYOK_READINESS_ATTESTATION_VERSION;
  authenticated: true;
  expiresAt: string;
  binding: ExtensionByokReadinessBinding;
  decision: {
    allowed: true;
    providerOrigin: string;
    policyRevision: number;
    maxConcurrency: number;
  };
}

export class ExtensionByokReadinessAttestationError extends Error {
  constructor(
    public readonly code: 'BYOK_READINESS_REQUEST_INVALID' | 'BYOK_READINESS_NOT_READY',
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokReadinessAttestationError';
  }
}

function fail(
  code: ExtensionByokReadinessAttestationError['code'],
  statusCode: number,
  message: string,
): never {
  throw new ExtensionByokReadinessAttestationError(code, statusCode, message);
}

export function parseExtensionByokReadinessRequest(
  value: unknown,
): ExtensionByokReadinessRequest {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) fail('BYOK_READINESS_REQUEST_INVALID', 400, 'BYOK readiness request is invalid');
  let providerOrigin: string;
  try {
    providerOrigin = canonicalizeExtensionByokProviderOrigin(parsed.data.providerOrigin);
  } catch {
    return fail('BYOK_READINESS_REQUEST_INVALID', 400, 'BYOK Provider origin is invalid');
  }
  return { ...parsed.data, providerOrigin };
}

export function createExtensionByokReadinessAttestation(input: {
  ownerUserId: string;
  deviceSessionId: string;
  request: ExtensionByokReadinessRequest;
  decision: ExtensionByokReadinessDecision;
  now: Date;
}): ExtensionByokReadinessAttestation {
  const nowMillis = input.now instanceof Date ? input.now.getTime() : Number.NaN;
  const decision = input.decision;
  if (!Number.isFinite(nowMillis)
    || decision.contractVersion !== EXTENSION_BYOK_READINESS_VERSION
    || !Number.isSafeInteger(decision.policyRevision)
    || Number(decision.policyRevision) < 0
    || !Number.isSafeInteger(decision.maxConcurrency)
    || decision.maxConcurrency < 1
    || decision.maxConcurrency > AI_IMAGE_WORKBENCH_LIMITS.maxConcurrency
    || !['pilot', 'global'].includes(decision.mode)
    || decision.context.ownerUserId !== input.ownerUserId
    || decision.context.deviceSessionId !== input.deviceSessionId
    || decision.context.shopId !== input.request.shopId
    || decision.context.providerOrigin !== input.request.providerOrigin
    || decision.context.operation !== input.request.operation
    || decision.capabilities.generation.ready !== true) {
    fail('BYOK_READINESS_NOT_READY', 409, 'BYOK Provider execution is not ready');
  }
  const expiresAt = new Date(nowMillis + EXTENSION_BYOK_READINESS_TTL_MS);
  if (expiresAt.getTime() - nowMillis > EXTENSION_BYOK_READINESS_MAX_TTL_MS) {
    fail('BYOK_READINESS_NOT_READY', 409, 'BYOK readiness lifetime is invalid');
  }
  const binding: ExtensionByokReadinessBinding = {
    contractVersion: EXTENSION_BYOK_READINESS_BINDING_VERSION,
    ownerUserId: input.ownerUserId,
    deviceSessionId: input.deviceSessionId,
    shopId: input.request.shopId,
    workflowId: input.request.workflowId,
    draftRevision: input.request.draftRevision,
    draftVersion: input.request.draftVersion,
    sourcePlatform: input.request.sourcePlatform,
    sourceProductId: input.request.sourceProductId,
    sourceCaptureSnapshotId: input.request.sourceCaptureSnapshotId,
    supplyGoodsId: input.request.supplyGoodsId,
    skuKey: input.request.skuKey,
    slotKey: input.request.slotKey,
    assignmentMode: input.request.assignmentMode,
    assignmentOrdinal: input.request.assignmentOrdinal,
    providerOrigin: input.request.providerOrigin,
    model: input.request.model,
    operation: input.request.operation,
    policyRevision: String(decision.policyRevision),
  };
  return {
    contractVersion: EXTENSION_BYOK_READINESS_ATTESTATION_VERSION,
    authenticated: true,
    expiresAt: expiresAt.toISOString(),
    binding,
    decision: {
      allowed: true,
      providerOrigin: input.request.providerOrigin,
      policyRevision: Number(decision.policyRevision),
      maxConcurrency: decision.maxConcurrency,
    },
  };
}
