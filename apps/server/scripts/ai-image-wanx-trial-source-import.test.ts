import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiImageWanxTrialCommand } from './ai-image-wanx-trial-prepare.js';
import {
  makeWanxTemplateSourceCaptures, trialAccountDigest, trialCredentialRevision, trialDigest, trialJson,
} from '../src/__tests__/fixtures/ai-image-wanx-trial.js';

const revision = 'a'.repeat(40);
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    assert.equal(dirname(resolve(root)).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(root).startsWith('wanx-capture-import-'));
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const evidenceRoot = await mkdtemp(join(tmpdir(), 'wanx-capture-import-'));
  roots.push(evidenceRoot);
  return { evidenceRoot, ...await makeWanxTemplateSourceCaptures(evidenceRoot, revision, 'fixture-import-round-001') };
}

async function importSources(value: Awaited<ReturnType<typeof fixture>>, extra = {}, resolveRevision = vi.fn(async () => revision), lineEndings = 'LF') {
  const requestPath = join(value.evidenceRoot, 'source-captures.json');
  const json = trialJson(value.request);
  const bytes = lineEndings === 'CRLF' ? Buffer.from(json.toString().replace(/\n/gu, '\r\n')) : json;
  await writeFile(requestPath, bytes, { mode: 0o600 });
  const before = await readdir(value.evidenceRoot);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const result = await runAiImageWanxTrialCommand('import-sources', {
      environment: {
        NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_EVIDENCE_ROOT: value.evidenceRoot,
        AI_IMAGE_SANDBOX_TRIAL_ROUND_ID: value.request.roundId,
        AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: trialAccountDigest,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: trialCredentialRevision,
        AI_IMAGE_SANDBOX_ERP_ORIGIN: value.erpOrigin,
        AI_IMAGE_SANDBOX_TRIAL_INPUT_PATH: requestPath,
        AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: trialDigest(bytes), ...extra,
      }, resolveRevision,
    });
    return { result, error: null, stdout: stdout.mock.calls.map((call) => String(call[0])).join(''), before, bytes };
  } catch (error) {
    return { result: null, error, stdout: stdout.mock.calls.map((call) => String(call[0])).join(''), before, bytes };
  } finally { stdout.mockRestore(); }
}

function replaceBody(value: Awaited<ReturnType<typeof fixture>>, body: string | Buffer, index = 0) {
  const bytes = typeof body === 'string' ? Buffer.from(body) : body;
  value.request.captures[index]!.response.bodyBase64 = bytes.toString('base64');
  value.request.captures[index]!.response.bodySha256 = trialDigest(bytes);
}

