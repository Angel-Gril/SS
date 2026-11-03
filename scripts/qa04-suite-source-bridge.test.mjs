import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

let subject = {};
try { subject = await import('./qa04-suite-source-bridge.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

function fixture(t, initialFiles = {}) {
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
  for (const [name, bytes] of Object.entries(initialFiles)) write(name, bytes);
  git('add', '--', 'apps', 'packages', 'pnpm-lock.yaml', 'extensions', 'scripts', 'package.json', 'dev-docs');
  git('commit', '-qm', 'execution source');
  const executionCommit = git('rev-parse', 'HEAD');
  const commit = filename => { git('add', '--', filename); git('commit', '-qm', 'target source'); return git('rev-parse', 'HEAD'); };
  const verify = (target, options) => {
    assert.equal(typeof subject.verifySuiteSourceBridge, 'function');
    return subject.verifySuiteSourceBridge(root, executionCommit, target, options);
  };
  return { root, git, write, commit, verify, executionCommit };
}

const websiteConsumerPaths = [
  'apps/server/src/services/extension-website-publication.ts',
  'apps/server/src/__tests__/extensions-download.test.ts',
  'scripts/extension-website-publication-approval.mjs',
  'scripts/extension-release-publication.test.mjs',
];
function reviewedWebsiteFixture(t) {
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const before = Object.fromEntries(websiteConsumerPaths.map(name => [name,
    execFileSync('git', ['show', 'c04a19bf8e849939871716baa7e0914aaa5601d2:' + name], { cwd: repository })]));
  const f = fixture(t, before);
  for (const name of websiteConsumerPaths) f.write(name, readFileSync(path.join(repository, name), 'utf8').replace(/\r\n/gu, '\n'));
  f.git('add', '--', ...websiteConsumerPaths); f.git('commit', '-qm', 'reviewed website consumer compatibility');
  const target = f.git('rev-parse', 'HEAD');
  const tree = path => f.git('ls-tree', '-r', path).split(/\r?\n/gu).filter(Boolean)
    .map(line => { const match = /^\d+ blob ([a-f0-9]{40})\t(.+)$/u.exec(line); return match ? [match[2], match[1]] : null; })
    .filter(Boolean);
  const beforeTree = new Map(tree(f.executionCommit)), afterTree = new Map(tree(target));
  const reviewedWebsiteConsumers = new Map(websiteConsumerPaths.map(name => [name, [beforeTree.get(name), afterTree.get(name)]]));
  return { ...f, target, reviewedWebsiteConsumers };
}

test('suite reuse accepts only the complete reviewed website consumer blob transition', t => {
  const f = reviewedWebsiteFixture(t), result = f.verify(f.target, { reviewedWebsiteConsumers: f.reviewedWebsiteConsumers });
  assert.equal(result.requiresFreshTargetUiVerification, false);
  assert.deepEqual(result.changes.map(change => change.path).sort(), [...websiteConsumerPaths].sort());
  assert.ok(result.changes.every(change => change.kind === 'REVIEWED_WEBSITE_EVIDENCE_CONSUMER'));
});

test('reviewed website consumer paths do not exempt later unreviewed code', t => {
  const f = reviewedWebsiteFixture(t), filename = websiteConsumerPaths[0];
  f.write(filename, 'unreviewed download or billing behavior\n');
  assert.throws(() => f.verify(f.commit(filename), { reviewedWebsiteConsumers: f.reviewedWebsiteConsumers }), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

test('website consumer reuse still rejects an additional Provider runtime change', t => {
  const f = reviewedWebsiteFixture(t), filename = 'apps/server/src/suite.ts';
  f.write(filename, 'changed Provider or money owner\n');
  assert.throws(() => f.verify(f.commit(filename), { reviewedWebsiteConsumers: f.reviewedWebsiteConsumers }), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

for (const action of ['remove', 'executable', 'partial']) test('reviewed website consumer reuse rejects ' + action + ' transitions', t => {
  const f = reviewedWebsiteFixture(t), filename = websiteConsumerPaths[0];
  if (action === 'remove') f.git('rm', '--', filename);
  else if (action === 'executable') f.git('update-index', '--chmod=+x', filename);
  else {
    const repository = fileURLToPath(new URL('../', import.meta.url));
    f.write(filename, execFileSync('git', ['show', 'c04a19bf:' + filename], { cwd: repository }));
    f.git('add', '--', filename);
  }
  f.git('commit', '-qm', 'invalid publication transition');
  assert.throws(() => f.verify(f.git('rev-parse', 'HEAD'), { reviewedWebsiteConsumers: f.reviewedWebsiteConsumers }), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
});

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

function reviewedCaptureFixture(t) {
  const f = fixture(t), repository = fileURLToPath(new URL('../', import.meta.url));
  const paths = ['scripts/qa04-suite-live-response-capture.mjs', 'scripts/qa04-suite-live-response-capture.test.mjs',
    'scripts/qa04-suite-transport-capture.mjs', 'scripts/qa04-suite-transport-capture.test.mjs'];
  // The allowlist approves one historical introduction, not whatever a future
  // checkout happens to contain. Later capture repairs must still be rejected.
  for (const filename of paths) f.write(filename, execFileSync('git',
    ['show', 'dca0431857add37088d1ca3a92984cd3adb44522:' + filename], { cwd: repository }));
  f.git('add', '--', ...paths); f.git('commit', '-qm', 'reviewed read-only transport capture');
  return { ...f, paths, target: f.git('rev-parse', 'HEAD') };
}

test('only the complete approved capture-tool blob introduction can accompany original suite reuse', t => {
  const f = reviewedCaptureFixture(t), result = f.verify(f.target);
  assert.deepEqual(result.changes.map(change => change.path).sort(), [...f.paths].sort());
  assert.ok(result.changes.every(change => change.kind === 'REVIEWED_SUITE_CAPTURE_TOOL'));
  assert.equal(result.requiresFreshTargetUiVerification, false);
});

for (const action of ['partial', 'changed', 'executable', 'runtime']) test('capture-tool blob introduction refuses ' + action, t => {
  const f = reviewedCaptureFixture(t), filename = f.paths[0];
  if (action === 'partial') f.git('rm', '--', filename);
  else if (action === 'executable') f.git('update-index', '--chmod=+x', filename);
  else {
    const name = action === 'runtime' ? 'apps/server/src/suite.ts' : filename;
    f.write(name, 'unreviewed behavior\n'); f.git('add', '--', name);
  }
  f.git('commit', '-qm', 'reject incomplete or unreviewed transition');
  assert.throws(() => f.verify(f.git('rev-parse', 'HEAD')), error => error.code === 'QA04_ERP_SOURCE_CHANGED');
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
