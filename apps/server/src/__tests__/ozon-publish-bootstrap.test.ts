import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

describe('Ozon publish production bootstrap', () => {
  it('injects the authoritative publisher and submits through the non-retrying client method', () => {
    expect(source).toContain('createPrismaOzonPublishAttemptRepository');
    expect(source).toContain('createOzonListingProductionCompileAdapter');
    expect(source).toContain('publisher: sourceOzonListingPublisher');
    expect(source).toContain('client.importProductsOnce(');
  });

  it('keeps parity shadow compilation cache-only and separate from the production refresher', () => {
    const publishCategoryAuthority = source.slice(
      source.indexOf('const sourceListingPublishCategoryValidator'),
      source.indexOf('async function loadSourceListingAttributeSourceContext'),
    );
    const productionAttributes = source.slice(
      source.indexOf('const sourceListingWorkflowAttributeService'),
      source.indexOf('const sourceListingShadowAttributeService'),
    );
    const shadowAttributes = source.slice(
      source.indexOf('const sourceListingShadowAttributeService'),
      source.indexOf('const sourceOzonPublishAttemptRepository'),
    );
    const productionCompileWiring = source.slice(
      source.indexOf('const sourceOzonListingProductionCompileOptions'),
      source.indexOf('const sourceOzonListingShadowCompile'),
    );
    const shadowCompileWiring = source.slice(
      source.indexOf('const sourceOzonListingShadowCompile'),
      source.indexOf('const sourceOzonPublisherEntrypointParityObserver'),
    );
    const parityWiring = source.slice(
      source.indexOf('const sourceOzonPublisherEntrypointParityObserver'),
      source.indexOf('const sourceOzonPublisherInstanceId'),
    );
    const workbenchPublishWiring = source.slice(
      source.indexOf('await app.register(extensionWorkbenchPublishRoutes'),
      source.indexOf('const byokGeneratedAssetRepository'),
    );

    expect(shadowAttributes).toContain('fetchDefinitions: async () => throwShadowAuthorityUnavailable()');
    expect(shadowAttributes).toContain('fetchPage: async () => throwShadowAuthorityUnavailable()');
    expect(shadowAttributes).not.toContain('loadOwnedSourceListingOzonClient');
    expect(productionAttributes.match(/forceRefresh: freshness === 'OFFICIAL_REFRESH_REQUIRED'/g))
      .toHaveLength(2);
    expect(productionAttributes.match(/cacheOnly: freshness === 'PUBLISH_CACHE_REQUIRED'/g))
      .toHaveLength(2);
    expect(productionAttributes).toContain(
      "freshness === 'PUBLISH_CACHE_REQUIRED'",
    );
    expect(productionAttributes).toContain('sourceListingPublishCategoryValidator');
    expect(publishCategoryAuthority).toContain(
      'requireFreshOzonCategoryCatalogSnapshotForShop',
    );
    expect(publishCategoryAuthority).not.toContain('loadAuthoritativeOzonCategoryCatalog');
    expect(publishCategoryAuthority).not.toContain('getOrRefreshOzonCategoryCatalogSnapshotForShop');
    expect(publishCategoryAuthority).not.toContain('loadOwnedSourceListingOzonClient');
    expect(publishCategoryAuthority).not.toContain('fetchTree');
    expect(productionCompileWiring).toContain(
      'sourceListingWorkflowAttributeService.validateForPublish',
    );
    expect(productionCompileWiring).not.toContain(
      'sourceListingWorkflowAttributeService.validateAuthoritative',
    );
    expect(productionCompileWiring).toContain(
      'createOzonListingProductionCompileCache({',
    );
    expect(productionCompileWiring).toContain(
      'compile: sourceOzonListingProductionCompileUncached',
    );
    expect(shadowCompileWiring).toContain(
      'sourceListingShadowAttributeService.validateAuthoritative',
    );
    expect(shadowCompileWiring).not.toContain('createOzonListingProductionCompileCache');
    expect(shadowCompileWiring).not.toContain('loadOwnedSourceListingOzonClient');
    expect(parityWiring).toContain('compile: sourceOzonListingShadowCompile');
    expect(parityWiring).not.toContain('compile: sourceOzonListingProductionCompile');
    expect(workbenchPublishWiring).toContain(
      'await preflightOzonListingProductionCompile(',
    );
    expect(workbenchPublishWiring).toContain(
      'sourceOzonListingProductionCompile,',
    );
  });

  it('persists sanitized parity observations without wiring publisher side effects into the recorder', () => {
    const recorder = source.slice(
      source.indexOf('const sourceOzonPublisherParityObservationRepository'),
      source.indexOf('const sourceOzonPublisherInstanceId'),
    );

    expect(recorder).toContain('createPrismaOzonPublisherParityObservationRepository');
    expect(recorder).toContain('createOzonPublisherParityObservationService');
    expect(recorder).toContain("getConfig('retention_ozon_publisher_parity_days')");
    expect(recorder).toContain('recordObservation({');
    expect(recorder).not.toContain('createOzonListingPublisher');
    expect(recorder).not.toContain('createPrismaOzonPublishAttemptRepository');
    expect(recorder).not.toContain('loadOwnedSourceListingOzonClient');
    expect(recorder).not.toContain('importProducts');
  });

  it('registers the super-admin parity observation and review API', () => {
    expect(source).toContain('await app.register(adminOzonPublisherParityRoutes, {');
    expect(source).toContain("prefix: '/api/admin/ozon-publisher-parity'");
    expect(source).toContain('service: sourceOzonPublisherParityObservationService');
  });

  it('starts database reconciliation even when Redis-backed workers are disabled', () => {
    const workers = source.slice(source.indexOf('if (RUN_WORKERS) {'));
    const reconciliation = workers.indexOf('startOzonPublishReconciliationWorker({');
    const redisGuard = workers.indexOf("if (process.env.REDIS_DISABLED !== '1'");

    expect(reconciliation).toBeGreaterThan(0);
    expect(redisGuard).toBeGreaterThan(reconciliation);
    expect(workers).toContain('runOzonPublishReconciliationTick({');
    expect(workers).toContain('repository: sourceOzonPublishAttemptRepository');
  });

  it('registers publisher discovery before the parameterized workflow routes', () => {
    const discovery = source.indexOf('await app.register(sourceListingPublisherRoutes');
    const workflows = source.indexOf('await app.register(sourceListingWorkflowRoutes');

    expect(discovery).toBeGreaterThan(0);
    expect(workflows).toBeGreaterThan(discovery);
    const registration = source.slice(discovery, workflows);
    expect(registration).toContain("prefix: '/api/source-listing-workflows'");
    expect(registration).toContain('featureFlags: sourceWorkflowFeatureFlags');
    expect(registration).toContain('workflow: sourceListingWorkflowService');
    expect(registration).toContain('publisher: sourceOzonListingPublisher');
    expect(registration).toContain("platform: 'OZON'");
    expect(registration).toContain("status: 'ACTIVE'");
  });
});
