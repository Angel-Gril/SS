export interface AuditLogQueryInput {
  offset?: string;
  limit?: string;
  action?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface AuditLogQueryValue {
  offset: number;
  limit: number;
  where: any;
}

type AuditLogQueryResult =
  | { ok: true; value: AuditLogQueryValue }
  | { ok: false; message: string };

function parseDateFilter(value: string, endOfDay: boolean): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const date = dateOnly
    ? new Date(`${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
    : new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function buildAuditLogQuery(query: AuditLogQueryInput): AuditLogQueryResult {
  const offset = Math.max(0, Number(query.offset) || 0);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const where: any = {};

  const action = query.action?.trim();
  if (action) where.action = { contains: action };

  const actorId = query.actorId?.trim();
  if (actorId) where.actorId = actorId;

  const dateFrom = query.dateFrom?.trim();
  const dateTo = query.dateTo?.trim();
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) {
      const parsed = parseDateFilter(dateFrom, false);
      if (!parsed) return { ok: false, message: '开始日期格式不正确' };
      where.createdAt.gte = parsed;
    }
    if (dateTo) {
      const parsed = parseDateFilter(dateTo, true);
      if (!parsed) return { ok: false, message: '结束日期格式不正确' };
      where.createdAt.lte = parsed;
    }
  }

  return { ok: true, value: { offset, limit, where } };
}
