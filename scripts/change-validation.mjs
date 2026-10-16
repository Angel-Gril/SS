#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildChangeValidationPlan, validationPath } from './change-validation-plan.mjs';
import { executeChangeValidation } from './change-validation-runner.mjs';
import { gitCommitTreeEnvironment, gitCommitTreeSafeDirectoryArgs } from './git-commit-tree.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const MAX_FILE = 32 * 1024 * 1024;
function git(root, args) {
  const result = spawnSync('git', [...gitCommitTreeSafeDirectoryArgs(root), ...args], { cwd: root,
    env: gitCommitTreeEnvironment(), shell: false, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) throw new Error('Could not read validation Git inputs');
  return result.stdout;
}
function fileIdentity(file) {
  if (!existsSync(file)) return 'ABSENT';
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_FILE) throw new Error('Unsafe local validation input');
  return hash(readFileSync(file));
}

export function readChangeValidationInput({ repositoryRoot = ROOT, since } = {}) {
  const root = path.resolve(repositoryRoot);
  if (path.resolve(git(root, ['rev-parse', '--show-toplevel']).trim()).toLowerCase() !== root.toLowerCase()) throw new Error('Validation repository root mismatch');
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  if (since && !/^[a-f0-9]{40}$/u.test(since)) throw new Error('--since requires an exact 40-character commit');
  if (since && git(root, ['rev-parse', '--verify', `${since}^{commit}`]).trim() !== since) throw new Error('Validation base commit mismatch');
  const tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  const trackedModes = new Map(git(root, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean).map(row => {
    const match = /^(100644|100755) [a-f0-9]{40} 0\t(.+)$/u.exec(row);
    if (!match) throw new Error('Unsupported Git index mode or unresolved merge');
    return [match[2], match[1]];
  }));
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const changes = new Map();
  const addDiff = args => {
    const rows = git(root, args).split('\0').filter(Boolean);
    for (let index = 0; index < rows.length; index += 2) {
      if (!/^[MADTUXB]$/u.test(rows[index]) || !rows[index + 1]) throw new Error('Invalid Git change list');
      changes.set(validationPath(rows[index + 1]), rows[index]);
    }
  };
  if (since) addDiff(['diff', '--name-status', '--no-renames', '-z', since, head, '--']);
  addDiff(['diff', '--name-status', '--no-renames', '-z', 'HEAD', '--']);
  for (const file of untracked) changes.set(validationPath(file), '??');
  const source = createHash('sha256');
  for (const file of [...new Set([...tracked, ...untracked])].sort()) {
    validationPath(file);
    const absolute = path.join(root, file), exists = existsSync(absolute), stat = exists ? lstatSync(absolute) : null;
    const mode = stat?.isSymbolicLink() ? '120000' : stat && !stat.isFile() ? '160000'
      : stat && process.platform !== 'win32' && (stat.mode & 0o111) ? '100755' : '100644';
    // Symlinks/submodules are never a fast validation input.
    if (stat?.isSymbolicLink() || stat && !stat.isFile()) throw new Error('Unsupported validation input mode');
    source.update(JSON.stringify([file, mode, exists ? fileIdentity(absolute) : 'DELETED']));
  }
  const privateInputFiles = ['.env', '.env.local', 'apps/server/.env', 'apps/web/.env.local',
    'node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml',
    'apps/server/node_modules/.prisma/client/schema.prisma'];
  const privateInputs = privateInputFiles.map(file => [file, fileIdentity(path.join(root, file))]);
  const result = [...changes].sort(([a], [b]) => a.localeCompare(b)).map(([file, status]) => {
    const absolute = path.join(root, file);
    const mode = trackedModes.get(file) === '100755' || existsSync(absolute) && process.platform !== 'win32' && (lstatSync(absolute).mode & 0o111) ? '100755' : '100644';
    return { path: file, status, mode };
  });
  return { changes: result, identity: { gitCommit: head, since: since || null, sourceSha256: source.digest('hex'),
    environmentSha256: hash(JSON.stringify([Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)), privateInputs])),
    nodeVersion: process.version, platform: process.platform, architecture: process.arch } };
}

