import { existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const DONOR_WORKBENCH_FEATURE_KEY = 'ss-erp:donor-workbench-preview-enabled';
export const DONOR_WORKBENCH_ALLOWLIST_KEY = 'ss-erp:donor-workbench-preview-allowlist:v1';
export const DONOR_WORKBENCH_LIVE_CANARY_KIND = 'SS_ERP_DONOR_WORKBENCH_LIVE_CANARY';

const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const EXTENSION_ID = /^[a-p]{32}$/u;

function fail(message) {
  throw new Error(message);
}

function exactObject(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    fail(`${field} fields are invalid`);
  }
  return value;
}

function canonicalProductUrl(value, field) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail(`${field} product URL is invalid`);
  }
  const match = url.pathname.match(/^\/offer\/([1-9][0-9]{0,31})\.html$/u);
  if (url.protocol !== 'https:' || url.hostname !== 'detail.1688.com'
    || url.username || url.password || url.port || url.search || url.hash || !match) {
    fail(`${field} product URL must be one canonical 1688 offer URL`);
  }
  return {
    url: url.href,
    productId: match[1],
    sourceKey: `1688:${match[1]}`,
  };
}

function oneRealDirectory(value, field) {
  if (!path.isAbsolute(value || '')) fail(`${field} must be absolute`);
  let resolved;
  try {
    const entry = lstatSync(value);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`${field} must be one real directory`);
    resolved = realpathSync.native(value);
  } catch (error) {
    if (error instanceof Error && error.message.includes(field)) throw error;
    fail(`${field} must be one real directory`);
  }
  return resolved;
}

function oneRealFile(value, field) {
  if (!path.isAbsolute(value || '')) fail(`${field} must be absolute`);
  let resolved;
  try {
    const entry = lstatSync(value);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) {
      fail(`${field} must be one real file`);
    }
    resolved = realpathSync.native(value);
  } catch (error) {
    if (error instanceof Error && error.message.includes(field)) throw error;
    fail(`${field} must be one real file`);
  }
  return resolved;
}

function outputPath(value, repoRoot) {
  if (!path.isAbsolute(value || '')) fail('output must be absolute');
  const output = path.resolve(value);
  const parent = oneRealDirectory(path.dirname(output), 'output parent');
  if (parent !== path.dirname(output)) fail('output parent must be canonical');
  const relative = path.relative(repoRoot, output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    fail('output must remain outside the repository');
  }
  if (existsSync(output)) fail('output must not already exist');
  if (path.extname(output) !== '.json') fail('output must be a JSON file');
  return output;
}

function loopbackCdpOrigin(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail('cookie source CDP must be one loopback HTTP origin');
  }
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !Number.isSafeInteger(port) || port < 1024 || port > 65535
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    fail('cookie source CDP must be one loopback HTTP origin');
  }
  return url.origin;
}

