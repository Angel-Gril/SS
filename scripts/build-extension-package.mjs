#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sourceDir = path.resolve(process.env.EXTENSION_SOURCE_DIR || 'extensions/ss-erp');
const target = process.argv[2] || process.env.EXTENSION_TARGET || 'cloud';
const outRoot = path.resolve(process.env.EXTENSION_OUT_DIR || 'build/extensions');

if (!['cloud', 'local'].includes(target)) {
  console.error('Usage: node scripts/build-extension-package.mjs <cloud|local>');
  process.exit(1);
}

if (!existsSync(path.join(sourceDir, 'manifest.json'))) {
  console.error(`Extension source missing manifest.json: ${sourceDir}`);
  process.exit(1);
}

const outDir = path.join(outRoot, `ss-erp-${target}`);

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  };
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

function readManifestVersion(root) {
  if (!root) return null;
  const manifestFile = path.join(root, `ss-erp-${target}`, 'manifest.json');
  if (!existsSync(manifestFile)) return null;
  try {
    return parseVersion(JSON.parse(readFileSync(manifestFile, 'utf8')).version);
  } catch {
    return null;
  }
}

function readZipVersions(root) {
  if (!root || !existsSync(root)) return [];
  const prefix = `ss-erp-${target}-`;
  return readdirSync(root)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.zip'))
    .map((name) => parseVersion(name.slice(prefix.length, -4)))
    .filter(Boolean);
}

function resolveBuildVersion(sourceManifestPath) {
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'));
  const source = parseVersion(sourceManifest.version) || parseVersion('0.0.0');
  const candidates = [
    source,
    readManifestVersion(outRoot),
    readManifestVersion(process.env.EXTENSION_PREVIOUS_BUILD_ROOT),
    ...readZipVersions(outRoot),
    ...readZipVersions(process.env.EXTENSION_PREVIOUS_BUILD_ROOT),
  ].filter(Boolean);
  return candidates.reduce((max, current) => (compareVersions(current, max) > 0 ? current : max), source).raw;
}

const buildVersion = resolveBuildVersion(path.join(sourceDir, 'manifest.json'));
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.dirname(outDir), { recursive: true });
cpSync(sourceDir, outDir, { recursive: true });

const logisticsDistributionEnabled =
  process.env.LOGISTICS_DISTRIBUTION_ENABLED === 'true'
  && process.env.NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED === 'true';
const logisticsFeaturePath = path.join(
  outDir,
  'shared/logistics-rules/distribution-feature.js',
);
writeFileSync(logisticsFeaturePath, [
  '(function (root) {',
  '  root.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE = Object.freeze({',
  `    enabled: ${logisticsDistributionEnabled},`,
  `    source: 'package-${target}',`,
  '  });',
  '})(typeof globalThis !== \'undefined\' ? globalThis : self);',
  '',
].join('\n'));

const manifestPath = path.join(outDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = buildVersion;

const CLOUD_HOST_PERMISSIONS = [
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
  'https://ss-erp.cn/*',
  'https://*.ss-erp.cn/*',
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://docs.ozon.ru/*',
  'https://docs.ozon.com/*',
  'https://open.er-api.com/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
  'https://s.1688.com/*',
  'https://*.1688.com/*',
  'https://detail.1688.com/*',
  'https://trade.1688.com/*',
  'https://pifa.pinduoduo.com/*',
  'https://mobile.pinduoduo.com/*',
  'https://*.pinduoduo.com/*',
  'https://*.yangkeduo.com/*',
  'https://www.temu.com/*',
  'https://*.aliexpress.com/*',
  'https://www.wildberries.ru/*',
  'https://item.jd.com/*',
  'https://www.taobao.com/*',
  'https://s.taobao.com/*',
  'https://item.taobao.com/*',
  'https://detail.tmall.com/*',
  'https://www.goofish.com/*',
  'https://goofish.com/*',
  'https://2.taobao.com/*',
];

const CLOUD_ERP_MATCHES = [
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
  'https://ss-erp.cn/*',
  'https://*.ss-erp.cn/*',
];

const CLOUD_WEB_RESOURCE_MATCHES = [
  ...CLOUD_ERP_MATCHES,
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
  'https://s.1688.com/*',
  'https://*.1688.com/*',
  'https://pifa.pinduoduo.com/*',
  'https://www.taobao.com/*',
  'https://s.taobao.com/*',
  'https://www.goofish.com/*',
  'https://goofish.com/*',
  'https://2.taobao.com/*',
];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stripLocalAndBroad(values) {
  return unique(values.filter((value) => (
    value !== '<all_urls>'
    && value !== 'file:///*'
    && !value.includes('localhost')
    && !value.includes('127.0.0.1')
    && !value.includes('120.55.61.146')
  )));
}

if (target === 'cloud') {
  manifest.name = `${manifest.name} (Cloud)`;
  manifest.short_name = 'SS ERP Cloud';
  manifest.host_permissions = CLOUD_HOST_PERMISSIONS;
  manifest.externally_connectable = {
    ...(manifest.externally_connectable || {}),
    matches: CLOUD_ERP_MATCHES,
  };

  manifest.content_scripts = (manifest.content_scripts || [])
    .map((script) => {
      const next = { ...script };
      const js = script.js || [];
      if (js.includes('content/calculator-sync-bridge.js')) {
        return null;
      }
      if (js.includes('content/erp-collect-bridge.js')) {
        next.matches = CLOUD_ERP_MATCHES;
      } else {
        next.matches = stripLocalAndBroad(script.matches || []);
      }
      if (next.exclude_matches) next.exclude_matches = stripLocalAndBroad(next.exclude_matches);
      return next.matches.length ? next : null;
    })
    .filter(Boolean);

  manifest.web_accessible_resources = (manifest.web_accessible_resources || []).map((group) => ({
    ...group,
    matches: CLOUD_WEB_RESOURCE_MATCHES,
  }));
} else {
  manifest.name = `${manifest.name} (Local)`;
  manifest.short_name = 'SS ERP Local';
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  target,
  sourceDir,
  outDir,
  manifest: manifestPath,
}, null, 2));
