'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Plug, TestTube2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface IntegrationCheck {
  key: string;
  label: string;
  configured: boolean;
  source: 'env' | 'db' | 'mixed';
  detail?: string;
}

export default function AdminIntegrationsPage() {
  const [checks, setChecks] = useState<IntegrationCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingKey, setTestingKey] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await api.get<{ checks: IntegrationCheck[] }>('/api/admin/system-status/integrations');
    if (res.code === 1 && res.data) setChecks(res.data.checks);
    setLoading(false);
  }

  async function testIntegration(key: 'turnstile' | 'sms' | 'oss' | 'sentry' | 'email') {
    let payload: Record<string, string> = {};
    if (key === 'email') {
      const to = window.prompt('请输入接收测试邮件的邮箱');
      if (!to) return;
      payload = { to };
    }

    setTestingKey(key);
    const res = await api.post<{ errorCodes?: string[] }>(`/api/admin/system-status/test/${key}`, payload);
    setTestingKey(null);
    if (res.code === 1) {
      toast({ title: `${key} 测试通过`, description: res.msg });
    } else {
      toast({ title: `${key} 测试失败`, description: res.msg, variant: 'destructive' });
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Plug className="h-6 w-6" /> 接口与集成
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          第三方服务接入状态。上传对象存储优先读取超管设置里的 upload_* 配置，其它服务主要读取环境变量。
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          数据库备份的远程存储使用 backup_remote_*；图片和附件上传使用 upload_*，未填写时才回退到 VPS 环境变量。
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-medium">服务接入状态</h2>
            <Button variant="outline" size="sm" onClick={load}>刷新</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((c) => (
            <IntegrationRow
              key={c.key}
              check={c}
              testing={testingKey === c.key}
              onTest={
                c.key === 'turnstile' || c.key === 'sms' || c.key === 'oss' || c.key === 'sentry' || c.key === 'email'
                  ? () => testIntegration(c.key as any)
                  : undefined
              }
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationRow({
  check,
  testing,
  onTest,
}: {
  check: IntegrationCheck;
  testing: boolean;
  onTest?: () => void;
}) {
  const Icon = check.configured ? CheckCircle2 : XCircle;
  const color = check.configured ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground';
  const sourceLabel = check.source === 'db' ? '后台配置' : check.source === 'mixed' ? '后台+环境' : '环境变量';
  return (
    <div className="flex items-center gap-3 py-2 border-b last:border-b-0">
      <Icon className={`h-5 w-5 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{check.label}</span>
          <Badge variant="outline" className="text-[10px]">{sourceLabel}</Badge>
          {!check.configured && <Badge variant="secondary" className="text-[10px]">未配置</Badge>}
        </div>
        {check.detail && <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>}
      </div>
      {onTest && check.configured && (
        <Button variant="outline" size="sm" disabled={testing} onClick={onTest} className="gap-1.5 shrink-0">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
          测试
        </Button>
      )}
    </div>
  );
}
