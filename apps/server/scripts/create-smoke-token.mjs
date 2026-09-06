#!/usr/bin/env node
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

const MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const envCandidates = [
  process.env.SMOKE_ENV_FILE,
  '../../.env.staging',
  '../../.env.production',
  '.env',
].filter(Boolean);

for (const file of envCandidates) {
  if (existsSync(file)) {
    dotenv.config({ path: file, override: false });
  }
}

function argValue(name, fallback = '') {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const role = argValue('--role', process.env.SMOKE_TOKEN_ROLE || 'USER').toUpperCase();
const phone = argValue('--phone', process.env.SMOKE_TOKEN_PHONE || '');
const ttlSeconds = Number(argValue('--ttl-seconds', process.env.SMOKE_TOKEN_TTL_SECONDS || '7200'));

export function signSmokeAccountToken(input, environment = process.env) {
  const secret = String(environment.JWT_SECRET || '');
  if (secret.length < 16) throw new Error('JWT_SECRET must be at least 16 characters');
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.userId !== 'string' || !input.userId
    || typeof input.role !== 'string' || !['USER', 'ADMIN', 'STAFF'].includes(input.role)
    || !Number.isSafeInteger(input.authVersion) || input.authVersion < 0
    || !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1
    || input.ttlSeconds > MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS) {
    throw new Error('smoke account token input is invalid');
  }
  const deploymentId = String(environment.SS_ERP_DEPLOYMENT_ID || '').trim() || 'local-dev';
  const issuer = String(environment.AUTH_JWT_ISSUER || '').trim() || 'ss-erp-local';
  return jwt.sign({
    userId: input.userId,
    role: input.role,
    authVersion: input.authVersion,
    typ: 'account',
    tokenUse: 'account_session',
    deploymentId,
  }, secret, {
    algorithm: 'HS256',
    issuer,
    audience: `ss-erp-account:${deploymentId}`,
    expiresIn: input.ttlSeconds,
  });
}

export async function persistSmokeAccountSession(redisClient, input) {
  if (!redisClient || typeof redisClient.set !== 'function'
    || !input || typeof input !== 'object' || Array.isArray(input)
    || typeof input.userId !== 'string' || !input.userId
    || typeof input.token !== 'string' || input.token.length < 32
    || !Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1
    || input.ttlSeconds > MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS) {
    throw new Error('smoke account session input is invalid');
  }
  const key = `session:${input.userId}:${input.token.slice(-8)}`;
  const result = await redisClient.set(key, '1', 'EX', input.ttlSeconds);
  if (result !== 'OK') throw new Error('smoke account session was not persisted');
  return key;
}

async function main() {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1
    || ttlSeconds > MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS) {
    throw new Error(`--ttl-seconds must be an integer from 1 through ${MAX_WEB_ACCOUNT_TOKEN_TTL_SECONDS}`);
  }
  if (!['USER', 'ADMIN', 'STAFF'].includes(role)) {
    throw new Error('--role must be USER, ADMIN, or STAFF');
  }

  const prisma = new PrismaClient();
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { lazyConnect: true });

  try {
    await redis.connect();
    const user = await prisma.user.findFirst({
      where: {
        ...(phone ? { phone } : { role }),
        status: 'ACTIVE',
        ...(role === 'ADMIN' && !phone ? { isSuperAdmin: true } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, phone: true, role: true, isSuperAdmin: true, authVersion: true },
    });

    if (!user) {
      throw new Error(phone ? `no active user found for phone=${phone}` : `no active ${role} found`);
    }

    const token = signSmokeAccountToken({
      userId: user.id,
      role: user.role,
      authVersion: user.authVersion,
      ttlSeconds,
    });
    await persistSmokeAccountSession(redis, { userId: user.id, token, ttlSeconds });

    console.log(JSON.stringify({
      phone: user.phone,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      ttlSeconds,
      token,
    }));
  } finally {
    await redis.quit().catch(() => {});
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  await main();
}
