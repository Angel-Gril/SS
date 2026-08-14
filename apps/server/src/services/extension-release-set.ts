import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

const RELEASE_EVIDENCE_PATTERN =
  /^ss-erp-extension-((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\.release-evidence\.json$/u;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_EVIDENCE_BYTES = 65_536;
const MAX_CHECKSUM_BYTES = 4096;
const MAX_EXTENSION_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_EXTENSION_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_RELEASE_EVIDENCE_FILES = 256;
const EXTENSION_RELEASE_LOCAL_ORIGIN = 'http://127.0.0.1:3001';
const PUBLIC_HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;

export type VerifiedExtensionTarget = 'cloud' | 'local';

interface ReleaseArtifactEvidence {
  target: VerifiedExtensionTarget;
  filename: string;
  zipSha256: string;
  fileCount: number;
}

interface ReleaseEvidence {
  schemaVersion: 1;
  gitCommit: string;
  provenance: {
    commitSource: 'DEPLOYED_COMMIT' | 'GIT_HEAD';
    sourceMode: 'REPOSITORY_SOURCE' | 'EXTERNAL_SOURCE';
    packageInputsSha256: string;
  };
  version: string;
  expectedOrigins: {
    web: string;
    admin: string;
    api: string;
    local: typeof EXTENSION_RELEASE_LOCAL_ORIGIN;
  };
  artifacts: Record<VerifiedExtensionTarget, ReleaseArtifactEvidence>;
  checksumFilename: string;
  signature: { status: 'EXTERNAL_REQUIRED' };
}

export interface VerifiedExtensionReleaseArtifact extends ReleaseArtifactEvidence {
  filePath: string;
  byteLength: number;
}

export interface VerifiedExtensionReleaseSet {
  version: string;
  gitCommit: string;
  signatureStatus: 'EXTERNAL_REQUIRED';
  expectedOrigins: ReleaseEvidence['expectedOrigins'];
  releaseEvidenceFilename: string;
  releaseEvidenceSha256: string;
  artifacts: Record<VerifiedExtensionTarget, VerifiedExtensionReleaseArtifact>;
}

interface ParsedEvidenceFile {
  evidence: ReleaseEvidence;
  filenameVersion: string;
  bytes: Buffer;
  filename: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  const parsed = value as Record<string, unknown>;
  const actual = Object.keys(parsed).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${field} has an invalid field set`);
  }
  return parsed;
}

function canonicalVersion(value: unknown, field: string) {
  const version = typeof value === 'string' ? value : '';
  if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(version)) {
    fail(`${field} must be a canonical version`);
  }
  return version;
}

function sha256Digest(value: unknown, field: string) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${field} must be a SHA-256 digest`);
  }
  return value;
}

function isPrivateIpv4(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return false;
  const parts = hostname.split('.').map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [first = -1, second = -1] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19 || second === 51))
    || (first === 203 && second === 0)
    || first >= 224;
}

function publicHttpsOrigin(value: unknown, field: string) {
  if (typeof value !== 'string'
    || value !== value.trim()
    || value.length > 2048
    || value.includes('\\')) {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  const hostname = parsed.hostname.toLowerCase();
  const publicHostname = hostname
    && !hostname.endsWith('.')
    && hostname !== 'localhost'
    && !hostname.endsWith('.localhost')
    && hostname !== 'metadata'
    && hostname !== 'metadata.google.internal'
    && !hostname.endsWith('.metadata.google.internal')
    && hostname !== 'instance-data'
    && !hostname.endsWith('.instance-data')
    && !hostname.endsWith('.internal')
    && !hostname.endsWith('.local')
    && !hostname.endsWith('.home.arpa')
    && !hostname.includes(':')
    && hostname.includes('.')
    && !isPrivateIpv4(hostname)
    && (PUBLIC_HOSTNAME_PATTERN.test(hostname)
      || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname));
  if (parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '/' && parsed.pathname !== '')
    || parsed.origin !== value
    || parsed.origin === 'null'
    || !publicHostname) {
    fail(`${field} must be a canonical public HTTPS origin`);
  }
  return value;
}

