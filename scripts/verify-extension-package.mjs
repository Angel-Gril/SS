#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const extensionDir = path.resolve(process.env.EXTENSION_DIR || 'extensions/ss-erp');
const strict = process.env.STRICT_EXTENSION_CHECK === '1';
const requestedTarget = process.env.EXTENSION_TARGET;
const failures = [];
const warnings = [];
const passes = [];

function pass(message) {
  passes.push(message);
  console.log(`PASS ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`WARN ${message}`);
}

function fail(message) {
  failures.push(message);
  console.log(`FAIL ${message}`);
}

const captureContractCheck = spawnSync(
  process.execPath,
  ['scripts/generate-source-capture-contract.mjs', '--check'],
  { cwd: repoRoot, encoding: 'utf8', env: process.env },
);
if (captureContractCheck.status === 0) {
  pass('source capture generated contract is current');
} else {
  fail(`source capture generated contract check failed\n${captureContractCheck.stderr || captureContractCheck.stdout}`);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function relToAbs(relPath) {
  return path.resolve(extensionDir, relPath.replaceAll('/', path.sep));
}

function fileExists(relPath, label = relPath) {
  const abs = relToAbs(relPath);
  if (existsSync(abs) && statSync(abs).isFile()) {
    pass(`${label} exists`);
    return true;
  }
  fail(`${label} missing: ${relPath}`);
  return false;
}

function addUnique(set, value) {
  if (value && typeof value === 'string') set.add(value);
}

async function listFiles(dir) {
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  await walk(dir);
  return out;
}

function parseImportScripts(jsRelPath) {
  const abs = relToAbs(jsRelPath);
  if (!existsSync(abs)) return [];
  const text = readFileSync(abs, 'utf8');
  const imports = [];
  const regex = /importScripts\s*\(([^)]*)\)/g;
  let match;
  while ((match = regex.exec(text))) {
    const args = match[1];
    const stringRegex = /['"]([^'"]+)['"]/g;
    let stringMatch;
    while ((stringMatch = stringRegex.exec(args))) {
      const importPath = stringMatch[1];
      if (/^https?:\/\//i.test(importPath)) {
        fail(`${jsRelPath} imports remote script: ${importPath}`);
        continue;
      }
      const normalized = path
        .normalize(path.join(path.dirname(jsRelPath), importPath))
        .replaceAll(path.sep, '/');
      imports.push(normalized);
    }
  }
  return imports;
}

function parseHtmlLocalRefs(htmlRelPath) {
  const abs = relToAbs(htmlRelPath);
  if (!existsSync(abs)) return [];
  const text = readFileSync(abs, 'utf8');
  const refs = [];
  const regex = /\b(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(text))) {
    const ref = match[1];
    if (!ref || ref.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(ref)) continue;
    const normalized = path
      .normalize(path.join(path.dirname(htmlRelPath), ref.split(/[?#]/)[0]))
      .replaceAll(path.sep, '/');
    refs.push(normalized);
  }
  return refs;
}

function checkSyntax(jsFiles) {
  for (const relPath of jsFiles) {
    const abs = relToAbs(relPath);
    const result = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
    if (result.status === 0) {
      pass(`js syntax ok: ${relPath}`);
    } else {
      fail(`js syntax failed: ${relPath}\n${result.stderr || result.stdout}`);
    }
  }
}

function checkDangerousCode(files) {
  const remoteScriptPattern = /<script[^>]+src=["']https?:\/\//i;
  for (const abs of files) {
    const relPath = path.relative(extensionDir, abs).replaceAll(path.sep, '/');
    const text = readFileSync(abs, 'utf8');
    if (/\beval\s*\(/.test(text)) fail(`eval() found: ${relPath}`);
    if (/\bnew\s+Function\s*\(/.test(text)) fail(`new Function() found: ${relPath}`);
    if (remoteScriptPattern.test(text)) fail(`remote script tag found: ${relPath}`);
  }
  pass('dangerous code pattern scan complete');
}

const manifestPath = path.join(extensionDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`FAIL manifest missing: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
pass('manifest JSON parses');

const packageTarget = requestedTarget || (
  manifest.name?.includes('(Cloud)') ? 'cloud'
    : manifest.name?.includes('(Local)') ? 'local'
      : 'source'
);
if (['cloud', 'local', 'source'].includes(packageTarget)) {
  pass(`extension package target: ${packageTarget}`);
} else {
  fail(`unknown extension package target: ${packageTarget}`);
}

if (manifest.manifest_version === 3) pass('manifest_version is 3');
else fail(`manifest_version is not 3: ${manifest.manifest_version}`);

if (manifest.name && manifest.version) pass(`extension identity: ${manifest.name} ${manifest.version}`);
else fail('manifest name/version missing');

const referenced = new Set(['manifest.json']);
const jsReferenced = new Set();
const htmlReferenced = new Set();

for (const icon of Object.values(manifest.icons || {})) addUnique(referenced, icon);
for (const icon of Object.values(manifest.action?.default_icon || {})) addUnique(referenced, icon);
addUnique(referenced, manifest.action?.default_popup);
addUnique(referenced, manifest.options_page);

if (manifest.background?.service_worker) {
  addUnique(referenced, manifest.background.service_worker);
  addUnique(jsReferenced, manifest.background.service_worker);
} else {
  fail('background.service_worker missing');
}

for (const script of manifest.content_scripts || []) {
  for (const js of script.js || []) {
    addUnique(referenced, js);
    addUnique(jsReferenced, js);
  }
  for (const css of script.css || []) addUnique(referenced, css);
}

for (const resourceGroup of manifest.web_accessible_resources || []) {
  for (const resource of resourceGroup.resources || []) {
    if (!resource.includes('*')) addUnique(referenced, resource);
  }
}

const htmlQueue = [...referenced].filter((item) => item.endsWith('.html'));
for (let index = 0; index < htmlQueue.length; index += 1) {
  const html = htmlQueue[index];
  if (htmlReferenced.has(html)) continue;
  addUnique(htmlReferenced, html);
  for (const ref of parseHtmlLocalRefs(html)) {
    if (!referenced.has(ref) && ref.endsWith('.html')) htmlQueue.push(ref);
    addUnique(referenced, ref);
  }
}

const importQueue = [...jsReferenced];
for (let index = 0; index < importQueue.length; index += 1) {
  const current = importQueue[index];
  for (const imported of parseImportScripts(current)) {
    if (!jsReferenced.has(imported)) {
      jsReferenced.add(imported);
      referenced.add(imported);
      importQueue.push(imported);
    }
  }
}

for (const file of [...referenced].sort()) fileExists(file);

const allFiles = await listFiles(extensionDir);
const allJsFiles = allFiles
  .filter((file) => file.endsWith('.js'))
  .map((file) => path.relative(extensionDir, file).replaceAll(path.sep, '/'))
  .sort();

checkSyntax(allJsFiles);
checkDangerousCode(allFiles.filter((file) => /\.(?:js|html)$/i.test(file)));

const requiredAdapters = [
  'shared/adapters/runtime-config.js',
  'shared/adapters/local-adapter.js',
  'shared/adapters/cloud-adapter.js',
  'shared/adapters/erp-client.js',
  'shared/erp-adapter/runtime-mode.js',
];

const requiredSecurityModules = [
  'shared/message-security/runtime-message-policy.js',
  'shared/message-security/runtime-message-authorization.js',
  'shared/byok/profile-schema.js',
  'shared/byok/profile-store.js',
];

const requiredByokModules = [
  'shared/byok/device-session-lifecycle.js',
  'shared/byok/permission-broker.js',
  'shared/byok/permission-readiness-bridge.js',
  'shared/byok/provider-settings-client.js',
  'shared/byok/provider-settings-handler.js',
  'shared/byok/workbench-launch-client.js',
  'shared/byok/workbench-launch-session.js',
  'shared/byok/workbench-preview-channel.js',
  'shared/byok/workbench-runtime-handler.js',
  'shared/byok/workbench-client.js',
];

const requiredByokPages = [
  'pages/ai-provider-settings.html',
  'pages/ai-provider-settings.css',
  'pages/ai-provider-settings.js',
  'pages/ai-image-workbench-launch.html',
  'pages/ai-image-workbench.html',
  'pages/ai-image-workbench.css',
  'pages/ai-image-workbench.js',
];

for (const adapter of requiredAdapters) fileExists(adapter, `adapter ${adapter}`);
for (const modulePath of requiredSecurityModules) fileExists(modulePath, `security module ${modulePath}`);
for (const modulePath of requiredByokModules) fileExists(modulePath, `BYOK module ${modulePath}`);
for (const pagePath of requiredByokPages) fileExists(pagePath, `BYOK page ${pagePath}`);

const swText = readFileSync(relToAbs(manifest.background?.service_worker || ''), 'utf8');
for (const adapter of requiredAdapters) {
  const relFromBackground = `../${adapter}`;
  if (swText.includes(relFromBackground)) pass(`service worker imports ${adapter}`);
  else fail(`service worker does not import ${adapter}`);
}
for (const modulePath of requiredSecurityModules) {
  const relFromBackground = `../${modulePath}`;
  if (swText.includes(relFromBackground)) pass(`service worker imports ${modulePath}`);
  else fail(`service worker does not import ${modulePath}`);
}
for (const modulePath of [
  'shared/byok/device-session-lifecycle.js',
  'shared/byok/permission-broker.js',
  'shared/byok/provider-settings-handler.js',
  'shared/byok/workbench-launch-client.js',
  'shared/byok/workbench-launch-session.js',
  'shared/byok/workbench-preview-channel.js',
  'shared/byok/workbench-runtime-handler.js',
]) {
  const relFromBackground = `../${modulePath}`;
  if (swText.includes(relFromBackground)) pass(`service worker imports ${modulePath}`);
  else fail(`service worker does not import ${modulePath}`);
}

const workbenchHtmlText = readFileSync(relToAbs('pages/ai-image-workbench.html'), 'utf8');
const workbenchLaunchHtmlText = readFileSync(
  relToAbs('pages/ai-image-workbench-launch.html'),
  'utf8',
);
if (workbenchHtmlText.includes('../shared/byok/workbench-client.js')
  && workbenchHtmlText.includes('./ai-image-workbench.js')
  && workbenchHtmlText.includes('./ai-image-workbench.css')) {
  pass('BYOK workbench page references packaged client, controller, and styles');
} else {
  fail('BYOK workbench page references are incomplete');
}
if (!/<script(?:\s|>)/iu.test(workbenchLaunchHtmlText)
  && !/[?#](?:source|product|workflow|shop|draft|sku|slot|key)=/iu.test(workbenchLaunchHtmlText)) {
  pass('BYOK workbench launch placeholder is inert and context-free');
} else {
  fail('BYOK workbench launch placeholder must remain inert and context-free');
}

const cloudText = readFileSync(relToAbs('shared/adapters/cloud-adapter.js'), 'utf8');
if (cloudText.includes('Authorization') && cloudText.includes('Bearer ')) pass('cloud adapter sends bearer token');
else fail('cloud adapter bearer token support missing');
if (/syncCookie\s*\([^)]*\)\s*{[\s\S]*?(不支持|reject|cloud)/i.test(cloudText)) pass('cloud adapter rejects cookie sync');
else fail('cloud adapter cookie sync rejection missing');

const localText = readFileSync(relToAbs('shared/adapters/local-adapter.js'), 'utf8');
if (localText.includes("credentials: 'include'") || localText.includes('credentials: "include"')) {
  pass('local adapter keeps cookie credentials');
} else {
  fail('local adapter does not include credentials');
}

const externalMatches = manifest.externally_connectable?.matches || [];
if (externalMatches.some((item) => item.includes('ss-erp.com'))) pass('externally_connectable includes ss-erp.com');
else fail('externally_connectable missing ss-erp.com');
if (externalMatches.some((item) => item.includes('ss-erp.cn'))) pass('externally_connectable includes ss-erp.cn');
else fail('externally_connectable missing ss-erp.cn');
const externalHasLocalOrigins = externalMatches.some((item) => item.includes('localhost') || item.includes('127.0.0.1'));
if (packageTarget === 'cloud') {
  if (externalHasLocalOrigins) fail('cloud package externally_connectable contains local origins');
  else pass('cloud package externally_connectable excludes local origins');
} else if (externalHasLocalOrigins) {
  pass('externally_connectable includes local development origins');
} else {
  warn('externally_connectable missing local origins');
}
if (externalMatches.some((item) => item.includes('120.55.61.146'))) {
  if (packageTarget === 'cloud') fail('cloud package externally_connectable contains old server IP 120.55.61.146');
  else warn('externally_connectable contains old server IP 120.55.61.146');
}

const hostPermissions = manifest.host_permissions || [];
const optionalHostPermissions = manifest.optional_host_permissions || [];
const contentMatches = (manifest.content_scripts || []).flatMap((script) => script.matches || []);
const webResourceMatches = (manifest.web_accessible_resources || []).flatMap((group) => group.matches || []);
const broadPermissionChecks = [
  [hostPermissions, '<all_urls>', 'host_permissions contains <all_urls>; tighten before Chrome Web Store release'],
  [contentMatches, '<all_urls>', 'content_scripts contains <all_urls>; split local/cloud release package before store submission'],
  [webResourceMatches, '<all_urls>', 'web_accessible_resources contains <all_urls>; tighten before store submission'],
  [hostPermissions, 'file:///*', 'host_permissions contains file:///*; keep only for local/offline package'],
];

function isArbitraryHttpHostPermission(pattern) {
  if (pattern === '<all_urls>') return true;
  return /^(?:\*|https?):\/\/\*(?::(?:\*|\d+))?\/.*$/iu.test(String(pattern || ''));
}

for (const [values, blockedValue, message] of broadPermissionChecks) {
  if (!values.includes(blockedValue)) continue;
  if (packageTarget === 'cloud') fail(`cloud package ${message}`);
  else warn(message);
}

if (packageTarget === 'cloud') {
  const mandatoryArbitraryProviderPermission = hostPermissions.find(isArbitraryHttpHostPermission);
  if (mandatoryArbitraryProviderPermission) {
    fail(`cloud package grants arbitrary Provider access as mandatory: ${mandatoryArbitraryProviderPermission}`);
  } else {
    pass('cloud package has no mandatory arbitrary Provider host access');
  }

  if (optionalHostPermissions.length === 1 && optionalHostPermissions[0] === 'https://*/*') {
    pass('cloud package declares HTTPS Provider access only as an optional host permission');
  } else {
    fail('cloud package optional Provider host permission must be exactly https://*/*');
  }

  const arbitraryPageMatch = [...contentMatches, ...webResourceMatches]
    .find(isArbitraryHttpHostPermission);
  if (arbitraryPageMatch) {
    fail(`cloud package contains arbitrary wildcard page access: ${arbitraryPageMatch}`);
  } else {
    pass('cloud package has no arbitrary wildcard content/resource match');
  }

  const allPermissionValues = [...externalMatches, ...hostPermissions, ...contentMatches, ...webResourceMatches];
  const localPermission = allPermissionValues.find((item) => (
    item.includes('localhost') || item.includes('127.0.0.1') || item.includes('120.55.61.146')
  ));
  if (localPermission) fail(`cloud package contains non-production origin: ${localPermission}`);
  else pass('cloud package excludes localhost, 127.0.0.1, and old server IP origins');
}

const totalSize = allFiles.reduce((sum, file) => sum + statSync(file).size, 0);
pass(`extension file count=${allFiles.length}, size=${totalSize} bytes`);

console.log('');
console.log(`=== Result: ${failures.length} failure(s), ${warnings.length} warning(s), ${passes.length} pass(es) ===`);
if (failures.length || (strict && warnings.length)) {
  process.exit(1);
}
