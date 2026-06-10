'use client';

import { useState } from 'react';
import { Key, Copy, Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api, getApiBase } from '@/lib/api';
import { buildExtensionConnectionMessage } from '@/lib/extension-connection';

interface ExtensionTokenDialogProps {
  trigger?: React.ReactNode;
}

export function ExtensionTokenDialog({ trigger }: ExtensionTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);

  async function generateToken() {
    setLoading(true);
    const res = await api.post<{ token: string; expiresAt: string }>('/api/auth/extension-token', {});
    setLoading(false);
    if (res.code === 1 && res.data) {
      setToken(res.data.token);
      setExpiresAt(res.data.expiresAt);
    } else {
      toast({ title: res.msg || '生成失败', variant: 'destructive' });
    }
  }

  async function copyValue(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function sendExtensionMessage(message: unknown): Promise<{ ok: boolean; error?: string; msg?: string }> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve({ ok: false, error: '当前环境无法连接扩展' });
        return;
      }

      const requestId = `extension-connect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timer = window.setTimeout(() => {
        window.removeEventListener('message', handleMessage);
        resolve({ ok: false, error: '扩展未响应，请确认已安装并启用 SS ERP 本地扩展' });
      }, 5000);

      function handleMessage(event: MessageEvent) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.direction !== 'ss-erp:from-extension' || data.requestId !== requestId) return;

        window.clearTimeout(timer);
        window.removeEventListener('message', handleMessage);
        resolve(data.response || { ok: false, error: '扩展没有返回结果' });
      }

      window.addEventListener('message', handleMessage);
      window.postMessage({ direction: 'ss-erp:to-extension', requestId, message }, '*');
    });
  }

  async function autoConnectExtension() {
    const currentToken = token;
    if (!currentToken) {
      toast({ title: 'Token 还未生成，请稍后再试', variant: 'destructive' });
      return;
    }

    setAutoConnecting(true);
    const response = await sendExtensionMessage(buildExtensionConnectionMessage({
      apiBaseUrl: getApiBase(),
      token: currentToken,
    }));
    setAutoConnecting(false);

    if (response.ok) {
      toast({ title: '扩展已连接到当前 ERP' });
    } else {
      toast({ title: response.error || response.msg || '扩展连接失败', variant: 'destructive' });
    }
  }

  const erpUrl = typeof window !== 'undefined' ? getApiBase() : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o && !token) generateToken(); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="icon" title="扩展连接">
            <Key className="h-4 w-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            扩展连接 Token
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            可一键把当前 ERP 地址和 Token 写入 Chrome 扩展。本地版会连接本机 API，扩展即可向当前 ERP 推送采集数据、店铺分析和经营图表。
          </p>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">ERP 地址</div>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-2 py-1.5 rounded flex-1 text-xs break-all">{erpUrl}</code>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyValue(erpUrl)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Token</div>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={generateToken} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                重新生成
              </Button>
            </div>
            {loading && !token ? (
              <div className="bg-muted px-2 py-3 rounded flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : token ? (
              <div className="flex items-center gap-2">
                <code className="bg-muted px-2 py-1.5 rounded flex-1 text-[10px] break-all select-all font-mono">
                  {token}
                </code>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyValue(token)}>
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            ) : null}
            {expiresAt && (
              <p className="text-xs text-muted-foreground">
                有效期至 {new Date(expiresAt).toLocaleString('zh-CN')}（30 天）
              </p>
            )}
          </div>

          <Button onClick={autoConnectExtension} disabled={loading || autoConnecting || !token} className="w-full">
            {autoConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
            自动写入扩展配置
          </Button>

          <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 space-y-1">
            <p className="font-medium text-foreground">使用说明</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>优先点击“自动写入扩展配置”</li>
              <li>如果扩展未响应，再打开 Chrome 扩展设置面板手动填写</li>
              <li>本地版 ERP 地址通常是 http://127.0.0.1:3001 或 http://localhost:3001</li>
              <li>保存后即可在 OZON / 1688 等页面采集推送</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
