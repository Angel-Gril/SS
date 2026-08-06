#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const EXPECTATIONS = new Set(['off', 'sandbox-pilot', 'ingest-pilot', 'publish-pilot']);
const PILOT_FLAG_EXPECTATIONS = Object.freeze({
  'sandbox-pilot': Object.freeze({ generation: true, ingest: false, publish: false }),
  'ingest-pilot': Object.freeze({ generation: true, ingest: true, publish: false }),
  'publish-pilot': Object.freeze({ generation: true, ingest: true, publish: true }),
});
const OPERATIONS = Object.freeze([
  'TEXT_TO_IMAGE',
  'IMAGE_TO_IMAGE',
  'FULL_EDIT',
  'INPAINT',
]);
const POLICY_KEYS = Object.freeze([
  'allowedOperations',
  'allowedOrigins',
  'contractVersion',
  'deviceSessionIds',
  'maxConcurrency',
  'mode',
  'ownerUserIds',
  'revision',
  'shopIds',
]);
const PILOT_EXPECTATION_KEYS = Object.freeze([
  'allowedOperations',
  'allowedOrigins',
  'deviceSessionIds',
  'hostedAiEnabled',
  'ownerUserIds',
  'revision',
  'shopIds',
]);

function fail(message) {
  throw new Error(message);
}

function exactObject(value, expectedKeys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const actualKeys = Object.keys(value).sort();
  const keys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(keys)) {
    fail(`${field} must contain exactly: ${keys.join(', ')}`);
  }
  return value;
}

function identifier(value, field) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  const lower = parsed.toLowerCase();
  const containsControlCharacter = [...parsed].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
  const resemblesSecretOrTransport = parsed.includes('?')
    || parsed.includes('#')
    || lower.startsWith('data:')
    || /(?:https?|ftp):\/\//iu.test(parsed)
    || /(^|[\s:])authorization(?:[\s:=]|$)/iu.test(parsed)
    || /(^|[\s:])bearer\s+/iu.test(parsed)
    || /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[:=]/iu.test(parsed)
    || /^(?:sk-|rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)[A-Za-z0-9_-]+/iu
      .test(parsed);
  if (!parsed
    || parsed !== value
    || parsed.length > 500
    || containsControlCharacter
    || resemblesSecretOrTransport) {
    fail(`${field} contains an invalid identifier`);
  }
  return parsed;
}

