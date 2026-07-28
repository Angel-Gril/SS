import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const controllerPath = 'extensions/ss-erp/pages/ai-image-workbench-workspace.js';
const controllerSource = fs.readFileSync(controllerPath, 'utf8');
const functionMatch = controllerSource.match(
  /  function focusSlotAction\(slotKey, name\) \{[\s\S]*?\n  \}\n\n  function announceSlotOrder/u,
);

assert.ok(functionMatch, 'focusSlotAction must remain a focused workspace helper');

const focusSlotActionSource = functionMatch[0].replace(
  /\n\n  function announceSlotOrder$/u,
  '',
);

function createHarness({ preferredName, enabledFallbackName = null }) {
  const document = { activeElement: { tagName: 'BODY' } };
  const attempts = [];
  const controls = {};

  for (const name of ['selectButton', 'upButton', 'downButton']) {
    controls[name] = {
      disabled: name === preferredName || (
        name !== 'selectButton' && name !== enabledFallbackName
      ),
      focus() {
        attempts.push(name);
        if (!this.disabled) document.activeElement = this;
      },
    };
  }

  const context = {
    global: { document },
    slotNodes: new Map([['sku:slot', { _workspace: controls }]]),
  };
  const focusSlotAction = vm.runInNewContext(
    `(function (context) {
      var global = context.global;
      var slotNodes = context.slotNodes;
      ${focusSlotActionSource}
      return focusSlotAction;
    })`,
  )(context);

  return { controls, document, attempts, focusSlotAction };
}

{
  const harness = createHarness({
    preferredName: 'downButton',
    enabledFallbackName: 'upButton',
  });
  harness.focusSlotAction('sku:slot', 'downButton');
  assert.deepEqual(harness.attempts, ['downButton', 'upButton']);
  assert.equal(harness.document.activeElement, harness.controls.upButton,
    'moving a slot to the end must return focus to its available up control');
}

{
  const harness = createHarness({
    preferredName: 'upButton',
    enabledFallbackName: 'downButton',
  });
  harness.focusSlotAction('sku:slot', 'upButton');
  assert.deepEqual(harness.attempts, ['upButton', 'downButton']);
  assert.equal(harness.document.activeElement, harness.controls.downButton,
    'moving a slot to the start must return focus to its available down control');
}

{
  const harness = createHarness({ preferredName: 'downButton' });
  harness.focusSlotAction('sku:slot', 'downButton');
  assert.deepEqual(harness.attempts, ['downButton', 'selectButton']);
  assert.equal(harness.document.activeElement, harness.controls.selectButton,
    'a slot without an available move control must return focus to its selector');
}

{
  const harness = createHarness({
    preferredName: 'selectButton',
    enabledFallbackName: 'upButton',
  });
  harness.controls.selectButton.disabled = false;
  harness.focusSlotAction('sku:slot', 'selectButton');
  assert.deepEqual(harness.attempts, ['selectButton']);
  assert.equal(harness.document.activeElement, harness.controls.selectButton,
    'an available preferred control must retain focus without fallback');
}

console.log('extension BYOK workspace slot focus regression tests passed');
