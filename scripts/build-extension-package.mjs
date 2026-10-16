#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  EXTENSION_DONOR_WORKBENCH_WEB_RESOURCE_MATCHES,
  EXTENSION_MARKETPLACE_WEB_RESOURCE_MATCHES,
  EXTENSION_RETIRED_WORKBENCH_UI_FILES,
} from './extension-release-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const sourceDir = path.resolve(process.env.EXTENSION_SOURCE_DIR || 'extensions/ss-erp');
const target = process.argv[2] || process.env.EXTENSION_TARGET || 'cloud';
const outRoot = path.resolve(process.env.EXTENSION_OUT_DIR || 'build/extensions');

if (!['cloud', 'local'].includes(target)) {
  console.error('Usage: node scripts/build-extension-package.mjs <cloud|local>');
  process.exit(1);
}

const captureContractCheck = spawnSync(
  process.execPath,
  ['scripts/generate-source-capture-contract.mjs', '--check'],
  { cwd: repoRoot, stdio: 'inherit', env: process.env },
);
if (captureContractCheck.status !== 0) process.exit(captureContractCheck.status || 1);

if (!existsSync(path.join(sourceDir, 'manifest.json'))) {
  console.error(`Extension source missing manifest.json: ${sourceDir}`);
  process.exit(1);
}

const outDir = path.join(outRoot, `ss-erp-${target}`);

function normalizeErpBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol !== 'https:' && !(target === 'local' && url.protocol === 'http:')) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function resolveDefaultErpBaseUrl() {
  if (target === 'local') {
    return normalizeErpBaseUrl(process.env.EXTENSION_LOCAL_BASE_URL) || 'http://127.0.0.1:3001';
  }
  const userHostname = String(process.env.NEXT_PUBLIC_USER_HOSTNAME || '').trim();
  return normalizeErpBaseUrl(process.env.EXTENSION_CLOUD_BASE_URL)
    || normalizeErpBaseUrl(userHostname ? `https://${userHostname}` : '')
    || normalizeErpBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL)
    || 'https://app.ss-erp.com';
}

function resolveDefaultErpApiBaseUrl(erpBaseUrl) {
  if (target === 'local') return erpBaseUrl;
  return normalizeErpBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL)
    || erpBaseUrl;
}

function resolveDefaultErpAdminBaseUrl(erpBaseUrl) {
  if (target === 'local') return erpBaseUrl;
  const adminHostname = String(process.env.NEXT_PUBLIC_ADMIN_HOSTNAME || '').trim();
  const configured = normalizeErpBaseUrl(adminHostname ? `https://${adminHostname}` : '');
  if (configured) return configured;
  try {
    const userUrl = new URL(erpBaseUrl);
    if (userUrl.hostname.startsWith('app.')) {
      userUrl.hostname = `admin.${userUrl.hostname.slice(4)}`;
      return userUrl.origin;
    }
  } catch {
    // Fall through to the international production default.
  }
  return 'https://admin.ss-erp.com';
}

function knownDeploymentRoot(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  if (normalized === 'ss-erp.com' || normalized.endsWith('.ss-erp.com')) return 'ss-erp.com';
  if (normalized === 'ss-erp.cn' || normalized.endsWith('.ss-erp.cn')) return 'ss-erp.cn';
  return '';
}

function assertConfiguredCloudHttps(label, value) {
  if (target !== 'cloud' || !String(value || '').trim()) return;
  const raw = String(value).trim();
  let parsed;
  try {
    parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Cloud extension ${label} URL is invalid`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Cloud extension ${label} URL must use HTTPS`);
  }
}

assertConfiguredCloudHttps(
  'Web',
  process.env.EXTENSION_CLOUD_BASE_URL || process.env.NEXT_PUBLIC_USER_HOSTNAME,
);
assertConfiguredCloudHttps('admin', process.env.NEXT_PUBLIC_ADMIN_HOSTNAME);
assertConfiguredCloudHttps('API', process.env.NEXT_PUBLIC_API_BASE_URL);

const resolvedErpBaseUrl = resolveDefaultErpBaseUrl();
const resolvedErpAdminBaseUrl = resolveDefaultErpAdminBaseUrl(resolvedErpBaseUrl);
const resolvedErpApiBaseUrl = resolveDefaultErpApiBaseUrl(resolvedErpBaseUrl);
const deploymentUrls = {
  web: new URL(resolvedErpBaseUrl),
  admin: new URL(resolvedErpAdminBaseUrl),
  api: new URL(resolvedErpApiBaseUrl),
};

