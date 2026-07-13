import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffRoutes } from '../routes/staff.js';

const mocks = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  transaction: vi.fn(),
  removeAllSessions: vi.fn(async () => undefined),
  clearAuthContextCache: vi.fn(),
  revokeInTransaction: vi.fn(async () => 1),
  hashPassword: vi.fn(async () => 'new-password-hash'),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'owner-1', isSubAccount: false };
  }),
  removeAllSessions: mocks.removeAllSessions,
  clearAuthContextCache: mocks.clearAuthContextCache,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findFirst: mocks.userFindFirst,
      update: mocks.userUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../services/extension-device-session-prisma.js', () => ({
  revokeExtensionDeviceSessionsForUserInTransaction: mocks.revokeInTransaction,
}));

vi.mock('bcryptjs', () => ({ default: { hash: mocks.hashPassword } }));

async function buildApp() {
  const app = Fastify();
  await app.register(staffRoutes, { prefix: '/api/staff' });
  await app.ready();
  return app;
}

describe('staff security updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindFirst.mockResolvedValue({ id: 'staff-1', parentId: 'owner-1' });
    mocks.userUpdate.mockResolvedValue({ id: 'staff-1' });
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ user: { update: mocks.userUpdate } }),
    );
  });

  it('atomically rotates auth version and revokes sessions when a parent changes a staff password', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/staff/staff-1',
        payload: { password: 'changed-password' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.userUpdate).toHaveBeenCalledWith({
        where: { id: 'staff-1' },
        data: {
          passwordHash: 'new-password-hash',
          authVersion: { increment: 1 },
        },
      });
      expect(mocks.revokeInTransaction).toHaveBeenCalledWith(
        expect.anything(), 'staff-1', 'PASSWORD_RESET',
      );
      expect(mocks.removeAllSessions).toHaveBeenCalledWith('staff-1');
      expect(mocks.clearAuthContextCache).toHaveBeenCalledWith('staff-1');
    } finally {
      await app.close();
    }
  });
});
