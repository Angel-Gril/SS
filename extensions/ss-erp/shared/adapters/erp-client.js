// 统一 ERP 适配器入口
// 根据当前运行模式自动选择 local 或 cloud adapter

(function () {
  async function getAdapter() {
    const config = await self.SS_ERP_CONFIG.getConfig();
    if (config.isCloud && self.SS_ERP_CLOUD_ADAPTER) {
      return self.SS_ERP_CLOUD_ADAPTER;
    }
    if (self.SS_ERP_LOCAL_ADAPTER) {
      return self.SS_ERP_LOCAL_ADAPTER;
    }
    // fallback: 返回一个最小化的 noop adapter
    return {
      name: 'noop',
      async request() { return { code: 0, msg: 'adapter not loaded' }; },
      async syncCookie() { return { code: 0, msg: 'adapter not loaded' }; },
      async submitCollect() { return { code: 0, msg: 'adapter not loaded' }; },
      async uploadImage() { return { code: 0, msg: 'adapter not loaded' }; },
    };
  }

  // 便捷方法：直接调用当前 adapter 的方法
  const erpClient = {
    async request(path, options) {
      const adapter = await getAdapter();
      return adapter.request(path, options);
    },
    async syncCookie(shopId, cookie, companyId) {
      const adapter = await getAdapter();
      return adapter.syncCookie(shopId, cookie, companyId);
    },
    async submitCollect(payload) {
      const adapter = await getAdapter();
      return adapter.submitCollect(payload);
    },
    async uploadImage(file) {
      const adapter = await getAdapter();
      return adapter.uploadImage(file);
    },
    getAdapter,
  };

  if (typeof self !== 'undefined') self.SS_ERP_CLIENT = erpClient;
  if (typeof window !== 'undefined') window.SS_ERP_CLIENT = erpClient;
}());
