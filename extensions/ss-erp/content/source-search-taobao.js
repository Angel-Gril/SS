(function () {
  'use strict';

  var STORAGE_KEY = 'ss-erp:image-search-jobs';
  var REQUEST_SOURCE = 'ss-erp-image-search-taobao-bridge';
  var RESULT_SOURCE = 'ss-erp-image-search-taobao-page';
  var STATUS_ID = 'ss-erp-taobao-image-search-status';

  if (window.__ssErpTaobaoImageSearchBridgeLoaded) return;
  window.__ssErpTaobaoImageSearchBridgeLoaded = true;

  var params = readParams();
  if (params.get('ssErpImageSearch') !== 'taobao') return;

  var token = params.get('ssErpImageSearchToken') || '';
  if (!token) return;

  chrome.storage.local.get([STORAGE_KEY], function (items) {
    var jobs = items && items[STORAGE_KEY] && typeof items[STORAGE_KEY] === 'object'
      ? items[STORAGE_KEY]
      : {};
    var job = jobs[token];
    if (!job || !job.imageBase64 || job.platform !== 'taobao') {
      console.warn('[SS ERP] Taobao image search job not found:', token);
      showBridgeStatus('未找到搜图任务，请回到 Ozon 商品页重新点击核价找货源。', true);
      return;
    }
    if (job.status === 'uploading') {
      showBridgeStatus('这次淘宝搜图任务已经发起过，请等待当前页面结果。', true, job.imagePreviewDataUrl, job.imageSize);
      return;
    }

    var activeJob = Object.assign({}, job, {
      status: 'uploading',
      startedAt: Date.now(),
      attempts: Number(job.attempts || 0) + 1
    });
    jobs[token] = activeJob;

    var update = {};
    update[STORAGE_KEY] = jobs;
    chrome.storage.local.set(update, function () {
      showBridgeStatus('正在上传 Ozon 主图到淘宝搜图...', false, activeJob.imagePreviewDataUrl, activeJob.imageSize);
      window.addEventListener('message', function (event) {
        var data = event.data || {};
        if (event.source !== window || data.source !== RESULT_SOURCE || data.token !== token) return;
        if (data.ok) {
          delete jobs[token];
          var cleanup = {};
          cleanup[STORAGE_KEY] = jobs;
          chrome.storage.local.set(cleanup);
          showBridgeStatus('淘宝已接收图片，正在打开搜图结果...', false, activeJob.imagePreviewDataUrl, activeJob.imageSize);
        } else if (data.error) {
          console.warn('[SS ERP] Taobao image search failed:', data.error);
          activeJob.status = 'failed';
          activeJob.failedAt = Date.now();
          activeJob.lastError = data.error;
          jobs[token] = activeJob;
          var failed = {};
          failed[STORAGE_KEY] = jobs;
          chrome.storage.local.set(failed);
          showBridgeStatus('淘宝搜图失败：' + data.error, true, activeJob.imagePreviewDataUrl, activeJob.imageSize);
        }
      });

      injectPageBridge(function () {
        window.postMessage({
          source: REQUEST_SOURCE,
          token: token,
          imageBase64: activeJob.imageBase64
        }, location.origin);
      });
    });
  });

  function injectPageBridge(onReady) {
    if (window.__ssErpTaobaoImageSearchPageBridgeInjected) {
      onReady();
      return;
    }
    window.__ssErpTaobaoImageSearchPageBridgeInjected = true;
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/source-search-taobao-page.js');
    script.onload = function () {
      script.remove();
      onReady();
    };
    script.onerror = function () {
      showBridgeStatus('淘宝搜图桥接脚本加载失败。', true);
    };
    (document.head || document.documentElement).appendChild(script);
  }

  function readParams() {
    var merged = new URLSearchParams(location.search);
    var hash = location.hash.replace(/^#/, '');
    if (hash) {
      var hashParams = new URLSearchParams(hash);
      hashParams.forEach(function (value, key) {
        merged.set(key, value);
      });
    }
    return merged;
  }

  function showBridgeStatus(message, isError, previewDataUrl, imageSize) {
    var node = document.getElementById(STATUS_ID);
    if (!node) {
      node = document.createElement('div');
      node.id = STATUS_ID;
      node.style.cssText = [
        'position:fixed',
        'top:18px',
        'right:18px',
        'z-index:2147483647',
        'max-width:360px',
        'padding:10px 12px',
        'border-radius:6px',
        'box-shadow:0 6px 24px rgba(0,0,0,.16)',
        'font:14px/1.5 Arial,Microsoft YaHei,sans-serif',
        'background:#fff',
        'color:#222',
        'border:1px solid rgba(0,0,0,.12)'
      ].join(';');
      document.documentElement.appendChild(node);
    }
    node.innerHTML = '';
    var text = document.createElement('div');
    text.textContent = message;
    node.appendChild(text);
    if (previewDataUrl) {
      var img = document.createElement('img');
      img.src = previewDataUrl;
      img.alt = 'Ozon image preview';
      img.style.cssText = 'display:block;width:96px;height:96px;object-fit:contain;margin-top:8px;border:1px solid rgba(0,0,0,.12);background:#fff';
      node.appendChild(img);
      if (imageSize) {
        var size = document.createElement('div');
        size.textContent = imageSize;
        size.style.cssText = 'margin-top:4px;color:#666;font-size:12px';
        node.appendChild(size);
      }
    }
    node.style.borderColor = isError ? '#dc2626' : 'rgba(0,0,0,.12)';
    node.style.color = isError ? '#b91c1c' : '#222';
  }
})();
