import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const api = fs.readFileSync('apps/web/src/lib/api.ts', 'utf8');
const layout = fs.readFileSync('apps/web/src/app/(dashboard)/layout.tsx', 'utf8');
const login = fs.readFileSync('apps/web/src/app/(auth)/login/page-client.tsx', 'utf8');

const result = spawnSync(process.execPath, [
  'apps/server/node_modules/tsx/dist/cli.mjs',
  'apps/web/scripts/auth-return-to-contract.ts',
], { encoding: 'utf8' });
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
assert.match(result.stdout, /PASS Web login returnTo contract/u);

assert.match(api, /normalizeLoginReturnTo\(`\$\{path\}\$\{window\.location\.search\}`\)/u);
assert.match(api, /\/login\?returnTo=\$\{encodeURIComponent\(returnTo\)\}/u);
assert.match(layout, /normalizeLoginReturnTo\(`\$\{pathname\}\$\{search\}`\)/u);
assert.match(layout, /getLoginPath\(pathname, window\.location\.search\)/u);
assert.doesNotMatch(layout, /useSearchParams/u);
assert.match(login, /normalizeLoginReturnTo\(searchParams\.get\('returnTo'\)\)/u);
assert.match(login, /router\.push\(returnTo \|\| '\/orders'\)/u);

console.log('PASS Web listing-log login recovery contract');
