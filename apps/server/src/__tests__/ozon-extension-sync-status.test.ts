import { describe, expect, it } from 'vitest';
import { deriveOzonExtensionSyncStatus } from 'shared/ozon-extension-sync-status';

describe('ozon extension sync status', () => {
  it('reports disconnected when the extension is unavailable', () => {
    const status = deriveOzonExtensionSyncStatus({ extensionAvailable: false });

    expect(status.connection).toBe('disconnected');
    expect(status.connectionLabel).toBe('扩展未连接');
    expect(status.overallTone).toBe('muted');
  });

  it('summarizes healthy auto sync state from stored extension timestamps', () => {
    const status = deriveOzonExtensionSyncStatus({
      extensionAvailable: true,
      hasErpConnection: true,
      intervalMinutes: 30,
      state: {
        lastCompanyId: '4494016',
        updatedAt: '2026-07-03T08:00:00.000Z',
        cookieAt: Date.parse('2026-07-03T07:55:00.000Z'),
        analyticsAt: Date.parse('2026-07-03T07:50:00.000Z'),
        graphsAt: Date.parse('2026-07-03T07:45:00.000Z'),
        lastResult: {
          cookie: { ok: true, syncedAt: '2026-07-03T07:55:00.000Z' },
          analytics: { ok: true, itemCount: 123, period: '30d' },
          graphs: { ok: true, itemCount: 88 },
        },
      },
    });

    expect(status.connection).toBe('connected');
    expect(status.companyId).toBe('4494016');
    expect(status.overallTone).toBe('success');
    expect(status.items.map((item) => [item.key, item.tone, item.detail])).toEqual([
      ['cookie', 'success', '07-03 15:55'],
      ['analytics', 'success', '123 条 · 30d'],
      ['graphs', 'success', '88 条'],
    ]);
  });

  it('surfaces last slot errors without marking the extension as disconnected', () => {
    const status = deriveOzonExtensionSyncStatus({
      extensionAvailable: true,
      hasErpConnection: true,
      state: {
        lastCompanyId: '4494016',
        lastResult: {
          cookie: { ok: false, error: 'Failed to get body company ID' },
          analytics: { ok: true, itemCount: 12 },
          graphs: { ok: false, error: 'Ozon 图表同步模块未加载' },
        },
      },
    });

    expect(status.connection).toBe('connected');
    expect(status.overallTone).toBe('danger');
    expect(status.lastError).toBe('Cookie：Failed to get body company ID');
    expect(status.items.find((item) => item.key === 'graphs')?.label).toBe('图表失败');
  });
});
