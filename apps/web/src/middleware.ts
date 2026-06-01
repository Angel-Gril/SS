import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_HOSTNAME = process.env.NEXT_PUBLIC_ADMIN_HOSTNAME || 'admin.ss-erp.com';
const USER_HOSTNAME = process.env.NEXT_PUBLIC_USER_HOSTNAME || 'app.ss-erp.com';
const MARKETING_HOSTNAMES = ['ss-erp.com', 'www.ss-erp.com'];

function hostMatches(host: string, configured: string): boolean {
  if (!configured) return false;
  const h = host.split(':')[0]?.toLowerCase() || '';
  return h === configured.toLowerCase();
}

function getRequestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host || '';
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https';
  return `${proto}://${host}`;
}

function redirectTo(request: NextRequest, pathname: string) {
  return NextResponse.redirect(new URL(pathname, getRequestOrigin(request)));
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const normalizedHost = host.split(':')[0]?.toLowerCase() || '';
  const pathname = request.nextUrl.pathname;

  // 管理员域名：admin.ss-erp.com
  if (hostMatches(host, ADMIN_HOSTNAME)) {
    if (pathname === '/') {
      return redirectTo(request, '/admin/login');
    }
    if (pathname === '/login' || pathname === '/register' || pathname === '/landing') {
      return redirectTo(request, '/admin/login');
    }
    if (!pathname.startsWith('/admin') && !pathname.startsWith('/api')) {
      return redirectTo(request, '/admin/login');
    }
  }

  // 用户域名：app.ss-erp.com
  if (hostMatches(host, USER_HOSTNAME)) {
    // 访问 /admin 路径时重定向到登录
    if (pathname.startsWith('/admin')) {
      return redirectTo(request, '/login');
    }
    // 访问根路径时重定向到登录（用户工作台）
    if (pathname === '/') {
      return redirectTo(request, '/login');
    }
  }

  // 根域名：ss-erp.com / www.ss-erp.com
  // 根路径跳转到官网首页，避免和 ERP 工作台的 "/" 路由冲突。
  if (MARKETING_HOSTNAMES.includes(normalizedHost)) {
    if (pathname === '/') {
      return redirectTo(request, '/landing');
    }
    if (pathname === '/login' || pathname === '/register') {
      return NextResponse.redirect(new URL(pathname, `${getRequestOrigin(request).replace(/:\/\/[^/]+$/, '')}://${USER_HOSTNAME}`));
    }
  } else if (pathname === '/landing') {
    return redirectTo(request, '/login');
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|.*\\.).*)',
};
