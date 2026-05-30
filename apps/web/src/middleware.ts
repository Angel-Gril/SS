import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ADMIN_HOSTNAME = process.env.NEXT_PUBLIC_ADMIN_HOSTNAME || '';
const USER_HOSTNAME = process.env.NEXT_PUBLIC_USER_HOSTNAME || '';

function hostMatches(host: string, configured: string): boolean {
  if (!configured) return false;
  const h = host.split(':')[0]?.toLowerCase() || '';
  return h === configured.toLowerCase();
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const pathname = request.nextUrl.pathname;

  if (hostMatches(host, ADMIN_HOSTNAME)) {
    if (pathname === '/') {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    if (pathname === '/login' || pathname === '/register' || pathname === '/landing') {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
    if (!pathname.startsWith('/admin') && !pathname.startsWith('/api')) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
  }

  if (hostMatches(host, USER_HOSTNAME)) {
    if (pathname.startsWith('/admin')) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico|.*\\.).*)',
};
