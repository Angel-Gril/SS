import { createHash } from 'node:crypto';
import { aiMediaPayloadHash } from './ai-media-workflows.js';

export interface AiProviderReconciliationEventInput {
  jobId: string;
  ownerUserId: string;
  actorUserId?: string | null;
  workflowId?: string | null;
  reconciliationRevision: number;
  eventType: string;
  status: string;
  payload?: Record<string, unknown>;
  eventDiscriminator?: string;
}

export function aiProviderReconciliationEventKey(jobId: string, discriminator: string) {
  const digest = createHash('sha256')
    .update(`${jobId}\u0000${discriminator}`)
    .digest('hex');
  return `provider-reconciliation:${digest}`;
}

export function aiProviderReconciliationEventData(input: AiProviderReconciliationEventInput) {
  const payload = {
    schema: 'ai-provider-reconciliation-event/v1',
    status: input.status,
    ...(input.payload || {}),
  };
  return {
    jobId: input.jobId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId || null,
    workflowId: input.workflowId || null,
    reconciliationRevision: input.reconciliationRevision,
    eventKey: aiProviderReconciliationEventKey(
      input.jobId,
      input.eventDiscriminator || `${input.eventType}:${input.reconciliationRevision}`,
    ),
    eventType: input.eventType,
    payload,
    payloadHash: aiMediaPayloadHash(payload),
  };
}

export async function appendAiProviderReconciliationEvent(
  transaction: any,
  input: AiProviderReconciliationEventInput,
) {
  if (!transaction.aiProviderReconciliationEvent?.create) return null;
  return transaction.aiProviderReconciliationEvent.create({
    data: aiProviderReconciliationEventData(input),
  });
}
