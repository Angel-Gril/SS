import { spawnSync } from 'node:child_process';
import { gitCommitTreeEnvironment, gitCommitTreeSafeDirectoryArgs } from './git-commit-tree.mjs';
import { isCommit, requireThat, sha256, sortedJson } from './qa04-final-evidence.mjs';

const CODE = 'QA04_ERP_SOURCE_CHANGED';
const check = value => requireThat(value, CODE);
const DOCUMENT = /^(?:(?:docs|dev-docs)\/(?:[^/]+\/)*[^/]+\.md|(?:README|CHANGELOG|CONTRIBUTING|LICENSE)\.md)$/u;
const PRESENTATION = /^(?:extensions\/ss-erp\/(?:pages|content)|apps\/web\/src)\/(?:[^/]+\/)*[^/]+\.css$/u;

// This is deliberately an allowlist of inert presentation/document changes,
// not an import-graph guess. Every other tracked path remains protected,
// including build scripts, credentials/config contracts, package manifests,
// schema, migrations, shared contracts, extension permissions and all JS/TS.
export function verifySuiteSourceBridge(root, executionCommit, targetCommit) {
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
