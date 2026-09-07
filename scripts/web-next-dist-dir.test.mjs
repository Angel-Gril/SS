import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';
const PHASE_PRODUCTION_BUILD = 'phase-production-build';
const PHASE_PRODUCTION_SERVER = 'phase-production-server';
const repoRoot = process.cwd();
const webRoot = path.join(repoRoot, 'apps/web');
const configUrl = pathToFileURL(path.join(webRoot, 'next.config.mjs')).href;

async function loadConfigs({ sentryEnabled, cacheKey }) {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (sentryEnabled) {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@example.invalid/1';
  } else {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  }

  const previousCwd = process.cwd();
  process.chdir(webRoot);
  try {
    const { default: createNextConfig } = await import(`${configUrl}?case=${cacheKey}`);
    assert.equal(typeof createNextConfig, 'function', 'Next config should be phase-aware');

    const dev = createNextConfig(PHASE_DEVELOPMENT_SERVER, { defaultConfig: {} });
    return sentryEnabled ? { dev } : {
      dev,
      build: createNextConfig(PHASE_PRODUCTION_BUILD, { defaultConfig: {} }),
      start: createNextConfig(PHASE_PRODUCTION_SERVER, { defaultConfig: {} }),
    };
  } finally {
    process.chdir(previousCwd);
    if (originalDsn === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
    }
  }
}

const configs = await loadConfigs({ sentryEnabled: false, cacheKey: 'without-sentry' });
assert.equal(configs.dev.distDir, '.next-dev', 'next dev should use .next-dev');
assert.equal(configs.build.distDir, '.next', 'next build should use .next');
assert.equal(configs.start.distDir, '.next', 'next start should use .next');

const sentryConfigs = await loadConfigs({ sentryEnabled: true, cacheKey: 'with-sentry' });
assert.equal(
  sentryConfigs.dev.distDir,
  '.next-dev',
  'Sentry wrapping should preserve the development dist directory',
);
assert.deepEqual(
  sentryConfigs.dev.experimental?.clientTraceMetadata,
  ['baggage', 'sentry-trace'],
  'Next 15 Sentry tracing should add the canonical client trace metadata contract',
);

const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
const dockerignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
const ciWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const webPackage = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'));
const postcssConfig = fs.readFileSync(path.join(webRoot, 'postcss.config.js'), 'utf8');
const tsconfig = JSON.parse(fs.readFileSync(path.join(webRoot, 'tsconfig.json'), 'utf8'));

assert.equal(
  webPackage.type,
  'module',
  'Web package must declare ESM for imported TypeScript modules and Next config',
);
assert.match(postcssConfig, /^export default \{/m, 'PostCSS config must use ESM in the ESM Web package');
assert.doesNotMatch(postcssConfig, /\bmodule\.exports\b/u, 'PostCSS config must not use CommonJS globals');

assert.match(gitignore, /^\.next-dev\/$/m, 'root .next-dev output should be ignored');
assert.match(gitignore, /^\*\*\/\.next-dev\/$/m, 'workspace .next-dev output should be ignored');
assert.match(dockerignore, /^\.next-dev$/m, 'root .next-dev output should be excluded from Docker');
assert.match(
  dockerignore,
  /^\*\*\/\.next-dev$/m,
  'workspace .next-dev output should be excluded from Docker',
);
assert.ok(
  tsconfig.include.includes('.next-dev/types/**/*.ts'),
  'TypeScript should include generated Next dev types',
);
assert.ok(
  tsconfig.include.includes('.next/types/**/*.ts'),
  'TypeScript should keep generated production build types',
);
assert.match(
  ciWorkflow,
  /node scripts\/web-next-dist-dir\.test\.mjs/u,
  'CI must run the Next dist directory isolation contract',
);

console.log('PASS web Next dist directory isolation');
