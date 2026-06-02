import { describe, expect, it } from 'vitest';
import { getPermanentUserDeletionError } from '../routes/admin.js';

describe('admin permanent user deletion guard', () => {
  it('allows super admins to delete non-super-admin accounts', () => {
    expect(getPermanentUserDeletionError(
      { actorUserId: 'super-1', role: 'ADMIN', isSuperAdmin: true },
      { id: 'admin-2', role: 'ADMIN', isSuperAdmin: false },
    )).toBeNull();
    expect(getPermanentUserDeletionError(
      { actorUserId: 'super-1', role: 'ADMIN', isSuperAdmin: true },
      { id: 'user-1', role: 'USER', isSuperAdmin: false },
    )).toBeNull();
  });

  it('blocks non-super admins, self deletion, and deleting super admins', () => {
    expect(getPermanentUserDeletionError(
      { actorUserId: 'admin-1', role: 'ADMIN', isSuperAdmin: false },
      { id: 'user-1', role: 'USER', isSuperAdmin: false },
    )).toBe('只有超级管理员可以永久删除账户');

    expect(getPermanentUserDeletionError(
      { actorUserId: 'super-1', role: 'ADMIN', isSuperAdmin: true },
      { id: 'super-1', role: 'ADMIN', isSuperAdmin: true },
    )).toBe('不能删除当前登录账户');

    expect(getPermanentUserDeletionError(
      { actorUserId: 'super-1', role: 'ADMIN', isSuperAdmin: true },
      { id: 'super-2', role: 'ADMIN', isSuperAdmin: true },
    )).toBe('不能永久删除超级管理员，请先撤销超管权限或禁用账户');
  });
});
