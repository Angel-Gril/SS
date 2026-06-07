export const SOURCE_PLATFORM_LABELS: Record<string, string> = {
  '1688': '1688',
  taobao: '淘宝',
  tmall: '天猫',
  jd: '京东',
  pinduoduo: '拼多多',
  pdd: '拼多多',
  other: '其他',
};

export const SOURCE_PLATFORM_VALUES = new Set(Object.keys(SOURCE_PLATFORM_LABELS));

export function sourcePlatformLabel(sourcePlatform?: string | null) {
  const normalized = sourcePlatform?.trim().toLowerCase();
  if (!normalized) return '货源';
  return SOURCE_PLATFORM_LABELS[normalized] || sourcePlatform || '货源';
}

export function normalizeSourcePlatform(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  return normalized && SOURCE_PLATFORM_VALUES.has(normalized) ? normalized : value || undefined;
}
