import { aiImageProviderEndpointSha256 } from './ai-image-provider-runtime-contract.js';
import {AI_IMAGE_DONOR_GPT2_COUNT_API_BASE} from './ai-image-donor-gpt2-profile.js';
import {
  AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE,
  AI_IMAGE_WANX21_EDIT_MODEL,
} from './ai-image-wanx-edit-profile.js';

export type AiMediaOperation =
  | 'TEXT_TO_IMAGE'
  | 'IMAGE_TO_IMAGE'
  | 'IMAGE_TRANSLATE'
  | 'FULL_EDIT'
  | 'INPAINT';

export type AiMediaInputTransport = 'none' | 'public_url' | 'base64' | 'multipart';
export type AiMediaResultMode = 'sync' | 'async';
export type AiMediaCapabilityEvidence = 'local-test' | 'adapter-characterized' | 'sandbox-verified';

export interface AiMediaSandboxEvidence {
  endpointSha256: string;
  operation: AiMediaOperation;
  inputTransport: AiMediaInputTransport;
  resultMode: AiMediaResultMode;
}

export type AiMediaCapabilityErrorCode =
  | 'UNSUPPORTED_PROVIDER_MODEL'
  | 'UNSUPPORTED_OPERATION'
  | 'INVALID_MEDIA_INPUT';

export interface AiImageProviderCapability {
  provider: string;
  model: string;
  operations: readonly AiMediaOperation[];
  maxReferences: number;
  supportsMask: boolean;
  inputTransport: AiMediaInputTransport;
  resultMode: AiMediaResultMode;
  evidenceLevel: AiMediaCapabilityEvidence;
  evidence: string;
  sandboxEvidence?: readonly AiMediaSandboxEvidence[];
}

export const AI_IMAGE_SUITE_PROVIDER = 'fake';
export const AI_IMAGE_SUITE_MODEL = 'fake-image-suite-v1';
export const AI_IMAGE_EDIT_PROVIDER = 'fake';
export const AI_IMAGE_EDIT_MODEL = 'fake-image-edit-v1';

export class AiMediaCapabilityError extends Error {
  constructor(
    public readonly code: AiMediaCapabilityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiMediaCapabilityError';
  }
}

