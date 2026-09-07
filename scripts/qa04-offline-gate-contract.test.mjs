import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  QA04_OFFLINE_STEPS,
  qa04OfflineManifest,
  readQa04GitProvenance,
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
const currentCommit = 'a'.repeat(40);

function gitRunnerSequence({
  repositoryRoot,
  firstCommit = currentCommit,
  secondCommit = firstCommit,
  firstStatus = '',
  secondStatus = firstStatus,
} = {}) {
  const outputs = [
    `${repositoryRoot}\n`,
    `${firstCommit}\n`,
    firstStatus,
    `${repositoryRoot}\n`,
    `${secondCommit}\n`,
    secondStatus,
  ];
  const calls = [];
  return {
    calls,
    runner(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, signal: null, stdout: outputs.shift(), stderr: '' };
    },
  };
}

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
const successGit = gitRunnerSequence({ repositoryRoot });
const success = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: successStdout,
  stderr: successStderr,
  gitRunner: successGit.runner,
  runner(command, args, options) {
    successCalls.push({ command, args, options });
    return { status: 0, signal: null };
  },
});
assert.equal(success, 0);
assert.equal(successCalls.length, expectedSteps.length);
assert.equal(successGit.calls.length, 6, 'the gate must bind clean Git state before and after all steps');
assert.equal(successStderr.value(), '');
assert.match(successStdout.value(), /Formal QA-04 completion still requires complete QA-02/u);
assert.match(successStdout.value(), new RegExp(`Git commit: ${currentCommit}`, 'u'));
for (const call of successCalls) {
  assert.equal(call.options.cwd, repositoryRoot);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.stdio, 'inherit');
}

const failureCalls = [];
const failureStderr = memoryWriter();
const failureGit = gitRunnerSequence({ repositoryRoot });
const failure = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: memoryWriter(),
  stderr: failureStderr,
  gitRunner: failureGit.runner,
  runner(command, args) {
    failureCalls.push({ command, args });
    return { status: failureCalls.length === 3 ? 23 : 0, signal: null };
  },
});
assert.equal(failure, 23, 'the gate must preserve the first failing exit status');
assert.equal(failureCalls.length, 3, 'the gate must not run later steps after a failure');
assert.equal(failureGit.calls.length, 3, 'a failed step must not be mislabeled with a post-run Git check');
assert.match(failureStderr.value(), /FAILED at workspace-lint: exit 23/u);

const startFailureCalls = [];
const startFailureStderr = memoryWriter();
const startFailureGit = gitRunnerSequence({ repositoryRoot });
const startFailure = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: memoryWriter(),
  stderr: startFailureStderr,
  gitRunner: startFailureGit.runner,
  runner(command, args) {
    startFailureCalls.push({ command, args });
    return { status: null, signal: null, error: new Error('not found') };
  },
});
assert.equal(startFailure, 1);
assert.equal(startFailureCalls.length, 1);
assert.match(startFailureStderr.value(), /failed to start gate-contract: not found/u);

const windowsCalls = [];
const windowsGit = gitRunnerSequence({ repositoryRoot });
const windowsFailure = runQa04OfflineGate({
  repositoryRoot,
  platform: 'win32',
  comSpec: 'C:\\Windows\\System32\\cmd.exe',
  stdout: memoryWriter(),
  stderr: memoryWriter(),
  gitRunner: windowsGit.runner,
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

const directProvenanceGit = gitRunnerSequence({ repositoryRoot });
assert.deepEqual(readQa04GitProvenance({
  repositoryRoot,
  runner: directProvenanceGit.runner,
}), {
  repositoryRoot,
  gitCommit: currentCommit,
});
assert.equal(directProvenanceGit.calls.length, 3);

const dirtyCalls = [];
const dirtyStderr = memoryWriter();
const dirtyGit = gitRunnerSequence({
  repositoryRoot,
  firstStatus: ' M scripts/qa04-offline-gate.mjs\n',
});
const dirty = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: memoryWriter(),
  stderr: dirtyStderr,
  gitRunner: dirtyGit.runner,
  runner(command, args) {
    dirtyCalls.push({ command, args });
    return { status: 0, signal: null };
  },
});
assert.equal(dirty, 1);
assert.equal(dirtyCalls.length, 0, 'dirty worktrees must fail before any QA command runs');
assert.match(dirtyStderr.value(), /Git provenance rejected: worktree is not clean/u);

const driftStderr = memoryWriter();
const driftGit = gitRunnerSequence({
  repositoryRoot,
  secondCommit: 'b'.repeat(40),
});
const drift = runQa04OfflineGate({
  repositoryRoot,
  platform: 'linux',
  stdout: memoryWriter(),
  stderr: driftStderr,
  gitRunner: driftGit.runner,
  runner() {
    return { status: 0, signal: null };
  },
});
assert.equal(drift, 1);
assert.match(driftStderr.value(), /Git provenance changed while the gate was running/u);

for (const status of ['M  tracked.mjs\n', '?? extra.mjs\n']) {
  let executed = 0;
  const git = gitRunnerSequence({ repositoryRoot, firstStatus: status });
  assert.equal(runQa04OfflineGate({
    repositoryRoot, gitRunner: git.runner, stdout: memoryWriter(), stderr: memoryWriter(),
    runner() { executed += 1; return { status: 0 }; },
  }), 1);
  assert.equal(executed, 0, 'staged and untracked changes must fail before QA commands');
}

test('real Git proves clean, unstaged, staged, untracked, root and post-run worktree boundaries', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-qa04-git-'));
  try {
    const hooks = path.join(root, 'empty-hooks');
    mkdirSync(hooks);
    const git = (...args) => {
      const result = spawnSync('git', [
        '-c', `core.hooksPath=${hooks}`, '-c', 'commit.gpgsign=false',
        '-c', 'user.name=QA04 Fixture', '-c', 'user.email=qa04@example.invalid', ...args,
      ], { cwd: root, encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '--quiet');
    const tracked = path.join(root, 'tracked.mjs');
    const original = 'export const value = 1;\n';
    writeFileSync(tracked, original);
    git('add', '--', 'tracked.mjs');
    git('commit', '--quiet', '-m', 'fixture');
    assert.equal(readQa04GitProvenance({ repositoryRoot: root }).gitCommit, git('rev-parse', 'HEAD'));
    writeFileSync(tracked, 'export const value = 2;\n');
    assert.throws(() => readQa04GitProvenance({ repositoryRoot: root }), /worktree is not clean/u);
    git('add', '--', 'tracked.mjs');
    assert.throws(() => readQa04GitProvenance({ repositoryRoot: root }), /worktree is not clean/u);
    writeFileSync(tracked, original);
    git('add', '--', 'tracked.mjs');
    const untracked = path.join(root, 'untracked.mjs');
    writeFileSync(untracked, 'export {};\n');
    git('config', 'status.showUntrackedFiles', 'no');
    assert.throws(() => readQa04GitProvenance({ repositoryRoot: root }), /worktree is not clean/u);
    rmSync(untracked);
    assert.throws(() => readQa04GitProvenance({ repositoryRoot: hooks }), /root does not match/u);
    let executed = 0;
    const stderr = memoryWriter();
    assert.equal(runQa04OfflineGate({
      repositoryRoot: root, stdout: memoryWriter(), stderr,
      runner() {
        executed += 1;
        if (executed === QA04_OFFLINE_STEPS.length) writeFileSync(tracked, 'export const value = 3;\n');
        return { status: 0 };
      },
    }), 1);
    assert.equal(executed, QA04_OFFLINE_STEPS.length);
    assert.match(stderr.value(), /Git provenance rejected after checks: worktree is not clean/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
