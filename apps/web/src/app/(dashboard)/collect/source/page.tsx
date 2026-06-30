'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Droplets,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  Languages,
  Loader2,
  RefreshCw,
  Search,
  Store,
  Save,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { evaluateSourceListingFieldDiagnostics, evaluateSourceListingReadiness, sourceListingStatusLabel } from '@/lib/source-listing-readiness';
import type { SourceListingFieldDiagnostic, SourceListingFieldDiagnosticStatus } from '@/lib/source-listing-readiness';
import { formatDate } from '@/lib/utils';
import { normalizeSourceStandardAttributes } from 'shared/source-standard-attributes';

type PlatformFilter = 'all' | '1688' | 'pdd' | 'taobao' | 'tmall' | 'xianyu';
type DetailSection = 'overview' | 'sku' | 'attributes' | 'images' | 'translation' | 'listing';
type BadgeTone = 'ok' | 'warn' | 'muted' | 'info';

interface ReadinessBadge {
  label: string;
  tone: BadgeTone;
  title?: string;
}

interface SourceCollectItem {
  id: string;
  title: string;
  sourceUrl: string | null;
  sourcePlatform: string | null;
  sourceProductId: string | null;
  sku: string | null;
  images: string[] | null;
  purchasePrice: string | null;
  currency: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
  variants?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
}

type SourceStandardModel = ReturnType<typeof normalizeSourceStandardAttributes>;
interface OzonShopOption {
  id: string;
  name: string;
  platform: string;
}

interface AiContentStructuredDraft {
  title?: string;
  description?: string;
  bulletPoints?: string[];
  searchTags?: string[];
  warnings?: string[];
  confidence?: number;
}

interface AiContentDraft {
  text: string;
  structured?: AiContentStructuredDraft;
  source: 'cache' | 'provider';
  provider: string;
  model: string;
  generatedAt: string;
  usage?: Record<string, unknown> | null;
}

interface SourceOzonCategoryCandidate {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  categoryNameZh?: string;
  typeNameZh?: string;
  displayPathZh?: string;
  displayPathRu?: string;
  translationStatus?: 'complete' | 'partial' | 'missing' | string;
  untranslatedTerms?: string[];
  score: number;
  label: 'recommended' | 'optional' | 'risky';
  selected: boolean;
  source: string;
  confirmationCount: number;
  reasons: string[];
  attributePlan: {
    candidates: Array<{ standardKey: string; attributeName: string; values: string[]; needsDictionaryResolution: boolean }>; 
    missingRequired: Array<{ attributeId: number; attributeName: string; standardKey: string; reason: string }>; 
  };
}

interface SourceOzonCategoryCandidateResponse {
  signature: string;
  candidates: SourceOzonCategoryCandidate[];
}

interface PackageFormState {
  weightG: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
}

const platformTabs: Array<{ key: PlatformFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: '1688', label: '1688' },
  { key: 'pdd', label: 'PDD' },
  { key: 'taobao', label: '淘宝' },
  { key: 'tmall', label: '天猫' },
  { key: 'xianyu', label: '闲鱼' },
];

const detailSections: Array<{ key: DetailSection; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'sku', label: 'SKU' },
  { key: 'attributes', label: '属性' },
  { key: 'images', label: '图片' },
  { key: 'translation', label: '翻译' },
  { key: 'listing', label: '上架检查' },
];

const sourceListingStatusLegend = '可上架 / 待复核 / 阻断 / 真实商品标题 / 俄文标题/描述 / Ozon 类目/type / Ozon 必填属性/字典值 / 颜色尺码变体 / 重量 / 包装尺寸 / 销售受限/出口限制';
const SOURCE_CYRILLIC_TEXT_RE = /[А-Яа-яЁё]/;
const SOURCE_CJK_TEXT_RE = /[\u3400-\u9fff]/;
const SOURCE_PUBLISH_SHOP_STORAGE_KEY = 'ss-erp:source-publish:last-ozon-shop-id';

function normalizePlatform(value: unknown): PlatformFilter | 'other' {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('1688')) return '1688';
  if (text.includes('pdd') || text.includes('pinduoduo') || text.includes('yangkeduo')) return 'pdd';
  if (text.includes('tmall') || text.includes('天猫')) return 'tmall';
  if (text.includes('xianyu') || text.includes('goofish') || text.includes('闲鱼')) return 'xianyu';
  if (text.includes('taobao') || text.includes('淘宝')) return 'taobao';
  return 'other';
}

function platformLabel(value: unknown): string {
  const platform = normalizePlatform(value);
  if (platform === 'pdd') return 'PDD';
  if (platform === 'taobao') return '淘宝';
  if (platform === 'tmall') return '天猫';
  if (platform === 'xianyu') return '闲鱼';
  if (platform === '1688') return '1688';
  return String(value || '货源');
}

function sourceVideoCount(item: SourceCollectItem): number {
  const videos = item.metadata?.sourceVideos;
  return Array.isArray(videos) ? videos.length : 0;
}

function sourceVideoRows(item: SourceCollectItem): Array<Record<string, unknown>> {
  return sourceMetadataArray(item, 'sourceVideos')
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry));
}

function sourceVideoMaterialRows(item: SourceCollectItem): Array<Record<string, unknown>> {
  return sourceVideoRows(item).map((row) => {
    const url = String(row.originalUrl || row.url || '').trim();
    const coverUrl = String(row.coverUrl || row.cover || row.poster || row.preview || row.thumbnail || '').trim();
    const title = String(row.title || row.name || row.caption || '').trim();
    return {
      ...(url ? { url } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(title ? { title } : {}),
      transferStatus: 'collected',
      transferReason: 'publish_time_ozon_upload',
    };
  }).filter((row) => String(row.url || '').trim());
}

function sourceVideoTransferEntries(item: SourceCollectItem): Array<Record<string, unknown>> {
  const transfer = sourceRecord(item.metadata?.sourceVideoTransfer);
  const entries = transfer.entries;
  return Array.isArray(entries)
    ? entries.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}

function sourceVideoStatusLabel(value: unknown): string {
  const status = String(value || '').trim();
  if (status === 'collected') return '已采集源视频';
  if (status === 'publish_time_ozon_upload') return '发布时上传Ozon视频';
  if (status === 'uploaded') return '已转存';
  if (status === 'ozon_cdn_ready') return 'Ozon视频可自动绑定';
  if (status === 'playlist_unsupported') return 'm3u8暂不支持';
  if (status === 'blocked') return '防盗链/不可直连';
  if (status === 'not_video') return '非视频响应';
  if (status === 'too_large') return '视频过大';
  if (status === 'download_timeout') return '源站下载超时';
  if (status === 'failed' || status === 'transfer_failed') return '转存失败';
  if (status === 'skipped') return '未转存';
  return status || '待诊断';
}

function sourceVideoEffectiveStatus(statusValue: unknown, reasonValue: unknown, messageValue: unknown): string {
  const status = String(statusValue || '').trim();
  const reason = String(reasonValue || '').trim();
  const message = String(messageValue || '').trim();
  if (status === 'download_timeout' || reason === 'download_timeout' || /timeout|timed out|aborted|超时/i.test(message)) {
    return 'download_timeout';
  }
  return status || reason;
}

function sourceVideoStatusClass(value: unknown): string {
  const status = String(value || '').trim();
  if (status === 'collected' || status === 'publish_time_ozon_upload') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'uploaded' || status === 'ozon_cdn_ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'blocked' || status === 'playlist_unsupported' || status === 'failed' || status === 'transfer_failed' || status === 'download_timeout') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function sourceVideoTransferSummary(item: SourceCollectItem): string {
  const transfer = sourceRecord(item.metadata?.sourceVideoTransfer);
  const entries = sourceVideoTransferEntries(item);
  if (!Object.keys(transfer).length && !entries.length) return sourceVideoCount(item) ? '待诊断' : '无视频';
  const transferred = Number(transfer.transferred || 0);
  const skipped = Number(transfer.skipped || 0);
  const failed = Array.isArray(transfer.errors) ? transfer.errors.length : 0;
  const ozonReady = entries.filter((entry) => String(entry.status || '') === 'ozon_cdn_ready').length;
  return [
    transferred ? `已转存 ${transferred}` : '',
    ozonReady ? `Ozon视频可自动绑定 ${ozonReady}` : '',
    skipped ? `未转存 ${skipped}` : '',
    failed ? `失败 ${failed}` : '',
  ].filter(Boolean).join(' / ') || '待诊断';
}

function sourceVideoTransferEntryFor(video: Record<string, unknown>, entries: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const keys = new Set([
    String(video.url || '').trim(),
    String(video.originalUrl || '').trim(),
  ].filter(Boolean));
  return entries.find((entry) => {
    const url = String(entry.url || '').trim();
    const originalUrl = String(entry.originalUrl || '').trim();
    return (url && keys.has(url)) || (originalUrl && keys.has(originalUrl));
  }) || null;
}

function sourceMetadataArray(item: SourceCollectItem, key: string): unknown[] {
  const value = item.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function sourceImageCount(item: SourceCollectItem): number {
  const sourceMainImages = sourceMetadataArray(item, 'sourceMainImages');
  return sourceMainImages.length || (Array.isArray(item.images) ? item.images.length : 0);
}

function isPreviewableSourceImage(value: unknown): boolean {
  const url = String(value || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const lower = url.toLowerCase();
  if (/\.(svg)(?:[?#]|$)/i.test(lower)) return false;
  if (/(logo|icon|avatar|badge|coupon|qrcode|qr-code|play_btn|playbtn|operate|operation|\/cms\/|55-tps|-tps-|2-tps|gg_dtc|160-160|44-45|24-24|16-16)/i.test(lower)) return false;
  if (/[-_/]rate(?:[._/-]|$)/i.test(lower)) return false;
  if (/imgextra\/i\d\/600000\d+\/.*(?:-tps-|gg_dtc|160-160|44-45|24-24|16-16)/i.test(lower)) return false;
  const sizeMatch = lower.match(/(?:[-_/])(\d{1,4})[-x](\d{1,4})(?:[._/-]|$)/);
  if (sizeMatch && (Number(sizeMatch[1]) < 220 || Number(sizeMatch[2]) < 220)) return false;
  return true;
}

function sourcePreviewImages(item: SourceCollectItem): string[] {
  const sourceMainImages = sourcePreviewableImageList(sourceMetadataArray(item, 'sourceMainImages'));
  if (sourceMainImages.length) return sourceMainImages;
  return sourcePreviewableImageList(Array.isArray(item.images) ? item.images : []);
}

function sourceMainPreviewImage(item: SourceCollectItem): string {
  return sourcePreviewImages(item)[0] || '';
}

function sourcePreviewableImageList(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url) || !isPreviewableSourceImage(url)) return;
    seen.add(url);
    out.push(url);
  });
  return out;
}

function sourceDetailImageCount(item: SourceCollectItem): number {
  return sourceMetadataArray(item, 'sourceDetailImages').length;
}

function sourceDetailPreviewImages(item: SourceCollectItem): string[] {
  return sourcePreviewableImageList(sourceMetadataArray(item, 'sourceDetailImages'));
}

function sourcePackagingRows(item: SourceCollectItem): Array<Record<string, unknown>> {
  return sourceMetadataArray(item, 'sourcePackagingRows')
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry));
}

function sourceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sourceProductProfile(item: SourceCollectItem): Record<string, unknown> {
  return sourceRecord(item.metadata?.sourceProductProfile);
}

