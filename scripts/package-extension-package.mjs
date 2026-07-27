#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const target = process.argv[2] || process.env.EXTENSION_TARGET || 'cloud';
const outRoot = path.resolve(process.env.EXTENSION_OUT_DIR || 'build/extensions');

if (!['cloud', 'local'].includes(target)) {
  console.error('Usage: node scripts/package-extension-package.mjs <cloud|local>');
  process.exit(1);
}

const build = spawnSync(process.execPath, ['scripts/build-extension-package.mjs', target], {
  stdio: 'inherit',
  env: process.env,
});
if (build.status !== 0) process.exit(build.status || 1);

const dir = path.join(outRoot, `ss-erp-${target}`);
const verifyArgs = [
  'scripts/verify-extension-package.mjs',
  '--dir',
  dir,
  '--target',
  target,
];
if (target === 'cloud') verifyArgs.push('--strict');
const verification = spawnSync(process.execPath, verifyArgs, {
  stdio: 'inherit',
  env: process.env,
});
if (verification.status !== 0) process.exit(verification.status || 1);

const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const sourceVersion = manifest.version || '0.0.0';

function parseVersion(value) {
  const match = String(value || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: match[0],
  };
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

function nextPatchVersion(value) {
  return `${value.major}.${value.minor}.${value.patch + 1}`;
}

function readBuiltManifestVersion(root) {
  if (!root) return null;
  const manifestPath = path.join(root, `ss-erp-${target}`, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const builtManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return parseVersion(builtManifest.version);
  } catch {
    return null;
  }
}

function readZipVersions(root) {
  if (!root || !existsSync(root)) return [];
  const prefix = `ss-erp-${target}-`;
  const suffix = '.zip';
  return readdirSync(root)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .map((name) => parseVersion(name.slice(prefix.length, -suffix.length)))
    .filter(Boolean);
}

function resolvePackageVersion() {
  const source = parseVersion(sourceVersion) || parseVersion('0.0.0');
  const candidates = [
    source,
    readBuiltManifestVersion(outRoot),
    readBuiltManifestVersion(process.env.EXTENSION_PREVIOUS_BUILD_ROOT),
    ...readZipVersions(outRoot),
    ...readZipVersions(process.env.EXTENSION_PREVIOUS_BUILD_ROOT),
  ].filter(Boolean);
  const latest = candidates.reduce((max, current) => (compareVersions(current, max) > 0 ? current : max), source);
  return nextPatchVersion(latest);
}

const version = process.env.EXTENSION_AUTO_BUMP_VERSION === 'false'
  ? sourceVersion
  : resolvePackageVersion();
manifest.version = version;
writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const zipPath = path.join(outRoot, `ss-erp-${target}-${version}.zip`);

function listFiles(root, subdir = '') {
  const current = path.join(root, subdir);
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const relative = path.join(subdir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function u16(value) {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createZip(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const { date, time } = dosDateTime(entry.mtime);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(time), u16(date),
      u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name,
    ]);
    fileParts.push(local, entry.data);
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(time), u16(date),
      u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length + entry.data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...fileParts, central, end]);
}

const rootName = `ss-erp-${target}`;
const entries = listFiles(dir).map((relative) => {
  const absolute = path.join(dir, relative);
  return {
    name: `${rootName}/${relative.split(path.sep).join('/')}`,
    data: readFileSync(absolute),
    mtime: statSync(absolute).mtime,
  };
});

writeFileSync(zipPath, createZip(entries));
console.log(JSON.stringify({
  target,
  version,
  zip: zipPath,
  bytes: statSync(zipPath).size,
}, null, 2));
