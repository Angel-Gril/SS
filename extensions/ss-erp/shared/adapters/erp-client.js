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
      async requestOzonPublishGrant() { return { code: 0, msg: 'adapter not loaded' }; },
      async executeOzonPublish() { return { code: 0, msg: 'adapter not loaded' }; },
      async syncSourceCandidateQuote() { return { code: 0, msg: 'adapter not loaded' }; },
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
    async requestSourceCaptureGrant(operation, payload) {
      const adapter = await getAdapter();
      if (typeof adapter.requestSourceCaptureGrant !== 'function') {
        return { code: 0, errorCode: 'source_capture_v2_not_supported', msg: '当前 ERP 不支持来源采集 V2' };
      }
      return adapter.requestSourceCaptureGrant(operation, payload);
    },
    async submitSourceCaptureV2(operation, payload) {
      const adapter = await getAdapter();
      if (typeof adapter.submitSourceCaptureV2 !== 'function') {
        return { code: 0, errorCode: 'source_capture_v2_not_supported', msg: '当前 ERP 不支持来源采集 V2' };
      }
      return adapter.submitSourceCaptureV2(operation, payload);
    },
    async requestOzonPublishGrant(operation, payload) {
      const adapter = await getAdapter();
      if (typeof adapter.requestOzonPublishGrant !== 'function') {
        return { code: 0, errorCode: 'ozon_publish_grant_not_supported', msg: '当前 ERP 不支持 Ozon 发布授权' };
      }
      return adapter.requestOzonPublishGrant(operation, payload);
    },
    async executeOzonPublish(operation, payload) {
      const adapter = await getAdapter();
      if (typeof adapter.executeOzonPublish !== 'function') {
        return { code: 0, errorCode: 'ozon_publish_executor_not_supported', msg: '当前 ERP 不支持 Ozon 发布执行' };
      }
      return adapter.executeOzonPublish(operation, payload);
    },
    async syncSourceCandidateQuote(payload) {
      const adapter = await getAdapter();
      if (typeof adapter.syncSourceCandidateQuote === 'function') {
        return adapter.syncSourceCandidateQuote(payload);
      }
      return { code: 0, msg: 'adapter does not support source candidate quote sync' };
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
