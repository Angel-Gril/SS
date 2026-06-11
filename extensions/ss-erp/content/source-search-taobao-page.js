(function () {
  'use strict';

  var REQUEST_SOURCE = 'ss-erp-image-search-taobao-bridge';
  var RESULT_SOURCE = 'ss-erp-image-search-taobao-page';
  var runningTokens = {};

  window.addEventListener('message', function (event) {
    var data = event.data || {};
    if (event.source !== window || data.source !== REQUEST_SOURCE) return;
    if (!data.token || !data.imageBase64 || runningTokens[data.token]) return;

    runningTokens[data.token] = true;
    uploadAndJump(data.token, data.imageBase64)
      .catch(function (error) {
        sendResult(data.token, { ok: false, error: errorToMessage(error) });
      })
      .finally(function () {
        delete runningTokens[data.token];
      });
  });

  async function uploadAndJump(token, imageBase64) {
    var errors = [];
    try {
      var streamUrl = await uploadViaStreamUpload(imageBase64);
      jumpToResult(token, streamUrl, 'stream-upload');
      return;
    } catch (error) {
      errors.push('stream-upload: ' + errorToMessage(error));
    }

    try {
      var spaceUrl = await uploadViaImageSpaceUploader('data:image/jpeg;base64,' + imageBase64);
      jumpToResult(token, spaceUrl, 'image-space');
      return;
    } catch (error2) {
      errors.push('image-space: ' + errorToMessage(error2));
    }

    throw new Error(errors.filter(Boolean).join('；') || '淘宝图片上传失败');
  }

  async function uploadViaStreamUpload(imageBase64) {
    var name = randomUploadName() + '.jpg';
    var blob = base64ToBlob(imageBase64, 'image/jpeg');
    var file = new File([blob], name, { type: 'image/jpeg' });
    var form = new FormData();
    form.append('folderId', '0');
    form.append('name', name);
    form.append('file', file);
    form.append('appkey', 'taojianghu_pic_upload');

    var response = await fetch('https://stream-upload.taobao.com/api/upload.api?_input_charset=utf-8', {
      method: 'POST',
      credentials: 'include',
      body: form
    });
    var text = await response.text();
    var payload = parsePayload(text);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (hasExplicitFailure(payload)) throw new Error(findErrorMessage(payload) || '淘宝上传接口返回失败');
    var imageUrl = normalizeImageUrl(findImageUrl(payload) || findImageUrl(text));
    if (imageUrl) return imageUrl;
    throw new Error(findErrorMessage(payload) || findErrorMessage(text) || '淘宝上传接口未返回图片地址');
  }

  async function uploadViaImageSpaceUploader(dataUrl) {
    var Uploader = await waitForValue(function () {
      return window.ImageSpaceUploader;
    }, 8000, '淘宝图片上传器未加载');

    return new Promise(function (resolve, reject) {
      var done = false;
      var started = false;
      var initTimer = null;
      var timeout = null;
      var uploader = null;

      function finish(error, imageUrl) {
        if (done) return;
        done = true;
        window.clearTimeout(initTimer);
        window.clearTimeout(timeout);
        if (error) {
          reject(error);
          return;
        }
        resolve(imageUrl);
      }

      function startUpload() {
        if (started || done) return;
        started = true;
        try {
          uploader.addBase64File(dataUrl, randomUploadName() + '.png');
        } catch (error) {
          finish(error);
        }
      }

      try {
        uploader = new Uploader({
          appkey: 'tblife2_ugc',
          auto: true,
          env: 'prd',
          filters: { mimeTypes: '*' }
        });
        if (typeof uploader.on !== 'function' || typeof uploader.addBase64File !== 'function') {
          throw new Error('淘宝图片上传器接口不可用');
        }
      } catch (error) {
        finish(error);
        return;
      }

      timeout = window.setTimeout(function () {
        finish(new Error('淘宝图片上传超时'));
      }, 22000);
      initTimer = window.setTimeout(startUpload, 5000);
      uploader.on('Init', startUpload);
      uploader.on('FileSuccess', function (payload) {
        var imageUrl = normalizeImageUrl(findImageUrl(payload));
        if (!imageUrl) {
          finish(new Error('淘宝图片上传器未返回图片地址'));
          return;
        }
        finish(null, imageUrl);
      });
      uploader.on('UploadError', function (payload) {
        finish(new Error(findErrorMessage(payload) || errorToMessage(payload) || '淘宝图片上传器失败'));
      });
    });
  }

  function jumpToResult(token, imageUrl, method) {
    var url = buildResultUrl(imageUrl);
    sendResult(token, { ok: true, imageUrl: imageUrl, url: url, method: method });
    window.setTimeout(function () {
      window.location.href = url;
    }, 80);
  }

  function buildResultUrl(imageUrl) {
    var url = new URL('https://s.taobao.com/search');
    url.searchParams.set('imgSearchUrl', encodeURIComponent(imageUrl));
    url.searchParams.set('tab', 'all');
    url.searchParams.set('ie', 'utf8');
    url.searchParams.set('search_type', 'item');
    url.searchParams.set('imgFrom', 'upload');
    return url.toString();
  }

  function parsePayload(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_jsonError) {
      var jsonp = raw.match(/^[^(]+\(([\s\S]*)\)\s*;?$/);
      if (jsonp) {
        try {
          return JSON.parse(jsonp[1]);
        } catch (_jsonpError) {}
      }
      return raw;
    }
  }

  function findImageUrl(value) {
    var seen = [];
    function visit(node) {
      if (!node) return '';
      if (typeof node === 'string') return findImageUrlInText(node);
      if (typeof node !== 'object' || seen.indexOf(node) >= 0) return '';
      seen.push(node);
      var keys = Object.keys(node);
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        var val = node[key];
        if (/^(imageUrl|image_url|imgUrl|url)$/i.test(key) && typeof val === 'string') {
          var normalized = normalizeImageUrl(val);
          if (normalized) return normalized;
        }
      }
      for (var valueIndex = 0; valueIndex < keys.length; valueIndex += 1) {
        var found = visit(node[keys[valueIndex]]);
        if (found) return found;
      }
      return '';
    }
    return visit(value);
  }

  function findImageUrlInText(text) {
    var normalized = String(text || '').replace(/\\\//g, '/').replace(/&amp;/g, '&');
    var keyed = normalized.match(/["'](?:imageUrl|image_url|imgUrl|url)["']\s*:\s*["']((?:https?:)?\/\/[^"']+)["']/i);
    if (keyed) return normalizeImageUrl(keyed[1]);
    var generic = normalized.match(/(?:https?:)?\/\/[^"'\s<>]+/ig) || [];
    for (var index = 0; index < generic.length; index += 1) {
      var url = normalizeImageUrl(generic[index]);
      if (url && /(?:alicdn|tbcdn|taobaocdn)\.com/i.test(url)) return url;
    }
    return '';
  }

  function normalizeImageUrl(value) {
    var url = String(value || '').trim().replace(/\\\//g, '/').replace(/^"+|"+$/g, '');
    if (!url) return '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function hasExplicitFailure(value) {
    if (!value || typeof value !== 'object') return false;
    var keys = Object.keys(value);
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      var val = value[key];
      if (/^(success|ok)$/i.test(key) && (val === false || String(val).toLowerCase() === 'false')) return true;
      if (val && typeof val === 'object' && hasExplicitFailure(val)) return true;
    }
    return false;
  }

  function findErrorMessage(value) {
    if (!value) return '';
    if (typeof value === 'string') {
      var message = value.trim().match(/["'](?:errorMsg|error_msg|message|msg)["']\s*:\s*["']([^"']+)["']/i);
      return message ? message[1] : '';
    }
    if (typeof value !== 'object') return '';
    var keys = ['errorMsg', 'error_msg', 'message', 'msg'];
    for (var index = 0; index < keys.length; index += 1) {
      if (typeof value[keys[index]] === 'string' && value[keys[index]].trim()) return value[keys[index]].trim();
    }
    var objectKeys = Object.keys(value);
    for (var valueIndex = 0; valueIndex < objectKeys.length; valueIndex += 1) {
      var found = findErrorMessage(value[objectKeys[valueIndex]]);
      if (found) return found;
    }
    return '';
  }

  function waitForValue(getter, timeoutMs, timeoutMessage) {
    return new Promise(function (resolve, reject) {
      var startedAt = Date.now();
      var timer = window.setInterval(function () {
        var value = null;
        try {
          value = getter();
        } catch (error) {
          window.clearInterval(timer);
          reject(error);
          return;
        }
        if (value) {
          window.clearInterval(timer);
          resolve(value);
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          window.clearInterval(timer);
          reject(new Error(timeoutMessage));
        }
      }, 120);
    });
  }

  function base64ToBlob(base64, type) {
    var binary = atob(String(base64 || ''));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: type });
  }

  function randomUploadName() {
    return Math.random().toString(16).slice(2, 12) || String(Date.now()).slice(-10);
  }

  function errorToMessage(error) {
    if (typeof error === 'string' && error.trim()) return error.trim();
    var message = findErrorMessage(error) || error && error.message || '';
    if (message) return String(message).trim();
    try {
      var json = JSON.stringify(error);
      if (json && json !== '{}') return json.slice(0, 240);
    } catch (_error) {}
    return '淘宝页面请求失败';
  }

  function sendResult(token, payload) {
    var message = { source: RESULT_SOURCE, token: token };
    Object.keys(payload || {}).forEach(function (key) {
      message[key] = payload[key];
    });
    window.postMessage(message, location.origin);
  }
})();
