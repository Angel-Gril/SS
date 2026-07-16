import { describe, expect, it, vi } from 'vitest';

import { createOzonPublisherEntrypointParityObserver } from '../services/ozon-publisher-entrypoint-parity-shadow.js';

const pointer = {
  supplyGoodsId: 'goods-1',
  draftId: 'draft-1',
  draftVersion: 3,
  revision: 7,
};

const draft = {
  id: 'draft-1',
  ownerUserId: 'owner-1',
  shopId: 'shop-1',
  supplyGoodsId: 'goods-1',
  draftVersion: 3,
  revision: 7,
  selectedSkuKeys: ['sku-1'],
};

function observation(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    rolloutRevision: 'rollout-1',
    entrypoint: 'COLLECT_PUBLISH_OZON' as const,
    legacy: {
      endpoint: '/v3/product/import' as const,
      payload: { items: [{ offer_id: 'offer-1', vat: '0' }] },
    },
    drafts: [pointer],
    ...overrides,
  };
}

function compiled() {
  return {
    publisherContractVersion: 'ozon-listing-production-compile-adapter/v1',
    endpoint: '/v3/product/import' as const,
    requestPayload: { items: [{ offer_id: 'offer-1', vat: '0' }] },
    requestPayloadHash: 'a'.repeat(64),
    offerTrace: [{ ordinal: 0, skuKey: 'sku-1', offerId: 'offer-1' }],
  };
}

