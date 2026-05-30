'use client';

import { useEffect, useState } from 'react';
import { Megaphone, AlertCircle, Info, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { sanitizeHtml } from '@/lib/sanitize-html';

interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'NOTICE' | 'UPDATE' | 'ALERT';
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  attachments?: { name: string; url: string; size?: number }[] | null;
  forcePopup: boolean;
  publishedAt: string;
  isRead: boolean;
}

const TYPE_LABEL = { NOTICE: '通知', UPDATE: '更新', ALERT: '警告' };
const TYPE_ICONS = { NOTICE: Info, UPDATE: Megaphone, ALERT: AlertCircle };
const PRIORITY_LABEL = { NORMAL: '普通', IMPORTANT: '重要', CRITICAL: '紧急' };
const PRIORITY_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  NORMAL: 'secondary',
  IMPORTANT: 'default',
  CRITICAL: 'destructive',
};

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { fetchData(); }, []);

  async function fetchData() {
    setLoading(true);
    const res = await api.get<Announcement[]>('/api/announcements/list');
    if (res.code === 1 && res.data) setItems(res.data);
    setLoading(false);
  }

  async function handleExpand(id: string, isRead: boolean) {
    setExpanded(expanded === id ? null : id);
    if (!isRead) {
      await api.post(`/api/announcements/${id}/read`);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, isRead: true } : it)));
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">公告</h1>
        <Button variant="outline" size="sm" onClick={fetchData}>刷新</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">暂无公告</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const Icon = TYPE_ICONS[item.type];
            const isOpen = expanded === item.id;
            return (
              <Card key={item.id} className={!item.isRead ? 'border-primary/40' : ''}>
                <CardHeader className="cursor-pointer pb-3" onClick={() => handleExpand(item.id, item.isRead)}>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.title}</span>
                    {!item.isRead && <Badge variant="default" className="text-[10px]">未读</Badge>}
                    <Badge variant={PRIORITY_VARIANT[item.priority]} className="text-[10px]">
                      {PRIORITY_LABEL[item.priority]}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{TYPE_LABEL[item.type]}</Badge>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">{formatDate(item.publishedAt)}</div>
                </CardHeader>
                {isOpen && (
                  <CardContent className="pt-0 space-y-3">
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.content) }}
                    />
                    {item.attachments && item.attachments.length > 0 && (
                      <div className="border-t pt-3 space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">附件</div>
                        {item.attachments.map((att, i) => (
                          <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                             className="block text-sm text-primary hover:underline truncate">
                            {att.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
