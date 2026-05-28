import Redis from 'ioredis';

const REDIS_DISABLED = process.env.REDIS_DISABLED === '1' || process.env.REDIS_DISABLED === 'true';

class NoopRedis {
  async exists() { return 1; }
  async set() { return 'OK'; }
  async del() { return 0; }
  async get() { return null; }
  async expire() { return 0; }
  async incr() { return 0; }
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
  async keys() { return []; }
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
  ? new NoopRedis()
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
