/**
 * 已废弃 — 这个脚本误把"俄语+人民币"页面采集的 CNY 数据当成 RUB 转换，
 * 导致 80 条记录的价格变成原值的 0.078 倍。
 *
 * 已通过 rollback-supply-mark.ts 回滚。请勿再次运行此脚本。
 *
 * 正确的做法：扩展端识别页面货币符号（₽/¥/$）后，显式传 currency 字段给后端。
 * 后端只在扩展明确传了非 CNY 时才走汇率换算。
 */
console.error('This script is deprecated and unsafe. Do not run it.');
process.exit(1);
