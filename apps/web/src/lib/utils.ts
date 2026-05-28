import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: string | number, currency = 'CNY'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(num);
}

// 兜底汇率：在汇率服务未上线 / 未拉到当日汇率时使用
// 仅用于展示，不参与利润结算
const FALLBACK_RATES_TO_CNY: Record<string, number> = {
  CNY: 1,
  RUB: 0.095,
  USD: 7.1,
  EUR: 7.7,
  KZT: 0.014,
  BYN: 2.2,
};

export function convertToCny(amount: string | number, currency: string): number {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return 0;
  if (currency === 'CNY') return num;
  const rate = FALLBACK_RATES_TO_CNY[currency.toUpperCase()] ?? 1;
  return num * rate;
}

// 订单金额展示：优先用后端给的 CNY，缺失时按兜底汇率换算
// 返回 { display, original } —— display 用于主显示，original 用于 tooltip
export function formatOrderAmount(
  amount: string | number,
  currency: string,
  amountCny?: string | number | null,
): { display: string; original: string; isApprox: boolean } {
  const cnyValue = amountCny != null
    ? (typeof amountCny === 'string' ? parseFloat(amountCny) : amountCny)
    : convertToCny(amount, currency);
  const isApprox = amountCny == null && currency !== 'CNY';
  const display = formatCurrency(cnyValue, 'CNY');
  const original = formatCurrency(amount, currency);
  return { display, original, isApprox };
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
