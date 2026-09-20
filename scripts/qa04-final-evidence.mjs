import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonicalJson = value => `${JSON.stringify(value, null, 2)}\n`;
export const sortedJson = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(sortedJson).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedJson(value[key])}`).join(',')}}`;
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const isCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function requireThat(condition, code) {
  if (!condition) fail(code);
}

export function exactKeys(value, keys, code = 'QA04_INPUT_INVALID') {
  requireThat(isRecord(value) && sortedJson(Object.keys(value).sort()) === sortedJson([...keys].sort()), code);
}

export function canonicalTimestamp(value, code) {
  requireThat(typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value, code);
  return Date.parse(value);
}

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

export function realDirectory(filename, code) {
  try {
    requireThat(typeof filename === 'string' && path.isAbsolute(filename), code);
    const absolute = path.resolve(filename), info = lstatSync(absolute);
    requireThat(info.isDirectory() && !info.isSymbolicLink() && samePath(realpathSync(absolute), absolute), code);
    return absolute;
  } catch { fail(code); }
}

export function privateOutputPath(filename, repositoryRoot) {
  const code = 'QA04_OUTPUT_UNSAFE';
  try {
    requireThat(typeof filename === 'string' && path.isAbsolute(filename) && !filename.startsWith('\\\\'), code);
    const absolute = path.resolve(filename), directory = realDirectory(path.dirname(absolute), code);
    requireThat(!isWithin(repositoryRoot, absolute) && !lstatSync(absolute, { throwIfNoEntry: false }), code);
    requireThat(!absolute.slice(path.parse(absolute).root.length).includes(':'), code);
    if (process.platform !== 'win32') requireThat((lstatSync(directory).mode & 0o077) === 0, code);
    return absolute;
  } catch { fail(code); }
}

function sameStat(left, right) {
  return ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].every(key => left[key] === right[key]);
}

