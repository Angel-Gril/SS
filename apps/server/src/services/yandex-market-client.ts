import { z } from 'zod';

export const YANDEX_MARKET_API_BASE_URL = 'https://api.partner.market.yandex.ru';

const id = z.union([z.string().regex(/^\d+$/u), z.number().int().positive()]).transform(String);
const campaignSchema = z.object({
  id,
  domain: z.string().max(200).optional().nullable(),
  clientId: z.union([z.string(), z.number().int()]).optional().nullable(),
  placementType: z.enum(['FBS', 'FBY', 'DBS', 'LAAS']).optional().nullable(),
  apiAvailability: z.enum([
    'AVAILABLE',
    'DISABLED_BY_INACTIVITY',
    'DISABLED_BY_NO_ACTIVE_CONTRACT',
    'MANUALLY_DISABLED',
    'DISABLED_BY_NO_PLACEMENT_TYPE',
  ]).optional().nullable(),
  business: z.object({ id, name: z.string().max(300).optional().nullable() }).optional().nullable(),
}).passthrough();

const campaignsResponseSchema = z.object({
  campaigns: z.array(campaignSchema).max(1000).default([]),
  paging: z.object({ nextPageToken: z.string().max(1000).optional().nullable() }).optional().nullable(),
}).passthrough();
const campaignResponseSchema = z.object({ campaign: campaignSchema }).passthrough();

export type YandexMarketCampaign = z.infer<typeof campaignSchema>;

export class YandexMarketApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'YandexMarketApiError';
  }
}

type ClientOptions = { apiKey: string; baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
export type YandexOfferMappingPayload = {
  offer: {
    offerId: string;
    name: string;
    description: string;
    marketCategoryId: number;
    pictures: string[];
    vendor: string;
    barcodes: string[];
  };
};

/** Thin, server-owned Yandex adapter. It never exposes or logs the Api-Key. */
export class YandexMarketClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    if (!options.apiKey.trim()) throw new Error('Yandex Market Api-Key 未配置');
    this.apiKey = options.apiKey.trim();
    this.baseUrl = options.baseUrl ?? YANDEX_MARKET_API_BASE_URL;
    const parsed = new URL(this.baseUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.partner.market.yandex.ru') {
      throw new Error('Yandex Market API 地址不受信任');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = Math.min(30_000, Math.max(1_000, options.timeoutMs ?? 12_000));
  }

  private async request(path: string, options: { query?: Record<string, string | undefined>; method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) if (value) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Api-Key': this.apiKey },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      if (text.length > 4_000_000) throw new YandexMarketApiError(response.status, 'Yandex Market 响应超过大小限制');
      let payload: unknown = null;
      if (text) {
        try { payload = JSON.parse(text); } catch { throw new YandexMarketApiError(response.status, 'Yandex Market 返回了无效 JSON'); }
      }
      if (!response.ok) {
        const message = z.object({ errors: z.array(z.object({ message: z.string().max(500).optional() }).passthrough()).max(20).optional() }).passthrough().safeParse(payload);
        throw new YandexMarketApiError(response.status, message.success && message.data.errors?.[0]?.message || `Yandex Market 请求失败（HTTP ${response.status}）`);
      }
      return payload;
    } catch (error) {
      if (error instanceof YandexMarketApiError) throw error;
      if ((error as { name?: string })?.name === 'AbortError') throw new YandexMarketApiError(504, 'Yandex Market 请求超时');
      throw new YandexMarketApiError(502, '暂时无法连接 Yandex Market');
    } finally { clearTimeout(timer); }
  }

  async getCampaigns(pageToken?: string): Promise<{ campaigns: YandexMarketCampaign[]; nextPageToken: string | null }> {
    const payload = campaignsResponseSchema.parse(await this.request('/v2/campaigns', { query: { limit: '100', pageToken } }));
    return { campaigns: payload.campaigns, nextPageToken: payload.paging?.nextPageToken || null };
  }

  async getCampaign(campaignId: string): Promise<YandexMarketCampaign> {
    const payload = campaignResponseSchema.parse(await this.request(`/v2/campaigns/${encodeURIComponent(campaignId)}`));
    return payload.campaign;
  }

  async test(campaignId: string): Promise<YandexMarketCampaign> {
    const page = await this.getCampaigns();
    const campaign = page.campaigns.find(item => item.id === campaignId);
    if (!campaign) throw new YandexMarketApiError(404, 'Yandex Market 未返回配置的 campaign ID');
    if (campaign.apiAvailability && campaign.apiAvailability !== 'AVAILABLE') {
      throw new YandexMarketApiError(409, `Yandex Market 店铺 API 当前不可用：${campaign.apiAvailability}`);
    }
    return campaign;
  }

  async updateOfferMappings(businessId: string, offerMappings: YandexOfferMappingPayload[], language = 'RU'): Promise<unknown> {
    if (!/^\d+$/u.test(businessId) || !offerMappings.length || offerMappings.length > 100) throw new Error('Yandex Market 商品发布参数无效');
    return this.request(`/v2/businesses/${encodeURIComponent(businessId)}/offer-mappings/update`, {
      method: 'POST', query: { language }, body: { offerMappings },
    });
  }
}
