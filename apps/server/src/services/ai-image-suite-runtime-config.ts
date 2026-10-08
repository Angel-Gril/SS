import { isDeepStrictEqual } from 'node:util';
import { getStrictConfigSnapshot, type SystemConfigRecordRevision } from '../config/system-config-schema.js';
import {
  getAiImageOperationProviderRuntimeConfig,
  type AiImageOperationProviderRuntimeConfig,
} from './ai-image-operation-runtime-config.js';
import {
  AiImageProviderRuntimeContractError,
  parseAiImageProviderCredentialRevision,
  requiresAiImageProviderCredentialRevision,
} from './ai-image-provider-runtime-contract.js';

const suiteProviderKey = ['ai_image_suite_provider'] as const;
const suiteKeys = [
  'ai_image_suite_provider', 'ai_image_suite_base_url', 'ai_image_suite_api_key',
  'ai_image_suite_model', 'ai_image_suite_cost_cents', 'ai_image_suite_currency',
] as const;

interface SuiteProviderSelection {
  values: { ai_image_suite_provider: string };
  revisions: { ai_image_suite_provider: SystemConfigRecordRevision | null };
}

function assertStableSelection(before: SuiteProviderSelection, after: SuiteProviderSelection) {
  if (before.values.ai_image_suite_provider !== after.values.ai_image_suite_provider
    || !isDeepStrictEqual(before.revisions.ai_image_suite_provider, after.revisions.ai_image_suite_provider)) {
    throw new AiImageProviderRuntimeContractError('Suite Provider selection changed while reading configuration');
  }
}

function credentialRevision(record: SystemConfigRecordRevision | null) {
  return parseAiImageProviderCredentialRevision({
    recordId: record?.id,
    revision: record?.revision,
    updatedAt: record?.updatedAt instanceof Date && !Number.isNaN(record.updatedAt.getTime())
      ? record.updatedAt.toISOString() : null,
  });
}

/** Read only the selected family; a dedicated suite never borrows global identity, Key or price. */
export async function getAiImageSuiteProviderRuntimeConfig(): Promise<AiImageOperationProviderRuntimeConfig> {
  const selected = await getStrictConfigSnapshot(suiteProviderKey, { includeRevisions: true });
  if (selected.values.ai_image_suite_provider === 'inherit') {
    const inherited = await getAiImageOperationProviderRuntimeConfig('IMAGE_TO_IMAGE');
    const current = await getStrictConfigSnapshot(suiteProviderKey, { includeRevisions: true });
    assertStableSelection(selected, current);
    return inherited;
  }

  // The selector and all execution fields share this statement. The first read only selects
  // which family may be decrypted; reject concurrent selector writes rather than mix families.
  const snapshot = await getStrictConfigSnapshot(suiteKeys, { includeRevisions: true });
  assertStableSelection(selected, snapshot);
  const { values, revisions } = snapshot;
  const provider = values.ai_image_suite_provider;
  const model = values.ai_image_suite_model;
  const credentialBound = requiresAiImageProviderCredentialRevision(provider, model);
  if (credentialBound && !values.ai_image_suite_api_key.trim()) {
    throw new AiImageProviderRuntimeContractError('Provider credential is not configured');
  }
  return {
    provider,
    model,
    baseUrl: values.ai_image_suite_base_url,
    apiKey: values.ai_image_suite_api_key,
    costPerImageCents: values.ai_image_suite_cost_cents,
    currency: values.ai_image_suite_currency,
    ...(credentialBound
      ? { credentialRevision: credentialRevision(revisions.ai_image_suite_api_key) } : {}),
  };
}