export const AI_IMAGE_PROVIDER_CAPABILITIES: readonly AiImageProviderCapability[] = [
  {
    provider:'custom',model:'gpt-image-2-count',operations:['IMAGE_TO_IMAGE'],maxReferences:1,supportsMask:false,
    inputTransport:'multipart',resultMode:'sync',evidenceLevel:'sandbox-verified',
    evidence:'2026-10-08 user-authorized ai.big-model-api.top single-reference hero/scene edits each completed once with original 1008x1344 frames, full-frame 900x1200 normalization and visual review; exact endpoint only, no multi-reference/full-edit/inpaint or production default change',
    sandboxEvidence:[{endpointSha256:aiImageProviderEndpointSha256('custom',AI_IMAGE_DONOR_GPT2_COUNT_API_BASE),
      operation:'IMAGE_TO_IMAGE',inputTransport:'multipart',resultMode:'sync'}],
  },
  {
    provider:'custom',model:'gpt-image-2',operations:['IMAGE_TO_IMAGE'],maxReferences:16,supportsMask:false,
    inputTransport:'multipart',resultMode:'sync',evidenceLevel:'adapter-characterized',
    evidence:'User-owned donor 1008x1344 high-quality multipart profile locally adapted; no production endpoint or creative-quality acceptance yet',
  },
  {
    provider: 'dashscope-wanx', model: AI_IMAGE_WANX21_EDIT_MODEL,
    operations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'], maxReferences: 1, supportsMask: true,
    inputTransport: 'base64', resultMode: 'async', evidenceLevel: 'sandbox-verified',
    evidence: 'official Beijing Wanx single-reference IMAGE_TO_IMAGE, full-edit and inpaint create/poll/download transports independently verified; each request accepts one reference; supplier settlement is separate from normal dispatch readiness',
    sandboxEvidence: (['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] as const).map<AiMediaSandboxEvidence>((operation) => ({
      endpointSha256: aiImageProviderEndpointSha256('dashscope-wanx', AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE),
      operation, inputTransport: 'base64', resultMode: 'async',
    })),
  },
  {
    provider: AI_IMAGE_EDIT_PROVIDER,
    model: AI_IMAGE_EDIT_MODEL,
    operations: ['FULL_EDIT', 'INPAINT'],
    maxReferences: 1,
    supportsMask: true,
    inputTransport: 'none',
    resultMode: 'sync',
    evidenceLevel: 'local-test',
    evidence: 'local deterministic full-edit and masked-inpaint lifecycle only; it does not prove a cloud edit transport',
  },
  {
    provider: AI_IMAGE_SUITE_PROVIDER,
    model: AI_IMAGE_SUITE_MODEL,
    operations: ['IMAGE_TO_IMAGE'],
    maxReferences: 5,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'sync',
    evidenceLevel: 'local-test',
    evidence: 'provider-free suite preview and claim contract; it does not dispatch a model',
  },
  {
    provider: 'fake',
    model: '*',
    operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'IMAGE_TRANSLATE'],
    maxReferences: 4,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'sync',
    evidenceLevel: 'local-test',
    evidence: 'local deterministic lifecycle provider; it does not prove a cloud input transport',
  },
  {
    provider: 'dashscope-qwen-mt-image',
    model: 'qwen-mt-image',
    operations: ['IMAGE_TRANSLATE'],
    maxReferences: 1,
    supportsMask: false,
    inputTransport: 'public_url',
    resultMode: 'async',
    evidenceLevel: 'sandbox-verified',
    evidence: 'official DashScope zh-to-ru public-source submit/poll/download verified on seven synthetic product images at 848d308a; five passed manual review and two were rejected for title fidelity or Chinese residue; every production result remains a pending candidate requiring explicit review, not an automatic listing image',
    sandboxEvidence: [{
      endpointSha256: aiImageProviderEndpointSha256('dashscope-qwen-mt-image', 'https://dashscope.aliyuncs.com/api/v1'),
      operation: 'IMAGE_TRANSLATE', inputTransport: 'public_url', resultMode: 'async',
    }],
  },
  {
    provider: 'dashscope-wanx',
    model: 'wanx2.1-t2i-turbo',
    operations: ['TEXT_TO_IMAGE'],
    maxReferences: 0,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'async',
    evidenceLevel: 'adapter-characterized',
    evidence: 'current adapter only submits text2image/image-synthesis',
  },
  {
    provider: 'dashscope-wanx',
    model: '*',
    operations: ['TEXT_TO_IMAGE'],
    maxReferences: 0,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'async',
    evidenceLevel: 'adapter-characterized',
    evidence: 'legacy text-to-image compatibility only; wildcard models are not sandbox acceptance',
  },
  {
    provider: 'openai-images',
    model: 'gpt-image-1',
    operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
    maxReferences: 16,
    supportsMask: true,
    inputTransport: 'multipart',
    resultMode: 'sync',
    evidenceLevel: 'adapter-characterized',
    evidence: 'images/generations and multipart images/edits adapters are locally characterized; sandbox acceptance remains pending',
  },
  {
    provider: 'openai-images',
    model: '*',
    operations: ['TEXT_TO_IMAGE'],
    maxReferences: 0,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'sync',
    evidenceLevel: 'adapter-characterized',
    evidence: 'legacy text-to-image compatibility only; wildcard models are not sandbox acceptance',
  },
  {
    provider: 'custom',
    model: '*',
    operations: ['TEXT_TO_IMAGE'],
    maxReferences: 0,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'sync',
    evidenceLevel: 'adapter-characterized',
    evidence: 'OpenAI-compatible text-to-image adapter only; each exact host and model requires separate sandbox acceptance',
  },
];

export function resolveAiImageProviderCapability(
  provider: string,
  model: string,
  operation?: AiMediaOperation,
): AiImageProviderCapability | null {
  const exact = AI_IMAGE_PROVIDER_CAPABILITIES.find(entry=>entry.provider===provider&&entry.model===model);
  // An edit-specific addition must not shadow the existing text-only fallback.
  // Edit admission still requires exact model/endpoint evidence.
  if (operation==='TEXT_TO_IMAGE' && exact && !exact.operations.includes(operation)) {
    return AI_IMAGE_PROVIDER_CAPABILITIES.find(entry=>entry.provider===provider&&entry.model==='*'&&entry.operations.includes(operation)) || null;
  }
  return (
    AI_IMAGE_PROVIDER_CAPABILITIES.find(
      (entry) => entry.provider === provider && entry.model === model,
    ) ||
    AI_IMAGE_PROVIDER_CAPABILITIES.find(
      (entry) => entry.provider === provider && entry.model === '*',
    ) ||
    null
  );
}

