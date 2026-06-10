import type { FastifyInstance } from 'fastify';
import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

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
}

function findExtensionBuildRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../../build/extensions'),
    path.resolve(process.cwd(), 'build/extensions'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function getExtensionBuildRoot(): string {
  const found = findExtensionBuildRoot();
  if (!found) {
    throw new Error('扩展构建目录不存在：build/extensions');
  }
  return found;
}

function getExtensionBuildDir(target: ExtensionTarget): string {
  return path.join(getExtensionBuildRoot(), `ss-erp-${target}`);
}

async function readOptionalBuiltManifest(target: ExtensionTarget): Promise<BuiltManifest | null> {
  const buildRoot = findExtensionBuildRoot();
  if (!buildRoot) return null;
  const manifestPath = path.join(buildRoot, `ss-erp-${target}`, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(await readFile(manifestPath, 'utf8')) as BuiltManifest;
}

function extensionZipPath(target: ExtensionTarget, version: string): string {
  return path.join(getExtensionBuildRoot(), `ss-erp-${target}-${version}.zip`);
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

async function buildExtensionEntries(target: ExtensionTarget): Promise<{ entries: ZipEntry[]; version: string }> {
  const buildDir = getExtensionBuildDir(target);
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

export async function extensionDownloadRoutes(app: FastifyInstance) {
  app.get('/latest', async (_request, reply) => {
    const cloudManifest = await readOptionalBuiltManifest('cloud');
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

    const localManifest = await readOptionalBuiltManifest('local');
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

  app.get('/download/:target', async (request, reply) => {
    const target = parseTarget((request.params as { target: string }).target);
    if (!target) {
      return reply.status(400).send({ code: 0, msg: 'target must be cloud or local' });
    }

    let build;
    try {
      build = await buildExtensionEntries(target);
    } catch (error) {
      return reply.status(404).send({
        code: 0,
        msg: error instanceof Error ? error.message : `扩展 ${target} 构建产物不存在`,
      });
    }

    const { entries, version } = build;
    const filename = `ss-erp-${target}-${version}.zip`;
    const prebuiltZipPath = extensionZipPath(target, version);
    const zip = existsSync(prebuiltZipPath) ? await readFile(prebuiltZipPath) : createZip(entries);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', String(zip.length));
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(zip);
  });
}
