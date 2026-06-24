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
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { evaluateSourceListingReadiness, sourceListingStatusLabel } from '@/lib/source-listing-readiness';
import { formatDate } from '@/lib/utils';
import { normalizeSourceStandardAttributes } from 'shared/source-standard-attributes';

type PlatformFilter = 'all' | '1688' | 'pdd' | 'taobao' | 'tmall';
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

interface SourceOzonCategoryCandidate {
  categoryId: number;
  typeId: number;
  categoryName: string;
  typeName: string;
  categoryNameZh?: string;
  typeNameZh?: string;
  displayPathZh?: string;
  displayPathRu?: string;
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

const platformTabs: Array<{ key: PlatformFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: '1688', label: '1688' },
  { key: 'pdd', label: 'PDD' },
  { key: 'taobao', label: '淘宝' },
  { key: 'tmall', label: '天猫' },
];

const detailSections: Array<{ key: DetailSection; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'sku', label: 'SKU' },
  { key: 'attributes', label: '属性' },
  { key: 'images', label: '图片' },
  { key: 'translation', label: '翻译' },
  { key: 'listing', label: '上架检查' },
];

const sourceListingStatusLegend = '可上架 / 待复核 / 阻断 / 真实商品标题 / 俄文标题/描述 / Ozon 类目/type / Ozon 必填属性/字典值 / 颜色尺码变体 / 重量尺寸 / 销售受限/出口限制';

function normalizePlatform(value: unknown): PlatformFilter | 'other' {
  const text = String(value || '').trim().toLowerCase();
  if (text.includes('1688')) return '1688';
  if (text.includes('pdd') || text.includes('pinduoduo') || text.includes('yangkeduo')) return 'pdd';
  if (text.includes('tmall') || text.includes('天猫')) return 'tmall';
  if (text.includes('taobao') || text.includes('淘宝')) return 'taobao';
  return 'other';
}

function platformLabel(value: unknown): string {
  const platform = normalizePlatform(value);
  if (platform === 'pdd') return 'PDD';
  if (platform === 'taobao') return '淘宝';
  if (platform === 'tmall') return '天猫';
  if (platform === '1688') return '1688';
  return String(value || '货源');
}

