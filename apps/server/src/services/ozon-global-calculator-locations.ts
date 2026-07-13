import { createHash } from 'node:crypto';
import { z } from 'zod';

const ORIGIN = 'https://globalcalculator.ozon.ru';
const LOCATION_BASE_PATH = '/p-api/tpl-api-global-calc-gw/v1/location';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const name = z.string().trim().min(1).max(300);
const uid = z.string().uuid();
const areaId = z.string().regex(/^\d{1,20}$/);

const originLocationSchema = z.object({
  uid,
  name,
  type: z.enum(['country', 'city']),
  areaId,
  regionName: name.nullable(),
}).strict();

const destinationSchema = z.object({
  locationUid: uid,
  locationName: name,
  countryName: name,
  countryUid: uid,
}).strict();

const countriesResponseSchema = z.object({
  countries: z.array(originLocationSchema).max(100),
}).strict();

const citiesResponseSchema = z.object({
  cities: z.array(originLocationSchema).max(5_000),
}).strict();

const destinationsResponseSchema = z.object({
  destinations: z.array(destinationSchema).max(100),
}).strict();

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class OzonLocationDirectoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 502,
  ) {
    super(message);
    this.name = 'OzonLocationDirectoryError';
  }
}

function catalogVersion(records: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

function sortByUid<T extends { uid?: string; locationUid?: string }>(records: T[]): T[] {
  return [...records].sort((left, right) => {
    const leftKey = left.uid || left.locationUid || '';
    const rightKey = right.uid || right.locationUid || '';
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function parseDirectoryResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OzonLocationDirectoryError(
      'location_directory_schema_changed',
      'Ozon location directory response schema changed',
    );
  }
  return parsed.data;
}

function assertReviewedResponseUrl(response: Response, expected: URL): void {
  if (!response.url) return;
  const actual = new URL(response.url);
  if (actual.origin !== ORIGIN || actual.pathname !== expected.pathname || actual.search) {
    throw new OzonLocationDirectoryError(
      'location_directory_redirect_rejected',
      'Ozon location directory redirected outside the reviewed endpoint',
    );
  }
}

async function readJson(response: Response, expected: URL): Promise<unknown> {
  assertReviewedResponseUrl(response, expected);
  if (!response.ok) {
    throw new OzonLocationDirectoryError(
      'location_directory_upstream_error',
      `Ozon location directory returned HTTP ${response.status}`,
    );
  }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new OzonLocationDirectoryError(
      'location_directory_invalid_content_type',
      'Ozon location directory did not return JSON',
    );
  }
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new OzonLocationDirectoryError(
      'location_directory_response_too_large',
      'Ozon location directory response exceeded the size limit',
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new OzonLocationDirectoryError(
      'location_directory_response_too_large',
      'Ozon location directory response exceeded the size limit',
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OzonLocationDirectoryError(
      'location_directory_invalid_json',
      'Ozon location directory returned malformed JSON',
    );
  }
}

export function createOzonGlobalCalculatorLocationClient(options: {
  enabled?: boolean;
  fetchImpl?: FetchLike;
  now?: () => Date;
} = {}) {
  const enabled = options.enabled ?? process.env.OZON_GLOBAL_CALCULATOR_LOCATIONS_ENABLED === 'true';
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || (() => new Date());

  async function get(path: string): Promise<unknown> {
    if (!enabled) {
      throw new OzonLocationDirectoryError(
        'location_directory_disabled',
        'Ozon location directory integration is disabled',
        503,
      );
    }
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !url.pathname.startsWith(`${LOCATION_BASE_PATH}/`)) {
      throw new OzonLocationDirectoryError(
        'location_directory_path_rejected',
        'Ozon location directory path is not allowed',
        400,
      );
    }
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return readJson(response, url);
  }

  return {
    async listCountries() {
      const parsed = parseDirectoryResponse(
        countriesResponseSchema,
        await get(`${LOCATION_BASE_PATH}/countries`),
      );
      const records = sortByUid(parsed.countries);
      return {
        kind: 'countries' as const,
        fetchedAt: now().toISOString(),
        catalogVersion: catalogVersion(records),
        records,
      };
    },

    async listCities(countryUid: string) {
      const parsedCountryUid = uid.parse(countryUid);
      const parsed = parseDirectoryResponse(citiesResponseSchema, await get(
        `${LOCATION_BASE_PATH}/countries/${encodeURIComponent(parsedCountryUid)}/cities`,
      ));
      const records = sortByUid(parsed.cities);
      return {
        kind: 'cities' as const,
        countryUid: parsedCountryUid,
        fetchedAt: now().toISOString(),
        catalogVersion: catalogVersion(records),
        records,
      };
    },

    async listDestinations() {
      const parsed = parseDirectoryResponse(destinationsResponseSchema, await get(
        `${LOCATION_BASE_PATH}/destinations`,
      ));
      const records = sortByUid(parsed.destinations);
      return {
        kind: 'destinations' as const,
        fetchedAt: now().toISOString(),
        catalogVersion: catalogVersion(records),
        records,
      };
    },
  };
}