export function hasExactAiMediaSandboxEvidence(input: {
  capability: AiImageProviderCapability | null | undefined;
  provider: string;
  model: string;
  baseUrl: string;
  operation: AiMediaOperation;
  inputTransport: AiMediaInputTransport;
  resultMode: AiMediaResultMode;
}): boolean {
  const capability = input.capability;
  if (!capability
    || capability.evidenceLevel !== 'sandbox-verified'
    || capability.provider !== input.provider
    || capability.model !== input.model
    || capability.model === '*'
    || !capability.operations.includes(input.operation)
    || !Array.isArray(capability.sandboxEvidence)) {
    return false;
  }
  let endpointSha256: string;
  try {
    endpointSha256 = aiImageProviderEndpointSha256(input.provider, input.baseUrl);
  } catch {
    return false;
  }
  return capability.sandboxEvidence.some((evidence) => (
    /^[a-f0-9]{64}$/u.test(evidence.endpointSha256)
    && evidence.endpointSha256 === endpointSha256
    && evidence.operation === input.operation
    && evidence.inputTransport === input.inputTransport
    && evidence.resultMode === input.resultMode
  ));
}

function aiMediaReferenceBounds(
  capability: AiImageProviderCapability,
  operation: AiMediaOperation,
) {
  if (operation === 'TEXT_TO_IMAGE') return { minimum: 0, maximum: 0 };
  if (operation === 'IMAGE_TO_IMAGE') {
    return { minimum: 1, maximum: capability.maxReferences };
  }
  return { minimum: 1, maximum: 1 };
}

export function supportsAiMediaOperation(
  provider: string,
  model: string,
  operation: AiMediaOperation,
  inputCount = 0,
  maskCountOrHasMask: number | boolean = 0,
): boolean {
  const capability = resolveAiImageProviderCapability(provider, model,operation);
  return capabilitySupportsOperation(capability, operation, inputCount, maskCountOrHasMask);
}

function capabilitySupportsOperation(
  capability: AiImageProviderCapability | null,
  operation: AiMediaOperation,
  inputCount: number,
  maskCountOrHasMask: number | boolean,
): boolean {
  if (!capability || !capability.operations.includes(operation)) return false;
  if (!Number.isInteger(inputCount) || inputCount < 0) return false;
  const maskCount = typeof maskCountOrHasMask === 'boolean'
    ? (maskCountOrHasMask ? 1 : 0)
    : maskCountOrHasMask;
  if (!Number.isInteger(maskCount) || maskCount < 0) return false;
  const referenceBounds = aiMediaReferenceBounds(capability, operation);
  if (inputCount < referenceBounds.minimum || inputCount > referenceBounds.maximum) return false;
  if (maskCount > 0 && !capability.supportsMask) return false;
  if (operation === 'INPAINT') return maskCount === 1;
  return maskCount === 0;
}

export function assertAiMediaCapability(input: {
  provider: string;
  model: string;
  operation: AiMediaOperation;
  inputCount?: number;
  maskCount?: number;
  hasMask?: boolean;
}, resolver = resolveAiImageProviderCapability) {
  const capability = resolver(input.provider, input.model,input.operation);
  if (!capability || capability.provider !== input.provider || (capability.model !== input.model && capability.model !== '*')) {
    throw new AiMediaCapabilityError(
      'UNSUPPORTED_PROVIDER_MODEL',
      `AI provider/model capability is not registered: ${input.provider}/${input.model}`,
    );
  }
  const inputCount = input.inputCount ?? 0;
  if (!Number.isInteger(inputCount) || inputCount < 0) {
    throw new AiMediaCapabilityError(
      'INVALID_MEDIA_INPUT',
      'AI media reference count must be a non-negative integer',
    );
  }
  const maskCount = input.maskCount ?? (input.hasMask ? 1 : 0);
  if (
    !Number.isInteger(maskCount)
    || maskCount < 0
    || (input.maskCount !== undefined
      && input.hasMask !== undefined
      && input.hasMask !== (maskCount > 0))
  ) {
    throw new AiMediaCapabilityError(
      'INVALID_MEDIA_INPUT',
      'AI media mask count must be a non-negative integer consistent with hasMask',
    );
  }
  if (!capability.operations.includes(input.operation)) {
    throw new AiMediaCapabilityError(
      'UNSUPPORTED_OPERATION',
      `AI provider does not support ${input.operation}: ${input.provider}/${input.model}`,
    );
  }
  if (
    !capabilitySupportsOperation(
      capability,
      input.operation,
      inputCount,
      maskCount,
    )
  ) {
    throw new AiMediaCapabilityError(
      'INVALID_MEDIA_INPUT',
      `AI media inputs do not satisfy ${input.operation}: ${input.provider}/${input.model}`,
    );
  }
  return capability;
}
