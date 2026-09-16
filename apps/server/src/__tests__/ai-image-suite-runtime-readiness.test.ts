import { describe, expect, it, vi } from 'vitest';
import {
  AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY,
  AI_IMAGE_SUITE_WORKER_HEARTBEAT_TTL_MS,
  clearAiImageSuiteWorkerHeartbeat,
  probeAiImageSuiteRuntime,
  recordAiImageSuiteWorkerHeartbeat,
} from '../services/ai-image-suite-runtime-readiness.js';

describe('AI image suite runtime readiness', () => {
  it('does not treat an old paid-only worker as ready for the Wanx suite protocol', async () => {
    const values = new Map([['health:ai-image-suite-generation-worker:v2', 'old-worker-token']]);
    const redis = { ping: async () => 'PONG', get: async (key: string) => values.get(key) || null };
    await expect(probeAiImageSuiteRuntime({ redis, queueAvailable: true })).resolves.toEqual({ queueReady: true, workerReady: false });
    values.set('health:ai-image-suite-generation-worker:v3', 'wanx-worker-token');
    await expect(probeAiImageSuiteRuntime({ redis, queueAvailable: true })).resolves.toEqual({ queueReady: true, workerReady: true });
  });

  it('fails closed when the queue is not installed without touching Redis', async () => {
    const redis = { ping: vi.fn(), get: vi.fn() };

    await expect(probeAiImageSuiteRuntime({ redis, queueAvailable: false })).resolves.toEqual({
      queueReady: false,
      workerReady: false,
    });
    expect(redis.ping).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('requires both a responsive Redis transport and a live worker heartbeat', async () => {
    const redis = {
      ping: vi.fn(async () => 'PONG'),
      get: vi.fn(async (): Promise<string | null> => 'worker-heartbeat-token'),
    };

    await expect(probeAiImageSuiteRuntime({ redis, queueAvailable: true })).resolves.toEqual({
      queueReady: true,
      workerReady: true,
    });
    expect(redis.get).toHaveBeenCalledWith(AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY);

    redis.get.mockResolvedValueOnce(null);
    await expect(probeAiImageSuiteRuntime({ redis, queueAvailable: true })).resolves.toEqual({
      queueReady: true,
      workerReady: false,
    });
  });

  it('fails closed within the configured timeout when Redis does not respond', async () => {
    const redis = {
      ping: vi.fn(() => new Promise<string>(() => undefined)),
      get: vi.fn(() => new Promise<string | null>(() => undefined)),
    };

    await expect(probeAiImageSuiteRuntime({
      redis,
      queueAvailable: true,
      timeoutMs: 5,
    })).resolves.toEqual({ queueReady: false, workerReady: false });
  });

  it('writes an expiring heartbeat and clears only the matching worker token', async () => {
    const redis = {
      set: vi.fn(async () => 'OK'),
      eval: vi.fn(async () => 1),
    };

    await recordAiImageSuiteWorkerHeartbeat(redis, 'worker-token-123');
    expect(redis.set).toHaveBeenCalledWith(
      AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY,
      'worker-token-123',
      'PX',
      AI_IMAGE_SUITE_WORKER_HEARTBEAT_TTL_MS,
    );

    await clearAiImageSuiteWorkerHeartbeat(redis, 'worker-token-123');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get'"),
      1,
      AI_IMAGE_SUITE_WORKER_HEARTBEAT_KEY,
      'worker-token-123',
    );
  });
});
