export function buildAdminLogisticsWorkspacePath(channelId = '', revisionId = '') {
  const query = [];
  if (String(channelId).trim()) {
    query.push(`channelId=${encodeURIComponent(String(channelId).trim())}`);
  }
  if (String(revisionId).trim()) {
    query.push(`revisionId=${encodeURIComponent(String(revisionId).trim())}`);
  }
  return `/api/admin/logistics-rules/workspace${query.length ? `?${query.join('&')}` : ''}`;
}

/**
 * Build one visible row per actual delivery-method binding without collapsing shared services.
 * @param {{services?: unknown[]; methodBindings?: unknown[]; selectedServiceKeys?: unknown[]}} input
 */
export function buildMethodBindingRows(input = {}) {
  const services = Array.isArray(input.services) ? input.services.filter(Boolean) : [];
  const methodBindings = Array.isArray(input.methodBindings)
    ? input.methodBindings.filter(Boolean)
    : [];
  const selected = new Set(
    Array.isArray(input.selectedServiceKeys) ? input.selectedServiceKeys.map(String) : [],
  );
  const serviceByKey = new Map(
    services.map((service) => [String(service.stableServiceKey || ''), service]),
  );
  const boundKeys = new Set(
    methodBindings.map((binding) => String(binding.stableServiceKey || '')),
  );
  const rows = methodBindings.map((binding, index) => {
    const stableServiceKey = String(binding.stableServiceKey || '');
    const bindingId = String(binding.id || '');
    return {
      rowId: bindingId ? `binding:${bindingId}` : `binding:${stableServiceKey}:${index}`,
      stableServiceKey,
      service: serviceByKey.get(stableServiceKey) || { stableServiceKey },
      binding,
    };
  });
  services.forEach((service) => {
    const stableServiceKey = String(service.stableServiceKey || '');
    if (!stableServiceKey || boundKeys.has(stableServiceKey)) return;
    rows.push({
      rowId: `service:${stableServiceKey}`,
      stableServiceKey,
      service,
      binding: null,
    });
  });
  rows.sort((left, right) => {
    const selectedOrder =
      Number(selected.has(right.stableServiceKey)) - Number(selected.has(left.stableServiceKey));
    if (selectedOrder) return selectedOrder;
    const serviceOrder = left.stableServiceKey.localeCompare(right.stableServiceKey);
    if (serviceOrder) return serviceOrder;
    return left.rowId.localeCompare(right.rowId);
  });
  return rows;
}

/**
 * @param {{
 *   revisionId: string;
 *   channelId: string;
 *   draft?: { id?: string } | null;
 *   diff?: { revisionId?: string; channelId?: string } | null;
 *   preflight?: { revisionId?: string; channelId?: string } | null;
 * }} input
 */
export function isPublishContextCurrent(input) {
  const revisionId = String(input.revisionId || '').trim();
  const channelId = String(input.channelId || '').trim();
  if (!revisionId || !channelId) return false;
  return Boolean(
    input.draft?.id === revisionId &&
    input.diff?.revisionId === revisionId &&
    input.diff?.channelId === channelId &&
    input.preflight?.revisionId === revisionId &&
    input.preflight?.channelId === channelId,
  );
}

/** @param {string} code */
export function logisticsIssueTarget(code) {
  if (code === 'unselected_provider_failed') return 'provider-inventory';
  if (code.includes('official') || code.includes('formula') || code === 'price_drift') {
    return 'official-resolutions';
  }
  if (code.includes('binding') || code.includes('destination') || code.includes('provider')) {
    return 'method-bindings';
  }
  return 'readiness-summary';
}
/**
 * Keep client-authored method suggestions limited to operator choices.
 * @param {Record<string, unknown>} input
 */
export function buildMethodBindingSuggestionPayload(input = {}) {
  return {
    channelId: String(input.channelId || '').trim(),
    revisionId: String(input.revisionId || '').trim(),
    deliveryMethodId: String(input.deliveryMethodId || '').trim(),
    stableServiceKey: String(input.stableServiceKey || '').trim(),
    note: String(input.note || '').trim(),
  };
}

