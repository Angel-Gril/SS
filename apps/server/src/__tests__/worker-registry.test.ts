import { describe, expect, it, vi } from 'vitest';

import { registerTimer, shutdownAllWorkers } from '../lib/worker-registry.js';

describe('worker registry shutdown', () => {
  it('waits for asynchronous timer shutdown before completing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let release!: () => void;
    const inFlight = new Promise<void>((resolve) => { release = resolve; });
    let stopCompleted = false;
    registerTimer(async () => {
      await inFlight;
      stopCompleted = true;
    });

    let shutdownCompleted = false;
    const shutdown = shutdownAllWorkers(1_000).then(() => { shutdownCompleted = true; });
    await Promise.resolve();
    expect(shutdownCompleted).toBe(false);
    expect(stopCompleted).toBe(false);

    release();
    await shutdown;
    expect(stopCompleted).toBe(true);
    expect(shutdownCompleted).toBe(true);
  });
});
