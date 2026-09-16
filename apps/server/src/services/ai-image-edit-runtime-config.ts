import {
  getAiImageOperationProviderRuntimeConfig,
  type AiImageOperationProviderRuntimeConfig,
} from './ai-image-operation-runtime-config.js';

export type AiImageEditProviderRuntimeConfig = AiImageOperationProviderRuntimeConfig;

/** One database statement binds the credential and its non-secret revision to the identity. */
export async function getAiImageEditProviderRuntimeConfig(): Promise<AiImageEditProviderRuntimeConfig> {
  return getAiImageOperationProviderRuntimeConfig('FULL_EDIT');
}
