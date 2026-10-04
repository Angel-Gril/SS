import {
  resolveAiImageProviderCapability,
  hasExactAiMediaSandboxEvidence,
  type AiImageProviderCapability,
  type AiMediaInputTransport,
  type AiMediaOperation,
  type AiMediaResultMode,
} from './ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256, parseAiImageProviderRuntimeContract } from './ai-image-provider-runtime-contract.js';
import { AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE, AI_IMAGE_WANX21_EDIT_MODEL } from './ai-image-wanx-edit-profile.js';
import { parseAiImageTranslationRuntime } from './ai-image-translation-runtime-contract.js';

interface AiImageProviderAdmissionInput {
  capability: AiImageProviderCapability | null | undefined;
  provider: string;
  model: string;
  operation: AiMediaOperation;
  inputTransport: AiMediaInputTransport;
  resultMode: AiMediaResultMode;
  baseUrl?: string;
  /** Internal callers may use the endpoint identity from a validated frozen runtime contract. */
  baseUrlSha256?: string;
}

const OPENAI_ENDPOINT = aiImageProviderEndpointSha256('openai-images', 'https://api.openai.com/v1');
const WANX_ENDPOINT = aiImageProviderEndpointSha256('dashscope-wanx', AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE);

/** Existing-job protocol admission; owners still enforce grants, state, revision and asset ownership. */
export function canUseAiImageJobOperation(input: {
  provider: string | null;
  model?: string | null;
  operation?: string;
  operationConfig?: unknown;
}, production: boolean, resolveCapability = resolveAiImageProviderCapability): boolean {
  const provider = String(input.provider || '').trim();
  if (provider === 'fake') return !production;
  const model = String(input.model || '').trim();
  const operation = String(input.operation || '') as AiMediaOperation;
  const capability = resolveCapability(provider, model);
  if (operation === 'IMAGE_TRANSLATE') {
    const config = input.operationConfig && typeof input.operationConfig === 'object' && !Array.isArray(input.operationConfig)
      ? input.operationConfig as Record<string, unknown> : null;
    try {
      const runtime = parseAiImageTranslationRuntime(config?.translationRuntime);
      return runtime.provider === provider && runtime.model === model && hasExactAiMediaSandboxEvidence({
        capability, provider, model, baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        operation: 'IMAGE_TRANSLATE', inputTransport: 'public_url', resultMode: 'async',
      });
    } catch { return false; }
  }
  if (!capability || !['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(operation)
    || !capability.operations.includes(operation)) return false;
  const config = input.operationConfig;
  const object = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : null;
  const nested = object != null && Object.hasOwn(object, 'providerRuntime');
  const direct = object != null && Object.hasOwn(object, 'contractVersion');
  // Retain the pre-runtime compatibility boundary without promoting unverified legacy jobs.
  if (!nested && !direct) return capability.evidenceLevel === 'sandbox-verified';
  try {
    const runtime = parseAiImageProviderRuntimeContract(nested ? object!.providerRuntime : object);
    return runtime.provider === provider && runtime.model === model && canRunAiImageProviderOperation({
      provider, model, operation, capability, baseUrlSha256: runtime.baseUrlSha256,
      inputTransport: capability.inputTransport, resultMode: capability.resultMode,
    });
  } catch { return false; }
}

/** Protocol admission only. Callers retain authorization, media, price and final dispatch checks. */
export function canRunAiImageProviderOperation(input: AiImageProviderAdmissionInput): boolean {
  const capability = input.capability;
  if (!capability || !input.model.trim()
    || capability.provider !== input.provider
    || !['adapter-characterized', 'sandbox-verified'].includes(capability.evidenceLevel)
    || !capability.operations.includes(input.operation)
    || input.resultMode !== capability.resultMode
    || input.inputTransport !== (input.operation === 'TEXT_TO_IMAGE' ? 'none' : capability.inputTransport)) {
    return false;
  }
  const customText = input.provider === 'custom' && input.operation === 'TEXT_TO_IMAGE';
  if (capability.model !== input.model && !(customText && capability.model === '*')) return false;
  if (capability.model === '*' && !customText) return false;

  let endpointSha256 = input.baseUrlSha256;
  if (endpointSha256 !== undefined && !/^[a-f0-9]{64}$/u.test(endpointSha256)) return false;
  if (input.baseUrl !== undefined) {
    try {
      const configuredEndpoint = aiImageProviderEndpointSha256(input.provider, input.baseUrl);
      if (endpointSha256 !== undefined && endpointSha256 !== configuredEndpoint) return false;
      endpointSha256 = configuredEndpoint;
    } catch {
      return false;
    }
  }
  if (!endpointSha256) return false;

  if (input.provider === 'openai-images') {
    return endpointSha256 === OPENAI_ENDPOINT
      && input.resultMode === 'sync'
      && (input.operation === 'TEXT_TO_IMAGE'
        ? input.inputTransport === 'none'
        : ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(input.operation)
          && input.inputTransport === 'multipart');
  }
  if (input.provider === 'dashscope-wanx') {
    return endpointSha256 === WANX_ENDPOINT
      && input.resultMode === 'async'
      && (input.operation === 'TEXT_TO_IMAGE'
        ? input.inputTransport === 'none'
        : input.model === AI_IMAGE_WANX21_EDIT_MODEL
          && ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(input.operation)
          && input.inputTransport === 'base64');
  }
  if (input.provider !== 'custom' || input.resultMode !== 'sync') return false;
  if (customText) return input.inputTransport === 'none';
  // Existing individually registered custom edits keep their exact endpoint evidence.
  return input.inputTransport === 'multipart'
    && ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(input.operation)
    && capability.evidenceLevel === 'sandbox-verified'
    && Boolean(capability.sandboxEvidence?.some((evidence) => (
      evidence.endpointSha256 === endpointSha256
      && evidence.operation === input.operation
      && evidence.inputTransport === input.inputTransport
      && evidence.resultMode === input.resultMode
    )));
}
