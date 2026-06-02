'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Plug, TestTube2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface IntegrationCheck {
  key: string;
  label: string;
  configured: boolean;
  source: 'env' | 'db' | 'mixed';
  detail?: string;
}

type IntegrationTestKey = 'turnstile' | 'sms' | 'oss' | 'sentry';
type DiagnosticStepStatus = 'pass' | 'warn' | 'fail' | 'skip';

interface DiagnosticStep {
  key: string;
  label: string;
  status: DiagnosticStepStatus;
  detail?: string;
  elapsedMs?: number;
  critical?: boolean;
}

interface IntegrationTestData {
  endpoint?: string;
  bucket?: string;
  source?: string;
  backend?: string;
  proxyPath?: string;
  proxyUrl?: string;
  testObjectDeleted?: boolean;
  steps?: DiagnosticStep[];
  errorCodes?: string[];
}

interface LastTestResult {
  key: IntegrationTestKey;
  ok: boolean;
  msg: string;
  data?: IntegrationTestData;
}

export default function AdminIntegrationsPage() {
  const [checks, setChecks] = useState<IntegrationCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [smsTestPhone, setSmsTestPhone] = useState('');
  const [lastTest, setLastTest] = useState<LastTestResult | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const res = await api.get<{ checks: IntegrationCheck[] }>('/api/admin/system-status/integrations');
    if (res.code === 1 && res.data) setChecks(res.data.checks);
    setLoading(false);
  }

  async function testIntegration(key: IntegrationTestKey) {
    setTestingKey(key);
    const res = await api.post<IntegrationTestData>(
      `/api/admin/system-status/test/${key}`,
      key === 'sms' && smsTestPhone.trim() ? { phone: smsTestPhone.trim() } : {},
    );
    setTestingKey(null);
    setLastTest({ key, ok: res.code === 1, msg: res.msg, data: res.data });
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
                c.key === 'turnstile' || c.key === 'sms' || c.key === 'oss' || c.key === 'sentry'
                  ? () => testIntegration(c.key as any)
                  : undefined
              }
              testPhone={c.key === 'sms' ? smsTestPhone : undefined}
              onTestPhoneChange={c.key === 'sms' ? setSmsTestPhone : undefined}
            />
          ))}
        </CardContent>
      </Card>

      {lastTest && <IntegrationTestDetails result={lastTest} />}
    </div>
  );
}

function IntegrationRow({
  check,
  testing,
  onTest,
  testPhone,
  onTestPhoneChange,
}: {
  check: IntegrationCheck;
  testing: boolean;
  onTest?: () => void;
  testPhone?: string;
  onTestPhoneChange?: (value: string) => void;
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
      {check.key === 'sms' && onTestPhoneChange && (
        <Input
          value={testPhone || ''}
          onChange={(event) => onTestPhoneChange(event.target.value)}
          placeholder="测试手机号（可选）"
          className="hidden h-8 w-40 shrink-0 md:block"
        />
      )}
      {onTest && check.configured && (
        <Button variant="outline" size="sm" disabled={testing} onClick={onTest} className="gap-1.5 shrink-0">
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
          {check.key === 'sms' && testPhone?.trim() ? '发送测试短信' : '测试'}
        </Button>
      )}
    </div>
  );
}

function IntegrationTestDetails({ result }: { result: LastTestResult }) {
  const title = result.key === 'oss'
    ? 'R2/OSS 最近一次测试'
    : result.key === 'sms'
      ? '短信最近一次测试'
      : result.key === 'turnstile'
        ? 'Turnstile 最近一次测试'
        : 'Sentry 最近一次测试';
  const statusVariant = result.ok ? 'success' : 'destructive';
  const steps = result.data?.steps || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{result.msg}</p>
          </div>
          <Badge variant={statusVariant}>{result.ok ? '通过' : '失败'}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.key === 'oss' && result.data && (
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <InfoLine label="存储后端" value={result.data.backend || '-'} />
            <InfoLine label="配置来源" value={result.data.source || '-'} />
            <InfoLine label="Bucket" value={result.data.bucket || '-'} />
            <InfoLine label="Endpoint" value={result.data.endpoint || '-'} />
            <InfoLine label="代理路径" value={result.data.proxyPath || '-'} />
            <InfoLine label="测试对象" value={result.data.testObjectDeleted ? '已删除' : '未确认删除'} />
          </div>
        )}

        {steps.length > 0 && (
          <div className="space-y-2">
            {steps.map((step) => (
              <DiagnosticStepRow key={step.key} step={step} />
            ))}
          </div>
        )}

        {result.data?.errorCodes && result.data.errorCodes.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            Cloudflare 返回错误码：{result.data.errorCodes.join(', ')}
          </div>
        )}

        {result.key === 'oss' && result.data?.proxyUrl && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              代理地址格式为 <code className="font-mono">{result.data.proxyUrl}</code>。
              测试对象会在测试结束后删除，所以这个地址只用于确认线上图片 URL 生成规则。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
      <div className="mb-1 text-muted-foreground">{label}</div>
      <code className="block truncate font-mono text-foreground" title={value}>{value}</code>
    </div>
  );
}

function DiagnosticStepRow({ step }: { step: DiagnosticStep }) {
  const variant = step.status === 'pass'
    ? 'success'
    : step.status === 'warn'
      ? 'warning'
      : step.status === 'fail'
        ? 'destructive'
        : 'secondary';
  const label = step.status === 'pass'
    ? '通过'
    : step.status === 'warn'
      ? '警告'
      : step.status === 'fail'
        ? '失败'
        : '跳过';

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <Badge variant={variant} className="mt-0.5 shrink-0">{label}</Badge>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{step.label}</span>
          {step.critical && <Badge variant="outline" className="text-[10px]">关键</Badge>}
          {typeof step.elapsedMs === 'number' && (
            <span className="text-xs text-muted-foreground">{step.elapsedMs}ms</span>
          )}
        </div>
        {step.detail && <p className="mt-1 break-words text-xs text-muted-foreground">{step.detail}</p>}
      </div>
    </div>
  );
}