function localReleaseOrigin(
  value: unknown,
): typeof EXTENSION_RELEASE_LOCAL_ORIGIN {
  if (value !== EXTENSION_RELEASE_LOCAL_ORIGIN) {
    fail(`release evidence local origin must be exactly ${EXTENSION_RELEASE_LOCAL_ORIGIN}`);
  }
  return EXTENSION_RELEASE_LOCAL_ORIGIN;
}

function parseArtifact(value: unknown, target: VerifiedExtensionTarget, version: string) {
  const parsed = exactObject(
    value,
    ['fileCount', 'filename', 'target', 'zipSha256'],
    `release evidence ${target} artifact`,
  );
  const filename = `ss-erp-${target}-${version}.zip`;
  if (parsed.target !== target || parsed.filename !== filename) {
    fail(`release evidence ${target} artifact identity is invalid`);
  }
  if (!Number.isSafeInteger(parsed.fileCount)
    || (parsed.fileCount as number) < 1
    || (parsed.fileCount as number) > 10_000) {
    fail(`release evidence ${target} file count is invalid`);
  }
  return {
    target,
    filename,
    zipSha256: sha256Digest(parsed.zipSha256, `release evidence ${target} zipSha256`),
    fileCount: parsed.fileCount as number,
  } satisfies ReleaseArtifactEvidence;
}

function parseReleaseEvidence(value: unknown): ReleaseEvidence {
  const parsed = exactObject(value, [
    'artifacts',
    'checksumFilename',
    'expectedOrigins',
    'gitCommit',
    'provenance',
    'schemaVersion',
    'signature',
    'version',
  ], 'release evidence');
  if (parsed.schemaVersion !== 1) fail('release evidence schemaVersion must be 1');
  const gitCommit = typeof parsed.gitCommit === 'string' ? parsed.gitCommit : '';
  if (!GIT_COMMIT_PATTERN.test(gitCommit)) fail('release evidence Git commit is invalid');
  const version = canonicalVersion(parsed.version, 'release evidence version');

  const provenance = exactObject(
    parsed.provenance,
    ['commitSource', 'packageInputsSha256', 'sourceMode'],
    'release evidence provenance',
  );
  if (!['DEPLOYED_COMMIT', 'GIT_HEAD'].includes(String(provenance.commitSource))) {
    fail('release evidence commit source is invalid');
  }
  if (!['REPOSITORY_SOURCE', 'EXTERNAL_SOURCE'].includes(String(provenance.sourceMode))) {
    fail('release evidence source mode is invalid');
  }

  const origins = exactObject(
    parsed.expectedOrigins,
    ['admin', 'api', 'local', 'web'],
    'release evidence expected origins',
  );
  const artifacts = exactObject(parsed.artifacts, ['cloud', 'local'], 'release evidence artifacts');
  const signature = exactObject(parsed.signature, ['status'], 'release evidence signature');
  if (signature.status !== 'EXTERNAL_REQUIRED') {
    fail('release evidence signature status is invalid');
  }
  const checksumFilename = `ss-erp-extension-${version}.sha256`;
  if (parsed.checksumFilename !== checksumFilename) {
    fail('release evidence checksum filename is invalid');
  }

  return {
    schemaVersion: 1,
    gitCommit,
    provenance: {
      commitSource: provenance.commitSource as 'DEPLOYED_COMMIT' | 'GIT_HEAD',
      sourceMode: provenance.sourceMode as 'REPOSITORY_SOURCE' | 'EXTERNAL_SOURCE',
      packageInputsSha256: sha256Digest(
        provenance.packageInputsSha256,
        'release evidence packageInputsSha256',
      ),
    },
    version,
    expectedOrigins: {
      web: publicHttpsOrigin(origins.web, 'release evidence Web origin'),
      admin: publicHttpsOrigin(origins.admin, 'release evidence Admin origin'),
      api: publicHttpsOrigin(origins.api, 'release evidence API origin'),
      local: localReleaseOrigin(origins.local),
    },
    artifacts: {
      cloud: parseArtifact(artifacts.cloud, 'cloud', version),
      local: parseArtifact(artifacts.local, 'local', version),
    },
    checksumFilename,
    signature: { status: 'EXTERNAL_REQUIRED' },
  };
}

