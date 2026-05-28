(function () {
  function getErpConfig(callback) {
    chrome.storage.local.get('ss_erp_connection', function (data) {
      callback(data.ss_erp_connection || {});
    });
  }

  function collectProduct(payload) {
    return new Promise(function (resolve, reject) {
      getErpConfig(function (conn) {
        if (!conn.baseUrl || !conn.token) {
          reject(new Error('请先在扩展设置中配置 ERP 地址和 Token'));
          return;
        }

        var url = conn.baseUrl + '/api/collect';
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + conn.token,
          },
          body: JSON.stringify(payload),
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.code === 1) {
            resolve({ ok: true, type: 'collectProduct', data: data });
          } else {
            reject(new Error(data.msg || '推送失败'));
          }
        })
        .catch(function (err) {
          reject(err);
        });
      });
    });
  }

  window.OZON_CALC_ERP_COLLECT_PRODUCT = {
    collectProduct: collectProduct,
  };
}());
