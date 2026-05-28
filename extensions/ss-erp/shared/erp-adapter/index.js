(function () {
  function enqueueDraft(type, payload) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({
        type: 'ozon-calc:erp-enqueue',
        payload: {
          queueType: type,
          data: payload || {},
        },
      }, function (response) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || { ok: true });
      });
    });
  }

  window.OZON_CALC_ERP_ADAPTER = {
    enqueueDraft: enqueueDraft,
  };
}());
