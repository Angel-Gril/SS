'use client';

import { useEffect, useState } from 'react';
import { Bell, Loader2, CheckCheck, Trash2, Package, AlertTriangle, RefreshCw, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Notification {
  id: string;
  type: string;
  title: string;
  content: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const TYPE_ICONS: Record<string, any> = {
  order: Package,
  stock: AlertTriangle,
  sync: RefreshCw,
  finance: DollarSign,
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(0);
  const limit = 20;

  useEffect(() => { fetchData(); }, [filter, page]);

  async function fetchData() {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(page * limit), limit: String(limit) });
    if (filter === 'unread') params.set('read', 'false');
    const res = await api.get<{ total: number; rows: Notification[]; unreadCount: number }>(`/api/notifications?${params}`);
    if (res.code === 1 && res.data) {
      setNotifications(res.data.rows);
      setTotal(res.data.total);
      setUnreadCount(res.data.unreadCount);
    }
    setLoading(false);
  }

  async function markRead(id: string) {
    await api.put(`/api/notifications/${id}/read`, {});
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    const res = await api.post('/api/notifications/read-all', {});
    if (res.code === 1) {
      toast({ title: '已全部标为已读' });
      fetchData();
    }
  }

  async function clearRead() {
    const res = await api.delete('/api/notifications/clear-read');
    if (res.code === 1) {
      toast({ title: '已清除已读通知' });
      fetchData();
    }
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">通知中心</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {unreadCount > 0 ? `${unreadCount} 条未读消息` : '暂无未读消息'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="h-3.5 w-3.5" /> 全部已读
          </Button>
          <Button size="sm" variant="outline" onClick={clearRead}>
            <Trash2 className="h-3.5 w-3.5" /> 清除已读
          </Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => { setFilter('all'); setPage(0); }}>
          全部 ({total})
        </Button>
        <Button size="sm" variant={filter === 'unread' ? 'default' : 'outline'} onClick={() => { setFilter('unread'); setPage(0); }}>
          未读 ({unreadCount})
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : notifications.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              {filter === 'unread' ? '没有未读通知' : '暂无通知'}
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => {
                const Icon = TYPE_ICONS[n.type] || Bell;
                return (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 p-4 cursor-pointer hover:bg-muted/50 transition-colors ${!n.read ? 'bg-primary/5' : ''}`}
                    onClick={() => { if (!n.read) markRead(n.id); }}
                  >
                    <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center ${!n.read ? 'bg-primary/10' : 'bg-muted'}`}>
                      <Icon className={`h-4 w-4 ${!n.read ? 'text-primary' : 'text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${!n.read ? 'font-medium' : ''}`}>{n.title}</span>
                        {!n.read && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      {n.content && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.content}</p>}
                      <span className="text-xs text-muted-foreground mt-1 block">{formatDate(n.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <span className="text-sm text-muted-foreground">第 {page + 1} / {totalPages} 页</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <Button size="sm" variant="outline" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
