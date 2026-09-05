import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync('apps/web/src/components/auth/human-challenge.tsx', 'utf8');
const login = readFileSync('apps/web/src/app/(auth)/login/page-client.tsx', 'utf8');
const register = readFileSync('apps/web/src/app/(auth)/register/page-client.tsx', 'utf8');
const adminLogin = readFileSync('apps/web/src/app/(auth)/admin/login/page-client.tsx', 'utf8');

assert.match(
  component,
  /const TURNSTILE_RESPONSE_TIMEOUT_MS\s*=\s*8000/,
  'shared human challenge should fail Turnstile token waits quickly instead of leaving forms stuck for 30s',
);
assert.match(
  component,
  /getResponsePromise\(TURNSTILE_RESPONSE_TIMEOUT_MS\)/,
  'shared human challenge should wait for a Turnstile token with the bounded timeout',
);
assert.doesNotMatch(
  component,
  /getResponsePromise\(30000\)/,
  'shared human challenge should not wait 30s when Turnstile did not render a token',
);
assert.match(
  component,
  /setTurnstileRenderKey\(\(value\)\s*=>\s*value\s*\+\s*1\)/,
  'shared human challenge should remount Turnstile when the user clicks reload validation',
);
assert.match(
  component,
  /key=\{turnstileRenderKey\}/,
  'shared human challenge should pass the remount key to the Turnstile component',
);
assert.match(
  component,
  /refreshTimeout:\s*'manual'/,
  'shared human challenge should require explicit retry after timeout',
);

for (const [name, source] of [
  ['login', login],
  ['register', register],
]) {
  assert.match(source, /HumanChallenge/, `${name} page should use the shared human challenge component`);
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
assert.match(
  login,
  /challengeProvider !== 'disabled' && !challengeReady/,
  'login SMS sending must wait for the human challenge',
);

console.log('PASS web auth Turnstile UI guards');
