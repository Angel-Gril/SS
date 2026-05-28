'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

interface Notice {
  id: string;
  title: string;
  level: string;
  pinned: boolean;
  publishedAt: string;
}

export function NoticeList() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    api.get<{ total: number; rows: Notice[] }>('/api/notices?limit=5').then((res) => {
      if (res.code === 1 && res.data) setNotices(res.data.rows);
    });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">系统公告</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {notices.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无公告</p>
        ) : (
          notices.map((n) => (
            <div key={n.id} className="flex items-start gap-2">
              <LevelBadge level={n.level} pinned={n.pinned} />
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

function LevelBadge({ level, pinned }: { level: string; pinned: boolean }) {
  if (pinned) return <Badge variant="destructive" className="text-[10px] px-1.5">置顶</Badge>;
  if (level === 'WARN') return <Badge variant="warning" className="text-[10px] px-1.5">重要</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5">公告</Badge>;
}
