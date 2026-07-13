import { describe, expect, it, vi } from 'vitest';

const CHINA_UID = '13a6e0b2-f138-597d-a3ff-071876394e41';

describe('Ozon Global Calculator location directory adapter', () => {
  it('uses only the reviewed public endpoints and returns sanitized versioned records', async () => {
    const { createOzonGlobalCalculatorLocationClient } = await import(
      '../services/ozon-global-calculator-locations.js'
    );
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/location/countries')) {
        return new Response(JSON.stringify({
          countries: [{
            uid: CHINA_UID,
            name: 'China',
            type: 'country',
            areaId: '35289',
            regionName: null,
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith(`/v1/location/countries/${CHINA_UID}/cities`)) {
        return new Response(JSON.stringify({
          cities: [{
            uid: 'd50b9ce0-cc88-55d7-b187-6125e0f75e20',
            name: 'Shenzhen',
            type: 'city',
            areaId: '326302',
            regionName: 'Guangdong Sheng',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/v1/location/destinations')) {
        return new Response(JSON.stringify({
          destinations: [{
            locationUid: '0c5b2444-70a0-4932-980c-b4dc0d3f02b5',
            locationName: 'Moscow',
            countryName: 'Russia',
            countryUid: '42fb1c32-0cfe-5c96-9fb5-7f8e8449f28c',
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const now = new Date('2026-07-12T12:30:00.000Z');
    const client = createOzonGlobalCalculatorLocationClient({
      enabled: true,
      fetchImpl,
      now: () => now,
    });

    const countries = await client.listCountries();
    const cities = await client.listCities(CHINA_UID);
    const destinations = await client.listDestinations();

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://globalcalculator.ozon.ru/p-api/tpl-api-global-calc-gw/v1/location/countries',
      `https://globalcalculator.ozon.ru/p-api/tpl-api-global-calc-gw/v1/location/countries/${CHINA_UID}/cities`,
      'https://globalcalculator.ozon.ru/p-api/tpl-api-global-calc-gw/v1/location/destinations',
    ]);
    expect(countries).toMatchObject({
      kind: 'countries',
      fetchedAt: now.toISOString(),
      records: [{ uid: CHINA_UID, name: 'China', type: 'country', areaId: '35289', regionName: null }],
    });
    expect(cities).toMatchObject({
      kind: 'cities',
      countryUid: CHINA_UID,
      records: [{ name: 'Shenzhen', type: 'city', regionName: 'Guangdong Sheng' }],
    });
    expect(destinations).toMatchObject({
      kind: 'destinations',
      records: [{ locationName: 'Moscow', countryName: 'Russia' }],
    });
    for (const result of [countries, cities, destinations]) {
      expect(result.catalogVersion).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(result)).not.toMatch(/cookie|authorization|token/i);
    }
  });

  it('quarantines an unknown response shape without exposing raw values', async () => {
    const { createOzonGlobalCalculatorLocationClient } = await import(
      '../services/ozon-global-calculator-locations.js'
    );
    const client = createOzonGlobalCalculatorLocationClient({
      enabled: true,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        countries: [{
          uid: CHINA_UID,
          name: 'China',
          type: 'country',
          areaId: '35289',
          regionName: null,
          unexpected: 'secret-token-value',
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })),
    });

    let caught: unknown;
    try {
      await client.listCountries();
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'location_directory_schema_changed',
      statusCode: 502,
    });
    expect(String((caught as Error)?.message)).not.toContain('secret-token-value');
  });
});
