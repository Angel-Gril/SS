import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiImageWanxTrialCommand } from './ai-image-wanx-trial-prepare.js';
import { buildAiImageWanxTrialPreparation } from '../src/services/ai-image-wanx-trial-preparation.js';
import { buildAiImageWanxTrialInput } from '../src/services/ai-image-wanx-trial-input.js';
import { makeWanxTrialInputDraft, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson } from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

const revision = 'a'.repeat(40);
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('wanx-source-input-'));
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'wanx-source-input-'));
  roots.push(evidenceRoot);
  return { evidenceRoot, ...await makeWanxTrialInputDraft(evidenceRoot, revision) };
}

async function compile(value: Awaited<ReturnType<typeof fixture>>, extra = {}, resolveRevision = vi.fn(async () => revision)) {
  const inputPath = join(value.evidenceRoot, 'draft.json');
  const bytes = trialJson(value.request);
  await writeFile(inputPath, bytes, { mode: 0o600 });
  const before = await readdir(value.evidenceRoot);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const result = await runAiImageWanxTrialCommand('compile-input', {
      environment: {
        NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_EVIDENCE_ROOT: value.evidenceRoot,
        AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: value.request.roundId,
        AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
        AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: inputPath,
        AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes), ...extra,
      }, resolveRevision,
    });
    return { result, stdout: stdout.mock.calls.map((call) => String(call[0])).join(''), before, error: null };
  } catch (error) {
    return { result: null, stdout: stdout.mock.calls.map((call) => String(call[0])).join(''), before, error };
  } finally { stdout.mockRestore(); }
}

