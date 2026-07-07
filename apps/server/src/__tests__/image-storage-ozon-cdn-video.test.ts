import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Ozon CDN video upload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uploads video buffers through the Seller media-storage endpoint', async () => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
      vi.stubEnv(name, '');
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: 'https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/demo.mp4',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { OzonCdnBackend } = await import('../services/image-storage.js');
    const backend = new OzonCdnBackend({ cookie: 'sid=demo\r\n', companyId: '4494016' });

    const result = await backend.uploadBuffer(Buffer.from('mp4-bytes'), 'demo.mp4', 'video/mp4', {
      category: 'video',
      ownerId: 'user-1',
    });

    expect(result).toEqual({
      url: 'https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/demo.mp4',
      filename: 'demo.mp4',
      backend: 'ozon-cdn',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, {
      method: string;
      headers: Record<string, string>;
      body: Buffer;
    }];
    expect(url).toBe('https://api.seller.ozon.ru/api/media-storage/upload-file');
    expect(init.method).toBe('POST');
    expect(init.headers.cookie).toBe('sid=demo');
    expect(init.headers['x-o3-app-name']).toBe('seller-ui');
    expect(init.headers['x-o3-company-id']).toBe('4494016');
    expect(init.headers['content-type']).toContain('multipart/form-data; boundary=');
    const bodyText = Buffer.from(init.body).toString('utf8');
    expect(bodyText).toContain('name="file_name"');
    expect(bodyText).toContain('demo.mp4');
    expect(bodyText).toContain('name="tmp"');
    expect(bodyText).toContain('true');
    expect(bodyText).toContain('name="body"; filename="demo.mp4"');
    expect(bodyText).toContain('Content-Type: video/mp4');
    expect(bodyText).toContain('mp4-bytes');
  });

  it('replays video uploads with Ozon ETC cookie after media-storage redirects', async () => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
      vi.stubEnv(name, '');
    }
    const fetchMock = vi.fn(async (url: string) => {
      if (!String(url).includes('__rr=1')) {
        return new Response('<html>redirect</html>', {
          status: 307,
          headers: {
            location: 'https://api.seller.ozon.ru/api/media-storage/upload-file?__rr=1',
            'set-cookie': '__Secure-ETC=fresh-etc; Path=/; Secure; HttpOnly',
          },
        });
      }
      return new Response(JSON.stringify({
        url: 'https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/demo.mp4',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OzonCdnBackend } = await import('../services/image-storage.js');
    const backend = new OzonCdnBackend({ cookie: 'sid=demo; __Secure-ETC=stale-etc', companyId: '4494016' });

    const result = await backend.uploadBuffer(Buffer.from('mp4-bytes'), 'demo.mp4', 'video/mp4', {
      category: 'video',
      ownerId: 'user-1',
    });

    expect(result.url).toBe('https://cdn1.ozone.ru/s3/sc-temporary/ce/8b/demo.mp4');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, retryInit] = fetchMock.mock.calls[1] as unknown as [string, {
      headers: Record<string, string>;
    }];
    expect(retryInit.headers.cookie).toContain('sid=demo');
    expect(retryInit.headers.cookie).toContain('__Secure-ETC=fresh-etc');
    expect(retryInit.headers.cookie).not.toContain('__Secure-ETC=stale-etc');
  });
});

describe('Ozon CDN image upload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('retries transient seller upload socket failures before failing the publish image stage', async () => {
    for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) {
      vi.stubEnv(name, '');
    }
    const fetchMock = vi.fn(async (url: string) => {
      const textUrl = String(url);
      if (!textUrl.includes('__rr=1')) {
        return new Response('probe', {
          status: 200,
          headers: {
            'set-cookie': '__Secure-ETC=fresh-etc; Path=/; Secure; HttpOnly',
          },
        });
      }
      if (fetchMock.mock.calls.filter(([calledUrl]) => String(calledUrl).includes('__rr=1')).length === 1) {
        const error = new TypeError('terminated') as TypeError & { cause?: { code: string } };
        error.cause = { code: 'UND_ERR_SOCKET' };
        throw error;
      }
      return new Response(JSON.stringify({
        url: 'https://ir.ozone.ru/s3/sc-temporary/demo.jpg',
        name: 'demo.jpg',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { OzonCdnBackend } = await import('../services/image-storage.js');
    const backend = new OzonCdnBackend({ cookie: 'sid=demo', companyId: '4494016' });

    await expect(backend.uploadBuffer(Buffer.from('jpg-bytes'), 'demo.jpg', 'image/jpeg')).resolves.toEqual({
      url: 'https://ir.ozone.ru/s3/sc-temporary/demo.jpg',
      filename: 'demo.jpg',
      backend: 'ozon-cdn',
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('__rr=1'))).toHaveLength(2);
  });
});
