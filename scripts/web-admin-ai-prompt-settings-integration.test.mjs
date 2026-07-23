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
assert.match(source, /新版工作流 Prompt Registry/);
assert.match(source, /兼容提示词（类目翻译 \/ 旧商品草稿）/);
assert.match(source, /来源商品上架 V2 使用上方 Prompt Registry/);
assert.match(source, /保存兼容提示词/);
assert.match(source, /检查通过不会自动开启工作流/);
assert.match(source, /生产调度：尚未验收/);
assert.match(source, /检查供应商配置/);
assert.match(source, /DashScope 的 API Key 不会在此步骤联网验证/);
assert.match(source, /参考改图当前冻结用户提示词，不使用 Registry/);

assert.match(source, /真实 Provider/);
assert.doesNotMatch(source, /真实供应商调用尚未启用/);
assert.doesNotMatch(source, /生图\/改图当前为预留配置/);

assert.match(source, /检查当前表单配置/);
assert.match(source, /provider: imageProvider/);
assert.match(source, /baseUrl: editing\.ai_image_base_url \|\| ''/);
assert.match(source, /apiKey: imageApiKeyForTest/);
assert.match(source, /isSavedMaskedSecret/);
assert.match(source, /model: editing\.ai_image_model \|\| ''/);
assert.match(source, /imageTestFingerprintRef/);
assert.match(source, /imageTestFingerprintRef\.current !== testedFingerprint/);

console.log('PASS web admin AI prompt settings integration contract');
