import { createHash, randomUUID } from 'node:crypto';
import { createPrismaSourceListingAiCopyExecutionStore, type SourceListingAiCopyExecutionStore } from './source-listing-ai-copy-execution.js';
import type { AiTextUsage } from './ai-text.js';
import type { PrismaAiTranslationCacheClient } from './ai-translation-cache.js';

export const PRODUCT_VISION_PROMPT_CONTRACT = 'product-vision-workbench/v1';
export interface ProductVisionOperationIdentity {
  ownerUserId: string; draftId: string; operationKey: string; clientRequestHash: string;
}
export interface ProductVisionReceipt {
  clientRequestHash: string; promptContract: typeof PRODUCT_VISION_PROMPT_CONTRACT;
  result: unknown; provider: string; model: string; providerConfigHash: string; usage: AiTextUsage | null;
}
export interface ProductVisionOperationStore extends SourceListingAiCopyExecutionStore {
  findReceipt(input: ProductVisionOperationIdentity): Promise<ProductVisionReceipt | null>;
  saveReceipt(input: ProductVisionOperationIdentity, receipt: ProductVisionReceipt): Promise<void>;
}
const namespace = 'product-vision-receipt';
const promptHash = createHash('sha256').update(PRODUCT_VISION_PROMPT_CONTRACT).digest('hex');
function inputHash(input: ProductVisionOperationIdentity) {
  return createHash('sha256').update(JSON.stringify([PRODUCT_VISION_PROMPT_CONTRACT, input.ownerUserId, input.draftId,
    input.operationKey, input.clientRequestHash])).digest('hex');
}
export function createPrismaProductVisionOperationStore(options: {
  client: Parameters<typeof createPrismaSourceListingAiCopyExecutionStore>[0]['client'] & PrismaAiTranslationCacheClient;
}): ProductVisionOperationStore {
  const executions = createPrismaSourceListingAiCopyExecutionStore({ client: options.client });
  return {
    ...executions,
    claim: (input) => executions.claim({ ...input, operationKey: `vision:${input.operationKey}` }),
    async findReceipt(input) {
      const rows = await options.client.$queryRaw<Array<{ outputText: string }>>`
        SELECT "output_text" AS "outputText" FROM "ai_translation_cache"
        WHERE "namespace" = ${namespace} AND "source_lang" = ${'source-image'} AND "target_lang" = ${'visual-json'}
          AND "input_hash" = ${inputHash(input)} AND "prompt_hash" = ${promptHash}
          AND "status" = 'success' AND "source" = 'ai'
        ORDER BY "updated_at" DESC LIMIT 1
      `;
      if (!rows[0]) return null;
      const raw = rows[0].outputText;
      if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32 * 1024) throw new Error('Vision receipt exceeds its JSON budget');
      return JSON.parse(raw) as ProductVisionReceipt;
    },
    async saveReceipt(input, receipt) {
      const serialized = JSON.stringify(receipt);
      if (Buffer.byteLength(serialized, 'utf8') > 32 * 1024 || receipt.clientRequestHash !== input.clientRequestHash
        || receipt.promptContract !== PRODUCT_VISION_PROMPT_CONTRACT) throw new Error('Vision receipt identity is invalid');
      await options.client.$executeRaw`
        INSERT INTO "ai_translation_cache" ("id", "namespace", "source_lang", "target_lang", "input_hash", "input_text",
          "output_text", "prompt_hash", "provider", "model", "provider_config_hash", "status", "usage_json",
          "expires_at", "last_used_at", "hit_count", "source", "updated_at")
        VALUES (${randomUUID()}, ${namespace}, ${'source-image'}, ${'visual-json'}, ${inputHash(input)},
          ${JSON.stringify(input)}, ${serialized}, ${promptHash}, ${receipt.provider}, ${receipt.model}, ${receipt.providerConfigHash},
          ${'success'}, CAST(${JSON.stringify(receipt.usage)} AS jsonb), NULL, CURRENT_TIMESTAMP, 0, ${'ai'}, CURRENT_TIMESTAMP)
        ON CONFLICT ("namespace", "source_lang", "target_lang", "input_hash", "prompt_hash", "provider", "model", "provider_config_hash")
        DO UPDATE SET "output_text" = EXCLUDED."output_text", "usage_json" = EXCLUDED."usage_json", "updated_at" = CURRENT_TIMESTAMP
      `;
    },
  };
}
