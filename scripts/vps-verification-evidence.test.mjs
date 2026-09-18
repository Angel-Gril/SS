import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const repository = path.resolve(import.meta.dirname, '..');
const source = readFileSync(new URL('./verify-vps-deploy.sh', import.meta.url), 'utf8').replace(/\r/gu, '');
const roots = [];
const links = [];
test.afterEach(() => {
  for (const link of links.splice(0)) {
    assert.equal(lstatSync(link).isSymbolicLink(), true, 'only remove the test-created link');
    unlinkSync(link);
  }
  for (const root of roots.splice(0)) {
    const resolved = realpathSync(root);
    assert.equal(path.dirname(resolved), realpathSync(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('ss-erp-vps-evidence-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-vps-evidence-'));
  roots.push(root);
  const deployedRoot = path.join(root, 'deployed');
  mkdirSync(deployedRoot);
  const output = path.join(root, 'vps-verification.json');
  const gitCommit = 'a'.repeat(40);
  writeFileSync(path.join(deployedRoot, 'DEPLOYED_COMMIT'), `${gitCommit}\n`);
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const verification = {
    schemaVersion: 1, gitCommit, version: '1.2.3', cloudLogisticsEnabled: false,
    signature: {
      schemaVersion: 1, gitCommit, version: '1.2.3', keyId: 'test-key',
      signedAt: new Date(Date.now() - 120_000).toISOString(),
      releaseEvidenceSha256: 'b'.repeat(64), releaseSignatureSha256: 'c'.repeat(64),
    },
    files: ['ss-erp-cloud-1.2.3.zip', 'ss-erp-local-1.2.3.zip',
      'ss-erp-extension-1.2.3.release-evidence.json', 'ss-erp-extension-1.2.3.sha256'],
  };
  return { root, deployedRoot, output, gitCommit, startedAt, verification };
}

function finalize(value, { failures = 0, output = value.output, verification = value.verification,
  scriptDirectory = path.join(repository, 'scripts'), nodeOptions = process.env.NODE_OPTIONS || '' } = {}) {
  const fn = /^write_verification_evidence\(\) \{[\s\S]*?^\}/mu.exec(source)?.[0] || '';
  const footer = source.slice(source.lastIndexOf('echo "=== Result:'));
  const bash = process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';
  return spawnSync(bash, ['-c', `set -euo pipefail\n${fn}\n${footer}`], {
    encoding: 'utf8', cwd: repository,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
      FAILURES: String(failures), WARNINGS: '1',
      DEPLOY_DIR: value.deployedRoot,
      VERIFY_SCRIPT_DIR: scriptDirectory,
      VERIFY_EVIDENCE_OUTPUT: output,
      VERIFY_EVIDENCE_REGION: 'COM',
      VERIFY_EVIDENCE_STARTED_AT: value.startedAt,
      VERIFY_EVIDENCE_INITIAL_COMMIT: value.gitCommit,
      VERIFY_EVIDENCE_API_ORIGIN: 'https://api.example.com',
      VERIFY_EVIDENCE_RELEASE_VERIFICATION: JSON.stringify(verification),
    },
  });
}

function linkedScripts(value) {
  const directory = path.join(value.root, 'current-scripts');
  symlinkSync(path.join(repository, 'scripts'), directory, process.platform === 'win32' ? 'junction' : 'dir');
  links.push(directory);
  return directory;
}

const tsxLoader = pathToFileURL(path.join(repository, 'apps/server/node_modules/tsx/dist/loader.mjs')).href;

test('the complete VPS verifier emits a canonical candidate-bound receipt only after a successful run', () => {
  const value = fixture();
  const result = finalize(value);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(value.output), true, 'successful full verification must retain its evidence');
  const bytes = readFileSync(value.output, 'utf8');
  const receipt = JSON.parse(bytes);
  assert.equal(bytes, `${JSON.stringify(receipt, null, 2)}\n`);
  assert.equal(receipt.kind, 'SS_ERP_VPS_VERIFICATION');
  assert.equal(receipt.scope, 'FULL');
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.failures, 0);
  assert.equal(receipt.warnings, 1);
  assert.equal(receipt.startedAt, value.startedAt);
  assert.deepEqual(receipt.candidate, {
    gitCommit: value.gitCommit, apiOrigin: 'https://api.example.com', region: 'COM', version: '1.2.3',
    releaseEvidenceSha256: 'b'.repeat(64), releaseSignatureSha256: 'c'.repeat(64),
  });
  const repeated = finalize(value);
  assert.notEqual(repeated.status, 0, 'existing evidence must not be overwritten');
  assert.equal(readFileSync(value.output, 'utf8'), bytes);
});

