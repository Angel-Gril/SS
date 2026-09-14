import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const QA04_OFFLINE_STEPS = Object.freeze(
  [
    {
      id: 'gate-contract',
      name: 'QA-04 offline gate contract',
      command: 'pnpm',
      args: ['test:qa04:offline-contract'],
    },
    {
      id: 'diff-check',
      name: 'Git whitespace and conflict-marker check',
      command: 'git',
      args: ['diff', '--check'],
    },
    {
      id: 'workspace-lint',
      name: 'Workspace lint',
      command: 'pnpm',
      args: ['lint'],
    },
    {
      id: 'workspace-typecheck',
      name: 'Workspace typecheck',
      command: 'pnpm',
      args: ['typecheck'],
    },
    {
      id: 'preflight-build',
      name: 'Full local preflight with builds',
      command: 'pnpm',
      args: ['preflight', '--build'],
    },
    {
      id: 'scope-revocation-postgres',
      name: 'PostgreSQL command-grant scope and session revocation',
      command: 'pnpm',
      args: ['--filter', 'server', 'test:qa04:scope-revocation:postgres'],
    },
    {
      id: 'ai-media-postgres',
      name: 'AI Media PostgreSQL integration and upgrade replay',
      command: 'pnpm',
      args: ['--filter', 'server', 'test:ai-media:postgres'],
    },
    {
      id: 'extension-cloud',
      name: 'Cloud extension build and strict verification',
      command: 'pnpm',
      args: ['build:extension:cloud'],
    },
    {
      id: 'extension-local',
      name: 'Local extension build and verification',
      command: 'pnpm',
      args: ['build:extension:local'],
    },
  ].map((step) => Object.freeze({ ...step, args: Object.freeze([...step.args]) })),
);

export function qa04OfflineManifest() {
  return {
    schemaVersion: 1,
    gateId: 'QA-04_OFFLINE_REHEARSAL',
    formalTaskId: 'QA-04',
    formalPrerequisiteTaskId: 'QA-02',
    completesFormalTask: false,
    externalAccess: 'NO_PROVIDER_OR_VPS',
    steps: QA04_OFFLINE_STEPS.map((step) => ({
      id: step.id,
      name: step.name,
      command: step.command,
      args: [...step.args],
    })),
  };
}

export function parseQa04OfflineEvidence(value, expectedGitCommit, observedAt) {
  const keys = ['schemaVersion', 'kind', 'gitCommit', 'startedAt', 'completedAt',
    'status', 'command', 'completesFormalTask', 'externalAccess', 'steps'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort())
    || value.schemaVersion !== 1 || value.kind !== 'SS_ERP_QA04_OFFLINE_REHEARSAL'
    || !/^[a-f0-9]{40}$/u.test(expectedGitCommit) || value.gitCommit !== expectedGitCommit
    || value.status !== 'PASS' || value.command !== 'pnpm qa:04:offline'
    || value.completesFormalTask !== false || value.externalAccess !== 'NO_PROVIDER_OR_VPS'
    || JSON.stringify(value.steps) !== JSON.stringify(QA04_OFFLINE_STEPS.map(step => step.id))) {
    throw new Error('Invalid native QA-04 offline evidence');
  }
  for (const timestamp of [value.startedAt, value.completedAt, observedAt]) {
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))
      || new Date(timestamp).toISOString() !== timestamp) {
      throw new Error('Invalid offline evidence timestamp');
    }
  }
  const age = Date.parse(observedAt) - Date.parse(value.completedAt);
  if (Date.parse(value.startedAt) > Date.parse(value.completedAt)
    || age < 0 || age > 24 * 60 * 60 * 1000) {
    throw new Error('Offline evidence is stale or its timestamps are out of order');
  }
  return value;
}

