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
for (const releaseControl of [
  'EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_API_ORIGIN',
  'EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN',
  'pnpm package:extension',
  'stage-extension-release.mjs',
  'EXTENSION_RELEASE_ROOT',
  'DEPLOYED_COMMIT',
  '/api/extensions/latest',
  'X-Content-SHA256',
  'signatureStatus=EXTERNAL_REQUIRED',
  'signature.status=EXTERNAL_REQUIRED',
  'FIRST_PARTY_WEBSITE',
  'config/extension-release-trusted-keys.json',
  'sign-extension-release.mjs',
  'sign-extension-website-publication.mjs',
  'activate-extension-website-publication.mjs',
  '--deploy-lock',
  '--expected-distribution-origin',
  '--expected-region',
  'ACTIVE_CANDIDATE="$ACTIVE_DEPLOY_DIR/build/extensions"',
  'ACTIVE_RELEASE_SIGNATURE="$ACTIVE_DEPLOY_DIR/build/extension-release-publication/ss-erp-extension-$VERSION.release-signature.json"',
  '/var/lib/ss-erp-extension-publication-inputs',
  'build/extension-release-signature.sha256',
  'ALREADY_ACTIVATED',
  'UNKNOWN_OUTCOME',
  '单一密码学信任域',
  '私钥及其目录不得上传到 VPS',
  'probe-extension-website-distribution.mjs',
  'verify-extension-publication.mjs',
  'EXTENSION_RELEASE_SIGNING_KEY_PATH',
  'EXTENSION_RELEASE_SIGNATURE_PATH',
  'EXTENSION_RELEASE_SIGNATURE_SHA256',
  'VERIFY_EXPECT_EXTENSION_WEBSITE_PUBLICATION_ENABLED',
  'VERIFY_LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT',
  'verify-extension-byok-rollout-policy.mjs',
  'ingest-pilot',
  '五个独立、不可传递的操作员授权门',
  '生产构建 -> 外部 release 签名 -> 双区域暗部署/canary -> 签署 website approval -> 激活 publication pointer -> 官网分发 probe -> 最终 publication verifier -> 同路径扩展升级 -> 单独批准的试点',
]) {
  assert.ok(
    deployment.includes(releaseControl),
    `deployment guide must document release control: ${releaseControl}`,
  );
}
assert.match(
  deployment,
  /probe-extension-website-distribution\.mjs[\s\S]{0,600}--approval[\s\S]{0,200}--dark-canary/u,
  'website distribution probe must bind the signed approval and dark-canary evidence',
);
assert.match(
  deployment,
  /verify-extension-publication\.mjs[\s\S]{0,600}--approval[\s\S]{0,200}--dark-canary/u,
  'final publication verifier must bind the signed approval and dark-canary evidence',
);
assert.match(
  deployment,
  /activate-extension-website-publication\.mjs[\s\S]{0,600}--candidate-root "\$ACTIVE_CANDIDATE"[\s\S]{0,600}--release-signature "\$ACTIVE_RELEASE_SIGNATURE"/u,
  'website activation must consume the active deployment candidate and sealed signature',
);
assert.match(
  deployment,
  /install -o root -g root -m 0644[\s\S]{0,200}\$STAGED_WEBSITE_APPROVAL[\s\S]{0,300}install -o root -g root -m 0600[\s\S]{0,200}\$STAGED_DARK_CANARY/u,
  'website activation inputs must be installed into root-owned staging paths',
);

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
  '审核候选图',
  '批准候选图',
  '接收并绑定 ERP',
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
  'verify-extension-byok-rollout-policy.mjs',
  'ingest-pilot',
  'pnpm package:extension',
  '真实签名和官网分发回执',
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
