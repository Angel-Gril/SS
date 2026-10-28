import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildYandexOfferDraft, type YandexOfferDraftInput } from './yandex-market-offer-draft.js';
import { yandexCategoryId, yandexId, yandexParameterValue, yandexLeafCategories, validateYandexParameters, type YandexCategory, type YandexParameter } from './yandex-market-contract.js';

export const yandexDraftTarget = z.object({
  sourceProductId: z.string().min(1).max(100), marketCategoryId: yandexCategoryId.optional(),
  name: z.string().trim().max(500).optional(), description: z.string().trim().max(6000).optional(),
  vendor: z.string().trim().max(200).optional(), barcodes: z.array(z.string().regex(/^\d{8,32}$/u)).max(100).optional(),
  parameterValues: z.array(yandexParameterValue).max(500).optional(),
}).strict();
export type YandexDraftTarget = z.infer<typeof yandexDraftTarget>;
type CatalogReader = { getCategoryTree(): Promise<YandexCategory>; getCategoryParameters(id: number, businessId: string): Promise<{ categoryId: number; parameters: YandexParameter[] }> };

export async function readYandexBusiness(shop: { clientId: string | null; status: string; config: unknown }, client: { getCampaign(id: string): Promise<{ id: string; business?: { id: string } | null; apiAvailability?: string | null }> }) {
  const campaignId = yandexId.safeParse(shop.clientId);
  if (!campaignId.success || shop.status !== 'ACTIVE') throw new Error('请先成功测试 Yandex 店铺连接');
  const config = shop.config && typeof shop.config === 'object' ? (shop.config as { yandexMarket?: { campaignId?: string; businessId?: string } }).yandexMarket : null;
  if (config?.campaignId && config.campaignId !== campaignId.data) throw new Error('Yandex 店铺映射已变化，请重新测试连接');
  const campaign = await client.getCampaign(campaignId.data);
  if (campaign.id !== campaignId.data || !campaign.business?.id || (campaign.apiAvailability && campaign.apiAvailability !== 'AVAILABLE')
    || (config?.businessId && config.businessId !== campaign.business.id)) throw new Error('Yandex 店铺映射或准入已变化，请重新测试连接');
  return yandexId.parse(campaign.business.id);
}

export function yandexUpdateAccepted(raw: unknown): boolean {
  const value = z.object({ status: z.enum(['OK', 'ERROR']), results: z.array(z.object({
    offerId: z.string(), errors: z.array(z.record(z.unknown())).nullish(),
  }).passthrough()).nullish() }).passthrough().parse(raw);
  return value.status === 'OK' && !value.results?.some(item => item.errors?.length);
}
export async function prepareYandexDrafts(products: YandexOfferDraftInput[], edits: YandexDraftTarget[], client: CatalogReader, businessId: string) {
  yandexId.parse(businessId);
  const targets = z.array(yandexDraftTarget).max(50).parse(edits);
  if (new Set(targets.map(value => value.sourceProductId)).size !== targets.length
    || targets.some(value => !products.some(product => product.id === value.sourceProductId))) throw new Error('Yandex 草稿编辑与所选商品不匹配');
  const categoryIds = [...new Set(targets.map(value => value.marketCategoryId).filter((id): id is number => !!id))];
  if (categoryIds.length > 10) throw new Error('每批最多选择10种 Yandex 类目');
  const leaves = categoryIds.length ? yandexLeafCategories(await client.getCategoryTree()) : [];
  const contracts = new Map<number, YandexParameter[]>();
  for (const id of categoryIds) if (leaves.some(leaf => leaf.id === id)) contracts.set(id, (await client.getCategoryParameters(id, businessId)).parameters);
  const drafts = products.map(product => {
    const target = targets.find(value => value.sourceProductId === product.id);
    const draft = buildYandexOfferDraft(product, target);
    const parameterValues = target?.parameterValues ?? [];
    const extra: string[] = [];
    if (target?.marketCategoryId) {
      const parameters = contracts.get(target.marketCategoryId);
      if (!parameters) extra.push('yandex_leaf_category');
      else extra.push(...validateYandexParameters(parameters, parameterValues));
    } else if (parameterValues.length) extra.push('marketCategoryId');
    if (draft.warnings.includes('name_not_russian')) extra.push('name_russian');
    if (draft.warnings.includes('description_not_russian')) extra.push('description_russian');
    const missingFields = [...new Set([...draft.missingFields, ...extra])];
    return { ...draft, offer: { ...draft.offer, parameterValues }, missingFields, ready: missingFields.length === 0 };
  });
  return { drafts, draftHash: createHash('sha256').update(JSON.stringify({ businessId, drafts: [...drafts].sort((a, b) => a.sourceProductId.localeCompare(b.sourceProductId)) })).digest('hex') };
}
