import type { PrismaClient } from '@prisma/client';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
  type AiImageSuiteReferenceAsset,
  type AiImageSuiteReferenceAssetCreateInput,
  type AiImageSuiteReferenceAuthority,
  type AiImageSuiteReferenceBinding,
  type AiImageSuiteReferenceCommitInput,
  type AiImageSuiteReferenceCommitResult,
  type AiImageSuiteReferenceRepository,
} from '../services/ai-image-suite-references.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REFERENCE_COMMIT_VERSION = 'ai-image-suite-reference-commit/v1';
const REFERENCE_EVENT_VERSION = 'ai-image-suite-references-internalized/v1';

const authorityInclude = {
  slots: { orderBy: { ordinal: 'asc' } },
  events: {
    where: { revision: 1, eventType: 'CLAIMED' },
    orderBy: { createdAt: 'asc' },
    take: 1,
  },
  plan: {
    select: {
      id: true,
      ownerUserId: true,
      sourceSubjectId: true,
      contextType: true,
      contextId: true,
      reviewStatus: true,
      currentVersionId: true,
      approvedVersionId: true,
      staleAt: true,
    },
  },
  planVersion: {
    select: {
      id: true,
      planId: true,
      ownerUserId: true,
      sourceSubjectId: true,
      sourceCaptureSnapshotId: true,
      sourceCaptureHash: true,
      sourceProfileHash: true,
      sourceSchemaVersion: true,
    },
  },
  sourceCaptureSnapshot: {
    select: {
      id: true,
      subjectId: true,
      captureHash: true,
      profileHash: true,
      schemaVersion: true,
      payloadBytes: true,
      payload: true,
      subject: { select: { ownerUserId: true } },
    },
  },
} as const;

interface FrozenCandidate {
  ordinal: number;
  candidateId: string;
  sourceUrl: string;
  expectedContentHash: string | null;
  identityHash: string;
}

function isUniqueConflict(error: unknown): boolean {
  return String((error as { code?: unknown } | null)?.code || '') === 'P2002';
}

function assetRecord(row: any): AiImageSuiteReferenceAsset {
  const metadata = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata as Record<string, unknown>
    : null;
  const sourceSha256 = String(metadata?.sourceSha256 || '').toLowerCase();
  return {
    id: String(row.id),
    ownerUserId: String(row.ownerUserId),
    kind: String(row.kind),
    sourceCaptureSnapshotId: row.sourceCaptureSnapshotId == null
      ? null
      : String(row.sourceCaptureSnapshotId),
    sourceMediaKey: row.sourceMediaKey == null ? null : String(row.sourceMediaKey),
    sourceUrl: row.sourceUrl == null ? null : String(row.sourceUrl),
    url: String(row.url),
    storageBackend: String(row.storageBackend),
    storageKey: row.storageKey == null ? null : String(row.storageKey),
    mimeType: String(row.mimeType),
    sizeBytes: Number(row.sizeBytes),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    sha256: row.sha256 == null ? null : String(row.sha256),
    sourceSha256: SHA256_PATTERN.test(sourceSha256) ? sourceSha256 : null,
    metadata,
  };
}

async function readAuthorityRow(client: any, suiteId: string, ownerUserId: string) {
  return client.aiMediaSuite.findFirst({
    where: { id: suiteId, ownerUserId },
    include: authorityInclude,
  });
}

async function readLatestSnapshot(client: any, suite: any) {
  if (suite.contextType !== 'collect') return null;
  const subject = await client.sourceCaptureSubject.findFirst({
    where: {
      id: suite.sourceSubjectId,
      ownerUserId: suite.ownerUserId,
      legacySupplyGoodsId: suite.contextId,
      legacySupplyGoods: { userId: suite.ownerUserId },
    },
    select: {
      snapshots: {
        orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: {
          id: true,
          captureHash: true,
          profileHash: true,
          schemaVersion: true,
        },
      },
    },
  });
  return subject?.snapshots?.[0] || null;
}

