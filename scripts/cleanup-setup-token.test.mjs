import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'ss-erp-cleanup-setup-token-'));
const fakeBin = join(root, 'bin');
const deployDir = join(root, 'app');
const tokenFile = join(root, 'initial-token.txt');
const systemctlLog = join(root, 'systemctl.log');
const envFile = join(deployDir, '.env.staging');

const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bashBin = process.platform === 'win32' && existsSync(gitBash)
  ? gitBash
  : 'bash';

function toBashPath(value) {
  const normalized = value.replace(/\\/g, '/');
  return normalized.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
}

function writeExecutable(path, content) {
  writeFileSync(path, content.replace(/^\n/, ''));
  chmodSync(path, 0o755);
}

await import('node:fs/promises').then(async (fs) => {
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.mkdir(deployDir, { recursive: true });
});

writeExecutable(join(fakeBin, 'curl'), `
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$SS_ERP_TEST_SETUP_STATUS_JSON"
`);

writeExecutable(join(fakeBin, 'systemctl'), `
#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$SS_ERP_TEST_SYSTEMCTL_LOG"
`);

function runCleanup(statusJson) {
  const bashPath = `${toBashPath(fakeBin)}:${toBashPath(dirname(process.execPath))}:/usr/bin:/bin`;
  return spawnSync(bashBin, ['scripts/cleanup-setup-token.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      PATH: bashPath,
      HOME: toBashPath(root),
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      DEPLOY_DIR: toBashPath(deployDir),
      ENV_FILE: '.env.staging',
      SETUP_TOKEN_FILE: toBashPath(tokenFile),
      CURL_BIN: toBashPath(join(fakeBin, 'curl')),
      SYSTEMCTL_BIN: toBashPath(join(fakeBin, 'systemctl')),
      API_BASE_URL: 'http://127.0.0.1:3001',
      SS_ERP_TEST_SETUP_STATUS_JSON: JSON.stringify(statusJson),
      SS_ERP_TEST_SYSTEMCTL_LOG: toBashPath(systemctlLog),
    },
  });
}

writeFileSync(envFile, 'NODE_ENV=production\nSETUP_TOKEN=secret-before-admin\nRUNTIME_MODE=cloud\n');
writeFileSync(tokenFile, 'SETUP_TOKEN=secret-before-admin\n');

const blocked = runCleanup({ code: 1, data: { needsSetup: true, hasAdmin: false } });
assert.notEqual(blocked.status, 0, 'cleanup must refuse to run before the first admin exists');
assert.match(`${blocked.stdout}\n${blocked.stderr}`, /hasAdmin=true/, 'failure should explain that an admin is required');
assert.match(readFileSync(envFile, 'utf8'), /^SETUP_TOKEN=secret-before-admin$/m);
assert.equal(existsSync(tokenFile), true, 'token sidecar should remain when cleanup is refused');
assert.equal(existsSync(systemctlLog), false, 'services must not restart when cleanup is refused');

writeFileSync(envFile, [
  'NODE_ENV=production',
  'SETUP_TOKEN=secret-after-admin',
  'export SETUP_TOKEN=legacy-export',
  'RUNTIME_MODE=cloud',
  '',
].join('\n'));
writeFileSync(tokenFile, 'SETUP_TOKEN=secret-after-admin\n');

const cleaned = runCleanup({ code: 1, data: { needsSetup: false, hasAdmin: true } });
assert.equal(cleaned.status, 0, `${cleaned.stdout}\n${cleaned.stderr}`);
assert.doesNotMatch(readFileSync(envFile, 'utf8'), /SETUP_TOKEN=/, 'env file should no longer contain SETUP_TOKEN');
assert.equal(existsSync(tokenFile), false, 'initial setup token sidecar should be removed');
assert.match(readFileSync(systemctlLog, 'utf8'), /restart ss-erp-api ss-erp-web/);
assert.ok(
  readdirSync(deployDir).some((name) => name.startsWith('.env.staging.bak.cleanup-setup-')),
  'cleanup should backup env before editing',
);

console.log('PASS cleanup setup token script');
