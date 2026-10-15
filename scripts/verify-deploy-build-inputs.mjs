#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  gitCommitTreeEnvironment,
  gitCommitTreeSafeDirectoryArgs,
  verifyGitCommitWorktree,
} from './git-commit-tree.mjs';

const FULL_GIT_OID = /^[a-f0-9]{40}$/u;
const BUILD_PATHS = [
  'apps/server',
  'apps/web',
  'packages/shared',
  'extensions/ss-erp',
  'scripts',
  'docker',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.env*',
  'docker-compose*.yml',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  ':(exclude)apps/server/node_modules/**',
  ':(exclude)apps/server/dist/**',
  ':(exclude)apps/server/coverage/**',
  ':(exclude)apps/server/public/uploads/**',
  ':(exclude)apps/server/public/watermarked/**',
  ':(exclude)apps/server/public/resized/**',
  ':(exclude)apps/server/*.tsbuildinfo',
  ':(exclude)apps/web/node_modules/**',
  ':(exclude)apps/web/.next/**',
  ':(exclude)apps/web/.next-dev/**',
  ':(exclude)apps/web/coverage/**',
  ':(exclude)apps/web/*.tsbuildinfo',
  ':(exclude)packages/shared/node_modules/**',
  ':(exclude)packages/shared/dist/**',
  ':(exclude)packages/shared/*.tsbuildinfo',
];

// Git's pathspec exclude magic is not applied consistently by the Windows Git
// builds used for deployment checkouts (directory pathspecs can re-include an
// ignored child). Keep the generated-output allowlist explicit here as a
// second, platform-independent filter. Any ignored path outside this list is
// still treated as an unexpected build input and fails closed.
const GENERATED_OUTPUT_PREFIXES = [
  'apps/server/node_modules/',
  'apps/server/dist/',
  'apps/server/coverage/',
  'apps/server/public/uploads/',
  'apps/server/public/watermarked/',
  'apps/server/public/resized/',
  'apps/web/node_modules/',
  'apps/web/.next/',
  'apps/web/.next-dev/',
  'apps/web/coverage/',
  'packages/shared/node_modules/',
  'packages/shared/dist/',
];

function isGeneratedOutput(relativePath) {
  const normalized = relativePath.split('\\').join('/');
  return GENERATED_OUTPUT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || /^(?:apps\/(?:server|web)|packages\/shared)\/[^/]+\.tsbuildinfo$/u.test(normalized);
}

function fail(message) {
  throw new Error(message);
}

function runGit(args, encoding = 'utf8') {
  const result = spawnSync('git', [
    ...gitCommitTreeSafeDirectoryArgs(process.cwd()),
    ...args,
  ], {
    encoding,
    env: gitCommitTreeEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail('could not inspect deployment build inputs');
  }
  return result.stdout;
}

function main() {
  const expectedCommit = process.argv[2];
  if (![3, 4].includes(process.argv.length) || !FULL_GIT_OID.test(expectedCommit || '')) {
    fail('usage: verify-deploy-build-inputs <target-commit> [allowed-runtime-env]');
  }
  const repositoryRoot = runGit(['rev-parse', '--show-toplevel']).trim();
  const head = runGit(['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']).trim();
  if (!repositoryRoot || head !== expectedCommit) {
    fail('deployment build input checkout does not match the target commit');
  }
  let allowedRuntimeEnvironment = null;
  if (process.argv[3]) {
    const relative = path.relative(repositoryRoot, path.resolve(process.argv[3]));
    if (!relative.includes(path.sep) && /^\.env[A-Za-z0-9._-]*$/u.test(relative)) {
      allowedRuntimeEnvironment = relative;
    }
  }
  const ignored = runGit([
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '-z',
    '--',
    ...BUILD_PATHS,
  ], 'buffer');
  const ignoredPaths = ignored
      .toString('utf8')
      .split('\0')
      .filter((value) => value && value !== allowedRuntimeEnvironment)
      .filter((value) => !isGeneratedOutput(value));
  if (ignoredPaths.length > 0) {
    const paths = ignoredPaths
      .slice(0, 10)
      .map((value) => JSON.stringify(value))
      .join(', ');
    fail(`ignored deployment build inputs are forbidden: ${paths}`);
  }
  verifyGitCommitWorktree({ repositoryRoot, commit: expectedCommit });
  console.log('PASS deployment build inputs exactly match raw Git blobs');
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
