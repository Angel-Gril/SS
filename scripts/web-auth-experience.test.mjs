import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
};

const login = read('apps/web/src/app/(auth)/login/page-client.tsx');
const register = read('apps/web/src/app/(auth)/register/page-client.tsx');
const setup = read('apps/web/src/app/(auth)/setup/page.tsx');
const forgotPassword = read('apps/web/src/app/(auth)/forgot-password/page.tsx');

test('login offers a session-safe seven-day option and password recovery', () => {
  assert.match(login, /rememberMe/);
  assert.match(login, /保持登录 7 天/);
  assert.match(login, /href="\/forgot-password"/);
  assert.match(login, /showPassword/);
  assert.match(login, /EyeOff/);
});

test('login exposes the guarded SMS mode and purpose-bound endpoints', () => {
  assert.match(login, /smsLoginEnabled/);
  assert.match(login, /sms-login-code/);
  assert.match(login, /sms-login/);
  assert.match(login, /action=\{challengeAction\}/);
  assert.match(login, /验证码登录/);
});

test('registration and setup passwords can be revealed without changing autocomplete semantics', () => {
  assert.match(register, /showPassword/);
  assert.match(register, /autoComplete="new-password"/);
  assert.match(setup, /showPassword/);
  assert.match(setup, /showConfirmPassword/);
});

test('forgot-password flow uses SMS, the shared human challenge and purpose-specific endpoints', () => {
  assert.match(forgotPassword, /找回密码/);
  assert.match(forgotPassword, /HumanChallenge/);
  assert.match(forgotPassword, /humanChallengeToken/);
  assert.match(forgotPassword, /password-reset\/sms-code/);
  assert.match(forgotPassword, /api\/auth\/password-reset/);
  assert.match(forgotPassword, /newPassword/);
  assert.match(forgotPassword, /confirmPassword/);
});

test('authentication pages use the short operator brand and warm product surface', () => {
  for (const page of [login, register, setup, forgotPassword]) {
    assert.match(page, /厦门常青藤上云/);
    assert.match(page, /bg-\[#fff7f0\]/);
    assert.doesNotMatch(page, /常青藤上云（厦门）网络科技有限公司/);
    assert.doesNotMatch(page, /from-blue-50/);
  }
});
