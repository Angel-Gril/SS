import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const scriptUrl = new URL('./preflight.mjs', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');

async function runPreflight(firstResult, { argv = ['node', 'scripts/preflight.mjs'], env = {} } = {}) {
  const commands = [];
  const logs = [];
  const errors = [];
  const exits = [];
  const exitSentinel = new Error('synthetic preflight exit');
  const context = createContext({
    console: {
      log: (...parts) => logs.push(parts.join(' ')),
      error: (...parts) => errors.push(parts.join(' ')),
    },
    process: {
      argv,
      env,
      platform: process.platform,
      exit: (code) => { exits.push(code); throw exitSentinel; },
    },
  });
  const childProcess = new SyntheticModule(['spawn'], function () {
    this.setExport('spawn', (command, args) => {
      const first = commands.length === 0;
      commands.push({ command, args });
      const child = new EventEmitter();
      queueMicrotask(() => {
        if (first && firstResult.error) child.emit('error', new Error(firstResult.error));
        child.emit('close', first ? firstResult.code : 0, first ? firstResult.signal : null);
      });
      return child;
    });
  }, { context });
  // Run the complete production script. Every external command is an inert
  // child-process boundary, including this contract's own preflight entry.
  const script = new SourceTextModule(source, { context, identifier: scriptUrl.href,
    initializeImportMeta(meta) { meta.url = scriptUrl.href; } });
  await script.link((specifier) => {
    if (specifier === 'node:url') return new SyntheticModule(['pathToFileURL'], function () {
      this.setExport('pathToFileURL', pathToFileURL);
    }, { context });
    assert.equal(specifier, 'node:child_process', 'unexpected preflight dependency');
    return childProcess;
  });
  try {
    await script.evaluate({ timeout: 1_000 });
  } catch (error) {
    if (error !== exitSentinel) throw error;
  }
  return { commands, logs, errors, exits, namespace: script.namespace };
}

test('the shared preflight manifest is importable without running checks and has stable unique IDs', async () => {
  const result = await runPreflight({ code: 0, signal: null }, { argv: ['node', 'other-script.mjs'] });
  assert.equal(result.commands.length, 0, 'importing the shared manifest must not execute preflight');
  assert.equal(typeof result.namespace.preflightSteps, 'function');
  const steps = result.namespace.preflightSteps({ build: true });
  assert.ok(steps.length > 100);
  assert.equal(new Set(steps.map(step => step.id)).size, steps.length);
  assert.ok(steps.every(step => typeof step.id === 'string' && step.id.length > 0));
  for (const id of ['server-typecheck', 'web-typecheck', 'server-test', 'extension-verify', 'server-build', 'web-build']) {
    assert.ok(steps.some(step => step.id === id), `the full manifest must include ${id}`);
  }
  assert.ok(Object.isFrozen(steps));
  assert.ok(steps.every(step => Object.isFrozen(step) && Object.isFrozen(step.args)));
  assert.equal(steps.some(step => step.id.startsWith('remote-')), false,
    'the local manifest must not acquire external checks from the importing caller');
  const remoteSteps = result.namespace.preflightSteps({ build: true, remoteCore: true, remoteOss: true, env: {} });
  assert.equal(remoteSteps.length, steps.length + 3);
  const core = remoteSteps.find(step => step.id === 'remote-core');
  const oss = remoteSteps.find(step => step.id === 'remote-oss');
  assert.equal(core.env.SMOKE_CREATE_TEMP_USER, 'true');
  assert.equal(oss.env.SMOKE_CREATE_TEMP_USER, 'true');
  assert.ok(Object.isFrozen(core.env) && Object.isFrozen(oss.env));
  const authenticated = result.namespace.preflightSteps({ remoteCore: true, remoteOss: true, env: { SMOKE_USER_TOKEN: 'fixture' } });
  assert.ok(authenticated.filter(step => step.env).every(step => !('SMOKE_CREATE_TEMP_USER' in step.env)));
});

test('standalone preflight retains both typechecks even with a caller-asserted skip flag or environment', async () => {
  const result = await runPreflight({ code: 0, signal: null }, {
    argv: ['node', 'scripts/preflight.mjs', '--skip-typecheck'],
    env: { QA04_WORKSPACE_TYPECHECK_PASSED: 'true', PREFLIGHT_SKIP_TYPECHECK: 'true' },
  });
  for (const target of ['server', 'web']) {
    assert.ok(result.commands.some(call => call.args.join(' ').includes(`--filter ${target} typecheck`)));
  }
});

test('preflight finishes all selected checks when every child exits with zero', { timeout: 2_000 }, async () => {
  const result = await runPreflight({ code: 0, signal: null });
  assert.deepEqual(result.exits, []);
  assert.ok(result.commands.length > 1);
  assert.deepEqual(result.errors, []);
  assert.ok(result.logs.some((line) => line.includes('[preflight] all selected checks passed')));
});

for (const { name, firstResult, exitCode } of [
  { name: 'preserves a nonzero child exit', firstResult: { code: 23, signal: null }, exitCode: 23 },
  { name: 'fails when a child is terminated by a signal', firstResult: { code: null, signal: 'SIGTERM' }, exitCode: 1 },
  { name: 'fails when the child exit status is unknown', firstResult: { code: null, signal: null }, exitCode: 1 },
  { name: 'fails when a child cannot start', firstResult: { code: null, signal: null, error: 'synthetic spawn failure' }, exitCode: 1 },
]) {
  test(`preflight ${name} and stops subsequent checks`, { timeout: 2_000 }, async () => {
    const result = await runPreflight(firstResult);
    assert.deepEqual(result.exits, [exitCode]);
    assert.equal(result.commands.length, 1);
    assert.ok(result.errors.some((line) => line.includes(`[preflight] FAILED:`) && line.includes(`exited with ${exitCode}`)));
    assert.equal(result.logs.some((line) => line.includes('[preflight] all selected checks passed')), false);
  });
}
