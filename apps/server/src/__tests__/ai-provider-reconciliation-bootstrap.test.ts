import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('AI Provider reconciliation bootstrap', () => {
  it('starts the database-backed reconciler even when BullMQ is disabled', async () => {
    const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('startAiProviderReconciliationWorker({');
    const redisGate = source.indexOf("if (process.env.REDIS_DISABLED !== '1'");

    expect(source).toContain("import('./workers/ai-provider-reconciliation.js')");
    expect(start).toBeGreaterThan(-1);
    expect(redisGate).toBeGreaterThan(start);
  });

  it('registers the timer in the standalone worker lifecycle', async () => {
    const [bootstrap, worker] = await Promise.all([
      readFile(new URL('../worker.ts', import.meta.url), 'utf8'),
      readFile(new URL('../workers/ai-provider-reconciliation.ts', import.meta.url), 'utf8'),
    ]);

    expect(bootstrap).toContain("import { startAiProviderReconciliationWorker } from './workers/ai-provider-reconciliation.js';");
    expect(bootstrap).toContain('startAiProviderReconciliationWorker();');
    expect(worker).toContain('registerTimer(controller.stop);');
    expect(worker).not.toMatch(/\.submit\(/u);
  });
});
