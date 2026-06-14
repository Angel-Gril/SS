import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/system-config-schema.js', () => ({
  getConfig: vi.fn(async () => false),
}));

vi.mock('../adapters/runtime-config.js', () => ({
  getRuntimeConfigForStorage: vi.fn(async () => ({
    oss: {
      endpoint: 'https://r2.example.com',
      bucket: 'assets',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      region: 'auto',
    },
  })),
}));

vi.mock('@aws-sdk/client-s3', () => {
  class GetObjectCommand {
    input: unknown;

    constructor(input: unknown) {
      this.input = input;
    }
  }

  class S3Client {
    async send() {
      return {
        ContentType: 'image/jpeg',
        ContentLength: 1,
        Body: {
          async transformToByteArray() {
            return new Uint8Array([1]);
          },
        },
      };
    }
  }

  return { GetObjectCommand, S3Client };
});

const { cdnProxyRoutes } = await import('../routes/cdn-proxy.js');

async function buildApp() {
  const app = Fastify();
  await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
  app.get('/api/ping', async () => ({ ok: true }));
  await app.register(cdnProxyRoutes, { prefix: '/api' });
  await app.ready();
  return app;
}

describe('cdn proxy rate limiting', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps public image proxy traffic out of the normal API rate limit bucket', async () => {
    const app = await buildApp();

    try {
      for (let i = 0; i < 3; i += 1) {
        const response = await app.inject({ method: 'GET', url: '/api/cdn/users/u/raw/a.jpg' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('image/jpeg');
      }

      const firstApiCall = await app.inject({ method: 'GET', url: '/api/ping' });
      expect(firstApiCall.statusCode).toBe(200);

      const secondApiCall = await app.inject({ method: 'GET', url: '/api/ping' });
      expect(secondApiCall.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});
