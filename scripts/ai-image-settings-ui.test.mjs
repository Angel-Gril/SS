import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);

assert.match(source, /AI 生图基础平台/);
assert.match(source, /任务与存储基础已就绪/);
assert.match(source, /真实供应商调用尚未启用/);

assert.match(source, /value: 'disabled'/);
assert.match(source, /value: 'dashscope-wanx'/);
assert.match(source, /value: 'openai-images'/);
assert.match(source, /阿里云百炼 · 通义万相/);
assert.match(source, /OpenAI Images/);

assert.match(source, /ai_image_base_url/);
assert.match(source, /ai_image_api_key/);
assert.match(source, /ai_image_model/);
assert.match(source, /ai_image_prompt/);
assert.match(source, /ai_user_daily_image_generation_limit/);
assert.match(source, /ai_daily_budget_cents/);

assert.match(source, /\/api\/admin\/system-status\/test\/ai-image/);
assert.match(source, /测试生图连接/);
assert.match(source, /测试只验证配置与供应商连通性，不生成图片/);

assert.match(source, /function SecretConfigInput/);
assert.match(source, /value === '\*\*\*MASKED\*\*\*' \? '' : value/);
assert.match(source, /密钥已保存；留空表示保留原密钥/);

console.log('PASS AI image settings UI contract');
