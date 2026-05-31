/**
 * 简单的内存限流器
 * 用于限制用户上传频率和每日配额
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

interface QuotaRecord {
  bytes: number;
  resetAt: number;
}

class UploadLimiter {
  private rateLimits = new Map<string, RateLimitRecord>();
  private quotas = new Map<string, QuotaRecord>();

  /**
   * 检查频率限制
   * @param userId 用户 ID
   * @param maxPerMinute 每分钟最大次数
   * @returns true 表示允许，false 表示超限
   */
  checkRateLimit(userId: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const key = `rate:${userId}`;
    const record = this.rateLimits.get(key);

    if (!record || now > record.resetAt) {
      // 新周期
      this.rateLimits.set(key, {
        count: 1,
        resetAt: now + 60 * 1000, // 1 分钟后重置
      });
      return true;
    }

    if (record.count >= maxPerMinute) {
      return false;
    }

    record.count++;
    return true;
  }

  getRateUsage(userId: string): number {
    const record = this.rateLimits.get(`rate:${userId}`);
    if (!record || Date.now() > record.resetAt) {
      return 0;
    }
    return record.count;
  }

  /**
   * 检查每日配额
   * @param userId 用户 ID
   * @param bytes 本次上传字节数
   * @param maxBytesPerDay 每日最大字节数
   * @returns true 表示允许，false 表示超限
   */
  checkDailyQuota(userId: string, bytes: number, maxBytesPerDay: number): boolean {
    const now = Date.now();
    const key = `quota:${userId}`;
    const record = this.quotas.get(key);

    // 计算今天的结束时间（UTC 0 点）
    const todayEnd = new Date();
    todayEnd.setUTCHours(24, 0, 0, 0);
    const resetAt = todayEnd.getTime();

    if (!record || now > record.resetAt) {
      if (bytes > maxBytesPerDay) {
        return false;
      }

      this.quotas.set(key, { bytes, resetAt });
      return true;
    }

    if (record.bytes + bytes > maxBytesPerDay) {
      return false;
    }

    record.bytes += bytes;
    return true;
  }

  /**
   * 获取用户今日已用配额
   */
  getDailyUsage(userId: string): number {
    const key = `quota:${userId}`;
    const record = this.quotas.get(key);
    if (!record || Date.now() > record.resetAt) {
      return 0;
    }
    return record.bytes;
  }

  /**
   * 清理过期记录（定期调用）
   */
  cleanup() {
    const now = Date.now();
    for (const [key, record] of this.rateLimits.entries()) {
      if (now > record.resetAt) {
        this.rateLimits.delete(key);
      }
    }
    for (const [key, record] of this.quotas.entries()) {
      if (now > record.resetAt) {
        this.quotas.delete(key);
      }
    }
  }
}

export const uploadLimiter = new UploadLimiter();

// 每小时清理一次过期记录
const cleanupTimer = setInterval(() => {
  uploadLimiter.cleanup();
}, 60 * 60 * 1000);
cleanupTimer.unref?.();
