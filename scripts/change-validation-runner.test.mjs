import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { executeChangeValidation } from './change-validation-runner.mjs';

const plan = { schemaVersion: 1, kind: 'SS_ERP_LOCAL_CHANGE_VALIDATION_PLAN', profile: 'presentation', steps: [
  { id: 'change-validation-plan', command: 'node', args: ['--test', 'scripts/change-validation-plan.test.mjs'] },
  { id: 'server-build', command: 'pnpm', args: ['--filter', 'server', 'build'] },
], formalReleaseEvidence: false, requiredEvidence: ['browser_changed_surface'] };
const input = { sourceSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64), nodeVersion: process.version };
const roots = [];
const root = () => { const r = mkdtempSync(path.join(os.tmpdir(), 'ss-validation-runner-')); roots.push(r); return r; };
test.afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const options = overrides => ({ plan, input, outputDirectory: root(), readInput: () => input,
  runStep: async () => ({ status: 0, log: Buffer.from('verified\n') }), ...overrides });

test('local execution creates separate original logs with timings and never formal evidence', async () => {
  const settings = options();
  const receipt = await executeChangeValidation(settings);
  assert.equal(receipt.status, 'PASSED_LOCAL');
  assert.equal(receipt.formalReleaseEvidence, false);
  assert.equal(receipt.steps.length, 2);
  assert.ok(receipt.steps.every(step => step.durationMs >= 0 && step.logSha256?.length === 64));
  assert.equal(JSON.parse(readFileSync(path.join(settings.outputDirectory, 'receipt.json'))).status, 'PASSED_LOCAL');
});

test('failed checks stop subsequent commands and are never cached as success', async () => {
  let calls = 0;
  const settings = options({ runStep: async () => { calls++; return { status: 17, log: Buffer.from('failure\n') }; } });
  const receipt = await executeChangeValidation(settings);
  assert.equal(receipt.status, 'FAILED'); assert.equal(receipt.exitCode, 17); assert.equal(calls, 1);
});

test('resume reuses only verified local stateless checks and reruns builds', async () => {
  const first = options(); await executeChangeValidation(first);
  const calls = [];
  const second = options({ resumePath: path.join(first.outputDirectory, 'receipt.json'),
    runStep: async step => { calls.push(step.id); return { status: 0, log: Buffer.from('new build\n') }; } });
  const result = await executeChangeValidation(second);
  assert.deepEqual(calls, ['server-build']);
  assert.equal(result.steps[0].reused, true);
  assert.equal(result.steps[1].reused, false);
});

test('tampered cached logs force execution instead of accepting old green output', async () => {
  const first = options(); const original = await executeChangeValidation(first);
  writeFileSync(path.join(first.outputDirectory, original.steps[0].logFilename), 'changed');
  const calls = [];
  await executeChangeValidation(options({ resumePath: path.join(first.outputDirectory, 'receipt.json'),
    runStep: async step => { calls.push(step.id); return { status: 0, log: Buffer.from('verified\n') }; } }));
  assert.deepEqual(calls, ['change-validation-plan', 'server-build']);
});

test('changed inputs invalidate a prior pass and mid-run changes stop execution', async () => {
  const first = options(); await executeChangeValidation(first);
  const changed = { ...input, environmentSha256: 'c'.repeat(64) }; let calls = 0;
  const result = await executeChangeValidation(options({ input: changed, readInput: () => changed,
    resumePath: path.join(first.outputDirectory, 'receipt.json'),
    runStep: async () => { calls++; return { status: 0, log: Buffer.from('verified\n') }; } }));
  assert.equal(calls, 2); assert.equal(result.status, 'PASSED_LOCAL');
  calls = 0;
  await assert.rejects(executeChangeValidation(options({ readInput: () => calls ? changed : input,
    runStep: async () => { calls++; return { status: 0, log: Buffer.from('verified\n') }; } })), /inputs changed/i);
  assert.equal(calls, 1);
});

test('signal/unknown child status cannot become a success receipt', async () => {
  const result = await executeChangeValidation(options({ runStep: async () => ({ status: null, signal: 'SIGTERM', log: Buffer.from('') }) }));
  assert.equal(result.status, 'FAILED'); assert.equal(result.exitCode, 1);
});

test('a no-change plan is not presented as tests passed', async () => {
  const result = await executeChangeValidation(options({ plan: { ...plan, profile: 'no_changes', steps: [] } }));
  assert.equal(result.status, 'NO_CHANGES');
});
