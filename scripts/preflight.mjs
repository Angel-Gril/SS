#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const includeRemote = args.has('--remote') || args.has('--remote-core') || args.has('--remote-oss') || args.has('--all');
const includeRemoteCore = args.has('--remote-core') || args.has('--all');
const includeRemoteOss = args.has('--remote-oss') || args.has('--all');
const includeBuild = args.has('--build') || args.has('--all');

const steps = [
  {
    name: 'server typecheck',
    command: 'pnpm',
    args: ['--filter', 'server', 'typecheck'],
  },
  {
    name: 'web typecheck',
    command: 'pnpm',
    args: ['--filter', 'web', 'typecheck'],
  },
  {
    name: 'server tests',
    command: 'pnpm',
    args: ['--filter', 'server', 'test'],
  },
  {
    name: 'repository regression tests',
    command: 'pnpm',
    args: ['test:repo'],
  },
  {
    name: 'extension static verification',
    command: 'pnpm',
    args: ['verify:extension'],
  },
];

if (includeBuild) {
  steps.push(
    {
      name: 'server build',
      command: 'pnpm',
      args: ['--filter', 'server', 'build'],
    },
    {
      name: 'web build',
      command: 'pnpm',
      args: ['--filter', 'web', 'build'],
    },
    {
      name: 'cloud extension package',
      command: 'pnpm',
      args: ['build:extension:cloud'],
    },
    {
      name: 'cloud extension package verification',
      command: 'pnpm',
      args: ['verify:extension'],
      env: {
        STRICT_EXTENSION_CHECK: '1',
        EXTENSION_DIR: 'build/extensions/ss-erp-cloud',
      },
    },
  );
}

if (includeRemote) {
  steps.push({
    name: 'remote public smoke',
    command: 'pnpm',
    args: ['smoke:remote'],
  });
}

if (includeRemoteCore) {
  const remoteCoreEnv = {
    SMOKE_EXPECT_RUNTIME: 'any',
    SMOKE_EXPECT_UPLOAD: 'false',
    SMOKE_EXPECT_OSS: 'false',
  };
  if (!process.env.SMOKE_USER_TOKEN && !process.env.SMOKE_USER_COOKIE) {
    remoteCoreEnv.SMOKE_CREATE_TEMP_USER = 'true';
  }
  steps.push({
    name: 'remote authenticated core smoke',
    command: 'pnpm',
    args: ['smoke:remote'],
    env: remoteCoreEnv,
  });
}

if (includeRemoteOss) {
  const remoteOssEnv = {
    SMOKE_EXPECT_UPLOAD: 'true',
    SMOKE_EXPECT_OSS: 'true',
    SMOKE_EXPECT_RUNTIME: undefined,
  };
  if (!process.env.SMOKE_USER_TOKEN && !process.env.SMOKE_USER_COOKIE) {
    remoteOssEnv.SMOKE_CREATE_TEMP_USER = 'true';
  }
  steps.push({
    name: 'remote R2/OSS upload smoke',
    command: 'pnpm',
    args: ['smoke:remote'],
    env: remoteOssEnv,
  });
}

function formatCommand(step) {
  return [step.command, ...step.args].join(' ');
}

function quoteWindowsArg(value) {
  if (/^[A-Za-z0-9_./:=@-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function resolveSpawn(step) {
  if (process.platform !== 'win32') {
    return { command: step.command, args: step.args };
  }

  const shellCommand = [step.command, ...step.args].map(quoteWindowsArg).join(' ');
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', shellCommand],
  };
}

function runStep(step) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const [key, value] of Object.entries(step.env || {})) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }

    console.log(`\n=== ${step.name} ===`);
    console.log(`$ ${formatCommand(step)}`);
    const spawnSpec = resolveSpawn(step);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      env,
      stdio: 'inherit',
    });
    child.on('close', (code) => resolve(code || 0));
    child.on('error', (error) => {
      console.error(`[preflight] failed to start ${step.name}: ${error.message}`);
      resolve(1);
    });
  });
}

console.log('SS ERP preflight');
console.log(`Options: ${process.argv.slice(2).join(' ') || '(default local checks)'}`);

for (const step of steps) {
  const code = await runStep(step);
  if (code !== 0) {
    console.error(`\n[preflight] FAILED: ${step.name} exited with ${code}`);
    process.exit(code);
  }
}

console.log('\n[preflight] all selected checks passed');
