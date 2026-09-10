import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAiImageWanxTrialPreparation, prepareAiImageWanxTrial, verifyAiImageWanxTrial,
} from '../services/ai-image-wanx-trial-preparation.js';
import { loadAiImageSandboxApproval } from '../services/ai-image-sandbox-approval.js';
import { createAiImageSandboxRequestFingerprint } from '../services/ai-image-sandbox-guard.js';
import {
  makeWanxTrialInput, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson,
} from './fixtures/ai-image-wanx-trial.js';

const directories: string[] = [];
const revision = 'a'.repeat(40);
type TrialRequest = Awaited<ReturnType<typeof makeWanxTrialInput>>;

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wanx-trial-owner-'));
  directories.push(root);
  const evidenceRoot = join(root, 'private');
  await mkdir(evidenceRoot, { mode: 0o700 });
  const request = await makeWanxTrialInput(evidenceRoot, revision);
  const expected = {
    roundId: request.roundId, adapterRevision: revision,
    providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision,
  };
  const common = { repositoryRoot: root, evidenceRoot, expected, assertRevision: async () => undefined };
  const build = (value: unknown = request) => buildAiImageWanxTrialPreparation({
    request: value, sourceInputSha256: trialDigest(trialJson(value)), mediaRoot: evidenceRoot, expected,
  });
  const prepare = async (value: unknown = request, assertRevision = common.assertRevision) => {
    const bytes = trialJson(value);
    const requestPath = join(evidenceRoot, 'input.json');
    await writeFile(requestPath, bytes, { mode: 0o600 });
    return prepareAiImageWanxTrial({ ...common, assertRevision, requestPath, requestSha256: trialDigest(bytes) });
  };
  return { root, evidenceRoot, request, common, expected, build, prepare, directory: join(evidenceRoot, `wanx-trial-${request.roundId}`) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(target).startsWith('wanx-trial-owner-'));
    await rm(target, { recursive: true, force: true });
  }
});

