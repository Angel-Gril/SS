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
}

export type PrismaAiUsageClient = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: any[]): Promise<number>;
};

export function normalizeAiUsageDate(date = new Date()): string {
  return date.toISOString().slice(0, 10);
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
  };
}
