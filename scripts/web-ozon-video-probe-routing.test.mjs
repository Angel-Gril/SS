import assert from 'node:assert/strict';
import fs from 'node:fs';

const pagePath = 'apps/web/src/app/(dashboard)/shops/ozon/page.tsx';
const page = fs.readFileSync(pagePath, 'utf8');

assert.match(
  page,
  /handleVideoProbe/,
  'Ozon shop page should expose a video probe action handler',
);
assert.match(
  page,
  /\/api\/shops\/\$\{id\}\/ozon-video-probe/,
  'Ozon shop page should call the shop-scoped video probe API',
);
for (const label of ['Ozon 视频上传探针', '选择店铺', '自动探针', '选择本地 MP4', '视频探针', '可自动挂载商品视频', '暂不可自动挂载商品视频', 'Ozon 视频资产']) {
  assert.match(page, new RegExp(label), `Ozon shop page should show video probe label: ${label}`);
}
assert.match(
  page,
  /Video/,
  'Ozon shop page should use a video icon for the video probe button',
);
assert.match(
  page,
  /accept="video\/mp4"/,
  'Ozon shop page should allow probing with a real local MP4 file',
);
assert.match(
  page,
  /readVideoProbeFile/,
  'Ozon shop page should convert local MP4 files to dataUrl payloads',
);

console.log('PASS web ozon video probe routing');
