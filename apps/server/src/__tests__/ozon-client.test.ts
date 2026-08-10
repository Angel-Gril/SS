import { describe, expect, it, vi } from 'vitest';
import {
  getOzonWarehouseCoordinates,
  normalizeOzonWarehouseAddressEvidence,
  OzonApiError,
  OzonClient,
  OzonNetworkError,
} from '../services/ozon-client.js';

describe('Ozon client errors', () => {
  it('localizes blocked company errors for shop-dependent Ozon APIs', () => {
    const error = new OzonApiError(
      403,
      JSON.stringify({ message: 'Company is blocked, please contact support' }),
      '/v1/description-category/tree',
    );

    expect(error.publicMessage).toContain('当前 Ozon 店铺或公司已被平台限制');
    expect(error.publicMessage).toContain('请选择其他店铺');
    expect(error.message).not.toContain('Company is blocked');
  });

  it('uses a single non-retrying request for V3 product imports', async () => {
    const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
    class StubClient extends OzonClient {
      override async request<T = unknown>(path: string, options: Record<string, unknown> = {}): Promise<T> {
        calls.push({ path, options });
        return { result: { task_id: 123 } } as T;
      }
    }
    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    const item = {
      description_category_id: 1,
      type_id: 2,
      name: 'Товар',
      offer_id: 'offer-1',
      price: '100.00',
      old_price: '120.00',
      vat: '0',
      dimension_unit: 'mm',
      weight_unit: 'g',
      weight: 500,
      height: 100,
      depth: 200,
      width: 150,
      images: ['https://cdn.example.test/image.jpg'],
      currency_code: 'CNY',
    };

    await expect(client.importProductsOnce([item])).resolves.toEqual({ result: { task_id: 123 } });
    expect(calls).toEqual([{
      path: '/v3/product/import',
      options: { body: { items: [item] }, skipRetry: true },
    }]);
  });

  it('preserves an exact Ozon import task ID beyond JavaScript safe integers', async () => {
    const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
    class StubClient extends OzonClient {
      override async request<T = unknown>(path: string, options: Record<string, unknown> = {}): Promise<T> {
        calls.push({ path, options });
        return { result: { items: [] } } as T;
      }
    }
    const client = new StubClient({ clientId: 'client', apiKey: 'key' });

    await client.getImportInfo('9007199254740997');

    expect(calls).toEqual([{
      path: '/v1/product/import/info',
      options: { body: { task_id: '9007199254740997' } },
    }]);
  });

  it('keeps the request timeout active while the response body is being read', async () => {
    const observed: { signal?: AbortSignal } = {};
    const requestFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      observed.signal = init?.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => new Promise((_resolve, reject) => {
          observed.signal?.addEventListener('abort', () => {
            reject(new DOMException('response body timed out', 'AbortError'));
          }, { once: true });
        }),
      } as Response;
    });
    const client = new OzonClient({
      clientId: 'client',
      apiKey: 'key',
      maxRetries: 0,
      timeoutMs: 20,
      requestFetch,
    });
    const item = {
      description_category_id: 1,
      type_id: 2,
      name: 'Товар',
      offer_id: 'offer-timeout',
      price: '100.00',
      old_price: '120.00',
      vat: '0',
      dimension_unit: 'mm',
      weight_unit: 'g',
      weight: 500,
      height: 100,
      depth: 200,
      width: 150,
      images: ['https://cdn.example.test/image.jpg'],
      currency_code: 'CNY',
    };

    await expect(client.importProductsOnce([item])).rejects.toBeInstanceOf(OzonNetworkError);
    expect(requestFetch).toHaveBeenCalledTimes(1);
    expect(observed.signal?.aborted).toBe(true);
  });
});

