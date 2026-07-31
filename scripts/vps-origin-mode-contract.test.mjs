import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const verifier = readFileSync(new URL('./verify-vps-deploy.sh', import.meta.url), 'utf8');
const directNginx = readFileSync(
  new URL('../docker/nginx/ss-erp-cn-direct.conf', import.meta.url),
  'utf8',
);
const cloudflareNginx = readFileSync(
  new URL('../docker/nginx/ss-erp.conf', import.meta.url),
  'utf8',
);
const serverEntrypoint = readFileSync(
  new URL('../apps/server/src/index.ts', import.meta.url),
  'utf8',
);

function bashExecutable() {
  if (process.platform !== 'win32') return 'bash';
  const candidates = [
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'bash.exe'),
  ];
  return candidates.find(existsSync) || 'bash';
}

function extractFunction(name) {
  const match = new RegExp(
    `^${name}\\(\\) \\{[\\s\\S]*?^\\}(?=\\r?\\n(?:\\r?\\n[A-Za-z_][A-Za-z0-9_]*\\(\\) \\{|\\s*$))`,
    'mu',
  ).exec(verifier);
  assert.ok(match, `shell function is missing: ${name}`);
  return match[0].replace(/\r/gu, '');
}

function runShell(script, ...args) {
  return spawnSync(bashExecutable(), ['-c', script, 'contract', ...args], {
    encoding: 'utf8',
  });
}

function runVerifier(env) {
  return spawnSync(bashExecutable(), ['scripts/verify-vps-deploy.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      VERIFY_DOMAIN: '',
      VERIFY_PUBLIC_BASE_URL: '',
      ...env,
    },
  });
}

