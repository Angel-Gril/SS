import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtimeMode: 'cloud' as 'cloud' | 'local',
}));

vi.mock('../lib/auth-challenge-config.js', () => ({
  getSmsRuntimeConfig: vi.fn(async () => ({
    provider: 'console',
    source: 'system-config',
    tencent: {},
    aliyun: {},
  })),
}));

vi.mock('../adapters/runtime-config.js', () => ({
  getRuntimeMode: () => mocks.runtimeMode,
}));

import { getSmsProvider, resetSmsProviderCache } from '../lib/sms/index.js';

describe('SMS provider factory', () => {
  beforeEach(() => {
    mocks.runtimeMode = 'cloud';
    resetSmsProviderCache();
  });

  it('fails closed instead of logging valid OTPs through console in cloud runtime', async () => {
    await expect(getSmsProvider()).rejects.toThrow(/cloud.*console provider/);
  });

  it('keeps console available for local development', async () => {
    mocks.runtimeMode = 'local';
    await expect(getSmsProvider()).resolves.toMatchObject({ send: expect.any(Function) });
  });
});
