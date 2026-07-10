import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisMocks = vi.hoisted(() => ({
  scan: vi.fn(),
  del: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({ redis: redisMocks }));
vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

import { setAuthCookie } from '../lib/auth.js';

describe('auth cookie persistence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a session cookie when no persistence duration is requested', () => {
    const setCookie = vi.fn();
    setAuthCookie({ setCookie } as any, 'token-value');

    expect(setCookie).toHaveBeenCalledOnce();
    expect(setCookie.mock.calls[0]?.[2]).not.toHaveProperty('maxAge');
  });

  it('creates a persistent cookie for an explicit duration', () => {
    const setCookie = vi.fn();
    setAuthCookie({ setCookie } as any, 'token-value', 604800);

    expect(setCookie.mock.calls[0]?.[2]).toMatchObject({ maxAge: 604800 });
  });
});

describe('session revocation', () => {
  it('scans and deletes all sessions belonging to one user', async () => {
    redisMocks.scan
      .mockResolvedValueOnce(['7', ['session:user-1:first', 'session:user-1:second']])
      .mockResolvedValueOnce(['0', ['session:user-1:third']]);

    const auth = await import('../lib/auth.js');
    expect(typeof (auth as any).removeAllSessions).toBe('function');
    await (auth as any).removeAllSessions('user-1');

    expect(redisMocks.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'session:user-1:*', 'COUNT', 100);
    expect(redisMocks.del).toHaveBeenCalledWith('session:user-1:first', 'session:user-1:second');
    expect(redisMocks.del).toHaveBeenCalledWith('session:user-1:third');
  });
});
