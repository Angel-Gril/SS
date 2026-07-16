import {
  normalizeSourceStandardAttributes,
  type SourceCaptureEvidence,
  type SourceProductCaptureV2,
  type SourceStandardAttributes,
} from 'shared';
import type { SourceProductProfile } from './source-product-profile.js';
import type { SourceListingAttributeSourceContext } from './source-listing-workflow-attributes.js';
import {
  hasTrustedSourceEvidence,
  isTrustedSourceEvidence,
  trustedNonNegativeSourceNumber,
  trustedObservedSkuStock,
  trustedPositiveSourceNumber,
} from './source-evidence-trust.js';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  isProductOnlySourceCapture,
} from './source-listing-sku-identity.js';
import {
  OZON_V3_IMPORT_PACKAGE_CONTRACT,
  OZON_V3_IMPORT_PACKAGE_REQUIREMENTS,
} from './ozon-v3-import-package-contract.js';

type StandardKey = 'brand' | 'colors' | 'sizes' | 'materials' | 'gender' | 'seasons';

interface EvidenceRow {
  name: string;
  evidence: SourceCaptureEvidence[];
}

const STANDARD_PATTERNS: Record<StandardKey, RegExp> = {
  brand: /品牌|商标|牌子|brand/i,
  colors: /颜色|色号|color|colour|цвет/i,
  sizes: /尺码|尺寸|规格|size|размер/i,
  materials: /材质|成分|面料|主面料|里料|material|composition/i,
  gender: /性别|适用性别|适用人群|适合人群|gender/i,
  seasons: /季节|适合季节|season|上市年份\/季节|上市年份季节/i,
};

