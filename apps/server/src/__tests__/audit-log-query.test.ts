import { describe, expect, it } from 'vitest';
import { buildAuditLogQuery } from '../lib/audit-log-query.js';

describe('audit log query builder', () => {
  it('clamps pagination and trims filters', () => {
    const result = buildAuditLogQuery({
      offset: '-10',
      limit: '500',
      action: ' http_post ',
      actorId: ' actor-1 ',
    });

    expect(result).toEqual({
      ok: true,
      value: {
        offset: 0,
        limit: 100,
        where: {
          action: { contains: 'http_post' },
          actorId: 'actor-1',
        },
      },
    });
  });

  it('expands date-only dateTo to the end of that local day', () => {
    const result = buildAuditLogQuery({
      dateFrom: '2026-06-08',
      dateTo: '2026-06-08',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.where.createdAt.gte.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(result.value.where.createdAt.lte.toISOString()).toBe('2026-06-08T23:59:59.999Z');
  });

  it('rejects invalid dates before Prisma receives them', () => {
    const result = buildAuditLogQuery({
      dateFrom: 'not-a-date',
      dateTo: '2026-06-08',
    });

    expect(result).toEqual({ ok: false, message: '开始日期格式不正确' });
  });
});
