import { createHash, randomUUID } from 'node:crypto';

export const AI_IMAGE_SUITE_PREPARATION_LEASE_TTL_MS = 120_000;
export const AI_IMAGE_SUITE_PREPARATION_LEASE_HEARTBEAT_MS = 30_000;

const MIN_LEASE_TTL_MS = 10_000;
const MAX_LEASE_TTL_MS = 300_000;
const MIN_HEARTBEAT_MS = 1_000;
const MIN_PROBE_TIMEOUT_MS = 100;
const MAX_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 1_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const MAX_SUITE_ID_LENGTH = 200;
const MAX_TOKEN_LENGTH = 200;

const RENEW_LEASE_SCRIPT = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "return redis.call('pexpire', KEYS[1], ARGV[2])",
].join('\n');

const RELEASE_LEASE_SCRIPT = [
  "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end",
  "return redis.call('del', KEYS[1])",
].join('\n');

export type AiImageSuitePreparationLeaseErrorCode =
  | 'AI_MEDIA_SUITE_PREPARATION_LEASE_BUSY'
  | 'AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE'
  | 'AI_MEDIA_SUITE_PREPARATION_LEASE_LOST';

export class AiImageSuitePreparationLeaseError extends Error {
  constructor(
    public readonly code: AiImageSuitePreparationLeaseErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AiImageSuitePreparationLeaseError';
  }
}

export interface AiImageSuitePreparationLeaseGuard {
  ensureOwned(): Promise<void>;
}

export interface AiImageSuitePreparationLeaseScope {
  ownerUserId: string;
  suiteId: string;
}

export interface AiImageSuitePreparationLease {
  runExclusive<T>(
    scope: AiImageSuitePreparationLeaseScope,
    work: (guard: AiImageSuitePreparationLeaseGuard) => Promise<T>,
  ): Promise<T>;
  isReady(): Promise<boolean>;
}

export interface AiImageSuitePreparationLeaseRedis {
  set(
    key: string,
    token: string,
    expiryMode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<unknown>;
  eval(
    script: string,
    keyCount: 1,
    key: string,
    ...args: Array<string | number>
  ): Promise<unknown>;
  ping(): Promise<unknown>;
}

export interface AiImageSuitePreparationLeaseOptions {
  redis: AiImageSuitePreparationLeaseRedis;
  disabled?: boolean;
  ttlMs?: number;
  heartbeatMs?: number;
  commandTimeoutMs?: number;
  probeTimeoutMs?: number;
  createToken?: () => string;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return resolved;
}

function exactScopeId(value: string, label: string): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > MAX_SUITE_ID_LENGTH) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function exactToken(value: string): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > MAX_TOKEN_LENGTH) {
    throw new TypeError('AI image suite preparation lease token is invalid');
  }
  return value;
}

export function aiImageSuitePreparationLeaseKey(
  scope: AiImageSuitePreparationLeaseScope,
): string {
  const ownerUserId = exactScopeId(scope.ownerUserId, 'ownerUserId');
  const suiteId = exactScopeId(scope.suiteId, 'suiteId');
  const digest = createHash('sha256')
    .update(JSON.stringify(['ai-image-suite-preparation/v1', ownerUserId, suiteId]))
    .digest('hex');
  return `lease:ai-image-suite-preparation:${digest}`;
}

function unavailable(message: string, cause?: unknown): AiImageSuitePreparationLeaseError {
  return new AiImageSuitePreparationLeaseError(
    'AI_MEDIA_SUITE_PREPARATION_LEASE_UNAVAILABLE',
    message,
    { cause },
  );
}

function normalizeLeaseFailure(error: unknown): AiImageSuitePreparationLeaseError {
  return error instanceof AiImageSuitePreparationLeaseError
    ? error
    : unavailable('AI image suite preparation coordination is unavailable', error);
}

