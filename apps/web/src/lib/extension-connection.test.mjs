import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildExtensionConnectionMessage,
  buildExtensionCollectEndpoint,
} from './extension-connection.ts';

test('builds extension collect endpoint from local API base', () => {
  assert.equal(
    buildExtensionCollectEndpoint('http://127.0.0.1:3001/'),
    'http://127.0.0.1:3001/api/collect',
  );
});

test('builds extension endpoint save message with token', () => {
  assert.deepEqual(
    buildExtensionConnectionMessage({
      apiBaseUrl: 'http://127.0.0.1:3001',
      token: 'extension-token-1',
    }),
    {
      type: 'ozon-calc:erp-endpoint-save',
      payload: {
        endpoint: 'http://127.0.0.1:3001/api/collect',
        token: 'extension-token-1',
      },
    },
  );
});
