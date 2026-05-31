import { getConfig } from '../config/system-config-schema.js';

interface RandomizeConfig {
  enabled: boolean;
  randomOfferId: boolean;
  dimensionJitterMm: number;
  dimensionMinMm: number;
  weightBuckets: Array<[number, number]>;
}

let cache: { value: RandomizeConfig; loadedAt: number } | null = null;
const CACHE_TTL = 30_000;

function parseBuckets(raw: string): Array<[number, number]> {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg): [number, number] | null => {
      const [lo, hi] = seg.split('-').map((n) => Number(n.trim()));
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo == null || hi == null) return null;
      if (hi <= lo) return null;
      return [lo, hi];
    })
    .filter((x): x is [number, number] => x !== null)
    .sort((a, b) => a[0] - b[0]);
}

export async function getRandomizeConfig(): Promise<RandomizeConfig> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL) return cache.value;

  const [enabled, randomOfferId, dimensionJitterMm, dimensionMinMm, weightBuckets] = await Promise.all([
    getConfig('randomize_enabled'),
    getConfig('randomize_offer_id'),
    getConfig('randomize_dimension_jitter_mm'),
    getConfig('randomize_dimension_min_mm'),
    getConfig('randomize_weight_buckets'),
  ]);

  const value: RandomizeConfig = {
    enabled,
    randomOfferId,
    dimensionJitterMm,
    dimensionMinMm,
    weightBuckets: parseBuckets(weightBuckets),
  };
  cache = { value, loadedAt: Date.now() };
  return value;
}

export function invalidateRandomizeCache() {
  cache = null;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randomOfferIdFrom(sourceSku: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${sourceSku}-${suffix}`;
}

export function jitterDimensionMm(value: number | null | undefined, jitter: number, minMm: number): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return value ?? null;
  if (jitter <= 0) return value;
  const delta = randInt(-jitter, jitter);
  return Math.max(minMm, Math.round(value + delta));
}

export function bucketWeightG(value: number | null | undefined, buckets: Array<[number, number]>): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return value ?? null;
  if (!buckets.length) return value;
  const hit = buckets.find(([lo, hi]) => value >= lo && value <= hi);
  if (!hit) return value;
  return randInt(hit[0], hit[1]);
}

export interface ApplyRandomizeOptions {
  randomOfferId?: boolean;
  sourceSku?: string;
}

export async function applyRandomization(
  input: { offerId?: string | null; weightG?: number | null; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null },
  options: ApplyRandomizeOptions = {}
): Promise<typeof input> {
  const cfg = await getRandomizeConfig();
  if (!cfg.enabled) return input;

  const out = { ...input };
  if (options.randomOfferId !== false && cfg.randomOfferId && options.sourceSku) {
    out.offerId = randomOfferIdFrom(options.sourceSku);
  }
  out.weightG = bucketWeightG(input.weightG, cfg.weightBuckets);
  out.lengthMm = jitterDimensionMm(input.lengthMm, cfg.dimensionJitterMm, cfg.dimensionMinMm);
  out.widthMm = jitterDimensionMm(input.widthMm, cfg.dimensionJitterMm, cfg.dimensionMinMm);
  out.heightMm = jitterDimensionMm(input.heightMm, cfg.dimensionJitterMm, cfg.dimensionMinMm);
  return out;
}
