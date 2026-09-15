import {
  type AiImageProviderCapability,
  type AiMediaInputTransport,
  type AiMediaOperation,
  type AiMediaResultMode,
} from './ai-image-provider-capabilities.js';
import { aiImageProviderEndpointSha256 } from './ai-image-provider-runtime-contract.js';
import { AI_IMAGE_WANX21_EDIT_LEGACY_API_BASE, AI_IMAGE_WANX21_EDIT_MODEL } from './ai-image-wanx-edit-profile.js';

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
          && ['FULL_EDIT', 'INPAINT'].includes(input.operation)
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
