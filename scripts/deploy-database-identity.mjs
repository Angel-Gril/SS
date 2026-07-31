#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DATABASE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/u;
const DATABASE_OID = /^[1-9][0-9]{0,9}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEPLOYMENT_DATABASE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const PRISMA_ONLY_PARAMETERS = [
  'connection_limit',
  'pool_timeout',
  'schema',
  'socket_timeout',
  'pgbouncer',
];

function fail(message) {
  throw new Error(message);
}

function databaseTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('DEPLOY_DATABASE_URL must be one valid PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || url.hash
    || !/^\/[A-Za-z0-9_.%~-]+$/u.test(url.pathname)) {
    fail('DEPLOY_DATABASE_URL must identify one canonical PostgreSQL database');
  }
  let databaseName;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail('DEPLOY_DATABASE_URL database name is not canonically encoded');
  }
  if (!DATABASE_NAME.test(databaseName)) {
    fail('DEPLOY_DATABASE_URL database name is outside the deployment identity contract');
  }
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    fail('DEPLOY_DATABASE_URL port is invalid');
  }
  const psqlUrl = new URL(url);
  psqlUrl.pathname = `/${encodeURIComponent(databaseName)}`;
  for (const parameter of PRISMA_ONLY_PARAMETERS) psqlUrl.searchParams.delete(parameter);
  return {
    databaseName,
    psqlUrl: psqlUrl.toString(),
  };
}

function queryDatabaseIdentity(target, expectedDatabaseId) {
  const environment = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    LANG: 'C.UTF-8',
    PGAPPNAME: 'ss-erp-deploy-backup-identity',
    PGDATABASE: target.psqlUrl,
  };
  const result = spawnSync('psql', [
    '--no-psqlrc',
    '--no-align',
    '--tuples-only',
    '--field-separator=\t',
    '--set=ON_ERROR_STOP=1',
    '--command=SELECT current_database(), database.oid::text, config.value FROM pg_database AS database CROSS JOIN public.system_configs AS config WHERE database.datname = current_database() AND config.key = \'deployment_database_identity_v1\';',
  ], {
    encoding: 'utf8',
    env: environment,
    maxBuffer: 65_536,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail('could not query the deployment database identity');
  }
  const lines = result.stdout.replace(/\r/gu, '').split('\n').filter(Boolean);
  if (lines.length !== 1) fail('deployment database identity query returned an invalid row count');
  const fields = lines[0].split('\t');
  if (fields.length !== 3 || !DATABASE_NAME.test(fields[0]) || !DATABASE_OID.test(fields[1])) {
    fail('deployment database identity query returned invalid fields');
  }
  let storedIdentity;
  try {
    storedIdentity = JSON.parse(fields[2]);
  } catch {
    fail('deployment database identity row must contain canonical identity JSON');
  }
  if (!storedIdentity || typeof storedIdentity !== 'object' || Array.isArray(storedIdentity)
    || Object.keys(storedIdentity).length !== 2
    || !Object.hasOwn(storedIdentity, 'databaseId')
    || !Object.hasOwn(storedIdentity, 'databaseUuid')
    || !DEPLOYMENT_DATABASE_ID.test(storedIdentity.databaseId)
    || !DATABASE_UUID.test(storedIdentity.databaseUuid)) {
    fail('deployment database identity row has invalid fields');
  }
  const canonicalStoredIdentity = JSON.stringify({
    databaseId: storedIdentity.databaseId,
    databaseUuid: storedIdentity.databaseUuid,
  });
  if (fields[2] !== canonicalStoredIdentity) {
    fail('deployment database identity row must contain canonical identity JSON');
  }
  if (storedIdentity.databaseId !== expectedDatabaseId) {
    fail('deployment database identity row does not match DEPLOY_DATABASE_ID');
  }
  if (fields[0] !== target.databaseName) {
    fail('DEPLOY_DATABASE_URL resolved to a different database name');
  }
  const oid = Number(fields[1]);
  if (!Number.isSafeInteger(oid) || oid > 4_294_967_295) {
    fail('deployment database OID is invalid');
  }
  return {
    databaseId: storedIdentity.databaseId,
    databaseName: fields[0],
    databaseOid: oid,
    databaseUuid: storedIdentity.databaseUuid,
  };
}

function main() {
  const mode = process.argv[2] || 'digest';
  if (process.argv.length > 3 || !['digest', '--backup-binding'].includes(mode)) {
    fail('deploy database identity accepts only the optional --backup-binding mode');
  }
  const value = process.env.DEPLOY_DATABASE_URL;
  if (!value) fail('DEPLOY_DATABASE_URL is required');
  const expectedDatabaseId = process.env.DEPLOY_DATABASE_ID;
  if (!expectedDatabaseId || !DEPLOYMENT_DATABASE_ID.test(expectedDatabaseId)) {
    fail('DEPLOY_DATABASE_ID is required and must be canonical');
  }
  const target = databaseTarget(value);
  const actual = queryDatabaseIdentity(target, expectedDatabaseId);
  const identity = {
    schemaVersion: 1,
    databaseId: actual.databaseId,
    databaseName: actual.databaseName,
    databaseOid: actual.databaseOid,
    databaseUuid: actual.databaseUuid,
  };
  const identitySha256 = createHash('sha256')
    .update(`${JSON.stringify(identity)}\n`, 'utf8')
    .digest('hex');
  if (mode === '--backup-binding') {
    const databaseUuidSha256 = createHash('sha256')
      .update(`${actual.databaseUuid}\n`, 'utf8')
      .digest('hex');
    process.stdout.write(`${identitySha256}\t${databaseUuidSha256}\n`);
    return;
  }
  process.stdout.write(`${identitySha256}\n`);
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
