export const AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY = 'health:ai-image-suite-generation-worker:v1';
export const AI_IMAGE_SUITE_WORKER_HEARTBEAT_TTL_MS = 30_000;
export const AI_IMAGE_SUITE_WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const AI_IMAGE_SUITE_RUNTIME_PROBE_TIMEOUT_MS = 1_000;

export interface AiImageSuiteRuntimeRedis {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
}

async function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        timer.unref();
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeAiImageSuiteRuntime(input: {
  redis: Pick<AiImageSuiteRuntimeRedis, 'ping' | 'get'>;
  queueAvailable: boolean;
  timeoutMs?: number;
}) {
  if (!input.queueAvailable) return { queueReady: false, workerReady: false };
  const result = await within(Promise.all([
    input.redis.ping(),
    input.redis.get(AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY),
  ]), input.timeoutMs ?? AI_IMAGE_SUITE_RUNTIME_PROBE_TIMEOUT_MS);
  if (!result || result[0] !== 'PONG') return { queueReady: false, workerReady: false };
  return {
    queueReady: true,
    workerReady: typeof result[1] === 'string' && result[1].length >= 8 && result[1].length <= 200,
  };
}

export async function recordAiImageSuiteWorkerHeartbeat(
  redis: Pick<AiImageSuiteRuntimeRedis, 'set'>,
  token: string,
): Promise<void> {
  if (!token || token.length < 8 || token.length > 200) {
    throw new Error('AI image suite worker heartbeat token is invalid');
  }
  await redis.set(
    AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY,
    token,
    'PX',
    AI_IMAGE_SUITE_WORKER_HEARTBEAT_TTL_MS,
  );
}

export async function clearAiImageSuiteWorkerHeartbeat(
  redis: Pick<AiImageSuiteRuntimeRedis, 'eval'>,
  token: string,
): Promise<void> {
  if (!token || token.length < 8 || token.length > 200) return;
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY,
    token,
  );
}
