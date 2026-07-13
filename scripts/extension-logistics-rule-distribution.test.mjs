import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const storeSource = fs.readFileSync(
  'extensions/ss-erp/shared/logistics-rules/distribution-store.js',
  'utf8',
);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createStorage() {
  const values = new Map();
  const writes = [];
  let quotaFailures = 0;
  let heldBlobWrite = null;
  let heldPointerWrite = null;
  return {
    writes,
    async get(keys) {
      if (keys === null) {
        return Object.fromEntries([...values].map(([key, value]) => [key, clone(value)]));
      }
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => values.has(key)).map((key) => [key, clone(values.get(key))]),
      );
    },
    async set(input) {
      if (quotaFailures > 0 && Object.keys(input).some((key) => key.includes(':blob:'))) {
        quotaFailures -= 1;
        const error = new Error('QUOTA_BYTES quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      if (heldBlobWrite && Object.keys(input).some((key) => key.includes(':blob:'))) {
        const hold = heldBlobWrite;
        heldBlobWrite = null;
        hold.markStarted();
        await hold.waitForRelease;
      }
      if (heldPointerWrite && Object.keys(input).some((key) => key.endsWith(':pointer'))) {
        const hold = heldPointerWrite;
        heldPointerWrite = null;
        hold.markStarted();
        await hold.waitForRelease;
      }
      writes.push(clone(input));
      for (const [key, value] of Object.entries(input)) values.set(key, clone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    failNextBlobWrite() { quotaFailures += 1; },
    holdNextBlobWrite() {
      let markStarted;
      let release;
      const started = new Promise((resolve) => { markStarted = resolve; });
      const waitForRelease = new Promise((resolve) => { release = resolve; });
      heldBlobWrite = { markStarted, waitForRelease };
      return { started, release };
    },
    holdNextPointerWrite() {
      let markStarted;
      let release;
      const started = new Promise((resolve) => { markStarted = resolve; });
      const waitForRelease = new Promise((resolve) => { release = resolve; });
      heldPointerWrite = { markStarted, waitForRelease };
      return { started, release };
    },
    keys() { return [...values.keys()]; },
    value(key) { return clone(values.get(key)); },
  };
}

function loadStore(storage, validateBundle) {
  const context = {
    Date, JSON, Number, Object, Array, String, Boolean, Set, Map, Promise, encodeURIComponent,
  };
  context.globalThis = context;
  vm.runInNewContext(storeSource, context, { filename: 'distribution-store.js' });
  return context.SS_ERP_LOGISTICS_DISTRIBUTION_STORE.createStore({
    storage,
    now: () => new Date('2026-07-12T12:00:00.000Z'),
    validateBundle,
  });
}

const namespace = {
  deploymentId: 'local-dev',
  tenantSubject: 'tenant-a',
  shopId: 'shop-a',
  ozonCompanyId: 'company-a',
  warehouseId: 'warehouse-a',
  originCountryUid: 'china',
  originCityUid: 'xiamen',
  destinationCountryUid: 'russia',
  destinationLocationUid: 'moscow',
  assignmentId: 'assignment-a',
  schemaMajor: 1,
};

const bundle = {
  schemaVersion: 'ozon-logistics/release-v1',
  releaseId: 'release-1',
  releaseSequence: 1,
  contentChecksum: 'a'.repeat(64),
  effectiveChecksum: 'b'.repeat(64),
  payload: { services: [{ stableServiceKey: 'service-1' }] },
};

test('a 200 response stages, reads back, validates, then atomically switches the pointer', async () => {
  const storage = createStorage();
  let validations = 0;
  const store = loadStore(storage, (value) => {
    validations += 1;
    return { valid: true, bundle: value };
  });

  const result = await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });

  assert.equal(result.state, 'active');
  assert.equal(validations, 2, 'stored bytes must be validated again before pointer commit');
  assert.equal(storage.writes.length, 2, 'blob and pointer are separate crash-safe writes');

  const blobWriteKey = Object.keys(storage.writes[0])[0];
  const pointerWriteKey = Object.keys(storage.writes[1])[0];
  assert.match(blobWriteKey, /:blob:/);
  assert.match(pointerWriteKey, /:pointer$/);

  const pointer = storage.value(pointerWriteKey);
  assert.equal(pointer.activeChecksum, 'b'.repeat(64));
  assert.equal(pointer.previousChecksum, null);
  assert.equal(pointer.generation, 1);
  assert.deepEqual(pointer.pendingReceipt, {
    effectiveChecksum: 'b'.repeat(64),
    idempotencyKey: '0123456789abcdef',
    releaseId: 'release-1',
    releaseSequence: 1,
    appliedAt: pointer.activatedAt,
  });
});
test('a lower release sequence cannot replace the active release', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const newerBundle = {
    ...bundle,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };

  const active = await store.stageAndActivate({
    namespace,
    bundle: newerBundle,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  const writesBeforeReplay = storage.writes.length;

  await assert.rejects(
    store.stageAndActivate({
      namespace,
      bundle,
      etag: '"release-1"',
      serverTime: '2026-07-12T12:05:00.000Z',
      authorizationValidUntil: '2026-07-13T12:05:00.000Z',
      receiptIdempotencyKey: 'fedcba9876543210',
    }),
    /release sequence rollback/i,
  );

  assert.deepEqual(clone(await store.readPointer(namespace)), clone(active));
  assert.equal(storage.writes.length, writesBeforeReplay);
});
test('an active same-identity 200 refreshes only lease metadata and preserves a pending receipt', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const active = await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  const writesBeforeReplay = storage.writes.length;

  const replayed = await store.stageAndActivate({
    namespace,
    bundle: clone(bundle),
    etag: '"release-1-renewed"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'fedcba9876543210',
  });

  assert.equal(replayed.etag, '"release-1-renewed"');
  assert.equal(replayed.serverTime, '2026-07-12T12:05:00.000Z');
  assert.equal(replayed.authorizationValidUntil, '2026-07-13T12:05:00.000Z');
  assert.equal(replayed.generation, active.generation);
  assert.equal(replayed.activeChecksum, active.activeChecksum);
  assert.equal(replayed.previousChecksum, active.previousChecksum);
  assert.deepEqual(clone(replayed.pendingReceipt), clone(active.pendingReceipt));
  assert.equal(replayed.pendingReceipts.length, 1);
  assert.equal(storage.writes.length, writesBeforeReplay + 1);
  assert.match(Object.keys(storage.writes.at(-1))[0], /:pointer$/);
});
test('a same-identity 200 repairs a missing or corrupt active blob', async () => {
  for (const damage of ['missing', 'corrupt']) {
    const storage = createStorage();
    const store = loadStore(storage, (value) => value && value.releaseId
      ? { valid: true, bundle: value }
      : { valid: false, errors: ['releaseId is required'] });
    const active = await store.stageAndActivate({
      namespace,
      bundle,
      etag: '"release-1"',
      serverTime: '2026-07-12T12:00:00.000Z',
      authorizationValidUntil: '2026-07-13T12:00:00.000Z',
      receiptIdempotencyKey: '0123456789abcdef',
    });
    const blobKey = storage.keys().find((key) => key.includes(':blob:'));
    if (damage === 'missing') await storage.remove(blobKey);
    else await storage.set({ [blobKey]: { effectiveChecksum: bundle.effectiveChecksum } });
    assert.equal(await store.readActive(namespace), null, damage);

    const repaired = await store.stageAndActivate({
      namespace,
      bundle: clone(bundle),
      etag: '"release-1-repaired"',
      serverTime: '2026-07-12T12:05:00.000Z',
      authorizationValidUntil: '2026-07-13T12:05:00.000Z',
      receiptIdempotencyKey: 'must-not-replace-01',
    });

    assert.equal((await store.readActive(namespace)).releaseId, bundle.releaseId, damage);
    assert.equal(repaired.generation, active.generation, damage);
    assert.deepEqual(clone(repaired.pendingReceipt), clone(active.pendingReceipt), damage);
  }
});
test('a same-identity 200 reauthorizes a revoked pointer without replacing its release state', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const secondBundle = {
    ...bundle,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };
  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  const active = await store.stageAndActivate({
    namespace,
    bundle: secondBundle,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:01:00.000Z',
    authorizationValidUntil: '2026-07-13T12:01:00.000Z',
    receiptIdempotencyKey: 'second-release-0002',
  });
  await store.markRevoked(namespace, { status: 410, reason: 'assignment_revoked' });
  const revoked = await store.readPointer(namespace);

  assert.equal(revoked.state, 'revoked');
  assert.deepEqual(clone(revoked.pendingReceipt), clone(active.pendingReceipt));
  assert.equal(await store.readPendingReceipt(namespace), null, 'revoked receipts stay dormant');
  const writesBeforeRecovery = storage.writes.length;
  const blobKeysBeforeRecovery = storage.keys().filter((key) => key.includes(':blob:'));

  const recovered = await store.stageAndActivate({
    namespace,
    bundle: clone(secondBundle),
    etag: '"release-2-reauthorized"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'replacement-key-02',
  });

  assert.equal(recovered.state, 'active');
  assert.equal(Object.hasOwn(recovered, 'revocation'), false);
  assert.equal(recovered.activeChecksum, active.activeChecksum);
  assert.equal(recovered.previousChecksum, active.previousChecksum);
  assert.equal(recovered.generation, active.generation);
  assert.equal(recovered.etag, '"release-2-reauthorized"');
  assert.equal(recovered.serverTime, '2026-07-12T12:05:00.000Z');
  assert.equal(recovered.authorizationValidUntil, '2026-07-13T12:05:00.000Z');
  assert.deepEqual(clone(recovered.pendingReceipt), clone(active.pendingReceipt));
  assert.deepEqual(
    storage.keys().filter((key) => key.includes(':blob:')),
    blobKeysBeforeRecovery,
  );
  assert.equal(storage.writes.length, writesBeforeRecovery + 1);
});
test('reauthorizing an already reported release does not create a duplicate receipt', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  const reported = await store.markReceiptReported(namespace, {
    idempotencyKey: '0123456789abcdef',
    receiptId: 'receipt-1',
    reportedAt: '2026-07-12T12:01:00.000Z',
  });
  await store.markRevoked(namespace, { status: 403, reason: 'authorization_revoked' });
  const writesBeforeRecovery = storage.writes.length;

  const recovered = await store.stageAndActivate({
    namespace,
    bundle: clone(bundle),
    etag: '"release-1-reauthorized"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'must-not-be-reused',
  });

  assert.equal(recovered.state, 'active');
  assert.equal(recovered.pendingReceipt, null);
  assert.deepEqual(clone(recovered.lastReceipt), clone(reported.lastReceipt));
  assert.equal(await store.readPendingReceipt(namespace), null);
  assert.equal(storage.writes.length, writesBeforeRecovery + 1);
});
test('the same release sequence rejects conflicting release identity', async () => {
  const conflictFields = [
    ['releaseId', 'release-conflict'],
    ['contentChecksum', 'c'.repeat(64)],
    ['effectiveChecksum', 'd'.repeat(64)],
  ];

  for (const [field, value] of conflictFields) {
    const storage = createStorage();
    const store = loadStore(storage, (candidate) => ({ valid: true, bundle: candidate }));
    const active = await store.stageAndActivate({
      namespace,
      bundle,
      etag: '"release-1"',
      serverTime: '2026-07-12T12:00:00.000Z',
      authorizationValidUntil: '2026-07-13T12:00:00.000Z',
      receiptIdempotencyKey: '0123456789abcdef',
    });
    const writesBeforeConflict = storage.writes.length;

    await assert.rejects(
      store.stageAndActivate({
        namespace,
        bundle: { ...bundle, [field]: value },
        etag: '"release-conflict"',
        serverTime: '2026-07-12T12:05:00.000Z',
        authorizationValidUntil: '2026-07-13T12:05:00.000Z',
        receiptIdempotencyKey: 'fedcba9876543210',
      }),
      /release sequence conflict/i,
    );

    assert.deepEqual(clone(await store.readPointer(namespace)), clone(active));
    assert.equal(storage.writes.length, writesBeforeConflict);
  }
});
test('concurrent activation cannot let a lower sequence supersede a higher sequence', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const activate = (sequence, checksum) => store.stageAndActivate({
    namespace,
    bundle: {
      ...bundle,
      releaseId: 'release-' + sequence,
      releaseSequence: sequence,
      contentChecksum: checksum.repeat(64),
      effectiveChecksum: String.fromCharCode(checksum.charCodeAt(0) + 1).repeat(64),
    },
    etag: '"release-' + sequence + '"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcde' + sequence,
  });

  await activate(1, 'a');
  const hold = storage.holdNextBlobWrite();
  const higherPromise = activate(3, 'e');
  await hold.started;
  const lowerPromise = activate(2, 'c');
  await new Promise((resolve) => setImmediate(resolve));
  hold.release();

  const [higher, lower] = await Promise.allSettled([higherPromise, lowerPromise]);
  assert.equal(higher.status, 'fulfilled');
  assert.equal(lower.status, 'rejected');
  assert.match(String(lower.reason && lower.reason.message), /release sequence rollback/i);
  const pointer = await store.readPointer(namespace);
  assert.equal(pointer.releaseSequence, 3);
  assert.equal(pointer.releaseId, 'release-3');
});
test('concurrent same-sequence activations accept only one release identity', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });

  const firstBundle = {
    ...bundle,
    releaseId: 'release-2-a',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };
  const secondBundle = {
    ...firstBundle,
    releaseId: 'release-2-b',
    contentChecksum: 'e'.repeat(64),
    effectiveChecksum: 'f'.repeat(64),
  };
  const hold = storage.holdNextBlobWrite();
  const firstPromise = store.stageAndActivate({
    namespace,
    bundle: firstBundle,
    etag: '"release-2-a"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'first-release-0002',
  });
  await hold.started;
  const secondPromise = store.stageAndActivate({
    namespace,
    bundle: secondBundle,
    etag: '"release-2-b"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'second-release-002',
  });
  await new Promise((resolve) => setImmediate(resolve));
  hold.release();

  const [first, second] = await Promise.allSettled([firstPromise, secondPromise]);
  assert.equal(first.status, 'fulfilled');
  assert.equal(second.status, 'rejected');
  assert.match(String(second.reason && second.reason.message), /release sequence conflict/i);
  const pointer = await store.readPointer(namespace);
  assert.equal(pointer.releaseId, firstBundle.releaseId);
  assert.equal(pointer.contentChecksum, firstBundle.contentChecksum);
  assert.equal(pointer.effectiveChecksum, firstBundle.effectiveChecksum);
});
test('receipt confirmation concurrent with activation preserves the new release and outbox', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: 'receipt-release-01',
  });
  const second = {
    ...bundle,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };
  const hold = storage.holdNextBlobWrite();
  const activation = store.stageAndActivate({
    namespace,
    bundle: second,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'receipt-release-02',
  });
  await hold.started;
  const reporting = store.markReceiptReported(namespace, {
    idempotencyKey: 'receipt-release-01',
    receiptId: 'receipt-1',
    reportedAt: '2026-07-12T12:06:00.000Z',
  });
  await new Promise((resolve) => setImmediate(resolve));
  hold.release();
  await Promise.all([activation, reporting]);

  const pointer = await store.readPointer(namespace);
  assert.equal(pointer.releaseSequence, 2);
  assert.equal(pointer.releaseId, 'release-2');
  assert.equal(pointer.pendingReceipts.length, 1);
  assert.equal(pointer.pendingReceipt.releaseId, 'release-2');
  assert.equal(pointer.lastReceipt.releaseId, 'release-1');
});
test('activation serialization does not block an independent namespace', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const hold = storage.holdNextBlobWrite();
  const firstPromise = store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  await hold.started;

  let independentSettled = false;
  const independentPromise = store.stageAndActivate({
    namespace: {
      ...namespace,
      shopId: 'shop-b',
      assignmentId: 'assignment-b',
    },
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: 'fedcba9876543210',
  }).finally(() => {
    independentSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  const settledBeforeRelease = independentSettled;
  hold.release();
  await Promise.all([firstPromise, independentPromise]);

  assert.equal(settledBeforeRelease, true);
});
test('a concurrent 304 renewal cannot write an older pointer over a new activation', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const datedBundle = {
    ...bundle,
    validUntil: '2026-07-19T12:00:00.000Z',
    staleUntil: '2026-07-20T12:00:00.000Z',
  };
  await store.stageAndActivate({
    namespace,
    bundle: datedBundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: 'receipt-release-01',
  });
  const second = {
    ...datedBundle,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };
  const hold = storage.holdNextPointerWrite();
  const renewal = store.applyNotModified({
    namespace,
    etag: '"release-1"',
    effectiveChecksum: 'b'.repeat(64),
    serverTime: '2026-07-12T12:01:00.000Z',
    authorizationValidUntil: '2026-07-13T12:01:00.000Z',
  });
  await hold.started;
  const activation = store.stageAndActivate({
    namespace,
    bundle: second,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'receipt-release-02',
  });
  await new Promise((resolve) => setImmediate(resolve));
  hold.release();
  await Promise.all([renewal, activation]);

  const pointer = await store.readPointer(namespace);
  assert.equal(pointer.releaseSequence, 2);
  assert.equal(pointer.releaseId, 'release-2');
  assert.equal(pointer.authorizationValidUntil, '2026-07-13T12:05:00.000Z');
});
test('a 304 renews authorization metadata without changing release freshness', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const datedBundle = {
    ...bundle,
    validUntil: '2026-07-19T12:00:00.000Z',
    staleUntil: '2026-07-20T12:00:00.000Z',
  };

  await store.stageAndActivate({
    namespace,
    bundle: datedBundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  const pointer = await store.applyNotModified({
    namespace,
    etag: '"release-1"',
    effectiveChecksum: 'b'.repeat(64),
    serverTime: '2026-07-12T13:00:00.000Z',
    authorizationValidUntil: '2026-07-13T13:00:00.000Z',
  });

  assert.equal(pointer.authorizationValidUntil, '2026-07-13T13:00:00.000Z');
  assert.equal(pointer.serverTime, '2026-07-12T13:00:00.000Z');
  assert.equal(pointer.validUntil, datedBundle.validUntil);
  assert.equal(pointer.staleUntil, datedBundle.staleUntil);
  assert.equal(pointer.generation, 1);
  assert.equal(pointer.activeChecksum, datedBundle.effectiveChecksum);
});
test('401, 403, and known-scope 410 revoke the matching namespace immediately', async () => {
  for (const status of [401, 403, 410]) {
    const storage = createStorage();
    const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));

    await store.stageAndActivate({
      namespace,
      bundle,
      etag: '"release-1"',
      serverTime: '2026-07-12T12:00:00.000Z',
      authorizationValidUntil: '2026-07-13T12:00:00.000Z',
      receiptIdempotencyKey: '0123456789abcdef',
    });
    await store.markRevoked(namespace, { status, reason: 'assignment_revoked' });

    const pointer = await store.readPointer(namespace);
    assert.equal(pointer.state, 'revoked');
    assert.equal(pointer.revocation.status, status);
    assert.equal(pointer.revocation.reason, 'assignment_revoked');
    assert.equal(await store.readActive(namespace), null);
    assert.equal(await store.readPointer({ ...namespace, shopId: 'shop-b' }), null);
  }
});
test('pending apply receipts survive restarts and clear only after server confirmation', async () => {
  const storage = createStorage();
  const firstWorker = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  await firstWorker.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });

  const restartedWorker = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  assert.deepEqual(clone(await restartedWorker.readPendingReceipt(namespace)), {
    effectiveChecksum: 'b'.repeat(64),
    idempotencyKey: '0123456789abcdef',
    releaseId: 'release-1',
    releaseSequence: 1,
    appliedAt: '2026-07-12T12:00:00.000Z',
  });

  await restartedWorker.markReceiptReported(namespace, {
    idempotencyKey: '0123456789abcdef',
    receiptId: 'receipt-1',
    reportedAt: '2026-07-12T12:01:00.000Z',
  });
  assert.equal(await restartedWorker.readPendingReceipt(namespace), null);
  const pointer = await restartedWorker.readPointer(namespace);
  assert.equal(pointer.lastReceipt.receiptId, 'receipt-1');
  assert.equal(pointer.lastReceipt.releaseId, 'release-1');
});
test('a newer release preserves earlier unconfirmed receipts until each is reported', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const second = {
    ...bundle,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };

  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: 'receipt-release-01',
  });
  await store.stageAndActivate({
    namespace,
    bundle: second,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'receipt-release-02',
  });

  assert.equal((await store.readPendingReceipt(namespace)).releaseId, 'release-1');
  await assert.rejects(
    store.markReceiptReported(namespace, {
      idempotencyKey: 'receipt-release-02',
      receiptId: 'receipt-out-of-order',
      reportedAt: '2026-07-12T12:06:00.000Z',
    }),
    /does not match the pending release/i,
  );
  assert.equal((await store.readPointer(namespace)).pendingReceipts.length, 2);
  await store.markReceiptReported(namespace, {
    idempotencyKey: 'receipt-release-01',
    receiptId: 'receipt-1',
    reportedAt: '2026-07-12T12:06:00.000Z',
  });
  assert.equal((await store.readPendingReceipt(namespace)).releaseId, 'release-2');
  await store.markReceiptReported(namespace, {
    idempotencyKey: 'receipt-release-02',
    receiptId: 'receipt-2',
    reportedAt: '2026-07-12T12:07:00.000Z',
  });
  assert.equal(await store.readPendingReceipt(namespace), null);
});
test('legacy scalar pending receipt upgrades into the durable outbox', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));

  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: 'receipt-release-01',
  });
  const pointerKey = storage.keys().find((key) => key.endsWith(':pointer'));
  const legacy = storage.value(pointerKey);
  delete legacy.pendingReceipts;
  await storage.set({ [pointerKey]: legacy });

  const second = {
    ...bundle,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };
  await store.stageAndActivate({
    namespace,
    bundle: second,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'receipt-release-02',
  });

  const upgraded = await store.readPointer(namespace);
  assert.equal(upgraded.pendingReceipts.length, 2);
  assert.equal(upgraded.pendingReceipts[0].idempotencyKey, 'receipt-release-01');
  assert.equal((await store.readPendingReceipt(namespace)).releaseId, 'release-1');
});
test('legacy receipt appliedAt is persisted once before transmission', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));

  await store.stageAndActivate({
    namespace,
    bundle,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: 'receipt-release-01',
  });
  const pointerKey = storage.keys().find((key) => key.endsWith(':pointer'));
  const legacy = storage.value(pointerKey);
  delete legacy.pendingReceipt.appliedAt;
  delete legacy.pendingReceipts;
  await storage.set({ [pointerKey]: legacy });

  const first = await store.preparePendingReceipt(namespace, {
    appliedAt: '2026-07-12T12:02:00.000Z',
  });
  const second = await store.preparePendingReceipt(namespace, {
    appliedAt: '2026-07-12T12:03:00.000Z',
  });

  assert.equal(first.appliedAt, '2026-07-12T12:02:00.000Z');
  assert.equal(second.appliedAt, first.appliedAt);
  const persisted = await store.readPointer(namespace);
  assert.equal(persisted.pendingReceipt.appliedAt, first.appliedAt);
  assert.equal(persisted.pendingReceipts[0].appliedAt, first.appliedAt);
});
test('a full receipt outbox rejects a newer activation without changing the pointer', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));

  for (let sequence = 1; sequence <= 50; sequence += 1) {
    const checksumBase = String(sequence * 2).padStart(64, '0');
    await store.stageAndActivate({
      namespace,
      bundle: {
        ...bundle,
        releaseId: 'release-' + sequence,
        releaseSequence: sequence,
        contentChecksum: checksumBase,
        effectiveChecksum: String(sequence * 2 + 1).padStart(64, '0'),
      },
      etag: '"release-' + sequence + '"',
      serverTime: '2026-07-12T12:00:00.000Z',
      authorizationValidUntil: '2026-07-13T12:00:00.000Z',
      receiptIdempotencyKey: 'receipt-key-' + String(sequence).padStart(4, '0'),
    });
  }
  const beforeOverflow = await store.readPointer(namespace);
  const writesBeforeOverflow = storage.writes.length;

  await assert.rejects(
    store.stageAndActivate({
      namespace,
      bundle: {
        ...bundle,
        releaseId: 'release-51',
        releaseSequence: 51,
        contentChecksum: 'e'.repeat(64),
        effectiveChecksum: 'f'.repeat(64),
      },
      etag: '"release-51"',
      serverTime: '2026-07-12T12:05:00.000Z',
      authorizationValidUntil: '2026-07-13T12:05:00.000Z',
      receiptIdempotencyKey: 'receipt-key-0051',
    }),
    /receipt outbox is full/i,
  );

  assert.deepEqual(clone(await store.readPointer(namespace)), clone(beforeOverflow));
  assert.equal(storage.writes.length, writesBeforeOverflow);
});
test('a corrupt active blob falls back only to the verified previous bundle within policy', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => value && value.releaseId
    ? { valid: true, bundle: value }
    : { valid: false, errors: ['releaseId is required'] });
  const first = {
    ...bundle,
    validUntil: '2026-07-19T12:00:00.000Z',
    staleUntil: '2026-07-20T12:00:00.000Z',
  };
  const second = {
    ...first,
    releaseId: 'release-2',
    releaseSequence: 2,
    contentChecksum: 'c'.repeat(64),
    effectiveChecksum: 'd'.repeat(64),
  };

  await store.stageAndActivate({
    namespace,
    bundle: first,
    etag: '"release-1"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcdef',
  });
  await store.stageAndActivate({
    namespace,
    bundle: second,
    etag: '"release-2"',
    serverTime: '2026-07-12T12:05:00.000Z',
    authorizationValidUntil: '2026-07-13T12:05:00.000Z',
    receiptIdempotencyKey: 'fedcba9876543210',
  });

  const activeBlobKey = Object.keys(storage.writes[2])[0];
  await storage.set({ [activeBlobKey]: { effectiveChecksum: second.effectiveChecksum } });
  const resolved = await store.resolveUsable(namespace, {
    at: '2026-07-12T13:00:00.000Z',
  });

  assert.equal(resolved.state, 'recovered_previous');
  assert.equal(resolved.quoteAllowed, true);
  assert.equal(resolved.bundle.releaseId, 'release-1');
  assert.equal(resolved.effectiveChecksum, first.effectiveChecksum);
});

