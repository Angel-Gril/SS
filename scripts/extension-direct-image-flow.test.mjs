import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDirectImageJobs,
  createDirectImageRunner,
  createDirectImageStore,
  publishImageEntries,
} from '../extensions/ss-erp/pages/donor/direct-image-flow.js';

const media = [
  { key: 'm1', url: 'https://img.example.test/main-1.jpg', role: 'product_main', skuKeys: [] },
  { key: 'm2', url: 'https://img.example.test/main-2.jpg', role: 'product_main', skuKeys: [] },
  { key: 'd1', url: 'https://img.example.test/detail-1.jpg', role: 'product_detail', skuKeys: [] },
];
const skus = [
  { key: 'sku-a', label: '粉色 M', imageUrl: 'https://img.example.test/sku-a.jpg' },
  { key: 'sku-b', label: '蓝色 L', imageUrl: 'https://img.example.test/sku-b.jpg' },
];
const product = { title: '夏季连衣裙', categoryName: 'Платье' };

function memoryStorage() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.has(key) ? { [key]: data.get(key) } : {}; },
    async set(value) { for (const [key, entry] of Object.entries(value)) data.set(key, structuredClone(entry)); },
  };
}

test('ai-suite builds one hero per SKU plus the shared gallery, with stable ids', () => {
  const jobs = buildDirectImageJobs({ mode: 'ai-suite', product, media, skus });
  assert.deepEqual(jobs.filter(job => job.kind === 'hero').map(job => job.id), ['hero:sku-a', 'hero:sku-b']);
  assert.equal(jobs.filter(job => job.kind === 'gallery').length, 7);
  assert.equal(jobs.find(job => job.id === 'hero:sku-a').skuKey, 'sku-a');
  assert.ok(jobs.every(job => job.prompt && job.inputImageUrls.every(url => url.startsWith('https://'))));
  assert.deepEqual(jobs.map(job => job.id), buildDirectImageJobs({ mode: 'ai-suite', product, media, skus }).map(job => job.id));
});

test('translate builds one job per selected source image and nothing else', () => {
  const jobs = buildDirectImageJobs({
    mode: 'translate', product, media, skus,
    translationUrls: ['https://img.example.test/detail-1.jpg', 'http://insecure.example.test/x.jpg'],
  });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].kind, 'translate');
  assert.deepEqual(jobs[0].inputImageUrls, ['https://img.example.test/detail-1.jpg']);
  assert.match(jobs[0].prompt, /Russian/u);
});

test('ai-main-translate combines SKU heroes with translations', () => {
  const jobs = buildDirectImageJobs({
    mode: 'ai-main-translate', product, media, skus, translationUrls: ['https://img.example.test/detail-1.jpg'],
  });
  assert.deepEqual(jobs.map(job => job.kind), ['hero', 'hero', 'translate']);
});

test('a failed image keeps the finished ones, and a rerun only retries what is missing', async () => {
  const storage = memoryStorage();
  const store = createDirectImageStore({ storage, sourceKey: '1688:715' });
  const calls = [];
  const send = async (message) => {
    calls.push(message.payload.jobId);
    if (message.payload.jobId === 'gallery:shared_gallery_2' && calls.filter(id => id === 'gallery:shared_gallery_2').length === 1) {
      throw new Error('生图返回 429');
    }
    return { url: `https://cdn.example.test/${encodeURIComponent(message.payload.jobId)}.png`, hosted: true, elapsedMs: 10 };
  };
  const runner = createDirectImageRunner({ send, store });
  const jobs = buildDirectImageJobs({ mode: 'ai-suite', product, media, skus: [skus[0]] }).slice(0, 3);

  const first = await runner.run(jobs);
  assert.deepEqual(first.map(item => item.status), ['done', 'done', 'failed']);
  assert.match(first[2].error, /429/u);
  assert.equal(runner.state().busy, false);

  // 落盘后重开：已完成的不再付费重跑，只补失败的那张
  const reopened = createDirectImageRunner({ send, store });
  await reopened.load();
  assert.equal(reopened.state().results.filter(item => item.status === 'done').length, 2);
  const second = await reopened.run(jobs);
  assert.deepEqual(second.map(item => item.status), ['done', 'done', 'done']);
  assert.deepEqual(calls, ['hero:sku-a', 'gallery:shared_gallery_1', 'gallery:shared_gallery_2', 'gallery:shared_gallery_2']);
});

