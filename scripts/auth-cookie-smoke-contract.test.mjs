import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  activeHostOnlyAuthCookie,
  authCookieHeaderFromSetCookie,
  clearedAuthCookies,
} from '../apps/server/scripts/smoke-auth-cookie.mjs';

const liveSmoke = readFileSync('apps/server/scripts/live-smoke.mjs', 'utf8');
const remoteSmoke = readFileSync('apps/server/scripts/remote-smoke.mjs', 'utf8');

for (const [label, source] of [['live', liveSmoke], ['remote', remoteSmoke]]) {
  test(`${label} smoke selects the active host-only auth cookie`, () => {
    assert.match(source, /activeHostOnlyAuthCookie/u);
    assert.doesNotMatch(
      source,
      /get\('set-cookie'\)[\s\S]{0,120}split\(';'\)\[0\]/u,
    );
  });
}

test('live smoke verifies cookie-only identities and logout isolation', () => {
  assert.match(liveSmoke, /admin cookie-only identity/u);
  assert.match(liveSmoke, /user cookie-only identity/u);
  assert.match(liveSmoke, /admin logout preserves user cookie session/u);
});

test('remote smoke verifies cookie-only identities when login credentials are supplied', () => {
  assert.match(remoteSmoke, /admin cookie-only identity/u);
  assert.match(remoteSmoke, /user cookie-only identity/u);
  assert.match(remoteSmoke, /admin logout preserves user cookie session/u);
  assert.match(remoteSmoke, /`\$\{adminWebBaseUrl\}\/api\/admin\/auth\/login`/u);
  assert.match(remoteSmoke, /`\$\{userWebBaseUrl\}\/api\/auth\/login`/u);
  assert.match(remoteSmoke, /login did not return one active host-only cookie/u);
});

test('smoke cookie parser ignores a leading legacy-domain deletion and selects the active host-only value', () => {
  const headers = {
    getSetCookie: () => [
      'sserp_token=; Max-Age=0; Domain=.ss-erp.cn; Path=/; HttpOnly; Secure; SameSite=Lax',
      'sserp_token=active-value; Path=/; HttpOnly; Secure; SameSite=Lax',
    ],
  };
  assert.match(activeHostOnlyAuthCookie(headers), /^sserp_token=active-value;/u);
  assert.equal(authCookieHeaderFromSetCookie(headers), 'sserp_token=active-value');
  assert.equal(clearedAuthCookies(headers).length, 1);
});

test('smoke cookie parser rejects parent-domain cookies as active browser sessions', () => {
  const headers = {
    getSetCookie: () => [
      'sserp_token=parent-value; Domain=.ss-erp.cn; Path=/; HttpOnly; Secure; SameSite=Lax',
    ],
  };
  assert.equal(activeHostOnlyAuthCookie(headers), '');
  assert.equal(authCookieHeaderFromSetCookie(headers), '');
});

test('smoke cookie parser does not call an empty but unexpired parent cookie cleared', () => {
  const headers = {
    getSetCookie: () => [
      'sserp_token=; Domain=.ss-erp.cn; Path=/; HttpOnly; Secure; SameSite=Lax',
    ],
  };
  assert.equal(clearedAuthCookies(headers).length, 0);
});
