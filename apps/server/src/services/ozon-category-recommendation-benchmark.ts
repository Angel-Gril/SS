export interface OzonCategoryBenchmarkTarget {
  categoryId: number;
  typeId: number;
}

export interface OzonCategoryBenchmarkSample {
  id: string;
  riskGroup: string;
  expectedTargets: OzonCategoryBenchmarkTarget[];
  acceptableAlternatives: OzonCategoryBenchmarkTarget[];
  unsafeTargets: OzonCategoryBenchmarkTarget[];
  candidates: OzonCategoryBenchmarkTarget[];
}

export interface OzonCategoryBenchmarkMetrics {
  sampleCount: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  meanReciprocalRank: number;
  noCandidateRate: number;
  unsafeAt1: number;
  unsafeAt5: number;
}

export interface OzonCategoryBenchmarkReport extends OzonCategoryBenchmarkMetrics {
  byRiskGroup: Record<string, OzonCategoryBenchmarkMetrics>;
}

export interface OzonCategoryBenchmarkThresholds {
  minRecallAt1: number;
  minRecallAt3: number;
  maxNoCandidateRate: number;
  maxUnsafeAt1: number;
  maxUnsafeAt5: number;
}

export class OzonCategoryRecommendationBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OzonCategoryRecommendationBenchmarkError';
  }
}

function targetKey(target: OzonCategoryBenchmarkTarget): string {
  const categoryId = Number(target?.categoryId);
  const typeId = Number(target?.typeId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0
    || !Number.isSafeInteger(typeId) || typeId <= 0) {
    throw new OzonCategoryRecommendationBenchmarkError('Benchmark target ids must be positive safe integers');
  }
  return `${categoryId}:${typeId}`;
}

function normalizedSample(sample: OzonCategoryBenchmarkSample): OzonCategoryBenchmarkSample {
  const id = String(sample?.id || '').trim();
  const riskGroup = String(sample?.riskGroup || '').trim();
  if (!id || id.length > 200 || !riskGroup || riskGroup.length > 100) {
    throw new OzonCategoryRecommendationBenchmarkError('Benchmark sample id and risk group are required');
  }
  if (!Array.isArray(sample.expectedTargets) || sample.expectedTargets.length === 0) {
    throw new OzonCategoryRecommendationBenchmarkError(`Benchmark sample ${id} has no expected target`);
  }
  for (const rows of [
    sample.expectedTargets,
    sample.acceptableAlternatives,
    sample.unsafeTargets,
    sample.candidates,
  ]) {
    if (!Array.isArray(rows) || rows.length > 100) {
      throw new OzonCategoryRecommendationBenchmarkError(`Benchmark sample ${id} has invalid target rows`);
    }
    rows.forEach(targetKey);
  }
  return { ...sample, id, riskGroup };
}

function metrics(samples: OzonCategoryBenchmarkSample[]): OzonCategoryBenchmarkMetrics {
  const sampleCount = samples.length;
  if (sampleCount === 0) {
    return {
      sampleCount: 0,
      recallAt1: 0,
      recallAt3: 0,
      recallAt5: 0,
      meanReciprocalRank: 0,
      noCandidateRate: 0,
      unsafeAt1: 0,
      unsafeAt5: 0,
    };
  }

  let recallAt1 = 0;
  let recallAt3 = 0;
  let recallAt5 = 0;
  let reciprocalRank = 0;
  let noCandidate = 0;
  let unsafeAt1 = 0;
  let unsafeAt5 = 0;
  for (const sample of samples) {
    const accepted = new Set([
      ...sample.expectedTargets.map(targetKey),
      ...sample.acceptableAlternatives.map(targetKey),
    ]);
    const unsafe = new Set(sample.unsafeTargets.map(targetKey));
    const ranked = sample.candidates.map(targetKey);
    const firstAccepted = ranked.findIndex((key) => accepted.has(key));
    if (firstAccepted === 0) recallAt1 += 1;
    if (firstAccepted >= 0 && firstAccepted < 3) recallAt3 += 1;
    if (firstAccepted >= 0 && firstAccepted < 5) recallAt5 += 1;
    if (firstAccepted >= 0) reciprocalRank += 1 / (firstAccepted + 1);
    if (ranked.length === 0) noCandidate += 1;
    if (ranked.slice(0, 1).some((key) => unsafe.has(key))) unsafeAt1 += 1;
    if (ranked.slice(0, 5).some((key) => unsafe.has(key))) unsafeAt5 += 1;
  }

  return {
    sampleCount,
    recallAt1: recallAt1 / sampleCount,
    recallAt3: recallAt3 / sampleCount,
    recallAt5: recallAt5 / sampleCount,
    meanReciprocalRank: reciprocalRank / sampleCount,
    noCandidateRate: noCandidate / sampleCount,
    unsafeAt1: unsafeAt1 / sampleCount,
    unsafeAt5: unsafeAt5 / sampleCount,
  };
}

