import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionConfigRoutes } from '../routes/extension-config.js';

const runtimeConfigMock = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(),
  getRuntimeConfigForStorage: vi.fn(),
}));

vi.mock('../adapters/runtime-config.js', () => runtimeConfigMock);
vi.mock('../lib/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = {
      userId: 'user-1',
      actorUserId: 'user-1',
      role: 'USER',
      effectiveUserId: 'user-1',
    };
  },
}));

async function buildExtensionConfigApp() {
  const app = Fastify({ logger: false });
  await app.register(extensionConfigRoutes, { prefix: '/api/extension' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtimeConfigMock.getRuntimeConfig.mockReturnValue({
    source: 'env',
    mode: 'local',
    imageStorage: 'local',
    authSource: 'cookie',
    extensionSync: 'direct',
    oss: null,
    ozonCdnRelayUrl: undefined,
    ossFallbackToCdn: true,
    localBaseUrl: 'http://127.0.0.1:3001',
  });
});

describe('extension runtime config route', () => {
  it('describes local extension capabilities and API endpoints', async () => {
    runtimeConfigMock.getRuntimeConfigForStorage.mockResolvedValue({
      source: 'env',
      mode: 'local',
      imageStorage: 'local',
      authSource: 'cookie',
      extensionSync: 'direct',
      oss: null,
      ozonCdnRelayUrl: undefined,
      ossFallbackToCdn: true,
      localBaseUrl: 'http://127.0.0.1:3001',
    });
    const app = await buildExtensionConfigApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/extension/runtime',
      headers: { authorization: 'Bearer extension-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        mode: 'local',
        authSource: 'cookie',
        tokenRequired: false,
        capabilities: {
          imageUpload: 'local',
          sync: 'direct',
          ozonCdnDirect: true,
          serverSideUpload: false,
          queuedTasks: false,
          cookieSync: true,
          presignedUpload: false,
        },
        endpoints: {
          collect: '/api/collect',
          import1688: '/api/supply/1688/import',
          imagePresign: '/api/images/presign',
          imageUploadBase64: '/api/images/upload-base64',
          syncCookie: '/api/extension/sync-cookie',
        },
      },
    });
    await app.close();
  });

  it('describes cloud extension capabilities without enabling local cookie sync', async () => {
    runtimeConfigMock.getRuntimeConfigForStorage.mockResolvedValue({
      source: 'system-config',
      mode: 'cloud',
      imageStorage: 'oss',
      authSource: 'token',
      extensionSync: 'queue',
      oss: {
        endpoint: 'https://oss.example.com',
        bucket: 'assets',
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        region: 'auto',
      },
      ozonCdnRelayUrl: undefined,
      ossFallbackToCdn: true,
      localBaseUrl: 'https://erp.example.com',
    });
    const app = await buildExtensionConfigApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/extension/runtime',
      headers: { authorization: 'Bearer extension-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        mode: 'cloud',
        source: 'system-config',
        authSource: 'token',
        tokenRequired: true,
        capabilities: {
          imageUpload: 'oss',
          sync: 'queue',
          ozonCdnDirect: false,
          serverSideUpload: true,
          queuedTasks: true,
          cookieSync: false,
          presignedUpload: true,
        },
      },
    });
    await app.close();
  });
});
