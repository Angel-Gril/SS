import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const schema = readFileSync('apps/server/src/config/system-config-schema.ts', 'utf8');
const authConfig = readFileSync('apps/server/src/lib/auth-challenge-config.ts', 'utf8');
const providerFactory = readFileSync('apps/server/src/lib/sms/index.ts', 'utf8');
const adminSettings = readFileSync('apps/web/src/app/(dashboard)/admin/settings/page-client.tsx', 'utf8');
const productionEnv = readFileSync('.env.production.example', 'utf8');

assert.match(schema, /auth_sms_provider: z\.enum\(\['env', 'console', 'tencent', 'aliyun'\]\)/);
assert.match(schema, /feature_sms_login: z\.boolean\(\)\.default\(false\)/);
assert.match(schema, /auth_sms_aliyun_access_key_secret:[\s\S]*sensitive: true,[\s\S]*encrypted: true/);
assert.match(authConfig, /SMS_ALIYUN_ACCESS_KEY_ID/);
assert.match(authConfig, /SMS_ALIYUN_CREDENTIAL_MODE/);
assert.match(authConfig, /ALIBABA_CLOUD_ECS_METADATA/);
assert.match(providerFactory, /aliyun: config\.aliyun/);
assert.match(adminSettings, /AUTH_ALIYUN_KEYS/);
assert.match(adminSettings, /auth_sms_aliyun_credential_mode/);
assert.match(adminSettings, /ecs_ram_role/);
assert.match(adminSettings, /auth_sms_aliyun_register_template_code/);
assert.match(adminSettings, /auth_sms_aliyun_password_reset_template_code/);
assert.match(adminSettings, /auth_sms_aliyun_sms_login_template_code/);
assert.match(adminSettings, /template\.signatureName === selectedAliyunSign/);
assert.match(adminSettings, /cfg=\{configs\.auth_sms_aliyun_access_key_secret\}[\s\S]*type="password"/);
for (const key of [
  'SMS_ALIYUN_ACCESS_KEY_ID',
  'SMS_ALIYUN_ACCESS_KEY_SECRET',
  'SMS_ALIYUN_SIGN_NAME',
  'SMS_ALIYUN_TEMPLATE_CODE',
  'SMS_ALIYUN_TEMPLATE_PARAM_NAME',
  'SMS_ALIYUN_REGISTER_TEMPLATE_CODE',
  'SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME',
  'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE',
  'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME',
  'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE',
  'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME',
  'ALIBABA_CLOUD_IMDSV1_DISABLED',
]) {
  assert.match(productionEnv, new RegExp(`^${key}=`, 'm'));
}

const tempDir = mkdtempSync(join(tmpdir(), 'ss-erp-aliyun-sms-'));
const validEnvPath = join(tempDir, '.env.aliyun');
const common = [
  'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
  'REDIS_URL=redis://127.0.0.1:6379',
  'JWT_SECRET=0123456789abcdef',
  'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
  'RUNTIME_MODE=cloud',
  'NEXT_PUBLIC_RUNTIME_MODE=cloud',
  'LEGAL_PROFILE=cloud-cn',
  'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.cn',
  'CORS_ORIGIN=https://ss-erp.cn',
  'SMS_PROVIDER=aliyun',
  'SMS_ALIYUN_CREDENTIAL_MODE=access_key',
  'SMS_ALIYUN_ACCESS_KEY_ID=test-access-key-id',
  'SMS_ALIYUN_ACCESS_KEY_SECRET=test-access-key-secret',
  'SMS_ALIYUN_SIGN_NAME=test-sign',
  'SMS_ALIYUN_TEMPLATE_CODE=SMS_123456789',
  'SMS_ALIYUN_TEMPLATE_PARAM_NAME=code',
  'SMS_ALIYUN_REGISTER_TEMPLATE_CODE=SMS_REGISTER',
  'SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME=code',
  'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE=SMS_PASSWORD_RESET',
  'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME=code',
  'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE=SMS_LOGIN',
  'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME=code',
];
writeFileSync(validEnvPath, `${common.join('\n')}\n`);

const valid = spawnSync(process.execPath, [
  'scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', validEnvPath,
], { encoding: 'utf8' });
assert.equal(valid.status, 0, `Aliyun cloud env should validate\n${valid.stdout}\n${valid.stderr}`);

const roleEnvPath = join(tempDir, '.env.aliyun-role');
const roleEnv = common
  .filter((line) => !line.startsWith('SMS_ALIYUN_ACCESS_KEY_'))
  .filter((line) => !line.startsWith('SMS_ALIYUN_CREDENTIAL_MODE='));
roleEnv.push('SMS_ALIYUN_CREDENTIAL_MODE=ecs_ram_role', 'SMS_ALIYUN_ROLE_NAME=ss-erp-sms');
writeFileSync(roleEnvPath, `${roleEnv.join('\n')}\n`);
const roleMode = spawnSync(process.execPath, [
  'scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', roleEnvPath,
], { encoding: 'utf8' });
assert.equal(roleMode.status, 0, `Aliyun ECS role env should validate\n${roleMode.stdout}\n${roleMode.stderr}`);

const missingTemplatePath = join(tempDir, '.env.aliyun-missing-template');
writeFileSync(missingTemplatePath, `${common.filter((line) => !line.startsWith('SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE=')).join('\n')}\n`);
const missingTemplate = spawnSync(process.execPath, [
  'scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', missingTemplatePath,
], { encoding: 'utf8' });
assert.notEqual(missingTemplate.status, 0);
assert.match(missingTemplate.stderr, /SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE is required/);

const autoWithSmsAccessKeyPath = join(tempDir, '.env.aliyun-auto-with-sms-ak');
const autoWithSmsAccessKey = common
  .filter((line) => !line.startsWith('SMS_ALIYUN_CREDENTIAL_MODE='));
autoWithSmsAccessKey.push(
  'SMS_ALIYUN_CREDENTIAL_MODE=auto',
  'ALIBABA_CLOUD_IMDSV1_DISABLED=true',
);
writeFileSync(autoWithSmsAccessKeyPath, `${autoWithSmsAccessKey.join('\n')}\n`);
const compatibleAutoAccessKey = spawnSync(process.execPath, [
  'scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', autoWithSmsAccessKeyPath,
], { encoding: 'utf8' });
assert.equal(compatibleAutoAccessKey.status, 0,
  `complete auto-mode AccessKey pairs remain compatible\n${compatibleAutoAccessKey.stdout}\n${compatibleAutoAccessKey.stderr}`);

console.log('PASS Aliyun SMS configuration contract');
