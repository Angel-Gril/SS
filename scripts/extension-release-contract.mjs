const EXPECTED_ORIGIN_KEYS = Object.freeze(['admin', 'api', 'local', 'web']);
const RELEASE_EVIDENCE_KEYS = Object.freeze([
  'artifacts',
  'checksumFilename',
  'expectedOrigins',
  'gitCommit',
  'provenance',
  'schemaVersion',
  'signature',
  'version',
]);
const ARTIFACT_KEYS = Object.freeze(['fileCount', 'filename', 'target', 'zipSha256']);
const PROVENANCE_KEYS = Object.freeze([
  'commitSource',
  'packageInputsSha256',
  'sourceMode',
]);
const PUBLIC_HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
export const EXTENSION_RELEASE_LOCAL_ORIGIN = 'http://127.0.0.1:3001';
// Retain archived source for comparison, while installable packages expose only
// the precision workbench. Shared execution contracts and calculator stay intact.
export const EXTENSION_RETIRED_WORKBENCH_UI_FILES = Object.freeze([
  'pages/source-workbench-shell.html',
  'pages/source-workbench-shell.css',
  'pages/source-workbench-shell.js',
  'content/source-listing-workbench.js',
  'content/source-listing-workbench.css',
]);
export const EXTENSION_DONOR_WORKBENCH_WEB_RESOURCE_MATCHES = Object.freeze([
  'https://detail.1688.com/*',
  'https://*.pinduoduo.com/*',
  'https://*.yangkeduo.com/*',
  'https://item.taobao.com/*',
  'https://detail.tmall.com/*',
]);
export const EXTENSION_MARKETPLACE_WEB_RESOURCE_MATCHES = Object.freeze([
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
  'https://s.1688.com/*',
  'https://*.1688.com/*',
  'https://detail.1688.com/*',
  'https://trade.1688.com/*',
  'https://pifa.pinduoduo.com/*',
  'https://mobile.pinduoduo.com/*',
  'https://*.pinduoduo.com/*',
  'https://*.yangkeduo.com/*',
  'https://www.temu.com/*',
  'https://*.aliexpress.com/*',
  'https://www.wildberries.ru/*',
  'https://item.jd.com/*',
  'https://www.taobao.com/*',
  'https://s.taobao.com/*',
  'https://item.taobao.com/*',
  'https://detail.tmall.com/*',
  'https://www.goofish.com/*',
  'https://goofish.com/*',
  'https://2.taobao.com/*',
]);

function fail(message) {
  throw new Error(message);
}