function authorityIdentityValid(suite: any): boolean {
  const plan = suite?.plan;
  const version = suite?.planVersion;
  const snapshot = suite?.sourceCaptureSnapshot;
  const slots = Array.isArray(suite?.slots)
    ? [...suite.slots].sort((left, right) => Number(left.ordinal) - Number(right.ordinal))
    : [];
  const claimedEvent = Array.isArray(suite?.events) ? suite.events[0] : null;
  const claimedPayload = claimedEvent?.payload;
  const slotHashes = slots.map((slot) => String(slot.slotHash || ''));
  const claimedSetValid = Boolean(claimedEvent
    && claimedPayload
    && typeof claimedPayload === 'object'
    && !Array.isArray(claimedPayload)
    && claimedEvent.eventType === 'CLAIMED'
    && Number(claimedEvent.revision) === 1
    && String(claimedEvent.suiteId) === String(suite?.id)
    && String(claimedEvent.ownerUserId) === String(suite?.ownerUserId)
    && String(claimedEvent.actorUserId) === String(suite?.actorUserId)
    && hashAiMediaPlanningJson(claimedPayload) === String(claimedEvent.payloadHash)
    && String(claimedPayload.version) === 'ai-image-suite-event/v1'
    && String(claimedPayload.planId) === String(suite?.planId)
    && String(claimedPayload.planVersionId) === String(suite?.planVersionId)
    && String(claimedPayload.previewHash) === String(suite?.previewHash)
    && Number(claimedPayload.itemCount) === Number(suite?.itemCount)
    && Array.isArray(claimedPayload.slotHashes)
    && hashAiMediaPlanningJson(claimedPayload.slotHashes) === hashAiMediaPlanningJson(slotHashes)
    && slots.length === Number(suite?.itemCount)
    && slots.every((slot, index) => Number(slot.ordinal) === index && SHA256_PATTERN.test(String(slot.slotHash))));
  return Boolean(suite
    && plan
    && version
    && snapshot
    && snapshot.subject
    && claimedSetValid
    && String(plan.id) === String(suite.planId)
    && String(plan.ownerUserId) === String(suite.ownerUserId)
    && String(plan.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(plan.contextType) === String(suite.contextType)
    && String(plan.contextId) === String(suite.contextId)
    && plan.reviewStatus === 'APPROVED'
    && plan.staleAt == null
    && String(plan.currentVersionId) === String(suite.planVersionId)
    && String(plan.approvedVersionId) === String(suite.planVersionId)
    && String(version.id) === String(suite.planVersionId)
    && String(version.planId) === String(suite.planId)
    && String(version.ownerUserId) === String(suite.ownerUserId)
    && String(version.sourceSubjectId) === String(suite.sourceSubjectId)
    && String(version.sourceCaptureSnapshotId) === String(suite.sourceCaptureSnapshotId)
    && String(version.sourceCaptureHash) === String(suite.sourceCaptureHash)
    && String(version.sourceProfileHash) === String(suite.sourceProfileHash)
    && String(version.sourceSchemaVersion) === String(suite.sourceSchemaVersion)
    && String(snapshot.id) === String(suite.sourceCaptureSnapshotId)
    && String(snapshot.subjectId) === String(suite.sourceSubjectId)
    && String(snapshot.subject.ownerUserId) === String(suite.ownerUserId)
    && String(snapshot.captureHash) === String(suite.sourceCaptureHash)
    && String(snapshot.profileHash) === String(suite.sourceProfileHash)
    && String(snapshot.schemaVersion) === String(suite.sourceSchemaVersion));
}

function latestMatchesSuite(suite: any, latest: any): boolean {
  return Boolean(latest
    && String(latest.id) === String(suite.sourceCaptureSnapshotId)
    && String(latest.captureHash) === String(suite.sourceCaptureHash)
    && String(latest.profileHash) === String(suite.sourceProfileHash)
    && String(latest.schemaVersion) === String(suite.sourceSchemaVersion));
}

function authorityRecord(suite: any, latest: any): AiImageSuiteReferenceAuthority | null {
  if (!authorityIdentityValid(suite)) return null;
  const snapshot = suite.sourceCaptureSnapshot;
  return {
    suiteId: String(suite.id),
    ownerUserId: String(suite.ownerUserId),
    actorUserId: String(suite.actorUserId),
    revision: Number(suite.revision),
    status: String(suite.status),
    provider: String(suite.provider),
    model: String(suite.model),
    sourceSubjectId: String(suite.sourceSubjectId),
    sourceCaptureSnapshotId: String(suite.sourceCaptureSnapshotId),
    sourceCaptureHash: String(suite.sourceCaptureHash),
    sourceProfileHash: String(suite.sourceProfileHash),
    sourceSchemaVersion: String(suite.sourceSchemaVersion),
    contextType: String(suite.contextType),
    contextId: String(suite.contextId),
    slots: Array.isArray(suite.slots)
      ? suite.slots.map((slot: any) => ({
        ordinal: Number(slot.ordinal),
        slotKey: String(slot.slotKey),
        referencesSnapshot: slot.referencesSnapshot,
      }))
      : [],
    snapshot: {
      id: String(snapshot.id),
      ownerUserId: String(snapshot.subject.ownerUserId),
      subjectId: String(snapshot.subjectId),
      captureHash: String(snapshot.captureHash),
      profileHash: String(snapshot.profileHash),
      schemaVersion: String(snapshot.schemaVersion),
      payloadBytes: Number(snapshot.payloadBytes),
      payload: snapshot.payload,
    },
    latestSnapshot: latest ? {
      id: String(latest.id),
      captureHash: String(latest.captureHash),
      profileHash: String(latest.profileHash),
      schemaVersion: String(latest.schemaVersion),
    } : null,
  };
}

function winnerMatchesInput(row: any, input: AiImageSuiteReferenceAssetCreateInput): boolean {
  const record = assetRecord(row);
  const expectedMetadata = { ...input.metadata, sourceSha256: input.sourceSha256 };
  return record.ownerUserId === input.ownerUserId
    && record.kind === input.kind
    && record.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
    && record.sourceMediaKey === input.sourceMediaKey
    && record.sourceUrl === input.sourceUrl
    && record.mimeType === input.mimeType
    && record.sizeBytes === input.sizeBytes
    && record.width === input.width
    && record.height === input.height
    && record.sha256 === input.sha256
    && record.sourceSha256 === input.sourceSha256
    && record.url === input.url
    && record.storageBackend === input.storageBackend
    && record.storageKey === input.storageKey
    && hashAiMediaPlanningJson(record.metadata) === hashAiMediaPlanningJson(expectedMetadata);
}

function operationFingerprint(input: AiImageSuiteReferenceCommitInput): string {
  return hashAiMediaPlanningJson({
    version: REFERENCE_COMMIT_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    operationKey: input.operationKey,
    sourceSubjectId: input.sourceSubjectId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
    sourceSchemaVersion: input.sourceSchemaVersion,
    referenceSetHash: input.referenceSetHash,
    bindings: input.bindings,
  });
}

interface CommitReplayLookupInput {
  suiteId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  operationKey: string;
}

function operationRequestFingerprint(input: CommitReplayLookupInput): string {
  return hashAiMediaPlanningJson({
    version: REFERENCE_COMMIT_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    operationKey: input.operationKey,
  });
}

function referenceEventKey(input: CommitReplayLookupInput): string {
  const digest = hashAiMediaPlanningJson({
    version: REFERENCE_EVENT_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    operationKey: input.operationKey,
  });
  return `suite-references:${digest}`;
}

function referenceEventPayload(input: AiImageSuiteReferenceCommitInput, fingerprint: string) {
  return {
    version: REFERENCE_EVENT_VERSION,
    operationKey: input.operationKey,
    requestFingerprint: operationRequestFingerprint(input),
    commitFingerprint: fingerprint,
    sourceSubjectId: input.sourceSubjectId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    sourceCaptureHash: input.sourceCaptureHash,
    sourceProfileHash: input.sourceProfileHash,
    sourceSchemaVersion: input.sourceSchemaVersion,
    referenceSetHash: input.referenceSetHash,
    referenceCount: input.bindings.length,
  };
}

function persistedReferenceSetHash(event: any): string | null {
  const payload = event?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const hash = String((payload as { referenceSetHash?: unknown }).referenceSetHash || '').toLowerCase();
  return event.eventType === 'REFERENCES_INTERNALIZED'
    && (payload as { version?: unknown }).version === REFERENCE_EVENT_VERSION
    && hashAiMediaPlanningJson(payload as Record<string, unknown>) === String(event.payloadHash)
    && SHA256_PATTERN.test(hash)
    ? hash
    : null;
}

function persistedBindings(rows: any[]): AiImageSuiteReferenceBinding[] | null {
  const ordered = [...rows].sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
  const bindings: AiImageSuiteReferenceBinding[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    if (!row
      || Number(row.ordinal) !== index
      || !Number.isSafeInteger(Number(row.width))
      || Number(row.width) < 1
      || !Number.isSafeInteger(Number(row.height))
      || Number(row.height) < 1
      || typeof row.storageKey !== 'string'
      || !row.storageKey
      || !SHA256_PATTERN.test(String(row.assetSha256))
      || !SHA256_PATTERN.test(String(row.rawSourceSha256))
      || (row.expectedContentHash != null
        && !SHA256_PATTERN.test(String(row.expectedContentHash)))) return null;
    const immutable = {
      version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
      suiteId: String(row.suiteId),
      ownerUserId: String(row.ownerUserId),
      ordinal: Number(row.ordinal),
      candidateId: String(row.candidateId),
      assetId: String(row.assetId),
      frozenSourceUrl: String(row.frozenSourceUrl),
      expectedContentHash: row.expectedContentHash == null ? null : String(row.expectedContentHash),
      assetSha256: String(row.assetSha256),
      rawSourceSha256: String(row.rawSourceSha256),
      assetUrl: String(row.assetUrl),
      storageBackend: String(row.storageBackend),
      storageKey: row.storageKey,
      mimeType: String(row.mimeType),
      sizeBytes: Number(row.sizeBytes),
      width: Number(row.width),
      height: Number(row.height),
    };
    if (!Number.isSafeInteger(immutable.sizeBytes)
      || immutable.sizeBytes < 1
      || hashAiMediaPlanningJson(immutable) !== String(row.bindingHash)) return null;
    bindings.push({
      ordinal: index,
      candidateId: String(row.candidateId),
      sourceMediaKey: String(row.candidateId),
      sourceUrl: String(row.frozenSourceUrl),
      expectedContentHash: immutable.expectedContentHash,
      sourceSha256: String(row.rawSourceSha256),
      assetId: String(row.assetId),
      assetSha256: String(row.assetSha256),
      assetUrl: String(row.assetUrl),
      storageBackend: String(row.storageBackend),
      storageKey: row.storageKey,
      mimeType: String(row.mimeType),
      width: Number(row.width),
      height: Number(row.height),
    });
  }
  return bindings;
}

async function readCommitReplay(
  client: any,
  input: CommitReplayLookupInput,
  expectedCommitFingerprint?: string,
) {
  const eventKey = referenceEventKey(input);
  const event = await client.aiMediaSuiteEvent.findUnique({ where: { eventKey } });
  if (!event) return null;
  const payload = event.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || String(event.suiteId) !== input.suiteId
    || String(event.ownerUserId) !== input.ownerUserId
    || String(event.actorUserId) !== input.actorUserId
    || String(event.eventType) !== 'REFERENCES_INTERNALIZED'
    || Number(event.revision) !== input.expectedRevision + 1
    || String((payload as any).version) !== REFERENCE_EVENT_VERSION
    || String((payload as any).operationKey) !== input.operationKey
    || String((payload as any).requestFingerprint) !== operationRequestFingerprint(input)
    || !SHA256_PATTERN.test(String((payload as any).referenceSetHash || ''))
    || !Number.isSafeInteger(Number((payload as any).referenceCount))
    || Number((payload as any).referenceCount) < 1
    || hashAiMediaPlanningJson(payload as Record<string, unknown>) !== String(event.payloadHash)
    || (expectedCommitFingerprint !== undefined
      && String((payload as any).commitFingerprint) !== expectedCommitFingerprint)) {
    return { kind: 'conflict' as const };
  }
  const rows = await client.aiMediaSuiteReferenceAsset.findMany({
    where: { suiteId: input.suiteId, ownerUserId: input.ownerUserId },
    orderBy: { ordinal: 'asc' },
  });
  const bindings = persistedBindings(rows);
  const referenceSetHash = String((payload as any).referenceSetHash);
  const sourceCaptureSnapshotId = String((payload as any).sourceCaptureSnapshotId || '');
  if (!bindings
    || bindings.length !== Number((payload as any).referenceCount)
    || hashAiMediaPlanningJson({
      version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
      suiteId: input.suiteId,
      ownerUserId: input.ownerUserId,
      sourceCaptureSnapshotId,
      bindings,
    }) !== referenceSetHash) return { kind: 'conflict' as const };
  return { kind: 'existing' as const, referenceSetHash, bindings };
}

