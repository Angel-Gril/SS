import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  openSync,
  rmSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const descriptor = openSync(directory, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function writeNewArtifactDurably(finalPath, value, { mode = 0o644 } = {}) {
  const absolute = path.resolve(finalPath);
  const directory = path.dirname(absolute);
  const temporary = path.join(
    directory,
    `.${path.basename(absolute)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  let descriptor = null;
  let finalLinked = false;
  try {
    descriptor = openSync(temporary, 'wx', mode);
    // openSync applies the process umask; release artifacts require the exact
    // mode contract even when deployment runs with umask 077.
    fchmodSync(descriptor, mode);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (written < 1) throw new Error(`Unable to complete extension artifact write: ${absolute}`);
      offset += written;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;

    // A same-directory hard link is atomic and fails if the final name already exists.
    linkSync(temporary, absolute);
    finalLinked = true;
    syncDirectory(directory);
    rmSync(temporary);
    syncDirectory(directory);
    return { bytes: bytes.length, path: absolute };
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor);
      } catch {
        // Preserve the original write failure.
      }
    }
    if (finalLinked) {
      try {
        rmSync(absolute, { force: true });
      } catch {
        // The original durability error remains the actionable failure.
      }
    }
    try {
      rmSync(temporary, { force: true });
    } catch {
      // A hidden temporary inode is never accepted as a release artifact.
    }
    throw error;
  }
}
