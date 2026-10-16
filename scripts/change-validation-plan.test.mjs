import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChangeValidationPlan } from './change-validation-plan.mjs';

const plan = (paths, options = {}) => buildChangeValidationPlan({ changes: paths.map(path => ({ path, status: 'M' })), ...options });

test('documentation changes do not launch a product build or model request', () => {
  const result = plan(['dev-docs/README.md', 'CHANGELOG.md']);
  assert.equal(result.profile, 'documentation');
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].command, 'git');
  assert.deepEqual(result.steps[0].args, ['diff', '--check']);
  assert.equal(result.formalReleaseEvidence, false);
  assert.equal(result.freshHostedSuite, 'not_required_by_local_change');
});

test('extension CSS validates its packages without server/database tests', () => {
  const result = plan(['extensions/ss-erp/pages/precision-workbench.css'], { build: true });
  assert.equal(result.profile, 'presentation');
  assert.ok(result.steps.some(step => step.id === 'extension-verify'));
  assert.ok(result.steps.some(step => step.id === 'extension-cloud-build'));
  assert.equal(result.steps.some(step => step.id === 'server-test' || step.id === 'web-build'), false);
  assert.ok(result.requiredEvidence.includes('browser_changed_surface'));
});

test('ordinary web changes select web checks and the optional web build', () => {
  const result = plan(['apps/web/src/app/(dashboard)/orders/page.tsx'], { build: true });
  assert.equal(result.profile, 'web');
  assert.ok(result.steps.some(step => step.id === 'web-typecheck'));
  assert.ok(result.steps.some(step => step.id === 'web-build'));
  assert.equal(result.steps.some(step => step.id === 'server-test'), false);
});

for (const file of ['apps/server/src/lib/auth.ts', 'apps/server/prisma/schema.prisma',
  'packages/shared/src/ai-media.ts', 'pnpm-lock.yaml', 'scripts/verify-ai-media-pilot-policy.mjs',
  'apps/server/src/services/new-unknown-rule.ts', 'extensions/ss-erp/background/service-worker.js']) {
  test(`protected or unclassified change retains full validation: ${file}`, () => {
    const result = plan([file]);
    assert.equal(result.profile, 'full');
    assert.ok(result.steps.some(step => step.id === 'server-test'));
    assert.ok(result.requiredEvidence.includes('formal_release_gates'));
    assert.equal(result.freshHostedSuite, 'required_or_prove_unchanged_runtime');
  });
}

test('mixed documentation and protected source cannot choose the documentation path', () => {
  assert.equal(plan(['dev-docs/README.md', 'apps/server/src/lib/auth.ts']).profile, 'full');
});

test('unknown and executable files disguised as docs or CSS fail closed', () => {
  for (const entry of [{ path: 'docs/runner.mjs', status: 'M' }, { path: 'docs/guide.md', status: 'M', mode: '120000' },
    { path: 'apps/web/src/app/globals.css', status: 'M', mode: '100755' },
    { path: 'dev-docs/a.md', status: 'R100', oldPath: 'apps/server/src/lib/auth.ts' }]) {
    assert.equal(buildChangeValidationPlan({ changes: [entry] }).profile, 'full');
  }
});

test('no changes is explicit and never claims a green test run', () => {
  const result = plan([]);
  assert.equal(result.profile, 'no_changes');
  assert.deepEqual(result.steps, []);
  assert.equal(result.formalReleaseEvidence, false);
});

test('paths from Git cannot become shell commands or traversal targets', () => {
  for (const path of ['../docs/a.md', '/docs/a.md', 'docs/a.md\n--x', 'docs/$(write).md', 'docs/a\\b.md']) {
    assert.throws(() => plan([path]), /path/i);
  }
});
