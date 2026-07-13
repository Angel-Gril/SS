import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRoutes } from '../routes/admin.js';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userFindMany: vi.fn(),
  userUpdateMany: vi.fn(),
  userCount: vi.fn(async () => 1),
  clearAuthContextCache: vi.fn(),
  hashPassword: vi.fn(async () => 'new-password-hash'),
  logAudit: vi.fn(),
  revokeExtensionDeviceSessionsForUser: vi.fn(async () => 2),
  revokeExtensionDeviceSessionsForUserInTransaction: vi.fn(async () => 2),
  removeAllSessions: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = {
      actorUserId: 'admin-1',
      userId: 'admin-1',
      role: 'ADMIN',
      isSuperAdmin: true,
    };
  }),
  requireRole: vi.fn(() => vi.fn(async () => undefined)),
  clearAuthContextCache: mocks.clearAuthContextCache,
  removeAllSessions: mocks.removeAllSessions,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      findUnique: mocks.userFindUnique,
      update: mocks.userUpdate,
      count: mocks.userCount,
      findMany: mocks.userFindMany,
      updateMany: mocks.userUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../lib/audit-log.js', () => ({
  logAudit: mocks.logAudit,
  extractRequestMeta: vi.fn(() => ({})),
}));

vi.mock('../lib/account-code.js', () => ({
  generateAccountCode: vi.fn(),
  nextAdminCode: vi.fn(),
  nextSuperAdminCode: vi.fn(),
}));

vi.mock('../services/extension-device-session-prisma.js', () => ({
  revokeExtensionDeviceSessionsForUser: mocks.revokeExtensionDeviceSessionsForUser,
  revokeExtensionDeviceSessionsForUserInTransaction:
    mocks.revokeExtensionDeviceSessionsForUserInTransaction,
}));

vi.mock('bcryptjs', () => ({
  default: { hash: mocks.hashPassword },
}));

const activeUser = {
  id: 'user-1',
  phone: '13800138000',
  nickname: 'User One',
  role: 'USER',
  status: 'ACTIVE',
  canInvite: false,
  inviteLimit: 0,
  tenantType: 'solo',
  perOrderFee: null,
  customColorEnabled: false,
  canPublishAddress: false,
  isTransitProvider: false,
  isSuperAdmin: false,
};

async function buildApp() {
  const app = Fastify();
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.ready();
  return app;
}

describe('admin user security actions revoke extension devices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ ...activeUser });
    mocks.userUpdate.mockImplementation(async ({ data }: any) => ({ ...activeUser, ...data }));
    mocks.userCount.mockResolvedValue(1);
    mocks.hashPassword.mockResolvedValue('new-password-hash');
    mocks.revokeExtensionDeviceSessionsForUser.mockResolvedValue(2);
    mocks.revokeExtensionDeviceSessionsForUserInTransaction.mockResolvedValue(2);
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        user: {
          update: mocks.userUpdate,
          findMany: mocks.userFindMany,
          updateMany: mocks.userUpdateMany,
        },
      }),
    );
    mocks.removeAllSessions.mockResolvedValue(undefined);
  });
    mocks.userFindMany.mockResolvedValue([{ id: 'staff-1' }]);
    mocks.userUpdateMany.mockResolvedValue({ count: 1 });

  it('revokes every extension device session after an admin resets a password', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/users/user-1/reset-password',
        payload: { password: 'changed-password' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.userUpdate).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          passwordHash: 'new-password-hash',
          authVersion: { increment: 1 },
        },
      });
      expect(mocks.revokeExtensionDeviceSessionsForUserInTransaction).toHaveBeenCalledWith(
        expect.anything(), 'user-1', 'PASSWORD_RESET',
      );
      expect(mocks.removeAllSessions).toHaveBeenCalledWith('user-1');
      expect(mocks.revokeExtensionDeviceSessionsForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('revokes every extension device session when an admin suspends a user', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/users/user-1',
        payload: { status: 'SUSPENDED' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.revokeExtensionDeviceSessionsForUserInTransaction).toHaveBeenCalledWith(
        expect.anything(), 'user-1', 'ACCOUNT_SUSPENDED',
      );
      expect(mocks.removeAllSessions).toHaveBeenCalledWith('user-1');
      expect(mocks.revokeExtensionDeviceSessionsForUser).not.toHaveBeenCalled();
    } finally {
      expect(mocks.userUpdateMany).toHaveBeenCalledWith({
        where: { parentId: 'user-1' },
        data: { authVersion: { increment: 1 } },
      });
      expect(mocks.removeAllSessions).toHaveBeenCalledWith('staff-1');
      await app.close();
    }
  });

  it('revokes every extension device session through the legacy disable endpoint', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/users/user-1',
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.revokeExtensionDeviceSessionsForUserInTransaction).toHaveBeenCalledWith(
        expect.anything(), 'user-1', 'ACCOUNT_SUSPENDED',
      );
      expect(mocks.removeAllSessions).toHaveBeenCalledWith('user-1');
      expect(mocks.revokeExtensionDeviceSessionsForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not revoke extension devices for a non-security profile update', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/users/user-1',
        payload: { nickname: 'Renamed User' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.revokeExtensionDeviceSessionsForUser).not.toHaveBeenCalled();
      expect(mocks.revokeExtensionDeviceSessionsForUserInTransaction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
