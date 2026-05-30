'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertCircle, Info, Megaphone } from 'lucide-react';
import { sanitizeHtml } from '@/lib/sanitize-html';

interface ForcePopupAnnouncement {
  id: string;
  title: string;
  content: string;
  type: 'NOTICE' | 'UPDATE' | 'ALERT';
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  attachments?: { name: string; url: string; size?: number }[] | null;
  publishedAt: string;
}

const typeIconMap = {
  NOTICE: Info,
  UPDATE: Megaphone,
  ALERT: AlertCircle,
};

const priorityColorMap = {
  NORMAL: 'text-blue-600 dark:text-blue-400',
  IMPORTANT: 'text-amber-600 dark:text-amber-400',
  CRITICAL: 'text-destructive',
};

export function AnnouncementPopup() {
  const [queue, setQueue] = useState<ForcePopupAnnouncement[]>([]);
  const [current, setCurrent] = useState<ForcePopupAnnouncement | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<ForcePopupAnnouncement[]>('/api/announcements/force-popup').then((res) => {
      if (cancelled) return;
      if (res.code === 1 && res.data && res.data.length > 0) {
        setQueue(res.data);
        setCurrent(res.data[0] || null);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function handleConfirm() {
    if (!current) return;
    setMarking(true);
    try {
      await api.post(`/api/announcements/${current.id}/read`);
      const rest = queue.slice(1);
      setQueue(rest);
      setCurrent(rest[0] || null);
    } finally {
      setMarking(false);
    }
  }

  if (!current) return null;

  const Icon = typeIconMap[current.type] || Info;
  const colorClass = priorityColorMap[current.priority] || priorityColorMap.NORMAL;

  return (
    <Dialog open={!!current} onOpenChange={() => { /* 强制弹窗：不允许 ESC 关闭 */ }}>
      <DialogContent
        className="max-w-2xl"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${colorClass}`} />
            <span className={current.priority === 'CRITICAL' ? colorClass : ''}>{current.title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="prose prose-sm dark:prose-invert max-w-none max-h-[60vh] overflow-y-auto"
             dangerouslySetInnerHTML={{ __html: sanitizeHtml(current.content) }} />

        {current.attachments && current.attachments.length > 0 && (
          <div className="border-t pt-3 space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">附件</div>
            {current.attachments.map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-primary hover:underline truncate"
              >
                {att.name}
              </a>
            ))}
          </div>
        )}

        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-muted-foreground">
            {queue.length > 1 && `还有 ${queue.length - 1} 条公告待阅读`}
          </span>
          <Button onClick={handleConfirm} disabled={marking}>
            {marking ? '处理中...' : '我已阅读'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
