import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertOzonCategoryRecommendationThresholds,
  evaluateOzonCategoryRecommendationBenchmark,
  OzonCategoryRecommendationBenchmarkError,
} from '../services/ozon-category-recommendation-benchmark.js';

const target = (categoryId: number, typeId: number) => ({ categoryId, typeId });

describe('Ozon category recommendation benchmark', () => {
  it('keeps the provisional pilot fixture explicitly pending instead of fabricating approval', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../../../../docs/contracts/ozon-category-recommendation-pilot-benchmark.json', import.meta.url),
      'utf8',
    ));

    expect(fixture).toMatchObject({
      schemaVersion: 'ozon-category-recommendation-benchmark/v1',
      status: 'pending_review',
      catalogRevision: null,
      pilotShopIds: [],
      pilotCategories: [],
      thresholds: null,
      approvedBy: null,
      approvedAt: null,
      samples: [],
    });
    expect(() => evaluateOzonCategoryRecommendationBenchmark(fixture.samples))
      .toThrow(OzonCategoryRecommendationBenchmarkError);
  });

  it('reports recall, reciprocal rank, no-candidate and unsafe rates separately', () => {
    const report = evaluateOzonCategoryRecommendationBenchmark([
      {
        id: 'apparel-1',
        riskGroup: 'apparel',
        expectedTargets: [target(10, 1)],
        acceptableAlternatives: [],
        unsafeTargets: [target(99, 9)],
        candidates: [target(99, 9), target(10, 1)],
      },
      {
        id: 'apparel-2',
        riskGroup: 'apparel',
        expectedTargets: [target(20, 2)],
        acceptableAlternatives: [target(20, 3)],
        unsafeTargets: [],
        candidates: [target(20, 3), target(20, 2)],
      },
      {
        id: 'unknown-1',
        riskGroup: 'unknown',
        expectedTargets: [target(30, 3)],
        acceptableAlternatives: [],
        unsafeTargets: [target(98, 8)],
        candidates: [],
      },
    ]);

    expect(report.sampleCount).toBe(3);
    expect(report.recallAt1).toBeCloseTo(1 / 3);
    expect(report.recallAt3).toBeCloseTo(2 / 3);
    expect(report.recallAt5).toBeCloseTo(2 / 3);
    expect(report.meanReciprocalRank).toBeCloseTo(0.5);
    expect(report.noCandidateRate).toBeCloseTo(1 / 3);
    expect(report.unsafeAt1).toBeCloseTo(1 / 3);
    expect(report.unsafeAt5).toBeCloseTo(1 / 3);
    expect(report.byRiskGroup.apparel).toMatchObject({ sampleCount: 2, recallAt1: 0.5, recallAt3: 1 });
    expect(report.byRiskGroup.unknown).toMatchObject({ sampleCount: 1, noCandidateRate: 1 });
  });

  it('enforces approved quality thresholds without combining unsafe and recall metrics', () => {
    const report = evaluateOzonCategoryRecommendationBenchmark([{
      id: 'safe-1',
      riskGroup: 'apparel',
      expectedTargets: [target(10, 1)],
      acceptableAlternatives: [],
      unsafeTargets: [target(99, 9)],
      candidates: [target(10, 1)],
    }]);

    expect(() => assertOzonCategoryRecommendationThresholds(report, {
      minRecallAt1: 1,
      minRecallAt3: 1,
      maxNoCandidateRate: 0,
      maxUnsafeAt1: 0,
      maxUnsafeAt5: 0,
    })).not.toThrow();
    expect(() => assertOzonCategoryRecommendationThresholds(report, {
      minRecallAt1: 1.01,
      minRecallAt3: 1,
      maxNoCandidateRate: 0,
      maxUnsafeAt1: 0,
      maxUnsafeAt5: 0,
    })).toThrow(OzonCategoryRecommendationBenchmarkError);
  });

  it('rejects malformed or duplicate benchmark samples instead of skewing metrics', () => {
    expect(() => evaluateOzonCategoryRecommendationBenchmark([
      {
        id: 'duplicate',
        riskGroup: 'apparel',
        expectedTargets: [target(10, 1)],
        acceptableAlternatives: [],
        unsafeTargets: [],
        candidates: [target(10, 1)],
      },
      {
        id: 'duplicate',
        riskGroup: 'apparel',
        expectedTargets: [target(10, 1)],
        acceptableAlternatives: [],
        unsafeTargets: [],
        candidates: [target(10, 1)],
      },
    ])).toThrow(OzonCategoryRecommendationBenchmarkError);
  });
});
