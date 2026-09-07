import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';

const OZON_BASE_URL = 'https://api-seller.ozon.ru';
const IMPORT_PATH = '/v3/product/import';
const IMPORT_INFO_PATH = '/v1/product/import/info';
const PRODUCT_INFO_PATH = '/v3/product/info/list';
const SELLER_INFO_PATH = '/v1/seller/info';
const ARCHIVE_PATH = '/v1/product/archive';
const RESERVED_OFFER_PREFIX = 'ss-erp-sbx-';
const CONFIRMATION_PHRASE = 'CREATE_AND_ARCHIVE_RESERVED_TEST_LISTING';
const READONLY_CONFIRMATION_PHRASE = 'READ_ONLY_SELLER_INFO_AND_OFFER_CHECK';
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_PREFLIGHT_BYTES = 64 * 1024;
const MAX_APPROVAL_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PREFLIGHT_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_OFFER_ID_LENGTH = 50;
const MAX_AUDIT_POLLS = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60_000;
const MAX_POLL_TIMEOUT_MS = 30 * 60_000;
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|client[_-]?id|cookie|password|secret|token)/iu;
const SAFE_IDENTITY_HASH_KEY = /^(?:clientIdSha256|credentialRevisionSha256|revisionSha256)$/u;

class ContractError extends Error {
  constructor(message, exitCode = 64) {
    super(message);
    this.name = 'ContractError';
    this.exitCode = exitCode;
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/sandbox/ozon-source-listing-contract.mjs --execute --payload <compiled.json> [options]',
    '  node scripts/sandbox/ozon-source-listing-contract.mjs --preflight --offer-id <reserved-offer-id> [options]',
    '  node scripts/sandbox/ozon-source-listing-contract.mjs --reconcile --audit <existing-audit.json> [options]',
    '',
    'Required environment:',
    `  OZON_SANDBOX_CONFIRM=${CONFIRMATION_PHRASE}`,
    `  OZON_SANDBOX_READONLY_CONFIRM=${READONLY_CONFIRMATION_PHRASE}`,
    '  OZON_SANDBOX_TEST_SHOP=true',
    '  OZON_SANDBOX_TEST_CLIENT_ID=<dedicated test shop client ID>',
    '  OZON_SANDBOX_TEST_API_KEY=<dedicated test shop API key>',
    '  OZON_SANDBOX_TEST_SHOP_ALIAS=<exact ERP test-shop alias>',
    '  OZON_SANDBOX_EXPECTED_SELLER_NAME=<exact Ozon Seller Info company name>',
    '',
    'Options:',
    '  --offer-id <id>             Reserved offer ID for --preflight',
    '  --preflight-receipt <path>  Exact v2 read-only receipt required by --execute',
    '  --preflight-sha256 <digest> Approved receipt SHA-256 required by --execute',
    '  --approval-manifest <path> Independent write approval bound to payload and preflight',
    '  --approval-sha256 <digest> Approved write approval SHA-256 required by --execute',
    '  --audit <path>              Audit JSON path (default: tmp/sandbox-audits/<run>.json)',
    '  --poll-interval-ms <ms>     1000..60000 (default: 5000)',
    '  --poll-timeout-ms <ms>      10000..1800000 (default: 300000)',
    '  --help                      Show this message without making network requests',
  ].join('\n');
}

