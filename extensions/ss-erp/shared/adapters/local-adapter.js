// 本地模式适配器
// 保留原有行为：本地 cookie、本地 OZON CDN、直连本地 API

(function () {
  async function fileToDataUrl(file) {
    const mimeType = file.type || 'image/jpeg';
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return 'data:' + mimeType + ';base64,' + btoa(binary);
  }

  const adapter = {
    name: 'local',

    // 本地模式：保留 cookie 行为，同时兼容现有 Bearer token 配置。
    async request(path, options) {
      const config = await self.SS_ERP_CONFIG.getConfig();
      const url = config.baseUrl.replace(/\/$/, '') + path;
      const headers = { ...((options && options.headers) || {}) };
      if (config.token) {
        headers.Authorization = 'Bearer ' + config.token;
      }
      const res = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
      return res.json();
    },

    // 本地模式：cookie 同步到本地服务器
    async syncCookie(shopId, cookie, companyId) {
      return this.request('/api/extension/sync-cookie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId, cookie, companyId }),
      });
    },

    // 本地模式：采集直接推到本地 API
    async submitCollect(payload) {
      const path = payload && Array.isArray(payload.items) ? '/api/collect/batch' : '/api/collect';
      return this.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },

    // 本地模式：图片走本地上传或 OZON CDN
    async uploadImage(file) {
      const dataUrl = await fileToDataUrl(file);
      return this.request('/api/images/upload-base64', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl,
          filename: file.name || 'upload.jpg',
        }),
      });
    },
  };

  if (typeof self !== 'undefined') self.SS_ERP_LOCAL_ADAPTER = adapter;
  if (typeof window !== 'undefined') window.SS_ERP_LOCAL_ADAPTER = adapter;
}());