/**
 * Official candidates, checksums and evidence are derived by the server.
 * @param {Record<string, unknown>} input
 */
export function buildOfficialResolutionSuggestionPayload(input = {}) {
  return {
    channelId: String(input.channelId || '').trim(),
    revisionId: String(input.revisionId || '').trim(),
    requirementKey: String(input.requirementKey || '').trim(),
    note: String(input.note || '').trim(),
  };
}

/** @param {Record<string, unknown>} input */
export function buildMethodBindingReviewPayload(input = {}) {
  return {
    channelId: String(input.channelId || '').trim(),
    revisionId: String(input.revisionId || '').trim(),
    expectedUpdatedAt: String(input.expectedUpdatedAt || '').trim(),
    note: String(input.note || '').trim(),
  };
}

/** @param {Record<string, unknown>} input */
export function buildOfficialResolutionReviewPayload(input = {}) {
  const payload = {
    channelId: String(input.channelId || '').trim(),
    revisionId: String(input.revisionId || '').trim(),
    expectedUpdatedAt: String(input.expectedUpdatedAt || '').trim(),
    note: String(input.note || '').trim(),
  };
  const selectedServiceKey = String(input.selectedServiceKey || '').trim();
  return selectedServiceKey ? { ...payload, selectedServiceKey } : payload;
}

/** @param {Record<string, unknown>} input */
export function reconcileReviewFailure(input = {}) {
  const refreshWorkspace =
    String(input.errorCode || '')
      .trim()
      .toUpperCase() === 'REVIEW_CONFLICT';
  return {
    discardReviewContext: refreshWorkspace,
    invalidatePreflight: refreshWorkspace,
    refreshWorkspace,
  };
}

/**
 * @param {Record<string, unknown>} requirement
 */
function officialRequirementFingerprintKey(requirement = {}) {
  const explicit = String(requirement.fingerprintKey || '').trim();
  if (explicit) return explicit;
  const requirementKey = String(requirement.requirementKey || '');
  if (!requirementKey.startsWith('req:v2:')) return '';
  try {
    const fields = JSON.parse(requirementKey.slice('req:v2:'.length));
    return Array.isArray(fields) ? String(fields[4] || '').trim() : '';
  } catch {
    return '';
  }
}

/** @param {unknown} value */
function officialRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function officialIssueAppliesToRequirement(issue, requirement, fingerprintKey) {
  const issueRequirementKey = String(issue.requirementKey || '').trim();
  const requirementKey = String(requirement.requirementKey || '').trim();
  if (issueRequirementKey) return issueRequirementKey === requirementKey;

  const issueFingerprintKey = String(issue.fingerprintKey || '').trim();
  if (issueFingerprintKey && issueFingerprintKey !== fingerprintKey) return false;

  const issueServiceKey = String(issue.stableServiceKey || '').trim();
  const requirementServiceKey = String(requirement.stableServiceKey || '').trim();
  return !issueServiceKey || issueServiceKey === requirementServiceKey;
}

/**
 * Build one review row per validation requirement. Fingerprints may repeat.
 * @param {{
 *   requirements?: unknown[];
 *   samples?: unknown[];
 *   resolutions?: unknown[];
 *   blockers?: unknown[];
 * }} input
 */
