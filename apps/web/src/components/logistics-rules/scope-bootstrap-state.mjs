const ADMIN_LOGISTICS_RULES_BASE = '/api/admin/logistics-rules';

function encoded(value) {
  return encodeURIComponent(String(value || '').trim());
}

export function buildScopeBootstrapWorkspacePath(filters = {}) {
  const query = [];
  for (const key of ['bootstrapId', 'tenantId', 'shopId', 'warehouseId']) {
    const value = String(filters[key] || '').trim();
    if (value) query.push(`${key}=${encodeURIComponent(value)}`);
  }
  return `${ADMIN_LOGISTICS_RULES_BASE}/scope-bootstrap/workspace${
    query.length ? `?${query.join('&')}` : ''
  }`;
}

export function buildScopeBootstrapPath() {
  return `${ADMIN_LOGISTICS_RULES_BASE}/scope-bootstrap`;
}

export function buildBindingProbePath() {
  return `${ADMIN_LOGISTICS_RULES_BASE}/binding-probes`;
}

export function buildBindingProbeStatusPath(probeId) {
  return `${buildBindingProbePath()}/${encoded(probeId)}`;
}

export function buildBindingProbeDecisionPath(probeId, decision) {
  if (decision !== 'confirm' && decision !== 'reject') {
    throw new Error(`Unsupported binding probe decision: ${decision}`);
  }
  return `${buildBindingProbeStatusPath(probeId)}/${decision}`;
}

export function buildOriginBindingConfirmPath(bootstrapId) {
  return `${ADMIN_LOGISTICS_RULES_BASE}/scope-bootstrap/${encoded(bootstrapId)}/activate-origin`;
}

export function buildOfficialCountriesPath() {
  return `${ADMIN_LOGISTICS_RULES_BASE}/official-locations/countries`;
}

export function buildOfficialCitiesPath(countryUid) {
  return `${buildOfficialCountriesPath()}/${encoded(countryUid)}/cities`;
}

export function buildOfficialDestinationsPath() {
  return `${ADMIN_LOGISTICS_RULES_BASE}/official-locations/destinations`;
}

function operationRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function resolveProbeDisplayStatus(value, now = Date.now()) {
  const probe = operationRecord(value);
  const status = String(probe.status || '').trim().toUpperCase();
  if (!['ISSUED', 'CLAIMED'].includes(status)) return status;

  const expiresAt = Date.parse(String(probe.expiresAt || ''));
  return Number.isFinite(expiresAt) && expiresAt <= now ? 'EXPIRED' : status;
}

function nestedResource(source, key) {
  const value = operationRecord(source[key]);
  return Object.keys(value).length ? value : null;
}

export function normalizeScopeBootstrapOperationResult(value) {
  const source = operationRecord(value);
  const status = String(source.status || '').trim().toUpperCase();
  const directBootstrapId = String(source.bootstrapId || source.id || '').trim();
  const directScope = operationRecord(source.openApiScope);
  const directBootstrap =
    directBootstrapId && (source.tenantId || Object.keys(directScope).length > 0) &&
      ['CANDIDATE', 'ACTIVATED'].includes(status)
      ? { ...source, id: directBootstrapId, bootstrapId: directBootstrapId }
      : null;
  const probeId = String(source.probeId || '').trim();
  const companyBindingId = String(source.companyBindingId || '').trim();
  const originBindingId = String(source.originBindingId || '').trim();
  const channelId = String(source.channelId || '').trim();
  const assignmentId = String(source.assignmentId || '').trim();

  return {
    bootstrap: nestedResource(source, 'bootstrap') ||
      nestedResource(source, 'activeBootstrap') || directBootstrap,
    probe: nestedResource(source, 'probe') || nestedResource(source, 'bindingProbe') ||
      (probeId
        ? {
            id: probeId,
            probeId,
            ...(directBootstrapId ? { bootstrapId: directBootstrapId } : {}),
            status,
            ...(source.expiresAt ? { expiresAt: String(source.expiresAt) } : {}),
          } : null),
    companyBinding: nestedResource(source, 'companyBinding') ||
      (companyBindingId
        ? {
            id: companyBindingId,
            companyBindingId,
            status: String(source.companyBindingStatus || '').trim().toUpperCase() ||
              (status === 'CONFIRMED' ? 'VERIFIED' : ''),
          }
        : null),
    originBinding: nestedResource(source, 'originBinding') ||
      (originBindingId ? { id: originBindingId, originBindingId, status: 'VERIFIED' } : null),
    channel: nestedResource(source, 'channel') ||
      (channelId ? { id: channelId, channelId } : null),
    assignment: nestedResource(source, 'assignment') ||
      (assignmentId ? { id: assignmentId, assignmentId } : null),
    blockers: Array.isArray(source.blockers) ? source.blockers : [],
  };
}
