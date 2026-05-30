// Cloud/Local 运行模式检测
// 连接 ERP 服务器后自动获取运行模式，决定扩展行为

const RUNTIME_MODE_KEY = 'ozon-calc:runtime-mode';
const RUNTIME_CAPABILITIES_KEY = 'ozon-calc:runtime-capabilities';

function normalizeErpBaseUrl(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/\/+$/, '');
  return text.replace(/\/api\/.*$/, '');
}

async function fetchRuntimeConfig(endpoint, token) {
  var baseUrl = normalizeErpBaseUrl(endpoint);
  if (!baseUrl || !token) return null;
  try {
    const url = baseUrl + '/api/extension/runtime';
    const res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code === 1 && json.data) return json.data;
    return null;
  } catch {
    return null;
  }
}

async function syncRuntimeMode() {
  const result = await chrome.storage.local.get(['ozon-calc:erp-endpoint', 'ozon-calc:erp-token', 'ss_erp_connection']);
  const conn = result.ss_erp_connection || {};
  const endpoint = normalizeErpBaseUrl(result['ozon-calc:erp-endpoint'] || conn.baseUrl);
  const token = String(result['ozon-calc:erp-token'] || conn.token || '').trim();

  if (!endpoint || !token) {
    await chrome.storage.local.set({
      [RUNTIME_MODE_KEY]: 'local',
      [RUNTIME_CAPABILITIES_KEY]: {
        imageUpload: 'local',
        sync: 'direct',
        ozonCdnDirect: true,
        serverSideUpload: false,
        queuedTasks: false,
      },
    });
    return;
  }

  const config = await fetchRuntimeConfig(endpoint, token);
  if (config) {
    await chrome.storage.local.set({
      [RUNTIME_MODE_KEY]: config.mode,
      [RUNTIME_CAPABILITIES_KEY]: config.capabilities,
    });
    console.log('[SS ERP] runtime mode:', config.mode);
  }
}

// 导出给 service-worker 使用
if (typeof self !== 'undefined') {
  self.SS_ERP_RUNTIME = {
    RUNTIME_MODE_KEY,
    RUNTIME_CAPABILITIES_KEY,
    syncRuntimeMode,
    fetchRuntimeConfig,
    normalizeErpBaseUrl,
  };
}