test('direct-origin Nginx template terminates HTTPS without Cloudflare coupling', () => {
  assert.match(
    directNginx,
    /server_name ss-erp\.cn www\.ss-erp\.cn app\.ss-erp\.cn admin\.ss-erp\.cn;/u,
  );
  assert.match(directNginx, /listen 80;/u);
  assert.match(directNginx, /listen 80 default_server;/u);
  assert.match(directNginx, /server_name _;[\s\S]*?return 444;/u);
  assert.match(directNginx, /return 301 https:\/\/\$host\$request_uri;/u);
  assert.match(directNginx, /listen 443 ssl;/u);
  assert.match(directNginx, /listen 443 ssl default_server;/u);
  assert.match(directNginx, /http2 on;/u);
  assert.match(
    directNginx,
    /ssl_certificate \/etc\/ssl\/certs\/ss-erp\.cn\.fullchain\.pem;/u,
  );
  assert.match(
    directNginx,
    /ssl_certificate_key \/etc\/ssl\/private\/ss-erp\.cn\.key;/u,
  );
  assert.match(directNginx, /location \^~ \/\.well-known\/acme-challenge\//u);
  assert.match(directNginx, /root \/var\/www\/acme-challenge;/u);
  assert.match(directNginx, /ssl_protocols TLSv1\.2 TLSv1\.3;/u);
  assert.match(directNginx, /Strict-Transport-Security/u);
  assert.match(directNginx, /server 127\.0\.0\.1:3000;/u);
  assert.match(directNginx, /server 127\.0\.0\.1:3001;/u);
  assert.match(directNginx, /location = \/ready/u);
  assert.match(directNginx, /location \/api\//u);
  assert.match(directNginx, /location \/cdn\//u);
  assert.match(directNginx, /proxy_set_header X-Forwarded-Proto \$scheme;/u);
  assert.doesNotMatch(directNginx, /cloudflare-realip|CF-Connecting-IP|is_cloudflare/u);
});

test('origin mode accepts only the two supported deployment policies', () => {
  assert.ok(verifier.includes(
    'VERIFY_ORIGIN_MODE="${VERIFY_ORIGIN_MODE:-cloudflare}"',
  ));
  const fn = extractFunction('validate_origin_mode');
  for (const mode of ['cloudflare', 'direct']) {
    const result = runShell(`${fn}\nvalidate_origin_mode "$1"`, mode);
    assert.equal(result.status, 0, result.stderr);
  }

  const invalid = runShell(`${fn}\nvalidate_origin_mode "$1"`, 'proxy');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /VERIFY_ORIGIN_MODE must be cloudflare or direct/u);

  const wiredInvalid = runVerifier({
    VERIFY_ORIGIN_MODE: 'proxy',
    VERIFY_READY_URL: 'https://ss-erp.cn/ready',
  });
  assert.notEqual(wiredInvalid.status, 0);
  assert.match(wiredInvalid.stderr, /VERIFY_ORIGIN_MODE must be cloudflare or direct/u);
});

test('PostgreSQL verification distinguishes local and external database topologies', () => {
  assert.ok(
    verifier.includes('VERIFY_EXPECT_LOCAL_POSTGRES="${VERIFY_EXPECT_LOCAL_POSTGRES:-true}"'),
  );
  const validateFn = extractFunction('validate_boolean_setting');
  for (const value of ['true', 'false']) {
    const result = runShell(
      `${validateFn}\nvalidate_boolean_setting VERIFY_EXPECT_LOCAL_POSTGRES "$1"`,
      value,
    );
    assert.equal(result.status, 0, result.stderr);
  }
  const invalid = runShell(
    `${validateFn}\nvalidate_boolean_setting VERIFY_EXPECT_LOCAL_POSTGRES "$1"`,
    'external',
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /must be true or false/u);

  const absentFn = extractFunction('check_port_absent');
  const topologyFn = extractFunction('check_postgres_topology');
  const prelude = `
FAILURES=0
FAKE_SS_MODE="$1"
pass() { printf 'PASS %s\\n' "$1"; }
fail() { FAILURES=$((FAILURES + 1)); printf 'FAIL %s\\n' "$1"; }
check_service() { printf 'SERVICE %s\\n' "$1"; }
check_port_loopback() { printf 'LOOPBACK %s %s\\n' "$1" "$2"; }
ss() {
  if [ "$#" -ne 3 ]; then return 64; fi
  if [ "$1" != "-H" ] || [ "$2" != "-ltn" ] || [ "$3" != "sport = :5432" ]; then
    return 64
  fi
  case "$FAKE_SS_MODE" in
    absent) return 0 ;;
    listening) printf 'LISTEN 0 244 127.0.0.1:5432 0.0.0.0:*\\n' ;;
    error) return 42 ;;
    *) return 65 ;;
  esac
}
`;
  const runTopology = (expectLocalPostgres, fakeSsMode) => runShell(`
${prelude}
${absentFn}
${topologyFn}
VERIFY_EXPECT_LOCAL_POSTGRES=${expectLocalPostgres}
check_postgres_topology
printf 'FAILURES=%s\\n' "$FAILURES"
[ "$FAILURES" -eq 0 ]
`, fakeSsMode);

  const local = runTopology(true, 'absent');
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /SERVICE postgresql/u);
  assert.match(local.stdout, /LOOPBACK 5432 postgres/u);
  assert.match(local.stdout, /FAILURES=0/u);
  assert.doesNotMatch(local.stdout, /not listening \(external service expected\)/u);

  const externalWithoutListener = runTopology(false, 'absent');
  assert.equal(externalWithoutListener.status, 0, externalWithoutListener.stderr);
  assert.match(externalWithoutListener.stdout, /external postgres expected/u);
  assert.match(
    externalWithoutListener.stdout,
    /PASS postgres port 5432 not listening \(external service expected\)/u,
  );
  assert.match(externalWithoutListener.stdout, /FAILURES=0/u);
  assert.doesNotMatch(externalWithoutListener.stdout, /SERVICE postgresql|LOOPBACK/u);

  const externalWithListener = runTopology(false, 'listening');
  assert.notEqual(externalWithListener.status, 0);
  assert.match(
    externalWithListener.stdout,
    /FAIL postgres port 5432 must not listen when an external service is expected: 127\.0\.0\.1:5432/u,
  );
  assert.match(externalWithListener.stdout, /FAILURES=1/u);

  const externalQueryError = runTopology(false, 'error');
  assert.notEqual(externalQueryError.status, 0);
  assert.match(
    externalQueryError.stdout,
    /FAIL postgres port 5432 check failed: ss query failed/u,
  );
  assert.match(externalQueryError.stdout, /FAILURES=1/u);
  assert.doesNotMatch(
    externalQueryError.stdout,
    /postgres port 5432 not listening/u,
  );

  const restoreFn = extractFunction('check_no_restore_temp_db');
  const restorePrelude = `
pass() { printf 'PASS %s\\n' "$1"; }
warn() { printf 'WARN %s\\n' "$1"; }
fail() { printf 'FAIL %s\\n' "$1"; }
`;
  const runRestoreCheck = (expectLocalPostgres) => runShell(`
${restorePrelude}
${restoreFn}
PATH=/nonexistent
VERIFY_EXPECT_LOCAL_POSTGRES=${expectLocalPostgres}
check_no_restore_temp_db
`);
  const externalRestoreCheck = runRestoreCheck(false);
  assert.equal(externalRestoreCheck.status, 0, externalRestoreCheck.stderr);
  assert.equal(
    externalRestoreCheck.stdout.trim(),
    'PASS local restore temp DB check skipped (external postgres expected)',
  );
  const localRestoreCheck = runRestoreCheck(true);
  assert.equal(localRestoreCheck.status, 0, localRestoreCheck.stderr);
  assert.equal(
    localRestoreCheck.stdout.trim(),
    'WARN cannot check restore temp DBs without local postgres user',
  );
  assert.match(
    verifier,
    /check_service nginx\r?\ncheck_postgres_topology\r?\ncheck_service redis-server/u,
  );
  assert.doesNotMatch(verifier, /\r?\ncheck_port_loopback 5432 postgres\r?\n/u);
});

test('client IP forwarding trusts only the nearest Nginx hop', () => {
  assert.match(serverEntrypoint, /trustProxy: process\.env\.NODE_ENV === 'production' \? 1 : false/u);
  for (const nginxConfig of [cloudflareNginx, directNginx]) {
    assert.match(nginxConfig, /proxy_set_header X-Forwarded-For \$remote_addr;/u);
    assert.doesNotMatch(nginxConfig, /proxy_add_x_forwarded_for/u);
  }
  const activeForwardingCheck = extractFunction('check_proxy_ip_forwarding');
  assert.match(activeForwardingCheck, /nginx -T/u);
  assert.ok(activeForwardingCheck.includes('proxy_set_header X-Forwarded-For \\$remote_addr;'));
  assert.ok(activeForwardingCheck.includes('proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;'));
  assert.match(verifier, /check_ufw\r?\ncheck_proxy_ip_forwarding\r?\ncheck_origin_security/u);
});

test('direct hostnames are explicit, normalized, bounded, and validated', () => {
  assert.ok(verifier.includes(
    'VERIFY_DIRECT_HOSTNAMES="${VERIFY_DIRECT_HOSTNAMES:-}"',
  ));
  const validFn = extractFunction('is_valid_direct_hostname');
  const loadFn = extractFunction('load_direct_hostnames');
  const script = `
${validFn}
${loadFn}
VERIFY_ORIGIN_MODE=direct
VERIFY_DIRECT_HOSTNAMES="$1"
DIRECT_HOSTNAMES=()
load_direct_hostnames && printf '%s\\n' "${'${DIRECT_HOSTNAMES[*]}'}"
`;
  const valid = runShell(
    script,
    ' ss-erp.cn,WWW.ss-erp.cn,app.ss-erp.cn,ss-erp.cn ',
  );
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stderr, '');
  assert.equal(valid.stdout.trim(), 'ss-erp.cn www.ss-erp.cn app.ss-erp.cn');

  for (const invalidList of [
    '',
    'https://ss-erp.cn',
    '*.ss-erp.cn',
    '127.0.0.1',
    '-bad.ss-erp.cn',
    'bad..ss-erp.cn',
  ]) {
    const invalid = runShell(script, invalidList);
    assert.notEqual(invalid.status, 0, `invalid hostname list passed: ${invalidList}`);
    assert.match(invalid.stderr, /VERIFY_DIRECT_HOSTNAMES is required|invalid direct hostname/u);
  }

  const readyFn = extractFunction('validate_direct_ready_hostname');
  const readyScript = `
${readyFn}
VERIFY_ORIGIN_MODE=direct
DIRECT_HOSTNAMES=(ss-erp.cn app.ss-erp.cn)
validate_direct_ready_hostname "$1"
`;
  const knownReady = runShell(readyScript, 'app.ss-erp.cn');
  assert.equal(knownReady.status, 0, knownReady.stderr);
  const unknownReady = runShell(readyScript, 'admin.ss-erp.cn');
  assert.notEqual(unknownReady.status, 0);
  assert.match(unknownReady.stderr, /not in VERIFY_DIRECT_HOSTNAMES/u);
});

