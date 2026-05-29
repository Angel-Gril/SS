import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../lib/crypto.js';

describe('crypto', () => {
  it('should encrypt and decrypt text correctly', () => {
    const plaintext = 'sensitive-api-key-12345';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (IV randomization)', () => {
    const plaintext = 'test-data';
    const encrypted1 = encrypt(plaintext);
    const encrypted2 = encrypt(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(plaintext);
    expect(decrypt(encrypted2)).toBe(plaintext);
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('');
    expect(decrypt(encrypted)).toBe('');
  });

  it('should handle unicode characters', () => {
    const plaintext = '中文测试 🚀 Тест';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('should throw on invalid ciphertext', () => {
    expect(() => decrypt('invalid-base64')).toThrow();
    expect(() => decrypt('YWJjZGVm')).toThrow(); // valid base64 but invalid format
  });
});