function frozenCandidates(slots: any[]): FrozenCandidate[] | null {
  if (!Array.isArray(slots) || slots.length < 1) return null;
  const candidates = new Map<string, FrozenCandidate>();
  const slotOrdinals = new Set<number>();
  for (const slot of [...slots].sort((left, right) => Number(left.ordinal) - Number(right.ordinal))) {
    const slotOrdinal = Number(slot.ordinal);
    if (!Number.isSafeInteger(slotOrdinal) || slotOrdinal < 0 || slotOrdinals.has(slotOrdinal)
      || !Array.isArray(slot.referencesSnapshot) || slot.referencesSnapshot.length < 1) return null;
    slotOrdinals.add(slotOrdinal);
    for (const raw of slot.referencesSnapshot) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const reference = raw as { candidateId?: unknown; source?: unknown };
      const source = reference.source;
      if (typeof reference.candidateId !== 'string' || !reference.candidateId
        || !source || typeof source !== 'object' || Array.isArray(source)) return null;
      const sourceRecord = source as { url?: unknown; contentHash?: unknown };
      if (typeof sourceRecord.url !== 'string' || !sourceRecord.url
        || (sourceRecord.contentHash != null
          && (typeof sourceRecord.contentHash !== 'string'
            || !SHA256_PATTERN.test(sourceRecord.contentHash)))) return null;
      const identityHash = hashAiMediaPlanningJson({
        candidateId: reference.candidateId,
        source,
      });
      const existing = candidates.get(reference.candidateId);
      if (existing && existing.identityHash !== identityHash) return null;
      if (!existing) {
        candidates.set(reference.candidateId, {
          ordinal: candidates.size,
          candidateId: reference.candidateId,
          sourceUrl: sourceRecord.url,
          expectedContentHash: sourceRecord.contentHash == null ? null : sourceRecord.contentHash,
          identityHash,
        });
      }
    }
  }
  return [...candidates.values()];
}

