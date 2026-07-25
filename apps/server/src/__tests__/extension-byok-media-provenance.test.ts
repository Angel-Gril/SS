import { describe, expect, it, vi } from 'vitest';
import {
  EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
  createExtensionByokMediaProvenanceService,
  type ExtensionByokMediaProvenanceRecord,
  type ExtensionByokMediaProvenanceRepository,
} from '../services/extension-byok-media-provenance.js';

const HASH = {
  endpoint: 'a'.repeat(64),
  providerRequest: 'b'.repeat(64),
  prompt: 'c'.repeat(64),
  negativePrompt: 'd'.repeat(64),
  source: 'e'.repeat(64),
  reference: 'f'.repeat(64),
  mask: '1'.repeat(64),
  result: '2'.repeat(64),
  request: '3'.repeat(64),
};

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
    executionMode: 'BYOK',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 4,
    draftVersion: 2,
    skuKey: 'sku:blue-mug',
    slotKey: 'sku:blue-mug:hero:0',
    endpointOriginSha256: HASH.endpoint,
    model: 'relay-image-edit-v2',
    operation: 'INPAINT',
    providerRequestIdSha256: HASH.providerRequest,
    promptSha256: HASH.prompt,
    negativePromptSha256: HASH.negativePrompt,
    sourceSha256: HASH.source,
    referenceSha256s: [HASH.reference],
    maskSha256: HASH.mask,
    resultSha256: HASH.result,
    assetId: 'asset-1',
    resultMimeType: 'image/png',
    resultWidth: 1024,
    resultHeight: 1024,
    idempotencyKey: 'byok-ingest:workflow-1:sku:blue-mug:hero:0:attempt:1',
    requestHash: HASH.request,
    publishIntentId: null,
    publishReceiptId: null,
    erpAiChargeCents: 0,
    ...overrides,
  };
}

function record(overrides: Partial<ExtensionByokMediaProvenanceRecord> = {}) {
  const input = validInput();
  return {
    id: 'provenance-1',
    ...input,
    createdAt: new Date('2026-07-25T03:00:00.000Z'),
    updatedAt: new Date('2026-07-25T03:00:00.000Z'),
    ...overrides,
  } as ExtensionByokMediaProvenanceRecord;
}

function repositoryFixture(
  createResult: Awaited<ReturnType<ExtensionByokMediaProvenanceRepository['createOrReplay']>> = {
    kind: 'created',
    provenance: record(),
  },
) {
  type CreateInput = Parameters<ExtensionByokMediaProvenanceRepository['createOrReplay']>[0];
  type PublishInput = Parameters<ExtensionByokMediaProvenanceRepository['linkPublish']>[0];
  type PublishResult = Awaited<ReturnType<ExtensionByokMediaProvenanceRepository['linkPublish']>>;
  return {
    createOrReplay: vi.fn(async (_input: CreateInput) => createResult),
    linkPublish: vi.fn(async (_input: PublishInput): Promise<PublishResult> => ({
      kind: 'linked',
      provenance: record({
        publishIntentId: 'intent-1',
        publishReceiptId: 'receipt-1',
      }),
    })),
  } satisfies ExtensionByokMediaProvenanceRepository;
}

