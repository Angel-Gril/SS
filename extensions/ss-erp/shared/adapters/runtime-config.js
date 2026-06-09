// 扩展运行时配置 — 统一读取 mode / baseUrl / token
// 所有模块通过此文件获取当前运行环境

(function () {
  const STORAGE_KEYS = {
    endpoint: 'ozon-calc:erp-endpoint',
    token: 'ozon-calc:erp-token',
    mode: 'ozon-calc:runtime-mode',
    capabilities: 'ozon-calc:runtime-capabilities',
  };

  const DEFAULT_LOCAL_CONFIG = {
    mode: 'local',
    baseUrl: 'http://127.0.0.1:3001',
    token: '',
    capabilities: {
      imageUpload: 'local',
      sync: 'direct',
      ozonCdnDirect: true,
      serverSideUpload: false,
      queuedTasks: false,
      cookieSync: true,
      presignedUpload: false,
    },
  };

  function normalizeErpBaseUrl(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    text = text.replace(/\/+$/, '');
    return text.replace(/\/api\/.*$/, '');
  }

  async function getConfig() {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.endpoint,
      STORAGE_KEYS.token,
      STORAGE_KEYS.mode,
      STORAGE_KEYS.capabilities,
      'ss_erp_connection',
    ]);

    const conn = result.ss_erp_connection || {};
    const endpoint = normalizeErpBaseUrl(result[STORAGE_KEYS.endpoint] || conn.baseUrl);
    const token = String(result[STORAGE_KEYS.token] || conn.token || '').trim();
    const mode = result[STORAGE_KEYS.mode] || 'local';
    const capabilities = result[STORAGE_KEYS.capabilities] || DEFAULT_LOCAL_CONFIG.capabilities;

    return {
      mode,
      baseUrl: endpoint || DEFAULT_LOCAL_CONFIG.baseUrl,
      token,
      hasToken: Boolean(token),
      capabilities,
      isCloud: mode === 'cloud',
      isLocal: mode === 'local' || mode !== 'cloud',
    };
  }

  if (typeof self !== 'undefined') {
    self.SS_ERP_CONFIG = { getConfig, normalizeErpBaseUrl, STORAGE_KEYS, DEFAULT_LOCAL_CONFIG };
  }
  if (typeof window !== 'undefined') {
    window.SS_ERP_CONFIG = { getConfig, normalizeErpBaseUrl, STORAGE_KEYS, DEFAULT_LOCAL_CONFIG };
  }
}());
