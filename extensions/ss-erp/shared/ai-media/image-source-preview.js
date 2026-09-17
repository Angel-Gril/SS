(function (root) {
  'use strict';

  var MAX_BYTES = 20 * 1024 * 1024;
  var TIMEOUT_MS = 15000;

  function createPreview(options) {
    var fetcher = options.fetch;
    var urlApi = options.urlApi;
    var inspect = options.readImageMetadata;
    var publicEndpoint = options.canonicalizeEndpoint;
    var current = null;

    function clear() {
      var previous = current;
      current = null;
      if (!previous) return;
      previous.controller.abort();
      if (previous.reader) Promise.resolve(previous.reader.cancel()).catch(function () {});
      if (previous.objectUrl) urlApi.revokeObjectURL(previous.objectUrl);
    }

    async function load(source) {
      clear();
      var url = new URL(source.url);
      if (url.username || url.password || url.hash) throw new Error('Invalid source URL');
      var loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (loopback) {
        if (!options.allowLoopback || !['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Local source is unavailable in this build');
        }
      } else {
        publicEndpoint(url.origin);
      }
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(source.mimeType)
        || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height)
        || source.width < 1 || source.height < 1 || source.width > 16384 || source.height > 16384
        || source.width * source.height > 12000000
        || Math.max(source.width, source.height) / Math.min(source.width, source.height) > 20) {
        throw new Error('Invalid source image');
      }
      var row = { controller: new AbortController(), reader: null, objectUrl: null };
      current = row;
      var timer = setTimeout(function () {
        row.controller.abort();
        if (row.reader) Promise.resolve(row.reader.cancel()).catch(function () {});
      }, TIMEOUT_MS);
      function active() {
        if (current !== row || row.controller.signal.aborted) throw new Error('Source preview cancelled');
      }
      try {
        var response = await fetcher(url.href, {
          credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
          signal: row.controller.signal,
        });
        if (response.body) row.reader = response.body.getReader();
        active();
        var mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        var lengthText = response.headers.get('content-length');
        var length = lengthText === null ? null : Number(lengthText);
        if (!response.ok || response.status !== 200 || response.redirected || !row.reader
          || mime !== source.mimeType || (length !== null && (!/^[1-9]\d*$/.test(lengthText)
            || !Number.isSafeInteger(length) || length > MAX_BYTES))) {
          throw new Error('Invalid source response');
        }
        var chunks = [];
        var total = 0;
        while (true) {
          var part = await row.reader.read();
          active();
          if (part.done) break;
          if (!(part.value instanceof Uint8Array)) throw new Error('Invalid source bytes');
          total += part.value.byteLength;
          if (total > MAX_BYTES || (length !== null && total > length)) {
            throw new Error('Source image is too large');
          }
          chunks.push(part.value);
        }
        if (!total || (length !== null && total !== length)) throw new Error('Incomplete source image');
        var bytes = new Uint8Array(total);
        var offset = 0;
        chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.byteLength; });
        var metadata = inspect(bytes);
        if (metadata.mimeType !== mime || metadata.animated
          || metadata.width !== source.width || metadata.height !== source.height) {
          throw new Error('Source image has changed');
        }
        active();
        row.objectUrl = urlApi.createObjectURL(new Blob([bytes], { type: mime }));
        return row.objectUrl;
      } catch (error) {
        if (row.reader) { try { await row.reader.cancel(); } catch {} }
        if (current === row) clear();
        throw error;
      } finally {
        clearTimeout(timer);
        if (row.reader) { try { row.reader.releaseLock(); } catch {} row.reader = null; }
      }
    }

    return { load: load, clear: clear };
  }

  root.SS_ERP_IMAGE_SOURCE_PREVIEW = Object.freeze({ createPreview: createPreview });
}(typeof globalThis !== 'undefined' ? globalThis : self));
