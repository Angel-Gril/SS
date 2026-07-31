import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionDownloadRoutes } from '../routes/extensions.js';

const gitCommit = 'a'.repeat(40);
const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
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

function u16(value: number) {
  const bytes = Buffer.alloc(2);
  bytes.writeUInt16LE(value);
  return bytes;
}

function u32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value >>> 0);
  return bytes;
}

function zipFixture(target: 'cloud' | 'local', label: string) {
  const name = Buffer.from(`ss-erp-${target}/manifest.json`, 'utf8');
  const data = Buffer.from(`${JSON.stringify({
    manifest_version: 3,
    name: `SS ERP Test (${target === 'cloud' ? 'Cloud' : 'Local'})`,
    version: label,
  })}\n`, 'utf8');
  const crc = crc32(data);
  const local = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
  ]);
  const central = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0),
    u16(0), u16(0), u32(0), u32(0), name,
  ]);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(central.length), u32(local.length), u16(0),
  ]);
  return Buffer.concat([local, central, end]);
}

function junkZipFixture(label: string) {
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(label, 'utf8')]);
}

function routePath(downloadUrl: string) {
  return downloadUrl.replace(/^\/api\/extensions/u, '');
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ss-erp-extension-download-'));
  roots.push(root);
  const buildRoot = path.join(root, 'build', 'extensions');
  await mkdir(buildRoot, { recursive: true });
  await writeFile(path.join(root, 'DEPLOYED_COMMIT'), `${gitCommit}\n`, 'utf8');
  return { root, buildRoot };
}

