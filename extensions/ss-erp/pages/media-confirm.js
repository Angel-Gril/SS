(function () {
  'use strict';

  var nonce = new URLSearchParams(window.location.hash.slice(1)).get('nonce') || '';
  var titleNode = document.getElementById('confirmTitle');
  var subtitleNode = document.getElementById('confirmSubtitle');
  var targetNode = document.getElementById('confirmTarget');
  var previewSection = document.getElementById('previewSection');
  var previewLink = document.getElementById('previewLink');
  var previewImage = document.getElementById('previewImage');
  var previewMeta = document.getElementById('previewMeta');
  var statusNode = document.getElementById('confirmStatus');
  var cancelButton = document.getElementById('cancelButton');
  var confirmButton = document.getElementById('confirmButton');
  var confirmation = null;
  var busy = false;
  var imageReady = false;
  var expired = false;
  var expiryTimer = null;

  var actionLabels = {
    REVIEW_APPROVE: { title: '通过图片审核', button: '确认通过', status: '确认后将选中这张候选图。' },
    REVIEW_REJECT: { title: '驳回图片结果', button: '确认驳回', status: '确认后该图片任务将标记为已驳回。' },
    APPLY_APPEND: { title: '追加到商品草稿', button: '确认追加', status: '确认后将图片追加到当前商品草稿。' },
  };
  var operationLabels = {
    IMAGE_TO_IMAGE: '参考改图',
    IMAGE_TRANSLATE: '图片翻译',
    FULL_EDIT: '全图编辑',
    INPAINT: '局部重绘',
  };

  function setStatus(message, kind) {
    statusNode.textContent = String(message || '');
    statusNode.className = 'status' + (kind ? ' is-' + kind : '');
  }

  function send(message) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function compactIdentifier(value) {
    var text = String(value || '');
    return text.length > 18 ? text.slice(0, 7) + '...' + text.slice(-7) : text;
  }

  function refreshConfirmButton() {
    confirmButton.disabled = Boolean(busy || expired || !imageReady
      || !confirmation || confirmation.completed);
  }

  function markExpired() {
    expired = true;
    refreshConfirmButton();
    if (!confirmation || !confirmation.completed) {
      setStatus('确认已过期，请回到商品页重新发起。', 'error');
    }
  }

  function scheduleExpiry(expiresAt) {
    if (expiryTimer !== null) window.clearTimeout(expiryTimer);
    var remaining = Number(expiresAt) - Date.now();
    if (!Number.isSafeInteger(remaining) || remaining <= 0) {
      markExpired();
      return;
    }
    expiryTimer = window.setTimeout(markExpired, remaining);
  }

  function render(value) {
    confirmation = value;
    var labels = actionLabels[value.action];
    if (!labels || !value.preview || !value.target) throw new Error('确认内容无效');
    imageReady = false;
    expired = false;
    titleNode.textContent = labels.title;
    subtitleNode.textContent = operationLabels[value.operation] || '图片任务';
    targetNode.textContent = [
      String(value.target.platform || '').toUpperCase() + ' 商品 ' + compactIdentifier(value.target.sourceProductId),
      '店铺 ' + compactIdentifier(value.target.shopId),
      '草稿 ' + compactIdentifier(value.target.listingWorkflowId),
    ].join(' · ');
    targetNode.hidden = false;
    confirmButton.textContent = labels.button;
    previewLink.href = value.preview.url;
    previewImage.src = value.preview.url;
    previewMeta.textContent = value.preview.width && value.preview.height
      ? value.preview.width + ' × ' + value.preview.height
      : value.preview.mimeType;
    previewSection.hidden = false;
    if (value.completed) {
      refreshConfirmButton();
      setStatus('该操作已经完成。', 'success');
      return;
    }
    refreshConfirmButton();
    setStatus('正在加载待确认图片...', '');
    scheduleExpiry(value.expiresAt);
  }

  async function load() {
    if (!/^[a-f0-9]{64}$/.test(nonce)) throw new Error('确认链接无效或已过期');
    var response = await send({
      type: 'ss-erp:source-listing-workbench-media-confirm-read',
      nonce: nonce,
    });
    if (!response || !response.ok || !response.confirmation) {
      throw new Error(response && response.error || '确认内容不可用');
    }
    render(response.confirmation);
  }

  cancelButton.addEventListener('click', function (event) {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || busy) return;
    busy = true;
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    send({
      type: 'ss-erp:source-listing-workbench-media-confirm-cancel',
      nonce: nonce,
    }).catch(function () {}).finally(function () {
      window.close();
    });
  });

  confirmButton.addEventListener('click', function (event) {
    if (!SS_ERP_TRUST_GATE.ok(event, event.currentTarget || event.target) || busy || expired || !imageReady
      || !confirmation || confirmation.completed) return;
    busy = true;
    refreshConfirmButton();
    cancelButton.disabled = true;
    setStatus('正在提交确认...', '');
    send({
      type: 'ss-erp:source-listing-workbench-media-confirm-submit',
      nonce: nonce,
    }).then(function (response) {
      if (!response || !response.ok || !response.result || response.result.state !== 'completed') {
        throw new Error(response && response.error || '图片操作未完成');
      }
      confirmation.completed = true;
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      setStatus('操作已完成，可以关闭此窗口。', 'success');
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), 'error');
      if (Date.now() >= Number(confirmation.expiresAt)) markExpired();
      cancelButton.disabled = false;
    }).finally(function () {
      busy = false;
      refreshConfirmButton();
    });
  });

  previewImage.addEventListener('load', function () {
    imageReady = true;
    refreshConfirmButton();
    if (!expired && confirmation && !confirmation.completed) {
      setStatus(actionLabels[confirmation.action].status, '');
    }
  });

  previewImage.addEventListener('error', function () {
    imageReady = false;
    refreshConfirmButton();
    if (!expired && confirmation && !confirmation.completed) {
      setStatus('图片预览加载失败，请打开原图检查或回到商品页重试。', 'error');
    }
  });

  load().catch(function (error) {
    setStatus(error && error.message ? error.message : String(error), 'error');
    confirmButton.disabled = true;
  });
}());
