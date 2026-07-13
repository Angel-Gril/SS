import { describe, expect, it } from 'vitest';
import {
  getOzonWarehouseCoordinates,
  normalizeOzonWarehouseAddressEvidence,
  OzonApiError,
  OzonClient,
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
