import Redis from 'ioredis';

const REDIS_DISABLED = process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true';

type MemoryEntry = {
  value: string;
  expiresAt: number | null;
};

function matchPattern(key: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(key);
}

class MemoryRedis {
  private store = new Map<string, MemoryEntry>();

  private prune(key: string) {
    const entry = this.store.get(key);
    if (entry?.expiresAt && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry || null;
  }

  private activeKeys() {
    for (const key of [...this.store.keys()]) {
      this.prune(key);
    }
    return [...this.store.keys()];
  }

  async exists(key: string) {
    return this.prune(key) ? 1 : 0;
  }

  async set(key: string, value: string | number, mode?: string, ttlSeconds?: number) {
    const expiresAt = mode === 'EX' && ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys) {
      if (this.store.delete(key)) deleted += 1;
    }
    return deleted;
  }

  async get(key: string) {
    return this.prune(key)?.value ?? null;
  }

  async expire(key: string, seconds: number) {
    const entry = this.prune(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  async incr(key: string) {
    const current = Number(await this.get(key) || '0') + 1;
    const existing = this.prune(key);
    this.store.set(key, { value: String(current), expiresAt: existing?.expiresAt ?? null });
    return current;
  }

  async scan(cursor: string, ...args: Array<string | number>) {
    const matchIndex = args.findIndex((arg) => String(arg).toUpperCase() === 'MATCH');
    const pattern = matchIndex >= 0 ? String(args[matchIndex + 1] || '*') : '*';
    const keys = this.activeKeys().filter((key) => matchPattern(key, pattern));
    return ['0', keys];
  }

  async hset() { return 0; }
  async hget() { return null; }
  async hgetall() { return {}; }
  async hdel() { return 0; }
  async lpush() { return 0; }
  async rpush() { return 0; }
  async lrange() { return []; }
  async sadd() { return 0; }
  async srem() { return 0; }
  async smembers() { return []; }
  async zadd() { return 0; }
  async zrange() { return []; }
  async keys(pattern = '*') { return this.activeKeys().filter((key) => matchPattern(key, pattern)); }
  async publish() { return 0; }
  on() { return this; }
  off() { return this; }
  connect() { return Promise.resolve(); }
  disconnect() { /* no-op */ }
  duplicate() { return this; }
  quit() { return Promise.resolve('OK'); }
}

export const redisDisabled = REDIS_DISABLED;

export const redis: any = REDIS_DISABLED
  ? new MemoryRedis()
  : new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

if (!REDIS_DISABLED) {
  redis.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
  });
  redis.connect().catch(() => {});
}
