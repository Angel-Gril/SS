import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);

function functionBlock(name, nextMarker) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(nextMarker, start);
  assert.ok(start >= 0 && end > start, `${name} block must exist`);
  return source.slice(start, end);
}

const auth = functionBlock('AuthSettingsPanel', 'const BACKUP_GENERAL_KEYS');
const listing = functionBlock('ListingSettingsPanel', 'const AUTH_');
const upload = functionBlock('UploadSettingsPanel', 'function ConfigInput');
const applyConfigRows = functionBlock('applyConfigRows', '  async function fetchConfigs');
const fetchConfigs = functionBlock('fetchConfigs', '  async function saveConfig');
const saveConfig = functionBlock('saveConfig', '  async function saveConfigs');
const saveConfigs = functionBlock('saveConfigs', '  async function initDefaults');

assert.match(source, /interface RuntimeSelections/, 'settings must model effective runtime selections');
assert.match(source, /\/api\/admin\/system-status\/integrations/, 'settings must load the effective runtime snapshot');
assert.match(source, /runtimeSelections/, 'runtime selections must be passed into custom settings panels');
assert.match(source, /VISIBLE_CONFIG_GROUPS/, 'settings must use an explicit visible-group allowlist');
for (const hiddenKey of [
  'ai_media_workflow_v2_rollout_policy',
  'source_workflow_rollout_policy',
  'source_ozon_publisher_browser_one_click_stage',
  'source_ozon_publisher_collect_publish_stage',
  'source_ozon_publisher_extension_adapter_stage',
  'source_ozon_publisher_listing_batch_stage',
  'source_ozon_publisher_listing_import_by_sku_stage',
]) {
  assert.match(
    source,
    new RegExp(`HIDDEN_CONFIG_KEYS[\\s\\S]*${hiddenKey}`),
    `${hiddenKey} must stay out of the generic settings UI`,
  );
}
assert.match(source, /!VISIBLE_CONFIG_GROUPS\.has\(c\.group\)/, 'unknown/internal groups must not render');

for (const [name, block] of [['auth', auth], ['listing', listing], ['upload', upload]]) {
  assert.match(block, /<details className="group">/, `${name} panel must be collapsed by default`);
  assert.doesNotMatch(block, /<details open className="group">/, `${name} panel must not force itself open`);
}

