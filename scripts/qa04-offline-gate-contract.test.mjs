import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QA04_OFFLINE_STEPS,
  qa04OfflineManifest,
  runQa04OfflineGate,
} from './qa04-offline-gate.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const expectedSteps = [
  ['gate-contract', 'pnpm', ['test:qa04:offline-contract']],
  ['diff-check', 'git', ['diff', '--check']],
  ['workspace-lint', 'pnpm', ['lint']],
  ['workspace-typecheck', 'pnpm', ['typecheck']],
  ['preflight-build', 'pnpm', ['preflight', '--build']],
  [
    'scope-revocation-postgres',
    'pnpm',
    ['--filter', 'server', 'test:qa04:scope-revocation:postgres'],
  ],
  ['ai-media-postgres', 'pnpm', ['--filter', 'server', 'test:ai-media:postgres']],
  ['extension-cloud', 'pnpm', ['build:extension:cloud']],
  ['extension-local', 'pnpm', ['build:extension:local']],
];

assert.equal(
  packageJson.scripts['qa:04:offline'],
  'node scripts/qa04-offline-gate.mjs',
  'the root package must expose the offline gate',
);
assert.equal(
  packageJson.scripts['qa:04:offline:list'],
  'node scripts/qa04-offline-gate.mjs --list',
  'the root package must expose the non-executing audit manifest',
);
assert.equal(
  packageJson.scripts['test:qa04:offline-contract'],
  'node scripts/qa04-offline-gate-contract.test.mjs',
  'the root package must expose the static gate contract',
);
assert.match(
  packageJson.scripts['build:extension:cloud'],
  /build-extension-package\.mjs cloud && pnpm verify:extension:cloud/u,
  'the cloud entry point must build and then run strict verification',
);
assert.match(
  packageJson.scripts['build:extension:local'],
  /build-extension-package\.mjs local && pnpm verify:extension:local/u,
  'the local entry point must build and then verify',
);

assert.deepEqual(
  QA04_OFFLINE_STEPS.map(({ id, command, args }) => [id, command, [...args]]),
  expectedSteps,
  'the offline gate command allowlist must remain complete and ordered',
);

const manifest = qa04OfflineManifest();
assert.deepEqual(
  {
    schemaVersion: manifest.schemaVersion,
    gateId: manifest.gateId,
    formalTaskId: manifest.formalTaskId,
    formalPrerequisiteTaskId: manifest.formalPrerequisiteTaskId,
    completesFormalTask: manifest.completesFormalTask,
    externalAccess: manifest.externalAccess,
  },
  {
    schemaVersion: 1,
    gateId: 'QA-04_OFFLINE_REHEARSAL',
    formalTaskId: 'QA-04',
    formalPrerequisiteTaskId: 'QA-02',
    completesFormalTask: false,
    externalAccess: 'NO_PROVIDER_OR_VPS',
  },
  'the audit manifest must not represent this rehearsal as formal QA-04 completion',
);
assert.deepEqual(
  manifest.steps.map(({ id, command, args }) => [id, command, args]),
  expectedSteps,
);

const forbiddenCommands =
  /(?:sandbox:ai-image:(?:single|translation:single)|smoke:remote|deploy|ssh|curl)/iu;
assert.doesNotMatch(
  JSON.stringify(manifest.steps),
  forbiddenCommands,
  'the offline gate must not call a Provider, VPS, remote smoke, or deployment entry point',
);

function memoryWriter() {
  let value = '';
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    value() {
      return value;
    },
  };
}

const successCalls = [];
const successStdout = memoryWriter();
const successStderr = memoryWriter();
const success = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: successStdout,
  stderr: successStderr,
  runner(command, args, options) {
    successCalls.push({ command, args, options });
    return { status: 0, signal: null };
  },
});
assert.equal(success, 0);
assert.equal(successCalls.length, expectedSteps.length);
assert.equal(successStderr.value(), '');
assert.match(successStdout.value(), /Formal QA-04 completion still requires complete QA-02/u);
for (const call of successCalls) {
  assert.equal(call.options.cwd, repositoryRoot);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.stdio, 'inherit');
}

const failureCalls = [];
const failureStderr = memoryWriter();
const failure = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: memoryWriter(),
  stderr: failureStderr,
  runner(command, args) {
    failureCalls.push({ command, args });
    return { status: failureCalls.length === 3 ? 23 : 0, signal: null };
  },
});
assert.equal(failure, 23, 'the gate must preserve the first failing exit status');
assert.equal(failureCalls.length, 3, 'the gate must not run later steps after a failure');
assert.match(failureStderr.value(), /FAILED at workspace-lint: exit 23/u);

const startFailureCalls = [];
const startFailureStderr = memoryWriter();
const startFailure = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: memoryWriter(),
  stderr: startFailureStderr,
  runner(command, args) {
    startFailureCalls.push({ command, args });
    return { status: null, signal: null, error: new Error('not found') };
  },
});
assert.equal(startFailure, 1);
assert.equal(startFailureCalls.length, 1);
assert.match(startFailureStderr.value(), /failed to start gate-contract: not found/u);

const windowsCalls = [];
const windowsFailure = runQa04OfflineGate({
  repositoryRoot,
  platform: 'win32',
  comSpec: 'C:\\Windows\\System32\\cmd.exe',
  stdout: memoryWriter(),
  stderr: memoryWriter(),
  runner(command, args) {
    windowsCalls.push({ command, args });
    return { status: 29, signal: null };
  },
});
assert.equal(windowsFailure, 29);
assert.deepEqual(windowsCalls, [
  {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'pnpm test:qa04:offline-contract'],
  },
]);

const listResult = spawnSync(process.execPath, ['scripts/qa04-offline-gate.mjs', '--list'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
assert.equal(listResult.status, 0, listResult.stderr);
assert.deepEqual(JSON.parse(listResult.stdout), manifest);

const invalidResult = spawnSync(process.execPath, ['scripts/qa04-offline-gate.mjs', '--unknown'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
});
assert.equal(invalidResult.status, 2);
assert.match(invalidResult.stderr, /Usage:/u);

console.log('PASS QA-04 offline gate contract');
