import type { OzonListingDraft, OzonListingPublishIntent } from 'shared';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class OzonListingDraftRepositoryError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'VERSION_CONFLICT' | 'ALREADY_EXISTS' | 'IDEMPOTENCY_CONFLICT',
    message: string,
  ) {
    super(message);
    this.name = 'OzonListingDraftRepositoryError';
  }
}

export interface OzonListingDraftRepository {
  create(draft: OzonListingDraft): Promise<OzonListingDraft>;
  findCurrentByIdentity(input: {
    ownerUserId: string;
    shopId: string;
    supplyGoodsId: string;
    sourceCaptureSnapshotId: string;
    selectedSkuKeys: string[];
  }): Promise<OzonListingDraft | null>;
  getCurrent(draftId: string, ownerUserId: string): Promise<OzonListingDraft | null>;
  getVersion(input: {
    draftId: string;
    ownerUserId: string;
    draftVersion: number;
  }): Promise<OzonListingDraft | null>;
  compareAndSwap(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    next: OzonListingDraft;
  }): Promise<OzonListingDraft>;
  getPublishIntent(input: {
    ownerUserId: string;
    idempotencyKey: string;
  }): Promise<OzonListingPublishIntent | null>;
  recordPublishIntent(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
    payloadHash: string;
    next: OzonListingDraft;
    intent: OzonListingPublishIntent;
  }): Promise<{ draft: OzonListingDraft; intent: OzonListingPublishIntent; idempotent: boolean }>;
}

export class InMemoryOzonListingDraftRepository implements OzonListingDraftRepository {
  private readonly current = new Map<string, OzonListingDraft>();
  private readonly versions = new Map<string, Map<number, OzonListingDraft>>();
  private readonly publishIntents = new Map<string, OzonListingPublishIntent>();

  async create(draft: OzonListingDraft): Promise<OzonListingDraft> {
    if (this.current.has(draft.id)) {
      throw new OzonListingDraftRepositoryError('ALREADY_EXISTS', 'Listing draft already exists');
    }
    const stored = clone(draft);
    this.current.set(draft.id, stored);
    this.versions.set(draft.id, new Map([[draft.draftVersion, stored]]));
    return clone(stored);
  }

  async findCurrentByIdentity(input: {
    ownerUserId: string;
    shopId: string;
    supplyGoodsId: string;
    sourceCaptureSnapshotId: string;
    selectedSkuKeys: string[];
  }): Promise<OzonListingDraft | null> {
    const skuIdentity = JSON.stringify(input.selectedSkuKeys);
    for (const draft of this.current.values()) {
      if (draft.ownerUserId === input.ownerUserId
        && draft.shopId === input.shopId
        && draft.supplyGoodsId === input.supplyGoodsId
        && draft.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
        && ['ACTIVE', 'PAUSED', 'RETRYABLE_FAILURE', 'MANUAL_REVIEW'].includes(draft.runState)
        && draft.stage !== 'PUBLISHED'
        && JSON.stringify(draft.selectedSkuKeys) === skuIdentity) return clone(draft);
    }
    return null;
  }

  async getCurrent(draftId: string, ownerUserId: string): Promise<OzonListingDraft | null> {
    const draft = this.current.get(draftId);
    return draft?.ownerUserId === ownerUserId ? clone(draft) : null;
  }

  async getVersion(input: {
    draftId: string;
    ownerUserId: string;
    draftVersion: number;
  }): Promise<OzonListingDraft | null> {
    const draft = this.versions.get(input.draftId)?.get(input.draftVersion);
    return draft?.ownerUserId === input.ownerUserId ? clone(draft) : null;
  }

  async compareAndSwap(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    next: OzonListingDraft;
  }): Promise<OzonListingDraft> {
    const current = this.current.get(input.draftId);
    if (!current || current.ownerUserId !== input.ownerUserId) {
      throw new OzonListingDraftRepositoryError('NOT_FOUND', 'Listing draft was not found');
    }
    if (current.revision !== input.expectedRevision) {
      throw new OzonListingDraftRepositoryError('VERSION_CONFLICT', 'Listing draft revision changed');
    }
    if (input.next.id !== current.id
      || input.next.ownerUserId !== current.ownerUserId
      || input.next.revision !== current.revision + 1
      || ![current.draftVersion, current.draftVersion + 1].includes(input.next.draftVersion)) {
      throw new OzonListingDraftRepositoryError('VERSION_CONFLICT', 'Invalid listing draft transition');
    }
    const stored = clone(input.next);
    this.current.set(input.draftId, stored);
    const versions = this.versions.get(input.draftId) || new Map<number, OzonListingDraft>();
    versions.set(stored.draftVersion, stored);
    this.versions.set(input.draftId, versions);
    return clone(stored);
  }

  async getPublishIntent(input: {
    ownerUserId: string;
    idempotencyKey: string;
  }): Promise<OzonListingPublishIntent | null> {
    const intent = this.publishIntents.get(`${input.ownerUserId}:${input.idempotencyKey}`);
    return intent ? clone(intent) : null;
  }

  async recordPublishIntent(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
    payloadHash: string;
    next: OzonListingDraft;
    intent: OzonListingPublishIntent;
  }): Promise<{ draft: OzonListingDraft; intent: OzonListingPublishIntent; idempotent: boolean }> {
    const intentKey = `${input.ownerUserId}:${input.idempotencyKey}`;
    const existing = this.publishIntents.get(intentKey);
    if (existing) {
      if (existing.draftId !== input.draftId || existing.payloadHash !== input.payloadHash) {
        throw new OzonListingDraftRepositoryError('IDEMPOTENCY_CONFLICT', 'Publish intent key was reused');
      }
      const current = this.current.get(input.draftId);
      if (!current || current.ownerUserId !== input.ownerUserId) {
        throw new OzonListingDraftRepositoryError('NOT_FOUND', 'Listing draft was not found');
      }
      return { draft: clone(current), intent: clone(existing), idempotent: true };
    }
    const current = this.current.get(input.draftId);
    if (!current || current.ownerUserId !== input.ownerUserId) {
      throw new OzonListingDraftRepositoryError('NOT_FOUND', 'Listing draft was not found');
    }
    if (current.revision !== input.expectedRevision
      || input.next.revision !== current.revision + 1
      || input.next.draftVersion !== current.draftVersion) {
      throw new OzonListingDraftRepositoryError('VERSION_CONFLICT', 'Listing draft revision changed');
    }
    const storedDraft = clone(input.next);
    const storedIntent = clone(input.intent);
    this.current.set(input.draftId, storedDraft);
    const versions = this.versions.get(input.draftId) || new Map<number, OzonListingDraft>();
    versions.set(storedDraft.draftVersion, storedDraft);
    this.versions.set(input.draftId, versions);
    this.publishIntents.set(intentKey, storedIntent);
    return { draft: clone(storedDraft), intent: clone(storedIntent), idempotent: false };
  }
}
