import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
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
const MAX_AUDIT_POLLS = 200;
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60_000;
const MAX_POLL_TIMEOUT_MS = 30 * 60_000;
const SENSITIVE_KEY = /(?:authorization|api[_-]?key|client[_-]?id|cookie|password|secret|token)/iu;

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
    '',
    'Required environment:',
    `  OZON_SANDBOX_CONFIRM=${CONFIRMATION_PHRASE}`,
    `  OZON_SANDBOX_READONLY_CONFIRM=${READONLY_CONFIRMATION_PHRASE}`,
    '  OZON_SANDBOX_TEST_SHOP=true',
    '  OZON_SANDBOX_TEST_CLIENT_ID=<dedicated test shop client ID>',
    '  OZON_SANDBOX_TEST_API_KEY=<dedicated test shop API key>',
    '',
    'Options:',
    '  --offer-id <id>             Reserved offer ID for --preflight',
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
    help: false,
    payloadPath: null,
    auditPath: null,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--execute' || argument === '--preflight' || argument === '--help') {
      if (seen.has(argument)) throw new ContractError(`Duplicate argument: ${argument}`);
      seen.add(argument);
      if (argument === '--execute') options.execute = true;
      if (argument === '--preflight') options.preflight = true;
      if (argument === '--help') options.help = true;
      continue;
    }
    if (!['--payload', '--offer-id', '--audit', '--poll-interval-ms', '--poll-timeout-ms'].includes(argument)) {
      throw new ContractError(`Unknown argument: ${argument}`);
    }
    if (seen.has(argument)) throw new ContractError(`Duplicate argument: ${argument}`);
    seen.add(argument);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new ContractError(`Missing value for ${argument}`);
    index += 1;
    if (argument === '--payload') options.payloadPath = resolve(value);
    if (argument === '--offer-id') options.offerId = value;
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
  if (options.execute === options.preflight) {
    throw new ContractError('Refusing to run without the explicit --execute flag or --preflight flag; writes require explicit --execute.');
  }
  if (options.execute && environment.OZON_SANDBOX_CONFIRM !== CONFIRMATION_PHRASE) {
    throw new ContractError('Refusing to run without the exact OZON_SANDBOX_CONFIRM phrase.');
  }
  if (options.preflight && environment.OZON_SANDBOX_READONLY_CONFIRM !== READONLY_CONFIRMATION_PHRASE) {
    throw new ContractError('Refusing to run without the exact OZON_SANDBOX_READONLY_CONFIRM phrase.');
  }
  if (environment.OZON_SANDBOX_TEST_SHOP !== 'true') {
    throw new ContractError('Refusing to run unless OZON_SANDBOX_TEST_SHOP=true identifies dedicated test credentials.');
  }
  const clientId = String(environment.OZON_SANDBOX_TEST_CLIENT_ID || '').trim();
  const apiKey = String(environment.OZON_SANDBOX_TEST_API_KEY || '').trim();
  if (!clientId || !apiKey || clientId.length > 500 || apiKey.length > 500) {
    throw new ContractError('Dedicated OZON_SANDBOX_TEST_CLIENT_ID and OZON_SANDBOX_TEST_API_KEY are required.');
  }
  if (options.execute && !options.payloadPath) {
    throw new ContractError('--payload is required after all execution gates pass.');
  }
  if (options.preflight && options.payloadPath) {
    throw new ContractError('--payload is only valid with --execute; preflight is read-only.');
  }
  if (options.preflight) {
    const offerId = String(options.offerId || '').normalize('NFKC').trim();
    const suffix = offerId.startsWith(RESERVED_OFFER_PREFIX)
      ? offerId.slice(RESERVED_OFFER_PREFIX.length)
      : '';
    if (!/^[a-z0-9][a-z0-9._-]{0,179}$/u.test(suffix) || offerId !== options.offerId) {
      throw new ContractError(`--offer-id must use the reserved ${RESERVED_OFFER_PREFIX} lowercase prefix.`);
    }
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
  const payload = record(parsed, 'Compiled payload');
  const topLevelKeys = Object.keys(payload);
  if (topLevelKeys.length !== 1 || topLevelKeys[0] !== 'items') {
    throw new ContractError('Compiled payload must have exactly one top-level key: items');
  }
  if (!Array.isArray(payload.items) || payload.items.length !== 1) {
    throw new ContractError('Sandbox execution requires exactly one compiled Ozon item');
  }
  scanForSensitiveKeys(payload);
  const item = record(payload.items[0], 'Compiled payload item');
  const offerId = typeof item.offer_id === 'string' ? item.offer_id.normalize('NFKC').trim() : '';
  const offerSuffix = offerId.startsWith(RESERVED_OFFER_PREFIX)
    ? offerId.slice(RESERVED_OFFER_PREFIX.length)
    : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,179}$/u.test(offerSuffix)) {
    throw new ContractError(`offer_id must use the reserved ${RESERVED_OFFER_PREFIX} lowercase prefix`);
  }
  if (item.offer_id !== offerId) {
    throw new ContractError('offer_id must already be normalized and contain no surrounding whitespace');
  }
  return { payload, offerIds: [offerId] };
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
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactedClone(item, state, depth + 1);
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
  await writeFile(auditPath, `${serialized}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
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
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      body: parseResponseText(text),
    };
  } finally {
    clearTimeout(timeout);
  }
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
  if (!productIds.length) return { state: 'NO_PRODUCT_FOUND', productIds: [] };
  const response = await ozonRequest(credentials, ARCHIVE_PATH, { product_id: productIds });
  if (!response.ok || response.body?.result !== true) {
    throw new Error(`Ozon archive returned HTTP ${response.status}`);
  }
  return { state: 'ARCHIVED', productIds };
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
      schema: 'ss-erp/ozon-source-listing-readonly-preflight/v1',
      runId,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      finalState: 'PREPARED',
      networkWritesSent: false,
      endpoints: { sellerInfo: SELLER_INFO_PATH, offerLookup: PRODUCT_INFO_PATH },
      offerId: options.offerId,
      seller: null,
      offerExists: null,
      error: null,
    };
    try {
      audit.seller = await lookupSeller(credentials);
      const existing = await lookupProducts(credentials, [options.offerId]);
      audit.offerExists = existing.length > 0;
      audit.finalState = audit.offerExists ? 'OFFER_NOT_AVAILABLE' : 'READY_FOR_SEPARATE_WRITE_APPROVAL';
    } catch (error) {
      audit.finalState = 'PREFLIGHT_FAILED';
      audit.error = boundedError(error);
    } finally {
      audit.finishedAt = new Date().toISOString();
      await writeAudit(auditPath, audit, credentials);
    }
    console.log(JSON.stringify({
      mode: 'READ_ONLY_PREFLIGHT',
      finalState: audit.finalState,
      offerId: options.offerId,
      offerExists: audit.offerExists,
      auditPath,
      networkWritesSent: false,
    }));
    return audit.finalState === 'READY_FOR_SEPARATE_WRITE_APPROVAL' ? 0 : 2;
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
  const credentials = {
    clientId: process.env.OZON_SANDBOX_TEST_CLIENT_ID.trim(),
    apiKey: process.env.OZON_SANDBOX_TEST_API_KEY.trim(),
  };
  const audit = {
    schema: 'ss-erp/ozon-source-listing-sandbox-audit/v1',
    runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finalState: 'PREPARED',
    automaticResubmitAllowed: false,
    payload: {
      sha256: sha256(payloadBytes),
      byteLength: payloadBytes.byteLength,
      itemCount: compiled.payload.items.length,
      offerIds: compiled.offerIds,
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
        if (exitCode === 0 && cleanup.state !== 'ARCHIVED') exitCode = 2;
      } catch (error) {
        audit.cleanup.state = 'FAILED';
        audit.cleanup.error = boundedError(error);
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
