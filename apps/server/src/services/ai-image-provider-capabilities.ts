export type AiMediaOperation =
  | 'TEXT_TO_IMAGE'
  | 'IMAGE_TO_IMAGE'
  | 'IMAGE_TRANSLATE'
  | 'FULL_EDIT'
  | 'INPAINT';

export type AiMediaInputTransport = 'none' | 'public_url' | 'base64' | 'multipart';
export type AiMediaResultMode = 'sync' | 'async';
export type AiMediaCapabilityEvidence = 'local-test' | 'adapter-characterized' | 'sandbox-verified';

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
}

export const AI_IMAGE_SUITE_PROVIDER = 'fake';
export const AI_IMAGE_SUITE_MODEL = 'fake-image-suite-v1';

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
    evidenceLevel: 'adapter-characterized',
    evidence: 'request and polling contract characterized from the reference client; sandbox acceptance remains pending',
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
    operations: ['TEXT_TO_IMAGE'],
    maxReferences: 0,
    supportsMask: false,
    inputTransport: 'none',
    resultMode: 'sync',
    evidenceLevel: 'adapter-characterized',
    evidence: 'current adapter only submits images/generations',
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
];

export function resolveAiImageProviderCapability(
  provider: string,
  model: string,
): AiImageProviderCapability | null {
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

export function supportsAiMediaOperation(
  provider: string,
  model: string,
  operation: AiMediaOperation,
  inputCount = 0,
  hasMask = false,
): boolean {
  const capability = resolveAiImageProviderCapability(provider, model);
  if (!capability || !capability.operations.includes(operation)) return false;
  if (inputCount > capability.maxReferences) return false;
  if (hasMask && !capability.supportsMask) return false;
  if (operation === 'TEXT_TO_IMAGE' && inputCount !== 0) return false;
  if (operation === 'IMAGE_TRANSLATE' && inputCount !== 1) return false;
  if (operation !== 'TEXT_TO_IMAGE' && inputCount < 1) return false;
  return true;
}

export function assertAiMediaCapability(input: {
  provider: string;
  model: string;
  operation: AiMediaOperation;
  inputCount?: number;
  hasMask?: boolean;
}) {
  const capability = resolveAiImageProviderCapability(input.provider, input.model);
  if (!capability) {
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
  if (!capability.operations.includes(input.operation)) {
    throw new AiMediaCapabilityError(
      'UNSUPPORTED_OPERATION',
      `AI provider does not support ${input.operation}: ${input.provider}/${input.model}`,
    );
  }
  if (
    !supportsAiMediaOperation(
      input.provider,
      input.model,
      input.operation,
      inputCount,
      input.hasMask ?? false,
    )
  ) {
    throw new AiMediaCapabilityError(
      'INVALID_MEDIA_INPUT',
      `AI media inputs do not satisfy ${input.operation}: ${input.provider}/${input.model}`,
    );
  }
  return capability;
}
