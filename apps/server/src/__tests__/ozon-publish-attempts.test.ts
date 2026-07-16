import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  OzonPublishAttemptError,
  boundedOzonPublishText,
  canonicalOzonPublishJson,
  cloneOzonPublishArray,
  cloneOzonPublishJson,
  cloneOzonPublishObject,
  extractOzonPublishTaskId,
  hashOzonPublishJson,
  normalizeOzonPublishBatchLimit,
  normalizeOzonPublishError,
  normalizeOzonPublishHash,
  normalizeOzonPublishLeaseMs,
  normalizeOzonPublishOfferTrace,
  normalizeOzonPublishTaskId,
  type OzonPublishJson,
} from '../services/ozon-publish-attempts.js';

function expectInvalid(action: () => unknown, message?: string): void {
  try {
    action();
    throw new Error('Expected INVALID_INPUT');
  } catch (error) {
    expect(error).toBeInstanceOf(OzonPublishAttemptError);
    expect(error).toMatchObject({ code: 'INVALID_INPUT' });
    if (message) expect((error as Error).message).toContain(message);
  }
}

describe('Ozon publish attempt domain contract', () => {
  it('canonicalizes recursively with locale-independent key ordering and stable hashes', () => {
    const left = { z: 3, a: { y: 2, x: 1 }, A: true, items: [{ b: 2, a: 1 }] } as OzonPublishJson;
    const right = { items: [{ a: 1, b: 2 }], A: true, a: { x: 1, y: 2 }, z: 3 } as OzonPublishJson;

    expect(canonicalOzonPublishJson(left)).toBe(
      '{"A":true,"a":{"x":1,"y":2},"items":[{"a":1,"b":2}],"z":3}',
    );
    expect(hashOzonPublishJson(left)).toBe(hashOzonPublishJson(right));
    expect(hashOzonPublishJson(left)).toBe(
      createHash('sha256').update(canonicalOzonPublishJson(left)).digest('hex'),
    );
  });

  it('clones bounded JSON without retaining caller references or active __proto__ semantics', () => {
    const source = JSON.parse('{"nested":{"value":1},"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const cloned = cloneOzonPublishObject(source, 'payload', 1024);
    (source.nested as { value: number }).value = 2;

    expect(cloned.nested).toEqual({ value: 1 });
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(Object.prototype.hasOwnProperty.call(cloned, '__proto__')).toBe(true);
    expect(cloneOzonPublishArray([1, { ok: true }], 'items', 1024)).toEqual([1, { ok: true }]);
    expectInvalid(() => cloneOzonPublishJson(undefined, 'payload', 1024), 'exceeds');
  });

  it('rejects non-serializable, incorrectly shaped, and oversized JSON', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expectInvalid(() => cloneOzonPublishJson(circular, 'payload', 1024), 'JSON serializable');
    expectInvalid(() => cloneOzonPublishJson({ value: 1n }, 'payload', 1024), 'JSON serializable');
    expectInvalid(() => cloneOzonPublishObject([], 'payload', 1024), 'must be an object');
    expectInvalid(() => cloneOzonPublishArray({}, 'payload', 1024), 'must be an array');
    expectInvalid(() => cloneOzonPublishJson('界'.repeat(10), 'payload', 20), 'UTF-8 bytes');
  });

  it('normalizes bounded text and exact SHA-256 values', () => {
    expect(boundedOzonPublishText('  ＡＢＣ  ', 'name', 10)).toBe('ABC');
    expect(normalizeOzonPublishHash('A'.repeat(64), 'hash')).toBe('a'.repeat(64));
    expectInvalid(() => boundedOzonPublishText(' ', 'name', 10), '1 to 10');
    expectInvalid(() => normalizeOzonPublishHash('g'.repeat(64), 'hash'), 'SHA-256');
  });

  it('preserves Ozon task IDs as decimal strings without numeric precision loss', () => {
    expect(normalizeOzonPublishTaskId(9_007_199_254_740_993n)).toBe('9007199254740993');
    expect(normalizeOzonPublishTaskId(' 000123 ')).toBe('123');
    expectInvalid(() => normalizeOzonPublishTaskId(0), 'task ID');
    expectInvalid(() => normalizeOzonPublishTaskId(-1), 'task ID');
    expectInvalid(() => normalizeOzonPublishTaskId('1e5'), 'task ID');
    expectInvalid(() => normalizeOzonPublishTaskId('1'.repeat(41)), 'task ID');
    expect(extractOzonPublishTaskId({ result: { task_id: '000123' } })).toBe('123');
    expect(extractOzonPublishTaskId({ result: { task_id: 123 } })).toBe('123');
    expect(extractOzonPublishTaskId({ result: { task_id: Number.MAX_SAFE_INTEGER + 1 } })).toBeNull();
    expect(extractOzonPublishTaskId({ task_id: 123 })).toBeNull();
  });

  it('requires a contiguous deterministic trace and unique normalized offer IDs', () => {
    expect(normalizeOzonPublishOfferTrace([
      { ordinal: 0, offerId: ' offer-a ', skuKey: ' ＳＫＵ-A ' },
      { ordinal: 1, offerId: 'offer-b', skuKey: 'sku-b' },
    ])).toEqual([
      { ordinal: 0, offerId: 'offer-a', skuKey: 'SKU-A' },
      { ordinal: 1, offerId: 'offer-b', skuKey: 'sku-b' },
    ]);
    expectInvalid(() => normalizeOzonPublishOfferTrace([]), '1 to 500');
    expectInvalid(() => normalizeOzonPublishOfferTrace([
      { ordinal: 1, offerId: 'offer-a', skuKey: 'sku-a' },
    ]), 'contiguous');
    expectInvalid(() => normalizeOzonPublishOfferTrace([
      { ordinal: 0, offerId: 'offer-a', skuKey: 'sku-a' },
      { ordinal: 1, offerId: 'ｏｆｆｅｒ－ａ', skuKey: 'sku-b' },
    ]), 'duplicate offer ID');
  });

  it('bounds leases, claim batches, and persisted provider errors', () => {
    expect(normalizeOzonPublishLeaseMs(1_000)).toBe(1_000);
    expect(normalizeOzonPublishLeaseMs(900_000)).toBe(900_000);
    expect(normalizeOzonPublishBatchLimit(100)).toBe(100);
    expect(normalizeOzonPublishError({ errorCode: 429, errorMessage: '  retry later  ' }))
      .toEqual({ errorCode: '429', errorMessage: 'retry later' });
    expect(normalizeOzonPublishError({})).toEqual({ errorCode: null, errorMessage: null });
    expectInvalid(() => normalizeOzonPublishLeaseMs(999), 'lease duration');
    expectInvalid(() => normalizeOzonPublishLeaseMs(900_001), 'lease duration');
    expectInvalid(() => normalizeOzonPublishBatchLimit(0), 'claim limit');
    expectInvalid(() => normalizeOzonPublishBatchLimit(101), 'claim limit');
  });
});