function sourcePackagingProfile(item: SourceCollectItem): Record<string, unknown> {
  const profilePackaging = sourceRecord(sourceProductProfile(item).packaging);
  if (Object.keys(profilePackaging).length) return profilePackaging;
  const diagnostics = sourceRecord(item.metadata?.extractionDiagnostics);
  const diagnosticPackaging = sourceRecord(diagnostics.packaging);
  if (Object.keys(diagnosticPackaging).length) return diagnosticPackaging;
  return {};
}

function sourcePackagingReasonText(item: SourceCollectItem): string {
  const packaging = sourcePackagingProfile(item);
  const explicit = String(packaging.reasonLabel || packaging.message || '').trim();
  if (explicit) return explicit;
  const reasonCode = String(packaging.reasonCode || packaging.reason || '').trim();
  const labels: Record<string, string> = {
    complete_rows: '已采到包装重量和尺寸',
    parsed_rows: '已采到包装重量和尺寸',
    weight_only: '只采到重量，缺包装尺寸',
    dimensions_only: '只采到包装尺寸，缺重量',
    no_packaging_table: '页面没有包装表',
    page_no_packaging_table: '页面没有包装表',
    packaging_table_parse_failed: '有包装表但未解析出件重尺',
    table_parse_failed: '有包装表但未解析出件重尺',
  };
  if (labels[reasonCode]) return labels[reasonCode];
  const rows = sourcePackagingRows(item);
  const standard = sourceStandardAttributeModel(item);
  if (rows.length || (standard.packageWeightG && standard.packageDimensionsMm)) return '已采到包装重量和尺寸';
  if (standard.packageWeightG) return '只采到重量，缺包装尺寸';
  if (standard.packageDimensionsMm) return '只采到包装尺寸，缺重量';
  return '';
}

function sourcePackagingEvidence(item: SourceCollectItem): { metric: string; checklistLabel: string; done: boolean; reasonLabel: string } {
  const rows = sourcePackagingRows(item);
  const packaging = sourcePackagingProfile(item);
  const reasonLabel = sourcePackagingReasonText(item);
  if (rows.length) return { metric: String(rows.length), checklistLabel: `包装信息 ${rows.length}`, done: true, reasonLabel };

  const standard = sourceStandardAttributeModel(item);
  const parts = [
    standard.packageWeightG ? '重量' : '',
    standard.packageDimensionsMm ? '尺寸' : '',
  ].filter(Boolean);
  if (!parts.length) {
    const status = String(packaging.status || '');
    const metric = status === 'parse_failed' ? '解析失败' : status === 'no_section' ? '无包装表' : '0';
    return { metric, checklistLabel: `包装信息 ${reasonLabel || metric}`, done: false, reasonLabel };
  }
  return { metric: parts.join('/'), checklistLabel: `包装信息 ${parts.join('/')}`, done: true, reasonLabel };
}

function sourcePackagingBadge(item: SourceCollectItem): ReadinessBadge {
  const rows = sourcePackagingRows(item);
  const standard = sourceStandardAttributeModel(item);
  const packaging = sourcePackagingProfile(item);
  const status = String(packaging.status || '').trim();
  const reasonCode = String(packaging.reasonCode || packaging.reason || '').trim();
  const reasonLabel = sourcePackagingReasonText(item);
  const marker = status || reasonCode;

  if (rows.length || marker === 'complete' || marker === 'complete_rows' || marker === 'parsed_rows') {
    return { label: '包装完整', tone: 'ok', title: reasonLabel || `包装行 ${rows.length || 1}` };
  }
  if (marker === 'weight_only') {
    return { label: '缺包装尺寸', tone: 'warn', title: reasonLabel || '只采到重量，缺包装尺寸' };
  }
  if (marker === 'dimensions_only') {
    return { label: '缺包装重量', tone: 'warn', title: reasonLabel || '只采到包装尺寸，缺重量' };
  }
  if (marker === 'no_section' || marker === 'no_packaging_table' || marker === 'page_no_packaging_table') {
    return { label: '无包装表', tone: 'warn', title: reasonLabel || '页面没有包装表' };
  }
  if (marker === 'parse_failed' || marker === 'packaging_table_parse_failed' || marker === 'table_parse_failed') {
    return { label: '包装解析失败', tone: 'warn', title: reasonLabel || '有包装表但未解析出件重尺' };
  }
  if (standard.packageWeightG && standard.packageDimensionsMm) {
    return { label: '包装完整', tone: 'ok', title: reasonLabel || '已采到包装重量和尺寸' };
  }
  if (standard.packageWeightG) {
    return { label: '缺包装尺寸', tone: 'warn', title: reasonLabel || '只采到重量，缺包装尺寸' };
  }
  if (standard.packageDimensionsMm) {
    return { label: '缺包装重量', tone: 'warn', title: reasonLabel || '只采到包装尺寸，缺重量' };
  }
  return { label: '包装待采', tone: 'muted', title: reasonLabel || '待采集包装重量和尺寸' };
}

function sourceRichContentDraft(item: SourceCollectItem): Record<string, unknown> | null {
  const draft = item.metadata?.sourceRichContentDraft;
  return draft && typeof draft === 'object' && !Array.isArray(draft) ? draft as Record<string, unknown> : null;
}

function sourceRichContentDraftStatus(item: SourceCollectItem): string {
  const draft = sourceRichContentDraft(item);
  if (!draft) return '';
  const status = String(draft.status || '');
  if (status === 'raw_source_requires_processing') return '原始富内容待处理';
  return status || '原始富内容';
}

function sourceRichContentDraftSummary(item: SourceCollectItem): string {
  const draft = sourceRichContentDraft(item);
  if (!draft) return '';
  const blocks = Array.isArray(draft.blocks) ? draft.blocks : [];
  const textCount = blocks.filter((block) => !!block && typeof block === 'object' && String((block as Record<string, unknown>).type || '') === 'text').length;
  const imageCount = blocks.filter((block) => {
    if (!block || typeof block !== 'object') return false;
    const data = block as Record<string, unknown>;
    return String(data.type || '') === 'image' || !!data.url;
  }).length;
  return [sourceRichContentDraftStatus(item), textCount ? `文本 ${textCount}` : '', imageCount ? `图片 ${imageCount}` : '']
    .filter(Boolean)
    .join(' / ');
}

function sourceRejectedAssetCount(item: SourceCollectItem): number {
  return sourceMetadataArray(item, 'rejectedAssets').length;
}

function sourcePriceModelText(item: SourceCollectItem): string {
  const sourceType = String(item.metadata?.priceSourceType || '').trim();
  const confidence = String(item.metadata?.priceConfidence || '').trim();
  const ladderPrices = sourceMetadataArray(item, 'ladderPrices');
  const displayPrice = String(item.metadata?.displayPrice || '').trim();
  const sourceLabel: Record<string, string> = {
    sku: 'SKU价格',
    selectedSku: '已选SKU价',
    selectedOrderSummary: '订单价',
    ladder: '阶梯价',
    display: '展示价',
    rangeHigh: '区间高价',
    visibleRangeHigh: '可见高价',
    dom: '页面价格',
    text: '文本价格',
    skuMinFallback: 'SKU最低价',
  };
  const confidenceLabel: Record<string, string> = {
    high: '高',
    medium: '中',
    low: '低',
  };
  return [
    sourceLabel[sourceType] || sourceType || '未识别',
    confidence ? `置信度 ${confidenceLabel[confidence] || confidence}` : '',
    ladderPrices.length ? `阶梯 ${ladderPrices.length}` : '',
    displayPrice ? `展示 ${displayPrice}` : '',
  ].filter(Boolean).join(' / ');
}

function variantCount(item: SourceCollectItem): number {
  return sourceDisplayVariants(item).length;
}

function sourceAttributeCount(item: SourceCollectItem): number {
  const attrs = item.metadata?.sourceAttributes;
  return Array.isArray(attrs) ? attrs.length : 0;
}

function sourceAttributes(item: SourceCollectItem): Array<Record<string, unknown>> {
  const attrs = item.metadata?.sourceAttributes;
  return Array.isArray(attrs) ? attrs.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object') : [];
}

function sourceVariants(item: SourceCollectItem): Array<Record<string, unknown>> {
  const variants = Array.isArray(item.variants) ? item.variants : item.metadata?.skuItems;
  return Array.isArray(variants) ? variants.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object') : [];
}

function sourceStandardAttributeModel(item: SourceCollectItem): SourceStandardModel {
  return normalizeSourceStandardAttributes(item);
}

function sourceStandardListText(values: string[]): string {
  return values.length ? values.join('、') : '-';
}

function sourceStandardGenderText(value: string): string {
  if (value === 'female') return '女';
  if (value === 'male') return '男';
  if (value === 'unisex') return '中性';
  return value || '-';
}

function sourceStandardSeasonText(values: string[]): string {
  return sourceStandardListText(values.map((value) => {
    if (value === 'all-season') return '四季';
    if (value === 'spring') return '春';
    if (value === 'summer') return '夏';
    if (value === 'autumn') return '秋';
    if (value === 'winter') return '冬';
    return value;
  }));
}

function sourceStandardBrandText(standard: SourceStandardModel): string {
  if (standard.brand.value) return standard.brand.isBrandless ? `${standard.brand.value}（无品牌）` : standard.brand.value;
  return standard.brand.isBrandless ? '无品牌' : '-';
}

function sourceStandardGenderSeasonText(standard: SourceStandardModel): string {
  const parts = [sourceStandardGenderText(standard.gender.value), sourceStandardSeasonText(standard.seasons)]
    .filter((value) => value && value !== '-');
  return parts.length ? parts.join(' / ') : '-';
}

function sourceStandardPackageText(standard: SourceStandardModel): string {
  const dims = standard.packageDimensionsMm;
  const weight = standard.packageWeightG ? `${standard.packageWeightG}g` : '';
  const size = dims ? `${dims.length}×${dims.width}×${dims.height}mm` : '';
  return [weight, size].filter(Boolean).join(' / ') || '-';
}

