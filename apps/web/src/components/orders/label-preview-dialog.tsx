'use client';

import { useEffect, useRef, useState } from 'react';
import { FileDown, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';

interface LabelOrder { id: string; postingNumber?: string | null }

export function LabelPreviewDialog({ order, onClose }: { order: LabelOrder | null; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState('label.pdf');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const orderId = order?.id;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPdfUrl(null);
    setError(null);
    setFilename('label.pdf');
    setLoading(!!orderId);
    if (!orderId) return;
    api.get(`/api/orders/${encodeURIComponent(orderId)}/label?format=base64`).then((res: any) => {
      if (!active) return;
      if (res.code === 1 && res.data?.base64) {
        const binary = atob(res.data.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: res.data.contentType || 'application/pdf' }));
        setPdfUrl(objectUrl);
        setFilename(res.data.filename || 'label.pdf');
      } else {
        setError(res.msg || '获取面单失败');
      }
      setLoading(false);
    }).catch(() => {
      if (active) { setError('获取面单失败，请检查网络后重新打开。'); setLoading(false); }
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [orderId]);

  function handlePrint() {
    iframeRef.current?.contentWindow?.focus();
    iframeRef.current?.contentWindow?.print();
  }
  function handleDownload() {
    if (!pdfUrl) return;
    const link = document.createElement('a'); link.href = pdfUrl; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
  }

  return (
    <Dialog open={!!order} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="flex h-[90dvh] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden p-4 sm:p-6">
        <DialogHeader className="shrink-0 space-y-2 pr-10 text-left">
          <DialogTitle className="break-words leading-normal">面单预览 — {order?.postingNumber}</DialogTitle>
          <DialogDescription>优先获取小面单；平台仅提供普通面单时使用普通面单。</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2" aria-label="面单操作">
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={!pdfUrl || loading}>
            <FileDown className="h-4 w-4" /> 下载
          </Button>
          <Button size="sm" onClick={handlePrint} disabled={!pdfUrl || loading}>
            <Printer className="h-4 w-4" /> 打印
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted" aria-busy={loading}>
          {loading ? (
            <div className="flex h-full items-center justify-center p-4" role="status">
              <div className="space-y-3 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">正在从 Ozon 获取面单…</p>
                <p className="text-xs text-muted-foreground">首次生成可能需要等待，请勿重复提交。</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center overflow-y-auto p-4">
              <div className="max-w-md space-y-3 break-words text-center">
                <p className="font-medium text-destructive" role="alert">{error}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  如刚在 Ozon 确认备货，建议等待 45–60 秒后再获取面单。其他问题请按上方具体错误核对。
                </p>
              </div>
            </div>
          ) : pdfUrl ? (
            <iframe ref={iframeRef} src={pdfUrl} className="h-full w-full border-0" title="面单预览" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