function exactBindingSet(
  suite: any,
  input: AiImageSuiteReferenceCommitInput,
  candidates: FrozenCandidate[],
): boolean {
  if (input.sourceCaptureSnapshotId !== String(suite.sourceCaptureSnapshotId)
    || input.bindings.length !== candidates.length
    || new Set(input.bindings.map((binding) => binding.assetId)).size !== input.bindings.length) return false;
  const expectedHash = hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    bindings: input.bindings,
  });
  if (expectedHash !== input.referenceSetHash) return false;
  return input.bindings.every((binding, index) => {
    const candidate = candidates[index];
    return Boolean(candidate
      && binding.ordinal === candidate.ordinal
      && binding.candidateId === candidate.candidateId
      && binding.sourceMediaKey === candidate.candidateId
      && binding.sourceUrl === candidate.sourceUrl
      && binding.expectedContentHash === candidate.expectedContentHash
      && (candidate.expectedContentHash == null
        || binding.sourceSha256 === candidate.expectedContentHash));
  });
}

function ownedAssetsMatch(
  rows: any[],
  suite: any,
  bindings: AiImageSuiteReferenceBinding[],
): boolean {
  if (rows.length !== bindings.length) return false;
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return byId.size === bindings.length && bindings.every((binding) => {
    const row = byId.get(binding.assetId);
    const metadata = row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : null;
    return Boolean(row
      && String(row.ownerUserId) === String(suite.ownerUserId)
      && row.kind === 'SOURCE_ORIGINAL'
      && row.aiImageJobId == null
      && String(row.sourceCaptureSnapshotId) === String(suite.sourceCaptureSnapshotId)
      && String(row.sourceMediaKey) === binding.sourceMediaKey
      && String(row.sourceUrl) === binding.sourceUrl
      && String(row.url) === binding.assetUrl
      && String(row.storageBackend) === binding.storageBackend
      && String(row.storageKey) === binding.storageKey
      && String(row.mimeType) === binding.mimeType
      && Number(row.width) === binding.width
      && Number(row.height) === binding.height
      && Number.isSafeInteger(Number(row.sizeBytes))
      && Number(row.sizeBytes) > 0
      && String(row.sha256) === binding.assetSha256
      && (metadata?.sourceSha256 == null || String(metadata.sourceSha256) === binding.sourceSha256)
      && String(metadata?.sourceCaptureHash) === String(suite.sourceCaptureHash));
  });
}

