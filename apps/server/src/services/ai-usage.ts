import { randomUUID } from 'crypto';
import type { AiTextUsage } from './ai-text.js';

export type AiUsageEventKind = 'request' | 'cache_hit' | 'failure';

export interface AiUsageSummary {
  requestCount: number;
  cacheHitCount: number;
  failureCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AiUsageRecordEvent {
  namespace: string;
  provider: string;
  model: string;
  actorUserId?: string | null;
  date?: string;
  kind: AiUsageEventKind;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  usage?: AiTextUsage | null;
  /** The request slot was already consumed by an atomic quota reservation. */
  reserved?: boolean;
}

export interface AiUsageSummaryQuery {
  namespace?: string;
  provider?: string;
  model?: string;
  actorUserId?: string | null;
  date?: string;
}

export interface AiUsageStore {
  getDailySummary(query: AiUsageSummaryQuery): Promise<AiUsageSummary>;
  record(event: AiUsageRecordEvent): Promise<void>;
  reserveDailyLimit?(params: AiUsageReservationParams): Promise<AiUsageReservationResult>;
  releaseDailyReservation?(params: AiUsageReservationReleaseParams): Promise<void>;
}

export interface AiUsageReservationParams {
  namespace: string;
  actorUserId?: string | null;
  limit: number;
  date?: string;
}

export interface AiUsageReservationReleaseParams {
  namespace: string;
  actorUserId?: string | null;
  date?: string;
}

export interface AiUsageReservationResult {
  allowed: boolean;
  used: number;
  remaining: number;
  limit: number;
}

export type PrismaAiUsageClient = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number>;
};

export function normalizeAiUsageDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function isUnknownAiOutcome(error: unknown): boolean {
  const text = String((error as { error?: unknown })?.error || error || '').toLowerCase();
  return /timeout|timed out|aborted|socket|econnreset|network|fetch failed|connection/i.test(text);
}

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSummary(row: Record<string, unknown> | undefined): AiUsageSummary {
  return {
    requestCount: numberValue(row?.requestCount),
    cacheHitCount: numberValue(row?.cacheHitCount),
    failureCount: numberValue(row?.failureCount),
    promptTokens: numberValue(row?.promptTokens),
    completionTokens: numberValue(row?.completionTokens),
    totalTokens: numberValue(row?.totalTokens),
  };
}

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

export async function assertAiDailyLimit(params: {
  store: AiUsageStore;
  namespace: string;
  actorUserId?: string | null;
  limit: number;
  cacheHit: boolean;
  date?: string;
}): Promise<{ allowed: boolean; used: number; remaining: number; limit: number }> {
  const limit = Math.max(0, Math.trunc(Number(params.limit) || 0));
  const summary = await params.store.getDailySummary({
    namespace: params.namespace,
    actorUserId: params.actorUserId || null,
    date: params.date || normalizeAiUsageDate(),
  });
  const used = summary.requestCount;
  const remaining = Math.max(0, limit - used);
  if (params.cacheHit) return { allowed: true, used, remaining, limit };
  return { allowed: limit > 0 && used < limit, used, remaining, limit };
}

export async function recordAiUsageEvent(store: AiUsageStore, event: AiUsageRecordEvent): Promise<void> {
  const usage = event.usage || null;
  await store.record({
    ...event,
    date: event.date || normalizeAiUsageDate(),
    namespace: cleanText(event.namespace),
    provider: cleanText(event.provider) || 'unknown',
    model: cleanText(event.model) || 'unknown',
    actorUserId: event.actorUserId || '',
    promptTokens: numberValue(event.promptTokens ?? usage?.promptTokens),
    completionTokens: numberValue(event.completionTokens ?? usage?.completionTokens),
    totalTokens: numberValue(event.totalTokens ?? usage?.totalTokens),
  });
}

export async function reserveAiDailyLimit(params: AiUsageReservationParams & { store: AiUsageStore }): Promise<AiUsageReservationResult> {
  if (!params.store.reserveDailyLimit) {
    throw new Error('AI usage store does not support atomic reservations');
  }
  return params.store.reserveDailyLimit(params);
}

