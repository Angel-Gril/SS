import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const captureStoreSource = fs.readFileSync('extensions/ss-erp/shared/capture-bridge/captured-har-store.js', 'utf8');
const captureHookSource = fs.readFileSync('extensions/ss-erp/content/capture-page-hook.js', 'utf8');
const settingsHtml = fs.readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
const settingsJs = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');

const sandbox = { console, window: {} };
vm.createContext(sandbox);
vm.runInContext(captureStoreSource, sandbox);

const store = sandbox.OZON_CALC_CAPTURE_STORE;
assert.ok(store, 'capture store should be exposed');

const endpoint = store.detectSupportedEndpoint('https://seller.ozon.ru/api/media/video/upload');
assert.equal(endpoint?.mode, 'ozon-video-upload', 'seller video media upload endpoints should be captured as video upload diagnostics');

const binaryUploadEndpoint = store.detectSupportedEndpoint('https://seller.ozon.ru/api/composer-api.bx/_action/upload?signature=secret', {
  method: 'POST',
  postData: { text: '{"file":"[binary]"}' },
});
assert.equal(
  binaryUploadEndpoint?.mode,
  'ozon-video-upload',
  'unknown seller binary uploads should still be captured for video upload diagnostics',
);

const mediaSave = store.normalizeCapturedEntry({
  pageUrl: 'https://seller.ozon.ru/app/products/5249973343/edit/media',
  request: {
    method: 'POST',
    url: 'https://api.seller.ozon.ru/api/composer-api.bx/_action/save-media',
    postData: { text: '{"url":"https://cdn1.ozone.ru/s3/sc-temporary/demo.mp4"}' },
  },
  response: {
    status: 200,
    content: { mimeType: 'application/json', text: '{"ok":true}' },
  },
});
assert.equal(
  mediaSave?._ozonCalc.mode,
  'ozon-video-upload',
  'media edit page save mutations should be captured to reveal how uploaded videos bind to products',
);

const relativeMediaSave = store.normalizeCapturedEntry({
  pageUrl: 'https://seller.ozon.ru/app/products/5249973343/edit/media?draftId=demo',
  request: {
    method: 'POST',
    url: '/api/composer-api.bx/_action/save-media',
    postData: { text: '{"url":"https://cdn1.ozone.ru/s3/sc-temporary/demo.mp4"}' },
  },
  response: {
    status: 200,
    content: { mimeType: 'application/json', text: '{"ok":true}' },
  },
});
assert.equal(
  relativeMediaSave?._ozonCalc.mode,
  'ozon-video-upload',
  'media edit page relative /api mutations should be captured because Ozon often calls same-origin APIs with relative URLs',
);

const normalized = store.normalizeCapturedEntry({
  pageUrl: 'https://seller.ozon.ru/app/products/media',
  request: {
    method: 'POST',
    url: 'https://seller.ozon.ru/api/media/video/upload?signature=secret&uploadId=abc',
    headers: [
      { name: 'cookie', value: 'secret=1' },
      { name: 'authorization', value: 'Bearer secret' },
      { name: 'x-o3-company-id', value: '12345' },
      { name: 'content-type', value: 'multipart/form-data; boundary=demo' },
    ],
    postData: { text: '{"file":"[binary]"}' },
  },
  response: {
    status: 200,
    headers: [
      { name: 'set-cookie', value: 'secret=2' },
      { name: 'content-type', value: 'application/json' },
    ],
    content: { mimeType: 'application/json', text: '{"videoId":"abc"}' },
  },
});

assert.equal(normalized._ozonCalc.mode, 'ozon-video-upload');
assert.equal(
  normalized.request.url,
  'https://seller.ozon.ru/api/media/video/upload?signature=[redacted]&uploadId=[redacted]',
  'capture store should redact upload URL query values',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.request.headers)),
  [
    { name: 'x-o3-company-id', value: '12345' },
    { name: 'content-type', value: 'multipart/form-data; boundary=demo' },
  ],
  'capture store should keep useful request headers and drop secrets',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(normalized.response.headers)),
  [{ name: 'content-type', value: 'application/json' }],
  'capture store should drop response set-cookie',
);

const entries = [
  normalized,
  store.normalizeCapturedEntry({
    request: { method: 'POST', url: 'https://seller.ozon.ru/api/product/list' },
    response: { status: 200, content: { text: '{}' } },
  }),
].filter(Boolean);

