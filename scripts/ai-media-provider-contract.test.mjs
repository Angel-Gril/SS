import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { reviewedPaidDerivedCapabilityMatches } from './sandbox/ai-media-provider-review.mjs';

const exactEvidence = {
  endpointSha256: 'a'.repeat(64),
  operation: 'IMAGE_TO_IMAGE',
  inputTransport: 'multipart',
  resultMode: 'sync',
};
const textEvidence = {
  endpointSha256: 'a'.repeat(64),
  operation: 'TEXT_TO_IMAGE',
  inputTransport: 'none',
  resultMode: 'sync',
};
const sandboxCapability = {
  provider: 'custom',
  model: 'reviewed-edit-model',
  operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'],
  inputTransport: 'multipart',
  resultMode: 'sync',
  maxReferences: 1,
  supportsMask: false,
  evidenceLevel: 'sandbox-verified',
  sandboxEvidence: [textEvidence, exactEvidence],
};
const reviewedCapability = {
  operations: new Set(['IMAGE_TO_IMAGE']),
  inputTransport: 'multipart',
  resultMode: 'sync',
  maxReferences: 1,
  supportsMask: false,
  sandboxEvidence: new Set([
    `${textEvidence.endpointSha256}:TEXT_TO_IMAGE:none:sync`,
    `${exactEvidence.endpointSha256}:IMAGE_TO_IMAGE:multipart:sync`,
  ]),
};

assert.equal(
  reviewedPaidDerivedCapabilityMatches(sandboxCapability, reviewedCapability),
  true,
);
for (const [field, value] of [
  ['endpointSha256', 'b'.repeat(64)],
  ['operation', 'FULL_EDIT'],
  ['inputTransport', 'base64'],
  ['resultMode', 'async'],
]) {
  assert.equal(
    reviewedPaidDerivedCapabilityMatches(
      {
        ...sandboxCapability,
        sandboxEvidence: [textEvidence, { ...exactEvidence, [field]: value }],
      },
      reviewedCapability,
    ),
    false,
    `reviewed sandbox capability must reject ${field} evidence drift`,
  );
}
for (const [label, capability] of [
  ['empty evidence', { ...sandboxCapability, sandboxEvidence: [] }],
  ['duplicate evidence', {
    ...sandboxCapability,
    sandboxEvidence: [textEvidence, exactEvidence, exactEvidence],
  }],
  ['unknown operation evidence', {
    ...sandboxCapability,
    sandboxEvidence: [textEvidence, exactEvidence, { ...exactEvidence, operation: 'FULL_EDIT' }],
  }],
  ['duplicate operation', {
    ...sandboxCapability,
    operations: ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'IMAGE_TO_IMAGE'],
  }],
]) {
  assert.equal(
    reviewedPaidDerivedCapabilityMatches(capability, reviewedCapability),
    false,
    `reviewed sandbox capability must reject ${label}`,
  );
}

