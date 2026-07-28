import assert from 'node:assert/strict';
import fs from 'node:fs';

const guidePath = 'docs/extension-ai-image-workbench.md';
const indexPath = 'docs/README.md';
const developmentPath = 'docs/extension-development.md';
const deploymentPath = 'docs/deployment.md';

for (const path of [guidePath, indexPath, developmentPath, deploymentPath]) {
  assert.equal(fs.existsSync(path), true, `${path} must exist`);
}

const guide = fs.readFileSync(guidePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');
const development = fs.readFileSync(developmentPath, 'utf8');
const deployment = fs.readFileSync(deploymentPath, 'utf8');

assert.match(index, /\[扩展 AI 图片工作台操作指南\]\(extension-ai-image-workbench\.md\)/u);
assert.match(development, /\[扩展 AI 图片工作台操作指南\]\(extension-ai-image-workbench\.md\)/u);
assert.match(deployment, /\[扩展 AI 图片工作台操作指南\]\(extension-ai-image-workbench\.md\)/u);
for (const flag of [
  'feature_extension_hosted_ai=false',
  'feature_extension_byok_ai=false',
  'feature_extension_byok_ingest=false',
  'feature_extension_byok_publish=false',
]) {
  assert.ok(deployment.includes(flag), `deployment guide must document dark default: ${flag}`);
}

for (const requiredText of [
  'ERP_HOSTED',
  'BYOK',
  'chrome.storage.session',
  'chrome.storage.local',
  '当前浏览器会话',
  '仅关闭设置页不保证立即清除',
  'Provider 账户承担',
  'ERP AI 生成费用为 0',
  '不会直接调用 Ozon Seller API',
  '精确 Provider 来源权限',
  '所有路径',
  '另一个 origin',
  'UNKNOWN_OUTCOME',
  '不会自动重试',
  '审核',
  '接收并绑定 ERP 草稿',
  '发布回执',
  'feature_extension_hosted_ai',
  'feature_extension_byok_ai',
  'feature_extension_byok_ingest',
  'feature_extension_byok_publish',
  'extension-byok-admin-policy/v1',
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
  'maxConcurrency',
  '默认关闭',
  '不得在策略 JSON 中填写 API Key',
  'Prompt 与所选图片会发送到该 Provider',
  'ERP_HOSTED` 也不是“数据永远留在 ERP”',
  '已接收的图片本体会由 ERP 校验、规范化、存储并绑定草稿',
  'QA-02',
]) {
  assert.ok(guide.includes(requiredText), `guide must document: ${requiredText}`);
}

assert.match(guide, /## 管理员：先做受控开通/u);
assert.match(guide, /## 用户：配置自带 Provider/u);
assert.match(guide, /## 恢复与故障处理/u);
assert.match(guide, /## 隐私、数据与费用/u);

console.log('PASS extension AI image workbench documentation contract');