export function buildOfficialResolutionRows(input = {}) {
  const requirements = Array.isArray(input.requirements)
    ? input.requirements.map(officialRecord)
    : [];
  const samples = Array.isArray(input.samples) ? input.samples.map(officialRecord) : [];
  const resolutions = Array.isArray(input.resolutions) ? input.resolutions.map(officialRecord) : [];
  const blockers = Array.isArray(input.blockers) ? input.blockers.map(officialRecord) : [];
  const sampleByFingerprint = new Map(
    samples.map((sample) => [String(sample.fingerprintKey || ''), sample]),
  );
  const resolutionByRequirement = new Map(
    resolutions
      .map((resolution) => {
        const requirementKey = String(
          officialRecord(resolution.evidence).requirementKey || '',
        ).trim();
        return [requirementKey, resolution];
      })
      .filter(([requirementKey]) => requirementKey),
  );

  return requirements
    .map((requirement, index) => {
      const requirementKey = String(requirement.requirementKey || '').trim();
      if (!requirementKey) return null;
      const fingerprintKey = officialRequirementFingerprintKey(requirement);
      return {
        rowId: requirementKey || `requirement:${index}`,
        requirementKey,
        fingerprintKey,
        requirement,
        sample: sampleByFingerprint.get(fingerprintKey) || null,
        resolution: resolutionByRequirement.get(requirementKey) || null,
        issues: blockers.filter((issue) =>
          officialIssueAppliesToRequirement(issue, requirement, fingerprintKey),
        ),
      };
    })
    .filter(Boolean);
}

function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function boundedText(value, maxLength = 200) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength);
}

function nonNegativeInteger(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function optionalNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function nullableText(value, maxLength = 200) {
  const normalized = boundedText(value, maxLength);
  return normalized || null;
}

/**
 * A channel can be retired only while the selected workspace still points at its active release.
 * @param {Record<string, unknown>} input
 */
export function isChannelRetirementEligible(input = {}) {
  const channel = plainRecord(input.channel);
  const selectedChannelId = boundedText(input.selectedChannelId);
  const currentReleaseId = boundedText(input.currentReleaseId);
  return Boolean(
    selectedChannelId &&
    currentReleaseId &&
    boundedText(channel.id) === selectedChannelId &&
    !nullableText(channel.retiredAt) &&
    boundedText(channel.currentReleaseId) === currentReleaseId,
  );
}

/** @param {Record<string, unknown>} input */
export function isChannelRetirementReady(input = {}) {
  const reasonLength = String(input.reason ?? '').trim().length;
  return Boolean(
    input.eligible === true &&
    input.acknowledged === true &&
    reasonLength >= 3 &&
    reasonLength <= 500,
  );
}

/**
 * Keep reconciliation data on an explicit allowlist before it reaches React state.
 * @param {Record<string, unknown>} input
 */
export function normalizeChannelReceiptReconciliation(input = {}) {
  const source = plainRecord(input);
  const summary = plainRecord(source.summary);
  const byStatus = plainRecord(summary.byStatus);
  const rawRecords = Array.isArray(source.records) ? source.records : [];
  const records = rawRecords
    .map(plainRecord)
    .filter((record) => record.status === 'APPLIED' || record.status === 'FAILED')
    .map((record) => ({
      receiptId: boundedText(record.receiptId),
      assignmentId: boundedText(record.assignmentId),
      releaseId: boundedText(record.releaseId),
      releaseSequence: nonNegativeInteger(record.releaseSequence),
      effectiveChecksum: boundedText(record.effectiveChecksum, 128),
      status: record.status,
      failureCode: nullableText(record.failureCode, 160),
      extensionVersion: boundedText(record.extensionVersion, 64),
      appliedAt: nullableText(record.appliedAt, 64),
      receivedAt: boundedText(record.receivedAt, 64),
      deviceLabel: boundedText(record.deviceLabel, 120),
    }))
    .filter((record) => record.receiptId && record.assignmentId && record.releaseId);

  return {
    channelId: boundedText(source.channelId),
    currentSequence: nonNegativeInteger(source.currentSequence),
    retiredAt: nullableText(source.retiredAt, 64),
    summary: {
      total: nonNegativeInteger(summary.total),
      byStatus: {
        APPLIED: nonNegativeInteger(byStatus.APPLIED ?? summary.applied),
        FAILED: nonNegativeInteger(byStatus.FAILED ?? summary.failed),
      },
      expected: optionalNonNegativeInteger(summary.expected),
      pending: optionalNonNegativeInteger(summary.pending),
    },
    records,
  };
}
