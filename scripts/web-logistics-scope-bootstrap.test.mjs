import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildBindingProbeDecisionPath,
  buildBindingProbePath,
  buildBindingProbeStatusPath,
  buildOfficialCitiesPath,
  buildOfficialCountriesPath,
  buildOfficialDestinationsPath,
  buildOriginBindingConfirmPath,
  buildScopeBootstrapPath,
  buildScopeBootstrapWorkspacePath,
  resolveProbeDisplayStatus,
  normalizeScopeBootstrapOperationResult,
} from '../apps/web/src/components/logistics-rules/scope-bootstrap-state.mjs';

const pagePath = 'apps/web/src/app/(dashboard)/admin/logistics-rules/page.tsx';
const componentPath =
  'apps/web/src/components/logistics-rules/scope-bootstrap-workbench.tsx';

function readRequired(path) {
  assert.ok(fs.existsSync(path), `${path} must exist`);
  return fs.readFileSync(path, 'utf8');
}

test('scope bootstrap API paths are centralized and encode identifiers', () => {
  assert.equal(
    buildScopeBootstrapWorkspacePath(),
    '/api/admin/logistics-rules/scope-bootstrap/workspace',
  );
  assert.equal(
    buildScopeBootstrapWorkspacePath({
      bootstrapId: 'bootstrap/one',
      tenantId: 'tenant one',
      shopId: 'shop?one',
      warehouseId: 'warehouse#one',
    }),
    '/api/admin/logistics-rules/scope-bootstrap/workspace?bootstrapId=bootstrap%2Fone&tenantId=tenant%20one&shopId=shop%3Fone&warehouseId=warehouse%23one',
  );
  assert.equal(buildScopeBootstrapPath(), '/api/admin/logistics-rules/scope-bootstrap');
  assert.equal(buildBindingProbePath(), '/api/admin/logistics-rules/binding-probes');
  assert.equal(
    buildBindingProbeStatusPath('probe/one'),
    '/api/admin/logistics-rules/binding-probes/probe%2Fone',
  );
  assert.equal(
    buildBindingProbeDecisionPath('probe/one', 'confirm'),
    '/api/admin/logistics-rules/binding-probes/probe%2Fone/confirm',
  );
  assert.equal(
    buildBindingProbeDecisionPath('probe/one', 'reject'),
    '/api/admin/logistics-rules/binding-probes/probe%2Fone/reject',
  );
  assert.throws(() => buildBindingProbeDecisionPath('probe/one', 'approve'), /decision/i);
  assert.equal(
    buildOriginBindingConfirmPath('bootstrap/one'),
    '/api/admin/logistics-rules/scope-bootstrap/bootstrap%2Fone/activate-origin',
  );
  assert.equal(
    buildOfficialCountriesPath(),
    '/api/admin/logistics-rules/official-locations/countries',
  );
  assert.equal(
    buildOfficialCitiesPath('country/one'),
    '/api/admin/logistics-rules/official-locations/countries/country%2Fone/cities',
  );
  assert.equal(
    buildOfficialDestinationsPath(),
    '/api/admin/logistics-rules/official-locations/destinations',
  );
});

test('flat backend operation responses normalize into recoverable UI resources', () => {
  const candidate = normalizeScopeBootstrapOperationResult({
    id: 'bootstrap-1',
    status: 'CANDIDATE',
    tenantId: 'tenant-1',
    shopId: 'shop-1',
    warehouseId: 'warehouse-1',
    deliveryMethodId: 'method-1',
  });
  assert.equal(candidate.bootstrap.id, 'bootstrap-1');
  const apiCandidate = normalizeScopeBootstrapOperationResult({
    bootstrapId: 'bootstrap-2',
    status: 'CANDIDATE',
    openApiScope: { tenantId: 'tenant-2' },
  });
  assert.equal(apiCandidate.bootstrap.id, 'bootstrap-2');
  assert.equal(apiCandidate.bootstrap.bootstrapId, 'bootstrap-2');


  const review = normalizeScopeBootstrapOperationResult({
    probeId: 'probe-1',
    bootstrapId: 'bootstrap-1',
    status: 'CONFIRMED',
    expiresAt: '2026-07-13T05:16:54.192Z',
    companyBindingId: 'binding-1',
    companyBindingStatus: 'VERIFIED',
  });
  assert.deepEqual(review.probe, {
    id: 'probe-1',
    probeId: 'probe-1',
    bootstrapId: 'bootstrap-1',
    status: 'CONFIRMED',
    expiresAt: '2026-07-13T05:16:54.192Z',
  });
  assert.deepEqual(review.companyBinding, {
    id: 'binding-1',
    companyBindingId: 'binding-1',
    status: 'VERIFIED',
  });

  const activated = normalizeScopeBootstrapOperationResult({
    bootstrapId: 'bootstrap-1',
    originBindingId: 'origin-1',
    channelId: 'channel-1',
    assignmentId: 'assignment-1',
    duplicate: false,
  });
  assert.equal(activated.originBinding.id, 'origin-1');
  assert.equal(activated.channel.id, 'channel-1');
  assert.equal(activated.assignment.id, 'assignment-1');
});

