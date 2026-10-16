#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import { gitCommitTreeEnvironment, gitCommitTreeSafeDirectoryArgs } from './git-commit-tree.mjs';
import { readQa04GitProvenance } from './qa04-offline-gate.mjs';
import { canonicalJson, canonicalTimestamp, isCommit, isRecord, isSha256, privateOutputPath,
  requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_CODE = 'QA04_CURRENT_RUNTIME_ENV_REQUIRED';
const CODE = 'QA04_CURRENT_RUNTIME_INVALID';

// Set this before importing the Prisma singleton. The later SHOW checks prove
// the driver honored read-only defaults; an unsupported option fails closed.
export function readOnlySuiteRuntimeEnvironment(environment) {
  let url;
  try { url = new URL(environment.DATABASE_URL); } catch { requireThat(false, ENV_CODE); }
  requireThat(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && url.pathname.length > 1 && !url.hash
    && typeof environment.ENCRYPTION_KEY === 'string' && environment.ENCRYPTION_KEY.length >= 32, ENV_CODE);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('socket_timeout', '20');
  url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=1000');
  return { ...environment, NODE_ENV: 'production', DATABASE_URL: url.toString() };
}

export function createCurrentSuiteRuntimeReadback(snapshot, gitCommit, observedAt, databaseReadOnly) {
  requireThat(isCommit(gitCommit) && databaseReadOnly === true && snapshot?.configured === true
    && snapshot.executionReady === true && snapshot.testOnly === false && isRecord(snapshot.providerConfig), CODE);
  canonicalTimestamp(observedAt, CODE);
  const config = snapshot.providerConfig;
  requireThat(isSha256(config.providerConfigHash) && typeof config.pricingVersion === 'string'
    && config.pricingVersion.length <= 100 && config.provider === 'custom' && config.model === 'gpt-image-2-count'
    && config.estimatedCostPerImageCents === 10 && config.maximumCostPerImageCents === 10
    && Number.isSafeInteger(config.concurrencyLimit) && config.concurrencyLimit > 0 && config.concurrencyLimit <= 16, CODE);
  // Explicit field selection: neither rawSettings/apiKey nor the credential
  // record identity can appear in the native receipt or normal CLI output.
  return { schemaVersion: 1, kind: 'SS_ERP_HOSTED_SUITE_CURRENT_RUNTIME', gitCommit, observedAt,
    readOnly: true, databaseReadOnly: true, configured: true, executionReady: true, testOnly: false,
    providerRequests: 0, ozonWrites: 0,
    providerConfig: Object.fromEntries(['provider', 'model', 'providerConfigHash', 'pricingVersion',
      'estimatedCostPerImageCents', 'maximumCostPerImageCents', 'concurrencyLimit'].map(key => [key, config[key]])) };
}

export async function readCurrentSuiteRuntime({ repositoryRoot = ROOT, expectedCommit, outputPath } = {}) {
  requireThat(isCommit(expectedCommit), CODE);
  const environment = readOnlySuiteRuntimeEnvironment(process.env);
  const root = path.resolve(repositoryRoot), output = privateOutputPath(outputPath, root);
  const runner = (command, args, options) => spawnSync(command, [...gitCommitTreeSafeDirectoryArgs(root), ...args], {
    ...options, env: gitCommitTreeEnvironment(), timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  const provenance = () => requireThat(readQa04GitProvenance({ repositoryRoot: root, runner }).gitCommit === expectedCommit, CODE);
  provenance();
  Object.assign(process.env, { NODE_ENV: environment.NODE_ENV, DATABASE_URL: environment.DATABASE_URL });
  let prisma;
  try {
    // tsx maps these source owners' .js imports to their corresponding .ts.
    // Do not import index/worker or inspect frozen historical suite/job rows.
    ({ prisma } = await import(pathToFileURL(path.join(root, 'apps/server/src/lib/prisma.ts')).href));
    const { getAiImageSuiteProviderRuntimeConfig } = await import(pathToFileURL(path.join(root,
      'apps/server/src/services/ai-image-suite-runtime-config.ts')).href);
    const { createAiImageSuiteProviderRuntimeSnapshot } = await import(pathToFileURL(path.join(root,
      'apps/server/src/services/ai-image-suite-provider-runtime.ts')).href);
    const assertReadOnly = async () => {
      const rows = await prisma.$queryRawUnsafe('SHOW default_transaction_read_only');
      requireThat(rows.length === 1 && rows[0].default_transaction_read_only === 'on', CODE);
    };
    await assertReadOnly();
    const current = () => getAiImageSuiteProviderRuntimeConfig().then(settings => createAiImageSuiteProviderRuntimeSnapshot(settings));
    const first = await current(), second = await current();
    requireThat(sortedJson(first) === sortedJson(second), CODE);
    await assertReadOnly(); provenance();
    const receipt = createCurrentSuiteRuntimeReadback(second, expectedCommit, new Date().toISOString(), true);
    privateOutputPath(output, root);
    const bytes = canonicalJson(receipt);
    writeNewArtifactDurably(output, bytes, { mode: 0o600 });
    return { status: 'WRITTEN', gitCommit: expectedCommit, sha256: sha256(bytes), observedAt: receipt.observedAt };
  } finally { if (prisma) await prisma.$disconnect(); }
}

export async function currentSuiteRuntimeMain(args = process.argv.slice(2)) {
  try {
    if (args.length === 1 && args[0] === '--help') {
      process.stdout.write('Usage: node --import ./apps/server/node_modules/tsx/dist/loader.mjs scripts/qa04-suite-current-runtime.mjs --commit <40-hex> --output <private-absolute-new.json>\nRequires current read-only DATABASE_URL, ENCRYPTION_KEY and the existing exact capability evidence. --dry-run checks only environment syntax without connecting or writing evidence.\n');
      return 0;
    }
    if (args.length === 1 && args[0] === '--dry-run') {
      readOnlySuiteRuntimeEnvironment(process.env);
      process.stdout.write('ENVIRONMENT_VALIDATED_NOT_EXECUTED: no database access, Provider request or evidence receipt\n');
      return 0;
    }
    requireThat(args.length === 4, CODE);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = { '--commit': 'expectedCommit', '--output': 'outputPath' }[args[index]];
      requireThat(key && !(key in options), CODE); options[key] = args[index + 1];
    }
    process.stdout.write(`${JSON.stringify(await readCurrentSuiteRuntime(options))}\n`);
    return 0;
  } catch (error) {
    // Never print a Prisma error, connection URL, decrypted credential or raw
    // snapshot. A failed/dry run cannot create a native success receipt.
    process.stderr.write(`${/^QA04_[A-Z_]+$/u.test(error.code || '') ? error.code : CODE}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await currentSuiteRuntimeMain();
}
