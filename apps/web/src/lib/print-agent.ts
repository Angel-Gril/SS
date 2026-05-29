/**
 * 物流面单打印工具
 * 支持浏览器打印（默认）和本地打印代理（预留）
 */

export interface PrintAgentConfig {
  enabled: boolean;
  url: string; // default: http://localhost:9100
}

export const DEFAULT_PRINT_AGENT_CONFIG: PrintAgentConfig = {
  enabled: false,
  url: 'http://localhost:9100',
};

/** 检测本地打印代理是否在线 */
export async function checkAgent(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 通过本地代理打印 PDF */
export async function printViaAgent(
  url: string,
  pdfBlob: Blob,
  options?: { copies?: number },
): Promise<boolean> {
  try {
    const formData = new FormData();
    formData.append('file', pdfBlob, 'label.pdf');
    if (options?.copies && options.copies > 1) {
      formData.append('copies', String(options.copies));
    }
    const res = await fetch(`${url}/print`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 浏览器打印 PDF（通过隐藏 iframe） */
export async function printViaBrowser(pdfBlob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(pdfBlob);
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        reject(e);
      }
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(url);
        resolve();
      }, 10000);
    };
    iframe.onerror = () => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
      reject(new Error('PDF 加载失败'));
    };
  });
}

/** 下载面单 PDF Blob */
export async function fetchLabelBlob(
  orderId: string,
  token: string | null,
  apiBase: string,
): Promise<Blob> {
  const res = await fetch(`${apiBase}/api/orders/${orderId}/label`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json();
    throw new Error(data.msg || '面单下载失败');
  }

  if (!res.ok) {
    throw new Error(`面单下载失败 (${res.status})`);
  }

  return res.blob();
}

/** 统一打印入口 */
export async function printLabel(
  orderId: string,
  token: string | null,
  apiBase: string,
  config: PrintAgentConfig,
): Promise<void> {
  const blob = await fetchLabelBlob(orderId, token, apiBase);

  if (config.enabled) {
    const online = await checkAgent(config.url);
    if (online) {
      const success = await printViaAgent(config.url, blob);
      if (success) return;
      // 代理打印失败，回退到浏览器打印
    }
    // 代理不在线，回退到浏览器打印
  }

  await printViaBrowser(blob);
}
