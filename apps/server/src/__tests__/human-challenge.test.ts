import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const consumed = new Set<string>();
const configStore = new Map<string, string>();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (!configStore.has(where.key)) return null;
        return { key: where.key, value: configStore.get(where.key) };
      }),
    },
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    set: vi.fn(async (key: string, _value: string, _ex: string, _ttl: number, mode: string) => {
      if (mode === 'NX' && consumed.has(key)) return null;
      consumed.add(key);
      return 'OK';
    }),
  },
}));

describe('human challenge', () => {
  beforeEach(() => {
    consumed.clear();
    configStore.clear();
    vi.resetModules();
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'builtin-pow');
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('HUMAN_CHALLENGE_SIGNING_SECRET', 'test-secret-at-least-32-characters-long');
    vi.stubEnv('HUMAN_CHALLENGE_POW_DIFFICULTY', '2');
    vi.stubEnv('HUMAN_CHALLENGE_TTL_SECONDS', '60');
  });

  it('issues an action-bound signed challenge and accepts it only once', async () => {
    const { issueHumanChallenge, verifyHumanChallenge } = await import('../lib/human-challenge.js');
    const challenge = await issueHumanChallenge('login');
    let nonce = 0;
    while (!createHash('sha256').update(`${challenge.token}:${nonce}`).digest('hex').startsWith('00')) nonce++;

    await expect(verifyHumanChallenge({ action: 'login', token: `${challenge.token}.${nonce}` })).resolves.toBe(true);
    await expect(verifyHumanChallenge({ action: 'login', token: `${challenge.token}.${nonce}` })).resolves.toBe(false);
  });

  it('rejects a proof replayed for a different action', async () => {
    const { issueHumanChallenge, verifyHumanChallenge } = await import('../lib/human-challenge.js');
    const challenge = await issueHumanChallenge('login');
    let nonce = 0;
    while (!createHash('sha256').update(`${challenge.token}:${nonce}`).digest('hex').startsWith('00')) nonce++;
    await expect(verifyHumanChallenge({ action: 'admin_login', token: `${challenge.token}.${nonce}` })).resolves.toBe(false);
  });

  it('validates Turnstile hostname and action', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'cloudflare-turnstile');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', 'ss-erp.cn,www.ss-erp.cn');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ success: true, hostname: 'evil.example', action: 'login' }),
    })));
    const { verifyHumanChallenge } = await import('../lib/human-challenge.js');
    await expect(verifyHumanChallenge({ action: 'login', token: 'token' })).resolves.toBe(false);
  });

  it('normalizes an exact hostname allowlist loaded from SystemConfig', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', '');
    vi.stubEnv('HUMAN_CHALLENGE_SIGNING_SECRET', '');
    vi.stubEnv('HUMAN_CHALLENGE_POW_DIFFICULTY', '');
    vi.stubEnv('HUMAN_CHALLENGE_TTL_SECONDS', '');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', '');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    configStore.set('auth_human_challenge_provider', 'cloudflare-turnstile');
    configStore.set('auth_turnstile_secret_key', 'db-secret');
    configStore.set('auth_turnstile_allowed_hostnames', 'APP.SS-ERP.COM, app.ss-erp.com');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ success: true, hostname: 'app.ss-erp.com', action: 'login' }),
    })));

    const { getHumanChallengeRuntimeConfig, verifyHumanChallenge } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({
      allowedHostnames: ['app.ss-erp.com'],
      hostnameConfigValid: true,
      providerConfigValid: true,
      source: 'system-config',
    });
    await expect(verifyHumanChallenge({ action: 'login', token: 'token' })).resolves.toBe(true);
  });

  it('fails closed when Turnstile has no hostname allowlist', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'cloudflare-turnstile');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', '');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ success: true, hostname: 'app.ss-erp.com', action: 'login' }),
    })));

    const { verifyHumanChallenge } = await import('../lib/human-challenge.js');

    await expect(verifyHumanChallenge({ action: 'login', token: 'token' })).resolves.toBe(false);
  });

  it('fails closed for a historically invalid saved hostname value', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'cloudflare-turnstile');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'secret');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', '');
    configStore.set('auth_turnstile_allowed_hostnames', 'https://app.ss-erp.com');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ success: true, hostname: 'app.ss-erp.com', action: 'login' }),
    })));

    const { getHumanChallengeRuntimeConfig, verifyHumanChallenge } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({
      allowedHostnames: [],
      hostnameConfigValid: false,
    });
    await expect(verifyHumanChallenge({ action: 'login', token: 'token' })).resolves.toBe(false);
  });

  it('fails closed instead of falling back when the explicit provider is invalid', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'turnstile-typo');
    configStore.set('auth_human_challenge_provider', 'disabled');

    const {
      getHumanChallengeRuntimeConfig,
      issueHumanChallenge,
      verifyHumanChallenge,
    } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({
      provider: 'disabled',
      providerConfigValid: false,
      source: 'env',
    });
    await expect(issueHumanChallenge('login')).rejects.toThrow(/HUMAN_CHALLENGE_PROVIDER/);
    await expect(verifyHumanChallenge({ action: 'login', token: '' })).resolves.toBe(false);
  });

  it('marks an invalid environment hostname allowlist as unhealthy', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'cloudflare-turnstile');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', 'https://app.ss-erp.com');

    const { getHumanChallengeRuntimeConfig } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({
      provider: 'cloudflare-turnstile',
      allowedHostnames: [],
      hostnameConfigValid: false,
      source: 'env',
    });
  });

  it('loads the challenge provider and PoW settings from SystemConfig when env is absent', async () => {
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', '');
    vi.stubEnv('HUMAN_CHALLENGE_SIGNING_SECRET', '');
    vi.stubEnv('HUMAN_CHALLENGE_POW_DIFFICULTY', '');
    vi.stubEnv('HUMAN_CHALLENGE_TTL_SECONDS', '');
    configStore.set('auth_human_challenge_provider', 'builtin-pow');
    configStore.set('auth_pow_signing_secret', 'database-secret-at-least-32-characters-long');
    configStore.set('auth_pow_difficulty', '1');
    configStore.set('auth_pow_ttl_seconds', '45');

    const { getHumanChallengeRuntimeConfig } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({
      provider: 'builtin-pow',
      difficulty: 1,
      ttlSeconds: 45,
      source: 'system-config',
    });
  });

  it('keeps explicit environment settings ahead of SystemConfig for deployment compatibility', async () => {
    configStore.set('auth_human_challenge_provider', 'disabled');

    const { getHumanChallengeRuntimeConfig } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({
      provider: 'builtin-pow',
      source: 'env',
    });
  });

  it('disables configured human challenges in local runtime', async () => {
    vi.stubEnv('RUNTIME_MODE', 'local');
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'cloudflare-turnstile');
    vi.stubEnv('TURNSTILE_SITE_KEY', 'local-site-key');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'local-secret-key');

    const {
      getHumanChallengeRuntimeConfig,
      getPublicHumanChallengeConfig,
      verifyHumanChallenge,
    } = await import('../lib/human-challenge.js');

    await expect(getHumanChallengeRuntimeConfig()).resolves.toMatchObject({ provider: 'disabled' });
    await expect(getPublicHumanChallengeConfig()).resolves.toMatchObject({
      humanChallengeProvider: 'disabled', turnstileSiteKey: '',
    });
    await expect(verifyHumanChallenge({ action: 'login', token: '' })).resolves.toBe(true);
  });
});
