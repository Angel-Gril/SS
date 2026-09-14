import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

const GIT_CHILD_ENVIRONMENT_ALLOWLIST = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
]);

type AiImageSandboxGitRunner = (args: string[]) => Promise<string>;

export function sanitizeAiImageSandboxGitEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([name]) => (
    GIT_CHILD_ENVIRONMENT_ALLOWLIST.has(name.toUpperCase())
  )));
}

function createAiImageSandboxGitRunner(repositoryRoot: string): AiImageSandboxGitRunner {
  return async (args) => {
    const result = await execFileAsync('git', [
      '-c', 'core.hooksPath=',
      '-c', 'core.fsmonitor=false',
      '-c', 'submodule.recurse=false',
      ...args,
    ], {
      cwd: repositoryRoot,
      env: sanitizeAiImageSandboxGitEnvironment(),
      windowsHide: true,
      timeout: 10_000,
    });
    return String(result.stdout);
  };
}

async function resolveGitHead(runGit: AiImageSandboxGitRunner) {
  const revision = (await runGit(['rev-parse', '--verify', 'HEAD'])).trim().toLowerCase();
  return AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(revision) ? revision : '';
}

async function assertGitTrackedWorktreeClean(runGit: AiImageSandboxGitRunner) {
  const status = await runGit(['status', '--porcelain=v1', '--untracked-files=no']);
  if (status.trim()) {
    throw Object.assign(new Error('The sandbox repository has tracked worktree changes'), {
      code: 'SANDBOX_ADAPTER_WORKTREE_DIRTY',
    });
  }
}

async function assertGitPathsTracked(
  runGit: AiImageSandboxGitRunner,
  revision: string,
  requiredTrackedPaths: string[],
) {
  const paths = [...new Set(requiredTrackedPaths)];
  for (const path of paths) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u.test(path) || path.includes('..')) {
      throw Object.assign(new Error('The sandbox tracked-path requirement is invalid'), {
        code: 'SANDBOX_ADAPTER_TRACKED_PATH_INVALID',
      });
    }
  }
  if (!paths.length) return;

  let tracked: Set<string>;
  try {
    tracked = new Set((await runGit(['ls-files', '--error-unmatch', '--', ...paths]))
      .trim().split(/\r?\n/u));
  } catch {
    throw Object.assign(new Error('The sandbox executable is not tracked by the bound revision'), {
      code: 'SANDBOX_ADAPTER_FILE_UNTRACKED',
    });
  }
  if (paths.some(path => !tracked.has(path))) {
    throw Object.assign(new Error('The sandbox executable is not tracked by the bound revision'), {
      code: 'SANDBOX_ADAPTER_FILE_UNTRACKED',
    });
  }

  const committedObjects = (await runGit(['rev-parse', ...paths.map(path => `${revision}:${path}`)]))
    .trim().toLowerCase().split(/\r?\n/u);
  // File operands retain each path's Git filters, including CRLF normalization.
  // Batch within this verification only; later dispatch checks must reread the files.
  const worktreeObjects = (await runGit(['hash-object', '--', ...paths]))
    .trim().toLowerCase().split(/\r?\n/u);
  if (
    committedObjects.length !== paths.length
    || worktreeObjects.length !== paths.length
    || committedObjects.some((committedObject, index) => (
      !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(committedObject)
      || !AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(worktreeObjects[index]!)
      || committedObject !== worktreeObjects[index]
    ))
  ) {
    throw Object.assign(new Error('The sandbox executable differs from the bound revision'), {
      code: 'SANDBOX_ADAPTER_FILE_DIRTY',
    });
  }
}

export async function resolveAiImageSandboxRepositoryRevision(
  repositoryRoot: string,
  runGit: AiImageSandboxGitRunner = createAiImageSandboxGitRunner(repositoryRoot),
  requiredTrackedPaths: string[] = [],
  requireGitCheckout = false,
): Promise<string> {
  let deployedRevision = '';
  try {
    deployedRevision = (await readFile(resolve(repositoryRoot, 'DEPLOYED_COMMIT'), 'utf8'))
      .trim()
      .toLowerCase();
    if (!AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(deployedRevision)) {
      throw new Error('DEPLOYED_COMMIT is invalid');
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  let hasGitMetadata = true;
  try {
    await access(resolve(repositoryRoot, '.git'));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    hasGitMetadata = false;
  }
  if (!hasGitMetadata) {
    if (requireGitCheckout) {
      throw Object.assign(new Error('The sandbox command requires a verifiable Git checkout'), {
        code: 'SANDBOX_ADAPTER_GIT_REQUIRED',
      });
    }
    if (deployedRevision) return deployedRevision;
    throw Object.assign(new Error('The sandbox could not bind the adapter to deployed code'), {
      code: 'SANDBOX_ADAPTER_REVISION_UNAVAILABLE',
    });
  }

  const revision = await resolveGitHead(runGit);
  if (AI_IMAGE_SANDBOX_FULL_GIT_OID_PATTERN.test(revision)) {
    if (deployedRevision && revision !== deployedRevision) {
      throw Object.assign(new Error('DEPLOYED_COMMIT does not match the checked-out Git HEAD'), {
        code: 'SANDBOX_ADAPTER_REVISION_MISMATCH',
      });
    }
    await assertGitPathsTracked(runGit, revision, requiredTrackedPaths);
    await assertGitTrackedWorktreeClean(runGit);
    const verifiedRevision = await resolveGitHead(runGit);
    if (verifiedRevision !== revision) {
      throw Object.assign(new Error('Git HEAD changed during sandbox code verification'), {
        code: 'SANDBOX_ADAPTER_REVISION_MISMATCH',
      });
    }
    return deployedRevision || revision;
  }
  throw Object.assign(new Error('The sandbox could not bind the adapter to deployed code'), {
    code: 'SANDBOX_ADAPTER_REVISION_UNAVAILABLE',
  });
}
