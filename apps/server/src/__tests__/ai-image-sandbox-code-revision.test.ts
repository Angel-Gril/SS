import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveAiImageSandboxRepositoryRevision,
  sanitizeAiImageSandboxGitEnvironment,
} from '../services/ai-image-sandbox-code-revision.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    assert.equal(dirname(target).toLowerCase(), resolve(tmpdir()).toLowerCase());
    assert(basename(target).startsWith('sandbox-code-revision-'));
    await rm(target, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sandbox-code-revision-'));
  directories.push(root);
  const git = async (args: string[]) => {
    const result = await execFileAsync('git', [
      '-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false',
      ...args,
    ], { cwd: root, env: sanitizeAiImageSandboxGitEnvironment(), windowsHide: true, timeout: 10_000 });
    return result.stdout;
  };
  await git(['init']);
  await git(['config', 'core.autocrlf', 'false']);
  await mkdir(join(root, 'source'));
  const paths = Array.from({ length: 35 }, (_, index) => `source/owner-${index}.ts`);
  for (const [index, path] of paths.entries()) {
    await writeFile(join(root, path), `export const value = ${index};${index === 0 ? '\r\n' : '\n'}`);
  }
  await writeFile(join(root, '.gitattributes'),
    'source/*.ts text eol=lf\nsource/owner-0.ts text eol=crlf\nsource/*.bin -text\n');
  await writeFile(join(root, 'source/raw.bin'), Buffer.from('binary\r\nbytes\x00\r\n'));
  await git(['add', '--', '.gitattributes', ...paths, 'source/raw.bin']);
  await git(['-c', 'user.name=Code Revision Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '-m', 'test: bind sandbox source files']);
  const revision = (await git(['rev-parse', '--verify', 'HEAD'])).trim();
  return { root, git, paths, revision };
}

describe('sandbox code revision verification', () => {
  it('bounds Git child processes when verifying a full dependency list, including duplicate paths', async () => {
    const value = await fixture();
    const calls: string[][] = [];
    const runGit = async (args: string[]) => {
      calls.push(args);
      return value.git(args);
    };
    await expect(resolveAiImageSandboxRepositoryRevision(value.root, runGit,
      [...value.paths, value.paths[0]!, value.paths[34]!], true)).resolves.toBe(value.revision);
    expect(calls.length).toBeLessThanOrEqual(6);
  }, 15_000);

  it('preserves per-file Git normalization for CRLF text and binary bytes', async () => {
    const value = await fixture();
    const source = await readFile(join(value.root, value.paths[0]!), 'utf8');
    expect(source).toContain('\r\n');
    await expect(resolveAiImageSandboxRepositoryRevision(value.root, value.git,
      [...value.paths, 'source/raw.bin'], true)).resolves.toBe(value.revision);
  }, 15_000);

  it.each(['--assume-unchanged', '--skip-worktree'])(
    'rejects changed source even when Git status hides it with %s', async flag => {
      const value = await fixture();
      const changed = value.paths[17]!;
      await value.git(['update-index', flag, '--', changed]);
      await writeFile(join(value.root, changed), 'export const value = "tampered";\n');
      expect((await value.git(['status', '--porcelain=v1', '--untracked-files=no'])).trim()).toBe('');
      await expect(resolveAiImageSandboxRepositoryRevision(value.root, value.git, value.paths, true))
        .rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_FILE_DIRTY' });
    }, 15_000,
  );

  it.each(['source/untracked.ts', 'source'])(
    'requires each exact path to be tracked, including %s', async path => {
      const value = await fixture();
      await writeFile(join(value.root, 'source/untracked.ts'), 'export {};\n');
      await expect(resolveAiImageSandboxRepositoryRevision(value.root, value.git,
        [value.paths[0]!, path, value.paths[34]!], true))
        .rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_FILE_UNTRACKED' });
    }, 15_000,
  );

  it('rejects a dirty tracked file outside the required dependency list', async () => {
    const value = await fixture();
    await writeFile(join(value.root, value.paths[34]!), 'export const changed = true;\n');
    await value.git(['add', '--', value.paths[34]!]);
    await expect(resolveAiImageSandboxRepositoryRevision(value.root, value.git, [value.paths[0]!], true))
      .rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_WORKTREE_DIRTY' });
  });

  it('rejects HEAD changing during verification of multiple files', async () => {
    const value = await fixture();
    const runGit = async (args: string[]) => {
      const result = await value.git(args);
      if (args[0] === 'status') {
        await value.git(['-c', 'user.name=Code Revision Fixture', '-c', 'user.email=fixture@example.invalid',
          'commit', '--allow-empty', '-m', 'test: concurrent HEAD change']);
      }
      return result;
    };
    await expect(resolveAiImageSandboxRepositoryRevision(value.root, runGit, value.paths, true))
      .rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_REVISION_MISMATCH' });
  }, 15_000);

  it.each(['hash-object', 'rev-parse'])(
    'rejects an incomplete object list from %s', async command => {
      const value = await fixture();
      const runGit = async (args: string[]) => {
        const result = await value.git(args);
        if (args[0] === command && args[1] !== '--verify') {
          return result.trim().split(/\r?\n/u).slice(1).join('\n');
        }
        return result;
      };
      await expect(resolveAiImageSandboxRepositoryRevision(value.root, runGit, value.paths, true))
        .rejects.toMatchObject({ code: 'SANDBOX_ADAPTER_FILE_DIRTY' });
    }, 15_000,
  );
});