describe('frozen Wanx trial preparation owner', () => {
  it('keeps original prompt text, source bytes and the existing paid-wire fingerprint without granting execution', async () => {
    const value = await fixture();
    const sourceBefore = await readFile(join(value.evidenceRoot, 'inputs/source.png'));
    const result = await value.build();
    expect(result.manifest.request.operations[0]!.frozenPrompt).toEqual(value.request.operations[0]!.frozenPrompt);
    expect(result.files.find((file) => file.name === 'full-edit-source.png')!.bytes).toEqual(sourceBefore);
    expect(await readFile(join(value.evidenceRoot, 'inputs/source.png'))).toEqual(sourceBefore);
    expect(result.manifest).toMatchObject({ canSubmit: false, actualCost: null, sourceVerification: 'OFFLINE_CONSISTENCY_ONLY' });
    const binding = result.manifest.bindings[0]!;
    expect(binding.requestFingerprint).toBe(createAiImageSandboxRequestFingerprint({
      endpointSha256: trialDigest(`${value.request.apiBase}/services/aigc/image2image/image-synthesis`),
      model: value.request.model,
      request: {
        operation: 'FULL_EDIT', requestProfile: binding.requestProfile,
        providerTransport: binding.providerTransport, providerFunction: 'description_edit',
        n: 1, size: '1024x1024', promptSha256: trialDigest(value.request.operations[0]!.frozenPrompt.resolvedPrompt),
        sourceSha256: [trialDigest(sourceBefore)], maskSha256: null,
      },
    }));
    expect(result.manifest.requiredBeforeSubmit).toContain('DURABLE_ROUND_AND_OPERATION_EXECUTION_CLAIMS');
    expect(result.manifest.requiredBeforeSubmit).toContain('TRUSTED_TASK_TO_SETTLED_BILL_LINK');
  });

  it('adds maxima with different exact scales and accepts a total of exactly one yuan', async () => {
    const value = await fixture();
    value.request.operations[0]!.quotedCost = { currency: 'CNY', amount: 1, scale: 1 };
    value.request.operations[0]!.maximumCost = { currency: 'CNY', amount: 3, scale: 1 };
    value.request.operations[1]!.maximumCost = { currency: 'CNY', amount: 70, scale: 2 };
    expect((await value.build()).manifest.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 1, scale: 0 });
  });

  it('rejects an excess of one hundred-millionth of a yuan instead of rounding it away', async () => {
    const value = await fixture();
    value.request.operations[0]!.maximumCost.amount = 50;
    value.request.operations[1]!.quotedCost = { currency: 'CNY', amount: 14_000_000, scale: 8 };
    value.request.operations[1]!.maximumCost = { currency: 'CNY', amount: 50_000_001, scale: 8 };
    await expect(value.build()).rejects.toMatchObject({ code: 'WANX_TRIAL_BUDGET_INVALID' });
  });

  it.each([
    ['wrong currency', (request: TrialRequest) => { request.operations[0]!.maximumCost.currency = 'USD'; }],
    ['negative maximum', (request: TrialRequest) => { request.operations[0]!.maximumCost.amount = -1; }],
    ['zero maximum', (request: TrialRequest) => { request.operations[0]!.maximumCost.amount = 0; }],
    ['quote exceeds maximum', (request: TrialRequest) => { request.operations[0]!.quotedCost.amount = 26; }],
    ['unsafe amount', (request: TrialRequest) => { request.operations[0]!.maximumCost.amount = Number.MAX_SAFE_INTEGER + 1; }],
    ['fractional amount', (request: TrialRequest) => { request.operations[0]!.maximumCost.amount = 25.5; }],
    ['excess precision', (request: TrialRequest) => { request.operations[0]!.maximumCost.scale = 9; }],
    ['changed round ceiling', (request: TrialRequest) => { request.maximumCost.amount = 2; }],
  ])('rejects %s without creating a round', async (_name, change) => {
    const value = await fixture();
    change(value.request);
    await expect(value.prepare()).rejects.toMatchObject({ code: 'WANX_TRIAL_BUDGET_INVALID' });
    expect(await readdir(value.evidenceRoot)).not.toContain(basename(value.directory));
  });

  it.each([
    ['duplicate operation', (request: TrialRequest) => { request.operations[1]!.operation = 'FULL_EDIT'; }],
    ['duplicate operation ID', (request: TrialRequest) => { request.operations[1]!.operationId = request.operations[0]!.operationId; }],
    ['wrong model', (request: TrialRequest) => { request.model = 'another-model'; }],
    ['unbound workspace endpoint', (request: TrialRequest) => { request.apiBase = 'https://fixture.cn-beijing.maas.aliyuncs.com/api/v1'; }],
    ['missing inpaint mask', (request: TrialRequest) => { request.operations[1]!.mask = null; }],
    ['full edit with mask', (request: TrialRequest) => { request.operations[0]!.mask = request.operations[1]!.mask; }],
  ])('rejects %s', async (_name, change) => {
    const value = await fixture();
    change(value.request);
    await expect(value.build()).rejects.toMatchObject({ code: 'WANX_TRIAL_INPUT_INVALID' });
  });

  it.each(['roundId', 'adapterRevision', 'providerAccountUidSha256', 'credentialRevision'] as const)(
    'rejects a different independently selected %s', async (key) => {
      const value = await fixture();
      const changed = key === 'providerAccountUidSha256' ? 'b'.repeat(64)
        : key === 'adapterRevision' ? 'b'.repeat(40) : 'different-reference';
      await expect(buildAiImageWanxTrialPreparation({
        request: value.request, sourceInputSha256: trialDigest(trialJson(value.request)),
        mediaRoot: value.evidenceRoot, expected: { ...value.expected, [key]: changed },
      })).rejects.toMatchObject({ code: 'WANX_TRIAL_BINDING_MISMATCH' });
    },
  );

  it.each(['templateReleaseId', 'templateChecksum', 'prompt', 'resolvedPrompt'] as const)(
    'rejects a changed frozen %s', async (key) => {
      const value = await fixture();
      value.request.operations[0]!.frozenPrompt[key] = key === 'templateChecksum' ? 'b'.repeat(64) : 'changed-value';
      await expect(value.build()).rejects.toMatchObject({ code: 'FROZEN_PROMPT_MISMATCH' });
    },
  );

  it('does not create a new paid-wire identity by changing round, operation labels, release or credential metadata', async () => {
    const value = await fixture();
    const original = await value.build();
    const request = structuredClone(value.request);
    request.roundId = 'another-round-001';
    request.credentialRevision = 'synthetic-wanx-key-r2';
    for (const operation of request.operations) {
      operation.operationId += '-new';
      operation.frozenPrompt.templateReleaseId = 'synthetic-other-release';
      operation.frozenPrompt.templateSnapshot.releaseId = 'synthetic-other-release';
    }
    const changed = await buildAiImageWanxTrialPreparation({
      request, sourceInputSha256: trialDigest(trialJson(request)), mediaRoot: value.evidenceRoot,
      expected: { ...value.expected, roundId: request.roundId, credentialRevision: request.credentialRevision },
    });
    expect(changed.manifestSha256).not.toBe(original.manifestSha256);
    expect(changed.manifest.bindings.map((item) => item.requestFingerprint)).toEqual(original.manifest.bindings.map((item) => item.requestFingerprint));
    expect(changed.manifest.sourceVerification).toBe('OFFLINE_CONSISTENCY_ONLY');
    expect(changed.manifest.canSubmit).toBe(false);
  });

  it.each(['../outside.png', '/absolute.png', 'https://example.invalid/source.png', 'inputs/../source.png', 'inputs\\source.png'])(
    'rejects unsafe media path %s', async (path) => {
      const value = await fixture();
      value.request.operations[0]!.source.path = path;
      await expect(value.build()).rejects.toMatchObject({ code: 'WANX_TRIAL_MEDIA_UNSAFE' });
    },
  );

  it('rejects a source reached through a directory junction', async () => {
    const value = await fixture();
    await symlink(join(value.evidenceRoot, 'inputs'), join(value.evidenceRoot, 'alias'), 'junction');
    value.request.operations[0]!.source.path = 'alias/source.png';
    await expect(value.build()).rejects.toMatchObject({ code: 'WANX_TRIAL_MEDIA_UNSAFE' });
  });

  it('rejects a valid but unsupported canvas before writing anything', async () => {
    const value = await fixture();
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#fff' } }).png().toBuffer();
    await writeFile(join(value.evidenceRoot, 'inputs/source.png'), bytes, { mode: 0o600 });
    value.request.operations[0]!.source.sha256 = trialDigest(bytes);
    await expect(value.prepare()).rejects.toMatchObject({ code: 'WANX_TRIAL_MEDIA_INVALID' });
    expect(await readdir(value.evidenceRoot)).not.toContain(basename(value.directory));
  });

  it('retains one immutable round when two preparers race and never overwrites it on a later attempt', async () => {
    const value = await fixture();
    const bytes = trialJson(value.request);
    const requestPath = join(value.evidenceRoot, 'input.json');
    await writeFile(requestPath, bytes, { mode: 0o600 });
    const options = { ...value.common, requestPath, requestSha256: trialDigest(bytes) };
    const results = await Promise.allSettled([prepareAiImageWanxTrial(options), prepareAiImageWanxTrial(options)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const persisted = await readFile(join(value.directory, 'manifest.json'));
    value.request.operations[0]!.maximumCost.amount = 30;
    await expect(value.prepare()).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });
    expect(await readFile(join(value.directory, 'manifest.json'))).toEqual(persisted);
    const verified = await verifyAiImageWanxTrial({ ...value.common, manifestSha256: trialDigest(persisted) });
    expect(verified.manifest.allocatedMaximumCost).toEqual({ currency: 'CNY', amount: 5, scale: 1 });
    expect((await readdir(value.directory)).sort()).toEqual(['full-edit-source.png', 'inpaint-mask.png', 'inpaint-source.png', 'manifest.json']);
  });

  it('retains copied inputs for verification even after the original source files are changed', async () => {
    const value = await fixture();
    const result = await value.prepare();
    await writeFile(join(value.evidenceRoot, 'inputs/source.png'), 'changed original fixture');
    const verified = await verifyAiImageWanxTrial({ ...value.common, manifestSha256: result.manifestSha256 });
    expect(verified.manifestSha256).toBe(result.manifestSha256);
  });

  it('does not resume or overwrite a partial preparation directory', async () => {
    const value = await fixture();
    await mkdir(value.directory, { mode: 0o700 });
    const original = Buffer.from('synthetic interrupted preparation');
    await writeFile(join(value.directory, 'full-edit-source.png'), original, { mode: 0o600 });
    await expect(value.prepare()).rejects.toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });
    expect(await readdir(value.directory)).toEqual(['full-edit-source.png']);
    expect(await readFile(join(value.directory, 'full-edit-source.png'))).toEqual(original);
  });

  it('rejects a modified retained image even when the manifest itself still has its approved digest', async () => {
    const value = await fixture();
    const result = await value.prepare();
    await writeFile(join(value.directory, 'full-edit-source.png'), 'modified retained fixture');
    await expect(verifyAiImageWanxTrial({ ...value.common, manifestSha256: result.manifestSha256 }))
      .rejects.toMatchObject({ code: 'SANDBOX_MEDIA_INVALID' });
  });

  it.each([
    { canSubmit: true }, { actualCost: { currency: 'CNY', amount: 0, scale: 0 } },
    { allocatedMaximumCost: { currency: 'CNY', amount: 0, scale: 0 } },
    { requiredBeforeSubmit: [] }, { bindings: [] },
  ])('recomputes constraints instead of trusting changed manifest assertions: %j', async (change) => {
    const value = await fixture();
    const result = await value.prepare();
    const modified = { ...result.manifest, ...change };
    const bytes = trialJson(modified);
    await writeFile(join(value.directory, 'manifest.json'), bytes, { mode: 0o600 });
    await expect(verifyAiImageWanxTrial({ ...value.common, manifestSha256: trialDigest(bytes) }))
      .rejects.toMatchObject({ code: 'WANX_TRIAL_MANIFEST_MISMATCH' });
  });

  it('rejects results, approvals and zero-cost assertions in the closed preparation input', async () => {
    const value = await fixture();
    for (const extra of [{ canSubmit: true }, { actualCost: 0 }, { approval: 'approved' }, { results: [{ status: 'FAILED', released: true }] }]) {
      await expect(value.build({ ...value.request, ...extra })).rejects.toMatchObject({ code: 'WANX_TRIAL_INPUT_INVALID' });
    }
  });

  it('does not write a round if its code revision check fails after input validation', async () => {
    const value = await fixture();
    await expect(value.prepare(value.request, async () => { throw Object.assign(new Error('synthetic revision drift'), { code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' }); }))
      .rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(await readdir(value.evidenceRoot)).not.toContain(basename(value.directory));
  });

  it('cannot be loaded as a one-request paid approval', async () => {
    const value = await fixture();
    const result = await value.prepare();
    await expect(loadAiImageSandboxApproval({
      repositoryRoot: value.root,
      approvalPath: join(value.directory, 'manifest.json'), expectedSha256: result.manifestSha256,
      expected: {
        operationId: value.request.operations[0]!.operationId,
        endpoint: `${value.request.apiBase}/services/aigc/image2image/image-synthesis`,
        expectedHost: 'dashscope.aliyuncs.com', model: value.request.model, operation: 'FULL_EDIT',
        requestProfile: 'DASHSCOPE_WANX21_FULL_EDIT_ASYNC_V1', credentialRevision: trialCredentialRevision,
        adapterRevision: revision, sourceSha256: [value.request.operations[0]!.source.sha256], maskSha256: null,
        quotedCost: value.request.operations[0]!.quotedCost, maximumCost: value.request.operations[0]!.maximumCost,
      },
    })).rejects.toMatchObject({ code: 'SANDBOX_APPROVAL_SCHEMA_INVALID' });
  });
});