function normalizedKey(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

function evidenceFor(
  standard: SourceStandardAttributes,
  rows: EvidenceRow[],
  key: StandardKey,
  titleEvidence: SourceCaptureEvidence | undefined,
) {
  const matches = rows.filter((row) => STANDARD_PATTERNS[key].test(row.name));
  if (key === 'gender' && standard.gender.source === 'title' && isTrustedSourceEvidence(titleEvidence)) {
    matches.push({ name: 'title', evidence: [titleEvidence] });
  }
  if (!matches.length) return undefined;
  const proof = matches.flatMap((row) => row.evidence);
  const paths = [...new Set(proof.map((entry) => `${entry.sourceType}:${entry.sourcePath}`))];
  return {
    id: `capture-standard:${key}`,
    path: [
      ...paths.slice(0, 20),
      ...(paths.length > 20 ? [`+${paths.length - 20} more`] : []),
    ].join(', ').slice(0, 4096),
    confidence: Math.min(...proof.map((entry) => Number(entry.confidence) || 0)),
    isEstimated: proof.some((entry) => entry.isEstimated !== false),
  };
}

function standardEvidence(
  standard: SourceStandardAttributes,
  rows: EvidenceRow[],
  titleEvidence: SourceCaptureEvidence | undefined,
) {
  return {
    brand: evidenceFor(standard, rows, 'brand', titleEvidence),
    colors: evidenceFor(standard, rows, 'colors', titleEvidence),
    sizes: evidenceFor(standard, rows, 'sizes', titleEvidence),
    materials: evidenceFor(standard, rows, 'materials', titleEvidence),
    gender: evidenceFor(standard, rows, 'gender', titleEvidence),
    seasons: evidenceFor(standard, rows, 'seasons', titleEvidence),
  };
}

function evidenceLabel(evidence: SourceCaptureEvidence | undefined): string {
  return isTrustedSourceEvidence(evidence) && evidence.sourceType && evidence.sourcePath
    ? `${evidence.sourceType}:${evidence.sourcePath}`
    : '';
}

export function buildSourceListingAttributeSourceContext(input: {
  capture: SourceProductCaptureV2;
  sourceProfile: SourceProductProfile;
  selectedSkuKeys: string[];
}): SourceListingAttributeSourceContext {
  const capture = input.capture;
  const factEvidence = capture.fieldEvidence;
  const selectedSkuKeys = [...new Set(input.selectedSkuKeys.map(normalizedKey).filter(Boolean))];
  const selectedKeySet = new Set(selectedSkuKeys);
  const selectedSkus = (Array.isArray(capture.skus) ? capture.skus : [])
    .filter((sku) => selectedKeySet.has(sku.key)
      || (sku.sourceSkuId != null && selectedKeySet.has(sku.sourceSkuId)));
  const trustedProductAttributes = (Array.isArray(capture.attributes) ? capture.attributes : [])
    .filter((attribute) => (
      attribute.isSaleAttribute !== true
      && hasTrustedSourceEvidence(
        attribute.rowEvidence,
        attribute.fieldEvidence?.name,
        attribute.fieldEvidence?.value,
        attribute.fieldEvidence?.isSaleAttribute,
      )
    ));
  const trustedSelectedSkus = selectedSkus.map((sku) => ({
    ...sku,
    attributes: isTrustedSourceEvidence(sku.rowEvidence)
      ? sku.attributes.filter((attribute) => (
        hasTrustedSourceEvidence(
          attribute.fieldEvidence?.name,
          attribute.fieldEvidence?.value,
        )
      ))
      : [],
  }));
  const normalizeTrustedStandard = (skus: typeof trustedSelectedSkus) => normalizeSourceStandardAttributes({
    title: isTrustedSourceEvidence(factEvidence?.title) ? capture.facts?.title : null,
    metadata: {
      sourceAttributes: trustedProductAttributes.map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
      categoryPath: Array.isArray(capture.sourceCategory?.path)
        ? capture.sourceCategory.path.map((node) => node.name)
        : [],
      categoryName: capture.sourceCategory?.name,
    },
    variants: skus.map((sku) => ({
      attrs: Object.fromEntries(sku.attributes.map((attribute) => [attribute.name, attribute.value])),
    })),
  });
  const trustedProductEvidenceRows: EvidenceRow[] = trustedProductAttributes.map((attribute) => ({
    name: attribute.name,
    evidence: [
      attribute.rowEvidence,
      attribute.fieldEvidence.name,
      attribute.fieldEvidence.value,
      attribute.fieldEvidence.isSaleAttribute,
    ],
  }));
  const standardEvidenceRows: EvidenceRow[] = [
    ...trustedProductEvidenceRows,
    ...trustedSelectedSkus.flatMap((sku) => sku.attributes.map((attribute) => ({
      name: attribute.name,
      evidence: [sku.rowEvidence, attribute.fieldEvidence.name, attribute.fieldEvidence.value],
    }))),
  ];
  const sourceStandard = normalizeTrustedStandard(trustedSelectedSkus);
  const sourceStandardEvidence = standardEvidence(
    sourceStandard,
    standardEvidenceRows,
    factEvidence?.title,
  );

  const skuStandards: NonNullable<SourceListingAttributeSourceContext['skuStandards']> = {};
  for (const sku of trustedSelectedSkus) {
    const skuStandard = normalizeTrustedStandard([sku]);
    const skuRows: EvidenceRow[] = [
      ...trustedProductEvidenceRows,
      ...sku.attributes.map((attribute) => ({
        name: attribute.name,
        evidence: [sku.rowEvidence, attribute.fieldEvidence.name, attribute.fieldEvidence.value],
      })),
    ];
    const standard = {
      sourceStandard: skuStandard,
      sourceStandardEvidence: standardEvidence(skuStandard, skuRows, factEvidence?.title),
    };
    for (const selectedKey of selectedSkuKeys) {
      if (selectedKey === sku.key || selectedKey === sku.sourceSkuId) skuStandards[selectedKey] = standard;
    }
  }
  if (isProductOnlySourceCapture(capture)
    && selectedKeySet.has(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY)) {
    const productOnlyStandard = normalizeTrustedStandard([]);
    skuStandards[SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY] = {
      sourceStandard: productOnlyStandard,
      sourceStandardEvidence: standardEvidence(
        productOnlyStandard,
        trustedProductEvidenceRows,
        factEvidence?.title,
      ),
    };
  }

  const selectedStock = selectedSkus.reduce((summary, sku) => {
    if (trustedObservedSkuStock(sku) !== null) summary.known += 1;
    else summary.unknown += 1;
    return summary;
  }, { known: 0, unknown: Math.max(0, selectedSkuKeys.length - selectedSkus.length) });

  return {
    sourceProfile: input.sourceProfile,
    sourceStandard,
    sourceStandardEvidence,
    skuStandards,
    allowSourceProfileFallback: false,
    operationalFacts: {
      packageWeightG: trustedPositiveSourceNumber(capture.facts?.packageWeightG, factEvidence?.packageWeightG),
      packageLengthMm: trustedPositiveSourceNumber(capture.facts?.packageLengthMm, factEvidence?.packageLengthMm),
      packageWidthMm: trustedPositiveSourceNumber(capture.facts?.packageWidthMm, factEvidence?.packageWidthMm),
      packageHeightMm: trustedPositiveSourceNumber(capture.facts?.packageHeightMm, factEvidence?.packageHeightMm),
      selectedStock,
      shippingCny: trustedNonNegativeSourceNumber(capture.facts?.shippingCny, factEvidence?.shippingCny),
      evidence: {
        packageWeightG: evidenceLabel(factEvidence?.packageWeightG),
        packageLengthMm: evidenceLabel(factEvidence?.packageLengthMm),
        packageWidthMm: evidenceLabel(factEvidence?.packageWidthMm),
        packageHeightMm: evidenceLabel(factEvidence?.packageHeightMm),
        shippingCny: evidenceLabel(factEvidence?.shippingCny),
        selectedSkuStock: selectedSkus
          .map((sku) => trustedObservedSkuStock(sku) === null
            ? ''
            : evidenceLabel(sku.fieldEvidence?.stock))
          .filter(Boolean)
          .join(', '),
      },
      requirements: {
        ...OZON_V3_IMPORT_PACKAGE_REQUIREMENTS,
        importContract: {
          contractId: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId,
          contractRevision: OZON_V3_IMPORT_PACKAGE_CONTRACT.revision,
          contractHash: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash,
        },
      },
    },
  };
}
