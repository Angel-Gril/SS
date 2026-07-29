import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  open as actualOpen,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const filesystemFaults = vi.hoisted(() => ({
  afterClaimClose: null as null | (() => Promise<void>),
  beforeFingerprintDirectoryOpen: null as null | (() => Promise<void>),
  failIntentOpen: false,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    open: async (...args: Parameters<typeof actualOpen>) => {
      const path = String(args[0]);
      if (filesystemFaults.failIntentOpen && path.endsWith('.intent.json')) {
        filesystemFaults.failIntentOpen = false;
        throw Object.assign(new Error('forced intent write failure'), { code: 'EACCES' });
      }
      if (path.endsWith('/.fingerprints') && filesystemFaults.beforeFingerprintDirectoryOpen) {
        const beforeOpen = filesystemFaults.beforeFingerprintDirectoryOpen;
        filesystemFaults.beforeFingerprintDirectoryOpen = null;
        await beforeOpen();
      }
      const handle = await original.open(...args);
      if (!path.endsWith('.claim.json') || !filesystemFaults.afterClaimClose) return handle;
      const afterClose = filesystemFaults.afterClaimClose;
      filesystemFaults.afterClaimClose = null;
      const close = handle.close.bind(handle);
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'close') {
            return async () => {
              await close();
              await afterClose();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
});

import { claimAiImageSandboxOperation } from '../services/ai-image-sandbox-guard.js';

const directories: string[] = [];
const SANDBOX_NOW = new Date('2030-01-01T00:10:00.000Z');

async function directory() {
  const value = await mkdtemp(join(tmpdir(), 'ss-erp-ai-image-sandbox-filesystem-'));
  directories.push(value);
  return value;
}

function input(path: string, operationId: string) {
  const endpoint = 'https://relay.example/v1/images/generations';
  return {
    directory: path,
    operationId,
    endpointSha256: createHash('sha256').update(endpoint).digest('hex'),
    model: 'opaque-model-alias',
    credentialRevision: 'admin-config-rev-0001',
    adapterRevision: '35cb9b8cf14a44c5f449c5065d7f2dbf441c9ad3',
    now: SANDBOX_NOW,
    request: {
      operation: 'TEXT_TO_IMAGE',
      requestProfile: 'OPENAI_SQUARE_SINGLE_V1',
      endpoint,
      n: 1,
      width: 1024,
      height: 1024,
      size: '1024x1024',
      promptSha256: createHash('sha256').update('fixed prompt').digest('hex'),
      sourceSha256: [],
      sourceDimensions: [],
      maskSha256: null,
      maskDimensions: null,
      approvalEvidence: {
        approvalId: `approval-${operationId}`,
        approvalSha256: 'a'.repeat(64),
        approvedAt: '2030-01-01T00:00:00.000Z',
        expiresAt: '2030-01-01T00:30:00.000Z',
        approverRefSha256: 'b'.repeat(64),
        providerAccountRefSha256: 'c'.repeat(64),
        pricingRevisionSha256: 'd'.repeat(64),
        currency: 'USD',
        preCallBillingSnapshotRefSha256: 'e'.repeat(64),
        billingReconciliationRefSha256: 'f'.repeat(64),
      },
    },
    quotedCostCents: 10,
    maximumCostCents: 20,
  };
}

afterEach(async () => {
  filesystemFaults.afterClaimClose = null;
  filesystemFaults.beforeFingerprintDirectoryOpen = null;
  filesystemFaults.failIntentOpen = false;
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('single-submit sandbox claim filesystem boundaries', () => {
  it.skipIf(process.platform !== 'linux')(
    'pins the fingerprint child through the held intent directory descriptor',
    async () => {
      const container = await directory();
      const visible = join(container, 'intents');
      const displaced = join(container, 'intents-displaced');
      filesystemFaults.beforeFingerprintDirectoryOpen = async () => {
        await rename(visible, displaced);
        await mkdir(join(visible, '.fingerprints'), { recursive: true, mode: 0o700 });
        await chmod(visible, 0o700);
        await chmod(join(visible, '.fingerprints'), 0o700);
      };

      await expect(claimAiImageSandboxOperation(
        input(visible, 'sandbox-child-swap-first-0001'),
      )).rejects.toMatchObject({ code: 'SANDBOX_EVIDENCE_DIRECTORY_CHANGED' });

      expect(await readdir(join(displaced, '.fingerprints'))).toHaveLength(1);
      await expect(readFile(join(displaced, 'sandbox-child-swap-first-0001.intent.json')))
        .resolves.toBeDefined();
      expect(await readdir(join(visible, '.fingerprints'))).toHaveLength(0);
      await expect(readFile(join(visible, 'sandbox-child-swap-first-0001.intent.json')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it.skipIf(process.platform !== 'linux')(
    'fails closed when the visible intent directory is replaced after the fingerprint claim',
    async () => {
      const container = await directory();
      const visible = join(container, 'intents');
      const displaced = join(container, 'intents-displaced');
      filesystemFaults.afterClaimClose = async () => {
        await rename(visible, displaced);
        await mkdir(join(visible, '.fingerprints'), { recursive: true, mode: 0o700 });
        await chmod(visible, 0o700);
        await chmod(join(visible, '.fingerprints'), 0o700);
      };

      await expect(claimAiImageSandboxOperation(
        input(visible, 'sandbox-parent-swap-first-0001'),
      )).rejects.toMatchObject({ code: 'SANDBOX_EVIDENCE_DIRECTORY_CHANGED' });

      expect(await readdir(join(displaced, '.fingerprints'))).toHaveLength(1);
      await expect(readFile(join(displaced, 'sandbox-parent-swap-first-0001.intent.json')))
        .resolves.toBeDefined();
      await expect(readFile(join(visible, 'sandbox-parent-swap-first-0001.intent.json')))
        .rejects.toMatchObject({ code: 'ENOENT' });
      await expect(claimAiImageSandboxOperation(
        input(visible, 'sandbox-parent-swap-second-0002'),
      )).resolves.toBeDefined();
    },
  );

  it.skipIf(process.platform !== 'linux')(
    'fails closed when only the visible fingerprint directory is replaced after its claim',
    async () => {
      const container = await directory();
      const path = join(container, 'intents');
      const visibleFingerprints = join(path, '.fingerprints');
      const displacedFingerprints = join(path, '.fingerprints-displaced');
      filesystemFaults.afterClaimClose = async () => {
        await rename(visibleFingerprints, displacedFingerprints);
        await mkdir(visibleFingerprints, { mode: 0o700 });
        await chmod(visibleFingerprints, 0o700);
      };

      await expect(claimAiImageSandboxOperation(
        input(path, 'sandbox-child-swap-second-0001'),
      )).rejects.toMatchObject({ code: 'SANDBOX_EVIDENCE_DIRECTORY_CHANGED' });

      expect(await readdir(displacedFingerprints)).toHaveLength(1);
      expect(await readdir(visibleFingerprints)).toHaveLength(0);
      await expect(readFile(join(path, 'sandbox-child-swap-second-0001.intent.json')))
        .resolves.toBeDefined();
    },
  );

  it('retains a fail-closed fingerprint claim when intent creation fails', async () => {
    const container = await directory();
    const path = join(container, 'intents');
    filesystemFaults.failIntentOpen = true;

    await expect(claimAiImageSandboxOperation(
      input(path, 'sandbox-orphan-claim-first-0001'),
    )).rejects.toMatchObject({ code: 'EACCES' });
    await expect(claimAiImageSandboxOperation(
      input(path, 'sandbox-orphan-claim-second-0002'),
    )).rejects.toMatchObject({ code: 'SANDBOX_REQUEST_REPLAY' });
    expect(await readdir(join(path, '.fingerprints'))).toHaveLength(1);
    await expect(readFile(join(path, 'sandbox-orphan-claim-first-0001.intent.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
