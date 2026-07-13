import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadPanel() {
  const source = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');
  const document = {
    title: 'Ozon product',
    documentElement: { innerHTML: '' },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        style: {},
        addEventListener() {},
        appendChild() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
      };
    },
  };
  const context = {
    console,
    document,
    setTimeout() {},
    clearTimeout() {},
    window: {
      location: { href: 'https://www.ozon.ru/product/pilot-1/' },
    },
  };
  context.window.window = context.window;
  context.window.document = document;
  context.globalThis = context.window;
  vm.runInNewContext(source, context, { filename: 'ozon-panel.js' });
  return context.window.OZON_CALC_OZON_PANEL;
}

const scope = {
  assignmentId: 'assignment-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
};

const route = {
  source: 'erp_assignment',
  assignmentId: scope.assignmentId,
  originCountryUid: scope.originCountryUid,
  originCityUid: scope.originCityUid,
  destinationCountryUid: scope.destinationCountryUid,
  destinationLocationUid: scope.destinationLocationUid,
  originLabel: 'China / Xiamen',
  destinationLabel: 'Russia / Moscow',
};

function remoteStatus(overrides = {}) {
  return {
    state: 'healthy',
    source: 'remote',
    quoteAllowed: true,
    scope,
    route,
    releaseId: 'release-a',
    releaseSequence: 3,
    validUntil: '2026-07-19T00:00:00.000Z',
    staleUntil: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

test('Ozon product panel renders only a trusted scoped ERP route with release freshness', () => {
  const panel = loadPanel();
  const render = typeof panel.buildLogisticsRouteHtml === 'function'
    ? panel.buildLogisticsRouteHtml
    : () => '';

  const healthy = render(remoteStatus());
  assert.match(healthy, /data-logistics-route="verified"/);
  assert.match(healthy, /China \/ Xiamen/);
  assert.match(healthy, /Russia \/ Moscow/);
  assert.match(healthy, /ERP 已发布规则/);
  assert.match(healthy, /版本 3/);
  assert.match(healthy, /title="China \/ Xiamen → Russia \/ Moscow"/);

  const stale = render(remoteStatus({ state: 'stale' }));
  assert.match(stale, /ERP 规则处于宽限期/);

  for (const state of ['unpaired', 'expired', 'authorization_expired', 'revoked']) {
    assert.equal(render(remoteStatus({ state, quoteAllowed: false })), '');
  }

  assert.equal(render(remoteStatus({ route: null })), '');
  assert.equal(render(remoteStatus({
    route: { ...route, assignmentId: 'assignment-b' },
  })), '');
});

test('explicit local HAR fallback is labelled local and never reuses verified route labels', () => {
  const panel = loadPanel();
  const render = typeof panel.buildLogisticsRouteHtml === 'function'
    ? panel.buildLogisticsRouteHtml
    : () => '';

  const html = render(remoteStatus({
    state: 'local_fallback',
    source: 'local_fallback',
    releaseId: null,
    releaseSequence: null,
  }));
  assert.match(html, /data-logistics-route="local-unverified"/);
  assert.match(html, /本地 HAR 兜底/);
  assert.match(html, /路线未验证/);
  assert.doesNotMatch(html, /China \/ Xiamen|Russia \/ Moscow/);
});

test('route row uses bounded grid tracks and ellipsis in the narrow drawer', () => {
  const css = fs.readFileSync('extensions/ss-erp/content/ozon-panel.css', 'utf8');
  const source = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');

  assert.match(
    css,
    /\.ozon-calc-route\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/s,
  );
  assert.match(
    css,
    /\.ozon-calc-route-endpoint\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s,
  );
  assert.match(source, /renderConfigStatus[\s\S]*buildLogisticsRouteHtml\(logisticsStatus\)/);
});
