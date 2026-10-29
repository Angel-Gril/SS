'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { loadDashboardSession, type DashboardSessionResult } from '@/lib/dashboard-session';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { AnnouncementPopup } from '@/components/announcement-popup';
import { Button } from '@/components/ui/button';
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
  return '/';
}

/** 检查当前路径是否对该角色禁止访问 */
function isPathForbidden(pathname: string, role: string, isSuperAdmin?: boolean): boolean {
  if (role === 'ADMIN') {
    const superAdminOnly = ['/admin/settings', '/admin/integrations', '/admin/security', '/admin/ops', '/admin/logistics-rules'];
    return superAdminOnly.some((path) => pathname === path || pathname.startsWith(`${path}/`)) && !isSuperAdmin;
  }

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
  const [sessionAttempt, setSessionAttempt] = useState(0);
  // Keep the authenticated shell stable while navigating between dashboard
  // pages. The current pathname is still used by the permission guard below;
  // it must not invalidate the identity request and blank the whole layout.
  const sessionRequest = useMemo(() => ({ attempt: sessionAttempt }), [sessionAttempt]);
  const [session, setSession] = useState<{
    request: typeof sessionRequest;
    result: DashboardSessionResult;
  } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const currentSession = session?.request === sessionRequest ? session.result : null;
  const user = currentSession?.status === 'authenticated' ? currentSession.user : null;

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboardSession({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.status === 'cancelled') return;
      setSession({ request: sessionRequest, result });
    });

    return () => {
      controller.abort();
    };
  }, [sessionRequest]);

  // 路由权限保护：基于 effectiveRole 判断（USER 切仓库端时按 STAFF 视角拦）
  useEffect(() => {
    if (!user) return;
    const effRole = getEffectiveRole(user);
    if (isPathForbidden(pathname, effRole, user.isSuperAdmin)) {
      router.replace(getDefaultPath(effRole));
    }
  }, [user, pathname, router]);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [pathname]);

  if (!currentSession || currentSession.status === 'cancelled') {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="正在验证登录状态">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (currentSession.status === 'unavailable') {
    const descriptions = {
      timeout: '服务器响应超时，请检查网络后重试。',
      network: '暂时无法连接服务器，网络恢复后可重试。',
      maintenance: '系统正在维护，请稍后重试。',
      response: '暂时无法确认登录状态，请稍后重试。',
    };
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 text-center" role="alert" aria-labelledby="session-error-title">
          <h1 id="session-error-title" className="text-lg font-semibold">页面暂时无法加载</h1>
          <p className="text-sm text-muted-foreground">{descriptions[currentSession.reason]}</p>
          <Button type="button" onClick={() => setSessionAttempt((attempt) => attempt + 1)}>重试连接</Button>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const effRole = getEffectiveRole(user);
  const pathForbidden = isPathForbidden(pathname, effRole, user.isSuperAdmin);

  if (pathForbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  function toggleNavigation() {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setMobileNavigationOpen((open) => !open);
      return;
    }
    setCollapsed((value) => !value);
  }

  return (
    <div className="relative min-h-screen flex overflow-x-clip bg-background">
      <Sidebar
        collapsed={collapsed}
        pathname={pathname}
        role={effRole}
        isSuperAdmin={user.isSuperAdmin}
        mobileOpen={mobileNavigationOpen}
        onMobileClose={() => setMobileNavigationOpen(false)}
      />
      {mobileNavigationOpen && (
        <button
          type="button"
          aria-label="关闭导航菜单"
          className="fixed inset-0 z-40 bg-black/35 md:hidden"
          onClick={() => setMobileNavigationOpen(false)}
        />
      )}
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          user={user}
          collapsed={collapsed}
          onToggle={toggleNavigation}
        />
        <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6">{children}</main>
      </div>
      <AnnouncementPopup />
    </div>
  );
}
