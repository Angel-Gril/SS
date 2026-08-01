#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { lstatSync, rmSync } from 'node:fs';
import path from 'node:path';
import { loadProtectedSigningKey } from './sign-extension-release.mjs';
import { writeNewArtifactDurably } from './extension-release-artifact.mjs';
import {
  assertRealDirectoryTree,
  parseTrustedKeyring,
  sha256,
} from './extension-release-publication-contract.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

function fail(message) {
  throw new Error(message);
}

function main() {
  if (process.argv.length !== 2) fail('this command accepts no arguments');
  const keyPath = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_PATH || '').trim();
  const keyId = String(process.env.EXTENSION_RELEASE_SIGNING_KEY_ID || '').trim();
  if (!keyPath || !keyId) {
    fail('EXTENSION_RELEASE_SIGNING_KEY_PATH and _KEY_ID are required');
  }
  const absolute = path.resolve(keyPath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    fail('signing key must be stored outside the repository');
  }
  const parentPath = path.dirname(absolute);
  assertRealDirectoryTree(parentPath, 'signing key parent');
  const parent = lstatSync(parentPath, { throwIfNoEntry: false });
  if (!parent?.isDirectory() || parent.isSymbolicLink()) {
    fail('signing key parent must be one existing real private directory');
  }
  if (lstatSync(absolute, { throwIfNoEntry: false })) fail('signing key already exists');

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyBytes = publicKey.export({ type: 'spki', format: 'der' });
  const key = parseTrustedKeyring({
    schemaVersion: 1,
    kind: 'SS_ERP_EXTENSION_RELEASE_TRUSTED_KEYS',
    keys: [{
      algorithm: 'Ed25519',
      keyId,
      publicKeyBase64: publicKeyBytes.toString('base64'),
      status: 'ACTIVE',
    }],
  }).keys[0];
  const privateKeyBytes = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }), 'utf8');
  try {
    writeNewArtifactDurably(absolute, privateKeyBytes, { mode: 0o600 });
    loadProtectedSigningKey(absolute);
  } catch (error) {
    rmSync(absolute, { force: true });
    throw error;
  } finally {
    privateKeyBytes.fill(0);
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    key,
    publicKeySha256: sha256(publicKeyBytes),
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
