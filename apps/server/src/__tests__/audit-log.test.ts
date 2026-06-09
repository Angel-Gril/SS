import { describe, expect, it, vi } from 'vitest';
import {
  buildHttpAuditEntry,
  maskAuditPayload,
  shouldAuditHttpRequest,
} from '../lib/audit-log.js';

describe('audit log helpers', () => {
  it('masks sensitive request fields recursively', () => {
    expect(maskAuditPayload({
      phone: '13800138000',
      password: 'Passw0rd123',
      nested: {
        apiKey: 'secret-key',
        token: 'jwt-token',
        keep: 'visible',
      },
      list: [{ accessKeySecret: 'oss-secret' }],
    })).toEqual({
      phone: '13800138000',
      password: '***MASKED***',
      nested: {
        apiKey: '***MASKED***',
        token: '***MASKED***',
        keep: 'visible',
      },
      list: [{ accessKeySecret: '***MASKED***' }],
    });
  });

  it('audits successful authenticated write requests outside auth and audit-log endpoints', () => {
    expect(shouldAuditHttpRequest({
      method: 'POST',
      url: '/api/orders/123/ship',
      statusCode: 200,
      user: { actorUserId: 'user-1' },
    })).toBe(true);

    expect(shouldAuditHttpRequest({
      method: 'GET',
      url: '/api/orders',
      statusCode: 200,
      user: { actorUserId: 'user-1' },
    })).toBe(false);

    expect(shouldAuditHttpRequest({
      method: 'POST',
      url: '/api/auth/logout',
      statusCode: 200,
      user: { actorUserId: 'user-1' },
    })).toBe(false);

    expect(shouldAuditHttpRequest({
      method: 'PUT',
      url: '/api/orders/123',
      statusCode: 401,
      user: { actorUserId: 'user-1' },
    })).toBe(false);
  });

  it('builds http audit entries from request context', () => {
    const request = {
      method: 'PATCH',
      url: '/api/admin/users/user-2',
      body: { password: 'Passw0rd123', role: 'ADMIN' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'vitest' },
      user: { actorUserId: 'admin-1', role: 'ADMIN' },
    };

    const entry = buildHttpAuditEntry(request as any, 200);

    expect(entry).toMatchObject({
      actorId: 'admin-1',
      actorRole: 'ADMIN',
      action: 'http_patch',
      target: '/api/admin/users/user-2',
      ip: '127.0.0.1',
      userAgent: 'vitest',
      after: {
        statusCode: 200,
        body: { password: '***MASKED***', role: 'ADMIN' },
      },
    });
  });
});
