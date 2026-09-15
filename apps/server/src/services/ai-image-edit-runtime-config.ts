import { getStrictConfigSnapshot, type SystemConfigRecordRevision } from '../config/system-config-schema.js';
import {
  AiImageProviderRuntimeContractError,
  parseAiImageProviderCredentialRevision,
  requiresAiImageProviderCredentialRevision,
  type AiImageProviderRuntimeIdentity,
} from './ai-image-provider-runtime-contract.js';

export interface AiImageEditProviderRuntimeConfig extends AiImageProviderRuntimeIdentity {
  apiKey: string;
}

function credentialRevision(record: SystemConfigRecordRevision | null) {
  return parseAiImageProviderCredentialRevision({
    recordId: record?.id,
    revision: record?.revision,
    updatedAt: record?.updatedAt instanceof Date && !Number.isNaN(record.updatedAt.getTime())
      ? record.updatedAt.toISOString() : null,
  });
}

/** One database statement binds the credential and its non-secret revision to the identity. */
export async function getAiImageEditProviderRuntimeConfig(): Promise<AiImageEditProviderRuntimeConfig> {
  const { values, revisions } = await getStrictConfigSnapshot([
    'ai_image_provider', 'ai_image_base_url', 'ai_image_api_key',
    'ai_image_model', 'ai_image_generation_cost_cents',
  ] as const, { includeRevisions: true });
  const provider = values.ai_image_provider;
  const model = values.ai_image_model;
  const credentialBound = requiresAiImageProviderCredentialRevision(provider, model);
  if (credentialBound && !values.ai_image_api_key.trim()) {
    throw new AiImageProviderRuntimeContractError('Provider credential is not configured');
  }
  return {
    provider,
    model,
    baseUrl: values.ai_image_base_url,
    apiKey: values.ai_image_api_key,
    costPerImageCents: values.ai_image_generation_cost_cents,
    ...(credentialBound
      ? { currency: 'CNY' as const, credentialRevision: credentialRevision(revisions.ai_image_api_key) } : {}),
  };
}
