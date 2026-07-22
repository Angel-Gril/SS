import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const deploymentHosts = read('apps/web/src/lib/deployment-hosts.ts');
const middleware = read('apps/web/src/middleware.ts');
const userLogin = read('apps/web/src/app/(auth)/login/page-client.tsx');
const adminLogin = read('apps/web/src/app/(auth)/admin/login/page-client.tsx');
const downloadPage = read('apps/web/src/app/download/page.tsx');
const integrationsPage = read('apps/web/src/app/(dashboard)/admin/integrations/page.tsx');
const settingsPage = read('apps/web/src/app/(dashboard)/admin/settings/page-client.tsx');
const nextConfig = read('apps/web/next.config.mjs');
const dockerfile = read('docker/web.Dockerfile');
const productionCompose = read('docker-compose.prod.yml');
const extensionSettings = read('extensions/ss-erp/pages/settings.html');
const extensionSettingsScript = read('extensions/ss-erp/pages/settings.js');
const extensionBuild = read('scripts/build-extension-package.mjs');

function validateDeploymentEnv(hostLines) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-deployment-hosts-'));
  const envPath = path.join(directory, '.env');
  fs.writeFileSync(envPath, [
    'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/ss_erp',
    'REDIS_DISABLED=true',
    'JWT_SECRET=0123456789abcdef',
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'RUNTIME_MODE=cloud',
    'NEXT_PUBLIC_RUNTIME_MODE=cloud',
    'LEGAL_PROFILE=cloud-cn',
    'CORS_ORIGIN=https://ss-erp.cn',
    'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.cn',
    'SMS_PROVIDER=',
    ...hostLines,
    '',
  ].join('\n'));
  return spawnSync(process.execPath, [
    'scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', envPath,
  ], { encoding: 'utf8' });
}

test('Web deployment hosts are environment-driven with international fallbacks', () => {
  for (const key of [
    'NEXT_PUBLIC_USER_HOSTNAME',
    'NEXT_PUBLIC_ADMIN_HOSTNAME',
    'NEXT_PUBLIC_MARKETING_HOSTNAME',
  ]) {
    assert.match(deploymentHosts, new RegExp(`process\\.env\\.${key}`));
    assert.match(nextConfig, new RegExp(key));
    assert.match(dockerfile, new RegExp(`ARG ${key}`));
    assert.match(productionCompose, new RegExp(key));
  }
  assert.match(deploymentHosts, /app\.ss-erp\.com/);
  assert.match(deploymentHosts, /admin\.ss-erp\.com/);
  assert.match(deploymentHosts, /marketingHostname: 'ss-erp\.com'/);
});

test('login, download and settings surfaces do not embed an international deployment URL', () => {
  for (const source of [userLogin, adminLogin, downloadPage, integrationsPage, settingsPage, middleware]) {
    assert.doesNotMatch(source, /(?:app|admin)?\.?ss-erp\.com/);
  }
  assert.match(userLogin, /resolveCrossDeploymentHref/);
  assert.match(adminLogin, /resolveCrossDeploymentHref/);
  assert.match(downloadPage, /appHostname \|\| '当前 ERP'/);
});

test('middleware preserves admin paths and marketing routes in a single-domain deployment', () => {
  assert.match(deploymentHosts, /splitAdmin:[\s\S]*adminHostname !== deploymentHosts\.userHostname/);
  assert.match(deploymentHosts, /splitMarketing:[\s\S]*marketingHostname !== deploymentHosts\.userHostname/);
  assert.match(middleware, /deploymentHostMode\.splitAdmin && pathname\.startsWith\('\/admin'\)/);
  assert.match(middleware, /deploymentHostMode\.splitMarketing && MARKETING_HOSTNAMES\.includes/);
});

test('extension settings default is generated from the deployment environment', () => {
  assert.doesNotMatch(extensionSettings, /ss-erp\.com/);
  assert.match(extensionSettings, /deployment-defaults\.js/);
  assert.match(extensionSettingsScript, /SS_ERP_DEPLOYMENT_DEFAULTS/);
  assert.match(extensionBuild, /process\.env\.NEXT_PUBLIC_USER_HOSTNAME/);
  assert.match(extensionBuild, /process\.env\.NEXT_PUBLIC_API_BASE_URL/);
  assert.match(extensionBuild, /https:\/\/app\.ss-erp\.com/);
});

test('deployment validation accepts a complete host set or no host overrides', () => {
  const complete = validateDeploymentEnv([
    'NEXT_PUBLIC_USER_HOSTNAME=app.ss-erp.cn',
    'NEXT_PUBLIC_ADMIN_HOSTNAME=admin.ss-erp.cn',
    'NEXT_PUBLIC_MARKETING_HOSTNAME=ss-erp.cn',
  ]);
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`);

  const defaults = validateDeploymentEnv([]);
  assert.equal(defaults.status, 0, `${defaults.stdout}\n${defaults.stderr}`);
});

test('deployment validation rejects partial or URL-shaped host overrides', () => {
  const partial = validateDeploymentEnv([
    'NEXT_PUBLIC_USER_HOSTNAME=app.ss-erp.cn',
    'NEXT_PUBLIC_ADMIN_HOSTNAME=admin.ss-erp.cn',
  ]);
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /must be configured together or all left empty/);

  const urlShaped = validateDeploymentEnv([
    'NEXT_PUBLIC_USER_HOSTNAME=https://app.ss-erp.cn',
    'NEXT_PUBLIC_ADMIN_HOSTNAME=admin.ss-erp.cn',
    'NEXT_PUBLIC_MARKETING_HOSTNAME=ss-erp.cn',
  ]);
  assert.notEqual(urlShaped.status, 0);
  assert.match(urlShaped.stderr, /must be a hostname without a scheme/);
});
