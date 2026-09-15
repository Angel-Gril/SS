import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);
const configSchema = fs.readFileSync(
  'apps/server/src/config/system-config-schema.ts',
  'utf8',
);

assert.match(source, /AI 生图基础平台/);
assert.match(source, /任务队列：基础就绪/);
assert.match(source, /对象存储：基础就绪/);
assert.match(source, /真实 Provider/);
assert.match(source, /模型、单价、租户权限和/);
assert.match(source, /预算执行/);
assert.match(source, /调度：由功能开关控制/);
assert.doesNotMatch(source, /真实供应商调用尚未启用/);

assert.match(source, /value: 'disabled'/);
assert.match(source, /value: 'dashscope-wanx'/);
assert.match(source, /value: 'openai-images'/);
assert.match(source, /阿里云百炼 · 通义万相/);
assert.match(source, /OpenAI Images/);
assert.match(source, /isOfficialOpenAiImagesBaseUrl/);
assert.match(source, /imageProviderEndpointMismatch/);
assert.match(source, /normalized\.includes\('\?'\)/);
assert.match(source, /normalized\.includes\('#'\)/);
assert.match(source, /!parsed\.port/);
assert.match(source, /normalizedPath === '' \|\| normalizedPath === '\/v1'/);
assert.match(source, /当前 Base URL 是第三方中转/);
assert.match(source, /切换为自定义网关/);

assert.match(source, /ai_image_base_url/);
assert.match(source, /ai_image_api_key/);
assert.match(source, /ai_image_model/);
assert.match(source, /ai_image_translation_provider/);
assert.match(source, /ai_image_translation_base_url/);
assert.match(source, /ai_image_translation_api_key/);
assert.match(source, /ai_image_translation_model/);
assert.match(source, /ai_image_translation_category_glossary_json/);
assert.match(
  source,
  /const AI_IMAGE_TRANSLATION_PROVIDER_KEYS = \[[\s\S]*?'ai_image_translation_category_glossary_json'[\s\S]*?\];/,
);
assert.match(source, /cfg=\{configs\.ai_image_translation_category_glossary_json\}/);
assert.match(source, /function ConfigTextarea/);
assert.match(source, /<textarea/);
assert.match(source, /JSON 格式：<code>version<\/code> 固定为 1/);
assert.match(source, /profiles/);
assert.match(source, /扩展 1688 图片翻译固定使用/);
assert.match(source, /"sourceLanguage": "zh"/);
assert.doesNotMatch(source, /"src": "ceramic mug"/);
assert.match(source, /DashScope · qwen-mt-image/);
assert.match(source, /沙箱证据通过前不会发起付费请求/);
assert.doesNotMatch(source, /cfg=\{configs\.ai_image_prompt\}/);
assert.match(source, /ai_user_daily_image_generation_limit/);
assert.match(source, /ai_image_generation_cost_cents/);
assert.match(source, /ai_daily_budget_cents/);

assert.match(source, /\/api\/admin\/system-status\/test\/ai-image/);
assert.match(source, /检查供应商配置/);
assert.match(source, /检查当前表单配置/);
assert.match(source, /检查通过不会自动开启工作流/);

assert.match(source, /function SecretConfigInput/);
assert.match(source, /value=\{hasSavedSecret \? '' : value\}/);
assert.match(source, /isSavedMaskedSecret/);
assert.match(source, /密钥已保存；留空表示保留原密钥/);

assert.match(configSchema, /label: 'AI 文生图'/);
assert.match(configSchema, /label: '图片翻译服务来源'/);
assert.match(configSchema, /ai_image_translation_category_glossary_json/);
assert.match(configSchema, /label: '图片翻译品类术语表（JSON）'/);
assert.match(configSchema, /AI_IMAGE_TRANSLATION_GLOSSARY_DEFAULT_JSON/);
assert.match(configSchema, /label: 'AI 全局每日预算'/);
assert.match(configSchema, /按任务报价币种分别执行的全局每日预算/);
assert.match(configSchema, /label: '生图单张费用（分）'/);
assert.doesNotMatch(configSchema, /0 表示不按金额限制/);
assert.ok(!configSchema.includes('AI 生图/改图预留'));
assert.doesNotMatch(configSchema, /预留开关：当前只保存配置/);

console.log('PASS AI image settings UI contract');
