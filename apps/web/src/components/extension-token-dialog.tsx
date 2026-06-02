'use client';

import { useState } from 'react';
import { Key, Copy, Check, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';

interface ExtensionTokenDialogProps {
  trigger?: React.ReactNode;
}

export function ExtensionTokenDialog({ trigger }: ExtensionTokenDialogProps) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const erpUrl = typeof window !== 'undefined' ? window.location.origin : '';

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
            把下面的 ERP 地址和 Token 填入 Chrome 扩展的设置面板，扩展即可向当前 ERP 推送采集数据、店铺分析和经营图表。本地 Windows 版使用本机 API Token，不需要云端 Token。
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

          <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-3 space-y-1">
            <p className="font-medium text-foreground">使用说明</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>打开 Chrome 扩展 SS ERP 设置面板</li>
              <li>ERP 地址使用当前页面显示的地址；本地版通常是 http://127.0.0.1:3001</li>
              <li>填入上面的 Token</li>
              <li>保存后即可在 OZON / 1688 等页面采集推送</li>
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