describe('Ozon client warehouse APIs', () => {
  it('reads warehouse coordinates from the current address_info response field', () => {
    expect(getOzonWarehouseCoordinates({
      address_info: {
        address: 'China, Fujian Sheng, Xiamen',
        latitude: 24.480107,
        longitude: 118.085348,
      },
    })).toEqual({
      latitude: 24.480107,
      longitude: 118.085348,
    });
  });

  it('normalizes the real RETS OpenAPI Xiamen address evidence', () => {
    expect(normalizeOzonWarehouseAddressEvidence({
      warehouse_id: 1020005015663520,
      address_info: {
        address: 'China, 361000, Fujian Sheng, Xiamen, Hai cang qu,hai hong lu 86 hao,huiqi, 1430',
        latitude: 24.480107,
        longitude: 118.085348,
      },
    }, '1020005015663520')).toEqual({
      countryCode: 'CN',
      city: 'Xiamen',
      zipCode: '361000',
    });
  });

  it('normalizes a coherent non-Xiamen China warehouse without clearing it', () => {
    expect(normalizeOzonWarehouseAddressEvidence({
      warehouse_id: 1002,
      address_info: {
        address: 'China, 518000, Guangdong Sheng, Shenzhen, Nanshan qu',
        latitude: 22.5431,
        longitude: 114.0579,
      },
    }, '1002')).toEqual({
      countryCode: 'CN',
      city: 'Shenzhen',
      zipCode: '518000',
    });
  });

  it('rejects address evidence associated with a different warehouse id', () => {
    expect(normalizeOzonWarehouseAddressEvidence({
      warehouse_id: 1020005015663520,
      address_info: {
        address: 'China, Fujian Sheng, Xiamen',
        latitude: 24.480107,
        longitude: 118.085348,
      },
    }, '1020005015663521')).toBeNull();
  });

  it.each([
    {
      label: 'Xiamen address with Shenzhen coordinates',
      address: 'China, Fujian Sheng, Xiamen',
      latitude: 22.5431,
      longitude: 114.0579,
    },
    {
      label: 'Shenzhen address with Xiamen coordinates',
      address: 'China, Guangdong Sheng, Shenzhen',
      latitude: 24.480107,
      longitude: 118.085348,
    },
  ])('rejects conflicting OpenAPI city and coordinate evidence: $label', (input) => {
    expect(normalizeOzonWarehouseAddressEvidence({
      warehouse_id: 1020005015663520,
      address_info: input,
    }, '1020005015663520')).toBeNull();
  });

  it.each([
    { address: undefined, latitude: 24.480107, longitude: 118.085348 },
    { address: 'China, Fujian Sheng, Xiamen', latitude: undefined, longitude: undefined },
    { address: 'China, Fujian Sheng, Xiamen', latitude: 24.480107, longitude: undefined },
  ])('does not normalize incomplete OpenAPI address evidence: %j', (addressInfo) => {
    expect(normalizeOzonWarehouseAddressEvidence({
      warehouse_id: 1020005015663520,
      address_info: addressInfo,
    }, '1020005015663520')).toBeUndefined();
  });

  it('reads delivery methods from the current delivery_methods response field', async () => {
    class StubClient extends OzonClient {
      override async request<T = unknown>(_path: string, _options = {}): Promise<T> {
        return {
          delivery_methods: [
            {
              id: 26168680,
              warehouse_id: 1020005012470660,
              name: 'CEL Standard Budget',
              provider_id: 1164,
              provider_name: 'CEL',
              tpl_dropoff_point: {
                code: 'CEL0030AN',
                name: 'CEL福建厦门集货仓',
                address: '厦门市海沧区东孚街道凤山西路6号1层',
              },
            },
          ],
        } as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    const methods = await client.listDeliveryMethods({ limit: 50, offset: 0 });

    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      id: 26168680,
      provider_id: 1164,
      tpl_dropoff_point: {
        code: 'CEL0030AN',
        name: 'CEL福建厦门集货仓',
      },
    });
  });

  it('sends coordinates and is_kgt when searching FBS drop-off points', async () => {
    const bodies: unknown[] = [];
    class StubClient extends OzonClient {
      override async request<T = unknown>(_path: string, options: { body?: unknown } = {}): Promise<T> {
        bodies.push(options.body);
        return { points: [] } as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    await client.searchFbsDropOffPoints({
      warehouseId: 1020005012470660,
      address: '厦门',
      coordinates: { latitude: 24.4421, longitude: 118.0619 },
    });

    expect(bodies[0]).toMatchObject({
      coordinates: { latitude: 24.4421, longitude: 118.0619 },
      country_code: 'CN',
      is_kgt: false,
      search: { address: '厦门', types: ['PPZ'] },
      warehouse_id: 1020005012470660,
    });
  });

  it('rejects FBS drop-off point search without real warehouse coordinates', async () => {
    const client = new OzonClient({ clientId: 'client', apiKey: 'key' });

    await expect(client.searchFbsDropOffPoints({ warehouseId: 1020005012470660, address: '厦门' }))
      .rejects
      .toThrow('需要仓库经纬度');
  });
});

describe('Ozon attribute dictionary pagination', () => {
  it('retains has_next and exposes the next cursor from an attribute-value page', async () => {
    const calls: Array<{ path: string; body: unknown }> = [];
    class StubClient extends OzonClient {
      override async request<T = unknown>(path: string, options: { body?: unknown } = {}): Promise<T> {
        calls.push({ path, body: options.body });
        return {
          result: [
            { id: 101, value: 'белый', info: '', picture: '' },
            { id: 102, value: 'бежевый', info: '', picture: '' },
          ],
          has_next: true,
        } as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    const page = await client.getAttributeValuesPage({
      description_category_id: 17028706,
      type_id: 95913,
      attribute_id: 10096,
      language: 'DEFAULT',
      last_value_id: 50,
      limit: 2,
    });

    expect(page).toEqual({
      values: [
        { id: 101, value: 'белый', info: '', picture: '' },
        { id: 102, value: 'бежевый', info: '', picture: '' },
      ],
      hasNext: true,
      nextCursor: 102,
    });
    expect(calls).toEqual([{
      path: '/v1/description-category/attribute/values',
      body: {
        description_category_id: 17028706,
        type_id: 95913,
        attribute_id: 10096,
        language: 'DEFAULT',
        last_value_id: 50,
        limit: 2,
      },
    }]);
  });

  it('fetches every page and deduplicates values by id for existing callers', async () => {
    const cursors: number[] = [];
    class StubClient extends OzonClient {
      override async request<T = unknown>(_path: string, options: { body?: unknown } = {}): Promise<T> {
        const cursor = Number((options.body as { last_value_id?: number })?.last_value_id || 0);
        cursors.push(cursor);
        return (cursor === 0
          ? {
            result: [
              { id: 101, value: 'белый', info: '', picture: '' },
              { id: 102, value: 'бежевый', info: '', picture: '' },
            ],
            has_next: true,
          }
          : {
            result: [
              { id: 102, value: 'бежевый', info: '', picture: '' },
              { id: 103, value: 'черный', info: '', picture: '' },
            ],
            has_next: false,
          }) as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    const values = await client.getAttributeValues({
      description_category_id: 17028706,
      type_id: 95913,
      attribute_id: 10096,
      limit: 2,
    });

    expect(values.map(({ id }) => id)).toEqual([101, 102, 103]);
    expect(cursors).toEqual([0, 102]);
  });

  it('rejects a paginated response whose cursor does not advance', async () => {
    class StubClient extends OzonClient {
      override async request<T = unknown>(): Promise<T> {
        return {
          result: [{ id: 101, value: 'белый', info: '', picture: '' }],
          has_next: true,
        } as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    await expect(client.getAttributeValues({
      description_category_id: 17028706,
      type_id: 95913,
      attribute_id: 10096,
      limit: 1,
    })).rejects.toThrow('cursor did not advance');
  });

  it('rejects pagination that exceeds the configured page cap', async () => {
    class StubClient extends OzonClient {
      override async request<T = unknown>(_path: string, options: { body?: unknown } = {}): Promise<T> {
        const cursor = Number((options.body as { last_value_id?: number })?.last_value_id || 0);
        const id = cursor + 1;
        return {
          result: [{ id, value: `value-${id}`, info: '', picture: '' }],
          has_next: true,
        } as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    await expect(client.getAttributeValues({
      description_category_id: 17028706,
      type_id: 95913,
      attribute_id: 10096,
      limit: 1,
    }, { maxPages: 2 })).rejects.toThrow('page limit 2');
  });

  it('rejects pagination that exceeds the configured observed-row cap', async () => {
    class StubClient extends OzonClient {
      override async request<T = unknown>(): Promise<T> {
        return {
          result: [
            { id: 101, value: 'белый', info: '', picture: '' },
            { id: 102, value: 'бежевый', info: '', picture: '' },
            { id: 103, value: 'черный', info: '', picture: '' },
          ],
          has_next: false,
        } as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    await expect(client.getAttributeValues({
      description_category_id: 17028706,
      type_id: 95913,
      attribute_id: 10096,
      limit: 3,
    }, { maxRows: 2 })).rejects.toThrow('row limit 2');
  });

  it('stops before another request when has_next would exceed the exact row cap', async () => {
    let calls = 0;
    class StubClient extends OzonClient {
      override async request<T = unknown>(): Promise<T> {
        calls += 1;
        return (calls === 1
          ? {
            result: [
              { id: 101, value: 'белый', info: '', picture: '' },
              { id: 102, value: 'бежевый', info: '', picture: '' },
            ],
            has_next: true,
          }
          : { result: [], has_next: false }) as T;
      }
    }

    const client = new StubClient({ clientId: 'client', apiKey: 'key' });
    await expect(client.getAttributeValues({
      description_category_id: 17028706,
      type_id: 95913,
      attribute_id: 10096,
      limit: 2,
    }, { maxRows: 2 })).rejects.toThrow('row limit 2');
    expect(calls).toBe(1);
  });
});
