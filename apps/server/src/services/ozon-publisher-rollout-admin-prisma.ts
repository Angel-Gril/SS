import { createHash, randomUUID } from 'node:crypto';

import {
  OzonPublisherRolloutAdminError,
  OZON_PUBLISHER_ROLLOUT_STAGE_CONFIG_KEYS,
  type ApproveOzonPublisherRolloutGateRepositoryInput,
  type EvaluateOzonPublisherRolloutGateRepositoryInput,
  type OzonPublisherRolloutAdminEvaluation,
  type OzonPublisherRolloutAdminGate,
  type OzonPublisherRolloutAdminPage,
  type OzonPublisherRolloutAdminRepository,
  type OzonPublisherRolloutAdminStageControl,
  type OzonPublisherRolloutAdminStageTransition,
  type OzonPublisherRolloutAdminTransition,
  type OzonPublisherRolloutBoundary,
  type RevokeOzonPublisherRolloutGateRepositoryInput,
  type TransitionOzonPublisherRolloutStageRepositoryInput,
} from './ozon-publisher-rollout-admin.js';
import {
  loadPrismaOzonPublisherRolloutLiveSnapshotInTransaction,
  type LoadOzonPublisherRolloutControlSnapshot,
  type OzonPublisherRolloutReadinessPrismaTransaction,
} from './ozon-publisher-rollout-readiness-prisma.js';
import {
  evaluateOzonPublisherRolloutReadiness,
  OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS,
  OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
  type OzonPublisherRolloutReadinessEvaluation,
} from './ozon-publisher-rollout-readiness.js';

const STAGE_BOUNDARIES = Object.keys(
  OZON_PUBLISHER_ROLLOUT_STAGE_CONFIG_KEYS,
) as OzonPublisherRolloutBoundary[];
const CONFIG_TO_BOUNDARY = new Map<string, OzonPublisherRolloutBoundary>(
  STAGE_BOUNDARIES.map((boundary) => [OZON_PUBLISHER_ROLLOUT_STAGE_CONFIG_KEYS[boundary], boundary]),
);
const DAY_MS = 24 * 60 * 60 * 1000;

