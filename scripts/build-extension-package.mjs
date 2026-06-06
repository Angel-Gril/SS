#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.dirname(outDir), { recursive: true });
cpSync(sourceDir, outDir, { recursive: true });

const manifestPath = path.join(outDir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const CLOUD_HOST_PERMISSIONS = [
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://docs.ozon.ru/*',
  'https://docs.ozon.com/*',
  'https://global-help.ozon.com/*',
  'https://open.er-api.com/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
  'https://detail.1688.com/*',
  'https://trade.1688.com/*',
  'https://mobile.pinduoduo.com/*',
  'https://www.temu.com/*',
  'https://*.aliexpress.com/*',
  'https://www.wildberries.ru/*',
  'https://item.jd.com/*',
  'https://item.taobao.com/*',
  'https://detail.tmall.com/*',
];

const CLOUD_ERP_MATCHES = [
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
];

const CLOUD_WEB_RESOURCE_MATCHES = [
  ...CLOUD_ERP_MATCHES,
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
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