async function writeRelease(input: {
  buildRoot: string;
  version?: string;
  gitCommit?: string;
  cloudBytes?: Buffer;
  localBytes?: Buffer;
  mutateEvidence?: (value: Record<string, unknown>) => void;
}) {
  const version = input.version || '1.0.265';
  const cloudBytes = input.cloudBytes || zipFixture('cloud', version);
  const localBytes = input.localBytes || zipFixture('local', version);
  const artifacts = {
    cloud: {
      target: 'cloud',
      filename: `ss-erp-cloud-${version}.zip`,
      zipSha256: sha256(cloudBytes),
      fileCount: 1,
    },
    local: {
      target: 'local',
      filename: `ss-erp-local-${version}.zip`,
      zipSha256: sha256(localBytes),
      fileCount: 1,
    },
  };
  const checksumFilename = `ss-erp-extension-${version}.sha256`;
  const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    gitCommit: input.gitCommit || gitCommit,
    provenance: {
      commitSource: 'DEPLOYED_COMMIT',
      sourceMode: 'REPOSITORY_SOURCE',
      packageInputsSha256: 'b'.repeat(64),
    },
    version,
    expectedOrigins: {
      web: 'https://app.example.com',
      admin: 'https://admin.example.com',
      api: 'https://api.example.com',
      local: 'http://127.0.0.1:3001',
    },
    artifacts,
    checksumFilename,
    signature: { status: 'EXTERNAL_REQUIRED' },
  };
  input.mutateEvidence?.(evidence);

  await writeFile(path.join(input.buildRoot, artifacts.cloud.filename), cloudBytes);
  await writeFile(path.join(input.buildRoot, artifacts.local.filename), localBytes);
  await writeFile(
    path.join(input.buildRoot, checksumFilename),
    `${artifacts.cloud.zipSha256}  ${artifacts.cloud.filename}\n`
      + `${artifacts.local.zipSha256}  ${artifacts.local.filename}\n`,
    'utf8',
  );
  await writeFile(
    path.join(input.buildRoot, `ss-erp-extension-${version}.release-evidence.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  return { cloudBytes, localBytes, artifacts };
}

async function appFor(buildRoot: string, allowUnverifiedDevelopmentBuild = false) {
  const app = Fastify();
  await app.register(extensionDownloadRoutes, {
    buildRoot,
    allowUnverifiedDevelopmentBuild,
  });
  return app;
}

describe('extensionDownloadRoutes', () => {
  it('serves only one canonical, commit-bound cloud/local release set', async () => {
    const value = await fixture();
    await writeRelease({
      buildRoot: value.buildRoot,
      version: '1.0.264',
      gitCommit: 'c'.repeat(40),
    });
    const release = await writeRelease({ buildRoot: value.buildRoot });
    const app = await appFor(value.buildRoot);

    const latest = await app.inject({ method: 'GET', url: '/latest' });
    expect(latest.statusCode).toBe(200);
    expect(latest.headers['cache-control']).toBe('private, no-store');
    expect(latest.json().data).toEqual({
      version: '1.0.265',
      gitCommit,
      signatureStatus: 'EXTERNAL_REQUIRED',
      targets: {
        cloud: {
          filename: release.artifacts.cloud.filename,
          downloadUrl: `/api/extensions/download/cloud/1.0.265/${release.artifacts.cloud.zipSha256}`,
          sha256: release.artifacts.cloud.zipSha256,
        },
        local: {
          filename: release.artifacts.local.filename,
          downloadUrl: `/api/extensions/download/local/1.0.265/${release.artifacts.local.zipSha256}`,
          sha256: release.artifacts.local.zipSha256,
        },
      },
    });

    for (const target of ['cloud', 'local'] as const) {
      const redirect = await app.inject({ method: 'GET', url: `/download/${target}` });
      expect(redirect.statusCode).toBe(302);
      expect(redirect.headers['cache-control']).toBe('private, no-store');
      expect(redirect.headers.location).toBe(latest.json().data.targets[target].downloadUrl);
      const response = await app.inject({
        method: 'GET',
        url: routePath(latest.json().data.targets[target].downloadUrl),
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain(release.artifacts[target].filename);
      expect(response.headers['x-content-sha256']).toBe(release.artifacts[target].zipSha256);
      expect(response.rawPayload.equals(release[`${target}Bytes`])).toBe(true);
    }
  });

  it('rejects missing release evidence even when unpacked files or a ZIP exist', async () => {
    const value = await fixture();
    await mkdir(path.join(value.buildRoot, 'ss-erp-cloud'), { recursive: true });
    await writeFile(
      path.join(value.buildRoot, 'ss-erp-cloud', 'manifest.json'),
      '{"manifest_version":3,"version":"9.9.9"}\n',
      'utf8',
    );
    await writeFile(path.join(value.buildRoot, 'ss-erp-cloud-9.9.9.zip'), junkZipFixture('orphan'));
    const app = await appFor(value.buildRoot);

    const latest = await app.inject({ method: 'GET', url: '/latest' });
    const download = await app.inject({ method: 'GET', url: '/download/cloud' });
    expect(latest.statusCode).toBe(404);
    expect(download.statusCode).toBe(404);
  });

  it('rejects a missing target, mixed version evidence, and changed ZIP bytes', async () => {
    const missing = await fixture();
    const missingRelease = await writeRelease({ buildRoot: missing.buildRoot });
    await rm(path.join(missing.buildRoot, missingRelease.artifacts.local.filename));
    expect((await (await appFor(missing.buildRoot)).inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(404);

    const mixed = await fixture();
    await writeRelease({
      buildRoot: mixed.buildRoot,
      mutateEvidence(evidence) {
        const artifacts = evidence.artifacts as { local: { filename: string } };
        artifacts.local.filename = 'ss-erp-local-1.0.266.zip';
      },
    });
    expect((await (await appFor(mixed.buildRoot)).inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(404);

    const changed = await fixture();
    const changedRelease = await writeRelease({ buildRoot: changed.buildRoot });
    await writeFile(
      path.join(changed.buildRoot, changedRelease.artifacts.cloud.filename),
      junkZipFixture('changed after evidence'),
    );
    const changedApp = await appFor(changed.buildRoot);
    const changedLatest = await changedApp.inject({ method: 'GET', url: '/latest' });
    expect(changedLatest.statusCode).toBe(200);
    expect((await changedApp.inject({
      method: 'GET',
      url: routePath(changedLatest.json().data.targets.cloud.downloadUrl),
    })).statusCode).toBe(404);

    const wrongCommit = await fixture();
    await writeRelease({ buildRoot: wrongCommit.buildRoot });
    await writeFile(path.join(wrongCommit.root, 'DEPLOYED_COMMIT'), `${'c'.repeat(40)}\n`, 'utf8');
    expect((await (await appFor(wrongCommit.buildRoot)).inject({ method: 'GET', url: '/latest' }))
      .statusCode).toBe(404);
  });

  it('binds download URLs to one cached version and lazily verifies only the requested target', async () => {
    const value = await fixture();
    const first = await writeRelease({ buildRoot: value.buildRoot, version: '1.0.265' });
    const app = await appFor(value.buildRoot);
    const firstLatest = await app.inject({ method: 'GET', url: '/latest' });
    const firstCloudUrl = routePath(firstLatest.json().data.targets.cloud.downloadUrl);
    const firstLocalUrl = routePath(firstLatest.json().data.targets.local.downloadUrl);

    await writeRelease({ buildRoot: value.buildRoot, version: '1.0.266' });
    await writeFile(
      path.join(value.buildRoot, first.artifacts.local.filename),
      junkZipFixture('changed local after startup'),
    );

    const cachedLatest = await app.inject({ method: 'GET', url: '/latest' });
    expect(cachedLatest.json().data.version).toBe('1.0.265');
    expect((await app.inject({ method: 'GET', url: firstCloudUrl })).rawPayload.equals(first.cloudBytes))
      .toBe(true);
    expect((await app.inject({ method: 'GET', url: firstLocalUrl })).statusCode).toBe(404);
  });

  it('rejects external-source production evidence and accepts matching Git-HEAD evidence with a marker', async () => {
    const external = await fixture();
    await writeRelease({
      buildRoot: external.buildRoot,
      mutateEvidence(evidence) {
        const provenance = evidence.provenance as { sourceMode: string };
        provenance.sourceMode = 'EXTERNAL_SOURCE';
      },
    });
    expect((await (await appFor(external.buildRoot)).inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(404);

    const gitHead = await fixture();
    await writeRelease({
      buildRoot: gitHead.buildRoot,
      mutateEvidence(evidence) {
        const provenance = evidence.provenance as { commitSource: string };
        provenance.commitSource = 'GIT_HEAD';
      },
    });
    expect((await (await appFor(gitHead.buildRoot)).inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(200);

    const wrongGitHead = await fixture();
    await writeRelease({
      buildRoot: wrongGitHead.buildRoot,
      gitCommit: 'c'.repeat(40),
      mutateEvidence(evidence) {
        const provenance = evidence.provenance as { commitSource: string };
        provenance.commitSource = 'GIT_HEAD';
      },
    });
    expect((await (await appFor(wrongGitHead.buildRoot)).inject({
      method: 'GET',
      url: '/latest',
    })).statusCode).toBe(404);
  });

  it('rejects PK-prefixed junk and a ZIP file count that disagrees with evidence', async () => {
    const junk = await fixture();
    await writeRelease({
      buildRoot: junk.buildRoot,
      cloudBytes: junkZipFixture('not a ZIP central directory'),
    });
    const junkApp = await appFor(junk.buildRoot);
    const junkLatest = await junkApp.inject({ method: 'GET', url: '/latest' });
    expect(junkLatest.statusCode).toBe(200);
    expect((await junkApp.inject({
      method: 'GET',
      url: routePath(junkLatest.json().data.targets.cloud.downloadUrl),
    })).statusCode).toBe(404);

    const count = await fixture();
    await writeRelease({
      buildRoot: count.buildRoot,
      mutateEvidence(evidence) {
        const artifacts = evidence.artifacts as { cloud: { fileCount: number } };
        artifacts.cloud.fileCount = 2;
      },
    });
    const countApp = await appFor(count.buildRoot);
    const countLatest = await countApp.inject({ method: 'GET', url: '/latest' });
    expect(countLatest.statusCode).toBe(200);
    expect((await countApp.inject({
      method: 'GET',
      url: routePath(countLatest.json().data.targets.cloud.downloadUrl),
    })).statusCode).toBe(404);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a release artifact reached through a symbolic link',
    async () => {
      const value = await fixture();
      const release = await writeRelease({ buildRoot: value.buildRoot });
      const cloudPath = path.join(value.buildRoot, release.artifacts.cloud.filename);
      const movedPath = path.join(value.buildRoot, 'moved-cloud.zip');
      await writeFile(movedPath, release.cloudBytes);
      await rm(cloudPath);
      await symlink(movedPath, cloudPath, 'file');

      const app = await appFor(value.buildRoot);
      expect((await app.inject({ method: 'GET', url: '/download/cloud' })).statusCode).toBe(404);
    },
  );

  it('allows legacy reconstruction only behind the explicit non-production development option', async () => {
    const value = await fixture();
    const cloudDirectory = path.join(value.buildRoot, 'ss-erp-cloud');
    await mkdir(cloudDirectory, { recursive: true });
    await writeFile(
      path.join(cloudDirectory, 'manifest.json'),
      '{"manifest_version":3,"name":"Development Extension","version":"1.0.7"}\n',
      'utf8',
    );

    const strictApp = await appFor(value.buildRoot);
    expect((await strictApp.inject({ method: 'GET', url: '/download/cloud' })).statusCode).toBe(404);

    const developmentApp = await appFor(value.buildRoot, true);
    const response = await developmentApp.inject({ method: 'GET', url: '/download/cloud' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('ss-erp-cloud-1.0.7.zip');
    expect(response.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    vi.stubEnv('NODE_ENV', 'production');
    const productionApp = await appFor(value.buildRoot, true);
    expect((await productionApp.inject({ method: 'GET', url: '/download/cloud' })).statusCode)
      .toBe(404);
  });
});
