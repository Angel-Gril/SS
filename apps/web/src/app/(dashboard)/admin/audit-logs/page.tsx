'use client';

import { useEffect, useState } from 'react';
import { FileSearch, Loader2, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface AuditLog {
  id: string;
  actorId: string | null;
  actorRole: 'ADMIN' | 'USER' | 'STAFF';
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: {
    id: string;
    phone: string;
    nickname: string | null;
    accountCode: string | null;
  } | null;
}

interface AuditLogResponse {
  total: number;
  rows: AuditLog[];
}

const PAGE_SIZE = 50;

interface AuditLogFilters {
  action: string;
  actorId: string;
  dateFrom: string;
  dateTo: string;
}

export default function AdminAuditLogsPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load(0);
  }, []);

  async function load(nextOffset = offset, filters: AuditLogFilters = { action, actorId, dateFrom, dateTo }) {
    setLoading(true);
    const params = new URLSearchParams({
      offset: String(nextOffset),
      limit: String(PAGE_SIZE),
    });
    if (filters.action.trim()) params.set('action', filters.action.trim());
    if (filters.actorId.trim()) params.set('actorId', filters.actorId.trim());
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);

    const res = await api.get<AuditLogResponse>(`/api/admin/audit-logs?${params.toString()}`);
    if (res.code === 1 && res.data) {
      setRows(res.data.rows);
      setTotal(res.data.total);
      setOffset(nextOffset);
    }
    setLoading(false);
  }

  function resetFilters() {
    setAction('');
    setActorId('');
    setDateFrom('');
    setDateTo('');
    void load(0, { action: '', actorId: '', dateFrom: '', dateTo: '' });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileSearch className="h-6 w-6" /> 审计日志
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            查看管理员和已认证用户的写操作记录，敏感字段会自动掩码。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(offset)}>
          <RefreshCw className="h-4 w-4" /> 刷新
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void load(0);
            }}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Input
                placeholder="按 action 搜索，如 http_post"
                value={action}
                onChange={(event) => setAction(event.target.value)}
              />
              <Input
                placeholder="操作者 ID"
                value={actorId}
                onChange={(event) => setActorId(event.target.value)}
              />
              <Input
                type="date"
                aria-label="开始日期"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
              <Input
                type="date"
                aria-label="结束日期"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  <Search className="h-4 w-4" /> 查询
                </Button>
                <Button type="button" variant="outline" onClick={resetFilters} disabled={loading}>
                  <RotateCcw className="h-4 w-4" /> 重置
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">共 {total} 条</p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无审计日志</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[150px]">时间</TableHead>
                  <TableHead className="w-[170px]">操作者</TableHead>
                  <TableHead className="w-[140px]">动作</TableHead>
                  <TableHead>目标</TableHead>
                  <TableHead className="w-[260px]">详情</TableHead>
                  <TableHead className="w-[120px]">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{row.actor?.nickname || row.actor?.phone || row.actorId || '系统'}</div>
                        <div className="flex items-center gap-1">
                          <Badge variant={row.actorRole === 'ADMIN' ? 'default' : 'secondary'}>{row.actorRole}</Badge>
                          {row.actor?.accountCode && <code className="text-[10px] text-muted-foreground">{row.actor.accountCode}</code>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><code className="text-xs">{row.action}</code></TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm">{row.target || '—'}</TableCell>
                    <TableCell>
                      <pre className="max-h-24 overflow-auto rounded bg-muted p-2 text-[11px] leading-4">
                        {JSON.stringify(row.after ?? row.before ?? {}, null, 2)}
                      </pre>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.ip || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>
          上一页
        </Button>
        <Button variant="outline" disabled={offset + PAGE_SIZE >= total || loading} onClick={() => load(offset + PAGE_SIZE)}>
          下一页
        </Button>
      </div>
    </div>
  );
}