const videoHar = store.buildHarPayload(entries, 'ozon-video-upload');
assert.equal(videoHar.log.entries.length, 1, 'video HAR export should contain only video upload capture entries');
assert.equal(videoHar.log.entries[0]._ozonCalc.mode, 'ozon-video-upload');

assert.match(captureHookSource, /isVideoUploadUrl/, 'page hook should explicitly recognize video upload urls');
assert.match(captureHookSource, /isPotentialVideoUploadRequest/, 'page hook should capture unknown binary upload candidates');
assert.match(captureHookSource, /isMediaEditMutationRequest/, 'page hook should capture product media edit save mutations');
assert.match(captureHookSource, /redactUrlForCapture/, 'page hook should redact upload URL query values before forwarding');
assert.match(captureHookSource, /\[binary\]/, 'page hook should not serialize uploaded video bytes');
assert.match(settingsHtml, /videoUploadDiagnosticHarBtn/, 'settings page should expose a video upload diagnostic HAR button');
assert.match(settingsJs, /exportCapturedHar\('ozon-video-upload'/, 'settings page should export video upload diagnostic mode');

const sensitivePayload = store.normalizeCapturedEntry({
  pageUrl: 'https://seller.ozon.ru/app/products/5249973343/edit/media?draftToken=page-secret#access_token=fragment-secret',
  request: {
    method: 'POST',
    url: 'https://seller.ozon.ru/api/media/video/upload',
    headers: [{
      name: 'referer',
      value: 'https://seller.ozon.ru/app/products/5249973343/edit/media?draftToken=referer-secret#session=referer-fragment',
    }],
    postData: {
      text: JSON.stringify({
        upload: {
          url: 'https://video-bucket.example/video.mp4?X-Amz-Credential=request-credential&X-Amz-Signature=request-signature',
          token: 'request-token',
          parts: [{ partNumber: 1, signature: 'part-signature' }],
        },
        fileName: 'demo.mp4',
      }),
    },
  },
  response: {
    status: 201,
    headers: [
      {
        name: 'location',
        value: 'https://video-bucket.example/video.mp4?uploadId=secret-upload-id&signature=location-signature#complete',
      },
      { name: 'x-request-id', value: 'request-id-1' },
    ],
    content: {
      mimeType: 'application/json',
      text: JSON.stringify({
        result: {
          uploadUrl: 'https://video-bucket.example/video.mp4?credential=response-credential&token=response-url-token',
          accessToken: 'response-token',
          credential: { keyId: 'credential-key', secret: 'credential-secret' },
          videoId: 'video-123',
        },
      }),
    },
  },
});

assert.deepEqual(
  JSON.parse(sensitivePayload.request.postData.text),
  {
    upload: {
      url: 'https://video-bucket.example/video.mp4?X-Amz-Credential=[redacted]&X-Amz-Signature=[redacted]',
      token: '[redacted]',
      parts: [{ partNumber: 1, signature: '[redacted]' }],
    },
    fileName: 'demo.mp4',
  },
  'capture store should recursively redact signed URLs and credential fields in request JSON',
);
assert.deepEqual(
  JSON.parse(sensitivePayload.response.content.text),
  {
    result: {
      uploadUrl: 'https://video-bucket.example/video.mp4?credential=[redacted]&token=[redacted]',
      accessToken: '[redacted]',
      credential: '[redacted]',
      videoId: 'video-123',
    },
  },
  'capture store should recursively redact signed URLs and credential fields in response JSON while preserving diagnostics',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sensitivePayload.response.headers)),
  [
    {
      name: 'location',
      value: 'https://video-bucket.example/video.mp4?uploadId=[redacted]&signature=[redacted]#[redacted]',
    },
    { name: 'x-request-id', value: 'request-id-1' },
  ],
  'capture store should redact all Location URL query and fragment values while preserving the destination',
);

assert.equal(
  sensitivePayload._ozonCalc.pageUrl,
  'https://seller.ozon.ru/app/products/5249973343/edit/media?draftToken=[redacted]#[redacted]',
  'capture store should redact page URL query and fragment values',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sensitivePayload.request.headers)),
  [{
    name: 'referer',
    value: 'https://seller.ozon.ru/app/products/5249973343/edit/media?draftToken=[redacted]#[redacted]',
  }],
  'capture store should redact Referer query and fragment values',
);

console.log('PASS extension ozon video capture');
