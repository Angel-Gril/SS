import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);

assert.match(
  source,
  /import \{ AiPromptTemplateEditor \} from ['"]@\/components\/admin\/ai-prompt-template-editor['"]/,
);
assert.match(source, /<AiPromptTemplateEditor/);
assert.doesNotMatch(source, /cfg=\{configs\.ai_image_prompt\}/);

assert.match(source, /真实生图任务已启用/);
assert.doesNotMatch(source, /真实供应商调用尚未启用/);
assert.doesNotMatch(source, /生图\/改图当前为预留配置/);

assert.match(source, /测试生图连接/);
assert.match(source, /测试当前表单配置/);
assert.match(source, /provider: imageProvider/);
assert.match(source, /baseUrl: editing\.ai_image_base_url \|\| ''/);
assert.match(source, /apiKey: imageApiKeyForTest/);
assert.match(source, /isSavedMaskedSecret/);
assert.match(source, /model: editing\.ai_image_model \|\| ''/);
assert.match(source, /imageTestFingerprintRef/);
assert.match(source, /fetchConfigs\(true\)/);

console.log('PASS web admin AI prompt settings integration contract');
