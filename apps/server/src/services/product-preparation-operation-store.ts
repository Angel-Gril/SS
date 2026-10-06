import { createHash, randomUUID } from 'node:crypto';
import { createPrismaSourceListingAiCopyExecutionStore, type SourceListingAiCopyExecutionStore } from './source-listing-ai-copy-execution.js';
import type { PrismaAiTranslationCacheClient } from './ai-translation-cache.js';
import type { ProductVisionOperationIdentity, ProductVisionReceipt } from './product-vision-operation-store.js';
import { PRODUCT_PREPARATION_PROMPT_CONTRACT } from './product-preparation-report.js';
import { productPreparationFailureSchema, type ProductPreparationFailure, type ProductPreparationStage } from './product-preparation-stages.js';
export { PRODUCT_PREPARATION_PROMPT_CONTRACT } from './product-preparation-report.js';
export interface ProductPreparationOperationIdentity extends ProductVisionOperationIdentity { stage?: ProductPreparationStage }
export interface ProductPreparationReceipt extends Omit<ProductVisionReceipt, 'promptContract'> {
  promptContract: typeof PRODUCT_PREPARATION_PROMPT_CONTRACT;
}
export interface ProductPreparationOperationStore extends SourceListingAiCopyExecutionStore {
  findReceipt(input: ProductPreparationOperationIdentity): Promise<ProductPreparationReceipt | null>;
  saveReceipt(input: ProductPreparationOperationIdentity, receipt: ProductPreparationReceipt): Promise<void>;
  findFailure?(input: ProductPreparationOperationIdentity): Promise<ProductPreparationFailure | null>;
  saveFailure?(input: ProductPreparationOperationIdentity, failure: ProductPreparationFailure): Promise<void>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const promptHash = hash(PRODUCT_PREPARATION_PROMPT_CONTRACT);
const namespace = 'product-preparation-receipt';
const receiptNamespace = (input: ProductPreparationOperationIdentity) => input.stage ? `${namespace}-${input.stage.toLowerCase()}` : namespace;
const inputHash = (input: ProductPreparationOperationIdentity) => hash([PRODUCT_PREPARATION_PROMPT_CONTRACT, input.ownerUserId, input.draftId, input.operationKey, input.clientRequestHash]);
export function createPrismaProductPreparationOperationStore(options: {
  client: Parameters<typeof createPrismaSourceListingAiCopyExecutionStore>[0]['client'] & PrismaAiTranslationCacheClient;
}): ProductPreparationOperationStore {
  const executions = createPrismaSourceListingAiCopyExecutionStore({ client: options.client });
  return { ...executions, claim: input => executions.claim({ ...input, operationKey: `preparation:${input.operationKey}` }),
    async findReceipt(input) {
      const rows = await options.client.$queryRaw<Array<{ outputText: string }>>`
        SELECT "output_text" AS "outputText" FROM "ai_translation_cache"
        WHERE "namespace" = ${receiptNamespace(input)} AND "source_lang" = ${'source-product'} AND "target_lang" = ${'preparation-json'}
          AND "input_hash" = ${inputHash(input)} AND "prompt_hash" = ${promptHash} AND "status" = 'success' AND "source" = 'ai'
        ORDER BY "updated_at" DESC LIMIT 1
      `;
      if (!rows[0]) return null;
      if (Buffer.byteLength(rows[0].outputText, 'utf8') > 64 * 1024) throw new Error('Preparation receipt exceeds its JSON budget');
      return JSON.parse(rows[0].outputText) as ProductPreparationReceipt;
    },
    async saveReceipt(input, receipt) {
      const serialized = JSON.stringify(receipt);
      if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024 || receipt.clientRequestHash !== input.clientRequestHash
        || receipt.promptContract !== PRODUCT_PREPARATION_PROMPT_CONTRACT) throw new Error('Preparation receipt identity invalid');
      await options.client.$executeRaw`
        INSERT INTO "ai_translation_cache" ("id", "namespace", "source_lang", "target_lang", "input_hash", "input_text",
          "output_text", "prompt_hash", "provider", "model", "provider_config_hash", "status", "usage_json",
          "expires_at", "last_used_at", "hit_count", "source", "updated_at")
        VALUES (${randomUUID()}, ${receiptNamespace(input)}, ${'source-product'}, ${'preparation-json'}, ${inputHash(input)},
          ${JSON.stringify(input)}, ${serialized}, ${promptHash}, ${receipt.provider}, ${receipt.model}, ${receipt.providerConfigHash},
          ${'success'}, CAST(${JSON.stringify(receipt.usage)} AS jsonb), NULL, CURRENT_TIMESTAMP, 0, ${'ai'}, CURRENT_TIMESTAMP)
        ON CONFLICT ("namespace", "source_lang", "target_lang", "input_hash", "prompt_hash", "provider", "model", "provider_config_hash")
        DO UPDATE SET "output_text" = EXCLUDED."output_text", "usage_json" = EXCLUDED."usage_json", "updated_at" = CURRENT_TIMESTAMP
      `;
    },
    async findFailure(input) {
      const rows = await options.client.$queryRaw<Array<{ outputText: string }>>`
        SELECT "output_text" AS "outputText" FROM "ai_translation_cache"
        WHERE "namespace" = ${`${receiptNamespace(input)}-failure`} AND "source_lang" = ${'source-product'} AND "target_lang" = ${'preparation-failure'}
          AND "input_hash" = ${inputHash(input)} AND "prompt_hash" = ${promptHash} AND "status" = 'failed'
        ORDER BY "updated_at" DESC LIMIT 1
      `;
      if (!rows[0]) return null;
      if (Buffer.byteLength(rows[0].outputText, 'utf8') > 1024) throw new Error('Preparation failure exceeds its budget');
      const failure = productPreparationFailureSchema.parse(JSON.parse(rows[0].outputText));
      if (failure.stage !== input.stage) throw new Error('Preparation failure stage is unbound');
      return failure;
    },
    async saveFailure(input, rawFailure) {
      const failure = productPreparationFailureSchema.parse(rawFailure);
      if (failure.stage !== input.stage) throw new Error('Preparation failure stage is unbound');
      await options.client.$executeRaw`
        INSERT INTO "ai_translation_cache" ("id", "namespace", "source_lang", "target_lang", "input_hash", "input_text",
          "output_text", "prompt_hash", "provider", "model", "provider_config_hash", "status", "usage_json",
          "expires_at", "last_used_at", "hit_count", "source", "updated_at")
        VALUES (${randomUUID()}, ${`${receiptNamespace(input)}-failure`}, ${'source-product'}, ${'preparation-failure'}, ${inputHash(input)},
          ${JSON.stringify(input)}, ${JSON.stringify(failure)}, ${promptHash}, ${'preparation-owner'}, ${'failure-classification'}, ${promptHash},
          ${'failed'}, NULL, NULL, CURRENT_TIMESTAMP, 0, ${'system'}, CURRENT_TIMESTAMP)
        ON CONFLICT ("namespace", "source_lang", "target_lang", "input_hash", "prompt_hash", "provider", "model", "provider_config_hash")
        DO UPDATE SET "output_text" = EXCLUDED."output_text", "updated_at" = CURRENT_TIMESTAMP
      `;
    },
  };
}
