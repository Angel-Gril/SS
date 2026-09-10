#!/usr/bin/env node
import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const includeRemote = args.has('--remote') || args.has('--remote-core') || args.has('--remote-oss') || args.has('--all');
const includeRemoteCore = args.has('--remote-core') || args.has('--all');
const includeRemoteOss = args.has('--remote-oss') || args.has('--all');
const includeBuild = args.has('--build') || args.has('--all');

const steps = [
  {
    name: 'preflight child-process exit contract',
    command: 'node',
    args: ['--experimental-vm-modules', '--test', 'scripts/preflight-process-exit.test.mjs'],
  },
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
    name: 'local Docker Compose network security contract',
    command: 'node',
    args: ['--test', 'scripts/local-compose-network-security.test.mjs'],
  },
  {
    name: 'Redis runtime diagnostic contract',
    command: 'node',
    args: ['--test', 'scripts/diagnose-redis-runtime.test.mjs'],
  },
  {
    name: 'extension package versioning and deployment contract',
    command: 'node',
    args: ['scripts/extension-package-auto-bump.test.mjs'],
  },
  {
    name: 'extension live worker identity and Unicode contracts',
    command: 'node',
    args: [
      '--test',
      'scripts/extension-active-worker-attestation.test.mjs',
      'scripts/extension-live-sw-unicode-smoke.test.mjs',
    ],
  },
  {
    name: 'managed extension install diagnostics contract',
    command: 'node',
    args: ['--test', 'scripts/extension-managed-install-diagnostics.test.mjs'],
  },
  {
    name: 'extension CDP launcher argument contract',
    command: 'node',
    args: ['--test', 'scripts/launch-extension-cdp.test.mjs'],
  },
  {
    name: 'Web auth security settings contract',
    command: 'node',
    args: ['scripts/web-auth-security-settings.test.mjs'],
  },
  {
    name: 'typed smoke account token contract',
    command: 'node',
    args: ['--test', 'scripts/create-smoke-token-contract.test.mjs'],
  },
  {
    name: 'Web auth human challenge UI contract',
    command: 'node',
    args: ['scripts/web-auth-human-challenge-ui.test.mjs'],
  },
  {
    name: 'Web auth Turnstile UI contract',
    command: 'node',
    args: ['scripts/web-auth-turnstile-ui.test.mjs'],
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
    name: 'Ozon source listing sandbox contract',
    command: 'node',
    args: ['--test', 'scripts/ozon-source-listing-sandbox-contract.test.mjs'],
  },
  {
    name: 'extension Ozon list performance runtime contract',
    command: 'node',
    args: ['--test', 'scripts/extension-ozon-list-performance-runtime.test.mjs'],
  },
  {
    name: 'extension Seller origin access contract',
    command: 'node',
    args: ['scripts/extension-seller-origin-access.test.mjs'],
  },
  {
    name: 'Web extension device pairing contract',
    command: 'node',
    args: ['--test', 'scripts/web-extension-device-pairing.test.mjs'],
  },
  {
    name: 'AI media provider foundation contract',
    command: 'node',
    args: ['scripts/ai-media-provider-contract.test.mjs'],
  },
  {
    name: 'AI category translation quota and fan-out guard',
    command: 'node',
    args: ['scripts/ai-category-translation-guard.test.mjs'],
  },
  {
    name: 'AI image capability candidate review contract',
    command: 'node',
    args: ['--test', 'scripts/ai-image-capability-candidate.test.mjs'],
  },
  {
    name: 'single-submit AI image sandbox contract',
    command: 'node',
    args: ['scripts/ai-image-single-submit-contract.test.mjs'],
  },
  {
    name: 'single-submit DashScope image translation sandbox contract',
    command: 'node',
    args: ['scripts/ai-image-translation-single-submit-contract.test.mjs'],
  },
  {
    name: 'single-submit AI image sandbox strict typecheck',
    command: 'pnpm',
    args: ['--filter', 'server', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.sandbox.json'],
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
    name: 'REL-04 dark canary contract',
    command: 'node',
    args: ['--test', 'scripts/rel04-dark-canary.test.mjs'],
  },
  {
    name: 'full VPS verification evidence contract',
    command: 'node',
    args: ['--test', 'scripts/vps-verification-evidence.test.mjs'],
  },
  {
    name: 'extension website publication gate contract',
    command: 'node',
    args: ['--test', 'scripts/extension-website-publication-gate.test.mjs'],
  },
  {
    name: 'REL-04 VPS extension release contract',
    command: 'node',
    args: ['--test', 'scripts/verify-vps-extension-release.test.mjs'],
  },
  {
    name: 'deployment backup attestation contract',
    command: 'node',
    args: [
      '--test',
      'scripts/deploy-backup-attestation.test.mjs',
      'scripts/backup-operations-contract.test.mjs',
      'scripts/prune-backup-retention.test.mjs',
    ],
  },
  {
    name: 'deployment Git-bound build input contract',
    command: 'node',
    args: ['--test', 'scripts/deploy-build-inputs.test.mjs'],
  },
  {
    name: 'deployment environment snapshot contract',
    command: 'node',
    args: ['--test', 'scripts/deploy-environment.test.mjs'],
  },
  {
    name: 'deployment source permission contract',
    command: 'node',
    args: ['--test', 'scripts/deploy-source-permissions.test.mjs'],
  },
  {
    name: 'AI media suite post-migration DB guard contract',
    command: 'node',
    args: ['scripts/ai-media-suite-post-migration-guard.test.mjs'],
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
    name: 'extension dual-mode AI image workbench contract',
    command: 'node',
    args: ['scripts/extension-ai-image-workbench-contract.test.mjs'],
  },
  {
    name: 'extension hosted AI image suite workbench adapter contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-workbench-adapter.test.mjs'],
  },
  {
    name: 'extension hosted AI image transport contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-transport.test.mjs'],
  },
  {
    name: 'extension hosted AI image candidate preview bridge contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-candidate-preview-bridge.test.mjs'],
  },
  {
    name: 'extension hosted AI image workbench client contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-workbench-client.test.mjs'],
  },
  {
    name: 'extension hosted AI image workbench client registry contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-workbench-client-registry.test.mjs'],
  },
  {
    name: 'extension hosted AI image runtime dispatcher contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-workbench-runtime-dispatcher.test.mjs'],
  },
  {
    name: 'extension hosted AI image service worker contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-service-worker.test.mjs'],
  },
  {
    name: 'extension hosted AI image runtime page client contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-workbench-runtime-client.test.mjs'],
  },
  {
    name: 'extension hosted AI image candidate preview consumer contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-candidate-preview-consumer.test.mjs'],
  },
  {
    name: 'extension hosted AI image workspace projection contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-workspace-projection.test.mjs'],
  },
  {
    name: 'extension hosted AI image workbench controller contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-workbench-controller.test.mjs'],
  },
  {
    name: 'extension hosted AI image package verifier contract',
    command: 'node',
    args: ['scripts/extension-hosted-ai-image-suite-package-verifier.test.mjs'],
  },
  {
    name: 'extension BYOK profile/session secret contract',
    command: 'node',
    args: ['scripts/extension-byok-profile-store.test.mjs'],
  },
  {
    name: 'extension BYOK device-session lifecycle contract',
    command: 'node',
    args: ['scripts/extension-byok-device-session-lifecycle.test.mjs'],
  },
  {
    name: 'extension device credential manager contract',
    command: 'node',
    args: ['--test', 'scripts/extension-device-credential-manager.test.mjs'],
  },
  {
    name: 'extension BYOK exact-origin permission contract',
    command: 'node',
    args: ['scripts/extension-byok-permission-broker.test.mjs'],
  },
  {
    name: 'extension BYOK permission readiness bridge contract',
    command: 'node',
    args: ['scripts/extension-byok-permission-readiness-bridge.test.mjs'],
  },
  {
    name: 'extension BYOK Provider settings client contract',
    command: 'node',
    args: ['scripts/extension-byok-provider-settings-client.test.mjs'],
  },
  {
    name: 'extension BYOK Provider settings background handler contract',
    command: 'node',
    args: ['scripts/extension-byok-provider-settings-handler.test.mjs'],
  },
  {
    name: 'extension BYOK Provider settings UI contract',
    command: 'node',
    args: ['scripts/extension-byok-provider-settings-ui.test.mjs'],
  },
  {
    name: 'extension BYOK readiness handle cache contract',
    command: 'node',
    args: ['scripts/extension-byok-readiness-handle-cache.test.mjs'],
  },
  {
    name: 'extension BYOK readiness client contract',
    command: 'node',
    args: ['scripts/extension-byok-readiness-client.test.mjs'],
  },
  {
    name: 'extension BYOK execution intent client contract',
    command: 'node',
    args: ['scripts/extension-byok-execution-intent-client.test.mjs'],
  },
  {
    name: 'extension BYOK execution batch client contract',
    command: 'node',
    args: ['scripts/extension-byok-execution-batch-client.test.mjs'],
  },
  {
    name: 'extension BYOK execution intent claim broker contract',
    command: 'node',
    args: ['scripts/extension-byok-execution-intent-claim-broker.test.mjs'],
  },
  {
    name: 'extension BYOK text-to-image client contract',
    command: 'node',
    args: ['scripts/extension-byok-text-to-image-client.test.mjs'],
  },
  {
    name: 'extension BYOK image input inspector contract',
    command: 'node',
    args: ['scripts/extension-byok-image-input-inspector.test.mjs'],
  },
  {
    name: 'extension BYOK image mask transform contract',
    command: 'node',
    args: ['scripts/extension-byok-image-mask-transform.test.mjs'],
  },
  {
    name: 'extension BYOK image edit adapter contract',
    command: 'node',
    args: ['scripts/extension-byok-image-edit-adapters.test.mjs'],
  },
  {
    name: 'extension BYOK image edit probe media contract',
    command: 'node',
    args: ['scripts/extension-byok-image-edit-probe-media.test.mjs'],
  },
  {
    name: 'extension BYOK image edit client contract',
    command: 'node',
    args: ['scripts/extension-byok-image-edit-client.test.mjs'],
  },
  {
    name: 'extension BYOK image edit wiring contract',
    command: 'node',
    args: ['scripts/extension-byok-image-edit-wiring.test.mjs'],
  },
  {
    name: 'extension BYOK media job engine contract',
    command: 'node',
    args: ['scripts/extension-byok-media-job-engine.test.mjs'],
  },
  {
    name: 'extension BYOK Prompt plan contract',
    command: 'node',
    args: ['scripts/extension-byok-prompt-plan.test.mjs'],
  },
  {
    name: 'extension BYOK generated result vault contract',
    command: 'node',
    args: ['scripts/extension-byok-generated-result-vault.test.mjs'],
  },
  {
    name: 'extension BYOK generated result escrow contract',
    command: 'node',
    args: ['scripts/extension-byok-generated-result-vault-persistence.test.mjs'],
  },
  {
    name: 'extension BYOK encrypted batch restart fixture',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-escrow-restart.test.mjs'],
  },
  {
    name: 'extension BYOK generated asset ingest client contract',
    command: 'node',
    args: ['scripts/extension-byok-generated-asset-ingest-client.test.mjs'],
  },
  {
    name: 'extension BYOK generated asset batch ingest client contract',
    command: 'node',
    args: ['scripts/extension-byok-generated-asset-batch-ingest-client.test.mjs'],
  },
  {
    name: 'extension BYOK binary ingest transport contract',
    command: 'node',
    args: ['scripts/extension-byok-ingest-transport.test.mjs'],
  },
  {
    name: 'extension BYOK workbench launch client contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-launch-client.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch launch client contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-launch-client.test.mjs'],
  },
  {
    name: 'extension BYOK tab-bound workbench session contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-launch-session.test.mjs'],
  },
  {
    name: 'extension BYOK one-time workbench preview contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-preview-channel.test.mjs'],
  },
  {
    name: 'extension BYOK workbench page client contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-client.test.mjs'],
  },
  {
    name: 'extension BYOK source media library contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-source-media-library.test.mjs'],
  },
  {
    name: 'extension BYOK workbench runtime handler contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-runtime-handler.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch Provider executor contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-provider-executor.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch coordinator contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-coordinator.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch registry contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-registry.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch runtime handler contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-runtime-handler.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch page client contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-client.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch page controller contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-page-controller.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch recovery UI contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-recovery-ui.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch lifecycle heartbeat contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-lifecycle-heartbeat.test.mjs'],
  },
  {
    name: 'extension BYOK workbench batch service-worker wiring contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-service-worker-wiring.test.mjs'],
  },
  {
    name: 'extension BYOK one-use workbench media channel contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-media-channel.test.mjs'],
  },
  {
    name: 'extension BYOK shared Provider semaphore contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-provider-semaphore.test.mjs'],
  },
  {
    name: 'extension BYOK edit workbench media store contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-edit-media-store.test.mjs'],
  },
  {
    name: 'extension BYOK edit worker epoch guard contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-edit-epoch-guard.test.mjs'],
  },
  {
    name: 'extension BYOK edit workbench controller contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-edit-controller.test.mjs'],
  },
  {
    name: 'extension BYOK selected edit review handoff contract',
    command: 'node',
    args: ['--test', 'scripts/extension-byok-edit-review-handoff.test.mjs'],
  },
  {
    name: 'extension BYOK edit workbench wiring contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-edit-wiring.test.mjs'],
  },
  {
    name: 'extension BYOK edit workbench UI contract',
    command: 'node',
    args: ['scripts/extension-byok-edit-workbench-ui.test.mjs'],
  },
  {
    name: 'extension BYOK workspace state contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-workspace-state.test.mjs'],
  },
  {
    name: 'extension BYOK workspace UI contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-workspace-ui.test.mjs'],
  },
  {
    name: 'extension BYOK workspace slot focus regression',
    command: 'node',
    args: ['scripts/extension-byok-workbench-workspace-focus.regression-1.test.mjs'],
  },
  {
    name: 'extension AI image workbench documentation contract',
    command: 'node',
    args: ['scripts/extension-ai-image-workbench-docs.test.mjs'],
  },
  {
    name: 'extension BYOK workbench package verifier contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-package-verifier.test.mjs'],
  },
  {
    name: 'extension BYOK listing publish coordinator contract',
    command: 'node',
    args: ['scripts/extension-byok-listing-publish-coordinator.test.mjs'],
  },
  {
    name: 'extension unified workbench listing publish coordinator contract',
    command: 'node',
    args: ['scripts/extension-workbench-listing-publish-coordinator.test.mjs'],
  },
  {
    name: 'extension AI image workbench publish controller contract',
    command: 'node',
    args: ['scripts/extension-ai-image-workbench-publish-controller.test.mjs'],
  },
  {
    name: 'extension BYOK workbench UI contract',
    command: 'node',
    args: ['scripts/extension-byok-workbench-ui.test.mjs'],
  },
  {
    name: 'extension BYOK text-to-image vertical fixture',
    command: 'node',
    args: ['scripts/extension-byok-text-to-image-vertical-fixture.test.mjs'],
  },
  {
    name: 'extension BYOK batch vertical fixture',
    command: 'node',
    args: ['scripts/extension-byok-workbench-batch-vertical-fixture.test.mjs'],
  },
  {
    name: 'extension runtime message authorization contract',
    command: 'node',
    args: ['scripts/extension-runtime-message-authorization.test.mjs'],
  },
  {
    name: 'extension standalone media workflow contract',
    command: 'node',
    args: ['scripts/extension-source-media-standalone.test.mjs'],
  },
  {
    name: 'AI image settings UI contract',
    command: 'node',
    args: ['scripts/ai-image-settings-ui.test.mjs'],
  },
  {
    name: 'extension media mask editor contract',
    command: 'node',
    args: ['scripts/extension-media-mask-editor.test.mjs'],
  },
  {
    name: 'extension media editor runtime behavior',
    command: 'node',
    args: ['scripts/extension-media-editor-behavior.test.mjs'],
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
    child.on('close', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
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