test('quota recovery removes only unreferenced blobs and retries without losing active/previous', async () => {
  const storage = createStorage();
  const store = loadStore(storage, (value) => ({ valid: true, bundle: value }));
  const activate = (sequence, checksum) => store.stageAndActivate({
    namespace,
    bundle: {
      ...bundle,
      releaseId: 'release-' + sequence,
      releaseSequence: sequence,
      effectiveChecksum: checksum.repeat(64),
    },
    etag: '"release-' + sequence + '"',
    serverTime: '2026-07-12T12:00:00.000Z',
    authorizationValidUntil: '2026-07-13T12:00:00.000Z',
    receiptIdempotencyKey: '0123456789abcde' + sequence,
  });

  await activate(1, 'b');
  await activate(2, 'c');
  await activate(3, 'd');
  storage.failNextBlobWrite();
  const pointer = await activate(4, 'e');

  assert.equal(pointer.activeChecksum, 'e'.repeat(64));
  assert.equal(pointer.previousChecksum, 'd'.repeat(64));
  const blobKeys = storage.keys().filter((key) => key.includes(':blob:'));
  assert.equal(blobKeys.some((key) => key.endsWith('b'.repeat(64))), false);
  assert.equal(blobKeys.some((key) => key.endsWith('d'.repeat(64))), true);
  assert.equal(blobKeys.some((key) => key.endsWith('e'.repeat(64))), true);
});