async function readBoundedRegularFile(file: string, maxBytes: number, field: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    fail(`${field} is missing, unsafe, or too large`);
  }
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maxBytes) {
      fail(`${field} is missing, unsafe, or too large`);
    }
    const buffer = Buffer.allocUnsafe(fileStat.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead !== fileStat.size) {
      fail(`${field} changed while it was being read`);
    }
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function inspectBoundedRegularFile(file: string, maxBytes: number, field: string) {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    fail(`${field} is missing, unsafe, or too large`);
  }
  try {
    const fileStat = await handle.stat();
    if (!fileStat.isFile() || fileStat.size <= 0 || fileStat.size > maxBytes) {
      fail(`${field} is missing, unsafe, or too large`);
    }
    return fileStat.size;
  } finally {
    await handle.close();
  }
}

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertZipRange(bytes: Buffer, offset: number, length: number, field: string) {
  if (!Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > bytes.length) {
    fail(`${field} is outside the extension ZIP bounds`);
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

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertExtensionZipStructure(
  bytes: Buffer,
  target: VerifiedExtensionTarget,
  expectedFileCount: number,
  expectedVersion: string,
) {
  let endOffset = -1;
  const minimumOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === bytes.length) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) fail(`${target} extension ZIP end record is invalid`);
  const disk = bytes.readUInt16LE(endOffset + 4);
  const centralDisk = bytes.readUInt16LE(endOffset + 6);
  const diskEntries = bytes.readUInt16LE(endOffset + 8);
  const totalEntries = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (disk !== 0
    || centralDisk !== 0
    || diskEntries !== totalEntries
    || totalEntries !== expectedFileCount
    || centralOffset + centralSize !== endOffset) {
    fail(`${target} extension ZIP central directory is invalid`);
  }

  const expectedRoot = `ss-erp-${target}`;
  const names = new Set<string>();
  const portableNames = new Set<string>();
  const localRanges: Array<{ start: number; end: number }> = [];
  let manifestBytes: Buffer | null = null;
  let cursor = centralOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    assertZipRange(bytes, cursor, 46, `${target} extension ZIP central entry`);
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) {
      fail(`${target} extension ZIP central entry is invalid`);
    }
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const entryDisk = bytes.readUInt16LE(cursor + 34);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const centralLength = 46 + nameLength + extraLength + commentLength;
    assertZipRange(bytes, cursor, centralLength, `${target} extension ZIP central entry`);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    const parts = name.split('/');
    const portableName = parts.map((part) => part.toLowerCase()).join('/');
    const hasInvalidCharacters = parts.some((part) => [...part].some((character) => {
      const codePoint = character.codePointAt(0) || 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    }) || /[<>:"|?*]/u.test(part));
    const hasReservedSegment = parts.some((part) => (
      /[. ]$/u.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
    ));
    if (!Buffer.from(name, 'utf8').equals(nameBytes)
      || names.has(name)
      || portableNames.has(portableName)
      || !name.startsWith(`${expectedRoot}/`)
      || name.normalize('NFC') !== name
      || name.includes('\\')
      || parts.some((part) => !part || part === '.' || part === '..')
      || hasInvalidCharacters
      || hasReservedSegment
      || (flags & ~0x0800) !== 0
      || method !== 0
      || compressedSize !== uncompressedSize
      || entryDisk !== 0
      || ((externalAttributes >>> 16) & 0o170000) === 0o120000
      || uncompressedSize > MAX_EXTENSION_ZIP_ENTRY_BYTES
      || totalUncompressedBytes + uncompressedSize > MAX_EXTENSION_ZIP_BYTES) {
      fail(`${target} extension ZIP entry name is invalid`);
    }
    names.add(name);
    portableNames.add(portableName);
    totalUncompressedBytes += uncompressedSize;
    assertZipRange(bytes, localOffset, 30, `${target} extension ZIP local entry`);
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      fail(`${target} extension ZIP local entry is invalid`);
    }
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localCrc = bytes.readUInt32LE(localOffset + 14);
    const localCompressedSize = bytes.readUInt32LE(localOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLength,
    );
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assertZipRange(bytes, dataOffset, localCompressedSize, `${target} extension ZIP entry data`);
    const data = bytes.subarray(dataOffset, dataOffset + localCompressedSize);
    if (localFlags !== flags
      || localMethod !== method
      || localCrc !== expectedCrc
      || localCompressedSize !== compressedSize
      || localUncompressedSize !== uncompressedSize
      || !localName.equals(nameBytes)
      || crc32(data) !== expectedCrc) {
      fail(`${target} extension ZIP local entry does not match its central entry`);
    }
    localRanges.push({ start: localOffset, end: dataOffset + localCompressedSize });
    if (name === `${expectedRoot}/manifest.json`) {
      manifestBytes = data;
    }
    cursor += centralLength;
  }
  localRanges.sort((left, right) => left.start - right.start);
  let expectedLocalOffset = 0;
  for (const range of localRanges) {
    if (range.start !== expectedLocalOffset) {
      fail(`${target} extension ZIP contains unlisted or overlapping local data`);
    }
    expectedLocalOffset = range.end;
  }
  if (cursor !== endOffset || expectedLocalOffset !== centralOffset || !manifestBytes) {
    fail(`${target} extension ZIP file set is invalid`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    fail(`${target} extension ZIP manifest is invalid`);
  }
  if (!manifest
    || typeof manifest !== 'object'
    || Array.isArray(manifest)
    || (manifest as Record<string, unknown>).manifest_version !== 3
    || (manifest as Record<string, unknown>).version !== expectedVersion
    || !String((manifest as Record<string, unknown>).name || '')
      .includes(target === 'cloud' ? '(Cloud)' : '(Local)')) {
    fail(`${target} extension ZIP manifest does not match release evidence`);
  }
}

