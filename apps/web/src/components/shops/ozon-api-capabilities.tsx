'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck, ShieldAlert, CircleHelp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';

type Capability = {
  id: string;
  label: string;
  status: 'allowed' | 'missing';
  missingMethods: string[];
};
type Diagnostic = {
  checkedAt: string;
  expiresAt: string | null;
  expiryStatus: 'expired' | 'expiring' | 'valid' | 'unknown';
  daysRemaining: number | null;
  carriageBusinessEligibility: 'unverified';
  features: Capability[];
};

function expiryText(data: Diagnostic): string {
  if (data.expiryStatus === 'expired') return 'API Key 已过期';
  if (data.expiryStatus === 'expiring') return `API Key 将在 ${data.daysRemaining ?? 0} 天内到期`;
  if (data.expiryStatus === 'valid') return `API Key 有效（剩余 ${data.daysRemaining ?? 0} 天）`;
  return 'API Key 到期时间未知（以 Ozon 返回为准）';
}

export function OzonApiCapabilities({ shopId }: { shopId: string }) {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    setDiagnostic(null);
    setErrorMessage(null);
    setLoading(false);
    return () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [shopId]);

  async function runDiagnostic() {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    setDiagnostic(null);
    setErrorMessage(null);
    try {
      const response = await api.post<Diagnostic>(`/api/ozon-api-capabilities/${encodeURIComponent(shopId)}`, undefined, {
        signal: controller.signal,
        timeoutMs: 20_000,
      });
      if (activeRequest.current !== controller) return;
      if (response.code !== 1 || !response.data) throw new Error(response.msg || '诊断失败');
      setDiagnostic(response.data);
      toast({ title: 'Ozon API 权限诊断完成' });
    } catch (error) {
      if (activeRequest.current !== controller || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : '诊断失败';
      setErrorMessage(message);
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Ozon API 权限与到期诊断</CardTitle>
        <CardDescription>仅读取 Ozon 授权信息；不会保存或展示 API Key，也不会创建组包。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button type="button" variant="outline" onClick={runDiagnostic} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          {loading ? '正在检查…' : '检查 API 权限'}
        </Button>
        {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
        {diagnostic && (
          <div className="space-y-3 text-sm" aria-live="polite">
            <p className={diagnostic.expiryStatus === 'expired' || diagnostic.expiryStatus === 'expiring' ? 'text-destructive' : 'text-muted-foreground'}>{expiryText(diagnostic)}</p>
            {diagnostic.expiresAt && <p className="text-xs text-muted-foreground">到期时间：{new Date(diagnostic.expiresAt).toLocaleString('zh-CN')}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {diagnostic.features.map((feature) => (
                <div key={feature.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span>{feature.label}</span>
                  <Badge variant={feature.status === 'allowed' ? 'default' : 'destructive'}>
                    {feature.status === 'allowed' ? '已授权' : <><ShieldAlert className="mr-1 h-3 w-3" />缺少权限</>}
                  </Badge>
                </div>
              ))}
            </div>
            {diagnostic.features.some((feature) => feature.status === 'missing') && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">查看缺少的方法权限</summary>
                <ul className="mt-2 space-y-2">
                  {diagnostic.features.filter((feature) => feature.status === 'missing').map((feature) => (
                    <li key={feature.id}>
                      <span className="font-medium">{feature.label}</span>
                      {feature.missingMethods.map((method) => <code key={method} className="mt-1 block break-all">{method}</code>)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <p className="flex items-start gap-1 text-xs text-muted-foreground">
              <CircleHelp className="mt-0.5 h-3 w-3 shrink-0" /> 已授权仅表示方法权限存在；密钥须有效，组包仓库准入和 Ozon 物流开通状态仍需单独核验。
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default OzonApiCapabilities;
