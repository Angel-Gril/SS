import assert from 'node:assert/strict';
import fs from 'node:fs';

const pageClient = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);
const controls = fs.readFileSync(
  'apps/web/src/components/admin/extension-ai-admin-controls.tsx',
  'utf8',
);
const page = `${pageClient}\n${controls}`;
const schema = fs.readFileSync('apps/server/src/config/system-config-schema.ts', 'utf8');

for (const key of [
  'feature_extension_hosted_ai',
  'feature_extension_byok_ai',
  'feature_extension_byok_ingest',
  'feature_extension_byok_publish',
  'extension_byok_admin_policy',
]) {
  assert.match(schema, new RegExp(key));
}

assert.match(page, /BYOK 管理控制/);
assert.match(pageClient, /<ExtensionAiAdminControls/);
assert.match(page, /托管 AI/);
assert.match(page, /BYOK 生图/);
assert.match(page, /BYOK 结果接收/);
assert.match(page, /BYOK 上架发布/);
assert.match(page, /允许的 Provider 来源/);
assert.match(page, /允许的操作/);
assert.match(page, /最大并发/);
assert.match(page, /选中的图片、参考图、遮罩和 Prompt/);
assert.match(page, /外部 Provider 费用由用户与 Provider 结算/);
assert.match(page, /API Key 不会发送到 ERP/);
assert.match(page, /只有用户接受的结果才会进入 ERP/);
assert.match(page, /不保存 Provider 原始响应或 API Key/);
assert.doesNotMatch(page, /sk-[A-Za-z0-9]/);

console.log('PASS extension BYOK admin settings contract');
