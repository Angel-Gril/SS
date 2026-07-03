'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cable, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import {
  deriveOzonExtensionSyncStatus,
  formatOzonExtensionBridgeError,
  type OzonExtensionAutoSyncState,
  type OzonExtensionSyncTone,
} from 'shared/ozon-extension-sync-status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

interface ExtensionBridgeResponse<T = unknown> {
  ok?: boolean;
  data?: T;
  error?: string;
  hasErpConnection?: boolean;
  intervalMinutes?: number;
  state?: OzonExtensionAutoSyncState;
}

interface OzonExtensionSyncStatusProps {
  className?: string;
  dense?: boolean;
}

function sendToExtension<T>(
  message: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<ExtensionBridgeResponse<T>> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ ok: false, error: '当前环境无法连接扩展' });
  }

  const requestId = `ozon-auto-sync-status-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return new Promise((resolve) => {
    let done = false;
    let timer: number;
    let onMessage: (event: MessageEvent) => void;
    const cleanup = () => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };

    onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as any;
      if (!data || data.direction !== 'ss-erp:from-extension' || data.requestId !== requestId) return;
      cleanup();
      const response = (data.response || { ok: false, error: '扩展未返回结果' }) as ExtensionBridgeResponse<T>;
      resolve({ ...response, error: response.error ? formatOzonExtensionBridgeError(response.error) : response.error });
    };

    timer = window.setTimeout(() => {
      cleanup();
      resolve({ ok: false, error: '未检测到 SS ERP 扩展，请确认扩展已安装并刷新当前页面' });
    }, timeoutMs);

    window.addEventListener('message', onMessage);
    window.postMessage({ direction: 'ss-erp:to-extension', requestId, message }, window.location.origin);
  });
}

function toneClass(tone: OzonExtensionSyncTone) {
  if (tone === 'success') return 'bg-emerald-500';
  if (tone === 'warning') return 'bg-amber-500';
  if (tone === 'danger') return 'bg-destructive';
  return 'bg-muted-foreground/40';
}

function badgeVariant(tone: OzonExtensionSyncTone): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'danger') return 'destructive';
  return 'secondary';
}

export function OzonExtensionSyncStatus({ className, dense = false }: OzonExtensionSyncStatusProps) {
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState(false);
  const [extensionAvailable, setExtensionAvailable] = useState(false);
  const [lastError, setLastError] = useState('');
  const [rawStatus, setRawStatus] = useState<ExtensionBridgeResponse | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    const response = await sendToExtension({ type: 'ozon-calc:auto-sync-status' });
    const available = response.ok === true || response.hasErpConnection !== undefined || !!response.state;
    setExtensionAvailable(available);
    setRawStatus(available ? response : null);
    setLastError(available ? (response.error || '') : (response.error || '扩展未连接'));
    if (!silent) setChecking(false);
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function runMaintenance() {
    setRunning(true);
    const response = await sendToExtension({
      type: 'ozon-calc:auto-sync-maintenance',
      payload: { reason: 'erp_status_card', force: true },
    }, 120000);
    setRunning(false);
    if (response.ok) {
      toast({ title: '已触发 Ozon 自动同步', description: '状态会读取扩展本地记录；Ozon 新数据可能稍后更新。' });
      await loadStatus(true);
    } else {
      const msg = response.error || '扩展同步失败';
      setExtensionAvailable(response.error !== '未检测到 SS ERP 扩展，请确认扩展已安装并刷新当前页面');
      setLastError(msg);
      toast({ title: '同步失败', description: msg, variant: 'destructive' });
    }
  }

  const status = useMemo(() => deriveOzonExtensionSyncStatus({
    extensionAvailable,
    hasErpConnection: rawStatus?.hasErpConnection,
    intervalMinutes: rawStatus?.intervalMinutes,
    state: rawStatus?.state || null,
  }), [extensionAvailable, rawStatus]);

  const visibleError = status.lastError || lastError;
  const isBridgeUnavailable = !extensionAvailable && !!lastError;

  return (
    <Card className={className}>
      <CardContent className={cn('space-y-3', dense ? 'p-3' : 'p-4')}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Cable className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Ozon 自动同步</span>
              <Badge variant={badgeVariant(status.overallTone)} className="text-[10px]">
                {checking ? '检查中' : status.connectionLabel}
              </Badge>
              {status.companyId && (
                <Badge variant="outline" className="font-mono text-[10px]">companyId {status.companyId}</Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              扩展每 {status.intervalMinutes} 分钟维护 Cookie、商品分析和经营图表；这里显示当前浏览器扩展本地状态。
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={() => loadStatus()} disabled={checking || running} className="gap-1.5">
              {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新状态
            </Button>
            <Button size="sm" onClick={runMaintenance} disabled={checking || running || !extensionAvailable} className="gap-1.5">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              立即同步
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {status.items.map((item) => (
            <div key={item.key} className="rounded-md border bg-background px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <span className={cn('h-2 w-2 rounded-full', toneClass(item.tone))} />
                  <span className="truncate">{item.label}</span>
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground" title={item.detail}>
                {item.detail}
              </div>
            </div>
          ))}
        </div>

        {visibleError && (
          <div className={cn(
            'rounded-md border px-3 py-2 text-xs',
            isBridgeUnavailable
              ? 'border-muted bg-muted/30 text-muted-foreground'
              : 'border-destructive/20 bg-destructive/5 text-destructive',
          )}>
            {visibleError}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
