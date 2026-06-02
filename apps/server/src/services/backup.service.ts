import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';
import {
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getConfig } from '../config/system-config-schema.js';

export interface BackupRemoteConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  prefix: string;
}

export interface BackupRuntimeConfig {
  enabled: boolean;
  schedule: string;
  localDir: string;
  localKeepDays: number;
  dbUrl: string;
  remoteEnabled: boolean;
  remoteKeepDays: number;
  remote: BackupRemoteConfig | null;
  remoteSource: 'system-config' | 'env' | 'none';
  remoteMissing: string[];
}

export interface DiagnosticStep {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  detail?: string;
  elapsedMs?: number;
  critical?: boolean;
}

export interface BackupRunResult {
  ok: boolean;
  msg: string;
  startedAt: string;
  completedAt?: string;
  localFile?: string;
  localPath?: string;
  localSizeBytes?: number;
  localSize?: string;
  localDeleted?: number;
  remoteUploaded?: boolean;
  remoteKey?: string;
  remoteSource?: BackupRuntimeConfig['remoteSource'];
  remoteCleanupDeleted?: number;
  warnings?: string[];
}

const DEFAULT_LOCAL_DIR = '/var/backups/ss-erp';
const DEFAULT_STATUS_PATH = '/var/backups/ss-erp/backup-status.json';
const BACKUP_FILE_PREFIX = 'ss_erp_';
const BACKUP_FILE_SUFFIX = '.sql.gz';

function trimValue(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeRemotePrefix(prefix: string): string {
  const normalized = prefix.trim().replace(/^\/+/, '');
  if (!normalized) return '';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function completeRemoteConfig(values: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  prefix?: string;
}): BackupRemoteConfig | null {
  if (!values.endpoint || !values.bucket || !values.accessKeyId || !values.secretAccessKey) return null;
  return {
    endpoint: values.endpoint.startsWith('http') ? values.endpoint : `https://${values.endpoint}`,
    bucket: values.bucket,
    accessKeyId: values.accessKeyId,
    secretAccessKey: values.secretAccessKey,
    region: values.region || 'auto',
    prefix: normalizeRemotePrefix(values.prefix || 'db/'),
  };
}

function missingRemoteFields(values: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): string[] {
  const missing: string[] = [];
  if (!values.endpoint) missing.push('Endpoint');
  if (!values.bucket) missing.push('Bucket');
  if (!values.accessKeyId) missing.push('Access Key ID');
  if (!values.secretAccessKey) missing.push('Secret Access Key');
  return missing;
}

export async function getBackupRuntimeConfig(): Promise<BackupRuntimeConfig> {
  const [
    enabled,
    schedule,
    localKeepDays,
    remoteEnabled,
    remoteKeepDays,
    remoteBucket,
    remoteEndpoint,
    remoteRegion,
    remotePrefix,
    remoteAccessKeyId,
    remoteSecretAccessKey,
  ] = await Promise.all([
    getConfig('backup_enabled'),
    getConfig('backup_schedule'),
    getConfig('backup_local_keep_days'),
    getConfig('backup_remote_enabled'),
    getConfig('backup_remote_keep_days'),
    getConfig('backup_remote_bucket'),
    getConfig('backup_remote_endpoint'),
    getConfig('backup_remote_region'),
    getConfig('backup_remote_prefix'),
    getConfig('backup_remote_access_key_id'),
    getConfig('backup_remote_secret_access_key'),
  ]);

  const dbValues = {
    endpoint: trimValue(remoteEndpoint),
    bucket: trimValue(remoteBucket),
    accessKeyId: trimValue(remoteAccessKeyId),
    secretAccessKey: trimValue(remoteSecretAccessKey),
    region: trimValue(remoteRegion) || 'auto',
    prefix: trimValue(remotePrefix) || 'db/',
  };
  const dbRemote = remoteEnabled ? completeRemoteConfig(dbValues) : null;

  const envValues = {
    endpoint: trimValue(process.env.BACKUP_S3_ENDPOINT),
    bucket: trimValue(process.env.BACKUP_S3_BUCKET),
    accessKeyId: trimValue(process.env.BACKUP_S3_ACCESS_KEY_ID),
    secretAccessKey: trimValue(process.env.BACKUP_S3_SECRET_ACCESS_KEY),
    region: trimValue(process.env.BACKUP_S3_REGION) || 'auto',
    prefix: trimValue(process.env.BACKUP_S3_PREFIX) || 'db/',
  };
  const envRemote = completeRemoteConfig(envValues);
  const remote = dbRemote || (!remoteEnabled ? envRemote : null);
  const remoteSource = dbRemote ? 'system-config' : envRemote && !remoteEnabled ? 'env' : 'none';
  const remoteMissing = remoteEnabled ? missingRemoteFields(dbValues) : missingRemoteFields(envValues);

  return {
    enabled: Boolean(enabled),
    schedule: trimValue(schedule) || '0 3 * * *',
    localDir: trimValue(process.env.BACKUP_LOCAL_DIR) || DEFAULT_LOCAL_DIR,
    localKeepDays: Number(localKeepDays) || 7,
    dbUrl: trimValue(process.env.BACKUP_DB_URL) || trimValue(process.env.DATABASE_URL),
    remoteEnabled: Boolean(remoteEnabled) || !!envRemote,
    remoteKeepDays: Number(remoteKeepDays) || 30,
    remote,
    remoteSource,
    remoteMissing,
  };
}

function matchCronField(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    const token = part.trim();
    if (!token) return false;
    const [rangeToken, stepToken] = token.split('/');
    const step = stepToken ? Number(stepToken) : 1;
    if (!Number.isInteger(step) || step < 1) return false;

    let start = min;
    let end = max;
    if (rangeToken && rangeToken !== '*') {
      if (rangeToken.includes('-')) {
        const range = rangeToken.split('-').map(Number);
        const rawStart = range[0];
        const rawEnd = range[1];
        if (!Number.isInteger(rawStart) || !Number.isInteger(rawEnd)) return false;
        start = rawStart!;
        end = rawEnd!;
      } else {
        const exact = Number(rangeToken);
        if (!Number.isInteger(exact)) return false;
        start = exact;
        end = exact;
      }
    }

    if (start < min || end > max || start > end || value < start || value > end) return false;
    return (value - start) % step === 0;
  });
}

