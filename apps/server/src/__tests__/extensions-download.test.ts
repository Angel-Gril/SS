import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extensionDownloadRoutes } from '../routes/extensions.js';
import { loadPublishedExtensionRelease } from '../services/extension-website-publication.js';

const gitCommit = 'a'.repeat(40);
const publicationPointerFilename = 'current.website-publication-approval.json';
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
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await writeFile(
    path.join(input.buildRoot, `ss-erp-extension-${version}.release-evidence.json`),
    evidenceBytes,
  );
  return { cloudBytes, localBytes, artifacts, evidence, evidenceBytes };
}

async function appFor(
  buildRoot: string,
  options: {
    allowVerifiedDevelopmentBuild?: boolean;
    allowUnverifiedDevelopmentBuild?: boolean;
    publication?: {
      root: string;
      keyringPath: string;
      expectedDistributionOrigin?: string;
      expectedRegion?: 'COM' | 'CN';
    };
  } = {},
) {
  const app = Fastify();
  await app.register(extensionDownloadRoutes, {
    buildRoot,
    allowVerifiedDevelopmentBuild: options.allowVerifiedDevelopmentBuild,
    allowUnverifiedDevelopmentBuild: options.allowUnverifiedDevelopmentBuild,
    ...(options.publication ? {
      publicationRoot: options.publication.root,
      publicationOwnerUid: null,
      trustedKeyringPath: options.publication.keyringPath,
      expectedDistributionOrigin: options.publication.expectedDistributionOrigin
        || 'https://api.example.com',
      expectedRegion: options.publication.expectedRegion || 'COM',
    } : {}),
  });
  return app;
}

