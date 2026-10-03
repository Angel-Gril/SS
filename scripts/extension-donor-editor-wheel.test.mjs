import assert from 'node:assert/strict';
import test from 'node:test';
import { setupRowWheel } from '../extensions/ss-erp/pages/donor/ui/modules/product-editor-table-behavior.js';

function fixture(scrollTop = 0) {
  const viewport = new EventTarget();
  Object.assign(viewport, { style: {}, scrollTop, scrollHeight: 400, clientHeight: 200,
    querySelectorAll: () => [], closest: () => null, querySelector: () => ({ getBoundingClientRect: () => ({ height: 64 }) }),
    scrollBy: value => { viewport.manualScroll = value; },
  });
  const scroller = { scrollLeft: 50, scrollWidth: 600, clientWidth: 200 };
  const root = { querySelector: selector => selector === '.editor-table-body-viewport' ? viewport : scroller };
  const previous = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = callback => callback();
  try { setupRowWheel(root); } finally { globalThis.requestAnimationFrame = previous; }
  function wheel(deltaY, deltaX = 0, shiftKey = false) {
    const event = new Event('wheel', { cancelable: true });
    Object.assign(event, { deltaY, deltaX, deltaMode: 0, shiftKey }); viewport.dispatchEvent(event); return event;
  }
  return { viewport, scroller, wheel };
}
test('vertical trackpad movement uses browser scrolling rather than a delayed one-row jump', () => {
  const f = fixture(30); assert.equal(f.wheel(4).defaultPrevented, false); assert.equal(f.viewport.manualScroll, undefined);
});
test('vertical wheel at both table boundaries can continue into the outer workbench', () => {
  assert.equal(fixture(0).wheel(-100).defaultPrevented, false);
  assert.equal(fixture(200).wheel(100).defaultPrevented, false);
});
test('horizontal and shift-wheel retain the donor table column scrolling', () => {
  const f = fixture(); assert.equal(f.wheel(0, 30).defaultPrevented, true); assert.equal(f.scroller.scrollLeft, 80);
  assert.equal(f.wheel(40, 0, true).defaultPrevented, true); assert.equal(f.scroller.scrollLeft, 120);
});
