import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { deploymentHostMode, deploymentHosts } from '@/lib/deployment-hosts';

const ADMIN_HOSTNAME = deploymentHosts.adminHostname;
const USER_HOSTNAME = deploymentHosts.userHostname;
const MARKETING_HOSTNAME = deploymentHosts.marketingHostname;
const WWW_MARKETING_HOSTNAME = MARKETING_HOSTNAME.startsWith('www.')
  ? MARKETING_HOSTNAME
  : `www.${MARKETING_HOSTNAME}`;
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
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.protocol = 'http:';
  }
  return NextResponse.rewrite(url);
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const normalizedHost = host.split(':')[0]?.toLowerCase() || '';
  const pathname = request.nextUrl.pathname;

  if ((normalizedHost === 'localhost' || normalizedHost === '127.0.0.1') && pathname === '/landing') {
    return NextResponse.next();
  }

  if (deploymentHostMode.splitMarketing && normalizedHost === WWW_MARKETING_HOSTNAME) {
    return redirectToHost(request, MARKETING_HOSTNAME, pathname === '/landing' ? '/' : pathname, 301);
  }

  // 管理员独立域名。单域部署时保留 /admin 路径，不做跨域隔离。
  if (deploymentHostMode.splitAdmin && hostMatches(host, ADMIN_HOSTNAME)) {
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

  // 用户域名。
  if (hostMatches(host, USER_HOSTNAME)) {
    // 访问 /admin 路径时重定向到登录
    if (deploymentHostMode.splitAdmin && pathname.startsWith('/admin')) {
      return redirectTo(request, '/login');
    }
    // 访问根路径时进入用户工作台；未登录再回登录页。
    if (pathname === '/') {
      const hasAuthCookie = request.cookies.has('sserp_token');
      return redirectTo(request, hasAuthCookie ? '/orders' : '/login');
    }
  }

  // 独立官网域名。
  // 根路径直接渲染官网首页，避免公开 URL 出现 /landing。
  if (deploymentHostMode.splitMarketing && MARKETING_HOSTNAMES.includes(normalizedHost)) {
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
