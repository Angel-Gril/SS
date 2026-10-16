import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

let subject = {};
try { subject = await import('./qa04-suite-source-bridge.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-suite-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (filename, value) => {
    mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    writeFileSync(path.join(root, filename), value);
  };
  git('init', '-q');
  for (const name of ['apps/server/src/suite.ts', 'packages/shared/contract.ts', 'pnpm-lock.yaml',
    'apps/server/prisma/schema.prisma', 'extensions/ss-erp/manifest.json', 'scripts/build.mjs', 'package.json']) write(name, 'original\n');
  write('extensions/ss-erp/pages/precision-workbench.css', '.panel { color: black; }\n');
  write('dev-docs/README.md', '# Original\n');
  for (const name of ['qa04-final-suite-evidence.mjs', 'qa04-final-acceptance.test.mjs',
    'qa04-suite-source-bridge.mjs', 'qa04-suite-source-bridge.test.mjs']) write('scripts/' + name, 'original verifier\n');
  git('add', '--', 'apps', 'packages', 'pnpm-lock.yaml', 'extensions', 'scripts', 'package.json', 'dev-docs');
  git('commit', '-qm', 'execution source');
  const executionCommit = git('rev-parse', 'HEAD');
  const commit = filename => { git('add', '--', filename); git('commit', '-qm', 'target source'); return git('rev-parse', 'HEAD'); };
  const verify = target => {
    assert.equal(typeof subject.verifySuiteSourceBridge, 'function');
    return subject.verifySuiteSourceBridge(root, executionCommit, target);
  };
  return { root, git, write, commit, verify, executionCommit };
}

test('suite reuse compares the complete Git tree and records documentation-only changes', t => {
  const f = fixture(t);
  f.write('dev-docs/README.md', '# Corrected release notes\n');
  const target = f.commit('dev-docs/README.md'), result = f.verify(target);
  assert.equal(result.kind, 'UNCHANGED_HOSTED_SUITE_RUNTIME_V1');
  assert.equal(result.executionCommit, f.executionCommit); assert.equal(result.targetCommit, target);
  assert.equal(result.requiresFreshTargetUiVerification, false);
  assert.match(result.protectedSourceSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(result.changes.map(value => [value.path, value.kind]), [['dev-docs/README.md', 'DOCUMENTATION']]);
  assert.notEqual(result.changes[0].executionObjectId, result.changes[0].targetObjectId);
});

test('pure CSS reuse explicitly leaves fresh target UI verification mandatory', t => {
  const f = fixture(t), filename = 'extensions/ss-erp/pages/precision-workbench.css';
  f.write(filename, '.panel { color: navy; max-height: 90vh; overflow: auto; }\n');
  const result = f.verify(f.commit(filename));
  assert.equal(result.requiresFreshTargetUiVerification, true);
  assert.equal(result.changes[0].kind, 'CSS_PRESENTATION');
});

for (const name of ['qa04-final-suite-evidence.mjs', 'qa04-final-acceptance.test.mjs',
  'qa04-suite-source-bridge.mjs', 'qa04-suite-source-bridge.test.mjs']) {
  test('suite reuse allows an existing QA04 evidence-consumer correction only: ' + name, t => {
    const f = fixture(t), filename = 'scripts/' + name;
    f.write(filename, 'reviewed verifier correction\n');
    const result = f.verify(f.commit(filename));
    assert.equal(result.changes[0].kind, 'QA04_EVIDENCE_CONSUMER');
    assert.equal(result.requiresFreshTargetUiVerification, false);
  });
}

test('an evidence-consumer change never permits a neighboring generation change', t => {
  const f = fixture(t), filename = 'scripts/qa04-final-suite-evidence.mjs';
  f.write(filename, 'reviewed verifier correction\n'); f.commit(filename);
  f.write('apps/server/src/suite.ts', 'unreviewed runtime\n');
  assert.throws(() => f.verify(f.commit('apps/server/src/suite.ts')), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

for (const action of ['add', 'remove', 'executable', 'symlink']) {
  test('evidence consumers cannot be newly added, removed, executable or symlinked: ' + action, t => {
    const f = fixture(t), filename = 'scripts/qa04-final-suite-evidence.mjs';
    if (action === 'add') {
      f.git('rm', '--', filename); f.git('commit', '-qm', 'no original verifier');
      const execution = f.git('rev-parse', 'HEAD'); f.write(filename, 'new verifier\n');
      assert.throws(() => subject.verifySuiteSourceBridge(f.root, execution, f.commit(filename)), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
    } else if (action === 'remove') {
      f.git('rm', '--', filename); f.git('commit', '-qm', 'remove verifier');
      assert.throws(() => f.verify(f.git('rev-parse', 'HEAD')), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
    } else if (action === 'executable') {
      f.git('update-index', '--chmod=+x', filename); f.git('commit', '-qm', 'executable verifier');
      assert.throws(() => f.verify(f.git('rev-parse', 'HEAD')), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
    } else {
      const object = f.git('hash-object', '-w', '--stdin');
      f.git('update-index', '--cacheinfo', '120000,' + object + ',' + filename); f.git('commit', '-qm', 'linked verifier');
      assert.throws(() => f.verify(f.git('rev-parse', 'HEAD')), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
    }
  });
}

for (const filename of ['apps/server/src/suite.ts', 'apps/web/src/app/page.tsx', 'packages/shared/contract.ts',
  'apps/server/prisma/schema.prisma', 'apps/server/prisma/migrations/new/migration.sql', 'pnpm-lock.yaml',
  'package.json', 'apps/web/package.json', '.npmrc', '.gitattributes', 'config/runtime.json', '.github/workflows/build.yml',
  'extensions/ss-erp/manifest.json', 'extensions/ss-erp/pages/workbench.js', 'scripts/build.mjs',
  'scripts/qa04-final-evidence.mjs', 'scripts/qa04-final-suite-fixture.mjs', 'scripts/qa04-count-suite-profile.mjs',
  'scripts/qa04-suite-current-runtime.mjs', 'scripts/qa04-offline-gate.mjs', 'scripts/qa04-final-suite-evidence-extra.mjs',
  'dev-docs/looks-like-a-document.mjs', 'apps/server/src/document.md', 'unknown.css']) {
  test(`suite reuse fails closed for protected or unknown change ${filename}`, t => {
    const f = fixture(t); f.write(filename, 'changed behavior\n');
    const target = f.commit(filename);
    assert.throws(() => f.verify(target), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
  });
}

for (const css of ['@import "https://example.invalid/style.css";', '.panel { background: url(https://example.invalid/leak); }',
  '.panel { background: u\\72l(https://example.invalid/leak); }', '.panel { width: expression(alert(1)); }']) {
  test(`suite reuse refuses CSS network or executable constructs ${css.slice(0, 25)}`, t => {
    const f = fixture(t), filename = 'extensions/ss-erp/pages/precision-workbench.css';
    f.write(filename, css);
    assert.throws(() => f.verify(f.commit(filename)), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
  });
}

test('suite reuse refuses using a descendant execution as an ancestor target', t => {
  const f = fixture(t); f.write('dev-docs/README.md', '# New\n');
  const target = f.commit('dev-docs/README.md');
  assert.equal(typeof subject.verifySuiteSourceBridge, 'function');
  assert.throws(() => subject.verifySuiteSourceBridge(f.root, target, f.executionCommit),
    error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});
