import { createHash } from 'node:crypto';
import { mkdtemp, open as actualOpen, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

const filesystemFaults = vi.hoisted(() => ({ mutateOnReadPath: null as string | null }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    open: async (...args: Parameters<typeof actualOpen>) => {
      const handle = await original.open(...args);
      if (String(args[0]) !== filesystemFaults.mutateOnReadPath) return handle;
      let mutated = false;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'read') {
            return async (...readArgs: Parameters<typeof handle.read>) => {
              if (!mutated) {
                mutated = true;
                const appendHandle = await original.open(args[0], 'a');
                try {
                  await appendHandle.write(Buffer.from([0]));
                } finally {
                  await appendHandle.close();
                }
              }
              return target.read(...readArgs);
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

import {
  AiImageSandboxMediaError,
  assertMeaningfulAiImageSandboxMask,
  loadPinnedAiImageSandboxMedia,
} from '../services/ai-image-sandbox-media.js';

const directories: string[] = [];

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-media-'));
  directories.push(value);
  return value;
}

async function pinned(path: string, bytes: Buffer, requirePng = false) {
  await writeFile(path, bytes, { mode: 0o600 });
  return loadPinnedAiImageSandboxMedia({
    path,
    expectedSha256: sha256(bytes),
    label: 'sandbox fixture',
    requirePng,
  });
}

afterEach(async () => {
  filesystemFaults.mutateOnReadPath = null;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('AI image sandbox pinned media verifier', () => {
  it.skipIf(process.platform === 'win32')('rejects a final-entry symbolic link', async () => {
    const path = await directory();
    const target = join(path, 'target.png');
    const link = join(path, 'linked.png');
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    await writeFile(target, bytes, { mode: 0o600 });
    await symlink(target, link, 'file');

    await expect(loadPinnedAiImageSandboxMedia({
      path: link,
      expectedSha256: sha256(bytes),
      label: 'linked fixture',
    })).rejects.toMatchObject({
      name: 'AiImageSandboxMediaError',
      code: 'SANDBOX_MEDIA_INVALID',
      message: 'linked fixture cannot be opened safely',
    });
  });

  it('rejects unsupported and animated media after digest verification', async () => {
    const path = await directory();
    const unsupported = Buffer.from('not an image', 'utf8');
    await expect(pinned(join(path, 'unsupported.bin'), unsupported)).rejects.toBeInstanceOf(
      AiImageSandboxMediaError,
    );

    const width = 2;
    const height = 2;
    const frameBytes = width * height * 3;
    const animated = await sharp(Buffer.concat([
      Buffer.alloc(frameBytes, 0),
      Buffer.alloc(frameBytes, 255),
    ]), {
      raw: { width, height: height * 2, pageHeight: height, channels: 3 },
    }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(pinned(join(path, 'animated.webp'), animated)).rejects.toMatchObject({
      code: 'SANDBOX_MEDIA_INVALID',
      message: 'sandbox fixture has unsupported media properties',
    });
  });

  it('detects descriptor content growth while reading', async () => {
    const path = await directory();
    const mediaPath = join(path, 'mutating.png');
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    await writeFile(mediaPath, bytes, { mode: 0o600 });
    filesystemFaults.mutateOnReadPath = mediaPath;

    await expect(loadPinnedAiImageSandboxMedia({
      path: mediaPath,
      expectedSha256: sha256(bytes),
      label: 'mutating fixture',
    })).rejects.toMatchObject({
      code: 'SANDBOX_MEDIA_INVALID',
      message: 'mutating fixture changed while it was being read',
    });
  });

  it('rejects masks without both transparent and opaque alpha regions', async () => {
    const path = await directory();
    const rgb = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    }).png().toBuffer();
    const transparent = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      },
    }).png().toBuffer();
    const opaque = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    }).png().toBuffer();

    for (const [name, bytes] of [
      ['rgb', rgb],
      ['transparent', transparent],
      ['opaque', opaque],
    ] as const) {
      const mask = await pinned(join(path, `${name}.png`), bytes, true);
      await expect(assertMeaningfulAiImageSandboxMask(mask)).rejects.toMatchObject({
        code: 'SANDBOX_MEDIA_INVALID',
      });
    }
  });
});
