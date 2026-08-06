import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionByokPublishAuthorizer,
  type ExtensionByokPublishAssetInspection,
  type ExtensionByokPublishDeviceAuthorization,
  type ExtensionByokPublishProvenance,
} from '../services/extension-byok-publish-authorization.js';
import {
  EXTENSION_BYOK_POLICY_VERSION,
  type ExtensionByokPolicySnapshot,
} from '../services/extension-byok-policy.js';

const providerOrigin = 'https://provider.example';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function policy(
  overrides: Partial<ExtensionByokPolicySnapshot> = {},
): ExtensionByokPolicySnapshot {
  return {
    contractVersion: EXTENSION_BYOK_POLICY_VERSION,
    revision: 17,
    mode: 'pilot',
    generationEnabled: true,
    ingestEnabled: true,
    publishEnabled: true,
    ownerUserIds: ['owner-1'],
    shopIds: ['shop-1'],
    deviceSessionIds: ['device-origin', 'device-publisher'],
    allowedOrigins: [providerOrigin],
    allowedOperations: ['TEXT_TO_IMAGE'],
    maxConcurrency: 1,
    ...overrides,
  };
}

function provenance(
  overrides: Partial<ExtensionByokPublishProvenance> = {},
): ExtensionByokPublishProvenance {
  return {
    assetId: 'asset-byok',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    workflowId: 'draft-1',
    deviceSessionId: 'device-origin',
    endpointOriginSha256: sha256(providerOrigin),
    operation: 'TEXT_TO_IMAGE',
    ...overrides,
  };
}

function inspection(
  overrides: Partial<ExtensionByokPublishAssetInspection> = {},
): ExtensionByokPublishAssetInspection {
  return {
    assetId: 'asset-byok',
    byokMarked: true,
    provenance: provenance(),
    ...overrides,
  };
}

function deviceAuthorization(
  sessionId: string,
  overrides: Partial<ExtensionByokPublishDeviceAuthorization> = {},
): ExtensionByokPublishDeviceAuthorization {
  return {
    sessionId,
    deploymentId: 'deployment-1',
    deviceId: 'physical-device-1',
    replacesSessionId: null,
    scopes: ['byok:media:ingest', 'listing:publish'],
    status: 'ACTIVE',
    expiresAt: new Date('2026-07-27T00:00:00.000Z'),
    revokedAt: null,
    revokedReason: null,
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    ownerStatus: 'ACTIVE',
    actorStatus: 'ACTIVE',
    ownerRole: 'USER',
    actorRole: 'USER',
    actorParentId: null,
    shopGrantStatus: 'ACTIVE',
    shopGrantRevokedReason: null,
    shopId: 'shop-1',
    shopOwnerUserId: 'owner-1',
    shopStatus: 'ACTIVE',
    shopPlatform: 'OZON',
    ...overrides,
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    loadPolicy: async () => policy(),
    inspectDraftAssets: async () => [inspection()],
    loadDeviceAuthorization: async ({ sessionId }: { sessionId: string }) => (
      deviceAuthorization(sessionId)
    ),
    now: () => new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  } as any;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    workflowId: 'draft-1',
    assignments: [{ assetId: 'asset-byok' }],
    requestingDeviceSessionId: 'device-origin',
    ...overrides,
  } as any;
}

