import { spawnSync } from 'node:child_process';
import { gitCommitTreeEnvironment, gitCommitTreeSafeDirectoryArgs } from './git-commit-tree.mjs';
import { isCommit, requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';

const CODE = 'QA04_ERP_SOURCE_CHANGED';
const check = value => requireThat(value, CODE);
const DOCUMENT = /^(?:(?:docs|dev-docs)\/(?:[^/]+\/)*[^/]+\.md|(?:README|CHANGELOG|CONTRIBUTING|LICENSE)\.md)$/u;
const PRESENTATION = /^(?:extensions\/ss-erp\/(?:pages|content)|apps\/web\/src)\/(?:[^/]+\/)*[^/]+\.css$/u;
const EVIDENCE_CONSUMERS = new Set([
  'scripts/qa04-final-suite-evidence.mjs',
  'scripts/qa04-suite-target-ui.mjs',
  'scripts/qa04-final-acceptance.test.mjs',
  'scripts/qa04-suite-source-bridge.mjs',
  'scripts/qa04-suite-source-bridge.test.mjs',
]);
// Operator-approved 2026-10-23 correction to read-only website evidence
// consumers. Pin the complete reviewed before/after blobs, not their paths:
// subsequent edits to these runtime files still require fresh suite evidence.
const REVIEWED_WEBSITE_CONSUMERS = new Map([
  ['apps/server/src/services/extension-website-publication.ts',
    ['fb74c4dd5694fa97d336afac732fc5d94059b020', '9ab1c55c5053087f32fdebd2837b401b25210504']],
  ['apps/server/src/__tests__/extensions-download.test.ts',
    ['1a77ac31facbd1277156464162a08bed4796bea5', 'a36925b9207eea751dec135359e8ba20c5904210']],
  ['scripts/extension-website-publication-approval.mjs',
    ['0e1957acd42572aea01771ed1a9c2313c7ec704a', '0f013e283338d0c703c8a26fc04811832cd18298']],
  ['scripts/extension-release-publication.test.mjs',
    ['cfae0072fc2c7cd6123edc0510fc363c12ab52a1', '8de237b0cd0944bef2fc1eac663114c386eae4ed']],
]);

// Approved 2026-10-26: preserve the reviewed read-only CDP capture implementation
// and fail-closed repairs; original acquisition records remain immutable.
// All four paths must be absent before and match these complete blobs after.
// This is not a general exemption for producers or future edits to these tools.
const REVIEWED_SUITE_CAPTURE_TOOLS = new Map([
  ['scripts/qa04-suite-live-response-capture.mjs', 'ed55a06fe82f8051014da6ed772b8a7a66e19328'],
  ['scripts/qa04-suite-live-response-capture.test.mjs', 'f88775177a734539d864445d0fc734f9279b721a'],
  ['scripts/qa04-suite-transport-capture.mjs', 'bcc92fb9a1f90cc6ea458316c6235c49102a8ac0'],
  ['scripts/qa04-suite-transport-capture.test.mjs', 'b6e07e1246f3afafe3667b63e59669c0c50a5b22'],
]);

// This is deliberately an allowlist of inert presentation/document changes
// and four existing, reviewed QA04 evidence consumers, plus the exact four-blob
// read-only capture-tool introduction above, not an import-graph guess.
// Every other tracked path remains protected,
// including build scripts, credentials/config contracts, package manifests,
// schema, migrations, shared contracts, extension permissions and runtime JS/TS
// outside the exact reviewed website/capture transitions above.
export function verifySuiteSourceBridge(root, executionCommit, targetCommit, options = {}) {
  check(isCommit(executionCommit) && isCommit(targetCommit));
  const git = args => {
    const result = spawnSync('git', [...gitCommitTreeSafeDirectoryArgs(root), ...args], {
      cwd: root, env: gitCommitTreeEnvironment(), encoding: 'utf8', shell: false,
      windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
    check(!result.error && result.status === 0);
    return result.stdout;
  };
  const tree = commit => {
    check(git(['rev-parse', '--verify', `${commit}^{commit}`]).trim() === commit);
    const result = new Map();
    for (const line of git(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean)) {
      const match = /^(100644 blob|100755 blob|120000 blob|160000 commit) ([a-f0-9]{40})\t([^\0]+)$/u.exec(line);
      check(match && !result.has(match[3]));
      result.set(match[3], { mode: match[1], objectId: match[2] });
    }
    check(result.size > 0 && result.size <= 100_000);
    return result;
  };
  const before = tree(executionCommit), after = tree(targetCommit);
  const reviewedWebsiteConsumers = options.reviewedWebsiteConsumers || REVIEWED_WEBSITE_CONSUMERS;
  const websiteTransition = [...reviewedWebsiteConsumers].every(([filename, [from, to]]) =>
    before.get(filename)?.mode === '100644 blob' && before.get(filename)?.objectId === from
    && after.get(filename)?.mode === '100644 blob' && after.get(filename)?.objectId === to);
  const captureTransition = [...REVIEWED_SUITE_CAPTURE_TOOLS].every(([filename, to]) =>
    !before.has(filename) && after.get(filename)?.mode === '100644 blob' && after.get(filename)?.objectId === to);
  check(git(['merge-base', executionCommit, targetCommit]).trim() === executionCommit);
  const changes = [], protectedFiles = {};
  for (const filename of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const execution = before.get(filename), target = after.get(filename);
    if (sortedJson(execution ?? null) === sortedJson(target ?? null)) {
      // Include even unchanged docs/CSS in the protected fingerprint. Only the
      // precise changed blobs listed in this bridge are excluded.
      protectedFiles[filename] = execution;
      continue;
    }
    check((execution === undefined || execution.mode === '100644 blob')
      && (target === undefined || target.mode === '100644 blob'));
    let kind;
    if (DOCUMENT.test(filename) && !filename.split('/').some(part => part.startsWith('.'))) kind = 'DOCUMENTATION';
    else if (EVIDENCE_CONSUMERS.has(filename) && execution?.mode === '100644 blob' && target?.mode === '100644 blob') {
      kind = 'QA04_EVIDENCE_CONSUMER';
    }
    else if (websiteTransition && reviewedWebsiteConsumers.has(filename)) {
      kind = 'REVIEWED_WEBSITE_EVIDENCE_CONSUMER';
    }
    else if (captureTransition && REVIEWED_SUITE_CAPTURE_TOOLS.has(filename)) {
      kind = 'REVIEWED_SUITE_CAPTURE_TOOL';
    }
    else if (PRESENTATION.test(filename) && execution && target) {
      for (const entry of [execution, target]) {
        const css = git(['cat-file', 'blob', entry.objectId]);
        // Do not exempt imports, external resources or escaped spellings of
        // network/executable constructs from a new paid integration run.
        check(Buffer.byteLength(css) <= 512 * 1024 && !/[\\\0]/u.test(css)
          && !/(?:@import\b|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:|javascript\s*:)/iu.test(css));
      }
      kind = 'CSS_PRESENTATION';
    } else check(false);
    changes.push({ path: filename, kind, executionObjectId: execution?.objectId ?? null, targetObjectId: target?.objectId ?? null });
    check(changes.length <= 128);
  }
  return { kind: 'UNCHANGED_HOSTED_SUITE_RUNTIME_V1', executionCommit, targetCommit,
    protectedSourceSha256: sha256(sortedJson(protectedFiles)), changes,
    requiresFreshTargetUiVerification: changes.some(value => value.kind === 'CSS_PRESENTATION') };
}
