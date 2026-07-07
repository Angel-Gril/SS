import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const login = readFileSync('apps/web/src/app/(auth)/login/page-client.tsx', 'utf8');
const register = readFileSync('apps/web/src/app/(auth)/register/page-client.tsx', 'utf8');
const adminLogin = readFileSync('apps/web/src/app/(auth)/admin/login/page-client.tsx', 'utf8');

for (const [name, source] of [
  ['login', login],
  ['register', register],
]) {
  assert.match(
    source,
    /TURNSTILE_RESPONSE_TIMEOUT_MS\s*=\s*8000/,
    `${name} page should fail Turnstile token waits quickly instead of leaving the form stuck for 30s`,
  );
  assert.doesNotMatch(
    source,
    /getResponsePromise\(30000\)/,
    `${name} page should not wait 30s when Turnstile did not render a token`,
  );
  assert.match(
    source,
    /setTurnstileRenderKey\(\(value\)\s*=>\s*value\s*\+\s*1\)/,
    `${name} page should remount Turnstile when the user clicks reload validation`,
  );
  assert.match(
    source,
    /key=\{turnstileRenderKey\}/,
    `${name} page should pass the remount key to the Turnstile component`,
  );
  assert.match(
    source,
    /formatAuthNetworkError\(error\)/,
    `${name} page should show useful network error details instead of a generic toast`,
  );
}

assert.match(
  adminLogin,
  /formatAuthNetworkError\(error\)/,
  'admin login page should show useful network error details instead of a generic toast',
);

console.log('PASS web auth Turnstile UI guards');
