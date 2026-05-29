'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import type { AuthUser } from 'shared';

/** USER 切到 warehouse 端时，按 STAFF 视角渲染（菜单/拦截/默认页都共用 STAFF 规则）*/
function getEffectiveRole(user: AuthUser): 'ADMIN' | 'USER' | 'STAFF' {
  const role = user.role;
  if (role === 'USER' && (user as any).activePortal === 'warehouse') return 'STAFF';
  return role;
}

/** 根据角色返回默认首页 */
function getDefaultPath(role: string): string {
  if (role === 'STAFF') return '/warehouse';
  if (role === 'USER') return '/orders';
  return '/';
}

/** 检查当前路径是否对该角色禁止访问 */
function isPathForbidden(pathname: string, role: string): boolean {
  if (role === 'ADMIN') return false; // ADMIN 可访问所有

  if (role === 'STAFF') {
    // STAFF 只能访问仓储相关、仓库指令和帮助；用精确匹配避免 /warehouse 误吞 /warehouse-commands
    if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return false;
    if (pathname === '/warehouse-commands' || pathname.startsWith('/warehouse-commands/')) return false;
    if (pathname === '/help') return false;
    return true;
  }

  if (role === 'USER') {
    // USER 不能访问 /admin 和 /warehouse（但 /warehouse-commands 是用户可访问的）
    if (pathname.startsWith('/admin')) return true;
    if (pathname === '/warehouse' || pathname.startsWith('/warehouse/')) return true;
    return false;
  }

  return false;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api.get<AuthUser>('/api/user/me')
      .then((res) => {
        if (cancelled) return;
        if (res.code === 1 && res.data) {
          setUser(res.data);
        } else {
          tokenStore.clear();
          router.replace('/login');
        }
      })
      .catch(() => {
        if (cancelled) return;
        tokenStore.clear();
        router.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  // 路由权限保护：基于 effectiveRole 判断（USER 切仓库端时按 STAFF 视角拦）
  useEffect(() => {
    if (!user) return;
    const effRole = getEffectiveRole(user);
    if (isPathForbidden(pathname, effRole)) {
      router.replace(getDefaultPath(effRole));
    }
  }, [user, pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) return null;

  const effRole = getEffectiveRole(user);

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar collapsed={collapsed} pathname={pathname} role={effRole} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          user={user}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