function parseInteger(value, label, minimum, maximum) {
  if (!/^[0-9]+$/u.test(String(value || ''))) {
    throw new ContractError(`${label} must be an integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ContractError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = {
    execute: false,
    preflight: false,
    reconcile: false,
    help: false,
    payloadPath: null,
    preflightReceiptPath: null,
    preflightSha256: null,
    approvalManifestPath: null,
    approvalSha256: null,
    auditPath: null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute' || argument === '--preflight' || argument === '--reconcile' || argument === '--help') {
      if (seen.has(argument)) throw new ContractError(`Duplicate argument: ${argument}`);
      seen.add(argument);
      if (argument === '--execute') options.execute = true;
      if (argument === '--preflight') options.preflight = true;
      if (argument === '--reconcile') options.reconcile = true;
      if (argument === '--help') options.help = true;
      continue;
    }
    if (![
      '--payload', '--offer-id', '--preflight-receipt', '--preflight-sha256', '--approval-manifest', '--approval-sha256', '--audit',
      '--poll-interval-ms', '--poll-timeout-ms',
    ].includes(argument)) {
      throw new ContractError(`Unknown argument: ${argument}`);
    }
    if (seen.has(argument)) throw new ContractError(`Duplicate argument: ${argument}`);
    seen.add(argument);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new ContractError(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--payload') options.payloadPath = resolve(value);
    if (argument === '--offer-id') options.offerId = value;
    if (argument === '--preflight-receipt') options.preflightReceiptPath = resolve(value);
    if (argument === '--preflight-sha256') options.preflightSha256 = value.toLowerCase();
    if (argument === '--approval-manifest') options.approvalManifestPath = resolve(value);
    if (argument === '--approval-sha256') options.approvalSha256 = value.toLowerCase();
    if (argument === '--audit') options.auditPath = resolve(value);
    if (argument === '--poll-interval-ms') {
      options.pollIntervalMs = parseInteger(value, argument, 1_000, 60_000);
    }
    if (argument === '--poll-timeout-ms') {
      options.pollTimeoutMs = parseInteger(value, argument, 10_000, MAX_POLL_TIMEOUT_MS);
    }
  }
  return options;
}

function requireExecutionGates(options, environment) {
  if ([options.execute, options.preflight, options.reconcile].filter(Boolean).length !== 1) {
    throw new ContractError('Refusing to run without an explicit --execute flag, --preflight flag, or --reconcile flag.');
  }
  if (options.execute && environment.OZON_SANDBOX_CONFIRM !== CONFIRMATION_PHRASE) {
    throw new ContractError('Refusing to run without the exact OZON_SANDBOX_CONFIRM phrase.');
  }
  if (options.preflight && environment.OZON_SANDBOX_READONLY_CONFIRM !== READONLY_CONFIRMATION_PHRASE) {
    throw new ContractError('Refusing to run without the exact OZON_SANDBOX_READONLY_CONFIRM phrase.');
  }
  if (options.reconcile && environment.OZON_SANDBOX_READONLY_CONFIRM !== READONLY_CONFIRMATION_PHRASE) {
    throw new ContractError('Refusing to reconcile without the exact OZON_SANDBOX_READONLY_CONFIRM phrase.');
  }
  if (environment.OZON_SANDBOX_TEST_SHOP !== 'true') {
    throw new ContractError('Refusing to run unless OZON_SANDBOX_TEST_SHOP=true identifies dedicated test credentials.');
  }
  const clientId = String(environment.OZON_SANDBOX_TEST_CLIENT_ID || '').trim();
  const apiKey = String(environment.OZON_SANDBOX_TEST_API_KEY || '').trim();
  if (!clientId || !apiKey || clientId.length > 500 || apiKey.length > 500) {
    throw new ContractError('Dedicated OZON_SANDBOX_TEST_CLIENT_ID and OZON_SANDBOX_TEST_API_KEY are required.');
  }
  const shopAlias = exactBoundedText(environment.OZON_SANDBOX_TEST_SHOP_ALIAS, 100);
  const sellerName = exactBoundedText(environment.OZON_SANDBOX_EXPECTED_SELLER_NAME, 200);
  if (!shopAlias || !sellerName) {
    throw new ContractError('Exact OZON_SANDBOX_TEST_SHOP_ALIAS and OZON_SANDBOX_EXPECTED_SELLER_NAME are required.');
  }
  if (options.execute && !options.payloadPath) {
    throw new ContractError('--payload is required after all execution gates pass.');
  }
  if (options.execute && (!options.preflightReceiptPath || !/^[a-f0-9]{64}$/u.test(options.preflightSha256 || ''))) {
    throw new ContractError('--preflight-receipt and --preflight-sha256 are required for --execute.');
  }
  if (options.execute && !options.approvalManifestPath) {
    throw new ContractError('--approval-manifest and --approval-sha256 are required for --execute.');
  }
  if (options.execute && !/^[a-f0-9]{64}$/u.test(options.approvalSha256 || '')) {
    throw new ContractError('--approval-sha256 is required for --execute.');
  }
  if (options.reconcile && !options.auditPath) {
    throw new ContractError('--audit is required with --reconcile.');
  }
  if (options.reconcile && (options.payloadPath || options.preflightReceiptPath || options.preflightSha256 || options.offerId)) {
    throw new ContractError('--reconcile accepts only the existing --audit path.');
  }
  if (options.execute && options.offerId) {
    throw new ContractError('--offer-id is only valid with --preflight; execute derives it from the compiler envelope.');
  }
  if (options.preflight && options.payloadPath) {
    throw new ContractError('--payload is only valid with --execute; preflight is read-only.');
  }
  if (options.preflight && (options.preflightReceiptPath || options.preflightSha256)) {
    throw new ContractError('Preflight receipt arguments are only valid with --execute.');
  }
  if (!options.execute && (options.approvalManifestPath || options.approvalSha256)) {
    throw new ContractError('--approval-manifest and --approval-sha256 are only valid with --execute.');
  }
  if (options.preflight) {
    validateReservedOfferId(options.offerId, '--offer-id');
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`${label} must be an object`);
  }
  return value;
}

function exactBoundedText(value, maxLength) {
  const text = typeof value === 'string' ? value : '';
  const normalized = text.normalize('NFKC').trim();
  const unsafe = [...normalized].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || codePoint === 127;
  });
  return normalized === text && normalized && [...normalized].length <= maxLength && !unsafe
    ? normalized
    : '';
}

function validateReservedOfferId(value, label = 'offer_id') {
  const offerId = exactBoundedText(value, MAX_OFFER_ID_LENGTH);
  const suffix = offerId.startsWith(RESERVED_OFFER_PREFIX)
    ? offerId.slice(RESERVED_OFFER_PREFIX.length)
    : '';
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(suffix)) {
    throw new ContractError(`${label} must use the reserved ${RESERVED_OFFER_PREFIX} lowercase prefix.`);
  }
  return offerId;
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ContractError('Canonical JSON requires finite numbers');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') {
    throw new ContractError('Canonical JSON supports only JSON values');
  }
  return `{${Object.keys(value).sort().map((key) => {
    const child = value[key];
    if (child === undefined) throw new ContractError('Canonical JSON does not allow undefined');
    return `${JSON.stringify(key)}:${canonicalJson(child)}`;
  }).join(',')}}`;
}

function exactSha256(value, label) {
  const digest = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new ContractError(`${label} must be a SHA-256 digest`);
  return digest;
}

function scanForSensitiveKeys(value, path = '$', depth = 0) {
  if (depth > 32) throw new ContractError(`Payload nesting exceeds 32 levels at ${path}`);
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) scanForSensitiveKeys(item, `${path}[${index}]`, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      throw new ContractError(`Compiled payload contains a forbidden credential-like key at ${path}.${key}`);
    }
    scanForSensitiveKeys(item, `${path}.${key}`, depth + 1);
  }
}

function validateCompiledPayload(parsed, byteLength) {
  if (byteLength > MAX_PAYLOAD_BYTES) {
    throw new ContractError(`Compiled payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const envelope = record(parsed, 'Production compiler envelope');
  const expectedKeys = [
    'attributeSchemaHash', 'attributeSchemaSnapshot', 'catalogRevision', 'catalogSnapshot',
    'catalogSnapshotHash', 'catalogSnapshotId', 'draftStateHash', 'endpoint', 'offerTrace',
    'publisherContractVersion', 'requestPayload', 'requestPayloadHash',
  ];
  if (JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(expectedKeys)) {
    throw new ContractError('Sandbox execution requires the exact production compiler envelope.');
  }
  if (envelope.publisherContractVersion !== 'ozon-listing-production-compile-adapter/v1'
    || envelope.endpoint !== IMPORT_PATH) {
    throw new ContractError('Production compiler envelope version or endpoint is invalid.');
  }
  exactSha256(envelope.draftStateHash, 'draftStateHash');
  const catalogSnapshot = record(envelope.catalogSnapshot, 'catalogSnapshot');
  const attributeSchemaSnapshot = record(envelope.attributeSchemaSnapshot, 'attributeSchemaSnapshot');
  const catalogSnapshotId = exactBoundedText(envelope.catalogSnapshotId, 500);
  const catalogRevision = exactBoundedText(envelope.catalogRevision, 500);
  if (!catalogSnapshotId || !catalogRevision) {
    throw new ContractError('Production compiler catalog authority is invalid.');
  }
  if (sha256(canonicalJson(catalogSnapshot)) !== exactSha256(envelope.catalogSnapshotHash, 'catalogSnapshotHash')
    || sha256(canonicalJson(attributeSchemaSnapshot)) !== exactSha256(envelope.attributeSchemaHash, 'attributeSchemaHash')) {
    throw new ContractError('Production compiler authority snapshot hash does not match.');
  }
  const requestPayload = record(envelope.requestPayload, 'requestPayload');
  if (sha256(canonicalJson(requestPayload)) !== exactSha256(envelope.requestPayloadHash, 'requestPayloadHash')) {
    throw new ContractError('Production compiler request payload hash does not match.');
  }
  if (Object.keys(requestPayload).length !== 1 || !Array.isArray(requestPayload.items)
    || requestPayload.items.length !== 1) {
    throw new ContractError('Sandbox execution requires exactly one compiled Ozon item');
  }
  scanForSensitiveKeys(envelope);
  const item = record(requestPayload.items[0], 'Compiled payload item');
  const offerId = validateReservedOfferId(item.offer_id);
  for (const field of ['description_category_id', 'type_id']) {
    if (!Number.isSafeInteger(item[field]) || item[field] <= 0) {
      throw new ContractError(`Compiled payload item ${field} must be a positive integer`);
    }
  }
  if (!exactBoundedText(item.name, 500)) throw new ContractError('Compiled payload item name is invalid');
  if (item.description !== undefined && typeof item.description !== 'string') {
    throw new ContractError('Compiled payload item description is invalid');
  }
  if (typeof item.description === 'string' && [...item.description].length > 200_000) {
    throw new ContractError('Compiled payload item description exceeds the compiler limit');
  }
  for (const field of ['price', 'old_price']) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(String(item[field] || ''))
      || Number(item[field]) <= 0 || !Number.isFinite(Number(item[field]))) {
      throw new ContractError(`Compiled payload item ${field} is invalid`);
    }
  }
  if (Number(item.old_price) < Number(item.price)
    || !['CNY', 'RUB'].includes(item.currency_code)
    || !['0', '0.05', '0.07', '0.1', '0.2', '0.22'].includes(item.vat)
    || item.dimension_unit !== 'mm' || item.weight_unit !== 'g') {
    throw new ContractError('Compiled payload item pricing or unit contract is invalid');
  }
  for (const field of ['weight', 'depth', 'width', 'height']) {
    if (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || item[field] <= 0) {
      throw new ContractError(`Compiled payload item ${field} must be positive`);
    }
  }
  if (!Array.isArray(item.images) || item.images.length < 1 || item.images.length > 15
    || new Set(item.images).size !== item.images.length
    || item.images.some((value) => {
      try {
        if (typeof value !== 'string' || value.length > 4_096 || value !== value.trim()) return true;
        const url = new URL(value);
        return url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash;
      } catch {
        return true;
      }
    })) {
    throw new ContractError('Compiled payload item images require bounded HTTPS URLs');
  }
  if (!Array.isArray(item.attributes) || item.attributes.length < 1 || item.attributes.length > 100) {
    throw new ContractError('Compiled payload item attributes are incomplete');
  }
  for (const attribute of item.attributes) {
    if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)
      || !Number.isSafeInteger(attribute.id) || attribute.id <= 0
      || !Array.isArray(attribute.values) || attribute.values.length < 1
      || attribute.values.length > 100) {
      throw new ContractError('Compiled payload item attribute values are invalid');
    }
  }
  if (!Array.isArray(envelope.offerTrace) || envelope.offerTrace.length !== 1) {
    throw new ContractError('Production compiler offer trace must cover exactly one item');
  }
  const trace = record(envelope.offerTrace[0], 'offerTrace[0]');
  if (trace.ordinal !== 0 || trace.offerId !== offerId || !exactBoundedText(trace.skuKey, 500)
    || !['USER', 'DETERMINISTIC'].includes(trace.source)) {
    throw new ContractError('Production compiler offer trace does not match the request payload');
  }
  return {
    payload: requestPayload,
    offerIds: [offerId],
    envelope: {
      publisherContractVersion: envelope.publisherContractVersion,
      requestPayloadHash: envelope.requestPayloadHash,
      draftStateHash: envelope.draftStateHash,
      catalogSnapshotId,
      catalogRevision,
      catalogSnapshotHash: envelope.catalogSnapshotHash,
      attributeSchemaHash: envelope.attributeSchemaHash,
    },
  };
}

