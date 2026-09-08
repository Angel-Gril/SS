import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repository = path.resolve(import.meta.dirname, '..');
const source = readFileSync(new URL('./verify-vps-deploy.sh', import.meta.url), 'utf8').replace(/\r/gu, '');
const roots = [];
test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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

function finalize(value, { failures = 0, output = value.output, verification = value.verification } = {}) {
  const fn = /^write_verification_evidence\(\) \{[\s\S]*?^\}/mu.exec(source)?.[0] || '';
  const footer = source.slice(source.lastIndexOf('echo "=== Result:'));
  const bash = process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/bin/bash.exe') : 'bash';
  return spawnSync(bash, ['-c', `set -euo pipefail\n${fn}\n${footer}`], {
    encoding: 'utf8', cwd: repository,
    env: {
      ...process.env,
      FAILURES: String(failures), WARNINGS: '1',
      DEPLOY_DIR: value.deployedRoot,
      VERIFY_SCRIPT_DIR: path.join(repository, 'scripts'),
      VERIFY_EVIDENCE_OUTPUT: output,
      VERIFY_EVIDENCE_REGION: 'COM',
      VERIFY_EVIDENCE_STARTED_AT: value.startedAt,
      VERIFY_EVIDENCE_INITIAL_COMMIT: value.gitCommit,
      VERIFY_EVIDENCE_API_ORIGIN: 'https://api.example.com',
      VERIFY_EVIDENCE_RELEASE_VERIFICATION: JSON.stringify(verification),
    },
  });
}

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