// Reads only caller-pinned local evidence. No token loader or remote lookup is reachable.
export function evidenceReader() {
  let totalBytes = 0;
  const read = (reference, maximumBytes = 1024 * 1024) => {
    exactKeys(reference, ['path', 'sha256']);
    requireThat(typeof reference.path === 'string' && path.isAbsolute(reference.path)
      && isSha256(reference.sha256), 'QA04_INPUT_INVALID');
    let descriptor;
    try {
      const filename = path.resolve(reference.path);
      requireThat(!filename.startsWith('\\\\') && !filename.slice(path.parse(filename).root.length).includes(':'), 'QA04_ARTIFACT_UNSAFE');
      const before = lstatSync(filename, { bigint: true });
      requireThat(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n
        && before.size > 0n && before.size <= BigInt(maximumBytes)
        && samePath(realpathSync(filename), filename), 'QA04_ARTIFACT_UNSAFE');
      if (process.platform !== 'win32') requireThat((before.mode & 0o077n) === 0n, 'QA04_ARTIFACT_UNSAFE');
      descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      requireThat(sameStat(before, fstatSync(descriptor, { bigint: true })), 'QA04_ARTIFACT_CHANGED');
      const bytes = Buffer.alloc(Number(before.size) + 1);
      let length = 0;
      while (length < bytes.length) {
        const count = readSync(descriptor, bytes, length, bytes.length - length, null);
        if (count === 0) break;
        length += count;
      }
      requireThat(length === Number(before.size)
        && sameStat(before, fstatSync(descriptor, { bigint: true }))
        && sameStat(before, lstatSync(filename, { bigint: true }))
        && samePath(realpathSync(filename), filename), 'QA04_ARTIFACT_CHANGED');
      totalBytes += length;
      requireThat(totalBytes <= 192 * 1024 * 1024, 'QA04_ARTIFACT_UNSAFE');
      const result = bytes.subarray(0, length);
      requireThat(sha256(result) === reference.sha256, 'QA04_ARTIFACT_CHANGED');
      return result;
    } catch (error) {
      if (error.code?.startsWith('QA04_')) throw error;
      fail('QA04_ARTIFACT_UNSAFE');
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  };
  return {
    read,
    json(reference, code, { nativeCompact = false } = {}) {
      const bytes = read(reference);
      try {
        const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const parsed = JSON.parse(value);
        const normalized = value.replace(/\r\n/gu, '\n');
        requireThat(isRecord(parsed) && (normalized === canonicalJson(parsed)
          || (nativeCompact && normalized === `${JSON.stringify(parsed)}\n`)), code);
        return parsed;
      } catch (error) {
        if (error.code?.startsWith('QA04_')) throw error;
        fail(code);
      }
    },
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, number) => {
  let crc = number;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// The archived sample contract is a bounded, non-interlaced, single-frame PNG.
// Check chunks and decompressed scanlines, not just a caller-supplied MIME/header.
export function pngEvidence(reader, reference, code) {
  const bytes = reader.read(reference, 32 * 1024 * 1024);
  try {
    requireThat(bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), code);
    let cursor = 8, width, height, depth, color, ended = false, dataEnded = false;
    const data = [];
    while (cursor < bytes.length) {
      requireThat(cursor + 12 <= bytes.length, code);
      const length = bytes.readUInt32BE(cursor), name = bytes.subarray(cursor + 4, cursor + 8).toString('ascii');
      const end = cursor + length + 12;
      requireThat(end <= bytes.length && /^[A-Za-z]{4}$/u.test(name)
        && crc32(bytes.subarray(cursor + 4, end - 4)) === bytes.readUInt32BE(end - 4), code);
      const chunk = bytes.subarray(cursor + 8, end - 4);
      if (cursor === 8) {
        requireThat(name === 'IHDR' && length === 13, code);
        width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; color = chunk[9];
        const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
        requireThat(width > 0 && height > 0 && width <= 4096 && height <= 4096
          && width * height <= 16_777_216 && depths[color]?.includes(depth)
          && chunk[10] === 0 && chunk[11] === 0 && chunk[12] === 0, code);
      } else {
        requireThat(name !== 'IHDR' && !['acTL', 'fcTL', 'fdAT'].includes(name), code);
        if (name === 'IDAT') {
          requireThat(!dataEnded, code); data.push(chunk);
        } else if (data.length) dataEnded = true;
        if (name === 'IEND') {
          requireThat(length === 0 && end === bytes.length, code); ended = true;
        } else if (name[0] === name[0].toUpperCase()) requireThat(['IDAT', 'PLTE'].includes(name), code);
      }
      cursor = end;
    }
    requireThat(ended && data.length > 0, code);
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
    const rowLength = Math.ceil(width * channels * depth / 8) + 1, decodedLength = rowLength * height;
    requireThat(decodedLength <= 128 * 1024 * 1024, code);
    const decoded = inflateSync(Buffer.concat(data), { maxOutputLength: decodedLength });
    requireThat(decoded.length === decodedLength, code);
    for (let row = 0; row < height; row++) requireThat(decoded[row * rowLength] <= 4, code);
    return { sha256: reference.sha256, width, height, bytes: bytes.length, mimeType: 'image/png' };
  } catch { fail(code); }
}

export function jpegEvidence(reader, reference, code) {
  const bytes = reader.read(reference, 32 * 1024 * 1024);
  try {
    requireThat(bytes.length >= 16 && bytes[0] === 0xff && bytes[1] === 0xd8, code);
    let cursor = 2, width, height, frameSeen = false, scanSeen = false, ended = false;
    while (cursor < bytes.length) {
      requireThat(bytes[cursor] === 0xff, code);
      while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
      requireThat(cursor < bytes.length, code);
      const marker = bytes[cursor++];
      if (marker === 0xd9) {
        requireThat(scanSeen && cursor === bytes.length, code);
        ended = true;
        break;
      }
      requireThat(marker !== 0x00 && marker !== 0xd8 && !(marker >= 0xd0 && marker <= 0xd7) && marker !== 0x01, code);
      requireThat(cursor + 2 <= bytes.length, code);
      const length = bytes.readUInt16BE(cursor);
      requireThat(length >= 2 && cursor + length <= bytes.length, code);
      const start = cursor + 2, end = cursor + length;
      if (marker === 0xc0) {
        requireThat(!frameSeen && length >= 11 && bytes[start] === 8, code);
        height = bytes.readUInt16BE(start + 1); width = bytes.readUInt16BE(start + 3);
        const components = bytes[start + 5];
        requireThat((components === 1 || components === 3) && length === 8 + components * 3
          && width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 40_000_000, code);
        frameSeen = true;
      } else if ((marker >= 0xc1 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        fail(code);
      } else if (marker === 0xda) {
        requireThat(frameSeen && !scanSeen && length >= 8, code);
        const components = bytes[start];
        requireThat((components === 1 || components === 3) && length === 6 + components * 2, code);
        scanSeen = true;
        cursor = end;
        let scanEnded = false;
        while (cursor < bytes.length) {
          if (bytes[cursor] !== 0xff) { cursor += 1; continue; }
          requireThat(cursor + 1 < bytes.length, code);
          const next = bytes[cursor + 1];
          if (next === 0x00 || next >= 0xd0 && next <= 0xd7) { cursor += 2; continue; }
          if (next === 0xd9) {
            cursor += 2;
            requireThat(cursor === bytes.length, code);
            ended = true;
            scanEnded = true;
            break;
          }
          scanEnded = true;
          break;
        }
        requireThat(scanEnded, code);
        if (ended) break;
        continue;
      }
      cursor = end;
    }
    requireThat(frameSeen && scanSeen && ended && width && height, code);
    return { bytes: bytes.length, sha256: sha256(bytes), width, height, mimeType: 'image/jpeg' };
  } catch (error) {
    if (error.code?.startsWith('QA04_')) throw error;
    fail(code);
  }
}

export function imageEvidence(reader, reference, code) {
  const bytes = reader.read(reference, 32 * 1024 * 1024);
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return pngEvidence(reader, reference, code);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegEvidence(reader, reference, code);
  fail(code);
}