test('failed, unsigned, or drifted VPS verification cannot emit a passing receipt', () => {
  const value = fixture();
  for (const options of [
    { failures: 1 },
    { verification: { ...value.verification, signature: null } },
    { verification: { ...value.verification, gitCommit: 'd'.repeat(40) } },
  ]) {
    const result = finalize(value, options);
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(value.output), false);
  }
  writeFileSync(path.join(value.deployedRoot, 'DEPLOYED_COMMIT'), `${'e'.repeat(40)}\n`);
  assert.notEqual(finalize(value).status, 0);
  assert.equal(existsSync(value.output), false);
});

test('ordinary VPS verification keeps receipt output opt-in', () => {
  const value = fixture();
  const result = finalize(value, { output: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(value.output), false);
});

for (const runtime of [
  { name: 'native Node', nodeOptions: '' },
  {
    name: 'ordinary Node without native TypeScript stripping',
    nodeOptions: '--no-experimental-strip-types',
  },
  { name: 'the configured tsx loader', nodeOptions: `--import=${tsxLoader}` },
]) {
  test(`a linked script directory retains full VPS evidence with ${runtime.name}`, () => {
    const value = fixture();
    const scriptDirectory = linkedScripts(value);
    const result = finalize(value, { scriptDirectory, nodeOptions: runtime.nodeOptions });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(value.output), true, 'linked CLI must execute the receipt writer');
    const bytes = readFileSync(value.output, 'utf8');
    const receipt = JSON.parse(bytes);
    assert.equal(bytes, `${JSON.stringify(receipt, null, 2)}\n`);
    assert.equal(receipt.kind, 'SS_ERP_VPS_VERIFICATION');
    assert.equal(receipt.candidate.gitCommit, value.gitCommit);
    assert.equal(receipt.warnings, 1);
    assert.equal(receipt.startedAt, value.startedAt);
    assert.match(result.stdout, /"outputSha256":"[a-f0-9]{64}"/u);
  });
}

test('a linked CLI rejects malformed arguments instead of silently succeeding', () => {
  const value = fixture();
  const executable = path.join(linkedScripts(value), 'vps-verification-evidence.mjs');
  const result = spawnSync(process.execPath, ['--import', tsxLoader, executable, '--invalid-option'], {
    cwd: repository, encoding: 'utf8', windowsHide: true,
  });
  assert.notEqual(result.status, 0, 'linked CLI must enter argument validation');
  assert.match(result.stderr, /VPS verification evidence was not retained/u);
  assert.equal(existsSync(value.output), false);
});

test('a linked CLI rejects output inside the deployed release', () => {
  const value = fixture();
  const scriptDirectory = linkedScripts(value);
  const nodeOptions = `--import=${tsxLoader}`;
  const forbiddenOutput = path.join(value.deployedRoot, 'vps-verification.json');
  assert.notEqual(finalize(value, { scriptDirectory, nodeOptions, output: forbiddenOutput }).status, 0);
  assert.equal(existsSync(forbiddenOutput), false);
});

test('a linked CLI refuses to overwrite existing evidence', () => {
  const value = fixture();
  const scriptDirectory = linkedScripts(value);
  const nodeOptions = `--import=${tsxLoader}`;
  const existing = 'previous operator evidence\n';
  writeFileSync(value.output, existing);
  const result = finalize(value, { scriptDirectory, nodeOptions });
  assert.notEqual(result.status, 0, 'linked CLI must not accept an existing output as a new receipt');
  assert.equal(readFileSync(value.output, 'utf8'), existing);
});

test('importing the evidence module through a link remains side-effect free', () => {
  const value = fixture();
  const moduleUrl = pathToFileURL(path.join(linkedScripts(value), 'vps-verification-evidence.mjs')).href;
  const expression = `const module = await import(${JSON.stringify(moduleUrl)}); if (typeof module.createVpsVerificationEvidence !== 'function') process.exitCode = 2;`;
  const result = spawnSync(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', expression], {
    cwd: repository, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(existsSync(value.output), false);
});
