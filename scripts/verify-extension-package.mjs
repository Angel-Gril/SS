#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseExpectedReleaseOrigins,
  parseExtensionDeploymentDefaults,
} from './extension-release-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliArgs = process.argv.slice(2);

function readCliOption(name) {
  const index = cliArgs.indexOf(name);
  if (index === -1) return '';
  const value = cliArgs[index + 1];
  if (!value || value.startsWith('--')) {
    console.error(`FAIL ${name} requires a value`);
    process.exit(1);
  }
  return value;
}

const extensionDir = path.resolve(
  readCliOption('--dir') || process.env.EXTENSION_DIR || 'extensions/ss-erp',
);
const strict = cliArgs.includes('--strict') || process.env.STRICT_EXTENSION_CHECK === '1';
const requestedTarget = readCliOption('--target') || process.env.EXTENSION_TARGET;
const rawExpectedReleaseOrigins = {
  web: readCliOption('--expected-web-origin'),
  admin: readCliOption('--expected-admin-origin'),
  api: readCliOption('--expected-api-origin'),
  local: readCliOption('--expected-local-origin'),
};
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

function parseHtmlScriptSources(htmlText) {
  const sources = [];
  const regex = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu;
  let match;
  while ((match = regex.exec(htmlText))) sources.push(match[1]);
  return sources;
}

function checkScriptLoadOrder(actualSources, requiredSources, label) {
  let previousIndex = -1;
  let previousSource = '';
  let valid = true;

  for (const source of requiredSources) {
    const index = actualSources.indexOf(source);
    if (index === -1) {
      fail(`${label} missing script: ${source}`);
      valid = false;
      continue;
    }
    if (index <= previousIndex) {
      fail(`${label} script order invalid: ${previousSource} must load before ${source}`);
      valid = false;
    }
    previousIndex = Math.max(previousIndex, index);
    previousSource = source;
  }

  if (valid) pass(`${label} scripts load in dependency order`);
  return valid;
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

const sensitivePackageExtensions = new Set([
  '.jks', '.key', '.keystore', '.p12', '.pem', '.pfx',
]);
const sensitivePackageBasenames = new Set([
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_rsa',
  'secrets',
  'secrets.json',
  'service-account.json',
  'service_account.json',
]);
const packagedCredentialPatterns = [
  {
    label: 'OpenAI-compatible API key',
    pattern: /(?:^|[^a-z0-9_-])(sk-[a-z0-9_-]{20,})(?=$|[^a-z0-9_-])/giu,
  },
  {
    label: 'Provider API key',
    pattern: /(?:^|[^a-z0-9_-])((?:rk-|xai-)[a-z0-9_-]{20,}|(?:gsk_|hf_|r8_|ghp_)[a-z0-9_]{20,}|github_pat_[a-z0-9_]{20,})(?=$|[^a-z0-9_-])/giu,
  },
  {
    label: 'AWS access key',
    pattern: /(?:^|[^A-Z0-9])((?:AKIA|ASIA)[A-Z0-9]{16})(?=$|[^A-Z0-9])/gu,
  },
  {
    label: 'Aliyun access key',
    pattern: /(?:^|[^a-z0-9])((?:LTAI|AKID)[a-z0-9]{12,})(?=$|[^a-z0-9])/giu,
  },
  {
    label: 'Google API key',
    pattern: /(?:^|[^a-z0-9_-])(AIza[a-z0-9_-]{30,})(?=$|[^a-z0-9_-])/giu,
  },
  {
    label: 'Slack token',
    pattern: /(?:^|[^a-z0-9-])(xox[baprs]-[a-z0-9-]{16,})(?=$|[^a-z0-9-])/giu,
  },
  {
    label: 'JWT credential',
    pattern: /(?:^|[^a-z0-9_-])(eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,})(?=$|[^a-z0-9_-])/giu,
  },
  {
    label: 'private key material',
    pattern: /(-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----)/gu,
  },
];

function isSensitivePackageFilename(relPath) {
  const basename = path.posix.basename(relPath).toLowerCase();
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (sensitivePackageBasenames.has(basename)) return true;
  return sensitivePackageExtensions.has(path.posix.extname(basename));
}

