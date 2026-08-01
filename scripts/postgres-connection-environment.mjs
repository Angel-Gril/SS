const DATABASE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/u;
const PRISMA_ONLY_PARAMETERS = new Set([
  'connection_limit',
  'pool_timeout',
  'schema',
  'socket_timeout',
  'pgbouncer',
]);
const LIBPQ_PARAMETERS = new Map([
  ['application_name', 'PGAPPNAME'],
  ['channel_binding', 'PGCHANNELBINDING'],
  ['connect_timeout', 'PGCONNECT_TIMEOUT'],
  ['gssencmode', 'PGGSSENCMODE'],
  ['krbsrvname', 'PGKRBSRVNAME'],
  ['options', 'PGOPTIONS'],
  ['requirepeer', 'PGREQUIREPEER'],
  ['sslcert', 'PGSSLCERT'],
  ['sslcrl', 'PGSSLCRL'],
  ['sslkey', 'PGSSLKEY'],
  ['sslmode', 'PGSSLMODE'],
  ['sslpassword', 'PGSSLPASSWORD'],
  ['sslrootcert', 'PGSSLROOTCERT'],
  ['sslsni', 'PGSSLSNI'],
  ['target_session_attrs', 'PGTARGETSESSIONATTRS'],
]);

function fail(message) {
  throw new Error(message);
}

function decoded(value, field) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(`${field} is not canonically encoded`);
  }
}

function postgresSearchParameters(search) {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  if (/%(?![0-9a-f]{2})/iu.test(raw)) {
    fail('PostgreSQL URL parameter is not canonically encoded');
  }
  // libpq follows URI percent encoding and treats a literal plus as a plus.
  // URLSearchParams applies form encoding and would otherwise turn it into a space.
  return new URLSearchParams(raw.replaceAll('+', '%2B'));
}

export function postgresConnectionEnvironment(value, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('PostgreSQL URL must be valid');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !url.hostname
    || url.hash
    || !url.pathname
    || url.pathname === '/') {
    fail('PostgreSQL URL must identify one database');
  }

  const sourceDatabase = decoded(url.pathname.slice(1), 'PostgreSQL database name');
  const databaseName = options.databaseName || sourceDatabase;
  if (!DATABASE_NAME.test(sourceDatabase) || !DATABASE_NAME.test(databaseName)) {
    fail('PostgreSQL database name is outside the deployment contract');
  }
  const port = url.port || '5432';
  if (!/^[1-9][0-9]{0,4}$/u.test(port) || Number(port) > 65_535) {
    fail('PostgreSQL port is invalid');
  }

  const environment = {
    PATH: options.path || process.env.PATH || '',
    HOME: options.home || process.env.HOME || '',
    LANG: options.lang || 'C.UTF-8',
    PGHOST: url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname,
    PGPORT: port,
    PGDATABASE: databaseName,
  };
  const username = decoded(url.username, 'PostgreSQL username');
  const password = decoded(url.password, 'PostgreSQL password');
  if (username) environment.PGUSER = username;
  if (password) environment.PGPASSWORD = password;
  if (options.applicationName) environment.PGAPPNAME = options.applicationName;

  const seenParameters = new Set();
  for (const [name, parameterValue] of postgresSearchParameters(url.search).entries()) {
    if (seenParameters.has(name)) fail(`PostgreSQL URL parameter is duplicated: ${name}`);
    seenParameters.add(name);
    if (PRISMA_ONLY_PARAMETERS.has(name)) continue;
    const environmentName = LIBPQ_PARAMETERS.get(name);
    if (!environmentName) fail(`PostgreSQL URL parameter is unsupported: ${name}`);
    if (environmentName === 'PGAPPNAME' && options.applicationName) continue;
    environment[environmentName] = parameterValue;
  }
  return environment;
}
