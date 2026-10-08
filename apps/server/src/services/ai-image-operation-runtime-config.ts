import { getStrictConfigSnapshot, type SystemConfigRecordRevision } from '../config/system-config-schema.js';
import {
  AiImageProviderRuntimeContractError,
  parseAiImageProviderCredentialRevision,
  requiresAiImageProviderCredentialRevision,
  type AiImageProviderRuntimeIdentity,
} from './ai-image-provider-runtime-contract.js';

export type AiImageConfiguredOperation = 'TEXT_TO_IMAGE' | 'IMAGE_TO_IMAGE' | 'FULL_EDIT' | 'INPAINT';

export interface AiImageOperationProviderRuntimeConfig extends AiImageProviderRuntimeIdentity {
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

/** Credentials, their non-secret revision and price are read in one database statement. */
export async function getAiImageOperationProviderRuntimeConfig(
  operation: AiImageConfiguredOperation,
): Promise<AiImageOperationProviderRuntimeConfig> {
  const textKeys = operation === 'TEXT_TO_IMAGE'
    ? ['ai_image_text_to_image_model', 'ai_image_text_to_image_cost_cents'] as const
    : [] as const;
  const { values, revisions } = await getStrictConfigSnapshot([
    'ai_image_provider', 'ai_image_base_url', 'ai_image_api_key',
    'ai_image_model', 'ai_image_generation_cost_cents', 'ai_image_currency',
    ...textKeys,
  ] as const, { includeRevisions: true });
  const provider = values.ai_image_provider;
  const textModel = operation === 'TEXT_TO_IMAGE' ? values.ai_image_text_to_image_model?.trim() : '';
  const model = textModel || values.ai_image_model;
  const credentialBound = requiresAiImageProviderCredentialRevision(provider, model);
  if (credentialBound && !values.ai_image_api_key.trim()) {
    throw new AiImageProviderRuntimeContractError('Provider credential is not configured');
  }
  return {
    provider,
    model,
    baseUrl: values.ai_image_base_url,
    apiKey: values.ai_image_api_key,
    costPerImageCents: textModel
      ? values.ai_image_text_to_image_cost_cents
      : values.ai_image_generation_cost_cents,
    ...(values.ai_image_currency !== 'inherit'
      ? { currency: values.ai_image_currency }
      : provider === 'dashscope-wanx' ? { currency: 'CNY' as const } : {}),
    ...(credentialBound
      ? { credentialRevision: credentialRevision(revisions.ai_image_api_key) } : {}),
  };
}
