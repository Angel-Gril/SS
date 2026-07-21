export type AiProviderReconciliationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'MANUAL_REVIEW'
  | 'RECOVERED'
  | 'NO_OUTPUT'
  | 'NOT_SUBMITTED'
  | 'CANCELLED_OUTPUT_RETAINED';

export type AiProviderReconciliationAction = 'NOT_SUBMITTED' | 'NO_OUTPUT' | 'RESUME';
export type AiProviderReconciliationListStatus =
  | 'ALL'
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'MANUAL_REVIEW';

export interface AiProviderReconciliationItem {
  id: string;
  ownerUserId: string;
  workflowId: string | null;
  operation: string;
  provider: string;
  model: string;
  jobStatus: string;
  providerJobId: string | null;
  costProviderJobId: string | null;
  providerDispatchedAt: string | null;
  providerAcceptedAt: string | null;
  status: AiProviderReconciliationStatus;
  revision: number;
  attemptCount: number;
  nextAt: string | null;
  deadlineAt: string | null;
  lastProviderStatus: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  reconciledAt: string | null;
  updatedAt: string | null;
  costStatus: string | null;
  context: {
    type: string | null;
    id: string | null;
    skuKey: string | null;
    slotKey: string | null;
  } | null;
  allowedActions: AiProviderReconciliationAction[];
  evidenceHash: string;
}

export interface AiProviderReconciliationList {
  items: AiProviderReconciliationItem[];
  limit: number;
  status: AiProviderReconciliationListStatus;
  nextCursor: string | null;
}

export function aiProviderReconciliationActions(
  item: Pick<AiProviderReconciliationItem, 'status' | 'allowedActions'>,
): AiProviderReconciliationAction[] {
  if (item.status !== 'MANUAL_REVIEW' || !Array.isArray(item.allowedActions)) return [];
  return item.allowedActions.filter((action): action is AiProviderReconciliationAction => (
    action === 'NOT_SUBMITTED' || action === 'NO_OUTPUT' || action === 'RESUME'
  ));
}

export function createAiProviderReconciliationRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
