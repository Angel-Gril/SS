import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const settings = readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);
const productionEnv = readFileSync('.env.production.example', 'utf8');
const stagingEnv = readFileSync('.env.staging.example', 'utf8');
const envValidator = readFileSync('scripts/validate-env.mjs', 'utf8');
const preflight = readFileSync('scripts/preflight.mjs', 'utf8');
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');

function arrayBlock(name) {
  const match = settings.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} must exist`);
  return match[1];
}

const generalKeys = arrayBlock('AUTH_SMS_POLICY_KEYS');
for (const key of [
  'auth_sms_daily_per_phone_limit',
  'auth_sms_daily_per_ip_limit',
  'auth_sms_daily_global_limit',
]) {
  assert.match(generalKeys, new RegExp(`'${key}'`), `${key} must be saved with SMS security settings`);
  assert.match(
    settings,
    new RegExp(`cfg=\\{configs\\.${key}\\}[\\s\\S]{0,180}type="number"`),
    `${key} must use a numeric admin control`,
  );
}

assert.match(settings, /短信每日额度与费用熔断/);
assert.match(settings, /阿里云、腾讯云还是 env/);
assert.match(settings, /Asia\/Shanghai 自然日/);
assert.match(settings, /全局额度按当前 Redis 实例统计/);
assert.match(settings, /保存短信开关与安全策略/);

const turnstileKeys = arrayBlock('AUTH_TURNSTILE_KEYS');
assert.match(
  turnstileKeys,
  /'auth_turnstile_allowed_hostnames'/,
  'the hostname allowlist must be saved with Turnstile settings',
);
assert.match(settings, /cfg=\{configs\.auth_turnstile_allowed_hostnames\}/);
assert.match(settings, /example\.com,www\.example\.com/);
assert.match(settings, /英文逗号分隔精确 hostname/);
assert.match(settings, /不要填写 https:\/\//);
assert.match(settings, /留空或配置非法时 Turnstile 会拒绝通过/);

assert.match(settings, /HUMAN_CHALLENGE_PROVIDER \/ TURNSTILE_\*/);
assert.match(settings, /环境变量优先于后台配置/);
assert.doesNotMatch(
  settings,
  /cfg=\{configs\.feature_turnstile_login\}/,
  'the legacy Turnstile flag must not appear as a second independent switch',
);

for (const envExample of [productionEnv, stagingEnv]) {
  assert.match(envExample, /^HUMAN_CHALLENGE_PROVIDER=/m);
  assert.match(envExample, /^TURNSTILE_ALLOWED_HOSTNAMES=.+/m);
}
assert.match(envValidator, /validateHumanChallenge/);
assert.match(envValidator, /TURNSTILE_ALLOWED_HOSTNAMES contains invalid hostname/);
assert.match(preflight, /scripts\/web-auth-security-settings\.test\.mjs/);
assert.match(ciWorkflow, /node scripts\/web-auth-security-settings\.test\.mjs/);
assert.match(ciWorkflow, /pnpm --filter server test:sms-quota:redis/);

const tempDir = mkdtempSync(join(tmpdir(), 'ss-erp-human-challenge-'));
const commonEnv = [
  'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
  'REDIS_URL=redis://127.0.0.1:6379',
  'JWT_SECRET=0123456789abcdef',
  'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
  'RUNTIME_MODE=cloud',
  'NEXT_PUBLIC_RUNTIME_MODE=cloud',
  'LEGAL_PROFILE=cloud-global',
  'NEXT_PUBLIC_API_BASE_URL=https://app.ss-erp.com',
  'CORS_ORIGIN=https://app.ss-erp.com',
  'HUMAN_CHALLENGE_PROVIDER=cloudflare-turnstile',
  'TURNSTILE_SECRET_KEY=test-secret-key',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY=test-site-key',
];

function validate(lines) {
  const envPath = join(tempDir, `.env-${Math.random().toString(16).slice(2)}`);
  writeFileSync(envPath, `${lines.join('\n')}\n`);
  return spawnSync(process.execPath, [
    'scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', envPath,
  ], { encoding: 'utf8' });
}

const validTurnstile = validate([
  ...commonEnv,
  'TURNSTILE_ALLOWED_HOSTNAMES=ss-erp.com,app.ss-erp.com',
]);
assert.equal(validTurnstile.status, 0, validTurnstile.stderr);

const missingHostnames = validate(commonEnv);
assert.notEqual(missingHostnames.status, 0);
assert.match(missingHostnames.stderr, /TURNSTILE_ALLOWED_HOSTNAMES is required/);

const wildcardHostnames = validate([
  ...commonEnv,
  'TURNSTILE_ALLOWED_HOSTNAMES=*.ss-erp.com',
]);
assert.notEqual(wildcardHostnames.status, 0);
assert.match(wildcardHostnames.stderr, /contains invalid hostname/);

const legacyTurnstileWithoutHostnames = validate([
  ...commonEnv.filter((line) => !line.startsWith('HUMAN_CHALLENGE_PROVIDER=')),
  'FEATURE_TURNSTILE_LOGIN=true',
]);
assert.notEqual(legacyTurnstileWithoutHostnames.status, 0);
assert.match(legacyTurnstileWithoutHostnames.stderr, /TURNSTILE_ALLOWED_HOSTNAMES is required/);

console.log('PASS web auth security settings contract');