describe('offline Wanx template source import', () => {
  it('imports two real route response bodies and binds their exact transformation without granting authenticity', async () => {
    const value = await fixture();
    const result = await importSources(value);
    expect(result.error).toBeNull();
    expect(result.result).toMatchObject({ event: 'AI_IMAGE_WANX_TEMPLATE_SOURCES_IMPORTED',
      canSubmit: false, actualCost: null, sourceVerification: 'OFFLINE_CONSISTENCY_ONLY',
      sourceAuthentication: 'REQUIRES_CAPTURE_REVIEW', captureCount: 2 });
    const directory = join(value.evidenceRoot, `wanx-sources-${value.request.roundId}`);
    expect((await readdir(directory)).sort()).toEqual([
      'captures.json', 'full-edit-response.json', 'full-edit-template.json',
      'inpaint-response.json', 'inpaint-template.json', 'manifest.json',
    ]);
    expect(await readFile(join(directory, 'captures.json'))).toEqual(result.bytes);
    const manifestBytes = await readFile(join(directory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes.toString());
    expect(result.result).toMatchObject({ manifestSha256: trialDigest(manifestBytes) });
    for (const capture of value.request.captures) {
      const prefix = capture.templateKey === 'full-image-edit.base' ? 'full-edit' : 'inpaint';
      const raw = await readFile(join(directory, `${prefix}-response.json`));
      const source = await readFile(join(directory, `${prefix}-template.json`));
      expect(raw).toEqual(Buffer.from(capture.response.bodyBase64, 'base64'));
      expect(source).toEqual(trialJson(JSON.parse(raw.toString()).data));
      expect(manifest.sources.find((item: any) => item.templateKey === capture.templateKey))
        .toMatchObject({ responseBodySha256: trialDigest(raw),
          templateSource: { path: `wanx-sources-${value.request.roundId}/${prefix}-template.json`, sha256: trialDigest(source) },
          requestUrlSha256: trialDigest(capture.request.url), collectorRefSha256: trialDigest(capture.collectorRef) });
    }
    for (const privateValue of [value.evidenceRoot, value.erpOrigin, 'synthetic-source-collector',
      value.draft.templateSources[0]!.activeRelease.id, value.request.captures[0]!.response.bodyBase64]) {
      expect(result.stdout).not.toContain(privateValue);
    }
    expect(await readdir(value.evidenceRoot)).not.toContain('execution');
  });

  it.each(['code', 'sequence'])('rejects a lossy numeric %s token before importing evidence', async (field) => {
    const value = await fixture();
    const body = Buffer.from(value.request.captures[0]!.response.bodyBase64, 'base64').toString();
    replaceBody(value, body.replace(new RegExp(`"${field}":(\\d+)`, 'g'), `"${field}":$1.0000000000000001`));
    const result = await importSources(value);
    expect(result.error).toMatchObject({ code: 'WANX_TEMPLATE_SOURCE_CAPTURE_INVALID' });
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it.each(['pretty CRLF', 'escaped Unicode'])('preserves valid %s HTTP bytes while exporting canonical data', async (format) => {
    const value = await fixture();
    const original = Buffer.from(value.request.captures[0]!.response.bodyBase64, 'base64').toString();
    const changed = format === 'pretty CRLF' ? JSON.stringify(JSON.parse(original), null, 4).replace(/\n/gu, '\r\n') + '\r\n'
      : original.replace('"code"', '"\\u0063ode"');
    replaceBody(value, changed);
    const result = await importSources(value);
    expect(result.error).toBeNull();
    const directory = join(value.evidenceRoot, `wanx-sources-${value.request.roundId}`);
    expect(await readFile(join(directory, 'full-edit-response.json'))).toEqual(Buffer.from(changed));
    expect(await readFile(join(directory, 'full-edit-template.json'))).toEqual(trialJson(JSON.parse(original).data));
  });

  it('retains the pinned outer capture record with its original CRLF bytes', async () => {
    const value = await fixture();
    const result = await importSources(value, {}, undefined, 'CRLF');
    expect(result.error).toBeNull();
    const directory = join(value.evidenceRoot, `wanx-sources-${value.request.roundId}`);
    expect(await readFile(join(directory, 'captures.json'))).toEqual(result.bytes);
    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')).capturesSha256).toBe(trialDigest(result.bytes));
  });

  it.each(['http://erp-source.fixture.invalid', 'https://erp-source.fixture.invalid/',
    'https://synthetic:secret@erp-source.fixture.invalid', 'https://erp-source.fixture.invalid?override=1',
    'https://erp-source.fixture.invalid#fragment'])('rejects a noncanonical selected origin %s', async (origin) => {
    const value = await fixture();
    const result = await importSources(value, { AI_IMAGE_SANDBOX_ERP_ORIGIN: origin });
    expect(result.error).toMatchObject({ code: 'WANX_TEMPLATE_SOURCE_CAPTURE_INVALID' });
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it.each([
    'wrong origin', 'query', 'userinfo', 'wrong endpoint', 'wrong method', 'wrong status', 'html',
    'response digest', 'noncanonical base64', 'invalid UTF-8', 'BOM', 'oversize body',
    'duplicate key', 'escaped duplicate key', 'nested duplicate key', 'deep body', 'truncated escape',
    'failed response', 'untrusted header', 'approval field', 'swapped body', 'missing capture', 'duplicate capture',
    'future capture', 'before publication', 'wrong revision', 'broken publish chain',
  ])('rejects %s before creating any imported bundle', async (change) => {
    const value = await fixture();
    const capture = value.request.captures[0]!;
    const original = Buffer.from(capture.response.bodyBase64, 'base64').toString();
    if (change === 'wrong origin') capture.request.url = capture.request.url.replace(value.erpOrigin, 'https://other.fixture.invalid');
    if (change === 'query') capture.request.url += '?revisionId=override';
    if (change === 'userinfo') capture.request.url = capture.request.url.replace('https://', 'https://synthetic-secret@');
    if (change === 'wrong endpoint') capture.request.url = `${value.erpOrigin}/api/admin/ai-prompt-templates`;
    if (change === 'wrong method') capture.request.method = 'POST';
    if (change === 'wrong status') capture.response.httpStatus = 302;
    if (change === 'html') capture.response.contentType = 'text/html';
    if (change === 'response digest') capture.response.bodySha256 = '0'.repeat(64);
    if (change === 'noncanonical base64') capture.response.bodyBase64 += '\n';
    if (change === 'invalid UTF-8') replaceBody(value, Buffer.from([0xc3, 0x28]));
    if (change === 'BOM') replaceBody(value, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(original)]));
    if (change === 'oversize body') replaceBody(value, Buffer.alloc(256 * 1024 + 1, ' '));
    if (change === 'duplicate key') replaceBody(value, original.replace('{', '{"code":0,'));
    if (change === 'escaped duplicate key') replaceBody(value, original.replace('{', '{"\\u0063ode":0,'));
    if (change === 'nested duplicate key') replaceBody(value, original.replace('"status":"PASS"', '"status":"FAIL","status":"PASS"'));
    if (change === 'deep body') replaceBody(value, '{"code":1,"msg":"ok","data":' + '['.repeat(14) + '0' + ']'.repeat(14) + '}');
    if (change === 'truncated escape') replaceBody(value, '{"code":1,"msg":"' + '\\\"'.repeat(8_000));
    if (change === 'failed response') replaceBody(value, JSON.stringify({ ...JSON.parse(original), code: 0 }));
    if (change === 'untrusted header') (capture.request as any).headers = { Cookie: 'synthetic-session-cookie' };
    if (change === 'approval field') (value.request as any).sourceAuthentication = 'VERIFIED';
    if (change === 'swapped body') capture.response = { ...value.request.captures[1]!.response };
    if (change === 'missing capture') value.request.captures.pop();
    if (change === 'duplicate capture') value.request.captures[1] = structuredClone(capture);
    if (change === 'future capture') capture.capturedAt = new Date(Date.now() + 10 * 60_000).toISOString();
    if (change === 'before publication') capture.capturedAt = '2000-01-01T00:00:00.000Z';
    if (change === 'wrong revision') value.request.adapterRevision = 'b'.repeat(40);
    if (change === 'broken publish chain') {
      const envelope = JSON.parse(original);
      envelope.data.testRun.revisionChecksum = '0'.repeat(64);
      replaceBody(value, JSON.stringify(envelope));
    }
    const result = await importSources(value);
    expect(result.error).not.toBeNull();
    expect(['WANX_TEMPLATE_SOURCE_CAPTURE_INVALID', 'TEMPLATE_SOURCE_CONFLICT']).toContain((result.error as any).code);
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it('rejects a capture-file digest mismatch without exporting sources', async () => {
    const value = await fixture();
    const result = await importSources(value, { AI_IMAGE_SANDBOX_TRIAL_INPUT_SHA256: '0'.repeat(64) });
    expect(result.error).toMatchObject({ code: 'SANDBOX_BILLING_DIGEST_MISMATCH' });
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it('rejects code drift before writing the imported bundle', async () => {
    const value = await fixture();
    const resolver = vi.fn().mockResolvedValueOnce(revision).mockResolvedValue('b'.repeat(40));
    const result = await importSources(value, {}, resolver);
    expect(result.error).toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(result.stdout).toBe('');
    expect(await readdir(value.evidenceRoot)).toEqual(result.before);
  });

  it('preserves an existing imported bundle instead of overwriting its evidence', async () => {
    const value = await fixture();
    expect((await importSources(value)).error).toBeNull();
    const directory = join(value.evidenceRoot, `wanx-sources-${value.request.roundId}`);
    const before = await Promise.all((await readdir(directory)).map(async (name) => [name, trialDigest(await readFile(join(directory, name)))]));
    const result = await importSources(value);
    expect(result.error).toMatchObject({ code: 'SANDBOX_BILLING_FILE_UNSAFE' });
    expect(result.stdout).toBe('');
    expect(await Promise.all((await readdir(directory)).map(async (name) => [name, trialDigest(await readFile(join(directory, name)))]))).toEqual(before);
  });

  it.each(['DASHSCOPE_API_KEY', 'COOKIE', 'AI_IMAGE_SANDBOX_CONFIRM'])('rejects %s before reading capture files', async (name) => {
    const resolver = vi.fn();
    await expect(runAiImageWanxTrialCommand('import-sources', {
      environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-secret' }, resolveRevision: resolver,
    })).rejects.toMatchObject({ code: 'WANX_TRIAL_UNSAFE_ENV' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(['AI_IMAGE_SANDBOX_APPROVAL_PATH', 'AI_IMAGE_SANDBOX_OPERATION', 'AI_IMAGE_SANDBOX_BASE_URL', 'AI_IMAGE_SANDBOX_TRIAL_MANIFEST_SHA256'])(
    'rejects mixed %s before Git or capture access', async (name) => {
      const resolver = vi.fn();
      await expect(runAiImageWanxTrialCommand('import-sources', {
        environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-override' }, resolveRevision: resolver,
      })).rejects.toMatchObject({ code: 'WANX_TRIAL_CONFIG_INVALID' });
      expect(resolver).not.toHaveBeenCalled();
    },
  );

  it.each(['prepare', 'verify', 'compile-input', 'approval-draft'] as const)('rejects capture-origin settings in %s mode', async (mode) => {
    const resolver = vi.fn();
    await expect(runAiImageWanxTrialCommand(mode, {
      environment: { NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_ERP_ORIGIN: 'https://erp-source.fixture.invalid' }, resolveRevision: resolver,
    })).rejects.toMatchObject({ code: 'WANX_TRIAL_CONFIG_INVALID' });
    expect(resolver).not.toHaveBeenCalled();
  });
});
