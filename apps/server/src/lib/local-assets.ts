import { dirname, isAbsolute, join, resolve } from 'path';

export type LocalAssetKind = 'uploads' | 'watermarked' | 'resized';

const assetKinds = new Set<LocalAssetKind>(['uploads', 'watermarked', 'resized']);

function resolveUploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (!configured) {
    return join(process.cwd(), 'public', 'uploads');
  }
  return isAbsolute(configured) ? configured : join(process.cwd(), configured);
}

export function getLocalAssetDir(kind: LocalAssetKind): string {
  if (!process.env.UPLOAD_DIR?.trim()) {
    return join(process.cwd(), 'public', kind);
  }

  const uploadDir = resolveUploadDir();
  if (kind === 'uploads') {
    return uploadDir;
  }
  return join(dirname(uploadDir), kind);
}

export function getLocalAssetPath(urlPath: string): string | null {
  const parts = String(urlPath || '')
    .replace(/^\/+/, '')
    .split(/[\\/]+/)
    .filter(Boolean);
  const kind = parts.shift() as LocalAssetKind | undefined;
  if (!kind || !assetKinds.has(kind) || parts.length === 0) {
    return null;
  }

  if (parts.some((part) => part === '.' || part === '..')) {
    return null;
  }

  const baseDir = resolve(getLocalAssetDir(kind));
  const target = resolve(baseDir, ...parts);
  if (target !== baseDir && target.startsWith(`${baseDir}${process.platform === 'win32' ? '\\' : '/'}`)) {
    return target;
  }

  return null;
}
