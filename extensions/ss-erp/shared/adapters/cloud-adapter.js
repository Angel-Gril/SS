// 云端模式适配器
// 使用 API token、云端队列、OSS 预签名上传
// 不同步 cookie，不依赖本地浏览器登录态

(function () {
  const adapter = {
    name: 'cloud',

    // 云端模式：Bearer token 认证
    async request(path, options) {
      const config = await self.SS_ERP_CONFIG.getConfig();
      const url = config.baseUrl.replace(/\/$/, '') + path;
      const headers = {
        'Content-Type': 'application/json',
        ...(options && options.headers),
      };
      if (config.token) {
        headers['Authorization'] = 'Bearer ' + config.token;
      }
      const res = await fetch(url, {
        ...options,
        headers,
      });
      return res.json();
    },

    // 云端模式：不同步 cookie（服务端会拒绝）
    async syncCookie() {
      return { code: 0, msg: '云端模式不支持 cookie 同步' };
    },

    // 云端模式：采集推送到云端队列
    async submitCollect(payload) {
      const path = payload && Array.isArray(payload.items) ? '/api/collect/batch' : '/api/collect';
      return this.request(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    // 云端模式：图片走 OSS 预签名上传
    async uploadImage(file) {
      const presignRes = await this.request('/api/images/presign', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'image/jpeg',
          sizeBytes: file.size,
        }),
      });

      if (presignRes.code !== 1 || !presignRes.data) {
        return { code: 0, msg: presignRes.msg || '获取上传凭证失败' };
      }

      const { uploadUrl, finalUrl, headers } = presignRes.data;
      try {
        const uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': file.type || 'image/jpeg' },
          body: file,
        });
        if (!uploadRes.ok) {
          return { code: 0, msg: 'OSS 上传失败 (HTTP ' + uploadRes.status + ')' };
        }
      } catch (e) {
        return { code: 0, msg: '网络错误: ' + (e.message || 'unknown') };
      }

      return { code: 1, data: { url: finalUrl } };
    },
  };

  if (typeof self !== 'undefined') self.SS_ERP_CLOUD_ADAPTER = adapter;
  if (typeof window !== 'undefined') window.SS_ERP_CLOUD_ADAPTER = adapter;
}());