async function deployedCommitFrom(file: string | undefined, required: boolean) {
  if (!file) {
    if (required) fail('DEPLOYED_COMMIT is required for extension release downloads');
    return null;
  }
  try {
    const bytes = await readBoundedRegularFile(file, 128, 'DEPLOYED_COMMIT');
    const match = bytes.toString('utf8').match(/^([a-f0-9]{40})\n?$/u);
    if (!match) fail('DEPLOYED_COMMIT is invalid');
    return match[1]!;
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index]! > rightParts[index]!) return 1;
    if (leftParts[index]! < rightParts[index]!) return -1;
  }
  return 0;
}

async function readEvidenceFile(buildRoot: string, filename: string): Promise<ParsedEvidenceFile> {
  const filenameVersion = filename.match(RELEASE_EVIDENCE_PATTERN)?.[1];
  if (!filenameVersion) fail('extension release evidence filename is invalid');
  const evidenceBytes = await readBoundedRegularFile(
    path.join(buildRoot, filename),
    MAX_EVIDENCE_BYTES,
    'extension release evidence',
  );
  const evidenceText = evidenceBytes.toString('utf8');
  if (evidenceText.charCodeAt(0) === 0xfeff || evidenceText.includes('\r')) {
    fail('extension release evidence is not canonical UTF-8');
  }
  let rawEvidence: unknown;
  try {
    rawEvidence = JSON.parse(evidenceText);
  } catch {
    fail('extension release evidence is not valid JSON');
  }
  const evidence = parseReleaseEvidence(rawEvidence);
  if (evidence.version !== filenameVersion
    || evidenceText !== `${JSON.stringify(evidence, null, 2)}\n`) {
    fail('extension release evidence is not canonical');
  }
  return { evidence, filenameVersion, bytes: evidenceBytes, filename };
}