function exactObject(value, expectedKeys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} must contain exactly: ${expected.join(', ')}`);
  }
  return value;
}

function isPrivateIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = -1, second = -1] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
    || first >= 224;
}

export function canonicalPublicHttpsOrigin(value, field = 'origin') {
  const raw = typeof value === 'string' ? value : '';
  if (!raw || raw !== raw.trim() || raw.length > 2048 || raw.includes('\\')) {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const publicHostname = hostname
    && !hostname.endsWith('.')
    && hostname !== 'localhost'
    && !hostname.endsWith('.localhost')
    && hostname !== 'metadata'
    && hostname !== 'metadata.google.internal'
    && !hostname.endsWith('.metadata.google.internal')
    && hostname !== 'instance-data'
    && !hostname.endsWith('.instance-data')
    && !hostname.endsWith('.internal')
    && !hostname.endsWith('.local')
    && !hostname.endsWith('.home.arpa')
    && !hostname.includes(':')
    && hostname.includes('.')
    && !isPrivateIpv4(hostname)
    && PUBLIC_HOSTNAME_PATTERN.test(hostname);
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.origin === 'null'
    || !publicHostname
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.origin !== raw) {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  return parsed.origin;
}

export function parseExpectedReleaseOrigins(value, field = 'expected origins') {
  const parsed = exactObject(value, EXPECTED_ORIGIN_KEYS, field);
  if (parsed.local !== EXTENSION_RELEASE_LOCAL_ORIGIN) {
    fail(`${field}.local must be exactly ${EXTENSION_RELEASE_LOCAL_ORIGIN}`);
  }
  return {
    web: canonicalPublicHttpsOrigin(parsed.web, `${field}.web`),
    admin: canonicalPublicHttpsOrigin(parsed.admin, `${field}.admin`),
    api: canonicalPublicHttpsOrigin(parsed.api, `${field}.api`),
    local: EXTENSION_RELEASE_LOCAL_ORIGIN,
  };
}

export function readExpectedReleaseOrigins(environment) {
  return parseExpectedReleaseOrigins({
    web: environment.EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN,
    admin: environment.EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN,
    api: environment.EXTENSION_RELEASE_EXPECTED_API_ORIGIN,
    local: environment.EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN || EXTENSION_RELEASE_LOCAL_ORIGIN,
  }, 'formal release expected origins');
}

function parseCanonicalJsonStringLiteral(line, key) {
  const prefix = `    ${key}: `;
  if (!line.startsWith(prefix) || !line.endsWith(',')) {
    fail(`deployment-defaults.js ${key} field is malformed`);
  }
  const literal = line.slice(prefix.length, -1);
  let value;
  try {
    value = JSON.parse(literal);
  } catch {
    fail(`deployment-defaults.js ${key} must use a JSON string literal`);
  }
  if (typeof value !== 'string' || JSON.stringify(value) !== literal) {
    fail(`deployment-defaults.js ${key} must use a canonical JSON string literal`);
  }
  return value;
}

export function parseExtensionDeploymentDefaults(source) {
  if (typeof source !== 'string' || source.charCodeAt(0) === 0xfeff || source.includes('\r')) {
    fail('deployment-defaults.js must be canonical UTF-8 text with LF line endings');
  }
  const lines = source.split('\n');
  if (lines.length !== 9
    || lines[0] !== '(function (root) {'
    || lines[1] !== '  root.SS_ERP_DEPLOYMENT_DEFAULTS = Object.freeze({'
    || lines[6] !== '  });'
    || lines[7] !== "})(typeof globalThis !== 'undefined' ? globalThis : self);"
    || lines[8] !== '') {
    fail('deployment-defaults.js wrapper or field set is invalid');
  }
  const parsed = {
    target: parseCanonicalJsonStringLiteral(lines[2], 'target'),
    web: parseCanonicalJsonStringLiteral(lines[3], 'erpBaseUrl'),
    admin: parseCanonicalJsonStringLiteral(lines[4], 'erpAdminBaseUrl'),
    api: parseCanonicalJsonStringLiteral(lines[5], 'erpApiBaseUrl'),
  };
  if (!['cloud', 'local'].includes(parsed.target)) {
    fail('deployment-defaults.js target must be cloud or local');
  }
  return parsed;
}

export function canonicalExtensionVersion(value, field = 'version') {
  const match = String(value || '').match(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u,
  );
  if (!match || !match.slice(1).map(Number).every(Number.isSafeInteger)) {
    fail(`${field} must be a canonical major.minor.patch version`);
  }
  return match[0];
}

function fullGitCommit(value, field) {
  const commit = typeof value === 'string' ? value.toLowerCase() : '';
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    fail(`${field} must be a full 40-character Git object ID`);
  }
  return commit;
}

function packageInputsSha256(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    fail(`${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export function resolveExtensionReleaseProvenance(input) {
  const sourceMode = input?.sourceMode;
  if (!['REPOSITORY_SOURCE', 'EXTERNAL_SOURCE'].includes(sourceMode)) {
    fail('release provenance sourceMode is invalid');
  }
  const hasDeployedCommit = input.deployedCommit !== undefined;
  const gitCommit = hasDeployedCommit
    ? fullGitCommit(input.deployedCommit, 'DEPLOYED_COMMIT')
    : fullGitCommit(input.gitCommit, 'Git HEAD');
  const commitSource = hasDeployedCommit ? 'DEPLOYED_COMMIT' : 'GIT_HEAD';
  if (hasDeployedCommit
    && input.activeGitCommit !== undefined
    && gitCommit !== fullGitCommit(input.activeGitCommit, 'active Git HEAD')) {
    fail('DEPLOYED_COMMIT does not match active Git HEAD');
  }
  const requireCleanGit = input.requireCleanGit === true || commitSource === 'GIT_HEAD';
  if (requireCleanGit
    && sourceMode === 'REPOSITORY_SOURCE'
    && String(input.gitStatus || '') !== '') {
    fail('tracked or untracked extension release inputs differ from Git HEAD');
  }
  return {
    gitCommit,
    provenance: {
      commitSource,
      sourceMode,
      packageInputsSha256: packageInputsSha256(
        input.packageInputsSha256,
        'release provenance packageInputsSha256',
      ),
    },
  };
}

function parseProvenance(value) {
  const parsed = exactObject(value, PROVENANCE_KEYS, 'release evidence provenance');
  if (!['DEPLOYED_COMMIT', 'GIT_HEAD'].includes(parsed.commitSource)) {
    fail('release evidence provenance commitSource is invalid');
  }
  if (!['REPOSITORY_SOURCE', 'EXTERNAL_SOURCE'].includes(parsed.sourceMode)) {
    fail('release evidence provenance sourceMode is invalid');
  }
  return {
    commitSource: parsed.commitSource,
    sourceMode: parsed.sourceMode,
    packageInputsSha256: packageInputsSha256(
      parsed.packageInputsSha256,
      'release evidence provenance packageInputsSha256',
    ),
  };
}

function parseArtifact(value, target, version) {
  const parsed = exactObject(value, ARTIFACT_KEYS, `release evidence artifacts.${target}`);
  if (parsed.target !== target) fail(`release evidence ${target} target is invalid`);
  const expectedFilename = `ss-erp-${target}-${version}.zip`;
  if (parsed.filename !== expectedFilename) {
    fail(`release evidence ${target} filename must be ${expectedFilename}`);
  }
  if (typeof parsed.zipSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.zipSha256)) {
    fail(`release evidence ${target} zipSha256 is invalid`);
  }
  if (!Number.isSafeInteger(parsed.fileCount)
    || parsed.fileCount < 1
    || parsed.fileCount > 10_000) {
    fail(`release evidence ${target} fileCount is invalid`);
  }
  return {
    target,
    filename: parsed.filename,
    zipSha256: parsed.zipSha256,
    fileCount: parsed.fileCount,
  };
}

