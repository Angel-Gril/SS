export interface SourceEvidenceTrustSignal {
  confidence?: unknown;
  isEstimated?: unknown;
}

export interface SourceSkuStockEvidence {
  kind?: unknown;
  stock?: unknown;
  rowEvidence?: SourceEvidenceTrustSignal | null;
  fieldEvidence?: {
    stock?: SourceEvidenceTrustSignal | null;
  } | null;
}

export function isTrustedSourceEvidence<T extends SourceEvidenceTrustSignal>(
  evidence: T | null | undefined,
): evidence is T & { confidence: number; isEstimated: false } {
  return evidence?.isEstimated === false
    && typeof evidence.confidence === 'number'
    && Number.isFinite(evidence.confidence)
    && evidence.confidence > 0;
}

export function hasTrustedSourceEvidence(
  ...evidence: Array<SourceEvidenceTrustSignal | null | undefined>
): boolean {
  return evidence.length > 0 && evidence.every((entry) => isTrustedSourceEvidence(entry));
}

export function trustedPositiveSourceNumber(
  value: unknown,
  evidence: SourceEvidenceTrustSignal | null | undefined,
): number | null {
  return isTrustedSourceEvidence(evidence)
    && typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    ? value
    : null;
}

export function trustedNonNegativeSourceNumber(
  value: unknown,
  evidence: SourceEvidenceTrustSignal | null | undefined,
): number | null {
  return isTrustedSourceEvidence(evidence)
    && typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : null;
}

export function trustedObservedSkuStock(sku: SourceSkuStockEvidence): number | null {
  if (sku.kind !== 'observed'
    || !hasTrustedSourceEvidence(sku.rowEvidence, sku.fieldEvidence?.stock)) {
    return null;
  }
  return trustedNonNegativeSourceNumber(sku.stock, sku.fieldEvidence?.stock);
}