function identifierList(value, field) {
  if (!Array.isArray(value) || value.length > 500) {
    fail(`${field} must be an array with at most 500 entries`);
  }
  const parsed = value.map((entry, index) => identifier(entry, `${field}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail(`${field} must not contain duplicates`);
  return parsed;
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

function canonicalProviderOrigin(value, field) {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > 2048
    || value.includes('\\')) {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  let parsed;
  try {
    parsed = new URL(value);
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
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u
      .test(hostname);
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || parsed.origin === 'null'
    || !publicHostname
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.origin !== value) {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  return parsed.origin;
}

function originList(value, field) {
  if (!Array.isArray(value) || value.length > 100) {
    fail(`${field} must be an array with at most 100 entries`);
  }
  const parsed = value.map((entry, index) => canonicalProviderOrigin(entry, `${field}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail(`${field} must not contain duplicates`);
  return parsed;
}

function operationList(value, field) {
  if (!Array.isArray(value) || value.length > OPERATIONS.length) {
    fail(`${field} must be an array with at most ${OPERATIONS.length} entries`);
  }
  for (const operation of value) {
    if (!OPERATIONS.includes(operation)) fail(`${field} contains an unsupported operation`);
  }
  if (new Set(value).size !== value.length) fail(`${field} must not contain duplicates`);
  return [...value];
}

function parsePolicy(rawPolicy) {
  if (typeof rawPolicy !== 'string' || !rawPolicy || rawPolicy.length > 100_000) {
    fail('extension_byok_admin_policy must be a non-empty JSON string');
  }
  let value;
  try {
    value = JSON.parse(rawPolicy);
  } catch {
    fail('extension_byok_admin_policy must be valid JSON');
  }
  const parsed = exactObject(value, POLICY_KEYS, 'extension_byok_admin_policy');
  if (parsed.contractVersion !== 'extension-byok-admin-policy/v1') {
    fail('extension_byok_admin_policy contractVersion is invalid');
  }
  if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 0) {
    fail('extension_byok_admin_policy revision must be a non-negative safe integer');
  }
  if (!['off', 'pilot', 'global'].includes(parsed.mode)) {
    fail('extension_byok_admin_policy mode is invalid');
  }
  if (parsed.maxConcurrency !== 1) {
    fail('extension_byok_admin_policy maxConcurrency must be exactly 1');
  }
  const policy = {
    contractVersion: parsed.contractVersion,
    revision: parsed.revision,
    mode: parsed.mode,
    ownerUserIds: identifierList(parsed.ownerUserIds, 'extension_byok_admin_policy.ownerUserIds'),
    shopIds: identifierList(parsed.shopIds, 'extension_byok_admin_policy.shopIds'),
    deviceSessionIds: identifierList(
      parsed.deviceSessionIds,
      'extension_byok_admin_policy.deviceSessionIds',
    ),
    allowedOrigins: originList(parsed.allowedOrigins, 'extension_byok_admin_policy.allowedOrigins'),
    allowedOperations: operationList(
      parsed.allowedOperations,
      'extension_byok_admin_policy.allowedOperations',
    ),
    maxConcurrency: parsed.maxConcurrency,
  };
  if (policy.mode === 'pilot'
    && (!policy.ownerUserIds.length || !policy.shopIds.length || !policy.deviceSessionIds.length)) {
    fail('extension_byok_admin_policy pilot identity lists must be non-empty');
  }
  if (policy.mode !== 'off'
    && (!policy.allowedOrigins.length || !policy.allowedOperations.length)) {
    fail('extension_byok_admin_policy enabled allowlists must be non-empty');
  }
  return policy;
}

function sameList(actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} does not exactly match the rollout expectation`);
  }
}

function parseRows(rows) {
  if (!Array.isArray(rows)) fail('SystemConfig fixture must be an array');
  const values = new Map();
  for (const row of rows) {
    if (!row || typeof row.key !== 'string' || typeof row.value !== 'string') {
      fail('SystemConfig row is invalid');
    }
    if (values.has(row.key)) fail(`SystemConfig contains duplicate key ${row.key}`);
    values.set(row.key, row.value);
  }
  return values;
}

function verifyFlag(values, key, expected, allowAbsent) {
  const value = values.get(key);
  if (value === undefined) {
    if (allowAbsent && expected === false) return 'absent(default:false)';
    fail(`${key} must be explicitly ${expected}`);
  }
  if (value !== 'true' && value !== 'false') {
    fail(`${key} must be the canonical boolean string true or false`);
  }
  if ((value === 'true') !== expected) fail(`${key} must be ${expected}, found ${value}`);
  return value;
}

function pilotExpectation(options) {
  const expected = exactObject(options, ['expectation', ...PILOT_EXPECTATION_KEYS], 'expectation');
  if (typeof expected.hostedAiEnabled !== 'boolean') {
    fail('expectation.hostedAiEnabled must be an explicit boolean');
  }
  if (!Number.isSafeInteger(expected.revision) || expected.revision < 0) {
    fail('expectation.revision must be a non-negative safe integer');
  }
  const parsed = {
    expectation: expected.expectation,
    hostedAiEnabled: expected.hostedAiEnabled,
    revision: expected.revision,
    ownerUserIds: identifierList(expected.ownerUserIds, 'expectation.ownerUserIds'),
    shopIds: identifierList(expected.shopIds, 'expectation.shopIds'),
    deviceSessionIds: identifierList(expected.deviceSessionIds, 'expectation.deviceSessionIds'),
    allowedOrigins: originList(expected.allowedOrigins, 'expectation.allowedOrigins'),
    allowedOperations: operationList(expected.allowedOperations, 'expectation.allowedOperations'),
  };
  if (!parsed.ownerUserIds.length
    || !parsed.shopIds.length
    || !parsed.deviceSessionIds.length
    || !parsed.allowedOrigins.length
    || !parsed.allowedOperations.length) {
    fail('pilot expectations require explicit non-empty IDs, origins, and operations');
  }
  return parsed;
}

export function verifyExtensionByokRolloutPolicy(rows, options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    fail('rollout expectation must be an object');
  }
  if (!EXPECTATIONS.has(options.expectation)) {
    fail('expectation must be off, sandbox-pilot, ingest-pilot, or publish-pilot');
  }
  const values = parseRows(rows);
  if (options.expectation === 'off') {
    exactObject(options, ['expectation'], 'expectation');
    const result = {
      expectation: 'off',
      hostedAi: verifyFlag(values, 'feature_extension_hosted_ai', false, true),
      generation: verifyFlag(values, 'feature_extension_byok_ai', false, true),
      ingest: verifyFlag(values, 'feature_extension_byok_ingest', false, true),
      publish: verifyFlag(values, 'feature_extension_byok_publish', false, true),
      policy: 'absent(default:off)',
    };
    const rawPolicy = values.get('extension_byok_admin_policy');
    if (rawPolicy !== undefined) {
      const policy = parsePolicy(rawPolicy);
      if (policy.revision !== 0 || policy.mode !== 'off') {
        fail('off expectation requires the default revision 0 off admin policy');
      }
      for (const field of [
        'ownerUserIds',
        'shopIds',
        'deviceSessionIds',
        'allowedOrigins',
        'allowedOperations',
      ]) {
        if (policy[field].length !== 0) fail(`off expectation requires empty ${field}`);
      }
      result.policy = 'extension-byok-admin-policy/v1:revision:0,mode:off';
    }
    return result;
  }

  const expected = pilotExpectation(options);
  const expectedFlags = PILOT_FLAG_EXPECTATIONS[options.expectation];
  const result = {
    expectation: options.expectation,
    hostedAi: verifyFlag(
      values,
      'feature_extension_hosted_ai',
      expected.hostedAiEnabled,
      false,
    ),
    generation: verifyFlag(
      values,
      'feature_extension_byok_ai',
      expectedFlags.generation,
      false,
    ),
    ingest: verifyFlag(
      values,
      'feature_extension_byok_ingest',
      expectedFlags.ingest,
      false,
    ),
    publish: verifyFlag(
      values,
      'feature_extension_byok_publish',
      expectedFlags.publish,
      false,
    ),
    policy: '',
  };
  const rawPolicy = values.get('extension_byok_admin_policy');
  if (rawPolicy === undefined) fail('pilot expectation requires extension_byok_admin_policy');
  const policy = parsePolicy(rawPolicy);
  if (policy.mode !== 'pilot') fail('pilot expectation requires admin policy mode pilot');
  if (policy.revision !== expected.revision) {
    fail('extension_byok_admin_policy revision does not match the rollout expectation');
  }
  for (const field of [
    'ownerUserIds',
    'shopIds',
    'deviceSessionIds',
    'allowedOrigins',
    'allowedOperations',
  ]) {
    sameList(policy[field], expected[field], `extension_byok_admin_policy.${field}`);
  }
  result.policy = `extension-byok-admin-policy/v1:revision:${policy.revision},mode:pilot`;
  return result;
}

function parseJsonArgument(value, field) {
  if (!value) fail(`${field} is required`);
  try {
    return JSON.parse(value);
  } catch {
    fail(`${field} must be valid JSON`);
  }
}

function cliOptions(expectation, rawExpected) {
  if (expectation === 'off') {
    if (rawExpected !== undefined) fail('off expectation does not accept pilot expectations');
    return { expectation };
  }
  if (!['sandbox-pilot', 'ingest-pilot', 'publish-pilot'].includes(expectation)) {
    fail('expectation must be off, sandbox-pilot, ingest-pilot, or publish-pilot');
  }
  const expected = parseJsonArgument(rawExpected, 'pilot expectations JSON');
  exactObject(expected, PILOT_EXPECTATION_KEYS, 'pilot expectations JSON');
  return { expectation, ...expected };
}

if (process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) {
      fail(
        'usage: verify-extension-byok-rollout-policy.mjs '
          + '<off|sandbox-pilot|ingest-pilot|publish-pilot> <rows-json> [pilot-expectations-json]',
      );
    }
    const expectation = process.argv[2];
    const rows = parseJsonArgument(process.argv[3], 'SystemConfig rows JSON');
    const result = verifyExtensionByokRolloutPolicy(
      rows,
      cliOptions(expectation, process.argv[4]),
    );
    console.log(
      `PASS Extension BYOK rollout matches ${result.expectation} `
        + `(hostedAi=${result.hostedAi}; generation=${result.generation}; `
        + `ingest=${result.ingest}; publish=${result.publish}; policy=${result.policy})`,
    );
  } catch (error) {
    console.error(
      `FAIL Extension BYOK rollout mismatch: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
