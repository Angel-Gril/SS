import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { EXTENSION_DONOR_WORKBENCH_WEB_RESOURCE_MATCHES } from './extension-release-contract.mjs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

const deploymentHosts = read('apps/web/src/lib/deployment-hosts.ts');
const middleware = read('apps/web/src/middleware.ts');
const dashboardLayout = read('apps/web/src/app/(dashboard)/layout.tsx');
const api = read('apps/web/src/lib/api.ts');
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
    'DEPLOY_DATABASE_ID=test-primary',
    'DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy',
    'REDIS_DISABLED=true',
    'JWT_SECRET=0123456789abcdef',
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'RUNTIME_MODE=cloud',
    'NEXT_PUBLIC_RUNTIME_MODE=cloud',
    'LEGAL_PROFILE=cloud-cn',
    'CORS_ORIGIN=https://ss-erp.cn',
    'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.cn',
    'EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN=https://app.ss-erp.cn',
    'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN=https://admin.ss-erp.cn',
    'EXTENSION_RELEASE_EXPECTED_API_ORIGIN=https://ss-erp.cn',
    'EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN=http://127.0.0.1:3001',
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
  assert.match(downloadPage, /resolvePublicApiOrigin/);
  assert.match(integrationsPage, /apiUrl\(/);
  assert.doesNotMatch(downloadPage, /Chrome Web Store|商店安装/u);
});

test('middleware preserves admin paths and marketing routes in a single-domain deployment', () => {
  assert.match(deploymentHosts, /splitAdmin:[\s\S]*adminHostname !== deploymentHosts\.userHostname/);
  assert.match(deploymentHosts, /splitMarketing:[\s\S]*marketingHostname !== deploymentHosts\.userHostname/);
  assert.match(middleware, /deploymentHostMode\.splitAdmin && pathname\.startsWith\('\/admin'\)/);
  assert.match(middleware, /deploymentHostMode\.splitMarketing && MARKETING_HOSTNAMES\.includes/);
});