describe('extension BYOK media provenance', () => {
  it('persists one closed, non-secret, zero-charge provenance record', async () => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.record(validInput())).resolves.toMatchObject({
      idempotent: false,
      provenance: {
        id: 'provenance-1',
        executionMode: 'BYOK',
        operation: 'INPAINT',
        erpAiChargeCents: 0,
      },
    });
    expect(repository.createOrReplay).toHaveBeenCalledWith(validInput());

    const persisted = JSON.stringify(repository.createOrReplay.mock.calls[0]?.[0]);
    expect(persisted).not.toContain('https://');
    expect(persisted).not.toContain('Authorization');
    expect(persisted).not.toContain('data:image');
    expect(persisted).not.toContain('rawPrompt');
  });

  it.each([
    ['apiKey', 'sk-secret-sentinel'],
    ['authorization', 'Bearer secret-sentinel'],
    ['rawBase64', 'data:image/png;base64,secret-sentinel'],
    ['providerResultUrl', 'https://provider.example/private-result?token=secret-sentinel'],
    ['prompt', 'raw prompt must not be retained'],
    ['providerBody', { error: 'raw Provider response' }],
  ])('rejects forbidden or unknown field %s before repository access', async (field, value) => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.record(validInput({ [field]: value }))).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID',
      statusCode: 400,
    });
    expect(repository.createOrReplay).not.toHaveBeenCalled();
  });

  it.each([
    ['model URL with query credentials', { model: 'https://relay.example/v1?api_key=secret-sentinel' }],
    ['model data URL', { model: 'data:image/png;base64,secret-sentinel' }],
    ['model Authorization header', { model: 'Authorization: Bearer secret-sentinel' }],
    ['model raw OpenAI key prefix', { model: 'sk-proj-secret-sentinel' }],
    ['slot raw GitHub key prefix', { slotKey: 'ghp_secret-sentinel' }],
    ['slot query', { slotKey: 'sku:blue-mug:hero?token=secret-sentinel' }],
    ['SKU fragment', { skuKey: 'sku:blue-mug#secret-sentinel' }],
  ])('rejects secret-bearing user-controlled identifier: %s', async (_name, overrides) => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.record(validInput(overrides))).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID',
      statusCode: 400,
    });
    expect(repository.createOrReplay).not.toHaveBeenCalled();
  });

  it('requires publish identities to be attached after creation', async () => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.record(validInput({
      publishIntentId: 'intent-1',
      publishReceiptId: 'receipt-1',
    }))).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID',
    });
    expect(repository.createOrReplay).not.toHaveBeenCalled();
  });

  it.each([
    ['non-zero ERP AI charge', { erpAiChargeCents: 1 }],
    ['raw origin instead of its hash', { endpointOriginSha256: 'https://relay.example' }],
    ['oversized dimensions', { resultWidth: 4097 }],
    ['receipt without intent', { publishReceiptId: 'receipt-1' }],
    ['text-to-image with a source', {
      operation: 'TEXT_TO_IMAGE',
      sourceSha256: HASH.source,
      referenceSha256s: [],
      maskSha256: null,
    }],
    ['image-to-image without references', {
      operation: 'IMAGE_TO_IMAGE',
      sourceSha256: null,
      referenceSha256s: [],
      maskSha256: null,
    }],
    ['full edit without a source', {
      operation: 'FULL_EDIT',
      sourceSha256: null,
      maskSha256: null,
    }],
    ['inpaint without a mask', { maskSha256: null }],
  ])('fails closed for %s', async (_name, overrides) => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.record(validInput(overrides))).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID',
    });
    expect(repository.createOrReplay).not.toHaveBeenCalled();
  });

  it('returns an exact same-request replay and rejects same-key mutation', async () => {
    const replayRepository = repositoryFixture({ kind: 'replayed', provenance: record() });
    await expect(createExtensionByokMediaProvenanceService(replayRepository).record(validInput()))
      .resolves.toMatchObject({ idempotent: true, provenance: { id: 'provenance-1' } });

    const conflictRepository = repositoryFixture({ kind: 'conflict' });
    await expect(createExtensionByokMediaProvenanceService(conflictRepository).record(validInput()))
      .rejects.toMatchObject({
        code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_IDEMPOTENCY_CONFLICT',
        statusCode: 409,
      });
  });

  it('links publish identities without allowing them to be replaced', async () => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.linkPublish({
      provenanceId: 'provenance-1',
      ownerUserId: 'owner-1',
      publishIntentId: 'intent-1',
      publishReceiptId: 'receipt-1',
    })).resolves.toMatchObject({ idempotent: false, provenance: { publishReceiptId: 'receipt-1' } });

    repository.linkPublish.mockResolvedValueOnce({ kind: 'conflict' });
    await expect(service.linkPublish({
      provenanceId: 'provenance-1',
      ownerUserId: 'owner-1',
      publishIntentId: 'intent-2',
      publishReceiptId: 'receipt-1',
    })).rejects.toMatchObject({
      code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_PUBLISH_CONFLICT',
      statusCode: 409,
    });
  });

  it('requires intent and receipt to be linked as one pair', async () => {
    const repository = repositoryFixture();
    const service = createExtensionByokMediaProvenanceService(repository);

    await expect(service.linkPublish({
      provenanceId: 'provenance-1',
      ownerUserId: 'owner-1',
      publishIntentId: 'intent-1',
      publishReceiptId: null,
    })).rejects.toMatchObject({ code: 'EXTENSION_BYOK_MEDIA_PROVENANCE_INVALID' });
    expect(repository.linkPublish).not.toHaveBeenCalled();
  });
});
