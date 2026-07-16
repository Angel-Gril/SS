'use client';

import { useEffect, useState, useRef } from 'react';
import { Menu, Bell, LogOut, User, Moon, Sun, ArrowLeftRight, Key, Megaphone } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { api, tokenStore } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { GlobalSearch } from '@/components/global-search';
import { ExtensionTokenDialog } from '@/components/extension-token-dialog';
import type { AuthUser } from 'shared';

interface TopbarProps {
  user: AuthUser;
  collapsed: boolean;
  onToggle: () => void;
}

interface NotifItem {
  id: string;
  type: string;
  title: string;
  content: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export function Topbar({ user, onToggle }: TopbarProps) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [announcementUnread, setAnnouncementUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [recentNotifs, setRecentNotifs] = useState<NotifItem[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const stableAccountLabel = user.accountCode || `ID ${user.id.slice(0, 8)}`;

  useEffect(() => {
    loadUnreadCount();
    loadAnnouncementUnread();
    const interval = setInterval(() => {
      loadUnreadCount();
      loadAnnouncementUnread();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    }
    if (notifOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [notifOpen]);

  async function loadUnreadCount() {
    const res = await api.get<{ count: number }>('/api/notifications/unread-count');
    if (res.code === 1 && res.data) setUnreadCount(res.data.count);
  }

  async function loadAnnouncementUnread() {
    const res = await api.get<{ count: number }>('/api/announcements/unread-count');
    if (res.code === 1 && res.data) setAnnouncementUnread(res.data.count);
  }

  async function handleBellClick() {
    if (!notifOpen) {
      const res = await api.get<{ total: number; rows: NotifItem[] }>('/api/notifications?limit=5');
      if (res.code === 1 && res.data) setRecentNotifs(res.data.rows);
    }
    setNotifOpen(!notifOpen);
  }

  async function handleLogout() {
    await api.post('/api/auth/logout');
    tokenStore.clear();
    router.replace('/login');
  }

  return (
    <header className="h-16 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-4 shrink-0 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onToggle} aria-label="切换导航菜单">
          <Menu className="h-5 w-5" />
        </Button>
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground hidden sm:inline">
          余额: <span className="font-medium text-foreground">{formatCurrency(user.balance)}</span>
        </span>

        {(user as any).role === 'USER' && (user as any).isTransitProvider && (
          <PortalSwitcher activePortal={(user as any).activePortal || 'user'} />
        )}

        <ExtensionTokenDialog
          trigger={
            <Button variant="ghost" size="icon" title="扩展连接 Token">
              <Key className="h-4.5 w-4.5" />
            </Button>
          }
        />

        <Link href="/announcements" title="公告">
          <Button variant="ghost" size="icon" className="relative">
            <Megaphone className="h-4.5 w-4.5" />
            {announcementUnread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                {announcementUnread > 99 ? '99+' : announcementUnread}
              </span>
            )}
          </Button>
        </Link>

        <div className="relative" ref={dropdownRef}>
          <Button variant="ghost" size="icon" className="relative" onClick={handleBellClick}>
            <Bell className="h-4.5 w-4.5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Button>
          {notifOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-background border rounded-lg shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-2.5 border-b font-medium text-sm">通知</div>
              {recentNotifs.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">暂无通知</div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto">
                  {recentNotifs.map((n) => (
                    <div key={n.id} className={`px-4 py-2.5 border-b last:border-0 hover:bg-accent transition-colors ${!n.read ? 'bg-primary/5' : ''}`}>
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{formatDate(n.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
              <Link
                href="/notifications"
                onClick={() => setNotifOpen(false)}
                className="block px-4 py-2.5 text-center text-xs text-primary hover:bg-accent border-t"
              >
                查看全部
              </Link>
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-4.5 w-4.5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4.5 w-4.5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <div className="flex items-center gap-2 ml-2 pl-2 border-l">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="h-4 w-4 text-primary" />
          </div>
          <div className="hidden md:flex flex-col leading-tight">
            <span className="text-sm font-medium">
              {user.nickname || user.phone}
              {user.accountCode && (
                <span className="ml-1.5 text-[10px] font-mono px-1 py-0.5 rounded bg-muted text-muted-foreground">
                  {user.accountCode}
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {user.phone} · {stableAccountLabel}
            </span>
            {user.isSubAccount && user.parentAccountCode && (
              <span className="text-[10px] text-muted-foreground">
                子账号 · 主账号 {user.parentAccountCode}{user.parentNickname ? `（${user.parentNickname}）` : ''}
              </span>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="退出登录">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}

function PortalSwitcher({ activePortal }: { activePortal: string }) {
  const [portal, setPortal] = useState(activePortal);
  const [switching, setSwitching] = useState(false);

  async function toggle() {
    const next = portal === 'user' ? 'warehouse' : 'user';
    setSwitching(true);
    const res = await api.post('/api/user/switch-portal', { portal: next });
    setSwitching(false);
    if (res.code === 1) {
      setPortal(next);
      // 硬跳：重新加载 /me 拿最新 activePortal，并落到目标端首页
      window.location.href = next === 'warehouse' ? '/warehouse' : '/orders';
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={switching}
      className={`text-xs gap-1.5 ${portal === 'warehouse' ? 'bg-orange-50 border-orange-300 text-orange-700' : ''}`}
    >
      <ArrowLeftRight className="h-3.5 w-3.5" />
      {portal === 'user' ? '用户端' : '仓库端'}
    </Button>
  );
}
