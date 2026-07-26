import { describe, expect, it } from 'vitest';
import {
  createPrismaExtensionByokIngestRateLimiter,
} from '../services/extension-byok-ingest-rate-limit.js';

describe('extension BYOK ingest persistent rate limit', () => {
  it('serializes by device, records every authorized request, and uses database time', async () => {
    const sql: string[] = [];
    const tx = {
      async $queryRawUnsafe<T>(statement: string): Promise<T> {
        sql.push(statement);
        if (statement.includes('FROM "extension_device_sessions"')) return [{ id: 'session-1' }] as T;
        if (statement.includes('INSERT INTO "extension_byok_ingest_rate_events"')) {
          return [{ priorCount: 10n, earliest: new Date('2026-07-26T01:59:30.000Z'), occurredAt: new Date('2026-07-26T02:00:00.000Z') }] as T;
        }
        throw new Error(`Unexpected SQL: ${statement}`);
      },
    };
    const client = {
      ...tx,
      async $transaction<T>(action: (value: typeof tx) => Promise<T>, options: unknown) {
        expect(options).toEqual({ isolationLevel: 'Serializable' });
        return action(tx);
      },
    };
    const limiter = createPrismaExtensionByokIngestRateLimiter(client as never);
    await expect(limiter.consume({
      id: 'event-1', ownerUserId: 'owner-1', deviceSessionId: 'session-1', limit: 10,
    })).resolves.toMatchObject({
      kind: 'rate_limited',
      limit: 10,
      occurredAt: new Date('2026-07-26T02:00:00.000Z'),
    });
    expect(sql[0]).toContain('FOR UPDATE');
    expect(sql[1]).toContain('clock_timestamp()');
    expect(sql[1]).toContain('INSERT INTO "extension_byok_ingest_rate_events"');
    expect(sql[1]).toContain('COUNT(*)');
  });
});
