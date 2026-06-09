export type Collect1688PreviewInput = {
  sourceUrl: string;
  title: string;
  sourceCategoryName: string;
  supplier: string;
  sku: string;
  purchasePriceCny: string;
  domesticShippingCny: string;
  weightG: string;
  packageFeeCny: string;
  commissionPct: string;
  logisticsFeeCny: string;
  exchangeRateRubToCny: string;
  targetMarginPct: string;
  notes: string;
};

const PREVIEW_FIELDS: Array<keyof Collect1688PreviewInput> = [
  'sourceUrl',
  'title',
  'sourceCategoryName',
  'purchasePriceCny',
  'domesticShippingCny',
  'weightG',
  'packageFeeCny',
  'commissionPct',
  'logisticsFeeCny',
  'exchangeRateRubToCny',
  'targetMarginPct',
];

export function buildCollect1688PreviewSignature(input: Collect1688PreviewInput): string {
  return JSON.stringify(PREVIEW_FIELDS.map((key) => [key, String(input[key] ?? '').trim()]));
}

export function isCollect1688PreviewStale(
  input: Collect1688PreviewInput,
  previewSignature: string | null,
): boolean {
  return !!previewSignature && buildCollect1688PreviewSignature(input) !== previewSignature;
}

export type Collect1688SavePreview = {
  saveMode?: 'create' | 'update' | null;
  existingSupplyGood?: {
    id: string;
    title: string;
    sourceProductId: string | null;
    updatedAt?: string | Date | null;
  } | null;
} | null;

export function getCollect1688SaveAction(preview: Collect1688SavePreview) {
  if (preview?.saveMode === 'update' && preview.existingSupplyGood) {
    return {
      variant: 'update' as const,
      buttonLabel: '更新已有货源',
      panelTitle: '将更新已有货源',
      panelDescription: `已匹配 ${preview.existingSupplyGood.title || '同款货源'}，保存后会覆盖成本、核价和类目映射。`,
    };
  }

  return {
    variant: 'create' as const,
    buttonLabel: '保存到货源',
    panelTitle: '将创建新货源',
    panelDescription: '当前 1688 ID 未匹配已有货源，保存后会新增一条货源记录。',
  };
}
