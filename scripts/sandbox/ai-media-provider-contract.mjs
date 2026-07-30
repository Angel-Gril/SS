#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { reviewedPaidDerivedCapabilityMatches } from './ai-media-provider-review.mjs';

const root = process.cwd();
const matrixPath = path.join(root, 'docs/contracts/ai-media-provider-matrix.md');
const policyDir = path.join(root, 'scripts/fixtures/ai-media-evaluation');
const evaluationContractPath = path.join(root, 'scripts/ai-media-evaluation-contract.test.mjs');
const reviewedPaidDerivedCapabilities = new Map([
  ['dashscope-qwen-mt-image:qwen-mt-image', {
    operations: new Set(['IMAGE_TRANSLATE']),
    inputTransport: 'public_url',
    resultMode: 'async',
    maxReferences: 1,
    supportsMask: false,
    sandboxEvidence: null,
  }],
  ['openai-images:gpt-image-1', {
    operations: new Set(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']),
    inputTransport: 'multipart',
    resultMode: 'sync',
    maxReferences: 16,
    supportsMask: true,
    sandboxEvidence: null,
  }],
]);

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(matrixPath)) fail('provider matrix is missing');
if (!fs.existsSync(policyDir)) fail('AI media evaluation policy directory is missing');
if (!fs.existsSync(evaluationContractPath)) fail('AI media evaluation contract is missing');

let capabilities = [];
try {
  const runner = process.platform === 'win32' ? process.execPath : 'pnpm';
  const runnerArgs =
    process.platform === 'win32'
      ? [path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')]
      : [];
  const source = [
    'import { AI_IMAGE_PROVIDER_CAPABILITIES } from "./src/services/ai-image-provider-capabilities.ts";',
    'process.stdout.write(JSON.stringify(AI_IMAGE_PROVIDER_CAPABILITIES));',
  ].join(' ');
  capabilities = JSON.parse(
    execFileSync(runner, [...runnerArgs, 'exec', 'tsx', '-e', source], {
      cwd: path.join(root, 'apps/server'),
      encoding: 'utf8',
    }),
  );
} catch (error) {
  fail(`could not load the server capability registry: ${error.message}`);
}

for (const provider of ['fake', 'dashscope-wanx', 'openai-images']) {
  if (!capabilities.some((entry) => entry.provider === provider))
    fail(`registry is missing ${provider}`);
}
for (const entry of capabilities) {
  if (entry.model === '*' && entry.evidenceLevel === 'sandbox-verified') {
    fail(`wildcard model cannot be sandbox verified: ${entry.provider}`);
  }
  if (entry.evidenceLevel === 'sandbox-verified') {
    if (!Array.isArray(entry.sandboxEvidence) || entry.sandboxEvidence.length < 1) {
      fail(`sandbox-verified capability lacks exact evidence bindings: ${entry.provider}:${entry.model}`);
    } else {
      const seen = new Set();
      for (const evidence of entry.sandboxEvidence) {
        const key = [
          evidence?.endpointSha256,
          evidence?.operation,
          evidence?.inputTransport,
          evidence?.resultMode,
        ].join(':');
        if (!/^[a-f0-9]{64}$/u.test(String(evidence?.endpointSha256 || ''))
          || !(entry.operations || []).includes(evidence?.operation)
          || !['none', 'public_url', 'base64', 'multipart'].includes(evidence?.inputTransport)
          || !['sync', 'async'].includes(evidence?.resultMode)
          || seen.has(key)) {
          fail(`sandbox evidence binding is invalid or duplicated: ${entry.provider}:${entry.model}`);
          break;
        }
        seen.add(key);
      }
      for (const operation of entry.operations || []) {
        if (!entry.sandboxEvidence.some((evidence) => evidence?.operation === operation)) {
          fail(`sandbox-verified capability lacks operation evidence: ${entry.provider}:${entry.model}:${operation}`);
        }
      }
    }
  }
  const paidDerivedOperations = entry.provider === 'fake'
    ? []
    : (entry.operations || []).filter((operation) => operation !== 'TEXT_TO_IMAGE');
  const reviewed = reviewedPaidDerivedCapabilities.get(`${entry.provider}:${entry.model}`);
  if (paidDerivedOperations.length && !reviewed) {
    fail(`registry contains an unreviewed paid derived-image provider/model: ${entry.provider}:${entry.model}`);
  }
  if (reviewed && !reviewedPaidDerivedCapabilityMatches(entry, reviewed)) {
    fail(`reviewed paid derived-image capability drifted: ${entry.provider}:${entry.model}`);
  }
  if (
    paidDerivedOperations.length &&
    !['adapter-characterized', 'sandbox-verified'].includes(entry.evidenceLevel)
  ) {
    fail(`paid provider operation lacks an evidence classification: ${entry.provider}`);
  }
  if (
    paidDerivedOperations.length &&
    entry.evidenceLevel === 'sandbox-verified' &&
    !entry.evidence.toLowerCase().includes('sandbox')
  ) {
    fail(`paid provider sandbox capability is missing sandbox evidence: ${entry.provider}`);
  }
}

const matrix = fs.existsSync(matrixPath) ? fs.readFileSync(matrixPath, 'utf8') : '';
for (const required of [
  'adapter capability foundation',
  'dashscope-wanx',
  'openai-images',
  'qwen-mt-image',
  'threshold-policy scaffolds',
  'localhost/private',
]) {
  if (!matrix.toLowerCase().includes(required.toLowerCase()))
    fail(`provider matrix is missing ${required}`);
}

const policyFiles = fs
  .readdirSync(policyDir)
  .filter((name) => name.endsWith('.json') && name !== 'policy.schema.json');
if (policyFiles.length < 3) fail('at least three evaluation threshold policies are required');
for (const name of policyFiles) {
  try {
    const raw = fs.readFileSync(path.join(policyDir, name), 'utf8');
    const policy = JSON.parse(raw);
    if (
      !policy.id ||
      policy.kind !== 'evaluation-threshold-policy' ||
      policy.status !== 'policy_only'
    ) {
      fail(`${name} has invalid policy metadata`);
    }
    if (!policy.metric || typeof policy.metric !== 'object') fail(`${name} has invalid metric`);
    if (policy.containsSecrets !== false)
      fail(`${name} must explicitly declare containsSecrets=false`);
    if (/(?:"authorization"|"cookie"|"apiKey"|"accessToken"|"refreshToken")\s*:/iu.test(raw)) {
      fail(`${name} contains a secret-bearing field`);
    }
    const threshold = policy.metric.threshold?.value;
    const range = policy.metric.validRange;
    if (!Number.isFinite(threshold) || !range || threshold < range.minimum || threshold > range.maximum) {
      fail(`${name} has an invalid metric threshold`);
    }
  } catch (error) {
    fail(`${name} is not valid JSON: ${error.message}`);
  }
}

if (!process.exitCode) {
  console.log(
    `PASS AI media provider foundation contract (${capabilities.length} capabilities; ${policyFiles.length} threshold policies)`,
  );
}
