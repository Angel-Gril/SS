export type OzonExtensionSyncTone = 'success' | 'warning' | 'danger' | 'muted';

export interface OzonExtensionSyncSlotSummary {
  ok?: boolean;
  error?: unknown;
  skipped?: boolean;
  syncedAt?: unknown;
  itemCount?: unknown;
  period?: unknown;
}

export interface OzonExtensionAutoSyncState {
  lastCompanyId?: unknown;
  updatedAt?: unknown;
  cookieAt?: unknown;
  analyticsAt?: unknown;
  graphsAt?: unknown;
  lastResult?: {
    cookie?: OzonExtensionSyncSlotSummary | null;
    analytics?: OzonExtensionSyncSlotSummary | null;
    graphs?: OzonExtensionSyncSlotSummary | null;
  } | null;
}

export interface OzonExtensionSyncStatusInput {
  extensionAvailable: boolean;
  hasErpConnection?: boolean;
  intervalMinutes?: number;
  state?: OzonExtensionAutoSyncState | null;
}

export interface OzonExtensionSyncStatusItem {
  key: 'cookie' | 'analytics' | 'graphs';
  title: string;
  label: string;
  tone: OzonExtensionSyncTone;
  detail: string;
  lastSyncedAt?: string;
  error?: string;
}

export interface OzonExtensionSyncStatus {
  connection: 'connected' | 'disconnected' | 'needs_config';
  connectionLabel: string;
  overallTone: OzonExtensionSyncTone;
  companyId: string;
  updatedAt: string;
  intervalMinutes: number;
  lastError: string;
  items: OzonExtensionSyncStatusItem[];
}

const SLOT_META: Array<{
  key: OzonExtensionSyncStatusItem['key'];
  title: string;
  errorTitle: string;
  timestampKey: keyof Pick<OzonExtensionAutoSyncState, 'cookieAt' | 'analyticsAt' | 'graphsAt'>;
}> = [
  { key: 'cookie', title: 'Cookie', errorTitle: 'Cookie', timestampKey: 'cookieAt' },
  { key: 'analytics', title: '商品分析', errorTitle: '商品分析', timestampKey: 'analyticsAt' },
  { key: 'graphs', title: '图表', errorTitle: '图表', timestampKey: 'graphsAt' },
];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function formatOzonExtensionBridgeError(value: unknown): string {
  const message = text(value);
  if (!message) return '扩展未返回结果';
  const lower = message.toLowerCase();
  if (
    lower.includes('message port closed before a response was received')
    || lower.includes('receiving end does not exist')
    || lower.includes('extension context invalidated')
  ) {
    return '扩展后台暂时未响应，请刷新当前 ERP 页面或在扩展管理页重新加载 SS ERP 扩展。';
  }
  if (lower === 'no response') return '扩展未返回结果，请刷新当前 ERP 页面后重试。';
  return message;
}

function numberValue(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatTime(value: unknown): string {
  const raw = numberValue(value) ?? text(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

function formatResultDetail(result: OzonExtensionSyncSlotSummary | null | undefined, fallbackTime: unknown): string {
  if (result?.error) return text(result.error);
  const count = numberValue(result?.itemCount);
  const period = text(result?.period);
  if (count != null && period) return `${count} 条 · ${period}`;
  if (count != null) return `${count} 条`;
  const syncedAt = formatTime(result?.syncedAt);
  if (syncedAt) return syncedAt;
  const fallback = formatTime(fallbackTime);
  return fallback || '等待同步';
}

function deriveSlot(
  state: OzonExtensionAutoSyncState | null | undefined,
  meta: (typeof SLOT_META)[number],
): OzonExtensionSyncStatusItem {
  const result = state?.lastResult?.[meta.key] || null;
  const error = result?.error ? text(result.error).slice(0, 240) : '';
  const lastSyncedAt = formatTime(result?.syncedAt) || formatTime(state?.[meta.timestampKey]);
  const hasSuccess = result?.ok === true || !!lastSyncedAt;
  const tone: OzonExtensionSyncTone = error ? 'danger' : hasSuccess ? 'success' : result?.skipped ? 'warning' : 'muted';
  return {
    key: meta.key,
    title: meta.title,
    label: error ? `${meta.errorTitle}失败` : meta.title,
    tone,
    detail: formatResultDetail(result, state?.[meta.timestampKey]),
    lastSyncedAt: lastSyncedAt || undefined,
    error: error || undefined,
  };
}

export function deriveOzonExtensionSyncStatus(input: OzonExtensionSyncStatusInput): OzonExtensionSyncStatus {
  const intervalMinutes = numberValue(input.intervalMinutes) ?? 30;
  const state = input.state || null;
  const items = SLOT_META.map((meta) => deriveSlot(state, meta));

  if (!input.extensionAvailable) {
    return {
      connection: 'disconnected',
      connectionLabel: '扩展未连接',
      overallTone: 'muted',
      companyId: text(state?.lastCompanyId),
      updatedAt: formatTime(state?.updatedAt),
      intervalMinutes,
      lastError: '',
      items,
    };
  }

  const needsConfig = input.hasErpConnection === false;
  const lastErrorItem = items.find((item) => item.error);
  const overallTone: OzonExtensionSyncTone = lastErrorItem
    ? 'danger'
    : needsConfig
      ? 'warning'
      : items.some((item) => item.tone === 'success')
        ? 'success'
        : 'muted';

  return {
    connection: needsConfig ? 'needs_config' : 'connected',
    connectionLabel: needsConfig ? '扩展未配置 ERP' : '扩展已连接',
    overallTone,
    companyId: text(state?.lastCompanyId),
    updatedAt: formatTime(state?.updatedAt),
    intervalMinutes,
    lastError: lastErrorItem ? `${lastErrorItem.title}：${lastErrorItem.error}` : '',
    items,
  };
}
