import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { middleware } from '../src/middleware';

interface RouteResult {
  status: number;
  location: string | null;
  next: string | null;
  rewrite: string | null;
}

function route(hostname: string, pathname: string, cookie = ''): RouteResult {
  const headers = new Headers({
    host: hostname,
    'x-forwarded-host': hostname,
    'x-forwarded-proto': 'https',
  });
  if (cookie) headers.set('cookie', cookie);

  const response = middleware(new NextRequest(new URL(pathname, `https://${hostname}`), { headers }));
  return {
    status: response.status,
    location: response.headers.get('location'),
    next: response.headers.get('x-middleware-next'),
    rewrite: response.headers.get('x-middleware-rewrite'),
  };
}

function expectRedirect(
  hostname: string,
  pathname: string,
  location: string,
  status = 307,
  cookie = '',
) {
  const result = route(hostname, pathname, cookie);
  assert.equal(result.status, status, `${hostname}${pathname} status`);
  assert.equal(result.location, location, `${hostname}${pathname} location`);
}

function expectNext(hostname: string, pathname: string, cookie = '') {
  const result = route(hostname, pathname, cookie);
  assert.equal(result.status, 200, `${hostname}${pathname} status`);
  assert.equal(result.next, '1', `${hostname}${pathname} should continue`);
  assert.equal(result.location, null, `${hostname}${pathname} should not redirect`);
}

assert.equal(process.env.NEXT_PUBLIC_USER_HOSTNAME, 'app.ss-erp.cn');
assert.equal(process.env.NEXT_PUBLIC_ADMIN_HOSTNAME, 'admin.ss-erp.cn');
assert.equal(process.env.NEXT_PUBLIC_MARKETING_HOSTNAME, 'ss-erp.cn');

const marketingRoot = route('ss-erp.cn', '/');
assert.equal(marketingRoot.status, 200);
assert.equal(marketingRoot.rewrite, 'https://ss-erp.cn/landing');
expectRedirect('www.ss-erp.cn', '/', 'https://ss-erp.cn/', 301);
expectRedirect('ss-erp.cn', '/login', 'https://app.ss-erp.cn/login');
expectRedirect('ss-erp.cn', '/admin/login', 'https://admin.ss-erp.cn/admin/login');

expectRedirect('app.ss-erp.cn', '/', 'https://app.ss-erp.cn/login');
expectNext('app.ss-erp.cn', '/', 'sserp_token=active-session');
expectRedirect('app.ss-erp.cn', '/admin/login', 'https://admin.ss-erp.cn/admin/login');
expectRedirect(
  'app.ss-erp.cn',
  '/admin/users?status=active',
  'https://admin.ss-erp.cn/admin/users?status=active',
);

expectRedirect('admin.ss-erp.cn', '/', 'https://admin.ss-erp.cn/admin/login');
expectRedirect('admin.ss-erp.cn', '/login', 'https://admin.ss-erp.cn/admin/login');
expectNext('admin.ss-erp.cn', '/admin/login');

expectNext('localhost', '/');
expectNext('localhost', '/landing');

console.log('PASS Web middleware routing contract');
