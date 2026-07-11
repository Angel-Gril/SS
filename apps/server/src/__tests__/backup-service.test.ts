import { beforeEach, describe, expect, it, vi } from 'vitest';

const configStore = new Map<string, any>();
const s3Mocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock('../config/system-config-schema.js', () => ({
  getConfig: vi.fn(async (key: string) => configStore.get(key) ?? ''),
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return { ...actual, S3Client: class { send = s3Mocks.send; } };
});

describe('backup service config', () => {
  beforeEach(() => {
    configStore.clear();
    s3Mocks.send.mockReset();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('uses encrypted SystemConfig backup R2 settings before env fallback', async () => {
    configStore.set('backup_enabled', true);
    configStore.set('backup_schedule', '0 3 * * *');
    configStore.set('backup_local_keep_days', 14);
    configStore.set('backup_remote_enabled', true);
    configStore.set('backup_remote_keep_days', 180);
    configStore.set('backup_remote_bucket', 'ss-erp-backups');
    configStore.set('backup_remote_endpoint', 'https://r2.example.com');
    configStore.set('backup_remote_region', 'auto');
    configStore.set('backup_remote_prefix', 'db/daily');
    configStore.set('backup_remote_access_key_id', 'db-ak');
    configStore.set('backup_remote_secret_access_key', 'db-sk');
    vi.stubEnv('BACKUP_S3_BUCKET', 'env-backups');
    vi.stubEnv('BACKUP_S3_ACCESS_KEY_ID', 'env-ak');
    vi.stubEnv('BACKUP_S3_SECRET_ACCESS_KEY', 'env-sk');

    const { getBackupRuntimeConfig } = await import('../services/backup.service.js');

    await expect(getBackupRuntimeConfig()).resolves.toMatchObject({
      enabled: true,
      schedule: '0 3 * * *',
      localKeepDays: 14,
      remoteKeepDays: 180,
      remoteSource: 'system-config',
      remote: {
        bucket: 'ss-erp-backups',
        endpoint: 'https://r2.example.com',
        region: 'auto',
        prefix: 'db/daily/',
        accessKeyId: 'db-ak',
        secretAccessKey: 'db-sk',
      },
    });
  });

  it('falls back to BACKUP_S3 env credentials when SystemConfig remote backup is disabled', async () => {
    configStore.set('backup_enabled', true);
    configStore.set('backup_schedule', '0 3 * * *');
    configStore.set('backup_local_keep_days', 7);
    configStore.set('backup_remote_enabled', false);
    configStore.set('backup_remote_keep_days', 30);
    vi.stubEnv('BACKUP_S3_BUCKET', 'env-backups');
    vi.stubEnv('BACKUP_S3_ENDPOINT', 'https://env-r2.example.com');
    vi.stubEnv('BACKUP_S3_ACCESS_KEY_ID', 'env-ak');
    vi.stubEnv('BACKUP_S3_SECRET_ACCESS_KEY', 'env-sk');
    vi.stubEnv('BACKUP_S3_PREFIX', 'db/env');
    vi.stubEnv('BACKUP_S3_REGION', 'auto');

    const { getBackupRuntimeConfig } = await import('../services/backup.service.js');

    await expect(getBackupRuntimeConfig()).resolves.toMatchObject({
      remoteSource: 'env',
      remote: {
        bucket: 'env-backups',
        endpoint: 'https://env-r2.example.com',
        prefix: 'db/env/',
        accessKeyId: 'env-ak',
        secretAccessKey: 'env-sk',
      },
    });
  });

  it('defaults local worker backups to the deploy shared directory instead of /var/backups', async () => {
    configStore.set('backup_enabled', true);
    configStore.set('backup_schedule', '0 3 * * *');
    configStore.set('backup_local_keep_days', 7);
    configStore.set('backup_remote_enabled', false);
    configStore.set('backup_remote_keep_days', 30);

    const { getBackupRuntimeConfig } = await import('../services/backup.service.js');

    const config = await getBackupRuntimeConfig();
    expect(config.localDir.replaceAll('\\', '/')).toMatch(/\/shared\/backups$/);
    expect(config.localDir).not.toBe('/var/backups/ss-erp');
  });

  it('derives the Aliyun OSS internal endpoint for a private backup bucket', async () => {
    configStore.set('backup_enabled', true);
    configStore.set('backup_schedule', '0 3 * * *');
    configStore.set('backup_local_keep_days', 7);
    configStore.set('backup_remote_enabled', true);
    configStore.set('backup_remote_keep_days', 90);
    configStore.set('backup_remote_provider', 'aliyun-oss');
    configStore.set('backup_remote_bucket', 'ss-erp-cn-db-backups');
    configStore.set('backup_remote_endpoint', '');
    configStore.set('backup_remote_region', 'cn-guangzhou');
    configStore.set('backup_remote_prefix', 'production/postgresql/daily');
    configStore.set('backup_remote_access_key_id', 'backup-ak');
    configStore.set('backup_remote_secret_access_key', 'backup-sk');

    const { getBackupRuntimeConfig } = await import('../services/backup.service.js');

    await expect(getBackupRuntimeConfig()).resolves.toMatchObject({
      remoteSource: 'system-config',
      remoteMissing: [],
      remote: {
        provider: 'aliyun-oss',
        endpoint: 'https://oss-cn-guangzhou-internal.aliyuncs.com',
        region: 'cn-guangzhou',
        bucket: 'ss-erp-cn-db-backups',
        prefix: 'production/postgresql/daily/',
      },
    });
  });

  it('infers the Aliyun region from an explicitly configured internal endpoint', async () => {
    configStore.set('backup_enabled', true);
    configStore.set('backup_schedule', '0 3 * * *');
    configStore.set('backup_local_keep_days', 7);
    configStore.set('backup_remote_enabled', true);
    configStore.set('backup_remote_keep_days', 90);
    configStore.set('backup_remote_provider', 'aliyun-oss');
    configStore.set('backup_remote_bucket', 'ss-erp-cn-db-backups');
    configStore.set('backup_remote_endpoint', 'https://oss-cn-shenzhen-internal.aliyuncs.com');
    configStore.set('backup_remote_region', 'auto');
    configStore.set('backup_remote_prefix', 'db/');
    configStore.set('backup_remote_access_key_id', 'backup-ak');
    configStore.set('backup_remote_secret_access_key', 'backup-sk');

    const { getBackupRuntimeConfig } = await import('../services/backup.service.js');

    await expect(getBackupRuntimeConfig()).resolves.toMatchObject({
      remote: {
        provider: 'aliyun-oss',
        endpoint: 'https://oss-cn-shenzhen-internal.aliyuncs.com',
        region: 'cn-shenzhen',
      },
    });
  });
});

describe('backup remote storage diagnostics', () => {
  beforeEach(() => {
    configStore.clear();
    s3Mocks.send.mockReset();
    vi.resetModules();
    vi.unstubAllEnvs();
    configStore.set('backup_enabled', true);
    configStore.set('backup_schedule', '0 3 * * *');
    configStore.set('backup_local_keep_days', 7);
    configStore.set('backup_remote_enabled', true);
    configStore.set('backup_remote_keep_days', 90);
    configStore.set('backup_remote_provider', 'aliyun-oss');
    configStore.set('backup_remote_bucket', 'ss-erp-cn-db-backups');
    configStore.set('backup_remote_endpoint', 'https://oss-cn-guangzhou-internal.aliyuncs.com');
    configStore.set('backup_remote_region', 'cn-guangzhou');
    configStore.set('backup_remote_prefix', 'db/');
    configStore.set('backup_remote_access_key_id', 'backup-ak');
    configStore.set('backup_remote_secret_access_key', 'backup-sk');
  });

  it('writes, reads back, verifies, and deletes a private bucket test object', async () => {
    let writtenBody = '';
    s3Mocks.send.mockImplementation(async (command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'HeadBucketCommand') throw new Error('AccessDenied');
      if (commandName === 'PutObjectCommand') {
        writtenBody = Buffer.from(command.input.Body).toString('utf8');
        return {};
      }
      if (commandName === 'GetObjectCommand') {
        return { Body: { transformToString: async () => writtenBody } };
      }
      if (commandName === 'DeleteObjectsCommand') return {};
      throw new Error(`Unexpected command: ${commandName}`);
    });

    const { testBackupRemoteStorage } = await import('../services/backup.service.js');
    const result = await testBackupRemoteStorage();

    expect(result.ok).toBe(true);
    expect(result.data.steps.map((step) => [step.key, step.status])).toEqual([
      ['headBucket', 'warn'],
      ['putObject', 'pass'],
      ['getObject', 'pass'],
      ['deleteObject', 'pass'],
    ]);
    expect(s3Mocks.send.mock.calls.map(([command]) => command.constructor.name)).toEqual([
      'HeadBucketCommand',
      'PutObjectCommand',
      'GetObjectCommand',
      'DeleteObjectsCommand',
    ]);
  });

  it('fails integrity validation but still deletes the test object when read-back content differs', async () => {
    s3Mocks.send.mockImplementation(async (command: any) => {
      const commandName = command.constructor.name;
      if (commandName === 'GetObjectCommand') {
        return { Body: { transformToString: async () => 'corrupted' } };
      }
      return {};
    });

    const { testBackupRemoteStorage } = await import('../services/backup.service.js');
    const result = await testBackupRemoteStorage();

    expect(result.ok).toBe(false);
    expect(result.data.steps.find((step) => step.key === 'getObject')).toMatchObject({
      status: 'fail',
      critical: true,
    });
    expect(result.data.steps.find((step) => step.key === 'deleteObject')?.status).toBe('pass');
  });
});

describe('backup schedule helpers', () => {
  it('matches five-field cron schedules without running twice in the same minute', async () => {
    const { shouldRunBackupNow } = await import('../services/backup.service.js');
    const now = new Date(2026, 5, 3, 3, 0, 25);

    expect(shouldRunBackupNow('0 3 * * *', now, null)).toBe(true);
    expect(shouldRunBackupNow('0 3 * * *', now, new Date(2026, 5, 3, 3, 0, 0))).toBe(false);
    expect(shouldRunBackupNow('0 3 * * *', new Date(2026, 5, 3, 3, 1, 0), null)).toBe(false);
  });

  it('treats day-of-week 7 as Sunday', async () => {
    const { shouldRunBackupNow } = await import('../services/backup.service.js');

    expect(shouldRunBackupNow('30 2 * * 7', new Date(2026, 5, 7, 2, 30, 0), null)).toBe(true);
  });
});

describe('pg_dump connection helpers', () => {
  it('removes Prisma-only schema query param and returns it as pg_dump schema option', async () => {
    const { normalizePgDumpConnection } = await import('../services/backup.service.js');

    expect(normalizePgDumpConnection('postgresql://u:p@127.0.0.1:5432/db?schema=public&connection_limit=5')).toEqual({
      dbUrl: 'postgresql://u:p@127.0.0.1:5432/db',
      schema: 'public',
    });
  });
});
