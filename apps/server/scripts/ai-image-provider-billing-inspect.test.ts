import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runAiImageProviderBillingInspect, runAiImageProviderConsoleBillingInspect } from './ai-image-provider-billing-finalize.js';
import { sanitizeAiImageSandboxGitEnvironment } from '../src/services/ai-image-sandbox-code-revision.js';
import {
  alibabaObservation, alibabaNativeBillBody, alibabaQueryAccountId,
  alibabaBillingRecordId, alibabaObservationNow, billingDigest,
} from '../src/__tests__/fixtures/ai-image-alibaba-billing.js';
import {
  alibabaConsoleObservation, alibabaConsoleAccountId, alibabaConsoleBillRow,
  alibabaConsoleResponse, alibabaConsoleObservationNow,
} from '../src/__tests__/fixtures/ai-image-alibaba-console-billing.js';

const execFileAsync = promisify(execFile);
const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(serverRoot, '../..');
const entry = 'apps/server/scripts/ai-image-provider-billing-finalize.ts';
let temporaryRoot = '';
let repositoryRoot = '';
let evidenceRoot = '';
let revision = '';
let sequence = 0;

afterEach(() => vi.restoreAllMocks());

// Exercise the real CLI in a synthetic clean Git checkout, never the user's dirty tree.
beforeAll(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'ai-native-billing-cli-'));
  repositoryRoot = join(temporaryRoot, 'checkout');
  evidenceRoot = join(temporaryRoot, 'private');
  await mkdir(repositoryRoot, { mode: 0o700 });
  await mkdir(evidenceRoot, { mode: 0o700 });
  const copied = new Set<string>();
  const pending = [entry];
  while (pending.length) {
    const name = pending.pop()!;
    if (copied.has(name)) continue;
    assert(!name.startsWith('..') && !name.includes(`${sep}..${sep}`));
    const source = await readFile(join(sourceRoot, name), 'utf8');
    const target = join(repositoryRoot, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source);
    copied.add(name);
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/gu)) {
      const dependency = resolve(dirname(join(sourceRoot, name)), match[1]!.replace(/\.js$/u, '.ts'));
      pending.push(relative(sourceRoot, dependency).split(sep).join('/'));
    }
  }
  await writeFile(join(repositoryRoot, 'package.json'), '{"type":"module"}\n');
  const git = (args: string[]) => execFileAsync('git', [
    '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd: repositoryRoot, windowsHide: true, env: sanitizeAiImageSandboxGitEnvironment() });
  await git(['init']);
  await git(['add', '--', 'package.json', ...copied]);
  await git(['-c', 'user.name=Billing Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'test: bind synthetic CLI source']);
  revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
}, 20_000);

afterAll(async () => {
  if (!temporaryRoot) return;
  const target = resolve(temporaryRoot);
  assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
  assert(basename(target).startsWith('ai-native-billing-cli-'));
  await rm(target, { recursive: true, force: true });
});

async function inspect(observation: unknown, environment: NodeJS.ProcessEnv = {}, timeout = 15_000, argument: string | string[] = '--inspect-alibaba') {
  const path = join(evidenceRoot, `observation-${++sequence}.json`);
  const bytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`);
  await writeFile(path, bytes, { mode: 0o600 });
  const before = (await readdir(evidenceRoot)).sort();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    ({ stdout, stderr } = await execFileAsync(process.execPath, [
      '--import', pathToFileURL(join(serverRoot, 'node_modules/tsx/dist/loader.mjs')).href,
      join(repositoryRoot, entry), ...(typeof argument === 'string' ? [argument] : argument),
    ], {
      cwd: repositoryRoot, windowsHide: true, timeout,
      env: {
        ...sanitizeAiImageSandboxGitEnvironment(), NODE_ENV: 'sandbox', DOTENV_CONFIG_PATH: 'NUL',
        AI_IMAGE_SANDBOX_ADAPTER_REVISION: revision,
        AI_IMAGE_SANDBOX_EVIDENCE_ROOT: evidenceRoot,
        AI_IMAGE_SANDBOX_BILLING_OBSERVATION_PATH: path,
        AI_IMAGE_SANDBOX_BILLING_OBSERVATION_SHA256: billingDigest(bytes),
        AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest(alibabaQueryAccountId),
        ...environment,
      },
    }));
  } catch (error: any) {
    stdout = String(error.stdout || '');
    stderr = String(error.stderr || '');
    exitCode = typeof error.code === 'number' ? error.code : -1;
  }
  expect((await readdir(evidenceRoot)).sort()).toEqual(before);
  expect(await readFile(path)).toEqual(bytes);
  return { stdout, stderr, exitCode, path };
}

describe('offline native Alibaba billing inspection CLI', () => {
  it('reads original Count/Data console evidence as free-quota observation without writing a settlement', async () => {
    const result = await inspect(alibabaConsoleObservation(), {
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest(alibabaConsoleAccountId),
    }, 15_000, '--inspect-alibaba-console');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const assessment = JSON.parse(result.stdout);
    expect(assessment).toMatchObject({
      kind: 'ALIBABA_CONSOLE_BILLING_ASSESSMENT_V1', state: 'RECONCILIATION_REQUIRED',
      actualCost: null, canFinalize: false, inspectionAdapterRevision: revision,
      query: { action: 'ListConsumeDetails' },
      pagination: { complete: true, returnedCount: 1 },
      records: [{ imageQuantity: { unit: '张', beforeDeduction: 1, resourcePlanDeducted: 1, billed: 0 },
        amounts: { requireAmount: { currency: 'CNY', amount: 0, scale: 0 } }, cashPaidAmount: null }],
    });
    expect(assessment).not.toHaveProperty('billingGate');
    for (const privateValue of [alibabaConsoleAccountId, 'synthetic-key-id', 'synthetic-workspace',
      'synthetic-bill-001', 'synthetic-console-collector', result.path, 'AI_IMAGE_SANDBOX_BILLING_SETTLED']) {
      expect(result.stdout).not.toContain(privateValue);
    }
  });

  it('preserves a synthetic nonzero console payable without claiming cash payment or finalization', async () => {
    const observation = alibabaConsoleObservation([alibabaConsoleBillRow({
      LineItemType: '合成按量费用', ResourcePlanDeductQuantity: '0', BillingQuantity: '1',
      ListPrice: '0.14', ListUnitPrice: '0.14', AmountAfterPromotionDeduction: '0.14',
      RequireAmount: '0.14', AmountAfterCouponDeduction: '0.14',
    })]);
    const result = await inspect(observation, {
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest(alibabaConsoleAccountId),
    }, 15_000, '--inspect-alibaba-console');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      actualCost: null, canFinalize: false,
      records: [{ freeQuotaLabel: false, amounts: { requireAmount: { currency: 'CNY', amount: 14, scale: 2 } }, cashPaidAmount: null }],
    });
  });

  it('rejects console evidence with duplicate native amount keys', async () => {
    const observation = alibabaConsoleObservation();
    const capture = observation.captures[1]!;
    capture.response = alibabaConsoleResponse(Buffer.from(capture.response.bodyBase64, 'base64').toString()
      .replace('"RequireAmount":"0"', '"RequireAmount":1,"RequireAmount":"0"'));
    const result = await inspect(observation, {
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest(alibabaConsoleAccountId),
    }, 15_000, '--inspect-alibaba-console');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_CONSOLE_BILLING_OBSERVATION_INVALID');
    expect(result.stdout).toBe('');
  });

  it('rejects a mismatched independently reviewed console billing account', async () => {
    const result = await inspect(alibabaConsoleObservation(), {
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest('different-synthetic-account'),
    }, 15_000, '--inspect-alibaba-console');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_CONSOLE_BILLING_ACCOUNT_MISMATCH');
    expect(result.stdout).toBe('');
  });

  it('keeps console responses out of the QueryBill command', async () => {
    const result = await inspect(alibabaConsoleObservation());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_BILLING_OBSERVATION_INVALID');
    expect(result.stdout).toBe('');
  });

  it('keeps QueryBill responses out of the explicit console detail command', async () => {
    const result = await inspect(alibabaObservation(), {}, 15_000, '--inspect-alibaba-console');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_CONSOLE_BILLING_OBSERVATION_INVALID');
    expect(result.stdout).toBe('');
  });

  it('rejects mixed inspection commands before emitting an observation', async () => {
    const result = await inspect(alibabaConsoleObservation(), {}, 15_000, ['--inspect-alibaba-console', '--inspect-alibaba']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SANDBOX_BILLING_CONFIG_INVALID');
    expect(result.stdout).toBe('');
  });

  it('reads a native bill without assigning its account payment to a Wanx task or writing a settlement', async () => {
    const result = await inspect(alibabaObservation());
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    const assessment = JSON.parse(result.stdout);
    expect(assessment).toMatchObject({
      kind: 'ALIBABA_NATIVE_BILLING_ASSESSMENT_V1', state: 'RECONCILIATION_REQUIRED',
      actualCost: null, canFinalize: false,
      pagination: { complete: true, returnedCount: 1 },
      records: [{
        billingRecordIdSha256: billingDigest(alibabaBillingRecordId),
        paymentStatus: 'PayFinish',
        amounts: {
          pretaxAmount: { currency: 'CNY', amount: 14, scale: 2 },
          paymentAmount: { currency: 'CNY', amount: 1, scale: 1 },
          cashAmount: { currency: 'CNY', amount: 9, scale: 2 },
        },
      }],
    });
    expect(assessment).not.toHaveProperty('billingGate');
    expect(result.stdout).not.toContain('AI_IMAGE_SANDBOX_BILLING_SETTLED');
    for (const secret of [alibabaQueryAccountId, alibabaBillingRecordId, 'fixture@example.invalid', result.path]) {
      expect(result.stdout).not.toContain(secret);
    }
  });

  it('rejects a mismatched independently supplied billing account digest', async () => {
    const result = await inspect(alibabaObservation(), {
      AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest('another-synthetic-account'),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_BILLING_ACCOUNT_MISMATCH');
    expect(result.stdout).toBe('');
  });

  it('rejects duplicate native monetary fields instead of choosing the last number', async () => {
    const body = JSON.stringify(alibabaNativeBillBody()).replace('"PretaxAmount":0.14', '"PretaxAmount":1,"PretaxAmount":0.14');
    const result = await inspect(alibabaObservation(body));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_BILLING_OBSERVATION_INVALID');
    expect(result.stdout).toBe('');
  });

  it('rejects malformed escaped JSON within a bounded child process', async () => {
    const malformed = '{"A":"' + '\\"'.repeat(262_144);
    const result = await inspect(alibabaObservation(malformed), {}, 3_000);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ALIBABA_BILLING_OBSERVATION_INVALID');
    expect(result.stdout).toBe('');
  }, 6_000);

  it.each(['DASHSCOPE_API_KEY', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN', 'AI_IMAGE_SANDBOX_CONFIRM', 'COOKIE'])(
    'rejects %s before Git or private evidence reads', async (name) => {
      const resolveRevision = vi.fn();
      await expect(runAiImageProviderBillingInspect({
        environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-secret' }, resolveRevision,
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_UNSAFE_ENV' });
      await expect(runAiImageProviderConsoleBillingInspect({
        environment: { NODE_ENV: 'sandbox', [name]: 'synthetic-secret' }, resolveRevision,
      })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_UNSAFE_ENV' });
      expect(resolveRevision).not.toHaveBeenCalled();
    },
  );

  it('does not enter finalization when settlement arguments leak into inspection', async () => {
    const resolveRevision = vi.fn();
    await expect(runAiImageProviderBillingInspect({
      environment: { NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH: 'must-not-open' }, resolveRevision,
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFIG_INVALID' });
    await expect(runAiImageProviderConsoleBillingInspect({
      environment: { NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_BILLING_SETTLEMENT_PATH: 'must-not-open' }, resolveRevision,
    })).rejects.toMatchObject({ code: 'SANDBOX_BILLING_CONFIG_INVALID' });
    expect(resolveRevision).not.toHaveBeenCalled();
  });

  it.each(['query-bill', 'console-details'] as const)('rechecks the source revision before emitting any %s observation', async (source) => {
    const consoleDetails = source === 'console-details';
    const path = join(evidenceRoot, `observation-${++sequence}.json`);
    const bytes = Buffer.from(`${JSON.stringify(consoleDetails ? alibabaConsoleObservation() : alibabaObservation(), null, 2)}\n`);
    await writeFile(path, bytes, { mode: 0o600 });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const resolveRevision = vi.fn().mockResolvedValueOnce('a'.repeat(40)).mockResolvedValueOnce('b'.repeat(40));
    const run = consoleDetails ? runAiImageProviderConsoleBillingInspect : runAiImageProviderBillingInspect;
    await expect(run({
      repositoryRoot, evidenceRoot, now: consoleDetails ? alibabaConsoleObservationNow : alibabaObservationNow, resolveRevision,
      environment: {
        NODE_ENV: 'sandbox', AI_IMAGE_SANDBOX_ADAPTER_REVISION: 'a'.repeat(40),
        AI_IMAGE_SANDBOX_BILLING_OBSERVATION_PATH: path,
        AI_IMAGE_SANDBOX_BILLING_OBSERVATION_SHA256: billingDigest(bytes),
        AI_IMAGE_SANDBOX_BILLING_ACCOUNT_UID_SHA256: billingDigest(consoleDetails ? alibabaConsoleAccountId : alibabaQueryAccountId),
      },
    })).rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
    expect(stdout).not.toHaveBeenCalled();
    expect(resolveRevision).toHaveBeenCalledTimes(2);
    expect(resolveRevision.mock.calls[0]![2]).toContain(consoleDetails
      ? 'apps/server/src/services/ai-image-alibaba-console-billing-observation.ts'
      : 'apps/server/src/services/ai-image-alibaba-billing-observation.ts');
    expect(resolveRevision.mock.calls[0]![2]).toContain('apps/server/src/services/ai-image-alibaba-native-json.ts');
  });
});
