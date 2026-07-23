import assert from 'node:assert/strict';
import fs from 'node:fs';

const pagePath = 'apps/web/src/app/(dashboard)/shops/ozon/page.tsx';
const page = fs.readFileSync(pagePath, 'utf8');
const route = fs.readFileSync('apps/server/src/routes/shop.ts', 'utf8');
const service = fs.readFileSync('apps/server/src/services/ozon-video-upload-probe.ts', 'utf8');
const routeTest = fs.readFileSync('apps/server/src/__tests__/shop-ozon-video-probe-route.test.ts', 'utf8');

for (const hiddenSurface of [
  'Ozon 视频上传探针',
  '自动探针',
  '选择本地 MP4',
  '视频探针',
  'ozon-video-probe',
  'handleVideoProbe',
  'readVideoProbeFile',
  'accept="video/mp4"',
]) {
  assert.doesNotMatch(
    page,
    new RegExp(hiddenSurface),
    `Ozon shop page should not expose the developer probe surface: ${hiddenSurface}`,
  );
}

assert.match(
  route,
  /app\.post\('\/:id\/ozon-video-probe'/,
  'The shop-scoped video probe route should remain available for future diagnostics',
);
assert.match(
  route,
  /preHandler:\s*\[requireOzonVideoProbeAdminSession\]/,
  'The retained diagnostic route should require a super-admin account-session gate',
);
assert.match(
  route,
  /rateLimit:\s*\{[\s\S]*max:\s*3[\s\S]*timeWindow:\s*'1 minute'[\s\S]*groupId:\s*'ozon-video-probe'/,
  'The retained diagnostic route should have a low isolated rate limit',
);
assert.doesNotMatch(
  route,
  /groupId:\s*'ozon-video-probe'[\s\S]{0,200}hook:\s*'preHandler'|hook:\s*'preHandler'[\s\S]{0,200}groupId:\s*'ozon-video-probe'/,
  'The diagnostic limiter must run onRequest before parsing a large body or checking authorization',
);
assert.match(
  route,
  /tokenUse\s*===\s*'account_session'/,
  'The retained diagnostic route should allow only account-session tokens',
);
assert.match(
  service,
  /export async function probeOzonVideoUpload/,
  'The reusable Ozon video probe service should remain available',
);
assert.match(
  routeTest,
  /describe\('shop Ozon video probe route'/,
  'The retained diagnostic route should keep its server regression coverage',
);

console.log('PASS web ozon video probe routing');