function sourceVariantLabel(variant: Record<string, unknown>, index: number): string {
  const attrs = variant.attrs && typeof variant.attrs === 'object'
    ? Object.entries(variant.attrs as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`).join(' / ')
    : '';
  return String(variant.name || variant.specText || attrs || variant.skuId || `SKU ${index + 1}`).replace(/\s+/g, ' ').trim();
}

function sourceVariantKey(variant: Record<string, unknown>, index: number): string {
  return String(variant.sku || variant.skuId || variant.id || index).trim();
}

function positiveVariantNumber(value: unknown): string {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? String(number) : '';
}

function buildVariantPackageForms(item: SourceCollectItem, fallback: PackageFormState): Record<string, PackageFormState> {
  return sourceDisplayVariants(item).reduce<Record<string, PackageFormState>>((acc, variant, index) => {
    acc[sourceVariantKey(variant, index)] = {
      weightG: positiveVariantNumber(variant.weight) || fallback.weightG,
      lengthMm: positiveVariantNumber(variant.depth) || positiveVariantNumber(variant.lengthMm) || fallback.lengthMm,
      widthMm: positiveVariantNumber(variant.width) || positiveVariantNumber(variant.widthMm) || fallback.widthMm,
      heightMm: positiveVariantNumber(variant.height) || positiveVariantNumber(variant.heightMm) || fallback.heightMm,
    };
    return acc;
  }, {});
}

function sanitizeStableOfferPart(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function sourceOfferPlatformCode(value: unknown): string {
  const platform = normalizePlatform(value);
  if (platform === '1688') return '1688';
  if (platform === 'pdd') return 'PDD';
  if (platform === 'taobao') return 'TB';
  if (platform === 'tmall') return 'TM';
  if (platform === 'xianyu') return 'XY';
  return 'SRC';
}

function buildStableSourceOfferId(item: SourceCollectItem): string {
  const platform = sourceOfferPlatformCode(item.sourcePlatform || item.metadata?.sourcePlatform);
  const identity = sanitizeStableOfferPart(item.sourceProductId)
    || sanitizeStableOfferPart(item.metadata?.sourceProductId)
    || sanitizeStableOfferPart(item.sku)
    || sanitizeStableOfferPart(item.id)
    || 'ITEM';
  return `SRC-${platform}-${identity}`.slice(0, 80);
}

function buildStableSourceVariantOfferIds(item: SourceCollectItem): Record<string, string> {
  const base = buildStableSourceOfferId(item);
  return sourceVariants(item).reduce<Record<string, string>>((acc, variant, index) => {
    const key = String(variant.sku || index).trim();
    if (key) acc[key] = `${base}-V${index + 1}`.slice(0, 80);
    return acc;
  }, {});
}

function parseSourcePublishNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function sourcePublishPricePreview(item: SourceCollectItem, markupPct: string, markupAmount: string): string {
  const base = Number(item.purchasePrice);
  if (!Number.isFinite(base) || base <= 0) return '-';
  const pct = parseSourcePublishNumber(markupPct, 0);
  const fixed = parseSourcePublishNumber(markupAmount, 0);
  return `¥${Math.ceil(base * (1 + pct / 100) + fixed)}`;
}

const SOURCE_VARIANT_STOP_LABEL_RE = /^(里料成分|产地|货号|颜色|尺码|规格|型号|容量|尺寸|套餐|版本|口味|是否进口|上市时间|罩杯型|排扣类型|肩带类型|主面料成分含量|风格|里料成分含量|品牌|材质|成分|面料|货源类别|货源类型|淘货类别|裤型|裤长|腰型|是否有腰带|裤门襟|图案|误差范围|适合季节|是否库存|库存类型|适合人群|上市年份\/季节|上市年份季节|适用场景|裤脚口款式|款式细节|弹力|类别|原创设计货源|有无质检报告|质检报告编号|是否加绒|领标|吊牌|适用体型|适用对象|款式|厚薄|工艺)$/;

function isLikelySourceVariantTextBlob(label: string): boolean {
  if (/斤\s*(?:条|件|个).+斤\s*(?:条|件|个)/.test(label)) return true;
  const colorSeasonCount = (label.match(/-色\s*(?:春款|夏款|秋款|冬款|四季款)?/g) || []).length;
  const weightSizeStubCount = (label.match(/(?:^|\s)(?:\d+XL|XXXXL|XXXL|XXL|XL|XS|L|M|S)\s*斤/g) || []).length;
  if (colorSeasonCount >= 3 && weightSizeStubCount >= 1) return true;
  const fullWeightSizeCount = (label.match(/(?:^|\s)(?:\d+XL|XXXXL|XXXL|XXL|XL|XS|L|M|S)\s*\d{2,3}\s*(?:-|~|—|–|至|到)\s*\d{2,3}\s*斤/g) || []).length;
  if (fullWeightSizeCount >= 3 && (colorSeasonCount >= 2 || label.length > 60)) return true;
  return false;
}

function isDisplayableSourceVariant(variant: Record<string, unknown>, index: number): boolean {
  const label = sourceVariantLabel(variant, index);
  if (!label || label.length > 96) return false;
  const attrs = variant.attrs && typeof variant.attrs === 'object' ? variant.attrs as Record<string, unknown> : {};
  const attrKeys = Object.keys(attrs);
  const onlySpecAttr = attrKeys.length === 1 && attrKeys[0] === 'spec';
  const hasSkuSignal = !!String(variant.skuId || variant.sku || variant.id || '').trim()
    || Number.isFinite(Number(variant.price))
    || Number.isFinite(Number(variant.stock ?? variant.stockNum ?? variant.quantity))
    || attrKeys.some((key) => !/^spec$/i.test(key));
  if (!hasSkuSignal && SOURCE_VARIANT_STOP_LABEL_RE.test(label)) return false;
  if (onlySpecAttr && SOURCE_VARIANT_STOP_LABEL_RE.test(String(attrs.spec || '').trim())) return false;
  const sizeTokenCount = (label.match(/(?:XXXXL|XXXL|XXL|XL|XS|L|M|S|均码)\s*适合/g) || []).length;
  const colorMarkerCount = (label.match(/【/g) || []).length;
  if (onlySpecAttr && sizeTokenCount >= 3 && colorMarkerCount >= 2) return false;
  if (isLikelySourceVariantTextBlob(label)) return false;
  if (/(退货|退款|跨境|贴标|箱唛|复购率|已加购|先采后付|立即下单|加采购车|收藏|商品评价|商品属性|包装信息|商品详情|热门推荐|全部好评|差评|问大家|保障|发货率|运费\s*起)/.test(label)) return false;
  if (label.split(/\s+/).length > 10 && !/[/:：]/.test(label)) return false;
  return true;
}

function sourceDisplayVariants(item: SourceCollectItem): Array<Record<string, unknown>> {
  return sourceVariants(item).filter(isDisplayableSourceVariant);
}

function selectedSkuText(item: SourceCollectItem): string {
  const selected = item.metadata?.selectedSku;
  if (!selected || typeof selected !== 'object') return '';
  const sku = selected as Record<string, unknown>;
  const attrs = sku.attrs && typeof sku.attrs === 'object'
    ? Object.entries(sku.attrs as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`).join(' / ')
    : '';
  return [
    sku.skuId,
    sku.name,
    sku.specText,
    attrs,
    sku.priceText,
  ].map((part) => String(part || '').trim()).filter(Boolean).join(' · ');
}


function sourceMissingFields(item: SourceCollectItem): string[] {
  return evaluateSourceListingReadiness(item).missingFields;
}

function metadataArray(item: SourceCollectItem, key: string): unknown[] {
  return sourceMetadataArray(item, key);
}

