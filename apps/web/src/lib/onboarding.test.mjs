import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOnboardingSteps } from './onboarding.ts';

test('marks add shop as the next onboarding step for a new user', () => {
  const steps = buildOnboardingSteps({
    hasShop: false,
    hasOrder: false,
    hasWarehouse: false,
    completed: false,
    nextStep: 'add-shop',
  });

  assert.equal(steps[0].active, true);
  assert.equal(steps[0].done, false);
  assert.equal(steps[1].disabled, true);
});

test('enables order sync after the first shop is connected', () => {
  const steps = buildOnboardingSteps({
    hasShop: true,
    hasOrder: false,
    hasWarehouse: false,
    completed: false,
    nextStep: 'sync-orders',
  });

  assert.equal(steps[0].done, true);
  assert.equal(steps[1].active, true);
  assert.equal(steps[1].disabled, false);
});

test('marks all onboarding steps complete when setup is complete', () => {
  const steps = buildOnboardingSteps({
    hasShop: true,
    hasOrder: true,
    hasWarehouse: true,
    completed: true,
    nextStep: null,
  });

  assert.deepEqual(steps.map((step) => step.done), [true, true, true]);
  assert.deepEqual(steps.map((step) => step.active), [false, false, false]);
});