describe('extension BYOK publish authorization', () => {
  it('preserves non-BYOK publishing without consulting the BYOK policy', async () => {
    const loadPolicy = vi.fn(async () => { throw new Error('config unavailable'); });
    const inspectDraftAssets = vi.fn(async () => [inspection({
      byokMarked: false,
      provenance: null,
    })]);
    const loadDeviceAuthorization = vi.fn();
    const authorize = createExtensionByokPublishAuthorizer(dependencies({
      loadPolicy, inspectDraftAssets, loadDeviceAuthorization,
    }));

    await expect(authorize(input())).resolves.toEqual({
      byokAssetIds: [],
      policyRevision: null,
    });
    expect(inspectDraftAssets).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      workflowId: 'draft-1',
      assetIds: ['asset-byok'],
    });
    expect(loadPolicy).not.toHaveBeenCalled();
    expect(loadDeviceAuthorization).not.toHaveBeenCalled();
  });

  it('allows every selected BYOK asset only under one matching live policy snapshot', async () => {
    const loadPolicy = vi.fn(async () => policy());
    const authorize = createExtensionByokPublishAuthorizer(dependencies({ loadPolicy }));

    await expect(authorize(input())).resolves.toEqual({
      byokAssetIds: ['asset-byok'],
      policyRevision: 17,
    });
    expect(loadPolicy).toHaveBeenCalledTimes(1);
  });

  it('requires both ingest and publish scope on the provenance device', async () => {
    for (const scopes of [
      ['listing:publish'],
      ['byok:media:ingest'],
    ] as const) {
      const authorize = createExtensionByokPublishAuthorizer(dependencies({
        loadDeviceAuthorization: async ({ sessionId }: { sessionId: string }) => (
          deviceAuthorization(sessionId, { scopes: [...scopes] })
        ),
      }));
      await expect(authorize(input())).rejects.toMatchObject({
        code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
        reasonCode: 'DEVICE_NOT_ALLOWED',
      });
    }
  });

  it('rejects publishing from a different device than the accepted BYOK provenance', async () => {
    const authorize = createExtensionByokPublishAuthorizer(dependencies());

    await expect(authorize(input({ requestingDeviceSessionId: 'device-publisher' })))
      .rejects.toMatchObject({
        code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
        reasonCode: 'DEVICE_NOT_ALLOWED',
        statusCode: 409,
      });
  });

  it('allows the owner-approved direct replacement session on the same physical device', async () => {
    const loadDeviceAuthorization = vi.fn(async ({ sessionId }: { sessionId: string }) => (
      sessionId === 'device-origin'
        ? deviceAuthorization(sessionId, {
            scopes: ['byok:media:ingest'],
            status: 'REVOKED',
            revokedAt: new Date('2026-07-25T00:00:00.000Z'),
            revokedReason: 'PAIRING_APPROVED',
            shopGrantStatus: 'REVOKED',
            shopGrantRevokedReason: 'PAIRING_APPROVED',
          })
        : deviceAuthorization(sessionId, {
            replacesSessionId: 'device-origin',
          })
    ));
    const authorize = createExtensionByokPublishAuthorizer(dependencies({
      loadPolicy: async () => policy({ deviceSessionIds: ['device-publisher'] }),
      loadDeviceAuthorization,
    }));

    await expect(authorize(input({ requestingDeviceSessionId: 'device-publisher' })))
      .resolves.toEqual({
        byokAssetIds: ['asset-byok'],
        policyRevision: 17,
      });
    expect(loadDeviceAuthorization).toHaveBeenCalledTimes(2);
  });

  const rejectedReplacementCases: Array<[
    string,
    Partial<ExtensionByokPublishDeviceAuthorization>,
    Partial<ExtensionByokPublishDeviceAuthorization>,
    Partial<ExtensionByokPolicySnapshot>?,
  ]> = [
    ['different device', {}, { deviceId: 'physical-device-2' }],
    ['different deployment', {}, { deploymentId: 'deployment-2' }],
    ['unlinked replacement', {}, { replacesSessionId: 'another-session' }],
    ['replacement missing ingest scope', {}, { scopes: ['listing:publish'] }],
    ['replacement missing publish scope', {}, { scopes: ['byok:media:ingest'] }],
    ['replacement policy names only predecessor', {}, { }, { deviceSessionIds: ['device-origin'] }],
    ['predecessor remains active', { status: 'ACTIVE', revokedAt: null, revokedReason: null, shopGrantStatus: 'ACTIVE', shopGrantRevokedReason: null }, {}],
    ['wrong session revocation', { revokedReason: 'OWNER_REVOKED' }, {}],
    ['wrong shop-grant revocation', { shopGrantRevokedReason: 'OWNER_REVOKED' }, {}],
  ];

  it.each(rejectedReplacementCases)(
    'rejects a replacement publish authorization with %s',
    async (_label, provenancePatch, replacementPatch, policyPatch = {}) => {
      const authorize = createExtensionByokPublishAuthorizer(dependencies({
        loadPolicy: async () => policy({ deviceSessionIds: ['device-publisher'], ...policyPatch }),
        loadDeviceAuthorization: async ({ sessionId }: { sessionId: string }) => (
          sessionId === 'device-origin'
            ? deviceAuthorization(sessionId, {
                scopes: ['byok:media:ingest'],
                status: 'REVOKED',
                revokedAt: new Date('2026-07-25T00:00:00.000Z'),
                revokedReason: 'PAIRING_APPROVED',
                shopGrantStatus: 'REVOKED',
                shopGrantRevokedReason: 'PAIRING_APPROVED',
                ...provenancePatch,
              })
            : deviceAuthorization(sessionId, {
                replacesSessionId: 'device-origin',
                ...replacementPatch,
              })
        ),
      }));

      await expect(authorize(input({ requestingDeviceSessionId: 'device-publisher' })))
        .rejects.toMatchObject({
          code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
          reasonCode: 'DEVICE_NOT_ALLOWED',
          statusCode: 409,
        });
    },
  );

  it.each([
    ['deployment ID', { deploymentId: 42 }],
    ['device ID', { deviceId: { value: 'physical-device-1' } }],
    ['replacement session ID', { replacesSessionId: 42 }],
  ])('fails closed for a malformed %s from the authorization repository', async (_label, patch) => {
    const authorize = createExtensionByokPublishAuthorizer(dependencies({
      loadDeviceAuthorization: async ({ sessionId }: { sessionId: string }) => (
        deviceAuthorization(
          sessionId,
          patch as unknown as Partial<ExtensionByokPublishDeviceAuthorization>,
        )
      ),
    }));

    await expect(authorize(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
      reasonCode: 'DEVICE_NOT_ALLOWED',
      statusCode: 409,
    });
  });

  it('propagates a missing publish scope from the cached same-device authorization', async () => {
    const loadDeviceAuthorization = vi.fn(async ({ sessionId }: { sessionId: string }) => (
      deviceAuthorization(sessionId, { scopes: ['byok:media:ingest'] })
    ));
    const authorize = createExtensionByokPublishAuthorizer(dependencies({
      loadDeviceAuthorization,
    }));

    await expect(authorize(input({ requestingDeviceSessionId: 'device-origin' })))
      .rejects.toMatchObject({
        code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
        reasonCode: 'DEVICE_NOT_ALLOWED',
        statusCode: 409,
      });
    expect(loadDeviceAuthorization).toHaveBeenCalledOnce();
  });

  it('propagates an unavailable live-device lookup before policy evaluation can continue', async () => {
    const authorize = createExtensionByokPublishAuthorizer(dependencies({
      loadDeviceAuthorization: async () => { throw new Error('database unavailable'); },
    }));

    await expect(authorize(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
      reasonCode: 'PROVENANCE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('fails closed when the independent BYOK publish flag is disabled', async () => {
    const authorize = createExtensionByokPublishAuthorizer({
      ...dependencies(),
      loadPolicy: async () => policy({ publishEnabled: false }),
    });

    await expect(authorize(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
      reasonCode: 'PUBLISH_DISABLED',
      statusCode: 409,
    });
  });

  it.each([
    ['owner', { ownerUserIds: ['owner-2'] }, {}, {}, 'OWNER_NOT_ALLOWED'],
    ['shop', { shopIds: ['shop-2'] }, {}, {}, 'SHOP_NOT_ALLOWED'],
    ['origin device', { deviceSessionIds: ['device-publisher'] }, {}, {}, 'DEVICE_NOT_ALLOWED'],
    ['operation', { allowedOperations: ['FULL_EDIT'] }, {}, {}, 'OPERATION_NOT_ALLOWED'],
    ['origin', { allowedOrigins: ['https://other.example'] }, {}, {}, 'ORIGIN_NOT_ALLOWED'],
  ] as const)(
    'rejects a pilot policy that does not match the exact %s',
    async (_label, policyPatch, provenancePatch, inputPatch, reasonCode) => {
      const authorize = createExtensionByokPublishAuthorizer({
        ...dependencies(),
        loadPolicy: async () => policy(
          policyPatch as unknown as Partial<ExtensionByokPolicySnapshot>,
        ),
        inspectDraftAssets: async () => [inspection({
          provenance: provenance(provenancePatch),
        })],
      });

      await expect(authorize(input(inputPatch))).rejects.toMatchObject({
        code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
        reasonCode,
        statusCode: 409,
      });
    },
  );

  it('fails closed when policy or provenance lookup is unavailable', async () => {
    const unavailablePolicy = createExtensionByokPublishAuthorizer({
      ...dependencies(),
      loadPolicy: async () => { throw new Error('config unavailable'); },
    });
    await expect(unavailablePolicy(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
      statusCode: 503,
    });

    const unavailableProvenance = createExtensionByokPublishAuthorizer({
      ...dependencies(),
      inspectDraftAssets: async () => { throw new Error('database unavailable'); },
    });
    await expect(unavailableProvenance(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
      statusCode: 503,
    });

    const incompleteInspection = createExtensionByokPublishAuthorizer({
      ...dependencies(),
      inspectDraftAssets: async () => [],
    });
    await expect(incompleteInspection(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
      reasonCode: 'PROVENANCE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('fails closed when a MediaAsset is marked EXTENSION_BYOK without provenance', async () => {
    const loadPolicy = vi.fn(async () => policy());
    const authorize = createExtensionByokPublishAuthorizer(dependencies({
      loadPolicy,
      inspectDraftAssets: async () => [inspection({ provenance: null })],
    }));

    await expect(authorize(input())).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_PUBLISH_POLICY_UNAVAILABLE',
      reasonCode: 'PROVENANCE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(loadPolicy).not.toHaveBeenCalled();
  });

  it.each([
    ['revoked', { status: 'REVOKED', revokedAt: new Date('2026-07-25T00:00:00.000Z') }],
    ['expired', { expiresAt: new Date('2026-07-25T23:59:59.000Z') }],
    ['revoked shop grant', { shopGrantStatus: 'REVOKED' }],
    ['transferred shop', { shopOwnerUserId: 'owner-2' }],
  ] as const)(
    'blocks a Web publish in global mode when the provenance device is %s',
    async (_label, devicePatch) => {
      const authorize = createExtensionByokPublishAuthorizer(dependencies({
        loadPolicy: async () => policy({
          mode: 'global', ownerUserIds: [], shopIds: [], deviceSessionIds: [],
        }),
        loadDeviceAuthorization: async ({ sessionId }: { sessionId: string }) => (
          deviceAuthorization(sessionId, devicePatch)
        ),
      }));

      await expect(authorize(input({ requestingDeviceSessionId: undefined })))
        .rejects.toMatchObject({
          code: 'EXTENSION_BYOK_PUBLISH_DISABLED',
          reasonCode: 'DEVICE_NOT_ALLOWED',
          statusCode: 409,
        });
    },
  );
});
