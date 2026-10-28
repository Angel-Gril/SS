import assert from 'node:assert/strict';
import test from 'node:test';
import { compileYandexBoxInput, yandexCommandOutcome } from '../apps/web/src/components/yandex/workbench-input.ts';

test('box editor preserves full quantities across multiple boxes and marking order', () => {
  const items = [{ id: 7, count: 2, requiredInstanceTypes: ['CIS'] }];
  assert.deepEqual(compileYandexBoxInput(items, [{ 7: 1 }, { 7: 1 }], { '7:CIS': 'first\nsecond' }), [
    { items: [{ id: 7, fullCount: 1, instances: [{ cis: 'first' }] }] },
    { items: [{ id: 7, fullCount: 1, instances: [{ cis: 'second' }] }] },
  ]);
});

test('box editor rejects fractional, negative, empty, incomplete and foreign quantities before submit', () => {
  const items = [{ id: 7, count: 2 }];
  for (const rows of [[{ 7: 1 }], [{ 7: 2 }, {}], [{ 7: 1.5 }, { 7: 0.5 }], [{ 7: -1 }, { 7: 3 }], [{ 7: 2, 8: 1 }]]) {
    assert.throws(() => compileYandexBoxInput(items, rows, {}));
  }
});

test('mark editor never silently discards surplus codes or incomplete required marking', () => {
  const items = [{ id: 7, count: 2, requiredInstanceTypes: ['CIS'] }];
  assert.throws(() => compileYandexBoxInput(items, [{ 7: 2 }], { '7:CIS': 'one' }));
  assert.throws(() => compileYandexBoxInput(items, [{ 7: 2 }], { '7:CIS': 'one\ntwo\nthree' }));
  assert.throws(() => compileYandexBoxInput(items, [{ 7: 2 }], { '7:CIS': 'one\none' }));
  assert.deepEqual(compileYandexBoxInput([{ id: 7, count: 2, requiredInstanceTypes: ['CIS_OPTIONAL'] }], [{ 7: 2 }], {}), [{ items: [{ id: 7, fullCount: 2 }] }]);
});

test('accepted, timeout and malformed results retain the original command; only terminal proof clears it', () => {
  for (const response of [{ code: 1 }, { code: 1, data: { state: 'SUBMITTING' } }, { code: 0, data: { state: 'UNKNOWN' } }, null]) assert.equal(yandexCommandOutcome(response), 'PENDING');
  assert.equal(yandexCommandOutcome({ code: 1, data: { state: 'SUCCEEDED' } }), 'SUCCEEDED');
  assert.equal(yandexCommandOutcome({ code: 0, data: { state: 'REJECTED' } }), 'REJECTED');
  assert.equal(yandexCommandOutcome({ code: 0, meta: { notDispatched: true } }), 'REJECTED');
});