function sourcePlainText(value: unknown): string {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceRussianText(value: unknown): string {
  const text = sourcePlainText(value);
  return text && SOURCE_CYRILLIC_TEXT_RE.test(text) && !SOURCE_CJK_TEXT_RE.test(text) ? text : '';
}

function sourceTranslatedTitleText(item: SourceCollectItem): string {
  return sourceRussianText(item.metadata?.publishTitleRu) || sourceRussianText(item.metadata?.titleRu);
}

function sourceTranslatedDescriptionText(item: SourceCollectItem): string {
  return sourceRussianText(item.metadata?.sourceDescriptionRu) || sourceRussianText(item.metadata?.descriptionRu);
}

function hasMetadataValue(item: SourceCollectItem, keys: string[]): boolean {
  return keys.some((key) => {
    const value = item.metadata?.[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return Boolean(value);
  });
}

function sourceAiContentDrafts(item: SourceCollectItem): Partial<Record<'title' | 'description', AiContentDraft>> {
  const drafts = item.metadata?.aiContentDrafts;
  return drafts && typeof drafts === 'object' && !Array.isArray(drafts)
    ? drafts as Partial<Record<'title' | 'description', AiContentDraft>>
    : {};
}

function sourceHasTranslation(item: SourceCollectItem): boolean {
  const drafts = sourceAiContentDrafts(item);
  return Boolean(sourceTranslatedTitleText(item) || sourceTranslatedDescriptionText(item) || drafts.title?.text || drafts.description?.text);
}

function aiDraftListText(drafts: Partial<Record<'title' | 'description', AiContentDraft>>, key: 'bulletPoints' | 'searchTags' | 'warnings'): string {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const draft of [drafts.title, drafts.description]) {
    const list = draft?.structured?.[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const text = String(item || '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      values.push(text);
    }
  }
  return values.join(' / ');
}

function aiDraftConfidenceText(drafts: Partial<Record<'title' | 'description', AiContentDraft>>): string {
  const values = [drafts.title?.structured?.confidence, drafts.description?.structured?.confidence]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return '';
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${Math.round(average * 100)}%`;
}

function sourceHasWatermark(item: SourceCollectItem): boolean {
  return hasMetadataValue(item, ['watermarkedImages', 'sourceWatermarkedImages', 'watermarkImages']);
}

function sourceHasEditedImages(item: SourceCollectItem): boolean {
  return hasMetadataValue(item, ['editedImages', 'processedImages', 'sourceEditedImages', 'imageProcessingResult']);
}

function sourceReadinessBadges(item: SourceCollectItem): ReadinessBadge[] {
  const readiness = evaluateSourceListingReadiness(item);
  const skuCount = variantCount(item);
  const attrs = sourceAttributeCount(item);
  const previewCount = sourcePreviewImages(item).length;
  const detailImageCount = sourceDetailPreviewImages(item).length;
  const richDraft = sourceRichContentDraft(item);
  return [
    skuCount > 0
      ? { label: `SKU ${skuCount}`, tone: 'ok' as const }
      : { label: 'SKU异常', tone: 'warn' as const },
    attrs > 0
      ? { label: '属性完整', tone: 'ok' as const }
      : { label: '属性待补', tone: 'warn' as const },
    sourceHasTranslation(item)
      ? { label: '已翻译', tone: 'ok' as const }
      : { label: '待翻译', tone: 'muted' as const },
    previewCount > 0
      ? { label: `图 ${previewCount}`, tone: 'info' as const }
      : { label: '图片待处理', tone: 'warn' as const },
    detailImageCount > 0
      ? { label: `详情图 ${detailImageCount}`, tone: 'info' as const }
      : { label: '详情图待采', tone: 'muted' as const },
    sourcePackagingBadge(item),
    richDraft
      ? { label: '富内容待处理', tone: 'warn' as const, title: sourceRichContentDraftSummary(item) }
      : { label: '富内容待采', tone: 'muted' as const },
    sourceHasWatermark(item)
      ? { label: '已水印', tone: 'ok' as const }
      : { label: '待水印', tone: 'muted' as const },
    sourceHasEditedImages(item)
      ? { label: '已改图', tone: 'ok' as const }
      : { label: '待改图', tone: 'muted' as const },
    {
      label: sourceListingStatusLabel(readiness.status),
      tone: readiness.status === 'ready' ? 'ok' as const : 'warn' as const,
      title: readiness.blockers.concat(readiness.warnings).join(' / ') || sourceListingStatusLegend,
    },
  ];
}

function readinessBadgeClass(tone: BadgeTone): string {
  if (tone === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (tone === 'warn') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (tone === 'info') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function ozonCategoryCandidateKey(candidate: SourceOzonCategoryCandidate): string {
  return `${candidate.categoryId}:${candidate.typeId}`;
}

function ozonCandidateLabelText(label: SourceOzonCategoryCandidate['label']): string {
  if (label === 'recommended') return '推荐';
  if (label === 'optional') return '可选';
  return '谨慎';
}

function ozonCandidateLabelClass(label: SourceOzonCategoryCandidate['label']): string {
  if (label === 'recommended') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (label === 'optional') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function ozonCandidateTranslationLabel(status: SourceOzonCategoryCandidate['translationStatus']): string {
  if (status === 'partial') return '部分翻译';
  if (status === 'missing') return '翻译缺失';
  return '';
}

function ozonCandidateTranslationClass(status: SourceOzonCategoryCandidate['translationStatus']): string {
  if (status === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (status === 'missing') return 'border-red-200 bg-red-50 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function workflowActionClass(enabled: boolean): string {
  return enabled ? 'text-foreground hover:text-primary' : 'text-muted-foreground/70 hover:text-foreground';
}

function extractionDiagnosticText(item: SourceCollectItem): string {
  const diagnostics = item.metadata?.extractionDiagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') return '';
  const data = diagnostics as Record<string, unknown>;
  const packagingReason = sourcePackagingReasonText(item);
  return [
    `图 ${String(data.imageCount ?? sourceImageCount(item))}`,
    `过滤图片 ${String(data.rejectedImageCount ?? sourceRejectedAssetCount(item))}`,
    `SKU ${String(data.skuCount ?? sourceVariants(item).length)}`,
    `属性 ${String(data.attributeCount ?? sourceAttributeCount(item))}`,
    packagingReason ? `包装 ${packagingReason}` : '',
    `价格来源 ${sourcePriceModelText(item)}`,
    `描述 ${data.descriptionFound ? '有' : '无'}`,
    `视频 ${String(data.videoCount ?? sourceVideoCount(item))}`,
  ].join(' / ');
}

function sourceFieldQualityRows(item: SourceCollectItem): Array<{ label: string; status: string; evidence: string }> {
  const diagnostics = item.metadata?.extractionDiagnostics;
  const data = diagnostics && typeof diagnostics === 'object' ? diagnostics as Record<string, unknown> : {};
  const confidence = data.fieldConfidence && typeof data.fieldConfidence === 'object' ? data.fieldConfidence as Record<string, unknown> : {};
  const standard = sourceStandardAttributeModel(item);
  const fallback: Record<string, string> = {
    title: sourceDisplayTitle(item) ? 'strong' : 'missing',
    price: item.purchasePrice ? (String(item.metadata?.priceConfidence || '') === 'low' ? 'weak' : 'strong') : 'missing',
    sku: sourceVariants(item).length ? 'strong' : 'missing',
    images: sourcePreviewImages(item).length ? 'strong' : 'missing',
    description: sourceTranslatedDescriptionText(item) || sourceRichContentDraft(item) ? 'strong' : 'missing',
    package: standard.packageWeightG && standard.packageDimensionsMm ? 'strong' : (standard.packageWeightG || standard.packageDimensionsMm ? 'weak' : 'missing'),
  };
  const labels: Record<string, string> = {
    title: '标题',
    price: '价格',
    sku: 'SKU',
    images: '图片',
    description: '详情/描述',
    package: '件重尺',
  };
  const evidence: Record<string, string> = {
    title: sourceDisplayTitle(item) || '-',
    price: sourcePriceModelText(item) || '-',
    sku: sourceVariants(item).length ? `${sourceVariants(item).length} 个变体` : '-',
    images: `${sourcePreviewImages(item).length}/${sourceImageCount(item)}`,
    description: sourceRichContentDraftSummary(item) || sourceTranslatedDescriptionText(item) || '-',
    package: sourceStandardPackageText(standard),
  };
  return Object.keys(labels).map((key) => ({
    label: labels[key] || key,
    status: String(confidence[key] || fallback[key] || 'missing'),
    evidence: evidence[key] || '-',
  }));
}

function sourceFieldQualityLabel(status: string): string {
  if (status === 'strong') return '强命中';
  if (status === 'weak') return '弱猜测';
  return '缺失';
}

function sourceFieldQualityClass(status: string): string {
  if (status === 'strong') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'weak') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-red-200 bg-red-50 text-red-700';
}

function sourceDisplayTitle(item: SourceCollectItem): string {
  const metaTitle = item.metadata?.sourceTitleRaw;
  return String(metaTitle || item.title || '未命名货源商品');
}

function sourceCategoryText(item: SourceCollectItem): string {
  const categoryPath = item.metadata?.categoryPath;
  if (Array.isArray(categoryPath) && categoryPath.length) {
    return categoryPath.map((part) => String(part)).filter(Boolean).join(' / ');
  }
  return String(item.metadata?.categoryName || '');
}

function isSourceCollectItem(item: SourceCollectItem): boolean {
  return ['1688', 'pdd', 'taobao', 'tmall', 'xianyu'].includes(normalizePlatform(item.sourcePlatform));
}

function SourceProductRow({
  item,
  onDetail,
  onDelete,
}: {
  item: SourceCollectItem;
  onDetail: (item: SourceCollectItem, section?: DetailSection) => void;
  onDelete: (item: SourceCollectItem) => void;
}) {
  const preview = sourceMainPreviewImage(item);
  const missing = sourceMissingFields(item);
  const badges = sourceReadinessBadges(item);
  const translated = sourceHasTranslation(item);
  const watermarked = sourceHasWatermark(item);
  const edited = sourceHasEditedImages(item);
  return (
    <div className="rounded-md border bg-card px-4 py-4 transition-colors hover:border-primary/30 hover:bg-muted/20">
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => onDetail(item)}
          className="relative h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          title="查看采集详情"
        >
          {preview ? (
            <img
              src={preview}
              alt=""
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-7 w-7" />
            </div>
          )}
          <span className="absolute bottom-1 right-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {sourcePreviewImages(item).length || sourceImageCount(item)}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => onDetail(item)}
                className="line-clamp-2 text-left text-base font-medium leading-snug hover:text-primary"
              >
                {sourceDisplayTitle(item)}
              </button>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{item.sourceProductId || item.sku || item.id}</span>
                <Badge variant="outline" className="h-5 px-2 text-[11px]">{platformLabel(item.sourcePlatform)}</Badge>
                {sourceCategoryText(item) ? <span className="line-clamp-1 max-w-xl">{sourceCategoryText(item)}</span> : null}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2 text-left lg:text-right">
              <div className="text-base font-semibold">{detailPriceText(item)}</div>
              <div className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {badges.map((badge) => (
              <Badge
                key={badge.label}
                variant="outline"
                title={badge.title}
                className={`h-6 rounded-full px-2 text-[11px] font-medium ${readinessBadgeClass(badge.tone)}`}
              >
                {badge.tone === 'ok' ? <CheckCircle2 className="mr-1 h-3 w-3" /> : null}
                {badge.tone === 'warn' ? <AlertTriangle className="mr-1 h-3 w-3" /> : null}
                {badge.label}
              </Badge>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>主图 {sourcePreviewImages(item).length}/{sourceImageCount(item)}</span>
              <span>详情图 {sourceDetailPreviewImages(item).length}/{sourceDetailImageCount(item)}</span>
              <span>视频 {sourceVideoCount(item)}</span>
              <span>SKU {variantCount(item)}</span>
              <span>属性 {sourceAttributeCount(item)}</span>
              {missing.length ? <span>缺失 {missing.length}</span> : <span>上架检查通过</span>}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => onDetail(item)} title="查看采集详情">
                <Eye className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 ${workflowActionClass(translated)}`}
                onClick={() => onDetail(item, 'translation')}
                title="翻译标题/描述"
              >
                <Languages className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 ${workflowActionClass(watermarked)}`}
                onClick={() => onDetail(item, 'images')}
                title="图片加水印"
              >
                <Droplets className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 ${workflowActionClass(edited)}`}
                onClick={() => onDetail(item, 'images')}
                title="改图/清洗图片"
              >
                <Wand2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => onDetail(item, 'listing')}
                title="核价/上架检查"
              >
                <Calculator className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => onDetail(item, 'listing')}
                title="上架到OZON"
              >
                <Upload className="h-4 w-4" />
              </Button>
              {item.sourceUrl ? (
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer" title="打开来源页面">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                onClick={() => onDelete(item)}
                title="删除采集记录"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function detailPriceText(item: SourceCollectItem): string {
  return item.purchasePrice ? `¥${item.purchasePrice}` : '-';
}

function SourceDetailContent({
  item,
  activeSection,
  onSectionChange,
  onItemUpdate,
}: {
  item: SourceCollectItem;
  activeSection: DetailSection;
  onSectionChange: (section: DetailSection) => void;
  onItemUpdate: (item: SourceCollectItem) => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex gap-4">
        <div className="h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted">
          {sourceMainPreviewImage(item) ? (
            <img src={sourceMainPreviewImage(item)} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-7 w-7" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium leading-snug">{sourceDisplayTitle(item)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{item.sourceProductId || item.sku || item.id}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {sourceReadinessBadges(item).map((badge) => (
              <Badge
                key={badge.label}
                variant="outline"
                title={badge.title}
                className={`h-6 rounded-full px-2 text-[11px] font-medium ${readinessBadgeClass(badge.tone)}`}
              >
                {badge.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {detailSections.map((section) => (
          <Button
            key={section.key}
            type="button"
            variant={activeSection === section.key ? 'default' : 'ghost'}
            size="sm"
            onClick={() => onSectionChange(section.key)}
          >
            {section.label}
          </Button>
        ))}
      </div>

      {activeSection === 'overview' ? <SourceOverviewSection item={item} /> : null}
      {activeSection === 'sku' ? <SourceSkuSection item={item} /> : null}
      {activeSection === 'attributes' ? <SourceAttributesSection item={item} /> : null}
      {activeSection === 'images' ? <SourceImagesSection item={item} onItemUpdate={onItemUpdate} /> : null}
      {activeSection === 'translation' ? <SourceTranslationSection item={item} onItemUpdate={onItemUpdate} /> : null}
      {activeSection === 'listing' ? <SourceListingCheckSection item={item} onItemUpdate={onItemUpdate} /> : null}
    </div>
  );
}

function SourceOverviewSection({ item }: { item: SourceCollectItem }) {
  const packagingEvidence = sourcePackagingEvidence(item);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <MetricBlock label="平台" value={platformLabel(item.sourcePlatform)} />
        <MetricBlock label="采购价" value={detailPriceText(item)} />
        <MetricBlock label="价格来源" value={sourcePriceModelText(item)} />
        <MetricBlock label="SKU" value={String(variantCount(item))} />
        <MetricBlock label="主图" value={`${sourcePreviewImages(item).length}/${sourceImageCount(item)}`} />
        <MetricBlock label="详情图" value={`${sourceDetailPreviewImages(item).length}/${sourceDetailImageCount(item)}`} />
        <MetricBlock label="包装" value={packagingEvidence.metric} />
        <MetricBlock label="过滤图片" value={String(sourceRejectedAssetCount(item))} />
      </div>
      <InfoPanel title="采集诊断" count={null}>
        <div className="space-y-1 text-muted-foreground">
          <div>{extractionDiagnosticText(item) || '暂无诊断信息'}</div>
          <div>视频转存 {sourceVideoTransferSummary(item)}</div>
        </div>
      </InfoPanel>
      <InfoPanel title="字段级采集质量" count={null}>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {sourceFieldQualityRows(item).map((row) => (
            <div key={row.label} className="rounded border bg-muted/30 px-3 py-2 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium">{row.label}</span>
                <Badge variant="outline" className={sourceFieldQualityClass(row.status)}>{sourceFieldQualityLabel(row.status)}</Badge>
              </div>
              <div className="break-words text-muted-foreground">{row.evidence}</div>
            </div>
          ))}
        </div>
      </InfoPanel>
      <InfoPanel title="来源信息" count={null}>
        <div className="grid gap-2 md:grid-cols-2">
          <KeyValue label="商品ID" value={item.sourceProductId || item.sku || item.id} />
          <KeyValue label="采集时间" value={formatDate(item.createdAt)} />
          <KeyValue label="类目" value={sourceCategoryText(item) || '-'} />
          <KeyValue label="已选 SKU" value={selectedSkuText(item) || '-'} />
          <KeyValue label="原始富内容" value={sourceRichContentDraftSummary(item) || '-'} />
        </div>
      </InfoPanel>
    </div>
  );
}

function packagingRowTitle(row: Record<string, unknown>, index: number): string {
  return [row.color, row.size].map((value) => String(value || '').trim()).filter(Boolean).join(' / ') || `包装 ${index + 1}`;
}

function packagingRowMeta(row: Record<string, unknown>): string {
  const length = Number(row.lengthMm);
  const width = Number(row.widthMm);
  const height = Number(row.heightMm);
  const volume = Number(row.volumeCm3);
  const weight = Number(row.weightG);
  return [
    Number.isFinite(length) && Number.isFinite(width) && Number.isFinite(height) && length > 0 && width > 0 && height > 0
      ? `${length} x ${width} x ${height} mm`
      : '',
    Number.isFinite(volume) && volume > 0 ? `${volume} cm3` : '',
    Number.isFinite(weight) && weight > 0 ? `${weight} g` : '',
  ].filter(Boolean).join(' · ');
}

function SourceSkuSection({ item }: { item: SourceCollectItem }) {
  const variants = sourceDisplayVariants(item);
  const packagingRows = sourcePackagingRows(item);
  const packagingProfile = sourcePackagingProfile(item);
  const packagingReason = sourcePackagingReasonText(item);
  const standard = sourceStandardAttributeModel(item);
  const packageSummary = sourceStandardPackageText(standard);
  const packagingCount = packagingRows.length || (packageSummary !== '-' ? 1 : 0);
  return (
    <div className="space-y-3">
      <InfoPanel title="SKU / 变体" count={variants.length}>
        {variants.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {variants.slice(0, 80).map((variant, index) => (
              <div key={index} className="rounded border bg-muted/30 px-3 py-2 text-xs">
                <div className="break-words">{sourceVariantLabel(variant, index)}</div>
                <div className="mt-1 flex gap-3 text-muted-foreground">
                  {variant.price != null ? <span>¥{String(variant.price)}</span> : null}
                  {variant.stock != null ? <span>库存 {String(variant.stock)}</span> : null}
                  {variant.skuId ? <span>{String(variant.skuId)}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="text-muted-foreground">未采集到 SKU 变体</div>}
      </InfoPanel>

      <InfoPanel title="包装信息" count={packagingCount}>
        {packagingReason ? (
          <div className="mb-2 rounded border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <span className="text-foreground">{packagingReason}</span>
            {packagingProfile.reasonCode || packagingProfile.reason ? (
              <span> · {String(packagingProfile.reasonCode || packagingProfile.reason)}</span>
            ) : null}
          </div>
        ) : null}
        {packagingRows.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {packagingRows.slice(0, 80).map((row, index) => (
              <div key={index} className="rounded border bg-muted/30 px-3 py-2 text-xs">
                <div className="break-words">{packagingRowTitle(row, index)}</div>
                <div className="mt-1 text-muted-foreground">{packagingRowMeta(row) || '未采集到件重尺'}</div>
              </div>
            ))}
          </div>
        ) : packageSummary !== '-' ? (
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
              <div className="break-words">通用件重尺</div>
              <div className="mt-1 text-muted-foreground">{packageSummary}</div>
            </div>
          </div>
        ) : <div className="text-muted-foreground">未采集到包装信息</div>}
      </InfoPanel>
    </div>
  );
}

function SourceAttributesSection({ item }: { item: SourceCollectItem }) {
  const attrs = sourceAttributes(item);
  const standard = sourceStandardAttributeModel(item);
  return (
    <div className="space-y-3">
      <InfoPanel title="标准属性" count={standard.missingForOzon.length ? `缺口 ${standard.missingForOzon.length}` : '已归一'}>
        <div className="grid gap-2 md:grid-cols-2">
          <KeyValue label="品牌/无品牌" value={sourceStandardBrandText(standard)} />
          <KeyValue label="颜色" value={sourceStandardListText(standard.colors)} />
          <KeyValue label="尺码" value={sourceStandardListText(standard.sizes)} />
          <KeyValue label="材质/成分" value={sourceStandardListText(standard.materials)} />
          <KeyValue label="性别/季节" value={sourceStandardGenderSeasonText(standard)} />
          <KeyValue label="重量/尺寸" value={sourceStandardPackageText(standard)} />
          <KeyValue label="类目提示" value={sourceStandardListText(standard.categoryHints)} />
          <KeyValue label="Ozon缺口" value={sourceStandardListText(standard.missingForOzon)} />
        </div>
      </InfoPanel>
      <InfoPanel title="属性" count={attrs.length}>
        {attrs.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {attrs.map((attr, index) => (
              <div key={index} className="rounded border bg-muted/30 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{String(attr.name || attr.key || '-')}：</span>
                {String(attr.value || attr.attrValue || attr.text || '-')}
              </div>
            ))}
          </div>
        ) : <div className="text-muted-foreground">未采集到商品属性</div>}
      </InfoPanel>
    </div>
  );
}

function SourceImagesSection({ item, onItemUpdate }: { item: SourceCollectItem; onItemUpdate: (item: SourceCollectItem) => void }) {
  const [images, setImages] = useState<string[]>(() => sourcePreviewImages(item));
  const [detailImages, setDetailImages] = useState<string[]>(() => sourceDetailPreviewImages(item));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const watermarked = metadataArray(item, 'watermarkedImages');
  const edited = metadataArray(item, 'editedImages').concat(metadataArray(item, 'processedImages'));
  const videos = sourceVideoMaterialRows(item);

  useEffect(() => {
    setImages(sourcePreviewImages(item));
    setDetailImages(sourceDetailPreviewImages(item));
    setMessage('');
    setError('');
  }, [item.id, item.images, item.metadata]);

  async function saveFilteredImages() {
    if (saving) return;
    setSaving(true);
    setMessage('');
    setError('');
    const nextImages = images;
    const nextDetailImages = detailImages;
    const res = await api.post('/api/collect/save-customization', {
      id: item.id,
      images: nextImages,
      sourceMainImages: nextImages,
      sourceDetailImages: nextDetailImages,
    });
    setSaving(false);
    if (res.code === 1) {
      const metadata = { ...(item.metadata || {}), sourceMainImages: nextImages, sourceDetailImages: nextDetailImages, watermarkedImages: nextImages };
      onItemUpdate({ ...item, images: nextImages, metadata });
      setMessage('已保存图片筛选，发布时会使用保留的图片');
    } else {
      setError(res.msg || '保存图片筛选失败');
    }
  }

  return (
    <div className="space-y-3">
      <InfoPanel title="主图预览" count={`${images.length} / ${sourceImageCount(item)}`}>
        <SourceImageGrid
          images={images}
          empty="未采集到可预览商品图片"
          limit={32}
          onRemove={(image) => setImages((current) => current.filter((entry) => entry !== image))}
        />
      </InfoPanel>
      <InfoPanel title="详情图原始素材" count={`${detailImages.length} / ${sourceDetailImageCount(item)}`}>
        <SourceImageGrid
          images={detailImages}
          empty="未采集到详情图原始素材"
          limit={50}
          onRemove={(image) => setDetailImages((current) => current.filter((entry) => entry !== image))}
        />
      </InfoPanel>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={saveFilteredImages} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          保存图片筛选
        </Button>
        {message ? <span className="text-xs text-emerald-700">{message}</span> : null}
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoPanel title="水印图" count={watermarked.length}>
          <ImageStatusList images={watermarked} empty="暂无水印图" />
        </InfoPanel>
        <InfoPanel title="改图结果" count={edited.length}>
          <ImageStatusList images={edited} empty="暂无改图结果" />
        </InfoPanel>
      </div>
      <InfoPanel title="视频素材" count={videos.length ? `已采集源视频 ${videos.length}` : '无视频'}>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground">发布时上传Ozon视频：在上架检查选择目标店铺后，系统会用该店铺登录态上传到 Ozon CDN 并生成视频属性。</div>
          <SourceVideoList videos={videos} transferEntries={[]} empty="未采集到视频素材" />
        </div>
      </InfoPanel>
    </div>
  );
}

function SourceVideoList({ videos, transferEntries, empty }: { videos: Array<Record<string, unknown>>; transferEntries: Array<Record<string, unknown>>; empty: string }) {
  if (!videos.length) return <div className="text-muted-foreground">{empty}</div>;
  return (
    <div className="space-y-2">
      {videos.map((video, index) => {
        const url = String(video.url || '').trim();
        const originalUrl = String(video.originalUrl || '').trim();
        const transferEntry = sourceVideoTransferEntryFor(video, transferEntries);
        const entryStatus = String(transferEntry?.status || '').trim();
        const entryReason = String(transferEntry?.reason || '').trim();
        const entryMessage = String(transferEntry?.message || '').trim();
        const status = String(video.transferStatus || video.status || entryStatus || '').trim();
        const reason = String(video.transferReason || video.reason || entryReason || '').trim();
        const effectiveStatus = sourceVideoEffectiveStatus(status, reason, entryMessage);
        const reasonLabel = effectiveStatus !== status ? effectiveStatus : reason;
        return (
          <div key={`${url || originalUrl || index}`} className="rounded border bg-muted/30 px-3 py-2 text-xs">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={sourceVideoStatusClass(effectiveStatus)}>
                {sourceVideoStatusLabel(effectiveStatus)}
              </Badge>
              {video.title ? <span className="font-medium">{String(video.title)}</span> : null}
            </div>
            <div className="space-y-1 text-muted-foreground">
              {url ? (
                <button
                  type="button"
                  className="flex max-w-full items-center gap-1 break-all text-left text-primary hover:underline"
                  onClick={() => window.open(url, '_blank')}
                >
                  <ExternalLink className="h-3 w-3 shrink-0" />
                  {url}
                </button>
              ) : null}
              {originalUrl && originalUrl !== url ? (
                <div className="break-all">原始视频 {originalUrl}</div>
              ) : null}
              {reasonLabel && reasonLabel !== status ? <div>原因 {sourceVideoStatusLabel(reasonLabel)}</div> : null}
              {entryMessage ? <div>诊断 {entryMessage}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SourceTranslationSection({ item, onItemUpdate }: { item: SourceCollectItem; onItemUpdate: (item: SourceCollectItem) => void }) {
  const richDraftSummary = sourceRichContentDraftSummary(item);
  const drafts = sourceAiContentDrafts(item);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function generateDrafts() {
    if (generating) return;
    setGenerating(true);
    setMessage('');
    setError('');
    const res = await api.post<{ item: SourceCollectItem; limit?: { used: number; remaining: number; limit: number } }>(`/api/collect/${item.id}/ai-content-draft`, {
      fields: ['title', 'description'],
    });
    if (res.code === 1 && res.data?.item) {
      onItemUpdate(res.data.item);
      const limit = res.data.limit;
      setMessage(limit ? `已生成草稿，今日剩余额度 ${limit.remaining}/${limit.limit}` : '已生成草稿');
    } else {
      setError(res.msg || 'AI 商品内容草稿生成失败');
    }
    setGenerating(false);
  }

  return (
    <div className="space-y-3">
      <InfoPanel title="俄语本地化" count={sourceHasTranslation(item) ? '已生成' : '待生成'}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={generateDrafts} disabled={generating}>
              {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />}
              生成Ozon文案草稿
            </Button>
            {message ? <span className="text-xs text-emerald-700">{message}</span> : null}
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
          <div className="grid gap-2">
            <KeyValue label="中文标题" value={sourceDisplayTitle(item)} />
            <KeyValue label="俄文标题" value={sourceTranslatedTitleText(item) || '-'} />
            <KeyValue label="俄文描述" value={sourceTranslatedDescriptionText(item) || '-'} />
            <KeyValue label="AI 标题草稿" value={drafts.title?.text || '-'} />
            <KeyValue label="AI 描述草稿" value={drafts.description?.text || '-'} />
            <KeyValue label="AI 卖点" value={aiDraftListText(drafts, 'bulletPoints') || '-'} />
            <KeyValue label="AI 搜索标签" value={aiDraftListText(drafts, 'searchTags') || '-'} />
            <KeyValue label="AI 风险提示" value={aiDraftListText(drafts, 'warnings') || '-'} />
            <KeyValue label="AI 置信度" value={aiDraftConfidenceText(drafts) || '-'} />
            <KeyValue label="AI 草稿来源" value={[drafts.title?.source, drafts.title?.model].filter(Boolean).join(' / ') || '-'} />
          </div>
        </div>
      </InfoPanel>
      <InfoPanel title="原始富内容待处理" count={richDraftSummary || '未采集'}>
        <div className="grid gap-2">
          <KeyValue label="原始富内容" value={richDraftSummary || '-'} />
          <KeyValue label="详情图原始素材" value={`${sourceDetailPreviewImages(item).length} / ${sourceDetailImageCount(item)}`} />
        </div>
      </InfoPanel>
    </div>
  );
}

function SourceListingCheckSection({ item, onItemUpdate }: { item: SourceCollectItem; onItemUpdate: (item: SourceCollectItem) => void }) {
  const readiness = evaluateSourceListingReadiness(item);
  const fieldDiagnostics = evaluateSourceListingFieldDiagnostics(item);
  const missing = readiness.missingFields;
  const standard = sourceStandardAttributeModel(item);
  const standardDims = standard.packageDimensionsMm;
  const [shops, setShops] = useState<OzonShopOption[]>([]);
  const [shopId, setShopId] = useState('');
  const [shopsLoading, setShopsLoading] = useState(false);
  const [categoryData, setCategoryData] = useState<SourceOzonCategoryCandidateResponse | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [shopSelectionMessage, setShopSelectionMessage] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [packageForm, setPackageForm] = useState({
    weightG: standard.packageWeightG ? String(standard.packageWeightG) : '',
    lengthMm: standardDims ? String(standardDims.length) : '',
    widthMm: standardDims ? String(standardDims.width) : '',
    heightMm: standardDims ? String(standardDims.height) : '',
  });
  const [packageMode, setPackageMode] = useState<'group' | 'variant'>('group');
  const [variantPackageForms, setVariantPackageForms] = useState<Record<string, PackageFormState>>({});
  const [packageSaving, setPackageSaving] = useState(false);
  const [packageMessage, setPackageMessage] = useState('');
  const [packageError, setPackageError] = useState('');
  const [publishMarkupPct, setPublishMarkupPct] = useState('');
  const [publishMarkupAmount, setPublishMarkupAmount] = useState('0');
  const [publishing, setPublishing] = useState(false);
  const [publishMessage, setPublishMessage] = useState('');
  const [publishError, setPublishError] = useState('');
  const candidates = categoryData?.candidates || [];
  const selectedCandidate = candidates.find((candidate) => ozonCategoryCandidateKey(candidate) === selectedCandidateKey) || candidates[0];
  const confirmedCategoryId = Number(item.metadata?.descriptionCategoryId || item.metadata?.ozonCategoryId || 0);
  const confirmedTypeId = Number(item.metadata?.typeId || item.metadata?.ozonTypeId || 0);
  const selectedCandidateConfirmed = Boolean(
    selectedCandidate
      && confirmedCategoryId === Number(selectedCandidate.categoryId)
      && confirmedTypeId === Number(selectedCandidate.typeId),
  );
  const stableOfferId = buildStableSourceOfferId(item);
  const stableVariantOfferIds = buildStableSourceVariantOfferIds(item);
  const stableVariantOfferCount = Object.keys(stableVariantOfferIds).length;
  const displayVariants = sourceDisplayVariants(item);
  const packagingEvidence = sourcePackagingEvidence(item);
  const sourceAssets = [
    { label: `主图 ${sourcePreviewImages(item).length}/${sourceImageCount(item)}`, done: sourcePreviewImages(item).length > 0 },
    { label: `详情图 ${sourceDetailPreviewImages(item).length}/${sourceDetailImageCount(item)}`, done: sourceDetailPreviewImages(item).length > 0 },
    { label: sourceRichContentDraft(item) ? '原始富内容待处理' : '富内容待采', done: !!sourceRichContentDraft(item) },
    { label: packagingEvidence.checklistLabel, done: packagingEvidence.done },
  ];

  useEffect(() => {
    let cancelled = false;
    setShopsLoading(true);
    api.get<OzonShopOption[]>('/api/shops').then((res) => {
      if (cancelled) return;
      if (res.code === 1 && res.data) {
        const ozonShops = res.data.filter((shop) => shop.platform === 'OZON');
        setShops(ozonShops);
        let rememberedShopId = '';
        try {
          rememberedShopId = localStorage.getItem(SOURCE_PUBLISH_SHOP_STORAGE_KEY) || '';
        } catch {
          rememberedShopId = '';
        }
        const rememberedShop = ozonShops.find((shop) => shop.id === rememberedShopId);
        const fallbackShop = ozonShops[0];
        setShopId((current) => {
          if (current && ozonShops.some((shop) => shop.id === current)) return current;
          return rememberedShop?.id || fallbackShop?.id || '';
        });
        if (rememberedShop) {
          setShopSelectionMessage(`已选择上次使用的店铺：${rememberedShop.name}`);
        } else if (rememberedShopId && fallbackShop) {
          setShopSelectionMessage(`上次使用的店铺不可用，已切换到：${fallbackShop.name}`);
        } else {
          setShopSelectionMessage('');
        }
      }
      setShopsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const nextStandard = sourceStandardAttributeModel(item);
    const nextDims = nextStandard.packageDimensionsMm;
    setPackageForm({
      weightG: nextStandard.packageWeightG ? String(nextStandard.packageWeightG) : '',
      lengthMm: nextDims ? String(nextDims.length) : '',
      widthMm: nextDims ? String(nextDims.width) : '',
      heightMm: nextDims ? String(nextDims.height) : '',
    });
    setVariantPackageForms(buildVariantPackageForms(item, {
      weightG: nextStandard.packageWeightG ? String(nextStandard.packageWeightG) : '',
      lengthMm: nextDims ? String(nextDims.length) : '',
      widthMm: nextDims ? String(nextDims.width) : '',
      heightMm: nextDims ? String(nextDims.height) : '',
    }));
    setPackageMessage('');
    setPackageError('');
    setPublishMessage('');
    setPublishError('');
  }, [item.id, item.metadata, item.variants]);

  useEffect(() => {
    let cancelled = false;
    setCategoryData(null);
    setCandidateError('');
    setConfirmMessage('');
    setSelectedCandidateKey('');
    if (!shopId) return () => { cancelled = true; };
    setCandidateLoading(true);
    api.get<SourceOzonCategoryCandidateResponse>(`/api/collect/${item.id}/ozon-category-candidates?shopId=${encodeURIComponent(shopId)}`).then((res) => {
      if (cancelled) return;
      if (res.code === 1 && res.data) {
        setCategoryData(res.data);
        const selected = res.data.candidates.find((candidate) => candidate.selected) || res.data.candidates[0];
        setSelectedCandidateKey(selected ? ozonCategoryCandidateKey(selected) : '');
      } else {
        setCandidateError(res.msg || '生成 Ozon 类目候选失败');
      }
      setCandidateLoading(false);
    });
    return () => { cancelled = true; };
  }, [item.id, shopId]);

  async function confirmSelectedCandidate() {
    if (!selectedCandidate || confirming) return;
    setConfirming(true);
    setCandidateError('');
    setConfirmMessage('');
    const res = await api.post(`/api/collect/${item.id}/ozon-category-confirm`, {
      signature: categoryData?.signature,
      categoryId: selectedCandidate.categoryId,
      typeId: selectedCandidate.typeId,
      categoryName: selectedCandidate.categoryName,
      typeName: selectedCandidate.typeName,
    });
    if (res.code === 1) {
      const metadata = {
        ...(item.metadata || {}),
        descriptionCategoryId: selectedCandidate.categoryId,
        typeId: selectedCandidate.typeId,
        sourceOzonCategoryConfirmed: {
          signature: categoryData?.signature || '',
          categoryId: selectedCandidate.categoryId,
          typeId: selectedCandidate.typeId,
          categoryName: selectedCandidate.categoryName,
          typeName: selectedCandidate.typeName,
          confirmedAt: new Date().toISOString(),
        },
      };
      onItemUpdate({ ...item, metadata });
      setConfirmMessage('已确认，后续同类货源会优先推荐该 Ozon 类目');
    } else {
      setCandidateError(res.msg || '确认 Ozon 类目失败');
    }
    setConfirming(false);
  }

  function setPackageField(key: keyof typeof packageForm, value: string) {
    setPackageForm((current) => ({ ...current, [key]: value }));
    setPackageMessage('');
    setPackageError('');
  }

  function setVariantPackageField(variantKey: string, key: keyof PackageFormState, value: string) {
    setVariantPackageForms((current) => ({
      ...current,
      [variantKey]: {
        ...(current[variantKey] || { weightG: '', lengthMm: '', widthMm: '', heightMm: '' }),
        [key]: value,
      },
    }));
    setPackageMessage('');
    setPackageError('');
  }

  function applyGroupPackageToVariants() {
    setVariantPackageForms((current) => {
      const next = { ...current };
      displayVariants.forEach((variant, index) => {
        next[sourceVariantKey(variant, index)] = { ...packageForm };
      });
      return next;
    });
    setPackageMode('variant');
    setPackageMessage('已应用到全部SKU，保存后发布会按 SKU 使用');
    setPackageError('');
  }

  function packageNumber(value: string): number | null {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 ? number : null;
  }

  async function saveManualPackage() {
    if (packageSaving) return;
    const weightG = packageNumber(packageForm.weightG);
    const lengthMm = packageNumber(packageForm.lengthMm);
    const widthMm = packageNumber(packageForm.widthMm);
    const heightMm = packageNumber(packageForm.heightMm);
    if (!weightG && !lengthMm && !widthMm && !heightMm) {
      setPackageError('请至少填写一个有效的重量或尺寸');
      return;
    }

    setPackageSaving(true);
    setPackageMessage('');
    setPackageError('');
    const body: Record<string, unknown> = { id: item.id };
    if (weightG) body.weightG = weightG;
    if (lengthMm) body.lengthMm = lengthMm;
    if (widthMm) body.widthMm = widthMm;
    if (heightMm) body.heightMm = heightMm;
    const res = await api.post('/api/collect/save-customization', body);
    setPackageSaving(false);
    if (res.code === 1) {
      const metadata = { ...(item.metadata || {}) };
      if (weightG) metadata.weightG = weightG;
      if (lengthMm) metadata.lengthMm = lengthMm;
      if (widthMm) metadata.widthMm = widthMm;
      if (heightMm) metadata.heightMm = heightMm;
      onItemUpdate({ ...item, metadata });
      setPackageMessage('已保存件重尺，发布时会优先使用这组数据');
    } else {
      setPackageError(res.msg || '保存件重尺失败');
    }
  }

  async function saveVariantPackages() {
    if (packageSaving) return;
    const variants = displayVariants.map((variant, index) => {
      const key = sourceVariantKey(variant, index);
      const form = variantPackageForms[key] || { weightG: '', lengthMm: '', widthMm: '', heightMm: '' };
      return {
        sku: key,
        weightG: packageNumber(form.weightG) || undefined,
        lengthMm: packageNumber(form.lengthMm) || undefined,
        widthMm: packageNumber(form.widthMm) || undefined,
        heightMm: packageNumber(form.heightMm) || undefined,
      };
    }).filter((variant) => variant.weightG || variant.lengthMm || variant.widthMm || variant.heightMm);
    if (!variants.length) {
      setPackageError('请至少给一个 SKU 填写有效的重量或尺寸');
      return;
    }

    setPackageSaving(true);
    setPackageMessage('');
    setPackageError('');
    const res = await api.post('/api/collect/save-customization', { id: item.id, variants });
    setPackageSaving(false);
    if (res.code === 1) {
      const overrideMap = new Map(variants.map((variant) => [variant.sku, variant]));
      const nextVariants = sourceVariants(item).map((variant, index) => {
        const key = sourceVariantKey(variant, index);
        const override = overrideMap.get(key);
        if (!override) return variant;
        return {
          ...variant,
          ...(override.weightG ? { weight: override.weightG } : {}),
          ...(override.lengthMm ? { depth: override.lengthMm } : {}),
          ...(override.widthMm ? { width: override.widthMm } : {}),
          ...(override.heightMm ? { height: override.heightMm } : {}),
        };
      });
      onItemUpdate({ ...item, variants: nextVariants });
      setPackageMessage('已保存SKU件重尺，发布时会优先使用各 SKU 数据');
    } else {
      setPackageError(res.msg || '保存SKU件重尺失败');
    }
  }

  async function saveSourcePublishInputs(weightG: number, lengthMm: number, widthMm: number, heightMm: number) {
    if (!selectedCandidate) throw new Error('请选择 Ozon 类目候选');
    const res = await api.post('/api/collect/save-customization', {
      id: item.id,
      categoryId: selectedCandidate.categoryId,
      typeId: selectedCandidate.typeId,
      weightG,
      lengthMm,
      widthMm,
      heightMm,
    });
    if (res.code !== 1) throw new Error(res.msg || '保存源商品发布参数失败');
    const metadata = {
      ...(item.metadata || {}),
      descriptionCategoryId: selectedCandidate.categoryId,
      typeId: selectedCandidate.typeId,
      weightG,
      lengthMm,
      widthMm,
      heightMm,
    };
    onItemUpdate({ ...item, metadata });
    return metadata;
  }

  function handleSourcePublishShopChange(nextShopId: string) {
    setShopId(nextShopId);
    const shop = shops.find((entry) => entry.id === nextShopId);
    try {
      if (nextShopId) localStorage.setItem(SOURCE_PUBLISH_SHOP_STORAGE_KEY, nextShopId);
      else localStorage.removeItem(SOURCE_PUBLISH_SHOP_STORAGE_KEY);
    } catch {
      // localStorage can be unavailable in strict browser privacy modes.
    }
    setShopSelectionMessage(shop ? `已记住上次使用的店铺：${shop.name}` : '');
  }

  async function handleSourcePublish() {
    if (publishing) return;
    setPublishMessage('');
    setPublishError('');
    setPackageError('');
    if (!shopId) {
      setPublishError('请选择目标 Ozon 店铺');
      return;
    }
    if (!selectedCandidate) {
      setPublishError('请选择 Ozon 类目候选');
      return;
    }
    const weightG = packageNumber(packageForm.weightG);
    const lengthMm = packageNumber(packageForm.lengthMm);
    const widthMm = packageNumber(packageForm.widthMm);
    const heightMm = packageNumber(packageForm.heightMm);
    if (!weightG || !lengthMm || !widthMm || !heightMm) {
      setPackageError('发布前需要完整填写重量、长、宽、高');
      return;
    }

    setPublishing(true);
    try {
      const savedMetadata = await saveSourcePublishInputs(weightG, lengthMm, widthMm, heightMm);
      const variantOfferIds = buildStableSourceVariantOfferIds(item);
      const res = await api.post('/api/collect/publish-ozon', {
        ids: [item.id],
        shopId,
        categoryId: selectedCandidate.categoryId,
        typeId: selectedCandidate.typeId,
        weight: weightG,
        depth: lengthMm,
        width: widthMm,
        height: heightMm,
        markupPct: parseSourcePublishNumber(publishMarkupPct, 0),
        markupAmount: parseSourcePublishNumber(publishMarkupAmount, 0),
        mode: 'clone',
        followBrand: false,
        randomOfferId: false,
        useItemCategory: true,
        source: 'source-publish-page',
        offerIds: { [item.id]: stableOfferId },
        ...(Object.keys(variantOfferIds).length ? { variantOfferIds: { [item.id]: variantOfferIds } } : {}),
      });
      if (res.code === 1) {
        const message = res.msg || '已提交源商品上架任务';
        setPublishMessage(message);
        toast({ title: message });
        onItemUpdate({ ...item, metadata: savedMetadata, status: 'listed' });
      } else {
        throw new Error(res.msg || '源商品上架失败');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '源商品上架失败';
      setPublishError(message);
      toast({ title: '上架失败', description: message, variant: 'destructive', duration: 8000 });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-3">
      <InfoPanel title="源商品上架" count={readiness.status === 'ready' ? '可发布' : '需补齐'}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <KeyValue
                label="Ozon 类目"
                value={selectedCandidate ? `${selectedCandidate.categoryNameZh || selectedCandidate.categoryName} / ${selectedCandidate.typeNameZh || selectedCandidate.typeName}` : '先选择候选'}
              />
              <KeyValue label="稳定货号" value={stableVariantOfferCount ? `${stableOfferId} / 变体 ${stableVariantOfferCount}` : stableOfferId} />
              <KeyValue label="件重尺" value={sourceStandardPackageText(sourceStandardAttributeModel({ ...item, metadata: { ...(item.metadata || {}), ...packageForm } }))} />
              <KeyValue label="预计售价" value={sourcePublishPricePreview(item, publishMarkupPct, publishMarkupAmount)} />
            </div>
            <div className="flex flex-wrap gap-2">
              {sourceAssets.map((asset) => (
                <Badge
                  key={asset.label}
                  variant="outline"
                  className={asset.done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}
                >
                  {asset.done ? <CheckCircle2 className="mr-1 h-3 w-3" /> : <AlertTriangle className="mr-1 h-3 w-3" />}
                  {asset.label}
                </Badge>
              ))}
            </div>
            {publishMessage ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{publishMessage}</div> : null}
            {publishError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{publishError}</div> : null}
          </div>
          <div className="space-y-3 rounded-md border bg-muted/20 p-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">加价%</span>
              <Input value={publishMarkupPct} onChange={(event) => setPublishMarkupPct(event.target.value)} type="number" className="h-8" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">固定加价(CNY)</span>
              <Input value={publishMarkupAmount} onChange={(event) => setPublishMarkupAmount(event.target.value)} type="number" className="h-8" />
            </label>
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={handleSourcePublish}
              disabled={publishing || !shopId || !selectedCandidate}
            >
              {publishing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              确认发布到Ozon
            </Button>
          </div>
        </div>
      </InfoPanel>
      <InfoPanel title="发布字段诊断" count={fieldDiagnostics.filter((row) => row.status === 'blocked').length ? `阻断 ${fieldDiagnostics.filter((row) => row.status === 'blocked').length}` : '自动检查'}>
        <SourcePublishFieldDiagnostics rows={fieldDiagnostics} />
      </InfoPanel>
      <InfoPanel title="上架检查" count={sourceListingStatusLabel(readiness.status)}>
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className={readiness.status === 'ready' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}
            title={sourceListingStatusLegend}
          >
            {sourceListingStatusLabel(readiness.status)}
          </Badge>
          {readiness.status === 'blocked' ? <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">阻断</Badge> : null}
          {readiness.status === 'needs_review' ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">待复核</Badge> : null}
        </div>
        {missing.length ? (
          <div className="flex flex-wrap gap-2">
            {missing.map((field) => (
              <Badge key={field} variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{field}</Badge>
            ))}
          </div>
        ) : <div className="text-emerald-700">关键上架字段已采集或已补全</div>}
      </InfoPanel>
      <InfoPanel title="手动补录件重尺" count={sourceStandardPackageText(sourceStandardAttributeModel({ ...item, metadata: { ...(item.metadata || {}), ...packageForm } })) || null}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant={packageMode === 'group' ? 'default' : 'outline'} onClick={() => setPackageMode('group')}>
              通用件重尺
            </Button>
            {displayVariants.length ? (
              <Button type="button" size="sm" variant={packageMode === 'variant' ? 'default' : 'outline'} onClick={() => setPackageMode('variant')}>
                按 SKU 补录
              </Button>
            ) : null}
            {displayVariants.length ? (
              <Button type="button" size="sm" variant="outline" onClick={applyGroupPackageToVariants}>
                应用到全部SKU
              </Button>
            ) : null}
          </div>
          {packageMode === 'group' ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">重量(g)</span>
                  <Input value={packageForm.weightG} onChange={(event) => setPackageField('weightG', event.target.value)} type="number" min="1" className="h-8" />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">长(mm)</span>
                  <Input value={packageForm.lengthMm} onChange={(event) => setPackageField('lengthMm', event.target.value)} type="number" min="1" className="h-8" />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">宽(mm)</span>
                  <Input value={packageForm.widthMm} onChange={(event) => setPackageField('widthMm', event.target.value)} type="number" min="1" className="h-8" />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">高(mm)</span>
                  <Input value={packageForm.heightMm} onChange={(event) => setPackageField('heightMm', event.target.value)} type="number" min="1" className="h-8" />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={saveManualPackage} disabled={packageSaving}>
                  {packageSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  保存件重尺
                </Button>
                {packageMessage ? <span className="text-xs text-emerald-700">{packageMessage}</span> : null}
                {packageError ? <span className="text-xs text-destructive">{packageError}</span> : null}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="max-h-80 overflow-auto rounded-md border">
                <div className="grid min-w-[760px] grid-cols-[minmax(180px,1fr)_110px_110px_110px_110px] bg-muted/50 px-3 py-2 text-xs font-medium">
                  <div>SKU</div>
                  <div>重量(g)</div>
                  <div>长(mm)</div>
                  <div>宽(mm)</div>
                  <div>高(mm)</div>
                </div>
                {displayVariants.map((variant, index) => {
                  const key = sourceVariantKey(variant, index);
                  const form = variantPackageForms[key] || { weightG: '', lengthMm: '', widthMm: '', heightMm: '' };
                  return (
                    <div key={key} className="grid min-w-[760px] grid-cols-[minmax(180px,1fr)_110px_110px_110px_110px] gap-2 border-t px-3 py-2 text-xs">
                      <div className="break-words">{sourceVariantLabel(variant, index)}</div>
                      <Input value={form.weightG} onChange={(event) => setVariantPackageField(key, 'weightG', event.target.value)} type="number" min="1" className="h-8" />
                      <Input value={form.lengthMm} onChange={(event) => setVariantPackageField(key, 'lengthMm', event.target.value)} type="number" min="1" className="h-8" />
                      <Input value={form.widthMm} onChange={(event) => setVariantPackageField(key, 'widthMm', event.target.value)} type="number" min="1" className="h-8" />
                      <Input value={form.heightMm} onChange={(event) => setVariantPackageField(key, 'heightMm', event.target.value)} type="number" min="1" className="h-8" />
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={saveVariantPackages} disabled={packageSaving}>
                  {packageSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  保存SKU件重尺
                </Button>
                {packageMessage ? <span className="text-xs text-emerald-700">{packageMessage}</span> : null}
                {packageError ? <span className="text-xs text-destructive">{packageError}</span> : null}
              </div>
            </div>
          )}
        </div>
      </InfoPanel>
      <InfoPanel title="Ozon 类目候选" count={selectedCandidate ? ozonCandidateLabelText(selectedCandidate.label) : null}>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <Store className="h-4 w-4 shrink-0" />
              <span className="shrink-0">店铺</span>
              <select
                value={shopId}
                onChange={(event) => handleSourcePublishShopChange(event.target.value)}
                disabled={shopsLoading || candidateLoading}
                className="h-8 min-w-0 rounded-md border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {shops.length === 0 ? <option value="">请先添加 OZON 店铺</option> : null}
                {shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name}</option>)}
              </select>
            </div>
            {selectedCandidate ? (
              <Button type="button" size="sm" onClick={confirmSelectedCandidate} disabled={confirming || candidateLoading}>
                {confirming ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                确认类目
              </Button>
            ) : null}
          </div>

          {candidateLoading ? (
            <div className="rounded-md border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              正在生成候选
            </div>
          ) : null}
          {candidateError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{candidateError}</div> : null}
          {shopSelectionMessage && !candidateError ? <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{shopSelectionMessage}</div> : null}
          {confirmMessage ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{confirmMessage}</div> : null}
          {selectedCandidate ? (
            <div className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${selectedCandidateConfirmed ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              <Badge variant="outline" className={selectedCandidateConfirmed ? 'border-emerald-200 bg-white text-emerald-700' : 'border-amber-200 bg-white text-amber-700'}>
                {selectedCandidateConfirmed ? '已确认类目' : '候选待确认'}
              </Badge>
              <span>{selectedCandidateConfirmed ? '已写入上架参数。' : '点击确认类目后解除 Ozon 类目/type 阻断；发布时也会保存当前候选。'}</span>
            </div>
          ) : null}

          {!candidateLoading && !candidateError && candidates.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无可用候选</div>
          ) : null}

          {candidates.length ? (
            <div className="space-y-2">
              {candidates.map((candidate) => {
                const candidateKey = ozonCategoryCandidateKey(candidate);
                const isSelected = candidateKey === selectedCandidateKey;
                const translationLabel = ozonCandidateTranslationLabel(candidate.translationStatus);
                const untranslatedTerms = Array.isArray(candidate.untranslatedTerms) ? candidate.untranslatedTerms : [];
                return (
                  <button
                    key={candidateKey}
                    type="button"
                    onClick={() => setSelectedCandidateKey(candidateKey)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${isSelected ? 'border-primary bg-primary/5' : 'bg-background hover:bg-muted/40'}`}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium leading-snug">
                          {candidate.displayPathZh || `${candidate.categoryNameZh || candidate.categoryName || '-'} / ${candidate.typeNameZh || candidate.typeName || '-'}`}
                        </div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          {candidate.displayPathRu || `${candidate.categoryName || '-'} / ${candidate.typeName || '-'}`}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          category {candidate.categoryId} · type {candidate.typeId} · 分数 {candidate.score}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <Badge variant="outline" className={ozonCandidateLabelClass(candidate.label)}>{ozonCandidateLabelText(candidate.label)}</Badge>
                        {translationLabel ? <Badge variant="outline" className={ozonCandidateTranslationClass(candidate.translationStatus)}>{translationLabel}</Badge> : null}
                        {candidate.confirmationCount ? <Badge variant="outline">历史 {candidate.confirmationCount}</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {candidate.reasons.map((reason) => <Badge key={reason} variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">{reason}</Badge>)}
                      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">可映射属性 {candidate.attributePlan.candidates.length}</Badge>
                      {candidate.attributePlan.missingRequired.length ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">缺必填 {candidate.attributePlan.missingRequired.length}</Badge>
                      ) : null}
                    </div>
                    {untranslatedTerms.length ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        待翻译：{untranslatedTerms.slice(0, 3).join('、')}
                      </div>
                    ) : null}
                    {candidate.attributePlan.missingRequired.length ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        缺口：{candidate.attributePlan.missingRequired.slice(0, 3).map((gap) => gap.attributeName || gap.standardKey).join('、')}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </InfoPanel>
      {readiness.blockers.length ? (
        <InfoPanel title="阻断项" count={readiness.blockers.length}>
          <ReadinessIssueList issues={readiness.blockers} tone="blocked" />
        </InfoPanel>
      ) : null}
      {readiness.warnings.length ? (
        <InfoPanel title="待复核项" count={readiness.warnings.length}>
          <ReadinessIssueList issues={readiness.warnings} tone="warning" />
        </InfoPanel>
      ) : null}
      {readiness.restrictionRisks.length ? (
        <InfoPanel title="销售受限/出口限制" count={readiness.restrictionRisks.length}>
          <ReadinessIssueList issues={readiness.restrictionRisks} tone="blocked" />
        </InfoPanel>
      ) : null}
      <InfoPanel title="素材处理" count={sourceRichContentDraftStatus(item) || null}>
        <div className="flex flex-wrap gap-2">
          {sourceAssets.map((asset) => (
            <Badge
              key={asset.label}
              variant="outline"
              className={asset.done ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-600'}
            >
              {asset.label}
            </Badge>
          ))}
        </div>
      </InfoPanel>
    </div>
  );
}

function sourcePublishDiagnosticLabel(status: SourceListingFieldDiagnosticStatus): string {
  if (status === 'auto') return '自动填充';
  if (status === 'blocked') return '阻断缺失';
  if (status === 'manual') return '人工补录';
  return '需要确认';
}

function sourcePublishDiagnosticClass(status: SourceListingFieldDiagnosticStatus): string {
  if (status === 'auto') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'manual') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function SourcePublishFieldDiagnostics({ rows }: { rows: SourceListingFieldDiagnostic[] }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.key} className="rounded-md border bg-muted/20 px-3 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.label}</span>
                <Badge variant="outline" className={sourcePublishDiagnosticClass(row.status)}>
                  {sourcePublishDiagnosticLabel(row.status)}
                </Badge>
                <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">
                  {row.confidence}
                </Badge>
              </div>
              <div className="mt-1 break-words text-xs text-muted-foreground">
                {row.source} · {row.evidence}
              </div>
            </div>
            <div className="min-w-0 text-left sm:max-w-[42%] sm:text-right">
              <div className="break-words text-sm">{row.value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{row.action}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReadinessIssueList({ issues, tone }: { issues: string[]; tone: 'blocked' | 'warning' }) {
  const className = tone === 'blocked'
    ? 'border-red-200 bg-red-50 text-red-700'
    : 'border-amber-200 bg-amber-50 text-amber-700';
  return (
    <div className="flex flex-wrap gap-2">
      {issues.map((issue) => <Badge key={issue} variant="outline" className={className}>{issue}</Badge>)}
    </div>
  );
}

function MetricBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-medium leading-snug [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}：</span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function InfoPanel({ title, count, children }: { title: string; count: string | number | null; children: ReactNode }) {
  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-medium">{title}</div>
        {count != null ? <Badge variant="outline">{count}</Badge> : null}
      </div>
      {children}
    </div>
  );
}

function SourceImageGrid({ images, empty, limit, onRemove }: { images: string[]; empty: string; limit: number; onRemove?: (image: string) => void }) {
  if (!images.length) return <div className="text-muted-foreground">{empty}</div>;
  return (
    <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
      {images.slice(0, limit).map((image, index) => (
        <div key={index} className="group relative aspect-square overflow-hidden rounded border bg-muted">
          <a href={image} target="_blank" rel="noreferrer" className="block h-full w-full">
            <img
              src={image}
              alt=""
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.parentElement?.parentElement?.classList.add('hidden');
              }}
            />
          </a>
          {onRemove ? (
            <button
              type="button"
              aria-label="删除图片"
              title="删除图片"
              className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded border border-red-200 bg-white/95 text-red-600 opacity-0 shadow-sm transition hover:bg-red-50 group-hover:opacity-100"
              onClick={() => onRemove(image)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ImageStatusList({ images, empty }: { images: unknown[]; empty: string }) {
  const urls = images.map((image) => String(image || '')).filter(isPreviewableSourceImage);
  return <SourceImageGrid images={urls} empty={empty} limit={8} />;
}

export default function SourceCollectPage() {
  const [items, setItems] = useState<SourceCollectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [error, setError] = useState('');
  const [detailItem, setDetailItem] = useState<SourceCollectItem | null>(null);
  const [activeDetailSection, setActiveDetailSection] = useState<DetailSection>('overview');

  async function loadItems() {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '50', sourceGroup: 'source' });
    if (search.trim()) params.set('search', search.trim());
    const res = await api.get<{ total: number; rows: SourceCollectItem[] }>(`/api/collect?${params}`);
    if (res.code === 1 && res.data) {
      setItems(res.data.rows.filter(isSourceCollectItem));
    } else {
      setError(res.msg || '读取货源采集列表失败');
    }
    setLoading(false);
  }

  function updateItem(next: SourceCollectItem) {
    setItems((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    setDetailItem((current) => (current?.id === next.id ? next : current));
  }

  async function handleDelete(item: SourceCollectItem) {
    if (!window.confirm(`确认删除采集记录「${sourceDisplayTitle(item)}」？`)) return;
    const id = item.id;
    const res = await api.delete(`/api/collect/${id}`);
    if (res.code === 1) {
      setItems((prev) => prev.filter((row) => row.id !== id));
      setDetailItem((current) => (current?.id === id ? null : current));
      toast({ title: '已删除采集记录' });
    } else {
      toast({ title: res.msg || '删除采集记录失败', variant: 'destructive' });
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter((item) => platform === 'all' || normalizePlatform(item.sourcePlatform) === platform);
  }, [items, platform]);

  const counts = useMemo(() => {
    return platformTabs.reduce<Record<string, number>>((acc, tab) => {
      acc[tab.key] = tab.key === 'all'
        ? items.length
        : items.filter((item) => normalizePlatform(item.sourcePlatform) === tab.key).length;
      return acc;
    }, {});
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">1688商品采集</h1>
          <div className="text-sm text-muted-foreground mt-1">货源商品采集、翻译、类目映射和上架准备</div>
        </div>
        <Button variant="outline" onClick={loadItems} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {platformTabs.map((tab) => (
                <Button
                  key={tab.key}
                  type="button"
                  variant={platform === tab.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPlatform(tab.key)}
                >
                  {tab.label}
                  <span className="ml-2 text-xs opacity-70">{counts[tab.key] || 0}</span>
                </Button>
              ))}
            </div>
            <div className="flex gap-2 md:w-80">
              <div className="relative flex-1">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') loadItems();
                  }}
                  className="pl-9"
                  placeholder="标题 / SKU / 商品ID"
                />
              </div>
              <Button variant="outline" onClick={loadItems}>搜索</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {error && <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <div className="space-y-3">
            {loading ? (
              <div className="rounded-md border px-3 py-10 text-center text-muted-foreground">
                <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
                读取中
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="rounded-md border px-3 py-10 text-center text-muted-foreground">暂无货源采集记录</div>
            ) : filteredItems.map((item) => (
              <SourceProductRow
                key={item.id}
                item={item}
                onDetail={(next, section = 'overview') => {
                  setDetailItem(next);
                  setActiveDetailSection(section);
                }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detailItem} onOpenChange={(open) => { if (!open) setDetailItem(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>采集详情</DialogTitle>
          </DialogHeader>
          {detailItem ? (
            <SourceDetailContent
              item={detailItem}
              activeSection={activeDetailSection}
              onSectionChange={setActiveDetailSection}
              onItemUpdate={updateItem}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
