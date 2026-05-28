(function () {
  'use strict';

  var SYNC_STORAGE_KEY = 'ss_erp_sync_times';
  var STALE_THRESHOLD = 24 * 60 * 60 * 1000;

  var erpStatusRow = document.getElementById('erpStatus');
  var ozonStatusRow = document.getElementById('ozonStatus');
  var analyticsSyncTime = document.getElementById('analyticsSyncTime');
  var graphsSyncTime = document.getElementById('graphsSyncTime');
  var syncAnalyticsBtn = document.getElementById('syncAnalyticsBtn');
  var syncGraphsBtn = document.getElementById('syncGraphsBtn');
  var sellerCountNode = document.getElementById('sellerCount');
  var selectedCountNode = document.getElementById('selectedCount');
  var allCountNode = document.getElementById('allCount');
  var openSettingsBtn = document.getElementById('openSettingsBtn');
  var versionText = document.getElementById('versionText');

  var manifest = chrome.runtime.getManifest();
  if (versionText) versionText.textContent = 'v' + (manifest.version || '1.0.0');

  function setText(node, text) {
    if (node) node.textContent = text == null ? '' : String(text);
  }

  function setStatus(row, connected, label) {
    if (!row) return;
    var dot = row.querySelector('.dot');
    var val = row.querySelector('.status-value');
    if (dot) {
      dot.className = 'dot ' + (connected ? 'dot-green' : 'dot-red');
    }
    if (val) val.textContent = label || (connected ? '已连接' : '未连接');
  }

  function formatTimeAgo(isoStr) {
    if (!isoStr) return '未同步';
    var diff = Date.now() - new Date(isoStr).getTime();
    if (diff < 0) return '刚刚';
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return mins + '分钟前';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + '小时前';
    var days = Math.floor(hours / 24);
    return days + '天前';
  }

  function isStale(isoStr) {
    if (!isoStr) return true;
    return (Date.now() - new Date(isoStr).getTime()) > STALE_THRESHOLD;
  }

  function renderSyncTime(node, isoStr) {
    if (!node) return;
    var text = formatTimeAgo(isoStr);
    node.textContent = text;
    node.className = 'sync-time' + (isStale(isoStr) ? ' warn' : '');
  }

  // Check ERP connection
  function checkErpConnection() {
    chrome.storage.local.get(['ss_erp_connection'], function (result) {
      var conn = result.ss_erp_connection || {};
      var baseUrl = (conn.baseUrl || '').replace(/\/+$/, '');
      var token = conn.token || '';

      if (!baseUrl || !token) {
        setStatus(erpStatusRow, false, '未配置');
        return;
      }

      fetch(baseUrl + '/api/user/me', {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (res) {
        if (res.ok) {
          setStatus(erpStatusRow, true, baseUrl.replace(/https?:\/\//, ''));
        } else {
          setStatus(erpStatusRow, false, 'Token 无效');
        }
      }).catch(function () {
        setStatus(erpStatusRow, false, '无法连接');
      });
    });
  }

  // Check OZON login
  function checkOzonLogin() {
    chrome.tabs.query({ url: 'https://seller.ozon.ru/*' }, function (tabs) {
      if (tabs && tabs.length > 0) {
        setStatus(ozonStatusRow, true, '已登录');
      } else {
        setStatus(ozonStatusRow, false, '未打开');
      }
    });
  }

  // Load sync times
  function loadSyncTimes() {
    chrome.storage.local.get([SYNC_STORAGE_KEY], function (result) {
      var times = result[SYNC_STORAGE_KEY] || {};
      renderSyncTime(analyticsSyncTime, times.analytics);
      renderSyncTime(graphsSyncTime, times.graphs);
    });
  }

  // Load calculator status
  function loadCalculatorStatus() {
    chrome.runtime.sendMessage({ type: 'ozon-calculator:status' }, function (response) {
      if (chrome.runtime.lastError || !response || !response.ok) return;
      var counts = response.counts || {};
      setText(sellerCountNode, counts.seller || 0);
      setText(selectedCountNode, response.selectedServiceCount || 0);
      setText(allCountNode, counts.all || 0);
    });
  }

  // Sync handlers
  function getSelectedShopId(callback) {
    chrome.storage.local.get(['ss_erp_connection', 'ss_erp_selected_shop'], function (result) {
      var shopId = result.ss_erp_selected_shop;
      if (shopId) return callback(shopId);

      var conn = result.ss_erp_connection || {};
      var baseUrl = (conn.baseUrl || '').replace(/\/+$/, '');
      var token = conn.token || '';
      if (!baseUrl || !token) return callback(null);

      fetch(baseUrl + '/api/shops', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.code === 1 && data.data && data.data.length > 0) {
            var ozonShop = data.data.find(function (s) { return s.platform === 'ozon'; });
            var id = ozonShop ? ozonShop.id : data.data[0].id;
            chrome.storage.local.set({ ss_erp_selected_shop: id });
            callback(id);
          } else {
            callback(null);
          }
        }).catch(function () { callback(null); });
    });
  }

  if (syncAnalyticsBtn) {
    syncAnalyticsBtn.addEventListener('click', function () {
      syncAnalyticsBtn.disabled = true;
      syncAnalyticsBtn.textContent = '...';
      getSelectedShopId(function (shopId) {
        if (!shopId) {
          syncAnalyticsBtn.textContent = '无店铺';
          setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2000);
          return;
        }
        chrome.runtime.sendMessage({
          type: 'spb-self-hosted:sync-shop-analytics',
          shopId: shopId
        }, function (response) {
          if (response && response.ok) {
            syncAnalyticsBtn.textContent = 'OK';
            var now = new Date().toISOString();
            chrome.storage.local.get([SYNC_STORAGE_KEY], function (r) {
              var times = r[SYNC_STORAGE_KEY] || {};
              times.analytics = now;
              chrome.storage.local.set({ [SYNC_STORAGE_KEY]: times });
              renderSyncTime(analyticsSyncTime, now);
            });
          } else {
            syncAnalyticsBtn.textContent = '失败';
          }
          setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2000);
        });
      });
    });
  }

  if (syncGraphsBtn) {
    syncGraphsBtn.addEventListener('click', function () {
      syncGraphsBtn.disabled = true;
      syncGraphsBtn.textContent = '...';
      getSelectedShopId(function (shopId) {
        if (!shopId) {
          syncGraphsBtn.textContent = '无店铺';
          setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2000);
          return;
        }
        chrome.runtime.sendMessage({
          type: 'spb-self-hosted:sync-shop-graphs',
          shopId: shopId
        }, function (response) {
          if (response && response.ok) {
            syncGraphsBtn.textContent = 'OK';
            var now = new Date().toISOString();
            chrome.storage.local.get([SYNC_STORAGE_KEY], function (r) {
              var times = r[SYNC_STORAGE_KEY] || {};
              times.graphs = now;
              chrome.storage.local.set({ [SYNC_STORAGE_KEY]: times });
              renderSyncTime(graphsSyncTime, now);
            });
          } else {
            syncGraphsBtn.textContent = '失败';
          }
          setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2000);
        });
      });
    });
  }

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', function (e) {
      e.preventDefault();
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings.html') });
      }
    });
  }

  // Cookie sync button
  var syncCookieBtn = document.getElementById('syncCookieBtn');
  var cookieSyncTime = document.getElementById('cookieSyncTime');
  var cookieShopSelect = document.getElementById('cookieShopSelect');
  var cookieCompanyIdInput = document.getElementById('cookieCompanyIdInput');

  // 加载店铺列表到下拉框
  function loadShopsToSelect() {
    if (!cookieShopSelect) return;
    chrome.storage.local.get(['ss_erp_connection', 'ss_erp_cookie_shop'], function (result) {
      var conn = result.ss_erp_connection || {};
      var baseUrl = (conn.baseUrl || '').replace(/\/+$/, '');
      var token = conn.token || '';
      if (!baseUrl || !token) return;

      fetch(baseUrl + '/api/shops', { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.code !== 1 || !Array.isArray(data.data)) return;
          var ozonShops = data.data.filter(function (s) { return (s.platform || '').toUpperCase() === 'OZON'; });
          while (cookieShopSelect.options.length > 1) cookieShopSelect.remove(1);
          ozonShops.forEach(function (s) {
            var opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name + (s.clientId ? ' (' + s.clientId + ')' : '');
            cookieShopSelect.appendChild(opt);
          });
          if (result.ss_erp_cookie_shop) {
            cookieShopSelect.value = result.ss_erp_cookie_shop;
            loadShopAuthInfo(result.ss_erp_cookie_shop);
          }
        }).catch(function () {});
    });
  }

  // 加载所选店铺的现有认证信息
  function loadShopAuthInfo(shopId) {
    if (!shopId) return;
    chrome.storage.local.get(['ss_erp_connection'], function (result) {
      var conn = result.ss_erp_connection || {};
      var baseUrl = (conn.baseUrl || '').replace(/\/+$/, '');
      var token = conn.token || '';
      if (!baseUrl || !token) return;
      fetch(baseUrl + '/api/shops/' + encodeURIComponent(shopId) + '/ozon-cdn-auth', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.code === 1 && data.data) {
            if (cookieCompanyIdInput && data.data.companyId) {
              cookieCompanyIdInput.value = data.data.companyId;
            }
            if (data.data.updatedAt) {
              renderSyncTime(cookieSyncTime, data.data.updatedAt);
            }
          }
        }).catch(function () {});
    });
  }

  if (cookieShopSelect) {
    cookieShopSelect.addEventListener('change', function () {
      chrome.storage.local.set({ ss_erp_cookie_shop: cookieShopSelect.value });
      if (cookieShopSelect.value) loadShopAuthInfo(cookieShopSelect.value);
    });
  }

  if (syncCookieBtn) {
    syncCookieBtn.addEventListener('click', function () {
      var shopId = cookieShopSelect ? cookieShopSelect.value : '';
      if (!shopId) {
        alert('请先选择目标店铺');
        return;
      }
      syncCookieBtn.disabled = true;
      syncCookieBtn.textContent = '...';
      // 自动读取已检测到的 company_id，手动输入的优先
      chrome.storage.local.get(['ss_erp_ozon_company_id'], function (storageResult) {
        var manualId = cookieCompanyIdInput ? cookieCompanyIdInput.value.trim() : '';
        var autoId = storageResult.ss_erp_ozon_company_id || '';
        var companyId = manualId || autoId;
        if (companyId && cookieCompanyIdInput) cookieCompanyIdInput.value = companyId;

        chrome.runtime.sendMessage({
          type: 'ozon-calc:sync-ozon-cookie',
          payload: { shopId: shopId, companyId: companyId || undefined }
        }, function (response) {
          if (response && response.ok) {
            syncCookieBtn.textContent = 'OK';
            var now = new Date().toISOString();
            chrome.storage.local.get([SYNC_STORAGE_KEY], function (r) {
              var times = r[SYNC_STORAGE_KEY] || {};
              times.cookie = now;
              chrome.storage.local.set({ [SYNC_STORAGE_KEY]: times });
              renderSyncTime(cookieSyncTime, now);
            });
          } else {
            syncCookieBtn.textContent = '失败';
            console.warn('[popup] cookie sync failed:', response && response.error);
            if (response && response.error) alert('同步失败: ' + response.error);
          }
          setTimeout(function () { syncCookieBtn.textContent = '同步'; syncCookieBtn.disabled = false; }, 2000);
        });
      });
    });
  }

  // Load cookie sync time
  function loadCookieSyncTime() {
    chrome.storage.local.get([SYNC_STORAGE_KEY], function (result) {
      var times = result[SYNC_STORAGE_KEY] || {};
      renderSyncTime(cookieSyncTime, times.cookie);
    });
  }

  // Init
  checkErpConnection();
  checkOzonLogin();
  loadSyncTimes();
  loadCalculatorStatus();
  loadCookieSyncTime();
  loadShopsToSelect();
  // 自动回填已检测到的 company_id
  if (cookieCompanyIdInput) {
    chrome.storage.local.get(['ss_erp_ozon_company_id'], function (r) {
      if (r.ss_erp_ozon_company_id && !cookieCompanyIdInput.value) {
        cookieCompanyIdInput.value = r.ss_erp_ozon_company_id;
        cookieCompanyIdInput.placeholder = '已自动检测: ' + r.ss_erp_ozon_company_id;
      }
    });
  }
}());
