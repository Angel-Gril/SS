import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQYlWP4TyRgGFWID1A/eAAj+46A5o3AdQAAAABJRU5ErkJggg==', 'base64');
const source = { url: 'https://app.ss-erp.com/api/cdn/source.png', mimeType: 'image/png', width: 10, height: 10 };
const response = (bytes = png, headers = {}) => new Response(bytes, { headers: { 'content-type': 'image/png', ...headers } });

function harness(fetcher, timer) {
  const context = { Uint8Array, URL, Blob, AbortController, setTimeout: timer || setTimeout, clearTimeout };
  context.globalThis = context;
  for (const file of ['byok/profile-schema.js', 'byok/image-input-inspector.js', 'ai-media/image-source-preview.js']) {
    vm.runInNewContext(fs.readFileSync(`extensions/ss-erp/shared/${file}`, 'utf8'), context);
  }
  const blobs = [], revoked = [];
  const options = {
    fetch: fetcher,
    urlApi: {
      createObjectURL(blob) { blobs.push(blob); return `blob:source-${blobs.length}`; },
      revokeObjectURL(url) { revoked.push(url); },
    },
    readImageMetadata: context.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR.readImageMetadata,
    canonicalizeEndpoint: context.SS_ERP_BYOK_PROFILE_SCHEMA.canonicalizeEndpoint,
    allowLoopback: false,
  };
  return { preview: context.SS_ERP_IMAGE_SOURCE_PREVIEW.createPreview(options), blobs, revoked, options };
}

test('CORP source uses credential-free bounded fetch and releases replaced/closed blobs', async () => {
  const requests = [];
  const { preview, blobs, revoked } = harness(async (...args) => {
    requests.push(args); return response(png, { 'cross-origin-resource-policy': 'same-origin' });
  });
  assert.equal(await preview.load(source), 'blob:source-1');
  assert.deepEqual(Buffer.from(await blobs[0].arrayBuffer()), png);
  assert.equal(blobs[0].type, 'image/png');
  assert.equal(requests[0][1].credentials, 'omit');
  assert.equal(requests[0][1].redirect, 'error');
  assert.equal(requests[0][1].referrerPolicy, 'no-referrer');
  assert.equal(await preview.load(source), 'blob:source-2');
  assert.deepEqual(revoked, ['blob:source-1']);
  preview.clear(); preview.clear();
  assert.deepEqual(revoked, ['blob:source-1', 'blob:source-2']);
});

test('unsafe destinations fail before fetch; local source requires the local build boundary', async () => {
  let calls = 0;
  const { preview, options } = harness(async () => { calls++; return response(); });
  for (const url of ['file:///image.png', 'data:image/png;base64,AA', 'https://u:p@app.ss-erp.com/a',
    'http://app.ss-erp.com/a', 'https://169.254.169.254/a', 'https://10.0.0.1/a',
    'http://127.0.0.1:3001/a', 'https://localhost/a', 'https://app.ss-erp.com/a#fragment']) {
    await assert.rejects(preview.load({ ...source, url }));
  }
  assert.equal(calls, 0);
  options.allowLoopback = true;
  await preview.load({ ...source, url: 'http://127.0.0.1:3001/a' });
  assert.equal(calls, 1);
  preview.clear();
});

test('oversize headers, redirect, MIME mismatch, truncation and invalid bytes never reach the image', async () => {
  for (const make of [
    () => response(png, { 'content-length': String(20 * 1024 * 1024 + 1) }),
    () => response(png, { 'content-length': String(png.length + 1) }),
    () => response(png, { 'content-type': 'image/jpeg' }),
    () => response(Buffer.from('<svg/>')),
    () => response(png.subarray(0, 15)),
    () => new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/a' } }),
  ]) {
    const { preview, blobs } = harness(async () => make());
    await assert.rejects(preview.load(source));
    assert.equal(blobs.length, 0);
  }
});

test('stream limit cancels the reader without trusting content length', async () => {
  let cancelled = false;
  const oversized = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  });
  const { preview, blobs } = harness(async () => response(oversized));
  await assert.rejects(preview.load(source), /too large/u);
  assert.equal(cancelled, true);
  assert.equal(blobs.length, 0);
});

test('container dimensions and animation are checked before browser decode', async () => {
  const changed = Buffer.from(png); changed.writeUInt32BE(20000, 16);
  const animation = Buffer.alloc(20);
  animation.writeUInt32BE(8); animation.write('acTL', 4);
  for (const bytes of [changed, Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)])]) {
    const { preview, blobs } = harness(async () => response(bytes));
    await assert.rejects(preview.load(source));
    assert.equal(blobs.length, 0);
  }
});

test('late fetch after clear cannot create a blob or overwrite a replacement', async () => {
  let complete;
  let calls = 0;
  const { preview, blobs, revoked } = harness(() => {
    if (++calls === 1) return new Promise(resolve => { complete = resolve; });
    return Promise.resolve(response());
  });
  const old = preview.load(source);
  const rejected = assert.rejects(old, /cancelled/u);
  assert.equal(await preview.load(source), 'blob:source-1');
  complete(response());
  await rejected;
  assert.equal(blobs.length, 1);
  assert.deepEqual(revoked, []);
  preview.clear();
});

test('download deadline covers a stalled body and leaves no object URL', async () => {
  let timeout, cancelled = false;
  const { preview, blobs } = harness(async () => response(new ReadableStream({
    cancel() { cancelled = true; },
  })), (callback, ms) => { assert.equal(ms, 15000); timeout = callback; return 1; });
  const loading = preview.load(source);
  const rejected = assert.rejects(loading, /cancelled/u);
  await new Promise(resolve => setImmediate(resolve));
  timeout();
  await rejected;
  assert.equal(cancelled, true);
  assert.equal(blobs.length, 0);
});