describe('Ozon publisher entry-point parity shadow observer', () => {
  it('compiles the exact pointed draft, records a bounded report, and has no submit dependency', async () => {
    const loadDraft = vi.fn(async () => draft as any);
    const compile = vi.fn(async () => compiled() as any);
    const record = vi.fn(async () => undefined);
    const observer = createOzonPublisherEntrypointParityObserver({ loadDraft, compile, record });

    const result = await observer.observe(observation());

    expect(result).toMatchObject({ status: 'MATCH', switchEligible: true });
    expect(loadDraft).toHaveBeenCalledWith({ draftId: 'draft-1', ownerUserId: 'owner-1' });
    expect(compile).toHaveBeenCalledWith({ ownerUserId: 'owner-1', draft });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      scopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      rolloutRevision: 'rollout-1',
      report: result,
    }));
    expect(Object.keys((observer as any))).toEqual(['observe']);
  });

  it.each(['LISTING_BATCH', 'LISTING_IMPORT_BY_SKU'] as const)(
    'records parity for the %s physical writer',
    async (entrypoint) => {
      const record = vi.fn(async () => undefined);
      const observer = createOzonPublisherEntrypointParityObserver({
        loadDraft: vi.fn(async () => draft as any),
        compile: vi.fn(async () => compiled() as any),
        record,
      });

      const result = await observer.observe(observation({ entrypoint }));

      expect(result.entrypoint).toBe(entrypoint);
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        entrypoint,
        report: expect.objectContaining({ entrypoint }),
      }));
    },
  );

  it('turns a typed strict production compiler rejection into a non-blocking V2 blocker', async () => {
    const record = vi.fn(async () => undefined);
    const observer = createOzonPublisherEntrypointParityObserver({
      loadDraft: vi.fn(async () => draft as any),
      compile: vi.fn(async () => {
        throw Object.assign(new Error('private media URL and credential detail'), {
          code: 'OZON_LISTING_PRODUCTION_MEDIA_INVALID',
        });
      }),
      record,
    });

    const result = await observer.observe(observation());

    expect(result).toMatchObject({
      status: 'V2_BLOCKED',
      classification: 'INTENTIONAL_STRICTER',
      switchEligible: false,
      v2: { kind: 'BLOCKED', blockerCode: 'OZON_LISTING_PRODUCTION_MEDIA_INVALID' },
    });
    expect(JSON.stringify(result)).not.toContain('private media');
    expect(record).toHaveBeenCalledOnce();
  });

  it('aligns random legacy offers to canonical SKU aliases and preserves field-level evidence', async () => {
    const tracedDraft = { ...draft, selectedSkuKeys: ['canonical-red'] } as any;
    const observer = createOzonPublisherEntrypointParityObserver({
      loadDraft: vi.fn(async () => tracedDraft),
      loadSkuAliases: vi.fn(async () => [{
        skuKey: 'canonical-red',
        aliases: ['canonical-red', 'source-red-1688'],
      }]),
      compile: vi.fn(async () => ({
        ...compiled(),
        requestPayload: {
          items: [{ offer_id: 'v2-deterministic-offer', vat: '0' }],
        },
        offerTrace: [{
          ordinal: 0,
          skuKey: 'canonical-red',
          offerId: 'v2-deterministic-offer',
        }],
      }) as any),
    });
    const result = await observer.observe(observation({
      legacy: {
        endpoint: '/v3/product/import',
        payload: {
          items: [{ offer_id: 'legacy-random-offer', vat: '0', weight: 500 }],
        },
        itemTrace: [{
          ordinal: 0,
          supplyGoodsId: 'goods-1',
          sourceSkuAlias: 'source-red-1688',
        }],
      },
    }));

    expect(result.status).toBe('DIFFERENT');
    expect(result.differences.rows.map((row) => row.path)).toEqual([
      '/items/0/offer_id',
      '/items/0/weight',
    ]);
    expect(result.differences.rows.find((row) => row.path.endsWith('/weight')))
      .toMatchObject({ classification: 'INTENTIONAL_STRICTER' });
    expect(result.differences.rows).not.toContainEqual(expect.objectContaining({ path: '/items/0' }));
    expect(JSON.stringify(result)).not.toContain('source-red-1688');
  });

  it('reports stale pointers and unknown failures as unavailable without compiling partial payloads', async () => {
    const compile = vi.fn(async () => compiled() as any);
    const observer = createOzonPublisherEntrypointParityObserver({
      loadDraft: vi.fn(async () => ({ ...draft, revision: 8 }) as any),
      compile,
    });

    const stale = await observer.observe(observation());

    expect(stale).toMatchObject({
      status: 'NOT_COMPARABLE',
      v2: { kind: 'UNAVAILABLE', reasonCode: 'WORKFLOW_UNAVAILABLE' },
    });
    expect(compile).not.toHaveBeenCalled();

    const failing = createOzonPublisherEntrypointParityObserver({
      loadDraft: vi.fn(async () => {
        throw new Error('postgres private hostname and token');
      }),
      compile,
    });
    const unavailable = await failing.observe(observation());
    expect(unavailable).toMatchObject({
      status: 'NOT_COMPARABLE',
      v2: { kind: 'UNAVAILABLE', reasonCode: 'WORKFLOW_UNAVAILABLE' },
    });
    expect(JSON.stringify(unavailable)).not.toContain('postgres private');
  });

  it('does not let diagnostic recorder failures escape into the legacy publish path', async () => {
    const warn = vi.fn();
    const observer = createOzonPublisherEntrypointParityObserver({
      loadDraft: vi.fn(async () => draft as any),
      compile: vi.fn(async () => compiled() as any),
      record: vi.fn(async () => { throw new Error('log sink unavailable'); }),
      warn,
    });

    await expect(observer.observe(observation())).resolves.toMatchObject({ status: 'MATCH' });
    expect(warn).toHaveBeenCalledWith('Ozon publisher parity diagnostic recording failed');
  });

  it('bounds draft fan-out before loading any workflow', async () => {
    const loadDraft = vi.fn(async () => draft as any);
    const observer = createOzonPublisherEntrypointParityObserver({
      loadDraft,
      compile: vi.fn(async () => compiled() as any),
    });
    const drafts = Array.from({ length: 101 }, (_, index) => ({
      ...pointer,
      supplyGoodsId: `goods-${index}`,
      draftId: `draft-${index}`,
    }));

    const result = await observer.observe(observation({ drafts }));

    expect(result).toMatchObject({
      status: 'NOT_COMPARABLE',
      v2: { kind: 'UNAVAILABLE', reasonCode: 'WORKFLOW_UNAVAILABLE' },
    });
    expect(loadDraft).not.toHaveBeenCalled();
  });
});
