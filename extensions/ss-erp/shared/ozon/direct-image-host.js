// 直连生图结果托管（在 service worker 里跑）。
//
// 为什么需要：Ozon 只接受 https 图片链接，而生图 Provider 返回的要么是 base64，
// 要么是会过期的临时链接（OpenAI 约 1 小时、DashScope 约 24 小时）。
// 所以每张图生成后都交给 ERP 存储 owner 落到对象存储，换一个长期可用的链接。
//
// 降级规则（见 dev-docs/extension-direction.md 第 4 条）：
//   - ERP 托管成功            → { url: 托管链接, hosted: true }
//   - 托管失败，Provider 给了 https 链接 → { url: Provider 链接, hosted: false, reason }
//   - 托管失败，只有 base64    → { url: '', hosted: false, dataUrl, reason }（只能预览，不能上架）
// 任何情况下都不丢弃已经付费生成的图片。
(function (global) {
  'use strict';

  var IMAGE_PATH = '/api/extension-device/images';
  var MAX_BYTES = 20 * 1024 * 1024;
  var ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];

  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
  }

  function normalizeMime(value) {
    var mime = String(value || '').split(';')[0].trim().toLowerCase();
    return ALLOWED.indexOf(mime) >= 0 ? mime : '';
  }

  function sniffMime(base64) {
    if (base64.indexOf('iVBORw0KGgo') === 0) return 'image/png';
    if (base64.indexOf('/9j/') === 0) return 'image/jpeg';
    if (base64.indexOf('UklGR') === 0) return 'image/webp';
    return '';
  }

  function createImageHost(options) {
    var fetchImpl = options && options.fetchImpl;
    var postDevice = options && options.postDevice;
    if (typeof fetchImpl !== 'function' || typeof postDevice !== 'function') {
      throw new TypeError('image host dependencies are required');
    }

    async function toDataUrl(input) {
      var base64 = String(input.b64 || '');
      var mime = '';
      if (!base64) {
        var response = await fetchImpl(input.url, { credentials: 'omit', cache: 'no-store' });
        if (!response.ok) throw new Error('下载生成图片失败：HTTP ' + response.status);
        var bytes = new Uint8Array(await response.arrayBuffer());
        if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('生成图片大小异常');
        mime = normalizeMime(response.headers && response.headers.get && response.headers.get('content-type'));
        base64 = bytesToBase64(bytes);
      }
      mime = mime || sniffMime(base64);
      if (!mime) throw new Error('生成图片格式不受支持');
      if (base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 4) throw new Error('生成图片超过 20MB');
      return { dataUrl: 'data:' + mime + ';base64,' + base64, mime: mime };
    }

    return {
      /** @param {{url?: string, b64?: string, jobId?: string, shopId?: string}} input */
      async host(input) {
        var providerUrl = /^https:\/\//.test(String(input && input.url || '')) ? String(input.url) : '';
        var data = null;
        var reason = '';
        try {
          data = await toDataUrl({ url: providerUrl, b64: input && input.b64 });
          var ext = data.mime === 'image/jpeg' ? 'jpg' : data.mime.split('/')[1];
          var safeJob = String(input && input.jobId || 'image').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'image';
          var result = await postDevice(IMAGE_PATH, {
            dataUrl: data.dataUrl,
            filename: 'direct-' + safeJob + '-' + Date.now() + '.' + ext,
            ...(input && input.shopId ? { shopId: String(input.shopId) } : {}),
          });
          var hostedUrl = result && result.ok && result.data && String(result.data.url || '');
          if (hostedUrl && /^https:\/\//.test(hostedUrl)) return { url: hostedUrl, hosted: true };
          reason = result && result.ok ? 'ERP 返回的图片链接不是 https，无法用于上架' : String(result && result.error || 'ERP 图片托管失败');
        } catch (error) {
          reason = String(error && error.message || error);
        }
        reason = reason.slice(0, 200);
        if (providerUrl) return { url: providerUrl, hosted: false, reason: reason };
        return { url: '', hosted: false, reason: reason, ...(data ? { dataUrl: data.dataUrl } : {}) };
      },
    };
  }

  global.SSERP_DIRECT_IMAGE_HOST = Object.freeze({ createImageHost: createImageHost, IMAGE_PATH: IMAGE_PATH });
})(typeof globalThis !== 'undefined' ? globalThis : self);