export function evaluateOzonCategoryRecommendationBenchmark(
  input: OzonCategoryBenchmarkSample[],
): OzonCategoryBenchmarkReport {
  if (!Array.isArray(input) || input.length === 0 || input.length > 10_000) {
    throw new OzonCategoryRecommendationBenchmarkError('Benchmark requires a bounded non-empty sample set');
  }
  const samples = input.map(normalizedSample);
  const ids = new Set<string>();
  for (const sample of samples) {
    if (ids.has(sample.id)) {
      throw new OzonCategoryRecommendationBenchmarkError(`Duplicate benchmark sample id: ${sample.id}`);
    }
    ids.add(sample.id);
  }
  const groups = new Map<string, OzonCategoryBenchmarkSample[]>();
  for (const sample of samples) {
    const rows = groups.get(sample.riskGroup) || [];
    rows.push(sample);
    groups.set(sample.riskGroup, rows);
  }
  return {
    ...metrics(samples),
    byRiskGroup: Object.fromEntries(
      Array.from(groups.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([riskGroup, rows]) => [riskGroup, metrics(rows)]),
    ),
  };
}

function threshold(value: unknown, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new OzonCategoryRecommendationBenchmarkError(`${name} must be between 0 and 1`);
  }
  return number;
}

export function assertOzonCategoryRecommendationThresholds(
  report: OzonCategoryBenchmarkReport,
  thresholds: OzonCategoryBenchmarkThresholds,
): void {
  if (!report || !Number.isSafeInteger(report.sampleCount) || report.sampleCount <= 0) {
    throw new OzonCategoryRecommendationBenchmarkError('Benchmark report is empty');
  }
  const expected = {
    minRecallAt1: threshold(thresholds.minRecallAt1, 'minRecallAt1'),
    minRecallAt3: threshold(thresholds.minRecallAt3, 'minRecallAt3'),
    maxNoCandidateRate: threshold(thresholds.maxNoCandidateRate, 'maxNoCandidateRate'),
    maxUnsafeAt1: threshold(thresholds.maxUnsafeAt1, 'maxUnsafeAt1'),
    maxUnsafeAt5: threshold(thresholds.maxUnsafeAt5, 'maxUnsafeAt5'),
  };
  const failures: string[] = [];
  if (report.recallAt1 < expected.minRecallAt1) failures.push('recallAt1');
  if (report.recallAt3 < expected.minRecallAt3) failures.push('recallAt3');
  if (report.noCandidateRate > expected.maxNoCandidateRate) failures.push('noCandidateRate');
  if (report.unsafeAt1 > expected.maxUnsafeAt1) failures.push('unsafeAt1');
  if (report.unsafeAt5 > expected.maxUnsafeAt5) failures.push('unsafeAt5');
  if (failures.length > 0) {
    throw new OzonCategoryRecommendationBenchmarkError(
      `Ozon category recommendation benchmark failed: ${failures.join(', ')}`,
    );
  }
}