test('middleware keeps the ERP homepage and canonical login hosts separated', () => {
  const result = spawnSync(process.execPath, [
    'apps/server/node_modules/tsx/dist/cli.mjs',
    'apps/web/scripts/middleware-routing-contract.ts',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: 'apps/web/tsconfig.json',
      NEXT_PUBLIC_USER_HOSTNAME: 'app.ss-erp.cn',
      NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.ss-erp.cn',
      NEXT_PUBLIC_MARKETING_HOSTNAME: 'ss-erp.cn',
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /PASS Web middleware routing contract/);
  assert.match(
    api,
    /function redirectToLoginForCurrentPath[\s\S]*path\.startsWith\('\/admin'\)[\s\S]*\? '\/admin\/login'[\s\S]*: '\/login';/,
  );
  assert.match(dashboardLayout, /loadDashboardSession\(\{ signal: controller\.signal \}\)/u);
  assert.doesNotMatch(dashboardLayout, /pathname === '\/'[\s\S]{0,80}'\/landing'/);
});

test('extension settings default is generated from the deployment environment', () => {
  assert.doesNotMatch(extensionSettings, /ss-erp\.com/);
  assert.match(extensionSettings, /deployment-defaults\.js/);
  assert.match(extensionSettingsScript, /SS_ERP_DEPLOYMENT_DEFAULTS/);
  assert.match(extensionBuild, /process\.env\.NEXT_PUBLIC_USER_HOSTNAME/);
  assert.match(extensionBuild, /process\.env\.NEXT_PUBLIC_ADMIN_HOSTNAME/);
  assert.match(extensionBuild, /process\.env\.NEXT_PUBLIC_API_BASE_URL/);
  assert.match(extensionBuild, /https:\/\/app\.ss-erp\.com/);
});

test('cloud extension packages keep Web navigation and API claim origins separate', () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-origins-'));
  const result = spawnSync(process.execPath, [
    'scripts/build-extension-package.mjs', 'cloud',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_OUT_DIR: outRoot,
      EXTENSION_CLOUD_BASE_URL: 'https://app.ss-erp.cn',
      NEXT_PUBLIC_USER_HOSTNAME: 'app.ss-erp.cn',
      NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.ss-erp.cn',
      NEXT_PUBLIC_API_BASE_URL: 'https://ss-erp.cn',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const defaults = read(path.join(
    outRoot,
    'ss-erp-cloud/shared/erp-adapter/deployment-defaults.js',
  ));
  assert.match(defaults, /erpBaseUrl: "https:\/\/app\.ss-erp\.cn"/);
  assert.match(defaults, /erpAdminBaseUrl: "https:\/\/admin\.ss-erp\.cn"/);
  assert.match(defaults, /erpApiBaseUrl: "https:\/\/ss-erp\.cn"/);
});

test('cloud extension packaging rejects mixed SS ERP roots without blocking custom or local origins', () => {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-root-pinning-'));
  const build = (buildTarget, env) => spawnSync(process.execPath, [
    'scripts/build-extension-package.mjs', buildTarget,
  ], {
    encoding: 'utf8',
    env: { ...process.env, EXTENSION_OUT_DIR: outRoot, ...env },
  });

  const international = build('cloud', {
    EXTENSION_CLOUD_BASE_URL: 'https://app.ss-erp.com',
    NEXT_PUBLIC_USER_HOSTNAME: 'app.ss-erp.com',
    NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.ss-erp.com',
    NEXT_PUBLIC_API_BASE_URL: 'https://ss-erp.com',
  });
  assert.equal(international.status, 0, `${international.stdout}\n${international.stderr}`);

  const mixed = build('cloud', {
    EXTENSION_CLOUD_BASE_URL: 'https://app.ss-erp.cn',
    NEXT_PUBLIC_USER_HOSTNAME: 'app.ss-erp.cn',
    NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.ss-erp.cn',
    NEXT_PUBLIC_API_BASE_URL: 'https://ss-erp.com',
  });
  assert.notEqual(mixed.status, 0);
  assert.match(mixed.stderr, /must use the same SS ERP deployment root/);

  const insecure = build('cloud', {
    EXTENSION_CLOUD_BASE_URL: 'https://app.ss-erp.com',
    NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.ss-erp.com',
    NEXT_PUBLIC_API_BASE_URL: 'http://ss-erp.com',
  });
  assert.notEqual(insecure.status, 0);
  assert.match(insecure.stderr, /API URL must use HTTPS/);

  const custom = build('cloud', {
    EXTENSION_CLOUD_BASE_URL: 'https://erp.internal.example',
    NEXT_PUBLIC_USER_HOSTNAME: 'erp.internal.example',
    NEXT_PUBLIC_ADMIN_HOSTNAME: 'admin.internal.example',
    NEXT_PUBLIC_API_BASE_URL: 'https://api.internal.example',
  });
  assert.equal(custom.status, 0, `${custom.stdout}\n${custom.stderr}`);
  const customPackageDir = path.join(outRoot, 'ss-erp-cloud');
  const customManifest = JSON.parse(read(path.join(customPackageDir, 'manifest.json')));
  const customErpBridge = customManifest.content_scripts.find((entry) =>
    entry.js.includes('content/erp-collect-bridge.js'));
  const customDonorResources = customManifest.web_accessible_resources.find((group) =>
    group.resources.includes('pages/source-workbench-shell.html'));
  assert.ok(customErpBridge);
  assert.deepEqual(
    customDonorResources?.matches,
    [...EXTENSION_DONOR_WORKBENCH_WEB_RESOURCE_MATCHES],
  );
  for (const match of [
    'https://erp.internal.example/*',
    'https://admin.internal.example/*',
  ]) {
    assert.ok(customManifest.externally_connectable.matches.includes(match));
    assert.ok(customErpBridge.matches.includes(match));
    assert.ok(customManifest.web_accessible_resources
      .filter((group) => group !== customDonorResources)
      .every((group) => group.matches.includes(match)));
  }
  assert.ok(customManifest.host_permissions.includes('https://api.internal.example/*'));
  assert.equal(JSON.stringify(customManifest).includes('*.internal.example'), false);
  const strictVerify = spawnSync(process.execPath, ['scripts/verify-extension-package.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      EXTENSION_DIR: customPackageDir,
      STRICT_EXTENSION_CHECK: '1',
    },
  });
  assert.equal(strictVerify.status, 0, `${strictVerify.stdout}\n${strictVerify.stderr}`);

  const local = build('local', {
    EXTENSION_LOCAL_BASE_URL: 'http://127.0.0.1:3001',
  });
  assert.equal(local.status, 0, `${local.stdout}\n${local.stderr}`);
  const localManifest = JSON.parse(read(path.join(outRoot, 'ss-erp-local/manifest.json')));
  const localDonorResources = localManifest.web_accessible_resources.find((group) =>
    group.resources.includes('pages/source-workbench-shell.html'));
  assert.deepEqual(
    localDonorResources?.matches,
    [...EXTENSION_DONOR_WORKBENCH_WEB_RESOURCE_MATCHES],
  );
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
