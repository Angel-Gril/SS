export interface ExtensionBridgeResponse<T = unknown> {
  ok?: boolean;
  data?: T;
  error?: string;
}

export function sendToExtension<T = unknown>(
  message: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<ExtensionBridgeResponse<T>> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: '当前环境无法连接扩展' });
  }
  const requestId = `extension-device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response: ExtensionBridgeResponse<T>) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(response);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.direction !== 'ss-erp:from-extension' || data.requestId !== requestId) return;
      finish((data.response || { ok: false, error: '扩展未返回结果' }) as ExtensionBridgeResponse<T>);
    };
    const timer = window.setTimeout(() => {
      finish({ ok: false, error: '未检测到 SS ERP 扩展，请确认已安装并刷新当前页面' });
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({
      direction: 'ss-erp:to-extension',
      requestId,
      message,
    }, window.location.origin);
  });
}
