import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-provider-semaphore.js';

function loadApi() {
  const context = { Date, Error, Map, Number, Object, Promise, String, URL };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE;
}

function authority(overrides = {}) {
  return {
    ownerToken: overrides.ownerToken || 'tab:1:document:1',
    ownerUserId: overrides.ownerUserId || 'owner-1',
    deviceSessionId: overrides.deviceSessionId || 'device-1',
    policyRevision: overrides.policyRevision || '734',
    maxConcurrency: overrides.maxConcurrency ?? 1,
    expiresAt: overrides.expiresAt || '2026-07-27T10:10:00.000Z',
  };
}

test('queues same-device work at the authenticated cap and releases exactly once', async () => {
  const api = loadApi();
  const semaphore = api.createSemaphore({
    now: () => new Date('2026-07-27T10:00:00.000Z'),
  });
  const first = await semaphore.acquire(authority());
  await assert.rejects(
    semaphore.acquire(authority()),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_OWNER_BUSY',
  );
  let secondGranted = false;
  const secondPromise = semaphore.acquire(authority({ ownerToken: 'tab:2:document:2' }))
    .then((lease) => { secondGranted = true; return lease; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondGranted, false);
  assert.equal(first.release(), true);
  assert.equal(first.release(), false);
  const second = await secondPromise;
  assert.equal(secondGranted, true);
  assert.equal(second.release(), true);
});

test('bounds pending work per device and exposes no mutable scheduler state', async () => {
  const api = loadApi();
  const semaphore = api.createSemaphore({
    now: () => new Date('2026-07-27T10:00:00.000Z'),
  });
  assert.deepEqual(
    Object.keys(semaphore).sort(),
    ['acquire', 'cancelOwner', 'invalidateAll', 'tryAcquire'],
  );
  const active = await semaphore.acquire(authority({ ownerToken: 'bounded-active' }));
  const queued = Array.from({ length: 32 }, (_, index) => semaphore.acquire(authority({
    ownerToken: `bounded-${index}`,
  })));
  await assert.rejects(
    semaphore.acquire(authority({ ownerToken: 'bounded-overflow' })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_QUEUE_FULL',
  );
  semaphore.invalidateAll();
  await Promise.allSettled(queued);
  active.release();
});

test('interactive acquisition fails before dispatch instead of waiting behind active work', async () => {
  const api = loadApi();
  const semaphore = api.createSemaphore({
    now: () => new Date('2026-07-27T10:00:00.000Z'),
  });
  const active = await semaphore.acquire(authority({ ownerToken: 'active-owner' }));
  await assert.rejects(
    semaphore.tryAcquire(authority({ ownerToken: 'interactive-owner' })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_BUSY',
  );
  active.release();
  const interactive = await semaphore.tryAcquire(authority({ ownerToken: 'interactive-owner' }));
  assert.equal(interactive.release(), true);
});

test('bounds pending work globally without blocking independent immediate capacity', async () => {
  const api = loadApi();
  const semaphore = api.createSemaphore({
    now: () => new Date('2026-07-27T10:00:00.000Z'),
  });
  const activeOne = await semaphore.acquire(authority({
    ownerToken: 'global-active-1', deviceSessionId: 'global-device-1',
  }));
  const activeTwo = await semaphore.acquire(authority({
    ownerToken: 'global-active-2', deviceSessionId: 'global-device-2',
  }));
  const queued = [];
  for (let index = 0; index < 32; index += 1) {
    queued.push(semaphore.acquire(authority({
      ownerToken: `global-1-${index}`, deviceSessionId: 'global-device-1',
    })));
    queued.push(semaphore.acquire(authority({
      ownerToken: `global-2-${index}`, deviceSessionId: 'global-device-2',
    })));
  }
  const independent = await semaphore.acquire(authority({
    ownerToken: 'global-active-3', deviceSessionId: 'global-device-3',
  }));
  await assert.rejects(
    semaphore.acquire(authority({
      ownerToken: 'global-overflow', deviceSessionId: 'global-device-3',
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_QUEUE_FULL',
  );
  semaphore.invalidateAll();
  await Promise.allSettled(queued);
  activeOne.release();
  activeTwo.release();
  independent.release();
});

test('cancels only queued owner work and never releases an active lease early', async () => {
  const api = loadApi();
  const semaphore = api.createSemaphore({
    now: () => new Date('2026-07-27T10:00:00.000Z'),
  });
  const active = await semaphore.acquire(authority({ ownerToken: 'active-owner' }));
  const queued = semaphore.acquire(authority({ ownerToken: 'queued-owner' }));
  assert.equal(semaphore.cancelOwner('queued-owner'), 1);
  await assert.rejects(
    queued,
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_CANCELLED',
  );
  const blocked = semaphore.acquire(authority({ ownerToken: 'next-owner' }));
  let granted = false;
  blocked.then(() => { granted = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(granted, false);
  active.release();
  (await blocked).release();
});

test('fails closed on expired or changed authority and keeps devices independent', async () => {
  const api = loadApi();
  let current = Date.parse('2026-07-27T10:00:00.000Z');
  const semaphore = api.createSemaphore({ now: () => new Date(current) });
  await assert.rejects(
    semaphore.acquire(authority({ expiresAt: '2026-07-27T09:59:59.000Z' })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_EXPIRED',
  );
  const first = await semaphore.acquire(authority());
  await assert.rejects(
    semaphore.acquire(authority({
      ownerToken: 'changed-policy', policyRevision: '735', maxConcurrency: 2,
    })),
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_CHANGED',
  );
  const independent = await semaphore.acquire(authority({
    ownerToken: 'other-device', deviceSessionId: 'device-2',
  }));
  independent.release();
  first.release();

  const refreshed = await semaphore.acquire(authority({
    ownerToken: 'changed-policy', policyRevision: '735', maxConcurrency: 2,
  }));
  refreshed.release();

  const blocker = await semaphore.acquire(authority({ ownerToken: 'expiry-blocker' }));
  const expiresWhileQueued = semaphore.acquire(authority({
    ownerToken: 'expiry-waiter', expiresAt: '2026-07-27T10:00:01.000Z',
  }));
  current += 2_000;
  blocker.release();
  await assert.rejects(
    expiresWhileQueued,
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_AUTHORITY_EXPIRED',
  );
});

test('invalidating rejects waiters but active Provider work owns its lease until settlement', async () => {
  const api = loadApi();
  const semaphore = api.createSemaphore({
    now: () => new Date('2026-07-27T10:00:00.000Z'),
  });
  const active = await semaphore.acquire(authority({ ownerToken: 'active' }));
  const queued = semaphore.acquire(authority({ ownerToken: 'queued' }));
  assert.equal(semaphore.invalidateAll(), 1);
  await assert.rejects(
    queued,
    (error) => error && error.code === 'SS_ERP_BYOK_PROVIDER_EXECUTION_CANCELLED',
  );
  assert.equal(active.release(), true);
});
