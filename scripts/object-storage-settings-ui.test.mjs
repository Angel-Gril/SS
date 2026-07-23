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

assert.match(source, /阿里云 OSS \/ Cloudflare R2 \/ S3/);
assert.match(source, /当前生效/);
assert.match(source, /配置来源/);
assert.match(source, /阿里云 OSS/);
assert.match(source, /Cloudflare R2/);
assert.match(source, /S3 兼容/);
assert.match(source, /自动填充 Endpoint/);
assert.match(source, /测试公网匿名读取/);
assert.match(source, /RAM 最小权限/);
assert.doesNotMatch(source, /当前重点：R2 图片\/附件上传测试/);
assert.match(source, /数据库备份对象存储/);
assert.match(source, /backup_remote_provider/);
assert.match(source, /value: 'aliyun-oss'/);
assert.match(source, /value: 'cloudflare-r2'/);
assert.match(source, /value: 's3-compatible'/);
assert.match(source, /internal\.aliyuncs\.com/);
assert.match(source, /私有 Bucket/);
assert.match(source, /不要绑定 CDN/);
assert.match(source, /不需要配置 CORS/);
assert.match(source, /root-only/);
assert.match(source, /应急恢复凭证/);
assert.match(source, /数据库备份 RAM 最小权限/);
assert.doesNotMatch(source, /备份 R2/);
assert.match(integrations, /S3 对象存储最近一次测试/);
assert.match(source, /system-config\/batch/);
assert.match(systemConfigRoute, /\$transaction/);
assert.match(source, /next\.backup_remote_access_key_id = ''/);
assert.match(source, /next\.backup_remote_secret_access_key = ''/);

console.log('PASS object storage settings UI contract');