function assertEvidenceOutputPath(outputPath, repositoryRoot) {
  if (typeof outputPath !== 'string' || !path.isAbsolute(outputPath)) {
    throw new Error('Offline evidence requires an absolute private output path');
  }
  const absolute = path.resolve(outputPath);
  const relative = path.relative(path.resolve(repositoryRoot), absolute);
  const parent = path.dirname(absolute);
  const canonicalParent = realpathSync(parent);
  const sameParent = process.platform === 'win32'
    ? canonicalParent.toLowerCase() === parent.toLowerCase() : canonicalParent === parent;
  if ((!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    || !sameParent || lstatSync(parent).isSymbolicLink() || !lstatSync(parent).isDirectory()) {
    throw new Error('Offline evidence output must be new and outside the repository in a real directory');
  }
  try {
    lstatSync(absolute);
    throw new Error('Offline evidence output already exists');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return absolute;
}

function runGitProvenanceCommand(runner, repositoryRoot, args, label) {
  let result;
  try {
    result = runner('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`${label} could not start: ${error.message}`);
  }
  if (result?.error) throw new Error(`${label} could not start: ${result.error.message}`);
  if (result?.status !== 0) throw new Error(`${label} exited with ${result?.status ?? 1}`);
  return String(result.stdout || '').trim();
}

export function readQa04GitProvenance({
  repositoryRoot = REPOSITORY_ROOT,
  runner = spawnSync,
} = {}) {
  const actualRoot = path.resolve(runGitProvenanceCommand(
    runner,
    repositoryRoot,
    ['rev-parse', '--show-toplevel'],
    'git root check',
  ));
  if (actualRoot !== path.resolve(repositoryRoot)) {
    throw new Error('repository root does not match the QA-04 working directory');
  }
  const gitCommit = runGitProvenanceCommand(
    runner,
    repositoryRoot,
    ['rev-parse', '--verify', 'HEAD'],
    'git commit check',
  ).toLowerCase();
  if (!/^[a-f0-9]{40}$/u.test(gitCommit)) {
    throw new Error('HEAD is not one exact 40-character Git commit');
  }
  const status = runGitProvenanceCommand(
    runner,
    repositoryRoot,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'git worktree check',
  );
  if (status) throw new Error('worktree is not clean');
  return { repositoryRoot: actualRoot, gitCommit };
}

function spawnSpec(step, platform, comSpec) {
  if (platform === 'win32' && step.command === 'pnpm') {
    return {
      command: comSpec,
      args: ['/d', '/s', '/c', displayCommand(step)],
    };
  }

  return {
    command: step.command === 'node' ? process.execPath : step.command,
    args: [...step.args],
  };
}

function displayCommand(step) {
  return [step.command, ...step.args].join(' ');
}

export function runQa04OfflineGate({
  runner = spawnSync,
  gitRunner = spawnSync,
  stdout = process.stdout,
  stderr = process.stderr,
  platform = process.platform,
  comSpec = process.env.ComSpec || 'cmd.exe',
  repositoryRoot = REPOSITORY_ROOT,
  evidenceOutputPath,
  now = () => new Date(),
} = {}) {
  stdout.write('QA-04 offline rehearsal\n');
  stdout.write('Formal QA-04 completion still requires complete QA-02 evidence.\n');
  let startedAt;
  if (evidenceOutputPath !== undefined) {
    try {
      assertEvidenceOutputPath(evidenceOutputPath, repositoryRoot);
      startedAt = now().toISOString();
    } catch {
      stderr.write('[qa04-offline] Offline evidence output rejected\n');
      return 1;
    }
  }
  let initialProvenance;
  try {
    initialProvenance = readQa04GitProvenance({
      repositoryRoot,
      runner: gitRunner,
    });
  } catch (error) {
    stderr.write(`[qa04-offline] Git provenance rejected: ${error.message}\n`);
    return 1;
  }
  stdout.write(`Git commit: ${initialProvenance.gitCommit}\n`);

  for (const step of QA04_OFFLINE_STEPS) {
    stdout.write(`\n[qa04-offline] ${step.name}\n`);
    stdout.write(`$ ${displayCommand(step)}\n`);

    let result;
    try {
      const resolved = spawnSpec(step, platform, comSpec);
      result = runner(resolved.command, resolved.args, {
        cwd: repositoryRoot,
        shell: false,
        stdio: 'inherit',
        windowsHide: true,
      });
    } catch (error) {
      stderr.write(`[qa04-offline] failed to start ${step.id}: ${error.message}\n`);
      return 1;
    }

    if (result.error) {
      stderr.write(`[qa04-offline] failed to start ${step.id}: ${result.error.message}\n`);
      return 1;
    }

    const status = Number.isInteger(result.status) ? result.status : 1;
    if (status !== 0) {
      const signal = result.signal ? ` (signal ${result.signal})` : '';
      stderr.write(`[qa04-offline] FAILED at ${step.id}: exit ${status}${signal}\n`);
      return status;
    }
  }

  let finalProvenance;
  try {
    finalProvenance = readQa04GitProvenance({
      repositoryRoot,
      runner: gitRunner,
    });
  } catch (error) {
    stderr.write(`[qa04-offline] Git provenance rejected after checks: ${error.message}\n`);
    return 1;
  }
  if (finalProvenance.repositoryRoot !== initialProvenance.repositoryRoot
    || finalProvenance.gitCommit !== initialProvenance.gitCommit) {
    stderr.write('[qa04-offline] Git provenance changed while the gate was running\n');
    return 1;
  }

  if (evidenceOutputPath !== undefined) {
    try {
      const completedAt = now().toISOString();
      const evidence = parseQa04OfflineEvidence({
        schemaVersion: 1, kind: 'SS_ERP_QA04_OFFLINE_REHEARSAL',
        gitCommit: finalProvenance.gitCommit, startedAt, completedAt, status: 'PASS',
        command: 'pnpm qa:04:offline', completesFormalTask: false,
        externalAccess: 'NO_PROVIDER_OR_VPS', steps: QA04_OFFLINE_STEPS.map(step => step.id),
      }, initialProvenance.gitCommit, completedAt);
      const output = assertEvidenceOutputPath(evidenceOutputPath, repositoryRoot);
      writeNewArtifactDurably(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    } catch {
      stderr.write('[qa04-offline] Offline evidence could not be recorded\n');
      return 1;
    }
  }
  stdout.write('\n[qa04-offline] all offline rehearsal checks passed\n');
  return 0;
}

export function qa04OfflineMain(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--list') {
    process.stdout.write(`${JSON.stringify(qa04OfflineManifest(), null, 2)}\n`);
    return 0;
  }

  if (args.length === 2 && args[0] === '--output' && !args[1].startsWith('--')) {
    return runQa04OfflineGate({ evidenceOutputPath: args[1] });
  }

  if (args.length > 0) {
    process.stderr.write('Usage: node scripts/qa04-offline-gate.mjs [--list | --output PRIVATE_FILE]\n');
    return 2;
  }

  return runQa04OfflineGate();
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  process.exitCode = qa04OfflineMain();
}
