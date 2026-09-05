import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertRuntimeModeSafety } from '../lib/runtime-mode-safety.js';

describe('runtime mode safety', () => {
  it.each([
    [{ NODE_ENV: 'production', RUNTIME_MODE: 'local', REDIS_DISABLED: '1' }],
    [{ NODE_ENV: 'development', RUNTIME_MODE: 'cloud', REDIS_DISABLED: 'true' }],
    [{ NODE_ENV: 'production', RUNTIME_MODE: 'cloud', REDIS_DISABLED: '1' }],
  ])('rejects Noop Redis for production or cloud runtime %#', (environment) => {
    expect(() => assertRuntimeModeSafety(environment)).toThrow(/REDIS_DISABLED/u);
  });

  it.each([
    [{ NODE_ENV: 'development', RUNTIME_MODE: 'local', REDIS_DISABLED: '1' }],
    [{ NODE_ENV: 'test', RUNTIME_MODE: 'local', REDIS_DISABLED: 'true' }],
    [{ NODE_ENV: 'production', RUNTIME_MODE: 'cloud', REDIS_DISABLED: '0', REDIS_URL: 'redis://redis:6379' }],
  ])('allows an explicit local/test fallback or a real cloud Redis %#', (environment) => {
    expect(() => assertRuntimeModeSafety(environment)).not.toThrow();
  });

  it('is invoked after external configuration is loaded and before bootstrap completes', () => {
    const source = readFileSync(new URL('../bootstrap-config.ts', import.meta.url), 'utf8');
    const loadIndex = source.indexOf('loadExternalConfig();');
    const safetyIndex = source.indexOf('assertRuntimeModeSafety(process.env)');

    expect(loadIndex).toBeGreaterThan(-1);
    expect(safetyIndex).toBeGreaterThan(loadIndex);
  });
});
