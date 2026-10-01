import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAcceptanceMode, selectMediaProbeWorkerContext, validateMediaChannelDelivery } from './extension-donor-workbench-mv3-acceptance.mjs';

const expected = {
  probeId: 'probe-123', direction: 'IFRAME_TO_WORKER', from: 'IFRAME', to: 'WORKER',
  mimeType: 'image/png', byteLength: 80, sha256: 'a'.repeat(64),
};

test('accepts only the exact Blob delivery identity, direction, MIME, size and hash', () => {
  assert.equal(validateMediaChannelDelivery({ ...expected, receivedAsBlob: true }, expected), true);
  const wrong = [
    null, [], { ...expected }, { ...expected, receivedAsBlob: false },
    { ...expected, receivedAsBlob: true, probeId: 'another-probe' },
    { ...expected, receivedAsBlob: true, direction: 'WORKER_TO_IFRAME' },
    { ...expected, receivedAsBlob: true, from: 'WORKER' },
    { ...expected, receivedAsBlob: true, to: 'IFRAME' },
    { ...expected, receivedAsBlob: true, mimeType: 'image/jpeg' },
    { ...expected, receivedAsBlob: true, byteLength: 81 },
    { ...expected, receivedAsBlob: true, byteLength: NaN },
    { ...expected, receivedAsBlob: true, sha256: 'b'.repeat(64) },
    { ...expected, receivedAsBlob: true, bytes: [1, 2, 3] },
  ];
  for (const delivery of wrong) assert.equal(validateMediaChannelDelivery(delivery, expected), false);
});

test('a packet received in the opposite context cannot count toward both directions', () => {
  const received = { ...expected, receivedAsBlob: true };
  assert.equal(validateMediaChannelDelivery(received, { ...expected,
    direction: 'WORKER_TO_IFRAME', from: 'WORKER', to: 'IFRAME',
  }), false);
});

test('requires an explicit hidden transport mode and preserves the original precision UI mode', () => {
  assert.deepEqual(selectAcceptanceMode(['--precision']), {
    precisionPreview: true, mediaChannelProbe: false, mediaChannelOnly: false,
  });
  assert.deepEqual(selectAcceptanceMode(['--precision', '--probe-media-channel']), {
    precisionPreview: true, mediaChannelProbe: true, mediaChannelOnly: false,
  });
  assert.deepEqual(selectAcceptanceMode(['--precision', '--probe-media-channel-only']), {
    precisionPreview: true, mediaChannelProbe: true, mediaChannelOnly: true,
  });
  assert.throws(() => selectAcceptanceMode(['--probe-media-channel-only']), /requires --precision/u);
  assert.throws(() => selectAcceptanceMode(['--probe-media-channel']), /requires --precision/u);
});

test('accepts Chrome worker context origin as either the exact extension origin or exact script URL', () => {
  const workerUrl = 'chrome-extension://extension-id/background/service-worker.js';
  const realContext = { id: 1, origin: workerUrl, name: '' };
  assert.equal(selectMediaProbeWorkerContext([realContext], workerUrl), realContext);
  const originContext = { id: 2, origin: 'chrome-extension://extension-id', auxData: { isDefault: true } };
  assert.equal(selectMediaProbeWorkerContext([originContext], workerUrl), originContext);
  for (const origin of [
    'chrome-extension://other-extension/background/service-worker.js',
    'chrome-extension://extension-id/pages/precision-workbench.html',
    'https://extension-id/background/service-worker.js',
  ]) assert.equal(selectMediaProbeWorkerContext([{ id: 1, origin }], workerUrl), null);
  assert.equal(selectMediaProbeWorkerContext([realContext, { ...realContext, id: 2 }], workerUrl), null);
});