function commandFor(step) {
  if (step.command === 'node') return { command: process.execPath, args: step.args };
  if (step.command === 'git') return { command: 'git', args: step.args };
  if (step.command !== 'pnpm') throw new Error('Unapproved local validation command');
  if (process.platform !== 'win32') return { command: 'pnpm', args: step.args };
  // Execute pnpm's installed JS entry directly; filenames never enter cmd.exe.
  const located = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8', windowsHide: true });
  if (located.status !== 0) throw new Error('pnpm CLI was not found');
  const entry = path.join(path.dirname(located.stdout.trim().split(/\r?\n/u)[0]), 'node_modules/pnpm/bin/pnpm.cjs');
  if (!existsSync(entry)) throw new Error('pnpm JavaScript entry was not found');
  return { command: process.execPath, args: [entry, ...step.args] };
}
function runLocalStep(root, step) {
  return new Promise(resolve => {
    const spec = commandFor(step), chunks = []; let size = 0, exceeded = false;
    const child = spawn(spec.command, spec.args, { cwd: root, env: { ...process.env, ...step.env }, shell: false, windowsHide: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
      size += bytes.length;
      if (size > 64 * 1024 * 1024) { exceeded = true; child.kill(); return; }
      chunks.push(bytes);
    });
    child.on('error', () => resolve({ status: 1, log: Buffer.from('Could not start local validation command\n') }));
    child.on('close', (status, signal) => resolve({ status: exceeded ? 1 : status, signal,
      log: Buffer.concat(chunks) }));
  });
}

function quickExecutionGuard(root, changes) {
  return hash(JSON.stringify([
    git(root, ['rev-parse', 'HEAD']),
    git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']),
    changes.map(change => [change.path, fileIdentity(path.join(root, change.path))]),
    ['.env', '.env.local', 'apps/server/.env', 'apps/web/.env.local',
      'node_modules/.modules.yaml', 'node_modules/.pnpm/lock.yaml']
      .map(file => [file, fileIdentity(path.join(root, file))]),
    Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b)),
  ]));
}

export async function changeValidationMain(args = process.argv.slice(2), repositoryRoot = ROOT) {
  try {
    if (args.includes('--help')) {
      process.stdout.write('Usage: pnpm validate:change [--since FULL_COMMIT] [--build] [--run --output NEW_PRIVATE_DIRECTORY [--resume PRIVATE_RECEIPT_OR_CHECKPOINT]]\nDefault: show a local verification plan only. No Provider/Ozon, deployment or publication actions.\n');
      return 0;
    }
    const options = {}; let run = false, build = false;
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === '--run' && !run) run = true;
      else if (key === '--build' && !build) build = true;
      else if (['--since', '--output', '--resume'].includes(key) && !options[key] && args[index + 1] && !args[index + 1].startsWith('--')) options[key] = args[++index];
      else throw new Error('Invalid change-validation arguments');
    }
    if (!run && (options['--output'] || options['--resume'])) throw new Error('--output/--resume require --run');
    const root = path.resolve(repositoryRoot), read = () => readChangeValidationInput({ repositoryRoot: root, since: options['--since'] });
    const current = read(), plan = buildChangeValidationPlan({ changes: current.changes, build });
    if (!run) { process.stdout.write(JSON.stringify({ ...plan, input: current.identity }, null, 2) + '\n'); return 0; }
    if (!options['--output'] || !path.isAbsolute(options['--output'])) throw new Error('--run requires an absolute new private output directory');
    const output = path.resolve(options['--output']), relative = path.relative(root, output), parent = path.dirname(output);
    if ((!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) || existsSync(output)
      || realpathSync(parent).toLowerCase() !== parent.toLowerCase()) throw new Error('Output must be new and outside repository');
    mkdirSync(output, { mode: 0o700 });
    const guard = quickExecutionGuard(root, current.changes);
    const receipt = await executeChangeValidation({ plan, input: current.identity, outputDirectory: output,
      resumePath: options['--resume'], readInput: ({ phase }) => phase === 'final' ? read().identity
        : quickExecutionGuard(root, current.changes) === guard ? current.identity : { changed: true },
      runStep: step => runLocalStep(root, step),
      onStep: row => process.stdout.write(JSON.stringify(row) + '\n') });
    process.stdout.write(JSON.stringify({ status: receipt.status, profile: receipt.profile,
      formalReleaseEvidence: false, outputDirectory: output, steps: receipt.steps.length }) + '\n');
    return receipt.exitCode;
  } catch (error) {
    process.stderr.write('change-validation: ' + error.message + '\n');
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await changeValidationMain();
