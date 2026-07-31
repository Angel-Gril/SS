import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  stdout = process.stdout,
  stderr = process.stderr,
  platform = process.platform,
  comSpec = process.env.ComSpec || 'cmd.exe',
  repositoryRoot = REPOSITORY_ROOT,
} = {}) {
  stdout.write('QA-04 offline rehearsal\n');
  stdout.write('Formal QA-04 completion still requires complete QA-02 evidence.\n');

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

  stdout.write('\n[qa04-offline] all offline rehearsal checks passed\n');
  return 0;
}

export function qa04OfflineMain(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--list') {
    process.stdout.write(`${JSON.stringify(qa04OfflineManifest(), null, 2)}\n`);
    return 0;
  }

  if (args.length > 0) {
    process.stderr.write('Usage: node scripts/qa04-offline-gate.mjs [--list]\n');
    return 2;
  }

  return runQa04OfflineGate();
}

const isDirectRun =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  process.exitCode = qa04OfflineMain();
}