export function createPrismaAiUsageStore(prisma: PrismaAiUsageClient): AiUsageStore {
  return {
    async getDailySummary(query) {
      const date = query.date || normalizeAiUsageDate();
      const rows = await prisma.$queryRaw<any[]>`
        SELECT
          COALESCE(SUM("request_count"), 0)::int AS "requestCount",
          COALESCE(SUM("cache_hit_count"), 0)::int AS "cacheHitCount",
          COALESCE(SUM("failure_count"), 0)::int AS "failureCount",
          COALESCE(SUM("prompt_tokens"), 0)::int AS "promptTokens",
          COALESCE(SUM("completion_tokens"), 0)::int AS "completionTokens",
          COALESCE(SUM("total_tokens"), 0)::int AS "totalTokens"
        FROM "ai_usage_daily"
        WHERE "date" = ${date}::date
          AND (${query.namespace || null}::text IS NULL OR "namespace" = ${query.namespace || null})
          AND (${query.provider || null}::text IS NULL OR "provider" = ${query.provider || null})
          AND (${query.model || null}::text IS NULL OR "model" = ${query.model || null})
          AND (${query.actorUserId || null}::text IS NULL OR "actor_user_id" = ${query.actorUserId || null})
          AND "namespace" NOT LIKE '%::__reservation__'
      `;
      return normalizeSummary(rows[0]);
    },

    async record(event) {
      const date = event.date || normalizeAiUsageDate();
      const requestCount = event.kind === 'request' ? 1 : 0;
      const cacheHitCount = event.kind === 'cache_hit' ? 1 : 0;
      const failureCount = event.kind === 'failure' ? 1 : 0;
      await prisma.$executeRaw`
        INSERT INTO "ai_usage_daily" (
          "id",
          "date",
          "namespace",
          "provider",
          "model",
          "actor_user_id",
          "request_count",
          "cache_hit_count",
          "failure_count",
          "prompt_tokens",
          "completion_tokens",
          "total_tokens",
          "updated_at"
        ) VALUES (
          ${randomUUID()},
          ${date}::date,
          ${event.namespace},
          ${event.provider},
          ${event.model},
          ${event.actorUserId || ''},
          ${requestCount},
          ${cacheHitCount},
          ${failureCount},
          ${numberValue(event.promptTokens)},
          ${numberValue(event.completionTokens)},
          ${numberValue(event.totalTokens)},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT ("date", "namespace", "provider", "model", "actor_user_id")
        DO UPDATE SET
          "request_count" = "ai_usage_daily"."request_count" + EXCLUDED."request_count",
          "cache_hit_count" = "ai_usage_daily"."cache_hit_count" + EXCLUDED."cache_hit_count",
          "failure_count" = "ai_usage_daily"."failure_count" + EXCLUDED."failure_count",
          "prompt_tokens" = "ai_usage_daily"."prompt_tokens" + EXCLUDED."prompt_tokens",
          "completion_tokens" = "ai_usage_daily"."completion_tokens" + EXCLUDED."completion_tokens",
          "total_tokens" = "ai_usage_daily"."total_tokens" + EXCLUDED."total_tokens",
          "updated_at" = CURRENT_TIMESTAMP
      `;
    },
    async reserveDailyLimit(params) {
      const limit = Math.max(0, Math.trunc(Number(params.limit) || 0));
      const date = params.date || normalizeAiUsageDate();
      const namespace = `${cleanText(params.namespace)}::__reservation__`;
      const actorUserId = params.actorUserId || '';
      const rows = await prisma.$queryRaw<any[]>`
        INSERT INTO "ai_usage_quota_daily" (
          "id", "date", "namespace", "actor_user_id", "consumed_count", "updated_at"
        )
        SELECT ${randomUUID()}, ${date}::date, ${namespace}, ${actorUserId}, 1, CURRENT_TIMESTAMP
        WHERE ${limit} > 0
        ON CONFLICT ("date", "namespace", "actor_user_id")
        DO UPDATE SET
          "consumed_count" = "ai_usage_quota_daily"."consumed_count" + 1,
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "ai_usage_quota_daily"."consumed_count" < ${limit}
        RETURNING "consumed_count"
      `;
      const used = Number(rows[0]?.consumed_count || 0);
      return {
        allowed: rows.length === 1,
        used,
        remaining: Math.max(0, limit - used),
        limit,
      };
    },
    async releaseDailyReservation(params) {
      const date = params.date || normalizeAiUsageDate();
      const namespace = `${cleanText(params.namespace)}::__reservation__`;
      await prisma.$executeRaw`
        UPDATE "ai_usage_quota_daily"
        SET "consumed_count" = "consumed_count" - 1,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "date" = ${date}::date
          AND "namespace" = ${namespace}
          AND "actor_user_id" = ${params.actorUserId || ''}
          AND "consumed_count" > 0
      `;
    },
  };
}
