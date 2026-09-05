import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../config/system-config-schema.js', () => ({ getConfig: mocks.getConfig }));
vi.mock('../lib/prisma.js', () => ({
  prisma: { auditLog: { create: mocks.create } },
}));

import { AuditLogWriteError, logAudit } from '../lib/audit-log.js';

const entry = {
  actorRole: 'ADMIN' as const,
  action: 'user_permission_change',
  target: 'user-1',
  before: { role: 'USER' },
  after: { role: 'ADMIN' },
};

describe('audit log reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.getConfig.mockResolvedValue(false);
    mocks.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('allows configured development audit logging to remain optional', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    await expect(logAudit(entry)).resolves.toBeUndefined();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('forces audit logging in production even when the stored toggle is false', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(logAudit(entry)).resolves.toBeUndefined();
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: entry.action,
        target: entry.target,
        before: entry.before,
        after: entry.after,
      }),
    });
  });

  it('throws an observable stable error when a required audit write fails', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.create.mockRejectedValue(new Error('database unavailable'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(logAudit(entry)).rejects.toMatchObject({
      name: 'AuditLogWriteError',
      code: 'AUDIT_LOG_WRITE_FAILED',
    } satisfies Partial<AuditLogWriteError>);
    expect(errorLog).toHaveBeenCalledWith('[audit] required log write failed', {
      action: entry.action,
      error: 'database unavailable',
      required: true,
    });
    errorLog.mockRestore();
  });
});