export function parseDonorWorkbenchLiveCanaryOptions(args, { repoRoot = process.cwd() } = {}) {
  const required = new Set([
    '--extension-dir',
    '--release-build-root',
    '--release-signature',
    '--expected-release-signature-sha256',
    '--expected-version',
    '--expected-git-commit',
    '--expected-tree-sha256',
    '--expected-title-sha256',
    '--expected-negative-title-sha256',
    '--product-url',
    '--negative-product-url',
    '--output',
    '--cookie-source-cdp',
  ]);
  if (!Array.isArray(args) || args.length !== required.size * 2) {
    fail('every live canary option is required exactly once');
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!required.has(name) || values.has(name) || typeof value !== 'string'
      || !value || value.startsWith('--')) {
      fail('every live canary option is required exactly once');
    }
    values.set(name, value);
  }
  const version = values.get('--expected-version');
  const gitCommit = values.get('--expected-git-commit').toLowerCase();
  const extensionTreeSha256 = values.get('--expected-tree-sha256').toLowerCase();
  const releaseSignatureSha256 = values.get('--expected-release-signature-sha256').toLowerCase();
  const expectedTitleSha256 = values.get('--expected-title-sha256').toLowerCase();
  const expectedNegativeTitleSha256 = values.get('--expected-negative-title-sha256').toLowerCase();
  if (!VERSION.test(version)) fail('expected version is invalid');
  if (!COMMIT.test(gitCommit)) fail('expected Git commit is invalid');
  if (!SHA256.test(extensionTreeSha256)) fail('expected extension tree SHA-256 is invalid');
  if (!SHA256.test(releaseSignatureSha256)) {
    fail('expected release signature SHA-256 is invalid');
  }
  if (!SHA256.test(expectedTitleSha256)) fail('expected title SHA-256 is invalid');
  if (!SHA256.test(expectedNegativeTitleSha256)) {
    fail('expected negative title SHA-256 is invalid');
  }
  const product = canonicalProductUrl(values.get('--product-url'), 'positive');
  const negativeProduct = canonicalProductUrl(
    values.get('--negative-product-url'),
    'negative',
  );
  if (product.sourceKey === negativeProduct.sourceKey) {
    fail('negative product URL must use another 1688 offer ID');
  }
  return {
    extensionDir: oneRealDirectory(values.get('--extension-dir'), 'extension directory'),
    releaseBuildRoot: oneRealDirectory(
      values.get('--release-build-root'),
      'release build root',
    ),
    releaseSignature: oneRealFile(values.get('--release-signature'), 'release signature'),
    releaseSignatureSha256,
    version,
    gitCommit,
    extensionTreeSha256,
    expectedTitleSha256,
    expectedNegativeTitleSha256,
    product,
    negativeProduct,
    cookieSourceCdp: loopbackCdpOrigin(values.get('--cookie-source-cdp')),
    output: outputPath(values.get('--output'), path.resolve(repoRoot)),
  };
}

function text(value, field, maximum = 2048) {
  if (typeof value !== 'string' || !value || value.length > maximum
    || [...value].some((character) => character.charCodeAt(0) < 32)) {
    fail(`${field} is invalid`);
  }
  return value;
}

function zero(value, field) {
  if (value !== 0) fail(`${field} must be zero`);
  return value;
}

function boundedCookieText(value, field, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.length > maximum
    || [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })) {
    fail(`authorized 1688 cookie ${field} is invalid`);
  }
  return value;
}

export function selectAuthorized1688Cookies(value, nowSeconds = Date.now() / 1000) {
  if (!Array.isArray(value) || value.length > 4096 || !Number.isFinite(nowSeconds)) {
    fail('authorized 1688 cookie source is invalid');
  }
  const cookies = [];
  let totalBytes = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const domain = String(candidate.domain || '').toLowerCase();
    if (!/^\.?(?:[a-z0-9-]+\.)*1688\.com$/u.test(domain)) continue;
    if (candidate.partitionKey || candidate.partitionKeyOpaque === true) continue;
    const expires = Number(candidate.expires);
    if (Number.isFinite(expires) && expires > 0 && expires <= nowSeconds) continue;
    const cookie = {
      name: boundedCookieText(candidate.name, 'name', 256),
      value: boundedCookieText(candidate.value, 'value', 8192, true),
      domain: boundedCookieText(domain, 'domain', 253),
      path: boundedCookieText(candidate.path || '/', 'path', 1024),
      httpOnly: candidate.httpOnly === true,
      secure: candidate.secure === true,
    };
    if (!cookie.path.startsWith('/')) fail('authorized 1688 cookie path is invalid');
    if (Number.isFinite(expires) && expires > nowSeconds) cookie.expires = expires;
    if (['Strict', 'Lax', 'None'].includes(candidate.sameSite)) cookie.sameSite = candidate.sameSite;
    if (['Low', 'Medium', 'High'].includes(candidate.priority)) cookie.priority = candidate.priority;
    if (typeof candidate.sameParty === 'boolean') cookie.sameParty = candidate.sameParty;
    if (['Unset', 'NonSecure', 'Secure'].includes(candidate.sourceScheme)) {
      cookie.sourceScheme = candidate.sourceScheme;
    }
    if (candidate.sourcePort !== undefined) {
      if (!Number.isSafeInteger(candidate.sourcePort)
        || (candidate.sourcePort !== -1
          && (candidate.sourcePort < 1 || candidate.sourcePort > 65535))) {
        fail('authorized 1688 cookie sourcePort is invalid');
      }
      cookie.sourcePort = candidate.sourcePort;
    }
    totalBytes += Buffer.byteLength(cookie.name) + Buffer.byteLength(cookie.value)
      + Buffer.byteLength(cookie.domain) + Buffer.byteLength(cookie.path);
    if (cookies.length >= 128 || totalBytes > 256 * 1024) {
      fail('authorized 1688 cookies exceed the import limit');
    }
    cookies.push(cookie);
  }
  if (!cookies.length) fail('no active 1688 cookies were available');
  return {
    cookies,
    summary: {
      scope: '1688-only',
      count: cookies.length,
      domains: [...new Set(cookies.map((cookie) => cookie.domain))].sort(),
    },
  };
}