if (target === 'cloud') {
  for (const [label, url] of Object.entries(deploymentUrls)) {
    if (url.protocol !== 'https:') {
      throw new Error(`Cloud extension ${label} URL must use HTTPS`);
    }
  }
  const roots = Object.values(deploymentUrls).map((url) => knownDeploymentRoot(url.hostname));
  const knownRoots = roots.filter(Boolean);
  if (knownRoots.length > 0 && (
    knownRoots.length !== roots.length
    || new Set(knownRoots).size !== 1
  )) {
    throw new Error('Cloud extension Web, admin, and API URLs must use the same SS ERP deployment root');
  }
}

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
const retiredWorkbenchUiFiles = new Set(EXTENSION_RETIRED_WORKBENCH_UI_FILES);
cpSync(sourceDir, outDir, {
  recursive: true,
  filter: (sourcePath) => !retiredWorkbenchUiFiles.has(
    path.relative(sourceDir, sourcePath).replaceAll(path.sep, '/'),
  ),
});

const logisticsDistributionEnabled =
  process.env.LOGISTICS_DISTRIBUTION_ENABLED === 'true'
  && process.env.NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED === 'true';
const logisticsFeaturePath = path.join(
  outDir,
  'shared/logistics-rules/distribution-feature.js',
);
mkdirSync(path.dirname(logisticsFeaturePath), { recursive: true });
writeFileSync(logisticsFeaturePath, [
  '(function (root) {',
  '  root.SS_ERP_LOGISTICS_DISTRIBUTION_FEATURE = Object.freeze({',
  `    enabled: ${logisticsDistributionEnabled},`,
  `    source: 'package-${target}',`,
  '  });',
  '})(typeof globalThis !== \'undefined\' ? globalThis : self);',
  '',
].join('\n'));

const deploymentDefaultsPath = path.join(outDir, 'shared/erp-adapter/deployment-defaults.js');
mkdirSync(path.dirname(deploymentDefaultsPath), { recursive: true });
writeFileSync(deploymentDefaultsPath, [
  '(function (root) {',
  '  root.SS_ERP_DEPLOYMENT_DEFAULTS = Object.freeze({',
  `    target: ${JSON.stringify(target)},`,
  `    erpBaseUrl: ${JSON.stringify(deploymentUrls.web.origin)},`,
  `    erpAdminBaseUrl: ${JSON.stringify(deploymentUrls.admin.origin)},`,
  `    erpApiBaseUrl: ${JSON.stringify(deploymentUrls.api.origin)},`,
  '  });',
  "})(typeof globalThis !== 'undefined' ? globalThis : self);",
  '',
].join('\n'));

const manifestPath = path.join(outDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = buildVersion;

// Arbitrary BYOK Provider access is optional. The settings page asks Chrome for
// one exact canonical origin after ERP allowlist approval and a trusted gesture.
// Never move this wildcard into mandatory host_permissions.
manifest.optional_host_permissions = ['https://*/*'];

const CLOUD_HOST_PERMISSIONS = unique([
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
  'https://ss-erp.cn/*',
  'https://*.ss-erp.cn/*',
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://docs.ozon.ru/*',
  'https://docs.ozon.com/*',
  'https://global-help.ozon.com/*',
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
  `${deploymentUrls.api.origin}/*`,
]);

const CLOUD_ERP_MATCHES = unique([
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
  'https://ss-erp.cn/*',
  'https://*.ss-erp.cn/*',
  `${deploymentUrls.web.origin}/*`,
  `${deploymentUrls.admin.origin}/*`,
]);

const CLOUD_WEB_RESOURCE_MATCHES = [
  ...CLOUD_ERP_MATCHES,
  ...EXTENSION_MARKETPLACE_WEB_RESOURCE_MATCHES,
];

const LOCAL_HOST_PERMISSIONS = unique([
  ...CLOUD_HOST_PERMISSIONS,
  'http://localhost/*',
  'https://localhost/*',
  'http://127.0.0.1/*',
  'https://127.0.0.1/*',
]);

const LOCAL_WEB_RESOURCE_MATCHES = unique([
  ...CLOUD_WEB_RESOURCE_MATCHES,
  'http://localhost/*',
  'https://localhost/*',
  'http://127.0.0.1/*',
  'https://127.0.0.1/*',
]);

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

function webResourceMatches(group, fallback) {
  return Array.isArray(group.resources)
    && group.resources.includes('pages/precision-workbench.html')
    ? EXTENSION_DONOR_WORKBENCH_WEB_RESOURCE_MATCHES
    : fallback;
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
    matches: webResourceMatches(group, CLOUD_WEB_RESOURCE_MATCHES),
  }));
} else {
  manifest.name = `${manifest.name} (Local)`;
  manifest.short_name = 'SS ERP Local';
  manifest.host_permissions = LOCAL_HOST_PERMISSIONS;
  manifest.web_accessible_resources = (manifest.web_accessible_resources || []).map((group) => ({
    ...group,
    matches: webResourceMatches(group, LOCAL_WEB_RESOURCE_MATCHES),
  }));
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify({
  target,
  sourceDir,
  outDir,
  manifest: manifestPath,
}, null, 2));