test('preview-only data urls are kept in memory but never persisted', async () => {
  const storage = memoryStorage();
  const store = createDirectImageStore({ storage, sourceKey: '1688:715' });
  const runner = createDirectImageRunner({
    send: async () => ({ url: '', hosted: false, dataUrl: 'data:image/png;base64,AAAA', reason: '设备未配对' }),
    store,
  });
  const [result] = await runner.run(buildDirectImageJobs({ mode: 'ai-suite', product, media, skus: [skus[0]] }).slice(0, 1));
  assert.equal(result.status, 'done');
  assert.equal(result.publishable, false);
  assert.equal(result.dataUrl, 'data:image/png;base64,AAAA');
  const persisted = JSON.stringify([...storage.data.values()]);
  assert.equal(persisted.includes('data:image'), false);
});

test('cancel stops before the next image and reports the remainder as not started', async () => {
  const store = createDirectImageStore({ storage: memoryStorage(), sourceKey: 's' });
  let runner;
  const send = async (message) => {
    runner.cancel();
    return { url: `https://cdn.example.test/${encodeURIComponent(message.payload.jobId)}.png`, hosted: true };
  };
  runner = createDirectImageRunner({ send, store });
  const results = await runner.run(buildDirectImageJobs({ mode: 'ai-suite', product, media, skus: [skus[0]] }).slice(0, 3));
  assert.deepEqual(results.map(item => item.status), ['done', 'pending', 'pending']);
});

test('publish entries scope heroes to their SKU, order the shared images, and fall back to source images', () => {
  const results = [
    { id: 'translate:1', kind: 'translate', skuKey: null, order: 100, status: 'done', publishable: true, selected: true, url: 'https://cdn.example.test/t1.png' },
    { id: 'gallery:shared_gallery_2', kind: 'gallery', skuKey: null, order: 2, status: 'done', publishable: true, selected: true, url: 'https://cdn.example.test/g2.png' },
    { id: 'gallery:shared_gallery_1', kind: 'gallery', skuKey: null, order: 1, status: 'done', publishable: true, selected: true, url: 'https://cdn.example.test/g1.png' },
    { id: 'hero:sku-a', kind: 'hero', skuKey: 'sku-a', order: 0, status: 'done', publishable: true, selected: true, url: 'https://cdn.example.test/hero-a.png' },
    { id: 'hero:sku-b', kind: 'hero', skuKey: 'sku-b', order: 0, status: 'done', publishable: true, selected: false, url: 'https://cdn.example.test/hero-b.png' },
    { id: 'gallery:shared_gallery_3', kind: 'gallery', skuKey: null, order: 3, status: 'failed', publishable: false, selected: true, url: '' },
    { id: 'gallery:shared_gallery_4', kind: 'gallery', skuKey: null, order: 4, status: 'done', publishable: false, selected: true, url: '' },
  ];
  assert.deepEqual(publishImageEntries(results, { sourceUrls: ['https://img.example.test/main-1.jpg'] }), [
    { scope: 'SKU', skuKey: 'sku-a', url: 'https://cdn.example.test/hero-a.png' },
    { scope: 'PRODUCT', skuKey: null, url: 'https://cdn.example.test/g1.png' },
    { scope: 'PRODUCT', skuKey: null, url: 'https://cdn.example.test/g2.png' },
    { scope: 'PRODUCT', skuKey: null, url: 'https://cdn.example.test/t1.png' },
  ]);
  assert.deepEqual(publishImageEntries([], { sourceUrls: ['https://img.example.test/main-1.jpg', 'http://x.test/a.jpg'] }),
    [{ scope: 'PRODUCT', skuKey: null, url: 'https://img.example.test/main-1.jpg' }]);
});