const root = process.cwd();
const wanxCapability = {
  provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
  operations: ['FULL_EDIT', 'INPAINT'], inputTransport: 'base64', resultMode: 'async',
  maxReferences: 1, supportsMask: true, evidenceLevel: 'adapter-characterized',
};
const reviewedWanx = {
  operations: new Set(['FULL_EDIT', 'INPAINT']), inputTransport: 'base64', resultMode: 'async',
  maxReferences: 1, supportsMask: true, sandboxEvidence: null, allowTextToImage: false,
};
assert.equal(reviewedPaidDerivedCapabilityMatches(wanxCapability, reviewedWanx), true);
for (const [label, changed] of [
  ['text-to-image inheritance', { operations: ['TEXT_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] }],
  ['unreviewed image-to-image', { operations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] }],
  ['wrong transport', { inputTransport: 'multipart' }],
  ['wrong result mode', { resultMode: 'sync' }],
  ['extra reference', { maxReferences: 2 }],
  ['missing mask support', { supportsMask: false }],
  ['unreviewed paid promotion', { evidenceLevel: 'sandbox-verified', sandboxEvidence: [{
    endpointSha256: 'a'.repeat(64), operation: 'FULL_EDIT', inputTransport: 'base64', resultMode: 'async',
  }] }],
]) {
  assert.equal(reviewedPaidDerivedCapabilityMatches({ ...wanxCapability, ...changed }, reviewedWanx), false,
    `Wanx characterized contract must reject ${label}`);
}
assert.equal(reviewedPaidDerivedCapabilityMatches(wanxCapability, undefined), false);
for (const evidenceLevel of [undefined, 'local-test', 'unknown']) {
  assert.equal(reviewedPaidDerivedCapabilityMatches({ ...wanxCapability, evidenceLevel }, reviewedWanx), false,
    'paid capability review must reject an invalid evidence classification');
}

const wanxEndpoint = createHash('sha256').update('https://dashscope.aliyuncs.com/api/v1').digest('hex');
const verifiedWanx = {
  ...wanxCapability,
  operations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'],
  evidenceLevel: 'sandbox-verified',
  evidence: 'Official Beijing create/poll/download transport verified; visual quality and supplier settlement remain separate.',
  sandboxEvidence: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].map((operation) => ({
    endpointSha256: wanxEndpoint, operation, inputTransport: 'base64', resultMode: 'async',
  })),
};
const reviewedVerifiedWanx = {
  ...reviewedWanx,
  operations: new Set(['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']),
  sandboxEvidence: new Set([
    `${wanxEndpoint}:IMAGE_TO_IMAGE:base64:async`,
    `${wanxEndpoint}:FULL_EDIT:base64:async`,
    `${wanxEndpoint}:INPAINT:base64:async`,
  ]),
};
assert.equal(reviewedPaidDerivedCapabilityMatches(verifiedWanx, reviewedVerifiedWanx), true);
for (const [label, changed] of [
  ['lost classification', { evidenceLevel: 'adapter-characterized' }],
  ['missing operation evidence', { sandboxEvidence: verifiedWanx.sandboxEvidence.slice(0, 1) }],
  ['duplicate evidence', { sandboxEvidence: [...verifiedWanx.sandboxEvidence, verifiedWanx.sandboxEvidence[0]] }],
  ['missing independent image-to-image evidence', {
    sandboxEvidence: verifiedWanx.sandboxEvidence.filter((evidence) => evidence.operation !== 'IMAGE_TO_IMAGE'),
  }],
  ['text evidence substituted for image-to-image', { sandboxEvidence: verifiedWanx.sandboxEvidence.map((evidence) => (
    evidence.operation === 'IMAGE_TO_IMAGE' ? { ...evidence, operation: 'TEXT_TO_IMAGE', inputTransport: 'none' } : evidence
  )) }],
  ['unknown operation', { operations: ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT', 'IMAGE_TRANSLATE'] }],
  ['text inheritance', { operations: ['TEXT_TO_IMAGE', 'FULL_EDIT', 'INPAINT'] }],
  ['different domain', { sandboxEvidence: verifiedWanx.sandboxEvidence.map((evidence) => ({
    ...evidence,
    endpointSha256: createHash('sha256').update('https://other.cn-beijing.maas.aliyuncs.com/api/v1').digest('hex'),
  })) }],
  ['wrong wire transport', { sandboxEvidence: verifiedWanx.sandboxEvidence.map((evidence) => ({ ...evidence, inputTransport: 'multipart' })) }],
  ['wrong result mode', { sandboxEvidence: verifiedWanx.sandboxEvidence.map((evidence) => ({ ...evidence, resultMode: 'sync' })) }],
]) {
  assert.equal(reviewedPaidDerivedCapabilityMatches({ ...verifiedWanx, ...changed }, reviewedVerifiedWanx), false,
    `reviewed official Wanx transport must reject ${label}`);
}
const script = path.join(root, 'scripts', 'sandbox', 'ai-media-provider-contract.mjs');
const output = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
assert.match(output, /PASS AI media provider foundation contract/);
console.log('PASS AI media provider contract test');
