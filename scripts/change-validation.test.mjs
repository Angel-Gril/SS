import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { readChangeValidationInput, changeValidationMain } from './change-validation.mjs';
import { buildChangeValidationPlan } from './change-validation-plan.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-change-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => {
    const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git(['init', '-q']);
  mkdirSync(path.join(root, 'docs'));
  writeFileSync(path.join(root, 'docs/a.md'), '# Initial\n');
  writeFileSync(path.join(root, '.gitignore'), '.env\n');
  git(['add', '--', 'docs/a.md', '.gitignore']); git(['commit', '-qm', 'initial']);
  return { root, git, read: since => readChangeValidationInput({ repositoryRoot: root, since }) };
}

test('Git adapter includes staged, unstaged, deleted and untracked inputs without exposing ignored secrets', t => {
  const f = fixture(t), before = f.read();
  assert.deepEqual(before.changes, []);
  writeFileSync(path.join(f.root, 'docs/a.md'), '# Changed\n');
  writeFileSync(path.join(f.root, 'docs/b.md'), '# New\n');
  writeFileSync(path.join(f.root, '.env'), 'SECRET=sentinel-do-not-print\n');
  const after = f.read();
  assert.deepEqual(after.changes.map(value => value.path).sort(), ['docs/a.md', 'docs/b.md']);
  assert.notEqual(after.identity.sourceSha256, before.identity.sourceSha256);
  assert.doesNotMatch(JSON.stringify(after), /sentinel|SECRET/u);
  f.git(['add', '--', 'docs/a.md']);
  assert.deepEqual(f.read().changes, after.changes);
  rmSync(path.join(f.root, 'docs/a.md'));
  assert.equal(f.read().changes.find(value => value.path === 'docs/a.md').status, 'D');
});

test('ignored environment changes invalidate local resume without entering the plan', t => {
  const f = fixture(t), before = f.read();
  writeFileSync(path.join(f.root, '.env'), 'SECRET=synthetic\n');
  const after = f.read();
  assert.deepEqual(after.changes, []);
  assert.notEqual(after.identity.environmentSha256, before.identity.environmentSha256);
});

test('an exact base commit covers committed changes plus current worktree, never arbitrary revisions', t => {
  const f = fixture(t), base = f.git(['rev-parse', 'HEAD']);
  writeFileSync(path.join(f.root, 'docs/a.md'), '# Committed\n');
  f.git(['add', '--', 'docs/a.md']); f.git(['commit', '-qm', 'second']);
  assert.equal(f.read(base).changes[0].path, 'docs/a.md');
  assert.throws(() => f.read('--all'), /exact/u);
});

test('Git executable mode cannot be disguised as a documentation-only change on Windows', t => {
  const f = fixture(t);
  f.git(['update-index', '--chmod=+x', 'docs/a.md']);
  const result = f.read();
  assert.equal(result.changes[0].mode, '100755');
  assert.equal(buildChangeValidationPlan({ changes: result.changes }).profile, 'full');
});

test('native CLI executes a documentation-only check and produces a local receipt', async t => {
  const f = fixture(t), evidence = mkdtempSync(path.join(os.tmpdir(), 'ss-change-evidence-'));
  t.after(() => rmSync(evidence, { recursive: true, force: true }));
  writeFileSync(path.join(f.root, 'docs/a.md'), '# Changed\n');
  const output = path.join(evidence, 'run');
  const status = await changeValidationMain(['--run', '--output', output], f.root);
  assert.equal(status, 0);
  const receipt = JSON.parse(readFileSync(path.join(output, 'receipt.json')));
  assert.equal(receipt.status, 'PASSED_LOCAL'); assert.equal(receipt.formalReleaseEvidence, false);
  assert.equal(receipt.steps.length, 1); assert.equal(receipt.steps[0].id, 'diff-check');
});

test('unrecognized shortcuts and repository output directories are rejected before execution', async t => {
  const f = fixture(t);
  assert.equal(await changeValidationMain(['--skip-tests'], f.root), 1);
  assert.equal(await changeValidationMain(['--run', '--output', path.join(f.root, 'evidence')], f.root), 1);
});