assert.match(auth, /当前生效/, 'auth panel must distinguish the effective runtime selection');
assert.match(auth, /配置来源/, 'auth panel must name the runtime configuration source');
assert.match(auth, /\{provider === 'aliyun' && \(/, 'Aliyun fields must render only for the Aliyun selection');
assert.match(auth, /\{provider === 'tencent' && \(/, 'Tencent fields must render only for the Tencent selection');
assert.doesNotMatch(
  auth,
  /saveConfigs\(\['auth_sms_provider',\s*\.\.\.AUTH_(?:ALIYUN|TENCENT)_KEYS\]/,
  'saving provider credentials must not implicitly activate that provider',
);
assert.match(auth, /保存短信服务商/, 'SMS provider selection needs its own save command');
assert.match(auth, /保存短信开关与安全策略/, 'SMS switches and quotas need a separate save command');

const smsPolicyStart = auth.indexOf('<h3 className="text-sm font-medium">短信开关与安全策略</h3>');
const smsProviderStart = auth.indexOf('<h3 className="text-sm font-medium">短信服务商</h3>', smsPolicyStart);
assert.ok(smsPolicyStart >= 0 && smsProviderStart > smsPolicyStart, 'SMS policy section must precede provider selection');
const smsPolicySection = auth.slice(smsPolicyStart, smsProviderStart);
for (const key of [
  'feature_sms_register',
  'feature_sms_login',
  'auth_sms_code_ttl_seconds',
  'auth_sms_rate_limit_seconds',
  'auth_sms_daily_per_phone_limit',
  'auth_sms_daily_per_ip_limit',
  'auth_sms_daily_global_limit',
  'auth_sms_test_phone_whitelist',
]) {
  assert.match(
    smsPolicySection,
    new RegExp(`configs\\.${key}`),
    `${key} must render with the SMS policy save action`,
  );
}

assert.match(auth, /\{challengeProvider === 'builtin-pow' && \(/, 'PoW settings must only render for PoW');
assert.match(auth, /\{challengeProvider === 'cloudflare-turnstile' && \(/, 'Turnstile settings must only render for Turnstile');
assert.match(auth, /保存人机验证服务商/, 'human challenge provider needs its own save command');

for (const label of [
  '已生效',
  '已关闭',
  '未配置/未就绪',
  '配置无效（失败关闭）',
  '状态读取失败',
]) {
  assert.match(source, new RegExp(label), `runtime status must expose ${label}`);
}
assert.match(source, /providerConfigValid:\s*humanRuntime\?\.providerConfigValid/);
assert.match(source, /configurationValid:\s*humanRuntime\?\.hostnameConfigValid/);
assert.match(fetchConfigs, /setRuntimeSelectionsRequestState\('loading'\)/);
assert.match(fetchConfigs, /setRuntimeSelectionsRequestState\('error'\)/);
assert.match(fetchConfigs, /setRuntimeSelectionsRequestState\('ready'\)/);
assert.match(fetchConfigs, /Promise\.allSettled/);
assert.match(fetchConfigs, /withSettingsRequestTimeout/);
assert.match(fetchConfigs, /refreshRequestRef/);
assert.match(fetchConfigs, /isCurrentRequest\(\)/);
assert.match(fetchConfigs, /finally \{[\s\S]*setLoading\(false\)/);

assert.match(applyConfigRows, /savedDraftValues/);
assert.match(applyConfigRows, /setEditing\(\(current\) =>/);
assert.match(applyConfigRows, /current\[cfg\.key\] === options\.savedDraftValues!\[cfg\.key\]/);
assert.match(applyConfigRows, /preserveEditing/);
assert.match(saveConfig, /const savedDraftValues/);
assert.match(saveConfig, /expectedRevision/);
assert.match(saveConfig, /enqueueSave\(key/);
assert.match(saveConfig, /withAbortableSettingsRequest\([\s\S]*api\.put[\s\S]*\{ signal \}/);
assert.match(saveConfig, /await fetchConfigs\(\{ savedDraftValues \}\)/);
assert.match(saveConfig, /catch \{[\s\S]*await fetchConfigs\(\{ preserveEditing: true \}\)/);
assert.match(saveConfigs, /const savedDraftValues/);
assert.match(saveConfigs, /expectedRevision/);
assert.match(saveConfigs, /enqueueSave\(`group:\$\{label\}`/);
assert.match(saveConfigs, /withAbortableSettingsRequest\([\s\S]*api\.put[\s\S]*\{ signal \}/);
assert.match(saveConfigs, /await fetchConfigs\(\{ savedDraftValues \}\)/);
assert.match(saveConfigs, /catch \{[\s\S]*await fetchConfigs\(\{ preserveEditing: true \}\)/);
assert.match(source, /const saveInFlightRef = useRef/);
assert.match(source, /function enqueueSave\(/);
const backupRefresh = functionBlock('runBackupNow', '  const grouped:');
assert.doesNotMatch(backupRefresh, /fetchConfigs\(/, 'backup actions should not replace the full editing map');
assert.match(backupRefresh, /api\.get<BackupStatus>\('\/api\/admin\/ops\/backup-status'\)/);
assert.match(backupRefresh, /BACKUP_REQUEST_TIMEOUT_MS/);
assert.match(backupRefresh, /服务器可能仍在执行备份/);
assert.match(backupRefresh, /setRunningBackup\(false\)/);
assert.match(source, /if \(state === 'disabled'\) return '已关闭'/);
assert.ok(
  source.indexOf("if (readiness.providerConfigValid === false || readiness.configurationValid === false) return 'invalid'")
    < source.indexOf("if (readiness.disabled) return 'disabled'"),
  'invalid provider configuration must take precedence over an effective disabled fallback',
);
assert.match(source, /readiness\.configurationValid === false/);

assert.match(upload, /当前生效/, 'storage panel must show the effective provider');
assert.match(upload, /runtimeSelections\?\.uploadStorage/, 'storage status must come from the server runtime snapshot');
assert.match(upload, /runtimeStateLabel\(storageRuntimeState\)/, 'storage must render an explicit runtime state');
assert.doesNotMatch(
  upload,
  /const provider\s*=\s*[\s\S]{0,180}inferObjectStorageProvider\(editing\.upload_oss_endpoint/,
  'masked endpoint text must not decide the saved storage provider',
);

console.log('PASS web admin runtime settings UI contract');
