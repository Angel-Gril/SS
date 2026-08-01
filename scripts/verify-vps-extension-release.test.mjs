import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalExtensionReleaseEvidenceJson } from './extension-release-contract.mjs';
import { parseStoredZip } from './verify-extension-archive.mjs';
import {
  canonicalCloudLogisticsFeature,
  verifyVpsExtensionRelease,
} from './verify-vps-extension-release.mjs';

const commit = 'a'.repeat(40);
const origins = {
  web: 'https://app.ss-erp.com',
  admin: 'https://admin.ss-erp.com',
  api: 'https://ss-erp.com',
  local: 'http://127.0.0.1:3001',
};

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

function fixture({ cloudLogisticsEnabled = false, corruptCloudCrc = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ss-erp-vps-extension-release-'));
  const buildRoot = path.join(root, 'extensions');
  mkdirSync(buildRoot);
  const deployedCommitFile = path.join(root, 'DEPLOYED_COMMIT');
  writeFileSync(deployedCommitFile, `${commit}\n`, { mode: 0o600 });

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
    gitCommit: commit,
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
  return { buildRoot, deployedCommitFile, root };
}

function input(value, expectedCloudLogisticsEnabled = false) {
  return {
    buildRoot: value.buildRoot,
    deployedCommitFile: value.deployedCommitFile,
    expectedOrigins: origins,
    expectedCloudLogisticsEnabled,
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
    assert.equal(result.files.length, 4);
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
