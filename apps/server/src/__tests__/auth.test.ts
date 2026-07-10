import { describe, it, expect } from 'vitest';
import { registerSchema } from 'shared';
import { signToken, verifyToken } from '../lib/auth.js';

describe('auth token', () => {
  it('should sign and verify JWT token', () => {
    const payload = { userId: 'user-123', role: 'USER' };
    const token = signToken(payload);

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.role).toBe('USER');
  });

  it('should reject invalid token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });

  it('should reject expired token', () => {
    const payload = { userId: 'user-123', role: 'USER' };
    const token = signToken(payload, '1ms');

    return new Promise((resolve) => {
      setTimeout(() => {
        expect(() => verifyToken(token)).toThrow();
        resolve(undefined);
      }, 100);
    });
  });

  it('should handle custom expiry', () => {
    const payload = { userId: 'user-123', role: 'ADMIN' };
    const token = signToken(payload, '30d');

    const decoded = verifyToken(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.role).toBe('ADMIN');
  });
});

describe('auth registration consent', () => {
  const registration = {
    phone: '19200000000',
    password: 'secure123',
  };

  it('requires explicit acceptance of the current user agreement and privacy policy', () => {
    expect(registerSchema.safeParse(registration).success).toBe(false);
    expect(registerSchema.safeParse({ ...registration, legalAccepted: true }).success).toBe(true);
  });
});
