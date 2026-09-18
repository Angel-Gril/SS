// Canonical runtime contract for plain Node.js operator CLIs.
// Keep this module free of TypeScript syntax and runtime dependencies so the
// production verifier can execute it without a loader.
export const REL04_VPS_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has invalid fields`);
  }
  return value;
}

function text(value, pattern, label, limit) {
  if (typeof value !== 'string' || value.length > limit || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function digest(value) {
  return text(value, /^[a-f0-9]{64}$/u, 'release evidence SHA-256', 64);
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new Error('release evidence timestamp is invalid');
  }
  return value;
}

export function parseRel04CandidateIdentity(value) {
  const item = object(value, [
    'gitCommit', 'apiOrigin', 'region', 'version', 'releaseEvidenceSha256',
    'releaseSignatureSha256',
  ], 'REL-04 candidate');
  const gitCommit = text(item.gitCommit, /^[a-f0-9]{40}$/u, 'candidate Git commit', 40);
  const version = text(
    item.version, /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u,
    'candidate version', 32,
  );
  if (item.region !== 'COM' && item.region !== 'CN') throw new Error('candidate region is invalid');
  const apiOrigin = text(item.apiOrigin, /^https:\/\//u, 'candidate API origin', 2048);
  const url = new URL(apiOrigin);
  if (url.origin !== apiOrigin || url.protocol !== 'https:' || url.port
    || url.username || url.password || url.search || url.hash
    || !url.hostname.endsWith(item.region === 'COM' ? '.com' : '.cn')) {
    throw new Error('candidate region and API origin do not match');
  }
  return {
    gitCommit, apiOrigin, region: item.region, version,
    releaseEvidenceSha256: digest(item.releaseEvidenceSha256),
    releaseSignatureSha256: digest(item.releaseSignatureSha256),
  };
}

export function parseVpsVerificationEvidence(value) {
  const item = object(value, [
    'schemaVersion', 'kind', 'scope', 'status', 'startedAt', 'completedAt',
    'failures', 'warnings', 'candidate',
  ], 'VPS verification evidence');
  if (item.schemaVersion !== 1 || item.kind !== 'SS_ERP_VPS_VERIFICATION'
    || item.scope !== 'FULL' || item.status !== 'PASS' || item.failures !== 0
    || !Number.isSafeInteger(item.warnings) || Number(item.warnings) < 0) {
    throw new Error('VPS verification evidence must prove a complete successful run');
  }
  const startedAt = timestamp(item.startedAt);
  const completedAt = timestamp(item.completedAt);
  if (Date.parse(startedAt) > Date.parse(completedAt)) {
    throw new Error('release evidence timestamps are out of order');
  }
  return {
    schemaVersion: 1, kind: 'SS_ERP_VPS_VERIFICATION', scope: 'FULL', status: 'PASS',
    startedAt, completedAt, failures: 0, warnings: Number(item.warnings),
    candidate: parseRel04CandidateIdentity(item.candidate),
  };
}

export function validateRel04ReleaseBinding(value, expected, observedAt, releaseSignedAt) {
  const item = object(value, [
    'candidate', 'vpsVerificationSha256', 'vpsStartedAt', 'vpsVerifiedAt',
  ], 'REL-04 release binding');
  const candidate = parseRel04CandidateIdentity(item.candidate);
  for (const key of Object.keys(candidate)) {
    if (expected[key] !== undefined && candidate[key] !== expected[key]) {
      throw new Error(`REL-04 candidate ${key} does not match`);
    }
  }
  const vpsVerifiedAt = timestamp(item.vpsVerifiedAt);
  const vpsStartedAt = timestamp(item.vpsStartedAt);
  if (Date.parse(vpsStartedAt) > Date.parse(vpsVerifiedAt)) {
    throw new Error('REL-04 VPS verification timestamps are out of order');
  }
  if (releaseSignedAt !== undefined && Date.parse(vpsStartedAt) < Date.parse(timestamp(releaseSignedAt))) {
    throw new Error('REL-04 VPS verification started before the release signature');
  }
  const age = Date.parse(timestamp(observedAt)) - Date.parse(vpsVerifiedAt);
  if (age < 0 || age > REL04_VPS_EVIDENCE_MAX_AGE_MS) {
    throw new Error('REL-04 VPS verification evidence is stale or in the future');
  }
  return {
    candidate,
    vpsVerificationSha256: digest(item.vpsVerificationSha256),
    vpsStartedAt,
    vpsVerifiedAt,
  };
}
