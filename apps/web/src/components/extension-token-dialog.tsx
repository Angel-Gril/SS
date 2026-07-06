'use client';

import { useState } from 'react';
import { Key, Copy, Check, Loader2, RefreshCw, Cable } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api, getApiBase } from '@/lib/api';

interface ExtensionTokenDialogProps {
  trigger?: React.ReactNode;
}

interface ExtensionBridgeResponse {
  ok?: boolean;
  endpoint?: string;
  hasToken?: boolean;
  user?: {
    id?: string;
    phone?: string;
    nickname?: string;
    accountCode?: string;
    role?: string;
  } | null;
  error?: string;
}

export function ExtensionTokenDialog({ trigger }: ExtensionTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [binding, setBinding] = useState(false);
  const [bindStatus, setBindStatus] = useState('');
  const [copied, setCopied] = useState(false);

  async function generateToken(): Promise<string | null> {
    setLoading(true);
    try {
      const res = await api.post<{ token: string; expiresAt: string }>('/api/auth/extension-token', {});
      if (res.code === 1 && res.data) {
        setToken(res.data.token);
        setExpiresAt(res.data.expiresAt);
        return res.data.token;
      }
      toast({ title: res.msg || '生成失败', variant: 'destructive' });
      return null;
    } finally {
      setLoading(false);
    }
  }

  function formatExtensionBoundUserLabel(user: ExtensionBridgeResponse['user']) {
    if (!user) return '';
    return user.accountCode || user.phone || user.nickname || (user.id ? `ID ${user.id.slice(0, 8)}` : '');
  }

  function sendToExtension(message: Record<string, unknown>): Promise<ExtensionBridgeResponse> {
    if (typeof window === 'undefined') {
      return Promise.resolve({ ok: false, error: '当前环境无法连接扩展' });
    }

    const requestId = `extension-bind-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return new Promise((resolve) => {
      let done = false;
      let onMessage: (event: MessageEvent) => void;
      const cleanup = () => {
        done = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
      };
      onMessage = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as any;
        if (!data || data.direction !== 'ss-erp:from-extension' || data.requestId !== requestId) return;
        cleanup();
        resolve((data.response || { ok: false, error: '扩展未返回结果' }) as ExtensionBridgeResponse);
      };
      const timer = window.setTimeout(() => {
        if (done) return;
        cleanup();
        resolve({ ok: false, error: '未检测到 SS ERP 扩展，请确认已安装并刷新当前页面' });
      }, 5000);

      window.addEventListener('message', onMessage);
      window.postMessage({
        direction: 'ss-erp:to-extension',
        requestId,
        message,
      }, window.location.origin);
    });
  }

  async function bindExtension() {
    setBinding(true);
    setBindStatus('正在生成 Token...');
    const nextToken = token || await generateToken();
    if (!nextToken) {
      setBinding(false);
      setBindStatus('Token 生成失败');
      return;
    }

    const endpoint = `${getApiBase()}/api/collect`;
    setBindStatus('正在写入扩展配置...');
    const response = await sendToExtension({
      type: 'ozon-calc:erp-endpoint-save',
      payload: { endpoint, token: nextToken },
    });
    setBinding(false);

    if (response.ok) {
      const boundUser = formatExtensionBoundUserLabel(response.user);
      setBindStatus(`扩展已连接：${boundUser ? `${boundUser} · ` : ''}${response.endpoint || endpoint}`);
      toast({
        title: '扩展连接成功',
        description: boundUser ? `已绑定账号：${boundUser}` : 'ERP 地址和 Token 已写入当前浏览器扩展',
      });
    } else {
      const msg = response.error || '扩展连接失败';
      setBindStatus(msg);
      toast({ title: '扩展连接失败', description: msg, variant: 'destructive' });
    }
  }

  async function copyValue(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const erpUrl = typeof window !== 'undefined' ? getApiBase() : '';
  const collectEndpoint = erpUrl ? `${erpUrl}/api/collect` : '';

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
            优先点击一键连接。失败时再把下面的 ERP 地址和 Token 手动填入 Chrome 扩展设置面板。
          </p>

          <div className="rounded-md border bg-muted/40 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">一键连接当前浏览器扩展</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  会把 ERP 采集接口和 30 天 Token 写入扩展本地存储，不经过公告或远程脚本。
                </p>
              </div>
              <Button size="sm" onClick={bindExtension} disabled={binding || loading} className="shrink-0 gap-1.5">
                {binding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cable className="h-3.5 w-3.5" />}
                一键连接
              </Button>
            </div>
            {bindStatus && <p className="break-words text-xs text-muted-foreground">{bindStatus}</p>}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">ERP 地址</div>
            <div className="flex items-center gap-2">
              <code className="bg-muted px-2 py-1.5 rounded flex-1 text-xs break-all">{erpUrl}</code>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copyValue(erpUrl)}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            {collectEndpoint && (
              <p className="text-xs text-muted-foreground">
                扩展内部会保存采集接口：<code className="font-mono">{collectEndpoint}</code>
              </p>
            )}
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

          <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 space-y-1">
            <p className="font-medium text-foreground">使用说明</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>先点击“一键连接”，看到连接成功后刷新 OZON 页面</li>
              <li>如果提示未检测到扩展，确认已安装 SS ERP 扩展并刷新当前 ERP 页面</li>
              <li>仍失败时，打开扩展设置面板手动填入 ERP 地址和 Token</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
