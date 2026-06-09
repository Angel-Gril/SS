'use client';

import { useEffect, useState } from 'react';
import { Loader2, Activity, Database, Cpu, Server, ListChecks, AlertTriangle, HardDrive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface OpsResponse {
  checks: Record<string, { status: string; detail?: string }>;
  version: string;
  nodeEnv: string;
  uptimeSeconds: number;
}

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

interface QueueFailedJob {
  id: string;
  name: string;
  failedReason: string | null;
  timestamp: string | null;
  finishedOn: string | null;
}

interface QueueRow {
  name: string;
  label: string;
  status: 'idle' | 'active' | 'warning' | 'error';
  counts: QueueCounts;
  recentFailed: QueueFailedJob[];
  error?: string;
}

interface QueueOverview {
  status: 'ok' | 'degraded' | 'disabled';
  redisDisabled: boolean;
  queues: QueueRow[];
  checkedAt: string;
}

interface BackupStatus {
  available: boolean;
  ok?: boolean;
  message?: string;
  lastBackupAt?: string;
  filename?: string;
  sizeBytes?: number;
  remote?: string;
  error?: string;
}

export default function AdminOpsPage() {
  const [data, setData] = useState<OpsResponse | null>(null);
  const [queueData, setQueueData] = useState<QueueOverview | null>(null);
  const [backupData, setBackupData] = useState<BackupStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    const [opsRes, queueRes, backupRes] = await Promise.all([
      api.get<OpsResponse>('/api/admin/system-status/ops'),
      api.get<QueueOverview>('/api/admin/ops/queues'),
      api.get<BackupStatus>('/api/admin/ops/backup-status'),
    ]);
    if (opsRes.code === 1 && opsRes.data) setData(opsRes.data);
    if (queueRes.code === 1 && queueRes.data) setQueueData(queueRes.data);
    if (backupRes.code === 1 && backupRes.data) setBackupData(backupRes.data);
    setLoading(false);
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!data) {
    return <p className="text-center text-muted-foreground py-12">加载失败</p>;
  }

  const checks = data.checks;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6" /> 运维状态
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            数据库 / Redis / Worker / 运行模式状态（每 30s 自动刷新）
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>立即刷新</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatusCard
          icon={Database}
          title="PostgreSQL"
          status={checks.db?.status || 'unknown'}
          detail={checks.db?.detail}
        />
        <StatusCard
          icon={Cpu}
          title="Redis"
          status={checks.redis?.status || 'unknown'}
          detail={checks.redis?.detail}
        />
        <StatusCard
          icon={Server}
          title="Worker 模式"
          status={checks.workers?.status || 'unknown'}
          detail={checks.workers?.detail}
        />
        <StatusCard
          icon={Activity}
          title="Runtime Mode"
          status={checks.runtime?.status || 'unknown'}
          detail={checks.runtime?.status === 'cloud' ? '云端 SaaS 模式（OSS+Turnstile+SMS）' : '本地模式（cookie+CDN）'}
        />
        <StatusCard
          icon={Server}
          title="CORS"
          status={checks.cors?.status || 'unknown'}
          detail={checks.cors?.detail}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-medium">应用元信息</h2>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <KvRow label="版本" value={data.version} />
            <KvRow label="NODE_ENV" value={data.nodeEnv} />
            <KvRow label="进程已运行" value={formatUptime(data.uptimeSeconds)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> 备份状态
              </h2>
              <Badge variant={backupVariant(backupData)}>{backupLabel(backupData)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!backupData ? (
              <p className="text-sm text-muted-foreground">备份状态加载失败</p>
            ) : !backupData.available ? (
              <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {backupData.message || '备份状态文件不存在'}
              </div>
            ) : (
              <>
                <KvRow label="最近备份" value={formatDateTime(backupData.lastBackupAt)} />
                <KvRow label="备份文件" value={backupData.filename || '—'} />
                <KvRow label="文件大小" value={formatBytes(backupData.sizeBytes)} />
                {backupData.remote ? <KvRow label="远端副本" value={backupData.remote} /> : null}
                {backupData.error ? <p className="text-xs text-red-600">{backupData.error}</p> : null}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-medium flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> 队列监控
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                BullMQ 等待 / 运行 / 失败任务状态，用于定位同步和定时任务积压
              </p>
            </div>
            <Badge variant={queueOverviewVariant(queueData?.status || 'disabled')}>
              {queueData?.status || 'unknown'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {!queueData ? (
            <p className="text-sm text-muted-foreground py-6">队列状态加载失败</p>
          ) : queueData.redisDisabled ? (
            <div className="flex items-start gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              当前 Redis 已关闭，队列任务会走本地直连或跳过，生产环境应启用 Redis 与独立 worker。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">队列</th>
                    <th className="py-2 pr-3 font-medium">状态</th>
                    <th className="py-2 pr-3 font-medium">等待</th>
                    <th className="py-2 pr-3 font-medium">运行</th>
                    <th className="py-2 pr-3 font-medium">延迟</th>
                    <th className="py-2 pr-3 font-medium">失败</th>
                    <th className="py-2 pr-3 font-medium">最近失败</th>
                  </tr>
                </thead>
                <tbody>
                  {queueData.queues.map((queue) => {
                    const failed = queue.recentFailed[0];
                    return (
                      <tr key={queue.name} className="border-b last:border-b-0 align-top">
                        <td className="py-3 pr-3">
                          <div className="font-medium">{queue.label}</div>
                          <code className="text-xs text-muted-foreground">{queue.name}</code>
                        </td>
                        <td className="py-3 pr-3">
                          <Badge variant={queueRowVariant(queue.status)}>{queue.status}</Badge>
                        </td>
                        <td className="py-3 pr-3 tabular-nums">{queue.counts.waiting}</td>
                        <td className="py-3 pr-3 tabular-nums">{queue.counts.active}</td>
                        <td className="py-3 pr-3 tabular-nums">{queue.counts.delayed}</td>
                        <td className="py-3 pr-3 tabular-nums">{queue.counts.failed}</td>
                        <td className="py-3 pr-3 max-w-[280px]">
                          {queue.error ? (
                            <span className="text-xs text-red-600">{queue.error}</span>
                          ) : failed ? (
                            <div className="space-y-1 text-xs">
                              <div className="font-medium">{failed.name || failed.id}</div>
                              <div className="text-muted-foreground line-clamp-2">{failed.failedReason || '未知错误'}</div>
                              <div className="text-muted-foreground">{formatDateTime(failed.finishedOn || failed.timestamp)}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {queueData?.checkedAt && (
            <p className="text-xs text-muted-foreground mt-3">检查时间：{formatDateTime(queueData.checkedAt)}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  title,
  status,
  detail,
}: {
  icon: React.ElementType;
  title: string;
  status: string;
  detail?: string;
}) {
  const variant = statusVariant(status);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <Badge variant={variant}>{status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {detail || '—'}
      </CardContent>
    </Card>
  );
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ok' || status === 'configured') return 'default';
  if (status === 'fail' || status === 'unset') return 'destructive';
  if (status === 'disabled' || status === 'separated' || status === 'in-process') return 'secondary';
  return 'outline';
}

function queueOverviewVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ok') return 'default';
  if (status === 'degraded') return 'destructive';
  if (status === 'disabled') return 'secondary';
  return 'outline';
}

function queueRowVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'warning' || status === 'error') return 'destructive';
  if (status === 'idle') return 'secondary';
  return 'outline';
}

function backupVariant(status: BackupStatus | null): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  if (!status.available) return 'secondary';
  if (status.ok === false || status.error) return 'destructive';
  return 'default';
}

function backupLabel(status: BackupStatus | null): string {
  if (!status) return 'unknown';
  if (!status.available) return '未配置';
  if (status.ok === false || status.error) return '异常';
  return '可用';
}

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b last:border-b-0 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <code className="text-xs">{value}</code>
    </div>
  );
}

function formatBytes(value?: number): string {
  if (!value || !Number.isFinite(value)) return '—';
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB`;
  return `${value} B`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分钟`;
  return `${m}分钟`;
}
