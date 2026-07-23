import { mkdtemp, open, readFile, rm, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opsRoutes } from '../routes/ops.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = {
      role: 'ADMIN',
      isSuperAdmin: true,
      tokenUse: request.headers['x-token-use'] || 'account_session',
    };
  }),
  requireSuperAdmin: vi.fn(async () => undefined),
  readBackupStatus: vi.fn(async () => null),
  runDatabaseBackup: vi.fn(),
  redisSet: vi.fn(async (..._args: unknown[]): Promise<string | null> => 'OK'),
  redisEval: vi.fn(async () => 1),
  backupDir: 'D:/ss-erp-test-backups',
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
  requireSuperAdmin: mocks.requireSuperAdmin,
}));

vi.mock('../services/backup.service.js', () => ({
  readBackupStatus: mocks.readBackupStatus,
  runDatabaseBackup: mocks.runDatabaseBackup,
  resolveDefaultBackupDir: vi.fn(() => mocks.backupDir),
}));

vi.mock('../lib/redis.js', () => ({
  redisDisabled: false,
  redis: {
    set: mocks.redisSet,
    eval: mocks.redisEval,
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function successfulBackup() {
  return {
    ok: true,
    msg: 'manual backup complete',
    startedAt: '2026-07-23T00:00:00.000Z',
    completedAt: '2026-07-23T00:00:01.000Z',
  };
}

async function buildApp() {
  const app = Fastify();
  await app.register(opsRoutes, { prefix: '/api/admin/ops' });
  await app.ready();
  return app;
}

describe('manual backup route concurrency', () => {
  const temporaryDirectories: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.runDatabaseBackup.mockReset();
    mocks.redisSet.mockResolvedValue('OK');
    mocks.redisEval.mockResolvedValue(1);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((directory) => (
      rm(directory, { recursive: true, force: true })
    )));
  });

  async function createBackupDirectory(): Promise<string> {
    const directory = await mkdtemp(path.join(tmpdir(), 'ss-erp-backup-lock-'));
    temporaryDirectories.push(directory);
    mocks.backupDir = directory;
    return directory;
  }

  it('rejects a concurrent request while the first backup is still running', async () => {
    const deferred = createDeferred<ReturnType<typeof successfulBackup>>();
    mocks.runDatabaseBackup
      .mockImplementationOnce(() => deferred.promise)
      .mockResolvedValueOnce(successfulBackup());
    const app = await buildApp();

    try {
      const firstResponsePromise = app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
      });
      await vi.waitFor(() => expect(mocks.runDatabaseBackup).toHaveBeenCalledTimes(1));

      const concurrentResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
      });

      expect(concurrentResponse.statusCode).toBe(409);
      expect(concurrentResponse.json()).toMatchObject({
        code: 0,
        errorCode: 'backup_in_progress',
      });
      expect(mocks.runDatabaseBackup).toHaveBeenCalledTimes(1);

      deferred.resolve(successfulBackup());
      const firstResponse = await firstResponsePromise;
      const retryResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
      });

      expect(firstResponse.statusCode).toBe(200);
      expect(retryResponse.statusCode).toBe(200);
      expect(mocks.runDatabaseBackup).toHaveBeenCalledTimes(2);
    } finally {
      deferred.resolve(successfulBackup());
      await app.close();
    }
  });

  it('allows a retry after an unexpected backup failure releases the lock', async () => {
    mocks.runDatabaseBackup
      .mockRejectedValueOnce(new Error('pg_dump crashed'))
      .mockResolvedValueOnce(successfulBackup());
    const app = await buildApp();

    try {
      const failedResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
      });
      const retryResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
      });

      expect(failedResponse.statusCode).toBe(500);
      expect(retryResponse.statusCode).toBe(200);
      expect(retryResponse.json()).toMatchObject({ code: 1 });
      expect(mocks.runDatabaseBackup).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('uses one Redis lease across independent backup callers and releases only its token', async () => {
    const deferred = createDeferred<ReturnType<typeof successfulBackup>>();
    mocks.runDatabaseBackup.mockImplementationOnce(() => deferred.promise);
    const { runDatabaseBackupSingleFlight } = await import('../services/backup-run.service.js');

    const first = runDatabaseBackupSingleFlight({ trigger: 'scheduled' });
    await vi.waitFor(() => expect(mocks.redisSet).toHaveBeenCalledTimes(1));

    mocks.redisSet.mockResolvedValueOnce(null);
    await expect(runDatabaseBackupSingleFlight({ trigger: 'manual', force: true }))
      .rejects.toMatchObject({ name: 'BackupRunInProgressError' });
    expect(mocks.runDatabaseBackup).toHaveBeenCalledTimes(1);

    deferred.resolve(successfulBackup());
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(mocks.redisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('del'"),
      1,
      'lock:ss-erp:database-backup',
      expect.any(String),
    );
  });

  it('fails closed when Redis cannot acquire the shared lease', async () => {
    mocks.redisSet.mockRejectedValueOnce(new Error('redis unavailable'));
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'backup_lock_unavailable',
      });
      expect(mocks.runDatabaseBackup).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('aborts the backup when a Redis heartbeat reports that the lease was lost', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.redisEval
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(0);
    mocks.runDatabaseBackup.mockImplementationOnce((options: { signal: AbortSignal }) => (
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      })
    ));
    const { runDatabaseBackupSingleFlight } = await import('../services/backup-run.service.js');

    const operation = runDatabaseBackupSingleFlight({ trigger: 'scheduled' });
    void operation.catch(() => undefined);
    await vi.waitFor(() => expect(mocks.runDatabaseBackup).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(operation).rejects.toMatchObject({ name: 'BackupRunLeaseLostError' });
    const backupOptions = mocks.runDatabaseBackup.mock.calls[0]?.[0] as { signal: AbortSignal };
    expect(backupOptions.signal.aborted).toBe(true);
    expect(mocks.redisEval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('pexpire'"),
      1,
      'lock:ss-erp:database-backup',
      expect.any(String),
      expect.any(String),
    );
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('lock heartbeat failed'));
  });

  it('keeps local backup callers mutually exclusive and allows reacquisition after release', async () => {
    await createBackupDirectory();
    const { acquireLocalBackupRunLease } = await import('../services/backup-run.service.js');

    const first = await acquireLocalBackupRunLease('owner-a');
    await expect(acquireLocalBackupRunLease('owner-b'))
      .rejects.toMatchObject({ name: 'BackupRunInProgressError' });

    await first.release();
    const next = await acquireLocalBackupRunLease('owner-c');
    await expect(next.assertHeld()).resolves.toBeUndefined();
    await next.release();
  });

  it('does not remove a local lock whose token no longer belongs to the lease', async () => {
    const directory = await createBackupDirectory();
    const lockPath = path.join(directory, '.database-backup.lock');
    const { acquireLocalBackupRunLease } = await import('../services/backup-run.service.js');
    const first = await acquireLocalBackupRunLease('owner-a');
    const replacement = {
      token: 'owner-b',
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    await writeFile(lockPath, `${JSON.stringify(replacement)}\n`, 'utf8');

    await first.release();

    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({ token: 'owner-b' });
    await unlink(lockPath);
  });

  it('recovers a stale local lock only after its owner process is gone', async () => {
    const directory = await createBackupDirectory();
    const lockPath = path.join(directory, '.database-backup.lock');
    const staleDate = new Date(Date.now() - 7 * 60 * 60 * 1000);
    await writeFile(lockPath, `${JSON.stringify({
      token: 'stale-owner',
      pid: 987654321,
      createdAt: staleDate.toISOString(),
    })}\n`, 'utf8');
    await utimes(lockPath, staleDate, staleDate);
    vi.spyOn(process, 'kill').mockImplementation((() => {
      throw Object.assign(new Error('process not found'), { code: 'ESRCH' });
    }) as typeof process.kill);
    const { acquireLocalBackupRunLease } = await import('../services/backup-run.service.js');

    const lease = await acquireLocalBackupRunLease('fresh-owner');
    await expect(lease.assertHeld()).resolves.toBeUndefined();
    await lease.release();
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes the local lock when initialization fails after atomic creation', async () => {
    const directory = await createBackupDirectory();
    const lockPath = path.join(directory, '.database-backup.lock');
    const probePath = path.join(directory, '.file-handle-probe');
    const probeHandle = await open(probePath, 'wx');
    const fileHandlePrototype = Object.getPrototypeOf(probeHandle) as { sync: () => Promise<void> };
    await probeHandle.close();
    await unlink(probePath);
    vi.spyOn(fileHandlePrototype, 'sync').mockRejectedValueOnce(new Error('fsync failed'));
    const { acquireLocalBackupRunLease } = await import('../services/backup-run.service.js');

    await expect(acquireLocalBackupRunLease('owner-a'))
      .rejects.toMatchObject({ name: 'BackupRunLockUnavailableError' });
    await expect(stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects legacy extension tokens before starting a manual backup', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/ops/backup/run',
        headers: { 'x-token-use': 'legacy_extension' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        errorCode: 'ops_account_session_required',
      });
      expect(mocks.runDatabaseBackup).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