export async function loadVerifiedExtensionReleaseSet(input: {
  buildRoot: string;
  deployedCommitPath?: string;
  requireDeployedCommit?: boolean;
  allowExternalSource?: boolean;
  expectedEvidenceFilename?: string;
  requireExactFiles?: boolean;
}): Promise<VerifiedExtensionReleaseSet> {
  if (input.expectedEvidenceFilename
    && !RELEASE_EVIDENCE_PATTERN.test(input.expectedEvidenceFilename)) {
    fail('expected extension release evidence filename is invalid');
  }
  const entries = await readdir(input.buildRoot, { withFileTypes: true });
  const evidenceEntries = entries.filter(
    (entry) => entry.isFile() && RELEASE_EVIDENCE_PATTERN.test(entry.name),
  );
  if (evidenceEntries.length < 1) {
    fail('extension release directory does not contain canonical evidence');
  }
  if (evidenceEntries.length > MAX_RELEASE_EVIDENCE_FILES) {
    fail('extension release directory contains too many evidence candidates');
  }

  const deployedCommit = await deployedCommitFrom(
    input.deployedCommitPath,
    input.requireDeployedCommit === true,
  );
  const parsedEvidence = [];
  for (const entry of evidenceEntries) {
    parsedEvidence.push(await readEvidenceFile(input.buildRoot, entry.name));
  }
  const matchingEvidence = parsedEvidence.filter(({ evidence }) => (
    (!deployedCommit || evidence.gitCommit === deployedCommit)
    && (!input.expectedEvidenceFilename
      || `ss-erp-extension-${evidence.version}.release-evidence.json`
        === input.expectedEvidenceFilename)
  ));
  if (matchingEvidence.length < 1) {
    fail('extension release evidence does not match DEPLOYED_COMMIT');
  }
  matchingEvidence.sort((left, right) => compareVersions(right.filenameVersion, left.filenameVersion));
  const selectedEvidence = matchingEvidence[0]!;
  const evidence = selectedEvidence.evidence;
  if (evidence.provenance.sourceMode !== 'REPOSITORY_SOURCE'
    && input.allowExternalSource !== true) {
    fail('formal extension release evidence must use repository source');
  }

  const checksumBytes = await readBoundedRegularFile(
    path.join(input.buildRoot, evidence.checksumFilename),
    MAX_CHECKSUM_BYTES,
    'extension release checksum',
  );
  const expectedChecksum = (['cloud', 'local'] as const)
    .map((target) => {
      const artifact = evidence.artifacts[target];
      return `${artifact.zipSha256}  ${artifact.filename}`;
    })
    .join('\n') + '\n';
  if (checksumBytes.toString('utf8') !== expectedChecksum) {
    fail('extension release checksum does not match evidence');
  }

  const artifacts = {} as Record<VerifiedExtensionTarget, VerifiedExtensionReleaseArtifact>;
  for (const target of ['cloud', 'local'] as const) {
    const artifact = evidence.artifacts[target];
    const filePath = path.join(input.buildRoot, artifact.filename);
    const byteLength = await inspectBoundedRegularFile(
      filePath,
      MAX_EXTENSION_ZIP_BYTES,
      `${target} extension ZIP`,
    );
    artifacts[target] = { ...artifact, filePath, byteLength };
  }

  if (input.requireExactFiles === true) {
    const expectedFiles = [
      selectedEvidence.filename,
      evidence.checksumFilename,
      evidence.artifacts.cloud.filename,
      evidence.artifacts.local.filename,
    ].sort();
    const actualFiles = entries.map((entry) => entry.name).sort();
    if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)
      || entries.some((entry) => !entry.isFile())) {
      fail('extension release directory must contain exactly one canonical four-file release');
    }
  }

  return {
    version: evidence.version,
    gitCommit: evidence.gitCommit,
    signatureStatus: evidence.signature.status,
    expectedOrigins: evidence.expectedOrigins,
    releaseEvidenceFilename: selectedEvidence.filename,
    releaseEvidenceSha256: digest(selectedEvidence.bytes),
    artifacts,
  };
}

export async function readVerifiedExtensionReleaseArtifact(
  release: VerifiedExtensionReleaseSet,
  target: VerifiedExtensionTarget,
) {
  const artifact = release.artifacts[target];
  const bytes = await readBoundedRegularFile(
    artifact.filePath,
    MAX_EXTENSION_ZIP_BYTES,
    `${target} extension ZIP`,
  );
  if (bytes.length !== artifact.byteLength
    || bytes.length < 4
    || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    || digest(bytes) !== artifact.zipSha256) {
    fail(`${target} extension ZIP does not match release evidence`);
  }
  assertExtensionZipStructure(bytes, target, artifact.fileCount, release.version);
  return bytes;
}