function isExplicitSyntheticCredential(value) {
  const normalized = String(value || '').toLowerCase();
  return /^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|xox[baprs]-)(?:test|fixture|example|dummy|fake|placeholder|redacted|qa\d*)[-_]/u.test(normalized)
    || /(?:^|[-_])(?:secret[-_])?(?:sentinel|never[-_]real|not[-_]a[-_]real[-_]key)(?:$|[-_])/u.test(normalized)
    || normalized === 'akiaiosfodnn7example';
}

function checkPackagedSecrets(files) {
  for (const abs of files) {
    const relPath = path.relative(extensionDir, abs).replaceAll(path.sep, '/');
    if (isSensitivePackageFilename(relPath)) {
      fail(`sensitive file is not allowed: ${relPath}`);
    }

    const text = readFileSync(abs).toString('utf8');
    for (const { label, pattern } of packagedCredentialPatterns) {
      for (const match of text.matchAll(pattern)) {
        if (!isExplicitSyntheticCredential(match[1])) {
          fail(`${label} found in ${relPath}`);
          break;
        }
      }
    }
  }
  pass('packaged secret and sensitive filename scan complete');
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

const hasAnyExpectedReleaseOrigin = Object.values(rawExpectedReleaseOrigins).some(Boolean);
let expectedReleaseOrigins = null;
if (hasAnyExpectedReleaseOrigin) {
  try {
    expectedReleaseOrigins = parseExpectedReleaseOrigins(
      rawExpectedReleaseOrigins,
      'package verifier expected origins',
    );
    if (packageTarget !== 'cloud' && packageTarget !== 'local') {
      fail('expected release origins require a packaged cloud or local target');
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

let deploymentDefaults = null;
if (packageTarget === 'cloud' || packageTarget === 'local') {
  try {
    deploymentDefaults = parseExtensionDeploymentDefaults(
      readFileSync(relToAbs('shared/erp-adapter/deployment-defaults.js'), 'utf8'),
    );
    if (deploymentDefaults.target === packageTarget) {
      pass(`deployment defaults target is exactly ${packageTarget}`);
    } else {
      fail(`deployment defaults target mismatch: expected ${packageTarget}, received ${deploymentDefaults.target}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

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
checkPackagedSecrets(allFiles);

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

const requiredSharedContracts = [
  'shared/contracts/ai-image-workbench-v1.js',
];

const requiredByokBatchBackgroundModules = [
  'shared/byok/execution-intent-client.js',
  'shared/byok/execution-batch-client.js',
  'shared/byok/execution-intent-claim-broker.js',
  'shared/byok/workbench-batch-provider-executor.js',
  'shared/byok/workbench-batch-coordinator.js',
  'shared/byok/generated-asset-batch-ingest-client.js',
  'shared/byok/workbench-batch-launch-client.js',
  'shared/byok/workbench-batch-registry.js',
  'shared/byok/workbench-batch-runtime-handler.js',
];

const requiredByokModules = [
  'shared/byok/device-session-lifecycle.js',
  'shared/byok/permission-broker.js',
  'shared/byok/permission-readiness-bridge.js',
  'shared/byok/provider-settings-client.js',
  'shared/byok/provider-settings-handler.js',
  'shared/byok/image-input-inspector.js',
  'shared/byok/image-mask-transform.js',
  'shared/byok/image-edit-adapters.js',
  'shared/byok/image-edit-probe-media.js',
  'shared/byok/image-edit-client.js',
  'shared/byok/media-job-engine.js',
  'shared/byok/prompt-plan.js',
  'shared/byok/generated-result-vault.js',
  'shared/byok/workbench-launch-client.js',
  'shared/byok/workbench-launch-session.js',
  'shared/byok/workbench-preview-channel.js',
  'shared/byok/workbench-provider-semaphore.js',
  'shared/byok/workbench-media-channel.js',
  'shared/byok/workbench-edit-media-store.js',
  'shared/byok/workbench-edit-epoch-guard.js',
  'shared/byok/workbench-edit-controller.js',
  'shared/byok/workbench-workspace-state.js',
  'shared/byok/workbench-runtime-handler.js',
  'shared/byok/listing-publish-coordinator.js',
  'shared/byok/workbench-client.js',
  'shared/byok/workbench-batch-client.js',
  ...requiredByokBatchBackgroundModules,
];

const requiredByokBackgroundModules = [
  'shared/byok/device-session-lifecycle.js',
  'shared/byok/permission-broker.js',
  'shared/byok/provider-settings-handler.js',
  'shared/byok/image-input-inspector.js',
  'shared/byok/image-mask-transform.js',
  'shared/byok/image-edit-adapters.js',
  'shared/byok/image-edit-probe-media.js',
  'shared/byok/image-edit-client.js',
  'shared/byok/generated-result-vault.js',
  'shared/byok/media-job-engine.js',
  'shared/byok/workbench-launch-client.js',
  'shared/byok/workbench-launch-session.js',
  'shared/byok/workbench-preview-channel.js',
  'shared/byok/workbench-provider-semaphore.js',
  'shared/byok/workbench-media-channel.js',
  'shared/byok/workbench-edit-media-store.js',
  'shared/byok/workbench-edit-epoch-guard.js',
  'shared/byok/workbench-edit-controller.js',
  'shared/byok/workbench-runtime-handler.js',
  'shared/byok/listing-publish-coordinator.js',
  ...requiredByokBatchBackgroundModules,
];

const requiredHostedBackgroundModules = [
  'shared/hosted/ai-image-suite-workbench-adapter.js',
  'shared/hosted/ai-image-suite-candidate-preview-bridge.js',
  'shared/hosted/ai-image-suite-workbench-client.js',
  'shared/hosted/ai-image-suite-workbench-client-registry.js',
  'shared/hosted/ai-image-suite-workbench-runtime-dispatcher.js',
];

const requiredHostedPageModules = [
  'shared/hosted/ai-image-suite-workbench-runtime-client.js',
  'shared/hosted/ai-image-suite-candidate-preview-consumer.js',
  'shared/hosted/ai-image-suite-workspace-projection.js',
  'pages/ai-image-workbench-hosted.js',
];

const requiredUnifiedPublishModules = [
  'shared/publish/workbench-listing-publish-coordinator.js',
  'pages/ai-image-workbench-publish.js',
];

const requiredByokPages = [
  'pages/ai-provider-settings.html',
  'pages/ai-provider-settings.css',
  'pages/ai-provider-settings.js',
  'pages/ai-image-workbench-launch.html',
  'pages/ai-image-workbench.html',
  'pages/ai-image-workbench.css',
  'pages/ai-image-workbench.js',
  'pages/ai-image-workbench-edit.js',
  'pages/ai-image-workbench-workspace.js',
  'pages/ai-image-workbench-batch.js',
];

for (const adapter of requiredAdapters) fileExists(adapter, `adapter ${adapter}`);
for (const modulePath of requiredSecurityModules) fileExists(modulePath, `security module ${modulePath}`);
for (const contractPath of requiredSharedContracts) fileExists(contractPath, `shared contract ${contractPath}`);
for (const modulePath of requiredByokModules) fileExists(modulePath, `BYOK module ${modulePath}`);
for (const pagePath of requiredByokPages) fileExists(pagePath, `BYOK page ${pagePath}`);
for (const modulePath of requiredHostedBackgroundModules) {
  fileExists(modulePath, `hosted background module ${modulePath}`);
}
for (const modulePath of requiredHostedPageModules) {
  fileExists(modulePath, `hosted page module ${modulePath}`);
}
for (const modulePath of requiredUnifiedPublishModules) {
  fileExists(modulePath, `unified publish module ${modulePath}`);
}

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
for (const modulePath of requiredByokBackgroundModules) {
  const relFromBackground = `../${modulePath}`;
  if (swText.includes(relFromBackground)) pass(`service worker imports ${modulePath}`);
  else fail(`service worker does not import ${modulePath}`);
}
checkScriptLoadOrder(
  parseImportScripts(manifest.background?.service_worker || ''),
  requiredByokBatchBackgroundModules,
  'BYOK batch service worker',
);
for (const modulePath of requiredHostedBackgroundModules) {
  const relFromBackground = `../${modulePath}`;
  if (swText.includes(relFromBackground)) pass(`service worker imports ${modulePath}`);
  else fail(`service worker does not import ${modulePath}`);
}
if (swText.includes('../shared/publish/workbench-listing-publish-coordinator.js')) {
  pass('service worker imports the unified workbench publish coordinator');
} else {
  fail('service worker does not import the unified workbench publish coordinator');
}
checkScriptLoadOrder(
  parseImportScripts(manifest.background?.service_worker || ''),
  requiredHostedBackgroundModules,
  'ERP-hosted service worker',
);

const hostedPreviewWired = [
  'function getHostedAiImageSuitePreviewBridge()',
  'SS_ERP_HOSTED_AI_IMAGE_SUITE_CANDIDATE_PREVIEW_BRIDGE',
  'hostedAiImageSuitePreviewBridge = api.createBridge({',
  'transport.post(',
  'transport.postRaw(',
  "result.state !== 'raw_response'",
  'hostedAiImageSuitePreviewBridge.clear()',
].every((token) => swText.includes(token));
if (hostedPreviewWired) pass('service worker hosted preview wiring is complete');
else fail('service worker hosted preview wiring is incomplete');

const hostedRegistryWired = [
  'function getHostedAiImageSuiteClientRegistry()',
  'SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_CLIENT_REGISTRY',
  'hostedAiImageSuiteClientRegistry = api.createRegistry({',
  'return createHostedAiImageSuiteWorkbenchClient();',
  'getHostedAiImageSuiteClientRegistry().getClient(sender, binding)',
  'hostedAiImageSuiteClientRegistry.clearAll(',
  'getHostedAiImageSuiteClientRegistry().removeTab(tabId)',
].every((token) => swText.includes(token));
if (hostedRegistryWired) pass('service worker hosted registry wiring is complete');
else fail('service worker hosted registry wiring is incomplete');

const hostedDispatcherWired = [
  'function getHostedAiImageSuiteRuntimeDispatcher()',
  'SS_ERP_HOSTED_AI_IMAGE_SUITE_WORKBENCH_RUNTIME_DISPATCHER',
  'authorization.MESSAGE_TYPES.HOSTED_WORKBENCH',
  'hostedAiImageSuiteRuntimeDispatcher = api.createDispatcher({',
  '...hostedWorkbenchDispatcher.handlers,',
].every((token) => swText.includes(token));
if (hostedDispatcherWired) pass('service worker hosted dispatcher wiring is complete');
else fail('service worker hosted dispatcher wiring is incomplete');

const unifiedPublishWired = [
  'function getWorkbenchListingPublishCoordinator()',
  'SS_ERP_WORKBENCH_LISTING_PUBLISH_COORDINATOR',
  'workbenchPublishCoordinator: getWorkbenchListingPublishCoordinator()',
  'getWorkbenchListingPublishCoordinator().clear()',
].every((token) => swText.includes(token));
if (unifiedPublishWired) pass('service worker unified publish wiring is complete');
else fail('service worker unified publish wiring is incomplete');

const workbenchHtmlText = readFileSync(relToAbs('pages/ai-image-workbench.html'), 'utf8');
const workbenchLaunchHtmlText = readFileSync(
  relToAbs('pages/ai-image-workbench-launch.html'),
  'utf8',
);
const requiredWorkbenchScripts = [
  '../shared/ai-media/image-mask-core.js',
  '../shared/ai-media/image-mask-layout.js',
  '../shared/ai-media/image-mask-canvas.js',
  '../shared/contracts/ai-image-workbench-v1.js',
  '../shared/byok/workbench-workspace-state.js',
  '../shared/byok/workbench-client.js',
  '../shared/byok/workbench-batch-client.js',
  './ai-image-workbench-workspace.js',
  './ai-image-workbench-publish.js',
  './ai-image-workbench-batch.js',
  './ai-image-workbench.js',
  './ai-image-workbench-edit.js',
];
const orderedWorkbenchScripts = [
  '../shared/contracts/ai-image-workbench-v1.js',
  '../shared/byok/workbench-workspace-state.js',
  '../shared/byok/workbench-client.js',
  '../shared/byok/workbench-batch-client.js',
  './ai-image-workbench-workspace.js',
  './ai-image-workbench-publish.js',
  './ai-image-workbench-batch.js',
  './ai-image-workbench.js',
  './ai-image-workbench-edit.js',
];
const requiredHostedWorkbenchScripts = [
  '../shared/hosted/ai-image-suite-workbench-runtime-client.js',
  '../shared/hosted/ai-image-suite-candidate-preview-consumer.js',
  '../shared/hosted/ai-image-suite-workspace-projection.js',
  './ai-image-workbench-hosted.js',
];
const orderedHostedWorkbenchScripts = [
  '../shared/byok/workbench-client.js',
  '../shared/byok/workbench-batch-client.js',
  '../shared/hosted/ai-image-suite-workbench-runtime-client.js',
  '../shared/hosted/ai-image-suite-candidate-preview-consumer.js',
  '../shared/hosted/ai-image-suite-workspace-projection.js',
  './ai-image-workbench-workspace.js',
  './ai-image-workbench-publish.js',
  './ai-image-workbench-hosted.js',
  './ai-image-workbench-batch.js',
  './ai-image-workbench.js',
  './ai-image-workbench-edit.js',
];
const workbenchScriptSources = parseHtmlScriptSources(workbenchHtmlText);
if (requiredWorkbenchScripts.every((source) => workbenchScriptSources.includes(source))
  && workbenchHtmlText.includes('./ai-image-workbench.css')) {
  pass('BYOK workbench page references packaged client, controller, and styles');
} else {
  fail('BYOK workbench page references are incomplete');
}
checkScriptLoadOrder(workbenchScriptSources, orderedWorkbenchScripts, 'BYOK workbench page');
if (requiredHostedWorkbenchScripts.every((source) => workbenchScriptSources.includes(source))) {
  pass('ERP-hosted workbench page references packaged runtime, preview, projection, and controller');
} else {
  fail('ERP-hosted workbench page references are incomplete');
}
checkScriptLoadOrder(
  workbenchScriptSources,
  orderedHostedWorkbenchScripts,
  'ERP-hosted workbench page',
);
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

function containsExactlyOnce(values, expected) {
  return Array.isArray(values) && values.filter((value) => value === expected).length === 1;
}

function containsExactUniqueSet(values, expected) {
  return Array.isArray(values)
    && values.length === new Set(values).size
    && values.length === expected.length
    && expected.every((value) => values.includes(value));
}

if (expectedReleaseOrigins && packageTarget === 'local') {
  if (deploymentDefaults
    && deploymentDefaults.web === expectedReleaseOrigins.local
    && deploymentDefaults.admin === expectedReleaseOrigins.local
    && deploymentDefaults.api === expectedReleaseOrigins.local) {
    pass('local deployment defaults exactly match the independently approved loopback origin');
  } else {
    fail('local deployment defaults do not match the independently approved loopback origin');
  }
}

if (expectedReleaseOrigins && packageTarget === 'cloud') {
  if (deploymentDefaults
    && deploymentDefaults.web === expectedReleaseOrigins.web
    && deploymentDefaults.admin === expectedReleaseOrigins.admin
    && deploymentDefaults.api === expectedReleaseOrigins.api) {
    pass('deployment defaults exactly match independently approved release origins');
  } else {
    fail('deployment defaults do not exactly match independently approved release origins');
  }

  const webMatch = `${expectedReleaseOrigins.web}/*`;
  const adminMatch = `${expectedReleaseOrigins.admin}/*`;
  const apiPermission = `${expectedReleaseOrigins.api}/*`;
  const approvedErpMatches = [...new Set([
    'https://ss-erp.com/*',
    'https://*.ss-erp.com/*',
    'https://ss-erp.cn/*',
    'https://*.ss-erp.cn/*',
    webMatch,
    adminMatch,
  ])];
  if (containsExactUniqueSet(externalMatches, approvedErpMatches)) {
    pass('externally_connectable exactly matches approved Web/Admin origins and SS ERP baseline');
  } else {
    fail('externally_connectable contains missing, duplicate, or unapproved ERP origins');
  }

  const erpBridgeScripts = (manifest.content_scripts || []).filter((script) => (
    Array.isArray(script.js) && script.js.includes('content/erp-collect-bridge.js')
  ));
  if (erpBridgeScripts.length !== 1) {
    fail('manifest must contain exactly one ERP collect bridge content-script entry');
  } else if (containsExactUniqueSet(erpBridgeScripts[0].matches, approvedErpMatches)) {
    pass('ERP collect bridge exactly matches approved Web/Admin origins and SS ERP baseline');
  } else {
    fail('ERP collect bridge contains missing, duplicate, or unapproved ERP origins');
  }

  if (containsExactlyOnce(hostPermissions, apiPermission)) {
    pass('host_permissions contains the exact approved API origin');
  } else {
    fail('host_permissions must contain the exact approved API origin once');
  }
  const approvedCloudHostPermissions = new Set([
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
    apiPermission,
  ]);
  const unknownCloudHostPermission = hostPermissions.find(
    (permission) => !approvedCloudHostPermissions.has(permission),
  );
  if (unknownCloudHostPermission) {
    fail(`host_permissions contains an unapproved cloud origin: ${unknownCloudHostPermission}`);
  } else if (hostPermissions.length !== new Set(hostPermissions).size) {
    fail('host_permissions contains duplicate cloud origins');
  } else {
    pass('host_permissions contains no unapproved cloud ERP/API origin');
  }

  const approvedContentMatches = new Set([
    ...approvedErpMatches,
    'https://mobile.yangkeduo.com/goods.html*',
    'https://item.taobao.com/item.htm*',
    'https://detail.tmall.com/item.htm*',
    'https://seller.ozon.ru/*',
    'https://globalcalculator.ozon.ru/*',
    'https://*.ozon.ru/*',
    'https://*.ozon.kz/*',
    'https://*.ozon.by/*',
    'https://detail.1688.com/*',
    'https://*.pinduoduo.com/*',
    'https://*.yangkeduo.com/*',
    'https://www.temu.com/*',
    'https://*.aliexpress.com/*',
    'https://www.wildberries.ru/*',
    'https://ozon.ru/product/*',
    'https://www.ozon.ru/product/*',
    'https://ozon.kz/product/*',
    'https://www.ozon.kz/product/*',
    'https://ozon.by/product/*',
    'https://www.ozon.by/product/*',
    'https://item.jd.com/*',
    'https://item.taobao.com/*',
    'https://detail.tmall.com/*',
    'https://www.goofish.com/*',
    'https://goofish.com/*',
    'https://2.taobao.com/*',
    'https://s.1688.com/*',
    'https://*.1688.com/*',
    'https://pifa.pinduoduo.com/*',
    'https://www.taobao.com/*',
    'https://s.taobao.com/*',
    'https://www.ozon.ru/*',
    'https://www.ozon.kz/*',
    'https://www.ozon.by/*',
    'https://trade.1688.com/*',
    'https://mobile.pinduoduo.com/*',
  ]);
  const unknownContentMatch = contentMatches.find((match) => !approvedContentMatches.has(match));
  if (unknownContentMatch) {
    fail(`content_scripts contains an unapproved cloud origin: ${unknownContentMatch}`);
  } else {
    pass('content_scripts contain only approved ERP and marketplace origins');
  }

  const approvedWebResourceMatches = new Set([
    ...approvedErpMatches,
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
  ]);
  const unknownWebResourceMatch = webResourceMatches.find(
    (match) => !approvedWebResourceMatches.has(match),
  );
  if (unknownWebResourceMatch) {
    fail(`web_accessible_resources contains an unapproved cloud origin: ${unknownWebResourceMatch}`);
  } else {
    pass('web_accessible_resources contain only approved ERP and marketplace origins');
  }
}

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
