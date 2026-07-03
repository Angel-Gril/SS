'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Announcement {
  id: string;
  title: string;
  type: 'NOTICE' | 'UPDATE' | 'ALERT';
  priority: 'NORMAL' | 'IMPORTANT' | 'CRITICAL';
  publishedAt: string;
  isRead: boolean;
}

export function NoticeList() {
  const [items, setItems] = useState<Announcement[]>([]);

  useEffect(() => {
    api.get<Announcement[]>('/api/announcements/list').then((res) => {
      if (res.code === 1 && res.data) setItems(res.data.slice(0, 5));
    });
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">系统公告</CardTitle>
        <Link href="/announcements" className="text-xs text-primary hover:underline">全部</Link>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无公告</p>
        ) : (
          items.map((n) => (
            <div key={n.id} className="flex items-start gap-2">
              <LevelBadge type={n.type} priority={n.priority} isRead={n.isRead} />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.publishedAt.slice(0, 10)}</p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function LevelBadge({ type, priority, isRead }: { type: string; priority: string; isRead: boolean }) {
  if (priority === 'CRITICAL') return <Badge variant="destructive" className="text-[10px] px-1.5">紧急</Badge>;
  if (!isRead) return <Badge variant="default" className="text-[10px] px-1.5">未读</Badge>;
  if (type === 'UPDATE') return <Badge variant="outline" className="text-[10px] px-1.5">更新</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5">公告</Badge>;
}
