import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

function load() {
  const sandbox = { btoa, Uint8Array, Date, String, Math, Object };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync('extensions/ss-erp/shared/ozon/direct-image-host.js', 'utf8'), sandbox);
  return sandbox.SSERP_DIRECT_IMAGE_HOST;
}

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString('base64');
const fetchPng = async () => ({
  ok: true, status: 200, headers: { get: () => 'image/png' }, arrayBuffer: async () => PNG_BYTES.buffer,
});

test('uploads a base64 result to ERP and returns the hosted https url', async () => {
  const posts = [];
  const host = load().createImageHost({
    fetchImpl: async () => { throw new Error('must not download when base64 is present'); },
    postDevice: async (path, body) => { posts.push({ path, body }); return { ok: true, data: { url: 'https://cdn.example.test/a.png' } }; },
  });
  const result = await host.host({ b64: PNG_B64, jobId: 'hero:sku a', shopId: 'shop-1' });
  assert.deepEqual({ ...result }, { url: 'https://cdn.example.test/a.png', hosted: true });
  assert.equal(posts[0].path, '/api/extension-device/images');
  assert.equal(posts[0].body.dataUrl, 'data:image/png;base64,' + PNG_B64);
  assert.equal(posts[0].body.shopId, 'shop-1');
  assert.match(posts[0].body.filename, /^direct-hero-sku-a-\d+\.png$/u);
});

test('re-hosts a provider url, and falls back to it when ERP is unavailable', async () => {
  const hosted = await load().createImageHost({
    fetchImpl: fetchPng,
    postDevice: async () => ({ ok: true, data: { url: 'https://cdn.example.test/b.png' } }),
  }).host({ url: 'https://provider.example.test/tmp.png' });
  assert.deepEqual({ ...hosted }, { url: 'https://cdn.example.test/b.png', hosted: true });

  const fallback = await load().createImageHost({
    fetchImpl: fetchPng,
    postDevice: async () => ({ ok: false, error: '设备未配对' }),
  }).host({ url: 'https://provider.example.test/tmp.png' });
  assert.deepEqual({ ...fallback }, { url: 'https://provider.example.test/tmp.png', hosted: false, reason: '设备未配对' });
});

test('keeps a paid base64 image for preview when it cannot be hosted, but never marks it publishable', async () => {
  const result = await load().createImageHost({
    fetchImpl: fetchPng,
    postDevice: async () => { throw new Error('network down'); },
  }).host({ b64: PNG_B64 });
  assert.equal(result.url, '');
  assert.equal(result.hosted, false);
  assert.equal(result.reason, 'network down');
  assert.equal(result.dataUrl, 'data:image/png;base64,' + PNG_B64);
});

test('refuses a non-https hosted url and unsupported image bytes', async () => {
  const insecure = await load().createImageHost({
    fetchImpl: fetchPng,
    postDevice: async () => ({ ok: true, data: { url: 'http://localhost:3001/api/cdn/a.png' } }),
  }).host({ url: 'https://provider.example.test/tmp.png' });
  assert.equal(insecure.hosted, false);
  assert.equal(insecure.url, 'https://provider.example.test/tmp.png');

  let posted = false;
  const unsupported = await load().createImageHost({
    fetchImpl: fetchPng,
    postDevice: async () => { posted = true; return { ok: true, data: {} }; },
  }).host({ b64: Buffer.from('<svg/>').toString('base64') });
  assert.equal(posted, false);
  assert.equal(unsupported.url, '');
  assert.equal(unsupported.dataUrl, undefined);
  assert.match(unsupported.reason, /格式不受支持/u);
});
