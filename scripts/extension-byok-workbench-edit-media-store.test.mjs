import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/workbench-edit-media-store.js';
const source = await readFile(modulePath, 'utf8');

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadApi() {
  const context = vm.createContext({ Blob });
  vm.runInContext(source, context, { filename: modulePath });
  return context.SS_ERP_BYOK_WORKBENCH_EDIT_MEDIA_STORE;
}

function owner(overrides = {}) {
  return {
    tabId: 42,
    documentId: 'document-42',
    context: { trusted: true },
    ...overrides,
  };
}

function handle(character = 'a') {
  return `mh_${character.repeat(48)}`;
}

function fixture() {
  const calls = [];
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const broker = {
    prepare(input) {
      calls.push(['prepare', plain(input)]);
      return { ticket: true };
    },
    getForBackground(input) {
      calls.push(['getForBackground', plain(input)]);
      return {
        mediaHandle: input.mediaHandle,
        purpose: input.purpose,
        blob,
        metadata: {
          mimeType: 'image/png',
          byteLength: blob.size,
          width: 1,
          height: 1,
          sha256: 'b'.repeat(64),
        },
      };
    },
    release(input) {
      calls.push(['release', plain(input)]);
      return true;
    },
    releaseOwner(input) {
      calls.push(['releaseOwner', plain(input)]);
      return { releasedCount: 1 };
    },
    clear() {
      calls.push(['clear']);
      return undefined;
    },
  };
  return { api: loadApi(), broker, calls, blob };
}

test('maps authenticated page ownership into the exact media-channel contract', () => {
  const value = fixture();
  const store = value.api.createStore({ broker: value.broker });
  assert.deepEqual(store.prepare(owner(), 'REFERENCE'), { ticket: true });
  assert.equal(store.release(owner(), handle(), 'SOURCE'), true);
  assert.deepEqual(value.calls.slice(0, 2), [
    ['prepare', {
      ownerId: 'workbench-tab-42',
      tabId: 42,
      documentId: 'document-42',
      purpose: 'REFERENCE',
    }],
    ['release', {
      ownerId: 'workbench-tab-42',
      tabId: 42,
      documentId: 'document-42',
      purpose: 'SOURCE',
      mediaHandle: handle(),
    }],
  ]);
});

test('maps every closed controller purpose and flattens only validated metadata', () => {
  const value = fixture();
  const store = value.api.createStore({ broker: value.broker });
  const expected = {
    IMAGE_TO_IMAGE_REFERENCE: 'REFERENCE',
    FULL_EDIT_SOURCE: 'SOURCE',
    INPAINT_SOURCE: 'SOURCE',
    INPAINT_MASK: 'MASK',
  };
  Object.entries(expected).forEach(([controllerPurpose, channelPurpose], index) => {
    const mediaHandle = handle(String(index + 1));
    const resolved = store.getForBackground(owner(), mediaHandle, controllerPurpose);
    assert.equal(resolved.blob, value.blob);
    assert.deepEqual(plain(resolved), {
      blob: {},
      mimeType: 'image/png',
      width: 1,
      height: 1,
    });
    assert.equal(value.calls[index][1].purpose, channelPurpose);
    assert.equal(value.calls[index][1].mediaHandle, mediaHandle);
  });
});

test('rejects unknown purposes, forged owners, handles, and invalid broker projections', () => {
  const value = fixture();
  const store = value.api.createStore({ broker: value.broker });
  assert.throws(() => store.prepare(owner(), 'INPAINT_SOURCE'), {
    code: 'SS_ERP_BYOK_WORKBENCH_MEDIA_PURPOSE_INVALID',
  });
  assert.throws(() => store.prepare(owner({ tabId: -1 }), 'SOURCE'), {
    code: 'SS_ERP_BYOK_WORKBENCH_MEDIA_OWNER_INVALID',
  });
  assert.throws(() => store.release(owner(), 'not-a-handle', 'SOURCE'), {
    code: 'SS_ERP_BYOK_WORKBENCH_MEDIA_HANDLE_INVALID',
  });

  value.broker.getForBackground = () => ({
    mediaHandle: handle(),
    purpose: 'SOURCE',
    blob: value.blob,
    metadata: {
      mimeType: 'image/png', byteLength: value.blob.size,
      width: 100000, height: 1, sha256: 'b'.repeat(64),
    },
  });
  const invalidStore = value.api.createStore({ broker: value.broker });
  assert.throws(() => invalidStore.getForBackground(
    owner(),
    handle(),
    'FULL_EDIT_SOURCE',
  ), { code: 'SS_ERP_BYOK_EDIT_MEDIA_INVALID' });
});

test('releases and clears the same exact background owner', () => {
  const value = fixture();
  const store = value.api.createStore({ broker: value.broker });
  assert.deepEqual(store.releaseOwner(owner()), { releasedCount: 1 });
  store.clear();
  assert.deepEqual(value.calls, [
    ['releaseOwner', {
      ownerId: 'workbench-tab-42', tabId: 42, documentId: 'document-42',
    }],
    ['clear'],
  ]);
});
