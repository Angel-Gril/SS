import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);
const integrations = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/integrations/page.tsx',
  'utf8',
);
const systemConfigRoute = fs.readFileSync('apps/server/src/routes/system-config.ts', 'utf8');

assert.match(source, /S3 兼容对象存储配置中心/);
assert.match(source, /阿里云 OSS/);
assert.match(source, /Cloudflare R2/);
assert.match(source, /S3 兼容/);
assert.match(source, /自动填充 Endpoint/);
assert.match(source, /测试公网匿名读取/);
assert.match(source, /RAM 最小权限/);
assert.doesNotMatch(source, /当前重点：R2 图片\/附件上传测试/);
assert.match(integrations, /S3 对象存储最近一次测试/);
assert.match(source, /system-config\/batch/);
assert.match(systemConfigRoute, /\$transaction/);

console.log('PASS object storage settings UI contract');
