import { randomUUID } from 'node:crypto';
import { open, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { redis, redisDisabled } from '../lib/redis.js';
import {
  resolveDefaultBackupDir,
  runDatabaseBackup,
  type BackupRunResult,
} from './backup.service.js';

const BACKUP_RUN_LOCK_KEY = 'lock:ss-erp:database-backup';
const BACKUP_RUN_LOCK_TTL_MS = 6 * 60 * 60 * 1000;
const BACKUP_RUN_HEARTBEAT_MS = 30_000;
const RENEW_LEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE_LEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

export class BackupRunInProgressError extends Error {
  constructor() {
    super('已有数据库备份正在执行，请稍后重试');
    this.name = 'BackupRunInProgressError';
  }
}

export class BackupRunLockUnavailableError extends Error {
  constructor() {
    super('数据库备份锁服务不可用，已失败关闭；请确认 Redis 正常后重试');
    this.name = 'BackupRunLockUnavailableError';
  }
}

export class BackupRunLeaseLostError extends Error {
  constructor(message = '数据库备份租约已失效，任务已中止') {
    super(message);
    this.name = 'BackupRunLeaseLostError';
  }
}

export interface BackupRunLease {
  signal: AbortSignal;
  assertHeld: () => Promise<void>;
  release: () => Promise<void>;
  stopHeartbeat: () => Promise<void>;
}

async function acquireRedisLease(token: string): Promise<BackupRunLease> {
  let acquired: unknown;
  try {
    acquired = await redis.set(
      BACKUP_RUN_LOCK_KEY,
      token,
      'PX',
      BACKUP_RUN_LOCK_TTL_MS,
      'NX',
    );
  } catch {
    throw new BackupRunLockUnavailableError();
  }
  if (acquired !== 'OK') throw new BackupRunInProgressError();

  const controller = new AbortController();
  let lostError: BackupRunLeaseLostError | null = null;
  let heartbeatPromise: Promise<void> = Promise.resolve();
  let heartbeatRunning = false;

  const markLost = (reason?: unknown) => {
    if (lostError) return lostError;
    const detail = reason instanceof Error ? `：${reason.message}` : '';
    lostError = new BackupRunLeaseLostError(`数据库备份 Redis 租约已失效${detail}`);
    controller.abort(lostError);
    return lostError;
  };
  const renew = async () => {
    if (lostError) throw lostError;
    let renewed: unknown;
    try {
      renewed = await redis.eval(
        RENEW_LEASE_SCRIPT,
        1,
        BACKUP_RUN_LOCK_KEY,
        token,
        String(BACKUP_RUN_LOCK_TTL_MS),
      );
    } catch (error) {
      throw markLost(error);
    }
    if (Number(renewed) !== 1) throw markLost();
  };
  const heartbeat = setInterval(() => {
    if (heartbeatRunning || lostError) return;
    heartbeatRunning = true;
    heartbeatPromise = renew()
      .catch((error: unknown) => {
        console.error(`[backup] lock heartbeat failed: ${String(error)}`);
      })
      .finally(() => {
        heartbeatRunning = false;
      });
  }, BACKUP_RUN_HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    signal: controller.signal,
    assertHeld: renew,
    stopHeartbeat: async () => {
      clearInterval(heartbeat);
      await heartbeatPromise;
    },
    release: async () => {
      try {
        await redis.eval(
          RELEASE_LEASE_SCRIPT,
          1,
          BACKUP_RUN_LOCK_KEY,
          token,
        );
      } catch (error) {
        console.error(`[backup] lock release failed: ${String(error)}`);
      }
    },
  };
}

interface LocalLockIdentity {
  dev: number;
  ino: number;
}

interface LocalLockRecord {
  token: string;
  pid: number;
  createdAt: string;
}

function parseLocalLockRecord(raw: string): LocalLockRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LocalLockRecord>;
    if (typeof parsed.token !== 'string' || !parsed.token) return null;
    if (!Number.isInteger(parsed.pid) || Number(parsed.pid) <= 0) return null;
    if (typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))) return null;
    return {
      token: parsed.token,
      pid: Number(parsed.pid),
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code !== 'ESRCH';
  }
}

async function localLockOwned(
  lockPath: string,
  token: string,
  identity: LocalLockIdentity,
  requireToken = true,
): Promise<boolean> {
  try {
    const current = await stat(lockPath);
    if (current.dev !== identity.dev || current.ino !== identity.ino) return false;
    if (!requireToken) return true;
    return parseLocalLockRecord(await readFile(lockPath, 'utf8'))?.token === token;
  } catch {
    return false;
  }
}

async function removeOwnedLocalLock(
  lockPath: string,
  token: string,
  identity: LocalLockIdentity,
  requireToken = true,
): Promise<void> {
  if (!await localLockOwned(lockPath, token, identity, requireToken)) return;
  await unlink(lockPath).catch(() => undefined);
}

