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
    name: 'Web deployment domain config contract',
    command: 'node',
    args: ['scripts/web-deployment-domain-config.test.mjs'],
  },
  {
    name: 'Aliyun SMS configuration contract',
    command: 'node',
    args: ['scripts/aliyun-sms-config.test.mjs'],
  },
  {
    name: 'VPS origin-mode deployment contract',
    command: 'node',
    args: ['scripts/vps-origin-mode-contract.test.mjs'],
  },
  {
    name: 'Web auth security settings contract',
    command: 'node',
    args: ['scripts/web-auth-security-settings.test.mjs'],
  },
  {
    name: 'Web admin runtime settings UI contract',
    command: 'node',
    args: ['scripts/web-admin-runtime-settings-ui.test.mjs'],
  },
  {
    name: 'Web Next dist directory isolation contract',
    command: 'node',
    args: ['scripts/web-next-dist-dir.test.mjs'],
  },
  {
    name: 'Web Ozon video probe surface contract',
    command: 'node',
    args: ['scripts/web-ozon-video-probe-routing.test.mjs'],
  },
  {
    name: 'AI media provider foundation contract',
    command: 'node',
    args: ['scripts/ai-media-provider-contract.test.mjs'],
  },
  {
    name: 'single-submit AI image sandbox contract',
    command: 'node',
    args: ['scripts/ai-image-single-submit-contract.test.mjs'],
  },
  {
    name: 'single-submit AI image sandbox typecheck',
    command: 'pnpm',
    args: [
      '--filter', 'server', 'exec', 'tsc', '--noEmit', '--target', 'ES2022',
      '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--esModuleInterop',
      '--skipLibCheck', 'scripts/ai-image-provider-single-submit.ts',
    ],
  },
  {
    name: 'AI media evaluation policy contract',
    command: 'node',
    args: ['scripts/ai-media-evaluation-contract.test.mjs'],
  },
  {
    name: 'AI media model-planning evaluation contract',
    command: 'node',
    args: ['scripts/ai-media-model-planning-evaluation-contract.test.mjs'],
  },
  {
    name: 'AI provider dispatch deployment safety contract',
    command: 'node',
    args: ['scripts/ai-provider-dispatch-deploy-safety.test.mjs'],
  },
  {
    name: 'AI media dark deployment contract',
    command: 'node',
    args: ['scripts/ai-media-dark-deploy.test.mjs'],
  },
  {
    name: 'admin AI cost reconciliation contract',
    command: 'node',
    args: ['scripts/web-admin-ai-cost-reconciliation.test.mjs'],
  },
  {
    name: 'admin AI Provider-result reconciliation contract',
    command: 'node',
    args: ['scripts/web-ai-provider-reconciliation.test.mjs'],
  },
  {
    name: 'Web AI media edit workbench contract',
    command: 'node',
    args: ['scripts/web-ai-media-edit-workbench.test.mjs'],
  },
  {
    name: 'Web AI media behavior contract',
    command: 'node',
    args: ['scripts/web-ai-media-behavior.test.mjs'],
  },
  {
    name: 'Web AI media application ledger contract',
    command: 'node',
    args: ['scripts/web-ai-media-application-ledger.test.mjs'],
  },
  {
    name: 'Web AI media plan slot editor contract',
    command: 'node',
    args: ['scripts/web-ai-media-plan-slot-editor.test.mjs'],
  },
  {
    name: 'Web AI media listing-draft application contract',
    command: 'node',
    args: ['scripts/web-ai-media-listing-draft-application.test.mjs'],
  },
  {
    name: 'Web AI media recovery contract',
    command: 'node',
    args: ['scripts/web-ai-media-recovery.test.mjs'],
  },
  {
    name: 'source marketplace network contract',
    command: 'node',
    args: ['scripts/source-marketplace-contract.test.mjs'],
  },
  {
    name: 'extension source network lifecycle contract',
    command: 'node',
    args: ['scripts/extension-source-network-capture.test.mjs'],
  },
  {
    name: 'extension source listing workbench contract',
    command: 'node',
    args: ['scripts/extension-source-listing-workbench.test.mjs'],
  },
  {
    name: 'server tests',
    command: 'pnpm',
    args: ['--filter', 'server', 'test'],
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
