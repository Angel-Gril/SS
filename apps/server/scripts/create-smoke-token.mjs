#!/usr/bin/env node
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';

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

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}
if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
  throw new Error('--ttl-seconds must be a positive number');
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
    select: { id: true, phone: true, role: true, isSuperAdmin: true },
  });

  if (!user) {
    throw new Error(phone ? `no active user found for phone=${phone}` : `no active ${role} found`);
  }

  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: Math.ceil(ttlSeconds),
  });
  await redis.set(`session:${user.id}:${token.slice(-8)}`, '1', 'EX', Math.ceil(ttlSeconds));

  console.log(JSON.stringify({
    phone: user.phone,
    role: user.role,
    isSuperAdmin: user.isSuperAdmin,
    ttlSeconds: Math.ceil(ttlSeconds),
    token,
  }));
} finally {
  await redis.quit().catch(() => {});
  await prisma.$disconnect();
}
