import { createHash, randomUUID } from 'node:crypto';

import type { OzonPublisherEntrypointParityObservation } from './ozon-publisher-entrypoint-parity-shadow.js';
import type { OzonPublisherParityObservationRecord } from './ozon-publisher-parity-observations.js';
import { OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA } from './ozon-publisher-rollout-readiness.js';

const GUARD_CONTRACT_VERSION = 'ozon-publisher-rollout-guard/v1';
const ATTEMPT_CONTRACT_VERSION = 'ozon-publisher-parity-eligible-attempt/v1';
const RETENTION_DAYS = OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.windowDays
  + OZON_PUBLISHER_ROLLOUT_READINESS_CRITERIA.rollbackEvidenceDays
  + 1;

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

type Input = {
  ownerUserId: string;
  shopId: string;
  rolloutRevision: string;
  entrypoint: OzonPublisherEntrypointParityObservation['entrypoint'];
  endpoint: OzonPublisherEntrypointParityObservation['legacy']['endpoint'];
  payload: { items: unknown[] };
};

function writerOrigin(input: Input) {
  return {
    writerEntrypoint: 'COLLECT_PUBLISH_OZON' as const,
    originChannel: input.entrypoint === 'BROWSER_ONE_CLICK' ? 'BROWSER_ONE_CLICK' as const : 'DIRECT' as const,
    parityEntrypoint: input.entrypoint,
  };
}

export function createPrismaOzonPublisherRolloutRecorder(options: {
  client: any;
  createId?: () => string;
}) {
  const createId = options.createId || randomUUID;
  return {
    async begin(input: Input): Promise<{ eligibleAttemptKey: string } | null> {
      const identity = writerOrigin(input);
      const invocationId = createId();
      return options.client.$transaction(async (tx: any) => {
        const gate = await tx.ozonPublisherRolloutGate.findUnique({
          where: {
            writerEntrypoint_originChannel_rolloutRevision: {
              writerEntrypoint: identity.writerEntrypoint,
              originChannel: identity.originChannel,
              rolloutRevision: input.rolloutRevision,
            },
          },
          select: { id: true, evidencePolicyHash: true, guardContractVersion: true },
        });
        if (!gate) return null;
        const payloadHash = hash(input.payload);
        const scopeHash = hash({ ownerUserId: input.ownerUserId, shopId: input.shopId });
        const operationKey = hash({
          schema: 'ozon-publisher-rollout-recorder-operation/v1',
          gateId: gate.id, scopeHash, payloadHash, endpoint: input.endpoint, invocationId,
        });
        const existing = await tx.ozonPublisherRolloutRecorderAttempt.findUnique({
          where: { gateId_operationKey: { gateId: gate.id, operationKey } },
          select: { eligibleAttemptKey: true },
        });
        if (existing) return { eligibleAttemptKey: String(existing.eligibleAttemptKey) };
        const nowRows = await tx.$queryRawUnsafe(
          'SELECT transaction_timestamp()::TIMESTAMPTZ(3) AS now',
        );
        const now = new Date(nowRows[0]!.now);
        const eligibleAttemptKey = hash({ schema: 'ozon-publisher-rollout-eligible-attempt/v1', operationKey });
        await tx.ozonPublisherRolloutRecorderAttempt.create({
          data: {
            id: invocationId, attemptKey: hash({ schema: 'ozon-publisher-rollout-attempt/v1', operationKey }),
            eligibleAttemptKey, operationKey,
            requestHash: hash({ ownerUserId: input.ownerUserId, shopId: input.shopId, endpoint: input.endpoint }),
            payloadHash, itemCount: input.payload.items.length,
            attemptContractVersion: ATTEMPT_CONTRACT_VERSION,
            guardContractVersion: gate.guardContractVersion || GUARD_CONTRACT_VERSION,
            evidencePolicyHash: gate.evidencePolicyHash,
            gateId: gate.id, writerEntrypoint: identity.writerEntrypoint,
            originChannel: identity.originChannel, parityEntrypoint: identity.parityEntrypoint,
            rolloutRevision: input.rolloutRevision, scopeHash,
            eligibleAt: now, expiresAt: new Date(now.getTime() + RETENTION_DAYS * 86_400_000),
            createdAt: now,
          },
        });
        return { eligibleAttemptKey };
      }, { isolationLevel: 'Serializable' });
    },

    async complete(input: {
      eligibleAttemptKey: string;
      observation: OzonPublisherParityObservationRecord;
    }): Promise<void> {
      await options.client.$transaction(async (tx: any) => {
        const attempt = await tx.ozonPublisherRolloutRecorderAttempt.findUnique({
          where: { eligibleAttemptKey: input.eligibleAttemptKey },
          select: { id: true },
        });
        if (!attempt) return;
        const subject = input.observation.differenceSubjectKey
          ? await tx.ozonPublisherParityDifferenceSubject.findUnique({
            where: { subjectKey: input.observation.differenceSubjectKey },
            select: { stateVersion: true, fullDifferenceSignature: true },
          })
          : null;
        const nowRows = await tx.$queryRawUnsafe(
          'SELECT transaction_timestamp()::TIMESTAMPTZ(3) AS now',
        );
        const now = new Date(nowRows[0]!.now);
        await tx.ozonPublisherRolloutRecorderOutcome.upsert({
          where: { attemptId: attempt.id },
          update: {},
          create: {
            id: createId(), attemptId: attempt.id, result: 'RECORDED',
            observationId: input.observation.id,
            observationRecordKey: input.observation.recordKey,
            observationReportHash: input.observation.reportHash,
            subjectStateVersionSnapshot: subject?.stateVersion ?? null,
            fullDifferenceSignatureSnapshot: subject?.fullDifferenceSignature ?? null,
            completedAt: now, createdAt: now,
          },
        });
      }, { isolationLevel: 'Serializable' });
    },

    async fail(input: { eligibleAttemptKey: string; failureCode: string }): Promise<void> {
      await options.client.$transaction(async (tx: any) => {
        const attempt = await tx.ozonPublisherRolloutRecorderAttempt.findUnique({
          where: { eligibleAttemptKey: input.eligibleAttemptKey },
          select: { id: true },
        });
        if (!attempt) return;
        const nowRows = await tx.$queryRawUnsafe(
          'SELECT transaction_timestamp()::TIMESTAMPTZ(3) AS now',
        );
        const now = new Date(nowRows[0]!.now);
        await tx.ozonPublisherRolloutRecorderOutcome.upsert({
          where: { attemptId: attempt.id },
          update: {},
          create: {
            id: createId(), attemptId: attempt.id, result: 'FAILED',
            failureCode: String(input.failureCode).slice(0, 100),
            completedAt: now, createdAt: now,
          },
        });
      }, { isolationLevel: 'Serializable' });
    },
  };
}
