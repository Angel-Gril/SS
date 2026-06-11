(function () {
  'use strict';

  var REQUEST_SOURCE = 'ss-erp-image-search-pdd-bridge';
  var RESULT_SOURCE = 'ss-erp-image-search-pdd-page';
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
    var upload = await getPddUploadRequest();
    var blob = base64ToBlob(imageBase64, 'image/jpeg');
    var file = new File([blob], 'ss-erp-ozon-' + Date.now() + '.jpg', { type: 'image/jpeg' });
    var form = new FormData();
    form.append('file', file);

    var payload = await upload('/mille/slow/upload/uploadSearchImage', form, { dataType: 'file' });
    var imageUrl = findImageUrl(payload);
    if (!imageUrl) throw new Error(findErrorMessage(payload) || 'PDD 未返回图片地址');

    var url = 'https://pifa.pinduoduo.com/search?imgUrl=' + encodeURIComponent(imageUrl);
    sendResult(token, { ok: true, imageUrl: imageUrl, url: url });
    window.setTimeout(function () {
      window.location.href = url;
    }, 80);
  }

  async function getPddUploadRequest() {
    var request = await getWebpackModuleExport('ErOA', 'c');
    if (typeof request !== 'function') throw new Error('PDD 页面请求模块不可用');
    return request;
  }

  function getWebpackModuleExport(moduleId, exportKey) {
    return new Promise(function (resolve, reject) {
      var startedAt = Date.now();
      var timer = window.setInterval(function () {
        try {
          var req = captureWebpackRequire();
          if (req) {
            window.clearInterval(timer);
            var mod = req(moduleId);
            resolve(exportKey ? mod && mod[exportKey] : mod);
            return;
          }
        } catch (error) {
          window.clearInterval(timer);
          reject(error);
          return;
        }
        if (Date.now() - startedAt > 10000) {
          window.clearInterval(timer);
          reject(new Error('PDD 页面资源未加载完成'));
        }
      }, 100);
    });
  }

  function captureWebpackRequire() {
    if (window.__ssErpPddWebpackRequire) return window.__ssErpPddWebpackRequire;
    var webpackJsonp = window.webpackJsonp;
    if (!webpackJsonp || typeof webpackJsonp.push !== 'function') return null;
    var chunkId = Date.now();
    var moduleId = 'ss-erp-pdd-' + chunkId;
    var modules = {};
    modules[moduleId] = function (_module, _exports, req) {
      window.__ssErpPddWebpackRequire = req;
    };
    webpackJsonp.push([[chunkId], modules, [[moduleId, chunkId]]]);
    return window.__ssErpPddWebpackRequire || null;
  }

  function findImageUrl(value) {
    var seen = [];
    function visit(node) {
      if (!node || seen.indexOf(node) >= 0) return '';
      if (typeof node === 'string') return /^https?:\/\//i.test(node) ? node : '';
      if (typeof node !== 'object') return '';
      seen.push(node);
      var keys = Object.keys(node);
      for (var index = 0; index < keys.length; index += 1) {
        var key = keys[index];
        var val = node[key];
        if (/^(imageUrl|image_url|imgUrl|url)$/i.test(key) && typeof val === 'string' && /^https?:\/\//i.test(val)) {
          return val;
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

  function findErrorMessage(value) {
    if (!value || typeof value !== 'object') return '';
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

  function errorToMessage(error) {
    if (typeof error === 'string' && error.trim()) return error.trim();
    var message = findErrorMessage(error) || error && error.message || '';
    if (message) return String(message).trim();
    try {
      var json = JSON.stringify(error);
      if (json && json !== '{}') return json.slice(0, 240);
    } catch (_error) {}
    return 'PDD 页面请求失败';
  }

  function base64ToBlob(base64, type) {
    var binary = atob(String(base64 || ''));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: type });
  }

  function sendResult(token, payload) {
    var message = { source: RESULT_SOURCE, token: token };
    Object.keys(payload || {}).forEach(function (key) {
      message[key] = payload[key];
    });
    window.postMessage(message, location.origin);
  }
})();
