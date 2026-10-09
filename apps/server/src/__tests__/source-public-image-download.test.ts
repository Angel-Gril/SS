import { describe, expect, it, vi } from 'vitest';
import {
  createValidatedPublicLookup,
  downloadPublicImage,
  isPublicSourceAddress,
} from '../services/source-public-image-download.js';

function response(body: string | Buffer | null, init: ResponseInit & { url?: string } = {}) {
  const result = new Response(body, init);
  if (init.url) Object.defineProperty(result, 'url', { value: init.url });
  return result;
}

describe('source public image download', () => {
  it('omits Referer for capture transfer without sending cookies or authorization', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: unknown) => response(Buffer.from('png'), {
      status: 200, headers: { 'content-type': 'image/png' },
    }));
    await downloadPublicImage('https://cbu01.alicdn.com/source.png', {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }], fetch: fetchImpl,
      omitReferer: true, maxRedirects: 0,
    });
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) });
    const headers = (fetchImpl.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(headers).not.toHaveProperty('referer');
    expect(headers).not.toHaveProperty('cookie');
    expect(headers).not.toHaveProperty('authorization');
  });
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
  ])('rejects non-public or reserved address %s', (address) => {
    expect(isPublicSourceAddress(address)).toBe(false);
  });

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('accepts public unicast address %s', (address) => {
    expect(isPublicSourceAddress(address)).toBe(true);
  });

  it('validates the DNS records used by the actual connector and blocks rebinding', async () => {
    const resolver = vi.fn()
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const lookup = createValidatedPublicLookup(resolver);

    await expect(new Promise((resolve, reject) => {
      lookup('cdn.example.com', { all: false }, (error, address, family) => (
        error ? reject(error) : resolve({ address, family })
      ));
    })).resolves.toEqual({ address: '1.1.1.1', family: 4 });

    await expect(new Promise((resolve, reject) => {
      lookup('cdn.example.com', { all: false }, (error, address, family) => (
        error ? reject(error) : resolve({ address, family })
      ));
    })).rejects.toThrow(/public/i);
  });

  it('revalidates every redirect hop and returns a bounded image response', async () => {
    const lookups: string[] = [];
    const fetchImpl = vi.fn(async (url: string, _init?: unknown) => {
      if (url === 'https://img.example.com/start') {
        return response(null, {
          status: 302,
          headers: { location: 'https://cdn.example.net/product.png' },
          url,
        });
      }
      return response(Buffer.from('png-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '9' },
        url,
      });
    });
    const result = await downloadPublicImage('https://img.example.com/start', {
      lookup: async (hostname) => {
        lookups.push(hostname);
        return [{ address: hostname === 'img.example.com' ? '1.1.1.1' : '8.8.8.8', family: 4 }];
      },
      fetch: fetchImpl,
    });

    expect(lookups).toEqual(['img.example.com', 'cdn.example.net']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(result).toMatchObject({
      sourceUrl: 'https://img.example.com/start',
      finalUrl: 'https://cdn.example.net/product.png',
      contentType: 'image/png',
      redirectCount: 1,
    });
    expect(result.buffer.toString()).toBe('png-bytes');
  });

  it('blocks a redirect to a private address before the second request', async () => {
    const fetchImpl = vi.fn(async (url: string) => response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/admin' },
      url,
    }));
    await expect(downloadPublicImage('https://img.example.com/start', {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetch: fetchImpl,
    })).rejects.toThrow(/public/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported content, oversized declarations and redirect loops', async () => {
    await expect(downloadPublicImage('https://img.example.com/file', {
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetch: async (url) => response('<html/>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
        url,
      }),
    })).rejects.toThrow(/content type/i);

    await expect(downloadPublicImage('https://img.example.com/file', {
      maxBytes: 8,
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetch: async (url) => response(null, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '9' },
        url,
      }),
    })).rejects.toThrow(/8 bytes/i);

    await expect(downloadPublicImage('https://img.example.com/loop', {
      maxRedirects: 1,
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetch: async (url) => response(null, {
        status: 302,
        headers: { location: '/loop' },
        url,
      }),
    })).rejects.toThrow(/redirect/i);
  });
});