function canonical(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function publishedFixture(input: {
  root: string;
  buildRoot: string;
  version?: string;
  mutateApproval?: (value: Record<string, unknown>) => void;
  mutateDarkCanary?: (value: Record<string, unknown>) => void;
}) {
  const version = input.version || '1.0.265';
  const candidateRoot = path.join(input.root, `published-candidate-${version}`);
  const publicationRoot = path.join(input.root, `website-publication-${version}`);
  const bundlesRoot = path.join(publicationRoot, 'bundles');
  await mkdir(candidateRoot, { recursive: true });
  await mkdir(bundlesRoot, { recursive: true });
  const release = await writeRelease({ buildRoot: candidateRoot, version });
  const evidenceFilename = `ss-erp-extension-${version}.release-evidence.json`;
  const signatureFilename = `ss-erp-extension-${version}.release-signature.json`;
  const approvalFilename = `ss-erp-extension-${version}.website-publication-approval.json`;
  const darkCanaryFilename = `rel04-dark-canary-${version.replaceAll('.', '')}.json`;
  const keyId = 'ss-erp-extension-release-test';
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const keyring = {
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [{
      algorithm: 'Ed25519',
      keyId,
      publicKeyBase64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
      status: 'ACTIVE',
    }],
  };
  const keyringPath = path.join(input.root, `trusted-keys-${version}.json`);
  await writeFile(keyringPath, canonical(keyring), 'utf8');

  const releaseSignaturePayload = {
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_SIGNATURE',
    algorithm: 'Ed25519',
    keyId,
    signedAt: '2030-01-01T00:00:00.000Z',
    releaseEvidenceFilename: evidenceFilename,
    releaseEvidenceSha256: sha256(release.evidenceBytes),
  };
  const releaseSignatureSigningPayload = {
    algorithm: releaseSignaturePayload.algorithm,
    keyId: releaseSignaturePayload.keyId,
    kind: releaseSignaturePayload.kind,
    releaseEvidenceFilename: releaseSignaturePayload.releaseEvidenceFilename,
    releaseEvidenceSha256: releaseSignaturePayload.releaseEvidenceSha256,
    schemaVersion: releaseSignaturePayload.schemaVersion,
    signedAt: releaseSignaturePayload.signedAt,
  };
  const releaseSignature = {
    ...releaseSignaturePayload,
    signatureBase64: sign(
      null,
      Buffer.concat([
        Buffer.from(`SS_ERP_EXTENSION_RELEASE_SIGNATURE_V1\n${canonical(releaseSignatureSigningPayload)}`),
        release.evidenceBytes,
      ]),
      privateKey,
    ).toString('base64'),
  };
  const releaseSignatureBytes = Buffer.from(canonical(releaseSignature), 'utf8');
  const releaseSignaturePath = path.join(input.root, signatureFilename);
  await writeFile(releaseSignaturePath, releaseSignatureBytes);

  const darkCanary = {
    schemaVersion: 1,
    kind: 'SS_ERP_REL04_DARK_CANARY',
    status: 'PASS',
    observedAt: '2030-01-01T00:05:00.000Z',
    bindings: {
      apiOrigin: 'https://api.example.com',
      expectedGitCommit: gitCommit,
      extensionOrigin: `chrome-extension://${'a'.repeat(32)}`,
      shopIdHash: 'c'.repeat(64),
      publishReconciliation: {
        attemptIdHash: null,
        mode: 'TARGET_COMMIT_QA04_REGRESSION',
        notBefore: null,
        regressionEvidenceSha256: 'b'.repeat(64),
        workflowIdHash: null,
      },
    },
    checks: [
      {
        id: 'deployment-and-publication-isolation',
        status: 'PASS',
        evidence: {
          deployedCandidatePublic: false,
          deployedGitCommit: gitCommit,
          existingPublication: null,
          extensionCorsPreflight: true,
        },
      },
      {
        id: 'default-off-policy',
        status: 'PASS',
        evidence: {
          extensionByok: {
            expectation: 'off',
            generation: 'false',
            hostedAi: 'false',
            ingest: 'false',
            policy: 'extension-byok-admin-policy/v1:revision:0,mode:off',
            publish: 'false',
          },
          extensionWorkbench: 'false',
          fullEdit: 'false',
          imageToImage: 'false',
          imageTranslation: 'disabled/disabled',
          inpaint: 'false',
          legacyGeneration: 'disabled/disabled',
          master: 'false',
          ozonPublisher: 'false',
          policy: 'revision:0,tenantIds:0',
          suite: 'false',
          webMedia: 'false',
        },
      },
      {
        id: 'hosted-route-regression',
        status: 'PASS',
        evidence: {
          providerDispatchMethodUsed: false,
          reasonCode: 'AI_MEDIA_SUITE_DISABLED',
          routeReachable: true,
          suiteEnabled: false,
          workflowEnabled: false,
        },
      },
      {
        id: 'publish-reconciliation-read',
        status: 'PASS',
        evidence: {
          capabilityEnabled: false,
          capabilityLegacyAllowed: true,
          capabilityReason: 'master_off',
          capabilityRevision: 'master-off',
          liveAttemptRead: false,
          mode: 'TARGET_COMMIT_QA04_REGRESSION',
          ozonMutationRequestSentByCanary: false,
          regressionEvidenceSha256: 'b'.repeat(64),
        },
      },
      {
        id: 'device-pairing-active-lifecycle',
        status: 'PASS',
        evidence: {
          authorizedShopIdHash: 'd'.repeat(64),
          deploymentIdHash: 'e'.repeat(64),
          deviceIdHash: 'f'.repeat(64),
          refreshRotated: true,
          sessionIdHash: 'a'.repeat(64),
        },
      },
      {
        id: 'byok-disabled-path',
        status: 'PASS',
        evidence: {
          erpIngestRequestSentByCanary: false,
          errorCode: 'byok_readiness_not_ready',
          providerRequestSentByCanary: false,
          rejectedBeforeExecutionIntent: true,
          statusCode: 409,
        },
      },
      {
        id: 'device-session-cleanup',
        status: 'PASS',
        evidence: {
          action: 'OWNER_REVOKED',
          revokedTokenRejected: true,
          sessionIdHash: 'a'.repeat(64),
        },
      },
    ],
    requestAudit: {
      credentialsMode: 'omit',
      providerDispatchSent: false,
      erpIngestSent: false,
      ozonMutationSent: false,
      redirectsAllowed: false,
      timeoutMs: 15_000,
      requests: [
        'GET /ready',
        'GET /api/extensions/latest',
        'OPTIONS /api/extension-device/byok-media/readiness',
        'GET /api/admin/system-config/:key',
        'GET /api/ai-images/suites/readiness',
        'GET /api/source-listing-workflows/publisher-capability',
        'POST /api/extension-device/pairing-codes',
        'POST /api/extension-device/pairing-claims',
        'GET /api/extension-device/shops',
        'POST /api/extension-device/refresh',
        'GET /api/extension-device/sessions',
        'POST /api/extension-device/byok-media/readiness',
        'DELETE /api/extension-device/sessions/:sessionId',
        'GET /api/extension-device/shops (revoked)',
      ].map((route) => ({ method: route.slice(0, route.indexOf(' ')), route, statusCode: 200 })),
    },
    cleanup: { completed: true, errorCode: null, required: true },
  };
  input.mutateDarkCanary?.(darkCanary);
  const darkCanaryBytes = Buffer.from(canonical(darkCanary), 'utf8');
  const darkCanaryPath = path.join(input.root, darkCanaryFilename);
  await writeFile(darkCanaryPath, darkCanaryBytes);

  const approvalPayload: Record<string, unknown> = {
    algorithm: 'Ed25519',
    approvedAt: '2030-01-01T00:06:00.000Z',
    channel: 'FIRST_PARTY_WEBSITE',
    darkCanaryFilename,
    darkCanarySha256: sha256(darkCanaryBytes),
    distributionOrigin: 'https://api.example.com',
    gitCommit,
    keyId,
    kind: 'SS_ERP_EXTENSION_WEBSITE_PUBLICATION_APPROVAL',
    region: 'COM',
    releaseEvidenceFilename: evidenceFilename,
    releaseEvidenceSha256: sha256(release.evidenceBytes),
    releaseSignatureFilename: signatureFilename,
    releaseSignatureSha256: sha256(releaseSignatureBytes),
    schemaVersion: 1,
    version,
  };
  input.mutateApproval?.(approvalPayload);
  const approval = {
    schemaVersion: approvalPayload.schemaVersion,
    kind: approvalPayload.kind,
    algorithm: approvalPayload.algorithm,
    channel: approvalPayload.channel,
    keyId: approvalPayload.keyId,
    approvedAt: approvalPayload.approvedAt,
    region: approvalPayload.region,
    distributionOrigin: approvalPayload.distributionOrigin,
    gitCommit: approvalPayload.gitCommit,
    version: approvalPayload.version,
    releaseEvidenceFilename: approvalPayload.releaseEvidenceFilename,
    releaseEvidenceSha256: approvalPayload.releaseEvidenceSha256,
    releaseSignatureFilename: approvalPayload.releaseSignatureFilename,
    releaseSignatureSha256: approvalPayload.releaseSignatureSha256,
    darkCanaryFilename: approvalPayload.darkCanaryFilename,
    darkCanarySha256: approvalPayload.darkCanarySha256,
    signatureBase64: sign(
      null,
      Buffer.from(`SS_ERP_EXTENSION_WEBSITE_PUBLICATION_APPROVAL_V1\n${canonical(approvalPayload)}`),
      privateKey,
    ).toString('base64'),
  };
  const approvalBytes = Buffer.from(canonical(approval), 'utf8');
  const approvalSha256 = sha256(approvalBytes);
  const bundleRoot = path.join(bundlesRoot, approvalSha256);
  const bundleCandidate = path.join(bundleRoot, 'candidate');
  const bundlePublication = path.join(bundleRoot, 'publication');
  await mkdir(bundleCandidate, { recursive: true });
  await mkdir(bundlePublication, { recursive: true });
  await writeFile(path.join(bundleRoot, 'DEPLOYED_COMMIT'), `${gitCommit}\n`, 'utf8');
  for (const filename of [
    evidenceFilename,
    `ss-erp-extension-${version}.sha256`,
    release.artifacts.cloud.filename,
    release.artifacts.local.filename,
  ]) await copyFile(path.join(candidateRoot, filename), path.join(bundleCandidate, filename));
  await writeFile(path.join(bundlePublication, approvalFilename), approvalBytes);
  await writeFile(path.join(bundlePublication, signatureFilename), releaseSignatureBytes);
  await writeFile(path.join(bundlePublication, darkCanaryFilename), darkCanaryBytes);
  await writeFile(path.join(publicationRoot, publicationPointerFilename), approvalBytes);
  return {
    publicationRoot,
    bundleRoot,
    keyringPath,
    approvalSha256,
    pointerPath: path.join(publicationRoot, publicationPointerFilename),
    release,
  };
}

describe('extensionDownloadRoutes', () => {
  it('requires a website publication pointer by default when NODE_ENV is missing', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const value = await fixture();
      const release = await writeRelease({ buildRoot: value.buildRoot });
      const app = await appFor(value.buildRoot);

      expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/download/cloud' })).statusCode).toBe(404);
      expect((await app.inject({
        method: 'GET',
        url: `/download/cloud/1.0.265/${release.artifacts.cloud.zipSha256}`,
      })).statusCode).toBe(404);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('ignores explicit development build options in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const release = await writeRelease({ buildRoot: value.buildRoot });
    const app = await appFor(value.buildRoot, {
      allowVerifiedDevelopmentBuild: true,
      allowUnverifiedDevelopmentBuild: true,
    });

    expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'GET',
      url: `/download/cloud/1.0.265/${release.artifacts.cloud.zipSha256}`,
    })).statusCode).toBe(404);
  });

  it('keeps a deployed production candidate private until a publication pointer exists', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const release = await writeRelease({ buildRoot: value.buildRoot });
    const publicationRoot = path.join(value.root, 'website-publication-empty');
    await mkdir(path.join(publicationRoot, 'bundles'), { recursive: true });
    const app = await appFor(value.buildRoot, {
      allowUnverifiedDevelopmentBuild: true,
      publication: {
        root: publicationRoot,
        keyringPath: path.join(value.root, 'missing-keyring.json'),
      },
    });

    expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/download/cloud' })).statusCode).toBe(404);
    expect((await app.inject({
      method: 'GET',
      url: `/download/cloud/1.0.265/${release.artifacts.cloud.zipSha256}`,
    })).statusCode).toBe(404);
  });

  it('serves only the independently approved website bundle in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    await writeRelease({ buildRoot: value.buildRoot, version: '9.9.9' });
    const published = await publishedFixture(value);
    await expect(loadPublishedExtensionRelease({
      publicationRoot: published.publicationRoot,
      keyringPath: published.keyringPath,
      expectedDistributionOrigin: 'https://api.example.com',
      expectedRegion: 'COM',
      trustedOwnerUid: null,
    })).resolves.toMatchObject({ approvalSha256: published.approvalSha256 });
    const app = await appFor(value.buildRoot, {
      publication: {
        root: published.publicationRoot,
        keyringPath: published.keyringPath,
      },
    });

    const latest = await app.inject({ method: 'GET', url: '/latest' });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().data.version).toBe('1.0.265');
    expect(latest.json().data.publicationApprovalSha256).toBe(published.approvalSha256);
    const cloud = await app.inject({
      method: 'GET',
      url: routePath(latest.json().data.targets.cloud.downloadUrl),
    });
    expect(cloud.statusCode).toBe(200);
    expect(cloud.headers['x-publication-approval-sha256']).toBe(published.approvalSha256);
    expect(cloud.rawPayload.equals(published.release.cloudBytes)).toBe(true);
  });

  it('rejects a dark canary observation that predates the release signature', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const published = await publishedFixture({
      ...value,
      mutateDarkCanary(canary) {
        canary.observedAt = '2029-12-31T23:59:59.000Z';
      },
    });
    await expect(loadPublishedExtensionRelease({
      publicationRoot: published.publicationRoot,
      keyringPath: published.keyringPath,
      expectedDistributionOrigin: 'https://api.example.com',
      expectedRegion: 'COM',
      trustedOwnerUid: null,
    })).rejects.toThrow(/dark canary evidence/u);
    const app = await appFor(value.buildRoot, {
      publication: {
        root: published.publicationRoot,
        keyringPath: published.keyringPath,
      },
    });
    expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/download/cloud' })).statusCode).toBe(404);
  });

  it('fails closed after a valid pointer is removed instead of serving a cached release', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const published = await publishedFixture(value);
    const app = await appFor(value.buildRoot, {
      publication: {
        root: published.publicationRoot,
        keyringPath: published.keyringPath,
      },
    });
    const latest = await app.inject({ method: 'GET', url: '/latest' });
    const cloudUrl = routePath(latest.json().data.targets.cloud.downloadUrl);
    expect((await app.inject({ method: 'GET', url: cloudUrl })).statusCode).toBe(200);

    await rm(published.pointerPath);
    expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: cloudUrl })).statusCode).toBe(404);
  });

  it('invalidates cached bytes when a same-pointer website artifact changes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const published = await publishedFixture(value);
    const app = await appFor(value.buildRoot, {
      publication: {
        root: published.publicationRoot,
        keyringPath: published.keyringPath,
      },
    });
    const latest = await app.inject({ method: 'GET', url: '/latest' });
    const cloudUrl = routePath(latest.json().data.targets.cloud.downloadUrl);
    expect((await app.inject({ method: 'GET', url: cloudUrl })).statusCode).toBe(200);

    await writeFile(
      path.join(published.bundleRoot, 'candidate', published.release.artifacts.cloud.filename),
      junkZipFixture('same pointer replacement'),
    );
    expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: cloudUrl })).statusCode).toBe(404);
  });

  it.skipIf(process.platform === 'win32')(
    'requires root-owned non-writable publication evidence when NODE_ENV is missing',
    async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      try {
        const value = await fixture();
        const published = await publishedFixture(value);
        await chmod(published.pointerPath, 0o666);
        const app = Fastify();
        await app.register(extensionDownloadRoutes, {
          buildRoot: value.buildRoot,
          publicationRoot: published.publicationRoot,
          trustedKeyringPath: published.keyringPath,
          expectedDistributionOrigin: 'https://api.example.com',
          expectedRegion: 'COM',
        });
        expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
      } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
      }
    },
  );

  it('evicts artifact promises when the website publication pointer switches', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const first = await publishedFixture({ ...value, version: '1.0.265' });
    const second = await publishedFixture({ ...value, version: '1.0.266' });
    const secondBundle = path.join(
      first.publicationRoot,
      'bundles',
      second.approvalSha256,
    );
    await cp(second.bundleRoot, secondBundle, { recursive: true });

    const firstPointerBytes = await readFile(first.pointerPath);
    const secondPointerBytes = await readFile(second.pointerPath);
    const firstKeyringBytes = await readFile(first.keyringPath);
    const secondKeyringBytes = await readFile(second.keyringPath);
    const activeKeyringPath = path.join(value.root, 'active-publication-keyring.json');
    await writeFile(activeKeyringPath, firstKeyringBytes);

    const app = await appFor(value.buildRoot, {
      publication: {
        root: first.publicationRoot,
        keyringPath: activeKeyringPath,
      },
    });
    const firstLatest = await app.inject({ method: 'GET', url: '/latest' });
    const firstCloudUrl = routePath(firstLatest.json().data.targets.cloud.downloadUrl);
    expect((await app.inject({ method: 'GET', url: firstCloudUrl })).statusCode).toBe(200);

    await writeFile(activeKeyringPath, secondKeyringBytes);
    await writeFile(first.pointerPath, secondPointerBytes);
    const secondLatest = await app.inject({ method: 'GET', url: '/latest' });
    const secondCloudUrl = routePath(secondLatest.json().data.targets.cloud.downloadUrl);
    expect(secondLatest.json().data.version).toBe('1.0.266');
    expect((await app.inject({ method: 'GET', url: firstCloudUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: secondCloudUrl })).rawPayload
      .equals(second.release.cloudBytes)).toBe(true);

    await writeFile(
      path.join(first.bundleRoot, 'candidate', first.release.artifacts.cloud.filename),
      junkZipFixture('changed after cache eviction'),
    );
    await writeFile(activeKeyringPath, firstKeyringBytes);
    await writeFile(first.pointerPath, firstPointerBytes);
    expect((await app.inject({ method: 'GET', url: secondCloudUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: firstCloudUrl })).statusCode).toBe(404);
  });

  it('rejects a signed publication pointer whose release binding is forged', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const value = await fixture();
    const published = await publishedFixture({
      ...value,
      mutateApproval(approval) {
        approval.gitCommit = 'c'.repeat(40);
      },
    });
    const app = await appFor(value.buildRoot, {
      publication: {
        root: published.publicationRoot,
        keyringPath: published.keyringPath,
      },
    });
    expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a website publication pointer reached through a symbolic link',
    async () => {
      vi.stubEnv('NODE_ENV', 'production');
      const value = await fixture();
      const published = await publishedFixture(value);
      const moved = `${published.pointerPath}.moved`;
      await copyFile(published.pointerPath, moved);
      await rm(published.pointerPath);
      await symlink(moved, published.pointerPath, 'file');
      const app = await appFor(value.buildRoot, {
        publication: {
          root: published.publicationRoot,
          keyringPath: published.keyringPath,
        },
      });
      expect((await app.inject({ method: 'GET', url: '/latest' })).statusCode).toBe(404);
    },
  );

  it('serves only one canonical, commit-bound cloud/local release set', async () => {
    const value = await fixture();
    await writeRelease({
      buildRoot: value.buildRoot,
      version: '1.0.264',
      gitCommit: 'c'.repeat(40),
    });
    const release = await writeRelease({ buildRoot: value.buildRoot });
    const app = await appFor(value.buildRoot, { allowVerifiedDevelopmentBuild: true });

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
    const app = await appFor(value.buildRoot, { allowVerifiedDevelopmentBuild: true });

    const latest = await app.inject({ method: 'GET', url: '/latest' });
    const download = await app.inject({ method: 'GET', url: '/download/cloud' });
    expect(latest.statusCode).toBe(404);
    expect(download.statusCode).toBe(404);
  });

  it('rejects a missing target, mixed version evidence, and changed ZIP bytes', async () => {
    const missing = await fixture();
    const missingRelease = await writeRelease({ buildRoot: missing.buildRoot });
    await rm(path.join(missing.buildRoot, missingRelease.artifacts.local.filename));
    expect((await (await appFor(missing.buildRoot, { allowVerifiedDevelopmentBuild: true }))
      .inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(404);

    const mixed = await fixture();
    await writeRelease({
      buildRoot: mixed.buildRoot,
      mutateEvidence(evidence) {
        const artifacts = evidence.artifacts as { local: { filename: string } };
        artifacts.local.filename = 'ss-erp-local-1.0.266.zip';
      },
    });
    expect((await (await appFor(mixed.buildRoot, { allowVerifiedDevelopmentBuild: true }))
      .inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(404);

    const changed = await fixture();
    const changedRelease = await writeRelease({ buildRoot: changed.buildRoot });
    const changedApp = await appFor(changed.buildRoot, { allowVerifiedDevelopmentBuild: true });
    const changedLatest = await changedApp.inject({ method: 'GET', url: '/latest' });
    const changedCloudUrl = routePath(changedLatest.json().data.targets.cloud.downloadUrl);
    await writeFile(
      path.join(changed.buildRoot, changedRelease.artifacts.cloud.filename),
      junkZipFixture('changed after evidence'),
    );
    expect(changedLatest.statusCode).toBe(200);
    expect((await changedApp.inject({
      method: 'GET',
      url: changedCloudUrl,
    })).statusCode).toBe(404);
    await writeFile(
      path.join(changed.buildRoot, changedRelease.artifacts.cloud.filename),
      changedRelease.cloudBytes,
    );
    const restoredResponse = await changedApp.inject({ method: 'GET', url: changedCloudUrl });
    expect(restoredResponse.statusCode).toBe(200);
    expect(restoredResponse.rawPayload.equals(changedRelease.cloudBytes)).toBe(true);

    const wrongCommit = await fixture();
    await writeRelease({ buildRoot: wrongCommit.buildRoot });
    await writeFile(path.join(wrongCommit.root, 'DEPLOYED_COMMIT'), `${'c'.repeat(40)}\n`, 'utf8');
    expect((await (await appFor(wrongCommit.buildRoot, { allowVerifiedDevelopmentBuild: true }))
      .inject({ method: 'GET', url: '/latest' }))
      .statusCode).toBe(404);
  });

  it('binds download URLs to one cached version and lazily verifies only the requested target', async () => {
    const value = await fixture();
    const first = await writeRelease({ buildRoot: value.buildRoot, version: '1.0.265' });
    const app = await appFor(value.buildRoot, { allowVerifiedDevelopmentBuild: true });
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
    expect((await (await appFor(external.buildRoot, { allowVerifiedDevelopmentBuild: true }))
      .inject({ method: 'GET', url: '/latest' })).statusCode)
      .toBe(404);

    const gitHead = await fixture();
    await writeRelease({
      buildRoot: gitHead.buildRoot,
      mutateEvidence(evidence) {
        const provenance = evidence.provenance as { commitSource: string };
        provenance.commitSource = 'GIT_HEAD';
      },
    });
    expect((await (await appFor(gitHead.buildRoot, { allowVerifiedDevelopmentBuild: true }))
      .inject({ method: 'GET', url: '/latest' })).statusCode)
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
    expect((await (await appFor(wrongGitHead.buildRoot, { allowVerifiedDevelopmentBuild: true }))
      .inject({
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
    const junkApp = await appFor(junk.buildRoot, { allowVerifiedDevelopmentBuild: true });
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
    const countApp = await appFor(count.buildRoot, { allowVerifiedDevelopmentBuild: true });
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

      const app = await appFor(value.buildRoot, { allowVerifiedDevelopmentBuild: true });
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

    const developmentApp = await appFor(value.buildRoot, {
      allowUnverifiedDevelopmentBuild: true,
    });
    const response = await developmentApp.inject({ method: 'GET', url: '/download/cloud' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('ss-erp-cloud-1.0.7.zip');
    expect(response.rawPayload.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    vi.stubEnv('NODE_ENV', 'production');
    const productionApp = await appFor(value.buildRoot, {
      allowUnverifiedDevelopmentBuild: true,
    });
    expect((await productionApp.inject({ method: 'GET', url: '/download/cloud' })).statusCode)
      .toBe(404);
  });
});
