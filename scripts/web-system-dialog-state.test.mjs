import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConfirmationScope,
  createSystemDialogController,
} from '../apps/web/src/lib/system-dialog-state.ts';

test('cancel and dismiss never approve a pending destructive action', async () => {
  let visible;
  const dialogs = createSystemDialogController((value) => { visible = value; });
  const answer = dialogs.confirm({ message: 'discard draft' });
  assert.equal(visible.options.message, 'discard draft');
  dialogs.cancel();
  assert.equal(await answer, false);
  assert.equal(visible, null);
});

test('a newer dialog cancels the previous request instead of leaving it pending', async () => {
  const dialogs = createSystemDialogController(() => {});
  const first = dialogs.confirm({ message: 'old target' });
  const second = dialogs.confirm({ message: 'current target' });
  assert.equal(await first, false);
  dialogs.accept();
  assert.equal(await second, true);
});

test('prompt values retain trim and cancellation semantics across replacement', async () => {
  const dialogs = createSystemDialogController(() => {});
  const first = dialogs.prompt({ message: 'input', defaultValue: ' old ' });
  dialogs.updatePromptValue(' revised ');
  dialogs.accept();
  assert.equal(await first, 'revised');
  const replaced = dialogs.prompt({ message: 'input' });
  const last = dialogs.confirm({ message: 'new request' });
  assert.equal(await replaced, null);
  dialogs.cancel();
  assert.equal(await last, false);
});

test('unmount resolves pending requests and rejects late requests without rendering', async () => {
  const changes = [];
  const dialogs = createSystemDialogController((value) => changes.push(value));
  const pending = dialogs.confirm({ message: 'draft' });
  dialogs.dispose();
  assert.equal(await pending, false);
  assert.equal(await dialogs.confirm({ message: 'late' }), false);
  assert.equal(changes.length, 1);
  dialogs.activate();
  const next = dialogs.confirm({ message: 'remounted' });
  dialogs.accept();
  assert.equal(await next, true);
});

test('a confirmation for A cannot discard a new A draft after A to B to A', async () => {
  const scope = createConfirmationScope('A');
  let answer;
  const pending = scope.run(() => new Promise((resolve) => { answer = resolve; }));
  scope.update('B');
  scope.update('A');
  answer(true);
  assert.equal(await pending, false);
  assert.equal(await scope.run(() => true), true);
});

test('only the latest action in the same scope may consume approval', async () => {
  const scope = createConfirmationScope('draft');
  let answer;
  const old = scope.run(() => new Promise((resolve) => { answer = resolve; }));
  assert.equal(await scope.run(() => true), true);
  answer(true);
  assert.equal(await old, false);
});

test('scope cancellation and a negative asynchronous answer preserve the draft', async () => {
  const scope = createConfirmationScope('draft');
  assert.equal(await scope.run(async () => false), false);
  let answer;
  const pending = scope.run(() => new Promise((resolve) => { answer = resolve; }));
  scope.invalidate();
  answer(true);
  assert.equal(await pending, false);
});
