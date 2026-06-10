import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { extensionDownloadRoutes } from '../routes/extensions.js';

async function writeManifest(filePath: string, version: string, name: string) {
  await writeFile(
    filePath,
    `${JSON.stringify({
      manifest_version: 3,
      name,
      short_name: name,
      version,
      permissions: [],
    }, null, 2)}\n`,
    'utf8',
  );
}

describe('extensionDownloadRoutes', () => {
  it('serves the prebuilt target artifact instead of rebuilding from source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ss-erp-extension-download-'));
    await mkdir(path.join(root, 'extensions', 'ss-erp'), { recursive: true });
    await mkdir(path.join(root, 'build', 'extensions', 'ss-erp-cloud'), { recursive: true });

    await writeManifest(
      path.join(root, 'extensions', 'ss-erp', 'manifest.json'),
      '1.0.1',
      'Source Extension',
    );
    await writeManifest(
      path.join(root, 'build', 'extensions', 'ss-erp-cloud', 'manifest.json'),
      '1.0.2',
      'Built Cloud Extension',
    );
    await writeFile(
      path.join(root, 'build', 'extensions', 'ss-erp-cloud-1.0.2.zip'),
      'prebuilt cloud zip payload',
      'utf8',
    );

    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      const app = Fastify();
      await app.register(extensionDownloadRoutes, { prefix: '/api/extensions' });

      const latest = await app.inject({ method: 'GET', url: '/api/extensions/latest' });
      expect(latest.statusCode).toBe(200);
      expect(latest.json().data.version).toBe('1.0.2');
      expect(latest.json().data.targets.cloud.filename).toBe('ss-erp-cloud-1.0.2.zip');
      expect(latest.json().data.targets.local).toBeUndefined();

      const response = await app.inject({ method: 'GET', url: '/api/extensions/download/cloud' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain('ss-erp-cloud-1.0.2.zip');
      expect(response.body).toBe('prebuilt cloud zip payload');

      const missingLocal = await app.inject({ method: 'GET', url: '/api/extensions/download/local' });
      expect(missingLocal.statusCode).toBe(404);
      expect(missingLocal.json().code).toBe(0);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
