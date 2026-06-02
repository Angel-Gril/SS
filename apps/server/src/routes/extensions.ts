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

const CLOUD_HOST_PERMISSIONS = [
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://docs.ozon.ru/*',
  'https://docs.ozon.com/*',
  'https://open.er-api.com/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
  'https://detail.1688.com/*',
  'https://trade.1688.com/*',
  'https://mobile.pinduoduo.com/*',
  'https://www.temu.com/*',
  'https://*.aliexpress.com/*',
  'https://www.wildberries.ru/*',
  'https://item.jd.com/*',
  'https://item.taobao.com/*',
  'https://detail.tmall.com/*',
];

const CLOUD_ERP_MATCHES = [
  'https://ss-erp.com/*',
  'https://*.ss-erp.com/*',
];

const CLOUD_WEB_RESOURCE_MATCHES = [
  ...CLOUD_ERP_MATCHES,
  'https://seller.ozon.ru/*',
  'https://globalcalculator.ozon.ru/*',
  'https://*.ozon.ru/*',
  'https://*.ozon.kz/*',
  'https://*.ozon.by/*',
];

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stripLocalAndBroad(values: string[]): string[] {
  return unique(values.filter((value) => (
    value !== '<all_urls>' &&
    value !== 'file:///*' &&
    !value.includes('localhost') &&
    !value.includes('127.0.0.1') &&
    !value.includes('120.55.61.146')
  )));
}

function getExtensionSourceDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../extensions/ss-erp'),
    path.resolve(process.cwd(), 'extensions/ss-erp'),
  ];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'manifest.json')));
  if (!found) {
    throw new Error(`扩展源码目录不存在：${candidates.join(' 或 ')}`);
  }
  return found;
}

function transformManifest(raw: Buffer, target: ExtensionTarget): Buffer {
  const manifest = JSON.parse(raw.toString('utf8'));
  if (target === 'cloud') {
    manifest.name = `${manifest.name} (Cloud)`;
    manifest.short_name = 'SS ERP Cloud';
    manifest.host_permissions = CLOUD_HOST_PERMISSIONS;
    manifest.externally_connectable = {
      ...(manifest.externally_connectable || {}),
      matches: CLOUD_ERP_MATCHES,
    };
    manifest.content_scripts = (manifest.content_scripts || [])
      .map((script: any) => {
        const next = { ...script };
        const js = script.js || [];
        if (js.includes('content/calculator-sync-bridge.js')) {
          return null;
        }
        if (js.includes('content/erp-collect-bridge.js')) {
          next.matches = CLOUD_ERP_MATCHES;
        } else {
          next.matches = stripLocalAndBroad(script.matches || []);
        }
        if (next.exclude_matches) next.exclude_matches = stripLocalAndBroad(next.exclude_matches);
        return next.matches.length ? next : null;
      })
      .filter(Boolean);
    manifest.web_accessible_resources = (manifest.web_accessible_resources || []).map((group: any) => ({
      ...group,
      matches: CLOUD_WEB_RESOURCE_MATCHES,
    }));
  } else {
    manifest.name = `${manifest.name} (Local)`;
    manifest.short_name = 'SS ERP Local';
  }
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
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
  const sourceDir = getExtensionSourceDir();
  const files = await listFiles(sourceDir);
  const rootName = `ss-erp-${target}`;
  let version = '0.0.0';
  const entries: ZipEntry[] = [];

  for (const relative of files) {
    const absolute = path.join(sourceDir, relative);
    const fileStat = await stat(absolute);
    const normalizedRelative = relative.split(path.sep).join('/');
    let data = await readFile(absolute);
    if (normalizedRelative === 'manifest.json') {
      const rawManifest = JSON.parse(data.toString('utf8'));
      version = rawManifest.version || version;
      data = transformManifest(data, target);
    }
    entries.push({
      name: `${rootName}/${normalizedRelative}`,
      data,
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
    const sourceDir = getExtensionSourceDir();
    const manifest = JSON.parse(await readFile(path.join(sourceDir, 'manifest.json'), 'utf8'));
    const version = manifest.version || '0.0.0';
    return reply.send({
      code: 1,
      data: {
        version,
        targets: {
          cloud: {
            filename: `ss-erp-cloud-${version}.zip`,
            downloadUrl: '/api/extensions/download/cloud',
          },
          local: {
            filename: `ss-erp-local-${version}.zip`,
            downloadUrl: '/api/extensions/download/local',
          },
        },
      },
    });
  });

  app.get('/download/:target', async (request, reply) => {
    const target = parseTarget((request.params as { target: string }).target);
    if (!target) {
      return reply.status(400).send({ code: 0, msg: 'target must be cloud or local' });
    }

    const { entries, version } = await buildExtensionEntries(target);
    const zip = createZip(entries);
    const filename = `ss-erp-${target}-${version}.zip`;

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Length', String(zip.length));
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(zip);
  });
}
