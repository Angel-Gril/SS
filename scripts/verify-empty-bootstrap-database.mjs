#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { postgresConnectionEnvironment } from './postgres-connection-environment.mjs';

function fail(message) {
  throw new Error(message);
}

function main() {
  if (process.argv.length !== 2) fail('bootstrap database verifier accepts no arguments');
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is required');
  const environment = postgresConnectionEnvironment(process.env.DATABASE_URL, {
    applicationName: 'ss-erp-empty-bootstrap-verifier',
  });
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--no-align',
    '--tuples-only',
    '--set=ON_ERROR_STOP=1',
    '--command=SELECT count(*)::text FROM pg_catalog.pg_tables WHERE schemaname NOT IN (\'pg_catalog\', \'information_schema\');',
  ], {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 65_536,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail('could not inspect the bootstrap database');
  }
  if (result.stdout.replace(/\r/gu, '') !== '0\n') {
    fail('bootstrap database is not empty');
  }
  console.log('PASS bootstrap database contains no user tables');
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