test('direct mode requires an HTTPS public readiness target', () => {
  const fn = extractFunction('validate_ready_protocol');
  const https = runShell(`${fn}\nvalidate_ready_protocol "$1" "$2"`, 'direct', 'https:');
  assert.equal(https.status, 0, https.stderr);

  const http = runShell(`${fn}\nvalidate_ready_protocol "$1" "$2"`, 'direct', 'http:');
  assert.notEqual(http.status, 0);
  assert.match(http.stderr, /direct origin verification requires an HTTPS/u);

  const legacyCloudflareHttp = runShell(
    `${fn}\nvalidate_ready_protocol "$1" "$2"`,
    'cloudflare',
    'http:',
  );
  assert.equal(legacyCloudflareHttp.status, 0, legacyCloudflareHttp.stderr);

  const wiredHttp = runVerifier({
    VERIFY_ORIGIN_MODE: 'direct',
    VERIFY_DIRECT_HOSTNAMES: 'ss-erp.cn',
    VERIFY_READY_URL: 'http://ss-erp.cn/ready',
  });
  assert.notEqual(wiredHttp.status, 0);
  assert.match(wiredHttp.stderr, /direct origin verification requires an HTTPS/u);
});

test('origin mode dispatches to the selected security and renewal policy', () => {
  const originFn = extractFunction('check_origin_security');
  const cronFn = extractFunction('check_cloudflare_ip_update_cron');
  const acmeFn = extractFunction('check_acme_sh_renewal');
  const prelude = `
pass() { printf 'PASS %s\\n' "$1"; }
warn() { printf 'WARN %s\\n' "$1"; }
fail() { printf 'FAIL %s\\n' "$1"; }
check_cloudflare_origin_guard() { printf 'CF_GUARD_CALLED\\n'; }
check_direct_origin_security() { printf 'DIRECT_GUARD_CALLED\\n'; }
`;

  const directOrigin = runShell(
    `${prelude}\n${originFn}\nVERIFY_ORIGIN_MODE="$1"\ncheck_origin_security`,
    'direct',
  );
  assert.equal(directOrigin.status, 0, directOrigin.stderr);
  assert.match(directOrigin.stdout, /DIRECT_GUARD_CALLED/u);
  assert.doesNotMatch(directOrigin.stdout, /CF_GUARD_CALLED/u);

  const cloudflareOrigin = runShell(
    `${prelude}\n${originFn}\nVERIFY_ORIGIN_MODE="$1"\ncheck_origin_security`,
    'cloudflare',
  );
  assert.equal(cloudflareOrigin.status, 0, cloudflareOrigin.stderr);
  assert.match(cloudflareOrigin.stdout, /CF_GUARD_CALLED/u);

  const cloudflareCron = runShell(
    `${prelude}\n${cronFn}\nVERIFY_ORIGIN_MODE="$1"\ncheck_cloudflare_ip_update_cron "$2"`,
    'cloudflare',
    '',
  );
  assert.equal(cloudflareCron.status, 0, cloudflareCron.stderr);
  assert.match(cloudflareCron.stdout, /WARN cron missing Cloudflare IP update/u);

  const acmeCron = runShell(
    `${prelude}\nsystemctl() { return 1; }\n${acmeFn}\ncheck_acme_sh_renewal "$1"`,
    '44 5,11,17,23 * * * "/root/.acme.sh"/acme.sh --cron --home "/root/.acme.sh"',
  );
  assert.equal(acmeCron.status, 0, acmeCron.stderr);
  assert.match(acmeCron.stdout, /PASS cron includes acme\.sh certificate renewal/u);

  const missingAcme = runShell(
    `${prelude}\nsystemctl() { return 1; }\n${acmeFn}\ncheck_acme_sh_renewal "$1"`,
    '',
  );
  assert.equal(missingAcme.status, 0, missingAcme.stderr);
  assert.match(missingAcme.stdout, /FAIL direct-origin mode requires an acme\.sh/u);

  const commentedAcme = runShell(
    `${prelude}\nsystemctl() { return 1; }\n${acmeFn}\ncheck_acme_sh_renewal "$1"`,
    '# /root/.acme.sh/acme.sh --cron',
  );
  assert.equal(commentedAcme.status, 0, commentedAcme.stderr);
  assert.match(commentedAcme.stdout, /FAIL direct-origin mode requires an acme\.sh/u);

  const timerAcme = runShell(`
${prelude}
systemctl() {
  if [ "$1" = "list-timers" ]; then
    printf 'n/a n/a n/a n/a acme-renew.timer acme-renew.service\\n'
  elif [ "$1" = "show" ]; then
    printf '{ path=/root/.acme.sh/acme.sh ; argv[]=/root/.acme.sh/acme.sh --cron ; }\\n'
  fi
}
${acmeFn}
check_acme_sh_renewal ''
`);
  assert.equal(timerAcme.status, 0, timerAcme.stderr);
  assert.match(timerAcme.stdout, /PASS systemd timer activates acme\.sh/u);
});