export function parseExtensionReleaseEvidence(value) {
  const parsed = exactObject(value, RELEASE_EVIDENCE_KEYS, 'release evidence');
  if (parsed.schemaVersion !== 1) fail('release evidence schemaVersion must be 1');
  const gitCommit = fullGitCommit(parsed.gitCommit, 'release evidence gitCommit');
  const version = canonicalExtensionVersion(parsed.version, 'release evidence version');
  const expectedOrigins = parseExpectedReleaseOrigins(
    parsed.expectedOrigins,
    'release evidence expectedOrigins',
  );
  const artifacts = exactObject(parsed.artifacts, ['cloud', 'local'], 'release evidence artifacts');
  const checksumFilename = `ss-erp-extension-${version}.sha256`;
  if (parsed.checksumFilename !== checksumFilename) {
    fail(`release evidence checksumFilename must be ${checksumFilename}`);
  }
  const signature = exactObject(parsed.signature, ['status'], 'release evidence signature');
  if (signature.status !== 'EXTERNAL_REQUIRED') {
    fail('release evidence signature status must remain EXTERNAL_REQUIRED');
  }
  return {
    schemaVersion: 1,
    gitCommit,
    provenance: parseProvenance(parsed.provenance),
    version,
    expectedOrigins,
    artifacts: {
      cloud: parseArtifact(artifacts.cloud, 'cloud', version),
      local: parseArtifact(artifacts.local, 'local', version),
    },
    checksumFilename,
    signature: { status: 'EXTERNAL_REQUIRED' },
  };
}

export function canonicalExtensionReleaseEvidenceJson(value) {
  return `${JSON.stringify(parseExtensionReleaseEvidence(value), null, 2)}\n`;
}