async function within<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createRedisAiImageSuitePreparationLease(
  options: AiImageSuitePreparationLeaseOptions,
): AiImageSuitePreparationLease {
  const ttlMs = boundedInteger(
    options.ttlMs,
    AI_IMAGE_SUITE_PREPARATION_LEASE_TTL_MS,
    MIN_LEASE_TTL_MS,
    MAX_LEASE_TTL_MS,
    'ttlMs',
  );
  const heartbeatMs = boundedInteger(
    options.heartbeatMs,
    AI_IMAGE_SUITE_PREPARATION_LEASE_HEARTBEAT_MS,
    MIN_HEARTBEAT_MS,
    Math.floor(ttlMs / 2),
    'heartbeatMs',
  );
  const probeTimeoutMs = boundedInteger(
    options.probeTimeoutMs,
    DEFAULT_PROBE_TIMEOUT_MS,
    MIN_PROBE_TIMEOUT_MS,
    MAX_PROBE_TIMEOUT_MS,
    'probeTimeoutMs',
  );
  const commandTimeoutMs = boundedInteger(
    options.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
    MIN_PROBE_TIMEOUT_MS,
    MAX_PROBE_TIMEOUT_MS,
    'commandTimeoutMs',
  );
  const createToken = options.createToken || randomUUID;

  const renew = async (key: string, token: string): Promise<void> => {
    let result: unknown;
    try {
      result = await within(
        options.redis.eval(RENEW_LEASE_SCRIPT, 1, key, token, ttlMs),
        commandTimeoutMs,
        'AI image suite preparation lease renewal',
      );
    } catch (error) {
      throw unavailable('AI image suite preparation lease could not be renewed', error);
    }
    if (Number(result) !== 1) {
      throw new AiImageSuitePreparationLeaseError(
        'AI_MEDIA_SUITE_PREPARATION_LEASE_LOST',
        'AI image suite preparation lease ownership was lost',
      );
    }
  };

  const release = async (key: string, token: string): Promise<void> => {
    let result: unknown;
    try {
      result = await within(
        options.redis.eval(RELEASE_LEASE_SCRIPT, 1, key, token),
        commandTimeoutMs,
        'AI image suite preparation lease release',
      );
    } catch (error) {
      throw unavailable('AI image suite preparation lease could not be released', error);
    }
    if (Number(result) !== 1) {
      throw new AiImageSuitePreparationLeaseError(
        'AI_MEDIA_SUITE_PREPARATION_LEASE_LOST',
        'AI image suite preparation lease ownership was lost before release',
      );
    }
  };

  return {
    async runExclusive<T>(
      scope: AiImageSuitePreparationLeaseScope,
      work: (guard: AiImageSuitePreparationLeaseGuard) => Promise<T>,
    ): Promise<T> {
      const key = aiImageSuitePreparationLeaseKey(scope);
      const token = exactToken(createToken());
      if (options.disabled) {
        throw unavailable('Redis is required for AI image suite reference preparation');
      }

      let acquired: unknown;
      try {
        acquired = await within(
          options.redis.set(key, token, 'PX', ttlMs, 'NX'),
          commandTimeoutMs,
          'AI image suite preparation lease acquisition',
        );
      } catch (error) {
        throw unavailable('AI image suite preparation lease could not be acquired', error);
      }
      if (acquired == null) {
        throw new AiImageSuitePreparationLeaseError(
          'AI_MEDIA_SUITE_PREPARATION_LEASE_BUSY',
          'AI image suite reference preparation is already in progress',
        );
      }
      if (acquired !== 'OK') {
        throw unavailable('AI image suite preparation lease returned an invalid acquire result');
      }

      let renewalFailure: AiImageSuitePreparationLeaseError | null = null;
      let renewalChain: Promise<void> = Promise.resolve();
      const queueRenewal = (): Promise<void> => {
        renewalChain = renewalChain.then(async () => {
          if (renewalFailure) return;
          try {
            await renew(key, token);
          } catch (error) {
            renewalFailure = normalizeLeaseFailure(error);
          }
        });
        return renewalChain;
      };
      const heartbeat = setInterval(() => {
        void queueRenewal();
      }, heartbeatMs);
      heartbeat.unref?.();

      const guard: AiImageSuitePreparationLeaseGuard = {
        async ensureOwned() {
          await queueRenewal();
          if (renewalFailure) throw renewalFailure;
        },
      };

      let result: T | undefined;
      let failure: unknown;
      let failed = false;
      try {
        result = await work(guard);
        await guard.ensureOwned();
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        clearInterval(heartbeat);
        await renewalChain;
        if (!failed && renewalFailure) {
          failed = true;
          failure = renewalFailure;
        }
        try {
          await release(key, token);
        } catch (error) {
          if (!failed) {
            failed = true;
            failure = normalizeLeaseFailure(error);
          }
        }
      }
      if (failed) throw failure;
      return result as T;
    },

    async isReady(): Promise<boolean> {
      if (options.disabled) return false;
      try {
        const response = await within(
          options.redis.ping(),
          probeTimeoutMs,
          'Redis readiness probe',
        );
        return String(response).toUpperCase() === 'PONG';
      } catch {
        return false;
      }
    },
  };
}
