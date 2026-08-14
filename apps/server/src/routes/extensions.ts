import type { FastifyInstance, FastifyReply } from 'fastify';
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  loadVerifiedExtensionReleaseSet,
  readVerifiedExtensionReleaseArtifact,
  type VerifiedExtensionReleaseArtifact,
  type VerifiedExtensionReleaseSet,
} from '../services/extension-release-set.js';
import {
  loadPublishedExtensionRelease,
  type PublishedExtensionRelease,
  type WebsitePublicationApproval,
} from '../services/extension-website-publication.js';

type ExtensionTarget = 'cloud' | 'local';

interface ZipEntry {
  name: string;
  data: Buffer;
  mtime: Date;
}

interface BuiltManifest {
  version?: string;
}

interface ExtensionReleaseTarget {
  filename: string;
  downloadUrl: string;
  sha256?: string;
}

interface ExtensionDownloadRouteOptions {
  buildRoot?: string;
  allowVerifiedDevelopmentBuild?: boolean;
  allowUnverifiedDevelopmentBuild?: boolean;
  publicationRoot?: string;
  publicationOwnerUid?: number | null;
  trustedKeyringPath?: string;
  expectedDistributionOrigin?: string;
  expectedRegion?: WebsitePublicationApproval['region'];
}

const DEFAULT_WEBSITE_PUBLICATION_ROOT = '/var/lib/ss-erp-extension-publications';

function findExtensionBuildRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../../build/extensions'),
    path.resolve(process.cwd(), 'build/extensions'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function getExtensionBuildRoot(configuredRoot?: string): string {
  if (configuredRoot) return path.resolve(configuredRoot);
  const found = findExtensionBuildRoot();
  return found || path.resolve(process.cwd(), '../../build/extensions');
}

function getExtensionBuildDir(buildRoot: string, target: ExtensionTarget): string {
  return path.join(buildRoot, `ss-erp-${target}`);
}

async function readOptionalBuiltManifest(
  buildRoot: string,
  target: ExtensionTarget,
): Promise<BuiltManifest | null> {
  const manifestPath = path.join(buildRoot, `ss-erp-${target}`, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(await readFile(manifestPath, 'utf8')) as BuiltManifest;
}

function extensionZipPath(buildRoot: string, target: ExtensionTarget, version: string): string {
  return path.join(buildRoot, `ss-erp-${target}-${version}.zip`);
}

async function listFiles(root: string, dir = ''): Promise<string[]> {
  const absoluteDir = path.join(root, dir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

async function buildExtensionEntries(
  buildRoot: string,
  target: ExtensionTarget,
): Promise<{ entries: ZipEntry[]; version: string }> {
  const buildDir = getExtensionBuildDir(buildRoot, target);
  const manifestPath = path.join(buildDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`扩展 ${target} 构建产物不存在，请先运行 pnpm package:extension:${target}`);
  }
  const files = await listFiles(buildDir);
  const rootName = `ss-erp-${target}`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BuiltManifest;
  const version = manifest.version || '0.0.0';
  const entries: ZipEntry[] = [];

  for (const relative of files) {
    const absolute = path.join(buildDir, relative);
    const fileStat = await stat(absolute);
    const normalizedRelative = relative.split(path.sep).join('/');
    entries.push({
      name: `${rootName}/${normalizedRelative}`,
      data: await readFile(absolute),
      mtime: fileStat.mtime,
    });
  }

  return { entries, version };
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

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function u16(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.allocUnsafe(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createZip(entries: ZipEntry[]): Buffer {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const { date, time } = dosDateTime(entry.mtime);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    fileParts.push(localHeader, entry.data);

    centralParts.push(Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]));

    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...fileParts, centralDirectory, end]);
}

function parseTarget(raw: string): ExtensionTarget | null {
  return raw === 'cloud' || raw === 'local' ? raw : null;
}

export async function extensionDownloadRoutes(
  app: FastifyInstance,
  options: ExtensionDownloadRouteOptions = {},
) {
  const buildRoot = getExtensionBuildRoot(options.buildRoot);
  const allowDevelopmentFallback = options.allowUnverifiedDevelopmentBuild === true
    && process.env.NODE_ENV !== 'production';
  const allowVerifiedDevelopmentBuild = (
    options.allowVerifiedDevelopmentBuild === true
      || options.allowUnverifiedDevelopmentBuild === true
  ) && process.env.NODE_ENV !== 'production';
  const repositoryRoot = path.dirname(path.dirname(buildRoot));
  const useWebsitePublication = !allowVerifiedDevelopmentBuild
    || options.publicationRoot !== undefined;
  const directVerifiedRelease: VerifiedExtensionReleaseSet | null = useWebsitePublication
    ? null
    : await loadVerifiedExtensionReleaseSet({
        buildRoot,
        deployedCommitPath: path.join(repositoryRoot, 'DEPLOYED_COMMIT'),
        requireDeployedCommit: false,
      }).catch(() => null);
  const publicationRoot = path.resolve(
    options.publicationRoot || DEFAULT_WEBSITE_PUBLICATION_ROOT,
  );
  const trustedKeyringPath = path.resolve(
    options.trustedKeyringPath
      || path.join(repositoryRoot, 'config/extension-release-trusted-keys.json'),
  );
  const publicationOwnerUid = options.publicationOwnerUid !== undefined
    ? options.publicationOwnerUid
    : (useWebsitePublication && process.platform !== 'win32' ? 0 : null);
  type CurrentRelease = {
    release: VerifiedExtensionReleaseSet;
    approvalSha256: string | null;
    releaseKey: string;
    artifactBytes: Map<ExtensionTarget, Promise<Buffer>>;
  };
  let artifactBytesCache: {
    releaseKey: string;
    bytes: Map<ExtensionTarget, Promise<Buffer>>;
  } | null = null;
  let publicationValidation: {
    releaseKey: string;
    promise: Promise<PublishedExtensionRelease | null>;
    failedAt: number | null;
  } | null = null;
  const publicationValidationRetryMs = 5 * 60 * 1000;

  async function loadWebsitePublication() {
    return loadPublishedExtensionRelease({
      publicationRoot,
      keyringPath: trustedKeyringPath,
      trustedOwnerUid: publicationOwnerUid,
      expectedDistributionOrigin: options.expectedDistributionOrigin!,
      expectedRegion: options.expectedRegion!,
    }).catch(() => null);
  }

  function publishedReleaseKey(published: PublishedExtensionRelease) {
    return `${published.approvalSha256}:${published.artifactSnapshotKey}`;
  }

  async function validatePublishedArtifacts(
    published: PublishedExtensionRelease,
    releaseKey: string,
  ) {
    for (const target of ['cloud', 'local'] as const) {
      await readVerifiedExtensionReleaseArtifact(published.release, target);
    }
    const stable = await loadWebsitePublication();
    if (!stable || publishedReleaseKey(stable) !== releaseKey) return null;
    return stable;
  }

  async function currentRelease(): Promise<CurrentRelease | null> {
    if (!useWebsitePublication) {
      if (!directVerifiedRelease) return null;
      const releaseKey = 'development';
      const artifactBytes = artifactBytesFor(releaseKey);
      return {
        release: directVerifiedRelease,
        approvalSha256: null,
        releaseKey,
        artifactBytes,
      };
    }
    if (!options.expectedDistributionOrigin || !options.expectedRegion) {
      artifactBytesCache = null;
      publicationValidation = null;
      return null;
    }
    const published = await loadWebsitePublication();
    if (!published) {
      artifactBytesCache = null;
      publicationValidation = null;
      return null;
    }
    const releaseKey = publishedReleaseKey(published);
    let stable: PublishedExtensionRelease | null = published;
    let releaseCache = artifactBytesCache;
    if (!releaseCache || releaseCache.releaseKey !== releaseKey) {
      artifactBytesCache = null;
      const retryFailedValidation = publicationValidation?.releaseKey === releaseKey
        && publicationValidation.failedAt !== null
        && Date.now() - publicationValidation.failedAt >= publicationValidationRetryMs;
      if (!publicationValidation || publicationValidation.releaseKey !== releaseKey
        || retryFailedValidation) {
        const validation = {
          releaseKey,
          promise: Promise.resolve<PublishedExtensionRelease | null>(null),
          failedAt: null as number | null,
        };
        validation.promise = validatePublishedArtifacts(published, releaseKey)
          .catch(() => null)
          .then((result) => {
            if (!result) validation.failedAt = Date.now();
            return result;
          });
        publicationValidation = validation;
      }
      const validation = publicationValidation;
      stable = await validation.promise;
      if (publicationValidation !== validation || !stable) return null;
      releaseCache = {
        releaseKey,
        bytes: new Map<ExtensionTarget, Promise<Buffer>>(),
      };
      artifactBytesCache = releaseCache;
    }
    if (!releaseCache || releaseCache.releaseKey !== releaseKey) return null;
    return {
      release: stable.release,
      approvalSha256: stable.approvalSha256,
      releaseKey,
      artifactBytes: releaseCache.bytes,
    };
  }

  function artifactBytesFor(releaseKey: string) {
    if (!artifactBytesCache || artifactBytesCache.releaseKey !== releaseKey) {
      artifactBytesCache = {
        releaseKey,
        bytes: new Map<ExtensionTarget, Promise<Buffer>>(),
      };
    }
    return artifactBytesCache.bytes;
  }

  function verifiedDownloadUrl(
    release: VerifiedExtensionReleaseSet,
    artifact: VerifiedExtensionReleaseArtifact,
  ) {
    return `/api/extensions/download/${artifact.target}/${release.version}/${artifact.zipSha256}`;
  }

  async function sendVerifiedArtifact(
    current: CurrentRelease | null,
    target: ExtensionTarget,
    reply: FastifyReply,
  ) {
    if (!current) {
      return reply.status(404).send({ code: 0, msg: '扩展发布证据不完整或无效' });
    }
    const artifact = current.release.artifacts[target];
    const artifactBytes = current.artifactBytes;
    let bytesPromise = artifactBytes.get(target);
    if (!bytesPromise) {
      bytesPromise = readVerifiedExtensionReleaseArtifact(current.release, target);
      artifactBytes.set(target, bytesPromise);
    }
    try {
      const bytes = await bytesPromise;
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      reply.header('Content-Length', String(bytes.length));
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Content-SHA256', artifact.zipSha256);
      if (current.approvalSha256) {
        reply.header('X-Publication-Approval-SHA256', current.approvalSha256);
      }
      return reply.send(bytes);
    } catch {
      if (artifactBytes.get(target) === bytesPromise) artifactBytes.delete(target);
      return reply.status(404).send({ code: 0, msg: '扩展发布证据不完整或无效' });
    }
  }

  app.get('/latest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const current = await currentRelease();
    if (current) {
      const { release, approvalSha256 } = current;
      const targets = Object.fromEntries(
        (['cloud', 'local'] as const).map((target) => [target, {
          filename: release.artifacts[target].filename,
          downloadUrl: verifiedDownloadUrl(release, release.artifacts[target]),
          sha256: release.artifacts[target].zipSha256,
        }]),
      ) as Record<ExtensionTarget, ExtensionReleaseTarget>;
      return reply.send({
        code: 1,
        data: {
          version: release.version,
          gitCommit: release.gitCommit,
          signatureStatus: release.signatureStatus,
          ...(approvalSha256 ? { publicationApprovalSha256: approvalSha256 } : {}),
          targets,
        },
      });
    }
    if (!allowDevelopmentFallback) {
      return reply.status(404).send({
        code: 0,
        msg: '扩展发布证据不完整或无效',
      });
    }

    const cloudManifest = await readOptionalBuiltManifest(buildRoot, 'cloud');
    if (!cloudManifest) {
      return reply.status(404).send({
        code: 0,
        msg: '云端扩展构建产物不存在，请先运行 pnpm package:extension:cloud',
      });
    }

    const cloudVersion = cloudManifest.version || '0.0.0';
    const targets: Partial<Record<ExtensionTarget, ExtensionReleaseTarget>> = {
      cloud: {
        filename: `ss-erp-cloud-${cloudVersion}.zip`,
        downloadUrl: '/api/extensions/download/cloud',
      },
    };

    const localManifest = await readOptionalBuiltManifest(buildRoot, 'local');
    if (localManifest) {
      const localVersion = localManifest.version || '0.0.0';
      targets.local = {
        filename: `ss-erp-local-${localVersion}.zip`,
        downloadUrl: '/api/extensions/download/local',
      };
    }

    return reply.send({
      code: 1,
      data: {
        version: cloudVersion,
        targets,
      },
    });
  });

  app.get<{
    Params: { target: string; version: string; sha256: string };
  }>('/download/:target/:version/:sha256', async (request, reply) => {
    const target = parseTarget(request.params.target);
    if (!target) {
      return reply.status(400).send({ code: 0, msg: 'target must be cloud or local' });
    }
    const current = await currentRelease();
    const artifact = current?.release.artifacts[target];
    if (!artifact
      || request.params.version !== current?.release.version
      || request.params.sha256 !== artifact.zipSha256) {
      return reply.status(404).send({ code: 0, msg: '扩展发布证据不完整或无效' });
    }
    return sendVerifiedArtifact(current, target, reply);
  });

  app.get<{ Params: { target: string } }>('/download/:target', async (request, reply) => {
    const target = parseTarget(request.params.target);
    if (!target) {
      return reply.status(400).send({ code: 0, msg: 'target must be cloud or local' });
    }

    const current = await currentRelease();
    if (current) {
      reply.header('Cache-Control', 'private, no-store');
      return reply.redirect(verifiedDownloadUrl(
        current.release,
        current.release.artifacts[target],
      ));
    }
    if (!allowDevelopmentFallback) {
      return reply.status(404).send({
        code: 0,
        msg: '扩展发布证据不完整或无效',
      });
    }

    let build;
    try {
      build = await buildExtensionEntries(buildRoot, target);
    } catch (error) {
      return reply.status(404).send({
        code: 0,
        msg: error instanceof Error ? error.message : `扩展 ${target} 构建产物不存在`,
      });
    }

    const { entries, version } = build;
    const filename = `ss-erp-${target}-${version}.zip`;
    const prebuiltZipPath = extensionZipPath(buildRoot, target, version);
    const zip = existsSync(prebuiltZipPath) ? await readFile(prebuiltZipPath) : createZip(entries);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', String(zip.length));
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(zip);
  });
}