function sameMinute(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
    && a.getHours() === b.getHours()
    && a.getMinutes() === b.getMinutes();
}

export function shouldRunBackupNow(schedule: string, now: Date, lastRunAt: Date | null): boolean {
  if (lastRunAt && sameMinute(now, lastRunAt)) return false;
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const currentDayOfWeek = now.getDay();
  return matchCronField(minute!, now.getMinutes(), 0, 59)
    && matchCronField(hour!, now.getHours(), 0, 23)
    && matchCronField(dayOfMonth!, now.getDate(), 1, 31)
    && matchCronField(month!, now.getMonth() + 1, 1, 12)
    && (matchCronField(dayOfWeek!, currentDayOfWeek, 0, 7)
      || (currentDayOfWeek === 0 && matchCronField(dayOfWeek!, 7, 0, 7)));
}

function backupFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
  return `${BACKUP_FILE_PREFIX}${ts}${BACKUP_FILE_SUFFIX}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

function createS3Client(remote: BackupRemoteConfig): S3Client {
  return new S3Client({
    endpoint: remote.endpoint,
    region: remote.region || 'auto',
    credentials: {
      accessKeyId: remote.accessKeyId,
      secretAccessKey: remote.secretAccessKey,
    },
    forcePathStyle: remote.endpoint.includes('localhost') || remote.endpoint.includes('minio'),
  });
}

async function dumpDatabaseToGzip(dbUrl: string, outputPath: string): Promise<void> {
  if (!dbUrl) throw new Error('DATABASE_URL/BACKUP_DB_URL 未配置，无法执行数据库备份');
  const pgDump = process.env.PG_DUMP_BIN || 'pg_dump';
  const child = spawn(pgDump, [
    `--dbname=${dbUrl}`,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr = `${stderr}${Buffer.from(chunk).toString('utf8')}`.slice(-4000);
  });

  const exitPromise = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump 失败（exit ${code}）: ${stderr.trim().slice(0, 1000)}`));
    });
  });

  await Promise.all([
    pipeline(child.stdout!, createGzip(), createWriteStream(outputPath)),
    exitPromise,
  ]);
}

