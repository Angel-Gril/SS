import { describe, expect, it } from 'vitest';
import {
  buildLogisticsRuleEffectiveEtag,
  ifNoneMatchIncludes,
} from '../services/logistics-rule-distribution.js';

const base = {
  deploymentId: 'local-development',
  assignmentId: 'assignment-1',
  scopeKey: 'tenant-1/shop-1/warehouse-1',
  releaseSequence: 3,
  effectiveChecksum: 'a'.repeat(64),
  minExtensionVersion: '0.2.0',
};

describe('logistics rule effective ETag', () => {
  it('is stable for one immutable effective release', () => {
    const first = buildLogisticsRuleEffectiveEtag(base);
    const second = buildLogisticsRuleEffectiveEtag({ ...base });

    expect(first).toBe(second);
    expect(first).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it.each([
    ['deploymentId', 'domestic-production'],
    ['assignmentId', 'assignment-2'],
    ['scopeKey', 'tenant-1/shop-1/warehouse-2'],
    ['releaseSequence', 4],
    ['effectiveChecksum', 'b'.repeat(64)],
    ['minExtensionVersion', '0.3.0'],
  ] as const)('changes when %s changes', (field, value) => {
    expect(buildLogisticsRuleEffectiveEtag({ ...base, [field]: value }))
      .not.toBe(buildLogisticsRuleEffectiveEtag(base));
  });

  it('matches exact, weak, wildcard, and comma-separated If-None-Match values', () => {
    const etag = buildLogisticsRuleEffectiveEtag(base);

    expect(ifNoneMatchIncludes(etag, etag)).toBe(true);
    expect(ifNoneMatchIncludes(`W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchIncludes(`"other", W/${etag}`, etag)).toBe(true);
    expect(ifNoneMatchIncludes('*', etag)).toBe(true);
    expect(ifNoneMatchIncludes('"other"', etag)).toBe(false);
    expect(ifNoneMatchIncludes(undefined, etag)).toBe(false);
  });

  it('rejects malformed effective identity before hashing', () => {
    expect(() => buildLogisticsRuleEffectiveEtag({
      ...base,
      effectiveChecksum: 'not-a-checksum',
    })).toThrow();
    expect(() => buildLogisticsRuleEffectiveEtag({
      ...base,
      releaseSequence: 0,
    })).toThrow();
  });
});