test('direct security probes active Nginx, host routing, ACME, and default rejection', () => {
  const directSecurity = extractFunction('check_direct_origin_security');
  const rejectedHost = extractFunction('check_direct_rejected_host');
  const publicHosts = extractFunction('check_direct_public_hosts');

  assert.match(directSecurity, /nginx -T/u);
  assert.match(directSecurity, /location \^~ \/\.well-known\/acme-challenge\//u);
  assert.match(directSecurity, /http:\/\/127\.0\.0\.1\/ready/u);
  assert.match(directSecurity, /ACME HTTP-01 path is served without redirect/u);
  assert.match(directSecurity, /check_direct_rejected_host http/u);
  assert.match(directSecurity, /check_direct_rejected_host https/u);
  assert.match(rejectedHost, /verify-rejected-host\.invalid/u);
  assert.match(rejectedHost, /--resolve/u);
  assert.match(rejectedHost, /--insecure/u);
  assert.match(publicHosts, /https:\/\/\$\{hostname\}\/ready/u);
  assert.match(publicHosts, /check_http_json_ready/u);
  assert.doesNotMatch(publicHosts, /--insecure|-k/u);
});

test('missing UFW is a deployment failure', () => {
  const ufwFn = extractFunction('check_ufw');
  const result = runShell(`
fail() { printf 'FAIL %s\\n' "$1"; }
warn() { printf 'WARN %s\\n' "$1"; }
${ufwFn}
PATH=/nonexistent
check_ufw
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAIL ufw not installed/u);
  assert.doesNotMatch(result.stdout, /WARN ufw not installed/u);
});

test('origin selection does not bypass common deployment checks', () => {
  for (const requiredCall of [
    'check_public_port 80 nginx',
    'check_public_port 443 nginx',
    'check_ufw',
    'check_http_json_ready "local /ready" "$LOCAL_READY_URL"',
    'check_http_json_ready "public /ready" "$READY_URL"',
  ]) {
    assert.ok(verifier.includes(requiredCall), `missing common verification: ${requiredCall}`);
  }
  assert.match(verifier, /\r?\ncheck_prisma_migrations\r?\n/u);
  assert.match(verifier, /check_ufw\r?\ncheck_proxy_ip_forwarding\r?\ncheck_origin_security/u);
  assert.match(verifier, /check_http_json_ready "public \/ready" "\$READY_URL"\r?\ncheck_direct_public_hosts/u);
});

test('origin contract is wired into local preflight and CI', () => {
  const preflight = readFileSync(new URL('./preflight.mjs', import.meta.url), 'utf8');
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(preflight, /scripts\/vps-origin-mode-contract\.test\.mjs/u);
  assert.match(ci, /node scripts\/vps-origin-mode-contract\.test\.mjs/u);
});

test('local-only backup configuration preserves its four empty remote fields', {
  skip: process.platform === 'win32'
    || typeof process.geteuid !== 'function'
    || process.geteuid() !== 0,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), 'ss-erp-vps-backup-config-'));
  const envFile = join(directory, 'backup.env');
  try {
    writeFileSync(envFile, [
      'BACKUP_LOCAL_DIR=/var/backups/ss-erp',
      'DEPLOY_DATABASE_ID=primary-db',
      '',
    ].join('\n'), { mode: 0o600 });
    chmodSync(envFile, 0o600);
    const loadFn = extractFunction('load_backup_config');
    const result = runShell(`
pass() { :; }
fail() { printf 'FAIL %s\\n' "$1" >&2; return 1; }
${loadFn}
BACKUP_ENV_FILE="$1"
load_backup_config || exit 1
printf '%s|%s|%s|%s|%s|%s' \\
  "$BACKUP_LOCAL_DIR" "$DEPLOY_DATABASE_ID" "$BACKUP_S3_BUCKET" \\
  "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY_ID" "$BACKUP_S3_SECRET_ACCESS_KEY"
`, envFile);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '/var/backups/ss-erp|primary-db||||');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
