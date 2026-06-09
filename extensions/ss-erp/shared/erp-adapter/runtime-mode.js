// Cloud/Local 运行模式检测
// 连接 ERP 服务器后自动获取运行模式，决定扩展行为

const RUNTIME_MODE_KEY = 'ozon-calc:runtime-mode';
const RUNTIME_CAPABILITIES_KEY = 'ozon-calc:runtime-capabilities';
const RUNTIME_SYNC_STATUS_KEY = 'ozon-calc:runtime-sync-status';

const DEFAULT_LOCAL_CAPABILITIES = {
  imageUpload: 'local',
  sync: 'direct',
  ozonCdnDirect: true,
  serverSideUpload: false,
  queuedTasks: false,
  cookieSync: true,
  presignedUpload: false,
};

function normalizeErpBaseUrl(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/\/+$/, '');
  return text.replace(/\/api\/.*$/, '');
}

function runtimeStatus(ok, details) {
  return {
    ok: Boolean(ok),
    checkedAt: new Date().toISOString(),
    ...(details || {}),
  };
}

function normalizeRuntimeCapabilities(config) {
  if (!config || !config.capabilities) return DEFAULT_LOCAL_CAPABILITIES;
  var mode = config.mode === 'cloud' ? 'cloud' : 'local';
  var capabilities = config.capabilities || {};
  return {
    imageUpload: capabilities.imageUpload || (mode === 'cloud' ? 'oss' : 'local'),
    sync: capabilities.sync || (mode === 'cloud' ? 'queue' : 'direct'),
    ozonCdnDirect: capabilities.ozonCdnDirect === true,
    serverSideUpload: capabilities.serverSideUpload === true,
    queuedTasks: capabilities.queuedTasks === true,
    cookieSync: capabilities.cookieSync === true,
    presignedUpload: capabilities.presignedUpload === true,
  };
}

async function writeLocalRuntimeFallback(reason) {
  await chrome.storage.local.set({
    [RUNTIME_MODE_KEY]: 'local',
    [RUNTIME_CAPABILITIES_KEY]: DEFAULT_LOCAL_CAPABILITIES,
    [RUNTIME_SYNC_STATUS_KEY]: runtimeStatus(false, {
      reason: reason || 'runtime-unavailable',
      fallbackMode: 'local',
    }),
  });
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
    await writeLocalRuntimeFallback('missing-endpoint-or-token');
    return;
  }

  const config = await fetchRuntimeConfig(endpoint, token);
  if (config) {
    var mode = config.mode === 'cloud' ? 'cloud' : 'local';
    await chrome.storage.local.set({
      [RUNTIME_MODE_KEY]: mode,
      [RUNTIME_CAPABILITIES_KEY]: normalizeRuntimeCapabilities(config),
      [RUNTIME_SYNC_STATUS_KEY]: runtimeStatus(true, {
        mode,
        source: config.source || 'runtime-endpoint',
      }),
    });
    console.log('[SS ERP] runtime mode:', mode);
    return;
  }

  await writeLocalRuntimeFallback('runtime-endpoint-unavailable');
}

// 导出给 service-worker 使用
if (typeof self !== 'undefined') {
  self.SS_ERP_RUNTIME = {
    RUNTIME_MODE_KEY,
    RUNTIME_CAPABILITIES_KEY,
    RUNTIME_SYNC_STATUS_KEY,
    DEFAULT_LOCAL_CAPABILITIES,
    syncRuntimeMode,
    fetchRuntimeConfig,
    normalizeErpBaseUrl,
  };
}
