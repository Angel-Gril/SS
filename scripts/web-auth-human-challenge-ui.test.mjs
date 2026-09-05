import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync('apps/web/src/components/auth/human-challenge.tsx', 'utf8');
const settings = readFileSync(
  'apps/web/src/app/(dashboard)/admin/settings/page-client.tsx',
  'utf8',
);

const pages = [
  ['login', 'apps/web/src/app/(auth)/login/page-client.tsx', 'login'],
  ['register', 'apps/web/src/app/(auth)/register/page-client.tsx', 'register_sms'],
  ['password reset', 'apps/web/src/app/(auth)/forgot-password/page.tsx', 'password_reset_sms'],
  ['admin login', 'apps/web/src/app/(auth)/admin/login/page-client.tsx', 'admin_login'],
];

assert.match(
  component,
  /crypto\.subtle\.digest\(['"]SHA-256['"]/,
  'built-in PoW must use Web Crypto SHA-256',
);
assert.match(
  component,
  /digestHex\.startsWith\('0'\.repeat\(difficulty\)\)/,
  'PoW difficulty must mean hexadecimal leading zero characters',
);
assert.match(
  component,
  /\/api\/auth\/human-challenge\?action=/,
  'PoW must request a purpose-bound challenge',
);
assert.match(
  component,
  /provider === 'cloudflare-turnstile'/,
  'component must preserve Cloudflare Turnstile',
);
assert.match(
  component,
  /provider === 'builtin-pow'/,
  'component must support the built-in PoW provider',
);
assert.match(
  component,
  /onError=\{\(errorCode\) => handleTurnstileFailure\('error', errorCode\)\}/,
  'Turnstile errors must expose the provider error code',
);
assert.match(
  component,
  /onTimeout=\{\(\) => handleTurnstileFailure\('timeout'\)\}/,
  'Turnstile timeouts must leave a recoverable error state',
);
assert.match(
  component,
  /retry: 'never'/,
  'failed Turnstile widgets must wait for an explicit user retry',
);
assert.match(
  component,
  /refreshTimeout: 'manual'/,
  'Turnstile timeout recovery must remain manual after the initial failure',
);
assert.match(component, /正在完成安全验证/, 'component must explain the calculation state');
assert.match(component, /重新验证/, 'component must offer a refresh path after expiry or failure');

for (const [name, file, action] of pages) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /HumanChallenge/, `${name} must use the shared human challenge component`);
  if (name === 'login') {
    assert.match(source, /challengeAction/, 'login must bind the challenge to its selected mode');
    assert.match(source, /'sms_login'/, 'login must use a purpose-bound SMS challenge');
  } else {
    assert.match(
      source,
      new RegExp(`action=["']${action}["']`),
      `${name} must bind its challenge to ${action}`,
    );
  }
  assert.match(source, /humanChallengeToken/, `${name} must submit the provider-neutral token`);
}

assert.match(
  settings,
  /auth_human_challenge_provider/,
  'admin settings must expose the human challenge provider',
);
assert.match(settings, /builtin-pow/, 'admin settings must offer the no-fee built-in PoW provider');
assert.match(
  settings,
  /cloudflare-turnstile/,
  'admin settings must preserve Turnstile as a provider',
);
assert.match(settings, /auth_pow_difficulty/, 'admin settings must expose PoW difficulty');
assert.match(settings, /auth_pow_ttl_seconds/, 'admin settings must expose PoW expiry');
assert.match(settings, /浏览器工作量证明/, 'admin settings must explain PoW in plain language');

const register = readFileSync('apps/web/src/app/(auth)/register/page-client.tsx', 'utf8');
assert.match(
  register,
  /challengeProvider !== 'disabled' && !challengeReady/,
  'register SMS sending must wait for the human challenge',
);

console.log('PASS web auth provider-neutral human challenge UI');
