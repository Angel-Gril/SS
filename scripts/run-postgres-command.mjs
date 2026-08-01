#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { postgresConnectionEnvironment } from './postgres-connection-environment.mjs';

const ALLOWED_COMMANDS = new Set(['createdb', 'dropdb', 'pg_dump', 'psql']);
const ALLOWED_URL_ENVIRONMENTS = new Set([
  'BACKUP_DB_URL',
  'DATABASE_URL',
  'SS_ERP_POSTGRES_URL',
  'VERIFY_RESTORE_MAINTENANCE_URL',
]);
const DATABASE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/u;
const CONNECTION_OPTIONS = [
  '-d', '--dbname',
  '-h', '--host',
  '-p', '--port',
  '-U', '--username',
  '--maintenance-db',
];
const OPTIONS_WITH_SEPARATE_VALUE = new Map([
  ['psql', new Set([
    '-c', '--command', '-f', '--file', '-L', '--log-file', '-o', '--output',
    '-P', '--pset', '-R', '--record-separator', '-F', '--field-separator',
    '-T', '--table-attr', '-v', '--set', '--variable',
  ])],
  ['pg_dump', new Set([
    '-F', '--format', '-f', '--file', '-j', '--jobs', '-n', '--schema',
    '-N', '--exclude-schema', '-t', '--table', '-T', '--exclude-table',
    '-Z', '--compress', '--exclude-table-and-children', '--exclude-table-data',
    '--exclude-table-data-and-children', '--filter', '--lock-wait-timeout',
  ])],
  ['createdb', new Set([
    '-D', '--tablespace', '-E', '--encoding', '-l', '--locale', '--locale-provider',
    '-O', '--owner', '-T', '--template', '--icu-locale', '--icu-rules',
    '--strategy',
  ])],
  ['dropdb', new Set([])],
]);

function fail(message) {
  throw new Error(message);
}

function matchesOption(value, option) {
  if (value === option) return true;
  if (option.startsWith('--')) return value.startsWith(`${option}=`);
  return value.startsWith(option) && value.length > option.length;
}

function validateCommandArguments(command, commandArguments) {
  const optionsWithValue = OPTIONS_WITH_SEPARATE_VALUE.get(command);
  let expectOptionValue = false;
  let separatorSeen = false;
  const positional = [];
  for (const value of commandArguments) {
    if (!value || value.length > 65_536 || /[\0\r\n]/u.test(value)) {
      fail('PostgreSQL command arguments must be bounded nonempty values');
    }
    if (expectOptionValue) {
      expectOptionValue = false;
      continue;
    }
    if (CONNECTION_OPTIONS.some((option) => matchesOption(value, option))) {
      fail('PostgreSQL connection target overrides are forbidden');
    }
    if (value === '--') {
      if (separatorSeen) fail('PostgreSQL command separator is duplicated');
      separatorSeen = true;
      continue;
    }
    if (!separatorSeen && value.startsWith('-')) {
      if (optionsWithValue.has(value)) expectOptionValue = true;
      continue;
    }
    positional.push(value);
  }
  if (expectOptionValue) fail('PostgreSQL command option is missing its value');
  if (command === 'createdb' || command === 'dropdb') {
    if (!separatorSeen || positional.length !== 1 || !DATABASE_NAME.test(positional[0])) {
      fail(`${command} requires one canonical database name after --`);
    }
  } else if (positional.length > 0) {
    fail('PostgreSQL positional connection targets are forbidden');
  }
}

function parseArguments() {
  const args = process.argv.slice(2);
  const separator = args.indexOf('--');
  const options = separator < 0 ? args : args.slice(0, separator);
  const commandArguments = separator < 0 ? [] : args.slice(separator + 1);
  const values = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const name = options[index];
    const value = options[index + 1];
    if (!['--url-env', '--database-name', '--command'].includes(name)
      || values.has(name) || !value || value.startsWith('--')) {
      fail('unknown or malformed PostgreSQL command option');
    }
    values.set(name, value);
  }
  if (!values.has('--url-env') || !values.has('--command')) {
    fail('--url-env and --command are required');
  }
  const urlEnvironment = values.get('--url-env');
  const command = values.get('--command');
  if (!ALLOWED_URL_ENVIRONMENTS.has(urlEnvironment)) fail('PostgreSQL URL environment is forbidden');
  if (!ALLOWED_COMMANDS.has(command)) fail('PostgreSQL command is forbidden');
  validateCommandArguments(command, commandArguments);
  return {
    command,
    commandArguments,
    databaseName: values.get('--database-name'),
    urlEnvironment,
  };
}

function main() {
  const input = parseArguments();
  const url = process.env[input.urlEnvironment];
  if (!url) fail(`${input.urlEnvironment} is required`);
  const result = spawnSync(input.command, input.commandArguments, {
    env: postgresConnectionEnvironment(url, {
      databaseName: input.databaseName,
      applicationName: 'ss-erp-deploy',
    }),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    fail(`PostgreSQL command failed: ${input.command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
