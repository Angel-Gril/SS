import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { canonicalExtensionReleaseEvidenceJson } from './extension-release-contract.mjs';
import {
  canonicalReleaseSignatureJson,
  canonicalTrustedKeyringJson,
  releaseSignaturePayload,
} from './extension-release-publication-contract.mjs';
import { parseStoredZip } from './verify-extension-archive.mjs';
import {
  canonicalCloudLogisticsFeature,
  LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT,
  verifyVpsExtensionRelease,
} from './verify-vps-extension-release.mjs';

const commit = 'a'.repeat(40);
const origins = {
  web: 'https://app.ss-erp.com',
  admin: 'https://admin.ss-erp.com',
  api: 'https://ss-erp.com',
  local: 'http://127.0.0.1:3001',
};

test('VPS release verification reads only each bounded opened-file snapshot', () => {
  const verifier = readFileSync('scripts/verify-vps-extension-release.mjs', 'utf8');
  assert.match(verifier, /Buffer\.allocUnsafe\(Number\(opened\.size\)\)/u);
  assert.match(
    verifier,
    /readSync\(descriptor, bytes, offset, bytes\.length - offset, offset\)/u,
  );
  assert.doesNotMatch(verifier, /readFileSync\(descriptor\)/u);
});

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

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), name,
    ]);
    localParts.push(local, entry.data);
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(entry.data.length), u32(entry.data.length), u16(name.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    offset += local.length + entry.data.length;
  }
  const central = Buffer.concat(centralParts);
  return Buffer.concat([
    ...localParts,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixture({
  cloudLogisticsEnabled = false,
  corruptCloudCrc = false,
  gitCommit = commit,
  markerTrailingNewline = true,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-vps-extension-release-'));
  const buildRoot = path.join(root, 'extensions');
  mkdirSync(buildRoot);
  const deployedCommitFile = path.join(root, 'DEPLOYED_COMMIT');
  writeFileSync(
    deployedCommitFile,
    `${gitCommit}${markerTrailingNewline ? '\n' : ''}`,
    { mode: 0o600 },
  );

  let cloudArchive = createStoredZip([{
    name: 'ss-erp-cloud/shared/logistics-rules/distribution-feature.js',
    data: canonicalCloudLogisticsFeature(cloudLogisticsEnabled),
  }]);
  if (corruptCloudCrc) {
    cloudArchive = Buffer.from(cloudArchive);
    const dataOffset = 30 + Buffer.byteLength(
      'ss-erp-cloud/shared/logistics-rules/distribution-feature.js',
    );
    cloudArchive[dataOffset] ^= 0x01;
  }
  const localArchive = createStoredZip([{
    name: 'ss-erp-local/manifest.json',
    data: Buffer.from('{"name":"fixture (Local)","version":"1.2.3"}\n', 'utf8'),
  }]);
  const evidence = {
    schemaVersion: 1,
    gitCommit,
    provenance: {
      commitSource: 'GIT_HEAD',
      sourceMode: 'REPOSITORY_SOURCE',
      packageInputsSha256: 'b'.repeat(64),
    },
    version: '1.2.3',
    expectedOrigins: origins,
    artifacts: {
      cloud: {
        target: 'cloud',
        filename: 'ss-erp-cloud-1.2.3.zip',
        zipSha256: sha256(cloudArchive),
        fileCount: 1,
      },
      local: {
        target: 'local',
        filename: 'ss-erp-local-1.2.3.zip',
        zipSha256: sha256(localArchive),
        fileCount: 1,
      },
    },
    checksumFilename: 'ss-erp-extension-1.2.3.sha256',
    signature: { status: 'EXTERNAL_REQUIRED' },
  };
  writeFileSync(
    path.join(buildRoot, 'ss-erp-extension-1.2.3.release-evidence.json'),
    canonicalExtensionReleaseEvidenceJson(evidence),
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(buildRoot, evidence.checksumFilename),
    `${evidence.artifacts.cloud.zipSha256}  ${evidence.artifacts.cloud.filename}\n`
      + `${evidence.artifacts.local.zipSha256}  ${evidence.artifacts.local.filename}\n`,
    { mode: 0o600 },
  );
  writeFileSync(path.join(buildRoot, evidence.artifacts.cloud.filename), cloudArchive, { mode: 0o600 });
  writeFileSync(path.join(buildRoot, evidence.artifacts.local.filename), localArchive, { mode: 0o600 });
  const evidenceBytes = Buffer.from(canonicalExtensionReleaseEvidenceJson(evidence), 'utf8');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyId = 'fixture-release-key';
  const signature = {
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_SIGNATURE',
    algorithm: 'Ed25519',
    keyId,
    signedAt: '2026-08-14T00:00:00.000Z',
    releaseEvidenceFilename: 'ss-erp-extension-1.2.3.release-evidence.json',
    releaseEvidenceSha256: sha256(evidenceBytes),
    signatureBase64: '',
  };
  signature.signatureBase64 = sign(
    null,
    releaseSignaturePayload({
      ...signature,
      signatureBase64: Buffer.alloc(64).toString('base64'),
    }, evidenceBytes),
    privateKey,
  ).toString('base64');
  const signatureBytes = Buffer.from(canonicalReleaseSignatureJson(signature), 'utf8');
  const signaturePath = path.join(root, 'ss-erp-extension-1.2.3.release-signature.json');
  writeFileSync(signaturePath, signatureBytes, { mode: 0o600 });
  const keyringPath = path.join(root, 'trusted-keys.json');
  writeFileSync(keyringPath, canonicalTrustedKeyringJson({
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [{
      algorithm: 'Ed25519',
      keyId,
      publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      status: 'ACTIVE',
    }],
  }), { mode: 0o600 });
  return {
    buildRoot,
    deployedCommitFile,
    expectedSignatureSha256: sha256(signatureBytes),
    keyringPath,
    root,
    signaturePath,
  };
}

function input(value, expectedCloudLogisticsEnabled = false) {
  return {
    buildRoot: value.buildRoot,
    deployedCommitFile: value.deployedCommitFile,
    expectedOrigins: origins,
    expectedCloudLogisticsEnabled,
    signaturePath: value.signaturePath,
    expectedSignatureSha256: value.expectedSignatureSha256,
    keyringPath: value.keyringPath,
  };
}

test('verifies the exact four-file candidate and canonical cloud logistics entry', () => {
  const value = fixture();
  let formalCalls = 0;
  try {
    const result = verifyVpsExtensionRelease(input(value), {
      formalVerify: ({ buildRoot, expectedOrigins }) => {
        formalCalls += 1;
        assert.equal(buildRoot, value.buildRoot);
        assert.deepEqual(expectedOrigins, origins);
      },
    });
    assert.equal(formalCalls, 1);
    assert.equal(result.gitCommit, commit);
    assert.equal(result.cloudLogisticsEnabled, false);
    assert.equal(result.signature.keyId, 'fixture-release-key');
    assert.equal(result.files.length, 4);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('keeps formal-verifier progress off the machine-readable JSON result', () => {
  const value = fixture();
  try {
    const script = `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      childProcess.spawnSync = (_command, _args, options) => {
        const output = options.stdio === 'inherit' || options.stdio[1] === 1
          ? process.stdout : process.stderr;
        output.write('formal verification progress\\n');
        return { status: 0, signal: null };
      };
      syncBuiltinESMExports();
      const { verifyVpsExtensionRelease } = await import('./scripts/verify-vps-extension-release.mjs');
      console.log(JSON.stringify(verifyVpsExtensionRelease(JSON.parse(process.argv[1]))));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(input(value))], {
      cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout), 'stdout must contain only the verifier JSON');
    assert.equal(JSON.parse(result.stdout).gitCommit, commit);
    assert.match(result.stderr, /formal verification progress/u);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('fixed legacy baseline skips only Ed25519 and still runs formal candidate verification', () => {
  const value = fixture({
    gitCommit: LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT,
    markerTrailingNewline: false,
  });
  const legacyInput = input(value);
  delete legacyInput.signaturePath;
  delete legacyInput.expectedSignatureSha256;
  delete legacyInput.keyringPath;
  let formalCalls = 0;
  let signatureCalls = 0;
  try {
    const result = verifyVpsExtensionRelease({
      ...legacyInput,
      legacyUnsignedBaseline: LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT,
    }, {
      signatureVerify: () => {
        signatureCalls += 1;
        assert.fail('legacy compatibility must not invoke Ed25519 verification');
      },
      formalVerify: () => {
        formalCalls += 1;
      },
    });
    assert.equal(signatureCalls, 0);
    assert.equal(formalCalls, 1);
    assert.equal(result.gitCommit, LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT);
    assert.equal(result.signature.status, 'LEGACY_UNSIGNED_FIXED_BASELINE');
    assert.equal(result.files.length, 4);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('seven-argument legacy CLI reaches formal verification without new signature flags', () => {
  const value = fixture({ gitCommit: LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT });
  try {
    const result = spawnSync(process.execPath, [
      path.join(process.cwd(), 'scripts', 'verify-vps-extension-release.mjs'),
      '--build-root', value.buildRoot,
      '--deployed-commit-file', value.deployedCommitFile,
      '--expected-web-origin', origins.web,
      '--expected-admin-origin', origins.admin,
      '--expected-api-origin', origins.api,
      '--expected-local-origin', origins.local,
      '--expected-cloud-logistics-enabled', 'false',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, 'the synthetic archive should reach and fail formal source verification');
    assert.match(output, /formal extension release verification failed/u);
    assert.doesNotMatch(
      output,
      /signature path is required|expected signature SHA-256 is invalid/u,
      'the legacy base CLI must not fall into signed verification',
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('legacy unsigned mode rejects every commit except the fixed deployed baseline', () => {
  const value = fixture();
  const legacyInput = input(value);
  delete legacyInput.signaturePath;
  delete legacyInput.expectedSignatureSha256;
  delete legacyInput.keyringPath;
  try {
    assert.throws(
      () => verifyVpsExtensionRelease({
        ...legacyInput,
        legacyUnsignedBaseline: LEGACY_UNSIGNED_EXTENSION_RELEASE_COMMIT,
      }, {
        signatureVerify: () => assert.fail(),
        formalVerify: () => assert.fail(),
      }),
      /fixed to the deployed compatibility baseline/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects a signature whose digest is not the operator-approved digest', () => {
  const value = fixture();
  try {
    assert.throws(
      () => verifyVpsExtensionRelease({
        ...input(value),
        expectedSignatureSha256: 'f'.repeat(64),
      }, { formalVerify: () => assert.fail() }),
      /signature SHA-256 does not match operator approval/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects a signature that does not verify against the trusted keyring', () => {
  const value = fixture();
  const signature = JSON.parse(readFileSync(value.signaturePath, 'utf8'));
  signature.signatureBase64 = Buffer.alloc(64, 1).toString('base64');
  const bytes = Buffer.from(canonicalReleaseSignatureJson(signature), 'utf8');
  writeFileSync(value.signaturePath, bytes);
  value.expectedSignatureSha256 = sha256(bytes);
  try {
    assert.throws(
      () => verifyVpsExtensionRelease(input(value), { formalVerify: () => assert.fail() }),
      /signature verification failed/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects a cloud logistics value that differs from the rollout expectation', () => {
  const value = fixture({ cloudLogisticsEnabled: true });
  try {
    assert.throws(
      () => verifyVpsExtensionRelease(input(value, false), { formalVerify: () => assert.fail() }),
      /cloud extension logistics feature does not match/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects extra candidate files before formal verification', () => {
  const value = fixture();
  writeFileSync(path.join(value.buildRoot, 'orphan.txt'), 'orphan\n');
  try {
    assert.throws(
      () => verifyVpsExtensionRelease(input(value), { formalVerify: () => assert.fail() }),
      /exactly four files/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('rejects a structurally invalid cloud ZIP even when evidence hashes its bytes', () => {
  const value = fixture({ corruptCloudCrc: true });
  try {
    assert.throws(
      () => verifyVpsExtensionRelease(input(value), { formalVerify: () => assert.fail() }),
      /ZIP CRC-32 mismatch/u,
    );
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('stored ZIP parser rejects portable entry collisions', () => {
  const archive = createStoredZip([
    { name: 'ss-erp-cloud/A.txt', data: Buffer.from('a') },
    { name: 'ss-erp-cloud/a.TXT', data: Buffer.from('b') },
  ]);
  assert.throws(() => parseStoredZip(archive, 'ss-erp-cloud'), /portable ZIP entry collision/u);
});