test('expired probes become reissuable without changing active probes early', () => {
  const expiresAt = '2026-07-13T05:16:54.192Z';
  assert.equal(resolveProbeDisplayStatus({
    status: 'ISSUED',
    expiresAt,
  }, Date.parse('2026-07-13T05:16:55.000Z')), 'EXPIRED');
  assert.equal(resolveProbeDisplayStatus({
    status: 'CLAIMED',
    expiresAt,
  }, Date.parse('2026-07-13T05:16:55.000Z')), 'EXPIRED');
  assert.equal(resolveProbeDisplayStatus({
    status: 'ISSUED',
    expiresAt,
  }, Date.parse('2026-07-13T05:16:53.000Z')), 'ISSUED');
  assert.equal(
    resolveProbeDisplayStatus({ status: 'SUBMITTED', expiresAt }, Number.POSITIVE_INFINITY),
    'SUBMITTED',
  );
});

test('scope onboarding precedes release context and keeps the workflow progressive', () => {
  const page = readRequired(pagePath);
  const component = readRequired(componentPath);

  assert.match(page, /ScopeBootstrapWorkbench/);
  assert.ok(
    page.indexOf('<ScopeBootstrapWorkbench') <
      page.indexOf('aria-label="物流规则工作上下文"'),
    'scope onboarding must render before Channel and Assignment selection',
  );
  assert.match(component, /试点作用域/);
  assert.match(component, /ERP 租户/);
  assert.match(component, /Ozon 店铺/);
  assert.match(component, /ERP 仓库/);
  assert.match(component, /发运方式/);
  assert.match(component, /OpenAPI bootstrap candidate/);
  assert.match(component, /company probe/);
  assert.match(component, /China \/ Xiamen/);
  assert.match(component, /Russia \/ Moscow/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /disabled=\{!selectedTenantId/);
  assert.match(component, /disabled=\{!selectedShopId/);
  assert.match(component, /disabled=\{!selectedWarehouseId/);
});

test('scope onboarding persists only the bootstrap checkpoint and confirms terminal actions', () => {
  const component = readRequired(componentPath);

  assert.match(component, /localStorage\.getItem\(BOOTSTRAP_CHECKPOINT_KEY\)/);
  assert.match(component, /localStorage\.setItem\(BOOTSTRAP_CHECKPOINT_KEY/);
  assert.match(component, /buildScopeBootstrapWorkspacePath/);
  assert.match(component, /buildBindingProbeDecisionPath/);
  assert.match(component, /buildOriginBindingConfirmPath\(bootstrapId\)/);
  assert.match(component, /DialogTitle>[\s\S]*确认 company probe 决定/);
  assert.match(component, /DialogTitle>[\s\S]*确认试点作用域/);
  assert.match(component, /reason:\s*decisionReason\.trim\(\)/);
  assert.match(component, /reason:\s*originReason\.trim\(\)/);
  assert.match(
    component,
    /officialLocation:\s*\{[\s\S]{0,500}countryUid:[\s\S]{0,500}countryLabel:[\s\S]{0,500}cityUid:[\s\S]{0,500}cityLabel:[\s\S]{0,500}countryCode:/,
  );
  assert.match(
    component,
    /destination:\s*\{[\s\S]{0,500}countryUid:[\s\S]{0,500}countryLabel:[\s\S]{0,500}locationUid:[\s\S]{0,500}locationLabel:[\s\S]{0,500}countryCode:/,
  );
  assert.doesNotMatch(component, /officialLocation:\s*\{[\s\S]{0,400}\blabel:/);
  assert.doesNotMatch(component, /companyId[^\n]*<Input|originCityUid[^\n]*<Input/);
});
