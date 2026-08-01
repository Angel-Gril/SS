#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseExpectedReleaseOrigins } from './extension-release-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliArgs = process.argv.slice(2);
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

function readArchiveNoFollow(file) {
  let descriptor = null;
  try {
    descriptor = openSync(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new Error(`extension ZIP is missing: ${file}`);
    if (metadata.size > MAX_ARCHIVE_BYTES) {
      throw new Error('ZIP size is outside the extension archive limit');
    }
    return readFileSync(descriptor);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function option(name) {
  const index = cliArgs.indexOf(name);
  if (index < 0) return '';
  const value = cliArgs[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function canonicalVersion(value) {
  const match = String(value || '').match(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u);
  return Boolean(match && match.slice(1).map(Number).every(Number.isSafeInteger));
}

function assertRange(buffer, offset, length, label) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
    || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`${label} is outside the ZIP bounds`);
  }
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = buffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === buffer.length) return offset;
  }
  throw new Error('ZIP end-of-central-directory record is missing or malformed');
}

function safeArchiveName(name, expectedRoot) {
  if (!name || name.includes('\\') || name.startsWith('/')) {
    throw new Error(`unsafe ZIP entry name: ${JSON.stringify(name)}`);
  }
  if (name.normalize('NFC') !== name) {
    throw new Error(`ZIP entry name must use canonical NFC: ${JSON.stringify(name)}`);
  }
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe ZIP entry path: ${JSON.stringify(name)}`);
  }
  const hasInvalidCharacters = (value) => [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  }) || /[<>:"|?*]/u.test(value);
  const windowsReserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
  if (parts.some((part) => (
    hasInvalidCharacters(part)
    || /[. ]$/u.test(part)
    || windowsReserved.test(part)
  ))) {
    throw new Error(`unsafe ZIP entry segment: ${JSON.stringify(name)}`);
  }
  if (parts[0] !== expectedRoot || parts.length < 2) {
    throw new Error(`ZIP entry is outside ${expectedRoot}: ${JSON.stringify(name)}`);
  }
  return { parts, portableName: parts.map((part) => part.toLowerCase()).join('/') };
}

export function parseStoredZip(buffer, expectedRoot) {
  if (buffer.length < 22 || buffer.length > MAX_ARCHIVE_BYTES) {
    throw new Error('ZIP size is outside the extension archive limit');
  }
  const endOffset = findEndOfCentralDirectory(buffer);
  const disk = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const diskEntries = buffer.readUInt16LE(endOffset + 8);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error('multi-disk ZIP archives are not supported');
  }
  if (totalEntries < 1 || totalEntries > MAX_ENTRIES) {
    throw new Error('ZIP entry count is outside the extension archive limit');
  }
  if (centralOffset + centralSize !== endOffset) {
    throw new Error('ZIP central directory is not canonical');
  }
  assertRange(buffer, centralOffset, centralSize, 'ZIP central directory');

  const names = new Set();
  const portableNames = new Set();
  const entries = [];
  let cursor = centralOffset;
  let totalBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    assertRange(buffer, cursor, 46, 'ZIP central entry');
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('ZIP central entry signature is invalid');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const entryDisk = buffer.readUInt16LE(cursor + 34);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const centralEntryLength = 46 + nameLength + extraLength + commentLength;
    assertRange(buffer, cursor, centralEntryLength, 'ZIP central entry');
    if ((flags & ~0x0800) !== 0 || method !== 0 || compressedSize !== uncompressedSize) {
      throw new Error('extension ZIP entries must be unencrypted, stored, and size-stable');
    }
    if (entryDisk !== 0 || ((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      throw new Error('extension ZIP entries cannot use another disk or symbolic links');
    }
    if (uncompressedSize > MAX_ENTRY_BYTES || totalBytes + uncompressedSize > MAX_TOTAL_BYTES) {
      throw new Error('ZIP unpacked size is outside the extension archive limit');
    }
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(nameBytes)) {
      throw new Error('ZIP entry name is not canonical UTF-8');
    }
    const { parts, portableName } = safeArchiveName(name, expectedRoot);
    if (names.has(name)) throw new Error(`duplicate ZIP entry: ${name}`);
    if (portableNames.has(portableName)) throw new Error(`portable ZIP entry collision: ${name}`);
    names.add(name);
    portableNames.add(portableName);

    assertRange(buffer, localOffset, 30, 'ZIP local entry');
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`ZIP local entry signature is invalid: ${name}`);
    }
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const localHeaderLength = 30 + localNameLength + localExtraLength;
    assertRange(buffer, localOffset, localHeaderLength, 'ZIP local entry');
    const localName = buffer.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLength,
    );
    if (localFlags !== flags || localMethod !== method || localCrc !== expectedCrc
      || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize
      || !localName.equals(nameBytes)) {
      throw new Error(`ZIP central/local metadata mismatch: ${name}`);
    }
    const dataOffset = localOffset + localHeaderLength;
    assertRange(buffer, dataOffset, compressedSize, `ZIP entry data ${name}`);
    const data = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (crc32(data) !== expectedCrc) throw new Error(`ZIP CRC-32 mismatch: ${name}`);
    entries.push({ name, parts, data: Buffer.from(data), start: localOffset, end: dataOffset + compressedSize });
    totalBytes += uncompressedSize;
    cursor += centralEntryLength;
  }
  if (cursor !== centralOffset + centralSize) {
    throw new Error('ZIP central directory contains unparsed bytes');
  }
  const ordered = [...entries].sort((left, right) => left.start - right.start);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.start !== expectedOffset) throw new Error('ZIP contains unlisted or overlapping local data');
    expectedOffset = entry.end;
  }
  if (expectedOffset !== centralOffset) throw new Error('ZIP local data does not end at the central directory');
  return entries;
}

function listDirectoryFiles(root, relative = '') {
  const current = path.join(root, relative);
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...listDirectoryFiles(root, child));
    else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
  }
  return files;
}

function assertDirectoryMatches(root, entries) {
  const expected = new Map(entries.map((entry) => [entry.parts.slice(1).join('/'), entry.data]));
  const actualFiles = listDirectoryFiles(root);
  if (actualFiles.length !== expected.size) {
    throw new Error('ZIP file list does not match the verified build directory');
  }
  for (const relative of actualFiles) {
    const archived = expected.get(relative);
    if (!archived || !readFileSync(path.join(root, ...relative.split('/'))).equals(archived)) {
      throw new Error(`ZIP content differs from the verified build directory: ${relative}`);
    }
  }
}

function main() {
  const zipPath = path.resolve(option('--zip'));
  const target = option('--target');
  const version = option('--version');
  const expectedSha256 = option('--expected-sha256').toLowerCase();
  const sourceDirectoryValue = option('--dir');
  const rawExpectedOrigins = {
    web: option('--expected-web-origin'),
    admin: option('--expected-admin-origin'),
    api: option('--expected-api-origin'),
    local: option('--expected-local-origin'),
  };
  const hasAnyExpectedOrigin = Object.values(rawExpectedOrigins).some(Boolean);
  const expectedOrigins = hasAnyExpectedOrigin
    ? parseExpectedReleaseOrigins(rawExpectedOrigins, 'archive expected origins')
    : null;
  const expectedFileCountValue = option('--expected-file-count');
  const expectedFileCount = expectedFileCountValue ? Number(expectedFileCountValue) : null;
  if (!['cloud', 'local'].includes(target)) throw new Error('--target must be cloud or local');
  if (expectedFileCountValue
    && (!/^[1-9][0-9]{0,4}$/u.test(expectedFileCountValue)
      || !Number.isSafeInteger(expectedFileCount)
      || expectedFileCount > MAX_ENTRIES)) {
    throw new Error('--expected-file-count must be a canonical positive archive entry count');
  }
  if (version && !canonicalVersion(version)) throw new Error('--version must be canonical major.minor.patch');
  if (expectedSha256 && !/^[a-f0-9]{64}$/u.test(expectedSha256)) {
    throw new Error('--expected-sha256 must be 64 lowercase hexadecimal characters');
  }
  const archive = readArchiveNoFollow(zipPath);
  const sha256 = createHash('sha256').update(archive).digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(`extension ZIP SHA-256 mismatch: expected ${expectedSha256}, received ${sha256}`);
  }

  const rootName = `ss-erp-${target}`;
  const entries = parseStoredZip(archive, rootName);
  if (expectedFileCount !== null && entries.length !== expectedFileCount) {
    throw new Error(
      `extension ZIP entry count mismatch: expected ${expectedFileCount}, received ${entries.length}`,
    );
  }
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-extension-archive-'));
  try {
    for (const entry of entries) {
      const destination = path.join(tempRoot, ...entry.parts);
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, entry.data, { flag: 'wx', mode: 0o600 });
    }
    const extractedDirectory = path.join(tempRoot, rootName);
    if (sourceDirectoryValue) assertDirectoryMatches(path.resolve(sourceDirectoryValue), entries);
    const manifest = JSON.parse(readFileSync(path.join(extractedDirectory, 'manifest.json'), 'utf8'));
    if (version && manifest.version !== version) {
      throw new Error(`extension ZIP manifest version mismatch: expected ${version}, received ${manifest.version}`);
    }
    const targetLabel = target === 'cloud' ? '(Cloud)' : '(Local)';
    if (!String(manifest.name || '').includes(targetLabel)) {
      throw new Error(`extension ZIP manifest is not the ${target} package`);
    }
    const verifyArgs = [
      'scripts/verify-extension-package.mjs',
      '--dir',
      extractedDirectory,
      '--target',
      target,
    ];
    if (target === 'cloud') verifyArgs.push('--strict');
    if (expectedOrigins) {
      verifyArgs.push(
        '--expected-web-origin',
        expectedOrigins.web,
        '--expected-admin-origin',
        expectedOrigins.admin,
        '--expected-api-origin',
        expectedOrigins.api,
        '--expected-local-origin',
        expectedOrigins.local,
      );
    }
    const verification = spawnSync(process.execPath, verifyArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    });
    if (verification.status !== 0) throw new Error(`extracted ${target} package verification failed`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    target,
    version: version || null,
    zip: zipPath,
    bytes: archive.length,
    sha256,
    entries: entries.length,
    fileCount: entries.length,
  }, null, 2));
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
