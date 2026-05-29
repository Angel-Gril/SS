import type { ConnectionOptions } from 'bullmq';

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const parsed = new URL(url);

export const connection: ConnectionOptions = {
  host: parsed.hostname || '127.0.0.1',
  port: Number(parsed.port) || 6379,
  password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
  db: parsed.pathname ? Number(parsed.pathname.slice(1)) || 0 : 0,
  maxRetriesPerRequest: null,
};