function initiatorUrls(event) {
  const frames = [];
  let stack = event?.initiator?.stack;
  while (stack && typeof stack === 'object') {
    frames.push(...(Array.isArray(stack.callFrames) ? stack.callFrames : []));
    stack = stack.parent;
  }
  return [event?.documentURL, event?.initiator?.url, ...frames.map((frame) => frame.url)]
    .filter((value) => typeof value === 'string' && value);
}

export function recordDonorWorkbenchExtensionMutation(network, event, {
  extensionId,
  extensionSessions,
  sessionId,
}) {
  if (!EXTENSION_ID.test(extensionId)
    || !(extensionSessions instanceof Set)
    || !network || typeof network !== 'object') {
    fail('extension mutation observer context is invalid');
  }
  const request = event?.request;
  const method = String(request?.method || '').toUpperCase();
  if (!request?.url || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  const prefix = `chrome-extension://${extensionId}/`;
  if (!extensionSessions.has(sessionId)
    && !initiatorUrls(event).some((url) => url.startsWith(prefix))) return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    network.unexpectedExtensionMutations.push({ method, url: String(request.url).slice(0, 2048) });
    return true;
  }
  if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return false;
  const hostname = url.hostname.toLowerCase();
  network.unexpectedExtensionMutations.push({
    method,
    origin: url.origin,
    pathname: url.pathname.slice(0, 1024),
  });
  if (hostname === 'ss-erp.com' || hostname.endsWith('.ss-erp.com')
    || hostname === 'ss-erp.cn' || hostname.endsWith('.ss-erp.cn')) {
    network.erpMutations += 1;
  } else if (hostname === 'ozon.ru' || hostname.endsWith('.ozon.ru')
    || hostname === 'ozon.kz' || hostname.endsWith('.ozon.kz')
    || hostname === 'ozon.by' || hostname.endsWith('.ozon.by')) {
    network.ozonRequests += 1;
  } else {
    network.providerRequests += 1;
  }
  return true;
}

