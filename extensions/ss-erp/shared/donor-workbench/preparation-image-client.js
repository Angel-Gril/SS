(function (root) {
  'use strict';
  const PATH = '/api/extension-device/source-workbench/preparation/image';
  const MAX_BYTES = 1024 * 1024;
  const fail = () => { throw Object.assign(new Error('商品分析来源图片不可用'), { code: 'SS_ERP_PREPARATION_IMAGE_INVALID', outcome: 'NOT_SUBMITTED' }); };
  function createClient(options) {
    const timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) fail();
    return Object.freeze({
      async readForBackground(input, sourceMediaKey, purpose) {
        if (purpose !== 'THUMBNAIL' || typeof sourceMediaKey !== 'string' || !sourceMediaKey || sourceMediaKey.length > 500
          || /(?:https?|file|blob|data):/iu.test(sourceMediaKey)) fail();
        const result = await options.transport.postRaw(PATH, { binding: input.binding, skuKey: input.skuKey,
          sourceMediaKeys: [sourceMediaKey], categoryRevision: input.categoryRevision, providerContext: input.providerContext },
        { requiredScopes: ['listing:review', 'listing:write', 'media:execute'] });
        const response = result?.state === 'raw_response' ? result.response : null;
        if (!response?.ok || response.status !== 200 || response.headers.get('content-type') !== 'image/jpeg') fail();
        const rawLength = response.headers.get('content-length'), expectedSha = response.headers.get('x-ss-erp-media-sha256');
        const width = Number(response.headers.get('x-ss-erp-media-width')), height = Number(response.headers.get('x-ss-erp-media-height'));
        if (!/^\d+$/u.test(rawLength || '') || Number(rawLength) < 1 || Number(rawLength) > MAX_BYTES
          || !/^[a-f0-9]{64}$/u.test(expectedSha || '') || ![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1024)) {
          await response.body?.cancel().catch(() => {}); fail();
        }
        const reader = response.body?.getReader();
        if (!reader && typeof response.arrayBuffer !== 'function') fail();
        let length = 0; const chunks = [], deadline = Date.now() + timeoutMs;
        async function read() {
          let timer;
          try {
            return await Promise.race([reader ? reader.read() : response.arrayBuffer(), new Promise((_resolve, reject) => {
              timer = setTimeout(() => { if (reader) void reader.cancel().catch(() => {});
                reject(Object.assign(new Error('来源图片读取超时'), { code: 'SS_ERP_PREPARATION_IMAGE_TIMEOUT', outcome: 'NOT_SUBMITTED' }));
              }, Math.max(1, deadline - Date.now()));
            })]);
          } finally { clearTimeout(timer); }
        }
        try {
          if (!reader) {
            // Device transport has already bounded and frozen these bytes.
            const bytes = new Uint8Array(await read());
            length = bytes.byteLength;
            if (length !== Number(rawLength)) fail();
            chunks.push(bytes);
          } else {
            while (true) {
              const value = await read(); if (value.done) break;
              if (!(value.value instanceof Uint8Array) || (length += value.value.byteLength) > Number(rawLength)) {
                await reader.cancel(); fail();
              }
              chunks.push(value.value);
            }
          }
        } finally { reader?.releaseLock(); }
        if (length !== Number(rawLength)) fail();
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        if (bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) fail();
        const sha = Array.from(new Uint8Array(await (options.crypto || root.crypto).subtle.digest('SHA-256', bytes)))
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (sha !== expectedSha) fail();
        const blob = new root.Blob([bytes], { type: 'image/jpeg' });
        const image = await (options.inspector || root.SS_ERP_BYOK_IMAGE_INPUT_INSPECTOR).inspectImageBlob({ blob,
          maxBytes: MAX_BYTES, maxDimension: 1024, maxPixels: 1024 * 1024 });
        if (image.width !== width || image.height !== height || image.mimeType !== 'image/jpeg') fail();
        return Object.freeze({ blob, mimeType: 'image/jpeg', byteLength: length, sha256: sha, width, height });
      },
    });
  }
  root.SS_ERP_PREPARATION_IMAGE_CLIENT = Object.freeze({ createClient });
})(typeof globalThis !== 'undefined' ? globalThis : self);
