import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function read(relativePath) {
  const absolutePath = path.join(root, relativePath);
  return fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : '';
}

const terms = read('apps/web/src/app/terms/page.tsx');
const privacy = read('apps/web/src/app/privacy/page.tsx');
const register = read('apps/web/src/app/(auth)/register/page-client.tsx');
const setup = read('apps/web/src/app/(auth)/setup/page.tsx');
const login = read('apps/web/src/app/(auth)/login/page-client.tsx');

test('user agreement and privacy pages use deployment-aware legal identity', () => {
  assert.match(terms, /用户协议/);
  assert.match(terms, /operatorLegalName/);
  assert.match(terms, /termsVersion/);
  assert.match(terms, /第三方平台/);

  assert.match(privacy, /隐私政策/);
  assert.match(privacy, /dataHostingDescription/);
  assert.match(privacy, /crossBorderDescription/);
  assert.match(privacy, /privacyVersion/);
});

test('registration and first-admin setup require explicit legal consent', () => {
  assert.match(register, /legalAccepted/);
  assert.match(register, /href="\/terms"/);
  assert.match(register, /href="\/privacy"/);

  assert.match(setup, /legalAccepted/);
  assert.match(setup, /href="\/terms"/);
  assert.match(setup, /href="\/privacy"/);
});

test('login keeps legal documents available without requiring repeated consent', () => {
  assert.match(login, /href="\/terms"/);
  assert.match(login, /href="\/privacy"/);
  assert.doesNotMatch(login, /legalAccepted/);
});
