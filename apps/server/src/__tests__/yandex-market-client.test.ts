import { describe, expect, it, vi } from 'vitest';
import { YandexMarketApiError, YandexMarketClient } from '../services/yandex-market-client.js';

const campaign = { id: 123, domain: 'market.example', business: { id: 77, name: '测试商家' }, placementType: 'FBS', apiAvailability: 'AVAILABLE' };

function clientFor(body: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return { client: new YandexMarketClient({ apiKey: 'synthetic-yandex-key', fetchImpl }), fetchImpl };
}

describe('Yandex Market Partner API client', () => {
  it('uses Api-Key and the v2 campaigns contract for read-only connection checks', async () => {
    const { client, fetchImpl } = clientFor({ campaigns: [campaign], paging: { nextPageToken: 'next' } });
    await expect(client.test('123')).resolves.toMatchObject({ id: '123', placementType: 'FBS', apiAvailability: 'AVAILABLE' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.partner.market.yandex.ru/v2/campaigns?limit=100');
    expect(init).toMatchObject({ method: 'GET', headers: { 'Api-Key': 'synthetic-yandex-key' } });
  });

  it('builds the official offer-mappings update request without retrying or leaking credentials', async () => {
    const { client, fetchImpl } = clientFor({ status: 'OK', results: [{ offerId: 'ss-ozon-1' }] });
    await client.updateOfferMappings('77', [{ offer: { offerId: 'ss-ozon-1', name: 'Товар', description: 'Описание', marketCategoryId: 10, pictures: ['https://cdn.example/a.jpg'], vendor: 'SS', barcodes: ['4601234567890'] } }]);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.partner.market.yandex.ru/v2/businesses/77/offer-mappings/update?language=RU');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Api-Key': 'synthetic-yandex-key', 'Content-Type': 'application/json' } });
    expect(String(init.body)).toContain('ss-ozon-1'); expect(String(init.body)).not.toContain('synthetic-yandex-key');
  });

  it('unwraps the campaign detail response', async () => {
    const { client } = clientFor({ campaign });
    await expect(client.getCampaign('123')).resolves.toMatchObject({ id: '123', business: { id: '77' } });
  });

  it('rejects a configured campaign that is not returned by the token', async () => {
    const { client } = clientFor({ campaigns: [] });
    await expect(client.test('123')).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces API availability as a controlled 409 without leaking raw bodies', async () => {
    const { client } = clientFor({ campaigns: [{ ...campaign, apiAvailability: 'MANUALLY_DISABLED' }] });
    await expect(client.test('123')).rejects.toThrow('MANUALLY_DISABLED');
  });

  it('sanitizes provider errors and rejects untrusted API origins', async () => {
    const { client } = clientFor({ errors: [{ message: 'secret-token-from-provider' }] }, 401);
    await expect(client.getCampaigns()).rejects.toMatchObject({ status: 401 });
    await expect(client.getCampaigns()).rejects.not.toThrow('secret-token-from-provider');
    expect(() => new YandexMarketClient({ apiKey: 'fixture', baseUrl: 'https://evil.example' })).toThrow('地址不受信任');
  });

  it('normalizes timeout and transport failures to a bounded API error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network secret')); const client = new YandexMarketClient({ apiKey: 'fixture', fetchImpl });
    await expect(client.getCampaigns()).rejects.toBeInstanceOf(YandexMarketApiError);
    await expect(client.getCampaigns()).rejects.not.toThrow('network secret');
  });
});