export function buildDonorWorkbenchLiveCanaryReceipt(value) {
  exactObject(value, [
    'observedAt', 'gitCommit', 'version', 'extensionTreeSha256', 'extensionId', 'browser',
    'worktreeClean', 'releaseBinding', 'cookieImport', 'product', 'negativeProduct', 'cutover',
    'network', 'pageErrors', 'screenshotSha256',
  ], 'live canary');
  if (new Date(value.observedAt).toISOString() !== value.observedAt) fail('observedAt is invalid');
  if (!COMMIT.test(value.gitCommit)) fail('gitCommit is invalid');
  if (!VERSION.test(value.version)) fail('version is invalid');
  if (!SHA256.test(value.extensionTreeSha256)) fail('extensionTreeSha256 is invalid');
  if (!EXTENSION_ID.test(value.extensionId)) fail('extensionId is invalid');
  if (value.worktreeClean !== true) fail('worktreeClean must be true');
  exactObject(value.releaseBinding, [
    'releaseEvidenceSha256', 'releaseSignatureSha256', 'cloudZipSha256', 'keyId', 'signedAt',
  ], 'releaseBinding');
  if (!SHA256.test(value.releaseBinding.releaseEvidenceSha256)
    || !SHA256.test(value.releaseBinding.releaseSignatureSha256)
    || !SHA256.test(value.releaseBinding.cloudZipSha256)) {
    fail('releaseBinding digest is invalid');
  }
  text(value.releaseBinding.keyId, 'releaseBinding keyId', 256);
  if (new Date(value.releaseBinding.signedAt).toISOString() !== value.releaseBinding.signedAt) {
    fail('releaseBinding signedAt is invalid');
  }
  exactObject(value.cookieImport, ['scope', 'count', 'domains'], 'cookieImport');
  if (value.cookieImport.scope !== '1688-only'
    || !Number.isSafeInteger(value.cookieImport.count) || value.cookieImport.count < 1
    || value.cookieImport.count > 128
    || !Array.isArray(value.cookieImport.domains) || !value.cookieImport.domains.length
    || value.cookieImport.domains.some((domain) => {
      const normalized = String(domain || '').replace(/^\./u, '');
      return normalized !== '1688.com' && !normalized.endsWith('.1688.com');
    })
    || JSON.stringify([...new Set(value.cookieImport.domains)].sort())
      !== JSON.stringify(value.cookieImport.domains)) {
    fail('cookieImport is invalid');
  }
  text(value.browser, 'browser');
  exactObject(value.product, [
    'url', 'sourceKey', 'finalUrl', 'title', 'titleSha256',
    'renderedPageMediaCount', 'toolbarActionCount', 'sourceWorkbenchVisible',
  ], 'product');
  exactObject(value.negativeProduct, [
    'url', 'sourceKey', 'pageTitle', 'pageTitleSha256', 'blocked',
  ], 'negativeProduct');
  const product = canonicalProductUrl(value.product.url, 'positive');
  const negativeProduct = canonicalProductUrl(value.negativeProduct.url, 'negative');
  if (value.product.sourceKey !== product.sourceKey
    || value.negativeProduct.sourceKey !== negativeProduct.sourceKey
    || value.product.finalUrl !== value.product.url || value.negativeProduct.blocked !== true) {
    fail('product evidence is invalid');
  }
  text(value.product.title, 'product title');
  text(value.negativeProduct.pageTitle, 'negative product pageTitle');
  if (!SHA256.test(value.negativeProduct.pageTitleSha256)) {
    fail('negative product pageTitleSha256 is invalid');
  }
  if (!SHA256.test(value.product.titleSha256)) fail('product titleSha256 is invalid');
  if (!Number.isSafeInteger(value.product.renderedPageMediaCount)
    || value.product.renderedPageMediaCount < 1) {
    fail('product renderedPageMediaCount is invalid');
  }
  if (!Number.isSafeInteger(value.product.toolbarActionCount)
    || value.product.toolbarActionCount < 8 || value.product.toolbarActionCount > 32) {
    fail('product toolbarActionCount is invalid');
  }
  if (value.product.sourceWorkbenchVisible !== true) {
    fail('product sourceWorkbenchVisible must be true');
  }
  exactObject(value.cutover, [
    'flagOnlyBlocked', 'allowlistedMounted', 'unifiedMediaOpened', 'iframeSuppressed',
    'calculatorMediaSeparated', 'unifiedMediaClosed', 'rollbackUnmounted', 'legacyBefore',
    'legacyAfterRollback', 'storageCleared',
  ], 'cutover');
  for (const [field, result] of Object.entries(value.cutover)) {
    if (result !== true) fail(`${field} must be true`);
  }
  exactObject(value.network, [
    'providerRequests', 'ozonRequests', 'erpMutations', 'unexpectedExtensionMutations',
  ], 'network');
  zero(value.network.providerRequests, 'providerRequests');
  zero(value.network.ozonRequests, 'ozonRequests');
  zero(value.network.erpMutations, 'erpMutations');
  if (!Array.isArray(value.network.unexpectedExtensionMutations)
    || value.network.unexpectedExtensionMutations.length !== 0) {
    fail('unexpectedExtensionMutations must be empty');
  }
  if (!Array.isArray(value.pageErrors) || value.pageErrors.length !== 0) {
    fail('pageErrors must be empty');
  }
  if (!SHA256.test(value.screenshotSha256)) fail('screenshotSha256 is invalid');
  return {
    schemaVersion: 2,
    kind: DONOR_WORKBENCH_LIVE_CANARY_KIND,
    status: 'PASS',
    ...value,
  };
}
