import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

const DEV_KEY_PLACEHOLDER = '32-byte-base64-key-for-encrypting-shop-credentials';

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.error(`[crypto] ${message}`);
}

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || '';

  if (!raw || raw === DEV_KEY_PLACEHOLDER) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY 未配置，拒绝加解密店铺凭证');
    }
    warnOnce('ENCRYPTION_KEY 未配置，使用派生的 dev key（仅限开发环境）');
    return crypto.createHash('sha256').update('dev-key').digest();
  }

  if (raw.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY 长度不足 32 字符，拒绝加解密');
    }
    warnOnce(`ENCRYPTION_KEY 长度仅 ${raw.length} 字符（推荐 32+），通过 sha256 派生 32 字节使用`);
    return crypto.createHash('sha256').update(raw).digest();
  }

  return Buffer.from(raw.slice(0, 32), 'utf-8');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
