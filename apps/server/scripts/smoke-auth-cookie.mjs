const AUTH_COOKIE_PREFIX = 'sserp_token=';

export function getSetCookies(headers) {
  if (typeof headers?.getSetCookie === 'function') return headers.getSetCookie();
  const cookie = headers?.get?.('set-cookie');
  return cookie ? [cookie] : [];
}

function authCookieValue(cookie) {
  if (typeof cookie !== 'string' || !cookie.startsWith(AUTH_COOKIE_PREFIX)) return '';
  return cookie.slice(AUTH_COOKIE_PREFIX.length).split(';')[0]?.trim() || '';
}

export function setCookieDomain(cookie) {
  const attribute = String(cookie || '').split(';').slice(1)
    .map((value) => value.trim())
    .find((value) => /^domain=/iu.test(value));
  return attribute ? attribute.slice(attribute.indexOf('=') + 1).trim().toLowerCase() : '';
}

function isClearingCookie(cookie) {
  if (/;\s*Max-Age=0(?:;|$)/iu.test(cookie)) return true;
  const expires = String(cookie || '').split(';').slice(1)
    .map((value) => value.trim())
    .find((value) => /^expires=/iu.test(value));
  if (!expires) return false;
  const timestamp = Date.parse(expires.slice(expires.indexOf('=') + 1));
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

export function activeHostOnlyAuthCookie(headers) {
  return getSetCookies(headers).find((cookie) => (
    authCookieValue(cookie)
    && !isClearingCookie(cookie)
    && !setCookieDomain(cookie)
  )) || '';
}

export function authCookieHeaderFromSetCookie(headers) {
  const cookie = activeHostOnlyAuthCookie(headers);
  return cookie ? cookie.split(';')[0] : '';
}

export function clearedAuthCookies(headers) {
  return getSetCookies(headers).filter((cookie) => (
    typeof cookie === 'string'
    && cookie.startsWith(AUTH_COOKIE_PREFIX)
    && isClearingCookie(cookie)
  ));
}
