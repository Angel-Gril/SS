import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAiImageProviderSingleSubmit } from './ai-image-provider-single-submit.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('single-submit AI image sandbox runner', () => {
  it('rejects a declared adapter revision that differs from the deployed commit', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    await writeFile(join(path, 'DEPLOYED_COMMIT'), `${'a'.repeat(40)}\n`);
    const fetch = vi.fn();

    await expect(runAiImageProviderSingleSubmit({
      environment: {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: 'sandbox-adapter-mismatch-0001',
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0001',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: 'b'.repeat(40),
        AI_IMAGE_SANDBOX_OPERATION: 'TEXT_TO_IMAGE',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      },
      repositoryRoot: path,
      outputDirectory: join(path, 'evidence'),
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('writes endpoint-digest-only success evidence with private file modes', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();
    const result = await sharp({
      create: {
        width: 3,
        height: 3,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    }).png().toBuffer();
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    const operationId = 'sandbox-edit-success-0001';
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      id: 'provider-success-id-1',
      data: [{ b64_json: result.toString('base64') }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const report = await runAiImageProviderSingleSubmit({
      environment: {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0003',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        AI_IMAGE_SANDBOX_OPERATION: 'FULL_EDIT',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_SOURCE_PATH: 'source.png',
        AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      },
      outputDirectory: path,
      repositoryRoot: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    });

    expect(report).toMatchObject({ state: 'SUCCEEDED', operationId, createRequests: 1 });
    const reportPath = join(path, `${operationId}.report.json`);
    const storedReport = await readFile(reportPath, 'utf8');
    const intentPath = join(path, 'intents', `${operationId}.intent.json`);
    const storedIntent = await readFile(intentPath, 'utf8');
    expect(JSON.parse(storedReport)).not.toHaveProperty('endpointPath');
    expect(JSON.parse(storedIntent)).toMatchObject({
      endpointSha256: createHash('sha256')
        .update('https://relay.example/v1/images/edits')
        .digest('hex'),
    });
    expect(storedReport + storedIntent).not.toContain('https://relay.example');
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      expect((await stat(reportPath)).mode & 0o777).toBe(0o600);
      expect((await stat(intentPath)).mode & 0o777).toBe(0o600);
      expect((await stat(String((report as { imagePath: string }).imagePath))).mode & 0o777).toBe(0o600);
    }
  });

  it('writes a sanitized reconciliation report when the only Provider POST fails after dispatch', async () => {
    const path = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-runner-'));
    directories.push(path);
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();
    const sourcePath = join(path, 'source.png');
    await writeFile(sourcePath, source);
    const operationId = 'sandbox-edit-failure-0001';
    const providerRequestId = 'provider-request-after-post-0001';
    const providerError = Object.assign(new Error('sensitive upstream response body'), {
      code: 'UND_ERR_SOCKET',
      providerJobId: providerRequestId,
    });
    const fetch = vi.fn(async () => {
      throw providerError;
    });

    await expect(runAiImageProviderSingleSubmit({
      environment: {
        NODE_ENV: 'sandbox',
        AI_IMAGE_SANDBOX_CONFIRM: 'I_ACCEPT_ONE_PAID_IMAGE_REQUEST',
        AI_IMAGE_SANDBOX_BASE_URL: 'https://relay.example',
        AI_IMAGE_SANDBOX_API_KEY: 'sandbox-secret-never-report',
        AI_IMAGE_SANDBOX_MODEL: 'opaque-model-alias',
        AI_IMAGE_SANDBOX_OPERATION_ID: operationId,
        AI_IMAGE_SANDBOX_CREDENTIAL_REVISION: 'admin-config-rev-0002',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
        AI_IMAGE_SANDBOX_OPERATION: 'IMAGE_TO_IMAGE',
        AI_IMAGE_SANDBOX_EXPECTED_HOST: 'relay.example',
        AI_IMAGE_SANDBOX_SOURCE_PATH: sourcePath,
        AI_IMAGE_SANDBOX_SOURCE_SHA256: createHash('sha256').update(source).digest('hex'),
        AI_IMAGE_SANDBOX_QUOTED_COST_CENTS: '10',
        AI_IMAGE_SANDBOX_MAX_COST_CENTS: '20',
      },
      outputDirectory: path,
      resolveDns: async () => [{ address: '93.184.216.34' }],
      fetch,
    })).rejects.toBe(providerError);

    const stored = await readFile(join(path, `${operationId}.report.json`), 'utf8');
    const expectedPrompt = [
      'Use the supplied source image as the only visual reference.',
      'Preserve the primary product identity, shape, colors, and proportions.',
      'Create one square marketplace hero image on a clearly visible soft warm-beige studio background.',
      'Do not add visible text, logos, watermarks, or extra objects.',
    ].join(' ');
    expect(JSON.parse(stored)).toMatchObject({
      operationId,
      state: 'RECONCILIATION_REQUIRED',
      operation: 'IMAGE_TO_IMAGE',
      endpointSha256: createHash('sha256')
        .update('https://relay.example/v1/images/edits')
        .digest('hex'),
      credentialRevision: 'admin-config-rev-0002',
      adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
      promptSha256: createHash('sha256').update(expectedPrompt).digest('hex'),
      sourceSha256: [createHash('sha256').update(source).digest('hex')],
      maskSha256: null,
      createRequests: 1,
      providerRequestIdHash: createHash('sha256').update(providerRequestId).digest('hex'),
      failureCode: 'UND_ERR_SOCKET',
      quotedCostCents: 10,
      maximumCostCents: 20,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(stored).not.toContain('sandbox-secret-never-report');
    expect(stored).not.toContain('sensitive upstream response body');
    expect(stored).not.toContain('https://relay.example');
    expect(stored).not.toContain(sourcePath);
  });
});
