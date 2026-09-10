import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const scriptUrl = new URL('./preflight.mjs', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');

async function runPreflight(firstResult) {
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
      argv: ['node', 'scripts/preflight.mjs'],
      env: {},
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
  const script = new SourceTextModule(source, { context, identifier: scriptUrl.href });
  await script.link((specifier) => {
    assert.equal(specifier, 'node:child_process', 'unexpected preflight dependency');
    return childProcess;
  });
  try {
    await script.evaluate({ timeout: 1_000 });
  } catch (error) {
    if (error !== exitSentinel) throw error;
  }
  return { commands, logs, errors, exits };
}

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
