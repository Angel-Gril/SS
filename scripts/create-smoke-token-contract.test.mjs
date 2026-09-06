import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  persistSmokeAccountSession,
  signSmokeAccountToken,
} from '../apps/server/scripts/create-smoke-token.mjs';

const requireFromServer = createRequire(pathToFileURL(path.resolve('apps/server/package.json')));
const jwt = requireFromServer('jsonwebtoken');
const environment = {
  JWT_SECRET: 'smoke-token-contract-secret-value',
  SS_ERP_DEPLOYMENT_ID: 'contract-deployment',
  AUTH_JWT_ISSUER: 'contract-issuer',
};

test('smoke helper signs a bounded typed account session accepted by production verifyToken', () => {
  const token = signSmokeAccountToken({
    userId: 'user-1',
    role: 'ADMIN',
    authVersion: 7,
    ttlSeconds: 600,
  }, environment);
  const claims = jwt.verify(token, environment.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: environment.AUTH_JWT_ISSUER,
    audience: `ss-erp-account:${environment.SS_ERP_DEPLOYMENT_ID}`,
  });

  assert.equal(claims.userId, 'user-1');
  assert.equal(claims.role, 'ADMIN');
  assert.equal(claims.authVersion, 7);
  assert.equal(claims.typ, 'account');
  assert.equal(claims.tokenUse, 'account_session');
  assert.equal(claims.deploymentId, environment.SS_ERP_DEPLOYMENT_ID);
  assert.equal(claims.exp - claims.iat, 600);

  const program = [
    "import { verifyToken } from './apps/server/src/lib/auth.ts';",
    'const claims = verifyToken(process.env.SMOKE_CONTRACT_TOKEN);',
    "process.stdout.write(JSON.stringify({ userId: claims.userId, role: claims.role, authVersion: claims.authVersion, tokenUse: claims.tokenUse }));",
    'process.exit(0);',
  ].join('\n');
  const verified = spawnSync(
    process.execPath,
    [path.resolve('apps/server/node_modules/tsx/dist/cli.mjs'), '--eval', program],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        ...environment,
        NODE_ENV: 'production',
        EXTENSION_AUTH_MODE: 'device-only',
        SMOKE_CONTRACT_TOKEN: token,
      },
    },
  );
  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(JSON.parse(verified.stdout), {
    userId: 'user-1',
    role: 'ADMIN',
    authVersion: 7,
    tokenUse: 'account_session',
  });
});

test('smoke helper rejects weak secrets, stale authority, invalid roles, and excessive TTLs', () => {
  const valid = { userId: 'user-1', role: 'USER', authVersion: 0, ttlSeconds: 600 };
  assert.throws(() => signSmokeAccountToken(valid, { ...environment, JWT_SECRET: 'short' }), /16 characters/u);
  assert.throws(() => signSmokeAccountToken({ ...valid, authVersion: -1 }, environment), /input is invalid/u);
  assert.throws(() => signSmokeAccountToken({ ...valid, role: 'OWNER' }, environment), /input is invalid/u);
  assert.throws(() => signSmokeAccountToken({ ...valid, ttlSeconds: 604_801 }, environment), /input is invalid/u);
});

test('smoke helper persists the exact account session key and fails closed on Redis rejection', async () => {
  const token = 'a'.repeat(40) + 'deadbeef';
  const calls = [];
  const key = await persistSmokeAccountSession({
    async set(...args) {
      calls.push(args);
      return 'OK';
    },
  }, { userId: 'user-1', token, ttlSeconds: 600 });

  assert.equal(key, 'session:user-1:deadbeef');
  assert.deepEqual(calls, [['session:user-1:deadbeef', '1', 'EX', 600]]);
  await assert.rejects(
    persistSmokeAccountSession({ async set() { return null; } }, {
      userId: 'user-1', token, ttlSeconds: 600,
    }),
    /was not persisted/u,
  );
});