function redactedClone(value, state = { nodes: 0 }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 20_000) return '[TRUNCATED_NODE_BUDGET]';
  if (depth > 24) return '[TRUNCATED_DEPTH]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 4_000 ? `${value.slice(0, 4_000)}[TRUNCATED]` : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactedClone(item, state, depth + 1));
  if (!value || typeof value !== 'object') return String(value);
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 500)) {
    output[key] = SENSITIVE_KEY.test(key) && !SAFE_IDENTITY_HASH_KEY.test(key)
      ? '[REDACTED]'
      : redactedClone(item, state, depth + 1);
  }
  return output;
}

function boundedError(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  return message.normalize('NFKC').trim().slice(0, 2_000) || 'unknown error';
}

async function assertAuditPathAvailable(auditPath, payloadPath) {
  if (auditPath === payloadPath) throw new ContractError('Audit path must differ from the payload path');
  try {
    await access(auditPath, fsConstants.F_OK);
    throw new ContractError('Audit path already exists; choose a new path to preserve prior evidence');
  } catch (error) {
    if (error instanceof ContractError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
}

function redactCredentialValues(value, credentials) {
  const secrets = [credentials?.clientId, credentials?.apiKey]
    .map((secret) => String(secret || ''))
    .filter(Boolean);
  const redactText = (text) => secrets.reduce(
    (current, secret) => current.split(secret).join('[REDACTED_SECRET]'),
    String(text),
  );
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' && secrets.includes(String(value))) return '[REDACTED_SECRET]';
  if (Array.isArray(value)) return value.map((item) => redactCredentialValues(item, credentials));
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[redactText(key)] = redactCredentialValues(item, credentials);
  }
  return output;
}

async function writeAudit(auditPath, audit, credentials) {
  await mkdir(dirname(auditPath), { recursive: true });
  const safeAudit = redactedClone(audit);
  const credentialSafeAudit = redactCredentialValues(safeAudit, credentials);
  const serialized = JSON.stringify(credentialSafeAudit, null, 2);
  const bytes = `${serialized}\n`;
  const temporaryPath = `${auditPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporaryPath, auditPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  return sha256(bytes);
}

async function sleep(milliseconds) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function parseResponseText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return {
      parseError: true,
      byteLength: Buffer.byteLength(text, 'utf8'),
      bodyHash: sha256(text),
    };
  }
}

async function boundedResponseText(response) {
  const declaredText = response.headers.get('content-length');
  const declared = declaredText == null ? null : Number(declaredText);
  if (declared !== null && (!Number.isSafeInteger(declared) || declared < 0
    || declared > MAX_RESPONSE_BYTES)) {
    throw new Error('Ozon response exceeded the bounded response size');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Ozon response exceeded the bounded response size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function ozonRequest(credentials, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(`${OZON_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id': credentials.clientId,
        'Api-Key': credentials.apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'error',
    });
    const text = await boundedResponseText(response);
    return {
      ok: response.ok,
      status: response.status,
      body: parseResponseText(text),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function clientIdFingerprint(clientId) {
  return sha256(`SS_ERP_OZON_SANDBOX_CLIENT_ID\0${clientId}`);
}

function credentialFingerprint(credentials) {
  return sha256(
    `SS_ERP_OZON_SANDBOX_CREDENTIAL\0${credentials.clientId}\0${credentials.apiKey}`,
  );
}

async function readPreflightReceipt(options, credentials, environment, offerId) {
  const bytes = await readFile(options.preflightReceiptPath);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PREFLIGHT_BYTES) {
    throw new ContractError('Preflight receipt size is invalid');
  }
  if (sha256(bytes) !== options.preflightSha256) {
    throw new ContractError('Approved preflight receipt SHA-256 does not match the file.');
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ContractError('Preflight receipt is not valid JSON');
  }
  const value = record(receipt, 'Preflight receipt');
  const endpoints = record(value.endpoints, 'Preflight receipt endpoints');
  const credential = record(value.credential, 'Preflight receipt credential');
  const seller = record(value.seller, 'Preflight receipt seller');
  const startedAt = Date.parse(value.startedAt);
  const finishedAt = Date.parse(value.finishedAt);
  const now = Date.now();
  if (value.schema !== 'ss-erp/ozon-source-listing-readonly-preflight/v2'
    || value.finalState !== 'READY_FOR_SEPARATE_WRITE_APPROVAL'
    || value.networkWritesSent !== false
    || endpoints.sellerInfo !== SELLER_INFO_PATH
    || endpoints.offerLookup !== PRODUCT_INFO_PATH
    || value.offerExists !== false
    || value.error !== null
    || value.offerId !== offerId
    || value.shopAlias !== environment.OZON_SANDBOX_TEST_SHOP_ALIAS
    || seller.name !== environment.OZON_SANDBOX_EXPECTED_SELLER_NAME
    || credential.clientIdSha256 !== clientIdFingerprint(credentials.clientId)
    || credential.revisionSha256 !== credentialFingerprint(credentials)
    || !Number.isFinite(startedAt) || !Number.isFinite(finishedAt)
    || startedAt > finishedAt
    || finishedAt > now + MAX_CLOCK_SKEW_MS
    || now - finishedAt > MAX_PREFLIGHT_AGE_MS) {
    if (credential.revisionSha256 !== credentialFingerprint(credentials)) {
      throw new ContractError('Preflight credential revision does not match current credentials.');
    }
    throw new ContractError('Preflight receipt is stale or does not match the exact shop, seller, and offer.');
  }
  const runId = exactBoundedText(value.runId, 200);
  if (!runId) throw new ContractError('Preflight receipt run identity is invalid');
  return {
    sha256: options.preflightSha256,
    runId,
    finishedAt: new Date(finishedAt).toISOString(),
    shopAlias: value.shopAlias,
    sellerName: seller.name,
    clientIdSha256: credential.clientIdSha256,
    credentialRevisionSha256: credential.revisionSha256,
  };
}

async function readApprovalManifest(options, credentials, environment, offerId, payloadBytes, preflight) {
  const bytes = await readFile(options.approvalManifestPath);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_APPROVAL_BYTES) {
    throw new ContractError('Approval manifest size is invalid');
  }
  if (sha256(bytes) !== options.approvalSha256) {
    throw new ContractError('Approval manifest SHA-256 does not match the file.');
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ContractError('Approval manifest is not valid JSON');
  }
  const value = record(manifest, 'Approval manifest');
  const expectedKeys = [
    'approvalId', 'approvedAt', 'clientIdSha256', 'credentialRevisionSha256', 'deviceId',
    'expiresAt', 'offerId', 'operations', 'operatorId', 'payloadSha256',
    'preflightReceiptSha256', 'schema', 'sellerName', 'shopAlias',
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new ContractError('Approval manifest contains unexpected or missing fields');
  }
  const approvedAt = Date.parse(value.approvedAt);
  const expiresAt = Date.parse(value.expiresAt);
  const now = Date.now();
  if (value.schema !== 'ss-erp/ozon-source-listing-approval/v1') {
    throw new ContractError('Approval manifest schema is invalid.');
  }
  if (!exactBoundedText(value.approvalId, 200)
    || !exactBoundedText(value.operatorId, 200)
    || !exactBoundedText(value.deviceId, 200)) {
    throw new ContractError('Approval manifest approval, operator, and device identities are invalid.');
  }
  if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt)
    || approvedAt > now + MAX_CLOCK_SKEW_MS
    || expiresAt <= now
    || expiresAt <= approvedAt
    || expiresAt - approvedAt > MAX_PREFLIGHT_AGE_MS) {
    throw new ContractError('Approval manifest is expired or has an invalid approval window.');
  }
  if (!exactBoundedText(value.shopAlias, 100)
    || value.shopAlias !== environment.OZON_SANDBOX_TEST_SHOP_ALIAS) {
    throw new ContractError('Approval manifest shop identity does not match the configured test shop.');
  }
  if (!exactBoundedText(value.sellerName, 200)
    || value.sellerName !== environment.OZON_SANDBOX_EXPECTED_SELLER_NAME) {
    throw new ContractError('Approval manifest seller identity does not match the expected Ozon seller.');
  }
  if (value.offerId !== offerId) {
    throw new ContractError('Approval manifest offer ID does not match the compiler payload.');
  }
  if (value.preflightReceiptSha256 !== preflight.sha256) {
    throw new ContractError('Approval manifest preflight receipt SHA-256 does not match.');
  }
  if (value.payloadSha256 !== sha256(payloadBytes)) {
    throw new ContractError('Approval manifest payload SHA-256 does not match.');
  }
  if (value.clientIdSha256 !== clientIdFingerprint(credentials.clientId)) {
    throw new ContractError('Approval client ID fingerprint does not match current credentials.');
  }
  if (value.credentialRevisionSha256 !== credentialFingerprint(credentials)) {
    throw new ContractError('Approval credential revision does not match current credentials.');
  }
  if (!Array.isArray(value.operations)
    || JSON.stringify(value.operations) !== JSON.stringify(['IMPORT', 'ARCHIVE'])) {
    throw new ContractError('Approval operations must be exactly IMPORT and ARCHIVE.');
  }
  return {
    sha256: options.approvalSha256,
    approvalId: value.approvalId,
    operatorId: value.operatorId,
    deviceId: value.deviceId,
    approvedAt: new Date(approvedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

let importCallCount = 0;

async function submitProductOnce(credentials, payload) {
  importCallCount += 1;
  if (importCallCount !== 1) {
    throw new ContractError('Invariant violation: Ozon import may be called only once', 70);
  }
  return ozonRequest(credentials, IMPORT_PATH, payload);
}

function taskIdFromResponse(responseBody) {
  const candidate = responseBody?.result?.task_id;
  const text = String(candidate ?? '').trim();
  if (!/^[0-9]{1,16}$/u.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function productId(value) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : null;
}

function extractProductInfoItems(responseBody) {
  const candidates = [responseBody?.items, responseBody?.result?.items, responseBody?.result];
  return candidates.find(Array.isArray) || [];
}

function extractImportItems(responseBody) {
  return Array.isArray(responseBody?.result?.items)
    ? responseBody.result.items
    : Array.isArray(responseBody?.items)
      ? responseBody.items
      : [];
}

function isBlockingError(error) {
  return String(error?.level || '').toLowerCase() === 'error'
    || String(error?.state || '').toLowerCase() === 'declined';
}

function mapImportItems(items, offerIds) {
  const byOffer = new Map();
  const unexpectedOffers = [];
  for (const item of items.slice(0, 500)) {
    const offerId = String(item?.offer_id || '').normalize('NFKC').trim();
    if (!offerId) continue;
    if (byOffer.has(offerId)) {
      unexpectedOffers.push(`duplicate:${offerId}`);
      continue;
    }
    if (!offerIds.includes(offerId)) unexpectedOffers.push(offerId);
    byOffer.set(offerId, item);
  }
  let pending = 0;
  let failed = 0;
  const results = offerIds.map((offerId) => {
    const item = byOffer.get(offerId);
    if (!item) {
      pending += 1;
      return { offerId, found: false, productId: null, status: null, errors: [] };
    }
    const status = String(item.status || '').trim().toLowerCase();
    const rawErrors = Array.isArray(item.errors) ? item.errors : [];
    const errors = rawErrors.slice(0, 50);
    const itemFailed = status === 'failed' || errors.some(isBlockingError);
    if (!['imported', 'failed'].includes(status)) pending += 1;
    if (itemFailed) failed += 1;
    return {
      offerId,
      found: true,
      productId: productId(item.product_id),
      status: status || null,
      errors: redactedClone(errors),
      errorCount: rawErrors.length,
      errorsTruncated: rawErrors.length > errors.length,
    };
  });
  return {
    results,
    pending,
    failed,
    unexpectedOffers,
    allDone: results.length > 0 && pending === 0 && unexpectedOffers.length === 0,
  };
}

function appendPoll(audit, poll) {
  audit.poll.total += 1;
  audit.poll.entries.push(poll);
  if (audit.poll.entries.length > MAX_AUDIT_POLLS) {
    audit.poll.entries.shift();
    audit.poll.dropped += 1;
  }
}

async function pollImport(credentials, taskId, offerIds, options, audit, auditPath) {
  const deadline = Date.now() + options.pollTimeoutMs;
  while (Date.now() <= deadline) {
    const checkedAt = new Date().toISOString();
    try {
      const response = await ozonRequest(credentials, IMPORT_INFO_PATH, { task_id: taskId });
      if (!response.ok) {
        appendPoll(audit, { checkedAt, httpStatus: response.status, readError: true });
      } else {
        const mapped = mapImportItems(extractImportItems(response.body), offerIds);
        appendPoll(audit, {
          checkedAt,
          httpStatus: response.status,
          pending: mapped.pending,
          failed: mapped.failed,
          unexpectedOffers: mapped.unexpectedOffers,
          results: mapped.results,
        });
        audit.itemResults = mapped.results;
        if (mapped.allDone) {
          if (mapped.failed === 0) return { state: 'SUCCEEDED', mapped };
          if (mapped.failed >= offerIds.length) return { state: 'FAILED', mapped };
          return { state: 'PARTIAL_FAILURE', mapped };
        }
      }
    } catch (error) {
      appendPoll(audit, { checkedAt, readError: true, error: boundedError(error) });
    }
    await writeAudit(auditPath, audit, credentials);
    if (Date.now() + options.pollIntervalMs > deadline) break;
    await sleep(options.pollIntervalMs);
  }
  return { state: 'UNKNOWN', mapped: null };
}

async function lookupProducts(credentials, offerIds) {
  const response = await ozonRequest(credentials, PRODUCT_INFO_PATH, { offer_id: offerIds });
  if (!response.ok) throw new Error(`Ozon product lookup returned HTTP ${response.status}`);
  return extractProductInfoItems(response.body).map((item) => ({
    offerId: String(item?.offer_id || '').normalize('NFKC').trim(),
    productId: productId(item?.id ?? item?.product_id),
    archived: item?.is_archived === true,
  })).filter((item) => item.offerId && item.productId);
}

async function lookupSeller(credentials) {
  const response = await ozonRequest(credentials, SELLER_INFO_PATH, {});
  if (!response.ok) throw new Error(`Ozon seller info returned HTTP ${response.status}`);
  const name = typeof response.body?.company?.name === 'string'
    ? response.body.company.name.normalize('NFKC').trim().slice(0, 200)
    : '';
  if (!name) throw new Error('Ozon seller info response did not contain a valid company name');
  return {
    name,
  };
}

async function findCleanupProducts(credentials, offerIds, knownResults) {
  const byOffer = new Map();
  for (const result of knownResults || []) {
    if (result?.offerId && productId(result.productId)) {
      byOffer.set(result.offerId, productId(result.productId));
    }
  }
  let lastLookupError = null;
  for (let attempt = 1; attempt <= 3 && byOffer.size < offerIds.length; attempt += 1) {
    try {
      const found = await lookupProducts(credentials, offerIds);
      lastLookupError = null;
      for (const item of found) {
        if (offerIds.includes(item.offerId)) byOffer.set(item.offerId, item.productId);
      }
    } catch (error) {
      lastLookupError = error;
    }
    if (byOffer.size < offerIds.length && attempt < 3) await sleep(2_000);
  }
  if (!byOffer.size && lastLookupError) throw lastLookupError;
  return [...new Set(byOffer.values())];
}

async function cleanupPublishedProducts(credentials, offerIds, knownResults) {
  const productIds = await findCleanupProducts(credentials, offerIds, knownResults);
  if (!productIds.length) return { state: 'CLEANUP_PENDING', productIds: [] };
  const response = await ozonRequest(credentials, ARCHIVE_PATH, { product_id: productIds });
  if (!response.ok || response.body?.result !== true) {
    throw new Error(`Ozon archive returned HTTP ${response.status}`);
  }
  const archived = await lookupProducts(credentials, offerIds);
  const archivedIds = new Set(archived.filter((item) => item.archived).map((item) => item.productId));
  return {
    state: archivedIds.size === productIds.length ? 'ARCHIVE_VERIFIED' : 'ARCHIVE_ACCEPTED',
    productIds,
  };
}

async function reconcileExistingAudit(options, credentials, environment) {
  const bytes = await readFile(options.auditPath);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PAYLOAD_BYTES) {
    throw new ContractError('Existing audit size is invalid');
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new ContractError('Existing audit is not valid JSON');
  }
  const audit = record(parsed, 'Existing sandbox audit');
  if (audit.schema !== 'ss-erp/ozon-source-listing-sandbox-audit/v1'
    || audit.automaticResubmitAllowed !== false) {
    throw new ContractError('Reconcile requires an immutable sandbox audit with resubmission disabled.');
  }
  const shop = record(audit.shop, 'Existing sandbox audit shop');
  const offerIds = Array.isArray(audit.payload?.offerIds)
    ? [...new Set(audit.payload.offerIds.map((value) => validateReservedOfferId(value)))].sort()
    : [];
  if (offerIds.length !== 1) {
    throw new ContractError('Reconcile requires exactly one reserved offer ID from the audit.');
  }
  const expectedClientIdHash = clientIdFingerprint(credentials.clientId);
  const expectedCredentialHash = credentialFingerprint(credentials);
  if (shop.alias !== environment.OZON_SANDBOX_TEST_SHOP_ALIAS
    || shop.sellerName !== environment.OZON_SANDBOX_EXPECTED_SELLER_NAME
    || shop.clientIdSha256 !== expectedClientIdHash
    || shop.credentialRevisionSha256 !== expectedCredentialHash) {
    throw new ContractError('Existing audit identity does not match the current dedicated test credentials.');
  }
  const seller = await lookupSeller(credentials);
  if (seller.name !== environment.OZON_SANDBOX_EXPECTED_SELLER_NAME) {
    throw new ContractError('Current Seller Info identity differs from the audited test shop.');
  }
  const products = await lookupProducts(credentials, offerIds);
  const matching = products.filter((item) => item.offerId === offerIds[0]);
  const state = matching.length === 0
    ? 'NOT_FOUND'
    : matching.every((item) => item.archived) ? 'ARCHIVED' : 'FOUND_UNARCHIVED';
  audit.reconciliation = {
    attemptedAt: new Date().toISOString(),
    mode: 'READ_ONLY_RECONCILE',
    state,
    offerIds,
    products: matching.map((item) => ({
      offerId: item.offerId,
      productId: item.productId,
      archived: item.archived,
    })),
    networkWritesSent: false,
  };
  const reconciledAuditPath = `${options.auditPath}.reconciled-${randomUUID()}.json`;
  const auditSha256 = await writeAudit(reconciledAuditPath, audit, credentials);
  console.log(JSON.stringify({
    mode: 'READ_ONLY_RECONCILE',
    state,
    offerIds,
    sourceAuditPath: options.auditPath,
    auditPath: reconciledAuditPath,
    auditSha256,
    networkWritesSent: false,
    cleanupAttempted: false,
  }));
  return state === 'FOUND_UNARCHIVED' ? 2 : 0;
}

function defaultAuditPath(runId) {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return resolve('tmp', 'sandbox-audits', `ozon-source-listing-${timestamp}-${runId}.json`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  requireExecutionGates(options, process.env);

  if (options.preflight) {
    const runId = randomUUID();
    const auditPath = options.auditPath || defaultAuditPath(runId).replace(
      'ozon-source-listing-',
      'ozon-source-listing-readonly-',
    );
    await assertAuditPathAvailable(auditPath, '');
    const credentials = {
      clientId: process.env.OZON_SANDBOX_TEST_CLIENT_ID.trim(),
      apiKey: process.env.OZON_SANDBOX_TEST_API_KEY.trim(),
    };
    const audit = {
      schema: 'ss-erp/ozon-source-listing-readonly-preflight/v2',
      runId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      finalState: 'PREPARED',
      networkWritesSent: false,
      endpoints: { sellerInfo: SELLER_INFO_PATH, offerLookup: PRODUCT_INFO_PATH },
      shopAlias: process.env.OZON_SANDBOX_TEST_SHOP_ALIAS,
      credential: {
        clientIdSha256: clientIdFingerprint(credentials.clientId),
        revisionSha256: credentialFingerprint(credentials),
      },
      offerId: options.offerId,
      seller: null,
      offerExists: null,
      error: null,
    };
    let auditSha256 = null;
    try {
      audit.seller = await lookupSeller(credentials);
      if (audit.seller.name !== process.env.OZON_SANDBOX_EXPECTED_SELLER_NAME) {
        throw new Error('Ozon Seller Info identity differs from OZON_SANDBOX_EXPECTED_SELLER_NAME');
      }
      const existing = await lookupProducts(credentials, [options.offerId]);
      audit.offerExists = existing.length > 0;
      audit.finalState = audit.offerExists ? 'OFFER_NOT_AVAILABLE' : 'READY_FOR_SEPARATE_WRITE_APPROVAL';
    } catch (error) {
      audit.finalState = 'PREFLIGHT_FAILED';
      audit.error = boundedError(error);
    } finally {
      audit.finishedAt = new Date().toISOString();
      auditSha256 = await writeAudit(auditPath, audit, credentials);
    }
    console.log(JSON.stringify({
      mode: 'READ_ONLY_PREFLIGHT',
      finalState: audit.finalState,
      offerId: options.offerId,
      offerExists: audit.offerExists,
      auditPath,
      auditSha256,
      networkWritesSent: false,
    }));
    return audit.finalState === 'READY_FOR_SEPARATE_WRITE_APPROVAL' ? 0 : 2;
  }

  if (options.reconcile) {
    const credentials = {
      clientId: process.env.OZON_SANDBOX_TEST_CLIENT_ID.trim(),
      apiKey: process.env.OZON_SANDBOX_TEST_API_KEY.trim(),
    };
    return reconcileExistingAudit(options, credentials, process.env);
  }

  const payloadBytes = await readFile(options.payloadPath);
  let parsed;
  try {
    parsed = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    throw new ContractError('Compiled payload is not valid JSON');
  }
  const compiled = validateCompiledPayload(parsed, payloadBytes.byteLength);
  const runId = randomUUID();
  const auditPath = options.auditPath || defaultAuditPath(runId);
  await assertAuditPathAvailable(auditPath, options.payloadPath);
  if (options.preflightReceiptPath === options.payloadPath
    || options.preflightReceiptPath === auditPath) {
    throw new ContractError('Preflight receipt path must differ from payload and audit paths');
  }
  if (options.approvalManifestPath === options.payloadPath
    || options.approvalManifestPath === options.preflightReceiptPath
    || options.approvalManifestPath === auditPath) {
    throw new ContractError('Approval manifest path must differ from payload, preflight, and audit paths');
  }
  const credentials = {
    clientId: process.env.OZON_SANDBOX_TEST_CLIENT_ID.trim(),
    apiKey: process.env.OZON_SANDBOX_TEST_API_KEY.trim(),
  };
  const preflight = await readPreflightReceipt(
    options,
    credentials,
    process.env,
    compiled.offerIds[0],
  );
  const approval = await readApprovalManifest(
    options,
    credentials,
    process.env,
    compiled.offerIds[0],
    payloadBytes,
    preflight,
  );
  const audit = {
    schema: 'ss-erp/ozon-source-listing-sandbox-audit/v1',
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finalState: 'PREPARED',
    automaticResubmitAllowed: false,
    shop: {
      alias: preflight.shopAlias,
      sellerName: preflight.sellerName,
      clientIdSha256: preflight.clientIdSha256,
      credentialRevisionSha256: preflight.credentialRevisionSha256,
    },
    preflight: {
      schema: 'ss-erp/ozon-source-listing-readonly-preflight/v2',
      sha256: preflight.sha256,
      runId: preflight.runId,
      finishedAt: preflight.finishedAt,
    },
    approval: {
      schema: 'ss-erp/ozon-source-listing-approval/v1',
      sha256: approval.sha256,
      approvalId: approval.approvalId,
      operatorId: approval.operatorId,
      deviceId: approval.deviceId,
      approvedAt: approval.approvedAt,
      expiresAt: approval.expiresAt,
    },
    payload: {
      sha256: sha256(payloadBytes),
      byteLength: payloadBytes.byteLength,
      itemCount: compiled.payload.items.length,
      offerIds: compiled.offerIds,
      ...compiled.envelope,
    },
    endpoints: {
      submit: IMPORT_PATH,
      poll: IMPORT_INFO_PATH,
      lookup: PRODUCT_INFO_PATH,
      cleanup: ARCHIVE_PATH,
    },
    submit: { attempted: false, callCount: 0, taskId: null, httpStatus: null, response: null, error: null },
    poll: { total: 0, dropped: 0, entries: [] },
    itemResults: [],
    cleanup: { attempted: false, state: 'NOT_ATTEMPTED', productIds: [], error: null },
  };
  let exitCode = 2;

  await writeAudit(auditPath, audit, credentials);
  try {
    let existing;
    try {
      const seller = await lookupSeller(credentials);
      if (seller.name !== preflight.sellerName) {
        throw new Error('Current Seller Info identity differs from the approved preflight receipt');
      }
      existing = await lookupProducts(credentials, compiled.offerIds);
    } catch (error) {
      audit.finalState = 'PRECHECK_FAILED';
      audit.submit.error = `Pre-submit offer lookup failed closed: ${boundedError(error)}`;
      return 2;
    }
    if (existing.length) {
      audit.finalState = 'PRECHECK_FAILED';
      audit.submit.error = 'Reserved offer_id already exists in the test shop; use a new unique offer_id';
      return 2;
    }

    audit.submit.attempted = true;
    audit.submit.callCount = 1;
    audit.submit.startedAt = new Date().toISOString();
    let submission;
    try {
      submission = await submitProductOnce(credentials, compiled.payload);
      audit.submit.finishedAt = new Date().toISOString();
      audit.submit.httpStatus = submission.status;
      audit.submit.response = redactedClone(submission.body);
    } catch (error) {
      audit.finalState = 'UNKNOWN';
      audit.submit.error = `Submission transport outcome is unknown: ${boundedError(error)}`;
      exitCode = 3;
      await writeAudit(auditPath, audit, credentials);
      return 3;
    }

    const taskId = taskIdFromResponse(submission.body);
    if (!submission.ok) {
      audit.finalState = submission.status >= 500 ? 'UNKNOWN' : 'REJECTED';
      audit.submit.error = `Ozon import returned HTTP ${submission.status} without a durable task acknowledgement`;
      exitCode = audit.finalState === 'UNKNOWN' ? 3 : 2;
      await writeAudit(auditPath, audit, credentials);
      return exitCode;
    }
    if (!taskId) {
      audit.finalState = 'UNKNOWN';
      audit.submit.error = 'Ozon import response did not contain a valid durable task ID';
      exitCode = 3;
      await writeAudit(auditPath, audit, credentials);
      return 3;
    }

    audit.submit.taskId = String(taskId);
    audit.finalState = 'SUBMITTED';
    await writeAudit(auditPath, audit, credentials);
    const reconciliation = await pollImport(
      credentials,
      taskId,
      compiled.offerIds,
      options,
      audit,
      auditPath,
    );
    audit.finalState = reconciliation.state;
    exitCode = reconciliation.state === 'SUCCEEDED' ? 0
      : reconciliation.state === 'UNKNOWN' ? 3 : 2;
    await writeAudit(auditPath, audit, credentials);
    return exitCode;
  } finally {
    if (audit.submit.attempted) {
      audit.cleanup.attempted = true;
      try {
        const cleanup = await cleanupPublishedProducts(credentials, compiled.offerIds, audit.itemResults);
        audit.cleanup = { attempted: true, ...cleanup, error: null };
        if (cleanup.state !== 'ARCHIVE_VERIFIED') {
          if (audit.finalState === 'SUCCEEDED') audit.finalState = 'CLEANUP_PENDING';
          if (exitCode === 0) exitCode = 2;
        }
      } catch (error) {
        audit.cleanup.state = 'FAILED';
        audit.cleanup.error = boundedError(error);
        if (audit.finalState === 'SUCCEEDED') audit.finalState = 'CLEANUP_FAILED';
        if (exitCode === 0) exitCode = 2;
      }
    }
    audit.finishedAt = new Date().toISOString();
    await writeAudit(auditPath, audit, credentials);
    console.log('Sandbox audit written successfully.');
    if (audit.finalState === 'UNKNOWN') {
      console.error('UNKNOWN submission outcome recorded. Automatic resubmission is forbidden.');
    }
    process.exitCode = exitCode;
  }
}

try {
  const exitCode = await main();
  if (Number.isInteger(exitCode) && process.exitCode == null) process.exitCode = exitCode;
} catch (error) {
  const exitCode = error instanceof ContractError ? error.exitCode : 1;
  console.error(error instanceof ContractError ? error.message : 'Sandbox probe failed before a safe audit could be initialized.');
  if (error instanceof ContractError) console.error(usage());
  process.exitCode = exitCode;
}
