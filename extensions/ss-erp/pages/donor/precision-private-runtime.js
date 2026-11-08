const REGISTER_UI = 'ss-erp:precision-frame-ui-register';
const forbiddenResponseKey = (key) => /^(?:apikey|authorization|secret|secrets|secretkey|password|accesstoken|refreshtoken|credential|credentials)$/u.test(key.replace(/[_-]/g, '').toLowerCase());

function publicResponse(value, depth = 0, budget = { count: 0 }) {
  if (depth > 16 || ++budget.count > 50000) {
    try { document.documentElement.setAttribute('data-public-response', 'FAIL depth=' + depth + ' count=' + budget.count); } catch (_e) {}
    return false;
  }
  if (!value || typeof value !== 'object') return true;
  if (Array.isArray(value)) return value.every((item) => publicResponse(item, depth + 1, budget));
  return Object.keys(value).every((key) => !forbiddenResponseKey(key) && publicResponse(value[key], depth + 1, budget));
}

export function createPrecisionPrivateRuntime(options = {}) {
  const globals = options.globals || globalThis;
  const nativeRuntime = options.runtime || globals.chrome?.runtime;
  const permissions = options.permissions || globals.chrome?.permissions;
  const settingsApi = globals.SS_ERP_BYOK_PROVIDER_SETTINGS_CLIENT;
  const mediaApi = globals.SS_ERP_BYOK_WORKBENCH_CLIENT;
  const analysisApi = globals.SS_ERP_BYOK_PRODUCT_ANALYSIS_PAGE_CLIENT;
  if (!nativeRuntime?.sendMessage || !settingsApi?.createClient || !mediaApi?.createClient) throw new Error('SS_ERP_PRECISION_PRIVATE_RUNTIME_UNAVAILABLE');
  const settingsTypes = new Set(Object.values(settingsApi.MESSAGE_TYPES));
  const mediaTypes = new Set(Object.values(mediaApi.MESSAGE_TYPES));
  const analysisTypes = new Set(Object.values(analysisApi?.MESSAGE_TYPES || {}));
  let registered = false, mediaReady = false;
  const proxy = {
    get lastError() { return nativeRuntime.lastError; },
    onMessage: nativeRuntime.onMessage,
    sendMessage(message, callback) {
      if (!registered) { callback({ ok: false, errorCode: 'SS_ERP_PRECISION_UI_REGISTRATION_REQUIRED' }); return; }
      if (!settingsTypes.has(message?.type) && !mediaTypes.has(message?.type) && !analysisTypes.has(message?.type)) { callback({ ok: false, errorCode: 'SS_ERP_PRECISION_PRIVATE_MESSAGE_INVALID' }); return; }
      if (mediaTypes.has(message.type) && !mediaReady) { callback({ ok: false, errorCode: 'SS_ERP_PRECISION_MEDIA_SESSION_REQUIRED' }); return; }
      nativeRuntime.sendMessage(message, (response) => {
        if (!publicResponse(response)) { callback({ ok: false, errorCode: 'SS_ERP_PRECISION_PRIVATE_RESPONSE_INVALID' }); return; }
        callback(response);
      });
    },
  };
  const settings = settingsApi.createClient({ runtime: proxy, permissions });
  const media = mediaApi.createClient({ runtime: proxy, BroadcastChannel: globals.BroadcastChannel, URL: globals.URL });
  const analysis = analysisApi?.createClient({ runtime: proxy, permissions });
  function registerUi() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SS_ERP_PRECISION_UI_REGISTRATION_TIMEOUT')), 15000);
      nativeRuntime.sendMessage({ type: REGISTER_UI, payload: {} }, (response) => {
        clearTimeout(timer);
        const data = response?.data;
        if (nativeRuntime.lastError || response?.ok !== true || !data || data.registered !== true
          || !['UI_REGISTERED', 'MEDIA_READY'].includes(data.state) || !publicResponse(response)) {
          registered = mediaReady = false; reject(new Error('SS_ERP_PRECISION_UI_REGISTRATION_FAILED')); return;
        }
        registered = true; mediaReady = data.state === 'MEDIA_READY';
        resolve(Object.freeze({ state: data.state, registered: true }));
      });
    });
  }
  async function checkpointRequest(method, input) {
    // Analysis persistence cannot rely on a previous UI registration surviving
    // settings or media lifecycle changes. Reclaim the actual document normally;
    // the private Worker still checks the exact source, device and draft binding.
    await registerUi();
    return analysis.checkpoint[method](input);
  }
  return Object.freeze({
    settings, media,
    ...(analysis ? { analyzeProduct: analysis.analyzeProduct, readProductAnalysis: analysis.readProductAnalysis,
      getProductAnalysisReadiness: analysis.getReadiness, checkpoint: Object.freeze({
        read: input => checkpointRequest('read', input), write: input => checkpointRequest('write', input),
        clear: input => checkpointRequest('clear', input),
      }),
      prepareProductAnalysisPermission: analysis.prepareProductAnalysisPermission, authorizeProductAnalysis: analysis.authorizeProductAnalysis } : {}),
    state: () => Object.freeze({ registered, mediaReady, available: true }),
    registerUi,
    invalidate() { registered = mediaReady = false; settings.invalidatePreparedPermissions(); analysis?.invalidatePreparedPermissions(); },
  });
}
