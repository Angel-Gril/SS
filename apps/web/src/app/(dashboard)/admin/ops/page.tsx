'use client';

import { useEffect, useState } from 'react';
import { Loader2, Activity, Database, Cpu, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { AiCostReconciliationPanel } from '@/components/admin/ai-cost-reconciliation-panel';
import { AiProviderReconciliationPanel } from '@/components/admin/ai-provider-reconciliation-panel';

interface OpsResponse {
  checks: Record<string, { status: string; detail?: string }>;
  version: string;
  nodeEnv: string;
  uptimeSeconds: number;
}

export default function AdminOpsPage() {
  const [data, setData] = useState<OpsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  async function load() {
    const res = await api.get<OpsResponse>('/api/admin/system-status/ops');
    if (res.code === 1 && res.data) setData(res.data);
    setLoading(false);
  }

  const checks = data?.checks || {};

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

      {loading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-6 w-6 animate-spin" />正在读取运行状态
        </div>
      ) : !data ? (
        <div className="border py-10 text-center text-sm text-muted-foreground">运行状态加载失败</div>
      ) : (
        <>
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
        </>
      )}

      <AiProviderReconciliationPanel />
      <AiCostReconciliationPanel />
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

function KvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b last:border-b-0 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <code className="text-xs">{value}</code>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分钟`;
  return `${m}分钟`;
}