async function recoverStaleLocalLock(lockPath: string): Promise<boolean> {
  try {
    const before = await stat(lockPath);
    const record = parseLocalLockRecord(await readFile(lockPath, 'utf8'));
    if (!record) return false;
    const ageMs = Date.now() - Math.max(before.mtimeMs, Date.parse(record.createdAt));
    if (ageMs <= BACKUP_RUN_LOCK_TTL_MS || processIsAlive(record.pid)) return false;
    const after = await stat(lockPath);
    if (after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) {
      return false;
    }
    await unlink(lockPath);
    return true;
  } catch {
    return false;
  }
}

export async function acquireLocalBackupRunLease(token: string): Promise<BackupRunLease> {
  const lockPath = path.join(resolveDefaultBackupDir(), '.database-backup.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let identity: LocalLockIdentity | undefined;
  try {
    try {
      handle = await open(lockPath, 'wx');
    } catch (error: any) {
      if (error?.code !== 'EEXIST' || !await recoverStaleLocalLock(lockPath)) throw error;
      handle = await open(lockPath, 'wx');
    }
    const opened = await handle.stat();
    identity = { dev: opened.dev, ino: opened.ino };
    const record: LocalLockRecord = {
      token,
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } catch (error: any) {
    await handle?.close().catch(() => undefined);
    if (identity) await removeOwnedLocalLock(lockPath, token, identity, false);
    if (error?.code === 'EEXIST') throw new BackupRunInProgressError();
    throw new BackupRunLockUnavailableError();
  }
  if (!handle || !identity) throw new BackupRunLockUnavailableError();
  const lockHandle = handle;
  const lockIdentity = identity;
  const controller = new AbortController();
  let lostError: BackupRunLeaseLostError | null = null;
  const markLost = () => {
    if (!lostError) {
      lostError = new BackupRunLeaseLostError('数据库备份本地租约已失效');
      controller.abort(lostError);
    }
    return lostError;
  };

  return {
    signal: controller.signal,
    assertHeld: async () => {
      if (lostError || !await localLockOwned(lockPath, token, lockIdentity)) {
        throw markLost();
      }
    },
    stopHeartbeat: async () => undefined,
    release: async () => {
      const ownedBeforeClose = await localLockOwned(lockPath, token, lockIdentity);
      await lockHandle.close().catch(() => undefined);
      if (ownedBeforeClose) {
        await removeOwnedLocalLock(lockPath, token, lockIdentity);
      }
    },
  };
}

async function acquireBackupRunLease(token: string): Promise<BackupRunLease> {
  // Production API and worker processes share Redis. When Redis is explicitly
  // disabled, an atomic same-host lock still prevents the local API/worker
  // pair from writing the same second-based backup filename concurrently.
  // Cloud deployments fail closed instead of relying on a crash-stale file
  // lock; Redis is a required part of the multi-process backup contract there.
  if (redisDisabled && process.env.RUNTIME_MODE === 'cloud') {
    throw new BackupRunLockUnavailableError();
  }
  return redisDisabled ? acquireLocalBackupRunLease(token) : acquireRedisLease(token);
}

export async function runDatabaseBackupSingleFlight(
  options: { force?: boolean; trigger?: 'scheduled' | 'manual' } = {},
): Promise<BackupRunResult> {
  const token = randomUUID();
  const lease = await acquireBackupRunLease(token);
  try {
    await lease.assertHeld();
    const result = await runDatabaseBackup({
      ...options,
      runId: token,
      signal: lease.signal,
      assertLease: lease.assertHeld,
    });
    await lease.assertHeld();
    return result;
  } finally {
    await lease.stopHeartbeat();
    await lease.release();
  }
}

export type ManualBackupStart =
  | { accepted: false }
  | { accepted: true; promise: Promise<BackupRunResult> };

let manualBackupInFlight: Promise<BackupRunResult> | null = null;

/**
 * Start one manual backup per API process. The process-local guard avoids
 * needless Redis round trips for duplicate clicks; the shared lease above is
 * the authority across API and worker processes.
 */
export function startManualDatabaseBackup(): ManualBackupStart {
  if (manualBackupInFlight) return { accepted: false };

  const operation = Promise.resolve().then(() => runDatabaseBackupSingleFlight({
    force: true,
    trigger: 'manual',
  }));
  manualBackupInFlight = operation;

  void operation
    .finally(() => {
      if (manualBackupInFlight === operation) manualBackupInFlight = null;
    })
    .catch(() => {
      // The route owns the operation's rejection; this branch only observes
      // the Promise returned by finally so cleanup never creates an unhandled
      // rejection of its own.
    });

  return { accepted: true, promise: operation };
}
