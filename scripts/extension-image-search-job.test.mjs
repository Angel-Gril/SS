import assert from 'node:assert/strict';

const helper = await import('../extensions/ss-erp/shared/source-search/image-search-job.js');
const api = helper.default || helper.SS_ERP_IMAGE_SEARCH_JOB || globalThis.SS_ERP_IMAGE_SEARCH_JOB;

assert.ok(api, 'image search job helper should be exported');
assert.equal(typeof api.createImageSearchJob, 'function', 'createImageSearchJob should be exported');
assert.equal(typeof api.build1688SearchUrl, 'function', 'build1688SearchUrl should be exported');

const now = Date.parse('2026-06-11T08:00:00.000Z');
const existingJobs = {
  expired: {
    platform: '1688',
    imageBase64: 'old',
    createdAt: now - 31 * 60 * 1000,
  },
  recent: {
    platform: '1688',
    imageBase64: 'recent',
    createdAt: now - 5 * 60 * 1000,
  },
};

const result = api.createImageSearchJob(existingJobs, {
  platform: '1688',
  imageUrl: 'https://cdn.ozon.ru/main.jpg',
  imageBase64: 'base64-image',
  imagePreviewDataUrl: 'data:image/jpeg;base64,base64-image',
  imageSize: '360x360',
  ozon: {
    productId: '1628675309',
    title: 'Ozon sample product',
    url: 'https://www.ozon.ru/product/sample-1628675309/',
  },
}, {
  now,
  token: 'img-test-token',
});

assert.equal(result.token, 'img-test-token');
assert.equal(result.url, 'https://s.1688.com/youyuan/index.htm?tab=imageSearch#ssErpImageSearch=1688&ssErpImageSearchToken=img-test-token');
assert.equal(result.jobs.expired, undefined, 'expired jobs should be pruned');
assert.equal(result.jobs.recent.imageBase64, 'recent');
assert.equal(result.jobs['img-test-token'].platform, '1688');
assert.equal(result.jobs['img-test-token'].imageBase64, 'base64-image');
assert.equal(result.jobs['img-test-token'].ozon.productId, '1628675309');
assert.equal(result.jobs['img-test-token'].createdAt, now);

assert.throws(
  () => api.createImageSearchJob({}, { platform: '1688', imageBase64: '' }, { token: 'bad' }),
  /缺少图片/
);

console.log('PASS image search job helper');