function sourceVideoCount(item: SourceCollectItem): number {
  const videos = item.metadata?.sourceVideos;
  return Array.isArray(videos) ? videos.length : 0;
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

function hasMetadataValue(item: SourceCollectItem, keys: string[]): boolean {
  return keys.some((key) => {
    const value = item.metadata?.[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return Boolean(value);
  });
}

function sourceHasTranslation(item: SourceCollectItem): boolean {
  return hasMetadataValue(item, ['publishTitleRu', 'sourceDescriptionRu', 'titleRu', 'descriptionRu']);
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

function workflowActionClass(enabled: boolean): string {
  return enabled ? 'text-foreground hover:text-primary' : 'text-muted-foreground/70 hover:text-foreground';
}

function extractionDiagnosticText(item: SourceCollectItem): string {
  const diagnostics = item.metadata?.extractionDiagnostics;
  if (!diagnostics || typeof diagnostics !== 'object') return '';
  const data = diagnostics as Record<string, unknown>;
  return [
    `图 ${String(data.imageCount ?? sourceImageCount(item))}`,
    `过滤图片 ${String(data.rejectedImageCount ?? sourceRejectedAssetCount(item))}`,
    `SKU ${String(data.skuCount ?? sourceVariants(item).length)}`,
    `属性 ${String(data.attributeCount ?? sourceAttributeCount(item))}`,
    `价格来源 ${sourcePriceModelText(item)}`,
    `描述 ${data.descriptionFound ? '有' : '无'}`,
    `视频 ${String(data.videoCount ?? sourceVideoCount(item))}`,
  ].join(' / ');
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
  return ['1688', 'pdd', 'taobao', 'tmall'].includes(normalizePlatform(item.sourcePlatform));
}

function SourceProductRow({
  item,
  onDetail,
}: {
  item: SourceCollectItem;
  onDetail: (item: SourceCollectItem, section?: DetailSection) => void;
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
              {item.sourceUrl ? (
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer" title="打开来源页面">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
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
      {activeSection === 'images' ? <SourceImagesSection item={item} /> : null}
      {activeSection === 'translation' ? <SourceTranslationSection item={item} /> : null}
      {activeSection === 'listing' ? <SourceListingCheckSection item={item} onItemUpdate={onItemUpdate} /> : null}
    </div>
  );
}

function SourceOverviewSection({ item }: { item: SourceCollectItem }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <MetricBlock label="平台" value={platformLabel(item.sourcePlatform)} />
        <MetricBlock label="采购价" value={detailPriceText(item)} />
        <MetricBlock label="价格来源" value={sourcePriceModelText(item)} />
        <MetricBlock label="SKU" value={String(variantCount(item))} />
        <MetricBlock label="主图" value={`${sourcePreviewImages(item).length}/${sourceImageCount(item)}`} />
        <MetricBlock label="详情图" value={`${sourceDetailPreviewImages(item).length}/${sourceDetailImageCount(item)}`} />
        <MetricBlock label="包装" value={String(sourcePackagingRows(item).length)} />
        <MetricBlock label="过滤图片" value={String(sourceRejectedAssetCount(item))} />
      </div>
      <InfoPanel title="采集诊断" count={null}>
        <div className="text-muted-foreground">{extractionDiagnosticText(item) || '暂无诊断信息'}</div>
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

      <InfoPanel title="包装信息" count={packagingRows.length}>
        {packagingRows.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {packagingRows.slice(0, 80).map((row, index) => (
              <div key={index} className="rounded border bg-muted/30 px-3 py-2 text-xs">
                <div className="break-words">{packagingRowTitle(row, index)}</div>
                <div className="mt-1 text-muted-foreground">{packagingRowMeta(row) || '未采集到件重尺'}</div>
              </div>
            ))}
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
          <KeyValue label="重量尺寸" value={sourceStandardPackageText(standard)} />
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

function SourceImagesSection({ item }: { item: SourceCollectItem }) {
  const images = sourcePreviewImages(item);
  const detailImages = sourceDetailPreviewImages(item);
  const watermarked = metadataArray(item, 'watermarkedImages');
  const edited = metadataArray(item, 'editedImages').concat(metadataArray(item, 'processedImages'));
  return (
    <div className="space-y-3">
      <InfoPanel title="主图预览" count={`${images.length} / ${sourceImageCount(item)}`}>
        <SourceImageGrid images={images} empty="未采集到可预览商品图片" limit={32} />
      </InfoPanel>
      <InfoPanel title="详情图原始素材" count={`${detailImages.length} / ${sourceDetailImageCount(item)}`}>
        <SourceImageGrid images={detailImages} empty="未采集到详情图原始素材" limit={50} />
      </InfoPanel>
      <div className="grid gap-3 md:grid-cols-2">
        <InfoPanel title="水印图" count={watermarked.length}>
          <ImageStatusList images={watermarked} empty="暂无水印图" />
        </InfoPanel>
        <InfoPanel title="改图结果" count={edited.length}>
          <ImageStatusList images={edited} empty="暂无改图结果" />
        </InfoPanel>
      </div>
    </div>
  );
}

function SourceTranslationSection({ item }: { item: SourceCollectItem }) {
  const richDraftSummary = sourceRichContentDraftSummary(item);
  return (
    <div className="space-y-3">
      <InfoPanel title="翻译" count={sourceHasTranslation(item) ? '已翻译' : '待翻译'}>
        <div className="grid gap-2">
          <KeyValue label="中文标题" value={sourceDisplayTitle(item)} />
          <KeyValue label="俄文标题" value={String(item.metadata?.publishTitleRu || item.metadata?.titleRu || '-')} />
          <KeyValue label="俄文描述" value={String(item.metadata?.sourceDescriptionRu || item.metadata?.descriptionRu || '-')} />
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
  const missing = readiness.missingFields;
  const [shops, setShops] = useState<OzonShopOption[]>([]);
  const [shopId, setShopId] = useState('');
  const [shopsLoading, setShopsLoading] = useState(false);
  const [categoryData, setCategoryData] = useState<SourceOzonCategoryCandidateResponse | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [selectedCandidateKey, setSelectedCandidateKey] = useState('');
  const [confirming, setConfirming] = useState(false);
  const candidates = categoryData?.candidates || [];
  const selectedCandidate = candidates.find((candidate) => ozonCategoryCandidateKey(candidate) === selectedCandidateKey) || candidates[0];
  const sourceAssets = [
    { label: `主图 ${sourcePreviewImages(item).length}/${sourceImageCount(item)}`, done: sourcePreviewImages(item).length > 0 },
    { label: `详情图 ${sourceDetailPreviewImages(item).length}/${sourceDetailImageCount(item)}`, done: sourceDetailPreviewImages(item).length > 0 },
    { label: sourceRichContentDraft(item) ? '原始富内容待处理' : '富内容待采', done: !!sourceRichContentDraft(item) },
    { label: `包装信息 ${sourcePackagingRows(item).length}`, done: sourcePackagingRows(item).length > 0 },
  ];

  useEffect(() => {
    let cancelled = false;
    setShopsLoading(true);
    api.get<OzonShopOption[]>('/api/shops').then((res) => {
      if (cancelled) return;
      if (res.code === 1 && res.data) {
        const ozonShops = res.data.filter((shop) => shop.platform === 'OZON');
        setShops(ozonShops);
        setShopId((current) => current || ozonShops[0]?.id || '');
      }
      setShopsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

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

  return (
    <div className="space-y-3">
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
      <InfoPanel title="Ozon 类目候选" count={selectedCandidate ? ozonCandidateLabelText(selectedCandidate.label) : null}>
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <Store className="h-4 w-4 shrink-0" />
              <span className="shrink-0">店铺</span>
              <select
                value={shopId}
                onChange={(event) => setShopId(event.target.value)}
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
          {confirmMessage ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{confirmMessage}</div> : null}

          {!candidateLoading && !candidateError && candidates.length === 0 ? (
            <div className="text-sm text-muted-foreground">暂无可用候选</div>
          ) : null}

          {candidates.length ? (
            <div className="space-y-2">
              {candidates.map((candidate) => {
                const candidateKey = ozonCategoryCandidateKey(candidate);
                const isSelected = candidateKey === selectedCandidateKey;
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

function SourceImageGrid({ images, empty, limit }: { images: string[]; empty: string; limit: number }) {
  if (!images.length) return <div className="text-muted-foreground">{empty}</div>;
  return (
    <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
      {images.slice(0, limit).map((image, index) => (
        <a key={index} href={image} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded border bg-muted">
          <img
            src={image}
            alt=""
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.parentElement?.classList.add('hidden');
            }}
          />
        </a>
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