async function uploadBackup(remote: BackupRemoteConfig, filePath: string, filename: string): Promise<string> {
  const client = createS3Client(remote);
  const key = `${remote.prefix}${filename}`;
  await client.send(new PutObjectCommand({
    Bucket: remote.bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentType: 'application/gzip',
  }));
  return key;
}

async function cleanupLocalBackups(localDir: string, keepDays: number): Promise<number> {
  const entries = await readdir(localDir, { withFileTypes: true });
  const cutoff = Date.now() - keepDays * 86400000;
  let deleted = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith(BACKUP_FILE_PREFIX) || !entry.name.endsWith(BACKUP_FILE_SUFFIX)) continue;
    const fullPath = path.join(localDir, entry.name);
    const fileStat = await stat(fullPath);
    if (fileStat.mtimeMs <= cutoff) {
      await unlink(fullPath);
      deleted += 1;
    }
  }
  return deleted;
}

async function cleanupRemoteBackups(remote: BackupRemoteConfig, keepDays: number): Promise<number> {
  const client = createS3Client(remote);
  const cutoff = Date.now() - keepDays * 86400000;
  let continuationToken: string | undefined;
  let deleted = 0;

  do {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: remote.bucket,
      Prefix: remote.prefix,
      ContinuationToken: continuationToken,
    }));
    const expired = (listed.Contents || []).filter((object) => {
      if (!object.Key || !object.LastModified) return false;
      if (!object.Key.endsWith(BACKUP_FILE_SUFFIX)) return false;
      return object.LastModified.getTime() <= cutoff;
    });

    for (let i = 0; i < expired.length; i += 1000) {
      const chunk = expired.slice(i, i + 1000);
      if (chunk.length === 0) continue;
      await client.send(new DeleteObjectsCommand({
        Bucket: remote.bucket,
        Delete: { Objects: chunk.map((object) => ({ Key: object.Key! })) },
      }));
      deleted += chunk.length;
    }

    continuationToken = listed.NextContinuationToken;
  } while (continuationToken);

  return deleted;
}

async function writeBackupStatus(result: BackupRunResult): Promise<void> {
  const statusPath = process.env.BACKUP_STATUS_PATH || DEFAULT_STATUS_PATH;
  await mkdir(path.dirname(statusPath), { recursive: true });
  await writeFile(statusPath, `${JSON.stringify({
    available: result.ok,
    lastBackupAt: result.completedAt || result.startedAt,
    lastLocalFile: result.localFile || '',
    lastLocalPath: result.localPath || '',
    lastLocalSize: result.localSize || '',
    lastLocalSizeBytes: result.localSizeBytes || 0,
    remoteUploaded: !!result.remoteUploaded,
    lastRemoteKey: result.remoteKey || '',
    remoteSource: result.remoteSource || 'none',
    remoteCleanupDeleted: result.remoteCleanupDeleted || 0,
    localDeleted: result.localDeleted || 0,
    warnings: result.warnings || [],
    message: result.msg,
  }, null, 2)}\n`, { mode: 0o640 });
}