function hash(value: unknown): string {
  const stable = (input: unknown): string => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
    const row = input as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => (
      `${JSON.stringify(key)}:${stable(row[key])}`
    )).join(',')}}`;
  };
  return createHash('sha256').update(stable(value)).digest('hex');
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function error(
  code: ConstructorParameters<typeof OzonPublisherRolloutAdminError>[0],
  statusCode: ConstructorParameters<typeof OzonPublisherRolloutAdminError>[1],
  message: string,
): never {
  throw new OzonPublisherRolloutAdminError(code, statusCode, message);
}

function idempotencyConflict(): never {
  return error(
    'OZON_PUBLISHER_ROLLOUT_IDEMPOTENCY_CONFLICT',
    409,
    'The operation key was reused with a different request',
  );
}

function gateRecord(row: any): OzonPublisherRolloutAdminGate {
  return {
    id: String(row.id),
    writerEntrypoint: row.writerEntrypoint,
    originChannel: row.originChannel,
    rolloutRevision: String(row.rolloutRevision),
    recordContractVersion: String(row.recordContractVersion),
    evidencePolicyHash: String(row.evidencePolicyHash),
    authorizedControlConfigHash: String(row.authorizedControlConfigHash),
    guardContractVersion: String(row.guardContractVersion),
    denominatorEnforcedFrom: iso(row.denominatorEnforcedFrom)!,
    state: row.state,
    stateVersion: Number(row.stateVersion),
    readyEvaluationId: row.readyEvaluationId == null ? null : String(row.readyEvaluationId),
    evidenceHash: row.evidenceHash == null ? null : String(row.evidenceHash),
    evaluationHash: row.evaluationHash == null ? null : String(row.evaluationHash),
    approvedByUserId: row.approvedByUserId == null ? null : String(row.approvedByUserId),
    approvedAt: iso(row.approvedAt),
    approvalReason: row.approvalReason == null ? null : String(row.approvalReason),
    revokedByUserId: row.revokedByUserId == null ? null : String(row.revokedByUserId),
    revokedAt: iso(row.revokedAt),
    revocationReason: row.revocationReason == null ? null : String(row.revocationReason),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

function evaluationRecord(row: any): OzonPublisherRolloutAdminEvaluation {
  return {
    id: String(row.id),
    evaluationKey: String(row.evaluationKey),
    gateId: String(row.gateId),
    writerEntrypoint: row.writerEntrypoint,
    originChannel: row.originChannel,
    rolloutRevision: String(row.rolloutRevision),
    recordContractVersion: String(row.recordContractVersion),
    evaluatorVersion: String(row.evaluatorVersion),
    evidencePolicyHash: String(row.evidencePolicyHash),
    authorizedEvidencePolicyHash: String(row.authorizedEvidencePolicyHash),
    controlConfigHash: String(row.controlConfigHash),
    authorizedControlConfigHash: String(row.authorizedControlConfigHash),
    guardContractVersion: String(row.guardContractVersion),
    result: row.result,
    evidenceHash: String(row.evidenceHash),
    evaluationHash: String(row.evaluationHash),
    windowStart: iso(row.windowStart)!,
    windowEnd: iso(row.windowEnd)!,
    evaluatedAt: iso(row.evaluatedAt)!,
    evidenceRetainedUntil: iso(row.evidenceRetainedUntil)!,
    validUntil: iso(row.validUntil),
    actorUserId: String(row.actorUserId),
    criteria: row.thresholds as OzonPublisherRolloutAdminEvaluation['criteria'],
    metrics: row.metrics as OzonPublisherRolloutAdminEvaluation['metrics'],
    blockers: row.blockers as OzonPublisherRolloutAdminEvaluation['blockers'],
  };
}

function transitionRecord(row: any): OzonPublisherRolloutAdminTransition {
  return {
    id: String(row.id),
    gateId: String(row.gateId),
    transitionVersion: Number(row.transitionVersion),
    expectedStateVersion: Number(row.expectedStateVersion),
    action: row.action,
    fromState: row.fromState,
    resultState: row.resultState,
    evaluationId: String(row.evaluationId),
    evidenceHashSnapshot: String(row.evidenceHashSnapshot),
    evaluationHashSnapshot: String(row.evaluationHashSnapshot),
    actorUserId: String(row.actorUserId),
    reason: String(row.reason),
    decidedAt: iso(row.decidedAt)!,
  };
}

function stageRecord(row: any): OzonPublisherRolloutAdminStageControl {
  const boundary = CONFIG_TO_BOUNDARY.get(String(row.key));
  if (!boundary || !['off', 'shadow', 'v2'].includes(String(row.value))) {
    return error(
      'OZON_PUBLISHER_ROLLOUT_SNAPSHOT_UNAVAILABLE',
      503,
      'The rollout stage snapshot is invalid',
    );
  }
  return {
    boundary,
    configKey: String(row.key),
    stage: row.value,
    revision: Number(row.revision),
    updatedAt: iso(row.updatedAt)!,
  };
}

function stageTransitionRecord(row: any): OzonPublisherRolloutAdminStageTransition {
  return {
    id: String(row.id),
    boundary: row.boundary,
    configKey: String(row.configKey),
    transitionVersion: Number(row.transitionVersion),
    expectedRevision: Number(row.expectedRevision),
    fromStage: row.fromStage,
    resultStage: row.resultStage,
    gateId: row.gateId == null ? null : String(row.gateId),
    rolloutRevisionSnapshot: row.rolloutRevisionSnapshot == null
      ? null
      : String(row.rolloutRevisionSnapshot),
    gateStateVersionSnapshot: row.gateStateVersionSnapshot == null
      ? null
      : Number(row.gateStateVersionSnapshot),
    evidenceHashSnapshot: row.evidenceHashSnapshot == null
      ? null
      : String(row.evidenceHashSnapshot),
    evaluationHashSnapshot: row.evaluationHashSnapshot == null
      ? null
      : String(row.evaluationHashSnapshot),
    actorUserId: String(row.actorUserId),
    reason: String(row.reason),
    decidedAt: iso(row.decidedAt)!,
  };
}

function retryable(value: unknown): boolean {
  const row = value as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const codes = [row?.code, row?.meta?.code].map((item) => String(item || ''));
  return codes.some((code) => ['P2034', '40001', '40P01'].includes(code))
    || /could not serialize|deadlock detected/u.test(String(row?.message || ''));
}

async function serializable<T>(client: any, action: (tx: any) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (caught) {
      if (!retryable(caught)) throw caught;
      lastError = caught;
    }
  }
  throw lastError;
}

function page<T>(rows: any[], limit: number, map: (row: any) => T): OzonPublisherRolloutAdminPage<T> {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(map),
    nextCursor: rows.length > limit && last
      ? { sortAt: iso(last.evaluatedAt || last.createdAt)!, id: String(last.id) }
      : null,
  };
}

function evaluationData(input: {
  id: string;
  gateId: string;
  operationKey: string;
  requestHash: string;
  actorUserId: string;
  snapshot: Awaited<ReturnType<typeof loadPrismaOzonPublisherRolloutLiveSnapshotInTransaction>> & {};
  result: OzonPublisherRolloutReadinessEvaluation;
}) {
  const { snapshot, result } = input;
  const asOf = snapshot.asOf;
  return {
    id: input.id,
    evaluationKey: hash({
      contractVersion: 'ozon-publisher-rollout-evaluation-key/v1',
      operationKey: input.operationKey,
      evaluationHash: result.evaluationHash,
    }),
    operationKey: input.operationKey,
    requestHash: input.requestHash,
    actorUserId: input.actorUserId,
    gateId: input.gateId,
    writerEntrypoint: result.writerEntrypoint,
    originChannel: result.originChannel,
    rolloutRevision: result.rolloutRevision,
    recordContractVersion: 'ozon-publisher-rollout-evaluation/v3',
    evaluatorVersion: result.contractVersion,
    evidencePolicyHash: result.evidencePolicyHash,
    authorizedEvidencePolicyHash: result.authorizedEvidencePolicyHash,
    controlConfigHash: result.controlConfigHash,
    authorizedControlConfigHash: result.authorizedControlConfigHash,
    guardContractVersion: snapshot.gate.guardContractVersion,
    result: result.ready ? 'READY' : 'NOT_READY',
    evidenceHash: result.evidenceHash,
    evaluationHash: result.evaluationHash,
    windowStart: new Date(result.windowStartedAt),
    windowEnd: asOf,
    evaluatedAt: asOf,
    evidenceRetainedUntil: new Date(
      asOf.getTime() + OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.rollbackEvidenceDays * DAY_MS,
    ),
    validUntil: result.validUntil ? new Date(result.validUntil) : null,
    latestEligibleAt: result.metrics.latestEligibleAt
      ? new Date(result.metrics.latestEligibleAt)
      : null,
    thresholds: OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA,
    metrics: result.metrics,
    blockers: result.blockers,
    createdAt: asOf,
  };
}

async function loadGateSnapshot(options: {
  tx: any;
  gate: any;
  loadControlSnapshot: LoadOzonPublisherRolloutControlSnapshot;
}) {
  return loadPrismaOzonPublisherRolloutLiveSnapshotInTransaction({
    tx: options.tx as OzonPublisherRolloutReadinessPrismaTransaction,
    loadControlSnapshot: options.loadControlSnapshot,
  }, {
    writerEntrypoint: options.gate.writerEntrypoint,
    originChannel: options.gate.originChannel,
    rolloutRevision: options.gate.rolloutRevision,
  });
}

export function createPrismaOzonPublisherRolloutAdminRepository(options: {
  client: any;
  loadControlSnapshot: LoadOzonPublisherRolloutControlSnapshot;
  createId?: () => string;
}): OzonPublisherRolloutAdminRepository {
  const createId = options.createId || randomUUID;

  return {
    async listGates(input) {
      const rows = await options.client.ozonPublisherRolloutGate.findMany({
        where: {
          ...(input.writerEntrypoint ? { writerEntrypoint: input.writerEntrypoint } : {}),
          ...(input.originChannel ? { originChannel: input.originChannel } : {}),
          ...(input.rolloutRevision ? { rolloutRevision: input.rolloutRevision } : {}),
          ...(input.state ? { state: input.state } : {}),
          ...(input.cursor ? {
            OR: [
              { createdAt: { lt: new Date(input.cursor.sortAt) } },
              { createdAt: new Date(input.cursor.sortAt), id: { lt: input.cursor.id } },
            ],
          } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      });
      return page(rows, input.limit, gateRecord);
    },

    async findGate({ gateId }) {
      const row = await options.client.ozonPublisherRolloutGate.findUnique({
        where: { id: gateId },
      });
      return row ? gateRecord(row) : null;
    },

    async provisionGate(input) {
      return serializable(options.client, async (tx) => {
        const control = await options.loadControlSnapshot(tx, {
          writerEntrypoint: input.writerEntrypoint,
          originChannel: input.originChannel,
          rolloutRevision: input.rolloutRevision,
        });
        const id = createId();
        const now = new Date();
        const row = await tx.ozonPublisherRolloutGate.upsert({
          where: {
            writerEntrypoint_originChannel_rolloutRevision: {
              writerEntrypoint: input.writerEntrypoint,
              originChannel: input.originChannel,
              rolloutRevision: input.rolloutRevision,
            },
          },
          update: {},
          create: {
            id,
            writerEntrypoint: input.writerEntrypoint,
            originChannel: input.originChannel,
            rolloutRevision: input.rolloutRevision,
            recordContractVersion: 'ozon-publisher-rollout-gate/v1',
            evidencePolicyHash: control.evidencePolicyHash,
            authorizedControlConfigHash: control.controlConfigHash,
            guardContractVersion: OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.guard,
            denominatorEnforcedFrom: now,
            state: 'NOT_READY',
            stateVersion: 0,
            createdAt: now,
            updatedAt: now,
          },
        });
        if (String(row.evidencePolicyHash) !== control.evidencePolicyHash
          || String(row.authorizedControlConfigHash) !== control.controlConfigHash
          || String(row.guardContractVersion) !== OZON_PUBLISHER_ROLLOUT_EVIDENCE_CONTRACTS.guard) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_IDEMPOTENCY_CONFLICT',
            409,
            'The rollout revision is already bound to a different control snapshot',
          );
        }
        return { record: gateRecord(row), idempotent: String(row.id) !== id };
      });
    },

    async listEvaluations(input) {
      const rows = await options.client.ozonPublisherRolloutEvaluation.findMany({
        where: {
          gateId: input.gateId,
          ...(input.cursor ? {
            OR: [
              { evaluatedAt: { lt: new Date(input.cursor.sortAt) } },
              { evaluatedAt: new Date(input.cursor.sortAt), id: { lt: input.cursor.id } },
            ],
          } : {}),
        },
        orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      });
      return page(rows, input.limit, evaluationRecord);
    },

    async listTransitions(input) {
      const rows = await options.client.ozonPublisherRolloutTransition.findMany({
        where: {
          gateId: input.gateId,
          ...(input.cursor ? {
            OR: [
              { createdAt: { lt: new Date(input.cursor.sortAt) } },
              { createdAt: new Date(input.cursor.sortAt), id: { lt: input.cursor.id } },
            ],
          } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: input.limit + 1,
      });
      return page(rows, input.limit, transitionRecord);
    },

    async listStages() {
      const rows = await options.client.systemConfig.findMany({
        where: { key: { in: [...CONFIG_TO_BOUNDARY.keys()] } },
        orderBy: { key: 'asc' },
      });
      if (rows.length !== STAGE_BOUNDARIES.length) {
        return error(
          'OZON_PUBLISHER_ROLLOUT_SNAPSHOT_UNAVAILABLE',
          503,
          'The rollout stage snapshot is incomplete',
        );
      }
      return rows.map(stageRecord);
    },

    async evaluateGate(input: EvaluateOzonPublisherRolloutGateRepositoryInput) {
      return serializable(options.client, async (tx) => {
        const existing = await tx.ozonPublisherRolloutEvaluation.findUnique({
          where: { gateId_operationKey: { gateId: input.gateId, operationKey: input.operationKey } },
        });
        if (existing) {
          if (String(existing.requestHash) !== input.requestHash) return idempotencyConflict();
          return { record: evaluationRecord(existing), idempotent: true };
        }
        const gate = await tx.ozonPublisherRolloutGate.findUnique({ where: { id: input.gateId } });
        if (!gate) return error('OZON_PUBLISHER_ROLLOUT_GATE_NOT_FOUND', 404, 'Gate not found');
        const snapshot = await loadGateSnapshot({ tx, gate, loadControlSnapshot: options.loadControlSnapshot });
        if (!snapshot) return error('OZON_PUBLISHER_ROLLOUT_SNAPSHOT_UNAVAILABLE', 503, 'Snapshot unavailable');
        const result = evaluateOzonPublisherRolloutReadiness({
          writerEntrypoint: gate.writerEntrypoint,
          originChannel: gate.originChannel,
          rolloutRevision: gate.rolloutRevision,
          evidencePolicyHash: snapshot.control.evidencePolicyHash,
          authorizedEvidencePolicyHash: snapshot.gate.evidencePolicyHash,
          controlConfigHash: snapshot.control.controlConfigHash,
          authorizedControlConfigHash: snapshot.gate.authorizedControlConfigHash,
          coverageEpoch: snapshot.gate.coverageEpoch,
          asOf: snapshot.asOf,
          evidenceRows: snapshot.evidenceRows,
        });
        const created = await tx.ozonPublisherRolloutEvaluation.create({
          data: evaluationData({
            id: createId(), gateId: input.gateId, operationKey: input.operationKey,
            requestHash: input.requestHash, actorUserId: input.actor.actorUserId,
            snapshot, result,
          }),
        });
        return { record: evaluationRecord(created), idempotent: false };
      });
    },

    async approveGate(input: ApproveOzonPublisherRolloutGateRepositoryInput) {
      return serializable(options.client, async (tx) => {
        const existing = await tx.ozonPublisherRolloutTransition.findUnique({
          where: { gateId_operationKey: { gateId: input.gateId, operationKey: input.operationKey } },
        });
        if (existing) {
          if (String(existing.requestHash) !== input.requestHash) return idempotencyConflict();
          return { record: transitionRecord(existing), idempotent: true };
        }
        const gate = await tx.ozonPublisherRolloutGate.findUnique({ where: { id: input.gateId } });
        if (!gate) return error('OZON_PUBLISHER_ROLLOUT_GATE_NOT_FOUND', 404, 'Gate not found');
        if (gate.state !== 'NOT_READY' || Number(gate.stateVersion) !== input.expectedStateVersion) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_GATE_STATE_VERSION_CONFLICT', 409, 'Gate state changed',
          );
        }
        const snapshot = await loadGateSnapshot({ tx, gate, loadControlSnapshot: options.loadControlSnapshot });
        if (!snapshot) return error('OZON_PUBLISHER_ROLLOUT_SNAPSHOT_UNAVAILABLE', 503, 'Snapshot unavailable');
        const result = evaluateOzonPublisherRolloutReadiness({
          writerEntrypoint: gate.writerEntrypoint,
          originChannel: gate.originChannel,
          rolloutRevision: gate.rolloutRevision,
          evidencePolicyHash: snapshot.control.evidencePolicyHash,
          authorizedEvidencePolicyHash: snapshot.gate.evidencePolicyHash,
          controlConfigHash: snapshot.control.controlConfigHash,
          authorizedControlConfigHash: snapshot.gate.authorizedControlConfigHash,
          coverageEpoch: snapshot.gate.coverageEpoch,
          asOf: snapshot.asOf,
          evidenceRows: snapshot.evidenceRows,
        });
        if (result.evidenceHash !== input.expectedPreviewEvidenceHash) {
          return error('OZON_PUBLISHER_ROLLOUT_EVIDENCE_DRIFT', 409, 'Live evidence changed');
        }
        if (!result.ready) {
          return error('OZON_PUBLISHER_ROLLOUT_EVALUATION_NOT_READY', 409, 'Gate is not ready');
        }
        const evaluation = await tx.ozonPublisherRolloutEvaluation.create({
          data: evaluationData({
            id: createId(), gateId: input.gateId, operationKey: input.operationKey,
            requestHash: input.requestHash, actorUserId: input.actor.actorUserId,
            snapshot, result,
          }),
        });
        const updated = await tx.ozonPublisherRolloutGate.updateMany({
          where: { id: input.gateId, state: 'NOT_READY', stateVersion: input.expectedStateVersion },
          data: {
            state: 'READY', stateVersion: 1, readyEvaluationId: evaluation.id,
            evidenceHash: result.evidenceHash, evaluationHash: result.evaluationHash,
            approvedByUserId: input.actor.actorUserId, approvedAt: snapshot.asOf,
            approvalReason: input.reason, updatedAt: snapshot.asOf,
          },
        });
        if (updated.count !== 1) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_GATE_STATE_VERSION_CONFLICT', 409, 'Gate state changed',
          );
        }
        const transition = await tx.ozonPublisherRolloutTransition.create({
          data: {
            id: createId(), gateId: input.gateId, transitionVersion: 1,
            expectedStateVersion: input.expectedStateVersion,
            transitionKey: hash({ contractVersion: 'ozon-publisher-rollout-transition-key/v1', operationKey: input.operationKey }),
            operationKey: input.operationKey, requestHash: input.requestHash,
            action: 'APPROVE', fromState: 'NOT_READY', resultState: 'READY',
            evaluationId: evaluation.id, evidenceHashSnapshot: result.evidenceHash,
            evaluationHashSnapshot: result.evaluationHash,
            actorUserId: input.actor.actorUserId, reason: input.reason,
            decidedAt: snapshot.asOf, createdAt: snapshot.asOf,
          },
        });
        return { record: transitionRecord(transition), idempotent: false };
      });
    },

    async revokeGate(input: RevokeOzonPublisherRolloutGateRepositoryInput) {
      return serializable(options.client, async (tx) => {
        const existing = await tx.ozonPublisherRolloutTransition.findUnique({
          where: { gateId_operationKey: { gateId: input.gateId, operationKey: input.operationKey } },
        });
        if (existing) {
          if (String(existing.requestHash) !== input.requestHash) return idempotencyConflict();
          return { record: transitionRecord(existing), idempotent: true };
        }
        const gate = await tx.ozonPublisherRolloutGate.findUnique({ where: { id: input.gateId } });
        if (!gate) return error('OZON_PUBLISHER_ROLLOUT_GATE_NOT_FOUND', 404, 'Gate not found');
        if (gate.state !== 'READY' || Number(gate.stateVersion) !== input.expectedStateVersion) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_GATE_STATE_VERSION_CONFLICT', 409, 'Gate state changed',
          );
        }
        if (gate.evidenceHash !== input.expectedEvidenceHash
          || gate.evaluationHash !== input.expectedEvaluationHash) {
          return error('OZON_PUBLISHER_ROLLOUT_EVIDENCE_DRIFT', 409, 'Gate evidence changed');
        }
        const nowRows = await tx.$queryRawUnsafe(
          'SELECT transaction_timestamp()::timestamptz(3) AS now',
        ) as Array<{ now: Date }>;
        const now = nowRows[0]!.now;
        const updated = await tx.ozonPublisherRolloutGate.updateMany({
          where: { id: input.gateId, state: 'READY', stateVersion: input.expectedStateVersion },
          data: {
            state: 'REVOKED', stateVersion: 2, revokedByUserId: input.actor.actorUserId,
            revokedAt: now, revocationReason: input.reason, updatedAt: now,
          },
        });
        if (updated.count !== 1) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_GATE_STATE_VERSION_CONFLICT', 409, 'Gate state changed',
          );
        }
        const transition = await tx.ozonPublisherRolloutTransition.create({
          data: {
            id: createId(), gateId: input.gateId, transitionVersion: 2,
            expectedStateVersion: input.expectedStateVersion,
            transitionKey: hash({ contractVersion: 'ozon-publisher-rollout-transition-key/v1', operationKey: input.operationKey }),
            operationKey: input.operationKey, requestHash: input.requestHash,
            action: 'REVOKE', fromState: 'READY', resultState: 'REVOKED',
            evaluationId: gate.readyEvaluationId!, evidenceHashSnapshot: gate.evidenceHash!,
            evaluationHashSnapshot: gate.evaluationHash!, actorUserId: input.actor.actorUserId,
            reason: input.reason, decidedAt: now, createdAt: now,
          },
        });
        return { record: transitionRecord(transition), idempotent: false };
      });
    },

    async transitionStage(input: TransitionOzonPublisherRolloutStageRepositoryInput) {
      return serializable(options.client, async (tx) => {
        const existing = await tx.ozonPublisherRolloutStageTransition.findUnique({
          where: {
            configKey_operationKey: { configKey: input.configKey, operationKey: input.operationKey },
          },
        });
        if (existing) {
          if (String(existing.requestHash) !== input.requestHash) return idempotencyConflict();
          return { record: stageTransitionRecord(existing), idempotent: true };
        }
        const config = await tx.systemConfig.findUnique({ where: { key: input.configKey } });
        if (!config) {
          return error('OZON_PUBLISHER_ROLLOUT_SNAPSHOT_UNAVAILABLE', 503, 'Stage config missing');
        }
        if (Number(config.revision) !== input.expectedRevision || config.value !== input.expectedStage) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_STAGE_REVISION_CONFLICT', 409, 'Stage changed',
          );
        }
        let gate: any = null;
        if (input.targetStage === 'v2') {
          if (!input.gateBinding) {
            return error('OZON_PUBLISHER_ROLLOUT_STAGE_GATE_MISMATCH', 409, 'Gate binding missing');
          }
          gate = await tx.ozonPublisherRolloutGate.findUnique({
            where: { id: input.gateBinding.gateId },
          });
          const writerMatches = input.boundary === 'BROWSER_ONE_CLICK'
            ? gate?.writerEntrypoint === 'COLLECT_PUBLISH_OZON'
              && gate?.originChannel === 'BROWSER_ONE_CLICK'
            : gate?.writerEntrypoint === input.boundary && gate?.originChannel === 'DIRECT';
          if (!gate || !writerMatches || gate.state !== 'READY'
            || gate.rolloutRevision !== input.gateBinding.rolloutRevision
            || Number(gate.stateVersion) !== input.gateBinding.expectedGateStateVersion
            || gate.evidenceHash !== input.gateBinding.expectedEvidenceHash
            || gate.evaluationHash !== input.gateBinding.expectedEvaluationHash) {
            return error(
              'OZON_PUBLISHER_ROLLOUT_STAGE_V2_NOT_READY', 409, 'Exact READY gate required',
            );
          }
        }
        const nowRows = await tx.$queryRawUnsafe(
          'SELECT transaction_timestamp()::timestamptz(3) AS now',
        ) as Array<{ now: Date }>;
        const now = nowRows[0]!.now;
        const updated = await tx.systemConfig.updateMany({
          where: { key: input.configKey, value: input.expectedStage, revision: input.expectedRevision },
          data: { value: input.targetStage, revision: input.expectedRevision + 1, updatedAt: now },
        });
        if (updated.count !== 1) {
          return error(
            'OZON_PUBLISHER_ROLLOUT_STAGE_REVISION_CONFLICT', 409, 'Stage changed',
          );
        }
        const transition = await tx.ozonPublisherRolloutStageTransition.create({
          data: {
            id: createId(), boundary: input.boundary, configKey: input.configKey,
            transitionVersion: input.expectedRevision + 1,
            expectedRevision: input.expectedRevision,
            transitionKey: hash({ contractVersion: 'ozon-publisher-rollout-stage-transition-key/v1', operationKey: input.operationKey }),
            operationKey: input.operationKey, requestHash: input.requestHash,
            fromStage: input.expectedStage, resultStage: input.targetStage,
            gateId: gate?.id || null,
            rolloutRevisionSnapshot: gate?.rolloutRevision || null,
            gateStateVersionSnapshot: gate ? Number(gate.stateVersion) : null,
            evidenceHashSnapshot: gate?.evidenceHash || null,
            evaluationHashSnapshot: gate?.evaluationHash || null,
            actorUserId: input.actor.actorUserId, reason: input.reason,
            decidedAt: now, createdAt: now,
          },
        });
        return { record: stageTransitionRecord(transition), idempotent: false };
      });
    },
  };
}
