import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_BYOK_ADMIN_POLICY_VERSION,
  DEFAULT_EXTENSION_BYOK_ADMIN_POLICY_JSON,
  composeExtensionByokPolicyFromAdminControls,
  parseExtensionByokAdminPolicy,
  createExtensionByokSystemConfigPolicyLoader,
  createExtensionHostedAiFlagLoader,
} from '../services/extension-byok-admin-controls.js';
import {
  EXTENSION_BYOK_POLICY_VERSION,
  EXTENSION_BYOK_OPERATIONS,
} from '../services/extension-byok-policy.js';

describe('extension BYOK administrator controls', () => {
  it('persists an explicit analysis model opt-in without changing image permissions', async () => {
    const adminPolicy = { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 1, mode: 'pilot',
      ownerUserIds: ['owner'], shopIds: ['shop'], deviceSessionIds: ['device'],
      allowedOrigins: ['https://models.example.com'], allowedOperations: ['IMAGE_TO_IMAGE'], maxConcurrency: 1,
      analysisEnabled: true, allowedAnalysisModels: ['vision-model'] };
    const parsed = parseExtensionByokAdminPolicy(adminPolicy);
    expect(parsed).toMatchObject({ analysisEnabled: true, allowedAnalysisModels: ['vision-model'] });
    const composed = composeExtensionByokPolicyFromAdminControls({ generationEnabled: true, ingestEnabled: false,
      publishEnabled: false, adminPolicy });
    expect(composed).toMatchObject({ analysisEnabled: true, allowedAnalysisModels: ['vision-model'], allowedOperations: ['IMAGE_TO_IMAGE'] });
  });
  it('uses a closed, default-off admin policy', () => {
    const policy = parseExtensionByokAdminPolicy(DEFAULT_EXTENSION_BYOK_ADMIN_POLICY_JSON);
    expect(policy).toEqual({
      contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION,
      revision: 0,
      mode: 'off',
      ownerUserIds: [],
      shopIds: [],
      deviceSessionIds: [],
      allowedOrigins: [],
      allowedOperations: [],
      maxConcurrency: 1,
    });
  });

  it.each([
    { unexpected: true },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'global', ownerUserIds: [], shopIds: [], deviceSessionIds: [], allowedOrigins: [], allowedOperations: [], maxConcurrency: 1, apiKey: 'sk-secret' },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'global', ownerUserIds: [], shopIds: [], deviceSessionIds: [], allowedOrigins: ['http://provider.example'], allowedOperations: ['TEXT_TO_IMAGE'], maxConcurrency: 1 },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'global', ownerUserIds: [], shopIds: [], deviceSessionIds: [], allowedOrigins: ['https://localhost'], allowedOperations: ['TEXT_TO_IMAGE'], maxConcurrency: 1 },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'global', ownerUserIds: [], shopIds: [], deviceSessionIds: [], allowedOrigins: ['https://provider.example'], allowedOperations: ['UNKNOWN'], maxConcurrency: 1 },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'global', ownerUserIds: [], shopIds: [], deviceSessionIds: [], allowedOrigins: ['https://provider.example'], allowedOperations: ['TEXT_TO_IMAGE'], maxConcurrency: 5 },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'pilot', ownerUserIds: [], shopIds: ['shop-1'], deviceSessionIds: ['device-1'], allowedOrigins: ['https://provider.example'], allowedOperations: ['TEXT_TO_IMAGE'], maxConcurrency: 1 },
    { contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION, revision: 0, mode: 'pilot', ownerUserIds: ['sk-secret'], shopIds: ['shop-1'], deviceSessionIds: ['device-1'], allowedOrigins: ['https://provider.example'], allowedOperations: ['TEXT_TO_IMAGE'], maxConcurrency: 1 },
  ])('rejects malformed or secret-bearing policy %j', (value) => {
    expect(() => parseExtensionByokAdminPolicy(value)).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_BYOK_ADMIN_POLICY_INVALID' }),
    );
  });

  it('composes independent switches into the existing SRV-01 policy contract', () => {
    const result = composeExtensionByokPolicyFromAdminControls({
      generationEnabled: false,
      ingestEnabled: true,
      publishEnabled: false,
      adminPolicy: {
        contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION,
        revision: 4,
        mode: 'pilot',
        ownerUserIds: ['owner-1'],
        shopIds: ['shop-1'],
        deviceSessionIds: ['device-1'],
        allowedOrigins: ['https://provider.example'],
        allowedOperations: ['IMAGE_TO_IMAGE'],
        maxConcurrency: 2,
      },
    });
    expect(result).toMatchObject({
      contractVersion: EXTENSION_BYOK_POLICY_VERSION,
      mode: 'pilot',
      generationEnabled: false,
      ingestEnabled: true,
      publishEnabled: false,
      allowedOperations: ['IMAGE_TO_IMAGE'],
      maxConcurrency: 2,
    });
    expect(Number.isSafeInteger(result.revision)).toBe(true);
    expect(result.revision).toBeGreaterThanOrEqual(0);
    expect(result.revision).toBeLessThanOrEqual(2_147_483_647);
    const changedFlag = composeExtensionByokPolicyFromAdminControls({
      generationEnabled: true,
      ingestEnabled: true,
      publishEnabled: false,
      adminPolicy: {
        contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION,
        revision: 4,
        mode: 'pilot',
        ownerUserIds: ['owner-1'],
        shopIds: ['shop-1'],
        deviceSessionIds: ['device-1'],
        allowedOrigins: ['https://provider.example'],
        allowedOperations: ['IMAGE_TO_IMAGE'],
        maxConcurrency: 2,
      },
    });
    expect(changedFlag.revision).not.toBe(result.revision);
    expect(JSON.stringify(result)).not.toMatch(/api.?key|authorization|secret|token/iu);
  });

  it('fails closed when the system-config policy cannot be read or parsed', async () => {
    const loader = createExtensionByokSystemConfigPolicyLoader({
      readSnapshot: async () => ({
        feature_extension_byok_ai: false,
        feature_extension_byok_ingest: false,
        feature_extension_byok_publish: false,
        extension_byok_admin_policy: '{bad json',
      }),
    });
    await expect(loader()).rejects.toMatchObject({ code: 'EXTENSION_BYOK_ADMIN_POLICY_INVALID' });
  });

  it('loads one atomic snapshot and derives identity from every capability switch', async () => {
    const readSnapshot = vi.fn(async () => ({
      feature_extension_byok_ai: false,
      feature_extension_byok_ingest: true,
      feature_extension_byok_publish: false,
      extension_byok_admin_policy: JSON.stringify({
        contractVersion: EXTENSION_BYOK_ADMIN_POLICY_VERSION,
        revision: 12,
        mode: 'global',
        ownerUserIds: [],
        shopIds: [],
        deviceSessionIds: [],
        allowedOrigins: ['https://provider.example'],
        allowedOperations: ['TEXT_TO_IMAGE'],
        maxConcurrency: 3,
      }),
    }));
    const loader = createExtensionByokSystemConfigPolicyLoader({
      readSnapshot,
    });
    const result = await loader();
    expect(result).toMatchObject({
      contractVersion: EXTENSION_BYOK_POLICY_VERSION,
      generationEnabled: false,
      ingestEnabled: true,
      publishEnabled: false,
      maxConcurrency: 3,
    });
    expect(Number.isSafeInteger(result.revision)).toBe(true);
    expect(result.revision).toBeLessThanOrEqual(2_147_483_647);
    expect(readSnapshot).toHaveBeenCalledOnce();
  });

  it('does not enable hosted AI when its config reader fails', async () => {
    const loader = createExtensionHostedAiFlagLoader({
      readConfig: async () => { throw new Error('database unavailable'); },
    });
    await expect(loader()).resolves.toBe(false);
  });

  it('keeps the operations contract closed', () => {
    expect(EXTENSION_BYOK_OPERATIONS).toEqual([
      'TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT',
    ]);
  });
});