function bindingData(
  suite: any,
  binding: AiImageSuiteReferenceBinding,
  asset: any,
) {
  const data = {
    suiteId: String(suite.id),
    ownerUserId: String(suite.ownerUserId),
    ordinal: binding.ordinal,
    candidateId: binding.candidateId,
    assetId: binding.assetId,
    frozenSourceUrl: binding.sourceUrl,
    expectedContentHash: binding.expectedContentHash,
    assetSha256: binding.assetSha256,
    rawSourceSha256: binding.sourceSha256,
    assetUrl: binding.assetUrl,
    storageBackend: binding.storageBackend,
    storageKey: binding.storageKey,
    mimeType: binding.mimeType,
    sizeBytes: Number(asset.sizeBytes),
    width: binding.width,
    height: binding.height,
  };
  return {
    ...data,
    bindingHash: hashAiMediaPlanningJson({
      version: AI_IMAGE_SUITE_REFERENCE_SET_VERSION,
      ...data,
    }),
  };
}

export class PrismaAiImageSuiteReferenceRepository implements AiImageSuiteReferenceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findCommitReplay(input: CommitReplayLookupInput) {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const exact = await readCommitReplay(tx, input);
      if (exact) return exact;
      const completed = await tx.aiMediaSuiteEvent.findFirst({
        where: {
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          eventType: 'REFERENCES_INTERNALIZED',
        },
        orderBy: { revision: 'asc' },
      });
      if (!completed) return null;
      const referenceSetHash = persistedReferenceSetHash(completed);
      return referenceSetHash
        ? { kind: 'already-internalized' as const, referenceSetHash }
        : { kind: 'conflict' as const };
    });
  }

  async loadAuthority(input: {
    suiteId: string;
    ownerUserId: string;
  }): Promise<AiImageSuiteReferenceAuthority | null> {
    return runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const suite = await readAuthorityRow(tx, input.suiteId, input.ownerUserId);
      if (!suite || !authorityIdentityValid(suite)) return null;
      const latest = await readLatestSnapshot(tx, suite);
      return authorityRecord(suite, latest);
    });
  }

  async findReusableAssets(input: {
    ownerUserId: string;
    sourceCaptureSnapshotId: string;
    sourceMediaKeys: string[];
  }): Promise<AiImageSuiteReferenceAsset[]> {
    if (input.sourceMediaKeys.length === 0) return [];
    const rows = await (this.prisma as any).mediaAsset.findMany({
      where: {
        ownerUserId: input.ownerUserId,
        kind: 'SOURCE_ORIGINAL',
        aiImageJobId: null,
        sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
        sourceMediaKey: { in: input.sourceMediaKeys },
      },
      orderBy: [
        { sourceMediaKey: 'asc' },
        { storageBackend: 'asc' },
        { createdAt: 'asc' },
      ],
    });
    return rows.map(assetRecord);
  }

  async createAsset(input: AiImageSuiteReferenceAssetCreateInput): Promise<AiImageSuiteReferenceAsset> {
    const data = {
      ownerUserId: input.ownerUserId,
      kind: input.kind,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
      sourceMediaKey: input.sourceMediaKey,
      sourceUrl: input.sourceUrl,
      url: input.url,
      storageBackend: input.storageBackend,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      width: input.width,
      height: input.height,
      sha256: input.sha256,
      metadata: { ...input.metadata, sourceSha256: input.sourceSha256 },
    };
    try {
      return assetRecord(await (this.prisma as any).mediaAsset.create({ data }));
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const winner = await (this.prisma as any).mediaAsset.findFirst({
        where: {
          ownerUserId: input.ownerUserId,
          kind: 'SOURCE_ORIGINAL',
          aiImageJobId: null,
          sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
          sourceMediaKey: input.sourceMediaKey,
          storageBackend: input.storageBackend,
        },
      });
      if (!winner || !winnerMatchesInput(winner, input)) throw error;
      return assetRecord(winner);
    }
  }

  async commitBindings(
    input: AiImageSuiteReferenceCommitInput,
  ): Promise<AiImageSuiteReferenceCommitResult> {
    const fingerprint = operationFingerprint(input);
    const eventKey = referenceEventKey(input);
    const payload = referenceEventPayload(input, fingerprint);
    const commit = async () => runAiMediaSerializableTransaction(this.prisma as any, async (tx: any) => {
      const replay = await readCommitReplay(tx, input, fingerprint);
      if (replay) {
        return replay.kind === 'existing'
          ? { kind: 'existing' as const, referenceSetHash: replay.referenceSetHash }
          : replay;
      }

      const suite = await readAuthorityRow(tx, input.suiteId, input.ownerUserId);
      if (!suite) return { kind: 'not-found' as const };

      const completed = await tx.aiMediaSuiteEvent.findFirst({
        where: {
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          eventType: 'REFERENCES_INTERNALIZED',
        },
        orderBy: { revision: 'asc' },
      });
      if (completed) {
        const referenceSetHash = persistedReferenceSetHash(completed);
        return referenceSetHash
          ? { kind: 'already-internalized' as const, referenceSetHash }
          : { kind: 'conflict' as const };
      }

      if (!authorityIdentityValid(suite)) {
        return suite.plan?.staleAt ? { kind: 'stale' as const } : { kind: 'conflict' as const };
      }
      if (input.sourceSubjectId !== String(suite.sourceSubjectId)
        || input.sourceCaptureSnapshotId !== String(suite.sourceCaptureSnapshotId)
        || input.sourceCaptureHash !== String(suite.sourceCaptureHash)
        || input.sourceProfileHash !== String(suite.sourceProfileHash)
        || input.sourceSchemaVersion !== String(suite.sourceSchemaVersion)) {
        return { kind: 'stale' as const };
      }
      const latest = await readLatestSnapshot(tx, suite);
      if (!latestMatchesSuite(suite, latest)) return { kind: 'stale' as const };
      if (suite.status !== 'PLANNED') return { kind: 'conflict' as const };
      if (input.expectedRevision !== 1 || Number(suite.revision) !== input.expectedRevision) {
        return { kind: 'revision-conflict' as const };
      }

      const candidates = frozenCandidates(suite.slots);
      if (!candidates || !exactBindingSet(suite, input, candidates)) {
        return { kind: 'conflict' as const };
      }
      const assets = await tx.mediaAsset.findMany({
        where: { ownerUserId: input.ownerUserId, id: { in: input.bindings.map((entry) => entry.assetId) } },
      });
      if (!ownedAssetsMatch(assets, suite, input.bindings)) {
        return { kind: 'conflict' as const };
      }
      const assetsById = new Map(assets.map((asset: any) => [String(asset.id), asset]));
      const nextRevision = input.expectedRevision + 1;
      const updated = await tx.aiMediaSuite.updateMany({
        where: {
          id: input.suiteId,
          ownerUserId: input.ownerUserId,
          revision: input.expectedRevision,
          status: 'PLANNED',
          planId: suite.planId,
          planVersionId: suite.planVersionId,
          sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
        },
        data: { revision: { increment: 1 } },
      });
      if (updated.count !== 1) return { kind: 'revision-conflict' as const };

      await tx.aiMediaSuiteReferenceAsset.createMany({
        data: input.bindings.map((binding) => bindingData(
          suite,
          binding,
          assetsById.get(binding.assetId),
        )),
      });
      await tx.aiMediaSuiteEvent.create({
        data: {
          suiteId: input.suiteId,
          ownerUserId: input.ownerUserId,
          revision: nextRevision,
          actorUserId: input.actorUserId,
          eventKey,
          eventType: 'REFERENCES_INTERNALIZED',
          payload,
          payloadHash: hashAiMediaPlanningJson(payload),
        },
      });
      return { kind: 'committed' as const, referenceSetHash: input.referenceSetHash };
    });

    try {
      return await commit();
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      return commit();
    }
  }
}