export async function readBackupStatus(): Promise<Record<string, unknown> | null> {
  const statusPath = process.env.BACKUP_STATUS_PATH || DEFAULT_STATUS_PATH;
  try {
    const raw = await readFile(statusPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runDatabaseBackup(options: { force?: boolean; trigger?: 'scheduled' | 'manual' } = {}): Promise<BackupRunResult> {
  const startedAt = new Date();
  const config = await getBackupRuntimeConfig();
  const warnings: string[] = [];

  if (!config.enabled && !options.force) {
    return {
      ok: false,
      msg: '自动备份未启用',
      startedAt: startedAt.toISOString(),
    };
  }

  await mkdir(config.localDir, { recursive: true });
  const filename = backupFilename(startedAt);
  const finalPath = path.join(config.localDir, filename);
  const tmpPath = `${finalPath}.tmp.${process.pid}`;

  try {
    await dumpDatabaseToGzip(config.dbUrl, tmpPath);
    await rename(tmpPath, finalPath);
    const fileStat = await stat(finalPath);
    const localDeleted = await cleanupLocalBackups(config.localDir, config.localKeepDays);

    let remoteUploaded = false;
    let remoteKey = '';
    let remoteCleanupDeleted = 0;
    if (config.remote) {
      remoteKey = await uploadBackup(config.remote, finalPath, filename);
      remoteUploaded = true;
      try {
        remoteCleanupDeleted = await cleanupRemoteBackups(config.remote, config.remoteKeepDays);
      } catch (error: any) {
        warnings.push(`远程旧备份清理失败：${error?.message || 'unknown'}`);
      }
    } else if (config.remoteEnabled) {
      warnings.push(`远程备份未配置完整：缺少 ${config.remoteMissing.join('、') || '未知字段'}`);
    }

    const result: BackupRunResult = {
      ok: true,
      msg: `${options.trigger === 'manual' ? '手动' : '定时'}备份完成`,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      localFile: filename,
      localPath: finalPath,
      localSizeBytes: fileStat.size,
      localSize: formatBytes(fileStat.size),
      localDeleted,
      remoteUploaded,
      remoteKey,
      remoteSource: config.remoteSource,
      remoteCleanupDeleted,
      warnings,
    };
    await writeBackupStatus(result);
    return result;
  } catch (error: any) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    const result: BackupRunResult = {
      ok: false,
      msg: `备份失败：${String(error?.message || error).slice(0, 500)}`,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      warnings,
    };
    await writeBackupStatus(result);
    return result;
  }
}

export async function testBackupRemoteStorage(): Promise<{ ok: boolean; msg: string; data: { steps: DiagnosticStep[]; bucket?: string; endpoint?: string; prefix?: string; source?: string } }> {
  const config = await getBackupRuntimeConfig();
  const steps: DiagnosticStep[] = [];
  if (!config.remote) {
    return {
      ok: false,
      msg: config.remoteEnabled
        ? `备份 R2 配置不完整：缺少 ${config.remoteMissing.join('、') || '未知字段'}`
        : '备份 R2 未启用；请在系统设置 -> 备份策略中开启远程备份并填写 R2 参数',
      data: { steps, source: config.remoteSource },
    };
  }

  const remote = config.remote;
  const client = createS3Client(remote);
  const testKey = `${remote.prefix}tests/backup-health-${Date.now()}.txt`;
  const body = `ss-erp backup r2 health\nkey=${testKey}\nat=${new Date().toISOString()}\n`;
  let uploaded = false;

  async function step(key: string, label: string, critical: boolean, fn: () => Promise<string | undefined>, warnOnly = false): Promise<boolean> {
    const started = Date.now();
    try {
      const detail = await fn();
      steps.push({ key, label, status: 'pass', detail, critical, elapsedMs: Date.now() - started });
      return true;
    } catch (error: any) {
      steps.push({
        key,
        label,
        status: warnOnly ? 'warn' : 'fail',
        detail: String(error?.message || error).slice(0, 300),
        critical,
        elapsedMs: Date.now() - started,
      });
      return warnOnly;
    }
  }

  await step('headBucket', '桶访问诊断', false, async () => {
    await client.send(new HeadBucketCommand({ Bucket: remote.bucket }));
    return 'Bucket 可访问';
  }, true);

  const putOk = await step('putObject', '写入备份测试对象', true, async () => {
    await client.send(new PutObjectCommand({
      Bucket: remote.bucket,
      Key: testKey,
      Body: Buffer.from(body, 'utf8'),
      ContentType: 'text/plain; charset=utf-8',
      CacheControl: 'no-store',
    }));
    uploaded = true;
    return `已写入 ${testKey}`;
  });

  if (putOk) {
    await step('deleteObject', '删除备份测试对象', true, async () => {
      await client.send(new DeleteObjectsCommand({
        Bucket: remote.bucket,
        Delete: { Objects: [{ Key: testKey }] },
      }));
      uploaded = false;
      return '测试对象已删除';
    });
  } else {
    steps.push({
      key: 'deleteObject',
      label: '删除备份测试对象',
      status: 'skip',
      detail: '写入失败，跳过删除',
      critical: true,
    });
  }

  const failed = steps.some((item) => item.critical && item.status === 'fail');
  return {
    ok: !failed,
    msg: failed ? '备份 R2 测试失败，请查看失败步骤' : uploaded ? '备份 R2 可写，但测试对象未能删除' : '备份 R2 测试通过',
    data: {
      steps,
      bucket: remote.bucket,
      endpoint: remote.endpoint,
      prefix: remote.prefix,
      source: config.remoteSource,
    },
  };
}
