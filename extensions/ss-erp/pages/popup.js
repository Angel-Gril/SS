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

  function formatRuntimeError(message) {
    var text = String(message || '');
    if (/Extension context invalidated|context invalidated|Receiving end does not exist/i.test(text)) {
      return '扩展刚刚被重新加载，请关闭并重新打开扩展弹窗后重试。';
    }
    return text || '扩展后台未响应';
  }

  function requestSellerOzonAccess(callback) {
    if (!chrome.permissions || typeof chrome.permissions.request !== 'function') {
      callback({ ok: true });
      return;
    }

    var permissions = { origins: ['https://seller.ozon.ru/*'] };
    chrome.permissions.request(permissions, function (granted) {
      if (chrome.runtime.lastError) {
        callback({ ok: false, error: formatRuntimeError(chrome.runtime.lastError.message) });
        return;
      }
      callback(granted
        ? { ok: true }
        : { ok: false, error: '未授权访问 seller.ozon.ru' });
    });
  }

  function sendRuntimeMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, function (response) {
        if (chrome.runtime.lastError) {
          callback({ ok: false, error: formatRuntimeError(chrome.runtime.lastError.message) });
          return;
        }
        callback(response || { ok: false, error: '无响应' });
      });
    } catch (error) {
      callback({ ok: false, error: formatRuntimeError(error && error.message ? error.message : String(error)) });
    }
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

  function normalizeErpBaseUrl(value) {
    return String(value || '').trim().replace(/\/api\/.*$/, '').replace(/\/+$/, '');
  }

  function getErpConnectionStorage(extraKeys, callback) {
    var keys = ['ss_erp_connection', 'ozon-calc:erp-endpoint', 'ozon-calc:erp-token'];
    (extraKeys || []).forEach(function (key) {
      if (keys.indexOf(key) < 0) keys.push(key);
    });
    chrome.storage.local.get(keys, function (result) {
      var legacyConn = result.ss_erp_connection || {};
      var baseUrl = normalizeErpBaseUrl(result['ozon-calc:erp-endpoint'] || legacyConn.baseUrl);
      var token = String(result['ozon-calc:erp-token'] || legacyConn.token || '').trim();
      if (baseUrl && token && (legacyConn.baseUrl !== baseUrl || legacyConn.token !== token)) {
        chrome.storage.local.set({ ss_erp_connection: { baseUrl: baseUrl, token: token } });
      }
      callback({ baseUrl: baseUrl, token: token }, result);
    });
  }

  // Check ERP connection
  function checkErpConnection() {
    getErpConnectionStorage([], function (conn) {
      var baseUrl = conn.baseUrl;
      var token = conn.token;
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
    sendRuntimeMessage({ type: 'ozon-calculator:status' }, function (response) {
      if (!response || !response.ok) return;
      var counts = response.counts || {};
      setText(sellerCountNode, counts.seller || 0);
      setText(selectedCountNode, response.selectedServiceCount || 0);
      setText(allCountNode, counts.all || 0);
    });
  }

  // Sync handlers
  function getSelectedShopId(callback) {
    getErpConnectionStorage(['ss_erp_selected_shop'], function (conn, result) {
      var baseUrl = conn.baseUrl;
      var token = conn.token;
      if (!baseUrl || !token) return callback(null);

      fetch(baseUrl + '/api/shops', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.code === 1 && data.data && data.data.length > 0) {
            var shops = data.data;
            var ozonShops = shops.filter(function (s) { return String(s.platform || '').toUpperCase() === 'OZON'; });
            var candidates = ozonShops.length ? ozonShops : shops;
            var uiShopId = cookieShopSelect && cookieShopSelect.value ? cookieShopSelect.value : '';
            var uiShop = candidates.find(function (s) { return s.id === uiShopId; });
            if (uiShop) {
              chrome.storage.local.set({ ss_erp_selected_shop: uiShop.id, ss_erp_cookie_shop: uiShop.id });
              return callback(uiShop.id);
            }
            var cachedShopId = result.ss_erp_selected_shop;
            var cachedShop = candidates.find(function (s) { return s.id === cachedShopId; });
            if (cachedShop) return callback(cachedShop.id);

            var id = candidates[0].id;
            chrome.storage.local.set({ ss_erp_selected_shop: id });
            callback(id);
          } else {
            chrome.storage.local.remove(['ss_erp_selected_shop']);
            callback(null);
          }
        }).catch(function () {
          chrome.storage.local.remove(['ss_erp_selected_shop']);
          callback(null);
        });
    });
  }

  if (syncAnalyticsBtn) {
    syncAnalyticsBtn.addEventListener('click', function () {
      syncAnalyticsBtn.disabled = true;
      syncAnalyticsBtn.textContent = '...';
      requestSellerOzonAccess(function (permission) {
        if (!permission.ok) {
          syncAnalyticsBtn.textContent = '需授权';
          setStatus(ozonStatusRow, false, permission.error || '未授权');
          setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2500);
          return;
        }
        getSelectedShopId(function (shopId) {
          if (!shopId) {
            syncAnalyticsBtn.textContent = '无店铺';
            setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2000);
            return;
          }
          readShopAuthInfo(shopId, function (auth) {
            sendRuntimeMessage({
              type: 'spb-self-hosted:sync-shop-analytics',
              shopId: shopId,
              companyId: auth.companyId || undefined
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
            if (response && response.error) setStatus(ozonStatusRow, false, response.error);
          }
          setTimeout(function () { syncAnalyticsBtn.textContent = '同步'; syncAnalyticsBtn.disabled = false; }, 2000);
            });
          });
        });
      });
    });
  }

  if (syncGraphsBtn) {
    syncGraphsBtn.addEventListener('click', function () {
      syncGraphsBtn.disabled = true;
      syncGraphsBtn.textContent = '...';
      requestSellerOzonAccess(function (permission) {
        if (!permission.ok) {
          syncGraphsBtn.textContent = '需授权';
          setStatus(ozonStatusRow, false, permission.error || '未授权');
          setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2500);
          return;
        }
        getSelectedShopId(function (shopId) {
          if (!shopId) {
            syncGraphsBtn.textContent = '无店铺';
            setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2000);
            return;
          }
          readShopAuthInfo(shopId, function (auth) {
            sendRuntimeMessage({
              type: 'spb-self-hosted:sync-shop-graphs',
              shopId: shopId,
              companyId: auth.companyId || undefined
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
            if (response && response.error) setStatus(ozonStatusRow, false, response.error);
          }
          setTimeout(function () { syncGraphsBtn.textContent = '同步'; syncGraphsBtn.disabled = false; }, 2000);
            });
          });
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
  var shopAuthLoadSeq = 0;

  // 加载店铺列表到下拉框
  function loadShopsToSelect() {
    if (!cookieShopSelect) return;
    getErpConnectionStorage(['ss_erp_cookie_shop'], function (conn, result) {
      var baseUrl = conn.baseUrl;
      var token = conn.token;
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
          var cachedShopId = result.ss_erp_cookie_shop;
          var cachedExists = ozonShops.some(function (s) { return s.id === cachedShopId; });
          if (cachedShopId && cachedExists) {
            cookieShopSelect.value = cachedShopId;
            loadShopAuthInfo(cachedShopId);
          } else if (cachedShopId) {
            chrome.storage.local.remove(['ss_erp_cookie_shop']);
          }
        }).catch(function () {});
    });
  }

  // 加载所选店铺的现有认证信息
  function readShopAuthInfo(shopId, callback) {
    if (!shopId) {
      callback({ companyId: '', updatedAt: '' });
      return;
    }
    getErpConnectionStorage([], function (conn) {
      var baseUrl = conn.baseUrl;
      var token = conn.token;
      if (!baseUrl || !token) {
        callback({ companyId: '', updatedAt: '' });
        return;
      }
      fetch(baseUrl + '/api/shops/' + encodeURIComponent(shopId) + '/ozon-cdn-auth', {
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.code === 1 && data.data) {
            callback({
              companyId: data.data.companyId ? String(data.data.companyId) : '',
              updatedAt: data.data.updatedAt || ''
            });
            return;
          }
          callback({ companyId: '', updatedAt: '' });
        }).catch(function () {
          callback({ companyId: '', updatedAt: '' });
        });
    });
  }

  function loadShopAuthInfo(shopId) {
    shopAuthLoadSeq += 1;
    var seq = shopAuthLoadSeq;
    if (cookieCompanyIdInput) {
      cookieCompanyIdInput.value = '';
      cookieCompanyIdInput.placeholder = shopId ? '正在读取该店铺 company_id...' : 'company_id（自动检测/手动输入）';
    }
    renderSyncTime(cookieSyncTime, '');
    if (!shopId) return;
    readShopAuthInfo(shopId, function (auth) {
      if (seq !== shopAuthLoadSeq) return;
      if (cookieCompanyIdInput) {
        cookieCompanyIdInput.value = auth.companyId || '';
        cookieCompanyIdInput.placeholder = auth.companyId ? '已绑定该店铺 company_id' : '该店铺未保存 company_id，可在 seller 当前店铺下同步';
      }
      renderSyncTime(cookieSyncTime, auth.updatedAt || '');
    });
  }

  if (cookieShopSelect) {
    cookieShopSelect.addEventListener('change', function () {
      chrome.storage.local.set({ ss_erp_cookie_shop: cookieShopSelect.value });
      loadShopAuthInfo(cookieShopSelect.value);
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
      requestSellerOzonAccess(function (permission) {
        if (!permission.ok) {
          syncCookieBtn.textContent = '需授权';
          setStatus(ozonStatusRow, false, permission.error || '未授权');
          setTimeout(function () { syncCookieBtn.textContent = '同步'; syncCookieBtn.disabled = false; }, 2500);
          return;
        }
        // 自动读取已检测到的 company_id，手动输入的优先
        chrome.storage.local.get(['ss_erp_ozon_company_id'], function (storageResult) {
          var manualId = cookieCompanyIdInput ? cookieCompanyIdInput.value.trim() : '';
          var autoId = storageResult.ss_erp_ozon_company_id || '';
          var companyId = manualId || autoId;
          if (companyId && cookieCompanyIdInput) cookieCompanyIdInput.value = companyId;

          sendRuntimeMessage({
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
        cookieCompanyIdInput.placeholder = '已自动检测: ' + r.ss_erp_ozon_company_id;
      }
    });
  }
}());
