import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { getOwnedImageStorageBackend } from '../services/image-storage.js';
import { createSourceListingMediaImportService } from '../services/source-listing-media-import.js';
import { createPrismaSourceListingMediaImportStore } from '../services/source-listing-media-import-prisma.js';
import { runSourceCaptureImageTransfer } from '../services/source-capture-image-transfer.js';
import { createPrismaSourceCaptureImageTransferStore } from '../services/source-capture-image-transfer-prisma.js';

export function startSourceCaptureImageTransferWorker() {
  const store = createPrismaSourceCaptureImageTransferStore(prisma);
  const importer = createSourceListingMediaImportService({
    ...createPrismaSourceListingMediaImportStore(prisma),
    getCaptureStorageBackend: getOwnedImageStorageBackend,
    getStorageBackend: getOwnedImageStorageBackend,
  });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    try {
      // One capture at a time; durable pending markers survive API/Worker restarts.
      await runSourceCaptureImageTransfer({ store, internalizeCapture: importer.internalizeCapture,
        now: () => new Date(), createLeaseId: randomUUID });
    } catch {
      console.error('[source-capture-image-transfer] tick failed');
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, 5_000);
        timer.unref();
      }
    }
  };
  timer = setTimeout(tick, 1_000);
  timer.unref();
  registerTimer(() => { stopped = true; if (timer) clearTimeout(timer); });
}
