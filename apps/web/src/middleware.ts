import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_HOSTNAME = process.env.NEXT_PUBLIC_ADMIN_HOSTNAME || 'admin.ss-erp.com';
const USER_HOSTNAME = process.env.NEXT_PUBLIC_USER_HOSTNAME || 'app.ss-erp.com';
const MARKETING_HOSTNAME = 'ss-erp.com';
const WWW_MARKETING_HOSTNAME = 'www.ss-erp.com';
const MARKETING_HOSTNAMES = [MARKETING_HOSTNAME, WWW_MARKETING_HOSTNAME];

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

function redirectTo(request: NextRequest, pathname: string, status = 307) {
  return NextResponse.redirect(new URL(pathname, getRequestOrigin(request)), status);
}

function redirectToHost(request: NextRequest, hostname: string, pathname = request.nextUrl.pathname, status = 307) {
  const url = request.nextUrl.clone();
  url.protocol = `${request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https'}:`;
  url.hostname = hostname;
  url.port = '';
  url.pathname = pathname;
  return NextResponse.redirect(url, status);
}

function rewriteTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const normalizedHost = host.split(':')[0]?.toLowerCase() || '';
  const pathname = request.nextUrl.pathname;

  if (normalizedHost === WWW_MARKETING_HOSTNAME) {
    return redirectToHost(request, MARKETING_HOSTNAME, pathname === '/landing' ? '/' : pathname, 301);
  }

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
  // 根路径直接渲染官网首页，避免公开 URL 出现 /landing。
  if (MARKETING_HOSTNAMES.includes(normalizedHost)) {
    if (pathname === '/') {
      return rewriteTo(request, '/landing');
    }
    if (pathname === '/landing') {
      return redirectTo(request, '/', 301);
    }
    if (pathname === '/login' || pathname === '/register') {
      return redirectToHost(request, USER_HOSTNAME, pathname);
    }
  } else if (pathname === '/landing') {
    return redirectTo(request, '/login');
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|.*\\.).*)',
};
