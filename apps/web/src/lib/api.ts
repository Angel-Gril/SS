'use client';

import { normalizeLoginReturnTo } from '@/lib/auth-return-to';

const LOCAL_API_PORT = '3001';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isLocalApiBase(value: string): boolean {
  try {
    return isLocalHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function getApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  const trimmedConfigured = configured ? trimTrailingSlash(configured) : '';

  if (typeof window !== 'undefined') {
    const { hostname, origin, protocol } = window.location;
    if (!isLocalHost(hostname)) {
      if (trimmedConfigured && !isLocalApiBase(trimmedConfigured)) return trimmedConfigured;
      return origin;
    }
    if (trimmedConfigured && isLocalApiBase(trimmedConfigured)) {
      const url = new URL(trimmedConfigured);
      url.hostname = hostname;
      return trimTrailingSlash(url.toString());
    }
    if (!trimmedConfigured) {
      return `${protocol}//${hostname}:${LOCAL_API_PORT}`;
    }
  }

  if (trimmedConfigured) return trimmedConfigured;

  return `http://localhost:${LOCAL_API_PORT}`;
}

export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

export type ApiResponseCode = number | string;

export interface ApiResponse<T = unknown> {
  code: ApiResponseCode;
  msg: string;
  data?: T;
  meta?: unknown;
  maintenance?: boolean;
}

export const API_GET_TIMEOUT_MS = 30_000;

export interface ApiRequestOptions extends RequestInit {
  /** Covers both response headers and JSON decoding; writes have no default deadline. */
  timeoutMs?: number;
}

export class ApiRequestTimeoutError extends Error {
  readonly code = 'API_REQUEST_TIMEOUT';

  constructor(readonly timeoutMs: number) {
    super('服务器响应超时，请稍后重试');
    this.name = 'TimeoutError';
  }
}

async function withApiRequestDeadline<T>(
  options: ApiRequestOptions,
  request: (signal?: AbortSignal | null) => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs
    ?? ((options.method || 'GET').toUpperCase() === 'GET' ? API_GET_TIMEOUT_MS : undefined);
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)) {
    throw new RangeError('API timeoutMs must be an integer between 1 and 300000');
  }
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw callerSignal.reason;
  if (timeoutMs === undefined && !callerSignal) return request();

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectInterrupted: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject; });
  const interrupt = (reason: unknown) => {
    rejectInterrupted(reason);
    controller.abort(reason);
  };
  const onCallerAbort = () => interrupt(callerSignal?.reason);
  callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  if (timeoutMs !== undefined) {
    timer = setTimeout(() => interrupt(new ApiRequestTimeoutError(timeoutMs)), timeoutMs);
  }
  try {
    return await Promise.race([request(controller.signal), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

const TOKEN_KEY = 'sserp.token';

export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

function redirectToLoginForCurrentPath() {
  if (typeof window === 'undefined') return;

  const path = window.location.pathname;
  const isAdminArea = path.startsWith('/admin');
  const returnTo = isAdminArea
    ? ''
    : normalizeLoginReturnTo(`${path}${window.location.search}`);
  const loginPath = isAdminArea
    ? '/admin/login'
    : returnTo
      ? `/login?returnTo=${encodeURIComponent(returnTo)}`
      : '/login';
  if (path !== loginPath && !path.startsWith('/login') && !path.startsWith('/admin/login')) {
    window.location.href = loginPath;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const { timeoutMs: _timeoutMs, ...requestOptions } = options;
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');

  return withApiRequestDeadline(options, async (signal) => {
    const res = await fetch(apiUrl(path), {
      ...requestOptions,
      signal,
      headers,
      credentials: 'include',
    });
    // A transport that settles after cancellation must not run stale auth side effects.
    if (signal?.aborted) throw signal.reason;

    if (res.status === 401) {
      tokenStore.clear();
      redirectToLoginForCurrentPath();
    }

    if (res.status === 503) {
      try {
        const data = await res.json();
        if (data?.maintenance) {
          return { code: 0, msg: data.msg || '系统维护中，请稍后再试', maintenance: true } as ApiResponse<T>;
        }
        // Preserve service codes: unavailable transport is not a definitive business rejection.
        return {
          ...(data && typeof data === 'object' ? data : {}),
          code: typeof data?.code === 'string' || typeof data?.code === 'number' ? data.code : 0,
          msg: data?.msg || '服务暂不可用',
        } as ApiResponse<T>;
      } catch {
        if (signal?.aborted) throw signal.reason;
        return { code: 0, msg: '系统维护中，请稍后再试' } as ApiResponse<T>;
      }
    }

    try {
      return await res.json();
    } catch {
      if (signal?.aborted) throw signal.reason;
      return { code: 0, msg: `服务器错误 (${res.status})` } as ApiResponse<T>;
    }
  });
}

export async function apiDownload(
  path: string,
  filename: string,
  options: RequestInit = {},
): Promise<{ ok: true } | { ok: false; msg: string }> {
  const headers = new Headers(options.headers);

  const res = await fetch(apiUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    tokenStore.clear();
    redirectToLoginForCurrentPath();
    return { ok: false, msg: '未登录' };
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({ msg: '下载失败' }));
    return { ok: false, msg: data.msg || '下载失败' };
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { ok: true };
}

export const api = {
  get: <T = unknown>(path: string, options: ApiRequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, options: ApiRequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T = unknown>(path: string, body?: unknown, options: ApiRequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T = unknown>(path: string, body?: unknown, options: ApiRequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: <T = unknown>(path: string, options: ApiRequestOptions = {}) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
  download: apiDownload,
};

export interface DirectUploadResult {
  ok: true;
  url: string;
  key: string;
}

export interface DirectUploadError {
  ok: false;
  msg: string;
}

interface PresignData {
  uploadUrl: string;
  finalUrl: string;
  key: string;
  objectKey: string;
  expiresIn: number;
  maxBytes: number;
  headers: Record<string, string>;
}

const DIRECT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
const DIRECT_UPLOAD_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export async function uploadDirect(file: File): Promise<DirectUploadResult | DirectUploadError> {
  const contentType = normalizeImageMime(file.type || guessImageMime(file.name));
  if (!DIRECT_UPLOAD_ALLOWED_MIME.has(contentType)) {
    return { ok: false, msg: `不支持的文件类型: ${contentType || 'unknown'}` };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, msg: '文件为空，无法上传' };
  }
  if (file.size > DIRECT_UPLOAD_MAX_BYTES) {
    return { ok: false, msg: `图片超出 ${DIRECT_UPLOAD_MAX_BYTES / 1024 / 1024}MB 限制` };
  }

  const presign = await api.post<PresignData>('/api/images/presign', {
    filename: file.name,
    contentType,
    sizeBytes: file.size,
  });

  if (presign.code !== 1 || !presign.data) {
    return { ok: false, msg: presign.msg || '获取上传凭证失败' };
  }

  const { uploadUrl, finalUrl, key, headers, maxBytes } = presign.data;
  if (maxBytes && file.size > maxBytes) {
    return { ok: false, msg: `图片超出 ${maxBytes / 1024 / 1024}MB 限制` };
  }

  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': contentType },
      body: file,
    });
    if (!res.ok) {
      return { ok: false, msg: `OSS 上传失败 (HTTP ${res.status})` };
    }
  } catch (e: any) {
    return { ok: false, msg: `网络错误: ${e?.message || 'unknown'}` };
  }

  return { ok: true, url: finalUrl, key };
}

function normalizeImageMime(value: string): string {
  return value.split(';')[0]!.trim().toLowerCase();
}

function guessImageMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'jpg':
    case 'jpeg':
    default:
      return 'image/jpeg';
  }
}