describe('Wanx trial input compilation', () => {
  it.each(['CRLF', 'mixed'] as const)('preserves pinned %s source bytes through compilation', async (lineEndings) => {
    const value = await fixture();
    const sources = [];
    for (const operation of value.request.operations) {
      const path = join(value.evidenceRoot, operation.templateSource.path);
      const text = await readFile(path, 'utf8');
      let line = 0;
      const bytes = Buffer.from(text.replace(/\n/gu, () =>
        lineEndings === 'CRLF' || line++ % 2 === 0 ? '\r\n' : '\n'));
      await writeFile(path, bytes, { mode: 0o600 });
      operation.templateSource.sha256 = trialDigest(bytes);
      sources.push(bytes);
    }
    const outcome = await compile(value);
    expect(outcome.error).toBeNull();
    expect(outcome.result).toMatchObject({ canSubmit: false, actualCost: null });
    const directory = join(value.evidenceRoot, `wanx-input-${value.request.roundId}`);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    for (const [index, operation] of value.request.operations.entries()) {
      const name = operation.operation === 'FULL_EDIT' ? 'full-edit-template.json' : 'inpaint-template.json';
      const stored = await readFile(join(directory, name));
      expect(stored).toEqual(sources[index]);
      expect(manifest.sourceBindings.find((binding: any) => binding.operation === operation.operation).sourceSha256)
        .toBe(trialDigest(stored));
    }
  });

  it('checks the source record digest instead of trusting a digest label on a different valid release', async () => {
    const value = await fixture();
    const sources = value.templateSources.map((record, index) => ({
      record: structuredClone(record), sha256: value.request.operations[index]!.templateSource.sha256,
      bytes: trialJson(record),
    }));
    sources[0]!.record.activeRelease.id = 'synthetic-replaced-release';
    sources[0]!.record.publicationRelease.id = 'synthetic-replaced-release';
    let code: string | null = null;
    try {
      buildAiImageWanxTrialInput({
        request: value.request, templateSources: sources,
        expected: { adapterRevision: revision, roundId: value.request.roundId,
          providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision },
      });
    } catch (error) { code = (error as { code: string }).code; }
    expect(code).toBe('WANX_TRIAL_TEMPLATE_SOURCE_MISMATCH');
  });

  it('compiles pinned published sources into the existing input and preserves its paid-wire fingerprint', async () => {
    const value = await fixture();
    const outcome = await compile(value);
    expect(outcome.error).toBeNull();
    expect(outcome.result).toMatchObject({
      event: 'AI_IMAGE_WANX_TRIAL_INPUT_COMPILED', canSubmit: false, actualCost: null,
      sourceVerification: 'OFFLINE_CONSISTENCY_ONLY', sourceAuthentication: 'REQUIRES_CAPTURE_REVIEW',
      requestCount: 2, allocatedMaximumCost: { currency: 'CNY', amount: 5, scale: 1 },
    });
    const directory = join(value.evidenceRoot, `wanx-input-${value.request.roundId}`);
    expect((await readdir(directory)).sort()).toEqual(['full-edit-template.json', 'inpaint-template.json', 'input.json', 'manifest.json']);
    const inputBytes = await readFile(join(directory, 'input.json'));
    const input = JSON.parse(inputBytes.toString());
    expect((outcome.result as any).inputSha256).toBe(trialDigest(inputBytes));
    expect(input.kind).toBe('WANX_EDIT_TRIAL_INPUT_V1');
    expect(input.operations[0].frozenPrompt).toMatchObject({
      templateReleaseId: value.templateSources[0]!.activeRelease.id,
      templateChecksum: value.templateSources[0]!.revision.checksum,
      templateSnapshot: { releaseId: value.templateSources[0]!.activeRelease.id, variableSchemaVersion: 1 },
    });
    expect(input.operations[0].frozenPrompt.resolvedPrompt).toContain('$& 和 {{user_prompt}}');
    for (const operation of input.operations) {
      expect(Array.from(operation.frozenPrompt.resolvedPrompt).length).toBeLessThanOrEqual(800);
      expect(operation.frozenPrompt.resolvedNegativePrompt).toBe('');
    }
    const expected = { adapterRevision: revision, roundId: input.roundId,
      providerAccountUidSha256: trialAccountDigest, credentialRevision: trialCredentialRevision };
    const original = await buildAiImageWanxTrialPreparation({
      request: value.originalInput, sourceInputSha256: trialDigest(trialJson(value.originalInput)),
      mediaRoot: value.evidenceRoot, expected,
    });
    const generated = await buildAiImageWanxTrialPreparation({
      request: input, sourceInputSha256: trialDigest(inputBytes), mediaRoot: value.evidenceRoot, expected,
    });
    expect(generated.manifest.bindings.map((item) => item.requestFingerprint))
      .toEqual(original.manifest.bindings.map((item) => item.requestFingerprint));
    expect(generated.manifest.requiredBeforeSubmit).toEqual(original.manifest.requiredBeforeSubmit);
    for (const privateValue of [value.evidenceRoot, value.request.operations[0]!.prompt, trialCredentialRevision,
      value.templateSources[0]!.activeRelease.id]) expect(outcome.stdout).not.toContain(privateValue);
  });

  it.each(['frozenPrompt', 'resolvedPrompt', 'templateSnapshot', 'approvedAt'])('rejects caller-supplied generated field %s before output', async (field) => {
    const value = await fixture();
    (value.request.operations[0] as any)[field] = 'must-not-trust';
    const result = await compile(value);
    expect(result.error).toMatchObject({ code: 'WANX_TRIAL_INPUT_INVALID' });
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it.each(['swapped source', 'source digest', 'source checksum', 'test status', 'authority field'])('rejects %s before output', async (change) => {
    const value = await fixture();
    const operation = value.request.operations[0]!;
    if (change === 'swapped source') operation.templateSource = value.request.operations[1]!.templateSource;
    else if (change === 'source digest') operation.templateSource.sha256 = '0'.repeat(64);
    else {
      const source = structuredClone(value.templateSources[0]) as any;
      if (change === 'source checksum') source.revision.checksum = '0'.repeat(64);
      if (change === 'test status') source.testRun.status = 'FAIL';
      if (change === 'authority field') source.workflowVerified = true;
      const bytes = trialJson(source);
      await writeFile(join(value.evidenceRoot, operation.templateSource.path), bytes, { mode: 0o600 });
      operation.templateSource.sha256 = trialDigest(bytes);
    }
    const result = await compile(value);
    expect(result.error).not.toBeNull();
    expect((result.error as any).code).not.toBe('WANX_TRIAL_CONFIG_INVALID');
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it.each(['wrong account', 'duplicate operation', 'over budget', 'empty prompt', 'overlong prompt', 'changed media'])('rejects %s before output', async (change) => {
    const value = await fixture();
    if (change === 'wrong account') value.request.providerAccountUidSha256 = '0'.repeat(64);
    if (change === 'duplicate operation') value.request.operations[1] = value.request.operations[0]!;
    if (change === 'over budget') for (const operation of value.request.operations) operation.maximumCost.amount = 60;
    if (change === 'empty prompt') value.request.operations[0]!.prompt = ' \n ';
    if (change === 'overlong prompt') value.request.operations[0]!.prompt = '画'.repeat(801);
    if (change === 'changed media') value.request.operations[0]!.source.sha256 = '0'.repeat(64);
    const result = await compile(value);
    expect(result.error).not.toBeNull();
    expect((result.error as any).code).not.toBe('WANX_TRIAL_CONFIG_INVALID');
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it('checks the source revision again before creating the compiled bundle', async () => {
    const value = await fixture();
    const resolver = vi.fn().mockResolvedValueOnce(revision).mockResolvedValue('b'.repeat(40));
    const result = await compile(value, {}, resolver);
    expect(result.error).toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it.each(['DASHSCOPE_API_KEY', 'AI_IMAGE_SANDBOX_CONFIRM', 'COOKIE'])('refuses %s before reading private inputs', async (name) => {
    const resolver = vi.fn();
    await expect(runAiImageWanxTrialCommand('compile-input', {
      environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-private-value' }, resolveRevision: resolver,
    })).rejects.toMatchObject({ code: 'WANX_TRIAL_UNSAFE_ENV' });
    expect(resolver).not.toHaveBeenCalled();
  });
});
